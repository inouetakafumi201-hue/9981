/**
 * 伤害与治疗的五阶段规则（tasks.md 任务 3.5 / design.md 2.4、3.9、3.13）。
 *
 * 伤害不是引擎层原语，而是"玩法层事件 + 五阶段 RuleDef"（design.md 2.4 的原文做法）。
 * 全部规则读写**请求记录路径**（见 ids.ts 的 DEVIATION-02/03），不依赖"改写 payload"这条
 * 当前引擎层无法实现的通道。
 *
 * DEVIATION-05：design.md 3.13/4.1 把"受击后自动取消格挡"放在 after 阶段；但引擎层
 * HookDispatcher 的 after 阶段在保存点内执行、结束后无条件 rollback（只有 ctx.emit 存活），
 * after 阶段的写入会被丢弃。因此要落地写入的规则（取消格挡、打断精密交互）必须放在 default
 * 阶段（用 priority 排在应用伤害之后）。after 阶段只保留只读演出增量。
 *
 * DEVIATION-06：before 阶段否决对 emit 型事件不生效（wire-hooks.ts 丢弃 DispatchResult.cancelled）。
 * 因此 before 规则把否决理由写入请求记录的 veto 字段，default/after 规则用 when 检查 veto 为空
 * 才执行；发起动作在 emit 之后紧跟 vetoGuard 兑现整体回滚。
 */
import type { RuleDef, HookPhase } from '../../../core/kernel/events/types.js';
import type { Effect } from '../../../core/kernel/events/effect-types.js';
import type { Expr } from '../../../core/kernel/state/expr-types.js';
import type { NumericOwnershipRule } from '../ownership.js';
import { buildNumericOwnership, internalMetric, playExt, structuralBound } from '../ownership.js';
import {
  addNum,
  and,
  atOf,
  emitEffect,
  entityPropPath,
  eq,
  gte,
  hasTag,
  ifEffect,
  isNull,
  lacksTag,
  lenOf,
  letEffect,
  minNum,
  not,
  notNull,
  opEffect,
  pathOf,
  refExists,
  refGet,
  refId,
  requestField,
  setRequestField,
  subNum,
  varOf,
} from './expr.js';
import {
  ATT_BLOCKING,
  ATT_DOWNED_ZERO,
  ATT_PRECISE_INTERACTION,
  EVENT_DAMAGE_REQUEST,
  EVENT_DOWNED_ENTERED,
  EVENT_HEAL_REQUEST,
  EVENT_PRECISE_INTERRUPTED,
  PATH_REQ_DAMAGE,
  PATH_REQ_HEAL,
  PROP_VITALITY,
  REQ_FIELD_AMOUNT,
  REQ_FIELD_TARGET,
  REQ_FIELD_VETO,
  RULE_DAMAGE_AFTER_CANCEL_BLOCK,
  RULE_DAMAGE_AFTER_INTERRUPT_PRECISE,
  RULE_DAMAGE_AFTER_PRESENTATION,
  RULE_DAMAGE_BEFORE,
  RULE_DAMAGE_DEFAULT,
  RULE_HEAL_BEFORE,
  RULE_HEAL_DEFAULT,
  TAG_BLOCKING,
  TAG_DOWNED_ZERO,
  TAG_PERMANENT_EXIT,
  TAG_PRECISE_IN_PROGRESS,
  VITALITY_MAX,
  VITALITY_MIN_ALIVE,
} from './ids.js';

/** 规则里出现的数值只有 priority（结算次序）与少量结构阈值。 */
const RULE_OWNERSHIP_RULES: readonly NumericOwnershipRule[] = [
  { pathSuffix: 'priority', ownership: internalMetric('规则结算次序编号，不呈现给玩家，也不参与玩法刻度比较。') },
  {
    pathSuffix: 'args.1',
    ownership: structuralBound('存活/致死边界阈值与治疗上界：结构性判据，由生命刻度结构决定，不是玩家可配置的平衡数值。'),
  },
];

/** 构造一条玩法层 RuleDef，统一挂 play 扩展并对 priority 等数值做归属分类。 */
function playRule(input: {
  readonly id: string;
  readonly on: string;
  readonly phase: HookPhase;
  readonly priority: number;
  readonly when?: Expr;
  readonly effects: readonly Effect[];
  readonly sourceTrace: readonly string[];
  readonly ownershipRules?: readonly NumericOwnershipRule[];
}): RuleDef {
  const body = {
    id: input.id,
    kind: 'rule' as const,
    on: input.on,
    phase: input.phase,
    priority: input.priority,
    ...(input.when === undefined ? {} : { when: input.when }),
    effects: [...input.effects],
  };
  return {
    ...body,
    play: playExt({
      numericOwnership: buildNumericOwnership(body, input.ownershipRules ?? RULE_OWNERSHIP_RULES, `${input.id} 的数值归属`),
      sourceTrace: input.sourceTrace,
    }),
  };
}

export { playRule, RULE_OWNERSHIP_RULES };

// 请求记录里的目标与数量（读 draft，因此能看到 modify 阶段的改写）。
const damageTarget = requestField(PATH_REQ_DAMAGE, REQ_FIELD_TARGET);
const damageAmount = requestField(PATH_REQ_DAMAGE, REQ_FIELD_AMOUNT);
const damageNotVetoed = isNull(requestField(PATH_REQ_DAMAGE, REQ_FIELD_VETO));
const healTarget = requestField(PATH_REQ_HEAL, REQ_FIELD_TARGET);
const healAmount = requestField(PATH_REQ_HEAL, REQ_FIELD_AMOUNT);

/** 取一个 let 绑定的查询结果数组的第 0 项。 */
const firstOf = (varName: string): Expr => atOf(varOf(varName), 0);

/**
 * 只读演出/衍生事件的 payload：直接读整条伤害请求记录（此刻仍持有 source/target/amount）。
 * 这些事件当前无规则监听，仅供下游表现层订阅（design.md 2.2 的事件订阅只读通道）。
 */
const damageRequestPayload = pathOf(PATH_REQ_DAMAGE);

/**
 * before：目标资格 / 免疫。不合格即写 veto（发起动作的 vetoGuard 据此整体回滚）。
 * 合格判据：目标存在、带可见生命字段（未处于零血倒地）、未永久退出。
 */
export const damageBeforeRule: RuleDef = playRule({
  id: RULE_DAMAGE_BEFORE,
  on: EVENT_DAMAGE_REQUEST,
  phase: 'before',
  priority: 100,
  effects: [
    ifEffect(
      not(and(
        refExists(damageTarget),
        notNull(refGet(damageTarget, `props.${PROP_VITALITY}`)),
        lacksTag(damageTarget, TAG_PERMANENT_EXIT),
      )),
      [setRequestField(PATH_REQ_DAMAGE, REQ_FIELD_VETO, '伤害目标不合格：不存在、已处于零血倒地或已永久退出。')],
      [],
    ),
  ],
  sourceTrace: ['Req 11.3', 'Req 3.5', 'S5 生命值与倒地系统'],
});

/**
 * default：应用最终数值。读生命 → 分支 → prop.set 剩余生命，或 prop.del + attach.add 零血倒地。
 * when 检查 veto 为空（DEVIATION-06）。notNull(current)：目标已零血倒地时不重复致死（Req 11.3）。
 */
export const damageDefaultRule: RuleDef = playRule({
  id: RULE_DAMAGE_DEFAULT,
  on: EVENT_DAMAGE_REQUEST,
  phase: 'default',
  priority: 100,
  when: damageNotVetoed,
  effects: [
    letEffect('current', refGet(damageTarget, `props.${PROP_VITALITY}`)),
    ifEffect(
      notNull(varOf('current')),
      [
        letEffect('remaining', subNum(varOf('current'), damageAmount)),
        ifEffect(
          gte(varOf('remaining'), VITALITY_MIN_ALIVE),
          [opEffect('prop.set', { path: entityPropPath(refId(damageTarget), PROP_VITALITY), value: varOf('remaining') })],
          [
            opEffect('prop.del', { path: entityPropPath(refId(damageTarget), PROP_VITALITY) }),
            opEffect('attach.add', { def: ATT_DOWNED_ZERO, target: damageTarget }),
            emitEffect(EVENT_DOWNED_ENTERED, damageRequestPayload),
          ],
        ),
      ],
      [],
    ),
  ],
  sourceTrace: ['Req 11.3', 'Req 3.3', 'Req 3.5'],
});

/**
 * default（priority 200）：受击后自动取消格挡（Requirement 14.3）。
 * 放在 default 而非 after，理由见 DEVIATION-05。全过程无 decision.open，防守者不做选择。
 */
export const damageCancelBlockRule: RuleDef = playRule({
  id: RULE_DAMAGE_AFTER_CANCEL_BLOCK,
  on: EVENT_DAMAGE_REQUEST,
  phase: 'default',
  priority: 200,
  when: damageNotVetoed,
  effects: [
    ifEffect(
      hasTag(damageTarget, TAG_BLOCKING),
      [
        letEffect('blockAtt', {
          q: { from: 'attachments', where: and(eq(pathOf('self.def'), ATT_BLOCKING), eq(pathOf('self.target'), damageTarget)) },
        }),
        ifEffect(
          eq(lenOf(varOf('blockAtt')), 1),
          [opEffect('attach.del', { id: refId(firstOf('blockAtt')) })],
          [],
        ),
      ],
      [],
    ),
  ],
  sourceTrace: ['Req 14.3', 'D-009'],
});

/**
 * default（priority 300）：受到有效攻击时打断精密交互（Requirement 9.3）。
 * 清除中间状态并 emit play.precise.interrupted；不产生完成效果，已合法完成的第一步 AP 不退还。
 */
export const damageInterruptPreciseRule: RuleDef = playRule({
  id: RULE_DAMAGE_AFTER_INTERRUPT_PRECISE,
  on: EVENT_DAMAGE_REQUEST,
  phase: 'default',
  priority: 300,
  when: damageNotVetoed,
  effects: [
    ifEffect(
      hasTag(damageTarget, TAG_PRECISE_IN_PROGRESS),
      [
        letEffect('preciseAtt', {
          q: { from: 'attachments', where: and(eq(pathOf('self.def'), ATT_PRECISE_INTERACTION), eq(pathOf('self.target'), damageTarget)) },
        }),
        ifEffect(
          eq(lenOf(varOf('preciseAtt')), 1),
          [
            opEffect('attach.del', { id: refId(firstOf('preciseAtt')) }),
            emitEffect(EVENT_PRECISE_INTERRUPTED, damageRequestPayload),
          ],
          [],
        ),
      ],
      [],
    ),
  ],
  sourceTrace: ['Req 9.3', 'S5 精密交互'],
});

/** after：只读演出增量。after 阶段写入被引擎层无条件回滚，只有 emit 存活（DEVIATION-05）。 */
export const damageAfterPresentationRule: RuleDef = playRule({
  id: RULE_DAMAGE_AFTER_PRESENTATION,
  on: EVENT_DAMAGE_REQUEST,
  phase: 'after',
  priority: 100,
  when: damageNotVetoed,
  effects: [emitEffect('play.damage.resolved', damageRequestPayload)],
  sourceTrace: ['Req 11.3'],
});

/**
 * heal before：目标资格（Requirement 11.8、15.2 + 11.6 字段缺失防护）。
 * 目标缺生命字段或带零血倒地标记 → 写 veto，不治疗（否则 prop.add 把缺失读成 0 再写出 1 = 静默复活）。
 */
export const healBeforeRule: RuleDef = playRule({
  id: RULE_HEAL_BEFORE,
  on: EVENT_HEAL_REQUEST,
  phase: 'before',
  priority: 100,
  effects: [
    ifEffect(
      not(and(
        refExists(healTarget),
        notNull(refGet(healTarget, `props.${PROP_VITALITY}`)),
        lacksTag(healTarget, TAG_DOWNED_ZERO),
      )),
      [setRequestField(PATH_REQ_HEAL, REQ_FIELD_VETO, '治疗目标不合格：不存在、缺生命字段或处于零血倒地（不得复活）。')],
      [],
    ),
  ],
  sourceTrace: ['Req 11.8', 'Req 15.2', 'Req 11.6'],
});

/**
 * heal default：显式 clamp 到 5（不仅依赖 Def.clamp，因为下游实体未必声明它）。
 * min(current + amount, 5)：治疗上限恒为 5（Requirement 11.8）。
 */
export const healDefaultRule: RuleDef = playRule({
  id: RULE_HEAL_DEFAULT,
  on: EVENT_HEAL_REQUEST,
  phase: 'default',
  priority: 100,
  when: isNull(requestField(PATH_REQ_HEAL, REQ_FIELD_VETO)),
  effects: [
    letEffect('current', refGet(healTarget, `props.${PROP_VITALITY}`)),
    ifEffect(
      notNull(varOf('current')),
      [
        letEffect('healed', minNum(addNum(varOf('current'), healAmount), VITALITY_MAX)),
        opEffect('prop.set', { path: entityPropPath(refId(healTarget), PROP_VITALITY), value: varOf('healed') }),
      ],
      [],
    ),
  ],
  sourceTrace: ['Req 11.8', 'Req 15.8', 'Req 15.2'],
});

/** 本模块声明的全部 RuleDef。 */
export const CORE_DAMAGE_RULES: readonly RuleDef[] = [
  damageBeforeRule,
  damageDefaultRule,
  damageCancelBlockRule,
  damageInterruptPreciseRule,
  damageAfterPresentationRule,
  healBeforeRule,
  healDefaultRule,
];

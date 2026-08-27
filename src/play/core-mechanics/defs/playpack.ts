/**
 * CoreMechanicsPlaypack 组装（tasks.md 任务 4.1 / design.md 2.5、3.2、5.1）。
 *
 * PlaypackDef 汇总本 Spec 的全部声明式定义（附着/规则/状态/动作/网关/阶段），声明两个资源池
 * （AP、体力），指向五阶段 ScheduleDef，outcomes 由 CORE_OUTCOMES 非空守恒集填充（CEME C-1）。
 *
 * 附着动作的派生执行规则（CORE_ATTACHED_INVOKE_RULES）在装载期与附着动作一并注册进玩法包，
 * 挂在 play.attach.invoke 事件上（design.md 3.6 的"装载期例外"派生，同一份 effects 只声明一次）。
 *
 * 死亡背包实体（ENTITY_DEATH_BAG）在此声明：一个 insert:'fixed' 的空容器；"只出不进"由
 * before:item.move 规则 + 禁存清单实现（见 rules.phase.ts 的 DEVIATION-09），不复用尸体系统、
 * 不复用死者原背包实体（Requirement 12.7）。
 */
import type { PlaypackDef, PoolDef } from '../../../core/kernel/schedule/playpack';
import type { Def } from '../../../core/kernel/state/def';
import {
  buildNumericOwnership,
  constitutionalConstant,
  internalMetric,
  playExt,
  structuralBound,
} from '../ownership';
import { CORE_ATTACHMENT_DEFS } from './attachments';
import { CORE_PAID_ACTIONS } from './actions.paid';
import { CORE_ATTACHED_ACTIONS, CORE_ATTACHED_INVOKE_RULES, CORE_ATTACHED_REQUIRE_EXPRS } from './actions.attached';
import { CORE_DAMAGE_RULES } from './rules.damage';
import { CORE_STATUS_RULES, CORE_STATUS_EXPRS } from './rules.status';
import { CORE_GATEWAY_RULES } from './rules.gateway';
import { CORE_PHASE_RULES } from './rules.phase';
import { CORE_MATCH_RULES } from './rules.match';
import { CORE_OUTCOMES } from './outcomes';
import { coreSchedule } from './schedule';
import {
  DEATH_BAG_CONTAINER_NAME,
  ENTITY_DEATH_BAG,
  PLAYPACK_ID,
  POOL_AP,
  POOL_STAMINA,
  SCHEDULE_ID,
  STAMINA_MAX,
} from './ids';

/**
 * 死亡背包实体定义。容器 insert:'fixed'（灌注时逐个 slot.add，见 design.md 3.11）。
 * 注意 Def.containers 的元素形状是 ContainerSpec：{ name, insert, slots? }。
 */
export const deathBagEntityDef: Def = {
  id: ENTITY_DEATH_BAG,
  kind: 'entity',
  containers: [{ name: DEATH_BAG_CONTAINER_NAME, insert: 'fixed' }],
  play: playExt({
    sourceTrace: ['Req 12.7', 'S8 死亡背包'],
  }),
};

/**
 * 资源池。
 * - AP：per actor，reset:'turn'（每回合清零后由结算阶段重新分配）。分配上限 3（落在 1-5 内）。
 * - 体力：per actor，reset:'never'（跨回合保留，清理阶段自然恢复）。min 0（可耗尽）、max 5（D-007）。
 *
 * 起始体力由装载期出生装配（CEME C-4 / assembleMatchStart）经合法 Op 写入，不在此推断默认值。
 */
const AP_POOL: PoolDef = { name: POOL_AP, per: 'actor', min: 0, max: 3, reset: 'turn' };
const STAMINA_POOL: PoolDef = { name: POOL_STAMINA, per: 'actor', min: 0, max: STAMINA_MAX, reset: 'never' };

/** 玩法包本体（不含 play 扩展），供归属自检。 */
const playpackBody = {
  id: PLAYPACK_ID,
  kind: 'playpack' as const,
  version: '1.0.0',
  schedule: SCHEDULE_ID,
  pools: [AP_POOL, STAMINA_POOL],
  outcomes: [...CORE_OUTCOMES],
  defs: [
    deathBagEntityDef,
    coreSchedule,
    ...CORE_ATTACHMENT_DEFS,
    ...CORE_PAID_ACTIONS,
    ...CORE_ATTACHED_ACTIONS,
    ...CORE_ATTACHED_REQUIRE_EXPRS,
    ...CORE_ATTACHED_INVOKE_RULES,
    ...CORE_DAMAGE_RULES,
    ...CORE_STATUS_RULES,
    ...CORE_STATUS_EXPRS,
    ...CORE_GATEWAY_RULES,
    ...CORE_PHASE_RULES,
    ...CORE_MATCH_RULES,
  ],
};

/** 挂进 Hook 管道的全部 RuleDef（经 CoreMechanicsPlaypack.rules 引用挂载，与 UGC 包同一装载语义）。 */
export const CORE_MECHANICS_RULES = [
  ...CORE_ATTACHED_INVOKE_RULES,
  ...CORE_DAMAGE_RULES,
  ...CORE_STATUS_RULES,
  ...CORE_GATEWAY_RULES,
  ...CORE_PHASE_RULES,
  ...CORE_MATCH_RULES,
];

/**
 * CoreMechanicsPlaypack。
 *
 * `defs` 数组不参与本 Playpack 自身的数值归属（isExcludedRootKey 排除 'defs'）：每个子定义各自
 * 携带 play.numericOwnership，由玩法层 Linter 逐个校验。这里只需分类 Playpack 自身的池数值。
 */
export const CoreMechanicsPlaypack: PlaypackDef = {
  ...playpackBody,
  rules: [...CORE_MECHANICS_RULES.map((rule) => rule.id)],
  play: playExt({
    // 只对 Playpack 自身的数值（池的 min/max）分类；`defs` 数组里子定义的数值各自分类，
    // 因此从归属计算的输入里剔除 defs（buildNumericOwnership 的遍历不受根级排除影响）。
    numericOwnership: buildNumericOwnership(
      { ...playpackBody, defs: [] },
      [
        { pathSuffix: 'min', whenValue: (value) => value === 0, ownership: structuralBound('资源下限 0：资源可被耗尽到 0，是结构性护栏，不是玩家在 1-5 上选择的数值。') },
        { pathSuffix: 'max', ownership: constitutionalConstant('S0 四·4.2 / D-007：资源刻度上限（AP 分配上限 3、体力上限 5）落在 1-5 内。') },
        { pathSuffix: 'rank', ownership: internalMetric('结局优先级：Internal_Metric，不作为玩家可见 1-5 刻度。') },
        { pathSuffix: 'args.1', whenValue: (value) => value === 0 || value === 1, ownership: structuralBound('结局判据阈值（人数/回合/已淘汰计数的比较右操作数），不是玩家可见平衡值。') },
      ],
      `${PLAYPACK_ID} 的数值归属`,
    ),
    sourceTrace: ['Req 4.1', 'Req 6.1', 'Req 7.1', 'Req 20.2', 'S0 四·4.2', 'D-007', 'D-037'],
  }),
};

/** 本玩法包注册进注册表的全部定义（供装载入口逐个 register）。 */
export const CORE_MECHANICS_DEFS: readonly Def[] = playpackBody.defs;

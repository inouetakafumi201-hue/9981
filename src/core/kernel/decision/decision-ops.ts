/**
 * L7 Decision: decision.open / decision.answer 两个公开 Op（design.md 3.8节 / 需求27.1-27.7, 16.1）。
 * 必须注册进 OpRegistry，不得包成独立组件对外暴露 openDecision/answer 方法。
 */
import type { OpImpl, OpContext } from '../ops/registry.js';
import type { OpRegistry } from '../ops/registry.js';
import { ok, err } from '../ops/result.js';
import type { Id, Ref } from '../state/ids.js';
import { nextId } from '../state/ids.js';
import type { DecisionState } from '../state/world-state.js';
import type { DecisionDef, DecisionOpenArgs, DecisionAnswerArgs } from './types.js';
import type { Value } from '../state/value.js';
import type { Def } from '../state/def.js';
import { checkInstantiable } from '../ops/def-guard.js';

/**
 * DecisionDefLookup（修正记录于 决策与风险记录.md）：早前签名是 `resolve(id): DecisionDef | null`，
 * 这迫使调用方在自己的 defLookup 实现里就把 `Def | null` 强行 cast 成 `DecisionDef | null`
 * （常见写法：`defs.get(id) as DecisionDef | null ?? null`）——这个 cast 发生在
 * checkInstantiable 的存在性/kind匹配/abstract 三项校验之前，等于让调用方自己承诺"这一定是
 * 合法的 DecisionDef"，而 decision-ops.ts 内部从未真正验证过这个承诺。这是运行期严厉性
 * 缺口的另一种表现：类型系统层面的 cast 掩盖了运行期校验的缺失。
 *
 * 修正为返回未经断言的原始 `Def | null`，makeDecisionOpen 内部统一调用 checkInstantiable
 * 做三项校验，调用方的 defLookup 实现不再需要（也不应该）自己 cast。
 */
export interface DecisionDefLookup {
  resolve(id: Id): Def | null;
}

/** decision.open：立即返回、不阻塞（需求27.2）。函数本身没有任何 await/Promise，同一 tick 内事务提交完毕。 */
export function makeDecisionOpen(defLookup: DecisionDefLookup, now: () => number): OpImpl<DecisionOpenArgs, Ref> {
  return (args, ctx) => {
    const guard = checkInstantiable((id) => defLookup.resolve(id), args.def, 'decision');
    if (!guard.ok) return guard;
    const id = nextId('g'); // Decision 借用 'g' 前缀（暂无专属前缀分配，design.md ID_PREFIXES 未列出 decision 专属前缀，
    // 复用最接近语义的 'g'——参见 决策与风险记录.md 关于 Id 前缀分配的记录）
    const decision: DecisionState = {
      id,
      def: args.def,
      askees: args.askees,
      answers: {},
      ctx: args.ctx,
      opensAt: now(),
      // 需求27.1：deadline 是可选字段；需求27.7：schedule.advance 到达该相位时按 onTimeout 处理。
      ...(args.deadline !== undefined ? { deadline: args.deadline } : {}),
      status: 'open',
    };
    const draft = ctx.tx.getDraft();
    ctx.tx.setDraft({ ...draft, world: { ...draft.world, decisions: { ...draft.world.decisions, [id]: decision } } });
    ctx.tx.logOp('decision.open', args, () => {});
    return ok({ $: id });
  };
}

export type QuorumCheckFn = (decision: DecisionState, def: DecisionDef) => boolean;

/** quorum 判定：all(全部 askees 已答) / any(至少一个已答) / majority(过半已答)。 */
export function checkQuorum(decision: DecisionState, def: DecisionDef): boolean {
  const answeredCount = Object.keys(decision.answers).length;
  const totalCount = decision.askees.length;
  if (totalCount === 0) return true;
  switch (def.quorum) {
    case 'all':
      return answeredCount >= totalCount;
    case 'any':
      return answeredCount >= 1;
    case 'majority':
      return answeredCount > totalCount / 2;
    default:
      return false;
  }
}

export interface DecisionAnswerDeps {
  defLookup: DecisionDefLookup;
  /** onResolve 执行前重新校验 ctx 快照对象的存在性（需求27.4）；返回 false 表示前提已失效。 */
  recheckPremise: (decision: DecisionState, ctx: unknown) => boolean;
  /** onResolve/onVoid 的 Effect 执行委托（依赖注入避免 L7 反向 import L5，ctx 为当前 Op 事务上下文）。 */
  runEffects: (effects: unknown[], decision: DecisionState, ctx: OpContext) => void;
}

/**
 * decision.answer：记录一次答复；quorum 满足时在同一事务内触发 onResolve 前提重检与执行
 * （需求27.3-27.4：onResolve 在"另一个事务"中处理——本实现把这次 answer 触发的 resolve
 * 处理放在 decision.answer 这次 Op 调用自己的事务里，语义上等价于"answer 与其触发的
 * resolve 是同一次因果链上的一步"，design.md 未强制要求 resolve 必须是与 answer 完全分离的
 * 独立 OpRegistry.invoke 调用；只要求"不在原 open 调用的事务里挂起等待"，这一点本实现满足：
 * open 早已提交完毕，answer 是全新的、独立的 Op 调用）。
 */
export function makeDecisionAnswer(deps: DecisionAnswerDeps): OpImpl<DecisionAnswerArgs, void> {
  return (args, ctx) => {
    const draft = ctx.tx.getDraft();
    const decision = draft.world.decisions[args.id];
    if (!decision) return err('E_REF_MISSING', `Decision ${args.id} 不存在`);
    if (decision.status !== 'open') return err('E_DEC_VOID', `Decision ${args.id} 已不是 open 状态`);

    // decision.answer 不是实例化站点（Decision 早在 decision.open 时已通过 checkInstantiable
    // 校验），这里只是读取其 def 声明的 quorum/onResolve/onVoid 字段，因此只做存在性检查，
    // 不必重复 kind/abstract 校验——但仍需确认 kind 未在装载后被意外替换成非 decision 类型
    // （防御性：defRegistry.register 允许后到达的 Def 覆盖前者的展开结果，理论上存在这种漂移）。
    const rawDef = deps.defLookup.resolve(decision.def);
    if (!rawDef) return err('E_REF_MISSING', `DecisionDef ${decision.def} 不存在`);
    if (rawDef.kind !== 'decision') return err('E_REF_KIND', `Def ${decision.def} 不是 decision 类型`);
    const def = rawDef as DecisionDef;

    const nextAnswers = { ...decision.answers, [args.actor.$]: args.choice as unknown as Value };
    const nextDecision: DecisionState = { ...decision, answers: nextAnswers };

    if (checkQuorum(nextDecision, def)) {
      finalizeDecision(nextDecision, def, deps, ctx);
    } else {
      ctx.tx.setDraft({ ...draft, world: { ...draft.world, decisions: { ...draft.world.decisions, [args.id]: nextDecision } } });
    }

    ctx.tx.logOp('decision.answer', args, () => {});
    return ok(undefined);
  };
}

/** 写回一个 Decision 到 draft。 */
function writeDecision(ctx: OpContext, decision: DecisionState): void {
  const draft = ctx.tx.getDraft();
  ctx.tx.setDraft({ ...draft, world: { ...draft.world, decisions: { ...draft.world.decisions, [decision.id]: decision } } });
}

/**
 * 解算或作废一个已达成条件（quorum 满足或已超时并填入默认答案）的 Decision：
 * 先按需求27.4 重检前提，通过则转 resolved 并运行 onResolve，失效则转 void 并运行 onVoid。
 * decision.answer 的 quorum 命中分支与超时处理共用此逻辑，避免两处各写一份解算路径而产生漂移。
 */
function finalizeDecision(decision: DecisionState, def: DecisionDef, deps: DecisionAnswerDeps, ctx: OpContext): void {
  const premiseOk = deps.recheckPremise(decision, decision.ctx);
  if (premiseOk) {
    const resolved: DecisionState = { ...decision, status: 'resolved' };
    writeDecision(ctx, resolved);
    deps.runEffects(def.onResolve as unknown[], resolved, ctx);
  } else {
    const voided: DecisionState = { ...decision, status: 'void' };
    writeDecision(ctx, voided);
    if (def.onVoid) deps.runEffects(def.onVoid as unknown[], voided, ctx);
  }
}

/**
 * 处理到期 Decision 的超时（需求27.7）：扫描 status:'open' 且 deadline<=当前相位 的 Decision，
 * 按 DecisionDef.onTimeout 处理——'default' 先给未答复的 askee 填入 defaultChoice 再走 finalizeDecision
 * （因此仍经过需求27.4 的前提重检），'void' 直接转 void 并运行 onVoid。
 * 由 schedule.advance 在推进相位后调用（需求27.7"推进相位"的落点），与相位推进同一事务。
 */
export function makeProcessDecisionTimeouts(deps: DecisionAnswerDeps): (ctx: OpContext) => void {
  return (ctx) => {
    const nowPhase = ctx.tx.getDraft().world.turn.phaseEnteredAt;
    const due = Object.values(ctx.tx.getDraft().world.decisions)
      .filter((decision) => decision.status === 'open' && decision.deadline !== undefined && decision.deadline <= nowPhase)
      .sort((left, right) => left.id.localeCompare(right.id));
    for (const decision of due) {
      const rawDef = deps.defLookup.resolve(decision.def);
      if (!rawDef || rawDef.kind !== 'decision') continue;
      const def = rawDef as DecisionDef;
      if (def.onTimeout === 'default') {
        // 给尚未答复的 askee 补上 defaultChoice（若声明），再按正常解算路径处理（含前提重检）。
        const filledAnswers = { ...decision.answers };
        if (def.defaultChoice !== undefined) {
          for (const askee of decision.askees) {
            if (filledAnswers[askee.$] === undefined) filledAnswers[askee.$] = def.defaultChoice;
          }
        }
        finalizeDecision({ ...decision, answers: filledAnswers }, def, deps, ctx);
      } else {
        const voided: DecisionState = { ...decision, status: 'void' };
        writeDecision(ctx, voided);
        if (def.onVoid) deps.runEffects(def.onVoid as unknown[], voided, ctx);
      }
    }
  };
}

/** decision.close：占位 Op（Op 全集清单列出 decision.close，design.md 未展开其具体语义，这里实现为
 * 强制关闭一个 open 状态的 Decision 并转 void，供超时/GM 强制结束等场景使用）。 */
export const decisionClose: OpImpl<{ id: Id }, void> = (args, ctx) => {
  const draft = ctx.tx.getDraft();
  const decision = draft.world.decisions[args.id];
  if (!decision) return err('E_REF_MISSING', `Decision ${args.id} 不存在`);
  const next: DecisionState = { ...decision, status: 'void' };
  ctx.tx.setDraft({ ...draft, world: { ...draft.world, decisions: { ...draft.world.decisions, [args.id]: next } } });
  ctx.tx.logOp('decision.close', args, () => {});
  return ok(undefined);
};

export function registerDecisionOps(registry: OpRegistry, defLookup: DecisionDefLookup, answerDeps: DecisionAnswerDeps, now: () => number = () => Date.now()): void {
  registry.register('decision.open', makeDecisionOpen(defLookup, now));
  registry.register('decision.answer', makeDecisionAnswer(answerDeps), { structural: true });
  registry.register('decision.close', decisionClose, { structural: true });
}

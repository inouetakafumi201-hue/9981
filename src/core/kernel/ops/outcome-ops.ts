/**
 * L3 Ops: outcome.reach（design.md 3.4/3.10节 / 需求32.4-32.6, 16.6）。
 *
 * 缺失 Op 补齐（记录于 决策与风险记录.md）：design.md 3.4节 Op 全集清单把 outcome.reach
 * 列在"结局类"分组，需求32.4-32.6 要求 OutcomeDef 取代单一布尔胜负条件——但此前实现完全
 * 没有 outcome.reach 这个 Op。这里补齐：outcome.reach 只记录"某个 scope 达成了某个结局"
 * 这一事实（{scope, ends, rank, phase}），不做任何派生判断（如"是否应结束游戏"）——
 * 内核不对结局赋予语义，只忠实记录事实，由玩法包的 OutcomeDef.onReach Effect 或宿主运行时
 * 决定如何处理这个事实。详见本文件内 outcomeReach 函数上的判断记录。
 */
import type { OpImpl, OpRegistry } from './registry.js';
import { ok } from './result.js';
import type { Ref } from '../state/ids.js';
import type { Value } from '../state/value.js';

export interface OutcomeReachArgs {
  outcomeName: string;
  scope: Ref;
  ends: boolean;
  rank?: number;
}

interface OutcomeReachRecord {
  scope: Ref;
  ends: boolean;
  rank?: number;
  reachedAtPhase: number;
}

/**
 * outcome.reach：把一次结局达成事实追加到 world.props.outcomes[outcomeName]（需求32.4-32.5）。
 *
 * 判断记录（决策与风险记录.md）：需求32.6 的字面表述是"内核应**允许**该行动者被淘汰后整局
 * 继续进行"——这是一条否定式/许可式要求（"内核不得强制在此时结束整局"），不是要求内核自己
 * 维护一份"已淘汰 scope"列表来定义"淘汰"这件事本身。这与 design.md 反复强调的纪律一致：
 * 内核不对"回合"（或"结局"）赋予语义，只忠实记录事实，语义解释交给玩法包的 onReach Effect
 * 或宿主循环。因此 outcome.reach 的唯一职责是把 {scope, ends, rank, phase} 追加进
 * world.props.outcomes[outcomeName]，不做任何"是否应该结束游戏/是否应该标记谁被淘汰"的推断——
 * 这类判断完全依赖调用方（玩法包 OutcomeDef.onReach 或宿主运行时）对 outcomes 记录的后续现查。
 * 早前版本在这里维护了一份 endedScopes 派生列表，属于自主发明的机制，已删除。
 */
export const outcomeReach: OpImpl<OutcomeReachArgs, void> = (args, ctx) => {
  const draft = ctx.tx.getDraft();
  const existingOutcomes = (draft.world.props['outcomes'] as Record<string, OutcomeReachRecord[]> | undefined) ?? {};
  const existingList = existingOutcomes[args.outcomeName] ?? [];

  // 幂等：同一 scope 对同一 outcomeName 重复调用不追加第二条记录（不存在的静默重复没有意义，
  // 但也不应因重复调用而产生"同一玩家达成两次同一结局"的失真记录）。
  if (existingList.some((r) => r.scope.$ === args.scope.$)) {
    return ok(undefined);
  }

  const record: OutcomeReachRecord = {
    scope: args.scope,
    ends: args.ends,
    rank: args.rank,
    reachedAtPhase: draft.world.turn.phaseIndex,
  };
  const nextOutcomes = { ...existingOutcomes, [args.outcomeName]: [...existingList, record] };
  const nextProps: Record<string, Value> = { ...draft.world.props, outcomes: nextOutcomes as unknown as Value };

  ctx.tx.setDraft({ ...draft, world: { ...draft.world, props: nextProps } });
  ctx.tx.logOp('outcome.reach', args, () => {});
  return ok(undefined);
};

export function registerOutcomeOps(registry: OpRegistry): void {
  registry.register('outcome.reach', outcomeReach);
}

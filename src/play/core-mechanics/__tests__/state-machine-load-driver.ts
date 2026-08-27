/**
 * 装载驱动：构造 `CoreMechanicsRuntime` 并把官方 config 真正喂进 `loadCoreMechanics`。
 *
 * 复用 `src/core/kernel/testing/full-harness.ts` 的 `createFullHarness`（它已把全部 registerXxxOps +
 * wireHooksIntoRegistry 接进同一个 holder/registry/ruleProvider/playpackLoader），因此这里只做
 * 最小适配：
 * - `createFullHarness` 的 holder/registry/defRegistry/ruleProvider/playpackLoader 与
 *   `CoreMechanicsRuntime` 字段一一对应；
 * - 需要 `actionCatalog` 之外的 `queryActions` 转发（load 用它构造只读投影）。getState 用 holder，
 *   listActionDefs 从 defRegistry 全部 action def 出，ctxForActor 转发 harness 的 ctxForSelf。
 *
 * 额外：把官方 config 的 damageAmountSources[0].amountRef 数值注入 `world.props.play.damageAmountRef`
 * （attack 守卫读它），并预置一个已解析的"伤害数值来源 def"，使守卫 notNull 放行。
 */
import type { CoreMechanicsConfig } from '../load';
import { loadCoreMechanics } from '../load';
import { createFullHarness } from '../../../core/kernel/testing/full-harness';
import { ActionCatalog } from '../../../core/kernel/actions/catalog';
import type { ActionDef } from '../../../core/kernel/actions/types';
import { setPath } from '../../../core/kernel/ops/path';
import type { WorldState } from '../../../core/kernel/state/world-state';
import {
  ATTACK_DAMAGE_VALUE,
  officialCoreMechanicsConfig,
} from './official-state-machine-config';

/** 构造已接齐 Hook/Op 的装载 runtime，并预置 config 的装载期世界状态。 */
export function createLoadedCoreMechanics(): {
  load: ReturnType<typeof loadCoreMechanics>;
  harness: ReturnType<typeof createFullHarness>;
  config: CoreMechanicsConfig;
} {
  const harness = createFullHarness();
  const config = officialCoreMechanicsConfig();

  // 预置攻击伤害数值来源：attack 首条守卫 `notNull(pathOf(PATH_DAMAGE_AMOUNT_REF))` 读的是
  // world.props.play.damageAmountRef。装载入口不会写这一项（它只写 rollPolicyReady 等三项），
  // 因此这里按官方 config 的声明把数值写上；数值=ATTACK_DAMAGE_VALUE（1-5 内伤害刻度）。
  const preState: WorldState = setPath(
    harness.holder.getState(),
    'world.props.play.damageAmountRef',
    ATTACK_DAMAGE_VALUE as never,
  ) as WorldState;
  harness.holder.setState(preState);

  const actionCatalog = new ActionCatalog({
    getState: () => harness.holder.getState(),
    exprEngine: harness.exprEngine,
    queryEngine: harness.queryEngine,
    // harness.ctxForSelf 接受 (ref, vars)：把 ActionCatalog 展开的 target/node 绑定透传，
    // 否则带目标绑定的动作 require 会在未绑定 var 上求值出 null，攻击/移动永远不可见。
    ctxForActor: (actor, bindings) => harness.ctxForSelf(actor, bindings),
    listActionDefs: () => harness.defRegistry.allResolved()
      .filter((definition): definition is ActionDef => definition.kind === 'action') as ActionDef[],
  });

  // CoreMechanicsRuntime.queryActions 转发（load 用它构造只读投影）。ActionCatalog.queryActions
  // 的签名是 queryActions(actor: Ref, mode)，mode 作为第二参。
  const queryActions = (actorRef: { $: string }, mode: 'ui' | 'ai') => actionCatalog.queryActions(actorRef, mode);

  const load = loadCoreMechanics({
    runtime: {
      registry: harness.registry,
      defRegistry: harness.defRegistry,
      ruleProvider: harness.ruleProvider,
      playpackLoader: harness.playpackLoader,
      holder: harness.holder,
      queryActions,
    },
    config,
  });

  return { load, harness, config };
}

/**
 * 装载等价专项（D-081 / L0 第十四条）P4 交付物：规则挂载统一契约。
 *
 * 目标：官方包与 UGC 包的常驻规则**必须走同一条挂载路径**——都从 `playpack.rules` 引用解析
 * （与 PlaypackActivator 的 mountPermanentRules 同语义）。load.ts 不再存在
 * `playpack === CoreMechanicsPlaypack` 源码特权分支。
 *
 * 契约断言：
 * ① 官方包 `CoreMechanicsPlaypack` 声明了 `rules` 引用，且集合恰为 CORE_MECHANICS_RULES 的 id 集
 *    （缺一条即漏挂，多一条即错挂——断言按引用集而非按默认常量）；
 * ② 默认装载路径挂载的规则集 = 官方包声明的 rules 引用集（装载读包内声明，不读源码特权常量）；
 * ③ 显式注入官方包（loadCoreMechanics({playpack: CoreMechanicsPlaypack})）与默认路径挂载面一致
 *    （同一份声明的两条装载路径地位等价）；
 * ④ 每个 rules 引用在 defs 内都解析到 kind==='rule' 的定义（引用完整性）；
 * ⑤ 无 rules 声明的包不挂任何规则（官方 ⑥ 的边界回归）。
 *
 * 本测试不引入任何新语义：官方包的 rules 引用正是 CORE_MECHANICS_RULES 的派生，装载读引用
 * 的路径与 UGC 包读 `playpack.rules` 的路径是同一段代码（load.ts Step 4）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { resetIdCounters } from '../../../core/kernel/state/ids';
import type { PlaypackDef } from '../../../core/kernel/schedule/playpack';
import { createFullHarness } from '../../../core/kernel/testing/full-harness';
import { ActionCatalog } from '../../../core/kernel/actions/catalog';
import type { ActionDef } from '../../../core/kernel/actions/types';
import { setPath } from '../../../core/kernel/ops/path';
import type { WorldState } from '../../../core/kernel/state/world-state';
import { loadCoreMechanics, type CoreMechanicsLoadOptions } from '../load';
import { CoreMechanicsPlaypack, CORE_MECHANICS_RULES } from '../defs/playpack';
import { officialCoreMechanicsConfig, ATTACK_DAMAGE_VALUE } from './official-state-machine-config';

/** 与 state-machine-load-driver.ts 同构的组合根：官方 config + 预置世界状态。 */
function createRuntimeAndLoad(playpack?: PlaypackDef) {
  const harness = createFullHarness();
  harness.holder.setState(setPath(
    harness.holder.getState(),
    'world.props.play.damageAmountRef',
    ATTACK_DAMAGE_VALUE as never,
  ) as WorldState);
  const actionCatalog = new ActionCatalog({
    getState: () => harness.holder.getState(),
    exprEngine: harness.exprEngine,
    queryEngine: harness.queryEngine,
    ctxForActor: (actor, bindings) => harness.ctxForSelf(actor, bindings),
    listActionDefs: () => harness.defRegistry.allResolved()
      .filter((definition): definition is ActionDef => definition.kind === 'action') as ActionDef[],
  });
  const runtime: CoreMechanicsLoadOptions['runtime'] = {
    registry: harness.registry,
    defRegistry: harness.defRegistry,
    ruleProvider: harness.ruleProvider,
    playpackLoader: harness.playpackLoader,
    holder: harness.holder,
    queryActions: (actorRef: { $: string }, mode: 'ui' | 'ai') => actionCatalog.queryActions(actorRef, mode),
  };
  const load = loadCoreMechanics({ runtime, config: officialCoreMechanicsConfig(), playpack });
  return { load, harness };
}

describe('规则挂载统一契约（P4：官方包与 UGC 包走同一条 playpack.rules 挂载路径）', () => {
  beforeEach(() => resetIdCounters());

  it('① 官方包声明 rules 引用，且集合恰为 CORE_MECHANICS_RULES 的 id 集', () => {
    expect(CoreMechanicsPlaypack.rules).toBeDefined();
    expect([...(CoreMechanicsPlaypack.rules ?? [])].sort())
      .toEqual([...CORE_MECHANICS_RULES.map((rule) => rule.id)].sort());
  });

  it('② 默认装载路径挂载的规则集 = 官方包声明的 rules 引用集', () => {
    const { load, harness } = createRuntimeAndLoad();
    expect(load.ok).toBe(true);
    expect([...harness.ruleProvider.allRuleIds()].sort())
      .toEqual([...(CoreMechanicsPlaypack.rules ?? [])].sort());
  });

  it('③ 显式注入官方包与默认路径挂载面一致（同一份声明的两条装载路径地位等价）', () => {
    const explicit = createRuntimeAndLoad(CoreMechanicsPlaypack);
    const implicit = createRuntimeAndLoad();
    expect(explicit.load.ok).toBe(true);
    expect(implicit.load.ok).toBe(true);
    expect([...explicit.harness.ruleProvider.allRuleIds()].sort())
      .toEqual([...implicit.harness.ruleProvider.allRuleIds()].sort());
    // 诊断面一致：同 config、同包声明 → 两条路径零差异。
    expect(explicit.load.diagnostics.map((d) => d.code)).toEqual(implicit.load.diagnostics.map((d) => d.code));
  });

  it('④ 每个 rules 引用在 defs 内都解析到 kind===\'rule\' 的定义', () => {
    const { load, harness } = createRuntimeAndLoad();
    expect(load.ok).toBe(true);
    for (const ruleId of CoreMechanicsPlaypack.rules ?? []) {
      const definition = harness.defRegistry.resolve(ruleId);
      expect(definition?.kind, `${ruleId} 解析为 RuleDef`).toBe('rule');
    }
  });

  it('⑤ 无 rules 声明的包不挂任何规则（引用缺失时装载仍成功、规则面为空）', () => {
    const barePack: PlaypackDef = {
      id: 'playpack:play.bare-no-rules',
      kind: 'playpack',
      version: '1.0.0',
      defs: [],
    };
    const { load, harness } = createRuntimeAndLoad(barePack);
    expect(load.ok).toBe(true);
    expect(harness.ruleProvider.allRuleIds()).toEqual([]);
  });
});

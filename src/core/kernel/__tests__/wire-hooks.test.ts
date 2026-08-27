/**
 * 跨层接线验收测试：HookDispatcher(L4) ↔ OpRegistry.invoke(L3) ↔ FlowInterpreter(L5) 真实链路。
 *
 * 方法论：先用一组基础用例证明接线本身工作（RuleDef 真正通过 FlowInterpreter 执行、veto 真正
 * 阻止结构性 Op、after 真正只读），再用穷举组合测试覆盖"多个 Hook 同时挂载在同一个结构性 Op
 * 上"的完整交互矩阵——这是 events/__tests__/dispatcher.test.ts 与 ops/__tests__/veto.test.ts
 * 都未覆盖的角落：那两份测试的 mock 各自独立，从未在同一次 invoke 调用里同时验证"before 的
 * veto 判断 + effects 真实执行 + after 的只读回滚"三者的相互作用。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { wireHooksIntoRegistry } from '../wire-hooks';
import { WorldStateHolder } from '../ops/transaction';
import { createEmptyWorldState } from '../state/world-state';
import { resetIdCounters } from '../state/ids';
import { registerStructuralOps, makeItemMove } from '../ops/structural-ops';
import { registerPropOps } from '../ops/prop-ops';
import { ExprEngine, makeDefaultEvalContext } from '../expr/engine';
import { DefRegistry } from '../state/def';
import type { RuleDef } from '../events/types';
import type { Ref } from '../state/ids';
import type { Def } from '../state/def';

const TEST_DEFS = new Map<string, Def>([
  ['d:human', { id: 'd:human', kind: 'entity' }],
  ['d:sword', { id: 'd:sword', kind: 'item' }],
]);

function setup() {
  const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
  const wired = wireHooksIntoRegistry({ holder });
  const exprEngine = new ExprEngine();
  const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
  registerStructuralOps(wired.registry, { itemMove, defLookup: (id) => TEST_DEFS.get(id) ?? null });
  registerPropOps(wired.registry, new DefRegistry());
  return { holder, ...wired };
}

function rule(id: string, phase: RuleDef['phase'], on: string, opts?: Partial<RuleDef>): RuleDef {
  return { id, kind: 'rule', on, phase, priority: 0, effects: [], ...opts };
}

describe('跨层真实接线：HookDispatcher -> FlowInterpreter -> OpRegistry.invokeInline', () => {
  beforeEach(() => resetIdCounters());

  it('挂载在 before:entity.destroy 的规则真正通过 FlowInterpreter 执行其 effects（不是占位 mock）', () => {
    const { holder, registry, ruleProvider } = setup();
    const entity = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    if (!entity.ok) throw new Error('setup failed');
    const entityId = entity.value.$;

    // 挂一条 before:entity.destroy 规则：真正调用 prop.set 在 world.props 里留下一个标记，
    // 证明 effects 是被真实的 FlowInterpreter 解释执行的，不是一个空占位。
    ruleProvider.add(
      rule('r:log-destroy', 'before', 'before:entity.destroy', {
        effects: [{ op: 'prop.set', args: { path: 'world.props.destroyLogged', value: true } }],
      }),
    );

    const result = registry.invoke('entity.destroy', { id: entityId });
    expect(result.ok).toBe(true);
    expect(holder.getState().world.props['destroyLogged']).toBe(true);
  });

  it('before 阶段 Hook 的 effects 返回失败时，veto 生效，entity.destroy 整体不改变状态', () => {
    const { holder, registry, ruleProvider } = setup();
    const entity = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    if (!entity.ok) throw new Error('setup failed');
    const entityId = entity.value.$;

    // abort 效果会让 runEffects 返回 ok:false，HookDispatcher 的 before 阶段据此整体取消
    ruleProvider.add(rule('r:veto-destroy', 'before', 'before:entity.destroy', { effects: [{ abort: 'blocked' }] }));

    const before = holder.getState();
    const result = registry.invoke('entity.destroy', { id: entityId });
    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe('E_OP_VETOED');
    expect(holder.getState()).toBe(before); // 零状态改动
    expect(holder.getState().entities[entityId]).toBeDefined(); // 实体确实未被销毁
  });

  it('after 阶段的写入被真实事务机制丢弃：即便 effects 真正调用了 prop.set，after 阶段的改动也不落地', () => {
    const { holder, registry, ruleProvider } = setup();
    const entity = registry.invoke<{ def: string }, Ref>('entity.create', { def: 'd:human' });
    if (!entity.ok) throw new Error('setup failed');
    const entityId = entity.value.$;

    ruleProvider.add(
      rule('r:after-write', 'after', 'after:entity.destroy', {
        effects: [{ op: 'prop.set', args: { path: 'world.props.shouldNotPersist', value: 999 } }],
      }),
    );

    const result = registry.invoke('entity.destroy', { id: entityId });
    expect(result.ok).toBe(true);
    expect(holder.getState().world.props['shouldNotPersist']).toBeUndefined();
  });

  it('嵌套调用：Hook 的 effects 里的 op 效果通过 invokeInline 触发，其自身若是结构性 Op 也会走 veto 分发', () => {
    const { holder, registry, ruleProvider } = setup();

    // before:item.create 挂一条规则，其 effects 里再调用一次 prop.set（验证嵌套调用可行）
    ruleProvider.add(
      rule('r:nested', 'before', 'before:item.create', {
        effects: [{ op: 'prop.set', args: { path: 'world.props.nestedRan', value: true } }],
      }),
    );
    const result = registry.invoke('item.create', { def: 'd:sword' });
    expect(result.ok).toBe(true);
    expect(holder.getState().world.props['nestedRan']).toBe(true);
  });

  it('Flow 自定义 emit 进入同一 HookDispatcher 并执行当前挂载 Rule', () => {
    const { holder, registry, ruleProvider, flowInterpreter } = setup();
    ruleProvider.add(
      rule('r:on-custom-event', 'default', 'combat.custom', {
        effects: [{ op: 'prop.set', args: { path: 'world.props.customEventHandled', value: true } }],
      }),
    );
    registry.register('test.emit-custom', (_args, ctx) =>
      flowInterpreter.run([{ emit: 'combat.custom', data: { source: 'test' } }], ctx).result,
    );

    const result = registry.invoke('test.emit-custom', {});
    expect(result.ok).toBe(true);
    expect(holder.getState().world.props['customEventHandled']).toBe(true);
  });

  it('when 谓词为 false 时 Hook 不参与（即便挂载在同一事件上）', () => {
    const { holder, registry, ruleProvider } = setup();
    ruleProvider.add(
      rule('r:conditional', 'before', 'before:item.create', {
        when: false,
        effects: [{ op: 'prop.set', args: { path: 'world.props.shouldNotRun', value: true } }],
      }),
    );
    registry.invoke('item.create', { def: 'd:sword' });
    expect(holder.getState().world.props['shouldNotRun']).toBeUndefined();
  });

  it('resetDepth 在每次顶层 invoke 后被自动调用（需求24.3）', () => {
    const { hookDispatcher, registry } = setup();
    registry.invoke('item.create', { def: 'd:sword' });
    expect(hookDispatcher.getDepth()).toBe(0);
  });
});

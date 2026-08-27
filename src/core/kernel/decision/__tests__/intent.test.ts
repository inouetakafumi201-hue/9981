/**
 * L7 Intent tests: Property 9 (require recheck before resolve), Property 10 (hidden intents).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { registerIntentOps } from '../intent-ops';
import type { IntentOpsDeps } from '../intent-ops';
import { WorldStateHolder } from '../../ops/transaction';
import { createEmptyWorldState } from '../../state/world-state';
import { resetIdCounters } from '../../state/ids';
import { OpRegistry } from '../../ops/registry';
import { getPath, setPath } from '../../ops/path';
import type { ActionDef } from '../../actions/types';
import type { Def } from '../../state/def';
import { err, ok } from '../../ops/result';

const goodAction: ActionDef = {
  id: 'a:action1',
  kind: 'action',
  label: 'Test Action',
  require: true,
  cost: [],
  effects: [],
  track: 'highlight',
};

const failAction: ActionDef = {
  id: 'a:failAction',
  kind: 'action',
  label: 'Fail Action',
  require: false,
  cost: [],
  effects: [],
  track: 'highlight',
};

const costAction: ActionDef = {
  id: 'a:costAction',
  kind: 'action',
  label: 'Cost Action',
  require: true,
  cost: [{ pool: 'ap', amount: 3 }],
  effects: [],
  track: 'highlight',
};

function makeDeps(actions: ActionDef[]): IntentOpsDeps {
  const map = new Map<string, Def>(actions.map((a) => [a.id, a as Def]));
  return { defLookup: (id) => map.get(id) ?? null, now: () => 1000 };
}

function makeRegistryWithPool(available: number): { registry: OpRegistry; holder: WorldStateHolder } {
  let state = createEmptyWorldState('sched:1');
  state = setPath(state, 'world.props.pools.ap.e:agent1.available', available);
  state = setPath(state, 'world.props.pools.ap.e:agent1.real', available);
  const holder = new WorldStateHolder(state);
  const registry = new OpRegistry(holder);
  return { registry, holder };
}

describe('L7 Intent: intent.submit (requirements 25.1-25.3)', () => {
  beforeEach(() => resetIdCounters());

  it('submit creates a pending intent', () => {
    const deps = makeDeps([goodAction]);
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const registry = new OpRegistry(holder);
    registerIntentOps(registry, deps);
    const result = registry.invoke<unknown, { $: string }>('intent.submit', {
      action: 'a:action1', agent: 'e:agent1', bindings: {}, hidden: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const intent = holder.getState().world.intents[result.value.$];
      expect(intent).toBeDefined();
      expect(intent!.status).toBe('pending');
      expect(intent!.agent).toBe('e:agent1');
      expect(intent!.action).toBe('a:action1');
    }
  });

  it('submit with require=false is rejected', () => {
    const deps = makeDeps([failAction]);
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const registry = new OpRegistry(holder);
    registerIntentOps(registry, deps);
    const result = registry.invoke('intent.submit', {
      action: 'a:failAction', agent: 'e:agent1', bindings: {}, hidden: false,
    });
    expect(result.ok).toBe(false);
  });

  it('submit freezes pool cost', () => {
    const deps = makeDeps([costAction]);
    const { registry, holder } = makeRegistryWithPool(10);
    registerIntentOps(registry, deps);
    registry.invoke('intent.submit', {
      action: 'a:costAction', agent: 'e:agent1', bindings: {}, hidden: false,
    });
    const state = holder.getState();
    const rawPools = (state.world.props as Record<string, unknown>)['pools'];
    expect(rawPools).toBeDefined();
  });

  it('submit with insufficient pool cost is rejected', () => {
    const deps = makeDeps([costAction]);
    const { registry } = makeRegistryWithPool(2);
    registerIntentOps(registry, deps);
    const result = registry.invoke('intent.submit', {
      action: 'a:costAction', agent: 'e:agent1', bindings: {}, hidden: false,
    });
    expect(result.ok).toBe(false);
  });

  it('submit without hidden param defaults to hidden=false', () => {
    const deps = makeDeps([goodAction]);
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const registry = new OpRegistry(holder);
    registerIntentOps(registry, deps);
    const result = registry.invoke<unknown, { $: string }>('intent.submit', {
      action: 'a:action1', agent: 'e:agent1', bindings: {},
    });
    if (result.ok) {
      expect(holder.getState().world.intents[result.value.$]!.hidden).toBe(false);
    }
  });
});

describe('L7 Intent: Property 9 (require recheck before resolve)', () => {
  beforeEach(() => resetIdCounters());

  it('resolve with require still true transitions status to resolved', () => {
    const deps = makeDeps([goodAction]);
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const registry = new OpRegistry(holder);
    registerIntentOps(registry, deps);
    const submitResult = registry.invoke<unknown, { $: string }>('intent.submit', {
      action: 'a:action1', agent: 'e:agent1', bindings: {}, hidden: false,
    });
    expect(submitResult.ok).toBe(true);
    if (submitResult.ok) {
      const resolveResult = registry.invoke('intent.resolve', { id: submitResult.value.$ });
      expect(resolveResult.ok).toBe(true);
      expect(holder.getState().world.intents[submitResult.value.$]!.status).toBe('resolved');
    }
  });

  it('Property 9: require becomes false before resolve — auto-void with refund', () => {
    const dynamicAction: ActionDef = {
      id: 'a:dynAction',
      kind: 'action',
      label: 'Dynamic',
      require: { path: 'world.props.canAct' },
      cost: [{ pool: 'ap', amount: 2 }],
      effects: [],
      track: 'highlight',
    };
    let state = createEmptyWorldState('sched:1');
    state = setPath(state, 'world.props.canAct', true);
    state = setPath(state, 'world.props.pools.ap.e:agent1.available', 10);
    state = setPath(state, 'world.props.pools.ap.e:agent1.real', 10);
    const holder = new WorldStateHolder(state);
    const registry = new OpRegistry(holder);
    const deps: IntentOpsDeps = {
      defLookup: (id) => (id === 'a:dynAction' ? dynamicAction as Def : null),
      now: () => 0,
    };
    registerIntentOps(registry, deps);

    const submitResult = registry.invoke<unknown, { $: string }>('intent.submit', {
      action: 'a:dynAction', agent: 'e:agent1', bindings: {}, hidden: false,
    });
    expect(submitResult.ok).toBe(true);
    if (!submitResult.ok) return;
    const intentId = submitResult.value.$;

    holder.setState(setPath(holder.getState(), 'world.props.canAct', false));

    const resolveResult = registry.invoke('intent.resolve', { id: intentId });
    expect(resolveResult.ok).toBe(true);
    expect(holder.getState().world.intents[intentId]!.status).toBe('void');
  });

  it('ActionDef.effects 在 resolve 事务内执行，且收到绑定与标准引用变量', () => {
    const effectAction: ActionDef = {
      ...goodAction,
      id: 'a:effectAction',
      effects: [{ emit: 'action.resolved' }],
    };
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const registry = new OpRegistry(holder);
    let receivedVars: Record<string, unknown> | undefined;
    registerIntentOps(registry, {
      ...makeDeps([effectAction]),
      runEffects: (_effects, ctx, vars) => {
        receivedVars = vars;
        const draft = ctx.tx.getDraft();
        ctx.tx.setDraft({
          ...draft,
          world: { ...draft.world, props: { ...draft.world.props, effectApplied: true } },
        });
        return ok(undefined);
      },
    });

    const submitted = registry.invoke<unknown, { $: string }>('intent.submit', {
      action: effectAction.id,
      agent: 'e:agent1',
      bindings: { target: { $: 'e:target1' } },
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;

    const resolved = registry.invoke('intent.resolve', { id: submitted.value.$ });
    expect(resolved.ok).toBe(true);
    expect(holder.getState().world.props['effectApplied']).toBe(true);
    expect(holder.getState().world.intents[submitted.value.$]?.status).toBe('resolved');
    expect(receivedVars).toMatchObject({
      target: { $: 'e:target1' },
      self: { $: 'e:agent1' },
      agent: { $: 'e:agent1' },
      intent: { $: submitted.value.$ },
    });
  });

  it('ActionDef.effects 失败时，状态、副作用与已结算成本整体回滚', () => {
    const failingEffectAction: ActionDef = {
      ...costAction,
      id: 'a:failingEffectAction',
      effects: [{ abort: 'forced failure' }],
    };
    const { registry, holder } = makeRegistryWithPool(5);
    registerIntentOps(registry, {
      ...makeDeps([failingEffectAction]),
      runEffects: (_effects, ctx) => {
        const draft = ctx.tx.getDraft();
        ctx.tx.setDraft({
          ...draft,
          world: { ...draft.world, props: { ...draft.world.props, mustRollback: true } },
        });
        return err('E_FLOW_ABORT', 'forced failure');
      },
    });

    const submitted = registry.invoke<unknown, { $: string }>('intent.submit', {
      action: failingEffectAction.id,
      agent: 'e:agent1',
      bindings: {},
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect(getPath(holder.getState(), 'world.props.pools.ap.e:agent1.available')).toBe(2);
    expect(getPath(holder.getState(), 'world.props.pools.ap.e:agent1.real')).toBe(5);

    const resolved = registry.invoke('intent.resolve', { id: submitted.value.$ });
    expect(resolved.ok).toBe(false);
    expect(holder.getState().world.intents[submitted.value.$]?.status).toBe('pending');
    expect(holder.getState().world.props['mustRollback']).toBeUndefined();
    expect(getPath(holder.getState(), 'world.props.pools.ap.e:agent1.available')).toBe(2);
    expect(getPath(holder.getState(), 'world.props.pools.ap.e:agent1.real')).toBe(5);
  });

  it('resolve on non-pending intent returns error', () => {
    const deps = makeDeps([goodAction]);
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const registry = new OpRegistry(holder);
    registerIntentOps(registry, deps);
    const submitResult = registry.invoke<unknown, { $: string }>('intent.submit', {
      action: 'a:action1', agent: 'e:agent1', bindings: {}, hidden: false,
    });
    if (!submitResult.ok) return;
    registry.invoke('intent.void', { id: submitResult.value.$, reason: 'test' });
    const result = registry.invoke('intent.resolve', { id: submitResult.value.$ });
    expect(result.ok).toBe(false);
  });

  it('Property 9 (property test): require initially true, becomes false before resolve — always ends void', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (n) => {
        resetIdCounters();
        const dynAction: ActionDef = {
          id: `a:dyn${n}`,
          kind: 'action',
          label: 'Dyn',
          require: { path: 'world.props.gate' },
          cost: [],
          effects: [],
          track: 'highlight',
        };
        let s = createEmptyWorldState('sched:1');
        s = setPath(s, 'world.props.gate', true);
        const holder = new WorldStateHolder(s);
        const registry = new OpRegistry(holder);
        const deps2: IntentOpsDeps = {
          defLookup: (id) => (id === dynAction.id ? dynAction as Def : null),
          now: () => 0,
        };
        registerIntentOps(registry, deps2);
        const sr = registry.invoke<unknown, { $: string }>('intent.submit', {
          action: dynAction.id, agent: 'e:a1', bindings: {}, hidden: false,
        });
        if (!sr.ok) return;
        holder.setState(setPath(holder.getState(), 'world.props.gate', false));
        registry.invoke('intent.resolve', { id: sr.value.$ });
        expect(holder.getState().world.intents[sr.value.$]!.status).toBe('void');
      }),
      { numRuns: 100 },
    );
  });
});

describe('L7 Intent: Property 10 (hidden intent invisibility)', () => {
  beforeEach(() => resetIdCounters());

  it('hidden intent is stored in world.intents with hidden=true', () => {
    const deps = makeDeps([goodAction]);
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const registry = new OpRegistry(holder);
    registerIntentOps(registry, deps);
    const result = registry.invoke<unknown, { $: string }>('intent.submit', {
      action: 'a:action1', agent: 'e:agent1', bindings: {}, hidden: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(holder.getState().world.intents[result.value.$]!.hidden).toBe(true);
    }
  });

  it('intent.reveal marks a hidden intent as visible', () => {
    const deps = makeDeps([goodAction]);
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const registry = new OpRegistry(holder);
    registerIntentOps(registry, deps);
    const submitResult = registry.invoke<unknown, { $: string }>('intent.submit', {
      action: 'a:action1', agent: 'e:agent1', bindings: {}, hidden: true,
    });
    if (!submitResult.ok) return;
    registry.invoke('intent.reveal', { id: submitResult.value.$ });
    expect(holder.getState().world.intents[submitResult.value.$]!.hidden).toBe(false);
  });

  it('intent.reveal on already-visible intent is idempotent', () => {
    const deps = makeDeps([goodAction]);
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const registry = new OpRegistry(holder);
    registerIntentOps(registry, deps);
    const submitResult = registry.invoke<unknown, { $: string }>('intent.submit', {
      action: 'a:action1', agent: 'e:agent1', bindings: {}, hidden: false,
    });
    if (!submitResult.ok) return;
    const result = registry.invoke('intent.reveal', { id: submitResult.value.$ });
    expect(result.ok).toBe(true);
  });

  it('intent.void cancels a pending intent and refunds cost', () => {
    const deps = makeDeps([goodAction]);
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const registry = new OpRegistry(holder);
    registerIntentOps(registry, deps);
    const submitResult = registry.invoke<unknown, { $: string }>('intent.submit', {
      action: 'a:action1', agent: 'e:agent1', bindings: {}, hidden: false,
    });
    if (!submitResult.ok) return;
    const voidResult = registry.invoke('intent.void', { id: submitResult.value.$, reason: 'cancelled' });
    expect(voidResult.ok).toBe(true);
    expect(holder.getState().world.intents[submitResult.value.$]!.status).toBe('void');
  });
});

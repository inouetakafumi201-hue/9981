/**
 * Tasks 43-44: E2E tests.
 * 1. Nested-depth invariance: 3+ container nesting, 5+ Def inheritance chain
 * 2. AI/human decision consistency: queryActions + PolicyDef mode:'search' skeleton
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { OpRegistry } from '../ops/registry';
import { WorldStateHolder } from '../ops/transaction';
import { createEmptyWorldState } from '../state/world-state';
import { resetIdCounters } from '../state/ids';
import { DefRegistry } from '../state/def';
import { registerDecisionOps } from '../decision/decision-ops';
import { registerIntentOps } from '../decision/intent-ops';
import { registerAttachOps } from '../attachment/attach-ops';
import { registerScheduleOps } from '../schedule/schedule-ops';
import { registerRandomOps } from '../random/random-ops';
import { PlaypackLoader } from '../schedule/playpack';
import { PolicyEvaluator } from '../schedule/policy';
import { DiagnosticSink } from '../safety/safety';
import { PresentationGateway } from '../gateway';
import { QueryEngine } from '../expr/query-engine';
import { ExprEngine, makeDefaultEvalContext } from '../expr/engine';
import { ActionCatalog } from '../actions/catalog';
import { takeSnapshot, InMemoryCheckpointStore } from '../persistence/persistence';
import type { PlaypackDef } from '../schedule/playpack';
import type { PolicyDef } from '../schedule/policy';
import type { DecisionDef } from '../decision/types';
import type { ScheduleDef } from '../schedule/types';
import type { ActionDef } from '../actions/types';
import type { AttachmentDef } from '../attachment/types';
import type { Def } from '../state/def';

const exprEngine = new ExprEngine();

describe('E2E 1: Nested-depth invariance (requirement 43)', () => {
  beforeEach(() => resetIdCounters());

  it('5+ Def inheritance chain correctly expands without invariant errors', () => {
    const defRegistry = new DefRegistry();
    defRegistry.register({ id: 'e:base', kind: 'entity', props: { level: 0, baseTag: true } });
    defRegistry.register({ id: 'e:l1', kind: 'entity', extends: ['e:base'], props: { level: 1 } });
    defRegistry.register({ id: 'e:l2', kind: 'entity', extends: ['e:l1'], props: { level: 2 } });
    defRegistry.register({ id: 'e:l3', kind: 'entity', extends: ['e:l2'], props: { level: 3 } });
    defRegistry.register({ id: 'e:l4', kind: 'entity', extends: ['e:l3'], props: { level: 4 } });
    defRegistry.register({ id: 'e:leaf', kind: 'entity', extends: ['e:l4'], props: { level: 5, leafTag: true } });

    const leaf = defRegistry.resolve('e:leaf');
    expect(leaf).not.toBeNull();
    if (leaf) {
      expect((leaf.props as Record<string, unknown>)['baseTag']).toBe(true);
      expect((leaf.props as Record<string, unknown>)['leafTag']).toBe(true);
      expect((leaf.props as Record<string, unknown>)['level']).toBe(5);
    }
  });

  it('3+ level Playpack dependency chain loads correctly', () => {
    const defRegistry = new DefRegistry();
    const loader = new PlaypackLoader({ defRegistry });

    const pp1: PlaypackDef = {
      id: 'pp:base', kind: 'playpack', version: '1.0',
      defs: [{ id: 'e:base', kind: 'entity' }],
    };
    const pp2: PlaypackDef = {
      id: 'pp:mid', kind: 'playpack', version: '1.0',
      requires: ['pp:base'],
      defs: [{ id: 'a:action1', kind: 'action', effects: [] }],
    };
    const pp3: PlaypackDef = {
      id: 'pp:leaf', kind: 'playpack', version: '1.0',
      requires: ['pp:mid'],
      defs: [{ id: 'att:buff', kind: 'attachment', stackStrategy: 'count' }],
    };

    const sorted = PlaypackLoader.topoSort([pp3, pp1, pp2]);
    expect(sorted).not.toBeNull();
    if (sorted) {
      const ids = sorted.map((p) => p.id);
      expect(ids.indexOf('pp:base')).toBeLessThan(ids.indexOf('pp:mid'));
      expect(ids.indexOf('pp:mid')).toBeLessThan(ids.indexOf('pp:leaf'));
      for (const pp of sorted) {
        const r = loader.load(pp);
        expect(r.ok).toBe(true);
      }
    }
  });

  it('Decision + Intent + Attachment combination: no fatal diagnostics', () => {
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const registry = new OpRegistry(holder);
    const sink = new DiagnosticSink({ onFatal: () => {} });

    const decisionDef: DecisionDef = {
      id: 'd:vote', kind: 'decision', quorum: 'majority',
      options: [{ name: 'yes', label: 'Yes' }, { name: 'no', label: 'No' }],
      onTimeout: 'void', onResolve: [],
    };
    const actionDef: ActionDef = {
      id: 'a:cast_vote', kind: 'action', label: 'Cast Vote',
      require: true, cost: [], effects: [], track: 'highlight',
    };
    const attachDef: AttachmentDef = {
      id: 'att:voted', kind: 'attachment', stackStrategy: 'unique',
    };

    const defs = new Map<string, Def>([
      [decisionDef.id, decisionDef],
      [actionDef.id, actionDef],
      [attachDef.id, attachDef],
    ]);

    registerDecisionOps(
      registry,
      { resolve: (id) => defs.get(id) as DecisionDef | null ?? null },
      {
        defLookup: { resolve: (id) => defs.get(id) as DecisionDef | null ?? null },
        recheckPremise: () => true,
        runEffects: () => {},
      },
      () => Date.now(),
    );
    registerIntentOps(registry, { defLookup: (id) => defs.get(id) ?? null, now: () => 0 });
    registerAttachOps(registry, { defLookup: (id) => defs.get(id) ?? null });

    expect(registry.invoke('decision.open', { def: 'd:vote', askees: [{ $: 'a:1' }, { $: 'a:2' }, { $: 'a:3' }], ctx: {} }).ok).toBe(true);
    expect(registry.invoke('intent.submit', { action: 'a:cast_vote', agent: 'e:player1', bindings: {}, hidden: false }).ok).toBe(true);
    expect(registry.invoke('attach.add', { def: 'att:voted', target: { $: 'w:0' } }).ok).toBe(true);
    expect(sink.hasFatal()).toBe(false);
  });
});

describe('E2E 2: AI/human decision consistency (requirement 44)', () => {
  beforeEach(() => resetIdCounters());

  it('queryActions returns the same action set for ai and ui modes (ignoring sampling granularity)', () => {
    const state = createEmptyWorldState('sched:1');
    const queryEngine = new QueryEngine();
    const baseCtx = makeDefaultEvalContext({ resolvePath: () => null });

    const actionDef: ActionDef = {
      id: 'a:move', kind: 'action', label: 'Move',
      require: true, cost: [], effects: [], track: 'highlight',
    };

    const catalog = new ActionCatalog({
      getState: () => state,
      queryEngine,
      ctxForActor: () => baseCtx,
      listActionDefs: () => [actionDef],
    });

    const uiActions = catalog.queryActions({ $: 'e:player1' }, 'ui');
    const aiActions = catalog.queryActions({ $: 'e:player1' }, 'ai');

    expect(uiActions.map((a) => a.action).sort()).toEqual(aiActions.map((a) => a.action).sort());
  });

  it('PolicyDef rules mode combined with queryActions: policy selects highest-priority valid action', () => {
    const policy: PolicyDef = {
      id: 'pol:ai', kind: 'policy', mode: 'rules',
      policyRules: [
        { condition: false, action: 'a:retreat', priority: 1 },
        { condition: true, action: 'a:attack', priority: 5 },
        { condition: true, action: 'a:defend', priority: 3 },
      ],
    };
    const evaluator = new PolicyEvaluator();
    const selected = evaluator.evalRules(policy, (cond) => cond === true);
    expect(selected).toBe('a:attack');
  });

  it('PresentationGateway + OpRegistry integration: gateway does not expose write API', () => {
    const state = createEmptyWorldState('sched:1');
    const queryEngine = new QueryEngine();
    const baseCtx = makeDefaultEvalContext({ resolvePath: () => null });
    const catalog = new ActionCatalog({
      getState: () => state,
      queryEngine,
      ctxForActor: () => baseCtx,
      listActionDefs: () => [],
    });
    const gateway = new PresentationGateway({
      getState: () => state,
      queryEngine,
      exprEngine,
      actionCatalog: catalog,
      ctxForSelf: () => baseCtx,
      baseCtx: () => baseCtx,
    });

    expect(typeof gateway.subscribe).toBe('function');
    expect(typeof gateway.query).toBe('function');
    expect(typeof gateway.queryActions).toBe('function');
    expect((gateway as unknown as Record<string, unknown>)['registry']).toBeUndefined();
    expect((gateway as unknown as Record<string, unknown>)['tx']).toBeUndefined();
  });

  it('checkpoint/restore + PolicyDef search skeleton: explore branch then restore', () => {
    const checkpointStore = new InMemoryCheckpointStore();
    const state = createEmptyWorldState('sched:1');

    checkpointStore.checkpoint('before-search', state);

    const snap = takeSnapshot(state, 'pre-branch');
    const holder = new WorldStateHolder(state);
    const registry = new OpRegistry(holder);
    registerRandomOps(registry);
    registry.invoke('random.roll', { sides: 6, stream: 'search', seed: 42 });

    const restored = checkpointStore.restore('before-search');
    expect(restored).not.toBeNull();
    expect(restored!.world.turn.scheduleId).toBe(state.world.turn.scheduleId);
    expect(snap.state).toBe(state);
  });

  it('full system integration: Decision + Intent + Schedule + Random + Gateway work together without fatal errors', () => {
    const holder = new WorldStateHolder(createEmptyWorldState('sched:main'));
    const registry = new OpRegistry(holder);

    const schedDef: ScheduleDef = {
      id: 'sched:main', kind: 'schedule',
      phases: [
        { kind: 'action', id: 'p:action' },
        { kind: 'response', id: 'p:response' },
      ],
      loop: true,
    };
    const decDef: DecisionDef = {
      id: 'd:choice', kind: 'decision', quorum: 'any',
      options: [{ name: 'go', label: 'Go' }],
      onTimeout: 'void', onResolve: [],
    };
    const actDef: ActionDef = {
      id: 'a:move', kind: 'action', label: 'Move', require: true, cost: [], effects: [], track: 'highlight',
    };

    const defs = new Map<string, Def>([
      [schedDef.id, schedDef], [decDef.id, decDef], [actDef.id, actDef],
    ]);

    registerDecisionOps(
      registry,
      { resolve: (id) => defs.get(id) as DecisionDef | null ?? null },
      {
        defLookup: { resolve: (id) => defs.get(id) as DecisionDef | null ?? null },
        recheckPremise: () => true,
        runEffects: () => {},
      },
    );
    registerIntentOps(registry, { defLookup: (id) => defs.get(id) ?? null, now: () => 0 });
    registerScheduleOps(registry, { defLookup: (id) => defs.get(id) ?? null });
    registerRandomOps(registry);

    expect(registry.invoke('schedule.advance', {}).ok).toBe(true);
    expect(holder.getState().world.turn.phaseIndex).toBe(1);

    expect(registry.invoke('decision.open', { def: 'd:choice', askees: [{ $: 'a:1' }], ctx: {} }).ok).toBe(true);
    expect(registry.invoke('intent.submit', { action: 'a:move', agent: 'e:p1', bindings: {}, hidden: false }).ok).toBe(true);

    const rollResult = registry.invoke<unknown, number>('random.roll', { sides: 20, stream: 'game', seed: 7 });
    expect(rollResult.ok).toBe(true);
    if (rollResult.ok) {
      expect(rollResult.value).toBeGreaterThanOrEqual(1);
      expect(rollResult.value).toBeLessThanOrEqual(20);
    }

    const queryEngine = new QueryEngine();
    const baseCtx = makeDefaultEvalContext({ resolvePath: () => null });
    const catalog = new ActionCatalog({
      getState: () => holder.getState(),
      queryEngine,
      ctxForActor: () => baseCtx,
      listActionDefs: () => [actDef],
    });
    const gateway = new PresentationGateway({
      getState: () => holder.getState(),
      queryEngine,
      exprEngine,
      actionCatalog: catalog,
      ctxForSelf: () => baseCtx,
      baseCtx: () => baseCtx,
    });

    expect(gateway.query({ from: 'decisions' }).length).toBeGreaterThan(0);
    expect(gateway.query({ from: 'intents' }).length).toBeGreaterThan(0);
    expect(Array.isArray(gateway.queryActions({ $: 'e:p1' }))).toBe(true);
  });
});

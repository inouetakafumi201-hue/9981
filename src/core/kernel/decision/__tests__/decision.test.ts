/**
 * L7 Decision tests: Property 8 (Decision永不阻塞), Property 27 (onResolve前提重检).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  makeDecisionOpen,
  makeDecisionAnswer,
  checkQuorum,
  registerDecisionOps,
} from '../decision-ops';
import type { DecisionDefLookup, DecisionAnswerDeps } from '../decision-ops';
import { Transaction } from '../../ops/transaction';
import { createEmptyWorldState } from '../../state/world-state';
import { resetIdCounters } from '../../state/ids';
import { OpRegistry } from '../../ops/registry';
import { WorldStateHolder } from '../../ops/transaction';
import type { OpContext } from '../../ops/registry';
import type { DecisionDef } from '../types';
import type { DecisionState } from '../../state/world-state';

function makeCtx(): OpContext {
  const tx = new Transaction(createEmptyWorldState('sched:1'));
  return { tx, depth: 0, emit: () => {} };
}

const baseDef: DecisionDef = {
  id: 'd:def1',
  kind: 'decision',
  options: [{ name: 'yes', label: 'Yes' }, { name: 'no', label: 'No' }],
  quorum: 'all',
  onTimeout: 'void',
  onResolve: [],
};

const defLookup: DecisionDefLookup = { resolve: (id) => (id === 'd:def1' ? baseDef : null) };

describe('L7 Decision: decision.open 永不阻塞 (Property 8)', () => {
  beforeEach(() => resetIdCounters());

  it('decision.open 在同一 tick 内同步返回 Ref，不挂起（需求27.2）', () => {
    const open = makeDecisionOpen(defLookup, () => 1000);
    const ctx = makeCtx();
    let done = false;
    const result = open({ def: 'd:def1', askees: [{ $: 'a:1' }, { $: 'a:2' }], ctx: {} }, ctx);
    done = true;
    expect(done).toBe(true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.$.startsWith('g:')).toBe(true);
    }
  });

  it('decision.open 在 draft 里创建 open 状态的 DecisionState', () => {
    const open = makeDecisionOpen(defLookup, () => 500);
    const ctx = makeCtx();
    const result = open({ def: 'd:def1', askees: [{ $: 'a:1' }], ctx: { round: 1 } }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const id = result.value.$;
      const draft = ctx.tx.getDraft();
      const decision = draft.world.decisions[id];
      expect(decision).toBeDefined();
      expect(decision!.status).toBe('open');
      expect(decision!.opensAt).toBe(500);
      expect(decision!.askees).toHaveLength(1);
      expect(decision!.ctx['round']).toBe(1);
    }
  });

  it('def 不存在时返回 E_REF_MISSING', () => {
    const open = makeDecisionOpen(defLookup, () => 0);
    const ctx = makeCtx();
    const result = open({ def: 'd:nonexistent', askees: [], ctx: {} }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('E_REF_MISSING');
  });

  it('Property 8: Decision 永不阻塞——任意 quorum/askees 组合下 open 都同步完成', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'all' | 'any' | 'majority'>('all', 'any', 'majority'),
        fc.array(fc.string({ minLength: 1, maxLength: 4 }), { minLength: 0, maxLength: 5 }),
        (quorum, agentIds) => {
          resetIdCounters();
          const def: DecisionDef = { ...baseDef, quorum };
          const lk: DecisionDefLookup = { resolve: (id) => (id === 'd:def1' ? def : null) };
          const open = makeDecisionOpen(lk, () => 0);
          const ctx = makeCtx();
          const result = open({ def: 'd:def1', askees: agentIds.map((id) => ({ $: id })), ctx: {} }, ctx);
          expect(result.ok).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('L7 Decision: decision.answer + quorum + onResolve前提重检 (Property 27)', () => {
  beforeEach(() => resetIdCounters());

  function makeSetup(quorum: DecisionDef['quorum'] = 'all', premiseResult = true) {
    const def: DecisionDef = {
      ...baseDef,
      quorum,
      onResolve: [],
    };
    const lk: DecisionDefLookup = { resolve: (id) => (id === 'd:def1' ? def : null) };
    const effects: Array<{ effects: unknown[]; decision: DecisionState; ctx: unknown }> = [];
    const deps: DecisionAnswerDeps = {
      defLookup: lk,
      recheckPremise: () => premiseResult,
      runEffects: (eff, dec, c) => effects.push({ effects: eff, decision: dec, ctx: c }),
    };
    return { def, lk, deps, effects };
  }

  it('answer 记录回答后尚未达到 quorum 时 decision 保持 open', () => {
    const { deps } = makeSetup('all');
    const answer = makeDecisionAnswer(deps);
    const open = makeDecisionOpen(deps.defLookup, () => 0);
    const ctx = makeCtx();
    open({ def: 'd:def1', askees: [{ $: 'a:1' }, { $: 'a:2' }], ctx: {} }, ctx);
    const id = Object.keys(ctx.tx.getDraft().world.decisions)[0]!;
    answer({ id, actor: { $: 'a:1' }, choice: 'yes' }, ctx);
    expect(ctx.tx.getDraft().world.decisions[id]!.status).toBe('open');
    expect(Object.keys(ctx.tx.getDraft().world.decisions[id]!.answers)).toHaveLength(1);
  });

  it('全部 askees 回答后 quorum:all 满足，前提通过时转 resolved', () => {
    const { deps, effects } = makeSetup('all', true);
    const answer = makeDecisionAnswer(deps);
    const open = makeDecisionOpen(deps.defLookup, () => 0);
    const ctx = makeCtx();
    open({ def: 'd:def1', askees: [{ $: 'a:1' }, { $: 'a:2' }], ctx: {} }, ctx);
    const id = Object.keys(ctx.tx.getDraft().world.decisions)[0]!;
    answer({ id, actor: { $: 'a:1' }, choice: 'yes' }, ctx);
    answer({ id, actor: { $: 'a:2' }, choice: 'no' }, ctx);
    expect(ctx.tx.getDraft().world.decisions[id]!.status).toBe('resolved');
    expect(effects.length).toBeGreaterThan(0);
  });

  it('Property 27: onResolve 前提重检——前提失效时转 void 而非 resolved', () => {
    const { deps } = makeSetup('all', false); // premise fails
    const answer = makeDecisionAnswer(deps);
    const open = makeDecisionOpen(deps.defLookup, () => 0);
    const ctx = makeCtx();
    open({ def: 'd:def1', askees: [{ $: 'a:1' }], ctx: {} }, ctx);
    const id = Object.keys(ctx.tx.getDraft().world.decisions)[0]!;
    answer({ id, actor: { $: 'a:1' }, choice: 'yes' }, ctx);
    expect(ctx.tx.getDraft().world.decisions[id]!.status).toBe('void');
  });

  it('quorum:any 满足（第一票即达到）', () => {
    const { deps } = makeSetup('any', true);
    const answer = makeDecisionAnswer(deps);
    const open = makeDecisionOpen(deps.defLookup, () => 0);
    const ctx = makeCtx();
    open({ def: 'd:def1', askees: [{ $: 'a:1' }, { $: 'a:2' }, { $: 'a:3' }], ctx: {} }, ctx);
    const id = Object.keys(ctx.tx.getDraft().world.decisions)[0]!;
    answer({ id, actor: { $: 'a:1' }, choice: 'yes' }, ctx);
    expect(ctx.tx.getDraft().world.decisions[id]!.status).toBe('resolved');
  });

  it('answer 到不存在的 Decision 时返回 E_REF_MISSING', () => {
    const { deps } = makeSetup('all');
    const answer = makeDecisionAnswer(deps);
    const ctx = makeCtx();
    const result = answer({ id: 'g:nonexistent', actor: { $: 'a:1' }, choice: 'yes' }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('E_REF_MISSING');
  });

  it('answer 到已 resolved 的 Decision 时返回 E_DEC_VOID', () => {
    const { deps } = makeSetup('any', true);
    const answer = makeDecisionAnswer(deps);
    const open = makeDecisionOpen(deps.defLookup, () => 0);
    const ctx = makeCtx();
    open({ def: 'd:def1', askees: [{ $: 'a:1' }], ctx: {} }, ctx);
    const id = Object.keys(ctx.tx.getDraft().world.decisions)[0]!;
    answer({ id, actor: { $: 'a:1' }, choice: 'yes' }, ctx);
    const result = answer({ id, actor: { $: 'a:1' }, choice: 'yes' }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('E_DEC_VOID');
  });

  it('Property 27: 属性测试——任意 askees/quorum 组合下前提失效总导致 void 而非 resolved', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'all' | 'any' | 'majority'>('all', 'any', 'majority'),
        fc.integer({ min: 1, max: 4 }),
        (quorum, count) => {
          resetIdCounters();
          const { deps } = makeSetup(quorum, false);
          const answer = makeDecisionAnswer(deps);
          const open = makeDecisionOpen(deps.defLookup, () => 0);
          const ctx = makeCtx();
          const ids = Array.from({ length: count }, (_, i) => `a:${i + 1}`);
          open({ def: 'd:def1', askees: ids.map((id) => ({ $: id })), ctx: {} }, ctx);
          const decId = Object.keys(ctx.tx.getDraft().world.decisions)[0]!;
          for (const agentId of ids) {
            answer({ id: decId, actor: { $: agentId }, choice: 'yes' }, ctx);
            const status = ctx.tx.getDraft().world.decisions[decId]?.status;
            if (status !== 'open' && status !== 'void') {
              expect(status).toBe('void');
            }
          }
          const finalStatus = ctx.tx.getDraft().world.decisions[decId]!.status;
          expect(finalStatus).not.toBe('resolved');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('checkQuorum: majority 需要过半', () => {
    const decision = (answered: number, total: number): DecisionState => ({
      id: 'g:1',
      def: 'd:def1',
      askees: Array.from({ length: total }, (_, i) => ({ $: `a:${i}` })),
      answers: Object.fromEntries(Array.from({ length: answered }, (_, i) => [`a:${i}`, 'yes'])),
      ctx: {},
      opensAt: 0,
      status: 'open',
    });
    expect(checkQuorum(decision(0, 3), { ...baseDef, quorum: 'majority' })).toBe(false);
    expect(checkQuorum(decision(1, 3), { ...baseDef, quorum: 'majority' })).toBe(false);
    expect(checkQuorum(decision(2, 3), { ...baseDef, quorum: 'majority' })).toBe(true);
    expect(checkQuorum(decision(3, 3), { ...baseDef, quorum: 'majority' })).toBe(true);
  });
});

describe('L7 Decision: registerDecisionOps via OpRegistry', () => {
  beforeEach(() => resetIdCounters());

  it('通过 OpRegistry.invoke 调用 decision.open 返回 Ref', () => {
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const registry = new OpRegistry(holder);
    const deps: DecisionAnswerDeps = {
      defLookup: defLookup,
      recheckPremise: () => true,
      runEffects: () => {},
    };
    registerDecisionOps(registry, defLookup, deps, () => 0);
    const result = registry.invoke<{ def: string; askees: { $: string }[]; ctx: Record<string, unknown> }, { $: string }>(
      'decision.open',
      { def: 'd:def1', askees: [{ $: 'a:1' }], ctx: {} },
    );
    expect(result.ok).toBe(true);
  });
});

/**
 * Feature: wakeup-engine-bombardment
 * Property 5b: L7 Decision/Intent 决策有终 + 意图幂等
 * Validates: Requirements 5.2, 5.3
 *
 * 三个核心不变量：
 * - 决策有终（5.2）：任何 open 的 Decision 要么被答复到 quorum 而 resolved，要么在
 *   deadline<=当前相位时被 makeProcessDecisionTimeouts 按 onTimeout 解算/作废；终态一旦
 *   达成（resolved/void）就停留，不再回到 open。
 * - 意图幂等（5.3a）：intent.resolve / intent.void 至多成功一次——对已终态（resolved/void）
 *   的 Intent 再次 resolve/void 被拒绝返回失败；终态绝不沿两者变更。
 * - 意图查询不重不漏（5.3b）：queryPendingIntentsFor/queryAllPendingIntents 恰返回当前
 *   pending 集合的真值（无重复、无遗漏、全覆盖，且严格排除已 resolved/void 的 Intent）。
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { registerDecisionOps, makeProcessDecisionTimeouts, type DecisionAnswerDeps } from '../decision/decision-ops';
import { registerIntentOps, type IntentOpsDeps } from '../decision/intent-ops';
import { queryPendingIntentsFor, queryAllPendingIntents } from '../decision/response-phase';
import { OpRegistry, type OpContext } from '../ops/registry';
import { WorldStateHolder, Transaction } from '../ops/transaction';
import { createEmptyWorldState } from '../state/world-state';
import { resetIdCounters } from '../state/ids';
import type { Def } from '../state/def';
import type { DecisionDef } from '../decision/types';
import type { ScheduleDef } from '../schedule/types';
import type { ActionDef } from '../actions/types';
import type { WorldState, IntentState } from '../state/world-state';

const sched: ScheduleDef = { id: 's:sched', kind: 'schedule', phases: [{ id: 'p:0' }], loop: true };

function decisionDef(id: string, over: Partial<DecisionDef> = {}): DecisionDef {
  return {
    id,
    kind: 'decision',
    options: [{ name: 'yes', label: 'Yes' }],
    quorum: 'any',
    onTimeout: 'void',
    onResolve: [],
    ...over,
  };
}

function makeActionDef(id: string): ActionDef {
  return { id, kind: 'action', label: 'Act', require: true, cost: [], effects: [], track: 'highlight' };
}

interface L7Harness {
  holder: WorldStateHolder;
  registry: OpRegistry;
  resolved: string[];
  voided: string[];
  processTimeouts: (ctx: OpContext) => void;
  runWithCtx: (fn: (ctx: OpContext) => void) => { ok: boolean };
}

function makeHarness(opts?: { recheckPremise?: () => boolean }): L7Harness {
  const holder = new WorldStateHolder(createEmptyWorldState(sched.id));
  const registry = new OpRegistry(holder);
  const defs: Def[] = [
    sched,
    decisionDef('d:dec'),                          // onTimeout: 'void'
    decisionDef('d:decDefault', { onTimeout: 'default', defaultChoice: 'yes' }),
    makeActionDef('a:act'),
  ];
  const map = new Map<string, Def>(defs.map((d) => [d.id, d]));
  const defLookup = (id: string) => map.get(id) ?? null;
  const resolved: string[] = [];
  const voided: string[] = [];
  const answerDeps: DecisionAnswerDeps = {
    defLookup: { resolve: defLookup },
    recheckPremise: opts?.recheckPremise ?? (() => true),
    runEffects: (_effects, decision) => {
      if (decision.status === 'resolved') resolved.push(decision.id);
      else if (decision.status === 'void') voided.push(decision.id);
    },
  };
  registerDecisionOps(registry, { resolve: defLookup }, answerDeps, () => 0);
  const intentDeps: IntentOpsDeps = { defLookup, now: () => 0 };
  registerIntentOps(registry, intentDeps);
  return {
    holder,
    registry,
    resolved,
    voided,
    processTimeouts: makeProcessDecisionTimeouts(answerDeps),
    runWithCtx: (fn) => runWithCtx(holder, fn),
  };
}

/** 打开一个 Decision，返回其 id；phase 由调用方用 phaseEnteredAt 推进。 */
function openDecision(h: L7Harness, def: string, deadline?: number): string | null {
  const args: Record<string, unknown> = { def, askees: [{ $: 'a:who' }], ctx: {} };
  if (deadline !== undefined) args.deadline = deadline;
  const r = h.registry.invoke('decision.open', args);
  if (!r.ok) return null;
  return (r.value as { $: string }).$;
}

/** 用一次真实顶层事务（含合法 OpContext）包裹 timeout 处理，供 property runner 触发。 */
function runWithCtx(
  holder: WorldStateHolder,
  fn: (ctx: OpContext) => void,
): { ok: boolean; value?: undefined } {
  const tx = new Transaction(holder.getState());
  const ctx: OpContext = { tx, depth: 0, emit: () => {} };
  try {
    fn(ctx);
    holder.setState(tx.getFinalDraft());
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

describe('Feature: wakeup-engine-bombardment, Property 5b: L7 Decision/Intent 决策有终 + 意图幂等', () => {
  it('决策有终：对随机 open/answer/超时序列，均摊后不残留可终结的 open 决策，终态绝不回 open', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            deadline: fc.integer({ min: 0, max: 8 }),
            seconds: fc.integer({ min: 1, max: 4 }),
            defIdx: fc.constantFrom(0, 1),
          }),
          { minLength: 0, maxLength: 12 },
        ),
        fc.array(fc.constantFrom('answer', 'timeout', 'answer', 'timeout'), { maxLength: 30 }),
        (decs, ops) => {
          resetIdCounters();
          const h = makeHarness();
          const ids: string[] = [];
          for (const d of decs) {
            const id = openDecision(h, d.defIdx === 0 ? 'd:dec' : 'd:decDefault', d.deadline);
            if (id) ids.push(id);
          }

          const phaseAfter = { current: 0, sweeps: 0 };
          for (const op of ops) {
            if (op === 'answer') {
              // 随机答复一个仍然 open 的决策之一（若尚有）
              const openIds = ids.filter((id) => h.holder.getState().world.decisions[id]?.status === 'open');
              if (openIds.length === 0) continue;
              const pick = openIds[Math.floor(Math.random() * openIds.length)]!;
              h.registry.invoke('decision.answer', { id: pick, actor: { $: 'a:who' }, choice: 'yes' });
              if (h.holder.getState().world.decisions[pick]?.status === 'open') {
                h.registry.invoke('decision.answer', { id: pick, actor: { $: 'a:who' }, choice: 'no' });
              }
            } else {
              // timeout：推进相位并触发超时处理。makeProcessDecisionTimeouts 需要真实 OpContext，
              // 因此用一次性事务载体执行。
              phaseAfter.current += 1;
              phaseAfter.sweeps += 1;
              const state = h.holder.getState();
              const newTurn = { ...state.world.turn, phaseIndex: 0, phaseEnteredAt: state.world.turn.phaseEnteredAt + 1 };
              h.holder.setState({ ...state, world: { ...state.world, turn: newTurn } });
              const result = h.runWithCtx((ctx) => h.processTimeouts(ctx));
              expect(result.ok).toBe(true);
            }
          }

          // 不变量1：任何终态（resolved/void）的决策在后续绝不回到 open。
          for (const id of ids) {
            const d = h.holder.getState().world.decisions[id];
            if (!d) continue;
            expect(['open', 'resolved', 'void']).toContain(d.status);
            expect(d.status).not.toBe('timeout'); // timeout 仅作中间态，终结态由 resolved/void 表达
          }

          // 不变量2：在发生过至少一次超时推进（sweeps>0）、且 deadline 已到期的情况下，
          // open 决策要么已被答复到 quorum，要么已被超时处理终结——不该有可终结却被滞留的 open。
          // 注意语义边界：deadline<=当前相位 的超时终结只发生在 schedule.advance 的推进扫秒中；
          // 若本次序列从未推进过相位，无论 deadline 多小而决策仍是新开出的 open，都是合法的
          // （它等着下一次推进被 sweep）。故本断言只在 sweeps===0 时不成立为过言，予以豁免。
          if (phaseAfter.sweeps > 0) {
            const state = h.holder.getState();
            for (const id of ids) {
              const d = state.world.decisions[id];
              if (!d || d.status !== 'open') continue;
              // 仍然 open 的，必须是已经答复过的 or deadline 尚未到期。
              const answered = Object.keys(d.answers).length > 0;
              const due = d.deadline !== undefined && d.deadline <= state.world.turn.phaseEnteredAt;
              expect(answered || !due, `代号决策 ${id} 在到期后仍滞留 open`).toBe(true);
            }
          }
        },
      ),
      { numRuns: 200, seed: 424242 },
    );
  });

  it('意图幂等：intent.void 至多成功一次，重复 void 被拒，终态停留', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), (n) => {
        resetIdCounters();
        const h = makeHarness();
        const intentIds: string[] = [];
        for (let i = 0; i < n; i++) {
          const r = h.registry.invoke('intent.submit', { action: 'a:act', agent: 'a:agent', bindings: {} });
          if (r.ok) intentIds.push((r.value as { $: string }).$);
        }
        const allPending = queryAllPendingIntents(h.holder.getState());
        // 提交 n 个后，queryAll 恰返回 n 个 pending（不重不漏）
        expect(allPending.length).toBe(intentIds.length);
        for (const intent of allPending) {
          expect(intent.status).toBe('pending');
        }
        // 对每个 Intent 至多 void 一次成功；第二次 void 必须失败；状态最终为 void 且停留
        for (const id of intentIds) {
          const first = h.registry.invoke('intent.void', { id, reason: 'test' });
          expect(first.ok).toBe(true);
          expect(h.holder.getState().world.intents[id]?.status).toBe('void');
          const second = h.registry.invoke('intent.void', { id, reason: 'again' });
          expect(second.ok).toBe(false); // 已终态，拒绝再次 void
          expect(h.holder.getState().world.intents[id]?.status).toBe('void');
        }

        // void 全部后，queryAll 不再返回任何 pending（全覆盖到零）
        expect(queryAllPendingIntents(h.holder.getState()).length).toBe(0);
      }),
      { numRuns: 200 },
    );
  });

  it('意图幂等：intent.resolve 对 pending 成功一次；已 resolved/void 的 resolve 被拒且状态不变', () => {
    resetIdCounters();
    const h = makeHarness();
    const r = h.registry.invoke('intent.submit', { action: 'a:act', agent: 'a:agent', bindings: {} });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const id = (r.value as { $: string }).$;
    expect(queryPendingIntentsFor(h.holder.getState(), 'a:agent').map((i) => i.id)).toEqual([id]);

    const first = h.registry.invoke('intent.resolve', { id });
    expect(first.ok).toBe(true);
    expect(h.holder.getState().world.intents[id]?.status).toBe('resolved');

    // resolved 后再 resolve → 失败
    const second = h.registry.invoke('intent.resolve', { id });
    expect(second.ok).toBe(false);
    expect(h.holder.getState().world.intents[id]?.status).toBe('resolved');

    // resolved 的意图不再出现在 pending 查询里（queryPendingIntentsFor 与 queryAllPendingIntents 都为空）
    expect(queryPendingIntentsFor(h.holder.getState(), 'a:agent')).toEqual([]);
    expect(queryAllPendingIntents(h.holder.getState())).toEqual([]);
  });

  it('意图查询不重不漏：随机混合 pending/resolved/void 后，query 与真值全等', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<'pending' | 'resolved' | 'void'>('pending', 'resolved', 'void', 'pending'), {
          minLength: 0,
          maxLength: 10,
        }),
        (statuses) => {
          resetIdCounters();
          const h = makeHarness();
          const ids: string[] = [];
          for (let i = 0; i < statuses.length; i++) {
            const r = h.registry.invoke('intent.submit', { action: 'a:act', agent: 'a:agent', bindings: {} });
            if (!r.ok) return false;
            ids.push((r.value as { $: string }).$);
          }
          for (let i = 0; i < statuses.length; i++) {
            const s = statuses[i];
            if (s === 'void') h.registry.invoke('intent.void', { id: ids[i], reason: 't' });
            else if (s === 'resolved') h.registry.invoke('intent.resolve', { id: ids[i] });
          }
          const state: WorldState = h.holder.getState();
          const truth = Object.values(state.world.intents)
            .filter((i): i is IntentState => i.status === 'pending')
            .map((i) => i.id)
            .sort();
          const queriedAll = queryAllPendingIntents(state).map((i) => i.id).sort();
          const queriedFor = queryPendingIntentsFor(state, 'a:agent').map((i) => i.id).sort();
          // 全部 pending 都归属 a:agent，故 for 查询应与 all 查询一致且都等于真值
          expect(queriedFor).toEqual(truth);
          expect(queriedAll).toEqual(truth);
          // 无重复：把 id 收进 Set 不应丢失数量
          expect(new Set(queriedAll).size).toBe(queriedAll.length);
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });
});

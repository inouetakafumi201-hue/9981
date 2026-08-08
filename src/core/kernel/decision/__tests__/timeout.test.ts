/**
 * L7×L9: Decision 超时处理（需求27.1 deadline / 27.7 onTimeout）。
 *
 * 本次修补前，decision.open 不接受也不存储 deadline，且没有任何路径处理超时——DecisionDef 的
 * onTimeout/defaultChoice 字段是死的。现在 decision.open 存储 deadline，schedule.advance 在推进
 * 相位后按 onTimeout 处理到期 Decision（'default' 填默认答案并解算，'void' 直接作废）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerDecisionOps,
  makeProcessDecisionTimeouts,
  type DecisionAnswerDeps,
} from '../decision-ops.js';
import { registerScheduleOps } from '../../schedule/schedule-ops.js';
import { OpRegistry } from '../../ops/registry.js';
import { WorldStateHolder } from '../../ops/transaction.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import { resetIdCounters } from '../../state/ids.js';
import type { Def } from '../../state/def.js';
import type { ScheduleDef } from '../../schedule/types.js';
import type { DecisionDef } from '../types.js';

const sched: ScheduleDef = { id: 's:sched', kind: 'schedule', phases: [{ id: 'p:0' }, { id: 'p:1' }], loop: true };

function makeHarness(def: DecisionDef, opts?: { premiseOk?: boolean }) {
  const holder = new WorldStateHolder(createEmptyWorldState(sched.id));
  const registry = new OpRegistry(holder);
  const ran: { effects: unknown[]; status: string }[] = [];
  const defLookup = (id: string): Def | null => (id === def.id ? def : id === sched.id ? sched : null);
  const answerDeps: DecisionAnswerDeps = {
    defLookup: { resolve: defLookup },
    recheckPremise: () => opts?.premiseOk ?? true,
    runEffects: (effects, decision) => { ran.push({ effects, status: decision.status }); },
  };
  registerDecisionOps(registry, { resolve: defLookup }, answerDeps, () => 0);
  registerScheduleOps(registry, {
    defLookup,
    processDecisionTimeouts: makeProcessDecisionTimeouts(answerDeps),
  });
  return { holder, registry, ran };
}

const baseDef = (over: Partial<DecisionDef>): DecisionDef => ({
  id: 'g:def', kind: 'decision', options: [{ name: 'yes', label: 'Yes' }],
  quorum: 'all', onTimeout: 'void', onResolve: [{ emit: 'resolved' }], ...over,
});

describe('decision.open 存储 deadline（需求27.1）', () => {
  beforeEach(() => resetIdCounters());

  it('传入 deadline 时写入 DecisionState', () => {
    const { holder, registry } = makeHarness(baseDef({}));
    const opened = registry.invoke<{ def: string; askees: { $: string }[]; ctx: Record<string, never>; deadline: number }, { $: string }>(
      'decision.open', { def: 'g:def', askees: [{ $: 'a:1' }], ctx: {}, deadline: 2 });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(holder.getState().world.decisions[opened.value.$]?.deadline).toBe(2);
  });

  it('未传 deadline 时不设置该字段', () => {
    const { holder, registry } = makeHarness(baseDef({}));
    const opened = registry.invoke<{ def: string; askees: { $: string }[]; ctx: Record<string, never> }, { $: string }>(
      'decision.open', { def: 'g:def', askees: [{ $: 'a:1' }], ctx: {} });
    if (!opened.ok) return;
    expect(holder.getState().world.decisions[opened.value.$]?.deadline).toBeUndefined();
  });
});

describe('schedule.advance 处理到期 Decision（需求27.7）', () => {
  beforeEach(() => resetIdCounters());

  function openWithDeadline(h: ReturnType<typeof makeHarness>, deadline: number): string {
    const opened = h.registry.invoke<{ def: string; askees: { $: string }[]; ctx: Record<string, never>; deadline: number }, { $: string }>(
      'decision.open', { def: 'g:def', askees: [{ $: 'a:1' }], ctx: {}, deadline });
    if (!opened.ok) throw new Error('open failed');
    return opened.value.$;
  }

  it('onTimeout:void — 到期后转 void 并运行 onVoid', () => {
    const h = makeHarness(baseDef({ onTimeout: 'void', onVoid: [{ emit: 'voided' }] }));
    const id = openWithDeadline(h, 1);
    h.registry.invoke('schedule.advance', {}); // phase 0 -> 1, deadline=1 到期
    expect(h.holder.getState().world.decisions[id]?.status).toBe('void');
    expect(h.ran.some((r) => r.status === 'void')).toBe(true);
  });

  it('onTimeout:default — 到期后填 defaultChoice、转 resolved 并运行 onResolve', () => {
    const h = makeHarness(baseDef({ onTimeout: 'default', defaultChoice: 'yes' }));
    const id = openWithDeadline(h, 1);
    h.registry.invoke('schedule.advance', {});
    const decision = h.holder.getState().world.decisions[id];
    expect(decision?.status).toBe('resolved');
    expect(decision?.answers['a:1']).toBe('yes'); // 未答复的 askee 被填入默认答案
    expect(h.ran.some((r) => r.status === 'resolved')).toBe(true);
  });

  it('onTimeout:default 但前提已失效 — 转 void 而非 resolved（需求27.4 重检）', () => {
    const h = makeHarness(baseDef({ onTimeout: 'default', defaultChoice: 'yes', onVoid: [{ emit: 'voided' }] }), { premiseOk: false });
    const id = openWithDeadline(h, 1);
    h.registry.invoke('schedule.advance', {});
    expect(h.holder.getState().world.decisions[id]?.status).toBe('void');
  });

  it('未到期的 Decision 不受影响', () => {
    const h = makeHarness(baseDef({ onTimeout: 'void' }));
    const id = openWithDeadline(h, 5);
    h.registry.invoke('schedule.advance', {}); // ->1, deadline=5 未到
    expect(h.holder.getState().world.decisions[id]?.status).toBe('open');
  });

  it('无 deadline 的 Decision 永不超时', () => {
    const h = makeHarness(baseDef({ onTimeout: 'void' }));
    const opened = h.registry.invoke<{ def: string; askees: { $: string }[]; ctx: Record<string, never> }, { $: string }>(
      'decision.open', { def: 'g:def', askees: [{ $: 'a:1' }], ctx: {} });
    if (!opened.ok) return;
    for (let i = 0; i < 4; i++) h.registry.invoke('schedule.advance', {});
    expect(h.holder.getState().world.decisions[opened.value.$]?.status).toBe('open');
  });

  it('已答复达成 quorum 的 Decision 在超时前已 resolved，超时处理跳过它', () => {
    const h = makeHarness(baseDef({ quorum: 'any', onTimeout: 'void' }));
    const id = openWithDeadline(h, 1);
    h.registry.invoke('decision.answer', { id, actor: { $: 'a:1' }, choice: 'yes' });
    expect(h.holder.getState().world.decisions[id]?.status).toBe('resolved');
    h.registry.invoke('schedule.advance', {}); // 到期但已 resolved，onTimeout 不再处理
    expect(h.holder.getState().world.decisions[id]?.status).toBe('resolved');
  });
});

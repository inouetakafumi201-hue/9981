/**
 * 任务 3.1 验收测试：配额档案校验（无默认值）、单调预算、溢出安全、越界饱和、深度峰值计量。
 */
import { describe, expect, it } from 'vitest';
import { sha256FingerprintGateway } from '../../ports/sha256-fingerprint-gateway.js';
import { createDiagnosticCodeCatalog } from '../../diagnostics/code-catalog.js';
import { createDiagnosticFactory } from '../../diagnostics/factory.js';
import { QUOTA_KINDS } from '../../model/quota-types.js';
import type { TrustedQuotaProfile } from '../../model/quota-types.js';
import { inspectQuotaProfile, validateQuotaProfile } from '../quota-profile.js';
import { DepthTracker, QuotaUsageError, createQuotaBudget } from '../quota-budget.js';

const factory = createDiagnosticFactory(createDiagnosticCodeCatalog(sha256FingerprintGateway));

function profile(overrides: Partial<Record<string, unknown>> = {}): TrustedQuotaProfile {
  const base: Record<string, unknown> = { profileId: 'p1', version: 'v1' };
  for (const kind of QUOTA_KINDS) base[kind] = 100;
  return { ...base, ...overrides } as unknown as TrustedQuotaProfile;
}

describe('Feature: wakeup-ugc, Task 3.1: trusted quota profile has no defaults', () => {
  it('accepts a complete profile', () => {
    expect(inspectQuotaProfile(profile())).toEqual([]);
    const result = validateQuotaProfile(factory, profile(), 'pkg-1');
    expect(result.ok).toBe(true);
  });

  it('rejects a profile missing any single quota instead of filling in a default', () => {
    for (const kind of QUOTA_KINDS) {
      const incomplete: Record<string, unknown> = { ...(profile() as unknown as Record<string, unknown>) };
      delete incomplete[kind];
      const problems = inspectQuotaProfile(incomplete);
      expect(problems.map((problem) => problem.kind)).toContain(kind);

      const result = validateQuotaProfile(factory, incomplete, 'pkg-1');
      expect(result.ok).toBe(false);
    }
  });

  it('rejects non-integer, negative, nonfinite and non-numeric quota values', () => {
    for (const bad of [1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, '10', null]) {
      const problems = inspectQuotaProfile(profile({ astNodes: bad }));
      expect(problems.some((problem) => problem.kind === 'astNodes')).toBe(true);
    }
  });

  it('allows quota values far above the 1-5 gameplay range', () => {
    // 需求 9.3：技术配额用自身 Schema，不受玩法数值范围约束。
    expect(inspectQuotaProfile(profile({ inputBytes: 1_048_576, traversalWork: 5_000_000 }))).toEqual([]);
  });

  it('accepts zero as a legitimate quota value', () => {
    expect(inspectQuotaProfile(profile({ definitions: 0 }))).toEqual([]);
  });

  it('rejects empty or whitespace-padded profile identity', () => {
    for (const bad of ['', ' p1', 'p1 ', 42, undefined]) {
      expect(inspectQuotaProfile(profile({ profileId: bad })).some((p) => p.kind === 'profileId')).toBe(true);
    }
  });

  it('fails closed with an unresolved-contract host diagnostic that blames the host, not the candidate', () => {
    const result = validateQuotaProfile(factory, { profileId: 'p1', version: 'v1' }, 'pkg-1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.length).toBe(QUOTA_KINDS.length);
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.code).toBe('E_LOAD_UNRESOLVED_CONTRACT');
      expect(diagnostic.scope).toBe('host');
      expect(diagnostic.correctionSuggestion).toContain('宿主配置');
    }
  });
});

describe('Feature: wakeup-ugc, Task 3.1: monotonic budget', () => {
  it('never decreases and exposes no release or reset path', () => {
    const budget = createQuotaBudget(profile({ astNodes: 10 }));
    expect(budget.consume('astNodes', 4)).toBeNull();
    expect(budget.used('astNodes')).toBe(4);
    expect(budget.consume('astNodes', 3)).toBeNull();
    expect(budget.used('astNodes')).toBe(7);
    const asRecord = budget as unknown as Record<string, unknown>;
    for (const forbidden of ['release', 'refund', 'reset', 'restore']) {
      expect(asRecord[forbidden]).toBeUndefined();
    }
  });

  it('allows consuming exactly up to the limit', () => {
    const budget = createQuotaBudget(profile({ astNodes: 5 }));
    expect(budget.consume('astNodes', 5)).toBeNull();
    expect(budget.isExhausted('astNodes')).toBe(true);
    expect(budget.remaining('astNodes')).toBe(0);
  });

  it('saturates usage to the limit on violation so the affected traversal stops', () => {
    const budget = createQuotaBudget(profile({ astNodes: 5 }));
    const violation = budget.consume('astNodes', 9);
    expect(violation).not.toBeNull();
    expect(violation?.kind).toBe('astNodes');
    expect(violation?.limit).toBe(5);
    expect(violation?.observed).toBe(5);
    expect(violation?.requested).toBe(9);
    expect(budget.isExhausted('astNodes')).toBe(true);
  });

  it('is overflow safe for amounts near the safe integer ceiling', () => {
    const budget = createQuotaBudget(profile({ inputBytes: Number.MAX_SAFE_INTEGER }));
    expect(budget.consume('inputBytes', Number.MAX_SAFE_INTEGER - 1)).toBeNull();
    const violation = budget.consume('inputBytes', 10);
    expect(violation).not.toBeNull();
    expect(budget.used('inputBytes')).toBe(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(budget.used('inputBytes'))).toBe(true);
  });

  it('treats a zero limit as immediately exhausted', () => {
    const budget = createQuotaBudget(profile({ definitions: 0 }));
    expect(budget.consume('definitions', 1)).not.toBeNull();
    expect(budget.consume('definitions', 0)).toBeNull();
  });

  it('throws on a negative or non-integer amount because that is an implementation defect', () => {
    const budget = createQuotaBudget(profile());
    expect(() => budget.consume('astNodes', -1)).toThrow(QuotaUsageError);
    expect(() => budget.consume('astNodes', 1.5)).toThrow(QuotaUsageError);
    expect(() => budget.consume('astNodes', Number.NaN)).toThrow(QuotaUsageError);
  });

  it('keeps quota kinds independent', () => {
    const budget = createQuotaBudget(profile({ astNodes: 2, objectMembers: 2 }));
    expect(budget.consume('astNodes', 2)).toBeNull();
    expect(budget.isExhausted('astNodes')).toBe(true);
    expect(budget.isExhausted('objectMembers')).toBe(false);
    expect(budget.consume('objectMembers', 1)).toBeNull();
  });

  it('reports a complete snapshot covering every quota kind', () => {
    const budget = createQuotaBudget(profile({ astNodes: 7 }));
    budget.consume('astNodes', 3);
    const snapshot = budget.snapshot();
    expect(Object.keys(snapshot).sort()).toEqual([...QUOTA_KINDS].sort());
    expect(snapshot.astNodes).toEqual({ used: 3, limit: 7 });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('fails in the same quota category for the same consumption sequence', () => {
    const run = (): string | null => {
      const budget = createQuotaBudget(profile({ arrayElements: 3 }));
      for (const amount of [1, 1, 1, 1]) {
        const violation = budget.consume('arrayElements', amount);
        if (violation !== null) return violation.kind;
      }
      return null;
    };
    expect(run()).toBe('arrayElements');
    expect(run()).toBe(run());
  });

  it('gives each candidate an independent budget', () => {
    const shared = profile({ astNodes: 3 });
    const first = createQuotaBudget(shared);
    first.consume('astNodes', 3);
    const second = createQuotaBudget(shared);
    expect(second.used('astNodes')).toBe(0);
  });
});

describe('Feature: wakeup-ugc, Task 3.1: depth is measured as a peak, not a running total', () => {
  it('does not accumulate depth across sibling subtrees', () => {
    // 1000 个兄弟对象各深 2 层：真实结构深度是 2，累计计量会得到 2000 并误判超限。
    const budget = createQuotaBudget(profile({ nestingDepth: 4 }));
    const tracker = new DepthTracker(budget);
    for (let sibling = 0; sibling < 1000; sibling += 1) {
      expect(tracker.enter(1)).toBeNull();
      expect(tracker.enter(2)).toBeNull();
    }
    expect(tracker.currentPeak()).toBe(2);
    expect(budget.used('nestingDepth')).toBe(2);
  });

  it('reports a violation once the peak passes the limit', () => {
    const budget = createQuotaBudget(profile({ nestingDepth: 3 }));
    const tracker = new DepthTracker(budget);
    expect(tracker.enter(1)).toBeNull();
    expect(tracker.enter(2)).toBeNull();
    expect(tracker.enter(3)).toBeNull();
    const violation = tracker.enter(4);
    expect(violation?.kind).toBe('nestingDepth');
  });
});

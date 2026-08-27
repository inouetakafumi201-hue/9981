/**
 * Feature: wakeup-ugc, Property 13: Atomic activation and stale-baseline rejection.
 *
 * 对任意验证产物，提交前改变规范化内容、稳定来源身份、目标层、操作、预期目标 ID 或任一基线组成，
 * 都拒绝该产物；一个变更请求或目标注册表的验证结果不能授权另一个，即使内容相同。
 * 网关失败或任何候选/依赖错误使注册表、依赖图与规范化快照字节等价；成功一次性发布。
 *
 * **Validates: Requirement 13**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createHarness } from '../harness';
import { requestFrom, validCandidateText } from '../../testing/generators';
import { activationUnchanged } from '../../testing/observer';

function validatedReport(harness: ReturnType<typeof createHarness>, text = validCandidateText()) {
  const report = harness.facade.validate(requestFrom(text, 'hand-authored'));
  if (report.validated === null) throw new Error('fixture should validate');
  return report;
}

describe('Feature: wakeup-ugc, Property 13: atomic activation and stale baseline', () => {
  it('activates a valid candidate exactly once and publishes a new snapshot', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{2,6}$/), (tag) => {
        const harness = createHarness();
        const report = validatedReport(harness, validCandidateText({ id: `w:${tag}` }));
        const before = harness.registry.readSnapshot().snapshotFingerprint;
        const result = harness.facade.activate(report.validated!, report.baseline);

        expect(result.status).toBe('activated');
        expect(result.unchanged).toBe(false);
        expect(result.previousSnapshotFingerprint).toBe(before);
        expect(result.activeSnapshotFingerprint).not.toBe(before);
        expect(harness.registry.calls.activate).toBe(1);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects a stale baseline after any registry change, calling activate zero times', () => {
    const harness = createHarness();
    const report = validatedReport(harness);
    harness.registry.bumpVersion();
    const before = harness.registry.readSnapshot().snapshotFingerprint;

    const result = harness.facade.activate(report.validated!, report.baseline);
    expect(activationUnchanged(result)).toBe(true);
    expect(result.diagnostics.every((entry) => entry.code === 'E_LOAD_BASELINE_STALE')).toBe(true);
    expect(harness.registry.calls.activate).toBe(0);
    expect(harness.registry.readSnapshot().snapshotFingerprint).toBe(before);
  });

  it('refuses a forged artifact never minted internally', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const harness = createHarness();
        const report = validatedReport(harness);
        const forged = { ...report.validated! };
        const result = harness.facade.activate(forged, report.baseline);
        expect(result.status).toBe('rejected');
        expect(harness.registry.calls.activate).toBe(0);
      }),
      { numRuns: 5 },
    );
  });

  it('never lets one request\u2019s artifact authorise a different target registry layer', () => {
    const harness = createHarness({ targetOwnership: 'play-layer' });
    const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored', 'base-layer'));
    expect(report.validated).not.toBeNull();
    const result = harness.facade.activate(report.validated!, report.baseline);
    expect(result.status).toBe('rejected');
    expect(harness.registry.calls.activate).toBe(0);
  });

  it('keeps the registry byte-equivalent when the gateway rejects, throws or lies about success', () => {
    fc.assert(
      fc.property(fc.constantFrom('reject' as const, 'throw' as const, 'invalid-result' as const, 'silent-success' as const), (mode) => {
        const harness = createHarness();
        const report = validatedReport(harness);
        const before = harness.registry.readSnapshot().snapshotFingerprint;

        harness.registry.failNext(mode);
        const result = harness.facade.activate(report.validated!, report.baseline);

        expect(result.status).toBe('rejected');
        expect(result.unchanged).toBe(true);
        expect(harness.registry.readSnapshot().snapshotFingerprint).toBe(before);
      }),
      { numRuns: 4 },
    );
  });

  it('gives the same content from different documents distinct change-request identities', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^doc-[a-z]{2,5}$/), fc.stringMatching(/^doc-[a-z]{2,5}$/), (docA, docB) => {
        if (docA === docB) return;
        const harness = createHarness();
        const a = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored', 'base-layer', docA));
        const b = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored', 'base-layer', docB));
        expect(b.candidateFingerprint).toBe(a.candidateFingerprint);
        expect(b.changeRequestFingerprint).not.toBe(a.changeRequestFingerprint);
      }),
      { numRuns: 20 },
    );
  });

  it('includes candidate and snapshot identity in the activation result', () => {
    const harness = createHarness();
    const report = validatedReport(harness);
    const result = harness.facade.activate(report.validated!, report.baseline);
    expect(result.candidateFingerprint).toBe(report.candidateFingerprint);
    expect(result.changeRequestFingerprint).toBe(report.changeRequestFingerprint);
    expect(result.baseline.fingerprint).toBe(report.baseline.fingerprint);
  });
});

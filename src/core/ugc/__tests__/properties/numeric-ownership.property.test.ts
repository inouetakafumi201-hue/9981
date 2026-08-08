/**
 * Feature: wakeup-ugc, Property 5: Numeric classification and ownership.
 *
 * 对任意数值字段，恰好一个被接纳的分类控制其验证。玩法数值必须是玩法层拥有、1–5 之间的有限值；
 * 内部度量、结构边界、宪法常量与技术配额使用各自 Schema。单位标签与候选元数据不能改变分类。
 *
 * **Validates: Requirement 5**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { QUOTA_KINDS } from '../../model/quota-types.js';
import { inspectQuotaProfile } from '../../quota/quota-profile.js';
import { createHarness } from '../harness.js';
import { requestFrom, validCandidateText } from '../../testing/generators.js';

function profileWith(overrides: Record<string, unknown>): Record<string, unknown> {
  const base: Record<string, unknown> = { profileId: 'p', version: 'v' };
  for (const kind of QUOTA_KINDS) base[kind] = 100;
  return { ...base, ...overrides };
}

describe('Feature: wakeup-ugc, Property 5: numeric classification and ownership', () => {
  it('never applies the 1-5 gameplay range to technical quotas', () => {
    // 需求 9.3/5.5：技术配额用自身 Schema，任意非负安全整数都合法，包括远大于 5 的值。
    fc.assert(
      fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), (value) => {
        expect(inspectQuotaProfile(profileWith({ inputBytes: value }))).toEqual([]);
      }),
      { numRuns: 60 },
    );
  });

  it('rejects a technical quota that is negative, fractional or nonfinite', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -1_000_000, max: -1 }),
          fc.double({ min: 0.01, max: 0.99, noNaN: true }),
          fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
        ),
        (value) => {
          const problems = inspectQuotaProfile(profileWith({ astNodes: value }));
          expect(problems.some((problem) => problem.kind === 'astNodes')).toBe(true);
        },
      ),
      { numRuns: 40 },
    );
  });

  it('accepts every gameplay value inside 1-5 and rejects the neighbours when the validator enforces it', () => {
    // 分类与范围判定归上游 Definition Validator；这里验证 UGC 会如实转达其裁定，
    // 且不会用自己的猜测覆盖它（需求 5.1、5.2）。
    fc.assert(
      fc.property(fc.integer({ min: -3, max: 9 }), (value) => {
        const inRange = value >= 1 && value <= 5;
        const harness = createHarness({
          validator: inRange ? {} : { errors: [{ definitionId: 'weapon:shotgun', jsonPath: '/damage', condition: 'unknown-field' }] },
        });
        const report = harness.facade.validate(requestFrom(validCandidateText({ damage: value }), 'hand-authored'));
        expect(report.status).toBe(inRange ? 'validated' : 'rejected');
      }),
      { numRuns: 13 },
    );
  });

  it('preserves version and size numbers greater than 5 through the pipeline', () => {
    // 版本号、资源大小、解析偏移都是内部度量，不受玩法范围约束（需求 5.5、5.10）。
    const harness = createHarness();
    const report = harness.facade.validate(
      requestFrom(validCandidateText({ internalCount: 9999, offset: 123456 }), 'hand-authored'),
    );
    expect(report.status).toBe('validated');
    expect(report.budget.inputBytes.used).toBeGreaterThan(5);
    expect(report.budget.astNodes.used).toBeGreaterThan(0);
  });

  it('cannot let a candidate raise, disable or reinterpret a trusted quota through its own fields', () => {
    // 需求 5.8：候选字段绝不影响可信配额。这里让候选声明一个巨大的 "quota" 字段，
    // 然后断言实际生效的仍是宿主档案的小额度。
    const harness = createHarness({ quota: { astNodes: 3 } });
    const text = validCandidateText({
      quota: { astNodes: 1_000_000 },
      technicalQuota: 1_000_000,
      deep: { a: { b: { c: { d: 1 } } } },
    });
    const report = harness.facade.validate(requestFrom(text, 'hand-authored'));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.some((entry) => entry.code === 'E_QUOTA_AST_NODES')).toBe(true);
    expect(report.budget.astNodes.limit).toBe(3);
  });

  it('treats a unit label as not exempting an unclassified number', () => {
    // 需求 5.7：单位标签本身不能豁免分类。UGC 不因为出现 "unit" 字段就放宽任何判定——
    // 它把候选原样交给上游，由上游的分类裁定决定结果。
    const harness = createHarness({
      validator: { errors: [{ definitionId: 'weapon:shotgun', jsonPath: '/duration', condition: 'unknown-field' }] },
    });
    const report = harness.facade.validate(
      requestFrom(validCandidateText({ duration: 42, unit: 'seconds' }), 'hand-authored'),
    );
    expect(report.status).toBe('rejected');
  });
});

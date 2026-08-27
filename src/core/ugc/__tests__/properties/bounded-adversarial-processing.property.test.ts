/**
 * Feature: wakeup-ugc, Property 9: Bounded adversarial processing.
 *
 * 对任意超大、深嵌套或高扇出候选，第一个耗尽的可信配额终止受影响的有界遍历、返回匹配的资源诊断、
 * 零激活，且内存/工作量受配置的输入/AST/图/诊断/输出上限约束。
 *
 * **Validates: Requirement 9**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createHarness } from '../harness';
import { arbitraryBomb, requestFrom } from '../../testing/generators';
import { QUOTA_KINDS } from '../../model/quota-types';

const QUOTA_CODES = new Set([
  'E_QUOTA_INPUT_BYTES',
  'E_QUOTA_NESTING_DEPTH',
  'E_QUOTA_OBJECT_MEMBERS',
  'E_QUOTA_ARRAY_ELEMENTS',
  'E_QUOTA_AST_NODES',
  'E_QUOTA_TRAVERSAL_WORK',
  'E_QUOTA_OUTPUT_BYTES',
  'E_QUOTA_DIAGNOSTICS',
]);

describe('Feature: wakeup-ugc, Property 9: bounded adversarial processing', () => {
  it('terminates any resource bomb within quota and never activates', () => {
    fc.assert(
      fc.property(arbitraryBomb(), (text) => {
        const harness = createHarness({
          quota: { inputBytes: 4_000, nestingDepth: 32, objectMembers: 64, arrayElements: 64, astNodes: 256, traversalWork: 5_000, outputBytes: 4_000 },
        });
        const report = harness.facade.validate(requestFrom(text, 'hand-authored'));

        // 结果只有两种：在配额内被正常处理，或被某个精确配额码拒绝。绝不允许挂起或抛异常。
        if (report.status === 'rejected') {
          const quotaDiagnostic = report.diagnostics.find((entry) => QUOTA_CODES.has(entry.code));
          if (quotaDiagnostic !== undefined) {
            expect(quotaDiagnostic.expected).toBeDefined();
            expect(quotaDiagnostic.actual).toBeDefined();
          }
        }
        expect(harness.registry.calls.activate).toBe(0);

        // 用量永不超过限额：这是"有界"的可观察证据。
        for (const kind of QUOTA_KINDS) {
          const usage = report.budget[kind];
          expect(usage.used).toBeLessThanOrEqual(usage.limit);
        }
      }),
      { numRuns: 80 },
    );
  });

  it('handles deep nesting iteratively without a stack overflow', () => {
    fc.assert(
      fc.property(fc.integer({ min: 500, max: 5_000 }), (depth) => {
        const harness = createHarness({
          quota: { inputBytes: 200_000, nestingDepth: 10_000, astNodes: 100_000, traversalWork: 2_000_000, outputBytes: 200_000 },
        });
        const text = `{"schemaVersion":"1.0.0","d":${'['.repeat(depth)}1${']'.repeat(depth)}}`;
        expect(() => harness.facade.validate(requestFrom(text, 'hand-authored'))).not.toThrow();
      }),
      { numRuns: 10 },
    );
  });

  it('reports the input-bytes quota before materialising an oversized document', () => {
    const harness = createHarness({ quota: { inputBytes: 32 } });
    const text = `{"schemaVersion":"1.0.0","pad":"${'x'.repeat(500)}"}`;
    const report = harness.facade.validate(requestFrom(text, 'hand-authored'));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.some((entry) => entry.code === 'E_QUOTA_INPUT_BYTES')).toBe(true);
    // 不得回显完整超大载荷（需求 9.7）。
    for (const diagnostic of report.diagnostics) {
      expect(diagnostic.reason?.includes('x'.repeat(100)) ?? false).toBe(false);
    }
  });

  it('fails in the same quota category for the same oversized candidate', () => {
    const run = () => {
      const harness = createHarness({ quota: { astNodes: 4 } });
      const report = harness.facade.validate(
        requestFrom('{"schemaVersion":"1.0.0","a":[1,2,3,4,5,6,7,8]}', 'hand-authored'),
      );
      return report.diagnostics.map((entry) => entry.code).join(',');
    };
    expect(run()).toBe(run());
  });

  it('stops diagnostic flooding with a single terminal quota diagnostic', () => {
    const harness = createHarness({
      quota: { diagnostics: 3 },
      validator: {
        errors: Array.from({ length: 40 }, (_value, index) => ({
          definitionId: `def:${String(index)}`,
          jsonPath: `/f${String(index)}`,
          condition: 'unknown-field' as const,
        })),
      },
    });
    const report = harness.facade.validate(requestFrom('{"schemaVersion":"1.0.0"}', 'hand-authored'));
    const terminal = report.diagnostics.filter((entry) => entry.code === 'E_QUOTA_DIAGNOSTICS');
    expect(terminal).toHaveLength(1);
    // 终止诊断必须记录已收集数与至少被抑制数。
    expect(terminal[0]?.reason).toMatch(/已收集/);
    expect(terminal[0]?.reason).toMatch(/抑制/);
    expect(report.diagnostics.length).toBeLessThanOrEqual(5);
    expect(harness.registry.calls.activate).toBe(0);
  });
});

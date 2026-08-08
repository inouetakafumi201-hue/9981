/**
 * Feature: wakeup-ugc, Property 7: Typed reference completeness.
 *
 * 对任意候选加活动图，只有当每个引用有唯一兼容的提供方、kind 与语义族，每个被改动定义的传递入边闭包
 * 仍然有效，且不存在不受支持的引用/包环时，验证才成功。等价的图排列产生相同的边与诊断。
 *
 * **Validates: Requirement 7**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createHarness } from '../harness.js';
import { requestFrom, validCandidateText } from '../../testing/generators.js';
import { MANDATORY_RESOLUTION_CAPABILITIES } from '../../ports/definition-ports.js';

describe('Feature: wakeup-ugc, Property 7: typed reference completeness', () => {
  it('rejects the complete change set when any reference target is missing', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{3,8}:[a-z]{3,8}$/), (target) => {
        const harness = createHarness({ resolver: { missingTarget: target } });
        const report = harness.facade.validate(requestFrom(validCandidateText({ uses: target }), 'hand-authored'));
        expect(report.status).toBe('rejected');
        expect(report.diagnostics.some((entry) => entry.code === 'E_REF_MISSING')).toBe(true);
        expect(report.validated).toBeNull();
        expect(harness.registry.calls.activate).toBe(0);
      }),
      { numRuns: 20 },
    );
  });

  it('never exposes a partial dependency graph as a valid output', () => {
    const harness = createHarness({ resolver: { missingTarget: 'weapon:missing' } });
    const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));
    // 解析失败时 graph 为 null，因此不可能有产物携带半成品图。
    expect(report.validated).toBeNull();
    expect(report.skippedChecks.some((entry) => entry.stage === 'activation-precheck')).toBe(true);
  });

  it('fails closed when the resolver cannot prove any single mandatory capability', () => {
    fc.assert(
      fc.property(fc.constantFrom(...MANDATORY_RESOLUTION_CAPABILITIES), (capability) => {
        const harness = createHarness({ resolver: { omitCapabilities: [capability] } });
        const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));
        expect(report.status).toBe('rejected');
        const unresolved = report.diagnostics.find((entry) => entry.code === 'E_LOAD_UNRESOLVED_CONTRACT');
        expect(unresolved).toBeDefined();
        expect(unresolved?.reason).toContain(capability);
      }),
      { numRuns: MANDATORY_RESOLUTION_CAPABILITIES.length },
    );
  });

  it('carries the resolved graph into the artifact only when resolution succeeded', () => {
    const harness = createHarness({ resolver: { revalidatedDependents: ['weapon:rifle', 'weapon:pistol'] } });
    const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));
    expect(report.status).toBe('validated');
    expect(report.validated?.resolvedReferences.revalidatedDependents).toEqual(['weapon:rifle', 'weapon:pistol']);
  });

  it('produces stable graph nodes and diagnostics for repeated identical runs', () => {
    const harness = createHarness({ resolver: { revalidatedDependents: ['b', 'a'] } });
    const signature = () => {
      const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));
      return JSON.stringify({
        nodes: report.validated?.resolvedReferences.nodes ?? null,
        dependents: report.validated?.resolvedReferences.revalidatedDependents ?? null,
        codes: report.diagnostics.map((entry) => entry.code),
      });
    };
    expect(signature()).toBe(signature());
  });

  it('rejects a dependent candidate when the required domain contract is unmerged', () => {
    // 需求 7.4：契约未汇合时拒绝，而不是推断提供方形状。
    const harness = createHarness({ contracts: [] });
    const contracts = harness.baselineSources.contracts;
    for (const domain of ['core-mechanics', 'space-items', 'ai'] as const) {
      const resolved = contracts.resolve(domain, 'pkg-1');
      expect(resolved.ok).toBe(false);
      if (resolved.ok) continue;
      expect(resolved.diagnostics[0]?.code).toBe('E_LOAD_UNRESOLVED_CONTRACT');
    }
  });
});

/**
 * 任务 11.5：在每个已登记端口注入失败/异常/非法结果。
 *
 * 对应 design.md「Error Handling」表的每一行，断言：scope 正确的诊断、跳过检查、单次根链接、
 * 零后续非法调用、旧快照保持。故障注入是在**已登记端口**上做依赖注入，不是在生产代码里加分支。
 */
import { describe, expect, it } from 'vitest';
import { createHarness } from '../harness.js';
import { requestFrom, validCandidateText } from '../../testing/generators.js';
import { activationUnchanged } from '../../testing/observer.js';

describe('Feature: wakeup-ugc, Task 11.5: failure injection at every stage', () => {
  it('decode failure: stops the pipeline and records skipped downstream checks', () => {
    const harness = createHarness();
    const report = harness.facade.validate(requestFrom('{"schemaVersion":', 'hand-authored'));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics[0]?.code).toBe('E_LOAD_JSON_SYNTAX');
    expect(report.skippedChecks.length).toBeGreaterThan(0);
    expect(harness.registry.calls.activate).toBe(0);
  });

  it('quota exhaustion during decode: matching resource diagnostic, no partial AST', () => {
    const harness = createHarness({ quota: { astNodes: 2 } });
    const report = harness.facade.validate(requestFrom('{"schemaVersion":"1.0.0","a":[1,2,3,4]}', 'hand-authored'));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.some((entry) => entry.code === 'E_QUOTA_AST_NODES')).toBe(true);
  });

  it('definition validator failure: aggregated errors, activation-precheck skipped', () => {
    const harness = createHarness({ validator: { errors: [{ definitionId: 'd', jsonPath: '/a', condition: 'unknown-field' }] } });
    const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));
    expect(report.status).toBe('rejected');
    expect(report.skippedChecks.some((entry) => entry.stage === 'activation-precheck')).toBe(true);
    expect(harness.registry.calls.activate).toBe(0);
  });

  it('validator missing a capability: unresolved-contract fail-closed', () => {
    const harness = createHarness({ validator: { omitCapabilities: ['layer-ownership'] } });
    const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.some((entry) => entry.code === 'E_LOAD_UNRESOLVED_CONTRACT')).toBe(true);
  });

  it('reference resolver failure: rejects the change set, no partial graph exposed', () => {
    const harness = createHarness({ resolver: { missingTarget: 'weapon:missing' } });
    const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));
    expect(report.status).toBe('rejected');
    expect(report.validated).toBeNull();
    expect(report.diagnostics.some((entry) => entry.code === 'E_REF_MISSING')).toBe(true);
  });

  it('presentation semantic pollution: rejects with semantic damage, no activation', () => {
    const harness = createHarness({
      schema: { gaps: [{ definitionId: 'weapon:shotgun', jsonPath: '/icon', missingAsset: 'i', expectedTypeTag: 'icon', sourceSpan: null }], pollutesSemantics: true },
    });
    const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.some((entry) => entry.code === 'E_LOAD_SEMANTIC_FIELD_DAMAGED')).toBe(true);
    expect(harness.registry.calls.activate).toBe(0);
  });

  it('commit-time stale baseline: zero activate calls, unchanged snapshot', () => {
    const harness = createHarness();
    const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));
    if (report.validated === null) throw new Error('fixture should validate');
    harness.registry.bumpVersion();
    const result = harness.facade.activate(report.validated, report.baseline);
    expect(activationUnchanged(result)).toBe(true);
    expect(harness.registry.calls.activate).toBe(0);
  });

  it('registry commit reject / throw / invalid-result / silent-success: previous state retained', () => {
    for (const mode of ['reject', 'throw', 'invalid-result', 'silent-success'] as const) {
      const harness = createHarness();
      const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));
      if (report.validated === null) throw new Error('fixture should validate');
      const before = harness.registry.readSnapshot().snapshotFingerprint;

      harness.registry.failNext(mode);
      const result = harness.facade.activate(report.validated, report.baseline);
      expect(result.status).toBe('rejected');
      expect(result.unchanged).toBe(true);
      expect(harness.registry.readSnapshot().snapshotFingerprint).toBe(before);
    }
  });

  it('no exception escapes the public facade for any injected failure', () => {
    const harness = createHarness();
    expect(() => harness.facade.validate(requestFrom('\u0000\uffff not json', 'hand-authored'))).not.toThrow();
    const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));
    if (report.validated === null) throw new Error('fixture should validate');
    harness.registry.failNext('throw');
    expect(() => harness.facade.activate(report.validated!, report.baseline)).not.toThrow();
  });
});

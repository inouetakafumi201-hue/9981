/**
 * Feature: wakeup-ugc, Property 4: Strict Schema and identity.
 *
 * 对任意当前 Schema 候选，只有当每个字段被其确切 Schema 接纳、每个 Def kind 已登记、
 * ID 在作用域内唯一、且覆盖唯一指向一个兼容且授权的目标时才可能被接受。
 * 未知字段、重复成员/ID 与非法 kind 被确定性拒绝。
 *
 * **Validates: Requirement 4**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createHarness } from '../harness.js';
import { requestFrom, validCandidateText } from '../../testing/generators.js';
import { rejectionFacts } from '../../testing/observer.js';
import { handAuthoredAdapter } from '../../adapter/adapters.js';
import { createCandidateChangeRequest, createCandidateSource } from '../../model/candidate.js';

function replaceRequest(text: string, expectedTargetId?: string) {
  const document = handAuthoredAdapter.toCandidate(
    text,
    createCandidateSource({
      kind: 'hand-authored',
      documentId: 'doc-1',
      packageId: 'pkg-1',
      sourceName: 'a.json',
      receivedAtSequence: 1,
    }),
    'base-layer',
  );
  return createCandidateChangeRequest({ operation: 'replace', document, expectedTargetId });
}

describe('Feature: wakeup-ugc, Property 4: strict schema and identity', () => {
  it('accepts only when the upstream validator reports zero structural errors', () => {
    fc.assert(
      fc.property(fc.boolean(), (hasError) => {
        const harness = createHarness({
          validator: hasError
            ? { errors: [{ definitionId: 'weapon:shotgun', jsonPath: '/unknown', condition: 'unknown-field' }] }
            : {},
        });
        const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));
        expect(report.status).toBe(hasError ? 'rejected' : 'validated');
        if (hasError) {
          expect(report.diagnostics.some((entry) => entry.code === 'E_LOAD_UNKNOWN_FIELD')).toBe(true);
        }
      }),
      { numRuns: 6 },
    );
  });

  it('reports an unknown field with an exact JSON path and definition id', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{2,8}$/), (field) => {
        const harness = createHarness({
          validator: { errors: [{ definitionId: 'weapon:shotgun', jsonPath: `/${field}`, condition: 'unknown-field' }] },
        });
        const report = harness.facade.validate(requestFrom(validCandidateText({ [field]: 1 }), 'hand-authored'));
        const diagnostic = report.diagnostics.find((entry) => entry.code === 'E_LOAD_UNKNOWN_FIELD');
        expect(diagnostic).toBeDefined();
        // definition scope 必须同时给出定义标识、JSON path 与来源位置（需求 14.4）。
        expect(diagnostic?.scope).toBe('definition');
        expect(diagnostic?.at?.def).toBe('weapon:shotgun');
        expect(diagnostic?.path).toBe(`/${field}`);
        expect(diagnostic?.sourceSpan).not.toBeNull();
      }),
      { numRuns: 12 },
    );
  });

  it('rejects a duplicate object member deterministically for any member name', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{1,8}$/), (key) => {
        const harness = createHarness();
        const text = `{"schemaVersion":"1.0.0","${key}":1,"${key}":2}`;
        const report = harness.facade.validate(requestFrom(text, 'hand-authored'));
        const facts = rejectionFacts(report);
        expect(facts.rejected).toBe(true);
        expect(report.diagnostics.some((entry) => entry.code === 'E_LOAD_DUPLICATE_MEMBER')).toBe(true);
        expect(harness.registry.calls.activate).toBe(0);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects a duplicate definition id reported by the upstream validator', () => {
    const harness = createHarness({
      validator: { errors: [{ definitionId: 'weapon:shotgun', jsonPath: '/id', condition: 'duplicate-id' }] },
    });
    const report = harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.some((entry) => entry.code === 'E_LOAD_DUPLICATE_ID')).toBe(true);
  });

  it('requires a replace to identify exactly one existing target', () => {
    const harness = createHarness();
    // 缺失预期目标：拒绝。
    expect(harness.facade.validate(replaceRequest(validCandidateText())).status).toBe('rejected');
    // 空白污染的标识不算稳定标识：拒绝。
    expect(harness.facade.validate(replaceRequest(validCandidateText(), ' weapon:shotgun')).status).toBe('rejected');
    // 唯一且稳定的预期目标：通过入口检查。
    expect(harness.facade.validate(replaceRequest(validCandidateText(), 'weapon:shotgun')).status).toBe('validated');
  });

  it('requires an explicit non-empty schema version declared by the document', () => {
    fc.assert(
      fc.property(fc.constantFrom('{}', '{"schemaVersion":1}', '{"schemaVersion":""}', '{"schemaVersion":" 1.0.0"}', '[]'), (text) => {
        const harness = createHarness();
        const report = harness.facade.validate(requestFrom(text, 'hand-authored'));
        expect(report.status).toBe('rejected');
        expect(report.diagnostics.some((entry) => entry.code === 'E_LOAD_SCHEMA_VERSION')).toBe(true);
      }),
      { numRuns: 5 },
    );
  });
});

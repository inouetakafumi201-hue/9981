/**
 * 任务 2.1 验收测试：不可变候选、请求绑定指纹、基线比较、结果通道不变量。
 */
import { describe, expect, it } from 'vitest';
import { sha256FingerprintGateway } from '../../ports/sha256-fingerprint-gateway';
import {
  candidateFromText,
  copyCandidateBytes,
  createCandidateDocument,
  createCandidateSource,
} from '../candidate';
import {
  computeChangeRequestFingerprint,
  createChangeRequestBinding,
  diffChangeRequestBindings,
} from '../binding';
import { createValidationBaseline, diffValidationBaselines } from '../baseline';
import { compareCodePoints, encodeFingerprintPayload, utf8ByteLength } from '../fingerprint';
import { hasBlockingDiagnostic, ugcOk, ugcReject } from '../result';
import { compareSkippedChecks, createSkippedCheck } from '../stage';
import { createPresentationFallbackDecision, isSemanticsPreserving } from '../presentation';

const gateway = sha256FingerprintGateway;

function source(overrides: Partial<ReturnType<typeof createCandidateSource>> = {}) {
  return createCandidateSource({
    kind: 'hand-authored',
    documentId: 'doc-1',
    packageId: 'pkg-1',
    sourceName: 'weapons.json',
    receivedAtSequence: 7,
    ...overrides,
  });
}

const baseBinding = createChangeRequestBinding({
  candidateFingerprint: 'cf-1',
  sourcePackageId: 'pkg-1',
  sourceDocumentId: 'doc-1',
  targetOwnership: 'base-layer',
  operation: 'add',
  expectedTargetId: null,
});

describe('Feature: wakeup-ugc, Task 2.1: immutable candidate model', () => {
  it('copies input bytes so later caller mutation cannot change the candidate', () => {
    const bytes = new TextEncoder().encode('{"schemaVersion":"1.0.0"}');
    const document = createCandidateDocument(source(), 'base-layer', bytes);
    const before = copyCandidateBytes(document);

    bytes[0] = 0x41;
    bytes.fill(0x42, 1, 5);

    expect(copyCandidateBytes(document)).toEqual(before);
    expect(document.utf8[0]).not.toBe(0x41);
  });

  it('returns an independent byte copy that cannot write back into the candidate', () => {
    const document = candidateFromText(source(), 'base-layer', '{"schemaVersion":"1.0.0"}');
    const copy = copyCandidateBytes(document);
    copy[0] = 0x00;
    expect(document.utf8[0]).toBe('{'.charCodeAt(0));
  });

  it('freezes the candidate and its source envelope', () => {
    const document = candidateFromText(source(), 'play-layer', '{}');
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.source)).toBe(true);
  });
});

describe('Feature: wakeup-ugc, Task 2.1: change request fingerprint binding', () => {
  it('changes when any bound semantic field changes', () => {
    const reference = computeChangeRequestFingerprint(gateway, baseBinding);
    const mutations = [
      { ...baseBinding, candidateFingerprint: 'cf-2' },
      { ...baseBinding, sourcePackageId: 'pkg-2' },
      { ...baseBinding, sourceDocumentId: 'doc-2' },
      { ...baseBinding, targetOwnership: 'play-layer' as const },
      { ...baseBinding, operation: 'replace' as const },
      { ...baseBinding, expectedTargetId: 'weapon:shotgun' },
    ];
    for (const mutated of mutations) {
      expect(computeChangeRequestFingerprint(gateway, mutated)).not.toBe(reference);
    }
  });

  it('is stable across audit-only source differences', () => {
    // source.kind / sourceName / receivedAtSequence 不参与绑定，因此不进入指纹（需求 3.10）。
    const reference = computeChangeRequestFingerprint(gateway, baseBinding);
    const sameBinding = createChangeRequestBinding({ ...baseBinding });
    expect(computeChangeRequestFingerprint(gateway, sameBinding)).toBe(reference);
  });

  it('distinguishes an absent expected target from an empty string', () => {
    const withNull = computeChangeRequestFingerprint(gateway, baseBinding);
    const withEmpty = computeChangeRequestFingerprint(gateway, { ...baseBinding, expectedTargetId: '' });
    expect(withEmpty).not.toBe(withNull);
  });

  it('reports field-level mismatches and nothing when equal', () => {
    expect(diffChangeRequestBindings(baseBinding, createChangeRequestBinding({ ...baseBinding }))).toEqual([]);
    const diff = diffChangeRequestBindings(baseBinding, { ...baseBinding, operation: 'remove' });
    expect(diff).toEqual([{ field: 'operation', expected: 'add', actual: 'remove' }]);
  });
});

describe('Feature: wakeup-ugc, Task 2.1: length-prefixed fingerprint encoding', () => {
  it('cannot be confused by separator characters inside values', () => {
    // 分隔符方案下 ('a|b','c') 与 ('a','b|c') 会编码相同；长度前缀从结构上排除该碰撞。
    const left = encodeFingerprintPayload('d', [
      { label: 'x', value: 'a|b' },
      { label: 'y', value: 'c' },
    ]);
    const right = encodeFingerprintPayload('d', [
      { label: 'x', value: 'a' },
      { label: 'y', value: 'b|c' },
    ]);
    expect(left).not.toBe(right);
  });

  it('distinguishes explicit null from the empty string', () => {
    const withNull = encodeFingerprintPayload('d', [{ label: 'x', value: null }]);
    const withEmpty = encodeFingerprintPayload('d', [{ label: 'x', value: '' }]);
    expect(withNull).not.toBe(withEmpty);
  });

  it('measures length in UTF-8 bytes, not UTF-16 code units', () => {
    expect(utf8ByteLength('a')).toBe(1);
    expect(utf8ByteLength('中')).toBe(3);
    // U+1F600 是 BMP 外字符：UTF-16 占 2 个 code unit，UTF-8 占 4 字节。
    expect(utf8ByteLength('\u{1F600}')).toBe(4);
    expect('\u{1F600}'.length).toBe(2);
  });
});

describe('Feature: wakeup-ugc, Task 2.1: locale-independent code point ordering', () => {
  it('orders BMP-outside characters after all BMP characters', () => {
    // 默认 `<` 按 UTF-16 code unit 比较，会把 U+1F600（代理对 D83D DE00）排到 U+FFFD 之前。
    const astral = '\u{1F600}';
    const highBmp = '\uFFFD';
    expect(compareCodePoints(highBmp, astral)).toBeLessThan(0);
    expect(astral < highBmp).toBe(true);
  });

  it('is a total order: antisymmetric and reflexive on samples', () => {
    const samples = ['', 'a', 'A', 'ab', 'b', '中', '\u{1F600}', '\uFFFD'];
    for (const left of samples) {
      expect(compareCodePoints(left, left)).toBe(0);
      for (const right of samples) {
        // `|| 0` 把 -0 归一为 0：JS 里 -Math.sign(0) === -0，而 toBe 用 Object.is 区分 0 与 -0。
        const forward = Math.sign(compareCodePoints(left, right)) || 0;
        const backward = Math.sign(compareCodePoints(right, left)) || 0;
        expect(forward).toBe(-backward || 0);
      }
    }
  });

  it('treats a prefix as smaller than its extension', () => {
    expect(compareCodePoints('ab', 'abc')).toBeLessThan(0);
  });
});

describe('Feature: wakeup-ugc, Task 2.1: validation baseline', () => {
  const components = {
    definitionRegistryVersion: 'reg-1',
    schemaCatalogVersion: 'schema-1',
    integrationContractFingerprint: 'contracts-1',
    diagnosticCatalogVersion: 'dcat-1',
    quotaProfileId: 'profile-1',
    quotaProfileVersion: 'v1',
  };

  it('produces the same fingerprint for the same dependency snapshot', () => {
    const first = createValidationBaseline(gateway, components);
    const second = createValidationBaseline(gateway, { ...components });
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(diffValidationBaselines(first, second)).toEqual([]);
  });

  it('invalidates the baseline when any single component changes', () => {
    const reference = createValidationBaseline(gateway, components);
    for (const key of Object.keys(components) as (keyof typeof components)[]) {
      const changed = createValidationBaseline(gateway, { ...components, [key]: 'changed' });
      expect(changed.fingerprint).not.toBe(reference.fingerprint);
      const diff = diffValidationBaselines(reference, changed);
      expect(diff.map((entry) => entry.field)).toContain(key);
      expect(diff.map((entry) => entry.field)).toContain('fingerprint');
    }
  });

  it('compares by value so an identical object reference cannot mask a change', () => {
    const reference = createValidationBaseline(gateway, components);
    const stale = { ...reference, definitionRegistryVersion: 'reg-2' };
    expect(diffValidationBaselines(reference, stale)).toEqual([
      { field: 'definitionRegistryVersion', expected: 'reg-1', actual: 'reg-2' },
    ]);
  });
});

describe('Feature: wakeup-ugc, Task 2.1: result channel invariants', () => {
  it('injects a diagnostic-integrity failure when a rejection carries no blocking diagnostic', () => {
    // 需求 14.5：没有 error 级诊断的拒绝本身是无效验证结果，必须暴露而不是静默通过。
    const rejected = ugcReject([]);
    expect(rejected.ok).toBe(false);
    expect(hasBlockingDiagnostic(rejected.diagnostics)).toBe(true);
    expect(rejected.diagnostics.map((entry) => entry.code)).toContain('E_LOAD_DIAGNOSTIC_FAILURE');
  });

  it('does not inject anything when a blocking diagnostic is already present', () => {
    const provided = ugcReject([
      {
        code: 'E_LOAD_JSON_SYNTAX',
        severity: 'error',
        message: 'boom',
        phase: 0,
        at: null,
        path: null,
        sourcePackage: 'pkg-1',
        sourceSpan: null,
      },
    ]);
    expect(provided.diagnostics).toHaveLength(1);
    expect(provided.diagnostics[0]?.code).toBe('E_LOAD_JSON_SYNTAX');
  });

  it('treats warn-only diagnostic sets as non-blocking on the success path', () => {
    const accepted = ugcOk('value', [
      {
        code: 'E_LOAD_PRESENTATION_FALLBACK',
        severity: 'warn',
        message: 'fallback',
        phase: 0,
        at: null,
        path: null,
        sourcePackage: 'pkg-1',
        sourceSpan: null,
      },
    ]);
    expect(accepted.ok).toBe(true);
    expect(hasBlockingDiagnostic(accepted.diagnostics)).toBe(false);
  });

  it('freezes returned diagnostic collections', () => {
    expect(Object.isFrozen(ugcOk(1).diagnostics)).toBe(true);
    expect(Object.isFrozen(ugcReject([]).diagnostics)).toBe(true);
  });
});

describe('Feature: wakeup-ugc, Task 2.1: stage and presentation ordering', () => {
  it('orders skipped checks by stage topology, then check id, then root cause', () => {
    const later = createSkippedCheck({ stage: 'reference-resolution', checkId: 'a', blockedByDiagnosticId: 'r1' });
    const earlier = createSkippedCheck({ stage: 'decode', checkId: 'z', blockedByDiagnosticId: 'r1' });
    expect(compareSkippedChecks(earlier, later)).toBeLessThan(0);

    const sameStageA = createSkippedCheck({ stage: 'decode', checkId: 'a', blockedByDiagnosticId: 'r2' });
    expect(compareSkippedChecks(sameStageA, earlier)).toBeLessThan(0);
  });

  it('accepts a fallback decision only when the semantic fingerprint is unchanged', () => {
    const preserving = createPresentationFallbackDecision({
      definitionId: 'weapon:shotgun',
      jsonPath: '/icon',
      missingAsset: 'icon:missing',
      fallbackAsset: 'icon:placeholder',
      semanticFingerprintBefore: 'sem-1',
      semanticFingerprintAfter: 'sem-1',
    });
    expect(isSemanticsPreserving(preserving)).toBe(true);

    const polluting = createPresentationFallbackDecision({
      ...preserving,
      semanticFingerprintAfter: 'sem-2',
    });
    expect(isSemanticsPreserving(polluting)).toBe(false);
  });
});

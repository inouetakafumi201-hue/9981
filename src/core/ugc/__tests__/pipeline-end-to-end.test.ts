/**
 * 任务 6 / 7 / 8 / 9 验收测试：通过公共 Facade 驱动完整流水线。
 *
 * 全部用例都走 `facade.validate` / `facade.activate` 两个生产入口，不直接调用任何内部阶段——
 * 这是 design.md Testing strategy 的硬要求（Tests must run through the production entry points）。
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_ADAPTERS,
  handAuthoredAdapter,
  editorAdapter,
  naturalLanguageAdapter,
} from '../adapter/adapters.js';
import { createCandidateChangeRequest, createCandidateSource } from '../model/candidate.js';
import type { CandidateChangeRequest, ChangeOperation, TargetOwnership } from '../model/candidate.js';
import { createHarness } from './harness.js';
import type { Harness } from './harness.js';

const VALID_BASE = JSON.stringify({
  schemaVersion: '1.0.0',
  id: 'weapon:shotgun',
  kind: 'weapon-class',
  spread: { profile: 'scatter' },
});

function source(overrides: { readonly documentId?: string; readonly packageId?: string } = {}) {
  return createCandidateSource({
    kind: 'hand-authored',
    documentId: overrides.documentId ?? 'doc-1',
    packageId: overrides.packageId ?? 'pkg-1',
    sourceName: 'weapons.json',
    receivedAtSequence: 1,
  });
}

function requestOf(
  text: string,
  options: {
    readonly operation?: ChangeOperation;
    readonly target?: TargetOwnership;
    readonly expectedTargetId?: string;
    readonly documentId?: string;
    readonly packageId?: string;
  } = {},
): CandidateChangeRequest {
  const document = handAuthoredAdapter.toCandidate(
    text,
    source({ documentId: options.documentId, packageId: options.packageId }),
    options.target ?? 'base-layer',
  );
  return createCandidateChangeRequest({
    operation: options.operation ?? 'add',
    document,
    expectedTargetId: options.expectedTargetId,
  });
}

function activateValid(harness: Harness, request = requestOf(VALID_BASE)) {
  const report = harness.facade.validate(request);
  if (report.validated === null) {
    throw new Error(`expected validated, got: ${report.diagnostics.map((d) => d.code).join(',')}`);
  }
  return { report, result: harness.facade.activate(report.validated, report.baseline) };
}

describe('Feature: wakeup-ugc, Task 9.1: successful end-to-end activation', () => {
  it('validates then activates a valid base-layer candidate exactly once', () => {
    const harness = createHarness();
    const { report, result } = activateValid(harness);

    expect(report.status).toBe('validated');
    expect(report.candidateFingerprint).not.toBeNull();
    expect(report.changeRequestFingerprint).not.toBeNull();
    expect(report.changeRequestBinding?.operation).toBe('add');
    expect(report.skippedChecks).toEqual([]);

    expect(result.status).toBe('activated');
    expect(result.unchanged).toBe(false);
    expect(result.previousSnapshotFingerprint).not.toBe(result.activeSnapshotFingerprint);
    // 提交只允许调用注册表一次（需求 13.7）。
    expect(harness.registry.calls.activate).toBe(1);
  });

  it('records the consumed quota budget in the report', () => {
    const harness = createHarness();
    const report = harness.facade.validate(requestOf(VALID_BASE));
    expect(report.budget.inputBytes.used).toBeGreaterThan(0);
    expect(report.budget.astNodes.used).toBeGreaterThan(0);
    expect(report.budget.outputBytes.used).toBeGreaterThan(0);
  });

  it('exposes no force, skip, trusted or direct-registry method on the facade', () => {
    const harness = createHarness();
    expect(Object.keys(harness.facade).sort()).toEqual(['activate', 'validate']);
    const asRecord = harness.facade as unknown as Record<string, unknown>;
    for (const forbidden of ['force', 'forceActivate', 'skipValidation', 'trustedSource', 'activateWithErrors', 'registry', 'worldState']) {
      expect(asRecord[forbidden]).toBeUndefined();
    }
  });
});

describe('Feature: wakeup-ugc, Task 6.1: source-route equivalence', () => {
  it('produces equivalent canonical identity for equivalent bytes from every adapter', () => {
    const harness = createHarness();
    const fingerprints = ALL_ADAPTERS.map((adapter) => {
      const document = adapter.toCandidate(VALID_BASE, source(), 'base-layer');
      const report = harness.facade.validate(createCandidateChangeRequest({ operation: 'add', document }));
      return report.candidateFingerprint;
    });
    expect(new Set(fingerprints).size).toBe(1);
    expect(fingerprints[0]).not.toBeNull();
  });

  it('gives the same change-request identity regardless of source kind', () => {
    // source.kind 是审计字段，不参与绑定，因此不改变语义身份（需求 3.10）。
    const harness = createHarness();
    const identities = [handAuthoredAdapter, editorAdapter, naturalLanguageAdapter].map((adapter) => {
      const document = adapter.toCandidate(VALID_BASE, source(), 'base-layer');
      return harness.facade.validate(createCandidateChangeRequest({ operation: 'add', document })).changeRequestFingerprint;
    });
    expect(new Set(identities).size).toBe(1);
  });

  it('normalises whitespace and key order differences to one identity', () => {
    const harness = createHarness();
    const reordered = JSON.stringify({
      spread: { profile: 'scatter' },
      kind: 'weapon-class',
      id: 'weapon:shotgun',
      schemaVersion: '1.0.0',
    });
    const spaced = `{\n  "schemaVersion" : "1.0.0",\n  "id":"weapon:shotgun",\n  "kind":"weapon-class",\n  "spread":{ "profile":"scatter" }\n}`;
    const a = harness.facade.validate(requestOf(VALID_BASE)).candidateFingerprint;
    const b = harness.facade.validate(requestOf(reordered)).candidateFingerprint;
    const c = harness.facade.validate(requestOf(spaced)).candidateFingerprint;
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('cannot mark adapter output as validated', () => {
    const document = handAuthoredAdapter.toCandidate(VALID_BASE, source(), 'base-layer');
    const asRecord = document as unknown as Record<string, unknown>;
    expect(asRecord['validated']).toBeUndefined();
    expect(asRecord['trusted']).toBeUndefined();
    expect(Object.keys(document).sort()).toEqual(['source', 'targetOwnership', 'utf8']);
  });
});

describe('Feature: wakeup-ugc, Task 6.2: stage DAG, aggregation and skipped checks', () => {
  it('records skipped downstream checks with a root cause when decoding fails', () => {
    const harness = createHarness();
    const report = harness.facade.validate(requestOf('{"schemaVersion":'));

    expect(report.status).toBe('rejected');
    expect(report.diagnostics[0]?.code).toBe('E_LOAD_JSON_SYNTAX');
    expect(report.skippedChecks.length).toBeGreaterThan(0);
    for (const skipped of report.skippedChecks) {
      // 每个跳过项都必须指向一个具体的根诊断，而不是笼统地说"前面出错了"（需求 14.7）。
      expect(skipped.blockedByDiagnosticId).not.toBe('unknown');
      expect(skipped.checkId.length).toBeGreaterThan(0);
    }
    expect(harness.registry.calls.activate).toBe(0);
  });

  it('aggregates every independently discoverable upstream error in one report', () => {
    const harness = createHarness({
      validator: {
        errors: [
          { definitionId: 'weapon:shotgun', jsonPath: '/unknownA', condition: 'unknown-field' },
          { definitionId: 'weapon:shotgun', jsonPath: '/unknownB', condition: 'unknown-field' },
          { definitionId: 'weapon:rifle', jsonPath: '/id', condition: 'duplicate-id' },
        ],
      },
    });
    const report = harness.facade.validate(requestOf(VALID_BASE));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.filter((d) => d.code === 'E_LOAD_UNKNOWN_FIELD')).toHaveLength(2);
    expect(report.diagnostics.some((d) => d.code === 'E_LOAD_DUPLICATE_ID')).toBe(true);
  });

  it('produces a deterministic report for repeated runs of the same candidate', () => {
    const harness = createHarness({
      validator: {
        errors: [
          { definitionId: 'b', jsonPath: '/z', condition: 'unknown-field' },
          { definitionId: 'a', jsonPath: '/y', condition: 'unknown-field' },
        ],
      },
    });
    const signature = () =>
      harness.facade
        .validate(requestOf(VALID_BASE))
        .diagnostics.map((d) => `${d.code}|${d.at?.def ?? '-'}|${d.path ?? '-'}`)
        .join('#');
    expect(signature()).toBe(signature());
  });

  it('fails closed when the upstream validator cannot prove a mandatory capability', () => {
    const harness = createHarness({ validator: { omitCapabilities: ['numeric-classification'] } });
    const report = harness.facade.validate(requestOf(VALID_BASE));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.some((d) => d.code === 'E_LOAD_UNRESOLVED_CONTRACT')).toBe(true);
    expect(report.diagnostics.find((d) => d.code === 'E_LOAD_UNRESOLVED_CONTRACT')?.reason).toContain('numeric-classification');
  });

  it('fails closed when the reference resolver cannot prove a mandatory capability', () => {
    const harness = createHarness({ resolver: { omitCapabilities: ['inbound-closure-revalidation'] } });
    const report = harness.facade.validate(requestOf(VALID_BASE));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.some((d) => d.code === 'E_LOAD_UNRESOLVED_CONTRACT')).toBe(true);
  });

  it('rejects a candidate whose reference target is missing and skips activation precheck', () => {
    const harness = createHarness({ resolver: { missingTarget: 'weapon:missing' } });
    const report = harness.facade.validate(requestOf(VALID_BASE));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.some((d) => d.code === 'E_REF_MISSING')).toBe(true);
    expect(report.skippedChecks.some((entry) => entry.stage === 'activation-precheck')).toBe(true);
  });

  it('rejects a prohibited execution construct before reaching the upstream validator', () => {
    const harness = createHarness();
    const text = JSON.stringify({ schemaVersion: '1.0.0', effects: [{ eval: 'drop(player)' }] });
    const report = harness.facade.validate(requestOf(text));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.some((d) => d.code === 'E_LOAD_PROHIBITED_CONSTRUCT')).toBe(true);
    expect(report.skippedChecks.some((entry) => entry.stage === 'definition-validation')).toBe(true);
  });

  it('does not treat the same word in free text as a prohibited construct', () => {
    const harness = createHarness();
    const text = JSON.stringify({ schemaVersion: '1.0.0', description: '用 eval 之力开门' });
    const report = harness.facade.validate(requestOf(text));
    expect(report.diagnostics.some((d) => d.code === 'E_LOAD_PROHIBITED_CONSTRUCT')).toBe(false);
  });
});

describe('Feature: wakeup-ugc, Task 6.5: compatibility declarations are only forwarded', () => {
  it('does not touch the runtime gateway when the candidate declares nothing', () => {
    const harness = createHarness();
    harness.facade.validate(requestOf(VALID_BASE));
    expect(harness.runtime.calls.playpack).toBe(0);
    expect(harness.runtime.calls.activeMatch).toBe(0);
  });

  it('forwards a playpack/save declaration exactly once', () => {
    const harness = createHarness();
    const text = JSON.stringify({ schemaVersion: '1.0.0', compatibility: { savedPlaypackVersion: '2.0.0' } });
    harness.facade.validate(requestOf(text));
    expect(harness.runtime.calls.playpack).toBe(1);
    expect(harness.runtime.calls.activeMatch).toBe(0);
  });

  it('preserves the upstream refusal of an active-match replacement verbatim', () => {
    const harness = createHarness();
    const text = JSON.stringify({ schemaVersion: '1.0.0', replaceActivePlaypack: { playpackId: 'pp:1' } });
    const report = harness.facade.validate(requestOf(text));
    expect(harness.runtime.calls.activeMatch).toBe(1);
    expect(report.status).toBe('rejected');
    // 上游拒绝原样保留，不被降级为警告（需求 12.11、14.11）。
    const forwarded = report.diagnostics.find((d) => d.code === 'E_MIG_NEWER_SAVE');
    expect(forwarded).toBeDefined();
    expect(forwarded?.severity).toBe('error');
    expect(harness.registry.calls.activate).toBe(0);
  });
});

describe('Feature: wakeup-ugc, Task 7: presentation fallback and semantic guard', () => {
  const gap = {
    definitionId: 'weapon:shotgun',
    jsonPath: '/icon',
    missingAsset: 'icon:shotgun',
    expectedTypeTag: 'icon',
    sourceSpan: null,
  } as const;

  it('activates with a warning only when the semantic fingerprint is unchanged', () => {
    const harness = createHarness({ schema: { gaps: [gap] } });
    const { report, result } = activateValid(harness);

    const warnings = report.diagnostics.filter((d) => d.code === 'E_LOAD_PRESENTATION_FALLBACK');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.severity).toBe('warn');
    expect(warnings[0]?.at?.def).toBe('weapon:shotgun');
    expect(warnings[0]?.path).toBe('/icon');
    expect(warnings[0]?.actual).toBe('icon:placeholder');
    expect(result.status).toBe('activated');
  });

  it('rejects when the fallback would change the semantic fingerprint', () => {
    const harness = createHarness({ schema: { gaps: [gap], pollutesSemantics: true } });
    const report = harness.facade.validate(requestOf(VALID_BASE));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.some((d) => d.code === 'E_LOAD_SEMANTIC_FIELD_DAMAGED')).toBe(true);
  });

  it('rejects a damaged semantic field with no fallback path', () => {
    const harness = createHarness({ schema: { gaps: [gap], classify: () => 'semantic' } });
    const report = harness.facade.validate(requestOf(VALID_BASE));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.some((d) => d.code === 'E_LOAD_SEMANTIC_FIELD_DAMAGED')).toBe(true);
    expect(harness.registry.calls.activate).toBe(0);
  });

  it('rejects when the schema cannot prove the field is non-semantic', () => {
    const harness = createHarness({ schema: { gaps: [gap], provesNonSemantic: false } });
    const report = harness.facade.validate(requestOf(VALID_BASE));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.some((d) => d.code === 'E_LOAD_SEMANTIC_FIELD_DAMAGED')).toBe(true);
  });

  it('rejects a type-incompatible fallback', () => {
    const harness = createHarness({
      schema: { gaps: [gap], fallback: { assetId: 'sound:beep', typeTag: 'sound' } },
    });
    const report = harness.facade.validate(requestOf(VALID_BASE));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.some((d) => d.code === 'E_LOAD_SEMANTIC_FIELD_DAMAGED')).toBe(true);
  });

  it('accepts an omitted truly-optional field with no registered fallback', () => {
    const harness = createHarness({ schema: { gaps: [gap], fallback: null } });
    const report = harness.facade.validate(requestOf(VALID_BASE));
    expect(report.status).toBe('validated');
    expect(report.diagnostics.some((d) => d.code === 'E_LOAD_PRESENTATION_FALLBACK')).toBe(false);
  });
});

describe('Feature: wakeup-ugc, Task 8: unforgeable artifact and atomic activation', () => {
  it('refuses a forged artifact that was never minted internally', () => {
    const harness = createHarness();
    const report = harness.facade.validate(requestOf(VALID_BASE));
    if (report.validated === null) throw new Error('fixture should validate');

    // 用类型断言复制一个同形对象：编译期能过，运行期过不了 WeakSet 铸造守卫。
    const forged = { ...report.validated } as typeof report.validated;
    const result = harness.facade.activate(forged, report.baseline);

    expect(result.status).toBe('rejected');
    expect(result.unchanged).toBe(true);
    expect(result.diagnostics[0]?.code).toBe('E_LOAD_ACTIVATION_FAILED');
    expect(harness.registry.calls.activate).toBe(0);
  });

  it('rejects a stale baseline and requires complete revalidation', () => {
    const harness = createHarness();
    const report = harness.facade.validate(requestOf(VALID_BASE));
    if (report.validated === null) throw new Error('fixture should validate');

    // 验证之后、提交之前注册表版本发生变化（TOCTOU）。
    harness.registry.bumpVersion();
    const result = harness.facade.activate(report.validated, report.baseline);

    expect(result.status).toBe('rejected');
    expect(result.unchanged).toBe(true);
    expect(result.diagnostics.every((d) => d.code === 'E_LOAD_BASELINE_STALE')).toBe(true);
    expect(result.diagnostics[0]?.scope).toBe('registry');
    expect(harness.registry.calls.activate).toBe(0);
  });

  it('cannot reuse one request\u2019s artifact for a different target registry layer', () => {
    // 注册表属于 play-layer，产物针对 base-layer：内容相同也不得授权（需求 13.13、6.7、6.8）。
    const harness = createHarness({ targetOwnership: 'play-layer' });
    const report = harness.facade.validate(requestOf(VALID_BASE, { target: 'base-layer' }));
    if (report.validated === null) throw new Error('fixture should validate');

    const result = harness.facade.activate(report.validated, report.baseline);
    expect(result.status).toBe('rejected');
    expect(harness.registry.calls.activate).toBe(0);
  });

  it('gives different change-request identities to the same content from different documents', () => {
    const harness = createHarness();
    const first = harness.facade.validate(requestOf(VALID_BASE, { documentId: 'doc-1' }));
    const second = harness.facade.validate(requestOf(VALID_BASE, { documentId: 'doc-2' }));
    expect(second.candidateFingerprint).toBe(first.candidateFingerprint);
    // 内容指纹相同，但请求身份必须不同，否则一次验证能授权另一个请求。
    expect(second.changeRequestFingerprint).not.toBe(first.changeRequestFingerprint);
  });

  it('leaves the registry byte-equivalent when the gateway rejects the commit', () => {
    const harness = createHarness();
    const report = harness.facade.validate(requestOf(VALID_BASE));
    if (report.validated === null) throw new Error('fixture should validate');
    const before = harness.registry.readSnapshot().snapshotFingerprint;

    harness.registry.failNext('reject');
    const result = harness.facade.activate(report.validated, report.baseline);

    expect(result.status).toBe('rejected');
    expect(result.unchanged).toBe(true);
    expect(harness.registry.readSnapshot().snapshotFingerprint).toBe(before);
  });

  it('converts a thrown gateway commit into an activation error without leaking the exception', () => {
    const harness = createHarness();
    const report = harness.facade.validate(requestOf(VALID_BASE));
    if (report.validated === null) throw new Error('fixture should validate');

    harness.registry.failNext('throw');
    const result = harness.facade.activate(report.validated, report.baseline);
    expect(result.status).toBe('rejected');
    expect(result.diagnostics[0]?.code).toBe('E_LOAD_ACTIVATION_FAILED');
    expect(result.unchanged).toBe(true);
  });

  it('rejects an invalid gateway result shape', () => {
    const harness = createHarness();
    const report = harness.facade.validate(requestOf(VALID_BASE));
    if (report.validated === null) throw new Error('fixture should validate');

    harness.registry.failNext('invalid-result');
    const result = harness.facade.activate(report.validated, report.baseline);
    expect(result.status).toBe('rejected');
    expect(result.diagnostics[0]?.code).toBe('E_LOAD_ACTIVATION_FAILED');
  });

  it('rejects a gateway that claims success without publishing a new snapshot', () => {
    // 「网关说成功」不等于「变更真的发布了」；UGC 必须核对可观察证据。
    const harness = createHarness();
    const report = harness.facade.validate(requestOf(VALID_BASE));
    if (report.validated === null) throw new Error('fixture should validate');

    harness.registry.failNext('silent-success');
    const result = harness.facade.activate(report.validated, report.baseline);
    expect(result.status).toBe('rejected');
    expect(result.diagnostics[0]?.code).toBe('E_LOAD_ACTIVATION_FAILED');
  });

  it('never activates a rejected candidate', () => {
    const harness = createHarness({ validator: { errors: [{ definitionId: 'x', jsonPath: '/a', condition: 'unknown-field' }] } });
    const report = harness.facade.validate(requestOf(VALID_BASE));
    expect(report.validated).toBeNull();
    expect(harness.registry.calls.activate).toBe(0);
    expect(harness.registry.readSnapshot().activeDefinitionIds).toEqual([]);
  });
});

describe('Feature: wakeup-ugc, Task 6.2: ingress envelope checks', () => {
  it('rejects an incomplete source identity', () => {
    const harness = createHarness();
    const report = harness.facade.validate(requestOf(VALID_BASE, { documentId: '' }));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics[0]?.code).toBe('E_LOAD_SCHEMA_CONTRACT');
  });

  it('requires an expected target for replace and forbids it for add', () => {
    const harness = createHarness();
    const missingTarget = harness.facade.validate(requestOf(VALID_BASE, { operation: 'replace' }));
    expect(missingTarget.status).toBe('rejected');

    const strayTarget = harness.facade.validate(requestOf(VALID_BASE, { operation: 'add', expectedTargetId: 'weapon:shotgun' }));
    expect(strayTarget.status).toBe('rejected');

    const ok = harness.facade.validate(requestOf(VALID_BASE, { operation: 'replace', expectedTargetId: 'weapon:shotgun' }));
    expect(ok.status).toBe('validated');
  });

  it('does not start validation when the trusted quota profile is incomplete', () => {
    const harness = createHarness({ quota: { astNodes: undefined } });
    const report = harness.facade.validate(requestOf(VALID_BASE));
    expect(report.status).toBe('rejected');
    expect(report.diagnostics.some((d) => d.code === 'E_LOAD_UNRESOLVED_CONTRACT')).toBe(true);
    expect(report.diagnostics[0]?.scope).toBe('host');
  });
});

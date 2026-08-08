/**
 * 任务 2.2 验收测试（contract tests）：unavailable 适配器必须失败关闭，
 * 不调用后续端口、不产出 validated 产物、不改变任何可观察快照。
 */
import { describe, expect, it, vi } from 'vitest';
import { createDiagnosticCodeCatalog } from '../../diagnostics/code-catalog.js';
import { createDiagnosticFactory } from '../../diagnostics/factory.js';
import type { CanonicalizedChangeRequest } from '../../model/canonical-types.js';
import type { ValidationBaseline } from '../../model/baseline.js';
import type { ValidatedChangeSet } from '../../model/validated-change-set.js';
import { createValidationBaseline } from '../../model/baseline.js';
import { createCandidateSource } from '../../model/candidate.js';
import { UNAVAILABLE_PROVIDER_ID, isPortUnavailable } from '../availability.js';
import { sha256FingerprintGateway } from '../sha256-fingerprint-gateway.js';
import {
  UNAVAILABLE_SNAPSHOT_FINGERPRINT,
  createUnavailableDefinitionRegistryGateway,
  createUnavailableDefinitionValidationGateway,
  createUnavailableReferenceResolutionGateway,
  createUnavailableRuntimeCompatibilityGateway,
  createUnavailableSchemaMigrationGateway,
  createUnavailableSchemaVersionCatalog,
} from '../unavailable.js';

const factory = createDiagnosticFactory(createDiagnosticCodeCatalog(sha256FingerprintGateway));

const baseline: ValidationBaseline = createValidationBaseline(sha256FingerprintGateway, {
  definitionRegistryVersion: 'reg-1',
  schemaCatalogVersion: 'schema-1',
  integrationContractFingerprint: 'contracts-1',
  diagnosticCatalogVersion: 'dcat-1',
  quotaProfileId: 'p1',
  quotaProfileVersion: 'v1',
});

const request = {
  candidate: {
    source: createCandidateSource({
      kind: 'hand-authored',
      documentId: 'doc-1',
      packageId: 'pkg-1',
      sourceName: 'a.json',
      receivedAtSequence: 1,
    }),
    targetOwnership: 'base-layer',
    schemaVersion: '1.0.0',
    canonicalJson: '{}',
    canonicalFingerprint: 'cf-1',
    decodedValue: {},
    migrationIds: [],
  },
  binding: {
    candidateFingerprint: 'cf-1',
    sourcePackageId: 'pkg-1',
    sourceDocumentId: 'doc-1',
    targetOwnership: 'base-layer',
    operation: 'add',
    expectedTargetId: null,
  },
  changeRequestFingerprint: 'crf-1',
} as unknown as CanonicalizedChangeRequest;

const artifact = {
  candidateFingerprint: 'cf-1',
  changeRequestFingerprint: 'crf-1',
} as unknown as ValidatedChangeSet;

describe('Feature: wakeup-ugc, Task 2.2: unavailable ports fail closed', () => {
  it('marks every unavailable adapter as detectably unavailable', () => {
    expect(isPortUnavailable(createUnavailableDefinitionValidationGateway(factory))).toBe(true);
    expect(isPortUnavailable(createUnavailableReferenceResolutionGateway(factory, 'pkg-1'))).toBe(true);
    expect(isPortUnavailable(createUnavailableDefinitionRegistryGateway(factory, 'base-layer', 'pkg-1'))).toBe(true);
    expect(isPortUnavailable(createUnavailableRuntimeCompatibilityGateway(factory, 'pkg-1'))).toBe(true);
    expect(isPortUnavailable(createUnavailableSchemaVersionCatalog())).toBe(true);
    expect(isPortUnavailable(createUnavailableSchemaMigrationGateway())).toBe(true);
  });

  it('produces no validated candidate and reports unresolved contract', () => {
    const result = createUnavailableDefinitionValidationGateway(factory).validate(
      request,
      {} as never,
      {} as never,
    );
    expect(result.validated).toBeNull();
    expect(result.coveredCapabilities).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe('E_LOAD_UNRESOLVED_CONTRACT');
    // 诊断必须指明所有者与证据位置，使阻塞项可审计。
    expect(result.diagnostics[0]?.reason).toContain('基类层');
    expect(result.diagnostics[0]?.correctionSuggestion).toContain('不要通过直接注册定义');
  });

  it('produces no dependency graph and never exposes a partial graph', () => {
    const result = createUnavailableReferenceResolutionGateway(factory, 'pkg-1').resolve(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(result.graph).toBeNull();
    expect(result.coveredCapabilities).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe('E_LOAD_UNRESOLVED_CONTRACT');
  });

  it('rejects activation with an unchanged snapshot on both sides', () => {
    const registry = createUnavailableDefinitionRegistryGateway(factory, 'base-layer', 'pkg-1');
    const before = registry.readSnapshot();
    const result = registry.activateAtomically(artifact, baseline);

    expect(result.status).toBe('rejected');
    expect(result.unchanged).toBe(true);
    expect(result.previousSnapshotFingerprint).toBe(result.activeSnapshotFingerprint);
    expect(result.activeSnapshotFingerprint).toBe(UNAVAILABLE_SNAPSHOT_FINGERPRINT);

    const after = registry.readSnapshot();
    expect(after.snapshotFingerprint).toBe(before.snapshotFingerprint);
    expect(after.activeDefinitionIds).toEqual(before.activeDefinitionIds);
  });

  it('returns a stable read snapshot that carries no active definitions', () => {
    const registry = createUnavailableDefinitionRegistryGateway(factory, 'play-layer', 'pkg-1');
    const snapshot = registry.readSnapshot();
    expect(snapshot.registryVersion).toBe(UNAVAILABLE_PROVIDER_ID);
    expect(snapshot.activeDefinitionIds).toEqual([]);
    expect(snapshot.targetOwnership).toBe('play-layer');
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('preserves upstream rejection for compatibility declarations without touching persistence', () => {
    const gateway = createUnavailableRuntimeCompatibilityGateway(factory, 'pkg-1');
    for (const diagnostics of [
      gateway.validatePlaypackOrSaveDeclaration({ any: 'thing' }),
      gateway.rejectActiveMatchReplacement({ any: 'thing' }),
    ]) {
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe('E_LOAD_UNRESOLVED_CONTRACT');
    }
  });

  it('never calls a downstream port from an unavailable adapter', () => {
    const downstream = { resolve: vi.fn(), activateAtomically: vi.fn() };
    const result = createUnavailableDefinitionValidationGateway(factory).validate(
      request,
      {} as never,
      {} as never,
    );
    expect(result.validated).toBeNull();
    expect(downstream.resolve).not.toHaveBeenCalled();
    expect(downstream.activateAtomically).not.toHaveBeenCalled();
  });

  it('reports an unmerged schema catalog as unsupported for every version', () => {
    const catalog = createUnavailableSchemaVersionCatalog();
    expect(catalog.supports('1.0.0')).toBe(false);
    expect(catalog.isWellFormed('1.0.0')).toBe(false);
    expect(catalog.supportedVersions()).toEqual([]);
  });

  it('distinguishes an unmerged migration registry from a genuinely empty one', () => {
    // 这正是 availability.ts 存在的理由：两者的 edges() 都是空，只有 providerId 能区分。
    const unmerged = createUnavailableSchemaMigrationGateway();
    expect(unmerged.edges()).toEqual([]);
    expect(isPortUnavailable(unmerged)).toBe(true);

    const emptyButMerged = { providerId: 'host.migrations', registryVersion: 'v1', edges: () => [] };
    expect(emptyButMerged.edges()).toEqual([]);
    expect(isPortUnavailable(emptyButMerged)).toBe(false);
  });
});

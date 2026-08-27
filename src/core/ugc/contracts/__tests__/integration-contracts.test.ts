/**
 * 任务 5.1 / 5.2 验收测试：契约目录失败关闭、确定性指纹、基线捕获与提交前复检。
 */
import { describe, expect, it, vi } from 'vitest';
import type { SourceRecord } from '../../../kernel/state/diagnostic';
import { createDiagnosticCodeCatalog } from '../../diagnostics/code-catalog';
import { createDiagnosticFactory } from '../../diagnostics/factory';
import type { IntegrationContract } from '../../model/contract-types';
import { QUOTA_KINDS } from '../../model/quota-types';
import type { TrustedQuotaProfile } from '../../model/quota-types';
import { sha256FingerprintGateway } from '../../ports/sha256-fingerprint-gateway';
import { createUnavailableDefinitionRegistryGateway } from '../../ports/unavailable';
import type { DefinitionRegistryGateway } from '../../ports/definition-ports';
import type { SchemaVersionCatalog } from '../../ports/schema-ports';
import { captureBaseline, recheckBaseline } from '../../baseline/baseline-factory';
import type { BaselineSources } from '../../baseline/baseline-factory';
import { createIntegrationContractCatalog, inspectContracts } from '../integration-contract-catalog';

const diagnosticCatalog = createDiagnosticCodeCatalog(sha256FingerprintGateway);
const factory = createDiagnosticFactory(diagnosticCatalog);
const fingerprint = sha256FingerprintGateway;

const sourceRecord: SourceRecord = {
  sourceId: 'src-1',
  documentUri: 'docs/contract.md',
  sourcePackage: 'pkg-provider',
  contentHash: 'hash-1',
  precedence: 1,
  owningLayer: '基类层',
  normativeStatus: 'normative',
  span: { file: 'docs/contract.md', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 0 } },
};

function contract(overrides: Partial<IntegrationContract> = {}): IntegrationContract {
  return {
    domain: 'core-mechanics',
    providerId: 'provider.core',
    version: '1.0.0',
    exportedDefKinds: ['action'],
    exportedSemanticFamilies: ['cost'],
    referenceConstraintsFingerprint: 'rc-1',
    sourceRecords: [sourceRecord],
    ...overrides,
  };
}

function catalogOf(contracts: readonly IntegrationContract[]) {
  const built = createIntegrationContractCatalog({ fingerprint, factory }, contracts);
  if (!built.ok) throw new Error(`catalog rejected: ${built.diagnostics.map((d) => d.code).join(',')}`);
  return built.value;
}

function quotaProfile(overrides: Partial<Record<string, unknown>> = {}): TrustedQuotaProfile {
  const base: Record<string, unknown> = { profileId: 'p1', version: 'v1' };
  for (const kind of QUOTA_KINDS) base[kind] = 1000;
  return { ...base, ...overrides } as unknown as TrustedQuotaProfile;
}

function schemaCatalog(version: string): SchemaVersionCatalog {
  return {
    providerId: 'test.schema',
    catalogVersion: version,
    supports: () => true,
    isWellFormed: () => true,
    supportedVersions: () => ['1.0.0'],
    compare: () => 0,
  };
}

describe('Feature: wakeup-ugc, Task 5.1: contract catalog integrity', () => {
  it('rejects two providers claiming the same domain', () => {
    const problems = inspectContracts([contract(), contract({ providerId: 'provider.other' })]);
    expect(problems.some((problem) => problem.kind === 'duplicate-provider')).toBe(true);

    const built = createIntegrationContractCatalog({ fingerprint, factory }, [
      contract(),
      contract({ providerId: 'provider.other' }),
    ]);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.diagnostics[0]?.code).toBe('E_LOAD_IDENTITY_CONFLICT');
  });

  it('rejects a duplicated export identity inside one provider', () => {
    const problems = inspectContracts([contract({ exportedDefKinds: ['action'], exportedSemanticFamilies: ['action'] })]);
    expect(problems.some((problem) => problem.kind === 'conflicting-export')).toBe(true);
  });

  it('rejects empty or whitespace-padded contract identities', () => {
    for (const overrides of [{ providerId: '' }, { version: ' 1.0.0' }, { referenceConstraintsFingerprint: '' }]) {
      expect(inspectContracts([contract(overrides)]).some((p) => p.kind === 'empty-identity')).toBe(true);
    }
  });

  it('accepts a well-formed multi-domain catalog', () => {
    const problems = inspectContracts([
      contract(),
      contract({ domain: 'space-items', providerId: 'provider.space' }),
      contract({ domain: 'ai', providerId: 'provider.ai' }),
    ]);
    expect(problems).toEqual([]);
  });
});

describe('Feature: wakeup-ugc, Task 5.1: fail-closed resolution', () => {
  it('rejects a dependency on an unmerged domain instead of guessing its shape', () => {
    const catalog = catalogOf([contract()]);
    for (const domain of ['space-items', 'ai'] as const) {
      const result = catalog.resolve(domain, 'pkg-1');
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.diagnostics[0]?.code).toBe('E_LOAD_UNRESOLVED_CONTRACT');
      expect(result.diagnostics[0]?.reason).toContain(domain);
    }
  });

  it('resolves an exported def kind and semantic family with provenance', () => {
    const catalog = catalogOf([contract()]);
    const asKind = catalog.resolveExport('core-mechanics', 'action', 'pkg-1');
    expect(asKind.ok).toBe(true);
    if (asKind.ok) {
      expect(asKind.value.exportKind).toBe('def-kind');
      expect(asKind.value.sourceRecords).toHaveLength(1);
    }
    const asFamily = catalog.resolveExport('core-mechanics', 'cost', 'pkg-1');
    expect(asFamily.ok).toBe(true);
    if (asFamily.ok) expect(asFamily.value.exportKind).toBe('semantic-family');
  });

  it('rejects a capability absent from the registered provider with expected information', () => {
    const catalog = catalogOf([contract()]);
    const result = catalog.resolveExport('core-mechanics', 'not-exported', 'pkg-1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe('E_LOAD_UNRESOLVED_CONTRACT');
    expect(result.diagnostics[0]?.expected).toBe('not-exported');
    expect(result.diagnostics[0]?.reason).toContain('provider.core');
  });

  it('produces a stable fingerprint regardless of registration order', () => {
    const a = catalogOf([contract(), contract({ domain: 'ai', providerId: 'provider.ai' })]).snapshot();
    const b = catalogOf([contract({ domain: 'ai', providerId: 'provider.ai' }), contract()]).snapshot();
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(b.contracts.map((entry) => entry.domain)).toEqual(a.contracts.map((entry) => entry.domain));
  });

  it('changes the fingerprint when a contract version or constraint changes', () => {
    const base = catalogOf([contract()]).snapshot().fingerprint;
    expect(catalogOf([contract({ version: '2.0.0' })]).snapshot().fingerprint).not.toBe(base);
    expect(catalogOf([contract({ referenceConstraintsFingerprint: 'rc-2' })]).snapshot().fingerprint).not.toBe(base);
    expect(catalogOf([contract({ exportedDefKinds: ['action', 'rule'] })]).snapshot().fingerprint).not.toBe(base);
  });

  it('holds no candidate state, so registering a contract cannot auto-activate anything', () => {
    // 需求 15.10：目录没有待重试队列，也不引用任何候选，因此不存在"契约到了就自动放行"的路径。
    const catalog = catalogOf([contract()]);
    const asRecord = catalog as unknown as Record<string, unknown>;
    for (const forbidden of ['retry', 'reactivate', 'pending', 'queue', 'activate']) {
      expect(asRecord[forbidden]).toBeUndefined();
    }
    expect(Object.keys(catalog).sort()).toEqual(['resolve', 'resolveExport', 'snapshot']);
  });

  it('stores no domain evaluation logic, only exported identities', () => {
    const snapshot = catalogOf([contract()]).snapshot();
    const stored = snapshot.contracts[0];
    expect(Object.keys(stored ?? {}).sort()).toEqual([
      'domain',
      'exportedDefKinds',
      'exportedSemanticFamilies',
      'providerId',
      'referenceConstraintsFingerprint',
      'sourceRecords',
      'version',
    ]);
  });
});

describe('Feature: wakeup-ugc, Task 5.2: baseline capture and recheck', () => {
  function sourcesWith(overrides: Partial<BaselineSources> = {}): BaselineSources {
    return {
      registry: createUnavailableDefinitionRegistryGateway(factory, 'base-layer', 'pkg-1'),
      schemaCatalog: schemaCatalog('schema-1'),
      contracts: catalogOf([contract()]),
      diagnosticCatalog,
      quotaProfile: quotaProfile(),
      fingerprint,
      ...overrides,
    };
  }

  it('produces the same fingerprint for the same dependency snapshot', () => {
    const sources = sourcesWith();
    expect(captureBaseline(sources).fingerprint).toBe(captureBaseline(sources).fingerprint);
  });

  it('re-reads the registry on every capture instead of caching', () => {
    // 注册表版本最容易在验证与提交之间变化；复用旧快照会让 stale 检测彻底失效。
    const readSnapshot = vi.fn(() => ({
      registryVersion: 'reg-1',
      snapshotFingerprint: 'snap-1',
      targetOwnership: 'base-layer' as const,
      activeDefinitionIds: [] as readonly string[],
      payload: null,
    }));
    const registry = { ...createUnavailableDefinitionRegistryGateway(factory, 'base-layer', 'pkg-1'), readSnapshot } as unknown as DefinitionRegistryGateway;
    const sources = sourcesWith({ registry });
    captureBaseline(sources);
    captureBaseline(sources);
    expect(readSnapshot).toHaveBeenCalledTimes(2);
  });

  it('reports no mismatch when nothing changed', () => {
    const sources = sourcesWith();
    const expected = captureBaseline(sources);
    expect(recheckBaseline(sources, expected, factory, 'pkg-1')).toEqual([]);
  });

  it('emits a registry-scope stale diagnostic for each changed component', () => {
    const sources = sourcesWith();
    const expected = captureBaseline(sources);

    const changes: readonly Partial<BaselineSources>[] = [
      { schemaCatalog: schemaCatalog('schema-2') },
      { contracts: catalogOf([contract({ version: '2.0.0' })]) },
      { quotaProfile: quotaProfile({ profileId: 'p2' }) },
      { quotaProfile: quotaProfile({ version: 'v2' }) },
    ];

    for (const change of changes) {
      const diagnostics = recheckBaseline(sourcesWith(change), expected, factory, 'pkg-1');
      expect(diagnostics.length).toBeGreaterThan(0);
      for (const diagnostic of diagnostics) {
        expect(diagnostic.code).toBe('E_LOAD_BASELINE_STALE');
        expect(diagnostic.scope).toBe('registry');
        // registry scope 必须给出 expected/actual 基线身份（需求 14.4）。
        expect(diagnostic.expected).toBeDefined();
        expect(diagnostic.actual).toBeDefined();
        expect(diagnostic.correctionSuggestion).toContain('重新完整验证');
      }
    }
  });

  it('detects a changed registry version', () => {
    const expected = captureBaseline(sourcesWith());
    const registry = {
      ...createUnavailableDefinitionRegistryGateway(factory, 'base-layer', 'pkg-1'),
      readSnapshot: () => ({
        registryVersion: 'reg-moved',
        snapshotFingerprint: 'snap-2',
        targetOwnership: 'base-layer' as const,
        activeDefinitionIds: [] as readonly string[],
        payload: null,
      }),
    } as unknown as DefinitionRegistryGateway;
    const diagnostics = recheckBaseline(sourcesWith({ registry }), expected, factory, 'pkg-1');
    expect(diagnostics.some((entry) => entry.messageArgs?.['field'] === 'definitionRegistryVersion')).toBe(true);
  });

  it('includes the diagnostic catalog version so an error-code change invalidates the baseline', () => {
    const sources = sourcesWith();
    const baseline = captureBaseline(sources);
    expect(baseline.diagnosticCatalogVersion).toBe(diagnosticCatalog.version);
    expect(baseline.diagnosticCatalogVersion.startsWith('dcat-')).toBe(true);
  });
});

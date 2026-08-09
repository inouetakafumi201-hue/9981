/**
 * PT-02：解析端口与注册表端口（CAS）行为测试。
 */
import { describe, expect, it } from 'vitest';
import { MANDATORY_RESOLUTION_CAPABILITIES } from '../../../../core/ugc/ports/definition-ports.js';
import type { ValidationBaseline } from '../../../../core/ugc/model/baseline.js';
import type { ValidatedChangeSet } from '../../../../core/ugc/model/validated-change-set.js';
import { createL2PortBundle } from '../port-bundle.js';
import { budget, contractsSnapshot, makeRequest, makeValidationContext, validPackageJson } from './fixtures.js';

/** 跑一遍 validate 拿到 UpstreamValidatedCandidate。 */
function validate(bundle: ReturnType<typeof createL2PortBundle>, json: string) {
  const active = bundle.registryHandles['base-layer'].readSnapshot();
  const request = makeRequest({ canonicalJson: json });
  const result = bundle.validation.validate(request, makeValidationContext(active), budget());
  expect(result.validated).not.toBeNull();
  return { validated: result.validated!, active, request };
}

describe('PT-02: ReferenceResolutionGateway 行为', () => {
  it('合法候选解析出完整依赖图并覆盖全部强制解析能力', () => {
    const bundle = createL2PortBundle();
    const { validated, active } = validate(bundle, validPackageJson());
    const result = bundle.resolution.resolve(validated, active, contractsSnapshot(), budget());

    expect(result.graph).not.toBeNull();
    expect(result.graph?.nodes).toContain('dmg-basic');
    for (const capability of MANDATORY_RESOLUTION_CAPABILITIES) {
      expect(result.coveredCapabilities).toContain(capability);
    }
  });

  it('解析产物携带的 providerId 是本提供方', () => {
    const bundle = createL2PortBundle();
    const { validated, active } = validate(bundle, validPackageJson());
    const result = bundle.resolution.resolve(validated, active, contractsSnapshot(), budget());
    expect(result.graph?.providerId).toBe('l2-base-layer');
  });

  it('外来 validated 载荷失败关闭', () => {
    const bundle = createL2PortBundle();
    const active = bundle.registryHandles['base-layer'].readSnapshot();
    const foreign = { providerId: 'other', definitionIds: [], payload: { kind: 'x', providerId: 'other' } };
    const result = bundle.resolution.resolve(foreign, active, contractsSnapshot(), budget());
    expect(result.graph).toBeNull();
  });
});

describe('PT-02: DefinitionRegistryGateway CAS 行为', () => {
  it('陈旧基线被拒绝，且拒绝路径 unchanged=true、前后指纹相同', () => {
    const bundle = createL2PortBundle();
    const registry = bundle.registryHandles['base-layer'];
    const { validated } = validate(bundle, validPackageJson());

    // 构造一个携带真实产物的 ValidatedChangeSet，但基线版本用一个不匹配的值。
    const change = makeChangeSet(validated, 'stale-registry-version');
    const staleBaseline = makeBaseline('stale-registry-version');

    const before = registry.readSnapshot().snapshotFingerprint;
    const result = registry.activateAtomically(change, staleBaseline);

    expect(result.status).toBe('rejected');
    expect(result.unchanged).toBe(true);
    expect(result.previousSnapshotFingerprint).toBe(result.activeSnapshotFingerprint);
    expect(registry.readSnapshot().snapshotFingerprint).toBe(before);
    expect(result.diagnostics.some((d) => d.code === 'E_LOAD_BASELINE_STALE')).toBe(true);
  });

  it('基线匹配时激活成功并改变快照指纹', () => {
    const bundle = createL2PortBundle();
    const registry = bundle.registryHandles['base-layer'];
    const { validated } = validate(bundle, validPackageJson());

    const currentVersion = registry.readSnapshot().registryVersion;
    const change = makeChangeSet(validated, currentVersion);
    const baseline = makeBaseline(currentVersion);

    const before = registry.readSnapshot().snapshotFingerprint;
    const result = registry.activateAtomically(change, baseline);

    expect(result.status).toBe('activated');
    expect(result.unchanged).toBe(false);
    expect(result.activeSnapshotFingerprint).not.toBe(before);
    expect(registry.readSnapshot().activeDefinitionIds).toContain('dmg-basic');
  });

  it('目标层不符时拒绝', () => {
    const bundle = createL2PortBundle();
    const playRegistry = bundle.registryHandles['play-layer'];
    const { validated } = validate(bundle, validPackageJson());
    const version = playRegistry.readSnapshot().registryVersion;
    // change 声明 base-layer，却提交给 play-layer 注册表。
    const change = makeChangeSet(validated, version, 'base-layer');
    const result = playRegistry.activateAtomically(change, makeBaseline(version));
    expect(result.status).toBe('rejected');
    expect(result.unchanged).toBe(true);
  });
});

/** 构造携带真实上游产物的 ValidatedChangeSet（测试用；生产由 UGC 铸造工厂产生）。 */
function makeChangeSet(
  validated: import('../../../../core/ugc/model/upstream.js').UpstreamValidatedCandidate,
  registryVersion: string,
  targetOwnership: 'base-layer' | 'play-layer' = 'base-layer',
): ValidatedChangeSet {
  return {
    candidateFingerprint: 'fp-doc-1',
    changeRequestFingerprint: 'crfp-doc-1',
    changeRequestBinding: {
      candidateFingerprint: 'fp-doc-1',
      sourcePackageId: 'pkg-port',
      sourceDocumentId: 'doc-1',
      targetOwnership,
      operation: 'add',
      expectedTargetId: null,
    },
    baselineFingerprint: `baseline-${registryVersion}`,
    targetOwnership,
    upstreamValidated: validated,
    resolvedReferences: {
      providerId: 'l2-base-layer',
      nodes: [],
      outboundEdges: [],
      inboundEdges: [],
      revalidatedDependents: [],
      payload: null,
    },
    presentationDecisions: [],
    warnings: [],
  } as unknown as ValidatedChangeSet;
}

function makeBaseline(registryVersion: string): ValidationBaseline {
  return {
    definitionRegistryVersion: registryVersion,
    schemaCatalogVersion: 'schema-1',
    integrationContractFingerprint: 'empty',
    diagnosticCatalogVersion: 'dcat',
    quotaProfileId: 'test-profile',
    quotaProfileVersion: '1',
    fingerprint: `baseline-${registryVersion}`,
  };
}

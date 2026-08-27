/**
 * Task 11.3：通过公共 Facade 驱动 wakeup-ugc 与真实 l2 三端口的邻接全链路。
 *
 * 测试中的 Schema catalog、迁移、表现和运行时兼容端口属于可信宿主边界；Definition Validator、
 * Reference Resolver 与两个 atomic Definition Registry 均来自真实 `createL2PortBundle()`。所有候选
 * 只调用 `facade.validate` / `facade.activate`，从不直接调用 validator、resolver 或 registry 写入口。
 */
import { describe, expect, it } from 'vitest';
import type { SourceRecord } from '../../../kernel/state/diagnostic';
import { ALL_ADAPTERS, handAuthoredAdapter } from '../../adapter/adapters';
import { createCanonicalizationGateway } from '../../canonical/canonicalizer';
import {
  createProhibitedConstructGate,
  type EffectContractView,
  type MemberVerdict,
} from '../../codec/prohibited-construct-gate';
import { createStrictJsonDecoder } from '../../codec/strict-json-decoder';
import { createIntegrationContractCatalog } from '../../contracts/integration-contract-catalog';
import { createDiagnosticCodeCatalog } from '../../diagnostics/code-catalog';
import { createDiagnosticFactory } from '../../diagnostics/factory';
import {
  assembleL2UGCIntegration,
  createL2UGCIntegration,
  type L2UGCHostDependencies,
} from '../../integration/l2-adapter';
import type { L2PortBundle } from '../../integration/l2-port-contract';
import { createSchemaMigrationCoordinator } from '../../migration/schema-migration-coordinator';
import {
  CANDIDATE_SOURCE_KINDS,
  createCandidateChangeRequest,
  createCandidateSource,
  TARGET_OWNERSHIPS,
  type CandidateChangeRequest,
  type ChangeOperation,
  type TargetOwnership,
} from '../../model/candidate';
import type { JsonAst } from '../../model/json-ast';
import { compareCodePoints } from '../../model/fingerprint';
import type { ValidationReport } from '../../model/report';
import { QUOTA_KINDS, type TrustedQuotaProfile } from '../../model/quota-types';
import { ugcOk } from '../../model/result';
import type { PresentationGap, UpstreamSchemaView } from '../../model/upstream';
import { createPresentationFallbackResolver } from '../../presentation/fallback-resolver';
import type { RuntimeCompatibilityGateway } from '../../ports/definition-ports';
import { sha256FingerprintGateway } from '../../ports/sha256-fingerprint-gateway';
import type {
  CanonicalizationSchemaView,
  SchemaMigrationGateway,
  SchemaVersionCatalog,
  TrustedSchemaMigration,
} from '../../ports/schema-ports';
import { createL2PortBundle, type AssembledL2Ports } from '../../../../l2/ugc/ports/index';

const SOURCE_RECORD = Object.freeze({
  sourceFile: 'docs/L2_基类层/基类层定义.md',
  sourceLocation: Object.freeze({
    sourceFile: 'docs/L2_基类层/基类层定义.md',
    section: 'full-pipeline integration',
  }),
  precedence: 'finalized-l2-contract',
  classification: 'Normative_Contract',
  owningLayer: '基类层',
  statementFingerprint: 'full-pipeline-source-v1',
});

const CONTRACT_SOURCE: SourceRecord = Object.freeze({
  sourceId: 'full-pipeline-contract',
  documentUri: 'docs/L2_基类层/基类层定义.md',
  sourcePackage: 'provider.core',
  contentHash: 'full-pipeline-contract-v1',
  precedence: 1,
  owningLayer: '基类层',
  normativeStatus: 'normative',
  span: Object.freeze({
    file: 'docs/L2_基类层/基类层定义.md',
    start: Object.freeze({ line: 1, column: 1, offset: 0 }),
    end: Object.freeze({ line: 1, column: 1, offset: 0 }),
  }),
});

function damageDefinition(id: string, patch: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id,
    defKind: 'rule',
    abstract: false,
    semanticFamily: Object.freeze({ familyId: 'damage' }),
    typeIdentity: Object.freeze({
      requiredCapabilities: Object.freeze(['deal-damage']),
      legalRelationships: Object.freeze([]),
      invariants: Object.freeze([]),
      substitutionCompatibility: Object.freeze([]),
    }),
    composition: Object.freeze([]),
    parameterSchema: Object.freeze({ fields: Object.freeze([]), crossFieldConstraints: Object.freeze([]) }),
    tags: Object.freeze([]),
    actionRefs: Object.freeze([]),
    ruleRefs: Object.freeze([]),
    familyContract: Object.freeze({
      contractKind: 'damage',
      damageCategory: 'physical',
      sourceRequirements: Object.freeze([]),
      targetRequirements: Object.freeze([]),
      settlementPipelineRefs: Object.freeze([Object.freeze({
        refId: 'pipe-1',
        role: 'rule',
        expected: Object.freeze({ defKind: 'rule', allowAbstract: false }),
        required: false,
        jsonPath: '/familyContract/settlementPipelineRefs/0',
      })]),
    }),
    sourceRecords: Object.freeze([SOURCE_RECORD]),
    ...patch,
  });
}

function packageValue(
  packageId: string,
  definitions: readonly Readonly<Record<string, unknown>>[],
  patch: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    packageId,
    schemaVersion: 'l2-declarative/1',
    dependencies: Object.freeze([]),
    sourceRecords: Object.freeze([SOURCE_RECORD]),
    definitions: Object.freeze([...definitions]),
    ...patch,
  });
}

function quotaProfile(overrides: Partial<Record<(typeof QUOTA_KINDS)[number], number>> = {}): TrustedQuotaProfile {
  const values: Record<string, unknown> = { profileId: 'full-pipeline', version: '1' };
  for (const kind of QUOTA_KINDS) values[kind] = overrides[kind] ?? 100_000;
  return Object.freeze(values) as unknown as TrustedQuotaProfile;
}

function l2SchemaCatalog(): SchemaVersionCatalog {
  const parse = (value: string): number | null => {
    const match = /^l2-declarative\/(\d+)$/.exec(value);
    return match?.[1] === undefined ? null : Number.parseInt(match[1], 10);
  };
  return Object.freeze({
    providerId: 'full-pipeline.schema',
    catalogVersion: 'l2-declarative-catalog/1',
    supports: (version: string) => version === 'l2-declarative/1',
    isWellFormed: (version: string) => parse(version) !== null,
    supportedVersions: () => Object.freeze(['l2-declarative/1']),
    compare: (left: string, right: string) => (parse(left) ?? -1) - (parse(right) ?? -1),
  });
}

function canonicalSchemaView(): CanonicalizationSchemaView {
  return Object.freeze({
    providerId: 'full-pipeline.canonical',
    schemaCatalogVersion: 'l2-declarative-catalog/1',
    isUnorderedCollection: () => false,
    semanticIdentityOf: () => null,
  });
}

function effectContract(): EffectContractView {
  const contract: EffectContractView = {
    providerId: 'full-pipeline.effects',
    contractVersion: '1',
    classifyMember(_jsonPath: string, memberName: string): MemberVerdict {
      return memberName === 'eval' || memberName === '$eval'
        ? { kind: 'execution-request', detail: 'code-string-evaluation' }
        : { kind: 'admitted' };
    },
    isFreeTextRegion: (jsonPath: string) => jsonPath.endsWith('/description'),
  };
  return Object.freeze(contract);
}

function runtimeCompatibility(): RuntimeCompatibilityGateway {
  return Object.freeze({
    providerId: 'full-pipeline.runtime',
    version: '1',
    validatePlaypackOrSaveDeclaration: () => Object.freeze([]),
    rejectActiveMatchReplacement: () => Object.freeze([]),
  });
}

function schemaView(gaps: readonly PresentationGap[] = Object.freeze([])): UpstreamSchemaView {
  const view: UpstreamSchemaView = {
    schemaCatalogVersion: 'l2-declarative-catalog/1',
    classifyField: () => 'presentation-optional',
    provesNonSemantic: () => true,
    fallbackFor: () => Object.freeze({ assetId: 'icon:placeholder', typeTag: 'icon' }),
    listPresentationGaps: () => gaps,
    semanticFingerprint: (candidate) =>
      sha256FingerprintGateway.fingerprintText(
        JSON.stringify({ providerId: candidate.providerId, definitionIds: candidate.definitionIds, payload: candidate.payload }),
      ),
    withResolvedPresentation: (candidate, resolved) => Object.freeze({
      ...candidate,
      resolvedPresentation: Object.freeze([...resolved]),
    }),
  };
  return Object.freeze(view);
}

function noMigrations(): SchemaMigrationGateway {
  return Object.freeze({ providerId: 'full-pipeline.migrations', registryVersion: 'empty', edges: () => Object.freeze([]) });
}

const V0_TO_V1: TrustedSchemaMigration = Object.freeze({
  id: 'l2-v0-to-v1',
  from: 'l2-declarative/0',
  to: 'l2-declarative/1',
  transform(ast: JsonAst) {
    if (ast.kind !== 'object') return ugcOk(ast);
    const members = ast.members.map((member) =>
      member.key === 'schemaVersion'
        ? Object.freeze({
            ...member,
            value: Object.freeze({ kind: 'string' as const, value: 'l2-declarative/1', span: member.value.span }),
          })
        : member,
    );
    return ugcOk(Object.freeze({ ...ast, members: Object.freeze(members) }));
  },
});

function migrationGateway(edges: readonly TrustedSchemaMigration[] = Object.freeze([])): SchemaMigrationGateway {
  return Object.freeze({ providerId: 'full-pipeline.migrations', registryVersion: 'migration-v1', edges: () => edges });
}

interface ObservableState {
  readonly registry: string;
  readonly graph: string;
  readonly snapshot: string;
}

interface Environment {
  readonly bundle: AssembledL2Ports;
  readonly integration: ReturnType<typeof assembleL2UGCIntegration>;
  readonly host: L2UGCHostDependencies;
  readonly calls: Record<TargetOwnership, number>;
  state(target: TargetOwnership): ObservableState;
}

function graphFingerprint(bundle: AssembledL2Ports, target: TargetOwnership): string {
  const active = bundle.registryHandles[target].currentRegistry();
  const projection = {
    nodes: [...active.nodes.entries()]
      .map(([id, node]) => [id, node.defKind, node.abstract, node.semanticFamily] as const)
      .sort((left, right) => compareCodePoints(left[0], right[0])),
    inbound: [...active.inbound.entries()]
      .map(([id, sources]) => [id, [...sources]] as const)
      .sort((left, right) => compareCodePoints(left[0], right[0])),
    references: (active.graph?.references ?? [])
      .map(({ hostId, reference }) => [
        hostId,
        reference.refId,
        reference.jsonPath,
        reference.expected.defKind ?? null,
        reference.expected.semanticFamily ?? null,
      ] as const)
      .sort((left, right) => compareCodePoints(JSON.stringify(left), JSON.stringify(right))),
  };
  return sha256FingerprintGateway.fingerprintText(JSON.stringify(projection));
}

function createEnvironment(options: {
  readonly gaps?: readonly PresentationGap[];
  readonly migrations?: readonly TrustedSchemaMigration[];
  readonly quota?: Partial<Record<(typeof QUOTA_KINDS)[number], number>>;
} = {}): Environment {
  const diagnosticCatalog = createDiagnosticCodeCatalog(sha256FingerprintGateway);
  const factory = createDiagnosticFactory(diagnosticCatalog);
  const bundle = createL2PortBundle({ fingerprintGateway: sha256FingerprintGateway, catalog: diagnosticCatalog, factory });
  const calls = { 'base-layer': 0, 'play-layer': 0 } satisfies Record<TargetOwnership, number>;
  const registries = Object.fromEntries(
    TARGET_OWNERSHIPS.map((target) => {
      const delegate = bundle.registries[target];
      return [target, Object.freeze({
        providerId: delegate.providerId,
        version: delegate.version,
        targetOwnership: delegate.targetOwnership,
        readSnapshot: () => delegate.readSnapshot(),
        activateAtomically: (...args: Parameters<typeof delegate.activateAtomically>) => {
          calls[target] += 1;
          return delegate.activateAtomically(...args);
        },
      })];
    }),
  ) as unknown as L2PortBundle['registries'];

  const contractsResult = createIntegrationContractCatalog(
    { fingerprint: sha256FingerprintGateway, factory },
    [Object.freeze({
      domain: 'core-mechanics' as const,
      providerId: 'provider.core',
      version: '1',
      exportedDefKinds: Object.freeze(['rule']),
      exportedSemanticFamilies: Object.freeze(['damage']),
      referenceConstraintsFingerprint: 'core-reference-v1',
      sourceRecords: Object.freeze([CONTRACT_SOURCE]),
    })],
  );
  if (!contractsResult.ok) throw new Error('full-pipeline integration contract fixture is invalid');

  const profile = quotaProfile(options.quota);
  const schemaCatalog = l2SchemaCatalog();
  const host: L2UGCHostDependencies = Object.freeze({
    decoder: createStrictJsonDecoder(factory),
    prohibitedConstructGate: createProhibitedConstructGate(factory, effectContract()),
    migration: createSchemaMigrationCoordinator({
      catalog: schemaCatalog,
      gateway: options.migrations === undefined ? noMigrations() : migrationGateway(options.migrations),
      factory,
      maxSteps: 5,
    }),
    canonicalization: createCanonicalizationGateway({ schema: canonicalSchemaView(), fingerprint: sha256FingerprintGateway, factory }),
    schemaCatalog,
    contracts: contractsResult.value,
    runtimeCompatibility: runtimeCompatibility(),
    presentation: createPresentationFallbackResolver(factory),
    schemaView: schemaView(options.gaps),
    diagnosticCatalog,
    quotaProfile: profile,
    fingerprint: sha256FingerprintGateway,
    factory,
  });
  const integration = assembleL2UGCIntegration(
    Object.freeze({ validation: bundle.validation, resolution: bundle.resolution, registries }),
    host,
  );

  return Object.freeze({
    bundle,
    integration,
    host,
    calls,
    state(target: TargetOwnership): ObservableState {
      const snapshot = bundle.registryHandles[target].readSnapshot();
      return Object.freeze({
        registry: snapshot.registryVersion,
        graph: graphFingerprint(bundle, target),
        snapshot: snapshot.snapshotFingerprint,
      });
    },
  });
}

function requestOf(
  value: Readonly<Record<string, unknown>>,
  options: {
    readonly operation?: ChangeOperation;
    readonly target?: TargetOwnership;
    readonly expectedTargetId?: string;
    readonly documentId?: string;
  } = {},
): CandidateChangeRequest {
  const target = options.target ?? 'base-layer';
  const packageId = String(value['packageId'] ?? 'pkg-unknown');
  const source = createCandidateSource({
    kind: 'hand-authored',
    documentId: options.documentId ?? `${packageId}.json`,
    packageId,
    sourceName: `${packageId}.json`,
    receivedAtSequence: 1,
  });
  const document = handAuthoredAdapter.toCandidate(JSON.stringify(value), source, target);
  return createCandidateChangeRequest({
    operation: options.operation ?? 'add',
    document,
    ...(options.expectedTargetId === undefined ? {} : { expectedTargetId: options.expectedTargetId }),
  });
}

function expectReportIdentity(report: ValidationReport): void {
  expect(report.candidateFingerprint).not.toBeNull();
  expect(report.changeRequestFingerprint).not.toBeNull();
  expect(report.baseline.fingerprint.length).toBeGreaterThan(0);
  expect(report.baseline.definitionRegistryVersion.length).toBeGreaterThan(0);
}

function rejectUnchanged(environment: Environment, request: CandidateChangeRequest) {
  const target = request.document.targetOwnership;
  const facade = environment.integration.facadeFor(target);
  const before = environment.state(target);
  const callsBefore = environment.calls[target];
  const report = facade.validate(request);
  const after = environment.state(target);
  expect(report.status).toBe('rejected');
  expect(report.validated).toBeNull();
  expectReportIdentity(report);
  expect(environment.calls[target]).toBe(callsBefore);
  expect(after).toEqual(before);
  return report;
}

function activateOnce(
  environment: Environment,
  request: CandidateChangeRequest,
  options: { readonly expectGraphChange?: boolean } = {},
) {
  const target = request.document.targetOwnership;
  const facade = environment.integration.facadeFor(target);
  const before = environment.state(target);
  const callsBefore = environment.calls[target];
  const report = facade.validate(request);
  expect(
    report.status,
    report.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.reason}`).join('\n'),
  ).toBe('validated');
  expect(report.validated).not.toBeNull();
  expectReportIdentity(report);
  if (report.validated === null) throw new Error(report.diagnostics.map((diagnostic) => diagnostic.code).join(','));
  const result = facade.activate(report.validated, report.baseline);
  const after = environment.state(target);
  expect(result.status).toBe('activated');
  expect(result.unchanged).toBe(false);
  expect(result.previousSnapshotFingerprint).toBe(before.snapshot);
  expect(result.activeSnapshotFingerprint).toBe(after.snapshot);
  expect(environment.calls[target]).toBe(callsBefore + 1);
  expect(after.registry).not.toBe(before.registry);
  expect(after.snapshot).not.toBe(before.snapshot);
  if (options.expectGraphChange ?? true) expect(after.graph).not.toBe(before.graph);
  return { report, result, before, after };
}

describe('Feature: wakeup-ugc Task 11.1/11.3 real l2 composition root', () => {
  it('creates the production integration from the stable l2 export and exposes only target-bound facades', () => {
    const environment = createEnvironment();
    const production = createL2UGCIntegration(environment.host);
    expect(production.providerId).toBe('l2-base-layer');
    expect(production.version.length).toBeGreaterThan(0);
    expect(production.facadeFor('base-layer')).toBe(production.facades['base-layer']);
    expect(production.facadeFor('play-layer')).toBe(production.facades['play-layer']);
    expect(Object.keys(production.facades).sort()).toEqual(['base-layer', 'play-layer']);
    expect(Object.keys(production.facades['base-layer']).sort()).toEqual(['activate', 'validate']);
  });

  it('routes every Adapter source through the same real validator and resolver', () => {
    const environment = createEnvironment();
    const value = packageValue('pkg-adapters', [damageDefinition('dmg-adapters')]);
    const text = JSON.stringify(value);
    const before = environment.state('base-layer');
    const reports = ALL_ADAPTERS.map((adapter, index) => {
      const kind = CANDIDATE_SOURCE_KINDS[index];
      if (kind === undefined) throw new Error('adapter/source-kind fixture cardinality mismatch');
      const document = adapter.toCandidate(
        text,
        createCandidateSource({
          kind,
          documentId: 'adapters.json',
          packageId: 'pkg-adapters',
          sourceName: 'adapters.json',
          receivedAtSequence: 1,
        }),
        'base-layer',
      );
      return environment.integration.facadeFor('base-layer').validate(
        createCandidateChangeRequest({ operation: 'add', document }),
      );
    });

    expect(reports.every((report) => report.status === 'validated')).toBe(true);
    expect(new Set(reports.map((report) => report.candidateFingerprint)).size).toBe(1);
    expect(new Set(reports.map((report) => report.changeRequestFingerprint)).size).toBe(1);
    expect(reports.every((report) => report.validated?.upstreamValidated.providerId === 'l2-base-layer')).toBe(true);
    expect(reports.every((report) => report.validated?.resolvedReferences.providerId === 'l2-base-layer')).toBe(true);
    expect(environment.calls['base-layer']).toBe(0);
    expect(environment.state('base-layer')).toEqual(before);
  });

  it('validates and atomically activates a valid base candidate exactly once', () => {
    const environment = createEnvironment();
    const value = packageValue('pkg-base', [damageDefinition('dmg-basic')]);
    const activated = activateOnce(environment, requestOf(value));
    expect(activated.report.validated?.upstreamValidated.providerId).toBe('l2-base-layer');
    expect(activated.report.validated?.resolvedReferences.providerId).toBe('l2-base-layer');
    expect(environment.bundle.registryHandles['base-layer'].readSnapshot().activeDefinitionIds).toEqual(['dmg-basic']);
    expect(environment.state('play-layer')).toEqual(createEnvironment().state('play-layer'));
  });

  it('rejects an unknown field and preserves registry, graph and canonical snapshot', () => {
    const environment = createEnvironment();
    const report = rejectUnchanged(environment, requestOf(packageValue('pkg-unknown', [damageDefinition('dmg-unknown')], { typoField: true })));
    expect(report.diagnostics.some((diagnostic) => diagnostic.code === 'E_LOAD_UNKNOWN_FIELD' && diagnostic.path === '/typoField')).toBe(true);
  });

  it('rejects duplicate definition IDs with both source identity and unchanged-state evidence', () => {
    const environment = createEnvironment();
    const report = rejectUnchanged(environment, requestOf(packageValue('pkg-duplicate', [
      damageDefinition('dmg-duplicate'),
      damageDefinition('dmg-duplicate'),
    ])));
    expect(report.diagnostics.some((diagnostic) => diagnostic.code === 'E_LOAD_DUPLICATE_ID')).toBe(true);
  });

  it('uses the real resolver for a typed cross-domain reference and emits a deterministic provider edge', () => {
    const environment = createEnvironment();
    const target = damageDefinition('dmg-target');
    const consumer = damageDefinition('dmg-consumer', {
      ruleRefs: Object.freeze([Object.freeze({
        refId: 'dmg-target',
        role: 'rule',
        expected: Object.freeze({ defKind: 'rule', semanticFamily: 'damage', allowAbstract: false }),
        required: true,
        jsonPath: '/definitions/1/ruleRefs/0',
      })]),
    });
    const activated = activateOnce(environment, requestOf(packageValue('pkg-cross-domain', [target, consumer])));
    expect(activated.report.validated?.resolvedReferences.outboundEdges).toEqual([
      expect.objectContaining({
        fromDefinitionId: 'dmg-consumer',
        toDefinitionId: 'dmg-target',
        expectedKind: 'rule',
        semanticFamily: 'damage',
        providerDomain: 'core-mechanics',
      }),
    ]);
  });

  it('performs authorized override and remove through one real atomic registry call each', () => {
    const environment = createEnvironment();
    activateOnce(environment, requestOf(packageValue('pkg-lifecycle', [damageDefinition('dmg-lifecycle')])));

    const replacement = packageValue('pkg-lifecycle', [damageDefinition('dmg-lifecycle', {
      typeIdentity: Object.freeze({
        requiredCapabilities: Object.freeze(['deal-damage', 'piercing']),
        legalRelationships: Object.freeze([]),
        invariants: Object.freeze([]),
        substitutionCompatibility: Object.freeze([]),
      }),
    })], {
      overrideIntent: Object.freeze([Object.freeze({ targetId: 'dmg-lifecycle', reason: 'specialize capability' })]),
    });
    activateOnce(environment, requestOf(replacement, {
      operation: 'replace',
      expectedTargetId: 'dmg-lifecycle',
      documentId: 'replace.json',
    }), { expectGraphChange: false });

    const removal = packageValue('pkg-lifecycle', [], {
      removals: Object.freeze([Object.freeze({ targetId: 'dmg-lifecycle', reason: 'retire definition' })]),
    });
    activateOnce(environment, requestOf(removal, {
      operation: 'remove',
      expectedTargetId: 'dmg-lifecycle',
      documentId: 'remove.json',
    }));
    expect(environment.calls['base-layer']).toBe(3);
    expect(environment.bundle.registryHandles['base-layer'].readSnapshot().activeDefinitionIds).toEqual([]);
  });

  it('reconciliation 要求3：同 key 后装覆盖先装，add 操作不再报 REF_OVERRIDE_NOT_DECLARED（D-073 单调重定义）', () => {
    const environment = createEnvironment();
    // 先装「旧」定义
    const first = packageValue('pkg-first', [damageDefinition('dmg-monotonic', {
      typeIdentity: Object.freeze({
        requiredCapabilities: Object.freeze(['deal-damage']),
        legalRelationships: Object.freeze([]),
        invariants: Object.freeze([]),
        substitutionCompatibility: Object.freeze([]),
      }),
    })]);
    activateOnce(environment, requestOf(first));

    // 后装同 key 定义，操作维持默认 add（不声明 overrideIntent）。
    // 早先端口会对「同名且未声明覆盖」报 REF_OVERRIDE_NOT_DECLARED；单调重定义下同 key 即覆盖，不再拒绝。
    const second = packageValue('pkg-second', [damageDefinition('dmg-monotonic', {
      typeIdentity: Object.freeze({
        requiredCapabilities: Object.freeze(['deal-damage', 'piercing']),
        legalRelationships: Object.freeze([]),
        invariants: Object.freeze([]),
        substitutionCompatibility: Object.freeze([]),
      }),
    })]);
    const report = requestOf(second);
    const facade = environment.integration.facadeFor('base-layer');
    const validated = facade.validate(report);
    expect(validated.status).toBe('validated');
    // l2 端口把 REF_OVERRIDE_NOT_DECLARED 投影为 catalog 的 E_LOAD_OVERRIDE_INVALID；此处断言
    // 单调重定义下不会再报「未声明覆盖」，即同 key 后装覆盖先装得到通过。
    expect(
      validated.diagnostics.some((diagnostic) => diagnostic.code === 'E_LOAD_OVERRIDE_INVALID'),
      validated.diagnostics.map((d) => `${d.code}: ${d.reason}`).join('\n'),
    ).toBe(false);
    if (validated.validated === null) throw new Error('expected validated report');
    const result = facade.activate(validated.validated, validated.baseline);
    expect(result.status).toBe('activated');
    expect(result.previousSnapshotFingerprint).not.toBe(result.activeSnapshotFingerprint);
    expect(result.unchanged).toBe(false);
  });

  it('单调重定义下仍守卫损坏声明：overrideIntent 指向不存在的活动目标 → E_LOAD_OVERRIDE_INVALID', () => {
    const environment = createEnvironment();
    const value = packageValue('pkg-orphan', [], {
      overrideIntent: Object.freeze([Object.freeze({ targetId: 'does-not-exist', reason: 'stale intent' })]),
    });
    const request = requestOf(value, { operation: 'replace', expectedTargetId: 'does-not-exist' });
    const facade = environment.integration.facadeFor('base-layer');
    const report = facade.validate(request);
    // 包声明了覆盖意图，但目标不在活动注册表——声明损坏，仍被拒绝。
    // l2 端口把 REF_OVERRIDE_NOT_DECLARED 投影成 catalog 的 IDENTITY_CONFLICT/override-invalid
    // （见 diagnostic-projection），对外如实的 error 码是 E_LOAD_OVERRIDE_INVALID。
    // 这条不变式与 D-073 同 key 覆盖无关：object 不存在则无法声明覆盖，必须报错。
    expect(report.status).toBe('rejected');
    expect(
      report.diagnostics.some((diagnostic) => diagnostic.code === 'E_LOAD_OVERRIDE_INVALID'),
      report.diagnostics.map((d) => `${d.code}: ${d.reason}`).join('\n'),
    ).toBe(true);
  });

  it('单调重定义同 key 覆盖携带 effectiveOverrides，活动依赖不兼容即被拒绝（E_LOAD_OVERRIDE_INVALIDATES_DEPENDENT）', () => {
    const environment = createEnvironment();
    // 先装一个 rule：dmg-provider（供依赖者引用）+ 一个依赖者 dmg-consumer，它声明按语义族 damage 引用 dmg-provider。
    const provider = damageDefinition('dmg-provider', {
      typeIdentity: Object.freeze({
        requiredCapabilities: Object.freeze(['deal-damage']),
        legalRelationships: Object.freeze([]),
        invariants: Object.freeze([]),
        substitutionCompatibility: Object.freeze([]),
      }),
    });
    const consumer = damageDefinition('dmg-consumer', {
      ruleRefs: Object.freeze([Object.freeze({
        refId: 'dmg-provider',
        role: 'rule',
        expected: Object.freeze({ defKind: 'rule', semanticFamily: 'damage', allowAbstract: false }),
        required: true,
        jsonPath: '/definitions/0/ruleRefs/0',
      })]),
    });
    activateOnce(environment, requestOf(packageValue('pkg-base', [provider, consumer])));

    // 后装同 key 覆盖 dmg-provider，但不声明 overrideIntent（单调重定义语义），且把语义族改成不兼容的族。
    // 依赖者 dmg-consumer 仍在活动集、未被重新提交，其 ruleRef 期望 damage —— 覆盖后 provider 不再匹配 → 必须拒绝。
    const incompatible = damageDefinition('dmg-provider', {
      semanticFamily: Object.freeze({ familyId: 'damage' }), // 保持族不变，改 kind 使其脱离 rule（更直接）
      defKind: 'action',
      typeIdentity: Object.freeze({
        requiredCapabilities: Object.freeze(['deal-damage']),
        legalRelationships: Object.freeze([]),
        invariants: Object.freeze([]),
        substitutionCompatibility: Object.freeze([]),
      }),
    });
    const value = packageValue('pkg-redef', [incompatible]);
    const facade = environment.integration.facadeFor('base-layer');
    const report = facade.validate(requestOf(value));
    // 同 key 覆盖不再当"未声明覆盖"拒；但覆盖确实发生，且破坏了仍在活动集的依赖者 → E_LOAD_OVERRIDE_INVALIDATES_DEPENDENT
    expect(report.status).toBe('rejected');
    expect(
      report.diagnostics.some((diagnostic) => diagnostic.code === 'E_LOAD_OVERRIDE_INVALIDATES_DEPENDENT'),
      report.diagnostics.map((d) => `${d.code}: ${d.reason}`).join('\n'),
    ).toBe(true);
  });

  it('migrates an old Schema through the trusted migration chain, then runs the complete real pipeline', () => {
    const environment = createEnvironment({ migrations: Object.freeze([V0_TO_V1]) });
    const old = { ...packageValue('pkg-old', [damageDefinition('dmg-old')]), schemaVersion: 'l2-declarative/0' };
    const activated = activateOnce(environment, requestOf(old));
    expect(activated.report.diagnostics.some((diagnostic) => diagnostic.code === 'E_LOAD_MIGRATED_SOURCE_REBASED')).toBe(true);
    expect(activated.report.validated?.warnings.every((diagnostic) => diagnostic.severity === 'warn')).toBe(true);
  });

  it('applies an eligible presentation fallback without changing semantic identity and permits warning-only activation', () => {
    const gap: PresentationGap = Object.freeze({
      definitionId: 'dmg-presented',
      jsonPath: '/presentation/iconRef',
      missingAsset: 'icon:missing',
      expectedTypeTag: 'icon',
      sourceSpan: null,
    });
    const environment = createEnvironment({ gaps: Object.freeze([gap]) });
    const value = packageValue('pkg-presentation', [damageDefinition('dmg-presented', {
      presentation: Object.freeze({ iconRef: 'icon:missing' }),
    })]);
    const activated = activateOnce(environment, requestOf(value));
    const warnings = activated.report.diagnostics.filter((diagnostic) => diagnostic.severity === 'warn');
    expect(warnings.some((diagnostic) => diagnostic.code === 'E_LOAD_PRESENTATION_FALLBACK')).toBe(true);
    expect(activated.report.validated?.presentationDecisions).toEqual([
      expect.objectContaining({
        definitionId: 'dmg-presented',
        jsonPath: '/presentation/iconRef',
        missingAsset: 'icon:missing',
        fallbackAsset: 'icon:placeholder',
      }),
    ]);
  });

  it('produces byte-equivalent canonical snapshots for whitespace/key-order equivalent candidates', () => {
    const first = createEnvironment();
    const second = createEnvironment();
    const normal = packageValue('pkg-canonical', [damageDefinition('dmg-canonical')]);
    const reordered = Object.freeze({
      definitions: normal['definitions'],
      sourceRecords: normal['sourceRecords'],
      dependencies: normal['dependencies'],
      schemaVersion: normal['schemaVersion'],
      packageId: normal['packageId'],
    });
    const a = activateOnce(first, requestOf(normal, { documentId: 'canonical.json' }));
    const b = activateOnce(second, requestOf(reordered, { documentId: 'canonical.json' }));
    expect(a.report.candidateFingerprint).toBe(b.report.candidateFingerprint);
    expect(JSON.stringify(first.bundle.registryHandles['base-layer'].currentRegistry().snapshot))
      .toBe(JSON.stringify(second.bundle.registryHandles['base-layer'].currentRegistry().snapshot));
    expect(a.after).toEqual(b.after);
  });

  it('rejects stale validation before the real registry call and retains all three state identities', () => {
    const environment = createEnvironment();
    const staleFacade = environment.integration.facadeFor('base-layer');
    const stale = staleFacade.validate(requestOf(packageValue('pkg-stale-a', [damageDefinition('dmg-stale-a')])));
    if (stale.validated === null) throw new Error('stale fixture must initially validate');
    activateOnce(environment, requestOf(packageValue('pkg-stale-b', [damageDefinition('dmg-stale-b')])));

    const before = environment.state('base-layer');
    const callsBefore = environment.calls['base-layer'];
    const rejected = staleFacade.activate(stale.validated, stale.baseline);
    expect(rejected.status).toBe('rejected');
    expect(rejected.unchanged).toBe(true);
    expect(rejected.diagnostics.every((diagnostic) => diagnostic.code === 'E_LOAD_BASELINE_STALE')).toBe(true);
    expect(environment.calls['base-layer']).toBe(callsBefore);
    expect(environment.state('base-layer')).toEqual(before);
  });

  it('fails closed for a normative gameplay-value candidate because no frozen play package contract exists yet', () => {
    const environment = createEnvironment();
    const playCandidate = packageValue('pkg-play', [damageDefinition('play-damage', {
      sourceRecords: Object.freeze([{ ...SOURCE_RECORD, owningLayer: '玩法层' }]),
      gameplayValues: Object.freeze([Object.freeze({
        field: 'damage',
        value: 3,
        playerVisible: true,
        owningProfile: 'playpack:integration',
      })]),
    })], {
      sourceRecords: Object.freeze([{ ...SOURCE_RECORD, owningLayer: '玩法层' }]),
    });
    const baseBefore = environment.state('base-layer');
    const report = rejectUnchanged(environment, requestOf(playCandidate, { target: 'play-layer' }));
    expect(report.diagnostics.some((diagnostic) =>
      diagnostic.code === 'E_LOAD_NUMERIC_OWNERSHIP' || diagnostic.code === 'E_LOAD_UNKNOWN_FIELD')).toBe(true);
    expect(environment.state('base-layer')).toEqual(baseBefore);
  });

  it('rejects a real-port quota breach without exposing partial registry, graph or snapshot state', () => {
    const environment = createEnvironment({ quota: { definitions: 1 } });
    const report = rejectUnchanged(environment, requestOf(packageValue('pkg-quota', [
      damageDefinition('dmg-quota-a'),
      damageDefinition('dmg-quota-b'),
    ])));
    expect(report.diagnostics.some((diagnostic) => diagnostic.code === 'E_QUOTA_DEFINITIONS')).toBe(true);
  });
});

/**
 * 端到端测试夹具：为全部上游端口提供**合规**替身，使测试能通过公共 Facade 驱动完整流水线。
 *
 * 这些替身只实现端口契约，不含任何 UGC 生产逻辑，也不提供旁路：
 * - 不能铸造 `ValidatedChangeSet`（铸造只在 activation 内部发生）；
 * - 不能跳过配额记账；
 * - 不能直接改写活动注册表（注册表替身自身实现工作副本 + CAS 语义）。
 *
 * 重要：这些替身只验证 UGC 自身编排与故障注入，不构成任务 11 的真实上游集成证据。PT-02 后的
 * 真实基类层端口证据位于 `__tests__/integration/full-pipeline.integration.test.ts`；保留本 harness 是为了
 * 精确注入上游失败、能力缺口和 TOCTOU，而不是替代生产 `l2-adapter.ts`。
 */
import { createDiagnosticCodeCatalog } from '../diagnostics/code-catalog.js';
import { createDiagnosticFactory } from '../diagnostics/factory.js';
import type { UGCDiagnosticFactory } from '../diagnostics/factory.js';
import { sha256FingerprintGateway } from '../ports/sha256-fingerprint-gateway.js';
import { QUOTA_KINDS } from '../model/quota-types.js';
import type { TrustedQuotaProfile } from '../model/quota-types.js';
import type { SourceRecord } from '../../kernel/state/diagnostic.js';
import type {
  DefinitionRegistryReadSnapshot,
  PresentationGap,
  UpstreamResolvedReferenceGraph,
  UpstreamSchemaView,
  UpstreamValidatedCandidate,
} from '../model/upstream.js';
import type { ActivationResult } from '../model/report.js';
import type { ValidationBaseline } from '../model/baseline.js';
import type { ValidatedChangeSet } from '../model/validated-change-set.js';
import type { TargetOwnership } from '../model/candidate.js';
import {
  MANDATORY_RESOLUTION_CAPABILITIES,
  MANDATORY_VALIDATION_CAPABILITIES,
} from '../ports/definition-ports.js';
import type {
  DefinitionRegistryGateway,
  DefinitionValidationGateway,
  ReferenceResolutionGateway,
  RuntimeCompatibilityGateway,
} from '../ports/definition-ports.js';
import type { CanonicalizationSchemaView, SchemaMigrationGateway, SchemaVersionCatalog } from '../ports/schema-ports.js';
import type { EffectContractView, MemberVerdict } from '../codec/prohibited-construct-gate.js';
import type { IntegrationContract } from '../model/contract-types.js';
import { createIntegrationContractCatalog } from '../contracts/integration-contract-catalog.js';
import type { BaselineSources } from '../baseline/baseline-factory.js';
import { createStrictJsonDecoder } from '../codec/strict-json-decoder.js';
import { createProhibitedConstructGate } from '../codec/prohibited-construct-gate.js';
import { createSchemaMigrationCoordinator } from '../migration/schema-migration-coordinator.js';
import { createCanonicalizationGateway } from '../canonical/canonicalizer.js';
import { createPresentationFallbackResolver } from '../presentation/fallback-resolver.js';
import { createValidationCoordinator } from '../validation/coordinator.js';
import { createAtomicActivationCoordinator } from '../activation/atomic-activation-coordinator.js';
import { createUGCIngressFacade } from '../facade/ugc-ingress-facade.js';
import type { UGCIngressFacade } from '../facade/ugc-ingress-facade.js';

export const fingerprint = sha256FingerprintGateway;
export const diagnosticCatalog = createDiagnosticCodeCatalog(fingerprint);
export const factory: UGCDiagnosticFactory = createDiagnosticFactory(diagnosticCatalog);

export function quotaProfile(overrides: Partial<Record<string, unknown>> = {}): TrustedQuotaProfile {
  const base: Record<string, unknown> = { profileId: 'harness', version: '1.0.0' };
  for (const kind of QUOTA_KINDS) base[kind] = 100_000;
  return { ...base, ...overrides } as unknown as TrustedQuotaProfile;
}

export const harnessSourceRecord: SourceRecord = {
  sourceId: 'src-harness',
  documentUri: 'docs/harness.md',
  sourcePackage: 'pkg-provider',
  contentHash: 'hash',
  precedence: 1,
  owningLayer: '基类层',
  normativeStatus: 'normative',
  span: { file: 'docs/harness.md', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 0 } },
};

export function schemaVersionCatalog(supported: readonly string[] = ['1.0.0']): SchemaVersionCatalog {
  const parse = (version: string): readonly number[] | null =>
    /^\d+\.\d+\.\d+$/.test(version) ? version.split('.').map((part) => Number.parseInt(part, 10)) : null;
  return {
    providerId: 'harness.schema',
    catalogVersion: `schema-${supported.join('|')}`,
    isWellFormed: (version) => parse(version) !== null,
    supports: (version) => supported.includes(version),
    supportedVersions: () => supported,
    compare: (left, right) => {
      const a = parse(left) ?? [];
      const b = parse(right) ?? [];
      for (let index = 0; index < 3; index += 1) {
        const x = a[index] ?? 0;
        const y = b[index] ?? 0;
        if (x !== y) return x < y ? -1 : 1;
      }
      return 0;
    },
  };
}

export function migrationGateway(): SchemaMigrationGateway {
  return { providerId: 'harness.migrations', registryVersion: 'mig-empty', edges: () => [] };
}

export function canonicalSchemaView(): CanonicalizationSchemaView {
  return {
    providerId: 'harness.canonical',
    schemaCatalogVersion: 'schema-1.0.0',
    isUnorderedCollection: () => false,
    semanticIdentityOf: () => null,
  };
}

/** 效果契约替身：只有 `/effects` 之下的 `eval` 被判为执行请求，自由文本区域整体跳过。 */
export function effectContract(): EffectContractView {
  return {
    providerId: 'harness.effects',
    contractVersion: '1.0.0',
    classifyMember(jsonPath: string, memberName: string): MemberVerdict {
      if (memberName === 'eval' && jsonPath.startsWith('/effects')) {
        return { kind: 'execution-request', detail: 'code-string-evaluation' };
      }
      return { kind: 'admitted' };
    },
    isFreeTextRegion: (jsonPath) => jsonPath.startsWith('/description') || jsonPath.startsWith('/name'),
  };
}

export function runtimeCompatibility(): RuntimeCompatibilityGateway & {
  readonly calls: { playpack: number; activeMatch: number };
} {
  const calls = { playpack: 0, activeMatch: 0 };
  return {
    providerId: 'harness.runtime',
    version: '1.0.0',
    calls,
    validatePlaypackOrSaveDeclaration() {
      calls.playpack += 1;
      return Object.freeze([]);
    },
    rejectActiveMatchReplacement() {
      calls.activeMatch += 1;
      return Object.freeze([
        factory.registry({
          selector: { category: 'VERSION_COMPATIBILITY', condition: 'newer-save' },
          stage: 'definition-validation',
          sourcePackage: 'pkg-1',
          message: 'Active match replacement is refused by the engine lifecycle contract.',
          reason: '引擎层生命周期契约拒绝在对局进行中替换玩法包。',
          correctionSuggestion: '请在对局结束后再提交该变更。',
          expectedBaseline: 'n/a',
          actualBaseline: 'n/a',
        }),
      ]);
    },
  };
}

export interface ValidatorOptions {
  /** 让替身报告一批错误（模拟上游发现问题）。 */
  readonly errors?: readonly { readonly definitionId: string; readonly jsonPath: string; readonly condition: 'unknown-field' | 'duplicate-id' }[];
  /** 故意不声明覆盖某些强制能力，用于验证失败关闭门禁。 */
  readonly omitCapabilities?: readonly string[];
  readonly definitionIds?: readonly string[];
}

/** 合规的 Definition Validator 替身：声明覆盖全部强制能力，并可按需报告错误。 */
export function definitionValidator(options: ValidatorOptions = {}): DefinitionValidationGateway {
  const definitionIds = options.definitionIds ?? ['weapon:shotgun'];
  return {
    providerId: 'harness.validator',
    version: '1.0.0',
    validate(request) {
      const sourcePackage = request.candidate.source.packageId;
      const diagnostics = (options.errors ?? []).map((error) =>
        factory.definition({
          selector:
            error.condition === 'unknown-field'
              ? { category: 'SCHEMA_CONTRACT', condition: 'unknown-field' }
              : { category: 'IDENTITY_CONFLICT', condition: 'duplicate-id' },
          stage: 'definition-validation',
          sourcePackage,
          definitionId: error.definitionId,
          jsonPath: error.jsonPath,
          sourceSpan: { file: request.candidate.source.documentId, start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 0 } },
          message: `upstream reported ${error.condition}`,
          reason: `上游验证器报告 ${error.condition}。`,
          correctionSuggestion: '请按提示修正该字段。',
        }),
      );
      const covered = MANDATORY_VALIDATION_CAPABILITIES.filter(
        (capability) => !(options.omitCapabilities ?? []).includes(capability),
      );
      return {
        diagnostics: Object.freeze(diagnostics),
        coveredCapabilities: Object.freeze(covered),
        validated:
          diagnostics.length > 0
            ? null
            : Object.freeze({ providerId: 'harness.validator', definitionIds, payload: { canonical: request.candidate.canonicalJson } }),
      };
    },
  };
}

export interface ResolverOptions {
  readonly missingTarget?: string;
  readonly omitCapabilities?: readonly string[];
  readonly revalidatedDependents?: readonly string[];
}

/** 合规的 Reference Resolver 替身。 */
export function referenceResolver(options: ResolverOptions = {}): ReferenceResolutionGateway {
  return {
    providerId: 'harness.resolver',
    version: '1.0.0',
    resolve(validated) {
      const diagnostics =
        options.missingTarget === undefined
          ? []
          : [
              factory.definition({
                selector: { category: 'REFERENCE_CONTRACT', condition: 'missing-target' },
                stage: 'reference-resolution',
                sourcePackage: 'pkg-1',
                definitionId: validated.definitionIds[0] ?? 'unknown',
                jsonPath: '/uses',
                sourceSpan: { file: 'doc-1', start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: 0 } },
                message: `missing reference target ${options.missingTarget}`,
                reason: `引用目标 ${options.missingTarget} 不存在。`,
                correctionSuggestion: '请先登记被引用的定义，或修正引用标识。',
              }),
            ];
      const covered = MANDATORY_RESOLUTION_CAPABILITIES.filter(
        (capability) => !(options.omitCapabilities ?? []).includes(capability),
      );
      const graph: UpstreamResolvedReferenceGraph = Object.freeze({
        providerId: 'harness.resolver',
        nodes: validated.definitionIds,
        outboundEdges: Object.freeze([]),
        inboundEdges: Object.freeze([]),
        revalidatedDependents: Object.freeze(options.revalidatedDependents ?? []),
        payload: null,
      });
      return {
        diagnostics: Object.freeze(diagnostics),
        coveredCapabilities: Object.freeze(covered),
        graph: diagnostics.length > 0 ? null : graph,
      };
    },
  };
}

export interface SchemaViewOptions {
  readonly gaps?: readonly PresentationGap[];
  readonly classify?: (definitionId: string, jsonPath: string) => 'semantic' | 'presentation-optional' | 'presentation-required';
  readonly provesNonSemantic?: boolean;
  readonly fallback?: { readonly assetId: string; readonly typeTag: string } | null;
  /** 令回退后的语义指纹发生变化，用于验证语义守卫。 */
  readonly pollutesSemantics?: boolean;
}

export function schemaView(options: SchemaViewOptions = {}): UpstreamSchemaView {
  return {
    schemaCatalogVersion: 'schema-1.0.0',
    classifyField: (definitionId, jsonPath) =>
      options.classify?.(definitionId, jsonPath) ?? 'presentation-optional',
    provesNonSemantic: () => options.provesNonSemantic ?? true,
    // 显式 null 表示"没有登记回退项"，与"未指定该选项"必须区分——用 `??` 会把两者混为一谈。
    fallbackFor: () => (options.fallback === undefined ? { assetId: 'icon:placeholder', typeTag: 'icon' } : options.fallback),
    listPresentationGaps: () => options.gaps ?? [],
    semanticFingerprint: (candidate) => {
      const marker = (candidate as { readonly resolvedMarker?: string }).resolvedMarker;
      return options.pollutesSemantics === true && marker !== undefined ? `sem-${marker}` : 'sem-stable';
    },
    withResolvedPresentation: (candidate, resolved) =>
      Object.freeze({ ...candidate, resolvedMarker: resolved.map((entry) => entry.asset.assetId).join('|') }) as UpstreamValidatedCandidate,
  };
}

/**
 * 注册表替身：实现真正的工作副本 + compare-and-swap 语义。
 *
 * 这是有意为之：内核 `DefRegistry` 不满足批量原子契约（实施基线记录 §1.2.4），因此测试必须自带一个
 * 满足契约的实现，才能验证"全成或全败"。它仍**只是替身**，不构成任务 11 的真实集成证据。
 */
export interface RegistryDouble extends DefinitionRegistryGateway {
  readonly calls: { activate: number };
  /** 在下一次提交时注入失败。 */
  failNext(mode: 'reject' | 'throw' | 'invalid-result' | 'silent-success'): void;
  /** 在提交前改变注册表版本，模拟并发变更（TOCTOU）。 */
  bumpVersion(): void;
}

export function registryDouble(targetOwnership: TargetOwnership = 'base-layer'): RegistryDouble {
  let version = 'reg-1';
  let snapshotFingerprint = 'snap-1';
  let active: readonly string[] = Object.freeze([]);
  let generation = 1;
  let injected: 'reject' | 'throw' | 'invalid-result' | 'silent-success' | null = null;
  const calls = { activate: 0 };

  return {
    providerId: 'harness.registry',
    version: '1.0.0',
    targetOwnership,
    calls,
    failNext(mode) {
      injected = mode;
    },
    bumpVersion() {
      generation += 1;
      version = `reg-${String(generation)}`;
    },
    readSnapshot(): DefinitionRegistryReadSnapshot {
      return Object.freeze({
        registryVersion: version,
        snapshotFingerprint,
        targetOwnership,
        activeDefinitionIds: active,
        payload: null,
      });
    },
    activateAtomically(change: ValidatedChangeSet, expected: ValidationBaseline): ActivationResult {
      calls.activate += 1;
      const previous = snapshotFingerprint;
      const mode = injected;
      injected = null;

      if (mode === 'throw') throw new Error('registry commit exploded');
      if (mode === 'invalid-result') return { status: 'weird' } as unknown as ActivationResult;
      if (mode === 'reject') {
        // 失败：工作副本被丢弃，活动状态完全不变。
        return Object.freeze({
          status: 'rejected',
          baseline: expected,
          candidateFingerprint: change.candidateFingerprint,
          changeRequestFingerprint: change.changeRequestFingerprint,
          diagnostics: Object.freeze([]),
          previousSnapshotFingerprint: previous,
          activeSnapshotFingerprint: previous,
          unchanged: true,
        });
      }

      // 工作副本上完成变更，然后一次性发布。
      const working = [...active, ...change.upstreamValidated.definitionIds];
      if (mode !== 'silent-success') {
        active = Object.freeze(working);
        generation += 1;
        snapshotFingerprint = `snap-${String(generation)}`;
        version = `reg-${String(generation)}`;
      }
      return Object.freeze({
        status: 'activated',
        baseline: expected,
        candidateFingerprint: change.candidateFingerprint,
        changeRequestFingerprint: change.changeRequestFingerprint,
        diagnostics: Object.freeze([]),
        previousSnapshotFingerprint: previous,
        activeSnapshotFingerprint: snapshotFingerprint,
        unchanged: false,
      });
    },
  };
}

export interface HarnessOptions {
  readonly validator?: ValidatorOptions;
  readonly resolver?: ResolverOptions;
  readonly schema?: SchemaViewOptions;
  readonly targetOwnership?: TargetOwnership;
  readonly quota?: Partial<Record<string, unknown>>;
  readonly contracts?: readonly IntegrationContract[];
}

export interface Harness {
  readonly facade: UGCIngressFacade;
  readonly registry: RegistryDouble;
  readonly runtime: ReturnType<typeof runtimeCompatibility>;
  readonly baselineSources: BaselineSources;
  readonly profile: TrustedQuotaProfile;
}

/**
 * 组装完整流水线。所有阶段共享同一个诊断工厂、指纹器与配额档案——这正是需求 3.3 要求的
 * "等价候选在任何来源下适用同一套 Schema、契约、配额与诊断策略"。
 */
export function createHarness(options: HarnessOptions = {}): Harness {
  const registry = registryDouble(options.targetOwnership ?? 'base-layer');
  const runtime = runtimeCompatibility();
  const profile = quotaProfile(options.quota ?? {});

  const contractsResult = createIntegrationContractCatalog({ fingerprint, factory }, options.contracts ?? [
    {
      domain: 'core-mechanics',
      providerId: 'provider.core',
      version: '1.0.0',
      exportedDefKinds: ['action'],
      exportedSemanticFamilies: ['cost'],
      referenceConstraintsFingerprint: 'rc-1',
      sourceRecords: [harnessSourceRecord],
    },
  ]);
  if (!contractsResult.ok) throw new Error('harness contract catalog is invalid');
  const contracts = contractsResult.value;

  const schemaCatalog = schemaVersionCatalog();
  const baselineSources: BaselineSources = {
    registry,
    schemaCatalog,
    contracts,
    diagnosticCatalog,
    quotaProfile: profile,
    fingerprint,
  };

  const validation = createValidationCoordinator({
    decoder: createStrictJsonDecoder(factory),
    prohibitedConstructGate: createProhibitedConstructGate(factory, effectContract()),
    migration: createSchemaMigrationCoordinator({ catalog: schemaCatalog, gateway: migrationGateway(), factory, maxSteps: 8 }),
    canonicalization: createCanonicalizationGateway({ schema: canonicalSchemaView(), fingerprint, factory }),
    baselineSources,
    contracts,
    definitionValidation: definitionValidator(options.validator),
    referenceResolution: referenceResolver(options.resolver),
    runtimeCompatibility: runtime,
    presentation: createPresentationFallbackResolver(factory),
    schemaView: schemaView(options.schema),
    registry,
    quotaProfile: profile,
    fingerprint,
    factory,
  });

  const activation = createAtomicActivationCoordinator({ registry, baselineSources, fingerprint, factory });
  const facade = createUGCIngressFacade({ validation, activation, factory, fingerprint, quotaProfile: profile });

  return { facade, registry, runtime, baselineSources, profile };
}

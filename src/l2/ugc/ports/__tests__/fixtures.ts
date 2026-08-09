/**
 * l2 端口测试夹具：构造规范化变更请求与验证上下文。
 *
 * 这里手工构造 `CanonicalCandidate`：`canonicalJson` 为给定 JSON 文本，`decodedValue` 恒由
 * `JSON.parse(canonicalJson)` 派生，保证两者语义一致（与 UGC canonicalizer 的不变量相同）。
 */

import { createDiagnosticCodeCatalog } from '../../../../core/ugc/diagnostics/code-catalog.js';
import { createDiagnosticFactory } from '../../../../core/ugc/diagnostics/factory.js';
import { sha256FingerprintGateway } from '../../../../core/ugc/ports/sha256-fingerprint-gateway.js';
import { createQuotaBudget } from '../../../../core/ugc/quota/quota-budget.js';
import type { QuotaBudget, TrustedQuotaProfile } from '../../../../core/ugc/model/quota-types.js';
import { QUOTA_KINDS } from '../../../../core/ugc/model/quota-types.js';
import type { CanonicalizedChangeRequest } from '../../../../core/ugc/model/canonical-types.js';
import type { ChangeOperation, TargetOwnership } from '../../../../core/ugc/model/candidate.js';
import type {
  DefinitionValidationContext,
} from '../../../../core/ugc/ports/definition-ports.js';
import type {
  DefinitionRegistryReadSnapshot,
  UpstreamSchemaView,
} from '../../../../core/ugc/model/upstream.js';
import type { ValidationBaseline } from '../../../../core/ugc/model/baseline.js';
import type { IntegrationContractSnapshot } from '../../../../core/ugc/model/contract-types.js';

export const catalog = createDiagnosticCodeCatalog(sha256FingerprintGateway);
export const factory = createDiagnosticFactory(catalog);

/** 一个宽松配额档案：每项都足够大，使配额本身不会成为测试噪声。 */
export function generousProfile(): TrustedQuotaProfile {
  const record: Record<string, unknown> = { profileId: 'test-profile', version: '1' };
  for (const kind of QUOTA_KINDS) {
    record[kind] = 1_000_000;
  }
  return record as unknown as TrustedQuotaProfile;
}

/** 指定某一类别为极小值的配额档案，用于触发配额路径。 */
export function tightProfile(tight: Partial<Record<(typeof QUOTA_KINDS)[number], number>>): TrustedQuotaProfile {
  const record: Record<string, unknown> = { profileId: 'test-tight', version: '1' };
  for (const kind of QUOTA_KINDS) {
    record[kind] = tight[kind] ?? 1_000_000;
  }
  return record as unknown as TrustedQuotaProfile;
}

export function budget(profile: TrustedQuotaProfile = generousProfile()): QuotaBudget {
  return createQuotaBudget(profile);
}

/** 一个通过 l2 全量验证的最小合法定义包（结构取自 test/l2 的模块 DAG 契约测试）。 */
export function validPackageJson(packageId = 'pkg-port'): string {
  return JSON.stringify({
    packageId,
    schemaVersion: 'l2-declarative/1',
    dependencies: [],
    sourceRecords: [
      {
        sourceFile: 'docs/x.md',
        sourceLocation: { sourceFile: 'docs/x.md', section: 's' },
        precedence: 'finalized-l2-contract',
        classification: 'Normative_Contract',
        owningLayer: '基类层',
        statementFingerprint: 'pkg',
      },
    ],
    definitions: [
      {
        id: 'dmg-basic',
        defKind: 'rule',
        abstract: false,
        semanticFamily: { familyId: 'damage' },
        typeIdentity: { requiredCapabilities: ['deal-damage'], legalRelationships: [], invariants: [], substitutionCompatibility: [] },
        composition: [],
        parameterSchema: { fields: [], crossFieldConstraints: [] },
        tags: [],
        actionRefs: [],
        ruleRefs: [],
        familyContract: {
          contractKind: 'damage',
          damageCategory: 'physical',
          sourceRequirements: [],
          targetRequirements: [],
          settlementPipelineRefs: [
            { refId: 'pipe-1', role: 'rule', expected: { defKind: 'rule', allowAbstract: false }, required: false, jsonPath: '/x' },
          ],
        },
        sourceRecords: [
          {
            sourceFile: 'docs/x.md',
            sourceLocation: { sourceFile: 'docs/x.md', section: 's' },
            precedence: 'finalized-l2-contract',
            classification: 'Normative_Contract',
            owningLayer: '基类层',
            statementFingerprint: 'dmg',
          },
        ],
      },
    ],
  });
}

/** 构造一个规范化变更请求。`decodedValue` 恒由 `canonicalJson` 派生。 */
export function makeRequest(input: {
  readonly canonicalJson: string;
  readonly operation?: ChangeOperation;
  readonly targetOwnership?: TargetOwnership;
  readonly packageId?: string;
  readonly documentId?: string;
  readonly expectedTargetId?: string | null;
}): CanonicalizedChangeRequest {
  const targetOwnership = input.targetOwnership ?? 'base-layer';
  const packageId = input.packageId ?? 'pkg-port';
  const documentId = input.documentId ?? 'doc-1';
  const operation = input.operation ?? 'add';
  const decodedValue = JSON.parse(input.canonicalJson) as unknown;
  return Object.freeze({
    candidate: Object.freeze({
      source: Object.freeze({
        kind: 'hand-authored' as const,
        documentId,
        packageId,
        sourceName: 'test-source',
        receivedAtSequence: 0,
      }),
      targetOwnership,
      schemaVersion: 'l2-declarative/1',
      canonicalJson: input.canonicalJson,
      canonicalFingerprint: `fp-${documentId}`,
      decodedValue,
      migrationIds: Object.freeze([]),
    }),
    binding: Object.freeze({
      candidateFingerprint: `fp-${documentId}`,
      sourcePackageId: packageId,
      sourceDocumentId: documentId,
      targetOwnership,
      operation,
      expectedTargetId: input.expectedTargetId ?? null,
    }),
    changeRequestFingerprint: `crfp-${documentId}`,
  });
}

const emptyContracts: IntegrationContractSnapshot = Object.freeze({
  catalogVersion: 'icat-empty',
  contracts: Object.freeze([]),
  fingerprint: 'empty',
});

export function contractsSnapshot(snapshot?: IntegrationContractSnapshot): IntegrationContractSnapshot {
  return snapshot ?? emptyContracts;
}

/** 一个不使用具体规则的最小 SchemaView 替身（本端口的 validate 不读它，仅为满足类型）。 */
export function stubSchemaView(): UpstreamSchemaView {
  return Object.freeze({
    schemaCatalogVersion: 'schema-1',
    classifyField: () => 'semantic',
    provesNonSemantic: () => false,
    fallbackFor: () => null,
    listPresentationGaps: () => Object.freeze([]),
    semanticFingerprint: () => 'sfp',
    withResolvedPresentation: (candidate: unknown) => candidate as never,
  });
}

const stubBaseline: ValidationBaseline = Object.freeze({
  definitionRegistryVersion: 'placeholder',
  schemaCatalogVersion: 'schema-1',
  integrationContractFingerprint: 'empty',
  diagnosticCatalogVersion: catalog.version,
  quotaProfileId: 'test-profile',
  quotaProfileVersion: '1',
  fingerprint: 'baseline-fp',
});

/** 构造验证上下文。`activeSnapshot` 由调用方从注册表端口读取后传入。 */
export function makeValidationContext(
  activeSnapshot: DefinitionRegistryReadSnapshot,
  overrides?: Partial<ValidationBaseline>,
): DefinitionValidationContext {
  return Object.freeze({
    baseline: overrides === undefined ? stubBaseline : Object.freeze({ ...stubBaseline, ...overrides }),
    contracts: emptyContracts,
    activeSnapshot,
    schema: stubSchemaView(),
  });
}

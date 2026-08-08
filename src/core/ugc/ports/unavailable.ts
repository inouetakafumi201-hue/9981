/**
 * 失败关闭适配器（design.md「Ownership and dependency boundaries」/ 需求 7.4、15.3；tasks.md 2.2）。
 *
 * 每个适配器：
 * - 返回带来源、所有者与修复提示的 `E_LOAD_UNRESOLVED_CONTRACT` 诊断；
 * - **不**调用任何后续端口；
 * - **不**产生 validated 产物或依赖图；
 * - **不**改变任何可观察快照（注册表适配器的 previous 与 active 指纹恒相同且 `unchanged` 为 true）。
 */
import type { Diagnostic } from '../../kernel/state/diagnostic.js';
import type { ValidationBaseline } from '../model/baseline.js';
import type { TargetOwnership } from '../model/candidate.js';
import type { ActivationResult } from '../model/report.js';
import type { DefinitionRegistryReadSnapshot } from '../model/upstream.js';
import type { ValidatedChangeSet } from '../model/validated-change-set.js';
import type { UGCDiagnosticFactory } from '../diagnostics/factory.js';
import type { ValidationStage } from '../model/stage.js';
import { UNAVAILABLE_PROVIDER_ID, UNRESOLVED_PORT_CORRECTION, describeUnresolvedPort } from './availability.js';
import type { UnresolvedPortEvidence } from './availability.js';
import type { CanonicalizedChangeRequest } from '../model/canonical-types.js';
import type {
  DefinitionRegistryGateway,
  DefinitionValidationGateway,
  ReferenceResolutionGateway,
  ReferenceStageResult,
  RuntimeCompatibilityGateway,
  ValidationStageResult,
} from './definition-ports.js';
import type { SchemaMigrationGateway, SchemaVersionCatalog, TrustedSchemaMigration } from './schema-ports.js';

export const UNAVAILABLE_SNAPSHOT_FINGERPRINT = 'ugc-unavailable-registry-snapshot';

/** 由端口证据构造统一的未汇合契约诊断。 */
export function unresolvedContractDiagnostic(
  factory: UGCDiagnosticFactory,
  stage: ValidationStage,
  sourcePackage: string,
  evidence: UnresolvedPortEvidence,
): Diagnostic {
  return factory.changeSet({
    selector: { category: 'REFERENCE_CONTRACT', condition: 'unresolved-contract' },
    stage,
    sourcePackage,
    message: `Upstream port ${evidence.portName} is not merged; validation fails closed.`,
    reason: describeUnresolvedPort(evidence),
    correctionSuggestion: UNRESOLVED_PORT_CORRECTION,
    expected: `${evidence.portName} available`,
    actual: 'unavailable',
    sourceSpan: null,
    jsonPath: null,
    messageArgs: { port: evidence.portName, owner: evidence.owner },
  });
}

export const DEFINITION_VALIDATOR_EVIDENCE: UnresolvedPortEvidence = Object.freeze({
  portName: 'Definition_Validator',
  owner: '基类层（.kiro/specs/l2-base-layer-spec）',
  evidence: '.kiro/specs/wakeup-ugc/实施基线与决策记录.md §1.2.2；src/l2 尚无 validator 实现落盘',
  blockedStages: ['definition-validation', 'reference-resolution', 'presentation-resolution', 'activation-precheck'],
});

export const REFERENCE_RESOLVER_EVIDENCE: UnresolvedPortEvidence = Object.freeze({
  portName: 'Reference_Resolver',
  owner: '基类层（.kiro/specs/l2-base-layer-spec）',
  evidence: '.kiro/specs/wakeup-ugc/实施基线与决策记录.md §1.2.3',
  blockedStages: ['reference-resolution', 'presentation-resolution', 'activation-precheck'],
});

export const DEFINITION_REGISTRY_EVIDENCE: UnresolvedPortEvidence = Object.freeze({
  portName: 'Definition_Registry（批量原子）',
  owner: '基类层（.kiro/specs/l2-base-layer-spec）',
  evidence:
    '.kiro/specs/wakeup-ugc/实施基线与决策记录.md §1.2.4；内核 DefRegistry 逐项写入且 replaceFrom 无 CAS/版本/快照',
  blockedStages: ['activation-precheck'],
});

export const RUNTIME_COMPATIBILITY_EVIDENCE: UnresolvedPortEvidence = Object.freeze({
  portName: 'RuntimeCompatibilityGateway',
  owner: '引擎层生命周期/持久化契约',
  evidence: '.kiro/specs/wakeup-ugc/实施基线与决策记录.md §1.2.6',
  blockedStages: ['definition-validation'],
});

export const SCHEMA_CATALOG_EVIDENCE: UnresolvedPortEvidence = Object.freeze({
  portName: 'SchemaVersionCatalog',
  owner: '基类层 Schema 契约',
  evidence: '.kiro/specs/wakeup-ugc/实施基线与决策记录.md §1.2.7',
  blockedStages: ['decode', 'schema-migration', 'canonicalize'],
});

export const SCHEMA_MIGRATION_EVIDENCE: UnresolvedPortEvidence = Object.freeze({
  portName: 'SchemaMigrationGateway',
  owner: '可信宿主（文档迁移边注册）',
  evidence: '.kiro/specs/wakeup-ugc/实施基线与决策记录.md §1.2.7',
  blockedStages: ['schema-migration'],
});

export function createUnavailableDefinitionValidationGateway(
  factory: UGCDiagnosticFactory,
): DefinitionValidationGateway {
  return Object.freeze({
    providerId: UNAVAILABLE_PROVIDER_ID,
    version: UNAVAILABLE_PROVIDER_ID,
    validate(request: CanonicalizedChangeRequest): ValidationStageResult {
      return Object.freeze({
        diagnostics: Object.freeze([
          unresolvedContractDiagnostic(
            factory,
            'definition-validation',
            request.candidate.source.packageId,
            DEFINITION_VALIDATOR_EVIDENCE,
          ),
        ]),
        coveredCapabilities: Object.freeze([]),
        validated: null,
      });
    },
  });
}

export function createUnavailableReferenceResolutionGateway(
  factory: UGCDiagnosticFactory,
  sourcePackage: string,
): ReferenceResolutionGateway {
  return Object.freeze({
    providerId: UNAVAILABLE_PROVIDER_ID,
    version: UNAVAILABLE_PROVIDER_ID,
    resolve(): ReferenceStageResult {
      return Object.freeze({
        diagnostics: Object.freeze([
          unresolvedContractDiagnostic(factory, 'reference-resolution', sourcePackage, REFERENCE_RESOLVER_EVIDENCE),
        ]),
        coveredCapabilities: Object.freeze([]),
        graph: null,
      });
    },
  });
}

export function createUnavailableDefinitionRegistryGateway(
  factory: UGCDiagnosticFactory,
  targetOwnership: TargetOwnership,
  sourcePackage: string,
): DefinitionRegistryGateway {
  const snapshot: DefinitionRegistryReadSnapshot = Object.freeze({
    registryVersion: UNAVAILABLE_PROVIDER_ID,
    snapshotFingerprint: UNAVAILABLE_SNAPSHOT_FINGERPRINT,
    targetOwnership,
    activeDefinitionIds: Object.freeze([]),
    payload: null,
  });

  return Object.freeze({
    providerId: UNAVAILABLE_PROVIDER_ID,
    version: UNAVAILABLE_PROVIDER_ID,
    targetOwnership,
    readSnapshot(): DefinitionRegistryReadSnapshot {
      return snapshot;
    },
    activateAtomically(change: ValidatedChangeSet, expected: ValidationBaseline): ActivationResult {
      return Object.freeze({
        status: 'rejected',
        baseline: expected,
        candidateFingerprint: change.candidateFingerprint,
        changeRequestFingerprint: change.changeRequestFingerprint,
        diagnostics: Object.freeze([
          unresolvedContractDiagnostic(factory, 'activation-precheck', sourcePackage, DEFINITION_REGISTRY_EVIDENCE),
        ]),
        previousSnapshotFingerprint: UNAVAILABLE_SNAPSHOT_FINGERPRINT,
        activeSnapshotFingerprint: UNAVAILABLE_SNAPSHOT_FINGERPRINT,
        unchanged: true,
      });
    },
  });
}

export function createUnavailableRuntimeCompatibilityGateway(
  factory: UGCDiagnosticFactory,
  sourcePackage: string,
): RuntimeCompatibilityGateway {
  const diagnostic = (): readonly Diagnostic[] =>
    Object.freeze([
      unresolvedContractDiagnostic(factory, 'definition-validation', sourcePackage, RUNTIME_COMPATIBILITY_EVIDENCE),
    ]);
  return Object.freeze({
    providerId: UNAVAILABLE_PROVIDER_ID,
    version: UNAVAILABLE_PROVIDER_ID,
    validatePlaypackOrSaveDeclaration: diagnostic,
    rejectActiveMatchReplacement: diagnostic,
  });
}

/**
 * 未汇合的 Schema 版本目录。所有查询保守返回"不支持"，同时通过 `providerId` 让调用方能区分
 * "目录未汇合"与"目录已汇合但不支持该版本"——两者对创作者的含义完全不同（见 availability.ts）。
 */
export function createUnavailableSchemaVersionCatalog(): SchemaVersionCatalog {
  return Object.freeze({
    providerId: UNAVAILABLE_PROVIDER_ID,
    catalogVersion: UNAVAILABLE_PROVIDER_ID,
    supports(): boolean {
      return false;
    },
    isWellFormed(): boolean {
      return false;
    },
    supportedVersions(): readonly string[] {
      return Object.freeze([]);
    },
    compare(): number {
      return 0;
    },
  });
}

/** 未汇合的文档迁移注册表。零迁移边，且 `providerId` 标记为未汇合。 */
export function createUnavailableSchemaMigrationGateway(): SchemaMigrationGateway {
  return Object.freeze({
    providerId: UNAVAILABLE_PROVIDER_ID,
    registryVersion: UNAVAILABLE_PROVIDER_ID,
    edges(): readonly TrustedSchemaMigration[] {
      return Object.freeze([]);
    },
  });
}

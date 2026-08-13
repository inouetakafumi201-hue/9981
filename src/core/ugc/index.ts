/**
 * UGC 公共导出根（design.md「Security and Failure-Closed Invariants」/ 需求 1.1-1.3、3.9；tasks.md 2.4）。
 *
 * 只导出：Facade 契约、候选/结果的**只读**类型、允许的 Adapter 接口、端口接口与失败关闭适配器、
 * 以及构造候选所必需的纯函数。
 *
 * 刻意**不**导出：
 * - `ValidatedChangeSet` 的工厂（铸造能力必须留在 activation 内部，见 model/validated-change-set.ts）；
 * - 可变预算对象的内部实现类；
 * - 任何能直接写活动注册表的端口实现；
 * - `WorldState`、`OpRegistry`、Hook 分发器、事务或持久化写入器的任何再导出。
 *
 * 注意：`.eslintrc.cjs` 的分层 `no-restricted-imports` 规则只覆盖 `src/core/kernel/<dir>/**`，
 * **不覆盖 `src/core/ugc/**`**（实施基线记录 §1.1.2）。因此上述边界由
 * `src/core/ugc/__tests__/architecture-boundary.test.ts` 的静态扫描强制，而不是由 ESLint 强制。
 */

// 不可变候选与结果模型。
export type {
  ActivationResult,
  ActivationStatus,
  CandidateChangeRequest,
  CandidateDocument,
  CandidateSource,
  CandidateSourceKind,
  ChangeOperation,
  ChangeRequestBinding,
  PresentationFallbackDecision,
  QuotaKind,
  QuotaUsage,
  QuotaUsageSnapshot,
  SkippedCheck,
  TargetOwnership,
  TrustedQuotaProfile,
  UGCAdapter,
  UgcResult,
  ValidatedChangeSet,
  ValidationBaseline,
  ValidationReport,
  ValidationStage,
  ValidationStatus,
} from './model/index.js';

export {
  CANDIDATE_SOURCE_KINDS,
  CHANGE_OPERATIONS,
  QUOTA_KINDS,
  TARGET_OWNERSHIPS,
  VALIDATION_STAGES,
  candidateFromText,
  copyCandidateBytes,
  createCandidateChangeRequest,
  createCandidateDocument,
  createCandidateSource,
  isValidatedReport,
} from './model/index.js';

// 跨领域契约类型。
export type {
  IntegrationContract,
  IntegrationContractSnapshot,
  IntegrationDomain,
  ResolvedContractExport,
} from './model/contract-types.js';
export { INTEGRATION_DOMAINS } from './model/contract-types.js';

// 诊断：只导出目录、排序与等价比较；工厂供宿主构造诊断，不含任何旁路能力。
export type { DiagnosticCodeCatalog, UGCDiagnosticCategory, UGCDiagnosticFactory } from './diagnostics/index.js';
export {
  UGC_DIAGNOSTIC_CATEGORIES,
  compareDiagnostics,
  createDiagnosticCodeCatalog,
  createDiagnosticFactory,
  diagnosticsEquivalent,
  sortDiagnostics,
} from './diagnostics/index.js';

// 上游端口接口与失败关闭适配器。
export type {
  DefinitionRegistryGateway,
  DefinitionValidationGateway,
  ReferenceResolutionGateway,
  RuntimeCompatibilityGateway,
  SchemaMigrationGateway,
  SchemaVersionCatalog,
  TrustedSchemaMigration,
  UnresolvedPortEvidence,
} from './ports/index.js';
export {
  UNAVAILABLE_PROVIDER_ID,
  createUnavailableDefinitionRegistryGateway,
  createUnavailableDefinitionValidationGateway,
  createUnavailableReferenceResolutionGateway,
  createUnavailableRuntimeCompatibilityGateway,
  createUnavailableSchemaMigrationGateway,
  createUnavailableSchemaVersionCatalog,
  isPortUnavailable,
  sha256FingerprintGateway,
} from './ports/index.js';

export type { StableFingerprintGateway } from './model/index.js';

// 配额：导出档案校验与预算工厂。预算实现类本身不导出。
export { createQuotaBudget, inspectQuotaProfile, validateQuotaProfile } from './quota/index.js';

// 解码：导出解码器工厂与效果契约端口。
export type { EffectContractView, StructuralJsonDecoder } from './codec/index.js';
export { SCHEMA_VERSION_MEMBER, createProhibitedConstructGate, createStrictJsonDecoder } from './codec/index.js';

// 迁移与规范化。
export type { SchemaMigrationCoordinator, SchemaMigrationCoordinatorDeps } from './migration/index.js';
export { createSchemaMigrationCoordinator } from './migration/index.js';
export type { CanonicalizationGateway } from './canonical/index.js';
export { createCanonicalizationGateway } from './canonical/index.js';
export type { CanonicalizationSchemaView } from './ports/schema-ports.js';

// 跨领域契约目录与验证基线。
export type { IntegrationContractCatalog } from './contracts/index.js';
export { createIntegrationContractCatalog, inspectContracts } from './contracts/index.js';
export type { BaselineSources } from './baseline/index.js';
export { captureBaseline, recheckBaseline } from './baseline/index.js';

// 适配器：四种来源共用同一条生产调用链。
export { ALL_ADAPTERS, editorAdapter, handAuthoredAdapter, importAdapter, naturalLanguageAdapter } from './adapter/index.js';

// 验证流水线与表现回退。
export type { CoordinatorDeps, UGCValidationCoordinator } from './validation/index.js';
export {
  ACTIVE_MATCH_REPLACEMENT_MEMBER,
  COMPATIBILITY_MEMBER,
  createValidationCoordinator,
} from './validation/index.js';
export type { PresentationFallbackResolver } from './presentation/index.js';
export { createPresentationFallbackResolver } from './presentation/index.js';

// 原子激活协调器（不导出产物铸造工厂）。
export type { AtomicActivationCoordinator, AtomicActivationDeps } from './activation/atomic-activation-coordinator.js';
export { createAtomicActivationCoordinator } from './activation/atomic-activation-coordinator.js';

// 唯一公共入口。
export type { FacadeDeps, UGCIngressFacade } from './facade/ugc-ingress-facade.js';
export { createUGCIngressFacade } from './facade/ugc-ingress-facade.js';

// 基类层真实端口的唯一生产装配边界。
export type { L2UGCHostDependencies, L2UGCIntegration } from './integration/l2-adapter.js';
export { assembleL2UGCIntegration, createL2UGCIntegration } from './integration/l2-adapter.js';
export type { L2PortBundle, L2PortBundleProblem } from './integration/l2-port-contract.js';
export {
  L2PortBundleContractError,
  assertL2PortBundle,
  inspectL2PortBundle,
  isL2PortBundleReady,
} from './integration/l2-port-contract.js';

// 上游 Schema 视图与效果契约端口（由基类层实现）。
export type { UpstreamSchemaView, PresentationGap, FieldClassification } from './model/upstream.js';

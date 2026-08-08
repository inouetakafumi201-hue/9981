/**
 * UGC 上游端口导出根。
 *
 * 这里只导出**接口**、失败关闭适配器和默认指纹实现。刻意不导出任何"能直接写活动注册表"的实现：
 * 真实适配器属于任务 11.1，且必须等基类层端口冻结（见实施基线记录 §1.2.5）。
 */
export type { UpstreamPortIdentity, UnresolvedPortEvidence } from './availability.js';
export {
  UNAVAILABLE_PROVIDER_ID,
  UNRESOLVED_PORT_CORRECTION,
  describeUnresolvedPort,
  isPortUnavailable,
} from './availability.js';

export type {
  DefinitionRegistryGateway,
  DefinitionValidationContext,
  DefinitionValidationGateway,
  ReferenceResolutionGateway,
  ReferenceStageResult,
  ResolutionCapability,
  RuntimeCompatibilityGateway,
  ValidationCapability,
  ValidationStageResult,
} from './definition-ports.js';
export {
  MANDATORY_RESOLUTION_CAPABILITIES,
  MANDATORY_VALIDATION_CAPABILITIES,
} from './definition-ports.js';

export type { SchemaMigrationGateway, SchemaVersionCatalog, TrustedSchemaMigration } from './schema-ports.js';

export {
  DEFINITION_REGISTRY_EVIDENCE,
  DEFINITION_VALIDATOR_EVIDENCE,
  REFERENCE_RESOLVER_EVIDENCE,
  RUNTIME_COMPATIBILITY_EVIDENCE,
  SCHEMA_CATALOG_EVIDENCE,
  SCHEMA_MIGRATION_EVIDENCE,
  UNAVAILABLE_SNAPSHOT_FINGERPRINT,
  createUnavailableDefinitionRegistryGateway,
  createUnavailableDefinitionValidationGateway,
  createUnavailableReferenceResolutionGateway,
  createUnavailableRuntimeCompatibilityGateway,
  createUnavailableSchemaMigrationGateway,
  createUnavailableSchemaVersionCatalog,
  unresolvedContractDiagnostic,
} from './unavailable.js';

export { SHA256_ALGORITHM_ID, sha256FingerprintGateway } from './sha256-fingerprint-gateway.js';

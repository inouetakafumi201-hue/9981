/**
 * UGC 上游端口导出根。
 *
 * 这里只导出接口、失败关闭适配器和默认指纹实现。真实基类层端口实现仍由 `src/l2/ugc/ports`
 * 拥有；UGC 只在 `integration/l2-adapter.ts` 的唯一装配缝消费其冻结导出，不从本端口根再导出
 * registry 实现或 l2 内部形状。
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

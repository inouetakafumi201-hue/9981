/**
 * L2 → wakeup-ugc 消费端口：统一导出（PT-02 交付面）。
 *
 * 消费方（wakeup-ugc 任务 11.1）只需 `createL2PortBundle()`，得到满足其 `L2PortBundle`
 * 目标形状的对象，再用 `inspectL2PortBundle` 校验后装配即可。其余导出供 l2 侧测试与高级装配使用。
 */

export {
  createL2PortBundle,
  type L2PortBundle,
  type L2PortBundleOptions,
  type AssembledL2Ports,
} from './port-bundle.js';

export { createL2DefinitionValidationGateway, type L2ValidationGatewayOptions } from './validation-gateway.js';
export { createL2ReferenceResolutionGateway, type L2ResolutionGatewayOptions } from './resolution-gateway.js';
export {
  createL2DefinitionRegistryGateway,
  type L2RegistryGatewayOptions,
  type L2DefinitionRegistryGateway,
} from './registry-gateway.js';

export {
  L2_PORT_PROVIDER_ID,
  L2_PORT_VERSION,
  L2_VALIDATED_PAYLOAD_KIND,
  L2_GRAPH_PAYLOAD_KIND,
  L2_SNAPSHOT_PAYLOAD_KIND,
  type L2ValidatedPayload,
  type L2GraphPayload,
  type L2SnapshotPayload,
} from './port-common.js';

export { createSourceIndex, type SourceIndex } from './source-index.js';
export {
  projectL2Diagnostic,
  projectL2Diagnostics,
  projectSourceRecord,
  L2_DIAGNOSTIC_SELECTORS,
  type DiagnosticProjectionContext,
} from './diagnostic-projection.js';
export { scanUnknownMembers, type UnknownMember, type ClosedSchemaScanResult } from './closed-schema.js';
export { mapCandidatePackage, definitionAnchorsOf, type CandidateMappingResult } from './package-mapping.js';
export { detectPackageCycles, type PackageCycleInput } from './package-cycle.js';
export {
  buildProviderIndex,
  resolveProviderDomain,
  type ProviderIndex,
  type ProviderVerdict,
} from './provider-domain.js';

/**
 * wakeup-ugc → 基类层真实端口的唯一生产装配边界（tasks.md 11.1）。
 *
 * 本文件只做 composition-root 装配：
 * - 从基类层稳定导出面取得一个端口 bundle；
 * - 用消费方拥有的运行期契约检查该 bundle；
 * - 按目标层选择独立 registry，并把同一个 registry 同时交给基线采集、验证和原子激活；
 * - 把基类层 validation / resolution 端口原样注入统一 UGC 流水线。
 *
 * 它不转换候选、Schema、诊断、依赖图、版本令牌或规范化快照，也不实现第二套 validator、resolver
 * 或 registry。除本文件外，`src/core/ugc/integration/` 不得再 import `src/l2/**`；对应静态守卫见
 * `integration/__tests__/l2-port-contract.test.ts`。
 */
import { createL2PortBundle } from '../../../l2/ugc/ports/index.js';
import type { BaselineSources } from '../baseline/baseline-factory.js';
import type { CanonicalizationGateway } from '../canonical/canonicalizer.js';
import type { ProhibitedConstructGate } from '../codec/prohibited-construct-gate.js';
import type { StructuralJsonDecoder } from '../codec/strict-json-decoder.js';
import type { IntegrationContractCatalog } from '../contracts/integration-contract-catalog.js';
import type { DiagnosticCodeCatalog } from '../diagnostics/code-catalog.js';
import type { UGCDiagnosticFactory } from '../diagnostics/factory.js';
import { createUGCIngressFacade, type UGCIngressFacade } from '../facade/ugc-ingress-facade.js';
import type { SchemaMigrationCoordinator } from '../migration/schema-migration-coordinator.js';
import { TARGET_OWNERSHIPS, type TargetOwnership } from '../model/candidate.js';
import type { StableFingerprintGateway } from '../model/fingerprint.js';
import type { TrustedQuotaProfile } from '../model/quota-types.js';
import type { UpstreamSchemaView } from '../model/upstream.js';
import type { PresentationFallbackResolver } from '../presentation/fallback-resolver.js';
import type { RuntimeCompatibilityGateway } from '../ports/definition-ports.js';
import type { SchemaVersionCatalog } from '../ports/schema-ports.js';
import { createAtomicActivationCoordinator } from '../activation/atomic-activation-coordinator.js';
import { createValidationCoordinator } from '../validation/coordinator.js';
import {
  assertL2PortBundle,
  type L2PortBundle,
} from './l2-port-contract.js';

/**
 * 非基类层端口依赖由可信宿主提供。适配器不为缺失依赖发明默认值，也不复制这些端口的语义。
 * 同一组对象会被两个目标层的 Facade 共享；只有 registry / baselineSources 按层隔离。
 */
export interface L2UGCHostDependencies {
  readonly decoder: StructuralJsonDecoder;
  readonly prohibitedConstructGate: ProhibitedConstructGate;
  readonly migration: SchemaMigrationCoordinator;
  readonly canonicalization: CanonicalizationGateway;
  readonly schemaCatalog: SchemaVersionCatalog;
  readonly contracts: IntegrationContractCatalog;
  readonly runtimeCompatibility: RuntimeCompatibilityGateway;
  readonly presentation: PresentationFallbackResolver;
  readonly schemaView: UpstreamSchemaView;
  readonly diagnosticCatalog: DiagnosticCodeCatalog;
  readonly quotaProfile: TrustedQuotaProfile;
  readonly fingerprint: StableFingerprintGateway;
  readonly factory: UGCDiagnosticFactory;
}

/**
 * 每个 Facade 永久绑定一个目标层 registry。调用方先按候选声明选择 Facade；即使选错，真实 validator
 * 仍会用候选、绑定与 registry 三方目标层核对再次失败关闭。
 */
export interface L2UGCIntegration {
  readonly providerId: string;
  readonly version: string;
  readonly facades: Readonly<Record<TargetOwnership, UGCIngressFacade>>;
  facadeFor(targetOwnership: TargetOwnership): UGCIngressFacade;
}

function facadeForTarget(
  targetOwnership: TargetOwnership,
  ports: L2PortBundle,
  deps: L2UGCHostDependencies,
): UGCIngressFacade {
  const registry = ports.registries[targetOwnership];
  const baselineSources: BaselineSources = Object.freeze({
    registry,
    schemaCatalog: deps.schemaCatalog,
    contracts: deps.contracts,
    diagnosticCatalog: deps.diagnosticCatalog,
    quotaProfile: deps.quotaProfile,
    fingerprint: deps.fingerprint,
  });

  const validation = createValidationCoordinator({
    decoder: deps.decoder,
    prohibitedConstructGate: deps.prohibitedConstructGate,
    migration: deps.migration,
    canonicalization: deps.canonicalization,
    baselineSources,
    contracts: deps.contracts,
    definitionValidation: ports.validation,
    referenceResolution: ports.resolution,
    runtimeCompatibility: deps.runtimeCompatibility,
    presentation: deps.presentation,
    schemaView: deps.schemaView,
    registry,
    quotaProfile: deps.quotaProfile,
    fingerprint: deps.fingerprint,
    factory: deps.factory,
  });
  const activation = createAtomicActivationCoordinator({
    registry,
    baselineSources,
    fingerprint: deps.fingerprint,
    factory: deps.factory,
  });

  return createUGCIngressFacade({
    validation,
    activation,
    factory: deps.factory,
    fingerprint: deps.fingerprint,
    quotaProfile: deps.quotaProfile,
  });
}

/**
 * 把一个已创建的 bundle 装入 UGC。该入口用于宿主依赖注入和邻接 contract tests；bundle 按 unknown
 * 接收是刻意的，使运行期检查不会被调用方的类型断言绕过。契约不满足时在暴露任何 Facade 前抛错，
 * 因而不存在“缺端口但继续接收候选”的半装配状态。
 */
export function assembleL2UGCIntegration(
  bundle: unknown,
  deps: L2UGCHostDependencies,
): L2UGCIntegration {
  const ports = assertL2PortBundle(bundle);
  const facades = Object.fromEntries(
    TARGET_OWNERSHIPS.map((targetOwnership) => [
      targetOwnership,
      facadeForTarget(targetOwnership, ports, deps),
    ]),
  ) as Record<TargetOwnership, UGCIngressFacade>;
  const frozenFacades = Object.freeze({ ...facades });

  return Object.freeze({
    providerId: ports.validation.providerId,
    version: ports.validation.version,
    facades: frozenFacades,
    facadeFor(targetOwnership: TargetOwnership): UGCIngressFacade {
      return frozenFacades[targetOwnership];
    },
  });
}

/**
 * 生产便捷入口。基类层 bundle 与 UGC 流水线共享同一指纹器、诊断目录和工厂，防止相邻阶段使用
 * 内容相似但身份不同的诊断基础设施。端口创建后仍必须经过消费方运行期契约检查。
 */
export function createL2UGCIntegration(deps: L2UGCHostDependencies): L2UGCIntegration {
  const bundle = createL2PortBundle({
    fingerprintGateway: deps.fingerprint,
    catalog: deps.diagnosticCatalog,
    factory: deps.factory,
  });
  return assembleL2UGCIntegration(bundle, deps);
}

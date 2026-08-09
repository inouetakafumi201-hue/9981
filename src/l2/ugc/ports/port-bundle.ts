/**
 * L2 → wakeup-ugc 端口：装配满足 `L2PortBundle` 目标形状的端口集合。
 *
 * 这是 PT-02 的交付顶点：wakeup-ugc 侧的 `L2PortBundle`（`src/core/ugc/integration/l2-port-contract.ts`）
 * 描述了「l2 需要交付什么」，本函数在 l2 侧把三个端口装成正好满足那个形状的对象。装配时统一：
 * - 三个端口**共享同一个诊断代码目录与工厂**：否则各自 `createDiagnosticCodeCatalog` 会派生出内容相同
 *   但对象不同的目录，虽然版本串一致但没必要重复计算，也让「同一份诊断目录」这件事显式化；
 * - 两个注册表端口（base-layer / play-layer）各自独立持有状态，使「跨层提交」能在 UGC 侧被
 *   `targetOwnership` 核对拦下（这正是 `L2PortBundle.registries` 按层分别提供的原因）。
 *
 * 关键解耦点：本文件**不 import** `src/core/ugc/integration/l2-port-contract.ts`。它只实现该契约描述的
 * 结构形状（`DefinitionValidationGateway` / `ReferenceResolutionGateway` /
 * `Record<TargetOwnership, DefinitionRegistryGateway>`），由 wakeup-ugc 侧在消费时用
 * `inspectL2PortBundle` 校验。方向是「l2 实现端口，UGC 校验端口」，不是「l2 适配 UGC 的内部形状」。
 */

import { createDiagnosticCodeCatalog } from '../../../core/ugc/diagnostics/code-catalog.js';
import type { DiagnosticCodeCatalog } from '../../../core/ugc/diagnostics/code-catalog.js';
import { createDiagnosticFactory } from '../../../core/ugc/diagnostics/factory.js';
import type { UGCDiagnosticFactory } from '../../../core/ugc/diagnostics/factory.js';
import { sha256FingerprintGateway } from '../../../core/ugc/ports/sha256-fingerprint-gateway.js';
import type { StableFingerprintGateway } from '../../../core/ugc/model/fingerprint.js';
import type {
  DefinitionRegistryGateway,
  DefinitionValidationGateway,
  ReferenceResolutionGateway,
} from '../../../core/ugc/ports/definition-ports.js';
import { TARGET_OWNERSHIPS, type TargetOwnership } from '../../../core/ugc/model/candidate.js';
import { createL2DefinitionValidationGateway } from './validation-gateway.js';
import { createL2ReferenceResolutionGateway } from './resolution-gateway.js';
import { createL2DefinitionRegistryGateway, type L2DefinitionRegistryGateway } from './registry-gateway.js';

/**
 * l2 端口集合。形状刻意与 wakeup-ugc 的 `L2PortBundle` 一致（结构化对齐，无 import 耦合）。
 * 额外用 `L2DefinitionRegistryGateway` 而非基类 `DefinitionRegistryGateway`，使装配层能读到
 * `currentRegistry()`；对 UGC 消费而言它仍满足 `DefinitionRegistryGateway`。
 */
export interface L2PortBundle {
  readonly validation: DefinitionValidationGateway;
  readonly resolution: ReferenceResolutionGateway;
  readonly registries: Readonly<Record<TargetOwnership, DefinitionRegistryGateway>>;
}

export interface L2PortBundleOptions {
  readonly fingerprintGateway?: StableFingerprintGateway;
  /** 复用外部诊断目录/工厂；缺省时内部创建一份并在三个端口间共享。 */
  readonly catalog?: DiagnosticCodeCatalog;
  readonly factory?: UGCDiagnosticFactory;
}

/**
 * 装配 l2 端口集合。
 *
 * 返回值同时给出强类型的注册表句柄映射 `registryHandles`，供需要驱动激活循环的调用方
 * （及本目录测试）读取 `currentRegistry()` 来构造验证/解析端口所需的活动快照载荷。
 */
export interface AssembledL2Ports extends L2PortBundle {
  readonly registryHandles: Readonly<Record<TargetOwnership, L2DefinitionRegistryGateway>>;
  readonly catalog: DiagnosticCodeCatalog;
  readonly factory: UGCDiagnosticFactory;
}

export function createL2PortBundle(options: L2PortBundleOptions = {}): AssembledL2Ports {
  const catalog =
    options.catalog ?? createDiagnosticCodeCatalog(options.fingerprintGateway ?? sha256FingerprintGateway);
  const factory = options.factory ?? createDiagnosticFactory(catalog);
  const shared = { catalog, factory } as const;

  const validation = createL2DefinitionValidationGateway(shared);
  const resolution = createL2ReferenceResolutionGateway(shared);

  const registryHandles = Object.fromEntries(
    TARGET_OWNERSHIPS.map((layer) => [
      layer,
      createL2DefinitionRegistryGateway({ targetOwnership: layer, ...shared }),
    ]),
  ) as Record<TargetOwnership, L2DefinitionRegistryGateway>;

  const registries = registryHandles as Record<TargetOwnership, DefinitionRegistryGateway>;

  return Object.freeze({
    validation,
    resolution,
    registries: Object.freeze({ ...registries }),
    registryHandles: Object.freeze({ ...registryHandles }),
    catalog,
    factory,
  });
}

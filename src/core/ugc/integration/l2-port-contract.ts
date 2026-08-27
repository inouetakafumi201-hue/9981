/**
 * 跨 Spec 端口契约的机器可校验声明（方案 A / tasks.md 11.1）。
 *
 * 契约文档：`docs/L_审查报告/跨Spec契约_wakeup-ugc消费l2端口.md`。
 *
 * 本文件是消费方拥有的稳定目标形状，本身不 import `src/l2/**`。基类层只需让稳定导出满足
 * `L2PortBundle`；真实跨层 import 被集中在相邻的 `l2-adapter.ts`，并由静态测试限制为唯一装配缝。
 * 运行期检查在任何 Facade 暴露前执行，防止类型断言或错误宿主装配把不完整/混合提供方的端口带入链路。
 */
import type {
  DefinitionRegistryGateway,
  DefinitionValidationGateway,
  ReferenceResolutionGateway,
} from '../ports/definition-ports';
import type { TargetOwnership } from '../model/candidate';

/**
 * 基类层交付的端口集合。这里没有 JSON_Codec：解码与规范化属于 wakeup-ugc 自身，基类层从
 * 规范化后的 `decodedValue` / `canonicalJson` 开始工作。
 */
export interface L2PortBundle {
  readonly validation: DefinitionValidationGateway;
  readonly resolution: ReferenceResolutionGateway;
  /** 按目标层分别提供，使跨层提交能在 UGC 侧被拒绝。 */
  readonly registries: Readonly<Record<TargetOwnership, DefinitionRegistryGateway>>;
}

/** 端口集合必须满足的运行期完整性条件。 */
export interface L2PortBundleProblem {
  readonly port: string;
  readonly reason: string;
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object'
    ? value as Readonly<Record<string, unknown>>
    : Object.freeze({});
}

/**
 * 校验基类层交付的端口集合是否结构与身份完整。
 *
 * 除必需方法和目标层标记外，还核对所有端口来自同一 provider/version，并保证两个目标层 registry
 * 不是同一个对象。后两项阻止把验证产物、解析图和活动快照跨提供方或跨目标层拼接。
 */
export function inspectL2PortBundle(bundle: unknown): readonly L2PortBundleProblem[] {
  const problems: L2PortBundleProblem[] = [];
  const record = recordOf(bundle);

  const add = (port: string, reason: string): void => {
    problems.push(Object.freeze({ port, reason }));
  };
  const requireMethod = (portName: string, holder: unknown, method: string): void => {
    const target = recordOf(holder);
    if (typeof target[method] !== 'function') {
      add(portName, `缺少必需方法 ${method}()`);
    }
  };
  const requireIdentity = (portName: string, holder: unknown): { providerId?: string; version?: string } => {
    const target = recordOf(holder);
    const providerId = target['providerId'];
    const version = target['version'];
    if (typeof providerId !== 'string' || providerId.trim().length === 0) {
      add(portName, 'providerId 必须是非空字符串');
    }
    if (typeof version !== 'string' || version.trim().length === 0) {
      add(portName, 'version 必须是非空字符串');
    }
    return {
      ...(typeof providerId === 'string' && providerId.trim().length > 0 ? { providerId } : {}),
      ...(typeof version === 'string' && version.trim().length > 0 ? { version } : {}),
    };
  };

  const validation = record['validation'];
  const resolution = record['resolution'];
  requireMethod('validation', validation, 'validate');
  requireMethod('resolution', resolution, 'resolve');

  const identities: { readonly port: string; readonly providerId?: string; readonly version?: string }[] = [
    { port: 'validation', ...requireIdentity('validation', validation) },
    { port: 'resolution', ...requireIdentity('resolution', resolution) },
  ];

  const registries = recordOf(record['registries']);
  for (const layer of ['base-layer', 'play-layer'] as const) {
    const portName = `registries.${layer}`;
    const registry = registries[layer];
    if (registry === undefined) {
      add(portName, '未提供该目标层的注册表端口');
      continue;
    }
    requireMethod(portName, registry, 'readSnapshot');
    requireMethod(portName, registry, 'activateAtomically');
    const declared = recordOf(registry)['targetOwnership'];
    if (declared !== layer) {
      add(portName, `targetOwnership 必须自证为 ${layer}，实际为 ${String(declared)}`);
    }
    identities.push({ port: portName, ...requireIdentity(portName, registry) });
  }

  if (
    registries['base-layer'] !== undefined &&
    registries['base-layer'] === registries['play-layer']
  ) {
    add('registries', 'base-layer 与 play-layer 必须使用彼此独立的注册表端口对象');
  }

  const completeIdentities = identities.filter(
    (identity): identity is { readonly port: string; readonly providerId: string; readonly version: string } =>
      identity.providerId !== undefined && identity.version !== undefined,
  );
  const providerIds = new Set(completeIdentities.map((identity) => identity.providerId));
  if (providerIds.size > 1) {
    add(
      'providerId',
      `validation、resolution 与 registries 必须来自同一提供方，实际为 ${[...providerIds].sort().join(', ')}`,
    );
  }
  const versions = new Set(completeIdentities.map((identity) => identity.version));
  if (versions.size > 1) {
    add(
      'version',
      `validation、resolution 与 registries 必须使用同一端口版本，实际为 ${[...versions].sort().join(', ')}`,
    );
  }

  return Object.freeze(problems);
}

export function isL2PortBundleReady(bundle: unknown): bundle is L2PortBundle {
  return inspectL2PortBundle(bundle).length === 0;
}

/** 装配期失败：没有任何 Facade 会在该异常之前被创建或暴露。 */
export class L2PortBundleContractError extends Error {
  readonly problems: readonly L2PortBundleProblem[];

  constructor(problems: readonly L2PortBundleProblem[]) {
    super(`基类层端口集合不满足 UGC 契约：${problems.map((problem) => `${problem.port}: ${problem.reason}`).join('; ')}`);
    this.name = 'L2PortBundleContractError';
    this.problems = Object.freeze([...problems]);
  }
}

/** 类型断言不能替代运行期检查；失败时在 composition root 直接关闭接入。 */
export function assertL2PortBundle(bundle: unknown): L2PortBundle {
  const problems = inspectL2PortBundle(bundle);
  if (problems.length > 0) {
    throw new L2PortBundleContractError(problems);
  }
  return bundle as L2PortBundle;
}

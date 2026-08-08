/**
 * 跨 Spec 端口契约的**机器可校验**声明（方案 A / tasks.md 11.1 的前置件）。
 *
 * 契约文档：`docs/L_审查报告/跨Spec契约_wakeup-ugc消费l2端口.md`。
 *
 * 本文件刻意**不 import 任何 `src/l2/**`**：l2 当前仍在活跃变更，且尚未导出符合契约的端口
 * （见实施基线记录的架构冲突章节）。在此耦合会把 wakeup-ugc 绑到 l2 的不稳定内部形状上，
 * 与"解耦优先、基层长远稳定"的裁决原则相悖。
 *
 * 它提供的是**目标形状**：l2 只要让自己的导出满足 `L2PortBundle`，wakeup-ugc 侧
 * 任务 11.1 的适配器就退化为一次纯装配（零语义转换）。等 l2 就位后，本文件的 `assertL2PortBundle`
 * 就是集成的第一道编译期门禁。
 */
import type {
  DefinitionRegistryGateway,
  DefinitionValidationGateway,
  ReferenceResolutionGateway,
} from '../ports/definition-ports.js';
import type { TargetOwnership } from '../model/candidate.js';

/**
 * l2 需要交付的端口集合。
 *
 * 注意这里**没有** JSON_Codec：方案 A 下解码与规范化留在 wakeup-ugc 自身
 * （`codec/`、`canonical/`），l2 只从规范化后的 `decodedValue` 开始工作。
 */
export interface L2PortBundle {
  readonly validation: DefinitionValidationGateway;
  readonly resolution: ReferenceResolutionGateway;
  /** 按目标层分别提供，使"跨层提交"能在 UGC 侧被拒绝。 */
  readonly registries: Readonly<Record<TargetOwnership, DefinitionRegistryGateway>>;
}

/** 端口集合必须满足的运行期完整性条件。 */
export interface L2PortBundleProblem {
  readonly port: string;
  readonly reason: string;
}

/**
 * 校验 l2 交付的端口集合是否结构完整。
 *
 * 这是"信任但验证"：即使 l2 声称实现了端口，wakeway-ugc 仍在装配时核对必需方法与层标记存在，
 * 缺失即失败关闭，而不是等到激活时才炸。
 */
export function inspectL2PortBundle(bundle: unknown): readonly L2PortBundleProblem[] {
  const problems: L2PortBundleProblem[] = [];
  const record = (bundle ?? {}) as Record<string, unknown>;

  const requireMethod = (portName: string, holder: unknown, method: string): void => {
    const target = (holder ?? {}) as Record<string, unknown>;
    if (typeof target[method] !== 'function') {
      problems.push({ port: portName, reason: `缺少必需方法 ${method}()` });
    }
  };

  requireMethod('validation', record['validation'], 'validate');
  requireMethod('resolution', record['resolution'], 'resolve');

  const registries = (record['registries'] ?? {}) as Record<string, unknown>;
  for (const layer of ['base-layer', 'play-layer'] as const) {
    const registry = registries[layer];
    if (registry === undefined) {
      problems.push({ port: `registries.${layer}`, reason: '未提供该目标层的注册表端口' });
      continue;
    }
    requireMethod(`registries.${layer}`, registry, 'readSnapshot');
    requireMethod(`registries.${layer}`, registry, 'activateAtomically');
    const declared = (registry as { readonly targetOwnership?: unknown }).targetOwnership;
    if (declared !== layer) {
      problems.push({
        port: `registries.${layer}`,
        reason: `targetOwnership 必须自证为 ${layer}，实际为 ${String(declared)}`,
      });
    }
  }

  return Object.freeze(problems);
}

export function isL2PortBundleReady(bundle: unknown): bundle is L2PortBundle {
  return inspectL2PortBundle(bundle).length === 0;
}

/**
 * L2 Kernel Port: 真实 L1 `OpRegistry` 适配器。
 *
 * 这是 L2 与 L1 之间唯一的具体绑定点。它只使用**类型导入**引用 L1，
 * 运行时实例由调用方注入，因此 L2 对 L1 没有运行时模块依赖，
 * 但类型检查会真实校验 `OpRegistry.invoke` 的签名。
 *
 * 对应 design.md 批次 D 门禁与 Requirements 6.1、10.13、13.6–13.7。
 */

import type { OpRegistry } from '../../core/kernel/ops/registry.js';
import type { JsonValue } from '../model/json.js';
import type { OpCause, RuntimeSemanticState } from '../model/projection.js';
import { fingerprint } from '../model/ordering.js';
import type { KernelContract, KernelInvokeResult } from './kernel-contract.js';
import { classifyKernelErrorCode } from './kernel-contract.js';

/** 适配器依赖。 */
export interface OpRegistryAdapterDeps {
  /** 真实 L1 OpRegistry 实例。 */
  readonly opRegistry: Pick<OpRegistry, 'invoke' | 'has'>;
  /** 当前运行时语义状态提供者（由 L1 世界状态投影而来）。 */
  readonly runtimeState: () => RuntimeSemanticState;
  /**
   * Hook 分发接线是否已可用。
   * 未接线时依赖 Hook 的动作必须被拒绝（design.md 集成门禁 4）。
   */
  readonly hookIntegrationAvailable: () => boolean;
  /**
   * 因果链记录通道。
   * L1 `OpRegistry.invoke(name, args)` 目前没有 `cause` 形参，L2 通过此回调把 cause 交给
   * 宿主（日志、Journal、诊断）。缺省时 cause 只保留在 `ValidatedOpRequest` 与返回的
   * journal 条目中，不会被丢弃到无处可查。
   */
  readonly recordCause?: (opId: string, cause: OpCause) => void;
  /**
   * 语义状态指纹提供者。缺省时对 `runtimeState()` 取稳定指纹。
   * 宿主若已有更廉价的版本号，可注入以避免重复序列化。
   */
  readonly semanticStateFingerprint?: () => string;
}

/**
 * 用真实 L1 `OpRegistry` 构造 `KernelContract`。
 *
 * 错误映射：L1 `Result<T>` 的 `{ ok:false, code, detail }` 按 `classifyKernelErrorCode`
 * 归类，`code` 与 `detail` 原样透传，不重写、不吞掉。
 */
export function createKernelContractFromOpRegistry(deps: OpRegistryAdapterDeps): KernelContract {
  const fingerprintOf = deps.semanticStateFingerprint ?? (() => fingerprint(deps.runtimeState()));

  return {
    hasOp(opId: string): boolean {
      return deps.opRegistry.has(opId);
    },

    invoke(
      opId: string,
      args: Readonly<Record<string, JsonValue>>,
      cause: OpCause,
    ): KernelInvokeResult {
      deps.recordCause?.(opId, cause);
      const result = deps.opRegistry.invoke<Readonly<Record<string, JsonValue>>, unknown>(opId, args);
      const fingerprintAfter = fingerprintOf();
      if (result.ok) {
        return {
          ok: true,
          journalEntries: Object.freeze([
            `op=${opId}`,
            `cause.requestId=${cause.requestId}`,
            `cause.callerId=${cause.callerId}`,
            `cause.callerKind=${cause.callerKind}`,
            `cause.actionId=${cause.actionId}`,
          ]) as readonly string[],
          semanticStateFingerprintAfter: fingerprintAfter,
        };
      }
      return {
        ok: false,
        kind: classifyKernelErrorCode(result.code),
        code: result.code,
        detail: result.detail,
        semanticStateFingerprintAfter: fingerprintAfter,
      };
    },

    hookIntegrationAvailable(): boolean {
      return deps.hookIntegrationAvailable();
    },

    semanticStateFingerprint(): string {
      return fingerprintOf();
    },

    runtimeState(): RuntimeSemanticState {
      return deps.runtimeState();
    },
  };
}

/**
 * L2 Kernel Port: 注册表桥 —— 从真实 L1 `OpRegistry`/`DefRegistry` 到 L2 稳定端口的
 * 生产装配点（归属已裁：`docs/工程治理/04_整合层_装载运行期_规划设计.md` §五 Q-5 归基类层；
 * 缺漏现状见 `docs/工程治理/05_玩法层彻查CEME_立项轮廓.md` §四·补）。
 *
 * 本文件是「生产装配点」：宿主把真实引擎实例（`OpRegistry`/`DefRegistry` 与运行时投影
 * 依赖）注入 `createRegistryBridge`，桥产出工程内置 `KernelContract` 与只读 Def 视图，
 * 供 UI/AI 适配器（`adapters/ui-adapter.ts`、`adapters/ai-adapter.ts`）与
 * `registry/action-submitter.ts` 消费。桥本身不注册任何 Op、不解析任何定义。
 *
 * 铁律：
 * - 唯一语义写入通道仍是 `OpRegistry.invoke`：`kernel.invoke` 一律经
 *   `createKernelContractFromOpRegistry`（`kernel/op-registry-adapter.ts`）转发到真实 L1，
 *   桥不新增第二写分支。
 * - L2 不反向依赖引擎实现：本文件只做结构类型声明与 type-only import，不 import
 *   `core/kernel/ops/registry`；P12 静态扫描（`test/properties/P12-*.property.test.ts`）
 *   仍只允许 `op-registry-adapter.ts` 绑定 L1 写入通道。
 * - Def 侧保持只读：桥把真实 `DefRegistry.resolve` 的展开产物（继承已由真实解析器展开）
 *   以冻结副本视图暴露，不重复维护第二套解析逻辑；调用方改视图不影响注册表内部。
 * - `hookIntegrationAvailable` 原样透传宿主判定，不伪造；为 false 时依赖 Hook 的动作
 *   由 `action-submitter` 门禁拒绝（`RUNTIME_HOOK_INTEGRATION_UNAVAILABLE`，零 invoke）。
 */

import type { Def, DefKind } from '../../core/kernel/state/def';
import type { Value } from '../../core/kernel/state/value';
import type { Result as L1Result } from '../../core/kernel/ops/result';
import type { Ref } from '../../core/kernel/state/ids';
import type { OpCause, RuntimeSemanticState } from '../model/projection';
import { deepClonePlain, deepFreeze } from '../model/immutable';
import type { KernelContract } from './kernel-contract';
import { createKernelContractFromOpRegistry } from './op-registry-adapter';

/** 桥对 L1 `OpRegistry` 的最小结构契约（与 `OpRegistryAdapterDeps.opRegistry` 同形）。 */
export interface RegistryBridgeOpRegistry {
  has(name: string): boolean;
  invoke<A, T>(name: string, args: A): L1Result<T>;
}

/** 桥对 L1 `DefRegistry` 的最小结构契约（解析完全来自真实解析器）。 */
export interface RegistryBridgeDefRegistry {
  resolve(id: string): Def | null;
  has(id: string): boolean;
}

/** 已解析 L1 Def 的只读视图（继承已展开，`abstract` 恒为严格布尔值）。 */
export interface ResolvedDefView {
  readonly id: string;
  readonly kind: DefKind;
  readonly abstract: boolean;
  readonly extends?: readonly string[];
  readonly tags?: readonly string[];
  readonly props?: Readonly<Record<string, ReadonlyDefValue>>;
  readonly actions?: readonly string[];
  readonly rules?: readonly string[];
  readonly schema?: Readonly<Record<string, unknown>>;
}

/** 只读 Def 视图表：解析来自真实 `DefRegistry.resolve`，桥不维护第二套解析逻辑。 */
export interface DefRegistryView {
  resolve(id: string): ResolvedDefView | null;
  has(id: string): boolean;
}

/**
 * 视图 props 值类型：真实 `DefRegistry` 展开后的 props 里数组元素一律是纯 JSON 值或 Ref，
 * 与 L1 `Value` 的唯一差异是深冻结后的只读嵌套；这里显式建模为「只读值」并把
 * `Value` 的非只读 `Value[]` 分支替换为只读数组，避免与引擎 `Value` 的可变性契约纠缠。
 */
export type ReadonlyDefValue =
  | null
  | boolean
  | number
  | string
  | Ref
  | readonly ReadonlyDefValue[]
  | { readonly [key: string]: ReadonlyDefValue };

/**
 * 把真实解析产物投影为冻结视图副本；不改动注册表内部对象。
 * `props` 仅暴露 L1 可写入的 props 子树（`prop.*` Op 的合法路径区），结构区字段不进入视图。
 */
function toView(def: Def): ResolvedDefView {
  const view: ResolvedDefView = {
    id: def.id,
    kind: def.kind,
    abstract: def.abstract ?? false,
    ...(def.extends === undefined ? {} : { extends: deepFreeze([...def.extends]) }),
    ...(def.tags === undefined ? {} : { tags: deepFreeze([...def.tags]) }),
    ...(def.actions === undefined ? {} : { actions: deepFreeze([...def.actions]) }),
    ...(def.rules === undefined ? {} : { rules: deepFreeze([...def.rules]) }),
    ...(def.props === undefined ? {} : { props: deepFreeze(deepClonePlain(def.props)) }),
    ...(def.schema === undefined
      ? {}
      : { schema: deepFreeze(deepClonePlain(def.schema)) as Readonly<Record<string, unknown>> }),
  };
  return deepFreeze(view) as ResolvedDefView;
}

export interface RegistryBridgeDeps {
  /** 真实 L1 OpRegistry 实例（宿主注入；装配点不自行构造）。 */
  readonly opRegistry: RegistryBridgeOpRegistry;
  /** 真实 L1 DefRegistry 实例（宿主注入；解析展开完全来自它）。 */
  readonly defRegistry: RegistryBridgeDefRegistry;
  /** 当前运行时语义状态提供者（由 L1 世界状态投影而来）。 */
  readonly runtimeState: () => RuntimeSemanticState;
  /** Hook 分发接线是否已可用；原样透传，不伪造。 */
  readonly hookIntegrationAvailable: () => boolean;
  /** 因果链记录通道；缺省时 cause 只保留在 journal 与返回条目中。 */
  readonly recordCause?: (opId: string, cause: OpCause) => void;
  /** 语义状态指纹提供者；缺省对 `runtimeState()` 取稳定指纹。 */
  readonly semanticStateFingerprint?: () => string;
}

/** 生产装配产物：真实引擎实例包裹的稳定端口集合。 */
export interface RegistryBridge {
  /** 真实 L1 OpRegistry 包裹的 KernelContract（唯一语义写入通道）。 */
  readonly kernel: KernelContract;
  /** 真实 L1 DefRegistry 的只读解析视图。 */
  readonly defs: DefRegistryView;
}

/**
 * 装配真实 L1 实例为 L2 稳定端口。
 *
 * - `kernel`：由 `createKernelContractFromOpRegistry` 产出，`invoke` 转发到真实
 *   `OpRegistry.invoke` 单通道；错误 `code/detail` 原样透传，`classifyKernelErrorCode`
 *   归类不变。
 * - `defs`：把真实 `DefRegistry.resolve` 的解析产物投影为冻结视图，只读暴露。
 */
export function createRegistryBridge(deps: RegistryBridgeDeps): RegistryBridge {
  const kernel = createKernelContractFromOpRegistry({
    opRegistry: deps.opRegistry,
    runtimeState: deps.runtimeState,
    hookIntegrationAvailable: deps.hookIntegrationAvailable,
    ...(deps.recordCause === undefined ? {} : { recordCause: deps.recordCause }),
    ...(deps.semanticStateFingerprint === undefined ? {} : { semanticStateFingerprint: deps.semanticStateFingerprint }),
  });

  const defs: DefRegistryView = {
    resolve(id: string): ResolvedDefView | null {
      const resolved = deps.defRegistry.resolve(id);
      return resolved === null ? null : toView(resolved);
    },
    has(id: string): boolean {
      return deps.defRegistry.has(id);
    },
  };

  return { kernel, defs };
}

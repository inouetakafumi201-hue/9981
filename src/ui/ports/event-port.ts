/**
 * 事件端口（design.md §3.0、§3.3、§4.2、C-5）。
 *
 * 主通道绑定 `PresentationGateway.subscribe('after:${opName}')`。但 Gateway 的事件通道
 * **完全没有 Agent 过滤**（C-5：`dispatch` 原样投递 payload，且支持 `'*'` 通配订阅），
 * 因此本文件把边界拆成两层：
 *
 * - `RawEventSource`：宿主适配器暴露的**未收窄**边界。`src/ui` 内**只有**
 *   `projection/scope-filter.ts` 允许消费它，这条约束由架构测试机械检查。
 * - `EventPort`：对外只投递已按 `AuthorizationScope` 收窄、并已过白名单的
 *   `RuleEventProjection`。原始 `Event` 永不进入表现层（Requirement 3.2）。
 */

import type { RuleEventProjection } from '../model/event-projection.js';

export interface EventSubscription {
  readonly unsubscribe: () => void;
}

/** 未收窄的网关事件。`payload` 的取值类型是 `unknown`，迫使消费方先做安全投影。 */
export interface RawGatewayEvent {
  /** 事件类型名，约定为 `after:${opName}`。 */
  readonly type: string;
  /** 对应 `LogEntry.seq`：单调、裁剪后不复用，是唯一的因果排序依据。 */
  readonly sequence: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * 未收窄的事件源。
 *
 * 命名刻意不叫 `EventPort`：它不是 UI 可以直接消费的端口，而是必须先经过单一过滤点的输入。
 */
export interface RawEventSource {
  subscribe(listener: (event: RawGatewayEvent) => void): EventSubscription;
}

export interface EventPort {
  /** 订阅**已收窄**的规则事件增量。 */
  subscribe(listener: (event: RuleEventProjection) => void): EventSubscription;
}

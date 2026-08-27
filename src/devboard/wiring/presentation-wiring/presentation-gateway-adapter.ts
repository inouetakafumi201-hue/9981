/**
 * PresentationGatewayAdapter —— 表现层接线专项 B 阶段交付。
 *
 * 职责：把 `LoadedMatch.engine.gateway`（src/core/kernel/gateway.ts 的 PresentationGateway，
 * 整合层已构造为唯一只读出口）派发的 `after:*` 语义事件，翻译为 `PresentationRuntime` 期望的
 * `GameplayEvent` 形状并喂入。
 *
 * 不责任：
 * - 不修改 `LoadedMatch` / `PresentationGateway` / `PresentationRuntime` 中任何既有实现
 * - 不替代 `wire-hooks.ts` 的 `dispatchAfter` 路径（那是规则管道；本 adapter 是对外广播）
 * - 不持 `OpRegistry` / `WorldStateHolder` 等写通道（表现层只读契约）
 *
 * 写锁：本文件在 `.kiro/specs/wakeup-presentation-wiring/design.md` §组件和接口 6
 * `PresentationGateway` 写锁区 `src/devboard/wiring/presentation-wiring/**` 内。
 */

import type { PresentationGateway, GatewaySubscription } from '../../../core/kernel/gateway'
import type { Value } from '../../../core/kernel/state/value'
import type { PresentationRuntime } from '../../../ui/presentation/spatial/presentation-runtime'
import type { GameplayEvent, EntityPlacePayload, EntityMovePayload, RuleSettledPayload } from '../../../ui/presentation/spatial/choreography/event-bridge'
// `PresentationRuntime.feed(event)` 接受 `GameplayEvent`（由 event-bridge.ts 声明）；

// `PresentationRuntime` 的 GameplayEvent type 由 presentation-runtime.ts re-export
// `event-bridge` 内的 `GameplayEvent`；两者是同一类型，此处取其一避免 import 循环。

export interface PresentationGatewayAdapterDeps {
  /** 整合层暴露的 PresentationGateway（LoadedMatch.engine.gateway） */
  readonly gateway: Pick<PresentationGateway, 'subscribe'>
  /** 表现层表现运行时（src/ui/presentation/spatial/presentation-runtime.ts） */
  readonly runtime: Pick<PresentationRuntime, 'feed'>
  /** 当前世界状态获取（用于读取 revision 上下文；不持写通道） */
  readonly getRevision?: () => number
}

export interface PresentationGatewayAdapter {
  /** 启动：从 `gateway.subscribe('*', ...)` 接管所有 after 事件；返回取消函数 */
  start(): () => void
  /** 是否已启动 */
  isStarted(): boolean
  /** 翻译器：把 (type, payload) 转 GameplayEvent；暴露给测试做单点验证 */
  toGameplayEvent(type: string, payload: Record<string, Value>, revision: number): GameplayEvent | null
}

// 表现层 `GameplayEvent` 已知 type 集合（与 event-bridge.ts 同步；新增 type 时同步更新）
const KNOWN_TYPES = new Set([
  'after:entity.place',
  'after:entity.move',
  'after:rule-settled',
])

/**
 * 已知 type 的 `payload: Record<string, Value>` 形状对 `GameplayEvent` 强类型 payload 的最佳努力转换。
 *
 * - `after:entity.place` 的 payload 期望字段：entityId (string), nodeId? (string),
 *   microScene? (object), previousNodeId? (string)。Value 联合类型无 `object`，但 kernel 的
 *   `argsToPayload` 直接把 args 强转 `Record<string, Value>`，因此 microScene 字段实际以
 *   `{ hostNodeId: string, existingMicroSceneId?: string, microSceneDefId: string }` 形状出现
 *   在 wire 上（Value 联合未严格校验此形状；属于既有 `wire-hooks.ts:argsToPayload` 行为）。
 * - 字段缺失或类型不符 → 抛 `TypeError` 让上层 catch（gateway 已经吞 handler 异常，事件静默丢弃）。
 */
function toEntityPlacePayload(payload: Record<string, Value>): EntityPlacePayload {
  const entityId = payload['entityId']
  if (typeof entityId !== 'string') {
    throw new TypeError('after:entity.place payload.entityId must be string')
  }
  const nodeId = payload['nodeId']
  const previousNodeId = payload['previousNodeId']
  const microSceneRaw = payload['microScene']
  let microScene: { hostNodeId: string; existingMicroSceneId?: string; microSceneDefId: string } | undefined
  if (microSceneRaw !== null && typeof microSceneRaw === 'object' && !Array.isArray(microSceneRaw)) {
    const ms = microSceneRaw as Record<string, unknown>
    const hostNodeId = ms['hostNodeId']
    const existingMicroSceneId = ms['existingMicroSceneId']
    const microSceneDefId = ms['microSceneDefId']
    if (typeof hostNodeId === 'string' && typeof microSceneDefId === 'string') {
      microScene = {
        hostNodeId,
        ...(typeof existingMicroSceneId === 'string' ? { existingMicroSceneId } : {}),
        microSceneDefId,
      }
    }
  }
  return {
    entityId,
    ...(typeof nodeId === 'string' ? { nodeId } : {}),
    ...(microScene ? { microScene } : {}),
    ...(typeof previousNodeId === 'string' ? { previousNodeId } : {}),
  }
}

function toEntityMovePayload(payload: Record<string, Value>): EntityMovePayload {
  const entityId = payload['entityId']
  const toNodeId = payload['toNodeId']
  if (typeof entityId !== 'string' || typeof toNodeId !== 'string') {
    throw new TypeError('after:entity.move payload must contain entityId and toNodeId (both string)')
  }
  return { entityId, toNodeId }
}

function toRuleSettledPayload(payload: Record<string, Value>): RuleSettledPayload {
  const reason = payload['reason']
  return { reason: typeof reason === 'string' ? reason : '' }
}

export function createPresentationGatewayAdapter(deps: PresentationGatewayAdapterDeps): PresentationGatewayAdapter {
  let subscription: GatewaySubscription | null = null
  let started = false

  const toGameplayEvent = (
    type: string,
    payload: Record<string, Value>,
    revision: number,
  ): GameplayEvent | null => {
    if (!KNOWN_TYPES.has(type)) return null
    try {
      switch (type) {
        case 'after:entity.place':
          return {
            type: 'after:entity.place',
            payload: toEntityPlacePayload(payload),
            revision,
          }
        case 'after:entity.move':
          return {
            type: 'after:entity.move',
            payload: toEntityMovePayload(payload),
            revision,
          }
        case 'after:rule-settled':
          return {
            type: 'after:rule-settled',
            payload: toRuleSettledPayload(payload),
            revision,
          }
        default:
          return null
      }
    } catch {
      // 字段缺失或类型不符；adapter 不写日志，由 gateway.handler 的 try/catch 吞掉
      return null
    }
  }

  return {
    start() {
      if (started) {
        return () => {
          // 二次启动返回 idempotent 注销
          subscription?.unsubscribe()
          subscription = null
          started = false
        }
      }
      started = true
      // gateway.subscribe('*', ...) 接所有事件；adapter 内部按 type 过滤
      subscription = deps.gateway.subscribe('*', (type, payload) => {
        const revision = deps.getRevision ? deps.getRevision() : 0
        const event = toGameplayEvent(type, payload, revision)
        if (event) {
          deps.runtime.feed(event)
        }
      })
      return () => {
        subscription?.unsubscribe()
        subscription = null
        started = false
      }
    },
    isStarted() {
      return started
    },
    toGameplayEvent,
  }
}

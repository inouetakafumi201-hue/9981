/**
 * SpatialEntityStore — P1: 表现层实体空间位置记录（无状态，纯推导）。
 *
 * 源：entity.place after-event 的 payload。
 * 消费者：spatial-projection-builder 读此表计算实体世界坐标，进而派生出 cluster / footprint。
 *
 * 职责（与 spec R2/R3 对齐）：
 * - 记录 entity → nodeId（拓扑位置）的映射
 * - 支持投影构建器查询当前全部实体的空间坐标
 * - 不承担规则逻辑，只做投影数据管道
 *
 * 边界：
 * - 不得引用 kernel 内部类型（Id、Draft、WorldState）
 * - 不得直接订阅 kernel hooks
 */

import type { Disposable } from '../disposable'

export interface SpatialEntityRecord {
  readonly entityId: string
  readonly nodeId: string
  readonly revision: number
}

export interface SpatialEntitySnapshot {
  readonly revision: number
  readonly records: readonly SpatialEntityRecord[]
}

/**
 * 实体空间位置查询表。
 * 由 event-bridge 在每个 after:entity.place 之后更新。
 * 投影构建器通过 current() 读取当前快照。
 *
 * R9: 实现 Disposable，dispose() 后所有写操作是 no-op。
 */
export class SpatialEntityStore implements Disposable {
  private byEntity = new Map<string, SpatialEntityRecord>()
  private currentRevision = 0
  private listeners = new Set<(s: SpatialEntitySnapshot) => void>()
  private _disposed = false

  readonly debugName = 'SpatialEntityStore'

  /** event-bridge 调用：推进实体位置 */
  update(args: { entityId: string; nodeId: string }, revision: number): void {
    if (this._disposed || revision <= this.currentRevision) return
    this.byEntity.set(args.entityId, { entityId: args.entityId, nodeId: args.nodeId, revision })
    this.currentRevision = revision
    this.emit()
  }

  /** event-bridge 调用：从 WorldState 批量初始化 */
  replayAll(entities: readonly { entityId: string; nodeId: string }[], revision: number): void {
    if (this._disposed) return
    this.byEntity.clear()
    for (const e of entities) {
      if (e.nodeId && e.entityId) {
        this.byEntity.set(e.entityId, { entityId: e.entityId, nodeId: e.nodeId, revision })
      }
    }
    this.currentRevision = revision
    this.emit()
  }

  /** 返回某实体当前 nodeId */
  getNode(entityId: string): string | undefined {
    return this.byEntity.get(entityId)?.nodeId
  }

  /** 返回当前快照（深冻结） */
  current(): SpatialEntitySnapshot {
    return Object.freeze({
      revision: this.currentRevision,
      records: Object.freeze([...this.byEntity.values()]),
    })
  }

  subscribe(handler: (s: SpatialEntitySnapshot) => void): () => void {
    this.listeners.add(handler)
    handler(this.current())
    return () => { this.listeners.delete(handler) }
  }

  private emit(): void {
    if (this._disposed) return
    const snap = this.current()
    for (const l of this.listeners) l(snap)
  }

  dispose(): void {
    this._disposed = true
    this.byEntity.clear()
    this.listeners.clear()
    this.currentRevision = 0
  }
}

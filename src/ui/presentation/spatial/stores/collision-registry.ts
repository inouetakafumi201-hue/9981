import type { Vec2 } from '../../../../play/map/types'

export type Mobility = 'movable-character' | 'movable-entity' | 'immovable-character' | 'immovable-entity'

export interface CollisionBox {
  readonly entityId: string
  readonly center: Vec2
  readonly radius: number
  readonly mobility: Mobility
  readonly clusterId?: string
}

export class CollisionRegistry {
  private readonly boxes = new Map<string, CollisionBox>()

  register(box: CollisionBox): CollisionBox {
    const existing = this.boxes.get(box.entityId)
    if (existing) return existing
    this.boxes.set(box.entityId, box)
    return box
  }

  update(box: CollisionBox): boolean {
    if (!this.boxes.has(box.entityId)) return false
    this.boxes.set(box.entityId, box)
    return true
  }

  setMobility(entityId: string, mobility: Mobility): boolean {
    const current = this.boxes.get(entityId)
    if (!current) return false
    this.boxes.set(entityId, { ...current, mobility })
    return true
  }

  setCluster(entityId: string, clusterId: string | undefined): boolean {
    const current = this.boxes.get(entityId)
    if (!current) return false
    this.boxes.set(entityId, clusterId === undefined ? restWithout(current, 'clusterId') : { ...current, clusterId })
    return true
  }

  deregister(entityId: string): boolean {
    return this.boxes.delete(entityId)
  }

  get(entityId: string): CollisionBox | undefined {
    return this.boxes.get(entityId)
  }

  all(): readonly CollisionBox[] {
    return [...this.boxes.values()]
  }

  size(): number {
    return this.boxes.size
  }

  clear(): void {
    this.boxes.clear()
  }
}

function restWithout<T extends object, K extends keyof T>(value: T, _key: K): Omit<T, K> {
  const { ...rest } = value
  return rest
}

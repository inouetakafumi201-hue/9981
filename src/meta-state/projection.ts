import type { MetaStateProjection } from './types'

export function isFreshProjection(projection: MetaStateProjection, currentRevision: number): boolean {
  return projection.revision >= currentRevision
}

export function assertFrozenProjection(projection: MetaStateProjection): MetaStateProjection {
  if (!deepFrozen(projection)) throw new Error('META_PROJECTION_NOT_FROZEN')
  return projection
}

function deepFrozen(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true
  if (!Object.isFrozen(value)) return false
  return Object.values(value as Record<string, unknown>).every(deepFrozen)
}

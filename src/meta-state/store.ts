import type { MetaState, MetaStateProjection } from './types'
import { nextMetaRevision, type MetaRevision } from './revision'

export interface MetaStateStore {
  getState(): MetaStateProjection
  commit(next: MetaState, authority?: MetaStateProjection['authority']): MetaStateProjection
  subscribe(listener: () => void): () => void
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
  }
  return value
}

function project(state: MetaState, revision: MetaRevision, authority: MetaStateProjection['authority']): MetaStateProjection {
  return freeze({
    ...state,
    revision: revision.sequence,
    authority,
    identities: { ...state.identities },
    materials: { ...state.materials },
    tokens: { ...state.tokens },
    blueprints: { ...state.blueprints },
    quickBar: { ...state.quickBar, materialSlots: [...state.quickBar.materialSlots] },
    moldingBar: { ...state.moldingBar, unlocked: [...state.moldingBar.unlocked], contents: [...state.moldingBar.contents] },
    synthesisQueue: state.synthesisQueue.map((job) => ({ ...job, tokens: [...job.tokens] })),
  })
}

export function createMetaStateStore(initial: MetaState, authority: MetaStateProjection['authority'] = 'demo-fixture'): MetaStateStore {
  let state = initial
  let revision: MetaRevision = Object.freeze({ sequence: 0, fingerprint: 'meta:0' })
  let projection = project(state, revision, authority)
  const listeners = new Set<() => void>()
  return {
    getState: () => projection,
    commit(next, nextAuthority = authority) {
      state = next
      revision = nextMetaRevision(revision)
      projection = project(state, revision, nextAuthority)
      listeners.forEach((listener) => listener())
      return projection
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

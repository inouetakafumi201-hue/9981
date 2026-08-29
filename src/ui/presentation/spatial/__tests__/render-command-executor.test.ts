import { describe, expect, it } from 'vitest'
import { RenderCommandExecutor } from '../commands/render-command-executor'
import { SpatialProjectionStore } from '../stores/projection-store'
import type { RenderCommand } from '../render-command-api'

const cmd = (overrides: Partial<RenderCommand> = {}): RenderCommand => ({
  commandId: 'c1',
  semanticId: 'test',
  sourceRevision: 1,
  trigger: 'after-event',
  advancesJourney: false,
  payload: {},
  ...overrides,
})

describe('RenderCommandExecutor (R5, R13)', () => {
  it('returns stale when the projection is missing', () => {
    const store = new SpatialProjectionStore()
    const exec = new RenderCommandExecutor(store)
    expect(exec.submit(cmd())).toBe('stale')
  })

  it('returns stale when the source revision is older', () => {
    const store = new SpatialProjectionStore()
    store.commit({ revision: 5, layers: [], nodes: [], edges: [], entities: [], clusters: [], tiles: [] })
    const exec = new RenderCommandExecutor(store)
    expect(exec.submit(cmd({ sourceRevision: 3 }))).toBe('stale')
  })

  it('accepts a fresh command', () => {
    const store = new SpatialProjectionStore()
    store.commit({ revision: 5, layers: [], nodes: [], edges: [], entities: [], clusters: [], tiles: [] })
    const exec = new RenderCommandExecutor(store)
    expect(exec.submit(cmd({ sourceRevision: 5 }))).toBe('accepted')
    expect(exec.activeSize()).toBe(1)
  })

  it('removes the command on terminal outcome', () => {
    const store = new SpatialProjectionStore()
    store.commit({ revision: 5, layers: [], nodes: [], edges: [], entities: [], clusters: [], tiles: [] })
    const exec = new RenderCommandExecutor(store)
    exec.submit(cmd({ sourceRevision: 5 }))
    exec.resolve('c1', 'completed')
    expect(exec.activeSize()).toBe(0)
  })

  it('cancels and removes a command', () => {
    const store = new SpatialProjectionStore()
    store.commit({ revision: 5, layers: [], nodes: [], edges: [], entities: [], clusters: [], tiles: [] })
    const exec = new RenderCommandExecutor(store)
    exec.submit(cmd({ sourceRevision: 5 }))
    exec.cancel('c1')
    expect(exec.activeSize()).toBe(0)
  })

  it('ignores terminal outcomes on a cancelled command', () => {
    const store = new SpatialProjectionStore()
    store.commit({ revision: 5, layers: [], nodes: [], edges: [], entities: [], clusters: [], tiles: [] })
    const exec = new RenderCommandExecutor(store)
    exec.submit(cmd({ sourceRevision: 5 }))
    exec.cancel('c1')
    exec.resolve('c1', 'completed')
    expect(exec.activeSize()).toBe(0)
  })

  it('cancels all on dispose', () => {
    const store = new SpatialProjectionStore()
    store.commit({ revision: 5, layers: [], nodes: [], edges: [], entities: [], clusters: [], tiles: [] })
    const exec = new RenderCommandExecutor(store)
    exec.submit(cmd({ sourceRevision: 5, commandId: 'a' }))
    exec.submit(cmd({ sourceRevision: 5, commandId: 'b' }))
    exec.cancelAll()
    expect(exec.activeSize()).toBe(0)
  })
})

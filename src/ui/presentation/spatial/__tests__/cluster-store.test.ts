import { describe, expect, it } from 'vitest'
import { ClusterStore } from '../stores/cluster-store'

describe('ClusterStore (R2)', () => {
  it('creates a cluster only when occupants are non-empty', () => {
    const cs = new ClusterStore()
    cs.apply({ type: 'created', microSceneId: 'm1', center: { x: 0, y: 0 }, entityIds: [], revision: 1 })
    expect(cs.get('m1')).toBeUndefined()

    cs.apply({ type: 'created', microSceneId: 'm1', center: { x: 0, y: 0 }, entityIds: ['e1'], revision: 2 })
    const c = cs.get('m1')
    expect(c).toBeDefined()
    expect(c?.visibility).toBe('active')
  })

  it('transitions to fading when occupants drop to zero', () => {
    const cs = new ClusterStore({ fadeMs: 5 })
    cs.apply({ type: 'created', microSceneId: 'm1', center: { x: 0, y: 0 }, entityIds: ['e1'], revision: 1 })
    cs.apply({ type: 'occupants-changed', microSceneId: 'm1', entityIds: [], revision: 2 })
    expect(cs.get('m1')?.visibility).toBe('fading')
  })

  it('removes the cluster after fade completes', async () => {
    const cs = new ClusterStore({ fadeMs: 5 })
    cs.apply({ type: 'created', microSceneId: 'm1', center: { x: 0, y: 0 }, entityIds: ['e1'], revision: 1 })
    cs.apply({ type: 'occupants-changed', microSceneId: 'm1', entityIds: [], revision: 2 })
    await new Promise((r) => setTimeout(r, 20))
    expect(cs.get('m1')).toBeUndefined()
  })

  it('treats destroyed as idempotent', async () => {
    const cs = new ClusterStore({ fadeMs: 5 })
    cs.apply({ type: 'created', microSceneId: 'm1', center: { x: 0, y: 0 }, entityIds: ['e1'], revision: 1 })
    cs.apply({ type: 'destroyed', microSceneId: 'm1', revision: 2 })
    cs.apply({ type: 'destroyed', microSceneId: 'm1', revision: 3 })
    await new Promise((r) => setTimeout(r, 20))
    expect(cs.get('m1')).toBeUndefined()
  })

  it('drops stale events older than the current revision', () => {
    const cs = new ClusterStore()
    cs.apply({ type: 'created', microSceneId: 'm1', center: { x: 0, y: 0 }, entityIds: ['e1'], revision: 5 })
    cs.apply({ type: 'occupants-changed', microSceneId: 'm1', entityIds: ['e1', 'e2'], revision: 3 })
    expect(cs.get('m1')?.entityIds).toEqual(['e1'])
  })

  it('does not create a cluster from proximity', () => {
    const cs = new ClusterStore()
    cs.apply({ type: 'created', microSceneId: 'a', center: { x: 0, y: 0 }, entityIds: ['e1'], revision: 1 })
    cs.apply({ type: 'created', microSceneId: 'b', center: { x: 1, y: 0 }, entityIds: ['e2'], revision: 2 })
    expect(cs.all().length).toBe(2)
    expect(cs.all().map((c) => c.clusterId).sort()).toEqual(['a', 'b'])
  })
})

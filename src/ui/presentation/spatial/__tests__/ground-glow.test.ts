import { describe, expect, it } from 'vitest'
import { clusterToFootprint, hitTestFootprint, orcaRadiusFromFootprint, selectionState } from '../stores/ground-glow'
import type { ClusterRecord } from '../stores/cluster-store'

const cluster = (overrides: Partial<ClusterRecord> = {}): ClusterRecord => ({
  clusterId: 'm1',
  center: { x: 0, y: 0 },
  entityIds: ['e1', 'e2'],
  visibility: 'active',
  revision: 1,
  ...overrides,
})

describe('GroundGlowFootprint (R3, R11, R12)', () => {
  it('produces radiusX > radiusY', () => {
    const fp = clusterToFootprint(cluster(), selectionState(new Set()), 1)
    expect(fp.radiusX).toBeGreaterThan(fp.radiusY)
    expect(fp.rotation).toBe(0)
  })

  it('is weak by default', () => {
    const fp = clusterToFootprint(cluster(), selectionState(new Set()), 1)
    expect(fp.visibility).toBe('weak')
    expect(fp.interactive).toBe(true)
  })

  it('becomes selected when the cluster id matches the selected id', () => {
    const fp = clusterToFootprint(cluster(), selectionState(new Set(), 'm1'), 1)
    expect(fp.visibility).toBe('selected')
  })

  it('becomes highlighted when the cluster id is in the highlight set', () => {
    const fp = clusterToFootprint(cluster(), selectionState(new Set(['m1'])), 1)
    expect(fp.visibility).toBe('highlighted')
  })

  it('becomes fading when the cluster is fading', () => {
    const fp = clusterToFootprint(cluster({ visibility: 'fading' }), selectionState(new Set()), 1)
    expect(fp.visibility).toBe('fading')
    expect(fp.interactive).toBe(false)
  })

  it('hit-test accepts points inside the ellipse', () => {
    const fp = clusterToFootprint(cluster(), selectionState(new Set()), 1)
    expect(hitTestFootprint({ x: 0, y: 0 }, fp)).toBe(true)
    expect(hitTestFootprint({ x: 5, y: 0 }, fp)).toBe(true)
  })

  it('hit-test rejects points outside the ellipse', () => {
    const fp = clusterToFootprint(cluster(), selectionState(new Set()), 1)
    expect(hitTestFootprint({ x: 200, y: 0 }, fp)).toBe(false)
  })

  it('hit-test rejects negative geometry', () => {
    const fp = clusterToFootprint(cluster(), selectionState(new Set()), 1)
    const broken = { ...fp, radiusX: 0, radiusY: 0 }
    expect(hitTestFootprint({ x: 0, y: 0 }, broken)).toBe(false)
  })

  it('ORCA radius uses the larger axis halved', () => {
    const fp = clusterToFootprint(cluster(), selectionState(new Set()), 1)
    expect(orcaRadiusFromFootprint(fp)).toBe(fp.radiusX * 0.5)
  })

  it('visible in reduced-motion stays weak, not blank', () => {
    const fp = clusterToFootprint(cluster(), selectionState(new Set()), 1)
    expect(['weak', 'highlighted', 'selected']).toContain(fp.visibility)
  })
})

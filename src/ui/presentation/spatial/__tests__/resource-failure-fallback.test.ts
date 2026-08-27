import { describe, expect, it, vi } from 'vitest'
import { ResourceFailureFallback } from '../fallback/resource-failure-fallback'

describe('ResourceFailureFallback (R10)', () => {
  it('provides a placeholder when an asset fails to load', () => {
    const f = new ResourceFailureFallback()
    const result = f.getPlaceholder('sprite:missing')
    expect(result.type).toBe('placeholder')
    expect(result.id).toBe('sprite:missing')
  })

  it('provides a thin outline for a missing GroundGlowFootprint asset', () => {
    const f = new ResourceFailureFallback()
    const result = f.getGroundGlowFallback('glow:missing')
    expect(result.outlineOnly).toBe(true)
  })

  it('records the asset failure in diagnostics', () => {
    const f = new ResourceFailureFallback()
    const diagnostic = vi.fn()
    f.onDiagnostic(diagnostic)
    f.getPlaceholder('sprite:fail')
    expect(diagnostic).toHaveBeenCalledTimes(1)
    expect(diagnostic.mock.calls[0]?.[0].assetId).toBe('sprite:fail')
  })

  it('does not block interaction on the failed asset', () => {
    const f = new ResourceFailureFallback()
    const result = f.getPlaceholder('sprite:missing')
    expect(result.interactable).toBe(true)
  })

  it('returns distinct placeholders per asset id', () => {
    const f = new ResourceFailureFallback()
    const a = f.getPlaceholder('a')
    const b = f.getPlaceholder('b')
    expect(a.id).not.toBe(b.id)
  })
})

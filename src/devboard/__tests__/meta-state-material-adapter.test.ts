import { describe, expect, it } from 'vitest'
import { MATERIALS } from '../editor-shell/lib/materials'
import { canonicalMaterialId, canonicalizeMaterialId, legacyMaterialId, materialIdentityById } from '../editor-shell/lib/material-adapter'

describe('material adapter', () => {
  it('round-trips legacy editor IDs through canonical IDs', () => {
    const material = MATERIALS[0]!
    const canonical = canonicalMaterialId(material)
    expect(canonicalizeMaterialId(material.id)).toBe(canonical)
    expect(legacyMaterialId(canonical)).toBe(material.id)
    expect(materialIdentityById(canonical)?.id).toBe(canonical)
  })

  it('does not invent an identity for unknown IDs', () => {
    expect(canonicalizeMaterialId('missing-material')).toBeUndefined()
    expect(materialIdentityById('missing-material')).toBeUndefined()
  })
})

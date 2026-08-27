import { describe, expect, it } from 'vitest'
import { validateAssetRef } from '../asset-ref'
import { validateActorBinding, type CharacterEntityBinding } from '../actor-binding'

describe('MetaState identity boundaries', () => {
  it('requires a real asset manifest and valid checksum', () => {
    expect(validateAssetRef({ manifestId: '', view: 'item-front' })).toContain('EMPTY_MANIFEST')
    expect(validateAssetRef({ manifestId: 'asset:item', view: 'item-front', checksum: { algorithm: 'sha256', value: 'bad' } })).toContain('INVALID_CHECKSUM')
  })

  it.each([
    ['player', undefined],
    ['ai-player', 'policy:default'],
    ['npc', 'behavior:guard'],
    ['unbound', undefined],
  ] as const)('keeps %s separate from visual material identity', (kind, controllerRef) => {
    const binding: CharacterEntityBinding = {
      characterId: `character:${kind}`,
      displayName: kind,
      runtimeProfileRef: 'profile:character',
      runtimeEntityRef: { kind: 'character', id: `entity:${kind}` },
      actorBinding: { kind, ...(controllerRef === undefined ? {} : { controllerRef }) },
    }
    expect(validateActorBinding(binding)).toEqual([])
  })
})

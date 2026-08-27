import type { AssetRef } from './types'

export type AssetRefError = 'EMPTY_MANIFEST' | 'INVALID_VIEW' | 'INVALID_CHECKSUM'

export function validateAssetRef(ref: AssetRef): readonly AssetRefError[] {
  const errors: AssetRefError[] = []
  if (!ref.manifestId.trim()) errors.push('EMPTY_MANIFEST')
  if (ref.checksum && (ref.checksum.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/i.test(ref.checksum.value))) errors.push('INVALID_CHECKSUM')
  return Object.freeze(errors)
}

export function assetRefForView(manifestId: string, view: AssetRef['view'], entryId?: string): AssetRef {
  return Object.freeze({ manifestId, view, ...(entryId === undefined ? {} : { entryId }) })
}

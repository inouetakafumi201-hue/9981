import type { MetaStateProjection } from '../types'

export type MetaActionResult =
  | { readonly kind: 'accepted'; readonly committedRevision: number; readonly projection: MetaStateProjection }
  | { readonly kind: 'rejected'; readonly code: string; readonly message: string; readonly projection: MetaStateProjection }
  | { readonly kind: 'stale'; readonly code: 'STALE_PROJECTION'; readonly message: string; readonly projection: MetaStateProjection }
  | { readonly kind: 'pending'; readonly code: 'PENDING_CONVERGENCE'; readonly message: string; readonly projection: MetaStateProjection }

export function rejected(projection: MetaStateProjection, code: string, message: string): MetaActionResult {
  return { kind: 'rejected', code, message, projection }
}

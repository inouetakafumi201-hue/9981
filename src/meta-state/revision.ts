export interface MetaRevision {
  readonly sequence: number
  readonly fingerprint: string
}

export function nextMetaRevision(previous: MetaRevision): MetaRevision {
  return Object.freeze({ sequence: previous.sequence + 1, fingerprint: `meta:${previous.sequence + 1}` })
}

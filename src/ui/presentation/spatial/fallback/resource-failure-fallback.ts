export type PlaceholderType = 'placeholder' | 'texture-missing' | 'audio-missing'

export interface Placeholder {
  readonly type: PlaceholderType
  readonly id: string
  readonly outlineOnly?: boolean
  readonly interactable: boolean
}

export function getPlaceholder(assetId: string): Placeholder {
  return { type: 'placeholder', id: assetId, interactable: true }
}

export function getGroundGlowFallback(footprintId: string): Placeholder {
  return { type: 'placeholder', id: footprintId, outlineOnly: true, interactable: true }
}

export class ResourceFailureFallback {
  private readonly diagnostics: ((d: { assetId: string; error: string }) => void)[] = []

  onDiagnostic(handler: (d: { assetId: string; error: string }) => void): void {
    this.diagnostics.push(handler)
  }

  getPlaceholder(assetId: string): Placeholder {
    this.report(assetId, 'missing')
    return getPlaceholder(assetId)
  }

  getGroundGlowFallback(footprintId: string): Placeholder {
    this.report(footprintId, 'missing-outline')
    return getGroundGlowFallback(footprintId)
  }

  private report(assetId: string, error: string): void {
    for (const h of this.diagnostics) h({ assetId, error })
  }
}

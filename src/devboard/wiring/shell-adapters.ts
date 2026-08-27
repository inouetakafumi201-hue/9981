import {
  mockAssetAdapter,
  mockStorageAdapter,
  mockTransportAdapter,
  type ShellAssetAdapter,
  type ShellStorageAdapter,
  type ShellTransportAdapter,
} from '../game-ui-shell-15/lib/shell-adapters'

export interface WiringAdapters {
  readonly asset: ShellAssetAdapter
  readonly transport: ShellTransportAdapter
  readonly storage: ShellStorageAdapter
}

/**
 * The wiring layer owns composition, while the shell keeps its visual adapter
 * contracts. Replacing a mock host later changes this factory, not components.
 */
export function createWiringAdapters(overrides: Partial<WiringAdapters> = {}): WiringAdapters {
  return Object.freeze({
    asset: overrides.asset ?? mockAssetAdapter,
    transport: overrides.transport ?? mockTransportAdapter,
    storage: overrides.storage ?? mockStorageAdapter,
  })
}

export const mockWiringAdapters = createWiringAdapters()

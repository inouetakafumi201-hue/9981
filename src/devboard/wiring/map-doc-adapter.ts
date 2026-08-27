import type { CanonicalMapData } from '../ports/map-contracts'
import {
  canonicalToEditorDoc,
  editorDocToCanonical,
} from '../editor-shell/lib/map-bridge'
import type { MapDoc } from '../editor-shell/lib/map-types'

/**
 * One boundary for the editor's rich document and the published map contract.
 * The bridge converts shapes only; validation remains owned by map-contracts.
 */
export interface MapDocAdapter {
  canonicalToDoc(canonical: CanonicalMapData): MapDoc
  docToCanonical(doc: MapDoc): CanonicalMapData
}

export const mapDocAdapter: MapDocAdapter = Object.freeze({
  canonicalToDoc: canonicalToEditorDoc,
  docToCanonical: editorDocToCanonical,
})

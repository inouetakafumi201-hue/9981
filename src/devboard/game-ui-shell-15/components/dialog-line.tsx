'use client'

import { DialogPortrait } from './dialog-portrait'

/**
 * V0-01 / V0-04 — `dialog-line` is the product page. The old
 * `dialog-portrait` workbench remains in the catalog as heritage only.
 *
 * This wrapper exists so the product page has its own stable pageId and its own
 * mock-boundary + asset declaration, instead of the page contract being an
 * alias for a development surface.
 */
export function DialogLine({ connected = false, onComplete }: { connected?: boolean; onComplete?: () => void }) {
  return (
    <div className="dl-page">
      <DialogPortrait connected={connected} onComplete={onComplete} />
    </div>
  )
}

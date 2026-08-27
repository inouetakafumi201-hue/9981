'use client'

import { BattleHud } from './battle-hud'
import type { VariantId } from '@/lib/shell-catalog'

const VARIANT_TO_HUD: Record<VariantId, 'Default' | 'Compact' | 'Cinematic'> = {
  default: 'Default', compact: 'Compact', cinematic: 'Cinematic',
}

/**
 * V0-01 / V0-06 / V0-08 — `hud-main` is the product HUD page.
 *
 * It wraps the existing BattleHud with the three things the page contract owes
 * an integrator: an explicit mock-projection boundary, the honest state of the
 * A-201 / A-202 assets it is *supposed* to use, and the motion sources it
 * declares (selection vs trigger kept apart).
 *
 * Burst tier +3 is a deferred, visually-reserved slot: it is disabled with a
 * readable reason and never selectable.
 */
export function HudMain({ variant = 'default' }: { variant?: VariantId }) {
  return (
    <div className="hm-page">
      <div className="hm-hud-slot">
        <BattleHud variant={VARIANT_TO_HUD[variant]} />
      </div>

    </div>
  )
}

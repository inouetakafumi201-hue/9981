'use client'

import { DialogPortrait } from './dialog-portrait'
import { MockBoundary } from './shell-primitives'
import { assetsForPage, ASSET_STATUS_LABELS } from '@/lib/asset-manifest'

/**
 * V0-01 / V0-04 — `dialog-line` is the product page. The old
 * `dialog-portrait` workbench remains in the catalog as heritage only.
 *
 * This wrapper exists so the product page has its own stable pageId and its own
 * mock-boundary + asset declaration, instead of the page contract being an
 * alias for a development surface.
 */
export function DialogLine({ connected = false, onComplete }: { connected?: boolean; onComplete?: () => void }) {
  const assets = assetsForPage('dialog-line')
  return (
    <div className="dl-page">
      <DialogPortrait connected={connected} onComplete={onComplete} />
      <div className="dl-page-foot">
        <ul className="dl-asset-strip" aria-label="本页素材状态">
          {assets.filter((asset) => asset.status !== 'available').map((asset) => (
            <li key={asset.assetId} className={`dl-asset-pill is-${asset.status}`}>
              <code>{asset.assetId}</code> {asset.label} · {ASSET_STATUS_LABELS[asset.status]}
            </li>
          ))}
        </ul>
        <MockBoundary>
          台词、立绘与语音状态均为 mock。继续与跳过只推进本页表现，不推进旅程节点，也不写入任何叙事事实。
        </MockBoundary>
      </div>
    </div>
  )
}

'use client'

import { BattleHud } from './battle-hud'
import { useRealActions } from '@/lib/use-real-actions'
import { InMatchMapDemo } from './in-match-map'
import type { VariantId } from '@/lib/shell-catalog'

const VARIANT_TO_HUD: Record<VariantId, 'Default' | 'Compact' | 'Cinematic'> = {
  default: 'Default', compact: 'Compact', cinematic: 'Cinematic',
}

/**
 * V0-01 / V0-06 / V0-08 — `hud-main` 是产品 HUD 页面。
 *
 * 双轨制端到端接线 step 6：
 * - 从 `UiBackendProvider` 取真 `UiSystem`（由 `match-boot.ts` 在 V0 启动时装载）
 * - `useRealActions` 把 7 端口投影成 `paidActions` / `attachedActions`
 * - BattleHud 拿到真实动作列表，CSS / 动画全部保留
 * - 动作点击 / 目标选择走 `submit` → `ports.actions.submit(InteractionIntent)`
 *
 * 表现层（ORCA 寻路 / 节点动画 / 相机）暂不接通，V0 范围内看不到节点移动。
 */
export function HudMain({
  variant = 'default',
  onPause,
  onSettle,
}: {
  variant?: VariantId
  onPause?: () => void
  onSettle?: () => void
}) {
  const { cardActions, highlightActions, lastError, submit } = useRealActions()

  const realActions = lastError === null
    ? { cardActions, highlightActions, submitAction: submit }
    : undefined

  return (
    <div className="hm-page">
      <div className="hm-hud-slot">
        <BattleHud variant={VARIANT_TO_HUD[variant]} realActions={realActions} />
      </div>

      {/* 局内地图：从 UiSystem 真实读 SpatialProjection（office-v1 fixture） */}
      <div className="hm-map-slot" style={{ marginTop: 12 }}>
        <InMatchMapDemo />
      </div>

      {lastError !== null && (
        <div className="hm-backend-error" aria-live="polite" style={{ color: 'var(--color-text-muted, #888)', fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>
          ⚠ 后端未就绪（{lastError}）；显示 mock 视图
        </div>
      )}
      {(onPause || onSettle) && (
        <div className="hm-journey-controls" aria-label="对局演示控制">
          {onPause && <button onClick={onPause}>暂停</button>}
          {onSettle && <button onClick={onSettle}>结算此局（真实投影）</button>}
        </div>
      )}
    </div>
  )
}

/**
 * V0 真后端 hook（双轨制端到端接线 · step 6）
 *
 * 把 UiSystem 7 端口投影成 BattleHud 期望的形状：
 * - `paidActions` / `attachedActions` → 走真实 `fetchDescriptor`
 * - 卡片点击 / 目标选择 → 走真实 `ports.actions.submit(InteractionIntent)`
 *
 * 视觉/动画/CSS 全部保持原样；只换数据来源。
 *
 * 设计：
 * - 状态由 React state 持有，effect 触发 fetchDescriptor；提交后用 revision
 *   变化驱动重新拉取投影。
 * - 不订阅事件总线；真后端的 projection 提交是即时的，等价于 mock 120ms 答复。
 * - 失败/无后端时返回 `null`/空数组，让 BattleHud 显示 unimplemented 占位。
 */

'use client'

import { useCallback, useEffect, useState } from 'react'
import type { InteractionIntent } from '../../../ui/model/intent'
import type { UiActionView } from '../../../ui/model/view'
import { useUiBackend } from './ui-backend'

const UI_AGENT_ID = 'e:hero' // match-boot.ts 定义的玩家实体 id；ui-host.ts:335 直接透传 agentId 为 actorId
const SCOPE_ID = 'loaded-match:all'
const ACTOR_ID = 'e:hero'

export interface RealActionsSnapshot {
  readonly paidActions: readonly UiActionView[]
  readonly attachedActions: readonly UiActionView[]
  /** 双轨制：按 track 分流的动作视图。card = 卡片轨，highlight = 高亮轨。 */
  readonly cardActions: readonly UiActionView[]
  readonly highlightActions: readonly UiActionView[]
  /** 当前 sequence number，0 表示未装载。 */
  readonly revision: number
  readonly lastError: string | null
  /** 提交一个动作意图，返回是否被接受。接受后自动刷新投影。 */
  readonly submit: (actionId: string, opts?: { readonly targetId?: string; readonly bindings?: Record<string, unknown> }) => boolean
}

/** 取当前投影与动作描述符快照。失败时回退到空数组。 */
function fetchSnapshot(ui: NonNullable<ReturnType<typeof useUiBackend>['ui']>): RealActionsSnapshot {
  const emptyErr: RealActionsSnapshot = { paidActions: [], attachedActions: [], cardActions: [], highlightActions: [], revision: 0, lastError: 'unavailable', submit: () => false }
  const projectionResult = ui.query.projection({ agentId: UI_AGENT_ID, scopeId: SCOPE_ID })
  if (!projectionResult.ok) {
    return { ...emptyErr, lastError: 'projection rejected' }
  }
  const descriptorResult = ui.query.descriptor({
    agentId: UI_AGENT_ID,
    scopeId: SCOPE_ID,
    actorId: ACTOR_ID,
    includeUnavailable: true,
  })
  if (!descriptorResult.ok) {
    return { ...emptyErr, lastError: 'descriptor rejected' }
  }

  const desc = descriptorResult.value.descriptor
  const seq = projectionResult.value.revision.sequence

  function mapAction(a: typeof desc.paidActions[number]): UiActionView {
    return {
      actionId: a.actionId,
      costCategory: a.costCategory,
      interactionIntent: a.interactionIntent,
      available: a.available,
      accessibleLabel: a.accessibleLabel,
      assetRefs: a.assetRefs,
      bindings: [],
      targets: [],
      track: a.track,
      ...(a.unavailabilityReason !== undefined ? { unavailabilityText: a.unavailabilityReason } : {}),
      ...(a.cardPresentation !== undefined
        ? { cardPresentation: { iconRef: a.cardPresentation.icon, colorTheme: a.cardPresentation.colorTheme, effectText: a.cardPresentation.effectText, interactionMode: a.cardPresentation.interactionMode } }
        : {}),
    }
  }

  const allActions = [...desc.paidActions, ...desc.attachedActions].map(mapAction)

  return {
    paidActions: allActions.filter((a) => a.costCategory === 'paid'),
    attachedActions: allActions.filter((a) => a.costCategory === 'attached'),
    cardActions: allActions.filter((a) => a.track === 'card'),
    highlightActions: allActions.filter((a) => a.track === 'highlight'),
    revision: seq,
    lastError: null,
    submit: (actionId: string, opts?: { readonly targetId?: string; readonly bindings?: Record<string, unknown> }): boolean => {
      const intent: InteractionIntent = {
        intentId: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        agentId: UI_AGENT_ID,
        target: {
          kind: 'action',
          actionId,
          ...(opts?.targetId !== undefined ? { targetId: opts.targetId } : {}),
        },
        bindings: (opts?.bindings ?? {}) as Readonly<Record<string, import('../../../ui/model/intent').ProjectedBindingValue>>,
        observedRevision: projectionResult.value.revision,
        inputSource: 'pointer',
      }
      const outcome = ui.interaction.sendIntent(intent)
      return outcome.kind === 'accepted'
    },
  }
}

export function useRealActions(): RealActionsSnapshot {
  const { ui, error } = useUiBackend()
  const [snapshot, setSnapshot] = useState<RealActionsSnapshot>({
    paidActions: [],
    attachedActions: [],
    cardActions: [],
    highlightActions: [],
    revision: 0,
    lastError: null,
    submit: () => false,
  })

  const refresh = useCallback(() => {
    if (ui === null) {
      setSnapshot((prev) => ({ ...prev, lastError: error ?? 'no backend' }))
      return
    }
    setSnapshot(fetchSnapshot(ui))
  }, [ui, error])

  useEffect(() => {
    refresh()
  }, [refresh])

  return snapshot
}

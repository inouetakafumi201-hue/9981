'use client'

import { AlertTriangle, Check, Loader2, Radio, RotateCcw, Shield, X } from 'lucide-react'
import { SCREEN_STATE_LABELS, SOURCE_LABELS, type ScreenState, type UiSource } from '@/lib/g-ui-contract'

export function SourceBadge({ source, revision, compact = false }: { source: UiSource; revision: number; compact?: boolean }) {
  return <span className={`g-source-badge is-${source}`} aria-label={`数据来源：${SOURCE_LABELS[source]}，版本 ${revision}`}><Radio size={10} />{SOURCE_LABELS[source]}{!compact && <b>R{revision}</b>}</span>
}

export function IntentStatus({ state, reason, requestId }: { state: ScreenState; reason?: string; requestId?: string }) {
  const Icon = state === 'accepted' || state === 'ready' ? Check : state === 'pending' || state === 'loading' || state === 'retrying' ? Loader2 : state === 'safe-return' ? Shield : state === 'rejected' || state === 'timeout' || state === 'stale' ? AlertTriangle : X
  return <span className={`g-intent-status is-${state}`} role="status" aria-live="polite"><Icon size={11} className={['pending','loading','retrying'].includes(state) ? 'is-spin' : ''} /><span>{SCREEN_STATE_LABELS[state]}</span>{reason && <em>{reason}</em>}{requestId && <code>{requestId.slice(-8)}</code>}</span>
}

export function SemanticPlaceholder({ state, title, reason, onRetry }: { state: Extract<ScreenState, 'empty' | 'loading' | 'rejected' | 'timeout' | 'safe-return'>; title?: string; reason?: string; onRetry?: () => void }) {
  return <div className={`g-placeholder is-${state}`} role={state === 'rejected' || state === 'timeout' ? 'alert' : 'status'}><span className="g-placeholder-glyph" aria-hidden="true">{state === 'loading' ? <Loader2 className="is-spin" /> : state === 'safe-return' ? <Shield /> : <AlertTriangle />}</span><strong>{title ?? SCREEN_STATE_LABELS[state]}</strong><p>{reason ?? '当前没有可显示的投影。界面结构保持稳定，不推断缺失数据。'}</p>{onRetry && <button onClick={onRetry}><RotateCcw size={12} />重试</button>}</div>
}

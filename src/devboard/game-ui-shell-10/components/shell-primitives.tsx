'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Ban, Check, CircleSlash, Image as ImageIcon, Info, Layers, Loader2, RotateCcw, Shield, Type, X } from 'lucide-react'
import { ASSET_KIND_LABELS, ASSET_STATUS_LABELS, getAsset, isRenderable, type AssetKind } from '@/lib/asset-manifest'
import { SHELL_STATE_LABELS, type ShellStateId } from '@/lib/shell-catalog'
import { OUTCOME_LABELS, type ShellIntentState } from '@/lib/shell-intent'
import { FAILURE_DIAGNOSTICS, FAILURE_LABELS, type JourneyFailureId } from '@/lib/journey-nodes'

/* ------------------------------------------------------------------ */
/* V0-06 — AssetSlot                                                   */
/* ------------------------------------------------------------------ */

const KIND_GLYPH: Record<AssetKind, typeof ImageIcon> = {
  portrait: ImageIcon, background: Layers, 'sprite-sheet': Layers,
  'ui-frame': Layers, 'text-prompt': Type, reference: Info,
}

/**
 * Renders a registered asset, or — when it is pending / missing / failed —
 * keeps the exact same semantic position and says so. It never substitutes a
 * different asset and never silently shows a generic placeholder.
 */
export function AssetSlot({
  assetId,
  className,
  alt,
  forceFailure = false,
  children,
}: {
  assetId: string
  className?: string
  alt?: string
  /** Drive the load-failure branch from the control panel. */
  forceFailure?: boolean
  /** Optional in-slot content used when the asset resolves to a fallback. */
  children?: React.ReactNode
}) {
  const asset = getAsset(assetId)
  const [loadFailed, setLoadFailed] = useState(false)
  const failed = forceFailure || loadFailed
  const usable = isRenderable(asset) && !failed

  if (!asset) {
    return (
      <div className={`sh-asset sh-asset-unregistered ${className ?? ''}`} role="img" aria-label={`未登记素材：${assetId}`}>
        <CircleSlash size={18} />
        <b>未登记素材</b>
        <small>{assetId} 不在素材清单内。壳层不会为它猜测替代内容。</small>
      </div>
    )
  }

  if (usable && asset.src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={`sh-asset-image ${className ?? ''}`}
        src={asset.src}
        alt={alt ?? asset.label}
        draggable={false}
        onError={() => setLoadFailed(true)}
      />
    )
  }

  const Glyph = KIND_GLYPH[asset.fallback.kind]
  const state = failed ? 'load-failed' : asset.status
  return (
    <div
      className={`sh-asset sh-asset-${state} sh-asset-kind-${asset.fallback.kind} ${className ?? ''}`}
      role="img"
      aria-label={`${asset.fallback.label}（${ASSET_KIND_LABELS[asset.fallback.kind]}语义槽位，素材状态：${failed ? '载入失败' : ASSET_STATUS_LABELS[asset.status]}）`}
    >
      <span className="sh-asset-glyph" aria-hidden="true"><Glyph size={17} /></span>
      <b>{asset.fallback.label}</b>
      <code>{asset.assetId} · {failed ? '载入失败' : ASSET_STATUS_LABELS[asset.status]}</code>
      <small>{failed ? '素材已登记但载入失败。位置与语义保留，不用其他素材顶替。' : asset.fallback.note}</small>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* V0-05 — intent feedback strip                                       */
/* ------------------------------------------------------------------ */

/**
 * The only place an intent result is presented. Failures always offer a retry
 * and a safe return; nothing here ever advances on its own.
 */
export function IntentFeedback({
  state,
  onRetry,
  onCancel,
  onSafeReturn,
  compact = false,
}: {
  state: ShellIntentState
  onRetry?: () => void
  onCancel?: () => void
  onSafeReturn?: () => void
  compact?: boolean
}) {
  if (state.phase === 'idle') return null
  const failure = state.phase === 'rejected' || state.phase === 'stale' || state.phase === 'timeout'
  const Icon = state.phase === 'pending' ? Loader2 : state.phase === 'accepted' ? Check : state.phase === 'cancelled' ? Ban : AlertTriangle
  return (
    <div
      className={`sh-intent sh-intent-${state.phase} ${compact ? 'is-compact' : ''}`}
      role={failure ? 'alert' : 'status'}
      aria-live={failure ? 'assertive' : 'polite'}
    >
      <Icon size={13} className={state.phase === 'pending' ? 'is-spin' : ''} />
      <span className="sh-intent-main">
        <b>{OUTCOME_LABELS[state.phase]}</b>
        <small>{state.message}</small>
      </span>
      {state.intentId && (
        <code className="sh-intent-code">
          {state.intentId}{typeof state.revision === 'number' ? ` · rev ${state.revision}` : ''}{state.reasonCode ? ` · ${state.reasonCode}` : ''}
        </code>
      )}
      <span className="sh-intent-actions">
        {state.phase === 'pending' && onCancel && <button onClick={onCancel}><X size={11} />取消</button>}
        {failure && onRetry && <button onClick={onRetry}><RotateCcw size={11} />重试</button>}
        {failure && onSafeReturn && <button onClick={onSafeReturn}><Shield size={11} />安全返回</button>}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* V0-04 / V0-09 — page state frame                                    */
/* ------------------------------------------------------------------ */

const STATE_COPY: Partial<Record<ShellStateId, { title: string; body: string }>> = {
  loading: { title: '正在载入投影', body: '界面结构已保留。载入期间不显示推断数据。' },
  empty: { title: '投影为空', body: '宿主返回了空投影。结构保持稳定，壳层不填充占位内容。' },
  error: { title: '投影不可用', body: '这个页面无法取得可用投影。原状态未被修改，可以重试或安全返回。' },
  timeout: { title: '请求超时', body: '没有在期限内收到确认。当前页面与出发位置保持不变。' },
  retrying: { title: '正在重试', body: '已用新的 requestId 重新提交。期间显示的是最后一次已确认的投影。' },
  cancelled: { title: '已取消', body: '请求已取消，没有产生任何变更。焦点已回到发起控件。' },
  'safe-return': { title: '安全返回', body: '已回到明确的安全落点。没有任何事实被写入。' },
  unimplemented: { title: '尚未实现', body: '这个页面在本版本没有实现。壳层选择明确显示未实现，而不是用近似界面冒充。' },
}

/**
 * Wraps every catalog surface. When `state` is anything other than `ready`,
 * the frame renders the honest state instead of the surface — so no page can
 * hide a failure behind its happy path.
 */
export function PageStateFrame({
  pageId,
  state,
  failure,
  mockBoundary,
  onRetry,
  onSafeReturn,
  children,
}: {
  pageId: string
  state: ShellStateId
  failure?: JourneyFailureId | null
  mockBoundary?: string
  onRetry?: () => void
  onSafeReturn?: () => void
  children: React.ReactNode
}) {
  const copy = useMemo(() => STATE_COPY[state], [state])
  if (state === 'ready' || !copy) return <>{children}</>
  const isFailure = state === 'error' || state === 'timeout' || state === 'unimplemented'
  return (
    <section className={`sh-state sh-state-${state}`} role={isFailure ? 'alert' : 'status'} aria-live={isFailure ? 'assertive' : 'polite'}>
      <div className="sh-state-frame" aria-hidden="true" />
      <span className="sh-state-glyph" aria-hidden="true">
        {state === 'loading' || state === 'retrying' ? <Loader2 className="is-spin" size={26} />
          : state === 'safe-return' ? <Shield size={26} />
          : state === 'cancelled' ? <Ban size={26} />
          : state === 'empty' ? <CircleSlash size={26} />
          : <AlertTriangle size={26} />}
      </span>
      <span className="sh-state-kicker">{pageId} · {SHELL_STATE_LABELS[state]}</span>
      <h2>{copy.title}</h2>
      <p>{copy.body}</p>
      {failure && (
        <div className="sh-state-diagnostic">
          <b>{FAILURE_LABELS[failure]}</b>
          <span>{FAILURE_DIAGNOSTICS[failure]}</span>
        </div>
      )}
      {mockBoundary && <p className="sh-state-mock"><span className="mock-tag">MOCK</span> {mockBoundary}</p>}
      {(onRetry || onSafeReturn) && (
        <div className="sh-state-actions">
          {onRetry && <button className="is-primary" onClick={onRetry} autoFocus><RotateCcw size={13} />重试</button>}
          {onSafeReturn && <button onClick={onSafeReturn}><Shield size={13} />安全返回</button>}
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Small shared bits                                                   */
/* ------------------------------------------------------------------ */

/** Every disabled control gets a readable reason, never a bare grey button. */
export function DisabledHint({ children }: { children: React.ReactNode }) {
  return <span className="sh-disabled-hint"><Info size={11} />{children}</span>
}

export function MockBoundary({ children }: { children: React.ReactNode }) {
  return (
    <p className="sh-mock-boundary">
      <span className="mock-tag">MOCK 边界</span> {children}
    </p>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CheckCircle2,
  Loader2,
  PlugZap,
  RefreshCw,
  ShieldQuestion,
  Timer,
  Unplug,
  WifiOff,
  X,
} from 'lucide-react'
import { createIntent, submitIntent, type IntentStatus } from '@/lib/b1-contract'
import { playSfx } from '@/lib/audio-slot'

/**
 * B4-05 — ConnectionErrorRetryOverlay.
 *
 * A single blocking overlay that unifies connection-lost / reconnecting /
 * reconnected / reconnect-failed / match-timeout / safe-return. It reads a
 * mock ConnectionProjection (surface + reason + allowedIntents + retryable +
 * returnOrigin) and only ever *submits intents* — it never runs a real socket,
 * heartbeat or backoff, never lights a bed, never fakes a recovered projection.
 * Success is only shown once a projection/result confirms it; a local spinner
 * never stands in for "reconnected".
 */

type Surface =
  | 'connection-lost'
  | 'reconnecting'
  | 'reconnected'
  | 'reconnect-failed'
  | 'match-timeout'
  | 'safe-return'

interface ConnectionProjection {
  source: 'mock'
  surface: Surface
  reason: string
  allowedIntents: string[]
  retryable: boolean
  match?: { state: 'pending' | 'timeout' | 'cancelled'; targetBed: 'bed-a' | null }
  returnOrigin: { state: 'known' | 'missing'; pageId?: string }
  mock: true
}

const SURFACES: Record<Surface, ConnectionProjection> = {
  'connection-lost': {
    source: 'mock', surface: 'connection-lost', retryable: true,
    reason: '与深潜网络的锚定连接中断。正在等待重连指令。',
    allowedIntents: ['connection.retry', 'connection.cancel', 'connection.safe-return'],
    returnOrigin: { state: 'known', pageId: 'residence-main' }, mock: true,
  },
  reconnecting: {
    source: 'mock', surface: 'reconnecting', retryable: false,
    reason: '正在尝试重新建立连接，请稍候。可取消并安全返回。',
    allowedIntents: ['connection.cancel', 'connection.safe-return'],
    returnOrigin: { state: 'known', pageId: 'residence-main' }, mock: true,
  },
  reconnected: {
    source: 'mock', surface: 'reconnected', retryable: false,
    reason: '连接已由投影确认恢复。可关闭覆盖层并回到原画面。',
    allowedIntents: ['connection.dismiss-recovered'],
    returnOrigin: { state: 'known', pageId: 'residence-main' }, mock: true,
  },
  'reconnect-failed': {
    source: 'mock', surface: 'reconnect-failed', retryable: true,
    reason: '重连未成功——超过宿主提供的重试阈值。可再次重试或安全返回。',
    allowedIntents: ['connection.retry', 'connection.safe-return'],
    returnOrigin: { state: 'known', pageId: 'residence-main' }, mock: true,
  },
  'match-timeout': {
    source: 'mock', surface: 'match-timeout', retryable: true,
    reason: '匹配超时（mock）——未在时限内组齐编组。可重试匹配、取消或安全返回。',
    allowedIntents: ['match.retry', 'match.cancel', 'connection.safe-return'],
    match: { state: 'timeout', targetBed: null },
    returnOrigin: { state: 'known', pageId: 'residence-main' }, mock: true,
  },
  'safe-return': {
    source: 'mock', surface: 'safe-return', retryable: false,
    reason: '返回位置暂不可确认（mock）。请选择一个宿主提供的安全入口。',
    allowedIntents: ['connection.safe-return', 'connection.close-details'],
    returnOrigin: { state: 'missing' }, mock: true,
  },
}

const SURFACE_META: Record<Surface, { icon: typeof WifiOff; title: string; tone: string }> = {
  'connection-lost': { icon: Unplug, title: '连接中断', tone: 'red' },
  reconnecting: { icon: Loader2, title: '正在重连', tone: 'orange' },
  reconnected: { icon: CheckCircle2, title: '连接已恢复', tone: 'green' },
  'reconnect-failed': { icon: WifiOff, title: '重连失败', tone: 'red' },
  'match-timeout': { icon: Timer, title: '匹配超时', tone: 'orange' },
  'safe-return': { icon: ShieldQuestion, title: '安全返回', tone: 'yellow' },
}

const SWITCHER: { id: Surface; label: string }[] = [
  { id: 'connection-lost', label: '连接中断' },
  { id: 'reconnecting', label: '重连中' },
  { id: 'reconnected', label: '重连成功' },
  { id: 'reconnect-failed', label: '重连失败' },
  { id: 'match-timeout', label: '匹配超时' },
  { id: 'safe-return', label: '返回缺失' },
]

const STATUS_LABEL: Record<IntentStatus, string> = {
  accepted: '已接受',
  rejected: '被拒绝',
  stale: '版本过期',
  timeout: '请求超时',
  cancelled: '已取消',
}

export function ConnectionErrorOverlay() {
  const [surface, setSurface] = useState<Surface>('connection-lost')
  const [pending, setPending] = useState<string | null>(null)
  const [result, setResult] = useState<{ label: string; status: IntentStatus; reason?: string } | null>(null)
  const [live, setLive] = useState('')
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const proj = SURFACES[surface]
  const meta = SURFACE_META[surface]
  const Icon = meta.icon

  useEffect(() => {
    // Focus enters the blocking overlay whenever the surface changes.
    requestAnimationFrame(() => overlayRef.current?.focus())
    setResult(null)
    setLive(`${meta.title}：${proj.reason}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface])

  // Esc only cancels/closes when the projection allows it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (proj.allowedIntents.includes('connection.cancel')) { e.preventDefault(); run('connection.cancel', '取消') }
      else if (proj.allowedIntents.includes('connection.close-details')) { e.preventDefault(); run('connection.close-details', '关闭详情') }
      else if (proj.allowedIntents.includes('connection.dismiss-recovered')) { e.preventDefault(); run('connection.dismiss-recovered', '关闭') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface])

  const run = async (intentId: string, label: string, demoFailure?: 'rejected' | 'timeout') => {
    if (pending) return
    playSfx('ui-confirm')
    const intent = createIntent(intentId as never, { demoFailure }, proj.returnOrigin.pageId ?? 'menu-title')
    setPending(intentId)
    setResult(null)
    setLive(`${label}：请求已提交，等待投影确认……`)
    const res = await submitIntent(intent)
    setPending(null)
    setResult({ label, status: res.status, reason: res.reason })
    setLive(`${label}：${STATUS_LABEL[res.status]}${res.reason ? '，' + res.reason : ''}`)
    playSfx(res.status === 'accepted' ? 'ui-confirm' : 'toast-error')

    // Only advance the demo surface on a confirmed (accepted) result — never
    // on a local timer. This mirrors "success arrives from the projection."
    if (res.status === 'accepted') {
      if (intentId === 'connection.retry') setSurface('reconnecting')
      else if (intentId === 'connection.dismiss-recovered') setLive('覆盖层已关闭，焦点回到原画面（演示）')
      else if (intentId === 'connection.cancel' || intentId === 'connection.safe-return') setSurface('safe-return')
      else if (intentId === 'match.retry') setSurface('reconnecting')
    }
  }

  const can = (i: string) => proj.allowedIntents.includes(i)

  return (
    <div className="ce-stage">
      {/* mock underlying world kept visible under the scrim, not a white tech page */}
      <div className="ce-world" aria-hidden="true">
        <div className="ce-world-grid" />
        <div className="ce-world-core"><PlugZap size={26} strokeWidth={1} /><span>底层世界保持可见</span></div>
      </div>

      <div className="ce-switcher" role="group" aria-label="连接状态演示切换">
        {SWITCHER.map((s) => (
          <button
            key={s.id}
            className={`ce-switch-btn ${surface === s.id ? 'is-active' : ''}`}
            onClick={() => { setSurface(s.id); playSfx('ui-toggle') }}
            aria-pressed={surface === s.id}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Blocking overlay (z-70 language) with a desaturating scrim */}
      <div className={`ce-scrim ce-tone-${meta.tone}`} />
      <AnimatePresence mode="wait">
        <motion.div
          key={surface}
          ref={overlayRef}
          className={`ce-overlay ce-tone-${meta.tone}`}
          role="alertdialog"
          aria-modal="true"
          aria-label={`${meta.title}（MOCK）`}
          tabIndex={-1}
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, y: -6 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className={`ce-icon ${surface === 'reconnecting' ? 'is-spin' : ''}`}>
            <Icon size={26} />
          </span>

          <div className="ce-head">
            <span className="ce-kicker">
              连接反馈 <span className="mock-tag">MOCK</span>
            </span>
            <h3 className="ce-title">{meta.title}</h3>
          </div>

          <p className="ce-reason">{proj.reason}</p>

          {surface === 'reconnecting' && (
            <div className="ce-progress" role="status" aria-label="重连进行中">
              <span className="ce-progress-bar"><span className="ce-progress-fill" /></span>
              <span className="ce-progress-text">正在重连…（不以本地计时假定成功）</span>
            </div>
          )}

          {proj.match && (
            <div className="ce-match">
              <Timer size={13} /> 匹配状态：{proj.match.state} · 目标床：{proj.match.targetBed ?? '未点亮'}
            </div>
          )}

          <div className="ce-origin">
            {proj.returnOrigin.state === 'known' ? (
              <>返回位置：<strong>{proj.returnOrigin.pageId}</strong>（由投影确认）</>
            ) : (
              <span className="ce-origin-missing">返回位置暂不可确认（mock）——不静默落默认点</span>
            )}
          </div>

          <div className="ce-actions">
            {can('connection.retry') && (
              <button className="ce-btn is-primary" disabled={!!pending} onClick={() => run('connection.retry', '重试连接')}>
                <RefreshCw size={14} className={pending === 'connection.retry' ? 'is-spin' : ''} /> 重试连接
              </button>
            )}
            {can('match.retry') && (
              <button className="ce-btn is-primary" disabled={!!pending} onClick={() => run('match.retry', '重试匹配')}>
                <RefreshCw size={14} className={pending === 'match.retry' ? 'is-spin' : ''} /> 重试匹配
              </button>
            )}
            {can('match.cancel') && (
              <button className="ce-btn" disabled={!!pending} onClick={() => run('match.cancel', '取消匹配')}>
                取消匹配
              </button>
            )}
            {can('connection.cancel') && (
              <button className="ce-btn" disabled={!!pending} onClick={() => run('connection.cancel', '取消重连')}>
                取消
              </button>
            )}
            {can('connection.dismiss-recovered') && (
              <button className="ce-btn is-primary" disabled={!!pending} onClick={() => run('connection.dismiss-recovered', '关闭覆盖层')}>
                <CheckCircle2 size={14} /> 继续
              </button>
            )}
            {can('connection.safe-return') && (
              <button className="ce-btn is-safe" disabled={!!pending} onClick={() => run('connection.safe-return', '安全返回')}>
                安全返回{proj.returnOrigin.state === 'known' ? `（${proj.returnOrigin.pageId}）` : '（选择安全入口）'}
              </button>
            )}
            {can('connection.close-details') && (
              <button className="ce-btn" disabled={!!pending} onClick={() => run('connection.close-details', '关闭详情')}>
                <X size={13} /> 关闭详情
              </button>
            )}
          </div>

          {/* Result feedback — pending / accepted / rejected / timeout are
              distinct; a submitted request is never rendered as success. */}
          <div className="ce-feedback" aria-live="polite">
            {pending && (
              <span className="ce-fb ce-fb-pending">
                <Loader2 size={12} className="is-spin" /> 请求处理中：{pending}
              </span>
            )}
            {!pending && result && (
              <span className={`ce-fb ce-fb-${result.status}`}>
                {result.label} · {STATUS_LABEL[result.status]}
                {result.reason ? ` — ${result.reason}` : ''}
                {(result.status === 'rejected' || result.status === 'timeout') && can('connection.retry') && (
                  <button className="ce-fb-retry" onClick={() => run('connection.retry', '重试连接')}>重试</button>
                )}
              </span>
            )}
            {!pending && !result && proj.retryable && (
              <span className="ce-fb ce-fb-hint">此状态可重试 · 演示：投影确认后才推进</span>
            )}
          </div>

          {/* Demo-only: force a failure path so rejected/timeout can be shown */}
          {(can('connection.retry') || can('match.retry')) && (
            <div className="ce-demo-fail">
              <span>演示失败分支：</span>
              <button onClick={() => run(can('match.retry') ? 'match.retry' : 'connection.retry', '重试', 'rejected')} disabled={!!pending}>模拟被拒绝</button>
              <button onClick={() => run(can('match.retry') ? 'match.retry' : 'connection.retry', '重试', 'timeout')} disabled={!!pending}>模拟超时</button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="sr-only" aria-live="assertive">
        {live}
      </div>
    </div>
  )
}

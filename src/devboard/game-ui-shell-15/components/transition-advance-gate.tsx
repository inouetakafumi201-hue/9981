'use client'

/**
 * V0-11 — the affordance that replaces "the animation called onComplete".
 *
 * A ceremony reaching its final frame is a *presentation* fact. It unlocks
 * this control and nothing else. The control submits a transition through the
 * router; the page only changes if the adapter accepts it. Skip, asset
 * failure, reduced motion and timeout all land here identically — the button
 * appears, the journey has not moved.
 */

import { ArrowRight, Loader2, RotateCcw, ShieldAlert } from 'lucide-react'
import type { ShellRouteTransition } from '@/lib/shell-route'

export interface TransitionAdvanceGateProps {
  /** False while the ceremony is still playing. */
  settled: boolean
  label: string
  onAdvance: () => void
  /** The runner's record for this surface, so failure is readable in place. */
  transition?: ShellRouteTransition
  onRetry?: () => void
  onSafeReturn?: () => void
  /** Why the ceremony ended the way it did (skip / reduced-motion / failure). */
  settleReason?: string
}

const FAILED_STATES = new Set(['rejected', 'stale', 'timeout', 'cancelled'])

export function TransitionAdvanceGate({
  settled,
  label,
  onAdvance,
  transition,
  onRetry,
  onSafeReturn,
  settleReason,
}: TransitionAdvanceGateProps) {
  const pending = transition?.state === 'pending'
  const failed = transition ? FAILED_STATES.has(transition.state) : false

  return (
    <div className="tag-gate" data-settled={settled ? 'true' : 'false'}>
      <p className="tag-status" aria-live="polite">
        {settled ? (settleReason ?? '演出已到终态。转移需要显式确认。') : '演出进行中…（跳过只会落到终态）'}
      </p>

      {failed && transition && (
        <div className="tag-failure" role="alert">
          <ShieldAlert size={13} />
          <span>
            {transition.message ?? '转移未被确认。'}
            {transition.reasonCode ? ` · ${transition.reasonCode}` : ''}
          </span>
        </div>
      )}

      <div className="tag-actions">
        <button className="tag-advance" onClick={onAdvance} disabled={!settled || pending}>
          {pending ? <Loader2 size={14} className="tag-spin" /> : <ArrowRight size={14} />}
          {pending ? '等待宿主确认…' : label}
        </button>
        {failed && onRetry && (
          <button className="tag-secondary" onClick={onRetry}><RotateCcw size={12} /> 重试</button>
        )}
        {failed && onSafeReturn && (
          <button className="tag-secondary" onClick={onSafeReturn}>安全返回</button>
        )}
      </div>
    </div>
  )
}

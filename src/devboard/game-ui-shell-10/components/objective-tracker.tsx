'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, ChevronUp, Crosshair, Eye, EyeOff, Info, MapPin, Target } from 'lucide-react'
import { useShellIntent } from '@/lib/shell-intent'
import { OBJECTIVE_FIXTURES, PROGRESS_MAX_VISIBLE } from '@/lib/progress-fixtures'
import { DisabledHint, IntentFeedback, MockBoundary } from './shell-primitives'

/**
 * V0-04 — the world-anchored objective tracker as its own page.
 *
 * Previously it only existed inside the quest log, which meant it could never
 * be inspected on its own. It is read-only: collapsing / hiding are local
 * presentation, tracking a different objective is an intent.
 *
 * Explicitly NOT a map: anchors are text labels and relative descriptions.
 * There is no topology, no coordinates and no pathfinding.
 */
export function ObjectiveTracker() {
  const [collapsed, setCollapsed] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [trackedId, setTrackedId] = useState('o1')
  const { state, dispatch, retry, cancel, reset } = useShellIntent('objective-tracker')

  const objectives = OBJECTIVE_FIXTURES.slice(0, PROGRESS_MAX_VISIBLE)
  const tracked = objectives.find((item) => item.objectiveId === trackedId) ?? objectives[0]

  const track = async (objectiveId: string) => {
    const result = await dispatch('objective.track', objectiveId)
    // Only a confirmed projection changes what is tracked.
    if (result.outcome === 'accepted') setTrackedId(objectiveId)
  }

  return (
    <section className="ot-stage" aria-label="目标追踪器（只读）">
      <div className="ot-world" aria-hidden="true">
        <div className="ot-world-grid" />
        <div className="ot-world-anchor"><Crosshair size={20} /><span>{tracked.anchorLabel}</span></div>
      </div>

      <div className="ot-head">
        <span className="pg-kicker">WORLD ANCHOR <span className="mock-tag">MOCK</span></span>
        <h2>目标追踪器</h2>
        <p>锚定在世界上的只读目标列表。不是地图，不含拓扑与寻路。</p>
      </div>

      <AnimatePresence>
        {!hidden && (
          <motion.aside
            className={`ot-panel ${collapsed ? 'is-collapsed' : ''}`}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            aria-label="当前追踪目标"
          >
            <header className="ot-panel-head">
              <span><Target size={12} /> 追踪中</span>
              <div className="ot-panel-tools">
                <button onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed} aria-label={collapsed ? '展开追踪器' : '折叠追踪器'}>
                  {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                </button>
                <button onClick={() => setHidden(true)} aria-label="隐藏追踪器"><EyeOff size={13} /></button>
              </div>
            </header>

            {!collapsed && (
              <ul className="ot-list">
                {objectives.map((item) => {
                  const isTracked = item.objectiveId === tracked.objectiveId
                  const isBlocked = item.state === 'blocked'
                  return (
                    <li key={item.objectiveId} className={`ot-item is-${item.state} ${isTracked ? 'is-tracked' : ''}`}>
                      <button
                        className="ot-item-main"
                        onClick={() => track(item.objectiveId)}
                        disabled={isBlocked || state.phase === 'pending'}
                        aria-current={isTracked}
                        aria-label={`${item.label}${isTracked ? '（正在追踪）' : ''}`}
                      >
                        <span className="ot-item-state" aria-hidden="true">
                          {item.state === 'complete' ? '✓' : item.state === 'blocked' ? '—' : '›'}
                        </span>
                        <span className="ot-item-copy">
                          <b>{item.label}</b>
                          <small>{item.detail}</small>
                        </span>
                      </button>
                      <div className="ot-item-anchor">
                        <span><MapPin size={10} /> {item.anchorLabel}</span>
                        <span>{item.distanceLabel}</span>
                      </div>
                      {isBlocked && <DisabledHint>{item.blockedReason}</DisabledHint>}
                      {item.state === 'complete' && <span className="ot-item-note"><Info size={10} /> 已完成的目标保留在列表里，作为可读记录。</span>}
                    </li>
                  )
                })}
              </ul>
            )}

            <footer className="ot-panel-foot">
              <span>同屏 ≤5 项 · 只读投影</span>
              <code>tracked: {tracked.objectiveId}</code>
            </footer>
          </motion.aside>
        )}
      </AnimatePresence>

      {hidden && (
        <button className="ot-restore" onClick={() => setHidden(false)}>
          <Eye size={13} /> 重新显示追踪器
        </button>
      )}

      <div className="ot-foot">
        <IntentFeedback state={state} onRetry={retry} onCancel={cancel} onSafeReturn={reset} compact />
        <MockBoundary>目标、锚点与距离描述均为 mock 文本。切换追踪目标必须等宿主确认，本地点击不改变追踪事实。</MockBoundary>
      </div>
    </section>
  )
}

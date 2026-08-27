'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, LoaderCircle, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { createIntent, submitIntent } from '@/lib/b1-contract'

type StartupMode = 'cold-start' | 'restore-loading' | 'empty' | 'error' | 'asset-missing' | 'version-incompatible' | 'timeout' | 'ready'

export function StartupLoading({ onReady }: { onReady?: () => void }) {
  const [mode, setMode] = useState<StartupMode>('cold-start')
  const [busy, setBusy] = useState(false)
  const firstAction = useRef<HTMLButtonElement>(null)
  const announce = mode === 'cold-start' || mode === 'restore-loading' ? '系统正在检查启动投影，请稍候。' : `启动状态：${mode}`

  useEffect(() => {
    const timer = window.setTimeout(() => setMode('restore-loading'), 700)
    return () => window.clearTimeout(timer)
  }, [])
  useEffect(() => { if (mode !== 'cold-start' && mode !== 'restore-loading') firstAction.current?.focus() }, [mode])

  async function act(intentId: 'startup.retry' | 'startup.cancel' | 'startup.fallback') {
    setBusy(true)
    const result = await submitIntent(createIntent(intentId, { mode }, 'startup-loading'))
    setBusy(false)
    if (result.status === 'accepted') {
      if (intentId === 'startup.retry') setMode('restore-loading')
      else if (intentId === 'startup.fallback') { setMode('ready'); onReady?.() }
      else setMode('empty')
    } else setMode('timeout')
  }

  const terminal = mode !== 'cold-start' && mode !== 'restore-loading'
  return <section className="startup-surface" aria-labelledby="startup-title">
    <div className="startup-header"><span className="mock-tag">MOCK / REVISION 01</span><span>SAFE RETURN // /startup-loading</span></div>
    <div className="startup-core" aria-hidden="true"><ShieldCheck size={28} /><span>BOOT</span></div>
    <h1 id="startup-title">启动投影</h1>
    <p className="startup-status" role="status" aria-live="polite">{announce}</p>
    <div className="startup-stages" aria-label="启动阶段"><span className={mode !== 'cold-start' ? 'is-done' : 'is-active'}><Check size={12} />检查版本</span><span className={mode === 'restore-loading' ? 'is-active' : mode === 'cold-start' ? '' : 'is-done'}><Check size={12} />恢复投影</span><span className={mode === 'ready' ? 'is-done' : ''}><Check size={12} />挂载资源</span></div>
    {!terminal ? <div className="startup-loading"><LoaderCircle className="spin" size={22} /> {mode === 'cold-start' ? '冷启动准备中…' : '恢复投影加载中…'}</div> : <div className={`startup-message startup-${mode}`}><AlertTriangle size={20} /><span>{mode === 'empty' ? '没有可恢复的存档，将以安全默认值继续。' : mode === 'ready' ? '启动完成。资源挂载使用 mock fallback。' : mode === 'timeout' ? '请求超时，原 surface 未改变。' : '投影无法确认，仍可安全返回或继续 fallback。'}</span></div>}
    <div className="startup-actions">
      {terminal && mode !== 'ready' && <button ref={firstAction} onClick={() => act('startup.retry')} disabled={busy}><RotateCcw size={14} />重试</button>}
      {terminal && mode !== 'ready' && <button onClick={() => act('startup.fallback')} disabled={busy}><ShieldCheck size={14} />使用 fallback 继续</button>}
      {terminal && mode !== 'ready' && <button onClick={() => act('startup.cancel')} disabled={busy}><X size={14} />安全返回</button>}
      {mode === 'ready' && <button ref={firstAction} onClick={onReady}><Check size={14} />进入标题菜单</button>}
    </div>
    <small>STATUS IS A PROJECTION · NO EXTERNAL DATA · requestId generated on action</small>
  </section>
}

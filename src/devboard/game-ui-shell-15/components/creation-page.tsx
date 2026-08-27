'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Boxes, FlaskConical, Gauge, Map, X } from 'lucide-react'
import EditorPage from '@editor/app/page'
import { openLibrary } from '@editor/lib/library-store'
import { openBench } from '@editor/lib/bench-store'
import {
  completeCreationVisit,
  readCreationVisit,
  switchCreationHref,
  type CreationTool,
} from '@/lib/creation-navigation'

interface CreationPageProps { tool: CreationTool }

export function CreationPage({ tool }: CreationPageProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [panelOpen, setPanelOpen] = useState(false)
  const visit = readCreationVisit(tool, new URLSearchParams(searchParams.toString()))

  useEffect(() => {
    if (tool === 'asset-library') openLibrary()
    if (tool === 'research-bench') {
      openLibrary()
      openBench()
    }
  }, [tool])

  useEffect(() => {
    const onNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ tool: CreationTool }>).detail
      if (detail?.tool) router.push(switchCreationHref(detail.tool, visit))
    }
    const onExit = () => router.push(completeCreationVisit(visit))
    window.addEventListener('creation:navigate', onNavigate)
    window.addEventListener('creation:exit', onExit)
    return () => {
      window.removeEventListener('creation:navigate', onNavigate)
      window.removeEventListener('creation:exit', onExit)
    }
  }, [router, visit.entryId, visit.entryTool, visit.returnTo])

  const tools = [
    { id: 'map-editor' as const, label: '地图编辑器', icon: Map },
    { id: 'asset-library' as const, label: '素材库', icon: Boxes },
    { id: 'research-bench' as const, label: '研究台', icon: FlaskConical },
  ]

  return (
    <div className="creation-page-transition">
      <EditorPage />
      <button
        type="button"
        className="creation-panel-trigger"
        aria-expanded={panelOpen}
        aria-controls="creation-control-panel"
        onClick={() => setPanelOpen((open) => !open)}
      >
        <Gauge size={16} /><span>控制面板</span>
      </button>
      {panelOpen && (
        <aside id="creation-control-panel" className="creation-control-panel" aria-label="创作页面控制面板">
          <header>
            <div><span>CREATION SUITE</span><h2>页面切换</h2></div>
            <button type="button" onClick={() => setPanelOpen(false)} aria-label="关闭控制面板"><X size={17} /></button>
          </header>
          <nav aria-label="创作页面">
            {tools.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={id === tool ? 'is-active' : ''}
                aria-current={id === tool ? 'page' : undefined}
                onClick={() => {
                  if (id !== tool) router.push(switchCreationHref(id, visit))
                  setPanelOpen(false)
                }}
              >
                <Icon size={16} /><span>{label}</span><small>{id === visit.entryTool ? '初始入口' : `/${id}`}</small>
              </button>
            ))}
          </nav>
          <footer>
            <span>本次交互归因：{visit.entryTool}</span>
            <button type="button" onClick={() => router.push(completeCreationVisit(visit))}>退出并返回</button>
          </footer>
        </aside>
      )}
    </div>
  )
}

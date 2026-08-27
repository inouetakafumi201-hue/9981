'use client'

import { useEffect } from 'react'
import { playSfx } from '@editor/lib/sound'
import {
  useEditor,
  setMode,
  setCurrentLayerByIndex,
  undo,
  redo,
  deleteSelection,
  duplicateSelection,
  exportMap,
  clearSelection,
} from '@editor/lib/editor-store'
import type { Mode } from '@editor/lib/map-types'

function isTyping(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    (el as HTMLElement).isContentEditable
  )
}

const TOOL_KEYS: Record<string, Mode> = {
  v: 'select',
  n: 'place',
  e: 'edge',
  i: 'sample',
  p: 'playtest',
}

/** Global keyboard shortcuts — tool switching, undo/redo, delete, duplicate, export. */
export function KeyboardShortcuts() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTyping()) return
      const mod = e.ctrlKey || e.metaKey

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) {
          redo()
        } else {
          undo()
        }
        playSfx('toggle')
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        playSfx('toggle')
        return
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        exportMap()
        return
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        duplicateSelection()
        playSfx('click')
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelection()
        playSfx('warning')
        return
      }
      if (e.key === 'Escape') {
        clearSelection()
        setMode('select')
        return
      }

      const tool = TOOL_KEYS[e.key.toLowerCase()]
      if (tool && !mod) {
        e.preventDefault()
        setMode(tool)
        playSfx('click')
        return
      }

      // B4: 数字键 1/2/3 切图层。超出图层数量则钉在最后一个，而不是无反应
      // ——这样即便只有两层，按 3 也总能落在有效状态，不会造成"按键没用"的
      // 困惑感（clamp 逻辑在 setCurrentLayerByIndex 里）。
      if (!mod && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        setCurrentLayerByIndex(Number(e.key) - 1)
        playSfx('toggle')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return null
}

const TONE: Record<'info' | 'ok' | 'warn' | 'error', { border: string; text: string; bg: string }> = {
  info: { border: 'var(--border-strong)', text: 'text-foreground', bg: 'bg-panel/95' },
  ok: {
    border: 'color-mix(in srgb, var(--success) 45%, transparent)',
    text: 'text-success',
    bg: 'bg-success/10',
  },
  warn: {
    border: 'color-mix(in srgb, var(--warning) 50%, transparent)',
    text: 'text-warning',
    bg: 'bg-warning/10',
  },
  error: {
    border: 'color-mix(in srgb, var(--error) 50%, transparent)',
    text: 'text-error',
    bg: 'bg-error/10',
  },
}

/** Bottom-center transient toast, HUD-styled. */
export function ToastLayer() {
  const toast = useEditor((s) => s.toast)
  if (!toast) return null
  const tone = TONE[toast.tone] ?? TONE.info
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[999] -translate-x-1/2">
      <div
        key={toast.id}
        className={`hud-b chamfer toast-in flex items-center gap-2.5 px-4 py-2.5 ${tone.bg} hud-grain`}
        style={{ '--hud-bc': tone.border } as React.CSSProperties}
      >
        <span className={`h-1.5 w-1.5 rotate-45 ${toast.tone === 'error' ? 'bg-error' : toast.tone === 'warn' ? 'bg-warning' : toast.tone === 'ok' ? 'bg-success' : 'bg-primary'}`} />
        <span className={`text-[13px] font-semibold ${tone.text}`}>{toast.text}</span>
      </div>
    </div>
  )
}

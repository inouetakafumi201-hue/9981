'use client'

import { useState, useRef, useEffect } from 'react'
import {
  IconUndo,
  IconRedo,
  IconPlus,
  IconExport,
  IconSoundOn,
  IconSoundOff,
  IconImport,
} from './icons'
import { playSfx, useSfxMuted, toggleSfxMuted } from '@/lib/sound'
import {
  useEditor,
  undo,
  redo,
  canUndo,
  canRedo,
  exportMap,
  newBlankMap,
  setMapName,
  importMapJson,
  toast,
} from '@/lib/editor-store'

function BarButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  label?: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={() => {
        if (disabled) return
        playSfx('click')
        onClick?.()
      }}
      onMouseEnter={() => !disabled && playSfx('hover')}
      disabled={disabled}
      className={`hud-btn hud-b chamfer-sm chamfer group flex h-10 items-center gap-2 px-3.5 text-[13px] font-medium transition-opacity ${
        disabled
          ? 'cursor-not-allowed opacity-35'
          : 'text-foreground/85 hover:text-foreground'
      }`}
    >
      <span className="text-muted-foreground transition-colors group-hover:text-primary">
        {icon}
      </span>
      {label && <span>{label}</span>}
    </button>
  )
}

function SoundToggle() {
  const muted = useSfxMuted()
  return (
    <button
      onClick={() => {
        const next = toggleSfxMuted()
        if (!next) playSfx('toggle')
      }}
      onMouseEnter={() => playSfx('hover')}
      aria-label={muted ? '开启音效' : '关闭音效'}
      aria-pressed={!muted}
      className={`hud-btn hud-b chamfer-sm chamfer grid h-10 w-10 shrink-0 place-items-center transition-colors ${
        muted ? 'text-muted-foreground' : 'text-primary'
      }`}
    >
      {muted ? <IconSoundOff width={17} height={17} /> : <IconSoundOn width={17} height={17} />}
    </button>
  )
}

function MapNameEditor() {
  const name = useEditor((s) => s.doc.name)
  const id = useEditor((s) => s.doc.id)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  function commit() {
    setMapName(draft.trim() || '未命名地图')
    setEditing(false)
    playSfx('toggle')
  }

  return (
    <div className="hud-b chamfer absolute left-1/2 flex -translate-x-1/2 items-center gap-3 bg-panel-inset/60 px-5 py-1.5">
      <span className="soft-blink h-1.5 w-1.5 rotate-45 bg-primary shadow-[0_0_6px_var(--primary)]" />
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setDraft(name)
              setEditing(false)
            }
          }}
          className="w-40 bg-transparent text-center text-[15px] font-bold text-foreground focus:outline-none"
          aria-label="地图名称"
        />
      ) : (
        <button
          onClick={() => {
            setDraft(name)
            setEditing(true)
          }}
          onMouseEnter={() => playSfx('hover')}
          className="text-[15px] font-bold text-foreground transition-colors hover:text-primary"
          title="点击重命名"
        >
          {name}
        </button>
      )}
      <span className="h-4 w-px bg-border-strong" />
      <span className="font-mono text-xs tracking-wider text-muted-foreground">
        ID: {id.toUpperCase()}
      </span>
    </div>
  )
}

function ImportButton() {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <BarButton
        icon={<IconImport />}
        label="导入"
        onClick={() => inputRef.current?.click()}
      />
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (!file) return
          const text = await file.text()
          const ok = importMapJson(text)
          e.target.value = ''
          if (!ok) toast('导入的地图 JSON 无法解析', 'error')
          else toast('已导入地图', 'ok')
        }}
      />
    </>
  )
}

export function TopBar() {
  // subscribe to doc so undo/redo availability re-renders
  useEditor((s) => s.doc)
  const undoOk = canUndo()
  const redoOk = canRedo()

  return (
    <header className="hud-grain relative z-30 flex h-[68px] shrink-0 items-center justify-between border-b border-border-strong bg-panel/95 px-4 backdrop-blur">
      {/* left: brand */}
      <div className="flex items-center gap-3">
        <div className="chamfer relative grid h-11 w-11 place-items-center bg-gradient-to-br from-primary to-primary-dim shadow-[0_0_22px_-6px_var(--primary)]">
          <span className="font-mono text-2xl font-black leading-none text-primary-foreground">
            W
          </span>
          <span className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/20" />
        </div>
        <div className="leading-tight">
          <div className="text-[17px] font-bold tracking-wide text-foreground">
            WakeUp <span className="text-primary">筑梦台</span>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            Dream Scene Editor
          </div>
        </div>
      </div>

      {/* center: editable map name */}
      <MapNameEditor />

      {/* right: actions */}
      <div className="flex items-center gap-2">
        <SoundToggle />
        <div className="mx-1 h-6 w-px bg-border" />
        <BarButton icon={<IconUndo />} label="撤销" onClick={undo} disabled={!undoOk} />
        <BarButton icon={<IconRedo />} label="重做" onClick={redo} disabled={!redoOk} />
        <div className="mx-1 h-6 w-px bg-border" />
        <BarButton icon={<IconPlus />} label="新建" onClick={newBlankMap} />
        <ImportButton />
        <button
          onClick={() => {
            playSfx('success')
            exportMap()
          }}
          onMouseEnter={() => playSfx('hover')}
          className="hud-btn-primary chamfer group relative ml-1 flex h-10 items-center gap-2 overflow-hidden px-5 text-[13px] font-bold uppercase tracking-wider text-primary-foreground"
        >
          <span className="absolute inset-0 -translate-x-full bg-white/25 transition-transform duration-500 group-hover:translate-x-full" />
          校验并导出
          <IconExport width={16} height={16} />
        </button>
      </div>
    </header>
  )
}

'use client'

import { Paintbrush, Eraser, Pipette, Undo2, Redo2 } from 'lucide-react'
import { WeightedButton } from '@/components/fx/weighted-button'
import { playSfx } from '@/lib/sound'
import type { PainterTool } from '@/lib/painter-types'

/**
 * 左侧竖排工具栏（§4.2）：画笔/橡皮/取色器互斥选中（青描边高亮），
 * 撤销/重做独立于工具选择，随时可用。
 */
export function PainterToolbar({
  tool,
  onToolChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: {
  tool: PainterTool
  onToolChange: (t: PainterTool) => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
}) {
  return (
    <div className="chamfer hud-b lib-glass flex w-14 shrink-0 flex-col items-center gap-1.5 p-2" style={{ ['--hud-bc' as string]: 'var(--lib-line)' }}>
      <ToolButton label="画笔" active={tool === 'brush'} onClick={() => onToolChange('brush')}>
        <Paintbrush width={18} height={18} />
      </ToolButton>
      <ToolButton label="橡皮" active={tool === 'eraser'} onClick={() => onToolChange('eraser')}>
        <Eraser width={18} height={18} />
      </ToolButton>
      <ToolButton label="取色器" active={tool === 'eyedropper'} onClick={() => onToolChange('eyedropper')}>
        <Pipette width={18} height={18} />
      </ToolButton>

      <span className="my-1 h-px w-8 shrink-0" style={{ background: 'var(--lib-line)' }} />

      <ToolButton label="撤销 (Ctrl+Z)" active={false} disabled={!canUndo} onClick={onUndo}>
        <Undo2 width={18} height={18} />
      </ToolButton>
      <ToolButton label="重做 (Ctrl+Y)" active={false} disabled={!canRedo} onClick={onRedo}>
        <Redo2 width={18} height={18} />
      </ToolButton>
    </div>
  )
}

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <WeightedButton
      aria-pressed={active}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => {
        if (!disabled) playSfx('click')
        onClick()
      }}
      className="chamfer-sm hud-b grid h-9 w-9 place-items-center transition-colors"
      style={{
        ['--hud-bc' as string]: active ? 'var(--cyan)' : 'var(--lib-line)',
        color: active ? 'var(--cyan)' : 'var(--lib-dim)',
        background: active ? 'rgba(6,182,212,0.12)' : 'var(--lib-inset)',
        boxShadow: active ? '0 0 12px -4px var(--cyan)' : undefined,
      }}
    >
      {children}
    </WeightedButton>
  )
}

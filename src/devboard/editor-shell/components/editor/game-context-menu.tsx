'use client'

import { useEffect, useRef, useState } from 'react'
import {
  IconTrash,
  IconCopy,
  IconLink,
  IconLayers,
  IconEye,
  IconAnchor,
  IconSample,
} from './icons'
import { playSfx } from '@editor/lib/sound'
import { WORLD, nodeAnchor } from '@editor/lib/map-types'
import {
  getState,
  deleteSelection,
  duplicateSelection,
  sampleElement,
  flyTo,
  setCamera,
  updateEdge,
} from '@editor/lib/editor-store'

interface MenuAction {
  label: string
  icon: React.ReactNode
  danger?: boolean
  run: () => void
}

/**
 * HUD-styled replacement for the native right-click menu. The command set
 * is resolved from the live editor selection (set by the canvas on
 * right-click) so every item performs a real store action.
 */
export function GameContextMenu() {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [heading, setHeading] = useState('系统')
  const [items, setItems] = useState<MenuAction[]>([])
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function buildMenu(): { heading: string; items: MenuAction[] } {
      const { selection, doc } = getState()
      const sel = selection[0]

      if (!sel) {
        return {
          heading: '画布',
          items: [
            {
              label: '重置视图',
              icon: <IconAnchor width={14} height={14} />,
              run: () => setCamera({ x: 0, y: 0, w: WORLD.w, h: WORLD.h }),
            },
          ],
        }
      }

      if (sel.type === 'scene') {
        const scene = doc.sceneNodes.find((s) => s.id === sel.id)
        if (!scene) return { heading: '系统', items: [] }
        return {
          heading: `场景 · ${scene.name}`,
          items: [
            {
              label: '定位到此场景',
              icon: <IconEye width={14} height={14} />,
              run: () => {
                if (!scene) return
                const c = nodeAnchor(scene.id, doc)
                flyTo({ x: c.x - 500, y: c.y - 380, w: 1000, h: 760 })
              },
            },
            {
              label: '取样场景',
              icon: <IconSample width={14} height={14} />,
              run: () => sampleElement(sel),
            },
            {
              label: '复制场景',
              icon: <IconCopy width={14} height={14} />,
              run: () => duplicateSelection(),
            },
            {
              label: '删除场景',
              icon: <IconTrash width={14} height={14} />,
              danger: true,
              run: () => deleteSelection(),
            },
          ],
        }
      }

      if (sel.type === 'edge') {
        const edge = doc.edges.find((e) => e.id === sel.id)
        if (!edge) return { heading: '系统', items: [] }
        const firstPoint = edge.points[0]
        const lastPoint = edge.points[edge.points.length - 1]
        return {
          heading: '连接边',
          items: [
            {
              label: edge.directionality === 'bidirectional' ? '改为单向 →' : '改为双向 ↔',
              icon: <IconLink width={14} height={14} />,
              run: () =>
                updateEdge(edge.id, {
                  directionality:
                    edge.directionality === 'bidirectional' ? 'unidirectional' : 'bidirectional',
                }),
            },
            ...(firstPoint && lastPoint
              ? [{
                  label: '拍直连线',
                  icon: <IconLayers width={14} height={14} />,
                  run: () => updateEdge(edge.id, { points: [firstPoint, lastPoint] }),
                }]
              : []),
            {
              label: '删除连线',
              icon: <IconTrash width={14} height={14} />,
              danger: true,
              run: () => deleteSelection(),
            },
          ],
        }
      }

      // obstruction / terrain / placement
      return {
        heading:
          sel.type === 'obstruction' ? '遮挡框' : sel.type === 'terrain' ? '地形' : '素材',
        items: [
          {
            label: '取样',
            icon: <IconSample width={14} height={14} />,
            run: () => sampleElement(sel),
          },
          {
            label: '复制',
            icon: <IconCopy width={14} height={14} />,
            run: () => duplicateSelection(),
          },
          {
            label: '删除',
            icon: <IconTrash width={14} height={14} />,
            danger: true,
            run: () => deleteSelection(),
          },
        ],
      }
    }

    function onContextMenu(e: MouseEvent) {
      e.preventDefault()
      // allow the canvas onContextMenu to update selection first
      requestAnimationFrame(() => {
        const menu = buildMenu()
        const MENU_W = 216
        const MENU_H = 44 + menu.items.length * 34
        const x = Math.min(e.clientX, window.innerWidth - MENU_W - 8)
        const y = Math.min(e.clientY, window.innerHeight - MENU_H - 8)
        setHeading(menu.heading)
        setItems(menu.items)
        setPos({ x, y })
        setOpen(true)
        playSfx('select')
      })
    }

    function onDismiss(e: Event) {
      if (e.type === 'mousedown' && menuRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }

    window.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('mousedown', onDismiss)
    window.addEventListener('scroll', onDismiss, true)
    window.addEventListener('blur', onDismiss)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('mousedown', onDismiss)
      window.removeEventListener('scroll', onDismiss, true)
      window.removeEventListener('blur', onDismiss)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  if (!open) return null

  return (
    <div
      ref={menuRef}
      style={{ left: pos.x, top: pos.y }}
      className="game-ctx-menu chamfer hud-b hud-grain fixed z-[998] w-52 bg-panel/95 py-1.5"
    >
      <div className="flex items-center gap-2 px-3 pb-1.5 pt-1">
        <span className="h-2.5 w-[2px] shrink-0 bg-primary shadow-[0_0_6px_var(--primary)]" />
        <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {heading}
        </span>
      </div>
      <div className="mx-3 mb-1 h-px bg-border-strong" />
      <ul className="flex flex-col px-1.5">
        {items.map((item, i) => (
          <li key={i}>
            <button
              onClick={() => {
                playSfx(item.danger ? 'warning' : 'click')
                item.run()
                setOpen(false)
              }}
              onMouseEnter={() => playSfx('hover')}
              className={`chamfer-sm chamfer flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-[12.5px] transition-colors ${
                item.danger
                  ? 'text-error hover:bg-error/12'
                  : 'text-foreground/85 hover:bg-primary/10 hover:text-foreground'
              }`}
            >
              <span className={item.danger ? 'text-error' : 'text-primary/80'}>
                {item.icon}
              </span>
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

'use client'

import { useMemo, useRef, useState } from 'react'
import { ContextMenu } from '@base-ui/react/context-menu'
import { Sparkles, Trash2, Info, Package, Maximize2, MousePointerClick } from 'lucide-react'
import { playSfx } from '@/lib/audio-slot'
import { createIntent, submitIntent } from '@/lib/b1-contract'

type Rarity = 'common' | 'rare' | 'epic'

interface InvItem {
  id: string
  glyph: string
  name: string
  qty: number
  rarity: Rarity
}

const RARITY_LABEL: Record<Rarity, string> = { common: '普通', rare: '稀有', epic: '史诗' }

// 出生态：空手，只有 2 个装备位 + 2 个背包格；扩展态最多 6 槽。槽位数是
// 结构展示，不由 UI 计算拥有量或容量规则——扩展只揭示既有的第 5/6 槎位。
const BASE_CAPACITY = 4
const MAX_CAPACITY = 6
const EQUIP_SLOT_COUNT = 2

const SEED_ITEMS: (InvItem | null)[] = [
  null,
  null,
  { id: 'i1', glyph: '\u25C6', name: '锚定核心碎片', qty: 3, rarity: 'epic' },
  { id: 'i2', glyph: '\u25B2', name: '深潜信号剂', qty: 12, rarity: 'common' },
  { id: 'i3', glyph: '\u2726', name: '梦境残响瓶', qty: 1, rarity: 'rare' },
  { id: 'i5', glyph: '\u2735', name: '共鸣棱镜', qty: 2, rarity: 'rare' },
]

/**
 * Gallery page for the inventory grid: 4-slot base structure (2 equipment +
 * 2 pack) expandable to 6, drag-and-drop reordering, a keyboard equivalent
 * (select source -> select target -> Enter to confirm / Esc to cancel), and a
 * right-click context menu (Base UI ContextMenu) offering Use / Inspect /
 * Drop. Every swap and context action submits an explicit mock intent —
 * nothing mutates local ownership without a result.
 */
export function UtilityInventory() {
  const [expanded, setExpanded] = useState(false)
  const [items, setItems] = useState<(InvItem | null)[]>(SEED_ITEMS)
  const [inspecting, setInspecting] = useState<InvItem | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [flash, setFlash] = useState<{ index: number; kind: 'drop' | 'invalid' } | null>(null)
  const [kbSource, setKbSource] = useState<number | null>(null)
  const [liveMessage, setLiveMessage] = useState('物资仓投影已就绪（mock）')
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const capacity = expanded ? MAX_CAPACITY : BASE_CAPACITY
  const visibleSlots = items.slice(0, capacity)
  const filledCount = useMemo(() => visibleSlots.filter(Boolean).length, [visibleSlots])

  const triggerFlash = (index: number, kind: 'drop' | 'invalid') => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
    setFlash({ index, kind })
    flashTimer.current = setTimeout(() => setFlash(null), 320)
  }

  async function commitSwap(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return
    const result = await submitIntent(createIntent('inventory.swap-slots', { fromSlotId: `slot-${fromIndex}`, toSlotId: `slot-${toIndex}` }))
    if (result.status !== 'accepted') {
      triggerFlash(toIndex, 'invalid')
      setLiveMessage(`交换被拒绝：${result.reason ?? result.status}，已回到原槎位`)
      playSfx('item-invalid')
      return
    }
    setItems((prev) => {
      const next = [...prev]
      const dragged = next[fromIndex]
      next[fromIndex] = next[toIndex]
      next[toIndex] = dragged
      return next
    })
    playSfx('item-drop')
    triggerFlash(toIndex, 'drop')
    setLiveMessage(`已交换槎位 ${fromIndex + 1} 与 ${toIndex + 1}`)
  }

  const handleDrop = (targetIndex: number) => {
    if (dragIndex === null) { setDragOverIndex(null); return }
    void commitSwap(dragIndex, targetIndex)
    setDragOverIndex(null)
    setDragIndex(null)
  }

  // Keyboard / switch-input equivalent to drag-and-drop: Enter on an empty
  // selection sets the source; Enter again on a different slot confirms the
  // swap; Escape cancels the pending source.
  const handleSlotKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && kbSource !== null) {
      setKbSource(null)
      setLiveMessage('已取消选择来源槎位')
      return
    }
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    if (kbSource === null) {
      if (!visibleSlots[index]) return
      setKbSource(index)
      setLiveMessage(`已选择槎位 ${index + 1} 为来源，选择目标槎位后按 Enter 确认`)
      return
    }
    if (kbSource === index) { setKbSource(null); return }
    void commitSwap(kbSource, index)
    setKbSource(null)
  }

  async function handleUse(index: number) {
    const item = items[index]
    if (!item) return
    const result = await submitIntent(createIntent('inventory.context', { slotId: `slot-${index}`, action: 'use' }))
    if (result.status !== 'accepted') { setLiveMessage(`使用被拒绝：${result.reason ?? result.status}`); playSfx('item-invalid'); return }
    playSfx('item-action')
    setItems((prev) => {
      const next = [...prev]
      if (item.qty > 1) next[index] = { ...item, qty: item.qty - 1 }
      else next[index] = null
      return next
    })
    setLiveMessage(`已使用「${item.name}」`)
  }

  async function handleDiscard(index: number) {
    const item = items[index]
    if (!item) return
    const result = await submitIntent(createIntent('inventory.context', { slotId: `slot-${index}`, action: 'drop' }))
    if (result.status !== 'accepted') { setLiveMessage(`丢弃被拒绝：${result.reason ?? result.status}`); playSfx('item-invalid'); return }
    playSfx('item-invalid')
    setItems((prev) => { const next = [...prev]; next[index] = null; return next })
    setLiveMessage(`已丢弃「${item.name}」`)
  }

  async function handleInspect(index: number) {
    const item = items[index]
    if (!item) return
    await submitIntent(createIntent('inventory.context', { slotId: `slot-${index}`, action: 'inspect' }))
    setInspecting(item)
  }

  return (
    <div className="ui-inv-stage">
      <div className="ui-inv-header">
        <span className="ui-inv-kicker">物资仓</span>
        <span className="ui-inv-count">{filledCount} / {capacity}</span>
        <button className="ui-inv-expand-btn" onClick={() => setExpanded((v) => !v)}>
          <Maximize2 size={12} /> {expanded ? '收起为 4 槎' : '展开为 6 槎'}
        </button>
      </div>

      <div className="ui-inv-grid" data-capacity={capacity}>
        {visibleSlots.map((item, index) => {
          const isEquip = index < EQUIP_SLOT_COUNT
          return (
            <ContextMenu.Root key={index}>
              <ContextMenu.Trigger
                role="button"
                tabIndex={0}
                aria-label={item ? `${isEquip ? '装备位' : '背包位'} ${index + 1}：${item.name}` : `${isEquip ? '装备位' : '背包位'} ${index + 1}：空`}
                aria-describedby={!item ? `slot-empty-${index}` : undefined}
                className={`ui-inv-slot${item ? ' has-item' : ''}${isEquip ? ' is-equip' : ''}${dragOverIndex === index ? ' is-drag-over' : ''}${flash?.index === index ? ` is-flash-${flash.kind}` : ''}${kbSource === index ? ' is-kb-source' : ''}`}
                draggable={Boolean(item)}
                onKeyDown={(e) => handleSlotKeyDown(index, e)}
                onDragStart={() => setDragIndex(index)}
                onDragOver={(e) => { if (dragIndex === null) return; e.preventDefault(); setDragOverIndex(index) }}
                onDragLeave={() => setDragOverIndex((cur) => (cur === index ? null : cur))}
                onDrop={(e) => { e.preventDefault(); handleDrop(index) }}
                onDragEnd={() => { setDragIndex(null); setDragOverIndex(null) }}
                onClick={() => item && setInspecting(item)}
              >
                {item ? (
                  <>
                    <span className={`ui-inv-glyph ui-inv-rarity-${item.rarity}`}>{item.glyph}</span>
                    {item.qty > 1 && <span className="ui-inv-qty">{item.qty}</span>}
                  </>
                ) : (
                  <span className="ui-inv-slot-empty" id={`slot-empty-${index}`}>{isEquip ? '装备' : '空'}</span>
                )}
              </ContextMenu.Trigger>
              {item && (
                <ContextMenu.Portal>
                  <ContextMenu.Positioner className="ui-inv-menu-positioner" sideOffset={4}>
                    <ContextMenu.Popup className="ui-inv-menu-popup">
                      <ContextMenu.Item className="ui-inv-menu-item" onClick={() => void handleUse(index)}>
                        <Sparkles size={13} /> 使用
                      </ContextMenu.Item>
                      <ContextMenu.Item className="ui-inv-menu-item" onClick={() => void handleInspect(index)}>
                        <Info size={13} /> 查看
                      </ContextMenu.Item>
                      <ContextMenu.Item className="ui-inv-menu-item is-danger" onClick={() => void handleDiscard(index)}>
                        <Trash2 size={13} /> 丢弃
                      </ContextMenu.Item>
                    </ContextMenu.Popup>
                  </ContextMenu.Positioner>
                </ContextMenu.Portal>
              )}
            </ContextMenu.Root>
          )
        })}
      </div>

      <p className="ui-inv-hint"><MousePointerClick size={11} /> 拖拽交换 · 右键操作菜单 · 键盘：Enter 选中来源→目标→Enter 确认，Esc 取消</p>
      <div className="ui-inv-live" role="status" aria-live="polite">{liveMessage}</div>

      {inspecting && (
        <div className="ui-inv-inspect-scrim" onClick={() => setInspecting(null)}>
          <div className="ui-inv-inspect-card" onClick={(e) => e.stopPropagation()}>
            <span className={`ui-inv-glyph ui-inv-rarity-${inspecting.rarity} is-large`}>{inspecting.glyph}</span>
            <h3>{inspecting.name}</h3>
            <span className={`ui-inv-inspect-rarity ui-inv-rarity-${inspecting.rarity}`}>
              <Package size={12} /> {RARITY_LABEL[inspecting.rarity]}
            </span>
            <p>持有数量 {inspecting.qty}。占位说明文本——真实物品描述与词条数据接入后台后填充。</p>
            <button className="ui-inv-inspect-close" onClick={() => setInspecting(null)}>关闭</button>
          </div>
        </div>
      )}

      {flash?.kind === 'invalid' && <span className="sr-only" role="alert">非法落点，已回到原槎位</span>}
      {flash?.kind === 'drop' && <span className="sr-only">已完成交换</span>}
    </div>
  )
}

'use client'

import { useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  MATERIALS_META,
  filteredMaterials,
  PAGE_SIZE,
  type MaterialMeta,
} from '@/lib/library-data'
import {
  useLibApp,
  setTab,
  openDetail,
  setHovered,
  setDrag,
  isStarred,
  materialTexture,
} from '@/lib/library-store'
import { LibTile } from './library-tile'
import { BadgeGroup } from './library-badges'
import { BlueprintList } from './library-blueprints'
import { playSfx } from '@/lib/sound'
import { TiltCard } from '@/components/fx/tilt-card'
import { WeightedButton } from '@/components/fx/weighted-button'

/**
 * 中部主区（§4.3）：两个语义完全不同的标签——「可放置元素」= 积木网格，「地图·
 * 蓝本」= 整套房子的只读列表——物理分栏、不混装。元素网格按当前筛选/搜索派生、
 * 星标置顶、翻页；卡片可拖拽（拖入底部快捷栏配置）。激活标签用青色下划线。
 */
export function LibraryCardGrid({ page, onPage }: { page: number; onPage: (p: number) => void }) {
  const tab = useLibApp((s) => s.tab)
  const scope = useLibApp((s) => s.scope)
  const category = useLibApp((s) => s.category)
  const query = useLibApp((s) => s.query)
  const detailOpenId = useLibApp((s) => s.detailOpenId)
  const starredVer = useLibApp((s) => s.starred) // 触发星标置顶重排

  const list = useMemo(
    () => filteredMaterials(MATERIALS_META, { scope, category, query, isStarred }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 壳层按 V0 原样；根配置未装 react-hooks 插件（规则已置 off 占位，此注释仅为 V0 原文保留）
    [scope, category, query, starredVer],
  )

  const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageAssets = list.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-3">
      {/* 标签 */}
      <div role="tablist" aria-label="素材视图" className="flex items-end gap-2">
        <Tab label="可放置元素" active={tab === 'element'} onClick={() => setTab('element')} />
        <Tab label="地图·蓝本" active={tab === 'blueprint'} onClick={() => setTab('blueprint')} />
      </div>

      {tab === 'element' ? (
        <>
          {/* 卡片框 */}
          <div className="chamfer-lg hud-b lib-glass lib-frame-strong relative min-h-0 flex-1 overflow-hidden p-4">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={safePage}
                initial={{ opacity: 0, y: 14, scale: 0.97, filter: 'blur(4px)' }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -10, scale: 0.98, filter: 'blur(3px)' }}
                transition={{ type: 'spring', stiffness: 300, damping: 30, mass: 0.9 }}
                className="h-full"
              >
                {pageAssets.length === 0 ? (
                  <div className="flex h-full items-center justify-center px-6 text-center font-sans text-sm text-[color:var(--lib-dim)]">
                    书架上还没有这个分类的素材
                  </div>
                ) : (
                  <div className="grid h-full grid-cols-5 grid-rows-2 gap-4">
                    {pageAssets.map((a) => (
                      <Card key={a.id} asset={a} selected={a.id === detailOpenId} />
                    ))}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* 分页 */}
          <div className="flex items-center justify-center gap-4">
            <PageBtn dir="prev" disabled={safePage === 0} onClick={() => onPage(safePage - 1)} />
            <span className="font-mono text-[13px] tabular-nums tracking-widest text-[color:var(--lib-text)]">
              {safePage + 1} / {pageCount}
            </span>
            <PageBtn dir="next" disabled={safePage >= pageCount - 1} onClick={() => onPage(safePage + 1)} />
          </div>
        </>
      ) : (
        <BlueprintList />
      )}
    </section>
  )
}

function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <WeightedButton
      role="tab"
      aria-selected={active}
      onClick={() => {
        if (!active) playSfx('click')
        onClick()
      }}
      className={`chamfer hud-b relative px-5 py-2 font-sans text-[15px] font-bold tracking-wide transition-colors ${
        active ? 'lib-glass text-[color:var(--cyan)]' : 'text-[color:var(--lib-dim)] hover:text-[color:var(--lib-text)]'
      }`}
      style={{ ['--hud-bc' as string]: active ? 'var(--cyan)' : 'var(--lib-line)' }}
    >
      {label}
      {active && (
        <motion.span
          layoutId="lib-card-tab-indicator"
          className="absolute inset-x-3 -bottom-[3px] h-[2px] bg-[color:var(--cyan)] shadow-[0_0_8px_var(--cyan)]"
          transition={{ type: 'spring', stiffness: 500, damping: 34, mass: 0.7 }}
        />
      )}
    </WeightedButton>
  )
}

function Card({ asset, selected }: { asset: MaterialMeta; selected: boolean }) {
  // 订阅贴图投影：绘制器改绘该素材后，卡片图标即时刷新（Spec §八「保存后卡片
  // 图标更新为新贴图」）。materialTexture 本身是纯读函数，靠这里的 store
  // 订阅拿到重渲染时机。
  useLibApp((s) => s.textures)
  const textureUrl = materialTexture(asset.id)?.dataUrl ?? null

  return (
    <TiltCard max={10} lift={7} className="h-full w-full">
      <button
        aria-pressed={selected}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', asset.id)
          e.dataTransfer.effectAllowed = 'copy'
          setDrag(asset.id)
        }}
        onDragEnd={() => setDrag(null)}
        onMouseEnter={() => {
          setHovered(asset.id)
          playSfx('hover')
        }}
        onMouseLeave={() => setHovered(null)}
        onClick={() => {
          if (!selected) playSfx('select')
          openDetail(asset.id)
        }}
        className={`chamfer hud-b lib-card-chip group relative h-full w-full overflow-hidden p-2 text-left ${selected ? 'lib-selected' : ''}`}
        style={{
          background: selected ? 'rgba(6,182,212,0.1)' : 'var(--lib-panel-solid)',
          ['--hud-bc' as string]: selected ? 'var(--cyan)' : 'var(--lib-line)',
        }}
      >
        {/* 贴图槽 */}
        <div className="lib-tile chamfer relative h-full w-full">
          <LibTile tile={asset.tile} glow={asset.glow} textureUrl={textureUrl} className="h-full w-full" />
        </div>

        {/* 角标组（星标 + 限免/UGC/合成/已改动） */}
        <BadgeGroup asset={asset} />

        {/* 悬停气泡（名称/类别/品级） */}
        <div className="pointer-events-none absolute left-1/2 top-1 z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-black/90 px-2 py-1 font-sans text-[11px] text-[color:var(--lib-text)] opacity-0 shadow-lg ring-1 ring-[color:var(--lib-line)] transition-opacity group-hover:opacity-100">
          {asset.name} · {asset.category}
        </div>

        {/* 名称 + 分类 */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-2 pb-1.5 pt-4 text-center">
          <div className="truncate font-sans text-[13px] font-bold text-[color:var(--lib-text)]">{asset.name}</div>
          <div className="font-sans text-[11px] text-[color:var(--lib-dim)]">{asset.category}</div>
        </div>
      </button>
    </TiltCard>
  )
}

function PageBtn({ dir, disabled, onClick }: { dir: 'prev' | 'next'; disabled: boolean; onClick: () => void }) {
  return (
    <WeightedButton
      onClick={() => {
        if (!disabled) playSfx('click')
        onClick()
      }}
      disabled={disabled}
      aria-label={dir === 'prev' ? '上一页' : '下一页'}
      className="chamfer hud-b lib-btn flex h-8 w-8 items-center justify-center text-[color:var(--lib-text)] disabled:cursor-not-allowed"
      style={{ ['--hud-bc' as string]: 'var(--lib-line)' }}
    >
      {dir === 'prev' ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
    </WeightedButton>
  )
}

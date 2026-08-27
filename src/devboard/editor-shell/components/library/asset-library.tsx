'use client'

import { useEffect, useState } from 'react'
import { useLibrary, closeLibrary, useLibApp, setQuery } from '@editor/lib/library-store'
import { MATERIALS_META, materialMetaById } from '@editor/lib/library-data'
import { LibrarySidebar } from './library-sidebar'
import { LibraryCardGrid } from './library-card-grid'
import { LibraryDetail } from './library-detail'
import { LibraryQuickbar } from './library-quickbar'
import { LibraryPortal } from './library-portal'
import { IconBack } from './library-icons'
import { Search } from 'lucide-react'
import { playSfx } from '@editor/lib/sound'
import { WeightedButton } from '@editor/components/fx/weighted-button'

/**
 * 梦境素材库整屏覆盖层。挂在编辑器同一 page 内（编辑器不卸载），因此：
 * - entering 阶段渲染传送门过场（LibraryPortal），本体做 warp-in；
 * - leaving 阶段本体做轻量淡出，全程无开机/终端动画；
 * - closed 阶段整体不渲染。
 *
 * 界面本地状态（tab/scope/category/query/detail/星标/快捷栏）全部集中在
 * library-store，覆盖层反复开合时完整保留（§1、§5.2）。本组件只负责编排与
 * 顶栏，翻页游标为纯视图态放在本地。
 */
export function AssetLibrary() {
  const phase = useLibrary((s) => s.phase)
  const [page, setPage] = useState(0)

  // 筛选/搜索变化时回到第一页
  const scope = useLibApp((s) => s.scope)
  const category = useLibApp((s) => s.category)
  const query = useLibApp((s) => s.query)
  useEffect(() => {
    setPage(0)
  }, [scope, category, query])

  const detailId = useLibApp((s) => s.detailOpenId)
  const firstMaterial = MATERIALS_META[0]
  const detail = (detailId ? materialMetaById(detailId) : null) ?? firstMaterial

  if (phase === 'closed') return null

  return (
    <>
      {phase === 'entering' && <LibraryPortal />}
      <div
        className={`lib-root fixed inset-0 z-[880] flex flex-col overflow-hidden bg-[color:var(--lib-bg)] text-[color:var(--lib-text)] ${
          phase === 'leaving' ? 'lib-leave' : 'lib-warp-in'
        }`}
      >
        {/* 背景：暖光梦境书架实景，留出可见的场景呼吸感，暗角只压边缘不压中心 */}
        <div
          className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-80"
          style={{ backgroundImage: 'url(/library/backdrop.png)' }}
        />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_38%,rgba(5,9,14,0.78)_100%)]" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[rgba(5,9,14,0.55)] via-transparent to-[rgba(5,9,14,0.45)]" />
        <div className="crt-scanlines pointer-events-none absolute inset-0 opacity-20" />

        {/* 顶栏 */}
        <TopBar query={query} />

        {/* 主体：左栏（整列）+ 主区（上排卡片/详情，下排快捷栏）——四周与栏间都留出
            能看见底图的缝隙，面板才像悬浮的玻璃牌而不是铺满的页面分区 */}
        <div className="relative z-10 flex min-h-0 flex-1 gap-6 px-8 pb-8">
          <LibrarySidebar />

          <div className="flex min-h-0 flex-1 flex-col gap-5">
          <div className="flex min-h-0 flex-1 gap-6">
              <LibraryCardGrid page={page} onPage={setPage} />
              {detail ? <LibraryDetail asset={detail} /> : <LibraryDetailEmpty />}
            </div>
            <LibraryQuickbar />
          </div>
        </div>

        <ToastLayer />
      </div>
    </>
  )
}

function TopBar({ query }: { query: string }) {
  return (
    <header className="relative z-10 flex items-center gap-4 px-8 py-5">
      {/* 品牌：青色 W 徽标（唯一高饱和主色）+ 双行标题 */}
      <div className="flex items-center gap-3">
        <div
          className="chamfer relative grid h-11 w-11 place-items-center shadow-[0_0_22px_-4px_var(--cyan)]"
          style={{ background: 'linear-gradient(135deg, var(--cyan-bright), var(--cyan-deep))' }}
        >
          <span className="font-mono text-2xl font-black leading-none text-[#04141a]">W</span>
          <span className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/25" />
        </div>
        <div className="leading-tight">
          <div className="font-sans text-[20px] font-bold tracking-wide text-[color:var(--lib-text)]">
            WakeUp <span className="text-[color:var(--cyan)]">·</span> 梦境素材库
          </div>
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[color:var(--lib-dim)]">
            Dream Asset Library
          </div>
        </div>
      </div>

      {/* 实时搜索（输入即筛选，§4.3） */}
      <div
        className="chamfer hud-b mx-auto flex w-full max-w-[640px] items-center gap-2 px-4 py-2.5"
        style={{ ['--hud-bc' as string]: 'var(--lib-line)', background: 'var(--lib-inset)' }}
      >
        <Search size={16} className="text-[color:var(--lib-dim)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索素材名称、描述、标签..."
          className="w-full bg-transparent font-sans text-[14px] text-[color:var(--lib-text)] placeholder:text-[color:var(--lib-dim)]/70 focus:outline-none"
        />
      </div>

      {/* 回编辑器（无开机动画，瞬回） */}
      <WeightedButton
        onClick={() => {
          playSfx('toggle')
          window.location.assign(`/map-editor?${new URLSearchParams({ entryTool: 'map-editor', returnTo: window.location.pathname, ...(new URLSearchParams(window.location.search).get('entryId') ? { entryId: new URLSearchParams(window.location.search).get('entryId')! } : {}) }).toString()}`)
        }}
        className="chamfer lib-btn-cyan shrink-0 px-5 py-2.5 font-sans text-[15px] font-bold"
      >
        <span className="flex items-center gap-2">
          <IconBack width={16} height={16} />
          回编辑器
        </span>
      </WeightedButton>
    </header>
  )
}

function LibraryDetailEmpty() {
  return (
    <aside className="chamfer-lg hud-b lib-glass lib-frame-strong flex w-[300px] shrink-0 items-center justify-center p-4">
      <p className="font-sans text-[13px] text-[color:var(--lib-dim)]">暂无素材详情</p>
    </aside>
  )
}

function ToastLayer() {
  const toast = useLibApp((s) => s.toast)
  if (!toast) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[920] flex justify-center px-6">
      <div
        key={toast.id}
        className="chamfer hud-b lib-glass lib-warp-in max-w-[80vw] px-4 py-2.5 font-sans text-[14px] font-bold"
        style={{
          ['--hud-bc' as string]: toast.tone === 'reject' ? 'var(--danger)' : 'var(--cyan)',
          color: toast.tone === 'reject' ? 'var(--danger)' : 'var(--lib-text)',
        }}
        role="status"
      >
        {toast.msg}
      </div>
    </div>
  )
}

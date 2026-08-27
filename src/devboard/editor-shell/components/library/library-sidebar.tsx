'use client'

import { motion } from 'framer-motion'
import { CATEGORIES } from '@editor/lib/materials'
import { COLLECTION, SCOPE_ITEMS } from '@editor/lib/library-data'
import { useLibApp, setScope, setCategory } from '@editor/lib/library-store'
import { playSfx } from '@editor/lib/sound'
import { WeightedButton } from '@editor/components/fx/weighted-button'

/**
 * 左栏（§4.2）：上「范围」分栏（全部 / 我的素材，全部含限免），下「类别」筛选
 * （6 类，单选可反选）。当前项 = 青左条 + 淡青晕（唯一高饱和主色的用法之一）。
 * 底部常驻图鉴收集进度与等级。全部状态读自 store，点击走动作。
 */
export function LibrarySidebar() {
  const scope = useLibApp((s) => s.scope)
  const category = useLibApp((s) => s.category)

  return (
    <aside className="chamfer-lg hud-b lib-glass lib-frame flex w-[240px] shrink-0 flex-col p-3">
      <nav className="flex flex-col gap-4" aria-label="素材筛选">
        {/* 范围分栏 */}
        <div>
          <p className="mb-1.5 px-2 font-sans text-[12px] font-bold tracking-wide text-[color:var(--lib-dim)]">范围</p>
          <ul className="flex flex-col gap-0.5">
            {SCOPE_ITEMS.map((it) => (
              <NavRow
                key={it.key}
                label={it.label}
                active={scope === it.key}
                indicatorId="sidebar-scope-indicator"
                onClick={() => {
                  playSfx('click')
                  setScope(it.key)
                }}
              />
            ))}
          </ul>
        </div>

        {/* 类别筛选 */}
        <div>
          <p className="mb-1.5 px-2 font-sans text-[12px] font-bold tracking-wide text-[color:var(--lib-dim)]">类别</p>
          <ul className="flex flex-col gap-0.5">
            {CATEGORIES.map((c) => (
              <NavRow
                key={c}
                label={c}
                active={category === c}
                indicatorId="sidebar-category-indicator"
                onClick={() => {
                  playSfx('click')
                  // 再次点击已选类别 → 取消（回到全部类别）
                  setCategory(category === c ? '全部' : c)
                }}
              />
            ))}
          </ul>
        </div>
      </nav>

      {/* 图鉴进度（常驻底部） */}
      <div className="mt-auto flex flex-col gap-3 pt-4">
        <Progress
          label="素材收集进度"
          value={COLLECTION.collected}
          total={COLLECTION.total}
          text={`${COLLECTION.collected} / ${COLLECTION.total}`}
        />
        <Progress
          label={`图鉴等级 Lv.${COLLECTION.level}`}
          value={COLLECTION.levelPct}
          total={100}
          text={`${COLLECTION.levelPct}%`}
        />
      </div>
    </aside>
  )
}

function NavRow({
  label,
  active,
  indicatorId,
  onClick,
}: {
  label: string
  active: boolean
  indicatorId: string
  onClick: () => void
}) {
  return (
    <li className="relative">
      {active && (
        <motion.span
          layoutId={indicatorId}
          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[color:var(--cyan)] shadow-[0_0_8px_var(--cyan)]"
          transition={{ type: 'spring', stiffness: 560, damping: 34, mass: 0.7 }}
        />
      )}
      <WeightedButton
        onClick={onClick}
        aria-current={active ? 'true' : undefined}
        className={`relative flex w-full items-center rounded-sm px-3 py-2 text-left font-sans text-[15px] transition-colors ${
          active
            ? 'bg-[color:var(--cyan)]/10 text-[color:var(--lib-text)]'
            : 'text-[color:var(--lib-dim)] hover:bg-white/5 hover:text-[color:var(--lib-text)]'
        }`}
      >
        {label}
      </WeightedButton>
    </li>
  )
}

function Progress({ label, value, total, text }: { label: string; value: number; total: number; text: string }) {
  const pct = Math.max(0, Math.min(100, (value / total) * 100))
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-sans text-[12px] text-[color:var(--lib-dim)]">{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-[color:var(--cyan)]">{text}</span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-black/50">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[color:var(--cyan)]"
          style={{ width: `${pct}%`, boxShadow: '0 0 10px -2px var(--cyan)' }}
        />
        <div className="lib-bar-shine absolute inset-y-0 left-0 w-8 bg-white/25 blur-[3px]" />
      </div>
    </div>
  )
}

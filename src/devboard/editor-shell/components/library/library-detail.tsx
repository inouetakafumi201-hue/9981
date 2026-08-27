'use client'

import { useState } from 'react'
import {
  type MaterialMeta,
  TOKEN_SLOTS,
  QUALITY_COLOR,
  QUALITY_LABEL,
  badgeStateOf,
} from '@editor/lib/library-data'
import { isStarred, toggleStar, showToast, useLibApp, materialTexture } from '@editor/lib/library-store'
import { openBench } from '@editor/lib/bench-store'
import { openPixelPainter } from '@editor/lib/painter-store'
import { LibTile } from './library-tile'
import { Chip } from './library-badges'
import {
  IconStar,
  IconHammer,
  IconPaint,
  StatAttr,
  StatSkill,
  StatState,
  StatDefense,
  StatMobility,
} from './library-icons'
import { playSfx } from '@editor/lib/sound'
import type { ComponentType, SVGProps } from 'react'
import type { TokenSlot } from '@editor/lib/library-data'
import { TiltCard } from '@editor/components/fx/tilt-card'
import { WeightedButton } from '@editor/components/fx/weighted-button'
import { SingleBurst } from '@editor/components/fx/random-burst-field'

const SLOT_ICON: Record<TokenSlot, ComponentType<SVGProps<SVGSVGElement>>> = {
  attr: StatAttr,
  skill: StatSkill,
  state: StatState,
  defense: StatDefense,
  mobility: StatMobility,
}

/**
 * 右侧详情浮层（§4.4）。以品级色描边呈现大预览与整框；名称/分类/品级标签；五个
 * **固定词条槽**（属性/技能/状态/防御/机动）——已挂载显示词条名+品级色，空槽显示
 * 「＋」，两者点击都弹「词条系统待接线」提示（预留 onClickTokenSlot 端口）；合成物
 * 追加红色弱点行；限免素材追加绿色限免说明。底部「星标 / 去研究台锻造」。

 * 星标走 store 乐观切换；锻造与词条槽为占位反馈，等元状态层动作接线。
 */
export function LibraryDetail({ asset }: { asset: MaterialMeta }) {
  // 订阅星标集合，保证切换后本面板即时刷新
  useLibApp((s) => s.starred)
  // 订阅贴图投影：绘制器保存后大预览随之更新（Spec §八）
  useLibApp((s) => s.textures)
  const starred = isStarred(asset.id)
  const qColor = QUALITY_COLOR[asset.quality]
  const badges = badgeStateOf(asset)
  const textureUrl = materialTexture(asset.id)?.dataUrl ?? null
  const [burstId, setBurstId] = useState(0)

  return (
    <aside
      className="chamfer-lg hud-b lib-glass lib-frame-strong flex w-[300px] shrink-0 flex-col p-4"
      style={{ ['--hud-bc' as string]: qColor }}
    >
      <div className="-mr-2 flex min-h-0 flex-1 flex-col overflow-y-auto pr-2">
        {/* 角标行：左品级标签，右来源/限免 chip */}
        <div className="flex min-h-[22px] items-start justify-between">
          <span
            className="rounded px-2 py-0.5 font-sans text-[11px] font-bold"
            style={{ background: `color-mix(in srgb, ${qColor} 22%, transparent)`, color: qColor }}
          >
            {QUALITY_LABEL[asset.quality]}
          </span>
          <span className="flex items-center gap-1">
            {badges.free && <Chip label="限免" tone="free" />}
            {badges.ugc && <Chip label="UGC" tone="ugc" />}
            {badges.craft && <Chip label="合成" tone="craft" />}
          </span>
        </div>

        {/* 大预览：品级色描边方框 + 悬浮微动 + 底座光晕 + 鼠标视差倾斜 */}
        <div className="relative mx-auto mt-2 flex h-[180px] w-full shrink-0 items-center justify-center">
          <span
            className="lib-pedestal absolute bottom-4 h-4 w-32 rounded-[50%] blur-md"
            style={{ background: `color-mix(in srgb, ${qColor} 55%, transparent)` }}
          />
          <TiltCard max={13} lift={5} className="h-[150px] w-[150px]">
            <div
              className="lib-quality-ring chamfer relative grid h-full w-full place-items-center"
              style={{ ['--q' as string]: qColor, background: 'var(--lib-inset)' }}
            >
              <LibTile
                tile={asset.tile}
                glow={asset.glow}
                textureUrl={textureUrl}
                className="lib-hero-float h-[112px] w-[112px]"
              />
            </div>
          </TiltCard>
        </div>

        {/* 名称 / 分类 */}
        <div className="mt-3 text-center">
          <h2 className="font-sans text-[24px] font-bold leading-tight text-[color:var(--lib-text)]">{asset.name}</h2>
          <p className="font-sans text-[13px] text-[color:var(--lib-dim)]">{asset.category}</p>
        </div>

        {/* 五词条槽 */}
        <div className="mt-4 grid grid-cols-5 gap-1.5">
          {TOKEN_SLOTS.map((slot, i) => (
            <TokenSlotCell key={slot.key} label={slot.label} slotKey={slot.key} token={asset.equippedTokens[i] ?? null} />
          ))}
        </div>

        {/* 合成物弱点 */}
        {asset.weakness && (
          <p className="mt-4 font-sans text-[13px] leading-relaxed">
            <span className="font-bold text-[color:var(--danger)]">弱点：</span>
            <span className="text-[color:var(--lib-text)]">{asset.weakness}</span>
          </p>
        )}

        {/* 限免说明 */}
        {asset.limitedFree && asset.freeRemaining && (
          <p className="mt-2 flex items-center gap-2 font-sans text-[13px]">
            <span className="rounded bg-[color:var(--free)]/15 px-1.5 py-0.5 text-[11px] font-bold text-[color:var(--free)]">
              限免
            </span>
            <span className="text-[color:var(--lib-dim)]">
              限时免费获取：剩余 <span className="font-bold text-[color:var(--free)]">{asset.freeRemaining}</span>
            </span>
          </p>
        )}

        {/* 描述补位 */}
        {!asset.weakness && !asset.limitedFree && (
          <p className="mt-4 font-sans text-[13px] leading-relaxed text-[color:var(--lib-dim)]">{asset.desc}</p>
        )}
      </div>

      {/* 动作按钮（固定底部） */}
      <div className="flex shrink-0 flex-col gap-2 pt-4">
        <div className="flex gap-2">
          <WeightedButton
            onClick={() => {
              playSfx(starred ? 'click' : 'success')
              const next = !starred
              toggleStar(asset.id)
              if (next) setBurstId((n) => n + 1)
            }}
            className={`chamfer hud-b lib-btn flex items-center gap-1.5 px-4 py-2.5 font-sans text-[14px] font-bold ${
              badges.craft ? '' : 'flex-1 justify-center'
            }`}
            style={{
              ['--hud-bc' as string]: starred ? 'var(--star)' : 'var(--lib-line)',
              color: starred ? 'var(--star)' : 'var(--lib-dim)',
            }}
            title={starred ? '取消星标' : '加入星标'}
          >
            <IconStar filled={starred} width={16} height={16} />
            星标
            {burstId > 0 && (
              <SingleBurst
                key={burstId}
                kind="spark-ring"
                color="var(--star)"
                size={54}
                onDone={() => setBurstId(0)}
              />
            )}
          </WeightedButton>
          {/* 绘制贴图：仅合成物可用（像素绘制器 Spec §八「素材库详情『绘制贴图』
              按钮仅合成物」），独立悬浮窗组件只认 materialId，这里只负责唤出 */}
          {badges.craft && (
            <WeightedButton
              onClick={() => {
                playSfx('click')
                openPixelPainter(asset.id)
              }}
              className="chamfer hud-b flex flex-1 items-center justify-center gap-1.5 px-4 py-2.5 font-sans text-[14px] font-bold text-[color:var(--gold)]"
              style={{ ['--hud-bc' as string]: 'var(--gold)' }}
              title="绘制贴图"
            >
              <IconPaint width={16} height={16} />
              绘制贴图
            </WeightedButton>
          )}
        </div>
        <WeightedButton
          onClick={(e) => {
            playSfx('success')
            // 从按钮中心绽开青色传送门 → 研究台（§一 三界面切换链）
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            openBench({
              x: (r.left + r.width / 2) / window.innerWidth,
              y: (r.top + r.height / 2) / window.innerHeight,
            })
            window.setTimeout(() => {
              window.dispatchEvent(new CustomEvent('creation:navigate', { detail: { tool: 'research-bench' } }))
            }, 360)
          }}
          className="chamfer lib-btn-cyan flex items-center justify-center gap-1.5 px-4 py-2.5 font-sans text-[14px] font-bold"
        >
          <IconHammer width={16} height={16} />
          去研究台锻造
        </WeightedButton>
      </div>
    </aside>
  )
}

function TokenSlotCell({
  label,
  slotKey,
  token,
}: {
  label: string
  slotKey: TokenSlot
  token: MaterialMeta['equippedTokens'][number]
}) {
  const Icon = SLOT_ICON[slotKey]
  const filled = token !== null
  const qColor = token ? QUALITY_COLOR[token.quality] : 'var(--lib-line)'
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="font-sans text-[12px] text-[color:var(--lib-dim)]">{label}</span>
      <TiltCard max={16} lift={3} className="h-11 w-full">
        <WeightedButton
          onClick={() => {
            playSfx('click')
            showToast(filled && token ? `词条「${token.name}」详情待接线` : '词条挂载待接线')
          }}
          className="chamfer hud-b flex h-full w-full items-center justify-center"
          style={{
            ['--hud-bc' as string]: qColor,
            background: 'var(--lib-inset)',
            color: filled ? qColor : 'var(--lib-dim)',
            boxShadow: filled ? `0 0 14px -5px ${qColor}` : undefined,
          }}
          title={filled && token ? `${label}词条：${token.name}` : `${label}（空槽）`}
        >
          {filled ? <Icon width={22} height={22} /> : <span className="text-[18px] leading-none">+</span>}
        </WeightedButton>
      </TiltCard>
      <span className="max-w-full truncate font-sans text-[10px]" style={{ color: filled ? qColor : 'transparent' }}>
        {filled && token ? token.name : '·'}
      </span>
    </div>
  )
}

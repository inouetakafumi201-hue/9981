'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  jobElapsedMs,
  jobRemainingMs,
  jobProgress,
  jobIsFinished,
  formatStopwatch,
  ACCENT_COLOR,
  type SynthesisJob,
} from '@editor/lib/bench-data'
import { materialMetaById, QUALITY_COLOR, QUALITY_LABEL } from '@editor/lib/library-data'
import { useBench, focusJob, claimJob, dismissFailedJob, rushJob, closeBench } from '@editor/lib/bench-store'
import { openDetail } from '@editor/lib/library-store'
import { openPixelPainter } from '@editor/lib/painter-store'
import { LibTile } from '@editor/components/library/library-tile'
import { TiltCard } from '@editor/components/fx/tilt-card'
import { RandomBurstField } from '@editor/components/fx/random-burst-field'
import { useOrganicDrift } from '@editor/components/fx/use-organic-drift'
import { WeightedButton } from '@editor/components/fx/weighted-button'
import { playSfx } from '@editor/lib/sound'

/**
 * 研究台的「合成任务」不是一段播放完就结束的仪式动画——它是真实异步的后台任务
 * （60–120s，对齐 LLM 侧真实生成时长），玩家提交后可以立刻离开去做别的事。
 *
 * - BenchJobStrip：常驻队列条（紧凑卡片 + 迷你进度环），塑形备选栏旁边一直可见。
 * - BenchJobFocusOverlay：点开任意卡片后弹出的「研究舱」大图——运行中持续走秒表 +
 *   随机特效爆发（不是循环动画）；完成后稳态发光等待领取；失败后变灰给出原因。
 */

const FLAVOR_LINES = [
  '解析材料共振频率…',
  '比对词条组合数据库…',
  '校准塑形场强…',
  '追踪意识残留信号…',
  '重构像素级晶格结构…',
  '模拟受力形变路径…',
  '写入梦境编译缓存…',
  '核验元素相斥矩阵…',
]

/* ============================== 队列条 ============================== */

export function BenchJobStrip() {
  const jobs = useBench((s) => s.jobs)

  return (
    <div className="chamfer hud-b flex h-full min-w-[240px] flex-col gap-2 p-2.5" style={{ ['--hud-bc' as string]: 'var(--lib-line)' }}>
      <div className="flex items-center justify-between">
        <span className="font-sans text-[12px] font-bold text-[color:var(--cyan)]">研究任务</span>
        <span className="font-sans text-[11px] tabular-nums text-[color:var(--lib-dim)]">{jobs.length} 项</span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
        {jobs.length === 0 && <span className="font-sans text-[11px] text-[color:var(--lib-dim)]">暂无进行中的研究</span>}
        {jobs.map((j) => (
          <JobStripCard key={j.id} job={j} />
        ))}
      </div>
    </div>
  )
}

function JobStripCard({ job }: { job: SynthesisJob }) {
  const finished = jobIsFinished(job)
  const failed = finished && job.willFail
  const done = finished && !job.willFail
  const progress = jobProgress(job)
  const ring = ringColor(job)

  return (
    <motion.button
      layout
      onClick={() => {
        playSfx('select')
        focusJob(job.id)
      }}
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.98 }}
      className={`chamfer hud-b flex items-center gap-2 p-1.5 text-left ${done ? 'lib-selected' : ''}`}
      style={{ ['--hud-bc' as string]: done ? 'var(--gold)' : failed ? 'var(--lib-line)' : 'var(--cyan)' }}
    >
      <MiniRing progress={finished ? 1 : progress} color={ring} spin={!finished} failed={failed} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate font-sans text-[11px] font-bold ${failed ? 'text-[color:var(--lib-dim)]' : 'text-[color:var(--lib-text)]'}`}>
          {job.baseName}
        </span>
        <span className="block font-sans text-[10px] tabular-nums text-[color:var(--lib-dim)]">
          {done ? '已完成 · 待领取' : failed ? '未成型 · 待查看' : formatStopwatch(jobRemainingMs(job)) + ' 剩余'}
        </span>
      </span>
    </motion.button>
  )
}

function ringColor(job: SynthesisJob) {
  const finished = jobIsFinished(job)
  if (finished && job.willFail) return 'var(--lib-dim)'
  if (finished) return 'var(--gold)'
  return 'var(--cyan)'
}

function MiniRing({ progress, color, spin, failed }: { progress: number; color: string; spin: boolean; failed: boolean }) {
  const r = 13
  const c = 2 * Math.PI * r
  return (
    <span className="relative grid h-8 w-8 shrink-0 place-items-center">
      <svg width={32} height={32} viewBox="0 0 32 32" className={spin ? 'animate-[spin_3.2s_linear_infinite]' : ''}>
        <circle cx="16" cy="16" r={r} fill="none" stroke="var(--lib-inset)" strokeWidth={2.5} />
        <circle
          cx="16"
          cy="16"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - progress)}
          transform="rotate(-90 16 16)"
          style={{ filter: `drop-shadow(0 0 4px ${color})` }}
        />
      </svg>
      <span className="absolute font-mono text-[9px] font-bold" style={{ color: failed ? 'var(--lib-dim)' : color }}>
        {failed ? '!' : progress >= 1 ? '\u2713' : ''}
      </span>
    </span>
  )
}

/* ============================== 研究舱大图 ============================== */

export function BenchJobFocusOverlay() {
  const jobs = useBench((s) => s.jobs)
  const focusedId = useBench((s) => s.focusedJobId)
  const job = jobs.find((j) => j.id === focusedId) ?? null

  return (
    <AnimatePresence>
      {job && <PodPanel key={job.id} job={job} />}
    </AnimatePresence>
  )
}

function PodPanel({ job }: { job: SynthesisJob }) {
  const finished = jobIsFinished(job)
  const failed = finished && job.willFail
  const done = finished && !job.willFail
  const base = materialMetaById(job.baseMaterialId)
  const drift = useOrganicDrift(done ? 3 : failed ? 0 : 7, done ? 0.5 : 1)
  const accentColors = job.tokenAccents.length ? job.tokenAccents.map((a) => ACCENT_COLOR[a]) : ['var(--cyan)']
  const ringMain = failed ? 'color-mix(in srgb, var(--lib-dim) 70%, #666)' : done ? 'var(--gold)' : 'var(--cyan)'

  return (
    <motion.div
      className="fixed inset-0 z-[80] grid place-items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <motion.div
        className="absolute inset-0 bg-black/70"
        style={{ backdropFilter: 'blur(6px)' }}
        onClick={() => {
          playSfx('toggle')
          focusJob(null)
        }}
      />

      <TiltCard max={7} lift={0} className="relative z-10">
        <motion.div
          initial={{ opacity: 0, scale: 0.86, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 14 }}
          transition={{ type: 'spring', stiffness: 210, damping: 24, mass: 1.1 }}
          className="chamfer-lg hud-b lib-glass relative flex w-[440px] flex-col items-center gap-4 overflow-hidden p-6"
          style={{ ['--hud-bc' as string]: ringMain, boxShadow: `0 30px 60px -20px rgba(0,0,0,0.65), 0 0 60px -20px ${ringMain}` }}
        >
          {/* 关闭（仅退出焦点视图，任务继续在后台跑） */}
          <button
            onClick={() => {
              playSfx('toggle')
              focusJob(null)
            }}
            className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full text-[color:var(--lib-dim)] transition-colors hover:text-[color:var(--lib-text)]"
            aria-label="收起研究舱（任务在后台继续）"
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>

          <div className="flex flex-col items-center gap-0.5 text-center">
            <span className="font-sans text-[13px] font-bold tracking-wide text-[color:var(--lib-dim)]">
              {failed ? '研究未能成型' : done ? '研究已完成' : '正在科研加���'}
            </span>
            <span className="font-sans text-[18px] font-bold text-[color:var(--lib-text)]">
              {job.baseName} <span style={{ color: ringMain }}>·</span> {job.tokenNames.join(' + ') || '无附加词条'}
            </span>
          </div>

          {/* 核心舱体 */}
          <PodCore job={job} base={base} drift={drift} ringMain={ringMain} accentColors={accentColors} finished={finished} failed={failed} done={done} />

          {/* 秒表 / 状态区 */}
          {!finished && <BrewingStatus job={job} />}
          {done && <DoneStatus job={job} onClaim={() => claimJob(job.id)} />}
          {failed && <FailedStatus job={job} onDismiss={() => dismissFailedJob(job.id)} />}

          {!finished && (
            <button
              onClick={() => {
                playSfx('click')
                rushJob(job.id)
              }}
              className="chamfer lib-btn hud-b px-4 py-1.5 font-sans text-[11px] font-bold text-[color:var(--gold)]"
              style={{ ['--hud-bc' as string]: 'var(--lib-line)' }}
            >
              消耗记忆碎片 · 立即完成
            </button>
          )}
        </motion.div>
      </TiltCard>
    </motion.div>
  )
}

function PodCore({
  job,
  base,
  drift,
  ringMain,
  accentColors,
  finished,
  failed,
  done,
}: {
  job: SynthesisJob
  base: ReturnType<typeof materialMetaById>
  drift: ReturnType<typeof useOrganicDrift>
  ringMain: string
  accentColors: string[]
  finished: boolean
  failed: boolean
  done: boolean
}) {
  const progress = jobProgress(job)
  const size = 220
  const r = 96
  const c = 2 * Math.PI * r

  return (
    <div className="relative grid h-[220px] w-[220px] place-items-center">
      {/* 外环：机械匀速旋转的刻度环——这是「设备正在运转」的机械感，与随机爆发的
          「不可预期特效」区分开，两者叠加才不会显得单一。 */}
      {!failed && (
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="pointer-events-none absolute inset-0"
          style={{ animation: `spin ${done ? 40 : 22}s linear infinite` }}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r + 14}
            fill="none"
            stroke={ringMain}
            strokeOpacity={0.35}
            strokeWidth={1.5}
            strokeDasharray="2 10"
          />
        </svg>
      )}

      {/* 进度环：真实耗时派生，随任务时钟平滑推进（非固定时长动画） */}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--lib-inset)" strokeWidth={6} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={ringMain}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={c}
          animate={{ strokeDashoffset: c * (1 - (finished ? 1 : progress)) }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          style={{ filter: `drop-shadow(0 0 10px ${ringMain})` }}
        />
      </svg>

      {/* 随机特效爆发：仅在进行中出现，不定期、不同种类 */}
      <RandomBurstField active={!finished} colors={accentColors} size={190} />

      {/* 舱内容纳的基础素材：有机漂移 + 呼吸感，失败态压暗去色 */}
      <motion.div
        style={{
          ...(failed ? {} : { x: drift.x, y: drift.y, rotate: drift.rotate }),
          ['--hud-bc' as string]: ringMain,
        } as React.CSSProperties}
        animate={
          done
            ? { scale: [1, 1.05, 1] }
            : failed
              ? { scale: 1, filter: 'grayscale(1) brightness(0.4)' }
              : { scale: [0.97, 1.03, 0.97] }
        }
        transition={
          done
            ? { duration: 2.2, ease: 'easeInOut', repeat: Infinity, repeatType: 'mirror' }
            : failed
              ? { duration: 0.6 }
              : { duration: 3.4, ease: 'easeInOut', repeat: Infinity, repeatType: 'mirror' }
        }
        className="chamfer relative flex h-[118px] w-[118px] items-center justify-center"
      >
        <span
          className="pointer-events-none absolute -inset-3 rounded-full blur-xl"
          style={{ background: `radial-gradient(circle, ${ringMain}33, transparent 70%)` }}
        />
        {base && <LibTile tile={base.tile} glow={failed ? null : done ? 'warm' : 'cyan'} className="h-[92px] w-[92px]" />}
      </motion.div>
    </div>
  )
}

function BrewingStatus({ job }: { job: SynthesisJob }) {
  const [line, setLine] = useState(FLAVOR_LINES[0])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const schedule = () => {
      const delay = 4200 + Math.random() * 5600
      timer.current = setTimeout(() => {
        setLine(FLAVOR_LINES[Math.floor(Math.random() * FLAVOR_LINES.length)])
        schedule()
      }, delay)
    }
    schedule()
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  return (
    <div className="flex w-full flex-col items-center gap-1.5">
      <div className="flex items-center gap-6 font-mono tabular-nums">
        <span className="flex flex-col items-center">
          <span className="text-[10px] font-bold text-[color:var(--lib-dim)]">已用时</span>
          <span className="text-[20px] font-bold text-[color:var(--cyan)]">{formatStopwatch(jobElapsedMs(job))}</span>
        </span>
        <span className="h-8 w-px bg-[color:var(--lib-line)]" />
        <span className="flex flex-col items-center">
          <span className="text-[10px] font-bold text-[color:var(--lib-dim)]">预计剩余</span>
          <span className="text-[20px] font-bold text-[color:var(--lib-text)]">{formatStopwatch(jobRemainingMs(job))}</span>
        </span>
      </div>
      <AnimatePresence mode="wait">
        <motion.span
          key={line}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.35 }}
          className="font-sans text-[12px] text-[color:var(--lib-dim)]"
        >
          {line}
        </motion.span>
      </AnimatePresence>
      <span className="font-sans text-[11px] text-[color:var(--lib-dim)]/80">可以先离开去做别的事，完成后回来领取即可</span>
    </div>
  )
}

function DoneStatus({ job, onClaim }: { job: SynthesisJob; onClaim: () => void }) {
  const qc = QUALITY_COLOR[job.resultQuality]
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, duration: 0.4 }}
      className="flex w-full flex-col items-center gap-3"
    >
      <div className="flex flex-col items-center gap-0.5">
        <span className="font-sans text-[16px] font-bold" style={{ color: qc }}>
          {job.resultName}
        </span>
        <span className="font-sans text-[11px] font-bold" style={{ color: qc }}>
          {QUALITY_LABEL[job.resultQuality]}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <motion.button
          whileHover={{ y: -2, scale: 1.02 }}
          whileTap={{ scale: 0.96 }}
          onClick={() => {
            playSfx('success')
            onClaim()
          }}
          className="chamfer lib-btn-cyan px-6 py-2.5 font-sans text-[14px] font-bold"
        >
          收下成品
        </motion.button>
        {/* 绘制贴图：收下成品 → 关闭研究台 → 跳素材库选中该成品 → 自动打开像素
            绘制器（Spec §八「研究台合成完成」）。真实成品尚未接入独立 id
            （§9.2 债务 1，占位期用 baseMaterialId 承接底图对象），接线后改为
            job.resultMaterialId。 */}
        <WeightedButton
          onClick={() => {
            playSfx('click')
            onClaim()
            closeBench()
            openDetail(job.baseMaterialId)
            openPixelPainter(job.baseMaterialId)
          }}
          className="chamfer hud-b px-5 py-2.5 font-sans text-[13px] font-bold text-[color:var(--gold)]"
          style={{ ['--hud-bc' as string]: 'var(--gold)' }}
        >
          绘制贴图
        </WeightedButton>
      </div>
    </motion.div>
  )
}

function FailedStatus({ job, onDismiss }: { job: SynthesisJob; onDismiss: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, duration: 0.4 }}
      className="flex w-full flex-col items-center gap-3"
    >
      <p className="max-w-[340px] text-center font-sans text-[12px] leading-relaxed text-[color:var(--lib-dim)]">
        {job.failReason}
      </p>
      <motion.button
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.96 }}
        onClick={() => {
          playSfx('click')
          onDismiss()
        }}
        className="chamfer lib-btn hud-b px-6 py-2.5 font-sans text-[13px] font-bold text-[color:var(--lib-text)]"
        style={{ ['--hud-bc' as string]: 'var(--lib-line)' }}
      >
        知悉 · 材料与词条已返还
      </motion.button>
    </motion.div>
  )
}

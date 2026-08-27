'use client'

import { useCallback, useEffect, useRef } from 'react'
import {
  expandParticleSpec,
  particleCountFor,
  PARTICLE_HARD_CAP,
  PARTICLE_POOL_SIZE,
  type ParticleMotion,
  type ParticleShape,
  type ParticleSpec,
} from '@/lib/b7-particles'

// B7-04 粒子渲染层 —— §9 全部令牌的唯一渲染实现。
//
// 为什么是 canvas 而不是继续堆 CSS 伪元素：改造前的三处粒子都是 `<i>` + CSS keyframes，
// 每颗粒子一个 DOM 节点、一条独立动画，既没法按令牌换形状（圆点以外画不出菱形/环/碎片/
// 硬币），也没法做对象池和同屏 ≤50 的硬上限，更没法在屏幕外暂停。canvas 用一个合成层
// 承载全部粒子，形状由绘制过程决定，实例复用同一个池，RAF 在池空时自动停机——这才谈得上
// §12 的「同屏 ≤50 实例、屏幕外不更新、短时 burst 后回收」。

type Particle = {
  active: boolean
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  size: number
  rot: number
  vrot: number
  shape: ParticleShape
  motion: ParticleMotion
  colors: readonly string[]
  seed: number
  /** stream-to / bounce-to 的界面锚点（canvas 局部坐标） */
  tx: number
  ty: number
  /** ring / conduit 的最终半径 */
  maxRadius: number
}

function makeParticle(): Particle {
  return {
    active: false, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, size: 1, rot: 0, vrot: 0,
    shape: 'dot', motion: 'radial', colors: ['#fff'], seed: 0, tx: 0, ty: 0, maxRadius: 0,
  }
}

const TAU = Math.PI * 2

/** 寿命内按 colors 序列插值（爆炸 橙→红→暗红）。单色令牌直接返回该色。 */
function colorAt(colors: readonly string[], t: number): string {
  if (colors.length === 1) return colors[0]
  const scaled = t * (colors.length - 1)
  const i = Math.min(colors.length - 2, Math.floor(scaled))
  const f = scaled - i
  const a = hexToRgb(colors[i])
  const b = hexToRgb(colors[i + 1])
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const n = Number.parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// ---------------------------------------------------------------------------
// 生成：每条运动律有各自的初速度场，不是「统一随机方向再改颜色」
// ---------------------------------------------------------------------------
function seedParticle(
  p: Particle,
  spec: ParticleSpec,
  originX: number,
  originY: number,
  anchorX: number,
  anchorY: number,
  index: number,
  total: number,
) {
  const r = Math.random
  p.active = true
  p.age = 0
  p.seed = r()
  p.shape = spec.shape
  p.motion = spec.motion
  p.colors = spec.colors
  p.life = spec.lifeMs[0] + r() * (spec.lifeMs[1] - spec.lifeMs[0])
  p.size = spec.sizePx[0] + r() * (spec.sizePx[1] - spec.sizePx[0])
  p.x = originX
  p.y = originY
  p.tx = anchorX
  p.ty = anchorY
  p.rot = r() * TAU
  p.vrot = (r() - 0.5) * 0.02
  p.maxRadius = spec.sizePx[1]
  p.vx = 0
  p.vy = 0

  const speed = 0.05 + r() * 0.09 // px/ms 基准

  switch (spec.motion) {
    case 'radial-gravity': {
      // 放射溅出：偏上半球，随后由重力接管
      const a = -Math.PI * 0.9 + r() * Math.PI * 0.8
      p.vx = Math.cos(a) * speed * 2.2
      p.vy = Math.sin(a) * speed * 2.2
      break
    }
    case 'radial': {
      const a = r() * TAU
      p.vx = Math.cos(a) * speed * 1.8
      p.vy = Math.sin(a) * speed * 1.8
      break
    }
    case 'rise': {
      p.vx = (r() - 0.5) * speed * 0.9
      p.vy = -speed * (0.9 + r() * 0.8)
      break
    }
    case 'diffuse':
    case 'haze': {
      const a = r() * TAU
      p.vx = Math.cos(a) * speed * 0.28
      p.vy = Math.sin(a) * speed * 0.28 - 0.008
      break
    }
    case 'zigzag': {
      const a = r() * TAU
      p.vx = Math.cos(a) * speed * 3
      p.vy = Math.sin(a) * speed * 3
      break
    }
    case 'drift': {
      const a = r() * TAU
      p.vx = Math.cos(a) * speed * 0.5
      p.vy = Math.sin(a) * speed * 0.5
      break
    }
    case 'sink': {
      p.vx = (r() - 0.5) * speed * 0.5
      p.vy = speed * 0.35
      break
    }
    case 'ring-expand': {
      // 环：用 age 直接驱动半径，速度场闲置
      p.maxRadius = spec.sizePx[1]
      p.size = spec.sizePx[0]
      p.life = spec.lifeMs[0] + (index / Math.max(1, total)) * (spec.lifeMs[1] - spec.lifeMs[0])
      break
    }
    case 'cone': {
      // 定向扇形：以「朝右」为基准轴，张角由 coneDeg 给出
      const half = ((spec.coneDeg ?? 60) / 2) * (Math.PI / 180)
      const a = -half + (index / Math.max(1, total - 1)) * half * 2
      const sp = speed * (2.4 + r() * 1.2)
      p.vx = Math.cos(a) * sp
      p.vy = Math.sin(a) * sp
      break
    }
    case 'muzzle-puff': {
      p.vx = speed * (1.2 + r() * 0.6)
      p.vy = (r() - 0.5) * speed * 0.4
      break
    }
    case 'lift': {
      p.x = originX + (r() - 0.5) * 26
      p.vx = (r() - 0.5) * speed * 0.25
      p.vy = -speed * 0.45
      break
    }
    case 'press-down': {
      p.x = originX + (r() - 0.5) * 26
      p.vx = (r() - 0.5) * speed * 0.25
      p.vy = speed * 0.4
      break
    }
    case 'stream-to':
    case 'bounce-to': {
      p.x = originX + (r() - 0.5) * 18
      p.y = originY + (r() - 0.5) * 18
      break
    }
    case 'float-up': {
      p.x = originX + (r() - 0.5) * 180
      p.y = originY + r() * 40
      p.vx = (r() - 0.5) * speed * 0.3
      p.vy = -speed * (0.3 + r() * 0.4)
      break
    }
    case 'ground-puff': {
      const dir = r() < 0.5 ? -1 : 1
      p.vx = dir * speed * (0.9 + r() * 1.1)
      p.vy = -speed * (0.2 + r() * 0.3)
      break
    }
    case 'trail': {
      p.x = originX + (r() - 0.5) * 30
      p.y = originY + (r() - 0.5) * 10
      p.vx = (r() - 0.5) * speed * 0.2
      p.vy = -speed * 0.08
      break
    }
    case 'hold-jitter': {
      // 影子剪影：在人形轮廓上分布，只做 ±2px 浮动
      const t = index / Math.max(1, total)
      p.x = originX + Math.sin(t * TAU) * 12
      p.y = originY - 30 + t * 60
      break
    }
    case 'conduit': {
      // 长眠蓝光：从中心沿放射方向导出，扩散到 500px 上限内
      const a = r() * TAU
      p.vx = Math.cos(a) * speed * 4
      p.vy = Math.sin(a) * speed * 4
      p.rot = a
      p.vrot = 0
      break
    }
  }
}

// ---------------------------------------------------------------------------
// 积分：只改 x/y/rot，没有任何布局读写（§10.3 性能边界）
// ---------------------------------------------------------------------------
function stepParticle(p: Particle, dt: number) {
  const t = p.age / p.life
  switch (p.motion) {
    case 'radial-gravity': {
      p.vy += 0.00055 * dt // 重力
      p.x += p.vx * dt
      p.y += p.vy * dt
      break
    }
    case 'zigzag': {
      // 折线跳闪：每 ~40ms 折一次方向
      if (Math.floor(p.age / 40) !== Math.floor((p.age - dt) / 40)) {
        const a = Math.atan2(p.vy, p.vx) + (Math.random() - 0.5) * 2.2
        const sp = Math.hypot(p.vx, p.vy)
        p.vx = Math.cos(a) * sp
        p.vy = Math.sin(a) * sp
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      break
    }
    case 'drift': {
      p.vx += Math.sin((p.age + p.seed * 800) / 160) * 0.00035 * dt
      p.vy += Math.cos((p.age + p.seed * 800) / 190) * 0.00035 * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      break
    }
    case 'stream-to': {
      // 匀加速吸向锚点，越接近越快（导流感）
      const k = 0.0000075 * dt
      p.vx += (p.tx - p.x) * k
      p.vy += (p.ty - p.y) * k
      p.x += p.vx * dt
      p.y += p.vy * dt
      break
    }
    case 'bounce-to': {
      // 硬币：水平上以缓动吸向货币栏，竖直上叠一条正弦弧（先抛起再落入），
      // 同时绕自身翻面。弧高随剩余寿命衰减，落点精确收在锚点上。
      const k = 0.045 * (dt / 16)
      p.x += (p.tx - p.x) * k
      p.y += (p.ty - p.y) * k
      p.y -= Math.cos(t * Math.PI) * 0.022 * dt * (1 - t)
      p.rot += 0.012 * dt
      break
    }
    case 'ring-expand':
    case 'conduit': {
      p.x += p.vx * dt
      p.y += p.vy * dt
      break
    }
    case 'hold-jitter': {
      p.x += Math.sin((p.age + p.seed * 1200) / 320) * 0.008 * dt
      p.y += Math.cos((p.age + p.seed * 1200) / 380) * 0.008 * dt
      break
    }
    case 'trail': {
      p.x += p.vx * dt
      p.y += p.vy * dt
      break
    }
    default: {
      p.x += p.vx * dt
      p.y += p.vy * dt
      // 空气阻力，让 rise/diffuse/ground-puff 收束而不是无限飞出
      p.vx *= 1 - 0.0012 * dt
      p.vy *= 1 - 0.0012 * dt
    }
  }
  p.rot += p.vrot * dt
  p.age += dt
  if (p.age >= p.life) p.active = false
}

// ---------------------------------------------------------------------------
// 绘制：每个 shape 有独立绘制过程
// ---------------------------------------------------------------------------
function drawParticle(ctx: CanvasRenderingContext2D, p: Particle) {
  const t = Math.min(1, p.age / p.life)
  const color = colorAt(p.colors, t)
  // 统一的淡出律：前 15% 淡入，其余线性淡出，避免第一帧突然出现
  const alpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha))
  ctx.fillStyle = color
  ctx.strokeStyle = color

  switch (p.shape) {
    case 'dot': {
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size / 2, 0, TAU)
      ctx.fill()
      break
    }
    case 'dot-shrink': {
      ctx.beginPath()
      ctx.arc(p.x, p.y, (p.size / 2) * (1 - t * 0.8), 0, TAU)
      ctx.fill()
      break
    }
    case 'diamond': {
      const h = p.size / 2
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.beginPath()
      ctx.moveTo(0, -h)
      ctx.lineTo(h * 0.62, 0)
      ctx.lineTo(0, h)
      ctx.lineTo(-h * 0.62, 0)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
      break
    }
    case 'fog':
    case 'smoke': {
      const r = (p.size / 2) * (1 + t * 0.9)
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r)
      const [cr, cg, cb] = hexToRgb(p.colors[0])
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${p.shape === 'smoke' ? 0.5 : 0.62})`)
      g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, TAU)
      ctx.fill()
      break
    }
    case 'bolt': {
      // 电光：三段折线
      ctx.lineWidth = 1.6
      ctx.beginPath()
      const len = p.size
      const a = p.rot
      let x = p.x
      let y = p.y
      ctx.moveTo(x, y)
      for (let i = 0; i < 3; i++) {
        const ja = a + (((p.seed * 97 + i * 31) % 10) / 10 - 0.5) * 1.6
        x += Math.cos(ja) * (len / 3)
        y += Math.sin(ja) * (len / 3)
        ctx.lineTo(x, y)
      }
      ctx.stroke()
      break
    }
    case 'star': {
      ctx.lineWidth = 1.4
      const h = p.size / 2
      ctx.beginPath()
      ctx.moveTo(p.x - h, p.y); ctx.lineTo(p.x + h, p.y)
      ctx.moveTo(p.x, p.y - h); ctx.lineTo(p.x, p.y + h)
      ctx.stroke()
      break
    }
    case 'ring': {
      const r = p.size + t * (p.maxRadius - p.size)
      ctx.lineWidth = 2.5 * (1 - t * 0.6)
      ctx.beginPath()
      ctx.arc(p.x, p.y, Math.max(1, r), 0, TAU)
      ctx.stroke()
      break
    }
    case 'shard': {
      // 不规则碎片：用 seed 派生一个固定的四边形，避免每帧抖动
      const h = p.size / 2
      const j = (n: number) => 0.55 + ((p.seed * 1000 + n * 37) % 45) / 100
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.beginPath()
      ctx.moveTo(-h * j(0), -h * j(1))
      ctx.lineTo(h * j(2), -h * j(3))
      ctx.lineTo(h * j(4), h * j(5))
      ctx.lineTo(-h * j(6), h * j(7))
      ctx.closePath()
      ctx.fill()
      ctx.restore()
      break
    }
    case 'coin': {
      // 硬币：随 rot 翻面，宽度做余弦收缩
      const w = Math.abs(Math.cos(p.rot)) * (p.size / 2) + 0.8
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.beginPath()
      ctx.ellipse(0, 0, w, p.size / 2, 0, 0, TAU)
      ctx.fill()
      ctx.restore()
      break
    }
    case 'chip': {
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.fillRect(-p.size / 2, -p.size / 3, p.size, (p.size / 3) * 2)
      ctx.restore()
      break
    }
    case 'flame': {
      // 火苗：上窄下宽的水滴
      const h = p.size * (1 - t * 0.55)
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot * 0.1)
      ctx.beginPath()
      ctx.moveTo(0, -h)
      ctx.quadraticCurveTo(h * 0.55, -h * 0.1, 0, h * 0.6)
      ctx.quadraticCurveTo(-h * 0.55, -h * 0.1, 0, -h)
      ctx.fill()
      ctx.restore()
      break
    }
    case 'streak': {
      // 拖尾线段：沿运动方向拉长
      const a = p.motion === 'conduit' ? p.rot : Math.atan2(p.vy, p.vx)
      const len = p.size * (1 - t * 0.4)
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(p.x - Math.cos(a) * len, p.y - Math.sin(a) * len)
      ctx.stroke()
      break
    }
    case 'silhouette': {
      ctx.globalAlpha *= 0.6
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size / 2, 0, TAU)
      ctx.fill()
      break
    }
  }
  ctx.globalAlpha = 1
}

export type ParticleOrigin = {
  /** canvas 内的百分比坐标，0-100 */
  xPct: number
  yPct: number
}

export type ParticleFieldProps = {
  /** 要播放的令牌 id 列表（组合令牌会自动展开） */
  specIds: readonly string[]
  /** 变化即重放；同一个值不会重复触发 */
  playToken: number | string
  origin?: ParticleOrigin
  /** stream-to / bounce-to 的界面锚点（清醒条 / 货币栏） */
  anchor?: ParticleOrigin
  profile: 'standard' | 'reduced' | 'low'
  className?: string
  /** 循环令牌（影子大厅）持续补充，而不是一次 burst */
  loop?: boolean
}

/**
 * 粒子画布：playToken 变化时按令牌规格 burst 一次，池空后自动停 RAF。
 * 屏幕外（IntersectionObserver 不可见）时不更新，满足 §12「屏幕外不更新」。
 */
export function ParticleField({
  specIds,
  playToken,
  origin = { xPct: 50, yPct: 55 },
  anchor = { xPct: 88, yPct: 12 },
  profile,
  className = '',
  loop = false,
}: ParticleFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const poolRef = useRef<Particle[]>([])
  const rafRef = useRef<number | null>(null)
  const lastRef = useRef(0)
  const visibleRef = useRef(true)
  const loopRef = useRef<{ timer: number | null }>({ timer: null })

  // B7-05 §9：对象池预分配 128 槽位并复用，运行期禁止扩容（避免 GC 峰）。同屏激活由
  // PARTICLE_HARD_CAP(50) 单独限制——池比激活上限大，留出 burst 叠加时的复用余量，
  // 而不是让「找空位」在满负荷时频繁失败。
  if (poolRef.current.length === 0) {
    poolRef.current = Array.from({ length: PARTICLE_POOL_SIZE }, makeParticle)
  }

  const tick = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) {
      rafRef.current = null
      return
    }
    const now = performance.now()
    const dt = Math.min(48, now - lastRef.current) // 长帧夹紧，避免一次跳完整条寿命
    lastRef.current = now

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    let alive = 0
    if (visibleRef.current) {
      for (const p of poolRef.current) {
        if (!p.active) continue
        stepParticle(p, dt)
        if (p.active) {
          drawParticle(ctx, p)
          alive++
        }
      }
    } else {
      alive = poolRef.current.reduce((n, p) => n + (p.active ? 1 : 0), 0)
    }

    if (alive > 0) rafRef.current = requestAnimationFrame(tick)
    else rafRef.current = null
  }, [])

  const burst = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const w = canvas.width / (window.devicePixelRatio || 1)
    const h = canvas.height / (window.devicePixelRatio || 1)
    const ox = (origin.xPct / 100) * w
    const oy = (origin.yPct / 100) * h
    const ax = (anchor.xPct / 100) * w
    const ay = (anchor.yPct / 100) * h

    // 池现在有 128 槽位，但同屏激活仍必须 ≤ PARTICLE_HARD_CAP(50)。显式统计当前激活数，
    // 达到上限即停止生成——池大小与激活上限是两条独立约束。
    let activeCount = 0
    for (const p of poolRef.current) if (p.active) activeCount++

    const specs = specIds.flatMap((id) => expandParticleSpec(id))
    for (const spec of specs) {
      const count = particleCountFor(spec, profile)
      let spawned = 0
      for (let i = 0; i < count; i++) {
        if (activeCount >= PARTICLE_HARD_CAP) break
        // 对象池：找不到空位就停止（不做无界扩张）
        const free = poolRef.current.find((p) => !p.active)
        if (!free) break
        seedParticle(free, spec, ox, oy, ax, ay, i, count)
        activeCount++
        spawned++
      }
      if (spawned === 0 && count > 0) break
    }

    if (rafRef.current === null) {
      lastRef.current = performance.now()
      rafRef.current = requestAnimationFrame(tick)
    }
  }, [specIds, origin.xPct, origin.yPct, anchor.xPct, anchor.yPct, profile, tick])

  // 尺寸同步（DPR 感知），resize 时重设一次 backing store
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      const ctx = canvas.getContext('2d')
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  // 屏幕外不更新
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const io = new IntersectionObserver((entries) => {
      visibleRef.current = entries[0]?.isIntersecting ?? true
    })
    io.observe(canvas)
    return () => io.disconnect()
  }, [])

  // playToken 变化 → burst 一次。loop 令牌按寿命节奏补充。
  useEffect(() => {
    if (profile !== 'standard') {
      // reduced / low：不生成任何粒子，清空画布，结果交给文字/图标等价物
      for (const p of poolRef.current) p.active = false
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
      return
    }
    burst()
    if (!loop) return
    loopRef.current.timer = window.setInterval(burst, 1400)
    return () => {
      if (loopRef.current.timer !== null) window.clearInterval(loopRef.current.timer)
      loopRef.current.timer = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playToken, profile, loop])

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    },
    [],
  )

  return <canvas ref={canvasRef} className={`b7p-canvas ${className}`} aria-hidden="true" />
}

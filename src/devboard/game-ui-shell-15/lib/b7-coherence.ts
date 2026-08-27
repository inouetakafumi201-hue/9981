// B7-05 连贯性与性能工程引擎 —— 加载编排 / 分帧调度 / 池化的框架无关实现。
//
// 铁律（§13）：性能优化禁用「砍画面」。这里没有任何缩图/降分辨率/减粒子的逻辑——只做
// 「让既定 standard 画面跑得流畅」的调度与流水线。它解决的是一个工程事实：Web 上做高
// 流畅游戏时，传统引擎默认代劳的资源生命周期（预加载、异步解码、上传排队、内存预分配）
// 必须前端自己实现，否则素材会在进入画面那一刻才被发现与解码，出现「从上往下刷」的渐进
// 解码可见、长帧、GC 抖动。
//
// 全部为会话级单例，零新增依赖，只用浏览器原生能力（rAF / PerformanceObserver /
// createImageBitmap / img.decode）。所有浏览器 API 都做了 SSR 守卫与能力降级。

import { bitmapCache } from './bitmap-cache'
import { chromaKeySprite, chromaKeyCacheKey } from './chroma-key'
import { PARTICLE_HARD_CAP } from './b7-particles'

// ---------------------------------------------------------------------------
// §9 性能工程预算令牌（技术阈值，不受玩法数值铁律约束）
// ---------------------------------------------------------------------------
export const B7_PERF = {
  /** 每帧总预算（60fps） */
  frameBudgetMs: 16.7,
  /** 单帧内任务切片耗时上限——预算的 50%，另一半留给渲染合成 */
  taskSliceMs: 8,
  /** 分帧上传限额：每帧最多挂载/上传的大素材数 */
  uploadPerFrame: 2,
  /** RAIL 长任务阈值；目标关键路径为 0 */
  longTaskThresholdMs: 50,
  /** 粒子对象池预分配槽位（同屏激活 ≤ activeCap，池禁运行期扩容） */
  particlePoolSize: 128,
  /** 同屏激活粒子硬上限（沿用 B7-04） */
  particleActiveCap: PARTICLE_HARD_CAP,
  /** 解码产物 LRU 上限：等价 256MB 像素内存 */
  bitmapCacheBytes: 256 * 1024 * 1024,
  /** 演出前预取提前量 */
  prefetchLeadMs: 1000,
  /** 门槛超时 → 转读条原因显示 + 重试/安全返回 */
  gateTimeoutMs: 10000,
} as const

// ---------------------------------------------------------------------------
// §4 资源生命周期状态机
// ---------------------------------------------------------------------------
export type AssetLoadPhase =
  | 'unrequested'
  | 'prefetching'
  | 'fetching'
  | 'decoding'
  | 'upload-queued'
  | 'uploading'
  | 'ready'
  | 'mounted-visible'
  | 'pooled'
  | 'failed'

export const ASSET_PHASE_LABEL: Record<AssetLoadPhase, string> = {
  unrequested: '未请求',
  prefetching: '预取中',
  fetching: '传输中',
  decoding: '解码中',
  'upload-queued': '上传排队',
  uploading: '挂载中',
  ready: '就绪',
  'mounted-visible': '已入画',
  pooled: '回收池',
  failed: '失败',
}

// ---------------------------------------------------------------------------
// §6 只读投影 + 页面 → 资源清单映射（宿主提供，这里用 mock 演示真实 sprite 帧）
// ---------------------------------------------------------------------------
export interface CoherencePerformanceProjection {
  readonly eventId: string
  readonly pageId: string
  readonly revision: string
  readonly criticalAssetRefs: readonly string[]
  readonly deferredAssetRefs: readonly string[]
  readonly performanceProfile: 'standard' | 'reduced-motion' | 'low'
  readonly source: 'mock' | 'projection'
}

export interface PageAssetManifest {
  readonly label: string
  /** 门槛必查：揭幕前必须 100% ready */
  readonly critical: readonly string[]
  /** 可后挂但不许闪 */
  readonly deferred: readonly string[]
}

const DET = '/games/menu/detective'

// 用真实存在的 sprite 帧构造清单，预取/解码是真做 fetch + chroma-key 工作，不是空转。
export const COHERENCE_MANIFEST: Record<string, PageAssetManifest> = {
  residence: {
    label: '驻地',
    critical: [`${DET}/f01.png`, `${DET}/f02.png`, `${DET}/portrait-detective.png`],
    deferred: [`${DET}/f03.png`, `${DET}/f04.png`],
  },
  battle: {
    label: '对局',
    critical: [`${DET}/f05.png`, `${DET}/f06.png`, `${DET}/f07.png`],
    deferred: [`${DET}/f08.png`, `${DET}/f09.png`, `${DET}/f10.png`],
  },
  'ceremony-climb': {
    label: '翻窗越进仪式',
    critical: [`${DET}/f07.png`, `${DET}/f08.png`],
    deferred: [],
  },
  'ceremony-sleep': {
    label: '长眠仪式',
    critical: [`${DET}/f11.png`, `${DET}/f12.png`],
    deferred: [],
  },
  result: {
    label: '终局结算',
    critical: [`${DET}/f13.png`, `${DET}/f14.png`],
    deferred: [`${DET}/f15.png`, `${DET}/f16.png`],
  },
  // 故意缺资源的验收 fixture：这个路径不存在，fetch/decode 必失败 → 门槛永不开 →
  // 验证 fallback-path 不等待、门槛超时给出可读原因（B7-05 §15）。
  'fixture-missing': {
    label: '缺资源验收场景',
    critical: [`${DET}/__does-not-exist__.png`],
    deferred: [],
  },
}

export const COHERENCE_PAGE_ORDER: readonly string[] = [
  'residence',
  'battle',
  'ceremony-climb',
  'ceremony-sleep',
  'result',
  'fixture-missing',
]

export function coherenceProjectionFor(
  pageId: string,
  performanceProfile: CoherencePerformanceProjection['performanceProfile'] = 'standard',
): CoherencePerformanceProjection {
  const manifest = COHERENCE_MANIFEST[pageId]
  return {
    eventId: `coh-${pageId}`,
    pageId,
    revision: 'mock-rev',
    criticalAssetRefs: manifest?.critical ?? [],
    deferredAssetRefs: manifest?.deferred ?? [],
    performanceProfile,
    source: 'mock',
  }
}

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------
type Listener = () => void

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

const canRaf = () => typeof requestAnimationFrame !== 'undefined'

// ===========================================================================
// §5 TimeSlicingTaskQueue —— 每帧预算任务调度，超限顺延保序
// ===========================================================================
export type TaskPriority = 'input' | 'high' | 'normal' | 'low'

const PRIORITY_RANK: Record<TaskPriority, number> = { input: 0, high: 1, normal: 2, low: 3 }

interface ScheduledTask {
  readonly id: string
  readonly run: () => void
  readonly rank: number
}

/**
 * rAF 驱动的分帧任务队列：单帧内累计执行不超过 `taskSliceMs`(8ms)，超预算的任务顺延
 * 下一帧且保持入队顺序。input 优先级插到队首——真实输入事件本就由浏览器先于 rAF 派发，
 * 8ms 切片又把每帧余下的时间让给合成与输入处理，所以后台解码/上传不会阻塞输入（§11）。
 */
export class TimeSlicingScheduler {
  private readonly queue: ScheduledTask[] = []
  private rafId: number | null = null
  private seq = 0

  ranLastFrame = 0
  yieldedLastFrame = 0
  peakDepth = 0
  totalRun = 0
  totalYieldFrames = 0
  lastSliceMs = 0
  version = 0

  private readonly listeners = new Set<Listener>()

  enqueue(run: () => void, priority: TaskPriority = 'normal', id?: string): string {
    const rank = PRIORITY_RANK[priority]
    const task: ScheduledTask = { id: id ?? `t${(this.seq++).toString(36)}`, run, rank }
    // 按 rank 升序插入（同 rank 保持先进先出）→ 高优先级先跑，同级保序
    let i = this.queue.length
    while (i > 0 && this.queue[i - 1].rank > rank) i--
    this.queue.splice(i, 0, task)
    if (this.queue.length > this.peakDepth) this.peakDepth = this.queue.length
    this.ensureRaf()
    this.emit()
    return task.id
  }

  get depth(): number {
    return this.queue.length
  }

  private ensureRaf(): void {
    if (this.rafId !== null || !canRaf()) return
    this.rafId = requestAnimationFrame(this.frame)
  }

  private frame = (): void => {
    this.rafId = null
    const budget = B7_PERF.taskSliceMs
    const start = now()
    let ran = 0
    // 热路径：不分配对象/闭包，shift 出队后直接执行
    while (this.queue.length > 0 && now() - start < budget) {
      const task = this.queue.shift() as ScheduledTask
      try {
        task.run()
      } catch {
        // 单个任务异常不拖垮整帧队列
      }
      ran++
    }
    this.lastSliceMs = Math.round((now() - start) * 100) / 100
    this.ranLastFrame = ran
    this.totalRun += ran
    this.yieldedLastFrame = this.queue.length
    if (this.queue.length > 0) {
      this.totalYieldFrames++
      this.ensureRaf()
    }
    this.emit()
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(): void {
    this.version++
    for (const l of this.listeners) l()
  }
}

export const scheduler = new TimeSlicingScheduler()

// ===========================================================================
// §5 FrameUploadQueue —— 分帧上传：每帧最多 uploadPerFrame 个大素材挂载
// ===========================================================================
/**
 * 素材从「解码完成」到「插入 DOM / 上传 GPU」这一步集中发生会造成一次布局/上传 burst。
 * 这里把挂载动作排队，每帧只释放 `uploadPerFrame`(2) 个，其余顺延——单帧上传量有界，
 * 可由 lastBatch 水位验收（§15）。
 */
export class FrameUploadQueue {
  private readonly queue: Array<() => void> = []
  private rafId: number | null = null

  peakDepth = 0
  totalUploaded = 0
  lastBatch = 0
  version = 0

  private readonly listeners = new Set<Listener>()

  enqueue(mount: () => void): void {
    this.queue.push(mount)
    if (this.queue.length > this.peakDepth) this.peakDepth = this.queue.length
    this.ensureRaf()
    this.emit()
  }

  get depth(): number {
    return this.queue.length
  }

  private ensureRaf(): void {
    if (this.rafId !== null || !canRaf()) {
      // rAF 不可用（SSR/测试）：同步兜底，避免 Promise 永挂
      if (!canRaf()) this.drainSync()
      return
    }
    this.rafId = requestAnimationFrame(this.frame)
  }

  private drainSync(): void {
    while (this.queue.length > 0) {
      const mount = this.queue.shift() as () => void
      try {
        mount()
      } catch {
        /* noop */
      }
    }
  }

  private frame = (): void => {
    this.rafId = null
    let n = 0
    while (this.queue.length > 0 && n < B7_PERF.uploadPerFrame) {
      const mount = this.queue.shift() as () => void
      try {
        mount()
      } catch {
        /* noop */
      }
      n++
    }
    this.lastBatch = n
    this.totalUploaded += n
    if (this.queue.length > 0) this.ensureRaf()
    this.emit()
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(): void {
    this.version++
    for (const l of this.listeners) l()
  }
}

export const uploadQueue = new FrameUploadQueue()

// ===========================================================================
// §5 LongTaskMonitor —— PerformanceObserver longtask + 帧率采样（仅诊断）
// ===========================================================================
export interface LongTaskRecord {
  readonly start: number
  readonly duration: number
}

export class LongTaskMonitor {
  longTaskCount = 0
  worstMs = 0
  fps = 60
  readonly records: LongTaskRecord[] = []
  version = 0

  private observer: PerformanceObserver | null = null
  private rafId: number | null = null
  private frames = 0
  private lastSample = 0
  private started = false

  private readonly listeners = new Set<Listener>()

  start(): void {
    if (this.started || typeof window === 'undefined') return
    this.started = true

    try {
      if ('PerformanceObserver' in window) {
        this.observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            this.longTaskCount++
            const dur = Math.round(entry.duration)
            if (dur > this.worstMs) this.worstMs = dur
            this.records.push({ start: Math.round(entry.startTime), duration: dur })
            if (this.records.length > 32) this.records.shift()
          }
          this.emit()
        })
        this.observer.observe({ entryTypes: ['longtask'] })
      }
    } catch {
      // longtask 不被支持：帧率采样仍可工作
    }

    if (canRaf()) {
      this.lastSample = now()
      const loop = (): void => {
        this.frames++
        const t = now()
        if (t - this.lastSample >= 1000) {
          this.fps = Math.round((this.frames * 1000) / (t - this.lastSample))
          this.frames = 0
          this.lastSample = t
          this.emit()
        }
        this.rafId = requestAnimationFrame(loop)
      }
      this.rafId = requestAnimationFrame(loop)
    }
  }

  reset(): void {
    this.longTaskCount = 0
    this.worstMs = 0
    this.records.length = 0
    this.emit()
  }

  stop(): void {
    this.observer?.disconnect()
    this.observer = null
    if (this.rafId !== null && canRaf()) cancelAnimationFrame(this.rafId)
    this.rafId = null
    this.started = false
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(): void {
    this.version++
    for (const l of this.listeners) l()
  }
}

export const longTaskMonitor = new LongTaskMonitor()

// ===========================================================================
// §5 PreloadScheduler + DecodePipeline —— 预取编排与三段流水线
// ===========================================================================
/**
 * 每个素材实例走 fetch → decode → upload-queued → ready 的三段生命周期。真正的像素解码
 * 复用 chroma-key（内部已 createImageBitmap/decode + 写 LRU），这里在其两端记录阶段并把
 * 「挂载」这步塞进 FrameUploadQueue（每帧限额），使阶段可被投影读出、可被门槛断言。
 */
export class PreloadScheduler {
  private readonly phase = new Map<string, AssetLoadPhase>()
  private readonly promises = new Map<string, Promise<AssetLoadPhase>>()
  version = 0

  private readonly listeners = new Set<Listener>()

  getPhase(ref: string): AssetLoadPhase {
    // 已在缓存里（可能被别处解码过）→ 视作 ready
    if (this.phase.get(ref) === undefined && bitmapCache.has(chromaKeyCacheKey(ref))) return 'ready'
    return this.phase.get(ref) ?? 'unrequested'
  }

  isReady(ref: string): boolean {
    return this.getPhase(ref) === 'ready' || this.getPhase(ref) === 'mounted-visible'
  }

  private setPhase(ref: string, p: AssetLoadPhase): void {
    this.phase.set(ref, p)
    this.emit()
  }

  /** 预取单个素材；重复调用共享同一 Promise（幂等）。 */
  prefetch(ref: string, priority: TaskPriority = 'high'): Promise<AssetLoadPhase> {
    if (this.isReady(ref)) return Promise.resolve('ready')
    const existing = this.promises.get(ref)
    if (existing) return existing
    const p = this.run(ref, priority)
    this.promises.set(ref, p)
    return p
  }

  private async run(ref: string, priority: TaskPriority): Promise<AssetLoadPhase> {
    this.setPhase(ref, 'prefetching')
    // 让解码工作排进分帧调度（低优先级不与输入争抢），再进入实际解码
    await new Promise<void>((resolve) => scheduler.enqueue(resolve, priority))
    this.setPhase(ref, 'fetching')
    try {
      this.setPhase(ref, 'decoding')
      const url = await chromaKeySprite(ref)
      // 解码失败时 chroma-key 会把原始 src 原样返回（catch 分支）。用缓存是否真正落盘
      // 判断成败：LRU 里有该 key 才算解码成功。
      if (!bitmapCache.has(chromaKeyCacheKey(ref)) || url === ref) {
        this.setPhase(ref, 'failed')
        this.promises.delete(ref)
        return 'failed'
      }
      // 挂载段：进分帧上传队列，每帧限额释放
      this.setPhase(ref, 'upload-queued')
      await new Promise<void>((resolve) =>
        uploadQueue.enqueue(() => {
          this.setPhase(ref, 'uploading')
          resolve()
        }),
      )
      this.setPhase(ref, 'ready')
      return 'ready'
    } catch {
      this.setPhase(ref, 'failed')
      this.promises.delete(ref)
      return 'failed'
    }
  }

  /** 页面级预取：关键资源高优先级并行，装饰资源低优先级后挂。 */
  prefetchPage(pageId: string): Promise<AssetLoadPhase[]> {
    const manifest = COHERENCE_MANIFEST[pageId]
    if (!manifest) return Promise.resolve([])
    for (const ref of manifest.deferred) this.prefetch(ref, 'low')
    return Promise.all(manifest.critical.map((ref) => this.prefetch(ref, 'high')))
  }

  progress(refs: readonly string[]): { ready: number; total: number; failed: number } {
    let ready = 0
    let failed = 0
    for (const r of refs) {
      const p = this.getPhase(r)
      if (p === 'ready' || p === 'mounted-visible') ready++
      else if (p === 'failed') failed++
    }
    return { ready, total: refs.length, failed }
  }

  /** 回收：把素材标记为 pooled（LRU 仍可能保活其解码产物）。 */
  recycle(refs: readonly string[]): void {
    for (const r of refs) if (this.phase.has(r)) this.setPhase(r, 'pooled')
  }

  /** 测试/演示复位：清空阶段追踪（不清 LRU；缓存自有 LRU 生命周期）。 */
  resetPhases(refs?: readonly string[]): void {
    if (refs) for (const r of refs) this.phase.delete(r), this.promises.delete(r)
    else {
      this.phase.clear()
      this.promises.clear()
    }
    this.emit()
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(): void {
    this.version++
    for (const l of this.listeners) l()
  }
}

export const preloadScheduler = new PreloadScheduler()

// ===========================================================================
// §5 SceneReadinessGate —— 关键资源 ready 门槛；演出前置断言
// ===========================================================================
export interface GateResult {
  readonly open: boolean
  readonly pending: readonly string[]
  readonly failed: readonly string[]
  readonly reason: string
}

export class SceneReadinessGate {
  /** 同步检查：不发起加载，只读当前阶段——给演出触发前的即时断言用（不等待）。 */
  check(refs: readonly string[]): GateResult {
    const pending: string[] = []
    const failed: string[] = []
    for (const r of refs) {
      const p = preloadScheduler.getPhase(r)
      if (p === 'failed') failed.push(r)
      else if (p !== 'ready' && p !== 'mounted-visible') pending.push(r)
    }
    const open = pending.length === 0 && failed.length === 0
    const reason = open
      ? '全部关键素材就绪'
      : failed.length > 0
        ? `${failed.length} 项素材加载失败 → 走程序化 fallback`
        : `${pending.length} 项关键素材未就绪`
    return { open, pending, failed, reason }
  }

  /**
   * 揭幕门槛：发起预取并等到全部关键资源 ready，或到 `gateTimeoutMs` 超时。
   * 超时不伪造完成——返回 'timeout'，调用方保持读条 + 显示原因 + 重试/安全返回。
   */
  async awaitGate(refs: readonly string[], timeoutMs: number = B7_PERF.gateTimeoutMs): Promise<'open' | 'timeout' | 'failed'> {
    if (refs.length === 0) return 'open'
    const all = Promise.all(refs.map((r) => preloadScheduler.prefetch(r))).then((phases) =>
      phases.some((p) => p === 'failed') ? ('failed' as const) : ('open' as const),
    )
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs))
    const outcome = await Promise.race([all, timeout])
    if (outcome === 'timeout') return 'timeout'
    return this.check(refs).open ? 'open' : 'failed'
  }
}

export const sceneReadinessGate = new SceneReadinessGate()

'use client'

// B7-05 §15 连贯性与性能工程验收台。
//
// 存在理由：加载编排、分帧调度、池化这些「工程事实」如果没有可观测入口，就无法验收
// 「素材是否真的在揭幕前 ready」「任务是否真的分帧不阻塞输入」「内存是否真的有界」。
// 这里把引擎单例的实时状态摊开成可交互卡片，每条 §15 验收项都能当场点出来看。
// 全程不碰任何画面规格——这是调度与诊断，不是视觉。

import { useCallback, useRef, useState } from 'react'
import {
  Activity,
  Boxes,
  Clock,
  Cpu,
  Database,
  Download,
  Gauge,
  ImageOff,
  RotateCcw,
  ShieldCheck,
  Upload,
  Zap,
} from 'lucide-react'
import {
  B7_PERF,
  ASSET_PHASE_LABEL,
  COHERENCE_MANIFEST,
  COHERENCE_PAGE_ORDER,
  type AssetLoadPhase,
} from '@/lib/b7-coherence'
import {
  preloadScheduler,
  sceneReadinessGate,
  scheduler,
  longTaskMonitor,
  useAssetPhases,
  useBitmapCacheStats,
  useLongTaskMonitor,
  useSchedulerStats,
  useUploadQueueStats,
} from '@/hooks/use-coherence'

type Profile = 'standard' | 'reduced' | 'low'

const PHASE_TONE: Record<AssetLoadPhase, string> = {
  unrequested: 'idle',
  prefetching: 'work',
  fetching: 'work',
  decoding: 'work',
  'upload-queued': 'work',
  uploading: 'work',
  ready: 'ok',
  'mounted-visible': 'ok',
  pooled: 'idle',
  failed: 'bad',
}

function shortRef(ref: string): string {
  return ref.replace('/games/menu/detective/', '')
}

function mb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)}MB`
}

export function B7CoherencePanel({ profile }: { profile: Profile }) {
  // ---- 加载编排 + 场景就绪门槛 ----
  const [pageId, setPageId] = useState<string>(COHERENCE_PAGE_ORDER[0])
  const manifest = COHERENCE_MANIFEST[pageId]
  const refs = [...manifest.critical, ...manifest.deferred]
  const { phases, progress } = useAssetPhases(refs)
  const critProgress = useAssetPhases(manifest.critical).progress

  const [gate, setGate] = useState<{ state: 'idle' | 'checking' | 'open' | 'timeout' | 'failed'; reason: string }>({
    state: 'idle',
    reason: '未揭幕 · 关键资源就绪前不揭幕',
  })
  const [live, setLive] = useState('性能验收台待命')

  const prefetch = useCallback(() => {
    setLive(`${manifest.label}：开始预取 ${manifest.critical.length} 项关键 + ${manifest.deferred.length} 项装饰素材`)
    void preloadScheduler.prefetchPage(pageId)
  }, [manifest.label, manifest.critical.length, manifest.deferred.length, pageId])

  const openGate = useCallback(async () => {
    setGate({ state: 'checking', reason: '门槛校验中 · 等待关键资源 100% ready' })
    setLive(`${manifest.label}：门槛校验中`)
    const outcome = await sceneReadinessGate.awaitGate(manifest.critical, B7_PERF.gateTimeoutMs)
    const result = sceneReadinessGate.check(manifest.critical)
    if (outcome === 'open') {
      setGate({ state: 'open', reason: '门槛通过 → 揭幕（全部关键素材就绪，无边播边刷）' })
      setLive(`${manifest.label}：门槛通过，揭幕`)
    } else if (outcome === 'failed') {
      setGate({ state: 'failed', reason: result.reason })
      setLive(`${manifest.label}：素材缺失 → 走程序化 fallback，不等待`)
    } else {
      setGate({ state: 'timeout', reason: `门槛超时（${B7_PERF.gateTimeoutMs}ms）· ${result.reason}` })
      setLive(`${manifest.label}：门槛超时，保持读条`)
    }
  }, [manifest.label, manifest.critical])

  // 门槛超时演示：在尚未预取时用极短超时触发 timeout 分支，暴露重试 / 安全返回 UI。
  const forceTimeout = useCallback(async () => {
    preloadScheduler.resetPhases(manifest.critical)
    setGate({ state: 'checking', reason: '门槛校验中（1ms 超时演示）' })
    const outcome = await sceneReadinessGate.awaitGate(manifest.critical, 1)
    if (outcome === 'timeout') {
      setGate({
        state: 'timeout',
        reason: `门槛超时 · ${sceneReadinessGate.check(manifest.critical).pending.length} 项未就绪 → 保持读条，提供重试/安全返回`,
      })
      setLive(`${manifest.label}：门槛超时，提供重试与安全返回`)
    }
  }, [manifest.label, manifest.critical])

  const safeReturn = useCallback(() => {
    preloadScheduler.resetPhases(refs)
    setGate({ state: 'idle', reason: '已安全返回 · 加载位复位，未伪造任何完成数据' })
    setLive('已安全返回上一稳定态')
  }, [refs])

  // ---- 帧预算 / 分帧调度 ----
  const [floodDone, setFloodDone] = useState(0)
  const [inputEcho, setInputEcho] = useState('')
  const sched = useSchedulerStats()
  const flood = useCallback((count: number) => {
    setFloodDone(0)
    for (let i = 0; i < count; i++) {
      scheduler.enqueue(() => {
        // 每个任务 ~1ms 的合成型忙活：分帧队列会把它们切成每帧 ≤8ms 的片，超限顺延
        const end = performance.now() + 1
        let x = 0
        while (performance.now() < end) x += Math.sqrt(x + 1)
        if (x === -1) console.log('[v0] unreachable')
        setFloodDone((n) => n + 1)
      }, 'normal')
    }
    setLive(`已灌入 ${count} 个任务 · 分帧队列每帧切片 ≤${B7_PERF.taskSliceMs}ms，输入不受阻`)
  }, [])

  // ---- 长任务监控 ----
  const lt = useLongTaskMonitor(true)
  const makeLongTask = useCallback(() => {
    // 故意在主线程同步阻塞 ~60ms（超 RAIL 50ms 阈值）→ 证明监控能抓到长任务。
    // 对照组：上面的 flood 走分帧队列，关键路径为 0 longtask。
    const end = performance.now() + 60
    let x = 0
    while (performance.now() < end) x += Math.sqrt(x + 1)
    if (x === -1) console.log('[v0] unreachable')
    setLive('已制造一次 ~60ms 主线程长任务（对照组：分帧队列不产生 longtask）')
  }, [])

  // ---- 池水位 ----
  const upload = useUploadQueueStats()
  const cache = useBitmapCacheStats()

  const gateToneClass =
    gate.state === 'open' ? 'is-ok' : gate.state === 'failed' || gate.state === 'timeout' ? 'is-bad' : gate.state === 'checking' ? 'is-work' : ''

  return (
    <div className="b7coh" data-profile={profile}>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {live}
      </div>

      <header className="b7coh-head">
        <div>
          <small>DEV://COHERENCE.PERF</small>
          <b>连贯性与性能工程 · 加载编排 / 分帧 / 池化</b>
        </div>
        <p>性能优化禁用「砍画面」。此台只做调度与诊断——standard 视觉规格原样保留，三档加载编排一致（都 ready 才揭幕）。</p>
      </header>

      <div className="b7coh-grid">
        {/* 1 · 加载编排 + 场景就绪门槛 */}
        <section className="b7coh-card b7coh-span2">
          <h4><Download size={13} /> 加载编排 · 三段流水线（fetch → decode → 分帧挂载 → ready）</h4>
          <div className="b7coh-pagerow">
            <label>
              页面
              <select value={pageId} onChange={(e) => { setPageId(e.target.value); setGate({ state: 'idle', reason: '未揭幕 · 关键资源就绪前不揭幕' }) }}>
                {COHERENCE_PAGE_ORDER.map((id) => (
                  <option key={id} value={id}>{COHERENCE_MANIFEST[id].label}</option>
                ))}
              </select>
            </label>
            <button type="button" className="b7coh-btn" onClick={prefetch}><Download size={12} /> 预取本页素材</button>
            <button type="button" className="b7coh-btn is-primary" onClick={openGate}><ShieldCheck size={12} /> 请求揭幕（门槛）</button>
          </div>

          <div className="b7coh-progress" aria-hidden="true">
            <i style={{ width: `${progress.total ? (progress.ready / progress.total) * 100 : 0}%` }} />
          </div>
          <div className="b7coh-progress-label">
            关键 {critProgress.ready}/{critProgress.total} 就绪
            {critProgress.failed > 0 && <em className="is-bad"> · {critProgress.failed} 失败</em>}
            <span> · 全部 {progress.ready}/{progress.total}</span>
          </div>

          <ul className="b7coh-assets">
            {refs.map((ref) => {
              const ph = phases[ref] ?? 'unrequested'
              const isCritical = manifest.critical.includes(ref)
              return (
                <li key={ref} className={`is-${PHASE_TONE[ph]}`}>
                  <span className="b7coh-asset-name">{shortRef(ref)}{isCritical && <b title="关键资源">*</b>}</span>
                  <span className="b7coh-phase">{ASSET_PHASE_LABEL[ph]}</span>
                </li>
              )
            })}
          </ul>

          <div className={`b7coh-gate ${gateToneClass}`}>
            <div className="b7coh-gate-state">
              {gate.state === 'open' && <ShieldCheck size={13} />}
              {(gate.state === 'failed' || gate.state === 'timeout') && <ImageOff size={13} />}
              {gate.state === 'checking' && <Clock size={13} />}
              <b>SceneReadinessGate · {gate.state.toUpperCase()}</b>
            </div>
            <p>{gate.reason}</p>
            <div className="b7coh-gate-actions">
              <button type="button" onClick={forceTimeout}><Clock size={11} /> 模拟门槛超时</button>
              {(gate.state === 'timeout' || gate.state === 'failed') && (
                <>
                  <button type="button" className="is-primary" onClick={openGate}><RotateCcw size={11} /> 重试</button>
                  <button type="button" onClick={safeReturn}>安全返回</button>
                </>
              )}
            </div>
          </div>
          <p className="b7coh-note">
            <b>*</b> 关键资源；带 <code>fixture-missing</code> 页可验证素材缺失 → 门槛判 <code>failed</code> → 立即走程序化 fallback，不边播边刷、不等待。
          </p>
        </section>

        {/* 2 · 帧预算 / 分帧调度 */}
        <section className="b7coh-card">
          <h4><Cpu size={13} /> 帧预算 · 分帧调度（time-slicing）</h4>
          <div className="b7coh-stats">
            <div><small>本帧切片</small><b className={sched.lastSliceMs > B7_PERF.taskSliceMs ? 'is-bad' : 'is-ok'}>{sched.lastSliceMs}ms</b><em>上限 {B7_PERF.taskSliceMs}ms</em></div>
            <div><small>队列深度</small><b>{sched.depth}</b><em>峰值 {sched.peakDepth}</em></div>
            <div><small>本帧执行</small><b>{sched.ranLastFrame}</b><em>顺延 {sched.yieldedLastFrame}</em></div>
            <div><small>完成任务</small><b>{floodDone}</b><em>顺延帧 {sched.totalYieldFrames}</em></div>
          </div>
          <div className="b7coh-btnrow">
            <button type="button" className="b7coh-btn" onClick={() => flood(240)}><Zap size={12} /> 灌入 240 任务</button>
            <button type="button" className="b7coh-btn" onClick={() => flood(600)}><Zap size={12} /> 灌入 600 任务</button>
          </div>
          <label className="b7coh-inputtest">
            输入响应对照（灌任务时在这里打字，不卡顿即证明输入未被后台任务阻塞）
            <input value={inputEcho} onChange={(e) => setInputEcho(e.target.value)} placeholder="在任务洪流中输入…" />
          </label>
        </section>

        {/* 3 · 长任务监控 */}
        <section className="b7coh-card">
          <h4><Gauge size={13} /> 长任务监控（PerformanceObserver · 仅诊断）</h4>
          <div className="b7coh-stats">
            <div><small>帧率</small><b className={lt.fps >= 55 ? 'is-ok' : lt.fps >= 40 ? 'is-work' : 'is-bad'}>{lt.fps}</b><em>fps</em></div>
            <div><small>长任务数</small><b className={lt.longTaskCount === 0 ? 'is-ok' : 'is-bad'}>{lt.longTaskCount}</b><em>&gt;{B7_PERF.longTaskThresholdMs}ms</em></div>
            <div><small>最差帧</small><b>{lt.worstMs}ms</b><em>RAIL 50ms</em></div>
          </div>
          <div className="b7coh-btnrow">
            <button type="button" className="b7coh-btn is-warn" onClick={makeLongTask}><Activity size={12} /> 制造 60ms 长任务</button>
            <button type="button" className="b7coh-btn" onClick={lt.reset}><RotateCcw size={12} /> 复位</button>
          </div>
          <p className="b7coh-note">分帧队列（左卡）走关键路径为 0 longtask；此处的红色计数来自故意的主线程阻塞对照组。</p>
        </section>

        {/* 4 · 分帧上传队列 */}
        <section className="b7coh-card">
          <h4><Upload size={13} /> 分帧上传队列（挂载限额）</h4>
          <div className="b7coh-stats">
            <div><small>本帧挂载</small><b className={upload.lastBatch > B7_PERF.uploadPerFrame ? 'is-bad' : 'is-ok'}>{upload.lastBatch}</b><em>上限 {B7_PERF.uploadPerFrame}/帧</em></div>
            <div><small>队列深度</small><b>{upload.depth}</b><em>峰值 {upload.peakDepth}</em></div>
            <div><small>累计上传</small><b>{upload.totalUploaded}</b><em>件</em></div>
          </div>
          <p className="b7coh-note">每个解码完成的素材都经此队列挂载，单帧释放不超过 {B7_PERF.uploadPerFrame} 件，避免一次挂载 burst 造成长帧。</p>
        </section>

        {/* 5 · 池水位 */}
        <section className="b7coh-card b7coh-span2">
          <h4><Database size={13} /> 内存池水位（解码 LRU + 粒子对象池）</h4>
          <div className="b7coh-poolrow">
            <div className="b7coh-pool">
              <div className="b7coh-pool-head"><Database size={12} /> BitmapCachePool（解码产物 LRU）</div>
              <div className="b7coh-bar"><i style={{ width: `${Math.min(100, cache.fill * 100)}%` }} /></div>
              <div className="b7coh-pool-stats">
                <span>{mb(cache.bytesInUse)} / {mb(cache.limitBytes)}</span>
                <span>{cache.entryCount} 条</span>
                <span>回收 {cache.evictions}</span>
                <span>命中 {cache.hits}/{cache.hits + cache.misses}</span>
              </div>
            </div>
            <div className="b7coh-pool">
              <div className="b7coh-pool-head"><Boxes size={12} /> ParticlePool（预分配槽位）</div>
              <div className="b7coh-bar"><i style={{ width: `${(B7_PERF.particleActiveCap / B7_PERF.particlePoolSize) * 100}%` }} /></div>
              <div className="b7coh-pool-stats">
                <span>预分配 {B7_PERF.particlePoolSize} 槽</span>
                <span>同屏激活 ≤{B7_PERF.particleActiveCap}</span>
                <span>运行期零扩容</span>
              </div>
            </div>
          </div>
          <p className="b7coh-note">LRU 上限 256MB 等价像素内存，超限回收最旧 → 会话内解码内存有界、无单调增长；粒子池一次性预分配、热路径零对象分配。</p>
        </section>

        {/* 6 · 预算令牌表 */}
        <section className="b7coh-card b7coh-span2">
          <h4><Clock size={13} /> 性能工程预算令牌（§9）</h4>
          <div className="b7coh-tokens">
            <div><code>frameBudgetMs</code><b>{B7_PERF.frameBudgetMs}</b><span>每帧总预算（60fps）</span></div>
            <div><code>taskSliceMs</code><b>{B7_PERF.taskSliceMs}</b><span>单帧任务切片上限（预算 50%）</span></div>
            <div><code>uploadPerFrame</code><b>{B7_PERF.uploadPerFrame}</b><span>分帧上传限额</span></div>
            <div><code>longTaskThresholdMs</code><b>{B7_PERF.longTaskThresholdMs}</b><span>RAIL 长任务阈值（目标 0）</span></div>
            <div><code>particlePoolSize</code><b>{B7_PERF.particlePoolSize}</b><span>粒子池槽位（激活 ≤{B7_PERF.particleActiveCap}）</span></div>
            <div><code>bitmapCacheLimit</code><b>256MB</b><span>解码 LRU 等价像素内存上限</span></div>
            <div><code>prefetchLeadMs</code><b>{B7_PERF.prefetchLeadMs}</b><span>演出前预取提前量</span></div>
            <div><code>gateTimeoutMs</code><b>{B7_PERF.gateTimeoutMs}</b><span>门槛超时 → 读条原因 + 重试/安全返回</span></div>
          </div>
        </section>
      </div>
    </div>
  )
}

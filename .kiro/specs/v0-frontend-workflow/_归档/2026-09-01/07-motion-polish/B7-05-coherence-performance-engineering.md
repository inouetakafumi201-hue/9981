# B7-05 连贯性与性能工程（加载编排 / 分帧 / 池化）

## 1 页面定位

这是 B7 的连贯性与性能工程 brief。它不新增任何视觉设计，专门解决一个工程事实：用 Web 技术做高流畅游戏时，传统游戏引擎默认代劳的资源生命周期管理（预加载、异步解码、显存上传排队、内存预分配）必须由前端自己完成。现状问题：素材在进入画面时才被发现与解码，出现「图片从上往下刷下来」的渐进解码可见现象；重活挤在主线程造成长帧；高频分配造成 GC 抖动。无论机器多好，这些问题都会让画面违和。

本 brief 的铁律：**性能优化禁用「砍画面」手段**。不许缩图、不许降分辨率、不许削减 standard 档的粒子与特效来掩盖工程缺陷。`reduced-motion` 与 `low` 档是既定的可访问性/降级策略，与性能工程无关；standard 档的视觉规格（B7-01/03/04 定义）原样保留，本 brief 只负责让它跑得流畅。配方仍只消费已确认 `resultSnapshot`/projection；一切加载与调度失败收敛到同一 `settled` 结果，不改变规则。

## 2 权威来源

- `attachmentId: "presentation-animation-feedback-02"`
  `provenance: "docs/表现系统/02_动画音效与反馈.md；§十一性能策略（批量绘制/图集/屏幕外暂停/实例池化/降级不删规则反馈）与验收不变量"`
- `attachmentId: "presentation-motion-index-03"`
  `provenance: "docs/表现系统/03_动画灵感索.md；粒子池化、屏幕外不更新、图集减少纹理切换"`
- `attachmentId: "presentation-motion-checklist-12"`
  `provenance: "docs/表现系统/12_动态图形化设计清单（V0迁移准备）.md；页面切换 <100ms、60fps、动画超时降级"`
- `attachmentId: "global-motion-audio-fallback"`
  `provenance: "prompts/00-global/G-05-motion-audio-fallback.md；60fps 目标、粒子池、音频限频与 fallback"`
- Web 平台原生能力（本项目零新增依赖的依据）：`createImageBitmap`、`img.decode()`、`OffscreenCanvas`、`Worker`、`PerformanceObserver`、`requestAnimationFrame`、`<link rel="preload">`。

## 3 当前决策

- **素材加载不可见原则（头号敌人）**：任何素材在进入画面之前必须完成 fetch → decode → GPU 上传/DOM 挂载三段全流程。进入画面后不允许出现渐进解码可见（图片从上往下刷）、布局位移（CLS）或空白闪现。加载过程只允许出现在明确的加载位（读条、轮廓占位、慢白幕），不允许发生在游戏画面中间。
- **三段分离**：fetch（网络）→ 解码（`createImageBitmap`/`img.decode()`，可离主线程）→ 上传/挂载（GPU 纹理或 DOM 插入，**分帧排队**，每帧限额）。三段并行流水线化，任何一段都不许在渲染关键帧内 burst。
- **场景就绪门槛（SceneReadinessGate）**：页面/场景揭幕前，关键资源 100% ready 才揭幕；非关键资源（装饰图标）可后挂但不许闪。宁可延长读条，不许边播边刷。演出（全屏四仪式/终局结算）开始前其素材必须 ready；未 ready 时直接走既定程序化 fallback，不等待、不边播边加载。
- **演出即加载窗口**：入梦慢白幕、结算白幕等本身就是天然的加载掩护——预取下一阶段的全部资源放在演出时间轴内并行完成，演出结束即 ready。页面切换 intent 发出的瞬间即开始预取目标页资源。
- **帧预算制**：rAF 每帧 16.7ms（60fps）总预算；任务队列采用 time-slicing，单帧内任务切片耗时不超预算的 50%（约 8ms），超限任务顺延下一帧，绝不阻塞输入与合成。长任务监控阈值 50ms（RAIL），目标正常档关键路径零 longtask。
- **重活离主线程**：粒子模拟、路径采样、大列表 diff 等计算移入 Web Worker（`OffscreenCanvas` 可用时粒子渲染也移出）；主线程只做合成与挂载。Worker 不可用环境降级为主线程分帧，不降视觉。
- **内存预分配与池化**：粒子对象池预分配固定槽位并复用（禁止运行期扩容触发 GC 峰）；解码产物（ImageBitmap）进 LRU 缓存池；粒子模拟用预分配 TypedArray。**热路径（每帧执行的代码）禁止对象/数组/闭包字面量分配。**
- **请求合并**：角色帧、图标、UI 素材图集化（atlas），减少请求数与纹理切换；音频用 Howler `preload` 全量预载，并在用户手势内完成 unlock；字体 `<link rel="preload">` + `font-display: swap`，禁 FOIT。
- `+3` 保持 deferred 不可选；selection/trigger effects 保留。

## 4 状态机

资源生命周期（每素材实例）：

```text
unrequested
  -> prefetching          （预取窗口内提前 fetch）
  -> fetching             （网络传输）
  -> decoding             （createImageBitmap / img.decode，可离主线程）
  -> upload-queued        （进入分帧上传队列，带优先级）
  -> uploading            （本帧限额内上传 GPU / 插入 DOM）
  -> ready                （完全可用：decoded + mounted）
  -> mounted-visible      （已进入画面）
  -> pooled               （离场回收进缓存池，LRU 保活）
```

任务队列（time-slicing）：

```text
idle -> running           （本帧预算内执行）
     -> yielded           （超预算，顺延下一帧，保序）
     -> drained           （队列清空）
```

场景门槛：

```text
scene-entering
  -> gate-checking        （关键资源是否 100% ready）
  -> gate-open            （ready，揭幕；演出开始同理）
  |  -> fallback-path     （演出素材未 ready：走程序化 fallback，不等待）
  -> scene-active
```

- 任一阶段的失败/超时都不改结果：素材失败走 B7-01 四级 fallback；门槛超时延长读条并显示可读原因，不伪造完成。

## 5 组件树

```text
CoherencePerformanceRoot
├─ PreloadScheduler             （预取编排：页面级/演出级/相邻楼层级）
├─ DecodePipeline               （createImageBitmap + img.decode 并行解码）
├─ FrameUploadQueue             （分帧上传：每帧纹理/DOM 挂载限额 + 优先级）
├─ TimeSlicingTaskQueue         （每帧预算任务调度，超限顺延保序）
├─ WorkerPool                   （粒子模拟/路径采样/大 diff；OffscreenCanvas 可用则含粒子渲染）
├─ ParticlePool                 （预分配槽位对象池 + TypedArray 模拟缓冲）
├─ BitmapCachePool              （解码产物 LRU 缓存，等价内存上限）
├─ SceneReadinessGate           （关键资源 ready 门槛；演出前置断言）
├─ LongTaskMonitor              （PerformanceObserver longtask + 帧率采样，仅诊断）
└─ LoadingFallbackLayer         （读条/轮廓占位；不伪造完成数据）
```

各组件在既有架构内挂载（复用 B7-01 的 MotionCoordinator 与 B7-02 的 RuntimeBudgetMonitor 边界），不创建第二套全局状态树。

## 6 只读数据

```ts
interface CoherencePerformanceProjection {
  readonly eventId: string;
  readonly pageId: string;            // 目标页面，驱动预取清单
  readonly revision: string;
  readonly criticalAssetRefs: readonly string[];   // 门槛必查资源
  readonly deferredAssetRefs: readonly string[];   // 可后挂但不许闪
  readonly performanceProfile: 'standard' | 'reduced-motion' | 'low';
  readonly source: 'mock' | 'projection';
}
```

调度器只读页面 id 与资源清单计算预取；不读取规则内部对象、不推断结果。性能采样（帧率、longtask、池水位）仅用于本地诊断与降级决策，不上报为规则事实。

## 7 动作意图

```ts
interface CoherenceIntent {
  readonly kind:
    | 'presentation.prefetch'        // 页面切换 intent 发出时同步触发目标页预取
    | 'presentation.scene-enter'     // 请求揭幕（触发 gate-checking）
    | 'presentation.profile-select'; // 沿用 B7-02，不重定义
  readonly eventId: string;
  readonly requestId: string;
}
```

- 预取意图伴随既有页面跳转 intent 自动发出，不需要用户显式操作。
- 揭幕请求在门槛通过后生效；门槛拒绝时保持加载位，不伪造进入。
- 演出播放（B7-04 全屏）开始前由 SceneReadinessGate 断言素材 ready；未 ready 直接 fallback-path。

## 8 本地 UI 状态

允许保存：各资源 `assetLoadPhase`（生命周期状态机当前态）、上传队列水位、任务队列水位、池占用数、帧率采样窗口、longtask 记录（有界）、读条进度。

不得保存或推断：规则结果、回合推进、任何从加载进度推导的玩法事实。池与队列是实现细节，崩溃恢复时全部可重建。

## 9 视觉令牌（性能工程预算）

> 这些是工程阈值（技术指标例外，不受 1-5 玩法数值铁律约束）。standard 档视觉规格不因预算削减——预算不够时优化调度，不许降画质。

| 令牌 | 值 | 含义 |
|---|---|---|
| `frameBudgetMs` | 16.7 | 每帧总预算（60fps） |
| `taskSliceMs` | 8 | 单帧内任务切片耗时上限（预算的 50% 留给渲染合成） |
| `uploadPerFrame` | 2 个大纹理（或 2048×2048 等效像素/帧） | 分帧上传限额 |
| `longTaskThresholdMs` | 50 | RAIL 长任务阈值；目标关键路径为 0 |
| `particlePoolSize` | 128 槽位预分配 | 同屏激活 ≤50（沿用 B7-04），池禁运行期扩容 |
| `bitmapCacheLimit` | 等价 256MB 像素内存 | LRU 上限，超出回收最旧 |
| `prefetchLeadMs` | 页面 intent 即时 / 演出前 1000ms | 预取提前量 |
| `gateTimeoutMs` | 10000 | 门槛超时转读条原因显示 + 重试/安全返回 |
| `audioPreload` | Howler 全量 preload + 手势内 unlock | 禁首播卡顿 |
| `fontStrategy` | preload + `font-display: swap` | 禁 FOIT |
| `atlasPolicy` | 角色帧/图标/UI 素材图集化 | 减少请求数与纹理切换 |

## 10 动效绑定（加载编排绑定）

| 时刻 | 编排策略 |
|---|---|
| 启动 → 驻地 | 启动读条期间预取驻地全部实体图集与字体；驻地揭幕即全 ready |
| 驻地 → 对局（入梦） | 匹配/入梦慢白幕期间并行预取对局图集 + 全屏张力图 + 粒子贴图 + 音频 cue；演出结束 gate-open 揭幕。**慢白幕是天然加载窗口，读条藏在演出里** |
| 对局内换楼层/场景 | 距离 =1 的相邻楼层资源预取；叠层视图揭幕前 gate 检查 |
| 全屏四仪式触发 | 触发前 SceneReadinessGate 断言张力图 ready；未 ready 立即走程序化 fallback（B7-04 §12），不边播边刷 |
| 终局结算 | 终局判定事件到达即预取结果板/金粒子贴图；梦醒演出掩护加载 |
| 高频对局中 | TimeSlicingTaskQueue 消化非紧急任务（列表 diff、诊断渲染）；粒子模拟在 Worker；热路径零分配 |
| 页面切换 | intent 发出瞬间 prefetch 目标页关键资源；切换响应 <100ms 且切换瞬间零素材闪现、零 CLS |
| 演出/页面离场 | 资源回收入 BitmapCachePool（LRU），池满回收最旧；粒子回池 |

## 11 输入无障碍

- 加载位（读条/轮廓占位）必须有文字状态与可读进度，不伪造完成数据；`aria-live` 播报进入中/完成/失败。
- 门槛超时提供重试/取消/安全返回，键盘可达；焦点不落在不可操作遮罩。
- time-slicing 保证输入响应不被后台解码/上传阻塞（输入事件优先于队列任务处理）。
- reduced-motion/low 档沿用 B7-02 策略；本 brief 的加载编排在三档行为一致（都要 ready 才揭幕），不因档位跳过预解码。

## 12 加载错误超时

- 资源 fetch/decode 失败：走 B7-01 四级 fallback，显示 `asset.fallback` 可读原因；不重试轰炸（限次）。
- 门槛超时（`gateTimeoutMs`）：保持加载位 + 显示原因 + 重试/安全返回；不揭幕半成品。
- 上传队列/任务队列异常：丢弃该帧顺延，不抛全局错误；队列水位异常记入有界诊断。
- Worker 初始化失败：降级主线程分帧执行，视觉规格不变。
- `OffscreenCanvas` 不可用：粒子渲染留主线程，仍走池化与分帧。
- 任何路径不改变 `settled` 结果与 projection。

## 13 明确不做

- ❌ **不砍画面换性能**：不缩图、不降分辨率、不减少 standard 档粒子/特效/后处理来提帧率；预算超限先优化调度与流水线，最后才按 B7-02 显著性顺序降级（那是既定降级档语义，不是本 brief 的手段）。
- ❌ 不允许「从上往下刷」的渐进解码可见、布局位移、空白闪现在画面中间出现。
- ❌ 不用无限 spinner 掩盖未做预加载；不用伪造完成数据揭幕。
- ❌ 热路径不做每帧分配（对象/数组/闭包字面量）；不运行期扩容粒子池。
- ❌ 不在主线程做像素级/大数组计算（移 Worker 或分帧）。
- ❌ 不引入第 4 节权威来源之外的新依赖；实现使用浏览器原生 API。
- ❌ 不让加载进度、帧率、池水位影响或推断任何规则状态。

## 14 依赖交接

- B7-01 提供 MotionCoordinator 与 fallback 契约；本 brief 的加载编排挂在其播放生命周期上（triggered 前断言 ready）。
- B7-02 提供 RuntimeBudgetMonitor 与三档 Profile；FrameUploadQueue/TimeSlicingTaskQueue 的预算并入其闸门，语义不冲突（工程预算 vs 视觉降级是两条线）。
- B7-04 的全屏张力图与粒子贴图进入 `criticalAssetRefs` 清单；演出前置断言由 SceneReadinessGate 执行。
- 资产端口提供图集/manifest 与版本；本层不生产素材、不改所有权。
- 页面路由（B6）的跳转 intent 钩子触发 `presentation.prefetch`。
- 需要宿主提供的仅是页面 → 资源清单的映射（已有 G-08 页面索引可推导）。

## 15 验收条件

- [ ] 录屏验证：页面切换、入梦/返回、楼层切换、全屏四仪式、结算全程**无素材从上往下刷、无空白闪现、无布局位移**。
- [ ] 演出开始时其素材 100% ready：断言 `assetLoadPhase === 'ready'`（fixture 演示含一个故意缺资源场景，验证 fallback-path 不等待）。
- [ ] `PerformanceObserver` 采集：正常档关键路径无 >50ms longtask；rAF 帧率稳定 60fps（长帧有界且可解释）。
- [ ] 分帧上传可见性：单帧纹理上传不超过 `uploadPerFrame` 限额（队列水位日志验证）。
- [ ] 连续 5 分钟高频操作（移动+受击+粒子爆发+页面往返）：内存无单调增长（池复用生效），GC 暂停不产生可见卡顿。
- [ ] 输入响应在后台解码/上传期间不受阻塞（任务切片让路输入）。
- [ ] standard 档视觉规格与 B7-04 清单逐项一致——**性能工程未削减任何画面要素**。
- [ ] 三档 Profile 下加载编控行为一致（都 ready 才揭幕）；reduced/low 不跳过预解码。
- [ ] 加载位有文字/进度/失败原因；门槛超时有重试与安全返回；console 无 error/warning。
- [ ] `npx tsc --noEmit`、相关 `npx vitest run`、`npm run lint` 通过。

# B1-02 启动、加载与恢复 Brief

## 1. 页面定位

这是 `startup-loading` 页面及其恢复路径的自包含 brief。它覆盖冷启动、加载、继续恢复、无存档、加载失败、资源缺失、版本不兼容、超时、重试、取消和安全返回。页面只提供 UI projection 和 intent，不执行真实存档、网络、版本校验或业务恢复。

`startup-loading` 是标题画面之前的可观测启动状态面。它必须让前端生成 AI 在没有后端时独立演示所有成功和失败态，且不能用 mock 成功掩盖失败。任何“完成”“继续”“恢复”文案必须来自 mock/projection fixture 的只读状态；本地点击只产生 intent。

页面由 B1 的 `AppShell`、`PageSurface`、`FeedbackLayer` 和 `FocusScope` 承载。它是 UI-only、intent-only 的页面：只读 mock/projection，只提交 intent，不执行恢复规则。它不是一个普通 loading page：需要有阶段、原因、下一步和安全落点；错误路径始终有界。允许登记素材、纹理、光效和图标参与表现，不以零素材为目标；若共享壳层展示 burst，只允许 MVP 0/1/2，`+3极限爆发`不可选。所有同屏选项不超过 5。

## 2. 权威来源（只写 attachmentId/provenance）

- attachmentId: `frontend-port-contract`  
  provenance: `loading-connection-pending-result-and-version-safe-return-ui-port`；当前结论：端口未连接显示连接中，请求超时显示重试/取消，版本不兼容显示安全返回，不能静默当作成功。
- attachmentId: `frontend-fixtures`  
  provenance: `startup-loading-empty-error-retrying-safe-return-screenState-fixtures`；当前结论：fixture 明确包含 loading、empty、error、retrying、safe-return，数据源标记为 mock。
- attachmentId: `frontend-pages-batches`  
  provenance: `startup-loading-B1-pageId-and-failure-route`；当前结论：`startup-loading` 属 B1，完整启动路径失败时落到 retry/cancel/safe-return。
- attachmentId: `frontend-workflow-requirements`  
  provenance: `title-startup-loading-settings-and-ui-only-scope`；当前结论：启动与标题为 UI surface，继续/新游戏/选项/退出不直接执行后端业务。
- attachmentId: `frontend-motion-fallback`  
  provenance: `loading-timeout-resource-failure-version-incompatibility-deterministic-fallback`；当前结论：加载等待必须有文字、超时、重试/取消/安全返回；资源或演出缺失不改变结果。
- attachmentId: `frontend-interaction-accessibility`  
  provenance: `focus-into-error-next-action-live-region-keyboard-pad-touch-equivalence`；当前结论：加载/错误态焦点进入可执行下一步，不能落在空白区域；操作等价且不只靠颜色。
- attachmentId: `frontend-visual-token-contract`  
  provenance: `loading-error-resource-fallback-semantic-placeholder-and-holographic-layer`；当前结论：加载使用橙色进行中，错误红色，资源缺失以语义占位保留空间；允许登记素材参与背景。
- attachmentId: `journey-current-ruling`  
  provenance: `startup-to-title-to-residence-no-direct-battle-and-return-origin`；当前结论：新游戏最终目标是出租屋 UI surface，不直接进入对局；失败可安全回到标题/壳层。
- attachmentId: `frontend-conflict-ruling`  
  provenance: `heritage-only-conflicts-current-ruling-and-no-fabricated-business-success`；当前结论：历史文档不能覆盖当前 UI-only 结论，未收口冲突必须显示人工复核或安全返回。

## 3. 当前决策

- 页面 ID 固定为 `startup-loading`，变体固定为 `startup`。状态包括 `cold-start`、`loading`、`restore-loading`、`empty`、`ready`、`timeout`、`error`、`asset-missing`、`version-incompatible`、`retrying`、`cancelled`、`safe-return`。
- 冷启动的可见阶段至少包括：`准备界面`、`读取启动投影`、`检查资源`、`准备标题画面`。阶段文字是 mock/projection 字段，不允许本地猜测真实进度。
- `继续`路径必须能表达：有可恢复快照、无存档、恢复中、恢复失败、恢复超时。无存档是明确 `empty`，不能把“没有存档”渲染成 loading 或成功。
- 加载失败、资源缺失、版本不兼容是不同状态和文案；它们可以共用 FeedbackLayer，但必须分别说明原因和合法下一步。
- 所有等待有有限超时。超时显示当前阶段、可重试、取消或安全返回；禁止无限 spinner，禁止自动跳过失败为 ready。
- 安全返回必须有稳定目标：优先最近确认的 `menu-title` 或 `control-panel-main`，目标由只读 projection/host 提供；组件不得自行创建“返回到某后端路径”。
- 重试提交 `startup.retry`；取消提交 `startup.cancel`；安全返回提交 `startup.safe-return`；提交后为 pending，只有 accepted 或新 projection 才更新到下一个确认状态。
- 若资源包版本不兼容，拒绝激活该资源包但保留基础 UI profile 和错误说明；不能借用语义错误的素材假装资源已经加载。
- 允许已登记的背景/纹理/光效/图标参与 loading 和错误画面；缺失素材时保留结构、assetRef、轮廓和文字。不是零素材口径。
- 任何可见值使用 1–5 范围；阶段编号、版本号、时间戳、requestId 等技术字段不作为玩家可见玩法数值。

## 4. 状态机

```text
cold-start
  -> shell-mounting
  -> loading
  -> resource-checking
  -> ready-to-title
  -> safe-return

loading
  -> restore-loading
  -> empty
  -> ready
  -> timeout
  -> error
  -> asset-missing
  -> version-incompatible
  -> cancelled

restore-loading
  -> ready
  -> empty
  -> timeout
  -> error
  -> asset-missing
  -> version-incompatible

empty
  -> menu-title
  -> retrying
  -> safe-return

error
  -> retrying
  -> cancelled
  -> safe-return

asset-missing
  -> retrying
  -> continue-with-fallback
  -> safe-return

version-incompatible
  -> retrying
  -> safe-return

timeout
  -> retrying
  -> cancelled
  -> safe-return

retrying
  -> loading
  -> restore-loading
  -> error
  -> timeout
  -> safe-return

ready
  -> menu-title
  -> safe-return

cancelled
  -> menu-title
  -> safe-return
```

- `ready` 只由 `accepted` 或 projection 更新确认；本地倒计时结束只能进入 timeout。
- `continue-with-fallback` 仅表示资源表现层降级后仍能显示 UI，不表示真实存档恢复成功；其目标和可见状态必须由 projection 确认。
- `safe-return` 是稳定终态，必须可读出落点和原因；重试/取消不能丢失错误诊断。

## 5. 组件树

```text
StartupLoadingSurface
├─ StartupBackdropLayer
│  ├─ HolographicLightField
│  ├─ StartupAssetSlot
│  └─ AssetFallbackSlot
├─ StartupHeader
│  ├─ WakeUpMark
│  ├─ SurfaceLabel
│  └─ SourceBadge
├─ StartupProgressRegion
│  ├─ LoadingPhaseList
│  │  ├─ PhaseEntry
│  │  └─ PhaseStatusIcon
│  ├─ CurrentPhaseLabel
│  ├─ ProgressProjection
│  └─ TimeoutNotice
├─ RestoreProjectionRegion
│  ├─ SaveAvailabilitySummary
│  ├─ SaveMetadataSummary
│  ├─ EmptySaveState
│  └─ RestoreErrorReason
├─ ResourceStatusRegion
│  ├─ ResourceEntry
│  ├─ MissingAssetNotice
│  └─ VersionCompatibilityNotice
├─ StartupActionRegion
│  ├─ RetryButton
│  ├─ CancelButton
│  ├─ ContinueWithFallbackButton
│  └─ SafeReturnButton
├─ FocusScope
└─ FeedbackLayer
   ├─ PendingRegion
   ├─ ErrorRegion
   ├─ LiveRegion
   └─ MotionCoordinator
```

成功态可以使用少量按钮和阶段信息；错误态必须保留清晰的原因、可操作下一步和安全返回。不要把所有状态压成一个进度条或同一个 spinner。

## 6. 只读数据

```ts
type StartupState =
  | 'cold-start' | 'loading' | 'restore-loading' | 'empty' | 'ready'
  | 'timeout' | 'error' | 'asset-missing' | 'version-incompatible'
  | 'retrying' | 'cancelled' | 'safe-return' | 'continue-with-fallback';

type StartupSource = 'mock' | 'projection';

interface StartupPhaseProjection {
  id: string;
  label: string;
  state: 'pending' | 'active' | 'complete' | 'failed' | 'skipped';
  source: StartupSource;
}

interface RestoreProjection {
  availability: 'unknown' | 'available' | 'empty' | 'rejected' | 'stale';
  label: string;
  summary?: string;
  savedAtLabel?: string;
  source: StartupSource;
}

interface ResourceProjection {
  resourceId: string;
  label: string;
  state: 'checking' | 'ready' | 'missing' | 'incompatible' | 'failed';
  assetRef?: string;
  reason?: string;
  source: StartupSource;
}

interface StartupSnapshot {
  pageId: 'startup-loading';
  screenState: StartupState;
  phase: string;
  phases: readonly StartupPhaseProjection[];
  restore: RestoreProjection;
  resources: readonly ResourceProjection[];
  timeout: { active: boolean; message?: string; source: StartupSource };
  safeReturnTarget: 'menu-title' | 'control-panel-main';
  revision: number;
  source: StartupSource;
}
```

- `summary`、`savedAtLabel`、阶段状态和错误原因都是只读显示字段，不推导存档内容、玩家位置或真实版本关系。
- `assetRef` 是素材挂载契约，不等于资源已经加载；`missing` 必须可追踪。
- Mock fixture 至少提供：正常冷启动、无存档、恢复中、恢复失败、超时、资源缺失、版本不兼容、重试中和安全返回。
- 数据数值仅用于展示且必须遵守 1–5；不要加入存档槽位、货币、属性或规则数据。

## 7. 动作意图

| intentId | 触发 | payload | 视觉响应 | 非目标行为 |
|---|---|---|---|---|
| `startup.load` | AppShell 首次挂载 | `{ entry: 'cold-start' }` | 显示阶段和 pending | 不读取真实存档 |
| `startup.restore` | 继续恢复 | `{ source: 'title-continue' }` | 进入 restore-loading | 不本地生成可恢复存档 |
| `startup.retry` | 重试 | `{ failedState, phaseId? }` | 进入 retrying，再回 loading/restore-loading | 不宣称重试成功 |
| `startup.cancel` | 取消加载/恢复 | `{ returnTo }` | 结束 pending，进入 menu-title 或安全 surface | 不丢诊断、不清理真实数据 |
| `startup.safe-return` | 安全返回 | `{ targetPageId, reason }` | 进入 safe-return，显示目标和原因 | 不跳过失败记录 |
| `startup.continue-with-fallback` | 资源缺失但 UI 可继续 | `{ resourceIds }` | 进入可见降级态 | 不把资源缺失当作成功加载 |
| `overlay.close` | 关闭错误/说明 overlay | `{ overlayId }` | 关闭并恢复焦点 | 不确认失败动作 |

所有输入方式调用同一 intent builder。提交时显示 requestId 或可读的“请求处理中（mock）”，结果由 `IntentResult`/projection 决定。

## 8. 本地 UI 状态

允许本地保存：

- 当前阶段展开项、phaseIndex、错误详情展开、resourceDetailsExpanded、焦点索引、`restoreTargetId`。
- `pendingRequestId`、retryCount、timeoutPhase、animationPhase、assetLoaded、reducedMotion、isMuted。
- 是否已请求跳过启动演出、当前 LiveRegion 是否已播报、按钮 hover/focus/active/disabled/return。

禁止本地保存或推断：

- 存档是否真实存在、恢复是否成功、资源版本是否真实兼容、网络是否连通、玩家位置、规则状态、游戏是否已进入对局。
- 通过本地计时器将 loading 自动改为 ready；计时器只能触发 timeout 呈现。
- 通过点击重试次数猜测错误类型或改写 projection。

## 9. 视觉令牌

- `loading`：橙色进行中 + 半透明脉冲 + 阶段文字；旋转图标不是唯一反馈。
- `complete/ready`：绿色语义高光、清晰完成图标和可读文案。
- `empty`：灰白/中性层 + 空状态图标/文字；无存档不是红色错误。
- `error`：红色边缘闪烁/结构化错误图标/原因；保持背景层和页面结构。
- `timeout`：黄色/灰白说明当前等待已超时，提供重试/取消/安全返回。
- `asset-missing`：保留 semantic silhouette、`assetRef` 诊断和原空间位置；不能借用错误语义素材。
- `version-incompatible`：紫色约束/灰白说明，可用锁/版本图标和安全返回。
- 背景采用低饱和全息投影，允许登记纹理、光效和 `assetRef`；不要生成纯白常态背景，纯白只用于短暂边界演出。
- 控件五态：hover 边缘光和材质凸起；focus 明确外环；active 内缩/高光加深；disabled 扁平并带原因；return 回到基线。

## 10. 动效绑定

- 冷启动：`contour-reveal` 先显现背景和壳层，再显现阶段列表；不使用浏览器加载转圈作为唯一体验。
- 阶段变化：使用 `list-reflow`/`semantic-highlight`，当前阶段局部高亮，完成阶段轻量 afterglow。
- retrying：使用短促 `click-play` 回弹和重新显影，保留原错误原因直到新 projection 到达。
- timeout/error：使用 `shake-rebound` 或局部红/黄反馈，不播放成功过渡；焦点移动到下一步动作区。
- `ready-to-title`：使用短 `afterglow-fade`/`contour-reveal` 交接到 `menu-title`，不是瞬间替换且不表现进入对局。
- 资源缺失：使用轮廓显影/语义占位；资源后来恢复时才播放局部替换，不改业务状态。
- 用户跳过演出只发 `presentation.skip` 或对应 UI intent，直接落到相同 settled 画面。
- reduced motion 时去掉旋转、粒子、闪烁和位移，保留阶段文字、焦点和最终状态。

## 11. 输入无障碍

- 状态区使用 `role="status"`/LiveRegion 读出“正在准备界面”“加载超时”“无存档”“资源缺失”“版本不兼容”和下一步。
- Loading 时焦点可以停在取消或安全返回；进入 error/empty/timeout 后焦点移到首个有效操作，而非空白区域。
- 按钮支持 Tab/Shift+Tab、Enter、Space；Esc 取消当前 loading overlay 或打开安全返回确认，不默默确认。
- 手柄支持 confirm/cancel/方向导航；触控支持 tap 和明确的返回按钮；鼠标 click 与其他输入共用 intent。
- 每个错误按钮提供 aria-label、原因和结果状态；disabled 必须有 `aria-disabled` 与 `aria-describedby`。
- 文字放大时阶段、原因和操作不裁切；焦点环不被背景/全屏动效遮挡。
- 资源缺失和版本不兼容用文字、图标和结构共同表达，不只用颜色。

## 12. 加载错误超时

- `loading` 必须显示当前阶段、总体状态和下一步可用性；不要只有百分比或 spinner。
- `timeout` 必须显示“等待已超时（mock）”、当前 phase、重试、取消或安全返回；不能自动继续。
- `error` 必须显示稳定诊断文字/ID、失败对象和重试/取消/安全返回；不同错误不能共用“未知错误”。
- `empty` 必须明确“没有可恢复存档（mock）”，提供回标题/新游戏方向或安全返回，不显示恢复成功。
- `asset-missing` 必须显示资源 label/assetRef、语义占位、继续使用 fallback（如允许）或安全返回；不静默换资源。
- `version-incompatible` 必须显示版本不兼容说明和安全返回；重试只能等待新的 projection。
- `restore-loading` 超时不能变成 `ready`；`startup.restore` 被拒绝必须留在 error/rejected。
- 任意待处理请求可取消；取消后焦点回到触发器或安全目标，LiveRegion 宣布已取消。
- 如果 AppShell/端口完全不可用，页面仍用本地 mock adapter 展示这些分支，不伪造后端成功。

## 13. 明确不做

- 不读真实文件系统、真实存档、账号、网络、版本服务或后端路径。
- 不实现存档槽位管理、存档修复、冲突合并、迁移、下载、业务重试策略或规则恢复。
- 不把无存档当作加载失败，不把资源缺失当作版本兼容，不把 timeout 自动变成 ready。
- 不在组件中推进标题→驻地→对局，不调用规则/动作执行器，不写游戏 store。
- 不用零素材占位交付；不删除背景、结构或 assetRef；不借用语义错误的资源。
- 不制造第二套路由、错误页面家族或无限 spinner。
- 不把 `+3极限爆发`做成可选项；若壳层共享 burst 预览，只保留 0/1/2。

## 14. 依赖交接

- 从 `B1-01` 接收 `AppShell`、`PageSurface`、`FeedbackLayer`、`FocusScope`、统一 intent adapter 和 `safe-return` 挂载点。
- 向 `B1-03` 交接：`ready-to-title`、`empty`、`restore-loading`、`error`、`safe-return` 的启动 fixture，以及“继续/新游戏”前置状态。
- 向 `B1-04` 交接：错误/超时焦点进入下一步、取消后恢复触发器、LiveRegion 状态和 `restoreTargetId`。
- 向后续接线方交接 `StartupSnapshot`/`IntentRequest` 抽象；真实 adapter 可替换 mock provider，不改变状态名、intentId、错误文案结构和焦点顺序。
- 素材只通过 `assetRef`/manifest slot 挂载；素材生产和资源管线不属于此 brief，缺失时必须按 fallback 呈现。

## 15. 验收条件

- [ ] 无后端仅使用 mock fixture 可演示冷启动、加载、阶段变化、完成和进入标题。
- [ ] 可演示继续恢复中的有存档、无存档、恢复失败、恢复超时；无存档不会伪造成功。
- [ ] 可演示加载失败、资源缺失、版本不兼容、retrying、cancelled、safe-return；每个状态有原因和合法下一步。
- [ ] 任意 loading 都有文字阶段和有限超时；没有无限 spinner，timeout 不自动变 ready。
- [ ] `startup.retry`、`startup.cancel`、`startup.safe-return` 和 fallback intent 都带 requestId，结果由 accepted/rejected/stale/timeout 区分。
- [ ] 资源缺失保留组件位、语义轮廓、assetRef 和可读诊断；允许登记素材参与背景，不以零素材为完成口径。
- [ ] error/empty/timeout 状态焦点进入首个可执行操作；取消/关闭/安全返回后焦点恢复正确。
- [ ] 鼠标、键盘、手柄、触控、屏幕阅读器完成相同的重试/取消/安全返回路径。
- [ ] 动画跳过、资源失败或 reduced motion 不改变最终状态；失败不播放成功演出。
- [ ] 所有 fixture 显示 `source: mock`，projection 接线不改变组件树；可见数值遵守 1–5。
- [ ] 生成代码通过项目 TypeScript、相关测试、lint 和文档术语门禁。

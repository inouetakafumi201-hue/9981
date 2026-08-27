# B1-01 AppShell 与 ControlPanel Brief

## 1. 页面定位

这是 WakeUp 前端壳层的全局承载页面，负责 `AppShell`、`ControlPanel`、页面挂载、类别筛选、页面变体切换和动画预览。它是 UI-only 的稳定切换面与主抽取面，不是游戏大厅、地图导航器或规则控制台。

`AppShell` 只维护一套全局 UI 层级：`AppShell → ControlPanel → PageSurface → LocalOverlay → FeedbackLayer`。`ControlPanel` 切换的是 UI surface，不表现角色移动、空间遍历、地图节点变化或玩法推进。所有数据由 mock 或只读 projection 提供，所有控件只提交声明式 intent。

页面必须能脱离后端运行。生成 AI 应先提供可替换的 mock provider、intent adapter 和可审计的状态标签，再实现视觉细节。允许使用登记素材、纹理、光效、立绘、环境图和图标；本页面不以零素材渲染为目标。

## 2. 权威来源（只写 attachmentId/provenance）

- attachmentId: `frontend-workflow-design`  
  provenance: `AppShell-ControlPanel-single-switching-and-extraction-surface-page-catalog-UI-only-boundary`；当前结论：AppShell 只有一套全局壳层，ControlPanel 是唯一稳定切换面和抽取面，页面只表达 UI。
- attachmentId: `frontend-port-contract`  
  provenance: `StateSnapshot-IntentRequest-IntentResult-mock-to-projection-port-abstraction`；当前结论：UI 只读 StatePort，通过 ActionPort 提交 intent，`pending` 不等于 `accepted`。
- attachmentId: `frontend-pages-batches`  
  provenance: `control-panel-main-B1-page-family-index-and-stable-pageId-variantId-boundary`；当前结论：`control-panel-main` 属 B1，页面目录由稳定 pageId 约束，不能自行扩展页面家族。
- attachmentId: `frontend-interaction-accessibility`  
  provenance: `five-state-equivalence-focus-scope-screen-reader-and-five-visible-options-limit`；当前结论：每个控件必须有 hover/focus/active/disabled/return 五态，同屏并列选项不超过 5。
- attachmentId: `frontend-motion-fallback`  
  provenance: `state-transition-click-play-result-replay-and-deterministic-fallback`；当前结论：`state-transition` 与 `click-play` 分离，动画只重演确认结果，缺失或跳过收敛到同一结果。
- attachmentId: `frontend-visual-token-contract`  
  provenance: `pixel-foreground-holographic-background-semantic-color-material-and-asset-slot`；当前结论：像素前景叠加全息投影背景，允许素材、纹理和光效，不得退化成 SaaS 卡片墙或零素材壳。
- attachmentId: `frontend-fixtures`  
  provenance: `source-mock-revision-screenState-and-loading-error-safe-return-fixtures`；当前结论：展示数据必须带 `source: mock | projection`，fixture 是只读演示数据，不是规则事实。
- attachmentId: `frontend-conflict-ruling`  
  provenance: `title-startup-ruling-burst-tier-freeze-white-manifestation-and-heritage-boundary`；当前结论：标题画面为启动前置，`+3极限爆发`不可选，历史排除项不得升格。

## 3. 当前决策

- `AppShell` 的固定层级为：

  ```text
  AppShell
  ├─ ShellBackdropLayer
  ├─ ControlPanel
  │  ├─ PageCatalogView
  │  ├─ CategoryFilterView
  │  ├─ VariantSwitcherView
  │  └─ AnimationModeView
  ├─ PageSurface
  ├─ LocalOverlay
  └─ FeedbackLayer
  ```

- `ControlPanel` 是主切换面、主抽取面和开发期演示面。它必须能切换页面、类别、呈现变体、`state-transition` 和 `click-play`。
- 页面目录至少包含 B1 需要的 `startup-loading`、`menu-title`、`control-panel-main`、`utility-settings`，并保留后续 pageId 的挂载位：`menu-pause`、`hud-main`、`residence-main`、`dialog-line`、`dialog-options`、`transition-dream`、`transition-battle-intro`、`transition-result`、`notice-broadcast`、`notice-toast`、`utility-inventory`、`utility-safe`、`utility-match`、`stats`、`achievements`、`codex`、`recap`、`quest-log`、`objective-tracker`、`tutorial-help`、`location-title`、`notification-history`。
- 页面列表必须可分页、分组或滚动，同屏并列页面选项不超过 5。类别筛选是 UI 呈现筛选，被过滤页面不卸载、不改写、不丢失局部状态。
- 类别固定为：`cat-menu`、`cat-hud`、`cat-residence`、`cat-narrative`、`cat-transition`、`cat-notice`、`cat-control`、`cat-utility`。
- 变体只改变呈现：例如 `title`、`pause`、`startup`、`settings`、`standard`、`solo`、`minimal`、`with-portrait`、`no-portrait`、`enter-dream`、`return-home`。变体切换不是玩法切换。
- 动画模式固定分成 `state-transition` 和 `click-play`。前者由 UI 状态变化触发，后者由用户点击/确认触发；二者不能合并成“播放任意动画”的模糊按钮。
- 所有控件必须明确 mock/projection 来源。ControlPanel 不计算 HP、AP、伤害、匹配、存档、位置、路径或规则结果。
- 如果 ControlPanel 展示 burst 预览，MVP 只允许 0/1/2；`+3极限爆发`只可作为不可选的 future-evaluation 预留说明，选择特效和触发特效仍需有表现槽位。

## 4. 状态机

```text
shell-unmounted
  -> shell-mounting
  -> shell-ready

shell-ready
  -> page-idle
  -> page-interacting
  -> page-switch-pending
  -> page-switch-accepted -> page-idle
  -> page-switch-rejected -> page-interacting
  -> page-switch-stale -> page-resync
  -> page-switch-timeout -> page-error

page-idle
  -> category-filtering
  -> variant-switching
  -> animation-previewing
  -> overlay-open

category-filtering / variant-switching
  -> page-interacting
  -> page-error

animation-previewing
  -> animation-settled
  -> animation-skipped
  -> animation-failed
  -> page-interacting

overlay-open
  -> overlay-confirmed
  -> overlay-cancelled
  -> page-interacting

page-error
  -> retrying
  -> safe-return
  -> page-interacting
```

- 任何 intent 的确认必须由 `IntentResult` 或新 projection 证明；本地点击不能直接把页面标成 accepted。
- `rejected`、`stale`、`timeout` 和 `error` 都必须保留原因文字；失败不播放成功动画。
- `safe-return` 回到最近确认的 UI surface 或明确的安全页面，不创建第二套路由。

## 5. 组件树

```text
AppShell
├─ ShellBackdropLayer
│  ├─ HolographicLightField
│  ├─ RegisteredTextureSlot
│  └─ AssetFallbackSlot
├─ GlobalFocusScope
├─ ControlPanel
│  ├─ ControlPanelHeader
│  │  ├─ CurrentPageLabel
│  │  ├─ SourceBadge
│  │  └─ ShellStatusBadge
│  ├─ PageCatalogView
│  │  ├─ PageGroup
│  │  ├─ PageEntry
│  │  └─ PagePagination
│  ├─ CategoryFilterView
│  │  ├─ CategoryGroup
│  │  ├─ CategoryEntry
│  │  └─ FilterClearEntry
│  ├─ VariantSwitcherView
│  │  ├─ VariantGroup
│  │  └─ VariantEntry
│  └─ AnimationModeView
│     ├─ StateTransitionPreview
│     ├─ ClickPlayPreview
│     ├─ PlayButton
│     └─ SkipButton
├─ PageSurface
│  ├─ PageSurfaceHeader
│  ├─ PageProjectionView
│  └─ PageLocalStateBoundary
├─ LocalOverlay
│  ├─ ConfirmDialog
│  ├─ ErrorDialog
│  └─ ResourceFallbackDialog
└─ FeedbackLayer
   ├─ PendingRegion
   ├─ LiveRegion
   ├─ ToastRegion
   └─ MotionCoordinator
```

不要把每个页面渲染成同一套圆角卡片，也不要把 AppShell 做成浏览器 chrome、SaaS dashboard 或固定三栏业务后台。ControlPanel 可以是半透明全息层，但 PageSurface 的背景/素材结构仍要可见。

## 6. 只读数据

使用以下最小数据模型。所有字段为只读 UI 投影；演示数据必须带 `source: 'mock'`，真实接线时可替换为 `source: 'projection'`。

```ts
type ShellSource = 'mock' | 'projection';
type ScreenState =
  | 'idle' | 'loading' | 'empty' | 'ready' | 'pending'
  | 'rejected' | 'stale' | 'timeout' | 'error' | 'safe-return';

type AnimationMode = 'state-transition' | 'click-play';

interface PageEntryProjection {
  pageId: string;
  label: string;
  family: string;
  categoryId: string;
  variants: readonly string[];
  screenState: ScreenState;
  source: ShellSource;
  selectable: boolean;
  disabledReason?: string;
}

interface ShellSnapshot {
  screen: 'control-panel-main';
  phase: ScreenState;
  currentPageId: string;
  currentVariantId: string;
  categoryId: string;
  animationMode: AnimationMode;
  pages: readonly PageEntryProjection[];
  revision: number;
  source: ShellSource;
}

interface IntentRequest {
  intentId: string;
  payload: Record<string, unknown>;
  requestId: string;
}
```

- `pages` 是目录投影，不是路由规则；`selectable: false` 必须同时提供 `disabledReason`。
- `screenState` 只描述呈现状态，不允许被组件推断为存档、匹配、战斗或业务事实。
- `source` 与 `revision` 可在开发期显示为审计信息，不能被视觉层隐藏成“真实加载成功”。

## 7. 动作意图

| intentId | payload | 视觉响应 | 明确不做 |
|---|---|---|---|
| `navigate.page` | `{ pageId }` | 当前 PageSurface 进入 pending，确认后切换 surface | 不移动角色、不推进旅程规则 |
| `navigate.category` | `{ categoryId }` | 过滤目录，保留隐藏页局部状态 | 不卸载页面、不改 projection |
| `navigate.variant` | `{ pageId, variantId }` | 替换呈现变体并播放 state-transition | 不改变玩法、权限或数据事实 |
| `presentation.play` | `{ mode, targetId }` | 播放 `state-transition` 或 `click-play` 预览 | 不结算动作、不触发后端业务 |
| `presentation.skip` | `{ targetId }` | 跳到已声明的演出终态 | 不改变规则结果 |
| `overlay.close` | `{ overlayId }` | 关闭 overlay、恢复触发器焦点 | 不隐式提交确认 |
| `shell.retry` | `{ failedSurface }` | 进入 retrying 并等待结果 | 不把 retrying 伪装成 ready |
| `shell.safe-return` | `{ targetPageId }` | 返回最近安全 UI surface | 不跳过错误记录 |

每次提交必须生成 `{ intentId, payload, requestId }`。鼠标、键盘、触控和手柄只允许共享同一个 intent builder。

## 8. 本地 UI 状态

允许本地保存：

- 当前 pageId、categoryId、variantId、animationMode、pageIndex。
- `pendingRequestId`、`lastIntentStatus`、`lastErrorReason`、重试计数和本地 timeout phase。
- hover、focus、active、selected、expanded、collapsed、tooltip、overlayOpen、reducedMotion、assetLoaded、animationPhase。
- 焦点来源 `focusOrigin` 和关闭 overlay 后的 `restoreTargetId`。

禁止本地保存或推导：

- HP、SP、AP、伤害、命中、匹配成功、存档存在、加载真实结果、任务完成、路径、节点位置或任何业务规则事实。
- 任何“点击页面就认为 accepted”的本地伪 projection。

## 9. 视觉令牌

- 背景：低饱和暖/冷全息投影光层；前景使用清晰像素边缘、半透明层、局部纹理、边缘光和接地阴影。允许 `assetRef`、`textureRef`、`iconRef`、`portraitRef`。
- `hover`：对应语义色的边缘发光、局部材质凸起、轻微上浮。
- `focus`：不被裁切的双层焦点环或明确外环，亮度和对比度高于 hover。
- `active`：短促内缩/高光加深，不能只改变颜色。
- `disabled`：扁平、降饱和、无成功高光，同时显示文字原因；灰色不是唯一语义。
- `pending`：橙色进行中、局部旋转/脉冲和“提交中”文字。
- `rejected/error`：红色边缘反馈、图标和原因；`stale` 使用灰白/黄色说明；`accepted` 使用绿色语义结果。
- ControlPanel 的分类色遵循全局语义，不为每个 category 另造主色；金/银只做少量高光。
- 资源缺失使用语义轮廓、图标、文字和原本的容器/空间位置；不得以 broken image 或大片空白作为唯一反馈。

## 10. 动效绑定

- AppShell 首次挂载：`contour-reveal` 显影背景与壳层，避免浏览器页面式瞬时闪现。
- 页面切换：使用 `AnimatePresence`、`layout`、spring 或声明式序列，采用短促余辉/轮廓显影；不表现空间穿越。
- 类别过滤：使用 `list-reflow`，被过滤项离开呈现但不删除状态；恢复过滤时回到原位置。
- 变体切换：局部 `semantic-highlight` + `afterglow-fade`，确认前显示 pending，确认后才播放结果演出。
- 点击预览：`click-play` 仅绑定按钮/条目确认；状态变化预览使用 `state-transition`，必须在 ControlPanel 中有明确标签。
- 失败、缺失资源、GPU/动画失败和用户跳过都进入 `settled`；降级顺序为指定配方 → 同语义默认配方 → 程序化反馈 → 图标/文字。
- `reducedMotion` 时去除非必要位移、闪烁、粒子和拖尾，保留顺序、焦点、文本和最终结果。
- 不使用动画推进页面权限、写入快照或替换 intent 结果。

## 11. 输入无障碍

- 所有页面条目、类别、变体和动画控件使用语义化 button/menu/listbox/tab 等可访问原语，不用仅有 click handler 的 div。
- 键盘支持 Tab/Shift+Tab、方向键、Enter、Space、Esc；页面目录分页可用 PageUp/PageDown 或明确分页按钮。
- 手柄支持方向导航、confirm、cancel；触控支持 tap，长列表支持滚动；所有路径调用相同 intent builder。
- ControlPanel 目录同屏最多 5 个并列选项；其余通过分页、分组或滚动访问。焦点顺序为当前任务顺序，不依赖 DOM 偶然顺序。
- 每个条目提供可读名称、当前 variant、source、disabled 原因和 pending/rejected/timeout 状态；LiveRegion 只播报语义结果，不逐个播报装饰粒子。
- 打开 ConfirmDialog/ErrorDialog/ResourceFallbackDialog 时焦点进入 FocusScope；关闭、取消或安全返回后回到 `restoreTargetId`。
- `reduced-motion` 和字幕/文字反馈不依赖音频；焦点环不可被 clip-path、overflow 或全屏动画裁掉。

## 12. 加载错误超时

- AppShell mounting：展示“正在准备界面（mock）”、阶段说明和可读 LiveRegion；超过有限阈值进入 timeout，而不是无限 spinner。
- 页面目录为空：进入 `empty`，说明“暂无可展示页面（mock）”，提供重新载入和安全返回；不渲染无意义的空白。
- ControlPanel 读取失败：进入 `error`，显示原因、`重试`、`取消`/`安全返回`；失败状态不播放成功切换动画。
- intent pending 超时：保留触发条目和 pending requestId，显示 `重试`、`取消`；不自动切换到目标页。
- 版本不兼容：显示“当前 UI 包版本不兼容（mock）”、稳定诊断 ID 和安全返回；不静默降级为未知页面。
- 资源缺失：保留组件位、assetRef 诊断、语义轮廓和文字；允许继续使用 UI，不借用语义错误素材。
- `stale`：显示“界面投影已过期（mock）”，请求重同步/重试；不得用旧值冒充最新结果。
- 所有错误都要可由键盘/手柄关闭或返回；焦点进入错误操作区，不落在空白背景。

## 13. 明确不做

- 不实现真实路由、后端协议、存档/匹配/设置写入、规则或玩法状态。
- 不实现地图节点、拓扑、路径、ORCA、碰撞或角色移动。
- 不实现 editor、research-bench、material-library、computer 的内部页面。
- 不把 ControlPanel 做成第二套游戏主菜单、地图浏览器、SaaS dashboard、浏览器 chrome 或统一卡片墙。
- 不把类别筛选/变体切换/动画预览当作玩法变体、资源扣除或规则触发。
- 不把 `+3极限爆发`暴露为可选择项；不引入第 4 节之外的新主色；不使用零素材完成口径。
- 不超过同屏 5 个并列选择，不用颜色、动画、音效或 hover 作为唯一操作路径。

## 14. 依赖交接

- 向 `B1-02` 交接：`AppShell` 的 loading/error/retry/safe-return 层、`PageSurface` 挂载点、`FeedbackLayer`、`pendingRequestId` 和焦点恢复入口。
- 向 `B1-03` 交接：`menu-title` 与 `utility-settings` 的稳定 pageId、variantId、`LocalOverlay` 和 `navigate.page`/`settings.*` intent 入口。
- 向 `B1-04` 交接：ControlPanel 的统一导航 API、`focusOrigin`、`restoreTargetId`、键盘/手柄方向导航和 LiveRegion contract。
- 向后续 B2/B3/B4/B5 交接：只提供抽象 `PageSurface` props、`StateSnapshot`、`IntentRequest` 和 asset slots；后续页面不修改 AppShell 层级，不建立自己的全局路由。
- 真实接线方只替换 mock provider 和 intent adapter；组件树、稳定 ID、可访问名称、错误状态和焦点顺序必须保持兼容。

## 15. 验收条件

- [ ] 无后端运行时能渲染 `AppShell → ControlPanel → PageSurface → LocalOverlay → FeedbackLayer` 单一层级。
- [ ] ControlPanel 可分页/分组浏览页面目录；同屏并列页面选项不超过 5。
- [ ] 页面切换、类别筛选、变体切换、`state-transition`、`click-play` 均可独立演示并有视觉/文字响应。
- [ ] 被筛掉页面不卸载、不丢局部状态；切换只改变 UI surface，不表现空间移动或玩法推进。
- [ ] 所有数据标记 `source: mock | projection`，所有 intent 带 `intentId`、`payload`、`requestId`。
- [ ] `pending`、accepted、rejected、stale、timeout 的视觉和文字语义可区分；失败不会显示成功动画。
- [ ] hover/focus/active/disabled/return 五态均可用鼠标和键盘验证；手柄与触控有等价路径。
- [ ] 打开、关闭和取消 overlay 后焦点正确进入并归还；屏幕阅读器可读出 pageId/label/source/disabled reason/result。
- [ ] 可演示 empty、loading、error、retrying、timeout、safe-return、资源缺失和版本不兼容，不出现无限 spinner 或无原因空白。
- [ ] 可挂载素材、纹理和光效；素材缺失仍保留语义结构与可读诊断，不采用零素材验收捷径。
- [ ] 如果显示 burst 预览，只能选择 0/1/2，`+3极限爆发`不可选但选择/触发特效槽位存在。
- [ ] 生成代码通过项目 TypeScript、相关测试、lint 和文档术语门禁；不能以 mock 成功替代失败路径。

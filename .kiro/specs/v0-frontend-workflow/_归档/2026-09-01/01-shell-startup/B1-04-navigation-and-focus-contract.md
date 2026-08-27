# B1-04 Navigation and Focus Contract Brief

## 1. 页面定位

这是 B1 全局导航、页面/分类/变体/动画切换和焦点管理的独立 contract brief。它既可作为 `control-panel-main` 的生成 brief，也可作为 `AppShell`、`startup-loading`、`menu-title`、`utility-settings` 以及后续页面接入时的统一导航约束。

本页面只实现 UI surface 的选择、聚焦、打开/关闭、错误恢复和表现演示。页面切换不是空间移动，类别筛选不是规则过滤，变体不是玩法变体，动画播放不是规则动作。所有操作只构造 `{ intentId, payload, requestId }`，由 mock/projection host 决定 accepted、rejected、stale 或 timeout。

焦点是跨页面的可见 UI 状态，不是业务状态。用户从鼠标、键盘、手柄、触控或屏幕阅读器执行同一动作时，必须进入同一个 intent builder 和同一套结果处理。打开 overlay、加载、错误、重试、取消、返回和安全返回都必须有可预测的焦点路径。

允许使用登记素材、纹理、光效、立绘和图标参与背景与界面。该 brief 是 UI-only、intent-only、mock/projection 驱动的契约，不执行业务规则；不以零素材渲染为目标，不把焦点管理做成无视觉层级的后台表格。它覆盖页面、分类、变体和动画切换，以及冷启动/加载/错误/超时/重试/安全返回的焦点路径；共享壳层 burst 只允许 MVP 0/1/2，`+3极限爆发`不可选，同屏选项不超过 5。

## 2. 权威来源（只写 attachmentId/provenance）

- attachmentId: `frontend-interaction-accessibility`  
  provenance: `keyboard-pad-touch-screen-reader-equivalence-focus-scope-five-state-and-five-option-limit`；当前结论：所有控件有 hover/focus/active/disabled/return 五态，Tab/方向键/Enter/Space/Esc/手柄/触控等价，同屏并列选项不超过 5。
- attachmentId: `frontend-port-contract`  
  provenance: `navigation-variant-filter-animation-intent-request-and-result-status`；当前结论：UI 只读 snapshot，通过 ActionPort 发 intent，pending 不等于 accepted，错误必须显式。
- attachmentId: `frontend-pages-batches`  
  provenance: `stable-pageId-variantId-category-index-and-B1-control-panel-boundary`；当前结论：ControlPanel 是主切换/抽取面，过滤不卸载页面状态，B1 提供后续页面挂载边界。
- attachmentId: `frontend-workflow-design`  
  provenance: `single-AppShell-control-panel-page-surface-overlay-feedback-layer`；当前结论：页面不得创建第二套全局路由或规则状态树，所有页面在同一壳层下切换。
- attachmentId: `frontend-fixtures`  
  provenance: `mock-screen-state-focus-label-disabled-reason-and-retry-safe-return-fixtures`；当前结论：可见 label、状态、shortcut、disabled reason、announcement 均来自 mock/projection，不由颜色推断。
- attachmentId: `frontend-motion-fallback`  
  provenance: `state-transition-click-play-skip-failure-and-reduced-motion-settled-result`；当前结论：动画只重演 UI 结果，跳过/失败/缺失资源与正常演出落到同一终态。
- attachmentId: `frontend-visual-token-contract`  
  provenance: `focus-ring-semantic-glow-material-holographic-layer-and-asset-fallback`；当前结论：焦点环不可裁切，状态不能只靠颜色，背景和可替换素材应成为界面空间的一部分。
- attachmentId: `frontend-conflict-ruling`  
  provenance: `current-title-ruling-burst-tier-white-transition-and-heritage-only-conflict-handling`；当前结论：标题是启动前置，`+3极限爆发`不可选，未裁决冲突应人工复核/安全返回而非猜测。
- attachmentId: `frontend-pages-batches`  
  provenance: `full-journey-failure-paths-retry-cancel-safe-return-and-B1-no-dependency`；当前结论：启动/标题/控制面板可在无后端独立演示，失败路径必须有 retry/cancel/safe-return。

## 3. 当前决策

- 唯一全局层级：`AppShell → ControlPanel → PageSurface → LocalOverlay → FeedbackLayer`。所有页面通过 `ControlPanel` 或 host 提供的稳定导航 surface 进入，不在页面内部创建第二套路由。
- 固定页面操作：
  - 页面切换 `navigate.page`：切换 `pageId` 的 UI surface。
  - 类别筛选 `navigate.category`：只改变页面目录呈现，被筛掉的页面不卸载、不丢状态。
  - 变体切换 `navigate.variant`：切换当前 pageId 的呈现 variantId，不改变权限、玩法或数据事实。
  - 动画模式 `presentation.play`：选择 `state-transition` 或 `click-play`，只播放表现层预览。
- 页面 ID、类别 ID、变体 ID 和 intentId 必须使用 B1-00/B1-01 定义的固定名称。禁止因视觉偏好自由改名或用显示文本作为契约。
- 页面目录可能超过 5 项，必须分页、分组或滚动；任何同屏并列可操作选项最多 5。当前筛选组、页码和展开项是本地 UI 状态。
- 导航失败不自动跳到默认页。`rejected` 保留当前 surface 并读出原因，`stale` 请求重同步/重试，`timeout` 提供重试/取消/安全返回，`version-incompatible` 进入安全返回。
- 安全返回使用只读 `safeReturnTarget`，通常为最近确认的 `menu-title` 或 `control-panel-main`；不得根据点击路径自行猜测业务落点。
- Overlay 打开时使用 FocusScope；焦点进入首个有效控件/标题；关闭、取消、Esc 或安全返回后回到触发器或明确安全目标。
- 页面切换成功后，焦点按 `focusPolicy` 进入新页面的首个有效目标、页面标题或 projection 指定目标；不把焦点留在已卸载/隐藏元素。
- 保存、继续、新游戏、退出、重试和安全返回全部是 intent-only；导航成功/失败由 IntentResult 或新 projection 决定。
- 标题四入口、新游戏到出租屋、无存档继续 disabled、完整六类设置、保存/取消/默认失败处理和加载错误路径都必须通过本 contract 的焦点和结果处理。
- 如果共享壳层出现 burst selector，只允许 MVP `0/1/2`；`+3极限爆发`不可选择但保留 selection/trigger presentation slot。

## 4. 状态机

```text
focus-unmounted
  -> focus-initializing
  -> focus-ready

focus-ready
  -> focusable
  -> focused
  -> active
  -> returning
  -> disabled

focused
  -> active
  -> overlay-opening
  -> page-switching
  -> category-switching
  -> variant-switching
  -> animation-previewing
  -> returning

active
  -> intent-pending
  -> overlay-opening
  -> returning

intent-pending
  -> intent-accepted -> navigation-settling
  -> intent-rejected -> rejected-feedback
  -> intent-stale -> resyncing
  -> intent-timeout -> timeout-feedback

navigation-settling
  -> page-focus-enter
  -> page-idle

rejected-feedback
  -> focus-restore
  -> retrying
  -> safe-return

timeout-feedback
  -> retrying
  -> cancel-pending
  -> safe-return

resyncing
  -> page-focus-enter
  -> error-feedback

page-focus-enter
  -> focused
  -> page-idle

overlay-opening
  -> overlay-focused

overlay-focused
  -> overlay-confirm-pending
  -> overlay-cancelled -> focus-restore
  -> overlay-closed -> focus-restore

overlay-confirm-pending
  -> intent-accepted
  -> intent-rejected -> overlay-error
  -> intent-timeout -> overlay-error

overlay-error
  -> overlay-focused
  -> retrying
  -> safe-return

focus-restore
  -> focused
  -> safe-focus

safe-return
  -> safe-focus
  -> page-idle

animation-previewing
  -> animation-settled
  -> animation-skipped
  -> animation-failed
  -> focused
```

- `focusable/focused/active/returning/disabled` 是控件视觉状态；`intent-accepted` 是 host 结果，二者不能混用。
- 隐藏或卸载页面上的焦点必须在切换前移走；错误/加载期间焦点只能在可读且可操作的反馈区域。
- `reducedMotion` 只影响本地表现阶段，不改变状态机顺序和最终焦点。

## 5. 组件树

```text
NavigationFocusRoot
├─ AppShell
│  ├─ GlobalFocusScope
│  ├─ ShellBackdropLayer
│  ├─ ControlPanel
│  │  ├─ NavigationHeader
│  │  │  ├─ CurrentPageAnnouncer
│  │  │  ├─ SourceBadge
│  │  │  └─ ShellStatusBadge
│  │  ├─ PageNavigationGroup
│  │  │  ├─ PageGroupHeader
│  │  │  ├─ PageEntry
│  │  │  └─ PagePagination
│  │  ├─ CategoryNavigationGroup
│  │  │  ├─ CategoryEntry
│  │  │  └─ CategoryResetEntry
│  │  ├─ VariantNavigationGroup
│  │  │  ├─ VariantEntry
│  │  │  └─ VariantDescription
│  │  └─ AnimationNavigationGroup
│  │     ├─ StateTransitionEntry
│  │     ├─ ClickPlayEntry
│  │     ├─ PlayAnimationButton
│  │     └─ SkipAnimationButton
│  ├─ PageSurface
│  │  ├─ PageHeading
│  │  ├─ PageFocusAnchor
│  │  ├─ PageProjectionView
│  │  └─ PageLocalStateBoundary
│  ├─ LocalOverlay
│  │  ├─ ConfirmDialog
│  │  ├─ ErrorDialog
│  │  ├─ SettingsDialog
│  │  └─ ResourceFallbackDialog
│  └─ FeedbackLayer
│     ├─ PendingRegion
│     ├─ ErrorRegion
│     ├─ ToastRegion
│     ├─ LiveRegion
│     └─ MotionCoordinator
└─ FocusRestoreRegistry
   ├─ TriggerRefRegistry
   ├─ PageFocusPolicy
   └─ SafeFocusTarget
```

- `FocusRestoreRegistry` 只记录 DOM/组件焦点引用和语义目标，不记录业务事实。
- `PageFocusAnchor` 是页面切换时的稳定安全焦点；如果页面提供 projection 指定首目标，优先使用它，否则使用 heading/首个可用控件。
- `PageEntry`、`CategoryEntry`、`VariantEntry` 和按钮都必须是语义化可访问控件，不能使用无角色的 div click。

## 6. 只读数据

```ts
type NavigationSource = 'mock' | 'projection';
type NavigationState =
  | 'idle' | 'loading' | 'empty' | 'ready' | 'pending'
  | 'rejected' | 'stale' | 'timeout' | 'error' | 'safe-return';

type FocusPolicy =
  | 'first-action'
  | 'page-heading'
  | 'projection-target'
  | 'restore-trigger'
  | 'safe-target';

interface NavigationEntryProjection {
  id: string;
  label: string;
  description: string;
  disabled: boolean;
  disabledReason?: string;
  shortcut?: string;
  source: NavigationSource;
}

interface PageNavigationProjection extends NavigationEntryProjection {
  pageId: string;
  categoryId: string;
  variants: readonly string[];
  focusPolicy: FocusPolicy;
  state: NavigationState;
}

interface NavigationSnapshot {
  pageId: string;
  variantId: string;
  categoryId: string;
  animationMode: 'state-transition' | 'click-play';
  pageIndex: number;
  pageEntries: readonly PageNavigationProjection[];
  categoryEntries: readonly NavigationEntryProjection[];
  variantEntries: readonly NavigationEntryProjection[];
  safeReturnTarget: string;
  source: NavigationSource;
  revision: number;
}

interface FocusSnapshot {
  activeSurfaceId: string;
  focusOriginId?: string;
  restoreTargetId?: string;
  focusPolicy: FocusPolicy;
  source: NavigationSource;
}
```

- `disabled`、label、description、shortcut、focusPolicy 和 announcement 都来自 fixture/projection，不能从颜色、DOM 顺序或 pageId 猜测。
- `NavigationSnapshot` 只描述 UI 导航目录和呈现状态；它不包含存档、匹配、规则、位置、资源扣除或业务完成事实。
- mock fixture 至少覆盖目录 ready/empty、导航 pending/rejected/stale/timeout、无存档 continue disabled、设置类别切换、资源缺失和版本不兼容。
- `FocusSnapshot` 只用于焦点恢复；它不代表玩家所在位置或游戏路由。

## 7. 动作意图

| intentId | payload | 触发 | UI 结果 | 明确不做 |
|---|---|---|---|---|
| `navigate.page` | `{ pageId, focusPolicy? }` | 选择页面条目 | pending，accepted 后切换 PageSurface 并按 policy 聚焦 | 不做空间移动/规则推进 |
| `navigate.category` | `{ categoryId, pageIndex? }` | 选择类别 | 目录过滤/分页，保留隐藏状态 | 不卸载页面、不改变 projection |
| `navigate.variant` | `{ pageId, variantId }` | 选择呈现变体 | 变体 pending/confirmed | 不改变玩法变体或权限 |
| `presentation.play` | `{ mode, targetId }` | 选择动画模式/播放 | 播放 state-transition 或 click-play | 不执行规则动作 |
| `presentation.skip` | `{ targetId }` | Skip/缩短动画 | 进入相同 settled 终态 | 不提前提交业务动作 |
| `focus.move` | `{ direction, fromId }` | 键盘/手柄方向移动 | 更新本地焦点 | 不产生页面或业务导航 |
| `overlay.open` | `{ overlayId, triggerId }` | 打开设置/确认/错误层 | FocusScope 打开并进入首个有效焦点 | 不隐式确认 |
| `overlay.close` | `{ overlayId, restoreTargetId }` | Esc/取消/关闭 | 关闭 overlay，恢复触发器 | 不提交 overlay 主动作 |
| `navigation.retry` | `{ failedIntentId }` | 错误/超时重试 | retrying/pending | 不把重试当成功 |
| `navigation.cancel` | `{ requestId, returnTo }` | 取消 pending | 取消请求，回到来源或安全焦点 | 不清除诊断 |
| `navigation.safe-return` | `{ targetPageId, reason }` | 版本/错误安全返回 | safe-return 后进入安全目标 | 不猜测业务落点 |

每个 intent 都生成 `{ intentId, payload, requestId }`。鼠标 click、键盘 Enter/Space、手柄 confirm、触控 tap/long-press 必须调用同一 builder；方向移动是本地 UI focus，不绕过 intent contract 直接改 pageId。

## 8. 本地 UI 状态

允许本地保存：

- `currentPageId`、`currentVariantId`、`currentCategoryId`、`pageIndex`、展开/折叠组、滚动位置、`animationMode`。
- `focusedId`、`focusOriginId`、`restoreTargetId`、`focusPolicy`、FocusScope 栈、最后一个安全焦点。
- `pendingRequestId`、lastIntentStatus、错误/timeout/stale 文案展开、retrying、toast/live region 已播报状态。
- hover、focus、active、selected、disabled、expanded、reducedMotion、assetLoaded、animationPhase。

禁止本地保存或推断：

- page switch accepted、设置 saved、继续成功、存档存在、匹配成功、玩家位置、玩法阶段或其它业务事实。
- 通过 DOM 顺序替代 projection 的 disabled reason/shortcut/focus policy。
- 在页面隐藏期间清除其 local UI state；筛选只影响呈现。
- 通过 focus movement 改写任何业务状态。

## 9. 视觉令牌

- 全局视觉是像素前景 + 暖/冷全息投影背景 + 半透明层，允许登记素材、纹理、光效、立绘和 icon slot；ControlPanel 不能退化成统一卡片墙。
- `hover`：语义边缘发光、材质凸起、轻微上浮；`focus`：高对比双层外环/内光，环必须可见且不被裁切；`active`：短促内缩/高光加深；`disabled`：扁平降饱和、文字原因和 disabled icon；`return`：回基线。
- pending 用橙色进行中；rejected/error 用红色；stale/timeout 用灰白/黄色说明；accepted 使用绿色结果；safe-return 使用中性/白色安全落点语义。
- 颜色不作为唯一信息：每个状态配合文字、图标、形状、纹理或材质；无存档、不可用、版本不兼容和错误必须有可读原因。
- 页面/类别/变体的高亮只表示当前 UI 选择，不表示玩家在地图上移动或拥有规则权限。
- 资源缺失保留原空间、占位轮廓和 assetRef 诊断；不借用语义错误素材，不用 blank/broken image 作为唯一反馈。
- 使用 pure white/cream 仅表达梦境边界/过载或明确仪式，不把白幕用于普通导航背景；`+3` 不得以可选高亮方式出现。

## 10. 动效绑定

- 初次焦点初始化：使用 `contour-reveal`/局部 `semantic-highlight` 显示首个安全焦点，不能依赖焦点瞬移而无反馈。
- 页面切换：使用 `AnimatePresence`、`layout`、spring、`list-reflow` 或 `afterglow-fade`，维持 UI 空间连续；不表现角色移动或地图穿越。
- 类别筛选/分页：使用 `list-reflow`，条目平滑让位；过滤项隐藏但 local state 保留；恢复时回到原组/页。
- 变体切换：使用局部轮廓显影/语义高亮；只有 accepted/projection 后播放确认结果，rejected/stale/timeout 使用回弹/错误反馈。
- Overlay：使用短遮罩和局部滑入，焦点进入后才允许操作；关闭使用回收/余辉，焦点先恢复再继续页面交互。
- Focus move：hover/focus 使用短反馈，不用持续闪烁；active 是短内缩，return 回基线。
- `state-transition` 只由 UI state/projection 改变触发；`click-play` 只由用户确认触发；ControlPanel 必须清晰区分两个模式。
- 缺失资源、动画失败、用户 skip、reduced motion 都落到相同 settled UI 状态；不改变 intent 结果、不执行规则。

## 11. 输入无障碍

- 支持 Tab/Shift+Tab、方向键、Enter、Space、Esc；菜单分页/分组支持明确的分页按钮和返回上一级。手柄支持方向导航、confirm、cancel；触控支持 tap/滚动/长按等价路径。
- 所有交互使用语义化 button、menu、listbox、tab、dialog、group 等原语，提供 accessible name、role、state、description、shortcut 和 disabled reason。
- 方向键在当前 group 内移动焦点，不提交 page intent；Enter/Space/手柄 confirm 才选择条目；Esc 通常关闭当前 overlay，不隐式提交。
- 同屏并列选项最多 5；超出必须分页、分组或滚动，且焦点不会跳入不可见/卸载项。分页后明确宣读当前页和总页数，技术总数可作为结构信息。
- 打开 overlay 时焦点进入标题或首个有效控件；关闭、取消、Esc 后按 `restoreTargetId` 回焦点。触发器被卸载时使用 `safeReturnTarget`/`PageFocusAnchor`。
- 页面切换后按 `focusPolicy` 聚焦：projection-target → first-action → page-heading → safe-target；目标 disabled/缺失时按该优先级选择下一个可用目标并播报原因。
- 加载/错误/超时状态焦点进入 retry/cancel/safe-return；错误 LiveRegion 读出状态、原因、requestId 的可读摘要和下一步。焦点不能落在空白背景或被禁用条目。
- 屏幕阅读器不读取隐藏页面、装饰粒子或不可见 overlay 内容；颜色、光效、音频都不能泄露隐藏业务信息。
- reduced motion、字幕、高对比、文字放大不会删除焦点顺序或结果；焦点环始终可见，文字放大不裁切关键按钮。

## 12. 加载错误超时

- 页面目录 loading：显示阶段、当前页/组和可用取消/安全返回；不使用无限 spinner。
- 目录 empty：显示“暂无可导航页面（mock）”、重试和安全返回；焦点进入重试或返回。
- 页面切换 timeout：保留原页、显示目标 pageId/原因、重试/取消/安全返回；不跳到默认页。
- rejected：显示 host 提供的拒绝原因；不播放成功页面 transition，焦点回到原触发器或错误操作区。
- stale：提示“导航投影已过期（mock）”，提供重同步/重试；不把旧 snapshot 静默当最新。
- variant/category/animation preview 失败：保留当前合法呈现，显示局部错误、重试/取消；不改变业务权限或页面规则。
- overlay open/close 失败：保持当前焦点在可操作区域，提供关闭/安全返回；不把 overlay 误认为已关闭/已确认。
- 版本不兼容或未知冲突：显示稳定诊断和人工复核/安全返回，不自行生成页面或规则版本。
- 资源缺失：保留组件位、assetRef、语义轮廓和文字；素材加载不应阻塞焦点导航，音频/粒子缺失也不阻塞结果。
- 任何 pending 超过有限阈值进入 timeout；retrying 仍显示 retrying，不自动变成 accepted。

## 13. 明确不做

- 不实现真实路由、后端/网络、账号/存档、规则、地图、节点、拓扑、ORCA、寻路、路径成本或业务回调。
- 不创建第二套 global navigation、状态树、规则 store 或隐藏业务缓存；不把 page/category/variant 切换定义成玩法状态。
- 不把同屏选项扩展到 5 个以上，不用颜色、hover、动画、音效或焦点环作为唯一操作/结果通道。
- 不在加载/错误/超时后静默跳转，不将 rejected/stale/timeout 当 accepted，不以 mock 成功覆盖失败。
- 不实现 editor、research-bench、material-library、computer 的内部页面；这些不出现在正常导航目录中。
- 不把 `+3极限爆发`做成可选项，不引入新的主色、零素材验收口径或语义错误素材替换。
- 不让动画推进状态、让 focus move 提交业务 intent、或通过辅助技术/预加载泄露隐藏信息。

## 14. 依赖交接

- 从 `B1-01` 接收 AppShell、ControlPanel、PageSurface、LocalOverlay、FeedbackLayer、稳定 page/category/variant ID 和统一 intent adapter。
- 从 `B1-02` 接收 startup loading/error/timeout/retry/cancel/safe-return 语义、焦点进入下一步的错误路径和 `safeReturnTarget`。
- 从 `B1-03` 接收标题四入口、无存档 continue disabled、六类设置、保存/取消/默认失败状态、标题/设置焦点顺序和 overlay restoreTarget。
- 向后续 B2/B3/B4/B5 交接：页面接入只需提供 stable pageId、variantId、`focusPolicy`、accessible labels、disabled reasons、projection fixture 和 intent mapping；不得各自实现焦点恢复或第二套路由。
- 真实接线方只替换 provider/adapter，不改变 `NavigationSnapshot`、`FocusSnapshot`、intentId、错误状态、焦点策略和五态契约。
- 素材只通过 `assetRef`/manifest slot 接入；本 brief 不修改素材生产/加载管线。

## 15. 验收条件

- [ ] 无后端 mock 环境可完成页面切换、类别筛选、分页/分组、变体切换以及 state-transition/click-play 两种预览。
- [ ] 所有导航动作提交 `{ intentId, payload, requestId }`；pending、accepted、rejected、stale、timeout 视觉和文字可区分。
- [ ] 同屏并列可操作选项始终不超过 5；超出目录通过分页、分组或滚动访问，隐藏页面状态不丢失。
- [ ] 页面切换只改变 UI surface，不表现空间移动、地图导航或玩法推进；变体只改变呈现。
- [ ] 每个控件具备 hover/focus/active/disabled/return 五态；disabled 同时有可读原因和非颜色语义。
- [ ] 键盘、鼠标、手柄、触控、屏幕阅读器可完成标题新游戏/继续/选项/退出、设置分类/编辑、加载重试/取消/安全返回路径。
- [ ] 打开任何 overlay 焦点进入 FocusScope；关闭/取消/Esc 后焦点回触发器；触发器消失时回 safe target。
- [ ] 页面切换后焦点按 projection/first-action/page-heading/safe-target 策略进入可操作目标；焦点不落隐藏、卸载、空白或禁用区域。
- [ ] 加载、empty、rejected、stale、timeout、error、asset-missing、version-incompatible 均有文字原因、LiveRegion 和 retry/cancel/safe-return 合法路径。
- [ ] reduced motion、字幕、文字放大和高对比不破坏焦点顺序、状态文本或最终结果；焦点环不裁切。
- [ ] 允许登记素材、纹理、光效和 icon/asset slot；资源缺失保留结构和语义占位，不使用零素材捷径。
- [ ] 共享壳层若显示 burst，只可选 0/1/2，`+3极限爆发`不可选但 selection/trigger effect 槽位存在。
- [ ] 生成代码不访问后端路径、不写业务状态，并通过项目 TypeScript、相关测试、lint 和文档术语门禁。

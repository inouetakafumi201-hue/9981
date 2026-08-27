# B1-03 Title Menu and Settings Brief

## 1. 页面定位

这是 WakeUp 的 `menu-title` 标题画面与 `utility-settings` 设置面板 brief。它们是启动壳层里的 UI surface，可脱离后端独立演示；本 brief 只描述视觉、局部 UI 状态、只读 mock/projection 和声明式 intent，不实现真实存档、真实设置写入、规则或网络。

标题画面是壳层最外层启动前置，固定提供四个入口：`新游戏`、`继续`、`选项`、`退出`。`新游戏` 的 UI 目标是出租屋 `residence-main`，不是直接进入对局；床仍是后续装载入口，纯白显形仍是入梦/返回唯一传送语汇。`继续` 必须能展示有存档、无存档、恢复中、恢复失败和超时。`选项`打开完整六类设置。`退出`先进入确认 overlay，确认和取消都是 intent。

设置面板必须完整覆盖显示、声音、输入、无障碍、语言、图形六类。由于同屏并列选项不得超过 5，六类设置不能依赖六个同时并列的 tab；使用分页、分组、折叠或单列导航，但六类都必须可访问。设置修改进入本地 draft/preview，保存、取消、恢复默认均提交 intent。mock adapter 必须提供保存失败、取消失败和恢复默认失败的可见路径；失败不得被渲染成成功。整个 brief 是 UI-only、intent-only、mock/projection 驱动；允许登记素材、纹理、光效和图标，不以零素材为目标。冷启动/加载、加载失败、资源缺失、版本不兼容、重试、超时和安全返回都必须保持可见且可恢复；共享壳层的 burst 只允许 MVP 0/1/2，`+3极限爆发`不可选。

## 2. 权威来源（只写 attachmentId/provenance）

- attachmentId: `frontend-workflow-requirements`  
  provenance: `title-startup-prelude-four-entry-menu-and-six-category-settings`；当前结论：标题画面为启动前置，必须有新游戏/继续/选项/退出，选项必须覆盖显示、声音、输入、无障碍、语言、图形。
- attachmentId: `frontend-pages-batches`  
  provenance: `menu-title-utility-settings-B1-pageId-family-state-and-variant-index`；当前结论：`menu-title` 和 `utility-settings` 属 B1，稳定 pageId/variantId 不得自由改名。
- attachmentId: `journey-current-ruling`  
  provenance: `title-new-game-to-residence-bed-load-entry-white-manifestation-only-transport`；当前结论：新游戏落地出租屋而不是直接入局，床是装载入口，入梦/返回统一纯白显形。
- attachmentId: `frontend-port-contract`  
  provenance: `menu-settings-intent-only-mock-to-projection-and-result-status`；当前结论：标题和设置只读取快照，通过 ActionPort 发 intent；保存/导航只有 accepted 或新 projection 才能显示确认。
- attachmentId: `frontend-fixtures`  
  provenance: `menu-save-availability-settings-draft-and-failure-fixtures`；当前结论：fixture 明确标记 `source: mock`，支持有存档/无存档、pending、rejected、timeout、error 等状态。
- attachmentId: `frontend-interaction-accessibility`  
  provenance: `menu-keyboard-pad-touch-focus-scope-and-five-state-contract`；当前结论：菜单和设置的鼠标、键盘、手柄、触控、屏幕阅读器路径等价，overlay 关闭后焦点回到触发器，同屏并列选项最多 5。
- attachmentId: `frontend-visual-token-contract`  
  provenance: `pixel-foreground-holographic-background-semantic-menu-and-material-language`；当前结论：标题不是网页首页或卡片墙，采用像素前景+全息投影背景，可使用登记素材、纹理和光效。
- attachmentId: `frontend-motion-fallback`  
  provenance: `title-entry-settings-overlay-save-failure-and-reduced-motion-feedback`；当前结论：动画只重演 UI 结果；跳过、缺失或失败不改变结果，错误必须有文字和可恢复操作。
- attachmentId: `frontend-conflict-ruling`  
  provenance: `title-ruling-replaces-legacy-no-main-menu-startup-text-and-preserves-white-gate`；当前结论：旧“无传统主菜单”只保留为历史边界，当前启动必须落地标题画面；未收口冲突不自行猜测。

## 3. 当前决策

- `menu-title` 固定入口和 intent：
  - `new-game` / `menu.new-game`：提交新游戏意图，目标 projection 为 `residence-main`；不直接进入 HUD、匹配或对局。
  - `continue` / `menu.continue`：当 `hasSave=true` 时提交恢复意图；`hasSave=false` 时 disabled 且显示“无存档（mock）”原因，不得提交恢复。
  - `options` / `menu.options`：打开 `utility-settings` overlay/surface，不写设置。
  - `quit` / `menu.quit`：打开退出确认，不立即离开。
- 退出确认有 `确认退出` 与 `取消`；确认只提交 `menu.quit-confirm`，取消/Esc 提交或执行 `overlay.close` 的 UI intent，焦点回到 `quit`。
- 标题菜单可用 `title` variant；选项打开后保持标题背景/氛围可见，使用半透明全息层，不变成浏览器 chrome、SaaS dashboard 或统一卡片墙。
- `utility-settings` 固定六类：
  - `settings-display`：分辨率、全屏、UI 缩放。
  - `settings-sound`：主音量、音乐、音效、语音、UI 音量；音频槽位可缺失，文字反馈不能缺失。
  - `settings-input`：键盘键位、手柄按键/布局、振动开关或强度预览；只编辑本地 draft。
  - `settings-accessibility`：reduced motion、字幕、增强对比度、文字大小/布局预览。
  - `settings-language`：语言选择与本地化预览。
  - `settings-graphics`：质量 profile、粒子/效果 profile、分辨率相关质量说明。
- 每类设置提供明确 label、当前值、可调整控件、disabled 原因和 preview 状态。显示/声音/输入/无障碍/语言/图形六类必须都可到达；同屏并列选项不超过 5。
- 设置值分为 `draft` 和只读 `snapshot`。调整只更新本地 draft 并提交 `settings.preview`；保存提交 `settings.save`，取消提交 `settings.cancel`，恢复默认提交 `settings.restore-defaults`。
- mock fixture 对保存、取消和恢复默认提供 `rejected`/`timeout` 失败态。失败必须保留 draft、显示原因并提供重试/关闭/安全返回；不得清空 draft 或显示 saved。
- 只有收到 `accepted` 或新 projection 后，才显示 `saved`/`defaults-applied` 等确认状态。关闭设置后焦点回到 `options` 或打开设置的入口。
- 所有值只用于 UI 展示，玩家可见数值遵守 1–5；音量、UI 缩放等可使用受控显示 profile，但不要创造玩法经济或规则字段。
- 若共享壳层出现 burst 预览，只能选择 `0/1/2`；`+3极限爆发`只能显示为不可选的未来评估预留，选择特效和触发特效必须保留。

## 4. 状态机

```text
title-mounting
  -> title-idle

title-idle
  -> menu-item-focused
  -> menu-item-active
  -> options-open
  -> quit-confirm-open
  -> title-navigation-pending

menu-item-focused
  -> menu-item-active
  -> title-idle

menu-item-active
  -> title-navigation-pending
  -> options-open
  -> quit-confirm-open
  -> title-idle

title-navigation-pending
  -> title-navigation-accepted -> title-transitioning
  -> title-navigation-rejected -> title-idle
  -> title-navigation-timeout -> title-error
  -> title-navigation-stale -> title-resync

title-transitioning
  -> residence-target-ready
  -> title-error

options-open
  -> settings-category-focused
  -> settings-draft-editing
  -> settings-preview-pending
  -> settings-save-pending
  -> settings-cancel-pending
  -> settings-defaults-pending
  -> options-close-pending

settings-category-focused
  -> settings-draft-editing
  -> options-open

settings-draft-editing
  -> settings-preview-pending
  -> settings-save-pending
  -> settings-cancel-pending
  -> settings-defaults-pending
  -> options-close-pending

settings-preview-pending
  -> settings-draft-editing
  -> settings-error

settings-save-pending
  -> settings-saved
  -> settings-error
  -> settings-timeout

settings-cancel-pending
  -> settings-cancelled
  -> settings-error

settings-defaults-pending
  -> settings-defaults-applied
  -> settings-error

settings-saved / settings-cancelled / settings-defaults-applied
  -> settings-draft-editing
  -> options-close-pending

settings-error / settings-timeout
  -> settings-draft-editing
  -> settings-retrying
  -> safe-return

quit-confirm-open
  -> quit-confirm-pending
  -> quit-confirm-cancelled -> title-idle
  -> title-idle

quit-confirm-pending
  -> quit-requested
  -> title-idle
  -> title-error

safe-return
  -> title-idle
  -> control-panel-safe-surface
```

- `menu-item-active`、`settings-save-pending` 等本地状态不是业务确认；确认必须来自 `IntentResult`/projection。
- `continue` 的 `empty` 分支不可进入恢复 pending；它应保持可读 disabled 状态并允许选择新游戏、选项或退出。
- 任何错误、超时或 stale 状态都保留原因并可重试/取消/安全返回。

## 5. 组件树

```text
TitleMenuAndSettingsRoot
├─ TitleSceneLayer
│  ├─ TitleBackdropAsset
│  ├─ HolographicLightField
│  ├─ RegisteredTextureSlot
│  ├─ TitleMark
│  └─ TitleAmbientEffect
├─ TitleMenuSurface
│  ├─ TitleMenuHeader
│  │  ├─ GameTitle
│  │  └─ SourceBadge
│  ├─ TitleMenuList
│  │  ├─ NewGameEntry
│  │  ├─ ContinueEntry
│  │  ├─ OptionsEntry
│  │  └─ QuitEntry
│  ├─ SaveAvailabilityNotice
│  └─ TitleStatusRegion
├─ QuitConfirmOverlay
│  ├─ QuitConfirmMessage
│  ├─ QuitConfirmButton
│  └─ QuitCancelButton
├─ SettingsSurface
│  ├─ SettingsHeader
│  │  ├─ SettingsTitle
│  │  ├─ DraftStatusBadge
│  │  └─ SourceBadge
│  ├─ SettingsCategoryNavigator
│  │  ├─ DisplayCategoryEntry
│  │  ├─ SoundCategoryEntry
│  │  ├─ InputCategoryEntry
│  │  ├─ AccessibilityCategoryEntry
│  │  ├─ LanguageCategoryEntry
│  │  └─ GraphicsCategoryEntry
│  ├─ SettingsCategorySurface
│  │  ├─ DisplaySettingsGroup
│  │  ├─ SoundSettingsGroup
│  │  ├─ InputSettingsGroup
│  │  ├─ AccessibilitySettingsGroup
│  │  ├─ LanguageSettingsGroup
│  │  └─ GraphicsSettingsGroup
│  ├─ SettingsPreviewRegion
│  ├─ SettingsActionBar
│  │  ├─ SaveSettingsButton
│  │  ├─ CancelSettingsButton
│  │  └─ RestoreDefaultsButton
│  └─ SettingsFeedbackRegion
├─ FocusScope
└─ FeedbackLayer
   ├─ PendingRegion
   ├─ ErrorRegion
   ├─ LiveRegion
   └─ MotionCoordinator
```

标题菜单应像游戏世界中的标题场景：标题、氛围和入口层级悬浮于全息光层之上，不做四张等宽按钮卡片。设置面板是需要时出现的半透明工具层，不能覆盖成独立网页后台。

## 6. 只读数据

```ts
type MenuScreenState =
  | 'idle' | 'focused' | 'pending' | 'empty' | 'ready'
  | 'rejected' | 'stale' | 'timeout' | 'error' | 'safe-return';

type SettingsCategoryId =
  | 'settings-display'
  | 'settings-sound'
  | 'settings-input'
  | 'settings-accessibility'
  | 'settings-language'
  | 'settings-graphics';

type UiSource = 'mock' | 'projection';

interface TitleMenuProjection {
  pageId: 'menu-title';
  variantId: 'title';
  screenState: MenuScreenState;
  selectedEntry: 'new-game' | 'continue' | 'options' | 'quit';
  hasSave: boolean;
  continueState: 'available' | 'empty' | 'loading' | 'rejected' | 'timeout';
  source: UiSource;
  revision: number;
}

interface SettingsSnapshot {
  pageId: 'utility-settings';
  variantId: 'settings';
  selectedCategory: SettingsCategoryId;
  screenState: MenuScreenState;
  values: Readonly<{
    resolution: string;
    fullscreen: boolean;
    uiScale: string;
    masterVolume: string;
    musicVolume: string;
    effectsVolume: string;
    voiceVolume: string;
    uiVolume: string;
    keyboardProfile: string;
    gamepadProfile: string;
    reducedMotion: boolean;
    subtitles: boolean;
    highContrast: boolean;
    textSize: string;
    language: string;
    quality: string;
  }>;
  source: UiSource;
  revision: number;
}

interface SettingsDraft {
  values: Partial<SettingsSnapshot['values']>;
  dirty: boolean;
  source: 'local-draft';
}
```

- `TitleMenuProjection` 的 `hasSave=false` 是无存档 fixture 事实，只能渲染 disabled 和原因，不能由组件自行探测。
- `SettingsSnapshot.values` 是只读投影；`SettingsDraft` 只承载 UI preview，不代表已保存。
- 所有 mock 数据必须显示 `source: mock` 或 `local-draft`，接受 projection 时组件树不变。
- 设置字段是界面展示值，不推导音频实际音量、显示器实际分辨率、输入设备能力或图形性能。

## 7. 动作意图

| intentId | payload | 触发和视觉响应 | 明确不做 |
|---|---|---|---|
| `menu.new-game` | `{ targetPageId: 'residence-main' }` | pending 后展示前往出租屋的 UI 过渡 | 不直接入梦、不进入 HUD、不创建存档 |
| `menu.continue` | `{ targetPageId: 'residence-main' }` | pending 后等待 restore projection | 无存档时不提交，不本地伪造恢复 |
| `menu.options` | `{ targetPageId: 'utility-settings' }` | 打开设置 surface/overlay，焦点进入首个有效控制 | 不写设置 |
| `menu.quit` | `{ overlayId: 'quit-confirm' }` | 打开退出确认，焦点进入确认区 | 不立即退出 |
| `menu.quit-confirm` | `{ confirmed: true }` | pending，等待 host 结果 | 不关闭进程、不写业务状态 |
| `overlay.close` | `{ overlayId }` | 关闭 overlay，焦点回触发器 | 不隐式确认 |
| `settings.select-category` | `{ categoryId }` | 切换设置组，保留 draft 和滚动位置 | 不改变设置值 |
| `settings.preview` | `{ categoryId, key, value }` | 更新本地 draft 并显示 pending/preview | 不持久化、不调用后端路径 |
| `settings.save` | `{ changedKeys }` | 显示 saving；接受后显示 saved，失败保留 draft | 不把点击当作成功 |
| `settings.cancel` | `{ changedKeys }` | 发送取消 intent；接受后恢复 snapshot | mock 失败时不强制丢 draft |
| `settings.restore-defaults` | `{ categoryId?: string }` | 进入恢复默认 pending | 不直接覆盖权威 snapshot |
| `settings.retry` | `{ failedIntentId }` | 重试对应失败 intent | 不改变失败原因 |
| `settings.safe-return` | `{ targetPageId: 'menu-title' }` | 安全回标题并保留诊断 | 不清理真实数据 |

鼠标、键盘、手柄、触控和屏幕阅读器都调用同一 intent builder。每个 request 必须带 `requestId`，`pending`/`rejected`/`timeout` 必须可见。

## 8. 本地 UI 状态

允许本地保存：

- 标题当前焦点/选择、菜单方向索引、`quitConfirmOpen`、`settingsOpen`、当前设置类别、类别分页/滚动位置。
- `SettingsDraft`、dirty、previewKey、previewValue、pendingRequestId、lastIntentStatus、错误详情展开。
- hover、focus、active、selected、disabled、expanded、reducedMotion、textPreviewSize、assetLoaded、animationPhase、focusOrigin、restoreTargetId。
- 取消或保存失败时保留 draft，直到用户明确重试、撤销或离开。

禁止本地保存或推断：

- 存档真实存在、恢复成功、设置已持久化、设备实际能力、音量实际结果、游戏状态或规则结果。
- 通过切换 draft 自动替换 `SettingsSnapshot`；通过点击按钮自动显示 saved/defaults-applied。
- 通过菜单顺序推断页面权限或旅程状态。

## 9. 视觉令牌

- 标题场景采用像素前景 + 暖/冷全息投影背景，可挂载 `assetRef`、`textureRef`、`portraitRef`、`iconRef` 和光效；标题文字与菜单入口是场景层级的一部分。
- `new-game` 使用中性/绿色安全可继续语义；`continue` 可用时使用绿色/灰白高光，无存档时使用灰色扁平 + 明确“无存档”；`options` 使用蓝/灰白信息语义；`quit` 使用克制红色危险语义但不制造恐慌。
- `hover`：入口边缘发光、轻微右移/凸起；`focus`：清晰外环；`active`：高光加深/短促内缩；`disabled`：扁平降饱和+原因；`return`：回到基线。
- 设置控件：pending 使用橙色；保存确认使用绿色；保存/取消/默认失败使用红色并带文字；重试/超时使用黄/灰白说明。
- 颜色不是唯一语义：无存档、disabled、draft、saved、error 都同时有图标、文本、形状或材质差异。
- 设置面板使用半透明层，背景和标题氛围可见；不使用统一圆角卡片墙，不创建新的主色。
- 资源缺失保留控件/装饰位置和语义轮廓，不以 broken image 或大片空白为反馈；允许实际登记素材增强空间感。

## 10. 动效绑定

- 标题首次出现使用 `contour-reveal` + 柔和 `afterglow-fade`；标题和入口依次显影，不使用网页首页式瞬时堆叠。
- 菜单焦点变化使用短 `semantic-highlight`，hover 轻微上浮，active 使用短压缩/回弹；动画只反馈 UI 焦点。
- `new-game` 接受后使用标题→出租屋的 UI 过渡槽位；这不是入梦动画，不允许用纯白显形替代或跳过床装载语义。
- `continue` pending 使用局部 loading/轮廓显影；无存档不播放成功过渡；恢复失败使用 `shake-rebound`/错误反馈。
- 打开设置和退出确认使用半透明遮罩 + 局部滑入/显影；焦点进入 overlay 后才播放局部 motion。
- 设置类别切换使用 `list-reflow`/`afterglow-fade`，draft preview 使用局部 `semantic-highlight`；保存成功动画只在 accepted/projection 后播放。
- 保存/取消/默认失败或 timeout 使用 `shake-rebound`、红/黄结构反馈，不播放 saved 动画；重试可播放短 click feedback。
- 所有演出可跳过或在 reduced motion 下收敛为状态变化；跳过/资源缺失/动画失败都落到相同状态，不能改写 intent 结果。

## 11. 输入无障碍

- 标题菜单使用语义化 menu/list 或 button；支持 Tab/Shift+Tab、方向键、Enter、Space、Esc。上下移动焦点不改变业务状态，Enter/Space 才提交。
- `Continue` disabled 时仍可由屏幕阅读器识别为“继续，无存档，目前不可用”，但不进入可操作 Tab 顺序；不能只变灰无原因。
- 退出确认和设置使用 FocusScope/对话框语义；打开后焦点到标题/首个有效操作，Esc/取消关闭后回到 `restoreTargetId`。
- 设置六类通过分页/分组/滚动访问，同屏并列选择最多 5；方向键/Tab 在组内移动，Enter/Space 修改或打开控件，Esc 取消当前编辑/关闭 overlay。
- 滑块、开关、下拉、键位重映射必须有 label、current value、description、disabled reason 和状态播报；不能只依赖颜色或音效。
- 输入重映射提供键盘和手柄等价路径；冲突/不可用只显示结构化错误，不写真实绑定。
- 触控提供 tap、长按等价入口和明确取消；鼠标 click 与键盘/手柄共享 intent。
- 字幕/文字反馈覆盖保存中、保存失败、无存档、退出确认、取消、默认失败和安全返回；reduced motion、high contrast、text size preview 自身也可通过键盘和屏幕阅读器操作。
- 焦点环不能被场景层、overlay 或裁切容器截断；文字放大不能隐藏保存/取消/返回。

## 12. 加载错误超时

- 标题挂载/冷启动：显示准备阶段和 loading 文案；超时后提供重试、取消或安全返回，不显示无理由空白。
- 继续：有存档进入 `restore-loading`；无存档显示 empty 和原因；恢复失败显示 rejected/error；超时显示 timeout；每一态提供合法下一步。
- 选项打开失败：显示设置 surface unavailable、原因、重试和回标题；不渲染一个看似可保存但无法接线的假设置。
- 设置 preview 失败：显示当前 key/value 的失败原因，保留其它 draft；不把 preview 当持久化。
- 保存失败：显示“保存失败（mock）”、失败原因、重试、取消/关闭和安全返回；保留 draft，不显示 saved。
- 取消失败：显示“取消未完成（mock）”，保留 draft，提供重试、继续编辑或安全关闭；不静默恢复 snapshot。
- 恢复默认失败：显示“恢复默认失败（mock）”，保留当前 draft，提供重试/取消；不假称默认已应用。
- 任何 intent 超过有限阈值进入 timeout，不能无限 spinner；timeout 可 retry/cancel/safe-return。
- 资源缺失保留 `assetRef`、语义占位和控件位置；版本不兼容显示清晰约束原因并安全返回，不借用错误资源。
- 错误/超时焦点进入首个可操作按钮；关闭错误后回到触发器或明确安全目标，LiveRegion 宣布结果。

## 13. 明确不做

- 不实现真实存档、存档槽位、迁移、云同步、账号、退出进程、真实设置持久化或设备能力检测。
- 不实现规则、战斗、匹配、床、地图、节点、路径、后端路由或业务回调；新游戏不直接进对局。
- 不把标题画面做成网页首页、浏览器 chrome、登录页、SaaS dashboard、四张统一卡片或零素材页面。
- 不省略六类设置，不把六类设置压成同时并列超过 5 个选择；不把保存/取消/默认失败伪装成功。
- 不让 `continue` 在无存档时可提交，不用本地 draft 覆盖 projection，不使用颜色/音效/动画作为唯一语义。
- 不把 `+3极限爆发`作为可选项；不在本 brief 中引入新主色或零素材验收口径。

## 14. 依赖交接

- 从 `B1-01` 接收 `AppShell`、`PageSurface`、`LocalOverlay`、`FeedbackLayer`、统一 intent adapter、source badge 和焦点恢复 contract。
- 从 `B1-02` 接收冷启动、继续恢复、无存档、恢复失败/超时和安全返回 fixture；标题只消费这些只读状态，不复写其恢复逻辑。
- 向 `B1-04` 交接稳定 pageId/variantId、`focusOrigin`、`restoreTargetId`、菜单顺序、设置六类导航顺序和 overlay FocusScope 边界。
- 向后续 B3 交接 `menu.new-game` 的目标 `residence-main` 和标题到驻地的 UI transition slot；不得在 B1 内实现驻地/床/匹配。
- 真实接线方只替换 `TitleMenuProjection`/`SettingsSnapshot` provider 和 ActionPort adapter；组件树、intentId、可访问名称、错误状态和焦点顺序必须保持稳定。
- 素材通过 `assetRef`/manifest slot 接入；本 brief 不生产、不修改素材管线。

## 15. 验收条件

- [ ] 标题画面在无后端 mock 环境独立运行，四入口新游戏、继续、选项、退出全部存在且可读。
- [ ] 无存档 fixture 下继续 disabled、原因可见/可读且不提交恢复；有存档、恢复中、失败、超时路径可演示。
- [ ] 新游戏只导航到 `residence-main` UI surface，不直接进入 HUD/对局；退出先确认，取消/Esc 回标题。
- [ ] 设置完整覆盖显示、声音、输入、无障碍、语言、图形六类，六类都能访问；同屏并列选择不超过 5。
- [ ] 设置 preview 只改 local draft；保存、取消、恢复默认均提交 intent，且 mock 失败路径可见、保留 draft、能重试/取消/安全返回。
- [ ] 只有 accepted/projection 才显示 saved/defaults-applied；rejected/stale/timeout 不播放成功动画。
- [ ] 所有标题和设置控件有 hover/focus/active/disabled/return 五态；颜色之外有图标、文字、形状或材质说明。
- [ ] 键盘、鼠标、手柄、触控和屏幕阅读器可完成标题导航、退出确认、设置编辑、保存失败处理和焦点恢复。
- [ ] Overlay 打开后焦点进入，关闭/取消后回到触发器；错误/超时焦点不落空白，LiveRegion 可读出原因和下一步。
- [ ] 使用像素前景、全息背景和可替换素材挂载位；素材缺失保留结构和语义占位，不以零素材为完成标准。
- [ ] 生成代码不引用后端路径、不写规则状态，且通过项目 TypeScript、相关测试、lint 和文档术语门禁。

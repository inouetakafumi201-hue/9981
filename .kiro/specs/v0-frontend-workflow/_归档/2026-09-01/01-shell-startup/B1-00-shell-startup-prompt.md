# B1 Prompt Pack：Shell Startup
<!-- prompt-pack: command-entry batch=B1 execution=independent-command -->

## 0. Independent Execution Contract

本命令可独立执行。已有项目是当前实现事实；AI 必须先检查现有前端并在其基础上修改，不能另起孤立 demo。缺失挂载点时，在现有架构内最小补齐；已存在功能不得重复/破坏。只修改当前批次职责范围，不要等待前置批次，也不要求记住 Batch 0 或前一批次对话。

全局硬约束摘要：UI-only；只读 mock/projection；所有交互使用显式 intent，不执行玩法或业务规则。允许使用并挂载登记素材与可替换 `assetRef`；不用“零素材”口径作为完成标准，缺失素材保留语义挂载位和 fallback。四类内部 UI out-of-scope：`editor`、`research-bench`、`material-library`、`computer`，只能保留入口/挂载位，不实现内部页面。同屏并列可操作选项 ≤5，超出时分页、滚动、分组或分步。`+3极限爆发` deferred/future-evaluation-only，MVP 不可选，但保留必要的预留表现槽位。

## 1. Project Positioning

你是负责生成 WakeUp 前端 UI 壳层的生成 AI。当前交付物是一个可脱离后端、可独立演示、可替换数据源的 React + TypeScript UI 包，目标是把启动、标题、加载恢复、AppShell 和 ControlPanel 的视觉与交互契约做完整。

本批次只表达 UI surface、只读 mock/projection、局部 UI 状态和声明式 intent。任何按钮、菜单、切换器、重试或安全返回都只能提交 intent，不能执行玩法规则、写入游戏状态、访问真实存档或猜测后端结果。生成物必须保留真实素材、登记素材、纹理、光效、立绘或图标的挂载位；本批次不是“零素材渲染”任务。

ControlPanel 是唯一稳定的页面切换面和主抽取面。AppShell 只能有一套全局壳层和一套 UI 路由投影，不得在页面内部另建路由、业务状态树或规则状态机。

## 2. Scope List

### In scope

- `AppShell`：启动承载、页面挂载、局部覆盖层、反馈层、全屏仪式层和焦点边界。
- `ControlPanel`：页面切换、类别筛选、页面变体切换、动画模式切换与动画预览。
- `startup-loading`：冷启动、加载中、超时、重试、加载失败、资源缺失、版本不兼容和安全返回。
- `menu-title`：标题画面四入口——`新游戏`、`继续`、`选项`、`退出`。
- `utility-settings`：完整六类设置——显示、声音、输入、无障碍、语言、图形；全部使用 mock/projection，可编辑预览。
- 跨页面导航和焦点恢复契约：键盘、鼠标、触控、手柄和屏幕阅读器的等价操作。
- ControlPanel 可挂载的页面目录：`menu-title`、`menu-pause`、`startup-loading`、`hud-main`、`residence-main`、`dialog-line`、`dialog-options`、`transition-dream`、`transition-battle-intro`、`transition-result`、`notice-broadcast`、`notice-toast`、`control-panel-main`、`utility-settings`、`utility-inventory`、`utility-safe`、`utility-match`、`stats`、`achievements`、`codex`、`recap`、`quest-log`、`objective-tracker`、`tutorial-help`、`location-title`、`notification-history`。
- 允许使用登记素材和可替换 `assetRef`；缺失时保留语义占位和组件位置。

### Out of scope

- `editor`、`research-bench`、`material-library`、`computer` 的内部 UI；驻地以后如需呈现这些对象，只能是入口占位。
- 地图节点、拓扑、节点移动、ORCA、寻路、路径成本、碰撞、玩法规则、AI 决策、伤害、AP/HP/SP 结算。
- 真实账号、真实存档、真实加载、真实设置写入、网络协议和后端路径。

## 3. Reference Materials

以下 attachment 是当前 brief 的 AI-readable 依据。历史/旧 prompt 只能帮助识别边界，不能覆盖这里写明的当前结论。

- `frontend-workflow-requirements` / provenance: 当前前端 UI-only 作用域；标题画面为启动前置；标题包含新游戏、继续、选项、退出；设置必须覆盖显示、声音、输入、无障碍、语言、图形。
- `frontend-workflow-design` / provenance: AppShell、ControlPanel、页面目录和 PromptPacket 的稳定边界；页面只读投影，交互只发 intent。
- `frontend-port-contract` / provenance: `StateSnapshot`、`IntentRequest`、`IntentResult`、StatePort/ActionPort/CadencePort 的抽象契约；生成 AI 只实现 props、mock adapter 和 intent callback。
- `frontend-fixtures` / provenance: `source: mock`、revision、loading/empty/error/retrying/safe-return fixture；可见数值遵守 1–5。
- `frontend-interaction-accessibility` / provenance: hover/focus/active/disabled/return 五态；键盘、手柄、触控、鼠标和屏幕阅读器等价；同屏并列选项最多 5 个。
- `frontend-motion-fallback` / provenance: 动画只重演确认后的 projection；资源失败、动画失败、跳过都落到同一结果；加载必须有超时、重试、取消或安全返回。
- `frontend-conflict-ruling` / provenance: 标题画面取代启动入口上的“无传统主菜单”旧表述；`+3极限爆发`仅未来评估、MVP 不可选；纯白显形是入梦/返回唯一传送语汇；历史排除项不升格。
- `frontend-pages-batches` / provenance: `control-panel-main` 与 shell/startup 属 B1；B1 无前置依赖，后续页面以稳定挂载点接入；完整页面目录和状态由当前索引约束。
- `journey-current-ruling` / provenance: 新游戏落地出租屋而非直接进对局；床是装载入口；错误路径必须可重试、取消或安全返回；返回按当前 UI 投影，不伪造业务结果。
- `presentation-ui-authority` / provenance: 像素前景 + 全息投影背景；语义色、素材参与和响应式安全区；不可只用颜色表达状态。

## 4. Technical Constraints

- 技术基线：React + TypeScript；页面切换和状态演出优先使用 Framer Motion；图标使用 lucide-react；弹层、FocusScope、Menu、Tooltip、LiveRegion 等使用项目已有的可访问原语（优先 Radix）；跨组件局部视图状态可用 Zustand 或 props/useState；音频只预留可替换槽位。
- 基准 1920×1080，最小 1280×720；响应式只改变密度和位置，不改变动作权限、焦点顺序的语义或结果。
- 视觉基线是高辨识像素前景 + 暖/冷全息投影背景 + 半透明 UI。允许并鼓励登记素材、纹理、光效、立绘和环境图参与空间呈现；不要用无素材的纯色块作为完成目标。
- 全局语义色不可另造主色：红=危险/失败，蓝=清醒/科技，黄=感官/警戒，橙=行动/进行中，绿=安全/完成，紫=约束/远程，珊瑚=近战，青=社交/UGC/创作来源，灰=冷却/延迟，灰白=受限但可交互，纯白/奶白=梦境边界/过载，金银=少量高光。
- 所有可见控制必须有 `hover`、`focus`、`active`、`disabled`、`return` 五态；图标、文字、形状或材质必须与颜色共同表达状态。
- UI 只依赖抽象快照和动作端口，不依赖后端文件路径或后端内部类名。生成物可直接用本 brief 内的 mock adapter 启动。
- 只读快照最小形状如下，所有业务/运营字段带 `source` 标签：

```ts
interface StateSnapshot {
  screen: string;
  phase: string;
  entities: readonly Record<string, unknown>[];
  resources: readonly Record<string, unknown>[];
  notices: readonly Record<string, unknown>[];
  source: 'mock' | 'projection';
  revision: number;
}

interface IntentRequest {
  intentId: string;
  payload: Record<string, unknown>;
  requestId: string;
}

interface IntentResult {
  requestId: string;
  status: 'accepted' | 'rejected' | 'stale' | 'timeout';
  reason?: string;
  nextRevision?: number;
}
```

- 任意 UI 交互使用同一个 `submit(request)` 入口。`pending` 不是 `accepted`；只有 `IntentResult` 或新 projection 到达后才显示确认结果。
- 玩家可见数值严格使用 1–5；页码、版本号、实体数、时间戳、分辨率等结构/技术字段可作为内部数据，不把内部字段误标成玩法数值。
- 如果未来页面出现 burst selector，MVP 只允许 `0 / 1 / 2`；`+3极限爆发`可以保留为不可选的预留说明，并且必须保留选择特效和触发特效的表现槽位。
- 同屏并列可操作选项最多 5 个。超过 5 个必须分页、滚动、分组或分步展示；“完整六类设置”必须保留，但不能以六个并列 tab 同时作为唯一选择面。
- 等待态必须有可读文案、进度/阶段说明或超时阈值；禁止无限 spinner、静默失败或用 mock 成功掩盖失败。

## 5. Naming Rules

- 固定组件名：`AppShell`、`ControlPanel`、`PageSurface`、`LocalOverlay`、`FeedbackLayer`、`FocusScope`、`LiveRegion`。
- 固定页面 ID：`menu-title`、`menu-pause`、`startup-loading`、`control-panel-main`、`utility-settings`，以及 Scope List 中列出的其他页面 ID。
- 固定类别 ID：`cat-menu`、`cat-hud`、`cat-residence`、`cat-narrative`、`cat-transition`、`cat-notice`、`cat-control`、`cat-utility`。
- 固定设置类别 ID：`settings-display`、`settings-sound`、`settings-input`、`settings-accessibility`、`settings-language`、`settings-graphics`。
- 固定变体 ID：`title`、`pause`、`startup`、`settings`、`standard`、`solo`、`minimal`、`with-portrait`、`no-portrait`、`enter-dream`、`return-home`；变体只改变呈现，不改变玩法。
- 固定动作 intent ID：`navigate.page`、`navigate.category`、`navigate.variant`、`presentation.play`、`startup.load`、`startup.retry`、`startup.cancel`、`startup.safe-return`、`menu.new-game`、`menu.continue`、`menu.options`、`menu.quit`、`menu.quit-confirm`、`settings.preview`、`settings.save`、`settings.cancel`、`settings.restore-defaults`、`overlay.close`。
- 每个 request 必须包含 `intentId`、显式 `payload` 和唯一 `requestId`。不要把显示文本当作稳定 ID。

## 6. Interaction Rules

- AppShell 采用唯一层级：`AppShell → ControlPanel → PageSurface → LocalOverlay → FeedbackLayer`。ControlPanel 切换的是 UI surface，不表现为空间移动、节点遍历或玩法推进。
- 页面切换、类别筛选、变体切换、动画播放都只改变呈现，必须发对应 intent；筛选隐藏页面时不得丢弃其局部视图状态。
- 页面、类别、变体、动画模式都支持 mock 数据和 projection 数据；必须显示/可审计 `mock` 标签，不得把 mock 事实伪装成真实事实。
- `state-transition` 表示 UI 状态改变触发的演出；`click-play` 表示用户点击触发的局部反馈。两者在 ControlPanel 中分开选择和展示。
- 标题菜单最多同时显示四个入口。无存档时 `继续` 必须显示 disabled 与原因，但仍需存在可读的“无存档”状态。
- `新游戏` 只提交启动/导航意图，并把结果目标设为出租屋 UI surface，不直接进入对局。
- `选项` 打开 `utility-settings`；`退出` 打开确认 overlay；Esc/取消关闭当前 overlay 并把焦点归还触发器。
- 设置修改先进入本地 draft/preview，保存、取消、恢复默认都必须走 intent；默认 mock fixture 对保存、取消和恢复默认提供失败态，UI 必须展示失败原因并保留可恢复路径，不得自称成功。
- 加载失败、资源缺失、版本不兼容、超时和断线分别可见；每个状态至少提供重试、取消或安全返回中的合法下一步。
- 触控 tap/long-press、鼠标 click、键盘 Enter/Space、手柄 confirm 调用同一 intent builder；Esc/返回只取消当前 overlay，不隐式提交。
- 不用 hover 才能发现关键操作；焦点环不能被裁切；页面切换后焦点进入新 surface 的首个有效目标，关闭 overlay 后回原触发器。

## 7. Explicit Exclusions

- 不实现后端、真实网络、真实存档、真实设置写入、认证、规则引擎、AI 决策、OpRegistry、地图数据或任何业务回调。
- 不读取或引用后端路径作为生成 UI 的唯一输入；只依赖本 brief 的抽象端口和 mock/projection 字段。
- 不实现 `editor`、`research-bench`、`material-library`、`computer` 的内部页面，不在导航中伪造这些页面。
- 不创建第二套全局路由、第二套规则状态树或本地业务事实缓存。
- 不把 `+3极限爆发`做成可选控件；不把 0/1/2 以外的 burst 档位做成 MVP 行为。
- 不使用零素材口径、不删除素材挂载位、不用 broken image 或空白区域作为唯一资源错误反馈。
- 不让同屏并列选择超过 5 个；六类设置必须通过分页/分组保持可读。
- 不把动画、音效、粒子、颜色或焦点变化当作规则结果来源；动画失败或跳过不能改变 projection。

## 8. Batch Objective

在无后端条件下建立可独立演示的 B1 启动壳层：

1. AppShell 提供稳定的层级、挂载面、覆盖层和反馈层。
2. ControlPanel 提供页面、类别、变体、动画模式的声明式切换和抽取边界。
3. 冷启动、标题、加载恢复、设置和导航焦点路径能够展示 ready、loading、empty、error、retrying、safe-return。
4. 所有交互都能发 intent、显示 pending/rejected/timeout，并保持 UI-only、mock/projection、素材可替换契约。

唯一主目标是“启动壳层和控制/恢复边界可接线”，不是实现任何后端或玩法。

## 9. Batch Dependencies

- 前批次：无。若项目已有 `AppShell`、`PageSurface`、`FeedbackLayer`、全局 token 或 UI port 挂载点则复用；若没有，按本命令约定在现有架构内补齐；不要求记住 Batch 0 或前一批次对话，也不要求后端路径、真实存档或真实网络。
- 同批 numbered briefs：`B1-01` 负责 AppShell/ControlPanel，`B1-02` 负责启动加载恢复，`B1-03` 负责标题和设置，`B1-04` 负责导航/焦点；它们共享本文件定义的 ID、intent、快照和错误语义，可直接读取本文件与同目录 briefs 执行。
- 后续交接说明：B2 可复用稳定的 `AppShell`/`PageSurface`/`FeedbackLayer` HUD 挂载点；B3 可复用标题到驻地和过渡挂载点；B4 可复用 overlay、settings、pause 和错误层；B5 可复用统一导航和焦点 contract。
- 后续接线只通过抽象组件 props、`StateSnapshot`、`IntentRequest` 和 fixture；真实接线方替换 provider/adapter 时不得改变页面树、语义 ID、焦点顺序或错误状态。

## 10. Acceptance Checks

- [ ] 在无后端、仅 mock adapter 条件下可启动并显示 `AppShell`、`ControlPanel`、`PageSurface`、`LocalOverlay`、`FeedbackLayer`。
- [ ] ControlPanel 可以分页/分组浏览完整页面目录；页面切换、类别筛选、页面变体切换、`state-transition` 和 `click-play` 均有独立视觉响应。
- [ ] 类别筛选只影响 UI 呈现，不丢失隐藏页面的局部状态，不产生空间移动或规则变化。
- [ ] 冷启动可展示加载中、加载完成、超时、加载失败、重试、取消和安全返回。
- [ ] `继续` 能展示有存档、无存档、恢复中、恢复失败和恢复超时；无存档不能被伪造为成功。
- [ ] 资源缺失和版本不兼容有语义占位、可读原因和重试/安全返回；不使用错误素材静默替换。
- [ ] 标题画面有新游戏、继续、选项、退出四入口；退出有确认 overlay；新游戏目标是出租屋 UI surface，不是对局。
- [ ] 设置完整覆盖显示、声音、输入、无障碍、语言、图形；六类设置通过分页/分组实现，同屏并列选项不超过 5。
- [ ] 保存、取消、恢复默认的 mock 失败态均可见，失败不丢 draft，能够重试或安全关闭；成功只能来自 accepted/projection。
- [ ] 所有控制具备 hover/focus/active/disabled/return 五态；鼠标、键盘、手柄、触控和屏幕阅读器路径等价。
- [ ] 打开 overlay 后焦点进入 overlay，关闭/取消/安全返回后焦点回到触发器或明确的安全目标；加载/错误态不会把焦点落入空白区域。
- [ ] UI 数据明确标记 `source: mock | projection`；不在组件中计算 HP、AP、伤害、匹配、存档或规则结果。
- [ ] 允许素材参与背景、实体和 UI；素材缺失时仍保留组件位和语义文字；没有“零素材完成”捷径。
- [ ] MVP burst 若出现在共享壳层，只能选择 0/1/2；`+3极限爆发`不可选但有预留表现槽位。
- [ ] 生成物能用项目门禁运行并通过 TypeScript、相关测试、lint 和文档术语检查；若生成环境没有某项命令，必须明确报告阻塞而不能用成功假象替代。

## 11. Attached AI-readable packet

本命令必读本文件+同目录 numbered briefs；G-* 和 R-* 是可选补充，正文摘要已经足够执行。

### G-01：项目与作用域契约

- 目标：生成完整可演示的 WakeUp UI 壳层，不生成规则引擎、后端或地图系统。
- In scope：标题、启动/加载、设置、暂停、驻地入口、匹配状态、入梦/返回、HUD、叙事、通知、错误/重连、结算、ControlPanel 和 utility panels。
- Out of scope：editor、research-bench、material-library、computer 内部 UI；地图节点、拓扑、节点移动、ORCA、寻路、路径成本和玩法规则。
- UI 只展示 mock 或只读 projection；按钮只提交 intent。
- 加载类页面支持 loading、empty、error、retrying、safe-return；等待不能无限旋转。
- 统一组件层级：`AppShell → ControlPanel → PageSurface → LocalOverlay → FeedbackLayer`。

### G-02：视觉令牌契约

- 基准 1920×1080，最小 1280×720，使用安全区响应式缩放。
- 当前语言：像素前景 + 暖/冷全息投影背景 + 半透明 UI；允许成品素材、纹理、光效、立绘和参考图。
- 不退化成 SaaS dashboard、卡片墙、统一圆角矩形网格或零素材空壳。
- 语义色：red danger/error，blue clarity/tech，yellow alert，orange action/pending，green safe/complete，purple constraint/remote，coral melee，cyan social/UGC，gray delay，gray-white constrained-interactive，white/cream dream boundary/overload，gold/silver highlight。
- 不可只靠颜色表达状态；资源缺失使用图标/轮廓/文字占位，保留结构。

### G-03：UI Port 契约

- UI 读取 `StatePort`，通过 `ActionPort` 发 intent，通过 cadence/projection 更新画面。
- `StateSnapshot` 的 `source` 只能是 `mock` 或 `projection`，并带 `revision`。
- `IntentRequest = { intentId, payload, requestId }`；结果是 accepted/rejected/stale/timeout。
- `pending` 不能当 accepted；真实接线只替换 provider/adapter，不改组件树。
- UI 不调用规则注册表、不直接写 store、不读后端路径、不实现真实存档。

### G-04：交互与无障碍契约

- 每个控制必须有 hover、focus、active、disabled、return 五态。
- 同屏并列选择不超过 5；超过 5 使用分页、滚动、分组或步骤。
- 鼠标、键盘、手柄、触控和屏幕阅读器调用同一 intent builder。
- 支持 Tab/Shift+Tab、Enter、Space、Esc、方向键、适用时的数字快捷键和手柄焦点。
- 弹层使用 FocusScope；关闭后焦点归还触发器；错误/加载状态必须可读出状态和下一步。

### G-05：动效、声音与降级契约

- 动画只重演已确认的 UI/projection 结果，不能推进回合、扣资源、写存档或决定目标。
- 状态演出状态机：hidden/idle → playing → result/skipped/failed → settled。
- 使用慢白幕、闪白幕、黑幕收束、余辉淡出、轮廓显影、语义高亮、震动回弹、列表重排等语义母题。
- 动画、声音或粒子缺失不阻塞 UI；失败/跳过落到同一 settled 状态。
- `+3极限爆发`不可选，但 burst selection effect 和 trigger effect 必须保留槽位。

### G-06：Mock Fixture 契约

- 所有 fixture 显式带 `source: 'mock'`、`revision` 和 `screenState`。
- 可用状态：idle、loading、empty、ready、pending、rejected、timeout、error、safe-return。
- 假标签和假数据标记为 `mock`；可见数值只使用 1–5，结构性计数例外。
- fixture 中的 intent 只是绑定名；点击不直接改 fixture，不推导规则结果。
- 每个主要页面至少准备 ready、empty、error、pending/timeout 之一，并提供 retry/cancel/safe-return。

### G-07：冲突登记契约

- 标题画面是启动前置，取代旧的“无传统主菜单”启动表述；新游戏落地出租屋。
- `+3极限爆发`是 future-evaluation、MVP 不可选；0/1/2 和两个特效仍保留。
- 入梦和返回统一使用纯白显形；黑幕只能做退出/失败/内容收束，不代替传送。
- 历史文本、proposal 和 excluded internals 只能作为 heritage/boundary evidence，不是当前产品语义。
- 未收口冲突显示 conflict/open 和人工复核/安全返回，不猜测规则。

### G-08：页面与批次索引契约

- `startup-loading`、`menu-title`、`control-panel-main`、`utility-settings` 属 B1；B1 无依赖。
- 全旅程抽象为 `startup-loading → menu-title → residence-main → ...`，失败路径均落到 retry/cancel/safe-return。
- 所有页面使用稳定 pageId、variantId 和各自 fixture，不读取别页的私有规则。
- ControlPanel 是主切换/抽取面；过滤不卸载页面状态；每个变体只是呈现变体。
- 任何新页面家族、排除项内部或绕过标题/驻地契约的路径都不在 B1 生成范围。

### 可直接执行的生成指令

先建立 mock provider 和 intent adapter，再建立上述组件树。先使 ready、loading、empty、error、retrying、safe-return 都能在 ControlPanel 中被选择和演示，再接入动画、素材挂载和无障碍反馈。不要等待后端，不要通过硬编码成功态掩盖失败，不要自行扩展页面目录或规则语义。
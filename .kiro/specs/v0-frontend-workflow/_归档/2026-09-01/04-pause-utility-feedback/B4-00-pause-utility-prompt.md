# B4 Pause / Utility / Feedback Prompt Pack
<!-- prompt-pack: command-entry batch=B4 execution=independent-command -->

## 0. Independent Execution Contract

本命令可与本目录全部 numbered briefs 独立执行；不要求记住 Batch 0、任何前置批次或此前对话。AI 必须先检查现有整个前端项目，把已有项目视为当前实现事实：优先复用并修改既有代码、AppShell、overlay stack、端口和挂载点；缺失挂载点时，只在现有架构内按本命令最小补齐。不得另起孤立 demo、第二套路由、第二套状态权威或平行世界场景。

已有功能不得重复、破坏或被本批次替换；只修改 B4 当前职责范围，不等待前置批次。全局硬约束摘要：UI-only；只读 `mock`/projection；所有交互走显式 intent；素材允许且保留 `assetRef`/manifest 挂载位，不以零素材为验收口径；`editor`、`research-bench`、`material-library`、`computer` 的内部 UI out of scope；同屏并列项最多 5 项；`+3` 为 deferred、不可选，但保留 selection/trigger effects 与后续接线位。

## 1. Project Positioning

B4 是 WakeUp 前端 UI 壳层的暂停、工具面板与反馈覆盖层批次。交付物是声明式 React + TypeScript 的可演示表现层：它冻结正在运行的世界、呈现暂停与工具面板、消费只读投影、提交显式 UI intent，并把确认、拒绝、超时、断线和恢复结果可读地呈现出来。B4 不拥有玩法状态，不执行规则，不写库。

本批次覆盖暂停菜单、六分类设置生命周期、背包、保险箱、匹配工具面板、通知队列与历史、字幕/声音视觉替代，以及连接错误重试覆盖层。所有页面都挂在既有 AppShell 和 overlay stack 上，不创建第二套路由、第二套状态权威或独立世界场景。

必须保持：UI-only、intent-only、素材允许且应保留素材挂载位、不以零素材为目标、同屏不超过 5 项（任一同屏并列列表/队列/选项最多 5 项）、遵守 G-01..G-08。所有 mock 数据明确标记 `source: "mock"`；真实接线通过稳定的只读 StatePort、ActionPort、CadencePort 完成。

## 2. Scope List

### In scope

- `menu-pause`：继续、设置、重新开始确认、返回标题确认；暂停时冻结当前世界并降饱和，继续时恢复同一画面。
- `utility-settings`：显示、声音、输入、无障碍、语言、图形六个分类；全部调项均有 mock 可编辑、预览、保存、取消、恢复默认、保存失败、重试和焦点归还。
- `utility-inventory`：4/6 槽位、空手态、物品详情、拖拽交换、非法落点回弹、右键/长按/键盘上下文菜单；动作只提交 intent。
- `utility-safe`：保险箱收藏室的类别筛选、抽屉式陈列、详情与大图、可用的占位动作；不把保险箱做成材料仓库。
- `utility-match`：匹配中、可继续活动、已就绪、影子在场、取消、匹配超时和恢复入口；不重载场景。
- `notice-toast` / `notice-broadcast` / `notification-history`：通知优先级、队列、同类聚合投影、公告、历史分组和 `N` 快捷键。
- `SubtitleOverlay` 与 `SoundVisualAlternative`：字幕、声音事件的图标/文字/方向/状态替代；它们是覆盖组件，不新增路由。
- `ConnectionErrorRetryOverlay`：连接中断、重连中、重连成功、重连失败、匹配超时和安全返回；它挂在既有页面/覆盖层，不创建新的页面家族。
- overlay stack 的 z-index、焦点范围、输入仲裁和跨层恢复协议。

### Out of scope

- 真实存档、设置写库、规则结算、资源扣除、匹配算法、服务器协议、重连协议和业务重试策略。
- 任何玩家可见页面都不得实现玩法规则、地图规则或其他业务规则；只消费只读投影并提交 intent。
- `editor`、`research-bench`、`material-library`、`computer` 的内部页面；驻地入口仍只能是占位端口。
- 地图节点、拓扑、节点移动、ORCA、寻路、路径成本、战斗动作判定和 AI 决策。
- 新增全局路由或把暂停/设置/通知改造成网页后台、SaaS dashboard 或消息中心。

## 3. Reference Materials

按附件的 `attachmentId` / `provenance` 读取，不把源文档内部实现当作 B4 的业务端口：

- `frontend-global-g01` / `G-01-project-and-scope-contract`：UI-only、scope、页面边界、intent-only。
- `frontend-global-g02` / `G-02-visual-token-contract`：像素前景 + 全息投影背景、语义色、五态和素材允许原则。
- `frontend-global-g03` / `G-03-ui-port-contract`：StatePort、ActionPort、CadencePort、request/result 生命周期。
- `frontend-global-g04` / `G-04-interaction-accessibility`：键盘/手柄/读屏等价、Radix、焦点陷阱与归还。
- `frontend-global-g05` / `G-05-motion-audio-fallback`：Framer Motion、音频/视觉降级、reduced motion 和结果重演。
- `frontend-global-g06` / `G-06-mock-data-fixtures`：mock fixture、设置字段、来源标记和 1–5 可见数值约束。
- `frontend-global-g07` / `G-07-conflict-register`：当前冲突裁决，不恢复旧页面、旧术语或旧行为。
- `frontend-global-g08` / `G-08-page-and-batch-index`：B4 页面 id、旅程挂载、失败路径和批次归属。
- `frontend-batch-1-shell` / `01-shell-control-panel`：AppShell、控制面板、overlay 挂载点和全局 token。
- `frontend-batch-2-hud` / `02-battle-hud`：对局世界层、输入来源和 HUD 共存边界。
- `frontend-batch-3-residence` / `03-residence-flow/B3-00-residence-flow-prompt`：驻地/匹配/影子大厅的只读投影和继续漫游边界。
- `presentation-ui-authority` / `presentation-ui-01`：视觉语义、z-index 基线、键盘与输入等价。
- `presentation-animation-feedback` / `presentation-animation-feedback-02`：错误、重试、确定性降级和动画与规则分离。
- `presentation-rpg-notification` / `presentation-rpg-07`：通知优先级、队列、历史、字幕和 `N` 入口。
- `presentation-dialog` / `presentation-dialog-06`：字幕槽、声音缺失替代和独立覆盖层语义。
- `operations-safe-library` / `operations-safe-library-04`：保险箱收藏室与背包/素材库职责区分。
- `frontend-utility-legacy` / `04-modal-utility`：仅作为历史 batch-4 覆盖范围证据；如与本包冲突，以本包与 G-07 为准。

## 4. Technical Constraints

- 技术栈固定为 React + TypeScript；Framer Motion 负责入场、出场、重排和状态演出；Radix 负责 Dialog、AlertDialog、Tabs、Menu、ContextMenu、Tooltip、Toast、ScrollArea、Slider、Select 等可访问原语；Zustand 只保存可丢弃的本地 UI 状态；lucide-react 提供语义图标；Howler 只接收音频播放端口。
- 目标基准 1920×1080，最小 1280×720；响应式重排只改变位置和密度，不改变权限、intent、焦点顺序或结果。
- 所有可见控制具备 `hover / focus / active / disabled / return` 五态；`pending`、`rejected`、`timeout`、`stale` 是结果反馈态，不能伪装为 `accepted`。
- 所有页面读取带 `source`、`revision` 的只读投影。点击、键盘、手柄、触控和屏幕阅读器均调用同一个 intent builder，不在 `onSelect` 内调用业务函数。
- z-index 必须集中声明：`0 world/background`、`10 world-entities`、`20 HUD`、`30 passive-notice/subtitle`、`40 utility-panel`、`50 context-menu/tooltip`、`60 pause/settings modal`、`70 alert/reconnect blocking overlay`、`80 focus-announcement/debug-free status`。B4 不得让子组件临时发明更高层级。
- 输入仲裁按最高有效层处理：阻塞错误/确认对话框 > 暂停/设置 > 工具面板 > 通知/字幕 > HUD/世界。高层打开时低层不得响应同一按键；Esc 只关闭当前最高可关闭层，不跨层提交；关闭后焦点回到触发源。
- 素材、纹理、图标、立绘、背包物品图和保险箱陈列图允许且应通过 `assetRef`/manifest 挂接。缺失时按语义 fallback 保留实体/容器/名称，不用错误素材替代，也不以“零素材”作为验收口径。
- 玩家可见数值遵守 1–5；时间、槽位数、队列序号、版本号、实体数等内部/结构数值例外。界面不得从本地数值推导规则结果。
- 动画、声音和视觉替代只重演已确认的投影结果。reduced-motion、低闪烁、静音、音频加载失败时保留文字、图标、焦点和最终状态。

## 5. Naming Rules

- 页面 id 只能使用：`menu-pause`、`utility-settings`、`utility-inventory`、`utility-safe`、`utility-match`、`notice-broadcast`、`notice-toast`、`notification-history`。
- 覆盖组件 id：`PauseMenuSurface`、`SettingsLifecyclePanel`、`InventoryUtilityPanel`、`SafeUtilityPanel`、`MatchUtilityPanel`、`NotificationSurface`、`NotificationHistoryDialog`、`SubtitleOverlay`、`SoundVisualAlternative`、`ConnectionErrorRetryOverlay`、`OverlayStackCoordinator`、`InputArbiter`。
- 稳定 intent 使用命名空间：`pause.*`、`settings.*`、`inventory.*`、`safe.*`、`match.*`、`notice.*`、`subtitle.*`、`connection.*`、`overlay.*`。请求必须携带 `intentId`、`requestId`、显式 payload；禁止第二套同义 action kind。
- 状态名使用小写 kebab-case 或既有页面约定；`source: "mock" | "projection"` 不得省略。所有示例数据、文本中的假状态标记 `mock`。
- 六个设置分类固定为 `display`、`sound`、`input`、`accessibility`、`language`、`graphics`，不得合并或另造第七分类。
- 任何组件、fixture、快照和意图名称必须与本包一致；若真实端口名称不同，在 adapter 中映射，不能改 brief 的稳定边界。

## 6. Interaction Rules

- `Esc` 在对局中打开/关闭暂停；暂停层打开后世界画面冻结并降饱和，菜单拥有输入；`继续`关闭暂停并恢复原画面，不重建场景。
- 暂停菜单固定提供 `继续`、`设置`、`重新开始`、`返回标题`。重新开始和返回标题都先打开确认态；确认/取消/关闭走同一 intent 端口，取消不产生导航或重启结果。
- 设置面板切换六分类只改变视图；每个调项先进入本地 preview，保存/取消/恢复默认均等待端口结果。保存失败必须保留编辑值并给出重试/取消，成功后关闭可选；关闭时焦点回到设置入口或触发控件。
- 背包的点击、拖拽、右键、长按和键盘“选择来源→选择目标→确认”都调用同一个 intent。非法落点回原位并说明原因，不本地改物品归属。
- 保险箱只呈现收藏陈列，类别筛选、选中详情和关闭是视图行为；可用按钮只提交宿主允许的 intent，不提供删除、批量整理或携入对局的隐式行为。
- 匹配面板展示异步状态但不锁住非冲突世界输入；取消、超时、重试和返回都只提交 intent，不把请求发出当作匹配成功。
- 通知由投影提供优先级、队列顺序、聚合键和历史；高优先级可以打断低优先级呈现但不删除被打断项。`N` 打开历史，历史只读，关闭归还焦点。
- 字幕与声音视觉替代都不得泄露不可见信息；只呈现同一可见性过滤后的事件。声音缺失不阻塞文字；字幕关闭仅改变本地呈现偏好，不改变投影。
- 任一同屏列表、选项、队列或并列比较视口最多 5 项；超出使用滚动、分页、时间分组或队列，不能通过缩小字体绕过上限。

## 7. Explicit Exclusions

- 不实现任何写库、存档、设置持久化、物品移动/消耗、收藏写入、通知创建/删除、匹配创建/取消的规则本体；只提交 intent 并呈现结果。
- 不调用 `OpRegistry.invoke`、后端路径、规则 store 或业务 helper；不把 Zustand 当作业务权威源。
- 不做真实重连、心跳、退避、重试次数计算、匹配算法、服务器协议或安全认证；只呈现宿主投影的连接态和恢复入口。
- 不创建新的全局路由、独立大厅、第二套 AppShell、消息中心后台、SaaS 卡片墙、网页滚动条或白底表单页。
- 不扩展 `editor`、`research-bench`、`material-library`、`computer` 内部 UI；不实现地图、拓扑、寻路、ORCA、路径成本、战斗规则或 AI 决策。
- 不用无语义方块、错误语义素材或“没有素材”叙事替代合法素材挂载；不删除素材位。
- 不让暂停、确认框、通知、字幕或音效动画暗示规则已生效；不以动画完成、音效播放或本地倒计时作为业务确认。

## 8. Batch Objective

唯一主目标：交付一套可挂入既有 AppShell 的 B4 暂停、工具面板与反馈覆盖层，让玩家能够看见、聚焦、打开、取消、重试、安全返回并理解每个状态，同时保证冻结画面、设置生命周期、通知/字幕替代、断线恢复、z-index 和输入仲裁都可演示。所有动作保持 UI-only、intent-only；不实现写库或规则。

## 9. Batch Dependencies

- B1/B2/B3 capabilities are non-blocking context: if the existing project already has the AppShell, ControlPanel, `hud-main`, residence/match projections, and StatePort/ActionPort/CadencePort boundaries, reuse them; if any are missing, add only the smallest compatible mount point required by this command and its numbered briefs within the existing architecture. Batch 0, prior-batch, and prior-conversation context are not required.
- G-01..G-08 are optional reference context at execution time; the hard constraints summarized in section 0 and this prompt are sufficient to execute. Do not wait for these attachments or a previous batch.
- B5/B6/B7 are handoff notes only: later work may consume B4's stable component names, page ids, z-index, intents, result states, and focus-recovery protocol. B4 does not wait for, implement, or modify later-batch responsibilities.

## 10. Acceptance Checks

- [ ] `menu-pause` 可用 Esc 打开/关闭；当前世界确实冻结并降饱和；继续恢复同一画面；重新开始与返回标题均先展示确认态。
- [ ] `utility-settings` 的 display/sound/input/accessibility/language/graphics 六分类和全部 mock 调项可编辑；保存、取消、恢复默认、保存失败、重试、pending、拒绝和焦点归还可演示。
- [ ] 背包支持 4/6 槽位、空手/空状态、详情、拖拽交换、非法落点回弹和键盘等价；保险箱支持分类陈列、详情、大图、关闭回驻地；二者没有真实写库。
- [ ] 匹配面板可演示匹配中可继续活动、已就绪、影子在场、取消、匹配超时、重试和安全返回，不重载世界。
- [ ] 通知可演示高低优先级、队列、同类聚合、手动/自动关闭、公告、历史分组和 `N` 打开；同屏任何并列项不超过 5。
- [ ] 字幕、静音、音频缺失和关键声音的视觉替代可演示；文字/图标/方向提示不依赖声音或颜色单独传达。
- [ ] 连接中断、重连中、重连成功/失败、匹配超时和取消均有文字、状态、重试/取消/安全返回；不会把本地请求当作成功。
- [ ] z-index 只从统一 overlay stack 产生；高层输入阻止低层误触；Esc、Tab、Enter、Space、方向键、手柄和读屏路径等价；关闭后焦点回到触发源。
- [ ] 组件使用 G-01..G-08 的 scope、token、port、a11y、fallback、fixture、冲突和 page index 约束；mock 来源可审计，素材挂载位存在且缺失有语义降级。
- [ ] 相关 TypeScript、Vitest、lint 和文档术语门禁按仓库要求可运行；B4 不要求或暗示任何写库/规则实现。

## 11. Attached AI-readable packet

本命令必读本文件+同目录 numbered briefs；G-* 和 R-* 是可选补充，正文摘要已足够执行。
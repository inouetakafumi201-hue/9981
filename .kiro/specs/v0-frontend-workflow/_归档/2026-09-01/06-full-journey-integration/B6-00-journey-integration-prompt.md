# B6-00 Full Journey Integration Prompt
<!-- prompt-pack: command-entry batch=B6 execution=independent-command -->

## 0. Independent Execution Contract

本命令可与本目录全部 numbered briefs 独立执行，不要求记住 Batch 0、任何前置批次或此前对话。AI 必须检查现有整个前端项目并将已有项目视为当前实现事实：优先复用、接入和修改既有代码与挂载边界；缺失挂载点时，只在现有架构内按本命令约定最小补齐。不得另起孤立 demo、第二套 shell、路由中心、状态权威或世界场景。

已有功能不得重复、回归或破坏；只修改 B6 当前职责范围，不等待前置批次。全局硬约束摘要：UI-only；只读 `mock`/projection；所有交互使用显式 intent；素材允许并保留 `assetRef`/manifest 挂载位，不以零素材为验收口径；`editor`、`research-bench`、`material-library`、`computer` 的内部 UI out of scope；同屏并列项最多 5 项；`+3` 为 deferred、不可选，但保留 selection/trigger effects 与后续接线位。

## 1 Project Positioning

这是 WakeUp V0 前端工作流的 B6「完整旅程整合」批次。交付对象是一个可走通从冷启动到对局、结算、奖励并回到驻地原位置的 React + TypeScript 表现层壳，以及它的抽取边界、overlay 仲裁、全局反馈和 mock→UI port 接线合同。

本批次只实现页面编排、路由状态、只读投影消费、显式 action intent、局部 UI 状态、动效和可访问交互。它不实现玩法规则、回合推进、匹配算法、存档、后端协议、寻路、AI、结算计算、资源扣除或任何真实业务写入。mock 数据必须带 `mock` 标记，不能冒充权威事实；真实事实只能从只读 projection/state port 来。

完整 route 必须可演示且不丢节点：

```text
cold-start
  → loading
  → title
  → new-game | continue
  → residence
  → anchor-device
  → matching | roaming | shadow-lobby
  → bed-front-ready
  → battle-intro
  → enter-dream (pure-white)
  → battle-hud
  → pause | settings | narrative | notification | error overlays
  → result
  → reward
  → return-home (pure-white)
  → residence-at-original-position
```

每个节点都要有 loading/empty/error/timeout/retry/cancel/safe-return 的明确表现或合法回退；不允许以缺省页面、普通 spinner 或不明跳转掩盖状态。

## 2 Scope List

### In scope

- `cold-start`、全局 `loading`、`title`、`new-game`、`continue`。
- `residence` 驻地实景和少 UI 模式：锚定导流仪、床A/床B/床C、匹配中漫游、影子大厅、床前就绪。
- `battle-intro`、`enter-dream` 纯白显形、`battle-hud` 进入和退出边界。
- `pause`、`settings`、`narrative`、`notification`、`error` overlay 的统一优先级、z-index、焦点锁和输入仲裁。
- `result`、`reward`、`return-home` 纯白显形、原位置驻地落点。
- `StatePort`/`ActionPort`/`CadencePort` 或等价 `UiPorts` 的 mock adapter、projection 消费和 intent 交接。
- 全局设置与全局 feedback：显示、声音、输入、无障碍、语言、图形、reduced-motion、字幕、播报、触觉及连接/请求反馈的 UI wiring。
- 控制面板作为唯一稳定的切换与抽取中转层；B6 交付物可被后续抽取为独立 shell，不把业务逻辑藏在页面组件中。

### Out of scope

- 玩法、回合、AP/HP/SP、伤害、AI、ORCA、pathfinding、MapData、场景拓扑、碰撞和引擎运行时。
- 真实匹配、队伍权限、服务器协议、加载器、存档、结算计算、奖励发放和经济账本。
- 床B联机副本、床C正式入局；床B保持后置 disabled，床C最多进入自测说明/预览并安全返回。
- 研究台、造梦舱、电脑、书架、保险箱内部功能；只保留明确入口端口和返回语义。
- 独立统一大厅场景；影子大厅必须叠加在原驻地，不重载第二套场景。

## 3 Reference Materials

只把下列附件当作可追溯参考，不复制其内部业务实现：

- `attachmentId: governance-journey-11`  
  `provenance: .kiro/specs/v0-frontend-workflow/prompts/references/source/governance-journey-11.md`  
  用途：标题启动前置、驻地→匹配→床→入梦→对局→结算→返回驻地完整旅程；影子大厅、原位置、纯白显形唯一传送语言。
- `attachmentId: governance-v0-shell-10`  
  `provenance: .kiro/specs/v0-frontend-workflow/prompts/references/source/governance-v0-shell-10.md`  
  用途：V0 壳层生产、控制面板抽取、前端结构保留、mock→真实端口替换和接线门禁。
- `attachmentId: governance-v0-system-12`  
  `provenance: .kiro/specs/v0-frontend-workflow/prompts/references/source/governance-v0-system-12.md`  
  用途：零游戏逻辑、完整 UI 流程骨架、命令/控制面板作为稳定提取接口。
- `attachmentId: ops-residence-flow-03`  
  `provenance: residence route, anchor gate, bed roles, async match, shadow lobby, white manifestation, load failure and original-position return`  
  用途：B3 已冻结的驻地与入梦边界；床A竞技、床B后置、床C自测-only。
- `attachmentId: frontend-ui-port-contract`  
  `provenance: .kiro/specs/v0-frontend-workflow/prompts/00-global/G-03-ui-port-contract.md`  
  用途：只读 `StatePort`、显式 `ActionPort`、刷新节奏、request/result 状态和 mock adapter。
- `attachmentId: interaction-accessibility-contract`  
  `provenance: .kiro/specs/v0-frontend-workflow/prompts/00-global/G-04-interaction-accessibility.md`  
  用途：五态、键盘/手柄等价、Radix focus scope、live region、同屏选择上限。
- `attachmentId: presentation-ui-01`  
  `provenance: global color semantics, z-index baseline, focus/input equivalence, white manifestation presentation contract`  
  用途：全局视觉令牌、输入等价、纯白显形和基础层级。
- `attachmentId: presentation-animation-feedback-02`  
  `provenance: animation/result separation, deterministic fallback, reduced motion and resource failure`  
  用途：动画只重演确认结果，失败/跳过不改变规则事实。
- `attachmentId: frontend-implementation-09`  
  `provenance: Framer Motion, Radix, Zustand, Howler, lucide, asset and shell wiring mapping`  
  用途：技术库职责和素材/端口接线边界。

若参考资料之间出现冲突，保留冲突并登记交接项；不得在 B6 内自造规则裁决。已冻结的 B3 MVP 门控和完整旅程 route 优先于泛化旧文案。

## 4 Technical Constraints

- React + TypeScript；所有跨层数据只读。推荐 `StatePort` + `ActionPort` + `CadencePort`，或与之等价的 `UiPorts`。
- 组件只构造 `IntentRequest` 并提交；必须等待 `accepted/rejected/stale/timeout` 和下一版 projection，不能把请求发送当作成功。
- Framer Motion/`AnimatePresence`/声明式 timeline 负责入场、出场、reorder、纯白显形、影子和反馈；禁止用 CSS linear transition 代替核心演出。CSS 仅用于 hover/focus 微状态。
- Radix Dialog/Menu/Popover/FocusScope/Tooltip/Progress 或等价可访问原语负责 overlay、焦点陷阱、恢复、live region 边界。
- Zustand 或等价本地 UI store 只保存焦点、overlay、tab、分页、动效阶段、pending request、reduced-motion 等可丢弃 UI 状态。
- Howler 只由音频/feedback adapter 负责播放；设置改变的是端口意图和本地呈现，不直接操作玩法或全局业务状态。
- lucide-react 提供图标；已登记静态素材通过 `assetId`/`assetRef`/manifest 挂载，缺失走语义 fallback，不用错误素材替代。
- 统一语义色：蓝=清醒/科技/导流，青=交流/UGC，橙=进行中/AP 语义，绿=安全/确认，红=错误/危险，灰=延迟/disabled，灰白=受制但可交互，纯白/奶白=梦境边界，金/银=少量结算高光。
- 所有可见控件具备 `hover/focus/active/disabled/return` 五态；颜色不是唯一语义。玩家可见数字遵守项目 1–5 约束；内部时间、revision、实体数和调试计数属于内部字段，不展示为玩法数值。
- 视口并列选择、通知栈、错误操作组和面板主要选择一次最多呈现 5 项，超出使用分页、分组或滚动。
- 目标 1920×1080 桌面布局，同时支持缩窄视口；不得因响应式重排改变动作权限、route 顺序或焦点顺序。
- 控制面板是抽取边界，不是玩法控制台：页面切换、变体切换、动画播放和 feedback preview 只改变 UI 表面。

## 5 Naming Rules

- 页面/route id 固定使用：`cold-start`、`loading`、`title`、`residence`、`anchor-device`、`matching`、`residence-roaming`、`shadow-lobby`、`bed-front-ready`、`battle-intro`、`enter-dream`、`battle-hud`、`result`、`reward`、`return-home`、`residence-original-position`。
- overlay id 固定使用：`pause`、`settings`、`narrative`、`notification`、`error`、`connection-feedback`、`intent-feedback`。
- 组件文件名采用稳定语义名：`JourneyRouter`、`JourneyStateMachine`、`OverlayCoordinator`、`InputArbiter`、`FocusRestoreManager`、`GlobalSettingsPanel`、`GlobalFeedbackRegion`、`ControlPanelExtractionBoundary`、`WhiteManifestationTransition`、`MockUiPorts`、`UiPortAdapter`。
- intent 使用点号命名，例：`route.new-game`、`route.continue`、`anchor.open`、`match.start`、`match.cancel`、`bed.ready`、`ceremony.skip`、`pause.open`、`settings.open`、`settings.preview`、`settings.save`、`overlay.close`、`load.retry`、`load.cancel`、`result.continue`、`safe-return`。
- 数据类型使用 `Readonly*`/`*Snapshot`/`*Projection` 后缀；动作使用 `*Intent`/`IntentRequest`；端口使用 `StatePort`、`ActionPort`、`CadencePort`、`UiPorts`。
- `mock` 只能表示 fixture/adapter 来源；不得用 `mock` 命名已确认业务结果。所有 mock 画面显式显示 `mock` 标签或可读状态。
- 组件、route、intent、overlay、z-index token 的名称必须在 Prompt、生成代码、抽取交接中保持一致，不因 v0 生成习惯改名。

## 6 Interaction Rules

- 同一意图 builder 服务鼠标、触控、键盘、手柄和屏幕阅读器操作；Enter/Space 确认，Esc 取消/关闭当前 overlay，Tab/Shift+Tab 移动焦点，方向键在列表/模式选择中移动。
- 启动：冷启动先显示加载/连接反馈，加载失败可重试或安全退出；标题提供 `新游戏`、`继续`、`选项`、`退出`，缺少存档时 `继续` 为 disabled 并说明原因。
- `新游戏`/`继续` 只提交 route intent，成功后落地驻地，不直接进入对局；`选项`打开 settings overlay；`退出`提交退出意图并等待端口结果。
- 驻地是空间实景少 UI，不显示战斗 HUD。锚定导流仪是唯一 MVP 匹配门控；锚定导流仪未完成前床A/B/C均不可直接入局。
- 匹配是异步、非阻塞：匹配中仍可漫游和使用非冲突入口；取消返回驻地 idle。匹配超时同时给出重试、取消和安全返回。
- MVP 只允许床A竞技。床B显示后置 disabled，不进 Tab 可操作顺序；床C只打开自测说明/预览，分支结束安全回驻地，不进入正式装载。
- 匹配完成后只点亮 `targetBed` 对应床A；影子大厅叠加在原驻地，玩家仍可见原位置和非冲突交互。影子中继错误只显示 stale/error，不伪造无人或完成。
- 玩家到床A前执行就绪；床前就绪、对局介绍和纯白入梦均可取消或跳过演出，但不得跳过必需的端口确认。装载失败提供 `retry-load`、`load-cancel`、`safe-return`。
- 对局 HUD 的退出、暂停、设置、叙事、通知和错误都通过统一 overlay coordinator；不由页面各自创建第二套全局 overlay。
- overlay 关闭后焦点返回触发源；route 改变、触发源卸载或请求失败时回到最近安全锚点：当前页面主区域、暂停按钮、驻地原位置或错误面板首个可用动作。
- 结算→奖励必须保持可读顺序；`result.continue` 成功后只经 `return-home` 纯白显形到 `residence-original-position`，不能直接跳标题、默认出生点或另一场景。
- 所有 pending、拒绝、超时、过期和重同步结果都进入全局 feedback，且有文字、状态图标和可访问 live region；不以音效或颜色单独传达。

## 7 Explicit Exclusions

- 不写规则状态机、后端状态机或业务 reducer；B6 的状态机只描述 route/overlay 表现状态。
- 不调用 `OpRegistry.invoke`，不直接写玩法 store、存档、匹配、结算、奖励、玩家位置或资源账本。
- 不实现真实网络、服务器重连、匹配队列、房间、队伍权限、加载器、地图、寻路、AI、物理、战斗和规则计算。
- 不把匹配等待做成阻塞等待页，不创建独立统一大厅，不把床做成按钮矩阵。
- 不把床B/C错误地标为可入局，不把研究台/造梦舱/电脑/书架/保险箱内页塞进 B6。
- 不用普通 loading 页面、单帧白屏、黑色 SaaS 卡片墙、网页滚动条或纯占位方块替代空间/仪式表现。
- 不新增主色、废用术语、第二套传送语言、第二套 route store、第二套控制面板或第二套全局反馈中心。
- 不因为 UI 需要而修改 B3、全局契约、后端接口或其他目录；冲突写成交接项。

## 8 Batch Objective

交付一个可被无上下文 AI 直接消费的 B6 完整旅程整合 Prompt 包，使其能够：

1. 从 `cold-start` 走到 `residence-original-position`，覆盖冷启动、加载、标题、新游戏/继续、驻地、锚定导流仪、匹配、漫游、影子大厅、床前就绪、对局介绍、纯白入梦、HUD、暂停/设置/叙事/通知/错误、结算、奖励、纯白返回和原位置驻地。
2. 对每个 route/overlay 节点给出空、错、超时、重试、取消和安全返回语义。
3. 统一 overlay 优先级、z-index、焦点锁/恢复和输入仲裁，避免 overlay 互相抢输入。
4. 把全局设置、feedback 和控制面板抽取固化为稳定组件/端口边界。
5. 提供 mock→UI port 替换路径，在不改变组件树、命名和交互语义的情况下替换数据源。
6. 明确所有 UI 组件只做表现和 intent，不实现规则或后端。

## 9 Batch Dependencies

- 依赖 G-01 项目与范围合同、G-02 视觉令牌合同、G-03 UI Port 合同、G-04 交互无障碍合同、G-05 动效音频 fallback、G-06 mock fixture 和 G-08 页面/批次索引。
- 依赖 B1 壳层/AppShell、控制面板挂载点和全局 route host；B6 不改 B1 交付物，只消费稳定挂载点。
- 依赖 B2 battle HUD、B3 residence/transition、B5 narrative/notification 的页面组件和 intent 名称；若既有组件尚未冻结，按本包命名建立适配端口，不复制业务实现。
- 依赖运营侧只读投影：会话、匹配、装载、结算、奖励、`returnOrigin`；B6 只依赖稳定字段和结果，不依赖内部对象形状。
- 依赖素材/manifest 挂载、音频 adapter、浏览器 reduced-motion 和可访问原语。
- 依赖关系不是写权限：本批次只允许写入 `06-full-journey-integration/`；任何其他模块需改动时只留下交接项。

## 10 Acceptance Checks

- [ ] 只创建本目录约定的 5 个文件，文件名和路径完全一致。
- [ ] `B6-00` 具有本文件规定的 11 节且顺序不变；四份子 Prompt 具有固定 15 节且顺序不变。
- [ ] route 可从冷启动完整走到原位置驻地，至少覆盖成功、空、错、超时、重试、取消、安全返回。
- [ ] 标题包含新游戏/继续/选项/退出；继续无存档时有可访问 disabled reason。
- [ ] 驻地保留空间语义；锚定导流仪是匹配门控；床A/B/C门控符合 B3；匹配中可漫游；影子不重载场景。
- [ ] 床前就绪→对局介绍→纯白入梦→HUD→结算→奖励→纯白返回→原位置驻地连续可演示。
- [ ] 覆盖 pause/settings/narrative/notification/error/connection feedback 的优先级、z-index、焦点锁/恢复和输入仲裁。
- [ ] 全局 settings 覆盖显示、声音、输入、无障碍、语言、图形及 reduced-motion/字幕/播报/触觉；保存只提交 intent。
- [ ] 控制面板是唯一切换/抽取边界；mock→UI port 替换不改组件树、命名或 route。
- [ ] 不实现规则、后端、匹配算法、存档、结算、奖励、玩家位置或任何业务写入。
- [ ] 所有控件有五态、键盘等价、live region、错误原因、reduced-motion 和语义 fallback；颜色不是唯一信息。
- [ ] 运行静态自检确认无目录外改动；代码接入阶段另行执行项目三命令门禁。

## 11 Attached AI-readable packet

本命令必读本文件+同目录 numbered briefs；G-* 和 R-* 是可选补充，正文摘要已足够执行。
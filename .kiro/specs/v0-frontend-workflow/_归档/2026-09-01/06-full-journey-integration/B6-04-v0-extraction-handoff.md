# B6-04 V0 Extraction Handoff

## 1 页面定位

本 Prompt 定义 B6 完整旅程从 V0.dev 生成壳到 WakeUp UI 的抽取与接线交接。交付重点不是重新设计页面，而是保留 V0 的组件树、视觉令牌、动效和交互手感，只把 mock fixture、占位回调、假 route、假 overlay、假设置和假 feedback 替换为稳定的 UI ports。完整 route 上下文保持：`cold-start → loading → title → new-game/continue → residence → anchor-device → matching/residence-roaming/shadow-lobby → bed-front-ready → battle-intro → enter-dream → battle-hud → pause/settings/narrative/notification/error overlays → result → reward → return-home → residence-original-position`。

抽取后的壳必须能够走完整 route：冷启动→加载→标题→新游戏/继续→驻地→锚定导流仪→匹配/漫游/影子大厅→床前就绪→对局介绍→纯白入梦→HUD→暂停/设置/叙事/通知/错误覆盖→结算→奖励→纯白返回→原位置驻地。接线工作只连接只读投影和显式 intents，不实现规则、后端、匹配、装载、结算、奖励、存档、寻路或 AI。

`ControlPanelExtractionBoundary` 是唯一稳定抽取面：它可以切换 route/variant、触发表现动画、预览 feedback、检查端口状态，但任何控件都不能成为规则执行器。后续真实端口替换不能破坏 route 名、组件名、z-index、focus、input arbitration 或纯白显形语义。

## 2 权威来源

- `attachmentId: governance-v0-shell-10`  
  `provenance: .kiro/specs/v0-frontend-workflow/prompts/references/source/governance-v0-shell-10.md`  
  V0.dev 壳层生产、前端结构保留、mock→真实端口替换、命名和接线门禁。
- `attachmentId: governance-v0-system-12`  
  `provenance: .kiro/specs/v0-frontend-workflow/prompts/references/source/governance-v0-system-12.md`  
  零游戏逻辑、控制面板作为命令/提取接口、完整 UI 流程骨架。
- `attachmentId: frontend-ui-port-contract`  
  `provenance: .kiro/specs/v0-frontend-workflow/prompts/00-global/G-03-ui-port-contract.md`  
  StatePort、ActionPort、CadencePort、request/result/revision 和写入隔离。
- `attachmentId: governance-journey-11`  
  `provenance: .kiro/specs/v0-frontend-workflow/prompts/references/source/governance-journey-11.md`  
  完整旅程、床/锚定导流仪职责、影子大厅、纯白显形和原位置返回。
- `attachmentId: ops-residence-flow-03`  
  `provenance: B3 residence flow prompt family: bed A/B/C gates, matching, load errors and return origin`  
  已冻结驻地 MVP 门控和错误回退。
- `attachmentId: interaction-accessibility-contract`  
  `provenance: .kiro/specs/v0-frontend-workflow/prompts/00-global/G-04-interaction-accessibility.md`  
  五态、输入等价、焦点锁/恢复、live region 和 reduced-motion。
- `attachmentId: frontend-implementation-09`  
  `provenance: Framer Motion/Radix/Zustand/Howler/lucide and asset-to-shell mapping`  
  技术实现、素材挂载和表现层边界。

抽取方若发现权威文档冲突，不擅自修改其他交付物；在 handoff register 中记录 source、冲突、影响、建议 owner 和阻塞级别。

## 3 当前决策

- V0 代码被视为 presentation shell，不被视为业务实现。保留组件层级、页面结构、props 语义、视觉 token、Framer Motion 编排和可访问原语；替换数据、回调和端口适配。
- 所有 route、overlay、settings、feedback 和 control panel 共享一套稳定名称：`JourneyRouter`、`JourneyStateMachine`、`OverlayCoordinator`、`InputArbiter`、`FocusRestoreManager`、`GlobalSettingsPanel`、`GlobalFeedbackRegion`、`ControlPanelExtractionBoundary`。
- 所有占位数据必须明确 `source: 'mock'` 和 `mock: true`；接入真实投影后只替换 adapter，不在页面组件中增加第二套条件分支。
- 所有业务动作先由 `IntentRequest` 进入 `ActionPort`，呈现 pending；只有收到 result 和后续 projection 才呈现确认结果。V0 的 `onClick={() => setState(success)}`、`onSelect` 直接改业务状态必须移除。
- mock adapter 与真实 UI port 具有相同接口和字段白名单；组件树、intent 名、route id、overlay id、z-index token、焦点顺序和可读文案保持不变。
- 控制面板中的 `switch-page`、`switch-variant`、`filter-category`、`play-state-transition`、`play-click` 只能改变 UI surface；不得模拟匹配成功、床点亮、战斗结果、奖励入账或玩家移动。
- 抽取前先用 packet audit 查 scope、route、overlay 和固定排除项；抽取后再跑类型、测试、lint、文档术语门禁。

## 4 状态机

```text
v0-imported
  -> packet-audited
  -> shell-inventory-created
  -> mock-adapter-bound
  -> port-contract-bound
  -> intent-bound
  -> overlay-and-focus-verified
  -> route-journey-verified
  -> extraction-ready

任一阶段：
  ├─ missing-contract -> handoff-blocked
  ├─ naming-drift -> correction-required
  ├─ business-logic-found -> boundary-violation
  ├─ asset-missing -> semantic-fallback
  ├─ port-timeout -> retry-or-safe-return
  └─ test/lint/type failure -> correction-required

extraction-ready
  ├─ shell-only export -> extracted-shell
  ├─ production adapter export -> ui-port-ready
  └─ unresolved handoff -> blocked-with-register
```

运行时接线结果仍遵守：

```text
projection snapshot
  -> render shell
intent request
  -> pending
  -> accepted | rejected | stale | timeout
  -> next projection revision
  -> render confirmed or recoverable feedback
```

V0 的本地动画状态不能替代上述结果。动效可在 pending 期间表达“请求中”，但成功动效必须绑定 confirmed projection 或明确的表现事件；动画失败、跳过或资源缺失只影响视觉，不改变结果。

## 5 组件树

抽取后的稳定边界如下，V0 可有内部细分但不得删除这些职责：

```text
<WakeUpUiShell>
  ├─ <PortProvider ports={uiPorts}>
  │  ├─ <JourneyRouter>
  │  │  ├─ <ColdStartSurface />
  │  │  ├─ <GlobalLoadingSurface />
  │  │  ├─ <TitleSurface />
  │  │  ├─ <ResidenceRouteSurface />
  │  │  ├─ <AnchorDeviceSurface />
  │  │  ├─ <MatchingResidenceSurface />
  │  │  ├─ <ShadowLobbySurface />
  │  │  ├─ <BedFrontReadySurface />
  │  │  ├─ <BattleIntroSurface />
  │  │  ├─ <WhiteManifestationTransition />
  │  │  ├─ <BattleHudSurface />
  │  │  ├─ <ResultSurface />
  │  │  ├─ <RewardSurface />
  │  │  └─ <ReturnHomeTransition />
  │  ├─ <OverlayCoordinator>
  │  │  ├─ <PauseOverlay />
  │  │  ├─ <SettingsOverlay />
  │  │  ├─ <NarrativeOverlay />
  │  │  ├─ <NotificationOverlay />
  │  │  ├─ <BlockingErrorOverlay />
  │  │  └─ <GlobalFeedbackRegion />
  │  ├─ <InputArbiter />
  │  └─ <FocusRestoreManager />
  └─ <ControlPanelExtractionBoundary>
     ├─ <RouteSwitcher />
     ├─ <VariantSwitcher />
     ├─ <FeedbackPreview />
     ├─ <AnimationPreview />
     └─ <PortStatusInspector />
```

`ControlPanelExtractionBoundary` 可在开发期展示，但必须带开发期标签；它不能作为产品侧第二个主菜单、等待大厅或规则调试器。`PortProvider` 是依赖注入边界，不把后端内部对象传进页面。

## 6 只读数据

```ts
interface UiPorts {
  readonly state: StatePort;
  readonly action: ActionPort;
  readonly cadence: CadencePort;
  readonly settings: SettingsPort;
  readonly feedback: GlobalFeedbackPort;
  readonly assets: AssetPort;
  readonly audio: AudioFeedbackPort;
}

interface StatePort {
  getSnapshot(): ReadonlyUiSnapshot;
}

interface ActionPort {
  submit(request: IntentRequest): Promise<IntentResult>;
}

interface CadencePort {
  subscribe(listener: (snapshot: ReadonlyUiSnapshot) => void): () => void;
}

interface IntentRequest {
  readonly requestId: string;
  readonly intentId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly baseRevision: string;
}

interface IntentResult {
  readonly requestId: string;
  readonly status: 'accepted' | 'rejected' | 'stale' | 'timeout';
  readonly reason?: string;
  readonly nextRevision?: string;
}

interface ReadonlyUiSnapshot {
  readonly route: string;
  readonly revision: string;
  readonly source: 'mock' | 'projection';
  readonly phase: string;
  readonly entities: readonly Readonly<Record<string, unknown>>[];
  readonly resources: readonly Readonly<Record<string, unknown>>[];
  readonly overlays: readonly Readonly<Record<string, unknown>>[];
  readonly settings: Readonly<Record<string, unknown>>;
  readonly feedback: readonly Readonly<Record<string, unknown>>[];
}
```

抽取时建立字段白名单映射表：V0 field → 稳定 projection field → port source → fallback。UI 不读取实体实例、规则对象、后端异常、账本、导航图或回调闭包。`entities/resources` 只可用于已批准的可见投影字段，且不允许页面自行派生规则结果。

`MockUiPorts` 必须覆盖完整 route 的 happy path、empty save、asset missing、projection error、intent rejection、timeout、stale revision、match timeout、load failure、shadow relay stale、reward unavailable 和 safe-return；每个 fixture 带 `mock: true`。

## 7 动作意图

```ts
type StableUiIntentId =
  | 'route.new-game'
  | 'route.continue'
  | 'route.exit'
  | 'anchor.open'
  | 'match.start'
  | 'match.cancel'
  | 'residence.roam'
  | 'bed.ready'
  | 'bed-c.self-test.open'
  | 'ceremony.skip'
  | 'pause.open'
  | 'pause.resume'
  | 'settings.open'
  | 'settings.preview'
  | 'settings.save'
  | 'settings.cancel'
  | 'narrative.advance'
  | 'notification.open'
  | 'notification.dismiss'
  | 'error.retry'
  | 'error.cancel'
  | 'result.continue'
  | 'reward.continue'
  | 'route.safe-return'
  | 'control.switch-page'
  | 'control.switch-variant'
  | 'control.filter-category'
  | 'control.play-state-transition'
  | 'control.play-click';
```

每个鼠标、键盘、触控、手柄和屏幕阅读器触发器都通过同一 `buildIntent()` 生成 `IntentRequest`。抽取清单必须逐项记录：触发器、intentId、payload 白名单、baseRevision、pending 表现、accepted/rejected/stale/timeout 表现和焦点归还目标。

禁止：

```ts
// 不允许在抽取后的 shell 中保留
onClick={() => setMatchComplete(true)}
onSelect={() => awardReward()}
onChange={() => setBattleStarted(true)}
```

允许：

```ts
const request = buildIntent('match.start', { mode: 'competitive' }, snapshot.revision);
return actionPort.submit(request);
```

上例只提交意图；组件必须等待结果与新 snapshot，不得从 Promise resolve 自行写规则状态。

## 8 本地 UI 状态

保留 V0 中仅属于表现层的状态：当前 route tab/variant、panel open/close、focus index、hover/active、overlay stack、selected item、pagination/scroll、settings preview draft、pending requestId、animation phase、asset loading status、toast visibility、reduced-motion 和 audio preview handle。

移除或替换以下状态：`isMatchComplete`、`hasWon`、`rewardGranted`、`playerPosition` 作为业务真相、`currentTurn`、`apRemaining`、`bedUnlocked`、`saveExists` 的本地推断、任何 `mockSuccess` 超时后自动设 true。

本地 store 可以镜像 projection 以便渲染，但必须携带 `revision/source`，在 revision 变化时更新，不得比投影更权威。设置 preview 在离开面板、取消或 stale 时按明确策略丢弃；不把浏览器存储冒充端口保存成功。

## 9 视觉令牌

- 保留 V0 已审定的布局和质感，但将颜色引用收敛为全局 token：蓝科技/清醒、青交流/UGC、橙进行中/AP、绿确认/安全、红错误/危险、灰延迟/disabled、纯白梦境边界、金银少量奖励高光。
- 不将 mock/placeholder 资源默默替换成错误语义资源；挂载 `assetRef/assetId`，失败时保留容器、名称、原因和 fallback 图标/文字。
- 维持 B6-02 z-index token：world 0、entity 4、focus 5、route UI 10、notification 20、narrative 30、pause 40、settings 50、safety 60、blocking error 70、global feedback 80、focus ring 90。
- 保留 V0 的五态并补齐缺少的 `disabled` reason、`pending`、`stale`、`error`、`return`；颜色、动效和音效都不是唯一信息。
- 驻地仍是空间实体和少 UI，不转为仪表盘；影子大厅仍是原驻地叠加；纯白显形仍是入梦/返回唯一门。

## 10 动效绑定

- 先保留 V0 的 Framer Motion 结构，检查所有成功动画的触发条件。成功演出只能由 projection/result/after event 确认触发；请求发送只能显示 pending。
- `enter-dream`/`return-home` 提取为 `WhiteManifestationTransition`，保留床固定、人物显形、颜色曲线、可跳过和 reduced-motion fallback；不得改为普通淡入或单帧白屏。
- route/overlay 入场使用 `AnimatePresence`/`layout`；overlay 由 B6-02 coordinator 仲裁；通知使用 layout reorder；设置保存使用 pending→confirmed/error 两条明确分支。
- 动效、音频、震动和粒子接收稳定语义 event/feedback，不从字段名称猜动作。资源缺失时按指定配方→同语义默认→程序化反馈→图标/文字降级。
- 动画超时、GPU 故障、用户跳过和 reduced-motion 必须直接收敛到已确认最终状态；不得拒绝合法 projection、不得改写 route。

## 11 输入无障碍

- 抽取保留 Radix Dialog/Menu/FocusScope/Tooltip/Progress 或等价可访问原语；不得把可交互 div、仅 hover 操作或仅鼠标拖拽带入生产 shell。
- 所有 trigger 同时支持 pointer、keyboard、gamepad 和触控；Enter/Space 确认，Esc 取消当前可取消 overlay，Tab/Shift+Tab 顺序稳定，方向键操作列表/slider。
- 记录并验证 focus path：标题→驻地→锚定导流仪→床A→对局介绍→HUD→暂停→设置→返回 HUD→结算→奖励→原位置驻地。任何 route/overlay 变化后焦点有明确落点。
- B6-02 的 input owner 作为唯一快捷键仲裁者；V0 组件内的 document-level keydown listener 必须移除或接入 `InputArbiter`。
- live region 宣布加载、匹配中、床A点亮、装载失败、结果确认、奖励读取、返回原位置、端口拒绝、超时和安全返回；不逐个播报粒子和低优先级 toast。
- 保留 reduced-motion、字幕、文字播报、文字缩放、颜色之外的图标/标签/纹理差异；焦点环不能被 clip/overflow 截断。

## 12 加载错误超时

- 抽取阶段若 V0 的数据 fetch、fake API 或 timer 直接设成功，替换为 `StatePort`/`ActionPort`/`CadencePort`；等待态必须有标题、阶段、重试、取消和安全返回。
- UI port 未连接、projection error、stale revision、intent rejected、timeout、asset missing、audio unavailable 分开呈现，不能都变成“加载失败”。
- match timeout 保留 residence roaming，允许 retry/cancel；load failure 保留 returnOrigin，允许 retry-load/load-cancel/safe-return；shadow relay stale 不将空影子解释为无人。
- 设置 save timeout 保留未保存 draft 并明确风险；result/reward projection 缺失不重复发放或本地补奖励。
- 任何 route/overlay 错误都回到最近合法安全锚点；若 trigger 卸载，回当前 surface 标题、pause、residence original position 或 error 首个可用动作。
- 资产缺失沿 manifest/assetRef 语义降级；不能删除实体、用其他实体素材替代或以零素材宣称完成。

## 13 明确不做

- 不重构 V0 视觉为新设计，不引入第二套组件库、第二套 route store、第二套 overlay manager 或第二套 settings/feedback pipeline。
- 不在抽取中实现或修补玩法规则、匹配/加载服务、存档、战斗、AI、寻路、地图、结算、奖励、经济、玩家位置和后端协议。
- 不把 V0 的 hard-coded demo data 直接发布；不把 `mock`、`fake`、`placeholder` 成功分支留在生产 adapter 中。
- 不为了类型通过而把 `unknown` 扩散进页面 props、移除只读约束、把 `any` 当业务 port 或绕过 result/revision。
- 不静默吞掉缺失素材、端口拒绝、超时、焦点失败、输入冲突、术语偏差或 z-index 冲突；全部写入 handoff register。
- 不修改 B1/B2/B3/B5、全局契约、后端或其他目录；本 Prompt 只规定交接，不越权写代码。

## 14 依赖交接

### 抽取方交付给接线方

- `ShellInventory`：V0 文件、组件、props、内部 state、依赖、mock/fake/placeholder 清单。
- `IntentMapping`：每个 trigger → stable intentId → payload/baseRevision → result handling → focus restore。
- `ProjectionMapping`：每个显示字段 → readonly projection 白名单 → source port → fallback。
- `OverlayInventory`：overlay id、mode、priority、z-index token、input owner、focus trap、dismiss/restore。
- `AssetAndFeedbackInventory`：assetRef/manifest、加载错误、音频/粒子/震动 fallback、字幕/文字反馈。
- `HandoffRegister`：冲突、缺失设计、术语修正、依赖缺失、需 owner 决策项和阻塞级别。

### 接线方必须提供

```ts
interface ExtractionHandoff {
  readonly batchId: 'B6';
  readonly stableComponents: readonly string[];
  readonly routeIds: readonly string[];
  readonly overlayIds: readonly string[];
  readonly intentIds: readonly string[];
  readonly ports: readonly string[];
  readonly mockCases: readonly string[];
  readonly unresolvedItems: readonly string[];
}
```

- 真实 port adapter 只实现稳定 `UiPorts` 或等价端口；不要求页面知道后端类名、目录、网络库或内部数据形状。
- 需要改变接口时先发布兼容 adapter 或登记交接项；不得直接改 V0 页面调用方以绕过契约。
- 生产接线完成后执行 `npx tsc --noEmit`、`npx vitest run`（相关范围）、`npm run lint`、`npm run verify:docs`；若仓库环境无法执行，报告具体阻塞，不以静态阅读代替。
- 抽取与接线均只能修改各自授权目录；本 Prompt 的文件写权限仅为 `06-full-journey-integration/`。

## 15 验收条件

- [ ] V0 shell inventory、intent mapping、projection mapping、overlay inventory、asset/feedback inventory 和 handoff register 完整。
- [ ] 完整 route 可由 mock adapter 走通：冷启动、加载、标题、新游戏/继续、驻地、锚定导流仪、匹配/漫游/影子大厅、床前就绪、对局介绍、纯白入梦、HUD、暂停/设置/叙事/通知/错误、结算、奖励、纯白返回、原位置驻地。
- [ ] mock fixture 明确标记，真实 port 替换不改变组件树、route id、overlay id、intent id、z-index、焦点顺序或可访问文案。
- [ ] 所有 trigger 经 ActionPort，所有业务结果来自 projection/result；无 `onClick` 规则写入、无 fake success、无本地奖励/匹配/战斗推进。
- [ ] overlay 优先级、z-index、input owner、focus lock/restore 与 B6-02 一致；全局 settings/feedback 与 B6-03 一致。
- [ ] 床A/B/C门控、匹配中漫游、影子不重载、纯白显形唯一门和 returnOrigin 原位置返回均可验证。
- [ ] 空、错、超时、重试、取消、安全返回、asset/audio fallback、reduced-motion、键盘/手柄/读屏路径均可演示。
- [ ] 抽取和接线没有修改授权目录之外文件；门禁命令结果与未完成交接项被如实记录。

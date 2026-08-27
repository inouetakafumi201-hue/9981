# B6-01 Route State Machine

## 1 页面定位

本 Prompt 定义 B6 完整旅程的 `JourneyRouter` 与 `JourneyStateMachine` 表现层合同。它把冷启动到原位置驻地的每一个 route 节点串成可演示的声明式状态机，并把加载、错误、超时、重试、取消和安全返回闭合在每个节点内。

它不是玩法/后端状态机。组件只读取 `ReadonlyJourneyProjection`，提交 `JourneyUiIntent`，等待端口结果并渲染下一版投影。不可在 route reducer、点击处理器或动效回调中推进对局、匹配、结算、奖励、存档或玩家位置；本 Prompt 不实现规则、后端、业务写入或真实网络。

完整 route 固定为：冷启动→加载→标题→新游戏/继续→驻地→锚定导流仪→匹配/漫游/影子大厅→床前就绪→对局介绍→纯白入梦→HUD→暂停/设置/叙事/通知/错误覆盖→结算→奖励→纯白返回→原位置驻地。

## 2 权威来源

- `attachmentId: governance-journey-11`  
  `provenance: .kiro/specs/v0-frontend-workflow/prompts/references/source/governance-journey-11.md`  
  权威旅程顺序、标题落地驻地、异步匹配、床A门控、影子大厅、纯白显形和原位置返回。
- `attachmentId: ops-residence-flow-03`  
  `provenance: residence flow B3 prompt family: anchor gate, bed roles, matching, shadow, bed-ready, load failure and returnOrigin`  
  驻地状态与 MVP 门控：床A竞技、床B后置 disabled、床C自测-only。
- `attachmentId: frontend-ui-port-contract`  
  `provenance: .kiro/specs/v0-frontend-workflow/prompts/00-global/G-03-ui-port-contract.md`  
  StatePort/ActionPort/CadencePort、pending/result/revision 纪律。
- `attachmentId: frontend-workflow-design`  
  `provenance: .kiro/specs/v0-frontend-workflow/design.md`  
  页面目录、控制面板边界、Prompt/抽取边界。
- `attachmentId: interaction-accessibility-contract`  
  `provenance: .kiro/specs/v0-frontend-workflow/prompts/00-global/G-04-interaction-accessibility.md`  
  五态、输入等价、焦点和弹层语义。

## 3 当前决策

- `title` 是壳层最外层启动前置，提供新游戏、继续、选项、退出；新游戏/继续成功后落地 `residence`，不直接进对局。
- `residence` 默认少 UI；锚定导流仪完成门控后，床A才可用于竞技装载；床B永远后置 disabled；床C只进入自测说明/预览，不进入正式局。
- 匹配是异步非阻塞，`matching` 可并行呈现 `residence-roaming`；成功后 `shadow-lobby` 叠加原场景，不能加载独立大厅。
- 只有权威投影确认匹配完成、玩家在床A前并确认就绪后，才允许进入 `battle-intro`、`enter-dream` 和 `battle-hud`。
- `result` 与 `reward` 是只读呈现；`result.continue` 成功后必须经 `return-home` 纯白显形回 `residence-original-position`。
- 每个 route 状态的入口、完成、空、错误、超时、重试、取消和安全返回都必须可表达；没有权威确认时只显示 pending/stale，不提前跳转。
- route 状态机只拥有可丢弃 UI 状态：当前 route、overlay stack、pending request、焦点锚点、演出阶段、超时视觉态。

## 4 状态机

```text
cold-start
  -> loading
loading
  ├─ ready -> title
  ├─ empty-save -> title (continue-disabled)
  ├─ error -> loading-error
  └─ timeout -> loading-timeout
loading-error | loading-timeout
  ├─ retry -> loading
  ├─ cancel -> safe-exit
  └─ safe-return -> title-safe-fallback | safe-exit

title
  ├─ new-game-requested -> route-pending -> residence
  ├─ continue-requested -> route-pending -> residence
  ├─ options-open -> settings-overlay
  └─ exit-requested -> safe-exit

residence
  ├─ anchor-open -> anchor-device
  ├─ non-conflict-roam -> residence-roaming
  ├─ bed-c-self-test -> self-test-preview -> residence
  ├─ match-start -> matching
  └─ asset/projection error -> residence-error

anchor-device
  ├─ confirm competitive -> matching
  ├─ cancel/close -> residence
  ├─ stale/error -> anchor-error
  └─ timeout -> anchor-timeout

matching
  ├─ roam -> residence-roaming (matching remains active)
  ├─ complete -> shadow-lobby | bed-a-lit
  ├─ cancel -> residence
  ├─ error -> matching-error
  └─ timeout -> matching-timeout

shadow-lobby
  ├─ bed-a-ready projection -> bed-front-ready
  ├─ relay-stale -> shadow-stale (retains residence)
  ├─ cancel -> residence
  └─ error/timeout -> residence-safe-return

bed-front-ready
  ├─ ready-at-bed-a accepted -> battle-intro
  ├─ cancel -> residence
  ├─ load-error -> load-failed
  └─ timeout -> load-timeout

battle-intro
  ├─ projection-ready -> enter-dream
  ├─ skip -> enter-dream-finalizing
  ├─ cancel -> residence-safe-return
  └─ error/timeout -> battle-intro-error

enter-dream
  ├─ complete/skip -> battle-hud
  ├─ cancel -> residence-safe-return
  └─ timeout/error -> battle-hud-safe-entry | residence-safe-return

battle-hud
  ├─ pause -> pause-overlay
  ├─ narrative/notification/settings/error -> corresponding overlay
  ├─ result-ready -> result
  ├─ leave-accepted -> return-home | residence-original-position
  └─ stale/error/timeout -> battle-error-overlay

result
  ├─ reward-ready -> reward
  ├─ continue -> return-home
  ├─ retry-projection -> result-loading
  └─ safe-return -> return-home | residence-original-position

reward
  ├─ continue accepted -> return-home
  ├─ error/timeout -> reward-error
  └─ safe-return -> return-home

return-home
  ├─ complete -> residence-original-position
  ├─ skip -> residence-original-position
  ├─ error/timeout -> residence-safe-return
  └─ retry -> return-home

residence-original-position
  ├─ projection-ready -> residence
  └─ error/timeout -> residence-recovery
```

任何 `error/timeout` 都必须保留原因、`retry`、`cancel` 和 `safe-return`。安全返回不得把 `returnOrigin` 丢掉；若原位置投影不可用，显示“原位置暂不可恢复（mock/端口错误）”并回驻地安全锚点，不伪造坐标。

## 5 组件树

```text
<JourneyShell>
  ├─ <JourneyRouter>
  │  ├─ <ColdStartSurface />
  │  ├─ <GlobalLoadingSurface />
  │  ├─ <TitleSurface />
  │  ├─ <ResidenceRouteSurface />
  │  ├─ <AnchorDeviceSurface />
  │  ├─ <MatchingResidenceSurface />
  │  ├─ <ShadowLobbySurface />
  │  ├─ <BedFrontReadySurface />
  │  ├─ <BattleIntroSurface />
  │  ├─ <WhiteManifestationTransition />
  │  ├─ <BattleHudSurface />
  │  ├─ <ResultSurface />
  │  ├─ <RewardSurface />
  │  └─ <ReturnHomeTransition />
  ├─ <JourneyOverlayHost />
  │  ├─ <PauseOverlay />
  │  ├─ <SettingsOverlay />
  │  ├─ <NarrativeOverlay />
  │  ├─ <NotificationOverlay />
  │  └─ <ErrorOverlay />
  ├─ <RouteStatusRegion />
  └─ <GlobalFeedbackRegion />
</JourneyShell>
```

`JourneyRouter` 只映射 projection route 到表面；`JourneyStateMachine` 只接受端口确认和 route intent；`JourneyOverlayHost` 负责统一 overlay，不允许页面私建全局弹层。

## 6 只读数据

```ts
interface ReadonlyJourneyProjection {
  readonly route: JourneyRouteId;
  readonly phase: 'idle' | 'loading' | 'pending' | 'ready' | 'error' | 'timeout' | 'stale';
  readonly source: 'mock' | 'projection';
  readonly revision: string;
  readonly save: { readonly hasContinue: boolean; readonly status: 'unknown' | 'empty' | 'available' | 'error' };
  readonly residence: {
    readonly positionId: string | null;
    readonly returnOrigin: string | null;
    readonly anchorState: 'locked' | 'idle' | 'matching' | 'complete' | 'error';
    readonly targetBed: 'bed-a' | null;
    readonly bedA: 'locked' | 'lit' | 'ready' | 'loading' | 'failed';
    readonly bedB: 'deferred-disabled';
    readonly bedC: 'self-test-only';
    readonly match: 'none' | 'matching' | 'complete' | 'failed' | 'timeout';
  };
  readonly battle: { readonly intro: 'unavailable' | 'loading' | 'ready' | 'error'; readonly active: boolean; readonly result: 'none' | 'ready' | 'error' };
  readonly reward: { readonly state: 'unavailable' | 'loading' | 'ready' | 'error'; readonly entries: readonly ReadonlyRewardEntry[] };
  readonly availableIntents: readonly string[];
  readonly warnings: readonly string[];
}

type JourneyRouteId =
  | 'cold-start' | 'loading' | 'title' | 'residence' | 'anchor-device'
  | 'matching' | 'residence-roaming' | 'shadow-lobby' | 'bed-front-ready'
  | 'battle-intro' | 'enter-dream' | 'battle-hud' | 'result' | 'reward'
  | 'return-home' | 'residence-original-position';
```

投影中的 `positionId`/`returnOrigin` 是可读标识，不是 UI 自己计算的坐标。没有投影时显示 loading/unknown，禁止以默认点位冒充原位置。

## 7 动作意图

```ts
type JourneyUiIntent =
  | { readonly kind: 'route.new-game' }
  | { readonly kind: 'route.continue' }
  | { readonly kind: 'route.exit' }
  | { readonly kind: 'anchor.open' }
  | { readonly kind: 'match.start'; readonly mode: 'competitive' }
  | { readonly kind: 'match.cancel' }
  | { readonly kind: 'residence.roam'; readonly targetId: string }
  | { readonly kind: 'bed.ready'; readonly bedId: 'bed-a' }
  | { readonly kind: 'bed-c.self-test.open' }
  | { readonly kind: 'ceremony.skip'; readonly ceremony: 'enter-dream' | 'return-home' }
  | { readonly kind: 'result.continue' }
  | { readonly kind: 'route.safe-return'; readonly reason: string }
  | { readonly kind: 'route.retry'; readonly route: JourneyRouteId };
```

所有 intent 通过 `ActionPort.submit({ requestId, intent })` 发送，结果为 `accepted | rejected | stale | timeout`。`accepted` 只表示端口确认请求，不表示 UI 可自行推断下一状态；下一 route 必须由新 projection 确认。

## 8 本地 UI 状态

允许保存：当前 route 过渡阶段、焦点索引、每个 route 的原触发节点、overlay 栈、pending requestId、retry 次数的显示计数、演出是否被用户跳过、当前 `returnOrigin` 展示锚点、当前 tab、reduced-motion 视觉偏好、mock 标识。

不允许保存或推断：匹配成功、床点亮、玩家坐标、战斗开始、结果、奖励入账、存档可继续、路由权限和任何规则事实。刷新或 revision 变化时丢弃过期本地选择并重读 projection。

## 9 视觉令牌

- 冷启动/错误安全回退用黑幕收束；普通加载使用暗调全息轮廓，不做白底网页 spinner。
- 标题是安静的启动画面；`新游戏`/`继续` 为主操作，`选项` 为全局设置入口，`退出` 为安全离开意图。
- 驻地保持正面俯视实体与低饱和全息背景；床A蓝、床B珊瑚、床C青、锚定导流仪蓝/科技语义，disabled 使用灰色扁平无高光并显示文字原因。
- 进行中为橙色，成功/可继续为绿色，错误为红色，过期/延迟为灰色或灰白，梦境边界为短暂纯白/奶白，奖励只用少量金银高光。
- route 状态同时以标题、文本、图标、材质和 live region 表达；不得只靠颜色、白屏或动画速度区分成功和错误。

## 10 动效绑定

- route 进入/退出使用 `AnimatePresence mode="wait"` 和声明式 `layout`，保持页面方向连续；不要让 CSS transition 伪装核心路由。
- 冷启动→加载使用黑幕/轮廓显影；标题→驻地使用短淡入；匹配完成只让床A亮起并在原驻地叠加影子。
- `enter-dream` 和 `return-home` 使用独立的多阶段 `WhiteManifestationTransition`：床固定不消失、人物/颜色按曲线完成纯白显形；可跳过时直接收敛到权威最终 projection。
- 所有动画失败、素材缺失、超时或 reduced-motion 都必须有最终文本和状态结果；动画不阻塞端口结果，不修改 route。
- reduced-motion 下移除跳跃、粒子、拖尾和强闪，保留焦点、文本、颜色/不透明度结果和可跳过按钮。

## 11 输入无障碍

- 每个 route 有 landmark、标题、描述和当前状态；`RouteStatusRegion` 使用 polite/assertive 分级播报加载、拒绝、超时、成功和安全回退。
- 标题、驻地节点、床A、锚定导流仪、对局退出和 overlay 触发器均可 Tab 到达；床B 不进可操作 Tab 顺序但以 `aria-disabled` 和原因被读出。
- 键盘、鼠标、触控和手柄调用同一 intent builder；Enter/Space 激活，Esc 关闭当前局部面板或取消，不隐式提交危险意图。
- route/overlay 变化时焦点先进入新 surface 的标题或首个可用动作；关闭、拒绝和安全返回后焦点回原触发器或安全锚点。
- 纯白演出有可读“跳过演出”按钮，不能劫持焦点；对屏幕阅读器宣布“正在进入梦境/返回驻地”。
- 文字放大、窄视口和 reduced-motion 不得隐藏必要操作；所有 disabled、空、错和超时状态都说明下一步。

## 12 加载错误超时

- `loading` 显示加载标题、来源、进度/阶段和可读 skeleton；投影未知时不渲染伪造的可继续状态。
- route 投影错误显示原因摘要、重试、取消和安全返回；`rejected`、`stale`、`timeout` 分别呈现，不合并为“失败”。
- 匹配超时保留驻地和漫游入口，提供重试/取消；影子中继 stale 不把空列表说成没有玩家。
- 对局介绍/装载失败显示 `load-failed`，保留 `returnOrigin` 和重试/返回驻地；不默认进入 HUD。
- 结算/奖励投影缺失可重试或安全回 `return-home`；不重复提交 reward intent，不在本地发放奖励。
- 纯白演出超时时跳到端口已确认的终态；若终态未知，显示错误 overlay 并提供安全返回，不把动画结束当作状态确认。

## 13 明确不做

- 不实现真实 router 之外的业务导航、匹配、装载、结算、奖励、存档或玩家移动。
- 不在 route state machine 中计算“下一节点”、补写 projection 或从本地 pending 推断 accepted。
- 不创建独立大厅、不绕过锚定导流仪、不启用床B/床C正式入局、不把返回点重置为默认点。
- 不将 overlay 当作 route，不用多个页面各自维护 pause/settings/error 状态。
- 不用单帧白屏、普通网页 loading、颜色 alone 或不可访问动画替代状态反馈。

## 14 依赖交接

- B1 提供 `JourneyShell` 挂载点、页面切换 host、全局 token 和退出宿主；本 Prompt 不修改 B1。
- B2 提供 `BattleHudSurface` 的稳定 props/projection 入口和 result-ready 事件投影；B6 只接 route/overlay，不改 HUD 规则。
- B3 提供 residence、anchor、bed、shadow、enter/return transition 的页面表面和 intent 契约；B6 只编排，不重复实现内部实体。
- B5 提供 narrative、notification 的 overlay 表面和读写隔离；B6 负责统一 overlay host/priority。
- 端口实现方提供 `UiPorts.state.getSnapshot()`、`action.submit()`、`cadence.subscribe()` 及 revision/结果语义；mock adapter 必须保持同一接口。
- 若组件名、route id 或 intent 需要变更，先登记交接项；不跨目录修改现有交付物。

## 15 验收条件

- [ ] 冷启动、加载、标题、新游戏/继续、驻地、锚定导流仪、匹配、漫游、影子大厅、床前就绪、对局介绍、纯白入梦、HUD、结算、奖励、纯白返回和原位置驻地均有 route 节点。
- [ ] 每个节点具备空/错/超时/重试/取消/安全返回或明确继承的统一 fallback，且不伪造下一状态。
- [ ] 只有床A可进入正式入局；床B disabled，床C自测-only；匹配中不锁驻地、不加载独立大厅。
- [ ] `returnOrigin` 被保留并用于返回；原位置不可用时有可访问安全回退。
- [ ] route intent 全部经 `ActionPort`，UI 不写业务状态；mock/projection 切换不改组件树。
- [ ] route 过渡可跳过、可 reduced-motion，纯白演出失败仍有文字和确定性终态。
- [ ] 本 Prompt 不越权修改任何其他目录或模块。

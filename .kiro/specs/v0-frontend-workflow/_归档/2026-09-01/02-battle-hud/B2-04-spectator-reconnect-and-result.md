# B2-04 Spectator, Reconnect, and Result

## 1. 页面定位

本 brief 定义对局 HUD 在玩家淘汰、观战、连接异常、重连、匹配/对局等待和对局结果阶段的表现层。它复用 `hud-main` 的世界、轮次、状态和事件层，不创建第二套规则事实、第二套视野过滤或独立大厅；它只展示宿主提供的只读 projection，并提交离开、重连、观战关注和继续返回等 intent。

观战者是全信息状态下的场上只读视角：可以自由移动镜头、切换关注对象、查看公开状态/装备/动作结果，但不提交任何对局动作。淘汰是权威结果，不由本地动画或 HP 推断。结果页覆盖胜利、失败、平局、超时、奖励和安全返回，奖励只读呈现，不在 UI 发放。

## 2. 权威来源

- `presentation-ui-authority` / `docs/表现系统/01_图形化与UI.md`：D-034 观战、公开信息、只读控件、观战自由视角和素材/可访问边界。
- `journey-current-ruling` / `docs/工程治理/11_游戏整体交互流程设计.md`：对局退出、结算、奖励、纯白返回和原位置。
- `frontend-port-contract` / `00-global/G-03-ui-port-contract.md`：StatePort/ActionPort、requestId、accepted/rejected/stale/timeout。
- `frontend-motion-fallback` / `00-global/G-05-motion-audio-fallback.md`：连接、结果、跳过和安全降级。
- `frontend-accessibility` / `00-global/G-04-interaction-accessibility.md`：只读语义、焦点、输入等价和 live region。
- `frontend-visual-tokens` / `00-global/G-02-visual-token-contract.md`：连接/结果/奖励语义色和素材 fallback。
- `hud-legacy-baseline` / `prompts/02-battle-hud.md`：退出、变体、占位结果边界，已按当前状态扩展吸收。
- `hud-visual-quality-addendum` / `prompts/02-battle-hud-visual-quality-addendum.md`：不弹网页式结果卡墙、仪式层与世界附着，已按当前状态扩展吸收。

## 3. 当前决策

- `elimination-state` 必须由 projection 明确提供；淘汰后当前玩家动作卡、投点、结束回合等提交控件禁用并说明「已淘汰」，不可通过本地状态继续行动。
- 若宿主允许观战，淘汰态可转入 `battle-spectator` / `spectating`：复用世界、轮次栏、公开状态与结果演出，新增自由镜头和 `spectator-readonly-badge`。观战者看到全信息公开 projection，不建立第二套信息过滤。
- 观战者可自由移动镜头、切换关注对象、查看所有参与者的公开状态、手部/身上装备和动作结果；隐藏动作仍按同一可见性规则处理。所有 action controls 都显示「观战只读」，没有投点确认、行动卡提交或目标提交。
- 连接状态区分 `matching`、`match-timeout`、`loading-match`、`connected`、`disconnected`、`reconnecting`、`reconnected`、`reconnect-failed`、`stale`。匹配/连接成功必须来自 projection/port，不由本地倒计时宣称。
- 断线时保留最后确认世界与 HUD，显示连接中断原因和重连状态；不把空快照当作无人/淘汰/比赛结束。重连成功后按 revision 重同步，清除过期局部选择。
- 结果 projection 明确 `victory | defeat | draw | timeout`；结果层显示 outcome、公开统计、奖励明细、继续/返回 intent。胜负/平局/超时不是 UI 判定。奖励可包含记忆碎片/点数、美元、生存货币、素材/梦境碎片等宿主显式标签，UI 不发放、转换或计算奖励。
- 「继续」提交 `continue-result`，只有宿主确认后才进入纯白 `safe-return`/`return-home`；安全返回可跳过演出但不能跳过返回事实，`returnOrigin` 由宿主提供，UI 不瞬移。
- 结果/连接层保持世界先于覆盖层：低频仪式可暂时越过普通 HUD，结束后回到世界；不使用独立网页 modal 堆叠替代空间演出。

## 4. 状态机

```text
in-match
  -> elimination-confirmed
  -> spectator-offer
  -> spectating

spectating
  -> focus-change
  -> readonly-detail
  -> connection-lost
  -> result

matching
  -> match-found
  -> match-timeout
  -> match-error

in-match | spectating
  -> disconnected
  -> reconnecting
  -> reconnected
  -> resyncing
  -> in-match | spectating | stale-recoverable | reconnect-failed

result-pending
  -> result-ready
  -> result-error
result-ready
  -> continue-pending
  -> safe-return-playing
  -> residence-returned

result-ready -> exit-pending -> safe-return-playing
match-timeout | reconnect-failed | result-error -> retry | cancel | safe-return
```

每个 intent 经过 `pending → accepted | rejected | stale | timeout`；连接成功、淘汰、结果和返回只在 projection 确认后改变页面事实。局部 `focus-change`、镜头、详情和动画阶段可独立变化，但不能覆盖宿主状态。

## 5. 组件树

```text
BattleLifecycleSurface
├─ ReusedBattleWorldLayer
│  ├─ HolographicEnvironmentLayer
│  ├─ PixelEntityLayer
│  ├─ EventStageLayer
│  └─ CameraFocusLayer
├─ ReusedBattleHudLayer
│  ├─ FixedTurnSpineReadonly
│  ├─ FixedTurnHeader
│  ├─ FixedStatusZone
│  └─ FixedLeaveEntry
├─ EliminationLayer
│  ├─ EliminationNotice
│  ├─ SpectatorOffer
│  └─ EliminatedControlsDisabled
├─ SpectatorLayer
│  ├─ SpectatorReadonlyBadge
│  ├─ FreeCameraController
│  ├─ FollowParticipantControl
│  ├─ PublicStateDetail
│  └─ ReadonlyIntentGuard
├─ ConnectionLayer
│  ├─ MatchStatusRibbon
│  ├─ ConnectionStatus
│  ├─ ReconnectIntentControls
│  └─ ResyncNotice
├─ ResultLayer
│  ├─ MatchResult
│  ├─ OutcomePresentation
│  ├─ PublicStatsSummary
│  ├─ RewardSummary
│  ├─ ContinueResultControl
│  └─ SafeReturnTransition
├─ IntentFeedbackLayer
└─ LifecycleLiveRegion
```

`ReadonlyIntentGuard` 是表现层禁用/说明层，不是后端权限系统；真正拒绝由 ActionPort/宿主完成。`SafeReturnTransition` 只播放宿主确认的返回结果，不创建第二套传送逻辑。

## 6. 只读数据

```ts
interface SpectatorReconnectResultProjectionMock {
  readonly source: 'mock' | 'projection';
  readonly revision: string;
  readonly pageId: 'hud-main' | 'battle-spectator' | 'battle-reconnect' | 'battle-result';
  readonly role: 'active-player' | 'eliminated' | 'spectator';
  readonly match: { readonly id: string; readonly state: 'matching' | 'found' | 'loading' | 'in-match' | 'result-ready' | 'timeout' | 'error' };
  readonly connection: { readonly state: 'connected' | 'disconnected' | 'reconnecting' | 'reconnected' | 'reconnect-failed' | 'stale'; readonly reason?: string; readonly retryable: boolean };
  readonly elimination?: { readonly confirmed: boolean; readonly label: string; readonly canSpectate: boolean };
  readonly spectator?: { readonly readonlyLabel: string; readonly focusedParticipantId?: string; readonly freeCamera: boolean; readonly publicParticipants: readonly string[] };
  readonly result?: {
    readonly outcome: 'victory' | 'defeat' | 'draw' | 'timeout';
    readonly title: string;
    readonly publicStats: readonly { readonly label: string; readonly valueText: string }[];
    readonly rewards: readonly { readonly category: 'memory' | 'survival' | 'dream-fragment' | 'other'; readonly label: string; readonly valueText: string; readonly assetRef?: string }[];
    readonly continueAvailable: boolean;
    readonly returnOrigin?: string;
  };
  readonly assets: readonly { readonly assetRef: string; readonly state: 'loading' | 'ready' | 'missing' }[];
}
```

`valueText` 是已格式化的宿主可见值，UI 不从其他字段做加总/转换。公开统计、奖励、淘汰原因、匹配状态和连接原因都必须来自 projection；缺失字段显示明确缺失态。

## 7. 动作意图

- `battle.enter-spectator`：淘汰后请求进入观战只读视角。
- `battle.exit-spectator`：离开观战，提交宿主允许的返回/退出意图。
- `battle.camera-focus-participant`：切换关注对象或自由镜头目标，不改变对局事实。
- `battle.inspect-public-state`：查看公开状态/装备/动作结果，不提交动作。
- `battle.retry-match`：匹配超时/失败后的重试请求，不本地伪造匹配。
- `battle.cancel-match`：取消匹配请求；页面回到宿主确认的安全态。
- `battle.reconnect`：提交重连请求；等待 `reconnected + resync`，不把发送请求当作成功。
- `battle.cancel-reconnect`：取消重连并请求安全返回（若宿主允许）。
- `battle.retry-result`：结果投影失败后的重读请求，不重复发放奖励。
- `battle.continue-result`：提交结算继续/返回驻地意图。
- `presentation.skip`：跳过结果/返回演出，落到相同的已确认终态。

所有路径共享同一 ActionPort。观战控件只允许 `camera-focus`、`inspect-public-state`、退出/连接/结果类 intent；任何动作卡、投点滑块、目标选择、结束回合 intent 都不可构造。

## 8. 本地 UI 状态

允许：当前页面 surface、观战镜头位置/缩放、关注对象、公开详情展开、结果 tab/滚动位置、连接提示折叠、重连按钮焦点、pending requestId、动画阶段、skip requested、reduced-motion、素材加载态和本地网络提示。

禁止：本地设置 `eliminated`、`spectator`、`connected`、`matchFound`、`result`、`victory`、`rewardGranted`；禁止从 HP=0、倒计时结束、网络断开或动画完成推断这些事实。revision 变化后清理焦点/镜头目标中已不存在的对象。

## 9. 视觉令牌

- 淘汰：红色/灰白语义边缘 + 明确文字，控件扁平无高光；不使用大叉、羞辱式标记或遮挡世界的网页横幅。
- 观战：灰白/蓝色只读材质，`spectator-readonly-badge` 使用眼睛/镜头/锁定图标和文字「观战只读」，不要只变灰；自由镜头以低显著性白光/蓝光表示。
- 连接：橙=连接中/进行中，黄=需要注意/延迟，红=断开/错误，绿=已连接/重连确认，灰=不可用/超时。每种状态都有文本与图标。
- 结果：胜利/完成使用绿与少量金高光，失败/危险使用红，平局使用灰白/蓝的中性材质，超时使用黄/橙的时间语义；不把奖励颜色当作规则等级。
- 奖励行使用类别 token 与合法 `assetRef`，显示名称、数值文本和来源；缺失素材保留奖励槽位和语义图标。
- 结果与连接层是 HUD 的附着仪式/错误层，允许局部半透明遮罩但必须透出世界；纯白仅用于宿主确认的 `safe-return` 传送演出。

## 10. 动效绑定

- 淘汰确认使用局部轮廓收束/降饱和，保留最后确认世界；转入观战使用 `layoutId` 将 HUD 只读状态和镜头控制接入同一场景，不重载第二个大厅。
- 自由镜头/关注对象使用 spring 与局部空间平移；公开详情沿实体锚点展开，关闭后回收焦点，不把详情做成全屏 dashboard。
- 连接状态按 `disconnected → reconnecting → reconnected → resyncing` 顺序显示，使用 `AnimatePresence`/局部状态条；重连失败使用回弹/错误停留，不播放成功闪光。
- 结果从事件舞台向局部结果层生长：outcome 标题、公开统计、奖励行依次落地；奖励只在结果 projection ready 后出现。`continue-result` accepted 后才播放纯白 safe-return，动画可跳过。
- `prefers-reduced-motion` 下保留淘汰、只读、连接、结果、奖励和返回文字/顺序，缩短镜头移动、粒子与纯白闪烁；不以静止屏替代结果语义。

## 11. 输入无障碍

- 淘汰/观战状态进入明确的 landmark 和 live region：读出「已淘汰」「观战只读」「可关注对象」「动作控件已禁用」以及原因。
- 观战焦点顺序：只读说明 → 镜头/关注对象 → 公开参与者 → 公开详情 → 连接/退出；动作卡和投点控件不进入可操作 Tab 顺序，或以 `aria-disabled` 读出「观战只读」。
- 摄像机支持鼠标拖拽/滚轮、键盘方向键、手柄摇杆等价；必须有 focus participant 列表作为无指针替代。Esc 关闭详情/退出局部观战 surface。
- 重连和结果按钮支持 Tab/Enter/Space/手柄 confirm；live region 宣布连接状态、revision 重同步、结果 outcome、奖励 ready、重试/拒绝原因。
- outcome、奖励、错误和连接状态不能只靠颜色；所有值提供文字。结果焦点进入标题或状态区，返回后焦点由宿主交接到 `returnOrigin` 对应入口。

## 12. 加载错误超时

- 匹配等待显示匹配状态、可继续/取消的 intent；超过宿主阈值显示「匹配超时（mock）」和重试/取消，不把本地计时结束当匹配失败事实。
- 对局装载失败显示失败原因、重试装载和安全返回；不显示已进入对局、不发放奖励。资产缺失保留实体/奖励位和 `assetRef` 诊断。
- 断线显示最后确认 snapshot、连接中断原因和重连入口；重连期间不显示空场或猜测胜负。超时显示重试/取消/安全返回，避免无限 spinner。
- 重连成功后必须经过 revision resync；若版本过期显示 stale 并丢弃本地选择。重连失败保留安全返回，不把“请求发送”显示为连接成功。
- 结果 projection timeout/error 显示结果暂不可用和重试/安全返回；奖励只有 `result-ready` 才可见，防止本地重复发放或伪造。
- 断线/观战中继异常不把空影子/空参与者列表解释成无人；保留“暂不可见”语义。

## 13. 明确不做

- 不实现淘汰、观战权限、视野过滤、断线检测、重连协议、匹配算法、超时判定、胜负/平局判定或奖励发放。
- 不创建独立观战规则/信息过滤通道，不为观战恢复动作卡、投点、目标、NPC 或 OpRegistry；观战永远只提交自由视角、公开查看、连接和返回 intent。
- 不把结果做成浏览器页面、统计 dashboard、无限奖励卡墙或强制全屏黑幕；不把纯白 safe-return 用于普通 loading/error。
- 不以 HP=0、倒计时、动画结束、网络异常或空列表本地推断事实；不修改 returnOrigin、不瞬移、不跳过宿主确认。
- 不删除登记素材、奖励槽位或世界承载层；不手工造贴图，不引入新渲染引擎。

## 14. 依赖交接

- 依赖 B2-01 的世界/HUD 基础层、固定退出入口和安全区；依赖 B2-03 的阶段/结果舞台与事件跳过语义；依赖 B2-02 的动作控件禁用边界。
- 依赖 B1 的 AppShell/设置/路由挂载，依赖 B3 的 `returnOrigin`、入梦/返回过渡与驻地接收端口，依赖 B6 的全旅程覆盖层仲裁。
- 需要运营/匹配/结算侧提供稳定只读 projection 和 intent port：匹配状态、连接 revision、淘汰确认、公开参与者、outcome、奖励、返回确认。B2 不依赖对方内部类名或规则路径。
- 素材和奖励图标通过 manifest/assetRef 接入；本 brief 只消费加载状态和 fallback，不修改素材目录。

## 15. 验收条件

- [ ] 淘汰只在 projection 确认后出现；动作/投点/目标控件禁用并说明原因；可按宿主确认进入只读观战。
- [ ] 观战复用在局世界/HUD，可自由移动镜头、切换关注对象、查看公开状态/装备/结果；所有提交动作明确「观战只读」。
- [ ] matching、timeout、disconnected、reconnecting、reconnected、resync、stale、reconnect-failed 均有可读状态，不伪造成功或无人。
- [ ] 结果可演示 victory、defeat、draw、timeout 四类；公开统计、奖励、继续和 safe-return 都有确定呈现，奖励不在本地发放。
- [ ] 继续只提交 intent，宿主确认后才播放纯白返回；动画可跳过且不改变返回事实，returnOrigin 不被本地改写。
- [ ] 键盘/手柄/读屏/reduced-motion、焦点归还、live region、颜色外语义通道和素材 fallback 完整。
- [ ] 不创建第二套规则、观战权限或信息过滤实现，不调用 OpRegistry，不以本地状态推断淘汰/结果/奖励。

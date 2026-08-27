# B4-05 连接错误、重连与匹配超时覆盖层 Brief

## 1 页面定位

- 本 brief 定义 `ConnectionErrorRetryOverlay`：连接中断、重连中、重连成功、重连失败、匹配超时、取消和安全返回的统一反馈覆盖层。
- 本 brief 逐条遵守 G-01..G-08 的 UI-only、intent-only、素材允许、不用零素材口径、同屏不超过 5、不得写库或实现规则约束。
- 它覆盖在当前世界、暂停、工具面板或驻地匹配状态之上，解释连接/会话投影和允许动作；不创建独立大厅、不实现真实网络协议、不拥有重连状态。
- 覆盖层必须同时满足：可读错误原因、明确下一步、可重试、可取消、可安全返回、焦点可恢复、输入可仲裁。错误不得绕过床门控、暂停确认或其他页面契约。

## 2 权威来源

- attachmentId: `frontend-global-g01`
  provenance: `G-01-project-and-scope-contract.md；加载/错误/安全返回、UI-only`
- attachmentId: `frontend-global-g03`
  provenance: `G-03-ui-port-contract.md；端口未连接、请求 timeout、rejected/stale/resync`
- attachmentId: `frontend-global-g04`
  provenance: `G-04-interaction-accessibility.md；错误焦点、live region、键盘/手柄等价`
- attachmentId: `frontend-global-g05`
  provenance: `G-05-motion-audio-fallback.md；黑幕收束、重试、资源和 reduced-motion 降级`
- attachmentId: `frontend-global-g08`
  provenance: `G-08-page-and-batch-index.md；reconnect、match timeout、retry/cancel/safe-return`
- attachmentId: `frontend-residence-empty-error`
  provenance: `B3-04-residence-empty-error-states.md；匹配失败/超时、relay stale/unavailable、原位置安全恢复`
- attachmentId: `frontend-residence-flow`
  provenance: `B3-00/B3-02；匹配期间继续活动、影子大厅、不重载场景`
- attachmentId: `frontend-motion-checklist`
  provenance: `presentation-motion-checklist-12；断线黑幕、重连加载、错误文字`

## 3 当前决策

- 统一覆盖层至少覆盖 `connection-lost`、`reconnecting`、`reconnected`、`reconnect-failed`、`match-timeout`、`cancel-pending`、`safe-return`；状态名和原因由投影提供。
- 连接中断使用克制的黑幕收束/降饱和覆盖，中心显示「连接中断」和正在重连说明；不显示纯 spinner 而没有文字。
- 重连中允许重试/取消或安全返回（以 `allowedIntents` 为准）；重连成功只在投影确认后收束覆盖，不能以本地计时假定成功。
- 匹配超时显示「匹配超时（mock）」、原因、重试、取消和安全返回；不把超时自动转成匹配成功、换床或 shadow ready。
- 断线期间根据宿主投影决定低层输入：阻塞错误层打开时，只允许错误层控件；如果明确是非阻塞 stale，允许玩家回到当前可恢复工具/驻地输入。
- 所有结果都保留最近稳定的页面/焦点/return origin；安全返回回到宿主提供的稳定页面，不由 UI 猜默认点。

## 4 状态机

```text
stable-page
  └─ connection-lost → connection-error-overlay
connection-error-overlay
  ├─ reconnecting → reconnecting
  │   ├─ reconnected → connection-recovered → dismiss → stable-page
  │   ├─ failed → reconnect-failed
  │   ├─ timeout → reconnect-failed
  │   └─ cancel → safe-return
  ├─ retry → retry-pending → reconnecting
  ├─ cancel → cancel-pending → safe-return
  └─ safe-return → returning → stable-safe-page
match-pending
  └─ match-timeout → timeout-overlay
 timeout-overlay
  ├─ retry-match → retry-pending → match-pending
  ├─ cancel-match → cancel-pending → residence-ready
  └─ safe-return → returning → residence-original-position
any-error
  ├─ projection-error → error-recoverable
  ├─ stale → resyncing
  └─ intent-timeout → retry-or-safe-return
```

- `reconnected`、`residence-ready`、`residence-original-position` 和 stable page 都必须由权威 projection/result 确认。
- `retry-pending` 仅表示 intent 已提交；不显示成功、不清除错误层直到 accepted 或新的 projection 到达。
- 若返回 origin 缺失，进入 `safe-return` 错误分支，显示原因和可用安全页面，不静默跳默认位置。

## 5 组件树

```text
OverlayStackCoordinator
└─ ConnectionErrorRetryOverlay
   ├─ ConnectionStatusIcon
   ├─ ErrorTitleAndReason
   ├─ ReconnectProgressRegion
   ├─ RetryConnectionButton
   ├─ RetryMatchButton
   ├─ CancelConnectionButton
   ├─ SafeReturnButton
   ├─ MatchTimeoutDetails
   ├─ ReturnOriginStatus
   └─ ConnectionLiveRegion
```

## 6 只读数据

```ts
interface ConnectionProjection {
  readonly source: 'mock' | 'projection';
  readonly revision: number;
  readonly surface: 'connection-lost' | 'reconnecting' | 'reconnected' | 'reconnect-failed' | 'match-timeout' | 'safe-return';
  readonly reason?: string;
  readonly allowedIntents: readonly string[];
  readonly retryable: boolean;
  readonly match?: { readonly state: 'pending' | 'timeout' | 'cancelled'; readonly targetBed: 'bed-a' | null };
  readonly returnOrigin: { readonly state: 'known' | 'missing'; readonly pageId?: string; readonly positionId?: string };
  readonly mock: true;
}
interface ConnectionIntentResult {
  readonly requestId: string;
  readonly status: 'accepted' | 'rejected' | 'stale' | 'timeout';
  readonly reason?: string;
  readonly nextRevision?: number;
}
```

- 连接、匹配、return origin、retryable 和 allowed intents 全部是只读投影字段；UI 不从错误文案猜测权限或可重试性。
- 投影/fixture 标记 `source: "mock"` 和 `mock: true`。

## 7 动作意图

```ts
type ConnectionUiIntent =
  | { readonly kind: 'connection.retry'; readonly requestId: string }
  | { readonly kind: 'connection.cancel'; readonly requestId: string }
  | { readonly kind: 'connection.dismiss-recovered' }
  | { readonly kind: 'match.retry'; readonly requestId: string }
  | { readonly kind: 'match.cancel'; readonly requestId: string }
  | { readonly kind: 'connection.safe-return'; readonly requestId: string }
  | { readonly kind: 'connection.retry-asset'; readonly assetRef: string }
  | { readonly kind: 'connection.close-details' };
```

- 重连/匹配重试、取消、安全返回和资产重试只提交 intent；不在点击处理器中直接操作网络、场景、床目标或位置。
- `connection.dismiss-recovered` 只关闭已确认恢复的表现层；不代表连接恢复业务动作。

## 8 本地 UI 状态

- 允许：错误覆盖层开关、当前错误详情展开、`pendingRequestId`、重试按钮焦点、局部重连 spinner 动画阶段、黑幕进出阶段、live region 节流、reduced-motion。
- 允许保存最近稳定的 `surfaceId` 与触发焦点引用用于恢复，但不把它当成真实路由/位置事实。
- 不允许本地计数重连成功、计算退避/重试次数、清除投影错误、伪造床 ready、伪造 match complete。
- 新 revision 到达时丢弃过期本地 error 快照，按 projection 重新渲染。

## 9 视觉令牌

- 连接中断/严重错误使用黑幕收束 + 暗红/红色边缘诊断；重连中使用灰白/橙色进行中；成功恢复使用绿色确认；stale 使用灰白/黄说明。
- 匹配超时使用橙/黄/红的严重度组合，但必须有「匹配超时」「重试」「取消」文字与图标；不只显示红色。
- 保留底层世界/驻地/合法素材的辨识度，错误层使用半透明覆盖而不是全白技术页；允许错误图标、连接纹理、影子/床素材挂接。
- loading spinner 只能是辅助反馈，旁边必须有标题、状态文本和下一步；不得用零素材方块或 broken image。

## 10 动效绑定

- 连接中断用黑幕从边缘收束，保留世界轮廓和错误文本；重连中使用有限的旋转/呼吸进度；不无限闪烁、不阻塞可读内容。
- 重连成功只有收到 accepted/projection update 后播放余辉退场并回到原 surface；失败/timeout 使用震动回弹和错误显影。
- 匹配超时使用队列/状态条回收，重试后显示 pending；取消/安全返回回到投影提供的稳定页面，不瞬移。
- reduced-motion 下移除黑幕位移、粒子和屏幕抖动，保留文字、状态色、焦点和最终落点。

## 11 输入无障碍

- 阻塞错误层打开后焦点进入标题/首个操作，Tab 只循环错误层；Enter/Space 触发当前按钮，Esc 取消/关闭仅在 projection 允许时执行。
- 重试、取消、安全返回都有可读名称、当前状态、disabled 原因和键盘/手柄等价；倒计时不作为唯一操作窗口。
- live region 宣布连接中断、重连中、重连成功/失败、匹配超时、取消中和安全返回结果；读屏不依赖 spinner/音效。
- 关闭/恢复后焦点回到触发的页面控件或宿主提供的安全入口；不可用原位置时，焦点落到安全返回说明首个动作。
- 字幕/视觉替代和错误文本支持高对比、reduced-motion、低闪烁和无音频操作。

## 12 加载错误超时

- 连接投影加载中显示「连接状态加载中（mock）」；不把空白画面或静默 spinner 当作反馈。
- 重连超过宿主提供的阈值时显示 timeout/stale 和重试、取消、安全返回；不在 UI 中硬编码真实退避策略。
- intent rejected/timeout/resync 分开呈现；重试只重发允许 intent，版本过期时重新读取 projection revision。
- 匹配 timeout 不点亮床、不显示影子 ready、不切换到独立大厅；失败原因、targetBed 和 return origin 以投影为准。
- 资产错误显示具体 `assetRef`/实体语义与正确的 fallback；不得静默借用错误语义资产。
- return origin missing 显示「返回位置暂不可确认（mock）」并提供安全回驻地/关闭详情；不静默落默认点。

## 13 明确不做

- 不实现真实网络请求、心跳、重连协议、退避策略、服务器队列、匹配算法、会话认证或数据恢复。
- 不把断线、匹配超时、取消或重试写成规则动作，不修改床目标、玩家位置、存档、物品或通知账本。
- 不创建独立大厅、全屏网页错误页、第二套路由、普通 loading 页面或无上下文技术日志。
- 不绕过 pause confirm、床A门控、B3 shadow 规则或 safe-return；不伪造成功投影。
- 不实现编辑器/研究台/素材库/电脑内部 UI、地图/拓扑/寻路/ORCA/路径成本/玩法规则。

## 14 依赖交接

- 依赖 G-03 的 ActionPort/StatePort result、G-04 的焦点/live region、G-05 的 motion/audio fallback 和 G-08 的页面失败路径。
- 依赖 B3 提供 match timeout/failed、shadow stale/unavailable、targetBed 和 returnOrigin projection；B4-05 不复制 B3 业务状态机。
- 依赖 B4-01 的暂停层 z-index/输入仲裁、B4-03 的 utility-match intent、B4-04 的通知/字幕视觉替代。
- 向 B6 交接稳定的 `connection.*`/`match.*` intents、safe-return 结果、焦点恢复和覆盖层关闭协议。

## 15 验收条件

- [ ] 可演示连接中断、重连中、重连成功、重连失败、匹配超时、取消、重试和安全返回，每个状态有原因与下一步。
- [ ] 重连成功/匹配 ready/安全页面均由 projection/result 确认；没有本地 spinner/计时伪造成功。
- [ ] 匹配超时不点亮床、不伪造影子、不重载场景；return origin 缺失不静默落默认位置。
- [ ] 阻塞错误层的 z-index 和输入仲裁正确；键盘、手柄、读屏、live region、焦点归还、reduced-motion 可验证。
- [ ] 错误素材/音频缺失有语义 fallback；底层合法素材可见；不以零素材或技术日志页替代体验。
- [ ] 相关 TypeScript、Vitest、lint 和文档术语门禁按仓库要求可运行。
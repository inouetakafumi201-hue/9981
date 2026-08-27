# B3-04 Residence Empty and Error States Brief

## 1 页面定位

- 本 brief 定义 `residence-main` 与入局链的空状态、失败状态、超时状态、资产错误和恢复动作。
- 空状态和错误状态必须仍然像出租屋与仪式流程，而不是网页错误页、全屏技术日志或无上下文 toast 堆叠。
- 每个状态说明当前空间、可见实体、原因、可执行 intent 和返回路径；错误只改变 UI 呈现，不伪造运营/匹配/装载/结算事实。
- MVP 门控保持不变：床A竞技可入；床B后置不可点；床C仅自测不可入局。错误处理不得成为绕过门控的后门。

## 2 权威来源（只写 attachmentId/provenance）

- attachmentId: `ops-residence-flow-03`
  provenance: `residence-mvp-boundary-shadow-lobby-load-return-and-port-only-entities`
- attachmentId: `ops-outside-growth-01`
  provenance: `async-match-cancel-timeout-and-operation-boundary`
- attachmentId: `presentation-animation-feedback-02`
  provenance: `resource-missing-deterministic-fallback-authority-state-preservation`
- attachmentId: `presentation-implementation-09`
  provenance: `residence-asset-mounting-error-layer-and-reduced-motion-fallback`
- attachmentId: `user-residence-mvp-gate-20260820`
  provenance: `bed-a-only-bed-b-deferred-bed-c-self-test-load-failure-original-position`

## 3 当前决策

- 空状态必须标注 mock 来源：首次进入出租屋、没有活动匹配、影子中继暂无参与者、床C没有可自测梦、端口尚无内容都使用可理解的空状态。
- 空状态不隐藏承载物素材：房间底板、床、锚定导流仪和其他实体保持在场；空的是内容投影，不是整个空间。
- 错误状态至少覆盖：匹配失败、匹配超时、影子中继 stale/unavailable、床A装载失败、资产缺失、玩法包无效、返回原位置缺失、端口不可用和 reduced-motion/低性能降级。
- 错误必须给出可恢复动作：重试、取消、关闭详情、返回驻地或回到原位置；动作名称明确，不自动重试造成循环或伪造成功。
- 床B始终以后置不可点呈现，不能因为床A失败或没有匹配结果而变成替代入口；床C失败只影响自测，不影响正式竞技入口。
- 允许素材并要求素材挂载错误可诊断：提示中可以显示实体名称和 assetId，代码降级保留实体语义和可读轮廓，不把零素材当作完成状态。

## 4 状态机

```text
residence-empty
  -> residence-ready
  -> residence-empty-match

residence-empty-match -> matching
residence-ready -> port-empty | self-test-empty
matching -> match-timeout | match-failed | match-complete
match-complete -> shadow-empty | shadow-visible
shadow-visible -> shadow-stale | shadow-unavailable

bed-a-front-ready -> load-failed
load-failed -> load-retry -> loading
load-failed -> return-residence
asset-error -> semantic-fallback | retry-asset | close-error
return-home -> origin-missing -> recoverable-return-point
any-error -> dismissed -> prior-stable-state
```

- `residence-empty`、`residence-empty-match` 和 `shadow-empty` 不代表错误；它们必须有正常空间氛围和下一步提示。
- `bed-b-deferred` 是独立终态，不因任何空/错状态变为可用。
- `bed-c-self-test-empty` 只能进入自测空状态或回驻地，不能进入 `loading`/`battle`。
- 错误关闭后回到最近稳定的权威投影态；不可用投影不能被本地默认值覆盖。

## 5 组件树

```text
ResidenceStateFeedbackRoot
├─ ResidenceSceneLayer
│  ├─ RoomBackdropAsset
│  ├─ BedACompetitiveNode
│  ├─ BedBDeferredNode
│  ├─ BedCSelfTestNode
│  └─ ResidenceEntityAssets
├─ EmptyStateLayer
│  ├─ EmptyStateMessage
│  ├─ NextIntentHint
│  └─ EmptyStateIllustrationAsset
├─ ErrorStateLayer
│  ├─ ErrorStatusBanner
│  ├─ ErrorReasonDetails
│  ├─ RetryIntentButton
│  ├─ CancelIntentButton
│  ├─ ReturnResidenceIntentButton
│  └─ AssetDiagnosticLabel
├─ MatchFailureLayer
│  ├─ MatchTimeoutState
│  └─ MatchUnavailableState
├─ ShadowRelayLayer
│  ├─ ShadowEmptyState
│  ├─ ShadowStaleState
│  └─ ShadowUnavailableState
├─ LoadFailureLayer
│  ├─ LoadFailedState
│  ├─ PlaypackInvalidState
│  └─ ReturnOriginMissingState
└─ AccessibilityFeedbackLayer
   ├─ ResidenceLiveRegion
   ├─ ReducedMotionNotice
   └─ FocusRecoveryBoundary
```

## 6 只读数据

```ts
interface ResidenceFeedbackProjectionMock {
  readonly scene: { readonly state: 'ready' | 'empty'; readonly assetId: 'asset:residence-room'; readonly mock: true };
  readonly match: { readonly state: 'none' | 'matching' | 'timeout' | 'failed' | 'complete'; readonly reason?: string; readonly mock: true };
  readonly shadow: { readonly state: 'empty' | 'visible' | 'stale' | 'unavailable'; readonly participantCount: number; readonly mock: true };
  readonly load: { readonly state: 'idle' | 'loading' | 'failed'; readonly reason?: 'asset-missing' | 'package-invalid' | 'session-timeout' | 'origin-missing'; readonly mock: true };
  readonly ports: ReadonlyArray<{ readonly id: string; readonly state: 'empty' | 'available' | 'unavailable'; readonly assetId: string; readonly mock: true }>;
  readonly beds: { readonly bedA: 'locked' | 'lit' | 'failed'; readonly bedB: 'deferred-disabled'; readonly bedC: 'self-test-only' | 'self-test-empty'; };
  readonly returnOrigin: { readonly state: 'known' | 'missing'; readonly positionId?: string; readonly mock: true };
}
```

Mock 样例：

```ts
const emptyResidenceMock = {
  scene: { state: 'empty', assetId: 'asset:residence-room', mock: true },
  match: { state: 'none', mock: true },
  shadow: { state: 'empty', participantCount: 0, mock: true },
  load: { state: 'idle', mock: true },
  ports: [{ id: 'bookshelf', state: 'empty', assetId: 'asset:bookshelf-map', mock: true }],
  beds: { bedA: 'locked', bedB: 'deferred-disabled', bedC: 'self-test-empty' },
  returnOrigin: { state: 'known', positionId: 'near-bed-a', mock: true },
} as const;
```

- 以上是只读 UI 投影 mock，不代表真实匹配、存档、装载或资产服务已接通。
- `participantCount: 0` 只有在 `shadow.state === 'empty'` 且 relay fresh 时才表示确认无参与者；stale/unavailable 必须显示不可确认。

## 7 动作意图

- `dismiss-empty-state`：关闭空状态说明，保留房间和实体。
- `open-anchor-panel`：从无匹配空状态进入竞技面板。
- `retry-match`：匹配失败/超时后再次提交竞技匹配意图。
- `cancel-match`：取消当前匹配或退出失败恢复态。
- `retry-shadow-relay`：重新请求影子中继投影。
- `retry-load`：装载失败后再次请求床A竞技装载。
- `return-residence`：退出错误流程并回到出租屋原位置。
- `retry-asset(assetId)`：重试指定素材加载。
- `use-semantic-fallback(assetId)`：接受保留实体语义的程序化/轮廓降级。
- `open-port-empty(portId)`：查看端口当前为空或尚未接通的说明。
- `close-error-details`：关闭错误详情并恢复上一个稳定焦点。

## 8 本地 UI 状态

- 空状态：`quiet-empty`、`message-visible`、`hint-focused`、`return`。
- 错误提示：`banner-visible`、`details-open`、`retry-focused`、`cancel-focused`、`dismissed`。
- 匹配错误：`timeout`、`failed`、`retry-pending`、`cancelled`；重试按钮只提交意图，不显示假成功。
- 影子 relay：`empty`、`stale`、`unavailable`；不同状态使用不同文字和图标，不用空列表混淆。
- 装载错误：`asset-missing`、`package-invalid`、`session-timeout`、`origin-missing`；床A显示失败但仍可选择重试/返回。
- 素材错误：`loading`、`loaded`、`failed`、`semantic-fallback`；降级仍保留实体轮廓、名称和职责。
- 床B为固定 `disabled/deferred`；床C为固定 `self-test-only` 或 `self-test-empty`，都不出现正式入局 action。

## 9 视觉令牌

- 空状态使用灰白、蓝和低饱和环境色，保持安静空间，不使用大红错误色制造普通空状态。
- 匹配超时/错误使用黄/橙/红按严重度区分；装载失败使用红色语义并保留蓝色床A实体识别。
- stale 使用灰白降饱和和断续轮廓，unavailable 使用灰色诊断标记；影子为空使用中性提示，不用错误红色。
- 资产错误使用红色诊断角标、assetId 文本和保留实体轮廓；程序化降级使用灰白/蓝色语义，禁止语义错配素材。
- 空/错层是半透明空间叠加，房间素材、床A/B/C、锚定导流仪和其他承载物仍可见；不做整页白卡或技术后台。
- 床B珊瑚色仅表达后置联机语义且降饱和；床C青色仅表达自测/创作来源，不表达正式可用。

## 10 动效绑定

- 空状态进入使用轻量 `AnimatePresence`，让提示从对应实体附近显现；关闭时回收，房间不重载。
- 错误 banner 使用短促显影、边缘语义光和可读状态，不使用持续抖动、无限闪烁或遮挡整个场景。
- 匹配超时/失败的重试反馈使用按钮确认和状态条回收；取消后回到 `residence-ready` 的稳定空间。
- shadow stale/unavailable 使用轮廓减弱和一段提示淡出；不把不存在的影子动画化成实体。
- 装载失败保持床A与原位置标记在场；选择返回时使用 `return-home` 或可恢复驻地落点，不直接切到无上下文错误页。
- 素材加载成功使用实体轮廓到正式帧的显影；加载失败进入语义轮廓降级。`reduced-motion` 下改为即时状态变化但保留焦点、文字和最终状态。

## 11 输入无障碍

- 空状态说明包含「当前没有匹配」「暂无影子参与者」「床C暂无自测梦」等文本、下一步和返回路径。
- 错误状态提供明确按钮顺序：重试、取消/关闭、返回驻地；Tab、Enter、Space、Esc 都有一致行为。
- live region 宣布超时、失败、影子不可确认、素材缺失、装载失败和恢复结果；不能只用颜色、粒子或音效。
- 错误详情为 `role=alertdialog` 或等价语义，焦点进入详情首个操作，关闭后回到触发点；非阻塞空状态不抢焦点。
- 床B disabled 需有 `aria-disabled` 和后置说明；床C自测说明需读出「不可入局」；不允许通过快捷键提交被禁用 intent。
- 支持高对比、reduced motion、低闪光、字幕/文字反馈和无音频操作；按钮五态全部可见。

## 12 加载错误超时

- 首次驻地空状态：保留可见房间素材，显示「暂无进行中的竞技匹配（mock）」和「前往锚定导流仪」；不显示加载失败。
- 匹配超时：显示「匹配超时（mock）」、重试和取消，并说明玩家仍可漫游；不自动更换目标床。
- 匹配失败：显示失败原因和重试/返回；没有完成投影就不点亮床A。
- 影子中继 stale：显示「影子状态暂不可确认（mock）」和刷新意图；不显示空大厅或伪造参与者。
- 影子中继 unavailable：显示「影子大厅暂不可用（mock）」；床A是否可继续以权威 `targetBed`/ready 投影为准，不由本地报错覆盖。
- 装载失败：显示失败类别（素材缺失、玩法包无效、会话超时）和重试/返回；不进入 HUD。
- 返回原位置缺失：显示「返回位置暂不可确认（mock）」并提供回驻地恢复动作；不可静默落到默认点。
- 端口为空或不可用：保留实体，显示「入口占位/暂无内容（mock）」；不展开内部页面。
- 素材失败：首先重试指定 `assetId`，其次使用语义正确的程序化轮廓/文字降级；不能用错误素材顶替。

## 13 明确不做

- 不把空状态做成空白白页、网页 404、后台诊断表或通用「Something went wrong」页面。
- 不把匹配失败自动改成床B或床C入口，不允许错误恢复绕过床A竞技门控。
- 不实现真实匹配重试策略、服务器协议、资产下载服务、玩法包编译或真实存档。
- 不把影子中继 stale/unavailable 表现为空的成功大厅，不本地伪造 ready participant。
- 不把素材错误静默吞掉，不用零素材方块、错误语义素材或不可追踪占位图宣称完成。
- 不让错误态写玩家位置、匹配状态、装载状态、结算结果或游戏规则。

## 14 依赖交接

- 从 B3-00 接收统一状态机、床A/B/C门控、mock 数据标注、素材允许原则和 return-home 约束。
- 从 B3-01 接收节点焦点、可访问输入、端口列表、`assetId` 和最近稳定焦点。
- 从 B3-02 接收匹配 timeout/failed、影子 relay stale/unavailable、targetBed 和 ready 投影。
- 从 B3-03 接收 load failure、asset missing、package invalid、origin missing、`retry-load` 和 `return-residence` 端口。
- 依赖全局 token、Radix 可访问原语、Framer Motion 动效、表现侧素材 manifest；本 brief 不修改其他目录的契约。

## 15 验收条件

- [ ] 首次驻地、无匹配、影子为空、床C无自测梦和端口暂无内容均有带上下文的空间空状态。
- [ ] 匹配超时/失败、影子 stale/unavailable、装载失败、资产缺失、玩法包无效、原位置缺失均可演示。
- [ ] 每个错误都有明确原因、可读反馈、重试/取消/返回路径，错误关闭后恢复正确焦点和稳定状态。
- [ ] 空/错状态保留出租屋、床A/B/C、锚定导流仪和其他合法素材的可见性；不以零素材完成验收。
- [ ] 床A只有权威完成投影才点亮；床B始终后置不可点；床C仅自测且不可入局。
- [ ] stale/unavailable 不伪装为空大厅，资产错误不静默换语义素材，装载错误不进入 HUD。
- [ ] 键盘、读屏、live region、焦点回收、非颜色信息、reduced-motion 和低闪光模式全部可验证。
- [ ] 相关 TypeScript、Vitest、lint 和项目文档术语门禁按仓库要求执行；本目录外无改动。

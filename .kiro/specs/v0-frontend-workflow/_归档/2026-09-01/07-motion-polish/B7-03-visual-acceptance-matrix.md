# B7-03 Visual Acceptance Matrix

## 1 页面定位

这是 B7 动效收束的黑盒视觉验收矩阵。验收对象是全旅程表现层：动效母题、声音通道、纯白入梦/返回、fallback、reduced motion、低性能档、空间连续性、输入无障碍、性能和错误卫生。矩阵只验证可见行为与稳定端口，不验证或推断规则内部实现。

## 2 权威来源

- `attachmentId: "presentation-motion-checklist-12"`
  `provenance: "docs/表现系统/12_动态图形化设计清单（V0迁移准备）.md；全流程动效、错误、空状态、reduced motion 与性能验收"`
- `attachmentId: "presentation-animation-feedback-02"`
  `provenance: "docs/表现系统/02_动画音效与反馈.md；表现/规则解耦、fallback、声音通道、60fps 和验收不变量"`
- `attachmentId: "frontend-journey-integration"`
  `provenance: "B6 全旅程路由、覆盖层层级、输入仲裁和抽取交接 Prompt；本矩阵只消费其稳定页面/状态/intent"`
- `attachmentId: "global-motion-audio-fallback"`
  `provenance: "prompts/00-global/G-05-motion-audio-fallback.md；9 个母题、state-transition/click-play、缺失与跳过契约"`

## 3 当前决策

- 验收必须是可重复的黑盒场景：给定 fixture/projection、触发同一 intent/event，比较标准档、reduced-motion、低性能档的结果、顺序、焦点和错误。
- 所有可见数值遵守项目 1–5 铁律；矩阵中的 fps、毫秒、视口尺寸、实体数和版本号是性能/技术指标例外，不是玩法数值。
- 9 个母题必须各有真实承载物，不得用同一个全局 fade 通过验收。动画只重演已确认结果，跳过/失败/资源缺失不得改变结果。
- `+3` 保留为 deferred、不可选；selection/trigger effects 必须存在并可验证，不能以“没有实现”漏过验收。
- 有任一 console error、未处理 asset/audio/decode/promise/hydration error、破图、空白死区、焦点丢失或规则被表现推进，即判失败。

## 4 状态机

```text
fixture-ready
  -> event-triggered
  -> playing
  -> completed | skipped | failed | timed-out
  -> settled
  -> assertion-recorded
```

- `fixture-ready` 确认页面、projection revision、Profile、资产/audio stub 和输入环境。
- `event-triggered` 标记 `state-transition` 或 `click-play`，不代表规则成功。
- `completed`、`skipped`、`failed`、`timed-out` 都必须进入同一 `settled` 结果快照；验收记录分别保留原因。
- 不允许通过重复点击、改变本地状态或重新加载页面伪造 accepted；需要宿主结果的场景必须使用已确认 projection。

## 5 组件树

```text
VisualAcceptanceHarness
├─ FixtureAndProjectionLoader
├─ JourneySurface
│  ├─ SceneLayer
│  ├─ EntityLayer
│  ├─ EventLayer
│  ├─ HudAndPanelLayer
│  └─ CeremonyAndErrorLayer
├─ InputDriver
│  ├─ PointerDriver
│  ├─ KeyboardDriver
│  ├─ GamepadEquivalentDriver
│  └─ ScreenReaderAssertions
├─ MotionProbe
│  ├─ RecipeProbe
│  ├─ AudioChannelProbe
│  ├─ FallbackProbe
│  └─ ProfileProbe
├─ PerformanceProbe
│  ├─ FrameBudgetProbe
│  ├─ LongTaskProbe
│  └─ VisibilityProbe
└─ ConsoleAssetErrorProbe
```

Harness 只观察 DOM/ARIA、可见图层、事件记录、音频/资源端口和性能指标；不得访问规则内部 store、后端路径或隐藏字段。

## 6 只读数据

```ts
interface AcceptanceFixture {
  readonly pageId: string;
  readonly state: string;
  readonly revision: string;
  readonly source: 'mock' | 'projection';
  readonly eventId: string;
  readonly semanticId: string;
  readonly trigger: 'state-transition' | 'click-play';
  readonly expectedResultLabel: string;
  readonly expectedOrigin?: string;
  readonly assetRefs: readonly string[];
  readonly audioRefs: readonly string[];
  readonly performanceProfile: 'standard' | 'reduced-motion' | 'low';
  readonly skipAllowed: boolean;
}
```

验收数据只声明预期可见结果、来源和稳定语义；不写伤害、成本、AI 决策、路径代价、匹配算法、真实服务器响应或存档。资源失败 fixture 必须显式声明 `assetRef`/`audioRef` 缺失及 fallback 预期。

## 7 动作意图

- 页面行为使用既有稳定 intent；验收驱动器通过指针、键盘、手柄等价输入触发同一 intent builder。
- `state-transition` 场景加载下一 revision/确认状态；`click-play` 场景触发演示或局部 UI feedback。两者必须分别记录在结果中。
- Skip 只发送 `presentation.skip`；mute/profile/haptic 只影响表现偏好；重试/取消/安全返回必须等待宿主结果。
- 任一点击不得直接调用规则写入函数，不得把 `playing`/音频开始/粒子开始当作成功。

## 8 本地 UI 状态

验收可观察：焦点、hover、active、selected、disabled、pending、animationPhase、Profile、muted、hapticEnabled、assetLoadState、audioLoadState、skipRequested、fallbackRecipeId、live-region 文本和焦点归还。

验收不可接受：本地结果覆盖 projection、动画时间推进回合、Profile 改变规则结果、资源缺失触发业务成功、错误自动重试造成重复 intent、Skip 改变结算/位置/奖励。

## 9 视觉令牌

- 环境层 → 实体与表现层 → 事件层 → HUD/面板层 → 仪式/错误层；普通 UI 不遮死世界。
- 语义色：红=失败/危险，蓝=清醒/科技，橙=进行中，绿=完成/安全，紫=约束/网关，珊瑚=近战，青=UGC/社交，灰=延迟/不可用，纯白/奶白=梦境边界，金/银=少量高光。
- 9 个母题验收以承载物为核心：白幕作用于阈值，黑幕作用于收束，余辉作用于褪色，轮廓作用于实体显影，高亮作用于当前对象，回弹作用于拒绝对象，重排作用于列表项，颗粒作用于离场对象。
- 灰度、无声音和无粒子情况下仍必须读出状态、错误、焦点和最终结果；颜色不可单独承载语义。

## 10 动效绑定

### 10.1 九母题验收矩阵

| ID | 母题 | 最小真实场景 | 观察点 | reduced/low 最小结果 |
|---|---|---|---|---|
| M1 | 慢白幕 `slow-white-curtain` | `enter-dream` 或加载完成 | 有阈值方向，床/锚点先可见，白幕后落到确认结果 | 保留阈值、顺序、文字和最终入口 |
| M2 | 闪白幕 `flash-white` | 命中确认/系统通过 | 一次短闪，局部结果清晰，不遮挡无关 HUD | 改局部边缘高亮/颜色，不闪屏 |
| M3 | 黑幕收束 `black-fold` | 断线/失败/安全退出 | 从边缘收束后出现原因和下一步 | 快速暗化或直接结果，不能留黑屏 |
| M4 | 余辉淡出 `afterglow-fade` | 战后/返回驻地/对话关闭 | 原色降饱和，非黑非白，焦点可归还 | 一次降饱和/透明度变化 |
| M5 | 轮廓显影 `contour-reveal` | 面板/角色/资产出现 | 轮廓/阴影先于实体细节，缺失资产有占位 | 轮廓与实体短步出现，保留标签 |
| M6 | 语义高亮 `semantic-highlight` | 当前对象、焦点、可交互床 | 对象边缘/材质变化明确，文字/图标同步 | 静态高亮、焦点环和文字 |
| M7 | 震动回弹 `shake-bounce` | 拒绝、无权限、无效落点 | 对象向错误方向轻弹后回原位，原因可读 | 取消位移但保留原因和焦点 |
| M8 | 列表重排 `list-reflow` | 轮次/通知/物品顺序更新 | item 保持身份连续，彼此让位，最终顺序正确 | 短位移或顺序渐变，不硬跳无说明 |
| M9 | 颗粒化消失 `grain-vanish` | 消耗/破损/离场/结算退场 | 粒子只作用于离场对象，结果文字仍在 | 轮廓/透明度收束或图标/文字替代 |

### 10.2 纯白与通道矩阵

| 场景 | 标准档 | reduced motion | low | 必须相同的验收事实 |
|---|---|---|---|---|
| `enter-dream` | 慢白幕吞没→纯白→梦境显影 | 短阈值→目标显影 | 一次纯白阈值→目标 projection | 进入梦境、固定床/锚点、最终状态 |
| `return-home` | 纯白收束→`returnOrigin`→余辉淡出 | 短阈值→原位置 | 阈值文字→原位置结果 | 返回驻地、原位置、无默认出生重置 |
| 声音 | UI/Action/Environment/Voice/Music 独立 | 必要 cue 限制，字幕保留 | 关闭装饰 cue，关键视觉保留 | 无声时仍读出同一结果 |
| 触觉 | 语义事件轻/中/重 Profile | 关闭非必要震动 | 关闭屏幕震动/触觉 | 设备不支持不报业务错误 |

### 10.3 状态切换与点击矩阵

| 入口 | 触发 | 应播放 | 禁止 |
|---|---|---|---|
| `state-transition` | accepted/projection revision | 结果演出、列表重排、入梦/返回、错误收束 | 从动画开始推断成功 |
| `click-play` | click/Enter/Space/confirm | 按钮/焦点/局部反馈或独立演示 | 直接提交规则或播放未确认结果 |
| Skip | Space/Esc/可访问 Skip | 收敛到 settled | 发规则提交、改变结果 |

## 11 输入无障碍

- 每个场景都用鼠标、键盘和手柄等价路径至少验证一次；Enter/Space/confirm 结果一致，Esc 只取消/关闭当前表现层。
- Tab/Shift+Tab 顺序稳定，焦点环不被裁剪或遮罩吞掉；全屏演出有可访问名称、Skip 和 live region。
- 读屏器可读出页面、当前对象、disabled 原因、playing/completed/skipped/failed/fallback、错误原因和最终结果；关键音效有文字/字幕等价。
- reduced motion/low 不删除焦点、状态文字、列表顺序或返回焦点；Dialog 结束后焦点归还触发点/结果区域。
- 状态不能只靠颜色、粒子或声音；必须有文字、图标、形状、纹理或 ARIA 信息辅助。

## 12 加载错误超时

- 加载中：显示标题、轮廓/Skeleton 和「加载中」文字，不显示伪造完成结果。
- 资产缺失：显示指定 `assetRef` 的可读语义占位、fallback 配方和有限诊断；不出现 broken image、错误素材借用或静默空白。
- 音频缺失：通道独立失败，字幕/视觉 cue 继续；音频错误不阻塞页面。
- 演出失败/跳过：进入 `settled` 并与正常播放对比 result label、revision、位置和焦点；不得重复发规则 intent。
- 投影/网络超时：显示重试、取消或安全返回；动画 timeout 仅结束表现层。两者都不得伪造 accepted。
- console/资产错误：任何未捕获 error、warning、404/解码失败、未处理 rejection、hydration mismatch、循环播放或 broken resource 都判失败。

## 13 明确不做

- 不用截图、视频或“看起来正确”替代可重复的 DOM/ARIA/事件/性能观察；不访问后端、规则 store 或隐藏数据。
- 不把普通卡片 hover、全页面同步淡入、永久呼吸、彩色渐变、粒子铺满、全屏常态白幕作为验收通过条件。
- 不把 60fps 目标理解为可删除结果、焦点、错误文字或 fallback；不通过关闭 console 记录掩盖错误。
- 不测试或实现 `editor`、`research-bench`、`material-library`、`computer` 内部页面。
- 不将 `+3` 作为选择或 trigger 结果；只验收 deferred label、slot 和未来交接信息。

## 14 依赖交接

- 依赖 B1–B6 提供可进入页面、稳定状态/intent、projection fixture、结果 revision、覆盖层优先级、返回原点和焦点路径。
- 依赖 B7-01 提供 9 个 recipe id、落点、音频通道、fallback 顺序和 `PresentationIntent`；依赖 B7-02 提供三档 Profile 和预算策略。
- 宿主/测试工具提供可控的资源缺失、音频缺失、超时、拒绝、Skip、reduced-motion、低性能、键盘/手柄和 console/网络采集环境。
- 资产/音频团队提供合法 `assetRef`/`audioRef`、manifest、字幕和 fallback metadata；本矩阵不修改这些依赖物。
- 所有失败项记录事件 id、semantic id、profile、revision、错误类别和可重现输入；不在验收过程中越权修改依赖目录。

## 15 验收条件

- [ ] 9 个母题矩阵场景全部通过：对象、方向/来源、路径、落点、结果和降级均可观察。
- [ ] `state-transition` 与 `click-play` 独立可演示，点击/动画/音频不推进规则，Skip 只改变播放阶段。
- [ ] `enter-dream`/`return-home` 纯白往返通过标准/reduced/low 三档，固定实体和 `returnOrigin` 正确。
- [ ] 所有 asset/audio/particle/recipe 缺失都有确定 fallback；没有 broken image、空白死区、语义错误素材借用或未处理资源错误。
- [ ] reduced motion 保留顺序、焦点、文字、语义色和最终结果；low 保留关键结果并关闭装饰预算。
- [ ] UI、Action、Environment、Voice、Music、Haptic 通道可独立 mute/缺失，关键声音有字幕/视觉等价。
- [ ] 键盘、手柄、触控和读屏等价路径通过；焦点环、Skip、live region 和焦点归还正确。
- [ ] 标准档关键路径目标 60fps；采集无不可接受长帧、主线程阻塞、粒子失控、未处理 promise 或 hydration 错误。
- [ ] console 无 error/warning，资产/音频/解码/网络错误均可解释并有恢复路径。
- [ ] `+3` 显示 deferred 且不可选；`+0/+1/+2` selection/trigger effects 可演示并在 Profile 降级后仍不改变结果。
- [ ] 通过 `npx tsc --noEmit`、相关 `npx vitest run`、`npm run lint`，并完成本矩阵所有可重复场景记录。
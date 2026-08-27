# B7-01 动效配方目录

## 1 页面定位

这是 B7 的共享动效配方目录。它把全旅程的 9 个动效母题、声音通道、触觉反馈和 fallback 写成可复用的表现端口。配方只消费已确认的 `resultSnapshot`/projection，不拥有规则状态；动画只重演结果，不推进规则。

## 2 权威来源

- `attachmentId: "presentation-animation-feedback-02"`
  `provenance: "docs/表现系统/02_动画音效与反馈.md；规则与表现解耦、ActionPresentationBinding、声音通道、fallback、性能策略"`
- `attachmentId: "presentation-motion-index-03"`
  `provenance: "docs/表现系统/03_动画灵感索.md；全局过渡母题、纯白入梦/返回、粒子分工与配方复用"`
- `attachmentId: "presentation-motion-checklist-12"`
  `provenance: "docs/表现系统/12_动态图形化设计清单（V0迁移准备）.md；B7 全流程落点与可跳过演出"`
- `attachmentId: "global-motion-audio-fallback"`
  `provenance: "prompts/00-global/G-05-motion-audio-fallback.md；统一状态机、9 个母题、音频/粒子独立缺失和 +3 规则"`

## 3 当前决策

- 曲线动画是主力；全屏层只用于低频仪式和纯白世界边界；粒子是局部调味，不能承载唯一结果；帧动画是可替换增强，不是 B7 的强制素材依赖。
- 同一母题只换语义色、方向、强弱和承载对象，不复制骨架。普通 UI 不整屏遮挡世界，不使用所有组件同时淡入。
- 结果配方只有在 `accepted` 或 projection revision 更新后播放；`pending` 只显示局部等待，不得播放成功演出。
- `+3` 是 deferred、不可选；`+0/+1/+2` 的 selection/trigger effects 必须保留，`+3` 只有后续 manifest/recipe/trigger 交接位。
- `enter-dream` 与 `return-home` 共享纯白语汇和可跳过时间轴，但必须保留各自来源、方向和最终落点。

## 4 状态机

```text
idle
  -> triggered
  -> playing
  -> completed | skipped | failed
  -> settled
```

- `triggered` 只表示收到表现事件，不表示规则成功。
- `completed` 表示时间轴正常完成；`skipped` 表示用户或 reduced-motion 策略提前收敛；`failed` 表示配方、资源、音频或运行时失败。
- `settled` 必须渲染宿主已确认的 `resultSnapshot`。任一异常路径都清理粒子、音频和遮罩实例，但不改变 snapshot。
- 旧 revision 到达时取消旧播放或收敛到新权威位置；回放只消费记录的 semantic event，不重演规则。

## 5 组件树

```text
MotionCoordinator
├─ TransitionRecipeLayer
│  ├─ SlowWhiteCurtain
│  ├─ FlashWhite
│  ├─ BlackFold
│  ├─ AfterglowFade
│  └─ ContourReveal
├─ FeedbackRecipeLayer
│  ├─ SemanticHighlight
│  ├─ ShakeRebound
│  ├─ ListReflow
│  └─ GrainVanish
├─ AudioChannelRouter
│  ├─ UiAudioChannel
│  ├─ ActionAudioChannel
│  ├─ EnvironmentAudioChannel
│  ├─ VoiceAudioChannel
│  └─ MusicAudioChannel
├─ HapticFeedbackLayer
├─ ParticleLayer
├─ FallbackLayer
└─ PresentationLiveRegion
```

每层可独立缺失。`MotionCoordinator` 只编排时间和可见结果，不调用规则引擎；`AudioChannelRouter` 和 `HapticFeedbackLayer` 只消费表现事件。

## 6 只读数据

```ts
interface MotionEventProjection {
  readonly eventId: string;
  readonly semanticId: string;
  readonly trigger: 'state-transition' | 'click-play';
  readonly visibility: 'public' | 'local' | 'related-only';
  readonly resultSnapshot: Readonly<Record<string, unknown>>;
  readonly revision: string;
  readonly source: 'mock' | 'projection';
  readonly assetRefs: readonly string[];
  readonly audioRefs: readonly string[];
  readonly hapticRefs: readonly string[];
  readonly reducedMotion: boolean;
  readonly performanceProfile: 'standard' | 'reduced-motion' | 'low';
  readonly skipAllowed: boolean;
}
```

配方不可读取实体内部规则对象、路径图、AI 决策、隐藏字段、AP/HP/伤害计算或回调闭包。`assetRefs`/`audioRefs` 只是挂载引用；缺失时进入明确 fallback。

## 7 动作意图

```ts
interface PresentationIntent {
  readonly kind:
    | 'presentation.play-demo'
    | 'presentation.skip'
    | 'presentation.audio-mute'
    | 'presentation.haptic-toggle'
    | 'presentation.profile-select';
  readonly eventId: string;
  readonly requestId: string;
}
```

- 控制面板演示 `state-transition` 或 `click-play` 时只发送 `presentation.play-demo`。
- Skip 只发送 `presentation.skip`，不能发送 `battle.submit`、`match.confirm`、`result.continue` 或其他规则 intent。
- 点击业务控件先发既有稳定 intent；只有宿主返回 `accepted`/新 revision 后，配方才播放结果段。
- mute、震动开关和 profile 选择是本地 UI 偏好，不改变规则投影。

## 8 本地 UI 状态

允许保存：`phase`、`progress`、`pendingEventId`、`activeRecipeId`、`fallbackRecipeId`、`skipRequested`、`assetLoadState`、`audioLoadState`、`muted`、`hapticEnabled`、`reducedMotion`、`performanceProfile`、`focusTarget` 和短生命周期的粒子池引用。

不得保存或推断：规则结果、回合推进、资源扣除、伤害、目标、路径、匹配成功、装载成功、结算奖励或原位置。`settled` 始终以 projection 为准。

## 9 视觉令牌

| 配方 id | 视觉承载物与语义 |
|---|---|
| `slow-white-curtain` | 奶白/纯白从边缘柔和吞没阈值，再吐出结果；入梦、加载完成、重大揭晓 |
| `flash-white` | 纯白短促闪光并以余辉退回；命中确认、过载、系统通过 |
| `black-fold` | 黑色从边缘收束或落黑，再从黑中长出新状态；失败、断线、退出、硬切 |
| `afterglow-fade` | 原色降饱和、声音抽离、对象渐退；战后、返回、状态解除 |
| `contour-reveal` | 轮廓/阴影先出现，实体细节后长出；面板、角色、物件、解锁 |
| `semantic-highlight` | 语义色边缘光、材质凸起、焦点环；当前对象、可交互、结果落点 |
| `shake-bounce` | 目标向错误方向轻弹并回到原位；拒绝、无权限、无效落点、错误 toast |
| `list-reflow` | 用 `layout`/`layoutId` 保留 item 连续性，彼此让位；轮次、通知、物品、诊断 |
| `grain-vanish` | 对象按语义色碎为尘/屑/光点；消耗、破损、死亡、解除、提交 |

纯白只能是短暂梦境边界或高冲击确认，不是常态底色；黑幕不得替代梦境传送；颜色不能作为唯一状态信息。

## 10 动效绑定

### 10.1 九个母题的真实落点

| 母题 | state-transition 落点 | click-play 落点 | 约束 |
|---|---|---|---|
| 慢白幕 | `enter-dream`、加载完成、结算揭晓 | 控制面板演示按钮 | 固定实体先可见；结果确认后才吞没 |
| 闪白幕 | 命中确认、过载、系统通过 | 确认控件的局部确认光 | 局部优先，不能把普通点击做成全屏 |
| 黑幕收束 | 断线、失败、退出、硬切 | 取消/安全返回演示 | 黑幕后必须有文字或结果，不留黑屏死区 |
| 余辉淡出 | 战后、状态解除、回到驻地 | 关闭对话/通知的温和退场 | 是褪色，不是黑或白 |
| 轮廓显影 | 面板/实体/角色/解锁出现 | 打开面板或查看详情 | 先轮廓与阴影，再实体细节 |
| 语义高亮 | 当前行动者/投影结果对象更新 | hover/focus/selected/active | 必须有文字、图标、纹理或形状辅助 |
| 震动回弹 | rejected、timeout、路径/目标无效 | 无权限、无效拖放、错误点击 | 回到原位，不改变投影 |
| 列表重排 | 轮次、通知、诊断、排序更新 | 拖放成功后的顺序确认 | 用布局连续性，不硬跳、不改规则顺序 |
| 颗粒化消失 | 消耗、破损、死亡、解除、提交确认 | 演示离场对象 | 粒子缺失时转图标/文字，不丢结果 |

### 10.2 纯白入梦与返回

- `enter-dream`：`residence-original-position`/床锚点可见 → `contour-reveal` 显示床与人形 → `slow-white-curtain` 吞没 → 纯白内完成梦境载入 → 显影到对局入口。床是固定承载物，不随白幕消失。
- `return-home`：结算 projection 已确认 → 纯白收束梦境 → 以 `returnOrigin` 为落点复原驻地人形/床 → `afterglow-fade` 交还驻地。禁止重置到默认出生点。
- 跳过或失败均直接渲染目标 projection；不能因为动画失败而重复载入、重复结算或修改位置。

### 10.3 声音与触觉通道

- UI：聚焦、确认、菜单、拒绝和结构化错误。
- Action：由权威语义事件驱动的动作/命中/结果音。
- Environment：风、雨、机械和场景氛围。
- Voice：角色语音和字幕同步。
- Music：场景/旅程音乐。
- Haptic：轻=焦点/落地，中=射击/受击，重=倒地/爆炸；只响应已确认事件，可全局关闭。

通道独立音量与 mute。声音缺失、设备不支持或重复事件限频时，保留文字/图标/字幕等可视等价结果；不通过声音预加载泄露隐藏信息。

### 10.4 配方 fallback

```text
specified recipe
  -> same semantic category default
  -> generic procedural feedback
  -> icon/text state change
```

显示 `asset.fallback` 的可读状态和 `assetRef`/错误原因。缺失仪式资源不得借用语义错误的全屏配方；音频缺失不阻塞 UI；粒子缺失不影响结果。

## 11 输入无障碍

- 所有演示和 Skip 同时支持鼠标、Tab、Enter/Space、手柄 confirm、触控等价路径；Esc 关闭当前表现层或取消演示，不隐式提交规则。
- Skip 具有可读名称、焦点环、`aria-label` 和 live region；读屏器能读到 playing、skipped、failed、fallback、settled 和错误原因。
- reduced motion 保留对象顺序、来源、目标、最终位置、状态文字和焦点归还；不把“关闭动画”实现成内容瞬间消失且无结果提示。
- 声音/震动不是唯一信息；关键结果必须有文本、图标、颜色加形状/纹理中的至少一种等价表达。
- 全屏覆盖层使用可访问 Dialog/FocusScope，焦点不进入不可操作的遮罩；结束或 Skip 后焦点回到触发点/结果区域。

## 12 加载错误超时

- 配方加载显示标题、语义对象和轮廓态；不显示伪造完成数据。
- 资产加载失败按四级 fallback 继续，显示语义占位、可读名称和有限诊断；不能出现 broken image 或静默消失。
- 音频加载失败只关闭该 cue；字幕/视觉结果继续；触觉不可用静默降级。
- 投影、意图或演出超时分开显示：提供重试、取消或安全返回；超时不宣称成功，不重复发规则 intent。
- 演出 runtime error 必须进入 `failed → settled`，清理当前 overlay/particle/audio，渲染权威 result snapshot。
- 低性能档预算超限时优先关闭装饰层和非关键过渡，保持结果信息；不可因 60fps 目标阻塞状态更新。

## 13 明确不做

- 不从配方、音效、粒子、震动、时间轴或 `assetRef` 推断规则数据。
- 不使用动画开始作为成功、动画结束作为提交或 Skip 作为规则确认。
- 不让普通 hover、列表、通知、错误和常态操作使用全屏白/黑演出。
- 不常驻粒子、屏幕震动、余辉拖尾或无意义呼吸；不使用彩虹色、浏览器式卡片墙或统一淡入。
- 不将 `+3` 设为可选择，不生成其 MVP 结果；只保留 deferred 交接描述。

## 14 依赖交接

- B1–B6 提供稳定页面挂载点、路由、覆盖层优先级、projection、intent builder、结果态和焦点顺序。
- 资产端口解析 `assetRef`，返回加载/缺失/版本不兼容和 fallback 标识；B7 不生产素材、不改 manifest 所有权。
- 音频端口解析 `audioRef`，提供 UI/action/environment/voice/music 独立通道、mute、停止/恢复和字幕信息。
- 宿主提供 `revision`、`resultSnapshot`、`returnOrigin`、事件 visibility、skip 能力、性能 profile 和 reduced-motion 偏好。
- 表现层只发布 `PresentationIntent` 和诊断，不直接访问后端、规则引擎、AI 决策或持久化 store。
- `+3` 交接保留 `effects.deferred`、选择/触发 recipe slot 和 manifest 兼容位，但不得进入当前选择器。

## 15 验收条件

- [ ] 9 个母题都能通过真实承载物演示，且来源、方向、路径、落点、结果可解释。
- [ ] `state-transition`/`click-play` 分别演示；结果动画只在 accepted/projection update 后播放。
- [ ] 入梦和返回使用纯白边界、可跳过、固定床/`returnOrigin` 正确，失败与跳过不改结果。
- [ ] UI、Action、Environment、Voice、Music、Haptic 通道独立；声音/触觉缺失有可视等价反馈。
- [ ] 缺失 asset/audio/particle/recipe 时 fallback 可见且保持结果；无语义错误素材借用。
- [ ] reduced motion 与低性能档保留关键结果、顺序和焦点；正常档目标 60fps，无无界粒子。
- [ ] console 无 error/warning，资产/音频/解码/promise 错误均已处理；无 broken image 和未捕获 rejection。
- [ ] `+3` 显示 deferred、不可选；`+0/+1/+2` 的 selection/trigger effects 可演示。
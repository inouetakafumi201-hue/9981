# B7-02 Reduced Motion 与性能策略

## 1 页面定位

这是 B7 的可访问动效与性能策略 brief。它定义标准档、`prefers-reduced-motion` 档和低性能档如何共享同一结果、顺序、来源和落点，同时限制渲染成本、声音轰炸和粒子实例。它只控制表现 Profile，不改变规则、投影、intent 或结算。

## 2 权威来源

- `attachmentId: "presentation-animation-feedback-02"`
  `provenance: "docs/表现系统/02_动画音效与反馈.md；reduced motion、粒子策略、通道可访问、低性能 Profile 与验收不变量"`
- `attachmentId: "presentation-motion-checklist-12"`
  `provenance: "docs/表现系统/12_动态图形化设计清单（V0迁移准备）.md；reduced motion、低性能、加载/错误/跳过清单"`
- `attachmentId: "global-accessibility-contract"`
  `provenance: "prompts/00-global/G-04-interaction-accessibility.md；输入等价、焦点、live region 和 reduced-motion 约束"`
- `attachmentId: "global-motion-audio-fallback"`
  `provenance: "prompts/00-global/G-05-motion-audio-fallback.md；表现状态机、fallback、声音和 60fps 目标"`

## 3 当前决策

- 三档 Profile 共享同一 semantic event 和 settled result：`standard` 提供完整但克制的空间演出，`reduced-motion` 关闭非必要位移/闪烁/粒子/震动，`low` 以预算优先关闭装饰和远景更新。
- 9 个稳定母题 id 必须保持可追踪：`slow-white-curtain`、`flash-white`、`black-fold`、`afterglow-fade`、`contour-reveal`、`semantic-highlight`、`shake-bounce`、`list-reflow`、`grain-vanish`。
- 播放入口固定为 `state-transition` 与 `click-play`；声音通道独立管理，音效缺失时保留字幕或视觉等价反馈。
- reduced motion 不是把全页面改成同一透明度淡入；必须保留对象顺序、来源、目标、最终位置、语义色、文本和焦点。
- 正常档关键路径以 60fps 为目标；性能超预算时按显著性降级，不阻塞投影或结果消费。
- 纯白入梦/返回、结果揭晓、错误回弹、列表重排和关键语义高亮在三档都有确定的可读替代；动画只重演结果不推进规则。
- `+3` deferred 特效不进入可选档位；低性能/reduced motion 不得误将 `+3` 当成可实现结果，仍保留其交接位。

## 4 状态机

```text
profile-unresolved
  -> standard | reduced-motion | low
  -> event-triggered
  -> full-motion | reduced-motion-motion | budget-motion
  -> completed | skipped | failed
  -> settled
```

- Profile 由系统偏好、用户设置和设备/运行时预算共同确定；它不改变 `MotionEventProjection` 的 semantic id 或 result snapshot。
- `reduced-motion-motion` 可以在触发前直接选择短时间轴；触发后不能任意删掉结果或重排对象。
- 帧预算超限进入 `budget-motion`，仅停止装饰层、屏幕外层和低显著粒子；关键结果仍完成。
- 资源缺失、超时、用户 Skip 和 runtime error 都收敛到 `settled`，以 projection 渲染最终状态。

## 5 组件树

```text
PerformanceMotionRoot
├─ MotionProfileResolver
│  ├─ SystemReducedMotionSource
│  ├─ UserMotionPreference
│  └─ RuntimeBudgetMonitor
├─ MotionBudgetGate
│  ├─ CriticalResultTrack
│  ├─ SpatialContinuityTrack
│  └─ DecorativeTrack
├─ ReducedMotionAdapter
├─ ParticleBudget
├─ AudioRateLimiter
├─ HapticProfileAdapter
├─ VisibilityScheduler
├─ FallbackLayer
└─ PerformanceStatusRegion
```

`CriticalResultTrack` 和 `SpatialContinuityTrack` 优先于 `DecorativeTrack`。预算组件只改变表现强度、实例数量和时间轴，不写入规则状态。

## 6 只读数据

```ts
interface MotionPerformanceProjection {
  readonly eventId: string;
  readonly semanticId: string;
  readonly revision: string;
  readonly resultSnapshot: Readonly<Record<string, unknown>>;
  readonly systemReducedMotion: boolean;
  readonly userMotionPreference: 'full' | 'reduced' | 'system';
  readonly performanceProfile: 'standard' | 'reduced-motion' | 'low';
  readonly viewport: { readonly width: number; readonly height: number };
  readonly visibility: 'public' | 'local' | 'related-only';
  readonly skipAllowed: boolean;
  readonly assetRefs: readonly string[];
  readonly audioRefs: readonly string[];
}
```

只读投影可决定 Profile 和可见 semantic event；表现层不得根据帧率、粒子数量或音频是否加载来推断规则结果。性能指标只用于本地诊断和降级。

## 7 动作意图

```ts
interface MotionProfileIntent {
  readonly kind:
    | 'presentation.motion-profile'
    | 'presentation.skip'
    | 'presentation.audio-mute'
    | 'presentation.haptic-toggle';
  readonly profile?: 'standard' | 'reduced-motion' | 'low';
  readonly requestId: string;
}
```

- 用户修改动效偏好只产生本地表现设置 intent，不重发规则动作。
- Skip 只产生 `presentation.skip`，不提前 `continue-result`、`battle.submit` 或任何规则提交。
- 设备不支持触觉、音频或 GPU 合成时静默选择 fallback/profile，不把能力缺失报告为业务错误。

## 8 本地 UI 状态

允许保存：当前 Profile、系统偏好读取结果、用户偏好、`frameBudgetState`、`animationPhase`、可见性/屏幕外标记、粒子池大小、音频限频窗口、muted、hapticEnabled、Skip 状态和诊断采样。

禁止保存：帧率导致的规则快慢、动画进度导致的回合推进、任何资源/生命/成本/目标/路径/结算事实。Profile 可切换但不得要求重新加载玩法包或修改投影 revision。

## 9 视觉令牌

- 标准档：完整 9 母题，保留空间路径、局部遮罩、有限粒子、局部高光和声音/触觉。
- reduced motion：语义色、轮廓、焦点环、文字、布局结果和最终位置保留；位移缩短或直线化，闪烁改为一次性亮度/颜色变化，颗粒和拖尾移除。
- 低性能档：保留 `semantic-highlight`、`shake-bounce` 的可读最小变换、`list-reflow` 的稳定顺序、`contour-reveal` 的轮廓/文字和 `slow-white-curtain`/`black-fold` 的最小结果阈值；关闭装饰粒子、余辉拖尾、屏幕震动和远景呼吸。
- 纯白仍只用于入梦/返回/低频结果边界；任何 Profile 都不能把纯白变成常态底色。
- 粒子数量不是语义；粒子关闭时用图标、文字、边缘光或字幕补足关键结果。

## 10 动效绑定

### 10.1 三档策略

| 语义/母题 | standard | reduced-motion | low |
|---|---|---|---|
| 慢白幕 | 有方向的遮罩吞没/吐出，固定实体先落地 | 短时遮罩或不透明度阈值，保留起点/终点 | 单次阈值切换 + 文字「入梦/加载完成」 |
| 闪白幕 | 一次短闪并余辉退回 | 取消闪烁，改边缘高亮/颜色确认 | 取消全屏，仅局部结果高亮 |
| 黑幕收束 | 边缘压黑后长出下一状态 | 快速暗化并保留标题/结果 | 直接显示安全返回/失败结果，不留黑屏 |
| 余辉淡出 | 原色降饱和与声音抽离 | 一次降饱和/透明度变化 | 直接降饱和，保留对象和文字 |
| 轮廓显影 | 轮廓→实体→细节分层 | 轮廓→实体，移除细节延迟 | 轮廓与实体同一短步，但保留语义占位 |
| 语义高亮 | 边缘光、材质凸起、短 spring | 静态高亮、焦点环和文字 | 静态高亮与图标/纹理，不呼吸 |
| 震动回弹 | 短位移回弹 + 错误语义音 | 取消位移，保留一次颜色/边框反馈 | 只显示原因和焦点回到原项 |
| 列表重排 | `layout`/`layoutId` 空间让位 | 短直线位移或先后顺序渐变 | 保持最终顺序，显示「已重新排序」 |
| 颗粒化消失 | 限量语义粒子散开 | 取消粒子，轮廓/透明度收束 | 直接移除并显示语义文字/图标 |

### 10.2 纯白入梦/返回降级

- standard：床/人形/原位置锚点可见，慢白幕或纯白收束后显影到确认结果。
- reduced motion：保留纯白阈值的语义和前后顺序，但缩短遮罩，移除粒子、闪烁和位移拖尾；`returnOrigin` 仍是落点。
- low：只保留一次明确的纯白阈值和「正在入梦/返回驻地」文字，之后直接显示权威目标 projection；固定床和结果位置仍可见。
- 三档都允许 Skip；Skip/失败/资源缺失不改变结果，不重复发起装载或结算。

### 10.3 性能边界

- 只对 `transform`、`opacity`、合成层和批量粒子做高频更新；避免每帧布局测量、同步强制 reflow、无限阴影滤镜和大面积 blur。
- 使用 `layout`/`layoutId` 时限制列表范围；视口外元素不更新动画；粒子对象池复用，短时 burst 后销毁/回收。
- 音频 cue 合并/限频，避免快速重复事件造成音频轰炸；音乐/环境通道不因 UI 反馈频繁重启。
- 在开发验收中记录平均/最低 fps、长帧、主线程阻塞、粒子实例和未处理资源错误；标准档关键路径目标 60fps，不能以隐藏错误换取帧率。
- 预算紧张时按显著性顺序降级：屏幕外装饰 → 远景呼吸/拖尾 → 非关键粒子 → 屏幕震动 → 非关键过渡；最后才考虑缩短非关键布局动效。关键文本、结果、焦点和状态顺序不得删除。

## 11 输入无障碍

- 系统 `prefers-reduced-motion` 默认进入 reduced-motion 候选；用户显式设置可覆盖视觉偏好，但不得覆盖用户明确的辅助技术需求。
- Tab/Shift+Tab、Enter、Space、Esc、方向键、手柄焦点和触控都走同一个 Profile/Skip intent builder。
- reduced motion/low 下焦点环、`aria-live`、错误原因、Skip、结果文字和返回焦点不减少；任何关键状态都有声音之外的可视/可读替代。
- 动态区域用 `aria-live="polite"` 报告开始/完成/跳过/fallback；错误和安全返回提供清晰的 `role="status"`/`role="alert"`，避免重复播报。
- 关闭动画后不能把焦点留在卸载节点；Dialog/全屏层结束后焦点回到触发控件或结果区域。

## 12 加载错误超时

- Profile 解析超时使用安全默认：先使用 reduced-motion 兼容的短表现，不阻塞 projection。
- 性能监测异常不得显示为规则失败；显示本地「已使用低性能表现」状态，允许恢复标准档。
- 资产/音频/粒子缺失按指定配方→同类默认→程序化→图标文字降级；缺失不导致空白、broken image 或规则重试。
- 演出超过预算直接完成非关键层并进入 `settled`，结果文字/焦点/状态仍更新；不让无限 spinner 或粒子层阻塞。
- 网络/投影 timeout 与动画 timeout 分开显示，分别提供重试、取消或安全返回；不把任一 timeout 本地转换为成功。

## 13 明确不做

- 不用 `animation-duration: 0.1s !important` 粗暴覆盖所有内容，不把 reduced motion 降级为全局淡入或内容闪现。
- 不在 reduced-motion/low 档删除关键状态、错误原因、焦点、顺序、结果文字、`returnOrigin` 或语义高亮。
- 不用帧率或设备档位改变规则时序、回合、资源、结算或结果。
- 不常驻粒子、拖尾、屏幕震动、blur、重阴影或呼吸；不以“60fps”掩盖 console/资产错误。
- 不把 `+3` 恢复为选择项，不为其生成当前可选的触发结果。

## 14 依赖交接

- 宿主提供 system/user motion preference、设备能力、运行时 budget、viewport、projection revision、结果快照、Skip 能力和安全返回端口。
- B7 提供 Profile resolver、预算闸门、三档语义映射、可视 fallback 和诊断字段；不改宿主规则、路由或数据接口。
- 资产端口提供尺寸、解码、版本和 fallback；音频端口提供通道、字幕、限频和 mute；触觉端口提供能力检测和强度 Profile。
- 测试/验收端提供正常档 fps/长帧记录、reduced-motion 快照、低性能快照、console/网络/资产错误收集；不得以人工“看起来不卡”替代记录。
- `+3` 由后续表现/资源端口接手 `effects.deferred` slot；当前 Profile 只确保它不可选且不会进入结果。

## 15 验收条件

- [ ] 标准档、reduced-motion 档、低性能档对同一事件显示相同结果、顺序、来源和落点。
- [ ] reduced motion 下无必要位移、闪烁、拖尾、粒子和震动被关闭或替换，但文字、焦点、语义色和结果仍清晰。
- [ ] 低性能档关闭装饰层并保留关键结果；无无限 spinner、空白覆盖或规则时序变化。
- [ ] `enter-dream`/`return-home` 三档均可跳过、失败、资源缺失并收敛到同一 projection；`returnOrigin` 不丢失。
- [ ] 正常档关键路径目标 60fps；记录长帧、主线程阻塞、粒子预算和可见层更新，没有用隐藏错误换帧率。
- [ ] UI/Action/Environment/Voice/Music/Haptic 缺失均有独立降级；关键声音有字幕或视觉替代。
- [ ] console 无 error/warning，asset/audio/decode/promise/hydration 错误可定位且已处理。
- [ ] `+3` 保持 deferred、不可选；`+0/+1/+2` 的 selection/trigger effects 在 Profile 切换后仍可演示。
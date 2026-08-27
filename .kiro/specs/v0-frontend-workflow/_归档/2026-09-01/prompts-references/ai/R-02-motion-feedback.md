# R-02 动效、反馈与音频重写 brief

## 1 页面定位

为 WakeUp 前端壳层定义“已确认结果如何被看见、听见和跳过”的表现配方。动效、粒子、音效、字幕和震动是投影结果的重演，不是规则执行器。生成 AI 可以做可交互演示和可替换表现组件，但不能借演出推进回合、扣资源、判命中、改变目标或写存档。

## 2 权威来源（attachmentId/provenance）

- `G-01-project-and-scope-contract`：UI-only、mock/projection 与状态边界。
- `G-02-visual-token-contract`：语义色、层级和视觉基础。
- `G-03-ui-port-contract`：intent 结果、snapshot、pending/rejected/stale/timeout。
- `G-05-motion-audio-fallback`：事件级表现、音频、reduced motion、降级和 `+3` 纪律。
- `presentation-animation-feedback-02` / `references/source/presentation-animation-feedback-02.md`：表现解耦、动作绑定、音效、粒子、性能和资源降级。
- `presentation-motion-index-03` / `references/source/presentation-motion-index-03.md`：复用过渡母题、四类动画分工、梦境态和边角状态。
- `presentation-motion-checklist-12` / `references/source/presentation-motion-checklist-12.md`：启动、旅程、对局、错误和 reduced motion 的具体反馈。

## 3 当前决策

- 高频动作优先用曲线/变换；帧只在必须读懂身体形态时增强；粒子只做空间体积感；全屏只用于低频仪式或世界级门槛。
- 全屏仪式集合为翻窗、跳窗、令其长眠、近战招架触发，以及入梦/返回的纯白显形世界演出。普通射击、上车、换弹、撬锁完成、载具爆炸不升级成全屏。
- 全局过渡母题只复用慢白幕、闪白幕、黑幕收束、余辉淡出、轮廓显影、颗粒化消失；同一时刻只运行一个全局母题。
- 音频分为 UI、对局动作、环境、语音/字幕通道；音效由稳定语义事件触发。规则可感知的声音与纯 UI 音必须分离，不能用声音暴露隐藏状态。
- 用户跳过、资源缺失、GPU 故障、音频不可用和 reduced motion 都必须落到相同的已确认结果。音频不可用不阻塞页面，粒子不可用不删除结果信息。

## 4 状态机

`idle → triggered → playing → completed | skipped | failed → settled`。

- 只有 `accepted` 或新的 projection snapshot 才能进入 `triggered`；pending/rejected 不播成功演出。
- `skip requested` 直接跳到 `settled` 的末帧；`failed` 走 semantic fallback 后进入同一 settled。
- 资源：`unloaded → loading → loaded | missing | incompatible`；缺失不能令整个页面失败。
- 音频：`muted | ready | blocked | unavailable`，`blocked/unavailable` 只显示可视反馈或字幕。

## 5 组件树

`MotionCoordinator → SemanticEventRouter → VisualEvent + AudioCue + HapticCue + ParticleLayer + CaptionLayer + FallbackLayer`。

页面层使用 `TransitionOverlay`、`SkipControl`、`ReducedMotionProfile` 和 `LiveRegion`。每条事件只挂 `semanticId`、`eventId`、`visibility`、`resultSnapshot` 与 `assetRefs/audioRef`；具体动画配方可替换，不把规则数据塞入配方。

## 6 只读数据

可读事件形状：`{ eventId, semanticId, visibility, resultSnapshot, assetRefs, audioRef, reducedMotion }`。结果快照中的 `source` 必须是 `mock` 或 `projection`。表现可以读 `from/to` 位置、已确认姿态、事件可见性、文本标签、音量 profile 和性能 profile，但不得从动画阶段推导 AP、HP、伤害、目标、隐藏动作、AI 选择或结算顺序。

## 7 动作意图

用户点击“跳过”只生成 `presentation.skip`；静音、字幕、音量、震动和 reduced-motion 设置生成 `settings.preview` 或 `settings.save`。普通页面交互使用 G-03 的 intent，不用动画回调提交业务。音效播放、粒子播放和镜头反馈都是本地表现事件，不是规则 intent。成功结果的触发来自宿主投影，不来自 `onAnimationComplete`。

## 8 本地 UI 状态

允许保存播放阶段、进度、skipRequested、assetLoaded、audioReady、muted、subtitleVisible、reducedMotion、performanceProfile、队列中的表现事件和当前焦点。禁止保存规则结果、资源扣除、目标合法性、AI 决策、隐蔽/招架事实或本地计时推进回合。事件过期时收敛到最新 snapshot，不继续播放旧结果。

## 9 视觉令牌

- 正常反馈：使用动作语义色；红=生命伤害/危险，蓝=清醒/处决/科技，橙=AP/进行中，紫=远程/关系约束，珊瑚=近战，绿=安全/完成，青=交流/UGC。
- 过渡：`slow-white-curtain` 表达入梦/边界，`flash-white` 表达短促确认，`black-fold` 表达退出/断线/暂停，`afterglow-fade` 表达离开危险，`contour-reveal` 表达出现/揭示，`grain-vanish` 表达消耗/解除。
- 粒子最小集合：落地灰尘、生命伤害血粒、枪口火、碎玻璃、令其长眠蓝光。粒子数量低、可池化、不能承载唯一结果。
- 梦境态是低饱和、外围泛灰、梦核恍惚，不是眩晕、故障、冻结或中毒；梦境侵蚀的淡白→泛白→纯白是另一套威胁语义。

## 10 动效绑定

- 普通移动：沿权威起止位置作跳跃式曲线，落地 squash，必要时少量灰尘；不要用动画路径计算 AP 或距离。
- 近战：确认后按“快步跳 → 攻击/受击 → 恢复对峙”播放；远程按后坐/枪口火/结果反馈播放；未命中不凭空给目标受击演出。
- 物品：拾取飞向背包、丢弃落地回弹、消耗缩小消融、换弹优先图标闪烁+音效；锁完成为锁变绿短闪，不做全屏。
- UI：列表使用 layout/reflow，资源块从权威旧值到新值过渡，拒绝使用 shake/rebound 和原因文字；倒计时只是等待提示，不能直接提交规则动作。
- 纯白显形必须让床保持存在、支持跳过并回到最终状态；黑幕不能替代入梦/返回传送。

## 11 输入无障碍

所有演出都提供可聚焦的“跳过/继续”或关闭入口；Space、Enter、Esc、手柄确认和屏幕阅读器均可触发。`prefers-reduced-motion` 或设置开启后去除跳跃位移、闪烁、拖尾、粒子、屏幕震动和非必要旋转，保留颜色、文字、顺序和最终结果。字幕/视觉方向提示必须覆盖关键音效；静音不隐藏重要信息。高频重复事件合并或限频，避免音频轰炸。

## 12 加载错误超时

事件开始前资源超过阈值时显示短暂 loading 和可见说明；随后按“指定配方 → 同语义默认 → 通用程序化反馈 → 图标/文字结果”降级。连接等待显示重试、取消和安全返回，不用 mock 成功遮盖失败。音频加载失败转字幕/视觉 cue；粒子加载失败保留图标、文字、状态条；时间线超时直接 settle。旧 snapshot、过期事件或不兼容资源不得覆盖新结果。

## 13 明确不做

不做动画驱动的规则状态机，不做纯斥力/ORCA、寻路、AI 决策、伤害预测、目标判定、资源扣除或存档写入。不把招架待机、暗押、不可见策略通过音效、预加载、字幕、震动、粒子或动画提前泄露。不为载具爆炸、换弹、普通破坏发明全屏仪式；不在 reduced motion 下删除关键状态。

## 14 依赖交接

真实接线方提供稳定语义事件和 `resultSnapshot`，素材方提供 `assetRef`，声音方提供 `audioRef`，宿主提供 settings/profile。前端实现 `MotionCoordinator` 和 fallback，不依赖后端内部路径或类名。所有新增语义事件须登记 `semanticId`、默认配方、fallback、可见性、skip policy 和字幕文本；若事件来源不确定，交接为待裁决而不是猜测。

## 15 验收条件

- 在正常、跳过、资源缺失、音频禁用、reduced motion、低性能和超时路径中，最终结果一致。
- 只在 accepted/projection update 后播结果；动画不能改变 snapshot 或提交业务。
- 四项仪式和纯白显形语义各有明确落点，普通动作没有误用全屏。
- 关键结果不依赖颜色、声音、粒子或动画单一通道；字幕、图标、文字和状态条可独立读懂。
- 无无限 spinner、无过期动画覆盖新状态、无隐藏信息泄露，性能 profile 可关闭装饰效果并保持核心反馈。

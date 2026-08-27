# G-05 动效、声音与降级契约

## 1 页面定位

把所有 UI 变化写成事件级表现配方。动画、声音、镜头和粒子只重演已确认结果，不推进规则。

## 2 权威来源（只写 attachmentId / provenance）

- `presentation-animation-feedback` / `docs/表现系统/02_动画音效与反馈.md`：规则与表现解耦、fallback、音效反馈。
- `presentation-motion-index` / `docs/表现系统/03_动画灵感索.md`：曲线、全屏、粒子和状态母题。
- `presentation-motion-checklist` / `docs/表现系统/12_动态图形化设计清单（V0迁移准备）.md`：启动、对局、结算、错误、reduced motion。

## 3 当前决策

曲线动画为主；帧/全屏动画克制；低频仪式动作可用全屏层。入梦与返回统一纯白显形。资源缺失、动画失败或用户跳过都必须落到同一结果状态。

## 4 状态机

`idle` → `triggered` → `playing` → `completed | skipped | failed` → `settled`。失败/跳过不得改变 `settled` 的规则结果。

## 5 组件树

`MotionCoordinator` → `VisualEvent` + `AudioCue` + `ParticleLayer` + `FallbackLayer`。各层可独立缺失。

## 6 只读数据

事件含 `eventId`、`semanticId`、`visibility`、`resultSnapshot`、`assetRefs`、`reducedMotion`；AI 不从动画反推隐藏数据。

## 7 动作意图

点击/状态变化只触发 UI event；规则动作由 G-03 intent 处理。Skip 只发 `presentation.skip`，不发规则提交。

## 8 本地 UI 状态

播放阶段、进度、是否 muted、reduced motion、asset loaded、skip requested 可本地保存。

## 9 视觉令牌

slow-white-curtain、flash-white、black-fold、afterglow-fade、contour-reveal、semantic-highlight、shake-bounce、list-reflow、grain-vanish。黑幕只做内容显影/退场，不能替代梦境与现实传送。

## 10 动效绑定

- 状态切换：页面/阶段变化触发。
- 点击播放：按钮/卡片/滑块点击触发。
- 结果动画只能在 accepted/projection update 后播放。
- `+3` 不可选，但 burst selection/trigger effects 必须存在。

## 11 输入无障碍

动画可跳过；Skip 可通过键盘/手柄/屏幕阅读器访问；reduced motion 关闭非必要位移、闪烁和粒子，保留状态顺序和文本结果。

## 12 加载错误超时

资源超时显示语义占位并继续；连接/加载超过阈值显示重试/取消/安全返回；音频缺失不得阻塞 UI；粒子缺失不影响结果。

## 13 明确不做

不使用动画推进回合、扣资源、判命中、选择目标、写存档；不让全屏粒子承担唯一结果信息。

## 14 依赖交接

视觉资源通过 `assetRef`，音频通过 `audioRef`，宿主提供结果投影；AI 只实现可替换表现层。

## 15 验收条件

每个高频母题至少有一处落点；跳过/失败/缺失资源与正常结果一致；reduced motion 可用；无 console/asset 错误；性能目标 60fps。
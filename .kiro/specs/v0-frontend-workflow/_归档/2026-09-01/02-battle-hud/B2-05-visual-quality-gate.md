# B2-05 Visual Quality Gate

## 1. 页面定位

本 brief 是 B2 battle HUD 的视觉质量、动效、素材和可访问性硬门禁。它不是一套可选主题，也不是用更多贴图掩盖布局问题的装饰清单；它要求生成结果首先像一个正在发生的 2D 游戏场景，然后才读出 HUD 信息。

质量门禁覆盖 `hud-main`、动作卡、目标上下文、投点/轮次、NPC、淘汰/观战、断线/重连和结果/奖励的共同视觉语言。它只约束表现层的构图、材质、动效、输入等价和降级，不实现规则、结算、AP 扣除、目标判定或 OpRegistry。

## 2. 权威来源

- `hud-visual-quality-addendum` / `prompts/02-battle-hud-visual-quality-addendum.md`：世界先于面板、反网页感、空间层级、材质、Framer Motion 和视觉断言，已完整吸收。
- `hud-action-cards-addendum` / `prompts/02-battle-hud-action-cards-addendum.md`：行动卡的扇形、悬停详情、目标两级跳转和卡片动效，已完整吸收。
- `presentation-ui-authority` / `docs/表现系统/01_图形化与UI.md`：像素前景+全息背景、语义色、轮次/投点、素材、观战、可访问性与动态演出。
- `presentation-elements-baseline` / `docs/表现系统/04_画面要素文档.md`：1080p 层级与 HUD 要素基板。
- `frontend-visual-tokens` / `00-global/G-02-visual-token-contract.md`：颜色、材质、合法素材和 fallback。
- `frontend-motion-fallback` / `00-global/G-05-motion-audio-fallback.md`：Framer Motion、结果绑定、跳过、声音/粒子降级。
- `frontend-accessibility` / `00-global/G-04-interaction-accessibility.md`：五态、键盘/手柄/触控、焦点和颜色外语义。
- `frontend-port-contract` / `00-global/G-03-ui-port-contract.md`：只读 projection、intent 和结果状态。

## 3. 当前决策

- 核心构图是「游戏世界占满全屏 → HUD 作为半透明、局部、不对称、空间附着的工具层」。中央世界必须有低饱和全息投影光层、像素前景实体、落地阴影、空间落点、遮挡/深度和事件舞台；不得因“不实现地图规则”而输出空白纯色底板。
- 固定分层为：环境层（全息光/雾/粒子）→ 实体层（角色、节点、物品、弱点、门户）→ 事件层（当前行动者、目标关系、投点条、攻击/受击/结算）→ HUD 层（轮次、手牌、资源、固定入口）→ 仪式/错误层（爆闪、淘汰、重连、纯白返回）。每层可透出相邻层，不做五个独立网页栏。
- 不使用 CSS Grid 三栏 dashboard 作为主构图；不同时封闭完整宽度顶栏、完整高度侧栏和完整宽度底栏。轮次是左侧悬浮脊柱，行动卡是底部扇形手牌，投点从轮次旁向外生长，回合是顶部局部徽章。
- 任何两类信息载体不得都套同一套 `rounded-lg + border + shadow + icon + title`。轮次、投点、动作手牌、连接/结果、奖励可分别使用脊柱、斜切仪表、扇形卡、断边状态带、局部结果层，但必须共用同一 token 系统。
- 可交互使用边缘发光、局部高光、材质凸起、反光扫过或短 spring；不可用使用扁平、降饱和、无高光并说明原因。灰白表示受状态限制但仍可交互，灰色扁平无高光才表示不可点。不可只靠 hover 变色。
- 允许且鼓励使用 manifest 登记的角色、头像、物品、骰子、弱点、奖励图标、纹理、光效和参考图。素材必须是空间/界面中的实体或锚点，不得只是卡片中央贴图；缺失时保留语义位置、轮廓/图标/文字 fallback，不以零素材为目标。
- 颜色只来自全局 token：红生命/伤害/危险，蓝清醒/SP/科技，黄感官/警戒，橙 AP/进行中，绿安全/免费/完成，紫远程/约束，珊瑚近战，青社交/UGC，灰延迟/不可用，灰白受限可交互，纯白/奶白梦境边界，金银少量高光。颜色永远不是唯一信息通道。
- `+3极限爆发` 是 deferred、MVP 不可选；不得以视觉质量为由恢复旧 4 档。0/1/2 的 selection/trigger effects 必须保留。行动卡与强力骰/逆转滑块必须视觉分离。

## 4. 状态机

```text
quality-baseline
  -> environment-layer-ready
  -> entity-layer-ready
  -> event-layer-ready
  -> hud-layer-ready
  -> ceremony-or-error-ready

quality-baseline -> visual-regression-failed -> revise
any-layer -> asset-missing -> semantic-fallback
any-interaction -> hover/focus/active/disabled/return
any-motion -> playing -> completed | skipped | failed -> settled
any-port-request -> pending -> accepted | rejected | stale | timeout
```

视觉质量通过不是“静态截图好看”而是状态闭包：正常、hover/focus/active/disabled/return、loading、pending、rejected、stale、timeout、error、reduced-motion、素材缺失和结果落地都必须可读。任何失败必须回到同一语义终态，不用成功动画掩盖失败。

## 5. 组件树

```text
BattleHudQualitySurface
├─ EnvironmentLayer
│  ├─ HolographicLightField
│  ├─ LowSaturationDepthField
│  └─ AmbientParticleFallback
├─ EntityLayer
│  ├─ PixelActorAssets
│  ├─ PixelItemAssets
│  ├─ WeaknessIconAnchors
│  └─ GroundShadowAndOcclusion
├─ EventLayer
│  ├─ CurrentActorAnchor
│  ├─ TargetRelationLines
│  ├─ DiceAndRollComparisonStage
│  ├─ AttackPreviewStage
│  └─ OutcomeEventStage
├─ HudLayer
│  ├─ TurnSpine
│  ├─ TurnHeader
│  ├─ PaidActionHand
│  ├─ FreeActionBand
│  ├─ ResourceCellMeters
│  ├─ StatusAndInventoryAnchors
│  └─ ConnectionAndReadonlyBadges
├─ CeremonyLayer
│  ├─ BurstSelectionEffect
│  ├─ BurstTriggerEffect
│  ├─ EliminationTransition
│  ├─ ResultReveal
│  └─ SafeReturnWhiteReveal
├─ ErrorAndFallbackLayer
├─ FocusAndAccessibilityLayer
└─ VisualAuditHarness
```

`VisualAuditHarness` 只收集状态截图/诊断与表现检查结果，不读取规则内部、不改投影、不作为运行时业务组件。各层的 `z-index` 由空间语义决定，不能因 DOM 顺序偶然遮挡当前目标、投点条或焦点环。

## 6. 只读数据

```ts
interface BattleHudVisualAuditProjectionMock {
  readonly source: 'mock' | 'projection';
  readonly revision: string;
  readonly viewport: { readonly width: number; readonly height: number; readonly safeArea: string };
  readonly layers: readonly { readonly id: 'environment' | 'entity' | 'event' | 'hud' | 'ceremony' | 'error'; readonly visible: boolean; readonly anchor?: string }[];
  readonly semanticTokens: readonly { readonly token: string; readonly usage: string }[];
  readonly assetRefs: readonly { readonly assetRef: string; readonly kind: 'actor' | 'item' | 'portrait' | 'dice' | 'weakness' | 'reward' | 'texture' | 'effect'; readonly state: 'loading' | 'ready' | 'missing' }[];
  readonly motionEvents: readonly { readonly semanticId: string; readonly phase: 'idle' | 'selection' | 'trigger' | 'result' | 'skipped' | 'failed'; readonly reducedMotion: boolean }[];
  readonly interactionStates: readonly { readonly controlId: string; readonly state: 'hover' | 'focus' | 'active' | 'disabled' | 'return'; readonly reason?: string }[];
  readonly intentStates: readonly { readonly requestId: string; readonly status: 'pending' | 'accepted' | 'rejected' | 'stale' | 'timeout'; readonly reason?: string }[];
}
```

审计使用 projection/mock 中显式的层、assetRef、motion、interaction 和 intent 状态。视觉审计不能从颜色、动画或截图反推规则事实；缺少字段视为未覆盖或安全 fallback，而不是自行补写。

## 7. 动作意图

本 brief 只定义表现/审计相关 intent，不定义玩法：

- `presentation.preview-state`：切换展示 fixture 或 visual state，纯 UI。
- `presentation.play-state-transition`：播放 projection 已确认的状态演出。
- `presentation.play-click`：播放局部 click feedback，不执行规则。
- `presentation.skip`：跳到同一确认终态，不跳过规则结算。
- `presentation.asset-fallback`：登记素材缺失的可见降级状态，不替换成其他语义素材。
- `presentation.visual-audit`：记录视觉门禁结果或截图标记，不写游戏状态。

真实动作（行动卡、投点、目标、重连、结果继续）仍走 B2-02/B2-03/B2-04 和 G-03 的稳定 intent；本 brief 不创建第二套 dispatcher。

## 8. 本地 UI 状态

允许：视口安全区、层级可见性偏好、hover/focus/active/disabled/return、motion phase、asset loading state、粒子启用、reduced-motion、muted、审计 fixture 选择、局部透明度和焦点位置。

禁止：本地推进回合、扣 AP/SP、判定目标/伤害/胜负、创建结果、发放奖励、改变连接事实、以动画完成当作规则成功。视觉审计工具可以标记失败，但不能自动修改产品组件或投影。

## 9. 视觉令牌

- 材质最少形成两层深度：半透明底色 + 内侧高光/边缘光/局部阴影/轻微噪声中的至少一项；大面积使用暗调灰阶/低饱和全息光，语义色只用于事件、边缘和局部高光。
- `clip-path` 斜切、缺口、断边、贝形托盘、悬浮条、脊柱和局部阴影用于建立几何差异；不要给每组加标题栏、分割线和外框。
- 轮次栏是左侧悬浮脊柱/勋章链；投点是旁侧斜切仪表与向外生长横条；动作选择是底部扇形手牌/零费窄带；目标预览是实体附近的低遮挡关系层；结果是局部事件落地。
- 可用对象从灰度截图仍能通过高光、形状、凸起、焦点环和文字辨识；disabled 必须扁平无高光和原因。纯白只在梦境边界/返回仪式等低频场景短暂出现。
- 素材遵循项目素材纪律：需要可见美术素材时通过既定 sprite/asset pipeline 生成和登记，组件通过 manifest 的 `assetRef` 挂载；禁止手工造贴图/占位图冒充成品，禁止 9-slice 边框图。素材缺失走语义轮廓、图标或文字 fallback。
- 不使用黑底荧光栅格、过度玻璃拟态、霓虹扫描线、发光二极管阵列、金属工程面板、彩虹渐变或无来源新主色。像素前景与全息背景必须有明显层间距离。

## 10. 动效绑定

- 先环境稳定，再实体入场，再事件锚定，再 HUD 附着，再按触发显示仪式/错误层；使用 `AnimatePresence` 错峰进入，不能所有元素同时 `initial/animate`。
- 使用 `layout/layoutId` 处理轮次重排、当前行动者迁移、付费/零费同舞台切换、动作卡吸附目标；使用 spring 表达资源格、轮次高亮、滑块推挡、手牌入场和横条生长。
- 投点演出必须有明确起点、路径、落点：selection 充能 → trigger 爆闪/一次性粒子 → 灰白横条伸出 → 强力骰段快速延伸 → 统一左侧刷色 → 结果行落地。不得只做 opacity 0→1。
- 动作卡 hover/focus 只做局部上浮、反光和详情展开；无目标卡飞向事件锚点，有目标卡以同一 `layoutId` 进入目标选择；点空白回到手牌基线。
- NPC 阶段只动相关实体/事件，观战镜头使用局部 spring，重连状态使用局部脉冲，结果奖励逐行落地；rejected/stale/timeout 使用回弹/停滞/错误层，不使用成功闪光。
- reduced motion 保留语义、目标顺序、焦点、结果顺序、状态文字和最终落点，只缩短/移除位移、闪烁、粒子和镜头震动；声音缺失不阻塞。

## 11. 输入无障碍

- 每个可交互对象必须提供五态：hover、focus、active、disabled、return。焦点环用明确外环/内光，不能被 clip-path、素材或半透明背景吞掉。
- 鼠标 hover、触控 tap/long-press、键盘 focus、手柄 focus 必须到达同一详情/intent；拖拽若存在，必须提供“选择来源 → 选择目标 → 确认”的键盘替代。
- Tab/Shift+Tab、Enter、Space、Esc、方向键、手柄 confirm/cancel 与 screen reader 均有等价路径。动作手牌/投点滑块/观战/重连/结果的焦点顺序与当前任务一致，不按偶然 DOM 顺序跳跃。
- live region 只播报语义结果：回合变化、投点结果、请求 pending/rejected/stale/timeout、淘汰、连接、outcome、奖励 ready；不逐粒子播报，不通过音效泄露隐藏信息。
- 颜色不是唯一通道；使用文字、图标、轮廓、形状、刻度、材质和 aria 状态。文字放大后关键控制必须重排而非裁切，最小 1280×720 仍保留所有关键 intent。

## 12. 加载错误超时

- 初始状态应先显示环境空间和层级轮廓，HUD 数据 loading 显示语义 skeleton/outline，不以伪造的 ready 数据填空。
- 任何 assetRef missing 都保留原几何和语义位置，显示可读 assetRef/实体名称及 fallback；不可用素材不静默换成另一角色/物品/奖励。
- motion event failed/skipped 必须落到同一个已确认终态；粒子/GPU/音频失败不改变结果，允许直接显示结果或静态语义层。
- intent pending/rejected/stale/timeout 在局部反馈区可见；错误/连接层不覆盖全部世界、不无限 spinner，并提供重试、取消、关闭或安全返回的明确 intent。
- projection revision 过期时清掉本地选择和 hover 目标，重读确认快照；视觉审计发现层级/遮挡失败时标记失败，不用截图或动画伪造通过。
- 错误和 fallback 也必须满足 focus、live region、reduced-motion 和颜色外语义通道；无 console/asset load error 是代码接入门禁的一部分。

## 13. 明确不做

- 不通过增加图片、渐变、边框、粒子或新依赖掩盖平面布局问题；不做后台、控制台、卡片墙、设置页、充值界面、浏览器 chrome 或网页滚动条。
- 不使用 CSS Grid 三栏 dashboard、完整不透明顶/侧/底栏、统一圆角卡片、统一 1px 边框、9-slice 边框图、霓虹扫描线或大渐变背景代替空间层。
- 不恢复旧 4 档投点、`+3` 可选行为、行动卡与投点合并、动作按钮纵列、hover 弹窗详情或确认框式目标选择。
- 不以“零素材”作为验收标准，不手工造贴图，不删除合法素材挂载位；不把素材贴成卡片背景或用错误素材静默替换。
- 不实现地图规则、动作规则、AP/SP/HP、伤害、目标、AI/NPC、观战权限、连接协议、胜负、奖励或 OpRegistry。

## 14. 依赖交接

- 依赖 B2-00 的整体范围和固定冻结，B2-01 的 HUD 层/固定组件，B2-02 的行动卡/目标上下文，B2-03 的投点/轮次/状态可见性，B2-04 的连接/观战/结果状态。
- 依赖 G-01 至 G-08 的全局 token、UI port、输入、动效、fixture、冲突和页面索引；如与来源冲突，以 B2-00 与全局当前裁决为准并登记，不自行恢复历史语义。
- 依赖既定 sprite-forge/asset pipeline、manifest 和 `assetRef`；动态高光、边缘光、遮挡、门控、过渡由代码完成，静态素材由合法管线提供。
- 交接给实现/抽取方：视觉层级、token、motion semanticId、fallback、五态、焦点顺序和本门禁断言；不交接任何规则内部结构或 OpRegistry 路径。

## 15. 验收条件

- [ ] 隐藏所有文字后，画面仍像正在发生的游戏场景，而非网页后台；中央世界有空间、实体、事件和深度，HUD 半透明附着。
- [ ] 至少清晰存在环境、实体/事件、HUD 三层，仪式/错误层只按状态出现；不使用三栏 dashboard、卡片墙、统一圆角或大面积不透明面板。
- [ ] 轮次脊柱、扇形行动卡、零费窄带、投点仪表/横条、目标关系、连接/结果层分别使用不同但一致的几何语言；动作卡与投点滑块没有混淆。
- [ ] 灰度截图仍可辨识可交互对象、当前行动者、投点事件、只读/禁用状态和结果层级；不只依赖颜色。
- [ ] `+3` 仍 deferred 不可选，0/1/2 selection/trigger effects 存在；投点、手牌、结果和重连动效都有起点、路径、落点，非统一线性淡入。
- [ ] 合法登记素材可通过 `assetRef`/manifest 挂载，缺失素材有语义 fallback；没有手工贴图、9-slice 或静默错误替换，没有 console/asset 错误。
- [ ] hover/focus/active/disabled/return、键盘/手柄/触控/读屏、live region、reduced-motion、文字放大和 1280×720 安全区均可验证。
- [ ] pending/rejected/stale/timeout/error/safe-return 与 accepted 视觉不同；动画失败/跳过、粒子/声音缺失都落到同一确认终态，不伪造规则成功。
- [ ] 代码接入完成后通过 `npx tsc --noEmit`、相关 `npx vitest run`、`npm run lint` 和视觉截图/人工审查；若涉及文档术语同步，再通过 `npm run verify:docs`。

# B3-03 Dream Load Return Transition Brief

## 1 页面定位

- 本 brief 定义床A完成匹配后的床前就绪、对局装载、对局开始、结算继续、纯白 `return-home` 和出租屋原位置落点。
- `transition-dream` 是连续的全屏仪式演出，不是 loading 页面、进度条页面或弹窗。`enter-dream` 表达现实到梦境，`return-home` 表达梦境回到现实。
- 床是固定实体，全程不消失；人物、颜色、光线和纯白显形围绕床组织。跳过只改变本地表现时间，不改变权威装载/结算事实。
- 只允许床A竞技进入正式装载。床B不进入，床C自测结束回驻地，不进入该链。

## 2 权威来源（只写 attachmentId/provenance）

- attachmentId: `ops-residence-flow-03`
  provenance: `bed-ready-load-boundary-enter-dream-return-home-white-manifestation-original-position`
- attachmentId: `presentation-implementation-09`
  provenance: `ceremonial-timeline-framer-motion-bed-fixed-entity-and-residence-return`
- attachmentId: `presentation-animation-feedback-02`
  provenance: `skippable-ceremony-authority-event-order-and-fallback-presentation`
- attachmentId: `ops-outside-growth-01`
  provenance: `session-load-scene-package-boundary-and-exit-return`
- attachmentId: `user-residence-mvp-gate-20260820`
  provenance: `bed-a-only-competitive-load-and-result-continue-return-origin`

## 3 当前决策

- 只有匹配完成且床A点亮后，玩家走到床A前才可提交 `ready-at-bed-a`。
- 床前就绪是装载前的局部状态，不是直接传送；需要先展示可读的「竞技装载准备」摘要和确认/取消意图。
- 装载包括场景信息与玩法包的 mock 摘要；装载成功后进入 `transition-battle-intro`，可跳过世界介绍和玩法包说明。
- `enter-dream` 的顺序固定为：床浮现/显形 → 人与床整体进入纯白 → 纯白显影和色彩复原 → 人物从床跳下进入梦境。
- 对局结算的「继续」必须进入 `return-home`；顺序固定为：床保持在场 → 人物纯白显形 → 纯白推向床 → 人物在床复原色彩 → 起床演出 → 出租屋 `returnOrigin`。
- 返回原位置必须使用进入前保存的 `returnOrigin`，不得一律回默认出生点，不得瞬间换页掩盖落点。
- 允许床、人物、房间底板和仪式光效使用素材资产；动效由 Framer Motion/声明式 timeline 驱动，缺失素材需进入错误/降级分支。影子大厅在入梦前仍可作为原出租屋的只读叠加，不被转场误画成独立大厅。

## 4 状态机

```text
bed-a-lit
  -> bed-a-front-ready
  -> load-requested
  -> loading
  -> battle-intro
  -> enter-dream
  -> battle
  -> result
  -> result-continue
  -> return-home
  -> residence-original-position

bed-a-front-ready -> ready-cancelled -> bed-a-lit
loading -> load-failed -> load-retry | residence-original-position
battle-intro -> intro-skipped | intro-complete -> enter-dream
enter-dream -> battle
return-home -> return-skipped | return-complete -> residence-original-position
```

- `loading` 只读装载投影；本地倒计时不得伪造成功。
- 任何阶段收到权威拒绝进入 `load-failed` 或明确的 session error，不得由动画自行推进到对局。
- 跳过只把当前 timeline 收敛到允许的终态：`battle-intro` 跳到 intro complete，`enter-dream` 跳到 dream-side ready，`return-home` 跳到 residence-side ready。
- 床始终存在于 `enter-dream` 和 `return-home` 的渲染树中。

## 5 组件树

```text
DreamLoadReturnRoot
├─ BedFrontReadyLayer
│  ├─ BedAReadyPrompt
│  ├─ LoadPackageSummaryMock
│  ├─ ConfirmLoadIntent
│  └─ CancelReadyIntent
├─ LoadStatusLayer
│  ├─ LoadProgressNarrative
│  ├─ LoadFailureNotice
│  ├─ RetryLoadIntent
│  └─ ReturnResidenceIntent
├─ BattleIntroTransition
│  ├─ WorldIntroduction
│  ├─ PlaypackSummary
│  ├─ SkipIntroIntent
│  └─ IntroContinueMarker
├─ DreamWhiteManifestation
│  ├─ FixedBedAnchor
│  ├─ PlayerSilhouette
│  ├─ WhiteManifestationMask
│  ├─ ColorRestoreLayer
│  └─ SkipCeremonyIntent
└─ ReturnHomeTransition
   ├─ FixedBedAnchor
   ├─ PlayerWhiteForm
   ├─ WhitePushToBedLayer
   ├─ WakeUpRestoreLayer
   ├─ SkipReturnIntent
   └─ ResidenceReturnOriginMarker
```

## 6 只读数据

```ts
interface DreamLoadReturnProjectionMock {
  readonly load: {
    readonly state: 'idle' | 'ready' | 'requested' | 'loading' | 'loaded' | 'failed';
    readonly targetBed: 'bed-a';
    readonly sceneLabel: string;
    readonly playpackLabel: string;
    readonly loadProgress?: number;
    readonly failureCode?: 'asset-missing' | 'package-invalid' | 'session-timeout' | 'unknown';
    readonly mock: true;
  };
  readonly ceremonies: {
    readonly enterDream: 'pending' | 'playing' | 'complete' | 'skipped';
    readonly returnHome: 'pending' | 'playing' | 'complete' | 'skipped';
  };
  readonly returnOrigin: {
    readonly positionId: 'near-anchor' | 'near-bed-a' | 'near-room-center';
    readonly x: number;
    readonly y: number;
    readonly mock: true;
  };
}
```

Mock 样例：`sceneLabel: '竞技梦境·夜班走廊'`、`playpackLabel: '竞技规则包（mock）'`、`targetBed: 'bed-a'`、`returnOrigin: { positionId: 'near-bed-a', x: 640, y: 420, mock: true }`。

- `loadProgress` 只用于表现投影，范围不得被误读为玩家可见玩法数值；错误码必须有可读映射。
- 任何对局结果、场景包和位置均以只读投影为准，表现层不得自行计算或改写。

## 7 动作意图

- `confirm-bed-a-ready`：确认床A前的竞技装载准备。
- `cancel-bed-a-ready`：取消就绪提示并回到床A亮起态。
- `request-load`：提交场景与玩法包加载意图。
- `skip-battle-intro`：跳过介绍演出到允许终态。
- `skip-dream-ceremony`：跳过入梦演出到梦境侧已就绪。
- `continue-result`：从结算提交返回驻地意图。
- `skip-return-ceremony`：跳过返回仪式到驻地侧已就绪。
- `retry-load`：装载失败后重新提交装载意图。
- `return-residence`：装载失败或取消时返回原位置。

## 8 本地 UI 状态

- 床前就绪：`hidden`、`visible`、`confirm-focused`、`cancel-focused`、`return`。
- 装载：`idle`、`requested`、`loading`、`loaded`、`failed`、`retrying`；加载中禁用重复确认但不隐藏取消/返回。
- 对局介绍：`intro-enter`、`intro-reading`、`intro-skip-focused`、`intro-complete`。
- `enter-dream`：`bed-grounded`、`bed-emerging`、`white-manifestation`、`color-restoring`、`player-steps-off`、`dream-ready`。
- `return-home`：`dream-side`、`player-white-appears`、`white-push-to-bed`、`color-restoring`、`wake-up`、`origin-landed`。
- 所有按钮五态完整；跳过按钮可见但不默认抢焦点，返回/失败状态的焦点必须可回收。

## 9 视觉令牌

- 现实驻地沿用低饱和、暗调和灰白层次；梦境介绍可提高局部色彩，但不替换全局语义色。
- 纯白/奶白是梦境边界和过载仪式令牌，只在显形时间轴中出现；禁止把纯白做成静态常态底色。
- 床A使用蓝色竞技/科技语义；装载进行中使用橙色；成功进入使用绿/蓝；错误使用红；返回原位置使用灰白与蓝色复原光。
- 房间底板、床A、人物和相关静态精密细节允许素材资产；白光、轮廓、遮罩、色彩复原和粒子优先代码驱动。
- 屏幕层不能吞没床的固定轮廓；纯白遮罩要保留可感知的床锚点和前后关系。

## 10 动效绑定

- 床前就绪用玩家与床的空间关系、短促高光和 `AnimatePresence`；不瞬间替换整页。
- `transition-battle-intro` 使用分段显影/滑入和可跳过 marker；不能渲染为细长进度条 loading screen。
- `enter-dream` 时间轴：`bed-emerging` → `player+bed white` → `white reveal` → `restore color` → `step off`。纯白阶段约 1 秒级高冲击但可跳过。
- `return-home` 时间轴：`player-white-appears` → `white pushes to bed` → `restore player color` → `wake-up` → `origin-landed`。床全程固定。
- 使用 Framer Motion `useAnimate`/`AnimatePresence`/spring 或既定 `CeremonialTimeline`；不得使用 CSS 线性淡入淡出替代关键阶段。
- 演出被跳过或资源缺失时执行确定性收敛：保留床、人物、文字状态、跳过反馈和最终落点。

## 11 输入无障碍

- 床前就绪提示提供明确标题、目标床名、竞技模式和可用操作；Enter/Space 确认，Esc 取消。
- 介绍与仪式都提供可访问的「跳过演出」按钮和快捷键；跳过不隐藏关键状态文字。
- 装载/失败/返回状态使用 `aria-live` 宣布，且进度不能只由视觉动画表达。
- 过渡中提供焦点管理：焦点进入全屏层的首个可操作元素，结束后回到床前或结算「继续」触发点。
- 纯白闪光支持 reduced motion 和低闪光替代；不能依赖音效判断阶段。
- 所有可操作元素具备 hover/focus/active/disabled/return 和高对比焦点环。

## 12 加载错误超时

- 装载请求超过 mock 超时后进入 `load-failed`，显示「装载失败（mock）」、失败原因、重试装载和返回驻地；不自动进入对局。
- 场景或玩法包资产缺失时显示具体 `assetId`/失败类别和有语义的降级反馈；不得借用语义错误的其他全屏动画。
- 介绍资源缺失时使用文字化介绍和通用程序化过渡，保留跳过和进入终态；不把缺失资源伪装成成功。
- `returnOrigin` 缺失或无效时显示「返回位置暂不可确认（mock）」并停在可恢复的驻地落点选择态，不静默回默认点；若权威端口提供合法回退位置，显示回退原因。
- 任一动画超时都以权威投影状态为准收敛；表现层不自行发起规则推进或结算。

## 13 明确不做

- 不让床B、床C进入正式装载，不做床B联机副本、不做床C公开/正式入局。
- 不把纯白显形改成单帧白屏、普通 loading 页面、线性淡入或跳过后瞬间无落点换页。
- 不实现真实场景包编译、真实玩法包规则、真实结算计算或会话调度内部逻辑。
- 不销毁床、不把返回地点固定成默认出生点、不在返回后强制重复入梦流程。
- 不新增 3D/全屏 shader/独立传送网关依赖；沿用项目既定表现库和素材管线。

## 14 依赖交接

- 从 B3-01 接收床A命中区、`ready-at-bed-a`、床A素材和房间原位置输入。
- 从 B3-02 接收竞技匹配完成、`targetBed: 'bed-a'`、`matchId`、ready 投影和 `returnOrigin`。
- 向 B3-04 交接装载失败码、素材加载错误、超时、原位置缺失和可恢复错误状态。
- 依赖对局 HUD 的 `transition-battle-intro`、`transition-result` 挂载点和只读结果投影；不依赖 HUD 内部规则状态。
- 依赖表现系统的素材 manifest、白光/轮廓/粒子配方和 reduced-motion 入口；新增素材只通过既定管线登记。

## 15 验收条件

- [ ] 只有床A竞技可从匹配完成进入床前就绪和装载；床B/C均不能绕过门控。
- [ ] 床前就绪、装载、对局介绍、`enter-dream`、对局、结算、`return-home`、原位置落点可按顺序演示。
- [ ] `enter-dream` 和 `return-home` 都有可见的多阶段纯白显形，床全程固定且不消失。
- [ ] 对局介绍、入梦和返回均可跳过，跳过后仍落到正确的权威终态。
- [ ] 结算继续之后不是普通页面跳转，而是纯白 `return-home` 并落在进入前的 `returnOrigin`。
- [ ] 装载超时、资产缺失、玩法包无效和原位置缺失均给出可恢复错误，不伪造成功。
- [ ] 全屏转场具备键盘、读屏、reduced-motion、低闪光和焦点回收支持。
- [ ] 允许使用并正确挂载床/人物/房间等素材；素材错误不以零素材替代完成。

# B6-02 Overlay Z-Index and Input Arbitration

## 1 页面定位

本 Prompt 定义 B6 完整旅程的统一 overlay 层、z-index 契约、焦点锁/恢复和输入仲裁。它覆盖 battle HUD 或驻地之上的暂停、设置、叙事、通知、错误、连接反馈和 intent feedback，但不拥有任何 route 或玩法事实。完整 route 上下文仍是：`cold-start → loading → title → new-game/continue → residence → anchor-device → matching/residence-roaming/shadow-lobby → bed-front-ready → battle-intro → enter-dream → battle-hud → result → reward → return-home → residence-original-position`。

目标是让一个输入在同一时刻只有一个合法接收者，让高优先级错误/确认不被通知或装饰遮蔽，让 overlay 打开、关闭、拒绝、超时和安全返回都可恢复。所有 overlay 都是表现层 surface，动作只提交显式 intent。

## 2 权威来源

- `attachmentId: interaction-accessibility-contract`  
  `provenance: .kiro/specs/v0-frontend-workflow/prompts/00-global/G-04-interaction-accessibility.md`  
  五态、Tab/Enter/Space/Esc、FocusScope、live region、关闭后恢复焦点。
- `attachmentId: presentation-ui-01`  
  `provenance: global UI z-index baseline and input equivalence in docs/表现系统/01_图形化与UI.md`  
  世界层、UI 面板、弹出菜单和可见反馈的基础层级。
- `attachmentId: narrative-dialog-system`  
  `provenance: narrative dialog overlay contract and portrait/dialog separation`  
  叙事层、字幕、立绘和不裁切降级；叙事 overlay 不越权暂停世界。
- `attachmentId: frontend-ui-port-contract`  
  `provenance: .kiro/specs/v0-frontend-workflow/prompts/00-global/G-03-ui-port-contract.md`  
  intent pending/result、只读 projection 和写入隔离。
- `attachmentId: presentation-animation-feedback-02`  
  `provenance: deterministic animation fallback, result separation and reduced motion`  
  overlay 动效失败/跳过不改变业务结果。
- `attachmentId: governance-journey-11`  
  `provenance: full route context, pause/settings entry during battle and safe return semantics`  
  overlay 在完整旅程中的挂载位置。

## 3 当前决策

- 统一 `OverlayCoordinator` 是唯一 overlay 注册、排序、打开、关闭、焦点锁和输入仲裁中心；页面不得各自实现全局 overlay manager。
- 最高优先级是阻断性错误/安全确认，其次是暂停/设置，叙事确认，再是通知，最后是 intent/连接 feedback；纯装饰反馈不拦截输入。
- z-index 是稳定 token，不由组件随意写数字；DOM 顺序和视觉顺序不等于输入优先级，输入必须显式由 coordinator 决定。
- modal overlay 使用 Radix Dialog/FocusScope 语义：焦点锁在当前 overlay，关闭后恢复触发源；非 modal overlay 只能在不冲突时接收输入。
- 暂停是否真实暂停由宿主投影决定，UI 不自行暂停；设置、叙事和通知不会直接写规则状态。
- Esc 只关闭当前可取消 overlay 或取消当前可取消意图；不能越过不可取消的安全确认，也不能在输入未仲裁时同时触发多个关闭。
- 同屏并列选择最多 5 个；通知堆栈和 feedback 采用优先级队列，低优先级可合并，不抢占当前焦点。

## 4 状态机

```text
OverlayCoordinator: closed
  -> open-requested
  -> resolving-priority
  -> focus-locking
  -> open
open
  ├─ input-owner-assigned -> interacting
  ├─ intent-created -> intent-pending
  ├─ close-requested -> closing
  ├─ higher-priority-overlay -> suspended
  └─ projection-stale/error -> feedback-visible
interacting
  ├─ accepted -> acknowledged -> open | closing
  ├─ rejected -> recoverable-error -> interacting
  ├─ timeout -> retry-or-cancel
  └─ cancel -> closing
suspended
  ├─ higher-overlay-close -> focus-restore -> open
  └─ route-change -> focus-safe-return -> closed
closing
  -> focus-restoring
  -> closed

优先级排序（高→低）：
blocking-error / safety-confirm
pause
settings
narrative
notification
intent-feedback / connection-feedback
ambient-decoration
```

覆盖规则：

1. `blocking-error` 打开时暂停所有低优先级输入；错误本身只允许重试、取消、安全返回等端口 intent。
2. `pause` 打开时 battle HUD 控件失去输入权；设置可从暂停内嵌为更高子层，关闭设置回暂停焦点。
3. `settings` 打开时只允许设置 tab/control、保存、取消、恢复默认的 UI intent；保存等待端口结果。
4. `narrative` 若为非 modal，不夺取 route 输入；若投影明确要求 modal，才锁焦点并将 `pause`/HUD 设为 suspended。
5. `notification` 默认不抢焦点；高优先级通知可播报但不覆盖 blocking error/pause/settings。
6. `intent-feedback`、`connection-feedback` 是非 modal live region，除非含安全确认，否则不得阻止用户返回。

## 5 组件树

```text
<OverlayHost>
  ├─ <OverlayCoordinator>
  │  ├─ <OverlayPortal>
  │  │  ├─ <BlockingErrorOverlay />
  │  │  ├─ <SafetyConfirmOverlay />
  │  │  ├─ <PauseOverlay />
  │  │  ├─ <SettingsOverlay />
  │  │  ├─ <NarrativeOverlay />
  │  │  ├─ <NotificationOverlay />
  │  │  ├─ <ConnectionFeedbackLayer />
  │  │  └─ <IntentFeedbackLayer />
  │  ├─ <FocusLockBoundary />
  │  ├─ <InputArbitrationBoundary />
  │  └─ <OverlayLiveRegions />
  └─ <OverlayTriggerRegistry />
```

`OverlayTriggerRegistry` 记录 trigger id、restore target、route、可用性和安全锚点。`FocusLockBoundary` 不让焦点落到不可见或 suspended surface。`InputArbitrationBoundary` 把 pointer、keyboard、gamepad 和 shortcut 归一成当前 owner 的 intent。

## 6 只读数据

```ts
interface ReadonlyOverlayProjection {
  readonly route: string;
  readonly revision: string;
  readonly overlays: readonly ReadonlyOverlayEntry[];
  readonly activeInputOwner: string | null;
  readonly pausePolicy: 'host-controlled' | 'not-paused' | 'unknown';
  readonly globalFeedback: readonly ReadonlyFeedbackEntry[];
  readonly availableIntents: readonly string[];
}

interface ReadonlyOverlayEntry {
  readonly id: 'blocking-error' | 'safety-confirm' | 'pause' | 'settings' | 'narrative' | 'notification' | 'connection-feedback' | 'intent-feedback';
  readonly mode: 'modal' | 'non-modal' | 'toast' | 'live-region';
  readonly priority: number;
  readonly state: 'closed' | 'opening' | 'open' | 'pending' | 'error' | 'stale' | 'closing';
  readonly triggerId?: string;
  readonly dismissible: boolean;
  readonly reason?: string;
}
```

projection 只描述宿主确认的 overlay、pause policy 和 feedback；本地 coordinator 可计算临时焦点/动画阶段，但不能以本地 `open=true` 伪造服务器确认的安全状态。overlay 不能读取玩法实体、规则 store 或后端内部错误对象。端口名称必须保持 `StatePort`、`ActionPort`、`CadencePort`；mock adapter 与真实 projection 共用这些边界。

## 7 动作意图

```ts
type OverlayUiIntent =
  | { readonly kind: 'overlay.open'; readonly overlayId: string; readonly triggerId: string }
  | { readonly kind: 'overlay.close'; readonly overlayId: string; readonly reason: 'cancel' | 'confirmed' | 'safe-return' }
  | { readonly kind: 'pause.open' }
  | { readonly kind: 'pause.resume' }
  | { readonly kind: 'settings.open'; readonly source: 'title' | 'pause' | 'residence' | 'hud' }
  | { readonly kind: 'settings.preview'; readonly key: string; readonly value: string | number | boolean }
  | { readonly kind: 'settings.save' }
  | { readonly kind: 'settings.cancel' }
  | { readonly kind: 'narrative.advance'; readonly surfaceId: string }
  | { readonly kind: 'notification.open'; readonly notificationId: string }
  | { readonly kind: 'notification.dismiss'; readonly notificationId: string }
  | { readonly kind: 'error.retry'; readonly errorId: string }
  | { readonly kind: 'error.cancel'; readonly errorId: string }
  | { readonly kind: 'route.safe-return'; readonly source: string };
```

鼠标 click、Enter/Space、手柄 confirm、触控 tap、Esc 和 shortcut 都只调用同一 intent dispatcher。`close` 不等于业务取消；需要取消匹配、装载或退出时必须使用明确的业务 intent，并等待端口结果。

## 8 本地 UI 状态

允许：overlay stack 的渲染顺序、当前 input owner、focus trap 状态、原触发器 ref/id、suspended overlay、当前 tab、通知是否已读的视觉标记、toast 定时器、设置 preview draft、动画阶段、pending requestId、reduced-motion 状态。

不允许：本地写入暂停事实、把 settings preview 当成保存成功、把 notification dismiss 当成规则确认、把错误关闭当成请求成功、修改 route、匹配、战斗或存档。route/revision 改变时清理无效触发器、pending draft 和过期 overlay。

## 9 视觉令牌

### z-index token

```text
z-base-world: 0
z-residence-entity: 4
z-world-focus: 5
z-route-ui: 10
z-notification: 20
z-narrative: 30
z-pause: 40
z-settings: 50
z-safety-confirm: 60
z-blocking-error: 70
z-global-feedback: 80
z-focus-ring: 90
```

这些 token 是 UI 合同，不表示 CSS 数字必须原样复制；组件只能引用语义 token。focus ring 必须高于对应 overlay 内容，不得被 `overflow/clip-path` 裁掉。

- 暗调半透明遮罩保留底层 route 可感知性；blocking error/safety confirm 可加深遮罩但保留标题和状态上下文。
- pause/settings 走结构化面板，narrative 使用叙事专属斜切/立绘层，notification 使用轻量边缘反馈，error 使用红色语义但同时显示文字原因。
- disabled、stale、pending 的视觉区别必须由文字、图标、材质和 live region 一起承载。

## 10 动效绑定

- overlay 入场/出场用 Framer Motion `AnimatePresence`；弹层从其触发源方向进入，关闭回到触发源，不能从屏幕中心无来源地跳出。
- higher-priority overlay 出现时低优先级层使用 `suspended` 视觉，不销毁其本地 tab/focus；关闭后恢复到原层合法焦点。
- 设置保存 pending 用局部旋转/进度和文字；accepted 后才播放保存确认；rejected/timeout 使用回弹/错误闪烁，不播成功动画。
- 通知重排使用 `layout`；不为每条低优先级通知制造强闪或声音。blocking error 可使用一次短反馈，不能依赖持续闪烁。
- reduced-motion 下去除位移、弹簧、粒子和强闪，保留 overlay 顺序、遮罩、焦点、文本和最终状态。

## 11 输入无障碍

- modal overlay 使用 Radix Dialog/FocusScope，带可读 title/description、`aria-modal`、关闭策略和焦点陷阱；非 modal overlay 使用 `role=status`/`aria-live`，不抢焦点。
- 打开 overlay 时焦点进入首个可用动作或标题；关闭后回 trigger；trigger 已卸载时按 registry 的安全锚点恢复。
- Tab/Shift+Tab 不穿透 modal；方向键只在当前 owner 的列表/菜单生效；Esc 只作用于最高优先级且可取消层。
- 同一 shortcut 不被多个层监听。仲裁顺序为 blocking error→safety confirm→settings/pause→narrative→当前 route→notification/feedback。
- disabled/locked control 暴露 `aria-disabled`、`aria-describedby` 和原因；不可只变灰。高优先级错误使用 assertive live region，普通通知使用 polite。
- 输入法、触控和手柄与键盘等价；拖拽/长按有选择来源→选择目标→确认替代路径。

## 12 加载错误超时

- overlay projection 加载中显示“正在同步覆盖层”及当前 route，不显示空白面板；端口未连接显示连接中和安全返回。
- 错误 overlay 至少区分：projection error、intent rejected、stale revision、timeout、asset missing、audio unavailable；每项给对应 retry/cancel/safe-return。
- settings 保存超时保留 preview draft 但标为未保存；取消只丢弃本地 draft，不声称恢复服务端设置。
- focus lock 初始化失败时禁止把焦点丢到背景；退回 route 主区域的可访问安全锚点并播报原因。
- overlay stack 恢复失败时清空不可恢复的低优先级层，只保留 blocking error 和 safe-return；不批量执行关闭 intent。
- 资源/音频失败使用语义 fallback；不因一张立绘、图标或音效缺失而阻断 pause、settings、错误和安全返回。

## 13 明确不做

- 不为 pause、settings、narrative、notification、error 分别建立互相不知道的 overlay manager。
- 不让 overlay 自行暂停玩法、提交业务、写 settings store、发奖励、取消匹配或修改 route。
- 不用 z-index 竞赛、DOM 顺序、pointer-events 猜测输入优先级；不使用覆盖全屏但没有焦点语义的 div。
- 不让通知抢占错误/暂停/设置；不让叙事或动画遮住安全返回和错误原因。
- 不把 `Esc` 绑定为无条件返回标题、退出对局或确认危险操作。

## 14 依赖交接

- B1 提供 AppShell/portal、全局 token 和控制面板宿主；B6-02 只消费挂载点，不改其实现。
- B2/B3/B5 提供各自 overlay surface 和稳定 intent；本 Prompt 统一 coordinator、z-index 和焦点合同。
- Radix 负责可访问 dialog/menu/focus primitives；Framer Motion 负责进出场；Howler/lucide 通过 adapter 使用。
- 宿主提供 pause policy、route revision、overlay projection 和 `ActionPort` 结果；UI 不读取内部 pause/exception 实现。
- 抽取时保留 `OverlayCoordinator`、`InputArbiter`、`FocusRestoreManager` 和 z-index token；替换 mock projection 不改这些边界。

## 15 验收条件

- [ ] overlay 优先级和 z-index token 明确且稳定：blocking error/safety > pause > settings > narrative > notification > feedback。
- [ ] 任一时刻只有一个 input owner；快捷键不会被多个层重复处理。
- [ ] modal 焦点锁、Esc 取消、关闭后焦点恢复、trigger 卸载后的安全锚点均可演示。
- [ ] pause/settings/narrative/notification/error/connection/intent feedback 都有成功、空、错、超时、重试、取消和安全返回语义。
- [ ] overlay 不自行推进规则、不把 pending 当成功、不以颜色或音效作为唯一反馈。
- [ ] reduced-motion、键盘、手柄、触控和屏幕阅读器路径保持等价。
- [ ] 抽取 `OverlayCoordinator` 不依赖后端内部形状，mock→UI port 可替换。

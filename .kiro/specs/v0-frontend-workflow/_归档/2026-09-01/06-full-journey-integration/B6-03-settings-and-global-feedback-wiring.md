# B6-03 Settings and Global Feedback Wiring

## 1 页面定位

本 Prompt 定义 B6 的 `GlobalSettingsPanel` 与 `GlobalFeedbackRegion` 接线。它把标题、驻地、对局 HUD、暂停和错误覆盖共享的设置与反馈统一到稳定的 UI port 边界，避免每个页面各自维护音量、键位、无障碍、连接、请求和动效反馈。完整 route 上下文是：`cold-start → loading → title → new-game/continue → residence → anchor-device → matching/residence-roaming/shadow-lobby → bed-front-ready → battle-intro → enter-dream → battle-hud → pause/settings/narrative/notification/error overlays → result → reward → return-home → residence-original-position`。

设置是用户偏好/表现配置的 UI surface，feedback 是端口结果和资源状态的可读呈现。两者都不拥有玩法状态，不直接写后端、存档、规则、暂停、匹配、结算或奖励。所有“预览/保存/恢复默认/重试/取消”都是显式 intent，必须展示 pending/accepted/rejected/stale/timeout。它不实现规则、后端、网络或业务写入；设置和 feedback 只通过 `StatePort`、`ActionPort`、`CadencePort` 或其稳定 adapter 接线。

## 2 权威来源

- `attachmentId: frontend-ui-port-contract`  
  `provenance: .kiro/specs/v0-frontend-workflow/prompts/00-global/G-03-ui-port-contract.md`  
  StatePort、ActionPort、CadencePort、requestId、结果态和 mock→projection 替换。
- `attachmentId: interaction-accessibility-contract`  
  `provenance: .kiro/specs/v0-frontend-workflow/prompts/00-global/G-04-interaction-accessibility.md`  
  键盘/手柄等价、focus scope、live region、五态和错误可读性。
- `attachmentId: presentation-animation-feedback-02`  
  `provenance: animation/audio/haptic separation, deterministic fallback and reduced motion`  
  feedback 来源和视觉/音效/触觉的降级边界。
- `attachmentId: frontend-implementation-09`  
  `provenance: Framer Motion, Radix, Zustand, Howler, lucide and shell wiring mapping`  
  技术库职责、音频 adapter、动效和组件接线。
- `attachmentId: governance-journey-11`  
  `provenance: title options, pause settings and full route context`  
  设置从标题/暂停/驻地/HUD 可达且返回来源保持不变。
- `attachmentId: governance-v0-shell-10`  
  `provenance: V0 shell preserves structure while mock data/callbacks are replaced by ports`  
  控制面板和接线纪律。

## 3 当前决策

- 设置面板至少包含：显示、声音、输入、无障碍、语言、图形；附加的 reduced-motion、字幕、播报详细度、触觉开关和性能表现属于对应分类，不新增第二套菜单。
- 设置面板可从 title、pause、residence 和 HUD 打开；使用同一 `GlobalSettingsPanel`，来源变化只影响返回触发器，不复制组件。
- `settings.preview` 只改变本地 preview draft 或通过表现 port 预览，不是持久保存；`settings.save` 等待端口确认；取消丢弃 draft 并恢复投影快照。
- global feedback 统一显示连接中、同步中、请求 pending、accepted、rejected、stale、timeout、资产缺失、音频不可用、reduced-motion 和安全返回原因。
- feedback 不阻断普通 route 输入，除非 projection 标记为 blocking error/safety confirmation；高优先级 feedback 由 B6-02 coordinator 仲裁。
- feedback 的文字/图标/live region 是必需通道，声音、震动、粒子和颜色只是附加通道；音频/震动不可用时静默降级。
- 设置和反馈数据均来自 `SettingsPort`/`GlobalFeedbackPort` 或并入 `UiPorts` 的稳定端口；UI 不读取浏览器/localStorage 作为业务真相。

## 4 状态机

```text
settings
  closed
    -> open-requested -> opening -> open
  open
    ├─ tab-select -> presenting
    ├─ field-change -> preview-draft
    ├─ preview-request -> preview-pending
    ├─ save-request -> save-pending
    ├─ cancel-request -> closing -> closed
    └─ projection-stale/error -> settings-error
preview-pending
  ├─ accepted -> preview-confirmed -> open
  ├─ rejected -> recoverable-error -> open
  ├─ stale -> resync -> open
  └─ timeout -> retry-or-cancel
save-pending
  ├─ accepted -> saved -> open
  ├─ rejected -> save-error -> open
  ├─ stale -> resync -> open
  └─ timeout -> unsaved-timeout -> open

feedback
  idle
    -> queued
    -> presenting
  presenting
    ├─ acknowledged -> settled
    ├─ merge-low-priority -> presenting
    ├─ timeout -> timeout-visible
    ├─ blocking -> blocking-error-overlay
    └─ dismiss -> dismissed
  settled/timeout-visible/dismissed -> idle
```

设置的 `preview-draft` 可以在本地存在，但只要 projection revision 改变就标记 stale 并要求重读。保存成功只能由 `ActionPort`/`SettingsPort` 结果确认，不能由按钮点击或控件改变触发。

## 5 组件树

```text
<GlobalSettingsAndFeedbackHost>
  ├─ <GlobalSettingsPanel>
  │  ├─ <SettingsHeader />
  │  ├─ <SettingsCategoryTabs />
  │  ├─ <DisplaySettingsSection />
  │  ├─ <AudioSettingsSection />
  │  ├─ <InputSettingsSection />
  │  ├─ <AccessibilitySettingsSection />
  │  ├─ <LanguageSettingsSection />
  │  ├─ <GraphicsSettingsSection />
  │  ├─ <SettingsPreviewRegion />
  │  └─ <SettingsActions />
  ├─ <GlobalFeedbackRegion>
  │  ├─ <ConnectionStatusRegion />
  │  ├─ <IntentStatusRegion />
  │  ├─ <AssetFallbackRegion />
  │  ├─ <AudioFallbackRegion />
  │  ├─ <BlockingFeedbackOverlay />
  │  └─ <PoliteFeedbackQueue />
  └─ <SettingsPortAdapter />
</GlobalSettingsAndFeedbackHost>
```

设置组件不导出业务 handler；它接收 `SettingsProjection` 和 `submit(intent)`。feedback 组件接收只读队列并调用 `acknowledge`/`dismiss` UI intent，不直接清理宿主状态。

## 6 只读数据

```ts
interface ReadonlySettingsProjection {
  readonly revision: string;
  readonly source: 'mock' | 'projection';
  readonly values: {
    readonly display: { readonly brightness: number; readonly scale: number };
    readonly audio: { readonly master: number; readonly music: number; readonly effects: number; readonly voice: number; readonly subtitles: boolean };
    readonly input: { readonly bindings: Readonly<Record<string, string>>; readonly gamepadEnabled: boolean };
    readonly accessibility: { readonly reducedMotion: boolean; readonly narration: boolean; readonly narrationDetail: 'low' | 'medium' | 'high'; readonly haptics: boolean; readonly textScale: number };
    readonly language: { readonly locale: string };
    readonly graphics: { readonly quality: 'low' | 'medium' | 'high'; readonly particles: boolean; readonly screenShake: boolean };
  };
  readonly availableIntents: readonly string[];
  readonly warnings: readonly string[];
}

interface ReadonlyGlobalFeedbackEntry {
  readonly id: string;
  readonly kind: 'connection' | 'intent' | 'asset' | 'audio' | 'accessibility' | 'route' | 'system';
  readonly status: 'loading' | 'pending' | 'accepted' | 'rejected' | 'stale' | 'timeout' | 'error' | 'info';
  readonly priority: 'blocking' | 'high' | 'normal' | 'low';
  readonly title: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly dismissible: boolean;
  readonly source: 'mock' | 'projection';
}
```

玩家可见设置数值须遵守全局玩家可见数值约束；音量/文字比例等表现配置是设置值，不得被 UI 解释成玩法数值。设置中的绑定 label、disabled reason、shortcut 和 announcement text 来自 projection/fixture。

## 7 动作意图

```ts
type SettingsFeedbackIntent =
  | { readonly kind: 'settings.open'; readonly source: 'title' | 'pause' | 'residence' | 'hud' }
  | { readonly kind: 'settings.select-category'; readonly category: 'display' | 'audio' | 'input' | 'accessibility' | 'language' | 'graphics' }
  | { readonly kind: 'settings.preview'; readonly key: string; readonly value: string | number | boolean }
  | { readonly kind: 'settings.save'; readonly revision: string }
  | { readonly kind: 'settings.cancel' }
  | { readonly kind: 'settings.reset-preview'; readonly category?: string }
  | { readonly kind: 'feedback.retry'; readonly feedbackId: string }
  | { readonly kind: 'feedback.dismiss'; readonly feedbackId: string }
  | { readonly kind: 'feedback.acknowledge'; readonly feedbackId: string }
  | { readonly kind: 'safe-return'; readonly source: 'settings' | 'feedback' };
```

输入、触控和快捷键全部调用同一 builder；调节 slider 时构造 preview intent，不直接写全局设置。`settings.save` 必须带当前 revision/requestId，stale 时停止成功演出并要求重同步。feedback dismiss 只关闭本地呈现，不表示宿主问题已解决。

## 8 本地 UI 状态

允许：当前 settings category/tab、preview draft、聚焦字段、键盘绑定编辑中的 source/target、dirty 标记、pending requestId、feedback queue 的视觉展开/折叠、toast 已读、live region 去重 token、reduced-motion 读取结果、局部动画阶段。

不允许：把 draft 写入持久业务 store、猜测 save accepted、以 slider 值改变 AP/HP/SP/回合/匹配/结算、用 dismiss 清除服务端错误、把浏览器偏好作为唯一真相。保存失败保留 draft 但标记未保存；revision 变化丢弃或要求确认覆盖，不静默覆盖新投影。

## 9 视觉令牌

- 设置使用与 route 一致的半透明全息面板，不变成白底 SaaS 表单；分类 tab 最多同时显示 5 个，超过内容分组或滚动。
- `pending` 橙色，`accepted` 绿色，`rejected/error` 红色，`stale` 灰白/黄色说明，`loading` 灰白轮廓，`blocking` 红色边缘与明确标题。
- 声音分类沿用全局混音语义但不把音量滑块画成玩法资源；字幕/播报/触觉开关使用文字和图标解释。
- reduced-motion 开关本身有 focus/active/disabled/return 五态；关闭粒子/抖动后保留语义色、文字和最终结果。
- 设置控件不依赖颜色：每个值有 label、当前值、单位/说明和可访问状态；缺失音频/资产用图标+文字 fallback。

## 10 动效绑定

- 设置从触发源方向以 Framer Motion 滑入，category 切换使用局部 `AnimatePresence`/layout，不重载 route、不移动玩家。
- slider preview 仅做局部高亮/微反馈；save pending 使用可停止的进度/旋转；accepted 才播放短确认，rejected/stale/timeout 使用回弹和原因。
- feedback queue 使用优先级布局和 `layout` 重排；低优先级合并同类消息，blocking feedback 进入 B6-02 overlay coordinator。
- 字幕/播报不以动画作为唯一信息；音效与触觉由 feedback adapter 在确认结果后触发，设备不支持时静默降级。
- reduced-motion 移除位移、弹簧、粒子和屏幕抖动，保留状态变色、不透明度、焦点和 live announcement。

## 11 输入无障碍

- Settings 使用 Radix Dialog/FocusScope；关闭后焦点返回 title/pause/residence/HUD 的原触发器。设置内 category、field、preview、save、cancel 有稳定 Tab 顺序。
- Slider 支持方向键、Home/End、PageUp/PageDown（若适用）、输入值朗读；不能只依靠拖拽。数值改变通过 `aria-valuetext` 说明。
- 输入重映射采用“选择来源→按下新键→确认/取消”的可键盘流程；冲突显示原因和恢复原绑定，不静默覆盖。
- live region 分层：连接/保存成功与失败、重同步和 blocking error 可 assertive；普通 preview、低优先级通知和音频降级 polite；同一消息去重。
- 文本放大/语言切换后焦点保持在同一语义控件；翻译缺失显示稳定 fallback，不显示空 label。
- 所有控件具备 hover/focus/active/disabled/return；禁用必须说明原因，反馈撤销不得让焦点落到消失节点。

## 12 加载错误超时

- settings projection 加载中显示 category skeleton 和“正在读取设置”，不显示默认值为已保存值；缺失 category 显示空态、重试和安全关闭。
- save/preview 请求的 rejected、stale、timeout、connection error 分开显示；重试携带新 requestId，不重复执行旧请求。
- audio unavailable 不阻塞 settings save；显示“音频反馈不可用，已保留文字/视觉反馈”。资产缺失保留容器和 assetId/语义名称。
- 输入冲突、非法范围和语言包缺失必须有具体原因；UI 不自行修正为成功值并宣称保存。
- feedback queue 超时/断线使用连接中、重试、取消、安全返回；队列满时合并低优先级，不丢失 blocking/high 消息。
- 全局端口断开时 settings 可读但标为 stale；用户可取消返回来源，不能把本地 preview 当持久设置。

## 13 明确不做

- 不实现设置持久化、账户同步、云存档、音频引擎、输入驱动器、语言翻译服务、图形质量编译器。
- 不直接调用 `localStorage`/后端 API/Howler 全局写入作为业务事实；Howler 只能由 audio adapter 按确认结果或本地预览策略消费。
- 不让反馈队列推进 route、暂停、匹配、战斗、结算或奖励；不把 toast 消失当成问题解决。
- 不在每个页面复制设置/feedback；不在设置面板中加入规则、装备、货币或玩法选项。
- 不把“恢复默认”实现成无确认的持久写入；不因 UI 想演示成功而绕过 ActionPort。

## 14 依赖交接

- B1 提供全局 Settings/Feedback portal 和统一 token；B6-03 提供组件与端口契约，不修改 B1。
- B6-02 提供 overlay priority/focus/input arbitration；blocking feedback 必须通过其 coordinator，不另建 modal。
- B2/B3/B5 只提供 source trigger 和 route surface；settings/feedback 组件保持一套实现。
- 真实接线方实现 `SettingsPort`、`GlobalFeedbackPort` 或 `UiPorts` 等价 adapter；mock adapter 的 projection/result 类型保持一致。
- Howler、Radix、Framer Motion、lucide 仅按既有职责接入；新增库或修改全局设置契约先登记交接项。
- 抽取时保留 `GlobalSettingsPanel`、`GlobalFeedbackRegion`、`SettingsPortAdapter`、intent builder 和结果态。

## 15 验收条件

- [ ] 从标题、暂停、驻地和 HUD 都能打开同一 settings surface，并正确回到来源。
- [ ] 设置覆盖显示、声音、输入、无障碍、语言、图形及 reduced-motion/字幕/播报/触觉；同屏分类不超过 5 个或有分组/滚动。
- [ ] preview/save/cancel/reset 都是 intent；save 的 accepted/rejected/stale/timeout 可演示，UI 不伪造持久化成功。
- [ ] global feedback 覆盖连接、请求、资产、音频、无障碍和安全返回状态，文字/live region 不依赖颜色或声音。
- [ ] 断线、空设置、缺失语言/资产/音频、输入冲突、保存超时都有 retry/cancel/safe-return。
- [ ] 键盘、触控、手柄、屏幕阅读器和 reduced-motion 路径可用，焦点不落入消失控件。
- [ ] mock→UI port 替换不改组件树、intent 名和 route；不实现规则或后端。

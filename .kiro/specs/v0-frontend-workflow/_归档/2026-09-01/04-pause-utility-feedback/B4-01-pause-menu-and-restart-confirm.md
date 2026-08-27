# B4-01 暂停菜单与重开/返回确认 Brief

## 1 页面定位

- 本 brief 定义 `menu-pause`：对局或世界活动中由 Esc 或等价输入触发的暂停覆盖层。它把正在运行的世界画面冻结并降饱和，从空间中浮现清晰的暂停菜单，并在继续时恢复同一画面。
- 本 brief 逐条遵守 G-01..G-08 的 UI-only、intent-only、素材允许、不用零素材口径、同屏不超过 5、不得写库或实现规则约束。
- 固定提供 `继续`、`设置`、`重新开始`、`返回标题` 四个入口；后两者先进入确认态，仅在确认后提交导航/重启类 intent。
- 暂停时本地呈现被打断、恢复、确认、取消和重试；规则事实、对局阶段、重新开始结果和返回标题结果都来自只读投影，UI 不本地扣任何状态。

## 2 权威来源

- attachmentId: `frontend-global-g01`
  provenance: `.kiro/specs/v0-frontend-workflow/prompts/00-global/G-01-project-and-scope-contract.md；页面边界、intent-only、UI-only、排除项`
- attachmentId: `frontend-global-g03`
  provenance: `G-03-ui-port-contract.md；StatePort/ActionPort/CadencePort、request/result 生命周期`
- attachmentId: `frontend-global-g04`
  provenance: `G-04-interaction-accessibility.md；Radix 弹层、Esc、焦点陷阱与归还`
- attachmentId: `frontend-global-g05`
  provenance: `G-05-motion-audio-fallback.md；结果重演、reduced motion`
- attachmentId: `frontend-global-g08`
  provenance: `G-08-page-and-batch-index.md；menu-pause 状态：paused/settings/restart-confirm/return-title-confirm`
- attachmentId: `frontend-motion-checklist`
  provenance: `presentation-motion-checklist-12；暂停与断线的降饱和/冻结母题`
- attachmentId: `frontend-batch-2-hud`
  provenance: `prompts/02-battle-hud.md；世界层与暂停共存的输入来源`

## 3 当前决策

- 暂停菜单以 Esc 打开，Esc 再按关闭；`继续`、`设置`、`重新开始`、`返回标题`均提交显式 intent，不直接导航或重启。
- 打开暂停 = 当前世界画面冻结（停止主动态、输入收敛到暂停层）并且画面整体降低饱和度；`继续` 关闭暂停并恢复同一画面、同一投影，不重建场景。
- `设置` 切换到设置面板（见 B4-02 生命周期）；从设置关闭时焦点回到暂停菜单入口。
- `重新开始` 与 `返回标题` 都必须先展示确认态；确认只提交对应 intent，取消/关闭回到暂停，不产生重启或返回动作。
- 对局进行中暂停是世界暂停覆盖；等待/匹配中暂停不锁死非冲突入口，命中交互由 B4-05/全局输入仲裁约束。
- 允许挂接暂停菜单的既有素材或程序化双层光层；`menu-pause` 是覆盖层不是独立场景，不得做成全屏加载页或网页设置页。

## 4 状态机

```text
world-active
  └─ esc-pause-intent → pausing-overlay
pausing-overlay
  ├─ frozen + desaturated → menu-pause
  │   ├─ pause.continue → resuming → world-active
  │   ├─ pause.open-settings → settings-view
  │   ├─ pause.confirm-restart-request → restart-confirm
  │   └─ pause.confirm-return-title-request → return-title-confirm
  ├─ intent-pending → intent-pending
  │   ├─ accepted → result-rendered
  │   ├─ rejected → error-recoverable → menu-pause
  │   ├─ timeout → stale-or-retry
  │   └─ resync → pausing-overlay
  └─ close → closing-overlay → world-active
restart-confirm / return-title-confirm
  ├─ confirm → pending → accepted → route-transition
  ├─ cancel / esc → back-to-menu-pause
  └─ error → error-recoverable
```

- `resuming` 只在 pause.continue 被 accepted 后进入；本地取消动画不能代表世界已恢复。
- `restart-confirm` 与 `return-title-confirm` 不共享确认结果；各自有独立 request 和结果渲染。
- 任何 pending 都不是 accepted；投影更新前不播放路由/重启演出。

## 5 组件树

```text
OverlayStackCoordinator
└─ PauseMenuSurface          (menu-pause)
   ├─ WorldFreezeBackdrop     (desaturate 蒙版 + original 画面保留)
   ├─ PauseMenuPanel
   │  ├─ ResumeEntry
   │  ├─ OpenSettingsEntry
   │  ├─ RestartEntry → RestartPendingButton
   │  └─ ReturnToTitleEntry → ReturnTitlePendingButton
   ├─ ConfirmationLayer
   │  ├─ RestartConfirmDialog
   │  ├─ ReturnTitleConfirmDialog
   │  └─ ConfirmationIntentButtons
   └─ IntentFeedbackRegion    (pending / accepted / rejected / timeout)
```

## 6 只读数据

```ts
interface PauseProjection {
  readonly source: 'mock' | 'projection';
  readonly revision: number;
  readonly worldSnapshot: { readonly frozen: boolean; readonly desaturated: boolean };
  readonly state: 'paused' | 'settings' | 'restart-confirm' | 'return-title-confirm' | 'world-active';
  readonly allowedIntents: readonly string[];
  readonly confirmations: {
    readonly restartRequired: boolean;
    readonly returnTitleRequired: boolean;
  };
}
interface IntentResult {
  readonly requestId: string;
  readonly status: 'accepted' | 'rejected' | 'stale' | 'timeout';
  readonly reason?: string;
  readonly nextRevision?: number;
}
```

- 冻结、降饱和、确认需求、允许的 intent 都是只读投影字段；本地不回写世界状态。
- 示例工作流字段与结果标注 `source: "mock"`。

## 7 动作意图

```ts
type PauseUiIntent =
  | { readonly kind: 'pause.open' }
  | { readonly kind: 'pause.continue' }
  | { readonly kind: 'pause.open-settings' }
  | { readonly kind: 'pause.request-restart' }
  | { readonly kind: 'pause.confirm-restart'; readonly requestId: string }
  | { readonly kind: 'pause.request-return-title' }
  | { readonly kind: 'pause.confirm-return-title'; readonly requestId: string }
  | { readonly kind: 'pause.cancel-confirm' }
  | { readonly kind: 'pause.close' }
  | { readonly kind: 'pause.retry'; readonly requestId: string };
```

- `pause.confirm-restart` 与 `pause.confirm-return-title` 只在确认态发布；`pause.cancel-confirm` 只在确认态可用。
- 禁止在 `onSelect` 中调用重启、导航、存档、LoadScene 或规则提交。

## 8 本地 UI 状态

- 允许的本地状态：菜单打开/关闭动画阶段、确认对话框打开态、`pendingRequestId`、当前焦点项、选中入口、暂停计时、降饱和过渡阶段、reduced-motion 偏好。
- 不持有或推断：真实重启结果、真实返回标题结果、世界阶段、存档位、匹配事实。
- 关闭菜单后丢弃悬挂的本地 pending，重新读取投影 revision。

## 9 视觉令牌

- 暂停时世界整体降饱和：`filter: saturate(.35) brightness(.9)`，并保留画面边缘轻微暗角；`menu-pause` 覆盖层使用半透明暗调 + 边缘发光。
- 语义色沿用 G-02：半透明面板断边/斜切，交互项悬停边缘发光，pending 橙色、rejected/error 红色、stale 灰白/黄色说明、accepted 绿色/语义结果。
- `重新开始` 与 `返回标题` 的确认态使用红/黄警示语义和一个可读原因，不使用让玩家误以为会立即执行的强视觉钩子。
- 允许程序化光层、全息投影背景和已登记素材进入层前背景；不用白底表单、网页 modal 或标准圆角卡片栅格。

## 10 动效绑定

- 打开 = 世界画面快速进入降饱和冻结 + 菜单从空间轮廓显影；继续 = 菜单余辉淡出，世界饱和度恢复。
- 确认对话框用 `AnimatePresence` 短促展开；重开/返回的成功演出只在该 intent 被 accepted 后播放，跳过/取消不改位置与结果。
- 焦点移动使用轻微位移/发光；reduced-motion 下移除降饱和过渡的位移和粒子，保留状态的文字与顺序。
- 动画只重演冻结/恢复/确认/路由的投影结果，不以本地动画代替业务返回。

## 11 输入无障碍

- Esc 打开/关闭；Enter/Space 激活当前项；↑/↓ 或 Tab 在四入口间移动；执行确认按钮用 Enter，取消用 Esc。
- 菜单打开时焦点进入第一个入口，关闭时焦点回到触发源；确认对话框进入其焦点陷阱，确认/取消/关闭后归还原入口。
- 停顿、降饱和、确认、pending、rejected 都通过 live region 或 `aria-live` 播报；菜单标题和每个入口有可读名称与状态。
- 手柄、键盘、触控、读屏等价；颜色不是唯一信息，`重新开始`/`返回标题`均有文字原因和图标。

## 12 加载错误超时

- 暂停投影加载中显示带标题的 skeleton 或「正在打开暂停（mock）」，不伪造已暂停。
- confirm intent 失败：显示 rejected/timeout 原因和 `pause.retry`、`pause.cancel-confirm`；重试只重发该 intent，不重复导航。
- 版本过期或 resync：丢弃过期选择，重新读取 revision；本地动画不覆盖投影阶段。
- 返回标题或重启请求超时：显示「请求未确认/超时（mock）」和安全回到暂停；不把失败伪装成路由成功。

## 13 明确不做

- 不实现真实重启、真实返回标题、存档写入、场景装载、设置持久化或对局规则结算。
- 不做第二套暂停/状态权威，不做全屏 loading 页、网页后台或单按钮菜单墙。
- 不渲染编辑器、研究台、素材库、电脑内部 UI；不实现地图、拓扑、寻路、ORCA 或路径成本。
- 不以零素材、无语义方块或错误素材代替菜单层素材；不删除素材挂载位。
- 不让暂停动画、确认倒计时或声音暗示业务已生效。

## 14 依赖交接

- 依赖 B1 的 AppShell、`menu-pause` 挂载点、全局 token、快捷注册和退出协议。
- 依赖 B2 的 `hud-main` 世界层与输入来源；B4-01 只提交 `pause.*` intent 和投影消费。
- 向 B4-02 交接 `pause.open-settings`、设置面板挂载点、焦点归还入口和状态结果槽。
- 向 B4-05 交接暂停层 z-index 与输入仲裁；向 B6 交接全旅程路由的可恢复失败分支。
- 素材经 manifest/`assetRef` 挂接；本 brief 不修改其他目录的契约或素材。

## 15 验收条件

- [ ] 世界画面在被暂停时确实冻结并降饱和；继续/关闭恢复同一画面和投影，不重建场景。
- [ ] 四入口可见可聚焦；`重新开始` 与 `返回标题` 都先展示确认态，确认/取消/关闭行为一致。
- [ ] pending/rejected/timeout/stale/accepted 均有可见可恢复反馈；不会把请求发出当作已重启/已返回。
- [ ] Esc、Enter/Space、方向键、手柄、触控和读屏路径等价；焦点陷阱与归还正确。
- [ ] 暂停菜单保持游戏内浮层语言；不使用白底表单、网页 modal 或零素材方案。
- [ ] 相关 TypeScript、Vitest、lint 和文档术语门禁按仓库要求可运行。
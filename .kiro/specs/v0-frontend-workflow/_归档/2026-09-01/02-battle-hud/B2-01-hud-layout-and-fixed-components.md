# B2-01 HUD Layout and Fixed Components

## 1. 页面定位

本 brief 定义 `hud-main` 的固定空间骨架、固定组件与三种 HUD 变体。它把全屏游戏世界作为环境承载，HUD 作为透明附着层：环境层 → 实体层 → 事件层 → HUD 层 → 仪式/错误层。中央世界必须可辨识，即使地图数据是 mock，也要有低饱和全息光层、像素实体、落地阴影、空间落点和事件舞台。

`standard` 是完整对局节奏；`solo` 是同一对局的单人呈现，不竞争轮次但保留必要状态；`minimal` 只用于不允许战斗的少 UI 情境，不能作为战斗中的“更简 HUD”。页面只消费只读投影，所有控制都是 intent 或本地视觉状态。

## 2. 权威来源

- `presentation-ui-authority` / `docs/表现系统/01_图形化与UI.md`：轮次栏 D-036、回合、资源格、固定组件、观战和响应式。
- `presentation-elements-baseline` / `docs/表现系统/04_画面要素文档.md`：1080p 布局地平线、常驻 UI、物品栏和层级。
- `frontend-workflow-design` / `.kiro/specs/v0-frontend-workflow/design.md`：`battle-hud` 页面目录与固定组件边界。
- `frontend-visual-tokens` / `00-global/G-02-visual-token-contract.md`：颜色语义、素材、材质和分层。
- `frontend-accessibility` / `00-global/G-04-interaction-accessibility.md`：五态、焦点、输入等价。
- `frontend-port-contract` / `00-global/G-03-ui-port-contract.md`：只读 snapshot、intent 与结果态。
- `hud-legacy-baseline` / `prompts/02-battle-hud.md`：旧 HUD 固定组件内容，已被本 brief 吸收并按当前约束收口。
- `hud-visual-quality-addendum` / `prompts/02-battle-hud-visual-quality-addendum.md`：世界先于面板、反网页感硬门禁，已被本 brief 吸收。

## 3. 当前决策

- 左侧 `fixed-turn-spine` 是纵向空间装置，不是表格。按行动轮显示排名、头像、名字、HP 红 5 格、SP/清醒蓝 5 格；最多按项目数据容量展示，视口不挤压世界。
- 当前行动者使用反光材质、局部层级和清晰文字高亮；玩家自身轮次框比他人更宽更粗约一个骰子宽度。已行动者保留在列表中，只降饱和，不删除、不加叉、不加“已完成”网页标签。
- 顶部 `fixed-turn-header` 是局部悬浮锯齿徽章，显示「回合 N｜阶段｜当前行动方」；自己行动时显示「你的回合！剩余 AP」；NPC 阶段使用明确阶段文本。
- `fixed-ap-badge` 显示橙色 AP 离散格/徽标并标注 mock 或 projection 来源；`fixed-buff-zone`、`fixed-status-zone`、`fixed-weakness-icon` 只显示投影已给的状态，不实现效果、持续或创建/移除逻辑。
- `fixed-inventory-slots` 固定为 2 手 + 2 格的展示槽位，出生空手全空；`fixed-encumbrance-tag` 只显示投影给出的「重装」来源和提示，不本地增加成本；`fixed-leave-entry` 提供退出与设置 intent。
- `standard` 显示完整轮次脊柱和固定组件；`solo` 不移动/竞争轮次但突出玩家状态；`minimal` 折叠 HUD 为必要文本与局部交互图标，只在非战斗表现配置中使用。变体切换是 presentation variant，不是玩法权限。
- 固定组件和素材不要求零素材：头像、物品、弱点、角色可用合法登记 `assetRef`；缺失时保留组件位并显示可读 fallback。

## 4. 状态机

```text
hud-unmounted
  -> world-loading
  -> world-ready
  -> fixed-components-entering
  -> hud-ready

hud-ready
  -> standard
  -> solo
  -> minimal
  -> intent-pending
  -> stale
  -> error

standard <-> solo
hud-ready -> result-or-safe-return
world-loading -> asset-fallback | projection-error | timeout
projection-error | timeout -> retrying | safe-return
```

每个固定控制都闭合 `base → hover/focus → active → return`，不可操作项进入 `disabled`；`disabled` 不因 hover 变成可提交。projection revision 变化触发 `layout` 重排，不能用本地状态伪造轮次、资源或变体事实。

## 5. 组件树

```text
BattleHudRoot
├─ WorldPresentationLayer
│  ├─ HolographicEnvironmentLayer
│  ├─ PixelEntityLayer
│  ├─ GroundShadowLayer
│  └─ AssetFallbackLayer
├─ EventStageLayer
│  ├─ CurrentActorAnchor
│  ├─ TargetRelationLayer
│  └─ LocalDiceStagePort
├─ HudLayer
│  ├─ FixedLeaveEntry
│  ├─ FixedTurnHeader
│  ├─ FixedTurnSpine
│  │  └─ TurnParticipantRow
│  │     ├─ RankBadge
│  │     ├─ PortraitAsset
│  │     ├─ ParticipantLabel
│  │     ├─ HpFiveCells
│  │     ├─ StaminaFiveCells
│  │     ├─ FixedBuffZone
│  │     └─ FixedStatusZone
│  ├─ FixedCurrentActor
│  ├─ FixedApBadge
│  ├─ FixedInventorySlots
│  ├─ FixedEncumbranceTag
│  ├─ FixedWeaknessIconLayer
│  └─ ActionHandMount
├─ IntentStatusRegion
└─ LiveAnnouncementRegion
```

`fixed-weakness-icon` 位于实体头顶而非卡片内部；`fixed-buff-zone` 与 `fixed-status-zone` 可随轮次行或当前实体附着，但不得平均铺成 dashboard 栏目。固定组件不能创建第二套路由或业务 store。

## 6. 只读数据

```ts
interface HudLayoutProjectionMock {
  readonly source: 'mock' | 'projection';
  readonly revision: string;
  readonly pageId: 'hud-main';
  readonly variant: 'standard' | 'solo' | 'minimal';
  readonly round: { readonly number: number; readonly phase: 'roll' | 'player-action' | 'npc' | 'cleanup'; readonly currentActorId: string | null };
  readonly participants: readonly {
    readonly id: string;
    readonly rank: number;
    readonly label: string;
    readonly hp: number;
    readonly stamina: number;
    readonly acted: boolean;
    readonly eliminated: boolean;
    readonly portraitRef?: string;
    readonly weaknessRef?: string;
    readonly mock?: true;
  }[];
  readonly currentPlayer: { readonly id: string; readonly ap: number; readonly inventory: readonly { readonly slot: string; readonly assetRef?: string }[]; readonly mock?: true };
  readonly buffs: readonly { readonly id: string; readonly label: string; readonly turnsLabel?: string; readonly polarity: 'positive' | 'negative' | 'neutral'; readonly iconRef?: string }[];
  readonly statuses: readonly { readonly id: string; readonly label: string; readonly semantic: 'positive' | 'cooldown' | 'constraint' | 'damage'; readonly iconRef?: string }[];
  readonly encumbrance?: { readonly label: string; readonly sourceLabel: string };
  readonly assets: readonly { readonly assetRef: string; readonly state: 'loading' | 'ready' | 'missing' }[];
}
```

`hp`、`stamina`、`ap` 只用于渲染投影值，不由组件递减或计算。五格资源显示来自投影；禁止把动作点击、本地动画或 `acted` 的视觉变化写回 snapshot。

## 7. 动作意图

- `hud.leave-request`：点击退出入口，提交离开请求；不强退、不本地跳转。
- `hud.open-settings`：打开宿主设置 surface；焦点返回触发点。
- `hud.switch-variant`：仅请求 presentation variant 切换；不改变规则或权限。
- `hud.focus-participant`：聚焦/查看公开参与者信息；不修改目标或轮次。
- `hud.inspect-weakness`：打开弱点补充说明；不执行侦察、不消耗 AP。
- `hud.inspect-inventory-slot`：打开槽位详情；不使用、丢弃或交换物品。
- `hud.dismiss-status` / `hud.close-local-detail`：关闭本地详情并回收焦点。

所有 intent 通过同一个 ActionPort，UI 显示 `pending / accepted / rejected / stale / timeout`。固定组件只构造请求，不调用规则函数。

## 8. 本地 UI 状态

允许保存：当前变体视觉选择、轮次行焦点、固定组件 hover/focus/active/return、展开的 buff/status/inventory detail、局部素材 loading 状态、动画阶段、面板安全区、reduced-motion 偏好和当前 pending requestId。

不允许本地保存或推断 HP、SP、AP、排名、当前行动者、buff 持续、装备事实、淘汰事实或回合推进。projection revision 变化时清掉过期局部选择，接受新快照后再做空间重排。

## 9. 视觉令牌

- 环境层以低饱和、半透明、暖/冷全息光承载空间；实体层使用清晰像素剪影、合法素材、像素缩放与落地阴影；事件层使用局部高光、关系线和移动来源/落点。
- `fixed-turn-spine` 使用悬浮脊柱/盾形或断边勋章几何；回合徽章使用锯齿/缺口几何；资源使用离散像素格；不要把所有组包装成相同圆角矩形。
- 红=HP/危险，蓝=SP/清醒，橙=AP/进行中，绿=正面/安全，紫=约束/远程，珊瑚=近战，灰=冷却/不可用，灰白=受限但可交互。正面 buff 绿边，负面且实际危险红边，约束紫边，冷却灰边。
- 交互对象必须有边缘光、高光、材质或凸起；不可用对象扁平、无高光并有文字原因。焦点环不得被 `clip-path` 裁切。
- 素材位优先使用 manifest 登记的头像、角色、物品和弱点帧。组件背景不得把素材拉伸成 9-slice 贴边；缺失时用同语义轮廓/图标/文字 fallback。

## 10. 动效绑定

- 世界层先稳定，实体层错峰进入，事件层随后，HUD 固定组件最后附着；使用 `AnimatePresence`，避免所有元素同时弹入。
- 轮次排名使用 `layout` / `layoutId`，当前行动者空间迁移保留来源与落点；HP/SP 格填充使用 `useSpring` / `useTransform` 只表现已确认 snapshot 变化。
- 变体切换使用同一舞台的 `AnimatePresence + layout`，不整页闪现；AP 耗尽只表现投影已确认的降饱和与零费入口。
- hover/focus/tap 只提供局部触感；状态结果动画在 accepted 或新 projection 后触发，rejected/stale/timeout 用回弹、降光和原因文本，不播放成功演出。
- reduced motion 保留固定组件顺序、当前行动者、资源格和文字结果，缩短位移/闪烁/粒子。

## 11. 输入无障碍

- `fixed-turn-spine` 使用可访问列表/列表项语义；每行读出排名、名字、HP/SP 格数、当前行动/已行动/淘汰状态和数据来源。屏幕阅读器不读出不存在的隐藏招架状态。
- Tab 顺序遵循任务：退出/设置 → 回合状态 → 当前行动者与公开参与者 → 当前可用动作 → 物品/状态详情 → intent 结果。不可用项可被辅助技术识别为 disabled 并读出原因。
- Enter/Space 激活相同 intent；方向键在轮次行/槽位内移动；Esc 关闭局部详情并回到触发点；手柄 confirm/cancel 与键盘一致。
- 触控使用点击/长按替代 hover；文字、图标、材质和 aria label 同时表达状态，不能依赖颜色。live region 宣布回合变化、连接错误、淘汰和请求结果，但不逐个播报粒子。
- 退出或设置打开后焦点进入对应 surface，关闭后归还 `fixed-leave-entry` 的触发点；放大文字时组件重排，不裁切关键状态。

## 12. 加载错误超时

- 世界/固定组件 loading 显示轮廓态和「对局 HUD 加载中（mock）」；不伪造参与者或资源结果。
- assetRef missing 保留原组件位置，显示可读名称、`assetRef` 诊断和语义轮廓；不得静默换成另一实体素材。
- snapshot timeout / error 显示局部错误层，保留已知世界与最后确认 HUD；提供 retry、cancel 或 safe-return intent，不停留无限 spinner。
- revision stale 丢弃本地 focus/selection，显示「数据已更新，请重新选择」并重读 snapshot；不把旧排名、AP、buff 或当前行动者继续当新事实。
- intent rejected 显示原因并回到基线；网络断开交接给 `connection-status`，固定 HUD 不自行宣称重连成功。

## 13. 明确不做

- 不实现轮次排序、AP/SP/HP 结算、buff/status 效果、背包交换/使用/丢弃、负重成本或弱点判定。
- 不实现地图、节点、路径、碰撞、ORCA、NPC 决策、淘汰或胜负规则；世界只承担可读视觉空间。
- 不把固定组件做成通栏顶栏、侧栏表格、统一卡片网格或不透明 dashboard；不使用 9-slice 边框图。
- 不把 `minimal` 变体用于战斗，也不把 `solo` 当作规则模式；不在本组件树中创建第二套路由、OpRegistry 或业务 store。
- 不删除登记素材位，不以“无素材占位”作为完成标准。

## 14. 依赖交接

- 依赖 B1 提供 AppShell、`hud-main` 挂载、全局 token、Radix 原语、intent adapter 和焦点管理。
- 依赖 B2-03 提供轮次/投点舞台；依赖 B2-02 提供行动卡挂载位；依赖 B2-04 提供连接、淘汰、观战和结果状态。
- 交给 B3/B6 的只读端口包括当前 HUD 页面、离开/设置 intent、结果继续和 `safe-return`；不修改 B3/B6 文件或内部接口。
- 素材通过 `assetRef`/manifest 交接；前端只负责装载状态与 fallback，不生产贴图、不修改素材目录。

## 15. 验收条件

- [ ] 中央区域首先可读为有空间的游戏世界；HUD 半透明附着，不封闭成三栏后台。
- [ ] standard/solo/minimal 差异可演示，minimal 不出现在战斗中；左侧轮次脊柱、顶部回合、当前行动者和所有固定组件位置清楚。
- [ ] 轮次行含排名、头像/名字、HP 5 格、SP 5 格；当前行动者反光高亮，玩家行更突出，已行动者只降饱和且保留。
- [ ] buff/status/weakness/AP/inventory/encumbrance/leave 组件只展示投影状态，出生物品槽为空，素材缺失有语义 fallback。
- [ ] 固定控件五态、键盘/手柄/触控/读屏等价；焦点不丢失，live region 可读出结果和错误。
- [ ] loading、asset missing、rejected、stale、timeout、error、safe-return 可演示且不伪造规则事实。
- [ ] 不存在 dashboard、统一卡片汤、9-slice、OpRegistry 或本地规则计算。

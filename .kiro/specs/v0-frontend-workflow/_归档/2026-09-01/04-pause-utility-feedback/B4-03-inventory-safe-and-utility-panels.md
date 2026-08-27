# B4-03 背包、保险箱与匹配工具面板 Brief

## 1 页面定位

- 本 brief 定义三个 utility surface：`utility-inventory` 背包、`utility-safe` 保险箱收藏室、`utility-match` 匹配/影子大厅面板。它们是依附世界或驻地的悬浮工具面板，不是网页仓库、独立大厅或规则执行器。
- 本 brief 逐条遵守 G-01..G-08 的 UI-only、intent-only、素材允许、不用零素材口径、同屏不超过 5、不得写库或实现规则约束。
- 背包强调槽位与物品详情的只读呈现，保险箱强调高价值/纪念对象的陈列与回看，匹配面板强调异步状态、可继续活动和影子在场；职责三者不混同。
- 所有数据来自只读投影，所有使用/交换/取消/重试/关闭动作走显式 intent；不实现物品写库、拥有权更新、匹配算法或真实服务器协议。

## 2 权威来源

- attachmentId: `frontend-global-g01`
  provenance: `G-01-project-and-scope-contract.md；UI-only、utility scope 和排除项`
- attachmentId: `frontend-global-g03`
  provenance: `G-03-ui-port-contract.md；StatePort/ActionPort/CadencePort 与 intent result`
- attachmentId: `frontend-global-g04`
  provenance: `G-04-interaction-accessibility.md；拖拽键盘替代、ContextMenu、焦点归还`
- attachmentId: `frontend-global-g05`
  provenance: `G-05-motion-audio-fallback.md；列表重排、回弹、素材降级`
- attachmentId: `presentation-ui-authority`
  provenance: `presentation-ui-01；物品栏 4/6 槽位、快捷键、输入等价与 z-index`
- attachmentId: `operations-safe-library`
  provenance: `operations-safe-library-04；保险箱=收藏陈列、书架/仓库职责不可混同`
- attachmentId: `frontend-residence-flow`
  provenance: `B3-00/B3-02；异步匹配、影子大厅、不重载驻地和可继续活动`
- attachmentId: `frontend-global-g08`
  provenance: `G-08-page-and-batch-index.md；utility-inventory/utility-safe/utility-match pageId 和状态`

## 3 当前决策

- 背包出生态为空手：4 槽由 2 手 + 2 背包格构成；扩展态最多 6 槽。槽位数是结构展示，不由 UI 计算拥有量或容量规则。
- 物品点击打开详情；拖拽用于交换位置，非法落点回原位并说明；右键/长按打开 `使用`、`丢弃`、`检查` 占位菜单。占位动作只提交 intent，不改变投影。
- 保险箱是高价值/纪念对象的抽屉式陈列：左侧类别栏、中央陈列、右侧详情/大图；不放材料垃圾，不提供批量整理/删除，不伪装成背包。
- 匹配面板覆盖 `preparing`、`pending`、`cancelled`、`timeout`、`ready`、`shadow`；匹配期间显示玩家可继续非冲突活动，不重载场景。
- 匹配完成、床门控和影子参与者事实由 B3 投影提供；B4 只展示，不替换 `targetBed`，不把本地 pending 当 ready。
- 允许使用物品图、收藏图、影子素材和 manifest 资产；缺失时保留槽位/陈列位/影子语义与文字，不用零素材口径。

## 4 状态机

```text
inventory-closed → inventory-opening → inventory-ready
inventory-ready
  ├─ slot-focus → item-detail
  ├─ drag-start → drag-preview → valid-drop | invalid-drop → inventory-ready
  ├─ context-open → context-intent-pending → accepted | rejected | timeout
  └─ close → inventory-closed

safe-closed → safe-opening → safe-browse
safe-browse
  ├─ category-change → safe-browse
  ├─ select-entry → safe-detail
  ├─ safe-use → intent-pending → accepted | rejected | timeout
  └─ close → safe-return

match-closed → preparing → pending
pending
  ├─ continue-roam → pending
  ├─ ready → shadow-or-bed-ready
  ├─ cancel → cancel-pending → cancelled
  ├─ timeout → timeout-recoverable
  └─ error → error-recoverable
shadow-or-bed-ready → close → prior-world-state
```

- 非法拖拽不进入 accepted；它只进入 `invalid-drop` 视觉回弹并回到投影槽位。
- `utility-match` 的 `ready`、`shadow` 和床可用结果严格来自投影，不由面板本地推进。

## 5 组件树

```text
UtilityPanelCoordinator
├─ InventoryUtilityPanel       (utility-inventory)
│  ├─ InventoryHeader
│  ├─ EquipmentSlots
│  ├─ InventorySlots max=6
│  ├─ ItemDetailPopover
│  ├─ DragPreviewLayer
│  ├─ InventoryContextMenu
│  └─ InventoryIntentRegion
├─ SafeUtilityPanel            (utility-safe)
│  ├─ SafeHeader
│  ├─ SafeCategoryRail
│  ├─ SafeDisplayDrawer
│  ├─ SafeEntry maxVisible=5
│  ├─ SafeDetailPanel
│  └─ SafeIntentRegion
└─ MatchUtilityPanel           (utility-match)
   ├─ MatchStatusRibbon
   ├─ ContinueActivityHint
   ├─ CancelMatchControl
   ├─ MatchTimeoutRecovery
   ├─ ShadowLobbyPreview
   └─ MatchIntentRegion
```

## 6 只读数据

```ts
interface UtilityProjection {
  readonly source: 'mock' | 'projection';
  readonly revision: number;
  readonly inventory: {
    readonly capacity: 4 | 6;
    readonly slots: readonly InventorySlot[];
    readonly selectedSlotId: string | null;
  };
  readonly safe: {
    readonly categories: readonly string[];
    readonly entries: readonly SafeEntry[];
  };
  readonly match: {
    readonly state: 'preparing' | 'pending' | 'cancelled' | 'timeout' | 'ready' | 'shadow' | 'error';
    readonly reason?: string;
    readonly participantCount?: number;
    readonly targetBed?: 'bed-a' | null;
  };
}
interface InventorySlot { readonly slotId: string; readonly itemId: string | null; readonly assetRef?: string; readonly mock: true; }
interface SafeEntry { readonly id: string; readonly category: string; readonly title: string; readonly assetRef?: string; readonly canUse: boolean; readonly mock: true; }
```

- `canUse`、`capacity`、`targetBed`、`participantCount` 和状态都来自投影；UI 不自行计算或更新。
- `participantCount` 只有在投影明确 fresh 时可显示数量；stale/unavailable 显示“暂不可确认”，不显示空大厅。

## 7 动作意图

```ts
type UtilityUiIntent =
  | { readonly kind: 'inventory.open' }
  | { readonly kind: 'inventory.close' }
  | { readonly kind: 'inventory.select-slot'; readonly slotId: string }
  | { readonly kind: 'inventory.swap-slots'; readonly fromSlotId: string; readonly toSlotId: string }
  | { readonly kind: 'inventory.context'; readonly slotId: string; readonly action: 'use' | 'drop' | 'inspect' }
  | { readonly kind: 'inventory.cancel-drag' }
  | { readonly kind: 'safe.open' }
  | { readonly kind: 'safe.close' }
  | { readonly kind: 'safe.category'; readonly category: string }
  | { readonly kind: 'safe.select-entry'; readonly entryId: string }
  | { readonly kind: 'safe.use'; readonly entryId: string }
  | { readonly kind: 'match.open' }
  | { readonly kind: 'match.cancel' }
  | { readonly kind: 'match.retry' }
  | { readonly kind: 'match.close' };
```

- 背包鼠标拖拽、触控长按、键盘选择来源→目标→确认统一生成 `inventory.swap-slots`。
- `safe.use`、`match.cancel`、`match.retry` 只提交意图；不直接调用物品、收藏或匹配业务函数。

## 8 本地 UI 状态

- 背包：当前焦点槽、选中详情、拖拽中的来源/预览落点、上下文菜单开关、非法落点回弹、`pendingRequestId`。
- 保险箱：当前类别、选中条目、详情开关、抽屉展开阶段、焦点和素材加载态；不本地排序权威收藏，不持有删除/拥有状态。
- 匹配：面板开关、提示展开、重试 pending、焦点和 shadow preview 动画阶段；不本地推进 `pending → ready`。
- 本地状态可丢弃；投影 revision 变化时丢弃过期选择并重读。

## 9 视觉令牌

- 背包使用槽位材质、暗底、灰白可交互高光；空槽显示可读「空」而不是无语义方块。非法落点使用红色回弹，pending 使用橙色。
- 保险箱使用金/银少量高光表达收藏质感，类别语义沿用既有 token；拒绝堆叠材料、垃圾和统一卡片墙。详情保留大图和 `assetRef` fallback。
- 匹配状态：橙=进行中、绿=已确认/可继续、灰=延迟/取消、红=错误、白/灰白=影子轮廓。每种状态同时显示文字和图标。
- 面板依附世界背景，使用半透明断边、局部阴影、语义边缘光；允许已登记物品/收藏/影子素材，不用“没有素材”作为视觉方案。

## 10 动效绑定

- 背包槽位交换使用 Framer Motion `layout` 列表重排；有效交换只在 projection accepted 后播放最终落位，非法落点使用震动回弹回原槽位。
- 保险箱打开使用抽屉式滑入/轮廓显影；详情从选中条目附近展开，关闭回到触发条目；素材缺失收敛到同一语义容器。
- 匹配面板使用状态 ribbon 轻呼吸；影子只叠加半透明轮廓，不创建新场景；取消/超时使用状态条回收与可读错误。
- reduced-motion 下去除位移/粒子，保留列表顺序、选中结果、文字和焦点。

## 11 输入无障碍

- Tab 按视觉职责遍历面板；Enter/Space 激活槽位、详情、分类和控制；Esc 关闭当前最上层菜单/详情；方向键在槽位和分类内移动。
- 拖拽必须提供键盘等价：选中来源 → 选择目标 → 确认或取消；右键提供 ContextMenu 键、Shift+F10 或触控长按等价。
- 背包空槽、禁用操作、非法落点、保险箱不可用条目、匹配 pending/timeout 都有 `aria-describedby` 原因；颜色不是唯一信息。
- 面板打开后焦点进入首个可用控件；关闭、取消或错误恢复后焦点回到触发对象；live region 宣布交换结果、匹配状态和错误。
- 同屏收藏列表最多 5 条；背包槽位是固定结构展示，不把 6 个槽位当作可比较长列表。

## 12 加载错误超时

- 背包投影加载中显示槽位轮廓和「正在加载背包（mock）」；不显示伪造物品。
- 素材失败保留槽位/收藏/影子实体语义，显示图标、名称和可读 fallback；不得静默换成错误素材。
- 背包交换/保险箱使用 intent 被拒绝或超时显示原因、重试/取消；本地预览回到投影稳定状态。
- 匹配超时显示「匹配超时（mock）」、重试、取消和继续活动/安全返回；影子 relay stale 显示“状态暂不可确认”，不显示空成功大厅。

## 13 明确不做

- 不实现物品拾取、使用、丢弃、交换写库，不实现保险箱收藏写入、删除、批量整理、带入对局或材料仓库。
- 不实现真实匹配算法、队列、服务器协议、影子同步、床门控或重连退避；只消费 B3 投影。
- 不把背包/保险箱/匹配做成统一 dashboard、网页滚动条、独立大厅或第二套路由。
- 不实现编辑器、研究台、素材库、电脑内部页面；不实现地图节点、拓扑、寻路、ORCA、路径成本和规则。
- 不以零素材完成验收，不删除素材挂载位，不用错误语义资产替代缺失资产。

## 14 依赖交接

- 依赖 B1 的 utility 挂载点、全局 token、Radix 原语和控制面板抽取边界。
- 依赖 B3 的匹配/影子/床目标只读投影；B4 不复制 B3 状态机或修改驻地契约。
- 向 B4-04 交接 utility 面板 z-index、通知/字幕共存和同屏≤5 约束；向 B4-05 交接匹配超时/连接错误入口。
- 向 B6 交接 `inventory.*`、`safe.*`、`match.*` intent、错误结果、焦点恢复和输入仲裁需求。

## 15 验收条件

- [ ] 背包可演示空手 4 槽、扩展 6 槽、详情、拖拽交换、非法落点回弹、右键/键盘等价且无本地写库。
- [ ] 保险箱可演示类别陈列、抽屉质感、详情大图、可用占位 intent、关闭回驻地；不呈现材料仓库语义。
- [ ] 匹配面板可演示 preparing/pending/ready/shadow/cancelled/timeout/error；匹配时说明可继续活动且不重载场景。
- [ ] 素材可挂载，缺失有语义 fallback；不存在“零素材”验收捷径。
- [ ] 所有面板遵守五态、同屏≤5、键盘/手柄/读屏等价、焦点归还和统一 z-index/输入仲裁。
- [ ] 相关 TypeScript、Vitest、lint 和文档术语门禁按仓库要求可运行。
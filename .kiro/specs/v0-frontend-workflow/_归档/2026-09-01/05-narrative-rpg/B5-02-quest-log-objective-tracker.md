# B5-02 任务日志与目标追踪 Prompt

## 1 页面定位

本 Prompt 交付两个互补的叙事 RPG 表面：`quest-log` 全屏/浮层任务日志，以及 `objective-tracker` 对局内目标追踪器。任务日志用于阅读主线、支线、日常任务的只读摘要、目标状态和奖励预览；目标追踪器用于在世界层上显示当前被追踪任务的少量目标。二者都只消费玩法投影，不在 UI 内创建、完成、失败、追踪任务或更新目标。

任务日志可以从 `J` 或既有暂停/控制面板入口打开；目标追踪器附着在世界层右上区域，不遮挡轮次栏、动作菜单和关键素材。任务列表、筛选项、目标项和奖励项每个同屏并列组不超过 5；超过 5 项必须使用分页、滚动或分组，当前视口最多 5 项。允许使用任务类型徽记、目标图标、导航标记、角色头像和奖励图标等素材。

## 2 权威来源（只写 attachmentId/provenance）

- `attachmentId: "rpg-quest-log"`
- `provenance: "docs/表现系统/07_RPG叙事与引导系统全览.md；任务日志的信息架构、分类筛选、目标列表、追踪和奖励预览"`
- `attachmentId: "rpg-objective-tracker"`
- `provenance: "docs/表现系统/07_RPG叙事与引导系统全览.md；目标追踪位置、状态、距离方向、进度和动态更新"`
- `attachmentId: "quest-rendering-toolchain"`
- `provenance: "docs/表现系统/08_技术栈与代码生成画面.md；任务卡片 layout 重排、Radix 筛选、trackerStore 只读消费"`
- `attachmentId: "quest-visual-placement"`
- `provenance: "docs/表现系统/09_图形化实现落点.md；任务卡片和目标状态的动效、语义色与稳定端口"`
- `attachmentId: "narrative-rpg-workflow"`
- `provenance: ".kiro/specs/v0-frontend-workflow/prompts/05-narrative-rpg/B5-00-narrative-rpg-prompt.md；共同同屏≤5、素材可用和 intent 边界"`

## 3 当前决策

- 任务日志是只读检视面，不是任务编辑器、奖励领取器或玩法结算器；任务状态、目标状态、奖励摘要和追踪状态均来自同一 revision 的投影。
- 支持主线、支线、日常分类和进行中、已完成、失败状态筛选；筛选只改变呈现，不改变任务数据。
- 追踪按钮只提交 `quest.track` intent；只有宿主返回确认并刷新投影后，目标追踪器才显示新任务。
- 目标行可表达完成、进行中、未开始、失败、进度、距离和方向，但 UI 不计算距离、方向、数量或导航路径。没有投影字段就不显示猜测值。
- 任务奖励只作只读预览，不提供领取、消费、拆分或装备；数值遵循玩家可见数值 1-5 约束，累计量若由投影提供必须标记为非比较型摘要。
- 允许素材挂接：任务类别、目标状态、NPC、地点和奖励均可有登记图标或缩略图；素材缺失显示语义 fallback，不移除信息层级。

## 4 状态机

```text
closed
  └─ open-requested → loading
loading
  ├─ projection-ready → list-presenting
  ├─ projection-error → error
  └─ timeout → stale-or-retry
list-presenting
  ├─ filter-change → list-presenting
  ├─ quest-select → detail-presenting
  ├─ track-intent → intent-pending
  └─ close-intent → closing → closed
detail-presenting
  ├─ objective-focus → detail-presenting
  ├─ track-intent → intent-pending
  └─ projection-revision → list-presenting
intent-pending
  ├─ accepted → awaiting-projection
  ├─ rejected → recoverable-error
  ├─ timeout → stale-or-retry
  └─ resync-required → loading
```

目标追踪器独立使用：`hidden → visible → collapsed → expanded → stale/error`。目标完成、新目标出现和追踪切换必须由 revision 变化驱动；本地点击不能把目标改成完成。

## 5 组件树

```text
<QuestSurface>
  ├─ <QuestLogTrigger />
  ├─ <QuestLogPanel>
  │   ├─ <QuestCategoryTabs />
  │   ├─ <QuestStatusFilter />
  │   ├─ <QuestList maxVisible=5 />
  │   │   └─ <QuestListItem />
  │   └─ <QuestDetail>
  │       ├─ <QuestHeader />
  │       ├─ <ObjectiveList maxVisible=5 />
  │       ├─ <RewardPreview maxVisible=5 />
  │       └─ <TrackIntentButton />
  └─ <ObjectiveTracker>
      ├─ <TrackerHeader />
      ├─ <TrackedObjectiveList maxVisible=5 />
      └─ <TrackerCollapseControl />
</QuestSurface>
```

列表和详情不复制业务对象；详情只引用当前选中 `questId`，投影变化时以 revision 校验并安全回退到第一项或空状态。

## 6 只读数据

```ts
interface QuestLogProjection {
  readonly revision: string;
  readonly quests: readonly QuestProjection[];
  readonly category: 'all' | 'main' | 'side' | 'daily';
  readonly status: 'all' | 'active' | 'completed' | 'failed';
  readonly trackedQuestId?: string;
  readonly allowedIntents: readonly string[];
}

interface QuestProjection {
  readonly questId: string;
  readonly title: string;
  readonly description: string;
  readonly category: 'main' | 'side' | 'daily';
  readonly state: 'available' | 'active' | 'completed' | 'failed';
  readonly objectives: readonly ObjectiveProjection[];
  readonly rewards: readonly RewardProjection[];
  readonly assetRef?: string;
  readonly isMock?: true;
}

interface ObjectiveProjection {
  readonly objectiveId: string;
  readonly text: string;
  readonly state: 'not-started' | 'in-progress' | 'completed' | 'failed';
  readonly progress?: { readonly current: number; readonly total: number };
  readonly distanceLabel?: string;
  readonly directionLabel?: string;
  readonly assetRef?: string;
}
```

`progress`、`distanceLabel` 和 `directionLabel` 只显示端口提供的格式化结果，UI 不根据坐标、计数或本地时间重新计算。假数据统一带 `isMock: true`。

## 7 动作意图

```ts
type QuestUiIntent =
  | { readonly kind: 'quest-log.open' }
  | { readonly kind: 'quest-log.close' }
  | { readonly kind: 'quest.filter.category'; readonly category: string }
  | { readonly kind: 'quest.filter.status'; readonly status: string }
  | { readonly kind: 'quest.select'; readonly questId: string }
  | { readonly kind: 'quest.track'; readonly questId: string }
  | { readonly kind: 'tracker.toggle'; readonly questId: string };
```

`onSelect`、`onClick`、键盘操作和快捷键只调用 intent dispatcher。禁止调用 `addQuest`、`updateObjective`、`completeQuest`、`failQuest`、`addMarker`、`removeMarker` 或奖励接口。目标点击可以请求宿主聚焦已有目标标记，但不创建导航标记、不计算路径。

## 8 本地 UI 状态

允许的本地状态：日志打开/关闭、当前分类和状态筛选、当前选中任务、详情折叠、追踪器展开/折叠、键盘焦点、分页/滚动位置、素材加载态和 intent pending。筛选值可以保留在页面本地，但只能作为显示参数；`trackedQuestId`、目标状态和任务状态必须从投影刷新。

## 9 视觉令牌

- 主线使用红色语义条，支线使用青色，日常使用绿色；颜色必须同时配合文字和图标。
- 任务卡采用 P5 斜切、断边、局部高光和半透明暗底；选中卡片向右偏移并显示边缘光，禁用卡片扁平降饱和。
- 完成目标用绿和勾形图标，进行中用橙/等待图标，未开始用灰，失败用红/叉；距离和方向是辅助标签，不制造假的导航线。
- 任务类型、目标、NPC、地点和奖励允许挂接素材；素材缺失保留图标位与文本 fallback。
- 日志面板和 tracker 必须依附世界层，不呈现为白底 dashboard；同屏每个列表组≤5。

## 10 动效绑定

- Quest 列表项使用 Framer Motion `layout` 做筛选和状态变更重排；打开日志从触发位置斜切滑入，关闭回到触发点。
- 任务状态徽章用 `AnimatePresence` 切换；投影确认完成时显示绿闪和退出，失败显示红色收束，不在点击瞬间预演完成。
- 新目标由右侧滑入并橙色高亮短暂保持；完成目标在投影 revision 到达后绿闪并滑出，剩余目标自然重排。
- tracker 展开/折叠保持世界锚点和空间连续性；`prefers-reduced-motion` 下改为短淡入和即时重排。

## 11 输入无障碍

- `J` 打开任务日志，Esc 关闭并归还焦点；Tab 遍历分类、状态筛选、任务项、追踪按钮和关闭按钮。
- 分类和状态筛选使用 Radix Select/DropdownMenu 的键盘语义；列表项使用可读标题、类别、状态和数量信息。
- tracker 标题、折叠按钮和每个目标可由键盘操作；屏幕阅读器能读出目标状态、进度、距离和方向，颜色不作为唯一依据。
- 动态完成和新目标通过不抢焦点的 live region 播报；用户触发的筛选不重复播报整个列表。

## 12 加载错误超时

- 打开任务日志时先显示列表 skeleton 和“正在读取任务投影”，不显示伪造任务完成态。
- 任务详情在选中项过期时显示 stale 标记并等待新 revision；不以本地缓存继续提交追踪 intent。
- 投影加载失败显示重试和关闭；追踪 intent 被拒绝、超时或需要重同步时显示对应原因，追踪器保持旧投影并标记过期。
- 缺失任务图标、NPC 头像或奖励图标使用已登记的通用语义素材或文本 fallback；图片错误不能让任务正文消失。

## 13 明确不做

- 不创建、编辑、删除、完成、失败任务，不更新目标，不领取或消费奖励。
- 不执行距离、方向、数量、百分比、路径、导航标记或地图位置计算。
- 不实现地图、节点、拓扑、寻路、日历、社交关系、编辑器、研究台、素材库或电脑内部界面。
- 不把任务日志做成库存、自由拖拽排序或可写任务数据库。
- 不在任何直接 `onSelect` 中执行业务；点击只提交意图并等待宿主结果。

## 14 依赖交接

- 玩法投影端口提供任务、目标、奖励摘要、追踪状态、revision、可见性和格式化距离/方向字段。
- 意图端口提供 `quest-log.open/close`、筛选、选择、追踪和 tracker toggle 的确认/拒绝/超时/重同步结果。
- 地图/导航提供方只负责已有目标标记的只读引用；本 Prompt 不跨边界创建或操作地图状态。
- 素材端口提供任务类别、目标状态、NPC、地点和奖励素材的 `assetRef` 及 fallback；允许实际素材挂接。
- 壳层交接提供 `J`、Esc、焦点归还、世界层挂载点和同屏≤5 守卫；本 Prompt 不修改壳层。

## 15 验收条件

- [ ] 任务日志包含分类筛选、状态筛选、任务列表、详情、目标、奖励预览和追踪入口；tracker 可独立折叠。
- [ ] 每个同屏列表组不超过 5，超过项有分页、滚动或分组；任务目标点击不在本地创建导航或完成状态。
- [ ] 任务和目标状态只在投影 revision 更新后变化；完成/失败/新目标动效对应已确认投影。
- [ ] 所有交互走显式 intent，代码没有直接 `onSelect` 业务逻辑。
- [ ] 任务类别、目标状态和素材 fallback 有文字、图标和可访问标签；J/Esc/Tab/Enter/Space 可操作。
- [ ] 投影加载、素材缺失、拒绝、超时和重同步态均可演示，且不伪造业务结果。

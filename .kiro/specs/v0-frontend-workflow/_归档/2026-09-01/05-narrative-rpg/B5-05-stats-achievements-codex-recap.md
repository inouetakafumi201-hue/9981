# B5-05 统计成就图鉴回顾 Prompt

## 1 页面定位

本 Prompt 交付玩家进度档案表面：统计数据（Stats）、成就（Achievements）、收藏图鉴（Codex）和剧情回顾（Recap）。它们是只读的长期进展浏览与回看界面，不是玩法配置、仓库、编辑器或奖励领取流程。统计展示游玩时间、击杀分类、任务完成、死亡和探索摘要；成就展示解锁状态；图鉴展示敌人、道具、地点；回顾展示剧情事件时间线、对话回顾和关键选择记录。

四类档案共用一个稳定的 archive 抽取边界，但每次只呈现一个主档案焦点，列表、筛选项、统计比较项和时间线事件同屏最多 5 项。超过 5 项使用分页、滚动或时间分组。允许使用敌人/道具/地点缩略图、成就徽章、类别图标、事件插图和收藏素材；图鉴未解锁条目显示 `？？？` 与可挂接的遮罩缩略图，而不是零素材界面。

## 2 权威来源（只写 attachmentId/provenance）

- `attachmentId: "rpg-stats"`
- `provenance: "docs/表现系统/07_RPG叙事与引导系统全览.md；统计数据类别与列表/图表表现边界"`
- `attachmentId: "rpg-achievements"`
- `provenance: "docs/表现系统/07_RPG叙事与引导系统全览.md；成就进度和成就解锁庆祝语义"`
- `attachmentId: "rpg-codex"`
- `provenance: "docs/表现系统/07_RPG叙事与引导系统全览.md；敌人、道具、地点图鉴、未解锁态和列表详情布局"`
- `attachmentId: "rpg-recap"`
- `provenance: "docs/表现系统/07_RPG叙事与引导系统全览.md；剧情时间线、对话回顾和关键选择记录"`
- `attachmentId: "archive-operations-boundary"`
- `provenance: "docs/运营系统/01_运营与局外养成.md；收藏室是可见与回顾承载，不是仓库、配装或容量管理"`
- `attachmentId: "archive-rendering-toolchain"`
- `provenance: "docs/表现系统/08_技术栈与代码生成画面.md；统计筛选、图鉴 checkbox、页面路由和 Framer Motion 结果动效"`
- `attachmentId: "narrative-rpg-workflow"`
- `provenance: ".kiro/specs/v0-frontend-workflow/prompts/05-narrative-rpg/B5-00-narrative-rpg-prompt.md；共同只读、同屏≤5、素材和 intent 边界"`

## 3 当前决策

- 档案页面只读消费投影；统计不执行 `recordStat`，成就不执行 `unlockAchievement`，图鉴不执行 `unlockCodexEntry`，回顾不执行 `recordEvent`。
- 统计可用列表、有限比较图和摘要图形表达，但玩家可见比较组同屏≤5；累计游玩时间、累计次数等非决策型总量可以作为投影摘要，不引入新的经济或玩法数值。
- 成就按投影提供的解锁/未解锁/进行中状态呈现，解锁庆祝是已确认事件的视觉回放；未解锁条件只显示投影允许公开的描述。
- 图鉴按敌人、道具、地点分类；未解锁条目显示 `？？？`，详情只展示投影允许的弱点、描述和背景，不从内部知识库推断。
- 回顾按时间线展示事件、重要对话和关键选择记录；回顾操作只读和重播呈现，不重新执行剧情，不修改当前进度。
- 收藏室/保险箱语义是可见与回顾，不转化为可自由整理的仓库、装包、容量优化或对局前配装面板。
- 素材允许挂接并应被真实使用：缩略图、徽章、事件插图和类别图标通过 `assetRef` 进入；缺失素材保留语义占位与文字。

## 4 状态机

```text
closed
  └─ archive-open-intent → loading
loading
  ├─ projection-ready → archive-presenting
  ├─ asset-missing → archive-presenting-with-fallback
  ├─ projection-error → error
  └─ timeout → stale-or-retry
archive-presenting
  ├─ tab-change → loading-or-presenting
  ├─ filter-change → presenting
  ├─ entry-select → detail-presenting
  ├─ recap-replay-intent → intent-pending
  └─ close-intent → closing → closed
detail-presenting
  ├─ entry-change → detail-presenting
  ├─ asset-error → detail-with-fallback
  └─ close-intent → closing → closed
intent-pending
  ├─ accepted → acknowledged
  ├─ rejected → recoverable-error
  ├─ timeout → stale-or-retry
  └─ resync-required → loading
```

成就庆祝、图鉴解锁高光和回顾重播只在投影有对应确认事件时进入演出状态。分页、筛选、选中和展开属于本地 UI 状态，不改变 archive 数据。

## 5 组件树

```text
<ArchiveSurface>
  ├─ <ArchiveTabs>
  │   ├─ <StatsTab />
  │   ├─ <AchievementsTab />
  │   ├─ <CodexTab />
  │   └─ <RecapTab />
  ├─ <StatsPanel>
  │   ├─ <StatsFilter />
  │   ├─ <StatsSummary />
  │   └─ <StatsComparison maxVisible=5 />
  ├─ <AchievementsPanel>
  │   └─ <AchievementList maxVisible=5 />
  ├─ <CodexPanel>
  │   ├─ <CodexCategoryFilter />
  │   ├─ <CodexList maxVisible=5 />
  │   └─ <CodexDetail />
  ├─ <RecapPanel>
  │   ├─ <RecapTimeline maxVisible=5 />
  │   └─ <RecapDetail />
  └─ <ArchiveIntentStatus />
</ArchiveSurface>
```

每个 tab 使用同一 archive 挂载点但独立数据投影和局部状态；不得把图鉴条目、成就条件或回顾事件转换为另一个系统的业务对象。

## 6 只读数据

```ts
interface ArchiveProjection {
  readonly revision: string;
  readonly activeTab: 'stats' | 'achievements' | 'codex' | 'recap';
  readonly stats: readonly StatProjection[];
  readonly achievements: readonly AchievementProjection[];
  readonly codexEntries: readonly CodexEntryProjection[];
  readonly recapEvents: readonly RecapEventProjection[];
  readonly allowedIntents: readonly string[];
}

interface StatProjection {
  readonly statId: string;
  readonly label: string;
  readonly displayValue: string;
  readonly category: string;
  readonly comparisonGroup?: string;
  readonly assetRef?: string;
}

interface AchievementProjection {
  readonly achievementId: string;
  readonly title: string;
  readonly description: string;
  readonly state: 'locked' | 'in-progress' | 'unlocked';
  readonly progressLabel?: string;
  readonly assetRef?: string;
}

interface CodexEntryProjection {
  readonly entryId: string;
  readonly category: 'enemy' | 'item' | 'location';
  readonly unlocked: boolean;
  readonly title: string;
  readonly description?: string;
  readonly weaknesses?: readonly string[];
  readonly assetRef?: string;
}

interface RecapEventProjection {
  readonly eventId: string;
  readonly occurredAtLabel: string;
  readonly title: string;
  readonly summary: string;
  readonly category: 'story' | 'dialogue' | 'choice';
  readonly assetRef?: string;
}
```

统计的 `displayValue`、成就进度、图鉴描述/弱点、回顾时间标签和摘要均由投影格式化；UI 不计算或补写数据。mock 条目必须带 `isMock: true` 扩展标识。

## 7 动作意图

```ts
type ArchiveUiIntent =
  | { readonly kind: 'archive.open'; readonly tab: string }
  | { readonly kind: 'archive.close' }
  | { readonly kind: 'archive.tab.select'; readonly tab: string }
  | { readonly kind: 'archive.filter'; readonly scope: string; readonly value: string }
  | { readonly kind: 'archive.entry.select'; readonly entryId: string }
  | { readonly kind: 'recap.replay'; readonly eventId: string };
```

tab、筛选、条目选择和回顾重播都只构造 intent。`recap.replay` 的确认结果只允许启动表现层重播，不重新执行原剧情；禁止在直接 `onSelect` 中调用统计、成就、图鉴、奖励、剧情或存档业务。

## 8 本地 UI 状态

允许的本地状态：当前 tab、筛选值、选中条目、详情展开、分页/滚动位置、排序方向（仅投影允许时）、素材加载态、回顾重播的视觉阶段、焦点、reduced-motion 和 intent pending。解锁、记录、进度、时间线顺序和收藏归属必须始终来自投影 revision。

## 9 视觉令牌

- 档案页继承暗调半透明、断边、斜切和局部高光，保持世界/驻地背景透出；禁止白底表格和统一圆角卡片墙。
- 统计使用蓝/青/灰白信息色，图表只表达已格式化投影，比较组≤5；数值显示遵循玩家可见 1-5 约束或清楚标为非决策摘要。
- 成就使用金色少量高光，锁定态灰化但可读；解锁态同时用徽章、标题和文本。
- 图鉴使用敌人/道具/地点语义色和可用缩略图，未解锁条目固定显示 `？？？`；详情素材可为 portrait、icon、环境图或已登记缩略图。
- 回顾用时间线轴、事件卡和日期标签表达先后，剧情、对话、选择用图标和文本区分；同屏事件≤5。

## 10 动效绑定

- tab 和筛选使用 Framer Motion 局部切换与 `layout` 重排，不整页重载；详情从列表条目方向进入，关闭回到条目。
- 统计数值变化只在新投影 revision 到达后做短缓动；成就解锁使用已确认事件的徽章高光/轻量庆祝，不在点击时提前解锁。
- 图鉴条目解锁使用缩略图显影或遮罩退场，回顾时间线事件按空间顺序逐项出现；replay 只重演字幕/事件视觉。
- 素材切换使用 `AnimatePresence`，失败时平滑保留 fallback；`prefers-reduced-motion` 下采用即时布局和状态色。

## 11 输入无障碍

- Archive tabs、分类筛选、条目、详情、关闭和回顾重播全部可 Tab 到达，Enter/Space 激活；方向键在 tab/list 中移动焦点。
- 图鉴多选筛选使用 Radix Checkbox，统计筛选使用 Radix Select/DropdownMenu；Dialog/Tooltip 负责焦点、Esc、描述和 hover/focus 说明。
- 每个条目读出类别、标题、状态、进度或锁定原因；图鉴未解锁 `？？？` 仍有稳定 aria-label，不泄漏隐藏内容。
- 图表提供等价文本摘要，颜色、柱高、徽章和缩略图都不是唯一语义；动态成就播报不抢占当前焦点。

## 12 加载错误超时

- 首次打开显示按 tab 区分的 skeleton，不用本地旧数据伪造解锁、统计或剧情进度。
- 单张素材失败保留标题、描述、状态和通用图标；未解锁图鉴仍能以 `？？？` 呈现。
- archive 投影错误、版本过期、intent 拒绝和超时分开显示；提供重试、返回 tab 或关闭，不执行隐式业务重试。
- 回顾重播素材/音频失败时仍显示文字时间线；重同步后丢弃过期选择并重新读取 revision。

## 13 明确不做

- 不记录统计、不解锁成就或图鉴、不写剧情事件、不改关键选择、不领取奖励。
- 不把收藏室、图鉴或档案做成仓库、装包、容量管理、套装演算、自由编辑或对局前配置。
- 不从图鉴文字推导弱点，不从统计图推导难度，不从回顾重播重新执行剧情或改变当前状态。
- 不在直接 `onSelect` 执行业务，不实现地图、节点、拓扑、寻路、编辑器、研究台、素材库或电脑内部界面。
- 不超过同屏≤5，不移除可使用素材，不采用零素材说法替代资源合同。

## 14 依赖交接

- Archive 只读端口提供 stats、achievements、codex、recap 四类投影、可见性过滤、格式化标签、revision 和素材引用。
- intent 端口提供 archive open/close/tab/filter/select 与 recap replay 的结果；回顾 replay 必须明确为表现层重播权限。
- 素材端口提供敌人/道具/地点缩略图、成就徽章、事件插图和类别图标的 `assetRef`、加载状态与 fallback。
- 壳层/路由提供稳定 archive 挂载点和快捷键入口（如 `K` 图鉴等），不把本 Prompt 变成第二导航中心。
- 运营收藏室端口只交接长期对象的只读可见/回顾摘要；明确禁止依赖仓库内部形状和对局配装权限。

## 15 验收条件

- [ ] 统计、成就、图鉴、回顾四个 tab 均可呈现，列表/详情/筛选/回顾重播边界清楚。
- [ ] 每个同屏列表、比较组和时间线视口最多 5 项；更多内容有分页、滚动或分组。
- [ ] 解锁、记录、剧情和选择状态只来自只读投影；回顾 replay 不重新执行剧情。
- [ ] 图鉴未解锁显示 `？？？`，实际素材可挂接；缺失素材保留语义 fallback，不出现零素材断言。
- [ ] 所有操作走 intent，无直接 `onSelect` 业务逻辑；Radix 键盘/读屏/焦点和图表文本摘要可验证。
- [ ] 投影、素材、音频失败，过期、拒绝、超时和重同步态均可演示，且不会伪造进度。

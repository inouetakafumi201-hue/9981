# B4-04 通知历史与字幕/声音视觉替代 Brief

## 1 页面定位

- 本 brief 定义通知表现家族：`notice-toast` 临时通知、`notice-broadcast` 被动公告和 `notification-history` 历史面板，并定义字幕与关键声音的视觉替代覆盖层。
- 本 brief 逐条遵守 G-01..G-08 的 UI-only、intent-only、素材允许、不用零素材口径、同屏不超过 5、不得写库或实现规则约束。
- 通知只告诉玩家宿主已经投影出的事件摘要；队列、优先级、同类聚合、时间分组和历史均以只读投影为准。UI 不创建、领取、删除、编辑或重放业务事件。
- 字幕/声音视觉替代保证静音、音频缺失、听觉障碍和声音不可用时仍能理解同一可见信息；不能泄露不可见信息，不能用本地音效推断规则。

## 2 权威来源

- attachmentId: `frontend-global-g03`
  provenance: `G-03-ui-port-contract.md；通知与音频端口的只读投影、intent result`
- attachmentId: `frontend-global-g04`
  provenance: `G-04-interaction-accessibility.md；live region、键盘、焦点归还、非颜色信息`
- attachmentId: `frontend-global-g05`
  provenance: `G-05-motion-audio-fallback.md；音频缺失、字幕/视觉 fallback、reduced motion`
- attachmentId: `frontend-global-g08`
  provenance: `G-08-page-and-batch-index.md；notice-broadcast、notice-toast、notification-history pageId 与状态`
- attachmentId: `rpg-notification-system`
  provenance: `presentation-rpg-07；通知类型、位置、历史 50 条、优先级、队列和 N 快捷键`
- attachmentId: `notification-rendering-toolchain`
  provenance: `presentation-implementation-09；Radix Toast aria-live、Zustand 视图队列、Howler 音效槽`
- attachmentId: `presentation-dialog-subtitle`
  provenance: `presentation-dialog-06；字幕槽、语音可选、文本优先降级`
- attachmentId: `presentation-sound-fallback`
  provenance: `docs/表现系统/03_声音动态设计.md；字幕/视觉替代、关键声音可视化`

## 3 当前决策

- 通知类型至少覆盖任务完成/失败、道具获得、技能解锁、成就、货币变化、社交事件、系统消息与 broadcast；具体类型和优先级由投影提供，不按标题本地猜测。
- 高优先级通知可打断低优先级 Toast，但被打断项不从历史或投影删除；低优先级排队。同类聚合必须使用投影 `groupKey`/`stackCount`，不本地合并不同事件。
- Toast 从右侧进入并依附世界层；公告是被动横幅，可展开/关闭；`N` 打开历史，历史按今天/昨天/更早分组，当前视口最多 5 条。
- Toast 可自动关闭，但本地 dismiss 只影响呈现；历史不可删除、编辑、领取或重放业务事件。自动关闭不等于事件消失。
- 字幕位于底部安全区，显示 speaker、正文和可选语音状态；玩家 speaker 使用青色语义，NPC/旁白使用灰白/投影提供的语义色，同时有文字标签。
- 关键声音提供视觉替代：声音类型图标、方向/来源标签、强弱状态或文字描述；无声、静音、音频加载失败均不阻断通知/字幕。

## 4 状态机

```text
notification-idle
  ├─ projection-update(low) → queued
  ├─ projection-update(high) → interrupting
  └─ N-open → history-loading
queued
  ├─ slot-available → presenting
  ├─ group-update → stacking
  └─ revision-expired → stale
interrupting → presenting
presenting
  ├─ auto-close / dismiss → dismissing → queued-or-idle
  ├─ history-open → history-loading
  └─ asset/audio-error → presenting-with-fallback
history-loading
  ├─ ready → history-presenting
  ├─ error → history-error
  └─ timeout → retry-or-close
history-presenting
  ├─ group/page-change → history-presenting
  └─ Esc/close → closing → notification-idle
subtitle-hidden → subtitle-presenting → subtitle-updated → subtitle-hidden
sound-event-visible → audio-playing | audio-muted | audio-failed → visual-alternative
```

- 历史、Toast、字幕的呈现阶段是本地状态；通知是否存在、优先级、内容和历史事实来自投影。
- `visual-alternative` 是音频失败/静音时的表现降级，不是新的规则事件。

## 5 组件树

```text
NotificationSurface
├─ ToastViewport
│  └─ ToastQueue maxVisible=5
│     └─ NotificationToast
├─ BroadcastBanner
│  ├─ BroadcastSummary
│  └─ BroadcastDetail
├─ NotificationHistoryTrigger (N)
├─ NotificationHistoryDialog
│  ├─ HistoryGroupTabs
│  ├─ HistoryList maxVisible=5
│  ├─ HistoryEntryDetail
│  └─ HistoryCloseControl
├─ SubtitleOverlay
│  ├─ SubtitleSpeakerLabel
│  ├─ SubtitleText
│  └─ SubtitleTimingStatus
└─ SoundVisualAlternative
   ├─ SoundEventIcon
   ├─ DirectionIndicator
   └─ VisualEventLabel
```

## 6 只读数据

```ts
interface NotificationProjection {
  readonly source: 'mock' | 'projection';
  readonly revision: string;
  readonly active: readonly NotificationItem[];
  readonly history: readonly NotificationItem[];
  readonly allowedIntents: readonly string[];
}
interface NotificationItem {
  readonly notificationId: string;
  readonly kind: 'quest' | 'item' | 'skill' | 'achievement' | 'currency' | 'social' | 'system' | 'broadcast';
  readonly priority: 'high' | 'normal' | 'low';
  readonly groupKey?: string;
  readonly title: string;
  readonly message: string;
  readonly occurredAtLabel: string;
  readonly stackCount?: number;
  readonly assetRef?: string;
  readonly mock: true;
}
interface SubtitleProjection {
  readonly visible: boolean;
  readonly speakerLabel: string;
  readonly text: string;
  readonly voiceState: 'available' | 'muted' | 'missing' | 'failed';
  readonly soundVisual?: { readonly iconRef?: string; readonly directionLabel?: string; readonly description: string };
}
```

- `occurredAtLabel`、`stackCount`、分组标签和可见性来自投影；UI 不使用本地时钟重写历史或通过音频状态创造通知。
- 每条 mock 内容明确 `source: "mock"`/`mock: true`。

## 7 动作意图

```ts
type NotificationUiIntent =
  | { readonly kind: 'notice.dismiss'; readonly notificationId: string }
  | { readonly kind: 'notice.history.open' }
  | { readonly kind: 'notice.history.close' }
  | { readonly kind: 'notice.history.group'; readonly group: string }
  | { readonly kind: 'notice.history.select'; readonly notificationId: string }
  | { readonly kind: 'notice.broadcast.expand'; readonly notificationId: string }
  | { readonly kind: 'notice.broadcast.close'; readonly notificationId: string }
  | { readonly kind: 'subtitle.toggle'; readonly enabled: boolean }
  | { readonly kind: 'notice.retry'; readonly requestId: string };
```

- 点击、关闭、`N`、Enter、Space、Esc、历史分组和字幕开关只构造 intent；禁止调用 `notify`、`notifyItem`、`notifySystem`、领取奖励、标记完成或删除历史。
- `notice.dismiss` 不能改变权威通知账本；如果宿主不允许 dismiss，呈现 rejected 原因。

## 8 本地 UI 状态

- Toast 动画阶段、队列视觉快照、展开/折叠、历史当前分组/页、选中条目、焦点、自动关闭计时、素材加载态、live region 节流和视觉替代可见性可以本地保存。
- 音频 muted/failed 只用于本地视觉降级；字幕开关是本地 preview，持久化需端口确认。
- 投影 revision 更新时丢弃过期队列快照；本地 dismiss 不能删除历史，本地聚合不能改写 `groupKey`/`stackCount`。

## 9 视觉令牌

- 任务更新绿、任务失败红、道具获得黄、技能橙、成就金、社交青、系统白/奶白；每条同时显示类型文字/图标，避免仅靠颜色。
- Toast 右侧滑入、透明暗底、断边与局部语义高光；公告更宽但保留世界背景；历史使用分组线与选中条，不做标准后台消息中心。
- 字幕底部安全区使用高对比暗底和 speaker 标签；玩家/社交青、NPC/旁白灰白，错误/关键警示仍配文字。
- 声音视觉替代使用图标、方向箭头、来源标签和可读描述；素材/图标缺失时保留语义文字，不删除占位。
- Toast/history/subtitle 的任何可比较并列区域最多 5 项；历史更多条目用滚动/分组/分页。

## 10 动效绑定

- Toast 用 Framer Motion `AnimatePresence` 从右侧滑入、停留、右侧淡出；队列使用 `layout` 重排，高优先级插入但不删除旧项。
- 公告从触发区域/世界边缘进入，展开只做局部布局变化；历史从 `N` 触发点展开，关闭回落并还焦点。
- 字幕按投影更新做短促显影/文本切换，声音视觉替代只在音频不可用或设置要求时显现；不得提前显示隐藏事件。
- reduced-motion 下保留通知顺序、优先级、字幕文本和视觉替代，移除位移/粒子/闪烁和不必要的自动滚动。

## 11 输入无障碍

- `N` 打开历史，Esc 关闭并归还焦点；Toast 关闭按钮可 Tab/Enter/Space 使用，历史分组与条目支持键盘导航。
- Radix Toast/AlertDialog/ScrollArea 或等价原语提供 `aria-live`、标题、描述、关闭语义；高优先级只播报一次，不循环抢占焦点。
- 自动关闭 Toast 提供可暂停/延长机制；读屏用户可在稳定历史中读取正文。字幕永不只靠音频，声音视觉替代永不只靠颜色。
- 每条历史/字幕读出类型、优先级、speaker、标题、正文、时间和堆叠数量；错误、stale、fallback 有清晰 live region。

## 12 加载错误超时

- Toast 投影加载中不显示伪造通知；历史打开显示标题 skeleton 和当前分组占位。
- 通知素材/音效加载失败显示类型图标、文本和声音视觉替代，不改变优先级、不阻断消息。
- 历史读取失败或超时显示明确错误、重试和关闭；超时标 stale，不把本地缓存当作最新历史。
- intent 被拒绝/超时/需要重同步时显示结果原因；重试只重新提交允许 intent，不创建重复通知。
- 字幕同步失败保留正文并显示「语音不可用，已使用文字反馈（mock）」；不通过缺失声音猜测新内容。

## 13 明确不做

- 不创建、领取、删除、编辑、重排权威通知，不触发任务/奖励/技能/成就/货币/社交业务。
- 不把历史做成后台消息中心，不把字幕/声音替代做成第二套事件源，不泄露不可见信息。
- 不使用纯颜色、粒子、音效或倒计时作为唯一结果；不在 `onSelect` 中调用业务 helper。
- 不让通知无限同屏、不把素材位删除、不以零素材替代可挂接素材。
- 不实现编辑器/研究台/素材库/电脑内部 UI、地图/拓扑/寻路/ORCA/路径成本或玩法规则。

## 14 依赖交接

- 事件 projection 提供类型、优先级、聚合键、堆叠计数、历史、时间标签、可见性、素材引用和 revision。
- intent port 提供 dismiss、history、broadcast、subtitle 的确认/拒绝/超时/重同步；UI 不拥有通知账本。
- Radix Toast/Dialog/ScrollArea 提供焦点、live region、Esc 和关闭；Zustand 只保存呈现队列；Howler 音频端口提供 `available/muted/missing/failed` 结果。
- B4-01/B4-03/B4-05 提供 overlay stack、世界层、utility 层和错误层的 z-index/输入仲裁；B5 消费 notification history 的稳定接口。

## 15 验收条件

- [ ] Toast、公告、历史三类 surface 可演示；覆盖通知类型、优先级、队列、同类聚合、自动/手动关闭、分组和 `N`。
- [ ] 高优先级打断不删除低优先级项目；历史不会因本地 dismiss 被删除；同屏任何列表/队列/比较不超过 5 项。
- [ ] 字幕、静音、声音缺失、视觉替代、素材缺失、投影加载/错误/超时和 intent 拒绝均有可读恢复。
- [ ] 键盘、手柄、读屏、live region、焦点归还、reduced-motion 和低闪烁路径可验证。
- [ ] 所有操作为 intent-only；没有直接通知业务调用、写库、规则推进或隐藏信息泄露。
- [ ] 相关 TypeScript、Vitest、lint 和文档术语门禁按仓库要求可运行。
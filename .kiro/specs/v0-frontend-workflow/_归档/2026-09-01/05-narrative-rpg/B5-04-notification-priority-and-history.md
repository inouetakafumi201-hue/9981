# B5-04 通知优先级与历史 Prompt

## 1 页面定位

本 Prompt 交付通知表现家族：右下角临时 Toast/队列、被动公告或活动横幅，以及按 `N` 打开的通知历史面板。通知用于告诉玩家已由宿主投影确认的任务更新、道具获得、技能解锁、成就、货币变化、社交事件和系统消息；通知不执行事件、不领取奖励、不修改历史。

临时通知依附世界层，不遮挡目标追踪器和关键操作；通知队列同屏最多 5 项，通知历史当前视口最多 5 条。更多内容通过队列、分页、滚动或时间分组呈现，不把全部通知铺成 dashboard。允许使用通知类型图标、成就徽章、任务图标、道具缩略图和活动素材；资源可缺失但必须有语义 fallback。

## 2 权威来源（只写 attachmentId/provenance）

- `attachmentId: "rpg-notification-system"`
- `provenance: "docs/表现系统/07_RPG叙事与引导系统全览.md；通知类型、位置、队列、同类堆叠、历史 50 条、优先级与 N 快捷键"`
- `attachmentId: "notification-rendering-toolchain"`
- `provenance: "docs/表现系统/08_技术栈与代码生成画面.md；Radix Toast aria-live、Zustand 队列历史、Howler 类型音效"`
- `attachmentId: "notification-visual-placement"`
- `provenance: "docs/表现系统/09_图形化实现落点.md；通知右侧滑入、排队、堆叠和语义色落点"`
- `attachmentId: "narrative-rpg-workflow"`
- `provenance: ".kiro/specs/v0-frontend-workflow/prompts/05-narrative-rpg/B5-00-narrative-rpg-prompt.md；共同只读投影、同屏≤5、素材和 intent 边界"`

## 3 当前决策

- 通知数据只来自宿主确认的只读投影；收到通知表示投影已有事件摘要，不代表 UI 负责执行该事件。
- 通知类型至少覆盖任务完成/失败、道具获得、技能解锁、成就、货币变化、社交事件和系统消息；每类使用既定语义色、文本和可选素材。
- 高优先级通知（例如任务失败、死亡等宿主标记）可打断当前低优先级 Toast；低优先级通知排队。优先级由投影提供，UI 不按标题猜测。
- 同类可堆叠时使用宿主提供的聚合键和摘要，刷新展示寿命；UI 不本地合并不同事件，不改变通知历史事实。
- `N` 打开通知历史；历史按今天、昨天、更早分组，展示投影提供的最近记录。历史可读、筛选和关闭，不可删除、编辑或重放业务事件。
- 允许素材挂接，通知没有素材时仍显示类型图标、标题和正文；不以“无素材”取代通知视觉。

## 4 状态机

```text
idle
  ├─ low-priority-event → queued
  ├─ high-priority-event → interrupting
  └─ N-open-intent → history-loading
queued
  ├─ slot-available → presenting
  ├─ same-group-event → stacking
  └─ projection-expired → stale
interrupting
  └─ presenting
presenting
  ├─ timer-complete → dismissing
  ├─ user-dismiss → dismissing
  ├─ history-open → history-loading
  └─ asset-error → presenting-with-fallback
history-loading
  ├─ ready → history-presenting
  ├─ error → error
  └─ timeout → retry-or-close
history-presenting
  ├─ group/page-change → history-presenting
  └─ close-intent → closing → idle
```

通知显示计时、堆叠和退出是本地视觉状态；通知本身是否存在、优先级、类型和历史记录以投影为准。高优先级打断不删除被打断通知，只按队列策略重新呈现。

## 5 组件树

```text
<NotificationSurface>
  ├─ <ToastViewport>
  │   └─ <ToastQueue maxVisible=5>
  │       └─ <NotificationToast />
  ├─ <BroadcastBanner />
  ├─ <NotificationHistoryTrigger />
  └─ <NotificationHistoryDialog>
      ├─ <HistoryGroupTabs />
      ├─ <HistoryList maxVisible=5 />
      ├─ <HistoryEntryDetail />
      └─ <HistoryCloseControl />
</NotificationSurface>
```

Toast、公告和历史共享通知投影但不互相复制业务状态。Toast 在世界层使用 Radix Toast 行为；历史使用 Radix Dialog/Select 的可访问行为并归还焦点。

## 6 只读数据

```ts
interface NotificationProjection {
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
  readonly isMock?: true;
}
```

`occurredAtLabel`、`stackCount` 和分组标签由投影提供；UI 不用本地时钟重写时间、不把同类文本自行合并、不把 Toast 自动消失当作事件删除。

## 7 动作意图

```ts
type NotificationUiIntent =
  | { readonly kind: 'notice.dismiss'; readonly notificationId: string }
  | { readonly kind: 'notice.history.open' }
  | { readonly kind: 'notice.history.close' }
  | { readonly kind: 'notice.history.select'; readonly notificationId: string }
  | { readonly kind: 'notice.history.group'; readonly group: string };
```

点击 Toast、关闭按钮、`N`、Enter、Esc 和历史选择都只提交 intent。禁止直接调用 `notify`、`notifyItem`、`notifySystem`、领取奖励、标记任务完成或删除历史。历史的已读视觉标记若需要持久化，必须由独立端口确认。

## 8 本地 UI 状态

允许的本地状态：当前 Toast 动画阶段、队列排序的视觉快照、展开/折叠、历史分组和分页、选中条目、自动关闭计时、焦点、素材加载态、live region 节流和 intent pending。投影更新时用 revision 丢弃过期本地快照；本地 dismiss 只影响呈现，不能删除历史。

## 9 视觉令牌

- 任务更新绿、任务失败红、道具获得黄、技能解锁橙、成就金、货币和社交青、系统白/奶白；每条通知同时显示类型文字和图标。
- Toast 从右侧进入，依附右下世界层，透明暗底、断边和局部语义高光；公告使用更宽但不占满屏幕的横幅，并保留世界背景。
- 高优先级使用更强边缘光和声音，但不闪烁到影响阅读；低优先级灰白/青色保持克制。
- 历史面板按今天、昨天、更早分组，允许挂接类型图标、成就徽章、道具图和活动素材；素材 fallback 保留文本。
- 同屏 Toast、历史条目和分组内可比较项≤5；禁止标准后台消息中心卡片墙。

## 10 动效绑定

- Toast 使用 Framer Motion `AnimatePresence` 从右侧滑入，停留后向右淡出；队列变化使用 `layout`，不整体重载。
- 高优先级打断使用明确的插入/重排演出，低优先级进入队列；同类堆叠由投影更新 `groupKey/stackCount` 驱动局部刷新。
- 公告从其触发区域或世界边缘进入，展开详情只做局部高度/布局变更；历史打开从 N 触发点进入并在关闭时回落。
- 动画只是已投影通知的表现，不把进场、音效或倒计时完成当成业务确认；reduced-motion 下保留顺序和优先级，缩短位移。

## 11 输入无障碍

- `N` 打开历史，Esc 关闭并归还焦点；Toast 关闭按钮可 Tab 到达，Enter/Space 激活。
- Radix Toast 提供 `aria-live` 和关闭语义；高优先级通知可播报一次，低优先级队列不抢占用户当前焦点。
- 历史分组和筛选支持键盘导航，条目读出类型、优先级、标题、正文、时间和堆叠数量；颜色不是唯一信息。
- 自动消失通知提供可暂停或延长的可访问机制，读屏用户不因计时丢失正文；历史提供稳定的可读顺序。

## 12 加载错误超时

- Toast 投影加载中不显示伪造通知；历史打开显示 skeleton 和当前分组占位。
- 通知素材加载失败显示类型图标和文本；音效加载失败不阻断消息，也不改变优先级。
- 历史读取失败显示明确错误、重试和关闭；超时标记 stale，不把本地缓存当作最新历史。
- intent 被拒绝、超时或需要重同步时显示可读状态；重试只重新提交允许的 intent，不重复创建通知。

## 13 明确不做

- 不创建通知、不触发任务/奖励/技能/成就/货币/社交业务，不删除、编辑或重排权威历史。
- 不在直接 `onSelect` 中调用通知业务函数，不按文本本地判断高优先级或同类关系。
- 不把通知历史做成消息中心后台、不展示地图、节点、寻路或玩法结算。
- 不使用没有类型标签的纯颜色提示，不删除可挂接素材位，也不声称无素材。
- 不让通知队列无限同屏；任何并列组保持≤5。

## 14 依赖交接

- 事件投影端口提供通知类型、优先级、聚合键、堆叠计数、历史记录、时间标签、素材引用和 revision。
- intent 端口提供 dismiss、history open/close/select/group 的结果；UI 不拥有通知账本。
- Radix Toast/Dialog 提供焦点、live region、Esc 和关闭行为；Zustand 仅保留呈现队列，不能成为事件权威源。
- Howler 音频端口提供按类型和优先级的音效句柄；成就特殊音效可挂接已登记素材，不阻塞正文。
- 壳层交接提供右下挂载点、N 快捷键路由、世界层背景、同屏≤5 和素材加载端口。

## 15 验收条件

- [ ] Toast、公告、历史三类表面可演示，通知类型和语义色覆盖清单。
- [ ] 高/低优先级、队列、同类堆叠、自动关闭、手动关闭、历史分组和 N 快捷键均可演示。
- [ ] Toast 与历史同屏并列不超过 5，更多内容使用队列、分页、滚动或分组。
- [ ] 所有操作走显式 intent，没有直接 `onSelect` 业务逻辑；历史不会因本地 dismiss 被删除。
- [ ] Radix live region、键盘导航、焦点归还、计时可访问性和 reduced-motion 通过检查。
- [ ] 投影、素材、音效加载失败，intent 拒绝、超时和重同步态均有可见处理。

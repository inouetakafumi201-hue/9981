# R-04 RPG 引导与信息重写 brief

## 1 页面定位

生成 WakeUp 的 RPG 信息层，覆盖任务日志、目标追踪、教程/帮助、区域名、通知/通知历史、统计、成就、图鉴和回顾。它们是可叠加、可渐进披露的 UI 模块，不是战斗 HUD 的第二套实现，也不是任务/奖励/成就规则引擎。主线、支线、通知和回顾都只读投影结果；玩家操作统一提交意图。

信息层要有鲜明的游戏化斜切语言、像素前景和半透明全息投影氛围，同时控制认知负担：同屏并列选择最多 5 个，关键状态不只用颜色表达；可选的后置模块可以显示 empty/locked/disabled，不得伪装成已实现的规则。

## 2 权威来源（attachmentId/provenance）

- `G-01-project-and-scope-contract`：UI-only、mock/projection、页面边界。
- `G-02-visual-token-contract`：颜色、材质、层级和素材允许。
- `G-03-ui-port-contract`：只读快照和 intent/result。
- `G-04-interaction-accessibility`：快捷键、焦点、屏幕阅读、≤5。
- `G-05-motion-audio-fallback`：通知/教程/区域名的表现和降级。
- `presentation-rpg-07` / `references/source/presentation-rpg-07.md`：模块清单、MVP/后置状态、任务、教程、通知、区域名、快捷键。
- `presentation-dialog-06` / `references/source/presentation-dialog-06.md`：对话和叙事层复用。
- `G-08-page-and-batch-index`：`quest-log`、`objective-tracker`、`tutorial-help`、`location-title`、`notice-*`、`stats`、`achievements`、`codex`、`recap` 页面归属。

## 3 当前决策

- MVP/当前必备表面：对话框、任务日志、目标追踪、教程/帮助、通知、区域名；统计、成就、图鉴、回顾是后置但必须预留稳定的空/锁定/只读页面形状。
- 任务日志显示主线/支线/日常和目标状态；目标追踪器只展示当前追踪目标、必要的方向/进度投影，不本地算路或任务完成。
- 教程采用渐进披露：只高亮当前需要理解的一步；玩家的真实 intent 仍经权威端口确认。F1 可重看帮助，重置教程是设置 intent。
- 通知按优先级队列，右下角 toast 不叠加；通知历史按时间分组，可读、可滚动。高优先级可打断低优先级，但不丢失历史记录。
- 区域名用于进入新区域的短暂标题演出；统计/成就/图鉴/回顾只显示投影字段，未解锁内容是明确空/锁定/剪影，不创建虚假事实。
- 后置的日历、社交链接、NPC 数据库、技能树、世界地图和环境叙事不从本 brief 展开为新系统。

## 4 状态机

- 任务：`loading → ready | empty | error`；单项 `active → completed | failed | unavailable`；日志 `closed → list → detail → closed`。
- 目标：`hidden → visible → collapsed | completed → hidden`；新目标进入 `queued → highlighted → tracked`。
- 教程：`first-time → showing → understood | skipped → replayable | disabled`。
- 通知：`queued → visible → merged | interrupted → dismissed → history`。
- 区域名：`hidden → entering → visible → exiting`。
- 信息页：`loading → ready | empty | locked | error`；所有动作 `pending → accepted | rejected | stale | timeout`。

## 5 组件树

`RpgInformationLayer → ObjectiveTracker + NoticeStack + LocationTitle + OverlayRegistry`。

- `QuestLog → QuestFilters → QuestList → QuestDetail → ObjectiveList → RewardSummary`。
- `TutorialHelp → TutorialDialog | ContextHint | HighlightTarget | HelpIndex`。
- `NotificationHistory → HistoryFilters → HistoryList`。
- `CollectionInfo → StatsPanel | AchievementList | CodexList/Detail | RecapTimeline`。

每个模块独立读自己的 snapshot 子树，共用 `FocusScope`、`Dialog`、`Tooltip`、`LiveRegion` 和 `FeedbackRegion`，不得另建全局路由或规则 store。

## 6 只读数据

```ts
interface RpgSnapshot {
  source: 'mock' | 'projection';
  revision: number;
  quests: readonly QuestView[];
  trackedObjective?: ObjectiveView;
  tutorials: readonly TutorialView[];
  notices: readonly NoticeView[];
  location?: LocationView;
  stats: readonly StatView[];
  achievements: readonly AchievementView[];
  codex: readonly CodexEntryView[];
  recap: readonly RecapEventView[];
}
```

`QuestView` 提供 `status`、`objectives`、`tracked`、`rewardsPreview`；`ObjectiveView` 提供 label、status、direction/distance 或 progress（若投影有）；`NoticeView` 提供 priority/type/title/body/read；统计、成就、图鉴、回顾的数字和锁定状态直接来自 projection。前端不得从任务文本、颜色或本地计数推导事实。

## 7 动作意图

- `rpg.quest.open`、`rpg.quest.track`、`rpg.objective.inspect`。
- `rpg.tutorial.acknowledge`、`rpg.tutorial.skip`、`rpg.help.open`、`rpg.tutorial.reset`。
- `rpg.notice.dismiss`、`rpg.notice.mark-read`、`rpg.history.open`。
- `rpg.info.open`、`rpg.info.filter`、`rpg.codex.select`、`rpg.recap.select`。

通知到达、任务完成、区域进入和成就解锁由 projection/event 触发，不由组件调用“完成任务”函数。标记、路径和奖励预览只呈现投影，不携带本地计算结果。

## 8 本地 UI 状态

允许 `activeModule`、selectedQuestId、selectedEntryId、filterTab、query、collapsed、pageIndex、focusedItem、noticeQueueView、tutorialHighlightId、read/presentation state、animationPhase 和 pendingRequestId。禁止本地持有任务完成事实、目标距离计算、奖励到账、统计累计、成就解锁、图鉴发现或回顾写入。

## 9 视觉令牌

- 主线/危险可用红色；支线/社交/UGC 用青色；日常/安全用绿色；进行中和提示用橙色；警戒用黄色；完成用绿色；锁定/延迟用灰；成就/收藏高光用少量金银。
- 任务列表和区域标题可用红色斜线、偏移和斜切，但不把每个模块做成同尺寸圆角卡片。
- 当前目标使用文字+图标+高亮；任务类型同时显示 label 和图标。未解锁图鉴用剪影/`？？？` 文字，不能只靠灰色。
- 通知 toast 位置不遮挡目标追踪器；统计图表或数字放在信息面板内，玩家可见数值遵守 1–5，累计记录等内部/运营总量按其明确边界显示。

## 10 动效绑定

- 任务日志/通知/区域名/教程使用可复用斜切滑入、弹性、红/青语义条和 `list-reflow`；不要为每条通知做新过渡。
- 新目标从侧边进入并短暂橙色高亮；完成目标先显示投影完成，再绿色确认和列表重排。
- 通知按优先级排队，合并同类事件并刷新停留时间；高优先级短暂提升显著性但不遮挡不可取消的确认。
- 区域名居中短暂显影后退出；教程只高亮当前一步，其他控件以 disabled overlay 视觉呈现但不篡改 projection。
- 成就/图鉴解锁可用轮廓显影、少量金银高光；后置页面不因空数据播放“解锁成功”。

## 11 输入无障碍

快捷键：`J` 任务日志、`T` 切换追踪、`N` 通知历史、`F1` 帮助、`K` 图鉴、`Esc` 关闭当前 overlay；`Tab`/方向键/Enter/Space 完成所有同义操作。焦点进入任务列表/对话/教程后有焦点范围，关闭归还触发控件。屏幕阅读器播报任务标题、目标状态、通知优先级、教程下一步、锁定原因和空状态。图标、颜色、文本、材质并行表达。

## 12 加载错误超时

任务、通知历史、统计/成就/图鉴/回顾连接中显示“正在读取”；空列表显示明确空态；锁定项显示解锁条件来自 projection；错误显示原因、重试和返回。目标投影缺距离时隐藏距离槽位而不是写假值。通知队列加载失败不阻塞主操作，区域标题资源失败落到文字；请求 timeout/stale/rejected 都有可读状态和恢复路径。

## 13 明确不做

不实现任务条件、奖励结算、成就判定、图鉴解锁、统计累计、路径寻路、方向计算、社交关系、日历推进、技能树规则、NPC 档案规则或地图快速旅行。后置模块不扩成完整产品页面；不把通知当作业务成功回调；不把 `editor`、`research-bench`、`material-library`、`computer` 的内部控制台投喂进本 RPG 信息层。

## 14 依赖交接

宿主提供各模块 `StateSnapshot` 子树、事件可见性、稳定语义 ID 和 ActionPort；生成 AI 只提供组件、mock fixtures、焦点和 intent callbacks。后续接线应能以同一组件树替换 mock→projection，不更改文字语义、快捷键、aria labels 或结果反馈。任务/成就/统计数据的所有权仍在对应业务域，页面只消费只读摘要。

## 15 验收条件

- 任务、目标、教程、帮助、通知、区域名及后置信息页均有 ready/empty/locked/error/pending 的明确出口。
- 同屏并列选择不超过 5，任务列表可分页/滚动，通知不无限堆叠；`J/T/N/F1/K/Esc` 与 Tab/方向键路径可用。
- 页面不因空 projection 发明任务、奖励、成就或图鉴事实；所有结果带 mock/projection 来源。
- 动效只重演已确认事件，reduced motion、资源失败、timeout、rejected/stale 均可读且可恢复。
- RPG 层可与对话框、HUD 和驻地共存，不出现第二套路由、规则状态树或四类内部工具 UI。

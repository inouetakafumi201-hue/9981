# R-03 叙事、对话与字幕重写 brief

## 1 页面定位

生成 WakeUp 的模块化叙事对话层：单句和连续对话、说话人立绘、名字栏、打字机、选项、字幕、语音和可恢复降级。它可以在驻地、对局、证据提交等页面上叠加，但不是独立剧情引擎，也不拥有任务、奖励、关系或暂停规则。任何实例都可以成为说话人，前端只呈现宿主给出的只读对话投影。

对话视觉采用强烈的斜切滑入和空间层次，但仍遵循像素前景+半透明全息光层；立绘完整显示优先，允许被对话框部分遮挡，不允许用裁切填满固定框而损坏人物可读性。

## 2 权威来源（attachmentId/provenance）

- `G-01-project-and-scope-contract`：对话为 UI-only 模块、intent 边界和排除系统。
- `G-03-ui-port-contract`：`dialog.choose`、requestId、结果态和只读 snapshot。
- `G-04-interaction-accessibility`：选项、键盘/手柄、焦点归还和同屏上限。
- `G-05-motion-audio-fallback`：动画/音频事件、跳过和 fallback。
- `presentation-dialog-06` / `references/source/presentation-dialog-06.md`：对话布局、立绘降级、打字机、选项、语音和字幕。
- `presentation-rpg-07` / `references/source/presentation-rpg-07.md`：对话与任务/教程/通知模块的共存边界。
- `operations-narrative-evidence-05` / `references/source/operations-narrative-evidence-05.md`：证据提交的警官反馈复用对话模块。

## 3 当前决策

- 说话人显示 `displayName`，不是 entity id。对话数据来自 `speaker`、`text`、`options`、`imageRef`、`voiceRef`、`autoAdvance`、`subtitles` 等投影字段。
- 立绘降级顺序：指定 image → 该实例第一张 portrait → 第一张 sprite/icon → 无左图，仅名字栏和文本。明确的 `imageRef: null` 也表示不使用左侧图像。所有路径保留对话框结构。
- 立绘使用等比 `contain` 和安全区完整显示，不使用 `object-fit: cover` 作为默认；对话框可以覆盖立绘以形成层次，但不能把人物裁成头像卡。
- 最多同时显示 4 个对话选项，任何页面并列选择总数仍不超过 5。玩家选项只提交 intent，不使用 UI 内嵌业务 `onSelect` 回调。
- 语音可选，文本/字幕始终是可用通道。定时自动推进与手动继续都要可读；关键演出是否强制由投影策略给出，前端不得自行改规则。

## 4 状态机

- 句子：`hidden → entering → typing → waiting → advancing → exiting → hidden`。
- 打字：`typing → complete | skipped`；点击/Enter/Space 在 typing 时显示全文，在 complete 时推进。
- 选项：`options-hidden → options-focused → selected → pending → accepted | rejected | stale | timeout`。
- 立绘：`loading → resolved | fallback | absent`；换说话人为 `fade-out → replace → fade-in`。
- 语音：`idle → loading → playing → stopped | ended | unavailable`；语音失败不阻塞文本。

## 5 组件树

`NarrativeLayer → DialogFrame → PortraitSlot + NamePlate + TextRegion + SubtitleRegion + OptionList + AdvanceHint + VoiceIndicator + LiveRegion`。

证据提交可组合 `EvidenceSlotSurface + DialogFrame`，警官依旧走同一个对话组件，不创建第二套播放器。`FocusScope` 包住选项和确认；背景游戏 UI 是否继续显示由宿主 snapshot 的 overlay policy 决定。

## 6 只读数据

```ts
interface DialogSnapshot {
  source: 'mock' | 'projection';
  revision: number;
  speaker: string;
  displayName: string;
  text: string;
  options: readonly { id: string; label: string; enabled: boolean; reason?: string }[];
  imageRef?: string | null;
  voiceRef?: string | null;
  autoAdvance: boolean;
  subtitles: boolean;
  canSkip: boolean;
}
```

还可读 `portraitRefs`、`spriteRefs`、`currentOption`、`lineIndex`、`announcementText` 和 `visibility`。文本内容、选项权限、说话人身份和自动推进策略必须来自投影/fixture，不能从本地文本或图片推断。

## 7 动作意图

- `dialog.advance`：继续下一句或结束当前句。
- `dialog.skip-typewriter`：仅把当前句显示完整。
- `dialog.choose`：提交 `{optionId}`，等待 `accepted/rejected/stale/timeout`。
- `dialog.close`：仅在宿主允许关闭时发出。
- `dialog.replay`、`settings.subtitles` 和 `settings.voice`：分别请求重播或预览设置。

鼠标、键盘、手柄、触控和屏幕阅读器都调用同一 intent builder。选择后不要本地推进任务、奖励、关系或证据链。

## 8 本地 UI 状态

允许 `isTyping`、visibleCharacterCount、focusedOptionIndex、pendingRequestId、portraitLoadState、voicePlaybackState、autoAdvanceProgress、subtitleVisible、reducedMotion 和 focus return target。不要保存对话分支事实、任务完成、奖励、关系变化、说话人 displayName 的权威副本或宿主是否暂停。

## 9 视觉令牌

- 名字栏、文本区和选项保持明显层级：对话框主体为半透明深色层，名字栏有可读的高光装饰，选项以独立高对比行显示。
- 说话/社交语义优先青色；危险/失败文字用红色；当前焦点用白/青边缘光；不要借新主色表达角色关系。
- 立绘完整显示，左侧安全区与对话框共享屏幕但不挤出边界；短句、长句、字幕和大字号都可重排。
- 选项行最多 4 条可见；超过时使用可滚动、分页或分组，保留当前焦点和读屏顺序。

## 10 动效绑定

- 入场：立绘从左侧滑入；主体由右下方斜切滑入；名字栏装饰线扫入；文本逐字显示。出场反向淡出/斜切离场。
- 同一说话人切句保留立绘稳定，只更新文本；说话人变化做立绘淡出/平移/淡入和名字栏刷新。
- 选项 hover/focus 向右偏移、边缘变亮；确认后当前项给短促高光，其余项收束；拒绝/超时使用回弹和原因，不播成功演出。
- 打字机使用可取消的逐字阶段；点击、Enter 或 Space 跳到全文。语音播放只同步表现进度，不决定是否推进。
- 证据提交的警官反馈复用同一组件，槽位和对话可以同屏，但不创建“文本播放器”绕过验证。

## 11 输入无障碍

Tab/Shift+Tab 进入说话人文本、选项和继续控件；方向键上下移动选项；Enter/Space 确认；数字 1–4 选择对应可见选项；Esc 取消当前 overlay（不得隐式提交）。屏幕阅读器读出说话人、文本、当前焦点、disabled reason、pending 和 rejected reason。字幕开关、语音开关和跳过控件可聚焦。动画 reduced motion 时保留阅读顺序和文字结果。

## 12 加载错误超时

立绘和语音加载有 loading 状态和超时；立绘按降级链替换，最终允许无图；语音失败保持文字/字幕并提供重试或静音状态。对话投影请求超时显示重试、取消或安全返回，不自动选择选项。文本为空、选项为空或快照过期显示结构化空/错误状态，而不是永久等待。

## 13 明确不做

不实现对话树规则、任务/奖励/关系写入、UGC DSL 执行、角色创建、立绘自动生成、图片裁切填充、音频隐藏信息泄露、自动本地暂停或不受宿主控制的自动推进。不把 `imageRef`、voice path、speaker id 当成后端路径让生成 AI 猜测。`editor`、`research-bench`、`material-library`、`computer` 内部页面不在本 brief 中生成。

## 14 依赖交接

宿主提供 `DialogSnapshot` 或等价投影、`StatePort`、`ActionPort` 和可选 asset/audio resolver；生成组件只消费 props 和回调。资产方提供 portrait/sprite manifest，缺失时由 `PortraitSlot` fallback。后续接线保持组件签名、intentId、aria 标签、焦点顺序和同屏布局不变。证据提交方只交警官 snapshot 和槽位结果，不改对话组件所有权。

## 15 验收条件

- 单句、连续换人、无立绘、指定立绘失败、语音缺失、长文本、4 选项、无选项和自动推进都可独立演示。
- 立绘完整显示优先；没有图像时仍有名字栏、文本、字幕和可继续路径。
- 选择只产生 intent/requestId，结果态可见，rejected/stale/timeout 不会误推进剧情。
- 键盘、手柄、触控和屏幕阅读器等价；Esc 不隐式提交，选项同屏不超过 4。
- 打字机/语音可跳过，reduced motion 可用，任何资源失败都不把页面变成空白。

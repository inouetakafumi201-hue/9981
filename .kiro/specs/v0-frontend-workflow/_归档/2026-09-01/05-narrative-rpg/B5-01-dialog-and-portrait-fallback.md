# B5-01 对话与立绘降级 Prompt

## 1 页面定位

本 Prompt 交付叙事对话表面：`dialog-line` 与 `dialog-options`。它是叠在游戏世界上的舞台演出层，不是网页 modal。表现包括说话人立绘、可变 `displayName`、名字栏、正文、语音字幕、打字机、定时/不定时推进、最多 4 个对话选项和完整的立绘降级链。

对话可由任何实例投影触发，默认不暂停世界；UI 只呈现投影并提交 `dialog.*` intent。所有同屏选项不超过 5，实际对话选项最多 4；超过 4 项由端口提供分页结果。允许使用角色立绘、贴图、图标、占位头像、名字首字母牌和语音素材，不以“零素材”实现对话。

## 2 权威来源（只写 attachmentId/provenance）

- `attachmentId: "narrative-dialog-system"`
- `provenance: "docs/表现系统/06_叙事对话框系统.md；P5 布局、降级检索、displayName、打字机、语音、字幕、选项和默认不暂停"`
- `attachmentId: "dialog-rendering-implementation"`
- `provenance: "docs/表现系统/08_技术栈与代码生成画面.md；对话动效、Radix 行为、dialogStore 与 Howler"`
- `attachmentId: "dialog-fallback-placement"`
- `provenance: "docs/表现系统/09_图形化实现落点.md；imageRef → portraits → sprites/icon → fallback、contain、层级和语音落点"`
- `attachmentId: "narrative-rpg-workflow"`
- `provenance: ".kiro/specs/v0-frontend-workflow/prompts/05-narrative-rpg/B5-00-narrative-rpg-prompt.md；共同只读投影、同屏≤5 与 intent 边界"`

## 3 当前决策

- 名字栏永远读取说话实例当前的 `displayName`，绝不把内部 `id` 当玩家可见名字；`displayName` 改变时名字栏跟随新的投影 revision 更新。
- 立绘检索顺序固定为：模块指定 `imageRef`（明确为 `null` 时直接进入无立绘变体）→ 实例第一个 portrait → 实例第一个 sprite 或 icon → 无立绘降级。每一步都显示实际命中的素材来源标签，便于调试但不泄漏内部规则。
- 立绘使用完整显示策略，优先 `object-fit: contain` 和安全区缩放，不裁切角色主体；对话框覆盖立绘属于正常层级，立绘与对话框各自有明确 z-index。
- 语音为可选素材；有语音时字幕仍然可见，字幕与语音进度尽量同步；语音失败不阻断文字。无语音时保留字幕和打字机音效槽。
- 对话默认不暂停游戏。UI 不自行调用暂停；如果宿主投影明确给出暂停策略，UI 只显示其状态，不把策略写成组件业务逻辑。
- 所有继续、跳过、关闭和选项选择都只构造 intent。禁止在直接 `onSelect` 中执行任务、关系、奖励、分支或存档业务。

## 4 状态机

```text
closed
  └─ dialog-open → resolving-portrait
resolving-portrait
  ├─ imageRef-hit / portrait-hit / sprite-hit / icon-hit → entering
  ├─ no-image → no-portrait-fallback
  └─ asset-error → fallback-with-warning
entering
  └─ text-revealing
text-revealing
  ├─ local-reveal-complete → waiting-input
  ├─ voice-ended → waiting-input
  ├─ skip-reveal → waiting-input
  └─ line-revision-changed → speaker-switching → text-revealing
waiting-input
  ├─ advance-intent → intent-pending
  ├─ option-intent → intent-pending
  ├─ auto-advance-ready → intent-pending
  └─ close-intent → closing
intent-pending
  ├─ accepted → next-line-or-closing
  ├─ rejected → recoverable-error
  ├─ timeout → retry-or-close
  └─ resync-required → resolving-portrait
```

定时对话的自动推进只在投影声明可自动推进且文本完成后创建 intent；不定时对话显示“点击继续”。定时对话不可由本地整段跳过，不定时对话可按端口允许的 skip intent 跳过。

## 5 组件树

```text
<DialogSurface>
  ├─ <DialogWorldScrim />
  ├─ <PortraitStage>
  │   ├─ <PortraitAsset />
  │   ├─ <PortraitSourceBadge />
  │   └─ <PortraitFallback />
  ├─ <DialogBody>
  │   ├─ <SpeakerNameBar displayName={...} />
  │   ├─ <DialogText typewriter />
  │   ├─ <VoiceSubtitleLane />
  │   └─ <AdvanceCue />
  ├─ <DialogOptions options={最多4} />
  └─ <DialogIntentStatus />
</DialogSurface>
```

`PortraitFallback` 不是空白占位：它保留名字首字母、语义背景、名字栏、字幕和可挂接的占位头像素材；实际素材恢复后只替换视觉源，不改变对话语义。

## 6 只读数据

```ts
interface DialogProjection {
  readonly dialogId: string;
  readonly revision: string;
  readonly speakerId: string;
  readonly displayName: string;
  readonly text: string;
  readonly imageRef?: string | null;
  readonly portraits: readonly string[];
  readonly sprites: readonly string[];
  readonly icon?: string;
  readonly voiceClip?: string;
  readonly subtitle: string;
  readonly autoAdvance: boolean;
  readonly pausePolicy: 'not-paused' | 'host-requested';
  readonly options: readonly DialogOptionProjection[];
  readonly allowedIntents: readonly string[];
}

interface DialogOptionProjection {
  readonly optionId: string;
  readonly label: string;
  readonly disabled: boolean;
  readonly disabledReason?: string;
}
```

`displayName`、字幕、选项文本和素材引用均为只读；组件不得从 `speakerId` 推导名字、从本地选中项推导规则结果或读取回调闭包。

## 7 动作意图

```ts
type DialogUiIntent =
  | { readonly kind: 'dialog.reveal-complete'; readonly dialogId: string }
  | { readonly kind: 'dialog.advance'; readonly dialogId: string }
  | { readonly kind: 'dialog.option.select'; readonly dialogId: string; readonly optionId: string }
  | { readonly kind: 'dialog.skip-line'; readonly dialogId: string }
  | { readonly kind: 'dialog.close'; readonly dialogId: string };
```

点击、Enter、Space、数字键或自动推进都只产生上述意图，并由宿主端口返回 `accepted/rejected/timeout/resync-required`。不得直接把选项选择绑定为 `givePlayerQuest`、`addReputation`、`showNextDialog` 或其他业务调用；业务执行不属于本 Prompt。

## 8 本地 UI 状态

允许的本地状态：`portraitSource`（四步检索的当前命中）、素材加载态、文字已显示长度、当前高亮选项、语音播放/暂停/失败态、字幕显隐、自动推进倒计时的视觉进度、焦点来源、reduced-motion 和 intent pending 标记。语音播放句柄必须可停止；本地倒计时结束只能创建 intent，不能自行推进规则。

## 9 视觉令牌

- 对话主体使用暗调半透明黑底、奶白正文、红色斜条名字栏；当前说话人使用高亮，非当前素材若存在只做降饱和。
- 立绘是可使用的视觉素材，显示在安全区内并保留完整比例；`imageRef`、portrait、sprite、icon 和名字首字母牌都可以挂接。
- 语音状态用蓝/青辅助色，字幕必须与正文有清晰层级；加载、缺失、失败分别有文字和图标，不只依靠颜色。
- 选项使用黑底、白字、红色侧边和序号；同屏最多 4 个选项。hover 右移并加强侧边，focus 有 Radix 焦点环，disabled 扁平降饱和。
- 禁止把对话框做成统一圆角卡片、白底表单或网页滚动弹窗。

## 10 动效绑定

- 入场：立绘从左侧滑入，对话主体从右下斜切滑入，名字栏斜条扫过，正文按投影节奏打字；使用 Framer Motion 的 `AnimatePresence`、spring 和 transform。
- 出场：主体向右上斜切滑出，立绘向左滑出；整段跳过使用更短的淡出，但仍先得到允许的 skip 视觉 intent 结果。
- 换说话人：旧立绘淡出左移，新立绘淡入，名字栏重扫，文本按 revision 切换；同一说话人只更新必要内容，不重播整套舞台。
- 语音开始、字幕进度和打字机音效在表现层同步；音频失败只触发 fallback 状态。`prefers-reduced-motion` 下保留焦点、字幕和状态确认。

## 11 输入无障碍

- 使用 Radix Dialog/RovingFocusGroup 或等价可访问行为；对话出现时焦点进入可操作区域，关闭后归还触发点。
- Tab 可遍历继续、关闭、选项和字幕控制；Enter/Space 激活当前视觉触发器；↑/↓ 移动选项；数字键 1-4 选择对应高亮项；Esc 发送关闭 intent。
- 打字机中 Enter/Space 首次只完成当前文本显示，下一次才产生推进 intent；定时条提供 `aria-valuenow` 等价语义但不把倒计时读成业务结果。
- 语音字幕使用 `aria-live="polite"`，说话人和正文使用明确的 heading/description 关系；字幕不会因为语音失败而消失。

## 12 加载错误超时

- 对话投影加载中显示对话框轮廓和可读加载状态，不显示伪造文本或已确认选项。
- `imageRef`、portrait、sprite、icon 依次加载失败后进入无立绘 fallback；每个失败保留名字栏、正文、字幕和可挂接素材位。
- 语音加载失败只显示字幕并停止音频同步；打字机失败时仍显示完整正文和“继续”控制。
- intent 被拒绝、超时或要求重同步时显示明确状态并提供重试/关闭；重试不能在本地推进下一句。对话默认保持世界运行。

## 13 明确不做

- 不把 `displayName` 替换为内部 id，不裁切立绘，不删除可挂接素材，不以零素材断言替代 fallback。
- 不在直接 `onSelect` 中执行任务、关系、奖励、剧情分支、存档或暂停；选项只提交 intent。
- 不实现对话树规则、任务结算、镜头路径、地图、节点、编辑器、研究台、素材库或电脑内部界面。
- 不默认暂停游戏；不把语音播放完成、打字机完成或动画结束当作业务确认。
- 不让同屏选项超过 4，不用统一网页卡片/白底表单替代舞台式对话。

## 14 依赖交接

- 对话投影端口提供 `speakerId`、当前 `displayName`、文本、`imageRef`、portraits、sprites、icon、voiceClip、subtitle、autoAdvance、pausePolicy、options 和 revision。
- 意图端口提供 reveal-complete、advance、option-select、skip-line、close 的 accepted/rejected/timeout/resync 结果；UI 不接收业务回调闭包。
- 素材端口提供各级图片/头像/图标、尺寸元数据、加载状态和 fallback 标识；允许实际角色立绘、贴图和语音素材挂接。
- Howler 音频端口提供语音、打字机、出现/消失与选项音效句柄及停止结果；UI 不改变全局混音策略。
- 壳层交接提供世界层挂载、对话 z-index、Radix 焦点归还、同屏≤5 和 `dialog.*` intent dispatcher。

## 15 验收条件

- [ ] `imageRef → portraits[0] → sprites[0]/icon → 无立绘` 降级链可逐级演示，显示完整立绘且允许素材挂接。
- [ ] 名字栏跟随 `displayName`，语音字幕可见，语音失败不阻断正文，默认不暂停世界。
- [ ] 打字机、点击完成、定时/不定时推进、选项最多 4 项、数字键 1-4、↑/↓、Enter 和 Esc 可验证。
- [ ] 选项/继续/跳过/关闭均只提交 intent，没有直接 `onSelect` 业务逻辑；宿主结果驱动下一状态。
- [ ] P5 斜切滑入、立绘切换、打字机和退出动效使用 Framer Motion；Radix 焦点与读屏语义完整。
- [ ] 图片、语音、投影、intent 拒绝、超时和重同步错误均有可见 fallback，且不伪造对话推进。
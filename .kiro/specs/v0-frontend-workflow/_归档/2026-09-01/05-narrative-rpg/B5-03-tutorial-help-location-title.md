# B5-03 教程帮助区域名 Prompt

## 1 页面定位

本 Prompt 交付教程、帮助和区域名三类信息引导表面：首次遇到机制时的教程演示、`F1` 帮助菜单/教程重放、悬浮与上下文提示，以及进入新区域时的中央区域名演出。它们负责降低认知负担和建立空间语境，不负责替玩家执行操作，不直接推进玩法。

教程弹窗必须保持游戏演出感，允许使用教程示意图、操作键图标、区域徽记、环境素材和装饰贴图；帮助条目可使用图标和分类素材。区域名叠在世界层之上，不能变成网页标题栏。教程条目、帮助类别、操作步骤和同屏可见区域提示每组不超过 5；超出使用分页、滚动或分段显示。

## 2 权威来源（只写 attachmentId/provenance）

- `attachmentId: "rpg-tutorial-system"`
- `provenance: "docs/表现系统/07_RPG叙事与引导系统全览.md；教程触发、教程类型、F1 帮助、进度追踪、渐进披露与重放"`
- `attachmentId: "rpg-location-title"`
- `provenance: "docs/表现系统/07_RPG叙事与引导系统全览.md；区域名首次进入触发、字幕、副标题、首次探索徽章和演出"`
- `attachmentId: "tutorial-accessibility-toolchain"`
- `provenance: "docs/表现系统/08_技术栈与代码生成画面.md；Radix Dialog/Tooltip、教程进度 Zustand persist、区域名 Framer Motion"`
- `attachmentId: "tutorial-location-visual-placement"`
- `provenance: "docs/表现系统/09_图形化实现落点.md；区域名斜切滑入、教程材质、素材与声音交接"`
- `attachmentId: "narrative-rpg-workflow"`
- `provenance: ".kiro/specs/v0-frontend-workflow/prompts/05-narrative-rpg/B5-00-narrative-rpg-prompt.md；共同状态、素材允许和 intent 边界"`

## 3 当前决策

- 教程分为弹窗教程、悬浮解释、上下文提示、引导箭头/高亮提示；本 Prompt 只负责呈现投影中的提示，不自行判断“首次遇到”或交互对象距离。
- `F1` 打开帮助菜单，教程重放只提交 `tutorial.replay` intent；已看教程集合是投影或持久化端口的结果，UI 不直接写 localStorage 作为业务进度。
- 教程按钮“明白了”“查看更多”“稍后”是视觉触发器；它们不直接调用 `closeTutorial`、`openHelp` 或规则函数。
- 区域名在新区域进入的投影事件后显示中央标题、副标题、区域语义色和可选“首次探索”徽章；UI 不通过本地路径或坐标判断进入区域。
- 区域名演出期间世界仍保留可见环境层；是否暂停、是否切换音乐由宿主投影和音频端口决定，默认不暂停。
- 允许使用教程示意图、区域标识、操作键图和环境素材；素材缺失时保留布局、文字和语义 fallback。

## 4 状态机

```text
idle
  ├─ tutorial-triggered → tutorial-loading
  ├─ help-open-intent → help-loading
  └─ location-projection → location-entering
tutorial-loading
  ├─ ready → tutorial-presenting
  ├─ missing-asset → tutorial-presenting-with-fallback
  ├─ error → error
  └─ timeout → retry-or-close
tutorial-presenting
  ├─ acknowledge-intent → intent-pending
  ├─ more-help-intent → intent-pending
  ├─ replay-progress → intent-pending
  └─ close-intent → closing → idle
help-loading
  ├─ ready → help-presenting
  ├─ error → error
  └─ timeout → retry-or-close
help-presenting
  ├─ category/page-change → help-presenting
  └─ close-intent → closing → idle
location-entering
  ├─ asset-ready → location-hold
  ├─ asset-fallback → location-hold
  └─ hold-complete → location-exiting → idle
```

区域名的停留和退出是视觉时序；只有宿主确认的投影事件才能进入 `location-entering`。教程重放和帮助切换不会把教程标记为已看，除非投影返回确认。

## 5 组件树

```text
<TutorialHelpLocationSurface>
  ├─ <WorldPresentationLayer />
  ├─ <TutorialOverlay>
  │   ├─ <TutorialTitle />
  │   ├─ <TutorialAsset assetRef />
  │   ├─ <TutorialBody />
  │   ├─ <TutorialStepList maxVisible=5 />
  │   └─ <TutorialIntentActions />
  ├─ <HelpPanel>
  │   ├─ <HelpCategoryList maxVisible=5 />
  │   ├─ <HelpEntryList maxVisible=5 />
  │   └─ <HelpDetail />
  ├─ <ContextHintAnchor />
  ├─ <InteractionHighlight />
  └─ <LocationTitleOverlay>
      ├─ <LocationBadge assetRef />
      ├─ <LocationTitle />
      ├─ <LocationSubtitle />
      └─ <FirstExplorationBadge />
</TutorialHelpLocationSurface>
```

帮助面板和教程弹窗共享焦点与 intent 状态，但不共享“已看”写入逻辑。上下文提示依附世界锚点，区域名依附进入事件，不创建网页导航。

## 6 只读数据

```ts
interface TutorialProjection {
  readonly tutorialId: string;
  readonly title: string;
  readonly body: string;
  readonly assetRef?: string;
  readonly steps: readonly TutorialStepProjection[];
  readonly seen: boolean;
  readonly allowedIntents: readonly string[];
}

interface HelpProjection {
  readonly revision: string;
  readonly categories: readonly HelpCategoryProjection[];
  readonly selectedEntryId?: string;
}

interface LocationTitleProjection {
  readonly eventId: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly decoration?: 'stripe' | 'none';
  readonly semanticTone: 'safe' | 'danger' | 'neutral';
  readonly firstExploration: boolean;
  readonly assetRef?: string;
}
```

步骤、帮助条目和区域文本全部是只读投影；UI 不从操作键推导动作、不从标题推导区域风险、不从 `seen` 本地变化推导持久化进度。mock 内容显式标记 `isMock: true`。

## 7 动作意图

```ts
type GuidanceUiIntent =
  | { readonly kind: 'tutorial.acknowledge'; readonly tutorialId: string }
  | { readonly kind: 'tutorial.more-help'; readonly tutorialId: string }
  | { readonly kind: 'tutorial.replay'; readonly tutorialId: string }
  | { readonly kind: 'tutorial.dismiss'; readonly tutorialId: string }
  | { readonly kind: 'help.open' }
  | { readonly kind: 'help.select-entry'; readonly entryId: string }
  | { readonly kind: 'help.close' };
```

上下文提示和高亮由宿主投影驱动；用户关闭提示只提交 dismiss intent。禁止直接 `onSelect` 调用玩法动作、设置已看状态、改变教程开关、移动角色或切换区域音乐。

## 8 本地 UI 状态

允许的本地状态：教程/帮助开合、当前帮助类别和条目、教程当前步骤、上下文提示可见性、区域名演出的时间进度、素材加载态、键盘焦点、reduced-motion、intent pending 和错误展开。`seen`、教程完成、区域已探索和音乐切换结果必须以宿主投影为准。

## 9 视觉令牌

- 教程弹窗使用暗调半透明底、红色斜条或语义色边缘、奶白正文，允许插入示意图和操作键素材；不使用白底表单。
- 帮助面板按分类使用蓝/青等信息色，当前条目有边缘辉光，未可用条目灰化并说明原因。
- 上下文提示依附目标附近，使用小型 tooltip 或世界标记，必须不遮挡关键场景；高亮边缘使用黄/橙语义。
- 区域名使用大标题、红/绿/灰语义色、斜切装饰和可选区域徽记；“首次探索”使用小型徽章，不做长期数值条。
- 教程图、操作键图、区域徽记均可挂接素材；错误素材使用文字和通用图标 fallback。

## 10 动效绑定

- 教程弹窗从触发位置以斜切和弹性进入，步骤切换使用局部重排；确认/关闭回到触发位置，不重载世界。
- 帮助面板使用 `AnimatePresence` 做类别和条目局部切换，重播只播放演出，不先改变进度。
- 上下文提示由世界锚点短距离淡入/滑入；高亮边缘使用可停止的轻脉冲，不能持续制造干扰。
- 区域名按“左侧斜切滑入 → 停留 → 右侧斜切滑出”编排，首次探索徽章在投影标记下出现；`prefers-reduced-motion` 保留标题和语义顺序，取消大位移。

## 11 输入无障碍

- `F1` 打开帮助，Esc 关闭教程/帮助；Radix Dialog 管理模态焦点、`aria-modal`、标题、描述和焦点归还。
- 教程按钮和帮助条目支持 Tab、Enter、Space；帮助类别支持方向键；上下文提示支持 hover/focus 且不能只对鼠标可见。
- 教程步骤、操作键和区域标题使用可读文本；示意图和区域素材提供 alt/aria-label。颜色和动效不作为唯一提示。
- 区域名使用 `aria-live="polite"` 播报标题和副标题一次；教程正文、帮助详情和上下文提示使用明确的 heading/description 关系，动态提示不抢占焦点。

## 12 加载错误超时

- 教程、帮助和区域名投影加载中显示带标题的 skeleton 或轮廓，不显示伪造的已看、已探索或已完成状态。
- 教程示意图和区域徽记失败时保留标题、正文、步骤、副标题和语义图标；素材恢复只更新视觉源。
- 帮助投影错误、区域事件过期和 intent 被拒绝/超时/重同步时显示明确状态，提供重试、关闭或返回；UI 不自行标记教程已看或区域已探索。
- 区域名音频或音乐交接失败不阻断标题演出；默认保持世界运行，重试不重复提交区域进入业务。

## 13 明确不做

- 不直接执行教程操作、移动角色、打开门、改变设置、标记已看、切换音乐或推进区域规则。
- 不在直接 `onSelect` 中调用 `closeTutorial`、`openHelp` 或任何业务函数；按钮只提交 intent。
- 不实现地图、节点、拓扑、寻路、路径成本、编辑器、研究台、素材库或电脑内部界面。
- 不把区域名做成网页标题栏，不用白底 dashboard，不移除可挂接教程/区域素材，也不以零素材说法替代 fallback。
- 不让教程条目、帮助条目、步骤或区域提示的同屏并列超过 5。

## 14 依赖交接

- 教程端口提供触发时机、教程 id、标题、正文、步骤、assetRef、seen 和允许 intent；UI 不判断首次遇到条件。
- 帮助端口提供分类、条目、详情、revision 和重放结果；持久化进度由端口负责，UI 不直接写 localStorage。
- 区域名端口提供进入事件、标题、副标题、语义色、首次探索标记、区域徽记 assetRef 和音频交接状态；UI 不计算区域进入。
- Radix Dialog/Tooltip/Toast 提供焦点、Esc、hover/focus、aria-live 行为；Framer Motion 提供区域名和教程演出；Howler 只由音频端口管理。
- 壳层交接提供世界层挂载、F1/Esc 路由、素材 loader、同屏≤5 和 intent dispatcher。

## 15 验收条件

- [ ] 教程弹窗、F1 帮助、上下文提示/高亮和区域名进入演出均可演示，允许教程图与区域素材挂接。
- [ ] 教程重放、明白了、查看更多、帮助筛选和关闭都只提交 intent；seen/first exploration 由投影确认。
- [ ] 区域名按左入、停留、右出演出，默认不暂停世界；错误音频不阻断文字标题。
- [ ] 同屏教程步骤、帮助列表、提示和区域提示均≤5，超出使用分页、滚动或分段。
- [ ] Radix 焦点陷阱、焦点归还、F1/Esc/Tab/Enter/Space、hover/focus tooltip 和 live region 可验证。
- [ ] 投影、素材、音频、intent 拒绝、超时和重同步均有可见处理，且不伪造已看/已探索结果。
# B2-02 Action Cards and Target Context

## 1. 页面定位

本 brief 定义 `hud-main` 的动作选择表现层：玩家从底部扇形行动卡手牌中选择动作，悬停/聚焦读取详情，单击沿无目标或有目标路径产生 intent。它替换旧的按钮纵列、并排方框、滑块堆叠和选项卡切页，但不改变动作 descriptor、目标 descriptor、intent factory 或任何规则契约。

动作卡是“我能做什么、花多少 AP、对谁生效”的低心智入口。投点的强力骰与逆转滑块不属于本 brief 的行动卡选择；它们由 B2-03 独立呈现。世界、当前行动者和目标实体仍是空间锚点，卡手牌是附着在场景底部的操作层。

## 2. 权威来源

- `hud-action-cards-addendum` / `prompts/02-battle-hud-action-cards-addendum.md`：扇形手牌、付费/零费分区、悬停详情和目标两级跳转，已完整吸收。
- `presentation-ui-authority` / `docs/表现系统/01_图形化与UI.md`：动作语义色、上下文目标、攻击预览、零费切换和输入等价。
- `frontend-port-contract` / `00-global/G-03-ui-port-contract.md`：`battle.select-action`、`battle.select-target` 的 intent 边界和结果态。
- `frontend-accessibility` / `00-global/G-04-interaction-accessibility.md`：输入等价、≤5、Radix、五态。
- `frontend-visual-tokens` / `00-global/G-02-visual-token-contract.md`：语义色、材质、素材位和错误 fallback。
- `hud-legacy-baseline` / `prompts/02-battle-hud.md`：付费/零费行为与 AP 耗尽态，已按行动卡形态重写吸收。
- `hud-visual-quality-addendum` / `prompts/02-battle-hud-visual-quality-addendum.md`：反网页构图、材质和动效硬约束，已完整吸收。

## 3. 当前决策

- 付费动作渲染为底部居中、以当前行动者/当前目标为锚的 `paid-action-hand` 扇形手牌。卡片允许遮挡、偏移、斜切、重叠和层级差，不能成为等大矩形卡墙。
- 零费动作渲染为手牌侧沿的 `free-action-band` 窄带/悬浮徽章簇，与付费手牌空间分离，绝不混排。同一时间可切换两套舞台，但不同时平铺两套卡墙。
- 分级导航保持 `cost-category → interaction-intent → leaf`，使用现有分档和 ≤5 可见项限制。上一页/下一页/上一级作为手牌边缘锚点，不发明新枚举，不改 `buildMenuFaces`、`buildOptionSet`、`intent-factory`。
- 悬停任意卡片时局部放大、上浮、增强边缘光并在卡面就地展开详情：图标、显式成本菱形、目标意图、可用性和不可用原因。详情不是新弹窗，不遮挡地图。
- 无目标动作（意图为 none/self 或 projection 明确无目标）单击后卡片飞向当前行动者/目标事件锚点并发送 intent；有目标动作单击后卡吸附光标/目标上下文层，实体/节点候选高亮，二次点目标发送 intent；点击空白或 Esc 取消。
- 有目标选择只允许选择 projection 提供的候选，不本地判定可达、射程、命中、伤害、AP 或目标关系。目标高亮应同时使用颜色、轮廓、图标和文字/aria 说明。
- AP 成本和 SP 成本仅显示 descriptor 显式字段；行动卡不从本地 AP 计算灰态。强力骰/逆转不是卡面，不以卡牌选择或卡面成本出现。
- AP 耗尽时由投影确认后自动切换零费带，并显示 3 秒结束回合视觉倒计时与结束回合 intent；倒计时不自行提交规则、不把时间到当作 accepted。

## 4. 状态机

```text
hand-hidden
  -> paid-hand-visible | free-band-visible
  -> card-hovered | card-focused
  -> card-detail-open

card-detail-open
  -> no-target-flight -> intent-pending
  -> target-selection
  -> hand-return

target-selection
  -> candidate-focused
  -> target-intent-pending
  -> blank-cancelled -> hand-return
  -> stale | rejected | timeout -> recoverable-error -> hand-return

intent-pending
  -> accepted -> result-animation -> hand-return-or-next-snapshot
  -> rejected -> card-rebound
  -> stale -> selection-cleared
  -> timeout -> retry-or-cancel
```

每张卡闭合 `hover / focus / active / disabled / return`；不可用卡扁平、无高光、说明原因。pending 只表示请求中；只有 accepted 或下一份确认 projection 才播放成功/飞出后的结果演出。

## 5. 组件树

```text
ActionSelectionSurface
├─ ActionHandStage
│  ├─ PaidActionHand
│  │  ├─ ActionHandNavigationAnchors
│  │  └─ PaidActionCard[]
│  └─ FreeActionBand
│     ├─ FreeActionToggle
│     └─ FreeActionCard[]
├─ ActionCardDetailLayer
│  └─ InPlaceActionDetail
├─ TargetContextLayer
│  ├─ CandidateHighlightLayer
│  ├─ TargetFocusList
│  ├─ AttackPreview
│  └─ BlankCancelSurface
├─ IntentFeedbackLayer
└─ ActionLiveRegion
```

`ActionHandStage` 只附着于世界底部/当前行动者附近，不能覆盖投点横条。`TargetContextLayer` 可跨越普通 HUD 进入实体层，但必须明确来源、目标和回收路径。

## 6. 只读数据

```ts
interface ActionCardsProjectionMock {
  readonly source: 'mock' | 'projection';
  readonly revision: string;
  readonly phase: 'player-action' | 'free-action' | 'spectator-readonly';
  readonly paidActions: readonly ActionCardDescriptorMock[];
  readonly freeActions: readonly ActionCardDescriptorMock[];
  readonly navigation: { readonly level: string; readonly canBack: boolean; readonly canNext: boolean };
  readonly targetCandidates: readonly TargetDescriptorMock[];
  readonly focusedActorId: string;
  readonly attackPreview?: AttackPreviewDescriptorMock;
  readonly apExhausted: boolean;
}

interface ActionCardDescriptorMock {
  readonly id: string;
  readonly label: string;
  readonly iconRef?: string;
  readonly cost?: { readonly kind: 'AP' | 'SP'; readonly value: number };
  readonly intent: 'traversal' | 'hostile-interaction' | 'precise-interaction' | 'executable-target' | 'none';
  readonly targetMode: 'none' | 'self' | 'entity' | 'node';
  readonly available: boolean;
  readonly unavailableReason?: string;
  readonly source?: 'mock' | 'projection';
}

interface TargetDescriptorMock {
  readonly id: string;
  readonly label: string;
  readonly entityKind: 'player' | 'npc' | 'item' | 'node' | 'vehicle';
  readonly intentColor: 'coral' | 'purple' | 'green' | 'blue' | 'gray-white';
  readonly available: boolean;
  readonly unavailableReason?: string;
  readonly assetRef?: string;
}

interface AttackPreviewDescriptorMock {
  readonly targetLabel: string;
  readonly weaponLabel?: string;
  readonly distance?: number;
  readonly dc?: number;
  readonly explicitOutcomeText?: string;
  readonly explicitCostText?: string;
}
```

所有 descriptor 是只读字段白名单。`available`、cost、targetMode、DC 和 outcome text 只能来自 projection；卡片不从其他字段推断。显示数字遵守项目可见数值边界，文本保持 descriptor 原义。

## 7. 动作意图

- `battle.select-action`：`{ actionId, source: 'paid' | 'free', intentId }`，仅描述选择的动作。
- `battle.select-target`：`{ actionId, targetId }`，仅描述投影候选和目标关系。
- `battle.cancel-target-selection`：取消本地目标选择，回到手牌；不发送规则取消。
- `battle.open-action-detail`：展开卡面显式详情，纯 UI intent。
- `battle.switch-action-category`：在付费/零费舞台间切换，纯 UI intent。
- `battle.navigate-action-level`：上一级/上一页/下一页，沿用既有分级导航。
- `battle.end-turn`：AP 耗尽后提交结束回合意图；只触发请求状态，不本地结束回合。
- `battle.inspect-target`：查看目标公开详情/攻击预览，不选择目标或执行动作。

鼠标 click、键盘 Enter/Space、手柄 confirm、触控 tap/long-press 均调用同一 intent builder。Esc、空白点击和触控取消只清除本地选择。

## 8. 本地 UI 状态

允许：手牌类别 `paid | free`、当前分级导航位置、hover/focus 卡、详情展开、扇形角度/层级、目标选择阶段、候选焦点、键盘来源→目标选择、局部 preview 可见、卡片 motion phase、pending requestId、reduced-motion profile。

禁止：本地扣 AP/SP、修改动作 availability、生成候选目标、计算目标范围/DC/伤害、推进动作结果、改变 inventory、把飞出动画当作 accepted。projection revision 改变时清除旧目标选择和过期详情。

## 9. 视觉令牌

- 付费手牌使用橙色 AP 或蓝色 SP 的局部边缘/菱形成本；零费使用绿色 `Free` 语义。近战目标珊瑚，远程/条件紫，安全/免费绿，精密交互按 descriptor 语义色，受限可用灰白，真正不可用灰色扁平无高光。
- 卡片采用斜切、断边、缺口、悬浮层、半透明多层光面，不共用统一圆角矩形 + 1px 边框。卡面图标可用 `iconRef`/合法素材，但不把素材贴成卡片背景。
- 详情在卡面局部扩展，显示图标、名称、显式成本、目标意图和原因；不可用原因必须同时有文字/图标/材质，不依赖颜色。
- 候选实体边缘脉冲、轮廓、目标徽记和关系线一起表达可选性；目标不是只变色。空白取消区保持世界可见，不放大成网页遮罩。
- 预览使用紫色远程点线、珊瑚近战接触范围、红色 projection 明示的伤害/致命后果，禁止本地推导和凭图标猜规则。

## 10. 动效绑定

- 手牌入场使用 `AnimatePresence` + spring，卡片错峰滑入并形成扇形；付费/零费切换在同一舞台用 `layout`，不整块闪现。
- hover/focus 使用局部 spring 放大、上浮、反光扫过和详情 `layoutId` 就地展开；不可用卡不弹出可用高光。
- 无目标卡从手牌飞向当前事件锚点；有目标卡以同一 `layoutId` 吸附到目标选择层，再回到手牌或结果锚点。发送请求后进入 pending，不能因为开始飞出就宣布成功。
- 候选目标按 intent 颜色脉冲，焦点迁移保持空间连续；accepted/projection update 后播放结果，rejected/stale/timeout 使用回弹/降光并保留原因。
- reduced motion 下保留卡片顺序、详情、目标候选、焦点和结果落点，缩短位移/闪烁/粒子；空白取消立即回到基线但要保留文字反馈。

## 11. 输入无障碍

- 每张卡是可访问按钮/列表项，读出名称、付费/零费分组、显式成本、目标模式、available 与 unavailable reason。最多 5 个同时可选项；分组导航也遵守 ≤5。
- Tab/Shift+Tab 进入手牌；方向键沿扇形顺序移动；Enter/Space 选择卡；数字快捷键只在 descriptor 显式允许且不与其他全局快捷键冲突时使用。
- 有目标动作进入 roving target focus：Tab/方向键/地图实体语义节点均可选；Enter/Space 确认目标；Esc、空白取消。提供“选择来源 → 选择目标 → 确认”的非拖拽路径。
- 悬停详情有 focus/long-press 等价；触控 tap 展开详情，第二次明确确认遵循同一动作路径；不要求 hover 才能知道关键成本或原因。
- live region 宣布「已选择动作，选择目标」「目标选择已取消」「请求中/已拒绝/数据已过期」；焦点在请求结束后回到卡片或安全结果区。

## 12. 加载错误超时

- 手牌 projection loading 显示扇形轮廓和 loading 文案，不显示伪造动作；assetRef 缺失保留卡片并显示动作名/语义图标 fallback。
- descriptor 缺少 `targetMode`、成本或可用原因时，卡片进入安全的 disabled/人工复核态，不猜测默认目标或成本。
- `pending` 超时显示重试/取消；`rejected` 显示宿主原因并回弹；`stale` 清除当前目标并要求重新读取；不重复执行旧 request。
- 目标中继失联显示「目标列表暂不可见（mock）」并保留退出/取消；不把空列表当作没有目标、不把不可见当作不可用。
- 攻击预览字段缺失只显示已知字段和「预览信息暂不可用」，不补写距离/DC/伤害。错误 live region 不抢夺连续操作焦点。

## 13. 明确不做

- 不实现动作规则、AP/SP 扣除、目标合法性、可达性、射程、命中、DC、伤害、弱点、奖励或任何业务回调。
- 不改 `ActionDescriptor`、`TargetDescriptor`、`PresentationDescriptor`、`option-set.ts`、`buildMenuFaces`、`buildOptionSet`、`intent-factory` 或 L2 契约。
- 不把行动卡做成均匀按钮纵列、并排卡片墙、选项卡、原生 range、独立确认弹窗或投点滑块。
- 不把空白取消实现为规则撤销，不把卡片飞出、目标高亮或预览当作成功，不把 hidden parry 做成状态图标。
- 不引入新的颜色、9-slice、Pixi/Three/WebGL 或未登记素材；不手工造贴图。

## 14. 依赖交接

- 依赖 B2-01 提供世界层、当前行动者锚点、HUD 安全区和固定组件挂载位。
- 依赖 B2-03 提供投点舞台，保持强力骰/逆转与行动卡完全分离；依赖 B2-04 提供 spectator readonly、淘汰、连接和结果禁用态。
- 依赖 G-03 稳定 `StatePort/ActionPort` 和 existing descriptor/intent 契约；若需要字段变化，登记交接项，不改上游实现。
- 依赖 manifest/assetRef 提供动作图标、实体、弱点和物品素材；缺失走本 brief 第 12 节 fallback。

## 15. 验收条件

- [ ] 付费动作是底部扇形手牌，零费动作是空间分离窄带；没有并排卡墙、按钮纵列或选项卡切页。
- [ ] 悬停/聚焦卡片在卡面就地显示详情、成本、目标意图和可用原因；不弹遮挡世界的大 tooltip。
- [ ] 无目标动作直接飞向事件锚点并提交 intent；有目标动作进入目标选择，点目标提交，点空白或 Esc 取消。
- [ ] 目标候选来自 projection；攻击预览只展示显式字段；近战/远程/免费语义有颜色以外的图标、文字或轮廓通道。
- [ ] 付费/零费互斥且 AP 耗尽自动呈现零费与结束回合请求；强力骰/逆转不出现在行动卡中。
- [ ] 五态、键盘/手柄/触控/读屏、≤5、pending/rejected/stale/timeout、reduced-motion 全部可演示。
- [ ] 代码不修改规则契约、不调用 OpRegistry、不本地计算 AP/伤害/目标，素材缺失不删除卡面。

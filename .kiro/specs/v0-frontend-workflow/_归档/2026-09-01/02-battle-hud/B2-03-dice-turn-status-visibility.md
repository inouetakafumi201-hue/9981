# B2-03 Dice, Turn, and Status Visibility

## 1. 页面定位

本 brief 定义 `hud-main` 的投点阶段、回合/轮次可见性、当前行动方、NPC 阶段、资源格和公开/低显著性/真隐藏状态的表现层。投点舞台附着在左侧轮次脊柱与当前行动者旁边，就地完成「投点 → AP/结果展示 → 排名视觉重排」的因果链；它不是独立居中的弹窗，也不是行动卡的一部分。

本 brief 只重演只读 projection 已确认的状态和视觉事件。强力骰与逆转是另一条离散 `0/1/2` 滑块契约，负责投点承诺/反制的显示与 intent；它们不能被实现为底部行动卡、动作成本或本地规则选择。UI 不计算投点、AP、排名、伤害、过载或状态效果。

## 2. 权威来源

- `presentation-ui-authority` / `docs/表现系统/01_图形化与UI.md`：轮次栏 D-036、投点三段式、资源格、回合结构、NPC、信息可见性、瞄准与招架。
- `presentation-elements-baseline` / `docs/表现系统/04_画面要素文档.md`：投点滑块、骰子悬空、横条、回合指示器和状态图标基板。
- `frontend-port-contract` / `00-global/G-03-ui-port-contract.md`：只读 snapshot、intent 和 pending/result 状态。
- `frontend-motion-fallback` / `00-global/G-05-motion-audio-fallback.md`：selection/trigger、结果动画、跳过和 reduced motion。
- `frontend-visual-tokens` / `00-global/G-02-visual-token-contract.md`：资源格颜色、信息层级与材质。
- `frontend-accessibility` / `00-global/G-04-interaction-accessibility.md`：滑块键盘等价、读屏、焦点和颜色外的语义通道。
- `hud-legacy-baseline` / `prompts/02-battle-hud.md`：旧 HUD 的投点、回合、资源与固定状态，已按当前契约吸收。
- `hud-visual-quality-addendum` / `prompts/02-battle-hud-visual-quality-addendum.md`：投点空间附着、材质和 Framer Motion 硬门禁，已按当前契约吸收。

## 3. 当前决策

- `fixed-turn-header` 显示 `回合 N｜阶段｜当前行动方`；玩家行动时显示「你的回合！剩余 AP: n」，NPC 阶段显示「NPC 行动阶段｜公开事件文本」。阶段、当前行动者和 AP 均来自 projection。
- `fixed-turn-spine` 按权威排名显示参与者；当前行动者反光高亮，玩家自身行更宽更粗，已行动者保留且降饱和。轮次重排只表现 projection 已确认的新顺序。
- 投点前骰子作为悬空事件锚点出现在当前行动者轮次框右侧，平时隐藏。投点后横条从轮次框/序号锚点向外生长，多人横向对比；横条不拥有固定上限框，只使用格状刻度，长度来自 projection 的公开点数。
- 投点滑块分别为 `power-die-slider`（强力骰，橙/主动加注语义）和 `reversal-slider`（逆转，紫/反制语义），均是离散推挡 `0 / 1 / 2`。`+3极限爆发` 为 deferred、future-evaluation-only，MVP 不可选；如保留视觉位必须置灰、无高光、不可聚焦和明确标注 deferred。
- 滑块选择必须有档位递增的 selection effect：0 静置灰白，1 轻微充能光晕，2 更浓语义光/粒子残影；确认投掷必须有 trigger effect：爆闪、一次性粒子/光脉冲，然后进入横条生长。效果是视觉演出，不等于规则触发成功。
- 横条使用三段式顺序：①灰白伸出；②强力骰参与者快速延伸并显示 `+1/+2` 视觉角标；③所有条从左侧统一刷入投影给出的 AP 语义色。强力骰增加的区段可泛红强调，但不得从此推断伤害。
- AP 结果色沿全局语义显示：0 AP 灰、1 AP 绿、2 AP 橙；任何额外颜色/结果必须由投影显式提供。玩家可见数值遵守 1–5；内部回合号、参与者序号和实体数可作为结构值显示。
- 可见性分为三档：弱点图标完全公开且常驻头顶，悬停显示公开克制说明；瞄准关系低显著性公开，仅悬停相关角色时显示紫色点线；招架是对他人真隐藏，不渲染待机/准备标识，不通过失败动画或提示泄露。
- NPC 没有玩家行动轮排名，NPC 在玩家阶段结束后进入 `npc-phase`，显示公开的 NPC 当前事件和快速视觉演出；不显示玩家确认按钮，不替 NPC 选择动作，不把 NPC 排名塞进玩家轮次栏。

## 4. 状态机

```text
round-idle
  -> roll-ready
  -> slider-selection
  -> selection-charged
  -> roll-trigger-pending
  -> roll-triggered
  -> comparison-bars-growing
  -> result-brushing
  -> ranking-update-pending
  -> ranking-updated
  -> player-action
  -> npc-phase
  -> cleanup
  -> next-round

slider-selection -> selection-cancelled -> roll-ready
roll-trigger-pending -> rejected | stale | timeout -> recoverable-roll-error
comparison-bars-growing -> skipped -> result-brushing

player-action -> action-result-projection -> player-action | npc-phase | eliminated | result
npc-phase -> npc-result-projection -> cleanup | eliminated | result
```

`power-die-slider` 与 `reversal-slider` 各自闭合 `0/1/2`；滑块选择不等于 accepted。`+3` 处于 `deferred-disabled` 终态。每个可交互控制提供 `hover / focus / active / disabled / return` 五态；结果演出只能绑定 accepted 或新 projection。

## 5. 组件树

```text
DiceTurnStatusSurface
├─ TurnHeaderStage
│  ├─ RoundLabel
│  ├─ PhaseLabel
│  ├─ CurrentActorLabel
│  └─ ApTurnAnnouncement
├─ TurnSpineStage
│  └─ TurnParticipantRow[]
│     ├─ RankBadge
│     ├─ ParticipantPortrait
│     ├─ HpFiveCellMeter
│     ├─ StaminaFiveCellMeter
│     ├─ ActedVisualState
│     └─ PublicStatusMarkers
├─ DiceRollStage
│  ├─ FloatingDiceAnchor
│  ├─ PowerDieSlider
│  ├─ ReversalSlider
│  ├─ DeferredBurstTierMarker
│  ├─ RollTriggerControl
│  ├─ RollComparisonBars
│  └─ RollResultRows
├─ StatusVisibilityLayer
│  ├─ PublicWeaknessIconLayer
│  ├─ LowSalienceAimRelationLayer
│  └─ HiddenParryGuard
├─ NpcPhaseStage
│  ├─ NpcPhaseBanner
│  ├─ NpcEventAnchor
│  └─ NpcResultFeedback
├─ IntentFeedbackLayer
└─ TurnLiveRegion
```

`FloatingDiceAnchor`、`RollComparisonBars` 和 `RollResultRows` 共享左侧轮次舞台的空间锚点；当横条向下方轮次行伸出时，舞台整体上移，不能遮挡 `paid-action-hand`、`free-action-band` 或目标预览。

## 6. 只读数据

```ts
interface DiceTurnProjectionMock {
  readonly source: 'mock' | 'projection';
  readonly revision: string;
  readonly roundNumber: number;
  readonly phase: 'roll' | 'player-action' | 'npc' | 'cleanup';
  readonly currentActorId: string | null;
  readonly currentPlayerId: string;
  readonly participants: readonly {
    readonly id: string;
    readonly rank: number;
    readonly label: string;
    readonly hp: number;
    readonly stamina: number;
    readonly ap: number;
    readonly acted: boolean;
    readonly eliminated: boolean;
    readonly isNpc: boolean;
    readonly weakness?: { readonly label: string; readonly iconRef?: string; readonly counterText?: string };
    readonly aimRelation?: { readonly targetId: string; readonly visibleOnHover: boolean };
  }[];
  readonly burstContract: {
    readonly powerDieTier: 0 | 1 | 2;
    readonly reversalTier: 0 | 1 | 2;
    readonly deferredTier: { readonly id: '+3极限爆发'; readonly selectable: false; readonly label: string };
  };
  readonly roll: {
    readonly state: 'hidden' | 'ready' | 'pending' | 'growing' | 'settled';
    readonly entries: readonly {
      readonly participantId: string;
      readonly rollValue?: number;
      readonly visibleModifierText?: string;
      readonly publicApText?: string;
      readonly barLength?: number;
      readonly barColor: 'gray' | 'green' | 'orange' | 'red' | 'projection';
      readonly powerDieAddedSegment?: number;
    }[];
  };
  readonly npcEvent?: { readonly actorId: string; readonly eventLabel: string; readonly assetRef?: string };
  readonly statusVisibility: { readonly weaknessPublic: true; readonly aimHoverOnly: true; readonly parryHidden: true };
}
```

数值、横条长度、AP 文案、修正文案、NPC 事件和公开状态均为只读。UI 不根据投点数推断 AP、不根据颜色推断状态、不根据 aim/parry 字段产生额外规则信息。不存在的 `parry` 字段不能被默认补成 false/true 的玩家可见标识。

## 7. 动作意图

- `battle.select-power-die-tier`：提交强力骰 `0 | 1 | 2` 的视觉选择意图；不扣 SP、不计算投点。
- `battle.select-reversal-tier`：提交逆转 `0 | 1 | 2` 的视觉选择意图；不扣 SP、不改变排名。
- `battle.confirm-roll`：提交确认投掷 intent；等待 accepted/projection 后才进入结果演出。
- `battle.cancel-roll-selection`：取消本地滑块选择，回到投点准备态。
- `battle.inspect-public-weakness`：展开公开弱点说明；不侦察、不消耗 AP/SP。
- `battle.inspect-aim-relation`：在 hover/focus 时请求/显示 projection 已公开的瞄准关系。
- `battle.skip-presentation`：跳过投点演出并落到宿主已确认结果；不跳过规则结算。
- `battle.continue-npc-phase`：仅用于宿主允许的 NPC 演出跳过/继续 intent；不替 NPC 提交动作。

同一 intent builder 服务鼠标、键盘、手柄、触控。结果显示 `pending / accepted / rejected / stale / timeout`，严禁把选择高光、爆闪或横条开始当作 accepted。

## 8. 本地 UI 状态

允许：两个滑块当前视觉档位、hover/focus/active、selection effect 阶段、trigger effect 阶段、横条演出阶段、轮次行焦点、排序动画进度、瞄准 hover、NPC 演出播放进度、skip requested、pending requestId、reduced-motion、局部展开和音频 muted。

禁止：本地修改 SP/AP/HP、改变投影的 rank/acted/currentActor、计算投点结果/条长/AP、判断 NPC 行动、创建弱点/瞄准/招架状态、以动画结束推进回合。revision 改变时清除过期滑块选择与过期 aim hover，再按新 projection 重建视觉。

## 9. 视觉令牌

- 投点舞台使用轮次脊柱的导管/光层语言，但用斜切仪表组和悬浮骰子区别于轮次框、动作卡。滑块轨道为半透明多层材质、离散刻度和非原生手柄。
- 强力骰主语义橙，逆转主语义紫；档位 0 灰白静置、1 局部充能、2 浓度与粒子递增。`+3` 灰色扁平无高光、无 pointer/keyboard focus。
- 横条 0 灰、1 绿、2 橙、3 红仅在 projection 明确许可时呈现；条的颜色表示公开 AP 结果语义，不表示伤害。强力骰附加段用高光/纹理/`+1/+2` 文本标出。
- HP 使用红 5 格，SP/清醒使用蓝 5 格，AP 使用橙离散格；空格以低饱和灰阶显示，不能用连续细条替代。
- 公开弱点图标使用实体头顶的像素/轮廓图标，hover 说明采用蓝/紫/语义色边缘；瞄准点线低显著性紫色虚线，无感叹号；招架不显示任何准备标识。
- NPC 阶段徽章使用阶段/进行中橙色和可读文本；NPC 像素实体可有局部高光，但不使用玩家行动轮次的突出框。

## 10. 动效绑定

- `AnimatePresence` 管理骰子、滑块、横条、结果行和 NPC 阶段的进入/退出；`layout/layoutId` 管理排名重排与轮次行空间迁移。
- selection effect：0 保持稳定；1 产生短促充能光晕；2 增强光层、粒子残影和局部反射。两条滑块都使用 `useSpring` 或等价 spring，避免原生 range 的瞬时跳变。
- trigger effect 在确认 intent 被 accepted 或结果 projection 到达后播放爆闪/一次性粒子，再按顺序驱动灰白伸出、强力骰增长、左侧刷色。请求 rejected/stale/timeout 只能显示回弹/错误，不播放成功爆闪。
- 轮次排序变化保留空间连续性，横条舞台移动时不重建整个 HUD；NPC 阶段只编排对应实体、事件和 banner，其他固定信息保持稳定。
- reduced motion 下保留滑块档位、投点结果、横条顺序、轮次重排、NPC 文本和最终状态，降低粒子/闪烁/位移；`skip` 直接落到确认结果。

## 11. 输入无障碍

- 每条滑块是语义化离散选择器，向读屏声明名称、当前档位 `0/1/2`、可选范围和 `+3 deferred，不可选`；不使用浏览器原生 range 外观，但提供等价 ARIA 语义。
- Tab 顺序：回合状态 → 强力骰 → 逆转 → 确认投掷 → 公开状态详情 → 结果/跳过。方向键左右或上下改变一个档位，Home/End 可到 0/2；不允许键盘进入 `+3`。
- Enter/Space 确认当前控制；Esc 取消选择。手柄左右/上下、confirm/cancel 与键盘同语义；触控 tap/long-press 有同等详情和选择路径。
- 轮次行读出排名、姓名、HP/SP、AP、当前行动、已行动/淘汰；NPC 阶段 live region 宣布公开事件。弱点图标必须有可读名称；aim 点线提供文本等价；parry 不进入他人可见辅助技术输出。
- 颜色不是唯一通道：档位使用数字/刻度/形状，横条使用格状刻度与 AP 文本，状态使用图标/文字/材质。焦点环不可被舞台裁切。

## 12. 加载错误超时

- 投点 projection loading 显示「投点信息加载中」和滑块轮廓；若没有权威档位，不显示伪造的可选值，仅提供安全取消/返回。
- 滑块或确认请求 pending 超时显示重试/取消；rejected 显示宿主原因；stale 清除旧档位并要求重新读取；不在本地继续增长横条或变更排名。
- 投点数据部分缺失时保留已知序号/玩家名和语义 fallback；缺失 roll/AP/条长时显示「结果暂不可见」，不补默认 0 或自行推算。
- NPC 事件中继超时显示「NPC 阶段信息暂不可见（mock）」；可按宿主允许安全等待/跳过/返回，不把无事件宣称为 NPC 无行动。
- 视觉素材或粒子缺失时继续文字和几何结果；音效缺失不阻塞投点；网络错误交给连接层，不在此处宣称重连成功。

## 13. 明确不做

- 不实现骰子随机、强力骰/逆转规则、SP 消耗、AP 分配、排名算法、平局处理、过载、NPC AI、行动执行、伤害、DC、弱点效果或淘汰判定。
- 不把 `power-die-slider`、`reversal-slider` 渲染成行动卡、动作成本、按钮纵列或选项卡；不允许 `+3` selectable。
- 不显示招架准备标识、不用远程失败/静默失效产生提示、不通过颜色或粒子泄露隐藏信息。
- 不把投点结果做成独立遮挡地图的弹窗，不与动作手牌、目标上下文重叠，不使用统一圆角卡片墙或 9-slice 边框。
- 不调用 OpRegistry、不写玩法 store、不通过动画推进轮次或伪造 accepted。

## 14. 依赖交接

- 依赖 B2-01 的 `fixed-turn-spine`、当前行动者锚点、资源格和 HUD 安全区；依赖 B2-02 的行动手牌避让区域与目标上下文边界。
- 依赖 B2-04 提供淘汰后只读、观战、连接异常和结果状态的切换槽位；B2-03 只交接稳定阶段名、滚动结果和 `skip`/`retry` intent。
- 依赖 G-03 的 StatePort/ActionPort、G-05 的事件结果和 fallback、G-06 的 mock 投点/轮次 fixture；不读取规则内部路径。
- `assetRef`/manifest 提供骰子、头像、弱点和 NPC 素材；本 brief 只消费并展示加载/缺失状态，不修改素材管线。

## 15. 验收条件

- [ ] 回合徽章、轮次脊柱、当前行动者、HP/SP/AP 离散格、已行动降饱和、NPC 阶段均可演示，NPC 不进入玩家轮次排名。
- [ ] 骰子只在投点阶段悬空出现；投点横条就地从轮次舞台生长，灰白 → 强力骰增长 → 左侧刷色，结果行和动作手牌不重叠。
- [ ] 强力骰和逆转各为独立 `0/1/2` 离散滑块；`+3` deferred、不可选且不可聚焦；selection/trigger effects 都存在。
- [ ] 结果演出只在 accepted/projection update 后发生；pending/rejected/stale/timeout 可见且不伪造成功。
- [ ] 弱点完全公开常驻、瞄准仅 hover 低显著性、招架对他人无任何标识；颜色外有文字/图标/刻度通道。
- [ ] 键盘/手柄/触控/读屏/reduced-motion 可完成投点选择、确认、取消、跳过和错误恢复。
- [ ] 不实现骰子、排名、AP/SP、NPC 或状态规则，不调用 OpRegistry，素材/声音/粒子缺失有确定降级。

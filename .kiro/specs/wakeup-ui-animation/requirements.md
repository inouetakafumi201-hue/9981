# Requirements Document

## Introduction

本文档定义 WakeUp **UI 与动画表现系统**的工程需求。该系统是规则状态的只读投影与交互入口，不是第二套规则引擎：它读取引擎层提供的只读 `Query` / `Expr`、合法动作查询、`Decision` / `Intent`、`Knowledge` / `visibleTo` 与事件投影，消费基类层提供的 `Presentation Descriptor`，并把会影响规则状态的用户操作提交为待校验的交互意图。任何最终状态变化都必须由权威运行时通过 `OpRegistry.invoke` 完成。

本文档依据以下优先级裁决来源：

1. `docs/L0_规范宪法.md`
2. `docs/访谈决策记录.md` 中已确认的 D-024、D-025、D-026，以及 2026-08-07 访谈轮次确认的 **D-031（弱点完全公开）、D-032（招架真隐藏 + 全屏动画扩为四项）、D-033（瞄准低显著性红点线）、D-034（观战信息权限）、D-035（AP 耗尽仅置灰）、D-036（轮次栏为核心组件）、D-042（零费菜单切换与 3 秒倒计时）、D-053（招架等六项机制批准为正式规则）**。同编号冲突时以日期较晚的已确认决策为准。
3. `.kiro/specs/meta-mechanism-kernel/requirements.md` 与 `.kiro/specs/meta-mechanism-kernel/design.md`
4. `docs/L1_引擎层/引擎层职责边界.md`
5. `.kiro/specs/l2-base-layer-spec/requirements.md`
6. `docs/L2_基类层/08_图形化与UI.md`
7. `docs/_术语表与废案清单.md`、`docs/审查状态综合报告.md` 中仍有效的约束

低优先级来源中的视觉 mockup、具体布局、像素尺寸、动画时长、素材路径、帧率、性能候选值、按键示例与玩法示例不自动成为本 Spec 的语义默认值。来源冲突时采用上述优先级；未被上游稳定契约定义的跨 Spec 字段必须保留为“待汇合契约”，不得在本 Spec 中自行补造规则。

## Scope and Ownership

### 本 Spec 负责

- 将当前 Agent 有权看到的规则语义投影为 UI 与动画可消费的描述。
- 将规则相关输入表达为交互意图，并提交给与其他调用方相同的权威校验通道。
- 定义表现资源的加载、播放、跳过、失败、回放、回退与可访问性行为。
- 定义语义字段拒绝与非语义表现资源降级的分界。
- 定义项目表现配置如何承载已确认的视觉风格与动画范围。

### 本 Spec 不负责

- 定义或复制动作合法性、成本、伤害、距离、状态、回合、空间、物品、AI 决策或随机规则。
- 直接读取或修改可变 `WorldState`，也不导出绕过权威动作校验的状态写入接口。
- 把玩法专属 HUD、具体模式流程、具体美术素材或玩法提示提升为基类层默认语义。
- 固定渲染框架、动画库、网络库、布局坐标、素材文件名、像素尺寸、帧率目标或动画时长。
- 用动画完成、音效完成、资源加载结果或本地时钟推进规则结算。

## Glossary

- **UI_Animation_System**：本文档定义的 UI 与动画表现系统。
- **Semantic_State**：会影响动作合法性、规则结果、随机结果、结算顺序或持久化结果的权威状态。
- **Read_Only_Projection**：由已验证定义与运行时状态派生、受 Agent 可见性限制且不提供写能力的视图。
- **Presentation Descriptor**：基类层提供的可复用表现描述，包含语义角色、交互意图、动作标识、姿态、成本类别、可用性、不可用原因、可访问性标签与素材引用等字段。【2026-08-08 权威变更：已删除"攻击形状"字段，判定为冗余设计，见 docs/L0_规范宪法.md、docs/L2_基类层/基类层定义.md §4.3 最新权威内容】
- **Presentation_Profile**：玩法层或表现资源层拥有的可替换配置，负责具体布局、资源绑定、动效参数与玩法专属界面组织；不改变规则语义。
- **Interaction_Intent**：UI 根据一次被接受的用户操作形成的结构化请求，至少绑定当前 Agent、权威动作或 Decision 标识、参数绑定和观察到的状态修订版本；其提交不代表执行成功。
- **Rule_Event_Projection**：从已提交规则事件派生、经过可见性过滤的只读演出增量。
- **State_Revision**：用于识别 UI 所观察状态是否已过期的单调版本标识或等价一致性令牌；具体形态由设计阶段与上游统一。
- **Stale_Interaction**：因状态变化、Decision 关闭、目标失效或修订版本落后而不再可执行的交互意图。
- **Authorized_Agent**：当前窗口代表、且其 `knowledgeScope` 与权限已由权威运行时确认的 Agent。
- **Visibility_Safe**：不会直接或间接暴露当前 Agent 不可见的实体、Intent、事实、规则条件、资源标识、计数、顺序或诊断细节。
- **Semantic_Field**：影响类型、动作身份、目标、合法性、规则结果、可见性或可访问性所依赖的底层语义角色的字段。
- **Presentation_Field**：只影响名称呈现、图标、纹理、音效、触觉、动画、布局或可本地化的可访问性文本且不改变规则结果的字段。
- **Accessible_Semantic_Label**：以 Visibility_Safe 方式表达已验证语义角色的 Presentation_Field；它不得成为语义角色的唯一来源，缺失时只能依据已验证语义字段选择已声明的类型兼容替代文本。
- **Presentation_Fallback**：非语义表现资源缺失或损坏时使用的类型兼容替代行为，并伴随结构化警告诊断。
- **Player_Visible_Gameplay_Value**：作为玩法规则事实呈现给玩家的数值，受 1—5 范围约束。
- **Internal_Metric**：回合编号、实体数量、距离计算、结算预算、资源尺寸、帧率、耗时和性能统计等非玩法数值；必须与玩家玩法数值分域。
- **Reduced_Motion_Mode**：减少、替换或跳过非必要动态效果而保持全部规则信息与交互能力的可访问性模式。
- **Pending_Convergence_Contract**：本 Spec 需要其他领域提供、但尚未经过跨 Spec 一致性审查确认字段级签名的类型化只读能力。

## Upstream Contracts

### 已稳定的上游契约

| 提供方 | 本 Spec 只读消费的能力 | 本 Spec 不得做的事 |
|---|---|---|
| 引擎层 | `Query` / `Expr`、`queryActions`、`Decision` / `Intent`、`Knowledge` / `visibleTo`、`after:*` 事件投影、稳定实体标识、snapshot / replay / rewind 结果 | 复制合法性判定、读取越权状态、直接调用状态写 helper、用动画驱动相位 |
| 基类层 | `Read_Only_Semantic_Projection`、`UI_Adapter`、`Presentation Descriptor`、语义字段拒绝、表现字段警告降级 | 从字段名猜测资源语义、把具体玩法值或具体布局写成基类层默认值 |
| 权威运行时 | 当前 Agent 身份、状态修订版本、意图提交结果、结构化拒绝与重同步入口 | 把本地按钮状态当作权威锁、把请求已发送当作规则已生效 |

### 待汇合契约

下列依赖只声明所需能力，不读取或复制其他并行领域 Spec 的字段定义；字段名、枚举和版本由后续跨 Spec 一致性审查统一：

| 提供方 | 所需只读能力 | 汇合前约束 |
|---|---|---|
| `core` | 资源语义角色、当前相位或流程语义、动作合法性与不可用原因、规则结果摘要、当前 Agent 可见的 Decision / Intent | UI 只能消费类型化投影，不得从 `props` 路径、显示文案或历史示例推导规则 |
| `space-items` | 当前 Agent 可见的天然场景、微型场景、过渡、容器、槽位、物品、装备关系与合法交互描述 | UI 不得重算距离、容量、阻挡、负重、目标范围或物品移动合法性 |
| `AI` | 当前 Agent 可见的 AI 行动状态、公开意图、可公开解释标签与进度事件 | UI 不得读取搜索树、隐藏评估、影子随机流、未公开目标或绕过 `visibleTo` 的策略内部状态 |

## Requirements

### Requirement 1: 来源优先级、层级归属与可追踪性

**User Story:** As a 规范维护者, I want 每项 UI 与动画行为都有唯一归属和权威来源, so that 历史示例、视觉候选值和玩法规则不会被误升为基类层契约。

**权威来源：** `docs/L0_规范宪法.md` 第一至五条；`.kiro/specs/l2-base-layer-spec/requirements.md` Requirement 1、2、5、16；P05 必须审查项 6、7、10。

#### Acceptance Criteria

1. THE UI_Animation_System SHALL apply the source priority declared in this document whenever two source statements conflict.
2. WHEN a lower-priority visual mockup, historical example or route-map statement conflicts with a higher-priority contract, THE UI_Animation_System requirements SHALL retain the higher-priority contract and classify the displaced statement as non-normative.
3. THE UI_Animation_System SHALL classify reusable semantic presentation fields as 基类层 ownership and concrete gameplay HUD composition, gameplay hints, asset bindings and presentation tuning as 玩法层 or presentation-resource ownership.
4. IF a proposed requirement assigns damage, cost, probability, duration, capacity, threshold, victory behavior or mode sequence, THEN the requirement review SHALL reject it as duplicated gameplay ownership unless it only displays a validated upstream projection.
5. IF a proposed requirement fixes a layout coordinate, pixel size, frame rate, animation duration, particle count, material path, device key or performance target as semantic behavior, THEN the requirement review SHALL reject it from the semantic contract.
6. THE UI_Animation_System SHALL associate every normative requirement with at least one authority source and a mechanically decidable acceptance result.
7. IF an imported statement uses a deprecated architecture term as a normative concept, THEN the requirement review SHALL reject the statement and identify the canonical term.

### Requirement 2: 只读语义投影与描述符完整性

**User Story:** As a UI 开发者, I want 所有规则与表现信息来自类型化只读投影, so that UI 不会复制规则、猜测字段含义或持有可变状态引用。

**权威来源：** 引擎层 requirements Requirement 14、25、40；引擎层 design §3.15；基类层 requirements Requirement 14。

#### Acceptance Criteria

1. THE UI_Animation_System SHALL obtain rule state only through Agent-scoped Read_Only_Projections, legal-action results, Decision / Intent projections and Rule_Event_Projections.
2. THE UI_Animation_System SHALL obtain reusable presentation semantics only through validated Presentation Descriptors.
3. THE Presentation Descriptor consumed by the UI_Animation_System SHALL carry stable semantic identifiers separately from localized labels and asset references.
4. THE UI_Animation_System SHALL render resource roles, interaction intents, postures, cost categories, availability and unavailable reasons from explicit descriptor fields rather than field-name, color, file-name or tag heuristics. [2026-08-08 权威变更（本次会话裁决，已获项目所有者授权）：已删除 attack shapes；攻击形状判定为冗余设计，已被武器属性（散射/扫射/连发）完全覆盖。详见 docs/L0_规范宪法.md、docs/L2_基类层/基类层定义.md §4.3、docs/L2_基类层/08_图形化与UI.md 最新权威内容。]
5. IF a required Semantic_Field is absent, incompatible, unresolved or outside the supported descriptor version, THEN the UI_Animation_System SHALL reject that descriptor, omit every interaction derived from it and emit an Error_Diagnostic.
6. IF a UI consumer attempts to obtain a mutable Semantic_State reference through any projection or descriptor, THEN the adapter SHALL return a Structured_Rejection and expose no mutable reference.
7. WHEN the renderer is replaced or re-created, THE UI_Animation_System SHALL preserve stable action, Decision, Intent, entity and descriptor identifiers in the resulting projection.
8. THE UI_Animation_System SHALL NOT treat a cached projection as authoritative after its State_Revision is superseded.

### Requirement 3: Agent 可见性与端到端防泄漏

**User Story:** As a 玩家, I want 每个界面与演出只使用我有权知道的信息, so that 隐藏信息不会通过表现侧信道泄漏。

**权威来源：** 引擎层 requirements Requirement 5、14、29、36、37、40；引擎层 design §3.12、§3.13、§3.15；P05 必须审查项 5。

#### Acceptance Criteria

1. THE UI_Animation_System SHALL bind every Query, action query, Decision / Intent projection and Rule_Event_Projection to the Authorized_Agent and its current `visibleTo` scope.
2. IF a raw event or diagnostic has not been filtered for the Authorized_Agent, THEN the UI_Animation_System SHALL reject it as a presentation input.
3. THE UI_Animation_System SHALL NOT reveal a hidden entity, hidden Intent, hidden Decision answer, unknown fact or unmet secret condition through HUD entries, previews, target markers, animation choice, ordering, counts or unavailable reasons.
4. THE UI_Animation_System SHALL NOT reveal hidden information through logs, debug panels, screen-reader text, captions, tooltips, focus labels, telemetry visible to users or clipboard/export output.
5. THE UI_Animation_System SHALL NOT reveal hidden information through asset names, resource paths, preload timing, fallback type, audio cues, haptics or animation timing.
6. WHEN an unavailable reason contains information outside the Authorized_Agent scope, THE UI_Animation_System SHALL display a Visibility_Safe generic reason supplied or approved by the projection layer rather than the raw reason.
7. WHEN an entity becomes invisible after having been visible, THE UI_Animation_System SHALL remove or replace its live projection according to current Knowledge semantics and SHALL NOT continue updating it from hidden world truth.
8. WHEN multiple windows represent different Agents, EACH window SHALL receive independently filtered projections and SHALL NOT share Agent-scoped caches.
9. WHEN an omniscient view is requested, THE UI_Animation_System SHALL require explicit authority from the upstream Agent projection and SHALL NOT infer omniscience from a local debug setting.
10. THE UI_Animation_System SHALL support exactly three Salience_Tiers for a projected state, and SHALL take the tier of each state from an explicit descriptor field rather than inferring it from the state's rule effect（D-031 / D-032 / D-033）:
    - `public-persistent`：常驻显示，无需用户操作即可看到
    - `public-on-inspect`：仅在用户主动检视（如悬停）该实体时呈现，且不得使用头顶感叹号一类的主动强提示
    - `hidden`：对该状态的所有者以外的观察者完全不呈现
11. THE WakeUp default Presentation_Profile SHALL classify 弱点属性 as `public-persistent` and SHALL render it as a persistent icon above the character（D-031：不需要消耗 AP 侦察，也不得把悬停查询作为唯一获取途径）.
12. THE WakeUp default Presentation_Profile SHALL classify `[瞄准中]` as `public-on-inspect`, SHALL render it on hover as a red dotted line from the aimer to its aim target, and SHALL NOT render it as a persistent above-head indicator（D-033）.
13. THE WakeUp default Presentation_Profile SHALL classify Parry_Ready as `hidden`（D-032；参见 Requirement 6.15）.
14. IF a Presentation_Profile assigns a Salience_Tier that contradicts the rule-layer visibility classification of that state, THEN the UI_Animation_System SHALL reject the profile entry and emit an Error_Diagnostic rather than silently choosing either value.

### Requirement 4: 交互意图与唯一写入通道

**User Story:** As a 玩家, I want 我的输入经过与所有调用方相同的合法性校验, so that UI 无法绕过规则或制造半生效状态。

**权威来源：** 引擎层 requirements Requirement 16、20、21、25、26、27、29、40；引擎层 design §2“写入通道唯一性”、§3.4、§3.7、§3.8、§3.15；P05 必须审查项 1、2。

#### Acceptance Criteria

1. WHEN a user selects a rule-affecting operation, THE UI_Animation_System SHALL create an Interaction_Intent referencing an action or open Decision returned by the current authoritative projection.
2. THE Interaction_Intent SHALL include the Authorized_Agent, stable action or Decision identifier, selected bindings and the observed State_Revision or equivalent consistency token.
3. THE UI_Animation_System SHALL submit Interaction_Intents through the same authoritative action contract used by non-UI callers.
4. THE UI_Animation_System SHALL NOT directly invoke mutable state helpers, assign Semantic_State fields, advance random streams, settle costs, resolve Intents or advance phases.
5. THE authoritative action contract SHALL revalidate Agent authority, action visibility, current legality, targets, costs, Decision status and current revision before any resulting Op is invoked.
6. IF validation fails, THEN the UI_Animation_System SHALL display a Visibility_Safe Structured_Rejection, refresh the affected projection and SHALL NOT synthesize a compensating state write.
7. WHEN submission succeeds, THE UI_Animation_System SHALL treat the operation as complete only after observing the authoritative result or a projection containing the committed revision.
8. WHEN a user changes a presentation-only preference, THE UI_Animation_System MAY update local presentation state without an Interaction_Intent, provided that the preference cannot alter Semantic_State, action availability, random results or rule timing.
9. IF a drag, shortcut, gesture, accessibility command or automation source requests the same rule action, THEN the UI_Animation_System SHALL submit the same Interaction_Intent shape and SHALL NOT use an input-specific write path.

### Requirement 5: 输入禁用、重复提交与过期交互

**User Story:** As a 玩家, I want 界面在状态变化和网络延迟下明确处理过期操作, so that 重复点击或旧 Decision 不会被误当作有效动作。

**权威来源：** 引擎层 requirements Requirement 25—29、31、37、40；引擎层 design §3.7、§3.8、§3.13；P05 必须审查项 9。

#### Acceptance Criteria

1. WHILE an Interaction_Intent is awaiting authoritative acknowledgement, THE UI_Animation_System SHALL mark the corresponding control as pending and SHALL NOT create another Interaction_Intent from additional activation attempts on that pending control.
2. IF input disabling is delayed, bypassed or unavailable, THEN every Interaction_Intent that reaches the authoritative action contract SHALL still undergo complete current-state revalidation; the UI disabled state SHALL NOT be treated as a rule-safety boundary.
3. WHEN the current State_Revision changes, THE UI_Animation_System SHALL invalidate cached action bindings and re-query affected actions before allowing a new submission.
4. IF a Decision is resolved, timed out, voided, closed or no longer visible, THEN the UI_Animation_System SHALL remove its controls and reject attempts to submit its stale answer.
5. IF an action target disappears, changes identity, becomes invisible or ceases to satisfy the projected binding, THEN the UI_Animation_System SHALL cancel the local selection and require a new legal-action result.
6. WHEN an authoritative rejection reports stale state, THE UI_Animation_System SHALL reconcile to a fresh Read_Only_Projection before re-enabling the affected interaction.
7. THE UI_Animation_System SHALL NOT infer success from a button becoming disabled, an animation starting, a sound playing or a request leaving the client.
8. WHEN two windows for the same Agent submit competing interactions, EACH submission SHALL be independently validated against authoritative state, and every window SHALL converge to the resulting committed projection.
9. THE UI_Animation_System SHALL present actions in exactly two mutually exclusive menu surfaces keyed on `ActionDescriptor.costCategory` — a paid surface and a zero-cost surface — and SHALL NOT place a zero-cost action and a paid action in the same surface（D-042）.
10. WHILE the acting Agent still has an unspent action budget, THE UI_Animation_System SHALL show the paid surface by default and SHALL expose a toggle control that switches to the zero-cost surface without submitting any Interaction_Intent（D-042）.
11. WHEN the acting Agent has no remaining action budget, THE UI_Animation_System SHALL retain only the zero-cost surface together with the end-turn control, and SHALL NOT restrict zero-cost actions to that state（D-042：零费动作不限于回合末执行）.
12. WHEN the end-turn control becomes the only budgeted path forward per criterion 11, THE UI_Animation_System SHALL start a countdown of the Presentation_Profile's `endTurnCountdown` duration (WakeUp default: 3 秒) and SHALL allow the acting Agent to cancel it before it elapses（D-042：留出反悔窗口）.
13. WHEN the countdown in criterion 12 elapses, THE UI_Animation_System SHALL submit the end-turn Interaction_Intent through the same authoritative channel as any other intent, and SHALL NOT treat the countdown's completion as the turn having ended.
14. THE UI_Animation_System SHALL classify the countdown duration as a replaceable Presentation_Profile field and SHALL NOT let its value, its cancellation or its expiry alter action legality, cost or effect.

### Requirement 6: 项目视觉配置与已确认动画范围

**User Story:** As a 视觉设计者, I want 已确认的美术方向与仪式性动画范围得到保留, so that 实现可替换而项目视觉决策不会被历史草案重新打开。

**权威来源：** `docs/访谈决策记录.md` D-024、D-025、D-026、**D-032**（2026-08-07，取代 D-026 的三项集合）、**D-053**（招架批准为正式规则）；`docs/L2_基类层/08_图形化与UI.md` 中未与高优先级来源冲突的视觉方向；P05 必须审查项 6、7。

#### Acceptance Criteria

1. THE WakeUp default Presentation_Profile SHALL identify pixel-art interaction components, sketch-style map backgrounds and separately composited foreground and background presentation as the approved project visual direction.
2. THE UI_Animation_System SHALL treat the visual direction in criterion 1 as a Presentation_Profile decision rather than a rule-semantic field or a rendering-library requirement.
3. THE UI_Animation_System SHALL use technology-descriptive animation names and SHALL NOT use a third-party game's name as the normative name of a movement or full-screen animation technique.
4. THE WakeUp default Presentation_Profile SHALL reserve full-screen ceremonial animation for exactly the four approved action semantics: 翻窗、跳窗、令其长眠 and 招架触发（D-032 扩充 D-026；D-053 已将招架批准为玩法层正式规则）.
5. THE WakeUp default Presentation_Profile SHALL render ordinary attacks, entering or leaving vehicles and precision-interaction completion without full-screen ceremonial animation.
6. THE UI_Animation_System SHALL classify exact animation duration, transform curve, sprite sequence, skeleton resource and transition timing as replaceable Presentation_Profile fields.
7. EXCEPT when a user explicitly skips animation or enables Reduced_Motion_Mode, or when Requirement 9 requires a resource-failure fallback, THE WakeUp default Presentation_Profile SHALL preserve full-screen ceremonial presentation for 翻窗、跳窗、令其长眠 and 招架触发 and SHALL NOT assign full-screen presentation to any other action semantic; changing this set requires a new confirmed decision that supersedes D-026 and D-032.
8. THE UI_Animation_System SHALL NOT derive action legality, cost, effect strength or completion time from whether an action has a full-screen animation.
9. THE WakeUp default Presentation_Profile SHALL define a persistent Turn_Order_Bar on the left edge of the screen as a core component, carrying one vertical entry per participant with portrait, name, 生命值 and 体力值, and SHALL keep it visible across every turn phase（D-036：轮次栏兼任简易状态栏）.
10. THE WakeUp default Presentation_Profile SHALL anchor roll and comparison animations beside the Turn_Order_Bar entries rather than in a separate settlement panel or modal（D-036：动效舞台）.
11. WHEN a participant has spent its whole action budget for the round, THE UI_Animation_System SHALL keep that participant's Turn_Order_Bar entry in place with a low-salience desaturation or grey-out treatment, and SHALL NOT remove the entry, add a cross-out, or add an "已结束" banner（D-035）.
12. THE UI_Animation_System SHALL treat the entry treatment in criterion 11 as meaning only "该参与者本回合已行动过", and SHALL NOT derive turn eligibility from the visual treatment（D-035：实现应为遍历列表找第一个未行动者，而非从队列弹出）.
13. THE UI_Animation_System SHALL render 生命值 and 体力值 in the Turn_Order_Bar under the Requirement 10 player-visible numeric constraints, using discrete segments rather than percentages or continuous bars.
14. THE WakeUp default Presentation_Profile SHALL play the 招架触发 full-screen ceremonial animation ONLY on the 被近战攻击 resolution branch, and SHALL NOT emit any animation, prompt or other observable presentation when a Parry_Ready state lapses due to 远距离伤害命中 or 不可招架伤害（D-032：静默失效）.
15. THE UI_Animation_System SHALL treat Parry_Ready as hidden information for every observer other than its owner, and SHALL NOT render a standby, preparing or ready indicator for another player's Parry_Ready state（D-032：真隐藏）.

### Requirement 7: 动画与规则结果解耦

**User Story:** As a 规则实现者, I want 动画完全从已提交结果派生, so that 素材和播放状态永远不能改变规则结算。

**权威来源：** 引擎层 requirements Requirement 16、21、35、37、40；引擎层 design §3.4、§3.11、§3.13、§3.15；P05 必须审查项 3、9。

#### Acceptance Criteria

1. THE UI_Animation_System SHALL start rule-result animation only from a committed Read_Only_Projection or Visibility_Safe Rule_Event_Projection.
2. WHETHER an animation is loading, ready, playing, paused, skipped, reduced, failed or absent SHALL NOT change action legality, cost settlement, random output, event order, Intent status, Decision status or phase progression.
3. THE UI_Animation_System SHALL NOT call a rule Op from an animation completion callback, timeline marker, frame event, audio event or particle event.
4. THE authoritative runtime SHALL be able to complete rule settlement while every presentation resource is unavailable.
5. WHEN multiple committed events require presentation, THE UI_Animation_System SHALL preserve their authoritative causal order in the observable narrative or explicitly coalesce them without changing or concealing their final semantic results.
6. IF an animation finishes before or after another window's animation, THEN all windows SHALL still converge to the same committed Semantic_State projection.
7. WHEN an animation is skipped, THE UI_Animation_System SHALL immediately present an equivalent final semantic state and any required accessible announcement.
8. WHEN Reduced_Motion_Mode is enabled, THE UI_Animation_System SHALL replace nonessential motion without changing information, interaction availability or authoritative timing.
9. THE UI_Animation_System SHALL NOT consume or advance an authoritative random stream for cosmetic variation; cosmetic variation, if any, SHALL be isolated from rule replay and SHALL NOT encode hidden information.

### Requirement 8: 异步状态、回放、回退与多窗口一致性

**User Story:** As a 玩家或观察者, I want 动画在重连、回放、回退和多窗口中跟随权威状态, so that 本地演出不会留下幽灵状态或改变历史。

**权威来源：** 引擎层 requirements Requirement 29、35、37、40；引擎层 design §3.13、§3.15；P05 必须审查项 9。

#### Acceptance Criteria

1. WHEN a newer committed projection arrives during an animation, THE UI_Animation_System SHALL cancel, retarget, fast-forward or replace the obsolete animation and reconcile to the newer State_Revision.
2. WHEN a snapshot is loaded or a client reconnects, THE UI_Animation_System SHALL render a complete first frame from the full Read_Only_Projection without requiring prior animation history.
3. WHEN replaying a journal, THE UI_Animation_System SHALL derive presentation from replayed committed projections or event projections and SHALL NOT submit new Interaction_Intents from recorded visual callbacks.
4. WHEN rewind or restore selects an earlier authoritative state, THE UI_Animation_System SHALL discard later local visual state, pending previews and presentation-only caches associated with superseded revisions.
5. WHEN replay speed changes or animation is skipped, THE replayed rule result, random result and event order SHALL remain unchanged.
6. WHEN a local presentation resource becomes ready after its originating State_Revision has been superseded, THE UI_Animation_System SHALL NOT attach that resource to the current projection unless the current descriptor still references it.
7. WHEN multiple windows observe the same Agent and revision, THEY SHALL render semantically equivalent action availability, Decision state and visible facts even if local layout, focus or animation progress differs.
8. WHEN a window resumes after suspension, THE UI_Animation_System SHALL obtain a fresh projection before enabling rule-affecting input.
9. IF the event-increment channel is incomplete, out of order or reports a revision gap, THEN the UI_Animation_System SHALL request a full projection and SHALL NOT guess the missing semantic transition.

### Requirement 9: 语义拒绝与非语义表现降级

**User Story:** As a UGC 创作者或玩家, I want 表现资源损坏时系统仍可诊断运行，而语义损坏时明确拒绝, so that 优雅降级不会掩盖规则错误。

**权威来源：** 基类层 requirements Introduction、Requirement 11、12、13、14、15；P05 必须审查项 4。

#### Acceptance Criteria

1. IF an action identifier, target binding, semantic role, interaction intent, availability state, visibility scope or State_Revision is missing or invalid, THEN the UI_Animation_System SHALL reject the affected descriptor or interaction with an Error_Diagnostic.
2. THE UI_Animation_System SHALL NOT invent a missing Semantic_Field from a label, icon, asset name, neighboring field, historical example or default gameplay assumption.
3. IF an icon, texture, sound, haptic pattern, animation clip, font, Accessible_Semantic_Label or other Presentation_Field is missing or damaged, THEN the UI_Animation_System SHALL use an explicitly declared type-compatible Presentation_Fallback derived only from validated Semantic_Fields and emit a Warning_Diagnostic.
4. A Presentation_Fallback SHALL preserve the visible semantic role and accessible meaning carried by validated Semantic_Fields without adding, removing or enabling an action.
5. IF the original descriptor's semantic type is itself hidden, THEN the fallback SHALL use a Visibility_Safe generic presentation rather than a type-specific fallback.
6. WHEN an animation fallback is used, THE UI_Animation_System SHALL present the committed final semantic state even if no motion is available.
7. WHEN an audio or haptic fallback is unavailable, THE UI_Animation_System SHALL retain an equivalent visual and accessible text channel where that feedback carries required information.
8. EVERY fallback Warning_Diagnostic SHALL identify a stable diagnostic code, descriptor or resource reference, failure category and selected fallback without exposing hidden resource semantics to an unauthorized viewer.
9. IF no type-compatible and Visibility_Safe fallback exists for a nonessential resource, THEN the UI_Animation_System SHALL omit that resource, retain semantic text or shape output and emit a Warning_Diagnostic; IF the missing fallback is required to make an interactive control or rule-significant status accessible, THEN the UI_Animation_System SHALL reject that affected presentation, emit an Error_Diagnostic and leave the underlying rule state unchanged.
10. THE UI_Animation_System SHALL NOT convert a semantic rejection into a warning merely to keep a control visible or an animation playing.

### Requirement 10: 玩家可见数值与内部指标隔离

**User Story:** As a 玩家, I want UI 忠实显示受约束的玩法数值, so that 界面不会制造越界值或伪精确信息。

**权威来源：** `docs/L0_规范宪法.md` 第四条、第五条；基类层 requirements Requirement 5、16；P05 必须审查项 8。

#### Acceptance Criteria

1. THE UI_Animation_System SHALL display a Player_Visible_Gameplay_Value only when the upstream descriptor classifies it as player-visible and its value is within the inclusive range 1—5.
2. IF a projected Player_Visible_Gameplay_Value is below 1, above 5, non-finite or lacks numeric ownership classification, THEN the UI_Animation_System SHALL reject the affected gameplay-value presentation and emit an Error_Diagnostic.
3. THE UI_Animation_System SHALL NOT multiply, divide, interpolate or convert a 1—5 gameplay value into a displayed percentage, decimal score, large-scale rating or other pseudo-precise gameplay number.
4. THE UI_Animation_System MAY use nonnumeric discrete shapes, filled segments or qualitative labels to present a valid 1—5 value, provided that the presentation does not imply a different rule value.
5. THE UI_Animation_System SHALL display action costs, durations, capacities and thresholds only from the current validated projection and SHALL NOT recalculate them locally.
6. Internal_Metrics SHALL use a distinct type or namespace from Player_Visible_Gameplay_Values.
7. Resource dimensions, frame counts, frame rates, animation durations, latency, memory, entity counts, turn indices and performance statistics SHALL NOT be exposed as gameplay-value descriptors.
8. IF an Internal_Metric is shown in an authorized development surface, THEN it SHALL be visually and semantically labeled as diagnostic or technical information and SHALL remain subject to Agent visibility filtering.
9. Accessible text, captions, tooltips and exported UI text SHALL obey the same gameplay-value constraints as visual labels.
10. AT any instant, THE UI_Animation_System SHALL present no more than five simultaneously selectable options to a player across all visible panels, groups, overlays and input modes; WHEN the authoritative legal-action set contains more than five options, THE UI_Animation_System SHALL use staged navigation, filtering or sequential disclosure that exposes at most five selectable options at once without changing that legal-action set.

### Requirement 11: 可访问性与输入等价性

**User Story:** As a 使用不同感知或输入方式的玩家, I want 获得等价的规则信息和交互能力, so that 颜色、动画或设备差异不会改变玩法。

**权威来源：** 基类层 requirements Requirement 14；`docs/L0_规范宪法.md` 第五、六条；P05 必须审查项 1、5、9。

#### Acceptance Criteria

1. FOR every visible interactive control and rule-significant status indicator, THE Presentation Descriptor SHALL provide both a validated accessible semantic role and either a Visibility_Safe Accessible_Semantic_Label or the declared fallback key used to derive one; IF neither label path is available, THEN the UI_Animation_System SHALL reject the affected presentation under Requirement 9.9.
2. THE UI_Animation_System SHALL NOT use color, animation, audio or haptics as the sole carrier of rule-significant information.
3. WHEN color distinguishes semantic roles, THE UI_Animation_System SHALL provide at least one equivalent non-color cue such as shape, texture, icon structure or text.
4. WHEN screen-reader or caption output is produced, IT SHALL consume the same Visibility_Safe projection as the visual renderer.
5. Reduced_Motion_Mode SHALL preserve action availability, final-state feedback, event ordering meaning and required announcements while allowing nonessential animation to be replaced or removed.
6. Keyboard, pointer, touch, controller, switch-control and assistive automation inputs SHALL resolve to the same stable interaction identifiers and Interaction_Intent schema.
7. THE UI_Animation_System SHALL allow input bindings to be configured without changing action definitions or introducing input-source-specific legality.
8. IF two input bindings conflict, THEN the configuration surface SHALL report a deterministic conflict and require an explicit resolution rather than silently dropping a binding.
9. WHEN focus changes because an action disappears or a Decision closes, THE UI_Animation_System SHALL move focus to a visible, valid and deterministic location without announcing hidden alternatives.
10. WHEN an animation, audio cue or haptic pattern fails, THE UI_Animation_System SHALL retain an accessible equivalent for every rule-significant result.
11. THE UI_Animation_System SHALL NOT encode a hidden state in alternate text, ARIA metadata, subtitle tracks, vibration patterns or reduced-motion replacements.

### Requirement 12: 日志、诊断与调试面板安全

**User Story:** As a 开发者或创作者, I want 表现故障可定位但不泄漏规则秘密, so that 诊断能力不会成为越权读取通道。

**权威来源：** 引擎层 requirements Requirement 15、36、39、40；基类层 requirements Requirement 13、14；P05 必须审查项 4、5、10。

#### Acceptance Criteria

1. THE UI_Animation_System SHALL record structured diagnostics for descriptor rejection, stale interaction, projection gaps, resource failure and fallback selection.
2. EVERY diagnostic SHALL include a stable code, severity, affected presentation location, reason and actionable hint when those fields are Visibility_Safe for its audience.
3. User-visible diagnostics SHALL be filtered for the Authorized_Agent before rendering.
4. Development diagnostics containing hidden identifiers, raw events or unrestricted state SHALL require explicit upstream authority and SHALL NOT be enabled by a client-only flag.
5. THE UI_Animation_System SHALL NOT write raw hidden entity identifiers, asset names derived from hidden semantics, secret conditions or unfiltered event payloads to a user-accessible log.
6. WHEN repeated presentation failures are folded or rate-limited, THE diagnostic system SHALL retain the first safe context, latest occurrence and count without changing rule processing.
7. IF a diagnostic renderer fails, THEN the UI_Animation_System SHALL preserve the underlying rule projection and SHALL NOT retry a rule action as recovery.
8. Debug overlays SHALL consume Read_Only_Projections and SHALL NOT expose mutable state controls.
9. WHEN replay or rewind is active, presentation diagnostics SHALL be labeled with the associated State_Revision so that later-revision warnings are not attributed to earlier rule state.
10. Resource-loader telemetry SHALL use opaque identifiers or filtered labels when a descriptive resource name would reveal hidden information.

### Requirement 13: 基类层描述与玩法层表现配置边界

**User Story:** As a 基类设计者, I want 可复用表现语义与具体玩法界面分离, so that 同一实例可被不同玩法和渲染实现复用。

**权威来源：** `docs/L0_规范宪法.md` 第一至三条；基类层 requirements Requirement 2、4、14、16；P05 必须审查项 6、7。

#### Acceptance Criteria

1. THE reusable Presentation Descriptor schema SHALL be independent of a named gameplay mode, concrete map, concrete HUD layout and concrete art resource.
2. THE Presentation Descriptor MAY declare semantic resource roles, interaction intents, postures, cost categories, visibility-safe availability, accessible labels and abstract asset references. [2026-08-08 权威变更：已删除 attack shapes 字段，见本文档 Requirement 4 变更说明。]
3. A Presentation_Profile MAY bind descriptor roles to concrete resources, arrange gameplay-specific HUD regions and select replaceable animation parameters.
4. IF a Presentation_Profile changes while the same semantic projection remains active, THEN action identifiers, legality, random outcomes and committed state SHALL remain unchanged.
5. IF a concrete gameplay hint, mode-specific phase panel, named map overlay or named resource is proposed as a reusable base descriptor default, THEN the descriptor validator SHALL reject it as gameplay or resource ownership.
6. THE UI_Animation_System SHALL NOT require modification of the reusable descriptor schema merely to change a layout, skin, animation clip, audio set or input-binding presentation.
7. THE UI_Animation_System SHALL NOT define a new引擎层 primitive, Op, Query operator, visibility mechanism or persistence mechanism.
8. WHEN a new reusable presentation semantic is proposed, ITS 基类层 eligibility SHALL be judged by enumerability, composability and independence from a specific gameplay profile.
9. IF the new semantic fails any eligibility criterion, THEN it SHALL remain in a gameplay Presentation_Profile or presentation-resource configuration.

### Requirement 14: 跨 Spec 只读依赖与汇合失败

**User Story:** As a 跨领域设计者, I want core、space-items 与 AI 只通过明确只读契约接入 UI, so that 本 Spec 不会提前复制或猜测其他领域的规则。

**权威来源：** P05 开始前读取约束与必须审查项 1、7、10；引擎层 requirements Requirement 14、25、36、40、44；基类层 requirements Requirement 10、14。

#### Acceptance Criteria

1. THE UI_Animation_System SHALL consume `core`, `space-items` and `AI` information only through the Pending_Convergence_Contracts listed in this document until cross-Spec review promotes them to stable contracts.
2. THE `core` contract SHALL provide projected resource roles, phase or flow semantics, legal actions, safe unavailable reasons and visible Decision / Intent state without requiring the UI to read arbitrary `props` paths.
3. THE `space-items` contract SHALL provide projected scene, transition, container, slot, item and equipment semantics plus legal interactions without requiring the UI to calculate topology or inventory legality.
4. THE `AI` contract SHALL provide only visible AI action state, public intent and safe explanation labels without exposing search internals or unrestricted knowledge.
5. IF a required pending contract is unavailable, THEN the UI_Animation_System SHALL mark the dependent feature unavailable with a structured integration diagnostic and SHALL NOT implement a local rule substitute.
6. WHEN cross-Spec field names or enums disagree, THE integration review SHALL preserve the conflict as unresolved and SHALL NOT choose a mapping solely to make a mockup render.
7. THE UI_Animation_System SHALL version every promoted cross-Spec descriptor contract or provide an equivalent compatibility discriminator.
8. IF a provider returns an unsupported contract version, THEN the UI_Animation_System SHALL reject affected semantic descriptors and MAY still render unrelated compatible projections.
9. THE UI_Animation_System SHALL NOT import or depend on another domain's private mutable store in order to satisfy a pending contract.

### Requirement 15: 首帧、全量重绘与增量演出一致性

**User Story:** As a 玩家, I want 开局、读档、重连和日常增量更新显示同一规则事实, so that 不同进入路径不会产生不同界面语义。

**权威来源：** 引擎层 requirements Requirement 37、40；引擎层 design §3.13、§3.15；基类层 requirements Requirement 14、15。

#### Acceptance Criteria

1. THE UI_Animation_System SHALL support full rendering from a Read_Only_Projection without requiring prior Rule_Event_Projections.
2. THE UI_Animation_System SHALL support incremental presentation from Visibility_Safe Rule_Event_Projections after a full projection establishes the current State_Revision.
3. GIVEN the same Authorized_Agent and State_Revision, full rendering and replaying the complete ordered incremental stream SHALL produce semantically equivalent visible state.
4. IF the incremental stream starts before a full projection, THEN the UI_Animation_System SHALL buffer only within a declared bounded policy or request a full projection; it SHALL NOT infer the missing initial state.
5. IF an entity retains its stable identifier across revisions, THEN the UI_Animation_System MAY reuse its view representation without reusing stale semantic fields.
6. IF a stable identifier is absent from the latest projection, THEN the UI_Animation_System SHALL remove the corresponding live view unless current Knowledge explicitly authorizes a remembered representation.
7. WHEN a full projection contradicts local animation state, THE full projection SHALL control the resulting visible semantic state.
8. WHEN unrelated Presentation_Fields fail, THE UI_Animation_System SHALL continue rendering compatible semantic projections and report each deterministic failure according to Requirement 9.

### Requirement 16: 可验证性与反向边界测试

**User Story:** As a 质量工程师, I want 每项边界都能被正向与反向验证, so that “只读”“不泄漏”和“动画不影响规则”不是不可测试口号。

**权威来源：** 基类层 requirements Requirement 15、16；P05 必须审查项 9、10 与完成前反向审查清单。

#### Acceptance Criteria

1. THE verification plan SHALL include a case where a UI consumer attempts direct Semantic_State mutation and SHALL expect Structured_Rejection with unchanged state.
2. THE verification plan SHALL execute equivalent authoritative action sequences with animations enabled, skipped, reduced and failed and SHALL expect identical rule results, random results and settlement order.
3. THE verification plan SHALL attempt hidden-information extraction through HUD, preview, unavailable reason, animation selection, log, debug panel, accessibility text, audio, haptics and resource naming and SHALL expect no unauthorized disclosure.
4. THE verification plan SHALL omit or corrupt each required Semantic_Field and SHALL expect rejection without invented semantics.
5. THE verification plan SHALL omit or corrupt each supported Presentation_Field with a declared fallback and SHALL expect that fallback plus Warning_Diagnostic without changed action availability; it SHALL also cover a required accessible presentation with neither a Visibility_Safe label nor a valid fallback and SHALL expect rejection under Requirement 9.9.
6. THE verification plan SHALL cover valid gameplay values 1 and 5, invalid boundary values, non-finite values and attempted pseudo-precision conversion.
7. THE verification plan SHALL cover pending input, additional activation attempts on a pending control, stale action bindings, expired Decision, target invalidation and state changes during submission; it SHALL expect the UI to create no second Interaction_Intent from the pending control and the authoritative contract to revalidate every Intent that it receives.
8. THE verification plan SHALL cover asynchronous resource completion, animation interruption, replay, rewind, skip, reconnect, revision gaps and multi-window convergence.
9. THE verification plan SHALL run visibility cases for at least two non-omniscient Agents with different knowledge scopes and an explicitly authorized omniscient Agent.
10. THE verification plan SHALL run color-independent, screen-reader, remapped-input and Reduced_Motion_Mode cases and SHALL expect semantically equivalent information and interaction identities.
11. THE verification plan SHALL assert that layout values, animation timing, asset paths, frame rates and performance targets cannot alter descriptor semantics or authoritative outcomes.
12. THE verification plan SHALL assert that gameplay-specific HUD composition and concrete resources can be replaced without changing the reusable Presentation Descriptor contract.
13. IF a requirement cannot produce an observable pass or fail result, THEN the requirement review SHALL revise or remove it before this Spec enters design.

## Requirement-to-Source Summary

| Requirement | Primary authority |
|---|---|
| 1 | L0 layering and terminology; L2 source classification |
| 2 | Kernel Query/action/presentation channels; L2 UI adapter |
| 3 | Kernel Knowledge/visibleTo/hidden Intent contracts |
| 4 | Op-only writes; action, Decision and Intent validation |
| 5 | Action and Decision lifecycle; P05 stale-input coverage |
| 6 | Confirmed decisions D-024—D-026, D-032（四项仪式动画）, D-035—D-036（轮次栏） |
| 7 | Op, random, persistence and presentation-channel separation |
| 8 | Snapshot/replay/rewind and P05 asynchronous consistency coverage |
| 9 | L2 semantic rejection and presentation fallback boundary |
| 10 | L0 1—5 rule and internal-metric exception |
| 11 | L2 accessible descriptor fields and L0 low-cognitive-load rules |
| 12 | Kernel diagnostics, visibility and read-only presentation boundary |
| 13 | L0 layer ownership and L2 descriptor scope |
| 14 | P05 cross-Spec isolation requirement; shared read contracts |
| 15 | Kernel full-query plus incremental-event presentation channels |
| 16 | L2 verifiability requirements and P05 reverse review |

## Explicit Non-Normative Examples

The following source elements may inform design exploration but are not semantic defaults or acceptance constants in this Spec:

- Concrete HUD positions, Z-index numbers, panel dimensions and scene-card geometry.
- Exact colors, glow effects, portal icons, key bindings and device mappings.
- Exact animation durations, transform curves, particle sets, particle counts, frame rates and resource sizes.
- Named gameplay resource bars, named weapon previews, named NPC phase panels and concrete inventory layouts.
- Historical mockups, staffing estimates, milestones, library candidates and performance estimates.

A later design may select values for these presentation concerns, but it must keep them replaceable, visibility-safe and unable to affect Semantic_State.

## Unresolved Integration Risks

1. `State_Revision` 的具体类型与意图提交时的并发校验字段尚需与权威运行时统一；本 Spec 只锁定“必须检测过期状态”的行为。
2. `Rule_Event_Projection` 的 Agent 过滤封装与安全字段集合尚需在设计阶段与引擎层接口统一；原始事件不得直接进入表现层是稳定边界。
3. `core`、`space-items`、`AI` 的字段级只读描述符仍是 Pending_Convergence_Contract，必须由后续跨 Spec 一致性审查汇合，不能由本 Spec 单方面定名。
4. D-024—D-026、D-031—D-036、D-042 已锁定项目表现方向、显著性分层、轮次栏结构与默认动画范围（含 D-032 的四项仪式动画）；具体资源、时长、像素尺寸和实现技术仍属于可替换表现配置。**D-026 与 D-032 之间的三项/四项冲突已按 Requirement 6.7 的修订机制裁决为四项，不再是未决风险。**
5. 具体布局、性能预算、设备覆盖矩阵与本地化资源策略属于设计阶段输入，不能反向改变本文件的规则边界。

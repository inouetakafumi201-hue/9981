# Requirements Document

## Introduction

本文档定义 WakeUp **基类层**（L2）的规范性需求。基类层位于引擎层（L1）与玩法层（L3）之间：L1 提供无具体玩法语义的原语与运行时不变量；L2 把 L1 原语约束成可复用的语义类型、组合规则、参数 Schema 和适配接口，并登记不含具体玩法规则与玩法数值的可复用实例；L3 组合 L2 实例、填写玩法数值并形成具体玩法。

本文档综合以下有效来源：

- `docs/L0_规范宪法.md`
- `docs/L1_引擎层/引擎层职责边界.md`
- `docs/L1_引擎层/元机制内核Spec_v1.md`
- `docs/L2_基类层/基类层定义.md`
- `docs/L2_基类层/02_游戏机制.md`
- `docs/L2_基类层/03_空间系统.md`
- `docs/L2_基类层/04_物品装备.md`
- `docs/L2_基类层/06_UGC系统.md`
- `docs/L2_基类层/07_AI系统.md`
- `docs/_术语表与废案清单.md`
- `docs/访谈决策记录.md`

> **2026-08-11 架构变更**：`08_图形化与UI`、`09_开发路线图`、`10_技术栈`、`11_测试与质量` 已从 L2 迁移至正交域（表现系统与工程治理），不再作为 L2 权威来源。详见交接项 H-L2-01~H-L2-03。

来源发生冲突时，本规范采用以下优先级：L0 规范宪法 → 已确认访谈决策 → L1 职责边界与不变量 → L2 定稿契约 → L2 待定内容 → 历史示例。低优先级来源不能覆盖高优先级来源；同优先级来源的实质冲突必须保留为 `Unresolved_Item`，不得由编译器、验证器或实现者自行选择结论。

本规范完成以下关键收敛：

1. L2 定义语义基类、无玩法数值的可复用实例、组合规则、参数 Schema 和适配契约；L1 负责原语与运行时不变量；L3 负责组合 L2 实例、填写玩法数值并定义具体玩法规则。
2. “继承决定类型，嵌套决定配置”是 L2 的规范性建模原则。
3. 枪械、防具、载具、僵尸、地图和 UI 文档中的具体示例不自动成为 L2 默认值。
4. D-006 的三种网关与 D-019 的纯声明式 JSON 属于 L2 契约。D-007 的体力上限与 D-008 的同分随机顺序是标准大逃杀玩法的具体规则：L2 只拥有参数或策略接口，具体值和策略选择由 L3 Profile 提供。
5. `docs/L0_规范宪法.md` 的决策索引与 `docs/访谈决策记录.md` 对 D-009、D-010 使用了不同内容。L0 中 D-009 的锁定术语和 D-010 的组合原则按 L2 契约处理；访谈记录中 D-009 的格挡/隐蔽规则和 D-010 的格斗系统可选范围按 L3 内容处理。编号复用必须保留独立来源定位并记录为追踪歧义，不得用一个条目覆盖另一个条目。
6. D-030 是具体载具乘员交互规则，归 L3 Profile；L2 只定义车辆邻接、门索引和乘员引用等可组合接口。
7. 微型场景不使用 `owner` 作为归属或生命周期依据；`parent` 表示附属关系，`props.creator` 仅表示不可变溯源信息，生命周期资格由有效父场景与当前占用状态共同决定。
8. 语义缺失、引用损坏、越层定义、不变量冲突和未解决的规范冲突必须被原子拒绝并产生诊断；拒绝后必须保持最后有效注册表状态或事务前语义状态。只有非语义表现字段允许显式降级。

## Glossary

- **WakeUp_System**：由 L1、L2 和 L3 组成的 WakeUp 整体系统。
- **引擎层（L1）**：提供 `Def`、`Entity`、`Item`、`Node`、`Link`、`Attachment`、`Agent`、`Op`、`Expr`、`Hook`、事务、查询、持久化和诊断等无具体玩法语义原语的层级。
- **基类层（L2）**：把 L1 原语约束为可复用语义类型、组合规则和参数 Schema，并登记不含具体玩法规则与玩法数值的可复用实例和外部适配接口的层级。
- **玩法层（L3）**：组合 L2 实例、填写玩法数值、定义胜负规则和配置具体玩法的层级。
- **Base_Layer_Spec**：本需求文档定义的基类层规范。
- **Specification_Compiler**：读取规范来源、应用来源优先级并生成可追踪规范模型的组件。
- **Definition_Registry**：登记、解析、激活和查询基类定义的组件。
- **Definition_Validator**：检查层级归属、类型、组合、参数、引用和不变量的组件。
- **Reference_Resolver**：解析定义标识符、依赖关系和类型化引用的组件。
- **JSON_Codec**：解析、规范化输出和往返验证纯声明式 JSON 的组件。
- **UGC_Adapter**：把创作者输入转换为候选声明式定义并提交统一验证的接口。
- **AI_Adapter**：向 AI 消费方提供合法动作、策略、标签、认知切片和诊断的只读接口。
- **UI_Adapter**：把规范语义投影为 UI 可消费描述符且不改变规则结果的接口。
- **Test_Interface**：向测试提供定义生成、验证、装载和结果观察能力的接口。
- **Def**：L1 的静态定义原语；L2 基类必须映射到合法 Def kind。
- **Def kind**：L1 允许的定义种类，包括 entity、item、node、link、attachment、action、rule、playpack、decision、prefab、expr、schedule 和 policy。
- **基类**：L2 中表达本质语义差异、可被继承或组合的定义。
- **实例**：L2 通过组合基类形成、不含具体玩法规则与玩法数值、可供 L3 复用的具体产物。
- **类型身份（Type_Identity）**：决定定义可执行契约、合法关系、必需能力或替换兼容性的本质语义。
- **继承（Inheritance）**：通过 `extends` 表达类型身份与契约细化的关系。
- **嵌套（Composition）**：通过引用、附件、能力、容器、槽位或参数对象表达配置的关系。
- **参数 Schema**：参数名称、数据类型、单位、值域、必填性、引用目标类型和约束的声明。
- **玩法数值（Gameplay_Value）**：影响具体玩法平衡、概率、成本、伤害、恢复、持续时间、容量或阈值的具体赋值。
- **结构边界（Structural_Bound）**：用于保证类型结构、认知上限或引擎不变量的规范限制。
- **宪法常量（Constitutional_Constant）**：由 L0 固定并带来源编号、归属和适用字段的约束。
- **内部度量（Internal_Metric）**：回合编号、实体数量、距离计算结果、结算预算和性能统计等不作为玩法参数的系统数值。
- **Paid_Action**：消耗一个 AP 单位的动作契约。
- **Attached_Action**：依附于 Paid_Action、不能独立形成决策分支的零 AP 动作契约。
- **Action_Family**：动作前置条件、成本类别、效果引用和中断条件组成的 L2 契约族。
- **Gateway_Family**：资源转换网关、检定网关和条件网关组成的 L2 契约族。
- **Natural_Scene_Family**：大场景、中场景和小场景组成的天然场景契约族。
- **Micro_Scene**：附属于天然场景并承载局部接触关系的 Node 类型。
- **Transition_Family**：连接天然场景并声明方向、通行条件和阻挡接口的 Link 契约族。
- **Item_Family**：物品、武器、防具、消耗品、弹药、配件、钥匙和工具的 L2 契约族。
- **Weapon_Family**：近战、非枪械远程和枪械语义类型及攻击谱型接口组成的契约族。
- **Vehicle_Family**：作为 Entity 存在并声明座位、货舱、门引用和能力接口的契约族。
- **Damage_Family**：伤害类别、来源、目标和结算接口组成的契约族。
- **Status_Family**：状态持续、叠加、触发、打断和效果接口组成的契约族。
- **Skill_Family**：主动、被动和触发技能的前置条件、触发与效果接口组成的契约族。
- **Movement_Family**：地面、载具和传送移动的合法性、目标和成本参数接口组成的契约族。
- **Attachment_Family**：状态附件、属性附件和技能附件的宿主、来源、持续与回收接口组成的契约族。
- **AI_Behavior_Family**：供 L3 声明状态、目标、意图、转换和感知参数的 AI 行为契约族。
- **Read_Only_Semantic_Projection**：从已验证定义和运行时状态派生、不能直接写入语义状态的受限视图。
- **Presentation_Descriptor**：UI 使用的资源语义、交互意图、姿态、成本类别、可访问性标签和素材引用描述。【2026-08-08 权威变更：已删除"攻击形状"字段，判定为冗余设计，见本文档 Requirement 8.3 变更说明与 docs/L0_规范宪法.md 最新内容。2026-08-11 所有权迁移：`Presentation_Descriptor` 所有权已迁移至表现系统端口契约（见交接项 H-L2-02），L2 仅提供通用只读语义投影。】
- **Declarative_JSON**：只描述数据、条件、引用和已知效果组合，不包含任意代码、命令式循环或变量赋值的 JSON。
- **Semantic_Field**：影响类型、规则、参数、引用或运行结果的字段。
- **Presentation_Field**：只影响名称、图标、纹理、动画或辅助文本且不改变规则结果的字段。
- **Definition_Package**：一次验证和原子装载的一组基类定义、依赖声明和来源元数据。
- **Diagnostic**：包含稳定代码、严重级别、JSON 路径、定义标识符、来源定位、原因和修正建议的验证结果。
- **Error_Diagnostic**：阻止候选定义、实例、操作或 Definition_Package 生效的诊断。
- **Warning_Diagnostic**：不改变语义且不阻止装载的提示诊断。
- **Structured_Rejection**：包含 Error_Diagnostic 且明确表示候选变更未生效的拒绝结果。
- **Semantic_State**：影响规则结果的已注册定义和运行时数据状态。
- **Historical_Example**：用于说明设计意图但不产生规范默认值或 L2 实例的来源内容。
- **Normative_Contract**：必须实现和验证的 L2 规则。
- **L3_Profile**：由 L3 拥有的实例、玩法规则、策略选择或具体参数集合。
- **Unresolved_Item**：来源明确待定，或同优先级来源存在尚未裁决的实质冲突的内容。
- **Source_Record**：包含来源文件、来源位置、来源层级、决策编号和规范分类的追踪记录。
- **Equivalent_Definition**：忽略 JSON 对象键顺序和非语义格式差异后具有相同类型、参数、引用和约束的定义。
- **Canonical_Snapshot**：以确定性顺序表示已激活定义、引用和来源记录的回归比较视图。

## Requirements

### Requirement 1: 权威来源、冲突和决策一致性

**User Story:** As a 规范维护者, I want 基类层使用可追踪的来源优先级并保留未裁决冲突, so that 跨文档差异不会产生隐式裁决或两套实现。

#### Acceptance Criteria

1. THE Specification_Compiler SHALL apply the source precedence L0 规范宪法, confirmed interview decisions, L1 boundaries and invariants, finalized L2 contracts, unresolved L2 content, then Historical_Examples.
2. WHEN source statements from different precedence levels conflict, THE Specification_Compiler SHALL select the higher-precedence statement as the Normative_Contract.
3. WHEN a lower-precedence statement is displaced, THE Specification_Compiler SHALL create a Diagnostic identifying the displaced statement and controlling Source_Record.
4. WHEN source statements at the same precedence level conflict materially, THE Specification_Compiler SHALL preserve every conflicting statement in one Unresolved_Item.
5. WHEN an Unresolved_Item affects a candidate Normative_Contract, THE Specification_Compiler SHALL withhold the affected Normative_Contract until an authoritative decision resolves the conflict.
6. THE Base_Layer_Spec SHALL use 引擎层, 基类层, 玩法层, 实例 and 基类 as the canonical Chinese layer and modeling terms.
7. IF a normative definition replaces a canonical term with 内容层, 模板层, 玩法包层, 模板类型 or 对象, THEN THE Definition_Validator SHALL return a Structured_Rejection identifying the canonical term.
8. THE Base_Layer_Spec SHALL classify D-006 and D-019 as L2 Normative_Contracts.
9. THE Base_Layer_Spec SHALL classify the concrete D-007 stamina limit and D-008 tie-order behavior as L3_Profile content consumed through L2 parameter and policy interfaces.
10. THE Specification_Compiler SHALL retain the L0 D-009 terminology entry and the interview-record D-009 gameplay entry as separate Source_Records.
11. THE Specification_Compiler SHALL retain the L0 D-010 composition entry and the interview-record D-010 optional-combat entry as separate Source_Records.
12. WHEN a decision identifier maps to different source statements, THE Specification_Compiler SHALL emit a tracking Diagnostic without merging the statements.
13. THE Base_Layer_Spec SHALL classify D-030 as L3_Profile content consumed through L2 vehicle-interaction interfaces.

### Requirement 2: L1、L2 与 L3 职责边界

**User Story:** As an 架构师, I want 每个定义都有明确且唯一的层级归属, so that 引擎原语、可复用语义和具体玩法不会互相污染。

#### Acceptance Criteria

1. THE Base_Layer_Spec SHALL limit L2 output to semantic base types, reusable instances without Gameplay_Values or gameplay-specific rules, composition rules, parameter schemas and adapter contracts.
2. WHEN an L2 base type or reusable instance is declared, THE Definition_Validator SHALL require the definition to map to one valid L1 Def kind.
3. IF an L2 definition introduces a runtime Ref prefix, transaction model, Op dispatch mechanism, Expr evaluator, Hook scheduler or persistence mechanism, THEN THE Definition_Validator SHALL return a Structured_Rejection with the code category `LAYER_L1_OWNERSHIP`.
4. IF an L2 definition declares a concrete map arrangement, victory condition, spawn distribution, game-mode sequence or instance coupled to a specific gameplay profile, THEN THE Definition_Validator SHALL return a Structured_Rejection with the code category `LAYER_L3_OWNERSHIP`.
5. IF an L2 definition assigns a Gameplay_Value without Constitutional_Constant or Structural_Bound classification, THEN THE Definition_Validator SHALL return a Structured_Rejection with the code category `VALUE_L3_OWNERSHIP`.
6. WHEN L3 composes a gameplay profile, THE Definition_Registry SHALL require the profile to use registered L2 base types, reusable instances and parameter schemas.
7. IF an L3 instance violates an L1 invariant or L2 contract, THEN THE Definition_Validator SHALL return a Structured_Rejection without changing registered definitions or runtime Semantic_State.
8. THE Base_Layer_Spec SHALL expose semantic extension points without requiring L3 authors to modify L1 mechanisms.

### Requirement 3: 继承、组合和确定性解析

**User Story:** As a 基类设计者, I want 类型差异和配置差异使用不同机制表达, so that 基类树保持稳定且组合结果可复用、可预测。

#### Acceptance Criteria

1. THE Definition_Registry SHALL use Inheritance only to express Type_Identity and contract specialization.
2. THE Definition_Registry SHALL use Composition to express parameter values, attack patterns, damage configuration, slots, tags, attachments and optional capabilities.
3. WHEN a child base type is declared, THE Definition_Validator SHALL require a Type_Identity difference in required capabilities, legal relationships, invariants or substitution compatibility.
4. IF a child base type differs from a parent only by Gameplay_Value assignments, THEN THE Definition_Validator SHALL return a Structured_Rejection recommending Composition.
5. IF an inheritance graph contains a cycle, THEN THE Definition_Validator SHALL return a Structured_Rejection for every definition participating in the cycle.
6. WHEN a derived definition inherits compatible fields, THE Definition_Registry SHALL resolve the fields according to the declared inheritance lineage.
7. WHEN multiple inherited definitions provide one field, THE Definition_Registry SHALL require an explicit deterministic precedence or merge declaration for the field.
8. IF inherited definitions provide incompatible field types or constraints without an explicit valid resolution, THEN THE Definition_Validator SHALL return a Structured_Rejection for the derived definition.
9. WHEN a definition contains nested Composition, THE Reference_Resolver SHALL resolve every nested component before the containing definition becomes active.
10. WHEN the same valid definition is resolved repeatedly, THE Definition_Registry SHALL produce an Equivalent_Definition on every resolution.
11. WHEN an optional capability is removed from a composition, THE Definition_Registry SHALL preserve the host Type_Identity unless the capability is declared as type-defining.

### Requirement 4: 基类登记与公共契约

**User Story:** As a 内容工具开发者, I want 所有基类族遵循一致的登记契约, so that 编辑器、验证器、AI 和 UI 可以使用同一份定义。

#### Acceptance Criteria

1. THE Definition_Registry SHALL require every L2 base definition and reusable instance to declare a unique identifier, Def kind, abstract status, semantic family and parameter schema.
2. THE Definition_Registry SHALL support semantic families including actions, gateways, natural scenes, transitions, items, weapons, vehicles, damage, statuses, skills, movement, attachments and AI behaviors without treating the list as exhaustive.
3. WHEN a new concept is enumerable, composable and independent of a specific gameplay profile, THE Definition_Validator SHALL accept a new L2 semantic family with a Source_Record explaining the classification.
4. IF a proposed semantic family depends on a specific gameplay profile, THEN THE Definition_Validator SHALL return a Structured_Rejection identifying L3 ownership.
5. WHEN a base definition is abstract, THE Definition_Validator SHALL accept inheritance and reference operations for the abstract definition.
6. IF an instance targets an abstract base definition, THEN THE Definition_Validator SHALL return a Structured_Rejection with an instantiation Diagnostic.
7. WHEN an L2 definition declares an action or rule reference, THE Reference_Resolver SHALL verify the referenced Def kind before registration.
8. IF definitions use the same identifier in one resolution scope, THEN THE Definition_Validator SHALL return a Structured_Rejection identifying every conflicting definition.
9. THE Definition_Registry SHALL expose the resolved type lineage, nested capabilities, parameter schema, tags, actions and rules for each registered definition.
10. WHEN a definition is extended through a package dependency, THE Definition_Registry SHALL preserve the originating package and source location.

### Requirement 5: 参数、数值和常量归属

**User Story:** As a 玩法设计者, I want L2 定义参数接口而由 L3 填写玩法数值, so that 基类复用不会被单一玩法的平衡方案锁死。

#### Acceptance Criteria

1. THE Base_Layer_Spec SHALL allow L2 parameter schemas to declare data type, unit, range, required status, reference type and cross-field constraints.
2. THE Base_Layer_Spec SHALL assign concrete Gameplay_Values to L3_Profile ownership.
3. WHERE a Structural_Bound defines an L2 type contract, THE Base_Layer_Spec SHALL require an authoritative Source_Record and structural rationale for the bound.
4. WHERE a Constitutional_Constant applies, THE Base_Layer_Spec SHALL require a source identifier, owning layer and affected fields.
5. WHEN a numeric field is classified as a Gameplay_Value, THE Definition_Validator SHALL apply the Constitutional_Constant range defined by L0.
6. WHEN a numeric field is classified as an Internal_Metric, THE Definition_Validator SHALL apply the declared Internal_Metric schema instead of Gameplay_Value constraints.
7. IF a numeric field lacks a Gameplay_Value, Structural_Bound, Constitutional_Constant or Internal_Metric classification, THEN THE Definition_Validator SHALL return a Structured_Rejection identifying the ambiguous field.
8. IF an L2 base definition embeds a damage table, probability table, AP price table, duration, recovery amount, capacity or threshold as a Gameplay_Value, THEN THE Definition_Validator SHALL return a Structured_Rejection identifying L3 ownership.
9. WHEN the D-007 stamina limit is supplied, THE Definition_Validator SHALL accept the concrete value only as part of the identified standard battle-royale L3_Profile.
10. WHEN D-008 tie ordering is supplied, THE Definition_Validator SHALL accept the concrete behavior only as an L3 schedule-policy selection exposed by an L2 policy schema.
11. WHEN L2 source material contains numeric examples, THE Specification_Compiler SHALL classify each example as Structural_Bound, Constitutional_Constant, L3_Profile, Historical_Example or Unresolved_Item.
12. IF a source does not support a character limit, collection capacity, file-size limit or test-count constant, THEN THE Specification_Compiler SHALL return a Structured_Rejection for the proposed normative constant.

### Requirement 6: 动作、回合接口和三种网关

**User Story:** As a 机制组合者, I want 动作和网关具有不绑定具体玩法值的统一契约, so that 商店、锁门、合成和检定可以复用相同结构。

#### Acceptance Criteria

1. THE Action_Family SHALL declare actor requirements, target requirements, cost category, effect references, interruption conditions and completion state.
2. THE Action_Family SHALL represent a multi-step paid interaction as an ordered sequence of Paid_Actions with an explicit intermediate status.
3. THE Action_Family SHALL represent an Attached_Action as dependent on a Paid_Action and unavailable as an independent decision branch.
4. IF an action declares a multi-AP atomic cost, THEN THE Definition_Validator SHALL return a Structured_Rejection recommending a multi-step sequence.
5. THE Gateway_Family SHALL provide distinct type contracts for resource-conversion, check and condition gateways.
6. THE Gateway_Family SHALL require a resource-conversion definition to declare input-resource references, output-effect references and deterministic success semantics.
7. THE Gateway_Family SHALL require a check definition to declare an L1 random or evaluation primitive reference, a configurable criterion and success and failure effect references.
8. THE Gateway_Family SHALL require a condition definition to declare a boolean Expr reference and success and failure effect references.
9. IF a gateway embeds a named shop, named lock, named crafting station or concrete threshold, THEN THE Definition_Validator SHALL return a Structured_Rejection identifying L3 ownership.
10. IF a gateway condition fails at runtime, THEN THE WakeUp_System SHALL return a Structured_Rejection without applying any gateway effect.

### Requirement 7: 空间、微型场景和过渡契约

**User Story:** As a 地图工具开发者, I want 天然场景、微型场景和过渡连接拥有明确且正交的契约, so that 地图配置不会混淆空间层级或生成悬空关系。

#### Acceptance Criteria

1. THE Natural_Scene_Family SHALL distinguish large, medium and small scene Type_Identities without creating concrete map nodes.
2. THE Natural_Scene_Family SHALL classify authoritative connection-count limits as Structural_Bounds rather than L3 map values.
3. THE Micro_Scene SHALL require exactly one valid natural-scene parent reference.
4. THE Micro_Scene SHALL treat `props.creator` as immutable provenance metadata rather than ownership or lifecycle state.
5. THE Micro_Scene SHALL determine lifecycle eligibility from the valid parent reference and current occupancy contract.
6. IF a Micro_Scene declares an owner field as the source of ownership or lifecycle behavior, THEN THE Definition_Validator SHALL return a Structured_Rejection identifying the invalid semantics.
7. THE Transition_Family SHALL declare endpoint references, directionality, traversal-condition references and blocking-capability references.
8. IF a transition endpoint does not resolve to a permitted natural-scene endpoint type, THEN THE Reference_Resolver SHALL return a Structured_Rejection for the transition definition.
9. IF a Micro_Scene parent reference does not resolve, THEN THE Reference_Resolver SHALL return a Structured_Rejection for the containing Definition_Package.
10. THE Natural_Scene_Family SHALL require the small-scene type to expose a shared Micro_Scene capability and exclude personal vacant-ground Micro_Scenes.
11. THE Vehicle_Family SHALL model a vehicle as an Entity rather than a Micro_Scene or Item.
12. WHEN a parent natural scene is removed in a candidate transaction, THE Definition_Validator SHALL require the candidate transaction to resolve every child Micro_Scene reference through an L1-supported lifecycle operation.
13. IF a candidate parent-scene removal leaves a child Micro_Scene reference unresolved, THEN THE WakeUp_System SHALL return a Structured_Rejection and preserve the pre-transaction Semantic_State.

### Requirement 8: 物品、武器、防具和载具契约

**User Story:** As a 玩法内容作者, I want 物品与装备族提供稳定的能力接口, so that L3 可以组合不同内容而不复制容器、攻击或载具规则。

#### Acceptance Criteria

1. THE Item_Family SHALL declare container eligibility, slot requirements, equip requirements, tags, granted actions and attachment points as parameterized contracts.
2. THE Weapon_Family SHALL distinguish melee, non-firearm ranged and firearm Type_Identities.
3. THE Weapon_Family SHALL model weapon attributes (e.g. scatter, sweep, burst), range profile, damage reference, target limit, ammunition behavior and accessory compatibility through Composition. [2026-08-08 权威变更（本次会话裁决，已获项目所有者授权）：废除"攻击形状"（attack shape，含 single-target/spread/area 三选一形状轴）这一独立分类概念，判定为冗余设计——其功能已被武器属性（散射/扫射/连发）完全覆盖。武器不再声明形状身份；散射/扫射属性不设固定命中目标数上限。详见 docs/L0_规范宪法.md、docs/L2_基类层/基类层定义.md §4.3 最新权威内容。]
4. IF a weapon definition couples a reusable instance to a specific gameplay profile or assigns a concrete damage value, THEN THE Definition_Validator SHALL return a Structured_Rejection identifying L3 ownership.
5. THE Item_Family SHALL require armor definitions to expose mitigation-rule references, break-condition references and equipment-slot requirements without embedding a concrete armor instance.
6. THE Item_Family SHALL require consumable definitions to expose use-location, effect-reference and consumption-behavior fields.
7. THE Vehicle_Family SHALL expose seat roles, cargo containers, independently addressable door references, lock capability, movement capability, collision capability and destruction disposition as parameter schemas.
8. THE Vehicle_Family SHALL preserve each declared door identifier as a stable reference within a resolved definition.
9. THE Vehicle_Family SHALL expose vehicle adjacency and door-specific targeting as separate composable interaction inputs.
10. WHEN an L3_Profile selects D-030 behavior, THE Definition_Validator SHALL require passenger interaction to use the D-030 vehicle-adjacency policy declared by that profile.
11. WHEN a carried-item relationship is queried, THE Item_Family SHALL expose heavy-tag aggregation through L1 query and relation interfaces.
12. WHEN an L3_Profile selects a death-container capability, THE Item_Family SHALL require the capability to reference a newly created deposit-disabled container and content references derived from the deceased-entity transaction.
13. IF an item composition creates a dangling slot, container, ammunition-profile or accessory reference, THEN THE Reference_Resolver SHALL return a Structured_Rejection for the composition.

### Requirement 9: 伤害、状态、技能、移动和附件契约

**User Story:** As a 系统设计者, I want 效果类基类共享可组合契约, so that L3 能定义新效果而不把运行时机制伪装成语义类型。

#### Acceptance Criteria

1. THE Damage_Family SHALL declare damage-category identity, source requirements, target requirements and settlement-pipeline references without assigning damage amounts.
2. THE Status_Family SHALL declare duration mode, stack mode, trigger references, interruption references and effect references.
3. THE Skill_Family SHALL distinguish active, passive and triggered Type_Identities through activation semantics.
4. THE Skill_Family SHALL express cost, cooldown, trigger condition and effect through parameter schemas and Composition.
5. THE Movement_Family SHALL distinguish ground, vehicle and teleport Type_Identities through traversal semantics.
6. THE Movement_Family SHALL expose cost, speed, range, terrain modifier and collision effect as L3-owned parameters.
7. THE Attachment_Family SHALL declare host type, source type, duration mode, stack behavior, granted rules and cleanup behavior.
8. IF an L2 status definition represents an L1 runtime transition without reusable gameplay semantics, THEN THE Definition_Validator SHALL return a Structured_Rejection with the code category `LAYER_L1_RUNTIME_STATE`.
9. IF an elemental, status or skill subtype differs only by a name or Gameplay_Value, THEN THE Definition_Validator SHALL return a Structured_Rejection requiring L3 composition.
10. WHEN composed statuses declare an interaction, THE Definition_Validator SHALL require an explicit interaction-rule reference.
11. THE Specification_Compiler SHALL classify the interview-record D-009 blocking and hiding behavior as L3_Profile rules rather than L2 defaults.
12. THE Specification_Compiler SHALL classify the interview-record D-010 combat-system scope as optional L3_Profile content rather than an L2 core contract.

### Requirement 10: AI 声明式接口、只读投影与职责边界

**User Story:** As an AI 设计者, I want L2 提供只读语义投影和行为 Schema 而不复制搜索算法或具体 NPC, so that 玩家 AI、NPC AI 和 UGC 行为遵守同一层级边界。

#### Acceptance Criteria

1. THE AI_Behavior_Family SHALL expose state names, transition conditions, goal references, intent references, perception-parameter schemas and fallback-state references.
2. THE AI_Adapter SHALL consume L1 policy, query, belief-slice, visibility, evaluation-guard and deterministic-random interfaces without redefining the interfaces.
3. THE AI_Adapter SHALL expose separate policy categories for player assistance and NPC behavior.
4. IF a player-assistance policy is assigned as an NPC behavior policy, THEN THE Definition_Validator SHALL return a Structured_Rejection for the assignment.
5. IF an L2 AI definition embeds a patrol route, concrete perception threshold, gameplay-profile-specific state machine or NPC instance coupled to one gameplay profile, THEN THE Definition_Validator SHALL return a Structured_Rejection identifying L3 ownership.
6. WHEN L3 defines a reusable NPC paradigm, THE Definition_Validator SHALL require the paradigm to use the AI_Behavior_Family schema and registered L1 primitives.
7. WHEN an AI policy queries Semantic_State, THE AI_Adapter SHALL return a Read_Only_Semantic_Projection restricted to the policy's authorized belief and visibility scope.
8. IF an AI consumer attempts to mutate Semantic_State through a Read_Only_Semantic_Projection, THEN THE WakeUp_System SHALL return a Structured_Rejection and preserve the pre-request Semantic_State.
9. WHEN an AI consumer submits an action request, THE WakeUp_System SHALL validate the request through the same action contract used by non-AI callers.
10. IF an evaluation result is null, nonnumeric or nonfinite, THEN THE AI_Adapter SHALL return an evaluation Diagnostic and the policy's declared neutral fallback result.
11. WHEN a policy requires action tags, THE Reference_Resolver SHALL verify every required tag and action reference during package validation.
12. IF a required AI action set resolves to an empty set because of missing definitions, THEN THE Definition_Validator SHALL return a Structured_Rejection for the policy.
13. THE Base_Layer_Spec SHALL assign search algorithms, transaction-safe simulation and random-stream mechanics to L1 ownership.

### Requirement 11: 纯声明式 JSON、UGC 解析和往返

**User Story:** As a UGC 创作者, I want 创作内容使用可验证的声明式 JSON, so that 自然语言和图形化工具生成的内容可以安全、稳定地装载。

#### Acceptance Criteria

1. THE JSON_Codec SHALL accept base definitions encoded as Declarative_JSON with an explicit schema version.
2. IF JSON input contains executable code, dynamic evaluation directives, command-style loops or variable assignment, THEN THE JSON_Codec SHALL return a Structured_Rejection identifying the prohibited construct.
3. WHEN syntactically invalid JSON is provided, THE JSON_Codec SHALL return a Structured_Rejection containing the source location and parse reason.
4. WHEN syntactically valid JSON is provided, THE JSON_Codec SHALL preserve every Semantic_Field for Definition_Validator processing.
5. THE JSON_Codec SHALL provide a canonical pretty-print operation that produces syntactically valid Declarative_JSON.
6. WHEN a valid definition is parsed, pretty-printed and parsed again, THE JSON_Codec SHALL produce an Equivalent_Definition.
7. WHEN an Equivalent_Definition is pretty-printed repeatedly, THE JSON_Codec SHALL produce identical canonical output after the first normalization.
8. WHEN the UGC_Adapter converts natural language or editor state, THE UGC_Adapter SHALL emit candidate Declarative_JSON rather than executable code.
9. WHEN candidate Declarative_JSON is emitted, THE UGC_Adapter SHALL submit the candidate to the same Definition_Validator used for hand-authored JSON.
10. IF a Semantic_Field is missing or damaged, THEN THE Definition_Validator SHALL return a Structured_Rejection without inventing semantic content.
11. WHERE a Presentation_Field is missing or damaged, THE UGC_Adapter SHALL use a type-compatible presentation fallback and emit a Warning_Diagnostic.
12. IF an edit damages an existing Semantic_Field, THEN THE Definition_Registry SHALL preserve the last valid registered definition until the edited definition passes validation.

### Requirement 12: 引用完整性、依赖和原子装载

**User Story:** As a 模组维护者, I want 所有引用在装载前被完整解析, so that 删除、覆盖和跨包组合不会留下悬空状态。

#### Acceptance Criteria

1. THE Reference_Resolver SHALL resolve every base, action, rule, expression, policy, node, link, item, attachment, container and slot reference before package activation.
2. THE Reference_Resolver SHALL verify that each resolved reference matches the expected Def kind or semantic family.
3. IF a required reference is missing, THEN THE Reference_Resolver SHALL return a Structured_Rejection containing the referring JSON path and missing identifier.
4. IF a reference resolves to an incompatible kind or family, THEN THE Reference_Resolver SHALL return a Structured_Rejection identifying the expected and actual types.
5. IF a package dependency graph contains a cycle without a supported cycle contract, THEN THE Reference_Resolver SHALL return a Structured_Rejection for every package participating in the cycle.
6. WHEN a definition is replaced by an allowed override, THE Reference_Resolver SHALL revalidate every dependent definition before activation.
7. IF an override invalidates a dependent definition, THEN THE Definition_Registry SHALL return a Structured_Rejection and retain the previous active package set.
8. WHEN a Definition_Package passes all validation, THE Definition_Registry SHALL activate the complete package as one atomic change.
9. IF any Error_Diagnostic occurs during package validation or activation, THEN THE Definition_Registry SHALL activate none of the candidate package changes.
10. WHEN a registered definition is removed, THE Reference_Resolver SHALL require every inbound reference to be removed or redirected in the same candidate atomic change.
11. IF a candidate removal leaves an inbound reference unresolved, THEN THE Definition_Registry SHALL return a Structured_Rejection and retain the previous active package set.
12. THE Definition_Registry SHALL expose a dependency graph identifying inbound and outbound references for each registered definition.

### Requirement 13: 非法定义拒绝、诊断和状态不变

**User Story:** As a 非程序员创作者, I want 非法定义得到可定位、可修复且不破坏现有内容的反馈, so that 试错不会造成半装载或静默错误。

#### Acceptance Criteria

1. THE Definition_Validator SHALL classify every validation finding as Error_Diagnostic or Warning_Diagnostic.
2. THE Definition_Validator SHALL include a stable code, severity, definition identifier, JSON path, source package, source location, reason and correction suggestion in every Diagnostic.
3. IF a candidate violates a layer boundary, locked decision, type contract, numeric ownership rule, reference rule or L1 invariant, THEN THE Definition_Validator SHALL return a Structured_Rejection.
4. WHEN any candidate definition, instance, descriptor, policy or Definition_Package is rejected, THE Definition_Registry SHALL preserve the complete last valid active registry state.
5. WHEN only Warning_Diagnostics are returned, THE Definition_Registry SHALL permit activation without changing the meaning of Semantic_Fields.
6. IF runtime input violates an action or gateway precondition, THEN THE WakeUp_System SHALL return a Structured_Rejection and preserve the pre-request Semantic_State.
7. IF runtime processing would violate an L1 invariant, THEN THE WakeUp_System SHALL abort the containing transaction, return a Structured_Rejection and preserve the pre-transaction Semantic_State.
8. IF a candidate contains multiple independently discoverable errors, THEN THE Definition_Validator SHALL report every deterministically discoverable error in one validation result.
9. THE Definition_Validator SHALL provide human-readable explanations in addition to stable diagnostic codes.
10. IF a tool proposes silent semantic coercion for an illegal definition, THEN THE Definition_Validator SHALL return a Structured_Rejection for the proposal.
11. WHERE a fallback affects only a Presentation_Field, THE WakeUp_System SHALL record the fallback in a Warning_Diagnostic.
12. IF a rejection result lacks an Error_Diagnostic, THEN THE WakeUp_System SHALL treat the rejection result as an invalid validation result and preserve the applicable pre-operation state.

### Requirement 14: UI 声明式只读投影接口

**User Story:** As a UI 开发者, I want UI 从稳定的只读语义描述符读取状态, so that 表现层可以变化而不改变核心规则或复制玩法判断。

#### Acceptance Criteria

1. THE UI_Adapter SHALL derive Presentation_Descriptors from a Read_Only_Semantic_Projection of registered definitions and validated runtime state.
2. THE Presentation_Descriptor SHALL expose resource semantic role, interaction intent, posture, cost category, availability, unavailability reason, accessible label and asset reference. [2026-08-08 权威变更：已删除 attack shape 字段，见 Requirement 8.3 变更说明。]
3. THE UI_Adapter SHALL expose HP, stamina and AP as distinct resource semantic roles without requiring field-name inference.
4. THE UI_Adapter SHALL expose traversal, precise interaction, hostile interaction and executable-target intents as distinct interaction semantics.
5. [2026-08-08 已废止（本次会话裁决，已获项目所有者授权）：本条原要求 UI_Adapter 暴露 single-target/spread/area 三种攻击形状语义值；攻击形状判定为冗余设计，已被武器属性（散射/扫射/连发）完全覆盖，本条不再适用。详见 docs/L0_规范宪法.md、docs/L2_基类层/基类层定义.md §4.3、docs/L2_基类层/08_图形化与UI.md 最新权威内容。]
6. THE UI_Adapter SHALL expose Paid_Actions and Attached_Actions as separate action groups.
7. IF UI input requests an unavailable action, THEN THE WakeUp_System SHALL return a Structured_Rejection through the same action contract used by non-UI callers.
8. WHEN a UI renderer is replaced, THE UI_Adapter SHALL preserve every semantic action identifier and validation result.
9. WHERE a Presentation_Field is unavailable, THE UI_Adapter SHALL expose type-compatible fallback presentation metadata with a Warning_Diagnostic.
10. IF a UI consumer attempts to mutate a Semantic_Field through a Read_Only_Semantic_Projection or Presentation_Descriptor, THEN THE WakeUp_System SHALL return a Structured_Rejection and preserve the pre-request Semantic_State.
11. THE Base_Layer_Spec SHALL keep rendering framework, animation library and transport-library choices outside L2 semantic contracts.

### Requirement 15: 测试接口与可验证性质

**User Story:** As a 质量工程师, I want 基类层暴露可自动验证的性质和测试接口, so that 组合、解析和拒绝行为可以覆盖广泛输入而不是只测试历史示例。

#### Acceptance Criteria

1. THE Test_Interface SHALL support generation of valid and invalid definitions for every registered semantic family.
2. THE Test_Interface SHALL expose JSON parsing, canonical printing, inheritance resolution, composition resolution, reference resolution, package validation and atomic activation as independently observable operations.
3. WHEN valid Declarative_JSON values are generated, THE Test_Interface SHALL verify the parse-print-parse round-trip property.
4. WHEN a valid definition is resolved repeatedly, THE Test_Interface SHALL verify inheritance and Composition resolution idempotence.
5. WHEN independent compatible compositions are applied in different orders, THE Test_Interface SHALL verify Equivalent_Definition results or an explicitly declared order dependency.
6. WHEN invalid references are generated, THE Test_Interface SHALL verify deterministic Structured_Rejection and unchanged registry state.
7. WHEN a candidate package contains an invalid definition, THE Test_Interface SHALL verify atomic rejection with zero candidate changes.
8. WHEN numeric fields are generated at and outside declared boundaries, THE Test_Interface SHALL verify parameter classification, range and ownership constraints.
9. WHEN inheritance graphs are generated, THE Test_Interface SHALL verify cycle rejection and deterministic conflict resolution.
10. WHEN Semantic_Fields are omitted or corrupted, THE Test_Interface SHALL verify Structured_Rejection without semantic fallback.
11. WHEN Presentation_Fields are omitted or corrupted, THE Test_Interface SHALL verify type-compatible fallback with Warning_Diagnostics.
12. WHEN source records at equal precedence contain a material conflict, THE Test_Interface SHALL verify preservation as an Unresolved_Item without a generated default.
13. WHEN a rejected runtime operation is generated, THE Test_Interface SHALL verify an Error_Diagnostic and preservation of the pre-operation Semantic_State.
14. THE Test_Interface SHALL support representative integration tests for L1 registry, persistence, UI rendering, AI consumption and external-service wiring.
15. THE Test_Interface SHALL reserve property-based testing for variable, low-cost WakeUp-owned logic.
16. THE Test_Interface SHALL use representative integration or smoke tests for external services, infrastructure and configuration.
17. THE Definition_Registry SHALL provide a Canonical_Snapshot after successful activation.

### Requirement 16: 历史示例、待定项和来源追踪

**User Story:** As a 文档审查者, I want 每条来源内容标明规范地位、归属和来源位置, so that 历史示例、占位值、冲突项和未来构想不会被误当成 L2 强制规则。

#### Acceptance Criteria

1. THE Specification_Compiler SHALL classify each imported source statement as Normative_Contract, L3_Profile, Historical_Example or Unresolved_Item.
2. WHEN a source section is marked as 示例, 待定, 占位, 候选, 未来 or 需专题讨论, THE Specification_Compiler SHALL prevent the section from becoming an L2 default without a higher-precedence decision.
3. WHEN a named weapon, map or NPC appears in a source, THE Specification_Compiler SHALL classify the item by L2 eligibility, gameplay-profile coupling and source status rather than by the presence of a name.
4. THE Specification_Compiler SHALL classify concrete ballistic tables, concrete armor values, concrete vehicle values and concrete zombie parameters as L3_Profile or Historical_Example content.
5. THE Specification_Compiler SHALL classify pure UI mockup values, animation timings, performance targets, staffing estimates and budget estimates outside L2 semantic contracts.
6. THE Specification_Compiler SHALL classify D-017 cover-rule details and D-018 firearm base-damage values as Unresolved_Items.
7. THE Specification_Compiler SHALL classify deprecated mechanics recorded in the 废案清单 as prohibited normative inputs.
8. IF a definition reintroduces a prohibited deprecated mechanic as an L2 standard contract, THEN THE Definition_Validator SHALL return a Structured_Rejection citing the controlling Source_Record.
9. THE Base_Layer_Spec SHALL maintain at least one authoritative Source_Record or explicit conflict-resolution record for every Normative_Contract.
10. THE Source_Record SHALL preserve the source file, source location, source precedence, decision identifier and owning layer for each imported statement.
11. WHEN a future decision resolves an Unresolved_Item, THE Specification_Compiler SHALL require the resolving decision identifier and Source_Record before promoting the item to a Normative_Contract.
12. WHEN a Historical_Example is displayed in documentation or tooling, THE UI_Adapter SHALL label the example as non-default and non-normative.
13. WHEN an L3_Profile value is displayed in L2 documentation or tooling, THE UI_Adapter SHALL label the value with L3 ownership and source provenance.


---

## 交接项（Handoff Items）

以下为跨 Spec 架构变更产生的交接项。按架构决策原则，不跨 Spec 改对方交付物，需要对方改动时写成交接项登记。

| 编号 | 目标 Spec/文档 | 待办内容 | 依据 |
|------|--------------|---------|------|
| H-L2-01 | 表现系统 | `docs/L2_基类层/08_图形化与UI.md` 已迁移至 `docs/表现系统/01_图形化与UI.md`。表现系统需确认该文档作为表现层权威来源，并在 `.kiro/specs/wakeup-ui-animation/requirements.md` §2.1 S-06 中正确引用新路径。 | 2026-08-11 架构重组：表现从 L2 迁移至正交域 |
| H-L2-02 | 表现系统端口契约 | `Presentation_Descriptor` 所有权已从 L2 迁移至表现系统端口契约。L2 仅提供通用只读语义投影接口（`UI_Adapter`），不再拥有 `Presentation_Descriptor` 的字段定义权威。表现系统需定义完整的 `Presentation_Descriptor` Schema 与端口契约。 | 2026-08-11 所有权裁决；`src/l2/adapters/ui-adapter.ts` 已登记迁移债务 |
| H-L2-03 | 工程治理 | `docs/L2_基类层/09_开发路线图.md`、`10_技术栈.md`、`11_测试与质量.md` 已迁移至 `docs/工程治理/**`（具体路径待工程治理域确认）。工程治理域需确认这些文档的最终归属路径与维护责任。 | 2026-08-11 架构重组：工程横切关注点从 L2 迁移至正交域 |


# Requirements Document

## Introduction

本文档定义 WakeUp 的 **UGC 声明式定义接入边界**。UGC 不是独立的运行时语义层，也不拥有第二套规则引擎；它只负责接收手写 JSON、图形化工具或自然语言适配器产生的候选数据，将候选数据转换为纯声明式 JSON，并提交基类层统一的 `Definition_Validator`、`Reference_Resolver` 与 `Definition_Registry`。只有完成语法解析、规范校验、引用解析、兼容迁移和整体验证的候选变更，才可以由既有注册表原子激活。

本文档严格限定在以下范围：

- 纯声明式 JSON 的输入、安全解析与确定性规范化；
- 所有创作入口共用的候选定义和统一验证路径；
- 层级归属、字段、标识符、组合、数值与引用检查；
- 结构化诊断、资源配额、恶意深度和拒绝策略；
- Schema 版本、玩法包版本和既有迁移契约的兼容检查；
- 候选变更的原子激活与最后有效状态保护；
- 对核心机制、空间物品和 AI 的待汇合类型化引用契约。

以下事项不属于本文档范围：编辑器界面与交互、自然语言模型的对话策略、社区审核、发布分发、下载缓存、创作者激励、商业生态、素材生产、网络传输、宿主持久化实现、运行时沙箱，以及任何新的引擎层原语。相关系统可以产生或传递候选声明式 JSON，但不能改变本文档规定的验证与激活边界。

### 权威来源与冲突处理

本文档采用以下优先级：`docs/L0_规范宪法.md` → `docs/访谈决策记录.md` 中已确认决策 → 引擎层不变量与职责边界 → 基类层有效契约 → 玩法层定稿规则 → 历史示例。低优先级来源不能覆盖高优先级来源；待定项和历史示例不得生成规范默认值。

本文档不读取或假定核心机制、空间物品、AI 等并行领域 Spec 的最终字段形状。依赖这些领域的候选定义只能通过“待汇合类型契约”声明所需能力；契约未汇合、无法唯一解析或类型不兼容时，候选变更必须被拒绝。

## Glossary

- **UGC_System**：本文档定义的声明式候选接入、验证编排、诊断聚合和激活协调边界。
- **Declarative_JSON**：只描述数据、条件、引用和已登记效果组合，不包含可执行代码、动态求值指令、命令式循环、变量赋值、脚本注入或外部命令执行的 JSON。
- **Candidate_Document**：由任意创作入口提交、尚未获得激活资格的原始 JSON 文档及其来源元数据。
- **Candidate_Change_Set**：在同一验证快照上共同接受或共同拒绝的一组候选新增、替换和删除。
- **Validated_Change_Set**：通过完整验证、绑定验证基线且可提交给 `Definition_Registry` 的候选变更集。
- **Definition_Validator**：基类层统一的定义验证组件；所有来源必须使用同一实现与同一规则集。
- **Reference_Resolver**：按既有 Def 标识符、Def kind、语义族和依赖契约解析引用的基类层组件。
- **Definition_Registry**：登记、查询并原子激活已验证定义的基类层组件。
- **JSON_Codec**：解析 JSON、拒绝禁止结构并生成规范化 JSON 的组件。
- **UGC_Adapter**：将自然语言、图形化工具状态或其他创作输入转换为 `Candidate_Document` 的不可信边界适配器。
- **Semantic_Field**：影响类型、参数、规则、引用、约束、激活结果或运行结果的字段。
- **Presentation_Field**：只表示图标、纹理、动画、字体、本地化素材等非语义表现资源引用或渲染元数据，且不改变任何规则结果的字段；名称、辅助文本或其他数据只有在上游 Schema 明确证明其不参与标识、查询、可见性、决策或规则时才可归入本类。
- **Gameplay_Value**：由玩法层拥有、影响具体玩法平衡、概率、成本、伤害、恢复、持续时间、容量或阈值的数值。
- **Internal_Metric**：回合编号、实体数量、版本号、资源大小、解析位置、配额计数、迁移步数和性能统计等技术数值。
- **Definition_Package**：作为一个候选变更集接受验证和原子激活的一组定义、依赖声明与来源记录；它不等同于玩法包。
- **Playpack**：玩法层拥有的具体玩法声明，组合已登记的基类层实例并填写玩法数值和规则。
- **Typed_Reference**：由字段 Schema 声明预期 Def kind、语义族和提供领域，并使用既有 Def 标识符表达目标的引用；它不引入新的 Ref 前缀。
- **Integration_Contract**：核心机制、空间物品或 AI 领域在汇合时提供的类型、语义族和可引用能力契约。
- **Canonical_JSON**：按照 Schema 语义和稳定排序规则生成、相同定义在相同版本下产生相同字节序列的 JSON。
- **Equivalent_Definition**：忽略非语义格式差异后，类型、参数、引用、约束与来源归属一致的定义。
- **Diagnostic**：使用既有引擎层诊断结构表示的稳定代码、严重级别、定位、原因、期望值、实际值和修正建议。
- **Structured_Rejection**：至少包含一个错误级 Diagnostic，并明确表示候选变更未激活的拒绝结果。
- **Validation_Baseline**：验证时所依据的 Schema 版本、集成契约版本和最后有效注册表快照标识。
- **Source_Record**：记录来源文件或文档、来源位置、来源优先级、决策编号、拥有层级和规范地位的追踪信息。
- **Technical_Quota**：由可信宿主提供、用于限制输入字节数、结构深度、成员数、定义数、引用边数、迁移步数或规范化输出大小的技术资源上限。

## Diagnostic Categories

UGC_System 不新增引擎层错误码族。每个诊断必须映射到已登记的 `E_LOAD_*`、`E_REF_*`、`E_EXPR_*`、`E_FLOW_*`、`E_MIG_*` 或 `E_QUOTA_*` 代码及严重级别。设计阶段应根据汇合后的上游错误码注册表确定具体成员，但不得使用自由字符串绕过封闭错误码契约。

| 诊断类别 | 必须覆盖的情况 | 上游类别或代码族 |
|---|---|---|
| `JSON_SYNTAX` | JSON 语法错误、重复对象成员名、无法定位的输入截断 | `E_LOAD_*` |
| `PROHIBITED_CONSTRUCT` | 可执行代码、动态求值、命令式循环、变量赋值、脚本或外部命令 | `E_LOAD_*` / `E_FLOW_*` |
| `SCHEMA_CONTRACT` | 缺失 Schema 版本、未知字段、非法字段类型、非法 Def kind | `E_LOAD_*` |
| `IDENTITY_CONFLICT` | 缺失 ID、重复 ID、未授权覆盖、歧义目标 | `E_LOAD_*` / `E_REF_*` |
| `LAYER_L1_OWNERSHIP` | UGC 或基类层定义引入引擎层原语、运行时状态或机制 | 基类层冻结类别 `LAYER_L1_OWNERSHIP`；运行时状态细分使用 `LAYER_L1_RUNTIME_STATE` |
| `LAYER_L3_OWNERSHIP` | 基类层定义混入具体玩法实例、配置或规则 | 基类层冻结类别 `LAYER_L3_OWNERSHIP` |
| `VALUE_L3_OWNERSHIP` | 基类层定义写入玩家可见玩法数值 | 基类层冻结类别 `VALUE_L3_OWNERSHIP` |
| `VALUE_CLASSIFICATION_MISSING` | 数值未分类，或其控制来源和边界无法确定 | `E_LOAD_NUMERIC_OWNERSHIP` |
| `REFERENCE_CONTRACT` | 引用缺失、歧义、类型错误、语义族错误或引用环 | `E_REF_*` / `E_LOAD_*` |
| `COMPOSITION_CONFLICT` | 继承环、组合冲突、未声明的顺序依赖 | `E_LOAD_*` |
| `RESOURCE_LIMIT` | 输入或候选图超过可信技术配额、结构深度异常 | `E_QUOTA_*` / `E_LOAD_*` |
| `VERSION_COMPATIBILITY` | 不支持的版本、迁移缺口、迁移歧义、迁移环或迁移失败 | `E_MIG_*` / `E_LOAD_*` |
| `ATOMIC_ACTIVATION` | 验证基线过期、提交时重检失败、部分激活企图 | `E_LOAD_*` |
| `PRESENTATION_FALLBACK` | 非语义表现资源缺失或损坏并使用兼容替代项 | 已登记的警告代码 |

## Requirements

### Requirement 1: UGC 职责、层级归属与明确排除边界

**User Story:** As a 架构维护者, I want UGC 只承担声明式定义接入职责, so that 创作工具不会成为第二套引擎或绕过三层架构。

**来源追踪：** L0 第一至五节；引擎层职责边界第一至四章；基类层 Spec Requirement 2；P04 审查项 2、4、9。

#### Acceptance Criteria

1. THE UGC_System SHALL operate only on Candidate_Documents, Candidate_Change_Sets, diagnostics and validation results before activation.
2. THE UGC_System SHALL NOT define or extend Ref prefixes, Def kind registries, Op dispatch, Expr evaluation, Hook scheduling, transaction semantics, runtime state mutation or persistence mechanisms.
3. IF a candidate requests a new Ref prefix, Op dispatcher, Expr evaluator, Hook scheduler, transaction path or persistence path, THEN THE Definition_Validator SHALL return a Structured_Rejection with category `LAYER_L1_OWNERSHIP`.
4. THE UGC_System SHALL require each activation unit to declare exactly one target ownership layer: 基类层 or 玩法层.
5. WHEN the target is 基类层, THE Definition_Validator SHALL permit only reusable semantic base types, reusable instances without Gameplay_Values, composition contracts and parameter Schemas.
6. IF a 基类层 candidate contains a concrete map arrangement, victory condition, spawn distribution or gameplay-profile sequence, THEN THE Definition_Validator SHALL return a Structured_Rejection with category `LAYER_L3_OWNERSHIP`; IF it contains a concrete Gameplay_Value without an authoritative Constitutional_Constant or Structural_Bound classification, THEN THE Definition_Validator SHALL use category `VALUE_L3_OWNERSHIP`.
7. WHEN the target is 玩法层, THE Definition_Validator SHALL require the candidate to compose already registered 基类层 contracts for concrete instances, values, victory rules and Playpack configuration.
8. IF a 玩法层 candidate attempts to mutate the 基类层 registry or redefine a registered base contract in the same activation unit, THEN THE Definition_Validator SHALL return a Structured_Rejection with category `LAYER_L3_OWNERSHIP`.
9. IF a candidate declares item volume classes or any other prohibited deprecated mechanic as a normative field, THEN THE Definition_Validator SHALL return a Structured_Rejection with category `SCHEMA_CONTRACT`, identifying the controlling Source_Record.
10. THE UGC_System SHALL keep editor UI, model conversation history, distribution, moderation, achievements, commerce, networking and host persistence outside this specification.

### Requirement 2: 纯声明式 JSON 与禁止执行面

**User Story:** As a 安全工程师, I want every UGC input to remain inert declarative data, so that untrusted creations cannot execute code or commands.

**来源追踪：** D-019；基类层 Spec Requirement 11；引擎层 Spec Requirements 12、13、22、42；P04 审查项 1。

#### Acceptance Criteria

1. THE JSON_Codec SHALL accept only syntactically valid JSON with an explicit supported Schema version.
2. THE JSON_Codec SHALL treat all Candidate_Documents as untrusted input regardless of whether they originate from hand-authored JSON, an editor, a model or an official tool.
3. THE Declarative_JSON SHALL describe only data, conditions, Typed_References and combinations of effects already admitted by upstream Schemas.
4. IF a candidate contains executable code, dynamic evaluation directives, function definitions, command-style loops, variable assignment, script payloads, process invocation or external command execution, THEN THE JSON_Codec SHALL return a Structured_Rejection with category `PROHIBITED_CONSTRUCT`.
5. IF a candidate requests interpretation of a string as code, an expression language not registered by the 引擎层, or an effect form not admitted by the active Schema, THEN THE Definition_Validator SHALL return a Structured_Rejection with category `PROHIBITED_CONSTRUCT`.
6. THE UGC_System SHALL NOT execute Candidate_Document fields to determine whether the candidate is valid.
7. THE UGC_System SHALL NOT use a runtime script sandbox as a substitute for static parsing, Schema validation, reference resolution or quota validation.
8. WHEN syntactically invalid JSON is received, THE JSON_Codec SHALL return a parse Diagnostic containing the stable code, source document, byte or line-column location, parse reason and correction hint.
9. IF one JSON object contains duplicate member names, THEN THE JSON_Codec SHALL reject the document before ordinary object materialization can discard an earlier value.
10. WHEN parsing fails, THE UGC_System SHALL perform no definition registration, reference mutation, migration or activation operation.

### Requirement 3: 单一候选与统一验证入口

**User Story:** As a 平台维护者, I want every creation path to converge on one validator, so that no trusted-looking adapter can bypass safety checks.

**来源追踪：** 基类层 Spec Requirement 11.8-11.12、Requirement 13；引擎层 Op 唯一写入与装载边界；P04 审查项 3。

#### Acceptance Criteria

1. THE UGC_Adapter SHALL emit a Candidate_Document and source metadata only; it SHALL NOT emit an already active definition.
2. WHEN an editor, model or import tool produces a candidate, THE UGC_Adapter SHALL submit it to the same JSON_Codec and Definition_Validator used for hand-authored JSON.
3. THE Definition_Validator SHALL apply the same active Schema version, Integration_Contracts, Technical_Quotas and diagnostic policy to equivalent candidates from every source.
4. THE UGC_Adapter SHALL NOT mark its own output as validated, suppress Error_Diagnostics or convert an error into a warning.
5. THE UGC_Adapter SHALL NOT call an Op, write WorldState, modify the active Definition_Registry, invoke activation or write host persistence as part of candidate conversion.
6. IF an adapter output lacks source identity, target ownership layer or Schema version, THEN THE Definition_Validator SHALL return a Structured_Rejection with category `SCHEMA_CONTRACT`.
7. WHEN a candidate is edited after validation, THE UGC_System SHALL invalidate the prior validation result and validate the complete edited Candidate_Change_Set again.
8. IF a caller presents a validation result that was produced for different candidate bytes, a different Validation_Baseline or a different target registry, THEN THE Definition_Registry SHALL reject activation with category `ATOMIC_ACTIVATION`.
9. THE UGC_System SHALL expose no alternate “force load”, “skip validation”, “trusted source” or “activate with errors” path.
10. WHEN equivalent candidate bytes and source ownership are submitted through different adapters, THE validation result SHALL contain equivalent diagnostics in the same deterministic order.

### Requirement 4: 严格 Schema、字段、种类与标识符验证

**User Story:** As a 定义维护者, I want malformed structure and identity conflicts rejected before reference resolution, so that ambiguous definitions never enter the registry.

**来源追踪：** 基类层 Spec Requirements 4、11、13；引擎层 Spec Requirements 1、3、32、39；P04 审查项 7。

#### Acceptance Criteria

1. THE Definition_Validator SHALL validate every field against the Schema selected by the candidate's explicit Schema version.
2. IF a field is absent from the applicable closed Schema, THEN THE Definition_Validator SHALL return a Structured_Rejection with category `SCHEMA_CONTRACT` and the exact JSON path.
3. WHERE a Schema explicitly declares an open property map, THE Definition_Validator SHALL accept keys in that map without treating unrelated objects as open Schemas.
4. IF a required field is missing, has an invalid JSON type or violates a cross-field constraint, THEN THE Definition_Validator SHALL return a Structured_Rejection with expected and actual values.
5. THE Definition_Validator SHALL obtain legal Def kinds from the merged upstream registry and SHALL NOT maintain a UGC-specific Def kind list.
6. IF a candidate uses a Def kind not present in that registry, THEN THE Definition_Validator SHALL return a Structured_Rejection with category `SCHEMA_CONTRACT`.
7. THE Definition_Validator SHALL require every candidate definition to have one nonempty identifier valid under the existing identifier contract.
8. IF two candidate definitions share an identifier in one resolution scope, THEN THE Definition_Validator SHALL report every conflicting source location and reject the complete Candidate_Change_Set with category `IDENTITY_CONFLICT`.
9. IF a candidate identifier already exists in the active registry and no upstream-authorized override declaration uniquely covers it, THEN THE Definition_Validator SHALL return a Structured_Rejection with category `IDENTITY_CONFLICT`.
10. WHEN an authorized override is declared, THE Definition_Validator SHALL validate the replacement and every transitive dependent against the resulting candidate graph before activation.
11. IF an override target is missing or ambiguous, THEN THE Definition_Validator SHALL reject the complete Candidate_Change_Set with category `IDENTITY_CONFLICT`; IF the unique target has an incompatible kind, THEN it SHALL reject the change set with category `REFERENCE_CONTRACT`.
12. THE Definition_Validator SHALL continue independent structural checks after discovering one error and SHALL return all deterministically discoverable structural errors.

### Requirement 5: 数值分类、所有权与边界

**User Story:** As a 玩法设计者, I want gameplay numbers and technical numbers classified explicitly, so that the 1-5 rule is enforced without corrupting versions, quotas or internal metrics.

**来源追踪：** L0 第四条；基类层 Spec Requirement 5；引擎层 Spec Requirements 1、39、41；D-023 由更高优先级 L0 的内部数值例外校准；P04 审查项 5。

#### Acceptance Criteria

1. THE applicable Schema SHALL classify every numeric field as Gameplay_Value, Internal_Metric, Structural_Bound, Constitutional_Constant or Technical_Quota before the field can be accepted.
2. IF a numeric field has no unique classification, THEN THE Definition_Validator SHALL return a Structured_Rejection with category `VALUE_CLASSIFICATION_MISSING`.
3. WHEN a field is classified as Gameplay_Value, THE Definition_Validator SHALL require 玩法层 ownership and a finite value within the inclusive range 1 through 5.
4. IF a 基类层 candidate assigns a concrete Gameplay_Value without an authoritative Constitutional_Constant or Structural_Bound classification, THEN THE Definition_Validator SHALL reject it with category `VALUE_L3_OWNERSHIP` without moving that value into another field or inventing a default.
5. WHEN a field is an Internal_Metric, version component, source offset, resource size or Technical_Quota, THE Definition_Validator SHALL apply that field's own Schema and SHALL NOT apply the Gameplay_Value range.
6. THE Definition_Validator SHALL require every accepted numeric value to be finite and SHALL reject negative, fractional or otherwise invalid technical values where the field Schema requires a nonnegative integer.
7. A candidate-provided unit label SHALL NOT by itself exempt an unclassified numeric field from validation.
8. A candidate SHALL NOT raise, disable or reinterpret a trusted-host Technical_Quota through its own fields.
9. IF a candidate places the same number in conflicting ownership classes, THEN THE Definition_Validator SHALL return a Structured_Rejection with category `VALUE_CLASSIFICATION_MISSING`, identifying the conflicting Schema paths and Source_Records.
10. THE validation interface SHALL support boundary checks at 1 and 5, values below and above the range, nonfinite host values, version values greater than 5 and quota values greater than 5.

### Requirement 6: 基类层定义与玩法层配置隔离

**User Story:** As a 基类设计者, I want reusable definitions separated from concrete gameplay configuration, so that UGC cannot smuggle gameplay rules into the reusable registry.

**来源追踪：** L0 第一至三条；D-009、D-010；基类层 Spec Requirements 2、3、5、16；P04 审查项 9。

#### Acceptance Criteria

1. THE Definition_Validator SHALL require the target ownership layer to be part of the validation context and diagnostic output.
2. WHEN a 基类层 definition declares a parent lineage, THE Definition_Validator SHALL require Inheritance to express only Type_Identity or contract specialization; WHEN it declares configurable capabilities, THE Definition_Validator SHALL require Composition for those capabilities. Root types, atomic semantic units, parameter Schemas and composition contracts SHALL NOT be rejected solely because they omit Inheritance, Composition or both.
3. IF an inheritance declaration changes only a name or Presentation_Field, THEN THE Definition_Validator SHALL reject that declaration with category `LAYER_L3_OWNERSHIP`; IF it changes only a concrete Gameplay_Value, THEN THE Definition_Validator SHALL reject it with category `VALUE_L3_OWNERSHIP`.
4. A 基类层 reusable instance SHALL NOT contain a concrete victory rule, map layout, spawn arrangement, gameplay-profile sequence or concrete balance table.
5. A 玩法层 candidate SHALL reference registered 基类层 definitions and parameter Schemas instead of copying or redefining them.
6. IF a 玩法层 candidate references an abstract or non-instantiable base as a concrete instance, THEN THE Definition_Validator SHALL return a Structured_Rejection with category `REFERENCE_CONTRACT`.
7. THE Definition_Registry SHALL NOT activate a 基类层 Definition_Package as a Playpack.
8. THE Definition_Registry SHALL NOT activate a Playpack into the 基类层 registry.
9. IF one Candidate_Change_Set mixes 基类层 registry mutations with 玩法层 activation, THEN THE Definition_Validator SHALL reject it and require separate atomic change sets.
10. WHEN a 玩法层 candidate supplies concrete values, THE Definition_Validator SHALL verify those values against the referenced 基类层 parameter Schemas and L0 numeric constraints.

### Requirement 7: 类型化跨领域引用与完整依赖图

**User Story:** As a UGC author, I want references checked against the providing domain and expected type, so that missing or incompatible definitions fail before activation.

**来源追踪：** 基类层 Spec Requirements 4、10、12；引擎层 Spec Requirements 1、3、13、33、39；P04 审查项 6、7。

#### Acceptance Criteria

1. THE Reference_Resolver SHALL resolve every candidate reference before activation, including references to base definitions, actions, rules, expressions, policies, nodes, links, items, attachments, containers, slots and Integration_Contracts where applicable.
2. EACH reference-bearing Schema field SHALL identify the expected Def kind or semantic family and, for a cross-domain reference, the providing domain contract.
3. THE serialized reference SHALL use the existing Def identifier and Ref contract; the UGC_System SHALL NOT introduce a domain-specific Ref prefix.
4. IF the expected Integration_Contract for core mechanics, space-items or AI has not been merged and registered, THEN THE Reference_Resolver SHALL reject the dependent candidate rather than infer the provider's shape.
5. IF a required target is missing, THEN THE Reference_Resolver SHALL return a Diagnostic containing the referring definition, JSON path, expected type and missing identifier.
6. IF one reference resolves to more than one candidate or active target, THEN THE Reference_Resolver SHALL reject it with category `IDENTITY_CONFLICT` and list every competing source.
7. IF a target exists but has an incompatible Def kind, semantic family or provider domain, THEN THE Reference_Resolver SHALL reject it with category `REFERENCE_CONTRACT`, including expected and actual types.
8. THE Reference_Resolver SHALL build deterministic inbound and outbound dependency edges for every candidate and affected active definition.
9. IF the candidate dependency graph contains a reference cycle or package dependency cycle, THEN THE Reference_Resolver SHALL reject every participating definition with a deterministic cycle path. Inheritance cycles SHALL be owned by Requirement 8 validation, and migration cycles SHALL be owned by Requirement 12 compatibility validation.
10. WHEN a definition is replaced or removed, THE Reference_Resolver SHALL revalidate every transitive inbound dependent in the same Candidate_Change_Set.
11. IF a removal or replacement leaves one inbound reference unresolved or incompatible, THEN THE Definition_Registry SHALL preserve the previous active registry and reject the complete change set.
12. THE Reference_Resolver SHALL return dependency graph nodes and edges in stable identifier and JSON-path order for diagnostics and tests.

### Requirement 8: 继承、组合与冲突拒绝

**User Story:** As a 定义组合者, I want composition outcomes to be deterministic and conflict-aware, so that order accidents cannot silently change semantics.

**来源追踪：** D-010；基类层 Spec Requirements 3、4、12、15；引擎层 Spec Requirements 3、33；P04 审查项 7。

#### Acceptance Criteria

1. THE Definition_Validator SHALL detect inheritance cycles and report each participating identifier and one deterministic cycle path.
2. WHEN multiple parents or components provide the same Semantic_Field, THE applicable upstream Schema SHALL provide an explicit merge rule or precedence declaration.
3. IF inherited or composed values have incompatible types, constraints or semantic families, THEN THE Definition_Validator SHALL reject the containing definition with category `COMPOSITION_CONFLICT`.
4. IF a material conflict has no explicit upstream-authorized resolution, THEN THE Definition_Validator SHALL NOT select a winner based on object key order, file order, adapter source or hash iteration order.
5. WHEN a composition declares an order dependency, THE Definition_Validator SHALL validate that the ordering field is explicit, complete and deterministic.
6. WHEN independent compatible components are presented in different input orders, resolution SHALL produce Equivalent_Definitions.
7. WHEN an explicitly ordered composition is resolved repeatedly, resolution SHALL preserve the declared order and produce the same Equivalent_Definition.
8. IF a component is missing, abstract where a concrete target is required or incompatible with its host, THEN the complete containing definition SHALL be rejected with category `REFERENCE_CONTRACT`; IF the component is prohibited by layer ownership, THEN it SHALL be rejected with the applicable `LAYER_L1_OWNERSHIP` or `LAYER_L3_OWNERSHIP` category.
9. THE Definition_Validator SHALL detect duplicate component declarations where the applicable composition contract requires uniqueness.
10. THE UGC_System SHALL NOT invent a merge policy, default component or conflict winner when the upstream contract is unresolved.

### Requirement 9: 技术配额、恶意深度与输入炸弹防护

**User Story:** As a runtime operator, I want validation resource use bounded by trusted policy, so that deeply nested or oversized UGC cannot exhaust the host.

**来源追踪：** 引擎层 Spec Requirements 22、24、39、41、43；基类层 Spec Requirements 11、13、15；P04 审查项 7 和完成前反向审查。

#### Acceptance Criteria

1. THE UGC_System SHALL receive Technical_Quotas from a trusted host configuration that is independent of the candidate document.
2. THE validation boundary SHALL support quotas for input bytes, JSON nesting depth, object members, array elements, definitions, reference edges, dependency traversal work, migration steps and canonical output bytes.
3. THE Technical_Quotas SHALL use their own nonnegative finite integer Schemas and SHALL NOT be restricted to 1 through 5.
4. IF parsing or validation would exceed any Technical_Quota, THEN THE UGC_System SHALL stop the affected bounded traversal, return a Structured_Rejection with category `RESOURCE_LIMIT` and activate nothing.
5. THE JSON_Codec and Reference_Resolver SHALL use bounded or iterative traversal so that malicious nesting cannot cause an unhandled call-stack overflow.
6. IF an input uses exponential aliasing, repeated references or composition fan-out to exceed the trusted work budget, THEN THE Definition_Validator SHALL reject the complete change set deterministically.
7. A resource-limit rejection SHALL identify the quota class, configured limit, observed or lower-bound usage and source location where available, without echoing the complete oversized payload.
8. THE UGC_System SHALL NOT persist a partial parse tree, partial dependency graph or partially migrated candidate as an active definition after quota rejection.
9. Technical_Quotas SHALL be resource constraints only and SHALL NOT redefine the architectural ability of registered definitions to reference nested structures through existing 引擎层 contracts.
10. WHEN the same oversized candidate is validated against the same quotas, it SHALL fail in the same quota category without unbounded memory growth.

### Requirement 10: 语义拒绝与表现资源显式降级

**User Story:** As a creator, I want invalid rules rejected while harmless visual gaps receive visible fallbacks, so that the game never silently changes my intended semantics.

**来源追踪：** 基类层 Spec Requirements 11.10-11.12、13；L0 层级约束；P04 审查项 8。`docs/L2_基类层/06_UGC系统.md` 的一般性静默回退陈述由更高优先级契约校准。

#### Acceptance Criteria

1. IF any required Semantic_Field is missing, damaged, unknown, incompatible or illegal, THEN THE Definition_Validator SHALL return a Structured_Rejection.
2. THE UGC_System SHALL NOT copy an old semantic value, invent a semantic default, drop an invalid rule, skip an invalid reference or coerce an illegal semantic value to make validation pass.
3. IF an edit damages a Semantic_Field of an active definition, THEN THE Definition_Registry SHALL retain the complete last valid definition and reject the edited candidate.
4. A Presentation_Field MAY degrade only where the applicable Schema explicitly marks it optional and provides a type-compatible fallback contract.
5. WHEN a Presentation_Field fallback is used, THE UGC_System SHALL emit a `PRESENTATION_FALLBACK` Warning_Diagnostic containing the definition identifier, JSON path, missing or damaged asset reference and selected fallback identity.
6. A Presentation_Field fallback SHALL NOT change actions, costs, targets, references, collision, visibility, AI decisions, rule outcomes or any other semantic result.
7. IF a purported presentation resource carries executable behavior, semantic parameters or rule-bearing metadata, THEN THE Definition_Validator SHALL classify it as semantic and reject invalid input rather than degrade it.
8. IF no type-compatible presentation fallback is registered, THEN the candidate SHALL remain valid only when the field is truly optional and omission has no semantic effect; otherwise it SHALL be rejected.
9. Warning_Diagnostics alone MAY permit activation, but they SHALL NOT authorize any semantic coercion.
10. THE validation interface SHALL make the resolved presentation fallback observable without mutating the original Candidate_Document.

### Requirement 11: 确定性规范化与往返性质

**User Story:** As a package maintainer, I want one canonical representation, so that reviews, hashes and repeated validation do not change across machines or input formatting.

**来源追踪：** 基类层 Spec Requirements 11、15；引擎层确定性排序、回放与诊断契约；P04 审查项 7。

#### Acceptance Criteria

1. THE JSON_Codec SHALL provide canonical serialization only after syntactic parsing and Schema selection succeed.
2. THE Canonical_JSON SHALL order object keys by one documented, locale-independent total order.
3. THE Canonical_JSON SHALL preserve arrays whose order is semantic and SHALL sort only collections that the applicable Schema explicitly classifies as unordered.
4. WHEN an unordered collection is normalized, THE JSON_Codec SHALL sort it by a stable semantic identity defined by the applicable Schema and SHALL reject unresolved duplicate identities.
5. THE JSON_Codec SHALL NOT insert timestamps, random identifiers, host paths, locale-specific numbers or environment-dependent values into Canonical_JSON.
6. WHEN a valid definition is parsed, canonicalized and parsed again, the second parse SHALL produce an Equivalent_Definition.
7. WHEN Canonical_JSON is canonicalized repeatedly under the same Schema version, every output after the first SHALL be byte-identical.
8. WHEN equivalent candidates differ only in whitespace, object key order or permitted unordered-collection order, canonicalization SHALL produce byte-identical output.
9. WHEN candidates differ in a semantic array order, canonicalization SHALL preserve that difference unless the Schema explicitly declares the array unordered.
10. THE Definition_Registry SHALL expose a deterministic snapshot of activated identifiers, resolved references, ownership layers and source records after successful activation.
11. Diagnostics and dependency graph output SHALL use stable sorting and SHALL NOT depend on adapter submission timing or hash-map iteration order.
12. IF canonicalization cannot determine a unique result because Schema semantics or identity are unresolved, THEN THE JSON_Codec SHALL return a Structured_Rejection with category `SCHEMA_CONTRACT` or `COMPOSITION_CONFLICT`.

### Requirement 12: Schema 版本、玩法包版本与迁移兼容

**User Story:** As a maintainer, I want old data upgraded only through explicit deterministic migration chains, so that compatibility never relies on guessing or partial mutation.

**来源追踪：** 引擎层 Spec Requirements 32、37、38；基类层 Spec Requirements 11、12、13；P04 审查项 7。

#### Acceptance Criteria

1. EVERY Candidate_Document SHALL declare a Schema version in the format required by the registered Schema contract.
2. WHEN the candidate Schema version is directly supported, THE JSON_Codec SHALL validate the document against that exact version without silently treating it as another version.
3. IF the candidate Schema version is older, THEN the UGC_System SHALL accept it only when one unique, complete and deterministic registered Schema migration chain reaches a supported version.
4. IF the candidate Schema version is newer than every supported version, THEN THE UGC_System SHALL reject it with category `VERSION_COMPATIBILITY` and report the supported range.
5. IF a Schema migration graph contains a gap, branch ambiguity, duplicate edge or cycle, THEN THE UGC_System SHALL reject migration before changing the candidate.
6. Schema migration SHALL operate on an isolated candidate value, SHALL NOT mutate the original document or active registry, and SHALL produce a new Candidate_Document.
7. EVERY migrated candidate SHALL pass the complete current JSON_Codec, Definition_Validator, Reference_Resolver and quota pipeline; successful migration alone SHALL NOT grant activation.
8. WHEN a Playpack or save-state compatibility declaration references migration behavior, THE UGC_System SHALL validate references to the existing 引擎层 `MigrationDef` contract and SHALL NOT implement a second persistence or migration executor.
9. IF an upstream migration uses an admitted best-effort mode, THEN its output SHALL still satisfy every current semantic, reference and layer requirement before candidate activation; otherwise activation SHALL be rejected.
10. WHEN a candidate compatibility declaration reports that a saved Playpack version is newer than the available Playpack version, THE UGC_System SHALL forward the declaration to the existing 引擎层 compatibility contract, preserve its rejection result and SHALL NOT inspect or mutate save-state persistence itself.
11. WHEN a candidate requests replacement of an active Playpack during a running match, THE UGC_System SHALL forward the request to the existing 引擎层 lifecycle contract, preserve its rejection result and SHALL NOT implement match-state or replacement execution.
12. Migration diagnostics SHALL identify source version, target version, failed edge or missing edge, source location and a corrective hint.
13. WHEN the same source document and migration registry are used, migration and canonical output SHALL be deterministic.

### Requirement 13: 完整验证、原子激活与状态不变

**User Story:** As a game operator, I want candidate changes to activate all at once or not at all, so that no invalid half-package can enter the live registry.

**来源追踪：** 基类层 Spec Requirements 12、13、15；引擎层 Op、事务、玩法包装载与迁移不变量；P04 审查项 3、7、8。

#### Acceptance Criteria

1. THE Definition_Validator SHALL validate the complete Candidate_Change_Set against one immutable Validation_Baseline.
2. THE complete validation SHALL include syntax, Schema, ownership layer, numeric classification, identity, inheritance, composition, reference, dependency, quota, version, migration and presentation-fallback checks as applicable.
3. IF any Error_Diagnostic occurs, THEN THE Definition_Registry SHALL activate none of the candidate additions, replacements or removals.
4. WHEN only Warning_Diagnostics occur, THE Definition_Registry MAY activate the complete change set if every Semantic_Field is valid and unchanged by warning handling.
5. BEFORE activation, THE Definition_Registry SHALL verify that the active registry, Schema registry and Integration_Contracts still match the Validation_Baseline.
6. IF the Validation_Baseline is stale, THEN THE Definition_Registry SHALL reject activation with category `ATOMIC_ACTIVATION` and require complete revalidation against a new baseline.
7. WHEN the baseline is current and the Validated_Change_Set remains valid, THE Definition_Registry SHALL activate all candidate changes as one atomic registry change.
8. IF activation fails at any step, THEN THE Definition_Registry SHALL restore or retain the complete previous active registry, dependency graph and canonical snapshot.
9. A rejected candidate SHALL NOT write WorldState, execute entry effects, register Hooks, advance migration state or alter host persistence.
10. WHEN an active definition is removed, every inbound reference SHALL be removed or redirected within the same Candidate_Change_Set.
11. IF any inbound dependent becomes invalid during commit-time recheck, THEN the complete activation SHALL fail and the previous active state SHALL remain byte-equivalent at its canonical snapshot boundary.
12. THE activation result SHALL include the baseline identity, candidate canonical identity, diagnostics and either the new canonical snapshot identity or an explicit unchanged-state assertion.
13. THE UGC_System SHALL NOT expose partially validated definitions to runtime queries, AI consumers or UI semantic projections as active definitions.

### Requirement 14: 结构化诊断、聚合与创作者可行动反馈

**User Story:** As a non-programmer creator, I want every rejection to be locatable and actionable, so that I can fix all independently discoverable errors without guessing.

**来源追踪：** 引擎层 Spec Requirement 39；基类层 Spec Requirement 13；`docs/L2_基类层/06_UGC系统.md` 报错文案原则；P04 审查项 6、7、10。

#### Acceptance Criteria

1. THE UGC_System SHALL use the existing Diagnostic structure and registered error-code families rather than defining an unrelated error channel.
2. EVERY validation Diagnostic SHALL include a stable code, severity, diagnostic scope (`document`, `definition`, `change-set` or `registry`), source package or source document, human-readable reason and correction hint.
3. WHERE type or value comparison applies, THE Diagnostic SHALL include expected and actual values without exposing secrets or copying an unbounded payload.
4. WHEN a Diagnostic has `definition` scope, it SHALL include the definition identifier, JSON path and source location. A `document`-scope parse Diagnostic SHALL include the source document and parse location without inventing a definition identifier. A `change-set`-scope quota Diagnostic SHALL include the quota class and nearest available source location. A `registry`-scope stale-baseline Diagnostic SHALL include expected and actual baseline identities. Any structurally inapplicable location field SHALL be represented by an explicit null value together with the non-definition diagnostic scope.
5. EVERY Structured_Rejection SHALL contain at least one error-severity Diagnostic; a rejection without an Error_Diagnostic SHALL be treated as an invalid validation result and SHALL activate nothing.
6. THE Definition_Validator SHALL report every independently and deterministically discoverable error in one result instead of stopping after the first error.
7. THE Definition_Validator MAY suppress dependent cascade noise when an earlier error makes a later check unknowable, but SHALL identify the skipped check and its blocking Diagnostic.
8. Diagnostics SHALL be sorted deterministically by source package, source location, definition identifier, JSON path and stable code.
9. THE same candidate, baseline and quotas SHALL produce equivalent codes, severities and diagnostic ordering on repeated validation.
10. Error_Diagnostics SHALL block the complete Candidate_Change_Set; Warning_Diagnostics SHALL be limited to nonsemantic advice or explicit Presentation_Field fallback.
11. THE UGC_System SHALL NOT downgrade a missing semantic reference, illegal kind, duplicate ID, cycle, layer violation, quota breach or migration failure to a warning.
12. Each diagnostic hint SHALL describe one actionable correction and SHALL NOT suggest bypassing validation, directly editing WorldState or disabling an invariant.
13. IF the upstream error-code registry lacks a stable member needed by a mandatory category, THEN design SHALL record the missing shared contract as unresolved and SHALL NOT use a free-form replacement code.

### Requirement 15: 跨领域待汇合契约

**User Story:** As a Spec integrator, I want external dependencies explicit but not invented, so that parallel domain work can merge without hidden assumptions.

**来源追踪：** P04 开始前读取与并行隔离规则；基类层 Spec Requirements 2、4、7-10、12；引擎层职责边界。

#### Acceptance Criteria

1. THE UGC_System SHALL maintain Integration_Contract slots for core mechanics, space-items and AI without defining those domains' final fields, identifiers or semantic families in this document.
2. EACH Integration_Contract SHALL provide a version, provider identity, exported Def kinds or semantic families, reference constraints and source provenance when merged.
3. BEFORE an Integration_Contract is merged, THE UGC_System SHALL treat references requiring that contract as unresolved and SHALL reject activation.
4. IF two providers claim the same contract identity or exported semantic identity without an authoritative resolution, THEN THE Reference_Resolver SHALL reject dependent candidates with category `IDENTITY_CONFLICT`.
5. WHEN an Integration_Contract version changes, THE UGC_System SHALL invalidate validation results whose Validation_Baseline used the prior version.
6. THE core-mechanics contract SHALL be consumed only for type and reference validation; UGC_System SHALL NOT reproduce its action, rule or value semantics.
7. THE space-items contract SHALL be consumed only for type and reference validation; UGC_System SHALL NOT reproduce topology, container, item or transition mechanics.
8. THE AI contract SHALL be consumed only for type and reference validation; UGC_System SHALL NOT reproduce query, policy, search, visibility or decision mechanics.
9. IF a candidate depends on an exported capability absent from the registered provider contract, THEN THE Reference_Resolver SHALL reject it with expected provider and capability information.
10. Merging an Integration_Contract SHALL NOT automatically activate previously rejected candidates; each candidate SHALL require complete validation against a new baseline.

### Requirement 16: 测试接口、性质与来源追踪

**User Story:** As a quality engineer, I want every requirement observable through stable interfaces and source records, so that design and implementation can prove compliance rather than rely on prose interpretation.

**来源追踪：** 基类层 Spec Requirements 15、16；引擎层测试与诊断策略；P04 审查项 10。

#### Acceptance Criteria

1. THE Test_Interface SHALL expose JSON parsing, prohibited-construct detection, Schema validation, numeric classification, reference resolution, cycle detection, composition resolution, quota enforcement, migration, canonicalization, complete validation and atomic activation as independently observable operations.
2. THE Test_Interface SHALL generate valid and invalid candidates for every registered Schema and Integration_Contract family.
3. WHEN unknown fields, illegal Def kinds, duplicate member names or duplicate definition IDs are generated, THE Test_Interface SHALL verify deterministic Structured_Rejection and unchanged active state.
4. WHEN missing, ambiguous, wrong-type or cyclic references are generated, THE Test_Interface SHALL verify the expected diagnostic category, complete cycle or conflict participants where applicable, and unchanged active state.
5. WHEN inheritance cycles or incompatible compositions are generated, THE Test_Interface SHALL verify deterministic rejection without an invented merge result.
6. WHEN Gameplay_Values and Internal_Metrics are generated at and outside their respective boundaries, THE Test_Interface SHALL verify classification-specific behavior rather than one universal numeric range.
7. WHEN Semantic_Fields are missing or corrupted, THE Test_Interface SHALL verify rejection without fallback; when eligible Presentation_Fields are missing, it SHALL verify type-compatible fallback and Warning_Diagnostics.
8. WHEN malicious nesting, excessive graph fan-out or oversized documents are generated, THE Test_Interface SHALL verify bounded termination, `RESOURCE_LIMIT` rejection and zero active changes.
9. WHEN valid Declarative_JSON is canonicalized repeatedly, THE Test_Interface SHALL verify parse-canonicalize-parse equivalence and byte idempotence.
10. WHEN old, new, ambiguous, cyclic and failing migration paths are generated, THE Test_Interface SHALL verify the version behavior and unchanged active state on rejection.
11. WHEN a candidate contains multiple independent errors, THE Test_Interface SHALL verify deterministic aggregation rather than first-error-only behavior.
12. WHEN the active baseline changes between validation and activation, THE Test_Interface SHALL verify stale-baseline rejection and complete revalidation requirement.
13. WHEN activation is forced to fail after validation, THE Test_Interface SHALL verify that the prior registry, dependency graph and canonical snapshot remain unchanged.
14. THE specification trace SHALL associate every normative requirement with at least one Source_Record containing source file, source section, precedence, decision identifier where applicable and owning layer.
15. IF a source is historical, deprecated, unresolved or owned by another layer, THEN the trace SHALL preserve that status and SHALL NOT promote it to a normative UGC default.
16. THE Test_Interface SHALL permit comparison of diagnostics and canonical snapshots without requiring editor UI, model access, network services or host persistence.

## Cross-Spec Contracts Pending Merge

The following contracts are intentionally unresolved in this requirements phase. Their absence does not authorize a local substitute:

| Contract | Required information at merge | Rejection while absent |
|---|---|---|
| Core mechanics integration | Provider version, exported semantic families, expected Def kinds, reference constraints, source provenance | Reject dependent references as unresolved |
| Space-items integration | Provider version, exported topology/item/container/transition families, expected Def kinds, reference constraints, source provenance | Reject dependent references as unresolved |
| AI integration | Provider version, exported behavior/policy/action-tag families, expected Def kinds, read-only reference constraints, source provenance | Reject dependent references as unresolved |
| Error-code mapping | Concrete registered code member for every mandatory Diagnostic Category | Do not emit free-form codes; block design decisions that require an unavailable code |
| Trusted technical quotas | Host-supplied quota classes and values for each deployment profile | Reject validation startup when required safety quotas are absent |

## Global Rejection Policy

The UGC_System SHALL apply the following non-overridable policy:

1. Syntax, prohibited execution surfaces, Schema violations, unknown fields, illegal Def kinds, duplicate IDs, layer violations, unclassified numbers, invalid Gameplay_Values, semantic damage, reference defects, cycles, composition conflicts, resource-limit breaches, unsupported versions, migration failures and stale validation baselines are errors.
2. Any error rejects the complete Candidate_Change_Set and preserves the last valid active registry and semantic state.
3. Only explicitly optional Presentation_Fields may use type-compatible fallback, and every fallback emits a warning without changing semantic results.
4. No adapter, source label, official signature, editor mode or model output may bypass or weaken this policy.
5. No rejected or partially validated candidate may write WorldState, activate Hooks, execute effects, alter persistence or become visible as active content.

## Normative Traceability Matrix

本矩阵是 Requirement 1-16 的最低可审计来源集。各 Requirement 内的“来源追踪”给出补充章节；本矩阵给出精确文件、控制主题、优先级和拥有层级。验收标准不得脱离对应行所列来源单独解释。

| Requirement | 控制来源（文件与章节） | 优先级 | 拥有层级 / 状态 |
|---|---|---|---|
| R1 | `docs/L0_规范宪法.md` §一-五；`.kiro/specs/l2-base-layer-spec/requirements.md` R1-R2；`docs/L1_引擎层/引擎层职责边界.md` §一-四 | L0 → L2 | 三层边界；已冻结 |
| R2 | `docs/访谈决策记录.md` D-019；`.kiro/specs/l2-base-layer-spec/requirements.md` R11；`.kiro/specs/meta-mechanism-kernel/requirements.md` R12-R13、R22、R42 | 已确认决策 → L1 → L2 | 声明式输入；已冻结 |
| R3 | `.kiro/specs/l2-base-layer-spec/requirements.md` R11.8-R11.12、R13；`.kiro/specs/meta-mechanism-kernel/requirements.md` R16.1、R33 | L1 → L2 | 适配器边界；已冻结 |
| R4 | `.kiro/specs/l2-base-layer-spec/requirements.md` R4、R11-R13；`.kiro/specs/meta-mechanism-kernel/requirements.md` R1、R3、R32、R39 | L1 → L2 | Schema、种类、身份；已冻结 |
| R5 | `docs/L0_规范宪法.md` §4.2、§5.1；`.kiro/specs/l2-base-layer-spec/requirements.md` R5；`.kiro/specs/meta-mechanism-kernel/requirements.md` R39、R41 | L0 → L1 → L2 | 数值归属；已冻结，部署配额值待宿主提供 |
| R6 | `docs/L0_规范宪法.md` §二-五；`docs/访谈决策记录.md` D-009、D-010；`.kiro/specs/l2-base-layer-spec/requirements.md` R2-R3、R5、R16 | L0 → 已确认决策 → L2 | 基类层/玩法层隔离；已冻结 |
| R7 | `.kiro/specs/l2-base-layer-spec/requirements.md` R4、R10、R12；`.kiro/specs/meta-mechanism-kernel/requirements.md` R1、R3、R13、R33、R39 | L1 → L2 | 引用完整性；领域导出契约待汇合 |
| R8 | `docs/访谈决策记录.md` D-010；`.kiro/specs/l2-base-layer-spec/requirements.md` R3-R4、R12、R15；`.kiro/specs/meta-mechanism-kernel/requirements.md` R3、R33 | 已确认决策 → L1 → L2 | 继承与组合；已冻结 |
| R9 | `.kiro/specs/meta-mechanism-kernel/requirements.md` R22、R24、R39、R41、R43；`.kiro/specs/l2-base-layer-spec/requirements.md` R11、R13、R15 | L1 → L2 | 安全资源边界；配额具体值待宿主提供 |
| R10 | `.kiro/specs/l2-base-layer-spec/requirements.md` R11.10-R11.12、R13；`docs/L2_基类层/06_UGC系统.md` 错误反馈与降级陈述 | L2 Spec 控制领域文档 | 语义拒绝/表现降级；领域旧述已校准 |
| R11 | `.kiro/specs/l2-base-layer-spec/requirements.md` R11、R15；`.kiro/specs/meta-mechanism-kernel/design.md` 确定性排序、快照与回放设计 | L1 → L2 | 确定性规范化；已冻结 |
| R12 | `.kiro/specs/meta-mechanism-kernel/requirements.md` R32、R37-R38；`.kiro/specs/l2-base-layer-spec/requirements.md` R11-R13 | L1 → L2 | 版本与迁移；复用现有 MigrationDef |
| R13 | `.kiro/specs/l2-base-layer-spec/requirements.md` R12-R13、R15；`.kiro/specs/meta-mechanism-kernel/requirements.md` R16-R20、R33、R38 | L1 → L2 | 原子激活；已冻结 |
| R14 | `.kiro/specs/meta-mechanism-kernel/requirements.md` R39；`.kiro/specs/l2-base-layer-spec/requirements.md` R13；`docs/L2_基类层/06_UGC系统.md` 错误反馈原则 | L1 → L2 → 领域说明 | 诊断结构；具体共享代码成员待汇合 |
| R15 | `P04.md` “开始前必须完整读取”与“必须完成的审查”§6、§9；`.kiro/specs/l2-base-layer-spec/requirements.md` R2、R4、R7-R10、R12 | P04 任务边界 → L2 | 跨领域集成；core mechanics、space-items、AI 契约待汇合 |
| R16 | `.kiro/specs/l2-base-layer-spec/requirements.md` R15-R16；`.kiro/specs/meta-mechanism-kernel/requirements.md` R39、R43-R44 | L1 → L2 | 测试接口与来源追踪；已冻结 |

/**
 * L2 → wakeup-ugc 端口：l2 `Diagnostic` → 内核 `Diagnostic` 的投影。
 *
 * 契约要求（`docs/L_审查报告/跨Spec契约_wakeup-ugc消费l2端口.md` §四）：
 * 1. 错误码必须落在封闭 `ERR_CODES` 内；
 * 2. `scope` / `at` / `path` 按 wakeup-ugc 需求 14.4 填写，结构上不适用的定位字段用显式 `null`；
 * 3. severity 必须与 `HINT_TEMPLATES` / 诊断目录对齐。
 *
 * 实现方式的取舍（本文件的核心设计判断，属自主决定并记录在此）：
 * 与其在 l2 侧另建一张「l2 code → ErrCode」表，本模块把每个 l2 代码映射到 **wakeup-ugc 自己的
 * `DiagnosticSelector`**，再交由 UGC 的 `createDiagnosticFactory` 生成诊断。理由：
 * - ErrCode 的选择、severity 判定、hint 补全、scope 定位规则全部是 UGC 拥有的决策。若 l2 复制一份，
 *   两侧会各自演进出两套判定，正是《架构决策原则》§2 点名的「职责重复」结构问题。
 * - 依赖的是 UGC **已发布**的诊断端口（`diagnostics/` 从 `src/core/ugc/index.ts` 导出），
 *   而不是它的内部形状；UGC 侧调整 ErrCode 或 hint 时 l2 无需改动。
 *
 * 代码映射表的穷举性由 `satisfies Readonly<Record<DiagnosticCode, DiagnosticSelector>>` 在
 * **编译期**强制：l2 新增或删除任何诊断代码都会让本文件编译失败，不可能静默漏掉。
 */

import type { Diagnostic as KernelDiagnostic, SourceRecord as KernelSourceRecord } from '../../../core/kernel/state/diagnostic';
import type { DiagnosticSelector } from '../../../core/ugc/diagnostics/code-map';
import type { DiagnosticCodeCatalog } from '../../../core/ugc/diagnostics/code-catalog';
import type { UGCDiagnosticFactory } from '../../../core/ugc/diagnostics/factory';
import type { ValidationStage } from '../../../core/ugc/model/stage';
import type { Diagnostic as L2Diagnostic } from '../../model/diagnostic';
import { DIAGNOSTIC_CODES, type DiagnosticCode } from '../../model/diagnostic-codes';
import type { SourceClassificationKind, SourceRecord as L2SourceRecord } from '../../model/source';
import { precedenceRank } from '../../model/source';
import { ROOT_JSON_PATH } from '../../model/ids';
import type { SourceIndex } from './source-index';

/**
 * l2 诊断代码 → wakeup-ugc 诊断选择器的封闭映射。
 *
 * 选择原则：优先匹配语义最接近的 (类别, 条件)。当 l2 代码描述的是"某族契约字段缺失"这类通用形状时，
 * 统一落到 `SCHEMA_CONTRACT/required-field`；当它描述的是越层归属时落到 `LAYER_*` / `VALUE_*`。
 * 这里刻意不引入"兜底类别"：兜底会让映射质量无法被审查。
 */
export const L2_DIAGNOSTIC_SELECTORS = {
  // ── 来源裁决与追踪 ────────────────────────────────────────────────
  [DIAGNOSTIC_CODES.SOURCE_DISPLACED_BY_HIGHER_PRECEDENCE]: { category: 'IDENTITY_CONFLICT', condition: 'identity-conflict' },
  [DIAGNOSTIC_CODES.SOURCE_SAME_PRECEDENCE_CONFLICT]: { category: 'IDENTITY_CONFLICT', condition: 'identity-conflict' },
  [DIAGNOSTIC_CODES.SOURCE_DECISION_ID_REUSE]: { category: 'IDENTITY_CONFLICT', condition: 'duplicate-id' },
  [DIAGNOSTIC_CODES.SOURCE_CONTRACT_WITHHELD]: { category: 'REFERENCE_CONTRACT', condition: 'unresolved-contract' },
  [DIAGNOSTIC_CODES.SOURCE_MISSING_AUTHORITATIVE_RECORD]: { category: 'SCHEMA_CONTRACT', condition: 'missing-source-identity' },
  [DIAGNOSTIC_CODES.SOURCE_MARKER_BLOCKS_DEFAULT]: { category: 'REFERENCE_CONTRACT', condition: 'unresolved-contract' },
  [DIAGNOSTIC_CODES.SOURCE_DEPRECATED_MECHANIC]: { category: 'SCHEMA_CONTRACT', condition: 'deprecated-mechanic' },
  [DIAGNOSTIC_CODES.SOURCE_PRESENTATION_ONLY_EXCLUDED]: { category: 'LAYER_L3_OWNERSHIP', condition: 'presentation-only-inheritance' },
  [DIAGNOSTIC_CODES.SOURCE_GAMEPLAY_COUPLED_TO_L3]: { category: 'LAYER_L3_OWNERSHIP', condition: 'gameplay-rule-in-base-layer' },
  [DIAGNOSTIC_CODES.SOURCE_UNRESOLVED_ITEM_RETAINED]: { category: 'REFERENCE_CONTRACT', condition: 'unresolved-contract' },
  [DIAGNOSTIC_CODES.SOURCE_CLASSIFICATION_MISMATCH]: { category: 'VALUE_CLASSIFICATION_MISSING', condition: 'conflicting-classification' },
  [DIAGNOSTIC_CODES.SOURCE_UNSUPPORTED_NORMATIVE_CONSTANT]: { category: 'SCHEMA_CONTRACT', condition: 'missing-source-identity' },
  [DIAGNOSTIC_CODES.SOURCE_NUMERIC_EXAMPLE_UNCLASSIFIED]: { category: 'VALUE_CLASSIFICATION_MISSING', condition: 'classification-missing' },
  [DIAGNOSTIC_CODES.SOURCE_PROMOTION_REQUIRES_DECISION]: { category: 'REFERENCE_CONTRACT', condition: 'unresolved-contract' },

  // ── 层级归属与术语 ───────────────────────────────────────────────
  [DIAGNOSTIC_CODES.LAYER_L1_OWNERSHIP]: { category: 'LAYER_L1_OWNERSHIP', condition: 'engine-primitive-request' },
  [DIAGNOSTIC_CODES.LAYER_L3_OWNERSHIP]: { category: 'LAYER_L3_OWNERSHIP', condition: 'gameplay-rule-in-base-layer' },
  [DIAGNOSTIC_CODES.LAYER_L1_RUNTIME_STATE]: { category: 'LAYER_L1_OWNERSHIP', condition: 'runtime-state-mutation' },
  [DIAGNOSTIC_CODES.VALUE_L3_OWNERSHIP]: { category: 'VALUE_L3_OWNERSHIP', condition: 'gameplay-value-in-base-layer' },
  [DIAGNOSTIC_CODES.TERM_DEPRECATED_LAYER_TERM]: { category: 'SCHEMA_CONTRACT', condition: 'deprecated-mechanic' },

  // ── 定义形状与标识 ───────────────────────────────────────────────
  [DIAGNOSTIC_CODES.DEF_MISSING_REQUIRED_FIELD]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.DEF_MALFORMED_IDENTIFIER]: { category: 'IDENTITY_CONFLICT', condition: 'identifier-invalid' },
  [DIAGNOSTIC_CODES.DEF_DUPLICATE_IDENTIFIER]: { category: 'IDENTITY_CONFLICT', condition: 'duplicate-id' },
  [DIAGNOSTIC_CODES.DEF_INVALID_DEF_KIND]: { category: 'SCHEMA_CONTRACT', condition: 'def-kind' },
  [DIAGNOSTIC_CODES.DEF_ABSTRACT_INSTANTIATION]: { category: 'REFERENCE_CONTRACT', condition: 'abstract-target' },
  [DIAGNOSTIC_CODES.DEF_INSTANCE_CARRIES_GAMEPLAY_VALUE]: { category: 'VALUE_L3_OWNERSHIP', condition: 'gameplay-value-in-base-layer' },
  [DIAGNOSTIC_CODES.DEF_INSTANCE_CARRIES_GAMEPLAY_RULE]: { category: 'LAYER_L3_OWNERSHIP', condition: 'gameplay-rule-in-base-layer' },
  [DIAGNOSTIC_CODES.DEF_MISSING_SOURCE_RECORD]: { category: 'SCHEMA_CONTRACT', condition: 'missing-source-identity' },

  // ── 语义族登记 ───────────────────────────────────────────────────
  [DIAGNOSTIC_CODES.FAMILY_NOT_ENUMERABLE]: { category: 'SCHEMA_CONTRACT', condition: 'schema-contract' },
  [DIAGNOSTIC_CODES.FAMILY_NOT_COMPOSABLE]: { category: 'SCHEMA_CONTRACT', condition: 'schema-contract' },
  [DIAGNOSTIC_CODES.FAMILY_GAMEPLAY_DEPENDENT]: { category: 'LAYER_L3_OWNERSHIP', condition: 'gameplay-rule-in-base-layer' },
  [DIAGNOSTIC_CODES.FAMILY_MISSING_CLASSIFICATION_REASON]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.FAMILY_UNREGISTERED]: { category: 'REFERENCE_CONTRACT', condition: 'provider-contract' },
  [DIAGNOSTIC_CODES.FAMILY_DUPLICATE_REGISTRATION]: { category: 'IDENTITY_CONFLICT', condition: 'provider-identity-conflict' },
  [DIAGNOSTIC_CODES.FAMILY_COMBINATION_INSTANCE_AS_BASE]: { category: 'COMPOSITION_CONFLICT', condition: 'composition-conflict' },

  // ── 参数 Schema 与数值 ───────────────────────────────────────────
  [DIAGNOSTIC_CODES.SCHEMA_FIELD_MISSING_CLASSIFICATION]: { category: 'VALUE_CLASSIFICATION_MISSING', condition: 'classification-missing' },
  [DIAGNOSTIC_CODES.SCHEMA_FIELD_INVALID_TYPE]: { category: 'SCHEMA_CONTRACT', condition: 'field-type' },
  [DIAGNOSTIC_CODES.SCHEMA_FIELD_DUPLICATE_NAME]: { category: 'IDENTITY_CONFLICT', condition: 'duplicate-id' },
  [DIAGNOSTIC_CODES.SCHEMA_FIELD_RANGE_MALFORMED]: { category: 'SCHEMA_CONTRACT', condition: 'field-type' },
  [DIAGNOSTIC_CODES.SCHEMA_FIELD_REFERENCE_TARGET_MISSING]: { category: 'REFERENCE_CONTRACT', condition: 'missing-target' },
  [DIAGNOSTIC_CODES.SCHEMA_CROSS_FIELD_CONSTRAINT_UNRESOLVED]: { category: 'SCHEMA_CONTRACT', condition: 'cross-field-constraint' },
  [DIAGNOSTIC_CODES.SCHEMA_STRUCTURAL_BOUND_MISSING_SOURCE]: { category: 'SCHEMA_CONTRACT', condition: 'missing-source-identity' },
  [DIAGNOSTIC_CODES.SCHEMA_STRUCTURAL_BOUND_MISSING_RATIONALE]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.SCHEMA_CONSTITUTIONAL_CONSTANT_MISSING_SOURCE]: { category: 'SCHEMA_CONTRACT', condition: 'missing-source-identity' },
  [DIAGNOSTIC_CODES.SCHEMA_CONSTITUTIONAL_CONSTANT_MISSING_LAYER]: { category: 'SCHEMA_CONTRACT', condition: 'missing-target-ownership' },
  [DIAGNOSTIC_CODES.SCHEMA_GAMEPLAY_VALUE_OUT_OF_RANGE]: { category: 'VALUE_L3_OWNERSHIP', condition: 'gameplay-value-range' },
  [DIAGNOSTIC_CODES.SCHEMA_GAMEPLAY_TABLE_IN_L2]: { category: 'VALUE_L3_OWNERSHIP', condition: 'gameplay-value-in-base-layer' },
  [DIAGNOSTIC_CODES.SCHEMA_INTERNAL_METRIC_MISSING_SCHEMA]: { category: 'VALUE_CLASSIFICATION_MISSING', condition: 'classification-missing' },

  // ── 继承与组合 ───────────────────────────────────────────────────
  [DIAGNOSTIC_CODES.INHERIT_NO_TYPE_IDENTITY_DIFFERENCE]: { category: 'COMPOSITION_CONFLICT', condition: 'composition-conflict' },
  [DIAGNOSTIC_CODES.INHERIT_GAMEPLAY_VALUE_ONLY_DIFFERENCE]: { category: 'VALUE_L3_OWNERSHIP', condition: 'gameplay-value-in-base-layer' },
  [DIAGNOSTIC_CODES.INHERIT_CYCLE]: { category: 'COMPOSITION_CONFLICT', condition: 'inheritance-cycle' },
  [DIAGNOSTIC_CODES.INHERIT_FIELD_CONFLICT_WITHOUT_RULE]: { category: 'COMPOSITION_CONFLICT', condition: 'composition-conflict' },
  [DIAGNOSTIC_CODES.INHERIT_INCOMPATIBLE_FIELD_TYPE]: { category: 'COMPOSITION_CONFLICT', condition: 'composition-conflict' },
  [DIAGNOSTIC_CODES.COMPOSE_DUPLICATE_COMPONENT]: { category: 'COMPOSITION_CONFLICT', condition: 'composition-conflict' },
  [DIAGNOSTIC_CODES.COMPOSE_ORDER_DEPENDENCY_UNDECLARED]: { category: 'COMPOSITION_CONFLICT', condition: 'order-undeclared' },
  [DIAGNOSTIC_CODES.COMPOSE_TYPE_DEFINING_CAPABILITY_REMOVED]: { category: 'COMPOSITION_CONFLICT', condition: 'composition-conflict' },
  [DIAGNOSTIC_CODES.COMPOSE_NESTED_UNRESOLVED]: { category: 'REFERENCE_CONTRACT', condition: 'missing-target' },

  // ── 引用与依赖 ───────────────────────────────────────────────────
  [DIAGNOSTIC_CODES.REF_MISSING_TARGET]: { category: 'REFERENCE_CONTRACT', condition: 'missing-target' },
  [DIAGNOSTIC_CODES.REF_KIND_MISMATCH]: { category: 'REFERENCE_CONTRACT', condition: 'wrong-kind' },
  [DIAGNOSTIC_CODES.REF_FAMILY_MISMATCH]: { category: 'REFERENCE_CONTRACT', condition: 'provider-contract' },
  [DIAGNOSTIC_CODES.REF_ABSTRACT_TARGET]: { category: 'REFERENCE_CONTRACT', condition: 'abstract-target' },
  [DIAGNOSTIC_CODES.REF_DEPENDENCY_CYCLE]: { category: 'REFERENCE_CONTRACT', condition: 'reference-cycle' },
  [DIAGNOSTIC_CODES.REF_PACKAGE_DEPENDENCY_CYCLE]: { category: 'REFERENCE_CONTRACT', condition: 'package-cycle' },
  [DIAGNOSTIC_CODES.REF_INBOUND_LEFT_DANGLING]: { category: 'REFERENCE_CONTRACT', condition: 'undefined-reference' },
  [DIAGNOSTIC_CODES.REF_OVERRIDE_INVALIDATES_DEPENDENT]: { category: 'REFERENCE_CONTRACT', condition: 'invalidates-dependent' },
  [DIAGNOSTIC_CODES.REF_REMOVAL_TARGET_MISSING]: { category: 'REFERENCE_CONTRACT', condition: 'missing-target' },
  [DIAGNOSTIC_CODES.REF_OVERRIDE_TARGET_MISSING]: { category: 'IDENTITY_CONFLICT', condition: 'override-invalid' },
  [DIAGNOSTIC_CODES.REF_OVERRIDE_NOT_DECLARED]: { category: 'IDENTITY_CONFLICT', condition: 'override-invalid' },

  // ── 动作与网关 ───────────────────────────────────────────────────
  [DIAGNOSTIC_CODES.ACTION_MISSING_CONTRACT_FIELD]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.ACTION_MULTI_AP_ATOMIC_COST]: { category: 'VALUE_L3_OWNERSHIP', condition: 'gameplay-value-in-base-layer' },
  [DIAGNOSTIC_CODES.ACTION_SEQUENCE_MISSING_INTERMEDIATE_STATUS]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.ACTION_ATTACHED_WITHOUT_HOST]: { category: 'REFERENCE_CONTRACT', condition: 'missing-target' },
  [DIAGNOSTIC_CODES.ACTION_ATTACHED_AS_DECISION_BRANCH]: { category: 'LAYER_L1_OWNERSHIP', condition: 'engine-primitive-request' },
  [DIAGNOSTIC_CODES.ACTION_ATTACHED_NONZERO_COST]: { category: 'VALUE_L3_OWNERSHIP', condition: 'gameplay-value-in-base-layer' },
  [DIAGNOSTIC_CODES.GATEWAY_KIND_AMBIGUOUS]: { category: 'SCHEMA_CONTRACT', condition: 'cross-field-constraint' },
  [DIAGNOSTIC_CODES.GATEWAY_MISSING_CONTRACT_FIELD]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.GATEWAY_NAMED_GAMEPLAY_ENTITY]: { category: 'LAYER_L3_OWNERSHIP', condition: 'gameplay-rule-in-base-layer' },
  [DIAGNOSTIC_CODES.GATEWAY_CONCRETE_THRESHOLD]: { category: 'VALUE_L3_OWNERSHIP', condition: 'gameplay-value-in-base-layer' },

  // ── 空间 ─────────────────────────────────────────────────────────
  [DIAGNOSTIC_CODES.SPACE_SCENE_SCALE_MISSING]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.SPACE_CONCRETE_MAP_NODE]: { category: 'LAYER_L3_OWNERSHIP', condition: 'gameplay-rule-in-base-layer' },
  [DIAGNOSTIC_CODES.SPACE_CONNECTION_BOUND_UNSOURCED]: { category: 'SCHEMA_CONTRACT', condition: 'missing-source-identity' },
  [DIAGNOSTIC_CODES.SPACE_MICRO_SCENE_PARENT_MISSING]: { category: 'REFERENCE_CONTRACT', condition: 'missing-target' },
  [DIAGNOSTIC_CODES.SPACE_MICRO_SCENE_MULTIPLE_PARENTS]: { category: 'IDENTITY_CONFLICT', condition: 'ambiguous-reference-target' },
  [DIAGNOSTIC_CODES.SPACE_MICRO_SCENE_OWNER_SEMANTICS]: { category: 'SCHEMA_CONTRACT', condition: 'cross-field-constraint' },
  [DIAGNOSTIC_CODES.SPACE_CREATOR_MUTABLE]: { category: 'LAYER_L1_OWNERSHIP', condition: 'runtime-state-mutation' },
  [DIAGNOSTIC_CODES.SPACE_MICRO_SCENE_MISSING_OCCUPANCY]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.SPACE_SMALL_SCENE_MISSING_SHARED_MICRO_SCENE]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.SPACE_SMALL_SCENE_PERSONAL_VACANT_GROUND]: { category: 'SCHEMA_CONTRACT', condition: 'cross-field-constraint' },
  [DIAGNOSTIC_CODES.SPACE_TRANSITION_MISSING_FIELD]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.SPACE_TRANSITION_ENDPOINT_KIND]: { category: 'REFERENCE_CONTRACT', condition: 'wrong-kind' },
  [DIAGNOSTIC_CODES.SPACE_PARENT_REMOVAL_ORPHANS_CHILD]: { category: 'REFERENCE_CONTRACT', condition: 'undefined-reference' },
  [DIAGNOSTIC_CODES.SPACE_PARENT_REMOVAL_UNSUPPORTED_LIFECYCLE_OP]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },

  // ── 物品、装备与载具 ─────────────────────────────────────────────
  [DIAGNOSTIC_CODES.ITEM_MISSING_CONTRACT_FIELD]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.ITEM_DANGLING_CAPABILITY_REFERENCE]: { category: 'REFERENCE_CONTRACT', condition: 'undefined-reference' },
  [DIAGNOSTIC_CODES.ITEM_HEAVY_TAG_NOT_QUERY_BASED]: { category: 'LAYER_L1_OWNERSHIP', condition: 'engine-primitive-request' },
  [DIAGNOSTIC_CODES.ITEM_DEATH_CONTAINER_DEPOSIT_ENABLED]: { category: 'SCHEMA_CONTRACT', condition: 'cross-field-constraint' },
  [DIAGNOSTIC_CODES.ITEM_DEATH_CONTAINER_MISSING_TRANSACTION_SOURCE]: { category: 'SCHEMA_CONTRACT', condition: 'missing-source-identity' },
  [DIAGNOSTIC_CODES.ITEM_DEATH_CONTAINER_TIMING_VIOLATION]: { category: 'SCHEMA_CONTRACT', condition: 'cross-field-constraint' },
  [DIAGNOSTIC_CODES.WEAPON_TYPE_IDENTITY_MISSING]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.WEAPON_CONCRETE_DAMAGE_VALUE]: { category: 'VALUE_L3_OWNERSHIP', condition: 'gameplay-value-in-base-layer' },
  [DIAGNOSTIC_CODES.ARMOR_MISSING_MITIGATION_REFERENCE]: { category: 'REFERENCE_CONTRACT', condition: 'missing-target' },
  [DIAGNOSTIC_CODES.ARMOR_EMBEDDED_CONCRETE_INSTANCE]: { category: 'LAYER_L3_OWNERSHIP', condition: 'gameplay-rule-in-base-layer' },
  [DIAGNOSTIC_CODES.CONSUMABLE_MISSING_CONTRACT_FIELD]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.VEHICLE_NOT_ENTITY]: { category: 'SCHEMA_CONTRACT', condition: 'def-kind' },
  [DIAGNOSTIC_CODES.VEHICLE_MISSING_CAPABILITY]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.VEHICLE_DOOR_IDENTIFIER_UNSTABLE]: { category: 'IDENTITY_CONFLICT', condition: 'identifier-invalid' },
  [DIAGNOSTIC_CODES.VEHICLE_ADJACENCY_COUPLED_TO_DOOR_TARGET]: { category: 'SCHEMA_CONTRACT', condition: 'cross-field-constraint' },
  [DIAGNOSTIC_CODES.VEHICLE_D030_POLICY_NOT_L3]: { category: 'LAYER_L3_OWNERSHIP', condition: 'gameplay-rule-in-base-layer' },

  // ── 效果类与 AI ──────────────────────────────────────────────────
  [DIAGNOSTIC_CODES.DAMAGE_ASSIGNS_AMOUNT]: { category: 'VALUE_L3_OWNERSHIP', condition: 'gameplay-value-in-base-layer' },
  [DIAGNOSTIC_CODES.DAMAGE_MISSING_CONTRACT_FIELD]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.STATUS_MISSING_CONTRACT_FIELD]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.STATUS_INTERACTION_WITHOUT_RULE]: { category: 'REFERENCE_CONTRACT', condition: 'missing-target' },
  [DIAGNOSTIC_CODES.STATUS_PSEUDO_SUBTYPE]: { category: 'COMPOSITION_CONFLICT', condition: 'composition-conflict' },
  [DIAGNOSTIC_CODES.SKILL_ACTIVATION_SEMANTICS_MISSING]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.SKILL_MISSING_CONTRACT_FIELD]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.MOVEMENT_TRAVERSAL_SEMANTICS_MISSING]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.MOVEMENT_PARAMETER_NOT_L3_OWNED]: { category: 'VALUE_L3_OWNERSHIP', condition: 'gameplay-value-in-base-layer' },
  [DIAGNOSTIC_CODES.ATTACHMENT_MISSING_CONTRACT_FIELD]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.AI_MISSING_CONTRACT_FIELD]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.AI_POLICY_CATEGORY_MISMATCH]: { category: 'SCHEMA_CONTRACT', condition: 'cross-field-constraint' },
  [DIAGNOSTIC_CODES.AI_EMBEDDED_GAMEPLAY_DETAIL]: { category: 'LAYER_L3_OWNERSHIP', condition: 'gameplay-rule-in-base-layer' },
  [DIAGNOSTIC_CODES.AI_REQUIRED_ACTION_SET_EMPTY]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.AI_REQUIRED_TAG_UNRESOLVED]: { category: 'REFERENCE_CONTRACT', condition: 'undefined-reference' },
  [DIAGNOSTIC_CODES.AI_EVALUATION_INVALID]: { category: 'SCHEMA_CONTRACT', condition: 'cross-field-constraint' },
  [DIAGNOSTIC_CODES.AI_REDEFINES_L1_INTERFACE]: { category: 'LAYER_L1_OWNERSHIP', condition: 'engine-primitive-request' },

  // ── JSON Codec 与 UGC ───────────────────────────────────────────
  [DIAGNOSTIC_CODES.JSON_PARSE_ERROR]: { category: 'JSON_SYNTAX', condition: 'syntax' },
  [DIAGNOSTIC_CODES.JSON_SCHEMA_VERSION_MISSING]: { category: 'SCHEMA_CONTRACT', condition: 'missing-schema-version' },
  [DIAGNOSTIC_CODES.JSON_SCHEMA_VERSION_UNSUPPORTED]: { category: 'VERSION_COMPATIBILITY', condition: 'unsupported-version' },
  [DIAGNOSTIC_CODES.JSON_PROHIBITED_CONSTRUCT]: { category: 'PROHIBITED_CONSTRUCT', condition: 'executable-construct' },
  [DIAGNOSTIC_CODES.JSON_ROOT_NOT_OBJECT]: { category: 'SCHEMA_CONTRACT', condition: 'schema-contract' },
  [DIAGNOSTIC_CODES.JSON_SEMANTIC_FIELD_MISSING]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.JSON_SEMANTIC_FIELD_DAMAGED]: { category: 'SCHEMA_CONTRACT', condition: 'semantic-field-damaged' },
  [DIAGNOSTIC_CODES.JSON_NON_FINITE_NUMBER]: { category: 'JSON_SYNTAX', condition: 'nonfinite-number' },
  [DIAGNOSTIC_CODES.PRESENTATION_FALLBACK_APPLIED]: { category: 'PRESENTATION_FALLBACK', condition: 'presentation-fallback' },
  [DIAGNOSTIC_CODES.UGC_EXECUTABLE_OUTPUT]: { category: 'PROHIBITED_CONSTRUCT', condition: 'executable-construct' },
  [DIAGNOSTIC_CODES.UGC_SEMANTIC_GUESS_REJECTED]: { category: 'SCHEMA_CONTRACT', condition: 'semantic-field-damaged' },

  // ── 包与激活 ─────────────────────────────────────────────────────
  [DIAGNOSTIC_CODES.PKG_MISSING_METADATA]: { category: 'SCHEMA_CONTRACT', condition: 'schema-contract' },
  [DIAGNOSTIC_CODES.PKG_DEPENDENCY_MISSING]: { category: 'REFERENCE_CONTRACT', condition: 'undefined-reference' },
  [DIAGNOSTIC_CODES.PKG_ACTIVATION_ABORTED]: { category: 'ATOMIC_ACTIVATION', condition: 'activation-failed' },
  [DIAGNOSTIC_CODES.PKG_SILENT_COERCION_PROPOSAL]: { category: 'SCHEMA_CONTRACT', condition: 'semantic-field-damaged' },
  [DIAGNOSTIC_CODES.PKG_REJECTION_WITHOUT_ERROR]: { category: 'ATOMIC_ACTIVATION', condition: 'gateway-invalid-result' },

  // ── 运行时提交与投影 ─────────────────────────────────────────────
  [DIAGNOSTIC_CODES.RUNTIME_ACTION_UNRESOLVED]: { category: 'REFERENCE_CONTRACT', condition: 'missing-target' },
  [DIAGNOSTIC_CODES.RUNTIME_ACTION_UNAVAILABLE]: { category: 'REFERENCE_CONTRACT', condition: 'provider-contract' },
  [DIAGNOSTIC_CODES.RUNTIME_PRECONDITION_FAILED]: { category: 'SCHEMA_CONTRACT', condition: 'cross-field-constraint' },
  [DIAGNOSTIC_CODES.RUNTIME_GATEWAY_CONDITION_FAILED]: { category: 'SCHEMA_CONTRACT', condition: 'cross-field-constraint' },
  [DIAGNOSTIC_CODES.RUNTIME_TARGET_OUT_OF_SCOPE]: { category: 'REFERENCE_CONTRACT', condition: 'provider-contract' },
  [DIAGNOSTIC_CODES.RUNTIME_HOOK_INTEGRATION_UNAVAILABLE]: { category: 'REFERENCE_CONTRACT', condition: 'unresolved-contract' },
  [DIAGNOSTIC_CODES.RUNTIME_L1_INVARIANT_VIOLATION]: { category: 'LAYER_L1_OWNERSHIP', condition: 'engine-primitive-request' },
  [DIAGNOSTIC_CODES.RUNTIME_TRANSACTION_ABORTED]: { category: 'ATOMIC_ACTIVATION', condition: 'activation-failed' },
  [DIAGNOSTIC_CODES.RUNTIME_OP_MAPPING_MISSING]: { category: 'REFERENCE_CONTRACT', condition: 'unresolved-contract' },
  [DIAGNOSTIC_CODES.PROJECTION_WRITE_REJECTED]: { category: 'LAYER_L1_OWNERSHIP', condition: 'runtime-state-mutation' },
  [DIAGNOSTIC_CODES.PROJECTION_SCOPE_VIOLATION]: { category: 'LAYER_L1_OWNERSHIP', condition: 'runtime-state-mutation' },

  // ── 空间与物品特定规则（PT-08b） ────────────────────────────────
  [DIAGNOSTIC_CODES.UNRESOLVED_ITEM_PROMOTION_ATTEMPT]: { category: 'SCHEMA_CONTRACT', condition: 'cross-field-constraint' },
  [DIAGNOSTIC_CODES.D016_REMOVED_STATUS_REFERENCE]: { category: 'REFERENCE_CONTRACT', condition: 'missing-target' },
  [DIAGNOSTIC_CODES.OP_BYPASS_FORBIDDEN]: { category: 'LAYER_L1_OWNERSHIP', condition: 'engine-primitive-request' },
  [DIAGNOSTIC_CODES.SCENE_SCALE_INVALID]: { category: 'SCHEMA_CONTRACT', condition: 'schema-contract' },
  [DIAGNOSTIC_CODES.SCENE_MISSING_REQUIRED_CAPABILITY]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.MICRO_SCENE_CREATOR_MISUSE]: { category: 'SCHEMA_CONTRACT', condition: 'cross-field-constraint' },
  [DIAGNOSTIC_CODES.MICRO_SCENE_OCCUPANCY_SOURCE_INVALID]: { category: 'SCHEMA_CONTRACT', condition: 'schema-contract' },
  [DIAGNOSTIC_CODES.VEHICLE_NOT_MICRO_SCENE]: { category: 'SCHEMA_CONTRACT', condition: 'cross-field-constraint' },
  [DIAGNOSTIC_CODES.TRANSITION_ENDPOINT_TYPE_INVALID]: { category: 'SCHEMA_CONTRACT', condition: 'schema-contract' },
  [DIAGNOSTIC_CODES.TRANSITION_DIRECTION_INVALID]: { category: 'SCHEMA_CONTRACT', condition: 'schema-contract' },
  [DIAGNOSTIC_CODES.TRANSITION_CONDITION_EMPTY]: { category: 'SCHEMA_CONTRACT', condition: 'required-field' },
  [DIAGNOSTIC_CODES.TRANSITION_BLOCKING_HARDCODED]: { category: 'LAYER_L1_OWNERSHIP', condition: 'engine-primitive-request' },
  [DIAGNOSTIC_CODES.CONTAINER_REFERENCE_INVALID]: { category: 'REFERENCE_CONTRACT', condition: 'missing-target' },
  [DIAGNOSTIC_CODES.CONTAINER_STRUCTURE_OVERRIDE]: { category: 'LAYER_L1_OWNERSHIP', condition: 'engine-primitive-request' },
  [DIAGNOSTIC_CODES.EQUIPMENT_SLOT_REFERENCE_INVALID]: { category: 'REFERENCE_CONTRACT', condition: 'missing-target' },
  [DIAGNOSTIC_CODES.CONSUMPTION_POINT_REFERENCE_INVALID]: { category: 'REFERENCE_CONTRACT', condition: 'missing-target' },
  [DIAGNOSTIC_CODES.ATTACHMENT_POINT_REFERENCE_INVALID]: { category: 'REFERENCE_CONTRACT', condition: 'missing-target' },
  [DIAGNOSTIC_CODES.ITEM_CONVERSION_HARDCODED]: { category: 'LAYER_L1_OWNERSHIP', condition: 'engine-primitive-request' },
  [DIAGNOSTIC_CODES.VEHICLE_SEAT_REFERENCE_INVALID]: { category: 'REFERENCE_CONTRACT', condition: 'missing-target' },
  [DIAGNOSTIC_CODES.VEHICLE_CARGO_REFERENCE_INVALID]: { category: 'REFERENCE_CONTRACT', condition: 'missing-target' },
  [DIAGNOSTIC_CODES.VEHICLE_DOOR_REFERENCE_INVALID]: { category: 'REFERENCE_CONTRACT', condition: 'missing-target' },
  [DIAGNOSTIC_CODES.VEHICLE_ADJACENCY_REFERENCE_INVALID]: { category: 'REFERENCE_CONTRACT', condition: 'missing-target' },
  [DIAGNOSTIC_CODES.VEHICLE_LOCKING_HARDCODED]: { category: 'LAYER_L1_OWNERSHIP', condition: 'engine-primitive-request' },
  [DIAGNOSTIC_CODES.VEHICLE_DRIVER_SLOT_INVALID]: { category: 'REFERENCE_CONTRACT', condition: 'missing-target' },
  [DIAGNOSTIC_CODES.VEHICLE_COLLISION_HARDCODED]: { category: 'LAYER_L1_OWNERSHIP', condition: 'engine-primitive-request' },
  [DIAGNOSTIC_CODES.VEHICLE_DESTRUCTION_HARDCODED]: { category: 'LAYER_L1_OWNERSHIP', condition: 'engine-primitive-request' },
  [DIAGNOSTIC_CODES.CONTAINER_CAPABILITY_REFERENCE_INVALID]: { category: 'REFERENCE_CONTRACT', condition: 'missing-target' },
  [DIAGNOSTIC_CODES.CONTAINER_CAPABILITY_OVERRIDE]: { category: 'LAYER_L1_OWNERSHIP', condition: 'engine-primitive-request' },
  [DIAGNOSTIC_CODES.SLOT_CAPABILITY_REFERENCE_INVALID]: { category: 'REFERENCE_CONTRACT', condition: 'missing-target' },
  [DIAGNOSTIC_CODES.CONTAINER_CAPABILITY_BINDING_OVERRIDE]: { category: 'LAYER_L1_OWNERSHIP', condition: 'engine-primitive-request' },

  // ── UI 与 UI 描述符 ──────────────────────────────────────────────
  [DIAGNOSTIC_CODES.UI_UNKNOWN_RESOURCE_ROLE]: { category: 'SCHEMA_CONTRACT', condition: 'schema-contract' },
  [DIAGNOSTIC_CODES.UI_DESCRIPTOR_TARGET_UNRESOLVED]: { category: 'REFERENCE_CONTRACT', condition: 'missing-target' },

  // ── ECS 收敛：原子 System 接线（Requirements 3、5；见 D-ECS-001 范围说明） ──
  [DIAGNOSTIC_CODES.SYSTEM_BINDING_MALFORMED]: { category: 'LAYER_L1_OWNERSHIP', condition: 'engine-primitive-request' },
  [DIAGNOSTIC_CODES.SYSTEM_BINDING_MISSING_KERNELOPS]: { category: 'LAYER_L1_OWNERSHIP', condition: 'engine-primitive-request' },
  [DIAGNOSTIC_CODES.SYSTEM_BINDING_MISSING_FAMILY]: { category: 'LAYER_L1_OWNERSHIP', condition: 'engine-primitive-request' },
  [DIAGNOSTIC_CODES.COMPOSITION_KIND_NOT_DECLARED]: { category: 'COMPOSITION_CONFLICT', condition: 'composition-conflict' },
  [DIAGNOSTIC_CODES.COMPOSITION_KIND_INVALID]: { category: 'COMPOSITION_CONFLICT', condition: 'composition-conflict' },
  [DIAGNOSTIC_CODES.COMPONENT_ID_CONFLICT]: { category: 'IDENTITY_CONFLICT', condition: 'duplicate-id' },
  [DIAGNOSTIC_CODES.MISSING_CAPABILITY_FOR_COMPOSE]: { category: 'COMPOSITION_CONFLICT', condition: 'composition-conflict' },
  [DIAGNOSTIC_CODES.CAS_FIELD_GAP]: { category: 'COMPOSITION_CONFLICT', condition: 'composition-conflict' },
} as const satisfies Readonly<Record<DiagnosticCode, DiagnosticSelector>>;

/** 投影时无法识别 l2 代码或严重级别不可表达时使用的失败关闭选择器。 */
export const PROJECTION_DEFECT_SELECTOR: DiagnosticSelector = Object.freeze({
  category: 'ATOMIC_ACTIVATION',
  condition: 'gateway-invalid-result',
});

/** l2 规范分类 → 内核 `SourceRecord.normativeStatus`。 */
const NORMATIVE_STATUS_OF: Readonly<Record<SourceClassificationKind, KernelSourceRecord['normativeStatus']>> =
  Object.freeze({
    Normative_Contract: 'normative',
    L3_Profile: 'normative',
    Historical_Example: 'historical',
    Unresolved_Item: 'unresolved',
  });

export interface DiagnosticProjectionContext {
  readonly factory: UGCDiagnosticFactory;
  readonly catalog: DiagnosticCodeCatalog;
  readonly stage: ValidationStage;
  /** 进入诊断的来源包标识；用 UGC 的 `binding.sourcePackageId`，不用 l2 自己的包名。 */
  readonly sourcePackage: string;
  readonly index: SourceIndex;
  /**
   * definitionId → 该定义在候选文档中的 JSON path。
   *
   * l2 的包级诊断可以只带 `definitionId` 而不带 `jsonPath`，但 UGC 的 `definition` scope
   * 要求 JSON path 必填。这里用定义自身的锚点路径补齐，而不是伪造一个字段级路径。
   */
  readonly definitionAnchors: ReadonlyMap<string, string>;
}

/** 把 l2 `SourceRecord` 投影为内核 `SourceRecord`，保留可追溯性而不新建平行结构。 */
export function projectSourceRecord(
  ctx: DiagnosticProjectionContext,
  record: L2SourceRecord,
): KernelSourceRecord {
  const span = ctx.index.span(record.sourceLocation.line, record.sourceLocation.column);
  const base = {
    sourceId: record.statementFingerprint,
    documentUri: record.sourceFile,
    sourcePackage: ctx.sourcePackage,
    // l2 的 statementFingerprint 就是该陈述规范化后的确定性摘要，语义上即内容散列。
    contentHash: record.statementFingerprint,
    precedence: precedenceRank(record.precedence),
    owningLayer: record.owningLayer,
    normativeStatus: NORMATIVE_STATUS_OF[record.classification],
    span: { ...span, file: record.sourceLocation.sourceFile },
  };
  return Object.freeze(
    record.decisionId === undefined ? base : { ...base, decisionId: record.decisionId },
  );
}

function selectorFor(code: string): DiagnosticSelector | undefined {
  const table = L2_DIAGNOSTIC_SELECTORS as Readonly<Record<string, DiagnosticSelector | undefined>>;
  return table[code];
}

function messageArgsOf(diagnostic: L2Diagnostic): Readonly<Record<string, string | number | boolean | null>> {
  return Object.freeze({
    l2Code: diagnostic.code,
    l2Severity: diagnostic.severity,
    l2SourceFile: diagnostic.sourceLocation?.sourceFile ?? null,
    l2Section: diagnostic.sourceLocation?.section ?? null,
    l2Package: diagnostic.sourcePackage ?? null,
  });
}

/**
 * 稳定根因标识。
 *
 * 由 (代码, 定义, 路径) 派生而不是由到达顺序派生：同一份候选无论以何种顺序被遍历，
 * `rootCauseId` 都相同，因此 UGC 的 `SkippedCheck` 关联和诊断折叠都是确定的。
 */
function rootCauseIdOf(diagnostic: L2Diagnostic): string {
  return `l2/${diagnostic.code}/${diagnostic.definitionId ?? '-'}/${diagnostic.jsonPath ?? '-'}`;
}

function englishMessageOf(diagnostic: L2Diagnostic): string {
  const at = diagnostic.definitionId === undefined ? 'package scope' : `definition ${diagnostic.definitionId}`;
  const path = diagnostic.jsonPath === undefined || diagnostic.jsonPath === ROOT_JSON_PATH
    ? 'document root'
    : diagnostic.jsonPath;
  return `l2 base-layer validator reported ${diagnostic.code} (${diagnostic.severity}) at ${at}, json path ${path}`;
}

/**
 * 投影单条 l2 诊断。
 *
 * 返回数组而不是单个诊断，因为存在两种必须追加第二条诊断的情形：
 * 1. l2 代码没有映射 → 追加一条失败关闭错误，绝不静默丢弃 l2 的判定；
 * 2. l2 判定为 `Error` 但映射到的 ErrCode 在 UGC 目录中是 warn/info → 追加一条升级错误，
 *    保证「不会因为投影而把阻断性错误降级为可放行的警告」。
 *
 * 反方向（l2 `Warning` 落到 error 级 ErrCode）不追加诊断：那只会让端口更严格，是安全方向。
 * 该情形也由本目录测试断言当前不存在（l2 只有 PRESENTATION_FALLBACK_APPLIED 会是 Warning）。
 */
export function projectL2Diagnostic(
  ctx: DiagnosticProjectionContext,
  diagnostic: L2Diagnostic,
): readonly KernelDiagnostic[] {
  const selector = selectorFor(diagnostic.code);
  const relatedSources = diagnostic.relatedSources.map((record) => projectSourceRecord(ctx, record));
  const common = {
    stage: ctx.stage,
    sourcePackage: ctx.sourcePackage,
    message: englishMessageOf(diagnostic),
    reason: diagnostic.reason,
    correctionSuggestion: diagnostic.correctionSuggestion,
    rootCauseId: rootCauseIdOf(diagnostic),
    messageArgs: messageArgsOf(diagnostic),
  };
  const span = ctx.index.span(diagnostic.sourceLocation?.line, diagnostic.sourceLocation?.column);

  const withSources = (produced: KernelDiagnostic): KernelDiagnostic =>
    relatedSources.length === 0 ? produced : Object.freeze({ ...produced, relatedSources });

  if (selector === undefined) {
    return Object.freeze([
      withSources(
        ctx.factory.host({
          ...common,
          selector: PROJECTION_DEFECT_SELECTOR,
          message:
            `l2 diagnostic code ${diagnostic.code} has no wakeup-ugc selector mapping; ` +
            'the base-layer finding cannot be represented and is therefore escalated.',
          reason:
            `基类层报出的诊断代码 ${diagnostic.code} 在端口投影表中没有对应条目，无法表达为共享错误码。` +
            `原始原因：${diagnostic.reason}`,
          correctionSuggestion:
            '在 src/l2/ugc/ports/diagnostic-projection.ts 为该代码补充选择器映射；在补齐前该候选按失败关闭处理。',
          sourceSpan: span,
        }),
      ),
    ]);
  }

  const projected = withSources(projectWithSelector(ctx, diagnostic, selector, span, common));
  const escalation = severityEscalationOf(ctx, diagnostic, selector, span, common);
  return Object.freeze(escalation === undefined ? [projected] : [projected, escalation]);
}

interface ProjectionCommonPart {
  readonly stage: ValidationStage;
  readonly sourcePackage: string;
  readonly message: string;
  readonly reason: string;
  readonly correctionSuggestion: string;
  readonly rootCauseId: string;
  readonly messageArgs: Readonly<Record<string, string | number | boolean | null>>;
}

/**
 * scope 判定规则（需求 14.4）。
 *
 * - 有 `definitionId` → `definition` scope。JSON path 用诊断自带的，缺省时用定义锚点补齐。
 * - 无 `definitionId` 但有非根 JSON path → `change-set` scope。它把 `at` 显式置 null（不编造定义标识），
 *   同时**保留** path，因此比 `document` scope 少丢一维定位信息。
 * - 其余（纯解析/根级）→ `document` scope，由 span 承载来源文档身份。
 */
function projectWithSelector(
  ctx: DiagnosticProjectionContext,
  diagnostic: L2Diagnostic,
  selector: DiagnosticSelector,
  span: ReturnType<SourceIndex['span']>,
  common: ProjectionCommonPart,
): KernelDiagnostic {
  if (diagnostic.definitionId !== undefined) {
    const anchor = ctx.definitionAnchors.get(diagnostic.definitionId);
    const jsonPath = diagnostic.jsonPath ?? anchor ?? ROOT_JSON_PATH;
    return ctx.factory.definition({
      ...common,
      selector,
      definitionId: diagnostic.definitionId,
      jsonPath,
      sourceSpan: span,
    });
  }
  if (diagnostic.jsonPath !== undefined && diagnostic.jsonPath !== ROOT_JSON_PATH) {
    return ctx.factory.changeSet({ ...common, selector, jsonPath: diagnostic.jsonPath, sourceSpan: span });
  }
  return ctx.factory.document({ ...common, selector, sourceSpan: span });
}

function severityEscalationOf(
  ctx: DiagnosticProjectionContext,
  diagnostic: L2Diagnostic,
  selector: DiagnosticSelector,
  span: ReturnType<SourceIndex['span']>,
  common: ProjectionCommonPart,
): KernelDiagnostic | undefined {
  if (diagnostic.severity !== 'Error') {
    return undefined;
  }
  const code = ctx.catalog.resolve(selector.category, selector.condition);
  if (code === null) {
    // 选择器在 UGC 目录里解析不到代码：工厂会抛 UnmappedDiagnosticError，不可能走到这里。
    // 保留分支是为了让"目录变化导致映射失效"在类型层面必须被处理，而不是靠注释约定。
    return undefined;
  }
  const severity = ctx.catalog.severity(code);
  if (severity === 'error' || severity === 'fatal') {
    return undefined;
  }
  return ctx.factory.host({
    ...common,
    selector: PROJECTION_DEFECT_SELECTOR,
    rootCauseId: `${common.rootCauseId}#severity-escalation`,
    derivedFrom: common.rootCauseId,
    message:
      `l2 reported ${diagnostic.code} as Error but the mapped shared code ${code} carries severity ` +
      `${severity}; escalated to keep the port fail-closed.`,
    reason:
      `基类层把 ${diagnostic.code} 判定为阻断性错误，但它映射到的共享错误码 ${code} 在诊断目录中是 ` +
      `${severity} 级。为避免阻断性判定被投影降级，这里追加一条错误级诊断。`,
    correctionSuggestion:
      '修正 src/l2/ugc/ports/diagnostic-projection.ts 中该代码的选择器映射，使其严重级别与基类层判定一致。',
    sourceSpan: span,
  });
}

/** 批量投影。保持输入顺序；顺序由调用方（l2 的 canonicalSort）保证确定。 */
export function projectL2Diagnostics(
  ctx: DiagnosticProjectionContext,
  diagnostics: readonly L2Diagnostic[],
): readonly KernelDiagnostic[] {
  const output: KernelDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    output.push(...projectL2Diagnostic(ctx, diagnostic));
  }
  return Object.freeze(output);
}

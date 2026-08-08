/**
 * UGC 诊断类别 → 已登记 `ErrCode` 的封闭映射（design.md「Diagnostics」/ 需求 14.1、14.13）。
 *
 * 本文件**只消费**共享 `ERR_CODES`，不新增任何枚举成员，也不允许自由字符串代码。
 * 任务 1.3 已核实：下列全部代码都存在于 `src/core/kernel/state/error-codes.ts` 且在
 * `HINT_TEMPLATES` 中有 hint（由 `checkHintCompleteness` 强制）。
 */
import type { ErrCode } from '../../kernel/state/error-codes.js';

export const UGC_DIAGNOSTIC_CATEGORIES = [
  'JSON_SYNTAX',
  'PROHIBITED_CONSTRUCT',
  'SCHEMA_CONTRACT',
  'IDENTITY_CONFLICT',
  'LAYER_L1_OWNERSHIP',
  'LAYER_L3_OWNERSHIP',
  'VALUE_L3_OWNERSHIP',
  'VALUE_CLASSIFICATION_MISSING',
  'REFERENCE_CONTRACT',
  'COMPOSITION_CONFLICT',
  'RESOURCE_LIMIT',
  'VERSION_COMPATIBILITY',
  'ATOMIC_ACTIVATION',
  'PRESENTATION_FALLBACK',
] as const;

export type UGCDiagnosticCategory = (typeof UGC_DIAGNOSTIC_CATEGORIES)[number];

/** 每个类别下的稳定条件标识。它们是 UGC 拥有的封闭集合，不是自由文本。 */
export const CODE_MAP = {
  JSON_SYNTAX: {
    'syntax': 'E_LOAD_JSON_SYNTAX',
    'trailing-content': 'E_LOAD_JSON_SYNTAX',
    'nonfinite-number': 'E_LOAD_JSON_SYNTAX',
    'duplicate-member': 'E_LOAD_DUPLICATE_MEMBER',
    'invalid-utf8': 'E_LOAD_SOURCE_INVALID',
    'truncated': 'E_LOAD_INPUT_TRUNCATED',
    'source-span-invalid': 'E_LOAD_SOURCE_SPAN',
  },
  PROHIBITED_CONSTRUCT: {
    'executable-construct': 'E_LOAD_PROHIBITED_CONSTRUCT',
    'unregistered-expression-language': 'E_LOAD_PROHIBITED_CONSTRUCT',
    'unadmitted-effect-form': 'E_LOAD_PROHIBITED_CONSTRUCT',
  },
  SCHEMA_CONTRACT: {
    'schema-contract': 'E_LOAD_SCHEMA_CONTRACT',
    'missing-schema-version': 'E_LOAD_SCHEMA_VERSION',
    'missing-source-identity': 'E_LOAD_SCHEMA_CONTRACT',
    'missing-target-ownership': 'E_LOAD_SCHEMA_CONTRACT',
    'unknown-field': 'E_LOAD_UNKNOWN_FIELD',
    'required-field': 'E_LOAD_REQUIRED_FIELD',
    'field-type': 'E_LOAD_FIELD_TYPE',
    'cross-field-constraint': 'E_LOAD_CROSS_FIELD_CONSTRAINT',
    'def-kind': 'E_LOAD_DEF_KIND',
    'deprecated-mechanic': 'E_LOAD_DEPRECATED_MECHANIC',
    'semantic-field-damaged': 'E_LOAD_SEMANTIC_FIELD_DAMAGED',
    'canonical-ambiguous': 'E_LOAD_CANONICAL_AMBIGUOUS',
  },
  IDENTITY_CONFLICT: {
    'identity-conflict': 'E_LOAD_IDENTITY_CONFLICT',
    'duplicate-id': 'E_LOAD_DUPLICATE_ID',
    'identifier-invalid': 'E_LOAD_IDENTIFIER_INVALID',
    'override-invalid': 'E_LOAD_OVERRIDE_INVALID',
    'provider-identity-conflict': 'E_LOAD_IDENTITY_CONFLICT',
    'ambiguous-reference-target': 'E_REF_AMBIGUOUS',
  },
  LAYER_L1_OWNERSHIP: {
    'engine-primitive-request': 'E_LOAD_LAYER_OWNERSHIP',
    'runtime-state-mutation': 'E_LOAD_LAYER_OWNERSHIP',
  },
  LAYER_L3_OWNERSHIP: {
    'gameplay-rule-in-base-layer': 'E_LOAD_LAYER_OWNERSHIP',
    'base-registry-mutation-from-play-layer': 'E_LOAD_LAYER_OWNERSHIP',
    'mixed-layer-change-set': 'E_LOAD_LAYER_OWNERSHIP',
    'presentation-only-inheritance': 'E_LOAD_LAYER_OWNERSHIP',
  },
  VALUE_L3_OWNERSHIP: {
    'gameplay-value-in-base-layer': 'E_LOAD_NUMERIC_OWNERSHIP',
    'gameplay-value-range': 'E_LOAD_GAMEPLAY_VALUE_RANGE',
  },
  VALUE_CLASSIFICATION_MISSING: {
    'classification-missing': 'E_LOAD_NUMERIC_OWNERSHIP',
    'conflicting-classification': 'E_LOAD_NUMERIC_OWNERSHIP',
  },
  REFERENCE_CONTRACT: {
    'undefined-reference': 'E_LOAD_UNDEFINED_REF',
    'missing-target': 'E_REF_MISSING',
    'wrong-kind': 'E_REF_KIND',
    'abstract-target': 'E_REF_ABSTRACT',
    'provider-contract': 'E_REF_PROVIDER_CONTRACT',
    'reference-cycle': 'E_REF_CYCLE',
    'package-cycle': 'E_LOAD_CYCLE_DEP',
    'unresolved-contract': 'E_LOAD_UNRESOLVED_CONTRACT',
  },
  COMPOSITION_CONFLICT: {
    'inheritance-cycle': 'E_LOAD_INHERITANCE_CYCLE',
    'composition-conflict': 'E_LOAD_COMPOSITION_CONFLICT',
    'order-undeclared': 'E_LOAD_ORDER_UNDECLARED',
  },
  RESOURCE_LIMIT: {
    'inputBytes': 'E_QUOTA_INPUT_BYTES',
    'nestingDepth': 'E_QUOTA_NESTING_DEPTH',
    'objectMembers': 'E_QUOTA_OBJECT_MEMBERS',
    'arrayElements': 'E_QUOTA_ARRAY_ELEMENTS',
    'sourceRecords': 'E_QUOTA_SOURCE_RECORDS',
    'astNodes': 'E_QUOTA_AST_NODES',
    'definitions': 'E_QUOTA_DEFINITIONS',
    'referenceEdges': 'E_QUOTA_REFERENCE_EDGES',
    'traversalWork': 'E_QUOTA_TRAVERSAL_WORK',
    'diagnostics': 'E_QUOTA_DIAGNOSTICS',
    'migrationSteps': 'E_QUOTA_MIGRATION_STEPS',
    'outputBytes': 'E_QUOTA_OUTPUT_BYTES',
  },
  VERSION_COMPATIBILITY: {
    'unsupported-version': 'E_LOAD_SCHEMA_VERSION',
    'malformed-version': 'E_LOAD_SCHEMA_VERSION',
    'document-newer-than-supported': 'E_LOAD_SCHEMA_VERSION',
    'no-migration-path': 'E_MIG_NO_PATH',
    'ambiguous-migration-path': 'E_MIG_AMBIGUOUS_PATH',
    'duplicate-migration-edge': 'E_MIG_AMBIGUOUS_PATH',
    'migration-cycle': 'E_MIG_CYCLE',
    'migration-failed': 'E_MIG_FAILED',
    'newer-save': 'E_MIG_NEWER_SAVE',
    'migration-source-rebased': 'E_LOAD_MIGRATED_SOURCE_REBASED',
  },
  ATOMIC_ACTIVATION: {
    'baseline-stale': 'E_LOAD_BASELINE_STALE',
    'request-binding-mismatch': 'E_LOAD_BASELINE_STALE',
    'activation-failed': 'E_LOAD_ACTIVATION_FAILED',
    'artifact-not-minted': 'E_LOAD_ACTIVATION_FAILED',
    'gateway-invalid-result': 'E_LOAD_ACTIVATION_FAILED',
    'commit-recheck-failed': 'E_LOAD_COMMIT_RECHECK_FAILED',
    'partial-activation': 'E_LOAD_PARTIAL_ACTIVATION',
    'roundtrip-mismatch': 'E_LOAD_ROUNDTRIP_MISMATCH',
    'nondeterministic-canonicalization': 'E_LOAD_CANONICAL_NONDETERMINISTIC',
  },
  PRESENTATION_FALLBACK: {
    'presentation-fallback': 'E_LOAD_PRESENTATION_FALLBACK',
  },
} as const satisfies Record<UGCDiagnosticCategory, Readonly<Record<string, ErrCode>>>;

export type CodeMap = typeof CODE_MAP;

/** 某一类别下的合法条件标识联合类型。 */
export type ConditionOf<C extends UGCDiagnosticCategory> = keyof CodeMap[C] & string;

/** 全部 (类别, 条件) 组合的判别联合，供工厂调用点获得编译期检查。 */
export type DiagnosticSelector = {
  [C in UGCDiagnosticCategory]: { readonly category: C; readonly condition: ConditionOf<C> };
}[UGCDiagnosticCategory];

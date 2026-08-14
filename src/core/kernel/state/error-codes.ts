/**
 * ErrCode 封闭枚举（design.md 4.3节 / 需求39.5-39.6）。
 *
 * 物理上放在 kernel/state（L1）而非 kernel/safety（L13）：ERR_CODES 表本身是零运行时逻辑的
 * 纯数据派生（同 Expr/Query 的处理手法），但从 L3 的 Result<T>.code 起就需要引用 ErrCode 类型，
 * 若放在 L13 会造成 L3 反向 import L13。真正带运行时逻辑的 severity 判定、DiagnosticSink、
 * hint 规则机制仍归属 L13（kernel/safety），只从这里 import 类型与 FATAL_PREFIXES 常量。
 */

export const ERR_CODES = {
  E_REF: [
    'MISSING', 'KIND', 'DESTROYED', 'ABSTRACT', 'AMBIGUOUS',
    'PROVIDER_CONTRACT', 'CYCLE',
  ],
  E_INV: [
    'DANGLING', 'CYCLE', 'DUAL_LOCATION', 'STACK_LEAK',
    'SINGLE_CONTAINMENT', 'SINGLE_LOCATION', 'LOCATION_EXCLUSIVE', 'CONTAINMENT_CYCLE',
    'TOPOLOGY_CONSISTENCY', 'PARENT_CHILD', 'RELATION_SYMMETRY', 'CONTAINER_BIDIRECTIONAL',
    'SLOT_INDEX_CONTINUITY', 'ATTACHMENT_CONSISTENCY', 'STACK_BOUNDED', 'DECISION_TERMINATION',
    'NAN_OR_INFINITY', 'UNSUPPORTED_TYPE',
    'CARRIER_CAPACITY', 'CARRIER_LOCATION_EXCLUSIVE',
  ],
  E_OP: ['SLOT_FULL', 'NOT_ACCEPTED', 'VETOED', 'NO_LEGAL_SLOT', 'NOT_FOUND', 'INVALID_ARGS'],
  E_EXPR: ['TYPE', 'UNKNOWN_OP', 'DEPTH', 'CALL_CYCLE'],
  E_FLOW: ['BUDGET', 'NO_MAXITER', 'ABORT', 'INTERNAL', 'UNKNOWN_EFFECT'],
  E_HOOK: ['DEPTH', 'REENTRY', 'INSTEAD_CONFLICT'],
  E_COST: ['INSUFFICIENT', 'FROZEN_GONE'],
  E_DEC: ['VOID', 'QUORUM'],
  E_LOAD: [
    // Existing runtime loading codes.
    'CONFLICT', 'CYCLE_DEP', 'LINT', 'UNDEFINED_REF',
    'SOURCE_INVALID', 'SOURCE_SPAN', 'JSON_SYNTAX', 'DUPLICATE_MEMBER',
    'PROHIBITED_CONSTRUCT', 'SCHEMA_CONTRACT', 'IDENTITY_CONFLICT',
    'UNRESOLVED_CONTRACT', 'DECISION_ID_REUSED', 'BASELINE_STALE',
    'ACTIVATION_FAILED', 'MODE_FORBIDDEN', 'DIAGNOSTIC_FACTORY',
    'COMPILER_TERMINATED', 'WORKER_PROTOCOL', 'PERSISTENCE_CAPABILITY',
    'STAGE_IO', 'ATOMIC_RENAME', 'RECOVERY_CORRUPT',

    // Specification compiler source and diagnostic integrity.
    'SOURCE_RECORD_MISSING', 'SOURCE_SPAN_CORRUPT', 'SOURCE_MAP_LOST',
    'DIAGNOSTIC_FAILURE', 'INPUT_TRUNCATED',

    // Schema and identity.
    'SCHEMA_VERSION', 'UNKNOWN_FIELD', 'REQUIRED_FIELD', 'FIELD_TYPE',
    'DEF_KIND', 'IDENTIFIER_INVALID', 'DUPLICATE_ID', 'OVERRIDE_INVALID',
    'OVERRIDE_INVALIDATES_DEPENDENT',

    // Layer, terminology, numeric, and semantic ownership.
    'LAYER_OWNERSHIP', 'TERM_NONCANONICAL', 'NUMERIC_OWNERSHIP',
    'GAMEPLAY_VALUE_RANGE', 'CROSS_FIELD_CONSTRAINT', 'DEPRECATED_MECHANIC',
    'SEMANTIC_FIELD_DAMAGED',

    // Composition and specification-source precedence.
    'INHERITANCE_CYCLE', 'COMPOSITION_CONFLICT', 'ORDER_UNDECLARED',
    'SOURCE_DISPLACED', 'EQUAL_PRECEDENCE_CONFLICT', 'UNRESOLVED_NORMATIVE',
    'SOURCE_STATUS_PROMOTION', 'NORMATIVE_WITHOUT_PROVENANCE',

    // Migration rebased the reported source positions onto the migrated document.
    'MIGRATED_SOURCE_REBASED',

    // Canonicalization, commit, and isolated output.
    'CANONICAL_AMBIGUOUS', 'CANONICAL_NONDETERMINISTIC', 'ROUNDTRIP_MISMATCH',
    'COMMIT_RECHECK_FAILED', 'PARTIAL_ACTIVATION', 'OUTPUT_WRITE_FAILED',
    'CACHE_ROLLBACK_FAILED', 'PRESENTATION_FALLBACK',

    // Map anchor and advanced-playpack determination.
    'MAP_ANCHOR_NON_REPLACEABLE', 'LLM_MAP_INDEPENDENT',
  ],
  E_MIG: ['NO_PATH', 'NEWER_SAVE', 'FAILED', 'AMBIGUOUS_PATH', 'CYCLE'],
  E_QUOTA: [
    'ENTITIES', 'ATTACHMENTS', 'RULES', 'INPUT_BYTES', 'NESTING_DEPTH',
    'OBJECT_MEMBERS', 'ARRAY_ELEMENTS', 'SOURCE_RECORDS', 'AST_NODES',
    'DEFINITIONS', 'REFERENCE_EDGES', 'TRAVERSAL_WORK', 'DIAGNOSTICS',
    'OUTPUT_BYTES', 'MIGRATION_STEPS',
  ],
} as const satisfies Record<string, readonly string[]>;

export type ErrCode = { [K in keyof typeof ERR_CODES]: `${K}_${(typeof ERR_CODES)[K][number]}` }[keyof typeof ERR_CODES];

/** 需求39.6：E_INV_* 永远是运行时不变量 fatal；玩法包不可覆盖。 */
export const FATAL_PREFIXES = ['E_INV'] as const;

/**
 * 规范编译器基础设施失败。它们不是创作者输入错误：一旦出现，编译会话必须撤销输出租约并停止。
 * 使用显式闭合集合而非 E_LOAD 前缀，避免把普通候选装载错误误判为进程级故障。
 */
export const INFRASTRUCTURE_FATAL_CODES = [
  'E_LOAD_SOURCE_RECORD_MISSING',
  'E_LOAD_SOURCE_SPAN_CORRUPT',
  'E_LOAD_SOURCE_MAP_LOST',
  'E_LOAD_DIAGNOSTIC_FAILURE',
  'E_LOAD_DIAGNOSTIC_FACTORY',
  'E_LOAD_COMPILER_TERMINATED',
  'E_LOAD_WORKER_PROTOCOL',
  'E_LOAD_CANONICAL_NONDETERMINISTIC',
  'E_LOAD_ROUNDTRIP_MISMATCH',
  'E_LOAD_PARTIAL_ACTIVATION',
  'E_LOAD_OUTPUT_WRITE_FAILED',
  'E_LOAD_CACHE_ROLLBACK_FAILED',
  'E_LOAD_ATOMIC_RENAME',
  'E_LOAD_RECOVERY_CORRUPT',
  'E_QUOTA_DIAGNOSTICS',
] as const satisfies readonly ErrCode[];

const INFRASTRUCTURE_FATAL_SET: ReadonlySet<string> = new Set(INFRASTRUCTURE_FATAL_CODES);

export function isFatalCode(code: string): boolean {
  return FATAL_PREFIXES.some((prefix) => code.startsWith(prefix));
}

export function isInfrastructureFatalCode(code: string): code is (typeof INFRASTRUCTURE_FATAL_CODES)[number] {
  return INFRASTRUCTURE_FATAL_SET.has(code);
}

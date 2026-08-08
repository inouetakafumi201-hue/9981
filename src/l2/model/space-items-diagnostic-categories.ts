/**
 * 基类层 · 空间与物品领域：诊断类别与已登记 `ErrCode` 的封闭映射。
 *
 * 对应要求 12.2、12.3 与 design.md「Diagnostics」全表。
 *
 * 两条硬约束：
 * 1. **不新增 `ERR_CODES` 成员**：本文件只把领域类别映射到 `src/core/kernel/state/error-codes.ts`
 *    已登记的码。`satisfies` 使任何拼错或未登记的码在编译期失败。
 * 2. **类别与条件是封闭集合**：自由字符串代码无法通过类型检查。
 *
 * 诊断的 `code` 字段取用 `ErrCode` 字面量（而不是 `./diagnostic-codes.ts` 的 `DIAGNOSTIC_CODES`），
 * 这与 design.md 的 Diagnostics 表逐字一致，并顺带保证本领域诊断与 `src/l2/validation` 既有规则
 * 的诊断不会在同一 (定义, 路径, 代码) 三元组上重复出现。
 */

import type { ErrCode } from '../../core/kernel/state/error-codes.js';
import type {
  DefinitionId,
  HumanReadableText,
  JsonPath,
  PackageId,
} from './ids.js';
import type { Diagnostic, DiagnosticSeverity } from './diagnostic.js';
import { createDiagnostic } from './diagnostic-factory.js';
import type { SourceLocation, SourceRecord } from './source.js';
import { canonicalSort, compareDiagnostics } from './ordering.js';

/** 本领域拥有的诊断类别（封闭集合）。 */
export const SPACE_ITEMS_DIAGNOSTIC_CATEGORIES = [
  'LAYER_L1_OWNERSHIP',
  'LAYER_L3_OWNERSHIP',
  'VALUE_L3_OWNERSHIP',
  'VALUE_CLASSIFICATION_MISSING',
  'OP_BYPASS_FORBIDDEN',
  'STRUCTURAL_BOUND_VIOLATION',
  'MICRO_SCENE_CREATOR_MISUSE',
  'MICRO_SCENE_ATTACHMENT',
  'DEPRECATED_MECHANIC',
  'TERMINOLOGY',
  'PROVENANCE',
  'SOURCE_CONFLICT',
  'COMPOSITION_CONTRACT',
  'REFERENCE_CONTRACT',
  'UNRESOLVED_ITEM_DEFAULTING',
  'UNRESOLVED_ITEM_PROMOTION',
  'PENDING_CONVERGENCE',
  'SEMANTIC_FIELD_DAMAGED',
  'PRESENTATION_FALLBACK',
  'PROJECTION_WRITE',
  'RUNTIME_PRECONDITION',
] as const;

export type DomainDiagnosticCategory = (typeof SPACE_ITEMS_DIAGNOSTIC_CATEGORIES)[number];

export function categoryRank(category: DomainDiagnosticCategory): number {
  const index = SPACE_ITEMS_DIAGNOSTIC_CATEGORIES.indexOf(category);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * （类别，条件）→ 已登记 `ErrCode` 的封闭映射。
 *
 * `satisfies` 提供编译期完整性检查：任何类别遗漏或任何未登记码都会使类型检查失败。
 */
export const DOMAIN_CODE_MAP = {
  LAYER_L1_OWNERSHIP: {
    'redefines-runtime-primitive': 'E_LOAD_LAYER_OWNERSHIP',
  },
  LAYER_L3_OWNERSHIP: {
    'concrete-map-or-mode-rule': 'E_LOAD_LAYER_OWNERSHIP',
    'named-instance': 'E_LOAD_LAYER_OWNERSHIP',
    'policy-not-owned-by-play-layer': 'E_LOAD_LAYER_OWNERSHIP',
  },
  VALUE_L3_OWNERSHIP: {
    'gameplay-value-in-base-layer': 'E_LOAD_NUMERIC_OWNERSHIP',
    'gameplay-value-range': 'E_LOAD_GAMEPLAY_VALUE_RANGE',
  },
  VALUE_CLASSIFICATION_MISSING: {
    'classification-missing': 'E_LOAD_NUMERIC_OWNERSHIP',
    'conflicting-classification': 'E_LOAD_NUMERIC_OWNERSHIP',
    'unlabeled-internal-metric': 'E_LOAD_NUMERIC_OWNERSHIP',
    'gameplay-value-missing-visibility': 'E_LOAD_NUMERIC_OWNERSHIP',
    'gameplay-value-missing-exemption-source': 'E_LOAD_NUMERIC_OWNERSHIP',
    'structural-bound-missing-source': 'E_LOAD_NUMERIC_OWNERSHIP',
    'structural-bound-missing-rationale': 'E_LOAD_NUMERIC_OWNERSHIP',
    'constitutional-constant-missing-layer': 'E_LOAD_NUMERIC_OWNERSHIP',
  },
  OP_BYPASS_FORBIDDEN: {
    'direct-state-write': 'E_LOAD_LAYER_OWNERSHIP',
    'direct-container-mutation': 'E_LOAD_LAYER_OWNERSHIP',
    'direct-relation-index-mutation': 'E_LOAD_LAYER_OWNERSHIP',
    'transaction-bypass': 'E_LOAD_LAYER_OWNERSHIP',
    'new-transfer-primitive': 'E_LOAD_LAYER_OWNERSHIP',
    'unregistered-op-reference': 'E_LOAD_UNDEFINED_REF',
    'engine-capability-rewritten': 'E_LOAD_LAYER_OWNERSHIP',
  },
  STRUCTURAL_BOUND_VIOLATION: {
    'connection-count-exceeded': 'E_LOAD_CROSS_FIELD_CONSTRAINT',
    'bound-rewritten-as-balance-value': 'E_LOAD_CROSS_FIELD_CONSTRAINT',
    'bound-source-removed': 'E_LOAD_CROSS_FIELD_CONSTRAINT',
    'scale-identity-mismatch': 'E_LOAD_CROSS_FIELD_CONSTRAINT',
    'scale-tightening-invalid': 'E_LOAD_CROSS_FIELD_CONSTRAINT',
  },
  MICRO_SCENE_CREATOR_MISUSE: {
    'creator-as-owner': 'E_LOAD_CROSS_FIELD_CONSTRAINT',
    'creator-as-lifecycle': 'E_LOAD_CROSS_FIELD_CONSTRAINT',
    'creator-as-access-control': 'E_LOAD_CROSS_FIELD_CONSTRAINT',
    'creator-declared-mutable': 'E_LOAD_SCHEMA_CONTRACT',
  },
  MICRO_SCENE_ATTACHMENT: {
    'missing-parent': 'E_LOAD_SCHEMA_CONTRACT',
    'parent-not-natural-scene': 'E_LOAD_SCHEMA_CONTRACT',
    'orphaned-child': 'E_LOAD_SCHEMA_CONTRACT',
    'independent-occupancy-counter': 'E_LOAD_SCHEMA_CONTRACT',
    'vehicle-as-micro-scene': 'E_LOAD_SCHEMA_CONTRACT',
    'nesting-tree-derived-distance': 'E_LOAD_SCHEMA_CONTRACT',
  },
  DEPRECATED_MECHANIC: {
    'volume-class': 'E_LOAD_DEPRECATED_MECHANIC',
    'pocket-slots': 'E_LOAD_DEPRECATED_MECHANIC',
    'vetoed-mechanic': 'E_LOAD_DEPRECATED_MECHANIC',
    'removed-status': 'E_LOAD_DEPRECATED_MECHANIC',
  },
  TERMINOLOGY: {
    'non-canonical-term': 'E_LOAD_TERM_NONCANONICAL',
  },
  PROVENANCE: {
    'missing-source-record': 'E_LOAD_NORMATIVE_WITHOUT_PROVENANCE',
  },
  SOURCE_CONFLICT: {
    'equal-precedence-conflict': 'E_LOAD_EQUAL_PRECEDENCE_CONFLICT',
  },
  COMPOSITION_CONTRACT: {
    'value-only-subtype': 'E_LOAD_NUMERIC_OWNERSHIP',
    'inheritance-cycle': 'E_LOAD_INHERITANCE_CYCLE',
    'composition-conflict': 'E_LOAD_COMPOSITION_CONFLICT',
    'order-undeclared': 'E_LOAD_ORDER_UNDECLARED',
    'missing-composition-role': 'E_LOAD_COMPOSITION_CONFLICT',
    'configuration-not-composed': 'E_LOAD_COMPOSITION_CONFLICT',
  },
  REFERENCE_CONTRACT: {
    'missing-target': 'E_REF_MISSING',
    'wrong-kind-or-family': 'E_REF_KIND',
    'abstract-target': 'E_REF_ABSTRACT',
    'reference-cycle': 'E_REF_CYCLE',
    'undefined-reference': 'E_LOAD_UNDEFINED_REF',
    'missing-required-capability': 'E_REF_PROVIDER_CONTRACT',
  },
  UNRESOLVED_ITEM_DEFAULTING: {
    'default-value': 'E_LOAD_UNRESOLVED_NORMATIVE',
    'default-flow': 'E_LOAD_UNRESOLVED_NORMATIVE',
    'default-action': 'E_LOAD_UNRESOLVED_NORMATIVE',
    'default-availability': 'E_LOAD_UNRESOLVED_NORMATIVE',
  },
  UNRESOLVED_ITEM_PROMOTION: {
    'promotion-without-decision': 'E_LOAD_SOURCE_STATUS_PROMOTION',
  },
  PENDING_CONVERGENCE: {
    'port-unavailable': 'E_LOAD_UNRESOLVED_CONTRACT',
    'contract-unmerged': 'E_LOAD_UNRESOLVED_CONTRACT',
    'hook-integration-unavailable': 'E_LOAD_UNRESOLVED_CONTRACT',
  },
  SEMANTIC_FIELD_DAMAGED: {
    'missing-or-damaged-semantic-field': 'E_LOAD_SEMANTIC_FIELD_DAMAGED',
  },
  PRESENTATION_FALLBACK: {
    'presentation-only-fallback': 'E_LOAD_PRESENTATION_FALLBACK',
  },
  PROJECTION_WRITE: {
    'write-through-projection': 'E_LOAD_LAYER_OWNERSHIP',
  },
  RUNTIME_PRECONDITION: {
    'deposit-disabled': 'E_OP_INVALID_ARGS',
    'withdraw-disabled': 'E_OP_INVALID_ARGS',
    'no-legal-slot': 'E_OP_NO_LEGAL_SLOT',
    'slot-full': 'E_OP_SLOT_FULL',
    'op-not-registered': 'E_OP_NOT_FOUND',
    'vetoed': 'E_OP_VETOED',
  },
} as const satisfies Record<DomainDiagnosticCategory, Readonly<Record<string, ErrCode>>>;

/** 某类别下的合法条件标识联合。 */
export type DomainConditionOf<C extends DomainDiagnosticCategory> = keyof (typeof DOMAIN_CODE_MAP)[C] &
  string;

/** 把（类别，条件）解析为已登记 `ErrCode`。 */
export function codeOf<C extends DomainDiagnosticCategory>(
  category: C,
  condition: DomainConditionOf<C>,
): ErrCode {
  return DOMAIN_CODE_MAP[category][condition] as ErrCode;
}

/** 未决项编号（在 `space-items-unresolved.ts` 中定义其目录；此处只需其字面量形状）。 */
export type UnresolvedItemId =
  | 'U-SPACE-001'
  | 'U-SPACE-002'
  | 'U-SPACE-003'
  | 'U-SPACE-004'
  | 'U-SPACE-005'
  | 'U-SPACE-006'
  | 'U-SPACE-007';

/**
 * 领域诊断：在共享 `Diagnostic` 之上附加两个领域字段。
 *
 * - `unresolvedId`：未决门禁诊断必须携带对应编号（要求 13.8）。
 * - `forbiddenSurface`：被命中的禁止字段面的 JSON 路径。
 */
export interface DomainDiagnostic extends Diagnostic {
  readonly category: DomainDiagnosticCategory;
  readonly condition: string;
  readonly unresolvedId?: UnresolvedItemId;
  readonly forbiddenSurface?: JsonPath;
}

/** 诊断作用域：决定哪些定位字段适用。 */
export const DIAGNOSTIC_SCOPES = ['definition', 'package', 'runtime'] as const;
export type DiagnosticScope = (typeof DIAGNOSTIC_SCOPES)[number];

export interface DomainDiagnosticInput<C extends DomainDiagnosticCategory> {
  readonly scope: DiagnosticScope;
  readonly category: C;
  readonly condition: DomainConditionOf<C>;
  readonly severity?: DiagnosticSeverity;
  readonly reason: HumanReadableText;
  readonly correctionSuggestion: HumanReadableText;
  readonly definitionId?: DefinitionId;
  readonly jsonPath?: JsonPath;
  readonly sourcePackage?: PackageId;
  readonly sourceLocation?: SourceLocation;
  readonly relatedSources?: readonly SourceRecord[];
  readonly unresolvedId?: UnresolvedItemId;
  readonly forbiddenSurface?: JsonPath;
}

/**
 * scope-aware 领域诊断工厂。
 *
 * 结构上不适用的定位字段**显式省略**而不是填空串：包级元数据错误没有 `definitionId`，
 * 运行期拒绝没有 `sourcePackage`。填空串会让"字段缺席"与"字段为空"不可区分，
 * 并破坏 `compareOptionalStrings` 的确定排序。
 */
export function domainDiagnostic<C extends DomainDiagnosticCategory>(
  input: DomainDiagnosticInput<C>,
): DomainDiagnostic {
  const severity: DiagnosticSeverity =
    input.severity ?? (input.category === 'PRESENTATION_FALLBACK' ? 'Warning' : 'Error');
  const base = createDiagnostic({
    code: codeOf(input.category, input.condition),
    severity,
    reason: input.reason,
    correctionSuggestion: input.correctionSuggestion,
    ...(input.scope === 'definition' || input.scope === 'runtime'
      ? input.definitionId === undefined
        ? {}
        : { definitionId: input.definitionId }
      : {}),
    ...(input.jsonPath === undefined ? {} : { jsonPath: input.jsonPath }),
    ...(input.scope === 'runtime' || input.sourcePackage === undefined
      ? {}
      : { sourcePackage: input.sourcePackage }),
    ...(input.sourceLocation === undefined ? {} : { sourceLocation: input.sourceLocation }),
    ...(input.relatedSources === undefined ? {} : { relatedSources: input.relatedSources }),
  });
  return Object.freeze({
    ...base,
    category: input.category,
    condition: input.condition,
    ...(input.unresolvedId === undefined ? {} : { unresolvedId: input.unresolvedId }),
    ...(input.forbiddenSurface === undefined ? {} : { forbiddenSurface: input.forbiddenSurface }),
  }) as DomainDiagnostic;
}

/**
 * 领域诊断的固定排序键：受影响定义标识 → JSON 路径 → 稳定代码 → 来源定位。
 * 直接复用 `./ordering.ts` 的 `compareDiagnostics`，不另立一套顺序。
 */
export function sortDomainDiagnostics(
  diagnostics: readonly Diagnostic[],
): readonly Diagnostic[] {
  return Object.freeze(canonicalSort(diagnostics, compareDiagnostics).slice());
}

/** 全部（类别，条件）对，供完整性测试与追踪矩阵机械枚举。 */
export function allCategoryConditions(): readonly {
  readonly category: DomainDiagnosticCategory;
  readonly condition: string;
  readonly code: ErrCode;
}[] {
  const out: { category: DomainDiagnosticCategory; condition: string; code: ErrCode }[] = [];
  for (const category of SPACE_ITEMS_DIAGNOSTIC_CATEGORIES) {
    const conditions = DOMAIN_CODE_MAP[category] as Readonly<Record<string, ErrCode>>;
    for (const condition of Object.keys(conditions).sort()) {
      out.push({ category, condition, code: conditions[condition]! });
    }
  }
  return Object.freeze(out);
}

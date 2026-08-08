/**
 * L2 Model: 类型化引用、组合组件、类型身份与字段合并规则。
 *
 * 对应 Requirements 3.1–3.11、4.7、12.1–12.4 与 design.md 的
 * `Type_Identity` / `Composition_Component` / 类型化引用数据模型。
 */

import type { DefinitionId, FieldName, HumanReadableText, JsonPath } from './ids.js';
import type { ExpectedReferenceType, ParameterSchema } from './schema.js';

/**
 * 引用角色。
 * Requirements 12.1 点名的引用类别全部登记在此；`string` 开放以支持新语义族扩展。
 */
export const REFERENCE_ROLES = [
  'base',
  'action',
  'rule',
  'expr',
  'policy',
  'node',
  'link',
  'item',
  'attachment',
  'container',
  'slot',
  'effect',
  'damage',
  'status',
  'skill',
  'movement',
  'tag',
  'op',
  'schedule',
  'prefab',
  'decision',
  'playpack',
  'entity',
] as const;

export type KnownReferenceRole = (typeof REFERENCE_ROLES)[number];
export type ReferenceRole = KnownReferenceRole | string;

/** 引用角色的规范化排序序数；未登记角色按字典序排在已登记角色之后。 */
export function referenceRoleRank(role: ReferenceRole): number {
  const index = (REFERENCE_ROLES as readonly string[]).indexOf(role);
  return index === -1 ? REFERENCE_ROLES.length : index;
}

/**
 * 类型化引用。
 *
 * `jsonPath` 是该引用在宿主定义内的位置，用于诊断定位（Requirements 12.3）。
 * 它由构造方填写；`resolution/reference-graph.ts` 不猜测路径。
 */
export interface TypedReference {
  readonly refId: DefinitionId;
  readonly role: ReferenceRole;
  readonly expected: ExpectedReferenceType;
  readonly jsonPath: JsonPath;
  /** 该引用是否为必需引用。可选引用缺失不构成 `REF_MISSING_TARGET`。 */
  readonly required: boolean;
}

/** `extends` 使用的定义引用。 */
export interface DefinitionReference {
  readonly refId: DefinitionId;
  readonly jsonPath: JsonPath;
}

/**
 * 组合组件角色。
 * 这些角色是"配置面"的名字（继承决定类型，嵌套决定配置）。
 */
export const COMPOSITION_ROLES = [
  'parameter-values',
  // 2026-08-08 权威变更（本次会话裁决，已获项目所有者授权）：'attack-shape' 已改名为
  // 'weapon-attribute'。攻击形状（single-target/spread/area 三选一形状轴）判定为冗余设计，
  // 已被武器属性（散射/扫射/连发）完全覆盖。详见 docs/L0_规范宪法.md、
  // docs/L2_基类层/基类层定义.md §4.3、src/l2/model/family-contracts.ts 顶部权威变更说明。
  'weapon-attribute',
  'range-profile',
  'damage-reference',
  'target-limit',
  'ammunition-behavior',
  'accessory-compatibility',
  'slot',
  'tag',
  'attachment',
  'optional-capability',
  'container',
  'seat',
  'cargo',
  'door',
  'lock',
  'movement',
  'collision',
  'destruction',
  'mitigation-rule',
  'break-condition',
  'use-location',
  'consumption-behavior',
  'effect',
  'trigger',
  'interruption',
  'cooldown',
  'cost',
  'perception',
  'fallback-state',
  'interaction-rule',
  'occupancy',
  'shared-micro-scene',
  'traversal-condition',
  'blocking-capability',
  'vehicle-adjacency',
  'door-target',
] as const;

export type KnownCompositionRole = (typeof COMPOSITION_ROLES)[number];
export type CompositionRole = KnownCompositionRole | string;

export function compositionRoleRank(role: CompositionRole): number {
  const index = (COMPOSITION_ROLES as readonly string[]).indexOf(role);
  return index === -1 ? COMPOSITION_ROLES.length : index;
}

/**
 * Composition_Component：参数值、攻击谱型、伤害接口、槽位、标签、附件与可选能力的载体。
 *
 * `typeDefining` 为 true 时，该可选能力被声明为类型决定项，移除它会改变宿主 Type_Identity
 * （Requirements 3.11）。
 * `dependsOn` 是显式顺序依赖；为空表示该组件与其他组件独立，任意顺序应用必须等价
 * （Requirements 3.2 / Property 5）。
 */
export interface CompositionComponent {
  readonly componentId: string;
  readonly role: CompositionRole;
  readonly target?: TypedReference;
  readonly parameters?: ParameterSchema;
  readonly optional: boolean;
  readonly typeDefining: boolean;
  readonly dependsOn: readonly string[];
  readonly reason?: HumanReadableText;
}

/**
 * Type_Identity：只能由必需能力、合法关系、不变量或替换兼容性差异细化。
 * 四个集合都为空表示"没有声明任何类型身份"，验证器据此拒绝无差异子类型。
 */
export interface TypeIdentity {
  readonly requiredCapabilities: readonly string[];
  readonly legalRelationships: readonly string[];
  readonly invariants: readonly string[];
  readonly substitutionCompatibility: readonly string[];
}

export const EMPTY_TYPE_IDENTITY: TypeIdentity = Object.freeze({
  requiredCapabilities: Object.freeze([]) as readonly string[],
  legalRelationships: Object.freeze([]) as readonly string[],
  invariants: Object.freeze([]) as readonly string[],
  substitutionCompatibility: Object.freeze([]) as readonly string[],
});

/** Type_Identity 的四个维度名，用于确定性遍历。 */
export const TYPE_IDENTITY_DIMENSIONS = [
  'requiredCapabilities',
  'legalRelationships',
  'invariants',
  'substitutionCompatibility',
] as const;

export type TypeIdentityDimension = (typeof TYPE_IDENTITY_DIMENSIONS)[number];

/** 判断两个 Type_Identity 是否存在实质差异。 */
export function typeIdentityDiffers(left: TypeIdentity, right: TypeIdentity): boolean {
  for (const dimension of TYPE_IDENTITY_DIMENSIONS) {
    const a = [...left[dimension]].sort();
    const b = [...right[dimension]].sort();
    if (a.length !== b.length) {
      return true;
    }
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) {
        return true;
      }
    }
  }
  return false;
}

/** 字段合并策略（Requirements 3.7）。 */
export const FIELD_MERGE_STRATEGIES = ['prefer-declared-order', 'union', 'intersect', 'replace'] as const;
export type FieldMergeStrategy = (typeof FIELD_MERGE_STRATEGIES)[number];

/**
 * 显式字段合并/优先级声明。
 * 多重继承对同一字段给出不同值时，必须存在对应的 `FieldMergeRule`，
 * 否则返回 `INHERIT_FIELD_CONFLICT_WITHOUT_RULE`。
 */
export interface FieldMergeRule {
  readonly field: FieldName;
  readonly strategy: FieldMergeStrategy;
  /** `prefer-declared-order` 时给出祖先定义的优先顺序，首个胜出。 */
  readonly precedence: readonly DefinitionId[];
  readonly reason: HumanReadableText;
}

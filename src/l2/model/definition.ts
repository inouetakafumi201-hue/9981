/**
 * L2 Model: 基类定义、可复用实例、语义族登记、定义包与已解析定义。
 *
 * 对应 Requirements 2、3、4、11、12 与 design.md 的
 * `Base_Definition` / `Reusable_Instance` / `Definition_Package` / `Semantic_Family_Registration`
 * 数据模型。
 *
 * 设计补充（`src/l2/决策与风险记录.md` D-L2-003）：
 * design.md 把 `Base_Definition.semanticFamily` 直接标为 `Semantic_Family_Registration`。
 * 若每个定义都内嵌完整登记体，同一族的 N 个定义会产生 N 份可能互相矛盾的登记理由。
 * 本实现改为 `SemanticFamilyReference`：始终携带 `familyId`，并在"该定义首次提议登记一个新族"
 * 时内嵌 `registration`（含三判据证据与 Source_Record）。这保留了设计意图
 * （新族必须随定义提交分类理由与来源），同时消去重复登记体的矛盾风险。
 *
 * 设计补充（D-L2-004）：design.md 的 `Definition_Package` 只有 `overrideIntent`，
 * 但 Requirements 12.10–12.11 与任务 5.1 要求处理"删除"。本实现新增 `removals`，
 * 语义与 `overrideIntent` 对称：都必须先进入候选工作副本再重验入边依赖。
 */

import type {
  DefinitionId,
  FieldName,
  HumanReadableText,
  JsonPath,
  PackageId,
  SemanticFamilyId,
  TagId,
} from './ids';
import type { L1DefKind, L1ExclusiveMechanism } from './def-kind';
import type { GameplayValueAssignment, ParameterField, ParameterSchema } from './schema';
import type { FamilyEligibilityEvidence, SourceLocation, SourceRecord } from './source';
import type {
  CompositionComponent,
  DefinitionReference,
  FieldMergeRule,
  TypeIdentity,
  TypedReference,
} from './reference';
import type { FamilyContract } from './family-contracts';

/** 语义族登记体：新族必须保存三判据分类理由与来源（Requirements 4.3）。 */
export interface SemanticFamilyRegistration {
  readonly familyId: SemanticFamilyId;
  readonly classificationReason: HumanReadableText;
  readonly eligibility: FamilyEligibilityEvidence;
  readonly sourceRecords: readonly SourceRecord[];
}

/** 定义对语义族的引用；仅在提议新族时内嵌 `registration`。 */
export interface SemanticFamilyReference {
  readonly familyId: SemanticFamilyId;
  readonly registration?: SemanticFamilyRegistration;
}

/**
 * 越层玩法规则的违规检测面（Requirements 2.4、10.5）。
 * L2 定义出现任何一项即返回 `LAYER_L3_OWNERSHIP`。
 */
export const GAMEPLAY_SPECIFIC_RULE_KINDS = [
  'concrete-map-arrangement',
  'victory-condition',
  'spawn-distribution',
  'game-mode-sequence',
  'gameplay-profile-coupling',
  'patrol-route',
  'concrete-perception-threshold',
  'gameplay-profile-state-machine',
  'npc-instance-coupling',
] as const;

export type GameplaySpecificRuleKind = (typeof GAMEPLAY_SPECIFIC_RULE_KINDS)[number];

export interface GameplaySpecificRule {
  readonly kind: GameplaySpecificRuleKind;
  readonly detail: HumanReadableText;
  readonly jsonPath?: JsonPath;
}

/** 表现元数据：只影响名称、图标、纹理、动画或辅助文本，不改变规则结果。 */
export interface PresentationMetadata {
  readonly displayName?: string;
  readonly iconRef?: string;
  readonly assetRefs?: readonly string[];
  readonly accessibleLabel?: string;
  readonly animationRef?: string;
  readonly description?: string;
}

/**
 * Base_Definition。
 *
 * `gameplayValues`、`gameplaySpecificRules`、`declaredL1Mechanisms` 是违规检测面：
 * 合法 L2 定义中它们必须缺省或为空数组。保留它们是为了让越层声明能被确定性发现并定位，
 * 而不是靠对任意 JSON 的启发式猜测。
 */
export interface BaseDefinition {
  readonly id: DefinitionId;
  readonly defKind: L1DefKind;
  readonly abstract: boolean;
  readonly semanticFamily: SemanticFamilyReference;
  readonly typeIdentity: TypeIdentity;
  readonly extends?: readonly DefinitionReference[];
  readonly composition: readonly CompositionComponent[];
  readonly parameterSchema: ParameterSchema;
  readonly tags: readonly TagId[];
  readonly actionRefs: readonly TypedReference[];
  readonly ruleRefs: readonly TypedReference[];
  readonly sourceRecords: readonly SourceRecord[];
  readonly presentation?: PresentationMetadata;

  /** 其他类型化引用：node / link / item / container / slot / expr / policy / attachment 等。 */
  readonly otherRefs?: readonly TypedReference[];
  readonly familyContract?: FamilyContract;
  readonly mergeRules?: readonly FieldMergeRule[];
  readonly gameplayValues?: readonly GameplayValueAssignment[];
  readonly gameplaySpecificRules?: readonly GameplaySpecificRule[];
  readonly declaredL1Mechanisms?: readonly L1ExclusiveMechanism[];

  /** 候选定义在其来源 JSON 中的位置，用于诊断定位。 */
  readonly sourceLocation?: SourceLocation;
  readonly jsonPath?: JsonPath;
}

/** 候选定义：进入验证的未激活定义。 */
export type CandidateDefinition = BaseDefinition;

/**
 * Reusable_Instance：非抽象、无玩法数值、无具体玩法规则。
 * 类型层面用 `abstract: false` 固定；`gameplayValues` / `gameplaySpecificRules` 的"缺席"
 * 由验证器在运行时强制（类型系统无法表达"必须为空"）。
 */
export interface ReusableInstance extends BaseDefinition {
  readonly abstract: false;
}

/** 包依赖声明。 */
export interface PackageDependency {
  readonly packageId: PackageId;
  /** 声明式版本约束字符串；L2 不实现版本解析算法，只做存在性与一致性校验。 */
  readonly versionConstraint?: string;
}

/** 覆盖意图（Requirements 12.6–12.7）。 */
export interface OverrideIntent {
  readonly targetId: DefinitionId;
  readonly reason: HumanReadableText;
}

/** 删除意图（Requirements 12.10–12.11）。 */
export interface RemovalIntent {
  readonly targetId: DefinitionId;
  readonly reason: HumanReadableText;
  /**
   * 父天然场景删除时，对子 Micro_Scene 引用采用的 L1 支持的生命周期操作
   * （Requirements 7.12–7.13）。
   */
  readonly childLifecycleOperation?: ChildLifecycleOperation;
}

/**
 * L1 支持的子引用生命周期操作。
 * L2 只声明选用哪一种，不实现其运行时语义。
 */
export const CHILD_LIFECYCLE_OPERATIONS = ['cascade-destroy', 'reparent', 'detach'] as const;
export type ChildLifecycleOperationKind = (typeof CHILD_LIFECYCLE_OPERATIONS)[number];

export interface ChildLifecycleOperation {
  readonly kind: ChildLifecycleOperationKind;
  /** `reparent` 必填：新的天然场景父级。 */
  readonly newParentId?: DefinitionId;
}

/** Definition_Package。 */
export interface DefinitionPackage {
  readonly packageId: PackageId;
  readonly schemaVersion: string;
  readonly dependencies: readonly PackageDependency[];
  readonly sourceRecords: readonly SourceRecord[];
  readonly definitions: readonly CandidateDefinition[];
  readonly overrideIntent?: readonly OverrideIntent[];
  readonly removals?: readonly RemovalIntent[];
}

/** 已解析的组合组件。 */
export interface ResolvedComponent {
  readonly componentId: string;
  readonly role: string;
  readonly targetId?: DefinitionId;
  readonly parameters?: ParameterSchema;
  readonly optional: boolean;
  readonly typeDefining: boolean;
  readonly dependsOn: readonly string[];
}

/**
 * Resolved_Definition：注册表对外暴露的解析结果（Requirements 4.9–4.10）。
 * `resolvedFields` 按字段名规范化排序后固化为只读数组，避免依赖对象键序。
 */
export interface ResolvedDefinition {
  readonly id: DefinitionId;
  readonly defKind: L1DefKind;
  readonly abstract: boolean;
  readonly semanticFamily: SemanticFamilyId;
  /** 从根到自身的类型谱系。 */
  readonly typeLineage: readonly DefinitionId[];
  readonly typeIdentity: TypeIdentity;
  readonly resolvedFields: readonly ParameterField[];
  readonly nestedCapabilities: readonly ResolvedComponent[];
  readonly parameterSchema: ParameterSchema;
  readonly tags: readonly TagId[];
  readonly actionRefs: readonly TypedReference[];
  readonly ruleRefs: readonly TypedReference[];
  readonly otherRefs: readonly TypedReference[];
  readonly familyContract?: FamilyContract;
  readonly sourceRecords: readonly SourceRecord[];
  readonly originPackage: PackageId;
  readonly originSourceLocation?: SourceLocation;
  readonly presentation?: PresentationMetadata;
}

/** 只读已解析定义（`query` 的返回类型）。 */
export type ReadOnlyResolvedDefinition = ResolvedDefinition;

/**
 * `Equivalent_Definition`：忽略键序与非语义格式差异后具有相同类型、参数、引用与约束的定义。
 * 等价性由 `registry/canonical-snapshot.ts` 的规范化序列化比较实现。
 */
export type EquivalentDefinition = ResolvedDefinition;

/** 字段名到已解析字段的查找辅助。 */
export function findResolvedField(
  definition: ResolvedDefinition,
  name: FieldName,
): ParameterField | undefined {
  return definition.resolvedFields.find((field) => field.name === name);
}

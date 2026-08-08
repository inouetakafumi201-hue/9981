/**
 * L2 Model: 参数 Schema 原语。
 *
 * 对应 Requirements 5.1–5.12、design.md 的 `Parameter_Schema` / `Parameter_Field` 数据模型。
 *
 * 关键区分：
 * - `Gameplay_Value`      具体玩法平衡赋值 —— L2 只声明字段接口，具体值归 L3。
 * - `Structural_Bound`    保证类型结构 / 认知上限 / 引擎不变量的规范限制，必须带权威来源与结构理由。
 * - `Constitutional_Constant` 由 L0 固定，必须带来源标识、归属层与适用字段。
 * - `Internal_Metric`     回合编号、实体数量、距离、结算预算、性能统计等系统数值；不套用 1–5。
 */

import type { FieldName, HumanReadableText, SemanticFamilyId, UnitId } from './ids.js';
import type { JsonValue } from './json.js';
import type { OwningLayer, SourceRecord } from './source.js';
import type { L1DefKind } from './def-kind.js';

/** 数值/字段分类（Requirements 5.7 要求四者之一必须存在）。 */
export const PARAMETER_CLASSIFICATIONS = [
  'Gameplay_Value',
  'Structural_Bound',
  'Constitutional_Constant',
  'Internal_Metric',
] as const;
export type ParameterClassification = (typeof PARAMETER_CLASSIFICATIONS)[number];

/** 声明类型。 */
export const DECLARED_TYPES = [
  'string',
  'number',
  'integer',
  'boolean',
  'enum',
  'reference',
  'object',
  'array',
] as const;
export type DeclaredType = (typeof DECLARED_TYPES)[number];

/** 数值型声明类型集合（决定是否需要数值分类校验）。 */
export const NUMERIC_DECLARED_TYPES: ReadonlySet<DeclaredType> = Object.freeze(
  new Set<DeclaredType>(['number', 'integer']),
);

/** 声明值域。空对象表示"未声明范围"，不表示"无限制"。 */
export interface DeclaredRange {
  readonly min?: number;
  readonly max?: number;
  readonly exclusiveMin?: boolean;
  readonly exclusiveMax?: boolean;
  readonly step?: number;
}

/** 期望引用目标类型。至少要声明 defKind 或 semanticFamily 之一。 */
export interface ExpectedReferenceType {
  readonly defKind?: L1DefKind;
  readonly semanticFamily?: SemanticFamilyId;
  /** 允许目标为抽象定义（继承/引用场景）；实例目标必须为 false。 */
  readonly allowAbstract: boolean;
}

/**
 * Requirements 5.8 点名的、禁止在 L2 内嵌具体赋值的玩法数值类别。
 * L2 可以声明"这里有一个伤害表接口"，但不能填表。
 */
export const GAMEPLAY_VALUE_KINDS = [
  'damage-table',
  'probability-table',
  'ap-price-table',
  'duration',
  'recovery-amount',
  'capacity',
  'threshold',
  'other',
] as const;
export type GameplayValueKind = (typeof GAMEPLAY_VALUE_KINDS)[number];

/** 内部度量的自有 Schema（Requirements 5.6）。 */
export interface InternalMetricSchema {
  /** 度量类别：回合编号、实体数量、距离、结算预算、性能统计等。 */
  readonly metric: string;
  readonly range?: DeclaredRange;
  readonly integral: boolean;
}

/** Parameter_Field：design.md 数据模型的直接实现。 */
export interface ParameterField {
  readonly name: FieldName;
  readonly dataType: DeclaredType;
  readonly unit?: UnitId;
  readonly required: boolean;
  readonly referenceTarget?: ExpectedReferenceType;
  readonly classification: ParameterClassification;
  readonly range?: DeclaredRange;
  readonly authoritativeSource?: SourceRecord;
  readonly structuralRationale?: HumanReadableText;

  /** `enum` 类型的取值集合。 */
  readonly enumValues?: readonly string[];
  /** `array` 类型的元素类型。 */
  readonly itemType?: DeclaredType;
  /** `object` 类型的嵌套字段。 */
  readonly objectFields?: readonly ParameterField[];

  /**
   * 玩法数值的具体类别（仅声明接口形状，不含赋值）。
   * `classification === 'Gameplay_Value'` 时必填。
   */
  readonly gameplayValueKind?: GameplayValueKind;
  /**
   * 该玩法数值是否玩家可见。
   * `classification === 'Gameplay_Value'` 时必填：玩家可见值受 L0 的 1–5 宪法约束；
   * 非玩家可见值必须带 `authoritativeSource` 说明其不受该约束的依据，
   * 否则无法与"用 playerVisible=false 绕过 1–5"区分开。
   */
  readonly playerVisible?: boolean;
  /** 宪法常量的归属层（Requirements 5.4）。 */
  readonly owningLayer?: OwningLayer;
  /** 内部度量的自有 Schema（Requirements 5.6）。 */
  readonly internalMetricSchema?: InternalMetricSchema;
  /**
   * 字段默认值。
   * `Gameplay_Value` 字段出现默认值即为在 L2 内嵌具体玩法赋值，必须拒绝。
   */
  readonly defaultValue?: JsonValue;
  readonly description?: HumanReadableText;
}

/** 跨字段约束引用。 */
export interface ConstraintReference {
  readonly constraintId: string;
  /** 参与该约束的字段名，必须都出现在同一 Schema 中。 */
  readonly fields: readonly FieldName[];
  /** L1 布尔表达式定义引用；L2 不实现求值。 */
  readonly exprRef?: string;
  readonly reason: HumanReadableText;
}

/** Parameter_Schema：design.md 数据模型的直接实现。 */
export interface ParameterSchema {
  readonly fields: readonly ParameterField[];
  readonly crossFieldConstraints: readonly ConstraintReference[];
}

export const EMPTY_PARAMETER_SCHEMA: ParameterSchema = Object.freeze({
  fields: Object.freeze([]) as readonly ParameterField[],
  crossFieldConstraints: Object.freeze([]) as readonly ConstraintReference[],
});

/**
 * 玩法数值赋值：由 L3 Profile 提供。
 * L2 定义中出现非空赋值集合即违反 Requirements 2.1 / 5.2 / 5.8。
 */
export interface GameplayValueAssignment {
  readonly field: FieldName;
  readonly value: JsonValue;
  readonly playerVisible: boolean;
  readonly owningProfile: string;
}

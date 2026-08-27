/**
 * L2 Compiler: 编译输出类型。
 *
 * 对应 design.md `Specification_Compiler` 与 Requirements 1、5.11–5.12、16。
 */

import type { Diagnostic } from '../model/diagnostic';
import type { SemanticFamilyRegistration } from '../model/definition';
import type {
  EligibilityVerdict,
  HistoricalExampleEntry,
  L3ProfileEntry,
  NormativeContract,
  NumericExample,
  NumericExampleClassification,
  OwningLayer,
  SourceClassificationKind,
  SourceRecord,
  SourceStatement,
  UnresolvedItem,
} from '../model/source';

/** 单个数值示例的分类结果（Requirements 5.11–5.12）。 */
export interface NumericExampleOutcome {
  readonly example: NumericExample;
  readonly classification: NumericExampleClassification;
  readonly diagnostics: readonly Diagnostic[];
}

/** 单条来源陈述的分类结果。 */
export interface SourceClassificationOutcome {
  readonly claimKey: string;
  readonly statement: SourceStatement;
  readonly classification: SourceClassificationKind;
  readonly owningLayer: OwningLayer;
  /** 三判据判定（仅当该陈述提议登记新语义族时存在）。 */
  readonly eligibilityVerdict?: EligibilityVerdict;
  /** 三判据通过时生成的族登记体。 */
  readonly registration?: SemanticFamilyRegistration;
  readonly numericOutcomes: readonly NumericExampleOutcome[];
  readonly diagnostics: readonly Diagnostic[];
}

/** 冲突裁决结果。 */
export interface ConflictResolution {
  readonly claimKey: string;
  readonly outcome: NormativeContract | UnresolvedItem;
  readonly diagnostics: readonly Diagnostic[];
}

export function isUnresolvedOutcome(
  outcome: NormativeContract | UnresolvedItem,
): outcome is UnresolvedItem {
  return (outcome as UnresolvedItem).statements !== undefined;
}

/** Compiled_Specification：验证器消费的规范模型。 */
export interface CompiledSpecification {
  readonly normativeContracts: readonly NormativeContract[];
  readonly l3Profiles: readonly L3ProfileEntry[];
  readonly historicalExamples: readonly HistoricalExampleEntry[];
  readonly unresolvedItems: readonly UnresolvedItem[];
  readonly registeredFamilies: readonly SemanticFamilyRegistration[];
  readonly classifications: readonly SourceClassificationOutcome[];
  readonly sourceRecords: readonly SourceRecord[];
  readonly diagnostics: readonly Diagnostic[];
  /** 规范化指纹：同一输入集合（任意排列）必须得到相同指纹。 */
  readonly fingerprint: string;
}

export const EMPTY_COMPILED_SPECIFICATION: CompiledSpecification = Object.freeze({
  normativeContracts: Object.freeze([]) as readonly NormativeContract[],
  l3Profiles: Object.freeze([]) as readonly L3ProfileEntry[],
  historicalExamples: Object.freeze([]) as readonly HistoricalExampleEntry[],
  unresolvedItems: Object.freeze([]) as readonly UnresolvedItem[],
  registeredFamilies: Object.freeze([]) as readonly SemanticFamilyRegistration[],
  classifications: Object.freeze([]) as readonly SourceClassificationOutcome[],
  sourceRecords: Object.freeze([]) as readonly SourceRecord[],
  diagnostics: Object.freeze([]) as readonly Diagnostic[],
  fingerprint: '',
});

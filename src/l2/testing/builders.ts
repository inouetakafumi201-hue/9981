/**
 * L2 Testing: 各语义族的最小有效定义构造器（编程式，非 JSON）。
 *
 * 这些构造器产出通过全部验证器的最小合法定义，作为生成器与测试的基线。
 * 生成器在此基础上做"有针对性的损坏"以产出无效输入并断言对应诊断。
 *
 * 不硬编码任何具名玩法实例（不出现"霰弹枪"等）；标识符用中性的族前缀 + 序号。
 */

import type {
  BaseDefinition,
  CandidateDefinition,
  DefinitionPackage,
} from '../model/definition.js';
import { EMPTY_PARAMETER_SCHEMA, type ParameterField } from '../model/schema.js';
import { EMPTY_TYPE_IDENTITY, type TypeIdentity, type TypedReference } from '../model/reference.js';
import type { SourceRecord } from '../model/source.js';
import type { FamilyContract } from '../model/family-contracts.js';

/** 一条中性的基类层 Source_Record。 */
export function baseSourceRecord(fingerprint: string): SourceRecord {
  return {
    sourceFile: 'docs/L2_基类层/基类层定义.md',
    sourceLocation: { sourceFile: 'docs/L2_基类层/基类层定义.md', section: `测试来源:${fingerprint}` },
    precedence: 'finalized-l2-contract',
    classification: 'Normative_Contract',
    owningLayer: '基类层',
    statementFingerprint: fingerprint,
  };
}

/** 一个非空 Type_Identity（保证子类型有类型身份差异）。 */
export function capabilityIdentity(...capabilities: readonly string[]): TypeIdentity {
  return {
    ...EMPTY_TYPE_IDENTITY,
    requiredCapabilities: capabilities,
  };
}

/** 引用构造器。 */
export function typedRef(
  refId: string,
  role: string,
  options?: { readonly defKind?: BaseDefinition['defKind']; readonly semanticFamily?: string; readonly allowAbstract?: boolean; readonly required?: boolean; readonly jsonPath?: string },
): TypedReference {
  return {
    refId,
    role,
    expected: {
      allowAbstract: options?.allowAbstract ?? false,
      ...(options?.defKind === undefined ? {} : { defKind: options.defKind }),
      ...(options?.semanticFamily === undefined ? {} : { semanticFamily: options.semanticFamily }),
    },
    required: options?.required ?? true,
    jsonPath: options?.jsonPath ?? `/ref/${refId}`,
  };
}

/** 基础定义骨架。 */
export function baseDefinition(overrides: Partial<BaseDefinition> & Pick<BaseDefinition, 'id' | 'defKind' | 'semanticFamily'>): CandidateDefinition {
  return {
    abstract: false,
    typeIdentity: EMPTY_TYPE_IDENTITY,
    composition: [],
    parameterSchema: EMPTY_PARAMETER_SCHEMA,
    tags: [],
    actionRefs: [],
    ruleRefs: [],
    otherRefs: [],
    sourceRecords: [baseSourceRecord(overrides.id)],
    jsonPath: `/definitions/${overrides.id}`,
    ...overrides,
  };
}

/** 中性字段构造器。 */
export function gameplayField(name: string, playerVisible: boolean): ParameterField {
  return {
    name,
    dataType: 'number',
    required: false,
    classification: 'Gameplay_Value',
    gameplayValueKind: 'duration',
    playerVisible,
  };
}

export function internalMetricField(name: string): ParameterField {
  return {
    name,
    dataType: 'integer',
    required: false,
    classification: 'Internal_Metric',
    internalMetricSchema: { metric: 'count', integral: true },
  };
}

/** 单定义包。 */
export function singleDefinitionPackage(
  packageId: string,
  definition: CandidateDefinition,
  extra?: Partial<DefinitionPackage>,
): DefinitionPackage {
  return {
    packageId,
    schemaVersion: 'l2-declarative/1',
    dependencies: [],
    sourceRecords: [baseSourceRecord(packageId)],
    definitions: [definition],
    ...extra,
  };
}

/** 多定义包。 */
export function multiDefinitionPackage(
  packageId: string,
  definitions: readonly CandidateDefinition[],
  extra?: Partial<DefinitionPackage>,
): DefinitionPackage {
  return {
    packageId,
    schemaVersion: 'l2-declarative/1',
    dependencies: [],
    sourceRecords: [baseSourceRecord(packageId)],
    definitions: [...definitions],
    ...extra,
  };
}

// ── 每个族的最小有效 familyContract ────────────────────────────────────────

/**
 * 这些最小有效契约的效果/管线引用都用 `required: false`，
 * 使定义**自包含**：单独装入一个包即可通过引用解析与原子激活，
 * 无需额外提供被引用目标。缺失必需引用的场景由 Property 8 的专用夹具单独覆盖。
 */
export function validActionContract(effectRefId: string): FamilyContract {
  return {
    contractKind: 'action',
    costCategory: 'paid',
    apCost: 1,
    actorRequirements: [],
    targetRequirements: [],
    effectRefs: [typedRef(effectRefId, 'effect', { defKind: 'rule', required: false })],
    interruptionConditionRefs: [],
    completionState: 'done',
    availableAsDecisionBranch: true,
    requiresHookIntegration: false,
    opMapping: { opId: 'prop.add', argumentMapping: [{ opArgument: 'target', source: 'target' }] },
  };
}

export function validConditionGateway(exprRefId: string, effectRefId: string): FamilyContract {
  return {
    contractKind: 'gateway',
    gatewayKind: 'condition',
    condition: {
      conditionExprRef: typedRef(exprRefId, 'expr', { defKind: 'expr', required: false }),
      successEffectRefs: [typedRef(effectRefId, 'effect', { defKind: 'rule', required: false })],
      failureEffectRefs: [typedRef(effectRefId, 'effect', { defKind: 'rule', required: false })],
    },
  };
}

export function validDamageContract(pipelineRefId: string): FamilyContract {
  return {
    contractKind: 'damage',
    damageCategory: 'physical',
    sourceRequirements: [],
    targetRequirements: [],
    settlementPipelineRefs: [typedRef(pipelineRefId, 'rule', { defKind: 'rule', required: false })],
  };
}

export function validStatusContract(effectRefId: string): FamilyContract {
  return {
    contractKind: 'status',
    durationMode: 'turns',
    stackMode: 'refresh',
    triggerRefs: [],
    interruptionRefs: [],
    effectRefs: [typedRef(effectRefId, 'effect', { defKind: 'rule', required: false })],
    interactions: [],
  };
}

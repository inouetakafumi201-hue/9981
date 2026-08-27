/**
 * 验证基线（design.md「Validation baseline and pipeline」/ 需求 13.1、13.5、13.6、15.5）。
 *
 * 基线是"这次验证依据了哪一套上游事实"的不可变快照。提交前必须逐字段重新比较：任何一项变化都
 * 使产物过期，必须从原始候选完整重验，而不是局部更新产物（需求 13.6）。
 */
import type { FingerprintField, StableFingerprintGateway } from './fingerprint';
import { fingerprintFields } from './fingerprint';

export interface ValidationBaselineComponents {
  /** 目标定义注册表的版本令牌。 */
  readonly definitionRegistryVersion: string;
  /** Schema 目录版本。 */
  readonly schemaCatalogVersion: string;
  /** 跨领域契约目录的总指纹（内容派生，见 contracts/）。 */
  readonly integrationContractFingerprint: string;
  /** 诊断代码目录版本（由 ERR_CODES + HINT_TEMPLATES 内容派生，见 diagnostics/）。 */
  readonly diagnosticCatalogVersion: string;
  readonly quotaProfileId: string;
  readonly quotaProfileVersion: string;
}

export interface ValidationBaseline extends ValidationBaselineComponents {
  /** 全部组成 + 指纹算法标识的总指纹。 */
  readonly fingerprint: string;
}

export const BASELINE_COMPONENT_FIELDS = [
  'definitionRegistryVersion',
  'schemaCatalogVersion',
  'integrationContractFingerprint',
  'diagnosticCatalogVersion',
  'quotaProfileId',
  'quotaProfileVersion',
] as const;

export type BaselineComponentField = (typeof BASELINE_COMPONENT_FIELDS)[number];

/** 含总指纹的完整比较字段集。`fingerprint` 独立参与比较，可捕获组成相同但指纹算法变化的情形。 */
export const BASELINE_COMPARISON_FIELDS = [...BASELINE_COMPONENT_FIELDS, 'fingerprint'] as const;

export type BaselineComparisonField = (typeof BASELINE_COMPARISON_FIELDS)[number];

export const BASELINE_DOMAIN = 'ugc.validation-baseline.v1';

function componentValue(components: ValidationBaselineComponents, field: BaselineComponentField): string {
  switch (field) {
    case 'definitionRegistryVersion':
      return components.definitionRegistryVersion;
    case 'schemaCatalogVersion':
      return components.schemaCatalogVersion;
    case 'integrationContractFingerprint':
      return components.integrationContractFingerprint;
    case 'diagnosticCatalogVersion':
      return components.diagnosticCatalogVersion;
    case 'quotaProfileId':
      return components.quotaProfileId;
    case 'quotaProfileVersion':
      return components.quotaProfileVersion;
  }
}

export function encodeBaselineFields(
  components: ValidationBaselineComponents,
  algorithmId: string,
): readonly FingerprintField[] {
  const fields: FingerprintField[] = BASELINE_COMPONENT_FIELDS.map((field) => ({
    label: field,
    value: componentValue(components, field),
  }));
  fields.push({ label: 'fingerprintAlgorithmId', value: algorithmId });
  return fields;
}

/**
 * 由组成派生不可变基线。相同依赖快照必然产生相同 `fingerprint`；任何一项变化都改变它。
 */
export function createValidationBaseline(
  gateway: StableFingerprintGateway,
  components: ValidationBaselineComponents,
): ValidationBaseline {
  const fingerprint = fingerprintFields(
    gateway,
    BASELINE_DOMAIN,
    encodeBaselineFields(components, gateway.algorithmId),
  );
  return Object.freeze({
    definitionRegistryVersion: components.definitionRegistryVersion,
    schemaCatalogVersion: components.schemaCatalogVersion,
    integrationContractFingerprint: components.integrationContractFingerprint,
    diagnosticCatalogVersion: components.diagnosticCatalogVersion,
    quotaProfileId: components.quotaProfileId,
    quotaProfileVersion: components.quotaProfileVersion,
    fingerprint,
  });
}

export interface BaselineFieldMismatch {
  readonly field: BaselineComparisonField;
  readonly expected: string;
  readonly actual: string;
}

function comparisonValue(baseline: ValidationBaseline, field: BaselineComparisonField): string {
  return field === 'fingerprint' ? baseline.fingerprint : componentValue(baseline, field);
}

/**
 * 逐字段比较基线。返回空数组表示基线仍然当前。
 *
 * 注意：这里比较的是值，而不是对象引用。设计要求"任何真实依赖变化不能被相同对象引用或时间顺序掩盖"，
 * 因此即使调用方传入同一个对象，也必须走同样的取值比较路径。
 */
export function diffValidationBaselines(
  expected: ValidationBaseline,
  actual: ValidationBaseline,
): readonly BaselineFieldMismatch[] {
  const mismatches: BaselineFieldMismatch[] = [];
  for (const field of BASELINE_COMPARISON_FIELDS) {
    const expectedValue = comparisonValue(expected, field);
    const actualValue = comparisonValue(actual, field);
    if (expectedValue !== actualValue) {
      mismatches.push({ field, expected: expectedValue, actual: actualValue });
    }
  }
  return Object.freeze(mismatches);
}

export function baselinesEqual(expected: ValidationBaseline, actual: ValidationBaseline): boolean {
  return diffValidationBaselines(expected, actual).length === 0;
}

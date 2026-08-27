/**
 * 变更请求绑定与请求指纹（design.md「Schema migration and canonicalization」/ 需求 3.8、13.12、13.13）。
 *
 * 绑定回答的是"哪份来源文档对哪个注册表执行什么变更"。它刻意**不含** `source.kind`、`sourceName`
 * 和 `receivedAtSequence`：这三者是审计与展示信息，改变它们不应改变语义身份，否则同一份候选经不同
 * Adapter 提交就会得到不同请求指纹，与需求 3.10 的跨来源等价性直接冲突。
 *
 * 反过来，内容相同但来源文档、来源包、目标层、操作或预期目标不同的请求**必须**得到不同指纹，
 * 否则一次验证的产物就能授权另一个请求（需求 13.13 明确禁止）。
 */
import type { ChangeOperation, TargetOwnership } from './candidate';
import type { FingerprintField, StableFingerprintGateway } from './fingerprint';
import { fingerprintFields } from './fingerprint';

export interface ChangeRequestBinding {
  /** 仅由规范化内容派生的候选指纹。 */
  readonly candidateFingerprint: string;
  readonly sourcePackageId: string;
  readonly sourceDocumentId: string;
  readonly targetOwnership: TargetOwnership;
  readonly operation: ChangeOperation;
  /** 可选预期目标；缺省规范化为显式 `null`，与空字符串严格区分。 */
  readonly expectedTargetId: string | null;
}

/** 参与请求指纹的字段顺序。顺序固定，任何调整都必须提升 `CHANGE_REQUEST_DOMAIN` 版本。 */
export const CHANGE_REQUEST_BINDING_FIELDS = [
  'candidateFingerprint',
  'sourcePackageId',
  'sourceDocumentId',
  'targetOwnership',
  'operation',
  'expectedTargetId',
] as const;

export type ChangeRequestBindingField = (typeof CHANGE_REQUEST_BINDING_FIELDS)[number];

export const CHANGE_REQUEST_DOMAIN = 'ugc.change-request.v1';

export function createChangeRequestBinding(input: ChangeRequestBinding): ChangeRequestBinding {
  return Object.freeze({
    candidateFingerprint: input.candidateFingerprint,
    sourcePackageId: input.sourcePackageId,
    sourceDocumentId: input.sourceDocumentId,
    targetOwnership: input.targetOwnership,
    operation: input.operation,
    expectedTargetId: input.expectedTargetId,
  });
}

function bindingFieldValue(binding: ChangeRequestBinding, field: ChangeRequestBindingField): string | null {
  switch (field) {
    case 'candidateFingerprint':
      return binding.candidateFingerprint;
    case 'sourcePackageId':
      return binding.sourcePackageId;
    case 'sourceDocumentId':
      return binding.sourceDocumentId;
    case 'targetOwnership':
      return binding.targetOwnership;
    case 'operation':
      return binding.operation;
    case 'expectedTargetId':
      return binding.expectedTargetId;
  }
}

export function encodeChangeRequestBindingFields(binding: ChangeRequestBinding): readonly FingerprintField[] {
  return CHANGE_REQUEST_BINDING_FIELDS.map((field) => ({
    label: field,
    value: bindingFieldValue(binding, field),
  }));
}

/** 从绑定重新派生请求指纹。提交前必须重算并与产物携带的摘要逐字段核对（需求 13.12）。 */
export function computeChangeRequestFingerprint(
  gateway: StableFingerprintGateway,
  binding: ChangeRequestBinding,
): string {
  return fingerprintFields(gateway, CHANGE_REQUEST_DOMAIN, encodeChangeRequestBindingFields(binding));
}

export interface BindingFieldMismatch {
  readonly field: ChangeRequestBindingField;
  readonly expected: string | null;
  readonly actual: string | null;
}

/** 字段级比较。返回空数组表示两个绑定在每个语义字段上都相同。 */
export function diffChangeRequestBindings(
  expected: ChangeRequestBinding,
  actual: ChangeRequestBinding,
): readonly BindingFieldMismatch[] {
  const mismatches: BindingFieldMismatch[] = [];
  for (const field of CHANGE_REQUEST_BINDING_FIELDS) {
    const expectedValue = bindingFieldValue(expected, field);
    const actualValue = bindingFieldValue(actual, field);
    if (expectedValue !== actualValue) {
      mismatches.push({ field, expected: expectedValue, actual: actualValue });
    }
  }
  return Object.freeze(mismatches);
}

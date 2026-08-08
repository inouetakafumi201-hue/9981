/**
 * 不可伪造验证产物的铸造与守卫（design.md「Validated artifact」/ 需求 3.4-3.9、13.1-13.4、13.12-13.13；tasks.md 8.1）。
 *
 * 两道锁配合：
 * - **编译期**：`ValidatedChangeSet` 的 brand 是 `declare const` 的 unique symbol（见 model 层），
 *   模块外无法构造满足该接口的对象字面量。
 * - **运行期**：本模块的模块私有 `WeakSet` 只记录**本工厂铸造过**的实例。用 `as` 强转出来的对象
 *   通不过 `isMintedValidatedChangeSet`，因此类型断言换不来激活资格。
 *
 * 工厂**不从公共导出根暴露**（见 `src/core/ugc/index.ts` 的架构测试断言）。
 *
 * 另一条容易被绕过的路：调用方自己算一个 `changeRequestFingerprint` 递进来。这里不信任传入摘要——
 * 工厂**从封存的绑定重新计算**并逐字段核对（需求 13.12）。
 */
import type { Diagnostic } from '../../kernel/state/diagnostic.js';
import type { ChangeRequestBinding } from '../model/binding.js';
import { computeChangeRequestFingerprint, diffChangeRequestBindings } from '../model/binding.js';
import type { CanonicalizedChangeRequest } from '../model/canonical-types.js';
import type { StableFingerprintGateway } from '../model/fingerprint.js';
import type { PresentationFallbackDecision } from '../model/presentation.js';
import { isSemanticsPreserving } from '../model/presentation.js';
import type { ValidationBaseline } from '../model/baseline.js';
import { isBlockingDiagnostic } from '../model/result.js';
import type { UpstreamResolvedReferenceGraph, UpstreamValidatedCandidate } from '../model/upstream.js';
import type { ValidatedChangeSet } from '../model/validated-change-set.js';

/** 模块私有铸造登记表。WeakSet 不阻止回收，也无法从外部枚举或写入。 */
const minted = new WeakSet<object>();

export function isMintedValidatedChangeSet(candidate: unknown): candidate is ValidatedChangeSet {
  return typeof candidate === 'object' && candidate !== null && minted.has(candidate);
}

export interface MintInput {
  readonly request: CanonicalizedChangeRequest;
  readonly baseline: ValidationBaseline;
  readonly upstreamValidated: UpstreamValidatedCandidate;
  readonly resolvedReferences: UpstreamResolvedReferenceGraph;
  readonly presentationDecisions: readonly PresentationFallbackDecision[];
  readonly diagnostics: readonly Diagnostic[];
  readonly fingerprint: StableFingerprintGateway;
}

export type MintFailureReason =
  | 'blocking-diagnostics-present'
  | 'request-fingerprint-mismatch'
  | 'binding-mismatch'
  | 'candidate-fingerprint-mismatch'
  | 'target-ownership-mismatch'
  | 'presentation-semantics-changed';

export type MintResult =
  | { readonly ok: true; readonly artifact: ValidatedChangeSet }
  | { readonly ok: false; readonly reason: MintFailureReason; readonly detail: string };

/**
 * 铸造验证产物。只在全部强制阶段成功、零阻断诊断、引用图完整、表现回退语义不变时成功。
 */
export function mintValidatedChangeSet(input: MintInput): MintResult {
  if (input.diagnostics.some(isBlockingDiagnostic)) {
    return {
      ok: false,
      reason: 'blocking-diagnostics-present',
      detail: '存在 error 或 fatal 级诊断，不能铸造验证产物。',
    };
  }

  for (const decision of input.presentationDecisions) {
    if (!isSemanticsPreserving(decision)) {
      return {
        ok: false,
        reason: 'presentation-semantics-changed',
        detail: `表现回退 ${decision.definitionId}${decision.jsonPath} 改变了语义指纹。`,
      };
    }
  }

  const binding: ChangeRequestBinding = input.request.binding;

  // 候选内容指纹必须与绑定一致：绑定是"哪份内容对哪个注册表做什么"，两者脱钩即失效。
  if (binding.candidateFingerprint !== input.request.candidate.canonicalFingerprint) {
    return {
      ok: false,
      reason: 'candidate-fingerprint-mismatch',
      detail: `绑定中的候选指纹 ${binding.candidateFingerprint} 与规范化内容指纹 ${input.request.candidate.canonicalFingerprint} 不一致。`,
    };
  }

  if (binding.targetOwnership !== input.request.candidate.targetOwnership) {
    return {
      ok: false,
      reason: 'target-ownership-mismatch',
      detail: `绑定目标层 ${binding.targetOwnership} 与候选目标层 ${input.request.candidate.targetOwnership} 不一致。`,
    };
  }

  // 逐字段核对绑定与候选来源身份，而不是只信任调用方给的摘要。
  const expectedBinding: ChangeRequestBinding = {
    candidateFingerprint: input.request.candidate.canonicalFingerprint,
    sourcePackageId: input.request.candidate.source.packageId,
    sourceDocumentId: input.request.candidate.source.documentId,
    targetOwnership: input.request.candidate.targetOwnership,
    operation: binding.operation,
    expectedTargetId: binding.expectedTargetId,
  };
  const bindingDiff = diffChangeRequestBindings(expectedBinding, binding);
  if (bindingDiff.length > 0) {
    return {
      ok: false,
      reason: 'binding-mismatch',
      detail: bindingDiff
        .map((entry) => `${entry.field}: 期望 ${String(entry.expected)}，实际 ${String(entry.actual)}`)
        .join('；'),
    };
  }

  // 从封存绑定重算请求指纹，不采信调用方传入的值。
  const recomputed = computeChangeRequestFingerprint(input.fingerprint, binding);
  if (recomputed !== input.request.changeRequestFingerprint) {
    return {
      ok: false,
      reason: 'request-fingerprint-mismatch',
      detail: `重算的请求指纹 ${recomputed} 与请求携带的 ${input.request.changeRequestFingerprint} 不一致。`,
    };
  }

  const artifact = Object.freeze({
    candidateFingerprint: input.request.candidate.canonicalFingerprint,
    changeRequestFingerprint: recomputed,
    changeRequestBinding: binding,
    baselineFingerprint: input.baseline.fingerprint,
    targetOwnership: input.request.candidate.targetOwnership,
    upstreamValidated: input.upstreamValidated,
    resolvedReferences: input.resolvedReferences,
    presentationDecisions: Object.freeze([...input.presentationDecisions]),
    warnings: Object.freeze(input.diagnostics.filter((entry) => !isBlockingDiagnostic(entry))),
  }) as unknown as ValidatedChangeSet;

  minted.add(artifact);
  return { ok: true, artifact };
}

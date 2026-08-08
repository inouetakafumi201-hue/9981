/**
 * 唯一公共入口（design.md「UGCIngressFacade」/ 需求 1.1-1.10、3.1-3.10、13.1-13.13；tasks.md 9.1）。
 *
 * Facade 只有两个方法，且刻意**没有**这些东西：
 * `force`、`skipValidation`、`trustedSource`、`activateWithErrors`、直接的 registry 方法、
 * `WorldState`/`OpRegistry`/Hook/事务/持久化句柄。编辑后必须重新 `validate`（需求 3.7、3.9）。
 *
 * `activate` 只接受 `validate` 成功时返回的产物。即便调用方用类型断言伪造一个同形对象，
 * 也过不了 activation 内部的 WeakSet 铸造守卫（见 activation/validated-change-set.ts）。
 *
 * 所有异常都在这里被转换为 scope 正确的结构化诊断——公共边界不抛出未处理异常，也不返回半状态
 * （tasks.md 9.1、11.5）。
 */
import type { UGCDiagnosticFactory } from '../diagnostics/factory.js';
import type { CandidateChangeRequest } from '../model/candidate.js';
import type { ActivationResult, ValidationReport } from '../model/report.js';
import type { ValidatedChangeSet } from '../model/validated-change-set.js';
import type { ValidationBaseline } from '../model/baseline.js';
import { createValidationBaseline } from '../model/baseline.js';
import type { StableFingerprintGateway } from '../model/fingerprint.js';
import { createQuotaBudget } from '../quota/quota-budget.js';
import type { TrustedQuotaProfile } from '../model/quota-types.js';
import type { UGCValidationCoordinator } from '../validation/coordinator.js';
import type { AtomicActivationCoordinator } from '../activation/atomic-activation-coordinator.js';

export interface UGCIngressFacade {
  validate(request: CandidateChangeRequest): ValidationReport;
  activate(validated: ValidatedChangeSet, baseline: ValidationBaseline): ActivationResult;
}

export interface FacadeDeps {
  readonly validation: UGCValidationCoordinator;
  readonly activation: AtomicActivationCoordinator;
  readonly factory: UGCDiagnosticFactory;
  readonly fingerprint: StableFingerprintGateway;
  readonly quotaProfile: TrustedQuotaProfile;
}

/**
 * 兜底基线。只在 `validate` 自身抛出异常、连基线都没能采集到时使用。
 *
 * 它必须是一个**不可能与任何真实基线相等**的值，否则一个内部崩溃产出的报告可能被误当作
 * 针对某个真实基线的有效结果。这里用固定的 `internal-error` 标记达到该目的。
 */
function crashBaseline(fingerprint: StableFingerprintGateway): ValidationBaseline {
  return createValidationBaseline(fingerprint, {
    definitionRegistryVersion: 'internal-error',
    schemaCatalogVersion: 'internal-error',
    integrationContractFingerprint: 'internal-error',
    diagnosticCatalogVersion: 'internal-error',
    quotaProfileId: 'internal-error',
    quotaProfileVersion: 'internal-error',
  });
}

export function createUGCIngressFacade(deps: FacadeDeps): UGCIngressFacade {
  return Object.freeze({
    validate(request: CandidateChangeRequest): ValidationReport {
      try {
        return deps.validation.validate(request);
      } catch (thrown) {
        // 内部崩溃必须表现为"拒绝 + 可行动诊断"，绝不表现为异常或"通过"。
        const sourcePackage = request.document.source.packageId;
        return Object.freeze({
          baseline: crashBaseline(deps.fingerprint),
          candidateFingerprint: null,
          changeRequestFingerprint: null,
          changeRequestBinding: null,
          diagnostics: Object.freeze([
            deps.factory.host({
              selector: { category: 'ATOMIC_ACTIVATION', condition: 'activation-failed' },
              stage: 'ingress',
              sourcePackage,
              sourceSpan: null,
              message: `UGC validation crashed: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
              reason:
                'UGC 验证流水线内部出现未预期错误，本次候选按拒绝处理，活动状态未发生任何变化。',
              correctionSuggestion: '这是实现缺陷而非候选内容问题：请携带该候选与本诊断向维护者报告。',
              actual: thrown instanceof Error ? thrown.name : 'unknown',
            }),
          ]),
          skippedChecks: Object.freeze([]),
          budget: createQuotaBudget(deps.quotaProfile).snapshot(),
          status: 'rejected',
          validated: null,
        });
      }
    },

    activate(validated: ValidatedChangeSet, baseline: ValidationBaseline): ActivationResult {
      try {
        return deps.activation.activate(validated, baseline);
      } catch (thrown) {
        const sourcePackage = validated.changeRequestBinding?.sourcePackageId ?? 'unknown';
        return Object.freeze({
          status: 'rejected',
          baseline,
          candidateFingerprint: validated.candidateFingerprint ?? 'unknown',
          changeRequestFingerprint: validated.changeRequestFingerprint ?? 'unknown',
          diagnostics: Object.freeze([
            deps.factory.registry({
              selector: { category: 'ATOMIC_ACTIVATION', condition: 'activation-failed' },
              stage: 'activation-precheck',
              sourcePackage,
              message: `UGC activation crashed: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
              reason: '激活协调器内部出现未预期错误，激活按失败处理，上一份有效状态保持不变。',
              correctionSuggestion: '这是实现缺陷而非候选内容问题：请向维护者报告。',
              expectedBaseline: baseline.fingerprint,
              actualBaseline: baseline.fingerprint,
            }),
          ]),
          // 崩溃路径无法读取快照，因此用同一个标记值表达"前后一致、未发生变化"。
          previousSnapshotFingerprint: 'unknown',
          activeSnapshotFingerprint: 'unknown',
          unchanged: true,
        });
      }
    },
  });
}

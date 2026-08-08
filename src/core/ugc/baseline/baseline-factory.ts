/**
 * 验证基线捕获与提交前复检（design.md「Validation baseline」/ 需求 13.1、13.5-13.6、15.5、15.10）。
 *
 * 基线的全部意义在于"验证时依据的上游事实"与"提交时的上游事实"必须逐字段相同。因此这里刻意
 * **每次都重新向端口取值**，而不是缓存上次结果：缓存会让真实变化被同一个对象引用掩盖，
 * 正是需求 13.5 要防的情况。
 *
 * `ValidationBaseline` 的**类型与比较**在 `model/baseline.ts`（纯数据，DAG 根）；
 * 本模块负责**从端口采集**这些版本令牌，属于行为层。
 */
import type { UGCDiagnosticFactory } from '../diagnostics/factory.js';
import type { DiagnosticCodeCatalog } from '../diagnostics/code-catalog.js';
import type { Diagnostic } from '../../kernel/state/diagnostic.js';
import type { StableFingerprintGateway } from '../model/fingerprint.js';
import type { TrustedQuotaProfile } from '../model/quota-types.js';
import type { ValidationBaseline } from '../model/baseline.js';
import { createValidationBaseline, diffValidationBaselines } from '../model/baseline.js';
import type { DefinitionRegistryGateway } from '../ports/definition-ports.js';
import type { SchemaVersionCatalog } from '../ports/schema-ports.js';
import type { IntegrationContractCatalog } from '../contracts/integration-contract-catalog.js';

export interface BaselineSources {
  readonly registry: DefinitionRegistryGateway;
  readonly schemaCatalog: SchemaVersionCatalog;
  readonly contracts: IntegrationContractCatalog;
  readonly diagnosticCatalog: DiagnosticCodeCatalog;
  readonly quotaProfile: TrustedQuotaProfile;
  readonly fingerprint: StableFingerprintGateway;
}

/**
 * 采集当前基线。
 *
 * 注意 `registry.readSnapshot()` 每次都真实调用：注册表版本是最容易在验证与提交之间变化的一项，
 * 复用旧快照会让 stale-baseline 检测彻底失效。
 */
export function captureBaseline(sources: BaselineSources): ValidationBaseline {
  const snapshot = sources.registry.readSnapshot();
  return createValidationBaseline(sources.fingerprint, {
    definitionRegistryVersion: snapshot.registryVersion,
    schemaCatalogVersion: sources.schemaCatalog.catalogVersion,
    integrationContractFingerprint: sources.contracts.snapshot().fingerprint,
    diagnosticCatalogVersion: sources.diagnosticCatalog.version,
    quotaProfileId: sources.quotaProfile.profileId,
    quotaProfileVersion: sources.quotaProfile.version,
  });
}

/**
 * 提交前复检：重新采集基线并与产物携带的期望基线逐字段比较。
 *
 * 返回空数组表示基线仍当前。任何一项不同都产生 registry-scope 的 `E_LOAD_BASELINE_STALE`，
 * 并要求**从原始候选完整重验**——不允许局部更新产物（需求 13.6）。
 */
export function recheckBaseline(
  sources: BaselineSources,
  expected: ValidationBaseline,
  factory: UGCDiagnosticFactory,
  sourcePackage: string,
): readonly Diagnostic[] {
  const actual = captureBaseline(sources);
  const mismatches = diffValidationBaselines(expected, actual);
  if (mismatches.length === 0) return Object.freeze([]);

  return Object.freeze(
    mismatches.map((mismatch) =>
      factory.registry({
        selector: { category: 'ATOMIC_ACTIVATION', condition: 'baseline-stale' },
        stage: 'activation-precheck',
        sourcePackage,
        message: `Validation baseline field ${mismatch.field} changed before commit.`,
        reason:
          `验证基线的 ${mismatch.field} 在验证之后、提交之前发生了变化` +
          `（验证时 ${mismatch.expected}，提交时 ${mismatch.actual}）。该验证结果已过期。`,
        correctionSuggestion: '请基于最新的活动状态从原始候选重新完整验证后再提交，不要复用旧的验证结果。',
        expectedBaseline: mismatch.expected,
        actualBaseline: mismatch.actual,
        messageArgs: { field: mismatch.field },
      }),
    ),
  );
}

/**
 * 单一验证流水线（design.md「Validation baseline and pipeline」/ 需求 3.2-3.10、13.1-13.2、14.5-14.12）。
 *
 * 阶段 DAG：
 *   ingress → decode → schema-migration → canonicalize → request-binding → baseline
 *   → definition-validation → reference-resolution → presentation-resolution → activation-precheck
 *
 * 设计要点：
 * - **不是"遇到第一个错误就终止"**。语法失败、配额耗尽、迁移图不可用这类**根错误**会阻断后续阶段，
 *   因为后续阶段没有安全、确定的输入可用；但同一阶段内彼此独立的错误全部聚合（需求 14.6）。
 * - 被阻断的检查不猜测输入，而是记录 `SkippedCheck` 并关联根诊断（需求 14.7）。
 * - 所有阶段共享同一个 QuotaBudget、DiagnosticFactory、CodeCatalog 和稳定排序，
 *   因此"同一候选 + 同一基线 + 同一配额"必然产出等价诊断与顺序（需求 14.9）。
 * - **没有来源专用分支**：`source.kind` 从不参与任何控制流判断。
 */
import type { Diagnostic } from '../../kernel/state/diagnostic';
import type { UGCDiagnosticFactory } from '../diagnostics/factory';
import { documentAnchorSpan } from '../diagnostics/factory';
import type { CandidateChangeRequest } from '../model/candidate';
import { isStableIdentity, isTargetOwnership } from '../model/candidate';
import { computeChangeRequestFingerprint, createChangeRequestBinding } from '../model/binding';
import type { StableFingerprintGateway } from '../model/fingerprint';
import type { CanonicalCandidate, CanonicalizedChangeRequest } from '../model/canonical-types';
import type { ChangeRequestBinding } from '../model/binding';
import type { IntegrationContractSnapshot } from '../model/contract-types';
import type { DefinitionRegistryReadSnapshot, UpstreamValidatedCandidate } from '../model/upstream';
import type { QuotaBudget, TrustedQuotaProfile } from '../model/quota-types';
import type { ValidationReport } from '../model/report';
import type { ValidationBaseline } from '../model/baseline';
import { createQuotaBudget } from '../quota/quota-budget';
import { validateQuotaProfile } from '../quota/quota-profile';
import type { StructuralJsonDecoder } from '../codec/strict-json-decoder';
import type { ProhibitedConstructGate } from '../codec/prohibited-construct-gate';
import type { SchemaMigrationCoordinator } from '../migration/schema-migration-coordinator';
import type { CanonicalizationGateway } from '../canonical/canonicalizer';
import type { BaselineSources } from '../baseline/baseline-factory';
import { captureBaseline } from '../baseline/baseline-factory';
import type {
  DefinitionRegistryGateway,
  DefinitionValidationGateway,
  ReferenceResolutionGateway,
  RuntimeCompatibilityGateway,
} from '../ports/definition-ports';
import { MANDATORY_RESOLUTION_CAPABILITIES, MANDATORY_VALIDATION_CAPABILITIES } from '../ports/definition-ports';
import type { UpstreamSchemaView } from '../model/upstream';
import type { IntegrationContractCatalog } from '../contracts/integration-contract-catalog';
import type { PresentationFallbackResolver } from '../presentation/fallback-resolver';
import { mintValidatedChangeSet } from '../activation/validated-change-set';
import { DiagnosticCollector } from './diagnostic-collector';

export interface UGCValidationCoordinator {
  validate(request: CandidateChangeRequest): ValidationReport;
}

export interface CoordinatorDeps {
  readonly decoder: StructuralJsonDecoder;
  readonly prohibitedConstructGate: ProhibitedConstructGate;
  readonly migration: SchemaMigrationCoordinator;
  readonly canonicalization: CanonicalizationGateway;
  readonly baselineSources: BaselineSources;
  readonly contracts: IntegrationContractCatalog;
  readonly definitionValidation: DefinitionValidationGateway;
  readonly referenceResolution: ReferenceResolutionGateway;
  readonly runtimeCompatibility: RuntimeCompatibilityGateway;
  readonly presentation: PresentationFallbackResolver;
  readonly schemaView: UpstreamSchemaView;
  readonly registry: DefinitionRegistryGateway;
  readonly quotaProfile: TrustedQuotaProfile;
  readonly fingerprint: StableFingerprintGateway;
  readonly factory: UGCDiagnosticFactory;
}

/** 后续阶段的检查标识，供 SkippedCheck 引用。它们是稳定标识，不是自由文本。 */
const CHECK_IDS = {
  'schema-migration': ['schema-version-selection', 'trusted-migration-chain'],
  'canonicalize': ['canonical-serialization', 'canonical-fingerprint'],
  'request-binding': ['change-request-binding'],
  'definition-validation': ['closed-schema', 'identity', 'layer-ownership', 'numeric-classification', 'composition'],
  'reference-resolution': ['typed-reference-targets', 'dependency-graph', 'inbound-closure-revalidation'],
  'presentation-resolution': ['presentation-eligibility', 'semantic-fingerprint-guard'],
  'activation-precheck': ['validated-artifact-mint'],
} as const;

function report(input: {
  readonly baseline: ValidationBaseline;
  readonly collector: DiagnosticCollector;
  readonly budget: QuotaBudget;
  readonly candidateFingerprint?: string | null;
  readonly changeRequestFingerprint?: string | null;
  readonly binding?: ValidationReport['changeRequestBinding'];
  readonly validated?: ValidationReport['validated'];
}): ValidationReport {
  const validated = input.validated ?? null;
  return Object.freeze({
    baseline: input.baseline,
    candidateFingerprint: input.candidateFingerprint ?? null,
    changeRequestFingerprint: input.changeRequestFingerprint ?? null,
    changeRequestBinding: input.binding ?? null,
    diagnostics: input.collector.diagnostics(),
    skippedChecks: input.collector.skippedChecks(),
    budget: input.budget.snapshot(),
    status: validated === null ? 'rejected' : 'validated',
    validated,
  });
}

export function createValidationCoordinator(deps: CoordinatorDeps): UGCValidationCoordinator {
  return Object.freeze({
    validate(request: CandidateChangeRequest): ValidationReport {
      const document = request.document;
      const sourcePackage = document.source.packageId;

      // 配额档案必须完整，否则验证**不启动**：没有资源上界就不能开始解析不可信输入（需求 9.1）。
      const profileCheck = validateQuotaProfile(deps.factory, deps.quotaProfile, sourcePackage);
      const budget = createQuotaBudget(
        profileCheck.ok ? profileCheck.value : deps.quotaProfile,
      );
      const collector = new DiagnosticCollector(budget, deps.factory, sourcePackage);
      const baseline = captureBaseline(deps.baselineSources);

      if (!profileCheck.ok) {
        collector.addAll(profileCheck.diagnostics);
        collector.skipBecauseOfLastError('decode', ['bounded-json-decode']);
        return report({ baseline, collector, budget });
      }

      // ---- ingress ----
      const ingressErrors = inspectIngress(request, deps.factory, sourcePackage);
      if (ingressErrors.length > 0) {
        collector.addAll(ingressErrors);
        collector.skipBecauseOfLastError('decode', ['bounded-json-decode']);
        return report({ baseline, collector, budget });
      }

      // ---- decode ----
      const decoded = deps.decoder.decode(document, budget);
      if (!decoded.ok) {
        collector.addAll(decoded.diagnostics);
        // 语法/编码/配额是根错误：后续阶段没有安全确定的输入可用，全部记为跳过。
        for (const [stage, checks] of Object.entries(CHECK_IDS)) {
          collector.skipBecauseOfLastError(stage as keyof typeof CHECK_IDS, checks);
        }
        return report({ baseline, collector, budget });
      }
      collector.addAll(decoded.diagnostics);

      // 禁止执行构造：与解码同阶段，但独立于语法，因此单独聚合。
      const prohibited = deps.prohibitedConstructGate.scan(decoded.value, budget);
      const prohibitedBlocking = prohibited.some((entry) => entry.severity === 'error' || entry.severity === 'fatal');
      collector.addAll(prohibited);

      // ---- schema-migration ----
      const migrated = deps.migration.migrate(decoded.value, budget);
      if (!migrated.ok) {
        collector.addAll(migrated.diagnostics);
        for (const stage of ['canonicalize', 'request-binding', 'definition-validation', 'reference-resolution', 'presentation-resolution', 'activation-precheck'] as const) {
          collector.skipBecauseOfLastError(stage, CHECK_IDS[stage]);
        }
        return report({ baseline, collector, budget });
      }
      collector.addAll(migrated.diagnostics);

      // ---- canonicalize ----
      const canonical = deps.canonicalization.canonicalize(migrated.value, budget);
      if (!canonical.ok) {
        collector.addAll(canonical.diagnostics);
        for (const stage of ['request-binding', 'definition-validation', 'reference-resolution', 'presentation-resolution', 'activation-precheck'] as const) {
          collector.skipBecauseOfLastError(stage, CHECK_IDS[stage]);
        }
        return report({ baseline, collector, budget });
      }
      collector.addAll(canonical.diagnostics);

      return continueAfterCanonical({
        deps,
        request,
        baseline,
        budget,
        collector,
        canonical: canonical.value,
        prohibitedBlocking,
      });
    },
  });
}

interface AfterCanonicalInput {
  readonly deps: CoordinatorDeps;
  readonly request: CandidateChangeRequest;
  readonly baseline: ValidationBaseline;
  readonly budget: QuotaBudget;
  readonly collector: DiagnosticCollector;
  readonly canonical: CanonicalCandidate;
  readonly prohibitedBlocking: boolean;
}

function continueAfterCanonical(input: AfterCanonicalInput): ValidationReport {
  const { deps, request, baseline, budget, collector, canonical } = input;
  const sourcePackage = canonical.source.packageId;

  // ---- request-binding ----
  const binding = createChangeRequestBinding({
    candidateFingerprint: canonical.canonicalFingerprint,
    sourcePackageId: canonical.source.packageId,
    sourceDocumentId: canonical.source.documentId,
    targetOwnership: canonical.targetOwnership,
    operation: request.operation,
    expectedTargetId: request.expectedTargetId ?? null,
  });
  const changeRequestFingerprint = computeChangeRequestFingerprint(deps.fingerprint, binding);
  const sealed = Object.freeze({ candidate: canonical, binding, changeRequestFingerprint });

  const finish = (validated: ValidationReport['validated'] = null): ValidationReport =>
    report({
      baseline,
      collector,
      budget,
      candidateFingerprint: canonical.canonicalFingerprint,
      changeRequestFingerprint,
      binding,
      validated,
    });

  // ---- 兼容声明纯转交（需求 12.8-12.11）----
  // 只有候选**显式携带**声明时才调用上游网关；无声明候选绝不触发任何 persistence/lifecycle 调用。
  const compatibilityDiagnostics = forwardCompatibility(deps, canonical.decodedValue);
  collector.addAll(compatibilityDiagnostics);

  // 禁止构造是根错误：不把可能含执行请求的候选交给上游验证器。
  if (input.prohibitedBlocking) {
    for (const stage of ['definition-validation', 'reference-resolution', 'presentation-resolution', 'activation-precheck'] as const) {
      collector.skipBecauseOfLastError(stage, CHECK_IDS[stage]);
    }
    return finish();
  }

  // ---- definition-validation（唯一 Definition Validator 入口）----
  const activeSnapshot = deps.registry.readSnapshot();
  const contractSnapshot = deps.contracts.snapshot();
  const validation = deps.definitionValidation.validate(
    sealed,
    { baseline, contracts: contractSnapshot, activeSnapshot, schema: deps.schemaView },
    budget,
  );
  collector.addAll(validation.diagnostics);

  // UGC 只核对上游结果完整性，不复制领域规则。缺任何强制能力即失败关闭（tasks.md 6.3）。
  const missingValidation = MANDATORY_VALIDATION_CAPABILITIES.filter(
    (capability) => !validation.coveredCapabilities.includes(capability),
  );
  if (missingValidation.length > 0) {
    collector.add(
      capabilityGap(deps, sourcePackage, 'Definition_Validator', missingValidation, 'definition-validation'),
    );
  }

  if (validation.validated === null || missingValidation.length > 0 || collector.hasBlocking()) {
    for (const stage of ['reference-resolution', 'presentation-resolution', 'activation-precheck'] as const) {
      collector.skipBecauseOfLastError(stage, CHECK_IDS[stage]);
    }
    return finish();
  }

  return continueAfterValidation({ ...input, sealed, binding, changeRequestFingerprint, activeSnapshot, contractSnapshot, upstreamValidated: validation.validated, finish });
}

interface AfterValidationInput extends AfterCanonicalInput {
  readonly sealed: CanonicalizedChangeRequest;
  readonly binding: ChangeRequestBinding;
  readonly changeRequestFingerprint: string;
  readonly activeSnapshot: DefinitionRegistryReadSnapshot;
  readonly contractSnapshot: IntegrationContractSnapshot;
  readonly upstreamValidated: UpstreamValidatedCandidate;
  readonly finish: (validated?: ValidationReport['validated']) => ValidationReport;
}

function continueAfterValidation(input: AfterValidationInput): ValidationReport {
  const { deps, budget, collector, finish, sealed } = input;
  const sourcePackage = sealed.candidate.source.packageId;

  // ---- reference-resolution（唯一 Reference Resolver 入口）----
  const resolution = deps.referenceResolution.resolve(
    input.upstreamValidated,
    input.activeSnapshot,
    input.contractSnapshot,
    budget,
  );
  collector.addAll(resolution.diagnostics);

  const missingResolution = MANDATORY_RESOLUTION_CAPABILITIES.filter(
    (capability) => !resolution.coveredCapabilities.includes(capability),
  );
  if (missingResolution.length > 0) {
    collector.add(capabilityGap(deps, sourcePackage, 'Reference_Resolver', missingResolution, 'reference-resolution'));
  }

  if (resolution.graph === null || missingResolution.length > 0 || collector.hasBlocking()) {
    for (const stage of ['presentation-resolution', 'activation-precheck'] as const) {
      collector.skipBecauseOfLastError(stage, CHECK_IDS[stage]);
    }
    return finish();
  }

  // ---- presentation-resolution ----
  const presentation = deps.presentation.resolve(input.upstreamValidated, deps.schemaView, sourcePackage);
  if (!presentation.ok) {
    collector.addAll(presentation.diagnostics);
    collector.skipBecauseOfLastError('activation-precheck', CHECK_IDS['activation-precheck']);
    return finish();
  }
  collector.addAll(presentation.value.warnings);

  // ---- activation-precheck：铸造不可伪造产物 ----
  if (collector.hasBlocking()) {
    collector.skipBecauseOfLastError('activation-precheck', CHECK_IDS['activation-precheck']);
    return finish();
  }

  const minted = mintValidatedChangeSet({
    request: sealed,
    baseline: input.baseline,
    upstreamValidated: presentation.value.candidate,
    resolvedReferences: resolution.graph,
    presentationDecisions: presentation.value.decisions,
    diagnostics: collector.diagnostics(),
    fingerprint: deps.fingerprint,
  });

  if (!minted.ok) {
    collector.add(
      deps.factory.changeSet({
        selector: { category: 'ATOMIC_ACTIVATION', condition: 'artifact-not-minted' },
        stage: 'activation-precheck',
        sourcePackage,
        sourceSpan: null,
        jsonPath: null,
        message: `Validated artifact could not be minted: ${minted.reason}.`,
        reason: `无法铸造验证产物：${minted.detail}`,
        correctionSuggestion: '请从原始候选重新完整验证；不要复用任何中间结果。',
        actual: minted.reason,
      }),
    );
    return finish();
  }

  return finish(minted.artifact);
}

/**
 * 入口形状检查（需求 3.6）。
 *
 * 只检查 UGC 自己拥有的信封字段：来源身份、目标层、操作与预期目标的一致性。
 * Schema 版本由解码器从文档内部读取，不在这里检查——它属于文档内容而非信封。
 */
function inspectIngress(
  request: CandidateChangeRequest,
  factory: UGCDiagnosticFactory,
  sourcePackage: string,
): readonly Diagnostic[] {
  const problems: Diagnostic[] = [];
  const source = request.document.source;
  const anchor = documentAnchorSpan(source.documentId);

  const push = (condition: 'missing-source-identity' | 'missing-target-ownership', reason: string, correction: string): void => {
    problems.push(
      factory.document({
        selector: { category: 'SCHEMA_CONTRACT', condition },
        stage: 'ingress',
        sourcePackage,
        sourceSpan: anchor,
        message: `Candidate envelope is incomplete (${condition}).`,
        reason,
        correctionSuggestion: correction,
      }),
    );
  };

  for (const [label, value] of [
    ['documentId', source.documentId],
    ['packageId', source.packageId],
    ['sourceName', source.sourceName],
  ] as const) {
    if (!isStableIdentity(value)) {
      push(
        'missing-source-identity',
        `候选的来源标识 ${label} 必须是非空且不含前后空白的字符串，当前为 ${JSON.stringify(value)}。`,
        '请让创作入口为每份文档提供稳定的来源包标识、文档标识和展示名。',
      );
    }
  }

  if (!Number.isSafeInteger(source.receivedAtSequence) || source.receivedAtSequence < 0) {
    push(
      'missing-source-identity',
      `审计序号 receivedAtSequence 必须是非负安全整数，当前为 ${String(source.receivedAtSequence)}。`,
      '请由宿主提供单调递增的非负审计序号。',
    );
  }

  if (!isTargetOwnership(request.document.targetOwnership)) {
    push(
      'missing-target-ownership',
      `候选必须声明恰好一个目标归属层（base-layer 或 play-layer），当前为 ${JSON.stringify(request.document.targetOwnership)}。`,
      '请显式声明该激活单元的目标层。',
    );
  }

  // add 不应携带预期目标；replace / remove 必须携带。
  if (request.operation === 'add' && request.expectedTargetId !== undefined) {
    push(
      'missing-target-ownership',
      'add 操作不应携带 expectedTargetId：新增没有预期的现有目标。',
      '新增请删除 expectedTargetId；若想替换现有定义请使用 replace。',
    );
  }
  if (request.operation !== 'add' && !isStableIdentity(request.expectedTargetId)) {
    push(
      'missing-target-ownership',
      `${request.operation} 操作必须携带非空的 expectedTargetId，用于唯一指明被替换或删除的现有定义。`,
      '请补上 expectedTargetId。',
    );
  }

  return Object.freeze(problems);
}

/** 上游缺少强制能力时的失败关闭诊断。 */
function capabilityGap(
  deps: CoordinatorDeps,
  sourcePackage: string,
  portName: string,
  missing: readonly string[],
  stage: 'definition-validation' | 'reference-resolution',
): Diagnostic {
  return deps.factory.changeSet({
    selector: { category: 'REFERENCE_CONTRACT', condition: 'unresolved-contract' },
    stage,
    sourcePackage,
    sourceSpan: null,
    jsonPath: null,
    message: `${portName} did not cover mandatory capabilities: ${missing.join(', ')}.`,
    reason:
      `上游 ${portName} 未能证明它覆盖了以下强制能力：${missing.join('、')}。` +
      '无法证明覆盖就无法信任其通过结论，因此候选失败关闭。',
    correctionSuggestion: '这不是候选内容的问题：请等待上游端口补齐并声明这些能力后重新提交。',
    expected: missing.join(','),
    actual: 'not-covered',
  });
}

/** 候选中声明玩法包/存档兼容性的成员名。 */
export const COMPATIBILITY_MEMBER = 'compatibility';
/** 候选中请求替换正在进行的对局玩法包的成员名。 */
export const ACTIVE_MATCH_REPLACEMENT_MEMBER = 'replaceActivePlaypack';

/**
 * 把兼容声明**原样转交**上游网关，并保留其拒绝结果（需求 12.10、12.11）。
 *
 * UGC 在这条路径上不做任何事情：不解释声明含义、不比较版本、不读写存档、不创建 Snapshot/Journal/
 * Checkpoint/MigrationDef，也不把上游的拒绝降级为警告。它只负责"把话传过去，把答复带回来"。
 *
 * 每个声明最多调用上游一次；没有声明时一次都不调用。
 */
function forwardCompatibility(deps: CoordinatorDeps, decodedValue: unknown): readonly Diagnostic[] {
  if (decodedValue === null || typeof decodedValue !== 'object' || Array.isArray(decodedValue)) {
    return Object.freeze([]);
  }
  const root = decodedValue as Record<string, unknown>;
  const collected: Diagnostic[] = [];

  if (Object.prototype.hasOwnProperty.call(root, COMPATIBILITY_MEMBER)) {
    collected.push(...deps.runtimeCompatibility.validatePlaypackOrSaveDeclaration(root[COMPATIBILITY_MEMBER]));
  }
  if (Object.prototype.hasOwnProperty.call(root, ACTIVE_MATCH_REPLACEMENT_MEMBER)) {
    collected.push(...deps.runtimeCompatibility.rejectActiveMatchReplacement(root[ACTIVE_MATCH_REPLACEMENT_MEMBER]));
  }

  return Object.freeze(collected);
}

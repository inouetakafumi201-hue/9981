/**
 * 基类层四端口的最小契约（design.md「Upstream definition ports」/ 需求 1.2-1.3、3.2-3.9、7.1-7.4）。
 *
 * UGC 只声明"我需要什么"，不声明"上游怎么算"。每个端口都刻意窄：它接收封存的规范化请求、只读快照、
 * 契约快照和预算，返回结构化结果。端口不接受也不返回 `WorldState`、`OpRegistry`、Hook、事务或持久化写入器。
 *
 * 任务 1.2 的核实结论：本文件的四个端口在当前仓库**全部 unavailable**。禁止用
 * `DefRegistry.register`（逐项可变写入、重复 ID 静默覆盖、无入边重验）或 `Linter.run`（只覆盖部分规则）
 * 近似代替；缺失时使用 `ports/unavailable.ts` 的失败关闭适配器。
 */
import type { Diagnostic } from '../../kernel/state/diagnostic.js';
import type { CanonicalizedChangeRequest } from '../model/canonical-types.js';
import type { QuotaBudget } from '../model/quota-types.js';
import type { TargetOwnership } from '../model/candidate.js';
import type { ValidationBaseline } from '../model/baseline.js';
import type { ActivationResult } from '../model/report.js';
import type { ValidatedChangeSet } from '../model/validated-change-set.js';
import type {
  DefinitionRegistryReadSnapshot,
  UpstreamResolvedReferenceGraph,
  UpstreamSchemaView,
  UpstreamValidatedCandidate,
} from '../model/upstream.js';
import type { IntegrationContractSnapshot } from '../model/contract-types.js';

/**
 * 上游必须自证覆盖的强制能力。缺任何一项，UGC 拒绝启动验证——
 * 这是"失败关闭"而非"尽力而为"：无法证明覆盖 = 不能信任其通过结论（需求 13.2）。
 */
export const MANDATORY_VALIDATION_CAPABILITIES = [
  'closed-schema',
  'open-property-map',
  'required-and-type',
  'cross-field-constraint',
  'def-kind-registry',
  'identifier-uniqueness',
  'authorized-override',
  'abstract-instantiation',
  'layer-ownership',
  'numeric-classification',
  'gameplay-value-range',
  'inheritance-cycle',
  'composition-conflict',
  'order-declaration',
  'semantic-field-strictness',
  'error-aggregation',
] as const;

export type ValidationCapability = (typeof MANDATORY_VALIDATION_CAPABILITIES)[number];

export const MANDATORY_RESOLUTION_CAPABILITIES = [
  'expected-kind',
  'semantic-family',
  'provider-domain',
  'missing-target',
  'ambiguous-target',
  'reference-cycle',
  'package-cycle',
  'inbound-closure-revalidation',
  'deterministic-edge-order',
] as const;

export type ResolutionCapability = (typeof MANDATORY_RESOLUTION_CAPABILITIES)[number];

export interface DefinitionValidationContext {
  readonly baseline: ValidationBaseline;
  readonly contracts: IntegrationContractSnapshot;
  readonly activeSnapshot: DefinitionRegistryReadSnapshot;
  readonly schema: UpstreamSchemaView;
}

export interface ValidationStageResult {
  readonly diagnostics: readonly Diagnostic[];
  /** 上游本次实际执行的强制能力。UGC 逐项核对，缺项即失败关闭。 */
  readonly coveredCapabilities: readonly ValidationCapability[];
  /** 仅在零 error/fatal 时非 null。 */
  readonly validated: UpstreamValidatedCandidate | null;
}

/** 所有来源唯一的 Definition Validator 入口。不存在"可信来源"旁路（需求 3.9）。 */
export interface DefinitionValidationGateway {
  readonly providerId: string;
  readonly version: string;
  validate(
    request: CanonicalizedChangeRequest,
    context: DefinitionValidationContext,
    budget: QuotaBudget,
  ): ValidationStageResult;
}

export interface ReferenceStageResult {
  readonly diagnostics: readonly Diagnostic[];
  readonly coveredCapabilities: readonly ResolutionCapability[];
  /** 仅在零 error/fatal 且依赖图完整时非 null。禁止把部分图当作有效输出（需求 7.11）。 */
  readonly graph: UpstreamResolvedReferenceGraph | null;
}

/** 唯一 Reference Resolver 入口。继承环归 validator，迁移环归迁移协调器（需求 7.9）。 */
export interface ReferenceResolutionGateway {
  readonly providerId: string;
  readonly version: string;
  resolve(
    validated: UpstreamValidatedCandidate,
    activeSnapshot: DefinitionRegistryReadSnapshot,
    contracts: IntegrationContractSnapshot,
    budget: QuotaBudget,
  ): ReferenceStageResult;
}

/**
 * 批量原子定义注册表。
 *
 * 必须满足的契约（任务 1.2 已确认现有内核 `DefRegistry` **不满足**）：
 * 1. 内部工作副本完成新增、覆盖、删除、入边重验和快照生成；
 * 2. 以 compare-and-swap 语义一次发布，`expected` 不匹配即拒绝；
 * 3. 失败时返回与旧快照**完全相同**的指纹，且 `unchanged` 为 true；
 * 4. 单次 `activateAtomically` 调用完成整个变更集——禁止调用方循环调用来模拟批量。
 */
export interface DefinitionRegistryGateway {
  readonly providerId: string;
  readonly version: string;
  readonly targetOwnership: TargetOwnership;
  readSnapshot(): DefinitionRegistryReadSnapshot;
  activateAtomically(change: ValidatedChangeSet, expected: ValidationBaseline): ActivationResult;
}

/**
 * 运行时兼容与生命周期转交端口（需求 12.8-12.11）。
 *
 * UGC 只转交声明并**原样保留**上游拒绝结果。它不创建 Snapshot/Journal/Checkpoint/MigrationDef，
 * 不读写 WorldState，也不推进任何持久化状态。候选 JSON 永远不能变成可执行的 `MigrationDef.transform`。
 */
export interface RuntimeCompatibilityGateway {
  readonly providerId: string;
  readonly version: string;
  /** 校验玩法包/存档兼容声明。返回的诊断原样进入报告，不得降级或改写。 */
  validatePlaypackOrSaveDeclaration(declaration: unknown): readonly Diagnostic[];
  /** 对局进行中替换玩法包的请求；上游恒拒绝，UGC 保留该拒绝。 */
  rejectActiveMatchReplacement(request: unknown): readonly Diagnostic[];
}

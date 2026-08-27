/**
 * 跨领域待汇合契约类型（design.md「Integration contract catalog」/ 需求 15.1-15.10）。
 *
 * 目录只保存提供方**导出的类型身份与引用约束**，不保存也不执行领域内部求值逻辑：
 * core mechanics 的动作/规则/数值语义、space-items 的拓扑/容器/物品/转移机制、AI 的查询/策略/搜索/
 * 可见性/决策机制一律留在各自领域（需求 15.6-15.8）。
 */
import type { SourceRecord } from '../../kernel/state/diagnostic';

export const INTEGRATION_DOMAINS = ['core-mechanics', 'space-items', 'ai'] as const;
export type IntegrationDomain = (typeof INTEGRATION_DOMAINS)[number];

export function isIntegrationDomain(value: unknown): value is IntegrationDomain {
  return typeof value === 'string' && (INTEGRATION_DOMAINS as readonly string[]).includes(value);
}

export interface IntegrationContract {
  readonly domain: IntegrationDomain;
  readonly providerId: string;
  readonly version: string;
  readonly exportedDefKinds: readonly string[];
  readonly exportedSemanticFamilies: readonly string[];
  /** 引用约束集合的内容指纹。约束本身由提供方拥有，UGC 只比较指纹是否变化。 */
  readonly referenceConstraintsFingerprint: string;
  /** 来源追踪。复用共享 `SourceRecord` 形状，不新建平行结构。 */
  readonly sourceRecords: readonly SourceRecord[];
}

export interface IntegrationContractSnapshot {
  readonly catalogVersion: string;
  /** 按 domain → providerId 稳定排序。 */
  readonly contracts: readonly IntegrationContract[];
  /** 全部契约内容派生的总指纹，进入 Validation Baseline。 */
  readonly fingerprint: string;
}

export type ContractExportKind = 'def-kind' | 'semantic-family';

export interface ResolvedContractExport {
  readonly domain: IntegrationDomain;
  readonly providerId: string;
  readonly version: string;
  readonly exportKind: ContractExportKind;
  readonly identity: string;
  readonly sourceRecords: readonly SourceRecord[];
}

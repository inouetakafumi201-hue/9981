/**
 * L2 Model: Canonical_Snapshot 数据模型。
 *
 * 对应 Requirements 12.12、15.17 与 design.md 的 `Canonical_Snapshot` 数据模型。
 *
 * 快照是**确定性表示**：忽略非语义格式差异，但保留语义、引用与来源。
 * 它不暴露任何可写活动对象 —— 所有字段都是规范化后的纯数据。
 */

import type { DefinitionId, JsonPath, PackageId, SemanticFamilyId } from './ids';
import type { SourceRecord } from './source';
import type { L1DefKind } from './def-kind';

/** 包级快照。 */
export interface PackageSnapshot {
  readonly packageId: PackageId;
  readonly schemaVersion: string;
  readonly dependencyPackageIds: readonly PackageId[];
  readonly definitionIds: readonly DefinitionId[];
  readonly overrideTargetIds: readonly DefinitionId[];
  readonly removalTargetIds: readonly DefinitionId[];
  readonly sourceRecords: readonly SourceRecord[];
}

/** 已解析定义的快照条目。 */
export interface ResolvedDefinitionSnapshot {
  readonly id: DefinitionId;
  readonly defKind: L1DefKind;
  readonly abstract: boolean;
  readonly semanticFamily: SemanticFamilyId;
  readonly typeLineage: readonly DefinitionId[];
  readonly originPackage: PackageId;
  /** 该定义的规范化 JSON 表示；字节级稳定，可直接用于回归对比。 */
  readonly canonicalJson: string;
  readonly sourceRecords: readonly SourceRecord[];
}

/** 规范化引用边。 */
export interface CanonicalReferenceEdge {
  readonly from: DefinitionId;
  readonly to: DefinitionId;
  readonly role: string;
  readonly jsonPath: JsonPath;
}

/** 规范化引用图节点。 */
export interface CanonicalReferenceGraphNode {
  readonly definitionId: DefinitionId;
  readonly inboundFrom: readonly DefinitionId[];
  readonly outboundTo: readonly DefinitionId[];
}

export interface CanonicalReferenceGraph {
  readonly nodes: readonly CanonicalReferenceGraphNode[];
  readonly edges: readonly CanonicalReferenceEdge[];
}

export interface CanonicalSnapshot {
  readonly activatedPackages: readonly PackageSnapshot[];
  readonly resolvedDefinitions: readonly ResolvedDefinitionSnapshot[];
  readonly referenceGraph: CanonicalReferenceGraph;
  readonly sourceRecords: readonly SourceRecord[];
  /** 全快照指纹：等价活动状态必须产生相同指纹。 */
  readonly fingerprint: string;
}

export const EMPTY_CANONICAL_REFERENCE_GRAPH: CanonicalReferenceGraph = Object.freeze({
  nodes: Object.freeze([]) as readonly CanonicalReferenceGraphNode[],
  edges: Object.freeze([]) as readonly CanonicalReferenceEdge[],
});

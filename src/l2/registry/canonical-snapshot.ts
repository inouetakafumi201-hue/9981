/**
 * L2 Registry: Canonical_Snapshot 生成与等价支持。
 *
 * 对应 Requirements 12.8–12.12、13.4、15.7、15.17 与 design.md `Canonical_Snapshot`、Property 10。
 *
 * 快照是确定性纯数据：定义按 id 排序，每个定义序列化为规范化 JSON 字节串，
 * 引用图节点/边排序，来源记录排序。等价活动状态 → 相同指纹。
 */

import { canonicalSort, compareStrings, fingerprint, stableStringify } from '../model/ordering.js';
import { compareSourceRecords } from '../model/ordering.js';
import type { ResolvedDefinition } from '../model/definition.js';
import type { SourceRecord } from '../model/source.js';
import type {
  CanonicalReferenceEdge,
  CanonicalReferenceGraph,
  CanonicalReferenceGraphNode,
  CanonicalSnapshot,
  PackageSnapshot,
  ResolvedDefinitionSnapshot,
} from '../model/snapshot.js';
import type { ReferenceGraph } from '../resolution/reference-graph.js';
import type { ActivatedPackageRecord } from './definition-registry.js';

/** 定义的规范化 JSON 投影：只含语义字段，排除位置等非语义信息。 */
function canonicalDefinitionProjection(definition: ResolvedDefinition): unknown {
  return {
    id: definition.id,
    defKind: definition.defKind,
    abstract: definition.abstract,
    semanticFamily: definition.semanticFamily,
    typeLineage: [...definition.typeLineage].sort(compareStrings),
    typeIdentity: {
      requiredCapabilities: [...definition.typeIdentity.requiredCapabilities].sort(compareStrings),
      legalRelationships: [...definition.typeIdentity.legalRelationships].sort(compareStrings),
      invariants: [...definition.typeIdentity.invariants].sort(compareStrings),
      substitutionCompatibility: [...definition.typeIdentity.substitutionCompatibility].sort(compareStrings),
    },
    resolvedFields: definition.resolvedFields.map((field) => ({
      name: field.name,
      dataType: field.dataType,
      classification: field.classification,
      required: field.required,
    })),
    nestedCapabilities: definition.nestedCapabilities.map((component) => ({
      componentId: component.componentId,
      role: component.role,
      optional: component.optional,
      typeDefining: component.typeDefining,
      targetId: component.targetId ?? null,
    })),
    tags: [...definition.tags].sort(compareStrings),
    familyContract: definition.familyContract ?? null,
  };
}

function definitionSnapshot(definition: ResolvedDefinition): ResolvedDefinitionSnapshot {
  return {
    id: definition.id,
    defKind: definition.defKind,
    abstract: definition.abstract,
    semanticFamily: definition.semanticFamily,
    typeLineage: [...definition.typeLineage].sort(compareStrings),
    originPackage: definition.originPackage,
    canonicalJson: stableStringify(canonicalDefinitionProjection(definition)),
    sourceRecords: canonicalSort(definition.sourceRecords, compareSourceRecords),
  };
}

function graphSnapshot(graph: ReferenceGraph): CanonicalReferenceGraph {
  const nodeIds = [...graph.nodes.keys()].sort(compareStrings);
  const nodes: CanonicalReferenceGraphNode[] = nodeIds.map((id) => ({
    definitionId: id,
    inboundFrom: [...(graph.inbound.get(id) ?? [])].sort(compareStrings),
    outboundTo: [...(graph.outbound.get(id) ?? [])].sort(compareStrings),
  }));
  const edges: CanonicalReferenceEdge[] = [];
  for (const { hostId, reference } of graph.references) {
    if (graph.nodes.has(reference.refId)) {
      edges.push({ from: hostId, to: reference.refId, role: reference.role, jsonPath: reference.jsonPath });
    }
  }
  edges.sort((left, right) => {
    if (left.from !== right.from) return compareStrings(left.from, right.from);
    if (left.to !== right.to) return compareStrings(left.to, right.to);
    if (left.role !== right.role) return compareStrings(left.role, right.role);
    return compareStrings(left.jsonPath, right.jsonPath);
  });
  return { nodes, edges };
}

function packageSnapshot(record: ActivatedPackageRecord): PackageSnapshot {
  return {
    packageId: record.packageId,
    schemaVersion: record.schemaVersion,
    dependencyPackageIds: [...record.dependencyPackageIds].sort(compareStrings),
    definitionIds: [...record.definitionIds].sort(compareStrings),
    overrideTargetIds: [...record.overrideTargetIds].sort(compareStrings),
    removalTargetIds: [...record.removalTargetIds].sort(compareStrings),
    sourceRecords: canonicalSort(record.sourceRecords, compareSourceRecords),
  };
}

export interface SnapshotInput {
  readonly activatedPackages: readonly ActivatedPackageRecord[];
  readonly resolvedDefinitions: readonly ResolvedDefinition[];
  readonly graph: ReferenceGraph;
  readonly sourceRecords: readonly SourceRecord[];
}

/** 生成 Canonical_Snapshot。 */
export function createSnapshot(input: SnapshotInput): CanonicalSnapshot {
  const activatedPackages = canonicalSort(
    input.activatedPackages.map((record) => packageSnapshot(record)),
    (left, right) => compareStrings(left.packageId, right.packageId),
  );
  const resolvedDefinitions = canonicalSort(
    input.resolvedDefinitions.map((definition) => definitionSnapshot(definition)),
    (left, right) => compareStrings(left.id, right.id),
  );
  const referenceGraph = graphSnapshot(input.graph);
  const sourceRecords = canonicalSort(input.sourceRecords, compareSourceRecords);

  const body = { activatedPackages, resolvedDefinitions, referenceGraph, sourceRecords };
  return Object.freeze({
    ...body,
    fingerprint: fingerprint(body),
  });
}

/** 空快照（无激活内容）。 */
export function emptySnapshot(): CanonicalSnapshot {
  const body = {
    activatedPackages: [] as readonly PackageSnapshot[],
    resolvedDefinitions: [] as readonly ResolvedDefinitionSnapshot[],
    referenceGraph: { nodes: [], edges: [] } as CanonicalReferenceGraph,
    sourceRecords: [] as readonly SourceRecord[],
  };
  return Object.freeze({ ...body, fingerprint: fingerprint(body) });
}

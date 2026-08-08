/**
 * L2 Registry: Definition_Registry 与工作副本原子激活。
 *
 * 对应 Requirements 2.6–2.7、4.9–4.10、7.13、11.12、12.6–12.12、13.4–13.5、15.7、15.17
 * 与 design.md `Definition_Registry.activate`、Property 10。
 *
 * 铁律：
 * - 候选包在工作副本中应用 add/override/remove，验证通过后一次性原子替换活动注册表。
 * - 任一 Error_Diagnostic → 零候选变更可见，活动注册表/依赖图/快照保持原样。
 * - 仅 Warning → 允许激活，且不改变任何语义字段含义。
 * - 查询只返回已解析定义。
 *
 * 注册表是**不可变值 + 纯函数**：`activate` 返回新注册表，不原地修改旧对象；
 * 候选对象也不会原地写入活动对象（工作副本用 deepClonePlain 隔离）。
 */

import type { StructuredRejection } from '../model/diagnostic.js';
import type { Result } from '../model/result.js';
import { ok } from '../model/result.js';
import { structuredRejection } from '../model/diagnostic-factory.js';
import { isWarningDiagnostic } from '../model/diagnostic.js';
import type { DefinitionPackage, ReadOnlyResolvedDefinition, ResolvedDefinition, SemanticFamilyRegistration } from '../model/definition.js';
import type { PackageId } from '../model/ids.js';
import type { TypedReference } from '../model/reference.js';
import type { SourceRecord } from '../model/source.js';
import type { CanonicalSnapshot } from '../model/snapshot.js';
import type { CompiledSpecification } from '../compiler/types.js';
import { deepFreeze } from '../model/immutable.js';
import type { GraphNodeInfo, ReferenceGraph } from '../resolution/reference-graph.js';
import { validateFullPackage } from '../validation/package-validation.js';
import { createSnapshot, emptySnapshot } from './canonical-snapshot.js';

/** 已激活包的追踪记录（供快照使用）。 */
export interface ActivatedPackageRecord {
  readonly packageId: PackageId;
  readonly schemaVersion: string;
  readonly dependencyPackageIds: readonly PackageId[];
  readonly definitionIds: readonly string[];
  readonly overrideTargetIds: readonly string[];
  readonly removalTargetIds: readonly string[];
  readonly sourceRecords: readonly SourceRecord[];
}

/** 活动注册表的不可变快照状态。 */
export interface ActiveRegistry {
  readonly definitions: ReadonlyMap<string, ResolvedDefinition>;
  readonly nodes: ReadonlyMap<string, GraphNodeInfo>;
  readonly inbound: ReadonlyMap<string, readonly string[]>;
  readonly families: ReadonlyMap<string, SemanticFamilyRegistration>;
  readonly packages: readonly ActivatedPackageRecord[];
  readonly graph?: ReferenceGraph;
  readonly snapshot: CanonicalSnapshot;
}

export interface ActivationSuccess {
  readonly registry: ActiveRegistry;
  readonly snapshot: CanonicalSnapshot;
}

/** 空活动注册表。 */
export function emptyRegistry(): ActiveRegistry {
  return Object.freeze({
    definitions: new Map(),
    nodes: new Map(),
    inbound: new Map(),
    families: new Map(),
    packages: [],
    snapshot: emptySnapshot(),
  });
}

/**
 * 收集活动集里每个定义发出的类型化引用（hostId → 引用）。
 *
 * 建图只遍历候选包自身的定义，因此"留在活动集、本次未被重新提交"的依赖者的引用不在图内。
 * 覆盖重验证需要这份数据回头核验它们在覆盖后是否仍类型兼容（Requirements 12.6、Property 8/10）。
 */
function activeReferenceMap(active: ActiveRegistry): ReadonlyMap<string, readonly TypedReference[]> {
  const map = new Map<string, readonly TypedReference[]>();
  for (const [id, definition] of active.definitions) {
    const references: TypedReference[] = [
      ...definition.actionRefs,
      ...definition.ruleRefs,
      ...(definition.otherRefs ?? []),
    ];
    if (references.length > 0) {
      map.set(id, references);
    }
  }
  return map;
}

function nodeInfoOf(definition: ResolvedDefinition): GraphNodeInfo {
  return {
    id: definition.id,
    defKind: definition.defKind,
    abstract: definition.abstract,
    semanticFamily: definition.semanticFamily,
    origin: 'active',
  };
}

/**
 * 原子激活候选包。
 *
 * 步骤：
 * 1. 用 validateFullPackage 在"活动集叠加候选变更"的工作图上做全量验证（结构 + 引用 + 解析 + 依赖重验证）。
 * 2. 任一 Error → 返回 Structured_Rejection，附带激活前快照指纹；活动注册表不变。
 * 3. 无 Error → 构造下一个不可变活动注册表（应用 add/override/remove），生成新快照。
 */
export function activate(
  active: ActiveRegistry,
  candidate: DefinitionPackage,
  options?: { readonly compiled?: CompiledSpecification },
): Result<ActivationSuccess> {
  const priorFingerprint = active.snapshot.fingerprint;

  const validation = validateFullPackage({
    package: candidate,
    activeNodes: active.nodes,
    activeInbound: active.inbound,
    activeFamilies: active.families,
    activeReferences: activeReferenceMap(active),
    ...(options?.compiled === undefined ? {} : { compiled: options.compiled }),
  });

  if (validation.hasError || validation.graph === undefined || validation.resolved === undefined) {
    return structuredRejection(validation.diagnostics, priorFingerprint) as StructuredRejection;
  }

  // 构造下一活动注册表（不修改 active）。
  const definitions = new Map(active.definitions);
  const removedIds = new Set((candidate.removals ?? []).map((removal) => removal.targetId));
  for (const id of removedIds) {
    definitions.delete(id);
  }
  for (const resolved of validation.resolved) {
    definitions.set(resolved.id, deepFreeze(resolved) as ResolvedDefinition);
  }

  // 重建节点与入边（从最终定义集合的引用图重新推导，保证一致）。
  const nodes = new Map<string, GraphNodeInfo>();
  for (const [id, definition] of definitions) {
    nodes.set(id, nodeInfoOf(definition));
  }

  const inbound = new Map<string, string[]>();
  for (const [id] of definitions) {
    inbound.set(id, []);
  }
  for (const { hostId, reference } of validation.graph.references) {
    if (definitions.has(reference.refId) && definitions.has(hostId)) {
      inbound.get(reference.refId)!.push(hostId);
    }
  }
  // 保留活动集里未受本候选影响的既有入边。
  for (const [target, sources] of active.inbound) {
    if (!definitions.has(target)) {
      continue;
    }
    const merged = inbound.get(target) ?? [];
    for (const source of sources) {
      if (definitions.has(source) && !merged.includes(source)) {
        merged.push(source);
      }
    }
    inbound.set(target, merged);
  }
  const inboundFrozen = new Map<string, readonly string[]>();
  for (const [target, sources] of inbound) {
    inboundFrozen.set(target, [...new Set(sources)].sort());
  }

  const families = new Map(active.families);
  for (const registration of options?.compiled?.registeredFamilies ?? []) {
    families.set(registration.familyId, registration);
  }
  for (const definition of candidate.definitions) {
    const registration = definition.semanticFamily.registration;
    if (registration !== undefined) {
      families.set(registration.familyId, registration);
    }
  }

  const packageRecord: ActivatedPackageRecord = {
    packageId: candidate.packageId,
    schemaVersion: candidate.schemaVersion,
    dependencyPackageIds: candidate.dependencies.map((dependency) => dependency.packageId),
    definitionIds: candidate.definitions.map((definition) => definition.id),
    overrideTargetIds: (candidate.overrideIntent ?? []).map((intent) => intent.targetId),
    removalTargetIds: (candidate.removals ?? []).map((removal) => removal.targetId),
    sourceRecords: candidate.sourceRecords,
  };
  const packages = [
    ...active.packages.filter((record) => record.packageId !== candidate.packageId),
    packageRecord,
  ];

  const allSourceRecords: SourceRecord[] = [];
  for (const definition of definitions.values()) {
    allSourceRecords.push(...definition.sourceRecords);
  }

  const snapshot = createSnapshot({
    activatedPackages: packages,
    resolvedDefinitions: [...definitions.values()],
    graph: validation.graph,
    sourceRecords: allSourceRecords,
  });

  const registry: ActiveRegistry = Object.freeze({
    definitions,
    nodes,
    inbound: inboundFrozen,
    families,
    packages,
    graph: validation.graph,
    snapshot,
  });

  return ok({ registry, snapshot }, validation.diagnostics.filter(isWarningDiagnostic));
}

/** 查询已解析定义（Requirements 4.9）。只返回已解析定义。 */
export function query(active: ActiveRegistry, id: string): ReadOnlyResolvedDefinition | undefined {
  return active.definitions.get(id);
}

/** 暴露依赖图（Requirements 12.12）。 */
export function dependencyGraph(active: ActiveRegistry): {
  readonly inbound: ReadonlyMap<string, readonly string[]>;
  readonly nodes: ReadonlyMap<string, GraphNodeInfo>;
} {
  return { inbound: active.inbound, nodes: active.nodes };
}

/**
 * L2 Resolution: 候选包叠加活动集的类型化引用图。
 *
 * 对应 Requirements 3.5、3.9、4.7、7.8–7.9、8.13、10.11–10.12、12.1–12.5、12.10–12.12
 * 与 design.md `Reference_Resolver.buildGraph`、Property 8。
 *
 * 在激活前统一发现：缺失、悬空、类型不匹配、抽象实例化目标与依赖循环。
 * 图与错误排序确定；不改变活动注册表。
 */

import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes';
import type { Diagnostic } from '../model/diagnostic';
import { errorDiagnostic } from '../model/diagnostic-factory';
import { canonicalSort, compareDiagnostics, compareStrings } from '../model/ordering';
import type { DefinitionPackage } from '../model/definition';
import type { L1DefKind } from '../model/def-kind';
import type { ExpectedReferenceType } from '../model/schema';
import { collectReferences, type CollectedReference } from './reference-collector';

/** 已解析的目标定义摘要（可能来自候选或活动集）。 */
export interface GraphNodeInfo {
  readonly id: string;
  readonly defKind: L1DefKind;
  readonly abstract: boolean;
  readonly semanticFamily: string;
  readonly origin: 'candidate' | 'active';
}

/** 引用图。 */
export interface ReferenceGraph {
  /** 全部可见定义（候选 additions/overrides 覆盖活动集后的结果）。 */
  readonly nodes: ReadonlyMap<string, GraphNodeInfo>;
  /** 出边：hostId → 被引用 id 列表（去重、排序）。 */
  readonly outbound: ReadonlyMap<string, readonly string[]>;
  /** 入边：targetId → 引用它的 hostId 列表（去重、排序）。 */
  readonly inbound: ReadonlyMap<string, readonly string[]>;
  /** 全部收集到的引用（含 host 与角色），供依赖重验证使用。 */
  readonly references: readonly CollectedReference[];
  /** 参与不受支持循环的定义 id（若为空则无循环）。 */
  readonly cycleMembers: readonly string[];
}

export interface BuildGraphInput {
  readonly package: DefinitionPackage;
  /** 活动集节点信息（id → info）。 */
  readonly activeNodes: ReadonlyMap<string, GraphNodeInfo>;
}

export interface BuildGraphResult {
  readonly graph: ReferenceGraph;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * 判定目标节点是否满足引用的期望类型。
 *
 * 导出供 `dependent-revalidation.ts` 复用：覆盖重验证必须用与建图完全相同的判定，
 * 否则"候选内引用"与"活动依赖者引用"会出现两套兼容标准。
 */
export function matchesExpected(info: GraphNodeInfo, expected: ExpectedReferenceType): 'ok' | 'kind' | 'family' {
  if (expected.defKind !== undefined && info.defKind !== expected.defKind) {
    return 'kind';
  }
  if (expected.semanticFamily !== undefined && info.semanticFamily !== expected.semanticFamily) {
    return 'family';
  }
  return 'ok';
}

/**
 * 合并候选变更到活动集，得到工作图节点。
 * additions/overrides = 候选定义（覆盖同 id 活动节点）；removals 从可见集合移除。
 */
function buildWorkingNodes(input: BuildGraphInput): Map<string, GraphNodeInfo> {
  const nodes = new Map<string, GraphNodeInfo>();
  for (const [id, info] of input.activeNodes) {
    nodes.set(id, info);
  }
  const removed = new Set((input.package.removals ?? []).map((removal) => removal.targetId));
  for (const id of removed) {
    nodes.delete(id);
  }
  for (const definition of input.package.definitions) {
    nodes.set(definition.id, {
      id: definition.id,
      defKind: definition.defKind,
      abstract: definition.abstract,
      semanticFamily: definition.semanticFamily.familyId,
      origin: 'candidate',
    });
  }
  return nodes;
}

/** Tarjan 强连通分量，检测依赖循环（含自环）。 */
function findCycleMembers(
  nodes: ReadonlyMap<string, GraphNodeInfo>,
  outbound: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycleMembers = new Set<string>();
  let counter = 0;

  const ids = [...nodes.keys()].sort(compareStrings);

  const strongConnect = (node: string): void => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);

    for (const next of outbound.get(node) ?? []) {
      if (!nodes.has(next)) {
        continue;
      }
      if (!index.has(next)) {
        strongConnect(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node)!, index.get(next)!));
      }
    }

    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      const selfLoop = (outbound.get(node) ?? []).includes(node);
      if (component.length > 1 || selfLoop) {
        for (const item of component) {
          cycleMembers.add(item);
        }
      }
    }
  };

  for (const node of ids) {
    if (!index.has(node)) {
      strongConnect(node);
    }
  }
  return [...cycleMembers].sort(compareStrings);
}

/** 构建引用图，收集全部结构性引用错误。 */
export function buildReferenceGraph(input: BuildGraphInput): BuildGraphResult {
  const nodes = buildWorkingNodes(input);
  const references: CollectedReference[] = [];
  for (const definition of input.package.definitions) {
    references.push(...collectReferences(definition));
  }

  const diagnostics: Diagnostic[] = [];
  const outboundSets = new Map<string, Set<string>>();
  const inboundSets = new Map<string, Set<string>>();
  const pkgId = input.package.packageId;

  for (const { hostId, reference } of references) {
    const target = nodes.get(reference.refId);

    if (target === undefined) {
      if (reference.required) {
        diagnostics.push(
          errorDiagnostic({
            code: DIAGNOSTIC_CODES.REF_MISSING_TARGET,
            reason: `定义 ${hostId} 的引用（角色 ${reference.role}）指向不存在的定义「${reference.refId}」。`,
            correctionSuggestion: '在同一候选变更中提供被引用定义，或修正引用标识（Requirements 12.3）。',
            definitionId: hostId,
            jsonPath: reference.jsonPath,
            sourcePackage: pkgId,
          }),
        );
      }
      continue;
    }

    // 记录边（无论类型是否匹配，边都存在，用于循环检测与依赖重验证）。
    const outSet = outboundSets.get(hostId) ?? new Set<string>();
    outSet.add(reference.refId);
    outboundSets.set(hostId, outSet);
    const inSet = inboundSets.get(reference.refId) ?? new Set<string>();
    inSet.add(hostId);
    inboundSets.set(reference.refId, inSet);

    const match = matchesExpected(target, reference.expected);
    if (match === 'kind') {
      diagnostics.push(
        errorDiagnostic({
          code: DIAGNOSTIC_CODES.REF_KIND_MISMATCH,
          reason:
            `定义 ${hostId} 的引用（角色 ${reference.role}）期望 Def kind「${String(reference.expected.defKind)}」，` +
            `但目标 ${target.id} 的 Def kind 为「${target.defKind}」。`,
          correctionSuggestion: '使引用目标的 Def kind 与期望一致（Requirements 12.4）。',
          definitionId: hostId,
          jsonPath: reference.jsonPath,
          sourcePackage: pkgId,
        }),
      );
    } else if (match === 'family') {
      diagnostics.push(
        errorDiagnostic({
          code: DIAGNOSTIC_CODES.REF_FAMILY_MISMATCH,
          reason:
            `定义 ${hostId} 的引用（角色 ${reference.role}）期望语义族「${String(reference.expected.semanticFamily)}」，` +
            `但目标 ${target.id} 的语义族为「${target.semanticFamily}」。`,
          correctionSuggestion: '使引用目标的语义族与期望一致（Requirements 12.4）。',
          definitionId: hostId,
          jsonPath: reference.jsonPath,
          sourcePackage: pkgId,
        }),
      );
    }

    // 抽象实例化：非 allowAbstract 的引用指向抽象定义（Requirements 4.6）。
    if (!reference.expected.allowAbstract && target.abstract) {
      diagnostics.push(
        errorDiagnostic({
          code: DIAGNOSTIC_CODES.REF_ABSTRACT_TARGET,
          reason: `定义 ${hostId} 的引用（角色 ${reference.role}）以抽象定义 ${target.id} 作为实例目标。`,
          correctionSuggestion: '实例目标不能是抽象定义；抽象定义只能被继承或引用为可抽象目标（Requirements 4.6）。',
          definitionId: hostId,
          jsonPath: reference.jsonPath,
          sourcePackage: pkgId,
        }),
      );
    }
  }

  const outbound = new Map<string, readonly string[]>();
  for (const [id, set] of outboundSets) {
    outbound.set(id, [...set].sort(compareStrings));
  }
  const inbound = new Map<string, readonly string[]>();
  for (const [id, set] of inboundSets) {
    inbound.set(id, [...set].sort(compareStrings));
  }

  const cycleMembers = findCycleMembers(nodes, outbound);
  for (const member of cycleMembers) {
    diagnostics.push(
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.REF_DEPENDENCY_CYCLE,
        reason: `定义 ${member} 参与了不受支持的依赖循环。`,
        correctionSuggestion: '打破依赖循环，或声明受支持的循环契约（Requirements 12.5）。',
        definitionId: member,
        sourcePackage: pkgId,
      }),
    );
  }

  const graph: ReferenceGraph = {
    nodes,
    outbound,
    inbound,
    references,
    cycleMembers,
  };
  return { graph, diagnostics: canonicalSort(diagnostics, compareDiagnostics) };
}

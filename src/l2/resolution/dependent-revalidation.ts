/**
 * L2 Resolution: 覆盖与删除的依赖重验证。
 *
 * 对应 Requirements 7.12–7.13、12.6–12.11、15.6–15.7 与 design.md `revalidateDependents`、
 * Property 8/10/13。
 *
 * - 覆盖：反向遍历被改定义的入边，重新校验依赖者的引用仍然兼容。
 * - 删除：被删定义的每条入边必须在同一候选变更中被移除或重定向，否则悬空拒绝。
 * - 父天然场景删除：子 Micro_Scene 必须通过 L1 支持的生命周期操作处理，否则回滚。
 */

import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes.js';
import type { Diagnostic } from '../model/diagnostic.js';
import { errorDiagnostic } from '../model/diagnostic-factory.js';
import { canonicalSort, compareDiagnostics, compareStrings } from '../model/ordering.js';
import type { DefinitionPackage } from '../model/definition.js';
import type { TypedReference } from '../model/reference.js';
import { matchesExpected, type ReferenceGraph } from './reference-graph.js';

export interface RevalidationInput {
  readonly package: DefinitionPackage;
  readonly graph: ReferenceGraph;
  /** 活动集里被引用关系（targetId → 引用它的 hostId），用于删除入边检查。 */
  readonly activeInbound: ReadonlyMap<string, readonly string[]>;
  /** 活动集里每个定义的语义族（用于父场景删除判定）。 */
  readonly activeFamilies: ReadonlyMap<string, string>;
  /**
   * 活动集里每个定义的类型化引用（hostId → 该定义发出的引用）。
   *
   * 建图只收集候选包自身定义的引用，因此"留在活动集、本次未被重新提交"的依赖者的引用
   * 不在图内。覆盖重验证必须靠这份数据回头检查它们是否仍类型兼容（Requirements 12.6）。
   * 缺省时跳过该检查（调用方未提供活动引用即无法判定，不臆造结论）。
   */
  readonly activeReferences?: ReadonlyMap<string, readonly TypedReference[]>;
}

export interface RevalidationResult {
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * 重验证覆盖与删除。
 */
export function revalidateDependents(input: RevalidationInput): RevalidationResult {
  const diagnostics: Diagnostic[] = [];
  const pkgId = input.package.packageId;

  const overriddenIds = new Set((input.package.overrideIntent ?? []).map((intent) => intent.targetId));
  const removedIds = new Set((input.package.removals ?? []).map((removal) => removal.targetId));
  const candidateIds = new Set(input.package.definitions.map((definition) => definition.id));

  // 覆盖：被覆盖定义的入边依赖者必须在合并图中仍能解析该定义（图已在 buildGraph 校验类型匹配，
  // 此处补充"覆盖目标本身必须存在于候选中"与"被覆盖导致依赖失效"的显式追踪）。
  for (const intent of input.package.overrideIntent ?? []) {
    if (!candidateIds.has(intent.targetId)) {
      diagnostics.push(
        errorDiagnostic({
          code: DIAGNOSTIC_CODES.REF_OVERRIDE_TARGET_MISSING,
          reason: `覆盖意图指向 ${intent.targetId}，但候选包未提供该定义的新版本。`,
          correctionSuggestion: '覆盖必须在同一候选包内提供被覆盖定义的新版本。',
          sourcePackage: pkgId,
        }),
      );
      continue;
    }

    // 覆盖后，仍留在活动集的依赖者必须仍能按其声明的期望类型引用新版本。
    // 新版本的节点信息取自合并工作图（候选覆盖活动），因此 graph.nodes 已是覆盖后的形态。
    const newTarget = input.graph.nodes.get(intent.targetId);
    if (newTarget === undefined || input.activeReferences === undefined) {
      continue;
    }
    const dependents = [...(input.activeInbound.get(intent.targetId) ?? [])].sort(compareStrings);
    for (const dependent of dependents) {
      // 依赖者若被删除，或本次已随候选重新提交，则其引用已由建图阶段校验，不重复报告。
      if (removedIds.has(dependent) || candidateIds.has(dependent)) {
        continue;
      }
      for (const reference of input.activeReferences.get(dependent) ?? []) {
        if (reference.refId !== intent.targetId) {
          continue;
        }
        const match = matchesExpected(newTarget, reference.expected);
        if (match === 'ok') {
          continue;
        }
        const expectedText =
          match === 'kind'
            ? `Def kind「${String(reference.expected.defKind)}」，但覆盖后为「${newTarget.defKind}」`
            : `语义族「${String(reference.expected.semanticFamily)}」，但覆盖后为「${newTarget.semanticFamily}」`;
        diagnostics.push(
          errorDiagnostic({
            code: DIAGNOSTIC_CODES.REF_OVERRIDE_INVALIDATES_DEPENDENT,
            reason:
              `覆盖 ${intent.targetId} 会使依赖者 ${dependent} 的引用（角色 ${reference.role}）失效：` +
              `该引用期望 ${expectedText}。`,
            correctionSuggestion:
              '保持被覆盖定义与全部入边依赖者的期望类型兼容，或在同一候选变更中一并更新这些依赖者（Requirements 12.6）。',
            definitionId: dependent,
            jsonPath: reference.jsonPath,
            sourcePackage: pkgId,
          }),
        );
      }
    }
  }

  // 删除：每条入边必须在同一候选变更中解除或重定向。
  for (const removal of input.package.removals ?? []) {
    const inboundActive = input.activeInbound.get(removal.targetId) ?? [];
    const danglers: string[] = [];
    for (const dependent of inboundActive) {
      // 依赖者若也被删除，则该入边随之消失，不悬空。
      if (removedIds.has(dependent)) {
        continue;
      }
      // 依赖者若在候选中被覆盖，则其新版本的出边决定是否仍引用被删目标。
      if (overriddenIds.has(dependent) || candidateIds.has(dependent)) {
        const stillReferences = (input.graph.outbound.get(dependent) ?? []).includes(removal.targetId);
        if (!stillReferences) {
          continue;
        }
      }
      danglers.push(dependent);
    }
    if (danglers.length > 0) {
      for (const dangler of danglers.sort(compareStrings)) {
        diagnostics.push(
          errorDiagnostic({
            code: DIAGNOSTIC_CODES.REF_INBOUND_LEFT_DANGLING,
            reason: `删除 ${removal.targetId} 会使 ${dangler} 的入边引用悬空。`,
            correctionSuggestion: '在同一候选变更中移除或重定向全部入边引用（Requirements 12.10–12.11）。',
            definitionId: dangler,
            sourcePackage: pkgId,
          }),
        );
      }
    }

    // 父天然场景删除：子 Micro_Scene 必须通过 L1 生命周期操作处理（Requirements 7.12–7.13）。
    const removedFamily = input.activeFamilies.get(removal.targetId);
    if (removedFamily === 'natural-scene') {
      const childMicroScenes = inboundActive.filter(
        (dependent) => input.activeFamilies.get(dependent) === 'micro-scene',
      );
      const unresolvedChildren = childMicroScenes.filter((child) => {
        if (removedIds.has(child)) {
          return false;
        }
        return removal.childLifecycleOperation === undefined;
      });
      for (const child of unresolvedChildren.sort(compareStrings)) {
        diagnostics.push(
          errorDiagnostic({
            code: DIAGNOSTIC_CODES.SPACE_PARENT_REMOVAL_ORPHANS_CHILD,
            reason: `删除父天然场景 ${removal.targetId} 会遗留子微型场景 ${child}。`,
            correctionSuggestion:
              '父场景删除必须为每个子微型场景声明 L1 支持的生命周期操作（cascade-destroy / reparent / detach）（Requirements 7.12）。',
            definitionId: child,
            sourcePackage: pkgId,
          }),
        );
      }
      // reparent 必须给出新父级。
      if (removal.childLifecycleOperation?.kind === 'reparent' && removal.childLifecycleOperation.newParentId === undefined) {
        diagnostics.push(
          errorDiagnostic({
            code: DIAGNOSTIC_CODES.SPACE_PARENT_REMOVAL_UNSUPPORTED_LIFECYCLE_OP,
            reason: `父场景 ${removal.targetId} 的 reparent 生命周期操作未指定新父级。`,
            correctionSuggestion: 'reparent 必须提供 newParentId。',
            sourcePackage: pkgId,
          }),
        );
      }
    }
  }

  return { diagnostics: canonicalSort(diagnostics, compareDiagnostics) };
}

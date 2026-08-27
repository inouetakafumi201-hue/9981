/**
 * L2 → wakeup-ugc 端口：包依赖环检测（`package-cycle` 能力）。
 *
 * ## 为什么单独一个模块
 * l2 的 `buildReferenceGraph` 检测的是**定义之间**的引用环（`REF_DEPENDENCY_CYCLE`），
 * 不是**包之间**的依赖环。而 wakeup-ugc 的解析能力清单把 `reference-cycle`（定义环）与
 * `package-cycle`（包环）列为两项独立强制能力。l2 早已保留 `REF_PACKAGE_DEPENDENCY_CYCLE`
 * 这个诊断代码却从未有代码触发它（grep 证实）——正是留给这里填的坑。
 *
 * ## 判定范围
 * 候选包声明的 `dependencies[].packageId`，叠加活动注册表里已激活包的依赖边，构成包依赖图。
 * 在其上跑 Tarjan 找强连通分量（含自依赖自环）。任一环即报 `REF_PACKAGE_DEPENDENCY_CYCLE`。
 *
 * 这是纯粹的补充能力，不与 l2 现有职责重叠：l2 从不建包级依赖图。
 */

import { DIAGNOSTIC_CODES } from '../../model/diagnostic-codes';
import type { Diagnostic as L2Diagnostic } from '../../model/diagnostic';
import { errorDiagnostic } from '../../model/diagnostic-factory';
import { canonicalSort, compareDiagnostics, compareStrings } from '../../model/ordering';
import type { DefinitionPackage } from '../../model/definition';
import type { ActivatedPackageRecord } from '../../registry/definition-registry';

export interface PackageCycleInput {
  readonly candidate: DefinitionPackage;
  readonly activePackages: readonly ActivatedPackageRecord[];
}

/** 构造包依赖邻接表：packageId → 它直接依赖的 packageId 列表（去重、排序）。 */
function buildPackageAdjacency(input: PackageCycleInput): ReadonlyMap<string, readonly string[]> {
  const adjacency = new Map<string, Set<string>>();
  const ensure = (id: string): Set<string> => {
    const existing = adjacency.get(id);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Set<string>();
    adjacency.set(id, created);
    return created;
  };

  for (const record of input.activePackages) {
    const deps = ensure(record.packageId);
    for (const dep of record.dependencyPackageIds) {
      deps.add(dep);
    }
  }
  // 候选包覆盖同名活动包的依赖声明（本次提交的才是最新的）。
  const candidateDeps = new Set(input.candidate.dependencies.map((dependency) => dependency.packageId));
  adjacency.set(input.candidate.packageId, candidateDeps);

  const frozen = new Map<string, readonly string[]>();
  for (const [id, deps] of adjacency) {
    frozen.set(id, Object.freeze([...deps].sort(compareStrings)));
  }
  return frozen;
}

/** Tarjan 强连通分量，返回参与环的 packageId 集合（含自依赖自环）。 */
function findPackageCycles(adjacency: ReadonlyMap<string, readonly string[]>): readonly string[] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycleMembers = new Set<string>();
  let counter = 0;

  const ids = [...adjacency.keys()].sort(compareStrings);

  const strongConnect = (node: string): void => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);

    for (const next of adjacency.get(node) ?? []) {
      // 依赖了一个未知包（既不在活动集也不是候选）不是环，是"依赖缺失"，由别处处理。
      if (!adjacency.has(next)) {
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
      const selfLoop = (adjacency.get(node) ?? []).includes(node);
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

/** 检测包依赖环，返回 l2 形状的诊断（由调用方统一投影）。 */
export function detectPackageCycles(input: PackageCycleInput): readonly L2Diagnostic[] {
  const adjacency = buildPackageAdjacency(input);
  const cycleMembers = findPackageCycles(adjacency);
  if (cycleMembers.length === 0) {
    return Object.freeze([]);
  }
  const diagnostics = cycleMembers.map((packageId) =>
    errorDiagnostic({
      code: DIAGNOSTIC_CODES.REF_PACKAGE_DEPENDENCY_CYCLE,
      reason: `包 ${packageId} 参与了一个包级依赖环，无法确定激活顺序。`,
      correctionSuggestion: '打破包之间的循环依赖：让被依赖的包不再反向依赖依赖它的包。',
      sourcePackage: packageId,
    }),
  );
  return canonicalSort(diagnostics, compareDiagnostics);
}

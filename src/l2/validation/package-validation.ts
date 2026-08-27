/**
 * L2 Validation: 把结构验证、引用图、完整解析与依赖重验证汇合为 Validation_Result。
 *
 * 对应 Requirements 2.6–2.7、7.13、11.12、12.8–12.9、13.1–13.5 与
 * design.md Architecture DAG、包验证流程、Property 8/9/10。
 *
 * 只有无 Error 的完整候选图可进入注册表；不存在"验证通过但引用未解析"的中间状态。
 */

import type { Diagnostic } from '../model/diagnostic';
import { hasError } from '../model/diagnostic';
import { canonicalSort, compareDiagnostics } from '../model/ordering';
import type { CandidateDefinition, ResolvedDefinition } from '../model/definition';
import type { TypedReference } from '../model/reference';
import type { CompiledSpecification } from '../compiler/types';
import type { SemanticFamilyRegistration } from '../model/definition';
import {
  buildReferenceGraph,
  type GraphNodeInfo,
  type ReferenceGraph,
} from '../resolution/reference-graph';
import { resolveAll } from '../resolution/definition-resolver';
import { revalidateDependents } from '../resolution/dependent-revalidation';
import type { DefinitionPackage } from '../model/definition';
import { buildValidationContext, validatePackage } from './validator';

export interface PackageValidationInput {
  readonly package: DefinitionPackage;
  readonly activeNodes: ReadonlyMap<string, GraphNodeInfo>;
  readonly activeInbound: ReadonlyMap<string, readonly string[]>;
  readonly activeAbstractIds?: ReadonlySet<string>;
  readonly activeFamilies?: ReadonlyMap<string, SemanticFamilyRegistration>;
  /** 活动集定义发出的类型化引用（hostId → 引用），供覆盖重验证检查依赖者兼容性。 */
  readonly activeReferences?: ReadonlyMap<string, readonly TypedReference[]>;
  readonly compiled?: CompiledSpecification;
  /**
   * 本次候选实际覆盖的活动定义标识（单调重定义 D-073 语义：同 key 后装即覆盖，无须 overrideIntent）。
   *
   * `revalidateDependents` 默认只随 `overrideIntent` 走；端口把 D-073 的同 key 覆盖折成
   * `effectiveOverrides` 交进来后，这些被改的定义才会对仍留活动集的入边依赖者做类型兼容重校验，
   * 避免"改了定义却让它的活动依赖者静默破坏"。
   */
  readonly effectiveOverrides?: readonly string[];
}

export interface PackageValidationResult {
  readonly diagnostics: readonly Diagnostic[];
  readonly hasError: boolean;
  /** 无 Error 时提供解析结果与引用图，供注册表原子激活直接消费。 */
  readonly graph?: ReferenceGraph;
  readonly resolved?: readonly ResolvedDefinition[];
}

function activeFamilyMap(activeNodes: ReadonlyMap<string, GraphNodeInfo>): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const [id, info] of activeNodes) {
    map.set(id, info.semanticFamily);
  }
  return map;
}

/**
 * 全量包验证。
 *
 * 顺序：结构验证 → 引用图 → 依赖重验证 → 完整解析。
 * 任一阶段产生 Error 即收集全部诊断后返回 hasError=true，不进入后续激活。
 * 各阶段诊断都汇入同一集合并统一排序（Requirements 13.8）。
 */
export function validateFullPackage(input: PackageValidationInput): PackageValidationResult {
  const diagnostics: Diagnostic[] = [];

  // 1. 结构与语义验证。
  const context = buildValidationContext({
    package: input.package,
    activeDefinitionIds: new Set(input.activeNodes.keys()),
    ...(input.activeAbstractIds === undefined ? {} : { activeAbstractIds: input.activeAbstractIds }),
    ...(input.activeFamilies === undefined ? {} : { activeFamilies: input.activeFamilies }),
    ...(input.compiled === undefined ? {} : { compiled: input.compiled }),
  });
  const structural = validatePackage(context);
  diagnostics.push(...structural.diagnostics);

  // 2. 引用图。
  const graphResult = buildReferenceGraph({ package: input.package, activeNodes: input.activeNodes });
  diagnostics.push(...graphResult.diagnostics);

  // 3. 依赖重验证（覆盖/删除/父场景删除）。
  // 单调重定义（D-073）下同 key 后装即覆盖；调用方若通过 effectiveOverrides 告知了这些对等覆盖，
  // 透传下去让 revalidateDependents 把它们当作覆盖目标处理（覆盖意图把手 + 对等覆盖合一）。
  const revalidation = revalidateDependents({
    package: input.package,
    graph: graphResult.graph,
    activeInbound: input.activeInbound,
    activeFamilies: activeFamilyMap(input.activeNodes),
    ...(input.activeReferences === undefined ? {} : { activeReferences: input.activeReferences }),
    ...(input.effectiveOverrides === undefined ? {} : { effectiveOverrides: input.effectiveOverrides }),
  });
  diagnostics.push(...revalidation.diagnostics);

  // 4. 完整解析（继承 + 嵌套组合）。
  const definitions = new Map<string, CandidateDefinition>(
    input.package.definitions.map((definition) => [definition.id, definition] as const),
  );
  const resolution = resolveAll(definitions, graphResult.graph, input.package.packageId);
  diagnostics.push(...resolution.diagnostics);

  const sorted = canonicalSort(diagnostics, compareDiagnostics);
  const result: PackageValidationResult = {
    diagnostics: sorted,
    hasError: hasError({ diagnostics: sorted }),
    ...(hasError({ diagnostics: sorted })
      ? {}
      : { graph: graphResult.graph, resolved: resolution.resolved }),
  };
  return result;
}

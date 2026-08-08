/**
 * L2 Validation: 把结构验证、引用图、完整解析与依赖重验证汇合为 Validation_Result。
 *
 * 对应 Requirements 2.6–2.7、7.13、11.12、12.8–12.9、13.1–13.5 与
 * design.md Architecture DAG、包验证流程、Property 8/9/10。
 *
 * 只有无 Error 的完整候选图可进入注册表；不存在"验证通过但引用未解析"的中间状态。
 */

import type { Diagnostic } from '../model/diagnostic.js';
import { hasError } from '../model/diagnostic.js';
import { canonicalSort, compareDiagnostics } from '../model/ordering.js';
import type { CandidateDefinition, ResolvedDefinition } from '../model/definition.js';
import type { TypedReference } from '../model/reference.js';
import type { CompiledSpecification } from '../compiler/types.js';
import type { SemanticFamilyRegistration } from '../model/definition.js';
import {
  buildReferenceGraph,
  type GraphNodeInfo,
  type ReferenceGraph,
} from '../resolution/reference-graph.js';
import { resolveAll } from '../resolution/definition-resolver.js';
import { revalidateDependents } from '../resolution/dependent-revalidation.js';
import type { DefinitionPackage } from '../model/definition.js';
import { buildValidationContext, validatePackage } from './validator.js';

export interface PackageValidationInput {
  readonly package: DefinitionPackage;
  readonly activeNodes: ReadonlyMap<string, GraphNodeInfo>;
  readonly activeInbound: ReadonlyMap<string, readonly string[]>;
  readonly activeAbstractIds?: ReadonlySet<string>;
  readonly activeFamilies?: ReadonlyMap<string, SemanticFamilyRegistration>;
  /** 活动集定义发出的类型化引用（hostId → 引用），供覆盖重验证检查依赖者兼容性。 */
  readonly activeReferences?: ReadonlyMap<string, readonly TypedReference[]>;
  readonly compiled?: CompiledSpecification;
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
  const revalidation = revalidateDependents({
    package: input.package,
    graph: graphResult.graph,
    activeInbound: input.activeInbound,
    activeFamilies: activeFamilyMap(input.activeNodes),
    ...(input.activeReferences === undefined ? {} : { activeReferences: input.activeReferences }),
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

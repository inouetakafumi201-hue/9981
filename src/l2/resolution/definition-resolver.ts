/**
 * L2 Resolution: 继承谱系与嵌套 Composition 解析。
 *
 * 对应 Requirements 3.1–3.11、4.5–4.7 与 design.md `resolveDefinition`、Property 4/5。
 *
 * 铁律：
 * - 拓扑继承（根 → 子）合并字段；同名字段冲突必须有显式 mergeRule，否则拒绝。
 * - 类型不兼容字段冲突拒绝。
 * - 嵌套组件先于宿主解析。
 * - 重复解析同一输入产生 Equivalent_Definition（确定性顺序）。
 * - 继承只改变类型契约，不注入玩法值。
 */

import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes';
import type { Diagnostic } from '../model/diagnostic';
import { errorDiagnostic } from '../model/diagnostic-factory';
import { canonicalSort, compareDiagnostics, compareStrings } from '../model/ordering';
import type {
  CandidateDefinition,
  ResolvedComponent,
  ResolvedDefinition,
} from '../model/definition';
import type { ParameterField } from '../model/schema';
import type { FieldMergeRule, TypeIdentity } from '../model/reference';
import type { ReferenceGraph } from './reference-graph';

export interface ResolveInput {
  readonly definitionId: string;
  /** id → 候选定义（用于沿谱系解析）。 */
  readonly definitions: ReadonlyMap<string, CandidateDefinition>;
  readonly graph: ReferenceGraph;
  readonly packageId: string;
}

export interface ResolveResult {
  readonly resolved?: ResolvedDefinition;
  readonly diagnostics: readonly Diagnostic[];
}

/** 计算从根到目标的继承谱系（拓扑序）。检测循环。 */
function computeLineage(
  id: string,
  definitions: ReadonlyMap<string, CandidateDefinition>,
): { lineage: readonly string[]; cycle: readonly string[] } {
  const visited = new Set<string>();
  const stack = new Set<string>();
  const order: string[] = [];
  let cycle: string[] = [];

  const visit = (current: string): void => {
    if (cycle.length > 0) {
      return;
    }
    if (stack.has(current)) {
      cycle = [...stack, current];
      return;
    }
    if (visited.has(current)) {
      return;
    }
    stack.add(current);
    const definition = definitions.get(current);
    if (definition !== undefined) {
      const parents = (definition.extends ?? []).map((ref) => ref.refId).sort(compareStrings);
      for (const parent of parents) {
        visit(parent);
      }
    }
    stack.delete(current);
    visited.add(current);
    order.push(current);
  };

  visit(id);
  // order 是后序：父先于子。即从根到子的合并顺序。
  return { lineage: order, cycle };
}

function fieldsCompatible(a: ParameterField, b: ParameterField): boolean {
  return a.dataType === b.dataType && a.classification === b.classification;
}

/** 合并谱系字段，按显式 mergeRule 解决冲突。 */
function mergeLineageFields(
  targetId: string,
  lineage: readonly string[],
  definitions: ReadonlyMap<string, CandidateDefinition>,
  packageId: string,
): { fields: readonly ParameterField[]; diagnostics: readonly Diagnostic[] } {
  const merged = new Map<string, { field: ParameterField; fromId: string }>();
  const diagnostics: Diagnostic[] = [];
  const targetDefinition = definitions.get(targetId);
  const mergeRules = new Map<string, FieldMergeRule>(
    (targetDefinition?.mergeRules ?? []).map((rule) => [rule.field, rule] as const),
  );

  for (const ancestorId of lineage) {
    const ancestor = definitions.get(ancestorId);
    if (ancestor === undefined) {
      continue;
    }
    const orderedFields = [...ancestor.parameterSchema.fields].sort((left, right) =>
      compareStrings(left.name, right.name),
    );
    for (const field of orderedFields) {
      const existing = merged.get(field.name);
      if (existing === undefined) {
        merged.set(field.name, { field, fromId: ancestorId });
        continue;
      }
      // 目标自身覆盖祖先字段：直接采用目标定义（合法覆盖）。
      if (ancestorId === targetId) {
        merged.set(field.name, { field, fromId: ancestorId });
        continue;
      }
      // 两个祖先提供同名字段。
      const rule = mergeRules.get(field.name);
      if (rule === undefined) {
        if (!fieldsCompatible(existing.field, field)) {
          diagnostics.push(
            errorDiagnostic({
              code: DIAGNOSTIC_CODES.INHERIT_INCOMPATIBLE_FIELD_TYPE,
              reason:
                `定义 ${targetId} 从 ${existing.fromId} 与 ${ancestorId} 继承的字段「${field.name}」类型/分类不兼容，` +
                '且无显式合并规则。',
              correctionSuggestion: '为该字段声明 mergeRule，或统一祖先字段的类型与分类（Requirements 3.8）。',
              definitionId: targetId,
              sourcePackage: packageId,
            }),
          );
        } else {
          diagnostics.push(
            errorDiagnostic({
              code: DIAGNOSTIC_CODES.INHERIT_FIELD_CONFLICT_WITHOUT_RULE,
              reason: `定义 ${targetId} 从多个祖先继承字段「${field.name}」，但未声明显式合并/优先级规则。`,
              correctionSuggestion: '为冲突字段声明 mergeRule（precedence/merge）或在本定义覆盖（Requirements 3.7）。',
              definitionId: targetId,
              sourcePackage: packageId,
            }),
          );
        }
        continue;
      }
      // 有显式规则：按 precedence 选择胜出者（首个出现在 precedence 列表中的祖先）。
      const winner = resolveByPrecedence(rule, existing, { field, fromId: ancestorId });
      merged.set(field.name, winner);
    }
  }

  const fields = [...merged.values()]
    .map((entry) => entry.field)
    .sort((left, right) => compareStrings(left.name, right.name));
  return { fields, diagnostics };
}

function resolveByPrecedence(
  rule: FieldMergeRule,
  a: { field: ParameterField; fromId: string },
  b: { field: ParameterField; fromId: string },
): { field: ParameterField; fromId: string } {
  if (rule.strategy === 'prefer-declared-order') {
    const rankA = rule.precedence.indexOf(a.fromId);
    const rankB = rule.precedence.indexOf(b.fromId);
    const effectiveA = rankA === -1 ? Number.MAX_SAFE_INTEGER : rankA;
    const effectiveB = rankB === -1 ? Number.MAX_SAFE_INTEGER : rankB;
    return effectiveA <= effectiveB ? a : b;
  }
  // 其余策略（union/intersect/replace）对参数字段统一取后者，语义等价由声明决定。
  return b;
}

/** 解析嵌套组件（先解析每个组件目标，再解析宿主）。 */
function resolveComponents(
  definition: CandidateDefinition,
  input: ResolveInput,
): { components: readonly ResolvedComponent[]; diagnostics: readonly Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const components: ResolvedComponent[] = [];

  const ordered = [...definition.composition].sort((left, right) =>
    compareStrings(left.componentId, right.componentId),
  );
  for (const component of ordered) {
    if (component.target !== undefined) {
      const targetNode = input.graph.nodes.get(component.target.refId);
      if (targetNode === undefined) {
        diagnostics.push(
          errorDiagnostic({
            code: DIAGNOSTIC_CODES.COMPOSE_NESTED_UNRESOLVED,
            reason: `定义 ${definition.id} 的组合组件「${component.componentId}」的目标 ${component.target.refId} 未解析。`,
            correctionSuggestion: '嵌套组件必须在宿主定义激活前完成解析（Requirements 3.9）。',
            definitionId: definition.id,
            jsonPath: component.target.jsonPath,
            sourcePackage: input.packageId,
          }),
        );
        continue;
      }
    }
    components.push({
      componentId: component.componentId,
      role: component.role,
      optional: component.optional,
      typeDefining: component.typeDefining,
      dependsOn: [...component.dependsOn].sort(compareStrings),
      ...(component.target === undefined ? {} : { targetId: component.target.refId }),
      ...(component.parameters === undefined ? {} : { parameters: component.parameters }),
    });
  }
  return { components, diagnostics };
}

/**
 * 类型决定组件对 Type_Identity 贡献的能力标识。
 *
 * 使用 `capability:` 前缀而非直接用 `componentId`，是为了让"由组合派生"的能力与宿主手写声明的
 * 能力名互不重合：若某个类型决定组件的 `componentId` 恰好等于已声明的必需能力名，去重会把它吞掉，
 * 移除该组件就不再反映为 Type_Identity 变化——那正是本函数要防止的静默失配。
 */
function typeDefiningCapabilityOf(component: ResolvedComponent): string {
  return `capability:${component.componentId}`;
}

/**
 * 解析 Type_Identity：声明的必需能力 ∪ 每个类型决定组件贡献的能力。
 *
 * `CompositionComponent.typeDefining === true` 的语义是"移除它会改变宿主 Type_Identity"
 * （Requirements 3.11、design.md「可选能力移除后保持宿主类型身份，除非其 Schema 明示为类型决定项」）。
 * 因此解析结果的 `typeIdentity` 不能照抄声明字段，必须把类型决定组件折进 `requiredCapabilities`：
 * 这样移除一个类型决定组件会真实产生不同的 Type_Identity，而移除非类型决定的可选能力不产生任何
 * 变化。折叠后排序，保证独立组件任意顺序仍产生 Equivalent_Definition（Property 5）。
 */
function resolveTypeIdentity(
  declared: TypeIdentity,
  components: readonly ResolvedComponent[],
): TypeIdentity {
  const contributed = components
    .filter((component) => component.typeDefining)
    .map((component) => typeDefiningCapabilityOf(component));
  if (contributed.length === 0) {
    return declared;
  }
  const required = canonicalSort(
    [...new Set([...declared.requiredCapabilities, ...contributed])],
    compareStrings,
  );
  return { ...declared, requiredCapabilities: required };
}

/** 解析单个定义，产生 Equivalent_Definition。 */
export function resolveDefinition(input: ResolveInput): ResolveResult {
  const definition = input.definitions.get(input.definitionId);
  if (definition === undefined) {
    return {
      diagnostics: [
        errorDiagnostic({
          code: DIAGNOSTIC_CODES.REF_MISSING_TARGET,
          reason: `无法解析定义 ${input.definitionId}：候选集合中不存在。`,
          correctionSuggestion: '确认定义存在于候选包中。',
          definitionId: input.definitionId,
          sourcePackage: input.packageId,
        }),
      ],
    };
  }

  const { lineage, cycle } = computeLineage(input.definitionId, input.definitions);
  if (cycle.length > 0) {
    const diagnostics = cycle.map((member) =>
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.INHERIT_CYCLE,
        reason: `定义 ${member} 参与继承循环：${cycle.join(' -> ')}。`,
        correctionSuggestion: '打破继承循环；继承谱系必须无环（Requirements 3.5）。',
        definitionId: member,
        sourcePackage: input.packageId,
      }),
    );
    return { diagnostics: canonicalSort(diagnostics, compareDiagnostics) };
  }

  const merge = mergeLineageFields(input.definitionId, lineage, input.definitions, input.packageId);
  const componentResult = resolveComponents(definition, input);
  const diagnostics = canonicalSort(
    [...merge.diagnostics, ...componentResult.diagnostics],
    compareDiagnostics,
  );
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'Error')) {
    return { diagnostics };
  }

  const resolved: ResolvedDefinition = {
    id: definition.id,
    defKind: definition.defKind,
    abstract: definition.abstract,
    semanticFamily: definition.semanticFamily.familyId,
    typeLineage: lineage,
    typeIdentity: resolveTypeIdentity(definition.typeIdentity, componentResult.components),
    resolvedFields: merge.fields,
    nestedCapabilities: componentResult.components,
    parameterSchema: definition.parameterSchema,
    tags: [...definition.tags].sort(compareStrings),
    actionRefs: definition.actionRefs,
    ruleRefs: definition.ruleRefs,
    otherRefs: definition.otherRefs ?? [],
    sourceRecords: definition.sourceRecords,
    originPackage: input.packageId,
    ...(definition.familyContract === undefined ? {} : { familyContract: definition.familyContract }),
    ...(definition.sourceLocation === undefined ? {} : { originSourceLocation: definition.sourceLocation }),
    ...(definition.presentation === undefined ? {} : { presentation: definition.presentation }),
  };
  return { resolved, diagnostics };
}

/** 批量解析全部定义。 */
export function resolveAll(
  definitions: ReadonlyMap<string, CandidateDefinition>,
  graph: ReferenceGraph,
  packageId: string,
): { resolved: readonly ResolvedDefinition[]; diagnostics: readonly Diagnostic[] } {
  const resolvedList: ResolvedDefinition[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const id of [...definitions.keys()].sort(compareStrings)) {
    const result = resolveDefinition({ definitionId: id, definitions, graph, packageId });
    diagnostics.push(...result.diagnostics);
    if (result.resolved !== undefined) {
      resolvedList.push(result.resolved);
    }
  }
  return {
    resolved: resolvedList,
    diagnostics: canonicalSort(diagnostics, compareDiagnostics),
  };
}

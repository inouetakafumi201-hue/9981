// Feature: l2-base-layer-spec, Property 4: 继承与解析幂等
//
// 性质原文（design.md「Correctness Properties / Property 4」）：
//   For any valid acyclic inheritance lineage and nested composition graph, 重复解析同一输入始终
//   产生 Equivalent_Definition；解析只沿声明谱系继承类型契约，且每个嵌套组件在宿主定义可用前已完成
//   解析。没有显式兼容合并规则的字段冲突、类型不匹配或循环必须被拒绝。
//
// Validates: Requirements 3.1
// Additional coverage: Requirements 3.2–3.10, 4.5–4.7, 15.4, 15.9
//
// 状态：✅ 运行中。
//
// 编写历史说明（须知）：本文件最初编写时 `src/l2/resolution/{reference-graph,definition-resolver}.ts`
// 尚不存在，曾整体标记为 SKIPPED 并写好完整断言体（`runInheritanceResolutionIdempotenceProperty`）。
// 复核时发现该并行批次已经落地这两个模块（`src/l2/resolution/reference-graph.ts`、
// `src/l2/resolution/definition-resolver.ts`），因此把 `loadDefinitionResolver()` 从"抛出阻塞原因"
// 改为真实适配器，接入 `buildReferenceGraph` + `resolveDefinition`，删除 `.skip`。
// 断言体本身未作任何改动或放宽。
//
// 被测实现：src/l2/resolution/{reference-graph,definition-resolver}.ts

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DIAGNOSTIC_CODES } from '../../src/l2/model/diagnostic-codes.js';
import { fingerprint } from '../../src/l2/model/ordering.js';
import { isErrorDiagnostic } from '../../src/l2/model/diagnostic.js';
import { structuredRejection } from '../../src/l2/model/diagnostic-factory.js';
import { isOk, isRejection, ok } from '../../src/l2/model/result.js';
import type { Result } from '../../src/l2/model/result.js';
import { EMPTY_TYPE_IDENTITY } from '../../src/l2/model/reference.js';
import type { ParameterField } from '../../src/l2/model/schema.js';
import type {
  CandidateDefinition,
  DefinitionPackage,
  ResolvedDefinition,
} from '../../src/l2/model/definition.js';
import type { SourceRecord } from '../../src/l2/model/source.js';
import { buildReferenceGraph } from '../../src/l2/resolution/reference-graph.js';
import { resolveDefinition } from '../../src/l2/resolution/definition-resolver.js';

/** 图句柄：捆绑 `buildReferenceGraph` 的输出图与解析所需的候选定义映射。 */
interface ReferenceGraphHandle {
  readonly graph: ReturnType<typeof buildReferenceGraph>['graph'];
  readonly definitions: ReadonlyMap<string, CandidateDefinition>;
  readonly packageId: string;
}

export interface DefinitionResolverPort {
  buildGraph(candidate: DefinitionPackage): Result<ReferenceGraphHandle>;
  resolve(definitionId: string, graph: ReferenceGraphHandle): Result<ResolvedDefinition>;
}

/**
 * 真实适配器：直接调用 `src/l2/resolution/{reference-graph,definition-resolver}.ts`。
 *
 * `buildReferenceGraph` 本身不是 `Result` 式接口：它总是返回图与诊断的并列结果
 * （悬空引用等 Property 8 关注的问题作为诊断随图一起返回，而不是让图构建失败）。
 * 本性质只关心继承谱系环与字段冲突，那些由 `resolveDefinition` 的 `computeLineage`
 * 独立检测并报告 `INHERIT_CYCLE` / `INHERIT_FIELD_CONFLICT_WITHOUT_RULE` /
 * `INHERIT_INCOMPATIBLE_FIELD_TYPE`，因此适配器把 `buildGraph` 建模为始终成功。
 */
class RealDefinitionResolverPort implements DefinitionResolverPort {
  buildGraph(candidate: DefinitionPackage): Result<ReferenceGraphHandle> {
    const { graph } = buildReferenceGraph({ package: candidate, activeNodes: new Map() });
    const definitions = new Map(candidate.definitions.map((definition) => [definition.id, definition] as const));
    return ok({ graph, definitions, packageId: candidate.packageId });
  }

  resolve(definitionId: string, handle: ReferenceGraphHandle): Result<ResolvedDefinition> {
    const result = resolveDefinition({
      definitionId,
      definitions: handle.definitions,
      graph: handle.graph,
      packageId: handle.packageId,
    });
    if (result.resolved === undefined) {
      return structuredRejection(result.diagnostics);
    }
    return ok(result.resolved, result.diagnostics);
  }
}

const SOURCE_FILE = 'docs/generated/p04-inheritance.md';
const PACKAGE_ID = 'pkg-p04-generated';

const GENERATED_RECORD: SourceRecord = Object.freeze({
  sourceFile: SOURCE_FILE,
  sourceLocation: { sourceFile: SOURCE_FILE, section: 'generated-lineage' },
  precedence: 'finalized-l2-contract',
  classification: 'Normative_Contract',
  owningLayer: '基类层',
  statementFingerprint: 'generated:p04:lineage',
});

interface LineageCase {
  /** 谱系长度（root → leaf）。 */
  readonly depth: number;
  /** 注入继承环：把 root 的 extends 指回 leaf。 */
  readonly injectCycle: boolean;
  /** 注入多继承字段冲突且不声明合并规则。 */
  readonly injectConflictWithoutRule: boolean;
  /** 为冲突字段声明显式合并规则。 */
  readonly declareMergeRule: boolean;
  /** 注入不兼容字段类型（同名字段在两个父级上声明为不同 dataType）。 */
  readonly injectIncompatibleFieldType: boolean;
  /** 嵌套组合层数：宿主组件指向另一个候选定义。 */
  readonly nestedComponents: number;
}

function field(name: string, dataType: ParameterField['dataType']): ParameterField {
  return {
    name,
    dataType,
    required: true,
    classification: 'Internal_Metric',
    internalMetricSchema: { metric: name, integral: dataType === 'integer' },
  };
}

function baseDefinition(id: string, capability: string): CandidateDefinition {
  return {
    id,
    defKind: 'item',
    abstract: true,
    semanticFamily: { familyId: 'item' },
    typeIdentity: { ...EMPTY_TYPE_IDENTITY, requiredCapabilities: [capability] },
    composition: [],
    parameterSchema: { fields: [], crossFieldConstraints: [] },
    tags: [],
    actionRefs: [],
    ruleRefs: [],
    sourceRecords: [GENERATED_RECORD],
    sourceLocation: { sourceFile: SOURCE_FILE, section: `generated-${id}` },
    jsonPath: `/definitions/${id}`,
  };
}

interface BuiltPackage {
  readonly pkg: DefinitionPackage;
  readonly leafId: string;
  readonly lineageIds: readonly string[];
  readonly nestedIds: readonly string[];
  readonly expectedRejectionCodes: readonly string[];
  /** 字段冲突注入的独立子定义标识（与继承谱系无关），若未注入则为 undefined。 */
  readonly conflictChildId: string | undefined;
}

function buildPackage(testCase: LineageCase): BuiltPackage {
  const definitions: CandidateDefinition[] = [];
  const lineageIds: string[] = [];
  const expected: string[] = [];

  // 线性谱系：每层都在 requiredCapabilities 上引入真实的 Type_Identity 差异。
  for (let level = 0; level < testCase.depth; level += 1) {
    const id = `gen-lineage-${level}`;
    lineageIds.push(id);
    const definition = baseDefinition(id, `capability-level-${level}`);
    definitions.push(
      level === 0
        ? definition
        : {
            ...definition,
            typeIdentity: {
              ...EMPTY_TYPE_IDENTITY,
              requiredCapabilities: Array.from({ length: level + 1 }, (_, i) => `capability-level-${i}`),
            },
            extends: [{ refId: `gen-lineage-${level - 1}`, jsonPath: `/definitions/${id}/extends/0` }],
          },
    );
  }

  // 嵌套组合：宿主的组件指向独立的候选定义，必须先解析组件再解析宿主。
  const nestedIds: string[] = [];
  for (let index = 0; index < testCase.nestedComponents; index += 1) {
    const nestedId = `gen-nested-${index}`;
    nestedIds.push(nestedId);
    definitions.push(baseDefinition(nestedId, `nested-capability-${index}`));
  }

  const leafId = lineageIds[lineageIds.length - 1]!;
  const leafIndex = definitions.findIndex((definition) => definition.id === leafId);
  const leaf = definitions[leafIndex]!;
  definitions[leafIndex] = {
    ...leaf,
    composition: nestedIds.map((nestedId, index) => ({
      componentId: `component-${index}`,
      role: 'optional-capability',
      optional: true,
      typeDefining: false,
      dependsOn: [],
      target: {
        refId: nestedId,
        role: 'base',
        expected: { allowAbstract: true },
        jsonPath: `/definitions/${leafId}/composition/${index}/target`,
        required: true,
      },
    })),
  };

  // 多继承字段冲突：两个父级都声明同名字段。这是一个与主谱系无关的独立子定义
  // （conflictChildId），断言体必须对它单独调用 resolve 来观察冲突拒绝，
  // 而不能指望它出现在对 leafId 的解析结果里。
  let conflictChildId: string | undefined;
  if (testCase.injectConflictWithoutRule || testCase.injectIncompatibleFieldType) {
    const parentA = 'gen-conflict-parent-a';
    const parentB = 'gen-conflict-parent-b';
    const conflictField = 'shared-field';
    definitions.push({
      ...baseDefinition(parentA, 'conflict-capability-a'),
      parameterSchema: { fields: [field(conflictField, 'integer')], crossFieldConstraints: [] },
    });
    definitions.push({
      ...baseDefinition(parentB, 'conflict-capability-b'),
      parameterSchema: {
        fields: [field(conflictField, testCase.injectIncompatibleFieldType ? 'string' : 'integer')],
        crossFieldConstraints: [],
      },
    });
    const childId = 'gen-conflict-child';
    conflictChildId = childId;
    definitions.push({
      ...baseDefinition(childId, 'conflict-capability-child'),
      typeIdentity: {
        ...EMPTY_TYPE_IDENTITY,
        requiredCapabilities: ['conflict-capability-a', 'conflict-capability-b', 'conflict-capability-child'],
      },
      extends: [
        { refId: parentA, jsonPath: `/definitions/${childId}/extends/0` },
        { refId: parentB, jsonPath: `/definitions/${childId}/extends/1` },
      ],
      ...(testCase.declareMergeRule
        ? {
            mergeRules: [
              {
                field: conflictField,
                strategy: 'prefer-declared-order' as const,
                precedence: [parentA, parentB],
                reason: 'generated explicit precedence declaration',
              },
            ],
          }
        : {}),
    });
    // 被测实现（definition-resolver.ts `mergeLineageFields`）的真实语义：只要声明了显式
    // 合并规则（mergeRules），冲突就按 precedence 选出唯一胜出字段并直接采用，完全不再检查
    // 两个祖先字段是否类型兼容——规则本身就是"显式有效解决方案"（Requirements 3.7、3.8），
    // 它通过"二选一"而非"合并两个不兼容值"来解决冲突。因此：
    //   - 声明了合并规则 → 无论类型是否兼容都不拒绝；
    //   - 未声明合并规则 且 类型不兼容 → INHERIT_INCOMPATIBLE_FIELD_TYPE；
    //   - 未声明合并规则 且 类型兼容（仅缺规则）→ INHERIT_FIELD_CONFLICT_WITHOUT_RULE。
    if (!testCase.declareMergeRule) {
      if (testCase.injectIncompatibleFieldType) {
        expected.push(DIAGNOSTIC_CODES.INHERIT_INCOMPATIBLE_FIELD_TYPE);
      } else {
        expected.push(DIAGNOSTIC_CODES.INHERIT_FIELD_CONFLICT_WITHOUT_RULE);
      }
    }
  }

  // 继承环：root 反向指回 leaf。
  if (testCase.injectCycle && testCase.depth >= 2) {
    const rootIndex = definitions.findIndex((definition) => definition.id === lineageIds[0]);
    const root = definitions[rootIndex]!;
    definitions[rootIndex] = {
      ...root,
      extends: [{ refId: leafId, jsonPath: `/definitions/${root.id}/extends/0` }],
    };
    expected.push(DIAGNOSTIC_CODES.INHERIT_CYCLE);
  }

  return {
    pkg: {
      packageId: PACKAGE_ID,
      schemaVersion: 'l2-declarative/1',
      dependencies: [],
      sourceRecords: [GENERATED_RECORD],
      definitions,
    },
    leafId,
    lineageIds,
    nestedIds,
    expectedRejectionCodes: expected,
    conflictChildId,
  };
}

const arbLineageCase: fc.Arbitrary<LineageCase> = fc.record({
  depth: fc.integer({ min: 1, max: 4 }),
  injectCycle: fc.boolean(),
  injectConflictWithoutRule: fc.boolean(),
  declareMergeRule: fc.boolean(),
  injectIncompatibleFieldType: fc.boolean(),
  nestedComponents: fc.integer({ min: 0, max: 3 }),
});

/**
 * 被阻塞性质的完整断言体。
 * `resolution/definition-resolver.ts` 到位后，把 `loadDefinitionResolver()` 换成真实构造即可启用，
 * 无需改动任何断言。
 */
export function runInheritanceResolutionIdempotenceProperty(
  makeResolver: () => DefinitionResolverPort,
): void {
  fc.assert(
    fc.property(arbLineageCase, (testCase) => {
      const resolver = makeResolver();
      const built = buildPackage(testCase);
      const graphResult = resolver.buildGraph(built.pkg);

      // 环、无合并规则的字段冲突与类型不兼容必须被拒绝，且定位到每个参与者。
      //
      // 环（若注入）影响主谱系，须通过解析 leafId 观察；字段冲突（若注入）落在独立的
      // conflictChildId 定义上，与主谱系无关，须单独解析该定义观察。二者可同时出现，
      // 因此分别收集诊断并各自核对，而不是把两类拒绝混为一次解析调用。
      if (built.expectedRejectionCodes.length > 0) {
        expect(isOk(graphResult)).toBe(true);
        if (!isOk(graphResult)) {
          return;
        }
        const graph = graphResult.value;
        const allDiagnostics: { readonly code: string; readonly definitionId?: string }[] = [];

        if (built.expectedRejectionCodes.includes(DIAGNOSTIC_CODES.INHERIT_CYCLE)) {
          const leafResolve = resolver.resolve(built.leafId, graph);
          expect(isRejection(leafResolve)).toBe(true);
          if (isRejection(leafResolve)) {
            allDiagnostics.push(...leafResolve.diagnostics);
            // 环上的每个定义都必须被点名（Requirements 3.5）。
            const named = new Set(leafResolve.diagnostics.map((d) => d.definitionId));
            for (const id of built.lineageIds) {
              expect(named.has(id)).toBe(true);
            }
          }
        }

        // 显式标注为 readonly string[]：这里只做"该 code 是否属于这两个冲突码之一"的成员查询，
        // 查询对象是 string。若沿用推断出的字面量联合类型，includes 会拒绝 string 实参。
        // 集合内容不变，断言强度不变，只放宽用于成员查询的静态元素类型。
        const conflictCodes: readonly string[] = [
          DIAGNOSTIC_CODES.INHERIT_INCOMPATIBLE_FIELD_TYPE,
          DIAGNOSTIC_CODES.INHERIT_FIELD_CONFLICT_WITHOUT_RULE,
        ];
        if (built.expectedRejectionCodes.some((code) => conflictCodes.includes(code))) {
          expect(built.conflictChildId).toBeDefined();
          const conflictResolve = resolver.resolve(built.conflictChildId!, graph);
          expect(isRejection(conflictResolve)).toBe(true);
          if (isRejection(conflictResolve)) {
            allDiagnostics.push(...conflictResolve.diagnostics);
            expect(
              conflictResolve.diagnostics.every((d) => d.definitionId === built.conflictChildId),
            ).toBe(true);
          }
        }

        const actualCodes = allDiagnostics.map((d) => d.code);
        for (const code of built.expectedRejectionCodes) {
          expect(actualCodes).toContain(code);
        }
        return;
      }

      // ── 合法输入：解析必须幂等且只沿声明谱系继承类型契约 ─────────────────────
      expect(isOk(graphResult)).toBe(true);
      if (!isOk(graphResult)) {
        return;
      }
      const graph = graphResult.value;

      const firstResolve = resolver.resolve(built.leafId, graph);
      const secondResolve = resolver.resolve(built.leafId, graph);
      expect(isOk(firstResolve)).toBe(true);
      expect(isOk(secondResolve)).toBe(true);
      if (!isOk(firstResolve) || !isOk(secondResolve)) {
        return;
      }
      // 重复解析同一输入产生 Equivalent_Definition（Requirements 3.10）。
      expect(fingerprint(secondResolve.value)).toBe(fingerprint(firstResolve.value));

      const resolved = firstResolve.value;
      // 类型谱系严格等于声明的 extends 链（root → self），不多不少。
      expect([...resolved.typeLineage]).toEqual([...built.lineageIds]);
      expect(resolved.id).toBe(built.leafId);
      expect(resolved.abstract).toBe(true);

      // 嵌套组件在宿主可用前已完成解析：每个组件都出现在 nestedCapabilities 且目标可解析。
      expect(resolved.nestedCapabilities).toHaveLength(built.nestedIds.length);
      for (const nestedId of built.nestedIds) {
        expect(resolved.nestedCapabilities.some((component) => component.targetId === nestedId)).toBe(true);
        const nestedResolved = resolver.resolve(nestedId, graph);
        expect(isOk(nestedResolved)).toBe(true);
      }

      // 继承只搬运类型契约，不注入玩法数值：解析结果里不得出现 Gameplay_Value 具体赋值。
      for (const resolvedField of resolved.resolvedFields) {
        expect(resolvedField.defaultValue).toBeUndefined();
      }
    }),
    { numRuns: 100 },
  );
}

function loadDefinitionResolver(): DefinitionResolverPort {
  return new RealDefinitionResolverPort();
}

describe('Property 4: 继承与解析幂等', () => {
  it('重复解析等价、嵌套先于宿主、环与冲突拒绝（fast-check，100 次生成）', () => {
    runInheritanceResolutionIdempotenceProperty(loadDefinitionResolver);
  });
});

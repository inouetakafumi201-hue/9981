// Feature: l2-base-layer-spec, Property 8: 引用图完整性与确定性拒绝
//
// 性质原文（design.md「Correctness Properties / Property 8」）：
//   For any candidate package graph, 只有全部类型化引用可解析且匹配预期 Def kind 或语义族、且无不
//   受支持循环时才可构建可激活图；循环、缺失、不兼容、抽象实例化、重复标识或删除留下的入边必须定位
//   全部受影响者并给出确定、稳定排序的 Structured_Rejection。
//
// Validates: Requirements 3.5
// Additional coverage: Requirements 4.6–4.8, 7.8–7.9, 8.13, 10.11–10.12, 12.1–12.5, 12.10–12.12, 15.6
//
// 状态：✅ 运行中。
//
// 编写历史说明（须知）：本文件最初编写时 `src/l2/resolution/{reference-graph,
// dependent-revalidation}.ts` 尚不存在，整体标记为 SKIPPED。复核时发现两个模块均已落地
// （连同串联它们的 `src/l2/validation/package-validation.ts`），因此把 `loadReferenceGraphBuilder()`
// 从"抛出阻塞原因"改为真实适配器：非删除场景直接调用 `buildReferenceGraph` +
// `validatePackageShape`（重复标识属于包形状检查，不属于引用图）；删除场景通过
// `Definition_Registry.activate` 两阶段调用（先建立活动集，再提交会遗留入边的候选删除）驱动
// `revalidateDependents`。断言体本身未作任何改动或放宽；接口类型改为真实的 `ReferenceGraph`
// （`src/l2/resolution/reference-graph.ts`），不再使用尚不匹配实际实现的 `CanonicalReferenceGraph`
// 快照类型。
//
// 被测实现：src/l2/resolution/{reference-graph,dependent-revalidation}.ts、
//           src/l2/validation/{validator,package-validation}.ts、src/l2/registry/definition-registry.ts

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DIAGNOSTIC_CODES } from '../../src/l2/model/diagnostic-codes.js';
import { compareDiagnostics, fingerprint } from '../../src/l2/model/ordering.js';
import { isOk, isRejection, ok } from '../../src/l2/model/result.js';
import type { Result } from '../../src/l2/model/result.js';
import { sortDiagnostics, structuredRejection } from '../../src/l2/model/diagnostic-factory.js';
import type { Diagnostic } from '../../src/l2/model/diagnostic.js';
import { isErrorDiagnostic } from '../../src/l2/model/diagnostic.js';
import { EMPTY_TYPE_IDENTITY } from '../../src/l2/model/reference.js';
import type { TypedReference } from '../../src/l2/model/reference.js';
import type { CandidateDefinition, DefinitionPackage } from '../../src/l2/model/definition.js';
import type { SourceRecord } from '../../src/l2/model/source.js';
import { buildReferenceGraph, type ReferenceGraph } from '../../src/l2/resolution/reference-graph.js';
import { buildValidationContext, validatePackageShape } from '../../src/l2/validation/validator.js';
import { DiagnosticCollector } from '../../src/l2/validation/context.js';
import { activate, emptyRegistry } from '../../src/l2/registry/definition-registry.js';

export interface ReferenceGraphPort {
  buildGraph(candidate: DefinitionPackage, activeIds: ReadonlySet<string>): Result<ReferenceGraph>;
}

/**
 * 真实适配器。
 *
 * 非删除场景：`buildReferenceGraph` 的诊断（缺失/kind 不匹配/family 不匹配/抽象实例化/循环）
 * 与 `validatePackageShape` 的诊断（重复标识）合并后统一判定拒绝；`activeIds` 未被使用，
 * 因为这些场景全部在单一候选包内自洽（不依赖活动集）。
 *
 * 删除场景：先用 `activate(emptyRegistry(), ...)` 把待删除定义及其依赖者激活为活动集，
 * 再提交只含 `removals` 的候选包触发 `revalidateDependents` 的悬空入边检查。
 */
class RealReferenceGraphPort implements ReferenceGraphPort {
  buildGraph(candidate: DefinitionPackage, _activeIds: ReadonlySet<string>): Result<ReferenceGraph> {
    void _activeIds;
    const shapeCollector = new DiagnosticCollector();
    const context = buildValidationContext({ package: candidate });
    validatePackageShape(context, shapeCollector);

    const { graph, diagnostics: graphDiagnostics } = buildReferenceGraph({
      package: candidate,
      activeNodes: new Map(),
    });

    const removals = candidate.removals ?? [];
    let removalDiagnostics: readonly Diagnostic[] = [];
    if (removals.length > 0) {
      removalDiagnostics = this.detectDanglingRemovals(candidate, graph);
    }

    const allDiagnostics = [...shapeCollector.all(), ...graphDiagnostics, ...removalDiagnostics];
    if (allDiagnostics.some(isErrorDiagnostic)) {
      return structuredRejection(allDiagnostics);
    }
    return ok(graph, allDiagnostics);
  }

  /**
   * 两阶段删除测试：把候选包中"未被删除"的定义视为已激活的活动集，
   * 用 `Definition_Registry.activate` 建立基线，再提交只含删除的候选包触发依赖重验证。
   * 这与 design.md「覆盖和删除先纳入候选图，重新验证全部入边依赖」一致。
   */
  private detectDanglingRemovals(candidate: DefinitionPackage, graph: ReferenceGraph): readonly Diagnostic[] {
    // 阶段一：把候选包中的全部定义（含待删除者）原样激活为基线活动集，
    // 使 gen-dependent → gen-node-0 之类的入边先合法存在。
    const baselinePackage: DefinitionPackage = { ...candidate, removals: undefined };
    const baseline = activate(emptyRegistry(), baselinePackage);
    if (!isOk(baseline)) {
      return baseline.diagnostics;
    }
    // 阶段二：提交一个只含删除、不再重复声明定义的候选包，触发悬空入边检查。
    const deletionPackage: DefinitionPackage = {
      ...candidate,
      definitions: [],
      removals: candidate.removals,
    };
    const result = activate(baseline.value.registry, deletionPackage);
    if (isRejection(result)) {
      return result.diagnostics;
    }
    void graph;
    return [];
  }
}

const SOURCE_FILE = 'docs/generated/p08-references.md';
const PACKAGE_ID = 'pkg-p08-generated';

const GENERATED_RECORD: SourceRecord = Object.freeze({
  sourceFile: SOURCE_FILE,
  sourceLocation: { sourceFile: SOURCE_FILE, section: 'generated-references' },
  precedence: 'finalized-l2-contract',
  classification: 'Normative_Contract',
  owningLayer: '基类层',
  statementFingerprint: 'generated:p08:references',
});

interface GraphCase {
  readonly definitionCount: number;
  /** 指向不存在的定义。 */
  readonly injectMissingReference: boolean;
  /** 指向存在但 Def kind 不匹配的定义。 */
  readonly injectKindMismatch: boolean;
  /** 指向存在但语义族不匹配的定义。 */
  readonly injectFamilyMismatch: boolean;
  /** 实例引用抽象定义且 allowAbstract=false。 */
  readonly injectAbstractInstantiation: boolean;
  /** 两个定义使用同一标识。 */
  readonly injectDuplicateIdentifier: boolean;
  /** 引用环（A → B → A）。 */
  readonly injectReferenceCycle: boolean;
  /** 删除仍有入边的定义。 */
  readonly injectRemovalWithInboundEdge: boolean;
}

function reference(
  refId: string,
  role: string,
  hostId: string,
  index: number,
  expected: TypedReference['expected'],
): TypedReference {
  return {
    refId,
    role,
    expected,
    jsonPath: `/definitions/${hostId}/otherRefs/${index}`,
    required: true,
  };
}

function definition(
  id: string,
  isAbstract: boolean,
  familyId: string,
  refs: readonly TypedReference[],
): CandidateDefinition {
  return {
    id,
    defKind: 'item',
    abstract: isAbstract,
    semanticFamily: { familyId },
    typeIdentity: { ...EMPTY_TYPE_IDENTITY, requiredCapabilities: [`capability-${id}`] },
    composition: [],
    parameterSchema: { fields: [], crossFieldConstraints: [] },
    tags: [],
    actionRefs: [],
    ruleRefs: [],
    otherRefs: refs,
    sourceRecords: [GENERATED_RECORD],
    sourceLocation: { sourceFile: SOURCE_FILE, section: `generated-${id}` },
    jsonPath: `/definitions/${id}`,
  };
}

interface BuiltGraphCase {
  readonly pkg: DefinitionPackage;
  readonly expectedCodes: readonly string[];
  /** 必须被点名的受影响定义标识。 */
  readonly affectedIds: readonly string[];
}

function buildGraphCase(testCase: GraphCase): BuiltGraphCase {
  const definitions: CandidateDefinition[] = [];
  const expected: string[] = [];
  const affected: string[] = [];

  for (let index = 0; index < testCase.definitionCount; index += 1) {
    definitions.push(definition(`gen-node-${index}`, false, 'item', []));
  }
  // 一个抽象定义，用于抽象实例化目标检查。
  definitions.push(definition('gen-abstract', true, 'item', []));
  // 一个语义族不同的定义，用于 family 不匹配检查。
  definitions.push(definition('gen-weapon', false, 'weapon', []));

  const hostId = 'gen-host';
  const hostRefs: TypedReference[] = [];
  let refIndex = 0;

  if (testCase.injectMissingReference) {
    hostRefs.push(
      reference('gen-absent-target', 'item', hostId, refIndex++, { allowAbstract: false, defKind: 'item' }),
    );
    expected.push(DIAGNOSTIC_CODES.REF_MISSING_TARGET);
    affected.push(hostId);
  }
  if (testCase.injectKindMismatch) {
    hostRefs.push(
      reference('gen-node-0', 'action', hostId, refIndex++, { allowAbstract: false, defKind: 'action' }),
    );
    expected.push(DIAGNOSTIC_CODES.REF_KIND_MISMATCH);
    affected.push(hostId);
  }
  if (testCase.injectFamilyMismatch) {
    hostRefs.push(
      reference('gen-weapon', 'item', hostId, refIndex++, {
        allowAbstract: false,
        semanticFamily: 'item',
      }),
    );
    expected.push(DIAGNOSTIC_CODES.REF_FAMILY_MISMATCH);
    affected.push(hostId);
  }
  if (testCase.injectAbstractInstantiation) {
    hostRefs.push(
      reference('gen-abstract', 'item', hostId, refIndex++, { allowAbstract: false, defKind: 'item' }),
    );
    expected.push(DIAGNOSTIC_CODES.REF_ABSTRACT_TARGET);
    affected.push(hostId);
  }
  definitions.push(definition(hostId, false, 'item', hostRefs));

  if (testCase.injectDuplicateIdentifier) {
    definitions.push(definition(hostId, false, 'item', []));
    expected.push(DIAGNOSTIC_CODES.DEF_DUPLICATE_IDENTIFIER);
    affected.push(hostId);
  }

  if (testCase.injectReferenceCycle) {
    const cycleA = 'gen-cycle-a';
    const cycleB = 'gen-cycle-b';
    definitions.push(
      definition(cycleA, false, 'item', [
        reference(cycleB, 'base', cycleA, 0, { allowAbstract: false, defKind: 'item' }),
      ]),
    );
    definitions.push(
      definition(cycleB, false, 'item', [
        reference(cycleA, 'base', cycleB, 0, { allowAbstract: false, defKind: 'item' }),
      ]),
    );
    expected.push(DIAGNOSTIC_CODES.REF_DEPENDENCY_CYCLE);
    affected.push(cycleA, cycleB);
  }

  const removals =
    testCase.injectRemovalWithInboundEdge && testCase.definitionCount > 0
      ? [{ targetId: 'gen-node-0', reason: 'generated removal leaving an inbound edge' }]
      : undefined;
  if (removals !== undefined) {
    const dependentId = 'gen-dependent';
    definitions.push(
      definition(dependentId, false, 'item', [
        reference('gen-node-0', 'base', dependentId, 0, { allowAbstract: false, defKind: 'item' }),
      ]),
    );
    expected.push(DIAGNOSTIC_CODES.REF_INBOUND_LEFT_DANGLING);
    affected.push(dependentId);
  }

  return {
    pkg: {
      packageId: PACKAGE_ID,
      schemaVersion: 'l2-declarative/1',
      dependencies: [],
      sourceRecords: [GENERATED_RECORD],
      definitions,
      ...(removals === undefined ? {} : { removals }),
    },
    expectedCodes: expected,
    affectedIds: affected,
  };
}

const arbGraphCase: fc.Arbitrary<GraphCase> = fc.record({
  definitionCount: fc.integer({ min: 1, max: 3 }),
  injectMissingReference: fc.boolean(),
  injectKindMismatch: fc.boolean(),
  injectFamilyMismatch: fc.boolean(),
  injectAbstractInstantiation: fc.boolean(),
  injectDuplicateIdentifier: fc.boolean(),
  injectReferenceCycle: fc.boolean(),
  injectRemovalWithInboundEdge: fc.boolean(),
});

/** 完整断言体，驱动真实 `ReferenceGraph`（`src/l2/resolution/reference-graph.ts`）实现。 */
export function runReferenceGraphIntegrityProperty(makeBuilder: () => ReferenceGraphPort): void {
  fc.assert(
    fc.property(arbGraphCase, (testCase) => {
      // "删除留下入边"子句要求两阶段激活：先把候选包（去掉 removals）作为基线成功激活，
      // 再提交删除触发悬空入边检查。若基线本身就带有其他被注入的错误（环、缺失引用、
      // kind/family 不匹配、抽象实例化、重复标识），第一阶段就会先被那个错误拒绝，
      // REF_INBOUND_LEFT_DANGLING 永远不会被触发观察到——这是测试构造本身的场景冲突
      // （删除子句需要一个干净的基线），不是被测实现的缺陷，故用 fc.pre 令删除子句与
      // 其余注入互斥，其余注入之间仍可自由组合。
      fc.pre(
        !testCase.injectRemovalWithInboundEdge ||
          !(
            testCase.injectMissingReference ||
            testCase.injectKindMismatch ||
            testCase.injectFamilyMismatch ||
            testCase.injectAbstractInstantiation ||
            testCase.injectDuplicateIdentifier ||
            testCase.injectReferenceCycle
          ),
      );

      const builder = makeBuilder();
      const built = buildGraphCase(testCase);
      const activeIds: ReadonlySet<string> = new Set<string>();

      const result = builder.buildGraph(built.pkg, activeIds);

      if (built.expectedCodes.length > 0) {
        expect(isRejection(result)).toBe(true);
        if (!isRejection(result)) return;

        const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
        for (const code of built.expectedCodes) {
          expect(codes).toContain(code);
        }
        // 每个受影响者都必须被点名（Requirements 3.5、12.5）。
        const named = new Set(result.diagnostics.map((diagnostic) => diagnostic.definitionId));
        for (const id of built.affectedIds) {
          expect(named.has(id)).toBe(true);
        }
        // 每条诊断都必须可解释、可修复；缺失引用必须额外给出引用方 JSON 路径
        // （Requirements 12.3）。依赖循环诊断按定义标识而非单一字段定位，不要求 jsonPath
        // （`reference-graph.ts` 的 `REF_DEPENDENCY_CYCLE` 诊断本身即如此构造）。
        for (const diagnostic of result.diagnostics) {
          expect(diagnostic.reason.trim().length).toBeGreaterThan(0);
          expect(diagnostic.correctionSuggestion.trim().length).toBeGreaterThan(0);
          if (diagnostic.code === DIAGNOSTIC_CODES.REF_MISSING_TARGET) {
            expect(diagnostic.jsonPath).toBeDefined();
          }
        }
        // 拒绝是确定且稳定排序的：重复构建产生完全相同的诊断序列。
        const repeated = builder.buildGraph(built.pkg, activeIds);
        expect(isRejection(repeated)).toBe(true);
        if (isRejection(repeated)) {
          expect(fingerprint(sortDiagnostics(repeated.diagnostics))).toBe(
            fingerprint(sortDiagnostics(result.diagnostics)),
          );
          const sorted = sortDiagnostics(result.diagnostics);
          for (let index = 1; index < sorted.length; index += 1) {
            expect(compareDiagnostics(sorted[index - 1]!, sorted[index]!)).toBeLessThanOrEqual(0);
          }
        }
        return;
      }

      // ── 全部引用可解析且无不受支持循环：图可激活 ─────────────────────────────
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      const graph = result.value;

      const declaredIds = new Set(built.pkg.definitions.map((d) => d.id));
      // 图必须为每个定义暴露节点（Requirements 12.12）。
      expect(new Set(graph.nodes.keys())).toEqual(declaredIds);
      for (const { hostId, reference: ref } of graph.references) {
        expect(declaredIds.has(hostId)).toBe(true);
        expect(ref.jsonPath.length).toBeGreaterThan(0);
      }
      // 入边与出边互为镜像：不存在只记一侧的边。
      for (const [hostId, targets] of graph.outbound) {
        for (const targetId of targets) {
          expect(graph.inbound.get(targetId) ?? []).toContain(hostId);
        }
      }
      for (const [targetId, hosts] of graph.inbound) {
        for (const hostId of hosts) {
          expect(graph.outbound.get(hostId) ?? []).toContain(targetId);
        }
      }
      expect(graph.cycleMembers).toHaveLength(0);
      // 图构建是纯读操作：重复构建结果等价（用节点与边的规范化投影比较，图本身含 Map，
      // 不能直接 fingerprint 结构化克隆）。
      const repeated = builder.buildGraph(built.pkg, activeIds);
      expect(isOk(repeated)).toBe(true);
      if (isOk(repeated)) {
        expect(fingerprint(graphProjection(repeated.value))).toBe(fingerprint(graphProjection(graph)));
      }
    }),
    { numRuns: 100 },
  );
}

/** 按首元素（字符串 id）比较两个 `[id, ...]` 元组，供 Map 条目排序使用。 */
function compareByFirstElement(left: readonly [string, ...unknown[]], right: readonly [string, ...unknown[]]): number {
  const [leftId] = left;
  const [rightId] = right;
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

/** 把 `ReferenceGraph`（含 Map）投影为可稳定序列化的纯数据结构。 */
function graphProjection(graph: ReferenceGraph): unknown {
  return {
    nodeIds: [...graph.nodes.keys()].sort(),
    outbound: [...graph.outbound.entries()]
      .map(([id, targets]): [string, readonly string[]] => [id, [...targets].sort()])
      .sort(compareByFirstElement),
    inbound: [...graph.inbound.entries()]
      .map(([id, hosts]): [string, readonly string[]] => [id, [...hosts].sort()])
      .sort(compareByFirstElement),
    cycleMembers: [...graph.cycleMembers].sort(),
  };
}

function loadReferenceGraphBuilder(): ReferenceGraphPort {
  return new RealReferenceGraphPort();
}

describe('Property 8: 引用图完整性与确定性拒绝', () => {
  it('引用完整性与确定性稳定排序拒绝（fast-check，100 次生成）', () => {
    runReferenceGraphIntegrityProperty(loadReferenceGraphBuilder);
  });
});

// Feature: l2-base-layer-spec, Property 10: 包激活、覆盖、删除的原子性与回滚
//
// 性质原文（design.md「Correctness Properties / Property 10」）：
//   For any active registry and candidate package change, 若候选、其覆盖或删除后的任何定义、依赖或
//   引用存在 Error_Diagnostic，则活动注册表、依赖图和 Canonical_Snapshot 必须与操作前等价且候选零
//   变更可见；若全部通过，则完整候选集作为一次原子变更激活，并产生确定性 Canonical_Snapshot。
//
// Validates: Requirements 2.7
// Additional coverage: Requirements 7.12–7.13, 11.12, 12.6–12.11, 13.4, 15.7, 15.17
//
// 状态：✅ **全部运行，无跳过**。
//
// Bug 记录（已修复，保留成因以免重蹈覆辙）：
//   本文件曾因一个真实实现缺口把"覆盖使依赖失效"子句标为 `it.skip`。成因：
//   `REF_OVERRIDE_INVALIDATES_DEPENDENT` 只在 `diagnostic-codes.ts` 里声明，从未被任何规则产生。
//   根因是两处覆盖不全叠加——`reference-graph.ts` 的 `buildReferenceGraph` 只收集候选包自身
//   定义的引用（`collectReferences` 只迭代 `input.package.definitions`），不会为"停留在活动集、
//   未被本次候选重新提交"的依赖者收集引用；而 `dependent-revalidation.ts` 对 `overrideIntent`
//   只检查"覆盖目标是否存在于候选中"，不检查覆盖后依赖者的引用是否仍类型兼容。
//   两者都以为对方会查，结果谁都没查。
//
//   修复方式：`RevalidationInput` 新增 `activeReferences`（hostId → 该活动定义发出的类型化引用），
//   由 `definition-registry.ts` 的 `activeReferenceMap()` 从活动集解析定义收集，经
//   `package-validation.ts` 透传；`revalidateDependents` 对每个覆盖目标回头核验仍留在活动集的
//   依赖者引用，复用 `reference-graph.ts` 导出的同一个 `matchesExpected` 判定，避免出现两套
//   兼容标准。
//
//   教训：一个"已声明但零引用"的诊断代码就是未实现规则的信号；跨模块职责边界上最容易出现
//   "双方都假设对方负责"的漏检。
//
// 被测实现：src/l2/registry/{definition-registry,canonical-snapshot}.ts、
//           src/l2/resolution/dependent-revalidation.ts、src/l2/validation/package-validation.ts

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DIAGNOSTIC_CODES } from '../../src/l2/model/diagnostic-codes.js';
import { isErrorDiagnostic } from '../../src/l2/model/diagnostic.js';
import { errorDiagnostic, snapshotsEquivalent, structuredRejection } from '../../src/l2/model/diagnostic-factory.js';
import { fingerprint } from '../../src/l2/model/ordering.js';
import { isOk, isRejection, ok } from '../../src/l2/model/result.js';
import type { Result } from '../../src/l2/model/result.js';
import { EMPTY_TYPE_IDENTITY } from '../../src/l2/model/reference.js';
import type { CandidateDefinition, DefinitionPackage } from '../../src/l2/model/definition.js';
import type { CanonicalSnapshot } from '../../src/l2/model/snapshot.js';
import type { SourceRecord } from '../../src/l2/model/source.js';
import { activate, emptyRegistry, query, type ActiveRegistry } from '../../src/l2/registry/definition-registry.js';

export interface DefinitionRegistryPort {
  activate(candidate: DefinitionPackage): Result<CanonicalSnapshot>;
  snapshot(): CanonicalSnapshot;
  query(definitionId: string): Result<unknown>;
  activeDefinitionIds(): ReadonlySet<string>;
}

/**
 * 真实适配器：持有可变的 `ActiveRegistry` 引用（注册表本身是不可变值，
 * 适配器只是在测试用例的生命周期内把"当前活动状态"串起来）。
 */
class RealDefinitionRegistryPort implements DefinitionRegistryPort {
  private state: ActiveRegistry;

  constructor(base: DefinitionPackage) {
    const baseline = activate(emptyRegistry(), base);
    if (!isOk(baseline)) {
      throw new Error(
        `测试基线包激活失败（这是测试构造缺陷而非被测实现缺陷）：${JSON.stringify(baseline.diagnostics)}`,
      );
    }
    this.state = baseline.value.registry;
  }

  activate(candidate: DefinitionPackage): Result<CanonicalSnapshot> {
    const result = activate(this.state, candidate);
    if (isRejection(result)) {
      return structuredRejection(result.diagnostics, result.priorStateFingerprint);
    }
    this.state = result.value.registry;
    return ok(result.value.snapshot, result.warnings);
  }

  snapshot(): CanonicalSnapshot {
    return this.state.snapshot;
  }

  query(definitionId: string): Result<unknown> {
    const resolved = query(this.state, definitionId);
    if (resolved === undefined) {
      return structuredRejection([
        errorDiagnostic({
          code: DIAGNOSTIC_CODES.REF_MISSING_TARGET,
          reason: `定义 ${definitionId} 未在活动注册表中找到。`,
          correctionSuggestion: '确认定义标识已通过某次成功激活登记。',
        }),
      ]);
    }
    return ok(resolved);
  }

  activeDefinitionIds(): ReadonlySet<string> {
    return new Set(this.state.definitions.keys());
  }
}

const SOURCE_FILE = 'docs/generated/p10-activation.md';

const GENERATED_RECORD: SourceRecord = Object.freeze({
  sourceFile: SOURCE_FILE,
  sourceLocation: { sourceFile: SOURCE_FILE, section: 'generated-activation' },
  precedence: 'finalized-l2-contract',
  classification: 'Normative_Contract',
  owningLayer: '基类层',
  statementFingerprint: 'generated:p10:activation',
});

interface ActivationCase {
  readonly baseDefinitionCount: number;
  readonly addedDefinitionCount: number;
  /** 候选内含一个非法定义（未分类字段），必须导致整包零变更。 */
  readonly injectInvalidDefinition: boolean;
  /** 覆盖一个已激活定义，且使其依赖失效。 */
  readonly injectOverrideInvalidatingDependent: boolean;
  /** 删除仍有入边的已激活定义。 */
  readonly injectRemovalWithInboundEdge: boolean;
  /** 删除父天然场景但不为子微型场景声明生命周期操作。 */
  readonly injectParentRemovalOrphaningChild: boolean;
  /** 只含 Warning（表现字段回退）：必须允许激活且不改变语义字段含义。 */
  readonly warningOnly: boolean;
}

function definition(id: string, valid: boolean, warningOnly: boolean): CandidateDefinition {
  return {
    id,
    defKind: 'item',
    abstract: true,
    semanticFamily: { familyId: 'item' },
    typeIdentity: { ...EMPTY_TYPE_IDENTITY, requiredCapabilities: [`capability-${id}`] },
    composition: [],
    parameterSchema: {
      fields: valid
        ? [
            {
              name: `generated-field-${id}`,
              dataType: 'integer',
              required: true,
              classification: 'Internal_Metric',
              internalMetricSchema: { metric: `metric-${id}`, integral: true },
            },
          ]
        : [
            // 结构边界缺权威来源与结构理由：确定性 Error（Requirements 5.3）。
            { name: `generated-field-${id}`, dataType: 'integer', required: true, classification: 'Structural_Bound' },
          ],
      crossFieldConstraints: [],
    },
    tags: [],
    actionRefs: [],
    ruleRefs: [],
    sourceRecords: [GENERATED_RECORD],
    ...(warningOnly ? { presentation: { displayName: `生成的展示名 ${id}` } } : {}),
    sourceLocation: { sourceFile: SOURCE_FILE, section: `generated-${id}` },
    jsonPath: `/definitions/${id}`,
  };
}

interface BuiltActivation {
  readonly base: DefinitionPackage;
  readonly candidate: DefinitionPackage;
  readonly expectRejection: boolean;
  readonly expectedCodes: readonly string[];
}

function buildActivationCase(testCase: ActivationCase): BuiltActivation {
  const baseDefinitions = Array.from({ length: testCase.baseDefinitionCount }, (_, index) =>
    definition(`gen-base-${index}`, true, false),
  );
  // 一个依赖 base-0 的已激活定义，用于覆盖/删除的入边检查。
  const dependentId = 'gen-base-dependent';
  if (testCase.baseDefinitionCount > 0) {
    baseDefinitions.push({
      ...definition(dependentId, true, false),
      otherRefs: [
        {
          refId: 'gen-base-0',
          role: 'base',
          expected: { allowAbstract: true, defKind: 'item' },
          jsonPath: `/definitions/${dependentId}/otherRefs/0`,
          required: true,
        },
      ],
    });
  }

  const added = Array.from({ length: testCase.addedDefinitionCount }, (_, index) =>
    definition(`gen-added-${index}`, true, testCase.warningOnly),
  );
  if (testCase.injectInvalidDefinition) {
    added.push(definition('gen-added-invalid', false, false));
  }

  const expectedCodes: string[] = [];
  if (testCase.injectInvalidDefinition) {
    expectedCodes.push(DIAGNOSTIC_CODES.SCHEMA_STRUCTURAL_BOUND_MISSING_SOURCE);
  }

  // 注：injectOverrideInvalidatingDependent 的候选构造已移入 buildOverrideInvalidatesDependentCase
  // 专供被 skip 的子句使用（见文件头 Bug 记录：REF_OVERRIDE_INVALIDATES_DEPENDENT 从未被产生）。
  // 主断言体不再消费该标志对应的分支。

  const removals: { targetId: string; reason: string }[] = [];
  if (testCase.injectRemovalWithInboundEdge && testCase.baseDefinitionCount > 0) {
    removals.push({ targetId: 'gen-base-0', reason: 'generated removal leaving an inbound edge' });
    expectedCodes.push(DIAGNOSTIC_CODES.REF_INBOUND_LEFT_DANGLING);
  }
  if (testCase.injectParentRemovalOrphaningChild) {
    // 父场景必须是可实例化目标（非抽象），且语义族为 'natural-scene'，
    // 这样才能匹配子微型场景引用的 `expected: { allowAbstract: false, semanticFamily:
    // 'natural-scene' }`；`dependent-revalidation.ts` 也按 `activeFamilies.get(...) ===
    // 'natural-scene' / 'micro-scene'` 识别父子关系。
    baseDefinitions.push({ ...definition('gen-parent-scene', true, false), abstract: false, semanticFamily: { familyId: 'natural-scene' } });
    baseDefinitions.push({
      ...definition('gen-child-micro-scene', true, false),
      abstract: false,
      semanticFamily: { familyId: 'micro-scene' },
      otherRefs: [
        {
          refId: 'gen-parent-scene',
          role: 'node',
          expected: { allowAbstract: false, semanticFamily: 'natural-scene' },
          jsonPath: '/definitions/gen-child-micro-scene/otherRefs/0',
          required: true,
        },
      ],
    });
    // 删除父场景但不声明 childLifecycleOperation：整个事务必须回滚。
    removals.push({ targetId: 'gen-parent-scene', reason: 'generated parent removal without lifecycle op' });
    expectedCodes.push(DIAGNOSTIC_CODES.SPACE_PARENT_REMOVAL_ORPHANS_CHILD);
  }

  return {
    base: {
      packageId: 'pkg-p10-base',
      schemaVersion: 'l2-declarative/1',
      dependencies: [],
      sourceRecords: [GENERATED_RECORD],
      definitions: baseDefinitions,
    },
    candidate: {
      packageId: 'pkg-p10-candidate',
      schemaVersion: 'l2-declarative/1',
      dependencies: [{ packageId: 'pkg-p10-base' }],
      sourceRecords: [GENERATED_RECORD],
      definitions: added,
      ...(removals.length === 0 ? {} : { removals }),
    },
    expectRejection: expectedCodes.length > 0,
    expectedCodes,
  };
}

const arbActivationCase: fc.Arbitrary<ActivationCase> = fc.record({
  baseDefinitionCount: fc.integer({ min: 1, max: 3 }),
  addedDefinitionCount: fc.integer({ min: 1, max: 3 }),
  injectInvalidDefinition: fc.boolean(),
  // 主断言体固定为 false：该分支的构造与断言已移入被 skip 的
  // `runOverrideInvalidatesDependentClause`（见文件头 Bug 记录）。
  injectOverrideInvalidatingDependent: fc.constant(false),
  injectRemovalWithInboundEdge: fc.boolean(),
  injectParentRemovalOrphaningChild: fc.boolean(),
  warningOnly: fc.boolean(),
});

/** 完整断言体，驱动真实 `Definition_Registry.activate` 实现。 */
export function runAtomicActivationProperty(
  makeRegistry: (base: DefinitionPackage) => DefinitionRegistryPort,
): void {
  fc.assert(
    fc.property(arbActivationCase, (testCase) => {
      const built = buildActivationCase(testCase);
      const registry = makeRegistry(built.base);

      const snapshotBefore = registry.snapshot();
      const idsBefore = new Set(registry.activeDefinitionIds());
      const fingerprintBefore = fingerprint(snapshotBefore);

      const result = registry.activate(built.candidate);

      if (built.expectRejection) {
        expect(isRejection(result)).toBe(true);
        if (!isRejection(result)) return;
        expect(result.diagnostics.some(isErrorDiagnostic)).toBe(true);
        for (const code of built.expectedCodes) {
          expect(result.diagnostics.map((d) => d.code)).toContain(code);
        }

        // 零候选变更可见：活动集合、依赖图与快照与操作前严格等价。
        const snapshotAfter = registry.snapshot();
        expect(snapshotsEquivalent(snapshotAfter, snapshotBefore)).toBe(true);
        expect(fingerprint(snapshotAfter)).toBe(fingerprintBefore);
        expect(new Set(registry.activeDefinitionIds())).toEqual(idsBefore);
        for (const candidateDefinition of built.candidate.definitions) {
          if (!idsBefore.has(candidateDefinition.id)) {
            expect(isRejection(registry.query(candidateDefinition.id))).toBe(true);
          }
        }
        return;
      }

      // ── 全部通过：完整候选集作为一次原子变更激活 ─────────────────────────────
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;

      const snapshotAfter = registry.snapshot();
      // 成功激活必有快照，且与返回值等价（Requirements 15.17）。
      expect(snapshotsEquivalent(result.value, snapshotAfter)).toBe(true);
      // 快照发生了变化：候选集整体可见。
      expect(snapshotsEquivalent(snapshotAfter, snapshotBefore)).toBe(false);

      const idsAfter = new Set(registry.activeDefinitionIds());
      for (const candidateDefinition of built.candidate.definitions) {
        expect(idsAfter.has(candidateDefinition.id)).toBe(true);
        expect(isOk(registry.query(candidateDefinition.id))).toBe(true);
      }
      for (const removed of built.candidate.removals ?? []) {
        expect(idsAfter.has(removed.targetId)).toBe(false);
      }

      // 仅含 Warning 时允许激活，且不得改变任何语义字段含义（Requirements 13.5）。
      expect(result.warnings.every((diagnostic) => diagnostic.severity === 'Warning')).toBe(true);

      // 快照是确定性的：重复取快照字节等价。
      expect(fingerprint(registry.snapshot())).toBe(fingerprint(snapshotAfter));

      // 快照不暴露可写活动对象：对快照的任何深层写入尝试都必须失败。
      expect(Object.isFrozen(snapshotAfter)).toBe(true);
    }),
    { numRuns: 100 },
  );
}

/**
 * 被 skip 的子句：覆盖一个已激活定义，使其新版本与依赖者的期望类型不兼容，
 * 必须产生 `REF_OVERRIDE_INVALIDATES_DEPENDENT` 并整体回滚。
 *
 * 现状：`DIAGNOSTIC_CODES.REF_OVERRIDE_INVALIDATES_DEPENDENT` 只在诊断代码目录里声明，
 * 从未被任何规则产生（`grep_search` 确认零匹配）。根因是 `buildReferenceGraph` 只遍历
 * **候选包自身定义**的引用（`collectReferences(definition)` 只迭代
 * `input.package.definitions`），不会重新收集"停留在活动集、未被本次候选重新提交"的依赖者
 * 的引用；`revalidateDependents` 对 `overrideIntent` 只检查"覆盖目标是否存在于候选中"
 * （`REF_OVERRIDE_TARGET_MISSING`），不检查覆盖后依赖者的引用是否仍类型兼容。这不是"模块
 * 缺失"，是既有两个模块（`reference-graph.ts` 的图收集范围、`dependent-revalidation.ts`
 * 的覆盖重验证深度）都未覆盖该子句——因此如实记录为 SKIP，而不是放宽断言。
 */
function buildOverrideInvalidatesDependentCase(): BuiltActivation {
  const dependentId = 'gen-base-dependent';
  const baseDefinitions = [
    definition('gen-base-0', true, false),
    {
      ...definition(dependentId, true, false),
      otherRefs: [
        {
          refId: 'gen-base-0',
          role: 'base',
          expected: { allowAbstract: true, defKind: 'item' as const },
          jsonPath: `/definitions/${dependentId}/otherRefs/0`,
          required: true,
        },
      ],
    },
  ];
  // 覆盖后把 defKind 改成与依赖方期望（'item'）不符的种类。
  const overridden = { ...definition('gen-base-0', true, false), defKind: 'policy' as const };

  return {
    base: {
      packageId: 'pkg-p10-base',
      schemaVersion: 'l2-declarative/1',
      dependencies: [],
      sourceRecords: [GENERATED_RECORD],
      definitions: baseDefinitions,
    },
    candidate: {
      packageId: 'pkg-p10-candidate',
      schemaVersion: 'l2-declarative/1',
      dependencies: [{ packageId: 'pkg-p10-base' }],
      sourceRecords: [GENERATED_RECORD],
      definitions: [overridden],
      overrideIntent: [{ targetId: 'gen-base-0', reason: 'generated override that breaks its dependent' }],
    },
    expectRejection: true,
    expectedCodes: [DIAGNOSTIC_CODES.REF_OVERRIDE_INVALIDATES_DEPENDENT],
  };
}

export function runOverrideInvalidatesDependentClause(
  makeRegistry: (base: DefinitionPackage) => DefinitionRegistryPort,
): void {
  const built = buildOverrideInvalidatesDependentCase();
  const registry = makeRegistry(built.base);
  const snapshotBefore = registry.snapshot();

  const result = registry.activate(built.candidate);
  expect(isRejection(result)).toBe(true);
  if (!isRejection(result)) return;
  expect(result.diagnostics.map((d) => d.code)).toContain(DIAGNOSTIC_CODES.REF_OVERRIDE_INVALIDATES_DEPENDENT);
  expect(snapshotsEquivalent(registry.snapshot(), snapshotBefore)).toBe(true);
}

function loadDefinitionRegistry(base: DefinitionPackage): DefinitionRegistryPort {
  return new RealDefinitionRegistryPort(base);
}

describe('Property 10: 包激活、覆盖、删除的原子性与回滚', () => {
  it('原子激活与零变更回滚（fast-check，100 次生成）', () => {
    runAtomicActivationProperty(loadDefinitionRegistry);
  });

  it('覆盖使依赖失效必须拒绝并整体回滚', () => {
    runOverrideInvalidatesDependentClause(loadDefinitionRegistry);
  });
});

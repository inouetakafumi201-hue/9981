// Feature: l2-base-layer-spec, Property 13: 空间附属关系与生命周期
//
// 性质原文（design.md「Correctness Properties / Property 13」）：
//   For any Micro_Scene and candidate parent-scene transaction, 微型场景必须恰有一个可解析天然场景
//   父级，其生命周期资格只由该有效父级与占用契约决定，且 `props.creator` 的变化不得影响该结论；若父级
//   删除未在同一候选事务中通过引擎层支持的生命周期操作处理所有子引用，则整个事务必须回滚。
//
// Validates: Requirements 7.3
// Additional coverage: Requirements 7.4–7.6, 7.9, 7.12–7.13
//
// 状态：✅ 运行中。
//
// 编写历史说明（须知）：本文件最初编写时 `src/l2/resolution/{reference-graph,
// dependent-revalidation}.ts` 与 `src/l2/registry/definition-registry.ts` 均不存在，整体标记为
// SKIPPED。复核时发现全部模块均已落地，因此把 `loadSpatialTransactionPort()` 从"抛出阻塞原因"
// 改为真实适配器：`activate` 直接调用 `Definition_Registry.activate`；`lifecycleEligible` 从
// 已解析定义的 `familyContract`（`MicroSceneContract.lifecycleDeterminants`）与父级引用是否仍在
// 活动集中共同判定。断言体本身未作任何改动或放宽。
//
// 被测实现：src/l2/validation/spatial-rules.ts、src/l2/resolution/{reference-graph,
//           dependent-revalidation}.ts、src/l2/registry/definition-registry.ts
//
// Q-04（载具内部微型场景与外部交互点边界）保持未决：生成器只构造天然场景父级与占用契约引用，
// 不为载具内部微型场景编造任何默认边界。

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { validateMicroScene } from '../../src/l2/validation/spatial-rules.js';
import { DiagnosticCollector } from '../../src/l2/validation/context.js';
import type { ValidationContext } from '../../src/l2/validation/context.js';
import { DIAGNOSTIC_CODES } from '../../src/l2/model/diagnostic-codes.js';
import { isErrorDiagnostic } from '../../src/l2/model/diagnostic.js';
import { snapshotsEquivalent, structuredRejection } from '../../src/l2/model/diagnostic-factory.js';
import { fingerprint } from '../../src/l2/model/ordering.js';
import { isOk, isRejection, ok } from '../../src/l2/model/result.js';
import type { Result } from '../../src/l2/model/result.js';
import { EMPTY_TYPE_IDENTITY } from '../../src/l2/model/reference.js';
import { CHILD_LIFECYCLE_OPERATIONS } from '../../src/l2/model/definition.js';
import type {
  CandidateDefinition,
  ChildLifecycleOperationKind,
  DefinitionPackage,
  SemanticFamilyRegistration,
} from '../../src/l2/model/definition.js';
import type { MicroSceneContract } from '../../src/l2/model/family-contracts.js';
import type { CanonicalSnapshot } from '../../src/l2/model/snapshot.js';
import type { SourceRecord } from '../../src/l2/model/source.js';
import { activate, emptyRegistry, query, type ActiveRegistry } from '../../src/l2/registry/definition-registry.js';

export interface SpatialTransactionPort {
  activate(candidate: DefinitionPackage): Result<CanonicalSnapshot>;
  snapshot(): CanonicalSnapshot;
  /** 微型场景当前是否具备生命周期资格（由有效父级与占用契约共同决定）。 */
  lifecycleEligible(microSceneId: string): boolean;
}

/**
 * 真实适配器：以空注册表为起点，把首次 `activate(pkg)` 视为一次候选事务。
 * 由于本性质的所有候选都在同一个包内声明（父级 + 子微型场景一起提交），
 * `activate` 的"活动前状态"就是空注册表——这与性质原文「For any active registry and
 * candidate package change」一致：空注册表也是一个合法的 Active_Registry 起点。
 */
class RealSpatialTransactionPort implements SpatialTransactionPort {
  private state: ActiveRegistry = emptyRegistry();

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

  lifecycleEligible(microSceneId: string): boolean {
    const resolved = query(this.state, microSceneId);
    if (resolved === undefined || resolved.familyContract?.contractKind !== 'micro-scene') {
      return false;
    }
    const contract = resolved.familyContract;
    const determinants = new Set(contract.lifecycleDeterminants);
    const hasValidParent = determinants.has('valid-parent') && query(this.state, contract.parent.refId) !== undefined;
    const hasOccupancy = determinants.has('occupancy');
    return hasValidParent && hasOccupancy;
  }
}

const SOURCE_FILE = 'docs/generated/p13-micro-scene.md';
const PARENT_ID = 'gen-natural-scene-parent';
const MICRO_ID = 'gen-micro-scene';

const GENERATED_RECORD: SourceRecord = Object.freeze({
  sourceFile: SOURCE_FILE,
  sourceLocation: { sourceFile: SOURCE_FILE, section: 'generated-micro-scene' },
  precedence: 'l0-constitution',
  classification: 'Normative_Contract',
  owningLayer: '基类层',
  statementFingerprint: 'generated:p13:micro-scene',
});

interface MicroSceneCase {
  /** props.creator 的取值：变化不得影响生命周期结论。 */
  readonly creatorOrdinal: number;
  readonly creatorImmutable: boolean;
  /** 把 owner 当作归属/生命周期依据（违规面）。 */
  readonly declareOwnerField: boolean;
  /** 生命周期依据是否包含 valid-parent。 */
  readonly includesValidParent: boolean;
  /** 生命周期依据是否包含 occupancy。 */
  readonly includesOccupancy: boolean;
  /** 父级引用是否可解析。 */
  readonly parentResolvable: boolean;
  /** 是否在候选事务中删除父天然场景。 */
  readonly removeParent: boolean;
  /** 删除父级时是否声明 L1 支持的子引用生命周期操作。 */
  readonly childLifecycleOperation: ChildLifecycleOperationKind | undefined;
}

function microSceneContract(testCase: MicroSceneCase): MicroSceneContract {
  const determinants: MicroSceneContract['lifecycleDeterminants'] = [
    ...(testCase.includesValidParent ? (['valid-parent'] as const) : []),
    ...(testCase.includesOccupancy ? (['occupancy'] as const) : []),
  ];
  return {
    contractKind: 'micro-scene',
    parent: {
      refId: testCase.parentResolvable ? PARENT_ID : 'gen-absent-parent',
      role: 'node',
      expected: { allowAbstract: false, semanticFamily: 'natural-scene' },
      jsonPath: `/definitions/${MICRO_ID}/familyContract/parent`,
      required: true,
    },
    creator: {
      creatorEntityRef: `gen-creator-entity-${testCase.creatorOrdinal}`,
      immutable: testCase.creatorImmutable,
    },
    occupancyContractRef: {
      refId: 'gen-occupancy-contract',
      role: 'rule',
      expected: { allowAbstract: false },
      jsonPath: `/definitions/${MICRO_ID}/familyContract/occupancyContractRef`,
      required: true,
    },
    lifecycleDeterminants: determinants,
    ...(testCase.declareOwnerField ? { ownerField: 'generated-owner' } : {}),
  };
}

function microSceneDefinition(testCase: MicroSceneCase): CandidateDefinition {
  return {
    id: MICRO_ID,
    defKind: 'node',
    abstract: true,
    semanticFamily: { familyId: 'micro-scene' },
    typeIdentity: { ...EMPTY_TYPE_IDENTITY, requiredCapabilities: ['micro-scene-contact'] },
    composition: [],
    parameterSchema: { fields: [], crossFieldConstraints: [] },
    tags: [],
    actionRefs: [],
    ruleRefs: [],
    sourceRecords: [GENERATED_RECORD],
    familyContract: microSceneContract(testCase),
    sourceLocation: { sourceFile: SOURCE_FILE, section: 'generated-micro-scene-definition' },
    jsonPath: `/definitions/${MICRO_ID}`,
  };
}

function parentDefinition(): CandidateDefinition {
  return {
    id: PARENT_ID,
    defKind: 'node',
    // 微型场景的 parent 引用要求 allowAbstract: false（实例目标不能是抽象定义），
    // 因此父天然场景定义本身必须是非抽象的（Requirements 4.6）。
    abstract: false,
    semanticFamily: { familyId: 'natural-scene' },
    typeIdentity: { ...EMPTY_TYPE_IDENTITY, requiredCapabilities: ['natural-scene-medium'] },
    composition: [],
    parameterSchema: { fields: [], crossFieldConstraints: [] },
    tags: [],
    actionRefs: [],
    ruleRefs: [],
    sourceRecords: [GENERATED_RECORD],
    familyContract: {
      contractKind: 'natural-scene',
      scale: 'medium',
      personalVacantGroundMicroSceneRefs: [],
    },
    sourceLocation: { sourceFile: SOURCE_FILE, section: 'generated-parent-definition' },
    jsonPath: `/definitions/${PARENT_ID}`,
  };
}

/** 占用契约的最小合法定义：`occupancyContractRef` 声明为 `required: true`，必须能解析。 */
function occupancyContractDefinition(): CandidateDefinition {
  return {
    id: 'gen-occupancy-contract',
    defKind: 'rule',
    abstract: false,
    // 使用已登记语义族 'item' 而非自造族名：占用契约的引用期望（allowAbstract: false）
    // 不校验语义族，只校验 Def kind 与抽象状态，因此选哪个已登记族不影响本性质，
    // 但必须是已登记族才能通过 FAMILY_UNREGISTERED 检查。
    semanticFamily: { familyId: 'item' },
    typeIdentity: { ...EMPTY_TYPE_IDENTITY, requiredCapabilities: ['occupancy-contract'] },
    composition: [],
    parameterSchema: { fields: [], crossFieldConstraints: [] },
    tags: [],
    actionRefs: [],
    ruleRefs: [],
    sourceRecords: [GENERATED_RECORD],
    sourceLocation: { sourceFile: SOURCE_FILE, section: 'generated-occupancy-contract' },
    jsonPath: '/definitions/gen-occupancy-contract',
  };
}

/** 首个候选包：父级 + 占用契约 + 子微型场景，永不包含 removals（删除必须在后续独立候选事务中提交）。 */
function buildInitialPackage(testCase: MicroSceneCase): DefinitionPackage {
  return {
    packageId: 'pkg-p13-generated',
    schemaVersion: 'l2-declarative/1',
    dependencies: [],
    sourceRecords: [GENERATED_RECORD],
    definitions: [parentDefinition(), occupancyContractDefinition(), microSceneDefinition(testCase)],
  };
}

/**
 * 删除候选包：只声明对 PARENT_ID 的删除意图，不重复声明任何定义。
 * 这与 design.md「覆盖和删除先纳入候选图，重新验证全部入边依赖」一致：
 * 删除必须作为对**已激活**基线的候选变更提交，而不能与父级的首次声明混在同一个包内
 * （混在一起会让"入边"和"被删目标"同时首次出现，不构成真实的"删除遗留入边"场景）。
 */
function buildRemovalPackage(testCase: MicroSceneCase): DefinitionPackage {
  return {
    packageId: 'pkg-p13-removal',
    schemaVersion: 'l2-declarative/1',
    dependencies: [{ packageId: 'pkg-p13-generated' }],
    sourceRecords: [GENERATED_RECORD],
    definitions: [],
    removals: [
      {
        targetId: PARENT_ID,
        reason: 'generated parent-scene removal',
        ...(testCase.childLifecycleOperation === undefined
          ? {}
          : {
              childLifecycleOperation: {
                kind: testCase.childLifecycleOperation,
                ...(testCase.childLifecycleOperation === 'reparent'
                  ? { newParentId: 'gen-natural-scene-alternate' }
                  : {}),
              },
            }),
      },
    ],
  };
}

function buildContext(pkg: DefinitionPackage): ValidationContext {
  return {
    package: pkg,
    candidateDefinitions: pkg.definitions,
    activeDefinitionIds: new Set<string>(),
    registeredFamilies: new Map<string, SemanticFamilyRegistration>(),
    abstractDefinitionIds: new Set(pkg.definitions.filter((d) => d.abstract).map((d) => d.id)),
  };
}

const arbMicroSceneCase: fc.Arbitrary<MicroSceneCase> = fc.record({
  creatorOrdinal: fc.integer({ min: 0, max: 4 }),
  creatorImmutable: fc.boolean(),
  declareOwnerField: fc.boolean(),
  includesValidParent: fc.boolean(),
  includesOccupancy: fc.boolean(),
  parentResolvable: fc.boolean(),
  removeParent: fc.boolean(),
  childLifecycleOperation: fc.option(
    fc.constantFrom<ChildLifecycleOperationKind>(...CHILD_LIFECYCLE_OPERATIONS),
    { nil: undefined },
  ),
});

/** 完整断言体，驱动真实 `Definition_Registry.activate` + `validation/spatial-rules.ts` 实现。 */
export function runMicroSceneLifecycleProperty(
  makePort: (candidate: DefinitionPackage) => SpatialTransactionPort,
): void {
  fc.assert(
    fc.property(arbMicroSceneCase, (testCase) => {
      const initialPkg = buildInitialPackage(testCase);
      const microScene = initialPkg.definitions.find((definition) => definition.id === MICRO_ID)!;

      // ── 1. 定义级契约（已由 validation/spatial-rules.ts 实现） ────────────────
      const collector = new DiagnosticCollector();
      validateMicroScene(microScene, buildContext(initialPkg), collector);
      const codes = new Set(collector.all().map((diagnostic) => diagnostic.code));
      expect(collector.all().every(isErrorDiagnostic)).toBe(true);

      // owner 不得作为归属或生命周期依据（Requirements 7.6）。
      expect(codes.has(DIAGNOSTIC_CODES.SPACE_MICRO_SCENE_OWNER_SEMANTICS)).toBe(
        testCase.declareOwnerField,
      );
      // props.creator 必须是不可变溯源信息（Requirements 7.4）。
      expect(codes.has(DIAGNOSTIC_CODES.SPACE_CREATOR_MUTABLE)).toBe(!testCase.creatorImmutable);
      // 生命周期资格由有效父级与占用契约共同决定（Requirements 7.5）。
      expect(codes.has(DIAGNOSTIC_CODES.SPACE_MICRO_SCENE_MISSING_OCCUPANCY)).toBe(
        !(testCase.includesValidParent && testCase.includesOccupancy),
      );

      // creator 的取值变化不得影响上述任何结论（只影响溯源，不影响生命周期）。
      const otherCreator = microSceneDefinition({ ...testCase, creatorOrdinal: testCase.creatorOrdinal + 1 });
      const otherCollector = new DiagnosticCollector();
      validateMicroScene(otherCreator, buildContext(buildInitialPackage(testCase)), otherCollector);
      expect(new Set(otherCollector.all().map((d) => d.code))).toEqual(codes);

      // ── 2. 首次激活：父级引用可解析性 + 定义级错误 ────────────────────────────
      const port = makePort(initialPkg);
      const snapshotBefore = port.snapshot();
      const fingerprintBefore = fingerprint(snapshotBefore);

      const initialResult = port.activate(initialPkg);

      const parentUnresolvable = !testCase.parentResolvable;
      const definitionLevelError = codes.size > 0;

      if (parentUnresolvable || definitionLevelError) {
        expect(isRejection(initialResult)).toBe(true);
        if (isRejection(initialResult)) {
          const activationCodes = initialResult.diagnostics.map((diagnostic) => diagnostic.code);
          if (parentUnresolvable) {
            // 父级引用声明存在但目标不可解析 → 由引用图报告 REF_MISSING_TARGET 并拒绝整个
            // Definition_Package（Requirements 7.9、12.3）。`SPACE_MICRO_SCENE_PARENT_MISSING`
            // 是 validation/spatial-rules.ts 的定义级检查，只在 parent **未声明**（refId 为空）
            // 时触发，与"声明了但无法解析"是两种不同失效模式，不应混为一谈。
            expect(activationCodes).toContain(DIAGNOSTIC_CODES.REF_MISSING_TARGET);
          }
          expect(initialResult.diagnostics.some(isErrorDiagnostic)).toBe(true);
        }
        // 事务前语义状态保持等价：零候选变更可见。
        expect(snapshotsEquivalent(port.snapshot(), snapshotBefore)).toBe(true);
        expect(fingerprint(port.snapshot())).toBe(fingerprintBefore);
        return;
      }

      // 合法输入：恰有一个可解析父级，生命周期资格由父级与占用契约共同决定。
      expect(isOk(initialResult)).toBe(true);
      expect(port.lifecycleEligible(MICRO_ID)).toBe(true);
      const contract = microScene.familyContract as MicroSceneContract;
      expect(contract.parent.refId).toBe(PARENT_ID);
      expect(new Set(contract.lifecycleDeterminants)).toEqual(new Set(['valid-parent', 'occupancy']));

      // ── 3. 第二次候选事务：父级删除（Requirements 7.12–7.13） ────────────────
      // 只在首次激活成功（父级可解析且无定义级错误）后才有意义在真实活动集上测试删除。
      if (!testCase.removeParent) {
        return;
      }
      const snapshotAfterInitial = port.snapshot();
      const fingerprintAfterInitial = fingerprint(snapshotAfterInitial);
      const removalPkg = buildRemovalPackage(testCase);
      const removalResult = port.activate(removalPkg);

      if (testCase.childLifecycleOperation === undefined) {
        // 未声明生命周期操作 → 遗留子引用 → 整个事务回滚（Requirements 7.12–7.13）。
        expect(isRejection(removalResult)).toBe(true);
        if (isRejection(removalResult)) {
          expect(removalResult.diagnostics.map((d) => d.code)).toContain(
            DIAGNOSTIC_CODES.SPACE_PARENT_REMOVAL_ORPHANS_CHILD,
          );
        }
        expect(snapshotsEquivalent(port.snapshot(), snapshotAfterInitial)).toBe(true);
        expect(fingerprint(port.snapshot())).toBe(fingerprintAfterInitial);
      }
      // 声明了生命周期操作的分支（cascade-destroy / reparent / detach）不作强断言：
      // L1 生命周期操作的具体执行语义属于引擎层，L2 只声明选用哪一种（design.md
      // 「L2 只声明选用哪一种，不实现其运行时语义」），reparent 还依赖一个此处未声明的
      // 'gen-natural-scene-alternate' 定义，是否通过取决于该目标是否可解析，
      // 不是本性质要验证的失效模式。
    }),
    { numRuns: 100 },
  );
}

function loadSpatialTransactionPort(_candidate: DefinitionPackage): SpatialTransactionPort {
  void _candidate;
  return new RealSpatialTransactionPort();
}

describe('Property 13: 空间附属关系与生命周期', () => {
  it('唯一父级、creator 溯源无关、父级删除整事务回滚（fast-check，100 次生成）', () => {
    runMicroSceneLifecycleProperty(loadSpatialTransactionPort);
  });
});

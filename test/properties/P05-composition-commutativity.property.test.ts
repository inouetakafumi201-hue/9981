// Feature: l2-base-layer-spec, Property 5: 独立组合的交换性与类型保持
//
// 性质原文（design.md「Correctness Properties / Property 5」）：
//   For any pair of compatible, independent composition components, 以任意顺序应用它们都必须产生
//   Equivalent_Definition；如组合声明顺序依赖，解析结果必须仅遵循该显式依赖。移除非类型决定的可选
//   能力不得改变宿主 Type_Identity，车辆邻接与门特定目标的独立变动亦不得相互改写。
//
// Validates: Requirements 3.2
// Additional coverage: Requirements 3.11, 8.3, 8.8–8.9, 15.5
//
// 状态：✅ **全部运行，无跳过**。
//
// Bug 记录（已修复，保留成因以免重蹈覆辙）：
//   本文件曾因一个真实实现缺口把"移除类型决定能力"子句标为 `it.skip`。成因：
//   `src/l2/resolution/definition-resolver.ts` 的 `resolveDefinition` 把
//   `ResolvedDefinition.typeIdentity` 直接照抄 `definition.typeIdentity`，与 `composition`
//   数组内容完全脱钩。于是"移除一个 `typeDefining: true` 的可选能力"既不被拒绝，也不反映为
//   `Type_Identity` 变化——只要 `typeIdentity` 字段本身不变，解析结果就恒定不变，
//   与 Requirements 3.11 / design.md Property 5 相矛盾。
//
//   修复方式：新增 `resolveTypeIdentity()`，把每个 `typeDefining: true` 组件贡献的能力
//   （`capability:<componentId>`）折进解析结果的 `requiredCapabilities` 并排序。于是移除类型
//   决定组件必然产生不同的 Type_Identity，而移除非类型决定的可选能力不产生任何变化；排序保证
//   独立组件任意顺序仍产生 Equivalent_Definition。
//
//   教训：`typeDefining` 这类"声明式元数据"必须真的参与派生计算，否则它只是一个被读取过
//   但从不影响任何输出的字段——测试之外没有任何东西会发现它失效。
//
// 被测实现：src/l2/resolution/definition-resolver.ts、src/l2/validation/item-vehicle-rules.ts

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DIAGNOSTIC_CODES } from '../../src/l2/model/diagnostic-codes.js';
import { fingerprint } from '../../src/l2/model/ordering.js';
import { isErrorDiagnostic } from '../../src/l2/model/diagnostic.js';
import { structuredRejection } from '../../src/l2/model/diagnostic-factory.js';
import { isOk, isRejection, ok } from '../../src/l2/model/result.js';
import type { Result } from '../../src/l2/model/result.js';
import { EMPTY_TYPE_IDENTITY, typeIdentityDiffers } from '../../src/l2/model/reference.js';
import type { CompositionComponent } from '../../src/l2/model/reference.js';
import type {
  CandidateDefinition,
  DefinitionPackage,
  ResolvedDefinition,
} from '../../src/l2/model/definition.js';
import type { VehicleContract } from '../../src/l2/model/family-contracts.js';
import type { SourceRecord } from '../../src/l2/model/source.js';
import { buildReferenceGraph } from '../../src/l2/resolution/reference-graph.js';
import { resolveDefinition } from '../../src/l2/resolution/definition-resolver.js';
import { validateItemsAndVehicles } from '../../src/l2/validation/item-vehicle-rules.js';
import { DiagnosticCollector } from '../../src/l2/validation/context.js';
import type { SemanticFamilyRegistration } from '../../src/l2/model/definition.js';
import type { ValidationContext } from '../../src/l2/validation/context.js';

export interface CompositionResolverPort {
  resolveOne(definition: CandidateDefinition, pkg: DefinitionPackage): Result<ResolvedDefinition>;
  /** 校验车辆契约，返回诊断代码集合（空集表示通过）。 */
  validateVehicleCodes(definition: CandidateDefinition, pkg: DefinitionPackage): readonly string[];
}

function contextOf(definition: CandidateDefinition, pkg: DefinitionPackage): ValidationContext {
  return {
    package: pkg,
    candidateDefinitions: pkg.definitions,
    activeDefinitionIds: new Set<string>(),
    registeredFamilies: new Map<string, SemanticFamilyRegistration>(),
    abstractDefinitionIds: new Set(pkg.definitions.filter((d) => d.abstract).map((d) => d.id)),
  };
}

/** 真实适配器：直接调用 `resolution/definition-resolver.ts` 与 `validation/item-vehicle-rules.ts`。 */
class RealCompositionResolverPort implements CompositionResolverPort {
  resolveOne(definition: CandidateDefinition, pkg: DefinitionPackage): Result<ResolvedDefinition> {
    const { graph } = buildReferenceGraph({ package: pkg, activeNodes: new Map() });
    const definitions = new Map(pkg.definitions.map((d) => [d.id, d] as const));
    const result = resolveDefinition({ definitionId: definition.id, definitions, graph, packageId: pkg.packageId });
    if (result.resolved === undefined) {
      return structuredRejection(result.diagnostics);
    }
    return ok(result.resolved, result.diagnostics);
  }

  validateVehicleCodes(definition: CandidateDefinition, pkg: DefinitionPackage): readonly string[] {
    const collector = new DiagnosticCollector();
    validateItemsAndVehicles(definition, contextOf(definition, pkg), collector);
    return collector.all().filter(isErrorDiagnostic).map((d) => d.code);
  }
}

const SOURCE_FILE = 'docs/generated/p05-composition.md';
const PACKAGE_ID = 'pkg-p05-generated';
const HOST_ID = 'gen-composition-host';

const GENERATED_RECORD: SourceRecord = Object.freeze({
  sourceFile: SOURCE_FILE,
  sourceLocation: { sourceFile: SOURCE_FILE, section: 'generated-composition' },
  precedence: 'finalized-l2-contract',
  classification: 'Normative_Contract',
  owningLayer: '基类层',
  statementFingerprint: 'generated:p05:composition',
});

interface CompositionCase {
  /** 独立可组合组件数量（彼此 dependsOn 为空）。 */
  readonly independentCount: number;
  /** 是否声明一条显式顺序依赖（后者依赖前者）。 */
  readonly declareOrderDependency: boolean;
  /** 待移除的可选能力索引；-1 表示不移除。 */
  readonly removeOptionalIndex: number;
  /** 被移除的能力是否声明为类型决定项。 */
  readonly removedIsTypeDefining: boolean;
  /** 车辆邻接与门目标是否复用同一 componentId（Requirements 8.9 违规面）。 */
  readonly couplesAdjacencyToDoorTarget: boolean;
}

function component(index: number, typeDefining: boolean, dependsOn: readonly string[]): CompositionComponent {
  return {
    componentId: `component-${index}`,
    role: index % 2 === 0 ? 'optional-capability' : 'slot',
    optional: true,
    typeDefining,
    dependsOn,
    reason: `generated component ${index}`,
  };
}

function vehicleContract(testCase: CompositionCase): VehicleContract {
  const adjacencyComponentId = 'component-vehicle-adjacency';
  const doorComponentId = testCase.couplesAdjacencyToDoorTarget
    ? adjacencyComponentId
    : 'component-door-target';
  return {
    contractKind: 'vehicle',
    entityBacked: true,
    seatRoles: [{ seatRole: 'driver', occupantRequirementRefs: [] }],
    cargoContainers: [],
    doors: [{ doorId: 'door-front-left', adjacentSeatRoles: ['driver'] }],
    adjacencyInteractionComponentId: adjacencyComponentId,
    doorTargetInteractionComponentId: doorComponentId,
  };
}

function buildComponents(testCase: CompositionCase): readonly CompositionComponent[] {
  const components: CompositionComponent[] = [];
  for (let index = 0; index < testCase.independentCount; index += 1) {
    const dependsOn =
      testCase.declareOrderDependency && index === testCase.independentCount - 1 && index > 0
        ? [`component-${index - 1}`]
        : [];
    const typeDefining =
      testCase.removeOptionalIndex === index ? testCase.removedIsTypeDefining : false;
    components.push(component(index, typeDefining, dependsOn));
  }
  // 车辆邻接与门特定目标是两个独立可组合交互输入。
  components.push(component_named('component-vehicle-adjacency', 'vehicle-adjacency'));
  if (!testCase.couplesAdjacencyToDoorTarget) {
    components.push(component_named('component-door-target', 'door-target'));
  }
  return components;
}

function component_named(componentId: string, role: string): CompositionComponent {
  return { componentId, role, optional: false, typeDefining: false, dependsOn: [] };
}

function buildHost(components: readonly CompositionComponent[], testCase: CompositionCase): CandidateDefinition {
  return {
    id: HOST_ID,
    defKind: 'entity',
    abstract: true,
    semanticFamily: { familyId: 'vehicle' },
    typeIdentity: { ...EMPTY_TYPE_IDENTITY, requiredCapabilities: ['vehicle-movement'] },
    composition: components,
    parameterSchema: { fields: [], crossFieldConstraints: [] },
    tags: [],
    actionRefs: [],
    ruleRefs: [],
    sourceRecords: [GENERATED_RECORD],
    familyContract: vehicleContract(testCase),
    sourceLocation: { sourceFile: SOURCE_FILE, section: 'generated-host' },
    jsonPath: `/definitions/${HOST_ID}`,
  };
}

function buildPackage(host: CandidateDefinition): DefinitionPackage {
  return {
    packageId: PACKAGE_ID,
    schemaVersion: 'l2-declarative/1',
    dependencies: [],
    sourceRecords: [GENERATED_RECORD],
    definitions: [host],
  };
}

const arbCompositionCase: fc.Arbitrary<CompositionCase> = fc.record({
  independentCount: fc.integer({ min: 2, max: 4 }),
  declareOrderDependency: fc.boolean(),
  removeOptionalIndex: fc.integer({ min: -1, max: 3 }),
  removedIsTypeDefining: fc.boolean(),
  couplesAdjacencyToDoorTarget: fc.boolean(),
});

/**
 * 可运行子句的断言体：独立组件交换性、显式顺序依赖、非类型决定能力移除后类型不变、
 * 车辆邻接与门目标解耦。刻意排除"移除 typeDefining 能力"分支——该分支见下方
 * `runTypeDefiningRemovalClause` 并保持 skip（理由见文件头 Bug 记录）。
 */
export function runCompositionCommutativityProperty(makeResolver: () => CompositionResolverPort): void {
  fc.assert(
    fc.property(arbCompositionCase, fc.integer({ min: 1, max: 9973 }), (testCase, seed) => {
      const resolver = makeResolver();
      const components = buildComponents(testCase);
      const host = buildHost(components, testCase);
      const pkg = buildPackage(host);

      // ── 车辆邻接与门目标必须是两个独立组合输入（Requirements 8.9） ────────────
      const vehicleCodes = resolver.validateVehicleCodes(host, pkg);
      expect(vehicleCodes.includes(DIAGNOSTIC_CODES.VEHICLE_ADJACENCY_COUPLED_TO_DOOR_TARGET)).toBe(
        testCase.couplesAdjacencyToDoorTarget,
      );
      if (testCase.couplesAdjacencyToDoorTarget) {
        return;
      }

      // ── 独立组件的应用顺序不影响解析结果 ────────────────────────────────────
      const baseline = resolver.resolveOne(host, pkg);
      expect(isOk(baseline)).toBe(true);
      if (!isOk(baseline)) {
        return;
      }

      const shuffled = [...components];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const target = Math.abs(seed * (index + 5) + 11) % (index + 1);
        const swapped = shuffled[index]!;
        shuffled[index] = shuffled[target]!;
        shuffled[target] = swapped;
      }
      const reorderedHost: CandidateDefinition = { ...host, composition: shuffled };
      const reordered = resolver.resolveOne(reorderedHost, buildPackage(reorderedHost));
      expect(isOk(reordered)).toBe(true);
      if (!isOk(reordered)) {
        return;
      }
      // 任意顺序产生 Equivalent_Definition。
      expect(fingerprint(reordered.value)).toBe(fingerprint(baseline.value));

      // 显式顺序依赖必须被遵循，且只被它约束。
      if (testCase.declareOrderDependency && testCase.independentCount >= 2) {
        const dependent = `component-${testCase.independentCount - 1}`;
        const prerequisite = `component-${testCase.independentCount - 2}`;
        const order = baseline.value.nestedCapabilities.map((capability) => capability.componentId);
        expect(order.indexOf(prerequisite)).toBeLessThan(order.indexOf(dependent));
      }

      // ── 移除非类型决定的可选能力保持宿主 Type_Identity（Requirements 3.11） ──
      // 仅覆盖 removedIsTypeDefining=false 分支；true 分支见被 skip 的
      // `runTypeDefiningRemovalClause`（对应实现缺口，见文件头 Bug 记录）。
      if (
        !testCase.removedIsTypeDefining &&
        testCase.removeOptionalIndex >= 0 &&
        testCase.removeOptionalIndex < testCase.independentCount
      ) {
        const removedId = `component-${testCase.removeOptionalIndex}`;
        const withoutCapability: CandidateDefinition = {
          ...host,
          composition: components.filter((candidate) => candidate.componentId !== removedId),
        };
        const reduced = resolver.resolveOne(withoutCapability, buildPackage(withoutCapability));
        expect(isOk(reduced)).toBe(true);
        if (isOk(reduced)) {
          // 宿主类型身份完全不变；只有配置面减少一项。
          expect(typeIdentityDiffers(reduced.value.typeIdentity, baseline.value.typeIdentity)).toBe(false);
          expect(reduced.value.nestedCapabilities).toHaveLength(
            baseline.value.nestedCapabilities.length - 1,
          );
        }
      }
    }),
    { numRuns: 100 },
  );
}

/**
 * 被 skip 的子句：移除一个 `typeDefining: true` 的可选能力，必须被拒绝
 * （`COMPOSE_TYPE_DEFINING_CAPABILITY_REMOVED`）或反映为 Type_Identity 变化。
 *
 * 现状：`resolveDefinition` 把 `ResolvedDefinition.typeIdentity` 直接取自
 * `definition.typeIdentity`，不做任何"类型决定组件是否仍存在"的核验，也没有任何规则产生
 * `COMPOSE_TYPE_DEFINING_CAPABILITY_REMOVED`。这不是"模块缺失"，是既有模块的覆盖缺口——
 * 因此按工作准则如实记录为 SKIP，而不是放宽断言让它误报通过。
 */
export function runTypeDefiningRemovalClause(makeResolver: () => CompositionResolverPort): void {
  fc.assert(
    fc.property(arbCompositionCase, (testCase) => {
      fc.pre(testCase.removedIsTypeDefining);
      fc.pre(!testCase.couplesAdjacencyToDoorTarget);
      fc.pre(testCase.removeOptionalIndex >= 0 && testCase.removeOptionalIndex < testCase.independentCount);

      const resolver = makeResolver();
      const components = buildComponents(testCase);
      const host = buildHost(components, testCase);
      const pkg = buildPackage(host);
      const baseline = resolver.resolveOne(host, pkg);
      expect(isOk(baseline)).toBe(true);
      if (!isOk(baseline)) {
        return;
      }

      const removedId = `component-${testCase.removeOptionalIndex}`;
      const withoutCapability: CandidateDefinition = {
        ...host,
        composition: components.filter((candidate) => candidate.componentId !== removedId),
      };
      const reduced = resolver.resolveOne(withoutCapability, buildPackage(withoutCapability));

      // 类型决定项被移除：必须被拒绝，或至少反映为 Type_Identity 变化，绝不静默保持。
      if (isRejection(reduced)) {
        expect(reduced.diagnostics.map((d) => d.code)).toContain(
          DIAGNOSTIC_CODES.COMPOSE_TYPE_DEFINING_CAPABILITY_REMOVED,
        );
      } else {
        expect(typeIdentityDiffers(reduced.value.typeIdentity, baseline.value.typeIdentity)).toBe(true);
      }
    }),
    { numRuns: 100 },
  );
}

function loadCompositionResolver(): CompositionResolverPort {
  return new RealCompositionResolverPort();
}

describe('Property 5: 独立组合的交换性与类型保持', () => {
  it('独立组件交换性、显式顺序依赖、非类型决定能力移除保类型、车辆邻接门目标解耦（fast-check，100 次生成）', () => {
    runCompositionCommutativityProperty(loadCompositionResolver);
  });

  it('移除类型决定能力必须拒绝或反映 Type_Identity 变化（fast-check，100 次生成）', () => {
    runTypeDefiningRemovalClause(loadCompositionResolver);
  });
});

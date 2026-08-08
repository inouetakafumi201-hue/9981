// Feature: l2-base-layer-spec, Property 9: 诊断完整性与确定性
//
// 性质原文（design.md「Correctness Properties / Property 9」）：
//   For any candidate with one 或多个相互独立、可确定发现的错误，验证结果必须包含每项发现的稳定
//   代码、严重级别、定义标识、JSON 路径、包和来源定位、原因及修正建议；等价输入的重新排序不得改变
//   诊断集合、顺序或人类可读含义。任何拒绝若不含 Error_Diagnostic，则调用方必须保持前状态。
//
// Validates: Requirements 1.3
// Additional coverage: Requirements 1.12, 13.1–13.3, 13.8–13.12
//
// 被测实现：src/l2/model/{diagnostic-factory,ordering}.ts + src/l2/validation/*-rules.ts
// 状态：运行中。
//
// 自主设计判断（须知）：`validation/validator.ts` / `validation/package-validation.ts` 尚未实现，
// 因此"把全部规则装配成一次验证"由本测试承担；规则函数、DiagnosticCollector、诊断构造与排序
// 全部是被测实现本身。等价输入的"重新排序"建模为：定义集合顺序、规则调用顺序与
// sourceRecords 顺序的任意排列（三者都是非语义顺序；每个定义自带稳定 jsonPath）。

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  validateAbstractInstantiation,
  validateDefKind,
  validateNoDeprecatedMechanic,
  validateNoGameplaySpecificRule,
  validateNoL1Mechanism,
  validateNoUnclassifiedGameplayValue,
  validateSemanticFamily,
  validateTerminology,
} from '../../src/l2/validation/classification-rules.js';
import { validateParameters } from '../../src/l2/validation/parameter-rules.js';
import { validateInheritanceAndComposition } from '../../src/l2/validation/inheritance-composition-rules.js';
import { validateActionsAndGateways } from '../../src/l2/validation/action-gateway-rules.js';
import { validateSpatial } from '../../src/l2/validation/spatial-rules.js';
import { DiagnosticCollector } from '../../src/l2/validation/context.js';
import type { DefinitionRule, ValidationContext } from '../../src/l2/validation/context.js';
import { DIAGNOSTIC_CODES } from '../../src/l2/model/diagnostic-codes.js';
import { isErrorDiagnostic, isValidStructuredRejection } from '../../src/l2/model/diagnostic.js';
import type { Diagnostic } from '../../src/l2/model/diagnostic.js';
import {
  assessRejection,
  diagnosticSetsEquivalent,
  isCompleteDiagnostic,
  sortDiagnostics,
  structuredRejectionUnchecked,
  warningDiagnostic,
} from '../../src/l2/model/diagnostic-factory.js';
import { compareDiagnostics, fingerprint } from '../../src/l2/model/ordering.js';
import { REJECTED_LAYER_TERMS } from '../../src/l2/model/constitution.js';
import { EMPTY_TYPE_IDENTITY } from '../../src/l2/model/reference.js';
import type { CandidateDefinition, SemanticFamilyRegistration } from '../../src/l2/model/definition.js';
import type { FamilyContract } from '../../src/l2/model/family-contracts.js';
import type { ParameterField, ParameterSchema } from '../../src/l2/model/schema.js';
import type { SourceRecord } from '../../src/l2/model/source.js';
import type { L1DefKind } from '../../src/l2/model/def-kind.js';

const PACKAGE_ID = 'pkg-p09-generated';
const SOURCE_FILE = 'docs/generated/p09-diagnostics.md';

function record(ordinal: number): SourceRecord {
  return {
    sourceFile: SOURCE_FILE,
    sourceLocation: { sourceFile: SOURCE_FILE, section: `generated-record-${ordinal}` },
    precedence: 'finalized-l2-contract',
    classification: 'Normative_Contract',
    owningLayer: '基类层',
    statementFingerprint: `generated:p09:${ordinal}`,
  };
}

const RULES: readonly { readonly name: string; readonly run: DefinitionRule }[] = Object.freeze([
  { name: 'defKind', run: validateDefKind },
  { name: 'noL1Mechanism', run: validateNoL1Mechanism },
  { name: 'noGameplayRule', run: validateNoGameplaySpecificRule },
  { name: 'noUnclassifiedGameplayValue', run: validateNoUnclassifiedGameplayValue },
  { name: 'terminology', run: validateTerminology },
  { name: 'noDeprecatedMechanic', run: validateNoDeprecatedMechanic },
  { name: 'semanticFamily', run: validateSemanticFamily },
  { name: 'abstractInstantiation', run: validateAbstractInstantiation },
  { name: 'parameters', run: validateParameters },
  { name: 'inheritanceComposition', run: validateInheritanceAndComposition },
  { name: 'actionsGateways', run: validateActionsAndGateways },
  { name: 'spatial', run: validateSpatial },
]);

type ContractChoice = 'none' | 'action-multi-ap' | 'micro-scene-owner';

interface DefinitionCase {
  readonly contract: ContractChoice;
  readonly invalidDefKind: boolean;
  readonly declareL1Mechanism: boolean;
  readonly unsourcedStructuralBound: boolean;
  readonly duplicateComponent: boolean;
  readonly danglingConstraint: boolean;
  readonly deprecatedTerm: boolean;
}

const VALID_INTERNAL_METRIC_FIELD: ParameterField = Object.freeze({
  name: 'generated-turn-index',
  dataType: 'integer' as const,
  required: true,
  classification: 'Internal_Metric' as const,
  internalMetricSchema: { metric: 'generated-turn-index', integral: true },
});

function contractOf(testCase: DefinitionCase, ordinal: number): FamilyContract | undefined {
  if (testCase.contract === 'action-multi-ap') {
    return {
      contractKind: 'action',
      costCategory: 'paid',
      // 多 AP 原子成本：必须被拒绝并建议多步 Paid_Action 序列（Requirements 6.4）。
      apCost: 3,
      actorRequirements: [],
      targetRequirements: [],
      effectRefs: [],
      interruptionConditionRefs: [],
      completionState: 'generated-completed',
      availableAsDecisionBranch: true,
      requiresHookIntegration: false,
    };
  }
  if (testCase.contract === 'micro-scene-owner') {
    return {
      contractKind: 'micro-scene',
      parent: {
        refId: `gen-natural-scene-${ordinal}`,
        role: 'node',
        expected: { allowAbstract: false, semanticFamily: 'natural-scene' },
        jsonPath: `/definitions/gen-definition-${ordinal}/familyContract/parent`,
        required: true,
      },
      creator: { creatorEntityRef: `gen-entity-${ordinal}`, immutable: true },
      occupancyContractRef: {
        refId: `gen-occupancy-${ordinal}`,
        role: 'rule',
        expected: { allowAbstract: false },
        jsonPath: `/definitions/gen-definition-${ordinal}/familyContract/occupancyContractRef`,
        required: true,
      },
      lifecycleDeterminants: ['valid-parent', 'occupancy'],
      // owner 语义被明确拒绝（Requirements 7.6）。
      ownerField: 'generated-owner',
    };
  }
  return undefined;
}

function familyIdOf(testCase: DefinitionCase): string {
  if (testCase.contract === 'action-multi-ap') return 'action';
  if (testCase.contract === 'micro-scene-owner') return 'micro-scene';
  return 'item';
}

function defKindOf(testCase: DefinitionCase): L1DefKind {
  if (testCase.invalidDefKind) return 'not-a-valid-def-kind' as L1DefKind;
  if (testCase.contract === 'action-multi-ap') return 'action';
  if (testCase.contract === 'micro-scene-owner') return 'node';
  return 'item';
}

function schemaOf(testCase: DefinitionCase): ParameterSchema {
  const fields: ParameterField[] = [VALID_INTERNAL_METRIC_FIELD];
  if (testCase.unsourcedStructuralBound) {
    fields.push({
      name: 'generated-connection-bound',
      dataType: 'integer',
      required: true,
      classification: 'Structural_Bound',
    });
  }
  return {
    fields,
    crossFieldConstraints: testCase.danglingConstraint
      ? [
          {
            constraintId: 'generated-constraint',
            fields: ['generated-absent-field'],
            reason: 'generated cross field constraint referring to an absent field',
          },
        ]
      : [],
  };
}

function buildDefinition(testCase: DefinitionCase, ordinal: number): CandidateDefinition {
  const id = `gen-definition-${ordinal}`;
  const contract = contractOf(testCase, ordinal);
  const tags = [`generated-tag-${ordinal}`];
  if (testCase.deprecatedTerm) {
    tags.push(`${REJECTED_LAYER_TERMS[0]}-tag`);
  }
  const composition = testCase.duplicateComponent
    ? [
        { componentId: 'generated-component', role: 'slot', optional: true, typeDefining: false, dependsOn: [] },
        { componentId: 'generated-component', role: 'tag', optional: true, typeDefining: false, dependsOn: [] },
      ]
    : [];
  return {
    id,
    defKind: defKindOf(testCase),
    abstract: true,
    semanticFamily: { familyId: familyIdOf(testCase) },
    typeIdentity: EMPTY_TYPE_IDENTITY,
    composition,
    parameterSchema: schemaOf(testCase),
    tags,
    actionRefs: [],
    ruleRefs: [],
    sourceRecords: [record(ordinal), record(ordinal + 100)],
    sourceLocation: { sourceFile: SOURCE_FILE, section: `generated-definition-${ordinal}` },
    // jsonPath 挂在定义自身：定义集合的顺序变化不改变任何诊断定位。
    jsonPath: `/definitions/${id}`,
    ...(contract === undefined ? {} : { familyContract: contract }),
    ...(testCase.declareL1Mechanism ? { declaredL1Mechanisms: ['hook-scheduler' as const] } : {}),
  };
}

/** 独立重新推导的期望诊断代码（PBT oracle）。 */
function expectedCodesOf(testCase: DefinitionCase): readonly string[] {
  const codes: string[] = [];
  if (testCase.invalidDefKind) codes.push(DIAGNOSTIC_CODES.DEF_INVALID_DEF_KIND);
  if (testCase.declareL1Mechanism) codes.push(DIAGNOSTIC_CODES.LAYER_L1_OWNERSHIP);
  if (testCase.unsourcedStructuralBound) {
    codes.push(DIAGNOSTIC_CODES.SCHEMA_STRUCTURAL_BOUND_MISSING_SOURCE);
    codes.push(DIAGNOSTIC_CODES.SCHEMA_STRUCTURAL_BOUND_MISSING_RATIONALE);
  }
  if (testCase.duplicateComponent) codes.push(DIAGNOSTIC_CODES.COMPOSE_DUPLICATE_COMPONENT);
  if (testCase.danglingConstraint) codes.push(DIAGNOSTIC_CODES.SCHEMA_CROSS_FIELD_CONSTRAINT_UNRESOLVED);
  if (testCase.deprecatedTerm) codes.push(DIAGNOSTIC_CODES.TERM_DEPRECATED_LAYER_TERM);
  if (testCase.contract === 'action-multi-ap') codes.push(DIAGNOSTIC_CODES.ACTION_MULTI_AP_ATOMIC_COST);
  if (testCase.contract === 'micro-scene-owner') {
    codes.push(DIAGNOSTIC_CODES.SPACE_MICRO_SCENE_OWNER_SEMANTICS);
  }
  return codes;
}

function buildContext(definitions: readonly CandidateDefinition[]): ValidationContext {
  return {
    package: {
      packageId: PACKAGE_ID,
      schemaVersion: 'l2-declarative/1',
      dependencies: [],
      sourceRecords: [record(0)],
      definitions,
    },
    candidateDefinitions: definitions,
    activeDefinitionIds: new Set<string>(),
    registeredFamilies: new Map<string, SemanticFamilyRegistration>(),
    abstractDefinitionIds: new Set(definitions.filter((d) => d.abstract).map((d) => d.id)),
  };
}

/** 种子驱动的确定性排列，用于构造"等价输入的重新排序"。 */
function permute<T>(items: readonly T[], seed: number): readonly T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.abs((seed * (index + 7) + 13)) % (index + 1);
    const swapped = copy[index]!;
    copy[index] = copy[target]!;
    copy[target] = swapped;
  }
  return copy;
}

function runValidation(
  definitions: readonly CandidateDefinition[],
  rules: readonly { readonly run: DefinitionRule }[],
): readonly Diagnostic[] {
  const context = buildContext(definitions);
  const collector = new DiagnosticCollector();
  for (const definition of definitions) {
    for (const rule of rules) {
      rule.run(definition, context, collector);
    }
  }
  return collector.all();
}

const arbDefinitionCase: fc.Arbitrary<DefinitionCase> = fc.record({
  contract: fc.constantFrom<ContractChoice>('none', 'action-multi-ap', 'micro-scene-owner'),
  invalidDefKind: fc.boolean(),
  declareL1Mechanism: fc.boolean(),
  unsourcedStructuralBound: fc.boolean(),
  duplicateComponent: fc.boolean(),
  danglingConstraint: fc.boolean(),
  deprecatedTerm: fc.boolean(),
});

describe('Property 9: 诊断完整性与确定性', () => {
  it('多错全收、字段完整、等价重排不改变诊断（fast-check，100 次生成）', () => {
    fc.assert(
      fc.property(
        fc.array(arbDefinitionCase, { minLength: 1, maxLength: 3 }),
        fc.integer({ min: 1, max: 9973 }),
        fc.integer({ min: 1, max: 9973 }),
        (cases, definitionSeed, ruleSeed) => {
          const definitions = cases.map((testCase, ordinal) => buildDefinition(testCase, ordinal));
          const context = buildContext(definitions);
          const stateBefore = fingerprint(context.package);

          const baseline = runValidation(definitions, RULES);

          // ── 1. 完整性：每项独立可确定发现的错误都出现在同一份验证结果里 ──────
          const expected = new Set(cases.flatMap((testCase) => expectedCodesOf(testCase)));
          expect(new Set(baseline.map((diagnostic) => diagnostic.code))).toEqual(expected);
          expect(baseline.every(isErrorDiagnostic)).toBe(true);

          // 多个独立错误必须一次全部报出，而不是遇错即停（Requirements 13.8）。
          const totalExpectedFindings = cases.reduce(
            (sum, testCase) => sum + expectedCodesOf(testCase).length,
            0,
          );
          expect(baseline.length).toBe(totalExpectedFindings);

          // ── 2. 字段完整性（Requirements 13.2、13.9） ─────────────────────────
          const definitionIds = new Set(definitions.map((definition) => definition.id));
          for (const diagnostic of baseline) {
            expect(isCompleteDiagnostic(diagnostic)).toBe(true);
            expect(diagnostic.code.trim().length).toBeGreaterThan(0);
            expect(diagnostic.severity).toBe('Error');
            expect(diagnostic.definitionId).toBeDefined();
            expect(definitionIds.has(diagnostic.definitionId!)).toBe(true);
            expect(diagnostic.jsonPath).toBeDefined();
            expect(diagnostic.jsonPath!.startsWith(`/definitions/${diagnostic.definitionId}`)).toBe(true);
            expect(diagnostic.sourcePackage).toBe(PACKAGE_ID);
            expect(diagnostic.sourceLocation?.sourceFile).toBe(SOURCE_FILE);
            expect(diagnostic.sourceLocation?.section.length).toBeGreaterThan(0);
            expect(diagnostic.reason.trim().length).toBeGreaterThan(0);
            expect(diagnostic.correctionSuggestion.trim().length).toBeGreaterThan(0);
          }

          // ── 3. 确定性：等价输入的任意重排不改变集合、顺序与人类可读含义 ───────
          const permutedDefinitions = permute(
            definitions.map((definition) => ({
              ...definition,
              // sourceRecords 顺序是非语义顺序，一并重排。
              sourceRecords: [...definition.sourceRecords].reverse(),
            })),
            definitionSeed,
          );
          const permutedRules = permute(RULES, ruleSeed);
          const permutedRun = runValidation(permutedDefinitions, permutedRules);

          const sortedBaseline = sortDiagnostics(baseline);
          const sortedPermuted = sortDiagnostics(permutedRun);

          expect(diagnosticSetsEquivalent(baseline, permutedRun)).toBe(true);
          expect(fingerprint(sortedPermuted)).toBe(fingerprint(sortedBaseline));
          expect(sortedPermuted.map((d) => d.reason)).toEqual(sortedBaseline.map((d) => d.reason));
          expect(sortedPermuted.map((d) => d.correctionSuggestion)).toEqual(
            sortedBaseline.map((d) => d.correctionSuggestion),
          );

          // 规范化排序确实是有序的（定义标识 → JSON 路径 → 稳定代码 → 来源定位 → …）。
          for (let index = 1; index < sortedBaseline.length; index += 1) {
            expect(compareDiagnostics(sortedBaseline[index - 1]!, sortedBaseline[index]!)).toBeLessThanOrEqual(0);
          }

          // ── 4. 不含 Error 的拒绝是无效验证结果，调用方保留前状态 ─────────────
          const presentationWarning = warningDiagnostic({
            code: DIAGNOSTIC_CODES.PRESENTATION_FALLBACK_APPLIED,
            reason: '表现字段缺失，已使用类型兼容回退。',
            correctionSuggestion: '补全该表现字段；语义结果不受影响。',
          });
          const invalidRejection = structuredRejectionUnchecked([presentationWarning], stateBefore);
          const assessed = assessRejection(invalidRejection);
          expect(assessed.valid).toBe(false);
          expect(assessed.diagnostic?.code).toBe(DIAGNOSTIC_CODES.PKG_REJECTION_WITHOUT_ERROR);
          expect(isValidStructuredRejection(invalidRejection)).toBe(false);
          expect(invalidRejection.priorStateFingerprint).toBe(stateBefore);

          // 验证本身是纯读操作：候选包在验证前后等价（拒绝时保持前状态的前提）。
          expect(fingerprint(context.package)).toBe(stateBefore);
        },
      ),
      { numRuns: 100 },
    );
  });
});

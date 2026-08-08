// Feature: l2-base-layer-spec, Property 2: 语义族三判据与层级边界
//
// 性质原文（design.md「Correctness Properties / Property 2」）：
//   For any proposed semantic family and definition, 当且仅当概念可枚举、可组合且独立于具体玩法
//   时可登记为基类层语义族，并保存分类理由与来源；任何引擎层机制重定义、具体玩法耦合、无授权
//   玩法数值或无效 Def kind 都必须产生结构化拒绝。
//
// Validates: Requirements 2.1
// Additional coverage: Requirements 2.2–2.6, 4.1–4.4, 5.2, 5.8, 16.3–16.5, 16.7–16.8
//
// 被测实现：src/l2/validation/classification-rules.ts + src/l2/compiler/source-classifier.ts
// 状态：运行中。
//
// 自主设计判断（须知）：`src/l2/validation/validator.ts`（tasks.md 4.1 的编排入口）尚未实现，
// 因此本测试直接驱动 classification-rules.ts 导出的真实规则函数，并用真实
// `DiagnosticCollector` 汇总。规则实现与诊断机制都是被测实现本身，未做任何替身或断言放宽；
// 仅"把规则装配成一次验证"这一步由测试承担。validator.ts 到位后应改为调用它。

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
import { DiagnosticCollector } from '../../src/l2/validation/context.js';
import type { ValidationContext } from '../../src/l2/validation/context.js';
import { qualifyProposedFamily } from '../../src/l2/compiler/source-classifier.js';
import { findDeprecatedMechanicsInText, DEPRECATED_MECHANICS } from '../../src/l2/compiler/deprecated-mechanics.js';
import { DIAGNOSTIC_CODES } from '../../src/l2/model/diagnostic-codes.js';
import { isErrorDiagnostic, isValidStructuredRejection } from '../../src/l2/model/diagnostic.js';
import { isCompleteDiagnostic, structuredRejection } from '../../src/l2/model/diagnostic-factory.js';
import { REJECTED_LAYER_TERMS } from '../../src/l2/model/constitution.js';
import { isL1DefKind, L1_DEF_KINDS } from '../../src/l2/model/def-kind.js';
import type { L1DefKind } from '../../src/l2/model/def-kind.js';
import { KNOWN_SEMANTIC_FAMILY_IDS } from '../../src/l2/model/family-contracts.js';
import { EMPTY_TYPE_IDENTITY } from '../../src/l2/model/reference.js';
import { EMPTY_PARAMETER_SCHEMA } from '../../src/l2/model/schema.js';
import type { CandidateDefinition, SemanticFamilyRegistration } from '../../src/l2/model/definition.js';
import type { SourceRecord } from '../../src/l2/model/source.js';

const PACKAGE_ID = 'pkg-p02-generated';
const DEFINITION_JSON_PATH = '/definitions/0';

const GENERATED_SOURCE_RECORD: SourceRecord = Object.freeze({
  sourceFile: 'docs/generated/p02-family.md',
  sourceLocation: { sourceFile: 'docs/generated/p02-family.md', section: 'generated-family-evidence' },
  precedence: 'finalized-l2-contract',
  classification: 'Normative_Contract',
  owningLayer: '基类层',
  statementFingerprint: 'generated:p02:family-evidence',
});

/** 第一条被否决的废案机制，用于"以基类层标准契约重新引入废案"这一违规面。 */
const VETOED_MECHANIC = DEPRECATED_MECHANICS.find((entry) => entry.status === 'vetoed')!.mechanic;

/** 组合实例名池：这些概念是"枪械类型 + 谱型 + 伤害接口"等基类的组合产物，不是基类族。 */
const CANDIDATE_FAMILY_IDS = ['shotgun', 'sniper-rifle', 'contact-relation', 'ap-economy'] as const;

type FamilyChoice = 'known' | 'proposed-new' | 'unregistered';

interface DefinitionCase {
  readonly familyChoice: FamilyChoice;
  readonly knownFamilyIndex: number;
  readonly candidateFamilyIndex: number;
  readonly enumerable: boolean;
  readonly composable: boolean;
  readonly gameplayIndependent: boolean;
  readonly withRegistrationSources: boolean;
  readonly invalidDefKind: boolean;
  readonly defKindIndex: number;
  readonly declareL1Mechanism: boolean;
  readonly declareGameplayRule: boolean;
  readonly assignGameplayValue: boolean;
  readonly useDeprecatedTerm: boolean;
  readonly reintroduceVetoedMechanic: boolean;
  readonly isAbstract: boolean;
}

function familyIdOf(testCase: DefinitionCase): string {
  if (testCase.familyChoice === 'known') {
    return KNOWN_SEMANTIC_FAMILY_IDS[testCase.knownFamilyIndex % KNOWN_SEMANTIC_FAMILY_IDS.length]!;
  }
  return CANDIDATE_FAMILY_IDS[testCase.candidateFamilyIndex % CANDIDATE_FAMILY_IDS.length]!;
}

function registrationOf(testCase: DefinitionCase): SemanticFamilyRegistration | undefined {
  if (testCase.familyChoice !== 'proposed-new') {
    return undefined;
  }
  const familyId = familyIdOf(testCase);
  const sources = testCase.withRegistrationSources ? [GENERATED_SOURCE_RECORD] : [];
  return {
    familyId,
    classificationReason: 'generated classification reason for the proposed family',
    eligibility: {
      conceptId: familyId,
      enumerable: testCase.enumerable,
      enumerationRationale: 'finite enumeration within the current gameplay scope',
      composable: testCase.composable,
      compositionRationale: 'composes with other base types to produce instances',
      gameplayIndependent: testCase.gameplayIndependent,
      independenceRationale: 'carries no dependency on any concrete gameplay profile',
      sources,
    },
    sourceRecords: sources,
  };
}

function buildDefinition(testCase: DefinitionCase): CandidateDefinition {
  const familyId = familyIdOf(testCase);
  const registration = registrationOf(testCase);
  const validDefKind = L1_DEF_KINDS[testCase.defKindIndex % L1_DEF_KINDS.length]!;
  const tags = ['generated-tag'];
  if (testCase.useDeprecatedTerm) {
    tags.push(`${REJECTED_LAYER_TERMS[0]}-tag`);
  }
  if (testCase.reintroduceVetoedMechanic) {
    tags.push(VETOED_MECHANIC);
  }
  return {
    id: 'gen-definition-p02',
    // 越界 Def kind 是解码器刻意保留的原值（definition-decoder 的注释说明该占位），
    // 由验证器负责报 DEF_INVALID_DEF_KIND；此处构造该非法输入以驱动该路径。
    defKind: testCase.invalidDefKind ? ('not-a-valid-def-kind' as L1DefKind) : validDefKind,
    abstract: testCase.isAbstract,
    semanticFamily: registration === undefined ? { familyId } : { familyId, registration },
    typeIdentity: EMPTY_TYPE_IDENTITY,
    composition: [],
    parameterSchema: EMPTY_PARAMETER_SCHEMA,
    tags,
    actionRefs: [],
    ruleRefs: [],
    sourceRecords: [GENERATED_SOURCE_RECORD],
    sourceLocation: { sourceFile: 'docs/generated/p02-family.md', section: 'generated-definition' },
    jsonPath: DEFINITION_JSON_PATH,
    ...(testCase.declareL1Mechanism ? { declaredL1Mechanisms: ['op-dispatch' as const] } : {}),
    ...(testCase.declareGameplayRule
      ? {
          gameplaySpecificRules: [
            {
              kind: 'victory-condition' as const,
              detail: 'last standing squad wins the generated round',
              jsonPath: `${DEFINITION_JSON_PATH}/gameplaySpecificRules/0`,
            },
          ],
        }
      : {}),
    ...(testCase.assignGameplayValue
      ? {
          gameplayValues: [
            {
              field: 'shotgun-damage',
              value: 3,
              playerVisible: true,
              owningProfile: 'generated-battle-royale-profile',
            },
          ],
        }
      : {}),
  };
}

function buildContext(definition: CandidateDefinition): ValidationContext {
  const definitions = [definition];
  return {
    package: {
      packageId: PACKAGE_ID,
      schemaVersion: 'l2-declarative/1',
      dependencies: [],
      sourceRecords: [GENERATED_SOURCE_RECORD],
      definitions,
    },
    candidateDefinitions: definitions,
    activeDefinitionIds: new Set<string>(),
    registeredFamilies: new Map<string, SemanticFamilyRegistration>(),
    abstractDefinitionIds: new Set(definitions.filter((d) => d.abstract).map((d) => d.id)),
  };
}

const FAILED_CRITERION_CODE = {
  enumerable: DIAGNOSTIC_CODES.FAMILY_NOT_ENUMERABLE,
  composable: DIAGNOSTIC_CODES.FAMILY_NOT_COMPOSABLE,
  gameplayIndependent: DIAGNOSTIC_CODES.FAMILY_GAMEPLAY_DEPENDENT,
} as const;

/**
 * 独立重新推导的期望诊断代码集合（PBT oracle）。
 * 它只依据宪法常量表、废案清单与三判据判定重新推导，不调用被测规则函数。
 */
function expectedDiagnosticCodes(definition: CandidateDefinition): ReadonlySet<string> {
  const expected = new Set<string>();

  if (!isL1DefKind(definition.defKind)) {
    expected.add(DIAGNOSTIC_CODES.DEF_INVALID_DEF_KIND);
  }
  if ((definition.declaredL1Mechanisms ?? []).length > 0) {
    expected.add(DIAGNOSTIC_CODES.LAYER_L1_OWNERSHIP);
  }
  if ((definition.gameplaySpecificRules ?? []).length > 0) {
    expected.add(DIAGNOSTIC_CODES.LAYER_L3_OWNERSHIP);
  }
  if ((definition.gameplayValues ?? []).length > 0) {
    expected.add(DIAGNOSTIC_CODES.VALUE_L3_OWNERSHIP);
  }

  const terminologyTargets = [
    definition.id,
    definition.semanticFamily.familyId,
    ...definition.tags,
    ...definition.typeIdentity.requiredCapabilities,
  ];
  if (terminologyTargets.some((text) => REJECTED_LAYER_TERMS.some((term) => text.includes(term)))) {
    expected.add(DIAGNOSTIC_CODES.TERM_DEPRECATED_LAYER_TERM);
  }

  const mechanicScan = [
    definition.id,
    ...definition.tags,
    ...definition.typeIdentity.requiredCapabilities,
    ...(definition.gameplaySpecificRules ?? []).map((rule) => rule.detail),
  ].join(' ');
  if (findDeprecatedMechanicsInText(mechanicScan).some((entry) => entry.status === 'vetoed')) {
    expected.add(DIAGNOSTIC_CODES.SOURCE_DEPRECATED_MECHANIC);
  }

  const familyId = definition.semanticFamily.familyId;
  const known = (KNOWN_SEMANTIC_FAMILY_IDS as readonly string[]).includes(familyId);
  const registration = definition.semanticFamily.registration;
  if (!known && registration === undefined) {
    expected.add(DIAGNOSTIC_CODES.FAMILY_UNREGISTERED);
  } else if (registration !== undefined) {
    const verdict = qualifyProposedFamily(registration.eligibility);
    if (!verdict.accepted) {
      for (const criterion of verdict.failedCriteria) {
        expected.add(FAILED_CRITERION_CODE[criterion]);
      }
      expected.add(DIAGNOSTIC_CODES.FAMILY_COMBINATION_INSTANCE_AS_BASE);
    } else if (registration.sourceRecords.length === 0) {
      expected.add(DIAGNOSTIC_CODES.DEF_MISSING_SOURCE_RECORD);
    }
  }

  if (!definition.abstract) {
    if ((definition.gameplayValues ?? []).length > 0) {
      expected.add(DIAGNOSTIC_CODES.DEF_INSTANCE_CARRIES_GAMEPLAY_VALUE);
    }
    if ((definition.gameplaySpecificRules ?? []).length > 0) {
      expected.add(DIAGNOSTIC_CODES.DEF_INSTANCE_CARRIES_GAMEPLAY_RULE);
    }
  }
  return expected;
}

const arbCase: fc.Arbitrary<DefinitionCase> = fc.record({
  familyChoice: fc.constantFrom<FamilyChoice>('known', 'proposed-new', 'unregistered'),
  knownFamilyIndex: fc.nat({ max: 32 }),
  candidateFamilyIndex: fc.nat({ max: 32 }),
  enumerable: fc.boolean(),
  composable: fc.boolean(),
  gameplayIndependent: fc.boolean(),
  withRegistrationSources: fc.boolean(),
  invalidDefKind: fc.boolean(),
  defKindIndex: fc.nat({ max: 32 }),
  declareL1Mechanism: fc.boolean(),
  declareGameplayRule: fc.boolean(),
  assignGameplayValue: fc.boolean(),
  useDeprecatedTerm: fc.boolean(),
  reintroduceVetoedMechanic: fc.boolean(),
  isAbstract: fc.boolean(),
});

describe('Property 2: 语义族三判据与层级边界', () => {
  it('三判据当且仅当成立时登记，越层与非法 Def kind 一律结构化拒绝（fast-check，100 次生成）', () => {
    fc.assert(
      fc.property(arbCase, (testCase) => {
        const definition = buildDefinition(testCase);
        const context = buildContext(definition);
        const collector = new DiagnosticCollector();

        validateDefKind(definition, context, collector);
        validateNoL1Mechanism(definition, context, collector);
        validateNoGameplaySpecificRule(definition, context, collector);
        validateNoUnclassifiedGameplayValue(definition, context, collector);
        validateTerminology(definition, context, collector);
        validateNoDeprecatedMechanic(definition, context, collector);
        validateSemanticFamily(definition, context, collector);
        validateAbstractInstantiation(definition, context, collector);

        const diagnostics = collector.all();
        const expected = expectedDiagnosticCodes(definition);
        const actual = new Set(diagnostics.map((d) => d.code));

        // 精确集合相等：既不漏报任何越层/非法声明，也不产生多余诊断（"当且仅当"两个方向）。
        expect(actual).toEqual(expected);

        // 全部发现都必须是 Error 级：层级与三判据违规不能降级为提示。
        expect(diagnostics.every(isErrorDiagnostic)).toBe(true);

        // 每条诊断都必须可定位、可修复（Requirements 13.2）。
        for (const diagnostic of diagnostics) {
          expect(isCompleteDiagnostic(diagnostic)).toBe(true);
          expect(diagnostic.definitionId).toBe(definition.id);
          expect(diagnostic.sourcePackage).toBe(PACKAGE_ID);
          expect(diagnostic.jsonPath).toBeDefined();
          expect(diagnostic.sourceLocation).toBeDefined();
          expect(diagnostic.reason.trim().length).toBeGreaterThan(0);
          expect(diagnostic.correctionSuggestion.trim().length).toBeGreaterThan(0);
        }

        // 有违规即产生合法 Structured_Rejection；无违规则不得构造拒绝。
        if (expected.size > 0) {
          const rejection = structuredRejection(diagnostics);
          expect(rejection.rejected).toBe(true);
          expect(isValidStructuredRejection(rejection)).toBe(true);
        } else {
          expect(diagnostics).toHaveLength(0);
        }

        // ── 三判据的独立断言：接受当且仅当三条同时成立 ─────────────────────────
        const registration = definition.semanticFamily.registration;
        if (registration !== undefined) {
          const verdict = qualifyProposedFamily(registration.eligibility);
          expect(verdict.accepted).toBe(
            testCase.enumerable && testCase.composable && testCase.gameplayIndependent,
          );
          const expectedFailed: string[] = [];
          if (!testCase.enumerable) expectedFailed.push('enumerable');
          if (!testCase.composable) expectedFailed.push('composable');
          if (!testCase.gameplayIndependent) expectedFailed.push('gameplayIndependent');
          expect([...verdict.failedCriteria].sort()).toEqual(expectedFailed.sort());

          // 通过三判据的族必须保存分类理由与来源（Requirements 4.3、16.9）。
          if (verdict.accepted) {
            expect(registration.classificationReason.trim().length).toBeGreaterThan(0);
            const hasSources = registration.sourceRecords.length > 0;
            expect(actual.has(DIAGNOSTIC_CODES.DEF_MISSING_SOURCE_RECORD)).toBe(!hasSources);
          }

          // 组合实例（如霰弹枪）不得被提升为基类语义族：三判据不成立即拒绝并给出组合建议。
          if (!verdict.accepted) {
            expect(actual.has(DIAGNOSTIC_CODES.FAMILY_COMBINATION_INSTANCE_AS_BASE)).toBe(true);
          }
        }

        // 未登记且无三判据证据的族一律拒绝，绝不静默接受。
        const familyId = definition.semanticFamily.familyId;
        const known = (KNOWN_SEMANTIC_FAMILY_IDS as readonly string[]).includes(familyId);
        if (!known && registration === undefined) {
          expect(actual.has(DIAGNOSTIC_CODES.FAMILY_UNREGISTERED)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

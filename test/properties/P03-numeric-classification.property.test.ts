// Feature: l2-base-layer-spec, Property 3: 数值分类、归属与范围
//
// 性质原文（design.md「Correctness Properties / Property 3」）：
//   For any declared numeric field and value, 字段必须且只能具备玩法数值、结构边界、宪法常量或
//   内部度量之一的有效分类；玩家可见玩法数值仅在玩法层且落于 1–5，结构边界和宪法常量必须带所需
//   来源元数据，内部度量仅按自身 Schema 验证，其他所有情形都被拒绝。
//
// Validates: Requirements 2.5
// Additional coverage: Requirements 5.1, 5.3–5.8, 5.11–5.12, 8.4, 9.1, 9.6, 15.8
//
// 被测实现：src/l2/validation/parameter-rules.ts + src/l2/validation/classification-rules.ts
// 状态：运行中。
//
// 宪法约束落实：生成器在 [-2, 7] 上取范围端点，覆盖 1–5 边界内与边界外；内部度量与非玩家可见
// 玩法数值必须被断言"不套用 1–5"（L0 数值铁律的"内部数值例外"）。
//
// 自主设计判断（须知）：validator.ts 编排入口尚未实现，本测试直接驱动 parameter-rules.ts 的真实
// 规则函数并用真实 DiagnosticCollector 汇总；未做替身、未放宽断言。

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { validateParameters } from '../../src/l2/validation/parameter-rules.js';
import { validateNoUnclassifiedGameplayValue } from '../../src/l2/validation/classification-rules.js';
import { DiagnosticCollector } from '../../src/l2/validation/context.js';
import type { ValidationContext } from '../../src/l2/validation/context.js';
import { DIAGNOSTIC_CODES } from '../../src/l2/model/diagnostic-codes.js';
import { isErrorDiagnostic } from '../../src/l2/model/diagnostic.js';
import { isCompleteDiagnostic } from '../../src/l2/model/diagnostic-factory.js';
import { GAMEPLAY_VALUE_RANGE } from '../../src/l2/model/constitution.js';
import {
  DECLARED_TYPES,
  GAMEPLAY_VALUE_KINDS,
  NUMERIC_DECLARED_TYPES,
  PARAMETER_CLASSIFICATIONS,
} from '../../src/l2/model/schema.js';
import type {
  DeclaredRange,
  DeclaredType,
  GameplayValueKind,
  ParameterClassification,
  ParameterField,
  ParameterSchema,
} from '../../src/l2/model/schema.js';
import { EMPTY_TYPE_IDENTITY } from '../../src/l2/model/reference.js';
import type { CandidateDefinition, SemanticFamilyRegistration } from '../../src/l2/model/definition.js';
import type { SourceRecord } from '../../src/l2/model/source.js';

const PACKAGE_ID = 'pkg-p03-generated';
const DEFINITION_JSON_PATH = '/definitions/0';
const PRIMARY_FIELD = 'generated-primary-field';
const NESTED_FIELD = 'generated-nested-field';

const GENERATED_SOURCE_RECORD: SourceRecord = Object.freeze({
  sourceFile: 'docs/generated/p03-numeric.md',
  sourceLocation: { sourceFile: 'docs/generated/p03-numeric.md', section: 'generated-numeric' },
  precedence: 'l0-constitution',
  classification: 'Normative_Contract',
  owningLayer: '基类层',
  statementFingerprint: 'generated:p03:numeric-source',
});

/** Requirements 5.8 点名的玩法数值表类别：基类层只能暴露接口，不能具体化。 */
const TABLE_KINDS: ReadonlySet<string> = new Set(['damage-table', 'probability-table', 'ap-price-table']);

/** 非枚举内取值：用于驱动"缺少有效分类"这一必须被拒绝的情形。 */
const INVALID_CLASSIFICATION = '__not_a_classification__';

interface FieldCase {
  readonly classification: ParameterClassification | typeof INVALID_CLASSIFICATION;
  readonly dataType: DeclaredType;
  readonly rangeMin: number | undefined;
  readonly rangeMax: number | undefined;
  readonly playerVisible: boolean | undefined;
  readonly gameplayValueKind: GameplayValueKind | undefined;
  readonly withDefaultValue: boolean;
  readonly withAuthoritativeSource: boolean;
  readonly withStructuralRationale: boolean;
  readonly withOwningLayer: boolean;
  readonly withInternalMetricSchema: boolean;
  readonly withReferenceTarget: boolean;
  readonly duplicateFieldName: boolean;
  readonly danglingConstraint: boolean;
  readonly definitionCarriesGameplayValue: boolean;
}

function rangeOf(testCase: FieldCase): DeclaredRange | undefined {
  if (testCase.rangeMin === undefined && testCase.rangeMax === undefined) {
    return undefined;
  }
  return {
    ...(testCase.rangeMin === undefined ? {} : { min: testCase.rangeMin }),
    ...(testCase.rangeMax === undefined ? {} : { max: testCase.rangeMax }),
  };
}

function buildField(name: string, testCase: FieldCase, withNested: boolean): ParameterField {
  const range = rangeOf(testCase);
  return {
    name,
    dataType: testCase.dataType,
    required: true,
    // 越界分类是刻意构造的非法输入：解码器会拒绝它，验证器的分类守卫也必须拒绝它。
    classification: testCase.classification as ParameterClassification,
    ...(range === undefined ? {} : { range }),
    ...(testCase.playerVisible === undefined ? {} : { playerVisible: testCase.playerVisible }),
    ...(testCase.gameplayValueKind === undefined ? {} : { gameplayValueKind: testCase.gameplayValueKind }),
    ...(testCase.withDefaultValue ? { defaultValue: 3 } : {}),
    ...(testCase.withAuthoritativeSource ? { authoritativeSource: GENERATED_SOURCE_RECORD } : {}),
    ...(testCase.withStructuralRationale
      ? { structuralRationale: 'guarantees the declared type structure and engine invariant' }
      : {}),
    ...(testCase.withOwningLayer ? { owningLayer: '基类层' as const } : {}),
    ...(testCase.withInternalMetricSchema
      ? { internalMetricSchema: { metric: 'generated-turn-index', integral: true } }
      : {}),
    ...(testCase.withReferenceTarget
      ? { referenceTarget: { allowAbstract: false, defKind: 'rule' as const } }
      : {}),
    ...(withNested ? { objectFields: [buildField(NESTED_FIELD, testCase, false)] } : {}),
  };
}

function buildSchema(testCase: FieldCase): ParameterSchema {
  const fields: ParameterField[] = [buildField(PRIMARY_FIELD, testCase, true)];
  if (testCase.duplicateFieldName) {
    fields.push(buildField(PRIMARY_FIELD, testCase, true));
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

function buildDefinition(testCase: FieldCase): CandidateDefinition {
  return {
    id: 'gen-definition-p03',
    defKind: 'item',
    abstract: true,
    semanticFamily: { familyId: 'item' },
    typeIdentity: EMPTY_TYPE_IDENTITY,
    composition: [],
    parameterSchema: buildSchema(testCase),
    tags: [],
    actionRefs: [],
    ruleRefs: [],
    sourceRecords: [GENERATED_SOURCE_RECORD],
    sourceLocation: { sourceFile: 'docs/generated/p03-numeric.md', section: 'generated-definition' },
    jsonPath: DEFINITION_JSON_PATH,
    ...(testCase.definitionCarriesGameplayValue
      ? {
          gameplayValues: [
            {
              field: PRIMARY_FIELD,
              value: 4,
              playerVisible: true,
              owningProfile: 'generated-profile',
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

/**
 * 独立重新推导的期望诊断代码集合（PBT oracle）。
 * 只依据 requirements.md 的分类规则与 L0 的 1–5 数值铁律推导，不调用被测规则函数。
 */
function expectedDiagnosticCodes(testCase: FieldCase): ReadonlySet<string> {
  const expected = new Set<string>();
  const range = rangeOf(testCase);
  const isNumeric = NUMERIC_DECLARED_TYPES.has(testCase.dataType);

  // ── Schema 形状（只对顶层字段生效） ──────────────────────────────────────
  if (testCase.duplicateFieldName) {
    expected.add(DIAGNOSTIC_CODES.SCHEMA_FIELD_DUPLICATE_NAME);
  }
  if (
    range !== undefined &&
    testCase.rangeMin !== undefined &&
    testCase.rangeMax !== undefined &&
    testCase.rangeMin > testCase.rangeMax
  ) {
    expected.add(DIAGNOSTIC_CODES.SCHEMA_FIELD_RANGE_MALFORMED);
  }
  if (testCase.danglingConstraint) {
    expected.add(DIAGNOSTIC_CODES.SCHEMA_CROSS_FIELD_CONSTRAINT_UNRESOLVED);
  }

  // ── 四类分类的互斥完整校验 ───────────────────────────────────────────────
  switch (testCase.classification) {
    case 'Gameplay_Value': {
      if (testCase.gameplayValueKind === undefined) {
        expected.add(DIAGNOSTIC_CODES.SCHEMA_FIELD_MISSING_CLASSIFICATION);
      }
      if (testCase.playerVisible === undefined) {
        expected.add(DIAGNOSTIC_CODES.SCHEMA_FIELD_MISSING_CLASSIFICATION);
      }
      if (testCase.withDefaultValue) {
        expected.add(DIAGNOSTIC_CODES.SCHEMA_GAMEPLAY_TABLE_IN_L2);
      }
      if (
        testCase.gameplayValueKind !== undefined &&
        TABLE_KINDS.has(testCase.gameplayValueKind) &&
        (range !== undefined || testCase.withDefaultValue)
      ) {
        expected.add(DIAGNOSTIC_CODES.SCHEMA_GAMEPLAY_TABLE_IN_L2);
      }
      if (
        isNumeric &&
        testCase.playerVisible === true &&
        range !== undefined &&
        ((testCase.rangeMin !== undefined && testCase.rangeMin < GAMEPLAY_VALUE_RANGE.min) ||
          (testCase.rangeMax !== undefined && testCase.rangeMax > GAMEPLAY_VALUE_RANGE.max))
      ) {
        expected.add(DIAGNOSTIC_CODES.SCHEMA_GAMEPLAY_VALUE_OUT_OF_RANGE);
      }
      break;
    }
    case 'Structural_Bound': {
      if (!testCase.withAuthoritativeSource) {
        expected.add(DIAGNOSTIC_CODES.SCHEMA_STRUCTURAL_BOUND_MISSING_SOURCE);
      }
      if (!testCase.withStructuralRationale) {
        expected.add(DIAGNOSTIC_CODES.SCHEMA_STRUCTURAL_BOUND_MISSING_RATIONALE);
      }
      break;
    }
    case 'Constitutional_Constant': {
      if (!testCase.withAuthoritativeSource) {
        expected.add(DIAGNOSTIC_CODES.SCHEMA_CONSTITUTIONAL_CONSTANT_MISSING_SOURCE);
      }
      if (!testCase.withOwningLayer) {
        expected.add(DIAGNOSTIC_CODES.SCHEMA_CONSTITUTIONAL_CONSTANT_MISSING_LAYER);
      }
      break;
    }
    case 'Internal_Metric': {
      if (!testCase.withInternalMetricSchema) {
        expected.add(DIAGNOSTIC_CODES.SCHEMA_INTERNAL_METRIC_MISSING_SCHEMA);
      }
      break;
    }
    default: {
      expected.add(DIAGNOSTIC_CODES.SCHEMA_FIELD_MISSING_CLASSIFICATION);
      break;
    }
  }

  if (testCase.dataType === 'reference' && !testCase.withReferenceTarget) {
    expected.add(DIAGNOSTIC_CODES.SCHEMA_FIELD_REFERENCE_TARGET_MISSING);
  }
  if (testCase.definitionCarriesGameplayValue) {
    expected.add(DIAGNOSTIC_CODES.VALUE_L3_OWNERSHIP);
  }
  return expected;
}

const arbCase: fc.Arbitrary<FieldCase> = fc.record({
  classification: fc.constantFrom<ParameterClassification | typeof INVALID_CLASSIFICATION>(
    ...PARAMETER_CLASSIFICATIONS,
    INVALID_CLASSIFICATION,
  ),
  dataType: fc.constantFrom<DeclaredType>(...DECLARED_TYPES),
  // 覆盖 1–5 边界内与边界外（含负值与上溢），并覆盖"未声明范围"。
  rangeMin: fc.option(fc.integer({ min: -2, max: 7 }), { nil: undefined }),
  rangeMax: fc.option(fc.integer({ min: -2, max: 7 }), { nil: undefined }),
  playerVisible: fc.option(fc.boolean(), { nil: undefined }),
  gameplayValueKind: fc.option(fc.constantFrom<GameplayValueKind>(...GAMEPLAY_VALUE_KINDS), {
    nil: undefined,
  }),
  withDefaultValue: fc.boolean(),
  withAuthoritativeSource: fc.boolean(),
  withStructuralRationale: fc.boolean(),
  withOwningLayer: fc.boolean(),
  withInternalMetricSchema: fc.boolean(),
  withReferenceTarget: fc.boolean(),
  duplicateFieldName: fc.boolean(),
  danglingConstraint: fc.boolean(),
  definitionCarriesGameplayValue: fc.boolean(),
});

describe('Property 3: 数值分类、归属与范围', () => {
  it('四类分类互斥完整、玩家可见值限 1–5、内部度量例外（fast-check，100 次生成）', () => {
    fc.assert(
      fc.property(arbCase, (testCase) => {
        const definition = buildDefinition(testCase);
        const context = buildContext(definition);
        const collector = new DiagnosticCollector();

        validateParameters(definition, context, collector);
        validateNoUnclassifiedGameplayValue(definition, context, collector);

        const diagnostics = collector.all();
        const actual = new Set(diagnostics.map((d) => d.code));
        const expected = expectedDiagnosticCodes(testCase);

        // 精确集合相等：任何未分类、缺来源、越界或越层情形都被拒绝，合法情形不产生噪声。
        expect(actual).toEqual(expected);
        expect(diagnostics.every(isErrorDiagnostic)).toBe(true);

        for (const diagnostic of diagnostics) {
          expect(isCompleteDiagnostic(diagnostic)).toBe(true);
          expect(diagnostic.definitionId).toBe(definition.id);
          expect(diagnostic.sourcePackage).toBe(PACKAGE_ID);
          expect(diagnostic.jsonPath?.startsWith(DEFINITION_JSON_PATH)).toBe(true);
        }

        // ── L0 数值铁律的"内部数值例外" ─────────────────────────────────────
        // 内部度量按自身 Schema 验证，绝不套用玩家可见的 1–5 约束。
        if (testCase.classification === 'Internal_Metric') {
          expect(actual.has(DIAGNOSTIC_CODES.SCHEMA_GAMEPLAY_VALUE_OUT_OF_RANGE)).toBe(false);
        }
        // 结构边界与宪法常量同样不套用玩法数值范围，只校验来源元数据。
        if (
          testCase.classification === 'Structural_Bound' ||
          testCase.classification === 'Constitutional_Constant'
        ) {
          expect(actual.has(DIAGNOSTIC_CODES.SCHEMA_GAMEPLAY_VALUE_OUT_OF_RANGE)).toBe(false);
        }
        // 非玩家可见的玩法数值不受 1–5 约束（该约束只针对玩家可见数值）。
        if (testCase.classification === 'Gameplay_Value' && testCase.playerVisible !== true) {
          expect(actual.has(DIAGNOSTIC_CODES.SCHEMA_GAMEPLAY_VALUE_OUT_OF_RANGE)).toBe(false);
        }

        // ── 玩家可见玩法数值的边界断言 ───────────────────────────────────────
        const range = rangeOf(testCase);
        const isNumeric = NUMERIC_DECLARED_TYPES.has(testCase.dataType);
        if (
          testCase.classification === 'Gameplay_Value' &&
          isNumeric &&
          testCase.playerVisible === true &&
          range !== undefined
        ) {
          const withinBounds =
            (testCase.rangeMin === undefined || testCase.rangeMin >= GAMEPLAY_VALUE_RANGE.min) &&
            (testCase.rangeMax === undefined || testCase.rangeMax <= GAMEPLAY_VALUE_RANGE.max);
          expect(actual.has(DIAGNOSTIC_CODES.SCHEMA_GAMEPLAY_VALUE_OUT_OF_RANGE)).toBe(!withinBounds);
        }

        // 玩法数值归玩法层：基类层字段一旦携带具体默认值即被拒绝（Requirements 5.2、5.8）。
        if (testCase.classification === 'Gameplay_Value' && testCase.withDefaultValue) {
          expect(actual.has(DIAGNOSTIC_CODES.SCHEMA_GAMEPLAY_TABLE_IN_L2)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

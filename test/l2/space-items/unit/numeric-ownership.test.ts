/**
 * 单元测试：space-items-numeric-ownership 分类判定与玩法值 1-5 门限。
 *
 * 实施前要求 1.3：完整覆盖嵌套参数字段，堵住 playerVisible:false 无豁免来源的绕过。
 */

import { describe, it, expect } from 'vitest';
import {
  NUMERIC_OWNERSHIPS,
  CLASSIFICATION_FAILURES,
  isNumericOwnership,
  classifyNumericField,
  validateGameplayValue,
  validateInternalMetric,
  collectNumericFields,
  indexFieldsByName,
  type NumericFieldCandidate,
  type NumericFieldClassification,
  type NumericLeaf,
} from '../../../../src/l2/model/space-items-numeric-ownership.js';

describe('space-items-numeric-ownership: 基本导出', () => {
  it('导出四种数值归属分类', () => {
    expect(NUMERIC_OWNERSHIPS).toEqual([
      'Gameplay_Value',
      'Structural_Bound',
      'Constitutional_Constant',
      'Internal_Metric',
    ]);
  });

  it('导出八种分类失败原因', () => {
    expect(CLASSIFICATION_FAILURES).toHaveLength(8);
  });

  it('isNumericOwnership 正确识别归属分类', () => {
    expect(isNumericOwnership('Gameplay_Value')).toBe(true);
    expect(isNumericOwnership('Structural_Bound')).toBe(true);
    expect(isNumericOwnership('unknown')).toBe(false);
    expect(isNumericOwnership(null)).toBe(false);
  });
});

describe('space-items-numeric-ownership: 分类判定（实施前要求 1.3）', () => {
  it('Gameplay_Value 且玩家可见 → 必须有 playerVisible:true', () => {
    const field: NumericFieldCandidate = {
      name: 'damageAmount',
      dataType: 'number',
      classification: 'Gameplay_Value',
      playerVisible: true,
      unit: 'hp',
      required: true,
    };

    const outcome = classifyNumericField(field, '/damageAmount');

    expect(outcome.failures).toHaveLength(0);
    expect(outcome.classification?.ownership).toBe('Gameplay_Value');
    expect(outcome.classification?.playerVisible).toBe(true);
  });

  it('Gameplay_Value 且 playerVisible 缺失 → classification-missing', () => {
    const field: NumericFieldCandidate = {
      name: 'damageAmount',
      dataType: 'number',
      classification: 'Gameplay_Value',
      unit: 'hp',
      required: true,
    };

    const outcome = classifyNumericField(field, '/damageAmount');

    expect(outcome.failures).toContain('gameplay-value-missing-visibility');
  });

  it('Gameplay_Value 且 playerVisible:false 但无豁免来源 → gameplay-value-missing-exemption-source', () => {
    const field: NumericFieldCandidate = {
      name: 'hiddenMetric',
      dataType: 'number',
      classification: 'Gameplay_Value',
      playerVisible: false,
      unit: 'dimensionless',
      required: true,
    };

    const outcome = classifyNumericField(field, '/hiddenMetric');

    expect(outcome.failures).toContain('gameplay-value-missing-exemption-source');
  });

  it('Gameplay_Value 且 playerVisible:false 且有豁免来源 → 通过', () => {
    const field: NumericFieldCandidate = {
      name: 'internalCounter',
      dataType: 'number',
      classification: 'Gameplay_Value',
      playerVisible: false,
      unit: 'count',
      required: true,
      authoritativeSource: {
        sourceFile: 'exemption.md',
        sourceLocation: { sourceFile: 'exemption.md', section: '§1' },
        precedence: 'finalized-l2-contract',
        classification: 'Normative_Contract',
        owningLayer: '基类层',
        statementFingerprint: 'exemption:internal-counter',
      },
    };

    const outcome = classifyNumericField(field, '/internalCounter');

    expect(outcome.failures).toHaveLength(0);
    expect(outcome.classification?.ownership).toBe('Gameplay_Value');
    expect(outcome.classification?.playerVisible).toBe(false);
    expect(outcome.classification?.authoritativeSources.length).toBe(1);
  });

  it('Structural_Bound 缺来源或理由 → structural-bound-missing-source / structural-bound-missing-rationale', () => {
    const fieldMissingSource: NumericFieldCandidate = {
      name: 'bound1',
      dataType: 'number',
      classification: 'Structural_Bound',
      unit: 'count',
      required: true,
      structuralRationale: 'some rationale',
    };

    const outcome1 = classifyNumericField(fieldMissingSource, '/bound1');
    expect(outcome1.failures).toContain('structural-bound-missing-source');

    const fieldMissingRationale: NumericFieldCandidate = {
      name: 'bound2',
      dataType: 'number',
      classification: 'Structural_Bound',
      unit: 'count',
      required: true,
      authoritativeSource: {
        sourceFile: 'spec.md',
        sourceLocation: { sourceFile: 'spec.md', section: '§2' },
        precedence: 'l0-constitution',
        classification: 'Normative_Contract',
        owningLayer: '基类层',
        statementFingerprint: 'bound:test',
      },
    };

    const outcome2 = classifyNumericField(fieldMissingRationale, '/bound2');
    expect(outcome2.failures).toContain('structural-bound-missing-rationale');
  });

  it('Internal_Metric 缺显式度量标注 → unlabeled-internal-metric', () => {
    const field: NumericFieldCandidate = {
      name: 'someMetric',
      dataType: 'number',
      classification: 'Internal_Metric',
      unit: 'count',
      required: true,
    };

    const outcome = classifyNumericField(field, '/someMetric');

    expect(outcome.failures).toContain('unlabeled-internal-metric');
  });

  it('Internal_Metric 有显式度量标注 → 通过', () => {
    const field: NumericFieldCandidate = {
      name: 'connCount',
      dataType: 'number',
      classification: 'Internal_Metric',
      unit: 'connection-count',
      required: true,
      internalMetricSchema: { metric: 'connection-count', integral: true },
    };

    const outcome = classifyNumericField(field, '/connCount');

    expect(outcome.failures).toHaveLength(0);
    expect(outcome.classification?.internalMetric).toBe('connection-count');
  });

  it('Constitutional_Constant 缺层或来源 → constitutional-constant-missing-layer / structural-bound-missing-source', () => {
    const fieldMissingLayer: NumericFieldCandidate = {
      name: 'const1',
      dataType: 'number',
      classification: 'Constitutional_Constant',
      unit: 'count',
      required: true,
      authoritativeSource: {
        sourceFile: 'const.md',
        sourceLocation: { sourceFile: 'const.md', section: '§1' },
        precedence: 'l0-constitution',
        classification: 'Normative_Contract',
        owningLayer: '基类层',
        statementFingerprint: 'const:test',
      },
    };

    const outcome1 = classifyNumericField(fieldMissingLayer, '/const1');
    expect(outcome1.failures).toContain('constitutional-constant-missing-layer');

    const fieldMissingSource: NumericFieldCandidate = {
      name: 'const2',
      dataType: 'number',
      classification: 'Constitutional_Constant',
      unit: 'count',
      required: true,
      owningLayer: '基类层',
    };

    const outcome2 = classifyNumericField(fieldMissingSource, '/const2');
    expect(outcome2.failures).toContain('structural-bound-missing-source');
  });
});

describe('space-items-numeric-ownership: 玩法数值 1-5 门限', () => {
  it('玩家可见玩法数值必须在 1-5 范围内', () => {
    const classification: NumericFieldClassification = {
      fieldPath: '/damage',
      ownership: 'Gameplay_Value',
      unit: 'hp',
      owningLayer: '玩法层',
      playerVisible: true,
      authoritativeSources: [],
    };

    const verdict1 = validateGameplayValue(classification, 3);
    expect(verdict1.acceptable).toBe(true);

    const verdict2 = validateGameplayValue(classification, 0);
    expect(verdict2.acceptable).toBe(false);
    expect(verdict2.reason).toBe('out-of-range');

    const verdict3 = validateGameplayValue(classification, 6);
    expect(verdict3.acceptable).toBe(false);
    expect(verdict3.reason).toBe('out-of-range');

    const verdict4 = validateGameplayValue(classification, 3.5);
    expect(verdict4.acceptable).toBe(false);
    expect(verdict4.reason).toBe('not-integer');

    const verdict5 = validateGameplayValue(classification, NaN);
    expect(verdict5.acceptable).toBe(false);
    expect(verdict5.reason).toBe('not-finite');

    const verdict6 = validateGameplayValue(classification, Infinity);
    expect(verdict6.acceptable).toBe(false);
    expect(verdict6.reason).toBe('not-finite');
  });

  it('非玩家可见玩法数值需要豁免来源才不受 1-5 约束', () => {
    const classificationWithSource: NumericFieldClassification = {
      fieldPath: '/internalCounter',
      ownership: 'Gameplay_Value',
      unit: 'count',
      owningLayer: '玩法层',
      playerVisible: false,
      authoritativeSources: [
        {
          sourceFile: 'exemption.md',
          sourceLocation: { sourceFile: 'exemption.md', section: '§1' },
          precedence: 'finalized-l2-contract',
          classification: 'Normative_Contract',
          owningLayer: '基类层',
          statementFingerprint: 'exemption:counter',
        },
      ],
    };

    const verdict = validateGameplayValue(classificationWithSource, 100);
    expect(verdict.acceptable).toBe(true);

    const classificationNoSource: NumericFieldClassification = {
      ...classificationWithSource,
      authoritativeSources: [],
    };

    const verdict2 = validateGameplayValue(classificationNoSource, 100);
    expect(verdict2.acceptable).toBe(false);
    expect(verdict2.reason).toBe('missing-exemption-source');
  });

  it('非 Gameplay_Value 不受 1-5 约束', () => {
    const bound: NumericFieldClassification = {
      fieldPath: '/connectionLimit',
      ownership: 'Structural_Bound',
      unit: 'connection-count',
      owningLayer: '基类层',
      playerVisible: false,
      authoritativeSources: [],
    };

    const verdict = validateGameplayValue(bound, 5);
    expect(verdict.acceptable).toBe(true);
    expect(verdict.reason).toBe('not-gameplay-value');
  });
});

describe('space-items-numeric-ownership: 递归收集数值叶（实施前要求 1.3）', () => {
  it('收集嵌套参数中的全部数值叶', () => {
    const definition = {
      id: 'test',
      parameters: [
        {
          name: 'damage',
          dataType: 'number',
          defaultValue: 3,
          range: { min: 1, max: 5 },
        },
        {
          name: 'nested',
          dataType: 'object',
          objectFields: [
            {
              name: 'innerValue',
              dataType: 'number',
              defaultValue: 10,
            },
          ],
        },
      ],
      composition: [
        {
          role: 'test-role',
          parameters: { cost: 2 },
        },
      ],
    };

    const leaves: readonly NumericLeaf[] = collectNumericFields(definition);

    expect(leaves.length).toBeGreaterThan(0);

    const paths = leaves.map((leaf) => leaf.fieldPath);
    expect(paths).toContain('/parameters/0/defaultValue');
    expect(paths).toContain('/parameters/0/range/min');
    expect(paths).toContain('/parameters/0/range/max');
    expect(paths).toContain('/parameters/1/objectFields/0/defaultValue');
    expect(paths).toContain('/composition/0/parameters/cost');
  });

  it('区分声明与赋值区域', () => {
    const definition = {
      parameters: [
        {
          name: 'hp',
          dataType: 'number',
          range: { min: 1, max: 5 },
          defaultValue: 3,
        },
      ],
    };

    const leaves = collectNumericFields(definition);

    const rangeLeaves = leaves.filter((leaf) => leaf.region === 'parameter-declaration');
    const defaultLeaves = leaves.filter((leaf) => leaf.region === 'parameter-default');

    expect(rangeLeaves.length).toBe(2); // min, max
    expect(defaultLeaves.length).toBe(1); // defaultValue
  });

  it('跳过来源记录与纯表现信息', () => {
    const definition = {
      parameters: [
        {
          name: 'hp',
          dataType: 'number',
          defaultValue: 3,
        },
      ],
      sourceRecords: [
        {
          sourceFile: 'spec.md',
          someNumericField: 123,
        },
      ],
      presentation: {
        someDisplayValue: 456,
      },
    };

    const leaves = collectNumericFields(definition);

    const paths = leaves.map((leaf) => leaf.fieldPath);
    expect(paths).not.toContain('/sourceRecords/0/someNumericField');
    expect(paths).not.toContain('/presentation/someDisplayValue');
  });
});

describe('space-items-numeric-ownership: 内部度量校验', () => {
  it('validateInternalMetric 要求显式标注', () => {
    const fieldWithSchema = {
      name: 'connCount',
      dataType: 'number',
      classification: 'Internal_Metric',
      unit: 'connection-count',
      required: true,
      internalMetricSchema: { metric: 'connection-count', integral: true },
    };

    expect(validateInternalMetric(fieldWithSchema as any)).toBe(true);

    const fieldWithoutSchema = {
      name: 'someMetric',
      dataType: 'number',
      classification: 'Internal_Metric',
      unit: 'count',
      required: true,
    };

    expect(validateInternalMetric(fieldWithoutSchema as any)).toBe(false);

    const fieldNotMetric = {
      name: 'damage',
      dataType: 'number',
      classification: 'Gameplay_Value',
      unit: 'hp',
      required: true,
    };

    expect(validateInternalMetric(fieldNotMetric as any)).toBe(false);
  });
});

describe('space-items-numeric-ownership: 字段索引', () => {
  it('indexFieldsByName 递归索引嵌套字段', () => {
    const fields = [
      {
        name: 'damage',
        dataType: 'number',
        classification: 'Gameplay_Value',
      },
      {
        name: 'nested',
        dataType: 'object',
        objectFields: [
          {
            name: 'innerValue',
            dataType: 'number',
            classification: 'Internal_Metric',
          },
        ],
      },
    ];

    const index = indexFieldsByName(fields as any);

    expect(index.get('damage')).toBeDefined();
    expect(index.get('nested')).toBeDefined();
    expect(index.get('innerValue')).toBeDefined();
  });
});

describe('space-items-numeric-ownership: 冻结与稳定性', () => {
  it('NUMERIC_OWNERSHIPS 被冻结', () => {
    expect(Object.isFrozen(NUMERIC_OWNERSHIPS)).toBe(true);
  });

  it('CLASSIFICATION_FAILURES 被冻结', () => {
    expect(Object.isFrozen(CLASSIFICATION_FAILURES)).toBe(true);
  });
});

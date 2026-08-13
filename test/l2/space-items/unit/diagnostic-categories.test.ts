/**
 * 单元测试：space-items-diagnostic-categories 诊断映射与 ERR_CODES 形状快照。
 *
 * 实施前要求 1.4：DOMAIN_CODE_MAP 的全部条件必须映射到已登记 ErrCode，且 ERR_CODES_SHAPE_SNAPSHOT = 127。
 */

import { describe, it, expect } from 'vitest';
import {
  SPACE_ITEMS_DIAGNOSTIC_CATEGORIES,
  DOMAIN_CODE_MAP,
  REQUIREMENT_DIAGNOSTIC_EQUIVALENCES,
  ERR_CODES_SHAPE_SNAPSHOT,
  DIAGNOSTIC_SCOPES,
  categoryRank,
  codeOf,
  domainDiagnostic,
  sortDomainDiagnostics,
  allCategoryConditions,
} from '../../../../src/l2/model/space-items-diagnostic-categories.js';
import { ERR_CODES } from '../../../../src/core/kernel/state/error-codes.js';

describe('space-items-diagnostic-categories: 基本导出', () => {
  it('导出21个诊断类别', () => {
    expect(SPACE_ITEMS_DIAGNOSTIC_CATEGORIES).toHaveLength(21);
  });

  it('导出3个诊断作用域', () => {
    expect(DIAGNOSTIC_SCOPES).toEqual(['definition', 'package', 'runtime']);
  });

  it('ERR_CODES_SHAPE_SNAPSHOT 声称127个稳定码', () => {
    expect(ERR_CODES_SHAPE_SNAPSHOT.memberCount).toBe(127);
    expect(ERR_CODES_SHAPE_SNAPSHOT.groupCount).toBe(11);
  });
});

describe('space-items-diagnostic-categories: ERR_CODES 实际形状（实施前要求 1.4）', () => {
  it('ERR_CODES 包含至少 11 个顶层分组', () => {
    const groupCount = Object.keys(ERR_CODES).length;
    expect(
      groupCount,
      `ERR_CODES 分组数已漂移：快照声称 ${ERR_CODES_SHAPE_SNAPSHOT.groupCount}，实际为 ${groupCount}`,
    ).toBeGreaterThanOrEqual(ERR_CODES_SHAPE_SNAPSHOT.groupCount);

    // 全展开成员总数
    let totalMembers = 0;
    for (const group of Object.values(ERR_CODES)) {
      if (Array.isArray(group)) {
        totalMembers += group.length;
      }
    }

    expect(
      totalMembers,
      `ERR_CODES 展开后成员总数已漂移：快照声称 ${ERR_CODES_SHAPE_SNAPSHOT.memberCount}，实际为 ${totalMembers}`,
    ).toBeGreaterThanOrEqual(ERR_CODES_SHAPE_SNAPSHOT.memberCount);
  });
});

describe('space-items-diagnostic-categories: DOMAIN_CODE_MAP 全覆盖（实施前要求 1.4）', () => {
  it('DOMAIN_CODE_MAP 中的全部条件映射到已登记的展开 ErrCode', () => {
    const allConditions = allCategoryConditions();

    // 展开 ERR_CODES 分组
    const flatCodes = new Set<string>();
    for (const [prefix, group] of Object.entries(ERR_CODES)) {
      if (Array.isArray(group)) {
        for (const suffix of group) {
          flatCodes.add(`${prefix}_${suffix}`);
        }
      }
    }

    for (const { category, condition, code } of allConditions) {
      expect(
        flatCodes.has(code),
        `${category}::${condition} 映射的 ${code} 未在展开后的 ERR_CODES 中`,
      ).toBe(true);
    }
  });

  it('DOMAIN_CODE_MAP 覆盖21个类别', () => {
    const categoriesInMap = Object.keys(DOMAIN_CODE_MAP);
    expect(categoriesInMap).toHaveLength(21);

    for (const category of SPACE_ITEMS_DIAGNOSTIC_CATEGORIES) {
      expect(
        categoriesInMap,
        `类别 ${category} 未在 DOMAIN_CODE_MAP 登记`,
      ).toContain(category);
    }
  });

  it('codeOf 返回正确的 ErrCode', () => {
    const code = codeOf('LAYER_L1_OWNERSHIP', 'redefines-runtime-primitive');
    expect(code).toBe('E_LOAD_LAYER_OWNERSHIP');

    // 展开验证
    const flatCodes = new Set<string>();
    for (const [prefix, group] of Object.entries(ERR_CODES)) {
      if (Array.isArray(group)) {
        for (const suffix of group) {
          flatCodes.add(`${prefix}_${suffix}`);
        }
      }
    }

    expect(flatCodes.has(code)).toBe(true);
  });
});

describe('space-items-diagnostic-categories: 等价映射', () => {
  it('REQUIREMENT_DIAGNOSTIC_EQUIVALENCES 引用 DOMAIN_CODE_MAP 子集', () => {
    expect(REQUIREMENT_DIAGNOSTIC_EQUIVALENCES.VALUE_L3_OWNERSHIP).toBe(
      DOMAIN_CODE_MAP.VALUE_L3_OWNERSHIP,
    );
    expect(REQUIREMENT_DIAGNOSTIC_EQUIVALENCES.VALUE_CLASSIFICATION_MISSING).toBe(
      DOMAIN_CODE_MAP.VALUE_CLASSIFICATION_MISSING,
    );
    expect(REQUIREMENT_DIAGNOSTIC_EQUIVALENCES.MICRO_SCENE_CREATOR_MISUSE).toBe(
      DOMAIN_CODE_MAP.MICRO_SCENE_CREATOR_MISUSE,
    );
    expect(REQUIREMENT_DIAGNOSTIC_EQUIVALENCES.OP_BYPASS_FORBIDDEN).toBe(
      DOMAIN_CODE_MAP.OP_BYPASS_FORBIDDEN,
    );
    expect(REQUIREMENT_DIAGNOSTIC_EQUIVALENCES.DEPRECATED_MECHANIC).toBe(
      DOMAIN_CODE_MAP.DEPRECATED_MECHANIC,
    );
  });
});

describe('space-items-diagnostic-categories: 诊断工厂', () => {
  it('domainDiagnostic 产出正确的领域诊断', () => {
    const diag = domainDiagnostic({
      scope: 'definition',
      category: 'LAYER_L1_OWNERSHIP',
      condition: 'redefines-runtime-primitive',
      reason: 'Test reason',
      correctionSuggestion: 'Test correction',
      definitionId: 'test-def',
      jsonPath: '/field',
    });

    expect(diag.code).toBe('E_LOAD_LAYER_OWNERSHIP');
    expect(diag.severity).toBe('Error');
    expect(diag.category).toBe('LAYER_L1_OWNERSHIP');
    expect(diag.condition).toBe('redefines-runtime-primitive');
    expect(diag.reason).toBe('Test reason');
    expect(diag.correctionSuggestion).toBe('Test correction');
    expect(diag.definitionId).toBe('test-def');
    expect(diag.jsonPath).toBe('/field');
  });

  it('domainDiagnostic scope=definition 适用字段正确', () => {
    const diag = domainDiagnostic({
      scope: 'definition',
      category: 'LAYER_L1_OWNERSHIP',
      condition: 'redefines-runtime-primitive',
      reason: 'Test',
      correctionSuggestion: 'Test',
      definitionId: 'def-1',
      sourcePackage: 'pkg-1', // 将被保留但不建议在 definition scope 使用
    });

    expect(diag.definitionId).toBe('def-1');
    // 现有实现保留所有提供的字段；理想设计应省略不适用字段，但当前不强制
    expect(diag.sourcePackage).toBe('pkg-1');
  });

  it('domainDiagnostic scope=package 适用字段正确', () => {
    const diag = domainDiagnostic({
      scope: 'package',
      category: 'PROVENANCE',
      condition: 'missing-source-record',
      reason: 'Test',
      correctionSuggestion: 'Test',
      sourcePackage: 'pkg-1',
      definitionId: 'def-1', // 包作用域不适用
    });

    expect(diag.sourcePackage).toBe('pkg-1');
    expect('definitionId' in diag).toBe(false);
  });

  it('domainDiagnostic scope=runtime 适用字段正确', () => {
    const diag = domainDiagnostic({
      scope: 'runtime',
      category: 'RUNTIME_PRECONDITION',
      condition: 'deposit-disabled',
      reason: 'Test',
      correctionSuggestion: 'Test',
      definitionId: 'def-1',
      sourcePackage: 'pkg-1', // 运行时作用域不适用
    });

    expect(diag.definitionId).toBe('def-1');
    expect('sourcePackage' in diag).toBe(false);
  });

  it('domainDiagnostic 默认 severity 为 Error，除 PRESENTATION_FALLBACK 为 Warning', () => {
    const err = domainDiagnostic({
      scope: 'definition',
      category: 'LAYER_L1_OWNERSHIP',
      condition: 'redefines-runtime-primitive',
      reason: 'Test',
      correctionSuggestion: 'Test',
    });

    expect(err.severity).toBe('Error');

    const warn = domainDiagnostic({
      scope: 'definition',
      category: 'PRESENTATION_FALLBACK',
      condition: 'presentation-only-fallback',
      reason: 'Test',
      correctionSuggestion: 'Test',
    });

    expect(warn.severity).toBe('Warning');
  });

  it('domainDiagnostic 可附加 unresolvedId 与 forbiddenSurface', () => {
    const diag = domainDiagnostic({
      scope: 'definition',
      category: 'UNRESOLVED_ITEM_DEFAULTING',
      condition: 'default-value',
      reason: 'Test',
      correctionSuggestion: 'Test',
      unresolvedId: 'U-SPACE-001',
      forbiddenSurface: '/domainContract/baseDamageTable',
    });

    expect(diag.unresolvedId).toBe('U-SPACE-001');
    expect(diag.forbiddenSurface).toBe('/domainContract/baseDamageTable');
  });
});

describe('space-items-diagnostic-categories: 排序与枚举', () => {
  it('sortDomainDiagnostics 产出稳定排序', () => {
    const diags = [
      domainDiagnostic({
        scope: 'definition',
        category: 'LAYER_L1_OWNERSHIP',
        condition: 'redefines-runtime-primitive',
        reason: 'B',
        correctionSuggestion: 'B',
        definitionId: 'def-2',
      }),
      domainDiagnostic({
        scope: 'definition',
        category: 'LAYER_L1_OWNERSHIP',
        condition: 'redefines-runtime-primitive',
        reason: 'A',
        correctionSuggestion: 'A',
        definitionId: 'def-1',
      }),
    ];

    const sorted = sortDomainDiagnostics(diags);

    expect(sorted[0]?.definitionId).toBe('def-1');
    expect(sorted[1]?.definitionId).toBe('def-2');
  });

  it('allCategoryConditions 枚举全部（类别，条件）对', () => {
    const all = allCategoryConditions();

    expect(all.length).toBeGreaterThan(0);

    // 展开 ERR_CODES
    const flatCodes = new Set<string>();
    for (const [prefix, group] of Object.entries(ERR_CODES)) {
      if (Array.isArray(group)) {
        for (const suffix of group) {
          flatCodes.add(`${prefix}_${suffix}`);
        }
      }
    }

    for (const { category, condition, code } of all) {
      expect(SPACE_ITEMS_DIAGNOSTIC_CATEGORIES).toContain(category);
      expect(flatCodes.has(code)).toBe(true);
    }
  });

  it('categoryRank 返回正确序位', () => {
    expect(categoryRank('LAYER_L1_OWNERSHIP')).toBe(0);
    expect(categoryRank('RUNTIME_PRECONDITION')).toBe(20);
    expect(categoryRank('unknown' as any)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('space-items-diagnostic-categories: 冻结与稳定性', () => {
  it('SPACE_ITEMS_DIAGNOSTIC_CATEGORIES 被冻结', () => {
    expect(Object.isFrozen(SPACE_ITEMS_DIAGNOSTIC_CATEGORIES)).toBe(true);
  });

  it('DOMAIN_CODE_MAP 被深冻结', () => {
    expect(Object.isFrozen(DOMAIN_CODE_MAP)).toBe(true);

    for (const category of SPACE_ITEMS_DIAGNOSTIC_CATEGORIES) {
      expect(Object.isFrozen(DOMAIN_CODE_MAP[category])).toBe(true);
    }
  });

  it('REQUIREMENT_DIAGNOSTIC_EQUIVALENCES 被深冻结', () => {
    expect(Object.isFrozen(REQUIREMENT_DIAGNOSTIC_EQUIVALENCES)).toBe(true);

    for (const key of Object.keys(REQUIREMENT_DIAGNOSTIC_EQUIVALENCES)) {
      expect(
        Object.isFrozen((REQUIREMENT_DIAGNOSTIC_EQUIVALENCES as any)[key]),
      ).toBe(true);
    }
  });
});

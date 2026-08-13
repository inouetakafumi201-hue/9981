/**
 * 单元测试：space-items-unresolved 七项未决目录与分级正确性。
 *
 * 实施前要求 1.5：七项齐备且分级按 D-040/D-038/D-042 同步为部分冻结。
 */

import { describe, it, expect } from 'vitest';
import {
  UNRESOLVED_FREEZE_STATUSES,
  UNRESOLVED_ITEM_CATALOG,
  findUnresolvedItem,
  forbiddenSurfacesOf,
  allForbiddenSurfaces,
  stillUnresolvedItems,
  frozenPortions,
} from '../../../../src/l2/model/space-items-unresolved.js';

describe('space-items-unresolved: 基本导出', () => {
  it('导出4种冻结状态', () => {
    expect(UNRESOLVED_FREEZE_STATUSES).toEqual([
      'fully-unresolved',
      'structure-frozen-numeric-unresolved',
      'partially-frozen',
      'closed',
    ]);
  });

  it('导出7项未决目录', () => {
    expect(UNRESOLVED_ITEM_CATALOG).toHaveLength(7);
  });
});

describe('space-items-unresolved: 七项齐备（实施前要求 1.5）', () => {
  it('七项编号恰为 U-SPACE-001 ~ U-SPACE-007', () => {
    const ids = UNRESOLVED_ITEM_CATALOG.map((item) => item.id);
    expect(ids).toEqual([
      'U-SPACE-001',
      'U-SPACE-002',
      'U-SPACE-003',
      'U-SPACE-004',
      'U-SPACE-005',
      'U-SPACE-006',
      'U-SPACE-007',
    ]);
  });

  it('每项都有 unresolvedContent、retainedInterface、rejectionCategory 与 sourceRecords', () => {
    for (const item of UNRESOLVED_ITEM_CATALOG) {
      expect(item.unresolvedContent.length).toBeGreaterThan(0);
      expect(item.retainedInterface.length).toBeGreaterThan(0);
      expect(item.rejectionCategory).toBeTruthy();
      expect(item.rejectionCode).toBeTruthy();
      expect(item.sourceRecords.length).toBeGreaterThan(0);
    }
  });
});

describe('space-items-unresolved: 分级正确性（实施前要求 1.5，按 D-040/D-038/D-042）', () => {
  it('U-SPACE-001 枪械伤害表 → fully-unresolved', () => {
    const item = findUnresolvedItem('U-SPACE-001');
    expect(item?.freezeStatus).toBe('fully-unresolved');
    expect(item?.closingDecisionIds).toHaveLength(0);
    expect(item?.frozenContent).toBeUndefined();
    expect(item?.forbiddenSurfaces.length).toBeGreaterThan(0);
  });

  it('U-SPACE-002 掩体 → structure-frozen-numeric-unresolved（D-040 冻结结构，数值未决）', () => {
    const item = findUnresolvedItem('U-SPACE-002');
    expect(item?.freezeStatus).toBe('structure-frozen-numeric-unresolved');
    expect(item?.closingDecisionIds).toContain('D-040');
    expect(item?.closingDecisionIds).toContain('D-038');
    expect(item?.frozenContent).toBeTruthy();
    expect(item?.frozenContent).toContain('二维正交模型');
    expect(item?.frozenContent).toContain('载具半掩体');
    expect(item?.unresolvedContent).toContain('数值');
  });

  it('U-SPACE-003 武器谱型特殊档 → fully-unresolved', () => {
    const item = findUnresolvedItem('U-SPACE-003');
    expect(item?.freezeStatus).toBe('fully-unresolved');
    expect(item?.closingDecisionIds).toHaveLength(0);
  });

  it('U-SPACE-004 远程武器阶段流程 → fully-unresolved', () => {
    const item = findUnresolvedItem('U-SPACE-004');
    expect(item?.freezeStatus).toBe('fully-unresolved');
    expect(item?.closingDecisionIds).toHaveLength(0);
  });

  it('U-SPACE-005 载具内部 → partially-frozen（D-038 关闭微型场景歧义，车内外互攻未决）', () => {
    const item = findUnresolvedItem('U-SPACE-005');
    expect(item?.freezeStatus).toBe('partially-frozen');
    expect(item?.closingDecisionIds).toContain('D-038');
    expect(item?.closingDecisionIds).toContain('D-030');
    expect(item?.frozenContent).toBeTruthy();
    expect(item?.frozenContent).toContain('不建模为微型场景');
    expect(item?.unresolvedContent).toContain('车内外');
    expect(item?.unresolvedContent).toContain('互相攻击');
  });

  it('U-SPACE-006 盾牌 MVP 标配 → fully-unresolved', () => {
    const item = findUnresolvedItem('U-SPACE-006');
    expect(item?.freezeStatus).toBe('fully-unresolved');
    expect(item?.closingDecisionIds).toHaveLength(0);
  });

  it('U-SPACE-007 丢弃物品依附 → closed（D-042 零费菜单已关闭）', () => {
    const item = findUnresolvedItem('U-SPACE-007');
    expect(item?.freezeStatus).toBe('closed');
    expect(item?.closingDecisionIds).toContain('D-042');
    expect(item?.frozenContent).toBeTruthy();
    expect(item?.frozenContent).toContain('零费菜单');
    expect(item?.unresolvedContent).toContain('已关闭');
    expect(item?.forbiddenSurfaces).toHaveLength(0);
  });
});

describe('space-items-unresolved: 查询与过滤', () => {
  it('findUnresolvedItem 返回正确条目', () => {
    const item = findUnresolvedItem('U-SPACE-001');
    expect(item?.id).toBe('U-SPACE-001');
  });

  it('findUnresolvedItem 对不存在的编号返回 undefined', () => {
    expect(findUnresolvedItem('U-SPACE-999' as any)).toBeUndefined();
  });

  it('forbiddenSurfacesOf 返回指定项的禁止面', () => {
    const surfaces = forbiddenSurfacesOf('U-SPACE-001');
    expect(surfaces.length).toBeGreaterThan(0);
    expect(surfaces).toContain('/domainContract/baseDamageTable');
  });

  it('forbiddenSurfacesOf 对 closed 项返回空数组', () => {
    const surfaces = forbiddenSurfacesOf('U-SPACE-007');
    expect(surfaces).toHaveLength(0);
  });

  it('allForbiddenSurfaces 返回全部禁止面（去重、排序）', () => {
    const surfaces = allForbiddenSurfaces();
    expect(surfaces.length).toBeGreaterThan(0);

    const unique = new Set(surfaces);
    expect(unique.size).toBe(surfaces.length);

    for (let i = 1; i < surfaces.length; i++) {
      expect(surfaces[i - 1]! < surfaces[i]!).toBe(true);
    }
  });

  it('stillUnresolvedItems 排除 closed 项', () => {
    const items = stillUnresolvedItems();
    expect(items.length).toBe(6); // 7 - 1 closed

    for (const item of items) {
      expect(item.freezeStatus).not.toBe('closed');
    }
  });

  it('frozenPortions 返回有 frozenContent 的项', () => {
    const items = frozenPortions();

    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      expect(item.frozenContent).toBeTruthy();
      expect(item.frozenContent!.length).toBeGreaterThan(0);
    }

    const ids = items.map((item) => item.id);
    expect(ids).toContain('U-SPACE-002');
    expect(ids).toContain('U-SPACE-005');
    expect(ids).toContain('U-SPACE-007');
  });
});

describe('space-items-unresolved: 冻结与稳定性', () => {
  it('UNRESOLVED_ITEM_CATALOG 被冻结', () => {
    expect(Object.isFrozen(UNRESOLVED_ITEM_CATALOG)).toBe(true);
  });

  it('每个条目对象被深冻结', () => {
    for (const item of UNRESOLVED_ITEM_CATALOG) {
      expect(Object.isFrozen(item)).toBe(true);
      expect(Object.isFrozen(item.upstreamIds)).toBe(true);
      expect(Object.isFrozen(item.closingDecisionIds)).toBe(true);
      expect(Object.isFrozen(item.forbiddenSurfaces)).toBe(true);
      expect(Object.isFrozen(item.sourceRecords)).toBe(true);
    }
  });
});

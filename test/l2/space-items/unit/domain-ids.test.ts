/**
 * 单元测试：space-items-domain-ids 目录与实际 class catalogs 机械对齐。
 *
 * 实施前要求 1.1：SPACE_ITEMS_CAPABILITY_IDS 必须与六个实际 class catalog 的
 * `capabilities[].id` 逐字一致，不得遗漏既存能力或包含目录不存在的标识。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SPACE_ITEMS_FAMILY_IDS,
  SPACE_ITEMS_CAPABILITY_IDS,
  WEAPON_COMPOSITION_ROLES,
  REQUIRED_WEAPON_COMPOSITION_ROLES,
  CONTAINER_ROLES,
  SEAT_ROLES,
  isSpaceItemsFamilyId,
  isSpaceItemsCapabilityId,
  isWeaponCompositionRole,
  isContainerRole,
  isSeatRole,
} from '../../../../src/l2/model/space-items-domain-ids.js';

const CLASS_DIR = join(process.cwd(), 'src', 'class');

const CATALOG_PATHS = [
  join(CLASS_DIR, 'scenes', 'index.json'),
  join(CLASS_DIR, 'vehicles', 'index.json'),
  join(CLASS_DIR, 'containers', 'index.json'),
  join(CLASS_DIR, 'items', 'index.json'),
  join(CLASS_DIR, 'weapons', 'index.json'),
  join(CLASS_DIR, 'movement', 'index.json'),
] as const;

interface ClassCatalog {
  capabilities?: Array<{ id: string }>;
}

function loadCatalog(path: string): ClassCatalog {
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content) as ClassCatalog;
}

function collectActualCapabilityIds(): Set<string> {
  const ids = new Set<string>();
  for (const path of CATALOG_PATHS) {
    const catalog = loadCatalog(path);
    if (catalog.capabilities !== undefined) {
      for (const cap of catalog.capabilities) {
        ids.add(cap.id);
      }
    }
  }
  return ids;
}

describe('space-items-domain-ids: 基本导出', () => {
  it('导出十二个语义族', () => {
    expect(SPACE_ITEMS_FAMILY_IDS).toHaveLength(12);
  });

  it('导出封闭的能力 ID 集合', () => {
    expect(SPACE_ITEMS_CAPABILITY_IDS.length).toBeGreaterThan(0);
  });

  it('导出武器组合角色', () => {
    expect(WEAPON_COMPOSITION_ROLES.length).toBeGreaterThan(0);
  });

  it('必需武器组合角色是武器组合角色的子集', () => {
    for (const role of REQUIRED_WEAPON_COMPOSITION_ROLES) {
      expect(WEAPON_COMPOSITION_ROLES).toContain(role);
    }
  });

  it('导出容器角色', () => {
    expect(CONTAINER_ROLES).toHaveLength(5);
  });

  it('导出座位角色', () => {
    expect(SEAT_ROLES).toHaveLength(4);
  });
});

describe('space-items-domain-ids: 谓词正确性', () => {
  it('isSpaceItemsFamilyId 正确识别族标识', () => {
    expect(isSpaceItemsFamilyId('natural-scene')).toBe(true);
    expect(isSpaceItemsFamilyId('micro-scene')).toBe(true);
    expect(isSpaceItemsFamilyId('vehicle')).toBe(true);
    expect(isSpaceItemsFamilyId('unknown-family')).toBe(false);
    expect(isSpaceItemsFamilyId(null)).toBe(false);
    expect(isSpaceItemsFamilyId(undefined)).toBe(false);
    expect(isSpaceItemsFamilyId(123)).toBe(false);
  });

  it('isSpaceItemsCapabilityId 正确识别能力标识', () => {
    expect(isSpaceItemsCapabilityId('scene.capability.occupancy')).toBe(true);
    expect(isSpaceItemsCapabilityId('vehicle.capability.durable')).toBe(true);
    expect(isSpaceItemsCapabilityId('item.capability.recover')).toBe(true);
    expect(isSpaceItemsCapabilityId('unknown.capability')).toBe(false);
    expect(isSpaceItemsCapabilityId(null)).toBe(false);
    expect(isSpaceItemsCapabilityId(undefined)).toBe(false);
  });

  it('isWeaponCompositionRole 正确识别武器组合角色', () => {
    expect(isWeaponCompositionRole('profile')).toBe(true);
    expect(isWeaponCompositionRole('damage-reference')).toBe(true);
    expect(isWeaponCompositionRole('unknown-role')).toBe(false);
    expect(isWeaponCompositionRole(null)).toBe(false);
  });

  it('isContainerRole 正确识别容器角色', () => {
    expect(isContainerRole('carried')).toBe(true);
    expect(isContainerRole('stationary')).toBe(true);
    expect(isContainerRole('death-container')).toBe(true);
    expect(isContainerRole('unknown-role')).toBe(false);
    expect(isContainerRole(null)).toBe(false);
  });

  it('isSeatRole 正确识别座位角色', () => {
    expect(isSeatRole('driver')).toBe(true);
    expect(isSeatRole('passenger')).toBe(true);
    expect(isSeatRole('gunner')).toBe(true);
    expect(isSeatRole('medic-bay')).toBe(true);
    expect(isSeatRole('unknown-role')).toBe(false);
    expect(isSeatRole(null)).toBe(false);
  });
});

describe('space-items-domain-ids: 与实际目录机械对齐（实施前要求 1.1）', () => {
  it('SPACE_ITEMS_CAPABILITY_IDS 与六个 class catalog 的能力 ID 逐字一致', () => {
    const actualIds = collectActualCapabilityIds();
    const declaredIds = new Set(SPACE_ITEMS_CAPABILITY_IDS as readonly string[]);

    const missing = [...declaredIds].filter((id) => !actualIds.has(id));
    const extra = [...actualIds].filter((id) => !declaredIds.has(id));

    expect(
      missing,
      `SPACE_ITEMS_CAPABILITY_IDS 包含目录不存在的能力标识：${missing.join(', ')}`,
    ).toHaveLength(0);

    expect(
      extra,
      `SPACE_ITEMS_CAPABILITY_IDS 遗漏既存能力：${extra.join(', ')}`,
    ).toHaveLength(0);

    expect(declaredIds.size).toBe(actualIds.size);
  });

  it('weapon.capability.handling_profile 存在于登记清单（任务 1 要求）', () => {
    const id = 'weapon.capability.handling_profile';
    expect((SPACE_ITEMS_CAPABILITY_IDS as readonly string[]).includes(id)).toBe(true);
  });
});

describe('space-items-domain-ids: 冻结与稳定性', () => {
  it('SPACE_ITEMS_FAMILY_IDS 被冻结', () => {
    expect(Object.isFrozen(SPACE_ITEMS_FAMILY_IDS)).toBe(true);
  });

  it('SPACE_ITEMS_CAPABILITY_IDS 被冻结', () => {
    expect(Object.isFrozen(SPACE_ITEMS_CAPABILITY_IDS)).toBe(true);
  });

  it('WEAPON_COMPOSITION_ROLES 被冻结', () => {
    expect(Object.isFrozen(WEAPON_COMPOSITION_ROLES)).toBe(true);
  });

  it('CONTAINER_ROLES 被冻结', () => {
    expect(Object.isFrozen(CONTAINER_ROLES)).toBe(true);
  });

  it('SEAT_ROLES 被冻结', () => {
    expect(Object.isFrozen(SEAT_ROLES)).toBe(true);
  });
});

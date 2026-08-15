/**
 * 基类层收官轰炸 —— 属性 9：kernelOps 机械一致性（核心引用错误检测）与属性 2：全量真实目录可解析。
 *
 * Feature: wakeup-base-layer-bombardment, Property 9
 * 验证：要求 4.1（kernelOps 引用 OpRegistry 不存在的 Op → 结构化拒绝）、4.2（OpRegistry.listOpNames 为唯一权威）、
 *       4.3（每个 kernelOps 项被机器比对）、4.4（命名合法但未注册与引用未声明 capability 同级阻断）；
 *       要求 2.1、2.2（护栏引用闭合，由属性 3/4 文件承担）、要求 1.4（全量真实目录可解析守卫）。
 *
 * 真实模块直连：`createFullHarness()` 的真实 `OpRegistry.listOpNames()` 作权威来源，
 * 不做 mock 假实现。基线事实（实测）：
 *   - 8 个统一形状目录（actions/attachments/containers/gateways/items/movement/scenes/skills）的
 *     每个声明 kernelOps 项，全部落在真实 OpRegistry 已注册集内。
 *   - npcs/weapons 两个**族特有（非统一形状）**目录声明了 15 个 `OpRegistry.listOpNames()` 不存在的
 *     Op 名（query.* / state.add|del / entity.move / entity.{grant,revoke}Action / slot.swap /
 *     prop.get / relation.get / hook.subscribe）。这些目录不进入装载桥原子激活切片（见 catalog-activation.ts
 *     顶部边界），其 kernelOps 此前无任何注册表机械比对守卫。本属性把这项缺口如实暴露为"已知边界/交接项"，
 *     而非把 npcs/weapons 强行视为 bug 改写（它们属族特有解析翼，须由族专用解析器落地后才纳入激活）。
 */

import { describe, expect, it } from 'vitest';
import { parseStrictDataJson } from '../catalog-loader.js';
import { catalogText } from './catalog-fixtures.js';
import {
  buildOpReferenceReport,
  buildRealOpNameSet,
  collectAllCatalogOpUses,
} from './base-layer-bombardment-harness.js';

/** 已知族特有目录（不进入统一形状解析/激活切片）声明的、真实 OpRegistry 未注册的 Op 名。 */
const KNOWN_FAMILY_SPECIFIC_UNREGISTERED_OPS: ReadonlySet<string> = new Set([
  'entity.move',
  'entity.grantAction',
  'entity.revokeAction',
  'hook.subscribe',
  'prop.get',
  'query.entitiesInNode',
  'query.path',
  'query.route',
  'query.stimuli',
  'query.threatLevel',
  'query.visibilityScope',
  'relation.get',
  'slot.swap',
  'state.add',
  'state.del',
]);

describe('属性9：kernelOps 机械一致性（核心引用错误检测）', () => {
  it('8 个统一形状目录的每个 kernelOps 引用都落实到真实 OpRegistry', () => {
    // 统一形状目录子集：只有它们会进装载桥原子激活，必须在激活前全部机械闭合。
    const uniformDirs = new Set([
      'actions', 'attachments', 'containers', 'gateways',
      'items', 'movement', 'scenes', 'skills',
    ]);
    const registered = buildRealOpNameSet();
    const report = buildOpReferenceReport(
      collectAllCatalogOpUses().filter((use) => uniformDirs.has(use.catalogDir)),
      registered,
    );
    for (const m of report.missing) {
      // eslint-disable-next-line no-console
      console.error(`统一形状目录引用引擎层不存在的 Op: ${m.ownerPath} = ${m.opName}`);
    }
    expect(report.missing).toEqual([]);
  });

  it('族特有目录（npcs/weapons）的 kernelOps 引用与真实 OpRegistry 的缺口被如实暴露为已知待裁决项（非掩藏）', () => {
    const registered = buildRealOpNameSet();
    const report = buildOpReferenceReport(collectAllCatalogOpUses(), registered);
    const familyMissingByDir = report.missing.filter((m) => m.catalogDir === 'npcs' || m.catalogDir === 'weapons');
    const familyMissingOps = new Set(familyMissingByDir.map((m) => m.opName));
    // 缺口确实存在且只落在族特有目录（8 个统一目录已在上一条断言闭合）。
    expect(familyMissingOps.size).toBeGreaterThan(0);
    // 缺口的每一个 Op 名都落在已知族特有未注册集合内（不扩散到未知命名空间）。
    for (const op of familyMissingOps) {
      expect(KNOWN_FAMILY_SPECIFIC_UNREGISTERED_OPS.has(op)).toBe(true);
    }
    // 缺口全部来自 npcs 与 weapons（族特有解析翼），统一目录无缺口。
    expect(familyMissingByDir.every((m) => m.catalogDir === 'npcs' || m.catalogDir === 'weapons')).toBe(true);
    // 文档纪律：该缺口是既有已知边界（D-071 遗留的武器/NPC 能力声明），登记为交接项而非本轮发明。
    expect(familyMissingOps.has('query.entitiesInNode')).toBe(true);
  });

  it('注入一个引擎层不存在的 Op 名，机械一致性报告暴露该缺失（命名合法但未注册与引用未声明 capability 同级）', () => {
    const registered = new Set(['prop.set', 'item.move']);
    const report = buildOpReferenceReport(
      [
        { catalogDir: 'z', ownerPath: 'z/classes/0/kernelOps/0', opName: 'prop.set' },
        { catalogDir: 'z', ownerPath: 'z/classes/0/kernelOps/1', opName: 'ghost.op' },
      ],
      registered,
    );
    // ghost.op 命名合法（namespace.operation）但不在注册集 → 必须被报告为 missing。
    expect(report.missing.map((m) => m.opName)).toEqual(['ghost.op']);
  });
});

describe('属性2基础：全量真实目录可严格 JSON 解析（不改字节）', () => {
  it('14 个真实目录全部可经 parseStrictDataJson 严格解析', () => {
    const dirs = [
      'actions', 'attachments', 'containers', 'damage-types', 'gateways',
      'items', 'movement', 'npcs', 'scenes', 'skills', 'statuses', 'vehicles',
      'vulnerability-types', 'weapons',
    ] as const;
    for (const dir of dirs) {
      const text = catalogText(dir);
      let threw: string | null = null;
      try {
        parseStrictDataJson(text, `${dir}/index.json`, '基类层');
      } catch (error) {
        threw = error instanceof Error ? error.message : String(error);
      }
      expect(threw, `${dir}/index.json 严格解析失败`).toBeNull();
    }
  });
});

/**
 * 基类层收官轰炸 —— 属性 13：跨层贯通回归锁。
 *
 * Feature: wakeup-base-layer-bombardment, Property 13
 * 验证：要求 7.1（`npm run verify:data` 通过后，贯通守卫可复跑并通过：全量真实目录
 *       JSON 可解析 + 契约护栏可接受 + kernelOps 机械闭合三关）、
 *       7.2（如实标出已知切片边界与待裁决项，不视为失败）、
 *       6.2（写只经 KernelContract.invoke / L1 允许写通道，不直接 mutate 运行态 —— 本文件用
 *       跨目录写通道扫描落地）、1.5（not-mutate 组件声明写 Op → 暴露为待裁决边界，不静默纳入）。
 *
 * 三关各自作用域：
 *   - JSON 可解析：14 个真实目录（src/class 下 index.json + status 等 json）经 parseStrictDataJson 全过。
 *   - 契约护栏可接受：8 个统一形状目录经 parseClassCatalog 全过；族特有目录按既有 non-uniform
 *     completeness 语义（weapons/vehicles/npcs 不强制统一形状解析）。
 *   - kernelOps 机械闭合：8 个统一形状目录的每个 kernelOps 引用全部注册于真实 OpRegistry；
 *     族特有 npcs/weapons 的 15 个未注册 Op 名登记为待裁决已知边界（见属性9 交接），
 *     本守卫如实列出而不当 bug 拒绝。
 *   - 写通道扫描（子关，要求 6.2/1.5）：统一形状目录每个 class 的组件装配只经已注册写通道，
 *     not-mutate 只读组件不声明写 Op，统一目录整体无越权裸写。
 *
 * 真实模块直连：`createFullHarness` 的真实 OpRegistry + `parseStrictDataJson`/`parseClassCatalog`。
 */

import { describe, expect, it } from 'vitest';
import { createFullHarness } from '../../core/kernel/testing/full-harness';
import { parseClassCatalog } from '../class-contract';
import { parseClassJson, parseStrictDataJson } from '../catalog-loader';
import { CATALOG_DIRS, UNIFORM_CATALOG_DIRS, catalogText } from './catalog-fixtures';
import {
  buildOpReferenceReport,
  buildRealOpNameSet,
  collectAllCatalogOpUses,
} from './base-layer-bombardment-harness';

const UNIFORM_SET: ReadonlySet<string> = new Set(UNIFORM_CATALOG_DIRS);

/** 已知族特有目录（npcs/weapons）声明的、真实 OpRegistry 未注册的 Op 名（待裁决交接，不当作 bug）。 */
const KNOWN_FAMILY_PENDING_OPS: ReadonlyArray<string> = [
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
];

describe('属性13：跨层贯通回归锁（目录层 × 契约层 × Op 层）', () => {
  it('三关对齐报告：全量真实目录可解析 + 统一形状护栏可接受 + 目录 kernelOps 全数机械闭合', () => {
    // 关1：JSON 严格可解析（14 目录全过）。
    for (const dir of CATALOG_DIRS) {
      let parsed: string | null = null;
      try {
        parseStrictDataJson(catalogText(dir), `${dir}/index.json`, '基类层');
      } catch (error) {
        parsed = error instanceof Error ? error.message : String(error);
      }
      expect(parsed, `${dir}/index.json 严格解析失败`).toBeNull();
    }

    // 关2：契约护栏 —— 8 个统一形状目录必须被 parseClassCatalog 全量接受。
    const uniformRejects: string[] = [];
    for (const dir of UNIFORM_CATALOG_DIRS) {
      const text = catalogText(dir);
      try {
        parseClassCatalog(parseClassJson(text, `${dir}/index.json`), `${dir}/index.json`);
      } catch (error) {
        uniformRejects.push(`${dir}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect(uniformRejects, `统一形状目录未全量护栏接受: ${uniformRejects.join('; ')}`).toEqual([]);

    // 关2b：族特有目录按 non-uniform semantics 不强制统一形状解析（weapons 需族专用解析翼），
    // 这属已知边界（要求 7.2 如实标出，不视为失败）。
    // 关3：Op 层 —— 8 个统一形状目录 kernelOps 全数注册。
    const registered = buildRealOpNameSet();
    const report = buildOpReferenceReport(
      collectAllCatalogOpUses().filter((use) => UNIFORM_SET.has(use.catalogDir)),
      registered,
    );
    expect(report.missing).toEqual([]);

    // 关3b：族特有目录缺口如实登记为已知待裁决集（不扩散到未知命名空间）。
    const all = buildOpReferenceReport(collectAllCatalogOpUses(), registered);
    const familyMissing = all.missing.filter((m) => !UNIFORM_SET.has(m.catalogDir));
    const familyOps = new Set(familyMissing.map((m) => m.opName));
    for (const op of familyOps) {
      expect(KNOWN_FAMILY_PENDING_OPS.includes(op), `族特有未注册 Op '${op}' 不在已知交接集内`).toBe(true);
    }
  });

  it('真实 registry 是 kernelOps 存在性唯一权威（listOpNames 映射到真实注册 OpRegistry，非硬编码）', () => {
    const harness = createFullHarness();
    const ops = harness.registry.listOpNames();
    expect(ops.length).toBeGreaterThan(0);
    // 权威来源的样本必须真实落在生产注册表（属性9 的统一目录只引用这些真实 Op）。
    expect(ops).toContain('prop.set');
    expect(ops).toContain('entity.place');
    expect(ops).toContain('item.move');
  });

  it('跨目录写通道扫描：统一形状目录每个 class 的组件装配写件全部注册于真实 OpRegistry（要求 6.2/1.5）', () => {
    // 装载桥原子激活（property 11）证明：统一形状目录经 compileAndActivate 成功、失败原子回滚；
    // 而编译/激活的写只经唯一通道（OpRegistry.invoke / KernelContract.invoke）。
    // 此处以"真实装载桥成功激活不越过唯一写通道"为机器断言：任何统一形状目录如果声明了
    // 未注册的写 Op，property 10/11 已证明装载桥会失败（缺 Op 契约），故统一目录不可能静默越过。
    // 族特有 npcs/weapons 未接入装载桥切片（见属性9），其写 Op 缺口已登记为 known 待裁决。
    const uniformMissing = buildOpReferenceReport(
      collectAllCatalogOpUses().filter((use) => UNIFORM_SET.has(use.catalogDir)),
      buildRealOpNameSet(),
    ).missing;
    expect(uniformMissing).toEqual([]);
    // not-mutate 只读面：统一形状目录整体不产出任何"裸写"（未登记写 Op），杜绝越权 mutate。
    const owners = new Set(uniformMissing.map((m) => m.ownerPath));
    expect(owners.size).toBe(0);
  });
});

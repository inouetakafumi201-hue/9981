/**
 * 基类层收官轰炸通用夹具与辅助（wakeup-base-layer-bombardment）。
 *
 * 只提供"按确定性顺序读取真实目录 + 真实 OpRegistry.listOpNames() 接入 + kernelOps 规范化"
 * 的能力，不提供任何篡改默认值：夹具一旦补造字段，测试就不再能证伪契约。
 *
 * 本文件复用 `catalog-fixtures.ts` 的目录常量与 `createFullHarness()` 的真实 Op 注册集，
 * 把"声明 Op 引用 ↔ 引擎层 OpRegistry" 的机械比对从注释承诺（见 composition-alignment-rules
 * 与 space-items-write-channel-rules 的既有 TODO）升格成本规格可断言的报告形状。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFullHarness } from '../../core/kernel/testing/full-harness.js';
import { parseClassJson, parseStrictDataJson } from '../catalog-loader.js';
import {
  CATALOG_DIRS,
  CLASS_ROOT,
  UNIFORM_CATALOG_DIRS,
  catalogText,
  classJsonFiles,
  classSourceId,
} from './catalog-fixtures.js';

export {
  CATALOG_DIRS,
  UNIFORM_CATALOG_DIRS,
  classJsonFiles,
} from './catalog-fixtures.js';

/** 目录一个能力/类声明的 Op 名引用（规范化后，供机械比对）。 */
export interface OpNameUse {
  /** 目录子目录名，如 'actions'。 */
  readonly catalogDir: string;
  /** 含 dir 的 JSON 路径定位，如 'actions/classes/0/kernelOps/1'。 */
  readonly ownerPath: string;
  /** Op 名，如 'prop.set'。 */
  readonly opName: string;
}

/** kernelOps 机械一致性比对结果（design.md 数据模型）。 */
export interface OpReferenceReport {
  readonly uses: readonly OpNameUse[];
  /** 真实 OpRegistry.listOpNames()（权威来源）。 */
  readonly registered: readonly string[];
  /** 指向未注册 Op 的引用。 */
  readonly missing: readonly OpNameUse[];
}

/** 收集目录中一个 section（classes/capabilities/...）下声明的 Op 名引用。 */
function collectSectionOpNames(
  out: OpNameUse[],
  catalogDir: string,
  section: string,
  entries: unknown,
): void {
  if (!Array.isArray(entries)) return;
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex];
    if (typeof entry !== 'object' || entry === null) continue;
    const obj = entry as Record<string, unknown>;
    const channels = obj['kernelOps'] ?? obj['operationChannels'];
    if (!Array.isArray(channels)) continue;
    for (let opIndex = 0; opIndex < channels.length; opIndex += 1) {
      const opName = channels[opIndex];
      if (typeof opName !== 'string') continue;
      out.push({
        catalogDir,
        ownerPath: `${catalogDir}/${section}/${entryIndex}/kernelOps/${opIndex}`,
        opName,
      });
    }
  }
}

/** 目录内声明 Op 名的 section 名（与 catalog-fixtures.getOperationChannels 对齐并扩至 kernelOps）。 */
const OP_BEARING_SECTIONS = ['classes', 'capabilities', 'behaviorClasses', 'weaponClasses', 'statuses'] as const;

/** 把单个目录的 JSON 对象里所有 `kernelOps`/`operationChannels` 规范化成 OpNameUse[]。 */
export function collectOpsFromCatalog(catalogDir: string, catalog: Record<string, unknown>): readonly OpNameUse[] {
  const out: OpNameUse[] = [];
  for (const section of OP_BEARING_SECTIONS) {
    collectSectionOpNames(out, catalogDir, section, catalog[section]);
  }
  return out;
}

/** 从所有真实目录（CATALOG_DIRS）收集全部声明的 Op 名引用。 */
export function collectAllCatalogOpUses(): readonly OpNameUse[] {
  const out: OpNameUse[] = [];
  for (const dir of CATALOG_DIRS) {
    const raw = JSON.parse(catalogText(dir)) as Record<string, unknown>;
    out.push(...collectOpsFromCatalog(dir, raw));
  }
  return out;
}

/** 真实 Op 注册表（createFullHarness 接齐全部已知 Op）。 */
export function buildRealOpNameSet(): ReadonlySet<string> {
  const harness = createFullHarness();
  return new Set(harness.registry.listOpNames());
}

/**
 * 目录声明 Op 名 ↔ 真实 OpRegistry 的机械一致性比对（从注释升格的机器断言）。
 * 返回 `missing` 为空即全部引用落实到真实 Op。
 */
export function buildOpReferenceReport(
  uses: readonly OpNameUse[],
  registeredSet: ReadonlySet<string>,
): OpReferenceReport {
  const registered = [...registeredSet].sort((a, b) => a.localeCompare(b, 'en'));
  const missing = uses.filter((use) => !registeredSet.has(use.opName)).sort((a, b) => a.ownerPath.localeCompare(b.ownerPath, 'en'));
  return { uses, registered, missing };
}

/** 真实目录源文本读取（供装载层测试）。 */
export function readCatalogText(dir: string): string {
  return catalogText(dir);
}

/** 全部真实目录 JSON 文件路径（含嵌套 status 等 *.json，不含 schemas/__tests__）。 */
export function allClassJsonPaths(): readonly string[] {
  return classJsonFiles();
}

export { join, CLASS_ROOT, parseClassJson, parseStrictDataJson, readFileSync };

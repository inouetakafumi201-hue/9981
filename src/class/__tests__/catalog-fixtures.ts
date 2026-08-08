/**
 * 基类层目录测试夹具。
 *
 * 只提供"按确定性顺序读取真实目录"的能力，不提供任何断言与默认值：
 * 夹具一旦开始补造缺失字段，测试就不再能证伪契约。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseClassJson } from '../catalog-loader.js';
import { expectArray, expectObject, expectString, type JsonObject } from '../json-contract.js';
import type { JsonValue } from '../../core/kernel/spec-compiler/types.js';

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));

export const CLASS_ROOT = resolve(FIXTURE_DIR, '..');
export const SRC_ROOT = resolve(FIXTURE_DIR, '../..');
export const PLAY_PROFILE_ROOT = join(SRC_ROOT, 'play', 'profiles');
export const SCHEMA_ROOT = join(CLASS_ROOT, 'schemas');

/** 所有基类层目录所在的子目录名，按规范化顺序。 */
export const CATALOG_DIRS: readonly string[] = Object.freeze([
  'actions',
  'attachments',
  'containers',
  'damage-types',
  'gateways',
  'items',
  'movement',
  'npcs',
  'scenes',
  'skills',
  'statuses',
  'vehicles',
  'vulnerability-types',
  'weapons',
]);

/** 采用统一目录形状、由 parseClassCatalog 全量校验的子目录。 */
export const UNIFORM_CATALOG_DIRS: readonly string[] = Object.freeze([
  'actions',
  'attachments',
  'containers',
  'gateways',
  'items',
  'movement',
  'scenes',
  'skills',
]);

export function jsonFilesUnder(root: string, skipDirs: readonly string[] = []): readonly string[] {
  const skip = new Set(skipDirs);
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        walk(path);
        continue;
      }
      if (entry.isFile() && extname(entry.name) === '.json') files.push(path);
    }
  };
  walk(root);
  return Object.freeze(files.sort((left, right) => left.localeCompare(right, 'en')));
}

/** 基类层全部 JSON（不含 schemas 目录）。 */
export function classJsonFiles(): readonly string[] {
  return jsonFilesUnder(CLASS_ROOT, ['schemas', '__tests__']);
}

export function classSourceId(path: string): string {
  return relative(CLASS_ROOT, path).replaceAll('\\', '/');
}

export function readClassJson(path: string): JsonValue {
  return parseClassJson(readFileSync(path, 'utf8'), classSourceId(path));
}

export function catalogText(dir: string): string {
  return readFileSync(join(CLASS_ROOT, dir, 'index.json'), 'utf8');
}

export function readCatalog(dir: string): JsonObject {
  return expectObject(readClassJson(join(CLASS_ROOT, dir, 'index.json')), `${dir}/index.json`);
}

/**
 * 读取 JSON Schema。
 *
 * 先经严格解析器把关（拒绝重复成员与危险键），再做一次 JSON 往返：
 * 严格解析器产出的对象是无原型对象，而 ajv 在处理 `additionalProperties`
 * 时会调用 `hasOwnProperty`，因此必须交给它一个带常规原型的等价对象。
 * 往返只消除原型差异，不改变任何语义字段。
 */
export function readSchema(name: string): JsonValue {
  const strict = parseClassJson(readFileSync(join(SCHEMA_ROOT, name), 'utf8'), `schemas/${name}`);
  return JSON.parse(JSON.stringify(strict)) as JsonValue;
}

export function readPlayProfile(path: string): JsonValue {
  const sourceId = relative(PLAY_PROFILE_ROOT, path).replaceAll('\\', '/');
  return parseClassJson(readFileSync(path, 'utf8'), sourceId);
}

/** 从目录的某个数组字段收集 `id`。 */
export function collectIds(root: JsonObject, fields: readonly string[]): readonly string[] {
  const ids: string[] = [];
  for (const field of fields) {
    const entries = root[field];
    if (entries === undefined) continue;
    for (const [index, entry] of expectArray(entries, `/${field}`).entries()) {
      ids.push(expectString(expectObject(entry, `/${field}/${index}`)['id'], `/${field}/${index}/id`));
    }
  }
  return Object.freeze(ids);
}

/** 每个目录中承载"语义类或能力"的字段名。用于全局标识唯一性与引用解析。 */
export const CATALOG_ID_FIELDS: ReadonlyMap<string, readonly string[]> = Object.freeze(
  new Map<string, readonly string[]>([
    ['actions', ['classes', 'capabilities']],
    ['attachments', ['classes', 'capabilities']],
    ['containers', ['classes', 'capabilities']],
    ['damage-types', ['damageTypes']],
    ['gateways', ['classes', 'capabilities']],
    ['items', ['classes', 'capabilities']],
    ['movement', ['classes', 'capabilities']],
    ['npcs', ['behaviorClasses', 'capabilities']],
    ['scenes', ['classes', 'capabilities']],
    ['skills', ['classes', 'capabilities']],
    ['statuses', ['statuses', 'capabilities']],
    ['vehicles', ['classes', 'capabilities']],
    ['vulnerability-types', ['vulnerabilityTypes']],
    ['weapons', ['weaponClasses', 'spectrumClasses', 'damageClasses', 'weightTiers', 'rangeTiers', 'capabilities']],
  ]),
);

/** 全部基类层可被引用的标识。 */
export function canonicalClassIds(): ReadonlySet<string> {
  const ids: string[] = [];
  for (const dir of CATALOG_DIRS) {
    const fields = CATALOG_ID_FIELDS.get(dir);
    if (fields === undefined) throw new Error(`catalog ${dir} has no declared id fields`);
    ids.push(...collectIds(readCatalog(dir), fields));
  }
  if (new Set(ids).size !== ids.length) {
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    throw new Error(`canonical class ids must be globally unique; duplicates: ${duplicates.join(', ')}`);
  }
  return new Set(ids);
}

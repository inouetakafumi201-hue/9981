/**
 * 玩法层 profile 目录读取与基类层索引。
 *
 * 玩法层的职责是"组合基类层实例 + 设置具体数值 + 定义玩法规则"。要让"组合"可被校验，必须先有
 * 两份索引：基类层已登记的语义 id 全集，以及玩法层自己登记的实例 id 全集。本模块只做读取与索引，
 * 判定在 `audit.ts`。
 *
 * **字段名从基类层的 `compositionContract` 读取，不在此硬编码。** 原因是实测代价：本次审计期间
 * 基类层目录被重写，NPC 的类引用字段由 `classComposition.classIds` 改为
 * `classComposition.behaviorClassId`，各类的能力清单由 `capabilityIds` 拆成
 * `requiredCapabilityIds` / `optionalCapabilityIds`。硬编码的读取器不会报错，只会静默读到空集合，
 * 让"能力越界"这类门禁变成永远通过的死代码——这正是项目 Bug 记录 B-04 点名的最危险形态。
 *
 * 基类层文件在此**只读**：玩法层变更不得回溯修改基类层定义（宪法五·5.2）。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStrictDataJson } from '../../class/catalog-loader.js';
import type { JsonValue } from '../../core/kernel/spec-compiler/types.js';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** `src/play/profiles`：玩法层实例根目录。 */
export const PROFILE_ROOT = MODULE_DIR;
/** `src/class`：基类层语义目录根，只读。 */
export const CLASS_ROOT = resolve(MODULE_DIR, '..', '..', 'class');

/** profile 所属的玩法类别，等于 `src/play/profiles` 下的一级目录名。 */
export type ProfileCategory = 'items' | 'npcs' | 'statuses' | 'vehicles' | 'weapons';

const PROFILE_CATEGORIES: readonly ProfileCategory[] = [
  'items',
  'npcs',
  'statuses',
  'vehicles',
  'weapons',
];

/** 一份已严格解析并冻结的玩法层 profile。 */
export interface PlayProfile {
  /** 相对 `src/play/profiles` 的 POSIX 风格路径，如 `weapons/wp_fists.json`。 */
  readonly sourceId: string;
  readonly category: ProfileCategory;
  readonly document: Readonly<Record<string, JsonValue>>;
}

// ---------------------------------------------------------------------------
// JSON 收窄工具
// ---------------------------------------------------------------------------

function asObject(value: JsonValue | undefined, path: string): Readonly<Record<string, JsonValue>> {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== 'object') {
    throw new TypeError(`${path} must be a JSON object`);
  }
  return value;
}

function asArray(value: JsonValue | undefined, path: string): readonly JsonValue[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be a JSON array`);
  return value;
}

function optionalRecord(value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | undefined {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== 'object') {
    return undefined;
  }
  return value;
}

function optionalStrings(value: JsonValue | undefined): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function requiredString(value: JsonValue | undefined, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// profile 读取
// ---------------------------------------------------------------------------

function jsonFilesUnder(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...jsonFilesUnder(path));
    else if (entry.isFile() && extname(entry.name) === '.json') files.push(path);
  }
  return files.sort((left, right) => left.localeCompare(right, 'en'));
}

function categoryOf(sourceId: string): ProfileCategory {
  const head = sourceId.split('/')[0];
  const category = PROFILE_CATEGORIES.find((candidate) => candidate === head);
  if (category === undefined) {
    throw new TypeError(`profile ${sourceId} 位于未登记的类别目录 ${String(head)}`);
  }
  return category;
}

/** 读取并严格解析全部玩法层 profile，按 sourceId 稳定排序。 */
export function loadPlayProfiles(): readonly PlayProfile[] {
  return jsonFilesUnder(PROFILE_ROOT).map((file) => {
    const sourceId = relative(PROFILE_ROOT, file).replaceAll('\\', '/');
    const parsed = parseStrictDataJson(readFileSync(file, 'utf8'), sourceId, '玩法层');
    return { sourceId, category: categoryOf(sourceId), document: asObject(parsed, sourceId) };
  });
}

// ---------------------------------------------------------------------------
// 基类层组合契约
// ---------------------------------------------------------------------------

/**
 * 基类层为某个语义族声明的组合契约。字段值形如 `classComposition.behaviorClassId`，
 * 这里只保留 `classComposition.` 之后的部分。
 */
export interface CompositionContract {
  /** 类引用所在字段，如 `behaviorClassId`、`classIds`、`weaponClassId`、`sourceClass`。 */
  readonly classField: string | undefined;
  readonly capabilityField: string | undefined;
  readonly damageClassField: string | undefined;
  /** 基类层明确让给玩法层拥有的字段名。 */
  readonly playLayerOwnedFields: ReadonlySet<string>;
}

const COMPOSITION_PREFIX = 'classComposition.';

function contractField(
  contract: Readonly<Record<string, JsonValue>> | undefined,
  key: string,
): string | undefined {
  const raw = contract?.[key];
  if (typeof raw !== 'string') return undefined;
  return raw.startsWith(COMPOSITION_PREFIX) ? raw.slice(COMPOSITION_PREFIX.length) : raw;
}

function readCompositionContract(
  catalog: Readonly<Record<string, JsonValue>>,
): CompositionContract {
  const contract = optionalRecord(catalog['compositionContract']);
  return {
    classField: contractField(contract, 'classReferenceField'),
    capabilityField: contractField(contract, 'capabilityReferenceField'),
    damageClassField: contractField(contract, 'damageClassReferenceField'),
    playLayerOwnedFields: new Set(optionalStrings(contract?.['playLayerOwnedFieldNames'])),
  };
}

/**
 * 基类层用三种拼写声明可配置参数名：`configurableParameters`（字符串数组）、
 * `configurableParameterNames`（字符串数组）、`parameters`（带 `key` 的对象数组）。
 * 三者都读，避免读取器因基类层改写拼写而静默失效。
 */
function readParameterNames(record: Readonly<Record<string, JsonValue>>): ReadonlySet<string> {
  const names = new Set<string>([
    ...optionalStrings(record['configurableParameters']),
    ...optionalStrings(record['configurableParameterNames']),
  ]);
  const parameters = record['parameters'];
  if (Array.isArray(parameters)) {
    for (const entry of parameters) {
      const key = optionalRecord(entry)?.['key'];
      if (typeof key === 'string') names.add(key);
    }
  }
  return names;
}

/**
 * 基类层声明的一个参数槽。`valueShape` 用来判定绑定值的形态：
 * `reference<...>` 要求解析到对应登记表，`field-name` 要求指向 profile 上真实存在的字段。
 */
export interface ParameterSpec {
  readonly key: string;
  readonly required: boolean;
  readonly valueShape: string | undefined;
}

function readParameterSpecs(record: Readonly<Record<string, JsonValue>>): readonly ParameterSpec[] {
  const parameters = record['parameters'];
  if (!Array.isArray(parameters)) return [];
  const specs: ParameterSpec[] = [];
  for (const entry of parameters) {
    const parameter = optionalRecord(entry);
    const key = parameter?.['key'];
    if (typeof key !== 'string') continue;
    const shape = parameter?.['valueShape'];
    specs.push({
      key,
      required: parameter?.['required'] === true,
      valueShape: typeof shape === 'string' ? shape : undefined,
    });
  }
  return specs;
}

/** 基类层的一个类（或能力）条目。 */
export interface ClassEntry {
  readonly id: string;
  /** 组合该类时必须同时组合的能力。 */
  readonly requiredCapabilityIds: ReadonlySet<string>;
  /** 组合该类时可选组合的能力。 */
  readonly optionalCapabilityIds: ReadonlySet<string>;
  /** 该条目声明可由玩法层配置的参数名。 */
  readonly parameterNames: ReadonlySet<string>;
  /** 带形态与必填性的参数槽声明；`configurableParameters` 式的纯名字清单在此为空。 */
  readonly parameters: readonly ParameterSpec[];
  /** 基类层为该条目声明的引擎 Op 白名单；空集表示未限定。 */
  readonly kernelOps: ReadonlySet<string>;
}

function readClassEntry(value: JsonValue, path: string): ClassEntry {
  const record = asObject(value, path);
  return {
    id: requiredString(record['id'], `${path}/id`),
    requiredCapabilityIds: new Set([
      ...optionalStrings(record['requiredCapabilityIds']),
      // 旧契约用单一 capabilityIds 表达"该类的能力组合"；两者都读以兼容改写过程中的中间态。
      ...optionalStrings(record['capabilityIds']),
    ]),
    optionalCapabilityIds: new Set(optionalStrings(record['optionalCapabilityIds'])),
    parameterNames: readParameterNames(record),
    parameters: readParameterSpecs(record),
    kernelOps: new Set(optionalStrings(record['kernelOps'])),
  };
}

/** 一个基类层语义族的完整索引。 */
export interface ClassFamily {
  readonly contract: CompositionContract;
  readonly classes: ReadonlyMap<string, ClassEntry>;
  readonly capabilities: ReadonlyMap<string, ClassEntry>;
}

function readFamily(
  catalog: Readonly<Record<string, JsonValue>>,
  classCollection: string,
  path: string,
): ClassFamily {
  const classes = new Map<string, ClassEntry>();
  for (const [index, value] of asArray(catalog[classCollection], `${path}/${classCollection}`).entries()) {
    const entry = readClassEntry(value, `${path}/${classCollection}/${index}`);
    classes.set(entry.id, entry);
  }

  const capabilities = new Map<string, ClassEntry>();
  const declared = catalog['capabilities'];
  if (Array.isArray(declared)) {
    for (const [index, value] of declared.entries()) {
      const entry = readClassEntry(value, `${path}/capabilities/${index}`);
      capabilities.set(entry.id, entry);
    }
  }

  return { contract: readCompositionContract(catalog), classes, capabilities };
}

function loadClassCatalog(relativePath: string): Readonly<Record<string, JsonValue>> {
  const file = join(CLASS_ROOT, relativePath);
  const parsed = parseStrictDataJson(readFileSync(file, 'utf8'), relativePath, '基类层');
  return asObject(parsed, relativePath);
}

function idSet(
  catalog: Readonly<Record<string, JsonValue>>,
  collection: string,
  path: string,
): ReadonlySet<string> {
  return new Set(asArray(catalog[collection], `${path}/${collection}`).map((entry, index) =>
    requiredString(asObject(entry, `${path}/${collection}/${index}`)['id'],
      `${path}/${collection}/${index}/id`)));
}

// ---------------------------------------------------------------------------
// 基类层索引
// ---------------------------------------------------------------------------

/** 基类层已登记语义的完整索引，按语义族分组。全部只读。 */
export interface ClassLayerIndex {
  readonly weapons: ClassFamily;
  readonly items: ClassFamily;
  readonly npcs: ClassFamily;
  readonly vehicles: ClassFamily;
  readonly statuses: ClassFamily;
  readonly damageClasses: ReadonlySet<string>;
  /** 重量档位的 token（如 `light`），玩法层用 token 而非完整 id 声明档位。 */
  readonly weightTierTokens: ReadonlySet<string>;
  readonly rangeTierTokens: ReadonlySet<string>;
  /** 档位 token → 完整档位 id，用于把 `weightClass: "heavy"` 解析成 `weight-tier.heavy`。 */
  readonly weightTierIdByToken: ReadonlyMap<string, string>;
  readonly rangeTierIdByToken: ReadonlyMap<string, string>;
  readonly damageTypes: ReadonlySet<string>;
  readonly vulnerabilityTypes: ReadonlySet<string>;
  /** 物品类 id 全集，供 `reference<item-class>` 形态的参数绑定解析。 */
  readonly itemClasses: ReadonlySet<string>;
}

/**
 * 2026-08-08 权威变更（本次会话裁决，已获项目所有者授权）：`spectrumClasses`/`spectrumAxes`/
 * `AxisCardinality`/`readAxes`/`readClassAxes` 已删除。攻击形状/形状轴设计判定为冗余，已被
 * 武器属性（散射/扫射/连发，通过 `classComposition.capabilityIds` 组合能力表达）完全覆盖。
 * 详见 `docs/L0_规范宪法.md`、`docs/L2_基类层/基类层定义.md` §4.3 最新权威内容。
 */

/**
 * W2 统一信封迁移（2026-08-12）：weaponClasses/weightTiers/rangeTiers 等顶层字段已迁入
 * `valueSets` 数组（每项 {id, tokens:[{id, playLayerTokens:[string,...]}]}）。
 * 档位 token 由 `playLayerTokens[0]` 给出（旧结构用顶层 `token` 字段）。
 */
function findValueSet(
  catalog: Readonly<Record<string, JsonValue>>,
  valueSetId: string,
  path: string,
): readonly JsonValue[] {
  const valueSets = catalog['valueSets'];
  if (!Array.isArray(valueSets)) throw new TypeError(`${path}/valueSets must be a JSON array`);
  const vs = valueSets.find((entry): entry is Record<string, JsonValue> => {
    return typeof entry === 'object' && entry !== null && !Array.isArray(entry)
      && (entry as Record<string, JsonValue>)['id'] === valueSetId;
  });
  if (vs === undefined) throw new TypeError(`${path}/valueSets: cannot find valueSet id=${valueSetId}`);
  return asArray((vs as Record<string, JsonValue>)['tokens'], `${path}/valueSets[id=${valueSetId}]/tokens`);
}

function tierIdsByTokenFromValueSet(
  catalog: Readonly<Record<string, JsonValue>>,
  valueSetId: string,
  path: string,
): ReadonlyMap<string, string> {
  const byToken = new Map<string, string>();
  for (const [index, entry] of findValueSet(catalog, valueSetId, path).entries()) {
    const record = asObject(entry, `${path}/valueSets[id=${valueSetId}]/tokens/${index}`);
    const id = requiredString(record['id'], `${path}/valueSets[id=${valueSetId}]/tokens/${index}/id`);
    // playLayerTokens[0] 是玩法层用于引用该档位的 token
    const playLayerTokens = optionalStrings(record['playLayerTokens']);
    const token = playLayerTokens[0] ?? id.slice(id.lastIndexOf('.') + 1);
    byToken.set(token, id);
  }
  return byToken;
}

function tierTokensFromValueSet(
  catalog: Readonly<Record<string, JsonValue>>,
  valueSetId: string,
  path: string,
): ReadonlySet<string> {
  return new Set(
    [...tierIdsByTokenFromValueSet(catalog, valueSetId, path).keys()]
  );
}

/** 读取基类层语义目录并建立索引。基类层文件在此只读，不做任何写入。 */
export function loadClassLayerIndex(): ClassLayerIndex {
  const weapons = loadClassCatalog('weapons/index.json');
  const items = loadClassCatalog('items/index.json');
  const npcs = loadClassCatalog('npcs/index.json');
  const vehicles = loadClassCatalog('vehicles/index.json');
  const statuses = loadClassCatalog('statuses/index.json');
  const damageTypes = loadClassCatalog('damage-types/index.json');
  const vulnerabilityTypes = loadClassCatalog('vulnerability-types/index.json');

  return {
    // W2 统一信封迁移（2026-08-12）：所有目录的语义集合字段统一为 'classes'。
    // 旧字段名：weapons→weaponClasses, npcs→behaviorClasses, statuses→statuses
    weapons: readFamily(weapons, 'classes', 'weapons'),
    items: readFamily(items, 'classes', 'items'),
    npcs: readFamily(npcs, 'classes', 'npcs'),
    vehicles: readFamily(vehicles, 'classes', 'vehicles'),
    statuses: readFamily(statuses, 'classes', 'statuses'),
    // damageClasses 不再是 weapons 顶层数组；W2 迁移后 damage-class.* 条目在
    // weapons.classes 里，用前缀过滤取出。
    damageClasses: new Set(
      Array.from(readFamily(weapons, 'classes', 'weapons').classes.keys())
        .filter((id) => id.startsWith('damage-class.')),
    ),
    // weightTiers/rangeTiers 迁入 weapons.valueSets 数组，token 用 playLayerTokens[0]。
    weightTierTokens: tierTokensFromValueSet(weapons, 'weapon.valueset.weight_tiers', 'weapons'),
    rangeTierTokens: tierTokensFromValueSet(weapons, 'weapon.valueset.range_tiers', 'weapons'),
    weightTierIdByToken: tierIdsByTokenFromValueSet(weapons, 'weapon.valueset.weight_tiers', 'weapons'),
    rangeTierIdByToken: tierIdsByTokenFromValueSet(weapons, 'weapon.valueset.range_tiers', 'weapons'),
    // damage-types 与 vulnerability-types 的集合字段已由 W2 统一为 'classes'。
    damageTypes: idSet(damageTypes, 'classes', 'damage-types'),
    vulnerabilityTypes: idSet(vulnerabilityTypes, 'classes', 'vulnerability-types'),
    itemClasses: idSet(items, 'classes', 'items'),
  };
}

/** 按 profile 类别取出对应的基类层语义族。 */
export function familyFor(index: ClassLayerIndex, category: ProfileCategory): ClassFamily {
  switch (category) {
    case 'weapons': return index.weapons;
    case 'items': return index.items;
    case 'npcs': return index.npcs;
    case 'vehicles': return index.vehicles;
    case 'statuses': return index.statuses;
  }
}

/**
 * 玩法层自己登记的实例 id 全集：每个 profile 的 `id`，以及 `variants[].id` 声明的派生实例。
 * NPC 的 `initialEquipment` 等实例引用必须落在这个集合内。
 */
export function playInstanceIds(profiles: readonly PlayProfile[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const profile of profiles) {
    const id = profile.document['id'];
    if (typeof id === 'string') ids.add(id);
    for (const variant of asArrayOrEmpty(profile.document['variants'])) {
      const variantId = optionalRecord(variant)?.['id'];
      if (typeof variantId === 'string') ids.add(variantId);
    }
  }
  return ids;
}

function asArrayOrEmpty(value: JsonValue | undefined): readonly JsonValue[] {
  return Array.isArray(value) ? value : [];
}

export { asArray as asJsonArray, asObject as asJsonObject, optionalRecord as asOptionalRecord };

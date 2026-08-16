/**
 * CompiledPlaypack → PlaypackDef 装配桥（D-081 / L0 第十四条「装载等价」）。
 *
 * 编译管线（compile.ts）的产物停在 CompiledPlaypack：验证已通过、诊断已汇总，但装载入口
 * （PlaypackLoader / loadCoreMechanics）只认 PlaypackDef。本文件是两者之间唯一的装配桥：
 * 把 profiles 展开为可注册 Def、把地图 prefab 作为 defs 条目并入、把包级元数据
 * （deliveryForm / referencedClassIds / 编译 warning / source）透传进 props。
 *
 * 职责边界：只做结构装配，不新增规则判定、不补默认语义、不捏造数值。profile 文档是声明式
 * 数据，整份透传；类别到 DefKind 的推导与 defs 展开是装配本身，不是对文档的再校验
 * （语义与数值校验已由编译管线完成）。
 */
import type { PlaypackDef } from '../../core/kernel/schedule/playpack.js';
import type { Def, DefKind } from '../../core/kernel/state/def.js';
import type { Value } from '../../core/kernel/state/value.js';
import type { PrefabDef } from '../../core/kernel/topology/prefab.js';
import { collectNumericFields, internalMetric, type NumericOwnership } from '../core-mechanics/ownership.js';
import type { CompiledPlaypack, ParsedProfile } from './types.js';

/** 玩法类别 → 引擎 DefKind。类别语义见 src/play/profiles/catalog.ts 的 ProfileCategory。 */
const CATEGORY_DEF_KIND: Readonly<Record<ParsedProfile['category'], DefKind>> = {
  items: 'item',
  npcs: 'entity',
  statuses: 'attachment',
  vehicles: 'entity',
  weapons: 'item',
};

/** 引擎全部 DefKind 字面量（src/core/kernel/state/def.ts），识别文档显式声明的 kind 是否合法。 */
const DEF_KINDS: readonly string[] = [
  'entity', 'item', 'node', 'link', 'attachment', 'action', 'rule',
  'playpack', 'decision', 'prefab', 'expr', 'schedule', 'policy',
];

function isDefKind(value: unknown): value is DefKind {
  return typeof value === 'string' && DEF_KINDS.includes(value);
}

/**
 * 一份 profile 文档 → 可注册 Def。
 *
 * 整份文档透传（classComposition / actions / 各类引用字段原样保留），只补 Def 必需的身份字段：
 * - `id`：取自文档自身；非空字符串缺失时无法注册（Def.id 必填），跳过该 profile 且不捏造 id。
 * - `kind`：文档显式声明的合法 DefKind 优先；否则按类别推导。
 *
 * 透传即不改写：profile 的 `actions` 是玩法层动作定义对象数组，与引擎 Def 的 `actions?: Id[]`
 * （引擎动作引用）同名不同义——作为索引签名外的附加字段原样保留，不做引擎形状校验。
 */
function profileToDef(profile: ParsedProfile): Def | null {
  const id = profile.document['id'];
  if (typeof id !== 'string' || id.length === 0) return null;
  const explicitKind = profile.document['kind'];
  const kind = isDefKind(explicitKind) ? explicitKind : CATEGORY_DEF_KIND[profile.category];
  return { ...profile.document, id, kind } as unknown as Def;
}

/** 编译诊断中非 error 的 warning，收集为 props 元数据。 */
function compileWarningsOf(compiled: CompiledPlaypack): Value[] | undefined {
  const warnings = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning');
  if (warnings.length === 0) return undefined;
  // PlaypackDiagnostic 是编译管线严格 JSON 解析的产物，结构上 JSON 安全；suggestedFix 的
  // unknown 只是类型宽泛。作为 props 元数据携带，不做形状改写。
  return warnings as unknown as Value[];
}

/**
 * 把编译产物装配为可装载的 PlaypackDef。
 *
 * 装配内容：
 * - 包级 `id`/`version` 取自 `compiled.input`，`kind: 'playpack'`；
 * - `defs` = 每个 profile 展开的 Def（按编译产物顺序）+ 每张地图的 PrefabDef（有地图才有，
 *   无地图时不产生 prefab def）；
 * - `props.deliveryForm` / `props.referencedClassIds` / `props.compileWarnings` / `props.source`
 *   透传编译元数据（referencedClassIds 是集合，转数组并稳定排序，与文档书写顺序无关）。
 */
export function compileToPlaypackDef(compiled: CompiledPlaypack): PlaypackDef {
  const { input, profiles, maps } = compiled;

  const profileDefs: Def[] = [];
  for (const profile of profiles) {
    const def = profileToDef(profile);
    if (def !== null) profileDefs.push(def);
  }

  // ParsedMap.prefab 即 PrefabDef（map/compile.ts 的产物，已深冻结）；编译管线只在结构校验
  // 通过后产出 prefab，因此这里不需要对 prefab 内容做任何再校验。
  //
  // 玩法层 Linter 的「无分类即拒绝」纪律（ownership.ts 的 validateNumericOwnership）要求每个
  // Def 都带 play 扩展。Prefab 是地图编译产物，其数值叶（links 权重等）是地图结构数据
  // （L0 第四条内部数值例外：距离/权重不入玩家可见刻度），因此在装配期按实际数值叶动态补
  // 一份全 internal 的归属声明——不豁免 Linter、不捏造玩法数值、任意地图都能闭合。
  const prefabDefs: Def[] = maps
    .map((map) => map.prefab)
    .filter((prefab): prefab is PrefabDef => prefab !== null)
    .map((prefab) => {
      const numericOwnership: Record<string, NumericOwnership> = {};
      for (const field of collectNumericFields(prefab)) {
        numericOwnership[field.path] = internalMetric('地图结构数据（权重/坐标等）：由地图编译产物生成，非玩家可见玩法数值。');
      }
      return { ...prefab, play: { numericOwnership, sourceTrace: ['D-081 / L0 第十四条：UGC 装配桥，prefab 由地图编译产物生成'] } };
    });

  const props: Record<string, Value> = {
    referencedClassIds: [...compiled.referencedClassIds].sort((left, right) => left.localeCompare(right, 'en')),
  };
  if (compiled.deliveryForm !== undefined) props['deliveryForm'] = compiled.deliveryForm;
  const compileWarnings = compileWarningsOf(compiled);
  if (compileWarnings !== undefined) props['compileWarnings'] = compileWarnings;
  props['source'] = input.source;

  return {
    id: input.id,
    kind: 'playpack',
    version: input.version,
    props,
    defs: [...profileDefs, ...prefabDefs],
  };
}

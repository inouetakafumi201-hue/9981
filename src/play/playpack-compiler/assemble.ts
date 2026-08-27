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
import type { PlaypackDef } from '../../core/kernel/schedule/playpack';
import type { Def, DefKind } from '../../core/kernel/state/def';
import type { Value } from '../../core/kernel/state/value';
import type { PrefabDef } from '../../core/kernel/topology/prefab';
import { collectNumericFields, constitutionalConstant, gameplayValue, internalMetric, structuralBound, type NumericOwnership } from '../core-mechanics/ownership';
import { classifyNumericField, visitNumericSites } from '../types/numeric-classification';
import type { CompiledPlaypack, ParsedProfile } from './types';

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
 * 为任意文档（profile 文档或清单 def）自动派生数值归属（数值归属 + 来源追踪）。
 *
 * 真实 UGC 玩家包通常不写 `play.numericOwnership`，而玩法层 Linter 的「无分类即拒绝」纪律
 * （ownership.ts 的 validateNumericOwnership）要求每个 Def 都带归属。这里以编译管线的数值分类
 * 登记表（numeric-classification.ts 的 classifyNumericField）为真源，为文档每个数字叶派生归属，
 * 不另建分类表、不捏造数值语义。
 *
 * 未登记键（Unclassified）默认映射为 Gameplay_Value：D-023「数值默认都按 1-5 校验，只有 schema
 * 明确标注为内部量纲时才可豁免」——未登记即视为玩家可见，取值越界会在玩法层 Linter 以
 * E_LOAD_GAMEPLAY_VALUE_RANGE 拒绝，是安全方向（宁可拒不可漏）。这是本模块的自主判断，如实标注。
 */
function deriveOwnershipFromDocument(document: unknown): Record<string, NumericOwnership> {
  const ownership: Record<string, NumericOwnership> = {};
  visitNumericSites(document, (site) => {
    // 跳过 play 元数据子树：归属声明里的 min/max/rationale 是治理元数据，不参与自身分类。
    if (site.path.startsWith('/play')) return;
    // JSON 指针路径（/damage、/actions/0/delta）→ Def 根点分路径（damage、actions.0.delta），
    // 与 ownership.ts 的 collectNumericFields 输出一致，保证归属键逐字符命中。
    const path = site.path.replace(/^\//, '').replace(/\//g, '.');
    const ruling = classifyNumericField(site);
    if (ruling === undefined) {
      ownership[path] = gameplayValue();
      return;
    }
    switch (ruling.classification) {
      case 'Gameplay_Value':
        ownership[path] = gameplayValue();
        break;
      case 'Structural_Bound':
        ownership[path] = structuralBound(ruling.rationale);
        break;
      case 'Constitutional_Constant':
        ownership[path] = constitutionalConstant(ruling.source);
        break;
      case 'Internal_Metric':
        ownership[path] = internalMetric(ruling.rationale);
        break;
    }
  });
  return ownership;
}

/** 派生的来源追踪（所有自动派生共用同一来源声明）。 */
const DERIVED_SOURCE_TRACE = ['D-081 / UGC 装配桥：数值归属由编译管线分类登记表自动派生'];

function derivedPlayExtension(profile: ParsedProfile): { numericOwnership: Record<string, NumericOwnership>; sourceTrace: string[] } | null {
  const ownership = deriveOwnershipFromDocument(profile.document);
  if (Object.keys(ownership).length === 0) return null;
  return {
    numericOwnership: ownership,
    sourceTrace: [...DERIVED_SOURCE_TRACE],
  };
}

/**
 * 确保一个 Def 带 play 扩展（清单 defs 的自动派生入口）。
 *
 * - 已显式携带 play（对象形态）→ 保留归属；缺 sourceTrace（PlayDefExtension 必填）时补默认
 *   来源追踪，不覆盖文档自己的归属；
 * - 无 play → 按数值分类登记表自动派生（与 profile 同一路径）。派生出的 sourceTrace 是 UGC
 *   装配桥来源声明，满足 validateProvenance 的可解析性（D-### 形态）。
 */
function ensurePlayExtension(def: Def): Def {
  const play = (def as Record<string, unknown>)['play'];
  if (play !== null && typeof play === 'object' && !Array.isArray(play)) {
    const record = play as Record<string, unknown>;
    if (Array.isArray(record['sourceTrace'])) return def;
    return { ...def, play: { ...record, sourceTrace: [...DERIVED_SOURCE_TRACE] } };
  }
  const ownership = deriveOwnershipFromDocument(def);
  if (Object.keys(ownership).length === 0) return def;
  return { ...def, play: { numericOwnership: ownership, sourceTrace: [...DERIVED_SOURCE_TRACE] } };
}

/**
 * 一份 profile 文档 → 可注册 Def。
 *
 * 整份文档透传（classComposition / actions / 各类引用字段原样保留），只补 Def 必需的身份字段：
 * - `id`：取自文档自身；非空字符串缺失时无法注册（Def.id 必填），跳过该 profile 且不捏造 id。
 * - `kind`：文档显式声明的合法 DefKind 优先；否则按类别推导。
 * - `play`：文档显式携带时原样保留（缺 sourceTrace 的按 PlayDefExtension 形状补齐来源追踪，
 *   不覆盖文档自己的归属）；否则按数值分类登记表自动派生（见 derivedPlayExtension）。
 *
 * 透传即不改写：profile 的 `actions` 是玩法层动作定义对象数组，与引擎 Def 的 `actions?: Id[]`
 * （引擎动作引用）同名不同义——作为索引签名外的附加字段原样保留，不做引擎形状校验。
 */
function profileToDef(profile: ParsedProfile): Def | null {
  const id = profile.document['id'];
  if (typeof id !== 'string' || id.length === 0) return null;
  const explicitKind = profile.document['kind'];
  const kind = isDefKind(explicitKind) ? explicitKind : CATEGORY_DEF_KIND[profile.category];
  const base = { ...profile.document, id, kind } as unknown as Def;

  const explicitPlay = profile.document['play'];
  if (explicitPlay !== null && typeof explicitPlay === 'object' && !Array.isArray(explicitPlay)) {
    // 文档自带 play：保留归属；若缺 sourceTrace（PlayDefExtension 必填），补默认来源追踪。
    const play = explicitPlay as Record<string, unknown>;
    if (!Array.isArray(play['sourceTrace'])) {
      return { ...base, play: { ...play, sourceTrace: ['D-081 / UGC 装配桥：文档自带数值归属，来源追踪由装配桥补齐'] } } as unknown as Def;
    }
    return base;
  }

  const derived = derivedPlayExtension(profile);
  if (derived === null) return base;
  return { ...base, play: derived } as unknown as Def;
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
 * - 无 playpack 清单时：包级 `id`/`version` 取自 `compiled.input`，`kind: 'playpack'`；
 *   `defs` = 每个 profile 展开的 Def（按编译产物顺序）+ 每张地图的 PrefabDef（有地图才有，
 *   无地图时不产生 prefab def）；
 * - 有 playpack 清单时（D-081 / L0 第十四条：玩法包可携带完整规则与逻辑）：以清单为基——
 *   id/version/schedule/pools/outcomes/entry/rules/hookOrder 等包级声明全部取自清单
 *   （清单是解码通过的 PlaypackDef），profiles/maps 展开的 defs 追加进其 `defs` 数组；
 *   清单 defs 缺 play 扩展的按数值分类登记表自动派生（与 profile 同一路径）。
 * - `props.deliveryForm` / `props.referencedClassIds` / `props.compileWarnings` / `props.source`
 *   透传编译元数据（referencedClassIds 是集合，转数组并稳定排序，与文档书写顺序无关）；
 *   有清单时叠加到清单自带的 props 之上（装配元数据优先，不覆盖清单声明）。
 */
export function compileToPlaypackDef(compiled: CompiledPlaypack): PlaypackDef {
  const { input, profiles, maps, playpackDef } = compiled;

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

  if (playpackDef === undefined) {
    return {
      id: input.id,
      kind: 'playpack',
      version: input.version,
      props,
      defs: [...profileDefs, ...prefabDefs],
    };
  }

  // 以清单为基：包级声明（id/version/schedule/pools/outcomes/entry/rules/hookOrder…）取自清单；
  // 清单 defs 缺 play 扩展的自动派生；profiles/maps 展开的 defs 追加进 defs 数组。
  const manifestDefs = playpackDef.defs.map(ensurePlayExtension);
  return {
    ...playpackDef,
    defs: [...manifestDefs, ...profileDefs, ...prefabDefs],
    props: { ...(playpackDef.props ?? {}), ...props },
  };
}

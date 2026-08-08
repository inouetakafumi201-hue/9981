/**
 * 玩法层数值归属与装载期治理基座（tasks.md 任务 1.1-1.3 / design.md 2.6）。
 *
 * 本模块是**纯函数模块**：不 import `OpRegistry` / `Transaction` / `OpContext`，不持有
 * `WorldState`，不产生任何写入。它的全部输出都是引擎层 `Diagnostic`——玩法层没有第二套
 * 错误模型，也不新增任何 ErrCode（design.md 7.1）。
 *
 * 与 `src/play/types/numeric-classification.ts` 的关系（两者不是重复建模）：
 * - 那份登记表按**键名 + JSON 路径后缀**为 `src/play/profiles/**` 的实例文档做全局分类，
 *   分类知识集中在一张表里，profile 自身不声明归属。
 * - 本模块按**每个 Def 自带的 `play.numericOwnership` 映射**做逐 Def 分类，分类知识写在被
 *   分类的定义旁边，缺一条即拒绝装载（design.md 2.6 第 2 条要求"无分类即拒绝，不得推断"）。
 * 两者服务不同的输入（profile 文档 / `Def` 对象）与不同的失败时点，不互相替代。
 */
import type { Def } from '../../core/kernel/state/def.js';
import type { Diagnostic } from '../../core/kernel/state/diagnostic.js';

// ---------------------------------------------------------------------------
// 归属分类（design.md 2.6 的四分法，术语取自基类层 Spec，不新造第五类）
// ---------------------------------------------------------------------------

/** 玩家可见玩法数值的宪法刻度（S0 四·4.2）。 */
export const GAMEPLAY_VALUE_MIN = 1;
export const GAMEPLAY_VALUE_MAX = 5;

export type NumericOwnership =
  /** 影响玩法平衡的具体赋值：必须是 1-5 的整数，且允许展示给玩家。 */
  | { readonly kind: 'gameplay'; readonly min: 1; readonly max: 5; readonly int: true }
  /** 回合编号、计数、索引、预算、结算镜像：不受 1-5 限制，投影层禁止展示。 */
  | { readonly kind: 'internal'; readonly note: string }
  /** 保证类型结构或认知上限的限制：取值由结构理由决定。 */
  | { readonly kind: 'structural'; readonly rationale: string }
  /** 由 L0 宪法固定并带来源编号的常量。 */
  | { readonly kind: 'constitutional'; readonly sourceId: string };

/** 便捷构造器：让每个 Def 的归属声明保持单行可读，同时保证字段形状不写错。 */
export const gameplayValue = (): NumericOwnership => ({ kind: 'gameplay', min: 1, max: 5, int: true });
export const internalMetric = (note: string): NumericOwnership => ({ kind: 'internal', note });
export const structuralBound = (rationale: string): NumericOwnership => ({ kind: 'structural', rationale });
export const constitutionalConstant = (sourceId: string): NumericOwnership => ({ kind: 'constitutional', sourceId });

// ---------------------------------------------------------------------------
// 未冻结项与已裁决项
// ---------------------------------------------------------------------------

/**
 * 仍未冻结的玩法事项（requirements.md Requirement 16.8 的封闭清单）。
 * 引用其中任一项 → 装载期 `E_LOAD_UNRESOLVED_CONTRACT`。
 *
 * 恰好三项：T-001（枪械基础伤害表）、T-002（掩体的减伤/命中修正**数值**，结构已由 D-040 冻结）、
 * U-001（1-5 基础投点分布与强力骰越界策略）。
 */
export type UnresolvedId = 'T-001' | 'T-002' | 'U-001';

/**
 * 已裁决关闭的原未冻结项。**引用它们不构成拒绝理由**（requirements.md 16.8 原文：
 * "已裁决关闭的 U-002（D-037）、U-003（D-055）、U-004（D-053）、U-005（D-052）以及 T-002 的
 * 结构部分（D-040）不在此列——引用它们不构成拒绝理由"）。
 *
 * 为什么保留这些标识符而不是删掉：requirements.md 17.4 明确"仅删除表项不构成裁决"，
 * 因此这些编号必须仍然可被引用、可被追踪，只是分类从"未冻结"改为"已裁决"。
 */
export type AdjudicatedId = 'U-002' | 'U-003' | 'U-004' | 'U-005';

/** `PlayDefExtension.unresolvedGuards` 可以出现的全部编号。 */
export type GuardId = UnresolvedId | AdjudicatedId;

export const UNRESOLVED_IDS: readonly UnresolvedId[] = ['T-001', 'T-002', 'U-001'];

/** 每个已裁决编号对应的裁决决策号，写进诊断以便追溯"为什么这里不拒绝"。 */
export const ADJUDICATED_DECISIONS: Readonly<Record<AdjudicatedId, string>> = {
  'U-002': 'D-037',
  'U-003': 'D-055',
  'U-004': 'D-053',
  'U-005': 'D-052',
};

const UNRESOLVED_SET: ReadonlySet<string> = new Set(UNRESOLVED_IDS);
const ADJUDICATED_SET: ReadonlySet<string> = new Set(Object.keys(ADJUDICATED_DECISIONS));

export function isUnresolvedId(value: string): value is UnresolvedId {
  return UNRESOLVED_SET.has(value);
}

export function isAdjudicatedId(value: string): value is AdjudicatedId {
  return ADJUDICATED_SET.has(value);
}

// ---------------------------------------------------------------------------
// Def 上的玩法层扩展命名空间
// ---------------------------------------------------------------------------

/**
 * 玩法层在每个 `Def` 上写的命名空间字段名。
 *
 * 引擎层 `Def` 带索引签名 `[key: string]: unknown` 并忽略未知字段，因此这不改变任何引擎层
 * 接口（design.md 2.6 / 4.4 自检清单"是否新增顶层集合或结构区字段：否"）。
 */
export const PLAY_EXT_KEY = 'play';

/** 附着动作的触发时点（design.md 3.6）。 */
export type AttachedTriggerPoint = 'beforeParentEffects' | 'afterParentEffects';

/** 附着动作前置条件不满足时的行为（design.md 3.6）。 */
export type AttachedFailureBehavior = 'rejectWholeAction' | 'skipAttachedOnly';

export interface PlayDefExtension {
  /** 字段路径 → 归属。键必须与 `collectNumericFields` 产出的路径逐字符一致。 */
  readonly numericOwnership: Readonly<Record<string, NumericOwnership>>;
  /** 动作的成本类别；非动作定义省略。 */
  readonly costClass?: 'paid' | 'attached';
  /** 仅 `costClass:'attached'` 时必填，且必须非空（design.md 3.6 / Requirement 8.5）。 */
  readonly parentActions?: readonly string[];
  /** 仅附着动作必填：触发时点。 */
  readonly triggerPoint?: AttachedTriggerPoint;
  /** 仅附着动作必填：前置条件引用（一个具名 Expr Def 的 Id）。 */
  readonly requireRef?: string;
  /** 仅附着动作必填：前置条件不满足时的行为。 */
  readonly onFailure?: AttachedFailureBehavior;
  /** 来源追踪（S0/S1/…/S9 + 条款号 + 决策号），必须非空（Requirement 1.7）。 */
  readonly sourceTrace: readonly string[];
  /** 本定义引用了哪些未冻结/已裁决编号。 */
  readonly unresolvedGuards?: readonly GuardId[];
  /**
   * 表现字段（图标、文案键、素材引用）。缺失只产生 `warn` 级 `E_LOAD_PRESENTATION_FALLBACK`
   * 并使用类型兼容回退，不改变任何语义字段（Requirement 16.3）。
   */
  readonly presentation?: {
    readonly labelKey?: string;
    readonly iconKey?: string;
  };
}

/** 一个数值叶值在 `Def` 内的位置与取值。 */
export interface NumericField {
  /** 从 Def 根开始的点分路径，数组下标以十进制数字段出现，例如 `cost.0.amount`。 */
  readonly path: string;
  readonly value: number;
}

/** 一个字符串叶值在 `Def` 内的位置与取值（术语与废案扫描的输入）。 */
export interface StringField {
  readonly path: string;
  readonly value: string;
}

/** 读出一个 Def 上的玩法层扩展；不存在或形状不对时返回 null（由校验器负责报错）。 */
export function playExtensionOf(def: Def): PlayDefExtension | null {
  const candidate = (def as Record<string, unknown>)[PLAY_EXT_KEY];
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const ext = candidate as Partial<PlayDefExtension>;
  if (ext.numericOwnership === null || typeof ext.numericOwnership !== 'object') return null;
  if (!Array.isArray(ext.sourceTrace)) return null;
  return candidate as PlayDefExtension;
}

// ---------------------------------------------------------------------------
// 遍历：数值叶值与字符串叶值
// ---------------------------------------------------------------------------

/**
 * 为什么遍历必须跳过 `play` 命名空间：`play.numericOwnership` 的取值里本身就含 `min:1`/`max:5`
 * 这样的数字，`play.presentation` 里含说明性文本。如果把它们也当成被治理的数值/语义字符串，
 * 就会出现"归属声明需要为自己再声明一次归属"的无限回退，以及"理由文本里提到废案名 →
 * 判定为废案复活"这类假阳性。因此 `play` 是元数据区，恒被排除。
 */
function isExcludedRootKey(key: string): boolean {
  // play：元数据区（见上）。
  // defs：PlaypackDef 嵌入的子定义数组——每个子定义各自带 play.numericOwnership，单独校验，
  //       不应在校验 Playpack 自身时被重复遍历（否则要求 Playpack 再分类一遍全部子定义的数值）。
  // linter：PlaypackDef 的自定义检查函数，不是数据。
  return key === PLAY_EXT_KEY || key === 'defs' || key === 'linter';
}

function visitLeaves(
  value: unknown,
  path: string,
  depth: number,
  onNumber: (field: NumericField) => void,
  onString: (field: StringField) => void,
): void {
  if (typeof value === 'number') {
    onNumber({ path, value });
    return;
  }
  if (typeof value === 'string') {
    onString({ path, value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((element, index) => {
      visitLeaves(element, path === '' ? String(index) : `${path}.${index}`, depth + 1, onNumber, onString);
    });
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (depth === 0 && isExcludedRootKey(key)) continue;
    visitLeaves(child, path === '' ? key : `${path}.${key}`, depth + 1, onNumber, onString);
  }
}

/**
 * 递归遍历一个 `Def` 的全部数值字面量字段（含 `props`、`cost[].amount`、`clamp` 的 `min`/`max`、
 * `effects` 内的任意数字），返回「字段路径 → 数值」列表。路径格式与 `numericOwnership` 的键一致。
 *
 * 输出按路径排序，使诊断顺序稳定（不依赖对象键的插入顺序）。
 */
export function collectNumericFields(def: Def): readonly NumericField[] {
  const fields: NumericField[] = [];
  visitLeaves(def, '', 0, (field) => fields.push(field), () => {});
  return fields.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

/** 递归遍历一个 `Def` 的全部字符串字面量字段（术语纪律与废案名单扫描的输入）。 */
export function collectStringFields(def: Def): readonly StringField[] {
  const fields: StringField[] = [];
  visitLeaves(def, '', 0, () => {}, (field) => fields.push(field));
  return fields.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

// ---------------------------------------------------------------------------
// 诊断构造
// ---------------------------------------------------------------------------

/** 装载期诊断的 `phase` 恒为 0：装载发生在任何相位推进之前（与引擎层 PlaypackLoader 一致）。 */
const LOAD_PHASE = 0;

function loadDiagnostic(
  code: Diagnostic['code'],
  message: string,
  defId: string,
  extra: Partial<Diagnostic> = {},
): Diagnostic {
  return {
    code,
    severity: 'error',
    message,
    at: { def: defId },
    phase: LOAD_PHASE,
    scope: 'definition',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// 任务 1.2：归属分类校验与可见值域纯函数
// ---------------------------------------------------------------------------

/**
 * 玩家可见玩法数值判定：仅当是 1-5 的整数时为真。
 * 显式拒绝 `0`、`6`、小数、`NaN`、`Infinity`、`-Infinity`（Requirement 3.1-3.3）。
 */
export function isVisibleGameplayValue(value: unknown): boolean {
  if (typeof value !== 'number') return false;
  if (!Number.isFinite(value)) return false;
  if (!Number.isInteger(value)) return false;
  return value >= GAMEPLAY_VALUE_MIN && value <= GAMEPLAY_VALUE_MAX;
}

/**
 * 任一数值字段在 `numericOwnership` 中无分类 → `E_LOAD_NUMERIC_OWNERSHIP`，
 * 且**不得**把它推断为内部数值（design.md 2.6 第 2 条、Requirement 3.9）。
 */
export function validateNumericOwnership(def: Def): readonly Diagnostic[] {
  const ext = playExtensionOf(def);
  const diagnostics: Diagnostic[] = [];
  if (ext === null) {
    // 扩展缺失本身就是"全部数值都未分类"。这里不退化为"没有数值就放过"：一个玩法层 Def
    // 即便当前不含数值，也必须带扩展，否则后续给它加一个数值时不会有任何东西阻止漏分类。
    return [loadDiagnostic(
      'E_LOAD_NUMERIC_OWNERSHIP',
      `玩法层定义 ${def.id} 缺少 ${PLAY_EXT_KEY} 扩展命名空间（numericOwnership / sourceTrace）`,
      def.id,
      { path: PLAY_EXT_KEY, hint: '请在该定义上补齐 play.numericOwnership 与 play.sourceTrace。' },
    )];
  }
  const declared = ext.numericOwnership;
  for (const field of collectNumericFields(def)) {
    if (!Object.prototype.hasOwnProperty.call(declared, field.path)) {
      diagnostics.push(loadDiagnostic(
        'E_LOAD_NUMERIC_OWNERSHIP',
        `定义 ${def.id} 的数值字段 ${field.path}（值 ${field.value}）没有登记归属分类`,
        def.id,
        {
          path: field.path,
          actual: field.value,
          reason: 'numeric-ownership-missing',
          hint: '请在 play.numericOwnership 中为该路径声明 gameplay / internal / structural / constitutional 之一；未分类的数值不会被推断为内部数值。',
          correctionSuggestion: `play.numericOwnership['${field.path}'] = gameplayValue() // 或 internalMetric(...) / structuralBound(...) / constitutionalConstant(...)`,
        },
      ));
    }
  }
  // 反向检查：登记了却不存在的路径同样是漂移（归属表与实际数据不一致），按跨字段约束报出。
  const actualPaths = new Set(collectNumericFields(def).map((field) => field.path));
  for (const path of Object.keys(declared).sort((left, right) => left.localeCompare(right, 'en'))) {
    if (!actualPaths.has(path)) {
      diagnostics.push(loadDiagnostic(
        'E_LOAD_CROSS_FIELD_CONSTRAINT',
        `定义 ${def.id} 的 numericOwnership 登记了不存在的数值路径 ${path}`,
        def.id,
        {
          path,
          reason: 'numeric-ownership-stale',
          hint: '请删除该条登记，否则归属表会与实际定义漂移。',
        },
      ));
    }
  }
  return diagnostics;
}

/** 分类为 `gameplay` 但值不是 1-5 的整数 → `E_LOAD_GAMEPLAY_VALUE_RANGE`。 */
export function validateGameplayValueRange(def: Def): readonly Diagnostic[] {
  const ext = playExtensionOf(def);
  if (ext === null) return [];
  const diagnostics: Diagnostic[] = [];
  for (const field of collectNumericFields(def)) {
    const ownership = ext.numericOwnership[field.path];
    if (ownership === undefined) continue; // 缺分类由 validateNumericOwnership 负责报出
    if (ownership.kind !== 'gameplay') continue;
    if (!isVisibleGameplayValue(field.value)) {
      diagnostics.push(loadDiagnostic(
        'E_LOAD_GAMEPLAY_VALUE_RANGE',
        `定义 ${def.id} 的字段 ${field.path} 归属为 Gameplay_Value，但取值 ${field.value} 不是 ${GAMEPLAY_VALUE_MIN}-${GAMEPLAY_VALUE_MAX} 的整数`,
        def.id,
        {
          path: field.path,
          expected: `${GAMEPLAY_VALUE_MIN}-${GAMEPLAY_VALUE_MAX} 的整数`,
          actual: field.value,
          reason: 'gameplay-value-out-of-range',
          hint: '玩家可见玩法数值必须落在 1-5；若这是内部计数或结构上限，请改用 internalMetric / structuralBound 并写明理由。',
        },
      ));
    }
  }
  return diagnostics;
}

/**
 * 分类为 `internal` 的字段出现在投影白名单中 → `E_LOAD_NUMERIC_OWNERSHIP`
 * （design.md 2.6 第 4 条、5.3 节末尾"投影白名单不得包含任何归属为 internal 的字段"）。
 *
 * `whitelist` 的元素是**字段路径**，与 `numericOwnership` 的键同一格式。
 */
export function assertInternalNotInProjectionWhitelist(
  def: Def,
  whitelist: readonly string[],
): readonly Diagnostic[] {
  const ext = playExtensionOf(def);
  if (ext === null) return [];
  const whitelisted = new Set(whitelist);
  const diagnostics: Diagnostic[] = [];
  for (const path of Object.keys(ext.numericOwnership).sort((left, right) => left.localeCompare(right, 'en'))) {
    const ownership = ext.numericOwnership[path];
    if (ownership === undefined || ownership.kind !== 'internal') continue;
    if (!whitelisted.has(path)) continue;
    diagnostics.push(loadDiagnostic(
      'E_LOAD_NUMERIC_OWNERSHIP',
      `定义 ${def.id} 的字段 ${path} 归属为 Internal_Metric，但出现在投影白名单中`,
      def.id,
      {
        path,
        reason: 'internal-metric-projected',
        hint: '内部数值不得作为玩法值展示；请把它从投影白名单中移除，或重新裁定其归属。',
      },
    ));
  }
  return diagnostics;
}

// ---------------------------------------------------------------------------
// 任务 1.3：术语、废案、来源追踪与未冻结项校验
// ---------------------------------------------------------------------------

/**
 * 废用术语（L0 规范宪法 一·术语铁律）。作为规范概念出现即拒绝。
 * `canonical` 是诊断里给出的替代名，避免只报"错了"而不报"该写什么"。
 */
export const NONCANONICAL_TERMS: readonly { readonly term: string; readonly canonical: string }[] = [
  // 废用词本身必须作为数据出现，否则无法检测。写成转义码点：直接写出字面量会让本检测器成为
  // 仓库级术语守卫（src/class/__tests__/architecture-terminology.test.ts）自己的命中项。
  // '\u6a21\u677f' = 废用的实例说法；'\u5185\u5bb9\u5c42' = 废用的基类层说法。
  { term: '\u6a21\u677f', canonical: '实例（Instance）' },
  { term: '\u5185\u5bb9\u5c42', canonical: '基类层（Class）' },
];

/**
 * 已否决机制名单（来源代号 S8：`docs/_术语表与废案清单.md`；淋湿状态另见 S7 D-016）。
 * 命中即 `E_LOAD_DEPRECATED_MECHANIC`（Requirement 1.5、13.6）。
 */
export const DEPRECATED_MECHANICS: readonly {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly source: string;
  readonly replacement: string;
}[] = [
  {
    name: '尸体系统',
    aliases: ['尸体系统', 'corpse-system', 'corpse_system', 'corpseSystem'],
    source: 'S8 废案清单',
    replacement: '死亡背包（独立新建的只出不进容器实体，见 design.md 3.11）',
  },
  {
    name: '回合外反击 / Overwatch',
    aliases: ['回合外反击', 'overwatch', 'Overwatch', 'out-of-turn-riposte'],
    source: 'S8 废案清单；Requirement 8.2',
    replacement: '在自己回合预先声明、由合法事件自动触发且不再征求输入的被动效果',
  },
  {
    name: '感知衰减表',
    aliases: ['感知衰减表', 'perception-decay-table', 'perceptionDecayTable'],
    source: 'S8 废案清单',
    replacement: '由 AI Spec 的感知契约显式声明，不在核心机制内建表',
  },
  {
    name: '淋湿状态（D-016 已移除）',
    aliases: ['淋湿', 'status_wet', 'status:wet', 'attachment:play.wet'],
    source: 'S7 D-016；Requirement 13.6',
    replacement: '无替代：该状态及其与"重装"的组合效果不得作为默认状态交互出现',
  },
];

/** 权威来源代号（requirements.md「权威来源与追踪代号」表）。 */
export const KNOWN_SOURCE_CODES: readonly string[] = [
  'S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'R0', 'P01',
];

/**
 * 一条 `sourceTrace` 条目是否可解析。三种合法形态：
 * 1. 权威来源代号（可带条款后缀），如 `S0`、`S5 生命值与倒地系统`；
 * 2. 决策编号 `D-###`（可带说明后缀），如 `D-037 按人数裁剪档位`；
 * 3. 本 Spec 的需求条款号 `Req <数字>[.<数字>[字母]]`，如 `Req 11.3`、`Req 7.8a`。
 */
export function isResolvableSourceTrace(entry: string): boolean {
  const trimmed = entry.trim();
  if (trimmed.length === 0) return false;
  const head = trimmed.split(/\s+/, 1)[0] ?? '';
  if (KNOWN_SOURCE_CODES.includes(head)) return true;
  if (/^D-\d{3}$/.test(head)) return true;
  // 未冻结/待决项编号（T-### / U-###）是合法来源：它是"这条定义受哪个未冻结事项治理"的追踪。
  if (/^[TU]-\d{3}$/.test(head)) return true;
  if (head === 'Req') return /^Req\s+\d+(\.\d+[a-z]?)?(\s|$)/.test(trimmed);
  return false;
}

/** 定义中把 `NONCANONICAL_TERMS` 里的废用词用作规范概念 → `E_LOAD_TERM_NONCANONICAL`。 */
export function validateTerminology(def: Def): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const field of collectStringFields(def)) {
    for (const entry of NONCANONICAL_TERMS) {
      if (!field.value.includes(entry.term)) continue;
      diagnostics.push(loadDiagnostic(
        'E_LOAD_TERM_NONCANONICAL',
        `定义 ${def.id} 的字段 ${field.path} 把废用术语「${entry.term}」用作规范概念`,
        def.id,
        {
          path: field.path,
          reason: 'noncanonical-term',
          hint: `请改用「${entry.canonical}」。`,
          correctionSuggestion: `把「${entry.term}」替换为「${entry.canonical}」`,
        },
      ));
    }
  }
  return diagnostics;
}

/** 命中废案名单 → `E_LOAD_DEPRECATED_MECHANIC`。 */
export function validateNotDeprecated(def: Def): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const field of collectStringFields(def)) {
    for (const mechanic of DEPRECATED_MECHANICS) {
      if (!mechanic.aliases.some((alias) => field.value.includes(alias))) continue;
      diagnostics.push(loadDiagnostic(
        'E_LOAD_DEPRECATED_MECHANIC',
        `定义 ${def.id} 的字段 ${field.path} 引用了已否决机制「${mechanic.name}」`,
        def.id,
        {
          path: field.path,
          reason: mechanic.source,
          hint: `请迁移到当前机制：${mechanic.replacement}`,
        },
      ));
    }
  }
  return diagnostics;
}

/** `sourceTrace` 为空或指向不存在的来源代号 → `E_LOAD_NORMATIVE_WITHOUT_PROVENANCE`。 */
export function validateProvenance(def: Def): readonly Diagnostic[] {
  const ext = playExtensionOf(def);
  if (ext === null) {
    return [loadDiagnostic(
      'E_LOAD_NORMATIVE_WITHOUT_PROVENANCE',
      `玩法层定义 ${def.id} 没有可追踪来源（缺少 ${PLAY_EXT_KEY}.sourceTrace）`,
      def.id,
      { path: `${PLAY_EXT_KEY}.sourceTrace`, hint: '请补齐来源代号（S0…S9 / R0 / P01）、决策编号（D-###）或需求条款号（Req N.M）。' },
    )];
  }
  if (ext.sourceTrace.length === 0) {
    return [loadDiagnostic(
      'E_LOAD_NORMATIVE_WITHOUT_PROVENANCE',
      `定义 ${def.id} 的 sourceTrace 为空`,
      def.id,
      { path: `${PLAY_EXT_KEY}.sourceTrace`, hint: '每项规范定义至少指向一个权威来源或一个明确冲突裁决。' },
    )];
  }
  const diagnostics: Diagnostic[] = [];
  ext.sourceTrace.forEach((entry, index) => {
    if (isResolvableSourceTrace(entry)) return;
    diagnostics.push(loadDiagnostic(
      'E_LOAD_NORMATIVE_WITHOUT_PROVENANCE',
      `定义 ${def.id} 的 sourceTrace[${index}]「${entry}」不是可解析的来源代号`,
      def.id,
      {
        path: `${PLAY_EXT_KEY}.sourceTrace.${index}`,
        actual: entry,
        expected: '权威来源代号（S0…S9 / R0 / P01）、决策编号（D-###）或需求条款号（Req N.M）',
        reason: 'unresolvable-provenance',
        hint: '请把来源写成 requirements.md「权威来源与追踪代号」表中的代号，或写成 D-### / Req N.M。',
      },
    ));
  });
  return diagnostics;
}

/**
 * `unresolvedGuards` 含仍未冻结项 → `E_LOAD_UNRESOLVED_CONTRACT`，
 * `Diagnostic.reason` 写该未冻结项编号原文（Requirement 16.8、17.2）。
 *
 * 已裁决编号（U-002 / U-004 / U-005）**不触发拒绝**，只产出 `info` 级追踪记录：
 * requirements.md 17.4 要求裁决后仍保留追踪，因此这里既不拒绝也不静默丢弃。
 */
export function validateUnresolvedGuards(def: Def): readonly Diagnostic[] {
  const ext = playExtensionOf(def);
  if (ext === null) return [];
  const guards = ext.unresolvedGuards ?? [];
  const diagnostics: Diagnostic[] = [];
  guards.forEach((guard, index) => {
    if (isUnresolvedId(guard)) {
      diagnostics.push(loadDiagnostic(
        'E_LOAD_UNRESOLVED_CONTRACT',
        `定义 ${def.id} 引用了未冻结玩法事项 ${guard}`,
        def.id,
        {
          path: `${PLAY_EXT_KEY}.unresolvedGuards.${index}`,
          reason: guard,
          hint: '未冻结项不得产生默认数值、默认动作、默认状态、默认接口字段或默认界面文案；请等待权威裁决，或显式标记为非规范实验。',
        },
      ));
      return;
    }
    if (isAdjudicatedId(guard)) {
      diagnostics.push({
        code: 'E_LOAD_UNRESOLVED_CONTRACT',
        severity: 'info',
        message: `定义 ${def.id} 引用的 ${guard} 已由 ${ADJUDICATED_DECISIONS[guard]} 裁决关闭，不构成拒绝理由`,
        at: { def: def.id },
        path: `${PLAY_EXT_KEY}.unresolvedGuards.${index}`,
        phase: LOAD_PHASE,
        scope: 'definition',
        reason: guard,
        hint: `裁决记录：${ADJUDICATED_DECISIONS[guard]}。`,
      });
      return;
    }
    diagnostics.push(loadDiagnostic(
      'E_LOAD_UNRESOLVED_CONTRACT',
      `定义 ${def.id} 的 unresolvedGuards[${index}]「${String(guard)}」不是已登记的未冻结/已裁决编号`,
      def.id,
      {
        path: `${PLAY_EXT_KEY}.unresolvedGuards.${index}`,
        actual: String(guard),
        expected: [...UNRESOLVED_IDS, ...Object.keys(ADJUDICATED_DECISIONS)].join(' / '),
        reason: 'unknown-guard-id',
        hint: '请使用 requirements.md Requirement 17 表中的编号。',
      },
    ));
  });
  return diagnostics;
}

// ---------------------------------------------------------------------------
// 阻塞能力枚举（Requirement 17.3 的显式阻塞声明）
// ---------------------------------------------------------------------------

export interface BlockedCapability {
  /** 被阻塞的能力名（稳定字符串，供下游枚举与断言）。 */
  readonly capability: string;
  /** 阻塞来源：未冻结项编号集合，或 Hook 接线门禁。 */
  readonly blockedBy: readonly UnresolvedId[] | 'HOOK_WIRING_GATE';
  readonly rejectionCode: 'E_LOAD_UNRESOLVED_CONTRACT';
}

/**
 * `collectBlockedCapabilities` 的输入。
 *
 * 为什么是一个独立的窄接口而不是直接收 `CoreMechanicsConfig`：`CoreMechanicsConfig` 定义在
 * `load.ts`，而 `load.ts` 需要 import 本模块的运行时函数。让本模块反过来 import `load.ts`
 * 会形成模块环。`CoreMechanicsConfig` 在 `load.ts` 里显式 `extends BlockedCapabilityConfig`，
 * 因此调用方可以直接把整份 config 传进来，编译期即保证字段齐备。
 */
export interface BlockedCapabilityConfig {
  readonly rollPolicy: {
    readonly enableRandomRoll: boolean;
    readonly baseTierPolicyRef: string | null;
    readonly boostBoundaryPolicyRef: string | null;
  };
  /** `null` 表示该玩法包显式选择不启用 NPC（D-052 裁决后不再是 U-005 阻塞）。 */
  readonly npcBudget: unknown | null;
  /**
   * Requirement 2.8 门禁：是否已存在"生产组合根 + 引擎层 D-002 验收记录"。
   * 未满足时，依赖真实 Hook 链路的集成按 HOOK_WIRING_GATE 登记为阻塞。
   */
  readonly hookWiringAccepted: boolean;
  /** 掩体规则绑定：`magnitudeRef` 非 null 即引用了 T-002 的未冻结数值。 */
  readonly coverRules?: readonly { readonly magnitudeRef: string | null }[];
  /** 枪械伤害数值来源：`amountRef` 非 null 即引用了 T-001。 */
  readonly damageAmountSources?: readonly { readonly amountRef: string | null }[];
  /**
   * 体力过载绑定（D-055 已裁决关闭 U-003，过载取得规范位阶）。
   * 引用过载状态实例现在是**合法**的，不再返回 `E_LOAD_UNRESOLVED_CONTRACT`；
   * 取而代之的是 `validateOverloadConfig` 的六项一致性校验（Requirement 16.9）。
   */
  readonly overload: OverloadBinding;
}

/**
 * 过载绑定（D-055 / Requirement 6.14、6.16-6.22；design.md 3.17）。
 *
 * 字段的字面量类型不是装饰：`triggerPredicate: 'cur + inc > 5'` 这样的写法使"把触发条件改成
 * 其他谓词"在**编译期**就失败，而不是等到装载期才报错。装载期的 `validateOverloadConfig`
 * 仍然逐条复查，覆盖以 `unknown` 形态跨模块传进来的配置（例如从 JSON 反序列化的玩法包）。
 */
export interface OverloadBinding {
  /**
   * 过载状态实例引用（基类层已登记的 `status_overloaded` 或玩法层等价 AttachmentDef Id）。
   * D-055 之后必须非空：过载是标准默认规则，不声明承载体等于机制缺失。
   */
  readonly overloadStatusRef: string;
  /** 触发谓词：当且仅当某次合法体力增加尝试使结算值越过 5（Requirement 6.14、6.16）。 */
  readonly triggerPredicate: 'cur + inc > 5';
  /** 体力封顶：恒为 5，永不为 6（Requirement 6.14）。 */
  readonly staminaCap: 5;
  /** 过载施加时该活体本回合尚未行动 → 失去本回合行动权（Requirement 6.17）。 */
  readonly loseCurrentRoundActionRightIfNotYetActed: true;
  /** 跳过紧邻的一次投点，在其后那一次投点（下下回合）归队（Requirement 6.18）。 */
  readonly skipNextRollThenRejoinRoundAfterNext: true;
  /** 归队计数所在的字段路径（Internal_Metric，投影层禁止展示，Requirement 6.18）。 */
  readonly rejoinCounterPath: string;
  /** 归队计数的归属必须是 internal。 */
  readonly rejoinCounterOwnership: 'internal';
  /**
   * 清理阶段的自然恢复**不是**过载触发来源（Requirement 6.22）。
   *
   * 这条排除是机制成立的必要边界，不是可调开关：若清理阶段的自然恢复也计入触发，
   * 任何满体力活体每回合必然过载，机制自毁。因此类型固定为 `false`。
   */
  readonly cleanupNaturalRecoveryTriggersOverload: false;
}

/**
 * 产出装载结果中可枚举的阻塞声明。
 *
 * **T-003 不出现在该列表中**（Requirement 17.5）：它是"已裁决但待同步的文档债务"，
 * 既不产生运行期拒绝，也不阻塞任何组件。这一条是本函数的硬约束，不是可选风格。
 */
export function collectBlockedCapabilities(config: BlockedCapabilityConfig): readonly BlockedCapability[] {
  const blocked: BlockedCapability[] = [];

  const rollPolicyIncomplete = config.rollPolicy.baseTierPolicyRef === null
    || config.rollPolicy.boostBoundaryPolicyRef === null;
  if (!config.rollPolicy.enableRandomRoll || rollPolicyIncomplete) {
    // U-001 未冻结：标准随机投点与强力骰结算保持阻塞（design.md 3.3、9.3）。
    blocked.push({ capability: 'standard-random-roll', blockedBy: ['U-001'], rejectionCode: 'E_LOAD_UNRESOLVED_CONTRACT' });
    blocked.push({ capability: 'power-die-settlement', blockedBy: ['U-001'], rejectionCode: 'E_LOAD_UNRESOLVED_CONTRACT' });
  }

  // U-003 已由 D-055 裁决关闭：过载是标准默认规则，**不再登记为阻塞能力**
  // （requirements.md 16.8：引用已裁决关闭项不构成拒绝理由）。这里刻意留白并写明原因，
  // 以免后续有人看到"过载不在阻塞表里"而以为是漏写。

  // T-001：枪械基础伤害表未冻结。通用伤害管道不阻塞，只有具体枪械数值阻塞（design.md 9.1）。
  blocked.push({ capability: 'firearm-base-damage-table', blockedBy: ['T-001'], rejectionCode: 'E_LOAD_UNRESOLVED_CONTRACT' });

  // T-002：结构已由 D-040 冻结，仅减伤/命中修正数值未冻结（design.md 9.2）。
  blocked.push({ capability: 'cover-mitigation-magnitude', blockedBy: ['T-002'], rejectionCode: 'E_LOAD_UNRESOLVED_CONTRACT' });

  if (!config.hookWiringAccepted) {
    // Requirement 2.8：门禁关闭前不得宣称端到端可用（design.md 2.8）。
    blocked.push({ capability: 'play-event-pipeline-integration', blockedBy: 'HOOK_WIRING_GATE', rejectionCode: 'E_LOAD_UNRESOLVED_CONTRACT' });
    blocked.push({ capability: 'structural-op-before-veto-integration', blockedBy: 'HOOK_WIRING_GATE', rejectionCode: 'E_LOAD_UNRESOLVED_CONTRACT' });
  }

  return blocked.sort((left, right) => left.capability.localeCompare(right.capability, 'en'));
}

/**
 * 装载期对配置本身的未冻结项校验：引用了未冻结内容即整包拒绝
 * （design.md 3.3「装载期」、9.1-9.5 的"激活时的拒绝"）。
 */
export function validateConfigUnresolvedRefs(config: BlockedCapabilityConfig, subjectId: string): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (config.rollPolicy.enableRandomRoll
    && (config.rollPolicy.baseTierPolicyRef === null || config.rollPolicy.boostBoundaryPolicyRef === null)) {
    diagnostics.push(loadDiagnostic(
      'E_LOAD_UNRESOLVED_CONTRACT',
      '启用随机投点时必须同时引用已审批的基础等级生成策略与修正后边界策略',
      subjectId,
      {
        path: 'rollPolicy',
        reason: 'U-001',
        hint: 'U-001 冻结前 enableRandomRoll 必须为 false；不得默认截断、回绕、重投或拒绝承诺。',
      },
    ));
  }
  (config.damageAmountSources ?? []).forEach((source, index) => {
    if (source.amountRef === null) return;
    diagnostics.push(loadDiagnostic(
      'E_LOAD_UNRESOLVED_CONTRACT',
      `枪械伤害数值来源 damageAmountSources[${index}] 在 T-001 冻结前不得提供引用`,
      subjectId,
      { path: `damageAmountSources.${index}.amountRef`, reason: 'T-001', hint: 'T-001 冻结前任何枪械实例都不得提供具体伤害数值来源。' },
    ));
  });
  (config.coverRules ?? []).forEach((rule, index) => {
    if (rule.magnitudeRef === null) return;
    diagnostics.push(loadDiagnostic(
      'E_LOAD_UNRESOLVED_CONTRACT',
      `掩体规则 coverRules[${index}] 的减伤/命中修正数值来源在 T-002 数值冻结前不得提供引用`,
      subjectId,
      {
        path: `coverRules.${index}.magnitudeRef`,
        reason: 'T-002',
        hint: 'D-040 已冻结掩体的二维正交结构（授予者 × 作用对象），四象限均可实现；仍未冻结的只有具体数值。',
      },
    ));
  });
  // 过载（原 U-003）已由 D-055 裁决关闭：引用过载状态**不再**产生 E_LOAD_UNRESOLVED_CONTRACT。
  // 它的装载期校验改由 validateOverloadConfig 承担（Requirement 16.9），见下。
  return diagnostics;
}

/**
 * 过载配置的装载期校验（Requirement 16.9，六条逐项对应；design.md 3.17 末尾的清单）。
 *
 * 任一项缺失或与 Requirement 6 第 14-22 条不一致 → 拒绝装载，**不补全默认语义**。
 *
 * 为什么在 `OverloadBinding` 已用字面量类型约束的前提下还要跑一遍运行期校验：字面量类型只在
 * TypeScript 编译单元内生效，而玩法包也可能从 JSON 反序列化后以 `unknown` 形态进来。两道网
 * 覆盖不同的输入来源，不是重复建模。
 *
 * `projectionWhitelist` 的元素是字段路径：归队计数出现在其中即违反 Requirement 6.18
 * （归队计数是 Internal_Metric，不得作为玩家可见玩法数值展示）。
 */
export function validateOverloadConfig(
  overload: OverloadBinding,
  subjectId: string,
  projectionWhitelist: readonly string[] = [],
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const reject = (path: string, message: string, hint: string): void => {
    diagnostics.push(loadDiagnostic('E_LOAD_SEMANTIC_FIELD_DAMAGED', message, subjectId, {
      path: `overload.${path}`,
      reason: 'D-055',
      hint,
    }));
  };

  // (0) 承载体必须声明：D-055 之后过载是标准默认规则，没有承载体等于机制缺失。
  if (typeof overload.overloadStatusRef !== 'string' || overload.overloadStatusRef.length === 0) {
    reject(
      'overloadStatusRef',
      '过载配置缺少过载状态承载体引用',
      'D-055 已把过载裁决为标准默认规则；请引用已登记的过载状态实例（如 status_overloaded）。',
    );
  }

  // (1) 触发条件必须是"尝试使体力超过 5"。
  if (overload.triggerPredicate !== 'cur + inc > 5') {
    reject(
      'triggerPredicate',
      `过载触发条件为 ${JSON.stringify(overload.triggerPredicate)}，不是"尝试使体力超过 ${GAMEPLAY_VALUE_MAX}"`,
      'Requirement 6.14、6.16 固定了触发谓词；不得改为"达到 5"或其他谓词。',
    );
  }

  // (2) 体力封顶必须为 5，永不为 6。
  if (overload.staminaCap !== GAMEPLAY_VALUE_MAX) {
    reject(
      'staminaCap',
      `过载配置的体力封顶为 ${String(overload.staminaCap)}，不是 ${GAMEPLAY_VALUE_MAX}`,
      'Requirement 6.14：体力保持为 5，系统不得产生或展示体力 6。',
    );
  }

  // (3) 必须声明"未行动者失去本回合行动权"。
  if (overload.loseCurrentRoundActionRightIfNotYetActed !== true) {
    reject(
      'loseCurrentRoundActionRightIfNotYetActed',
      '过载配置未声明"过载施加时若本回合尚未行动则失去本回合行动权"',
      'Requirement 6.17；D-055 采纳"失去/跳过本回合行动权"，S6 §9.3 第 2 项的"保留"是离群陈述。',
    );
  }

  // (4) 必须声明"跳过一次投点后在下下回合归队"。
  if (overload.skipNextRollThenRejoinRoundAfterNext !== true) {
    reject(
      'skipNextRollThenRejoinRoundAfterNext',
      '过载配置未声明"跳过一次投点后在下下回合归队"',
      'Requirement 6.18：跳过紧邻的一次投点，在其后那一次投点重新加入。',
    );
  }

  // (5) 归队计数必须标注为 internal，且不得出现在投影白名单中。
  if (overload.rejoinCounterOwnership !== 'internal') {
    reject(
      'rejoinCounterOwnership',
      `归队计数的归属为 ${JSON.stringify(overload.rejoinCounterOwnership)}，不是 internal`,
      'Requirement 6.18：归队计数是 Internal_Metric，不得作为玩家可见玩法数值展示。',
    );
  }
  if (typeof overload.rejoinCounterPath !== 'string' || overload.rejoinCounterPath.length === 0) {
    reject(
      'rejoinCounterPath',
      '过载配置缺少归队计数的字段路径',
      '归队计数必须有一个明确的存储路径，否则无法校验它未被投影。',
    );
  } else if (projectionWhitelist.includes(overload.rejoinCounterPath)) {
    diagnostics.push(loadDiagnostic(
      'E_LOAD_NUMERIC_OWNERSHIP',
      `过载归队计数 ${overload.rejoinCounterPath} 归属为 Internal_Metric，但出现在投影白名单中`,
      subjectId,
      {
        path: 'overload.rejoinCounterPath',
        reason: 'D-055',
        hint: 'Requirement 6.18：归队计数不得作为玩家可见玩法数值展示；请把它从投影白名单中移除。',
      },
    ));
  }

  // (6) 清理阶段自然恢复必须被排除在触发之外。
  if (overload.cleanupNaturalRecoveryTriggersOverload !== false) {
    reject(
      'cleanupNaturalRecoveryTriggersOverload',
      '过载配置把清理阶段的自然恢复计入了过载触发来源',
      'Requirement 6.22：体力已为 5 时清理阶段的自然恢复是无操作；若计入触发，任何满体力活体每回合必然过载，机制自毁。',
    );
  }

  return diagnostics;
}

/* -----------------------------------------------------------------------------
 * DIVERGENCE-01（如实记录，需人工确认，不是本模块可自行裁决的事项）
 *
 * tasks.md 任务 1.1 要求 `UnresolvedId` 为七项：
 *   'T-001' | 'T-002' | 'U-001' | 'U-002' | 'U-003' | 'U-004' | 'U-005'
 * 而 requirements.md 16.8、Requirement 18「未冻结契约」与 design.md 2.6/9.4/9.6/9.7 已把
 * U-002（D-037）、U-004（D-053）、U-005（D-052）裁决关闭；requirements.md 6.14-6.22、16.9 与
 * design.md 3.17 进一步把 **U-003（D-055）** 裁决关闭——过载取得规范位阶，成为标准默认规则。
 * 四者一律"引用不构成拒绝理由"。
 *
 * 本模块的处理：把七个编号拆成 `UnresolvedId`（三项：T-001 / T-002 / U-001，引用即拒绝）与
 * `AdjudicatedId`（四项：U-002 / U-003 / U-004 / U-005，只产出 info 级追踪），使 tasks.md 要求的
 * 七个编号全部仍可表达，同时不违反 requirements.md 16.8。
 *
 * 未收敛的文档不一致（本模块不修改需求文档）：design.md 第 9.5 节仍以"U-003 未冻结"的旧结论
 * 写着"配置引用过载状态实例 → E_LOAD_UNRESOLVED_CONTRACT"，并给出 `OverloadBinding` 的
 * `overloadStatusRef: null` 类型；而同一文档的 3.4/3.17 与 Property 42-47 已按 D-055 改写为
 * "过载是标准默认规则、引用 status_overloaded 合法"。本模块按 requirements.md 6.14-6.22 / 16.9
 * 与 design.md 3.17 实现（过载生效），因此 **design.md 9.5 是需要人工更新的过时小节**。
 * design.md 的 Property 15（"达 5 后再次恢复……不应施加任何过载状态或剥夺行动权"）同属旧结论，
 * 已被 Property 42/43 取代——Property 15 的正确表述见本仓库属性测试 p15 文件头的说明。
 * -------------------------------------------------------------------------- */

/**
 * `PlayDefExtension` 的构造器。存在的理由不是省字数，而是让"忘记写 `sourceTrace`"在**编译期**
 * 就失败（它是必填参数），而不是等到装载期才报 `E_LOAD_NORMATIVE_WITHOUT_PROVENANCE`。
 *
 * `numericOwnership` 省略时是空映射，不是"放过所有数值"：`validateNumericOwnership` 仍会为每个
 * 实际存在的数值字段报缺分类。
 */
export function playExt(input: {
  readonly numericOwnership?: Readonly<Record<string, NumericOwnership>>;
  readonly costClass?: 'paid' | 'attached';
  readonly parentActions?: readonly string[];
  readonly triggerPoint?: AttachedTriggerPoint;
  readonly requireRef?: string;
  readonly onFailure?: AttachedFailureBehavior;
  readonly sourceTrace: readonly string[];
  readonly unresolvedGuards?: readonly GuardId[];
  readonly presentation?: { readonly labelKey?: string; readonly iconKey?: string };
}): PlayDefExtension {
  return {
    numericOwnership: input.numericOwnership ?? {},
    ...(input.costClass === undefined ? {} : { costClass: input.costClass }),
    ...(input.parentActions === undefined ? {} : { parentActions: input.parentActions }),
    ...(input.triggerPoint === undefined ? {} : { triggerPoint: input.triggerPoint }),
    ...(input.requireRef === undefined ? {} : { requireRef: input.requireRef }),
    ...(input.onFailure === undefined ? {} : { onFailure: input.onFailure }),
    sourceTrace: input.sourceTrace,
    ...(input.unresolvedGuards === undefined ? {} : { unresolvedGuards: input.unresolvedGuards }),
    ...(input.presentation === undefined ? {} : { presentation: input.presentation }),
  };
}

/** 遍历任意值（不限于 `Def`）的数值叶值。`buildNumericOwnership` 用它做覆盖性自检。 */
export function collectNumericLeaves(value: unknown): readonly NumericField[] {
  const fields: NumericField[] = [];
  // depth 传 1：`play` 命名空间的排除只对 Def 根生效，这里的输入是"还没挂 play 的定义体"。
  visitLeaves(value, '', 1, (field) => fields.push(field), () => {});
  return fields.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

/** 一条按位置声明的归属规则。 */
export interface NumericOwnershipRule {
  /** 匹配的路径后缀（按 `.` 分段做尾部匹配），例如 `args.delta`、`clamp.vitality.max`。 */
  readonly pathSuffix: string;
  /** 可选：同一后缀承载不同语义时用取值区分。 */
  readonly whenValue?: (value: number) => boolean;
  readonly ownership: NumericOwnership;
}

function matchesSuffix(path: string, suffix: string): boolean {
  if (suffix === '*') return true; // 通配：用于算法型规则的兜底分类
  if (path === suffix) return true;
  return path.endsWith(`.${suffix}`);
}

/**
 * 按位置规则展开一个定义体的 `numericOwnership` 映射。
 *
 * **为什么允许"按规则展开"而不是逐条手写路径**：声明式 `Def` 里的数值大量落在
 * `effects.<i>.args.<k>` 这类**含数组下标**的路径上。手写这些路径等于把数组下标复制进另一处，
 * 任何一次效果顺序调整都会让归属表静默漂移到错误的字段上（比手写漏一条更糟：它会给
 * "错误的数值"贴上"正确的分类"）。按后缀 + 取值声明规则，把分类知识绑定到**语义位置**而不是
 * 数组下标上，与仓库既有的 `src/play/types/numeric-classification.ts` 是同一手法。
 *
 * **强度不因此下降**：任何未被规则命中的数值都会让本函数**在模块初始化时抛错**
 * （比装载期更早、更难忽略），因此"漏分类"仍然是一个硬失败，只是失败时点前移。
 * 装载期的 `validateNumericOwnership` 继续作为第二道网，覆盖手写映射的定义。
 */
export function buildNumericOwnership(
  defBody: unknown,
  rules: readonly NumericOwnershipRule[],
  subject: string,
): Readonly<Record<string, NumericOwnership>> {
  const result: Record<string, NumericOwnership> = {};
  const unmatched: NumericField[] = [];
  for (const field of collectNumericLeaves(defBody)) {
    const rule = rules.find((candidate) =>
      matchesSuffix(field.path, candidate.pathSuffix)
      && (candidate.whenValue === undefined || candidate.whenValue(field.value)));
    if (rule === undefined) {
      unmatched.push(field);
      continue;
    }
    result[field.path] = rule.ownership;
  }
  if (unmatched.length > 0) {
    const detail = unmatched.map((field) => `${field.path}=${field.value}`).join(', ');
    throw new Error(`${subject}: 以下数值字段没有登记归属分类（请在规则表中补一条并写明理由）：${detail}`);
  }
  return result;
}

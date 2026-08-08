/**
 * 玩法层数值归属登记表。
 *
 * 本文件是 `src/play/profiles/**` 内每一个数字叶值的**显式分类来源**。此前这套判定散落在
 * `__tests__/profile-field-ownership.test.ts` 的两个私有 Set 里：分类只存在于测试代码中，
 * profile 本身没有任何可追踪的归属声明，且 `delta` 被整体豁免为内部度量——这意味着
 * `prop.add` 的伤害幅度可以写成任意大小而不触发 1-5 校验。把登记表提升为生产模块并给每条
 * 规则配上理由与来源，是为了让"数值归属"成为可被引用、可被证伪的契约，而不是测试的副作用。
 *
 * 分类取自 `.kiro/specs/l2-base-layer-spec/design.md` 的 `Parameter_Field.classification`
 * 四分法；范围规则取自 `docs/L0_规范宪法.md` 四·4.2（玩家可见数值严格限制在 1-5，
 * 内部数值例外）。
 */

/** L2 `Parameter_Field.classification` 的四种合法归属。 */
export type NumericClassification =
  | 'Gameplay_Value'
  | 'Structural_Bound'
  | 'Constitutional_Constant'
  | 'Internal_Metric';

/** 玩家可见玩法数值的宪法刻度。 */
export const PLAYER_SCALE_MIN = 1;
export const PLAYER_SCALE_MAX = 5;

/** 一个数字叶值在文档中的位置。 */
export interface NumericSite {
  /** 该数字所在成员的键名；数组元素沿用其容器的键名。 */
  readonly key: string;
  /** 该数字的直接父对象；数组元素的父对象是数组的容器对象。 */
  readonly parent: Readonly<Record<string, unknown>> | undefined;
  /** 从 profile 根开始的 JSON 指针式路径，如 `/actions/0/effects/0/delta`。 */
  readonly path: string;
  readonly value: number;
}

/** 一条归属规则的判定结果。 */
export interface NumericRuling {
  readonly classification: NumericClassification;
  /** 该分类为何成立；出现在诊断里，避免"为了让测试过"而改分类。 */
  readonly rationale: string;
  /** 判定依据的规范来源。 */
  readonly source: string;
  /**
   * 取值检查。命中分类后仍需通过该检查；返回 undefined 表示通过，
   * 返回字符串则作为诊断原因。
   */
  readonly check: (value: number) => string | undefined;
}

// ---------------------------------------------------------------------------
// 取值检查器
// ---------------------------------------------------------------------------

function isInteger(value: number): boolean {
  return Number.isInteger(value);
}

/** 玩家可见玩法数值：整数，且**绝对值**落在 1-5。负号只表示扣减方向，不放宽刻度。 */
function playerScale(value: number): string | undefined {
  if (!isInteger(value)) return `玩家可见玩法数值必须为整数，实际为 ${value}`;
  const magnitude = Math.abs(value);
  if (magnitude < PLAYER_SCALE_MIN || magnitude > PLAYER_SCALE_MAX) {
    return `玩家可见玩法数值的绝对值必须落在 ${PLAYER_SCALE_MIN}-${PLAYER_SCALE_MAX}，实际为 ${value}`;
  }
  return undefined;
}

/** 资源下限：只允许 0，表示资源可被耗尽。任何非 0 下限都必须改为玩法数值并说明理由。 */
function resourceFloor(value: number): string | undefined {
  if (!isInteger(value)) return `资源下限必须为整数，实际为 ${value}`;
  if (value < 0 || value > PLAYER_SCALE_MAX) {
    return `资源下限必须落在 0-${PLAYER_SCALE_MAX}，实际为 ${value}`;
  }
  return undefined;
}

/** 宪法上限：不得超过 5。 */
function constitutionalCap(value: number): string | undefined {
  if (!isInteger(value)) return `宪法上限必须为整数，实际为 ${value}`;
  if (value < 1 || value > PLAYER_SCALE_MAX) {
    return `宪法上限必须落在 1-${PLAYER_SCALE_MAX}，实际为 ${value}`;
  }
  return undefined;
}

/** 内部度量：只要求是有限整数，不受 1-5 约束。 */
function internalMetric(value: number): string | undefined {
  if (!Number.isFinite(value) || !isInteger(value)) {
    return `内部度量必须为有限整数，实际为 ${value}`;
  }
  return undefined;
}

/** 五并列序号：结构上限 5（宪法四·4.3）。 */
function parallelIndex(value: number): string | undefined {
  if (!isInteger(value)) return `并列序号必须为整数，实际为 ${value}`;
  if (value < 1 || value > PLAYER_SCALE_MAX) {
    return `并列序号必须落在 1-${PLAYER_SCALE_MAX}（五并列原则），实际为 ${value}`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 归属规则表
// ---------------------------------------------------------------------------

interface NumericRule extends NumericRuling {
  /** 成员键名，必须精确匹配。 */
  readonly key: string;
  /** 若给出，则规范化路径（数组下标折叠为 `*`）必须以该后缀结尾。 */
  readonly pathSuffix?: string;
}

const GAMEPLAY: Pick<NumericRuling, 'classification' | 'check'> = {
  classification: 'Gameplay_Value',
  check: playerScale,
};

const INTERNAL: Pick<NumericRuling, 'classification' | 'check'> = {
  classification: 'Internal_Metric',
  check: internalMetric,
};

const FLOOR: Pick<NumericRuling, 'classification' | 'check'> = {
  classification: 'Structural_Bound',
  check: resourceFloor,
};

const CAP: Pick<NumericRuling, 'classification' | 'check'> = {
  classification: 'Constitutional_Constant',
  check: constitutionalCap,
};

const L0 = 'docs/L0_规范宪法.md 四·4.2';
const L0_PARALLEL = 'docs/L0_规范宪法.md 四·4.3';
const L2_FIELD = '.kiro/specs/l2-base-layer-spec/design.md Parameter_Field.classification';

/**
 * 规则按顺序匹配，首个命中者生效。带 `pathSuffix` 的规则必须排在同名的通用规则之前——
 * `min` 与 `max` 在不同位置表达完全不同的语义（资源下限 / 宪法上限 / 耐久刻度），
 * 单靠键名无法区分。
 */
const NUMERIC_RULES: readonly NumericRule[] = [
  // ---- 资源下限与钳制边界 -------------------------------------------------
  {
    key: 'min',
    pathSuffix: '/clamp/min',
    ...FLOOR,
    rationale: '属性钳制下限，表示资源可被耗尽到 0，不是玩家在 1-5 刻度上选择的数值。',
    source: L2_FIELD,
  },
  {
    key: 'max',
    pathSuffix: '/clamp/max',
    ...CAP,
    rationale: '属性钳制上限，必须等于或低于宪法允许的可见刻度上限。',
    source: L0,
  },
  {
    key: 'max',
    pathSuffix: '/effects/onTurnEnd/max',
    ...CAP,
    rationale: '回合结束恢复的封顶值，等同于宪法可见刻度上限。',
    source: L0,
  },
  {
    key: 'max',
    ...GAMEPLAY,
    rationale: '耐久刻度是玩家可见的可消耗次数。',
    source: L0,
  },
  {
    key: 'min',
    ...GAMEPLAY,
    rationale: '动作前置条件的最小要求值是玩家可见的判定门槛。',
    source: L0,
  },
  {
    key: 'minimum',
    ...FLOOR,
    rationale: '效果结算的下限护栏，允许降到 0，表示效果被完全抵消。',
    source: L2_FIELD,
  },
  {
    key: 'minDamage',
    ...FLOOR,
    rationale: '减伤后的伤害下限护栏，允许为 0，表示伤害被完全吸收。',
    source: L2_FIELD,
  },

  // ---- 内部度量 -----------------------------------------------------------
  {
    key: 'priority',
    ...INTERNAL,
    rationale: '状态与行为的结算次序编号，不呈现给玩家，也不参与任何玩法刻度比较。',
    source: L2_FIELD,
  },
  {
    key: 'hpRange',
    ...INTERNAL,
    rationale: '损伤阶段的生命区间端点，包含耗尽值 0，是运行时分段而非玩家输入。',
    source: L2_FIELD,
  },
  {
    key: 'currentPatrolIndex',
    ...INTERNAL,
    rationale: '巡逻路径的运行时游标，是实现细节，不是玩法配置。',
    source: L2_FIELD,
  },
  {
    key: 'step',
    ...INTERNAL,
    rationale: '损毁序列的步骤序号，表示顺序而非强度。',
    source: L2_FIELD,
  },

  // ---- 结构边界 -----------------------------------------------------------
  {
    key: 'index',
    classification: 'Structural_Bound',
    check: parallelIndex,
    rationale: '座位序号是同时可选项的编号，受五并列原则约束。',
    source: L0_PARALLEL,
  },

  // ---- 骰面数（按 D-054 归为内部度量）------------------------------------
  {
    key: 'sides',
    ...INTERNAL,
    rationale:
      '按 D-054，原始骰点是内部瞬时比较值：它只作为判定输入，不作为玩家可见玩法数值持久展示。'
      + '受宪法 1-5 约束的是可见产出（伤害幅度 delta、AP、行动顺序），而不是骰面数本身。'
      + '因此这里不再要求骰面必须为 5——把内部刻度也压到 1-5 是审计早期的过度收紧。',
    source: 'src/play/action-turn/playpack.json props.resolutionPolicy.initiativeDie（D-054）',
  },

  // ---- 玩家可见玩法数值 ---------------------------------------------------
  {
    key: 'delta',
    ...GAMEPLAY,
    rationale:
      '属性增减幅度直接决定玩家看到的伤害或恢复量，是最典型的玩家可见玩法数值；'
      + '负号只表示扣减方向，刻度仍按绝对值受 1-5 约束。',
    source: L0,
  },
  {
    key: 'damageModifier',
    ...GAMEPLAY,
    rationale: '伤害修正量直接改变玩家看到的伤害数字。',
    source: L0,
  },
  {
    key: 'value',
    ...GAMEPLAY,
    rationale: '属性赋值目标值会成为玩家可见的属性读数。',
    source: L0,
  },
  {
    key: 'damage',
    ...GAMEPLAY,
    rationale: '伤害量是玩家可见的核心战斗刻度。',
    source: L0,
  },
  {
    key: 'damageOnCollision',
    ...GAMEPLAY,
    rationale: '碰撞伤害量是玩家可见的战斗刻度。',
    source: L0,
  },
  {
    key: 'reduction',
    ...GAMEPLAY,
    rationale: '减伤量直接改变玩家看到的受击数字。',
    source: L0,
  },
  {
    key: 'blockedDamage',
    ...GAMEPLAY,
    rationale: '被格挡的伤害量是玩家可见的防御刻度。',
    source: L0,
  },
  {
    key: 'ignoredDamage',
    ...GAMEPLAY,
    rationale: '被无视的伤害量是玩家可见的防御刻度。',
    source: L0,
  },
  {
    key: 'armorRating',
    ...GAMEPLAY,
    rationale: '装甲评级是玩家可见的防护刻度。',
    source: L0,
  },
  {
    key: 'shieldHp',
    ...GAMEPLAY,
    rationale: '盾牌独立血池是玩家可见的资源刻度。',
    source: L0,
  },
  {
    key: 'hitPoints',
    ...GAMEPLAY,
    rationale: '可交互部件的耐久点数是玩家可见的破坏刻度。',
    source: L0,
  },
  {
    key: 'maxTargets',
    ...GAMEPLAY,
    rationale:
      '一次攻击可同时命中的目标数是玩家在选择攻击方式时直接权衡的可见刻度，'
      + '同时受五并列原则约束（同时面对的目标不超过 5）。',
    source: L0,
  },
  {
    key: 'hp',
    ...GAMEPLAY,
    rationale: '生命值是玩家可见的核心资源刻度。',
    source: L0,
  },
  {
    key: 'maxHp',
    ...GAMEPLAY,
    rationale: '生命上限是玩家可见的核心资源刻度。',
    source: L0,
  },
  {
    key: 'healRate',
    ...GAMEPLAY,
    rationale: '每回合治疗量是玩家可见的恢复刻度。',
    source: L0,
  },
  {
    key: 'actionPoints',
    ...GAMEPLAY,
    rationale: 'NPC 每轮可用的行动点数是玩家在对抗时可推算的可见刻度（D-052）。',
    source: 'docs/L3_玩法层/01_行动轮与体力博弈系统.md §9b.2',
  },
  {
    key: 'staminaMax',
    ...GAMEPLAY,
    rationale: 'NPC 体力上限决定玩家把它压到过载所需的弱点命中次数，是可见的博弈刻度（D-052）。',
    source: 'docs/L3_玩法层/01_行动轮与体力博弈系统.md §9b.2',
  },
  {
    key: 'initialStamina',
    ...FLOOR,
    rationale: 'NPC 开局体力是资源起点，允许为 0，不是玩家在 1-5 刻度上选择的数值（D-052）。',
    source: 'docs/L3_玩法层/01_行动轮与体力博弈系统.md §9b.2',
  },
  {
    key: 'amount',
    ...GAMEPLAY,
    rationale: '恢复量是玩家可见的资源刻度。',
    source: L0,
  },
  {
    key: 'apCost',
    ...GAMEPLAY,
    rationale: '行动点成本是玩家在决策时直接权衡的可见刻度。',
    source: L0,
  },
  {
    key: 'accessibleApCost',
    ...GAMEPLAY,
    rationale: '访问货舱的行动点成本是玩家可见的成本刻度。',
    source: L0,
  },
  {
    key: 'cost',
    ...GAMEPLAY,
    rationale: '动作成本是玩家可见的成本刻度。',
    source: L0,
  },
  {
    key: 'ammoCost',
    ...GAMEPLAY,
    rationale: '弹药消耗量是玩家可见的资源刻度。',
    source: L0,
  },
  {
    key: 'capacity',
    ...GAMEPLAY,
    rationale: '货舱容量是玩家可见的槽位刻度。',
    source: L0,
  },
  {
    key: 'volume',
    ...GAMEPLAY,
    rationale: '体积占格是玩家可见的携带刻度。',
    source: L0,
  },
  {
    key: 'range',
    ...GAMEPLAY,
    rationale: '射程与移动距离是玩家可见的空间刻度。',
    source: L0,
  },
  {
    key: 'speed',
    ...GAMEPLAY,
    rationale: '速度是玩家可见的移动刻度。',
    source: L0,
  },
  {
    key: 'vision',
    ...GAMEPLAY,
    rationale: '视觉感知强度参与玩家可读的侦测判定。',
    source: L0,
  },
  {
    key: 'hearing',
    ...GAMEPLAY,
    rationale: '听觉感知强度参与玩家可读的侦测判定。',
    source: L0,
  },
  {
    key: 'alertThreshold',
    ...GAMEPLAY,
    rationale: '警觉阈值与感知强度在同一刻度上比较，必须共用玩家可见刻度。',
    source: L0,
  },
  {
    key: 'threshold',
    ...GAMEPLAY,
    rationale: '触发阈值与其比较对象在同一玩家可见刻度上。',
    source: L0,
  },
  {
    key: 'duration',
    ...GAMEPLAY,
    rationale: '状态与效果的持续回合数是玩家排布行动时可见的刻度。',
    source: L0,
  },
  {
    key: 'durationTurns',
    ...GAMEPLAY,
    rationale: '与 duration 同义的持续回合数；同一概念不得因字段拼写不同而改变归属。',
    source: L0,
  },
  {
    key: 'turns',
    ...GAMEPLAY,
    rationale: '解除条件的回合数是玩家可见的持续刻度。',
    source: L0,
  },
];

// ---------------------------------------------------------------------------
// 分类入口
// ---------------------------------------------------------------------------

/** 概率型字段的键名形态；这类字段一律按玩家可见刻度处理，使小数概率被直接拒绝。 */
const PROBABILITY_KEY = /^(?:probability|.*(?:Chance|Probability))$/;

/** 把 `/actions/0/effects/1/delta` 规范化为 `/actions/*\/effects/*\/delta`，便于按位置匹配。 */
export function normalizeNumericPath(path: string): string {
  return path.replace(/\/\d+/g, '/*');
}

/**
 * 判定一个数字叶值的归属。返回 undefined 表示该字段没有登记归属——按 L2 需求 5.7，
 * 未分类的数值字段必须被拒绝，而不是默认按某一类放过。
 */
export function classifyNumericField(site: NumericSite): NumericRuling | undefined {
  const normalized = normalizeNumericPath(site.path);
  for (const rule of NUMERIC_RULES) {
    if (rule.key !== site.key) continue;
    if (rule.pathSuffix !== undefined && !normalized.endsWith(rule.pathSuffix)) continue;
    return rule;
  }
  if (PROBABILITY_KEY.test(site.key)) {
    return {
      ...GAMEPLAY,
      rationale: '概率字段必须表达为 1-5 的骰点门槛，不得使用小数或百分比。',
      source: L0,
    };
  }
  return undefined;
}

/** 已登记的键名全集，供测试断言登记表覆盖了 profile 树里出现的每一个数字键。 */
export function registeredNumericKeys(): readonly string[] {
  return [...new Set(NUMERIC_RULES.map((rule) => rule.key))].sort((left, right) =>
    left.localeCompare(right, 'en'));
}

/** 一条数值归属诊断。 */
export interface NumericFinding {
  readonly path: string;
  readonly key: string;
  readonly value: number;
  readonly classification: NumericClassification | 'Unclassified';
  readonly reason: string;
}

/** 遍历任意 JSON 值，对每个数字叶值回调一次。数组元素沿用容器键名与容器父对象。 */
export function visitNumericSites(
  value: unknown,
  visitor: (site: NumericSite) => void,
  path = '',
  key = '',
  parent: Readonly<Record<string, unknown>> | undefined = undefined,
): void {
  if (typeof value === 'number') {
    visitor({ key, parent, path, value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitNumericSites(entry, visitor, `${path}/${index}`, key, parent));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const record = value as Readonly<Record<string, unknown>>;
  for (const [childKey, child] of Object.entries(record)) {
    visitNumericSites(child, visitor, `${path}/${childKey}`, childKey, record);
  }
}

/**
 * 审计一个 profile 文档内所有数字叶值的归属与取值。
 * 返回全部诊断（未分类 + 越界），顺序按 JSON 路径稳定排序。
 */
export function auditNumericOwnership(document: unknown): readonly NumericFinding[] {
  const findings: NumericFinding[] = [];
  visitNumericSites(document, (site) => {
    const ruling = classifyNumericField(site);
    if (ruling === undefined) {
      findings.push({
        path: site.path,
        key: site.key,
        value: site.value,
        classification: 'Unclassified',
        reason: `字段 ${site.key} 没有登记数值归属；请在 numeric-classification.ts 中登记并写明理由与来源`,
      });
      return;
    }
    const problem = ruling.check(site.value);
    if (problem !== undefined) {
      findings.push({
        path: site.path,
        key: site.key,
        value: site.value,
        classification: ruling.classification,
        reason: `${problem}（归属 ${ruling.classification}：${ruling.rationale}）`,
      });
    }
  });
  return findings.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

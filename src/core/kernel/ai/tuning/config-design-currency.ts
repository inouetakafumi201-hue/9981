/**
 * 费目表可序列化配置（Task 1/2）。
 *
 * 设计货币的费目表从「硬编码 DesignCurrencyEntry[]」迁为可序列化 JSON，让 agent
 * 能读、能在受限范围内写。核心语义锚（deathAnchor/lethalWindow/exhaustionAnchor）
 * 锁死、不归 agent 调；普通费目的 unit 带 allowedRange + step，且标记 playerVisible
 * 供禁碰判定（playerVisible:true 的参数禁碰）。
 *
 * 数据面要与 `design-currency.ts` 的运行时求值对齐：这里定义纯数据结构与加载/校验，
 * 求值语义仍由 design-currency 消费（见 scoreDesignCurrency 的配置注入改造）。
 */
/** 与 value.ts 解耦的顶层可序列化 Value 视图（配置里只用得到 number/string/boolean 谓词表达式，实际谓词由代码解释）。 */
import fs from 'node:fs';
import path from 'node:path';

/** 分水岭修正的来源键（与 design-currency.ts 的 adjustment.when 语义对应，这里以字符串谓词承载）。 */
export type PivotKind = 'lethalWindow' | 'exhaustionAnchor' | 'defeated';

/** 可序列化费目表（DesignCurrencyConfig）—— 见 design.md §数据模型。 */
export interface DesignCurrencyConfig {
  readonly version: number;
  readonly principles: {
    /** 最大绝对惩罚：血 1→0 等。锁死，不归 agent 调。 */
    readonly deathAnchor: number;
    /** 致死窗口：值 <= 此值触发死亡锚。锁死（核心语义）。 */
    readonly lethalWindow: number;
    /** 资源耗尽锚：关键资源压零的绝对惩罚。锁死。 */
    readonly exhaustionAnchor: number;
  };
  /** 原子费目表。 */
  readonly charges: readonly DesignCurrencyChargeConfig[];
}

/** 单个费目的可序列化配置。 */
export interface DesignCurrencyChargeConfig {
  /** 费目标识，如 `e:enemy.vitality`、`vitality`、`pool.ap`。 */
  readonly field: string;
  /** 单位当量（纯内部，不受玩家可见 1-5 铁律约束）。可调。 */
  readonly unit: number;
  /** 可调范围（含端点）。 */
  readonly tunableRange: readonly [number, number];
  /** 调参步长。 */
  readonly step: number;
  /** 分水岭修正（可选）：when 以字符串谓词表达（'<='/'<'/'=='/'true' 等），value 为绝对修正。 */
  readonly adjustment?: {
    readonly when: string;
    readonly value: number;
  };
  /** 稀缺性（可选）：值越低权重越高（边际）。 */
  readonly scarcity?: {
    readonly floor: number;
    readonly ceiling: number;
    readonly coefficient: number;
  };
  /** 倒地威胁约束（可选）：字段键为倒塌标记时适用（`<id>.defeated`）。 */
  readonly defeated?: {
    readonly when: string;
  };
  /** true → 玩家可见 → 禁碰（agent 不得修改）。 */
  readonly playerVisible: boolean;
  /** 人类可读费目说明。 */
  readonly description: string;
}

/** 序列化时剔除 undefined 字段，产出紧凑 JSON。 */
export function toCompactCharge(charge: DesignCurrencyChargeConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {
    field: charge.field,
    unit: charge.unit,
    tunableRange: [charge.tunableRange[0], charge.tunableRange[1]],
    step: charge.step,
    playerVisible: charge.playerVisible,
    description: charge.description,
  };
  if (charge.adjustment !== undefined) out.adjustment = { when: charge.adjustment.when, value: charge.adjustment.value };
  if (charge.scarcity !== undefined) out.scarcity = { floor: charge.scarcity.floor, ceiling: charge.scarcity.ceiling, coefficient: charge.scarcity.coefficient };
  if (charge.defeated !== undefined) out.defeated = { when: charge.defeated.when };
  return out;
}

/**
 * 把解析出的（可能含 undefined 字段的）JSON 对象规整为受控配置。
 * 抛错表示 JSON 结构不符合 schema——调用方（skill/registry）据此报「配置损坏」。
 */
export function parseDesignCurrencyConfig(raw: unknown): DesignCurrencyConfig {
  if (raw === null || typeof raw !== 'object') throw new Error('DesignCurrencyConfig must be an object');
  const root = raw as Record<string, unknown>;
  if (typeof root.version !== 'number' || !Number.isFinite(root.version)) throw new Error('config.version must be a finite number');
  const principles = root.principles as Record<string, unknown> | undefined;
  if (principles === null || typeof principles !== 'object') throw new Error('config.principles must be an object');
  for (const key of ['deathAnchor', 'lethalWindow', 'exhaustionAnchor'] as const) {
    const v = principles[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`config.principles.${key} must be a finite number`);
  }
  if (!Array.isArray(root.charges)) throw new Error('config.charges must be an array');
  const charges = root.charges.map((entry, index) => parseCharge(entry, index));
  return {
    version: root.version as number,
    principles: {
      deathAnchor: principles.deathAnchor as number,
      lethalWindow: principles.lethalWindow as number,
      exhaustionAnchor: principles.exhaustionAnchor as number,
    },
    charges,
  };
}

function parseCharge(raw: unknown, index: number): DesignCurrencyChargeConfig {
  if (raw === null || typeof raw !== 'object') throw new Error(`charges[${index}] must be an object`);
  const c = raw as Record<string, unknown>;
  if (typeof c.field !== 'string' || c.field.length === 0) throw new Error(`charges[${index}].field must be a non-empty string`);
  if (typeof c.unit !== 'number' || !Number.isFinite(c.unit)) throw new Error(`charges[${index}].unit must be a finite number`);
  const range = c.tunableRange;
  if (!Array.isArray(range) || range.length !== 2
    || typeof range[0] !== 'number' || !Number.isFinite(range[0])
    || typeof range[1] !== 'number' || !Number.isFinite(range[1])
    || range[0] > range[1]) {
    throw new Error(`charges[${index}].tunableRange must be [min, max] with min<=max`);
  }
  if (typeof c.step !== 'number' || !Number.isFinite(c.step) || c.step <= 0) {
    throw new Error(`charges[${index}].step must be a positive finite number`);
  }
  if (typeof c.playerVisible !== 'boolean') throw new Error(`charges[${index}].playerVisible must be a boolean`);
  if (typeof c.description !== 'string') throw new Error(`charges[${index}].description must be a string`);

  const out: DesignCurrencyChargeConfig = {
    field: c.field as string,
    unit: c.unit as number,
    tunableRange: [range[0] as number, range[1] as number],
    step: c.step as number,
    playerVisible: c.playerVisible as boolean,
    description: c.description as string,
    ...(c.adjustment !== undefined ? { adjustment: parseAdjustment(c.adjustment, index) } : {}),
    ...(c.scarcity !== undefined ? { scarcity: parseScarcity(c.scarcity, index) } : {}),
    ...(c.defeated !== undefined ? { defeated: parseDefeated(c.defeated, index) } : {}),
  };
  return out;
}

function parseAdjustment(raw: unknown, index: number): DesignCurrencyChargeConfig['adjustment'] {
  const adj = raw as Record<string, unknown>;
  if (typeof adj.when !== 'string' || typeof adj.value !== 'number' || !Number.isFinite(adj.value)) {
    throw new Error(`charges[${index}].adjustment must have string when and finite value`);
  }
  return { when: adj.when, value: adj.value };
}

function parseScarcity(raw: unknown, index: number): DesignCurrencyChargeConfig['scarcity'] {
  const s = raw as Record<string, unknown>;
  if (typeof s.floor !== 'number' || typeof s.ceiling !== 'number' || typeof s.coefficient !== 'number'
    || !Number.isFinite(s.floor) || !Number.isFinite(s.ceiling) || !Number.isFinite(s.coefficient)
    || s.coefficient <= 0) {
    throw new Error(`charges[${index}].scarcity must have finite floor/ceiling and positive coefficient`);
  }
  return { floor: s.floor, ceiling: s.ceiling, coefficient: s.coefficient };
}

function parseDefeated(raw: unknown, index: number): DesignCurrencyChargeConfig['defeated'] {
  const d = raw as Record<string, unknown>;
  if (typeof d.when !== 'string') throw new Error(`charges[${index}].defeated.when must be a string`);
  return { when: d.when };
}

/** 从磁盘加载并校验配置。缺文件/损坏抛带路径错误。 */
export function loadDesignCurrencyConfig(filePath: string): DesignCurrencyConfig {
  const text = fs.readFileSync(filePath, 'utf8');
  if (text.trim().length === 0) throw new Error(`DesignCurrencyConfig file is empty: ${filePath}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`DesignCurrencyConfig JSON parse failed at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseDesignCurrencyConfig(parsed);
}

/** 把配置写回磁盘（紧凑 JSON，保留版本）。 */
export function saveDesignCurrencyConfig(filePath: string, config: DesignCurrencyConfig): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    version: config.version,
    principles: { ...config.principles },
    charges: config.charges.map((charge) => toCompactCharge(charge)),
  };
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/**
 * 默认费目配置 —— 与 `design-currency.ts` 的既有硬编码 `DESIGN_CURRENCY_CHARGES` /
 * `DESIGN_CURRENCY_PRINCIPLES` 完全对应（回归红线：默认值不变）。
 *
 * 调参路径读取 JSON 配置；未装载时（组合根/普通决策）用此默认装配，保证既有决策语义不变。
 */
export function defaultDesignCurrencyConfig(): DesignCurrencyConfig {
  return {
    version: 1,
    principles: { deathAnchor: -10, lethalWindow: 4, exhaustionAnchor: -6 },
    charges: [
      {
        field: 'vitality',
        // 默认当量 = lethalWindow(4)；玩家可见（血是 1-5 玩家值）→ 禁碰。
        unit: 4,
        tunableRange: [1, 8],
        step: 0.5,
        adjustment: { when: '<=4', value: -10 },
        scarcity: { floor: 1, ceiling: 5, coefficient: 0.2 },
        playerVisible: true,
        description: '自身生命值。值越低越该保，压进致死窗口给最大绝对惩罚。',
      },
      {
        field: 'heal',
        unit: 3,
        tunableRange: [1, 8],
        step: 0.5,
        playerVisible: false,
        description: '治疗量。健康恢复一点点的内部定价。',
      },
      {
        field: 'E',
        unit: 2,
        tunableRange: [1, 8],
        step: 0.5,
        playerVisible: false,
        description: '攻击力（武器/装备）。越强越有助于把目标打进击杀窗口。',
      },
      {
        field: 'range',
        unit: 1,
        tunableRange: [1, 8],
        step: 0.5,
        playerVisible: false,
        description: '移动/探索范围。可到达资源节点为价值。',
      },
      {
        field: 'e:enemy.vitality',
        unit: 5,
        tunableRange: [1, 10],
        step: 0.5,
        adjustment: { when: '<=0', value: 10 },
        scarcity: { floor: 1, ceiling: 5, coefficient: 0.5 },
        defeated: { when: '==1' },
        playerVisible: false,
        description: '敌方生命值（进攻向）。敌方越残血、击杀那刀越值钱；已倒地未终结则换悬着惩罚。',
      },
      {
        field: 'pool.ap',
        unit: 2,
        tunableRange: [1, 8],
        step: 0.5,
        adjustment: { when: '<=0', value: -6 },
        playerVisible: false,
        description: '行动点预算。保有 AP 即保有行动机会，压零会自断后路。',
      },
      {
        field: 'E',
        unit: 1,
        tunableRange: [1, 8],
        step: 0.5,
        scarcity: { floor: 1, ceiling: 5, coefficient: 0.4 },
        playerVisible: false,
        description: '武器等级（装备 E 字段）。越强武器对进攻促进越大。',
      },
      {
        field: 'pool.stamina',
        unit: 1,
        tunableRange: [1, 8],
        step: 0.5,
        adjustment: { when: '<=0', value: -6 },
        playerVisible: false,
        description: '体力（清醒值）。压零会自断强骰/处决机会。',
      },
    ],
  };
}

/** 从既有 `design-currency.ts` 硬编码表生成可序列化配置（迁移辅助）。 */
export function configFromLegacyDefaults(): DesignCurrencyConfig {
  return defaultDesignCurrencyConfig();
}

/**
 * 设计货币「可调费目运行时」（Task 2/3/10）。
 *
 * 把 `design-currency.ts` 的硬编码费目表替换为「可注入配置 + 观测解析」两层：
 *  - observable → 运行时按配置的 when 谓词求值费目（分值语义与既有 `DESIGN_CURRENCY_CHARGES`
 *    完全一致，回归红线）；
 *  - observedNumber → 从 BeliefSlice 读取字段（沿用「key===field 或 endWith .field」法则）。
 *
 * 分值求值（拆分 + 稀缺 + 击杀奖励 + 倒地威胁）与 `design-currency.ts` 逐行对齐，
 * 只新增「分数构成（ScoreBreakdown）记录」，不改任何分值与语义。
 */
import type { BeliefSlice, KnownFact } from '../types';
import type { DesignCurrencyConfig, DesignCurrencyChargeConfig, PivotKind } from './config-design-currency';

/** ——— 与 `design-currency.ts` 对称的运行时解析 ——— */
export function observedNumber(slice: BeliefSlice, field: string): number | null {
  for (const [key, raw] of Object.entries(slice.visibleFacts)) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    if (key === field || key.endsWith(`.${field}`)) return raw;
  }
  for (const [key, fact] of Object.entries(slice.knownFacts)) {
    const value = (fact as KnownFact | undefined)?.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (key === field || key.endsWith(`.${field}`)) return value;
  }
  return null;
}

/** `e:enemy.vitality` → `e:enemy.defeated` 式倒塌威胁事实键。 */
export function defeatedFieldOf(field: string): string {
  const dot = field.lastIndexOf('.');
  const prefix = dot === -1 ? '' : field.slice(0, dot + 1);
  return `${prefix}defeated`;
}

/** 求值字符串谓词（'<=4' / '<=0' / '==1'）。非法谓词抛错（配置错误是显式故障，不静默）。 */
export function evalPredicate(expr: string, value: number): boolean {
  const m = /^\s*(<=|>=|<|>|==|!=)\s*(-?\d+(?:\.\d+)?)\s*$/.exec(expr);
  if (m === null) throw new Error(`Unsupported config predicate: "${expr}"`);
  const op = m[1];
  const rhs = Number(m[2]);
  switch (op) {
    case '<=': return value <= rhs;
    case '>=': return value >= rhs;
    case '<': return value < rhs;
    case '>': return value > rhs;
    case '==': return value === rhs;
    case '!=': return value !== rhs;
  }
  return false;
}

/** 单条费目在某个信念切片上的贡献明细。 */
export interface ScoreContribution {
  readonly feeItem: string;
  readonly contribution: number;
  readonly currentValue: number;
  readonly triggeredPivot?: PivotKind;
  readonly scarcityMultiplier?: number;
}

/** 分数构成：逐费目贡献之和恒等于 total。 */
export interface ScoreBreakdown {
  readonly total: number;
  readonly items: readonly ScoreContribution[];
}

/** 单费目求值：返回 contribution（含触发标记）。未观测返回 null。 */
export function scoreCharge(
  charge: DesignCurrencyChargeConfig,
  slice: BeliefSlice,
  principles: DesignCurrencyConfig['principles'],
): ScoreContribution | null {
  const value = observedNumber(slice, charge.field);
  if (value === null) return null;

  // 倒地威胁优先：命中即给绝对悬着惩罚并跳过常规当量（`<id>.defeated` 标记）。
  if (charge.defeated !== undefined) {
    const mark = observedNumber(slice, defeatedFieldOf(charge.field));
    if (mark !== null && evalPredicate(charge.defeated.when, mark)) {
      return {
        feeItem: charge.field,
        contribution: principles.deathAnchor,
        currentValue: value,
        triggeredPivot: 'defeated',
      };
    }
  }

  // 分水岭修正优先：命中即给绝对修正并跳过常规当量。
  if (charge.adjustment !== undefined && evalPredicate(charge.adjustment.when, value)) {
    return {
      feeItem: charge.field,
      contribution: charge.adjustment.value,
      currentValue: value,
      triggeredPivot: pivotOfCharge(charge),
    };
  }

  let contribution = charge.unit;
  let scarcityMultiplier: number | undefined;
  if (charge.scarcity !== undefined) {
    const s = charge.scarcity;
    const ratio = Math.max(0, Math.min(1, (value - s.floor) / (s.ceiling - s.floor)));
    const multiplier = 1 + (1 - ratio) * s.coefficient;
    contribution = charge.unit * multiplier;
    scarcityMultiplier = multiplier;
  }
  return {
    feeItem: charge.field,
    contribution,
    currentValue: value,
    ...(scarcityMultiplier === undefined ? {} : { scarcityMultiplier }),
  };
}

function pivotOfCharge(charge: DesignCurrencyChargeConfig): PivotKind {
  if (charge.adjustment?.when.includes('<=0') || charge.adjustment?.when.includes('<0')) return 'exhaustionAnchor';
  return 'lethalWindow';
}

/** 全量分数构成（不含未观测费目）。 */
export function scoreDesignCurrencyBreakdown(config: DesignCurrencyConfig, slice: BeliefSlice): ScoreBreakdown {
  let total = 0;
  const items: ScoreContribution[] = [];
  for (const charge of config.charges) {
    const c = scoreCharge(charge, slice, config.principles);
    if (c === null) continue;
    total += c.contribution;
    items.push(c);
  }
  return { total, items };
}

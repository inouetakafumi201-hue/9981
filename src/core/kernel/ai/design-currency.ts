/**
 * 设计货币（Design Currency）——内部估值原语，AI 决策的估值函数主入口。
 *
 * 这不是第二套玩家数值，而是 Internal_Metric：只作为 AI / 设计系统对
 * 「状态优劣」的评分依据，从不直接展示给玩家，不触碰 1–5 铁律。
 *
 * ## 架构：分数表 + 原则表（双层可扩展）
 *
 *  - **分数表**（DESIGN_CURRENCY_CHARGES）：每个原子费目一个固定当量，
 *    如 伤害 d 当量查表、一点生命当量、AP 当量。
 *  - **原则表**（DESIGN_CURRENCY_PRINCIPLES + 修正条件）：操控分数表。
 *    它不改分数本身，改的是「哪些状态触发怎样的修正」。当前已落地：
 *      * 死亡锚：生命/体力压到死亡窗口 → 绝对值惩罚（血 1→0 = -10）。
 *      * 分水岭：字段值 <= 存活阈值时为「致死窗口」，防御性修正。
 *      * 稀缺：高价值资源（生命/AP/体力）越少权重越高（边际）。
 *
 * ## 信念切片事实键
 *
 * KernelAIReadAdapter 把 `entities.<id>.props.*` 摊成 `<id>.<字段>` 放进
 * visibleFacts；pools（AP/体力）不在实体 props 上，而在 world.props.pools，
 * 需要通过 knownFacts 由感知/知识写入（本版以字段启发式兼容）。
 * 分数表对「确实观测到」的值计分；未观测一律不加减（未知不是零）。
 */

import type { BeliefSlice, EvaluationGateway, KnownFact } from './types.js';
import type { AIDecisionFacadeDependencies } from './facade.js';
import { FiniteEvaluationGuard } from './evaluation.js';

/** 一次「透过信念切片」的评分，只消费当前可见/已知的事实字段。 */
export interface DesignCurrencyEntry {
  /** 假设字段名（含「<id>.」前缀时按实体投影匹配；纯字段按后缀匹配）。 */
  readonly field: string;
  /** 该费目的单位当量（非 1–5，纯内部）。 */
  readonly unit: number;
  /** 可选：状态分水岭修正（死亡锚等）。 */
  readonly adjustment?: {
    /** 修正触发函数：cur 为当前字段值，返回是否触发。 */
    readonly when: (cur: number) => boolean;
    /** 触发后的绝对修正值。 */
    readonly value: number;
  };
  /** 稀缺性（可选）：值越低权重按此系数上调，建模「少越珍贵」。 */
  readonly scarcity?: { readonly floor: number; readonly ceiling: number; readonly coefficient: number };
}

/** 死亡锚（占位目标：血 1→0 为 -10），其余原则可继续增补。 */
export const DESIGN_CURRENCY_PRINCIPLES = {
  /** 死亡锚：最大绝对惩罚，覆盖几乎一切小额正收益。 */
  deathAnchor: -10,
  /** 存活窗口：值 <= 此值时视为「致死窗口」。 */
  lethalWindow: 4,
} as const;

/**
 * 打分细则：伤害 / 治疗 / 移动 / AP / 状态的常用维度（占位版）。
 * 这些是设计货币能立刻作用于的「玩家尝试」维度；更深的
 * 伤害档/DC 等尚待字段契约落定后再补（project 红线：不为拟合而生编分数）。
 */
export const DESIGN_CURRENCY_CHARGES: readonly DesignCurrencyEntry[] = [
  // 生命（vitality）：活体属性。死亡锚施加绝对值惩罚。
  {
    field: 'vitality',
    unit: DESIGN_CURRENCY_PRINCIPLES.lethalWindow,
    adjustment: {
      when: (cur) => cur <= DESIGN_CURRENCY_PRINCIPLES.lethalWindow,
      value: DESIGN_CURRENCY_PRINCIPLES.deathAnchor,
    },
    // 同一维单位，值越低单位越贵（稀缺：血越低越该保）。
    scarcity: { floor: 1, ceiling: 5, coefficient: 0.2 },
  },
  // 治疗（治疗量），健康恢复一点点（属内部单位）。
  {
    field: 'heal',
    unit: 3,
  },
  // 移动（可移动的节点距离），探索/资源可达为价值。
  {
    field: 'range',
    unit: 1,
  },
  // AP（回合预算）：保有 AP 即保有行动机会。
  {
    field: 'ap',
    unit: 2,
    adjustment: { when: (cur) => cur === 0, value: 0 }, // AP 空 = 动作机会清零，但非绝对
  },
  // 体力（清醒值）：强力骰 / 处决恢复的机会。
  {
    field: 'stamina',
    unit: 1,
  },
];

/** 求某字段在 BeliefSlice 里被观测到的第一个有效值（数值）。 */
function observedNumber(slice: BeliefSlice, field: string): number | null {
  // 真实投影：`<id>.<field>`；也兼容裸键。
  for (const [key, raw] of Object.entries(slice.visibleFacts)) {
    const base = key.slice(key.lastIndexOf('.') + 1);
    if (base !== field) continue;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  }
  for (const [key, fact] of Object.entries(slice.knownFacts)) {
    const base = key.slice(key.lastIndexOf('.') + 1);
    if (base !== field) continue;
    const value = (fact as KnownFact | undefined)?.value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * 计算当前信念切片的设计货币估值。
 *
 * 规则：
 *  - 逐费目求当量，未观测到该字段的费目不加减；
 *  - 分水岭修正（死亡锚）覆盖单位当量；
 *  - 稀缺系数对低值上调（亚线性）；但死亡锚是绝对负分，优先于一切。
 */
export function scoreDesignCurrency(context: { slice: BeliefSlice }): number {
  let v = 0;
  for (const entry of DESIGN_CURRENCY_CHARGES) {
    const value = observedNumber(context.slice, entry.field);
    if (value === null) continue; // 未知不打分

    // 死亡锚优先：一旦触发，直接给绝对负分并跳过其余（避免被边缘收益倒挂）。
    if (entry.adjustment !== undefined && entry.adjustment.when(value)) {
      v += entry.adjustment.value;
      continue;
    }

    let charge = entry.unit;
    if (entry.scarcity !== undefined) {
      const scarcity = entry.scarcity;
      const ratio = Math.max(0, Math.min(1, (value - scarcity.floor) / (scarcity.ceiling - scarcity.floor)));
      // 值越低越接近 0，稀缺系数使当量上调（这里简化为线性，随打磨调整）。
      charge += (1 - ratio) * scarcity.coefficient * entry.unit;
    }
    v += charge;
  }
  return v;
}

/**
 * 把设计货币接入 `EvaluationGateway` 的默认装配。
 *
 * 它把每个候选后继的信念切片换算成设计估值，走通 evaluate → guard → 剪枝。
 * 这是 AI 在生产决策链路消费设计货币的默认实现。
 */
export class DesignCurrencyGateway implements EvaluationGateway {
  evaluate(_actor: BeliefSlice['agent'], slice: BeliefSlice, _policy: unknown): unknown {
    return scoreDesignCurrency({ slice });
  }

  neutralFallback(_policy: unknown): number {
    return 0;
  }
}

/**
 * 把设计货币注入 AI 决策 Face 依赖的最小工厂。
 *
 * 组合根把缺了 `evaluationGateway`/`evaluationGuard` 的依赖传进来，这里补齐
 * 设计货币作为默认估值与有限守卫（其余读/提交等网关仍须由上层提供，这里
 * 不会替它们伪造实现）。返回的面依赖可直接喂给 `BoundedAIDecisionFacade`。
 */
export function composeDesignCurrencyFacade(deps: {
  readGateway: AIDecisionFacadeDependencies['readGateway'];
  behaviorGateway: AIDecisionFacadeDependencies['behaviorGateway'];
  planners: AIDecisionFacadeDependencies['planners'];
  commitGateway: AIDecisionFacadeDependencies['commitGateway'];
  searchSessions?: AIDecisionFacadeDependencies['searchSessions'];
}): AIDecisionFacadeDependencies {
  return {
    ...deps,
    evaluationGateway: new DesignCurrencyGateway(),
    evaluationGuard: new FiniteEvaluationGuard(),
  };
}

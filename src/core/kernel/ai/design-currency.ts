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
 *
 * ## 可调费目运行时（tuning 专项）
 *
 * 费目表已迁为可序列化 `DesignCurrencyConfig`（`tuning/config-design-currency.ts`）；
 * `scoreDesignCurrency` 用默认费目表求值（与既有硬编码语义逐行一致，回归红线），分数构成
 * 由 `tuning/runtime.ts` 的同一运行时产生。`DesignCurrencyGateway` 可注入调参后的配置——
 * 调参器改完 JSON 后注入新配置，真实决策立即按新表打分。
 */

import type { BeliefSlice, EvaluationGateway } from './types';
import type { AIDecisionFacadeDependencies } from './facade';
import { FiniteEvaluationGuard } from './evaluation';
import { defaultDesignCurrencyConfig, type DesignCurrencyConfig } from './tuning/config-design-currency';
import { scoreDesignCurrencyBreakdown } from './tuning/runtime';

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
  /**
   * 可选：倒地威胁费目结果。费目值为某实体（如敌方）当前「是否已倒地但未被终结」的标记
   * （`<id>.defeated` 型事实）。当它被观测到且命中时，把该费目当量换成绝对悬着惩罚（死亡锚），
   * 命令 AI 优先「令其长眠」把这具倒地的尸体移出战场，而不是继续打尸体（M9 终结语义）。
   */
  readonly defeated?: { readonly when: (mark: number) => boolean };
}

/** 死亡锚（占位目标：血 1→0 为 -10），其余原则可继续增补。 */
export const DESIGN_CURRENCY_PRINCIPLES = {
  /** 死亡锚：最大绝对惩罚，覆盖几乎一切小额正收益。 */
  deathAnchor: -10,
  /** 存活窗口：值 <= 此值时视为「致死窗口」。 */
  lethalWindow: 4,
  /** 资源耗尽锚：把关键资源（AP/体力）压零的绝对惩罚，命令 AI 绝不自断后路。 */
  exhaustionAnchor: -6,
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
  // 武器攻击力（E）：攻击力越高，把目标打进击杀窗口越划算——竞技武器价值真实进入分数表
  // （阶段4a/m8「更强者更优」的定价落点）。武器是 item（`i:sword.E`），不是实体。
  {
    field: 'E',
    unit: 2,
  },
  // 移动（可移动的节点距离），探索/资源可达为价值。
  {
    field: 'range',
    unit: 1,
  },
  // 敌方目标生命（e:enemy.vitality）：对称的「进攻」维度。目标越残血，把它打死的
  // 攻击直接收益越高——活体零血即被淘汰，是 AI 唯一能「终结一局」的直接杠杆。
  // 生命越高反而越要避开（打不死还白送反击机会），故这是单位当量表里方向相反的一行：
  // 目标生命越低、单位贡献越高，直到归零时的终止奖励。
  {
    field: 'e:enemy.vitality',
    // 敌方维度是"进攻"向：这个值的走向和自身 vitality 相反。自身 vitality 越高越好，敌方
    // vitality 越低越好。分值必须反映这个方向——值越接近 0 贡献越高，直到归零（击杀）给终止
    // 奖励。用正 unit + 低血量端稀缺：值越低当量越高，击杀由下方 adjustment 给对称奖励。
    unit: 5,
    // 敌方零血 = 击杀，是一次确定性终结，给对称的天花板奖励（正面，镜像自身死亡锚）。
    adjustment: { when: (cur) => cur <= 0, value: DESIGN_CURRENCY_PRINCIPLES.deathAnchor * -1 },
    // 敌方血越少，击杀那刀价值越接近满当量（补刀/终场动力）。
    scarcity: { floor: 1, ceiling: 5, coefficient: 0.5 },
    // M9：敌方带倒地威胁事实（`e:enemy.defeated`=1）而未终结时，击杀奖励不发放、换悬着
    // 惩罚，直到被「令其长眠」清除。这样 AI 面对「倒地敌人」唯一正确收敛是去终结它。
    defeated: { when: (mark) => mark === 1 },
  },
  // AP（回合预算）：保有 AP 即保有行动机会。真实场在 world.props.pools.ap.<scope>.real，
  // 经 read-adapter 的资源池投影实体化到实体 props `pool.ap`。压零 = 动作机会清零，绝对值负分。
  {
    field: 'pool.ap',
    unit: 2,
    adjustment: { when: (cur) => cur <= 0, value: DESIGN_CURRENCY_PRINCIPLES.exhaustionAnchor },
  },
  // 武器等级（E）：把「持有/靠近更强武器」记正分——越强的武器对进攻的促进越大，越到高档
  // 边际越贵（M8「更强者更优」/阶段4「拾取→更强→进攻」的估值落点，AI全对局能力规划 4.1/4.3）。
  // 字段匹配：read-adapter 把物品 Def 元数据投影成 `<id>.E`（如 `i:sword.E`），observedNumber
  // 按「键以 `.字段` 结尾」后缀匹配，裸「E」即可命中任意 `<id>.E`。武器族是唯一携带 E 级的事实，
  // 活体/资源池无 E 字段，不会误收；攻击动作本身不改数值、不因武器变伤害量（避免给同一动作拍两个
  // 行为），强武器的加成只体现在「装备该武器比空手/弱武器更优」的估值面。
  {
    field: 'E',
    unit: 1,
    scarcity: { floor: 1, ceiling: 5, coefficient: 0.4 },
  },
  // 体力（清醒值）：强力骰 / 处决恢复的机会。真实场在 world.props.pools.stamina.<scope>.real。
  // 压零 = 自断强骰/处决机会，绝对值负分（不亚于进入致死窗口）。
  {
    field: 'pool.stamina',
    unit: 1,
    adjustment: { when: (cur) => cur <= 0, value: DESIGN_CURRENCY_PRINCIPLES.exhaustionAnchor },
  },
];

/**
 * 计算当前信念切片的设计货币估值（默认费目配置，回归红线语义）。
 */
export function scoreDesignCurrency(context: { slice: BeliefSlice }): number {
  return scoreDesignCurrencyBreakdown(defaultDesignCurrencyConfig(), context.slice).total;
}

/** 分水岭修正的来源键。 */
export type PivotSource = 'lethalWindow' | 'exhaustionAnchor' | 'defeated';

/** 分数构成（ScoreBreakdown）：items 的 contribution 之和恒等于 total。 */
export interface ScoreContribution {
  readonly feeItem: string;
  readonly contribution: number;
  readonly currentValue: number;
  readonly triggeredPivot?: PivotSource;
  readonly scarcityMultiplier?: number;
}
export interface ScoreBreakdownInstance {
  readonly total: number;
  readonly items: readonly ScoreContribution[];
}

/**
 * 计算「分数构成」——每条费目贡献明细（含触发标记），供决策证据链与归因使用。
 *
 * 分值与 `scoreDesignCurrency` 完全一致（默认配置），回归红线由既有
 * design-currency*.test.ts 保证。
 */
export function scoreBreakdown(context: { slice: BeliefSlice }): ScoreBreakdownInstance {
  return scoreDesignCurrencyBreakdown(defaultDesignCurrencyConfig(), context.slice) as unknown as ScoreBreakdownInstance;
}

/**
 * 把设计货币接入 `EvaluationGateway` 的默认装配。
 *
 * 它把每个候选后继的信念切片换算成设计估值，走通 evaluate → guard → 剪枝。
 * 这是 AI 在生产决策链路消费设计货币的默认实现。可注入 `DesignCurrencyConfig`：
 * 不传时用默认费目表（既有硬编码语义，回归红线）；`ParameterTuner` 调参后把新配置
 * 注入这里，真实决策即按新表打分（调参真正生效的断点）。
 */
export class DesignCurrencyGateway implements EvaluationGateway {
  private readonly config: DesignCurrencyConfig;

  constructor(config: DesignCurrencyConfig = defaultDesignCurrencyConfig()) {
    this.config = config;
  }

  evaluate(_actor: BeliefSlice['agent'], slice: BeliefSlice, _policy: unknown): unknown {
    return scoreDesignCurrencyBreakdown(this.config, slice).total;
  }

  /** 计算分数构成（供决策证据链与归因，与 evaluate 同值）。 */
  breakdown(slice: BeliefSlice): ScoreBreakdownInstance {
    return scoreDesignCurrencyBreakdown(this.config, slice) as unknown as ScoreBreakdownInstance;
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

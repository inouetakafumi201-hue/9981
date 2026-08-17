/**
 * 行为断言（BehaviorAssertion）与注册表 + 执行引擎（Task 6/7）。
 *
 * 断言 = 世界快照 + 期望（shouldSelect/shouldNotSelect/scoreConstraints/pivotConstraints）。
 * AssertionRunner 从 setup 恢复世界 → 跑 facade.act → 取 DecisionTrace → 检查期望 → 产出违规清单。
 * golden 断言作为回归基准，供 RegressionGate 使用。
 */
import type { DecisionTrace } from './trace.js';
import type { WorldStateSnapshot } from './snapshot.js';

/** 断言期望条目。 */
export interface ScoreConstraint {
  readonly feeItem: string;
  readonly operator: '>' | '<' | '>=' | '<=';
  readonly value: number;
  readonly reason: string;
}
export interface PivotConstraint {
  readonly pivot: string;
  readonly shouldTrigger: boolean;
  readonly reason: string;
}

/** 行为断言：可复现世界快照 + 期望。 */
export interface BehaviorAssertion {
  readonly id: string;
  readonly category: string;
  readonly description: string;
  readonly setup: WorldStateSnapshot;
  readonly expect: {
    readonly shouldSelect?: string;
    readonly shouldNotSelect?: string[];
    readonly scoreConstraints?: ScoreConstraint[];
    readonly pivotConstraints?: PivotConstraint[];
  };
  readonly isGolden: boolean;
  /** 断言来源（曲线演进用）。 */
  readonly source: 'initial' | 'curated' | 'tuning-derived';
  readonly temperedByHuman?: boolean;
  /** 若由交互模式自然语言衍生，记录其临时前缀来源。 */
  readonly temporalFrom?: string;
}

/** 违规类型。 */
export type ViolationType = 'wrongSelection' | 'scoreConstraint' | 'pivotConstraint';

/** 一条违规。 */
export interface AssertionViolation {
  readonly type: ViolationType;
  readonly expected: string;
  readonly actual: string;
  readonly trace: DecisionTrace;
}

/** 断言执行结果。 */
export interface AssertionResult {
  readonly passed: boolean;
  readonly violations: readonly AssertionViolation[];
}

/** 断言执行依赖 —— 由宿主提供「如何在世界快照上跑一次决策」。 */
export interface AssertionRunContext {
  runRequest(serialized: string): { trace: DecisionTrace | null; error?: string };
}

const SCORE_OPS: Record<ScoreConstraint['operator'], (a: number, b: number) => boolean> = {
  '>': (a, b) => a > b,
  '<': (a, b) => a < b,
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
};

/** 检查某 ScoreBreakdown 是否满足一条分数约束（找该费目的 contribution）。 */
function checkScoreConstraint(
  breakdown: { items: readonly { feeItem: string; contribution: number }[] },
  constraint: ScoreConstraint,
): { satisfied: boolean; actual: number | null } {
  const item = breakdown.items.find((i) => i.feeItem === constraint.feeItem);
  const actual = item === undefined ? null : item.contribution;
  if (actual === null || item === undefined) return { satisfied: false, actual: null };
  return { satisfied: SCORE_OPS[constraint.operator](actual, constraint.value), actual };
}

/** 检查某 ScoreBreakdown 是否满足一条 pivot 约束（找该费目是否带 triggeredPivot）。 */
function checkPivotConstraint(
  breakdown: { items: readonly { feeItem: string; triggeredPivot?: string }[] },
  constraint: PivotConstraint,
): { satisfied: boolean; triggered: boolean } {
  const item = breakdown.items.find((i) => i.feeItem === constraint.pivot || (i.triggeredPivot !== undefined && i.triggeredPivot === constraint.pivot));
  const triggered = item !== undefined && (item.triggeredPivot === constraint.pivot || (item.triggeredPivot !== undefined && item.triggeredPivot === constraint.pivot));
  return { satisfied: triggered === constraint.shouldTrigger, triggered };
}

/**
 * 断言注册表：从 JSON 加载 / 保存断言，提供按类别 / golden 查询。
 * 行为与 schema 校验分离：构造函数注入 schema 校验回调（默认宽松，可换严格 schema）。
 */
export class BehaviorAssertionRegistry {
  private readonly assertions = new Map<string, BehaviorAssertion>();

  constructor(initial: readonly BehaviorAssertion[] = []) {
    for (const assertion of initial) this.add(assertion);
  }

  add(assertion: BehaviorAssertion): void {
    if (assertion.id.length === 0) throw new Error('Assertion id must be non-empty.');
    this.assertions.set(assertion.id, assertion);
  }

  get(id: string): BehaviorAssertion | undefined {
    return this.assertions.get(id);
  }

  getByCategory(category: string): BehaviorAssertion[] {
    return [...this.assertions.values()].filter((a) => a.category === category);
  }

  getGolden(): BehaviorAssertion[] {
    return [...this.assertions.values()].filter((a) => a.isGolden);
  }

  all(): BehaviorAssertion[] {
    return [...this.assertions.values()];
  }

  size(): number {
    return this.assertions.size;
  }

  /** 从 JSON 字符串批量加载（要求合法 schema）。 */
  loadFromJson(json: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      throw new Error(`Assertions JSON parse failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of list) {
      const assertion = parseAssertion(entry);
      this.add(assertion);
    }
  }

  /** 导出全部断言为 JSON 数组。 */
  exportToJson(): string {
    return JSON.stringify(this.all(), null, 2);
  }
}

/** 把文件（每个 JSON 是一个数组或单个对象）加载进注册表。 */
export function loadAssertionsJson(text: string): BehaviorAssertion[] {
  const registry = new BehaviorAssertionRegistry();
  registry.loadFromJson(text);
  return registry.all();
}

function parseAssertion(raw: unknown): BehaviorAssertion {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Assertion must be an object.');
  const a = raw as Record<string, unknown>;
  if (typeof a.id !== 'string' || a.id.length === 0) throw new Error('Assertion.id must be a non-empty string.');
  if (typeof a.category !== 'string') throw new Error(`Assertion ${a.id}.category must be a string.`);
  const setup = a.setup as Record<string, unknown> | undefined;
  if (setup === null || typeof setup !== 'object' || typeof setup.stateHash !== 'string' || typeof setup.serialized !== 'string') {
    throw new Error(`Assertion ${a.id}.setup must have stateHash and serialized strings.`);
  }
  const expect = a.expect as Record<string, unknown> | undefined;
  if (expect === null || typeof expect !== 'object') throw new Error(`Assertion ${a.id}.expect must be an object.`);
  return {
    id: a.id as string,
    category: a.category as string,
    description: typeof a.description === 'string' ? a.description : '',
    setup: { stateHash: setup.stateHash as string, serialized: setup.serialized as string },
    expect: parseExpect(expect),
    isGolden: a.isGolden === true,
    source: (a.source as BehaviorAssertion['source']) ?? 'initial',
    ...(typeof a.temperedByHuman === 'boolean' ? { temperedByHuman: a.temperedByHuman } : {}),
    ...(typeof a.temporalFrom === 'string' ? { temporalFrom: a.temporalFrom } : {}),
  };
}

function parseExpect(expect: Record<string, unknown>): BehaviorAssertion['expect'] {
  const result: {
    shouldSelect?: string;
    shouldNotSelect?: string[];
    scoreConstraints?: ScoreConstraint[];
    pivotConstraints?: PivotConstraint[];
  } = {};
  if (typeof expect.shouldSelect === 'string') result.shouldSelect = expect.shouldSelect;
  if (Array.isArray(expect.shouldNotSelect)) result.shouldNotSelect = (expect.shouldNotSelect as unknown[]).map((s) => String(s));
  if (Array.isArray(expect.scoreConstraints)) {
    result.scoreConstraints = (expect.scoreConstraints as unknown[]).map((entry) => {
      const c = entry as Record<string, unknown>;
      if (typeof c.feeItem !== 'string' || typeof c.operator !== 'string' || typeof c.value !== 'number' || typeof c.reason !== 'string') {
        throw new Error('scoreConstraint must have feeItem/operator/value/reason.');
      }
      return { feeItem: c.feeItem, operator: c.operator as ScoreConstraint['operator'], value: c.value, reason: c.reason };
    });
  }
  if (Array.isArray(expect.pivotConstraints)) {
    result.pivotConstraints = (expect.pivotConstraints as unknown[]).map((entry) => {
      const c = entry as Record<string, unknown>;
      if (typeof c.pivot !== 'string' || typeof c.shouldTrigger !== 'boolean' || typeof c.reason !== 'string') {
        throw new Error('pivotConstraint must have pivot/shouldTrigger/reason.');
      }
      return { pivot: c.pivot, shouldTrigger: c.shouldTrigger, reason: c.reason };
    });
  }
  return result;
}

/**
 * 断言执行引擎。run(assertion)：
 *  1) 从 setup.serialized 恢复世界（宿主 runRequest）。
 *  2) 得到决策 trace；无 trace 视为违规（无法验证）。
 *  3) 检查 shouldSelect（选中动作 == 期望）与 shouldNotSelect。
 *  4) 对选中的候选 breakdown 检查 scoreConstraints / pivotConstraints。
 *  5) 汇总 violations。
 */
export class AssertionRunner {
  constructor(private readonly ctx: AssertionRunContext) {}

  run(assertion: BehaviorAssertion): AssertionResult {
    const run = this.ctx.runRequest(assertion.setup.serialized);
    if (run.error !== undefined || run.trace === null) {
      return {
        passed: false,
        violations: [{
          type: 'wrongSelection',
          expected: assertion.expect.shouldSelect ?? 'an executable decision',
          actual: run.error ?? 'no decision trace',
          trace: run.trace ?? emptyTrace(),
        }],
      };
    }
    const trace = run.trace;
    const violations: AssertionViolation[] = [];

    if (assertion.expect.shouldSelect !== undefined && trace.selected !== null) {
      if (trace.selected.actionId !== assertion.expect.shouldSelect) {
        violations.push({ type: 'wrongSelection', expected: assertion.expect.shouldSelect, actual: trace.selected.actionId, trace });
      }
    }
    if (assertion.expect.shouldNotSelect !== undefined) {
      for (const forbidden of assertion.expect.shouldNotSelect) {
        if (trace.selected !== null && trace.selected.actionId === forbidden) {
          violations.push({ type: 'wrongSelection', expected: `not ${forbidden}`, actual: forbidden, trace });
        }
      }
    }
    if (trace.selected !== null) {
      // 选中候选的 breakdown 用于分数/分水岭约束。
      const chosen = trace.candidates.find((c) => c.actionId === trace.selected!.actionId);
      const breakdown = chosen !== undefined ? chosen.breakdown : null;
      if (assertion.expect.scoreConstraints !== undefined) {
        for (const constraint of assertion.expect.scoreConstraints) {
          if (breakdown === null) {
            violations.push({ type: 'scoreConstraint', expected: `${constraint.feeItem} ${constraint.operator} ${constraint.value}`, actual: 'candidate has no breakdown', trace });
            continue;
          }
          const check = checkScoreConstraint(breakdown, constraint);
          if (!check.satisfied) {
            violations.push({
              type: 'scoreConstraint',
              expected: `${constraint.feeItem} ${constraint.operator} ${constraint.value}  (${constraint.reason})`,
              actual: `feeItem ${constraint.feeItem} contribution = ${String(check.actual)}`,
              trace,
            });
          }
        }
      }
      if (assertion.expect.pivotConstraints !== undefined) {
        for (const constraint of assertion.expect.pivotConstraints) {
          if (breakdown === null) {
            violations.push({ type: 'pivotConstraint', expected: `${constraint.pivot} shouldTrigger=${constraint.shouldTrigger}`, actual: 'candidate has no breakdown', trace });
            continue;
          }
          const check = checkPivotConstraint(breakdown, constraint);
          if (!check.satisfied) {
            violations.push({
              type: 'pivotConstraint',
              expected: `${constraint.pivot} shouldTrigger=${constraint.shouldTrigger} (${constraint.reason})`,
              actual: `triggered=${check.triggered}`,
              trace,
            });
          }
        }
      }
    }
    return { passed: violations.length === 0, violations };
  }
}

/** 用于缺失 trace 的空决策证据链。 */
export function emptyTrace(): DecisionTrace {
  return {
    correlationId: 'missing-trace',
    stateHash: 'none',
    timestamp: 0,
    observedFacts: [],
    candidates: [],
    selected: null,
    submission: { ok: false, rejectionReason: 'no trace available' },
  };
}

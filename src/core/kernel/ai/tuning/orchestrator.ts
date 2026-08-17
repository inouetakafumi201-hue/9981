/**
 * TuningOrchestrator（Task 11）+ RegressionGate + 检查点。
 *
 * 防转圈核心：把「跑断言 → 归因 → 检查环 → 单点调参 → 全量回归」循环到目标断言通过或达到上限。
 * 硬约束（design.md §5）：
 *  - 迭代预算 maxIterations（默认 12），超限停止并交回完整历史；
 *  - 单点归因：每轮只调一个费目；
 *  - 环检测：近 4 轮同一费目被调 ≥2 次 → 停止 cycle-detected；
 *  - 回归闸：每次改动后跑全量 golden，任何原本绿的被弄黄即回滚并尝试下一候选，否则记录 rejected；
 *  - 置信度阈值：归因给出 <0.3 → 停止 low-confidence；
 *  - 到上限仍不通过 → 停止 max-iterations（交人裁决）。
 */
import { BehaviorAssertionRegistry, AssertionRunner, type AssertionResult, type AssertionViolation } from './assertions.js';
import { AttributionEngine } from './attribution.js';
import { ParameterTuner, type ParameterTuningRecord } from './tuner.js';
import type { DecisionTrace } from './trace.js';

/** 回归闸结果。 */
export interface RegressionGateResult {
  readonly anyFailed: boolean;
  readonly failures: Array<{ readonly assertionId: string; readonly result: AssertionResult }>;
}

export interface RegressionGate {
  runAll(): RegressionGateResult;
}

/** 编排器依赖：跑一条断言 + 跑全量 golden 的能力。 */
export interface OrchestratorDeps {
  readonly assertions: BehaviorAssertionRegistry;
  readonly runner: AssertionRunner;
  readonly regression: RegressionGate;
  readonly tuner: ParameterTuner;
  readonly attributor: AttributionEngine;
  /** 可选检查点目录。 */
  readonly checkpointDir?: string;
  readonly maxIterations?: number;
}

export type TuningCycleOutcome =
  | { readonly ok: true; readonly iterations: number; readonly history: readonly ParameterTuningRecord[] }
  | { readonly ok: false; readonly reason: 'max-iterations' | 'cycle-detected' | 'low-confidence' | 'cannot-attribute' | 'forbidden-unique' | 'no-improvement' | 'stopped-by-user';
      readonly reasonDetail: string; readonly iterations: number; readonly history: readonly ParameterTuningRecord[] };

/** 编排记录一组改动（含每轮尝试与决定）。 */
export interface CycleLog {
  readonly iteration: number;
  readonly targetAssertionId: string;
  readonly result: AssertionResult;
  readonly attempts: readonly AttemptLog[];
}
export interface AttemptLog {
  readonly cause: { feeItem: string; confidence: number; reasoning: string };
  readonly recordId: string;
  readonly accepted: boolean;
  readonly regressionFailures: string[];
}

/** 检查点读出/写入。 */
export function saveCheckpoint(label: string, tuner: ParameterTuner, dir?: string): string {
  const toml = JSON.stringify({ label, config: tuner.config });
  if (dir !== undefined) require('node:fs').mkdirSync(dir, { recursive: true });
  const file = `${dir ?? ''}checkpoint-${label}.json`;
  require('node:fs').writeFileSync(file, toml, 'utf8');
  return file;
}

/** 编排器主体。 */
export class TuningOrchestrator {
  private readonly maxIterations: number;
  private readonly history: ParameterTuningRecord[] = [];
  private readonly cycleWindow: Array<{ feeItem: string }> = [];

  constructor(private readonly deps: OrchestratorDeps) {
    this.maxIterations = deps.maxIterations ?? 12;
  }

  get iterations(): number {
    return this.history.length;
  }

  get fullHistory(): readonly ParameterTuningRecord[] {
    return [...this.history];
  }

  /** 最近被调费目频率（近 4 轮为主，供归因降置信）。 */
  private recencyMap(): ReadonlyMap<string, number> {
    const map = new Map<string, number>();
    for (const item of this.cycleWindow.slice(-4)) {
      map.set(item.feeItem, (map.get(item.feeItem) ?? 0) + 1);
    }
    return map;
  }

  runTuningCycle(targetAssertionId: string): TuningCycleOutcome {
    const assertion = this.deps.assertions.get(targetAssertionId);
    if (assertion === undefined) {
      return { ok: false, reason: 'cannot-attribute', reasonDetail: `Assertion ${targetAssertionId} not found`, iterations: 0, history: [] };
    }
    const initial = this.deps.runner.run(assertion);
    if (initial.passed) {
      return { ok: true, iterations: 0, history: [] };
    }

    for (let iteration = 1; iteration <= this.maxIterations; iteration++) {
      const result = this.deps.runner.run(assertion);
      if (result.passed) return { ok: true, iterations: iteration, history: [...this.history] };
      if (result.violations.length === 0) {
        return { ok: false, reason: 'cannot-attribute', reasonDetail: 'Assertion failed but produced no violations', iterations: iteration, history: [...this.history] };
      }

      const firstViolation = result.violations[0];
      if (firstViolation === undefined) {
        return { ok: false, reason: 'cannot-attribute', reasonDetail: 'Assertion failed but produced no violations', iterations: iteration, history: [...this.history] };
      }
      const causes = this.deps.attributor.attribute(firstViolation, firstViolation.trace);
      if (causes.length === 0) {
        return { ok: false, reason: 'cannot-attribute', reasonDetail: 'Attribution produced no root cause fee items', iterations: iteration, history: [...this.history] };
      }
      // 唯一根因禁碰 → 交人裁决。
      const forbidden = causes.filter((c) => this.deps.tuner.forbiddenList.isForbidden(c.feeItem));
      if (causes.length === 1 && forbidden.length === 1) {
        const forbiddenItem = forbidden[0]?.feeItem ?? '';
        return { ok: false, reason: 'forbidden-unique', reasonDetail: `唯一根因 ${forbiddenItem} 在禁碰清单`, iterations: iteration, history: [...this.history] };
      }
      // 置信度过低 → 停。
      const usable = causes.filter((c) => c.confidence >= 0.3);
      if (usable.length === 0) {
        return { ok: false, reason: 'low-confidence', reasonDetail: 'Root cause confidence below 0.3', iterations: iteration, history: [...this.history] };
      }

      // 逐一尝试候选根因（每个都过回归闸）。
      let progressed = false;
      for (const cause of usable) {
        const direction = inferDirection(firstViolation!, cause.feeItem, firstViolation!.trace);
        const tune = this.deps.tuner.tune({
          feeItem: cause.feeItem,
          field: 'unit',
          direction,
          magnitude: 0.5,
          iteration,
          violatedAssertion: targetAssertionId,
          reasoning: cause.reasoning,
          rootCauseFeeItem: cause.feeItem,
          confidence: cause.confidence,
          evidenceTrace: firstViolation.trace,
        });
        if (!tune.ok) {
          // 禁碰/越界/未知 → 试下一个候选。
          continue;
        }
        const recordId = tune.record.id;
        // 回归闸。
        const gate = this.deps.regression.runAll();
        if (gate.anyFailed) {
          // 回归失败 → 回滚，记 rejected。
          this.deps.tuner.revert(recordId);
          this.history.push({ ...tune.record, verification: { targetAssertionPassed: false, regressionCount: gate.failures.length, regressionDetails: gate.failures.map((f) => f.assertionId) }, decision: 'reverted' });
          // 该候选弄黄 golden → 试下一候选。
          continue;
        }
        // 回归通过：本改动 accepted；若目标断言已绿则收敛。
        this.deps.tuner.confirmAccepted(recordId);
        const nowPassed = this.deps.runner.run(assertion).passed;
        this.history.push({ ...tune.record, verification: { targetAssertionPassed: nowPassed, regressionCount: gate.failures.length, regressionDetails: [] } });
        this.cycleWindow.push({ feeItem: cause.feeItem });
        progressed = true;
        if (nowPassed) return { ok: true, iterations: iteration, history: [...this.history] };
        break; // 本候选有进展：跳出候选循环，进入下一迭代
      }

      // 环检测：近 4 轮同一费目被调 ≥2。
      if (this.hasCycle()) {
        return { ok: false, reason: 'cycle-detected', reasonDetail: 'Same fee item tuned too often within the last 4 iterations', iterations: iteration, history: [...this.history] };
      }
      if (!progressed) {
        return { ok: false, reason: 'no-improvement', reasonDetail: 'No candidate produced an acceptable, regression-green change', iterations: iteration, history: [...this.history] };
      }
    }
    return { ok: false, reason: 'max-iterations', reasonDetail: `Reached iteration budget ${this.maxIterations}`, iterations: this.maxIterations, history: [...this.history] };
  }

  private hasCycle(): boolean {
    const recent = this.cycleWindow.slice(-4);
    const freq = new Map<string, number>();
    for (const item of recent) freq.set(item.feeItem, (freq.get(item.feeItem) ?? 0) + 1);
    return [...freq.values()].some((n) => n >= 2);
  }
}

/** 推断调参方向：若违规是「期望动作分数更高」，则该费目应调高；反之调低。 */
export function inferDirection(violation: AssertionViolation, feeItem: string, trace: DecisionTrace): 'increase' | 'decrease' {
  const expectedBreakdown = trace.candidates.find((c) => c.actionId === violation.expected);
  const actualBreakdown = trace.candidates.find((c) => c.actionId === trace.selected?.actionId);
  if (expectedBreakdown === undefined || actualBreakdown === undefined) {
    // 无法对比 → 默认调高（保守，让分数朝期望方向移动）。
    return 'increase';
  }
  const expectedContrib = expectedBreakdown.breakdown.items.find((i) => i.feeItem === feeItem)?.contribution ?? 0;
  const actualContrib = actualBreakdown.breakdown.items.find((i) => i.feeItem === feeItem)?.contribution ?? 0;
  // 我们希望 expected 分数高 → 拉高该费目在 expected 侧的贡献。若 expected 贡献低、actual 高，则降低。
  // 简化：期望动作更「好」时，该费目贡献应更高——若 expected < actual，说明该费目偏高导致错选，调低。
  return expectedContrib < actualContrib ? 'decrease' : 'increase';
}

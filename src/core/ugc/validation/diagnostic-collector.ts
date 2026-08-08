/**
 * 受配额约束的诊断收集器（design.md「Diagnostics」/ 需求 9.7、14.6-14.8；tasks.md 3.1、6.2）。
 *
 * 两个容易做错的点，这里显式处理：
 * 1. **诊断配额耗尽后不能继续无界分配**。耗尽时只追加**一条**终止性 `E_QUOTA_DIAGNOSTICS`，
 *    并记录已收集数与至少被抑制数。那条终止诊断本身**不再计入**配额，否则会递归耗尽。
 * 2. **跳过检查必须关联根诊断**。依赖已失败数据的检查不猜测输入，而是记录 checkId + 阻断它的
 *    根诊断 ID，使报告能解释"为什么这项没跑"（需求 14.7）。
 */
import type { Diagnostic } from '../../kernel/state/diagnostic.js';
import type { UGCDiagnosticFactory } from '../diagnostics/factory.js';
import { sortDiagnostics } from '../diagnostics/sort.js';
import type { QuotaBudget } from '../model/quota-types.js';
import { isBlockingDiagnostic } from '../model/result.js';
import type { SkippedCheck, ValidationStage } from '../model/stage.js';
import { compareSkippedChecks, createSkippedCheck } from '../model/stage.js';

export class DiagnosticCollector {
  private readonly collected: Diagnostic[] = [];
  private readonly skipped: SkippedCheck[] = [];
  private suppressed = 0;
  private terminated = false;

  constructor(
    private readonly budget: QuotaBudget,
    private readonly factory: UGCDiagnosticFactory,
    private readonly sourcePackage: string,
  ) {}

  /** 追加一条诊断。返回 false 表示诊断配额已耗尽，调用方应停止继续产出诊断。 */
  add(diagnostic: Diagnostic): boolean {
    if (this.terminated) {
      this.suppressed += 1;
      return false;
    }
    const violation = this.budget.consume('diagnostics', 1);
    if (violation !== null) {
      this.terminated = true;
      this.suppressed += 1;
      this.collected.push(
        this.factory.host({
          selector: { category: 'RESOURCE_LIMIT', condition: 'diagnostics' },
          stage: 'activation-precheck',
          sourcePackage: this.sourcePackage,
          sourceSpan: null,
          message: `Diagnostic quota exhausted after ${String(this.collected.length)} diagnostics.`,
          reason:
            `问题数量超过系统能够可靠保存的上限（已收集 ${String(this.collected.length)} 条，` +
            `至少还有 ${String(this.suppressed)} 条被抑制），验证已安全停止。`,
          correctionSuggestion: '请先修复当前已经显示的问题，再重新完整提交候选。',
          expected: violation.limit,
          actual: violation.observed,
        }),
      );
      return false;
    }
    this.collected.push(diagnostic);
    return true;
  }

  addAll(diagnostics: readonly Diagnostic[]): boolean {
    for (const diagnostic of diagnostics) {
      if (!this.add(diagnostic)) return false;
    }
    return true;
  }

  /** 记录一个被跳过的检查，并关联阻断它的根诊断。 */
  skip(stage: ValidationStage, checkId: string, blockedByDiagnosticId: string): void {
    this.skipped.push(createSkippedCheck({ stage, checkId, blockedByDiagnosticId }));
  }

  /**
   * 记录一批被跳过的检查，根诊断取当前已收集诊断中**最后一条阻断级**诊断的 rootCauseId。
   * 这样报告里每个跳过项都能追到具体原因，而不是笼统地说"前面出错了"。
   */
  skipBecauseOfLastError(stage: ValidationStage, checkIds: readonly string[]): void {
    const rootCauseId = this.lastBlockingRootCauseId() ?? 'unknown';
    for (const checkId of checkIds) {
      this.skip(stage, checkId, rootCauseId);
    }
  }

  lastBlockingRootCauseId(): string | null {
    for (let index = this.collected.length - 1; index >= 0; index -= 1) {
      const diagnostic = this.collected[index];
      if (diagnostic !== undefined && isBlockingDiagnostic(diagnostic)) {
        return diagnostic.rootCauseId ?? diagnostic.code;
      }
    }
    return null;
  }

  hasBlocking(): boolean {
    return this.collected.some(isBlockingDiagnostic);
  }

  isTerminated(): boolean {
    return this.terminated;
  }

  suppressedCount(): number {
    return this.suppressed;
  }

  /** 按规范顺序输出诊断。 */
  diagnostics(): readonly Diagnostic[] {
    return sortDiagnostics(this.collected);
  }

  /** 按规范顺序输出跳过检查。 */
  skippedChecks(): readonly SkippedCheck[] {
    return Object.freeze([...this.skipped].sort(compareSkippedChecks));
  }

  /** 只保留 warn/info 级诊断，用于成功路径的 warnings 字段。 */
  warnings(): readonly Diagnostic[] {
    return Object.freeze(this.diagnostics().filter((entry) => !isBlockingDiagnostic(entry)));
  }
}

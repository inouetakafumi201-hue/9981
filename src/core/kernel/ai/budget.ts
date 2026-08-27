/** Internal bounded-work accounting for planning and search. */
import type { AIBudget, AIBudgetKind, AIResult, BudgetLedger } from './types';

function validBudgetValue(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/**
 * A deterministic ledger. Zero means that the corresponding operation cannot
 * start; it is not an unlimited or omitted value.
 */
export class FixedBudgetLedger implements BudgetLedger {
  private remainingBudget: AIBudget;

  constructor(budget: AIBudget) {
    if (!validBudgetValue(budget.decisionPoints) || !validBudgetValue(budget.simulations) || !validBudgetValue(budget.evaluationCalls)) {
      throw new Error('AI budget values must be non-negative integers.');
    }
    this.remainingBudget = { ...budget };
  }

  remaining(): Readonly<AIBudget> {
    return { ...this.remainingBudget };
  }

  consume(kind: AIBudgetKind): AIResult<void> {
    const remaining = this.remainingBudget[kind];
    if (remaining <= 0) {
      return { ok: false, code: 'AI_BUDGET_EXHAUSTED', detail: `AI ${kind} budget is exhausted.` };
    }
    this.remainingBudget = { ...this.remainingBudget, [kind]: remaining - 1 };
    return { ok: true, value: undefined };
  }

  exhausted(): boolean {
    return this.remainingBudget.decisionPoints === 0
      || this.remainingBudget.simulations === 0
      || this.remainingBudget.evaluationCalls === 0;
  }
}

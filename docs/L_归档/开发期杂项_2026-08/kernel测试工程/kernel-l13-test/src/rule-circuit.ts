import { MiniWorldState, RuleCircuitEntry } from './world.js';

export interface CircuitBreakerOpts {
  windowMs?: number;
  threshold?: number;
}

export class RuleCircuitBreaker {
  private readonly windowMs: number;
  private readonly threshold: number;

  constructor(opts: CircuitBreakerOpts = {}) {
    this.windowMs = opts.windowMs ?? 60_000;
    this.threshold = opts.threshold ?? 5;
  }

  recordError(state: MiniWorldState, ruleId: string, now: number): { state: MiniWorldState; circuitOpen: boolean } {
    const existing = state.ruleCircuitState[ruleId] ?? { windowErrors: [], disabled: false };
    const recentErrors = existing.windowErrors.filter((t) => t > now - this.windowMs);
    recentErrors.push(now);
    const shouldDisable = recentErrors.length >= this.threshold;
    const updated: RuleCircuitEntry = { windowErrors: recentErrors, disabled: shouldDisable || existing.disabled };
    const nextState: MiniWorldState = { ...state, ruleCircuitState: { ...state.ruleCircuitState, [ruleId]: updated } };
    return { state: nextState, circuitOpen: updated.disabled };
  }

  isDisabled(state: MiniWorldState, ruleId: string): boolean {
    return state.ruleCircuitState[ruleId]?.disabled ?? false;
  }

  reset(state: MiniWorldState, ruleId: string): MiniWorldState {
    const { [ruleId]: _removed, ...rest } = state.ruleCircuitState;
    return { ...state, ruleCircuitState: rest };
  }
}

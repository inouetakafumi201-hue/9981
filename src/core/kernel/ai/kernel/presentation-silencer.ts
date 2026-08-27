/**
 * Presentation silencing for AI exploration.
 *
 * Only external presentation delivery is withheld while the AI explores a
 * simulated branch. Rule outcomes, Op results, invariant checks and diagnostics
 * are never silenced: they still run and still fail inside the branch.
 */
import type { Value } from '../../state/value';
import type { PresentationSilencer } from './simulation-adapter';

export interface PresentationDispatchTarget {
  dispatch(type: string, payload: Record<string, Value>): void;
}

/**
 * Wraps a presentation transport so nested AI simulations can suppress delivery.
 * Suppression is reference-counted: a nested branch cannot resume delivery that
 * an outer branch still requires to stay silent.
 */
export class ReferenceCountedPresentationSilencer implements PresentationSilencer, PresentationDispatchTarget {
  private depth = 0;
  private suppressed = 0;

  constructor(private readonly target: PresentationDispatchTarget) {}

  silence(): void {
    this.depth++;
  }

  resume(): void {
    if (this.depth > 0) this.depth--;
  }

  isSilenced(): boolean {
    return this.depth > 0;
  }

  /** Count of events withheld so far; useful for asserting no leakage. */
  suppressedCount(): number {
    return this.suppressed;
  }

  dispatch(type: string, payload: Record<string, Value>): void {
    if (this.depth > 0) {
      this.suppressed++;
      return;
    }
    this.target.dispatch(type, payload);
  }
}

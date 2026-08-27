/** Category-aware policy-to-planner registry. */
import type { AIPolicyCategory, AIResult, CandidatePlanner, PlannerRegistry } from './types';
import type { Ref } from '../state/ids';

export interface PlannerRegistration {
  readonly policy: Ref;
  readonly category: AIPolicyCategory;
  readonly planner: CandidatePlanner;
}

function key(policy: Ref, category: AIPolicyCategory): string {
  return `${category}:${policy.$}`;
}

export class StaticPlannerRegistry implements PlannerRegistry {
  private readonly planners = new Map<string, CandidatePlanner>();

  constructor(registrations: readonly PlannerRegistration[]) {
    for (const registration of registrations) {
      const registrationKey = key(registration.policy, registration.category);
      if (this.planners.has(registrationKey)) {
        throw new Error(`Duplicate AI planner registration for ${registrationKey}.`);
      }
      this.planners.set(registrationKey, registration.planner);
    }
  }

  resolve(policy: Ref, category: AIPolicyCategory): AIResult<CandidatePlanner> {
    const planner = this.planners.get(key(policy, category));
    if (planner === undefined) {
      return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: `No frozen ${category} planner is registered for policy ${policy.$}.` };
    }
    return { ok: true, value: planner };
  }
}

export class UnavailablePlannerRegistry implements PlannerRegistry {
  constructor(private readonly detail: string) {}

  resolve(_policy: Ref, _category: AIPolicyCategory): AIResult<CandidatePlanner> {
    return { ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: this.detail };
  }
}

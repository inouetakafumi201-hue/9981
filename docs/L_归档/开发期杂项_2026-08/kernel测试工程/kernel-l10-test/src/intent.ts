export type IntentStatus = 'pending' | 'resolved' | 'void' | 'cancelled';

export interface CostSpec {
  pool: string;
  amount: number;
}

export interface IntentDef {
  id: string;
  actorId: string;
  actionType: string;
  cost: CostSpec[];
  require?: (world: IntentWorld) => boolean;
  effect?: (world: IntentWorld) => void;
  priority?: number;
}

export interface Intent {
  id: string;
  actorId: string;
  actionType: string;
  cost: CostSpec[];
  status: IntentStatus;
  require?: (world: IntentWorld) => boolean;
  effect?: (world: IntentWorld) => void;
  priority: number;
  submittedAt: number;
}

export interface IntentWorld {
  actors: Map<string, Actor>;
}

export interface Actor {
  id: string;
  resources: Map<string, number>;
  frozenResources: Map<string, number>;
}

export interface Violation { code: string; detail: string; }

export class IntentSystem {
  private intents: Map<string, Intent> = new Map();
  private time: number = 0;

  submit(def: IntentDef, world: IntentWorld): Intent {
    if (this.intents.has(def.id)) throw new Error('E_INTENT_DUP_ID');

    const actor = world.actors.get(def.actorId);
    if (!actor) throw new Error('E_REF_INVALID');

    for (const cost of def.cost) {
      if (cost.amount < 0) throw new Error('E_COST_NEGATIVE');
      const available = this.getAvailable(actor, cost.pool);
      if (available < cost.amount) {
        throw new Error('E_COST_INSUFFICIENT');
      }
    }

    // 冻结资源前先合并同pool的cost，防止同一Intent内重复pool导致的可用量误算
    const merged = new Map<string, number>();
    for (const cost of def.cost) {
      merged.set(cost.pool, (merged.get(cost.pool) ?? 0) + cost.amount);
    }
    for (const [pool, amount] of merged.entries()) {
      const current = actor.frozenResources.get(pool) ?? 0;
      actor.frozenResources.set(pool, current + amount);
    }

    const intent: Intent = {
      id: def.id,
      actorId: def.actorId,
      actionType: def.actionType,
      cost: def.cost,
      status: 'pending',
      require: def.require,
      effect: def.effect,
      priority: def.priority ?? 0,
      submittedAt: this.time
    };

    this.intents.set(def.id, intent);
    return intent;
  }

  resolve(intentId: string, world: IntentWorld): 'resolved' | 'void' {
    const intent = this.intents.get(intentId);
    if (!intent) throw new Error('E_REF_INVALID');
    if (intent.status !== 'pending') throw new Error('E_INTENT_NOT_PENDING');

    const actor = world.actors.get(intent.actorId);
    if (!actor) {
      this.voidIntent(intentId, world);
      return 'void';
    }

    if (intent.require && !intent.require(world)) {
      this.voidIntent(intentId, world);
      return 'void';
    }

    const merged = new Map<string, number>();
    for (const cost of intent.cost) {
      merged.set(cost.pool, (merged.get(cost.pool) ?? 0) + cost.amount);
    }
    for (const [pool, amount] of merged.entries()) {
      const frozen = actor.frozenResources.get(pool) ?? 0;
      actor.frozenResources.set(pool, frozen - amount);
      const current = actor.resources.get(pool) ?? 0;
      actor.resources.set(pool, current - amount);
    }

    if (intent.effect) {
      intent.effect(world);
    }

    intent.status = 'resolved';
    return 'resolved';
  }

  void(intentId: string, world: IntentWorld): void {
    const intent = this.intents.get(intentId);
    if (!intent) throw new Error('E_REF_INVALID');
    this.voidIntent(intentId, world);
  }

  cancel(intentId: string, world: IntentWorld): void {
    const intent = this.intents.get(intentId);
    if (!intent) throw new Error('E_REF_INVALID');
    if (intent.status !== 'pending') throw new Error('E_INTENT_NOT_PENDING');

    this.returnFrozen(intent, world);
    intent.status = 'cancelled';
  }

  private voidIntent(intentId: string, world: IntentWorld): void {
    const intent = this.intents.get(intentId);
    if (!intent || intent.status !== 'pending') return;

    this.returnFrozen(intent, world);
    intent.status = 'void';
  }

  private returnFrozen(intent: Intent, world: IntentWorld): void {
    const actor = world.actors.get(intent.actorId);
    if (!actor) return;

    const merged = new Map<string, number>();
    for (const cost of intent.cost) {
      merged.set(cost.pool, (merged.get(cost.pool) ?? 0) + cost.amount);
    }
    for (const [pool, amount] of merged.entries()) {
      const frozen = actor.frozenResources.get(pool) ?? 0;
      actor.frozenResources.set(pool, Math.max(0, frozen - amount));
    }
  }

  private getAvailable(actor: Actor, pool: string): number {
    const total = actor.resources.get(pool) ?? 0;
    const frozen = actor.frozenResources.get(pool) ?? 0;
    return total - frozen;
  }

  checkInvariants(world: IntentWorld): Violation[] {
    const violations: Violation[] = [];

    for (const actor of world.actors.values()) {
      for (const [pool, frozen] of actor.frozenResources.entries()) {
        const total = actor.resources.get(pool) ?? 0;
        if (frozen > total) {
          violations.push({
            code: 'E_COST_OVER_FROZEN',
            detail: `actor=${actor.id} pool=${pool} frozen=${frozen} total=${total}`
          });
        }
        if (frozen < 0) {
          violations.push({
            code: 'E_COST_NEGATIVE_FROZEN',
            detail: `actor=${actor.id} pool=${pool} frozen=${frozen}`
          });
        }
      }

      for (const [pool, amount] of actor.resources.entries()) {
        if (amount < 0) {
          violations.push({
            code: 'E_COST_NEGATIVE_RESOURCE',
            detail: `actor=${actor.id} pool=${pool} amount=${amount}`
          });
        }
      }
    }

    for (const intent of this.intents.values()) {
      if (intent.status !== 'pending') continue;
      const actor = world.actors.get(intent.actorId);
      if (!actor) continue;

      const merged = new Map<string, number>();
      for (const cost of intent.cost) {
        merged.set(cost.pool, (merged.get(cost.pool) ?? 0) + cost.amount);
      }
      for (const [pool, amount] of merged.entries()) {
        const frozen = actor.frozenResources.get(pool) ?? 0;
        if (frozen < amount) {
          violations.push({
            code: 'E_INTENT_FROZEN_MISMATCH',
            detail: `intent=${intent.id} pool=${pool} needs=${amount} frozen=${frozen}`
          });
        }
      }
    }

    return violations;
  }

  get(id: string) { return this.intents.get(id); }

  tick(delta: number) { this.time += delta; }
}

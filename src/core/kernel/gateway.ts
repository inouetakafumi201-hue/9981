/**
 * Task 42: PresentationGateway — thin wrappers around:
 * - subscribe: HookDispatcher after-phase events
 * - query: QueryEngine
 * - queryActions: ActionCatalog
 * (design.md 3.15节 / 需求44.1-44.4)
 *
 * Boundary contract: NO OpRegistry or Transaction in gateway exports.
 * The gateway is purely read + subscribe — it never triggers writes.
 */
import type { WorldState } from './state/world-state.js';
import type { Ref } from './state/ids.js';
import type { Value } from './state/value.js';
import type { Query } from './state/expr-types.js';
import type { LegalAction } from './actions/types.js';
import type { ActionCatalog, QueryMode } from './actions/catalog.js';
import type { QueryEngine } from './expr/query-engine.js';
import type { ExprEngine, EvalContext } from './expr/engine.js';

// ---------------------------------------------------------------------------
// Subscriber protocol (event subscription — no OpRegistry/Transaction)
// ---------------------------------------------------------------------------

export type GatewayEventHandler = (type: string, payload: Record<string, Value>) => void;

export interface GatewaySubscription {
  unsubscribe: () => void;
}

// ---------------------------------------------------------------------------
// PresentationGateway
// ---------------------------------------------------------------------------

export interface PresentationGatewayDeps {
  getState: () => WorldState;
  queryEngine: QueryEngine;
  exprEngine: ExprEngine;
  actionCatalog: ActionCatalog;
  ctxForSelf: (ref: Ref) => EvalContext;
  baseCtx: () => EvalContext;
}

/**
 * PresentationGateway: the only surface exposed to UI / external consumers.
 * Provides subscribe, query, and queryActions.
 * Never exposes OpRegistry, Transaction, or any write channel.
 */
export class PresentationGateway {
  private readonly handlers: Map<string, Set<GatewayEventHandler>> = new Map();

  constructor(private readonly deps: PresentationGatewayDeps) {}

  /**
   * subscribe: register a handler for after-phase events.
   * Call dispatch() to deliver events (wired from HookDispatcher after-hooks in production).
   * Returns an unsubscribe handle.
   */
  subscribe(eventType: string, handler: GatewayEventHandler): GatewaySubscription {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
    return {
      unsubscribe: () => {
        this.handlers.get(eventType)?.delete(handler);
      },
    };
  }

  /**
   * dispatch: deliver an event to all subscribers (called by after-hook wiring).
   * This is the write-side bridge — gateway itself never writes WorldState.
   */
  dispatch(type: string, payload: Record<string, Value>): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(type, payload);
        } catch {
          // after-hook handlers must not throw (same contract as after-phase)
        }
      }
    }
    // Also deliver to '*' wildcard handlers
    const wildcard = this.handlers.get('*');
    if (wildcard) {
      for (const handler of wildcard) {
        try {
          handler(type, payload);
        } catch {
          // swallow
        }
      }
    }
  }

  /**
   * query: run a QueryEngine query against current state.
   * Pure read — no writes.
   */
  query(q: Query): Ref[] {
    const state = this.deps.getState();
    return this.deps.queryEngine.run(state, q, {
      exprEngine: this.deps.exprEngine,
      baseCtx: this.deps.baseCtx(),
      ctxForSelf: this.deps.ctxForSelf,
    });
  }

  /**
   * queryActions: get legal actions for an actor.
   * Pure read — delegates to ActionCatalog.
   */
  queryActions(actor: Ref, mode: QueryMode = 'ui'): LegalAction[] {
    return this.deps.actionCatalog.queryActions(actor, mode);
  }
}

/**
 * L6 Actions: ActionDef / TargetSpec / CostSpec（design.md 3.7节 / 需求25.1, 25.6-25.7, 26.1）。
 */
import type { Id } from '../state/ids.js';
import type { Expr, Query } from '../state/expr-types.js';
import type { Def } from '../state/def.js';
import type { Effect } from '../events/effect-types.js';

export interface TargetSpec {
  readonly name: string;
  readonly query?: Query;
  readonly range?: { min: Expr; max: Expr; step: Expr };
  readonly count?: { min: Expr; max: Expr };
  readonly optional?: boolean;
}

export type CostSpec =
  | { readonly pool: string; readonly amount: Expr }
  | { readonly items: Expr }
  | { readonly attach: Id }
  | { readonly custom: Effect[] };

export interface ActionDef extends Def {
  readonly kind: 'action';
  readonly label: Expr;
  readonly targets?: TargetSpec[];
  readonly require?: Expr;
  readonly visible?: Expr;
  readonly reason?: Expr;
  readonly cost?: CostSpec[];
  readonly group?: string;
  readonly effects: Effect[];
}

export interface LegalAction {
  readonly action: Id;
  readonly bindings: Record<string, unknown>;
  readonly cost: CostSpec[];
  readonly reason?: string;
}

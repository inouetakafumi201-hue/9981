/**
 * L4 Events/Hooks: Event / RuleDef 结构（design.md 3.5节 / 需求23.1-23.10, 24.1-24.6）。
 */
import type { Id } from '../state/ids.js';
import type { Value } from '../state/value.js';
import type { Expr } from '../state/expr-types.js';
import type { Def } from '../state/def.js';
import type { Effect } from './effect-types.js';

export interface Event {
  readonly type: string;
  readonly payload: Record<string, Value>;
  readonly source?: { $: Id };
  readonly cause?: Id;
  readonly depth: number;
  readonly cancelled: boolean;
}

export type HookPhase = 'before' | 'modify' | 'instead' | 'default' | 'after';

export interface RuleDef extends Def {
  readonly kind: 'rule';
  readonly on: string | string[];
  readonly phase: HookPhase;
  readonly when?: Expr;
  readonly priority: number;
  readonly effects: Effect[];
  readonly once?: boolean;
}

export interface DispatchResult {
  readonly cancelled: boolean;
  readonly reason?: string;
  readonly finalPayload: Record<string, Value>;
}

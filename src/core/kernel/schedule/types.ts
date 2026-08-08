/**
 * L9 Schedule: 通用相位表声明。
 * Schedule 只描述离散时序，不包含 AP、体力、战斗或行动轮等玩法语义。
 */
import type { Id } from '../state/ids.js';
import type { Expr, Query } from '../state/expr-types.js';
import type { Def } from '../state/def.js';
import type { Effect } from '../events/effect-types.js';

export type PhaseKind = 'normal' | 'submit' | 'resolve' | 'response';
export type PhaseInput = 'none' | 'actor' | 'all';

export interface PhaseDef {
  /** 稳定标识，用于日志、表现层和存档。 */
  readonly id: Id;
  readonly name?: string;
  readonly label?: string;
  /** 兼容旧声明；新玩法应使用 phaseKind 表达 Intent 时序。 */
  readonly kind?: 'action' | 'response' | 'cleanup' | 'custom';
  readonly phaseKind?: PhaseKind;
  readonly actors?: Query;
  readonly input?: PhaseInput;
  readonly reactionRounds?: number;
  readonly duration?: Expr;
  readonly timeLimit?: Expr;
  readonly onEnter?: Effect[];
  readonly onExit?: Effect[];
  readonly timeoutSeconds?: number;
}

export interface ScheduleDef extends Def {
  readonly kind: 'schedule';
  readonly phases: PhaseDef[];
  readonly loop?: boolean;
  readonly order?: 'fixed' | 'initiative';
  readonly initiativeExpr?: Expr;
  readonly resolveOrder?: Expr;
  readonly onConflict?: Effect[];
  readonly roundEnd?: Effect[];
}

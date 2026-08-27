/**
 * L7 Decision/Intent: DecisionDef 结构（design.md 3.8节 / 需求27.1-27.7）。
 */
import type { Id, Ref } from '../state/ids';
import type { Value } from '../state/value';
import type { Expr } from '../state/expr-types';
import type { Def } from '../state/def';
import type { Effect } from '../events/effect-types';

export interface DecisionDef extends Def {
  readonly kind: 'decision';
  readonly options: { name: string; label: Expr; require?: Expr }[];
  readonly quorum: 'all' | 'any' | 'majority';
  readonly onTimeout: 'default' | 'void';
  readonly defaultChoice?: string;
  readonly onResolve: Effect[];
  readonly onVoid?: Effect[];
}

export type DecisionOpenArgs = {
  def: Id;
  askees: Ref[];
  ctx: Record<string, Value>;
  /** 可选截止相位（需求27.1/27.7）：world.turn.phaseEnteredAt 到达它仍未完成即按 onTimeout 处理。 */
  deadline?: number;
};
export type DecisionAnswerArgs = { id: Id; actor: Ref; choice: string };

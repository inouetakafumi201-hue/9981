/**
 * L6 Actions: ActionDef / TargetSpec / CostSpec（design.md 3.7节 / 需求25.1, 25.6-25.7, 26.1）。
 *
 * 双轨制扩展（2026-08-26）：
 * - `track` 字段决定动作属于高亮轨（地图直接点实体）还是卡片轨（发牌器渲染）
 * - `cardPresentation` 引用 CardPresentationDef，为卡片轨提供渲染元数据
 */
import type { Id } from '../state/ids';
import type { Expr, Query } from '../state/expr-types';
import type { Def } from '../state/def';
import type { Effect } from '../events/effect-types';

/** 双轨制轨道类型（双轨制 P1，L1 ActionDef 层）。 */
export type ActionTrack = 'highlight' | 'card';

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
  /**
   * 双轨制轨道（必填）：
   * - `'highlight'`：高亮轨，进入地图直接点实体的交互，不进入卡片池
   * - `'card'`：卡片轨，进入发牌器渲染的卡牌 UI
   * 双轨制切池由 `track` 字段权威判定，不靠 `require` 表达式推断。
   */
  readonly track: ActionTrack;
  /**
   * 卡片元数据 Def 引用（可选）。
   * 仅当 `track === 'card'` 时有意义；缺省时使用默认基线值（图标=assetRefs[0]，颜色=costCategory 派生）。
   */
  readonly cardPresentation?: Id;
  readonly effects: Effect[];
}

export interface LegalAction {
  readonly action: Id;
  readonly bindings: Record<string, unknown>;
  readonly cost: CostSpec[];
  readonly reason?: string;
}

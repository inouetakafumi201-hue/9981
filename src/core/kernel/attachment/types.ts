/**
 * L8 Attachment: AttachmentDef type (design.md 3.9节 / 需求30.1-30.10).
 */
import type { Id } from '../state/ids.js';
import type { Expr } from '../state/expr-types.js';
import type { Def } from '../state/def.js';
import type { Effect } from '../events/effect-types.js';

export type AttachStackStrategy = 'unique' | 'refresh' | 'count' | 'independent';

export interface AttachmentDef extends Def {
  readonly kind: 'attachment';
  readonly stackStrategy: AttachStackStrategy;
  readonly maxStack?: number;
  /** Aura: auto-computed prop bundle, re-evaluated when deps change (needs 30.5-30.6). */
  readonly aura?: {
    readonly deps: Id[];
    readonly compute: Expr;
  };
  readonly onAdd?: Effect[];
  readonly onExpire?: Effect[];
  readonly onRemove?: Effect[];
}

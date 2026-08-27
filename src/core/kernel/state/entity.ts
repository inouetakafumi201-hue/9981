/**
 * L1 State: Entity / Item 运行时结构（design.md 3.1节 / 需求2.1-2.4）。
 */
import type { Id, Ref } from './ids';
import type { Value } from './value';

export interface Entity {
  readonly id: Id;
  readonly def: Id;
  readonly tags: string[];
  readonly props: Record<string, Value>;
  readonly node?: Id;
  readonly slot?: Id; // node/slot 互斥（需求2.1，由 L3 InvariantChecker 校验）
  readonly containers: Record<string, Id>;
  readonly attachments: Id[];
  readonly relations: Record<string, { out: Ref[]; in: Ref[] }>;
}

export interface Item {
  readonly id: Id;
  readonly def: Id;
  readonly tags: string[];
  readonly props: Record<string, Value>;
  readonly slot?: Id;
  readonly stack?: number;
  readonly stackMax?: number;
  readonly containers: Record<string, Id>;
  readonly attachments: Id[];
}

export function createEntityShape(id: Id, def: Id): Entity {
  return { id, def, tags: [], props: {}, containers: {}, attachments: [], relations: {} };
}

export function createItemShape(id: Id, def: Id): Item {
  return { id, def, tags: [], props: {}, containers: {}, attachments: [] };
}

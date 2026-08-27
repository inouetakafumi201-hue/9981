/**
 * L1 Topology: Node/Link/Container/Slot 结构（design.md 3.2节 / 需求7、10）。
 */
import type { Id } from '../state/ids';
import type { Value } from '../state/value';
import type { Expr } from '../state/expr-types';
import type { Ref } from '../state/ids';

export interface Node {
  readonly id: Id;
  readonly def: Id;
  readonly tags: string[];
  readonly props: Record<string, Value>;
  readonly weight: number;
  readonly parent?: Id;
  readonly attachments: Id[];
}

export interface Link {
  readonly id: Id;
  // design.md 3.2节的 Link 接口未声明 def 字段（Node 有），但 PrefabDef.links[].def 与
  // link.create 都需要引用一个 Def 才能挂载 RuleDef/校验 accepts 等——这是判断记录里标注的
  // 设计缺口修补：补上 def 字段与 Node 对齐，不影响任何既有需求条款（无需求条款声明 Link 不得有 def）。
  readonly def: Id;
  readonly a: Id;
  readonly b: Id;
  readonly directed: boolean;
  /** 透传的完整方向 token（L-07/D-074，去布尔压缩）：`'bidirectional'|'unidirectional'|'one-way-down'|'one-way-up'`。 */
  readonly direction?: string;
  readonly weight: number;
  readonly tags: string[];
  readonly props: Record<string, Value>;
  readonly attachments: Id[];
}

export interface Slot {
  readonly id: Id;
  readonly tags: string[];
  readonly accepts?: Expr;
  readonly holds?: Ref;
  readonly props: Record<string, Value>;
}

export interface Container {
  readonly id: Id;
  readonly owner: Id;
  readonly name: string;
  readonly slots: Slot[];
  readonly insert: 'fixed' | 'shift';
  readonly props: Record<string, Value>;
}

export function createNodeShape(id: Id, def: Id, opts?: { weight?: number; parent?: Id }): Node {
  return { id, def, tags: [], props: {}, weight: opts?.weight ?? 1, parent: opts?.parent, attachments: [] };
}

export function createLinkShape(id: Id, a: Id, b: Id, opts?: { def?: Id; directed?: boolean; weight?: number; direction?: string }): Link {
  return { id, def: opts?.def ?? 'd:link', a, b, directed: opts?.directed ?? false, weight: opts?.weight ?? 1, tags: [], props: {}, attachments: [], ...(opts?.direction !== undefined ? { direction: opts.direction } : {}) };
}

export function createSlotShape(id: Id, tags?: string[], accepts?: Expr): Slot {
  return { id, tags: tags ?? [], accepts, props: {} };
}

export function createContainerShape(id: Id, owner: Id, name: string, insert: 'fixed' | 'shift'): Container {
  return { id, owner, name, slots: [], insert, props: {} };
}

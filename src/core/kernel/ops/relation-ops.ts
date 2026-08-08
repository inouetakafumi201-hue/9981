/**
 * L3 Ops: relation.set / relation.del（design.md 3.1/3.4节 / 需求6.1-6.7, 16.1）。
 *
 * 判断记录（决策与风险记录.md）：design.md 3.1节把 RelationIndex 描述为"全局索引"，早前草案
 * （state/relation.ts 的 RelationIndex 类）把它实现为一个持有内部 Map 的长生命周期实例，由
 * relation.set/del 在 Op 内部调用其 _add/_remove 方法改写。这在事务语义上是错的：Map 的变更
 * 立即生效、独立于 Transaction 的 draft 快照栈，若外层事务后续 rollback，Map 上的改动不会被
 * 撤销，破坏事务原子性（需求21.3-21.4）与快照/回放确定性（需求37.1-37.3，因为该 Map 不在
 * WorldState 里，不会被 snapshot 捕获）。
 *
 * 修正：relation.set/del 直接对 draft 中 entities[from].relations[kind].out 与
 * entities[to].relations[kind].in 做不可变更新——这与 Transaction 的其余写入路径同构，
 * 天然获得事务性。Entity.relations 本身就同时承载"正向出边"与"反向入边"两个切片
 * （design.md 3.1节原文），因此不需要额外的全局索引结构：relOut(ref,kind) 直接读
 * entities[ref].relations[kind].out，relIn 读 .in，均为 O(1)，语义与 state/relation.ts 的
 * RelationIndex.relOut/relIn 完全一致。state/relation.ts 的 RelationIndex 类仍保留（已有测试
 * 覆盖其纯函数式的对称性/级联清理语义），但不再被 Op 层实例化为跨事务的长生命周期对象。
 */
import type { OpImpl } from './registry.js';
import type { OpRegistry } from './registry.js';
import { ok, err } from './result.js';
import type { Id, Ref } from '../state/ids.js';
import type { Entity } from '../state/entity.js';

export interface RelationSetArgs {
  from: Id;
  to: Id;
  kind: string;
}

export interface RelationDelArgs {
  from: Id;
  to: Id;
  kind: string;
}

function refExistsForRelation(state: { entities: Record<string, unknown>; items: Record<string, unknown>; nodes: Record<string, unknown>; links: Record<string, unknown> }, id: Id): boolean {
  return id === 'w:0' || id in state.entities || id in state.items || id in state.nodes || id in state.links;
}

function addRefUnique(list: Ref[], ref: Ref): Ref[] {
  return list.some((r) => r.$ === ref.$) ? list : [...list, ref];
}

function removeRef(list: Ref[], ref: Ref): Ref[] {
  return list.filter((r) => r.$ !== ref.$);
}

export const relationSet: OpImpl<RelationSetArgs, void> = (args, ctx) => {
  const draft = ctx.tx.getDraft();
  if (!refExistsForRelation(draft, args.from)) return err('E_REF_MISSING', `from ${args.from} 不存在`);
  if (!refExistsForRelation(draft, args.to)) return err('E_REF_MISSING', `to ${args.to} 不存在`);

  let nextEntities = draft.entities;
  const fromEntity = nextEntities[args.from];
  if (fromEntity) {
    const existingOut = fromEntity.relations[args.kind]?.out ?? [];
    const nextOut = addRefUnique(existingOut, { $: args.to });
    nextEntities = updateRelationSlice(nextEntities, args.from, fromEntity, args.kind, { out: nextOut });
  }
  const toEntity = nextEntities[args.to];
  if (toEntity) {
    const existingIn = toEntity.relations[args.kind]?.in ?? [];
    const nextIn = addRefUnique(existingIn, { $: args.from });
    nextEntities = updateRelationSlice(nextEntities, args.to, toEntity, args.kind, { in: nextIn });
  }

  ctx.tx.setDraft({ ...draft, entities: nextEntities });
  ctx.tx.logOp('relation.set', args, () => {});
  return ok(undefined);
};

export const relationDel: OpImpl<RelationDelArgs, void> = (args, ctx) => {
  const draft = ctx.tx.getDraft();
  let nextEntities = draft.entities;
  const fromEntity = nextEntities[args.from];
  if (fromEntity) {
    const existingOut = fromEntity.relations[args.kind]?.out ?? [];
    nextEntities = updateRelationSlice(nextEntities, args.from, fromEntity, args.kind, { out: removeRef(existingOut, { $: args.to }) });
  }
  const toEntity = nextEntities[args.to];
  if (toEntity) {
    const existingIn = toEntity.relations[args.kind]?.in ?? [];
    nextEntities = updateRelationSlice(nextEntities, args.to, toEntity, args.kind, { in: removeRef(existingIn, { $: args.from }) });
  }
  ctx.tx.setDraft({ ...draft, entities: nextEntities });
  ctx.tx.logOp('relation.del', args, () => {});
  return ok(undefined);
};

function updateRelationSlice(
  entities: Record<Id, Entity>,
  id: Id,
  entity: Entity,
  kind: string,
  patch: Partial<{ out: Ref[]; in: Ref[] }>,
): Record<Id, Entity> {
  const existing = entity.relations[kind] ?? { out: [], in: [] };
  const nextSlice = { ...existing, ...patch };
  return { ...entities, [id]: { ...entity, relations: { ...entity.relations, [kind]: nextSlice } } };
}

/** relOut/relIn 纯读函数：直接读 Entity.relations 投影，语义等价于 state/relation.ts 的 RelationIndex（需求6.4-6.5）。 */
export function relOut(entities: Record<Id, Entity>, ref: Ref, kind: string): Ref[] {
  return entities[ref.$]?.relations[kind]?.out ?? [];
}

export function relIn(entities: Record<Id, Entity>, ref: Ref, kind: string): Ref[] {
  return entities[ref.$]?.relations[kind]?.in ?? [];
}

/** 销毁对象时级联移除以其为端点的全部 Relation（需求6.6），供 entity.destroy 的 after 阶段调用。 */
export function removeAllRelationsInvolving(entities: Record<Id, Entity>, ref: Ref): Record<Id, Entity> {
  let next = entities;
  for (const [id, entity] of Object.entries(entities)) {
    if (id === ref.$) continue;
    let changed = false;
    const nextRelations: Entity['relations'] = {};
    for (const [kind, slice] of Object.entries(entity.relations)) {
      const filteredOut = slice.out.filter((r) => r.$ !== ref.$);
      const filteredIn = slice.in.filter((r) => r.$ !== ref.$);
      if (filteredOut.length !== slice.out.length || filteredIn.length !== slice.in.length) changed = true;
      nextRelations[kind] = { out: filteredOut, in: filteredIn };
    }
    if (changed) next = { ...next, [id]: { ...entity, relations: nextRelations } };
  }
  const { [ref.$]: _removed, ...rest } = next;
  return rest;
}

export function registerRelationOps(registry: OpRegistry): void {
  registry.register('relation.set', relationSet);
  registry.register('relation.del', relationDel);
}

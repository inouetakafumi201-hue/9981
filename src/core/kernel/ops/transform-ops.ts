/**
 * L3 Ops: entity.setDef / node.merge / node.split（design.md 3.4节 / 需求18.1-18.5）。
 * carry 是字段选择器数组，Op 实现内部按选择器逐一迁移旧对象的引用到新对象/keep 节点，
 * 再销毁旧对象——先接管引用，再销毁来源，保证事务中途失败时旧对象仍完整存在。
 */
import type { OpImpl } from './registry';
import type { OpRegistry } from './registry';
import { ok, err } from './result';
import type { Id } from '../state/ids';
import type { Entity } from '../state/entity';
import type { Node } from '../topology/types';
import { checkInstantiable } from './def-guard';
import type { DefLookupFn } from './def-guard';

export type CarryField = 'props' | 'relations' | 'containers' | 'attachments' | 'tags';

export interface EntitySetDefArgs {
  id: Id;
  def: Id;
  carry: CarryField[];
}

/**
 * entity.setDef：切换 Entity 的 Def，保留其 id（需求18.1-18.2）。
 * 目标 Def 必须存在、kind 为 'entity'、且非 abstract（需求3.5：变身后的新形态必须是可实例化
 * 的具体 Def，"变身成一个抽象基类"在语义上不成立——运行期严厉性缺口修补，见 决策与风险记录.md）。
 */
export function makeEntitySetDef(defLookup: DefLookupFn): OpImpl<EntitySetDefArgs, void> {
  return (args, ctx) => {
    const guard = checkInstantiable(defLookup, args.def, 'entity');
    if (!guard.ok) return guard;
    const draft = ctx.tx.getDraft();
    const entity = draft.entities[args.id];
    if (!entity) return err('E_REF_MISSING', `Entity ${args.id} 不存在`);

    const next: Entity = { ...entity, def: args.def };
    // carry 字段选择器：未列出的字段重置为空（变身后不携带），列出的字段保留原值
    const carrySet = new Set(args.carry);
    const reset: Entity = {
      ...next,
      props: carrySet.has('props') ? entity.props : {},
      relations: carrySet.has('relations') ? entity.relations : {},
      containers: carrySet.has('containers') ? entity.containers : {},
      attachments: carrySet.has('attachments') ? entity.attachments : [],
      tags: carrySet.has('tags') ? entity.tags : [],
    };

    ctx.tx.setDraft({ ...draft, entities: { ...draft.entities, [args.id]: reset } });
    ctx.tx.logOp('entity.setDef', args, () => {});
    return ok(undefined);
  };
}

export interface NodeMergeArgs {
  keep: Id;
  absorb: Id;
  carry: CarryField[];
}

/**
 * node.merge：将 absorb 节点的边、占位者、子节点、Attachment 按 carry 策略并入 keep 节点，
 * 并销毁 absorb（需求18.3）。不通过"销毁后重建"，而是直接改写引用指向。
 */
export const nodeMerge: OpImpl<NodeMergeArgs, void> = (args, ctx) => {
  const draft = ctx.tx.getDraft();
  const keepNode = draft.nodes[args.keep];
  const absorbNode = draft.nodes[args.absorb];
  if (!keepNode) return err('E_REF_MISSING', `Node ${args.keep} 不存在`);
  if (!absorbNode) return err('E_REF_MISSING', `Node ${args.absorb} 不存在`);

  // 先接管引用，再销毁来源：
  // 1) 迁移以 absorb 为端点的 Link 到 keep
  let nextLinks = draft.links;
  for (const [lid, link] of Object.entries(draft.links)) {
    if (link.a === args.absorb) nextLinks = { ...nextLinks, [lid]: { ...link, a: args.keep } };
    if (link.b === args.absorb) nextLinks = { ...nextLinks, [lid]: { ...link, b: args.keep } };
  }
  // 2) 迁移占位于 absorb 的 Entity 到 keep
  let nextEntities = draft.entities;
  for (const [eid, e] of Object.entries(draft.entities)) {
    if (e.node === args.absorb) nextEntities = { ...nextEntities, [eid]: { ...e, node: args.keep } };
  }
  // 3) 迁移子节点（parent === absorb）到 keep
  let nextNodes = draft.nodes;
  for (const [nid, n] of Object.entries(draft.nodes)) {
    if (n.parent === args.absorb) nextNodes = { ...nextNodes, [nid]: { ...n, parent: args.keep } };
  }
  // 4) 迁移 Attachment（若 carry 包含 attachments，把 target 从 absorb 指向 keep）
  let nextWorldAttachments = draft.world.attachments;
  if (args.carry.includes('attachments')) {
    for (const [aid, a] of Object.entries(draft.world.attachments)) {
      if (a.target.$ === args.absorb) nextWorldAttachments = { ...nextWorldAttachments, [aid]: { ...a, target: { $: args.keep } } };
    }
  }
  // 5) 合并 keep 自身的 attachments 列表（占位追加，去重）
  const mergedKeepAttachments = args.carry.includes('attachments')
    ? Array.from(new Set([...keepNode.attachments, ...absorbNode.attachments]))
    : keepNode.attachments;
  nextNodes = { ...nextNodes, [args.keep]: { ...keepNode, attachments: mergedKeepAttachments } };

  // 6) 销毁 absorb（此时已不再被任何引用指向）
  const { [args.absorb]: _removed, ...restNodes } = nextNodes;

  ctx.tx.setDraft({
    ...draft,
    nodes: restNodes,
    links: nextLinks,
    entities: nextEntities,
    world: { ...draft.world, attachments: nextWorldAttachments },
  });
  ctx.tx.logOp('node.merge', args, () => {});
  return ok(undefined);
};

export interface NodeSplitSpec {
  key: string;
  def: Id;
  /** 分裂后归属该新节点的占位者 Entity Id 列表；未列出的占位者留在原节点（此处简化为显式分组）。 */
  entities?: Id[];
}

export interface NodeSplitArgs {
  id: Id;
  specs: NodeSplitSpec[];
}

/**
 * node.split：将一个节点按 spec 分裂为多个节点并重新分配占位者与边（需求18.4）。
 * 穷举校验：specs 数组里每一个 spec.def 都必须独立通过 checkInstantiable——分裂出 3 个新
 * 节点、其中 2 个合法 1 个 abstract，属于"部分合法"的组合状态，必须整体拒绝（不允许分裂出
 * 一半合法一半非法的节点集合），因此校验循环必须遍历全部 specs 而非只检查第一个。
 */
export function makeNodeSplit(idAllocator: () => Id, defLookup: DefLookupFn): OpImpl<NodeSplitArgs, Id[]> {
  return (args, ctx) => {
    for (const spec of args.specs) {
      const guard = checkInstantiable(defLookup, spec.def, 'node');
      if (!guard.ok) return guard;
    }

    const draft = ctx.tx.getDraft();
    const original = draft.nodes[args.id];
    if (!original) return err('E_REF_MISSING', `Node ${args.id} 不存在`);

    const newIds: Id[] = [];
    let nextNodes = draft.nodes;
    let nextEntities = draft.entities;
    for (const spec of args.specs) {
      const newId = idAllocator();
      newIds.push(newId);
      const newNode: Node = { ...original, id: newId, def: spec.def };
      nextNodes = { ...nextNodes, [newId]: newNode };
      for (const eid of spec.entities ?? []) {
        const e = nextEntities[eid];
        if (e && e.node === args.id) {
          nextEntities = { ...nextEntities, [eid]: { ...e, node: newId } };
        }
      }
    }
    // 原节点分裂后不再存在（其边保留指向原 id 会成为悬空引用，简化实现：把原节点的边重定向到第一个新节点）
    let nextLinks = draft.links;
    const firstNewId = newIds[0];
    if (firstNewId !== undefined) {
      for (const [lid, link] of Object.entries(draft.links)) {
        if (link.a === args.id) nextLinks = { ...nextLinks, [lid]: { ...link, a: firstNewId } };
        if (link.b === args.id) nextLinks = { ...nextLinks, [lid]: { ...link, b: firstNewId } };
      }
    }
    const { [args.id]: _removed, ...restNodes } = nextNodes;

    ctx.tx.setDraft({ ...draft, nodes: restNodes, links: nextLinks, entities: nextEntities });
    ctx.tx.logOp('node.split', args, () => {});
    return ok(newIds);
  };
}

export function registerTransformOps(registry: OpRegistry, idAllocator: () => Id, defLookup: DefLookupFn): void {
  registry.register('entity.setDef', makeEntitySetDef(defLookup), { structural: true });
  registry.register('node.merge', nodeMerge, { structural: true });
  registry.register('node.split', makeNodeSplit(idAllocator, defLookup), { structural: true });
}

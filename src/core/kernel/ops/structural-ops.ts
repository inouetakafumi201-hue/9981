/**
 * L3 Ops: 结构类 Op（design.md 3.4节 / 需求2.1-2.4, 7.1-7.6, 8.1-8.7, 10.1-10.10, 16.6-16.7, 18.1-18.5）。
 */
import type { OpImpl } from './registry.js';
import type { OpRegistry } from './registry.js';
import { ok, err } from './result.js';
import type { Id, Ref } from '../state/ids.js';
import { nextId, rollbackNextIdCounter } from '../state/ids.js';
import { createEntityShape, createItemShape } from '../state/entity.js';
import { createNodeShape, createLinkShape, createContainerShape, createSlotShape } from '../topology/types.js';
import type { Node } from '../topology/types.js';
import { linksTouching, cascadeNodeDestroySet } from '../topology/graph.js';
import { insertSlot, removeSlot, findDefaultSlotIndex, setSlotHolds } from '../topology/container.js';
import { ensureMicroScene, onMicroSceneOccupantsChanged, checkMicroSceneCapacity, findChildMicroScene } from '../topology/micro-scene.js';
import type { WorldState } from '../state/world-state.js';
import type { Def, ContainerSpec } from '../state/def.js';
import type { Expr } from '../state/expr-types.js';
import type { ExprEngine, EvalContext } from '../expr/engine.js';
import { checkInstantiable } from './def-guard.js';
import type { DefLookupFn } from './def-guard.js';
import { cascadeRelationsAndAttachments, destroyOwnedContainers, clearHoldingSlot } from './cascade-destroy.js';

// ---------- entity.create / entity.destroy ----------

export interface EntityCreateArgs {
  def: Id;
}

export function makeEntityCreate(defLookup: DefLookupFn): OpImpl<EntityCreateArgs, Ref> {
  return (args, ctx) => {
    const guard = checkInstantiable(defLookup, args.def, 'entity');
    if (!guard.ok) return guard;
    const draft = ctx.tx.getDraft();
    const id = nextId('e');
    const entity = createEntityShape(id, args.def);
    let working: WorldState = { ...draft, entities: { ...draft.entities, [id]: entity } };
    // 兑现 Def.containers（见上方"Def.containers 兑现"注释块）：容器必须在创建时随宿主一起
    // 产生，因为 Op 全集里没有 container.create，创建时不兑现就永远不可达。
    working = materializeDefContainers(working, id, containerSpecsOf(guard.value));
    ctx.tx.setDraft(working);
    ctx.tx.logOp('entity.create', args, () => {});
    return ok({ $: id });
  };
}

export interface EntityDestroyArgs {
  id: Id;
}

/**
 * entity.destroy 的机械级联清理（决策与风险记录.md 记录5/11/12）：销毁前必须消除全部三类
 * 会导致悬空引用的场景——Relation（需求6.6）、以此实体为 target 的 Attachment 及其
 * grantedBy 子代（需求20.13）、此实体自身拥有的 Container（背包等，需求20.9）——否则
 * InvariantChecker 会在 commit 前拒绝整个 Op（此前正是因为缺这三步，任何带光环/背包的
 * 实体完全无法被销毁）。容器内的占用者不随之销毁，只脱离槎位（机械纪律，语义留给玩法包）。
 * 若该实体自身被容纳在某个槎位里（Entity 可占据 Slot，需求2.1），同样需要脱离该槎位。
 */
export const entityDestroy: OpImpl<EntityDestroyArgs, void> = (args, ctx) => {
  const draft = ctx.tx.getDraft();
  const entity = draft.entities[args.id];
  if (!entity) return err('E_REF_MISSING', `Entity ${args.id} 不存在`);
  const ref: Ref = { $: args.id };

  let working = draft;
  working = destroyOwnedContainers(working, entity.containers);
  working = clearHoldingSlot(working, ref);
  const { entities: entitiesAfterCascade, attachments } = cascadeRelationsAndAttachments(working, ref);
  const { [args.id]: _removed, ...restEntities } = entitiesAfterCascade;

  ctx.tx.setDraft({ ...working, entities: restEntities, world: { ...working.world, attachments } });
  ctx.tx.logOp('entity.destroy', args, () => {});
  return ok(undefined);
};

// ---------- item.create / item.destroy ----------

export interface ItemCreateArgs {
  def: Id;
  stack?: number;
  stackMax?: number;
}

export function makeItemCreate(defLookup: DefLookupFn): OpImpl<ItemCreateArgs, Ref> {
  return (args, ctx) => {
    const guard = checkInstantiable(defLookup, args.def, 'item');
    if (!guard.ok) return guard;
    const draft = ctx.tx.getDraft();
    const id = nextId('i');
    const item = { ...createItemShape(id, args.def), stack: args.stack, stackMax: args.stackMax };
    let working: WorldState = { ...draft, items: { ...draft.items, [id]: item } };
    // Item 同样可以拥有容器（04号文档：背包本身是一个 Item，其内部格数就是它自己的容器），
    // 与 entity.create 完全对称——这正是深度嵌套模糊测试里"容器里的物品自身也持有容器"的
    // 合法来源。
    working = materializeDefContainers(working, id, containerSpecsOf(guard.value));
    ctx.tx.setDraft(working);
    ctx.tx.logOp('item.create', args, () => {});
    return ok({ $: id });
  };
}

export interface ItemDestroyArgs {
  id: Id;
}

export const itemDestroy: OpImpl<ItemDestroyArgs, void> = (args, ctx) => {
  const draft = ctx.tx.getDraft();
  const item = draft.items[args.id];
  if (!item) return err('E_REF_MISSING', `Item ${args.id} 不存在`);
  const ref: Ref = { $: args.id };

  // 机械纪律三件套（与 entity.destroy 对称，见 cascade-destroy.ts 文件头注释）：
  // 关系/附着级联清理、自身拥有的容器级联清理（占用者脱离而非销毁）、清空自己所在的槎位。
  const { entities: entitiesAfterCleanup, attachments: attachmentsAfterCleanup } = cascadeRelationsAndAttachments(draft, ref);
  const draftAfterCleanup = { ...draft, entities: entitiesAfterCleanup, world: { ...draft.world, attachments: attachmentsAfterCleanup } };
  const draftAfterContainers = destroyOwnedContainers(draftAfterCleanup, item.containers);
  const draftAfterSlotClear = clearHoldingSlot(draftAfterContainers, ref);

  const { [args.id]: _removed, ...restItems } = draftAfterSlotClear.items;
  ctx.tx.setDraft({ ...draftAfterSlotClear, items: restItems });
  ctx.tx.logOp('item.destroy', args, () => {});
  return ok(undefined);
};

// ---------- node.create / node.destroy ----------

export interface NodeCreateArgs {
  def: Id;
  weight?: number;
  parent?: Id;
}

export function makeNodeCreate(defLookup: DefLookupFn): OpImpl<NodeCreateArgs, Ref> {
  return (args, ctx) => {
    const guard = checkInstantiable(defLookup, args.def, 'node');
    if (!guard.ok) return guard;
    const draft = ctx.tx.getDraft();
    if (args.parent !== undefined && !(args.parent in draft.nodes)) {
      return err('E_REF_MISSING', `parent 节点 ${args.parent} 不存在`);
    }
    const id = nextId('n');
    const node = createNodeShape(id, args.def, { weight: args.weight, parent: args.parent });
    ctx.tx.setDraft({ ...draft, nodes: { ...draft.nodes, [id]: node } });
    ctx.tx.logOp('node.create', args, () => {});
    return ok({ $: id });
  };
}

export interface NodeDestroyArgs {
  id: Id;
}

/**
 * node.destroy 级联销毁子节点（parent 链）与关联 Link（需求7.5, 20.7），并对每一个被销毁的
 * 节点做 Relation/Attachment 级联清理（需求6.6, 20.13——Node 同样可作为 Attachment.target
 * 与 Relation 端点，design.md 3.1节 Attachment.target 泛化到 Node/Link，此前完全没有清理，
 * 见 决策与风险记录.md 记录12：任何挂了光环/状态的 Node 此前无法被销毁）。
 */
export const nodeDestroy: OpImpl<NodeDestroyArgs, void> = (args, ctx) => {
  const draft = ctx.tx.getDraft();
  if (!(args.id in draft.nodes)) return err('E_REF_MISSING', `Node ${args.id} 不存在`);
  const toDestroy = cascadeNodeDestroySet(draft.nodes, args.id);
  let nextNodes = { ...draft.nodes };
  let nextLinks = { ...draft.links };
  let workingDraft = draft;
  for (const nodeId of toDestroy) {
    for (const linkId of linksTouching(nextLinks, nodeId)) {
      const { [linkId]: _l, ...rest } = nextLinks;
      nextLinks = rest;
    }
    const { [nodeId]: _n, ...rest } = nextNodes;
    nextNodes = rest;
    const cleaned = cascadeRelationsAndAttachments(workingDraft, { $: nodeId });
    workingDraft = { ...workingDraft, entities: cleaned.entities, world: { ...workingDraft.world, attachments: cleaned.attachments } };
  }
  // 疏散占位于被销毁节点上的 Entity（需求20.7：父节点销毁时子节点级联销毁并疏散占位者）
  let nextEntities = workingDraft.entities;
  for (const [eid, e] of Object.entries(nextEntities)) {
    if (e.node !== undefined && toDestroy.has(e.node)) {
      const { node: _n, ...rest } = e;
      nextEntities = { ...nextEntities, [eid]: rest };
    }
  }
  ctx.tx.setDraft({ ...workingDraft, nodes: nextNodes, links: nextLinks, entities: nextEntities });
  ctx.tx.logOp('node.destroy', args, () => {});
  return ok(undefined);
};

// ---------- link.create / link.destroy ----------

export interface LinkCreateArgs {
  a: Id;
  b: Id;
  def: Id;
  directed?: boolean;
  weight?: number;
  /** 完整方向 token（`bidirectional`/`unidirectional`/`one-way-down`/`one-way-up`）。与 `directed` 并存时优先。 */
  direction?: string;
}

export function makeLinkCreate(defLookup: DefLookupFn): OpImpl<LinkCreateArgs, Ref> {
  return (args, ctx) => {
    const guard = checkInstantiable(defLookup, args.def, 'link');
    if (!guard.ok) return guard;
    const draft = ctx.tx.getDraft();
    if (!(args.a in draft.nodes)) return err('E_REF_MISSING', `Node ${args.a} 不存在`);
    if (!(args.b in draft.nodes)) return err('E_REF_MISSING', `Node ${args.b} 不存在`);
    const id = nextId('l');
    const link = createLinkShape(id, args.a, args.b, {
      def: args.def,
      directed: args.directed,
      weight: args.weight,
      ...(args.direction === undefined ? {} : { direction: args.direction }),
    });
    ctx.tx.setDraft({ ...draft, links: { ...draft.links, [id]: link } });
    ctx.tx.logOp('link.create', args, () => {});
    return ok({ $: id });
  };
}

export interface LinkDestroyArgs {
  id: Id;
}

/** link.destroy 同样需要清理以其为端点的 Relation/Attachment（记录5/11/12 修正的一致性要求）。 */
export const linkDestroy: OpImpl<LinkDestroyArgs, void> = (args, ctx) => {
  const draft = ctx.tx.getDraft();
  if (!(args.id in draft.links)) return err('E_REF_MISSING', `Link ${args.id} 不存在`);
  const cascaded = cascadeRelationsAndAttachments(draft, { $: args.id });
  const { [args.id]: _removed, ...rest } = draft.links;
  ctx.tx.setDraft({ ...draft, links: rest, entities: cascaded.entities, world: { ...draft.world, attachments: cascaded.attachments } });
  ctx.tx.logOp('link.destroy', args, () => {});
  return ok(undefined);
};

// ---------- slot.add / slot.del ----------

export interface SlotAddArgs {
  containerId: Id;
  tags?: string[];
  accepts?: Expr;
}

export const slotAdd: OpImpl<SlotAddArgs, Ref> = (args, ctx) => {
  const draft = ctx.tx.getDraft();
  const container = draft.containers[args.containerId];
  if (!container) return err('E_REF_MISSING', `Container ${args.containerId} 不存在`);
  const slotId = nextId('s');
  const slot = createSlotShape(slotId, args.tags, args.accepts);
  const nextContainer = insertSlot(container, slot);
  ctx.tx.setDraft({ ...draft, containers: { ...draft.containers, [args.containerId]: nextContainer } });
  ctx.tx.logOp('slot.add', args, () => {});
  return ok({ $: slotId });
};

export interface SlotDelArgs {
  containerId: Id;
  index: number;
}

export const slotDel: OpImpl<SlotDelArgs, void> = (args, ctx) => {
  const draft = ctx.tx.getDraft();
  const container = draft.containers[args.containerId];
  if (!container) return err('E_REF_MISSING', `Container ${args.containerId} 不存在`);
  if (args.index < 0 || args.index >= container.slots.length) return err('E_OP_INVALID_ARGS', `槎位索引越界: ${args.index}`);
  const nextContainer = removeSlot(container, args.index);
  ctx.tx.setDraft({ ...draft, containers: { ...draft.containers, [args.containerId]: nextContainer } });
  ctx.tx.logOp('slot.del', args, () => {});
  return ok(undefined);
};

// ---------- Def.containers 兑现（需求10.1-10.2；缺陷修补记录于 决策与风险记录.md）----------
//
// 缺陷背景：`Def.containers?: ContainerSpec[]` 与 `Def.slots?: SlotSpec[]` 两个字段自 L1 起
// 就在 Def 接口里声明，但**从未被任何生产代码读取过**——`createContainerForOwner` 只在测试
// 文件里被调用，`entity.create`/`item.create` 从不碰它，`createEntityShape` 永远返回
// `containers: {}`。这不是"少一个便利功能"：Op 全集清单里没有任何 `container.create` Op，
// 意味着若创建时不兑现 `Def.containers`，容器对玩法包层就是**完全不可达的**——04号文档整套
// 背包/槽位系统（双手2格 + 背包2-4格）没有任何合法路径能被搭建出来。
//
// 兑现范围的边界（本实现的判断，记录以便复核）：`ContainerSpec {name, insert, slots?}` 三个
// 字段语义无歧义（容器名、插入模式、初始槎位数量），直接兑现。但 `Def.slots?: SlotSpec[]`
// 该按什么规则映射到"哪个容器的哪个索引"，design.md 3.1节没有规定——若某 Def 同时声明了两个
// 容器，`Def.slots[0]` 归谁完全无从判断。因此本实现**只兑现 ContainerSpec**，为每个容器创建
// `slots` 个无 tags、accepts 为空（即接受任意内容，需求10.8）的槎位；`Def.slots` 保持不被读取，
// 作为悬空字段记录待人工确认其设计意图，不擅自发明映射规则。

/** 为一个宿主对象兑现其 Def 声明的全部容器，返回更新后的 draft（纯函数，不接触事务）。 */
export function materializeDefContainers(
  draft: WorldState,
  ownerId: Id,
  specs: readonly ContainerSpec[],
): WorldState {
  let next = draft;
  for (const spec of specs) {
    const containerId = nextId('c');
    let container = createContainerShape(containerId, ownerId, spec.name, spec.insert);
    const slotCount = spec.slots ?? 0;
    for (let i = 0; i < slotCount; i++) {
      container = insertSlot(container, createSlotShape(nextId('s')));
    }
    next = { ...next, containers: { ...next.containers, [containerId]: container } };
    next = linkContainerToOwner(next, ownerId, spec.name, containerId);
  }
  return next;
}

/** 把 container 的引用挂到宿主的 containers 索引上（Entity 与 Item 都可作为宿主）。 */
function linkContainerToOwner(draft: WorldState, ownerId: Id, name: string, containerId: Id): WorldState {
  const entity = draft.entities[ownerId];
  if (entity) {
    return { ...draft, entities: { ...draft.entities, [ownerId]: { ...entity, containers: { ...entity.containers, [name]: containerId } } } };
  }
  const item = draft.items[ownerId];
  if (item) {
    return { ...draft, items: { ...draft.items, [ownerId]: { ...item, containers: { ...item.containers, [name]: containerId } } } };
  }
  return draft;
}

/** 从一个已解析的 Def 读出其 containers 声明（无声明返回空数组）。 */
function containerSpecsOf(def: Def): readonly ContainerSpec[] {
  const specs = (def as unknown as { containers?: unknown }).containers;
  return Array.isArray(specs) ? (specs as ContainerSpec[]) : [];
}

// ---------- container 便利创建（非 Op 全集清单条目，是 entity.create 等 Op 内部可复用的 helper）----------

export function createContainerForOwner(
  draft: WorldState,
  ownerId: Id,
  name: string,
  insertMode: 'fixed' | 'shift',
): { draft: WorldState; containerId: Id } {
  const containerId = nextId('c');
  const container = createContainerShape(containerId, ownerId, name, insertMode);
  const nextContainers = { ...draft.containers, [containerId]: container };
  let nextDraft = { ...draft, containers: nextContainers };
  const entity = nextDraft.entities[ownerId];
  if (entity) {
    nextDraft = { ...nextDraft, entities: { ...nextDraft.entities, [ownerId]: { ...entity, containers: { ...entity.containers, [name]: containerId } } } };
  }
  const item = nextDraft.items[ownerId];
  if (item) {
    nextDraft = { ...nextDraft, items: { ...nextDraft.items, [ownerId]: { ...item, containers: { ...item.containers, [name]: containerId } } } };
  }
  return { draft: nextDraft, containerId };
}

// ---------- item.move：唯一转移原语（需求16.7, 10.9-10.10） ----------

export interface ItemMoveArgs {
  itemId: Id;
  toContainerId: Id;
  atSlot?: number;
}

export interface ItemMoveDeps {
  exprEngine: ExprEngine;
  evalCtxForSlotAccepts: (containerId: Id, slotIndex: number) => EvalContext;
}

export function makeItemMove(deps: ItemMoveDeps): OpImpl<ItemMoveArgs, void> {
  return (args, ctx) => {
    const draft = ctx.tx.getDraft();
    const item = draft.items[args.itemId];
    if (!item) return err('E_REF_MISSING', `Item ${args.itemId} 不存在`);
    const targetContainer = draft.containers[args.toContainerId];
    if (!targetContainer) return err('E_REF_MISSING', `Container ${args.toContainerId} 不存在`);

    const acceptsPredicate = (slotIndex: number): boolean => {
      const slot = targetContainer.slots[slotIndex];
      if (!slot || !slot.accepts) return true; // accepts 为空时接受任意内容（需求10.8）
      const evalCtx = deps.evalCtxForSlotAccepts(args.toContainerId, slotIndex);
      return deps.exprEngine.eval(slot.accepts, evalCtx) === true;
    };

    let targetIndex: number;
    if (args.atSlot !== undefined) {
      const slot = targetContainer.slots[args.atSlot];
      if (!slot || slot.holds !== undefined || !acceptsPredicate(args.atSlot)) {
        return err('E_OP_SLOT_FULL', `目标槎位 ${args.atSlot} 不可用`);
      }
      targetIndex = args.atSlot;
    } else {
      const found = findDefaultSlotIndex(targetContainer, (slot) => {
        const idx = targetContainer.slots.indexOf(slot);
        return acceptsPredicate(idx);
      });
      if (found === null) return err('E_OP_NO_LEGAL_SLOT', `容器 ${args.toContainerId} 无合法空槎位`); // 需求10.10：不落地不吞掉
      targetIndex = found;
    }

    // 若物品当前在某个源容器槎位中，先清空源槎位
    let nextContainers = draft.containers;
    for (const [cid, c] of Object.entries(draft.containers)) {
      const idx = c.slots.findIndex((s) => s?.holds?.$ === args.itemId);
      if (idx !== -1) {
        nextContainers = { ...nextContainers, [cid]: setSlotHolds(c, idx, undefined) };
      }
    }
    const freshTarget = nextContainers[args.toContainerId] as typeof targetContainer;
    nextContainers = { ...nextContainers, [args.toContainerId]: setSlotHolds(freshTarget, targetIndex, { $: args.itemId }) };

    const nextItem = { ...item, slot: (targetContainer.slots[targetIndex] as { id: Id }).id };
    ctx.tx.setDraft({ ...draft, containers: nextContainers, items: { ...draft.items, [args.itemId]: nextItem } });
    ctx.tx.logOp('item.move', args, () => {});
    return ok(undefined);
  };
}

// ---------- entity.place（design.md 3.2/3.4节 / 需求9.1-9.8, 16.6） ----------
// 缺失 Op 补齐（记录于 决策与风险记录.md）：design.md 3.4节 Op 全集清单列出 entity.place，
// tasks.md 第7步也把它列为 ensureMicroScene/onMicroSceneOccupantsChanged 两个 helper 的唯一
// 合法调用方，但此前实现只搭了这两个纯函数 helper，从未真正注册 entity.place 这个 Op——
// 导致微型场景生命周期虽然有单元测试覆盖纯函数本身，却从未在真实 Op 调用链路里跑过。
// 这里补齐：entity.place 要么直接指定 nodeId（普通拓扑放置），要么指定 microScene 规格
// （按需创建/复用微型场景，需求9.1-9.2），二者恰好提供一个。

export interface EntityPlaceArgs {
  entityId: Id;
  nodeId?: Id;
  microScene?: {
    hostNodeId: Id;
    existingMicroSceneId?: Id;
    microSceneDefId: Id;
    capacity?: number;
  };
}

export function makeEntityPlace(defLookup: DefLookupFn): OpImpl<EntityPlaceArgs, void> {
  return (args, ctx) => {
    const draft = ctx.tx.getDraft();
    const entity = draft.entities[args.entityId];
    if (!entity) return err('E_REF_MISSING', `Entity ${args.entityId} 不存在`);
    if (args.nodeId === undefined && args.microScene === undefined) {
      return err('E_OP_INVALID_ARGS', 'entity.place 需要指定 nodeId 或 microScene 之一');
    }

    let workingDraft = draft;
    let targetNodeId: Id;

    if (args.microScene) {
      const { hostNodeId, existingMicroSceneId, microSceneDefId, capacity } = args.microScene;
      if (!(hostNodeId in workingDraft.nodes)) return err('E_REF_MISSING', `宿主节点 ${hostNodeId} 不存在`);

      // 运行期严厉性缺口修补（见 决策与风险记录.md）：微型场景按需创建时会调用
      // createNodeShape(microSceneDefId, ...)——此前完全绕过 checkInstantiable，任意字符串
      // 都能被当作微型场景的 def 写进新创建的 Node。只在"确实要创建新节点"
      // （existingMicroSceneId 为 null）时才需要校验；复用既有微型场景时不需要重新校验其
      // 历史遗留的 def。
      if (existingMicroSceneId === undefined) {
        const guard = checkInstantiable(defLookup, microSceneDefId, 'node');
        if (!guard.ok) return guard;
      }

      // 需求9.6：capacity 仅在 entity.place 发生时校验。容量检查必须在分配新节点 Id
      // （nextId('n')）之前完成——一次性失败的 place 若先烧掉一个 n 编号，会破坏
      // 「成功 Op 序列 → 幂等快照重放」的持久化定见（bombardment-l12 属性 8 实测暴露：
      // 失败的 entity.place 在采集 run 里推进了 n 计数器，重放 run 的后续成功 create 就偏移一位）。
      // 这里先在宿主节点现有子节点里量出目标微型场景 Id，直接复用同容量判定，不落地任何新节点。
      const preExistingSceneId = existingMicroSceneId ?? findChildMicroScene(workingDraft.nodes, hostNodeId, microSceneDefId);
      const preExistingOccupants = preExistingSceneId
        ? Object.values(workingDraft.entities).filter((e) => e.node === preExistingSceneId).length
        : 0;
      if (capacity !== undefined && !checkMicroSceneCapacity(preExistingOccupants, capacity)) {
        return err('E_OP_SLOT_FULL', `微型场景 ${preExistingSceneId ?? microSceneDefId} 已达到容量上限 ${capacity}`);
      }

      let createdNode: Node | undefined;
      const createNodeFn = (def: Id, opts?: { weight?: number; parent?: Id; props?: Record<string, unknown> }): Node => {
        const newId = nextId('n');
        const shape = createNodeShape(newId, def, { weight: opts?.weight, parent: opts?.parent });
        const withProps = { ...shape, props: { ...shape.props, ...(opts?.props ?? {}) } } as Node;
        createdNode = withProps;
        return withProps;
      };

      const ensured = ensureMicroScene(
        existingMicroSceneId ?? null,
        hostNodeId,
        microSceneDefId,
        { capacity },
        { $: args.entityId },
        createNodeFn,
      );
      if (ensured.created && createdNode) {
        workingDraft = { ...workingDraft, nodes: { ...workingDraft.nodes, [createdNode.id]: createdNode } };
      }
      targetNodeId = ensured.id;
    } else {
      targetNodeId = args.nodeId as Id;
      if (!(targetNodeId in workingDraft.nodes)) return err('E_REF_MISSING', `Node ${targetNodeId} 不存在`);
    }

    const oldNodeId = entity.node;
    const nextEntity = { ...entity, node: targetNodeId, slot: undefined };
    workingDraft = { ...workingDraft, entities: { ...workingDraft.entities, [args.entityId]: nextEntity } };

    // 需求9.3-9.5：离开旧微型场景（parent 字段非空即微型场景，design.md 9.1 的可操作判据）后，
    // 现查占用者数量，归零则级联卸载。
    if (oldNodeId !== undefined && oldNodeId !== targetNodeId) {
      const oldNode = workingDraft.nodes[oldNodeId];
      if (oldNode && oldNode.parent !== undefined) {
        const countOccupants = (nodeId: Id) => Object.values(workingDraft.entities).filter((e) => e.node === nodeId).length;
        const decision = onMicroSceneOccupantsChanged(oldNodeId, countOccupants);
        if (decision.shouldDestroy) {
          const toDestroy = cascadeNodeDestroySet(workingDraft.nodes, oldNodeId);
          let nextNodes = { ...workingDraft.nodes };
          let nextLinks = { ...workingDraft.links };
          for (const nid of toDestroy) {
            for (const lid of linksTouching(nextLinks, nid)) {
              const { [lid]: _l, ...rest } = nextLinks;
              nextLinks = rest;
            }
            const { [nid]: _n, ...rest } = nextNodes;
            nextNodes = rest;
          }
          workingDraft = { ...workingDraft, nodes: nextNodes, links: nextLinks };
        }
      }
    }

    ctx.tx.setDraft(workingDraft);
    ctx.tx.logOp('entity.place', args, () => {});
    return ok(undefined);
  };
}

// ---------- item.promote / entity.demote（需求2.3-2.4） ----------

export interface ItemPromoteArgs {
  itemId: Id;
  nodeId: Id;
}

export const itemPromote: OpImpl<ItemPromoteArgs, Ref> = (args, ctx) => {
  const draft = ctx.tx.getDraft();
  const item = draft.items[args.itemId];
  if (!item) return err('E_REF_MISSING', `Item ${args.itemId} 不存在`);
  if (!(args.nodeId in draft.nodes)) return err('E_REF_MISSING', `Node ${args.nodeId} 不存在`);
  const newId = nextId('e');
  const entity = { ...createEntityShape(newId, item.def), tags: item.tags, props: item.props, node: args.nodeId, attachments: item.attachments, containers: item.containers };
  const { [args.itemId]: _removed, ...restItems } = draft.items;
  ctx.tx.setDraft({ ...draft, items: restItems, entities: { ...draft.entities, [newId]: entity } });
  ctx.tx.logOp('item.promote', args, () => {});
  return ok({ $: newId });
};

export interface EntityDemoteArgs {
  entityId: Id;
  toContainerId: Id;
  atSlot?: number;
}

export function makeEntityDemote(itemMoveImpl: OpImpl<ItemMoveArgs, void>): OpImpl<EntityDemoteArgs, Ref> {
  return (args, ctx) => {
    const draft = ctx.tx.getDraft();
    const entity = draft.entities[args.entityId];
    if (!entity) return err('E_REF_MISSING', `Entity ${args.entityId} 不存在`);
    const newId = nextId('i');
    const item = { ...createItemShape(newId, entity.def), tags: entity.tags, props: entity.props, attachments: entity.attachments, containers: entity.containers };
    const { [args.entityId]: _removed, ...restEntities } = draft.entities;
    ctx.tx.setDraft({ ...draft, entities: restEntities, items: { ...draft.items, [newId]: item } });
    const moveResult = itemMoveImpl({ itemId: newId, toContainerId: args.toContainerId, atSlot: args.atSlot }, ctx);
    if (!moveResult.ok) {
      // 降权失败 → 整体回滚：原 entity 恢复、新 item 不存在、ID 计数器同时回滚（与 stack.split 对称）。
      // 否则一次失败的 demote 会永久吞掉一个 i 编号，破坏「成功 Op 序列 → 幂等快照重放」的持久化定见。
      rollbackNextIdCounter('i');
      return moveResult;
    }
    ctx.tx.logOp('entity.demote', args, () => {});
    return ok({ $: newId });
  };
}

export function registerStructuralOps(registry: OpRegistry, deps: { itemMove: OpImpl<ItemMoveArgs, void>; defLookup: DefLookupFn }): void {
  // 需求19.1/41.2 交叉修补（记录于 决策与风险记录.md）：design.md 3.4节 Op 全集清单把
  // entity/item/node/link.create、slot.add/del、stack.split/merge 全部归入"结构类"，
  // design.md 3.14节更明确要求 QuotaEnforcer 挂在 entity.create 的 before 阶段——但
  // OpRegistry.register 只有 structural:true 的 Op 才会被套上 before/after veto 包装
  // （registry.ts 的 invoke/invokeInline 实现），此前这几个 Op 全部漏了这个标记，导致
  // QuotaEnforcer/玩法包自定义的 before Hook 从未真正有机会拦截它们——这是本次接线复核中
  // 发现的、独立于"Def 实例化校验"之外的第二类真实缺陷，与之前的缺口成因相同：新增 Op 时
  // 忘记对照 design.md 的 Op 全集清单逐项核对 structural 标记。
  registry.register('entity.create', makeEntityCreate(deps.defLookup), { structural: true });
  registry.register('entity.destroy', entityDestroy, { structural: true });
  registry.register('entity.place', makeEntityPlace(deps.defLookup), { structural: true });
  registry.register('item.create', makeItemCreate(deps.defLookup), { structural: true });
  registry.register('item.destroy', itemDestroy, { structural: true });
  registry.register('node.create', makeNodeCreate(deps.defLookup), { structural: true });
  registry.register('node.destroy', nodeDestroy, { structural: true });
  registry.register('link.create', makeLinkCreate(deps.defLookup), { structural: true });
  registry.register('link.destroy', linkDestroy, { structural: true });
  registry.register('slot.add', slotAdd, { structural: true });
  registry.register('slot.del', slotDel, { structural: true });
  registry.register('item.move', deps.itemMove, { structural: true });
  registry.register('item.promote', itemPromote, { structural: true });
  registry.register('entity.demote', makeEntityDemote(deps.itemMove), { structural: true });
}

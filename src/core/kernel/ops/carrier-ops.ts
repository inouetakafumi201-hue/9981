/**
 * L3 Ops: 容器承载活体进出 Op —— `container.enter` / `container.exit`
 *（design.md「容器承载活体写操作」节 / 需求 1.3, 1.7, 2.5, 4.1-4.5, 5.1-5.4）。
 *
 * 补齐既有 `item.move` 硬要求对象在 `draft.items` 导致活体（Entity）无法进槽的缺口。
 * 活体经 `container.enter` 进入容器承载面内部槽，经 `container.exit` 移出。
 * 二者均 `structural:true`，可被 before/after veto 包装拦截（需求 1.7）。
 *
 * 机制底座已在：`Slot.holds: Ref` 类型层本就支持指向 Item（`i:`）或 Entity（`e:`），
 * `checkSingleContainment`/`checkNoContainmentCycle` 对实体/物品一体适用。本模块只补
 * 「让活体进槽」的写通道——结构上与 `item.move` 同构，唯一区别是对象从 `draft.items`
 * 改为 `draft.entities`，且目标必须是 `category:'carrier'` 承载面。
 */
import type { OpImpl } from './registry';
import type { OpRegistry } from './registry';
import { ok, err } from './result';
import type { Id } from '../state/ids';
import { isCarrierSurface } from '../topology/carrier';
import type { ContainerCarryingLiveSurface } from '../topology/carrier';
import { findDefaultSlotIndex, setSlotHolds } from '../topology/container';
import type { ExprEngine, EvalContext } from '../expr/engine';
import type { WorldState } from '../state/world-state';

// ---------- container.enter：把活体放进容器承载面内部槽 ----------

export interface ContainerEnterArgs {
  entityId: Id;
  toContainerId: Id;
  atSlot?: number;
}

export interface ContainerEnterDeps {
  exprEngine: ExprEngine;
  evalCtxForSlotAccepts: (containerId: Id, slotIndex: number) => EvalContext;
  evalCtxForCarrierLiving: (containerId: Id) => EvalContext;
}

export function makeContainerEnter(deps: ContainerEnterDeps): OpImpl<ContainerEnterArgs, void> {
  return (args, ctx) => {
    const draft: WorldState = ctx.tx.getDraft();
    const entity = draft.entities[args.entityId];
    if (!entity) return err('E_REF_MISSING', `Entity ${args.entityId} 不存在`);

    const targetContainer = draft.containers[args.toContainerId];
    if (!targetContainer) return err('E_REF_MISSING', `Container ${args.toContainerId} 不存在`);
    if (!isCarrierSurface(targetContainer)) {
      return err('E_OP_NOT_ACCEPTED', `Container ${args.toContainerId} 不是 category:'carrier' 承载面，不可承载活体`);
    }
    const surface = targetContainer as ContainerCarryingLiveSurface;

    // 需求 2.5 / 5.4：capacity 校验（只在进入时校验）
    if (surface.capacity !== undefined) {
      const occupied = surface.slots.filter((s) => s?.holds !== undefined).length;
      if (occupied >= surface.capacity) {
        return err('E_OP_SLOT_FULL', `承载面 ${args.toContainerId} 已达容量上限 ${surface.capacity}`);
      }
    }

    // 需求 5.2 / 5.3：活体 accept 谓词（仅当承载面声明了 acceptsForLiving）
    if (surface.acceptsForLiving !== undefined) {
      const evalCtx = deps.evalCtxForCarrierLiving(args.toContainerId);
      if (deps.exprEngine.eval(surface.acceptsForLiving, evalCtx) !== true) {
        return err('E_OP_NOT_ACCEPTED', `活体 ${args.entityId} 不满足承载面 ${args.toContainerId} 的 acceptsForLiving 谓词`);
      }
    }

    const acceptsPredicate = (slotIndex: number): boolean => {
      const slot = surface.slots[slotIndex];
      if (!slot || !slot.accepts) return true; // accepts 为空时接受任意内容（需求10.8）
      const evalCtx = deps.evalCtxForSlotAccepts(args.toContainerId, slotIndex);
      return deps.exprEngine.eval(slot.accepts, evalCtx) === true;
    };

    // 选取目标槽位（与 item.move 同构）
    let targetIndex: number;
    if (args.atSlot !== undefined) {
      const slot = surface.slots[args.atSlot];
      if (!slot || slot.holds !== undefined || !acceptsPredicate(args.atSlot)) {
        return err('E_OP_SLOT_FULL', `目标槎位 ${args.atSlot} 不可用`);
      }
      targetIndex = args.atSlot;
    } else {
      const found = findDefaultSlotIndex(surface, (slot) => {
        const idx = surface.slots.indexOf(slot);
        return acceptsPredicate(idx);
      });
      if (found === null) return err('E_OP_NO_LEGAL_SLOT', `承载面 ${args.toContainerId} 无合法空槎位`);
      targetIndex = found;
    }

    // 若活体当前在某个源容器槎位中，先清空源槎位（与 item.move 同构的单一容纳清理）
    let nextContainers = draft.containers;
    for (const [cid, c] of Object.entries(draft.containers)) {
      const idx = c.slots.findIndex((s) => s?.holds?.$ === args.entityId);
      if (idx !== -1) {
        nextContainers = { ...nextContainers, [cid]: setSlotHolds(c, idx, undefined) };
      }
    }

    // 若活体当前在 node 上，先清 node（位置互斥：node/slot 不并存）
    // 直接构建最终 entity：清 node、置 slot（一步到位，避免中间状态）
    const slotId = (surface.slots[targetIndex] as { id: Id }).id;
    const nextEntity = { ...entity, node: undefined, slot: slotId };
    const nextEntities = { ...draft.entities, [args.entityId]: nextEntity };

    // 写入承载面槎位
    const freshTarget = nextContainers[args.toContainerId] as typeof targetContainer;
    nextContainers = {
      ...nextContainers,
      [args.toContainerId]: setSlotHolds(freshTarget, targetIndex, { $: args.entityId }),
    };

    ctx.tx.setDraft({ ...draft, containers: nextContainers, entities: nextEntities });
    ctx.tx.logOp('container.enter', args, () => {});
    return ok(undefined);
  };
}

// ---------- container.exit：把容器承载面内活体移出 ----------

export interface ContainerExitArgs {
  entityId: Id;
  toNode?: Id;
}

export function makeContainerExit(): OpImpl<ContainerExitArgs, void> {
  return (args, ctx) => {
    const draft: WorldState = ctx.tx.getDraft();
    const entity = draft.entities[args.entityId];
    if (!entity) return err('E_REF_MISSING', `Entity ${args.entityId} 不存在`);

    if (entity.slot === undefined) {
      return err('E_OP_INVALID_ARGS', `Entity ${args.entityId} 当前不在任何承载面槽位中`);
    }

    // 在所有容器中找到持有该活体的槎位并清空
    let nextContainers = draft.containers;
    let found = false;
    for (const [cid, c] of Object.entries(draft.containers)) {
      const idx = c.slots.findIndex((s) => s?.holds?.$ === args.entityId);
      if (idx !== -1) {
        nextContainers = { ...nextContainers, [cid]: setSlotHolds(c, idx, undefined) };
        found = true;
        break;
      }
    }
    if (!found) {
      return err('E_OP_NOT_FOUND', `Entity ${args.entityId} 的 slot 字段指向 ${entity.slot} 但未在任何容器槎位中找到`);
    }

    // 释放活体：要么放到指定 node，要么只清 slot（node/slot 互斥）
    let nextEntity: typeof entity;
    if (args.toNode !== undefined) {
      if (!(args.toNode in draft.nodes)) {
        return err('E_REF_MISSING', `Node ${args.toNode} 不存在`);
      }
      nextEntity = { ...entity, slot: undefined, node: args.toNode };
    } else {
      nextEntity = { ...entity, slot: undefined, node: undefined };
    }

    const nextEntities = { ...draft.entities, [args.entityId]: nextEntity };
    ctx.tx.setDraft({ ...draft, containers: nextContainers, entities: nextEntities });
    ctx.tx.logOp('container.exit', args, () => {});
    return ok(undefined);
  };
}

// ---------- 注册 ----------

export interface CarrierOpsDeps extends ContainerEnterDeps {
  containerExit: OpImpl<ContainerExitArgs, void>;
}

export function registerCarrierOps(registry: OpRegistry, deps: CarrierOpsDeps): void {
  registry.register('container.enter', makeContainerEnter(deps), { structural: true });
  registry.register('container.exit', deps.containerExit, { structural: true });
}

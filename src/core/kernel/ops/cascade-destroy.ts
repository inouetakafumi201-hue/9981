/**
 * L3 Ops: 销毁级联清理的共享实现（design.md 需求6.6, 20.1, 20.9, 20.13 / 决策与风险记录.md 记录5, 11, 12）。
 *
 * 背景（用户复核记录5后要求修正）：entity.destroy/item.destroy/node.destroy/link.destroy 四个销毁类
 * Op 此前对"销毁对象时必须清理的三类悬空引用"处理不一致——entity.destroy 只清理了 Relation，
 * 完全没有清理 Attachment（target 指向它的光环/状态）与 Container（它自己拥有的容器，如背包）；
 * item.destroy 反过来只清理了 Container 归属，完全没清理 Relation/Attachment；node.destroy/
 * link.destroy 两者都完全没清理任何 Attachment/Relation。这不是"机制上有区别"，是纯粹的遗漏
 * 不一致——直接验证发现：任何带 Attachment 的实体、任何拥有背包容器的实体，此前都无法被
 * entity.destroy 销毁（InvariantChecker 会在提交前拒绝，整个 Op 直接失败），这与"武器掉落"
 * 这类最基本的死亡处理场景完全不兼容，不是"某些情况该掉落有些不该掉落"的语义问题，是"根本
 * 销毁不掉"的机械故障。
 *
 * 三类清理与"两条纪律"的关系（用户提出本次修正时明确的原则）：
 * - 关系清理、光环/状态清理、容器清理三者都属于"机械纪律"——内核只保证不产生悬空引用，
 *   这与"死于导弹不掉武器、死于近战掉武器"这类具体判定完全无关，内核不做后者的判断。
 * - 容器内的占用者（物品/实体）在容器被销毁时**不会被一并销毁**，只是从槎位中脱离（清空其
 *   slot 字段，保留其自身完整存在）——这是内核唯一被允许做的"默认动作"：既不是"掉落在地上"
 *   （这需要知道地面在哪，是语义判断），也不是"随宿主一起消失"（这会销毁玩家资产，需求17.2-17.3
 *   同样的纪律：不落地不吞掉）。真正的"掉落到地面"由玩法包挂载 before:entity.destroy 的
 *   RuleDef，在这次销毁真正发生前，用 item.move 把容器里的物品转移到当前节点的地面容器——
 *   这正是 before/after Hook 分发点存在的意义：给玩法包一个介入窗口，内核本身不替玩法包做决定。
 */
import type { Id, Ref } from '../state/ids.js';
import type { Entity, Item } from '../state/entity.js';
import type { WorldState } from '../state/world-state.js';
import type { Attachment } from '../state/attachment.js';
import { cascadeRemovalSet } from '../state/attachment.js';
import { removeAllRelationsInvolving } from './relation-ops.js';
import { setSlotHolds } from '../topology/container.js';

/** 计算目标 target 直接及级联（经 grantedBy）应被移除的全部 Attachment id。 */
export function attachmentsCascadeFor(allAttachments: readonly Attachment[], target: Ref): Set<Id> {
  const roots = allAttachments.filter((a) => a.target.$ === target.$).map((a) => a.id);
  const toRemove = new Set<Id>();
  for (const rootId of roots) {
    for (const id of cascadeRemovalSet(allAttachments, rootId)) toRemove.add(id);
  }
  return toRemove;
}

/**
 * 对任意被销毁的对象（Entity/Item/Node/Link 均可作为 Attachment.target 或 Relation 端点，
 * design.md 3.1节：Attachment.target 泛化为可指向 Entity/Item/Node/Link/World）做关系与附着
 * 清理，返回清理后的 entities 与 attachments 快照。不处理容器归属（Node/Link 没有 containers
 * 字段，容器专属清理见下方 destroyOwnedContainers，只适用于 Entity/Item）。
 */
export function cascadeRelationsAndAttachments(
  draft: WorldState,
  ref: Ref,
): { entities: Record<Id, Entity>; attachments: Record<Id, Attachment> } {
  const entitiesAfterRelations = removeAllRelationsInvolving(draft.entities, ref);
  const allAttachments = Object.values(draft.world.attachments) as Attachment[];
  const toRemove = attachmentsCascadeFor(allAttachments, ref);
  let nextAttachments = draft.world.attachments;
  for (const id of toRemove) {
    const { [id]: _removed, ...rest } = nextAttachments;
    nextAttachments = rest;
  }
  return { entities: entitiesAfterRelations, attachments: nextAttachments };
}

/**
 * 销毁 ownerContainers 列出的全部容器（Entity/Item 自身拥有的命名容器，如背包）。
 * 容器内被容纳的占用者（Item 或 Entity，需求10.6 二者皆可为 Slot.holds）不会被销毁，
 * 只清空其 slot 字段脱离槎位——保留其完整存在供玩法包决定去向（见文件头注释的机械纪律说明）。
 * 不递归：被脱离的占用者自身若也拥有容器，其容器结构完整保留，因为它本身没有被销毁。
 */
export function destroyOwnedContainers(draft: WorldState, ownerContainers: Record<string, Id>): WorldState {
  let nextContainers = draft.containers;
  let nextItems = draft.items;
  let nextEntities = draft.entities;
  for (const containerId of Object.values(ownerContainers)) {
    const container = nextContainers[containerId];
    if (!container) continue;
    for (const slot of container.slots) {
      const heldRef = slot?.holds;
      if (!heldRef) continue;
      const heldItem = nextItems[heldRef.$];
      if (heldItem) {
        const rest: Item = { ...heldItem, slot: undefined };
        nextItems = { ...nextItems, [heldRef.$]: rest };
        continue;
      }
      const heldEntity = nextEntities[heldRef.$];
      if (heldEntity) {
        const rest: Entity = { ...heldEntity, slot: undefined };
        nextEntities = { ...nextEntities, [heldRef.$]: rest };
      }
    }
    const { [containerId]: _removed, ...restContainers } = nextContainers;
    nextContainers = restContainers;
  }
  return { ...draft, containers: nextContainers, items: nextItems, entities: nextEntities };
}

/**
 * 若被销毁的对象自身当前正被某个容器的槎位持有（design.md 3.2节：Slot.holds 可指向
 * Item 或 Entity），清空该槎位的 holds 字段，避免留下悬空引用（需求20.1）。
 * 这与 destroyOwnedContainers 是相反方向的清理：后者处理"我拥有的容器"，本函数处理
 * "我正被别人的容器持有"。二者都要做，因为一个 Entity 既可能拥有背包容器，也可能同时
 * 正站在别的容器（如载具座位）的某个槎位里。
 */
export function clearHoldingSlot(draft: WorldState, ref: Ref): WorldState {
  let nextContainers = draft.containers;
  for (const [cid, c] of Object.entries(draft.containers)) {
    const idx = c.slots.findIndex((s) => s?.holds?.$ === ref.$);
    if (idx !== -1) {
      nextContainers = { ...nextContainers, [cid]: setSlotHolds(c, idx, undefined) };
    }
  }
  return { ...draft, containers: nextContainers };
}

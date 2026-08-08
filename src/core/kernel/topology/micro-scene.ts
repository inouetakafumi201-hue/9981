/**
 * L1 Topology: 微型场景生命周期（design.md 3.2节 / 需求9.1-9.8）。
 *
 * ensureMicroScene / onMicroSceneOccupantsChanged 均为私有 helper，只能被 entity.place/
 * prefab.spawn/prefab.despawn 等 Op 的实现内部调用（design.md 写入通道情形b）——不注册为独立 Op，
 * 不对外暴露。占用者数量由现查 Query 得出，不维护派生计数字段（需求9.4）。
 */
import type { Id, Ref } from '../state/ids.js';
import type { Node } from './types.js';

export interface MicroSceneSpec {
  capacity?: number;
}

export interface CreateNodeFn {
  (def: Id, opts?: { weight?: number; parent?: Id; props?: Record<string, unknown> }): Node;
}

/**
 * 确保某个宿主节点下、由 trigger 触发的微型场景存在；若已存在（由某种"既有场景 Id"传入判断）
 * 则直接返回；否则调用同一份 node.create 的内部实现创建，并在 props.creator 记录一次触发来源
 * 仅供溯源（需求9.2），不作为占用判断依据（需求9.3）。
 *
 * 本函数不自行维护"是否已存在"的状态——调用方（entity.place 的 Op 实现）负责传入
 * existingMicroSceneId（例如从 hostNode 的某个已知子节点中查找），这里只负责创建分支。
 */
export function ensureMicroScene(
  existingMicroSceneId: Id | null,
  hostNodeId: Id,
  microSceneDefId: Id,
  spec: MicroSceneSpec,
  triggerRef: Ref,
  createNode: CreateNodeFn,
): { id: Id; created: boolean; node?: Node } {
  if (existingMicroSceneId !== null) {
    return { id: existingMicroSceneId, created: false };
  }
  const node = createNode(microSceneDefId, {
    parent: hostNodeId,
    props: { creator: triggerRef, capacity: spec.capacity },
  });
  return { id: node.id, created: true, node };
}

/**
 * 微型场景占用者数量变化后的判定：现查占用者数量（由调用方传入的 countOccupants 函数完成查询），
 * 归零时返回 shouldDestroy:true，由调用方（entity.place/prefab.despawn 的 Op 实现）据此调用
 * node.destroy 的内部实现完成卸载。本函数本身不执行销毁，只做判定（保持纯函数、可测试）。
 */
export function onMicroSceneOccupantsChanged(
  microSceneId: Id,
  countOccupants: (nodeId: Id) => number,
): { shouldDestroy: boolean } {
  const count = countOccupants(microSceneId);
  return { shouldDestroy: count <= 0 };
}

/** props.capacity 校验（需求9.6）：仅在 entity.place 时调用本函数校验是否超出容量。 */
export function checkMicroSceneCapacity(currentOccupants: number, capacity: number | undefined): boolean {
  if (capacity === undefined) return true;
  return currentOccupants < capacity;
}

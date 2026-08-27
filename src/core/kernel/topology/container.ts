/**
 * L1 Topology: Container/Slot 索引连续性（design.md 3.2节 / 需求10.1-10.10）。
 * insert:'fixed' 的删除留空洞（undefined）；insert:'shift' 的删除用 splice 语义前移。
 * 这些函数是 slot.add/slot.del/item.move 这些公开 Op 内部调用的纯函数 helper（写入通道情形b）。
 */
import type { Ref } from '../state/ids';
import type { Container, Slot } from './types';

/** 在 fixed 容器中插入槎位：追加到末尾，不移位既有槎位。 */
export function insertSlotFixed(container: Container, slot: Slot): Container {
  return { ...container, slots: [...container.slots, slot] };
}

/** 在 shift 容器中插入槎位：追加到末尾（插入语义本身不移位，元素后移发生在"插入到中间索引"场景，
 *  本内核的 slot.add 只支持末尾追加，中间插入超出 slot.add 的语义范围）。 */
export function insertSlotShift(container: Container, slot: Slot): Container {
  return { ...container, slots: [...container.slots, slot] };
}

/** fixed 容器删除指定索引的槎位：留空洞（该位置置为 undefined，占位保留其余索引不变）。 */
export function removeSlotFixed(container: Container, index: number): Container {
  const slots = [...container.slots];
  delete slots[index]; // 故意在数组中打洞：fixed 语义要求索引连续存在但内容可为空槎位标记
  return { ...container, slots };
}

/** shift 容器删除指定索引的槎位：splice 移除，后续元素前移，不留空洞。 */
export function removeSlotShift(container: Container, index: number): Container {
  const slots = [...container.slots];
  slots.splice(index, 1);
  return { ...container, slots };
}

export function removeSlot(container: Container, index: number): Container {
  return container.insert === 'fixed' ? removeSlotFixed(container, index) : removeSlotShift(container, index);
}

export function insertSlot(container: Container, slot: Slot): Container {
  return container.insert === 'fixed' ? insertSlotFixed(container, slot) : insertSlotShift(container, slot);
}

/**
 * 缺省槎位选取（需求10.9）：按索引顺序线性扫描，取第一个 accepts 通过（由调用方传入判定函数）且
 * holds 为空的索引。找不到返回 null（需求10.10：不得放置于容器之外，也不得销毁物品）。
 */
export function findDefaultSlotIndex(
  container: Container,
  accepts: (slot: Slot) => boolean,
): number | null {
  for (let i = 0; i < container.slots.length; i++) {
    const slot = container.slots[i];
    if (slot === undefined) continue; // fixed 容器的空洞
    if (slot.holds !== undefined) continue;
    if (accepts(slot)) return i;
  }
  return null;
}

export function setSlotHolds(container: Container, index: number, holds: Ref | undefined): Container {
  const slots = [...container.slots];
  const existing = slots[index];
  if (existing === undefined) return container;
  slots[index] = { ...existing, holds };
  return { ...container, slots };
}

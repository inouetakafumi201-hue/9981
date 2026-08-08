import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { insertSlot, removeSlot, findDefaultSlotIndex, setSlotHolds } from '../container.js';
import { createContainerShape, createSlotShape } from '../types.js';
import type { Container } from '../types.js';

describe('Property 22: 容器索引的插入语义（需求10.4-10.5）', () => {
  it('fixed 容器插入不改变既有槎位索引', () => {
    let c = createContainerShape('c:1', 'e:1', 'main', 'fixed');
    c = insertSlot(c, createSlotShape('s:1'));
    c = insertSlot(c, createSlotShape('s:2'));
    const beforeIds = c.slots.map((s) => s?.id);
    c = insertSlot(c, createSlotShape('s:3'));
    expect(c.slots.slice(0, 2).map((s) => s?.id)).toEqual(beforeIds);
  });

  it('fixed 容器删除留空洞', () => {
    let c = createContainerShape('c:1', 'e:1', 'main', 'fixed');
    c = insertSlot(c, createSlotShape('s:1'));
    c = insertSlot(c, createSlotShape('s:2'));
    c = insertSlot(c, createSlotShape('s:3'));
    c = removeSlot(c, 1);
    expect(c.slots.length).toBe(3);
    expect(c.slots[1]).toBeUndefined();
    expect(c.slots[0]?.id).toBe('s:1');
    expect(c.slots[2]?.id).toBe('s:3');
  });

  it('shift 容器删除后不留空洞，后续元素前移', () => {
    let c = createContainerShape('c:1', 'e:1', 'main', 'shift');
    c = insertSlot(c, createSlotShape('s:1'));
    c = insertSlot(c, createSlotShape('s:2'));
    c = insertSlot(c, createSlotShape('s:3'));
    c = removeSlot(c, 0);
    expect(c.slots.length).toBe(2);
    expect(c.slots[0]?.id).toBe('s:2');
    expect(c.slots[1]?.id).toBe('s:3');
  });

  it('findDefaultSlotIndex 按索引顺序取第一个满足条件且为空的槎位（需求10.9）', () => {
    let c = createContainerShape('c:1', 'e:1', 'main', 'fixed');
    c = insertSlot(c, createSlotShape('s:1'));
    c = insertSlot(c, createSlotShape('s:2'));
    c = setSlotHolds(c, 0, { $: 'i:1' });
    const idx = findDefaultSlotIndex(c, () => true);
    expect(idx).toBe(1);
  });

  it('findDefaultSlotIndex 找不到合法槎位时返回 null（需求10.10）', () => {
    let c = createContainerShape('c:1', 'e:1', 'main', 'fixed');
    c = insertSlot(c, createSlotShape('s:1'));
    c = setSlotHolds(c, 0, { $: 'i:1' });
    expect(findDefaultSlotIndex(c, () => true)).toBeNull();
  });

  it('Property: fixed 插入不移位其余已占用槎位索引', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 0, max: 9 }), (n, insertCount) => {
        let c = createContainerShape('c:1', 'e:1', 'main', 'fixed');
        for (let i = 0; i < n; i++) c = insertSlot(c, createSlotShape(`s:${i}`));
        const before = c.slots.map((s) => s?.id);
        for (let i = 0; i < insertCount; i++) c = insertSlot(c, createSlotShape(`extra:${i}`));
        expect(c.slots.slice(0, n).map((s) => s?.id)).toEqual(before);
      }),
      { numRuns: 100 },
    );
  });

  it('Property: shift 删除操作后不存在索引空洞', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 0, max: 9 }), (n, removeIdx) => {
        fc.pre(removeIdx < n);
        let c: Container = createContainerShape('c:1', 'e:1', 'main', 'shift');
        for (let i = 0; i < n; i++) c = insertSlot(c, createSlotShape(`s:${i}`));
        c = removeSlot(c, removeIdx);
        expect(c.slots.length).toBe(n - 1);
        expect(c.slots.every((s) => s !== undefined)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

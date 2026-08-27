import { describe, it, expect } from 'vitest';
import { InvariantChecker } from '../invariants';
import { createEmptyWorldState } from '../../state/world-state';
import { createEntityShape } from '../../state/entity';
import { createItemShape } from '../../state/entity';
import { createContainerShape, createSlotShape } from '../../topology/types';

describe('InvariantChecker: 16 条不变量（需求20.1-20.16）', () => {
  it('空状态没有任何不变量违反', () => {
    const checker = new InvariantChecker();
    const state = createEmptyWorldState('sched:1');
    expect(checker.checkAll(state)).toEqual([]);
  });

  it('检测位置互斥违反：Entity.node 与 slot 同时非空', () => {
    const checker = new InvariantChecker();
    let state = createEmptyWorldState('sched:1');
    const e = { ...createEntityShape('e:1', 'd:human'), node: 'n:1', slot: 's:1' };
    state = { ...state, entities: { 'e:1': e } };
    const diags = checker.checkAll(state);
    expect(diags.some((d) => d.code === 'E_INV_LOCATION_EXCLUSIVE')).toBe(true);
  });

  it('检测堆叠有界违反：stack < 1', () => {
    const checker = new InvariantChecker();
    let state = createEmptyWorldState('sched:1');
    const item = { ...createItemShape('i:1', 'd:sword'), stack: 0 };
    state = { ...state, items: { 'i:1': item } };
    const diags = checker.checkAll(state);
    expect(diags.some((d) => d.code === 'E_INV_STACK_BOUNDED')).toBe(true);
  });

  it('检测堆叠有界违反：stack > stackMax', () => {
    const checker = new InvariantChecker();
    let state = createEmptyWorldState('sched:1');
    const item = { ...createItemShape('i:1', 'd:sword'), stack: 10, stackMax: 5 };
    state = { ...state, items: { 'i:1': item } };
    const diags = checker.checkAll(state);
    expect(diags.some((d) => d.code === 'E_INV_STACK_BOUNDED')).toBe(true);
  });

  it('检测数值有界违反：props 中含 NaN', () => {
    const checker = new InvariantChecker();
    let state = createEmptyWorldState('sched:1');
    const e = { ...createEntityShape('e:1', 'd:human'), props: { hp: NaN } };
    state = { ...state, entities: { 'e:1': e } };
    const diags = checker.checkAll(state);
    expect(diags.some((d) => d.code === 'E_INV_NAN_OR_INFINITY')).toBe(true);
  });

  it('检测容器双向一致违反：owner.containers 未指回 container', () => {
    const checker = new InvariantChecker();
    let state = createEmptyWorldState('sched:1');
    const container = createContainerShape('c:1', 'e:1', 'main', 'fixed');
    const e = createEntityShape('e:1', 'd:human'); // containers 为空，未记录 c:1
    state = { ...state, entities: { 'e:1': e }, containers: { 'c:1': container } };
    const diags = checker.checkAll(state);
    expect(diags.some((d) => d.code === 'E_INV_CONTAINER_BIDIRECTIONAL')).toBe(true);
  });

  it('容器双向一致：正确指回时不报错', () => {
    const checker = new InvariantChecker();
    let state = createEmptyWorldState('sched:1');
    const container = createContainerShape('c:1', 'e:1', 'main', 'fixed');
    const e = { ...createEntityShape('e:1', 'd:human'), containers: { main: 'c:1' } };
    state = { ...state, entities: { 'e:1': e }, containers: { 'c:1': container } };
    const diags = checker.checkAll(state);
    expect(diags.filter((d) => d.code === 'E_INV_CONTAINER_BIDIRECTIONAL')).toEqual([]);
  });

  it('检测单一容纳违反：同一对象被两个槎位容纳', () => {
    const checker = new InvariantChecker();
    let state = createEmptyWorldState('sched:1');
    let c1 = createContainerShape('c:1', 'e:1', 'main', 'fixed');
    c1 = { ...c1, slots: [createSlotShape('s:1')] };
    c1 = { ...c1, slots: [{ ...c1.slots[0]!, holds: { $: 'i:1' } }] };
    let c2 = createContainerShape('c:2', 'e:2', 'main', 'fixed');
    c2 = { ...c2, slots: [createSlotShape('s:2')] };
    c2 = { ...c2, slots: [{ ...c2.slots[0]!, holds: { $: 'i:1' } }] };
    state = { ...state, containers: { 'c:1': c1, 'c:2': c2 } };
    const diags = checker.checkAll(state);
    expect(diags.some((d) => d.code === 'E_INV_SINGLE_CONTAINMENT')).toBe(true);
  });

  it('检测槎位索引连续违反：shift 容器含空洞', () => {
    const checker = new InvariantChecker();
    let state = createEmptyWorldState('sched:1');
    const c = createContainerShape('c:1', 'e:1', 'main', 'shift');
    const slots = [createSlotShape('s:1')];
    // @ts-expect-error 故意制造空洞用于测试
    slots[1] = undefined;
    state = { ...state, containers: { 'c:1': { ...c, slots } } };
    const diags = checker.checkAll(state);
    expect(diags.some((d) => d.code === 'E_INV_SLOT_INDEX_CONTINUITY')).toBe(true);
  });

  it('检测引用完整性违反：Attachment.target 悬空', () => {
    const checker = new InvariantChecker();
    let state = createEmptyWorldState('sched:1');
    state = {
      ...state,
      world: {
        ...state.world,
        attachments: { 'a:1': { id: 'a:1', def: 'd:buff', target: { $: 'e:999' }, props: {}, stack: 1 } },
      },
    };
    const diags = checker.checkAll(state);
    expect(diags.some((d) => d.code === 'E_INV_ATTACHMENT_CONSISTENCY')).toBe(true);
  });
});

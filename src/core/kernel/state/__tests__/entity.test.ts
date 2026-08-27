import { describe, it, expect } from 'vitest';
import { createEntityShape, createItemShape } from '../entity';

describe('Entity / Item 基本结构（需求2.1-2.4）', () => {
  it('createEntityShape 产生 node/slot 均为空的初始结构（互斥由 InvariantChecker 校验）', () => {
    const e = createEntityShape('e:1', 'd:human');
    expect(e.node).toBeUndefined();
    expect(e.slot).toBeUndefined();
    expect(e.containers).toEqual({});
    expect(e.attachments).toEqual([]);
    expect(e.relations).toEqual({});
  });

  it('createItemShape 产生初始结构', () => {
    const i = createItemShape('i:1', 'd:sword');
    expect(i.slot).toBeUndefined();
    expect(i.containers).toEqual({});
  });
});

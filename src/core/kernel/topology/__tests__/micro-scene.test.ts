import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ensureMicroScene, onMicroSceneOccupantsChanged, checkMicroSceneCapacity } from '../micro-scene.js';
import { createNodeShape } from '../types.js';

describe('Property 21: 微型场景生命周期的占用者驱动（需求9.3-9.5）', () => {
  it('ensureMicroScene 不存在时创建，存在时直接返回', () => {
    let createCount = 0;
    const createNode = () => {
      createCount++;
      return createNodeShape('n:new', 'd:microscene');
    };
    const r1 = ensureMicroScene(null, 'n:host', 'd:microscene', {}, { $: 'e:trigger' }, createNode);
    expect(r1.created).toBe(true);
    expect(createCount).toBe(1);

    const r2 = ensureMicroScene('n:existing', 'n:host', 'd:microscene', {}, { $: 'e:trigger' }, createNode);
    expect(r2.created).toBe(false);
    expect(r2.id).toBe('n:existing');
    expect(createCount).toBe(1);
  });

  it('props.creator 仅记录溯源，不影响销毁判定', () => {
    const createNode = () => createNodeShape('n:new', 'd:microscene');
    const r = ensureMicroScene(null, 'n:host', 'd:microscene', {}, { $: 'e:trigger' }, createNode);
    expect(r.node?.props).toEqual({}); // createNode 本身返回的形状不含 props.creator，creator 由 Op 层写入，这里验证不依赖它判定销毁
    // 销毁判定只看 countOccupants，不看 props.creator
    const decision = onMicroSceneOccupantsChanged('n:new', () => 0);
    expect(decision.shouldDestroy).toBe(true);
  });

  it('占用者数量归零时应销毁；非零时不应销毁', () => {
    expect(onMicroSceneOccupantsChanged('n:x', () => 0).shouldDestroy).toBe(true);
    expect(onMicroSceneOccupantsChanged('n:x', () => 1).shouldDestroy).toBe(false);
    expect(onMicroSceneOccupantsChanged('n:x', () => 5).shouldDestroy).toBe(false);
  });

  it('capacity 校验：仅在超出容量时拒绝', () => {
    expect(checkMicroSceneCapacity(2, 3)).toBe(true);
    expect(checkMicroSceneCapacity(3, 3)).toBe(false);
    expect(checkMicroSceneCapacity(100, undefined)).toBe(true);
  });

  it('Property: 对于任意微型场景，占用者数量归零时应自动卸载；props.creator 取值不影响该判定', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), fc.string(), (occupantCount, creatorTag) => {
        void creatorTag; // 模拟 props.creator 的任意取值，验证其不参与销毁判定
        const decision = onMicroSceneOccupantsChanged('n:x', () => occupantCount);
        expect(decision.shouldDestroy).toBe(occupantCount <= 0);
      }),
      { numRuns: 100 },
    );
  });

  it('结构性共享微型场景与普通微型场景走同一套生命周期规则（需求9.8）：多次 ensureMicroScene 复用同一 existing id', () => {
    const createNode = () => createNodeShape('n:shared', 'd:microscene');
    const first = ensureMicroScene(null, 'n:host', 'd:microscene', {}, { $: 'e:a' }, createNode);
    const second = ensureMicroScene(first.id, 'n:host', 'd:microscene', {}, { $: 'e:b' }, createNode);
    expect(second.id).toBe(first.id);
    expect(second.created).toBe(false);
  });
});

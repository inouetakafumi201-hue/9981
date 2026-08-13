import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { compareRevision } from '../../../model/revision.js';
import { INPUT_SOURCES } from '../../../model/intent.js';
import {
  DAMAGED_DESCRIPTOR_FIELDS,
  ENTITY_ID_POOL,
  arbAgent,
  arbDamagedDescriptor,
  arbDescriptor,
  arbHiddenVariantPair,
  arbInputSource,
  arbLegalActionSet,
  arbReachableProjection,
  arbRevisionPair,
  replayReachableProjection,
} from '../arbitraries.js';

describe('固定小标识池被跨生成器复用', () => {
  it('池大小严格为 8，Agent、可达投影和隐藏变体只使用池内实体', () => {
    expect(ENTITY_ID_POOL).toHaveLength(8);
    const pool = new Set<string>(ENTITY_ID_POOL);
    fc.assert(
      fc.property(arbAgent(), arbReachableProjection(), arbHiddenVariantPair(), (agent, reachable, pair) => {
        expect(agent.scope.visibleEntityIds.every((id) => pool.has(id))).toBe(true);
        expect(reachable.projection.entities.every((entity) => pool.has(entity.entityId))).toBe(true);
        expect(pair[0].hidden.every((entry) => pool.has(entry.entityId))).toBe(true);
        expect(pair[1].hidden.every((entry) => pool.has(entry.entityId))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

describe('可达投影由合法初态与合法动作序列生成', () => {
  it('独立重放每个生成轨迹都逐字段得到同一最终投影', () => {
    fc.assert(
      fc.property(arbReachableProjection(), (generated) => {
        const replayed = replayReachableProjection(generated.initial, generated.actions);
        expect(replayed).toStrictEqual(generated.projection);
        expect(Object.isFrozen(generated.projection)).toBe(true);
        expect(Object.isFrozen(generated.projection.entities)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

describe('隐藏变体不空转', () => {
  it('共享可见投影恒等且隐藏部分保证非空、保证不同', () => {
    fc.assert(
      fc.property(arbHiddenVariantPair(), ([left, right]) => {
        fc.pre(JSON.stringify(left.hidden) !== JSON.stringify(right.hidden));
        expect(left.visibleProjection).toStrictEqual(right.visibleProjection);
        expect(left.hidden.length).toBeGreaterThan(0);
        expect(right.hidden.length).toBeGreaterThan(0);
        expect(left.hidden).not.toStrictEqual(right.hidden);
      }),
      { numRuns: 100 },
    );
  });
});

describe('描述符、动作集、输入来源与修订对', () => {
  it('合法描述符生成完整闭合桶', () => {
    fc.assert(
      fc.property(arbDescriptor(), (descriptor) => {
        expect(descriptor.scopeId).not.toBe('');
        expect(Array.isArray(descriptor.resources)).toBe(true);
        expect(Array.isArray(descriptor.paidActions)).toBe(true);
        expect(Array.isArray(descriptor.attachedActions)).toBe(true);
        expect(Object.isFrozen(descriptor)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('逐字段损坏生成器确实损坏指定字段', () => {
    for (const field of DAMAGED_DESCRIPTOR_FIELDS) {
      const samples = fc.sample(arbDamagedDescriptor(field), 10);
      expect(samples).toHaveLength(10);
      expect(samples.every((sample) => sample.field === field)).toBe(true);
      expect(samples.every((sample) => Object.isFrozen(sample.descriptor))).toBe(true);
    }
  });

  it.each([0, 1, 5, 6, 50])('动作集支持精确大小 %i', (size) => {
    fc.assert(
      fc.property(arbLegalActionSet(size), (actions) => {
        expect(actions).toHaveLength(size);
        expect(new Set(actions.map((action) => action.actionId)).size).toBe(size);
        expect(actions.every((action) => ENTITY_ID_POOL.includes(action.bindings[0]?.value as never))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('输入来源覆盖闭合集合且不产生额外值', () => {
    const samples = fc.sample(arbInputSource(), 200);
    expect(new Set(samples)).toEqual(new Set(INPUT_SOURCES));
  });

  it('修订对包含四种比较关系，尤其包含 uncomparable', () => {
    const samples = fc.sample(arbRevisionPair(), 200);
    for (const pair of samples) expect(compareRevision(pair.left, pair.right)).toBe(pair.expected);
    expect(new Set(samples.map((pair) => pair.expected))).toEqual(
      new Set(['same', 'newer', 'older', 'uncomparable']),
    );
  });
});

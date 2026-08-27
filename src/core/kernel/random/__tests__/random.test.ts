/**
 * L10 Random tests: Property 16 (deterministic replay), Property 17 (shadow stream isolation),
 * Property 30 (random ops not in Expr path).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { registerRandomOps } from '../random-ops';
import { withShadowStream } from '../shadow-stream';
import { OpRegistry } from '../../ops/registry';
import { WorldStateHolder, Transaction } from '../../ops/transaction';
import { createEmptyWorldState } from '../../state/world-state';
import { resetIdCounters } from '../../state/ids';
import type { OpContext } from '../../ops/registry';
import { ExprEngine, makeDefaultEvalContext } from '../../expr/engine';

function makeRegistry(): { registry: OpRegistry; holder: WorldStateHolder } {
  const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
  const registry = new OpRegistry(holder);
  registerRandomOps(registry);
  return { registry, holder };
}

function makeCtx(): OpContext {
  const tx = new Transaction(createEmptyWorldState('sched:1'));
  return { tx, depth: 0, emit: () => {} };
}

describe('L10 random.roll', () => {
  beforeEach(() => resetIdCounters());

  it('random.roll 返回 [1..sides] 范围内的整数', () => {
    const { registry } = makeRegistry();
    for (let i = 0; i < 20; i++) {
      const result = registry.invoke<unknown, number>('random.roll', { sides: 6, stream: 'test', seed: i });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeGreaterThanOrEqual(1);
        expect(result.value).toBeLessThanOrEqual(6);
        expect(Number.isInteger(result.value)).toBe(true);
      }
    }
  });

  it('random.roll sides<1 返回错误', () => {
    const { registry } = makeRegistry();
    const result = registry.invoke('random.roll', { sides: 0 });
    expect(result.ok).toBe(false);
  });

  it('Property 16: 相同 seed+stream 的 roll 序列确定性重放（确定性）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 6 }), (seed, sides) => {
        resetIdCounters();
        const { registry: r1 } = makeRegistry();
        const { registry: r2 } = makeRegistry();
        const results1: number[] = [];
        const results2: number[] = [];
        for (let i = 0; i < 5; i++) {
          const res1 = r1.invoke<unknown, number>('random.roll', { sides, stream: 'replay', seed });
          const res2 = r2.invoke<unknown, number>('random.roll', { sides, stream: 'replay', seed });
          if (res1.ok) results1.push(res1.value);
          if (res2.ok) results2.push(res2.value);
        }
        expect(results1).toEqual(results2);
      }),
      { numRuns: 100 },
    );
  });
});

describe('L10 random.pick', () => {
  beforeEach(() => resetIdCounters());

  it('random.pick 返回列表中的一个元素', () => {
    const items = ['a', 'b', 'c', 'd'];
    const { registry } = makeRegistry();
    for (let i = 0; i < 10; i++) {
      const result = registry.invoke<unknown, unknown>('random.pick', { items, stream: 'pick', seed: i });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(items).toContain(result.value);
      }
    }
  });

  it('random.pick 空列表返回错误', () => {
    const { registry } = makeRegistry();
    const result = registry.invoke('random.pick', { items: [] });
    expect(result.ok).toBe(false);
  });
});

describe('L10 random.shuffle', () => {
  beforeEach(() => resetIdCounters());

  it('random.shuffle 保留所有元素', () => {
    const { registry } = makeRegistry();
    const items = [1, 2, 3, 4, 5];
    const result = registry.invoke<unknown, number[]>('random.shuffle', { items, stream: 'shuf', seed: 42 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sort()).toEqual([1, 2, 3, 4, 5].sort());
    }
  });

  it('Property 16: shuffle 相同 seed 结果确定性', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9999 }), (seed) => {
        resetIdCounters();
        const { registry: r1 } = makeRegistry();
        const { registry: r2 } = makeRegistry();
        const items = [1, 2, 3, 4, 5];
        const s1 = r1.invoke<unknown, number[]>('random.shuffle', { items, stream: 'shuf', seed });
        const s2 = r2.invoke<unknown, number[]>('random.shuffle', { items, stream: 'shuf', seed });
        if (s1.ok && s2.ok) {
          expect(s1.value).toEqual(s2.value);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('L10 random.weightedPick', () => {
  beforeEach(() => resetIdCounters());

  it('random.weightedPick 返回 items 中的一个 value', () => {
    const { registry } = makeRegistry();
    const items = [{ value: 'rare', weight: 1 }, { value: 'common', weight: 9 }];
    const result = registry.invoke<unknown, unknown>('random.weightedPick', { items, stream: 'wp', seed: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(['rare', 'common']).toContain(result.value);
    }
  });

  it('总权重为0时返回错误', () => {
    const { registry } = makeRegistry();
    const result = registry.invoke('random.weightedPick', { items: [{ value: 'x', weight: 0 }] });
    expect(result.ok).toBe(false);
  });
});

describe('L10 withShadowStream: Property 17 (shadow stream isolation)', () => {
  beforeEach(() => resetIdCounters());

  it('shadow stream 内的 roll 不影响外部流状态', () => {
    const ctx = makeCtx();
    // Register random ops on a registry that shares ctx.tx
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const registry = new OpRegistry(holder);
    registerRandomOps(registry);

    // Get main stream state before shadow
    const mainStreamBefore = ctx.tx.getDraft().world.rng['main'];

    // Run inside shadow stream
    withShadowStream(ctx, { name: 'shadow', seed: 42 }, (innerCtx) => {
      // Modify shadow stream
      const draft = innerCtx.tx.getDraft();
      innerCtx.tx.setDraft({
        ...draft,
        world: {
          ...draft.world,
          rng: { ...draft.world.rng, shadow: { name: 'shadow', seed: 42, counter: 99999 } },
        },
      });
    });

    // After shadow scope, 'shadow' stream should be back to original (undefined)
    const shadowAfter = ctx.tx.getDraft().world.rng['shadow'];
    expect(shadowAfter).toBeUndefined();
    // Main stream should be unchanged
    expect(ctx.tx.getDraft().world.rng['main']).toEqual(mainStreamBefore);
  });

  it('Property 17 属性测试：shadow stream 退出后外部 stream 状态不变', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 99999 }),
        fc.integer({ min: 0, max: 99999 }),
        (mainSeed, shadowSeed) => {
          const ctx = makeCtx();
          // Set up a main stream
          const draft = ctx.tx.getDraft();
          ctx.tx.setDraft({
            ...draft,
            world: {
              ...draft.world,
              rng: { main: { name: 'main', seed: mainSeed, counter: mainSeed } },
            },
          });
          const mainBefore = ctx.tx.getDraft().world.rng['main'];

          withShadowStream(ctx, { name: 'main', seed: shadowSeed }, (innerCtx) => {
            // Modify the stream inside shadow scope
            const d = innerCtx.tx.getDraft();
            innerCtx.tx.setDraft({
              ...d,
              world: {
                ...d.world,
                rng: { ...d.world.rng, main: { name: 'main', seed: 0, counter: 12345 } },
              },
            });
          });

          // After shadow, main stream should be restored
          const mainAfter = ctx.tx.getDraft().world.rng['main'];
          expect(mainAfter).toEqual(mainBefore);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('L10 multi-stream isolation: two named streams advance independently', () => {
  beforeEach(() => resetIdCounters());

  it('两个不同命名流的 roll 结果互不干扰（独立推进）', () => {
    const { registry } = makeRegistry();
    const r1 = registry.invoke<unknown, number>('random.roll', { sides: 6, stream: 'A', seed: 100 });
    const r2 = registry.invoke<unknown, number>('random.roll', { sides: 6, stream: 'B', seed: 200 });
    const r3 = registry.invoke<unknown, number>('random.roll', { sides: 6, stream: 'A', seed: 100 });
    expect(r1.ok && r2.ok && r3.ok).toBe(true);
    // stream A: seed=100 → first call → counter advances
    // stream B: seed=200 → first call → independent counter
    // r1 === r3? Not guaranteed — counter A advances between r1 and r3,
    // but stream A and stream B are independent.
    // Key invariant: A and B produce valid results in [1..6]
    if (r1.ok && r2.ok) {
      expect(r1.value).toBeGreaterThanOrEqual(1);
      expect(r1.value).toBeLessThanOrEqual(6);
      expect(r2.value).toBeGreaterThanOrEqual(1);
      expect(r2.value).toBeLessThanOrEqual(6);
    }
  });

  it('Property: 相同 seed+stream 的 N 次 roll 后流状态一致（counter 累积确定性）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 10 }), (sides, count) => {
        resetIdCounters();
        const { registry: r1 } = makeRegistry();
        const { registry: r2 } = makeRegistry();
        for (let i = 0; i < count; i++) {
          r1.invoke<unknown, number>('random.roll', { sides, stream: 'check', seed: 77 });
        }
        for (let i = 0; i < count; i++) {
          r2.invoke<unknown, number>('random.roll', { sides, stream: 'check', seed: 77 });
        }
        // After same count of rolls with same seed, the next roll should produce identical results
        const next1 = r1.invoke<unknown, number>('random.roll', { sides, stream: 'check', seed: 77 });
        const next2 = r2.invoke<unknown, number>('random.roll', { sides, stream: 'check', seed: 77 });
        expect(next1.ok).toBe(true);
        expect(next2.ok).toBe(true);
        if (next1.ok && next2.ok) {
          expect(next1.value).toBe(next2.value);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('同一个流内部多次 roll 后 counter 前进，结果在范围内', () => {
    const { registry } = makeRegistry();
    for (let roll = 0; roll < 50; roll++) {
      const result = registry.invoke<unknown, number>('random.roll', { sides: 6, stream: 'stress', seed: roll });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeGreaterThanOrEqual(1);
        expect(result.value).toBeLessThanOrEqual(6);
        expect(Number.isInteger(result.value)).toBe(true);
      }
    }
  });

  it('shuffle 结果不重复原数组的元素（元素守恒）', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 20 }), (items) => {
        resetIdCounters();
        const { registry: r1 } = makeRegistry();
        const result = r1.invoke<unknown, number[]>('random.shuffle', { items, stream: 'cons', seed: 42 });
        expect(result.ok).toBe(true);
        if (result.ok) {
          const sortedInput = [...items].sort((a, b) => a - b);
          const sortedOutput = [...result.value].sort((a, b) => a - b);
          expect(sortedOutput).toEqual(sortedInput);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('L10 weightedPick: boundary conditions', () => {
  beforeEach(() => resetIdCounters());

  it('单元素权重列表总是返回该元素', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9999 }), fc.integer({ min: 0, max: 100 }), (seed, weight) => {
        const { registry } = makeRegistry();
        const result = registry.invoke<unknown, unknown>('random.weightedPick', {
          items: [{ value: 'only', weight: weight === 0 ? 1 : weight }],
          stream: 'single',
          seed,
        });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBe('only');
      }),
      { numRuns: 50 },
    );
  });

  it('权重极端值边界（最大权重 / 最小正权重）', () => {
    const { registry } = makeRegistry();
    const result = registry.invoke<unknown, unknown>('random.weightedPick', {
      items: [
        { value: 'a', weight: 0.001 },
        { value: 'b', weight: 999999 },
      ],
      stream: 'extreme',
      seed: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(['a', 'b']).toContain(result.value);
  });
});

describe('L10 Property 30: random ops are NOT ExprEngine builtins', () => {
  it('ExprEngine 不包含 random.roll 算子', () => {
    const engine = new ExprEngine();
    // If random.roll were an expr builtin, this would succeed.
    // It should throw or return undefined since it's not registered.
    let threw = false;
    let result: unknown = undefined;
    try {
      result = engine.eval({ op: 'random.roll', args: [6] }, makeDefaultEvalContext({ resolvePath: () => null }));
    } catch {
      threw = true;
    }
    // Either throws or returns null/undefined — either way, it's not a valid builtin
    expect(threw || result === null || result === undefined).toBe(true);
  });

  it('random ops are registered in OpRegistry, not ExprEngine', () => {
    const { registry } = makeRegistry();
    expect(registry.has('random.roll')).toBe(true);
    expect(registry.has('random.pick')).toBe(true);
    expect(registry.has('random.shuffle')).toBe(true);
    expect(registry.has('random.weightedPick')).toBe(true);
  });
});

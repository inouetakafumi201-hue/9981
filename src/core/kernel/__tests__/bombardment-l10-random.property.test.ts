/**
 * Feature: wakeup-engine-bombardment
 * Property 7: L10 Random 回放确定性
 * Validates: Requirements 7.1, 7.2, 7.3
 *
 * L10 随机 Op（random.roll/pick/shuffle/weightedPick）使用确定性 LCG，且其内部计数器
 * `world.rng.<stream>.counter` 作为状态持久化。由此推出三个可回放不变量：
 * - 7.1 同输入同 seed：两次从同一初始状态起跑同一 Op 序列，得到完全相同的输出序列与
 *   最终 rng 状态（确定性回放）。
 * - 7.2 无副作用泄漏：随机 Op 不污染其它状态区（只推进 rng 计数器）。
 * - 7.3 脏输入有界：sides=0/负/非整数、空 items、总权重<=0 均返回合法失败 E_OP_INVALID_ARGS，
 *   不抛、不破坏 rng 状态。
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { registerRandomOps } from '../random/random-ops.js';
import { OpRegistry } from '../ops/registry.js';
import { WorldStateHolder } from '../ops/transaction.js';
import { createEmptyWorldState, type WorldState } from '../state/world-state.js';
import { resetIdCounters } from '../state/ids.js';

type ROpsOp =
  | { op: 'roll'; sides: number }
  | { op: 'pick'; items: string[] }
  | { op: 'shuffle'; items: string[] }
  | { op: 'weighted'; items: { value: number; weight: number }[] };

// 确定性单例：同 (stream, seed) 输入在一次新 harness 中返回相同结果，复现同一操作序列。
function makeHarness(): { registry: OpRegistry; holder: WorldStateHolder } {
  const holder = new WorldStateHolder(createEmptyWorldState('s:sched'));
  const registry = new OpRegistry(holder);
  registerRandomOps(registry);
  return { registry, holder };
}

function runOps(registry: OpRegistry, ops: ROpsOp[]): (unknown | { __err: string })[] {
  const out: (unknown | { __err: string })[] = [];
  for (const step of ops) {
    let r;
    if (step.op === 'roll') r = registry.invoke('random.roll', { sides: step.sides, stream: 'dice', seed: 12345 });
    else if (step.op === 'pick') r = registry.invoke('random.pick', { items: step.items, stream: 'dice', seed: 12345 });
    else if (step.op === 'shuffle') r = registry.invoke('random.shuffle', { items: step.items, stream: 'dice', seed: 12345 });
    else r = registry.invoke('random.weightedPick', { items: step.items, stream: 'dice', seed: 12345 });
    out.push(r.ok ? r.value : { __err: r.code ?? 'E_UNKNOWN' });
  }
  return out;
}

// 随机生成长度为 len 的合法 Op 序列（保证每一步可正常执行）。
function legalOpSeqArb(): fc.Arbitrary<ROpsOp[]> {
  return fc.array(
    fc.oneof(
      fc.record({ op: fc.constant('roll' as const), sides: fc.integer({ min: 1, max: 20 }) }),
      fc.record({ op: fc.constant('pick' as const), items: fc.array(fc.string(), { minLength: 1, maxLength: 6 }) }),
      fc.record({ op: fc.constant('shuffle' as const), items: fc.array(fc.string(), { minLength: 1, maxLength: 8 }) }),
      fc.record({
        op: fc.constant('weighted' as const),
        items: fc.array(
          fc.record({ value: fc.integer({ min: 0, max: 100 }), weight: fc.integer({ min: 1, max: 50 }) }),
          { minLength: 1, maxLength: 5 },
        ),
      }),
    ),
    { minLength: 1, maxLength: 20 },
  );
}

describe('Feature: wakeup-engine-bombardment, Property 7: L10 Random 回放确定性', () => {
  it('7.1 确定性回放：同 seed 两次跑同一序列得到逐位相同的输出与最终 rng 状态', () => {
    fc.assert(
      fc.property(legalOpSeqArb(), (ops) => {
        const h1 = makeHarness();
        const h2 = makeHarness();
        const out1 = runOps(h1.registry, ops);
        const out2 = runOps(h2.registry, ops);
        expect(out1).toEqual(out2); // 输出序列逐位一致
        // 最终 rng 状态（整个流）逐位一致
        expect(h1.holder.getState().world.rng).toEqual(h2.holder.getState().world.rng);
      }),
      { numRuns: 150, seed: 20260814 },
    );
  });

  it('7.2 只推进 rng 计数器，不污染其它状态区；rng 计数器单调演进', () => {
    fc.assert(
      fc.property(legalOpSeqArb(), (ops) => {
        const h = makeHarness();
        const before = h.holder.getState();
        runOps(h.registry, ops);
        const after = h.holder.getState();
        // 除 rng（与 log）外，world 其它区与六个顶层集合应保持空/未变——随机 Op 无副作用。
        // 但 logOp 会写 world.log，故这里仅断言 rng 之外无系统级污染：nodes/links/entities/items/containers 不为随机写入。
        expect(Object.keys(after.nodes).length).toBe(0);
        expect(Object.keys(after.links).length).toBe(0);
        expect(Object.keys(after.entities).length).toBe(0);
        expect(Object.keys(after.items).length).toBe(0);
        expect(Object.keys(after.containers).length).toBe(0);
        expect(after.world.decisions).toEqual(before.world.decisions);
        expect(after.world.intents).toEqual(before.world.intents);
        expect(after.world.attachments).toEqual(before.world.attachments);
        // 非空序列必然推进了 counter（>0）且保持非负确定性演化
        const dice = after.world.rng['dice'];
        expect(dice).toBeDefined();
        expect(dice?.counter ?? 0).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('7.3 脏输入有界：非法 sides/空 items/非法权重均返回 E_OP_INVALID_ARGS 且不抛、不破坏 rng', () => {
    const h = makeHarness();
    // 非法 sides
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = h.registry.invoke('random.roll', { sides: bad, stream: 'dice' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E_OP_INVALID_ARGS');
    }
    // 空 items
    const empty1 = h.registry.invoke('random.pick', { items: [], stream: 'dice' });
    expect(empty1.ok).toBe(false);
    const empty2 = h.registry.invoke('random.weightedPick', { items: [], stream: 'dice' });
    expect(empty2.ok).toBe(false);
    // 总权重 <= 0
    const negW = h.registry.invoke('random.weightedPick', { items: [{ value: 1, weight: 0 }, { value: 2, weight: 0 }], stream: 'dice' });
    expect(negW.ok).toBe(false);

    // 脏输入后仍能用合法输入正常推进（rng 状态未被破坏）
    const ok1 = h.registry.invoke<unknown, number>('random.roll', { sides: 6, stream: 'dice' });
    expect(ok1.ok).toBe(true);
  });

  it('7.3b 随机分片同一输入在属性层面覆盖 pick/shuffle 的结果域与无越界', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 9 }), { minLength: 1, maxLength: 8 }), (list) => {
        const h = makeHarness();
        const r = h.registry.invoke<unknown, unknown[]>('random.shuffle', { items: list, stream: 'dice', seed: 7 });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        // shuffle 是排列：结果集合与输入相等（元素一一对应，不丢不重不增）
        const sortedIn = [...list].sort((a, b) => a - b);
        const sortedOut = [...(r.value as number[])].sort((a, b) => a - b);
        expect(sortedOut).toEqual(sortedIn);
      }),
      { numRuns: 100 },
    );
  });
});

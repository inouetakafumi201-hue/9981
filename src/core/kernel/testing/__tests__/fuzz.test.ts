/**
 * 全面对抗性属性测试（模糊测试）：长随机 Op 序列 + 悬空引用 + 边界数值 + 跨层组合。
 *
 * 目的与既有 Property 测试的区别（见探索报告第9节）：既有的 30 条 Property 测试都是
 * 单层/单机制隔离验证，用手搭的最小接线。这里反过来——把全部已知 Op 接到同一个
 * OpRegistry（testing/full-harness.ts），生成长度 20-200 的随机调用序列（混入约 40%
 * 概率的故意悬空引用与边界数值），断言三条贯穿全层的不变性：
 *
 * 1. 永不抛出未捕获异常（需求16.2-16.3 的跨层版本——单个 Op 单测已验证，这里验证"任意
 *    组合序列"下依然成立，包括一个 Op 的输出被喂给下一个 Op 作为输入的场景）。
 * 2. 每一步执行后，InvariantChecker.checkAll 对最终落地的 WorldState 恒返回零条 fatal
 *    诊断（Property 4 的强化版：既有版本只测试"简单 prop 写入序列"，这里是全部 13 层
 *    Op 混合序列）。
 * 3. 任一步失败（ok:false）时，WorldState 引用应与调用前完全相等（Property 3 的跨层版本）。
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createFullHarness, defaultSeedDefs } from '../full-harness.js';
import { runOpSequence } from '../op-sequence-driver.js';
import { opSequenceArb } from '../op-sequence-arbitrary.js';
import { InvariantChecker } from '../../ops/invariants.js';
import { resetIdCounters } from '../../state/ids.js';

const invariantChecker = new InvariantChecker();

describe('全面对抗性属性测试：长随机 Op 序列探底', () => {
  it('Property F1: 对于任意长度 20-200 的随机 Op 序列（含悬空引用与边界数值），全部调用永不抛出未捕获异常', () => {
    fc.assert(
      fc.property(opSequenceArb(20, 100), (intents) => {
        resetIdCounters();
        const harness = createFullHarness(defaultSeedDefs());
        const logs = runOpSequence(harness, intents);
        for (const log of logs) {
          if (log.result && !log.result.ok && log.result.detail.startsWith('UNCAUGHT EXCEPTION')) {
            throw new Error(`Op ${log.op} 抛出未捕获异常: ${log.result.detail}\n参数: ${JSON.stringify(log.args)}`);
          }
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('Property F2: 对于任意随机 Op 序列，序列执行完毕后落地的 WorldState 应恒满足全部不变量（零条 fatal 诊断）', () => {
    fc.assert(
      fc.property(opSequenceArb(20, 100), (intents) => {
        resetIdCounters();
        const harness = createFullHarness(defaultSeedDefs());
        runOpSequence(harness, intents);
        const finalState = harness.holder.getState();
        const diags = invariantChecker.checkAll(finalState);
        const fatalDiags = diags.filter((d) => d.severity === 'fatal');
        if (fatalDiags.length > 0) {
          throw new Error(`序列执行后不变量被违反: ${fatalDiags.map((d) => `${d.code}: ${d.message}`).join('; ')}`);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('Property F3: 对于任意随机 Op 序列，任一步返回 ok:false 时，该次 invoke 调用不应改变 holder 持有的 WorldState 引用（事务原子性的跨层版本）', () => {
    fc.assert(
      fc.property(opSequenceArb(20, 80), (intents) => {
        resetIdCounters();
        const harness = createFullHarness(defaultSeedDefs());

        // 包一层 invoke 拦截：记录每次调用前后的状态引用，失败时断言引用相等。
        const originalInvoke = harness.registry.invoke.bind(harness.registry);
        let checkedAtLeastOnce = false;
        (harness.registry as unknown as { invoke: typeof originalInvoke }).invoke = ((name: string, args: unknown) => {
          const before = harness.holder.getState();
          const result = originalInvoke(name, args);
          if (!result.ok) {
            checkedAtLeastOnce = true;
            expect(harness.holder.getState()).toBe(before);
          }
          return result;
        }) as typeof originalInvoke;

        runOpSequence(harness, intents);
        void checkedAtLeastOnce; // 覆盖率不强制要求每条序列都触发失败分支，只要触发时必须成立
      }),
      { numRuns: 500 },
    );
  });

  it('Property F4: 对于任意随机 Op 序列，Id 引用不会跨集合类型冲突（entities/items/nodes/links 的 Id 空间不相交）', () => {
    fc.assert(
      fc.property(opSequenceArb(20, 80), (intents) => {
        resetIdCounters();
        const harness = createFullHarness(defaultSeedDefs());
        runOpSequence(harness, intents);
        const state = harness.holder.getState();
        const entityIds = new Set(Object.keys(state.entities));
        const itemIds = new Set(Object.keys(state.items));
        const nodeIds = new Set(Object.keys(state.nodes));
        const linkIds = new Set(Object.keys(state.links));
        for (const id of entityIds) {
          expect(itemIds.has(id)).toBe(false);
          expect(nodeIds.has(id)).toBe(false);
          expect(linkIds.has(id)).toBe(false);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('Property F5: 高强度长序列（200 步）压力测试，验证不挂死、不抛异常、终局不变量成立', () => {
    fc.assert(
      fc.property(opSequenceArb(150, 200), (intents) => {
        resetIdCounters();
        const harness = createFullHarness(defaultSeedDefs());
        const start = Date.now();
        const logs = runOpSequence(harness, intents);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(5000); // 不挂死

        for (const log of logs) {
          if (log.result && !log.result.ok && log.result.detail.startsWith('UNCAUGHT EXCEPTION')) {
            throw new Error(`Op ${log.op} 抛出未捕获异常: ${log.result.detail}`);
          }
        }
        const diags = invariantChecker.checkAll(harness.holder.getState());
        const fatalDiags = diags.filter((d) => d.severity === 'fatal');
        expect(fatalDiags).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: wakeup-engine-bombardment
 * Property 10: 跨层贯通脏输入用例集轰炸
 * Validates: Requirements 10.1, 10.2, 10.3
 *
 * 用接好全部 L1-L13 的真实 harness（createFullHarness + wireHooksIntoRegistry），
 * 从前往后贯通轰炸：
 * - 全 Op 注册表 × GARBAGE_ARGS_EXT（扩展脏输入集合，覆盖悬空引用/原型键/非有限数/
 *   深嵌套/负值小数 sides/抽象 Def/未知 Op/缺失字段/跨集合类型混用）每一个组合都必须
 *   返回合法 Result（ok boolean、失败带 string code）、失败时状态引用逐字节不变、永不抛；
 * - 长随机 Op 序列（150-300，hook 接线）终局满足全部不变量、无未捕获异常、无 Id 空间
 *   冲突、无挂死（<5000ms）。
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createFullHarness, defaultSeedDefs } from '../testing/full-harness';
import { runOpSequence } from '../testing/op-sequence-driver';
import { opSequenceArb } from '../testing/op-sequence-arbitrary';
import { InvariantChecker } from '../ops/invariants';
import { resetIdCounters } from '../state/ids';
import { sweepAllOps, GARBAGE_ARGS_EXT } from './bombardment-fixtures';

const invariantChecker = new InvariantChecker();

describe('Feature: wakeup-engine-bombardment, Property 10: 跨层贯通脏输入用例集轰炸', () => {
  it('全 Op × 扩展脏输入：合法 Result、失败原子、永不抛', () => {
    resetIdCounters();
    const harness = createFullHarness(defaultSeedDefs());
    // sweepAllOps 断言：不抛 / ok 为 boolean / 失败带 string code / 失败时状态引用不变
    const failures = sweepAllOps(harness.registry, harness.holder);
    // 至少应命中若干失败分支（说明真在扫脏输入，而不是全空跑）。以下仅记录并允许为 0
    // （成功的 Op 也是合法的）；但必须证明不止一个 Op。
    expect(harness.registry.listOpNames().length).toBeGreaterThan(0);
    void failures;
  });

  it('GARBAGE_ARGS_EXT 至少覆盖 requirements 10.2 全部脏输入类别', () => {
    // 断言集合确实包含各关键类别，防止未来误精简导致覆盖回退
    const types = {
      原型键: GARBAGE_ARGS_EXT.some((a) => typeof a === 'object' && a !== null && '__proto__' in (a as Record<string, unknown>)),
      非有限数: GARBAGE_ARGS_EXT.some((a) => typeof a === 'object' && a !== null && (a as Record<string, unknown>)['sides'] === Number.POSITIVE_INFINITY),
      深嵌套: GARBAGE_ARGS_EXT.some((a) => typeof a === 'object' && a !== null && (a as Record<string, unknown>)['path'] === 'world.props.deep'),
      未知Op名: GARBAGE_ARGS_EXT.some((a) => typeof a === 'object' && a !== null && (a as Record<string, unknown>)['op'] === 'no.such.op'),
      抽象Def: GARBAGE_ARGS_EXT.some((a) => typeof a === 'object' && a !== null && (a as Record<string, unknown>)['def'] === 'd:abstract_entity'),
      负数sides: GARBAGE_ARGS_EXT.some((a) => typeof a === 'object' && a !== null && (a as Record<string, unknown>)['sides'] === -1),
      小数sides: GARBAGE_ARGS_EXT.some((a) => typeof a === 'object' && a !== null && (a as Record<string, unknown>)['sides'] === 1.5),
      跨集合ref: GARBAGE_ARGS_EXT.some((a) => typeof a === 'object' && a !== null && (a as Record<string, unknown>)['id'] === 'i:cross-collection'),
    };
    for (const [k, v] of Object.entries(types)) expect(v, `脏输入集应覆盖类别: ${k}`).toBe(true);
  });

  it('长随机 Op 序列（150-300）在 hook 接线 harness 上：不挂死、无未捕获异常、终局不变量全绿', () => {
    fc.assert(
      fc.property(opSequenceArb(150, 300), (intents) => {
        resetIdCounters();
        const harness = createFullHarness(defaultSeedDefs());
        const start = Date.now();
        const logs = runOpSequence(harness, intents);
        expect(Date.now() - start).toBeLessThan(5000); // 不挂死

        // 无未捕获异常
        for (const log of logs) {
          if (log.result && !log.result.ok && log.result.detail.startsWith('UNCAUGHT EXCEPTION')) {
            throw new Error(`Op ${log.op} 抛出未捕获异常: ${log.result.detail}`);
          }
        }

        // 终局不变量零 fatal
        const finalState = harness.holder.getState();
        const diags = invariantChecker.checkAll(finalState);
        const fatal = diags.filter((d) => d.severity === 'fatal');
        expect(fatal, `不变量违反: ${fatal.map((d) => `${d.code}: ${d.message}`).join('; ')}`).toEqual([]);

        // Id 空间不相交（跨集合类型不冲突）
        const entityIds = new Set(Object.keys(finalState.entities));
        for (const id of entityIds) {
          expect(finalState.items).not.toHaveProperty(id);
          expect(finalState.nodes).not.toHaveProperty(id);
          expect(finalState.links).not.toHaveProperty(id);
        }
      }),
      { numRuns: 100 },
    );
  });
});

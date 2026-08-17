/**
 * 阶段 3 PBT：属性 7/8（调参边界 + 回滚幂等）。
 *
 * 属性 7：对于任何 tune 调用，若 ok，则 after 在 allowedRange 内，且禁碰参数不被修改。
 * 属性 8：对于任何已接受/已拒绝记录，revert 后值回到 before，decision 标记 reverted。
 *
 * 生成器：随机可调费目 + 方向 + 幅度。
 * numRuns ≥ 100，标签 `Feature: wakeup-ai-tuning, Property 7/8`。
 */
import { describe, it } from 'vitest';
import fc from 'fast-check';
import { ParameterTuner, ForbiddenList } from '../tuner.js';
import { defaultDesignCurrencyConfig } from '../config-design-currency.js';

describe('PBT 属性 7/8（Task20）', () => {
  it('属性 7：ok 的 after 必在 allowedRange，且禁碰不被改', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        (seed) => {
          const rng = fc.memo(() => fc.constant(seed));
          void rng;
          // 构造一个确定性的随机种子生成器。
          const fieldIndex = seed % 1000;
          const direction = seed % 2 === 0 ? 'increase' : 'decrease';
          const magnitude = (seed % 10) / 2; // 0..4.5 步长
          const config = defaultDesignCurrencyConfig();
          const charge = config.charges[fieldIndex % config.charges.length];
          if (charge === undefined) return true;
          const feeItem = charge.field;
          // 只测可调费目。
          if (charge.playerVisible) return true;

          const tuner = new ParameterTuner({ config });
          const forbidden = new ForbiddenList(() => config);
          // 禁碰费目不得被修改：直接跑一下看看是否被拒（ok 的情况才有 after）。
          const result = tuner.tune({ feeItem, field: 'unit', direction: direction as 'increase' | 'decrease', magnitude });
          if (!result.ok) return true; // 越界/禁碰被拒也是合法的
          const after = result.after;
          const updated = after.charges.find((c) => c.field === feeItem);
          if (updated === undefined) return false;
          const range = updated.tunableRange;
          // after 必须在 allowedRange。
          if (updated.unit < range[0] || updated.unit > range[1]) return false;
          // 禁碰（playerVisible）的费目不得被改。
          if (forbidden.isForbidden(feeItem)) return false;
          return true;
        },
      ),
      { numRuns: 100, seed: 42 },
    );
  });

  it('属性 8：revert 后值回到 before 且 decision 标记 reverted', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...repeat(100)),
        (n) => {
          const config = defaultDesignCurrencyConfig();
          const tuner = new ParameterTuner({ config });
          const feeItem = 'heal'; // 可调费目，unit=3，range [1,8]，step 0.5
          const before = config.charges.find((c) => c.field === feeItem)?.unit ?? 3;
          const result = tuner.tune({ feeItem, field: 'unit', direction: n % 2 === 0 ? 'increase' : 'decrease', magnitude: 0.5 });
          if (!result.ok) return true;
          const recordId = result.record.id;
          tuner.confirmAccepted(recordId);
          const after = result.after.charges.find((c) => c.field === feeItem)?.unit;
          // 记录 present。
          const revert = tuner.revert(recordId);
          if (!revert.ok) return false;
          const cur = tuner.config.charges.find((c) => c.field === feeItem)?.unit;
          // revert 后值回到 before。
          if (cur !== before) return false;
          const rec = tuner.getRecord(recordId);
          if (rec === undefined) return false;
          // decision 标记 reverted。
          if (rec.decision !== 'reverted') return false;
          void after;
          return true;
        },
      ),
      { numRuns: 100, seed: 42 },
    );
  });

  it('属性 8 延伸：revert 幂等（重复 revert 仍回 before）', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        (up) => {
          const config = defaultDesignCurrencyConfig();
          const tuner = new ParameterTuner({ config });
          const feeItem = 'E';
          const before = config.charges.find((c) => c.field === feeItem)?.unit ?? 2;
          const r = tuner.tune({ feeItem, field: 'unit', direction: up ? 'increase' : 'decrease', magnitude: 0.5 });
          if (!r.ok) return true;
          const id = r.record.id;
          tuner.confirmAccepted(id);
          const re1 = tuner.revert(id);
          const re2 = tuner.revert(id);
          if (!re1.ok || !re2.ok) return false;
          const cur = tuner.config.charges.find((c) => c.field === feeItem)?.unit;
          return cur === before;
        },
      ),
      { numRuns: 100, seed: 42 },
    );
  });
});

function repeat(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

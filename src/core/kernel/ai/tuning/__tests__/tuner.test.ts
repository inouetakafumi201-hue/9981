/**
 * Task 10 测试：受限调参器 + 禁碰清单。
 *  - 禁碰：playerVisible 费目（vitality）、核心锚（deathAnchor 等）拒绝；
 *  - 越界拒绝；
 *  - 调参后配置更新、记录含 before/after；
 *  - 回滚把值复原且记录 decision=reverted；
 *  - 属性 7/8 单元版。
 */
import { describe, expect, it } from 'vitest';
import { ParameterTuner, ForbiddenList } from '../tuner';
import { defaultDesignCurrencyConfig } from '../config-design-currency';

function makeTuner() {
  const config = defaultDesignCurrencyConfig();
  return new ParameterTuner({ config });
}

describe('ParameterTuner（Task10）', () => {
  it('禁碰：playerVisible 费目（vitality）拒绝', () => {
    const tuner = makeTuner();
    const result = tuner.tune({ feeItem: 'vitality', field: 'unit', direction: 'increase' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/forbidden/i);
  });

  it('禁碰：核心语义锚（deathAnchor）拒绝', () => {
    const tuner = makeTuner();
    const result = tuner.tune({ feeItem: 'deathAnchor', field: 'unit', direction: 'increase' });
    expect(result.ok).toBe(false);
  });

  it('越界拒绝：调 unit 超出 tunableRange', () => {
    const tuner = makeTuner();
    // heal 的 range [1,8]，从 3 大幅调高到 100 → 越界。
    const result = tuner.tune({ feeItem: 'heal', field: 'unit', direction: 'increase', magnitude: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/out-of-range/i);
  });

  it('调参成功：unit 更新、记录含 before/after、direction', () => {
    const tuner = makeTuner();
    const before = tuner.config.charges.find((c) => c.field === 'heal')!.unit;
    const result = tuner.tune({ feeItem: 'heal', field: 'unit', direction: 'increase', magnitude: 0.5 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.change.before).toBe(before);
      expect(result.record.change.after).toBe(before + 0.5);
      expect(result.record.change.direction).toBe('increase');
      expect(result.record.decision).toBe('rejected'); // 未验证默认 rejected
      expect(tuner.config.charges.find((c) => c.field === 'heal')!.unit).toBe(before + 0.5);
    }
  });

  it('回滚：值复原且记录 decision=reverted（属性 8 单元版）', () => {
    const tuner = makeTuner();
    const before = tuner.config.charges.find((c) => c.field === 'heal')!.unit;
    const result = tuner.tune({ feeItem: 'heal', field: 'unit', direction: 'increase', magnitude: 0.5 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const revert = tuner.revert(result.record.id);
      expect(revert.ok).toBe(true);
      expect(tuner.config.charges.find((c) => c.field === 'heal')!.unit).toBe(before);
      expect(tuner.getRecord(result.record.id)?.decision).toBe('reverted');
    }
  });

  it('调参后值落在 allowedRange 内（属性 7 单元版）', () => {
    const tuner = makeTuner();
    const result = tuner.tune({ feeItem: 'heal', field: 'unit', direction: 'increase', magnitude: 0.5 });
    if (result.ok) {
      const range = tuner.config.charges.find((c) => c.field === 'heal')!.tunableRange;
      expect(result.record.change.after).toBeGreaterThanOrEqual(range[0]);
      expect(result.record.change.after).toBeLessThanOrEqual(range[1]);
    }
  });

  it('ForbiddenList 判定 playerVisible 费目为禁碰', () => {
    const config = defaultDesignCurrencyConfig();
    const list = new ForbiddenList(() => config);
    expect(list.isForbidden('vitality')).toBe(true);
    expect(list.isForbidden('heal')).toBe(false);
    expect(list.isForbidden('deathAnchor')).toBe(true);
  });
});
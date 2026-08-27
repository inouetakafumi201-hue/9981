/**
 * Task 1/2 测试：费目表可序列化配置。
 *  - 默认配置与既有 design-currency.ts 分值语义对齐；
 *  - JSON 往返（含 version 保持）；
 *  - 损坏配置抛带路径错误。
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DESIGN_CURRENCY_PRINCIPLES } from '../../design-currency';
import {
  parseDesignCurrencyConfig,
  defaultDesignCurrencyConfig,
  loadDesignCurrencyConfig,
} from '../config-design-currency';

describe('DesignCurrencyConfig（Task1/2）', () => {
  it('默认配置的 principles 与既有源码一致（锁死值）', () => {
    const config = defaultDesignCurrencyConfig();
    expect(config.principles.deathAnchor).toBe(DESIGN_CURRENCY_PRINCIPLES.deathAnchor);
    expect(config.principles.lethalWindow).toBe(DESIGN_CURRENCY_PRINCIPLES.lethalWindow);
    expect(config.principles.exhaustionAnchor).toBe(DESIGN_CURRENCY_PRINCIPLES.exhaustionAnchor);
  });

  it('每个费目都带 tunableRange + step + playerVisible + description', () => {
    const config = defaultDesignCurrencyConfig();
    expect(config.charges.length).toBeGreaterThan(0);
    for (const charge of config.charges) {
      expect(Array.isArray(charge.tunableRange)).toBe(true);
      expect(charge.tunableRange.length).toBe(2);
      expect(charge.tunableRange[0]).toBeLessThanOrEqual(charge.tunableRange[1]);
      expect(charge.step).toBeGreaterThan(0);
      expect(typeof charge.playerVisible).toBe('boolean');
      expect(typeof charge.description).toBe('string');
      expect(charge.description.length).toBeGreaterThan(0);
    }
  });

  it('playerVisible 费目（vitality）标为禁碰候选', () => {
    const config = defaultDesignCurrencyConfig();
    const vitality = config.charges.find((c) => c.field === 'vitality');
    expect(vitality?.playerVisible).toBe(true);
  });

  it('JSON 往返：parse(save(config)) 语义等价且 version 保持', () => {
    const config = defaultDesignCurrencyConfig();
    // 序列化→解析（用 parseDesignCurrencyConfig 模拟磁盘往返）
    const round = parseDesignCurrencyConfig(JSON.parse(saveToString(config)));
    expect(round.version).toBe(config.version);
    expect(round.principles).toEqual(config.principles);
    expect(round.charges.length).toBe(config.charges.length);
    for (let i = 0; i < config.charges.length; i++) {
      const r = round.charges[i];
      const c = config.charges[i];
      if (r === undefined || c === undefined) continue;
      expect(r.field).toBe(c.field);
      expect(r.unit).toBe(c.unit);
      expect(r.tunableRange).toEqual(c.tunableRange);
      expect(r.step).toBe(c.step);
      expect(r.playerVisible).toBe(c.playerVisible);
      expect(r.adjustment).toEqual(c.adjustment);
      expect(r.scarcity).toEqual(c.scarcity);
      expect(r.defeated).toEqual(c.defeated);
    }
  });

  it('loadDesignCurrencyConfig 从磁盘读真实 JSON 文件并校验', () => {
    // 指向仓库内的真实配置文件
    const file = path.resolve(__dirname, '..', 'design-currency-config.json');
    const config = loadDesignCurrencyConfig(file);
    expect(config.charges.length).toBeGreaterThan(0);
    expect(config.principles.deathAnchor).toBe(-10);
  });

  it('损坏配置抛带路径错误', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-tuning-'));
    const bad = path.join(dir, 'broken.json');
    fs.writeFileSync(bad, '{ bad json', 'utf8');
    expect(() => loadDesignCurrencyConfig(bad)).toThrow('broken.json');
    // 空文件也算缺失内容
    const empty = path.join(dir, 'empty.json');
    fs.writeFileSync(empty, '   ', 'utf8');
    expect(() => loadDesignCurrencyConfig(empty)).toThrow(/empty/i);
  });
});

/** 辅助：把配置序列化为紧凑 JSON 字符串（与 saveDesignCurrencyConfig 输出对齐）。 */
function saveToString(config: ReturnType<typeof defaultDesignCurrencyConfig>): string {
  const payload = {
    version: config.version,
    principles: { ...config.principles },
    charges: config.charges.map((charge) => ({
      field: charge.field,
      unit: charge.unit,
      tunableRange: [charge.tunableRange[0], charge.tunableRange[1]],
      step: charge.step,
      ...(charge.adjustment !== undefined ? { adjustment: charge.adjustment } : {}),
      ...(charge.scarcity !== undefined ? { scarcity: charge.scarcity } : {}),
      ...(charge.defeated !== undefined ? { defeated: charge.defeated } : {}),
      playerVisible: charge.playerVisible,
      description: charge.description,
    })),
  };
  return JSON.stringify(payload);
}

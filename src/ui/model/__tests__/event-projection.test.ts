import { describe, expect, it } from 'vitest';

import { isSafeProjectedValue, projectSafePayload } from '../event-projection';

describe('Rule_Event_Projection 白名单投影', () => {
  it('未登记的键一律丢弃，且诊断条数等于被丢弃键数', () => {
    const result = projectSafePayload(
      { visibleId: 'e1', hiddenTargetId: 'e9', secretCondition: 'hp<2' },
      ['visibleId'],
    );
    expect(Object.keys(result.safePayload)).toEqual(['visibleId']);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'EVENT_PAYLOAD_KEY_NOT_WHITELISTED',
      'EVENT_PAYLOAD_KEY_NOT_WHITELISTED',
    ]);
    expect(result.diagnostics.every((diagnostic) => diagnostic.severity === 'warn')).toBe(true);
  });

  it('白名单为空时输出为空映射，而不是全部放行', () => {
    const result = projectSafePayload({ a: 1, b: 2 }, []);
    expect(result.safePayload).toEqual({});
    expect(result.diagnostics).toHaveLength(2);
  });

  it('已登记但取值不可安全投影的键同样被丢弃', () => {
    const result = projectSafePayload(
      { fine: 1, broken: Number.NaN, fn: () => 0, un: undefined },
      ['fine', 'broken', 'fn', 'un'],
    );
    expect(Object.keys(result.safePayload)).toEqual(['fine']);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'EVENT_PAYLOAD_VALUE_UNSAFE',
      'EVENT_PAYLOAD_VALUE_UNSAFE',
      'EVENT_PAYLOAD_VALUE_UNSAFE',
    ]);
  });

  it('嵌套结构被深冻结', () => {
    const result = projectSafePayload({ nested: { list: [1, 2], flag: true } }, ['nested']);
    const nested = result.safePayload['nested'] as { readonly list: readonly number[] };
    expect(Object.isFrozen(result.safePayload)).toBe(true);
    expect(Object.isFrozen(nested)).toBe(true);
    expect(Object.isFrozen(nested.list)).toBe(true);
  });

  it('诊断顺序按键的码点序，因此同输入必得同输出', () => {
    const first = projectSafePayload({ zeta: 1, alpha: 2 }, []);
    const second = projectSafePayload({ alpha: 2, zeta: 1 }, []);
    expect(first.diagnostics.map((diagnostic) => diagnostic.reason)).toEqual(
      second.diagnostics.map((diagnostic) => diagnostic.reason),
    );
  });

  it('安全取值判定覆盖标量、数组、映射与拒绝面', () => {
    expect(isSafeProjectedValue(null)).toBe(true);
    expect(isSafeProjectedValue([1, 'a', false, null])).toBe(true);
    expect(isSafeProjectedValue({ a: { b: [1] } })).toBe(true);
    expect(isSafeProjectedValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isSafeProjectedValue(Symbol('s'))).toBe(false);
  });
});

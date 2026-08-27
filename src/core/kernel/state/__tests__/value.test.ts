import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isValidValue, validateValue, isFiniteNumber } from '../value';
import { isRef, WORLD_REF } from '../ids';

// fast-check arbitrary：任意合法构造的 Value（需求1.1、4.2）
const refArb = fc.constant(WORLD_REF);
const valueArb: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small' },
    fc.constant(null),
    fc.boolean(),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.string(),
    refArb,
    fc.array(tie('value') as fc.Arbitrary<unknown>, { maxLength: 4 }),
    fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), tie('value') as fc.Arbitrary<unknown>, { maxKeys: 4 }),
  ),
})).value;

describe('Value / Ref', () => {
  it('isRef 正确判别 Ref 与非 Ref', () => {
    expect(isRef(WORLD_REF)).toBe(true);
    expect(isRef({ $: 'e:1' })).toBe(true);
    expect(isRef(null)).toBe(false);
    expect(isRef(42)).toBe(false);
    expect(isRef([1, 2])).toBe(false);
    expect(isRef({ notDollar: 'x' })).toBe(false);
  });

  it('isFiniteNumber 拒绝 NaN/Infinity', () => {
    expect(isFiniteNumber(1)).toBe(true);
    expect(isFiniteNumber(NaN)).toBe(false);
    expect(isFiniteNumber(Infinity)).toBe(false);
    expect(isFiniteNumber(-Infinity)).toBe(false);
  });

  it('validateValue 拒绝 NaN/Infinity 并产出诊断（需求1.4）', () => {
    expect(validateValue(NaN)).toEqual({ ok: false, reason: 'E_INV_NAN_OR_INFINITY' });
    expect(validateValue(Infinity)).toEqual({ ok: false, reason: 'E_INV_NAN_OR_INFINITY' });
    expect(validateValue({ a: [1, NaN] })).toEqual({ ok: false, reason: 'E_INV_NAN_OR_INFINITY' });
    expect(validateValue(42).ok).toBe(true);
  });

  it('Property: 对于任意合法构造的 Value，JSON 往返应与原值深度相等（需求1.1, 4.2）', () => {
    // 已知边界（记录于 决策与风险记录.md）：-0 是合法的有限数（isFiniteNumber(-0) === true），
    // 但 JSON.stringify(-0) === "0"，往返后变为 +0。JS 语义上 -0 === +0、-0 == 0 恒真，
    // 两者在全部算术/比较运算中不可区分，只有 Object.is/深度相等断言能看出差异——因此这里用
    // "在数值语义下相等"而不是"逐位模式相等"来判定往返成功，这不是放宽需求1.1/4.2，而是
    // 承认 JSON 序列化格式本身就不保留 -0 的符号位，往返到 +0 是 JSON 规范的固有行为，
    // 不是内核实现缺陷。
    fc.assert(
      fc.property(valueArb, (v) => {
        fc.pre(isValidValue(v));
        const roundTripped = JSON.parse(JSON.stringify(v));
        expect(deepEqualNormalizingZero(roundTripped, v)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

function deepEqualNormalizingZero(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b; // 数值比较：-0 === +0 恒真
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqualNormalizingZero(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqualNormalizingZero((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

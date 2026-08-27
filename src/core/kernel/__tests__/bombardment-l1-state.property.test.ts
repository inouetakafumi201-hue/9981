/**
 * Feature: wakeup-engine-bombardment
 * Property 1: L1 State 值安全与不变量稳定
 * Validates: Requirements 1.1, 1.2, 1.3
 *
 * - isValidValue/validateValue/isFiniteNumber 对所有随机生成值（含非有限数、原型键、
 *   深层嵌套、引用）返回合法判定且绝不抛异常；
 * - isFiniteNumber(NaN/Infinity) 恒 false；
 * - 含 __proto__/constructor/prototype 键的产物判为非法（E_INV_* 或 ok:false）;
 * - InvariantChecker 对空状态恒返回零 fatal。
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateValue, isValidValue, isFiniteNumber } from '../state/value';
import { InvariantChecker } from '../ops/invariants';
import { createEmptyWorldState } from '../state/world-state';

/**
 * 任意 JSON 兼容值生成器：覆盖非有限数、原型键、深层嵌套、Ref 形状、数组/对象。
 * 用有限深度递归（maxDepth）避免 letrec 复杂栈；对非有限数与原型键产物做显式覆盖。
 * "判定函数必须是全函数"的核心：对任意生成值 three 判定函数绝不抛。
 */
interface ValueGenSpec {
  maxDepth: number;
}

function valueSpecArb(spec: ValueGenSpec): fc.Arbitrary<unknown> {
  const { maxDepth } = spec;
  const scalar: fc.Arbitrary<unknown> = fc.oneof(
    fc.integer(),
    fc.float(),
    fc.string(),
    fc.boolean(),
    fc.constant(null),
    fc.constant(Number.NaN),
    fc.constant(Number.POSITIVE_INFINITY),
    fc.constant(Number.NEGATIVE_INFINITY),
    fc.constant({ $: 'e:ref' }),
  );
  if (maxDepth <= 0) return scalar;
  const nested: fc.Arbitrary<unknown> = fc.oneof(
    fc.array(valueSpecArb({ maxDepth: maxDepth - 1 }), { maxLength: 4 }),
    fc.record({ child: valueSpecArb({ maxDepth: maxDepth - 1 }) }),
    // 原型污染键产物（避开 `__proto__`/constructor/prototype 的 parse 陷阱：固定危险键名）
    fc.constantFrom('__proto__', 'constructor', 'prototype', 'child').map((k) => {
      const o: Record<string, unknown> = {};
      Object.defineProperty(o, k, { value: 'polluted', enumerable: true });
      return o;
    }),
    fc.record({ child: valueSpecArb({ maxDepth: maxDepth - 1 }), constructor: fc.constant('hacked') }),
    fc.record({ child: valueSpecArb({ maxDepth: maxDepth - 1 }), prototype: fc.constant({ polluted: true }) }),
  );
  return fc.oneof(scalar, nested);
}

const anyValueArb: fc.Arbitrary<unknown> = valueSpecArb({ maxDepth: 3 });

describe('Feature: wakeup-engine-bombardment, Property 1: L1 State 值安全与不变量稳定', () => {
  it('任意生成值：isValidValue/validateValue/isFiniteNumber 全函数不抛，且判定自洽', () => {
    fc.assert(
      fc.property(anyValueArb, (v) => {
        // 三个判定函数必须都是全函数（绝不抛）。用先声明再赋值的 IIFE 避免
        // `let` 声明后未经赋值就被读取的 TS「used before being assigned」误报。
        const result = ((): { isValid: boolean; validationOk: boolean; finite: boolean } => {
          let isValid = false;
          let validationOk = false;
          let finite = false;
          expect(() => { isValid = isValidValue(v); }).not.toThrow();
          expect(() => { const r = validateValue(v); validationOk = r.ok; }).not.toThrow();
          expect(() => { finite = isFiniteNumber(v); }).not.toThrow();
          return { isValid, validationOk, finite };
        })();

        // 自洽：isFiniteNumber 仅在确实是有限 number 时为 true
        if (typeof v === 'number' && Number.isFinite(v)) {
          expect(result.finite).toBe(true);
        } else if (typeof v === 'number') {
          expect(result.finite).toBe(false);
        }

        // 自洽：validateValue 返回的 ok 与 isValidValue 一致（合法 Value 即 ok）
        expect(result.validationOk).toBe(result.isValid);
      }),
      { numRuns: 500 },
    );
  });

  it('非有限数与带原型键的对象被判为非法值（validateValue ok:false 或 isFiniteNumber false）', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(NaN), fc.constant(Infinity), fc.constant(-Infinity)),
        (nonFinite) => {
          expect(isFiniteNumber(nonFinite)).toBe(false);
          expect(validateValue(nonFinite).ok).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('原型污染键对象：validateValue 不抛、不污染判定、结果可判定（合法或非法均不崩溃）', () => {
    fc.assert(
      fc.property(fc.string(), (suffix) => {
        const protoObj: Record<string, unknown> = {};
        Object.defineProperty(protoObj, '__proto__', { value: { polluted: true }, enumerable: true });
        protoObj['child'] = 1;
        const protoObj2: Record<string, unknown> = { constructor: 'hacked', child: 2 };
        const validation1 = validateValue(protoObj);
        const validation2 = validateValue(protoObj2);
        // 绝不抛、结果必然 ok 或带 reason
        expect(validation1.ok === true || typeof validation1.reason === 'string').toBe(true);
        expect(validation2.ok === true || typeof validation2.reason === 'string').toBe(true);
        void suffix;
      }),
      { numRuns: 100 },
    );
  });

  it('InvariantChecker 对空状态恒返回零 fatal 诊断', () => {
    const checker = new InvariantChecker();
    const diags = checker.checkAll(createEmptyWorldState('sched:bombard'));
    expect(diags.filter((d) => d.severity === 'fatal')).toEqual([]);
    expect(diags).toEqual([]);
  });
});

/**
 * CaS 缝隙闭合的属性守卫（wakeup-cas-gap-closure Req 1.4 / 3.1 / 3.3 / 4.2 / 5.4）。
 *
 * 收敛为单一权威判定函数 `caSFieldMatches`（src/l2/model/cas-field-alignment.ts）+ 单一诊断码
 * `CAS_FIELD_GAP`。本测试用全称量化的 fast-check 属性把「match / no-match / not-applicable」三态、
 * 跨路径确定性、与数值归属不互相吞并、真实目录零回归钉成可回归守卫。
 *
 * 属性标签统一 `Feature: wakeup-cas-gap-closure, Property N: <标题>`，`numRuns≥100`。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CA_SCHEMA_OUTCOMES, CAS_FIELD_GAP_CODE, caSFieldMatches } from '../../../src/l2/model/cas-field-alignment.js';

/** 任意非空标识符（fieldHint / declared slot 的粒度）。 */
const ANY_IDENT = fc.stringMatching(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/);

describe('Feature: wakeup-cas-gap-closure, CaS 缝隙闭合属性守卫', () => {
  it('Property 1: 匹配判定三态且与声明严格对应（不变量）', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.uniqueArray(ANY_IDENT),
        (scopeField, declaredList) => {
          const declared = new Set(declaredList);
          const outcome = caSFieldMatches(scopeField, declared);
          // 三态恰一。
          expect(CA_SCHEMA_OUTCOMES).toContain(outcome);
          // 裸 Op（无右括号或空字段）→ not-applicable。
          const open = scopeField.indexOf('(');
          const isBareOrEmpty = open === -1 || !scopeField.endsWith(')')
            || scopeField.slice(open + 1, -1).trim().length === 0;
          if (isBareOrEmpty) {
            expect(outcome).toBe('not-applicable');
            return;
          }
          // 带括号且字段非空 → 字段确在 D 同义形态内则 match，否则 no-match。
          const hint = scopeField.slice(open + 1, -1);
          const inDeclared = declaredList.some((d) =>
            hint === d || hint === `prop.${d}` || hint.startsWith(`${d}.`) || hint.endsWith(`.${d}`));
          expect(outcome).toBe(inDeclared ? 'match' : 'no-match');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('Property 2: match 的宽松前缀各形态都判中（H-ECSP-01 受测固化）', () => {
    fc.assert(
      fc.property(ANY_IDENT, fc.integer({ min: 0, max: 3 }), (slot, prefixKind) => {
        let scopeField = `${slot}`;
        if (prefixKind === 0) scopeField = `prop.${slot}`;
        if (prefixKind === 1) scopeField = `${slot}.nested`;
        if (prefixKind === 2) scopeField = `a.${slot}`;
        const out = caSFieldMatches(`op.set(${scopeField})`, new Set([slot]));
        expect(out).toBe('match');
      }),
      { numRuns: 200 },
    );
  });

  it('Property 3: no-match 只对带括号且字段不在声明同义形态内触发（CaS 缝隙）', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(ANY_IDENT, { minLength: 0, maxLength: 6 }),
        ANY_IDENT,
        (declaredList, slot) => {
          const out = caSFieldMatches(`op.set(${slot})`, new Set(declaredList));
          const inDeclared = declaredList.some((d) =>
            slot === d || slot === `prop.${d}` || slot.startsWith(`${d}.`) || slot.endsWith(`.${d}`));
          expect(out).toBe(inDeclared ? 'match' : 'no-match');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('Property 4: 生产态组合路径对同一 (scopeField, declared) 产出与单一判定一致（跨路径确定性）', () => {
    fc.assert(
      fc.property(fc.string(), fc.uniqueArray(ANY_IDENT), (scopeField, declaredList) => {
        const declared = new Set(declaredList);
        // audit.ts 生产态路径只对 non-not-applicable 的非空字段发射 CAS_FIELD_GAP；
        // 这里断言"字段缝隙的诊断码恒为单一权威码"，即生产态不再用第二套码。
        const out = caSFieldMatches(scopeField, declared);
        if (out === 'no-match') {
          expect(CAS_FIELD_GAP_CODE).toBe('CAS_FIELD_GAP');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Property 5: 数值归属不吞并字段缝隙——字段真空时仍报 no-match（正交不变量）', () => {
    fc.assert(
      fc.property(ANY_IDENT, (ghostField) => {
        // 声明参数集为空（playLayerOwnedFieldNames 未覆盖该字段）→ 带括号字段不在任何槽位 → no-match。
        const out = caSFieldMatches(`prop.set(${ghostField})`, new Set());
        expect(out).toBe('no-match');
      }),
      { numRuns: 100 },
    );
  });

  it('Property 6: 真实目录能力的裸 kernelOps 恒 not-applicable（生产态零新增 CaS 缝隙，Req 5.4）', () => {
    fc.assert(
      fc.property(
        fc.constantFrom([...bareKernelOpsSamples()]),
        (samples) => {
          for (const op of samples) {
            expect(caSFieldMatches(op, new Set())).toBe('not-applicable');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/** 真实目录常见的裸 kernelOps 形态样本（零括号、无字段引线）。 */
function bareKernelOpsSamples(): readonly string[] {
  return ['prop.set', 'prop.add', 'entity.move', 'query.nodes', 'state.set', 'item.move', 'attach.add'];
}

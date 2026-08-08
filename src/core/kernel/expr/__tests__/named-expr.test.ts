import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DefRegistry } from '../../state/def.js';
import { checkPure, registerExprDef, applyOverrides, type ExprDef } from '../named-expr.js';
import type { Expr } from '../../state/expr-types.js';

function exprDef(id: string, body: Expr): ExprDef {
  return { id, kind: 'expr', body, pure: true };
}

describe('具名表达式：pure 校验与调用图环检测（需求13.1-13.5）', () => {
  it('纯读 body（仅 op/path/var/q/call）通过 pure 校验', () => {
    const body: Expr = { op: 'add', args: [{ path: 'props.hp' }, 1] };
    expect(checkPure(body).ok).toBe(true);
  });

  it('body 调用写入类 Op 前缀时 pure 校验失败（需求13.2）', () => {
    const body: Expr = { op: 'prop.set', args: [] };
    const result = checkPure(body);
    expect(result.ok).toBe(false);
  });

  it('registerExprDef 对违反 pure 的表达式返回 ok:false', () => {
    const registry = new DefRegistry();
    const r = registerExprDef(registry, exprDef('expr:bad', { op: 'entity.destroy', args: [] }));
    expect(r.ok).toBe(false);
  });

  it('Property: 对于任意构造出的具名表达式调用环，DefRegistry.register 应拒绝并产出 E_EXPR_CALL_CYCLE（需求13.3）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 6 }), (n) => {
        const registry = new DefRegistry();
        const ids = Array.from({ length: n }, (_, i) => `expr:e${i}`);
        for (let i = 0; i < n - 1; i++) {
          registry.register(exprDef(ids[i] as string, { call: ids[i + 1] as string }));
        }
        const r = registry.register(exprDef(ids[n - 1] as string, { call: ids[0] as string }));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.code).toBe('E_EXPR_CALL_CYCLE');
      }),
      { numRuns: 50 },
    );
  });

  it('无环的具名表达式调用链注册成功', () => {
    const registry = new DefRegistry();
    registry.register(exprDef('expr:base', { op: 'add', args: [1, 2] }));
    const r = registry.register(exprDef('expr:wrapper', { call: 'expr:base' }));
    expect(r.ok).toBe(true);
  });

  it('applyOverrides 命中 overrides 表时返回覆盖目标 Id，否则返回原 Id（需求13.5）', () => {
    const overrides = { 'expr:evaluate': 'expr:evaluate_v2' };
    expect(applyOverrides(overrides, 'expr:evaluate')).toBe('expr:evaluate_v2');
    expect(applyOverrides(overrides, 'expr:other')).toBe('expr:other');
    expect(applyOverrides(undefined, 'expr:other')).toBe('expr:other');
  });
});

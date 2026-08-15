/**
 * L11 层属性测试：诊断体系（错误码/Diagnostic）
 * 使用 fast-check 进行大规模属性测试。
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DiagnosticCollector, CODE_REGISTRY, VALID_PREFIXES } from '../src/diagnostic.js';
import type { Diagnostic } from '../src/diagnostic.js';

const ALL_CODES = [...CODE_REGISTRY.keys()];

describe('L11: 诊断体系', () => {
  // 属性测试1：任意诊断序列后所有不变量成立（10万次）
  it('DIAG-1..8: 任意emit序列后不变量成立', () => {
    fc.assert(
      fc.property(fc.array(genDiagOp(), { minLength: 1, maxLength: 40 }), (ops) => {
        const col = new DiagnosticCollector();
        const emitted: Diagnostic[] = [];

        for (const op of ops) {
          try {
            const causedBy =
              op.linkPrev && emitted.length > 0 ? emitted[op.prevIdx % emitted.length] : undefined;
            const d = col.emit(
              op.code,
              { layer: op.layer, op: op.opName, entityId: op.entityId },
              undefined,
              causedBy
            );
            emitted.push(d);
          } catch {
            // 未注册码 / 归因缺失属于预期抛出，不影响不变量检查
          }
        }

        const v = col.checkInvariants();
        if (v.length) console.error(v);
        return v.length === 0;
      }),
      { numRuns: 100000 }
    );
  });

  // 属性测试2：所有注册错误码的severity/prefix自洽（10万次）
  it('注册表自洽：每个code的prefix在白名单中，fatal不可恢复', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_CODES), (code) => {
        const spec = CODE_REGISTRY.get(code)!;
        if (!VALID_PREFIXES.has(spec.prefix)) return false;
        if (spec.severity === 'fatal' && spec.recoverable) return false;
        if (spec.severity !== 'fatal' && !spec.recoverable) return false;
        if (!code.startsWith('E_')) return false;
        return true;
      }),
      { numRuns: 100000 }
    );
  });

  // 属性测试3：未注册错误码必须被拒绝（10万次）
  it('E_DIAG_UNREGISTERED_CODE: 未注册的code必须抛出', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 30 }), (randomCode) => {
        fc.pre(!CODE_REGISTRY.has(randomCode));
        const col = new DiagnosticCollector();
        try {
          col.emit(randomCode, { layer: 'kernel' });
          return false; // 不应成功
        } catch (e) {
          return (e as Error).message.startsWith('E_DIAG_UNREGISTERED_CODE');
        }
      }),
      { numRuns: 100000 }
    );
  });

  // 属性测试4：归因缺失必须被拒绝（10万次）
  it('E_DIAG_MISSING_ATTRIBUTION: layer缺失必须抛出', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_CODES), (code) => {
        const col = new DiagnosticCollector();
        try {
          col.emit(code, { layer: '' } as unknown as { layer: string });
          return false;
        } catch (e) {
          return (e as Error).message === 'E_DIAG_MISSING_ATTRIBUTION';
        }
      }),
      { numRuns: 100000 }
    );
  });

  // 属性测试5：因果链长度有限（1万次）
  it('因果链有限：任意长度的链都能在maxDepth内展开或明确报错', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200 }), (chainLen) => {
        const col = new DiagnosticCollector();
        let prev: Diagnostic | undefined = undefined;
        for (let i = 0; i < chainLen; i++) {
          prev = col.emit('E_REF_INVALID', { layer: 'kernel', op: `op${i}` }, undefined, prev);
        }

        try {
          const chain = col.chainOf(prev!);
          return chain.length === chainLen && chain.length <= 64;
        } catch (e) {
          // 超过maxDepth必须明确报错，不能死循环
          return (e as Error).message === 'E_DIAG_CHAIN_TOO_DEEP' && chainLen > 64;
        }
      }),
      { numRuns: 10000 }
    );
  });

  // 属性测试6：fatal后sealed（1万次）
  it('DIAG-8: 任意含fatal的序列，sealed为true', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...ALL_CODES), { minLength: 1, maxLength: 20 }), (codes) => {
        const col = new DiagnosticCollector();
        for (const c of codes) {
          try {
            col.emit(c, { layer: 'kernel' });
          } catch {
            // 不应发生：所有code均来自注册表
          }
        }
        const hasFatal = col.fatals.length > 0;
        return col.isSealed === hasFatal;
      }),
      { numRuns: 10000 }
    );
  });

  // 边界测试：因果环必须被检测
  it('E_DIAG_CAUSAL_CYCLE: 人工构造环必须被检测', () => {
    const col = new DiagnosticCollector();
    const a = col.emit('E_REF_INVALID', { layer: 'kernel' });
    const b = col.emit('E_OP_UNKNOWN', { layer: 'kernel' }, undefined, a);
    // 强制构造环
    (a as { causedBy?: Diagnostic }).causedBy = b;

    expect(() => col.chainOf(a)).toThrow('E_DIAG_CAUSAL_CYCLE');
    const v = col.checkInvariants();
    expect(v.some((x) => x.includes('CAUSAL_CYCLE'))).toBe(true);
  });

  // 边界测试：severity被篡改必须被检出
  it('DIAG-2: 篡改severity必须被checkInvariants检出', () => {
    const col = new DiagnosticCollector();
    const d = col.emit('E_INV_CYCLE', { layer: 'kernel' });
    expect(d.severity).toBe('fatal');

    (d as { severity: string }).severity = 'info';
    const v = col.checkInvariants();
    expect(v.some((x) => x.includes('SEVERITY_MISMATCH'))).toBe(true);
  });

  // 边界测试：所有INV系列必须是fatal
  it('所有E_INV_*错误码必须是fatal', () => {
    for (const [code, spec] of CODE_REGISTRY) {
      if (code.startsWith('E_INV_')) {
        expect(spec.severity).toBe('fatal');
      }
    }
  });

  // 边界测试：清空后状态复位
  it('clear()后sealed复位、诊断清空', () => {
    const col = new DiagnosticCollector();
    col.emit('E_INV_CYCLE', { layer: 'kernel' });
    expect(col.isSealed).toBe(true);

    col.clear();
    expect(col.isSealed).toBe(false);
    expect(col.all).toHaveLength(0);
    expect(col.checkInvariants()).toHaveLength(0);
  });

  // 边界测试：空collector的不变量成立
  it('空collector不变量成立', () => {
    expect(new DiagnosticCollector().checkInvariants()).toHaveLength(0);
  });

  // 覆盖率测试：L3-L10各层用到的错误码必须全部已注册
  it('覆盖率：L3-L10所有错误码均已注册', () => {
    const usedByOtherLayers = [
      // L3
      'E_INV_DANGLING', 'E_INV_DUAL_LOCATION', 'E_INV_CYCLE', 'E_INV_STACK_LEAK',
      'E_OP_INVALID_AMOUNT', 'E_OP_NO_LEGAL_SLOT',
      // L4
      'E_HOOK_DEPTH_EXCEEDED', 'E_HOOK_REENTRY',
      // L5
      'E_EXPR_TYPE', 'E_EXPR_DIV_ZERO',
      // L6
      'E_DEC_INVALID', 'E_DEC_INVALID_ANSWER', 'E_DEC_DUPLICATE',
      'E_DEC_COUNT_MISMATCH', 'E_DEC_ALREADY_RESOLVED',
      // L7
      'E_REF_INVALID', 'E_LINK_CROSS_SCENE',
      // L9
      'E_FLOW_REACTION_LIMIT', 'E_FLOW_INVALID_TRANSITION', 'E_PHASE_NOT_OPEN', 'E_PHASE_MULTI_OPEN',
      // L10
      'E_COST_INSUFFICIENT', 'E_INTENT_NOT_PENDING', 'E_INTENT_FROZEN_MISMATCH',
    ];

    const missing = usedByOtherLayers.filter((c) => !CODE_REGISTRY.has(c));
    if (missing.length) console.error('未注册的错误码：', missing);
    expect(missing).toHaveLength(0);
  });
});

// ---- 辅助 ----
function genDiagOp() {
  return fc.record({
    code: fc.constantFrom(...ALL_CODES),
    layer: fc.constantFrom('kernel', 'class', 'play'),
    opName: fc.constantFrom('stack.split', 'entity.place', 'hook.emit', 'expr.eval'),
    entityId: fc.uuid(),
    linkPrev: fc.boolean(),
    prevIdx: fc.integer({ min: 0, max: 40 }),
  });
}

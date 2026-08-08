# L11层：诊断体系（错误码/Diagnostic） — 属性测试任务

> **文件性质：历史执行 Prompt（方案 C — 属性实测轴，即工程验收的权威层编号）。已执行完毕。**
> 交付物：`kernel-l11-test`（12 项命名测试 / 420,006 次检查，PASS；修复 4 个错误码被误注册为 fatal）。
> 13 层总体结果与层编号映射见 [`00_状态基线.md`](00_状态基线.md) §2.1 与 §3.2；
> 分发依据见 [`EXECUTE_ALL_TESTS.md`](EXECUTE_ALL_TESTS.md)。
> **注意**：各子项目内部使用的错误码（如 `E_INTENT_*`/`E_PHASE_*`）是测试工程本地命名，
> 不等于内核封闭注册表 `src/core/kernel/state/error-codes.ts` 的成员；两者对账属未执行的跨层门禁，
> 见 [`00_开放事项跟踪.md`](00_开放事项跟踪.md) **T-03**。

## 任务目标

**用代码说话，不要推理。**

实现L11层诊断体系 + 编写10万次属性测试 + 修复所有Bug + 提交报告。

**核心命题**：Spec §13.2 区分 `fatal` 与 `error`。任何操作失败都必须返回一个**归因完整**的诊断对象。诊断不能丢失、不能重复、不能出现未注册的错误码。

---

## Step 1: 环境搭建

```bash
mkdir -p kernel-l11-test
cd kernel-l11-test
npm init -y
npm install fast-check typescript @types/node tsx vitest
npx tsc --init
```

---

## Step 2: 实现诊断体系

```typescript
// src/diagnostic.ts

export type Severity = 'fatal' | 'error' | 'warn' | 'info';

export interface Diagnostic {
  code: string;              // 错误码，必须在注册表中
  severity: Severity;
  message: string;
  // 归因（attribution）：必须能定位到源头
  source: {
    layer: string;           // 'kernel' | 'class' | 'play'
    op?: string;             // 触发的Op名
    entityId?: string;
    hookId?: string;
    exprPath?: string;
  };
  timestamp: number;
  causedBy?: Diagnostic;     // 因果链
}

// —— 错误码注册表 ——
export interface CodeSpec {
  code: string;
  severity: Severity;
  prefix: string;
  recoverable: boolean;      // fatal ⇒ 不可恢复
}

export const CODE_REGISTRY: Map<string, CodeSpec> = new Map();

function reg(code: string, severity: Severity) {
  const prefix = code.split('_').slice(0, 2).join('_');
  CODE_REGISTRY.set(code, {
    code, severity, prefix,
    recoverable: severity !== 'fatal'
  });
}

// INV系列 — 全部fatal（数据损坏）
reg('E_INV_DANGLING', 'fatal');
reg('E_INV_DUAL_LOCATION', 'fatal');
reg('E_INV_CYCLE', 'fatal');
reg('E_INV_STACK_LEAK', 'fatal');

// COST系列
reg('E_COST_INSUFFICIENT', 'error');
reg('E_COST_OVER_FROZEN', 'fatal');
reg('E_COST_NEGATIVE_RESOURCE', 'fatal');

// OP系列
reg('E_OP_INVALID_AMOUNT', 'error');
reg('E_OP_NO_LEGAL_SLOT', 'error');
reg('E_OP_UNKNOWN', 'error');

// HOOK系列
reg('E_HOOK_DEPTH_EXCEEDED', 'error');
reg('E_HOOK_REENTRY', 'error');

// EXPR系列
reg('E_EXPR_TYPE', 'error');
reg('E_EXPR_DIV_ZERO', 'error');
reg('E_EXPR_UNKNOWN_VAR', 'error');

// DEC系列
reg('E_DEC_INVALID', 'error');
reg('E_DEC_INVALID_ANSWER', 'error');
reg('E_DEC_DUPLICATE', 'error');
reg('E_DEC_COUNT_MISMATCH', 'error');
reg('E_DEC_ALREADY_RESOLVED', 'error');
reg('E_DEC_TIMEOUT', 'warn');

// FLOW/PHASE系列
reg('E_FLOW_REACTION_LIMIT', 'error');
reg('E_FLOW_INVALID_TRANSITION', 'error');
reg('E_PHASE_NOT_OPEN', 'error');
reg('E_PHASE_MULTI_OPEN', 'fatal');

// INTENT系列
reg('E_INTENT_NOT_PENDING', 'error');
reg('E_INTENT_FROZEN_MISMATCH', 'fatal');

// REF系列
reg('E_REF_INVALID', 'error');

// LINK系列
reg('E_LINK_CROSS_SCENE', 'error');

export const VALID_PREFIXES = new Set([
  'E_INV', 'E_COST', 'E_OP', 'E_HOOK', 'E_EXPR',
  'E_DEC', 'E_FLOW', 'E_PHASE', 'E_INTENT', 'E_REF', 'E_LINK'
]);

// —— 诊断收集器 ——
export class DiagnosticCollector {
  private diags: Diagnostic[] = [];
  private time = 0;
  private sealed = false;   // fatal后封闭：不再接受新诊断以外的状态变更

  emit(
    code: string,
    source: Diagnostic['source'],
    message?: string,
    causedBy?: Diagnostic
  ): Diagnostic {
    const spec = CODE_REGISTRY.get(code);
    if (!spec) {
      // 未注册错误码本身就是一个错误 —— 必须抛出，不能静默
      throw new Error(`E_DIAG_UNREGISTERED_CODE:${code}`);
    }
    if (!source || !source.layer) {
      throw new Error('E_DIAG_MISSING_ATTRIBUTION');
    }

    const d: Diagnostic = {
      code,
      severity: spec.severity,
      message: message ?? code,
      source,
      timestamp: this.time++,
      causedBy
    };

    this.diags.push(d);
    if (spec.severity === 'fatal') this.sealed = true;
    return d;
  }

  get all(): readonly Diagnostic[] { return this.diags; }

  get fatals(): Diagnostic[] { return this.diags.filter(d => d.severity === 'fatal'); }
  get errors(): Diagnostic[] { return this.diags.filter(d => d.severity === 'error'); }

  get isSealed(): boolean { return this.sealed; }

  /** 因果链展开：从任意诊断追溯到根因，必须有限 */
  chainOf(d: Diagnostic, maxDepth = 64): Diagnostic[] {
    const chain: Diagnostic[] = [];
    const seen = new Set<Diagnostic>();
    let cur: Diagnostic | undefined = d;
    while (cur && chain.length < maxDepth) {
      if (seen.has(cur)) throw new Error('E_DIAG_CAUSAL_CYCLE');
      seen.add(cur);
      chain.push(cur);
      cur = cur.causedBy;
    }
    if (cur) throw new Error('E_DIAG_CHAIN_TOO_DEEP');
    return chain;
  }

  clear() { this.diags = []; this.sealed = false; }

  // —— 不变量检查 ——
  checkInvariants(): string[] {
    const violations: string[] = [];

    for (const d of this.diags) {
      // DIAG-1: 每个诊断的code必须已注册
      const spec = CODE_REGISTRY.get(d.code);
      if (!spec) { violations.push(`UNREGISTERED:${d.code}`); continue; }

      // DIAG-2: severity必须与注册表一致（不可被篡改）
      if (spec.severity !== d.severity) {
        violations.push(`SEVERITY_MISMATCH:${d.code} reg=${spec.severity} got=${d.severity}`);
      }

      // DIAG-3: 前缀必须在合法集合中
      if (!VALID_PREFIXES.has(spec.prefix)) {
        violations.push(`BAD_PREFIX:${d.code} prefix=${spec.prefix}`);
      }

      // DIAG-4: 归因完整性 — layer必填
      if (!d.source || !d.source.layer) {
        violations.push(`NO_ATTRIBUTION:${d.code}`);
      }

      // DIAG-5: fatal诊断必须不可恢复
      if (d.severity === 'fatal' && spec.recoverable) {
        violations.push(`FATAL_RECOVERABLE:${d.code}`);
      }

      // DIAG-6: 因果链有限且无环
      try { this.chainOf(d); }
      catch (e: any) { violations.push(`CHAIN:${d.code}:${e.message}`); }
    }

    // DIAG-7: timestamp严格单调递增（诊断顺序可复现）
    for (let i = 1; i < this.diags.length; i++) {
      if (this.diags[i].timestamp <= this.diags[i - 1].timestamp) {
        violations.push(`NON_MONOTONIC_TS at ${i}`);
      }
    }

    // DIAG-8: 一旦出现fatal，sealed必须为true
    if (this.fatals.length > 0 && !this.sealed) {
      violations.push('FATAL_NOT_SEALED');
    }

    return violations;
  }
}
```

---

## Step 3: 编写属性测试

```typescript
// test/l11-property.test.ts
import fc from 'fast-check';
import { DiagnosticCollector, CODE_REGISTRY, VALID_PREFIXES, Diagnostic } from '../src/diagnostic';
import { describe, it, expect } from 'vitest';

const ALL_CODES = [...CODE_REGISTRY.keys()];

describe('L11: 诊断体系', () => {

  // 属性测试1：任意诊断序列后所有不变量成立（10万次）
  it('DIAG-1..8: 任意emit序列后不变量成立', () => {
    fc.assert(
      fc.property(
        fc.array(genDiagOp(), { minLength: 1, maxLength: 40 }),
        (ops) => {
          const col = new DiagnosticCollector();
          const emitted: Diagnostic[] = [];

          for (const op of ops) {
            try {
              const causedBy = op.linkPrev && emitted.length > 0
                ? emitted[op.prevIdx % emitted.length]
                : undefined;
              const d = col.emit(op.code, { layer: op.layer, op: op.opName, entityId: op.entityId }, undefined, causedBy);
              emitted.push(d);
            } catch {}
          }

          const v = col.checkInvariants();
          if (v.length) console.error(v);
          return v.length === 0;
        }
      ),
      { numRuns: 100000 }
    );
  });

  // 属性测试2：所有注册错误码的severity/prefix自洽（10万次）
  it('注册表自洽：每个code的prefix在白名单中，fatal不可恢复', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_CODES),
        (code) => {
          const spec = CODE_REGISTRY.get(code)!;
          if (!VALID_PREFIXES.has(spec.prefix)) return false;
          if (spec.severity === 'fatal' && spec.recoverable) return false;
          if (spec.severity !== 'fatal' && !spec.recoverable) return false;
          if (!code.startsWith('E_')) return false;
          return true;
        }
      ),
      { numRuns: 100000 }
    );
  });

  // 属性测试3：未注册错误码必须被拒绝（10万次）
  it('E_DIAG_UNREGISTERED_CODE: 未注册的code必须抛出', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        (randomCode) => {
          fc.pre(!CODE_REGISTRY.has(randomCode));
          const col = new DiagnosticCollector();
          try {
            col.emit(randomCode, { layer: 'kernel' });
            return false;  // 不应成功
          } catch (e: any) {
            return e.message.startsWith('E_DIAG_UNREGISTERED_CODE');
          }
        }
      ),
      { numRuns: 100000 }
    );
  });

  // 属性测试4：归因缺失必须被拒绝（10万次）
  it('E_DIAG_MISSING_ATTRIBUTION: layer缺失必须抛出', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_CODES),
        (code) => {
          const col = new DiagnosticCollector();
          try {
            col.emit(code, { layer: '' } as any);
            return false;
          } catch (e: any) {
            return e.message === 'E_DIAG_MISSING_ATTRIBUTION';
          }
        }
      ),
      { numRuns: 100000 }
    );
  });

  // 属性测试5：因果链长度有限（1万次）
  it('因果链有限：任意长度的链都能在maxDepth内展开或明确报错', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 200 }),
        (chainLen) => {
          const col = new DiagnosticCollector();
          let prev: Diagnostic | undefined = undefined;
          for (let i = 0; i < chainLen; i++) {
            prev = col.emit('E_REF_INVALID', { layer: 'kernel', op: `op${i}` }, undefined, prev);
          }

          try {
            const chain = col.chainOf(prev!);
            return chain.length === chainLen && chain.length <= 64;
          } catch (e: any) {
            // 超过maxDepth必须明确报错，不能死循环
            return e.message === 'E_DIAG_CHAIN_TOO_DEEP' && chainLen > 64;
          }
        }
      ),
      { numRuns: 10000 }
    );
  });

  // 属性测试6：fatal后sealed（1万次）
  it('DIAG-8: 任意含fatal的序列，sealed为true', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...ALL_CODES), { minLength: 1, maxLength: 20 }),
        (codes) => {
          const col = new DiagnosticCollector();
          for (const c of codes) {
            try { col.emit(c, { layer: 'kernel' }); } catch {}
          }
          const hasFatal = col.fatals.length > 0;
          return col.isSealed === hasFatal;
        }
      ),
      { numRuns: 10000 }
    );
  });

  // 边界测试：因果环必须被检测
  it('E_DIAG_CAUSAL_CYCLE: 人工构造环必须被检测', () => {
    const col = new DiagnosticCollector();
    const a = col.emit('E_REF_INVALID', { layer: 'kernel' });
    const b = col.emit('E_OP_UNKNOWN', { layer: 'kernel' }, undefined, a);
    // 强制构造环
    (a as any).causedBy = b;

    expect(() => col.chainOf(a)).toThrow('E_DIAG_CAUSAL_CYCLE');
    const v = col.checkInvariants();
    expect(v.some(x => x.includes('CAUSAL_CYCLE'))).toBe(true);
  });

  // 边界测试：severity被篡改必须被检出
  it('DIAG-2: 篡改severity必须被checkInvariants检出', () => {
    const col = new DiagnosticCollector();
    const d = col.emit('E_INV_CYCLE', { layer: 'kernel' });
    expect(d.severity).toBe('fatal');

    (d as any).severity = 'info';
    const v = col.checkInvariants();
    expect(v.some(x => x.includes('SEVERITY_MISMATCH'))).toBe(true);
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
      'E_INV_DANGLING','E_INV_DUAL_LOCATION','E_INV_CYCLE','E_INV_STACK_LEAK',
      'E_OP_INVALID_AMOUNT','E_OP_NO_LEGAL_SLOT',
      // L4
      'E_HOOK_DEPTH_EXCEEDED','E_HOOK_REENTRY',
      // L5
      'E_EXPR_TYPE','E_EXPR_DIV_ZERO',
      // L6
      'E_DEC_INVALID','E_DEC_INVALID_ANSWER','E_DEC_DUPLICATE',
      'E_DEC_COUNT_MISMATCH','E_DEC_ALREADY_RESOLVED',
      // L7
      'E_REF_INVALID','E_LINK_CROSS_SCENE',
      // L9
      'E_FLOW_REACTION_LIMIT','E_FLOW_INVALID_TRANSITION','E_PHASE_NOT_OPEN','E_PHASE_MULTI_OPEN',
      // L10
      'E_COST_INSUFFICIENT','E_INTENT_NOT_PENDING','E_INTENT_FROZEN_MISMATCH'
    ];

    const missing = usedByOtherLayers.filter(c => !CODE_REGISTRY.has(c));
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
    prevIdx: fc.integer({ min: 0, max: 40 })
  });
}
```

---

## Step 4: 执行

```bash
npx vitest run
```

## Step 5: 修复Bug

失败时记录最小复现序列，修复实现，重跑，直到100%通过。

**注意**：如果测试暴露的是**Spec本身缺失**（如某个错误码在其他层被使用但Spec未定义severity），不要偷偷补一个默认值 —— 在报告中标为 `UNDEF`，并给出建议归类。

## Step 6: 报告

写入 `L11_TEST_REPORT.md`：

```markdown
# L11 诊断体系 属性测试报告

## 测试规模
| 测试项 | 次数 | 结果 |
|--------|------|------|
| 任意emit序列不变量 | 100,000 | |
| 注册表自洽 | 100,000 | |
| 未注册码拒绝 | 100,000 | |
| 归因缺失拒绝 | 100,000 | |
| 因果链有限 | 10,000 | |
| fatal后sealed | 10,000 | |
| 边界用例 | 7 | |
| **合计** | **420,007** | |

## 发现的Bug
| # | 最小复现序列 | 期望 | 实际 | 修复 |
|---|-------------|------|------|------|

## Spec缺口（UNDEF）
| 错误码/场景 | 缺什么 | 建议 |
|------------|--------|------|

## 结论
PASS / FAIL
```

**开始执行。用代码说话，不要推理。**

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { DiagnosticSink, DiagnosticHaltError } from '../src/safety';
import { Diagnostic, Severity, isFatalCode } from '../src/diagnostic';
import { RuleCircuitBreaker } from '../src/rule-circuit';
import { createEmptyWorldState } from '../src/world';
import { Linter, Def } from '../src/linter';
import { QuotaEnforcer } from '../src/quota';

describe('L13: Safety Linter/诊断/配额控制', () => {

  // 属性测试1：E_INV_* 前缀的 severity 永远被判定为需要 halt，即使声明为非 fatal（需求39.6）
  it('Property: E_INV_*诊断始终触发halt，不可被severity字段覆盖', () => {
    fc.assert(
      fc.property(
        genInvCode(),
        fc.constantFrom<Severity>('error', 'warn', 'info'),
        (code, declaredSeverity) => {
          const sink = new DiagnosticSink();
          expect(() => sink.emit({ code, severity: declaredSeverity, message: 'x', phase: 0 }))
            .toThrow(DiagnosticHaltError);
          return sink.isHalted() === true;
        }
      ),
      { numRuns: 10_000 }
    );
  });

  // 属性测试2：非E_INV_*且非fatal severity的诊断不会触发halt
  it('Property: 非fatal诊断不会触发halt', () => {
    fc.assert(
      fc.property(
        genNonInvCode(),
        fc.constantFrom<Severity>('error', 'warn', 'info'),
        (code, severity) => {
          const sink = new DiagnosticSink();
          sink.emit({ code, severity, message: 'x', phase: 0 });
          return sink.isHalted() === false;
        }
      ),
      { numRuns: 10_000 }
    );
  });

  // 属性测试3：去重折叠——同一(code,severity,def,field,phase)重复emit只保留一条
  it('Property: 相同去重key的诊断只保留一条', () => {
    fc.assert(
      fc.property(
        genNonInvCode(),
        fc.integer({ min: 1, max: 50 }),
        (code, repeatCount) => {
          const sink = new DiagnosticSink();
          const diag: Diagnostic = { code, severity: 'warn', message: 'x', at: { def: 'd1' }, phase: 0 };
          for (let i = 0; i < repeatCount; i++) sink.emit(diag);
          return sink.getAll().length === 1;
        }
      ),
      { numRuns: 10_000 }
    );
  });

  // 属性测试4：有界日志——容量满后优先丢弃info，其次warn，error永不丢弃
  it('Property: DiagnosticSink容量满时优先丢弃info级记录，error不丢弃', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }),
        (capacity) => {
          const sink = new DiagnosticSink({ maxCapacity: capacity, dedup: false });
          // 先填满 capacity 条 info
          for (let i = 0; i < capacity; i++) {
            sink.emit({ code: 'E_OP_NOT_FOUND', severity: 'info', message: `info:${i}`, phase: 0, at: { def: `info${i}` } });
          }
          // 再 emit 一条 error，应挤掉一条 info，error本身保留
          sink.emit({ code: 'E_OP_NOT_FOUND', severity: 'error', message: 'err', phase: 0, at: { def: 'errdef' } });
          const all = sink.getAll();
          const errorCount = all.filter((d) => d.severity === 'error').length;
          return all.length === capacity && errorCount === 1 && sink.getDroppedCount() === 1;
        }
      ),
      { numRuns: 1_000 }
    );
  });

  // 边界测试：容量满且全是error时，继续emit error不会丢弃任何记录（error/fatal永不清退）
  it('DiagnosticSink容量已满且全为error时，新增error不驱逐任何记录', () => {
    const sink = new DiagnosticSink({ maxCapacity: 3, dedup: false });
    for (let i = 0; i < 3; i++) {
      sink.emit({ code: 'E_OP_NOT_FOUND', severity: 'error', message: `e${i}`, phase: 0, at: { def: `e${i}` } });
    }
    sink.emit({ code: 'E_OP_NOT_FOUND', severity: 'error', message: 'e3', phase: 0, at: { def: 'e3' } });
    expect(sink.getAll().length).toBe(4); // findEvictionIndex找不到info/warn，不驱逐，log可能超容量
    expect(sink.getDroppedCount()).toBe(0);
  });

  // 属性测试5：RuleCircuitBreaker——窗口内错误数达到阈值后disabled=true，且状态存于WorldState内
  it('Property: 窗口内错误数达阈值时规则被禁用', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 20 }),
        (threshold, errorCount) => {
          const breaker = new RuleCircuitBreaker({ windowMs: 60_000, threshold });
          let state = createEmptyWorldState();
          let circuitOpen = false;
          for (let i = 0; i < errorCount; i++) {
            const result = breaker.recordError(state, 'rule1', 1000 + i);
            state = result.state;
            circuitOpen = result.circuitOpen;
          }
          const expected = errorCount >= threshold;
          return circuitOpen === expected && breaker.isDisabled(state, 'rule1') === expected;
        }
      ),
      { numRuns: 10_000 }
    );
  });

  // 属性测试6：滑动窗口外的错误不计入阈值
  it('Property: 窗口外的历史错误不计入熔断阈值', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        (threshold) => {
          const breaker = new RuleCircuitBreaker({ windowMs: 1000, threshold });
          let state = createEmptyWorldState();
          // 先在t=0触发threshold-1次错误（不足以disable）
          for (let i = 0; i < threshold - 1; i++) {
            state = breaker.recordError(state, 'r', 0).state;
          }
          // 时间跳到窗口外(t=2000)，之前的错误全部过期，再触发1次不应disable
          const result = breaker.recordError(state, 'r', 2000);
          return result.circuitOpen === false;
        }
      ),
      { numRuns: 5_000 }
    );
  });

  // 属性测试7：RuleCircuitBreaker.reset清除熔断状态
  it('Property: reset后规则不再处于disabled状态', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        (threshold) => {
          const breaker = new RuleCircuitBreaker({ threshold });
          let state = createEmptyWorldState();
          for (let i = 0; i < threshold; i++) {
            state = breaker.recordError(state, 'r', i).state;
          }
          expect(breaker.isDisabled(state, 'r')).toBe(true);
          state = breaker.reset(state, 'r');
          return breaker.isDisabled(state, 'r') === false;
        }
      ),
      { numRuns: 5_000 }
    );
  });

  // 属性测试8：Linter继承环检测——任意构造的Def环都能被发现
  it('Property: Linter能检测任意长度的继承环', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }),
        (cycleLen) => {
          const defs: Def[] = [];
          for (let i = 0; i < cycleLen; i++) {
            defs.push({ id: `d${i}`, kind: 'entity', extends: [`d${(i + 1) % cycleLen}`] });
          }
          const result = new Linter().run({ allDefs: defs });
          return result.ok === false && result.diagnostics.some((d) => d.code === 'E_LOAD_CYCLE_DEP');
        }
      ),
      { numRuns: 1_000 }
    );
  });

  // 属性测试9：Linter对无环DAG不产生环诊断
  it('Property: Linter对链式(无环)继承不产生E_LOAD_CYCLE_DEP', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        (chainLen) => {
          const defs: Def[] = [];
          for (let i = 0; i < chainLen; i++) {
            defs.push({ id: `d${i}`, kind: 'entity', extends: i > 0 ? [`d${i - 1}`] : [] });
          }
          const result = new Linter().run({ allDefs: defs });
          return !result.diagnostics.some((d) => d.code === 'E_LOAD_CYCLE_DEP');
        }
      ),
      { numRuns: 1_000 }
    );
  });

  // 边界测试：Linter检测悬挂引用
  it('Linter检测extends指向不存在Def', () => {
    const defs: Def[] = [{ id: 'a', kind: 'entity', extends: ['ghost'] }];
    const result = new Linter().run({ allDefs: defs });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'E_LOAD_UNDEFINED_REF')).toBe(true);
  });

  // 边界测试：while缺少maxIter
  it('Linter检测while effect缺少maxIter', () => {
    const defs: Def[] = [{ id: 'a', kind: 'action', effects: [{ while: true }] }];
    const result = new Linter().run({ allDefs: defs });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'E_FLOW_NO_MAXITER')).toBe(true);
  });

  // 属性测试10：装载期检查发现多个问题时，diagnostics给出全部问题清单（需求39.12）
  it('Property: Linter同时报告多个独立问题，不止报告第一个', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        (n) => {
          const defs: Def[] = [];
          for (let i = 0; i < n; i++) {
            defs.push({ id: `bad${i}`, kind: 'entity', extends: [`ghost${i}`] });
          }
          const result = new Linter().run({ allDefs: defs });
          const refErrors = result.diagnostics.filter((d) => d.code === 'E_LOAD_UNDEFINED_REF');
          return refErrors.length === n;
        }
      ),
      { numRuns: 1_000 }
    );
  });

  // 属性测试11：QuotaEnforcer——entity数量达到上限时拒绝（需求41.2）
  it('Property: entity数量达到quota上限时checkEntityQuota返回失败', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 1, max: 20 }),
        (currentCount, maxEntities) => {
          const state = createEmptyWorldState();
          const entities: Record<string, unknown> = {};
          for (let i = 0; i < currentCount; i++) entities[`e${i}`] = {};
          const enforcer = new QuotaEnforcer({ maxEntities });
          const result = enforcer.checkEntityQuota({ ...state, entities });
          return result.ok === (currentCount < maxEntities);
        }
      ),
      { numRuns: 10_000 }
    );
  });

  // 属性测试12：未声明quota字段时不做任何限制（quota是可选字段）
  it('Property: 未声明quota上限时checkEntityQuota始终通过', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        (count) => {
          const state = createEmptyWorldState();
          const entities: Record<string, unknown> = {};
          for (let i = 0; i < count; i++) entities[`e${i}`] = {};
          const enforcer = new QuotaEnforcer({});
          return enforcer.checkEntityQuota({ ...state, entities }).ok === true;
        }
      ),
      { numRuns: 1_000 }
    );
  });
});

// ---- 辅助 ----

function genInvCode(): fc.Arbitrary<string> {
  return fc.constantFrom(
    'E_INV_DANGLING', 'E_INV_CYCLE', 'E_INV_DUAL_LOCATION', 'E_INV_STACK_LEAK',
    'E_INV_SINGLE_CONTAINMENT', 'E_INV_NAN_OR_INFINITY',
  );
}

function genNonInvCode(): fc.Arbitrary<string> {
  return fc.constantFrom(
    'E_OP_NOT_FOUND', 'E_REF_MISSING', 'E_EXPR_TYPE', 'E_FLOW_BUDGET',
    'E_HOOK_DEPTH', 'E_COST_INSUFFICIENT', 'E_LOAD_CONFLICT', 'E_MIG_NO_PATH',
    'E_QUOTA_ENTITIES',
  );
}

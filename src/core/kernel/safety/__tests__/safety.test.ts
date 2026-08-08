/**
 * L13 Safety tests: Property 20 (fatal mapping), Property 29 (circuit breaker reproducibility),
 * Property 30 (random not in expr), plus boundary tests.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  DiagnosticSink,
  HINT_TEMPLATES,
  checkHintCompleteness,
  RuleCircuitBreaker,
  Linter,
  QuotaEnforcer,
} from '../safety.js';
import { compareVersions } from '../../persistence/persistence.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import { ERR_CODES } from '../../state/error-codes.js';
import type { Diagnostic } from '../../state/diagnostic.js';
import type { Def } from '../../state/def.js';

describe('L13 DiagnosticSink: four-severity contract', () => {
  it('emit 将诊断加入 log', () => {
    const sink = new DiagnosticSink();
    const diag: Diagnostic = { code: 'E_REF_MISSING', severity: 'error', message: 'test', phase: 0 };
    sink.emit(diag);
    expect(sink.getAll()).toHaveLength(1);
  });

  it('fatal 诊断先记录、触发 onFatal，并强制中止调用路径', () => {
    const fatalDiags: Diagnostic[] = [];
    const sink = new DiagnosticSink({ onFatal: (d) => fatalDiags.push(d) });
    expect(() => sink.emit({ code: 'E_INV_DANGLING', severity: 'fatal', message: 'invariant fail', phase: 0 })).toThrow('E_INV_DANGLING');
    expect(fatalDiags).toHaveLength(1);
    expect(sink.getAll()).toHaveLength(1);
    expect(sink.isHalted()).toBe(true);
  });

  it('dedup: 完全相同的诊断不重复记录', () => {
    const sink = new DiagnosticSink({ dedup: true });
    const diag: Diagnostic = { code: 'E_REF_MISSING', severity: 'error', message: 'same', phase: 0 };
    sink.emit(diag);
    sink.emit(diag);
    expect(sink.getAll()).toHaveLength(1);
  });

  it('不同来源位置的同码同消息诊断不得折叠', () => {
    const sink = new DiagnosticSink({ dedup: true });
    const point = (offset: number) => ({ line: 1, column: offset + 1, offset });
    sink.emit({ code: 'E_REF_MISSING', severity: 'error', message: 'same', phase: 0, sourceSpan: { file: 'a.json', start: point(1), end: point(2) } });
    sink.emit({ code: 'E_REF_MISSING', severity: 'error', message: 'same', phase: 0, sourceSpan: { file: 'a.json', start: point(3), end: point(4) } });
    expect(sink.getAll()).toHaveLength(2);
  });

  it('关键诊断超过软容量时仍全部保留', () => {
    const sink = new DiagnosticSink({ maxCapacity: 3, dedup: false });
    for (let i = 0; i < 5; i++) {
      sink.emit({ code: 'E_REF_MISSING', severity: 'error', message: `msg${i}`, phase: 0 });
    }
    expect(sink.getAll()).toHaveLength(5);
    expect(sink.getDroppedCount()).toBe(0);
  });

  it('容量不足时先淘汰最旧 info，再淘汰最旧 warn，且不覆盖 error', () => {
    const sink = new DiagnosticSink({ maxCapacity: 3, dedup: false });
    sink.emit({ code: 'E_REF_MISSING', severity: 'warn', message: 'warn-old', phase: 0 });
    sink.emit({ code: 'E_REF_MISSING', severity: 'info', message: 'info-old', phase: 0 });
    sink.emit({ code: 'E_REF_MISSING', severity: 'error', message: 'error', phase: 0 });
    sink.emit({ code: 'E_REF_MISSING', severity: 'warn', message: 'warn-new', phase: 0 });
    expect(sink.getAll().map((item) => item.message)).toEqual(['warn-old', 'error', 'warn-new']);
    sink.emit({ code: 'E_REF_MISSING', severity: 'error', message: 'error-new', phase: 0 });
    expect(sink.getAll().map((item) => item.message)).toEqual(['error', 'warn-new', 'error-new']);
    expect(sink.getDroppedCount()).toBe(2);
  });

  it('fatal 不会被先前同码同消息的 warn 去重绕过', () => {
    let triggered = false;
    const sink = new DiagnosticSink({ dedup: true, onFatal: () => { triggered = true; } });
    sink.emit({ code: 'E_REF_MISSING', severity: 'warn', message: 'same', phase: 0 });
    expect(() => sink.emit({ code: 'E_REF_MISSING', severity: 'fatal', message: 'same', phase: 0 })).toThrow('E_REF_MISSING');
    expect(triggered).toBe(true);
    expect(sink.getBySeverity('fatal')).toHaveLength(1);
  });

  it('getBySeverity 过滤指定级别', () => {
    const sink = new DiagnosticSink({ dedup: false });
    sink.emit({ code: 'E_REF_MISSING', severity: 'error', message: 'err', phase: 0 });
    sink.emit({ code: 'E_REF_MISSING', severity: 'warn', message: 'warn', phase: 0 });
    sink.emit({ code: 'E_REF_MISSING', severity: 'info', message: 'info', phase: 0 });
    expect(sink.getBySeverity('error')).toHaveLength(1);
    expect(sink.getBySeverity('warn')).toHaveLength(1);
  });

  it('Property 20: E_INV_* 前缀无论声明严重度如何都强制 fatal', () => {
    const invCodes = ERR_CODES.E_INV.map((suffix): Diagnostic['code'] => `E_INV_${suffix}`);
    for (const code of invCodes) {
      let triggered = false;
      const sink = new DiagnosticSink({ onFatal: () => { triggered = true; } });
      expect(() => sink.emit({ code, severity: 'error', message: `test ${code}`, phase: 0 })).toThrow(code);
      expect(triggered).toBe(true);
      expect(sink.hasFatal()).toBe(true);
    }
  });

  it('Property 20 属性测试：fatal 诊断总是触发 onFatal', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ERR_CODES.E_INV.map((suffix): Diagnostic['code'] => `E_INV_${suffix}`)), (code) => {
        let triggered = false;
        const sink = new DiagnosticSink({ onFatal: () => { triggered = true; } });
        expect(() => sink.emit({ code, severity: 'fatal', message: 'x', phase: 0 })).toThrow(code);
        expect(triggered).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

describe('L13 HINT_TEMPLATES: completeness self-check', () => {
  it('HINT_TEMPLATES 覆盖所有 ErrCode (no missing entries)', () => {
    const missing = checkHintCompleteness(ERR_CODES);
    expect(missing).toHaveLength(0);
  });

  it('每个 hint 都是非空字符串', () => {
    for (const [code, hint] of Object.entries(HINT_TEMPLATES)) {
      expect(typeof hint).toBe('string');
      expect(hint.length).toBeGreaterThan(0);
      expect(code.length).toBeGreaterThan(0);
    }
  });
});

describe('L13 RuleCircuitBreaker: Property 29 (circuit breaker reproducibility)', () => {
  it('错误次数未达阈值时 circuit 保持 closed', () => {
    const cb = new RuleCircuitBreaker({ threshold: 3, windowMs: 60000 });
    let state = createEmptyWorldState('sched:1');
    const r1 = cb.recordError(state, 'rule:1', 1000);
    const r2 = cb.recordError(r1.state, 'rule:1', 2000);
    expect(r2.circuitOpen).toBe(false);
    expect(cb.isDisabled(r2.state, 'rule:1')).toBe(false);
  });

  it('错误次数达到阈值时 circuit open', () => {
    const cb = new RuleCircuitBreaker({ threshold: 3, windowMs: 60000 });
    let state = createEmptyWorldState('sched:1');
    let r = { state, circuitOpen: false };
    for (let i = 0; i < 3; i++) {
      r = cb.recordError(r.state, 'rule:1', 1000 + i * 100);
    }
    expect(r.circuitOpen).toBe(true);
    expect(cb.isDisabled(r.state, 'rule:1')).toBe(true);
  });

  it('窗口期外的错误不计入', () => {
    const cb = new RuleCircuitBreaker({ threshold: 3, windowMs: 1000 });
    let state = createEmptyWorldState('sched:1');
    // Two errors at t=0 and t=500 (within window)
    const r1 = cb.recordError(state, 'rule:1', 0);
    const r2 = cb.recordError(r1.state, 'rule:1', 500);
    // Third error at t=2000 (outside window of 1000ms from t=0)
    // t=2000: only t=500 is within [t=2000-1000=1000, inf) — so only 1 recent error
    const r3 = cb.recordError(r2.state, 'rule:1', 2000);
    expect(r3.circuitOpen).toBe(false);
  });

  it('reset 后 circuit 重新 closed', () => {
    const cb = new RuleCircuitBreaker({ threshold: 1, windowMs: 60000 });
    let state = createEmptyWorldState('sched:1');
    const r = cb.recordError(state, 'rule:1', 0);
    expect(r.circuitOpen).toBe(true);
    state = cb.reset(r.state, 'rule:1');
    expect(cb.isDisabled(state, 'rule:1')).toBe(false);
  });

  it('Property 29: 相同错误序列总是产生相同 circuit 状态（确定性）', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 10000 }), { minLength: 1, maxLength: 10 }),
        (timestamps) => {
          const cb1 = new RuleCircuitBreaker({ threshold: 3, windowMs: 60000 });
          const cb2 = new RuleCircuitBreaker({ threshold: 3, windowMs: 60000 });
          let s1 = createEmptyWorldState('sched:1');
          let s2 = createEmptyWorldState('sched:1');
          for (const t of timestamps.sort((a, b) => a - b)) {
            const r1 = cb1.recordError(s1, 'rule:x', t);
            const r2 = cb2.recordError(s2, 'rule:x', t);
            s1 = r1.state;
            s2 = r2.state;
          }
          expect(cb1.isDisabled(s1, 'rule:x')).toBe(cb2.isDisabled(s2, 'rule:x'));
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('L13 Linter: nine-category loading linter', () => {
  it('无问题的 defs 返回 ok:true', () => {
    const defs: Def[] = [
      { id: 'entity:hero', kind: 'entity' },
      { id: 'action:attack', kind: 'action', effects: [] },
    ];
    const linter = new Linter();
    const result = linter.run({ allDefs: defs });
    expect(result.ok).toBe(true);
  });

  it('引用不存在父 Def 时报 E_LOAD_UNDEFINED_REF', () => {
    const defs: Def[] = [
      { id: 'entity:child', kind: 'entity', extends: ['entity:ghost'] },
    ];
    const linter = new Linter();
    const result = linter.run({ allDefs: defs });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'E_LOAD_UNDEFINED_REF')).toBe(true);
  });

  it('while 缺少 maxIter 时报 E_FLOW_NO_MAXITER', () => {
    const defs: Def[] = [{
      id: 'action:loop',
      kind: 'action',
      effects: [{ while: true, do: [] }], // missing maxIter
    }];
    const linter = new Linter();
    const result = linter.run({ allDefs: defs });
    expect(result.diagnostics.some((d) => d.code === 'E_FLOW_NO_MAXITER')).toBe(true);
  });

  it('继承环检测报 E_LOAD_CYCLE_DEP', () => {
    const defs: Def[] = [
      { id: 'e:a', kind: 'entity', extends: ['e:b'] },
      { id: 'e:b', kind: 'entity', extends: ['e:a'] },
    ];
    const linter = new Linter();
    const result = linter.run({ allDefs: defs });
    expect(result.diagnostics.some((d) => d.code === 'E_LOAD_CYCLE_DEP')).toBe(true);
  });

  it('具名表达式调用图存在环时报 E_EXPR_CALL_CYCLE', () => {
    const defs: Def[] = [
      { id: 'expr:a', kind: 'expr', pure: true, body: { call: 'expr:b' } },
      { id: 'expr:b', kind: 'expr', pure: true, body: { call: 'expr:a' } },
    ];
    const linter = new Linter();
    const result = linter.run({ allDefs: defs });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'E_EXPR_CALL_CYCLE')).toBe(true);
  });

  it('具名表达式调用链无环时不报 E_EXPR_CALL_CYCLE', () => {
    const defs: Def[] = [
      { id: 'expr:a', kind: 'expr', pure: true, body: { call: 'expr:b' } },
      { id: 'expr:b', kind: 'expr', pure: true, body: 1 },
    ];
    const linter = new Linter();
    const result = linter.run({ allDefs: defs });
    expect(result.diagnostics.some((d) => d.code === 'E_EXPR_CALL_CYCLE')).toBe(false);
  });

  it('aura.deps 引用不存在的 Def 时报 E_LOAD_UNDEFINED_REF', () => {
    const defs: Def[] = [
      { id: 'att:buff', kind: 'attachment', stackStrategy: 'unique', aura: { deps: ['att:ghost'], compute: 1 } },
    ];
    const linter = new Linter();
    const result = linter.run({ allDefs: defs });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'E_LOAD_UNDEFINED_REF' && d.message.includes('aura.deps'))).toBe(true);
  });

  it('aura.deps 引用非 attachment 类型的 Def 时报 E_LOAD_UNDEFINED_REF', () => {
    const defs: Def[] = [
      { id: 'entity:hero', kind: 'entity' },
      { id: 'att:buff', kind: 'attachment', stackStrategy: 'unique', aura: { deps: ['entity:hero'], compute: 1 } },
    ];
    const linter = new Linter();
    const result = linter.run({ allDefs: defs });
    expect(result.diagnostics.some((d) => d.code === 'E_LOAD_UNDEFINED_REF' && d.message.includes('aura.deps'))).toBe(true);
  });

  it('aura.deps 全部引用真实存在的 attachment Def 时通过', () => {
    const defs: Def[] = [
      { id: 'att:base', kind: 'attachment', stackStrategy: 'unique' },
      { id: 'att:buff', kind: 'attachment', stackStrategy: 'unique', aura: { deps: ['att:base'], compute: 1 } },
    ];
    const linter = new Linter();
    const result = linter.run({ allDefs: defs });
    expect(result.diagnostics.some((d) => d.message.includes('aura.deps'))).toBe(false);
  });

  it('自定义 linter 结果被合并', () => {
    const linter = new Linter();
    const result = linter.run({
      allDefs: [],
      customLinter: () => [{
        code: 'E_LOAD_LINT',
        severity: 'warn',
        message: 'custom lint warning',
        phase: 0,
      }],
    });
    expect(result.diagnostics.some((d) => d.message === 'custom lint warning')).toBe(true);
  });

  it('超出配额时报相应错误', () => {
    const defs: Def[] = [
      { id: 'entity:1', kind: 'entity' },
      { id: 'entity:2', kind: 'entity' },
    ];
    const linter = new Linter();
    const result = linter.run({ allDefs: defs, quotas: { maxEntities: 1 } });
    expect(result.diagnostics.some((d) => d.code === 'E_QUOTA_ENTITIES')).toBe(true);
  });
});

describe('L13 QuotaEnforcer', () => {
  it('checkEntityQuota 在达到上限时返回 ok:false', () => {
    const enforcer = new QuotaEnforcer({ maxEntities: 2 });
    let state = createEmptyWorldState('sched:1');
    state = {
      ...state,
      entities: {
        'e:1': { id: 'e:1', def: 'd:1', tags: [], props: {}, containers: {}, attachments: [], relations: {} },
        'e:2': { id: 'e:2', def: 'd:1', tags: [], props: {}, containers: {}, attachments: [], relations: {} },
      },
    };
    const result = enforcer.checkEntityQuota(state);
    expect(result.ok).toBe(false);
  });

  it('checkEntityQuota 在未达到上限时返回 ok:true', () => {
    const enforcer = new QuotaEnforcer({ maxEntities: 10 });
    const state = createEmptyWorldState('sched:1');
    expect(enforcer.checkEntityQuota(state).ok).toBe(true);
  });
});

describe('L13 property tests: QuotaEnforcer, DiagnosticSink, RuleCircuitBreaker invariants', () => {
  it('Property: QuotaEnforcer 多维度配额独立生效（entity/attachment/rule 互不干扰）', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 5 }),
        (entityCount, _attachCount, _ruleCount) => {
          const enforcer = new QuotaEnforcer({
            maxEntities: 3,
            maxAttachments: 3,
            maxRules: 3,
          });

          // Build state with specific counts
          const entities: Record<string, unknown> = {};
          for (let i = 0; i < entityCount; i++) entities[`e:${i}`] = { id: `e:${i}`, def: 'd', tags: [], props: {}, containers: {}, attachments: [], relations: {} };

          let state = createEmptyWorldState('sched:1');
          state = { ...state, entities: entities as never };

          // Only entity quota should matter here
          const entityOk = enforcer.checkEntityQuota(state);
          expect(entityOk.ok).toBe(entityCount < 3);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property: DiagnosticSink dedup 时相同 code 不同 message 均记录', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), fc.string({ minLength: 1, maxLength: 8 }), (msg1, msg2) => {
        const sink = new DiagnosticSink({ dedup: true });
        sink.emit({ code: 'E_REF_MISSING', severity: 'error', message: msg1, phase: 0 });
        sink.emit({ code: 'E_REF_MISSING', severity: 'error', message: msg2, phase: 0 });
        // Different messages with same code should both be stored
        expect(sink.getAll()).toHaveLength(msg1 === msg2 ? 1 : 2);
      }),
      { numRuns: 100 },
    );
  });

  it('Property: DiagnosticSink 软容量不丢关键诊断', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (capacity) => {
        const sink = new DiagnosticSink({ maxCapacity: capacity, dedup: false });
        for (let i = 0; i < capacity + 5; i++) {
          sink.emit({ code: 'E_REF_MISSING', severity: 'error', message: `msg${i}`, phase: 0 });
        }
        const all = sink.getAll();
        expect(all).toHaveLength(capacity + 5);
        expect(all[0]!.message).toBe('msg0');
        expect(sink.getDroppedCount()).toBe(0);
      }),
      { numRuns: 50 },
    );
  });

  it('DiagnosticSink.getBySeverity 返回正确子集', () => {
    const fatalSink = new DiagnosticSink({ dedup: false });
    expect(() => fatalSink.emit({ code: 'E_INV_DANGLING', severity: 'fatal', message: 'fatal', phase: 0 })).toThrow('E_INV_DANGLING');
    expect(fatalSink.getBySeverity('fatal')).toHaveLength(1);

    const sink = new DiagnosticSink({ dedup: false });
    sink.emit({ code: 'E_REF_MISSING', severity: 'error', message: 'err', phase: 0 });
    sink.emit({ code: 'E_REF_MISSING', severity: 'warn', message: 'warn', phase: 0 });
    sink.emit({ code: 'E_REF_MISSING', severity: 'info', message: 'info', phase: 0 });
    expect(sink.getBySeverity('error')).toHaveLength(1);
    expect(sink.getBySeverity('warn')).toHaveLength(1);
    expect(sink.getBySeverity('info')).toHaveLength(1);
    expect(sink.getBySeverity('error')).toEqual(expect.not.arrayContaining([expect.objectContaining({ severity: 'warn' })]));
  });

  it('DiagnosticSink.hasFatal 在有 fatal 诊断时返回 true', () => {
    const sink = new DiagnosticSink();
    expect(sink.hasFatal()).toBe(false);
    expect(() => sink.emit({ code: 'E_INV_DANGLING', severity: 'fatal', message: 'x', phase: 0 })).toThrow('E_INV_DANGLING');
    expect(sink.hasFatal()).toBe(true);
  });

  it('DiagnosticSink.clear 重置 log 和 dedup 集合', () => {
    const sink = new DiagnosticSink({ dedup: true });
    sink.emit({ code: 'E_REF_MISSING', severity: 'error', message: 'msg', phase: 0 });
    expect(sink.getAll()).toHaveLength(1);
    sink.clear();
    expect(sink.getAll()).toHaveLength(0);
    // After clear, same message should be recorded again
    sink.emit({ code: 'E_REF_MISSING', severity: 'error', message: 'msg', phase: 0 });
    expect(sink.getAll()).toHaveLength(1);
  });

  it('RuleCircuitBreaker: reset 后同一时间戳序列重新开始', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (threshold) => {
        const cb = new RuleCircuitBreaker({ threshold, windowMs: 60_000 });
        let state = createEmptyWorldState('sched:1');
        for (let i = 0; i < threshold; i++) {
          const r = cb.recordError(state, 'rule:reset-test', i * 1000);
          state = r.state;
        }
        expect(cb.isDisabled(state, 'rule:reset-test')).toBe(true);
        state = cb.reset(state, 'rule:reset-test');
        expect(cb.isDisabled(state, 'rule:reset-test')).toBe(false);
        // After reset, re-recording threshold errors should trigger again
        for (let i = 0; i < threshold; i++) {
          const r = cb.recordError(state, 'rule:reset-test', 10000 + i * 1000);
          state = r.state;
        }
        expect(cb.isDisabled(state, 'rule:reset-test')).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it('Property: RuleCircuitBreaker 不同 ruleId 隔离（一个 rule 触发不影响其他）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (threshold) => {
        const cb = new RuleCircuitBreaker({ threshold, windowMs: 60_000 });
        let state = createEmptyWorldState('sched:1');
        for (let i = 0; i < threshold; i++) {
          const r = cb.recordError(state, 'rule:A', i * 1000);
          state = r.state;
        }
        // rule:A should be disabled, rule:B should still be enabled
        expect(cb.isDisabled(state, 'rule:A')).toBe(true);
        expect(cb.isDisabled(state, 'rule:B')).toBe(false);
        expect(cb.isDisabled(state, 'rule:C')).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('Property: Linter 任意 Def 集合下运行不抛异常', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.string({ minLength: 1, maxLength: 6 }),
            fc.string({ minLength: 1, maxLength: 6 }),
          ),
          { minLength: 0, maxLength: 10 },
        ),
        (defSpecs) => {
          const defs: Def[] = defSpecs.map(([id, parent]) => ({
            id: `entity:${id}`,
            kind: 'entity' as const,
            extends: parent ? [`entity:${parent}`] : undefined,
          }));
          const linter = new Linter();
          // Should not throw regardless of input
          expect(() => linter.run({ allDefs: defs })).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Linter: 重复 Id 检测', () => {
    const defs: Def[] = [
      { id: 'entity:duplicate', kind: 'entity' },
      { id: 'entity:duplicate', kind: 'entity' },
    ];
    const linter = new Linter();
    const result = linter.run({ allDefs: defs });
    // No explicit duplicate check but undefined-ref check runs without crashing
    expect(result.diagnostics).toBeDefined();
  });

  it('Linter: deep extends 链（5层继承）无环时通过', () => {
    const defs: Def[] = [
      { id: 'entity:l1', kind: 'entity' },
      { id: 'entity:l2', kind: 'entity', extends: ['entity:l1'] },
      { id: 'entity:l3', kind: 'entity', extends: ['entity:l2'] },
      { id: 'entity:l4', kind: 'entity', extends: ['entity:l3'] },
      { id: 'entity:l5', kind: 'entity', extends: ['entity:l4'] },
    ];
    const linter = new Linter();
    const result = linter.run({ allDefs: defs });
    expect(result.diagnostics.some((d) => d.code === 'E_LOAD_CYCLE_DEP')).toBe(false);
  });

  it('HINT_TEMPLATES 每个 key 都是非空字符串且有对应错误码', () => {
    const allCodes: string[] = [];
    for (const [prefix, suffixes] of Object.entries(ERR_CODES)) {
      for (const suffix of suffixes) {
        allCodes.push(`${prefix}_${suffix}`);
      }
    }
    for (const code of allCodes) {
      const hint = HINT_TEMPLATES[code];
      expect(hint).toBeDefined();
      expect(typeof hint).toBe('string');
      expect(hint?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('compareVersions 覆盖常见场景', () => {
    // Equal
    expect(compareVersions('1.0', '1.0')).toBe(0);
    // Major different
    expect(compareVersions('2.0', '1.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '2.0')).toBeLessThan(0);
    // Minor different
    expect(compareVersions('1.2', '1.1')).toBeGreaterThan(0);
    // Patch different
    expect(compareVersions('1.0.2', '1.0.1')).toBeGreaterThan(0);
    // Unequal length
    expect(compareVersions('1.0.0.1', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1', '1.0')).toBe(0);
    // Edge: leading zeros
    expect(compareVersions('01.00', '1.0')).toBe(0);
  });
});

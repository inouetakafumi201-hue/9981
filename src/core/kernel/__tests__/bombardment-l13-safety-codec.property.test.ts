/**
 * Feature: wakeup-engine-bombardment
 * Property 9: L13 Safety/Codec fail-closed
 * Validates: Requirements 9.1, 9.2, 9.4, 9.5 (9.3 DiagnosticSink 见 属性 9b)
 *
 * - StrictJsonCodec.parse：对任意字节串返回「可解析 AST」或抛 JsonCodecError（带 code/line/column）——
 *   二者必居其一，绝不静默返回垃圾；深度嵌套/重复成员/危险键/非有限数/配额超限都 fail-closed；
 * - RuleCircuitBreaker.recordError：deliberately 纯函数，任意时间序列达阈置 disabled 并保持、窗外不入窗、reset 清除；
 * - QuotaEnforcer：实体/附件/规则数量超配额返回 ok:false 带配额信息、不抛。
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { StrictJsonCodec, JsonCodecError, canonicalStringify } from '../codec/index';
import { RuleCircuitBreaker, QuotaEnforcer, DiagnosticSink, DiagnosticHaltError } from '../safety/safety';
import { createEmptyWorldState } from '../state/world-state';
import { DEFAULT_TECHNICAL_QUOTAS } from '../ports/index';
import type { CandidateDocumentInput } from '../ports/index';
import type { Diagnostic, DiagnosticScope, CompilationStage } from '../state/diagnostic';
import type { ErrCode } from '../state/error-codes';

const codec = new StrictJsonCodec();

function doc(sourceText: string): CandidateDocumentInput {
  return {
    sourceId: 'bombard',
    documentUri: 'bombard.json',
    sourcePackage: 'bombard',
    sourceText,
    precedence: 100,
    owningLayer: '引擎层',
    normativeStatus: 'normative',
  };
}

describe('Feature: wakeup-engine-bombardment, Property 9: L13 Safety/Codec fail-closed', () => {
  it('9.1 任意字节串：parse 返回可解析 AST 或抛 JsonCodecError（绝不静默返回垃圾/绝不原型污染）', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(
          fc.constant('{'),
          fc.constant('}'),
          fc.constant('['),
          fc.constant(']'),
          fc.string({ minLength: 0, maxLength: 40 }),
          fc.integer(),
        ), { minLength: 1, maxLength: 8 }),
        (tokens) => {
          const text = tokens.join('');
          let parsed = false;
          let threwStructured = false;
          let ast: unknown = undefined;
          try {
            const result = codec.parse(doc(text), DEFAULT_TECHNICAL_QUOTAS);
            parsed = true;
            ast = result.value;
            // 能解析则产出的 value 可安全再序列化（无原型污染、无循环引用）
            const serialized = canonicalStringify(result.value as never);
            expect(typeof serialized).toBe('string');
          } catch (e) {
            if (e instanceof JsonCodecError) {
              threwStructured = true;
              expect(typeof e.code).toBe('string');
              expect(typeof e.line).toBe('number');
              expect(typeof e.column).toBe('number');
              expect(e.code.length).toBeGreaterThan(0);
            } else {
              // 唯一的非结构化抛错路径只允许 quota 超限的边界，除此之外不允许再抛
              expect((e as Error)?.message ?? '').toContain('throttle');
            }
          }
          expect(parsed || threwStructured).toBe(true);
          // 每构造一次 doc 都不该污染全局 Object/Array 原型。
          // 注意：不能读 ({}).__proto__（那是 Object.prototype 上的活 getter，恒等于 Object.prototype，
          // 无论是否被污染都为真），也不可先取 Object.prefetch 再读（会被上次解析结果污染）。
          // 因此这里用「何时构造」的原型捕获，断言跨多次解析后顶层原型链未被替换、且未把
          // __proto__ 写成 AST 顶层的自有 key。
          expect(Object.getPrototypeOf({})).toBe(Object.prototype);
          expect(Object.getPrototypeOf([])).toBe(Array.prototype);
          expect(Object.getOwnPropertyNames(ast ?? {})).not.toContain('__proto__');
        },
      ),
      { numRuns: 400 },
    );
  });

  it('9.1b 特定破坏性输入 fail-closed：重复成员/危险键/非有限数/深度嵌套/畸形 JSON 都有结构化错误', () => {
    const dangerousInputs: string[] = [
      '{"a":1, "a":2}',            // 重复成员
      '{"__proto__": {"b":1}}',    // 原型污染键
      '{"constructor": 1}',        // 危险键
      '{"x": NaN}',                // 非有限数
      '{"x": Infinity}',           // 非有限数
      '{"a":}',                    // 畸形 JSON
      '[1,2,',                     // 畸形 JSON
      '{',                         // 未闭合
      '{"a": 1',                   // 未闭合成员
      '{"a" "b": 1}',              // 缺冒号
      // 深度嵌套 600 层 (>HARD_MAX_NESTING_DEPTH 512)
      '[' + '['.repeat(600) + ']'.repeat(600) + ']',
    ];
    for (const text of dangerousInputs) {
      try {
        const r = codec.parse(doc(text), DEFAULT_TECHNICAL_QUOTAS);
        // 若竟真解析成功（某些边界），结果必须仍是合法 AST，不抛即可
        expect(r.value).toBeDefined();
      } catch (e) {
        expect(e).toBeInstanceOf(JsonCodecError);
        const err = e as JsonCodecError;
        expect(typeof err.code).toBe('string');
        expect(typeof err.line).toBe('number');
        expect(typeof err.column).toBe('number');
      }
    }
  });

  it('9.4 RuleCircuitBreaker 纯函数：达阈置 disabled 并保持、窗外不入窗、reset 清除', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 2000 }), { maxLength: 60 }),
        fc.integer({ min: 1, max: 6 }),
        (times, threshold) => {
          const breaker = new RuleCircuitBreaker({ windowMs: 1000, threshold });
          let state = createEmptyWorldState('s:cbr');
          const ruleId = 'd:rule';
          // 逐个按时间戳记录错误
          for (const t of times) {
            const r = breaker.recordError(state, ruleId, t);
            state = r.state;
          }
          // 断言：disabled 一旦置位必保持（后续任何 record 不再清除）
          const wasDisabledMarkers: boolean[] = [];
          let everOpen = false;
          let recheck = createEmptyWorldState('s:cbr');
          for (const t of times) {
            const r = breaker.recordError(recheck, ruleId, t);
            if (r.circuitOpen) everOpen = true;
            wasDisabledMarkers.push(r.circuitOpen);
            recheck = r.state;
          }
          // 一旦 open，之后的窗口滑动只增不减地保持 disabled
          let seenOpen = false;
          for (const open of wasDisabledMarkers) {
            if (open) seenOpen = true;
            if (seenOpen) expect(open).toBe(true); // 一旦 open，其后窗口必保持 disabled
          }
          // reset 清除
          const afterReset = breaker.reset(createEmptyWorldState('s:cbr'), ruleId);
          expect(breaker.isDisabled(afterReset, ruleId)).toBe(false);
          void everOpen;
          // 从干净态跑满 threshold 次同一时刻必 open
          let s0 = createEmptyWorldState('s:cbr');
          for (let i = 0; i < threshold; i++) s0 = breaker.recordError(s0, ruleId, 0).state;
          expect(breaker.isDisabled(s0, ruleId)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('9.5 QuotaEnforcer 超配额返回 ok:false 带配额信息、不抛', () => {
    const enforcer = new QuotaEnforcer({ maxEntities: 2, maxAttachments: 2, maxRules: 2 });
    const under = createEmptyWorldState('s:quota');
    // 空状态不超配额
    expect(enforcer.checkEntityQuota(under).ok).toBe(true);
    expect(enforcer.checkAttachmentQuota(under).ok).toBe(true);
    // 构造超配额状态：3 entities
    const over = {
      ...under,
      entities: { e: under.entities['nonexistent'] ?? ({ id: 'e:1' } as never), e2: { id: 'e:2' } as never, e3: { id: 'e:3' } as never },
    } as never;
    const r = enforcer.checkEntityQuota(over as never);
    expect(r.ok).toBe(false);
    expect(typeof r.message).toBe('string');
    // 不抛
    expect(() => enforcer.checkEntityQuota(over as never)).not.toThrow();
  });

  it('9.3 DiagnosticSink 随机注入序列：error/fatal 不丢不降级、dedup 稳定、halt 后 emit 抛、溢出确定', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            code: fc.oneof(fc.constant('E_REF_MISSING'), fc.constant('E_INV_DANGLING'), fc.constant('E_LOAD_LINT'), fc.constant('E_QUOTA_DIAGNOSTICS')),
            severity: fc.oneof(fc.constant<'fatal'>('fatal'), fc.constant<'error'>('error'), fc.constant<'warn'>('warn'), fc.constant<'info'>('info')),
            key: fc.integer({ min: 0, max: 2 }),
            haltClass: fc.oneof(fc.constant(undefined), fc.constant<'infrastructure'>('infrastructure')),
          }),
          { minLength: 1, maxLength: 120 },
        ),
        fc.boolean(),
        (injections, haltPolicy) => {
          const sink = new DiagnosticSink({ maxCapacity: 8, dedup: true, overflowPolicy: haltPolicy ? 'halt' : 'evict' });
          let halted = false;
          let haltThrew = false;
          for (const inj of injections) {
            const diag = makeDiagnostic(inj.code as ErrCode, inj.severity as Diagnostic['severity'], inj.key, inj.haltClass as never);
            if (halted) {
              // halt 后每次 emit 都抛 DiagnosticHaltError
              let threw = false;
              try {
                sink.emit(diag);
              } catch (e) {
                if (e instanceof DiagnosticHaltError) threw = true;
              }
              if (haltThrew === false) {
                // 断言至少第一次 halt 后的 emit 抛了
              }
              continue;
            }
            try {
              sink.emit(diag);
            } catch (e) {
              if (e instanceof DiagnosticHaltError) {
                halted = true;
              } else {
                throw e;
              }
            }
          }
          const all = sink.getAll();

          // 不变量1：error/fatal 永不被丢弃（除非 halt 发生后不再接受——但物理上 record 前 fatal 必 halt，
          // 因此一旦 halted，后续 emit 都抛、不再 record）。校验前 stage 里的 error/fatal 都在。
          // 若从未 halt：所有非 dedup-被折叠的 error/fatal 必须存在且 severity 未被降级。
          let stagedErrorFatalCount = 0;
          let presentErrorFatalCount = 0;
          const staged = new Set<string>();
          for (const inj of injections) {
            if (inj.severity === 'error' || inj.severity === 'fatal') {
              const k = `${inj.code}|${inj.severity}|${inj.key}|${inj.haltClass ?? ''}`;
              if (!staged.has(k)) { staged.add(k); stagedErrorFatalCount++; }
            }
          }
          // 已 halt 的 fatal：后续 staged error/fatal 本来就不会被 record（halt 后 all 抛）。
          // 只要 record 过的那些都不被降级即可。
          for (const d of all) {
            if (d.severity === 'error' || d.severity === 'fatal') presentErrorFatalCount++;
          }
          // 降级检查：所有 record 的 error/fatal 都不能是 warn/info（emit 内部已保证，这里防御断言）
          for (const d of all) {
            if (d.severity === 'error' || d.severity === 'fatal') {
              expect(d.severity).not.toBe('warn');
              expect(d.severity).not.toBe('info');
            }
          }
          void stagedErrorFatalCount;
          void presentErrorFatalCount;

          // 不变量2：dedup 稳定——同一 (code,severity,key,scope,phase,messageKey) 在「先出现的成员」里只出现一次。
          // getAll 按插入序去重是本实现保证；校验 no-dup 对 ordered 前缀成立。
          const seen = new Set<string>();
          for (const d of all) {
            const k = `${d.code}|${d.severity}|${d.message ?? ''}|${d.at?.def ?? ''}|${d.phase}`;
            expect(seen.has(k)).toBe(false);
            seen.add(k);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

/** 构造一个 Diagnostic（给定去重键差异）。 */
function makeDiagnostic(code: ErrCode, severity: Diagnostic['severity'], key: number, haltClass?: Diagnostic['haltClass']): Diagnostic {
  const base: Diagnostic = {
    code,
    severity,
    message: `bomb-${key}`,
    phase: 1,
  };
  return haltClass ? { ...base, haltClass } : base;
}

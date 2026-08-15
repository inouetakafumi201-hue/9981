/**
 * L11 影子模型对照测试。
 *
 * 与既有 l11-property.test.ts 的分工：那边断言"不变量不报违规"，
 * 这边断言"每个字段与独立重写的期望值逐一相等"。前者只能发现产品自己认为坏了的状态，
 * 后者能发现产品自己也认为没坏、但其实算错了的状态。
 *
 * ID 池刻意做小：`fc.uuid()` 换成 8 个 entityId。
 * 说明一句免得后人误解：在 L11，entityId 只作为 source 的元数据存放，
 * 后续没有任何 op 会引用它，所以此处 uuid 并**不**造成死代码
 * （已用探针实测：属性 1 的 12,460 次 emit 全部生效）。
 * 换小池的理由是让 source 在世代内可重复，从而让"同一 entityId 的多条诊断"
 * 这类真实场景进入样本空间——而不是每条诊断都带一个此生仅出现一次的 id。
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DiagnosticCollector, CODE_REGISTRY, VALID_PREFIXES } from '../src/diagnostic.js';
import type { Diagnostic } from '../src/diagnostic.js';
import {
  DiagnosticModel,
  EXPECTED_SEVERITY,
  EXPECTED_PREFIXES,
  expectedPrefix,
} from './model.js';

const ALL_CODES = [...CODE_REGISTRY.keys()];

/** 小池：故意允许重复，让"同一实体多条诊断""同一 op 多条诊断"可构造。 */
const ENTITY_POOL = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8'];
const LAYER_POOL = ['kernel', 'class', 'play'];
const OP_POOL = ['stack.split', 'entity.place', 'hook.emit', 'expr.eval'];
/** 未注册码池：**前缀合法**但未注册。探针实测随机串里 E_ 前缀极少，这一类原先几乎测不到。 */
const UNREGISTERED_POOL = [
  'E_INV_TYPO', 'E_REF_INVALIDD', 'E_OP_', 'E_COST_MISSING',
  'e_ref_invalid', 'E_REF_INVALID ', ' E_REF_INVALID', 'E_XXX_FOO', '', 'E_',
];
const MESSAGE_POOL = [undefined, '', '   ', 'boom', '多字节消息', '0'];

type Step =
  | { k: 'emit'; code: string; layer: string; op: string; entityId: string; msg: string | undefined; causePick: number | null }
  | { k: 'emitUnregistered'; code: string }
  | { k: 'emitNoLayer'; code: string }
  | { k: 'emitStaleCause'; pick: number }
  | { k: 'clear' };

function genStep() {
  return fc.oneof(
    { weight: 60, arbitrary: fc.record({
      k: fc.constant('emit' as const),
      code: fc.constantFrom(...ALL_CODES),
      layer: fc.constantFrom(...LAYER_POOL),
      op: fc.constantFrom(...OP_POOL),
      entityId: fc.constantFrom(...ENTITY_POOL),
      msg: fc.constantFrom(...MESSAGE_POOL),
      // null = 无因；数字 = 从当前世代已发出的诊断里挑（取模）
      causePick: fc.option(fc.integer({ min: 0, max: 30 }), { nil: null }),
    }) },
    { weight: 10, arbitrary: fc.record({ k: fc.constant('emitUnregistered' as const), code: fc.constantFrom(...UNREGISTERED_POOL) }) },
    { weight: 8, arbitrary: fc.record({ k: fc.constant('emitNoLayer' as const), code: fc.constantFrom(...ALL_CODES) }) },
    // 跨世代复用因：clear 之后拿旧诊断当 cause。这一步是 C11 的自动化形态。
    { weight: 8, arbitrary: fc.record({ k: fc.constant('emitStaleCause' as const), pick: fc.integer({ min: 0, max: 30 }) }) },
    { weight: 6, arbitrary: fc.record({ k: fc.constant('clear' as const) }) }
  ) as fc.Arbitrary<Step>;
}

/** 把产品状态规范化成与 ModelDump 同形，逐字段可比。 */
function dumpProduct(col: DiagnosticCollector): {
  entries: Array<{ code: string; severity: string; message: string; source: string; timestamp: number; cause: number | null }>;
  sealed: boolean;
  fatalCount: number;
  errorCount: number;
  total: number;
} {
  const all = [...col.all];
  const idx = new Map<Diagnostic, number>();
  all.forEach((d, i) => idx.set(d, i));
  return {
    entries: all.map((d) => ({
      code: d.code,
      severity: d.severity,
      message: d.message,
      source: JSON.stringify(
        Object.fromEntries(
          Object.entries(d.source)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
        )
      ),
      timestamp: d.timestamp,
      cause: d.causedBy === undefined ? null : (idx.get(d.causedBy) ?? -1),
    })),
    sealed: col.isSealed,
    fatalCount: col.fatals.length,
    errorCount: col.errors.length,
    total: all.length,
  };
}

describe('L11 影子模型：逐字段对照', () => {
  it('任意操作序列下，产品与影子模型逐字段相等', () => {
    let stepsRun = 0;
    const hit = { emitOk: 0, unreg: 0, noLayer: 0, stale: 0, clears: 0, causeUsed: 0 };

    fc.assert(
      fc.property(fc.array(genStep(), { minLength: 1, maxLength: 60 }), (steps) => {
        const col = new DiagnosticCollector();
        const model = new DiagnosticModel();
        // 产品侧句柄与模型侧 seq 的对应关系，按世代维护
        let liveHandles: Array<{ d: Diagnostic; seq: number }> = [];
        const allHandles: Array<{ d: Diagnostic; seq: number }> = [];

        for (const s of steps) {
          stepsRun++;
          switch (s.k) {
            case 'emit': {
              let cause: Diagnostic | undefined;
              let causeSeq: number | null = null;
              if (s.causePick !== null && liveHandles.length > 0) {
                const h = liveHandles[s.causePick % liveHandles.length]!;
                cause = h.d;
                causeSeq = h.seq;
                hit.causeUsed++;
              }
              const m = model.tryEmit(s.code, { layer: s.layer, op: s.op, entityId: s.entityId }, s.msg, causeSeq);
              let pErr: string | null = null;
              let pd: Diagnostic | null = null;
              try {
                pd = col.emit(s.code, { layer: s.layer, op: s.op, entityId: s.entityId }, s.msg, cause);
              } catch (e) {
                pErr = (e as Error).message;
              }
              // 接受/拒绝的判定必须一致
              if (m.ok) {
                expect(pErr, `模型接受但产品拒绝：${s.code}`).toBeNull();
                const h = { d: pd!, seq: m.seq };
                liveHandles.push(h);
                allHandles.push(h);
                hit.emitOk++;
              } else {
                expect(pErr, `模型拒绝(${m.reason})但产品接受：${s.code}`).not.toBeNull();
                expect(pErr).toBe(m.reason);
              }
              break;
            }
            case 'emitUnregistered': {
              const m = model.tryEmit(s.code, { layer: 'kernel' }, undefined, null);
              expect(m.ok).toBe(false);
              expect(() => col.emit(s.code, { layer: 'kernel' })).toThrow(
                `E_DIAG_UNREGISTERED_CODE:${s.code}`
              );
              hit.unreg++;
              break;
            }
            case 'emitNoLayer': {
              const m = model.tryEmit(s.code, { layer: '' }, undefined, null);
              expect(m.ok).toBe(false);
              expect(() => col.emit(s.code, { layer: '' })).toThrow('E_DIAG_MISSING_ATTRIBUTION');
              hit.noLayer++;
              break;
            }
            case 'emitStaleCause': {
              // 只有存在"已不属于当前世代"的句柄时这一步才有意义
              const stale = allHandles.filter((h) => !liveHandles.includes(h));
              if (stale.length === 0) break;
              const h = stale[s.pick % stale.length]!;
              const m = model.tryEmit('E_REF_INVALID', { layer: 'kernel' }, undefined, h.seq);
              expect(m.ok, '跨世代复用因，模型应拒绝').toBe(false);
              expect(m.ok === false && m.reason).toBe('E_DIAG_FOREIGN_CAUSE');
              expect(() => col.emit('E_REF_INVALID', { layer: 'kernel' }, undefined, h.d)).toThrow(
                'E_DIAG_FOREIGN_CAUSE'
              );
              hit.stale++;
              break;
            }
            case 'clear': {
              col.clear();
              model.clear();
              liveHandles = [];
              hit.clears++;
              break;
            }
          }

          // 每步之后逐字段对照，不只在末尾比一次——
          // 末尾比一次只能说"最终状态相同"，中间怎么走的不可见。
          expect(dumpProduct(col)).toEqual(model.dump());
          // 产品自己的不变量在任何合法序列后都必须为空。
          // 这是 C01 的自动化形态：合法 API 绝不允许产出"数据损坏"结论。
          expect(col.checkInvariants(), '合法序列后不应有违规').toEqual([]);
        }
        return true;
      }),
      { numRuns: 3000 }
    );

    // 生成器覆盖自检。不打印次数就无法知道某一支是不是从没走到过——
    // "断言通过"可能只是"那一支根本没执行"。
    expect(hit.emitOk, '成功 emit').toBeGreaterThan(1000);
    expect(hit.causeUsed, '带因的 emit').toBeGreaterThan(500);
    expect(hit.unreg, '未注册码').toBeGreaterThan(100);
    expect(hit.noLayer, '归因缺失').toBeGreaterThan(100);
    expect(hit.stale, '跨世代复用因').toBeGreaterThan(50);
    expect(hit.clears, 'clear').toBeGreaterThan(100);
    expect(stepsRun).toBeGreaterThan(10000);
  });

  it('注册表与模型的字面量表逐项相等（防注册表漂移）', () => {
    // 这条断言的作用是把"模型的表要手工同步"从注释变成会红的测试。
    const modelCodes = Object.keys(EXPECTED_SEVERITY).sort();
    const productCodes = [...CODE_REGISTRY.keys()].sort();
    expect(productCodes).toEqual(modelCodes);

    for (const [code, spec] of CODE_REGISTRY) {
      expect(spec.severity, `${code} 的 severity`).toBe(EXPECTED_SEVERITY[code]);
      expect(spec.prefix, `${code} 的 prefix`).toBe(expectedPrefix(code));
      expect(spec.recoverable, `${code} 的 recoverable`).toBe(EXPECTED_SEVERITY[code] !== 'fatal');
      expect(EXPECTED_PREFIXES.has(spec.prefix), `${code} 的 prefix 在白名单`).toBe(true);
      expect(VALID_PREFIXES.has(spec.prefix)).toBe(true);
    }
  });

  it('链长：产品 chainOf 与模型独立推导一致', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), fc.array(fc.boolean(), { minLength: 40, maxLength: 40 }), (n, links) => {
        const col = new DiagnosticCollector();
        const model = new DiagnosticModel();
        const hs: Array<{ d: Diagnostic; seq: number }> = [];
        for (let i = 0; i < n; i++) {
          // links[i] 决定这一条接不接上一条，故链是分叉森林而非单链
          const prev = links[i] && hs.length > 0 ? hs[hs.length - 1] : undefined;
          const m = model.tryEmit('E_REF_INVALID', { layer: 'kernel', op: `op${i}` }, undefined, prev ? prev.seq : null);
          if (!m.ok) throw new Error(`模型意外拒绝: ${m.reason}`);
          const d = col.emit('E_REF_INVALID', { layer: 'kernel', op: `op${i}` }, undefined, prev?.d);
          hs.push({ d, seq: m.seq });
        }
        for (const h of hs) {
          const expected = model.chainLength(h.seq);
          // 只在不超过默认预算时比较；超预算是 chainOf 的展示约定，模型不模拟它
          if (expected <= 64) {
            expect(col.chainOf(h.d).length).toBe(expected);
          }
        }
        return true;
      }),
      { numRuns: 800 }
    );
  });
});

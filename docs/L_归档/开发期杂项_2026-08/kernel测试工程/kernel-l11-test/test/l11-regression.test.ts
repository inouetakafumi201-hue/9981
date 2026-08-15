/**
 * L11 回归用例：每条对应一个实测缺陷或一个刻意的设计选择。
 *
 * 编号沿用探针里的 C01~C20（见 REPORT.md 的缺陷表），
 * 保留编号是为了让"这条用例为什么存在"可以追回到当初那次运行，
 * 而不是变成一堆无出处的断言。
 *
 * 「设计选择」类的用例（C12/C14/C15）不是在测缺陷，是在**钉住**一个容易被
 * 后来的"顺手清理"改掉的行为，并在注释里写清它为什么必须是这样。
 */
import { describe, it, expect } from 'vitest';
import { DiagnosticCollector, CODE_REGISTRY } from '../src/diagnostic.js';
import type { Diagnostic } from '../src/diagnostic.js';

describe('L11 回归：产品缺陷', () => {
  it('BUG L11#1 (C01)：合法 API 建的长因果链不得被判为数据损坏', () => {
    // 原实现拿 chainOf 的 maxDepth=64 当不变量，
    // 100 次合法 emit 串成 100 长的链 → checkInvariants 报 36 条违规。
    // 合法 API 序列产出"数据损坏"结论，对不变量检查器是最坏的一种错：
    // 之后任何人看到违规都得先怀疑是不是这个假警报，检查器就废了。
    const col = new DiagnosticCollector();
    let prev: Diagnostic | undefined;
    for (let i = 0; i < 100; i++) {
      prev = col.emit('E_REF_INVALID', { layer: 'kernel', op: `op${i}` }, undefined, prev);
    }
    expect(col.checkInvariants()).toEqual([]);
    // 同时钉住 chainOf 的展示预算语义未变：它仍然按调用方给的预算截断
    expect(() => col.chainOf(prev!)).toThrow('E_DIAG_CHAIN_TOO_DEEP');
    expect(col.chainOf(prev!, 200)).toHaveLength(100);
    // 且 300 条时依然无违规——上界随成员数走，不是写死的 64
    for (let i = 0; i < 200; i++) {
      prev = col.emit('E_REF_INVALID', { layer: 'kernel' }, undefined, prev);
    }
    expect(col.checkInvariants()).toEqual([]);
    expect(col.chainOf(prev!, 1000)).toHaveLength(300);
  });

  it('BUG L11#2 (C02)：emit 必须复制 source，事后改调用方对象不得追改已发诊断', () => {
    const col = new DiagnosticCollector();
    const src = { layer: 'kernel', op: 'first', entityId: 'e1' };
    const d1 = col.emit('E_REF_INVALID', src);
    src.op = 'second';
    src.entityId = 'e2';
    const d2 = col.emit('E_OP_UNKNOWN', src);
    // 原实现里 d1.source.op 会变成 'second'——诊断是"当时发生了什么"的记录，
    // 事后可变就不再是记录。
    expect(d1.source.op).toBe('first');
    expect(d1.source.entityId).toBe('e1');
    expect(d2.source.op).toBe('second');
    expect(d1.source).not.toBe(d2.source);
    expect(d1.source).not.toBe(src);
    expect(d2.source).not.toBe(src);
    // 复制是浅的，但 DiagnosticSource 全是 string 字段，浅复制即足够。
    // 这条断言把"字段全是标量"这个前提钉住：将来若加嵌套字段，它会红。
    for (const v of Object.values(d1.source)) {
      expect(typeof v).toBe('string');
    }
  });

  it('BUG L11#3 (C04)：col.all 不得外泄内部数组', () => {
    const col = new DiagnosticCollector();
    col.emit('E_REF_INVALID', { layer: 'kernel' });
    col.emit('E_OP_UNKNOWN', { layer: 'kernel' });
    const a = col.all;
    const b = col.all;
    expect(a).not.toBe(b);
    // readonly 只在编译期成立；运行期原先一行就能清空 collector
    (a as Diagnostic[]).length = 0;
    (b as Diagnostic[]).push({} as Diagnostic);
    expect(col.all).toHaveLength(2);
    expect(col.checkInvariants()).toEqual([]);
    // 元素本身仍是同一批对象——因果链的身份依赖它，这是刻意的（见 C14）
    expect(col.all[0]).toBe(col.all[0]);
  });

  it('BUG L11#4 (C05)：sealed=true 而无 fatal 必须被检出（反向子句）', () => {
    const col = new DiagnosticCollector();
    col.emit('E_REF_INVALID', { layer: 'kernel' });
    expect(col.isSealed).toBe(false);
    (col as unknown as { sealed: boolean }).sealed = true;
    // 原实现只查"有 fatal 却没封"，这个状态 0 违规。
    // 单向检查器抓不到多余项，与 L8 双向索引是同一个道理。
    expect(col.checkInvariants()).toContain('SEALED_WITHOUT_FATAL');
  });

  it('BUG L11#5 (C06)：注册表写入面必须封死（错误码表是唯一真相源）', () => {
    expect(() => CODE_REGISTRY.set('E_ANY', {} as never)).toThrow('E_DIAG_REGISTRY_SEALED:set');
    expect(() => CODE_REGISTRY.delete('E_REF_INVALID')).toThrow('E_DIAG_REGISTRY_SEALED:delete');
    expect(() => CODE_REGISTRY.clear()).toThrow('E_DIAG_REGISTRY_SEALED:clear');
    // 读取面必须完好——其他层与既有测试都按 Map 读它
    expect(CODE_REGISTRY.size).toBe(29);
    expect(CODE_REGISTRY.get('E_REF_INVALID')!.severity).toBe('error');
    expect(CODE_REGISTRY.has('E_INV_CYCLE')).toBe(true);
    expect([...CODE_REGISTRY.keys()]).toHaveLength(29);
    expect([...CODE_REGISTRY.entries()]).toHaveLength(29);
    expect([...CODE_REGISTRY.values()].every((s) => typeof s.code === 'string')).toBe(true);
    // 迭代协议也要在
    let n = 0;
    for (const _ of CODE_REGISTRY) n++;
    expect(n).toBe(29);
  });

  it('BUG L11#6 (C07/C08)：CodeSpec 必须冻结，severity 与 recoverable 不得脱钩', () => {
    for (const [code, spec] of CODE_REGISTRY) {
      expect(Object.isFrozen(spec), `${code} 未冻结`).toBe(true);
      expect(spec.recoverable, `${code} 的 recoverable 与 severity 脱钩`).toBe(spec.severity !== 'fatal');
    }
    const spec = CODE_REGISTRY.get('E_REF_INVALID')!;
    expect(() => {
      (spec as { severity: string }).severity = 'fatal';
    }).toThrow();
    expect(() => {
      (spec as { recoverable: boolean }).recoverable = false;
    }).toThrow();
    // 冻结后取值不变
    expect(spec.severity).toBe('error');
    expect(spec.recoverable).toBe(true);
    // 注册表自洽检查器在干净状态下必须为空
    expect(DiagnosticCollector.checkRegistry()).toEqual([]);
  });

  it('BUG L11#7 (C09)：跨 collector 的因必须被拒（否则因果时间倒挂）', () => {
    const a = new DiagnosticCollector();
    const b = new DiagnosticCollector();
    for (let i = 0; i < 5; i++) b.emit('E_OP_UNKNOWN', { layer: 'play' });
    const late = b.emit('E_OP_UNKNOWN', { layer: 'play' });
    expect(late.timestamp).toBe(5);
    // 原实现接受，结果 a 里出现 timestamp=0 的果指向 timestamp=5 的因，
    // 且 checkInvariants 一条不报——单调性管的是 diags 的排列，管不到链的方向。
    expect(() => a.emit('E_REF_INVALID', { layer: 'kernel' }, undefined, late)).toThrow(
      'E_DIAG_FOREIGN_CAUSE'
    );
    // 拒绝必须是彻底的：不能留下半条记录
    expect(a.all).toHaveLength(0);
    expect(a.checkInvariants()).toEqual([]);
  });

  it('BUG L11#8 (C10)：伪造的因必须被拒（否则未注册码混进链里隐身）', () => {
    const col = new DiagnosticCollector();
    const fake = {
      code: 'E_TOTALLY_MADE_UP',
      severity: 'info',
      message: 'x',
      source: { layer: '' },
      timestamp: 999,
    } as Diagnostic;
    // 原实现接受。危害在于：fake 不在 diags 里，checkInvariants 的逐条循环
    // 永远轮不到它，它的未注册码、空归因全都不会被检查。
    expect(() => col.emit('E_REF_INVALID', { layer: 'kernel' }, undefined, fake)).toThrow(
      'E_DIAG_FOREIGN_CAUSE'
    );
    expect(col.all).toHaveLength(0);
    // 结构相似性挡不住伪造：造一个与真诊断字段完全一致的对象，也必须被拒
    const real = col.emit('E_REF_INVALID', { layer: 'kernel' });
    const lookalike = { ...real } as Diagnostic;
    expect(lookalike.code).toBe(real.code);
    expect(lookalike.timestamp).toBe(real.timestamp);
    expect(() => col.emit('E_OP_UNKNOWN', { layer: 'kernel' }, undefined, lookalike)).toThrow(
      'E_DIAG_FOREIGN_CAUSE'
    );
    // 而真句柄必须被接受——否则上面那条断言可能只是"什么因都拒"
    expect(() => col.emit('E_OP_UNKNOWN', { layer: 'kernel' }, undefined, real)).not.toThrow();
  });

  it('BUG L11#9 (C11)：clear() 之后不得复用旧世代的诊断作因', () => {
    const col = new DiagnosticCollector();
    const old = col.emit('E_REF_INVALID', { layer: 'kernel' });
    col.clear();
    expect(() => col.emit('E_OP_UNKNOWN', { layer: 'kernel' }, undefined, old)).toThrow(
      'E_DIAG_FOREIGN_CAUSE'
    );
    // clear 必须同时清 members，否则旧诊断仍算合法因
    expect((col as unknown as { members: Set<Diagnostic> }).members.size).toBe(0);
    // 新世代内部的因仍然正常
    const n1 = col.emit('E_REF_INVALID', { layer: 'kernel' });
    const n2 = col.emit('E_OP_UNKNOWN', { layer: 'kernel' }, undefined, n1);
    expect(n2.causedBy).toBe(n1);
    expect(col.checkInvariants()).toEqual([]);
  });

  it('BUG L11#10 (C13)：maxDepth 非法必须报专属码，不得报 CHAIN_TOO_DEEP', () => {
    const col = new DiagnosticCollector();
    const d = col.emit('E_REF_INVALID', { layer: 'kernel' });
    // 原实现对 maxDepth=0 抛 E_DIAG_CHAIN_TOO_DEEP：把"入参非法"报成"数据太深",
    // 排查方向会被带到数据上去。
    for (const bad of [0, -1, -64, 1.5, NaN, Infinity]) {
      expect(() => col.chainOf(d, bad), `maxDepth=${bad}`).toThrow('E_DIAG_INVALID_MAXDEPTH');
    }
    // 合法边界不受影响
    expect(col.chainOf(d, 1)).toHaveLength(1);
    expect(col.chainOf(d)).toHaveLength(1);
  });

  it('BUG L11#11 (C18)：空白 message 必须退回 code', () => {
    const col = new DiagnosticCollector();
    // `??` 只挡 null/undefined，空串会被留下——诊断的用途就是被人读，
    // 空描述等于没诊断。
    expect(col.emit('E_REF_INVALID', { layer: 'kernel' }).message).toBe('E_REF_INVALID');
    expect(col.emit('E_REF_INVALID', { layer: 'kernel' }, '').message).toBe('E_REF_INVALID');
    expect(col.emit('E_REF_INVALID', { layer: 'kernel' }, '   ').message).toBe('E_REF_INVALID');
    expect(col.emit('E_REF_INVALID', { layer: 'kernel' }, '\t\n ').message).toBe('E_REF_INVALID');
    // 非空 message 必须原样保留，包括前后空格与 '0'
    expect(col.emit('E_REF_INVALID', { layer: 'kernel' }, ' boom ').message).toBe(' boom ');
    expect(col.emit('E_REF_INVALID', { layer: 'kernel' }, '0').message).toBe('0');
    expect(col.emit('E_REF_INVALID', { layer: 'kernel' }, '多字节').message).toBe('多字节');
  });

  it('BUG L11#12 (C19)：无因时不得写入 causedBy 键', () => {
    const col = new DiagnosticCollector();
    const a = col.emit('E_REF_INVALID', { layer: 'kernel' });
    // 原实现恒写 `causedBy: undefined`，让 Object.keys / 结构比对
    // 看到一个语义上不存在的字段。
    expect('causedBy' in a).toBe(false);
    expect(Object.keys(a).sort()).toEqual(['code', 'message', 'severity', 'source', 'timestamp']);
    const b = col.emit('E_OP_UNKNOWN', { layer: 'kernel' }, undefined, a);
    expect('causedBy' in b).toBe(true);
    expect(b.causedBy).toBe(a);
    // 显式传 undefined 与不传等价
    const c = col.emit('E_OP_UNKNOWN', { layer: 'kernel' }, undefined, undefined);
    expect('causedBy' in c).toBe(false);
  });
});

describe('L11 回归：刻意的设计选择（钉住，防被顺手清理）', () => {
  it('设计 (C12)：clear() 刻意不重置 time', () => {
    const col = new DiagnosticCollector();
    col.emit('E_REF_INVALID', { layer: 'kernel' });
    col.emit('E_REF_INVALID', { layer: 'kernel' });
    col.clear();
    const d = col.emit('E_REF_INVALID', { layer: 'kernel' });
    // 理由：timestamp 在单个 collector 内保持全局唯一，跨 clear 世代也不重复。
    // 重置会让两个世代的诊断拥有相同 timestamp，而 NON_MONOTONIC_TS 与
    // 因果先后判定都依赖它的唯一性。看起来"不彻底"，但重置才是错的。
    expect(d.timestamp).toBe(2);
    expect(col.checkInvariants()).toEqual([]);
    // 连续 clear 也不回退
    col.clear();
    col.clear();
    expect(col.emit('E_REF_INVALID', { layer: 'kernel' }).timestamp).toBe(3);
  });

  it('设计 (C14)：emit 返回内部对象本体，因果链身份依赖它', () => {
    const col = new DiagnosticCollector();
    const d = col.emit('E_REF_INVALID', { layer: 'kernel' });
    // 若 emit 返回克隆，调用方拿克隆当 causedBy 就会被判为 FOREIGN_CAUSE，
    // 因果链根本没法建。所以这里刻意不克隆。
    expect(d).toBe(col.all[0]);
    expect(() => col.emit('E_OP_UNKNOWN', { layer: 'kernel' }, undefined, d)).not.toThrow();
    // 代价是调用方能篡改内部状态。这不是没管——
    // 篡改由 checkInvariants 的 SEVERITY_MISMATCH / NO_ATTRIBUTION / CHAIN 等子句兜底，
    // 兜底能力由 l11-invariant-checker.test.ts 的损坏注入逐条验证。
    (d as { severity: string }).severity = 'info';
    expect(col.checkInvariants()).toContain('SEVERITY_MISMATCH:E_REF_INVALID reg=error got=info');
  });

  it('设计 (C15)：sealed 不阻断后续 emit（Spec 缺口，行为在此钉住）', () => {
    const col = new DiagnosticCollector();
    col.emit('E_INV_CYCLE', { layer: 'kernel' });
    expect(col.isSealed).toBe(true);
    // "sealed"这个名字读起来像"封笔不再收"，实际它只是"出现过 fatal"的标记位。
    // 这里不改语义（会影响所有调用方），但把现状钉死，
    // 并在 REPORT.md 记为 Spec 缺口：sealed 之后是否应拒绝 emit 需要设计决策。
    const after = col.emit('E_REF_INVALID', { layer: 'kernel' });
    expect(after.timestamp).toBe(1);
    expect(col.all).toHaveLength(2);
    expect(col.isSealed).toBe(true);
    expect(col.checkInvariants()).toEqual([]);
    // fatal 之后再 fatal 也不出错
    col.emit('E_INV_DANGLING', { layer: 'kernel' });
    expect(col.fatals).toHaveLength(2);
    expect(col.checkInvariants()).toEqual([]);
  });

  it('设计 (C16)：前缀合法但未注册的码必须被拒（不能靠前缀放行）', () => {
    const col = new DiagnosticCollector();
    // 探针实测 fc.string() 生成的随机串里 E_ 前缀占比极低，
    // 所以既有属性 3 几乎测不到这一类。这里用固定池钉住。
    for (const bad of ['E_INV_TYPO', 'E_REF_INVALIDD', 'E_OP_', 'E_COST_MISSING', 'E_', 'e_ref_invalid']) {
      expect(() => col.emit(bad, { layer: 'kernel' }), bad).toThrow(`E_DIAG_UNREGISTERED_CODE:${bad}`);
    }
    // 大小写与首尾空格都不得被容错放行
    expect(() => col.emit('E_REF_INVALID ', { layer: 'kernel' })).toThrow('E_DIAG_UNREGISTERED_CODE');
    expect(() => col.emit(' E_REF_INVALID', { layer: 'kernel' })).toThrow('E_DIAG_UNREGISTERED_CODE');
    expect(col.all).toHaveLength(0);
  });

  it('设计：所有 E_INV_* 为 fatal，且仅 E_INV_* 为 fatal（双向）', () => {
    const fatals = [...CODE_REGISTRY.values()].filter((s) => s.severity === 'fatal').map((s) => s.code);
    // 双向断言。只查"E_INV_* 都是 fatal"查不出"某个非 E_INV_* 也是 fatal"——
    // 既有测试只有前一个方向，而原报告修的 4 个缺陷全是后一个方向的。
    expect(fatals.sort()).toEqual(
      ['E_INV_CYCLE', 'E_INV_DANGLING', 'E_INV_DUAL_LOCATION', 'E_INV_STACK_LEAK'].sort()
    );
    for (const [code, spec] of CODE_REGISTRY) {
      expect(spec.severity === 'fatal', code).toBe(code.startsWith('E_INV_'));
    }
  });
});

describe('L11 回归：变异覆盖补丁', () => {
  it('M20：emit(code, null) 必须抛 MISSING_ATTRIBUTION 而非 TypeError', () => {
    const col = new DiagnosticCollector();
    const dyn = col as unknown as { emit(c: string, s: unknown): unknown };
    // M20 变异体仅查 !source.layer，不先查 !source；
    // source=null 时 null.layer → TypeError，把"归因缺失"包装成类型错误报出。
    expect(() => dyn.emit('E_OP_UNKNOWN', null)).toThrow('E_DIAG_MISSING_ATTRIBUTION');
    expect(() => dyn.emit('E_OP_UNKNOWN', undefined)).toThrow('E_DIAG_MISSING_ATTRIBUTION');
  });

  it('M22：未注册码 + 空 layer 同时出现时，必须优先报未注册码', () => {
    const col = new DiagnosticCollector();
    const dyn = col as unknown as { emit(c: string, s: unknown): unknown };
    // M22 变异体颠倒校验顺序（先查归因再查注册）；
    // 两个缺陷共存时报 MISSING_ATTRIBUTION 而非 UNREGISTERED_CODE。
    expect(() => dyn.emit('XX_BOGUS', { layer: '' })).toThrow('E_DIAG_UNREGISTERED_CODE:XX_BOGUS');
    expect(() => dyn.emit('E_INV_NOPE', { layer: '' })).toThrow('E_DIAG_UNREGISTERED_CODE:E_INV_NOPE');
  });

  it('M60/M61：chainOf 必须检出环并以专属码 E_DIAG_CAUSAL_CYCLE 报出', () => {
    const col = new DiagnosticCollector();
    const d = col.emit('E_REF_INVALID', { layer: 'kernel' });
    // 产品 API 无法建环（causedBy 校验拦截），需注入自指针。
    (d as unknown as { causedBy: unknown }).causedBy = d;
    // M60：去掉环检测 → 无限展开至预算耗尽，报 TOO_DEEP 而非 CYCLE。
    // M61：降级为通用 Error → 错误码不含 CAUSAL_CYCLE。
    expect(() => col.chainOf(d)).toThrow('E_DIAG_CAUSAL_CYCLE');
  });

  it('M62：链长超出 maxDepth 时必须抛 CHAIN_TOO_DEEP，不得静默多返回一节', () => {
    const col = new DiagnosticCollector();
    const d1 = col.emit('E_REF_INVALID', { layer: 'kernel' });
    const d2 = col.emit('E_OP_UNKNOWN', { layer: 'kernel' }, undefined, d1);
    // 链长 2，maxDepth=1：超出预算，必须抛错。
    // M62 变异体用 <=：while 多走一步将 d1 也收入，链长 2 通过而不抛。
    expect(() => col.chainOf(d2, 1)).toThrow('E_DIAG_CHAIN_TOO_DEEP');
    // maxDepth=2 恰好够，不得抛错
    expect(col.chainOf(d2, 2)).toHaveLength(2);
  });
});

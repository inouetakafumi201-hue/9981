/**
 * L11 缺陷探针：每个候选缺陷都用一段最小复现跑出来，不靠读代码下结论。
 */
import { DiagnosticCollector, CODE_REGISTRY } from '../../src/diagnostic.ts';
import type { Diagnostic } from '../../src/diagnostic.ts';

let n = 0;
function probe(name: string, fn: () => string): void {
  n++;
  let out: string;
  try {
    out = fn();
  } catch (e) {
    out = `THREW ${(e as Error).message}`;
  }
  console.log(`C${String(n).padStart(2, '0')} ${name}\n     → ${out}`);
}

// C01：合法 API 建出 >64 的因果链，checkInvariants 会不会报违规？
probe('合法 emit 建 100 长因果链后 checkInvariants', () => {
  const col = new DiagnosticCollector();
  let prev: Diagnostic | undefined;
  for (let i = 0; i < 100; i++) {
    prev = col.emit('E_REF_INVALID', { layer: 'kernel', op: `op${i}` }, undefined, prev);
  }
  const v = col.checkInvariants();
  return `违规 ${v.length} 条；样例=${v[0] ?? '（无）'}`;
});

// C02：source 按引用存 —— emit 后改 source，已发出的诊断会不会被追改？
probe('emit 后修改传入的 source 对象', () => {
  const col = new DiagnosticCollector();
  const src = { layer: 'kernel', op: 'first' };
  const d1 = col.emit('E_REF_INVALID', src);
  src.op = 'second';
  const d2 = col.emit('E_OP_UNKNOWN', src);
  return `d1.source.op=${d1.source.op}（期望 first），d2.source.op=${d2.source.op}，同一对象=${d1.source === d2.source}`;
});

// C03：source.layer 事后清空 —— 归因能被追溯抹掉吗？
probe('emit 后把 source.layer 改空', () => {
  const col = new DiagnosticCollector();
  const src = { layer: 'kernel' };
  col.emit('E_REF_INVALID', src);
  src.layer = '';
  const v = col.checkInvariants();
  return `违规 ${v.length} 条：${v.join(' | ') || '（无）'}`;
});

// C04：col.all 返回内部数组本体吗？
probe('col.all 外泄内部数组', () => {
  const col = new DiagnosticCollector();
  col.emit('E_REF_INVALID', { layer: 'kernel' });
  const a = col.all;
  const b = col.all;
  (a as Diagnostic[]).length = 0;
  return `all===all: ${a === b}；清空后 col.all.length=${col.all.length}（期望 1）`;
});

// C05：sealed 单向检查 —— 无 fatal 却 sealed=true 能被检出吗？
probe('无 fatal 但 sealed 被置 true', () => {
  const col = new DiagnosticCollector();
  col.emit('E_REF_INVALID', { layer: 'kernel' });
  (col as unknown as { sealed: boolean }).sealed = true;
  const v = col.checkInvariants();
  return `isSealed=${col.isSealed}，fatals=${col.fatals.length}，违规 ${v.length} 条：${v.join(' | ') || '（无）'}`;
});

// C06：CODE_REGISTRY 可写 —— 外部能绕过 reg() 注册任意码吗？
probe('外部直接 CODE_REGISTRY.set 注册非法前缀码', () => {
  const before = CODE_REGISTRY.size;
  (CODE_REGISTRY as Map<string, never>).set('XX_BOGUS', {
    code: 'XX_BOGUS',
    severity: 'fatal',
    prefix: 'XX',
    recoverable: true,
  } as never);
  const col = new DiagnosticCollector();
  const d = col.emit('XX_BOGUS', { layer: 'kernel' });
  const v = col.checkInvariants();
  CODE_REGISTRY.delete('XX_BOGUS');
  return `注册成功（${before}→${before + 1}），emit 通过，severity=${d.severity}，违规=${v.join(' | ') || '（无）'}`;
});

// C07：CodeSpec 可写 —— 篡改 spec.severity 会让判据反向失真吗？
probe('篡改 spec.severity 让 SEVERITY_MISMATCH 判据失真', () => {
  const spec = CODE_REGISTRY.get('E_INV_CYCLE')!;
  const orig = spec.severity;
  const col = new DiagnosticCollector();
  const d = col.emit('E_INV_CYCLE', { layer: 'kernel' });
  (spec as { severity: string }).severity = 'info';
  const v = col.checkInvariants();
  (spec as { severity: string }).severity = orig;
  return `d.severity=${d.severity} spec 改为 info 后违规=${v.join(' | ') || '（无）'}；recoverable=${spec.recoverable} 与 severity 已脱钩`;
});

// C08：spec.recoverable 与 severity 脱钩能被 checkInvariants 检出吗？
probe('spec.recoverable 与 severity 脱钩', () => {
  const spec = CODE_REGISTRY.get('E_REF_INVALID')!;
  const orig = spec.recoverable;
  const col = new DiagnosticCollector();
  col.emit('E_REF_INVALID', { layer: 'kernel' });
  (spec as { recoverable: boolean }).recoverable = false; // error 却不可恢复
  const v = col.checkInvariants();
  (spec as { recoverable: boolean }).recoverable = orig;
  return `违规 ${v.length} 条：${v.join(' | ') || '（无）'}`;
});

// C09：跨 collector 的 causedBy —— 因在果之后，能被检出吗？
probe('跨 collector 的 causedBy（时间戳倒挂）', () => {
  const a = new DiagnosticCollector();
  const b = new DiagnosticCollector();
  for (let i = 0; i < 5; i++) b.emit('E_OP_UNKNOWN', { layer: 'play' });
  const late = b.emit('E_OP_UNKNOWN', { layer: 'play' }); // timestamp=5
  const early = a.emit('E_REF_INVALID', { layer: 'kernel' }, undefined, late); // timestamp=0
  const v = a.checkInvariants();
  return `果 ts=${early.timestamp} < 因 ts=${late.timestamp}；a 的违规=${v.join(' | ') || '（无）'}`;
});

// C10：causedBy 指向未注册码的伪造诊断
probe('causedBy 指向伪造的未注册诊断', () => {
  const col = new DiagnosticCollector();
  const fake = {
    code: 'E_TOTALLY_MADE_UP',
    severity: 'info',
    message: 'x',
    source: { layer: '' },
    timestamp: 999,
  } as Diagnostic;
  col.emit('E_REF_INVALID', { layer: 'kernel' }, undefined, fake);
  const v = col.checkInvariants();
  return `emit 接受了伪造因；违规=${v.join(' | ') || '（无）'} ← 链上节点未被校验`;
});

// C11：clear() 后复用旧诊断作因
probe('clear() 后拿 clear 前的诊断当 causedBy', () => {
  const col = new DiagnosticCollector();
  const old = col.emit('E_REF_INVALID', { layer: 'kernel' });
  col.clear();
  const fresh = col.emit('E_OP_UNKNOWN', { layer: 'kernel' }, undefined, old);
  const v = col.checkInvariants();
  return `新诊断 ts=${fresh.timestamp}，旧因 ts=${old.timestamp}，链长=${col.chainOf(fresh).length}，违规=${v.join(' | ') || '（无）'}`;
});

// C12：clear() 有没有重置 time？
probe('clear() 是否重置 time', () => {
  const col = new DiagnosticCollector();
  col.emit('E_REF_INVALID', { layer: 'kernel' });
  col.emit('E_REF_INVALID', { layer: 'kernel' });
  col.clear();
  const d = col.emit('E_REF_INVALID', { layer: 'kernel' });
  return `clear 后首个 ts=${d.timestamp}（0=已重置，2=未重置）`;
});

// C13：chainOf 的 maxDepth 边界与非法入参
probe('chainOf 的 maxDepth 边界（64/65）与 maxDepth=0', () => {
  const mk = (len: number) => {
    const col = new DiagnosticCollector();
    let prev: Diagnostic | undefined;
    for (let i = 0; i < len; i++) prev = col.emit('E_REF_INVALID', { layer: 'kernel' }, undefined, prev);
    return { col, tip: prev! };
  };
  const r: string[] = [];
  for (const len of [63, 64, 65]) {
    const { col, tip } = mk(len);
    try {
      r.push(`len=${len}→${col.chainOf(tip).length}`);
    } catch (e) {
      r.push(`len=${len}→THREW ${(e as Error).message}`);
    }
  }
  const { col, tip } = mk(1);
  try {
    r.push(`maxDepth=0→${col.chainOf(tip, 0).length}`);
  } catch (e) {
    r.push(`maxDepth=0→THREW ${(e as Error).message}`);
  }
  return r.join(', ');
});

// C14：emit 返回的对象是内部本体吗？（因果链身份依赖它，属设计选择，需钉住）
probe('emit 返回值与内部存储是否同一对象', () => {
  const col = new DiagnosticCollector();
  const d = col.emit('E_REF_INVALID', { layer: 'kernel' });
  return `d === col.all[0]: ${d === col.all[0]} ← 若为 true，链身份可用，但调用方可篡改内部状态`;
});

// C15：fatal 后 sealed，还能继续 emit 吗？sealed 的语义是什么？
probe('sealed 之后继续 emit', () => {
  const col = new DiagnosticCollector();
  col.emit('E_INV_CYCLE', { layer: 'kernel' });
  const after = col.emit('E_REF_INVALID', { layer: 'kernel' });
  return `sealed=${col.isSealed} 后仍成功 emit，ts=${after.timestamp}，总数=${col.all.length} ← sealed 不阻断写入`;
});

// C16：前缀合法但未注册（属性3 的随机串几乎撞不到这一类）
probe('前缀合法但未注册的码（E_INV_TYPO）', () => {
  const col = new DiagnosticCollector();
  try {
    col.emit('E_INV_TYPO', { layer: 'kernel' });
    return '被接受 ← 漏检';
  } catch (e) {
    return `被拒绝：${(e as Error).message}`;
  }
});

// C17：BAD_PREFIX 子句是否可达 —— reg() 派生的 prefix 永远合法吗？
probe('reg() 派生 prefix 是否可能落在白名单外', () => {
  const bad = [...CODE_REGISTRY.values()].filter((s) => {
    const vp = new Set(['E_INV', 'E_COST', 'E_OP', 'E_HOOK', 'E_EXPR', 'E_DEC', 'E_FLOW', 'E_PHASE', 'E_INTENT', 'E_REF', 'E_LINK']);
    return !vp.has(s.prefix);
  });
  return `29 个注册码中 prefix 非法的 = ${bad.length} ← 为 0 则 BAD_PREFIX 子句在合法状态下永不可达`;
});

// C18：message 缺省与空串
probe('message 传空串时的缺省行为', () => {
  const col = new DiagnosticCollector();
  const a = col.emit('E_REF_INVALID', { layer: 'kernel' });
  const b = col.emit('E_REF_INVALID', { layer: 'kernel' }, '');
  return `未传→"${a.message}"，传空串→"${b.message}"（?? 只挡 null/undefined，空串会保留）`;
});

// C19：causedBy 显式传 undefined 时属性是否存在
probe('causedBy 未传时属性是否存在于对象上', () => {
  const col = new DiagnosticCollector();
  const d = col.emit('E_REF_INVALID', { layer: 'kernel' });
  return `'causedBy' in d = ${'causedBy' in d}，值=${d.causedBy} ← 恒写入 undefined 键`;
});

// C20：自环（d.causedBy = d）
probe('自环 d.causedBy = d', () => {
  const col = new DiagnosticCollector();
  const d = col.emit('E_REF_INVALID', { layer: 'kernel' });
  (d as { causedBy?: Diagnostic }).causedBy = d;
  try {
    col.chainOf(d);
    return '未检出自环 ← 漏检';
  } catch (e) {
    const v = col.checkInvariants();
    return `chainOf 抛 ${(e as Error).message}；checkInvariants=${v.join(' | ')}`;
  }
});

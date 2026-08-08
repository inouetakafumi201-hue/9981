/**
 * L11 检查器自身的测试：损坏注入。
 *
 * 为什么必须有这个文件——探针实测（见 REPORT.md 一节）：
 * 3000 条**合法** API 序列跑下来，checkInvariants 的 8 条子句**一条都没命中**。
 * 合法状态下每条子句都返回空，于是"删掉任一条子句"完全不可观测。
 * 这不是断言不够细，是那个观测面里根本不存在能触发子句的状态。
 *
 * 检查器是被测对象的一部分。要让它每条子句可观测，就必须造出违规状态；
 * 而产品是对的，合法 API 造不出来——只能绕过 Op 边界直接改内部表。
 * 对检查器而言，损坏注入不是"额外的测试"，是**让它可观测的前提条件**。
 *
 * 每条用例的形状固定为三段：
 *   1. 用合法 API 建一个干净状态，先断言 checkInvariants() 为空（否则测的不是这个损坏）；
 *   2. 注入**单一**损坏；
 *   3. 断言恰好报出预期子句，且报出的子句集合与其他用例**互不相同**（区分性）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { DiagnosticCollector, CODE_REGISTRY, VALID_PREFIXES } from '../src/diagnostic.js';
import type { Diagnostic, CodeSpec } from '../src/diagnostic.js';

/** 内部字段的访问面。刻意集中在一处，让"哪些私有状态被测试碰过"一目了然。 */
interface Guts {
  diags: Diagnostic[];
  time: number;
  sealed: boolean;
  members: Set<Diagnostic>;
}
const guts = (c: DiagnosticCollector): Guts => c as unknown as Guts;

/**
 * 注册表已被 sealRegistry() 封住写入面，且每个 CodeSpec 被 Object.freeze。
 * 损坏注入必须绕过原型才能写——这一点本身就是封印生效的证据，
 * 所以下面先断言"正常路径确实写不进去"，再用原型方法注入。
 */
const rawSet = Map.prototype.set.bind(CODE_REGISTRY) as (k: string, v: CodeSpec) => Map<string, CodeSpec>;
const rawDelete = Map.prototype.delete.bind(CODE_REGISTRY) as (k: string) => boolean;

const registryBackup = new Map<string, CodeSpec>();
function corruptRegistry(key: string, spec: CodeSpec): void {
  if (!registryBackup.has(key) && CODE_REGISTRY.has(key)) {
    registryBackup.set(key, CODE_REGISTRY.get(key)!);
  }
  rawSet(key, spec);
}
function addBogusCode(key: string, spec: CodeSpec): void {
  registryBackup.set(key, undefined as unknown as CodeSpec); // 标记"原本不存在"
  rawSet(key, spec);
}

afterEach(() => {
  // 注册表是全局的。不还原会让损坏泄漏到别的用例，
  // 造成"某个用例失败取决于它跑在第几位"这类顺序依赖的假结论。
  for (const [k, v] of registryBackup) {
    if (v === undefined) rawDelete(k);
    else rawSet(k, v);
  }
  registryBackup.clear();
});

/** 建一个干净的多条诊断状态，并自检它确实干净。 */
function cleanCollector(): { col: DiagnosticCollector; ds: Diagnostic[] } {
  const col = new DiagnosticCollector();
  const ds = [
    col.emit('E_REF_INVALID', { layer: 'kernel', op: 'a' }),
    col.emit('E_OP_UNKNOWN', { layer: 'class', op: 'b' }),
    col.emit('E_DEC_TIMEOUT', { layer: 'play', op: 'c' }),
  ];
  ds.push(col.emit('E_EXPR_TYPE', { layer: 'kernel', op: 'd' }, undefined, ds[0]));
  expect(col.checkInvariants(), '前提：注入前状态必须干净').toEqual([]);
  return { col, ds };
}

/** 记录每条用例报出的子句集合，末尾统一验证两两互不相同。 */
const observed = new Map<string, string>();
function record(name: string, violations: string[]): void {
  // 只取子句名（冒号前），忽略具体数值，避免"同一子句因数值不同被当成不同"
  const key = violations.map((v) => v.split(':')[0]!.split(' ')[0]!).sort().join('+');
  observed.set(name, key);
}

describe('L11 检查器：损坏注入（每条子句都必须可观测）', () => {
  it('前提自检：封印与冻结确实生效（否则下面的注入路径是多余的）', () => {
    expect(() => CODE_REGISTRY.set('E_FAKE', {} as CodeSpec)).toThrow('E_DIAG_REGISTRY_SEALED:set');
    expect(() => CODE_REGISTRY.delete('E_REF_INVALID')).toThrow('E_DIAG_REGISTRY_SEALED:delete');
    expect(() => CODE_REGISTRY.clear()).toThrow('E_DIAG_REGISTRY_SEALED:clear');
    const spec = CODE_REGISTRY.get('E_REF_INVALID')!;
    expect(Object.isFrozen(spec)).toBe(true);
    expect(() => {
      (spec as { severity: string }).severity = 'info';
    }).toThrow();
    // 封印生效，所以注册表内容未变
    expect(CODE_REGISTRY.has('E_FAKE')).toBe(false);
    expect(CODE_REGISTRY.has('E_REF_INVALID')).toBe(true);
  });

  it('UNREGISTERED：诊断的 code 已不在注册表', () => {
    const { col, ds } = cleanCollector();
    // 直接改诊断的 code，让它指向一个未注册的字符串
    (ds[1] as { code: string }).code = 'E_GONE_MISSING';
    const v = col.checkInvariants();
    expect(v).toContain('UNREGISTERED:E_GONE_MISSING');
    // 只报这一条：continue 之后不再对该条做别的检查
    expect(v.filter((x) => x.includes('E_GONE_MISSING'))).toHaveLength(1);
    record('UNREGISTERED', v);
  });

  it('SEVERITY_MISMATCH：诊断的 severity 与注册表不符', () => {
    const { col, ds } = cleanCollector();
    (ds[0] as { severity: string }).severity = 'info';
    const v = col.checkInvariants();
    expect(v.some((x) => x.startsWith('SEVERITY_MISMATCH:E_REF_INVALID'))).toBe(true);
    // 断言取值本身，而不只是"报了"——reg=error got=info 的方向不能反
    expect(v).toContain('SEVERITY_MISMATCH:E_REF_INVALID reg=error got=info');
    record('SEVERITY_MISMATCH', v);
  });

  it('BAD_PREFIX：注册表里塞进白名单外的前缀', () => {
    // 实测（C17）：29 个注册码派生出的 prefix 全部合法，
    // 所以这条子句在任何合法状态下不可达，只能靠注入。
    const { col } = cleanCollector();
    addBogusCode('XX_BOGUS', Object.freeze({ code: 'XX_BOGUS', severity: 'error', prefix: 'XX', recoverable: true }));
    const d = col.emit('XX_BOGUS', { layer: 'kernel' });
    expect(d.severity).toBe('error');
    expect(VALID_PREFIXES.has('XX')).toBe(false);
    const v = col.checkInvariants();
    expect(v).toContain('BAD_PREFIX:XX_BOGUS prefix=XX');
    record('BAD_PREFIX', v);
  });

  it('NO_ATTRIBUTION：诊断的 source.layer 被抹掉', () => {
    const { col, ds } = cleanCollector();
    // 注意：emit 现在复制 source，所以改调用方的原始对象**不再**能造成这个状态
    // （C02/C03 修复的正是这一点）。要触发这条子句必须直接改诊断自己的 source。
    (ds[2]!.source as { layer: string }).layer = '';
    const v = col.checkInvariants();
    expect(v).toContain('NO_ATTRIBUTION:E_DEC_TIMEOUT');
    record('NO_ATTRIBUTION', v);
  });

  it('FATAL_RECOVERABLE：注册表里的 fatal 码被标成可恢复', () => {
    const { col } = cleanCollector();
    addBogusCode('E_INV_FAKE', Object.freeze({ code: 'E_INV_FAKE', severity: 'fatal', prefix: 'E_INV', recoverable: true }));
    col.emit('E_INV_FAKE', { layer: 'kernel' });
    const v = col.checkInvariants();
    expect(v).toContain('FATAL_RECOVERABLE:E_INV_FAKE');
    // 这条码是 fatal，所以 sealed 应已置位，不应同时报 FATAL_NOT_SEALED
    expect(v).not.toContain('FATAL_NOT_SEALED');
    record('FATAL_RECOVERABLE', v);
  });

  it('CHAIN/CAUSAL_CYCLE：因果成环', () => {
    const { col, ds } = cleanCollector();
    (ds[0] as { causedBy?: Diagnostic }).causedBy = ds[3];
    const v = col.checkInvariants();
    expect(v.some((x) => x === 'CHAIN:E_REF_INVALID:E_DIAG_CAUSAL_CYCLE')).toBe(true);
    // 环上两个节点都会各自报一次——断言两条都在，否则只遍历部分节点也能过
    expect(v.some((x) => x === 'CHAIN:E_EXPR_TYPE:E_DIAG_CAUSAL_CYCLE')).toBe(true);
    record('CHAIN_CYCLE', v);
  });

  it('CHAIN/EXCEEDS_MEMBERSHIP：链长超过成员数（非环）', () => {
    // 造一条不成环、但长度超过 diags.length 的链：
    // 让链尾指向一串**未登记在 diags 里**的节点。
    const col = new DiagnosticCollector();
    const head = col.emit('E_REF_INVALID', { layer: 'kernel' });
    let tail: Diagnostic = head;
    for (let i = 0; i < 5; i++) {
      const ghost: Diagnostic = {
        code: 'E_REF_INVALID',
        severity: 'error',
        message: 'ghost',
        source: { layer: 'kernel' },
        timestamp: -1 - i,
      };
      (tail as { causedBy?: Diagnostic }).causedBy = ghost;
      tail = ghost;
    }
    const v = col.checkInvariants();
    expect(v.some((x) => x === 'CHAIN:E_REF_INVALID:E_DIAG_CHAIN_EXCEEDS_MEMBERSHIP')).toBe(true);
    // 同时必然报 FOREIGN_CAUSE：链上第一跳就已不是成员
    expect(v.some((x) => x.startsWith('FOREIGN_CAUSE'))).toBe(true);
    record('CHAIN_EXCEEDS', v);
  });

  it('CAUSE_NOT_EARLIER：因的 timestamp 不早于果', () => {
    const { col, ds } = cleanCollector();
    // ds[3].causedBy === ds[0]，把 ds[0] 的 timestamp 推到 ds[3] 之后
    (ds[0] as { timestamp: number }).timestamp = 999;
    const v = col.checkInvariants();
    expect(v).toContain('CAUSE_NOT_EARLIER:E_EXPR_TYPE cause=999 effect=3');
    // 改 timestamp 也会破坏单调性，两条子句都应报——它们查的是不同的事
    expect(v.some((x) => x.startsWith('NON_MONOTONIC_TS'))).toBe(true);
    record('CAUSE_NOT_EARLIER', v);
  });

  it('FOREIGN_CAUSE：因不是本 collector 的成员', () => {
    const { col, ds } = cleanCollector();
    // 从 members 里悄悄摘掉 ds[0]，模拟 members 与 diags 失同步
    guts(col).members.delete(ds[0]!);
    const v = col.checkInvariants();
    expect(v).toContain('FOREIGN_CAUSE:E_EXPR_TYPE cause=E_REF_INVALID');
    expect(v).toContain('MEMBERS_SIZE_MISMATCH members=3 diags=4');
    expect(v).toContain('MEMBERS_MISSING:E_REF_INVALID@0');
    record('FOREIGN_CAUSE', v);
  });

  it('NON_MONOTONIC_TS：相邻两条时间戳倒挂', () => {
    const { col, ds } = cleanCollector();
    // 交换第 2、3 条在数组中的位置（timestamp 不变），造成排列与时间不符
    const arr = guts(col).diags;
    [arr[1], arr[2]] = [arr[2]!, arr[1]!];
    const v = col.checkInvariants();
    expect(v).toContain('NON_MONOTONIC_TS at 2');
    expect(ds.length).toBe(4);
    record('NON_MONOTONIC_TS', v);
  });

  it('FATAL_NOT_SEALED：有 fatal 却未封', () => {
    const col = new DiagnosticCollector();
    col.emit('E_REF_INVALID', { layer: 'kernel' });
    col.emit('E_INV_CYCLE', { layer: 'kernel' });
    expect(col.isSealed).toBe(true);
    guts(col).sealed = false;
    const v = col.checkInvariants();
    expect(v).toContain('FATAL_NOT_SEALED');
    expect(v).not.toContain('SEALED_WITHOUT_FATAL');
    record('FATAL_NOT_SEALED', v);
  });

  it('SEALED_WITHOUT_FATAL：无 fatal 却已封（反向子句）', () => {
    // 这条是 C05：原实现只查一个方向，此状态 0 违规。
    const { col } = cleanCollector();
    expect(col.fatals).toHaveLength(0);
    guts(col).sealed = true;
    const v = col.checkInvariants();
    expect(v).toContain('SEALED_WITHOUT_FATAL');
    expect(v).not.toContain('FATAL_NOT_SEALED');
    record('SEALED_WITHOUT_FATAL', v);
  });

  it('MEMBERS_SIZE_MISMATCH：members 多出一个不在 diags 的对象', () => {
    const { col } = cleanCollector();
    const ghost: Diagnostic = {
      code: 'E_REF_INVALID', severity: 'error', message: 'g',
      source: { layer: 'kernel' }, timestamp: 100,
    };
    guts(col).members.add(ghost);
    const v = col.checkInvariants();
    expect(v).toContain('MEMBERS_SIZE_MISMATCH members=5 diags=4');
    // 多出项不在 diags 里，所以 MEMBERS_MISSING 不该报——
    // 断言"不报"是为了区分"多一个"和"少一个"这两种不同的损坏
    expect(v.some((x) => x.startsWith('MEMBERS_MISSING'))).toBe(false);
    record('MEMBERS_SIZE_MISMATCH', v);
  });

  it('DUPLICATE_TS：非相邻的两条时间戳相同', () => {
    const { col, ds } = cleanCollector();
    // 第 1 条与第 4 条同 ts。相邻比较看不见（1<2<3 仍单调），
    // 只有全局唯一性检查能发现——这正是加这条子句的理由。
    (ds[3] as { timestamp: number }).timestamp = 0;
    const v = col.checkInvariants();
    expect(v).toContain('DUPLICATE_TS:0');
    // 因果也随之倒挂（ds[3] 的因是 ds[0]，两者 ts 都是 0）
    expect(v).toContain('CAUSE_NOT_EARLIER:E_EXPR_TYPE cause=0 effect=0');
    record('DUPLICATE_TS', v);
  });

  it('M25：members 里有的合法因即使不在 diags 也必须被接受', () => {
    // M25 变异体用 diags.includes 代替 members.has——
    // members 与 diags 失同步时，合法因被误判为 FOREIGN_CAUSE。
    const col = new DiagnosticCollector();
    col.emit('E_REF_INVALID', { layer: 'kernel' });
    // 注入：直接向 members 添加一个不在 diags 里的对象
    const adopted: Diagnostic = {
      code: 'E_OP_UNKNOWN', severity: 'error', message: 'adopted',
      source: { layer: 'class' }, timestamp: -1,
    };
    guts(col).members.add(adopted);
    // 原始：members.has(adopted) = true → 接受
    // M25：diags.includes(adopted) = false → 抛 FOREIGN_CAUSE
    expect(() =>
      col.emit('E_DEC_TIMEOUT', { layer: 'kernel' }, 'f', adopted),
    ).not.toThrow();
  });

  it('M52：fatals 必须查 d.severity，不得替换为注册表里的 severity', () => {
    // M52 变异体：filter 改查 CODE_REGISTRY.get(d.code)?.severity === 'fatal'。
    // 当注册表 spec 被后改、而 d.severity 已落地，两者分叉。
    const col = new DiagnosticCollector();
    col.emit('E_INV_CYCLE', { layer: 'kernel' }); // d.severity='fatal'
    expect(col.fatals).toHaveLength(1); // 基线
    // 把注册表里 E_INV_CYCLE 的 severity 改成 error
    corruptRegistry('E_INV_CYCLE', Object.freeze({
      code: 'E_INV_CYCLE', severity: 'error', prefix: 'E_INV', recoverable: true,
    }) as CodeSpec);
    // 原始：d.severity === 'fatal' → fatals 仍有 1 条
    // M52：spec.severity === 'error' ≠ 'fatal' → fatals 变 0 条
    expect(col.fatals).toHaveLength(1);
  });

  it('M54：isSealed 必须查 sealed 位，而非"有没有 fatal"', () => {
    // M54 变异体：isSealed 返回 this.fatals.length > 0。
    // sealed 位与 fatals 可失同步：sealed=true 但 fatals=[]。
    const col = new DiagnosticCollector();
    expect(col.isSealed).toBe(false);
    // 注入：直接翻 sealed 位，不产生任何 fatal
    guts(col).sealed = true;
    expect(col.fatals).toHaveLength(0); // 确认 fatals 为空（确保状态为目标状态）
    // 原始：this.sealed = true → isSealed = true
    // M54：fatals.length > 0 = false → isSealed = false
    expect(col.isSealed).toBe(true);
  });

  it('M68：链长恰为 diags.length+1 的链不得报 CHAIN_EXCEEDS_MEMBERSHIP', () => {
    // walkChainForCheck 的上界是 diags.length+1（原始）或 diags.length（M68）。
    // 构造链长 = N+1（N=diags.length）——原始 cap=N+1 不超；M68 cap=N 超出一步。
    const col = new DiagnosticCollector();
    col.emit('E_REF_INVALID', { layer: 'kernel' });
    const d2 = col.emit('E_OP_UNKNOWN', { layer: 'kernel' });
    // N=2，cap_original=3。构造链 d2→ext1→ext2（长度 3）。
    const ext1: Diagnostic = {
      code: 'E_REF_INVALID', severity: 'error', message: 'x',
      source: { layer: 'kernel' }, timestamp: -1,
    };
    const ext2: Diagnostic = {
      code: 'E_OP_UNKNOWN', severity: 'error', message: 'y',
      source: { layer: 'kernel' }, timestamp: -2,
    };
    (ext1 as { causedBy?: Diagnostic }).causedBy = ext2;
    (d2 as { causedBy?: Diagnostic }).causedBy = ext1;
    const v = col.checkInvariants();
    // FOREIGN_CAUSE 会报（ext1 不在 members），但 CHAIN: 不得报——
    // 链长 3 = cap_original，不超上界。
    // M68 cap=2：len=3 > 2 → 报 CHAIN_EXCEEDS_MEMBERSHIP，断言失败。
    expect(v.every((x) => !x.startsWith('CHAIN:'))).toBe(true);
  });

  it('M86：FATAL_RECOVERABLE 必须查 d.severity 而非 spec.severity', () => {
    // M86 变异体：if (spec.severity === 'fatal' && spec.recoverable)
    // 当 d.severity !== spec.severity 时两者分叉。
    const { col, ds } = cleanCollector(); // 4 条 error 诊断
    // 注入：把 ds[0] 的 severity 改成 fatal（spec.severity 仍是 error）
    (ds[0] as { severity: string }).severity = 'fatal';
    const v = col.checkInvariants();
    // 原始：d.severity === 'fatal' && spec.recoverable(error→true) → 报 FATAL_RECOVERABLE
    // M86：spec.severity === 'error' ≠ 'fatal' → 不报
    expect(v.some((x) => x.startsWith('FATAL_RECOVERABLE'))).toBe(true);
  });

  it('M95：相邻同 timestamp 必须报 NON_MONOTONIC_TS', () => {
    // M95 变异体：`curr.timestamp < prev.timestamp`——严格递减才报，同值放行。
    // 原始：`<= prev.timestamp`，相等即违规。
    const { col, ds } = cleanCollector();
    // 让 ds[1] 与 ds[0] 拥有相同 timestamp
    (ds[1] as { timestamp: number }).timestamp = ds[0]!.timestamp;
    const v = col.checkInvariants();
    // 原始：0 <= 0 → true → 报 NON_MONOTONIC_TS at 1
    // M95：0 < 0 → false → 不报，断言失败
    expect(v).toContain('NON_MONOTONIC_TS at 1');
  });

  it('每条注入报出的子句集合两两互不相同（区分性）', () => {
    // 若两种不同损坏报出完全相同的子句集合，
    // 检查器就只能说"坏了"，说不出"哪儿坏了"——删掉其中一条子句也未必被发现。
    expect(observed.size).toBeGreaterThanOrEqual(14);
    const seen = new Map<string, string>();
    for (const [name, key] of observed) {
      const prior = seen.get(key);
      expect(prior, `${name} 与 ${prior} 报出的子句集合完全相同：${key}`).toBeUndefined();
      seen.set(key, name);
    }
  });
});

describe('L11 注册表检查器：损坏注入', () => {
  it('干净注册表 checkRegistry 为空', () => {
    expect(DiagnosticCollector.checkRegistry()).toEqual([]);
  });

  it('REG_KEY_MISMATCH：键与 spec.code 不一致', () => {
    corruptRegistry('E_REF_INVALID', Object.freeze({ code: 'E_OP_UNKNOWN', severity: 'error', prefix: 'E_REF', recoverable: true }));
    expect(DiagnosticCollector.checkRegistry()).toContain('REG_KEY_MISMATCH:E_REF_INVALID vs E_OP_UNKNOWN');
  });

  it('REG_BAD_PREFIX + REG_PREFIX_NOT_DERIVED：前缀非法且非派生', () => {
    addBogusCode('ZZ_WEIRD', Object.freeze({ code: 'ZZ_WEIRD', severity: 'error', prefix: 'QQ', recoverable: true }));
    const v = DiagnosticCollector.checkRegistry();
    expect(v).toContain('REG_BAD_PREFIX:ZZ_WEIRD prefix=QQ');
    expect(v).toContain('REG_PREFIX_NOT_DERIVED:ZZ_WEIRD prefix=QQ');
  });

  it('REG_FATAL_RECOVERABLE：fatal 却可恢复', () => {
    corruptRegistry('E_INV_CYCLE', Object.freeze({ code: 'E_INV_CYCLE', severity: 'fatal', prefix: 'E_INV', recoverable: true }));
    expect(DiagnosticCollector.checkRegistry()).toContain('REG_FATAL_RECOVERABLE:E_INV_CYCLE');
  });

  it('REG_NONFATAL_UNRECOVERABLE：非 fatal 却不可恢复（反向子句）', () => {
    // C08 实测：原实现完全查不出这个方向。
    corruptRegistry('E_REF_INVALID', Object.freeze({ code: 'E_REF_INVALID', severity: 'error', prefix: 'E_REF', recoverable: false }));
    const v = DiagnosticCollector.checkRegistry();
    expect(v).toContain('REG_NONFATAL_UNRECOVERABLE:E_REF_INVALID');
    expect(v).not.toContain('REG_FATAL_RECOVERABLE:E_REF_INVALID');
  });

  it('REG_SPEC_MUTABLE：spec 未冻结', () => {
    // 不冻结时 severity 与 recoverable 可被单独改到脱钩，
    // 而 checkInvariants 拿 spec 当判据，判据坏了就查不出任何东西。
    corruptRegistry('E_OP_UNKNOWN', { code: 'E_OP_UNKNOWN', severity: 'error', prefix: 'E_OP', recoverable: true });
    expect(DiagnosticCollector.checkRegistry()).toContain('REG_SPEC_MUTABLE:E_OP_UNKNOWN');
  });
});

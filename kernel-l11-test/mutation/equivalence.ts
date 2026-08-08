/**
 * L11 等价性差分模糊器。
 *
 * 目的：对标注 expectEquivalent 的变异体，证明它在**全部可观测面**上与原实现无差别，
 * 而不是"我们的测试没测到它"。两者在得分表上长得一样，但一个是结论，一个是盲区。
 *
 * 关键设计：**先自检，再判定**。
 * "跑了 N 步没有反例"有两种成因：真等价，或模糊器根本没走到变异点。
 * 故第一阶段先跑一批**已知不等价**的哨兵，全部被抓到才说明这个模糊器有分辨力。
 * 哨兵必须取自与目标同一段代码——抓到了别处不能证明"这里看得见"。
 *
 * L11 的特殊之处：`CODE_REGISTRY` 是**模块级单例**，且在 import 时就被 sealRegistry
 * 封死写入面。所以：
 *   - 两侧必须各自 import 一份新模块，注册表才互不干扰（靠不同文件名拿到不同模块 id）；
 *   - 注入注册表损坏只能用 `Map.prototype.set.bind(REG)` 绕过封印，
 *     并在每例之后恢复原状，否则后续字段的分歧来自残留而非变异体。
 *
 * 观测面见 observe() 与 corruptionProbe() 的说明。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MUTANTS } from './mutants.ts';
import type { Mutant } from './mutants.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'src');

const SEQS = Number(process.env.EQUIV_SEQS ?? 2_000);
const OPS = Number(process.env.EQUIV_OPS ?? 16);
const SENTINEL_SEQS = Number(process.env.EQUIV_SENTINEL_SEQS ?? 300);

/**
 * 码池刻意极小，且**跨 severity 取齐**：fatal / error / warn 各有代表，
 * 再加"合法前缀但未注册"与"前缀非法"两个负例。
 *
 * 原套件在这里空转过：属性 3 用随机串撞注册码，5000 次 0 命中，
 * 且只有约 12% 的样本带 `E_` 前缀——"前缀合法、码未注册"这一类实际未被测到。
 * 池子做小之后，重复码、重复实体、跨 severity 混排才都成为高频事件。
 */
const CODES = [
  'E_INV_DANGLING', // fatal
  'E_INV_CYCLE', // fatal
  'E_COST_INSUFFICIENT', // error
  'E_DEC_TIMEOUT', // warn
  'E_OP_UNKNOWN', // error
  'E_INV_NOPE', // 合法前缀、未注册
  'XX_BOGUS', // 前缀非法、未注册
  '', // 空码
];
/** 空 layer 必须在池里：归因校验分支只有靠它才可达。 */
const LAYERS = ['kernel', 'class', ''];
/** 实体 id 池做小，让"同一实体连发多条"进入样本空间（uuid 做不到）。 */
const ENTS = ['e0', 'e1'];
/** 空串与纯空白必须在池里：`??` 与 `trim()!==''` 的差别只在这两个值上可见。 */
const MSGS: Array<string | undefined> = [undefined, '', '   ', '0', 'msg', ' pad '];
/** maxDepth 池含 0 / 负数 / 非整数 / NaN：入参校验的每个分支各一个代表。 */
const DEPTHS = [0, 1, -1, 1.5, 2, 64, 200, Number.NaN];

/** mulberry32：确定性 PRNG，保证两侧喂完全相同的输入。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * causedBy 的取法。每一种都对应 emit 里成员校验的一条实测坏链：
 *   0 无因　1 上一条　2 第一条　3 跨 collector（C09）
 *   4 伪造对象（C10）　5 clear 前的旧世代（C11）
 */
type CauseMode = 0 | 1 | 2 | 3 | 4 | 5;

type OpSpec =
  | { k: 'em'; code: string; layer: string; ent: string; op: string; msg: string | undefined; cause: CauseMode }
  | { k: 'clr' }
  | { k: 'ch'; idx: number; depth: number }
  | { k: 'chDefault'; idx: number };

interface Plan {
  ops: OpSpec[];
}

function pick<T>(rnd: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rnd() * xs.length)]!;
}

/**
 * 生成一条操作序列。
 *
 * 权重刻意偏向 emit：链要长到有意义，才可能撞上 C01 那类"合法长链被判损坏"。
 * clear 保持低频但非零——跨世代的 timestamp 与 members 语义只在它之后可观测。
 */
function makePlan(rnd: () => number): Plan {
  const ops: OpSpec[] = [];
  const n = 1 + Math.floor(rnd() * OPS);
  for (let i = 0; i < n; i++) {
    const roll = rnd();
    if (roll < 0.66) {
      ops.push({
        k: 'em',
        code: pick(rnd, CODES),
        layer: pick(rnd, LAYERS),
        ent: pick(rnd, ENTS),
        op: rnd() < 0.5 ? 'opA' : 'opB',
        msg: pick(rnd, MSGS),
        // 有因的比例压到六成左右：无因的诊断也要有，否则 `if (causedBy !== undefined)`
        // 的假分支（M40 的观测点）永远走不到。
        cause: Math.floor(rnd() * 6) as CauseMode,
      });
    } else if (roll < 0.74) {
      ops.push({ k: 'clr' });
    } else if (roll < 0.88) {
      ops.push({ k: 'ch', idx: Math.floor(rnd() * 6), depth: pick(rnd, DEPTHS) });
    } else {
      ops.push({ k: 'chDefault', idx: Math.floor(rnd() * 6) });
    }
  }
  return { ops };
}

/** 被测模块的最小接口。用结构类型，避免把 src 的具体类型绑进来。 */
interface Diag {
  code: string;
  severity: string;
  message: string;
  source: Record<string, unknown>;
  timestamp: number;
  causedBy?: Diag;
}

interface Collector {
  emit(code: string, source: Record<string, unknown>, message?: string, causedBy?: Diag): Diag;
  readonly all: readonly Diag[];
  readonly fatals: Diag[];
  readonly errors: Diag[];
  readonly isSealed: boolean;
  chainOf(d: Diag, maxDepth?: number): Diag[];
  clear(): void;
  checkInvariants(): string[];
}

interface Mod {
  DiagnosticCollector: (new () => Collector) & { checkRegistry(): string[] };
  CODE_REGISTRY: Map<string, unknown>;
  VALID_PREFIXES: ReadonlySet<string>;
}

/** 稳定序列化：对象键排序，但**数组顺序原样保留**（顺序本身是可观测事实）。 */
function canon(v: unknown, depth = 0): unknown {
  if (depth > 12) return '<深>';
  if (Array.isArray(v)) return v.map((x) => canon(x, depth + 1));
  if (v instanceof Set) return [...v].map((x) => canon(x, depth + 1));
  if (v instanceof Map) {
    return Object.fromEntries(
      [...v.entries()]
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        .map(([k, val]) => [k, canon(val, depth + 1)]),
    );
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    // Object.keys 而非展开：**缺键与键值为 undefined 是两回事**，
    // 这正是 M40（恒写 causedBy 键）唯一的观测点。
    for (const k of Object.keys(o).sort()) out[k] = canon(o[k], depth + 1);
    return out;
  }
  if (typeof v === 'number' && Number.isNaN(v)) return 'NaN';
  return v;
}

const show = (v: unknown): string => JSON.stringify(canon(v));

/**
 * 单条诊断的浅观测：只到因的身份，不递归展开（链另有专门字段）。
 *
 * **必须对任意输入全能（total）**，且 null / undefined / 非对象要各印各的。
 * 两条理由，都不是洁癖：
 *   - M28 改的正是 `!== undefined` 与 `!= null` 的差别。把两者印成同一个 `null`，
 *     等于把这条变异体唯一的观测点抹平——那时"等价"是被我们自己弄出来的。
 *   - 变异体会让本该被拦的 null 存进 causedBy。此处一崩，比对拿不到串，
 *     一处真分歧就被读成基础设施故障。
 */
function shallow(d: Diag | undefined | null): unknown {
  if (d === undefined) return '<undefined>';
  if (d === null) return '<null>';
  if (typeof d !== 'object') return `<非对象:${typeof d}:${String(d)}>`;
  const o = d as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) {
    if (k === 'causedBy') {
      const c = d.causedBy as Diag | undefined | null;
      // 因只记 code@ts：递归会在环上炸栈，而环本身由 chain 字段观测。
      // 键存在但值为 undefined 与键不存在是两回事，故此处不能简写成 `!c`。
      out['causedBy'] =
        c === undefined ? '<undefined键存在>'
        : c === null ? '<null键存在>'
        : typeof c !== 'object' ? `<非对象因:${typeof c}>`
        : `${String((c as Diag).code)}@${String((c as Diag).timestamp)}`;
    } else {
      out[k] = canon(o[k]);
    }
  }
  return out;
}

function tryRun(f: () => void): string {
  try {
    f();
    return 'ok';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function tryVal(f: () => unknown): string {
  try {
    return `=${show(f())}`;
  } catch (e) {
    return `!${e instanceof Error ? e.message : String(e)}`;
  }
}

/** collector 的全量状态串。链、成员判据、封印位、三个 getter 各自独立成项。 */
function dumpCol(col: Collector): string {
  const list = col.all;
  const parts: string[] = [
    `n=${list.length}`,
    `sealed=${col.isSealed}`,
    `fatals=${col.fatals.map((d) => `${d.code}@${d.timestamp}`).join(',')}`,
    `errors=${col.errors.map((d) => `${d.code}@${d.timestamp}`).join(',')}`,
    `items=${show(list.map(shallow))}`,
    // 每条都用**默认预算**展开一次：chainOf 的行为是公开契约的一部分，
    // 只比状态不比链，chainOf 的改动就不可观测。
    `chains=${list.map((d) => tryVal(() => col.chainOf(d).map((x) => `${x.code}@${x.timestamp}`))).join('/')}`,
    `inv=${col.checkInvariants().join(';') || 'ok'}`,
  ];
  return parts.join(' ');
}

/**
 * 把一条 plan 跑完，返回**单行观测串**。
 *
 * 观测面分五块，每块都有它非要不可的理由：
 *
 *  1. **每步返回码 + 全量状态** —— 逐步比，不只比末态。
 *     一次错误写入可能被后续 clear 掩盖，只比末态会漏。
 *  2. **入参/返回值别名探针** —— 拷贝语义的唯一观测手段。
 *     改外面那份、回读里面那份；里面跟着变即为共享引用。
 *  3. **定长深链探针** —— 生成器最多 16 步，撞不到 64 以上的链。
 *     而 C01 的根因恰恰只在长链上出现，walkChainForCheck 的上界改动
 *     （M67/M68/M69）也只在这里可见。必须单独造。
 *  4. **null / undefined 入参探针** —— 产品里写了 `!source` 这道运行期守卫，
 *     就说明 null source 是它声称要处理的情形，其行为属于契约。
 *     causedBy 同理：`null` 不是合法诊断，被拒是既有行为，必须钉住。
 *  5. **损坏注入** —— 见 corruptionProbe：合法状态下检查器每条子句都返回空，
 *     不造违规状态，"删掉一条子句"结构上不可观测。
 */
function observe(mod: Mod, plan: Plan, nullProbes = true): string {
  const out: string[] = [];
  const col = new mod.DiagnosticCollector();
  /** 另一个 collector：提供"跨 collector 的因"（C09）。 */
  const other = new mod.DiagnosticCollector();
  out.push(`o.seed=${tryRun(() => { other.emit('E_OP_UNKNOWN', { layer: 'kernel' }, 'other'); })}`);
  /** clear 之前留一条旧世代的诊断（C11）。 */
  let stale: Diag | undefined;
  out.push(`o.stale=${tryRun(() => { stale = col.emit('E_DEC_TIMEOUT', { layer: 'kernel' }, 'stale'); })}`);

  const forged: Diag = {
    code: 'E_INV_FORGED',
    severity: 'fatal',
    message: '伪造',
    source: { layer: 'kernel' },
    timestamp: -1,
  };

  for (let i = 0; i < plan.ops.length; i++) {
    const op = plan.ops[i]!;
    let code = 'ok';
    switch (op.k) {
      case 'em': {
        const list = col.all;
        let cause: Diag | undefined;
        switch (op.cause) {
          case 0: cause = undefined; break;
          case 1: cause = list[list.length - 1]; break;
          case 2: cause = list[0]; break;
          case 3: cause = other.all[0]; break;
          case 4: cause = forged; break;
          case 5: cause = stale; break;
        }
        code = tryRun(() => {
          col.emit(op.code, { layer: op.layer, op: op.op, entityId: op.ent }, op.msg, cause);
        });
        break;
      }
      case 'clr':
        code = tryRun(() => col.clear());
        break;
      case 'ch': {
        const target = col.all[op.idx];
        code = target === undefined ? 'noTarget' : tryVal(() => col.chainOf(target, op.depth).length);
        break;
      }
      case 'chDefault': {
        const target = col.all[op.idx];
        code = target === undefined ? 'noTarget' : tryVal(() => col.chainOf(target).length);
        break;
      }
    }
    out.push(`#${i}:${op.k}=${code}`);
    out.push(`s${i}=${dumpCol(col)}`);
  }

  // ——— 别名探针 ———
  // 这两次 emit 必须包起来：变异体（如 M26 把成员判断取反）会让**本来合法**的调用抛错。
  // 若让它逸出，整个 observe 崩掉，比对拿不到串——那会被读成"基础设施故障"，
  // 而它其实正是一处分歧。抛错要作为**数据**记进观测串，不是作为控制流。
  const p = new mod.DiagnosticCollector();
  const src: Record<string, unknown> = { layer: 'kernel', op: 'origOp', entityId: 'e0' };
  let d0: Diag | undefined;
  let d1: Diag | undefined;
  out.push(`p.emit0=${tryRun(() => { d0 = p.emit('E_OP_UNKNOWN', src, 'first'); })}`);
  // 改调用方那份 source：产品若按引用存，已发出的诊断会被追改（C02）
  src['op'] = '事后改的';
  src['注入'] = true;
  out.push(`p.emit1=${tryRun(() => { d1 = p.emit('E_COST_INSUFFICIENT', src, 'second', d0); })}`);
  out.push(`p.srcAlias=${show([shallow(d0), shallow(d1)])}`);
  // all 交出的数组：readonly 只在编译期成立（C04）
  out.push(`p.allLeak=${tryRun(() => { (p.all as Diag[]).length = 0; })}`);
  out.push(`p.allAfter=${dumpCol(p)}`);
  // emit 返回值的身份：必须是本体，否则因果链断裂（M47/M50）
  out.push(`p.identity=${String(p.all[0] === d0)}/${String(p.all[1] === d1)}`);
  // d1 可能没发出来（上面被变异体拦了）。`!` 在这里是刻意的：
  // 传 undefined 进去若抛错，tryVal/tryRun 会把错记成观测值——
  // "少了一条诊断"与"链上取不到"是同一处分歧的两个侧面，都要留在串里。
  out.push(`p.chainIdentity=${tryVal(() => p.chainOf(d1!).map((x) => `${x.code}@${x.timestamp}`))}`);
  out.push(`p.chainSame=${tryRun(() => { if (p.chainOf(d1!)[1] !== d0) throw new Error('链上节点非本体'); })}`);
  // fatals/errors 交出的数组能否反写内部
  out.push(`p.fatalsLeak=${tryRun(() => { p.errors.length = 0; })}`);
  out.push(`p.afterFatalsLeak=${dumpCol(p)}`);

  // ——— 定长深链探针 ———
  // 120 条合法 emit 串成一条链。C01 的现场：原实现在此处报 36 条违规。
  const deep = new mod.DiagnosticCollector();
  let prev: Diag | undefined;
  out.push(`p.deepBuild=${tryRun(() => {
    for (let k = 0; k < 120; k++) {
      prev = deep.emit('E_OP_UNKNOWN', { layer: 'kernel', op: `o${k}` }, `m${k}`, prev);
    }
  })}`);
  out.push(`p.deepInv=${deep.checkInvariants().join(';') || 'ok'}`);
  out.push(`p.deepDefault=${tryVal(() => deep.chainOf(prev!).length)}`);
  out.push(`p.deep200=${tryVal(() => deep.chainOf(prev!, 200).length)}`);
  out.push(`p.deep64=${tryVal(() => deep.chainOf(prev!, 64).length)}`);
  out.push(`p.deep1=${tryVal(() => deep.chainOf(prev!, 1).length)}`);
  out.push(`p.deepSealed=${deep.isSealed}`);

  // ——— null / undefined 入参探针 ———
  const nul = new mod.DiagnosticCollector();
  const dyn = nul as unknown as {
    emit(c: unknown, s: unknown, m?: unknown, cb?: unknown): unknown;
  };
  // null 探针可关：M28 的等价前提正是"套件不构造 null"。
  // 开着跑测的是"全可观测面下是否等价"，关着跑测的是"在前提成立的输入空间内是否等价"。
  // 两者都要跑，差异本身就是那条前提的量化。
  if (nullProbes) out.push(`p.nullSrc=${tryRun(() => { dyn.emit('E_OP_UNKNOWN', null); })}`);
  out.push(`p.undefSrc=${tryRun(() => { dyn.emit('E_OP_UNKNOWN', undefined); })}`);
  out.push(`p.emptySrc=${tryRun(() => { dyn.emit('E_OP_UNKNOWN', {}); })}`);
  out.push(`p.base=${tryRun(() => { nul.emit('E_OP_UNKNOWN', { layer: 'kernel' }, 'base'); })}`);
  if (nullProbes) {
    out.push(`p.nullCause=${tryRun(() => { dyn.emit('E_OP_UNKNOWN', { layer: 'kernel' }, 'm', null); })}`);
    out.push(`p.afterNullCause=${dumpCol(nul)}`);
  }
  out.push(`p.undefCause=${tryRun(() => { dyn.emit('E_OP_UNKNOWN', { layer: 'kernel' }, 'm', undefined); })}`);
  // 两种缺陷同时出现：未注册码 + 空归因。哪个先报是可观测契约（M22 的观测点）
  out.push(`p.bothBad=${tryRun(() => { dyn.emit('XX_BOGUS', { layer: '' }); })}`);
  if (nullProbes) out.push(`p.bothBadNullSrc=${tryRun(() => { dyn.emit('XX_BOGUS', null); })}`);
  out.push(`p.afterNul=${dumpCol(nul)}`);

  // ——— clear 世代语义 ———
  const gen = new mod.DiagnosticCollector();
  let g0: Diag | undefined;
  let g1: Diag | undefined;
  out.push(`p.genEmit0=${tryRun(() => { g0 = gen.emit('E_INV_DANGLING', { layer: 'kernel' }, 'g0'); })}`);
  out.push(`p.gen0=${dumpCol(gen)}`);
  gen.clear();
  out.push(`p.genCleared=${dumpCol(gen)}`);
  out.push(`p.genStaleCause=${tryRun(() => { gen.emit('E_OP_UNKNOWN', { layer: 'kernel' }, 'g1', g0); })}`);
  out.push(`p.genEmit1=${tryRun(() => { g1 = gen.emit('E_OP_UNKNOWN', { layer: 'kernel' }, 'g1'); })}`);
  // 跨 clear 世代的时间戳：clear 刻意不重置 time（C12）。
  // 这条串是 NON_MONOTONIC_TS / CAUSE_NOT_EARLIER 两条子句赖以成立的前提。
  out.push(`p.genTs=${g0?.timestamp}/${g1?.timestamp}`);
  out.push(`p.gen1=${dumpCol(gen)}`);

  // ——— 注册表读取面与自洽性 ———
  out.push(`p.regSize=${mod.CODE_REGISTRY.size}`);
  out.push(`p.regKeys=${[...mod.CODE_REGISTRY.keys()].sort().join(',')}`);
  out.push(`p.regSpecs=${show([...mod.CODE_REGISTRY.entries()].sort((a, b) => a[0].localeCompare(b[0])))}`);
  out.push(`p.regFrozen=${[...mod.CODE_REGISTRY.values()].every((s) => Object.isFrozen(s))}`);
  out.push(`p.regCheck=${mod.DiagnosticCollector.checkRegistry().join(';') || 'ok'}`);
  out.push(`p.prefixes=${[...mod.VALID_PREFIXES].sort().join(',')}`);
  // 封印面：三个写入方法各自的行为
  const rw = mod.CODE_REGISTRY as unknown as Record<string, (...a: unknown[]) => unknown>;
  out.push(`p.sealSet=${tryRun(() => { rw['set']!('XX_INJECT', { code: 'XX_INJECT' }); })}`);
  out.push(`p.sealDelete=${tryRun(() => { rw['delete']!('E_OP_UNKNOWN'); })}`);
  out.push(`p.sealClear=${tryRun(() => { rw['clear']!(); })}`);
  out.push(`p.regAfterSeal=${mod.CODE_REGISTRY.size}/${[...mod.CODE_REGISTRY.keys()].sort().join(',')}`);

  // ——— 损坏注入 ———
  out.push(`p.corrupt=${corruptionProbe(mod)}`);

  return out.join('|');
}

/** collector 的私有面。运行期就是普通属性，private 只是编译期约束。 */
interface Raw {
  diags: Diag[];
  time: number;
  sealed: boolean;
  members: Set<Diag>;
}
const raw = (c: Collector): Raw => c as unknown as Raw;

/**
 * 绕过封印写注册表。
 *
 * sealRegistry 遮蔽的是**实例属性**，原型方法仍在，故 `Map.prototype.set.bind` 能写进去。
 * 能绕过这件事本身就是封印只封了实例面的证据——也正因如此，损坏注入必须自己负责还原：
 * 注册表是模块级单例，残留会让后一个用例的分歧来自上一个用例。
 */
function regWriter(mod: Mod) {
  const REG = mod.CODE_REGISTRY;
  const set = Map.prototype.set.bind(REG) as (k: string, v: unknown) => unknown;
  const del = Map.prototype.delete.bind(REG) as (k: string) => boolean;
  return {
    /**
     * 临时把 code 的 spec 换成 patch，跑 f，然后精确还原（含"原本不存在"的情形）。
     * freeze=false 用于 REG_SPEC_MUTABLE——那条子句只有未冻结的 spec 才点得亮。
     */
    with<T>(code: string, patch: Record<string, unknown> | null, f: () => T, freeze = true): T {
      const had = REG.has(code);
      const prev = REG.get(code);
      try {
        if (patch === null) del(code);
        else set(code, freeze ? Object.freeze(patch) : patch);
        return f();
      } finally {
        if (had) set(code, prev);
        else del(code);
      }
    },
  };
}

/** 一条损坏用例：造违规态 → 读 checkInvariants → 还原。 */
interface Case {
  name: string;
  run(mod: Mod): string;
}

/** 建一个带 n 条合法非致命诊断的 collector。 */
function warnCol(mod: Mod, n: number): { col: Collector; ds: Diag[] } {
  const col = new mod.DiagnosticCollector();
  const ds: Diag[] = [];
  for (let i = 0; i < n; i++) {
    ds.push(col.emit('E_OP_UNKNOWN', { layer: 'kernel', op: `o${i}` }, `m${i}`));
  }
  return { col, ds };
}

const inv = (col: Collector): string => col.checkInvariants().sort().join(';') || 'ok';

/**
 * 每条子句一个用例。
 *
 * 为什么非要注入损坏：探针实测 3000 条**合法** API 序列命中的子句数为 **0**。
 * 合法状态下 checkInvariants 恒返回空数组，于是"删掉任意一条子句"在结构上不可观测——
 * 不是我们没测到，是没有输入能让它显形。造违规态是观测的前提条件，不是附加的测试。
 *
 * 隔离原则：每例尽量只点亮目标子句，其余子句用配套调整压掉
 * （如注入 FATAL_RECOVERABLE 时同步置 sealed，免得 FATAL_NOT_SEALED 一起响）。
 * 隔离不完美也无妨——只要删掉子句会改变输出串，模糊器就看得见；
 * 但隔离得越干净，差分报告越能直接指出是哪条子句变了。
 */
const CASES: Case[] = [
  {
    name: 'UNREGISTERED',
    // 先发后删：emit 自己也查注册表，顺序反了就发不出来。
    run: (mod) => {
      const { col } = warnCol(mod, 1);
      return regWriter(mod).with('E_OP_UNKNOWN', null, () => inv(col));
    },
  },
  {
    name: 'SEVERITY_MISMATCH',
    // 注册表说 warn，诊断自己说 error。prefix/recoverable 保持合法以免带响别的子句。
    run: (mod) => {
      const { col } = warnCol(mod, 1);
      return regWriter(mod).with(
        'E_OP_UNKNOWN',
        { code: 'E_OP_UNKNOWN', severity: 'warn', prefix: 'E_OP', recoverable: true },
        () => inv(col),
      );
    },
  },
  {
    name: 'BAD_PREFIX',
    run: (mod) => {
      const { col } = warnCol(mod, 1);
      return regWriter(mod).with(
        'E_OP_UNKNOWN',
        { code: 'E_OP_UNKNOWN', severity: 'error', prefix: 'ZZ_BAD', recoverable: true },
        () => inv(col),
      );
    },
  },
  {
    name: 'NO_ATTRIBUTION',
    // emit 入口已挡住空 layer，只能事后改诊断上那份拷贝——
    // 这正是"入口守卫"与"不变量子句"必须并存的理由：守卫拦不住已落库的数据损坏。
    run: (mod) => {
      const { col, ds } = warnCol(mod, 1);
      ds[0]!.source = { layer: '' };
      return inv(col);
    },
  },
  {
    name: 'FATAL_RECOVERABLE',
    // 判据看 d.severity 而非 spec.severity，故两边都置 fatal，只留 recoverable 冲突。
    // 同步置 sealed=true，压掉 FATAL_NOT_SEALED。
    run: (mod) => {
      const { col, ds } = warnCol(mod, 1);
      ds[0]!.severity = 'fatal';
      raw(col).sealed = true;
      return regWriter(mod).with(
        'E_OP_UNKNOWN',
        { code: 'E_OP_UNKNOWN', severity: 'fatal', prefix: 'E_OP', recoverable: true },
        () => inv(col),
      );
    },
  },
  {
    name: 'CAUSE_NOT_EARLIER',
    // 让**先发的**指向**后发的**：因的 ts 反而更大，而 diags 数组顺序仍单调、
    // 因仍是成员。于是只有这一条响，NON_MONOTONIC_TS 与 FOREIGN_CAUSE 都不带响。
    run: (mod) => {
      const { col, ds } = warnCol(mod, 2);
      ds[0]!.causedBy = ds[1]!;
      return inv(col);
    },
  },
  {
    name: 'FOREIGN_CAUSE',
    // 因不在 members 里。ts 取 -1 保证早于效果，免得 CAUSE_NOT_EARLIER 一起响。
    run: (mod) => {
      const { col, ds } = warnCol(mod, 1);
      ds[0]!.causedBy = {
        code: 'E_OP_UNKNOWN', severity: 'error', message: '外来',
        source: { layer: 'kernel' }, timestamp: -1,
      };
      return inv(col);
    },
  },
  {
    name: 'CHAIN_CYCLE',
    // 两条互为因果。**注意**：成员间的环必然有一条边在 ts 上是"往前指"的，
    // 所以 CAUSE_NOT_EARLIER 一定伴响——这不是隔离失败，两条子句的串不同，
    // 删掉任一条输出都会变，模糊器仍能分辨。
    run: (mod) => {
      const { col, ds } = warnCol(mod, 2);
      ds[0]!.causedBy = ds[1]!;
      ds[1]!.causedBy = ds[0]!;
      return inv(col);
    },
  },
  {
    name: 'CHAIN_TOO_DEEP',
    // 上界是 diags.length + 1，而链上节点若都是成员，长度天然不会超界。
    // 故挂一串**非成员**的伪造节点：长度压过上界，才让 CHAIN_TOO_DEEP 这条路可达。
    // （伴响 FOREIGN_CAUSE，同上，不影响可分辨性。）
    run: (mod) => {
      const { col, ds } = warnCol(mod, 2);
      let tip: Diag = ds[0]!;
      for (let k = 0; k < 8; k++) {
        const f: Diag = {
          code: 'E_OP_UNKNOWN', severity: 'error', message: `f${k}`,
          source: { layer: 'kernel' }, timestamp: -100 + k,
        };
        tip.causedBy = f;
        tip = f;
      }
      return inv(col);
    },
  },
  {
    name: 'NON_MONOTONIC_TS',
    // 相邻逆序且两值不同：只点亮单调性，不带响 DUPLICATE_TS。
    run: (mod) => {
      const { col, ds } = warnCol(mod, 2);
      ds[1]!.timestamp = ds[0]!.timestamp - 1;
      return inv(col);
    },
  },
  {
    name: 'FATAL_NOT_SEALED',
    // 发一条 fatal（emit 会顺手置 sealed），再把 sealed 掰回 false。
    run: (mod) => {
      const col = new mod.DiagnosticCollector();
      col.emit('E_INV_DANGLING', { layer: 'kernel' }, 'boom');
      raw(col).sealed = false;
      return inv(col);
    },
  },
  {
    name: 'SEALED_WITHOUT_FATAL',
    // 反方向：没有 fatal 却已封印。与上一条成对——只查单向的话，
    // 一个把两个条件整体取反的实现能全身而过（缺陷 C05）。
    run: (mod) => {
      const { col } = warnCol(mod, 1);
      raw(col).sealed = true;
      return inv(col);
    },
  },
  {
    name: 'MEMBERS_SIZE_MISMATCH',
    // members 多一个、diags 不变：size 子句响，MEMBERS_MISSING 不响
    // （后者只遍历 diags，而 diags 里每条都仍在 members 中）。
    run: (mod) => {
      const { col } = warnCol(mod, 1);
      raw(col).members.add({
        code: 'E_OP_UNKNOWN', severity: 'error', message: '幽灵',
        source: { layer: 'kernel' }, timestamp: 999,
      });
      return inv(col);
    },
  },
  {
    name: 'MEMBERS_MISSING',
    // 把 diags[0] 换成一个各字段相同的克隆，members 仍持原对象：
    // 两边**数量相等**（size 子句沉默），但身份对不上。
    // 这一例说明两套登记面为何不能合并——合并了就没有"对不上"可言。
    run: (mod) => {
      const { col, ds } = warnCol(mod, 1);
      raw(col).diags[0] = { ...ds[0]! };
      return inv(col);
    },
  },
  {
    name: 'DUPLICATE_TS',
    // 非相邻重号 [0,1,0]：相邻单调性查不出来，靠全局唯一性子句兜。
    // NON_MONOTONIC_TS 必然伴响——严格升序里出现重复值，总会在某处破坏相邻单调性。
    run: (mod) => {
      const { col, ds } = warnCol(mod, 3);
      ds[2]!.timestamp = ds[0]!.timestamp;
      return inv(col);
    },
  },
  {
    name: 'REG_KEY_MISMATCH',
    // 键与 spec.code 不一致。prefix 取 'E_OP'——它同时是两者的派生前缀，
    // 这样 REG_PREFIX_NOT_DERIVED 不会跟着响。
    run: (mod) => regWriter(mod).with(
      'E_OP_UNKNOWN',
      { code: 'E_OP_OTHER', severity: 'error', prefix: 'E_OP', recoverable: true },
      () => regChk(mod),
    ),
  },
  {
    name: 'REG_BAD_PREFIX',
    // 用一个新键 ZZ_BAD_X：前缀 'ZZ_BAD' 确实是从它派生出来的（故 NOT_DERIVED 沉默），
    // 但不在 VALID_PREFIXES 里。这是把两条前缀子句分开点亮的唯一办法。
    run: (mod) => regWriter(mod).with(
      'ZZ_BAD_X',
      { code: 'ZZ_BAD_X', severity: 'error', prefix: 'ZZ_BAD', recoverable: true },
      () => regChk(mod),
    ),
  },
  {
    name: 'REG_PREFIX_NOT_DERIVED',
    // 反过来：前缀合法（E_INV 在册），但不是 E_OP_UNKNOWN 派生得出的。
    run: (mod) => regWriter(mod).with(
      'E_OP_UNKNOWN',
      { code: 'E_OP_UNKNOWN', severity: 'error', prefix: 'E_INV', recoverable: true },
      () => regChk(mod),
    ),
  },
  {
    name: 'REG_FATAL_RECOVERABLE',
    run: (mod) => regWriter(mod).with(
      'E_OP_UNKNOWN',
      { code: 'E_OP_UNKNOWN', severity: 'fatal', prefix: 'E_OP', recoverable: true },
      () => regChk(mod),
    ),
  },
  {
    name: 'REG_NONFATAL_UNRECOVERABLE',
    // 与上一条成对：注册表层面 severity 与 recoverable 的双向约束。
    run: (mod) => regWriter(mod).with(
      'E_OP_UNKNOWN',
      { code: 'E_OP_UNKNOWN', severity: 'error', prefix: 'E_OP', recoverable: false },
      () => regChk(mod),
    ),
  },
  {
    name: 'REG_SPEC_MUTABLE',
    // 各字段全合法，只差没冻结（freeze=false）。
    // 这条子句守的是"注册表内容此后不会被人改"这个前提——
    // 前提破了，前面所有查 spec 的子句都失去意义。
    run: (mod) => regWriter(mod).with(
      'E_OP_UNKNOWN',
      { code: 'E_OP_UNKNOWN', severity: 'error', prefix: 'E_OP', recoverable: true },
      () => regChk(mod),
      false,
    ),
  },
];

/** 函数声明而非 const：会被提升，故可以写在 CASES 之后。 */
function regChk(mod: Mod): string {
  return mod.DiagnosticCollector.checkRegistry().sort().join(';') || 'ok';
}

/**
 * 逐条跑损坏用例，拼成单行观测串。
 *
 * 每例之后立刻核对注册表已还原（size + 键集），发现残留就地报出来：
 * 注册表是模块级单例，一旦某例没还原干净，后面所有例的分歧都来自污染而非变异体，
 * 那样的"发现不等价"是假阳性，比漏报更浪费时间。
 */
function corruptionProbe(mod: Mod): string {
  const baseSize = mod.CODE_REGISTRY.size;
  const baseKeys = [...mod.CODE_REGISTRY.keys()].sort().join(',');
  const out: string[] = [];
  for (const c of CASES) {
    let got: string;
    try {
      got = c.run(mod);
    } catch (e) {
      got = `!${e instanceof Error ? e.message : String(e)}`;
    }
    out.push(`${c.name}=>${got}`);
    if (mod.CODE_REGISTRY.size !== baseSize || [...mod.CODE_REGISTRY.keys()].sort().join(',') !== baseKeys) {
      out.push(`${c.name}!注册表未还原`);
    }
  }
  return out.join(',');
}

// ---------------------------------------------------------------------------
// 变体装载
// ---------------------------------------------------------------------------

/**
 * 变体落盘目录。
 *
 * **不动 src/diagnostic.ts**。变异驱动器（run.ts）是原地改写再还原的，
 * 那条路径已经毁过一次源文件；这里改成"复制出去再改副本"，
 * 源文件在整个模糊过程中保持只读。
 *
 * 之所以可以这么做：src/diagnostic.ts 没有任何 import，是自足模块。
 * 换个目录放也不会有相对路径失效的问题。
 */
const TMP = path.join(ROOT, 'mutation', '.tmp');
const TARGET = path.join(SRC, 'diagnostic.ts');

let variantSeq = 0;

/**
 * 把源码写成一个**新文件名**的变体并 import 回来。
 *
 * 用新文件名而不是查询串：ESM 里模块身份是解析后的 URL，
 * 同一路径加 `?v=1` 在 Node 下可行，但在 vite-node 的模块图里不保证是两份实例。
 * 文件名不同则模块 id 必然不同，两侧的 `CODE_REGISTRY` 单例天然隔离——
 * 而隔离是本文件成立的前提：注入注册表损坏会污染整个模块。
 */
async function loadVariant(code: string, tag: string): Promise<Mod> {
  fs.mkdirSync(TMP, { recursive: true });
  const file = path.join(TMP, `v${++variantSeq}_${tag}.ts`);
  fs.writeFileSync(file, code, 'utf8');
  return (await import(pathToFileURL(file).href)) as unknown as Mod;
}

/** 变异体应用结果。INVALID 不是"没抓到"，是"这条变异体本身无效"，必须区别对待。 */
type Applied = { ok: true; code: string } | { ok: false; why: string };

/**
 * 应用一个变异体。
 *
 * `find` 必须**命中且仅命中一次**：
 *   - 0 次 → 变异体写错了，替换什么也没发生，跑出来的"等价"是假的；
 *   - ≥2 次 → 实际改了多处，判定结论对不上 desc 里写的那一处。
 * 两种都算 INVALID，直接报错而不是静默降级——静默降级正是变异测试最容易骗人的地方。
 */
function applyMutant(src: string, m: Mutant): Applied {
  const hits = src.split(m.find).length - 1;
  if (hits !== 1) return { ok: false, why: `find 命中 ${hits} 次（要求恰好 1 次）` };
  return { ok: true, code: src.replace(m.find, m.replace) };
}

// ---------------------------------------------------------------------------
// 差分比对
// ---------------------------------------------------------------------------

/** 一次比对的结论。diff 为 null 表示两侧在全部观测面上一致。 */
interface Verdict {
  /** 第一处分歧的可读描述；null 表示无分歧。 */
  diff: string | null;
  /** 实际比对过的观测串数量。用来防"一条都没比就说等价"。 */
  compared: number;
}

/** 截断长串，只在报告里用。首处分歧的上下文比全串更有用。 */
function clip(s: string, n = 240): string {
  return s.length <= n ? s : `${s.slice(0, n)}…(+${s.length - n})`;
}

/**
 * 定位两个观测串的首处字符分歧，并给出两侧各自的上下文。
 *
 * 只报"不相等"没有可操作性——L11 的观测串一条能有几千字符，
 * 人要的是"从哪个字段开始岔开"。
 */
function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 60);
  return [
    `首处分歧 @${i}`,
    `  共同前缀尾部: …${clip(a.slice(from, i), 60)}`,
    `  base: ${clip(a.slice(i))}`,
    `  mut : ${clip(b.slice(i))}`,
  ].join('\n');
}

/**
 * 跑完整观测面并逐条比对。
 *
 * 观测面由三部分构成，缺一不可：
 *   1. corruptionProbe —— 注入非法状态。合法状态下 checkInvariants 永远返回 []，
 *      不注入的话"删掉一条子句"在结构上不可观测（探针实测：3000 条合法序列 0 命中）。
 *   2. checkRegistry 基线 —— 注册表自身的六条子句。
 *   3. 每个随机计划的 observe() —— 两种 nullProbes 模式各跑一遍。
 */
async function compare(
  baseSrc: string,
  mutSrc: string,
  tag: string,
  seqs: number,
  nullProbes: boolean,
): Promise<Verdict> {
  const base = await loadVariant(baseSrc, `base_${tag}`);
  const mut = await loadVariant(mutSrc, `mut_${tag}`);
  let compared = 0;

  const check = (label: string, a: string, b: string): string | null => {
    compared++;
    return a === b ? null : `[${label}]\n${firstDiff(a, b)}`;
  };

  let d = check('registry', regChk(base), regChk(mut));
  if (d) return { diff: d, compared };

  d = check('corruption', corruptionProbe(base), corruptionProbe(mut));
  if (d) return { diff: d, compared };

  for (let s = 0; s < seqs; s++) {
    // 同一个种子喂两侧：输入必须逐位相同，否则分歧可能来自随机数而非变异。
    const plan = makePlan(mulberry32(s + 1));
    d = check(`seq#${s}`, observe(base, plan, nullProbes), observe(mut, plan, nullProbes));
    if (d) return { diff: d, compared };
  }
  return { diff: null, compared };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

/**
 * 哨兵：**已知不等价**、且位于与 M28 同一条语句上的变异体。
 *
 * M26（成员判断取反）、M27（FOREIGN_CAUSE 换成通用码）与 M28 改的是同一行
 * `if (causedBy !== undefined && !this.members.has(causedBy)) {`。
 * 取同一条语句是刻意的：在别处抓到分歧，只能证明模糊器"能工作"，
 * 不能证明它"看得见这一行"。而后者才是等价结论的前提。
 */
const SENTINELS = ['M26', 'M27'] as const;

/** 目前唯一声明等价的变异体。多于一条时这里要跟着列，不能默认扫描。 */
const EQUIVALENT = ['M28'] as const;

function mutantById(id: string): Mutant {
  const m = MUTANTS.find((x) => x.id === id);
  if (!m) throw new Error(`变异体清单里没有 ${id}——mutants.ts 与本文件已脱节`);
  return m;
}

export interface EquivReport {
  lines: string[];
  failures: string[];
}

/**
 * 两阶段执行：先自检分辨力，再判定等价。
 *
 * 顺序不可颠倒。若哨兵没被抓到，"M28 无分歧"这句话的信息量为零——
 * 它既可能是真等价，也可能是模糊器压根没走到那一行。
 * 阶段一失败时直接返回，不再跑阶段二：那时跑出来的结论不可用。
 */
export async function runEquivalence(): Promise<EquivReport> {
  const baseSrc = fs.readFileSync(TARGET, 'utf8');
  const lines: string[] = [];
  const failures: string[] = [];

  lines.push(
    `观测规模：哨兵 ${SENTINEL_SEQS} 序列 / 等价判定 ${SEQS} 序列，每序列 ≤${OPS} 步；` +
      `哨兵与判定跑前提内观测面（无 null 探针），破前提复核另跑带 null 探针的面。`,
  );

  // ---- 阶段一：哨兵必须全部被抓到 ----
  for (const id of SENTINELS) {
    const m = mutantById(id);
    const applied = applyMutant(baseSrc, m);
    if (!applied.ok) {
      failures.push(`哨兵 ${id} INVALID：${applied.why}`);
      continue;
    }
    // 哨兵用**不带 null 探针**的观测面：这正是等价体接受判定的那个面。
    // 若哨兵靠 null 探针才被抓到，就只证明了"null 那条路看得见"，
    // 而 M28 的判定跑在没有 null 的输入空间里，那份分辨力对它无效。
    const v = await compare(baseSrc, applied.code, `sent_${id}`, SENTINEL_SEQS, false);
    if (v.diff === null) {
      failures.push(
        `哨兵 ${id} 未被抓到（比对 ${v.compared} 条观测串全部一致）。\n` +
          `  这不是"${id} 等价"，是本模糊器在这一行上没有分辨力。\n` +
          `  等价判定在此前提下不成立，阶段二结论作废。`,
      );
    } else {
      lines.push(`哨兵 ${id} 已抓到（第 ${v.compared} 条观测串分歧）：${v.diff.split('\n')[0]}`);
    }
  }
  if (failures.length > 0) return { lines, failures };

  // ---- 阶段二：等价体必须处处一致 ----
  for (const id of EQUIVALENT) {
    const m = mutantById(id);
    if (m.expectEquivalent !== true) {
      failures.push(`${id} 未标 expectEquivalent，却被列进等价判定名单——两处已脱节`);
      continue;
    }
    const applied = applyMutant(baseSrc, m);
    if (!applied.ok) {
      failures.push(`等价体 ${id} INVALID：${applied.why}`);
      continue;
    }
    // (a) 前提成立的输入空间内：必须处处一致。这是 expectEquivalent 的正面主张。
    const inside = await compare(baseSrc, applied.code, `equ_${id}`, SEQS, false);
    if (inside.diff === null) {
      lines.push(`等价体 ${id} 在前提内 ${inside.compared} 条观测串上无分歧。前提：${m.desc}`);
    } else {
      failures.push(
        `等价体 ${id} 在前提成立的输入空间内仍有可观测分歧，expectEquivalent 不成立：\n${inside.diff}\n` +
          `  处理方式：去掉 expectEquivalent 让它回到计分池，或把 desc 里的前提改成实际成立的那个。`,
      );
      continue;
    }

    // (b) 故意打破前提：**必须**出现分歧。
    //
    // 这一步不是补充验证，是让 (a) 有意义的那一半。
    // 若打破前提后两侧照旧一致，说明这条"等价"根本不依赖那个前提——
    // 那 desc 里写的前提是假的，读者会照着一个不存在的条件去判断它将来是否还成立。
    // 反过来，此处的分歧就是那条前提的**量化**：它精确地标出等价在哪里终止。
    const outside = await compare(baseSrc, applied.code, `brk_${id}`, Math.max(1, Math.min(SEQS, 8)), true);
    if (outside.diff === null) {
      failures.push(
        `等价体 ${id} 打破前提后仍无分歧（比对 ${outside.compared} 条观测串）。\n` +
          `  desc 声明的前提因此不是等价成立的条件，属于误记；\n` +
          `  要么找出真正的前提写进 desc，要么这条变异体本就是"去牙变异体"，应重写成真会改变行为的形式。`,
      );
    } else {
      lines.push(
        `等价体 ${id} 打破前提即分歧（前提是承重的）：${outside.diff.split('\n')[0]} @${
          outside.diff.split('\n')[1]?.trim() ?? '?'
        }`,
      );
    }
  }
  return { lines, failures };
}

/** 清理变体目录。放在 finally 里调用；留下残渣会让下次跑的模块 id 冲突。 */
export function cleanupVariants(): void {
  fs.rmSync(TMP, { recursive: true, force: true });
}

/**
 * L12 等价性差分模糊器。
 *
 * 目的：对标注为 expectEquivalent 的变异体，证明它在**全部可观测面**上
 * 与原实现无差别——而不是"我们的测试没测到它"。
 *
 * 关键设计：**先自检，再判定**。
 * "跑了 N 步没有反例"有两种成因：真等价，或模糊器根本没走到变异点。
 * 二者在输出上完全一样。故第一阶段先注入一批**已知不等价**的哨兵，
 * 全部被抓到才说明这个模糊器有分辨力；否则先修模糊器再谈结论。
 * 哨兵必须取自与目标同一段代码，否则"抓到了别处"不能证明"这里看得见"。
 *
 * 观测面：不是只看返回值，而是把
 *   ok / 诊断码序列 / 状态各字段 / effect 实际执行序列 / 自检违规
 * 全部拼成一行文本比对——只看结果时，"走了哪条链""跳过了哪一跳"不可观测。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUTANTS } from './mutants.js';
import type { Mutant } from './mutants.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'src');

const SEQS = Number(process.env.EQUIV_SEQS ?? 3_000);
const OPS = Number(process.env.EQUIV_OPS ?? 12);
const SENTINEL_SEQS = Number(process.env.EQUIV_SENTINEL_SEQS ?? 400);

/**
 * 版本池刻意极小且**共用于 from/to/current 三处**。
 *
 * 若 from 池与 to 池不相交，菱形与等长多路径永不出现，
 * 链选择相关的分支便永远得不到表决机会（L4 的 M13 正因两池不相交而漏检）。
 */
const VERSIONS = ['0.0.0', '1.0.0', '1.1.0', '2.0.0'];
const KEYS = ['a', 'b'];
/** 刻意混入畸形版本：前置校验分支只有靠它们才可达。 */
const BAD_VERSIONS = ['abc', '1.0', '1.0.0.0', '', '1.0.x'];
/**
 * 刻意混入非有限数与非数字的 props 值。
 * NaN/±Infinity 只被 Number.isFinite 拦住；字符串与 null 只被 typeof 拦住。
 * 两类都要有，才能区分"去掉 isFinite"与"去掉 typeof"这两种改动。
 */
const BAD_PROPS = [NaN, Infinity, -Infinity, '7' as unknown as number, null as unknown as number];
/**
 * props 容器本身的违规取值。
 * null 与 undefined 只被 `=== null` / typeof 联合判据拦住；
 * 字符串与数字只被 typeof 拦住。要区分这两半判据，两类都得有。
 */
const BAD_PROPS_CONTAINERS = [
  null, undefined, 'nope', 42,
] as unknown as Array<Record<string, number>>;

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

interface StateSpec {
  version: string;
  playpackId: string;
  phaseIndex: number;
  randomCounter: number;
  props: Record<string, number>;
}

type OpSpec =
  | { k: 'add'; key: string; d: number }
  | { k: 'set'; key: string; v: number }
  | { k: 'del'; key: string }
  | { k: 'phase' }
  | { k: 'roll' }
  | { k: 'impure'; key: string; d: number };

interface MigSpec {
  id: string;
  from: string;
  to: string;
  effects: Array<{ k: 'add'; key: string; d: number } | { k: 'throw' }>;
  onFail: 'reject' | 'bestEffort';
}

/** 一步随机计划：既覆盖持久化面，也覆盖迁移面。 */
interface Plan {
  seed: StateSpec;
  ops: OpSpec[];
  current: string;
  migrations: MigSpec[];
  /** journal 切片点，用于续放等价性 */
  cut: number;
  /** rewind 参数，含越界与非正值 */
  rewindN: number;
  /** trim 参数，含 0 与超范围 */
  trimN: number;
  label: string;
}

function makePlan(rnd: () => number): Plan {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));

  /**
   * props 刻意有小概率取**非有限数与非数字**。
   *
   * 只喂整数的话，checkWorldState 里那段 props 遍历永远走"合法"分支：
   * 无论它写 `typeof n !== 'number' || !Number.isFinite(n)` 还是干脆不检查，
   * 输出都一样。于是该代码块上的变异体全部"无反例"——而这不是等价，
   * 是模糊器没走到。非数字用 as 强转注入：这里要的正是类型系统之外的输入。
   */
  const props: Record<string, number> = {};
  for (const key of KEYS) {
    if (rnd() >= 0.6) continue;
    const r = rnd();
    if (r < 0.82) props[key] = int(-30, 30);
    else props[key] = pick(BAD_PROPS);
  }

  const ops: OpSpec[] = [];
  for (let i = 0; i < int(0, OPS); i++) {
    const r = rnd();
    if (r < 0.3) ops.push({ k: 'add', key: pick(KEYS), d: int(-20, 20) });
    else if (r < 0.5) ops.push({ k: 'set', key: pick(KEYS), v: int(-20, 20) });
    else if (r < 0.62) ops.push({ k: 'del', key: pick(KEYS) });
    else if (r < 0.74) ops.push({ k: 'phase' });
    else if (r < 0.86) ops.push({ k: 'roll' });
    else ops.push({ k: 'impure', key: pick(KEYS), d: int(-20, 20) });
  }

  // 版本刻意有小概率取畸形值：不这样做，前置校验分支永不可达。
  let version = rnd() < 0.12 ? pick(BAD_VERSIONS) : pick(VERSIONS);
  let current = rnd() < 0.12 ? pick(BAD_VERSIONS) : pick(VERSIONS);

  const migrations: MigSpec[] = [];
  /**
   * 三种拓扑模式，各占约三分之一。
   *
   * 为什么不能全随机：from/to 全随机时"链确实抵达目标版本"是低概率事件
   * （四个版本随机连边，多数计划要么无链要么半途而废），于是**装载成功**
   * 这条主路径几乎得不到表决机会，成功路径上的改动（丢弃诊断、
   * 不克隆返回状态）便无从观测。M64/M79/M80 三个哨兵正是这样漏掉的。
   *
   *  - linear：沿 VERSIONS 顺序的唯一链，保证可抵达 → 成功路径可表决
   *  - diamond：同一对端点间**长短两条**链，直达边先声明 → 链选择可表决
   *  - random：任意连边 → 无链/半途而废/自环/平行边等边角可表决
   *
   * diamond 必须单列。全随机连边时，"长短两条链并存"是低概率事件，
   * 而唯一链下 BFS 与 DFS 给出同一答案——于是最短性相关的改动
   * （队列换栈）在 400 步自检里抓不到。这不是等价，是拓扑没造出来。
   *
   * 声明顺序的方向很关键，且容易反：栈弹出的是**最后入队**的边，
   * 入队顺序即声明顺序。要让 DFS 走上长路，直达边必须**先**声明。
   * 反着写（长路先声明）时 DFS 恰好也弹到直达边，两者答案相同，
   * 于是这个拓扑一步也区分不出来。
   */
  const mode = rnd();
  const linear = mode < 0.34;
  const diamond = !linear && mode < 0.67;
  if (diamond) {
    // 端点固定取 VERSIONS 首尾，保证 from < to 且两条链都存在。
    const a = VERSIONS[0]!;
    const z = VERSIONS[VERSIONS.length - 1]!;
    version = a;
    current = z;
    const mk = (from: string, to: string, tag: string): MigSpec => {
      const effects: MigSpec['effects'] = [];
      const n = rnd() < 0.2 ? 0 : int(1, 2);
      for (let j = 0; j < n; j++) {
        if (rnd() < 0.15) effects.push({ k: 'throw' });
        else effects.push({ k: 'add', key: pick(KEYS), d: int(-10, 10) });
      }
      return {
        id: `${tag}:${from}->${to}`, from, to, effects,
        onFail: rnd() < 0.7 ? 'bestEffort' : 'reject',
      };
    };
    // 直达边先声明 → 先入队 → 栈最后才弹到它。BFS 取它，DFS 不取。
    migrations.push(mk(a, z, 'direct'));
    // 绕路后声明 → 后入队 → 栈先弹到它，DFS 由此走上长链。
    for (let i = 0; i < VERSIONS.length - 1; i++) {
      migrations.push(mk(VERSIONS[i]!, VERSIONS[i + 1]!, `long${i}`));
    }
  } else if (linear) {
    const lo = int(0, VERSIONS.length - 2);
    const hi = int(lo + 1, VERSIONS.length - 1);
    version = VERSIONS[lo]!;
    current = VERSIONS[hi]!;
    for (let i = lo; i < hi; i++) {
      const effects: MigSpec['effects'] = [];
      // 刻意允许**零 effect** 的跳：零 effect 时状态对象不被重建，
      // props 仍与入参存档同引用，返回前那次克隆才成为承重结构。
      const n = rnd() < 0.25 ? 0 : int(1, 2);
      for (let j = 0; j < n; j++) {
        if (rnd() < 0.3) effects.push({ k: 'throw' });
        else effects.push({ k: 'add', key: pick(KEYS), d: int(-10, 10) });
      }
      migrations.push({
        id: `L${i}:${VERSIONS[i]}->${VERSIONS[i + 1]}`,
        from: VERSIONS[i]!, to: VERSIONS[i + 1]!, effects,
        // 偏向 bestEffort：只有它能产生"成功装载 + 非空诊断"的组合。
        onFail: rnd() < 0.7 ? 'bestEffort' : 'reject',
      });
    }
  } else {
    for (let i = 0; i < int(0, 5); i++) {
      const effects: MigSpec['effects'] = [];
      for (let j = 0; j < int(0, 3); j++) {
        if (rnd() < 0.25) effects.push({ k: 'throw' });
        else effects.push({ k: 'add', key: pick(KEYS), d: int(-10, 10) });
      }
      const from = pick(VERSIONS);
      const to = pick(VERSIONS);
      migrations.push({
        id: `m${i}:${from}->${to}`,
        from, to, effects,
        onFail: rnd() < 0.5 ? 'reject' : 'bestEffort',
      });
    }
  }

  // 小概率让存档版本等于目标版本：cmp===0 的直接恢复分支只有靠它可达。
  if (!linear && !diamond && rnd() < 0.15) current = version;

  return {
    // phaseIndex/randomCounter/playpackId 同样刻意含违规取值（负数、小数、空串）：
    // 全部喂合法值时，checkWorldState 的对应子句无论在不在都测不出差别。
    seed: {
      version,
      playpackId: rnd() < 0.12 ? '' : pick(['pp:1', 'pp:2']),
      phaseIndex: rnd() < 0.12 ? pick([-1, 1.5]) : int(0, 3),
      randomCounter: rnd() < 0.12 ? pick([-2, 0.5]) : int(0, 3),
      // props 本身也要小概率**非对象**：只喂对象时，
      // checkWorldState 里 `props === null || typeof props !== 'object'`
      // 这一子句在不在都一样，它上面的变异体永远"无反例"。
      props: rnd() < 0.08 ? pick(BAD_PROPS_CONTAINERS) : props,
    },
    ops, current, migrations,
    cut: int(0, ops.length),
    rewindN: int(-1, 4),
    trimN: int(0, 6),
    label: pick(['c1', 'c2']),
  };
}

/** 被测模块的最小接口形状。 */
interface Mod {
  cloneState: (s: StateSpec) => StateSpec;
  replay: (s: StateSpec, ops: Array<{ id: string; apply: (x: StateSpec) => StateSpec }>) => StateSpec;
  takeSnapshot: (s: StateSpec) => { id: string; state: StateSpec; createdAt: number };
  SnapshotStore: new () => {
    take: (s: StateSpec) => { id: string; state: StateSpec; createdAt: number };
    count: () => number; checkInvariants: () => string[];
  };
  Journal: new () => {
    append: (op: { id: string; apply: (x: StateSpec) => StateSpec }) => void;
    getAll: () => ReadonlyArray<{ seq: number; op: { id: string; apply: (x: StateSpec) => StateSpec } }>;
    since: (n: number) => ReadonlyArray<{ seq: number; op: { id: string; apply: (x: StateSpec) => StateSpec } }>;
    trim: (n: number) => void; clear: () => void; checkInvariants: () => string[];
  };
  CheckpointStore: new () => {
    checkpoint: (l: string, s: StateSpec) => void; restore: (l: string) => StateSpec;
    has: (l: string) => boolean; list: () => string[]; remove: (l: string) => void;
    checkInvariants: () => string[];
  };
  PhaseBoundaryLog: new () => {
    markBoundary: (s: StateSpec) => void; rewind: (n: number) => StateSpec;
    count: () => number; checkInvariants: () => string[];
  };
  resetSnapshotCounter: () => void;
  checkWorldState: (s: StateSpec, where?: string) => string[];
  isWellFormedVersion: (v: string) => boolean;
  loadSnapshot: (
    s: StateSpec, current: string, migs: unknown[],
  ) => { ok: boolean; state?: StateSpec | null; diagnostics: Array<{ code: string; detail: string }> };
  compareVersions: (a: string, b: string) => number;
}

function showState(s: StateSpec | null | undefined): string {
  if (s === null || s === undefined) return '<none>';
  const props = Object.keys(s.props).sort().map((k) => `${k}=${s.props[k]}`).join(',');
  return `v${s.version}|${s.playpackId}|p${s.phaseIndex}|r${s.randomCounter}|{${props}}`;
}

function buildOp(spec: OpSpec): { id: string; apply: (s: StateSpec) => StateSpec } {
  switch (spec.k) {
    case 'add':
      return { id: `add:${spec.key}:${spec.d}`, apply: (s) => ({ ...s, props: { ...s.props, [spec.key]: (s.props[spec.key] ?? 0) + spec.d } }) };
    case 'set':
      return { id: `set:${spec.key}:${spec.v}`, apply: (s) => ({ ...s, props: { ...s.props, [spec.key]: spec.v } }) };
    case 'del':
      return { id: `del:${spec.key}`, apply: (s) => { const p = { ...s.props }; delete p[spec.key]; return { ...s, props: p }; } };
    case 'phase':
      return { id: 'phase', apply: (s) => ({ ...s, phaseIndex: s.phaseIndex + 1 }) };
    case 'roll':
      return { id: 'roll', apply: (s) => ({ ...s, randomCounter: s.randomCounter + 1 }) };
    case 'impure':
      // 原地写：让"replay 是否克隆 seed"成为可观测事件
      return { id: `imp:${spec.key}:${spec.d}`, apply: (s) => { s.props[spec.key] = (s.props[spec.key] ?? 0) + spec.d; return s; } };
  }
}

/**
 * 执行一步计划，返回**全部可观测面**拼成的一行文本。
 *
 * effect 执行序列写入 sink：链选择与跳过行为若不记录，多条等效链之间
 * 的差异在最终状态上不可见。
 */
function observe(mod: Mod, plan: Plan): string {
  /**
   * 每步先清零模块级发号器。
   *
   * takeSnapshot 用的是模块态计数器，它跨步累积：基线模块在哨兵阶段
   * 已经吃掉若干号，而变异体模块是新导入的、从 1 起。于是**任何**变异体
   * 都会在这个字段上"第 1 步就不等价"——判定不是来自变异，而是来自
   * 观测顺序。这类假"不等价"与假"等价"同样是错结论：
   * 差分比较必须两侧同起点。
   */
  mod.resetSnapshotCounter();
  const out: string[] = [];
  const guard = <T>(f: () => T, show: (v: T) => string): string => {
    try {
      return show(f());
    } catch (e) {
      return `THROW:${e instanceof Error ? e.message : String(e)}`;
    }
  };

  // --- replay 与 seed 保护 ---
  const seedLive: StateSpec = { ...plan.seed, props: { ...plan.seed.props } };
  const ops = plan.ops.map(buildOp);
  out.push(`replay=${guard(() => mod.replay(seedLive, ops), showState)}`);
  out.push(`seedAfter=${showState(seedLive)}`);
  // 连调两次：不纯 Op 下才能区分"克隆了"与"没克隆"
  out.push(`replay2=${guard(() => mod.replay(seedLive, ops), showState)}`);

  // --- journal 切片续放 ---
  const j = new mod.Journal();
  for (const op of ops) j.append(op);
  out.push(`seqs=${j.getAll().map((e) => e.seq).join('.')}`);
  out.push(`since=${guard(() => j.since(plan.cut).map((e) => e.op.id).join('.'), (v) => v)}`);
  const mid = guard(() => mod.replay(seedLive, j.getAll().slice(0, plan.cut).map((e) => e.op)), showState);
  out.push(`mid=${mid}`);
  out.push(`jInv=${j.checkInvariants().join(';') || 'ok'}`);
  j.trim(plan.trimN);
  // trim 后既看编号也看 op 身份：只看 seq 时，"留最后 N 条"与"留最前 N 条"
  // 在编号被重排的实现下可能撞成同一串。
  out.push(`trimmed=${j.getAll().map((e) => `${e.seq}:${e.op.id}`).join('.')}`);
  out.push(`jInv2=${j.checkInvariants().join(';') || 'ok'}`);
  // clear 后续发号：M36 类改动（clear 不重置发号器）只在这里可见。
  j.clear();
  out.push(`cleared=${j.getAll().length}`);
  j.append(ops[0] ?? buildOp({ k: 'phase' }));
  out.push(`afterClear=${j.getAll().map((e) => e.seq).join('.')}/${j.checkInvariants().join(';') || 'ok'}`);

  // --- 快照隔离与发号 ---
  const store = new mod.SnapshotStore();
  const snapA = store.take(seedLive);
  seedLive.props[KEYS[0]!] = 4242;
  out.push(`snapA=${snapA.id}/${snapA.createdAt}/${showState(snapA.state)}`);
  out.push(`snapB=${store.take(seedLive).id}`);
  out.push(`sCount=${store.count()}/${store.checkInvariants().join(';') || 'ok'}`);
  out.push(`global=${mod.takeSnapshot(seedLive).id}`);

  // --- 检查点存取双向隔离 ---
  const cp = new mod.CheckpointStore();
  const cpLive: StateSpec = { ...plan.seed, props: { ...plan.seed.props } };
  cp.checkpoint(plan.label, cpLive);
  cpLive.props[KEYS[0]!] = -1;
  out.push(`cpAfterLive=${guard(() => cp.restore(plan.label), showState)}`);
  const got = guard(() => { const r = cp.restore(plan.label); r.props[KEYS[0]!] = 999; return r; }, showState);
  out.push(`cpMutated=${got}`);
  out.push(`cpReRead=${guard(() => cp.restore(plan.label), showState)}`);
  cp.checkpoint('c1', cpLive);
  cp.checkpoint('c1', cpLive);
  out.push(`cpList=${cp.list().join(',')}`);
  cp.remove(plan.label);
  out.push(`cpAfterRemove=${cp.list().join(',')}/${cp.has(plan.label)}`);
  out.push(`cpInv=${cp.checkInvariants().join(';') || 'ok'}`);
  out.push(`cpGhost=${guard(() => cp.restore('ghost'), showState)}`);

  // --- 相位边界 ---
  const log = new mod.PhaseBoundaryLog();
  const bLive: StateSpec = { ...plan.seed, props: { ...plan.seed.props } };
  log.markBoundary(bLive);
  bLive.props[KEYS[0]!] = 7;
  log.markBoundary(bLive);
  log.markBoundary(bLive);
  out.push(`rewind=${guard(() => log.rewind(plan.rewindN), showState)}`);
  out.push(`rewindTwice=${guard(() => { const r = log.rewind(plan.rewindN); r.phaseIndex += 100; return log.rewind(plan.rewindN); }, showState)}`);
  out.push(`bCount=${log.count()}/${log.checkInvariants().join(';') || 'ok'}`);
  // list() 是否交出内部数组（M44 类改动）：改完再读一次才可观测。
  const listed = cp.list();
  listed.push('__injected__');
  out.push(`cpListAfterMutate=${cp.list().join(',')}/${cp.checkInvariants().join(';') || 'ok'}`);

  // --- 状态自检与版本判据 ---
  // 取全文而非条数：两条子句互换文案、或错报到另一个字段名上，条数是一样的。
  // where 也要观测，它是 checkInvariants 递归调用时定位损坏的唯一线索。
  out.push(`wsInv=${guard(() => mod.checkWorldState(plan.seed).join(';') || 'ok', (v) => v)}`);
  out.push(`wsInvWhere=${guard(() => mod.checkWorldState(plan.seed, 'W').join(';') || 'ok', (v) => v)}`);
  out.push(`wf=${VERSIONS.concat(BAD_VERSIONS).map((v) => (mod.isWellFormedVersion(v) ? 1 : 0)).join('')}`);
  out.push(`cmp=${VERSIONS.map((a) => VERSIONS.map((b) => Math.sign(mod.compareVersions(a, b))).join('')).join('/')}`);

  // --- 迁移装载：诊断码序列 + effect 执行序列 ---
  const sink: string[] = [];
  const migs = plan.migrations.map((m) => ({
    id: m.id, from: m.from, to: m.to, onFail: m.onFail,
    effects: m.effects.map((eff, i) => ({
      apply: (s: StateSpec): StateSpec => {
        sink.push(`${m.id}#${i}`);
        if (eff.k === 'throw') throw new Error(`boom:${m.id}#${i}`);
        return { ...s, props: { ...s.props, [eff.key]: (s.props[eff.key] ?? 0) + eff.d } };
      },
    })),
  }));
  const savedForLoad: StateSpec = { ...plan.seed, props: { ...plan.seed.props } };
  const load = guard(
    () => mod.loadSnapshot(savedForLoad, plan.current, migs),
    (r) => `${r.ok}/${r.diagnostics.map((d) => d.code).join(',')}/${showState(r.state)}/${r.diagnostics.every((d) => d.detail.length > 0)}`,
  );
  out.push(`load=${load}`);
  out.push(`sink=${sink.join('.')}`);
  out.push(`savedIntact=${showState(savedForLoad)}`);

  /**
   * 装载结果与入参存档的**别名关系**：只读返回值时不可观测。
   *
   * "返回入参引用"与"返回入参的副本"读起来一模一样，
   * 差异只在**改了返回值之后再读存档**。同版本直通分支（cmp===0）与
   * 成功路径的最后一次克隆，都只能这样才看得见。
   * 用另一份干净存档重跑一次，避免污染上面 savedIntact 的观测。
   */
  const probeSaved: StateSpec = { ...plan.seed, props: { ...plan.seed.props } };
  const probeSink: string[] = [];
  const probeMigs = plan.migrations.map((m) => ({
    id: m.id, from: m.from, to: m.to, onFail: m.onFail,
    effects: m.effects.map((eff, i) => ({
      apply: (s: StateSpec): StateSpec => {
        probeSink.push(`${m.id}#${i}`);
        if (eff.k === 'throw') throw new Error(`boom:${m.id}#${i}`);
        return { ...s, props: { ...s.props, [eff.key]: (s.props[eff.key] ?? 0) + eff.d } };
      },
    })),
  }));
  out.push(`alias=${guard(() => {
    const r = mod.loadSnapshot(probeSaved, plan.current, probeMigs);
    if (!r.ok || r.state === null || r.state === undefined) return `noState/${r.ok}`;
    // 改返回值的每个可写面：标量字段与 props 各写一处。
    r.state.phaseIndex = 31337;
    if (r.state.props !== null && typeof r.state.props === 'object') {
      r.state.props[KEYS[0]!] = 31337;
    }
    // 存档若被带着改了，说明两者共享引用。
    return showState(probeSaved);
  }, (v) => v)}`);

  return out.join('|');
}

async function importFresh(file: string): Promise<Mod> {
  const p = pathToFileUrl(file);
  const persistence = await import(`${p.persistence}?t=${Date.now()}${Math.random()}`);
  const migration = await import(`${p.migration}?t=${Date.now()}${Math.random()}`);
  return { ...persistence, ...migration } as Mod;
}

function pathToFileUrl(dir: string): { persistence: string; migration: string } {
  const toUrl = (f: string): string => new URL(`file:///${path.join(dir, f).replace(/\\/g, '/')}`).href;
  return { persistence: toUrl('persistence.ts'), migration: toUrl('migration.ts') };
}

/** 把变异体写进一份**独立目录**，避免动到 src/ 本体。 */
function materialize(mutant: Mutant, tag: string): string {
  const dir = path.join(ROOT, 'src', `__equiv_${tag}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['persistence.ts', 'migration.ts']) {
    let text = fs.readFileSync(path.join(SRC, f), 'utf8');
    if (f === mutant.file) {
      const hits = text.split(mutant.find).length - 1;
      if (hits !== 1) throw new Error(`${mutant.id} 的 find 命中 ${hits} 次（要求 1 次）`);
      text = text.replace(mutant.find, mutant.replace);
    }
    fs.writeFileSync(path.join(dir, f), text, 'utf8');
  }
  return dir;
}

interface DiffResult { diverged: boolean; step: number; detail: string }

async function diff(mutant: Mutant, base: Mod, seqs: number): Promise<DiffResult> {
  const dir = materialize(mutant, mutant.id);
  try {
    const mutated = await importFresh(dir);
    for (let i = 0; i < seqs; i++) {
      const planA = makePlan(mulberry32(i + 1));
      const planB = makePlan(mulberry32(i + 1));
      let a: string;
      let b: string;
      try {
        a = observe(base, planA);
      } catch (e) {
        a = `HARD_THROW:${e instanceof Error ? e.message : String(e)}`;
      }
      try {
        b = observe(mutated, planB);
      } catch (e) {
        b = `HARD_THROW:${e instanceof Error ? e.message : String(e)}`;
      }
      if (a !== b) {
        const at = firstDiff(a, b);
        return { diverged: true, step: i + 1, detail: at };
      }
    }
    return { diverged: false, step: seqs, detail: '' };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function firstDiff(a: string, b: string): string {
  const fa = a.split('|');
  const fb = b.split('|');
  for (let i = 0; i < Math.max(fa.length, fb.length); i++) {
    if (fa[i] !== fb[i]) return `字段#${i} 原=${(fa[i] ?? '<缺>').slice(0, 90)} 变=${(fb[i] ?? '<缺>').slice(0, 90)}`;
  }
  return '长度不同';
}

/**
 * 哨兵：**已知不等价**的变异体，用于检验模糊器本身有分辨力。
 *
 * 选取原则：必须与待证目标落在同一段代码上。抓到了别处的变异
 * 不能证明"这里看得见"。
 *
 * 当前待证目标及其所在代码块，每块都必须有同块哨兵：
 *  - compareVersions（M59 段数取 min、M60 去掉 ||0）
 *      → 哨兵 M56 M57 M58：同一段比较循环内的已知不等价改动
 *  - findMigrationChain（M81 命中判定移到 visited 之后）
 *      → 哨兵 M82 M84 M85 M87：同一 BFS 循环内的入队/邻接/命中改动
 *  - checkWorldState 的 props 遍历（M27 去掉冗余 typeof 前置判断）
 *      → 哨兵 M26：同一 if 上删掉 isFinite，NaN/Infinity 便漏过去；
 *        M25：该遍历的外层 props 类型守卫
 *  - Journal.trim（M34 提前清空改走 slice、M35 边界改 >=）
 *      → 哨兵 M33：同一 slice 行改成保留最前 N 条；
 *        M31：发号器不递增，让 trim 的编号可观测面本身可被检验
 *  - 持久化侧克隆语义（用于兜住整体观测面）: M01 M08
 *
 * M79 曾被标为等价目标，实测被杀（零 effect 链下那次 cloneState 是承重的），
 * 故已从目标中移除；它作为 loadSnapshot 成功路径的同块哨兵仍然有效，
 * 与 M64 M80 M76 一并保留。
 */
const SENTINELS = [
  // compareVersions
  'M56', 'M57', 'M58',
  // loadSnapshot 成功路径与克隆
  'M64', 'M80', 'M76', 'M79',
  // findMigrationChain
  'M82', 'M84', 'M85', 'M87',
  // checkWorldState props 遍历
  'M26', 'M25',
  // Journal.trim 及其编号可观测面
  'M33', 'M31',
  // 持久化侧克隆语义
  'M01', 'M08',
];

function cleanup(): void {
  const src = fs.existsSync(SRC) ? fs.readdirSync(SRC) : [];
  for (const entry of src) {
    if (entry.startsWith('__equiv_')) {
      fs.rmSync(path.join(SRC, entry), { recursive: true, force: true });
    }
  }
}

async function main(): Promise<boolean> {
  const base = await importFresh(SRC);
  const byId = new Map(MUTANTS.map((m) => [m.id, m]));

  process.stdout.write('阶段 1／模糊器自检：注入已知不等价的哨兵，全部必须被发现。\n');
  const blind: string[] = [];
  for (const id of SENTINELS) {
    const mutant = byId.get(id);
    if (!mutant) {
      process.stdout.write(`  ${id} 缺失：清单里没有这个 id\n`);
      blind.push(id);
      continue;
    }
    const r = await diff(mutant, base, SENTINEL_SEQS);
    if (r.diverged) {
      process.stdout.write(`  ${id} 发现（第 ${r.step} 步）  ${mutant.desc}\n`);
    } else {
      process.stdout.write(`  ${id} 盲区！${SENTINEL_SEQS} 步未发现  ${mutant.desc}\n`);
      blind.push(id);
    }
  }
  if (blind.length > 0) {
    process.stdout.write(`\n自检失败：${blind.join(',')} 未被发现。\n`);
    process.stdout.write('在修好观测面之前，"未发现反例"不能作为等价性证据。\n');
    return false;
  }
  process.stdout.write(`自检通过：${SENTINELS.length}/${SENTINELS.length} 全部被发现。\n\n`);

  process.stdout.write(`阶段 2／等价性判定：每个目标跑 ${SEQS} 步。\n`);
  const targets = MUTANTS.filter((m) => m.expectEquivalent);
  const report: Array<{ id: string; desc: string; equivalent: boolean; step: number; detail: string }> = [];
  let allEquivalent = true;
  for (const mutant of targets) {
    const r = await diff(mutant, base, SEQS);
    report.push({ id: mutant.id, desc: mutant.desc, equivalent: !r.diverged, step: r.step, detail: r.detail });
    if (r.diverged) {
      allEquivalent = false;
      process.stdout.write(`  ${mutant.id} 不等价（第 ${r.step} 步）：${r.detail}\n`);
    } else {
      process.stdout.write(`  ${mutant.id} 等价（${SEQS} 步无反例）  ${mutant.desc}\n`);
    }
  }

  fs.writeFileSync(
    path.join(ROOT, 'mutation', 'equivalence-result.json'),
    JSON.stringify({
      sentinels: SENTINELS.length, sentinelBlind: blind.length,
      sequences: SEQS, sentinelSequences: SENTINEL_SEQS,
      targets: targets.length, equivalent: report.filter((r) => r.equivalent).length, report,
    }, null, 2),
    'utf8',
  );

  process.stdout.write(`\n结论：${report.filter((r) => r.equivalent).length}/${targets.length} 个目标在 ${SEQS} 步内无可观测差异。\n`);
  return allEquivalent;
}

main()
  .then((ok) => {
    cleanup();
    process.exit(ok ? 0 : 1);
  })
  .catch((e) => {
    cleanup();
    process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
    process.exit(1);
  });

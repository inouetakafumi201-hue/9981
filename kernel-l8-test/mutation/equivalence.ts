/**
 * L8 等价性差分模糊器。
 *
 * 目的：对标注为 expectEquivalent 的变异体，证明它在**全部可观测面**上
 * 与原实现无差别——而不是"我们的测试没测到它"。两者在得分表上长得一样，
 * 但一个是结论，一个是盲区。
 *
 * 关键设计：**先自检，再判定**。
 * "跑了 N 步没有反例"有两种成因：真等价，或模糊器根本没走到变异点。
 * 故第一阶段先注入一批**已知不等价**的哨兵，全部被抓到才说明这个模糊器
 * 有分辨力；否则先修模糊器再谈结论。
 * 哨兵必须取自与目标同一段代码——抓到了别处不能证明"这里看得见"。
 *
 * 观测面：不是只看返回值，而是把
 *   每步错误码 / dump 全量状态 / checkInvariants 违规 / 别名探针
 * 全部拼成一行文本比对。只看"有没有抛错"时，索引内容与拷贝语义不可观测。
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
const OPS = Number(process.env.EQUIV_OPS ?? 14);
const SENTINEL_SEQS = Number(process.env.EQUIV_SENTINEL_SEQS ?? 400);

/**
 * 全部 id 池刻意极小，且 **add 与 del 抽同一个池**。
 *
 * 这是本层空转的根因所在：原套件 add 用 `fc.uuid()`、del 用固定池，
 * 两池不相交 ⇒ 删除永远删不到东西（实测 0/2000）。
 * 池子共用之后，删除、覆盖、级联、自环才都成为可达事件。
 */
const ENTS = ['e0', 'e1', 'e2'];
const RELS = ['r0', 'r1', 'r2'];
const ATTS = ['a0', 'a1'];
/** 类型池极小：只有类型重复，索引桶内才会出现多条，桶顺序才可观测。 */
const TYPES = ['ally', 'enemy'];
/** 刻意混入不在实体池里的 id：引用校验分支只有靠它们才可达。 */
const BAD_ENTS = ['nope', ''];

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

type OpSpec =
  | { k: 'ce'; id: string }
  | { k: 'de'; id: string }
  | { k: 'ra'; id: string; type: string; from: string; to: string; w: number }
  | { k: 'rd'; id: string }
  | { k: 'aa'; id: string; type: string; target: string; grantor: string; deps: string[]; effects: number }
  | { k: 'ad'; id: string };

interface Plan {
  /** 起手就把实体池全建出来，保证后续引用类 op 大多数时候是合法的。 */
  seedAll: boolean;
  ops: OpSpec[];
}

function pick<T>(rnd: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rnd() * xs.length)]!;
}

/**
 * 生成一条操作序列。
 *
 * 权重刻意偏向 destroyEntity 与两种 del：级联和索引清理是本层最容易
 * 出错的地方，而它们只在"目标真的存在"时才走到有意义的分支。
 */
function makePlan(rnd: () => number): Plan {
  const ops: OpSpec[] = [];
  const n = 1 + Math.floor(rnd() * OPS);
  for (let i = 0; i < n; i++) {
    const roll = rnd();
    // 端点大多数时候取自合法池，少数时候取畸形 id，让校验分支可达
    const ent = (): string => (rnd() < 0.12 ? pick(rnd, BAD_ENTS) : pick(rnd, ENTS));
    if (roll < 0.14) {
      ops.push({ k: 'ce', id: ent() });
    } else if (roll < 0.34) {
      ops.push({ k: 'de', id: ent() });
    } else if (roll < 0.56) {
      ops.push({
        k: 'ra', id: pick(rnd, RELS), type: pick(rnd, TYPES),
        from: ent(), to: ent(), w: Math.floor(rnd() * 3),
      });
    } else if (roll < 0.72) {
      ops.push({ k: 'rd', id: pick(rnd, RELS) });
    } else if (roll < 0.90) {
      const depCount = Math.floor(rnd() * 3);
      const deps: string[] = [];
      for (let d = 0; d < depCount; d++) {
        const cand = ent();
        if (!deps.includes(cand)) deps.push(cand);
      }
      ops.push({
        k: 'aa', id: pick(rnd, ATTS), type: rnd() < 0.5 ? 'aura' : 'curse',
        target: ent(), grantor: ent(), deps, effects: Math.floor(rnd() * 3),
      });
    } else {
      ops.push({ k: 'ad', id: pick(rnd, ATTS) });
    }
  }
  return { seedAll: rnd() < 0.8, ops };
}

/** 被测模块的最小接口。用结构类型避免把 src 的具体类型绑进来。 */
interface Sys {
  createEntity(id: string): unknown;
  destroyEntity(id: string): void;
  relation_add(id: string, type: string, from: string, to: string, attrs?: Record<string, unknown>): unknown;
  relation_del(id: string): void;
  attachment_add(def: {
    id: string; type: string; target: string; grantedBy: string;
    effects: Array<{ op: string; args: Record<string, unknown> }>; deps: string[];
  }): unknown;
  attachment_del(id: string): void;
  checkInvariants(): Array<{ code: string; detail: string }>;
  get(type: 'entity' | 'relation' | 'attachment', id: string): unknown;
  dump(): unknown;
}

interface Mod { RelationSystem: new () => Sys }

/** 稳定序列化：键排序，但**数组顺序原样保留**。 */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v instanceof Map) {
    return Object.fromEntries([...v.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([k, val]) => [k, canon(val)]));
  }
  if (v instanceof Set) return [...v];
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) out[k] = canon(o[k]);
    return out;
  }
  return v;
}

const show = (v: unknown): string => JSON.stringify(canon(v));

function tryRun(f: () => void): string {
  try { f(); return 'ok'; } catch (e) { return e instanceof Error ? e.message : String(e); }
}

/**
 * 把一条 plan 在给定模块上跑完，返回**单行观测串**。
 *
 * 观测面的四个部分，每一部分都有它非要不可的理由：
 *
 *  1. **每步错误码** —— 校验分支的唯一出口。
 *  2. **每步 dump 全量状态** —— 索引内容本身。只在末尾比一次状态是不够的：
 *     一次错误的索引写入可能被后续删除掩盖，逐步比才能定位到第一次分歧。
 *  3. **checkInvariants 的码与 detail** —— 检查器本身也是被测对象；
 *     只比状态不比违规列表，检查器改动就不可观测。
 *  4. **别名探针** —— 拷贝语义的唯一观测手段。改返回值再回读内部，
 *     若内部跟着变，说明共享引用。这一项让 clone* 系列的改动可见。
 */
function observe(mod: Mod, plan: Plan): string {
  const out: string[] = [];
  const sys = new mod.RelationSystem();

  if (plan.seedAll) {
    for (const e of ENTS) out.push(`seed:${e}=${tryRun(() => sys.createEntity(e))}`);
  }

  for (let i = 0; i < plan.ops.length; i++) {
    const op = plan.ops[i]!;
    let code = 'ok';
    switch (op.k) {
      case 'ce': code = tryRun(() => sys.createEntity(op.id)); break;
      case 'de': code = tryRun(() => sys.destroyEntity(op.id)); break;
      case 'ra': code = tryRun(() => sys.relation_add(op.id, op.type, op.from, op.to, { w: op.w })); break;
      case 'rd': code = tryRun(() => sys.relation_del(op.id)); break;
      case 'aa': {
        const effects = Array.from({ length: op.effects }, (_, k) => ({ op: `o${k}`, args: { n: k } }));
        code = tryRun(() => sys.attachment_add({
          id: op.id, type: op.type, target: op.target, grantedBy: op.grantor,
          effects, deps: [...op.deps],
        }));
        break;
      }
      case 'ad': code = tryRun(() => sys.attachment_del(op.id)); break;
    }
    out.push(`#${i}:${op.k}=${code}`);
    // 逐步比状态：一次错误写入可能被后续删除掩盖，只比末态会漏。
    out.push(`s${i}=${show(sys.dump())}`);
    out.push(`v${i}=${sys.checkInvariants().map((x) => `${x.code}@${x.detail}`).join(';') || 'ok'}`);
  }

  // ——— 别名探针 ———
  // 每一项都是"改外面那份，回读里面那份"。内部跟着变即为共享引用。
  const probe = new mod.RelationSystem();
  out.push(`p.ce=${tryRun(() => { probe.createEntity('x'); probe.createEntity('y'); })}`);

  // createEntity 的返回值
  const stub = probe.createEntity('z') as { rel: { out: Map<string, string[]> }; attachments: Set<string> };
  tryRun(() => { stub.rel.out.set('ally', ['伪造']); stub.attachments.add('伪造att'); });
  out.push(`p.stubAlias=${show(probe.get('entity', 'z'))}`);

  // relation_add 的入参 attrs 与返回值
  const attrs: Record<string, unknown> = { w: 1 };
  const rel = probe.relation_add('r0', 'ally', 'x', 'y', attrs) as
    { from: string; attrs: Record<string, unknown> };
  attrs['w'] = 999;
  attrs['injectedByCaller'] = true;
  tryRun(() => { rel.from = 'z'; rel.attrs['injectedByReturn'] = true; });
  out.push(`p.relAlias=${show(probe.get('relation', 'r0'))}`);

  // get 交出的 entity stub
  const got = probe.get('entity', 'x') as
    { rel: { out: Map<string, string[]>; in: Map<string, string[]> }; attachments: Set<string> } | undefined;
  if (got) {
    tryRun(() => {
      got.rel.out.get('ally')?.push('伪造');
      got.rel.in.set('enemy', ['伪造in']);
      got.attachments.add('伪造att');
    });
  }
  out.push(`p.getAlias=${show(probe.get('entity', 'x'))}`);
  out.push(`p.getAliasInv=${probe.checkInvariants().map((x) => x.code).join(';') || 'ok'}`);

  // attachment 的入参与返回值，含 effects 内层 args
  const def = {
    id: 'a0', type: 'aura', target: 'x', grantedBy: 'y',
    effects: [{ op: 'dmg', args: { n: 1 } as Record<string, unknown> }],
    deps: ['z'],
  };
  const attRet = probe.attachment_add(def) as {
    target: string; deps: string[]; effects: Array<{ args: Record<string, unknown> }>;
  };
  def.target = 'nope';
  def.deps.push('nope');
  def.effects[0]!.args['n'] = 111;
  tryRun(() => {
    attRet.target = 'nope2';
    attRet.deps.push('nope2');
    attRet.effects[0]!.args['n'] = 222;
  });
  out.push(`p.attAlias=${show(probe.get('attachment', 'a0'))}`);

  // dump 交出的容器
  const snap = probe.dump() as {
    relations: Record<string, { attrs: Record<string, unknown> }>;
    index: Record<string, { out: Record<string, string[]> }>;
  };
  tryRun(() => {
    const r = snap.relations['r0'];
    if (r) r.attrs['injectedByDump'] = true;
    const bucket = snap.index['x']?.out['ally'];
    if (bucket) bucket.push('伪造');
  });
  out.push(`p.dumpAlias=${show(probe.dump())}`);

  // get 的兜底分支：未知 type 必须是 undefined，不能是空对象
  const dyn = probe.get as unknown as (t: string, id: string) => unknown;
  out.push(`p.badType=${show(dyn('bogus', 'x'))}/${show(dyn('Entity', 'x'))}`);
  out.push(`p.missing=${show(probe.get('entity', '无'))}/${show(probe.get('relation', '无'))}/${show(probe.get('attachment', '无'))}`);

  // 索引桶顺序：同类型多条关系的插入顺序是可观测的
  const ord = new mod.RelationSystem();
  tryRun(() => {
    ord.createEntity('a'); ord.createEntity('b'); ord.createEntity('c');
    ord.relation_add('r0', 'ally', 'a', 'b');
    ord.relation_add('r1', 'ally', 'a', 'c');
    ord.relation_add('r2', 'ally', 'a', 'b');
  });
  out.push(`p.order=${show(ord.dump())}`);
  // 删中间一条后剩余顺序
  tryRun(() => ord.relation_del('r1'));
  out.push(`p.orderAfterDel=${show(ord.dump())}`);

  // 级联：一个实体同时是 target / grantedBy / dep / 自环端点
  const casc = new mod.RelationSystem();
  out.push(`p.cascade=${tryRun(() => {
    casc.createEntity('hub'); casc.createEntity('o1'); casc.createEntity('o2');
    casc.relation_add('r0', 'ally', 'hub', 'o1');
    casc.relation_add('r1', 'ally', 'o2', 'hub');
    casc.relation_add('r2', 'self', 'hub', 'hub');
    casc.attachment_add({ id: 'a0', type: 'aura', target: 'hub', grantedBy: 'o1', effects: [], deps: [] });
    casc.attachment_add({ id: 'a1', type: 'aura', target: 'o1', grantedBy: 'hub', effects: [], deps: [] });
    casc.attachment_add({ id: 'a2', type: 'aura', target: 'o2', grantedBy: 'o2', effects: [], deps: ['hub'] });
  })}`);
  out.push(`p.cascadeBefore=${show(casc.dump())}`);
  out.push(`p.cascadeDel=${tryRun(() => casc.destroyEntity('hub'))}`);
  out.push(`p.cascadeAfter=${show(casc.dump())}`);
  out.push(`p.cascadeInv=${casc.checkInvariants().map((x) => `${x.code}@${x.detail}`).join(';') || 'ok'}`);

  // 多 attachment 挂同一 target 后销毁：M15（边删边遍历）只在这里可能露出
  const multi = new mod.RelationSystem();
  out.push(`p.multi=${tryRun(() => {
    multi.createEntity('t'); multi.createEntity('g');
    for (let k = 0; k < 5; k++) {
      multi.attachment_add({ id: `a${k}`, type: 'aura', target: 't', grantedBy: 'g', effects: [], deps: [] });
    }
  })}`);
  out.push(`p.multiDel=${tryRun(() => multi.destroyEntity('t'))}`);
  out.push(`p.multiAfter=${show(multi.dump())}`);
  out.push(`p.multiInv=${multi.checkInvariants().map((x) => x.code).join(';') || 'ok'}`);

  // 多 attachment 互为 dep 后销毁 dep：级联在遍历中删掉**其他**元素
  const chain = new mod.RelationSystem();
  out.push(`p.chain=${tryRun(() => {
    chain.createEntity('d'); chain.createEntity('t'); chain.createEntity('g');
    for (let k = 0; k < 4; k++) {
      chain.attachment_add({ id: `a${k}`, type: 'aura', target: 't', grantedBy: 'g', effects: [], deps: ['d'] });
    }
    chain.attachment_add({ id: 'a9', type: 'aura', target: 'd', grantedBy: 'g', effects: [], deps: [] });
  })}`);
  out.push(`p.chainDel=${tryRun(() => chain.destroyEntity('d'))}`);
  out.push(`p.chainAfter=${show(chain.dump())}`);
  out.push(`p.chainInv=${chain.checkInvariants().map((x) => x.code).join(';') || 'ok'}`);

  // 重复 add 覆盖语义
  const dup = new mod.RelationSystem();
  out.push(`p.dup=${tryRun(() => {
    dup.createEntity('a'); dup.createEntity('b'); dup.createEntity('c');
    dup.relation_add('r0', 'ally', 'a', 'b');
    dup.relation_add('r0', 'enemy', 'b', 'c');
    dup.attachment_add({ id: 'a0', type: 'aura', target: 'a', grantedBy: 'b', effects: [], deps: [] });
    dup.attachment_add({ id: 'a0', type: 'curse', target: 'b', grantedBy: 'c', effects: [], deps: [] });
  })}`);
  out.push(`p.dupState=${show(dup.dump())}`);
  out.push(`p.dupInv=${dup.checkInvariants().map((x) => x.code).join(';') || 'ok'}`);
  out.push(`p.dupCe=${tryRun(() => dup.createEntity('a'))}`);
  out.push(`p.dupCeState=${show(dup.dump())}`);

  // 幂等：删两次
  const idem = new mod.RelationSystem();
  out.push(`p.idem=${tryRun(() => {
    idem.createEntity('a'); idem.createEntity('b');
    idem.relation_add('r0', 'ally', 'a', 'b');
    idem.attachment_add({ id: 'a0', type: 'aura', target: 'a', grantedBy: 'b', effects: [], deps: [] });
  })}`);
  out.push(`p.idemR1=${tryRun(() => idem.relation_del('r0'))}`);
  out.push(`p.idemR2=${tryRun(() => idem.relation_del('r0'))}`);
  out.push(`p.idemA1=${tryRun(() => idem.attachment_del('a0'))}`);
  out.push(`p.idemA2=${tryRun(() => idem.attachment_del('a0'))}`);
  out.push(`p.idemState=${show(idem.dump())}`);

  // ——— 损坏注入 ———
  //
  // 首版自检漏掉了 M51 / M52 / M69 三个哨兵，成因是结构性的：
  // 上面所有序列走的都是**合法状态**，而合法状态下每条不变量子句都返回空。
  // 于是"删掉一条报违规的子句"完全不可观测——不是断言不够细，
  // 是这个观测面里根本不存在能触发该子句的状态。
  //
  // 检查器是被测对象的一部分，要让它的每条子句可观测，就必须**造出违规状态**。
  // 合法 API 造不出来（产品是对的），只能绕过 Op 边界直接改内部表。
  // 每种损坏用一份新实例，避免互相干扰。
  out.push(`p.corrupt=${corruptionProbe(mod)}`);

  return out.join('|');
}

/** 内部表的最小视图，仅用于注入损坏。 */
interface Guts {
  entities: Map<string, { id: string; rel: { out: Map<string, string[]>; in: Map<string, string[]> }; attachments: Set<string> }>;
  relations: Map<string, { id: string; type: string; from: string; to: string; attrs: Record<string, unknown> }>;
  attachments: Map<string, { id: string; type: string; target: string; grantedBy: string; deps: string[] }>;
}

const guts = (s: Sys): Guts => s as unknown as Guts;

/**
 * 逐种损坏各造一份状态，把 checkInvariants 的**全部子句**变成可观测的。
 *
 * 覆盖的子句与对应损坏：
 *   正向 DANGLING       ← rel.from/to 指向不存在的实体；att 的 target/grantedBy/dep 悬空
 *   正向 ASYMMETRIC     ← 主表有关系但索引桶里没有（分别抽掉 out 侧与 in 侧）
 *   正向 INCONSISTENT   ← entity.attachments 里有主表查不到的 id
 *   反向 STALE_INDEX    ← 索引残留已删关系；索引项 from/to/type 与所在桶不符
 *   反向 DUPLICATE_INDEX← 同桶内同 id 出现两次（out 与 in 各一份）
 *   反向 INCONSISTENT   ← attachment 未登记在其 target 上
 *
 * 缺任何一种，对应子句的删除就成了"存活的等价变异体"——那是假结论。
 */
function corruptionProbe(mod: Mod): string {
  const parts: string[] = [];

  const fresh = (): Sys => {
    const s = new mod.RelationSystem();
    s.createEntity('e1'); s.createEntity('e2'); s.createEntity('e3');
    s.relation_add('r1', 'ally', 'e1', 'e2');
    s.attachment_add({ id: 'a1', type: 'aura', target: 'e1', grantedBy: 'e2', effects: [], deps: ['e3'] });
    return s;
  };
  const codes = (s: Sys): string =>
    s.checkInvariants().map((v) => `${v.code}@${v.detail}`).sort().join(';') || 'ok';

  // 基线：干净状态必须无违规。这一条防止"检查器恒报违规"被当成等价。
  parts.push(`clean=${codes(fresh())}`);

  const cases: Array<[string, (s: Sys) => void]> = [
    ['relFromMissing', (s) => { guts(s).relations.get('r1')!.from = '无此实体'; }],
    ['relToMissing', (s) => { guts(s).relations.get('r1')!.to = '无此实体'; }],
    // 只抽 out 侧：M51（不报 out 缺失）与 M52（不报 in 缺失）必须分别可见
    ['outIndexMissing', (s) => { guts(s).entities.get('e1')!.rel.out.set('ally', []); }],
    ['inIndexMissing', (s) => { guts(s).entities.get('e2')!.rel.in.set('ally', []); }],
    ['bothIndexMissing', (s) => {
      guts(s).entities.get('e1')!.rel.out.set('ally', []);
      guts(s).entities.get('e2')!.rel.in.set('ally', []);
    }],
    // 主表删掉、索引留着：反向 STALE_INDEX（两侧各一条）
    ['staleBothSides', (s) => { guts(s).relations.delete('r1'); }],
    // 索引项的 from 与所在实体不符
    ['staleWrongFrom', (s) => { guts(s).entities.get('e3')!.rel.out.set('ally', ['r1']); }],
    ['staleWrongTo', (s) => { guts(s).entities.get('e3')!.rel.in.set('ally', ['r1']); }],
    // 索引桶键与关系自身的 type 不符
    ['staleWrongType', (s) => {
      const e1 = guts(s).entities.get('e1')!;
      e1.rel.out.set('ally', []);
      e1.rel.out.set('enemy', ['r1']);
    }],
    ['dupOut', (s) => { guts(s).entities.get('e1')!.rel.out.get('ally')!.push('r1'); }],
    ['dupIn', (s) => { guts(s).entities.get('e2')!.rel.in.get('ally')!.push('r1'); }],
    ['attTargetMissing', (s) => { guts(s).attachments.get('a1')!.target = '无此实体'; }],
    ['attGrantorMissing', (s) => { guts(s).attachments.get('a1')!.grantedBy = '无此实体'; }],
    ['attDepMissing', (s) => { guts(s).attachments.get('a1')!.deps = ['无此实体']; }],
    ['attNotInMap', (s) => { guts(s).entities.get('e1')!.attachments.add('无此att'); }],
    ['attNotRegistered', (s) => { guts(s).entities.get('e1')!.attachments.delete('a1'); }],
    // 多重损坏：子句之间不得互相吞掉
    ['multi', (s) => {
      const g = guts(s);
      g.relations.get('r1')!.from = '无此实体';
      g.entities.get('e3')!.rel.in.set('ally', ['r1']);
      g.entities.get('e1')!.attachments.add('无此att');
      g.attachments.get('a1')!.grantedBy = '无此实体';
    }],
  ];

  for (const [name, corrupt] of cases) {
    const s = fresh();
    let r: string;
    try { corrupt(s); r = codes(s); } catch (e) {
      r = `THROW:${e instanceof Error ? e.message : String(e)}`;
    }
    parts.push(`${name}=${r}`);
  }

  return parts.join('&');
}

async function importFresh(dir: string): Promise<Mod> {
  const url = new URL(`file:///${path.join(dir, 'relation.ts').replace(/\\/g, '/')}`).href;
  // 查询串是缓存旁路：ESM 的模块缓存以 URL 为键，不加它会拿到上一次的副本。
  const mod = await import(`${url}?t=${Date.now()}${Math.random()}`);
  return mod as Mod;
}

/** 把变异体写进一份**独立目录**，避免动到 src/ 本体。 */
function materialize(mutant: Mutant, tag: string): string {
  const dir = path.join(ROOT, 'src', `__equiv_${tag}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let text = fs.readFileSync(path.join(SRC, 'relation.ts'), 'utf8');
  const hits = text.split(mutant.find).length - 1;
  if (hits !== 1) throw new Error(`${mutant.id} 的 find 命中 ${hits} 次（要求 1 次）`);
  text = text.replace(mutant.find, mutant.replace);
  fs.writeFileSync(path.join(dir, 'relation.ts'), text, 'utf8');
  return dir;
}

/** 基线也走同一条 materialize 路径，排除"目录位置本身造成差异"。 */
function materializeBase(): string {
  const dir = path.join(ROOT, 'src', '__equiv_base');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(SRC, 'relation.ts'), path.join(dir, 'relation.ts'));
  return dir;
}

interface DiffResult { diverged: boolean; step: number; detail: string }

async function diff(mutant: Mutant, base: Mod, seqs: number): Promise<DiffResult> {
  const dir = materialize(mutant, mutant.id);
  try {
    const mutated = await importFresh(dir);
    for (let i = 0; i < seqs; i++) {
      // 两侧各自从同一种子重新生成 plan：共用一个 plan 对象会让
      // 第一侧对 plan 的任何意外改动污染第二侧。
      const planA = makePlan(mulberry32(i + 1));
      const planB = makePlan(mulberry32(i + 1));
      let a: string;
      let b: string;
      try { a = observe(base, planA); } catch (e) {
        a = `HARD_THROW:${e instanceof Error ? e.message : String(e)}`;
      }
      try { b = observe(mutated, planB); } catch (e) {
        b = `HARD_THROW:${e instanceof Error ? e.message : String(e)}`;
      }
      if (a !== b) return { diverged: true, step: i + 1, detail: firstDiff(a, b) };
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
    if (fa[i] !== fb[i]) {
      return `字段#${i} 原=${(fa[i] ?? '<缺>').slice(0, 100)} 变=${(fb[i] ?? '<缺>').slice(0, 100)}`;
    }
  }
  return '长度不同';
}

/**
 * 哨兵：**已知不等价**的变异体，用于检验模糊器本身有分辨力。
 *
 * 选取原则：必须与待证目标落在同一段代码上。抓到了别处的变异
 * 不能证明"这里看得见"。
 *
 * 待证目标及其所在代码块，每块都必须有同块哨兵：
 *
 *  - destroyEntity 的级联体（M14 先删实体再级联、M15 不快照 attachments、
 *    M95 快照写法改 Array.from）
 *      → 哨兵 M06 M08 M09 M12 M13：同一段级联内的已知不等价改动
 *  - relation_add 的签名与 attrs 默认值（M93）
 *      → 哨兵 M20 M22 M24：同一函数内的拷贝语义与索引写入改动
 *  - dump 的遍历（M94）
 *      → 哨兵 M78 M80 M81：同一函数内的排序/字段改动
 *  - checkInvariants 的 hasIn 判据行（M96 只删空格）
 *      → 哨兵 M51 M52 M69：同一段判据内的已知不等价改动
 */
const SENTINELS = [
  // destroyEntity 级联体
  'M06', 'M08', 'M09', 'M12', 'M13',
  // relation_add
  'M20', 'M22', 'M24',
  // dump
  'M78', 'M80', 'M81',
  // checkInvariants 判据段
  'M51', 'M52', 'M69',
];

/**
 * 额外待判定目标（尚未标 expectEquivalent，本轮要给出结论的）。
 * M14 / M15 已在首轮判定为等价并写回清单，故此处为空——
 * 保留这个入口是为了下一轮有存活者时能直接判定，不必改结构。
 */
const EXTRA_TARGETS: string[] = [];

function cleanup(): void {
  for (const d of fs.readdirSync(SRC, { withFileTypes: true })) {
    if (d.isDirectory() && d.name.startsWith('__equiv_')) {
      fs.rmSync(path.join(SRC, d.name), { recursive: true, force: true });
    }
  }
}

async function main(): Promise<boolean> {
  cleanup();
  const baseDir = materializeBase();
  const base = await importFresh(baseDir);
  const byId = new Map(MUTANTS.map((m) => [m.id, m]));

  const targets = [
    ...MUTANTS.filter((m) => m.expectEquivalent),
    ...EXTRA_TARGETS.map((id) => byId.get(id)).filter((m): m is Mutant => Boolean(m)),
  ];

  process.stdout.write(`观测面自检：先跑 ${SENTINELS.length} 个已知不等价的哨兵。\n`);
  process.stdout.write(`（抓不到哨兵 ⇒ 模糊器没分辨力 ⇒ 任何"等价"结论都不成立）\n\n`);

  let selfTestOk = true;
  for (const id of SENTINELS) {
    const m = byId.get(id);
    if (!m) { process.stdout.write(`  ${id} 缺失：清单里没有这个 id\n`); selfTestOk = false; continue; }
    const r = await diff(m, base, SENTINEL_SEQS);
    if (r.diverged) {
      process.stdout.write(`  ${id} 抓到  第 ${r.step} 步  ${m.desc}\n`);
    } else {
      process.stdout.write(`  ${id} 漏检!!  跑满 ${SENTINEL_SEQS} 步无差异  ${m.desc}\n`);
      selfTestOk = false;
    }
  }

  if (!selfTestOk) {
    process.stdout.write('\n自检未通过：模糊器存在盲区，先扩观测面/生成器，再谈等价性。\n');
    cleanup();
    return false;
  }
  process.stdout.write(`\n自检通过 ${SENTINELS.length}/${SENTINELS.length}。开始判定目标。\n\n`);

  const results: Array<{ id: string; desc: string; equivalent: boolean; step: number; detail: string }> = [];
  for (const m of targets) {
    const r = await diff(m, base, SEQS);
    results.push({ id: m.id, desc: m.desc, equivalent: !r.diverged, step: r.step, detail: r.detail });
    if (r.diverged) {
      process.stdout.write(`  ${m.id} **不等价**  第 ${r.step} 步分歧\n      ${r.detail}\n      ${m.desc}\n`);
    } else {
      process.stdout.write(`  ${m.id} 等价（${SEQS} 条序列无差异）  ${m.desc}\n`);
    }
  }

  fs.writeFileSync(
    path.join(ROOT, 'mutation', 'equivalence-result.json'),
    JSON.stringify({
      seqs: SEQS, opsMax: OPS, sentinelSeqs: SENTINEL_SEQS,
      sentinels: SENTINELS, selfTestPassed: selfTestOk, results,
    }, null, 2),
    'utf8',
  );

  cleanup();

  const proven = results.filter((r) => r.equivalent);
  const refuted = results.filter((r) => !r.equivalent);
  process.stdout.write('\n========================================\n');
  process.stdout.write(`哨兵自检：${SENTINELS.length}/${SENTINELS.length} 全部抓到\n`);
  process.stdout.write(`判定目标：${results.length}  证明等价：${proven.length}  证伪：${refuted.length}\n`);

  if (refuted.length > 0) {
    process.stdout.write('\n以下变异体**不等价**，若清单里标了 expectEquivalent 则标注有误；\n');
    process.stdout.write('若来自存活名单，则说明它是真盲区，需要补断言：\n');
    for (const r of refuted) process.stdout.write(`  ${r.id}  ${r.desc}\n`);
  }

  // 标了 expectEquivalent 却被证伪 ⇒ 标注错误，必须失败退出。
  const misLabeled = refuted.filter((r) => byId.get(r.id)?.expectEquivalent);
  return misLabeled.length === 0;
}

main().then(
  (ok) => process.exit(ok ? 0 : 1),
  (e) => { cleanup(); process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`); process.exit(1); },
);

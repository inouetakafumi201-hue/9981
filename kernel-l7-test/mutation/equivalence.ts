// 等价性证明器。
//
// 变异测试里有 3 个变异体存活（M53/M54/M55），它们都是把
//   for (const x of [...collection])   →   for (const x of collection)
// 即去掉迭代前的快照。我的判断是这三个在语义上等价，因为 JS 的 Map/Set 迭代器
// 允许删除"已经产出过"的元素而不影响后续遍历。
//
// 但"我判断等价"不算证据。这个脚本用代码证明：对同一批随机操作序列，
// 原实现与变异实现的完整状态逐字段一致。若真存在差异，fuzz 会把它找出来。
//
// 做法：把每个变异体写成独立的 .ts 文件，动态 import，然后对两份实现
// 施加完全相同的操作序列，每步之后比对规范化状态。

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { MUTANTS } from './mutants';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src', 'topology.ts');
const OUT_DIR = path.join(ROOT, 'mutation', 'equiv');

const SCENES = ['S0', 'S1', 'S2', 'S3', 'S4'];
const NODES = ['N0', 'N1', 'N2', 'N3', 'N4', 'N5'];
const LINKS = ['L0', 'L1', 'L2', 'L3'];
const ENTS = ['E0', 'E1', 'E2'];

type Op =
  | { t: 'sc'; s: number; p: number; useParent: boolean }
  | { t: 'sd'; s: number }
  | { t: 'nc'; s: number; n: number }
  | { t: 'nd'; n: number }
  | { t: 'lc'; s: number; l: number; f: number; to: number; dir: boolean }
  | { t: 'ld'; l: number }
  | { t: 'ep'; n: number; e: number }
  | { t: 'er'; e: number }
  | { t: 'em'; e: number; n: number };

/** 确定性 PRNG（mulberry32），保证失败可复现。 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function genOps(rand: () => number, count: number): Op[] {
  const pick = (n: number) => Math.floor(rand() * n);
  const ops: Op[] = [];
  for (let i = 0; i < count; i++) {
    const r = pick(9);
    switch (r) {
      case 0: ops.push({ t: 'sc', s: pick(SCENES.length), p: pick(SCENES.length), useParent: rand() < 0.6 }); break;
      case 1: ops.push({ t: 'sd', s: pick(SCENES.length) }); break;
      case 2: ops.push({ t: 'nc', s: pick(SCENES.length), n: pick(NODES.length) }); break;
      case 3: ops.push({ t: 'nd', n: pick(NODES.length) }); break;
      case 4: ops.push({ t: 'lc', s: pick(SCENES.length), l: pick(LINKS.length), f: pick(NODES.length), to: pick(NODES.length), dir: rand() < 0.5 }); break;
      case 5: ops.push({ t: 'ld', l: pick(LINKS.length) }); break;
      case 6: ops.push({ t: 'ep', n: pick(NODES.length), e: pick(ENTS.length) }); break;
      case 7: ops.push({ t: 'er', e: pick(ENTS.length) }); break;
      default: ops.push({ t: 'em', e: pick(ENTS.length), n: pick(NODES.length) }); break;
    }
  }
  return ops;
}

/** 施加一个操作，返回错误码（或 null）。任何异常都被捕获并归一化为字符串。 */
function apply(sys: any, op: Op): string | null {
  try {
    switch (op.t) {
      case 'sc': sys.scene_create(SCENES[op.s], op.useParent ? SCENES[op.p] : undefined); break;
      case 'sd': sys.scene_delete(SCENES[op.s]); break;
      case 'nc': sys.node_create(SCENES[op.s], NODES[op.n]); break;
      case 'nd': sys.node_delete(NODES[op.n]); break;
      case 'lc': sys.link_create(SCENES[op.s], LINKS[op.l], NODES[op.f], NODES[op.to], op.dir); break;
      case 'ld': sys.link_delete(LINKS[op.l]); break;
      case 'ep': sys.entity_place(NODES[op.n], ENTS[op.e]); break;
      case 'er': sys.entity_remove(ENTS[op.e]); break;
      case 'em': sys.entity_move(ENTS[op.e], NODES[op.n]); break;
    }
    return null;
  } catch (e: any) {
    return String(e?.message ?? e);
  }
}

/** 规范化全量状态：任何内部结构差异都会体现在这个字符串里。 */
function canonical(sys: any): string {
  const parts: string[] = [];
  for (const sid of SCENES) {
    const sc = sys.getScene(sid);
    if (!sc) { parts.push(`S ${sid}:absent`); continue; }
    parts.push(
      `S ${sid} parent=${sc.parentId}` +
      ` children=[${[...sc.childScenes].sort().join(',')}]` +
      ` nodes=[${[...sc.nodes.keys()].sort().join(',')}]` +
      ` links=[${[...sc.links.keys()].sort().join(',')}]`
    );
  }
  for (const nid of NODES) {
    const n = sys.getNode(nid);
    if (!n) { parts.push(`N ${nid}:absent`); continue; }
    parts.push(
      `N ${nid} scene=${n.sceneId}` +
      ` links=[${[...n.links].sort().join(',')}]` +
      ` ents=[${[...n.entities].sort().join(',')}]`
    );
  }
  for (const lid of LINKS) {
    const l = sys.getLink(lid);
    parts.push(l ? `L ${lid} ${l.from}->${l.to} dir=${l.directed} scene=${l.sceneId}` : `L ${lid}:absent`);
  }
  for (const eid of ENTS) {
    parts.push(`E ${eid} at=${sys.entity_locate(eid) ?? 'none'}`);
  }
  // 不变量结果也纳入比对：变异体若引入违反，这里就会不同
  const viol = sys.checkInvariants().map((v: any) => `${v.code}:${v.detail}`).sort();
  parts.push(`INV [${viol.join(' | ')}]`);
  return parts.join('\n');
}

async function main() {
  const equivalents = MUTANTS.filter((m) => m.expectEquivalent);
  if (equivalents.length === 0) {
    console.log('没有标记为预期等价的变异体');
    return;
  }

  const original = fs.readFileSync(SRC, 'utf8');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 生成每个变异体的独立源文件
  const generated: Array<{ id: string; desc: string; file: string }> = [];
  for (const m of equivalents) {
    const occurrences = original.split(m.find).length - 1;
    if (occurrences !== 1) {
      console.error(`${m.id} INVALID: find 出现 ${occurrences} 次，跳过`);
      continue;
    }
    const mutated = original.replace(m.find, m.replace);
    const file = path.join(OUT_DIR, `topology.${m.id}.ts`);
    fs.writeFileSync(file, mutated, 'utf8');
    generated.push({ id: m.id, desc: m.desc, file });
  }

  const SEQ_COUNT = Number(process.env.EQUIV_SEQS ?? 20000);
  const OPS_PER_SEQ = Number(process.env.EQUIV_OPS ?? 60);

  console.log(`等价性证明：${generated.length} 个变异体 × ${SEQ_COUNT} 条序列 × ${OPS_PER_SEQ} 操作`);
  console.log('比对内容：每步操作后的错误码 + 完整规范化状态（含 checkInvariants 输出）\n');

  const origMod = await import(pathToImportUrl(SRC));
  const OrigClass = origMod.TopologySystem;

  let allEquivalent = true;
  const results: Array<{ id: string; desc: string; equivalent: boolean; counterexample?: string }> = [];

  for (const g of generated) {
    const mod = await import(pathToImportUrl(g.file));
    const MutClass = mod.TopologySystem;

    let diff: string | null = null;

    for (let seed = 1; seed <= SEQ_COUNT && diff === null; seed++) {
      const ops = genOps(rng(seed), OPS_PER_SEQ);
      const a = new OrigClass();
      const b = new MutClass();

      for (let i = 0; i < ops.length; i++) {
        const errA = apply(a, ops[i]);
        const errB = apply(b, ops[i]);
        if (errA !== errB) {
          diff = `seed=${seed} step=${i} op=${JSON.stringify(ops[i])}\n  原实现错误码: ${errA}\n  变异体错误码: ${errB}`;
          break;
        }
        const ca = canonical(a);
        const cb = canonical(b);
        if (ca !== cb) {
          diff = `seed=${seed} step=${i} op=${JSON.stringify(ops[i])}\n  状态出现差异:\n--- 原实现 ---\n${ca}\n--- 变异体 ---\n${cb}`;
          break;
        }
      }
    }

    const equivalent = diff === null;
    if (!equivalent) allEquivalent = false;
    results.push({ id: g.id, desc: g.desc, equivalent, counterexample: diff ?? undefined });

    if (equivalent) {
      console.log(`${g.id}  等价  ${g.desc}`);
      console.log(`       ↳ ${SEQ_COUNT * OPS_PER_SEQ} 次操作全部一致，无反例`);
    } else {
      console.log(`${g.id}  不等价（存在可观测差异）  ${g.desc}`);
      console.log(diff!.split('\n').map((l) => '       ' + l).join('\n'));
    }
  }

  fs.writeFileSync(
    path.join(ROOT, 'mutation', 'equivalence-result.json'),
    JSON.stringify({ seqCount: SEQ_COUNT, opsPerSeq: OPS_PER_SEQ, results }, null, 2),
    'utf8'
  );

  console.log('\n' + '='.repeat(70));
  if (allEquivalent) {
    console.log(`结论：全部 ${generated.length} 个存活变异体已证明为语义等价变异体。`);
    console.log('它们的存活不是测试盲区 —— 任何测试都不可能杀死它们，因为可观测行为完全相同。');
  } else {
    console.log('结论：存在被误判为等价的变异体，上方反例即为测试盲区，必须补测试。');
  }
  console.log('='.repeat(70));

  return allEquivalent;
}

function pathToImportUrl(p: string): string {
  return 'file:///' + p.replace(/\\/g, '/');
}

function cleanup() {
  // 清理生成的变异体源文件，不留残留物
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
}

main()
  .then((ok) => {
    cleanup();
    process.exit(ok ? 0 : 1);
  })
  .catch((e) => {
    cleanup();
    console.error(e);
    process.exit(1);
  });

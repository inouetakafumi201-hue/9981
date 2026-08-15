// 模型对照属性测试：用独立实现的影子模型作为 oracle，小 ID 池强制碰撞。
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { TopologySystem } from '../src/topology';

const E_REF = 'E_REF_INVALID';
const E_DUP = 'E_ID_DUPLICATE';
const E_CROSS = 'E_LINK_CROSS_SCENE';
const E_NOT_PLACED = 'E_ENTITY_NOT_PLACED';
const E_NOT_ADJ = 'E_NOT_ADJACENT';

interface MNode { id: string; sceneId: string; links: Set<string>; entities: Set<string>; }
interface MLink { id: string; sceneId: string; from: string; to: string; directed: boolean; }
interface MScene { id: string; parentId: string | null; children: Set<string>; nodes: Set<string>; links: Set<string>; }

/** 影子模型：与被测实现无共享代码，独立表达 L7 语义契约。 */
class Model {
  scenes = new Map<string, MScene>();
  nodes = new Map<string, MNode>();
  links = new Map<string, MLink>();
  entities = new Map<string, string>();

  scene_create(id: string, parentId?: string): void {
    if (this.scenes.has(id)) throw new Error(E_DUP);
    if (parentId !== undefined && !this.scenes.has(parentId)) throw new Error(E_REF);
    this.scenes.set(id, {
      id, parentId: parentId ?? null,
      children: new Set(), nodes: new Set(), links: new Set()
    });
    if (parentId !== undefined) this.scenes.get(parentId)!.children.add(id);
  }

  scene_delete(id: string): void {
    const sc = this.scenes.get(id);
    if (!sc) throw new Error(E_REF);
    for (const c of [...sc.children]) if (this.scenes.has(c)) this.scene_delete(c);
    for (const n of [...sc.nodes]) if (this.nodes.has(n)) this.node_delete(n);
    for (const l of [...sc.links]) this.link_delete(l);
    this.scenes.delete(id);
    if (sc.parentId !== null) this.scenes.get(sc.parentId)?.children.delete(id);
  }

  node_create(sceneId: string, nodeId: string): void {
    const sc = this.scenes.get(sceneId);
    if (!sc) throw new Error(E_REF);
    if (this.nodes.has(nodeId)) throw new Error(E_DUP);
    this.nodes.set(nodeId, { id: nodeId, sceneId, links: new Set(), entities: new Set() });
    sc.nodes.add(nodeId);
  }
  node_delete(nodeId: string): void {
    const n = this.nodes.get(nodeId);
    if (!n) throw new Error(E_REF);
    for (const l of [...n.links]) this.link_delete(l);
    for (const e of [...n.entities]) this.entities.delete(e);
    this.nodes.delete(nodeId);
    this.scenes.get(n.sceneId)?.nodes.delete(nodeId);
  }

  link_create(sceneId: string, linkId: string, from: string, to: string, directed: boolean): void {
    const sc = this.scenes.get(sceneId);
    if (!sc) throw new Error(E_REF);
    if (this.links.has(linkId)) throw new Error(E_DUP);
    const f = this.nodes.get(from);
    if (!f) throw new Error(E_REF);
    const t = this.nodes.get(to);
    if (!t) throw new Error(E_REF);
    if (f.sceneId !== sceneId || t.sceneId !== sceneId) throw new Error(E_CROSS);
    this.links.set(linkId, { id: linkId, sceneId, from, to, directed });
    f.links.add(linkId);
    t.links.add(linkId);
    sc.links.add(linkId);
  }

  link_delete(linkId: string): void {
    const l = this.links.get(linkId);
    if (!l) return;
    this.links.delete(linkId);
    this.nodes.get(l.from)?.links.delete(linkId);
    this.nodes.get(l.to)?.links.delete(linkId);
    this.scenes.get(l.sceneId)?.links.delete(linkId);
  }

  entity_place(nodeId: string, entityId: string): void {
    const n = this.nodes.get(nodeId);
    if (!n) throw new Error(E_REF);
    const prev = this.entities.get(entityId);
    if (prev !== undefined && prev !== nodeId) this.nodes.get(prev)?.entities.delete(entityId);
    n.entities.add(entityId);
    this.entities.set(entityId, nodeId);
  }

  entity_remove(entityId: string): void {
    const nodeId = this.entities.get(entityId);
    if (nodeId === undefined) return;
    this.nodes.get(nodeId)?.entities.delete(entityId);
    this.entities.delete(entityId);
  }

  entity_move(entityId: string, toNodeId: string): void {
    const from = this.entities.get(entityId);
    if (from === undefined) throw new Error(E_NOT_PLACED);
    if (!this.nodes.has(toNodeId)) throw new Error(E_REF);
    if (from !== toNodeId && !this.are_adjacent(from, toNodeId)) throw new Error(E_NOT_ADJ);
    this.entity_place(toNodeId, entityId);
  }

  are_adjacent(a: string, b: string): boolean {
    const n = this.nodes.get(a);
    if (!n || !this.nodes.has(b)) return false;
    for (const lid of n.links) {
      const l = this.links.get(lid);
      if (!l) continue;
      if (l.from === a && l.to === b) return true;
      if (!l.directed && l.to === a && l.from === b) return true;
    }
    return false;
  }

  /** 规范化全量结构，用于与被测实现逐字段比对。 */
  canon(): string {
    const scenes = [...this.scenes.values()]
      .sort((x, y) => x.id.localeCompare(y.id))
      .map(s => `S:${s.id}|p=${s.parentId}|c=${[...s.children].sort().join(',')}` +
        `|n=${[...s.nodes].sort().join(',')}|l=${[...s.links].sort().join(',')}`);
    const nodes = [...this.nodes.values()]
      .sort((x, y) => x.id.localeCompare(y.id))
      .map(n => `N:${n.id}|s=${n.sceneId}|l=${[...n.links].sort().join(',')}|e=${[...n.entities].sort().join(',')}`);
    const links = [...this.links.values()]
      .sort((x, y) => x.id.localeCompare(y.id))
      .map(l => `L:${l.id}|s=${l.sceneId}|${l.from}->${l.to}|d=${l.directed}`);
    const ents = [...this.entities.entries()]
      .sort((x, y) => x[0].localeCompare(y[0]))
      .map(([e, n]) => `E:${e}@${n}`);
    return [...scenes, ...nodes, ...links, ...ents].join('\n');
  }
}

/** 从被测实现导出同格式规范化结构。 */
function canonSys(sys: TopologySystem, ids: Pools): string {
  const scenes: string[] = [], nodes: string[] = [], links: string[] = [], ents: string[] = [];
  for (const id of [...ids.scenes].sort()) {
    const s = sys.getScene(id);
    if (!s) continue;
    scenes.push(`S:${s.id}|p=${s.parentId}|c=${[...s.childScenes].sort().join(',')}` +
      `|n=${[...s.nodes.keys()].sort().join(',')}|l=${[...s.links.keys()].sort().join(',')}`);
  }
  for (const id of [...ids.nodes].sort()) {
    const n = sys.getNode(id);
    if (!n) continue;
    nodes.push(`N:${n.id}|s=${n.sceneId}|l=${[...n.links].sort().join(',')}|e=${[...n.entities].sort().join(',')}`);
  }
  for (const id of [...ids.links].sort()) {
    const l = sys.getLink(id);
    if (!l) continue;
    links.push(`L:${l.id}|s=${l.sceneId}|${l.from}->${l.to}|d=${l.directed}`);
  }
  for (const e of [...ids.entities].sort()) {
    const at = sys.entity_locate(e);
    if (at !== undefined) ents.push(`E:${e}@${at}`);
  }
  return [...scenes, ...nodes, ...links, ...ents].join('\n');
}

interface Pools { scenes: string[]; nodes: string[]; links: string[]; entities: string[]; }

// 小 ID 池：强制 ID 碰撞、重复创建、悬空引用等边界大量出现
const POOLS: Pools = {
  scenes: ['S0', 'S1', 'S2', 'S3', 'S4', 'S5'],
  nodes: ['N0', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7'],
  links: ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'],
  entities: ['E0', 'E1', 'E2', 'E3']
};

type Op =
  | { t: 'sc'; id: number; parent: number; noParent: boolean }
  | { t: 'sd'; id: number }
  | { t: 'nc'; scene: number; id: number }
  | { t: 'nd'; id: number }
  | { t: 'lc'; scene: number; id: number; from: number; to: number; directed: boolean }
  | { t: 'ld'; id: number }
  | { t: 'ep'; node: number; ent: number }
  | { t: 'er'; ent: number }
  | { t: 'em'; ent: number; node: number };

const sIdx = () => fc.integer({ min: 0, max: POOLS.scenes.length - 1 });
const nIdx = () => fc.integer({ min: 0, max: POOLS.nodes.length - 1 });
const lIdx = () => fc.integer({ min: 0, max: POOLS.links.length - 1 });
const eIdx = () => fc.integer({ min: 0, max: POOLS.entities.length - 1 });

const genOp = (): fc.Arbitrary<Op> => fc.oneof(
  fc.record({ t: fc.constant('sc' as const), id: sIdx(), parent: sIdx(), noParent: fc.boolean() }),
  fc.record({ t: fc.constant('sd' as const), id: sIdx() }),
  fc.record({ t: fc.constant('nc' as const), scene: sIdx(), id: nIdx() }),
  fc.record({ t: fc.constant('nd' as const), id: nIdx() }),
  fc.record({ t: fc.constant('lc' as const), scene: sIdx(), id: lIdx(), from: nIdx(), to: nIdx(), directed: fc.boolean() }),
  fc.record({ t: fc.constant('ld' as const), id: lIdx() }),
  fc.record({ t: fc.constant('ep' as const), node: nIdx(), ent: eIdx() }),
  fc.record({ t: fc.constant('er' as const), ent: eIdx() }),
  fc.record({ t: fc.constant('em' as const), ent: eIdx(), node: nIdx() })
);

type Target = TopologySystem | Model;

/** 对同一个 Op，在目标上执行；返回抛出的错误码或 null。 */
function apply(target: Target, op: Op): string | null {
  const S = POOLS.scenes, N = POOLS.nodes, L = POOLS.links, E = POOLS.entities;
  try {
    switch (op.t) {
      case 'sc': target.scene_create(S[op.id], op.noParent ? undefined : S[op.parent]); break;
      case 'sd': target.scene_delete(S[op.id]); break;
      case 'nc': target.node_create(S[op.scene], N[op.id]); break;
      case 'nd': target.node_delete(N[op.id]); break;
      case 'lc': target.link_create(S[op.scene], L[op.id], N[op.from], N[op.to], op.directed); break;
      case 'ld': target.link_delete(L[op.id]); break;
      case 'ep': target.entity_place(N[op.node], E[op.ent]); break;
      case 'er': target.entity_remove(E[op.ent]); break;
      case 'em': target.entity_move(E[op.ent], N[op.node]); break;
    }
    return null;
  } catch (e: any) {
    return e?.message ?? 'UNKNOWN';
  }
}

function describeOp(op: Op): string {
  const S = POOLS.scenes, N = POOLS.nodes, L = POOLS.links, E = POOLS.entities;
  switch (op.t) {
    case 'sc': return `scene_create(${S[op.id]}, ${op.noParent ? 'undefined' : S[op.parent]})`;
    case 'sd': return `scene_delete(${S[op.id]})`;
    case 'nc': return `node_create(${S[op.scene]}, ${N[op.id]})`;
    case 'nd': return `node_delete(${N[op.id]})`;
    case 'lc': return `link_create(${S[op.scene]}, ${L[op.id]}, ${N[op.from]}, ${N[op.to]}, ${op.directed})`;
    case 'ld': return `link_delete(${L[op.id]})`;
    case 'ep': return `entity_place(${N[op.node]}, ${E[op.ent]})`;
    case 'er': return `entity_remove(${E[op.ent]})`;
    case 'em': return `entity_move(${E[op.ent]}, ${N[op.node]})`;
  }
}

const RUNS = Number(process.env.L7_RUNS ?? 100000);

describe('L7: 模型对照 (小ID池, 强制碰撞)', () => {

  it(`任意操作序列：不变量恒成立 + 与影子模型逐字段一致 (${RUNS} 次)`, () => {
    fc.assert(
      fc.property(fc.array(genOp(), { minLength: 1, maxLength: 30 }), (ops) => {
        const sys = new TopologySystem();
        const mdl = new Model();

        for (let i = 0; i < ops.length; i++) {
          const op = ops[i];
          const sysErr = apply(sys, op);
          const mdlErr = apply(mdl, op);

          if (sysErr !== mdlErr) {
            throw new Error(
              `错误码不一致 @op#${i} ${describeOp(op)}\n` +
              `  实现=${sysErr} 模型=${mdlErr}\n序列:\n  ${ops.slice(0, i + 1).map(describeOp).join('\n  ')}`
            );
          }

          const v = sys.checkInvariants();
          if (v.length > 0) {
            throw new Error(
              `不变量违反 @op#${i} ${describeOp(op)}\n` +
              `  ${v.map(x => `${x.code}: ${x.detail}`).join('\n  ')}\n` +
              `序列:\n  ${ops.slice(0, i + 1).map(describeOp).join('\n  ')}`
            );
          }
        }

        const a = canonSys(sys, POOLS);
        const b = mdl.canon();
        if (a !== b) {
          throw new Error(`结构不一致\n实现:\n${a}\n模型:\n${b}\n序列:\n  ${ops.map(describeOp).join('\n  ')}`);
        }
        return true;
      }),
      { numRuns: RUNS, verbose: false }
    );
  });

  it(`查询一致性：are_adjacent / neighbors 与模型一致 (${Math.min(RUNS, 20000)} 次)`, () => {
    fc.assert(
      fc.property(fc.array(genOp(), { minLength: 1, maxLength: 25 }), (ops) => {
        const sys = new TopologySystem();
        const mdl = new Model();
        for (const op of ops) { apply(sys, op); apply(mdl, op); }

        for (const a of POOLS.nodes) {
          for (const b of POOLS.nodes) {
            if (sys.are_adjacent(a, b) !== mdl.are_adjacent(a, b)) {
              throw new Error(`are_adjacent(${a},${b}) 实现=${sys.are_adjacent(a, b)} 模型=${mdl.are_adjacent(a, b)}`);
            }
          }
          // neighbors 必须与 are_adjacent 自洽
          const nb = [...sys.neighbors(a)].sort();
          const expected = POOLS.nodes.filter(b => sys.are_adjacent(a, b)).sort();
          if (nb.join(',') !== expected.join(',')) {
            throw new Error(`neighbors(${a})=${nb.join(',')} 与 are_adjacent 推导 ${expected.join(',')} 不符`);
          }
        }
        return true;
      }),
      { numRuns: Math.min(RUNS, 20000) }
    );
  });

  it(`失败操作的原子性：抛错不改变状态 (${Math.min(RUNS, 20000)} 次)`, () => {
    fc.assert(
      fc.property(
        fc.array(genOp(), { minLength: 0, maxLength: 20 }),
        genOp(),
        (setup, probeOp) => {
          const sys = new TopologySystem();
          for (const op of setup) apply(sys, op);

          const before = canonSys(sys, POOLS);
          const err = apply(sys, probeOp);
          const after = canonSys(sys, POOLS);

          if (err !== null && before !== after) {
            throw new Error(
              `${describeOp(probeOp)} 抛出 ${err} 但状态被修改\nbefore:\n${before}\nafter:\n${after}`
            );
          }
          return true;
        }
      ),
      { numRuns: Math.min(RUNS, 20000) }
    );
  });

  it(`实体唯一占位：一个实体最多在一个 Node 上 (${Math.min(RUNS, 20000)} 次)`, () => {
    fc.assert(
      fc.property(fc.array(genOp(), { minLength: 1, maxLength: 30 }), (ops) => {
        const sys = new TopologySystem();
        for (const op of ops) apply(sys, op);

        for (const e of POOLS.entities) {
          const holders = POOLS.nodes.filter(n => sys.getNode(n)?.entities.has(e));
          if (holders.length > 1) {
            throw new Error(`实体 ${e} 同时位于 ${holders.join(',')}`);
          }
          const at = sys.entity_locate(e);
          if (at === undefined && holders.length !== 0) {
            throw new Error(`实体 ${e} 未被索引但挂在 ${holders.join(',')}`);
          }
          if (at !== undefined && (holders.length !== 1 || holders[0] !== at)) {
            throw new Error(`实体 ${e} 索引指向 ${at} 但实际在 ${holders.join(',') || '(无)'}`);
          }
        }
        return true;
      }),
      { numRuns: Math.min(RUNS, 20000) }
    );
  });

  it('无操作序列导致栈溢出或异常崩溃 (5000 次, 长序列)', () => {
    fc.assert(
      fc.property(fc.array(genOp(), { minLength: 50, maxLength: 200 }), (ops) => {
        const sys = new TopologySystem();
        for (const op of ops) {
          const err = apply(sys, op);
          if (err !== null && ![E_REF, E_DUP, E_CROSS, E_NOT_PLACED, E_NOT_ADJ].includes(err)) {
            throw new Error(`意外错误 ${err} 来自 ${describeOp(op)}`);
          }
        }
        expect(sys.checkInvariants()).toEqual([]);
        return true;
      }),
      { numRuns: Math.min(RUNS, 5000) }
    );
  });
});


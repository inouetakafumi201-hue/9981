// checkInvariants 自身的验证：直接篡改私有状态注入每一类结构损坏，
// 断言检查器确实报出对应违反。否则 checkInvariants 返回 [] 可能只是因为它坏了。
import { describe, it, expect } from 'vitest';
import { TopologySystem, type Node, type Link, type Scene } from '../src/topology';

/** 私有状态视图，仅测试用。 */
interface Guts {
  scenes: Map<string, Scene>;
  nodes: Map<string, Node>;
  links: Map<string, Link>;
  entityIndex: Map<string, string>;
}
const guts = (sys: TopologySystem) => sys as unknown as Guts;

/** 建一个健康的基准拓扑：s1 下 n1-n2 无向连边，s1 有子场景 sub。 */
function healthy() {
  const sys = new TopologySystem();
  sys.scene_create('s1');
  sys.scene_create('sub', 's1');
  sys.node_create('s1', 'n1');
  sys.node_create('s1', 'n2');
  sys.link_create('s1', 'l12', 'n1', 'n2');
  expect(sys.checkInvariants()).toEqual([]);
  return sys;
}

const codes = (sys: TopologySystem) => sys.checkInvariants().map(v => v.code);

describe('checkInvariants: 基准拓扑干净', () => {
  it('健康拓扑无违反', () => {
    const sys = healthy();
    expect(sys.checkInvariants()).toEqual([]);
  });
});

describe('checkInvariants: Link 相关损坏', () => {
  it('from 端 Node 消失 → E_INV_DANGLING', () => {
    const sys = healthy();
    guts(sys).nodes.delete('n1');
    expect(codes(sys)).toContain('E_INV_DANGLING');
    expect(sys.checkInvariants().some(v => v.detail.includes('from=n1'))).toBe(true);
  });

  it('to 端 Node 消失 → E_INV_DANGLING', () => {
    const sys = healthy();
    guts(sys).nodes.delete('n2');
    expect(sys.checkInvariants().some(v => v.detail.includes('to=n2'))).toBe(true);
  });

  it('Link 所属 Scene 消失 → E_INV_DANGLING', () => {
    const sys = healthy();
    guts(sys).links.get('l12')!.sceneId = 'ghost';
    expect(codes(sys)).toContain('E_INV_DANGLING');
  });

  it('from 端 Node 的 sceneId 与 Link 不一致 → E_INV_CROSS_SCENE', () => {
    const sys = healthy();
    sys.scene_create('other');
    guts(sys).nodes.get('n1')!.sceneId = 'other';
    expect(codes(sys)).toContain('E_INV_CROSS_SCENE');
  });

  it('to 端 Node 的 sceneId 与 Link 不一致 → E_INV_CROSS_SCENE', () => {
    const sys = healthy();
    sys.scene_create('other');
    guts(sys).nodes.get('n2')!.sceneId = 'other';
    expect(codes(sys)).toContain('E_INV_CROSS_SCENE');
  });

  it('from 端 Node 未持有该 Link → E_INV_INCONSISTENT', () => {
    const sys = healthy();
    guts(sys).nodes.get('n1')!.links.delete('l12');
    expect(sys.checkInvariants().some(v =>
      v.code === 'E_INV_INCONSISTENT' && v.detail.includes('not in from-node links'))).toBe(true);
  });

  it('to 端 Node 未持有该 Link → E_INV_INCONSISTENT', () => {
    const sys = healthy();
    guts(sys).nodes.get('n2')!.links.delete('l12');
    expect(sys.checkInvariants().some(v =>
      v.code === 'E_INV_INCONSISTENT' && v.detail.includes('not in to-node links'))).toBe(true);
  });

  it('Scene 的 Link 索引缺失 → E_INV_INCONSISTENT', () => {
    const sys = healthy();
    guts(sys).scenes.get('s1')!.links.delete('l12');
    expect(sys.checkInvariants().some(v =>
      v.detail.includes('missing/mismatched in scene index'))).toBe(true);
  });

  it('Scene 的 Link 索引指向不同对象 → E_INV_INCONSISTENT', () => {
    const sys = healthy();
    const fake: Link = { id: 'l12', sceneId: 's1', from: 'n1', to: 'n2', directed: false, attrs: {} };
    guts(sys).scenes.get('s1')!.links.set('l12', fake);
    expect(sys.checkInvariants().some(v =>
      v.detail.includes('missing/mismatched in scene index'))).toBe(true);
  });
});

describe('checkInvariants: Node 相关损坏', () => {
  it('Node 所在 Scene 消失 → E_INV_DANGLING', () => {
    const sys = healthy();
    guts(sys).nodes.get('n1')!.sceneId = 'ghost';
    expect(sys.checkInvariants().some(v =>
      v.code === 'E_INV_DANGLING' && v.detail.includes('node n1 scene=ghost'))).toBe(true);
  });

  it('Scene 的 Node 索引缺失 → E_INV_INCONSISTENT', () => {
    const sys = healthy();
    guts(sys).scenes.get('s1')!.nodes.delete('n1');
    expect(sys.checkInvariants().some(v =>
      v.code === 'E_INV_INCONSISTENT' && v.detail.includes('node n1 missing/mismatched'))).toBe(true);
  });

  it('Node 持有已不存在的 linkId → E_INV_STALE_REF', () => {
    const sys = healthy();
    guts(sys).nodes.get('n1')!.links.add('ghost-link');
    expect(sys.checkInvariants().some(v =>
      v.code === 'E_INV_STALE_REF' && v.detail.includes('stale link ghost-link'))).toBe(true);
  });

  it('Node 持有与自己无关的 Link → E_INV_INCONSISTENT', () => {
    const sys = healthy();
    sys.node_create('s1', 'n3');
    sys.node_create('s1', 'n4');
    sys.link_create('s1', 'l34', 'n3', 'n4');
    guts(sys).nodes.get('n1')!.links.add('l34'); // n1 与 l34 无关
    expect(sys.checkInvariants().some(v =>
      v.code === 'E_INV_INCONSISTENT' && v.detail.includes('unrelated link l34'))).toBe(true);
  });

  it('Node 上的实体未进索引 → E_INV_INCONSISTENT', () => {
    const sys = healthy();
    guts(sys).nodes.get('n1')!.entities.add('e-ghost');
    expect(sys.checkInvariants().some(v =>
      v.code === 'E_INV_INCONSISTENT' && v.detail.includes('entity e-ghost'))).toBe(true);
  });
});

describe('checkInvariants: Scene 树损坏', () => {
  it('parentId 指向不存在的 Scene → E_INV_DANGLING', () => {
    const sys = healthy();
    guts(sys).scenes.get('sub')!.parentId = 'ghost';
    expect(sys.checkInvariants().some(v =>
      v.code === 'E_INV_DANGLING' && v.detail.includes('parent=ghost'))).toBe(true);
  });

  it('父场景未把自己列为子 → E_INV_INCONSISTENT', () => {
    const sys = healthy();
    guts(sys).scenes.get('s1')!.childScenes.delete('sub');
    expect(sys.checkInvariants().some(v =>
      v.code === 'E_INV_INCONSISTENT' && v.detail.includes("not in parent's childScenes"))).toBe(true);
  });

  it('childScenes 含已不存在的场景 → E_INV_STALE_REF', () => {
    const sys = healthy();
    guts(sys).scenes.get('s1')!.childScenes.add('ghost');
    expect(sys.checkInvariants().some(v =>
      v.code === 'E_INV_STALE_REF' && v.detail.includes('stale child ghost'))).toBe(true);
  });

  it('子场景不认父 → E_INV_INCONSISTENT', () => {
    const sys = healthy();
    sys.scene_create('other');
    guts(sys).scenes.get('sub')!.parentId = 'other';
    guts(sys).scenes.get('other')!.childScenes.add('sub');
    expect(sys.checkInvariants().some(v =>
      v.code === 'E_INV_INCONSISTENT' && v.detail.includes('disowns parent'))).toBe(true);
  });

  it('Scene 索引含陈旧 Node 对象 → E_INV_STALE_REF', () => {
    const sys = healthy();
    const fake: Node = { id: 'nx', sceneId: 's1', links: new Set(), entities: new Set(), attrs: {} };
    guts(sys).scenes.get('s1')!.nodes.set('nx', fake);
    expect(sys.checkInvariants().some(v =>
      v.code === 'E_INV_STALE_REF' && v.detail.includes('stale node nx'))).toBe(true);
  });

  it('Scene 索引含归属他人的 Node → E_INV_INCONSISTENT', () => {
    const sys = healthy();
    const n1 = guts(sys).nodes.get('n1')!;
    guts(sys).scenes.get('sub')!.nodes.set('n1', n1); // sub 声称持有 s1 的节点
    expect(sys.checkInvariants().some(v =>
      v.code === 'E_INV_INCONSISTENT' && v.detail.includes('owned by s1'))).toBe(true);
  });

  it('Scene 索引含陈旧 Link 对象 → E_INV_STALE_REF', () => {
    const sys = healthy();
    const fake: Link = { id: 'lx', sceneId: 's1', from: 'n1', to: 'n2', directed: false, attrs: {} };
    guts(sys).scenes.get('s1')!.links.set('lx', fake);
    expect(sys.checkInvariants().some(v =>
      v.code === 'E_INV_STALE_REF' && v.detail.includes('stale link lx'))).toBe(true);
  });

  it('Scene 索引含归属他人的 Link → E_INV_INCONSISTENT', () => {
    const sys = healthy();
    const l12 = guts(sys).links.get('l12')!;
    guts(sys).scenes.get('sub')!.links.set('l12', l12);
    expect(sys.checkInvariants().some(v =>
      v.code === 'E_INV_INCONSISTENT' && v.detail.includes('link l12 owned by s1'))).toBe(true);
  });

  it('场景自环父引用 → E_INV_CYCLE', () => {
    const sys = healthy();
    guts(sys).scenes.get('sub')!.parentId = 'sub';
    guts(sys).scenes.get('sub')!.childScenes.add('sub');
    expect(codes(sys)).toContain('E_INV_CYCLE');
  });

  it('两场景互为父子 → E_INV_CYCLE', () => {
    const sys = new TopologySystem();
    sys.scene_create('a');
    sys.scene_create('b', 'a');
    guts(sys).scenes.get('a')!.parentId = 'b';
    guts(sys).scenes.get('b')!.childScenes.add('a');
    expect(codes(sys)).toContain('E_INV_CYCLE');
  });

  it('三场景长环 → E_INV_CYCLE', () => {
    const sys = new TopologySystem();
    sys.scene_create('a');
    sys.scene_create('b', 'a');
    sys.scene_create('c', 'b');
    guts(sys).scenes.get('a')!.parentId = 'c';
    guts(sys).scenes.get('c')!.childScenes.add('a');
    const v = sys.checkInvariants().filter(x => x.code === 'E_INV_CYCLE');
    expect(v.length).toBeGreaterThan(0);
  });
});

describe('checkInvariants: 实体索引损坏', () => {
  it('索引指向不存在的 Node → E_INV_DANGLING', () => {
    const sys = healthy();
    guts(sys).entityIndex.set('e1', 'ghost');
    expect(sys.checkInvariants().some(v =>
      v.code === 'E_INV_DANGLING' && v.detail.includes('missing node ghost'))).toBe(true);
  });

  it('索引指向的 Node 上没有该实体 → E_INV_INCONSISTENT', () => {
    const sys = healthy();
    sys.entity_place('n1', 'e1');
    guts(sys).nodes.get('n1')!.entities.delete('e1');
    expect(sys.checkInvariants().some(v =>
      v.code === 'E_INV_INCONSISTENT' && v.detail.includes('not on it'))).toBe(true);
  });
});

describe('查询函数对损坏状态的容错（基线在此崩溃）', () => {
  it('are_adjacent 遇陈旧 linkId 不抛 TypeError', () => {
    const sys = healthy();
    guts(sys).nodes.get('n1')!.links.add('ghost-link');
    expect(() => sys.are_adjacent('n1', 'n2')).not.toThrow();
    expect(sys.are_adjacent('n1', 'n2')).toBe(true);  // 真实边仍可见
    expect(sys.are_adjacent('n1', 'n1')).toBe(false); // 陈旧项被跳过
  });

  it('neighbors 遇陈旧 linkId 不抛 TypeError', () => {
    const sys = healthy();
    guts(sys).nodes.get('n1')!.links.add('ghost-link');
    expect(() => sys.neighbors('n1')).not.toThrow();
    expect(sys.neighbors('n1')).toEqual(['n2']);
  });

  it('neighbors 覆盖有向/无向 × from端/to端 四种组合', () => {
    const sys = new TopologySystem();
    sys.scene_create('s');
    for (const n of ['a', 'b', 'c', 'd', 'e']) sys.node_create('s', n);

    sys.link_create('s', 'u_ab', 'a', 'b', false); // 无向：a 是 from
    sys.link_create('s', 'u_ca', 'c', 'a', false); // 无向：a 是 to
    sys.link_create('s', 'd_ad', 'a', 'd', true);  // 有向：a 是 from
    sys.link_create('s', 'd_ea', 'e', 'a', true);  // 有向：a 是 to
    sys.link_create('s', 'u_aa', 'a', 'a', false); // 无向自环：a 同为两端

    // 无向双向可达；有向仅 from→to；自环含自身
    expect(sys.neighbors('a').sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(sys.neighbors('b')).toEqual(['a']);
    expect(sys.neighbors('c')).toEqual(['a']);
    expect(sys.neighbors('d')).toEqual([]);   // 有向 a→d，d 无出边
    expect(sys.neighbors('e')).toEqual(['a']); // 有向 e→a
    expect(sys.checkInvariants()).toHaveLength(0);
  });

  it('entity_move 在损坏状态下不崩溃', () => {
    const sys = healthy();
    sys.entity_place('n1', 'e1');
    guts(sys).nodes.get('n1')!.links.add('ghost-link');
    expect(() => sys.entity_move('e1', 'n2')).not.toThrow();
    expect(sys.entity_locate('e1')).toBe('n2');
  });
});

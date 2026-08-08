// 回归测试：每个用例锁定一个已修复的缺陷，防止回退。
import { describe, it, expect } from 'vitest';
import { TopologySystem } from '../src/topology';

describe('L7 回归：ID 唯一性', () => {
  it('BUG#1 同场景重复 nodeId 必须拒绝', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.node_create('s1', 'n1');
    expect(() => sys.node_create('s1', 'n1')).toThrow('E_ID_DUPLICATE');
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('BUG#3 跨场景重复 nodeId 必须拒绝（否则旧节点与其 Link 成为孤儿）', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.scene_create('s2');
    sys.node_create('s1', 'a');
    sys.node_create('s1', 'b');
    sys.link_create('s1', 'l', 'a', 'b');

    expect(() => sys.node_create('s2', 'a')).toThrow('E_ID_DUPLICATE');

    // 拒绝后原结构完好
    expect(sys.getNode('a')!.sceneId).toBe('s1');
    expect(sys.getScene('s1')!.nodes.has('a')).toBe(true);
    expect(sys.getScene('s2')!.nodes.size).toBe(0);
    expect(sys.getNode('b')!.links.has('l')).toBe(true);
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('BUG#4 重复 sceneId 必须拒绝（否则原场景下节点全部悬空）', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.node_create('s1', 'a');

    expect(() => sys.scene_create('s1')).toThrow('E_ID_DUPLICATE');

    expect(sys.getScene('s1')!.nodes.has('a')).toBe(true);
    sys.scene_delete('s1');
    expect(sys.getNode('a')).toBeUndefined();
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('BUG#5 重复 linkId 必须拒绝（否则节点持有陈旧 linkId）', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.node_create('s1', 'a');
    sys.node_create('s1', 'b');
    sys.node_create('s1', 'c');
    sys.link_create('s1', 'l', 'a', 'b');

    expect(() => sys.link_create('s1', 'l', 'a', 'c')).toThrow('E_ID_DUPLICATE');

    // 原 Link 未被篡改，c 未被牵连
    const l = sys.getLink('l')!;
    expect([l.from, l.to]).toEqual(['a', 'b']);
    expect(sys.getNode('c')!.links.size).toBe(0);
    expect(sys.checkInvariants()).toEqual([]);

    // 删除 a 后 b 不残留陈旧引用，are_adjacent 不崩溃
    sys.node_delete('a');
    expect(sys.getNode('b')!.links.size).toBe(0);
    expect(() => sys.are_adjacent('b', 'c')).not.toThrow();
    expect(sys.are_adjacent('b', 'c')).toBe(false);
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('BUG#6 场景自环父引用不再可能，删除不栈溢出', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    // 旧实现允许 scene_create('s1','s1') 覆盖并制造自环 -> scene_delete 栈溢出
    expect(() => sys.scene_create('s1', 's1')).toThrow('E_ID_DUPLICATE');
    expect(() => sys.scene_delete('s1')).not.toThrow();
    expect(sys.getScene('s1')).toBeUndefined();
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('BUG#7 场景父子环不再可能', () => {
    const sys = new TopologySystem();
    sys.scene_create('a');
    sys.scene_create('b', 'a');
    expect(() => sys.scene_create('a', 'b')).toThrow('E_ID_DUPLICATE');
    sys.scene_delete('a');
    expect(sys.snapshot().sceneIds).toEqual([]);
    expect(sys.checkInvariants()).toEqual([]);
  });
});

describe('L7 回归：有向性', () => {
  it('BUG#2 有向 Link 反向不相邻', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.node_create('s1', 'n1');
    sys.node_create('s1', 'n2');
    sys.link_create('s1', 'l12', 'n1', 'n2', true);

    expect(sys.are_adjacent('n1', 'n2')).toBe(true);
    expect(sys.are_adjacent('n2', 'n1')).toBe(false);
    expect(sys.neighbors('n1')).toEqual(['n2']);
    expect(sys.neighbors('n2')).toEqual([]);
  });

  it('无向 Link 双向相邻', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.node_create('s1', 'n1');
    sys.node_create('s1', 'n2');
    sys.link_create('s1', 'l12', 'n1', 'n2', false);

    expect(sys.are_adjacent('n1', 'n2')).toBe(true);
    expect(sys.are_adjacent('n2', 'n1')).toBe(true);
  });

  it('自环 Link 显式允许，节点与自身相邻', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.node_create('s1', 'n1');
    sys.link_create('s1', 'self', 'n1', 'n1', false);

    expect(sys.are_adjacent('n1', 'n1')).toBe(true);
    expect(sys.getNode('n1')!.links.size).toBe(1);
    expect(sys.checkInvariants()).toEqual([]);

    // 删除自环后干净
    sys.link_delete('self');
    expect(sys.getNode('n1')!.links.size).toBe(0);
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('删除自环所在节点不留残留', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.node_create('s1', 'n1');
    sys.link_create('s1', 'self', 'n1', 'n1', true);
    sys.node_delete('n1');
    expect(sys.getLink('self')).toBeUndefined();
    expect(sys.getScene('s1')!.links.size).toBe(0);
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('are_adjacent 对不存在的节点返回 false 而非崩溃', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.node_create('s1', 'n1');
    expect(sys.are_adjacent('n1', 'ghost')).toBe(false);
    expect(sys.are_adjacent('ghost', 'n1')).toBe(false);
    expect(sys.neighbors('ghost')).toEqual([]);
  });
});

describe('L7 回归：引用完整性与级联', () => {
  it('BUG#8 link_create 校验顺序：场景不存在报 E_REF_INVALID', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.node_create('s1', 'a');
    sys.node_create('s1', 'b');
    expect(() => sys.link_create('ghost', 'l', 'a', 'b')).toThrow('E_REF_INVALID');
    expect(sys.getLink('l')).toBeUndefined();
    expect(sys.getNode('a')!.links.size).toBe(0);
  });

  it('跨场景 Link 被拒绝且无部分写入', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.scene_create('s2');
    sys.node_create('s1', 'n1');
    sys.node_create('s2', 'n2');

    expect(() => sys.link_create('s1', 'l', 'n1', 'n2')).toThrow('E_LINK_CROSS_SCENE');
    expect(sys.getNode('n1')!.links.size).toBe(0);
    expect(sys.getNode('n2')!.links.size).toBe(0);
    expect(sys.getScene('s1')!.links.size).toBe(0);
    expect(sys.checkInvariants()).toEqual([]);
  });

  // 场景归属校验必须对称：只查一端会留下漏洞（变异体 M10/M11 暴露）
  it('场景归属校验对称：from 端不匹配也必须拒绝', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.scene_create('s2');
    sys.node_create('s1', 'n1');
    sys.node_create('s2', 'n2');

    // sceneId=s2：to 端(n2)匹配，from 端(n1)不匹配 —— 只查 to 端会漏掉
    expect(() => sys.link_create('s2', 'l', 'n1', 'n2')).toThrow('E_LINK_CROSS_SCENE');
    expect(sys.getLink('l')).toBeUndefined();
    expect(sys.getNode('n1')!.links.size).toBe(0);
    expect(sys.getNode('n2')!.links.size).toBe(0);
    expect(sys.getScene('s2')!.links.size).toBe(0);
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('场景归属校验对称：两端都不匹配也必须拒绝', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.scene_create('s2');
    sys.scene_create('s3');
    sys.node_create('s1', 'n1');
    sys.node_create('s1', 'n2');

    // sceneId=s3：两端都在 s1
    expect(() => sys.link_create('s3', 'l', 'n1', 'n2')).toThrow('E_LINK_CROSS_SCENE');
    expect(sys.getLink('l')).toBeUndefined();
    expect(sys.getScene('s3')!.links.size).toBe(0);
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('场景归属校验：四种组合的完整判定表', () => {
    // 表驱动，覆盖 (from 匹配?, to 匹配?) 的全部四种组合
    const cases: Array<{ sceneId: string; from: string; to: string; ok: boolean }> = [
      { sceneId: 's1', from: 'a1', to: 'b1', ok: true },   // 两端都匹配
      { sceneId: 's1', from: 'a1', to: 'a2', ok: false },  // to 端不匹配
      { sceneId: 's1', from: 'a2', to: 'b1', ok: false },  // from 端不匹配
      { sceneId: 's1', from: 'a2', to: 'b2', ok: false }   // 两端都不匹配
    ];

    for (const [i, c] of cases.entries()) {
      const sys = new TopologySystem();
      sys.scene_create('s1');
      sys.scene_create('s2');
      sys.node_create('s1', 'a1');
      sys.node_create('s1', 'b1');
      sys.node_create('s2', 'a2');
      sys.node_create('s2', 'b2');

      const linkId = `l${i}`;
      if (c.ok) {
        expect(() => sys.link_create(c.sceneId, linkId, c.from, c.to)).not.toThrow();
        expect(sys.getLink(linkId)).toBeDefined();
      } else {
        expect(() => sys.link_create(c.sceneId, linkId, c.from, c.to)).toThrow('E_LINK_CROSS_SCENE');
        expect(sys.getLink(linkId)).toBeUndefined();
        expect(sys.getNode(c.from)!.links.has(linkId)).toBe(false);
        expect(sys.getNode(c.to)!.links.has(linkId)).toBe(false);
      }
      expect(sys.checkInvariants()).toEqual([]);
    }
  });

  it('node 删除级联删除全部关联 Link，并清出场景索引', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    for (const n of ['n1', 'n2', 'n3']) sys.node_create('s1', n);
    sys.link_create('s1', 'l12', 'n1', 'n2');
    sys.link_create('s1', 'l13', 'n1', 'n3');
    sys.link_create('s1', 'l23', 'n2', 'n3');

    sys.node_delete('n1');

    expect(sys.getLink('l12')).toBeUndefined();
    expect(sys.getLink('l13')).toBeUndefined();
    expect(sys.getLink('l23')).toBeDefined();
    expect(sys.getNode('n2')!.links).toEqual(new Set(['l23']));
    expect(sys.getNode('n3')!.links).toEqual(new Set(['l23']));
    expect([...sys.getScene('s1')!.links.keys()]).toEqual(['l23']);
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('scene 删除级联清除深层子孙的场景/节点/Link', () => {
    const sys = new TopologySystem();
    sys.scene_create('root');
    let parent = 'root';
    for (let i = 1; i <= 6; i++) {
      const id = `c${i}`;
      sys.scene_create(id, parent);
      sys.node_create(id, `a${i}`);
      sys.node_create(id, `b${i}`);
      sys.link_create(id, `l${i}`, `a${i}`, `b${i}`);
      parent = id;
    }
    sys.scene_delete('root');

    expect(sys.snapshot()).toEqual({ sceneIds: [], nodeIds: [], linkIds: [], entityIds: [] });
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('删除中间层场景只清除其子树，父级不受损', () => {
    const sys = new TopologySystem();
    sys.scene_create('root');
    sys.scene_create('mid', 'root');
    sys.scene_create('leaf', 'mid');
    sys.scene_create('sibling', 'root');
    sys.node_create('root', 'rn');
    sys.node_create('leaf', 'ln');
    sys.node_create('sibling', 'sn');

    sys.scene_delete('mid');

    expect(sys.getScene('mid')).toBeUndefined();
    expect(sys.getScene('leaf')).toBeUndefined();
    expect(sys.getNode('ln')).toBeUndefined();
    expect(sys.getScene('root')!.childScenes).toEqual(new Set(['sibling']));
    expect(sys.getNode('rn')).toBeDefined();
    expect(sys.getNode('sn')).toBeDefined();
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('link_delete 幂等，node/scene delete 对不存在 ID 抛 E_REF_INVALID', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.node_create('s1', 'n1');
    sys.node_create('s1', 'n2');
    sys.link_create('s1', 'l', 'n1', 'n2');

    sys.link_delete('l');
    expect(() => sys.link_delete('l')).not.toThrow();
    expect(() => sys.link_delete('never-existed')).not.toThrow();
    expect(() => sys.node_delete('ghost')).toThrow('E_REF_INVALID');
    expect(() => sys.scene_delete('ghost')).toThrow('E_REF_INVALID');
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('parentId 不存在时 scene_create 抛 E_REF_INVALID 且不留下场景', () => {
    const sys = new TopologySystem();
    expect(() => sys.scene_create('s1', 'ghost')).toThrow('E_REF_INVALID');
    expect(sys.getScene('s1')).toBeUndefined();
    expect(sys.snapshot().sceneIds).toEqual([]);
  });

  it('ID 删除后可复用', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.node_create('s1', 'n1');
    sys.node_create('s1', 'n2');
    sys.link_create('s1', 'l', 'n1', 'n2');

    sys.node_delete('n1');
    expect(() => sys.node_create('s1', 'n1')).not.toThrow();
    expect(() => sys.link_create('s1', 'l', 'n1', 'n2')).not.toThrow();
    expect(sys.checkInvariants()).toEqual([]);
  });
});

describe('L7 回归：实体占位', () => {
  it('BUG#9 实体操作已实现，且同一实体只占一个 Node', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.node_create('s1', 'n1');
    sys.node_create('s1', 'n2');

    sys.entity_place('n1', 'e1');
    expect(sys.entity_locate('e1')).toBe('n1');

    sys.entity_place('n2', 'e1');
    expect(sys.entity_locate('e1')).toBe('n2');
    expect(sys.getNode('n1')!.entities.has('e1')).toBe(false);
    expect(sys.getNode('n2')!.entities.has('e1')).toBe(true);
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('节点删除清除其上实体占位', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.node_create('s1', 'n1');
    sys.entity_place('n1', 'e1');
    sys.node_delete('n1');

    expect(sys.entity_locate('e1')).toBeUndefined();
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('场景删除清除其下所有实体占位', () => {
    const sys = new TopologySystem();
    sys.scene_create('root');
    sys.scene_create('child', 'root');
    sys.node_create('child', 'n1');
    sys.entity_place('n1', 'e1');
    sys.scene_delete('root');

    expect(sys.entity_locate('e1')).toBeUndefined();
    expect(sys.snapshot().entityIds).toEqual([]);
  });

  it('entity_move 只能沿 Link 移动，遵循有向性', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.node_create('s1', 'n1');
    sys.node_create('s1', 'n2');
    sys.node_create('s1', 'n3');
    sys.link_create('s1', 'l12', 'n1', 'n2', true);

    sys.entity_place('n1', 'e1');
    sys.entity_move('e1', 'n2');
    expect(sys.entity_locate('e1')).toBe('n2');

    // 有向边反向不可走：目标存在但不可达 → E_NOT_ADJACENT
    expect(() => sys.entity_move('e1', 'n1')).toThrow('E_NOT_ADJACENT');
    expect(sys.entity_locate('e1')).toBe('n2');
    // 无边不可走
    expect(() => sys.entity_move('e1', 'n3')).toThrow('E_NOT_ADJACENT');
    // 原地移动允许
    expect(() => sys.entity_move('e1', 'n2')).not.toThrow();
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('entity_move 三种失败模式错误码互不相同', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.node_create('s1', 'n1');
    sys.node_create('s1', 'n2');
    sys.entity_place('n1', 'e1');

    // 实体未落位
    expect(() => sys.entity_move('ghost', 'n1')).toThrow('E_ENTITY_NOT_PLACED');
    // 目标 Node 不存在
    expect(() => sys.entity_move('e1', 'ghost-node')).toThrow('E_REF_INVALID');
    // 目标存在但不可达
    expect(() => sys.entity_move('e1', 'n2')).toThrow('E_NOT_ADJACENT');

    // 三者必须互不相同，否则调用方无法区分失败原因
    const codes = new Set<string>();
    for (const [ent, node] of [['ghost', 'n1'], ['e1', 'ghost-node'], ['e1', 'n2']]) {
      try { sys.entity_move(ent, node); } catch (e: any) { codes.add(e.message); }
    }
    expect(codes.size).toBe(3);
    expect(sys.entity_locate('e1')).toBe('n1'); // 全部失败，状态未变
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('未落位的实体不能 move，entity_remove 幂等', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.node_create('s1', 'n1');
    expect(() => sys.entity_move('ghost', 'n1')).toThrow('E_ENTITY_NOT_PLACED');
    expect(() => sys.entity_remove('ghost')).not.toThrow();
    sys.entity_place('n1', 'e1');
    sys.entity_remove('e1');
    sys.entity_remove('e1');
    expect(sys.entity_locate('e1')).toBeUndefined();
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('entity_place 到不存在的节点抛错且不改变状态', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.node_create('s1', 'n1');
    sys.entity_place('n1', 'e1');
    expect(() => sys.entity_place('ghost', 'e1')).toThrow('E_REF_INVALID');
    expect(sys.entity_locate('e1')).toBe('n1');
    expect(sys.getNode('n1')!.entities.has('e1')).toBe(true);
  });
});

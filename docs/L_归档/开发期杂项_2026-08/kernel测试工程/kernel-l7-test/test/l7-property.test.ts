import fc from 'fast-check';
import { TopologySystem } from '../src/topology';
import { describe, it, expect } from 'vitest';

describe('L7: 微场景拓扑', () => {

  // 属性测试1：任意操作序列后无悬空引用（10万次）
  it('INV-6/7: 任意操作后无悬空引用', () => {
    fc.assert(
      fc.property(
        fc.array(genRandomTopoOp(), { minLength: 1, maxLength: 40 }),
        (ops) => {
          const sys = new TopologySystem();
          setupInitial(sys);

          for (const op of ops) {
            try { execTopoOp(sys, op as TopoOp); } catch {}
          }

          const violations = sys.checkInvariants();
          if (violations.length > 0) {
            console.error('VIOLATIONS:', violations);
          }
          return violations.length === 0;
        }
      ),
      { numRuns: 100000, verbose: false }
    );
  });

  // 属性测试2：Node删除后所有Link被级联删除（1万次）
  it('INV-6: node删除后关联Link消失', () => {
    fc.assert(
      fc.property(
        fc.constant(null),
        () => {
          const sys = new TopologySystem();
          sys.scene_create('s1');
          sys.node_create('s1', 'n1');
          sys.node_create('s1', 'n2');
          sys.node_create('s1', 'n3');
          sys.link_create('s1', 'l12', 'n1', 'n2');
          sys.link_create('s1', 'l13', 'n1', 'n3');

          // 删除n1
          sys.node_delete('n1');

          // l12和l13必须也被删除
          const linksGone = !sys.getLink('l12') && !sys.getLink('l13');
          // n2和n3不再持有这些link
          const n2Clean = !sys.getNode('n2')?.links.has('l12');
          const n3Clean = !sys.getNode('n3')?.links.has('l13');

          return linksGone && n2Clean && n3Clean;
        }
      ),
      { numRuns: 10000 }
    );
  });

  // 属性测试3：Scene删除后子场景和节点全部消失（1万次）
  it('INV-7: scene删除级联清除子孙', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }),
        (depth) => {
          const sys = new TopologySystem();
          const sceneIds: string[] = [];

          // 构建深度为depth的场景树
          sys.scene_create('root');
          sceneIds.push('root');
          for (let i = 1; i <= depth; i++) {
            sys.scene_create(`child${i}`, `${i - 1 === 0 ? 'root' : 'child' + (i - 1)}`);
            sceneIds.push(`child${i}`);
            sys.node_create(`child${i}`, `node${i}`);
          }

          // 删除root
          sys.scene_delete('root');

          // 所有子孙都应消失
          for (const id of sceneIds) {
            if (sys.getScene(id)) return false;
          }
          return true;
        }
      ),
      { numRuns: 10000 }
    );
  });

  // 边界测试：跨Scene的Link被拒绝
  it('E_LINK_CROSS_SCENE: 跨场景Link被拒绝', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.scene_create('s2');
    sys.node_create('s1', 'n1');
    sys.node_create('s2', 'n2');

    expect(() => sys.link_create('s1', 'l12', 'n1', 'n2')).toThrow('E_LINK_CROSS_SCENE');
  });

  // 边界测试：自环Link
  it('自环Link: node到自身', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.node_create('s1', 'n1');

    // 自环是否被允许——若Spec未定义则标记UNDEF，实现拒绝
    try {
      sys.link_create('s1', 'l11', 'n1', 'n1');
      // 若允许，验证不变量仍成立
      expect(sys.checkInvariants()).toHaveLength(0);
    } catch (e: any) {
      expect(['E_LINK_SELF_LOOP', 'E_REF_INVALID']).toContain(e.message);
    }
  });

  // 边界测试：有向Link的相邻查询
  it('有向Link: 只有from可达to，反向不通', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.node_create('s1', 'n1');
    sys.node_create('s1', 'n2');
    sys.link_create('s1', 'l12', 'n1', 'n2', true /* directed */);

    expect(sys.are_adjacent('n1', 'n2')).toBe(true);
    // 有向时反向应不通
    expect(sys.are_adjacent('n2', 'n1')).toBe(false);
  });

  // 边界测试：重复创建同ID的Node
  it('重复nodeId被拒绝', () => {
    const sys = new TopologySystem();
    sys.scene_create('s1');
    sys.node_create('s1', 'n1');
    expect(() => sys.node_create('s1', 'n1')).toThrow();
  });

  // 属性测试4：link_delete幂等（1万次）
  it('link_delete幂等', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const sys = new TopologySystem();
        sys.scene_create('s1');
        sys.node_create('s1', 'n1');
        sys.node_create('s1', 'n2');
        sys.link_create('s1', 'l12', 'n1', 'n2');

        sys.link_delete('l12');
        sys.link_delete('l12'); // 第二次不应抛异常
        return sys.checkInvariants().length === 0;
      }),
      { numRuns: 10000 }
    );
  });
});

// ---- 辅助函数 ----

type TopoOp =
  | { type: 'scene_create'; id: string; parentIdx: number }
  | { type: 'scene_delete'; idx: number }
  | { type: 'node_create'; sceneIdx: number; id: string }
  | { type: 'node_delete'; idx: number }
  | { type: 'link_create'; sceneIdx: number; id: string; fromIdx: number; toIdx: number }
  | { type: 'link_delete'; idx: number };

function genRandomTopoOp() {
  return fc.oneof(
    fc.record({ type: fc.constant('scene_create' as const), id: fc.uuid(), parentIdx: fc.integer({ min: 0, max: 4 }) }),
    fc.record({ type: fc.constant('scene_delete' as const), idx: fc.integer({ min: 0, max: 4 }) }),
    fc.record({ type: fc.constant('node_create' as const), sceneIdx: fc.integer({ min: 0, max: 4 }), id: fc.uuid() }),
    fc.record({ type: fc.constant('node_delete' as const), idx: fc.integer({ min: 0, max: 9 }) }),
    fc.record({ type: fc.constant('link_create' as const), sceneIdx: fc.integer({ min: 0, max: 4 }), id: fc.uuid(), fromIdx: fc.integer({ min: 0, max: 9 }), toIdx: fc.integer({ min: 0, max: 9 }) }),
    fc.record({ type: fc.constant('link_delete' as const), idx: fc.integer({ min: 0, max: 9 }) })
  );
}

function setupInitial(sys: TopologySystem) {
  for (let i = 0; i < 3; i++) {
    try { sys.scene_create(`s${i}`); } catch {}
    for (let j = 0; j < 3; j++) {
      try { sys.node_create(`s${i}`, `n${i}_${j}`); } catch {}
    }
  }
}

const scenePool = ['s0', 's1', 's2', 's3', 's4'];
const nodePool = ['n0_0', 'n0_1', 'n0_2', 'n1_0', 'n1_1', 'n1_2', 'n2_0', 'n2_1', 'n2_2', 'nX'];
const linkPool = ['l0', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9'];

function execTopoOp(sys: TopologySystem, op: TopoOp) {
  switch (op.type) {
    case 'scene_create': {
      const parent = scenePool[op.parentIdx % scenePool.length];
      sys.scene_create(op.id, sys.getScene(parent) ? parent : undefined);
      break;
    }
    case 'scene_delete':
      sys.scene_delete(scenePool[op.idx % scenePool.length]);
      break;
    case 'node_create':
      sys.node_create(scenePool[op.sceneIdx % scenePool.length], op.id);
      break;
    case 'node_delete':
      sys.node_delete(nodePool[op.idx % nodePool.length]);
      break;
    case 'link_create': {
      const scene = scenePool[op.sceneIdx % scenePool.length];
      const from = nodePool[op.fromIdx % nodePool.length];
      const to = nodePool[op.toIdx % nodePool.length];
      sys.link_create(scene, op.id, from, to);
      break;
    }
    case 'link_delete':
      sys.link_delete(linkPool[op.idx % linkPool.length]);
      break;
  }
}

# L7层：微场景拓扑 — 属性测试任务

> **文件性质：历史执行 Prompt（方案 C — 属性实测轴，即工程验收的权威层编号）。已执行完毕。**
> 交付物：`kernel-l7-test`（38 项命名测试 / 465,000+ 次检查，PASS；报告 `REPORT.md`，未按 `L7_TEST_REPORT.md` 命名）。
> 13 层总体结果与层编号映射见 [`00_状态基线.md`](00_状态基线.md) §2.1 与 §3.2；
> 分发依据见 [`EXECUTE_ALL_TESTS.md`](EXECUTE_ALL_TESTS.md)。
> **注意**：各子项目内部使用的错误码（如 `E_INTENT_*`/`E_PHASE_*`）是测试工程本地命名，
> 不等于内核封闭注册表 `src/core/kernel/state/error-codes.ts` 的成员；两者对账属未执行的跨层门禁，
> 见 [`00_开放事项跟踪.md`](00_开放事项跟踪.md) **T-03**。

## 任务目标

**用代码说话，不要推理。**

实现L7层微场景/拓扑系统（Node/Link/Scene）+ 编写10万次属性测试 + 修复所有Bug + 提交报告。

---

## Step 1: 环境搭建

```bash
mkdir -p kernel-l7-test
cd kernel-l7-test
npm init -y
npm install fast-check typescript @types/node tsx vitest
npx tsc --init
```

---

## Step 2: 实现拓扑系统

```typescript
// src/topology.ts

export interface Node {
  id: string;
  sceneId: string;
  links: Set<string>; // link IDs
  entities: Set<string>; // entity IDs on this node
  attrs: Record<string, any>;
}

export interface Link {
  id: string;
  sceneId: string;
  from: string; // node ID
  to: string;   // node ID
  directed: boolean;
  attrs: Record<string, any>;
}

export interface Scene {
  id: string;
  parentId: string | null;
  nodes: Map<string, Node>;
  links: Map<string, Link>;
  childScenes: Set<string>;
}

export class TopologySystem {
  private scenes: Map<string, Scene> = new Map();
  private nodes: Map<string, Node> = new Map();
  private links: Map<string, Link> = new Map();

  // 创建场景
  scene_create(id: string, parentId?: string): Scene {
    if (parentId && !this.scenes.has(parentId)) {
      throw new Error('E_REF_INVALID');
    }
    const scene: Scene = {
      id,
      parentId: parentId ?? null,
      nodes: new Map(),
      links: new Map(),
      childScenes: new Set()
    };
    this.scenes.set(id, scene);
    if (parentId) {
      this.scenes.get(parentId)!.childScenes.add(id);
    }
    return scene;
  }

  // 删除场景（级联删除子场景和节点）
  scene_delete(id: string): void {
    const scene = this.scenes.get(id);
    if (!scene) throw new Error('E_REF_INVALID');

    // 级联删除子场景
    for (const childId of scene.childScenes) {
      this.scene_delete(childId);
    }

    // 删除所有节点
    for (const nodeId of scene.nodes.keys()) {
      this.node_delete(nodeId);
    }

    this.scenes.delete(id);
    if (scene.parentId) {
      this.scenes.get(scene.parentId)?.childScenes.delete(id);
    }
  }

  // 创建节点
  node_create(sceneId: string, nodeId: string): Node {
    if (!this.scenes.has(sceneId)) throw new Error('E_REF_INVALID');
    const node: Node = {
      id: nodeId,
      sceneId,
      links: new Set(),
      entities: new Set(),
      attrs: {}
    };
    this.nodes.set(nodeId, node);
    this.scenes.get(sceneId)!.nodes.set(nodeId, node);
    return node;
  }

  // 删除节点（级联删除相关Link）
  node_delete(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error('E_REF_INVALID');

    // 级联删除所有关联Link（INV-6）
    for (const linkId of [...node.links]) {
      this.link_delete(linkId);
    }

    this.nodes.delete(nodeId);
    this.scenes.get(node.sceneId)?.nodes.delete(nodeId);
  }

  // 创建Link
  link_create(sceneId: string, linkId: string, from: string, to: string, directed = false): Link {
    if (!this.nodes.has(from)) throw new Error('E_REF_INVALID');
    if (!this.nodes.has(to)) throw new Error('E_REF_INVALID');

    // 两端Node必须在同一Scene
    const fromNode = this.nodes.get(from)!;
    const toNode = this.nodes.get(to)!;
    if (fromNode.sceneId !== sceneId || toNode.sceneId !== sceneId) {
      throw new Error('E_LINK_CROSS_SCENE');
    }

    const link: Link = { id: linkId, sceneId, from, to, directed, attrs: {} };
    this.links.set(linkId, link);
    fromNode.links.add(linkId);
    toNode.links.add(linkId);
    this.scenes.get(sceneId)!.links.set(linkId, link);
    return link;
  }

  // 删除Link
  link_delete(linkId: string): void {
    const link = this.links.get(linkId);
    if (!link) return; // 幂等

    this.nodes.get(link.from)?.links.delete(linkId);
    this.nodes.get(link.to)?.links.delete(linkId);
    this.links.delete(linkId);
    this.scenes.get(link.sceneId)?.links.delete(linkId);
  }

  // 查询：两节点是否相邻
  are_adjacent(nodeA: string, nodeB: string): boolean {
    const node = this.nodes.get(nodeA);
    if (!node) return false;
    for (const linkId of node.links) {
      const link = this.links.get(linkId)!;
      if (link.from === nodeB || link.to === nodeB) return true;
    }
    return false;
  }

  // 检查拓扑不变量
  checkInvariants(): TopoViolation[] {
    const violations: TopoViolation[] = [];

    // INV-6: Link两端Node必须存在
    for (const link of this.links.values()) {
      if (!this.nodes.has(link.from)) {
        violations.push({ code: 'E_INV_DANGLING', detail: `link ${link.id} from=${link.from} missing` });
      }
      if (!this.nodes.has(link.to)) {
        violations.push({ code: 'E_INV_DANGLING', detail: `link ${link.id} to=${link.to} missing` });
      }
    }

    // INV-7: Node所在Scene必须存在
    for (const node of this.nodes.values()) {
      if (!this.scenes.has(node.sceneId)) {
        violations.push({ code: 'E_INV_DANGLING', detail: `node ${node.id} scene=${node.sceneId} missing` });
      }
    }

    // INV-7: 子Scene的parent必须存在
    for (const scene of this.scenes.values()) {
      if (scene.parentId && !this.scenes.has(scene.parentId)) {
        violations.push({ code: 'E_INV_DANGLING', detail: `scene ${scene.id} parent=${scene.parentId} missing` });
      }
    }

    // Link双向索引一致性
    for (const link of this.links.values()) {
      const fromNode = this.nodes.get(link.from);
      const toNode = this.nodes.get(link.to);
      if (fromNode && !fromNode.links.has(link.id)) {
        violations.push({ code: 'E_INV_INCONSISTENT', detail: `link ${link.id} not in from-node links` });
      }
      if (toNode && !toNode.links.has(link.id)) {
        violations.push({ code: 'E_INV_INCONSISTENT', detail: `link ${link.id} not in to-node links` });
      }
    }

    return violations;
  }

  getNode(id: string) { return this.nodes.get(id); }
  getLink(id: string) { return this.links.get(id); }
  getScene(id: string) { return this.scenes.get(id); }
}

interface TopoViolation { code: string; detail: string; }
```

---

## Step 3: 编写属性测试

```typescript
// test/l7-property.test.ts
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
            try { execTopoOp(sys, op); } catch {}
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

  // 属性测试2：Node删除后所有Link被级联删除（10万次）
  it('INV-6: node删除后关联Link消失', () => {
    fc.assert(
      fc.property(
        fc.constant(null),
        () => {
          const sys = new TopologySystem();
          const s = sys.scene_create('s1');
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
            sys.scene_create(`child${i}`, `child${i - 1 === 0 ? 'root' : 'child' + (i - 1)}`);
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
    // 有向时反向应不通（若实现支持有向性）
    // 若Spec未定义，此处记录UNDEF
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

const scenePool = ['s0','s1','s2','s3','s4'];
const nodePool = ['n0_0','n0_1','n0_2','n1_0','n1_1','n1_2','n2_0','n2_1','n2_2','nX'];
const linkPool = ['l0','l1','l2','l3','l4','l5','l6','l7','l8','l9'];

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
```

---

## Step 4: 执行测试

```bash
npx vitest run
```

---

## Step 5: 报告模板

```markdown
# L7层测试报告

## 测试执行
- 总测试数：XXX
- 通过：XXX / 失败：0
- 代码覆盖率：> 95%

## 修复的Bug

### Bug #N: [描述]
- 复现序列：[最小复现Op序列]
- 违反不变量：INV-X
- 修复：[修复代码]

## 结论
✅ 所有测试通过，L7层实现正确。
```

---

**开始执行。用代码说话，不要推理。**

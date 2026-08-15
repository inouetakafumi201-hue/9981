// L7层：微场景 / 拓扑系统（Node / Link / Scene）
//
// 语义契约：
//  - ID 唯一性：Scene / Node / Link 的 ID 在各自命名空间内全局唯一，重复创建抛 E_ID_DUPLICATE。
//  - 引用完整性（INV-6）：Link 两端 Node 必须存在；Node 删除级联删除其所有 Link。
//  - 场景归属（INV-7）：Node 必属于一个存在的 Scene；Scene 删除级联删除子孙 Scene / Node / Link。
//  - Link 不跨 Scene：两端 Node 与 Link 必须同属一个 Scene，否则 E_LINK_CROSS_SCENE。
//  - 自环 Link（from === to）显式允许，用于表达"原地动作"边。
//  - 有向性：directed=true 时仅 from→to 可通行；undirected 时双向可通行。
//  - 实体占位：一个 Entity 同一时刻最多位于一个 Node（由 entityIndex 保证）。
//  - 原子性：任何操作抛错时不留下部分写入。
//  - 幂等性：link_delete 对不存在的 ID 静默返回；node_delete / scene_delete 抛 E_REF_INVALID。
//  - 错误码可区分：entity_move 的三种失败原因各有独立错误码（实体未落位 /
//    目标节点不存在 / 目标不相邻），调用方据此可分辨失败原因而不必猜测。

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

export interface TopoViolation { code: string; detail: string; }

export const TopoError = {
  REF_INVALID: 'E_REF_INVALID',
  ID_DUPLICATE: 'E_ID_DUPLICATE',
  LINK_CROSS_SCENE: 'E_LINK_CROSS_SCENE',
  /** entity_move 的主体实体尚未落位 */
  ENTITY_NOT_PLACED: 'E_ENTITY_NOT_PLACED',
  /** entity_move 的目标 Node 存在，但与当前 Node 之间无可通行 Link */
  NOT_ADJACENT: 'E_NOT_ADJACENT'
} as const;

export class TopologySystem {
  private scenes: Map<string, Scene> = new Map();
  private nodes: Map<string, Node> = new Map();
  private links: Map<string, Link> = new Map();
  /** entityId -> nodeId，保证一个实体最多占一个 Node */
  private entityIndex: Map<string, string> = new Map();

  // ---------- Scene ----------

  /** 创建场景。parentId 给定时必须已存在。ID 重复抛 E_ID_DUPLICATE。 */
  scene_create(id: string, parentId?: string): Scene {
    if (this.scenes.has(id)) throw new Error(TopoError.ID_DUPLICATE);
    if (parentId !== undefined && !this.scenes.has(parentId)) {
      throw new Error(TopoError.REF_INVALID);
    }
    // 无需环检测：id 必须是全新的（上一行已拒绝重复），全新 id 不可能已有子孙，
    // 且 parentId 必须已存在（故 parentId !== id），因此新场景永远是叶子，不可能成环。

    const scene: Scene = {
      id,
      parentId: parentId ?? null,
      nodes: new Map(),
      links: new Map(),
      childScenes: new Set()
    };
    this.scenes.set(id, scene);
    if (parentId !== undefined) {
      this.scenes.get(parentId)!.childScenes.add(id);
    }
    return scene;
  }

  /** 删除场景，级联删除子孙场景、其下所有 Node 与 Link。 */
  scene_delete(id: string): void {
    const scene = this.scenes.get(id);
    if (!scene) throw new Error(TopoError.REF_INVALID);

    // 先摘除自身与父的挂接，避免递归过程中重复进入
    this.scenes.delete(id);
    if (scene.parentId !== null) {
      this.scenes.get(scene.parentId)?.childScenes.delete(id);
    }

    // 级联删除子场景（快照，避免迭代期变更）
    for (const childId of [...scene.childScenes]) {
      if (this.scenes.has(childId)) this.scene_delete(childId);
    }
    scene.childScenes.clear();

    // 删除所有节点（级联清理其 Link 与实体占位）
    for (const nodeId of [...scene.nodes.keys()]) {
      if (this.nodes.has(nodeId)) this.node_delete(nodeId);
    }
    scene.nodes.clear();

    // 兜底：清理任何仍挂在该场景下的 Link
    for (const linkId of [...scene.links.keys()]) {
      this.link_delete(linkId);
    }
    scene.links.clear();
  }

  // ---------- Node ----------

  /** 创建节点。sceneId 必须存在，nodeId 全局唯一。 */
  node_create(sceneId: string, nodeId: string): Node {
    const scene = this.scenes.get(sceneId);
    if (!scene) throw new Error(TopoError.REF_INVALID);
    if (this.nodes.has(nodeId)) throw new Error(TopoError.ID_DUPLICATE);

    const node: Node = {
      id: nodeId,
      sceneId,
      links: new Set(),
      entities: new Set(),
      attrs: {}
    };
    this.nodes.set(nodeId, node);
    scene.nodes.set(nodeId, node);
    return node;
  }

  /** 删除节点，级联删除其所有 Link（INV-6），并清除其上实体占位。 */
  node_delete(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(TopoError.REF_INVALID);

    for (const linkId of [...node.links]) {
      this.link_delete(linkId);
    }
    for (const entityId of [...node.entities]) {
      this.entityIndex.delete(entityId);
    }
    node.entities.clear();

    this.nodes.delete(nodeId);
    this.scenes.get(node.sceneId)?.nodes.delete(nodeId);
  }

  // ---------- Link ----------

  /** 创建 Link。校验全部先行，保证失败时无部分写入。 */
  link_create(sceneId: string, linkId: string, from: string, to: string, directed = false): Link {
    const scene = this.scenes.get(sceneId);
    if (!scene) throw new Error(TopoError.REF_INVALID);
    if (this.links.has(linkId)) throw new Error(TopoError.ID_DUPLICATE);

    const fromNode = this.nodes.get(from);
    if (!fromNode) throw new Error(TopoError.REF_INVALID);
    const toNode = this.nodes.get(to);
    if (!toNode) throw new Error(TopoError.REF_INVALID);

    // 两端 Node 必须与 Link 同属一个 Scene
    if (fromNode.sceneId !== sceneId || toNode.sceneId !== sceneId) {
      throw new Error(TopoError.LINK_CROSS_SCENE);
    }

    const link: Link = { id: linkId, sceneId, from, to, directed, attrs: {} };
    this.links.set(linkId, link);
    fromNode.links.add(linkId);
    toNode.links.add(linkId); // 自环时为同一 Set，add 幂等
    scene.links.set(linkId, link);
    return link;
  }

  /** 删除 Link。不存在时静默返回（幂等）。 */
  link_delete(linkId: string): void {
    const link = this.links.get(linkId);
    if (!link) return;

    this.links.delete(linkId);
    this.nodes.get(link.from)?.links.delete(linkId);
    this.nodes.get(link.to)?.links.delete(linkId);
    this.scenes.get(link.sceneId)?.links.delete(linkId);
  }

  // ---------- 实体占位 ----------

  /** 把实体放到节点上。实体若已在别处，先行移除（保证唯一占位）。 */
  entity_place(nodeId: string, entityId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(TopoError.REF_INVALID);

    const prev = this.entityIndex.get(entityId);
    if (prev !== undefined && prev !== nodeId) {
      this.nodes.get(prev)?.entities.delete(entityId);
    }
    node.entities.add(entityId);
    this.entityIndex.set(entityId, nodeId);
  }

  /** 移除实体占位。不存在时静默返回（幂等）。 */
  entity_remove(entityId: string): void {
    const nodeId = this.entityIndex.get(entityId);
    if (nodeId === undefined) return;
    this.nodes.get(nodeId)?.entities.delete(entityId);
    this.entityIndex.delete(entityId);
  }

  /**
   * 沿 Link 移动实体。三种失败模式各有独立错误码，调用方可据此区分：
   *  - 实体尚未落位            → E_ENTITY_NOT_PLACED
   *  - 目标 Node 不存在        → E_REF_INVALID
   *  - 目标存在但不可达        → E_NOT_ADJACENT
   * 任一失败均不改变状态。
   */
  entity_move(entityId: string, toNodeId: string): void {
    const fromNodeId = this.entityIndex.get(entityId);
    if (fromNodeId === undefined) throw new Error(TopoError.ENTITY_NOT_PLACED);
    if (!this.nodes.has(toNodeId)) throw new Error(TopoError.REF_INVALID);
    if (fromNodeId !== toNodeId && !this.are_adjacent(fromNodeId, toNodeId)) {
      throw new Error(TopoError.NOT_ADJACENT);
    }
    this.entity_place(toNodeId, entityId);
  }

  entity_locate(entityId: string): string | undefined {
    return this.entityIndex.get(entityId);
  }

  // ---------- 查询 ----------

  /** nodeA 是否可沿一条 Link 直达 nodeB。有向 Link 只在 from→to 方向成立。 */
  are_adjacent(nodeA: string, nodeB: string): boolean {
    const node = this.nodes.get(nodeA);
    if (!node) return false;
    if (!this.nodes.has(nodeB)) return false;

    for (const linkId of node.links) {
      const link = this.links.get(linkId);
      if (!link) continue; // 防御：不信任索引
      if (link.from === nodeA && link.to === nodeB) return true;
      if (!link.directed && link.to === nodeA && link.from === nodeB) return true;
    }
    return false;
  }

  /** nodeA 的所有可达邻居（遵循有向性）。 */
  neighbors(nodeA: string): string[] {
    const node = this.nodes.get(nodeA);
    if (!node) return [];
    const out = new Set<string>();
    for (const linkId of node.links) {
      const link = this.links.get(linkId);
      if (!link) continue;
      if (link.from === nodeA) out.add(link.to);
      if (!link.directed && link.to === nodeA) out.add(link.from);
    }
    return [...out];
  }
  // ---------- 不变量 ----------

  /** 全量结构自检。返回空数组表示拓扑一致。 */
  checkInvariants(): TopoViolation[] {
    const v: TopoViolation[] = [];
    const push = (code: string, detail: string) => v.push({ code, detail });

    // INV-6: Link 两端 Node 必须存在，且不跨 Scene
    for (const link of this.links.values()) {
      const fromNode = this.nodes.get(link.from);
      const toNode = this.nodes.get(link.to);
      if (!fromNode) push('E_INV_DANGLING', `link ${link.id} from=${link.from} missing`);
      if (!toNode) push('E_INV_DANGLING', `link ${link.id} to=${link.to} missing`);
      if (!this.scenes.has(link.sceneId)) {
        push('E_INV_DANGLING', `link ${link.id} scene=${link.sceneId} missing`);
      }
      if (fromNode && fromNode.sceneId !== link.sceneId) {
        push('E_INV_CROSS_SCENE', `link ${link.id} from-node scene mismatch`);
      }
      if (toNode && toNode.sceneId !== link.sceneId) {
        push('E_INV_CROSS_SCENE', `link ${link.id} to-node scene mismatch`);
      }
      // 双向索引：两端 Node 必须持有该 Link
      if (fromNode && !fromNode.links.has(link.id)) {
        push('E_INV_INCONSISTENT', `link ${link.id} not in from-node links`);
      }
      if (toNode && !toNode.links.has(link.id)) {
        push('E_INV_INCONSISTENT', `link ${link.id} not in to-node links`);
      }
      // Scene 索引必须持有该 Link，且是同一对象
      const sceneLink = this.scenes.get(link.sceneId)?.links.get(link.id);
      if (sceneLink !== link) {
        push('E_INV_INCONSISTENT', `link ${link.id} missing/mismatched in scene index`);
      }
    }

    // INV-7: Node 所在 Scene 必须存在，且 Scene 索引指向同一对象
    for (const node of this.nodes.values()) {
      const scene = this.scenes.get(node.sceneId);
      if (!scene) {
        push('E_INV_DANGLING', `node ${node.id} scene=${node.sceneId} missing`);
      } else if (scene.nodes.get(node.id) !== node) {
        push('E_INV_INCONSISTENT', `node ${node.id} missing/mismatched in scene index`);
      }
      // 反向索引：Node 持有的每个 Link 必须存在且真的连着它
      for (const linkId of node.links) {
        const link = this.links.get(linkId);
        if (!link) {
          push('E_INV_STALE_REF', `node ${node.id} holds stale link ${linkId}`);
        } else if (link.from !== node.id && link.to !== node.id) {
          push('E_INV_INCONSISTENT', `node ${node.id} holds unrelated link ${linkId}`);
        }
      }
      // 实体占位一致性
      for (const entityId of node.entities) {
        if (this.entityIndex.get(entityId) !== node.id) {
          push('E_INV_INCONSISTENT', `entity ${entityId} on node ${node.id} not in index`);
        }
      }
    }

    // Scene 树完整性
    for (const scene of this.scenes.values()) {
      if (scene.parentId !== null) {
        const parent = this.scenes.get(scene.parentId);
        if (!parent) {
          push('E_INV_DANGLING', `scene ${scene.id} parent=${scene.parentId} missing`);
        } else if (!parent.childScenes.has(scene.id)) {
          push('E_INV_INCONSISTENT', `scene ${scene.id} not in parent's childScenes`);
        }
      }
      for (const childId of scene.childScenes) {
        const child = this.scenes.get(childId);
        if (!child) {
          push('E_INV_STALE_REF', `scene ${scene.id} holds stale child ${childId}`);
        } else if (child.parentId !== scene.id) {
          push('E_INV_INCONSISTENT', `scene ${scene.id} child ${childId} disowns parent`);
        }
      }
      // Scene 索引里的 Node / Link 必须在全局存在且归属正确
      for (const [nodeId, node] of scene.nodes) {
        if (this.nodes.get(nodeId) !== node) {
          push('E_INV_STALE_REF', `scene ${scene.id} holds stale node ${nodeId}`);
        } else if (node.sceneId !== scene.id) {
          push('E_INV_INCONSISTENT', `scene ${scene.id} holds node ${nodeId} owned by ${node.sceneId}`);
        }
      }
      for (const [linkId, link] of scene.links) {
        if (this.links.get(linkId) !== link) {
          push('E_INV_STALE_REF', `scene ${scene.id} holds stale link ${linkId}`);
        } else if (link.sceneId !== scene.id) {
          push('E_INV_INCONSISTENT', `scene ${scene.id} holds link ${linkId} owned by ${link.sceneId}`);
        }
      }
    }

    // Scene 树必须无环。seen 单调增长且 scenes 有限，循环必然终止，无需额外计数守卫。
    for (const startId of this.scenes.keys()) {
      const seen = new Set<string>([startId]);
      let cur = this.scenes.get(startId)!.parentId;
      while (cur !== null) {
        if (seen.has(cur)) {
          push('E_INV_CYCLE', `scene ${startId} has cyclic ancestry at ${cur}`);
          break;
        }
        seen.add(cur);
        cur = this.scenes.get(cur)?.parentId ?? null;
      }
    }

    // 实体索引反向一致性
    for (const [entityId, nodeId] of this.entityIndex) {
      const node = this.nodes.get(nodeId);
      if (!node) {
        push('E_INV_DANGLING', `entity ${entityId} on missing node ${nodeId}`);
      } else if (!node.entities.has(entityId)) {
        push('E_INV_INCONSISTENT', `entity ${entityId} indexed to ${nodeId} but not on it`);
      }
    }

    return v;
  }


  getNode(id: string) { return this.nodes.get(id); }
  getLink(id: string) { return this.links.get(id); }
  getScene(id: string) { return this.scenes.get(id); }

  /** 只读快照，供测试做全量结构比对。 */
  snapshot() {
    return {
      sceneIds: [...this.scenes.keys()].sort(),
      nodeIds: [...this.nodes.keys()].sort(),
      linkIds: [...this.links.keys()].sort(),
      entityIds: [...this.entityIndex.keys()].sort()
    };
  }
}

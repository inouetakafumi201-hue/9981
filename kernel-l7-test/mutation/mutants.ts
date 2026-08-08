// 变异测试语料：每个变异体是对 src/topology.ts 的一处"看似合理"的改动。
// 一个健康的测试套件必须让每个变异体至少有一条测试失败（被"杀死"）。
// 存活的变异体 = 测试盲区（或可证明的等价变异）。

export interface Mutant {
  id: string;
  desc: string;
  find: string;
  replace: string;
}

export const MUTANTS: Mutant[] = [
  // ---------- 组 A：ID 唯一性（对应已修 BUG#1/3/4/5） ----------
  {
    id: 'M01',
    desc: 'scene_create 不再拒绝重复 sceneId',
    find: '    if (this.scenes.has(id)) throw new Error(TopoError.ID_DUPLICATE);',
    replace: '    /* mutated: no dup check */'
  },
  {
    id: 'M02',
    desc: 'node_create 不再拒绝重复 nodeId',
    find: '    if (this.nodes.has(nodeId)) throw new Error(TopoError.ID_DUPLICATE);',
    replace: '    /* mutated: no dup check */'
  },
  {
    id: 'M03',
    desc: 'link_create 不再拒绝重复 linkId',
    find: '    if (this.links.has(linkId)) throw new Error(TopoError.ID_DUPLICATE);',
    replace: '    /* mutated: no dup check */'
  },

  // ---------- 组 B：引用校验 ----------
  {
    id: 'M04',
    desc: 'scene_create 不校验 parentId 是否存在',
    find:
      '    if (parentId !== undefined && !this.scenes.has(parentId)) {\n' +
      '      throw new Error(TopoError.REF_INVALID);\n' +
      '    }',
    replace: '    /* mutated: no parent check */'
  },
  {
    id: 'M05',
    desc: 'node_create 不校验 sceneId 是否存在',
    find:
      '    const scene = this.scenes.get(sceneId);\n' +
      '    if (!scene) throw new Error(TopoError.REF_INVALID);\n' +
      '    if (this.nodes.has(nodeId)) throw new Error(TopoError.ID_DUPLICATE);',
    replace:
      '    const scene = this.scenes.get(sceneId)!;\n' +
      '    if (this.nodes.has(nodeId)) throw new Error(TopoError.ID_DUPLICATE);'
  },
  {
    id: 'M06',
    desc: 'link_create 不校验所属 Scene 是否存在',
    find:
      '    const scene = this.scenes.get(sceneId);\n' +
      '    if (!scene) throw new Error(TopoError.REF_INVALID);\n' +
      '    if (this.links.has(linkId)) throw new Error(TopoError.ID_DUPLICATE);',
    replace:
      '    const scene = this.scenes.get(sceneId)!;\n' +
      '    if (this.links.has(linkId)) throw new Error(TopoError.ID_DUPLICATE);'
  },
  {
    id: 'M07',
    desc: 'link_create 不校验 from 端 Node 存在',
    find:
      '    const fromNode = this.nodes.get(from);\n' +
      '    if (!fromNode) throw new Error(TopoError.REF_INVALID);',
    replace: '    const fromNode = this.nodes.get(from)!;'
  },
  {
    id: 'M08',
    desc: 'link_create 不校验 to 端 Node 存在',
    find:
      '    const toNode = this.nodes.get(to);\n' +
      '    if (!toNode) throw new Error(TopoError.REF_INVALID);',
    replace: '    const toNode = this.nodes.get(to)!;'
  },
  {
    id: 'M09',
    desc: 'link_create 不再拒绝跨 Scene 的 Link',
    find:
      '    if (fromNode.sceneId !== sceneId || toNode.sceneId !== sceneId) {\n' +
      '      throw new Error(TopoError.LINK_CROSS_SCENE);\n' +
      '    }',
    replace: '    /* mutated: cross-scene allowed */'
  },
  {
    id: 'M10',
    desc: 'link_create 只检查 from 端的场景归属（漏检 to 端）',
    find: '    if (fromNode.sceneId !== sceneId || toNode.sceneId !== sceneId) {',
    replace: '    if (fromNode.sceneId !== sceneId) {'
  },
  {
    id: 'M11',
    desc: 'link_create 只检查 to 端的场景归属（漏检 from 端）',
    find: '    if (fromNode.sceneId !== sceneId || toNode.sceneId !== sceneId) {',
    replace: '    if (toNode.sceneId !== sceneId) {'
  },
  {
    id: 'M12',
    desc: 'node_delete 对不存在 ID 静默返回而非抛错',
    find:
      '    const node = this.nodes.get(nodeId);\n' +
      '    if (!node) throw new Error(TopoError.REF_INVALID);\n' +
      '\n' +
      '    for (const linkId of [...node.links]) {',
    replace:
      '    const node = this.nodes.get(nodeId);\n' +
      '    if (!node) return;\n' +
      '\n' +
      '    for (const linkId of [...node.links]) {'
  },
  {
    id: 'M13',
    desc: 'scene_delete 对不存在 ID 静默返回而非抛错',
    find:
      '    const scene = this.scenes.get(id);\n' +
      '    if (!scene) throw new Error(TopoError.REF_INVALID);',
    replace:
      '    const scene = this.scenes.get(id);\n' +
      '    if (!scene) return;'
  },
  {
    id: 'M14',
    desc: 'link_delete 丧失幂等性，对不存在 ID 抛错',
    find:
      '    const link = this.links.get(linkId);\n' +
      '    if (!link) return;',
    replace:
      '    const link = this.links.get(linkId);\n' +
      '    if (!link) throw new Error(TopoError.REF_INVALID);'
  },
  {
    id: 'M15',
    desc: 'entity_remove 丧失幂等性',
    find:
      '    const nodeId = this.entityIndex.get(entityId);\n' +
      '    if (nodeId === undefined) return;',
    replace:
      '    const nodeId = this.entityIndex.get(entityId);\n' +
      '    if (nodeId === undefined) throw new Error(TopoError.REF_INVALID);'
  },
  // ---- 级联删除：漏掉某一步清理 ----
  {
    id: 'M16',
    desc: 'node_delete 不级联删除关联 Link（INV-6 原始违反）',
    find:
      '    for (const linkId of [...node.links]) {\n' +
      '      this.link_delete(linkId);\n' +
      '    }',
    replace: '    /* mutated: no link cascade */'
  },
  {
    id: 'M17',
    desc: 'node_delete 不清除其上实体占位',
    find:
      '    for (const entityId of [...node.entities]) {\n' +
      '      this.entityIndex.delete(entityId);\n' +
      '    }\n' +
      '    node.entities.clear();',
    replace: '    /* mutated: entities left indexed */'
  },
  {
    id: 'M18',
    desc: 'node_delete 不从全局 nodes 移除',
    find: '    this.nodes.delete(nodeId);\n    this.scenes.get(node.sceneId)?.nodes.delete(nodeId);',
    replace: '    this.scenes.get(node.sceneId)?.nodes.delete(nodeId);'
  },
  {
    id: 'M19',
    desc: 'node_delete 不从所属 Scene 的索引移除',
    find: '    this.nodes.delete(nodeId);\n    this.scenes.get(node.sceneId)?.nodes.delete(nodeId);',
    replace: '    this.nodes.delete(nodeId);'
  },
  {
    id: 'M20',
    desc: 'scene_delete 不级联删除子场景',
    find:
      '    for (const childId of [...scene.childScenes]) {\n' +
      '      if (this.scenes.has(childId)) this.scene_delete(childId);\n' +
      '    }\n' +
      '    scene.childScenes.clear();',
    replace: '    /* mutated: no child-scene cascade */'
  },
  {
    id: 'M21',
    desc: 'scene_delete 不级联删除其下 Node',
    find:
      '    for (const nodeId of [...scene.nodes.keys()]) {\n' +
      '      if (this.nodes.has(nodeId)) this.node_delete(nodeId);\n' +
      '    }\n' +
      '    scene.nodes.clear();',
    replace: '    /* mutated: no node cascade */'
  },
  {
    id: 'M22',
    desc: 'scene_delete 不从父场景的 childScenes 摘除',
    find:
      '    if (scene.parentId !== null) {\n' +
      '      this.scenes.get(scene.parentId)?.childScenes.delete(id);\n' +
      '    }',
    replace: '    /* mutated: parent still lists deleted child */'
  },
  {
    id: 'M23',
    desc: 'scene_delete 先递归后摘除自身（重入导致无限递归）',
    find:
      '    this.scenes.delete(id);\n' +
      '    if (scene.parentId !== null) {',
    replace:
      '    /* mutated: self-detach deferred */\n' +
      '    if (scene.parentId !== null) {'
  },
  {
    id: 'M24',
    desc: 'link_delete 不从 from 端 Node 的 links 移除（留下陈旧引用）',
    find: '    this.nodes.get(link.from)?.links.delete(linkId);\n    this.nodes.get(link.to)?.links.delete(linkId);',
    replace: '    this.nodes.get(link.to)?.links.delete(linkId);'
  },
  {
    id: 'M25',
    desc: 'link_delete 不从 to 端 Node 的 links 移除',
    find: '    this.nodes.get(link.from)?.links.delete(linkId);\n    this.nodes.get(link.to)?.links.delete(linkId);',
    replace: '    this.nodes.get(link.from)?.links.delete(linkId);'
  },
  {
    id: 'M26',
    desc: 'link_delete 不从 Scene 的 links 索引移除',
    find: '    this.scenes.get(link.sceneId)?.links.delete(linkId);',
    replace: '    /* mutated: scene link index stale */'
  },
  {
    id: 'M27',
    desc: 'link_delete 不从全局 links 移除',
    find: '    this.links.delete(linkId);\n    this.nodes.get(link.from)?.links.delete(linkId);',
    replace: '    this.nodes.get(link.from)?.links.delete(linkId);'
  },
  // ---- 双向索引：创建时漏建 ----
  {
    id: 'M28',
    desc: 'link_create 不把 Link 加进 from 端 Node',
    find: '    fromNode.links.add(linkId);\n    toNode.links.add(linkId); // 自环时为同一 Set，add 幂等',
    replace: '    toNode.links.add(linkId);'
  },
  {
    id: 'M29',
    desc: 'link_create 不把 Link 加进 to 端 Node',
    find: '    fromNode.links.add(linkId);\n    toNode.links.add(linkId); // 自环时为同一 Set，add 幂等',
    replace: '    fromNode.links.add(linkId);'
  },
  {
    id: 'M30',
    desc: 'link_create 不写 Scene 的 links 索引',
    find: '    scene.links.set(linkId, link);',
    replace: '    /* mutated: scene link index not written */'
  },
  {
    id: 'M31',
    desc: 'node_create 不写 Scene 的 nodes 索引',
    find: '    this.nodes.set(nodeId, node);\n    scene.nodes.set(nodeId, node);',
    replace: '    this.nodes.set(nodeId, node);'
  },
  {
    id: 'M32',
    desc: 'scene_create 不把自己加进父的 childScenes',
    find:
      '    if (parentId !== undefined) {\n' +
      '      this.scenes.get(parentId)!.childScenes.add(id);\n' +
      '    }',
    replace: '    /* mutated: parent does not list child */'
  },
  // ---- 有向性（BUG#2 家族）----
  {
    id: 'M33',
    desc: 'are_adjacent 忽略 directed（基线原始 BUG#2）',
    find: '      if (!link.directed && link.to === nodeA && link.from === nodeB) return true;',
    replace: '      if (link.to === nodeA && link.from === nodeB) return true;'
  },
  {
    id: 'M34',
    desc: 'are_adjacent 无向 Link 也只单向可达',
    find: '      if (!link.directed && link.to === nodeA && link.from === nodeB) return true;',
    replace: '      /* mutated: undirected reverse dropped */'
  },
  {
    id: 'M35',
    desc: 'are_adjacent 丢掉正向判定',
    find: '      if (link.from === nodeA && link.to === nodeB) return true;',
    replace: '      /* mutated: forward direction dropped */'
  },
  {
    id: 'M36',
    desc: 'neighbors 忽略 directed',
    find: '      if (!link.directed && link.to === nodeA) out.add(link.from);',
    replace: '      if (link.to === nodeA) out.add(link.from);'
  },
  {
    id: 'M37',
    desc: 'neighbors 丢掉无向反向邻居',
    find: '      if (!link.directed && link.to === nodeA) out.add(link.from);',
    replace: '      /* mutated: undirected reverse neighbor dropped */'
  },
  {
    id: 'M38',
    desc: 'neighbors 丢掉正向邻居',
    find: '      if (link.from === nodeA) out.add(link.to);',
    replace: '      /* mutated: forward neighbor dropped */'
  },
  // ---- 实体占位 ----
  {
    id: 'M39',
    desc: 'entity_place 不摘除实体在旧 Node 的占位（一实体多处）',
    find:
      '    const prev = this.entityIndex.get(entityId);\n' +
      '    if (prev !== undefined && prev !== nodeId) {\n' +
      '      this.nodes.get(prev)?.entities.delete(entityId);\n' +
      '    }',
    replace: '    /* mutated: previous placement retained */'
  },
  {
    id: 'M40',
    desc: 'entity_place 摘除条件反转（把自己刚放的摘掉）',
    find: '    if (prev !== undefined && prev !== nodeId) {',
    replace: '    if (prev !== undefined && prev === nodeId) {'
  },
  {
    id: 'M41',
    desc: 'entity_place 不写 entityIndex',
    find: '    node.entities.add(entityId);\n    this.entityIndex.set(entityId, nodeId);',
    replace: '    node.entities.add(entityId);'
  },
  {
    id: 'M42',
    desc: 'entity_place 不写 node.entities',
    find: '    node.entities.add(entityId);\n    this.entityIndex.set(entityId, nodeId);',
    replace: '    this.entityIndex.set(entityId, nodeId);'
  },
  {
    id: 'M43',
    desc: 'entity_remove 不从 node.entities 移除',
    find: '    this.nodes.get(nodeId)?.entities.delete(entityId);\n    this.entityIndex.delete(entityId);',
    replace: '    this.entityIndex.delete(entityId);'
  },
  {
    id: 'M44',
    desc: 'entity_remove 不从 entityIndex 移除',
    find: '    this.nodes.get(nodeId)?.entities.delete(entityId);\n    this.entityIndex.delete(entityId);',
    replace: '    this.nodes.get(nodeId)?.entities.delete(entityId);'
  },
  {
    id: 'M45',
    desc: 'entity_move 不校验相邻（允许瞬移）',
    find:
      '    if (fromNodeId !== toNodeId && !this.are_adjacent(fromNodeId, toNodeId)) {\n' +
      '      throw new Error(TopoError.NOT_ADJACENT);\n' +
      '    }',
    replace: '    /* mutated: teleport allowed */'
  },
  {
    id: 'M46',
    desc: 'entity_move 不校验实体已落位',
    find: '    if (fromNodeId === undefined) throw new Error(TopoError.ENTITY_NOT_PLACED);',
    replace: '    /* mutated: unplaced entity may move */'
  },
  {
    id: 'M47',
    desc: 'entity_move 不校验目标 Node 存在',
    find: '    if (!this.nodes.has(toNodeId)) throw new Error(TopoError.REF_INVALID);',
    replace: '    /* mutated: target existence unchecked */'
  },
  // ---- 不变量检查器自身（防止 oracle 空转）----
  {
    id: 'M48',
    desc: 'checkInvariants 恒返回空数组（oracle 被掏空）',
    find: '    return v;\n  }\n\n\n  getNode',
    replace: '    return [];\n  }\n\n\n  getNode'
  },
  {
    id: 'M49',
    desc: 'checkInvariants 去掉环检测',
    find:
      '    for (const startId of this.scenes.keys()) {\n' +
      '      const seen = new Set<string>([startId]);\n' +
      '      let cur = this.scenes.get(startId)!.parentId;\n' +
      '      while (cur !== null) {\n' +
      '        if (seen.has(cur)) {',
    replace:
      '    for (const startId of [] as string[]) {\n' +
      '      const seen = new Set<string>([startId]);\n' +
      '      let cur = this.scenes.get(startId)!.parentId;\n' +
      '      while (cur !== null) {\n' +
      '        if (seen.has(cur)) {'
  },
  {
    id: 'M50',
    desc: 'checkInvariants 去掉 Node 持有陈旧 Link 的检测',
    find:
      '        if (!link) {\n' +
      "          push('E_INV_STALE_REF', `node ${node.id} holds stale link ${linkId}`);",
    replace:
      '        if (false) {\n' +
      "          push('E_INV_STALE_REF', `node ${node.id} holds stale link ${linkId}`);"
  },
  {
    id: 'M51',
    desc: 'checkInvariants 去掉实体索引反向一致性检测',
    find: '    for (const [entityId, nodeId] of this.entityIndex) {',
    replace: '    for (const [entityId, nodeId] of [] as [string, string][]) {'
  },
  // ---- 原子性 ----
  {
    id: 'M52',
    desc: 'link_create 跨场景校验挪到写入之后（部分写入）',
    find:
      '    if (fromNode.sceneId !== sceneId || toNode.sceneId !== sceneId) {\n' +
      '      throw new Error(TopoError.LINK_CROSS_SCENE);\n' +
      '    }\n' +
      '\n' +
      '    const link: Link = { id: linkId, sceneId, from, to, directed, attrs: {} };\n' +
      '    this.links.set(linkId, link);',
    replace:
      '    const link: Link = { id: linkId, sceneId, from, to, directed, attrs: {} };\n' +
      '    this.links.set(linkId, link);\n' +
      '    if (fromNode.sceneId !== sceneId || toNode.sceneId !== sceneId) {\n' +
      '      throw new Error(TopoError.LINK_CROSS_SCENE);\n' +
      '    }'
  },
  // ---- 预期等价变异（JS 迭代器语义下与原代码同义，用于校准）----
  {
    id: 'M53',
    desc: '[预期等价] scene_delete 迭代 childScenes 不做快照',
    find: '    for (const childId of [...scene.childScenes]) {',
    replace: '    for (const childId of scene.childScenes) {',
    expectEquivalent: true
  },
  {
    id: 'M54',
    desc: '[预期等价] scene_delete 迭代 nodes 不做快照',
    find: '    for (const nodeId of [...scene.nodes.keys()]) {',
    replace: '    for (const nodeId of scene.nodes.keys()) {',
    expectEquivalent: true
  },
  {
    id: 'M55',
    desc: '[预期等价] node_delete 迭代 links 不做快照',
    find: '    for (const linkId of [...node.links]) {',
    replace: '    for (const linkId of node.links) {',
    expectEquivalent: true
  },

  // ---- 错误码区分度：验证测试断言的是"哪个错误"，而非"抛了错" ----
  {
    id: 'M56',
    desc: 'entity_move 未落位时错报 E_REF_INVALID（错误码退化）',
    find: '    if (fromNodeId === undefined) throw new Error(TopoError.ENTITY_NOT_PLACED);',
    replace: '    if (fromNodeId === undefined) throw new Error(TopoError.REF_INVALID);'
  },
  {
    id: 'M57',
    desc: 'entity_move 不相邻时错报 E_REF_INVALID（错误码退化）',
    find: '      throw new Error(TopoError.NOT_ADJACENT);',
    replace: '      throw new Error(TopoError.REF_INVALID);'
  },
  {
    id: 'M58',
    desc: 'link_create 跨场景时错报 E_REF_INVALID 而非 E_LINK_CROSS_SCENE',
    find: '      throw new Error(TopoError.LINK_CROSS_SCENE);',
    replace: '      throw new Error(TopoError.REF_INVALID);'
  },
  {
    id: 'M59',
    desc: 'node_create 重复 ID 时错报 E_REF_INVALID 而非 E_ID_DUPLICATE',
    find: '    if (this.nodes.has(nodeId)) throw new Error(TopoError.ID_DUPLICATE);',
    replace: '    if (this.nodes.has(nodeId)) throw new Error(TopoError.REF_INVALID);'
  },
  {
    id: 'M60',
    desc: 'scene_create 重复 ID 时错报 E_REF_INVALID 而非 E_ID_DUPLICATE',
    find: '    if (this.scenes.has(id)) throw new Error(TopoError.ID_DUPLICATE);',
    replace: '    if (this.scenes.has(id)) throw new Error(TopoError.REF_INVALID);'
  }
];

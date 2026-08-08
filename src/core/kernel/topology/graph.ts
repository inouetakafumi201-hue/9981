/**
 * L1 Topology: Node/Link 基本操作与级联销毁（design.md 3.2节 / 需求7.1-7.6）。
 * 本文件提供纯函数式的图操作 helper，供 L3 的 node.create/node.destroy/link.create/link.destroy
 * 这些公开 Op 内部调用（写入通道情形b）——本文件本身不持有 WorldState 写权限，只操作传入的普通对象快照。
 */
import type { Id } from '../state/ids.js';
import type { Node, Link } from './types.js';

/** 计算销毁一个 Node 时应级联销毁的全部 Link Id（需求7.5）。 */
export function linksTouching(links: Record<Id, Link>, nodeId: Id): Id[] {
  return Object.values(links)
    .filter((l) => l.a === nodeId || l.b === nodeId)
    .map((l) => l.id);
}

/** 拓扑允许不连通分量（需求7.6）：这里提供一个连通分量划分的纯函数，用于测试断言，不在内核运行期强制调用。 */
export function connectedComponents(nodes: Record<Id, Node>, links: Record<Id, Link>): Id[][] {
  const adjacency = new Map<Id, Id[]>();
  for (const id of Object.keys(nodes)) adjacency.set(id, []);
  for (const link of Object.values(links)) {
    adjacency.get(link.a)?.push(link.b);
    adjacency.get(link.b)?.push(link.a);
  }
  const visited = new Set<Id>();
  const components: Id[][] = [];
  for (const id of Object.keys(nodes)) {
    if (visited.has(id)) continue;
    const component: Id[] = [];
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop() as Id;
      if (visited.has(cur)) continue;
      visited.add(cur);
      component.push(cur);
      for (const next of adjacency.get(cur) ?? []) {
        if (!visited.has(next)) stack.push(next);
      }
    }
    components.push(component);
  }
  return components;
}

/** 计算销毁一个 Node 时应级联销毁的子节点集合（parent 指向该节点，需求20.7 父子一致不变量）。 */
export function childNodesOf(nodes: Record<Id, Node>, parentId: Id): Id[] {
  return Object.values(nodes)
    .filter((n) => n.parent === parentId)
    .map((n) => n.id);
}

/** 递归计算全部级联销毁的节点集合（父节点销毁 -> 子节点级联销毁 -> 子节点的子节点...）。 */
export function cascadeNodeDestroySet(nodes: Record<Id, Node>, rootId: Id): Set<Id> {
  const result = new Set<Id>();
  const stack = [rootId];
  while (stack.length > 0) {
    const cur = stack.pop() as Id;
    if (result.has(cur)) continue;
    result.add(cur);
    for (const child of childNodesOf(nodes, cur)) stack.push(child);
  }
  return result;
}

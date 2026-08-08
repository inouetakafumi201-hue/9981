/**
 * L1 Topology: Prefab 定义与子图实例化（design.md 3.2节 / 需求8.1-8.7）。
 * prefab.spawn/prefab.despawn 作为公开 Op 在 L3 注册；本文件提供纯函数的 key 重映射与
 * 预制结构展开计算逻辑，供那两个 Op 的实现内部调用。
 */
import type { Id } from '../state/ids.js';
import type { Expr } from '../state/expr-types.js';
import type { Def } from '../state/def.js';

export interface PrefabDef extends Def {
  readonly kind: 'prefab';
  readonly nodes: { key: string; def: Id; props?: Record<string, Expr> }[];
  readonly links: { a: string; b: string; def: Id; directed?: boolean }[];
  readonly entities?: { at: string; def: Id; overrides?: Record<string, Expr> }[];
  readonly attachTo?: string;
}

export interface PrefabHandle {
  readonly nodes: Id[];
  readonly links: Id[];
  readonly entities: Id[];
  readonly root: Id;
}

/**
 * 计算预制结构内部 key -> 新分配 Id 的映射表。调用方（prefab.spawn 的 Op 实现）先用 idAllocator
 * 为每个预制结构 key 分配实际 Id，再调用本函数得到重映射表，最后按重映射表实际创建节点/边/实体。
 */
export function buildKeyToIdMap(prefab: PrefabDef, idAllocator: () => Id): Map<string, Id> {
  const map = new Map<string, Id>();
  for (const nodeSpec of prefab.nodes) {
    map.set(nodeSpec.key, idAllocator());
  }
  return map;
}

/** 将预制结构内 Link 的 a/b key 引用重映射为实际 Id（需求8.2）。 */
export function remapLinks(prefab: PrefabDef, keyToId: Map<string, Id>): { a: Id; b: Id; def: Id; directed?: boolean }[] {
  return prefab.links.map((l) => {
    const a = keyToId.get(l.a);
    const b = keyToId.get(l.b);
    if (a === undefined || b === undefined) {
      throw new Error(`prefab link 引用了未声明的 key: ${l.a} 或 ${l.b}`);
    }
    return { a, b, def: l.def, directed: l.directed };
  });
}

/** 计算 attachTo 接缝：预制结构 root 节点的实际 Id（需求8.3）。 */
export function resolveAttachToRoot(prefab: PrefabDef, keyToId: Map<string, Id>): Id | null {
  if (!prefab.attachTo) return null;
  return keyToId.get(prefab.attachTo) ?? null;
}

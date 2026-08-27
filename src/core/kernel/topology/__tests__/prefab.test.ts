import { describe, it, expect } from 'vitest';
import { buildKeyToIdMap, remapLinks, resolveAttachToRoot } from '../prefab';
import type { PrefabDef } from '../prefab';

function makePrefab(): PrefabDef {
  return {
    id: 'p:room',
    kind: 'prefab',
    nodes: [
      { key: 'root', def: 'd:room' },
      { key: 'annex', def: 'd:room' },
    ],
    links: [{ a: 'root', b: 'annex', def: 'd:door' }],
    attachTo: 'root',
  };
}

describe('Prefab key 重映射与接缝（需求8.1-8.3）', () => {
  it('buildKeyToIdMap 为每个预制结构 key 分配唯一 Id', () => {
    const prefab = makePrefab();
    let counter = 0;
    const map = buildKeyToIdMap(prefab, () => `n:${counter++}`);
    expect(map.get('root')).toBe('n:0');
    expect(map.get('annex')).toBe('n:1');
  });

  it('remapLinks 将 key 引用替换为实际 Id', () => {
    const prefab = makePrefab();
    const map = new Map([['root', 'n:100'], ['annex', 'n:101']]);
    const remapped = remapLinks(prefab, map);
    expect(remapped).toEqual([{ a: 'n:100', b: 'n:101', def: 'd:door', directed: undefined }]);
  });

  it('remapLinks 遇到未声明的 key 时抛出（防御性校验，非用户可触发路径）', () => {
    const prefab: PrefabDef = { ...makePrefab(), links: [{ a: 'ghost', b: 'root', def: 'd:door' }] };
    const map = new Map([['root', 'n:100']]);
    expect(() => remapLinks(prefab, map)).toThrow();
  });

  it('resolveAttachToRoot 解析 attachTo 对应的实际节点 Id（需求8.3）', () => {
    const prefab = makePrefab();
    const map = new Map([['root', 'n:100'], ['annex', 'n:101']]);
    expect(resolveAttachToRoot(prefab, map)).toBe('n:100');
  });

  it('未声明 attachTo 时返回 null', () => {
    const prefab: PrefabDef = { ...makePrefab(), attachTo: undefined };
    const map = new Map([['root', 'n:100']]);
    expect(resolveAttachToRoot(prefab, map)).toBeNull();
  });
});

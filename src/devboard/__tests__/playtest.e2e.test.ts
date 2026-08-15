/**
 * 用真实 MapData 驱动的端到端 Playtest 冒烟。
 * 复用 `map-pipeline` 的样例地图（d:scene/yard 等），走 校验→编译→冒烟 全链路。
 */
import { describe, expect, it } from 'vitest';
import { playtestSmoke, compileIntoPrefab, structureDiagnostics } from '../verify/playtest.js';
import { blueprintCopy } from '../editor/map-io.js';
import type { MapData, MapClassIndex } from '../ports/map-contracts.js';

function sleeperMap(): MapData {
  return {
    schemaVersion: '1.0',
    id: 'sample_sleeper',
    name: '卧铺车厢',
    backdrop: { image: 'sleeper.png', pixelWidth: 1920, pixelHeight: 1080, tileRows: 1, tileCols: 1 },
    floors: [0, 1],
    nodes: [
      { id: 'yard', def: 'd:scene/yard', scale: 'large' as const, at: { x: 0.2, y: 0.8 }, floor: 0, name: '前院' },
      { id: 'hall', def: 'd:scene/room', scale: 'medium' as const, at: { x: 0.5, y: 0.5 }, floor: 0, name: '门厅' },
      { id: 'attic', def: 'd:scene/room', scale: 'medium' as const, at: { x: 0.8, y: 0.2 }, floor: 1, name: '阁楼' },
    ],
    edges: [
      { id: 'e1', def: 'd:transition/door', a: 'yard', b: 'hall', directionality: 'bidirectional', path: [{ x: 0.2, y: 0.8 }, { x: 0.5, y: 0.5 }] },
      { id: 'e2', def: 'd:transition/door', a: 'hall', b: 'attic', directionality: 'unidirectional', path: [{ x: 0.5, y: 0.5 }, { x: 0.8, y: 0.2 }] },
    ],
    placements: [],
  };
}

const index: MapClassIndex = {
  sceneDefs: new Map([
    ['d:scene/yard', 'large'],
    ['d:scene/room', 'medium'],
  ]),
  transitionDefs: new Set(['d:transition/door']),
  placeableInstances: new Set(),
};

describe('devboard 校验 / 编译 / Playtest 接线', () => {
  it('合法地图：结构校验无 error → 可发布 → 编译成功', () => {
    const map = sleeperMap();
    expect(structureDiagnostics(map).filter((d) => d.severity === 'error')).toHaveLength(0);
    const smoke = playtestSmoke(map, index);
    expect(smoke.ok).toBe(true);
    expect(smoke.prefab!.ok).toBe(true);
  });

  it('compileMap → PrefabDef：节点/边透传、几何(floor/path)丢弃', () => {
    const map = sleeperMap();
    const res = compileIntoPrefab(map);
    if (!res.ok) throw new Error('expected ok');
    expect(res.prefab.id).toBe('d:map/sample_sleeper');
    expect(res.prefab.nodes.map((n) => n.key)).toEqual(['yard', 'hall', 'attic']);
    expect(res.prefab.links.length).toBe(2);
    // 几何丢弃：PrefabDef 无 floor / at / path
    const json = JSON.stringify(res.prefab);
    expect(json).not.toContain('0.5'); // at 坐标不落
    expect(json).not.toContain('"path"');
  });

  it('错误地图：结构错误阻断 Playtest', () => {
    const map = sleeperMap();
    // 造一个未归一化坐标 error
    const bad: MapData = { ...map, nodes: [...map.nodes, { id: 'foo', def: 'd:scene/room', scale: 'medium' as const, at: { x: 9, y: 9 }, floor: 0 }] };
    const smoke = playtestSmoke(bad, index);
    expect(smoke.ok).toBe(false);
  });

  it('蓝本复制进 Playtest 仍可编译', () => {
    const copy = blueprintCopy(sleeperMap(), '副本卧铺');
    const res = compileIntoPrefab(copy);
    expect(res.ok).toBe(true);
  });
});

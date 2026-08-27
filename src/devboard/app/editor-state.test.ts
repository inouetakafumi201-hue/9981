import { describe, expect, it } from 'vitest';
import { addEdge, addNode, blankMap, deleteSelection, moveNode, sampleMap } from './editor-state';

describe('开发板地图编辑状态', () => {
  it('放置节点归一化坐标并登记楼层', () => {
    const result = addNode(blankMap(), { x: 2, y: -1 }, 2);
    expect(result.nodes[0]!.at).toEqual({ x: 1, y: 0 });
    expect(result.floors).toEqual([0, 2]);
  });

  it('拖动节点同步连接端点，删节点清理其连接', () => {
    const map = sampleMap();
    const moved = moveNode(map, 'platform', { x: 0.3, y: 0.3 });
    expect(moved.edges[0]!.path[0]).toEqual({ x: 0.3, y: 0.3 });
    expect(deleteSelection(moved, 'node:platform').edges).toHaveLength(2);
  });

  it('拉边拒绝自环和重复边', () => {
    const map = sampleMap();
    expect(addEdge(map, 'platform', 'platform')).toBe(map);
    expect(addEdge(map, 'platform', 'vestibule')).toBe(map);
  });
});

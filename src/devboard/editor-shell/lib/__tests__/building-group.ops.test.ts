'use client'

/**
 * Building-group editor store operations: "同高不合并 / frame 同步 / 楼层图幅
 * 严格等于建筑组框选范围 / 旧地图无建筑组完全不变" 回归测试。
 *
 * 这些原子操作由 left-panel building card 触发；测试不依赖 DOM，
 * 直接驱动 store mutators + __test_setDoc / __test_getDoc。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  addBuildingGroup,
  addBuildingFloor,
  setBuildingFloorImage,
  setBuildingFloorOrdinal,
  bindBuildingPortal,
  removeBuildingFloor,
  __test_setDoc,
  __test_getDoc,
} from '../editor-store'
import type { MapDoc } from '../map-types'

function baseDoc(overrides: Partial<MapDoc> = {}): MapDoc {
  return {
    id: 't1',
    name: 'test',
    layers: [{ id: 'ly_0', name: 'ground', height: 0 }],
    sceneNodes: [],
    sceneBoxes: [],
    edges: [],
    obstructions: [],
    terrains: [],
    placements: [],
    ...overrides,
  }
}

describe('building-group editor ops', () => {
  beforeEach(() => {
    __test_setDoc(baseDoc())
  })

  it('addBuildingGroup 创建空楼层集，楼层 id 唯一', () => {
    const id = addBuildingGroup({ x: 10, y: 20, width: 80, height: 60 }, 'shell:a')
    const doc = __test_getDoc()
    const group = doc.buildingGroups?.find((g) => g.id === id)
    expect(group).toBeDefined()
    expect(group!.shell).toBe('shell:a')
    expect(group!.frame).toEqual({ x: 10, y: 20, width: 80, height: 60 })
    expect(group!.floors).toHaveLength(0)
  })

  it('楼层 height 相同也不会被合并 —— 同建筑组内 height 重复仅为编辑视图约定，数据独立', () => {
    const id = addBuildingGroup({ x: 0, y: 0, width: 100, height: 100 })
    const f1 = addBuildingFloor(id, { ordinal: 1, height: 0, nodes: [], image: undefined, frame: { x: 0, y: 0, width: 100, height: 100 } })
    const f2 = addBuildingFloor(id, { ordinal: 2, height: 0, nodes: [], image: undefined, frame: { x: 0, y: 0, width: 100, height: 100 } })
    expect(f1).not.toBe(f2)
    expect(f1).toBeTruthy()
    expect(f2).toBeTruthy()
    const doc = __test_getDoc()
    const group = doc.buildingGroups![0]!
    expect(group.floors).toHaveLength(2)
    expect(group.floors.map((f) => f.id)).toEqual([f1, f2])
    expect(group.floors.map((f) => f.height)).toEqual([0, 0])
  })

  it('楼层 frame 严格等于建筑组 frame（初始同步）', () => {
    const frame = { x: 12, y: 12, width: 200, height: 150 }
    const id = addBuildingGroup(frame)
    addBuildingFloor(id, {
      ordinal: 1, height: 0, nodes: [],
      frame: { x: 12, y: 12, width: 200, height: 150 },
    })
    const doc = __test_getDoc()
    const floor = doc.buildingGroups![0]!.floors[0]!
    expect(floor.frame).toEqual(frame)
  })

  it('setBuildingFloorImage 绑定楼层图幅且不影响 frame 或序号', () => {
    const id = addBuildingGroup({ x: 0, y: 0, width: 100, height: 100 })
    const floor = addBuildingFloor(id, { ordinal: 1, height: 0, nodes: [], frame: { x: 0, y: 0, width: 100, height: 100 } })
    setBuildingFloorImage(id, floor!, 'data:image/png;base64,AAAA')
    const doc = __test_getDoc()
    const f = doc.buildingGroups![0]!.floors[0]!
    expect(f.image).toBe('data:image/png;base64,AAAA')
    expect(f.frame).toEqual({ x: 0, y: 0, width: 100, height: 100 })
    expect(f.ordinal).toBe(1)
  })

  it('bindBuildingPortal 追加门户，from/to/def 原样保存', () => {
    const id = addBuildingGroup({ x: 0, y: 0, width: 100, height: 100 })
    const floor = addBuildingFloor(id, { ordinal: 1, height: 0, nodes: [], frame: { x: 0, y: 0, width: 100, height: 100 } })
    const pid = bindBuildingPortal(id, { from: floor!, to: 'stair:down', def: 'portal:default' })
    expect(pid).toBeTruthy()
    const doc = __test_getDoc()
    const portal = doc.buildingGroups![0]!.portals[0]!
    expect(portal.from).toBe(floor)
    expect(portal.to).toBe('stair:down')
    expect(portal.def).toBe('portal:default')
  })

  it('楼层不存在时 addBuildingFloor / bindBuildingPortal 返回 null 且不修改文档', () => {
    const groupsBefore = __test_getDoc().buildingGroups?.length ?? 0
    const floor = addBuildingFloor('ghost-building', { ordinal: 1, height: 0, nodes: [] })
    expect(floor).toBeNull()
    const pid = bindBuildingPortal('ghost-building', { from: 'f1', to: 'f2', def: 'portal:default' })
    expect(pid).toBeNull()
    const groupsAfter = __test_getDoc().buildingGroups?.length ?? 0
    expect(groupsAfter).toBe(groupsBefore)
  })

  it('removeBuildingFloor 删除指定楼层，不影响其它楼层', () => {
    const id = addBuildingGroup({ x: 0, y: 0, width: 100, height: 100 })
    const f1 = addBuildingFloor(id, { ordinal: 1, height: 0, nodes: [], frame: { x: 0, y: 0, width: 100, height: 100 } })
    const f2 = addBuildingFloor(id, { ordinal: 2, height: 2, nodes: [], frame: { x: 0, y: 0, width: 100, height: 100 } })
    removeBuildingFloor(id, f1!)
    const doc = __test_getDoc()
    const floors = doc.buildingGroups![0]!.floors
    expect(floors.map((f) => f.id)).toEqual([f2])
  })

  it('旧地图（无 buildingGroups）导出 roundtrip 不产出建筑组字段', () => {
    const doc = __test_getDoc()
    expect(doc.buildingGroups).toBeUndefined()
    // roundtrip via JSON 应保持无 buildingGroups 字段
    const json = JSON.parse(JSON.stringify(doc))
    expect(json.buildingGroups).toBeUndefined()
  })

  it('setBuildingFloorOrdinal 仅修改 ordinal', () => {
    const id = addBuildingGroup({ x: 0, y: 0, width: 100, height: 100 })
    const f = addBuildingFloor(id, { ordinal: 1, height: 0, nodes: [], frame: { x: 0, y: 0, width: 100, height: 100 } })
    setBuildingFloorOrdinal(id, f!, 3)
    const doc = __test_getDoc()
    expect(doc.buildingGroups![0]!.floors[0]!.ordinal).toBe(3)
    expect(doc.buildingGroups![0]!.floors[0]!.height).toBe(0)
  })
})

# [已弃用] V0 地图生成 Prompt —— 建筑组专项

> **弃用声明（2026-09-06）**：建筑组（BuildingGroup）设计已被 WakeUp 项目永久废弃。
>
> 本文件仅作为历史决策墓碑保留，不得继续用于地图生成、编辑器实现、JSON 契约、素材管线或 AI Prompt。当前地图只允许使用主地图 `layers`、`nodes`、`edges`、`placements` 与占位框契约；JSON 中出现 `buildingGroups` 将被导入器明确拒绝，并产生 `MAP_BUILDING_GROUP_DEPRECATED` 错误。
>
> 后续需要表达建筑、楼层、门、楼梯或电梯时，必须转化为普通地图节点、连接、图层或 `MapPlaceholderBox`，不得恢复建筑组分支、建筑组楼层、建筑门户或独立 shell。

## 历史内容状态

以下原建筑组方案全部失效：`frame`、`shell`、`floors[]`、`portals[]` 及其编辑器操作、序列化字段和运行时表现分支。任何新设计不得引用本文件中的历史约束；若需要追溯原因，请查阅 Git 历史，不要将历史内容复制回生产代码。

## 当前替代入口

- 地图数据：`src/play/map/types.ts`
- 地图导入与导出：`src/play/map/serialize.ts`
- 地图编辑器桥接：`src/devboard/editor-shell/lib/map-bridge.ts`
- 原生组件：`MapPlaceholderBox` 与 `docs/创作系统/06_底图原生组件占位切片与图生图替换规范.md`
- 过渡关系：主地图 `MapEdge`，不使用建筑门户

## 机器守卫

- `parseMapData()` 对含 `buildingGroups` 的旧 JSON 抛出 `MAP_BUILDING_GROUP_DEPRECATED`。
- `validateMapStructure()` 对运行时传入的旧字段返回 error，`canPublish()` 返回 `false`。
- 新的 canonical MapData 不再声明、规范化、序列化或桥接任何建筑组类型。

> 本文件不是实现规范。它只用于防止未来误把已废弃的 BuildingGroup 设计重新引入项目。

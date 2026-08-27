# Design: MapData floor→layers 契约扩展

## Overview

本设计把地图层级语义收束成一套 canonical 契约：`MapData.layers` + `MapNode.layerId`。旧的 `floor` / `floors` 只保留为导入兼容形态，加载时被规范化为 canonical 形状，保存时只输出 canonical 形状。

这是一项契约扩展，不是玩法规则变更。`compileMap` 继续只负责把地图编译成 `PrefabDef`，层级表现元数据不进入引擎蓝本。层级只影响编辑、导入、导出与表现消费面。

透明度口径在现有文档里有分叉。本设计把它钉成唯一公式：`opacity = clamp(1 - |Δheight| × 0.1, 0, 1)`。任一侧 `height` 为空时，调用方把该层视作独立层，直接渲染为 `opacity: 1`。

## Architecture

```text
legacy floor JSON ─┐
                   ├─▶ normalizer ──▶ canonical MapData ──▶ validator ──▶ consumers
canonical layer JSON┘                    │                           │
                                          │                           ├─▶ compileMap
                                          │                           ├─▶ devboard 导入 / 编辑 / 导出
                                          │                           └─▶ opacity helper（纯函数）
                                          └─▶ serializer（canonical JSON only）
```

### Architecture Principles

1. Canonical first: 运行态与保存态只认 `layers` / `layerId`。
2. Compatibility at the edge: legacy `floor` / `floors` 只存在于导入边界。
3. Presentation stays out of runtime blueprints: `PrefabDef` 不承载层表现元数据。
4. Pure opacity policy: 不透明度函数必须纯、确定、可单测。
5. Explicit independence: `height` 缺省不再是隐式约定，而是显式的独立层语义。

## Components & Interfaces

### 1. LayerContractNormalizer

职责：把 legacy floor 文档和 canonical layer 文档统一成 canonical `MapData`。

输入：
- legacy `floors` / `MapNode.floor`
- canonical `layers` / `MapNode.layerId`
- 层显示元数据（`name` / `backdrop` / `transform`）

输出：
- canonical `MapData`
- 稳定层顺序
- 稳定 `layerId` 引用

接口建议：
- `normalizeMapDocument(document)` → `MapData`
- `deriveLayerId(floor)` → `string`
- `normalizeLayerHeight(height)` → `number | undefined`
- `normalizeNodeLayerRef(node)` → `string`

设计约束：
- legacy floor 值按数值升序进入 canonical layers。
- `deriveLayerId` 对同一个 floor 值必须稳定、确定性输出同一个 id。
- parser 接受 `null` height，但 canonical 内存结果只保留 `undefined` 作为独立层表示。

### 2. LayerContractValidator

职责：验证 canonical 形状的层级约束，并在混合 legacy/canonical 输入时给出明确诊断。

输入：canonical `MapData`

输出：诊断列表，不抛结构异常。

接口建议：
- `validateMapStructure(map)` → `MapDiagnostic[]`
- `validateLayerContract(map)` → `MapDiagnostic[]`

校验内容：
- layer id 唯一
- node.layerId 必须指向已存在 layer
- 参与透视的 `height` 必须 finite、非负
- 参与透视的 `height` 不能重复
- legacy / canonical 字段冲突必须拒绝
- canonical 序列化结果不得携带 legacy `floor` / `floors`

### 3. LayerContractSerializer

职责：把 canonical `MapData` 写成确定性 JSON，并支持 roundtrip。

输入：canonical `MapData`

输出：pretty-printed JSON 字符串

接口建议：
- `serializeMapData(map)` → `string`
- `parseMapData(json)` → `MapData`

序列化规则：
- 字段顺序固定：`schemaVersion`、`id`、`name`、`backdrop`、`layers`、`nodes`、`edges`、`placements`
- `layers` 按 canonical 层顺序输出
- `height` 为空时不输出该字段
- 不输出 legacy `floor` / `floors`
- canonical 输出使用新 schema 版本号，legacy 输入保留旧版本号作为兼容入口

### 4. LayerOpacityPolicy

职责：提供 layer 间渲染不透明度的纯函数。

输入：两个高度值

输出：不透明度或“独立层”哨兵值

接口建议：
- `layerOpacity(a, b)` → `number | null`

规则：
- 任一侧无数值 `height` 时返回 `null`
- 两侧均有数值 `height` 时返回 `clamp(1 - |Δheight| × 0.1, 0, 1)`
- 独立层由调用方渲染为 `opacity: 1`

### 5. Consumer Bridge

职责：把 canonical layer contract 交给 devboard 与其他消费方。

输入：canonical `MapData`

输出：编辑态与导出态

接口建议：
- `MapData` barrel 重新导出 canonical layer types
- devboard 导出器只写 canonical 形状
- 旧 `MapData.floor` / `floors` 仅用于导入兼容和迁移测试

## Data Model

```typescript
interface LayerBackdrop {
  readonly image: string;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

interface LayerTransform {
  readonly scaleX: number;
  readonly scaleY: number;
  readonly tx: number;
  readonly ty: number;
}

interface MapLayer {
  readonly id: string;
  readonly name?: string;
  readonly height?: number; // 独立层：缺省；parser 可接受 null，canonical 输出不保留 null
  readonly backdrop?: LayerBackdrop;
  readonly transform?: LayerTransform;
}

interface MapNode {
  readonly id: string;
  readonly def: string;
  readonly scale: SceneScale;
  readonly at: Vec2;
  readonly layerId: string;
  readonly parent?: string;
  readonly name?: string;
}

interface CanonicalMapData {
  readonly schemaVersion: '2.0';
  readonly id: string;
  readonly name: string;
  readonly backdrop: MapBackdrop;
  readonly layers: readonly MapLayer[];
  readonly nodes: readonly MapNode[];
  readonly edges: readonly MapEdge[];
  readonly placements: readonly MapPlacement[];
}

interface LegacyMapDataV1 {
  readonly schemaVersion: '1.0';
  readonly id: string;
  readonly name: string;
  readonly backdrop: MapBackdrop;
  readonly floors: readonly number[];
  readonly nodes: readonly (MapNode & { readonly floor: number })[];
  readonly edges: readonly MapEdge[];
  readonly placements: readonly MapPlacement[];
}
```

### Design Decisions

- canonical `schemaVersion` 升到 `2.0`，把 `layers` 作为显式新契约。
- canonical 内存形状使用 `undefined` 表示独立层，避免把 `null` 分散到消费者。
- `layerId` 是节点层引用的唯一权威；`floor` 只保留在 legacy 输入类型里。
- 层的 `backdrop` / `transform` 归层级表现，不进入 `PrefabDef`。
- canonical 层数组顺序是权威顺序，序列化时原样保留。

## Correctness Properties

正确性属性是可以由自动测试验证的不变量。每个属性都对应一个测试实现。

### Property 1: Canonical layer reference integrity
*For any* canonical `MapData`, every `node.layerId` resolves to exactly one `MapLayer`, and every participating `height` value is unique within the same map. **Validates: Requirement 1.1, 1.3, 1.4, 1.5**

### Property 2: Legacy normalization is idempotent
*For any* legacy floor-based map, `normalize(normalize(x))` must equal `normalize(x)`, and the normalized layer order must remain stable. **Validates: Requirement 3.1, 3.2, 3.3, 3.5**

### Property 3: Opacity boundary and monotonicity
*For any* two numeric heights `a` and `b`, `layerOpacity(a, b)` must return `1` when `|Δheight| = 0`, `0` when `|Δheight| >= 10`, and a value that does not increase as `|Δheight|` grows. **Validates: Requirement 2.1, 2.2, 2.3, 2.5**

### Property 4: Canonical serialization roundtrip
*For any* canonical `MapData`, `parse(serialize(map))` must recover an equivalent canonical structure, and layer metadata order must remain unchanged. **Validates: Requirement 4.1, 4.2, 4.5**

### Property 5: Legacy-to-canonical-to-JSON convergence
*For any* legacy floor map, `parse(serialize(normalize(x)))` must recover an equivalent canonical `MapData`, and the serialized form must not reintroduce `floor` or `floors`. **Validates: Requirement 3.4, 4.3, 4.4, 4.5**

## Error Handling

1. Duplicate layer id: return a structural diagnostic that names the conflicting layer id and both source locations.
2. Invalid height: reject `NaN`, `Infinity`, and negative heights with a structural diagnostic.
3. Duplicate participating height: reject the map and point the author to a unique height or a blank independent layer.
4. Missing layer reference: reject `node.layerId` values that do not resolve to a declared layer.
5. Mixed legacy/canonical conflict: reject documents that carry conflicting `floor` / `floors` and `layers` / `layerId` data.
6. Empty opacity input: return `null`, and let the caller render the layer as fully opaque.

## Test Strategy

### Unit tests
- Legacy-to-canonical normalization fixtures.
- `validateMapStructure` diagnostics for duplicates, missing refs, invalid height and mixed-shape conflicts.
- Canonical serialization tests for field order and legacy-field stripping.
- `layerOpacity` boundary and symmetry tests.

### Property-based tests
- TypeScript + `fast-check`.
- Each property runs at least 100 iterations.
- Each property has exactly one test implementation.
- Tag format: `Feature: mapdata-floor-layers, Property N: ...`

### Integration tests
- Legacy floor map import → canonical normalization → canonical JSON export → reimport stability.
- Devboard consumer updates should prove that export no longer depends on floor-only compatibility paths.
- `compileMap` should continue to ignore presentation metadata while accepting canonical layer documents.

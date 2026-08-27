# Requirements: MapData floor→layers 契约扩展

## Introduction

本 Spec 记录 `MapData.floor→layers` 契约扩展的需求：把地图的层级语义从旧的 `floor` / `floors` 过渡到以 `layers` 和 `layerId` 为中心的 canonical 形状，并把 `height` 可空、层间渲染不透明度公式、旧数据兼容与往返序列化统一成一套可机械验证的规则。

为消解当前文档里“透明度”与“可见度”口径相反的问题，本 Spec 只使用一个唯一术语：渲染不透明度（opacity）。同高度为 `1`，高度差达到 `10` 或更大时为 `0`。`height` 为空的层视作独立层，不参与高度差计算，且始终保持不透明。

本 Spec 只定义 MapData 契约与迁移规则，不定义 devboard UI 的具体交互，也不把 loading-runtime 或其他消费方当成契约定义者。

## 术语表

- **MapData**：地图的 canonical 文档形状，供 `src/play/map`、devboard 与后续消费方共享。
- **Layer**：`MapData.layers` 中的一条层记录。
- **参与透视层**：拥有数值 `height` 的层，参与层间不透明度计算和高度唯一性约束。
- **独立层**：`height` 为空的层，不参与高度差计算，可与其他独立层并存。
- **layerId**：节点对层的 canonical 引用键。
- **旧楼层地图**：仍使用 `MapData.floors` 与 `MapNode.floor` 的 legacy 文档。
- **规范化**：把旧楼层地图确定性地转换成 canonical `layers` / `layerId` 形状的过程。
- **往返**：parse → normalize/serialize → parse 的稳定回环。
- **层显示元数据**：层记录上用于编辑与表现的附加字段，例如名称、背景图与变换。
- **渲染不透明度**：由层高差计算得到的可见度值，取值范围 `0..1`。

## Requirements

### Requirement 1: Canonical layer contract

**User Story:** 作为地图作者，我想用显式的层列表和节点层引用表达地图结构，以便地图层级可以被稳定引用和编辑。

#### Acceptance Criteria

1. WHEN a map is represented in canonical form, THE system SHALL store layers in `MapData.layers` and SHALL store a single `layerId` reference on each node.
2. WHERE a layer record has `height` omitted or `null`, THE system SHALL treat that layer as an independent layer and SHALL exclude that layer from height-delta comparison.
3. WHERE a layer record has a numeric `height`, THE system SHALL require that height to be finite and non-negative.
4. WHERE two participating layers in the same map have the same numeric `height`, THE system SHALL reject the map.
5. WHEN a node references a layer id, THE system SHALL reject the map unless exactly one layer record in `MapData.layers` carries that id.
6. WHEN the system serializes canonical map data, THE system SHALL emit the canonical layer shape and SHALL omit legacy `floor` and `floors` fields.

### Requirement 2: Layer opacity semantics

**User Story:** 作为地图查看者，我想让不同高度的层按统一曲线淡出，以便当前层清晰、远层渐隐且行为可预测。

#### Acceptance Criteria

1. WHERE two layers both have numeric `height`, THE system SHALL compute rendered opacity as `max(0, 1 - |Δheight| × 0.1)`.
2. WHEN the absolute height difference is `0`, THE system SHALL render the source layer at opacity `1`.
3. WHEN the absolute height difference is `10` or greater, THE system SHALL render the source layer at opacity `0`.
4. WHERE a layer has no numeric `height`, THE system SHALL exclude that layer from the opacity comparison and SHALL render that layer at opacity `1`.
5. THE system SHALL keep the opacity function pure and deterministic for identical inputs.

### Requirement 3: Legacy floor compatibility and normalization

**User Story:** 作为既有地图的维护者，我想继续加载旧的 floor 形状并自动迁移，以便历史地图不因契约扩展而失效。

#### Acceptance Criteria

1. WHEN the system loads a legacy map that uses `MapData.floors` and `MapNode.floor`, THE system SHALL normalize it into canonical `MapData.layers` and node `layerId` references.
2. WHEN the system normalizes a legacy floor value, THE system SHALL create exactly one canonical participating layer for each distinct legacy floor value and SHALL copy that floor value into the layer height.
3. WHEN the system normalizes a legacy node reference, THE system SHALL map the node floor value to the canonical layer id for that layer.
4. WHEN the system reads a document that mixes legacy and canonical layer fields in a conflicting way, THE system SHALL reject the document with a validation diagnostic.
5. WHEN the system normalizes a legacy map and then serializes it, THE system SHALL emit only the canonical `layers` and `layerId` shape.

### Requirement 4: Parser, serializer, and roundtrip stability

**User Story:** 作为工具链维护者，我想让地图 JSON 的读取、打印与再次读取保持稳定，以便编辑器保存、导入和导出都可预测。

#### Acceptance Criteria

1. WHEN the system serializes a canonical map, THE system SHALL emit deterministic pretty-printed JSON.
2. WHEN the system parses the serialized canonical JSON, THE system SHALL recover an equivalent canonical `MapData` structure.
3. WHEN the system parses a legacy floor-based map, normalizes it, serializes it, and parses the serialized output again, THE system SHALL recover an equivalent canonical `MapData` structure.
4. WHERE a map carries layer display metadata, THE system SHALL preserve that metadata across the roundtrip unless a runtime-only consumer explicitly discards it.
5. THE system SHALL preserve canonical layer order across a serialize/parse roundtrip.

### Requirement 5: Validation and compile boundary

**User Story:** 作为契约维护者，我想让验证与编译理解新契约但不把层表现语义带进玩法蓝本，以便 runtime 仍然保持层无关。

#### Acceptance Criteria

1. WHEN `validateMapStructure` receives a canonical map, THE system SHALL validate layer ids, height uniqueness, node layer references, and legacy/canonical conflicts.
2. WHEN validation fails, THE system SHALL return diagnostics and SHALL not require callers to catch exceptions for structural errors.
3. WHEN `compileMap` receives a canonical map, THE system SHALL preserve the existing MapData → PrefabDef behavior and SHALL discard layer presentation metadata from the compiled PrefabDef.
4. WHEN the same canonical map is compiled twice, THE system SHALL produce equivalent `PrefabDef` output.
5. THE system SHALL keep the layer contract extension independent from gameplay rule semantics and runtime rule resolution.

# Design: 开发板（独立地图编辑器 Web 应用）

## Overview

开发板是一个**独立地图编辑器 Web 应用**，开发者/创作者用图形化方式编辑地图（MapData 的几何/拓扑与分层图层），可导入、另存为（以已加载地图为蓝本）、进引擎编译/预览、导出为玩法包文件。它不是正式素材库，也不实现素材库玩法侧（详情 / 库内改素材 / LLM 生成素材）。

本设计**只写开发板要用到的能力**。所有数据契约细节（`MapData.layers` 的 height / 贴纸 / transform / 边界候选 3 / 跨层连线 / 透明度公式 / `floor→layers` 迁移）均已在权威文稿 **`docs/创作系统/01_创作工具与产权.md` §九「分层图层」L.1–L.10** 与附「ID 规范」中保证写齐；开发板 design 不是契约的复述，而是开发板**消费**这些契约的形态。**未来其它功能需要动契约时，以权威文稿为准，不依赖开发板 spec。**

图层契约扩展（动 `src/play/map/**`）与开发板（消费后的 UI）是**同一 spec 的两面**：本 design 只描述开发板 UI 侧如何把 `MapData.layers` 可视化与编辑；契约本身由权威文稿背书，不在此重复实现。

### Goals

1. 以独立、可运行、可单独打包拉出的 Web 应用，提供非多图层已有的全部编辑能力（选择/放置/连线/取样/试玩），以及**分层图层**的编辑（贴纸、当前图层切换、重叠交互、跨层连线）。
2. 所有数据写入落到 `MapData` 既有契约 + `MapData.layers`（指 `01` §九 L.10）；开发板通过既有 `src/play/map` 端口消费，不自行发明数据结构、不反向依赖。
3. 产出物可直接经 `compileMap` 进引擎、可导出为玩法包文件；删除开发板，游戏照常运行。
4. 素材取用（右侧快捷栏 / 展开全量矩阵）通过**素材可用性钩子**统一决策，开发板当前全放行（开发者权限）、给 demo 留接口。

### Non-goals

- 正式素材库玩法侧（点击查看详情、库内修改素材、LLM 生成素材 / LLMUGC）。
- 「素材库元状态」层实现（拥用量/改动标记/角标状态机）——见 `docs/运营系统/04_局外养成的保险箱与素材库交互.md` §3.6，开发板只消费其可用性钩子。
- 地图 / 玩法包装载引擎与契约本身的实现（已存在或由权威文稿 + 其它专项负责）。
- 全屏粒子 / 曲线等运行时表现动画（`sprite-forge` 表现动画接入）；但开发板编辑的**图片须存在并显示**（占位到真实素材表观可切换）。
- 任何引擎原语、新 Op、新 Ref 前缀、新 Def kind。
- 服务端 / 网络同步、多人协作、云端持久化。

## Architecture

开发板是**同仓解耦的独立前端**：

```text
devboard (Vite + React + TS, src/devboard/)
   │ 只读 import
   ▼
src/play/map （MapData / validateMapStructure / validateMapAgainstClasses / compileMap / curve）
   ▲
   消费（validate/compile/curve/spawn 冒烟）
```

- 开发板源码在 `src/devboard/`，运行构建与零渲染内核解耦；`src/play/**`、`src/scene/**` 不反向依赖它（守 `06_UGC §2.3`）。
- 开发板只读消费 `src/play/map`：把 `MapData` 读进工作区、改动后即时 `validateMapStructure`、保存/导出前 `validateMapAgainstClasses`、编译 `compileMap`→`PrefabDef`、spawn 冒烟。
- 分两个数据 plane：**编辑平面**（开发板内部工作区态）与**契约平面**（`MapData` 落盘）。开发板把编辑态映射回 `MapData`，不在编辑态里存契约外的字段。

## Components & Interfaces

### 1. 工作区（Workspace）
- 装载一张 `MapData`；维护 `{ map: MapData, currentLayerId: string | null }`。
- `currentLayerId` 决定「当前图层及其以下可见可交互，严格更高层不在视野」（`01` §九 L.4）。

### 2. 编辑器核心（EditorCore）
- 复用 §九前文非多图层交互：状态机 `Select/PlaceNode/DrawEdge/Sample/Playtest`、全局输入、拉边、样条塑形、双分层坐标、图元编辑。
- 多图层时叠加图层规则（见 Data Model 与 图层交互）。

### 3. 素材可用性钩子（MaterialAvailabilityHook）
- 接口：`isAvailable(materialId): boolean`；当前实现为**全放行**（开发者权限、所有已加载内容可见）。
- 保留接口形状给 demo：后续玩家模式传入受限素材集（MVP 玩家素材有限，仅不能进自家地图 / 带图匹配）。开发板不实现判定逻辑（属素材库元状态层）。

### 4. 校验 / 编译 / 预览端口
- `validateMapStructure(map)`：每次改动即时，无 IO，诊断是 `MapDiagnostic[]`（列表、稳定排序、无自动 correction）。
- `validateMapAgainstClasses(map, index)`：保存/导出前，带类索引。
- `compileMap(map): PrefabDef`：纯函数、确定性、丢几何。
- Playtest：把 `PrefabDef` 喂给既有 spawn 断言/装载路径冒烟；可视化走 mermaid（`asset:view` 思路）。

### 5. 导出端口
- 工作区 `MapData` → 玩法包 / 地图 JSON 文件（`asset-pipeline` 样例格式）。导出含 `MapData.layers`（每层 height/backdrop/transform），**不生成 bounds**（候选 3）。

## Data Model

开发板内部工作区态（仅开发板自己用，映射回 `MapData` 落盘）：

```typescript
interface WorkspaceState {
  map: MapData;                    // 契约真身，绝不在其外并存字段
  currentLayerId: string | null;   // 当前图层；null = 无图层（空地图/单层情境）
  selection: {
    layerId: string | null;
    nodeId?: string;
    edgeId?: string;
    stickerId?: string;            // 贴纸 id（若有选中的贴纸）
  } | null;
  stickers: StickerEdit[];         // 编辑态贴纸（未锁定的增量）
}
interface StickerEdit {
  id: string;
  layerId: string;                 // 挂在哪个图层
  image: string;
  transform: { scaleX: number; scaleY: number; tx: number; ty: number };
  locked: boolean;                 // 点「确定」后 true → 不可再选
}
```

映射规则：
- 每个 `MapData.layers[i]` 对应一个可编辑图层；高度（height）参与透视的去重，留空（三界外）图层可有多个。
- 节点 `MapNode` 的层归属由权威文稿 L.10 决定（`floor→layerId`）；开发板只操作 `layerId`。
- 贴纸锁定：开发板编辑态 `locked:true` 的贴纸视为全景图一部分，**不可二次选中**；只有 `locked:false` 可拖动/缩放/删除。

> 这些字段的**权威定义与迁移**在 `docs/创作系统/01_创作工具与产权.md` §九 L.10；开发板 design 不改变它们，只描述编辑态如何承载。

## 图层编辑器交互（开发板 UI，对应 `01` §九 L.4–L.9）

- **当前图层**：切换图层面板；只有当前层及以下可见可交互，上一层不在视野。重叠处选中天然锁定（无需额外 picker）。
- **新建图层**：空画布，一切照常；新建图层的 height 不可与已有参与透视图层的 height 相同（去重）；留空其 height 的独立图层可有多个。
- **贴纸**：导入（全屏=固定比例尺铺满 / 局部=贴纸，右下角确定）：确定后 `locked:true`，不可再选。空隙（透明洞）透出下层，但 height 半透明照样激活（`01` §九 L.6）。
- **遮挡/高低地**：高图层阻碍不作用于底图层；拖动遮挡框到透明位置时淡显提示「这块不影响下层」（`01` §九 L.8）。
- **跨层连线**：拖拽逻辑与非多图层几乎相同；若线中间有过渡场景且两端图层高度不同 → 垂直过渡场景，可交互朝向偏高侧；过渡场景放哪层哪侧活、两边都放=双向（`01` §九 L.9）。

## Correctness Properties

> 以下属性是**开发板 UI 侧**可验证的正确性质（PBT/fast-check ≥100 次迭代）；契约细节本身由权威文稿与契约专项背书，不在此重复制定 PBT。

- **属性 1：当前图层可见性过滤** — 对任何 `MapData.layers`，编辑器在任何 `currentLayerId` 下，暴露给编辑的图元与贴纸**只包含当前图层及低于它的图层**；严格更高层绝不出现（验证 L.4）。
- **属性 2：height 去重且留空可重复** — 对任何工作区，参与透视的 height 集合无重复；留空（`height === undefined`）图层可以有多个（验证 L.2）。
- **属性 3：贴纸锁定后不可再选** — 对任何 `locked:true` 贴纸，编辑器的选区绝不可能包含它（验证 L.1/L.5）。
- **属性 4：导出不含 bounds 且图层变换保序** — `compileMap`/导出产物的 `MapData.layers` 与 `01` §九 L.10 形状一致、不含 `bounds` 字段；`transform` 逐图层归位（验证 L.7/L.10）。
- **属性 5：透明公式单调** — 对任意两图层高度 h1<h2，`opacity(h1,h2)` 随 `|Δheight|` 单调不减且在相差满 10 时达到 1（验证 L.3，作为 UI 对表现层的转译口径，不是修改契约）。

## Error Handling

- **高度重复**：新建/改图层时，若 height 已存在于参与透视图层 → 拒绝并提示选别的高度或留空（独立层）。
- **贴纸二次选中**：对 `locked:true` 贴纸的选中/移动 → 直接不可选（锁定由编辑态 `locked` 保证，不产生可逃逸路径）。
- **跨层过渡无落层**：过渡场景落在没有明确图层的那侧 → 编辑器按「哪层放一个哪侧活」明确给提示；无法双向时按单向显示。
- **校验失败**：结构校验（`validateMapStructure`）即时、列表展示；带索引保存校验（`validateMapAgainstClasses`）在导出前拦截 error 级诊断，阻止导出并展示。
- **导入/导出载体**：沿用 `asset-pipeline` 样例格式与地图持久化载体（`02_地图生产管线`），不发明新格式。

## Test Strategy

- **单元测试**：编辑态（工作区/贴纸锁定/当前图层/图元编辑）与导出映射 `MapData.layers` 的纯函数。
- **属性测试（fast-check ≥100）**：对上述 Correctness Properties 1–5 各一个实现，标签 `Feature: devboard, Property N: ...`。
- **集成**：`asset-pipeline` 的样例生成→校验→编译→spawn 冒烟复用；Playtest 用 `src/play/map` 既有 spawn 断言思路。
- **门禁**：`npm run typecheck`、`vitest run`（相关范围）、`npm run lint`、`npm run verify:docs`。
- 不做：真实的浏览器端到端 UI 测试、多人同步、服务端部署。

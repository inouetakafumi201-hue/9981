# Design: 地图编辑器涂鸦式交互第二版

## Overview

本设计把 `01` §八 + §九 的交互契约落成开发板第二版可实现的架构。核心是把第一版「界面的形」拨正为「交互与语义的实」：

- **涂鸦式交互**统一所有矩形 / 线的选中 / 旋转 / 合并；
- **场景框聚合 + 空洞全填 + 粘连判定**实现「框即场景」的语义；
- **样条塑形**补全折点调整（[B]）与折点删除（[D]），保留 Catmull-Rom「绝对穿过样本点」；
- **全局输入 + 框选 + 取样 + 撤销/重做 + 校验摄像机飞/红脉冲 + 视觉语言零新增**接满 `01` §九的输入表。

数据契约（`MapData` 的节点 / 边 / 遮挡 / 高地洼地 / 过渡窗口）已存在于 `src/play/map`，开发板只消费。

## Architecture

开发板是**同仓解耦的独立前端**（延续既有 spec）：

```text
devboard (Vite + React + TS, src/devboard/)
   │ 只读 import
   ▼
src/play/map （MapData / validateMapStructure / compileMap / curve）
```

- 交互层重写主体在 `src/devboard/app/`：`EditorApp`（工作台编排、全局输入、undo/redo 历史）、`CanvasView`（SVG 画布渲染涂鸦图元）、`editor-state.ts`（纯函数编辑内核）、新增 `graffiti.ts`（场景框聚合 / 空洞全填 / 粘连判定 / 折点增删）、`camera.ts`（viewBox 平移缩放 / 摄像机飞）。
- 所有编辑操作进**单一命令式历史栈**，撤销 / 重做由它驱动（`undo/redo` 状态），替代第一版直接原地 mutate 的做法。
- 存储只落逻辑层语义（`MapData` 严格字段），涂鸦合并 / 空洞全填在视觉与校验上是"假合并"（阴影绘制 + 区域判定），不写虚假矩形。

## Components & Interfaces

### 1. 编辑命令内核（`editor-state.ts` 扩展）

所有破坏性操作收敛为「命令」，可推入历史栈、可撤销 / 重做：

```ts
type HistoryEntry = {
  readonly label: string;        // 撤销菜单/日志显示名
  readonly undo: () => MapData;  // 逆向变换（取改前快照）
  readonly redo: () => MapData;  // 正向重放
};
interface EditorHistory {
  readonly undoStack: HistoryEntry[];
  readonly redoStack: HistoryEntry[];
  /** 把一次修改入栈：记录基线 → apply → redo 存正向。 */
  commit(label: string, before: MapData, after: MapData): EditorHistory;
  undo(current: MapData): { history: EditorHistory; map: MapData };
  redo(current: MapData): { history: EditorHistory; map: MapData };
}
```

现存的 `addNode / addEdge / moveNode / deleteSelection` 等**纯函数**全部保留、语义不变，作为命令的 apply 载体；新增命令：

- `moveKnot(map, edgeId, pathIndex, to)` — [B] 折点调整：`path[pathIndex] = clamp(to)`，首尾仍吸附节点中心。
- `deleteKnot(map, edgeId, pathIndex)` — [D] 折点删除：删 `path[pathIndex]`，前/后折点直接重连成直线（拍直）。
- `mergeDeleteKnot(map, edgeId, pathIndex)` — [D] 吸附删除：折点拖至邻折点时触发，删点即拍直两侧。
- `rotateBox(map, edgeId, which, degrees)` — 旋转遮挡/高地/洼地框：对 bounds 顶点绕框中心旋转。
- `moveTransitionWindow(map, edgeId, to)` / `attachTransitionWindowToEdge(map, windowId, edgeId, to)` — 过渡窗口独立拖拽 + 经过某线即挂载。
- `pushKnot(map, edgeId, point)` — [C] 拉弯：`insertControlPoint`（Fire-and-Forget）。
- `straightenKnots(map, edgeId)` — [C] 双击拉直：清隐藏点。

### 2. 涂鸦聚合纯函数（新增 `graffiti.ts`）

`01` §八「场景框聚合 / 空洞全填 / 粘粘判定」的可测试逻辑，独立成纯函数文件：

```ts
// 场景由多个场景框构成：返回该场景的全部成员框（连在一起的矩形视为一个场景）。
function sceneMemberBoxes(nodes: readonly MapNode[], sceneId: string): readonly Box[];

// 一个场景的最大距离矩形中心（高光点）：所有成员框外接矩形的中心。
function highlightPoint(paths: readonly Box[]): Vec2;

// 空洞全填（仅场景框）：给定场景框集合，判定某点是否落在"封闭内部空洞"内（是场景的一部分、不可放置其他场景节点）。
function isInsideHole(sceneBoxes: readonly Box[], point: Vec2): boolean;

// 粘连判定：判定一次拖拽/创建是否把两个已创建的节点连接了起来 → 拒绝 + 淡出提示。
function connectsTwoScenes(before: readonly String[], newBox: Box): boolean;

// 同类型框重叠合并（涂鸦式交互）：返回合并后的单个框（边界消失）。
function mergeSameType(boxes: readonly Box[]): Box;
```

`Box` 为归一化轴对齐矩形（`{ x, y, w, h, rotation }`）。空洞判定用射线法在旋转矩形上做。

### 3. 摄像机（新增 `camera.ts`）

`viewBox` 平移缩放 + 校验摄像机飞：

```ts
interface Camera { x: number; y: number; scale: number; }  // viewBox 左上 + 缩放
function pan(camera: Camera, dx: number, dy: number): Camera;            // 空格/中键拖
function zoomAt(camera: Camera, focus: Vec2, factor: number): Camera;     // 滚轮以光标为中心
function flyTo(camera: Camera, subject: Vec2, durationMs: number): { to: Camera; duration: number }; // 校验点击飞
```

### 4. 红脉冲 / 白色描边 / 蓝吸附（视觉语言零新增）

编辑器状态直接映射霓虹边交互语法，颜色走 `tokens` 注入的语义色变量：

| 编辑器状态 | 颜色 | token |
|---|---|---|
| 悬停可选 | 白 | `neutral`（灰白，勾选高光） |
| 已选中 | 黄 | `alert` |
| 校验错误 | 红 | `damage` |
| 拖拽合法落点 | 蓝 | `stamina` |
| 场景框 | 灰白 | `neutral` / `panel` |
| 视觉遮挡 | 黄（半透明） | `alert` |
| 物理遮挡 | 红（半透明） | `damage` |
| 高地 / 洼地 | 深绿 / 浅绿 | 语义绿系 `safe` / 派生 |
| 过渡窗口 | 素材库组件 | `action` 高光 |

`CanvasView` 渲染时按状态叠加 `className`，CSS 从 `--*` 变量取色，不硬编码。

## Data Model

开发板内部工作区态（Devboard 自有，映射回 `MapData` 落盘）：

```ts
interface WorkspaceState {
  map: MapData;                     // 契约真身
  currentLayerId: string | null;    // 图层（未扩展契约前的 devboard 编辑态）
  currentFloor: number;             // 1/2/3 楼层切换
  camera: Camera;                   // viewBox 平移缩放
  history: EditorHistory;           // 栈式撤销/重做
  selection: SelectionTarget | null;
  edgeDraft: EdgeDraft | null;      // 拉边描线草稿
  sampleSlot: string | null;        // 取样槽（Alt+点击 / I 获得）
  flash: 'red' | 'yellow' | null;   // 丢弃描线红闪 / 校验脉冲
}
```

编辑路由（`MapData.layers` 未落契约，devboard 侧 `layerId` / `height` 属编辑态承载，映射回 `MapData` 时只写既有字段）；**几何图元**（`visualObstruction` / `physicalObstruction` / `semanticAnchor` / `transitionWindow`）直接写 `MapEdge`——这些字段已存在于契约，开发板只消费。

## Correctness Properties

> 属性是**开发板 UI/内核侧**可验证的正确性质（fast-check ≥100 次迭代）；契约细节本身由权威文稿背书。标签 `Feature: devboard-graffiti, Property N: ...`.

- **Property 1: 样条经过全部样本点** — 对任意 `path: readonly Vec2[]`（≥2 点）与任意重采样计数 `count ≥ path.length`，Catmull-Rom 重采样产物在每一原始样本点上的采样值等于该点坐标（验证要求 4.1「绝对穿过样本点」）。
- **Property 2: 折点调整不破坏端点吸附** — 对任意合法地图、边、中间折点 `pathIndex ∈ (0, len-1)`、任意落点，`moveKnot` 后首末点仍分别等于 `a`、`b` 节点坐标，结构校验零 error（验证要求 4.2 / 4.8 / 3.8）。
- **Property 3: 折点删除即拍直** — 对任意合法地图、边、中间折点，`deleteKnot` 后 `path` 长度减 1、被删折点的前/后直接相邻、整条边无隐藏样条点残留，结构校验零 error（验证要求 4.6 / 4.7）。
- **Property 4: 拉弯即追加、不简化** — 对任意合法地图、边、任意落点，`pushKnot` 恒使 `path` 长度 +1、首末端点吸附不变、后续 `simplifyPath` 不再介入（拉弯后点不被再次简化）（验证要求 4.3 / 4.9）。
- **Property 5: 遮挡框旋转保语义** — 对任意视觉/物理遮挡框 bounds 绕任意角度旋转，顶点集在旋转前后包围盒近似重合（±ε），结构校验零 error、`shape` 仍为 'box'（验证要求 7.3 / 7.4）。
- **Property 6: 空洞全填封闭性** — 对任意由矩形组成的封闭空洞（如 4 矩形围成矩形空洞），`isInsideHole` 对洞内每一点返回 true、对洞外每一点返回 false；仅场景框参与（验证要求 5.7）。
- **Property 7: 场景框聚合高光点** — 对任意场景成员框集合，`highlightPoint` 返回的外接矩形中心落于所有成员框外接矩形之内（验证要求 5.9）。
- **Property 8: 撤销可逆 / 重做可重放** — 对任意连续编辑命令序列，执行后再依次撤销直到栈空，最终地图与操作前**逐字节相等**；依次重做直到栈满，与操作后逐字节相等（验证要求 11.2 / 11.3）。往返恒等 `undo^n(redo^n(after)) == after`。

## Error Handling

- **粘连拒绝**：拖拽/创建把两个已创建节点连起来 → 操作无效（不落 MapData）+ 淡出提示「违反场景聚合原则 / 粘连判定」。不做静默失败。
- **空洞内放置拒绝**：在封闭空洞内试图放新场景节点 → 拒绝 + 提示（该区域是场景一部分）。
- **拉边空白松手**：丢弃整条 + 红色一闪（不是静默，也不是建悬空边）。
- **隐藏点操作拒绝**：点击隐藏样条点 → 只高亮线段、不选中、不弹菜单（`01` §九「单击只高亮」）。
- **撤销越界**：栈空时 `Ctrl+Z` 为 no-op（不抖动、不报错）；栈满重做时同样 no-op。
- **校验失败**：即时 `validateMapStructure` 列表展示（error / warning 分色）；导出前 `validateMapAgainstClasses` 拦截 error 并阻止导出。保存永不因 error 被阻止。

## Test Strategy

- **纯函数单元测试**：`graffiti.ts`（聚合 / 空洞 / 粘连 / 合并）、`camera.ts`（pan / zoomAt / flyTo）、`editor-state.ts` 新命令（moveKnot / deleteKnot / mergeDeleteKnot / rotateBox / pushKnot / straightenKnots / moveTransitionWindow）。
- **属性测试（fast-check ≥100）**：对上述 Correctness Properties 1–8 各一个实现，标签 `Feature: devboard-graffiti, Property N: ...`。
- **模拟用例**：把关键交互串成端到端用例（拉边描线→RDP→吸附建边→拉弯→双击拉直→折点删除→遮挡旋转→过渡窗口挂载→撤销到最初→重做到最后），每步断言结构校验零 error。
- **门禁**：`npx tsc --noEmit`、`npx vitest run`（devboard 相关）、`npm run lint`、`npm run verify:docs`。开发板 UI 浏览器手动确认不纳入门禁。
- 不做：真实浏览器端到端 UI 测试、多人同步、服务端部署。

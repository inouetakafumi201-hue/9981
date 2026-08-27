# Implementation Plan: 地图编辑器涂鸦式交互第二版

## Overview

把 `01` §八 + §九 的交互契约逐字句落进开发板。实施主体在 `src/devboard/`，**不碰 `src/play/map/**` 契约源码**。编辑内核（纯函数）先落地并被测试钉死，再接线到 UI（CanvasView / EditorApp），最后补 PBT 与门禁。

实现语言：TypeScript（React 18 + SVG + Framer Motion + lucide + tokens），延续既有的 devboard 技术栈。

## Task Dependency Graph

```text
1 编辑命令内核扩展（折点调整/删除/拉弯/拉直/旋转/过渡窗口/位置/历史栈）
  ├─ 2 涂鸦聚合纯函数（graffiti.ts：聚合/高光点/空洞全填/粘连/合并）
  │     └─ 3 摄像机（pan/zoomAt/flyTo + viewBox）
  │           ├─ 4 全局输入 + 框选 + 取样 + undo/redo 接线到 EditorApp
  │           │     └─ 5 CanvasView 涂鸦图元渲染（阴影选中/旋转/合并/红脉冲/脉冲）
  │           └─ 6 校验反馈（点击诊断→飞+红脉冲；保存不阻/发布阻）
  └─ 7 PBT（Properties 1–8）+ 模拟用例
       └─ 8 门禁（tsc/vitest/lint/verify:docs）
```

任务 1、2、3 相互独立可并行；4 依赖 1+3；5 依赖 2+4；6 依赖 3+5；7 在 1–6 齐全后补；8 收尾。

## 任务

### 任务组 A：编辑内核（先落地、可独立测试）

- [ ] 1. [折点编辑命令（样条塑形 [B][C][D]）]
  - `editor-state.ts` 新增强制纯函数：`moveKnot`、`deleteKnot`、`mergeDeleteKnot`、`pushKnot`（拉弯即追加，`insertControlPoint`）、`straightenKnots`（清隐藏点拍直）、`rotateObstruction`。
  - `moveKnot`：改 `path[pathIndex]` 坐标，中段不触碰首末；首末恒吸附节点中心（`clampPoint`）。
  - `deleteKnot`：删 `${pathIndex}` 后前/后直接连成**绝对直线**（隐藏样条点清空 = 拍直）。
  - `mergeDeleteKnot`：折点拖至邻折点时删点即拍直两侧。
  - `pushKnot`：`insertControlPoint` 追加（Fire-and-Forget，无上限）；**不调用 `simplifyPath`**。
  - `straightenKnots`：只保留首末两点，瞬间绷直。
  - `rotateObstruction`：对 `ObstructionSpec.bounds` 顶点绕框中心旋转任意角度，`shape` 保持 'box'。
  - _要求：R4.1–4.10, R7.3–7.4_

- [ ] 2. [涂鸦聚合纯函数（`graffiti.ts`）]
  - 新建 `src/devboard/app/graffiti.ts`：`Box` 类型、`sceneMemberBoxes`、`highlightPoint`（最大距离矩形中心）、`isInsideHole`（空洞全填，射线法）、`connectsTwoScenes`（粘连判定）、`mergeSameType`（同类型重叠合并）。
  - 空洞判定只对场景框参与，其他方框不参与填充判定（`segments` 明确区分）。
  - _要求：R5.5–5.9_

- [ ] 3. [摄像机（`camera.ts`）]
  - 新建 `src/devboard/app/camera.ts`：`Camera`、`pan`（空格/中键拖，改 viewBox）、`zoomAt`（以光标为中心缩放）、`flyTo`（校验点击飞，返回目标 + 时长）。
  - 平移缩放走 `viewBox` 而非浏览器滚动（`killWebFeel` 一致）。
  - _要求：R1.5–1.6, R9.2_

- [ ] 4. [历史栈（`editor-history.ts`，撤销/重做）]
  - 新建栈式 `EditorHistory`：`commit(label, before, after)`、`undo`、`redo`；撤销走 `before` 快照、重做走 `after` 快照（往返恒等）。
  - 所有破坏性命令接线（建/删/移动/拉弯/拉直/旋转/放置/剪贴板红闪丢弃）。
  - _要求：R11.1–11.3_

### 任务组 B：交互接线（UI）

- [ ] 5. [全局输入 + 框选 + 取样 + undo/redo 接线到 EditorApp]
  - `EditorApp` `handleKey` 接满 `01` §九全局输入表：`1/2/3` 楼层、`N/E/I/P` 模式、`Ctrl+Z`/`Ctrl+Shift+Z`/`Ctrl+Y` 撤销重做、`Tab` 面板、`Delete`/`Backspace` 删除、`Esc` 退模式/清选择、`Ctrl+S` 保存、空格+拖/中键拖平移、滚轮缩放。
  - Select 态裸输入：左键单击空白清选择、左键拖空白框选、双击空白不创建、右键上下文菜单。
  - 取样（`I` / `Alt+点击`）：样本槽 `sampleSlot`，点其他节点套用。
  - 历史栈接入：每次修改 `commit`，清空 redo 栈。
  - _要求：R1, R2, R8_

- [ ] 6. [CanvasView 涂鸦图元渲染（阴影选中 / 旋转 / 合并 / 红闪 / 脉冲）]
  - 场景框：灰白、可多重叠加/旋转/融合；隐藏点不渲染。
  - 遮挡/高地/洼地框：颜色严格映射（黄 / 红 / 深绿 / 浅绿），阴影选中、滚轮旋转（10°/格）。
  - Catmull-Rom 样条路径渲染（现有 catmullRomPath 复用），穿过全部样本点。
  - 拉边实时预览折线；松手空白 → 红色一闪（`flash === 'red'`，短暂 0.2s）。
  - 校验点击 → 摄像机 `flyTo` + 元素红色脉冲 / 黄色边缘闪烁。
  - _要求：R3, R4.1, R5, R7.1–7.2, R9.2_

- [ ] 7. [校验反馈接线]
  - 底栏诊断按 `severity` 分组（error / warning / info）；点击诊断 → `focusDiagnostic` → `flyTo` + 脉冲。
  - 即时 `validateMapStructure`；导出前 `validateMapAgainstClasses` 拦截 error。
  - error 永不阻止保存（`Ctrl+S` / 导出都跑，但导出前强制发布校验）。
  - _要求：R9.3–9.5_

### 任务组 C：测试与门禁

- [ ]* 8. [PBT（Properties 1–8，fast-check ≥100）]
  - **Property 1**: Catmull-Rom 穿过全部样本点（要求 4.1）
  - **Property 2**: 折点调整不破坏端点吸附（要求 4.2/4.8/3.8）
  - **Property 3**: 折点删除即拍直、无隐藏点残留（要求 4.6/4.7）
  - **Property 4**: 拉弯即追加、不简化（要求 4.3/4.9）
  - **Property 5**: 遮挡框旋转保语义（要求 7.3/7.4）
  - **Property 6**: 空洞全填封闭性（要求 5.7）
  - **Property 7**: 场景框聚合高光点落于外接矩形（要求 5.9）
  - **Property 8**: 撤销可逆 / 重做可重放（要求 11.2/11.3）
  - _要求：Design Correctness Properties 1–8_

- [ ]* 9. [模拟操作用例]
  - 一条「拉边描线→RDP→吸附建边→拉弯→双击拉直→折点删除→旋转遮挡→挂过渡窗口→撤销到最初→重做到最后」的串行端到端用例，每步断言结构校验零 error。
  - 粘连拒绝、空洞内放置拒绝、空白松手红闪、隐藏点只高亮不选中 的断言用例。
  - _要求：R3–R7_

- [ ] 10. [门禁与追踪]
  - `npx tsc --noEmit`、`npx vitest run`（devboard 范围）、`npm run lint`、`npm run verify:docs`。
  - 确认 `src/play/**` 不反向依赖 `src/devboard/**`；删除 devboard 目录后游戏仍可构建。
  - 记录交接项：`MapData.layers` 契约扩展独立专项；素材可用性真实判定由素材库元状态层提供。
  - _要求：R12（边界纪律）_

## 备注

- **不碰 `src/play/map/**` 源码**：开发板只 import 消费。遮挡 / 高低地 / 过渡窗口字段已存在，开发板写回 `MapEdge` 既有字段即可。
- 命令内核（任务 1–4）先落地 + 单测钉死，UI（任务 5–7）再接线；每步跑 devboard build/vitest/eslint 回归。
- 视觉语言零新增：颜色一律 `tokens` 语义色（白=中性、黄=alert、红=damage、蓝=stamina），不在代码硬编码裸色值。
- 涂鸦合并 / 空洞全填是「视觉 + 校验上的假合并」（阴影绘制 + 区域判定），存储不写虚假矩形。

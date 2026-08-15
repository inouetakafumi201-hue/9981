# Implementation Plan: 开发板（独立地图编辑器 Web 应用）

## Overview

本计划把 [requirements.md](requirements.md) + [design.md](design.md) 转换为依赖有序、可单独验收的 TypeScript 实现任务。

实现落点：**开发板 UI 消费侧**——生产代码在 `src/devboard/`，Vite + React + TS，同仓解耦、可独立启动/打包拉出。开发板**只读消费** `src/play/map`（`MapData` / `validateMapStructure` / `validateMapAgainstClasses` / `compileMap` / `curve`），**不反向依赖**，删除后游戏照常跑。

**任务范围边界（重要）**：本 tasks 只写开发板自身要用的落地。**`MapData.layers` 的数据契约本身（types/validate/compile 的 `floor→layers` 迁移、新诊断、编译丢弃、透明公式）不在这里实现**——它由权威文稿 `docs/创作系统/01_创作工具与产权.md` §九 L.1–L.10 背书，属于独立契约扩展专项。开发板编辑态（工作区/贴纸锁定/当前图层/变换）作为开发板内部承载，**映射回 `MapData.layers` 形状**（按 L.10），契约扩展真正落地后将无缝承接。

开发板任务不碰 `src/play/map/**` 源码（校验/编译只 import 消费）；素材可用性钩子先实现「全放行」桩，真实判定留给素材库元状态层。

## Task Dependency Graph

```text
1 工程基线（src/devboard 壳 + 解耦 + 构建脚本）
  └─ 2 加载 / 新建(蓝本) / 导出 端口
       ├─ 3 编辑器核心态（工作区 / 当前图层 / 贴纸锁定 / 图元 → MapData.layers 映射）
       │     └─ 4 图层编辑器交互（当前图层切换 / 新建去重 / 贴纸导入锁定淡显 / 跨层过渡垂直态）
       │           └─ 5 素材两态 + 可用性钩子
       └─ 6 校验 / 编译 / Playtest 接线
            └─ 7 Correctness Properties 1–5（PBT）
                 └─ 8 门禁 + 追踪验收
```

任务 3 与 6 都依赖 2（拿到可编辑 map）；任务 4 依赖 3；任务 5 依赖 4 的图层上下文；任务 7 的每个属性测试可在其前置完成后独立并行。任务 8 走三命令门禁。

## 任务

- [ ] 1. [工程基线：`src/devboard/` 壳与同仓解耦]
  - 建 `src/devboard/`（Vite + React + TS），独立 `tsconfig.devboard.json` 与 `vite.config` / 启动脚本（`npm run devboard`），与零渲染内核解耦。
  - 建独立构建/打包入口，可导出为独立 web 应用。
  - 加 ESLint 守卫：`src/play/**`、`src/scene/**` 不得 import `src/devboard/**`（可逆 import），删除 devboard 后游戏照常构建。
  - _要求：Req 1.1–1.4；Design Architecture_

- [ ] 2. [加载 / 新建（可选蓝本）/ 导出 端口]
  - 启动呈现「已加载地图列表」；选择加载进工作区。
  - 「新建地图」提供「以某已加载地图为蓝本」的可选基底：选蓝本以蓝本内容复制为起点，否则空图。
  - 蓝本复制产出**新的稳定命名（无随机尾缀）**，源图命名不被破坏。
  - 「导出」把工作区 MapData（含 `layers`）写为玩法包 / 地图 JSON 文件，沿用 `asset-pipeline` 样例格式，**不生成 bounds**。
  - 提供显式「校验并导出」：导出前跑 `validateMapAgainstClasses`，error 级诊断阻止导出或明确展示。
  - _要求：Req 2.1–2.6；Design Components 1/5，Data Model_

- [ ] 3. [编辑器核心态与 MapData.layers 映射]
  - 工作区态 `{ map: MapData, currentLayerId: string | null, selection, stickers }`（Design Data Model）。
  - 图元编辑落到 `MapNode`(layerId 归属) / `MapEdge`(可跨 layer) / `MapPlacement`，映射回 `MapData.layers` (L.10 形状)。
  - 贴纸编辑态：`locked:false` 可拖/缩放/删；点确定 → `locked:true` 不可再选。
  - 每次改动即时跑 `validateMapStructure`，诊断按 path 稳定排序、列表展示、无自动 correction。
  - _要求：Req 3.1–3.6；Design Components 2，Correctness 1/2/3_

- [ ] 4. [图层编辑器交互（对应 `01` §九 L.4–L.9）]
  - 当前图层切换：只有当前图层及以下可见可交互，严格更高层不在视野；重叠选中天然锁定。
  - 新建图层：空画布；参与透视的 height 去重、留空（三界外）图层可多个。
  - 贴纸导入（全屏=固定比例尺铺满 / 局部=贴纸，右下角确定）→ `locked:true`；空隙漏风透出下层但 height 半透明照样激活。
  - 遮挡/高低地：高图层阻碍不作用于底图层；拖遮挡框到透明位置 → 淡显提示「不影响下层」。
  - 跨层连线：过渡场景放哪层哪侧活、两边都放=双向；两端不同高度且有中间过渡场景 → 垂直过渡场景，可交互朝向偏高侧。
  - _要求：Req 3.x（图元）扩展；Design 图层编辑器交互，Correctness 1/3_

- [ ] 5. [素材两态呈现 + 可用性钩子]
  - 编辑器右侧快捷素材栏：未展开 7 格（最近/高频），展开进全量矩阵（70 格），矩阵上有分类筛选+搜索框；只取用拖拽，不提供编辑/LLM/详情。
  - 「素材可用」判定通过 `MaterialAvailabilityHook.isAvailable(materialId)` 统一决策，不内联。
  - 当前实现全放行（开发者权限、所有已加载内容可见）；保留接口给 demo（后续玩家模式传入受限素材集）。
  - 图片源：素材引用的 image 必须存在并显示（占位到真实素材表观可切换）；不加载全屏/粒子/曲线动画。
  - _要求：Req 4.1–4.5；Design Components 3_

- [ ] 6. [校验 / 编译 / Playtest 接线]
  - 工作区 MapData → `compileMap` → PrefabDef（纯函数、确定性、丢几何）。
  - Playtest：PrefabDef 喂既有 spawn 断言 / 引擎装载路径冒烟（复用 `asset-pipeline` spawn 断言思路与 `src/play/map` 测试工具）。
  - 可视化：mermaid 思路把地图拓扑画成图（`asset:view`），供开发者检查。
  - _要求：Req 5.1–5.3；Design Components 4_

- [ ]* 7. [Correctness Properties 1–5（PBT）]
   - 每个属性一个 fast-check 测试，≥100 迭代，标签 `Feature: devboard, Property N: ...`。
   - **属性 1：当前图层可见性过滤**（Design P1）
   - **属性 2：height 去重且留空可重复**（Design P2）
   - **属性 3：贴纸锁定后不可再选**（Design P3）
   - **属性 4：导出不含 bounds 且图层变换保序**（Design P4）
   - **属性 5：透明公式单调**（Design P5，作为 UI 对表现层转译口径，非契约）
   - _要求：Design Correctness Properties 1–5_

- [ ] 8. [门禁与追踪]
   - 三命令门禁：`npx tsc --noEmit`、`vitest run`（devboard + 相关范围）、`npm run lint`；`npm run verify:docs`。
   - 确认 `src/play/**` 不反向依赖 `src/devboard/**`；删除 devboard 目录后游戏仍可构建。
   - 记录交接项：`MapData.layers` 契约扩展（`floor→layers` 迁移）为独立专项；素材可用性真实判定由素材库元状态层提供。
   - _要求：Req 1.3；Design Non-goals_

## 备注

- **不碰 `src/play/map/**` 源码**：开发板只 import 消费。契约扩展（`MapData.layers` 落 code）在独立专项，开发板先按 L.10 编辑态承载。
- 依赖：`npm run devboard` 启动脚本、Vite React TS 环境搭建；无 React 时先起壳（Vite 已作为传递依赖存在，需显式加入 react/react-dom 到 devDependencies 并 pin 版本）。
- 测试：开发板逻辑部分用 vitest；浏览器端到端 UI 确认属 manual（non-goal）。

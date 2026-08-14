---
name: asset-pipeline
description: WakeUp 开发期「素材工作流管线」——用脚本生成样例 MapData → 校验 → 编译 → 引擎 spawn 自测 → mermaid 可视化检查，验证「数据契约链路」畅通。当用户要:搭建/复跑/验证素材管线、生成或检查地图数据(MapData)、校验或编译地图、让一张地图进引擎、把地图画成图(mermaid)、复用 asset:generate/asset:pipeline/asset:view。这是开发期生产工具，product 侧地图编辑器后置（编辑器可选、数据契约必需，D-072）。
---

# WakeUp 素材工作流管线（开发期）

一句话：**脚本能产 MapData，编辑器只是更舒服的输入方式——契约才是主权载体（D-072）。**

本 skill 跑通「白盒迭代之后的那条数据链」，让地图/组件的创建可自动化、可校验、可编译、可进游戏。编辑器 UI 后置排期，不在此。

## 何时触发
用户想：建/生成一张地图（MapData）、校验或编译地图、把地图 spawn 进引擎自测、把地图渲染成 mermaid 图、搭/复跑/验证素材管线。

## 链路与命令（三件套）
| 步骤 | 命令 | 作用 |
|------|------|------|
| 1 生成样例 | `npm run asset:generate` | 产出合法 `MapData` 到 `tmp/asset-pipeline/maps/` |
| 2 校验+编译+spawn | `npm run asset:pipeline` | 结构校验 → 跨目录引用校验 → `compileMap`→PrefabDef → 引擎真身 spawn 断言落地 |
| 3 可视化检查 | `npm run asset:view [json路径]` | 把 MapData 拍平成 mermaid flowchart |

产物一律落在 `tmp/asset-pipeline/`（**开发期样例，不进 `src/**` 产品区**）。

## 依赖的工具
- `tsx` — 跑 TS 源（校验/编译脚本是 .mjs，但内部复用 `src/play/map` 的 TS 真身）
- `d3` / `svgson` / `mermaid` — 程序化几何、SVG 物化、可视化（当前 map-to-mermaid 用纯文本，d3/svgson 供后续几何/贴图线用）

## 想给链路里加新东西时
1. **复用已有真身，别另起 schema**：校验用 `validateMapStructure` + `validateMapAgainstClasses(parseIdx)`，编译用 `compileMap`，spawn 用 `prefab.ops.registerPrefabOps`。它们都被 `src/play/map/__tests__` 覆盖。
2. **占位 def**：基类层 `scene.class.*` / `transition.class.scene_link` 全体 abstract、不可直接 spawn。样例地图用 `d:scene/*` + `d:transition/*` 占位 def（见 `scripts/asset-pipeline/validate-and-compile.mjs` 的 `buildIndex`/`spawnAndAssert`——若改了样例要同步 index）。
3. **MapData 易踩的两类校验错**：
   - 曲线首尾必须贴合端点节点坐标（`SNAP_TOLERANCE=0.005`，否则 `MAP_PATH_ENDPOINT_NOT_SNAPPED`）
   - 嵌套尺度必须逐级合法（大→中→小，否则 `MAP_ILLEGAL_SCENE_NESTING`）；`scale` 字段必须与 index 里该 def 声明的尺度一致（否则 `MAP_SCALE_MISMATCH`）
4. **放置覆写键名不得撞 Expr 判别键**（`path`/`op`/`call`/`q`/`var`，否则 `MAP_OVERRIDE_KEY_SHADOWS_EXPR`）。

## 跑通判定
`asset:pipeline` 输出「通过 | 结构错误=0 引用错误=0 spawn=N节点/M边/K实体」且退出码 0，即验收通过。诊断是一次性全报、带 `correction`（编辑器友好，脚本同样可读）。

## 收尾纪律
改完 skill 相关脚本后跑三命令门禁：`npm run typecheck`、`npm run lint`、`npm run test`（本仓库落地脚本不过 lint/tsc，因为它们是 .mjs 且不在 src；若新增 TS 入口要确保不破坏 `tsc --noEmit` 与门禁）。

## 参考
- 决策：`docs/访谈决策记录.md` D-072~D-079（事实源）
- 规划：`docs/工程治理/02_素材工作流增量规划.md`
- 地图管线：`docs/创作系统/02_地图生产管线.md`、`01_创作工具与产权.md`
- 实现交接文档（本 topic 落盘）：`docs/创作系统/03_素材工作流管线实现交接.md`

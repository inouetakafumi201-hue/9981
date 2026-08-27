# WakeUp 三界面 v0 前端接线 Spec（完整版）

> **状态**：✅ 已裁决（2026-08-19 五项决策拍板，见 §十）· 待执行（代码已全部导入 `src/devboard/editor-shell/`）
> **上游文档**：`.kiro/接线准备/v0-frontend-wiring-readiness.md`（准备清单，本文是其完整化的执行规格）、`docs/v0-dev-map-editor-spec.md`、`docs/v0-dev-material-library-spec.md`、`docs/v0-dev-bench-spec.md`、`docs/v0-dev-pixel-painter-spec.md`
> **纪律铁律**（来自用户，逐字有效）：前端结构不改、逻辑全换；学习并模仿 v0 代码风格；文字术语不对的地方替换并识别对应后端功能接线；遇到与后端设计对不上的元素**暂时迁就前端**；接线结束后给出**多余项目清单**与**缺失设计清单**；接线过程凝练成可复用 skill。
> **本文档事实基准**：对 `editor-shell/` 全部 85+ 文件的逐文件穷举审计（lib 数据层/store 引擎全文阅读 + components 三界面/fx/painter 子代理全量结构报告）+ 对项目后端现状（`src/play/map` 契约、`src/devboard` 现有编辑器与端口、Tailwind/tokens、素材管线）的对照核查。所有"v0 现状"表述均出自实际代码，不是猜测。

---

## 〇、结论先行（TL;DR）

1. **v0 壳不是"三份独立代码"**，而是**一个完整的 Next.js 16 单页应用**：`editor-shell/` 里同时装着编辑器、素材库、研究台、像素绘制器四个界面，通过四个模块级 `useSyncExternalStore` store 做全屏覆盖层切换。`library-shell/`、`bench-shell/` 只有 README，用户实际把所有代码都放进了 `editor-shell/`。
2. **v0 的编辑器数据模型（v2：SceneNode/SceneBox 分离 + 聚合 + 空洞 + 粘连）比项目现有 `src/devboard/app/editor-state.ts` 更先进**，且与 `src/play/map` 的 canonical v2 契约（layers/layerId）高度同构——**结论：接线不是"把 v0 套到旧编辑器上"，而是"v0 编辑态 + play/map canonical 契约"作为新权威，旧 devboard 编辑器（EditorApp/CanvasView/editor-state）整体退役**。
3. 移植技术栈差异（Next 16/React 19/Tailwind 4/framer-motion 13 → Vite 5/React 18/Tailwind 3/framer-motion 11）**实际风险很低**：全壳代码只用了 `'use client'` + 经典 `framer-motion` + 自绘 SVG 图标，未用 next/font、next/image、@base-ui、React 19 新 API。真正要动的是：`@/` 别名、两个 `@import 'tailwindcss'` 头、`next.config` 删除、`public/` 静态资源搬位、`MaterialMeta` 数据结构对齐。
4. **端口契约已经定义好**（v0 注释里写死）：`projection.*` 只读投影（目标 `src/meta-state/`）+ `actions.*` 写动作通道 + 三界面切换回调（`openLibrary`/`openBench`/`closeLibrary`/`closeBench` + `openPixelPainter`）。**但项目里 `src/meta-state/` 尚不存在**（素材库/研究台的元状态层还没实现）——这是本接线工程的**最大依赖缺口**，对应执行批次必须把"元状态层最小可接线实现"纳入范围，否则素材库/研究台只能接上骨架不能接上真数据。
5. 建议**执行方式：2 个批次**。批次 A（4 个并行会话）：技术移植（Next→Vite 适配器、静态资源、@/ 别名）、编辑态↔canonical 契约桥（map-doc-adapter + validate 桥）、元状态层最小实现（meta-state projection/actions 契约）、三界面切换路由接管。批次 B（2 个并行会话）：编辑器 UI 全面接入真实端口 + 术语纠正；素材库/研究台/绘制器接入 projection/actions + 术语纠正。批次间强顺序（B 依赖 A 的移植与契约落地）。

---

## 一、接收现状与结构判定

### 1.1 用户实际放进去的东西

```
src/devboard/editor-shell/
├── app/            page.tsx（四界面编排根）· layout.tsx（Next 根布局）· globals.css（约 1340 行完整 HUD 设计系统）
├── components/
│   ├── editor/     11 文件（top-bar / left-panel / canvas / right-panel / diagnostics-bar / fx / game-cursor / game-context-menu / boot-sequence / global-controls / icons）
│   ├── library/    10 文件（asset-library 根 + 9 子件）
│   ├── bench/      9 文件（research-bench 根 + 8 子件）
│   ├── painter/    7 文件（pixel-painter-connector 接线层 + 6 纯组件）
│   └── fx/         6 文件（portal-transition / drop-settle / random-burst-field / tilt-card / weighted-button / use-organic-drift）
├── lib/            12 文件（map-types / editor-store / materials / library-data / library-store / bench-data / bench-store / canvas-coords / geometry / painter-store / painter-types / use-pixel-engine / sound / utils）
├── public/         15 个静态资源（material-atlas.png 8×8 图集、4 张 node-*.png、3 张 backdrop、若干占位）
├── package.json    Next.js 16.3.0 / React 19 / framer-motion 13 / lucide-react 1.16 / @base-ui 1.5 / tailwindcss 4.3
└── tsconfig.json / next.config.mjs / postcss.config.mjs / components.json / AGENTS.md（nextjs-agent-rules）
```

`src/devboard/library-shell/` 与 `src/devboard/bench-shell/` 仅含 README——**三份代码实际都进了一个目录**。接线时需要决定目录组织（见 1.3）。

### 1.2 v0 壳的架构判定（分析结论）

**a. 状态架构：4 个模块级 store，无 Zustand。** 全部用「模块级可变 state + `useSyncExternalStore` + selector 订阅」，这是 v0 自己实现的项目现有模式（`editor-store.ts` 里注释明确说明），不是 spec 里推的 zustand。**接线时保持这个模式，不要改成 zustand**（改 store 范式 = 违反"学习模仿 v0 代码设计"）。

| store | 职责 | 关键 slice |
|---|---|---|
| `lib/editor-store.ts` | 地图文档/工具/选中/相机/历史/诊断/取样/素材拖拽 | doc/mode/selection/camera/currentLayerId/sampleSlot/diagnostics/pulse/panelOpen/toast/dragMaterial |
| `lib/library-store.ts` | 素材库：过场 slice（closed/entering/open/leaving）+ 应用 slice | phase/origin + tab/scope/category/query/detailOpenId/blueprintOpenId/hoveredId/dragId/rejectSlot/starred/quickSlots/quickExpanded/toast/textures |
| `lib/bench-store.ts` | 研究台：过场 slice + 应用 slice | phase/origin/portalTheme + activeSection/activeCategory/selectedTokenId/tokenDrag/starredTokens/forgeBase/forgeSlots/molding/jobs/focusedJobId/extractStage/toast |
| `lib/painter-store.ts` | 像素绘制器：极简导航 | open/materialId（绘制态在 overlay 组件内自持，刻意不入 store） |

**b. 界面编排：page.tsx 单页组合 + 全屏覆盖层。** `EditorShell`（编辑器全屏）为底；`AssetLibrary`（z-[880]）、`ResearchBench`（z-[920]）、`PixelPainter`（z-[980]）是叠加覆盖层，过场相位机控制挂载。切换链：编辑器右栏「素材库」按钮 → `openLibrary(origin)`（暖金传送门）→ 素材库 → 详情「去研究台锻造」→ `openBench(origin)`（青色传送门）→ 研究台 → 「回素材库」→ `closeBench()`（暖色门）。**这就是 spec §三界面切换链的完整落地，且 v0 实现了"进出不对称"（进入有仪式门、返回只轻淡出）等 spec 没写但更优的细节。**

**c. 编辑器数据模型 v2 已完整实现（比旧 devboard 先进）。** `lib/map-types.ts` 完整实现了：SceneNode（逻辑节点+高光点 `at`）/ SceneBox（纯显示矩形）分离、`recomputeAggregation`（并查集聚合）、`computeHoleCells`（flood-fill 空洞）、`foreignSceneIdsTouchedByRect/Group`（粘连判定）、旋转 AABB、`overlayOpacity` 跨层透明度、canonical v2 导出（`buildMapData` → 归一化 0..1）。`editor-store.ts` 实现了全部编辑行为 + 100 步历史 + 诊断校验 + 拉弯/拍直/折点 + 遮挡-连线自动关联。**这些逻辑 v0 已写好且质量高，接线任务不是"重写逻辑"，而是"把这份编辑态接到 play/map 契约与素材库数据上"。**

**d. 素材库/研究台数据层是"结构化占位"。** `library-data.ts`（MaterialMeta 完整字段 + 10 精选 + 派生目录 + 6 蓝本 + 收集统计）、`bench-data.ts`（31 词条 + 锻造槽 + 合成任务时间模型 + 塑形栏）字段命名**已经对齐 §7.2 端口**（注释逐条标注"真实版由 projection 替换"）。合成任务模型尤其成熟：**结果在提交时确定、按真实时间戳纯派生进度、不阻塞可离开、60-120s 对齐 LLM 时长**——这些是 spec 的硬要求且 v0 已正确实现。

**e. 设计系统完整。** globals.css 包含：chamfer 切角、hud-btn 系列、holo 全息扫描、CRT 氛围、游戏光标、右键菜单、boot 终端序列、`.lib-root`（素材库青主题）、`.bench-root`（研究台暖主题）、painter-range 滑块、portal 过场动画。**移植时这套 CSS 原样搬入，不改。**

### 1.3 目录组织决策（已裁决 2026-08-19：不变）

- 用户说"前端应该放的位置，不是一个名为 V0 的文件夹"，且本 spec 准备清单里的接收目录是 `editor-shell/`/`library-shell/`/`bench-shell/` 三个。
- 但 v0 代码是**一个整体**（跨目录 import 依赖、共享 globals.css 与 fx/）：拆成三个目录会制造"每个目录各自一份 globals.css/各自一份 fx/"的假分离。
- **裁决（用户拍板"不变"）**：保持 v0 原始目录树 `editor-shell/`（含 app/components/lib/public）原封不动地作为"壳代码"存放处；接线产物（适配器、契约桥、meta-state）放在壳之外的 `src/devboard/` 既有命名空间（`ports/`、`meta-state/`、`editor-shell-adapters/`）。理由：① 壳保持 v0 原样 = 最大可审计性（用户未来继续用 v0 迭代时 diff 干净）；② 接线层放壳外 = 不污染"优秀前端设计"蓝本；③ 现有 devboard 命名空间（ports/layers/verify）已是"围绕编辑器的基础设施"的既成事实。旧 `library-shell/`、`bench-shell/` README 改为指向 editor-shell 的说明。

---

## 二、技术适配（Next.js 16 → Vite 5 移植方案）

### 2.1 版本差异与实测风险

| 维度 | v0 用的 | 项目现有 | 实际影响 |
|---|---|---|---|
| React | 19 | 18.3 + @types/react 18 | **无 API 影响**：全壳只用了 useState/useEffect/useRef/useCallback/useMemo + useSyncExternalStore（18 有）。StrictMode 双调用在 18 下也成立。 |
| Tailwind | 4（`@import 'tailwindcss'` + `@theme`） | 3.4（`@tailwind base/components/utilities`） | **唯一硬迁移点**：globals.css 头部 3 行 import + `@theme inline {}` 块需改写为 Tailwind 3 等价物（`:root` CSS 变量已在 globals.css 里平铺定义，`@theme` 主要承担"把变量映射成 tailwind 颜色类"，可改写为 tailwind.config theme.extend 映射或直接依赖 CSS 变量类名）。 |
| framer-motion | 13（`framer-motion` 包） | 11.18（`framer-motion` 包） | 低风险：API 兼容（motion/AnimatePresence/useMotionValue/useSpring/useTransform/useAnimationFrame/layoutId 均为稳定 API）。**保持 `framer-motion` 包名不改**（v0 未用 `motion/react`）。 |
| lucide-react | 1.16 | 1.31 | 低风险：项目版本更高，向后兼容。 |
| @base-ui/react | 1.5 | 无（用 @radix-ui/*） | **零使用**：全壳无 @base-ui import（审计确认）。不装。 |
| next/font / next/image | 有（layout.tsx 字体） | 无 | 迁移点：字体改本地 CSS font-family 回退（Noto Sans SC 已有系统栈回退）；`<img>` 静态图改普通 img（v0 已用普通 img）。 |
| `@/` 路径别名 | `@/*` → 项目根（editor-shell 自身） | 已有 `@devboard`、`@map` | 迁移点：editor-shell 内 `@/lib/...`、`@/components/...` 需映射到 `editor-shell` 自身。**决策：Vite alias 增加 `@shell` → editor-shell 根**，并全量把壳内 `@/` 改写为 `@shell/`（纯 import 路径字符串替换，不动任何组件逻辑）。 |

### 2.2 移植动作清单（批次 A-1 独占）

1. **Vite 侧**：`vite.config.ts` 增加 alias `@shell`；确认 `@devboard`/`@map` 不变。`tsconfig.devboard.json` 的 paths 同步（tsc 门禁需要）。
2. **入口**：`src/devboard/main.tsx` 渲染 v0 壳根（editor-shell 的 page.tsx 等价物 `EditorShell`），旧的 `EditorApp` 渲染路径退役（代码保留不删，见 §六 退役说明）。
3. **globals.css**：迁入 `src/devboard/editor-shell/app/globals.css` 全量内容；Tailwind 4 头改写为 Tailwind 3（`@tailwind` 三指令 + 把 `@theme inline` 的变量映射挪进 `tailwind.config.cjs` 的 theme.extend.colors/fontFamily——项目已有该文件且从 `src/design/tokens.cjs` 读色，**注意：不能直接覆盖项目 tokens 语义色**，v0 壳的色板是它自己的设计系统，把 v0 变量作为独立 color 命名空间并入，不动项目既有 `social/stamina/alert/...` 命名。冲突类名实测仅 `CanvasView.tsx` 用 `bg-panel` 等——该文件随旧编辑器退役，冲突面消失）。
4. **Tailwind 内容扫描**：`tailwind.config.cjs` 的 content 加入 `./src/devboard/editor-shell/**/*.{ts,tsx}`。
5. **静态资源**：`editor-shell/public/*` → 项目静态目录（devboard 根 public/ 或 `run/assets/` 之外的 devboard 专属目录，**决策：`src/devboard/public/` 作为 vite publicDir**，与 `run/assets/` 素材管线产物分开）。资源引用路径 `/editor/...`、`/library/...`、`/bench/...`、`/painter/...` 保持字面不变。
6. **删除**：`next.config.mjs`、`app/layout.tsx`（字体元数据改到 index.html）、`package.json`（壳自带，不并入）、`postcss.config.mjs`（Tailwind 4 版，项目已有 v3 版）、`components.json`（shadcn 无关）。`AGENTS.md`（nextjs-agent-rules）归档或删除。
7. **字体**：`--font-noto-sans-sc` / `--font-geist-mono` CSS 变量在 globals.css 的 `@theme` 里被引用——Tailwind 3 下改为 index.html 直接加载 Noto Sans SC（或系统字体栈回退），`--font-sans`/`--font-mono` 变量在 :root 定义。
8. **门禁**：`npm run typecheck:devboard` 全绿后再进批次 B。

### 2.3 React 18 双 StrictMode 注意

壳在 `useEffect` 里有几处"加载即启动"副作用（boot-sequence 的 sessionStorage 标记、bench-store 的 `ensureTicking()` 模块级启动、painter 的 `usePixelEngine` reset）。React 18 StrictMode 双执行 effect 时 boot 序列可能闪两次。**处置：boot-sequence 用 sessionStorage 已有幂等；bench tick 是模块级 interval 有幂等保护；painter reset 以 `isOpen` 为依赖幂等。按现状保留，实测异常再修，不预改。**

---

## 三、数据模型对齐（v0 编辑态 ↔ play/map canonical 契约）

### 3.1 两侧现状

**v0 编辑态**（`map-types.ts`）：`MapDoc`（世界坐标 1600×1000）+ `MapData`（导出归一化 0..1，schemaVersion '2.0'），字段：layers（id/name/height?）/ nodes（id/name/scale/layerId/parent?/def?/at）/ edges（from/to/directionality/path/transitionWindow?/visualObstruction?/physicalObstruction?/semanticAnchor?/def?）/ obstructions / terrains / placements / metadata。

**play/map canonical**（`src/play/map/types.ts`）：`CanonicalMapData`（schemaVersion '2.0'）：backdrop + layers（id/name?/height?/backdrop?/transform?）+ nodes（id/**def**/scale/at/**layerId**/parent?/name?）+ edges（id/**def**/a/b/directionality/path/visualObstruction?/physicalObstruction?/transitionWindow?/semanticAnchor?）+ placements（id/**at**(节点id)/**def**/overrides?/temporaryFree?）。配套 validate.ts（结构+类校验）、compile.ts（→PrefabDef）、curve.ts（样条）、serialize.ts（规范化）。

### 3.2 差异表（逐字段）

| 语义 | v0 MapDoc/MapData | play/map canonical | 接线动作 |
|---|---|---|---|
| 节点引用 | nodes[].id | nodes[].id | 一致，直通 |
| 场景名称 | `node.name`（必填） | `node.name?`（playerFacing 必填） | 直通 |
| 尺度 | `scale: 'large'\|'medium'\|'small'` | `scale: SceneScale` 同三档 | 一致 |
| 层级 | `layerId` 引用 layers[] | `layerId` 引用 layers[]（canonical v2 正是为此扩展） | **天然对齐** |
| 图层 | layers[].{id,name,height?}（height 空=独立层） | MapLayer 同字段 + backdrop?/transform? | v0 → canonical 直通；canonical → v0 丢弃 backdrop/transform（编辑态不消费） |
| 边端点 | `from`/`to` 引用节点 id | `a`/`b` 引用节点 id | 字段改名（rename） |
| 边定义 | `def?`（未接线） | `def`（门户类型，必填） | **缺失设计**：v0 编辑器没有"给边选门户类型"的入口。接线期编辑器新建边填占位 def（如 `transition.class.scene_link`），把"边 def 选择 UI"列入缺失设计清单。 |
| 过渡窗口 | `transitionWindow?: Vec`（单点） | `transitionWindow?: { control: Vec2[] }` | 结构包装：v0 单点 → canonical `{control:[点]}`；反向取 control[0]。 |
| 遮挡 | 独立 `obstructions[]`（矩形 + affectsEdges[]） | 挂在 edge 上：`edge.visualObstruction?: ObstructionSpec` / `physicalObstruction?`（box/circle/polygon + bounds + height?） | **最大结构差异**：v0 是"遮挡框独立实体+关联边"，play/map 是"边内嵌遮挡规格"。对齐：导出时把 v0 的矩形转成 `{shape:'box', bounds:[{x,y},{x+w,y+h}]}`（归一化坐标）并入对应边；**v0 的"遮挡框必须覆盖某条边"的关联（affectsEdges）在 canonical 里没有位置**——v0 的拖拽式遮挡框编辑（独立框 + 旋转 + 自动关联）是编辑体验层，canonical 是数据层。**接线决策：编辑态保留 v0 的 obstructions[]（编辑体验），导出桥把它折叠进 edges[]；反向加载把 edge 的 visualObstruction/physicalObstruction 展开回 v0 obstructions[]。** |
| 地形 | 独立 `terrains[]`（highland/lowland 矩形） | 无对应字段（canonical 里没有地形概念） | **多余项目**：v0 地形框是 spec 明确要的编辑器图元，但 play/map 契约没有地形。接线：编辑态保留 terrains[]（本地保存/加载保留），**导出时丢弃**（进多余/缺失交接：play/map 侧缺地形表达，见缺失清单）。 |
| 素材放置 | `placements[]`（materialId + sceneId + x/y 世界坐标） | `placements[]`（**at=宿主节点 id** + def + overrides? + temporaryFree?） | **字段语义差异**：v0 的 placement 挂在场景 + 世界坐标（编辑器内自由摆）；play/map 的 placement 是"把实例快照内联到节点上"。对齐：v0 placement 的 `sceneId` → canonical `at`（场景节点 id）；`materialId` → `def`（素材 id 即 def 引用，由素材库 id 体系决定，见 §4.2）；`x/y` 世界坐标 → canonical 丢弃（canonical 无坐标字段），**但 v0 编辑态保留 x/y 做画布摆放**。 |
| 出生点 | 无显式字段（validate 里以"第一个节点为出生点"） | 无显式字段（同：第一个节点） | 一致 |
| 方向性 | 4 值（bidirectional/unidirectional/one-way-up/one-way-down） | 4 值同（Directionality） | 一致 |
| 语义锚点 | `semanticAnchor: 'highland'\|'lowland'\|'neutral'` | `semanticAnchor?: 'high'\|'low'\|'neutral'` | 值域改名：highland→high，lowland→low（render 端本地映射） |
| 元数据 | metadata{created,modified,author} | 无 metadata 字段 | 导出时丢弃（或由加载层补） |

### 3.3 适配器设计（批次 A-2 独占交付）

新建 `src/devboard/ports/map-doc-adapter.ts`（放 devboard 命名空间，只 import `map-contracts` 桶，与既有 ports 纪律一致）：

- `canonicalToDoc(canonical: CanonicalMapData): MapDoc`——加载/打开既有地图进编辑器（反解遮挡/地形/放置/过渡窗/方向性/锚点值域）。
- `docToCanonical(doc: MapDoc): CanonicalMapData`——导出（正向折叠，含 3.2 全部转换；产出必须能过 `validateMapStructure` + `canonicalizeForPublish` 的既有测试）。
- 双向往返测试 + PBT（快检：随机 MapDoc → docToCanonical → canonicalToDoc，不变量 = 节点/边拓扑等价、方向性/锚点语义等价、放置宿主等价；遮挡/地形的编辑态往返保留在 v0 层，不承诺 canonical 层往返）。
- **职责边界（写死）**：适配器只做形状转换，不做任何校验；校验一律走 `map-contracts` 的 `validateMapStructure`/`validateMapAgainstClasses`。适配器**不得** import `src/play/map/types.js` 小路径（经桶）。

### 3.4 诊断桥（批次 A-2 一并交付）

v0 的 `editor-store.validate()` 产出自有 `Diagnostic[]`（错误分级 + target + correction 文案），play/map 的 `validateMapStructure` 产出 `MapDiagnostic[]`（code + severity + subject + message）。**决策：编辑器内即时反馈继续用 v0 自有诊断**（快、面向画布交互、带 correction 文案——这是编辑体验，不该换）；**导出/发布门禁用 play/map 诊断**（权威、与游戏校验一致）。桥 = 把 v0 诊断"翻译"为 play/map 语义的对照表（如 `deg-` 前缀 ↔ `MAP_CONNECTION_LIMIT_EXCEEDED`）留在 `ports/map-doc-adapter.ts` 注释与测试里，不强制一一对应（两套诊断并存是**自主决策**，理由：v0 诊断更贴近创作者操作，play/map 诊断是装载权威）。

---

## 四、术语纠正映射表（全壳审计产物）

### 4.1 编辑器

| 位置 | v0 文字 | 判定 | 项目权威 | 动作 |
|---|---|---|---|---|
| 顶栏 | `WakeUp 筑梦台` + `Dream Scene Editor` | 品牌一致 | 筑梦台（spec §顶栏） | 保留；小字改 `地图编辑 · 研究台`（spec 原文） |
| 左栏 | `梦境蓝图` | 术语偏差 | spec 权威名是「已加载地图」；「梦境蓝图」与素材库的「地图·蓝本」语义撞车 | **改「已加载地图」**（蓝图=蓝本，留给素材库 tab） |
| 左栏 | `图层与高度` | 一致 | 图层（高度=楼层） | 保留 |
| 左栏 | 快捷键表 `运行测试` | 一致 | 测试 | 保留 |
| 右栏 | `快速素材库` + `素材库` 按钮 | 一致 | 快捷素材库（spec） | 保留 |
| 右栏 | `运行测试 (P)` | 一致 | — | 保留 |
| 工具条 | `放置场景` | 一致 | 放置（PlaceNode） | 保留 |
| 图例 | `过渡窗口` | 一致 | 过渡窗口 | 保留 |
| 画布 toast | `不能跨场景连接` | 一致（spec 原文） | 粘连拒绝 | 保留 |
| 画布 toast | `已融合折点` | 一致 | 吸附删除 | 保留 |
| 诊断 | `连通性/连接上限/过渡窗口/遮挡框/素材放置/性能预估` | 自创指标 | spec 诊断六项（连通性/连接上限/场景命名/遮挡覆盖…） | **"性能预估"列移除（已裁决）**，其余指标口径保留 v0 |

### 4.2 素材库 / 研究台 / 绘制器

| 位置 | v0 文字 | 判定 | 项目权威 | 动作 |
|---|---|---|---|---|
| 素材库标题 | `梦境素材库` | 一致 | 梦境素材库 | 保留 |
| 素材库标题小字 | `Dream Asset Library` | 补中文 | spec：`书架 · 创作资源` | **替换** |
| 素材库 tab | `可放置元素` | 一致（spec 原文） | 积木 | 保留 v0 原文 |
| 素材库 tab | `地图·蓝本` | 一致 | 蓝本 | 保留 |
| 素材库 | `回编辑器` | 一致 | 回编辑器 | 保留 |
| 蓝本 | `可选作蓝本` | 语义偏差 | spec：可在编辑器选作蓝本 | **改「可在编辑器选作蓝本」** |
| 蓝本 toast | `熟悉度满 100% 解锁（当前 X%）` | 一致 | 熟悉度 | 保留 |
| 素材详情 | `限时免费获取：剩余 X` | 语义偏差 | spec：限免 = 摆图可用、不进拥有库；文案「限免素材可摆图，不进入你的拥有库」 | **替换为 spec 文案** |
| 素材详情 | `词条「X」详情待接线` / `词条挂载待接线` | 占位 | 词条详情 → 研究台词条库定位（技术债 1：switchToBench(tokenId, {locate}) 未注入时禁用） | 接线后改为「切到研究台查看词条」或禁用标注（见 §5.4 技术债 1） |
| 素材库 | `我的素材` | 一致 | 拥有库 | 保留（分栏语义 = owned:true） |
| 素材库 | `图鉴等级 Lv.23` | 占位数据 | spec 未定义图鉴等级（明确不做收藏室/收集册主界面） | **移除（已裁决）**：B-2 删除 library-sidebar 对应块与 COLLECTION 数据 |
| 研究台标题 | `WakeUp · 研究台` | 一致 | 研究台 | 保留 |
| 研究台 | `词条库` / `锻造台` | 一致 | 词条库/锻造台 | 保留 |
| 研究台 | `回素材库` | 一致 | 回素材库 | 保留 |
| 研究台 | `x / y 已收集` | 一致 | 收集进度 | 保留 |
| 研究台 | `提取` + `待白名单` | 占位 | spec 技术债 1：白名单未提供时禁用并标注 | **保留现状（已是正确占位态）**，白名单数据接入即点亮 |
| 研究台 | `储存·派生`（v0 写"储存"） | 用字 | spec：保存/派生 | **改「保存 · 派生」**（v0 的"储存"是错别字级偏差） |
| 研究台 | `收下成品` / `知悉 · 材料与词条已返还` | 一致 | 收下 / 驳回 | 保留 |
| 研究台 | `消耗记忆碎片 · 立即完成` | 一致（数值待接线） | 加急 | 保留（数值后端未定，占位提示已正确） |
| 研究台 pod | **`正在科研加���`（乱码！源文件 3 个 U+FFFD）** | **BUG** | `正在科研加工` | **修复（唯一乱码）** |
| 研究台 | `可以先去离开去做别的事`（v0 写"先去离开"） | 语序 | `可以先离开去做别的事` | 修复 |
| 绘制器 | `像素绘制` / `保存` / `丢弃` | 一致 | 像素绘制器 | 保留 |

### 4.3 与 spec 有出入、但按"迁就前端"保留的项

- 编辑器的"视觉遮挡/物理遮挡"在 spec 里是**独立框 + 拖拽旋转**（v0 已实现），play/map 里是 edge 内嵌规格——**数据层折叠（§3.2），编辑体验层保留 v0**。
- 素材库右栏详情是**固定浮层**（v0 实现），spec 说"覆盖浮层或右侧固定栏，V0 择审美更优者"——**采纳 v0 的固定浮层**。
- 素材库"图鉴等级/收集进度"（spec 未要求）→ **已裁决移除**（B-2）。
- 编辑器左栏"快捷键"表里 v0 写的键位与 spec 一致（V/空格/N/滚轮/E/Ctrl+Z/I/Ctrl+S/P/Delete/1-3/Esc），保留。

---

## 五、端口接线映射表（四块，批次 B 逐个消费）

### 5.1 编辑器 ↔ play/map 契约（批次 B-1）

| v0 内部 | 真实端口 | 动作 |
|---|---|---|
| `editor-store.seedDoc()` 内置示例地图 | `canonicalToDoc(loadMap(id))` + 新蓝图（`blueprintCopy`） | seedDoc 保留为"空白新建"基底；加载路径换真实 |
| `buildMapData()` / `exportMap()`（v0 自产归一化） | `docToCanonical(doc)` + `serializeMapPublish`（map-io 既有） | 替换导出路径；门禁校验用 `validateMapStructure` |
| `editor-store.validate()` 自有诊断 | 保留（编辑体验），导出前叠加 play/map 校验 | 双轨（§3.4） |
| `materials.ts` 70 素材（编辑器右栏快捷素材） | `material-availability.ts` 的 `registeredMaterials()` + 素材库 MaterialMeta 目录 | **统一 id 体系（已裁决：是，且批量补齐可复用）**：v0 编辑器用 `装置-0-储物柜` 格式 id，素材库用 `locker_7f3a` 格式——全壳统一为素材库 MaterialMeta 的 id（`locker_7f3a` 系），`materials.ts` 退化为"图集 tile 索引查询"（`id → {name, category, tile}` 注册表），素材目录读 `projection.allVisible()`（素材库接线后同源）；**批量补齐可复用**：注册表保留 `registerMaterials()` 批量注册入口，供 sprite-forge 批量管线（wakeup-batch-manifest）在素材全面补齐时追加新 id + tile/贴图覆盖，无需改壳组件；`getMaterialChar`（按 `-` 拆分取首字）改为按 MaterialMeta.name 取首字 |
| `addPlacement(materialId, sceneId, at)` | 统一 id + `docToCanonical` 放置折叠 | 放置宿主 = 高光点所在场景节点 |
| 编辑态 `MapDoc` | 持久化：编辑器本地保存用 v0 MapDoc 形状（含 obstructions/terrains/placements 坐标），**发布/导出用 canonical** | 双形状分工：本地 = 富编辑态，发布 = 契约态（对应 map-io 的 ExportBundle 先例） |

### 5.2 素材库 ↔ 元状态层 projection/actions（批次 B-2）

| 占位（library-data / library-store） | 真实端口（spec §7.2 原表） | 动作 |
|---|---|---|
| `MATERIALS_META` 生成目录 | `projection.allVisible()` / `projection.ownedMaterials()` | `filteredMaterials` 的入参换投影（保留纯函数结构） |
| `materialMetaById` | `projection.materialDetail(id)` | 包装换源 |
| `equippedTokens`（MaterialMeta 内嵌） | `projection.equippedTokensOf(id)` | 读换源 |
| `badgeStateOf` | `projection.badgeStateOf(id)` | **已是纯函数形态，直通** |
| `BLUEPRINTS` ×6 | `projection.blueprintList()` | 读换源 |
| `COLLECTION`（图鉴等级） | 无端口 → **已裁决移除**（B-2 删侧栏块 + 数据） | — |
| `starred` Set + `toggleStar` | `projection.starred()` + `actions.toggleStar(id)`（乐观更新） | 写换动作通道 |
| `quickSlots` + `quickBarSet/quickBarClear` | `projection.quickBar()` + `actions.quickBarSet/quickBarClear` | 写换动作通道；限免/UGC 拒绝规则**已实现在 v0 store**，迁移到 actions 侧或保留双保险 |
| `materialSetTexture` / `materialTexture` | `actions.materialSetTexture(id, texture)`（非合成物拒绝）+ `projection.materialTexture(id)` | 写换动作通道；拒绝逻辑从 v0 的"全接受"改为"仅合成物" |
| `detailOpenId` 等 UI 本地态 | 保留 store 本地（覆盖层状态保留需求） | 不动 |

### 5.3 研究台 ↔ 元状态层（批次 B-2）

| 占位（bench-data / bench-store） | 真实端口（spec §7.2 原表） | 动作 |
|---|---|---|
| `BENCH_TOKENS` 31 词条 | `projection.tokens()` + 五大类分组 | 读换源 |
| 锻造槽位（forgeBase/forgeSlots） | `projection.materialDetail(baseId)` + `equippedTokensOf(baseId)` | 读换源 |
| `DEMO_JOBS` + 本地随机时长 | `projection.synthesisQueue()` + `actions.synthesizeSubmit` | **结果不得前端随机**：submit 时 outcome 由 actions 返回（v0 已把"提交时定结果"模型写好，把 `deriveOutcome` 换成 actions 返回即可） |
| `claimJob` / `dismissFailedJob` / `rushJob` | `actions.synthesizeClaim / synthesizeRush`（dismiss 归入 claim 的失败分支） | 写换动作通道；`rushJob` 消耗数值占位保留 |
| `startExtract` / `EXTRACT_WHITELIST` | `actions.extractToken(materialId, focusAttr)`（白名单空 → 禁用「待白名单」） | v0 现状正确，换通道 |
| `forgeSave` / `forgeDerive` | `actions.forgeModify(materialId, slots[], {mode:'save'\|'derive'})` | 写换动作通道 |
| `molding` + `moldingSet` | `projection.moldingBar()` + `actions.moldingSet(slotIndex, materialId)` | 读/写换源；限免/未解锁拒绝保留双保险 |
| 词条星标 `starredTokens` | `actions.toggleStar(tokenId)` | 写换动作通道 |
| ~~词条快捷栏~~ | ~~actions.quickBarTokenSet~~（2026-08-19 废除） | **v0 已正确不做**（研究台右栏是共享素材快捷栏） |

### 5.4 三界面切换 + 像素绘制器（批次 B-2 收尾）

| 机制 | v0 现状 | 接线动作 |
|---|---|---|
| 编辑器→素材库 | 右栏「素材库」按钮 `openLibrary({x,y})` 暖金门 | 保留（已是完整端口） |
| 素材库→研究台 | 详情「去研究台锻造」`openBench({x,y})` 青门 | 保留；`switchToBench(materialId)` 语义已由"openBench + forgeBase 装载"覆盖（v0 用 `setForgeBase` 承载） |
| 研究台→素材库 | 「回素材库」`closeBench()` 暖门 | 保留 |
| 绘制器 | `openPixelPainter(materialId)` + connector（唯一接线层）→ onSave → `materialSetTexture` + `closePixelPainter` | **结构已经是对的**：connector 是唯一知道"元状态层"的地方，overlay 是纯组件。接线只换 store 动作实现 |
| 研究台收下→绘制贴图 | `claimJob` → `closeBench` → `openDetail(baseId)` → `openPixelPainter(baseId)` | v0 注释自标技术债：成品 id 占位用 `baseMaterialId`，接线后改 `job.resultMaterialId`（元状态层给出成品 id 即通） |
| 词条徽章点击 | toast「待接线」 | 技术债 1：`switchToBench(tokenId, {locate:'token-library'})` 注入后启用；未注入保持禁用标注（**不强行接线**，迁就前端现状） |

---

## 六、旧 devboard 编辑器的处置（已裁决 2026-08-19：删除）

- 现状：`src/devboard/app/EditorApp.tsx`（旧编辑器，useState 大组件 + editor-state.ts 状态机 + CanvasView.tsx SVG 渲染 + editor.css v3 主题）、`editor.css.backup`（未跟踪）、`GameButton/GameInput/GameSelect/GameScrollArea`（上轮改造产物，仅旧编辑器使用）。
- **裁决（用户拍板"删除" + "只要新的"）**：v0 壳整体上位后，旧编辑器**删除**，新壳为 devboard 唯一入口（不与旧编辑器并存）。删除清单（批次 A-1 执行：先删 EditorApp 依赖、typecheck/vitest 确认无残留引用再删本体，以门禁为准）：
  - `src/devboard/app/EditorApp.tsx`、`CanvasView.tsx`、`editor-state.ts`、`editor-history.ts`、`camera.ts`、`tokens.ts`、`graffiti.ts`、`editor.css`、`index.css`、`editor.css.backup`
  - `src/devboard/app/` 配套测试（`editor-state.*.test.ts`、`graffiti.property.test.ts` 等）与 `src/devboard/__tests__/` 中只测旧编辑器 API 的用例：先查引用再删，涉及 map 逻辑的可改写后归入适配器测试
  - `src/devboard/components/`（GameButton/GameInput/GameSelect/GameScrollArea，无其它引用）
  - `src/devboard/layers/`（layer-shapes/layer-rules：v0 壳已内联同语义，无引用后删）
- **保留（被接线复用，不删）**：`editor/map-io.ts`（`serializeMapPublish`/`blueprintCopy`，§3.3 直接用）、`editor/workspace-state.ts`（§8.2-3 加载既有地图可接）、`ports/map-contracts.ts`（契约桶，全壳经此消费）、`ports/material-availability.ts`（§5.1 直接用）、`verify/playtest.ts`（"运行测试"按钮可对接——v0 壳的 playtest 模式目前只有 banner，**列入缺失设计清单**：v0 未实现真实 playtest 预览，接 playtestSmoke 是接线加分项）、批次 A-2 新建的 `ports/map-doc-adapter.ts`。

---

## 七、执行批次规划（并行锁）

### 批次 A（4 个并行会话，彼此不共享可写文件）

**A-1 技术移植（Vite 适配）**
- 独占写：`vite.config.ts`、`tsconfig.devboard.json`、`tailwind.config.cjs`、`src/devboard/main.tsx`、`src/devboard/index.html`、`src/devboard/public/**`（新建）、`src/devboard/editor-shell/**` 内仅限：globals.css 头、`@/`→`@shell/` 的 import 字符串替换（**只许改 import 语句与 CSS 头部，禁止改任何组件逻辑/类名/文案**）、删除 next.config.mjs/app/layout.tsx/postcss.config.mjs/components.json/AGENTS.md、`editor.css.backup` 删除、**旧编辑器删除（§六清单：先删依赖、typecheck/vitest 确认无残留引用再删本体）**。
- 只读参考：`editor-shell/` 全部、`vite.config.ts`、`tailwind.config.cjs`、`package.json`（项目依赖版本）。
- 交付门禁：`npm run typecheck:devboard` 0 error；`npm run devboard` 启动后编辑器壳可渲染（boot 序列 + 画布 + 三栏）。

**A-2 编辑态 ↔ canonical 契约桥**
- 独占写：`src/devboard/ports/map-doc-adapter.ts`（新建）、`src/devboard/ports/__tests__/map-doc-adapter.test.ts`（新建，含 PBT 往返）。
- 只读参考：`src/play/map/types.ts`、`src/devboard/ports/map-contracts.ts`、`src/devboard/editor/map-io.ts`、`editor-shell/lib/map-types.ts`、`editor-shell/lib/editor-store.ts`。
- 交付门禁：`npx vitest run src/devboard/ports` 全绿；适配器产出能过 `validateMapStructure` 的现有用例。
- **禁止**：改 `src/play/map/**` 任何文件（跨 Spec 契约不归 devboard 管）；改 `editor-shell/lib/map-types.ts`（壳保持原样）。

**A-3 元状态层最小实现（素材库/研究台的数据源）**
- 独占写：`src/devboard/meta-state/`（新建，实现 `projection.*` 与 `actions.*` 的**可接线最小版本**：以 v0 的 library-data/bench-data 占位数据为种子、按 §7.2 端口签名导出 projection/actions；`materialSetTexture` 按"仅合成物"实现拒绝；`synthesizeSubmit` 返回 v0 同款 outcome 派生逻辑（提交时定结果）；三界面切换回调 `switchToBench/switchToEditor/switchToLibrary` 在此定义并注入 store）、`src/devboard/meta-state/__tests__/`（端口签名契约测试：projeciton 只读、actions 有写语义、限免/UGC 拒绝规则）。
- 只读参考：`editor-shell/lib/library-data.ts`、`library-store.ts`、`bench-data.ts`、`bench-store.ts`、`painter-types.ts`、`docs/v0-dev-material-library-spec.md`、`docs/v0-dev-bench-spec.md`（§7.2 表）。
- 交付门禁：`npx vitest run src/devboard/meta-state` 全绿。
- **注意（并行纪律）**：A-3 只写 `src/devboard/meta-state/`，**不碰** editor-shell 任何文件；B-2 才把壳的 store 换成调 meta-state。

**A-4 三界面切换路由接管 + 全屏编排验证**
- 独占写：`src/devboard/editor-shell-adapters/`（新建：`shell-bootstrap.tsx`——把 meta-state 的 projection/actions 与三界面 store 接线、把 A-1 迁移后的壳根组件挂在 Vite 入口下；只做编排，不写界面逻辑）。
- 只读参考：`editor-shell/app/page.tsx`、`lib/library-store.ts`、`lib/bench-store.ts`、`lib/painter-store.ts`。
- 交付门禁：`npm run devboard` 手测切换链（编辑器→素材库→研究台→素材库→编辑器）全通；`npm run typecheck:devboard` 绿。
- **注意**：A-4 与 A-3 之间是**读依赖**（A-4 消费 A-3 的 meta-state 签名）→ 若两者并行，A-4 需先按 A-3 的**约定签名**（spec §五/§7.2 已写死）实现，A-3 交付后若签名有出入由 A-4 收尾对齐——风险已被 §7.2 端口表消除，签名以 spec 表为唯一契约。

### 批次 B（2 个并行会话，依赖 A 全部完成）

**B-1 编辑器 UI 接入真实端口 + 术语纠正**
- 独占写：`editor-shell/lib/editor-store.ts`（仅：seedDoc→加载桥、exportMap→docToCanonical+serializeMapPublish、materials 统一 id、addPlacement 宿主）、`editor-shell/lib/materials.ts`（退化为 tile 查询 + 从 meta-state 读目录 + **`registerMaterials()` 批量注册入口，供 sprite-forge 批量管线复用，见 §5.1**）、`editor-shell/components/editor/*` 中**仅文案与术语替换**（§4.1 表）、`editor-shell/components/editor/left-panel.tsx`（「梦境蓝图」→「已加载地图」）、顶栏小字、**diagnostics-bar 移除"性能预估"指标列（§8.1-2 裁决）**。
- 禁止：改 canvas.tsx 的交互逻辑、geometry/map-types（壳数据模型原样）。
- 门禁：`npx vitest run`（devboard 范围）+ typecheck + lint。

**B-2 素材库/研究台/绘制器接入 projection/actions + 术语纠正**
- 独占写：`editor-shell/lib/library-store.ts`、`bench-store.ts`、`bench-data.ts`、`library-data.ts`（数据源改投影，纯函数保留）、`components/library/*`、`components/bench/*`（文案/术语/乱码修复 §4.2）、`components/painter/*`（connector 的 onSave 已对，换 meta-state 动作）、**library-sidebar 移除"素材收集进度/图鉴等级"块与 COLLECTION 数据（§8.1-1 裁决）**。
- 禁止：改 editor-store、canvas、map-types。
- 门禁：`npx vitest run`（devboard 范围）+ typecheck + lint。

### 批次间顺序与验收

- A 全部落地 → 门禁三绿（typecheck:devboard / vitest devboard / lint）→ B 启动。
- B 落地 → 四门禁：`npx tsc --noEmit`、`npx vitest run`（相关范围）、`npm run lint`、`npm run verify:docs`；再 `npm run devboard` 全流程手测。
- 最终交付物：接线完成代码 + 多余项目清单 + 缺失设计清单 + 术语映射表（本文 §四即成） + 占位素材清单 + 接线工作流 skill（见 §九）。

---

## 八、多余项目清单 / 缺失设计清单（v0 审计预置，接线后复核）

### 8.1 多余项目清单（v0 实现了、后端不需要或未定义的）

1. **图鉴等级 / 素材收集进度**（`COLLECTION`，素材库左栏底部 Lv.23/312-568）：spec 明确不做收藏室/收集册主界面。→ **已裁决移除（2026-08-19）**：B-2 删除 library-sidebar 对应块与 COLLECTION 数据。
2. **编辑器"性能预估"指标**（诊断条第 6 项，节点/边/复杂度）：spec 诊断无此项，play/map 校验无此项。→ **已裁决移除（2026-08-19）**：B-1 删除 diagnostics-bar 对应列。
3. **编辑器「地形框」导出**：play/map canonical 无地形表达。→ 编辑态保留、导出丢弃（见 §3.2）。
4. **编辑器遮挡框独立实体**：canonical 是边内嵌规格。→ 编辑体验保留、导出折叠（§3.2）。
5. **研究台 pod 的"绘制贴图"在失败态？**（v0 只在 done 态渲染，正确，无需处理）。
6. **编辑器顶栏 `Dream Scene Editor` 英文小字**：spec 无，属 v0 风格装饰。→ 保留或替换为 spec 小字（二选一，见术语表）。
7. **研究台/素材库 backdrops（bench/backdrop.png、library/backdrop.png）**：氛围底图，spec 未要求但符合"贴图场景"要求。→ 保留。

### 8.2 缺失设计清单（后端有、v0 没实现或待接线的）

1. **边 def（门户类型）选择 UI**：play/map `MapEdge.def` 必填（门户类型：走廊 1 AP/门锁 2 AP/跳窗 0 AP），v0 编辑器无入口。→ 接线期填占位 def，UI 入口列入迭代。
2. **真实 playtest 预览**：v0 的 P 模式只有 banner（"预览可通行域与连接"），无实际渲染。→ 接 `verify/playtest.ts` 的 playtestSmoke 是加分项，否则列入缺失。
3. **加载既有地图**：v0 编辑器只有 seedDoc 内置示例，无"已加载地图列表/打开地图"入口（左栏「已加载地图」命名给了蓝图区，实际没有列表）。→ 接 `workspace-state.ts` 或 loading 侧。
4. **meta-state 元状态层本体**（projection/actions 的真实实现）：spec 的端口目标，项目尚无。→ 批次 A-3 建最小实现，完整版属 `src/meta-state` 立项。
5. **合成成品独立 id**（`job.resultMaterialId`）：v0 自标技术债，占位用 baseMaterialId。→ meta-state 给出成品 id 后接线。
6. **提取白名单数据**（`EXTRACT_WHITELIST` 恒空 → 提取禁用「待白名单」）：后端/运营增量。→ 保留占位态。
7. **加急消耗数值**（rushJob 的"消耗记忆碎片"数值后端未定）。→ 保留占位提示。
8. **词条详情跳转**（技术债 1，`switchToBench(tokenId, {locate})`）：三界面路由注入后启用。
9. **素材真实贴图**：v0 用 8×8 图集（material-atlas.png 占位）→ sprite-forge 组件管线产出后替换（记入占位素材清单）。
10. **素材 id 统一**：编辑器 `装置-0-储物柜` 系 vs 素材库 `locker_7f3a` 系 → §5.1 决策统一为素材库 id 系（编辑器的 70 目录退化为 tile 查询）。

---

## 九、接线工作流 skill 凝练（交付物）

接线过程形成 `frontend-shell-wiring` skill，模板（接线后落到 `.agents/skills/`）：
1. **接收**：v0 代码导入专用目录（不叫 V0）；完整读 lib/ 数据层与 store（权威语义在注释里），components 用子代理穷举审计（props/store 读写/文案/占位标记逐文件报告）。
2. **适配判定**：技术栈差异清单（框架/版本/别名/静态资源/CSS 头）；数据模型两侧逐字段差异表（同构的直通、改名的 rename、结构差异的折叠/展开、无对应语义的进多余/缺失清单）。
3. **契约识别**：找代码注释里的端口标记（`projection.*`/`actions.*`/`待接线`/技术债），对照需求文档 §端口表——**v0 生成的代码注释就是接线契约**。
4. **接线分层**：壳原样保留（可审计蓝本）；接线层放壳外（适配器/契约桥/meta-state）；文案术语替换单列改动；"迁就前端"的冲突记入多余/缺失清单。
5. **执行纪律**：批次并行锁（独占可写文件列表写进每个 prompt）；壳内只许改 import/CSS 头/文案/数据源，禁改组件结构、类名、交互逻辑；门禁四件套收尾。

---

## 十、已裁决决策（2026-08-19 用户拍板，已全部落进上文对应章节）

| # | 问题 | 裁决 | 落点 |
|---|---|---|---|
| 1 | 目录组织 | **不变**：壳保持 `editor-shell/` 单目录，接线层放壳外 | §1.3 |
| 2 | 旧 EditorApp 退役 | **删除**（新壳唯一入口），可复用端口保留 | §六 |
| 3 | 素材 id 统一 | **是**：统一到素材库系 `locker_7f3a`，且 `materials.ts` 保留 `registerMaterials()` 批量注册入口（sprite-forge 批量补齐可复用） | §5.1 |
| 4 | 性能预估 / 图鉴等级 | **移除**（B-1 删诊断列、B-2 删侧栏块） | §8.1 |
| 5 | 唯一入口 | **只要新的**：全壳作为 devboard 唯一入口，不与旧编辑器并存 | §六 |

裁决后 spec 从"待执行"转为"可执行"：批次 A（4 并行）与批次 B（2 并行）的独占写/只读清单已含以上全部决策。

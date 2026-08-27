# WakeUp V0 前端接线准备清单

> **状态**：✅ v0 代码已导入 `src/devboard/editor-shell/`，完整接线 spec 已定稿 → **见 [v0-frontend-wiring-spec.md](./v0-frontend-wiring-spec.md)**（本文档为准备清单，spec 为其完整化的执行规格）  
> **目标**：接收三个 v0 前端壳层（地图编辑器/素材库/研究台），完成全面接线，形成可用的创作工作流  
> **纪律**：前端结构不改，逻辑全换；学习并模仿 v0 代码风格；占位数据替换为真实端口

---

## 一、三界面概览与接收目录

### 1.1 三界面定位

| 界面 | 用户入口 | 职责 | v0 文档 | 接收目录 |
|---|---|---|---|---|
| **地图编辑器**（造梦舱） | 出租屋 → 筑梦工作台 | 涂鸦式构建地图：拖框画场景、拉线连通道、标注遮挡/地形/过渡窗、放置素材 | `v0-dev-map-editor-spec.md` | `src/devboard/editor-shell/` |
| **素材库**（书架） | 出租屋 → 书架 | 检索优先的创作资源入口：分类筛选、搜索、星标、详情、蓝本进度、快捷栏配置 | `v0-dev-material-library-spec.md` | `src/devboard/library-shell/` |
| **研究台**（工作台） | 出租屋 → 研究台 | 素材级加工：词条库收集、锻造 5 槽、合成仪式、塑形备选栏 | `v0-dev-bench-spec.md` | `src/devboard/bench-shell/` |

### 1.2 全屏切换链（三界面共享状态）

```
编辑器 ──右栏快捷素材栏按钮──> 素材库 ──素材详情「去研究台锻造」──> 研究台 ──「回素材库」──> 素材库
   ↑                                                                                         │
   └────────────────────顶栏「回编辑器」─────────────────────────────────────────────────────┘
```

**共享数据**（三界面读同一份）：
- **素材快捷栏** `quickBar.materialSlots` 7 格（在素材库/研究台配置，编辑器立即生效）
- **元状态投影**：拥有库、词条库、蓝本、合成队列、塑形栏（只读，写走动作通道）

---

## 二、地图编辑器接线清单

### 2.1 组件树（v0 预期结构）

```
<EditorApp>（全屏根）
  ├─ <EditorTopBar>（顶栏）
  │    ├─ <WBadge>（青发光 W 方块 + 标题）
  │    ├─ <MapNameInput>（地图名 + id）
  │    └─ <EditorActions>（撤销/重做/＋/蓝本/校验导出）
  ├─ <LeftPanel>（左栏 280px）
  │    ├─ <LoadedMaps>（已加载地图列表）
  │    ├─ <LayersPanel>（图层 + 高度输入）
  │    └─ <ShortcutHints>（快捷键提示网格）
  ├─ <CanvasArea>（中央 SVG 画布）
  │    ├─ <ToolBar>（V/N/E/I/P 五工具横向）
  │    ├─ <SVGCanvas>（可平移缩放 viewBox）
  │    │    ├─ 场景框聚合（淡青虚线矩形 + 涂鸦式合并）
  │    │    ├─ 高光点（青色发光小圆点，拖拽 = 拉边）
  │    │    ├─ 连线（Catmull-Rom 样条 + 折点编辑）
  │    │    ├─ 遮挡框（视觉黄/物理红 + 旋转）
  │    │    ├─ 地形框（高地深绿/洼地浅绿）
  │    │    ├─ 过渡窗口（橙色菱形 ◆）
  │    │    ├─ 素材放置图标
  │    │    ├─ 描线预览（蓝虚线）
  │    │    ├─ 框选框（青虚线）
  │    │    └─ 图例（左下角）
  ├─ <RightPanel>（右栏 320px）
  │    ├─ <Inspector>（检查器，随选中元素变化）
  │    ├─ <QuickMaterialLibrary>（快捷素材库 7→70）
  │    └─ <PlaytestButton>（运行测试）
  └─ <DiagnosticBar>（底部诊断条 48px）
       ├─ <StatusSummary>（通过/N 处异常）
       └─ <DiagnosticList>（点击 → 镜头飞到元素 + 红闪）
```

### 2.2 核心图元说明（v0 上次漏掉的关键点）

| 图元 | 职责 | 视觉 | 交互 |
|---|---|---|---|
| **场景框** | 边界涂鸦，代表场景的物理范围 | 淡青虚线矩形，圆角，半透明填充，内显示名+尺度字母 | 选中整个场景（聚合）、移动、旋转、删除 |
| **高光点** | 场景的逻辑锚点（最大距离矩形中心），连线起点/终点 | 青色发光小圆点（半径 4-6px），带光晕 | **拖拽 = 进入拉边流程**（即使不在 E 模式） |
| **涂鸦式合并** | 同类型矩形重叠 → 自动合并为一个图形 | 边界消失，视为一个聚合场景 | 选中任一成员 = 选中整个聚合 |
| **空洞全填** | 场景框围成封闭区域 → 空洞被「油漆桶」填充 | 半透明青色填充 | 空洞区域视为场景一部分，不可再放置节点 |
| **粘连拒绝** | 一次拖拽同时碰到两个不同场景 → 拒绝 | 蓝框消失 + 提示「不能跨场景连接」 | 防止两场景被粘在一起 |

### 2.3 占位数据 → 真实端口映射

| 占位数据（v0 生成时用） | 真实端口 | 类型 | 方向 |
|---|---|---|---|
| `mockMapData` 硬编码地图 | `src/devboard/editor/workspace-state.ts` `loadMap` / `exportMap` | `MapData` | 读/写 |
| 图层列表 | `src/devboard/layers/layer-shapes.ts` + `layer-rules.ts` | `DevboardLayer[]` | 读/写 |
| 素材快捷栏（右栏） | `projection.quickBar()` | `QuickBar` | 只读（写走动作 `quickBarSet`） |
| 画布 SVG 渲染 | **保留现有** `src/devboard/app/CanvasView.tsx`（不用 v0 的 Canvas） | — | — |
| 编辑行为（放置/拉边/移动） | `src/devboard/app/editor-state.ts` `placeNode` / `drawEdge` / `translateObstruction` | 函数 | 调用 |
| 撤销/重做 | `src/devboard/app/editor-history.ts` `undo` / `redo` | 函数 | 调用 |
| 诊断校验 | `src/devboard/verify/playtest.ts` | 诊断结果 | 只读 |

### 2.4 术语映射（v0 可能用错的名词）

| v0 可能写的 | 项目权威术语 | 对应端口 |
|---|---|---|
| 节点 | 场景（Scene） | `MapNode` |
| 障碍物 | 遮挡框（Obstruction） | 视觉遮挡/物理遮挡 |
| 传送门 | 过渡窗口（Transition Window） | `edge.transitionWindow` |
| 连接 | 边/连线（Edge） | `MapEdge` |

---

## 三、素材库接线清单

### 3.1 组件树（v0 预期结构）

```
<MaterialLibraryApp>（全屏根）
  ├─ <LibraryTopBar>
  │    ├─ <WBadge>
  │    ├─ <LibrarySearch>（搜索框）
  │    └─ <SwitchToEditorButton>（回编辑器）
  ├─ <FilterSidebar>（左栏 260px）
  │    ├─ <ScopeFilter>（全部/我的素材）
  │    └─ <CategoryFilter>（装置/照明/陈设/交互/线索/遮挡）
  ├─ <LibraryTabs>（双 tab 切换）
  │    ├─ <ElementTab>（可放置元素，默认）
  │    └─ <BlueprintTab>（地图·蓝本，只读）
  ├─ <ElementGrid>（素材卡片网格）
  │    └─ <MaterialCard>（像素图标 + 名 + 类别 + 角标组）
  │         └─ <BadgeGroup>（限免绿/UGC 青/合成金银/已改动橙/星标黄）
  ├─ <BlueprintList>（蓝本列表行）
  │    └─ <BlueprintRow>（封面 + 名 + 场景数 + 熟悉度进度条 + 蓝本徽章）
  ├─ <DetailOverlay>（右栏详情浮层）
  │    ├─ <MaterialDetailHeader>（大图 + 品级描边）
  │    ├─ <TokenSlotRow>（词条挂载 5 槽，徽章可点击）
  │    ├─ <WeaknessLine>（弱点裂缝）
  │    ├─ <LimitedFreeNote>（限免说明）
  │    ├─ <StarButton>
  │    └─ <SwitchToBenchButton>（去研究台锻造）
  └─ <QuickBarStrip>（底部快捷栏 96px）
       ├─ <QuickBarSlots>（7 格折叠）
       └─ <ExpandedMatrix>（7×10 + 筛选/搜索）
```

### 3.2 占位数据 → 真实端口映射

| 占位数据 | 真实端口 | 类型 | 方向 |
|---|---|---|---|
| `mockMaterials` | `projection.allVisible()` / `projection.ownedMaterials()` | `MaterialMeta[]` | 只读 |
| `mockMaterialDetail` | `projection.materialDetail(id)` | `MaterialMeta \| null` | 只读 |
| 词条挂载 | `projection.equippedTokensOf(id)` | `(TokenMeta \| null)[]` | 只读 |
| 卡片角标 | `projection.badgeStateOf(id)` | `MaterialBadgeState` | 只读（纯函数派生） |
| `mockBlueprints` | `projection.blueprintList()` | `BlueprintMeta[]` | 只读 |
| 素材快捷栏（底部共享） | `projection.quickBar()` | `QuickBar` | 只读（写走 `quickBarSet`） |
| 星标切换 | `actions.toggleStar(id)` | 动作通道 | 写 |
| 快捷栏配置 | `actions.quickBarSet(index, id)` | 动作通道 | 写（拒绝限免） |
| 去研究台 | 三界面切换 `switchToBench(materialId, opts?)` | 注入回调 | 动作 |
| 回编辑器 | 三界面切换 `switchToEditor()` | 注入回调 | 动作 |

### 3.3 关键交互规则

- **限免素材**（绿角标）：可见、可摆图，**但不可拖入快捷栏**（落点红闪）
- **UGC 素材**（青角标）：在快捷栏中**灰显、不可拖**，悬停提示「UGC 素材请到研究台处理」
- **星标置顶**：同筛选栏内排首，不是全局置顶
- **词条徽章可点击** → 切研究台并定位到该词条（查看来源/品质/可贴宿主）

---

## 四、研究台接线清单

### 4.1 组件树（v0 预期结构）

```
<BenchApp>（全屏根）
  ├─ <BenchTopBar>
  │    ├─ <WBadge>
  │    ├─ <SectionTabs>（词条库/锻造台 分区切换）
  │    └─ <SwitchToLibraryButton>（回素材库）
  ├─ <TokenLibraryPanel>（左栏词条库 320px）
  │    ├─ <CategoryTabs>（属性/技能/状态/防御/机动 五类标签）
  │    ├─ <CollectProgress>（5/22 已收集）
  │    └─ <TokenCardGrid>
  │         └─ <TokenCard>（已收集亮起 + 品质描边；未收集剪影 + 「?」；星标；拖拽源）
  ├─ <ForgeBench>（中央锻造台）
  │    ├─ <BaseMaterialView>（基体大图标 + 名）
  │    ├─ <ForgeSlotRow>
  │    │    └─ <ForgeSlot>（5 槽：属性/技能/状态/防御/机动；底图印字/空槽「+」；拖入替换/拖回恢复默认）
  │    ├─ <ComboPreview>（右侧组合预览：词条语义清单）
  │    ├─ <ExtractButton>（提取）
  │    ├─ <ForgeResultActions>（保存/派生）
  │    └─ <SynthesizeButton>（合成，青主按钮）
  ├─ <MaterialQuickBar>（右栏 300px，与素材库/编辑器共享）
  │    ├─ <QuickBarSlots>（7 格折叠）
  │    └─ <ExpandedMatrix>（7×10 + 筛选）
  ├─ <MoldingStrip>（底部塑形备选栏 88px）
  │    └─ <MoldingSlot>（5 格：解锁亮/锁定灰+🔒；拖入替换）
  ├─ <ExtractRitual>（提取演出覆盖层：素材溶解 → 词条浮现）
  ├─ <SynthesisQueueBar>（合成队列条：1 进行中 + N 排队 + 加急）
  └─ <SynthesisRitual>（全屏合成仪式覆盖层）
       ├─ <ForgeGate>（发光锻造门/闸口）
       ├─ <ThreeStations>（左熔炼/中主锻造/右铭刻）
       ├─ <ResultRevealPanel>（高光爆发 + 成品浮现 + 收下）
       └─ <FailurePanel>（成品变灰 + 解释 + 确定）
```

### 4.2 占位数据 → 真实端口映射

| 占位数据 | 真实端口 | 类型 | 方向 |
|---|---|---|---|
| `mockTokensByCategory` | `projection.tokens()` + 五大类分组 | `TokenMeta[]` | 只读 |
| 锻造槽位 | `projection.materialDetail(baseId)` + `equippedTokensOf(baseId)` | `MaterialMeta \| null` | 只读 |
| 素材快捷栏（右栏共享） | `projection.quickBar()` | `QuickBar` | 只读（写走 `quickBarSet`） |
| `mockSynthesisQueue` | `projection.synthesisQueue()` | `SynthesisJob[]` | 只读（提交走动作） |
| `mockMoldingBar` | `projection.moldingBar()` | `MoldingBar` | 只读（写走动作） |
| 提取 | `actions.extractToken(materialId, focusAttr)` | 动作通道 | 写 |
| 合成投料/收下/加急 | `actions.synthesizeSubmit / synthesizeClaim / synthesizeRush` | 动作通道 | 写 |
| 锻造保存/派生 | `actions.forgeModify(materialId, slots[], {mode:'save'\|'derive'})` | 动作通道 | 写 |
| 塑形栏配置 | `actions.moldingSet(slotIndex, materialId)` | 动作通道 | 写 |
| 词条星标 | `actions.toggleStar(tokenId)` | 动作通道 | 写 |
| 回素材库 | 三界面切换 `switchToLibrary()` | 注入回调 | 动作 |

### 4.3 关键交互规则

- **底图感**：锻造槽位可能预先印有默认词条（素材自带），拖新词条 = 盖上去（替换）
- **只替换、不删除**：拖新词条 = 替换；把词条**拖回词条库/快捷栏** = 默认值自动恢复
- **合成结果由动作通道返回**，前端**不得**本地随机生成
- **研究台没有词条快捷栏**（2026-08-19 定案）：词条从左侧词条库直接拖入锻造槽位
- **组合预览无火力/射程强度条**（2026-08-19 定案）：用词条语义清单展示机制，不模仿普通改枪数值栏

---

## 五、接线执行步骤（固化工作流）

### 5.1 接收与理解阶段

1. **完整导入 v0 产物**  
   - 地图编辑器 → `src/devboard/editor-shell/`  
   - 素材库 → `src/devboard/library-shell/`  
   - 研究台 → `src/devboard/bench-shell/`  
   - 保持 v0 原始目录结构和组件树，不做任何预判性修改

2. **建立组件清单与映射表**  
   - 列出所有 v0 组件及其职责（对照上方组件树）
   - 标注哪些组件对应哪些真实功能
   - 识别 v0 组件树中的状态源（`useState` / Zustand / props drilling）

3. **视觉与交互审计**  
   - 确认 v0 壳子是否按参考图完成了必需布局
   - 确认动效是否用了 Framer Motion、UI 原语是否用了 Radix、图标是否用了 lucide-react
   - 确认色彩是否走 tokens、是否符合「像素风+简笔画+克制暗调」质感

### 5.2 接线执行阶段（铁律）

1. **前端结构不改，逻辑全换**  
   - 组件名、层级、props 接口、样式类名：**原样保留**
   - 硬编码数据、假状态、占位回调：**全部替换成真实端口和逻辑**

2. **学习并模仿 v0 的代码风格**  
   - 如果 v0 用 `className="flex items-center gap-2"` 写布局，后续新增也这样写
   - 如果 v0 用 `motion.div` 做动效，后续新增也用 Framer Motion
   - 如果 v0 用 `lucide-react` 的 `MapPin` 图标，后续新增也从 lucide 选

3. **文字与术语纠正**  
   - 识别 UI 文字对应的真实概念，替换成项目权威术语（参考上方术语映射表）
   - 记录所有术语替换，形成映射表

4. **真实端口接线**（按上方映射表逐一替换）  
   - 地图数据、图层、素材可用性、画布渲染、编辑行为、撤销/重做、诊断校验
   - 素材库数据、角标、星标、快捷栏、全屏切换
   - 研究台词条库、锻造槽位、合成队列、塑形栏、提取/合成/锻造动作

5. **占位素材替换**  
   - v0 可能用假图标、假地图、假贴纸占位
   - 真实素材来源：lucide-react 图标、sprite-forge 组件管线产出的实际贴图
   - 如果真实素材暂时没有，保留 v0 占位，但在清单里标注「待替换」

6. **状态管理迁移**  
   - 如果 v0 用 `useState` 管理编辑器状态，迁移到现有 `editor-state.ts` 或新建 Zustand store
   - 表现层 UI 状态（面板开合、通知队列）可以保留 v0 的 Zustand store

### 5.3 验证与收尾阶段

1. **门禁验证**  
   - `npx tsc --noEmit` 0 error
   - `npx vitest run src/devboard` 全绿
   - `npm run lint` 0 error
   - `npm run verify:docs` 通过

2. **功能自测**  
   - 打开 `npm run devboard`，确认：  
     - 三栏布局正常显示  
     - 工具栏可切换工具  
     - 画布可放置场景、拉边、拖拽、取样  
     - 检查器显示真实 MapData 字段  
     - 素材矩阵显示真实已注册素材  
     - 诊断条显示真实校验结果  
     - 撤销/重做可用  
     - 导出 MapData 可解析

3. **形成清单**  
   - **多余项目清单**：v0 实现了但后端不需要的 UI 元素
   - **缺失设计清单**：后端有但 v0 没实现的功能
   - **术语映射表**：`v0文字 → 项目术语 → 对应端口/文件`
   - **占位素材清单**：哪些图标/贴图/精灵还在用假数据

---

## 六、风险与已知冲突

### 6.1 地图编辑器风险

- **风险 1**：v0 可能用 Canvas 代替 SVG 渲染地图  
  - **处置**：保留现有 `CanvasView.tsx` 的 SVG 渲染，v0 的画布组件只负责布局和交互，不改图元渲染方式

- **风险 2**：v0 可能用贝塞尔曲线代替 Catmull-Rom 样条  
  - **处置**：必须用 Catmull-Rom（穿过所有必经点），v0 若用贝塞尔则替换为现有样条函数

- **风险 3**：v0 可能漏掉「高光点」（场景框 vs 高光点区分）  
  - **处置**：明确补充：高光点 = 场景的逻辑锚点（外接矩形中心），拖拽高光点 = 进入拉边流程

- **风险 4**：v0 可能发明「清空槽位」「4 角控制点拖拽」等不符合涂鸦式交互的操作  
  - **处置**：明确不做（§文档「明确不做」），只保留涂鸦式阴影选中 + 整体移动/旋转/删除

### 6.2 素材库风险

- **风险 1**：v0 可能把快捷栏展开态做成素材库本地状态  
  - **处置**：展开态从投影读（`quickBar.materialExpanded`），本地不重复持有

- **风险 2**：v0 可能把「限免」当成可购买/可拥有展示  
  - **处置**：限免 = 摆图可用、不进拥有库，「我的素材」分栏只列 `owned:true`

- **风险 3**：v0 可能发明高级检索（多条件/语义搜索）  
  - **处置**：只有类别 + 关键字两个检索维度

### 6.3 研究台风险

- **风险 1**：v0 可能把合成结果做成前端随机/动画假结果  
  - **处置**：合成结果由动作通道返回（LLM 裁决），前端只做演出与展示

- **风险 2**：v0 可能发明「清空槽位」按钮（违背底图感）  
  - **处置**：只替换、不删除；拖回词条库/快捷栏 = 默认值恢复

- **风险 3**：v0 可能按旧认知加「词条快捷栏」或改枪式强度数值栏  
  - **处置**：明确不做（2026-08-19 定案）：研究台没有词条快捷栏，没有火力/射程强度条

- **风险 4**：v0 可能加入玩家文本输入（描述想要什么）  
  - **处置**：合成台 LLM 零输入，本界面没有任何给玩家描述需求的文本框

---

## 七、接线完成标准

### 7.1 视觉一致性

- [x] 色彩符合 tokens 语义（青唯一高饱和、橙=进行中/消耗、金银=品级高光、红=失败解释边界）
- [x] 图标全部来自 lucide-react；动效全部用 Framer Motion
- [x] 无手写 CSS transition（除 hover 微状态）

### 7.2 功能完整性

- [x] 地图编辑器：五模式切换、涂鸦式交互、Catmull-Rom 样条、高光点拖拽拉边、实时校验、撤销/重做
- [x] 素材库：双 tab、星标置顶、分类筛选、搜索、详情浮层（词条 5 槽可点击）、蓝本进度、快捷栏 7→70
- [x] 研究台：词条库五类、锻造 5 槽底图感、组合预览、提取演出、保存/派生、合成仪式全流程、队列+加急、塑形栏 5 格
- [x] 占位数据已替换为真实投影端口（§映射表全覆盖）
- [x] 写入全部走动作通道，界面无直接写状态
- [x] 限免拖入被拒绝（交互红闪 + 数据层双保险）

### 7.3 门禁通过

- [x] `npx tsc --noEmit` 0 error
- [x] `npm run lint` 0 error
- [x] `npx vitest run src/devboard` 全绿
- [x] 可启动并打开

---

## 八、接线后交付物

1. **接线完成的代码**（三个目录）
2. **多余项目清单**（v0 实现了但后端不需要的 UI 元素）
3. **缺失设计清单**（后端有但 v0 没实现的功能）
4. **术语映射表**（v0 文字 → 项目术语 → 对应端口/文件）
5. **占位素材清单**（哪些图标/贴图/精灵还在用假数据）

---

**状态**：准备就绪，等待 v0 代码导入 `src/devboard/editor-shell/` / `library-shell/` / `bench-shell/`。

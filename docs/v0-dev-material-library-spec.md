# WakeUp 素材库 · v0.dev 完整需求文档

> **目标**：为 v0.dev 提供完整的功能需求、交互逻辑、布局设计、视觉规范，生成素材库（书架）前端壳层。
> **技术栈**：React 18 + TypeScript + Tailwind CSS，桌面端 1920×1080 优先。可根据审美和质感任意发挥，不要有限制。
> **本文档只描述需求**，不提供实现代码，让 v0.dev 发挥其组件和特效能力。成熟实现（按钮变灰、悬停发光、脉冲等）不再解释，只写「什么状态显示什么」。
> **接线前置**：本界面是「检索优先的创作资源入口」，所有素材/词条/蓝本数据来自共享元状态层（`src/meta-state/`）的**只读投影**；界面本地状态只负责筛选/搜索/tab/详情开关/拖拽进行中。写操作只有两个：星标、快捷栏配置。
> **参考图路径**：`run/ui-mockup/material-library/`（由 `docs/表现系统/PLT-03_素材库UI样图_提示词.md` 出图后放入；出图前以本文档布局架构为唯一基准）。

---

## 一、项目定位

### 什么是这个素材库

这是一个**内嵌在独立游戏里的梦境素材库**，玩家从出租屋驻地的「书架」进入。它存的是「我在别人梦里记住、学会、掌握的素材和蓝本」，是创作资源的总览：

- 浏览可放置元素（积木：储物柜/感应灯/长椅…）
- 星标置顶常用素材
- 按运行时逻辑分类检索（AI 单位/NPC/载具/容器/物品/机关装置/装饰/过渡场景）；装置/照明/陈设/交互/线索/遮挡仅作为标签
- 查看素材详情（挂载词条、品级、弱点）
- 查看每张地图的熟悉度进度（满 100% 解锁蓝本）
- 与地图编辑器、研究台**全屏切换**（各自状态保留）

**最终角色**：创作工作流的「取件口」——找到素材 → 拿去研究台锻造，或回编辑器摆图。

### 不是什么

- ❌ 不是网页应用、SaaS 后台、浏览器工具、电商商品墙
- ❌ 不是素材编辑工具（不内置锻造/合成/LLM）
- ❌ 不是仓库（不承载拥有量管理主界面）
- ❌ 不是收藏室（保险箱是纪念陈列，本界面是创作资源检索）

### 核心设计理念

1. **检索优先**：找东西最快是第一要务。星标置顶（同筛选栏内排首）、类别筛选、关键字搜索、悬停浮详情——信息密度从浅到深逐级展开（快捷栏最浅 → 详情页最深）。
2. **双 tab 语义分开**：「可放置元素」= 积木，「地图/蓝本」= 整套房子。两者物理分栏，不混装。
3. **看到 ≠ 拥有**：详情页展示素材挂着的词条，但词条的拥有在研究台；限免素材（绿角标）可以看、可以摆图，但不进入拥有库。
4. **全屏切换、状态保留**：切去编辑器/研究台时，筛选/搜索/浏览位置完整保留，切回原样恢复。

### 参考风格

- 像素 + 全息投影的独立游戏 UI 质感（前景高饱和像素组件 + 背景半透明暖光全息投影光层，微微泛光、轻微闪烁），暖灯出租屋氛围。
- 明确**不参考**：现代 SaaS / 网页后台 / 电商商品墙 / 暗黑科技终端。
- 用画风与布局传达「书架」感，不是「App」。

---

## 二、视觉风格与色彩规范

### 2.1 画风基线

**像素 + 全息投影叠加**（对齐地图编辑器全息游戏风，但色调偏暖。）：
- 交互组件/素材卡片/图标 = 高饱和像素艺术（32×32 或 64×64）
- 背景 = 梦境意象以全息投影方式浮现——书架木纹、月光、灰尘微粒做成半透明暖琥珀光层，微微泛光、轻微闪烁，不是手绘简笔画
- UI 面板 = 半透明深色浮层，让底下的书架氛围透出来一点

**平面 2D**：
- UI 平面布局，无 3D 透视、无 isometric
- 素材图标沿用正面俯视视图的剪影语言（平面轮廓 + 落地阴影）

**克制暗调略冷 + 暖灯**：
- 主功能色 ≤3-4（青/绿/黄/橙点缀），其余灰阶承载
- 整体暗色调，暖木色书架感
- 不是黑色科技终端（不要霓虹扫描线、金属栅格）

### 2.2 颜色语义（必须遵守）

| 颜色 | 色值 | 用途 |
|---|---|---|
| **青 social** | `#06b6d4` | 唯一高饱和主操作：W 徽标、回编辑器/去研究台按钮、当前筛选左条、蓝本徽章、UGC 角标 |
| **绿 safe** | `#38a169` | 限免角标、限免说明文字 |
| **金/银** | `#d4af37` / `#a8b2bd` | 合成物品级高光、品质 4-5 描边 |
| **橙 action** | `#dd6b20` | 已改动角标（小点） |
| **黄 alert** | `#d69e2e` | 星标（填色发光） |
| **红 damage** | `#e53e3e` | 弱点裂缝小字、拖拽拒绝红闪 |
| **灰白** | `#f3f4f6` | 可交互但受制于状态（UGC 灰显、空槽「无」） |
| **墨 ink** | `#0d1824` | 最深背景 |
| **灰 muted** | `#627383` | 次要文字（类别小字、场景数） |
| **暗边** | `#2a3a44` | 分隔线 |

**角标语义**（素材卡片右上角）：
- 限免（绿）/ UGC（青）/ 合成（金银高光）/ 已改动（橙小点）/ 星标（黄填色）
- 一个素材可同时有多个角标，主色取最显眼那个，其余做小徽章

**边缘发光规则**：
- 可交互 = 边缘发光（悬停白/青，激活青）
- 不可交互 = 扁平灰色、无高光
- 拖拽拒绝 = 落点红闪

---

## 三、布局架构（1920×1080）

```
┌──────────────────────────────────────────────────────────────┐
│ 顶栏（书架顶，高度 64px）                                       │
│ [W徽标+标题] [搜索框] [回编辑器]                                │
├──────────┬──────────────────────────────────────┬─────────────┤
│ 左栏     │ 中央主视图（素材卡片网格 / 蓝本列表）    │ 右栏        │
│ 260px    │  tab：〔可放置元素〕〔地图·蓝本〕        │ 360px       │
│          │                                        │             │
│ 分类筛选  │  ┌────┐┌────┐┌────┐┌────┐┌────┐      │ 详情浮层    │
│ 全部     │  └────┘└────┘└────┘└────┘└────┘      │（点击卡片出）│
│ 我的素材 │  ┌────┐┌────┐┌────┐┌────┐┌────┐      │             │
│ 装置     │  └────┘└────┘└────┘└────┘└────┘      │  大图       │
│ 照明     │                                        │  品级       │
│ 陈设     │  （蓝本 tab：列表行 = 封面+名+场景数    │  词条5槽    │
│ 交互     │   +熟悉度进度条，满→亮起+蓝本徽章）     │  弱点       │
│ 线索/遮挡│                                        │  限免说明   │
│          │                                        │  星标/去研究台│
├──────────┴──────────────────────────────────────┴─────────────┤
│ 底部「快捷素材栏」（高度 96px，与编辑器/研究台共享同一份数据）      │
│ 未展开：7 格（最近/高频素材）   展开：7×10 全库矩阵 + 筛选/搜索    │
└──────────────────────────────────────────────────────────────┘
```

**三界面切换链位置标注**（本界面是创作心智三段之一）：
```
地图编辑器（造梦舱）──右栏快捷素材栏上方小按钮──> 素材库（本界面）──素材详情「去研究台锻造」小按钮──> 研究台
```
本界面顶栏「回编辑器」与详情页「去研究���锻造」就是这条链上的两个口，位置必须显眼、常驻。

---

## 四、逐区功能需求

### 4.1 顶栏（书架顶）

**左段**：40×40 青色方块徽标，内白色字母 W，边缘发光；两行标题（粗「WakeUp 梦境素材库」+ 小字暗「书架 · 创作资源」）。

**中段**：搜索框（暗底无边框，放大镜图标 + placeholder「搜索素材…」）。输入实时过滤中央网格（匹配名称/类别）。

**右段**：**回编辑器**小按钮（青色描边，点击全屏切回地图编辑器）。与编辑器右栏快捷素材栏上方按钮双向对偶。

### 4.2 左栏（分类筛选）

- 顶部两个**分栏语义**选项：`全部`（含限免素材，绿角标可见）/ `我的素材`（只列拥有库 `owned:true`）。
- 下方**类别筛选**：`装置` / `照明` / `陈设` / `交互` / `线索` / `遮挡`（单选或复选，与中央网格联动）。
- 当前选中项 = 青左条 + 淡青晕；星标素材在同筛选栏内排首。
- 筛选与搜索共用同一套筛选语义（与编辑器展开全库一致，数据共享）。

### 4.3 中央主视图

**tab 切换**（顶部，两个 tab 语义完全不同）：

**Tab 1 · 可放置元素（默认）**：
- 素材卡片网格（响应式列数，1920 下约 5-6 列）。
- 每张卡片：像素图标（正面俯视剪影）+ 名称 + 类别小字 + 右上角角标（限免绿/UGC 青/合成金银/已改动橙点/星标黄）。
- 星标卡片排首行，视觉更亮。
- **悬停**：卡片边缘发光（青或类别色），浮出小气泡（名称/类别/角标详情）。
- **点击**：右侧详情浮层打开。
- 空状态：无匹配时显示一句书架味的空提示（如「书架上还没有这个分类的素材」）。

**Tab 2 · 地图/蓝本（只读）**：
- 列表行，每行：地图封面缩略图 + 地图名 + 「N 场景」小字 + 右侧**熟悉度进度条（0-100%）**。
- 未满 100%：封面灰暗剪影 + 进度条 + 「还差 X%」小字。
- 满 100%：封面亮起 + 微光 + 「可在编辑器选作蓝本」徽章（青）。
- 点击已解锁行 → **蓝本详情**（该梦的完整蓝图预览，只读，可查看构成；未解锁行点击 → 提示「熟悉度满 100% 解锁」）。
- **本 tab 不提供编辑/删除/管理**（只读总览）；「以蓝本为底」的再创作入口在地图编辑器。

### 4.4 右栏（详情浮层）

点击卡片后浮现（可作覆盖浮层或右侧固定栏，V0 择审美更优者）：

- **大图**：像素图标放大展示，外描边用**品级色**（灰白 1 / 绿 2 / 蓝 3 / 银 4 / 金 5）。
- 名称 + 类别 + 品级。
- **词条挂载展示**：5 个槽位（属性/技能/状态/防御/机动），有词条 = 词条徽章（品质色描边），空槽 = 灰「无」。底部一行小字说明「看到 ≠ 拥有，词条的收集在研究台」。
- **词条徽章可点击** → 切到研究台词条库并定位到该词条（查看来源/品质/可贴宿主）。
- **弱点裂缝**（合成物显示）：一行小字（如「弱点：易蚀」），暗红。
- **限免说明**（限免素材显示）：绿色小字「摆图可用，不进入你的拥有库」。
- **绘制贴图**（仅合成物显示；2026-08-19 D-085）：品级色描边的小按钮「绘制贴图」——点击调出**像素绘制器悬浮窗**（`docs/v0-dev-pixel-painter-spec.md`），在该合成物的底图上追加绘制（底图无效则空画布）。非合成物**不显示**此按钮。
- 底部两个按钮：**星标**（黄色星形图标，激活 = 填色发光，点击切换）+ **去研究台锻造**（青色主按钮，小尺寸强发光，点击全屏切到研究台并自动装载该素材）。

### 4.5 底部「快捷素材栏」

- **数据**：与地图编辑器、研究台**共享同一份**（`quickBar.materialSlots` 7 格 + 展开态）。
- **未展开**：7 个方形容器横向一排，只有图标，悬停浮出名称/类别/角标。
- **展开**：7×10 全库矩阵（图标网格，实际可滚动），顶部浮出**类别筛选 + 搜索框**（与素材库共用同一套筛选语义）。
- **配置方式**：在素材库/研究台把需要的素材拖入 7 格替换（`quickBar.materialSlots[i] = materialId`）。
- **保护规则**（数据层已拒绝，交互层红闪提示）：
  - 限免素材（绿角标）**不可拖入快捷栏**——落点红闪。
  - UGC 素材（青角标）在快捷栏中**灰显、不可拖**，悬停提示「UGC 素材请到研究台处理」。

---

## 五、组件层级与状态管理

### 5.1 组件树（预期结构，命名规范见 5.3）

```
<MaterialLibraryApp>（全屏根容器；挂载三界面切换回调）
  ├─ <LibraryTopBar>
  │    ├─ <WBadge>（青发光方块徽标 W + 两行标题）
  │    ├─ <LibrarySearch>（搜索框）
  │    └─ <SwitchToEditorButton>（回编辑器）
  ├─ <FilterSidebar>
  │    ├─ <ScopeFilter>（全部 / 我的素材）
  │    └─ <CategoryFilter>（装置/照明/陈设/交互/线索/遮挡）
  ├─ <LibraryTabs>
  │    ├─ <ElementTab>（可放置元素）
  │    └─ <BlueprintTab>（地图·蓝本，只读）
  ├─ <ElementGrid>（Tab1 主视图）
  │    └─ <MaterialCard>（图标 + 名 + 类别 + 角标组；悬停气泡）
  │         └─ <BadgeGroup>（限免/UGC/合成/已改动/星标 角标）
  ├─ <BlueprintList>（Tab2 主视图）
  │    └─ <BlueprintRow>（封面 + 名 + 场景数 + 熟悉度进度条 + 蓝本徽章）
  ├─ <DetailOverlay>（右栏详情）
  │    ├─ <MaterialDetailHeader>（大图 + 品级描边 + 名称/类别/品级）
  │    ├─ <TokenSlotRow>（词条挂载 5 槽，徽章可点击）
  │    ├─ <WeaknessLine>（弱点裂缝）
  │    ├─ <LimitedFreeNote>（限免说明）
  │    ├─ <PaintTextureButton>（绘制贴图 · 仅合成物）
  │    ├─ <StarButton>
  │    └─ <SwitchToBenchButton>（去研究台锻造）
  └─ <QuickBarStrip>（底部）
       ├─ <QuickBarSlots>（7 格，折叠态）
       └─ <ExpandedMatrix>（7×10 全库 + 筛选/搜索，展开态）
```

### 5.2 状态管理方式

- **Zustand store（界面本地）**：`activeTab`、`scopeFilter`、`category`、`query`、`detailOpenId`、`hoveredId`、`drag`（拖拽进行中）、`starPending`（星标乐观 pending）。
- **数据一律从只读投影读**（`src/meta-state/` selector），界面不缓存、不推断拥有量/角标/可用性。
- **快捷栏展开态**直接读投影（`quickBar.materialExpanded`），本地不重复持有。

### 5.3 命名规范（加粗标记 = 组件名，接线时按此提取）

- **MaterialLibraryApp** → `MaterialLibraryApp.tsx`（根容器）
- **LibraryTopBar** / **WBadge** / **LibrarySearch** / **SwitchToEditorButton**
- **FilterSidebar** / **ScopeFilter** / **CategoryFilter**
- **LibraryTabs** / **ElementTab** / **BlueprintTab**
- **ElementGrid** / **MaterialCard** / **BadgeGroup**
- **BlueprintList** / **BlueprintRow**
- **DetailOverlay** / **MaterialDetailHeader** / **TokenSlotRow** / **WeaknessLine** / **LimitedFreeNote** / **PaintTextureButton** / **StarButton** / **SwitchToBenchButton**
- **QuickBarStrip** / **QuickBarSlots** / **ExpandedMatrix**

---

## 六、核心交互逻辑

### 6.1 交互伪代码

```typescript
// 点击卡片 → 详情
function onCardClick(id) {
  detailOpenId = id;                 // 本地状态
  // 详情数据从投影读：detail = projection.materialDetail(id)
}

// 点击「绘制贴图」（仅合成物）→ 调出像素绘制器悬浮窗
function onPaintTexture(id) {
  painter = { open: true, targetId: id };            // 本地状态
  // initialTexture = projection.materialTexture(id) ?? null（数据层判定）
  // 保存走 actions.materialSetTexture(id, texture)；见 docs/v0-dev-pixel-painter-spec.md
}

// 星标切换（乐观更新，等待动作确认）
function onStarToggle(id) {
  starPending.add(id);               // 本地 pending
  actions.toggleStar(id);            // 动作通道，元状态层权威
  // 投影刷新后 pending 移除；失败则回滚显示
}

// 拖拽素材到快捷栏（配置 7 格）
function onDragToQuickBar(index, materialId) {
  if (material.limitedFree) { showRedFlash(); return; }   // 落点红闪（数据层已拒绝）
  if (material.isUgcNew) { showToast('UGC 素材请到研究台处理'); return; }  // UGC 灰显源不可拖
  actions.quickBarSet(index, materialId);
}

// 点击词条徽章 → 切研究台定位
function onTokenBadgeClick(tokenId) {
  switchToBench(tokenId, { locate: 'token-library' });   // 切到研究台词条库并定位
}

// 去研究台锻造
function onGoToBench(materialId) {
  switchToBench(materialId);         // 全屏切换 + 自动装载（注入回调）
}

// 回编辑器
function onGoToEditor() {
  switchToEditor();                  // 全屏切换，素材库本地状态保留
}

// 过滤逻辑（纯函数，本地派生）
function filteredMaterials(all: MaterialMeta[], local) {
  const scope = local.scopeFilter === 'owned'
    ? all.filter(m => m.owned) : all;                       // 全部含限免
  const byCat = local.category === '全部' ? scope
    : scope.filter(m => m.category === local.category);
  const byQuery = local.query ? byCat.filter(m =>
    m.name.includes(local.query) || m.category.includes(local.query)) : byCat;
  return starredFirst(byQuery);      // 星标置顶（同筛选栏内排首）
}
```

### 6.2 键盘/无障碍

- [x] Tab 键按视觉顺序遍历全部交互元素（左栏筛选 → 中央网格 → 右栏详情 → 底部快捷栏 → 顶栏）
- [x] Enter/Space 激活按钮与卡片；Esc 关闭详情浮层
- [x] `/` 聚焦搜索框；Esc 在搜索框中清空并失焦
- [x] 方向键在素材卡片网格内移动焦点（左/右/上/下）；Enter 打开详情
- [x] Tab 键在「可放置元素 / 地图·蓝本」两 tab 间切换（方向键）
- [x] 屏幕阅读器可读（Radix 基础：tooltip、dialog 语义标签）
- [x] 拖拽提供键盘等价：聚焦卡片后按菜单键/Shift+方向 → 「加入快捷栏」动作
- [x] 全屏切换动画不劫持焦点；关闭后焦点回到触发对象

---

## 七、数据结构（接线清单）

### 7.1 硬编码占位数据（V0 生成时用）

```typescript
// 占位：素材列表
const mockMaterials = [
  { id: 'locker_7f3a', name: '储物柜', category: '装置', quality: 3, owned: true,
    source: 'standard', starred: true, modified: false, isUgcNew: false,
    limitedFree: false, weakness: null, equippedTokens: [null, 'token_fast_draw', null, null, null] },
  { id: 'sensor_light_02', name: '感应灯', category: '照明', quality: 2, owned: false,
    source: 'standard', starred: false, modified: false, isUgcNew: false,
    limitedFree: true, weakness: null, equippedTokens: [null, null, null, null, null] },
  { id: 'bench_a1', name: '长椅', category: '陈设', quality: 1, owned: true,
    source: 'standard', starred: false, modified: false, isUgcNew: false,
    limitedFree: false, weakness: null, equippedTokens: [null, null, null, null, null] },
];

// 占位：蓝本列表
const mockBlueprints = [
  { mapId: 'night_platform', name: '夜班月台', sceneCount: 4, familiarity: 100, unlocked: true },
  { mapId: 'sleeper_car', name: '卧铺车厢', sceneCount: 3, familiarity: 62, unlocked: false },
];

// 占位：素材详情词条挂载
const mockTokensOnMaterial = [
  { id: 'token_flame', category: '属性', name: '烈焰', quality: 4 },
  { id: null }, { id: null }, { id: null }, { id: null },
];

// 占位：快捷栏
const mockQuickBar = { materialSlots: ['locker_7f3a', 'sensor_light_02', null, null, null, null, null], materialExpanded: false };
```

### 7.2 真实端口映射（接线时替换）

| 占位数据 | 真实端口 | 类型 | 方向 |
|---|---|---|---|
| `mockMaterials` | `projection.allVisible()` / `projection.ownedMaterials()` | `MaterialMeta[]` | 只读 |
| `mockMaterialDetail` | `projection.materialDetail(id)` | `MaterialMeta \| null` | 只读 |
| `mockTokensOnMaterial` | `projection.equippedTokensOf(id)` | `(TokenMeta \| null)[]` | 只读 |
| 卡片角标 | `projection.badgeStateOf(id)` | `MaterialBadgeState` | 只读（纯函数派生） |
| `mockBlueprints` | `projection.blueprintList()` | `BlueprintMeta[]` | 只读 |
| `mockQuickBar` | `projection.quickBar()` | `QuickBar` | 只读（写走动作） |
| 绘制贴图底图 | `projection.materialTexture(id)` | `TextureData \| null` | 只读 |
| 绘制贴图保存 | `actions.materialSetTexture(materialId, texture)` | 动作通道 | 写（非合成物拒绝） |
| 星标切换 | `actions.toggleStar(id)` | 动作通道 | 写 |
| 快捷栏配置 | `actions.quickBarSet(index, id)` | 动作通道 | 写（拒绝限免） |
| 去研究台 | 三界面切换路由 `switchToBench(materialId, opts?)` | 注入回调 | 动作 |
| 回编辑器 | 三界面切换路由 `switchToEditor()` | 注入回调 | 动作 |

---

## 八、验收标准（接线后检查）

### 8.1 视觉一致性

- [x] 色彩符合 tokens 语义（青唯一高饱和、绿=限免、黄=星标、金银=品级高光）
- [x] 图标全部来自 lucide-react；动效全部用 Framer Motion
- [x] 无手写 CSS transition（除 hover 微状态）

### 8.2 功能完整性

- [x] 功能清单（§四）所有项可交互：双 tab、筛选/搜索、星标置顶、详情浮层（词条 5 槽可点击切研究台、合成物「绘制贴图」打开像素绘制器）、蓝本进度条、快捷栏 7→70、回编辑器/去研究台
- [x] 占位数据已替换为真实投影端口（§7.2 全表）
- [x] 星标/快捷栏写入走动作通道，界面无直接写状态
- [x] 限免素材拖入快捷栏被拒绝（交互红闪 + 数据层双保险）

### 8.3 门禁通过

- [x] `npx tsc --noEmit` 0 error
- [x] `npm run lint` 0 error
- [x] 相关测试全绿
- [x] 可启动并打开（devboard 或对应宿主）

---

## 九、风险与兜底

### 9.1 已知冲突

- **冲突 1**：V0 可能把快捷栏展开态做成素材库本地状态，但实际是编辑器/研究台共享（`quickBar.materialExpanded` 在元状态层）。
  - 处置：展开态从投影读，本地不重复持有。
- **冲突 2**：V0 可能把「限免」当成可购买/可拥有展示，或在详情页放「加入拥有库」按钮。
  - 处置：限免 = 摆图可用、不进拥有库（§4.4 限免说明），「我的素材」分栏只列拥有。
- **冲突 3**：V0 可能发明高级检索（多条件/语义搜索）。
  - 处置：明确不做（§十），只有类别 + 关键字两个检索维度。
- **冲突 4**：V0 可能把「绘制贴图」做成素材库内部实现、或给非合成物也显示、或保存时直接写库。
  - 处置：绘制贴图 = 调出**独立解耦的像素绘制器**（`docs/v0-dev-pixel-painter-spec.md`），组件只经 props/onSave 通信；仅合成物显示；写库走动作通道（非合成物数据层拒绝）。

### 9.2 技术债登记

- **债务 1**：词条徽章点击切研究台定位依赖三界面切换路由注入；未注入时按钮禁用并标注「待接线」。
- **债务 2**：占位素材图标用 lucide 图标；真实素材待 sprite-forge 组件管线产出后替换（记入占位素材清单）。
- **债务 3**：V0 若用原生 `<select>` 做类别筛选，需替换为 Radix 组件。

---

## 十、明确不做（防止自由发挥）

- ❌ 不做素材编辑/锻造/合成/LLM 调用（那些在研究台）
- ❌ 不做像素绘制器本体（独立组件 `docs/v0-dev-pixel-painter-spec.md`；本界面只负责「调出 + 接收结果」）
- ❌ 不做词条库浏览（词条列表只在研究台；详情页只展示挂载）
- ❌ 不做蓝本编辑/删除/管理（只读总览；再创作入口在编辑器）
- ❌ 不做高级检索（多条件/语义搜索）
- ❌ 不做账号级元状态���套餐/活动/证据提交——电脑职责）
- ❌ 不做收藏室功能（保险箱是另一承载物）
- ❌ 不做多窗口并排（三界面全屏替换）
- ❌ 不做「学习/提取」等机制动作（对局/研究台职责，本界面只收结果）

---

## 十一、技术建议与示例素材

### 11.1 技术建议

- **React 18** + TypeScript + Tailwind CSS（颜色令牌已在 `src/design/tokens.ts` 定义，语义名 = 颜色名）
- **Framer Motion**：所有入场/出场/过渡（tab 切换、详情浮层、卡片悬停、全屏场景切换）
- **lucide-react**：图标（星标/放大镜/锁等）
- **Radix**：tooltip、dialog（详情浮层）
- 状态管理：本地筛选/搜索用 Zustand 或 useState；数据一律从投影读

**禁止**：
- ❌ 手写 CSS transition 做 UI 动效（只允许 hover 微状态）
- ❌ react-spring / react-icons 等替代库
- ❌ 本地缓存或推断拥有量/角标/可用性

### 11.2 示例素材清单

| 素材 | 用途 | 来源 | 占位 |
|---|---|---|---|
| 素材像素图标（储物柜/感应灯/长椅/信号灯…） | 卡片 + 详情大图 + 快捷栏 | sprite-forge 组件管线（`--context ui`，64×64 俯视剪影） | lucide 图标占位，记入占位清单 |
| 品质色描边（灰白/绿/蓝/银/金） | 品级高光 | 代码（tokens 色值） | — |
| 角标小徽章（限免绿/UGC 青/合成金银/已改动橙点/星标黄） | 卡片角标 | 代码（像素小件） | 内联像素徽章 |
| 蓝本封面缩略图 | 蓝本列表行 | 地图导出缩略图（asset-pipeline） | 纯色占位 + 地图名 |
| 书架全息投影背景（木纹/月光/灰尘） | 氛围底 | 全息光层背景图（代码做不出的微光/闪烁纹理） | 纯色 + 噪声占位 |

---

## 十二、参考样图描述

**顶栏**：青色发光方块 W + 标题；搜索框；青色描边「回编辑器」按钮。
**左栏**：分类筛选列表，「全部/我的素材」分栏语义，当前项青左条。
**中央**：素材卡片网格（像素图标 + 名 + 类别 + 角标），星标卡片首行；tab 切换到蓝本列表（封面 + 进度条，满 → 亮起 + 青徽章）。
**右栏**：详情浮层——大图 + 品级描边 + 词条 5 槽（徽章可点击）+ 弱点 + 限免说明 + 「绘制贴图」按钮（仅合成物）+ 星标按钮 + 青色「去研究台锻造」主按钮。
**底部**：快捷素材栏 7 格，展开 7×10 矩阵 + 筛选/搜索。

---

**交付给 v0.dev**：请根据以上需求生成完整的 React + TypeScript + Tailwind CSS 组件，实现素材库（书架）的所有交互和视觉效果。重点：
1. 书架感的画风（像素前景 + 暖光全息投影背景，暖灯出租屋）
2. 双 tab（可放置元素 / 地图·蓝本）语义分开
3. 星标置顶 + 分类筛选 + 搜索
4. 详情浮层（词条 5 槽可点击、弱点、限免、合成物「绘制贴图」调出像素绘制器、去研究台）
5. 底部快捷栏 7→70（与编辑器共享数据）
6. 全屏切换入口（回编辑器 / 去研究台）
7. 暗色主题 + 半透明面板 + 边缘发光

请发挥 v0.dev 的组件和特效能力，实现精美的游戏内素材库界面。

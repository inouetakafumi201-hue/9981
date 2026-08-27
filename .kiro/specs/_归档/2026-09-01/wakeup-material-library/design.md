# Design: 素材库与研究台 · 全面图形化与人机交互设计

## Overview

本设计把「素材库（书架）+ 研究台（锻造台，权威名）+ 共享元状态层」从既有定案焊成一套可直接投喂 V0.dev 的图形化与人机交互方案。三个独立设计依次展开，最后做图形化提取与投喂文档组织：

1. **设计一**：素材库与 `docs/创作系统/02_熟悉度与梦境素材库.md` 的完整对接方案——熟悉度、学习动作、蓝本、词条四类契约如何在素材库 UI 上正确投影，不混装、不越权。
2. **设计二**：元状态层数据模型（完整 TypeScript interface）+ 状态转换规则——在 `运营/07` 骨架之上补齐可编译形状、动作通道签名、不变量守卫与角标纯函数。
3. **设计三**：素材库 UI 数据接口——后端只读投影 / 前端本地状态 / 写入动作通道的三类划分与端口映射。
4. **图形化提取**：把设计一/二/三中的视觉与动效内容全部提取，落到 UI 草稿图提示词（PLT-03 / PLT-04）与 V0 投喂 MD。

## Architecture Principles

1. **契约即投影**：素材库/研究台是元状态的**只读投影端**，所有「拥有/角标/可用性/熟悉度」由元状态层派生；界面不本地推断（守 devboard 要求 4 与 `运营/07` §3.4 写入纪律）。
2. **动作唯一通道**：机制级写入（学习/提取/合成/锻造/塑形/熟悉度）只经元状态层 actions；界面只触发动作。
3. **三界面状态各自保留**：全屏替换、只经元状态层交互，不直接读对方内部状态。
4. **产权防线前移**：限免不进快捷栏（交互红闪 + 数据层拒绝双保险）、UGC 快捷栏灰显、词条不在书架主视图——所有「看到 ≠ 拥有」都在数据层有结构保证。
5. **图形化语言零新增**：只复用五条视觉定律（颜色语义/边缘发光/像素前景/正面俯视）与全息投影质感（对齐地图编辑器全息游戏风，2026-08-19 审美转向已落账 D-083 并同步 `表现系统/01`，简笔画为历史基线），不发明新主色、不发明新交互形态。
6. **投喂高信息密度**：V0 投喂 MD 只写歧义消除与不可谈判约束，AI 猜得到的实现（按钮变灰、脉冲、悬停发光）不写。

---

## 一、设计一：素材库与创作/02 的完整对接方案

### 1.1 对接的总原则：素材库是「创作资源的只读总览」，不是机制执行器

创作/02 定案的契约按「UI 上谁能看、谁能动」分成三层，素材库只承担其中一层：

| 02 契约 | 素材库的角色 | 执行位置 |
|---|---|---|
| 熟悉度（0-100，创作资格） | **只读投影**：地图/蓝本 tab 每行一根进度条 | 对局记录驱动，素材库只投影 |
| 学习动作 → 元素素材 | **入库结果接收**：新素材出现在主视图 | 对局内学习动作 → 元状态层 `learnMaterial` |
| 蓝本 = 熟悉度满解锁 | **只读总览**：封面亮起 + 徽章，详情可看构成 | 解锁由 `blueprintUnlock`，编辑入口在编辑器 |
| 词条（`placeable:false`） | **不出现**（主视图），详情页仅展示挂载 | 词条库在研究台 |
| 元素素材 vs 蓝本 | 主视图 = 积木（可放置元素）；地图/蓝本 tab = 整套房子 | 双 tab 物理分栏，语义不混 |

### 1.2 熟悉度投影（地图/蓝本 tab）

- 每行一张地图：封面缩略图 + 地图名 + 场景数 + 右侧熟悉度进度条（0-100%）。
- 熟悉度是**累计搜集记录**（`创作/02` §2.3），不受 1-5 数值铁律约束，UI 直接显示 0-100 百分比。
- 满 100% → 封面从灰暗剪影转为亮起 + 「可在编辑器选作蓝本」徽章（青色，UGC/创作语义）；未满 → 进度条 + 「还差 X%」小字。
- 点击已解锁蓝本 → 详情（该梦的完整蓝图预览）；「编辑/再创作」按钮不存在于素材库——蓝本的再创作入口在地图编辑器「新建地图时以某已加载地图为蓝本」（`运营/07` §5.2）。
- 失败也涨（`创作/02` §3.1）：进度条数值只增不减，UI 无需表现"下跌"态。

### 1.3 学习动作的入库链路

```
对局内「学习动作」完成（风险/点数/刻录时间结算）
  → after 事件 → 元状态层 learnMaterial(materialId)
      → MaterialMeta.owned = true（若此前为限免身份，转正为拥有；若为全新素材，新建记录）
      → 素材库投影刷新 → 主视图出现新素材卡片（带「新」入场动效）
```

- 学习动作发生在**对局内**（`创作/02` §4.2），素材库只接收结果。素材库 UI 不提供「学习」按钮。
- 限免素材（地图自带）被「记住」后：`limitedFree:false` + `owned:true`（转正），角标从「限免」变「拥有」。这是限免唯一的转正通道，且只发生在对局内学习动作，不在任何 UI 直接操作。

### 1.4 词条的对接边界（看到 ≠ 拥有）

- 词条**不在素材库主视图浏览**（`运营/04` §四），书架只陈列可放置元素与蓝本。
- 素材详情页可以展示「该素材挂着的 5 槽词条」——这是素材的属性展示，不是词条库。
- 详情页点击词条徽章 → 切到研究台词条库定位（全屏切换承接「就近修改」，物理上仍是一键直达）。
- 词条的拥有、收集进度、提取、合成全部在研究台。

### 1.5 三界面切换在素材库侧的落点

| 入口 | 位置 | 行为 |
|---|---|---|
| 编辑器 → 素材库 | 编辑器右栏快捷素材栏上方小按钮 | 全屏切换，编辑器状态保留 |
| 素材库 → 研究台 | 素材详情页「去研究台锻造」小按钮 | 全屏切换 + 自动装载该素材 |
| 素材库 → 编辑器 | 素材库右上角（对偶入口） | 全屏切换，素材库筛选状态保留 |
| 素材库 → 电脑 | （无，不设计直接入口；电脑是独立承载物） | — |

### 1.6 与保险箱/收藏室的边界

星标（素材库快捷订阅，排序置顶）与保险箱收藏（纪念陈列，独立容器）语义独立（`运营/04` §五）：同一素材可两者都有，互不冲突；素材库不提供「放入保险箱」操作。

---

## 二、设计二：元状态层数据模型 + 状态转换规则

### 2.1 数据模型（完整 TypeScript 形状，落点 `src/meta-state/types.ts`）

> 在 `运营/07` §3.2 骨架之上补齐：基础类型、弱点、来源审计、派生投影契约。所有 id 均为字符串；品质 `1 | 2 | 3 | 4 | 5` 为玩家可见数值铁律的边界内值。

```typescript
// ── 基础类型 ──
export type MaterialId = string;      // 玩家命名 + 随机 key（创作/01 §ID 规范）
export type TokenId = string;
export type MapId = string;
export type QualityTier = 1 | 2 | 3 | 4 | 5;

export type TokenCategory = '属性' | '技能' | '状态' | '防御' | '机动';

export type MaterialSource = 'standard' | 'synthesized'; // 标准件（副本/主线领取）| 合成物（合成台产出）

export type CategoryFilter =
  | '全部' | '装置' | '照明' | '陈设' | '交互' | '线索' | '遮挡'; // 素材类别（编辑器/素材库共用）

export interface WeaknessMeta {
  id: string;                          // 弱点池 10 项之一（缝隙/刚体/易燃/冷脆/易蚀/感电/负重/脆弱/暴露/迟钝）
  label: string;                       // 玩家可读名
}

// ── 素材 ──
export interface MaterialMeta {
  id: MaterialId;
  owned: boolean;                      // 拥有库 = owned:true
  source: MaterialSource;
  quality: QualityTier;                // 品级（合成物按品级公式，标准件按来源）
  category: string;                    // 素材类别（装置/照明/陈设/交互/线索/遮挡…）
  starred: boolean;                    // 星标（素材库排序置顶）
  modified: boolean;                   // 是否被研究台改过
  isUgcNew: boolean;                   // UGC 新增标记（派生/合成）
  equippedTokens: (TokenId | null)[];  // 挂载词条，固定 5 槽（属性/技能/状态/防御/机动）
  weakness: WeaknessMeta | null;       // 与生俱来的弱点裂缝（合成物必有，标准件可空）
  limitedFree: boolean;                // 限免（地图自带，临时免费）；与 owned 互斥
  acquiredAt: number | null;           // 拥有时间戳（素材库排序/回忆用）
  derivedFrom?: MaterialId;            // 派生溯源（创作/01 §四：仅溯源，不解析）
}

// ── 词条 ──
export interface TokenMeta {
  id: TokenId;
  owned: boolean;                      // 是否拥有该词条
  category: TokenCategory;             // 五大类（玩家记忆锚点 + 软合法性）
  quality: QualityTier;                // 品质（提取时 LLM 评级）
  name: string;                        // 自然语言名（烈焰/散射…，不需要对齐代码枚举）
  description: string;                 // 机制话术（即 LLM 解耦 JSON 的准绳）
  starred: boolean;
  collectedAt: number | null;          // 收集时间（材料收集库「我攒到了」感）
}

// ── 蓝本（熟悉度 = 创作资格）──
export interface BlueprintMeta {
  mapId: MapId;
  name: string;
  sceneCount: number;                  // 场景数（蓝本列表行信息）
  familiarity: number;                 // 0-100 累计记录（不受 1-5 铁律约束，只增不减）
  unlocked: boolean;                   // familiarity >= 100 → true（只解锁一次）
}

// ── 快捷栏（编辑器 + 研究台共享同一份）──
export interface QuickBar {
  materialSlots: (MaterialId | null)[]; // 素材快捷栏 7 格（编辑器 + 研究台 + 素材库共享同一份）
  materialExpanded: boolean;            // 是否展开 7×10 全库网格
  materialFilter: CategoryFilter;       // 展开时的类别筛选
  materialQuery: string;                // 展开时的搜索词
  // 2026-08-19 定案：撤销「词条快捷栏」（tokenSlots/tokenExpanded）——研究台没有词条快捷栏，
  // 词条从词条库直接拖入锻造槽位；右栏为共享素材快捷栏。见 §四.2 注记。
}

// ── 塑形备选栏（研究台锻造界面最下方）──
export interface MoldingBar {
  slotCount: 5;                          // 固定 5 格
  unlocked: [boolean, boolean, boolean, boolean, boolean]; // 随主线/套餐解锁
  contents: (MaterialId | null)[];       // 每格放什么（拖入替换，无删除）
}

// ── 合成队列（研究台）──
export type SynthesisStatus = 'queue' | 'running' | 'done' | 'failed' | 'claimed';

export interface SynthesisJob {
  id: string;
  base: MaterialId;                     // 基体（投料烧掉）
  tokens: TokenId[];                    // 词条（投料烧掉）
  status: SynthesisStatus;
  result?: MaterialId;                  // done 后的成品
  failureReason?: string;               // failed 后的解释（LLM 驳回原因）
  failureKind?: 'rejected' | 'degraded'; // 驳回（材料返还）| 降级（材料消耗给保底）
}

// ── 元状态根 ──
export interface MetaState {
  materials: Record<MaterialId, MaterialMeta>;
  tokens: Record<TokenId, TokenMeta>;
  blueprints: Record<MapId, BlueprintMeta>;
  quickBar: QuickBar;
  moldingBar: MoldingBar;
  synthesisQueue: SynthesisJob[];
}
```

### 2.2 派生投影（selector，UI 只读消费）

元状态层暴露只读投影函数，UI 与 devboard 一律消费投影，不直接遍历根状态：

```typescript
export interface MaterialLibraryProjection {
  ownedMaterials(): MaterialMeta[];          // 拥有库（owned:true）
  allVisible(): MaterialMeta[];              // 全部可见（owned + limitedFree）
  starredFirst(list: MaterialMeta[]): MaterialMeta[]; // 星标置顶（同筛选栏内排首）
  materialDetail(id: MaterialId): MaterialMeta | null;
  equippedTokensOf(id: MaterialId): (TokenMeta | null)[]; // 5 槽 → 词条详情（看到 ≠ 拥有）
  blueprintList(): BlueprintMeta[];          // 地图/蓝本 tab 行数据
  isAvailable(materialId: MaterialId): boolean; // devboard + 素材库共用可用性钩子
  badgeStateOf(id: MaterialId): MaterialBadgeState; // 角标派生（见 2.4）
  quickBar(): QuickBar;
  moldingBar(): MoldingBar;
  synthesisQueue(): SynthesisJob[];
}
```

### 2.3 状态转换规则（动作通道，落点 `src/meta-state/actions/`）

每个动作是 `(state, input) → newState` 的纯转换，带前置守卫与后置不变量。界面只调用动作，不直接写状态。

| 动作 | 输入 | 转换（pre → post） | 守卫/不变量 |
|---|---|---|---|
| `learnMaterial` | `materialId` | 限免转正：`limitedFree:false, owned:true, acquiredAt=now`；全新素材：新建 `MaterialMeta`（`source:'standard'`，品级按来源） | 仅对局内学习动作触发；限免与拥有互斥维持 |
| `extractToken` | `materialId, focusAttr` | 移除该素材（不可逆）→ 新增 `TokenMeta`（`quality` 由 LLM 评级 + 波动） | 素材必须 `owned:true`；`focusAttr` 必须命中可提取白名单 |
| `synthesizeSubmit` | `base, tokens[]` | 原子消耗基体 + 词条 → 新建 `SynthesisJob{status:'queue'}` | 基体 `owned:true`、非限免；词条均 `owned:true`；每大类 ≤1（5 槽结构保证） |
| `synthesizeFinish` | `jobId, result?` | `status:'done'` + `result`（合成物：`source:'synthesized', weakness` 非空） | 由 LLM 回调驱动，UI 不直接调用 |
| `synthesizeFail` | `jobId, reason, kind` | `kind:'rejected'` → 材料原样返还 + `status:'failed'`；`kind:'degraded'` → 材料消耗 + 品级 1 保底模板入拥有库 + `status:'failed'` | 两类失败结果不同（`运营/06` §4.4） |
| `synthesizeClaim` | `jobId` | 成品移入拥有库（`owned:true`），job 置 `'claimed'` | 仅 `done` 可收下 |
| `forgeModify` | `materialId, slots[]` | `modified:true`；保存覆盖（同 id）或派生（新 id + `derivedFrom`） | 仅 `owned:true`、非限免、非 UGC 灰显（UGC 走研究台流程是允许的，灰显只在快捷栏取用场景） |
| `toggleStar` | `materialId \| tokenId` | `starred` 翻转 | 素材库/词条库通用 |
| `quickBarSet` | `slotIndex, materialId?` | 素材快捷栏第 i 格写入/清除 | **拒绝 `limitedFree:true`**（数据层防线）；UGC 素材可写但 UI 灰显不可拖（交互层防线） |
| `quickBarTokenSet` | ~~已撤销~~ | 2026-08-19 定案：研究台无词条快捷栏，此动作废除 | — |
| `moldingSet` | `slotIndex, materialId` | 塑形栏第 i 格替换 | 拒绝限免；拒绝未解锁格；仅 `owned:true` |
| `blueprintUnlock` | `mapId` | `familiarity >= 100` 时 `unlocked:true`（只触发一次） | 熟悉度只增不减 |

**写入纪律**（承接 `运营/07` §3.4）：素材的「拥有/品质/角标」由机制动作驱动，界面只触发动作、不直接改元状态；界面 UI 不内联判定合法性（可用性判定走 `isAvailable` 钩子）。

### 2.4 角标派生（纯函数，UI 不维护角标）

```
badgeStateOf(material) =
  material.limitedFree          → '限免'（绿）
  material.isUgcNew             → 'UGC'（青）
  material.source === 'synthesized' → '合成'（金/银，品级高光）
  material.modified             → '已改动'（橙小点）
  material.starred              → '星标'（黄）
```

- 一个素材可同时有多个角标（如「合成 + UGC + 已改动」），主色取玩家最可能猜中的那个，其余做小徽章（`运营/07` §3.3）。
- 角标是 `MaterialMeta` 的纯函数派生，UI 不自行维护（Requirement 3.7）。
- 品质色（灰白/绿/蓝/银/金）守 `运营/06` §3.5：仅作高光/描边，不构成严格评级阶梯（D-066）。

### 2.5 不变量清单（实现期用属性测试守卫）

1. `limitedFree:true` ⇒ `owned:false`（限免与拥有互斥）。
2. `source:'synthesized'` ⇒ `weakness !== null`（合成物必有弱点裂缝）。
3. `equippedTokens.length === 5` 恒定（五大类槽位）。
4. `quickBar.materialSlots` 不含任何 `limitedFree:true` 的 id。
5. `moldingBar.contents` 不含限免 id，且第 i 格写入要求 `unlocked[i]===true`。
6. `blueprint.unlocked` 一旦为 true 不再回退；`familiarity` 单调不减。
7. `synthesizeSubmit` 后基体与词条立即从拥有库消失（原子性），`synthesizeFail(rejected)` 后全部原样返回。
8. 素材库/编辑器/研究台只消费投影，任何界面不持有 `MetaState` 的写引用。

---

## 三、设计三：素材库 UI 数据接口（只读投影 vs 本地状态）

### 3.1 三类数据的划分

| 类别 | 内容 | 生命周期 | 存储位置 |
|---|---|---|---|
| **后端只读投影** | 素材列表（含角标）、素材详情、词条挂载、蓝本 + 熟悉度、快捷栏配置、可用性判定、合成队列状态 | 随元状态层变化（机制动作驱动） | `src/meta-state/` selector |
| **前端本地状态** | 筛选词、搜索词、tab 选择（素材 / 地图·蓝本）、展开/收起、悬停目标、拖拽进行中（来源/落点）、详情页打开/关闭、星标按钮即时反馈 | 随界面会话存活，切换界面后保留（三界面切换契约） | `src/ui/material-library/` 内 Zustand / useState |
| **写入动作通道** | `toggleStar`、`quickBarSet / quickBarClear`（素材库侧仅此三项；其余动作在研究台/对局/电脑） | 触发即提交，元状态层权威 | `src/meta-state/actions/` |

### 3.2 素材库本地状态明细（不进入元状态层）

```typescript
interface MaterialLibraryLocalState {
  activeTab: 'elements' | 'blueprints'; // 主视图 / 地图·蓝本 tab
  scopeFilter: 'all' | 'owned';         // 全部（含限免）/ 我的素材（拥有库）
  category: CategoryFilter;
  query: string;
  expanded: boolean;                    // 快捷栏展开态（与元状态 quickBar 同步但由界面持有镜像？——见下）
  hoveredId: MaterialId | null;
  detailOpenId: MaterialId | null;
  drag: { sourceId: MaterialId } | null;
  starPending: Set<MaterialId>;         // 星标乐观更新的 pending 集合
}
```

> **快捷栏展开态归属**：`quickBar.materialExpanded` 定义在元状态层（`运营/07` §3.2），因为编辑器与素材库共享同一份快捷栏数据、展开态跨界面一致。素材库本地状态不重复持有它，直接读投影。

### 3.3 端口映射表（V0 接线清单，投喂 MD 与接线共用）

| V0 占位数据 | 真实端口（投影/动作） | 类型 | 方向 |
|---|---|---|---|
| `mockMaterials` | `projection.allVisible() / ownedMaterials()` | `MaterialMeta[]` | 只读 |
| `mockMaterialDetail` | `projection.materialDetail(id)` | `MaterialMeta \| null` | 只读 |
| `mockTokensOnMaterial` | `projection.equippedTokensOf(id)` | `(TokenMeta \| null)[]` | 只读 |
| `mockBadges` | `projection.badgeStateOf(id)` | `MaterialBadgeState` | 只读（纯函数派生） |
| `mockBlueprints` | `projection.blueprintList()` | `BlueprintMeta[]` | 只读 |
| `mockQuickBar` | `projection.quickBar()` | `QuickBar` | 只读（写走动作） |
| `mockStar` | `actions.toggleStar(id)` | `(state, id) => newState` | 写（动作通道） |
| `mockDragToQuickBar` | `actions.quickBarSet(index, id)` | 同上 | 写（拒绝限免） |
| `isAvailable` | `projection.isAvailable(id)` | `(id) => boolean` | 只读（devboard 共用） |
| `switchToBench` | 三界面切换路由（注入回调） | `(materialId) => void` | 动作 |
| `switchToEditor` | 三界面切换路由（注入回调） | `() => void` | 动作 |

### 3.4 素材库不得做什么（数据层边界）

- 不得本地缓存或推断拥有量、角标、可用性（Requirement 4.5）。
- 不得直接改 `MetaState`（只能调 actions）。
- 不得提供机制级写入（学习/提取/合成/锻造/塑形）——那些在研究台/对局/电脑。
- 不得实现词条库浏览（看到 ≠ 拥有，但词条列表本身只在研究台）。

---

## 四、图形化提取总表

从设计一/二/三与既有权威文档提取全部「可见、可动、可交互」内容，作为 PLT-03 / PLT-04 提示词与 V0 投喂 MD 的素材。

### 4.1 素材库（书架）——检索优先，清爽书架感

| 区块 | 图形化内容 | 视觉/动效要点 |
|---|---|---|
| 整体 | 全屏书架界面，顶栏 = 界面切换入口（回编辑器）；主视图 = 素材卡片网格；「地图/蓝本」tab | 像素 + 全息投影叠加（对齐地图编辑器全息游戏风）；半透明暗面板浮于暖琥珀光全息投影层（书架/月光/灰尘微粒的微光闪烁），整体偏暖；主功能色 ≤3-4，青为唯一高饱和主色 |
| 素材卡片 | 图标 + 名称 + 类别小字 + 角标（限免绿/UGC 青/合成金银/已改动橙点/星标黄） | 卡片悬停 = 边缘发光（青或类别色）；角标小徽章；星标置顶排序 |
| 素材详情 | 大图 + 名称 + 类别 + 品级（品质色描边）+ 5 槽词条挂载（空槽「无」）+ 弱点裂缝（合成物）+ 限免说明 + 星标按钮 + 「去研究台锻造」小按钮 | 详情页半屏或全屏浮层；词条徽章点击 → 切研究台定位 |
| 地图/蓝本 tab | 每行 = 封面缩略图 + 地图名 + 场景数 + 熟悉度进度条（0-100%）；满 100% 封面亮起 + 蓝本徽章（青） | 未解锁 = 灰暗剪影；解锁 = 亮起 + 微光；进度条增长动画（只增不减） |
| 切换入口 | 右上角回编辑器（对偶）；详情页去研究台（小按钮） | 全屏替换过渡（Framer Motion 场景切换） |

### 4.2 研究台——游戏化、仪式感、材料工作台

| 区块 | 图形化内容 | 视觉/动效要点 |
|---|---|---|
| 词条库 | 五大类标签页（属性/技能/状态/防御/机动，颜色语义区分）；卡牌网格：已收集亮起（名 + 品质色 + 简介 + 收集时间），未收集灰暗剪影 + 「？」；每类顶部收集进度 | 卡牌 = 像素图标 + 品质色描边；未收集 = 剪影轮廓（能看到这格是什么但拿不到） |
| 锻造工作台 | 基体 + 固定 5 槽（属性/技能/状态/防御/机动）；底图感（槽位预印默认词条）；右侧组合预览（当前挂载词条的名称 + 机制话术，空槽「未挂载」） | 改枪式工作台质感；词条拖入 = 盖上去（默认值弹回 = 底图恢复）；拖拽落点发光，非法落点红闪；**不设火力/射程强度条**（2026-08-19 定案：不模仿改枪界面，强调自主设计机制） |
| 合成仪式 | 全屏跳进「高科技锻造入口」（发光锻造门/闸口）→ 3 个台子（左侧熔炼 / 中央主锻造 / 右侧铭刻）→ 悬浮摆动/高速旋转/粒子电焊火花 → 完成高光爆发 + 成品浮现 → 「收下」；失败 = 成品变灰 + 解释面板 | 全屏演出过认知判据（郑重交付的仪式感）；粒子只承担仪式感，关键结果（品质/成败）靠图标/文字/面板承载 |
| 塑形备选栏 | 锻造界面最下方独立长条框，固定 5 格：解锁格（可拖入替换）/ 未解锁格（锁图标，不可交互） | 科技感长条框；未解锁 = 扁平灰 + 锁；拖入替换 = 覆盖 |
| 素材快捷栏（右栏，共享） | 研究台右侧 7 格 + 展开 7×10（全素材库矩阵，类别筛选 + 搜索） | 与素材库/编辑器共享同一份 `quickBar.materialSlots`（07 §10.1）；用于拖素材到塑形栏/换基体；**研究台无词条快捷栏**（2026-08-19 定案，词条从词条库直拖） |

### 4.3 两界面共享的视觉常量（写进两份提示词）

- 画风：像素 + 全息投影叠加（交互组件高饱和像素、背景为半透明暖光全息投影光层，微微泛光、轻微闪烁——对齐地图编辑器全息游戏风，D-083 已落账并同步 `表现系统/01`，简笔画为历史基线）；正面俯视视图仅约束地图实体，UI 面板为平面布局无透视。
- 颜色：青 = UGC/创作主色；绿 = 限免/免费；金/银 = 品级高光；橙 = 进行中/消耗（已改动、合成进度、塑形状态）；黄 = 星标/注意；红 = 错误边界（合成失败解释）；灰白 = 可交互但受制于状态（UGC 灰显、未解锁塑形格）。
- 交互：边缘发光（可拖拽素材/词条悬停发光；限免拖拽落点红闪；未解锁扁平灰 + 锁）。
- 明确不是：网页/SaaS/浏览器 chrome；不是暗黑科技终端（霓虹扫描线、金属栅格）；不是鲜艳卡通。

---

## 五、V0 投喂文档组织与批次

### 5.1 批次划分

**批次 A（设计层，本次完成）**：本 Spec 三件套（requirements / design / tasks）——开发期设计真相源，供并行会话与接线参考，不直接喂 V0。

**批次 B（V0 投喂层，本次完成）**：
| 文件 | 内容 | 对应界面 |
|---|---|---|
| `docs/v0-dev-material-library-spec.md` | 素材库（书架）完整投喂需求 | 素材库 |
| `docs/v0-dev-bench-spec.md` | 研究台完整投喂需求 | 研究台 |
| `docs/表现系统/PLT-03_素材库UI样图_提示词.md` | 素材库 UI 草稿图 Image-2/Nano Banana 提示词 | 素材库 |
| `docs/表现系统/PLT-04_研究台UI样图_提示词.md` | 研究台 UI 草稿图 Image-2/Nano Banana 提示词 | 研究台 |

**批次 C 及以后（实现层，列入 tasks.md，不在本次执行）**：`src/meta-state/` 实现与属性测试 → 素材库 V0 投喂 + 接线 → 研究台 V0 投喂 + 接线。

### 5.2 投喂 MD 的写作纪律（本项目 V0 偏好）

1. **描述性词汇优先**：V0 对 UI 图形化审美高，给质感关键词（「暖灯出租屋里的筑梦工作台」「材料收集册 + 改枪工作台」），不做逐像素约束；不歧义即可。
2. **只写 AI 猜不到的**：按钮变灰、脉冲、悬停发光、禁用态等成熟实现不写；写「什么状态显示什么」「什么操作触发什么」「什么数据从哪来」。
3. **信息密度高**：每段都有信息增量，不重复既有权威文档原文，只引用文件路径。
4. **接线友好**：数据结构给 TS 占位形状 + 端口映射表，保证接线阶段产出四张清单（术语映射/占位素材/缺失设计/多余项目）。
5. **明确不做**：每份投喂 MD 末尾列「明确不做」，防 V0 自由发挥。

---

## 六、与既有文档的衔接

| 文档 | 本设计的关系 |
|---|---|
| `运营/07` | 本设计在 MetaState 骨架之上补完整形状与转换规则；三界面切换契约照搬不重述 |
| `创作/02` | 设计一是它的 UI 侧对接；熟悉度/蓝本/词条语义全部照搬 |
| `运营/04` | 书架人机交互（星标置顶/检索优先/快捷栏 7→70）照搬 |
| `运营/06` | 词条库/合成仪式/塑形栏机制输入照搬，界面落点以 07 + 本设计为准 |
| `表现/01` | 五条视觉定律/边缘发光/像素前景全量复用；背景已按 D-083 同步为全息投影光层（2026-08-19），简笔画为历史基线，零新增主色 |
| `工程治理/10` | 投喂 → 接线 → 验收三阶段与七条接线铁律照搬 |
| `工程治理/12` | 偷师前端命令面板可挂素材库/研究台场景切换 |
| `src/devboard/ports/material-availability.ts` | 元状态层落地后，`isAvailable` 由 `src/meta-state` 实现，devboard 消费端不变 |

# 素材库前端壳层（library-shell）

> **来源**：v0.dev 生成的素材库（书架）前端壳子  
> **需求文档**：`docs/v0-dev-material-library-spec.md`  
> **接线清单**：`.kiro/接线准备/v0-frontend-wiring-readiness.md` §三

---

## 目录结构（预期）

```
library-shell/
├── components/               # v0 生成的组件
│   ├── LibraryTopBar/       # 顶栏：W 徽标 + 搜索框 + 回编辑器
│   ├── FilterSidebar/       # 左栏：全部/我的素材 + 类别筛选
│   ├── LibraryTabs/         # 双 tab：可放置元素 / 地图·蓝本
│   ├── ElementGrid/         # 素材卡片网格
│   │   ├── MaterialCard/    # 素材卡片（图标 + 名 + 角标）
│   │   └── BadgeGroup/      # 角标组（限免/UGC/合成/已改动/星标）
│   ├── BlueprintList/       # 蓝本列表
│   │   └── BlueprintRow/    # 蓝本行（封面 + 进度条 + 徽章）
│   ├── DetailOverlay/       # 右栏详情浮层
│   │   ├── MaterialDetailHeader/  # 大图 + 品级描边
│   │   ├── TokenSlotRow/    # 词条挂载 5 槽
│   │   ├── WeaknessLine/    # 弱点裂缝
│   │   ├── LimitedFreeNote/ # 限免说明
│   │   ├── StarButton/      # 星标按钮
│   │   └── SwitchToBenchButton/ # 去研究台锻造
│   └── QuickBarStrip/       # 底部快捷栏（7→70）
│       ├── QuickBarSlots/   # 7 格折叠
│       └── ExpandedMatrix/  # 7×10 展开 + 筛选/搜索
├── styles/                  # v0 样式（如有）
├── types/                   # v0 类型定义（如有）
├── utils/                   # v0 工具函数（如有）
└── index.ts                 # 壳层统一出口

README.md                    # 本文件
```

---

## 接线规则

### 保留项（v0 原样）

- 组件名、层级、props 接口、样式类名
- 布局结构（顶栏 + 左栏筛选 + 中央网格 + 右栏详情 + 底部快捷栏）
- 视觉效果（动效、发光、悬停、角标）
- Framer Motion / Radix / lucide-react 使用方式

### 替换项（接线时改）

| v0 占位数据 | 真实端口 | 来源 |
|---|---|---|
| `mockMaterials` | `projection.allVisible()` / `projection.ownedMaterials()` | 元状态投影 |
| `mockMaterialDetail` | `projection.materialDetail(id)` | 元状态投影 |
| 词条挂载 | `projection.equippedTokensOf(id)` | 元状态投影 |
| 卡片角标 | `projection.badgeStateOf(id)` | 元状态投影（纯函数派生） |
| `mockBlueprints` | `projection.blueprintList()` | 元状态投影 |
| 素材快捷栏（底部共享） | `projection.quickBar()` | 元状态投影 |
| 星标切换 | `actions.toggleStar(id)` | 动作通道 |
| 快捷栏配置 | `actions.quickBarSet(index, id)` | 动作通道（拒绝限免） |
| 去研究台 | `switchToBench(materialId, opts?)` | 三界面切换注入回调 |
| 回编辑器 | `switchToEditor()` | 三界面切换注入回调 |

### 关键交互规则

- **限免素材**（绿角标）：可见、可摆图，**但不可拖入快捷栏**（落点红闪）
- **UGC 素材**（青角标）：在快捷栏中**灰显、不可拖**，悬停提示「UGC 素材请到研究台处理」
- **星标置顶**：同筛选栏内排首，不是全局置顶
- **词条徽章可点击** → 切研究台并定位到该词条（查看来源/品质/可贴宿主）

### 术语纠正

| v0 可能写的 | 项目权威术语 |
|---|---|
| 物品/道具 | 素材（Material） |
| 收藏 | 星标（Starred） |
| 商店/市场 | 素材库（Library） |
| 蓝图 | 蓝本（Blueprint） |

---

## 导入说明

把 v0 导出的素材库前端代码放入本目录：
- 如果 v0 导出的是 `app/` 目录，把其中的 `components/` / `styles/` / `utils/` 内容放进来
- 不要与地图编辑器代码混在一起

接线后，`MaterialLibraryApp` 根组件将从这里导出，由三界面切换路由挂载。

# 地图编辑器前端壳层（editor-shell）

> **来源**：v0.dev 生成的地图编辑器前端壳子  
> **需求文档**：`docs/v0-dev-map-editor-spec.md`  
> **接线清单**：`.kiro/接线准备/v0-frontend-wiring-readiness.md` §二

---

## 目录结构（预期）

```
editor-shell/
├── components/          # v0 生成的组件
│   ├── EditorTopBar/   # 顶栏：W 徽标 + 地图名 + 撤销/重做
│   ├── LeftPanel/      # 左栏：已加载地图 + 图层 + 快捷键
│   ├── CanvasArea/     # 中央画布区（工具栏 + SVG 容器）
│   ├── ToolBar/        # 五工具：V/N/E/I/P
│   ├── RightPanel/     # 右栏：检查器 + 快捷素材 + 测试
│   └── DiagnosticBar/  # 底部诊断条
├── styles/             # v0 样式（如有）
├── types/              # v0 类型定义（如有）
├── utils/              # v0 工具函数（如有）
└── index.ts            # 壳层统一出口

README.md               # 本文件
```

---

## 接线规则

### 保留项（v0 原样）

- 组件名、层级、props 接口、样式类名
- 布局结构（三栏 + 顶栏 + 底栏）
- 视觉效果（动效、发光、悬停）
- Framer Motion / Radix / lucide-react 使用方式

### 替换项（接线时改）

| v0 占位数据 | 真实端口 | 文件 |
|---|---|---|
| 硬编码地图数据 | `workspace-state.ts` `loadMap` / `exportMap` | `src/devboard/editor/` |
| 假图层列表 | `layer-shapes.ts` + `layer-rules.ts` | `src/devboard/layers/` |
| 假素材快捷栏 | `projection.quickBar()` | 元状态投影 |
| 假 SVG 画布渲染 | **保留现有** `CanvasView.tsx` | `src/devboard/app/` |
| 假编辑行为 | `editor-state.ts` `placeNode` / `drawEdge` | `src/devboard/app/` |
| 假撤销/重做 | `editor-history.ts` `undo` / `redo` | `src/devboard/app/` |
| 假诊断校验 | `playtest.ts` | `src/devboard/verify/` |

### 关键图元说明

- **场景框**：淡青虚线矩形，代表场景物理范围，涂鸦式整体选中
- **高光点**：青色发光小圆点（场景锚点），拖拽 = 进入拉边流程
- **涂鸦式合并**：同类型矩形重叠 → 自动合并为一个聚合场景
- **空洞全填**：封闭区域内空洞被填充，视为场景一部分
- **粘连拒绝**：一次拖拽同时碰到两个不同场景 → 拒绝

### 术语纠正

| v0 可能写的 | 项目权威术语 |
|---|---|
| 节点 | 场景（Scene） |
| 障碍物 | 遮挡框（Obstruction） |
| 传送门 | 过渡窗口（Transition Window） |
| 连接 | 边/连线（Edge） |

---

## 导入说明

把 v0 导出的地图编辑器前端代码放入本目录：
- 如果 v0 导出的是 `app/` 目录，把其中的 `components/` / `styles/` / `utils/` 内容放进来
- 不要覆盖 `src/devboard/main.tsx`、`src/devboard/app/`、`src/devboard/editor/`

接线后，`EditorApp` 根组件将从这里导出，由 `src/devboard/main.tsx` 挂载。

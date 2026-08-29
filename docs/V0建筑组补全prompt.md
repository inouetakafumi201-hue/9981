# V0 地图生成 Prompt —— 建筑组专项（已废止）

> **D-084 定论（2026-08-29）**：本文不再是可执行提示词。建筑组、分支楼层、portal、shell 与 `buildingRenderMode` 已从地图主干删除；新地图必须按单 Zone + 普通 `layers[]` + 显式 edge 类型创作。以下内容仅保留为历史上下文，不得用于生成或导入。

## 核心概念

### 什么是建筑组

建筑组（BuildingGroup）是一栋楼在游戏中的完整表达，由以下部分组成：

| 字段 | 说明 | 约束 |
|------|------|------|
| `frame` | 建筑占地框 `{ x, y, width, height }` | 必须和所有楼层的 frame 一致 |
| `shell` | 外壳类型（solid / glass / mixed） | 影响户外是否可见 |
| `floors[]` | 楼层数组，每层一张俯视像素图 | 至少 1 层 |
| `portals[]` | 楼梯/门户，连接不同楼层 | from/to 必须是真实楼层 ID |

### 关键设计原则（D-081 规范）

1. **frame 严格同步**：所有楼层的 `frame` 必须等于建筑组的 `frame`，不允许"缩小楼层图幅"。引擎依赖此规则判断玩家是否"在建筑内"。

2. **同高不合并**：两层层高相同也是独立楼层，不会被引擎合并为一个。设计意图由编辑器自行约定。

3. **户外=exterior / 室内=interior**：渲染模式由 `buildingRenderMode` 控制，切换时 shell 隐藏、楼层图替换场景、其他建筑继续渲染。

4. **旧地图兼容**：无 `buildingGroups` 字段的地图完全不受影响，不生成任何建筑组数据。空数组 `[]` 也不要输出。

---

## 场景分类与资产规范

### 俯视图（top-down-plan）✓ 推荐

- 纯俯视，相机正交朝下
- 无文字、无动态物件
- 像素精确对齐网格
- **可安全使用建筑组系统**

### 等轴测（isometric）⚠ 限制

- 需额外处理遮挡关系
- QC 会发出警告：`"view is not reliably top-down"`
- 不建议在 V0 阶段用于建筑组

### 斜45°（top-down-isometric）⚠ 限制

- 同上，frame 对齐问题较多
- 建议先出俯视图，确认后再处理等轴测

---

## 建筑组生成 Checklist（AI 创作时逐项检查）

### 前置检查

- [ ] 素材无文字、无动态物件（门/窗/可动装置）
- [ ] 每张楼层图和建筑占地框尺寸完全一致
- [ ] 楼层图无透视变形，屋顶/地面在同一像素坐标系内

### 数据正确性

- [ ] 所有楼层的 `frame` 与建筑组 `frame` 数值一致
- [ ] `portals` 的 `from` 和 `to` 指向真实存在的楼层 ID
- [ ] `portal.def` 使用规范前缀：`portal:default` / `stair:up` / `stair:down`
- [ ] `buildingGroups` 为空时不输出字段（旧地图兼容）

### 导出格式

```json
{
  "id": "city_v0",
  "buildingGroups": [
    {
      "id": "bldg_1",
      "frame": { "x": 100, "y": 200, "width": 300, "height": 400 },
      "shell": "solid",
      "floors": [
        {
          "id": "bldg_1_f1",
          "ordinal": 1,
          "height": 0,
          "image": "data:image/png;base64,...",
          "frame": { "x": 100, "y": 200, "width": 300, "height": 400 },
          "nodes": ["n1", "n2"]
        }
      ],
      "portals": [
        { "from": "bldg_1_f1", "to": "bldg_1_f2", "def": "stair:up" }
      ]
    }
  ]
}
```

---

## 常见错误与修复

| 错误现象 | 原因 | 修复方式 |
|----------|------|----------|
| 楼层图幅偏小 | 上传了裁剪过的图 | 重新导出原始尺寸，确保 width/height 和 frame 一致 |
| 建筑组框选无效 | 框选时没有创建建筑组 | editor-store 在 marquee 完成时自动创建 |
| portal 跳转失效 | from/to 写错了楼层 ID | 检查 portals 数组，ID 必须精确匹配楼层 .id |
| 旧地图多出建筑组 | 导出时错误插入了空 buildingGroups | omit 空数组，不要输出 `buildingGroups: []` |
| 楼层切换时画面撕裂 | 楼层 image 未正确绑定 | 检查 setBuildingFloorImage() 是否传入了 dataUrl |

---

## AI 创作指南

生成俯视地图时，**默认使用建筑组系统**：

1. 先画**地面层**（height=0），作为第 1 层
2. 再画**屋顶/高楼层**，每层独立一张图
3. 在楼层之间**画楼梯图标**，并在 portals 中记录连接关系
4. 壳类型：如果建筑完全遮挡内部，用 `solid`；有玻璃幕墙用 `mixed`
5. 测试时：点击建筑 → 看到楼层切换 → 走楼梯 → 看到位置跳转

**不要做的事：**

- 不要把一栋楼的所有楼层合并为一张大图
- 不要在不同楼层的图幅中使用不同的坐标偏移
- 不要在没有俯视图素材的情况下生成"等轴测变体"

---

## 编辑器操作路径（人机配合）

当 AI 生成的建筑组数据有问题时，编辑器可以手动修正：

```
建筑组卡片操作路径：
  left-panel → 展开 BuildingGroupCard → 操作目标楼层

原子 API 对应：
  加楼层   → addBuildingFloor()      [自动同步 frame]
  选楼层   → setBuildingFloorOrdinal()
  设图幅   → setBuildingFloorImage() [绑定 pixels → floor.image]
  绑入口   → bindBuildingPortal()    [from/to/def 三元组]
```

这些 API 由 left-panel 触发，editor-store 统一驱动文档状态，不可绕开 editor-store 直接修改 MapDoc。

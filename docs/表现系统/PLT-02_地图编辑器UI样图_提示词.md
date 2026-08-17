# 地图编辑器 UI 样图 · Image-2 提示词（v3 · 像素简笔研究台版 · 内嵌游戏）

> 用途：把地图编辑器（`src/devboard/`）的 UI 要素编译成一张 1080p 高质感样图，供项目所有者过目、敲定后作为消费级前端美工的一比一实现底稿。
> 依据：`src/devboard/app/EditorApp.tsx` + `CanvasView.tsx` + `src/design/tokens.ts`（唯一色板）+ `docs/运营系统/04 §3.4`（素材栏 7→70）+ `docs/创作系统/01`（§八工作台交互 + §九地图编辑器交互）+ `docs/表现系统/01`（画风基线）+ `04 §六`（质感指令）。
> 世界观锚点：这是**内嵌在独立游戏里的 UI**，玩家从出租屋驻地的**研究台**（=筑梦工作台，`运营/03 §三`；电脑=地图编辑器入口）进入，是**主动「筑梦」的仪式化工具**。网页感（浏览器 chrome、登录条、SaaS 后台、仪表盘堆叠）是大忌。
> 铁律（v3 修正）：**样图 = 设计目标，不是实现快照**——布局要素要齐（三栏/五工具/素材矩阵等），**文字不逐字**、由 Image-2 自排版；**质感 = 像素风 + 简笔画**（`01` 画风基线），**不是暗黑科技终端**。取色只取 tokens，俯视平面 2D。

---

## 一、定位与质感（先定气质，再讲布局）

### 气质一句话
**出租屋里一张暖灯下的「筑梦工作台」**——像素风 + 简笔画叠加的独立游戏质感：前景是像素小件（工具钮、素材图标、场景框），背景是低饱和简笔画（梦境地图、站台剪影、月光），UI 面板半透明浮在其上。像玩家在夜里打开这台机器「构建自己要做的梦」，不是冷冰冰的黑色科技终端。

不是 SaaS / 不是网页 / 不是素材 App，是**一整个驻地的筑梦装置**。

### 质感指令（Image-2 必带）
- **像素风 + 简笔画叠加**（`01` 画风基线）：交互组件/实体 = 高饱和像素（32–64px）；地图背景/环境 = 低饱和简笔画粗笔触；前景像素 + 背景草图分层渲染，层次清晰。
- **俯视平面 2D、无 3D**：画布是俯视平面地图（平面轮廓+落地阴影，无前脸/侧脸/顶面/斜投影纵深）。
- **半透明浮层**：UI 面板介于「操作台与画布」之间半透明，让底透一点（`04 §六-1`）。
- **边缘发光交互**：可交互物 = 描边 + 内发光（`01` 视觉定律 2），不可交互 = 扁平淡线。
- **克制、暗调、略冷**：同一画面主功能色 ≤3–4，其余灰阶承载（`04 §六-5`）；整体偏梦境/清醒对峙题材的暗雅，不是鲜艳卡通，也不是黑色科技。
- **不出现**：浏览器标签栏/地址栏/滚动条样式的网页壳、登录/注册条、现代 SaaS 侧边导航、亮色卡片堆、金属栅格、霓虹扫描线。它是「游戏内筑梦装置」，不是网页。

---

## 二、画面总览（一屏 1920×1080，三栏操作台）

```
┌────────────────────────────────────────────────────────────────────────────┐
│ 顶栏（筑梦装置头）：青发光徽标 W「WakeUp 筑梦台 · 地图编辑」│ 地图名+id │ 撤销 重做 ＋ 蓝本新建 校验并导出 │
├───────────────┬──────────────────────────────────────────────┬──────────────┤
│ 左栏（暗面板） │ 中央画布 = 正被构筑的梦境（俯视平面地图）       │ 右栏（暗面板） │
│ 已加载地图     │  工具栏：V选择 N放置场景 E拉边 I取样 P测试运行   │ 检查器(场景/连线)│
│ 图层           │  场景框 连线 视觉遮挡 物理遮挡 高地 洼地 过渡窗 │ 快捷素材库    │
│ 图层注记/树    │  折点 描线 框选 网格 图例                      │ (7→70矩阵)   │
│ 快捷键提示     │                                                 │ 运行测试      │
├───────────────┴──────────────────────────────────────────────┴──────────────┤
│ 底部「梦境结构诊断」条：结构校验通过/错误 │ 提示 │ 诊断列表(错误/提示，可点)   │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 三、逐区要素清单（文字由 Image-2 自排版，逐字不保证，要求"区块 + 要素位置"齐全）

> 布局三栏固定：顶栏 / 左栏 / 中央画布 / 右栏 / 底部诊断条。要素**位置与数量**必须齐（每个区块、每个控件、每个图元），文字是示意。

### 1. 顶栏（筑梦装置头）
- 左：青发光方块徽标内白色字母 **W**；旁两行标题（粗） + 副标题（小字暗）。可写「WakeUp」+「地图编辑 · 研究台」。
- 中：**地图名输入框**（暗底无边框、粗字）+ 右侧暗灰小字 id。
- 右：**撤销**、**重做**、**＋**、**蓝本新建**、**校验并导出**（青色实心主钮，边缘透光）。

### 2. 左栏（暗面板 · 梦境蓝图）
- **已加载地图**：列表，每项 = 地图名 + 「N 场景」小字；当前项青左条 + 淡青晕。示例：`夜班月台`、`卧铺车厢`。
- **图层**：行 = 青色亮点 + 图层名 + 右侧高度数字框。示例 `地面层`(0)、`高架层`(1)。
- **图层注记**：`当前：地面层` / `可见 2/2 层` / `相邻透明度 独立`。
- **快捷键**：两列暗字表（V/N/E/I/P、空格/中键 平移、滚轮 缩放、Ctrl+Z 撤销、Ctrl+Shift+Z 重做、Ctrl+S 导出、Delete 删除、Tab 右栏、1/2/3 楼层、Esc 退出/清选）。

### 3. 中央画布（正被构筑的梦境）
- **工具栏**：五工具钮，青快捷键字母 + 中文名，当前激活项深底透光。`V选择 / N放置场景 / E拉边 / I取样 / P测试运行`。
- **画布**（低饱和简笔画底 + 梦境网格）：**场景框**（淡青虚线描边、半透明淡底、圆角、内 L/M/S 尺度+节点名）；**连线**（青色样条、方向箭头、选中变黄）；**折点**（白点/橙描边）；**视觉遮挡框**（黄半透明）；**物理遮挡框**（红半透明）；**高地**（深绿）/ **洼地**（浅绿）；**过渡窗口**（橙菱形 ⬡，可独立拖）；**素材放置图标**（黄小物）；**描线预览**（青虚线）、**框选**（青虚线框）；左下角三格图例（场景框/连接/素材放置）。
- 画布底透一点「梦的意象剪影」（站台剪影/月光/雾）当氛围，地图网格在其上。

### 4. 右栏（暗面板）
- **检查器**：选中场景 → `名称 / 尺度(大/中/小) / X / Y / 楼层 / Def`；选中连线 → `方向 / Def / 语义锚点(高地/洼地/中性) / 过渡窗口(✓+X/Y) / 遮挡框(视觉+框、物理+框、各带 旋转/清除)`。
- **快捷素材库**：标题 + 「展开 70」钮。**未展开=竖排 7 卡**（首字发光图标+名+类别）；**展开=7×10 矩阵 70 格**，上方出现**分类筛选 + 搜索框**。素材：储物柜/感应灯/长椅/信号灯/档案箱/终端屏/隔离带/铺位…（类别：装置/照明/陈设/交互/线索/遮挡）。底注：拖拽即挂到最近场景。
- **运行测试**：青「运行测试」钮 + 结果 `通过：4 节点 / 3 连接 / 0 实体。` + 两徽章 + 小字说明。

### 5. 底部「梦境结构诊断」条
- 左 `结构校验通过`（青绿粗体）或 `N 处结构异常`（红粗体）；中提示语；下诊断列表（每行= 错误/提示 标签 + 消息 + 路径，可点）。

---

## 四、色彩板（唯一取色，暗调承载，主功能色收敛到 3–4 个）

| 语义 | 色值 | 研究台用途 |
|---|---|---|
| 青 social | `#06b6d4` | 唯一高饱和主操作：当前工具、连线、选中描边发光、主按钮、徽标 |
| 蓝 stamina | `#3182ce` | 拖拽合法落点、描线预览、框选、取样高亮 |
| 黄 alert | `#d69e2e` | 选中、视觉遮挡框、素材图标、诊断提示 |
| 红 damage | `#e53e3e` | 物理遮挡框、校验错误、错误脉冲 |
| 橙 action | `#dd6b20` | 过渡窗口、折点描边 |
| 绿 safe | `#38a169` | 结构校验通过 |
| 浅绿 | `#74c28a` | 洼地 |
| 深绿 | `#1a7a3c` | 高地 |
| 面板 | 半透明暗调（冷蓝黑） | 面板底色，让底透一点 |
| 画布底 | 低饱和简笔画（略冷暗调） | 梦境地图 + 网格线 |
| 墨 ink | `#0d1418` | 最深背景/可点暗钮 |
| 灰 muted | `#8fa5ad` | 次要文字 |
| border(暗) | `#2a3a44` | 暗边分隔线 |

主功能色（青/黄/红/蓝/橙/绿）做**边缘发光**，其余大面灰阶暗调承载（`04 §六-5`：同一画面主功能色 ≤3–4，其余灰阶）。

---

## 五、Image-2 提示词（可直接投喂 · v3 短版）

```
In-game UI mockup, 1920x1080, for a Chinese indie dream-builder game: the dream-shaping workbench (筑梦研究台) inside the player's apartment, a warm dim room at night. Pixel-art + sketchy lineart layered style: interactive items are chunky saturated pixel-art, background is low-saturation sketchy lineart, UI panels are semi-transparent over the scene. top-down plan view, 2D, no 3D. NOT a web app / SaaS / browser — no browser chrome, no cards dashboard. Cyan is the only saturated accent; dark muted palette, restrained, slightly cool. Edges glow for interactive items, flat thin lines for inactive. Simplified Chinese UI labels (accurate text not required, layout matters).

Layout: three columns between a top bar and a bottom bar.
- Top bar: left a cyan glowing W badge + title「WakeUp 筑梦台」; center a map name (e.g. 卧铺车厢) + small id; right buttons undo / redo / + / 蓝本 / cyan primary 校验并导出.
- Left panel「梦境蓝图」: list of loaded maps (夜班月台, 卧铺车厢) with paint-bucket small icons; layers 地面层/高架层 rows with height inputs; a small note 当前：地面层; a shortcut key hints table.
- Center: a toolbar of five tools with cyan letter badges and Chinese names: V选择 N放置 E拉边 I取样 P测试. The canvas shows a top-down dream map: rounded dashed scene-boxes each with a name + L/M/S size letter (月台/large, 连接廊/medium, 卧铺车厢/medium, 车顶通道/small); cyan spline edges with arrows, one selected yellow; small white knot dots; a semi-transparent yellow box (visual) and red box (physical) on edges; small dark-green / light-green landform marks; an orange diamond transition window; a small yellow material icon near a scene; a faint dashed draft polyline and dashed selection rectangle; a faint station-platform sketch + moonlight in the background; bottom-left small legend.
- Right panel: inspector fields (名称 尺度 X Y 楼层, or 方向 语义锚点 过渡窗口 遮挡框); a quick-material gallery: collapsed a column of 7 small cards with glowing initial icons, expanded a grid of 70 (7x10) with a filter and a search bar; a run-test button with result badges.
- Bottom bar「梦境结构诊断」: a green「结构校验通过」or red「N 处结构异常」status, a hint line, and a small diagnostics list.

Palette only: cyan, blue, yellow, red, orange, green, muted gray, near-black panel, sketchy low-sat background. No neon bloom, no particles, no 3D.
```

---

## 六、给项目所有者的过目要点

- **v3 三处按你反馈修正**：①提示词**大幅缩短**（之前的版本逐字穷举每个控件文字，Image-2 会不稳定；现在只保证布局与要素位置，文字自排版）；②质感从「黑色科技终端」**改回像素风 + 简笔画**（`01` 画风基线）——暖灯出租屋的筑梦工作台，不是 black-tech 终端；③样图是**设计目标**，素材库恢复「7→70 矩阵 + 分类筛选 + 搜索框」的设计形态（`运营/04 §3.4`），不迁就当前实现只有 8 个样例素材的现状。
- **布局要素全留**：三栏/顶栏/底部诊断条、五工具、画布全部图元（场景框/连线/遮挡/高地洼地/过渡窗/折点/素材/描线/框选）、素材栏 7→70、检查器字段、快捷键——位置与数量都在，只是不再逐字校准字样。
- 出图后你过目：哪块位置/质感/配色/命名要改，我迭代 v4；你拍板后我再对着定稿做消费级前端美工。

---

## 附：相比 v2（研究台终端版）的更改

| 项 | v2（黑色科技） | v3（本版 · 像素简笔研究台） |
|---|---|---|
| 气质 | 暗色近黑荧光的筑梦终端 | 暖灯出租屋里像素+简笔叠加的筑梦工作台 |
| 质感 | 近黑冷蓝半透明暗面板 + 发光 | 半透明暗面板浮于低饱和简笔画背景，边缘发光交互 |
| 文字 | 逐字穷举每个控件字样 | 只定布局与要素，Image-2 自排版 |
| 素材栏 | 8 个样例 + 无筛选（迁就实现） | 7→70 矩阵 + 分类筛选 + 搜索（设计目标） |
| 提示词 | 超长、不稳定 | 大幅缩短（正文提示词 + 简要布局） |
| 铁律 | 无 | 像素+简笔 `01` 基线、俯视平面 2D、≤3–4 主功能色、无网页壳 |

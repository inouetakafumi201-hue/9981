# 素材库 UI 样图 · Image-2/Nano Banana 提示词（v1 · 书架检索台版）

> 用途：把素材库（书架）的 UI 要素编译成一张 1080p 高质感样图，供项目所有者过目、敲定后作为消费级前端美工的一比一实现底稿。
> 依据：`docs/运营系统/07_素材库机制与元状态层全设计.md` §四/五（界面结构 + 蓝本 tab）+ `docs/运营系统/04_局外养成的保险箱与素材库交互.md` §三（检索优先/星标置顶/快捷栏 7→70）+ `docs/创作系统/02_熟悉度与梦境素材库.md`（熟悉度/蓝本/词条边界）+ `docs/表现系统/01`（画风基线）+ `docs/运营系统/07` §12.2（颜色语义）+ `.kiro/specs/wakeup-material-library/design.md` §四.1（图形化提取）。
> 世界观锚点：这是**内嵌在独立游戏里的 UI**，玩家从出租屋驻地的**书架**（`运营/03` §二；靠墙木质书架）进入的**梦境素材库**——检索优先、星标置顶、与地图编辑器/研究台高频切换的创作资源入口。网页感（浏览器 chrome、SaaS 后台、仪表盘堆叠、电商商品墙）是大忌。
> 铁律（v1.1）：**样图 = 设计目标，不是实现快照**——布局要素要齐（双 tab / 类别筛选 / 素材卡片 / 详情浮层 / 蓝本列表 / 快捷栏 7→70 / 切换入口），**文字不逐字**、由 Image-2 自排版；**质感 = 像素 + 全息投影**（对齐地图编辑器全息游戏风，2026-08-19 审美转向已落账 D-083：背景从简笔画升级为全息投影光层，`表现系统/01/00/04` 等权威文档已同步，简笔画为历史基线），**不是暗黑科技终端**；取色只取 tokens，主功能色 ≤3-4，青为唯一高饱和主色，素材库整体偏暖。

---

## 一、定位与质感（先定气质，再讲布局）

### 气质一句话
**出租屋里靠墙一角浮起的「梦境书架」全息投影**——一格一格的书格就是素材卡片，暖琥珀色的光从书脊上泛开。检索优先：你站在书架前找「我要的那块积木」，找到了拿下来，转身就能去造梦舱或研究台。不是电商商品墙，不是素材 App，是「你把在别人梦里记住的东西，以暖光投影收进自己书架」的地方。

> **三界面切换链**（权威语义，`运营/07` §二/§4.2）：素材库是「创作心智三段」的取件口——顶栏即**界面切换入口**。图面右上角须有「回编辑器」（对应编辑器右栏快捷素材栏上方按钮，双向），详情浮层须有「去研究台锻造」小按钮（对应研究台「回素材库」，双向）。两个口位置显眼、常驻，不藏进菜单。

### 质感指令（Image-2 必带）
- **像素 + 全息投影叠加**（对齐地图编辑器全息游戏风）：交互组件/素材卡片 = 高饱和像素（32–64px）；背景/氛围 = **梦境意象以全息投影方式浮现**——书架、木纹、月光、灰尘微粒都做成半透明发光光层（暖琥珀色光），微微泛光、轻微闪烁，像清醒梦里浮起的投影；前景像素 + 全息光层分层渲染，层次清晰。
- **平面 2D UI**：界面是平面布局（无 3D 透视、无 isometric）；素材图标沿用正面俯视视图的剪影语言（平面轮廓 + 落地阴影）。
- **半透明发光浮层**：UI 面板 = 半透明全息浮层（光晕、边缘泛光），让底下的暖光投影透出来（`04` §六-1 质感指令沿用）。
- **边缘发光交互**：可交互物 = 描边 + 内发光（`01` 视觉定律 2），不可交互 = 扁平淡线。
- **克制、暗调、暖**：素材库整体**偏暖**（暖琥珀光），同一画面主功能色 ≤3-4，其余灰阶承载。
- **不出现**：浏览器标签栏/地址栏/滚动条样式的网页壳、登录/注册条、现代 SaaS 侧边导航、亮色卡片堆、金属栅格、霓虹扫描线、发光二极管阵列。它是「游戏内书架的全息投影」，不是网页，不是暗黑科技终端。

---

## 二、画面总览（一屏 1920×1080）

```
┌──────────────────────────────────────────────────────────────┐
│ 顶栏（书架顶）：青发光徽标 W「WakeUp · 梦境素材库」│ 搜索框 │ 回编辑器 │
├──────────┬──────────────────────────────────────────┬─────────┤
│ 左栏     │ 中央主视图：素材卡片网格（星标置顶）        │ 右栏    │
│ （暗面板）│   ┌────┐ ┌────┐ ┌────┐ ┌────┐           │ 详情浮层 │
│ 类别筛选  │   │图标│ │图标│ │图标│ │图标│           │ （点击  │
│ 全部      │   │名  │ │名  │ │名  │ │名  │           │  卡片出）│
│ 我的素材  │   │类别│ │类别│ │类别│ │类别│           │  大图   │
│ 装置      │   │角标│ │角标│ │角标│ │角标│           │  品级   │
│ 照明      │   └────┘ └────┘ └────┘ └────┘           │  词条5槽│
│ 陈设      │                                          │  弱点   │
│ 交互      │   tab 切换：〔可放置元素〕〔地图·蓝本〕     │  星标   │
│ 线索/遮挡 │                                          │  去研究台│
├──────────┴──────────────────────────────────────────┴─────────┤
│ 底部「快捷素材栏」：7 格（最近/高频，一屏速拖）＋ 展开 7×10 矩阵    │
│ 展开时上方浮出：类别筛选 + 搜索框（与素材库共用同一套筛选语义）     │
└──────────────────────────────────────────────────────────────┘
```

---

## 三、逐区要素清单（文字由 Image-2 自排版，逐字不保证，要求"区块 + 要素位置"齐全）

### 1. 顶栏（书架顶 · 界面切换入口）
- 左：青发光方块徽标内白色字母 **W**；旁两行标题（粗）+ 副标题（小字暗）。可写「WakeUp」+「梦境素材库 · 书架」。
- 中：搜索框（暗底无边框，放大镜图标 + placeholder 字样）。
- 右：**回编辑器**小按钮（与编辑器快捷素材栏上方按钮对偶，青色描边发光）。**顶栏即三界面切换链的入口位**：这里只放「回编辑器」，去研究台的入口在详情浮层（§4），两处都常驻、不藏进菜单。

### 2. 左栏（暗面板 · 检索栏）
- **分类筛选**：`全部` / `我的素材`（分栏语义：全部 = 含限免可见，我的素材 = 只列拥有库）/ `装置` / `照明` / `陈设` / `交互` / `线索` / `遮挡`。
- 当前选中项 = 青左条 + 淡青晕；未选中 = 暗字。

### 3. 中央主视图（素材卡片网格）
- 顶部 **tab 切换**：`可放置元素`（积木）/ `地图·蓝本`（整套房子）——两 tab 语义完全不同，切换清晰。
- **可放置元素 tab**：素材卡片网格，卡片 = 像素图标（正面俯视剪影）+ 名称 + 类别小字 + **角标**：
  - 限免（绿）/ UGC（青）/ 合成（金银高光）/ 已改动（橙小点）/ 星标（黄）。
  - 星标卡片排在同筛选栏首行（视觉上更靠前、更亮）。
  - 悬停 = 边缘发光（青或类别色），浮出名称/类别/角标详情。
- **地图·蓝本 tab**：每行 = 地图封面缩略图 + 地图名 + 「N 场景」小字 + 右侧**熟悉度进度条（0-100%）**：
  - 未满 = 封面灰暗剪影 + 进度条 + 「还差 X%」小字；
  - 满 100% = 封面亮起 + 「可在编辑器选作蓝本」徽章（青）；
  - **已解锁行可点开蓝本详情**（该梦的完整蓝图预览，只读）；未解锁行点击 = 提示「熟悉度满 100% 解锁」。

### 4. 右栏（详情浮层）
- 点击卡片后浮现：**大图**（像素图标放大 + 品级色描边：灰白/绿/蓝/银/金）+ 名称 + 类别 + 品级。
- **词条挂载展示**：5 槽（属性/技能/状态/防御/机动），有词条 = 词条徽章（品质色描边），空槽 = 灰「无」。底部小字「看到 ≠ 拥有，词条在研究台」。**词条徽章可点击**（切到研究台词条库定位该词条——图面用一个小「→」角标暗示可跳转，不逐字）。
- **弱点裂缝**（合成物显示）：一行暗红小字或图标（如「易蚀」）。
- **限免说明**（限免素材显示）：绿字「摆图可用，不进入你的拥有库」。
- 底部按钮：**星标**（黄星图标，激活 = 填色发光）+ **去研究台锻造**（青主按钮，小，强发光）。

### 5. 底部「快捷素材栏」
- 未展开：**7 格**横向一排（最近/高频素材，只有图标，悬停浮出名称/类别/角标）。
- 展开：**7×10 全库矩阵**（图标网格，悬停浮详情）+ 上方浮出**类别筛选 + 搜索框**。
- 限免素材拖拽到快捷栏 = 落点红闪拒绝；UGC 素材在快捷栏中灰显不可拖（悬停提示「UGC 素材请到研究台处理」）。

---

## 四、色彩板（唯一取色，暗调承载，主功能色收敛到 3-4 个）

| 语义 | 色值 | 素材库用途 |
|---|---|---|
| 青 social | `#06b6d4` | 唯一高饱和主色：W 徽标、回编辑器、去研究台主按钮、当前筛选左条、蓝本徽章、UGC 角标 |
| 绿 safe | `#38a169` | 限免角标、限免说明文字 |
| 金/银 | `#d4af37` / `#a8b2bd` | 合成物品级高光、品质 4-5 描边 |
| 橙 action | `#dd6b20` | 已改动角标（小点）、合成进度 |
| 黄 alert | `#d69e2e` | 星标（填色发光） |
| 红 damage | `#e53e3e` | 弱点裂缝小字、拖拽拒绝红闪（边界色，不做惩罚感） |
| 灰白 | `#f3f4f6` | 可交互但受制于状态（UGC 灰显、空槽「无」） |
| 墨/面板 | 半透明暗调（暖黑） | 面板底色，让暖光全息投影透一点 |
| 暖光投影底 | 低饱和暖琥珀光层（书架 + 月光 + 灰尘微粒的全息投影） | 梦境意象以全息方式浮现，不是手绘简笔画 |
| 灰 muted | `#627383` | 次要文字（类别小字、场景数） |
| border(暗) | `#2a3a44` | 暗边分隔线 |

主功能色（青/绿/黄/橙/红）做**边缘发光**，其余大面灰阶暗调承载。

---

## 五、Image-2/Nano Banana 提示词（可直接投喂 · v1 短版）

```
In-game UI mockup, 1920x1080, for a Chinese indie dream-builder game: the dream material library (梦境素材库) as a holographic projection of a bookshelf inside the player's apartment at night, a warm dim room. Pixel-art foreground + holographic projection background: interactive items / material cards are chunky saturated pixel-art; the backdrop is the bookshelf, wood grain, moonlight and floating dust rendered as soft translucent warm-amber holographic light layers with faint glow and gentle shimmer — like a lucid-dream projection, NOT hand-drawn sketch, NOT a dark tech terminal. Flat 2D UI, no 3D perspective, no isometric. NOT a web app / SaaS / browser — no browser chrome, no cards dashboard, no e-commerce grid. Cyan is the only saturated accent; dark muted palette with warm amber holographic tones, restrained. Edges glow for interactive items, flat thin lines for inactive. Simplified Chinese UI labels (accurate text not required, layout matters).

Layout: top bar, left filter panel, center card grid, right detail overlay, bottom quick bar.
- Top bar: left a cyan glowing W badge + title「WakeUp · 梦境素材库」; center a dark search box; right a small cyan-outlined button 回编辑器 (this top bar is the interface-switch entry, always visible).
- Left panel: category filter list 全部 / 我的素材 / 装置 / 照明 / 陈设 / 交互 / 线索 / 遮挡, current item with cyan left bar + soft glow.
- Center: two tabs 可放置元素 / 地图·蓝本.
  - Elements tab: a grid of material cards, each = pixel icon (top-down silhouette), name, category small text, and small corner badges (green 限免 / cyan UGC / gold-silver 合成 / orange dot 已改动 / yellow star). Starred cards float to the first row, brighter.
  - Blueprint tab: list rows, each = map cover thumbnail + map name + 「N 场景」+ a familiarity progress bar (0-100%). Unlocked rows: cover lit + cyan badge 可在编辑器选作蓝本, clickable to open a read-only blueprint preview; locked rows: gray silhouette + 「还差 X%」.
- Right overlay (opened by clicking a card): large pixel icon with quality-colored border, name, category, 5 token slots (属性/技能/状态/防御/机动; filled = small badges clickable with a tiny arrow hint = jumps to bench token library, empty = gray 无), a weakness line (dark red), green 限免 note for free items, and two buttons: yellow star 星标 and cyan primary 去研究台锻造.
- Bottom quick bar: collapsed = 7 square icon slots; expanded = 7x10 icon matrix with a filter + search row on top.
```

---

## 六、给项目所有者的过目要点

- **v1 定稿方向**：素材库的「书架感」是第一眼气质——检索优先、星标置顶、双 tab（积木 vs 整套房子）语义分开、详情浮层承载「看到 ≠ 拥有」、快捷栏 7→70 与编辑器共享。
- **布局要素全留**：顶栏搜索 + 回编辑器、左栏分类筛选（含全部/我的素材分栏）、中央双 tab、详情浮层（大图/词条 5 槽/弱点/限免/星标/去研究台）、底部快捷栏 7→70——位置与数量都在，文字不逐字。
- **配色收敛**：青唯一高饱和 + 绿（限免）/黄（星标）/橙（已改动）做边缘发光点缀，金银只作品级高光，其余灰阶暗调承载（`01` 视觉定律）。
- 出图后你过目：哪块位置/质感/配色/命名要改，我迭代 v2；你拍板后我再对着定稿写/接线消费级前端（`docs/v0-dev-material-library-spec.md` 已就绪）。
- 出图方式：配好 `GEMINI_API_KEY` 后跑 sprite-forge nano-banana（参考 `README_设计图生成指南.md`），或复制上方短提示词到 Image-2/Midjourney/DALL-E。

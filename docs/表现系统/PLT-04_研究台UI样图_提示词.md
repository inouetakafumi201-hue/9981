# 研究台 UI 样图 · Image-2/Nano Banana 提示词（v1 · 材料工作台版）

> 用途：把研究台（原锻造台，权威名）的 UI 要素编译成一张 1080p 高质感样图，供项目所有者过目、敲定后作为消费级前端美工的一比一实现底稿。
> 依据：`docs/运营系统/07_素材库机制与元状态层全设计.md` §六（词条库/锻造/合成仪式/塑形栏）+ `docs/运营系统/06_素材记忆与消耗系统.md` §三/四/五（词条品质色/改枪式 5 槽/合成仪式/塑形 HUD）+ `docs/表现系统/01`（画风基线）+ `docs/运营系统/07` §12.1-12.4（质感定位/颜色语义/低心智约束）+ `.kiro/specs/wakeup-material-library/design.md` §四.2（图形化提取）。
> 世界观锚点：这是**内嵌在独立游戏里的 UI**，玩家从出租屋驻地的**研究台**（`运营/03` §二；素材级工作台）进入——**游戏化、仪式感、材料工作台**：「改枪工作台 + 材料收集册」——边上是排开的槽位、底下是科技感长条框，合成有仪式演出。它是「把你攒的东西变成你的作品」的地方。网页感（浏览器 chrome、SaaS 后台、工程软件属性面板）是大忌。
> 铁律（v1.2）：**样图 = 设计目标，不是实现快照**——布局要素要齐（词条库五类/锻造台 5 槽/组合预览/素材快捷栏（共享）/塑形栏 5 格/合成仪式），**文字不逐字**、由 Image-2 自排版；**质感 = 像素 + 全息投影**（对齐地图编辑器全息游戏风，2026-08-19 审美转向已落账 D-083：背景从简笔画升级为全息投影光层，`表现系统/01/00/04` 等权威文档已同步，简笔画为历史基线），**不是暗黑科技终端**；取色只取 tokens，主功能色 ≤3-4。

---

## 一、定位与质感（先定气质，再讲布局）

### 气质一句话
**暖灯出租屋里浮起的一张「材料工作台」全息投影**——像游戏化的改枪台 + 一本摊开的材料收集册。台面上排开五个槽位（属性/技能/状态/防御/机动），词条卡片像收集册里亮起的一格格卡牌，底下一条科技感长条框（塑形备选栏）横贯，都是半透明暖光光层。合成不是抽卡，是郑重交付：点下「合成」那一刻，全屏跳进发光的锻造门。不是冷冰冰的工程软件，是「把材料变成我的作品」的仪式。

### 质感指令（Image-2 必带）
- **像素 + 全息投影叠加**（对齐地图编辑器全息游戏风）：交互组件/词条卡/素材图标 = 高饱和像素（32–64px）；背景/氛围 = **工作台意象以全息投影方式浮现**——台面、木纹、工具剪影、暖灯都做成半透明发光光层，微微泛光、轻微闪烁，像清醒梦里浮起的投影；前景像素 + 全息光层分层渲染，层次清晰。
- **平面 2D UI**：界面平面布局（无 3D 透视、无 isometric）；素材/词条图标沿用正面俯视视图的剪影语言（平面轮廓 + 落地阴影）。
- **半透明发光浮层 + 材质**：面板 = 半透明全息浮层（光晕、边缘泛光）让底透一点；可交互物 = 描边 + 内发光（`01` 视觉定律 2），不可交互 = 扁平无高光。
- **游戏化、仪式感**：不是工具感三栏工作台（那是地图编辑器）；是「收集 → 锻造 → 合成」的节奏感。
- **克制、暗调、略暖**：研究台暖台面 + 青主操作；主功能色 ≤3-4，其余灰阶承载。
- **不出现**：浏览器标签栏/地址栏/滚动条样式的网页壳、现代 SaaS 属性面板、亮色卡片堆、金属栅格、霓虹扫描线、发光二极管阵列。它是「游戏内材料工作台的全息投影」，不是网页，不是暗黑科技终端。

---

## 二、画面总览（一屏 1920×1080，锻造台主视图）

```
┌──────────────────────────────────────────────────────────────┐
│ 顶栏（工作台头）：青发光徽标 W「WakeUp · 研究台」│ 词条库 锻造台 │ 回素材库 │
├───────────┬─────────────────────────────────────┬────────────┤
│ 左栏      │ 中央：锻造工作台                     │ 右栏       │
│ 词条库面板 │  基体：手枪（当前锻造素材，拥有库）    │ 素材快捷栏  │
│ （材料收   │  槽位（五大类，固定 5）：             │ 7 格 + 展开│
│  集册）    │  [属性] 烈焰(底图印字)               │ （与素材库/ │
│ 五大类标签 │  [技能] 快拔(底图印字)               │  编辑器共享）│
│ 属性 技能  │  [状态] 空                          │            │
│ 状态 防御  │  [防御] 空                          │            │
│ 机动       │  [机动] 空                          │            │
│ 卡牌网格   │  右侧组合预览：当前挂载词条语义清单    │            │
│ 已收集亮起 │  （烈焰：造成火焰伤害，对易燃目标…）   │            │
│ 未收集剪影 │  底部动作排：[提取] [保存·派生] [合成] │            │
│ 每类进度   │   （合成 = 青主按钮）                 │            │
├───────────┴─────────────────────────────────────┴────────────┤
│ 底部「塑形备选栏」：科技感独立长条框 · 固定 5 格                 │
│  [槽1 解锁][槽2 解锁][槽3 解锁][槽4 锁定🔒][槽5 锁定🔒]          │
└──────────────────────────────────────────────────────────────┘
  （合成仪式 = 全屏覆盖层：发光锻造门 → 3 台子熔炼/主锻造/铭刻 → 高光爆发）
  （提取演出 = 素材溶解 → 词条浮现；合成队列条 = 1 进行中 + N 排队 + 加急）
  （注：词条从左侧词条库直接拖入中央槽位，无词条快捷栏；无火力/射程强度条）
```

---

## 三、逐区要素清单（文字由 Image-2 自排版，逐字不保证，要求"区块 + 要素位置"齐全）

### 1. 顶栏（工作台头）
- 左：青发光方块徽标内白色字母 **W**；旁两行标题（粗）+ 副标题（小字暗）。可写「WakeUp」+「研究台 · 材料工作台」。
- 中：分区切换 **词条库 / 锻造台**（当前锻造台，青底发光）。
- 右：**回素材库**小按钮（青色描边发光，与素材详情页「去研究台锻造」对偶）。

### 2. 左栏（词条库 · 材料收集册）
- **五大类标签页**：`属性` / `技能` / `状态` / `防御` / `机动`（每类一个语义色系小标签，当前类亮起）。
- 每类顶部：**收集进度**（如「5 / 22 已收集」）。
- **卡牌网格**：
  - 已收集（owned:true）= 词条卡亮起——像素图标 + 名称 + 品质色描边（灰白/绿/蓝/银/金）+ 简介小字 + 收集时间；
  - 未收集 = 灰暗剪影 + 中央「？」占位（能看到「这格是什么」的轮廓，但拿不到）。
- 词条卡可星标（黄）、可拖拽（**直接拖进中央锻造槽位**；研究台无词条快捷栏，2026-08-19 定案）。

### 3. 中央（锻造工作台 · 改枪式 5 槽）
- **基体**：当前锻造素材（来自拥有库），像素大图标 + 名称（如「手枪」）。
- **槽位（五大类，固定 5 个）**：`[属性] [技能] [状态] [防御] [机动]`，每槽 1 个词条，不能双重强化。
  - **底图感**：槽位可能预先印有默认词条（素材自带），像一张底图上印好的字；拖新词条进来 = 盖上去。
  - 空槽 = 灰「+」占位（可拖入填充；填充后只能替换、不能变回空，除非拖回恢复默认）。
  - 拖拽非法落点（限免素材） = 红闪拒绝。
- **右侧组合预览**：当前槽位组合的**词条语义清单**——每个已挂载词条一行「名称 + 机制话术简介」（如「烈焰：造成火焰伤害，对易燃目标额外效果」），空槽显示「未挂载」。强调「你正在设计的是什么样的机制」。**不设火力/射程/机动强度条**——不模仿普通改枪界面的数值强度（那会削弱对自主设计机制的强调，2026-08-19 定案）。
- **底部动作排**（从左到右）：**提取**（暗钮，提取 = 烧掉该素材得词条，触发「素材溶解 → 词条浮现」演出）/ **保存 · 派生**（改动过的素材 `modified:true` 后可二选一：保存覆盖自身 / 派生新 ID + 溯源）/ **合成**（青色主按钮，强发光，触发全屏合成仪式）。

### 4. 右栏（素材快捷栏 · 与素材库/编辑器共享同一份）
- 7 格（未展开，只有图标，悬停浮出名称/类别/角标）+ 展开 7×10 全素材库矩阵（类别筛选 + 搜索，与素材库共用同一套筛选语义）。
- **数据共享**：与地图编辑器、素材库是**同一份** `quickBar.materialSlots`——在素材库/研究台配置的 7 格，切回编辑器立即生效。
- **研究台用途**：拖素材到塑形备选栏配置、换锻造基体、把常用素材置顶待用。
- **研究台没有词条快捷栏**（2026-08-19 定案）：词条从左侧词条库直接拖入锻造槽位（拖拽距离近，不设第二套词条容器）。

### 5. 底部（塑形备选栏）
- 科技感**独立长条框**，横贯锻造界面最下方，**固定 5 格**。
- 解锁格（亮，可拖入素材，拖入替换、无删除）；未解锁格（扁平灰 + **锁图标**，不可交互）。

### 6. 合成仪式（全屏覆盖层，不在主画面内，标注位置即可）
- 点「合成」→ 全屏跳进**发光的锻造门/闸口**（梦境科技质感）→ 进入 **3 个台子**的合成 UI：
  - 左侧 = 材料熔炼 / 中央 = 主锻造 / 右侧 = 铭刻；
  - 组件悬浮上下摆动 → 时而突然高速旋转（带运动模糊）→ 粒子缓缓划过（电焊火花/能量流）；
- 完成 = **高光爆发 + 成品浮现** → 点击成品弹面板 → 「收下」按钮；
- 失败/驳回 = 成品**变灰**（不是爆炸/惩罚感）→ 点开面板 → 解释逻辑（「这个组合差点意思」「材料之间不太合」）→ 「确定」后材料返还。
- **合成队列条**（覆盖层或锻造台侧缘）：1 个进行中 + N 个排队，每个 job = 基体图标 + 词条数 + 状态（进行中/排队/完成/失败），可「加急」（花记忆碎片插队，界面只做按钮 + 置顶动画）。

---

## 四、色彩板（唯一取色，暗调承载，主功能色收敛到 3-4 个）

| 语义 | 色值 | 研究台用途 |
|---|---|---|
| 青 social | `#06b6d4` | 唯一高饱和主色：W 徽标、分区切换当前项、回素材库、可拖拽素材悬停发光、合成门/能量流 |
| 金/银 | `#d4af37` / `#a8b2bd` | 品级高光（词条卡品质 4-5 描边、合成物） |
| 橙 action | `#dd6b20` | 进行中/消耗：锻造槽位有词条状态、合成进度、塑形栏状态、已改动 |
| 黄 alert | `#d69e2e` | 星标、警戒类提示 |
| 红 damage | `#e53e3e` | 合成失败解释边界色、非法拖拽红闪（不做惩罚感） |
| 绿 safe | `#38a169` | 收集完成/解锁格亮起（正面） |
| 灰白 | `#f3f4f6` | 可交互但受制于状态：UGC 灰显、未解锁塑形格 |
| 墨/面板 | 半透明暗调（冷蓝黑） | 面板底色，让台面木纹透一点 |
| 墨/面板 | 半透明暗调（暖黑） | 面板底色，让暖光全息投影透一点 |
| 暖光投影底 | 低饱和暖光层（台面木纹 + 工具剪影 + 暖灯的全息投影） | 工作台意象以全息方式浮现，不是手绘简笔画 |
| 灰 muted | `#627383` | 次要文字（简介小字、收集时间） |
| border(暗) | `#2a3a44` | 暗边分隔线 |

主功能色（青/橙/黄/红/金/银）做**边缘发光**，其余大面灰阶暗调承载。

---

## 五、Image-2/Nano Banana 提示词（可直接投喂 · v1 短版）

```
In-game UI mockup, 1920x1080, for a Chinese indie dream-builder game: the research bench (研究台) inside the player's apartment at night, a warm dim room. A gamified material workbench, like a gun-modding station + an open material collection book. Pixel-art foreground + holographic projection background: interactive items / token cards / icons are chunky saturated pixel-art; the backdrop is the workbench, wood grain, warm lamp and tool silhouettes rendered as soft translucent warm holographic light layers with faint glow and gentle shimmer — like a lucid-dream projection, NOT hand-drawn sketch, NOT a dark tech terminal. Flat 2D UI, no 3D perspective, no isometric. NOT a web app / SaaS / engineering software — no browser chrome, no property panels, no cards dashboard. Cyan is the only saturated accent; dark muted palette with warm holographic tones, restrained. Edges glow for interactive items, flat thin lines for inactive. Simplified Chinese UI labels (accurate text not required, layout matters).

Layout: top bar, left token-collection panel, center forging bench, right token quick bar, bottom molding strip.
- Top bar: left a cyan glowing W badge + title「WakeUp · 研究台」; center two section tabs 词条库 / 锻造台 (current 锻造台 lit cyan); right a small cyan-outlined button 回素材库.
- Left panel (material collection book): five category tabs 属性 技能 状态 防御 机动; each category shows a progress note (e.g. 5/22 已收集) and a card grid: collected tokens = lit cards with pixel icon, name, quality-colored border (gray/green/blue/silver/gold), small description, collection time; uncollected = dark silhouettes with a center "?" mark (you can see the shape but not take it). Cards can show a yellow star.
- Center forging bench: a base material (e.g. 手枪 pixel icon + name); five fixed slots labeled 属性 技能 状态 防御 机动, each holding one token — some slots pre-printed with default tokens like 烈焰 / 快拔 (like words printed on a base image, dragging a new token covers them), empty slots = gray "+" placeholders; a right-side combo preview panel listing the currently attached tokens as semantic lines (name + short mechanic description, e.g. 烈焰：造成火焰伤害 — NO weapon stat bars like 火力/射程, no gun-modding strength meters); a bottom action row: 提取 (dark button, extract = burns the material into a token, triggers a dissolve-to-appear ritual), 保存·派生 (save-overwrite / derive-new-id choices for modified materials), and 合成 (cyan primary button, triggers the full-screen ceremony).
- Right panel: a material quick bar SHARED with the map editor and the material library (same 7 icon slots, expanded = 7x10 material matrix with a category filter row); tokens are dragged directly from the left token-collection panel into the forge slots — there is NO token quick bar.
- Bottom: a tech-looking horizontal strip 塑形备选栏 with exactly 5 slots: first three lit/unlocked, last two flat gray with a lock icon (inactive).
- Note (overlay, not in main frame): the synthesis ceremony = a full-screen glowing forging gate → 3 stations (left smelting / center main forging / right engraving) with floating, spinning, spark particles → a bright flash reveal; a synthesis queue bar (1 running + N queued jobs, each = base icon + token count + status, with a rush button); an extract ritual (material dissolves → token emerges).
```

---

## 六、给项目所有者的过目要点

- **v1 定稿方向**：研究台第一眼是「材料工作台」不是「工程软件」——词条库 = 收集册（已收集亮/未收集剪影/收集进度）、锻造台 = 5 槽 + 底图感 + 右侧组合预览（2026-08-19 由「数值栏」改定，D-084）、底部塑形备选栏 = 独立科技长条框、合成 = 全屏仪式演出。
- **布局要素全留**：顶栏分区切换 + 回素材库、左栏词条库五类 + 收集进度 + 卡牌网格、中央基体 + 5 槽 + 组合预览 + 底部动作排（提取 / 保存·派生 / 合成）、右栏素材快捷栏 7→70（与素材库/编辑器共享）、底部塑形栏 5 格（含锁）、合成仪式全屏覆盖层 + 提取演出 + 合成队列条（1 进行中 + N 排队 + 加急）——位置与数量都在，文字不逐字。
- **2026-08-19 两处修正**：①右栏从「词条快捷栏」改为「素材快捷栏（与素材库/编辑器共享）」——研究台**没有词条快捷栏**，词条从左侧词条库直接拖入槽位；②去掉改枪式强度数值栏（火力/射程条），改为「组合预览」——列出当前挂载词条的语义（名称 + 机制话术），强调自主设计机制，不模仿普通改枪界面。
- **配色收敛**：青唯一高饱和 + 橙（进行中/消耗）+ 黄（星标）+ 金银（品级高光），红只作失败解释边界色，其余灰阶暗调承载。
- **与素材库的区分**：素材库 = 检索清爽书架感；研究台 = 游戏化仪式感材料工作台（`运营/07` §12.1 四界面质感定位）。两张样图气质必须拉开，不共用同一套布局皮肤。
- 出图后你过目：哪块位置/质感/配色/命名要改，我迭代 v2；你拍板后我再对着定稿写/接线消费级前端（`docs/v0-dev-bench-spec.md` 已就绪）。
- 出图方式：配好 `GEMINI_API_KEY` 后跑 sprite-forge nano-banana（参考 `README_设计图生成指南.md`），或复制上方短提示词到 Image-2/Midjourney/DALL-E。

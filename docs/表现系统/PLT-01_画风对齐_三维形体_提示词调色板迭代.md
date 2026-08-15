---
name: "PLT-01 画风对齐·主角三维形体·提示词调色板迭代"
labels: [表现系统, sprite-forge, 画风对齐, AI迭代]
status: "迭代中 / waiting：运行调色板"
created: 2026-08-15
auditor: 项目所有者
toolchain: skill `sprite-forge`（Codex 原味跑法 / Nano Banana 适配路径，共用同一套本地后处理）
trigger: 项目所有者「把需求写成文档，用 sprite-forge 暴力出图迭代画风基底」
scope: 表现系统目录 · 产物=调色板/留档/您的肉眼裁决，不碰 src/
---

# PLT-01 · 画风对齐·主角三维形体·提示词调色板

〔给后续会话/迭代者的入口〕在任何进一步的视觉工作之前，先在**我（3D 造型）这一层**对齐。
本文件只产**提示词、批次、留档与筛选**；产出到底定不定、定哪张，一律由**项目所有者肉眼裁决**。
可运行、可留档、可复现；美术选型在任何一层定格前，都先被本文件这个「调试器」刷一遍。

## 视角与朝向（铁律，写进所有提示词的骨架）

- **视角 = 正面斜投影 (Cabinet / Cavalier Projection)**，类比说明：类似正面斜投影风格（D-025：规范名称是"正面斜投影"）。固定唯一，不换其它。
  - 角色**正面朝向镜头**，斜投影把**侧面**也画出来（纵深折向画面外一侧），"又朝前又能见侧面深度"。
  - **不是 45° 向东/向西扭转的侧身。** 之前用的 "three-quarter / 斜侧" 之类模糊词一律废止，词意太开。
- **口令（两份表述任一）**：`front-facing with Cabinet/cavalier oblique projection of the side` 或
  `front-facing oblique (cavalier) projection`（D-025：AI 提示词可用类比辅助，但规范名称统一为"正面斜投影"）。
- 权威在 `01_图形化与UI` §视觉风格定位·正面斜投影（本项目唯一权威口径）；地图同此法则。

## 运行环境（谁来做、要不要 API key）

- **默认：`sprite-generate.py`（gpt-image-2 经 `tools/.env`）**。这是 sprite-forge 的默认后端，
  不需要 Codex。调用 `python .agents/skills/sprite-forge/tools/sprite-generate.py generate
  --rows 1 --cols 1 --out <图>`，key 从 `.env`（已 gitignore）自动读。
- **备选：Nano Banana(gemini)**：`sprite-generate.py generate --provider gemini ...`（需
  `google-genai`，模型默认 `gemini-3.1-flash-image-preview`）。
- **兜底：Codex 原味跑法**：把 `.agents/skills/sprite-forge/generate2dsprite/` 拷到 Codex
  skills 目录，对 Codex 说「use generate2dsprite to …」用其内置出图。三种跑法共用同一套
  后处理脚本，产出一致。

---

## 〇、为什么是这条路线（背景，不回退）

- 项目需要一个能支撑**跳跳式移动+整体可压缩可旋转**的主角形态。
- 逐帧变形动画是核心识别度，**不设骨骼、不做关节旋转**（全屏动画同样不凭空加骨骼，用单张张力图/特效）。
- 主角**接近人形、无腿**；视觉重心在**中部**；身体底部**被垂落的衣物下摆完全包住贴地**（遮盖式，非「一体实心收口」——一体收口会像棋子一样下方粗大）。
- 拖地不能过长，否则跳起违和；「拖长」用**拉高人物比例**表达，不用裙摆撑地。
- 画师路线两头难（低成本难沟通、高成本版权扯皮、听 AI 炸毛）→ 短期**用 AI 反推画风基底**：暴力出图+提示词留档+肉眼迭代，定稿后跑 base sheet；稳定性不稳→训 LoRA，稳→保留提示词组合。后续画师合作以此为「形态语法锚点」。

## 设置（分三种，各自留档）

- **S1 · 静态单图**：`--rows 1 --cols 1 --cell 1024` —— 用来先看「这个形态长什么样」，最省、最快、最直观，**首轮主力**。
- **S2 · 待机微动画**：`--rows 2 --cols 2 --cell 384` —— 2 帧微态变化。三轴收敛后，用它看「形态在轻动作下是否稳」。
- **S3 · base sheet 视角**：`--rows 3 --cols 2 --cell 384` —— 正面/侧面/背面 + 顶点方向，**最后阶段**跑。

> S1 与 S3 的提示词措辞**共用同一套骨架**，只换 rows/cols 与「视图」词。在调色板骨架里，静态视图与 sheet 视图用占位符区分，保证「S1 挑中的那张，能直接升成 S3 的规范视角」——这正是 base sheet 的由来。

## 固定骨架（所有提示词的公共底盘，先对齐、后变化）

```
Pixel-art 64x64, near-humanoid single character, high saturation, bold readable silhouette.
[VIEW+CUE 铁律: 正面斜投影(Cabinet/Cavalier)]
Front-facing with Cabinet/cavalier oblique projection of the side: the figure
faces the camera head-on while the side is drawn obliquely folding outward, giving depth without
turning 45 degrees east/west. Not three-quarter, not isometric.
[CORE: 无腿+遮盖式落地+中部重心的本质]
Body tapers into a soft closed bottom that stands directly on the floor, weight sits at the mid-body,
completely concealing any legs. The visible lower silhouette is full and grounded (NOT a hollow or a
cut-off torso; not a tall skirt dragging on the floor). Garment hem is short and sits on the ground,
so a jump reads as a single intact mass lifting, never trailing fabric.
[STYLE: 现代表达]
Modern gray-ground casual-to-formal garment. Low-key urban realism with a subtle edge,
Z-style muted cool palette, no gore, no fantasy armor.
[OUTLINE+ANATOMY 防御语: 关节规则]
Clear body outline. No visible joints or knees; limbs (arms/head) stay articulate; forearms & face
clearly readable. Head distinct from torso. Proportions taller than 1:1.
{RENDER 兜底: 上网格+品红背景的公共约定,由 skill 内建,提示词不写死}
Background: 100% solid flat magenta (#FF00FF).
```

- `[VIEW+CUE]` **铁律**：正面斜投影 (Cabinet/Cavalier)（D-025：规范名称，AI 提示词可用类比辅助）；非 45° 侧身、非斜侧、非 isometric。

- `[CORE]` 是**不可动摇的形态律**：无腿、遮盖式落地、重心中部、整体实心非中空、下摆短不拖地。
- `[STYLE]` 是**可迭代的**（本次给现代灰色倾向，走“都市灰调”阵营）。
- `[OUTLINE+ANATOMY]` 防御语：出图方向差时往上提（见 §五诊断）。
- `{RENDER}` 由 skill 内建拼接，不是我们要写的词。

## 调色板（每行=一条**静态单图 S1**）

默认用 **gpt-image-2**（见 §〇/§运行环境），按后面「示例命令」把每个变体提示词交给
`sprite-generate.py generate --rows 1 --cols 1`（**一张一遍，别开多格**）。产物落在
`run/plt01/{维度}/`。留档 = 图 + 对应 `.raw.json`（skill 自动写），这正是「提示词留档」。

示例提示词（S1 静态单图，对应 §三「体态·重心」行，已含正面斜投影+朝向）——

```
Pixel-art 64x64, near-humanoid single character, high saturation, bold readable silhouette.
Three-quarter view (slight top-down), character turned diagonally and facing slightly to the side
of the camera, clearly directional, never flat front-on. Body tapers into a soft closed bottom
standing directly on the floor, weight sits at the mid-body, completely concealing any legs;
the visible lower silhouette is full and grounded (not a hollow or cut-off torso). Garment hem short,
sits on the ground, so a jump reads as one intact mass lifting, never trailing fabric.
Modern gray-ground casual-to-formal garment, low-key urban realism, Z-style muted cool palette,
no gore, no fantasy armor. Clear body outline, no visible joints or knees, limbs articulate,
face clearly readable. Head distinct from torso, tall proportion, full body visible, centered.
```

> 走**默认 gpt-image-2** 跑这段 S1 单图：
> `python .agents/skills/sprite-forge/tools/sprite-generate.py generate --rows 1 --cols 1
> --prompt "<上图 prompt>" --out run/plt01/pista-font/{变体}.png`。
> **每次只出单张**（`--rows 1 --cols 1`），别一次多张。切 Nano Banana(gemini)：加 `--provider gemini`。
> (留档清单 §三为唯一全集,变体只换 `[STYLE]`/`[VIEW+CUE]` 的朝向词,不作多格。) 

---

## 三、留档清单（Run 1 / 目录 `run/plt01/`）

> Run 0 / Run 2 教训汇总（2026-08-15）：
> - Run 0 全否——prompt 把"无腿"写成"盖腿"，模型仍画正常人形，且用正前平视。
> - Run 2 除了 e1/e6 外不可用；且**视角错误**——用了模糊 "three-quarter view"，模型画出 45° 侧身。
> - **视角定案 = 正面斜投影 (Cabinet/Cavalier)**：正面朝镜头 + 斜投影出侧面，
>   不是 45° 侧身（D-025：项目所有者正式声明此规范名称，本项目唯一视角，地图同用）。
> - Run 2 确认可用形态：e1-sack-hood（连帽袋）+ e6-detective-flow（侦探衣摆）——下一步按这两张
>   做 32×32 斜投影收敛。
>
> 由 **auditor 项目所有者**过目。每一行：**留档目录** → **这条要测的东西** → **变体** → **肉眼关注点**。
> 每个变体 = 一条 `sprite-generate.py generate --rows 1 --cols 1`（**单张**）。
>
> 本清单即「留档 + 归档」本体。每次出图后核对路径/`.raw.json`；**未跑到的行 = 尚未出图的候选方向**。

| 维度 | 留档目录 | 条 想要验证 | 观测点 |
|---|---|---|---|
| **体态·重心** | `pista-font/` | 重心中部/下收的「整体实心落地」 | 有没有「棋子」感？下摆是否短、不下垂太远？ |
| **体态·下收边界** | `pista-font/` | 身形收口到落地的高度 | 落地是否是一道短而干净的底缘？ |
| **服装·职业体面** | `casual-formal/` | 偏正式现代装（西装/大衣） | 衣摆能否遮盖贴地、不显腿；配色灰调是否成立 |
| **服装·街头个体** | `casual-formal/` | 偏休闲现代装（工装/夹克） | 低饱和都市感，无军事/SF 味 |
| **配色·灰调单色** | `neutral-palette/` | 低饱和中性灰为主调，用灰、炭、冷蓝点缀 | Z 代炫酷感来自哪；是否「灰而冷」而非「脏灰」 |
| **配色·品红漂移** | `neutral-palette/` | 偶然把衣内「紫/珊瑚」当作点缀尝试 | 是否和世界观（UGC 青、梦境奶白）冲突 |
| **密度·瘦/贴** | `slim-density/` | 偏瘦长、贴身剪裁 | 是否仍「完整实心」而非皮包骨 |
| **密度·厚/重** | `slim-density/` | 偏宽厚重磅、宽松剪裁 | 下摆是否可控（不拖地）；重心感可读 |

> 若要用待机微动画/S3 base sheet，见 §二设置，同骨架换 rows/cols/视图词。

## 四、迭代循环（每轮：出图 → 您裁决 → 收敛）

1. **Run 0** = 弹出上面整张表（12 条）。
2. **您筛选**：对每条目测打分 0–5（无关/完全贴合），挑出「方向对但各有缺陷」的几条。
3. **锁定候选**：对命中的 1–2 条，做**加权提示词混合**一次：
   - 例：`--prompt "<候选A的STYLE> : <候选B的STYLE> : 0.5"`（合成插值），或对唯一负责的 `sprite-forge` 用 `--reference` 图生图局部重绘。
   - 每轮留档路径 `run/plt01/{维度}/{runN}/`，`.json` 记录加权比。
4. **收束**：一旦您看中**一张**「贴得最近」的形态 →
   - 升成 **S3**`base sheet` 视角（`--rows 3 --cols 2`：正面/侧面/背面/顶点方向）。
   - 得到**形态语法锚点**，喂 AI 迭代 + 后续画师合作参考。
5. **结算持久性**：
   - 若**不稳**（同一提示词连出多次漂移）→ **训 LoRA** 锁风格；
   - 若**稳** → 保留提示词组合，不进 LoRA。

## 五、诊断（提示词层调参，不走入门槛）

| 症状（您看到的残缺） | 处理（往「骨架」里补/替换） |
|---|---|
| 出现了腿/脚 | 原样保留。是否显现=提示词未被尊重。先提 `body tapers into a soft closed bottom ... no legs`，再提 `concealing any legs`；若仍出腿 → **换 seed**。守住「遮盖式落地」不放。 |
| 像棋子/下方粗大 | 从 `[CORE]` 删/弱化“下收/重心低”倾向，给 `slim` + `tapered (narrower at the bottom)`。 |
| 空壳 / 有空洞 / 皮包骨 | 提 `full solid mass across the whole body, no empty space`。 |
| 衣摆拖太长 | 提 `short hem`, `hem ends right at the ground, no trailing`. |
| 太重/军事/SF | 提 `casual-to-formal streetwear`, `not tactical, not armor`. |
| 出图像素不像 64×64 | 这是 base sheet 的切格/采样子，run 阶段用 `--cell` 与大图看姿态，像素密度在 S3 阶段收敛。 |
| 三轴之一全没感觉 | 直接给缩**该条变体**、放大另一条；或回查 §二`[STYLE]`替换口径。 |

## 六、边界（不自越，供裁决者把握）

- **不碰权威**：本文件不改视觉定律/颜色语义/数值，只产提示词。
- **不碰实现**：不进 `src/`，产出只落在 `run/plt01/` 与表现文档。base sheet 定稿后再谈进引擎/接 UGC。
- **不背美术选型**：所有定稿必须由项目所有者肉眼拍板，本文件只给调色板与迭代机制。
- **三条美术选型红线**：画风基调 §一（像素前景/素描背景）、动态图形化五原则（`00_创作指导.md` §二）、全屏动画认知判据——本文件的产物必须与它们一致才可作为 base sheet 候选。

> 表 3 col 仅供参考；单条命中的**最终裁决始终在项目所有者手里**。写本文档的是 PLT-01 的产出文件——**不背任何最终选型**。

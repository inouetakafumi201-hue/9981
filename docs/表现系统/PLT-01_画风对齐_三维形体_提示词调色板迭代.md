---
name: "PLT-01 画风对齐·主角三维形体·提示词调色板迭代"
labels: [表现系统, sprite-forge, 画风对齐, AI迭代]
status: "母版完成 / 提示词 v2 定案"
created: 2026-08-15
updated: 2026-08-16
auditor: 项目所有者
toolchain: skill `sprite-forge`（gpt-image-2 默认 / gemini 备选 / Codex 兜底）
trigger: 项目所有者「把需求写成文档，用 sprite-forge 暴力出图迭代画风基底」
scope: 表现系统目录 · 产物=调色板/留档/您的肉眼裁决，不碰 src/
---

# PLT-01 · 画风对齐·主角三维形体·提示词调色板

〔给后续会话/迭代者的入口〕在任何进一步的视觉工作之前，先在**我（3D 造型）这一层**对齐。
本文件只产**提示词、批次、留档与筛选**；产出到底定不定、定哪张，一律由**项目所有者肉眼裁决**。
可运行、可留档、可复现；美术选型在任何一层定格前，都先被本文件这个「调试器」刷一遍。

## 视角与朝向（铁律，写进所有提示词的骨架）

- **视角 = 俯视平面视图**（权威：`01_图形化与UI` §视觉风格定位·俯视平面视图；本项目唯一视角，地图同此法则）。固定唯一，不换其它。
  - 从正上方俯瞰角色的**顶部轮廓 / 平面布局**，靠剪影、帽子/衣物/工具的投影方向、地面阴影传达身份与朝向；**没有前脸、侧面或顶部立面可言**。
  - **朝向不等同于视角**：朝向只能在俯视平面内用方向性细节（头部朝向、工具指向、影子方向、剪影偏移）表达，不能再靠露侧脸 / 露前脸 / 画顶面表现。
- **口令（唯一）**：`top-down plan view`（同义 `overhead plan-view sprite`）。
- **禁止表述**（不得使用）：`正面斜投影`、`Cabinet projection`、`Cavalier projection`、`front-facing`、`front face`、`side face`、`right side face`、`top face`、`oblique of the side`、`three-quarter`、`isometric`、`slightly angled for depth`，以及以第三方游戏名作为视角名称或提示词类比（D-025）。「斜侧 / three-quarter / 45° 侧身」这类词一律废止。

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
- **S3 · base sheet 视角**：`--rows 3 --cols 2 --cell 384` —— **俯视平面**下的朝向变体行（如 左上→右/下一行 左→右下…），每个都是同一俯视平面精灵的朝向/姿态变体，**最后阶段**跑。

> S1 与 S3 的提示词措辞**共用同一套骨架**，只换 rows/cols 与「视图」词。在调色板骨架里，静态视图与 sheet 视图用占位符区分，保证「S1 挑中的那张，能直接升成 S3 的规范视角」——这正是 base sheet 的由来。

## 固定骨架（所有提示词的公共底盘，先对齐、后变化）

```
Pixel-art 64x64, near-humanoid single character, high saturation, bold readable silhouette.
[VIEW+CUE 铁律: 俯视平面视图(top-down plan view)]
Top-down plan view / overhead plan-view sprite: the figure reads as a flat top-down outline and
clean silhouette. Direction and identity are shown in the plan plane through hat, coat, tool and
ground-shadow orientation. NO front face, NO side face, NO top face, NO oblique depth, no three-quarter.
[CORE: 无腿+遮盖式落地+中部重心的本质]
Body tapers into a soft closed bottom that stands directly on the floor, weight sits at the mid-body,
completely concealing any legs. The visible lower silhouette is full and grounded (NOT a hollow or a
cut-off torso; not a tall skirt dragging on the floor). Garment hem is short and sits on the ground,
so a jump reads as a single intact mass lifting, never trailing fabric.
[STYLE: 现代表达]
Modern gray-ground casual-to-formal garment. Low-key urban realism with a subtle edge,
Z-style muted cool palette, no gore, no fantasy armor.
[OUTLINE+ANATOMY 防御语: 关节规则]
Clear body outline. No visible joints or knees; but the head is a clearly readable top silhouette; limbs
indicated by readable arms/hands in the plane. Head distinct from torso. Proportions taller than 1:1.
{RENDER 兜底: 上网格+品红背景的公共约定,由 skill 内建,提示词不写死}
Background: 100% solid flat magenta (#FF00FF).
```

- `[VIEW+CUE]` **铁律**：俯视平面视图（`top-down plan view`）；非前脸、非侧脸、非顶面、非斜投影、非 three-quarter、非 isometric。

- `[CORE]` 是**不可动摇的形态律**：无腿、遮盖式落地、重心中部、整体实心非中空、下摆短不拖地。
- `[STYLE]` 是**可迭代的**（本次给现代灰色倾向，走“都市灰调”阵营）。
- `[OUTLINE+ANATOMY]` 防御语：出图方向差时往上提（见 §五诊断）。
- `{RENDER}` 由 skill 内建拼接，不是我们要写的词。

## 调色板（每行=一条**静态单图 S1**）

默认用 **gpt-image-2**（见 §〇/§运行环境），按后面「示例命令」把每个变体提示词交给
`sprite-generate.py generate --rows 1 --cols 1`（**一张一遍，别开多格**）。产物落在
`run/plt01/{维度}/`。留档 = 图 + 对应 `.raw.json`（skill 自动写），这正是「提示词留档」。

示例提示词（S1 静态单图，对应 §三「体态·重心」行，已含俯视平面视图+朝向）——

```
Pixel-art 64x64, near-humanoid single character, high saturation, bold readable silhouette.
Top-down plan view: the figure reads as a flat top-down outline and clean silhouette.
Direction and identity are shown in the plan plane through hat, coat, tool and ground-shadow
orientation. NO front face, NO side face, NO top face, NO oblique depth, no three-quarter.
Body tapers into a soft closed bottom standing directly on the floor, weight sits at the mid-body,
completely concealing any legs; the visible lower silhouette is full and grounded (not a hollow or
cut-off torso). Garment hem short, sits on the ground, so a jump reads as one intact mass lifting,
never trailing fabric.
Modern gray-ground casual-to-formal garment, low-key urban realism, Z-style muted cool palette,
no gore, no fantasy armor. Clear body outline, no visible joints or knees, head is a clearly readable
top silhouette, limbs indicated by readable arms/hands in the plane. Head distinct from torso,
tall proportion, full body visible, centered.
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
> - Run 2 确认可用形态：e1-sack-hood（连帽袋）+ e6-detective-flow（侦探衣摆）。
> - **视角定案 = 俯视平面视图**：从正上方俯瞰平面轮廓（见 §视角与朝向），下一步按这两张做
>   32×32 俯视平面精灵收敛。
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

## 四·五、母版精灵图（Master Sheet）定案（2026-08-15）

> 本作画风收敛到**单一普世形态 + 换装**范式。母版精灵图 = 一个固定角色（如紫色侦探）的
> 16 姿态 sprite sheet，作为**万能参考图（母板）**：以后创建任何新角色，只需投母版为
> reference + 描述"帽子 X / 衣服 Y / 配饰 Z"，即可复刻出一整版风格统一的新角色。
>
> **母版的意义**：画风语言固定后，新建角色不再逐个从零生成，而是**复用母版形态 + 换服装**。
> 母版本身要**稳定、流畅、高质量**，是"钱花在刀刃上"的集中投入。

### 姿态清单（16 帧，4×4 网格，已定案）

| # | 姿态名 | 语义 | 复用说明 |
|---|---|---|---|
| 1 | `idle` | 中间态（直立） | 标准待机 |
| 2 | `idle_lean_forward` | **疲惫前倾** | 前倾幅度**小**，与 #1、#3 组三态摇晃/呼吸循环 |
| 3 | `idle_lean_back` | 后仰休息 | 身体后仰、放松，与 #1、#2 组循环 |
| 4 | `weak_lean_forward` | **虚弱前倾** | 前倾幅度**大**（近 T4 右帧），衣服凌乱、**领口等带血** |
| 5 | `weak_breath` | 虚弱呼吸帧 | 虚弱前倾的呼吸变体，配合 #4 循环 |
| 6 | `jump_forward` | 跳跃凌空前倾 | 衣服飘起、动感强；模拟凌空姿态 |
| 7 | `jump_backward` | 跳跃凌空后仰 | 衣服飘起、准备落地；模拟凌空姿态 |
| 8 | `hit_recoil` | 受击蜷缩 | 身体蜷缩、疼痛姿态 |
| 9 | `idle_breath` | 普通呼吸帧 | 与 #1 `idle` 配合做呼吸起伏循环 |
| 10 | `crouch` | 蹲下 | 高度压缩到 24px |
| 11 | `prone` | 倒地 | 躺倒（16px），无蓝闪=击倒/死亡态 |
| 12 | `falling` | 倒下过程（也叫**受击后仰**） | 站立→倒地过渡，**不从容**；可复用为失足摔落等 |
| 13 | `crawl_extend` | 爬行伸展 | 身体整体伸长、头微仰（**无手**） |
| 14 | `crawl_compress` | 爬行压缩 | 身体整体压缩、头缩回（**无手**） |
| 15 | `sleep` | 睡眠 | 躺卧（24px），配合 ZZZ；与 `prone` 区分：睡眠有呼吸/蜷曲 |
| 16 | `get_up_mid` | 起身过渡 | 有**爬起床**感（床侧起身）或从地上爬起来；倒地→站立过渡 |

> **姿态定义关键**：
> - **疲惫前倾 vs 虚弱前倾**：疲惫=前倾幅度小、衣服整齐；虚弱=前倾幅度大、衣服凌乱带血。
> - **睡眠 vs 倒下**：睡眠=有呼吸、身体松弛蜷曲（床上 24px）；倒下=僵硬躺倒（16px，不从容）。
> - **jump_forward/jump_backward** 是**凌空模拟**（衣服飘起），与 idle 三态前倾（拖地虚弱）**不同**。

### 复用循环（母版性价比的核心）

- **普通呼吸**：`idle ↔ idle_breath`
- **疲惫三态循环**：`idle_lean_forward ↔ idle ↔ idle_lean_back`（过载摇晃/疲惫站立/轻度眩晕）
- **虚弱呼吸循环**：`weak_lean_forward ↔ weak_breath`（重伤/濒死/重度过载）
- **跳跃凌空**：`jump_forward → → → jump_backward`
- **爬行**：`crawl_extend ↔ crawl_compress`
- **倒下**：`falling`（受击后仰/失足摔落，不从容）
- **姿态转换**：`falling`（倒下去）、`get_up_mid`（爬起来）

### 表情系统设计（方案 C：混合方案，2026-08-16 定案）

**核心洞察**：纯黑脸 + 双白眼 = **可编程表情**。因为像素艺术本质是色块，可以用**色块检测**（而非像素检测）实现表情系统。

#### 方案 C：闭眼用运行时色块替换 + 复杂表情用预生成贴图

**闭眼/眨眼**（运行时色块替换）：
- 搜索纯黑色块区域（人脸，RGB < 10）
- 在脸部区域搜索白色色块（眼睛，RGB > 245）
- 把白色色块涂成黑色 → 闭眼
- 优点：零额外资源，运行时动态触发（sleep/dizzy/blink 状态自动闭眼），所有角色通用
- 实现时机：后续前端实现时加载器支持

**眉毛/复杂表情**（预生成贴图库）：
- 每个角色生成一套表情贴图 (32×32 透明 PNG)：
  - `face_open.png`：双白眼（默认）
  - `face_angry.png`：双白眼 + 八字白眉
  - `face_surprised.png`：双白眼变大/挑眉
  - `face_tired.png`：双白眼 + 下弯眉
- 加载时 alpha blend 到脸部坐标
- 优点：美术可控，可做复杂表情（流汗、泪水、红晕）
- 实现时机：等一批角色母版生成后再决定是否需要（如果所有角色脸部位置/大小一致，可能一套贴图通用）

**当前状态**：sleep 姿态已生成纯黑闭眼版本（验证了"纯黑脸可以不画眼睛"），等前端实现时再决定运行时替换的具体算法。

### 提示词模板 v2（迭代后定案，2026-08-16）

**核心发现**：提示词过长（像素艺术规则 + 无腿约束 + 姿态描述 + 网格规则）导致 AI 顾此失彼，反而画崩。**解决方案 = 简化 + 聚焦核心**。

#### 模板结构（三层）

```
[CORE_STRUCTURE —— 核心结构，所有帧共用]
Purple detective character. Purple trench coat, brown fedora hat.
Top-down plan view: the character reads as a flat top-down outline and clean silhouette.
Direction and identity are shown in the plan plane through hat, coat and ground-shadow orientation.
NO front face, NO side face, NO top face, NO oblique depth, no three-quarter.
Full-length coat reaches ground, completely covering lower body, no legs/pants visible.
Bean-shaped body silhouette with flat base touching ground.
64x64 pixel art aesthetic, character fills 60-70% of canvas height.

[POSE —— 姿态描述，每帧单独填]
{用视觉特征描述姿态，避免抽象情绪词}

[RENDER —— 渲染约束]
Hard-edged pixel art, solid color blocks, clean silhouette.
```

#### 关键改进点

1. **视角明确化**（俯视平面视图）：
   - ❌ 旧：`Facing left side profile`（AI 理解为完全侧面，只画一只眼睛）
   - ❌ 旧：`Facing left at three-quarter angle showing both white square eyes`（three-quarter 仍是斜投影）
   - ✅ 新：`Top-down plan view: top-down outline, no front/side/top face`（正视平面，无任何立面）
   - ✅ 新：`Direction shown in the plan plane through hat, coat, ground-shadow orientation`（朝向上放平面内）

2. **像素密度约束**：
   - ❌ 旧：`64x64 pixel art style`（AI 随意缩放）
   - ✅ 新：`character fills 60-70% of canvas height`（明确占比）

3. **姿态用视觉特征代替情绪词**：
   - ❌ 旧：`tired` / `weak` / `breathe`（抽象，AI 理解不一致）
   - ✅ 新：`slight forward slouch, shoulders drooping` / `body leaning heavily forward, unsteady posture` / `body raised 2-3 pixels higher, chest slightly expanded`

4. **删除冗余约束**：
   - 删除了过于细节的像素艺术规则（limited palette, NO gradients 等），让 AI 聚焦核心形态
   - 保留最关键的"无腿约束"和"bean-shaped"轮廓

#### 姿态描述示例（基于 v2 成功案例）

- **idle**：`Standing upright, neutral relaxed pose`
- **tired (lean-fwd-tired)**：`Slight forward slouch, shoulders drooping slightly, tired posture, head tilted down a bit`
- **weak (weak-lean-fwd)**：`Body leaning heavily forward, unsteady posture, shoulders hunched, weak stance (NO blood, NO wounds)`
- **weak_breathe**：`Same weak posture but body raised slightly higher (2-3 pixels up) as taking a labored breath, chest slightly expanded`
- **jump_forward**：`Slight forward lean with coat bottom lifting gently (2-3 pixels), subtle jump motion`
- **jump_backward**：`Slight backward lean with coat bottom lifting gently, preparing to land softly`
- **falling**：`Falling backward out of control, arms flailing, body tilted back sharply, coat swirling, panicked chaotic motion`
- **sleep**：`Lying down horizontally in peaceful sleep, relaxed curled position, 24px height, face is PURE BLACK with NO white eyes (eyes closed)`

**每次新建角色 = 改 `[POSE]` + 修改 `[CORE_STRUCTURE]` 中的服装描述**，其余结构完全固定。

### 背景处理（两种底色都合法）

**管线输出可能是透明底（RGBA）或品红底（RGB #FF00FF），两种都接受**：
- **RGBA 透明底**：gpt-image-2 图生图时随机输出，已免抠，游戏引擎直接用
- **RGB 品红底**：传统 sprite sheet 标准，可用色键抠图；**母版优先用品红**（更适合作为 AI 参考图）
- **UGC 上传同理**：用户可能传透明 PNG 或品红底，管线都支持
- **格式统一 = PNG**：无论透明/品红，都用 PNG（无损、支持透明通道、无隐式渲染错误）
- **按需转换**：生成时两种都接受，加载/预览时按需转换（透明→品红用于 contact sheet 可视化；品红→透明用于游戏引擎加载优化）
- **验证门**：生成后检查背景纯度（透明占比 >30% 或品红占比 >30%），记录到 `.raw.json` 的 `background` 字段

**前端实现时**：加载器需支持两种底色，PNG 格式保证跨平台一致性。

### 后处理：AI 伪像素 → 真正像素艺术

**问题**：AI 生成的图虽然看起来像像素艺术，但实际上：
- **边缘有抗锯齿渐变色**：不是整齐的阶梯状，有浅紫、中紫等过渡色块（参差不齐的锯齿）
- **内部有亚像素级的颜色变化**：看似单色的区域其实有几十个相似但不同的颜色
- **没有对齐到整数像素网格**：边缘不整齐

**解决方案**（使用 `sprite-pixelate.py`）：
1. **proper-pixel-art 网格检测**：用计算机视觉（Canny 边缘检测 + Hough 变换）检测 AI 生成图中的"伪像素网格"
2. **色彩量化**：合并相似颜色到 32 个主色（MEDIANCUT 算法）
3. **网格对齐重建**：重建为真正对齐的像素艺术（每个色块内部是纯色或保留阴影，但无抗锯齿杂色）
4. **最近邻放大**：放大到目标尺寸（128×128 或更大），保持像素风格

**命令**：
```bash
# 单文件
python .agents/skills/sprite-forge/tools/sprite-pixelate.py single input.png --output output.png --size 128

# 批处理（覆盖原文件）
python .agents/skills/sprite-forge/tools/sprite-pixelate.py batch *.png --size 128 --inplace

# 批处理（输出到指定目录）
python .agents/skills/sprite-forge/tools/sprite-pixelate.py batch *.png --size 128 --output-dir ./pixelated/
```

**参数**：
- `--size`：输出尺寸（默认 128×128；如果细节丢失太多可以提高到 256 或 512）
- `--colors`：色彩量化颜色数（默认 32；增加可保留更多细节）

**效果**：
- ✅ 边缘整齐对齐，无抗锯齿杂色
- ✅ 消除参差不齐的锯齿
- ✅ 保留内部细节（阴影、褶皱）
- ⚠️  眼睛等最灵动的细节可能轻微失真（压缩到原始网格 58~94 像素再放大），**需要手动用画笔修正**

**依赖**：
```bash
pip install proper-pixel-art
```

**工具链位置**：`.agents/skills/sprite-forge/tools/sprite-pixelate.py`

**集成到管线**：
- AI 出图后 → 立即运行 `sprite-pixelate.py batch` → 生成 contact sheet
- 眼睛修正留给最后手动润色阶段（批量处理后用画笔工具逐帧检查）

### 母版角色定案（紫衣侦探，2026-08-15~16 完成）

- **首个母版角色 = 紫色侦探**（紫色大衣 + 褐色软呢帽 + 纯黑脸双白眼）
- **16 姿态完整集**（编号连续：01 正面参考 + 02~16 姿态；旧 set9-idle_breath 已删，语义由 03 承接）：
  1. **正面参考图**：`01-front.png`（用作后续姿态的 reference）
  2. **idle**：中性直立待机（`02-idle.png`）
  3. **lean-fwd-tired**：前倾疲惫（`03-lean-fwd-tired.png`，原 set5 weak-breathe，神色更符合 tired）
  4. **lean-back-rest**：后仰休息（`04-lean-back-rest.png`）
  5. **weak-lean-fwd**：虚弱前倾（`05-weak-lean-fwd.png`，重新生成，无血/无蓝色脚部渲染错误）
  6. **weak-breathe**：虚弱呼吸（`06-weak-breathe.png`，与 05 一次生成，身体微升 2-3px）
  7. **jump_forward**：前跳（`07-jump_forward.png`，小幅飘动，衣摆轻抬）
  8. **jump_backward**：后跳（`08-jump_backward.png`，小幅后仰，衣摆轻飘）
  9. **hit_recoil**：受击后仰（`09-hit_recoil.png`）
  10. **crouch**：蹲伏（`10-crouch.png`）
  11. **prone**：趴下（`11-prone.png`）
  12. **falling**：倒下（`12-falling.png`，慌乱失控，手臂挥动）
  13. **crawl_extend**：爬行伸展（`13-crawl_extend.png`）
  14. **crawl_compress**：爬行压缩（`14-crawl_compress.png`）
  15. **sleep**：睡眠（`15-sleep.png`，纯黑闭眼，无白眼）
  16. **get_up_mid**：起身中（`16-get_up_mid.png`，爬起床的过渡帧）

  **编号规则**：`NN-姿态` 连续编号（01 起），正面参考图占 01，姿态从 02 起。旧 `setN` 命名 → 新编号映射 = `setN → N+1`（set1→02，set10→10，…），避免"set8 之后直接跳 set10"的断号混乱。

- **生成策略**：
  - 正面图作 reference 锁风格
  - weak 系列（05/06）、jump 系列（07/08）一次生成 2 帧（提示词 `--rows 1 --cols 2`），确保配对姿态风格一致
  - 旧 set9 删除原因：完全左视图，与俯视平面视图冲突（历史"three-quarter angle"教训），用 lean-fwd-tired 替代其"俯视平面内前倾呼吸"语义

- **实测质量**：batch 首轮（2026-08-15）质量"非常高、几乎无修可用"
- **迭代经验**（2026-08-16）：
  - 硬伤 1：腿部露出 + 裤子颜色不一致 → 提示词强化"coat hem ALWAYS fully covers"
  - 硬伤 2：视角漂移（露出侧面）→ 提示词统一为"俯视平面视图：top-down plan view，无前脸/侧脸/顶面"，朝向用帽饰/衣摆/影子方向表达
  - 解决方案：简化提示词 + 聚焦核心特征，删除冗余约束（见 §提示词模板 v2）

- **交付物**：`run/plt01/master/` 目录，包含：
  - 16 张 PNG（1 正面 + 15 姿态）
  - 对应 `.raw.json` 元数据
  - `_contact.png` 总览图（5×4 网格）
  - `_zoom/` 缩略图目录
  - `_old/` 备份目录（迭代前的旧版本）
  - 背景统计：RGBA 透明 9 帧 / RGB 品红 7 帧

---

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

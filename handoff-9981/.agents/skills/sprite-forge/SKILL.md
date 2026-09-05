---
name: sprite-forge
description: "开发期像素/位图精灵管线 + 词条图标语义库。前者对接上游 open-source agent-sprite-forge：用 Nano Banana API 生成 solid-#FF00FF 多行网格 raw sheet，经 generate2dsprite.py 本地后处理产出 transparent sheet、逐帧 PNG、GIF、QC 元数据。后者是全项目唯一符号词汇表：304 个 game-icons 开源 SVG 的定论语义名 + 泛化规则 + 统一美化（token-icon-beautify.ts 上色/高光/光晕）。当用户要:生成像素组件/精灵/动画帧/spell包/战斗特效/位图 icon、给 2D 角色做 idle/run/attack/cast 动作 sheet、把 AI 出图切格对齐出透明资源、查/定词条图标语义、给图标上色美化、或跑 sprite 管线自测时使用。纯开发期工具，不碰 src/ 产品运行时（图标源 SVG 除外）。"
---

# sprite-forge

开发期位图精灵管线。核心是对上游开源 `agent-sprite-forge`（0x0funky，MIT）的落地：
引它的 `generate2dsprite` 规范与本地后处理脚本，并把「宿主内置 `image_gen`」这一个出图
接缝替换为 Nano Banana API。我们需要的就是它产的 PNG，不需要它产的任何 map/Godot 文件。

## 为什么这样落地

上游 SKILL.md 明文要求用宿主内置 `image_gen`、取图自 `$CODEX_HOME/generated_images`。
那是一个 Codex-专用入口。我们不想绑定 Codex 内置画图，因此把出图换成 Google Gemini
图片 API（Nano Banana 系列），其余全部沿用上游：多行网格规划、品红抠图、切格、锚点
对齐、strict-QC 数值门、scale-profile 跨动作锁审美。

如果你有 Codex 且想直接用上游原味跑法，见下文「兜底：用 Codex 原味跑」——脚本/规范
都在仓库里，一字未改。

## 目录

```
.agents/skills/sprite-forge/
  UPSTREAM-LICENSE-MIT.txt         上游 MIT 许可证（附件，勿删）
  generate2dsprite/                上游原封拷贝:SKILL.md + 2 参考文档外的脚本
    SKILL.md
    requirements.txt               (numpy + Pillow)
    scripts/generate2dsprite.py    后处理:切格/抠图/对齐/QC/透明/GIF(1627行,零改动)
    scripts/make_anchor_layout.py  锚点模板
    scripts/make_layout_guide.py   几何布局向导
  tools/nano-banana-sprite.py      我们的出图适配: Nano Banana -> raw sheet
  tools/selftest-sprite-pipeline.py 本地自测(合成品红raw->process,不发API)
```

## 前置

- Python 3.10+；`pip install -r .agents/skills/sprite-forge/generate2dsprite/requirements.txt`
- 出图：`pip install google-genai`，设 `GEMINI_API_KEY`
  （可选 `GEMINI_MODEL`，默认 `gemini-3.1-flash-image`；`GEMINI_IMAGE_SIZE` 默认 `1K`）

## 用法（Nano Banana 适配路径）

第一步：调 Nano Banana 生成一张多行网格 raw sheet（先设好 `GEMINI_API_KEY`）：

```bash
python .agents/skills/sprite-forge/tools/nano-banana-sprite.py generate \
  --rows 2 --cols 2 --cell 384 \
  --prompt "side-view pixel knight attack, clean pixel, 16-bit" \
  --art-style pixel_art \
  --out run/attack-raw.png
```

`--rows/--cols` 按上游 `sheet` 建议选：4帧>2x2, 6帧>2x3, 9帧>3x3；**不要**用 raw 单行
strip 做身体动画（上游明文禁止 1x4/1xN，模型易水平漂移）。`--reference` 可传上一版
raw sheet/主视觉做图生图局部重绘、锁定风格。

### 角色整套模板规则

角色生成入口当前使用紫衣侦探的完整 16 帧模板：`run/精灵图管线/1-成品/s2-blue/s2-blue-purified.png`。
它是 1254×1254 的 AI raw sheet，检测到的 4×4 网格包含 16 帧；第 12 格
（行 3，列 4）已经替换为已验收的修正版，并对应
`frames/f01.png` 至 `frames/f16.png`。生成新角色时必须传完整 16 帧模板，复制 16 格的顺序、
姿态、比例和像素风格，只改变服装/帽子/配色；不得只传旧单帧、旧 contact 或旧
`run/plt01/master/` 母版。旧目录可以继续作为历史 provenance 保存，但不属于当前生效入口。

第二步：本地后处理(切格/抠图/对齐/QC/透明导出)：

```bash
python .agents/skills/sprite-forge/generate2dsprite/scripts/generate2dsprite.py process \
  --input run/attack-raw.png --target player --mode attack \
  --rows 2 --cols 2 --output-dir run/ \
  --cell-size 128 --align feet --scale-strategy preserve --component-mode largest \
  --strict-qc --max-body-scale-cv 0.08 --max-anchor-y-std 0.05
```

产出 `sheet-transparent.png`、`attack-1..4.png`、`animation.gif`、`pipeline-meta.json`、
`prompt-used.txt`。

想先在提示词层面（不上网）看 Nano Banana 会拿到什么 prompt：`PRINT_PROMPT_ONLY=1 python ... generate ...`。

## 自测（确定性地跑后处理闭环，不发 API）

```bash
python .agents/skills/sprite-forge/tools/selftest-sprite-pipeline.py
```

会合成一张 2x2 solid-#FF00FF 品红 raw sheet 并跑 strict-QC 的 process，断言产出 4 帧、
无空帧、pipeline-meta/透明 sheet 齐全。PASS 即管线在本机可复用。产物落在
`tools/selftest-run/`，由使用者自行清理。

## 兜底：用 Codex 原味跑

本 skill 内是上游 `generate2dsprite` 原封脚本。若你觉得 Nano Banana 适配不够好、想回归
上游原生，装有 Codex 时直接：

1. 把 `.agents/skills/sprite-forge/generate2dsprite/` 整个拷到你的 Codex skills 目录
   （如 `~/.codex/skills/generate2dsprite/`）；
2. 重开会话，对 Codex 说 `use $generate2dsprite to create ...`，Codex 会用它的内置
   `image_gen` 出图并自己调这些脚本后处理。

两种跑法共用同一套后处理脚本，产出一致。

## 与 `asset-pipeline` skill 的关系

`asset-pipeline` 管**地图数据契约**（MapData 生成→校验→编译→引擎 spawn，主梁 D-077）。
`sprite-forge` 管**可见美术位图**（像素组件/精灵/动画）。二者是开发期素材工具链的两
条独立链路，互不依赖；sprite 产出是位图文件，不写入任何游戏数据契约。

## 组件生成管线（外包化：AI 只传参数，直接拿成品）

**定位**：与角色管线不同，本管线专门生成**统一美学的静态组件**——武器、物品、设备、
环境交互件。风格完全锁定在脚本内部（视角/光影/像素/语义色/背景），调用方不需要关心
怎么做贴图，只需要说「要一个什么类型的什么组件、有几个状态」，拿回来就是品红底、
纯化背景、按固定比例切好、已像素化的成品帧。

> **真实流程（2026-08-16 起）**：出图后不是「直接拿成品」。脚本会先**检测实际品红分隔带**
> 推导真实网格行/列（不受提示词期望约束），再经过**成品质量��门**——任一帧过小或
> 非品红内容占比过低（疑似纯色块）就会整体失败，并在输出目录保留 `raw.png` / `sheet.png`
> 供重跑或人工排查，**绝不把损坏切格写进 manifest**。切图的布局由检测结果确认，模型未遵守
> 提示词布局时按检测到的分隔带切，而不是静默产出 1×1 单色块。

**何时用**：迭代者在做玩法/场景时需要任何静态组件（钥匙、药包、武器、箱子、设备、
门、环境件……）时，直接调本管线，**不消耗 AI 心智去盯贴图**。帧数由调用方决定：
单帧（钥匙）或多帧（箱子 = closed/open/broken）都支持，脚本自动排网格并切格。

**用法**：
```bash
# 单帧组件（钥匙）
python tools/sprite-component.py --type item-tool --desc "old brass door key" --out run/assets/key

# 多帧组件（箱子三态）
python tools/sprite-component.py --type environment --desc "wooden supply crate" \
    --states closed,open,broken --out run/assets/crate

# 指定后端（默认 gpt-image-2；可选 gemini）
python tools/sprite-component.py --type weapon-firearm --desc "revolver" \
    --provider gemini --out run/assets/revolver

# 只打印提示词不调用 API（校对用）
PRINT_PROMPT_ONLY=1 python tools/sprite-component.py --type item-consumable --desc "bandage" --out /tmp/x
```

**类型（8 类受控分类，机器事实源 `.agents/skills/sprite-forge/catalogs/component-types.v2.json`）**：
`weapon-melee`（珊瑚=近战）/ `weapon-ranged`（紫=远程）/ `weapon-firearm`（枪灰+橙=AP 消耗）/
`item-consumable`（绿=正面或橙=消耗）/ `item-tool`（橙=进行中或黄=感官）/
`item-equipment`（蓝=科技）/ `device`（灰白=可交互受制状态+蓝科技）/ `environment`（低饱和灰棕=背景素描）

**视角规范（分流铁律）**：
- **物品类序列帧**（`item-consumable` / `item-tool` / `item-equipment`）：采用 **`front view`**（眼平直接正交正视图，强调物品清晰剪影与细节，无俯仰角度、无三维倾斜深度、无侧立面、无透视消失点）。
- **其余静态组件**（武器类、`device`、`environment`）：采用 **`front-top axonometric view`**（正面高位斜测轴：顶部与前部可见，侧部与后部隐藏，固定常规斜角，正交投影）。
- **底图原生组件（Crop-to-Sprite）**：以切片为母图进行链式图生图（`--reference-crop`），1:1 继承几何包围盒与光影（详见 `docs/创作系统/06_底图原生组件占位切片与图生图替换规范.md`）。

**V0 混合素材生成管线 v2 CLI (`tools/asset-pipeline-v2.py`)**：
1. `prepare` 生成 `job.v2.json`（含提示词、视角、切片母图引用、rawTarget）
2. Agent 读取 job，用 V0 GenerateImage 将 PNG 写到 `rawTarget`
3. `finalize` 校验 PNG、纯化品红、检测切格、像素化、执行 QC、计算 SHA-256 并写 `manifest.v2.json`
4. `registry` 聚合已通过 QC 且状态为 `ready` 的素材目录

**风格锁定**（全部硬编码在脚本里，不随机发挥）：
- 分流视角（物品类 front view / 其余 front-top axonometric view）
- 硬边色块、64×64 像素、无抗锯齿/渐变/抖动
- 光影 = 统一方向落影（光源左上）
- 品红底 #FF00FF，纯化背景（近品红→纯品红）
- 后处理 = 确定性三步闭环（背景纯化 → 去杂色与 Alpha 二值化 → 像素量化与网格对齐）

**切格与质量闸门**：
- 布局以脚本检测到的实际品红分隔带为准；检测格数与状态数一致时直接按真实行列切格
- 若检测格数与状态数不一致才退回安全等分，并由质量闸门拒绝空帧/纯色块
- 每帧经过尺寸 + 非品红内容占比双重校验，任一不合格即整体失败并保留 `raw.png`/`sheet.png`
- 切出的帧用原生分辨率喂 proper-pixel-art（`-s 1` 不放大），不做 1024 预放大

**产物结构**（输出目录内）：
```
raw.png         后端原始网格 sheet
raw.json        提示词留档（含状态表）
sheet.png       背景纯化后的整 sheet（品红底）
frames/         N 个 64×64 成品帧，按状态命名（single.png / closed.png ...）
contact.png     各帧拼版总览
manifest.json   组件登记（类型/状态/路径/提示词摘要）
```

**依赖**：`httpx` / `Pillow` / `proper-pixel-art` / `numpy`（与角色管线共享）

**工具位置**：`tools/sprite-component.py`

**组件切格回归自测**（不发 API，仅验证切格/质量闸门逻辑）：
```bash
python .agents/skills/sprite-forge/tools/selftest-component-grid.py
```
覆盖横排 / 竖排 / 检测失败回退三种网格，断言帧数、无反向裁剪、无非品红内容，并验证
质量闸门拒绝纯色块与帧数不匹配输入。

## 词条图标语义库（图标 → 语义 → 泛化）

**来源**：`src/svg-game-icons/`（game-icons.net 开源集，304 个单色 `currentColor` SVG）
**定位**：全项目唯一「符号词汇表」——词条图标、素材类别图标、HUD 状态图标、编辑器图层图标等
一切抽象符号需求，都从语义库取「语义最近」的图标，不另造、不混用。

**三条铁律**：
1. **泛化不取本义**：图标选入必有丰富内涵。例：`wireframe-globe`=全球化/全局范围，
   `winchester-rifle`=泛化到所有猎枪，`abstract-018`=世界观物品「锚定导流仪」。
2. **选最近不造名**：词条/素材/UI 需要图标时，只能从语义库选最近的「定论语义名」，
   找不到就换一个接近的，不允许自由发挥新名字或新含义。
3. **颜色随品级不随语义**：图标源保持黑色/`currentColor`，上色统一走
   `tools/token-icon-beautify.ts`（语义定「用哪个符号」，品级定「上什么色」：
   灰白1/绿2/蓝3/银4/金5）。

**文件**：
- `icon-semantics/icon-catalog.md` — 304 个图标的定论语义名 + 泛化/游戏内用法 + 受控大类
- `tools/token-icon-beautify.ts` — 统一美化后处理（上色/高光/光晕/容器）
- `src/svg-game-icons/` — 源 SVG（黑色 currentColor）
- `src/px-game-icons/` — 历史重复导出（外壳参数差异，已被 svg 版取代，勿再引用）

**用法（AI / 迭代者）**：
1. 需要抽象符号 → 查 `icon-semantics/icon-catalog.md`，按泛化语义找最近的 `id`。
2. 引用 `src/svg-game-icons/game-icons--<id>.svg`（黑色源图）。
3. 上色/高光/光晕 → `tools/token-icon-beautify.ts` 按品级或类别统一处理。
4. 新图标入表 → 先由项目所有者定论语义名，补进 catalog，之后才可被引用。

## 后处理管线：AI 伪像素 → 真正像素艺术

**标准流程**（推荐）：使用 `sprite-pixelate.py` + proper-pixel-art 进行真正的像素网格检测和重建。

### 方案 A：proper-pixel-art（推荐，2026-08-16 定案）

**问题**：AI 生成的图虽然看起来像像素艺术，但实际上：
- 边缘有抗锯齿渐变色（参差不齐的锯齿，有浅紫、中紫等过渡色块）
- 内部有亚像素级的颜色变化（看似单色的区域其实有几十个相似但不同的颜色）
- 没有对齐到整数像素网格

**解决方案**：
```bash
# 批量处理（覆盖原文件，输出 128×128）
python tools/sprite-pixelate.py batch *.png --size 128 --inplace

# 如果细节丢失太多，提高输出尺寸
python tools/sprite-pixelate.py batch *.png --size 256 --inplace
```

**工作原理**：
1. **proper-pixel-art 网格检测**：用计算机视觉（Canny 边缘检测 + Hough 变换）检测 AI 生成图中的"伪像素网格"
2. **色彩量化**：合并相似颜色到 32 个主色（MEDIANCUT 算法）
3. **网格对齐重建**：重建为真正对齐的像素艺术（每个色块内部是纯色或保留阴影，但无抗锯齿杂色）
4. **最近邻放大**：放大到目标尺寸（128×128 或更大），保持像素风格

**效果**：
- ✅ 边缘整齐对齐，无抗锯齿杂色
- ✅ 消除参差不齐的锯齿
- ✅ 保留内部细节（阴影、褶皱）
- ⚠️  眼睛等最灵动的细节可能轻微失真（需要手动用画笔修正）

**依赖**：
```bash
pip install proper-pixel-art
```

**工具位置**：`tools/sprite-pixelate.py`

### 方案 B：简单像素化（备选，保留）

如果不安装 proper-pixel-art，`generate2dsprite.py process` 会自动执行简单的 **`pixelate_postprocess()`**：

1. **Alpha 二值化**：半透明像素（alpha < 128）→ 全透明；不透明像素（alpha >= 128）→ 完全不透明（255）。消除抗锯齿毛边。
2. **强制像素网格对齐**：最近邻下采样 + 上采样（默认 grid_size=2，即 1024×1024 → 512×512 → 1024×1024），强制所有像素对齐到 2×2 网格。

**不做**：色彩量化（保留所有颜色供 UGC 调色板使用）、形态学清理（保留 AI 生成的形状细节）、轮廓描边（不改变原始形状）。

**局限**：无法处理抗锯齿渐变色和亚像素级颜色变化，边缘仍然有杂色。

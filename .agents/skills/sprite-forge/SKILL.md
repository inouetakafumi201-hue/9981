---
name: sprite-forge
description: "开发期像素/位图精灵管线（对接上游 open-source agent-sprite-forge）。用 Nano Banana API 生成 solid-#FF00FF 多行网格 raw sheet，经 generate2dsprite.py 本地后处理产出 transparent sheet、逐帧 PNG、GIF、QC 元数据。当用户要:生成像素组件/精灵/动画帧/spell包/战斗特效/位图 icon、给 2D 角色做 idle/run/attack/cast 动作 sheet、把 AI 出图切格对齐出透明资源、或跑 sprite 管线自测时使用。纯开发期工具，不碰 src/、不进产品运行时，零渲染依赖红线不动。"
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

# sprite-forge 落地实现交接（sprite-forge / 上游 agent-sprite-forge 引接）

> 本文档记录「把上游开源 2D 精灵管线引进本项目」的实现交接。交接方 = 本项目开发期素材
> 工具链。产物全部落在 `.agents/skills/sprite-forge/`，与产品和 `src/` 无关。

## 背景与裁决

用户裁定：直接使用上游 **`agent-sprite-forge`**（GitHub `0x0funky/agent-sprite-forge`，MIT，
3.8k★）作为像素/位图精灵管线，并**补齐出图适配**——把它的「宿主内置 image_gen」替换成
Nano Banana API；若适配不尽人意，用户有 Codex，可直接用 Codex 原味跑上游。

## 上游是什么 / 我们引什么

上游是一套 **Codex-first 的 2D 游戏资产工作流**，分三层：
1. Skill 规范（`generate2dsprite/SKILL.md`）——给编排 agent 出图的规划规则（多行网格、
   品红背景、主体居中、帧间等大、禁止 raw 单行 strip 做身体动画、分 body/FX sheet 等）。
2. 本地后处理脚本（`generate2dsprite.py process` 等）——确定性地切格/抠图/对齐/QC/透明导出。
3. 出图入口——上游假定宿主有内置 `image_gen`，取图自 `$CODEX_HOME/generated_images`，
   参考图用 `view_image`。

**出图引擎与后处理完全分离**：后处理脚本 1627 行不含任何出图逻辑，只吃已生成的 raw
PNG。这是我们能做「只替换输出引擎」的依据。

我们引：`generate2dsprite/SKILL.md` + `requirements.txt` + 三个脚本（原封）+ 上游 MIT 许可。
**不引** `generate2dmap`（只有它才会产 map/Godot 场景文件）与 `video2dsprite`（依赖 Grok
视频通道，非我们要的静态位图）。

## 关键实现点（相对上游的差异）

- **出图适配**（新增，我们自己的代码）：`tools/nano-banana-sprite.py`。把上游「用内置
  image_gen」这处接缝替换为调 Google Gemini 图片 API。基于上游 prompt-rules 拼多行网格
  raw sheet 提示词（solid #FF00FF、每格一帧、居中、帧间等大、留 60% 留白），产出 raw
  sheet PNG + 参数/提示词 JSON。支持 `--reference` 图生图（上一版 raw / 主视觉）做局部
  重绘、锁风格。
- **本地自测**（新增）：`tools/selftest-sprite-pipeline.py`。合成 2x2 solid-#FF00FF 品红
  raw sheet → 跑 `process --strict-qc` → 断言 4 帧、无空帧、pipeline-meta/透明 sheet 齐全。
  不发任何 API，用来证明后处理链路本机闭环。
- **Codex 兜底跑法**：上游脚本原封在仓库里，用户可直接把 `generate2dsprite/` 装进 Codex
  skills 目录让 Codex 原味跑（见 skill 正文「兜底」节）。自测已验证脚本本身可用。

## 素材库目录与演员命名（开发期约定）

角色素材是开发期可浏览、可重命名的素材，不建立额外的复杂注册系统。生成和处理脚本必须把**实际传入的素材目录**当作输入，不得把 `s1-brown`、`s2-blue` 等临时技术目录名硬编码成角色身份。

约定如下：

- 素材生成根目录的一级子目录就是可供 AI / 迭代者选择的“演员库”；AI 需要选择角色时，先扫描该根目录，再读取候选目录名、`contact` 总览和 manifest。
- 角色目录名使用人类可读的完整角色名，例如 `紫衣黑帽侦探`、`医护人员`。目录名可以包含中文，也可以在素材整理过程中直接手动改名；改名不要求同步维护 aliases、全局 ID 或额外索引文件。
- 脚本接受调用方传入的实际目录（例如 `--source "run/精灵图管线/1-成品/紫衣黑帽侦探"`），只负责生成、校验、像素化和产物登记，不根据目录名猜测玩法类型。
- 目录名负责“发现和选演员”，`frames/`、`sheet`、`contact`、`manifest` 负责“确认素材形状”；帧号、动作状态和文件路径不得塞进角色目录名。
- 角色被挂载到玩法或前端时，挂载步骤读取当时选中的目录并形成可消费的成品副本/快照。前端和运行时不在浏览器内扫描 `run/`，也不直接依赖素材库的中文路径。
- 素材库目录可继续改名；已经完成的挂载按挂载产物工作，不要求玩法代码追随素材库的后续整理改名。

这条约定只解决开发期“生成后如何被找到、选中和挂载”的流畅度，不把美术目录结构提升为玩法层或引擎层的权威数据契约。

## 当前角色生成模板（2026-08-21）

当前生效的角色换装模板是紫衣侦探的完整 16 帧整套资源：

- 目录：`run/精灵图管线/1-成品/s2-blue/`
- 参考图：`sheet.png`，完整 4×4、16 格；生成入口必须传整张 sheet。
- 单帧：`frames/f01.png` 至 `frames/f16.png`。
- 第 12 格 / `frames/f12.png` 是已经修改并验收的倒下姿态，生成与挂载不得回退到旧版第 12 帧。
- 后续更换母版时必须替换完整 16 帧和整张 sheet，并重新校验格序、背景和挂载副本；不能只替换单帧或继续使用旧 contact。
- `run/plt01/master/`、`run/Character master/master-upscaled-2048.png` 等旧路径只作为历史 provenance 保留，不是当前生成入口。

## 未完成 / 待办 / 边界

- **真实出图未验证（本轮刻意不调 API）**：Nano Banana 端到端（真出 raw sheet → process）
  需 `GEMINI_API_KEY`，本项目无该密钥，故只做了「本地后处理闭环 + 适配脚本可运行 + 提示
  词可离线预览」三级验证。**首次真出图时**要人工看：Nano Banana 的多行网格对齐与品红纯度
  是否满足上游 QC；若模型网格/品红不稳，需在 `nano-banana-sprite.py` 的 prompt 微调或在
  process 用 `--allow-source-edge-touch` 兜底。
- **google-genai 依赖未安装**：`pip install google-genai` 只在真出图前需要。自测不需要。
- **Nano Banana 只有 0.5K/1K/2K/4K 总尺寸档**（无任意 cell 尺寸）：`--cell 384` 是过程意图，
  实际总图档位由 API 决定，横竖比例用 `--aspect`。多行动作若单图超过档位，按上游建议
  每动作一张 sheet（避免大网格导致单帧过小 / 渲染走样）。
- **产出目录规范未定**：素材最终落点（跟 MapData、PrefabDef 的关系）留待产品/美术线定，
  sprite-forge 只保证「能出规范 PNG」，不做数据契约绑定。

## 验证记录（2026-08-14）

- `python selftest-sprite-pipeline.py` → PASS（4 帧、无空帧、body_scale_cv=0.0、
  anchor_y_std=0.0）。
- `nano-banana-sprite.py` 语法 OK；`PRINT_PROMPT_ONLY=1` 离线输出完整多行网格 prompt，符合
  上游规则。
- 上游脚本 `generate2dsprite.py list-options` 正常返回受支持 target/mode/NPC 角色。

## 涉及文件

```
.agents/skills/sprite-forge/SKILL.md
.agents/skills/sprite-forge/generate2dsprite/SKILL.md
.agents/skills/sprite-forge/generate2dsprite/requirements.txt
.agents/skills/sprite-forge/generate2dsprite/scripts/generate2dsprite.py
.agents/skills/sprite-forge/generate2dsprite/scripts/make_anchor_layout.py
.agents/skills/sprite-forge/generate2dsprite/scripts/make_layout_guide.py
.agents/skills/sprite-forge/tools/nano-banana-sprite.py
.agents/skills/sprite-forge/tools/selftest-sprite-pipeline.py
.agents/skills/sprite-forge/UPSTREAM-LICENSE-MIT.txt
```

> 上游来源标注：本项目 `sprite-forge` 是对开源 `agent-sprite-forge` 的适配引接；官方仓库
> `https://github.com/0x0funky/agent-sprite-forge`，MIT License，英文 README 为主。许可完整
> 文本存于 `UPSTREAM-LICENSE-MIT.txt`。

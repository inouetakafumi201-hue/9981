# 9981 项目本次变更交接说明

## 目的

由于当前 GitHub 连接未能绑定原仓库 `inouetakafumi201-hue/9981`，本文件用于说明本次工作涉及的全部文件与内容。相关文件已保留在项目工作区，并已打包为根目录下的 `handoff-9981.zip`；解包目录为 `handoff-9981/`。

## 本次主要设计结论

1. 静态物品序列帧使用 `front view`。
2. 其余静态组件使用 `front-top axonometric view`。
3. AI/NPC 直接从既有精灵图成品目录按文件夹名复用，不重新设计角色 16 帧管线。
4. 地图底图保持完整纯底图，不拆成矢量交互组件。
5. 只有需要交互的离散像素组件进入组件生成管线。
6. 地图编辑器支持临时的过渡场景框与素材占位框。
7. 编辑器导出时，根据占位框名称从底图自动导出 `crops/<id>.png`。
8. AI 读取 `MapData`、占位框名称、底图切片和玩法语义，以切片作为第一帧母图生成像素组件；后续状态帧以第一帧为母图链式生成。
9. 生成后的组件回填并绑定到占位框。过门时播放像素状态序列，在切换完成的瞬间移动角色，避免角色穿过底图中的原生门造成割裂。
10. 批量生成前必须完成玩法设计、机制实现、无头属性测试和大量用例测试，确认稳定后才生成、处理、抽验和挂载。

## 涉及文件

### 素材管线与契约

- `.agents/skills/sprite-forge/SKILL.md`
- `.agents/skills/sprite-forge/catalogs/component-types.v2.json`
- `.agents/skills/sprite-forge/fixtures/manifest.v2.minimal.json`
- `.agents/skills/sprite-forge/icon-semantics/icon-catalog.md`
- `.agents/skills/sprite-forge/icon-semantics/icon-index.json`
- `.agents/skills/sprite-forge/schemas/job.v2.schema.json`
- `.agents/skills/sprite-forge/schemas/manifest.v2.schema.json`
- `.agents/skills/sprite-forge/tools/asset-pipeline-v2.py`
- `.agents/skills/sprite-forge/tools/map-backdrop-pipeline.py`
- `.agents/skills/sprite-forge/tools/sprite-component.py`
- `.agents/skills/sprite-forge/tools/test_asset_pipeline_v2.py`

### 地图与设计规范

- `docs/v0-dev-map-editor-spec.md`
- `docs/创作系统/03_地图背景像素化生产规范.md`
- `docs/创作系统/04_sprite_forge落地交接.md`
- `docs/创作系统/05_V0混合素材生成管线规范.md`
- `docs/创作系统/06_底图原生组件占位切片与图生图替换规范.md`
- `docs/创作系统/07_底图切片图生图管线深化设计与改造方案.md`
- `docs/工程治理/挂素材MVP任务清单.md`
- `docs/表现系统/05_组件生成风格规范.md`
- `docs/表现系统/README_设计图生成指南.md`
- `docs/运营系统/07_素材库机制与元状态层全设计.md`
- `docs/V0建筑组补全prompt.md`

### 校验与测试

- `scripts/audit-icon-semantics.mjs`
- `scripts/verify-doc-consistency.mjs`
- `test/toolchain/asset-pipeline-v2/contracts.test.ts`
- `package.json`
- `AGENTS.md`

## 交接位置

- 完整相对目录副本：`handoff-9981/`
- 压缩包：`handoff-9981.zip`
- 本说明：`HANDOFF_9981_变更说明.md`

## Git 状态说明

本地提交包含上述设计和管线变更，但由于 GitHub 连接实际指向了错误的仓库，不能把“本地提交”误称为“已进入 `inouetakafumi201-hue/9981`”。后续应在正确仓库连接恢复后，将本说明、完整交接目录和对应 Git 提交同步到目标仓库。

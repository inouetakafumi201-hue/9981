将“紫衣侦探的 16 帧、且第 12 帧已修正”的整套精灵图设为当前角色生成模板，并清掉现行生成入口对旧模板的依赖。

1. 确定唯一当前模板
   - 以 `run/精灵图管线/1-成品/s2-blue/` 作为当前模板目录。
   - 以其中的 `sheet.png` 作为生成参考图：它是完整 4×4、16 帧的模板，且第 12 格已经替换为已验收的紫衣侦探修正版。
   - 以 `frames/f01.png` 到 `frames/f16.png` 作为对应单帧来源。
   - 不使用旧的 `run/plt01/master/_contact.png`、`run/plt01/master/master/_contact.png`、`master-upscaled-2048.png`，也不使用旧的 `拓印输出v2/_frames/f2-12.png` 或早期 `素材成品/pixelated/2-12.png`。
   - 保留旧目录和历史 `.raw.json` 作为历史 provenance，不删除、不篡改历史记录。

2. 修正正式副本的一致性
   - 用当前 `s2-blue/sheet.png` 同步 `run/v0-assets/characters/detective/sheet.png`，解决目前运行时副本的 `frames/f12.png` 已更新但整张 `sheet.png` 仍是旧第 12 格的问题。
   - 保持 `run/Character master/拓印输出v2/_pixelated_sheets/pixelated-sheet-2.png` 与 `素材成品/contact-2.png` 同步。
   - 用哈希和 4×4 单元校验：第 12 格必须等于新版 `f12.png` 缩放后的内容，其余 15 格不得变化。

3. 更新角色生成入口
   - 修改 `run/Character master/replicate_8calls.py` 的模板路径，改用基于 `__file__` 解析的仓库绝对路径，避免从不同工作目录运行时取错模板；同步提示词，让“16 帧整张模板、姿态顺序和第 12 帧修正版”成为明确契约。
   - 修改 `run/Character master/replicate_8calls_v2.py`，移除 `master-upscaled-2048.png` 作为现行模板的语义，统一使用新的 4×4 16 帧模板并调整输出提示词/元数据，避免单帧旧流程继续被误认为当前母版流程。
   - 修正 `run/Character master/replicate_strict.py` 的半失效逻辑：它目前只在提示词里说有 master、实际请求没有传入 master；改为实际传入新的 16 帧模板，且不再写旧模板的三向/旧姿态假设。
   - 更新 `run/Character master/mass-replication-test.py` 的模板配置与测试请求，使其不再保留指向 `plt01/master` 的死配置；如果该脚本仍维持文生图测试，则明确标记“不使用参考图”，避免把未传入请求的路径误认为生效模板。
   - 不改通用 `sprite-generate.py`、`nano-banana-sprite.py`、`sprite-pixelate.py` 的机制；它们继续通过调用方传入 `--reference`，不把某一角色硬编码进通用工具。

4. 更新文档契约
   - 在 `docs/表现系统/PLT-01_画风对齐_三维形体_提示词调色板迭代.md` 中把当前模板路径、16 帧完整集和“第 12 帧为修正版”写成现行规则；旧 `run/plt01/master` 改为历史参考说明。
   - 在 `docs/创作系统/04_sprite_forge落地交接.md` 和 sprite-forge skill 的角色参考说明中补充：当前角色生成默认读取这套完整 16 帧模板，后续替换模板时必须替换整套 16 帧，不能只换单帧或使用旧 contact。
   - 保持此前确定的素材库规则：目录名可以人工改名，生成脚本接收实际目录；这里仅更新“当前紫衣侦探模板”的内容，不引入全局 ID 或复杂注册表。

5. 验证
   - 对修改后的 Python 脚本运行语法编译检查，并做离线提示词/路径检查，不调用图像 API。
   - 检索确认现行角色生成入口不再引用旧模板路径。
   - 运行素材帧完整性、纯品红背景、16 帧数量、sheet 第 12 格一致性检查。
   - 按项目门禁运行 `npx tsc --noEmit`、相关 `npx vitest run`、`npm run lint` 和 `npm run verify:docs`，如有与本次无关的既有随机测试失败会单独记录，不掩盖结果。
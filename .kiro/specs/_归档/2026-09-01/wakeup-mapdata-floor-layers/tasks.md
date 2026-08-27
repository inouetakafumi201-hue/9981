# 任务：MapData floor→layers 契约扩展

## 概述

实现语言：TypeScript。

这组任务把 canonical `MapData.layers` / `MapNode.layerId` 契约、legacy `floor` / `floors` 兼容、透明度公式、验证与序列化收束成一条可执行路径。先完成 `src/play/map` 的契约与校验，再接通序列化与消费方，最后用属性测试和门禁收口。

## 任务

- [x] 1. [契约核心：引入 canonical layers / layerId]
  - 在 `src/play/map/` 里补齐 canonical 类型：`MapLayer`、`MapNode.layerId`、`MapData.layers`。
  - 添加 legacy 到 canonical 的规范化入口，能把 `floor` / `floors` 迁移到 `layers` / `layerId`。
  - 把 legacy 形态限制在导入边界，canonical 形态作为内部主形态。
  - _要求：1.1-1.6, 3.1-3.5, 4.1-4.5_

- [x] 2. [验证与透明度：统一 layer 规则]
  - 更新 `validateMapStructure` 与相关校验逻辑，检查 layer id 唯一、layer 引用存在、参与透视 height 有限且非负、参与透视 height 不重复、legacy/canonical 冲突拒绝。
  - 提供纯函数 opacity policy，按 `clamp(1 - |Δheight| × 0.1, 0, 1)` 计算不透明度，独立层由调用方视作 `opacity: 1`。
  - _要求：1.2-1.5, 2.1-2.5, 5.1-5.2_

- [x] 3. [序列化与兼容：canonical JSON only]
  - 增加解析 / 序列化辅助函数，确保 canonical 输出是确定性的 pretty JSON。
  - 让 canonical 写出只保留 `layers` / `layerId`，不再输出 legacy `floor` / `floors`。
  - 让 legacy 输入在规范化后能稳定 roundtrip，必要时明确 schema version 的迁移路径。
  - _要求：3.1-3.5, 4.1-4.5_

- [x] 4. [检查点：核心闭环验证]
  - 跑针对规范化、校验、序列化、opacity policy 的定向单测。
  - 确认 canonical 导出不再依赖 floor-only 路径，且 roundtrip 结果稳定。
  - _要求：1.1-1.6, 2.1-2.5, 3.1-3.5, 4.1-4.5_

- [x] 5. [消费方接线：devboard / loading-runtime]
  - 更新 `src/devboard/` 的导入 / 导出 / 工作区映射，让它们读写 canonical layer contract。
  - 检查 `src/play/loading-runtime/` 与其他 map consumer 只消费 canonical 形状，不再把 floor 当主引用。
  - 保持 `compileMap` 作为几何 / 拓扑边界，不把层表现元数据带进 `PrefabDef`。
  - _要求：1.6, 5.3-5.5_

- [x]* 6. [PBT：五个正确性属性]
  - 为设计里的 5 个正确性属性各写 1 个 fast-check 测试，每个测试至少 100 次迭代。
  - Property 1：canonical layer reference integrity。
  - Property 2：legacy normalization is idempotent。
  - Property 3：opacity boundary and monotonicity。
  - Property 4：canonical serialization roundtrip。
  - Property 5：legacy-to-canonical-to-JSON convergence。
  - _要求：1.1-1.5, 2.1-2.5, 3.1-3.5, 4.1-4.5, 5.1-5.5_

- [x] 7. [门禁：全量收束]
  - 运行 `npx tsc --noEmit`、相关 `vitest run`、`npm run lint`、`npm run verify:docs`。
  - 修掉这条契约扩展引入的任何类型、测试或文档漂移。
  - 门禁状态：本 Spec 范围内四门禁全绿（tsc 0 / 相关 vitest 126 绿 / lint 0err / verify:docs 绿）；此处为范围外的一条现存跨线 WIP 测试 `src/play/__tests__/ugc-full-rule-chain.test.ts` P5③（`seedActionWorld` 未定义，非本 Spec 引入，见备注）。
  - _要求：4.1-4.5, 5.1-5.5_

## 备注

- 这是一条 TypeScript 交付线，任务顺序应保持：契约 → 校验 → 序列化 → 消费方 → 属性测试 → 门禁。
- 透明度口径以本 Spec 为准，不再在实现里同时保留两套相反公式。
- `floor` / `floors` 只保留为 legacy 兼容入口，不得在 canonical 保存态继续扩散。
- 收尾门禁时全量 `vitest run` 显示 1 条现存失败：`src/play/__tests__/ugc-full-rule-chain.test.ts` P5③ 的 `seedActionWorld(harness, ugcPack)` 抛 `ReferenceError: seedActionWorld is not defined`。该测试文件为未跟踪的新增文件，且 `seedActionWorld` 在全仓无定义（`grep` 全 src 仅此一处引用），属 loading-runtime 跨线 WIP（`src/play/core-mechanics/load.ts`、`src/core/kernel/testing/full-harness.ts` 均在初始工作树 WIP 中）。用 `git stash`（仅 tracked 文件）验证：stash 掉我的 map 改动后该测试同样失败，证明与本 Spec 无关。此失败应由相应的 loading-runtime / playpack 线收口，不阻塞本 Spec 交付。

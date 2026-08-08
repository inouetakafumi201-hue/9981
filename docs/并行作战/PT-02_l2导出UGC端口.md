## 任务：PT-02 — l2 侧交付 UGC 消费端口，解除 wakeup-ugc task 11.1

### 1. 背景与意图
`wakeup-ugc`（`src/core/ugc`，32 测试全绿）已按"依赖端口不依赖内部形状"建好机器可校验契约 `src/core/ugc/integration/l2-port-contract.ts`（`L2PortBundle` 目标形状 + `inspectL2PortBundle` 完整性校验 + 零耦合守卫）。它现在**等 l2 侧交付真实端口**才能完成 task 11.1（真实上游集成）。本任务在 **l2 侧**实现并导出这些端口，使 UGC 能消费而**双方仍解耦**。对应主状态板 PT-02、全局报告 §三 UGC 断点。

### 2. 权威依据（先读）
- `docs/L_审查报告/交接Prompt_l2导出UGC消费端口.md`（交接项原文，列出要交付的端口清单与 `decodedValue→DefinitionPackage` 映射、内核 `Diagnostic` 投影要求）
- `docs/L_审查报告/跨Spec契约_wakeup-ugc消费l2端口.md`（跨 Spec 契约，含开工条件第六节）
- `src/core/ugc/integration/l2-port-contract.ts` 与其测试 `integration/__tests__/l2-port-contract.test.ts`（你的交付物必须满足的目标形状）
- `src/core/ugc/ports/definition-ports.ts`（端口接口权威 TS 定义）、`src/core/ugc/model/upstream.ts`
- `docs/访谈决策记录.md` **D-061**（L2 管线权威归 `src/l2`——本任务的端口应从 `src/l2` 导出，与该裁决方向一致）

### 3. 就绪确认
- 依赖已闭合：契约件 `l2-port-contract.ts` 已冻结存在（证据：文件 + 6 测试通过）；`src/l2` 的 validation/resolution/registries 实现已存在且 37 测试绿。
- 冻结：UGC 侧端口接口 `definition-ports.ts` 在本任务期内不改（你实现它，不改它）。

### 4. 允许改动的目录（白名单）
- `src/l2/ugc/`（或在 `src/l2` 下新建导出模块），提供满足 `L2PortBundle` 的 validation / resolution / registries[layer] 端口实现。
- 允许新增 l2 侧测试证明端口满足 `inspectL2PortBundle`。

### 5. 禁止触碰（黑名单）
- **不改 `src/core/ugc/**`**（那是 UGC 的交付物；若需其调整，写成交接项回流）。
- **不写"适配 l2 当前内部形状"的一次性适配器**——按端口契约实现，不依赖内部形状（架构决策原则）。
- 不动 `src/core/kernel/**`。

### 6. 行为契约
遵循 `docs/00_并行作战手册.md` §四全部 6 条。特别：依赖端口不依赖内部形状；发现职责重复先判结构/接口问题；收尾跑三条命令；禁止占位/伪代码。

### 7. DoD（可机器校验）
- [ ] l2 侧导出的端口 bundle 通过 `inspectL2PortBundle` / `isL2PortBundleReady`（新增 l2 侧测试断言）。
- [ ] `src/core/ugc/integration/__tests__/l2-port-contract.test.ts` 仍全绿（零耦合守卫不被破坏）。
- [ ] `npx tsc --noEmit` 0 错；`npx vitest run` 全绿；`npm run lint` 0 错。
- [ ] 移除 UGC 侧仅用于本地测试的临时 shape conversion（若有），改为消费真实端口。

### 8. 回流方式
- 端口交付事实 → 更新 `docs/L_审查报告/跨Spec契约_wakeup-ugc消费l2端口.md` 的"已交付"状态。
- 若发现需 UGC 侧配合改动 → 写成交接项，不直接改 `src/core/ugc`。
- 完成后在主状态板把 PT-02 标 ✅、把 wakeup-ugc task 11.1 的阻塞解除记为交接项。
- 任何新裁决诉求 → 裁决入口 `docs/L_审查报告/00_并行产出裁决与整理.md`。

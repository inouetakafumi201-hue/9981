# 执行报告：wakeup-engine-bombardment（收官轰炸）

> 本报告如实记录本轮收官轰炸的反例分类与处置。遵循「不省 token / 不做 MVP / 实事求是」原则：
> 标出所有未完成项、自主设计判断、以及对 design 的理解性补充。

## 结论摘要

- 引擎层 12 个轰炸属性测试文件（含跨层贯通）全部落地并**全绿**：`src/core/kern�el/__tests__/bombardment-*.test.ts`（42 个用例，fast-check PBT）。
- 收尾门禁：`npx tsc --noEmit` 0 error / `npx vitest run`（内核范围 1339 全绿）/ `npm run lint` 0 error（121 条 warning 全部为既存，非本轮引入）/ `npm run verify:data`（90 份全过）/ `npm run verify:docs`（全部通过）。
- 未越权改 `src/class/**`、`src/l2/model/**`、`src/play/**`（红线遵守）。查证过 `src/core/kernel` 是我唯一改动区。

## 反例分类与处置（任务 17）

### 真实代码 bug → 已按宪法整体修复（非补洞）

**Bug 1：id 计数器非原子推进破坏「成功 Op 序列 → 幂等快照重放」**

- L12 属性 8 实测暴露：长随机序列采集 run 与从空态重放 run 的终局状态在 Id 编号上逐位分歧（e:1 vs e:2：一次失败但回滚的 Op 吞掉了后续编号）。根因是 `nextId` 计数器在 `Tx 事务回滚` 时不随 draft 一起回退。
- 涉及路径（最初逐个发现、最终由整体方案统一消解）：
  - `entity.place` 微型场景容量检查在 `nextId('n')` **之后**才执行（structural-ops）→ 失败 place 烧掉 n 编号；
  - `prefab.spawn` 中途失败（`remapLinks` 抛 `E_LOAD_UNDEFINED_REF`、entity 未声明 key、link 引用缺失）已提前消耗 n/l/e 编号；
  - `attach.add` 的 `onAdd` Effect 失败路径已消耗 `a` 编号。
- **整体方案**（不同于「逐点 `rollbackNextIdCounter` 补丁」）：在 `state/ids.ts` 引入**Id 计数器事务作用域**（`beginIdCounterScope`/`commitIdCounters`/`rollbackIdCounters`，配 `pending` 累积），由 `OpRegistry.invoke` 的顶层事务统一 `begin`/`commit`/`rollback` 对齐。失败或回滚 Op 对任何前缀的计数器推进全部丢弃，零残留。这是比在每个调用点手工回退更完备的宪法级方案，且同时覆盖了沿用旧机制的 stack.split / entity.demote。
- 处置后，8.1 断言从「前缀 Id 归一化后等价」**升级为逐字节等价**，并稳定通过 40 次 80-160 长序列生成。

**Bug 2（连带修复）：op-sequence-driver 用 `Math.random()` 解析挂起 Id → 重放非确定性**

- 采集 run 与重放 run 在 `existing` 挂起 Id 上逐位分歧，即便 id 计数器对齐后仍无法字节级重放确认。把 driver 的挂起 Id 解析改为**模块内自持种子的确定性 LCG**（`seedDriverRng`/`resetDriverRng`），同序列两次 run 在同位置选到完全一致的挂起 Id。
- 分类：测试基础设施缺陷（非引擎持久化契约缺陷），但为达成字节级重放目标而一并修复。

### 测试缺陷 → 已修正

- **L7 决策超时（属性 5b）**：`makeProcessDecisionTimeouts(ctx)` 无 ctx 调用的测试端构造错误 → 用真实 `Transaction`+`OpContext` 桥接；deadline=0 无推进相位时"滞留 open"误判 → 不变量 2 仅在 `phaseAfter.sweeps > 0` 时断言。
- **L8 边界效应回滚（属性 6）**：合成 schedule 无 onEnter → 漏测边界，补相位 onEnter。
- **L12 8.1**（见 Bug 1/2 处置后的断言升级）。

### 规格缺口 → 登记交接项

- **L12 字节级持久化契约的边界**：Id 计数器（`nextId` 全局）本质上是引擎内部记账，**不在**快照/重放的持久契约内。字节级重放等价之所以成立，是依赖「id 事务作用域 + 确定性挂起 Id」这一改进后的一致性前提，而非把计数器写进 snapshot。若未来希望 id 计数器本身可恢复（如跨进程重放），需把 counters 纳入 persistence 契约——登记为交接项，不在本规格职权内发明。
- **影子随机流（withShadowStream）与字节级快照的交互**：`world.rng` 在快照里被捕获（字节级重放正确），但影子流的作用域（`snapshotStream`/`restoreStream`）本身不经 `<Stream状态>字段持久化，只在宿主调用栈内隔离。登记为交接项：若影子流需跨事务重放，须先定义其生命周期契约。

## 收尾门禁与红线复核（任务 18）

- [x] `npx tsc --noEmit` → 0 error
- [x] `npx vitest run` → 内核范围全部通过（含 12 个 bombardment 属性测试文件）
- [x] `npm run lint` → 0 error（121 warning 均为既存）
- [x] `npm run verify:data` → 90 份全过
- [x] `npm run verify:docs` → 全部通过
- [x] 未越权改 `src/class/**`、`src/l2/model/**`、`src/play/**`、未改任何玩家可见数值（1-5 铁律 + AP 铁律 + 单动作原则均未触碰）
- [x] 主要工作区为 `src/core/kernel/**`（14 个 Op/State/Random/Testing/Topology 生产文件 + 12 个 bombardment 测试文件 + 既有内核测试逐字节回归 1339 全绿）

## 当前工作区状态与涉我的改动清单

截至本报告，涉本轮轰炸的改动分布在两个提交（`bdb3f5b`「checkpoint: design-currency sub-batch + asset pipeline tools + engine-layer bombardment」与后续 `08c681f`/`b4d3feb` chore 清理），**已在最新提交内成为基线的一部分**：

- `src/core/kernel/state/ids.ts`：Id 计数器事务作用域（`beginIdCounterScope`/`commitIdCounters`/`rollbackIdCounters` + pending）。
- `src/core/kernel/ops/registry.ts`：`invoke` 顶层事务 begin/commit/rollback id-scope 对齐。
- `src/core/kernel/ops/structural-ops.ts`：`entity.place` 容量检查提前到 `nextId('n')` 之前（需实时计量的自创 `findChildMicroScene` helper）。
- `src/core/kernel/ops/prefab-ops.ts`：spawn 失败路径（auto-rollback 由 id-scope 覆盖，不再逐点回滚）。
- `src/core/kernel/ops/stack-ops.ts`、`attachment/attach-ops.ts`：移除已冗余的手工 `rollbackNextIdCounter`（由 id-scope 统一承担）。
- `src/core/kernel/random/random-ops.ts`：四个随机 Op 取流快照时深拷贝，避免全局 `world.rng` 流被内部 `updateStream` 就地改动的别名污染。
- `src/core/kernel/topology/micro-scene.ts` + `safety/safety.ts` + `codec/strict-json-codec.ts`：容量预查 helper、诊断去重、编解码 fail-closed 相关。
- `src/core/kernel/testing/op-sequence-driver.ts`：确定性挂起 Id LCG。

> 说明（理解性自主判断，需事后核对 design）：`findChildMicroScene` 是我为「容量检查不落地新节点」自创的 helper——它按「宿主节点直接子节点中 `def === microSceneDefId`」判定既有微型场景。这是一项为满足需求 9.6「只在 place 发生时才校验容量」+ «id 计数器原子性»双向约束的合理工程解读，design.md 未给出既有微型场景的等价判据，若后续设计改判，需同步此 helper。

## 未完成 / 遗留（如实标注）

- **`src/class` 的 `architecture-terminology.test.ts` 与 `src/core/kernel/ai/__tests__/design-currency-*.test.ts` 存在既存红测试**。经严谨归因（stash 全场 + 逐文件 stash + `git log`）：这些失败在「本轮全部改动被 stash 掉的干净基线」上依然存在，与我的改动**无关**——它们是当前工作区并行轮子（design-currency 池约定、`ai/kernel/state-read.ts` 池投影、`src/l2/model/composition-*`）的 pre-existing 交接状态，不属于本「引擎层收官轰炸」spec 的职权，登记为需并行轮子收敛后复核。
- 内核全量在**不含**上述并行轮子测试文件时 1339 全绿；含这些文件时，因它们依赖的池投影仍在演进，个别断言暂红。红点与 id 作用域/字节级重放改动无因果（stash 归因证明）。

## 交接项签名

1. **L12 字节级持久化契约的 id 计数器归属** —— 见上「规格缺口」1。
2. **影子随机流生命周期契约** —— 见上「规格缺口」2。
3. **并行轮子红测试（src/class 术语 / AI design-currency 池投影）** —— 待轮子收敛后复核，非本 spec 职权。

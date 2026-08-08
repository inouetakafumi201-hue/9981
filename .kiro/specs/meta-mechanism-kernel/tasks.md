# Implementation Plan

## Overview

本计划把 [design.md](design.md) 的 13 层依赖 DAG 转成可执行的编码任务序列。任务顺序严格遵循 L1→L13 的实现顺序（design.md 第 2 章）：每层完成并通过其属性测试后才能进入下一层，因为高层的正确性依赖低层不变量已经锁死（例如 L6 Action 的测试结果只有在 L3 事务原子性已验证的前提下才可信）。

实现语言为 TypeScript（strict），测试框架为 Vitest + fast-check，与 [10_技术栈.md](../../../docs/L2_基类层/10_技术栈.md) 的选型一致，全部代码位于 `src/core/kernel` 下，遵循 design.md 第 2 章给出的目录结构。所有任务止步于"阶段1：Spec→断言"（`vitest` 全绿），不涉及浏览器或渲染层验证。

## Task Dependency Graph

任务依赖关系严格对应 design.md 第 2 章的 13 层单向 DAG，`L(n)` 只能依赖 `L(1..n-1)` 已完成的成果。检查点任务（第5/9/12/16/20/23/27/32/37/41步）是每层的强制 fan-in 点：下一层任务不得在上一层检查点通过前开始。

```json
{
  "waves": [
    { "wave": 1, "tasks": [1], "note": "项目骨架，无前置依赖" },
    { "wave": 2, "tasks": [2, 3, 4], "note": "L1 State 三组并行：Value/Ref/Def、Entity/Item/Attachment、Agent/Relation，互相只有类型层引用" },
    { "wave": 3, "tasks": [5], "note": "检查点：L1 State 完整性，fan-in" },
    { "wave": 4, "tasks": [6], "note": "L1 Topology：Node/Link/Container/Slot，任务7/8的前置" },
    { "wave": 5, "tasks": [7, 8], "note": "微型场景（依赖6的Node）与度量/prefab（依赖6的Node+Container）并行" },
    { "wave": 6, "tasks": [9], "note": "检查点：L1 Topology 完整性，fan-in" },
    { "wave": 7, "tasks": [10], "note": "L2 Expr：ExprEngine，任务11的前置" },
    { "wave": 8, "tasks": [11], "note": "L2 Query：依赖10的 ExprEngine 求值 where 谓词" },
    { "wave": 9, "tasks": [12], "note": "检查点：L2 完整性，fan-in" },
    { "wave": 10, "tasks": [13], "note": "L3 Op注册表/事务/不变量，任务14/15的前置" },
    { "wave": 11, "tasks": [14], "note": "L3 属性/结构 Op 全集，依赖13的OpRegistry与Transaction" },
    { "wave": 12, "tasks": [15], "note": "L3 veto包装器，依赖13/14已注册的结构性Op" },
    { "wave": 13, "tasks": [16], "note": "检查点：L3 完整性，fan-in" },
    { "wave": 14, "tasks": [17], "note": "L4 事件分发骨架，任务18的前置" },
    { "wave": 15, "tasks": [18], "note": "L4 连锁安全，依赖17的HookDispatcher" },
    { "wave": 16, "tasks": [19], "note": "L5 Flow解释器，可与18并行但为简化依赖顺序排在其后" },
    { "wave": 17, "tasks": [20], "note": "检查点：L4/L5 完整性，fan-in" },
    { "wave": 18, "tasks": [21], "note": "L6 queryActions，任务22的前置" },
    { "wave": 19, "tasks": [22], "note": "L6 代价三态 helper，依赖21的ActionDef/CostSpec；Property 7 移至任务25（需完整Intent生命周期）" },
    { "wave": 20, "tasks": [23], "note": "检查点：L6 完整性，fan-in" },
    { "wave": 21, "tasks": [24, 25], "note": "L7 Decision 与 Intent 并行：两者定义独立结构，互相无调用依赖；Intent(25)含自第22步 helper 的代价守恒属性 Property 7" },
    { "wave": 22, "tasks": [26], "note": "L7 响应相位，依赖24/25都已完成（判断表达式同时查两者）" },
    { "wave": 23, "tasks": [27], "note": "检查点：L7 完整性，fan-in" },
    { "wave": 24, "tasks": [28, 29, 30, 31], "note": "L8 Attachment/光环、L9 Schedule、L9 Playpack装载、L9 Policy 四组并行：互相不调用彼此" },
    { "wave": 25, "tasks": [32], "note": "检查点：L8/L9 完整性，fan-in" },
    { "wave": 26, "tasks": [33, 34], "note": "L10 Random 与 L11 Knowledge 并行：随机不涉及认知，认知不涉及随机" },
    { "wave": 27, "tasks": [35], "note": "L12 Persistence，依赖33的影子流与34的visibleTo机制" },
    { "wave": 28, "tasks": [36], "note": "L12 版本迁移，依赖35的事务与快照机制" },
    { "wave": 29, "tasks": [37], "note": "检查点：L10/L11/L12 完整性，fan-in" },
    { "wave": 30, "tasks": [38, 39], "note": "L13 诊断体系与 Linter/配额并行：共享Diagnostic数据格式，非调用依赖" },
    { "wave": 31, "tasks": [40], "note": "边界不存在性架构测试，依赖38/39已定义的ErrCode与检查器" },
    { "wave": 32, "tasks": [41], "note": "检查点：L13 完整性，fan-in" },
    { "wave": 33, "tasks": [42], "note": "表现层只读通道，依赖21的queryActions与11的Query" },
    { "wave": 34, "tasks": [43], "note": "拓扑可达性与AI可计算性端到端验证，依赖全部前置层" },
    { "wave": 35, "tasks": [44], "note": "最终检查点：内核完整性验收" }
  ]
}
```

同一 wave 内的任务号互不存在真实调用依赖，可以并行开发；跨 wave 必须等前一个 wave 全部任务完成才能开始下一个 wave（对含检查点的 wave，检查点本身就是 fan-in 汇合点）。

**可安全并行的任务组**（同层内互不存在真实调用依赖，仅共享类型层面的字段声明）：

| 并行组 | 任务 | 并行依据 |
|---|---|---|
| L1 State | 2（Value/Ref/Def）∥ 3（Entity/Item/Attachment）∥ 4（Agent/Relation） | 三者定义的是独立数据结构，Entity 对 Attachment.id、Agent.controls 对 Entity Ref 的引用只是类型声明，不涉及运行时调用 |
| L1 Topology | 6（Node/Link）∥ 与 6.2（Container/Slot）可并行内部展开 | Container.owner 是 Id 类型，不需要 Node 先存在；但任务7（微型场景）必须等6.1完成，任务8必须等6.1/6.2都完成 |
| L8/L9 | 28（Attachment/光环）∥ 29（Schedule）∥ 33（Random，需等32检查点）∥ 34（Knowledge，需等32检查点） | 光环重算不调用随机数，认知查询不调用光环，互相之间没有调用关系 |
| L13 Safety | 38（诊断体系）∥ 39（Linter/配额） | ErrCode 表与 Linter 检查器共享的只是 Diagnostic 数据格式，不是调用依赖 |

**不建议并行的地方**：L2（10 Expr 与 11 Query）必须串行，因为 Query 的 `where` 表达式求值直接调用 `ExprEngine`，是真实调用依赖。L3（13/14/15）必须严格串行，因为三者共享同一个 `InvariantChecker` 与 `Transaction`，并发实现容易在"不变量检查器注册顺序"上产生竞态。L7 的 24/25 可以并行，但 26（响应相位）必须等两者都完成，因为响应相位的判断表达式要同时查 Decision 与 Intent 集合。

### 关于写操作的分层与 OpRegistry 注册（依赖倒置修正）

`OpRegistry`/`Transaction`/`InvariantChecker` 在任务 13（L3）才建立，因此**任务 13 之前的任何任务都不得调用 `OpRegistry.register` 或 `OpRegistry.invoke`**。这条约束修正了早前版本的一处依赖倒置：L1 任务（3/4/6/8）里出现的写操作（`node.create`/`node.destroy`/`link.create`/`link.destroy`/`slot.add`/`slot.del`/`prefab.spawn`/`prefab.despawn`/`relation.set`/`relation.del`/`agent.bind`/`agent.unbind`/`item.promote`/`entity.demote`）曾被表述为"实现公开 Op"甚至"注册进 OpRegistry"，而 OpRegistry 尚未存在。

修正后的分层纪律：

- **L1/L2 任务只实现纯函数式内部实现**——结构更新逻辑、纯读索引投影（如 `relOut`/`relIn`、`dist`/`spread`）、私有 helper（如 `ensureMicroScene`）。这些内部函数接收的 `OpContext` 类型声明按 [决策与风险记录.md](决策与风险记录.md) §1/§2 的同款手法置于 L1（仅类型声明，运行时事务逻辑在 L3），因此内部函数本身不依赖任务 13 的运行时。
- **将这些内部实现注册为公开 Op** —— `OpRegistry.register`、`withVeto` 包装、事务/journal/不变量接入 —— 统一在**任务 14** 完成。任务 14 是 design.md 3.4 节 Op 全集清单的唯一 `OpRegistry.register` 调用点，Op 实现内部调用各自在 L1 已完成的内部函数，不重写结构更新逻辑。
- 各 L1 任务中"实现 X"均指"实现 X 的内部实现函数"；凡必须经 `OpRegistry.invoke` 才能验证的属性测试（事务原子性、veto、跨 Op 组合），一并归入任务 14 之后（L3 检查点及后续层）。

## Tasks

- [ ] 1. 建立项目骨架与分层边界约束
  - 创建 `src/core/kernel/{state,topology,expr,ops,events,flow,actions,decision,attachment,schedule,random,knowledge,persistence,safety}` 目录及各自的 `__tests__` 子目录
  - 配置 Vitest（`vitest.config.ts`）与 fast-check 依赖
  - 编写 ESLint 依赖方向规则，强制 `kernel/L(n)` 不得 import `kernel/L(n+1..13)`（design.md 第2章的单向 DAG 约束），并强制 `src/scene`、`src/components` 不得 import `kernel/ops`、`kernel/state` 的可写接口
  - 建立任意深度嵌套 WorldState 的 fast-check arbitrary 生成器骨架（供后续所有层复用，见 design.md 6.3节），此任务只搭生成器接口占位，具体字段生成器随每层任务补充
  - _需求：43.4_

- [ ] 2. 实现 L1 State：Value/Ref/Def 与继承
  - [ ] 2.1 实现 Value/Ref 类型与 isRef 判别、Id 前缀封闭集合校验
    - 实现 `ID_PREFIXES` 常量与派生的 `IdPrefix` 类型（design.md 3.1节，唯一真相源模式）
    - 实现 `WORLD_REF`（`w:0`）常量
    - 实现写入路径对 NaN/Infinity 的拒绝与诊断产出
    - _需求：1.1、1.2、1.3、1.4_
  - [ ] 2.2 编写 Value/Ref 与 JSON 往返的属性测试
    - **Property**：*对于任意* 合法构造的 Value，`JSON.parse(JSON.stringify(v))` 应与原值深度相等
    - **Validates: Requirements 1.1, 4.2**
  - [ ] 2.3 实现 WorldState 顶层集合与只读约束
    - 定义六个顶层集合（`world`/`defs`/`nodes`/`links`/`entities`/`items`），字段标记 `readonly`
    - 验证顶层集合不包含微型场景或容器作为独立第七集合
    - _需求：1.5、1.6、1.7、1.8、1.9_
  - [ ] 2.4 实现 DefRegistry：继承展开与环检测
    - 实现 `register`/`resolve`/`isA`
    - 实现多重 `extends` 的加载期深拷贝合并（后覆盖前）
    - 实现继承环的 DFS 检测，检测到环时拒绝注册并产出诊断
    - 实现 `abstract` Def 的实例化拒绝
    - _需求：3.1、3.2、3.3、3.4、3.5_
  - [ ] 2.5 编写 Def 继承的属性测试
    - **Property**：*对于任意* 无环的 `extends` 链，`resolve()` 返回的展开结果应与手动逐层合并的结果一致；*对于任意* 构造出的环，`register` 应返回 `ok:false`
    - **Validates: Requirements 3.2, 3.4**
  - [ ] 2.6 实现 Tag 机制
    - 实现 `hasTag` 表达式算子（占位实现，供 L2 Expr 完成后接入）
    - 验证内核不维护任何固定分类枚举（架构测试：扫描 `kernel/state` 源码不存在硬编码分类联合类型）
    - _需求：4.1、4.2、4.3、4.4_

- [ ] 3. 实现 L1 State：Entity/Item/Attachment 运行时结构
  - [ ] 3.1 实现 Entity 与 Item 结构，及 node/slot 互斥
    - 实现 `Entity`/`Item` 接口（design.md 3.1节），Item 可携带命名容器
    - _需求：2.1、2.2_
  - [ ] 3.2 实现 item.promote / entity.demote 的内部实现函数
    - 只实现 Item↔Entity 转换的纯函数式内部实现（结构更新逻辑），不调用 `OpRegistry.register`；注册为公开 Op 留给任务 14（`OpRegistry` 在任务 13 建立）
    - _需求：2.3、2.4_
  - [ ] 3.3 实现 Attachment 结构与 target 泛化
    - 实现 `Attachment` 接口，`target` 可指向 Entity/Item/Node/Link/World
    - 实现 `grantedBy` 字段与级联移除函数（design.md 3.9节"光环回收"的通用版本，本任务只做数据结构与递归移除，不含 aura 逻辑）
    - _需求：2.5、2.6、2.7_

- [ ] 4. 实现 L1 State：Agent 与 Relation
  - [ ] 4.1 实现 Agent 结构与 agent.bind/agent.unbind 的内部实现函数
    - 实现 `Agent` 接口（`kind`/`controls`/`knowledgeScope`/`omniscient`/`authority`）
    - 实现 `agent.bind`/`agent.unbind` 的内部实现函数（更新 `Agent.controls`），以及 `kind` 由 `'human'` 切换为 `'ai'` 时决策来源切换到 `policy` 的逻辑（占位：policy 求值留给 L9 任务，此处只切换来源标记）
    - 注意：不调用 `OpRegistry.register`；`agent.bind`/`agent.unbind` 注册为公开 Op 留给任务 14
    - _需求：5.1、5.2、5.3、5.4、5.5、5.6、5.7_
  - [ ] 4.2 实现 Relation 结构、RelationIndex 纯读索引与 relation.set/relation.del 的内部实现函数
    - 实现 `Relation` 结构与 `RelationIndex` 的 `relOut`/`relIn` 两个纯读方法；`RelationIndex` 不对外暴露任何写方法
    - 实现 `relation.set`/`relation.del` 的内部实现函数：同时更新 `Entity.relations` 与全局 `RelationIndex` 投影。不调用 `OpRegistry.register`；注册为公开 Op 留给任务 14（design.md 3.4节 Op 全集清单要求二者是公开 Op，而非 `RelationIndex` 对外暴露的写方法）
    - 实现级联 Relation 清理的 helper 函数本身（占位：由 `entity.destroy`/`item.destroy` 的实现在 `after` 阶段调用，完整分发在 L4）
    - _需求：6.1、6.2、6.3、6.4、6.5、6.6、6.7、16.1_
  - [ ] 4.3 编写 Relation 对称性与级联清理的属性测试
    - **Property**：*对于任意* 调用 `relation.set` 的内部实现函数写入 `{a,b,k}`，`relOut(a,k)` 应包含 `b` 且 `relIn(b,k)` 应包含 `a`；*对于任意* 销毁 `a`，全部以 `a` 为端点的 Relation 应消失（本层直接调用内部实现函数验证；经 `OpRegistry.invoke` 的端到端路径在任务 16 检查点复验）
    - **Validates: Requirements 6.6, 20.8**

- [ ] 5. 检查点：L1 State 完整性
  - 运行全部 L1 属性测试与单元测试，确认 Value/Ref/Def/Entity/Item/Attachment/Agent/Relation 六类结构与继承、级联清理逻辑全部通过（本层通过直接调用内部实现函数验证；`relation.set`/`agent.bind`/`item.promote`/`entity.demote` 作为公开 Op 经 `OpRegistry.invoke` 的端到端验证在任务 16 复验，因为 OpRegistry/事务在任务 13 才建立）
  - 人工核对 `kernel/state` 模块无 import React/DOM，没有任何绕过 `readonly` 的写入路径，且未调用 `OpRegistry.register`（注册统一在任务 14）
  - 向用户报告完成情况，等待确认后继续

- [ ] 6. 实现 L1 Topology：Node/Link 与拓扑基本操作
  - [ ] 6.1 实现 Node/Link 结构与 node.create/node.destroy、link.create/link.destroy 的内部实现函数
    - 实现 `Node`/`Link` 结构与四个操作的纯函数式内部实现（不调用 `OpRegistry.register`；注册为公开 Op 留给任务 14）
    - 实现级联销毁（Node 销毁时其关联 Link 一并销毁）
    - 验证拓扑允许不连通分量
    - _需求：7.1、7.2、7.3、7.4、7.5、7.6_
  - [ ] 6.2 实现 Container/Slot 与索引连续性
    - 实现 `Container`/`Slot` 接口，`insert:'fixed'|'shift'` 两种语义
    - 实现 `slot.add`/`slot.del` 的内部实现函数（不调用 `OpRegistry.register`；注册为公开 Op 留给任务 14）
    - 实现 `accepts` 谓词接口（占位，接入 L2 Expr 后生效）
    - _需求：10.1、10.2、10.3、10.4、10.5、10.6、10.7、10.8_
  - [ ] 6.3 编写容器索引语义的属性测试
    - **Property 22: 容器索引的插入语义**
    - **Validates: Requirements 10.4, 10.5**

- [ ] 7. 实现 L1 Topology：微型场景生命周期
  - [ ] 7.1 实现 ensureMicroScene 私有 helper
    - 注意：不对外暴露独立的公开方法，只能被 `entity.place`/`prefab.spawn` 等 Op 的实现内部调用（design.md 写入通道情形b）
    - 实现 `props.creator` 溯源写入（仅一次，不作为占用判断依据）
    - _需求：9.1、9.2_
  - [ ] 7.2 实现 onMicroSceneOccupantsChanged 私有 helper
    - 注意：只能被 `entity.place`/`prefab.despawn` 等 Op 的实现内部调用，不注册为独立 Op、不对外暴露
    - 实现基于 Query 现查占位者数量（不维护派生计数字段）
    - 实现占位者归零时调用 `node.destroy` 的内部实现完成卸载
    - 实现 `props.capacity` 仅在 `entity.place` 时校验
    - 实现父节点销毁时的级联卸载
    - 验证结构性共享微型场景与普通微型场景走同一套生命周期规则
    - _需求：9.3、9.4、9.5、9.6、9.7、9.8、16.1_
  - [ ] 7.3 编写微型场景生命周期的属性测试
    - **Property 21: 微型场景生命周期的占用者驱动**
    - **Validates: Requirements 9.3-9.5**

- [ ] 8. 实现 L1 Topology：度量、扩散与子图实例化
  - [ ] 8.1 实现 dist 与 spread
    - 实现加权最短路 `dist`（支持 `via`/`maxCost`），不连通时返回 `null`
    - 实现 `spread`，返回按强度降序、NodeId 升序的有序数组
    - _需求：11.1、11.2、11.3、11.4、11.5、11.6、11.7_
  - [ ] 8.2 实现 prefab.spawn / prefab.despawn 的内部实现函数
    - 实现蓝图内部 key 到实际 Id 的重映射
    - 实现 `attachTo` 接缝逻辑
    - 实现 `despawn` 的级联回收与占位者疏散
    - 注意：不调用 `OpRegistry.register`；注册为公开 Op 留给任务 14
    - _需求：8.1、8.2、8.3、8.4、8.5、8.6、8.7_
  - [ ] 8.3 编写 dist/spread 与 prefab 往返的属性测试
    - **Property**：*对于任意* `prefab.spawn` 后立即 `prefab.despawn`，`WorldState` 的节点/边/实体集合应恢复到 spawn 前的等价状态（不计 id 分配计数器）
    - **Validates: Requirements 8.4, 8.5**

- [ ] 9. 检查点：L1 Topology 完整性
  - 运行全部 L1 Topology 属性测试，确认拓扑、容器、微型场景、prefab 全部通过（本层直接调用内部实现函数验证）
  - 确认第 1 步搭建的任意深度嵌套 WorldState 生成器能够生成含多层微型场景与容器嵌套的合法状态
  - 确认 `kernel/topology` 未调用 `OpRegistry.register`（`node.create`/`link.create`/`slot.add`/`prefab.spawn` 等作为公开 Op 的注册统一在任务 14），其经 `OpRegistry.invoke` 的端到端验证在任务 16 复验
  - 向用户报告完成情况，等待确认后继续

- [ ] 10. 实现 L2 Expr：表达式求值器
  - [ ] 10.1 实现 ExprEngine 与内置算子封闭表
    - 实现字面量/path/var/op/q/call 六种形态的求值
    - 实现算术、比较、逻辑、空值、字符串、表、拓扑、状态、关系、认知各类内置算子（design.md 3.3节算子表，认知类算子先占位，L11 完成后接入）
    - 注意：`roll`/`pick`/`shuffle`/`weightedPick` 不属于此算子表，不得实现在此处——它们是 L10（第33步）注册的公开 Op，因为其求值会推进随机流状态，不满足 Expr 全函数/无副作用的要求（design.md 3.3节"分类修正"，需求12.8/35.5）
    - 实现越界读取返回 `null`、除零返回 `null`
    - 实现 `isA` 算子
    - 验证内置算子表不可运行期扩展，且不含随机类算子名
    - _需求：12.1、12.2、12.3、12.4、12.5、12.6、12.7、12.8_
  - [ ] 10.2 编写 Expr 全函数性的模糊测试
    - **Property 2 的姊妹测试**：*对于任意* 结构随机但类型合法的 Expr AST 与任意 EvalContext，`eval` 都不应抛出异常
    - **Validates: Requirements 12.1**
  - [ ] 10.3 实现具名表达式（kind:'expr'）与调用图环检测
    - 实现 `ExprDef` 注册，`pure` 恒真校验（body 不得含 `q` 之外的 Op 调用形态）
    - 实现调用图 DFS 环检测，接入 `DefRegistry.register`
    - 实现求值深度计入总预算
    - 实现玩法包 `overrides` 替换具名表达式的接入点（占位，完整装载逻辑在 L9）
    - _需求：13.1、13.2、13.3、13.4、13.5_
  - [ ] 10.4 编写具名表达式环检测的属性测试
    - **Property**：*对于任意* 构造出的具名表达式调用环，`DefRegistry.register` 应拒绝并产出 `E_EXPR_CALL_CYCLE`
    - **Validates: Requirements 13.3**

- [ ] 11. 实现 L2 Query：查询引擎
  - [ ] 11.1 实现 QueryEngine.run
    - 实现十种 `from` 取值的数据源分发（`log` 先占位返回空集，L12 完成后接入）
    - 实现 `where`/`in`/`orderBy`/`desc`/`limit` 过滤与排序
    - 实现 `visibleTo` 过滤占位（L11 完成后接入具体 `visibility` 求值）
    - _需求：14.1、14.2、14.3、14.4、14.5_
  - [ ] 11.2 编写 Query 一致性的属性测试
    - **Property**：*对于任意* Query 与任意合法 WorldState，`run` 返回结果集中的每个 Ref 都应满足 `where` 谓词，且结果顺序与 `orderBy`/`desc` 声明一致
    - **Validates: Requirements 14.1-14.4**

- [ ] 12. 检查点：L2 Expr/Query 完整性
  - 运行全部 L2 属性测试，确认表达式求值器与查询引擎正确
  - 向用户报告完成情况，等待确认后继续

- [ ] 13. 实现 L3 Ops：Op 注册表、Result 与事务
  - [ ] 13.1 实现 OpRegistry 与 Result 类型
    - 实现 `register`/`invoke`
    - 验证全部结构区字段的 `readonly` 约束（编译期测试：尝试绕过 Op 直接赋值应无法通过 `tsc`）
    - _需求：16.1、16.2、16.3、16.4_
  - [ ] 13.2 编写 Op 永不抛异常的属性测试
    - **Property 2: Op 永不抛异常**
    - **Validates: Requirements 16.2, 16.3**
  - [ ] 13.3 实现 Transaction（begin/commit/rollback）与 journal 记录
    - 实现 `logOp` 记录 Op 及其逆操作
    - _需求：21.1、21.2_
  - [ ] 13.4 实现 InvariantChecker 的 16 条不变量检查器
    - 逐条实现需求20列出的16条不变量检查函数（引用完整性、单一容纳、单一位置、位置互斥、无环容纳、拓扑一致、父子一致、关系对称、容器双向一致、槎位索引连续、堆叠守恒、代价守恒、附属一致、堆叠有界、决策有终、数值有界）
    - 实现 `commit()` 在提交前调用 `checkAll`，任一失败则整体回滚
    - _需求：20.1、20.2、20.3、20.4、20.5、20.6、20.7、20.8、20.9、20.10、20.11、20.12、20.13、20.14、20.15、20.16、20.17_
  - [ ] 13.5 编写不变量恒成立与事务原子性的属性测试
    - **Property 3: 事务的原子性**
    - **Validates: Requirements 21.3, 21.4**
    - **Property 4: 不变量在提交后恒成立**
    - **Validates: Requirements 20.1-20.17**

- [ ] 14. 实现 L3 Ops：属性/结构类 Op 全集
  - [ ] 14.1 实现属性类 Op
    - `prop.set`/`prop.del`/`prop.add`（尊重 `clamp`）/`list.insert`/`list.remove`/`tag.add`/`tag.del`
    - _需求：16.5_
  - [ ] 14.2 实现 item.move 作为唯一转移原语
    - 实现缺省槎位选取（按索引顺序取第一个合法且为空的槎位）
    - 实现无合法槎位时返回 `ok:false`，不落地不吞掉
    - 验证拾取/丢弃/装备/卸下/买卖/交易全部复用此 Op，不新增专用转移 Op
    - _需求：10.9、10.10、16.6、16.7_
  - [ ] 14.3 实现 stack.split / stack.merge 的原子性
    - 实现单事务内的"扣减-创建-放置"三步，任一步失败整体回滚
    - 验证堆叠总量守恒（同 DefId 总量仅因 create/destroy 改变）
    - 实现 GUI 拖拽输入的不可信校验路径（与其他来源同一路径，无特殊分支）
    - _需求：17.1、17.2、17.3、17.4、17.5_
  - [ ] 14.4 编写堆叠拆分原子性的属性测试
    - **Property 5: 堆叠总量守恒**
    - **Validates: Requirements 17.4**
    - **Property 6: 拆分失败即整体回滚**
    - **Validates: Requirements 17.1-17.3**
  - [ ] 14.5 实现 entity.setDef 与 node.merge/node.split
    - 实现 `carry` 字段选择器驱动的引用迁移（先接管引用再销毁来源）
    - _需求：18.1、18.2、18.3、18.4、18.5_
  - [ ] 14.6 编写变身与节点合并引用完整性的属性测试
    - **Property**：*对于任意* `entity.setDef` 或 `node.merge` 调用，调用前指向旧对象的全部 Relation/Attachment/Container 引用，调用后都应指向新对象（`carry` 声明的字段集合），不应产生悬空引用
    - **Validates: Requirements 18.5, 20.1**
  - [ ] 14.7 将 L1 已实现的结构类/关系类/认知类 Op 内部实现注册为公开 Op（依赖倒置修正的落点）
    - 通过 `OpRegistry.register` 注册以下 Op，每个 Op 的实现内部调用其在 L1 已完成的内部实现函数，不重写结构更新逻辑：`node.create`/`node.destroy`/`link.create`/`link.destroy`（任务 6.1）、`slot.add`/`slot.del`（任务 6.2）、`prefab.spawn`/`prefab.despawn`（任务 8.2）、`relation.set`/`relation.del`（任务 4.2）、`agent.bind`/`agent.unbind`（任务 4.1）、`item.promote`/`entity.demote`（任务 3.2）
    - 为其中的结构性 Op 套上第 15 步的 `withVeto` 包装（若本步先于 15 完成则留接口占位），全部经 `Transaction` 提交并写入 journal，提交前过 `InvariantChecker`
    - 验证 `OpRegistry.register` 的调用点与 design.md 3.4节 Op 全集清单逐一对应，且 L1/L2 层源码中不存在任何 `OpRegistry.register` 调用（架构测试）
    - _需求：5.2、6.6、7.3、7.4、8.1、8.4、10.7、16.1、16.6_

- [ ] 15. 实现 L3 Ops：结构性 Op 否决机制
  - [ ] 15.1 实现 withVeto 包装器
    - 实现 `before`/`after` 事件的发出点（占位，完整 Hook 分发逻辑在 L4；此任务只搭事件发出与取消信号的接口）
    - 实现 veto 返回时该 Op 不产生任何状态改动（`ok:false, code:'E_OP_VETOED'`，事务零改动回滚）
    - 验证内核代码本身不包含负重、容量等具体约束
    - _需求：19.1、19.2、19.3、19.4_
  - [ ] 15.2 编写 veto 零状态改动的属性测试
    - **Property 24: before Hook 否决后状态零改动**
    - **Validates: Requirements 19.2, 19.4**
    - 注：此前版本没有为需求19（否决机制）编写任何属性测试，只靠 Property 3（事务原子性）间接覆盖"标记为致命"的失败，但 veto 是否算致命未明确，此处补一条专门针对 veto 路径的属性

- [ ] 16. 检查点：L3 Ops/Transactions 完整性
  - 运行全部 L3 属性测试，确认 Op 注册表、事务、16 条不变量、item.move 统一转移、stack.split 原子性、变身/合并引用迁移全部通过
  - 确认任务 14.7 已把 L1 内部实现函数注册为公开 Op，`relation.set`/`agent.bind`/`item.promote`/`entity.demote`/`node.create`/`link.create`/`slot.add`/`prefab.spawn`/`prefab.despawn` 等经 `OpRegistry.invoke` 的端到端路径（事务/不变量/veto 包装/journal）全部通过；复验任务 4.3 的 Relation 对称性在注册后的 Op 路径上仍成立
  - 向用户报告完成情况，等待确认后继续

- [ ] 17. 实现 L4 Events/Hooks：事件与五阶段分发
  - [ ] 17.1 实现 Event 结构与 HookDispatcher 骨架
    - 实现 `cause` 因果链字段
    - 实现 `before → modify → instead → default → after` 固定调度顺序
    - _需求：23.1、23.2、23.3、23.4、23.5、23.7_
  - [ ] 17.2 实现 instead 阶段的排序裁决
    - 实现 `(priority, 宿主容器索引, 槎位索引, defId)` 四元组排序，取第一个通过者，其余不参与
    - _需求：23.6_
  - [ ] 17.3 实现 RuleDef 与三种挂载生命周期
    - 实现 `RuleDef` 结构
    - 验证同一结构在 PlaypackDef 全局常驻、AttachmentDef.rules 状态期、attach.add(world,mod) 运行期开关三种挂载下正确工作（占位：AttachmentDef/PlaypackDef 完整逻辑在 L8/L9，此处验证 RuleDef 本身不因挂载方式而分叉）
    - _需求：23.8、23.9_
  - [ ] 17.4 实现单条 Hook 失败隔离
    - 实现 dispatch 内部对每个候选 Hook 的 try/catch 包裹，捕获异常只跳过该 Hook 并记录 warn 诊断
    - _需求：23.10_
  - [ ] 17.5 编写 instead 裁决与单条失败隔离的属性测试
    - **Property 25: instead 阶段的排他执行**
    - **Validates: Requirements 23.6**
    - **Property**：*对于任意* 一条内部报错的 Hook 与同一事件的其余合法 Hook，dispatch 应继续执行其余 Hook 并返回正常结果
    - **Validates: Requirements 23.10**

- [ ] 18. 实现 L4 Events/Hooks：连锁安全
  - [ ] 18.1 实现事件连锁深度上限与重置
    - 实现 `depth` 自增、超限拒绝并诊断、事务提交边界重置
    - _需求：24.1、24.2、24.3_
  - [ ] 18.2 实现同优先级确定性排序与重入锁
    - 实现 `(priority, defId)` 字典序执行
    - 实现同一 `(type, hookId)` 组合的重入拒绝
    - _需求：24.5、24.6_
  - [ ] 18.3 编写连锁可终止性与重入拒绝的属性测试
    - **Property 14: 连锁深度上限的可终止性**
    - **Validates: Requirements 24.1-24.2**
    - **Property 26: Hook 重入拒绝**
    - **Validates: Requirements 24.6**

- [ ] 19. 实现 L5 Flow：效果脚本解释器
  - [ ] 19.1 实现 FlowInterpreter 十种 Effect 形态
    - 实现 op/let/if/forEach/while/emit/after/at/try/abort
    - 验证不提供函数定义、递归、闭包
    - _需求：22.1、22.3_
  - [ ] 19.2 实现 step 预算与 maxIter 强制
    - 实现每条 Effect（含每次迭代）计入 step 计数器，超预算中止并诊断
    - 实现 `while` 缺失 `maxIter` 的运行期防御性拒绝（加载期 Linter 版本留给 L13）
    - _需求：22.4、22.5、22.6_
  - [ ] 19.3 编写 Flow 终止性的属性测试
    - **Property 15: Flow 的 step 预算终止性**
    - **Validates: Requirements 22.4-22.5**

- [ ] 20. 检查点：L4 Events/Hooks 与 L5 Flow 完整性
  - 运行全部 L4/L5 属性测试，确认事件分发、连锁安全、Flow 解释器全部通过
  - 向用户报告完成情况，等待确认后继续

- [ ] 21. 实现 L6 Actions：ActionDef 与 queryActions
  - [ ] 21.1 实现 ActionCatalog.queryActions 的 ui/ai 双模式
    - 实现 `require`/`visible`/`reason` 的过滤与灰显逻辑
    - 实现同一份实现同时服务 UI 菜单、AI 着法生成、网络校验、模糊测试采样
    - _需求：25.1、25.2、25.3、25.4、25.5_
  - [ ] 21.2 实现 TargetSpec 的 range/count 展开
    - 实现 `mode:'ai'` 下的有限点采样（边界值、当前可承担最大值、step 网格点）
    - 实现 `mode:'ui'` 下的完整区间返回
    - _需求：25.6、25.7_
  - [ ] 21.3 编写 queryActions 双模式一致性的属性测试
    - **Property 13: queryActions 对 UI/AI 模式的一致性**
    - **Validates: Requirements 25.3, 44.1**

- [ ] 22. 实现 L6 Actions：代价三态 helper
  - [ ] 22.1 实现 freezeCost/settleCost/refundCost 私有 helper
    - 注意：三者是 `intent.submit`/`intent.resolve`/`intent.void`（第25步）三个 Op 内部调用的私有函数，不包成独立组件对外暴露公开方法（design.md 写入通道情形b）。本步只实现 helper 本身；其守恒性属性（Property 7）依赖完整的 Intent 提交→解算/退回生命周期，因此移至第 25 步与 Intent Op 一同验证——修正此前把 Property 7 放在本步（第22步）却依赖尚未实现的第 25 步 Intent Op 的依赖倒置
    - 实现四种 CostSpec（pool/items/attach/custom）的冻结与结算
    - 实现 `cost.refunded` 诊断产出
    - 验证不存在静默退回路径
    - _需求：26.1、26.2、26.3、26.4、26.5、26.6、16.1_

- [ ] 23. 检查点：L6 Actions 完整性
  - 运行全部 L6 属性测试，确认 queryActions 与代价泛化正确
  - 向用户报告完成情况，等待确认后继续

- [ ] 24. 实现 L7 Decision：一等状态对象
  - [ ] 24.1 实现 decision.open / decision.answer 两个公开 Op
    - 注意：必须注册进 `OpRegistry`（design.md 3.4节 Op 全集清单），不得包成独立组件对外暴露 `openDecision`/`answer` 方法
    - 实现立即返回、不阻塞
    - 实现 `DecisionDef.quorum`（all/any/majority）判定
    - 实现待答 Decision 出现在 `queryActions` 结果中
    - _需求：27.1、27.2、27.5、27.6、16.1_
  - [ ] 24.2 实现 onResolve 前提重检与 onVoid
    - 实现在新事务中执行 `onResolve`，执行前重新校验 `ctx` 快照对象的存在性
    - 实现前提失效时转 `onVoid`
    - _需求：27.3、27.4_
  - [ ] 24.3 实现 deadline 超时处理
    - 实现超过 `deadline` 时按 `onTimeout` 处理并推进相位（占位：相位推进本体在 L9 的 `schedule.advance`，此处只实现 Decision 侧的超时状态转换）
    - _需求：27.7_
  - [ ] 24.4 编写 Decision 不阻塞、前提重检与 onResolve 对称性的属性测试
    - **Property 8: Decision 永不阻塞**
    - **Validates: Requirements 27.2-27.3**
    - **Property 27: Decision 的 onResolve 前提重检对称于 Intent**
    - **Validates: Requirements 27.4**

- [ ] 25. 实现 L7 Intent：提交与解算分离
  - [ ] 25.1 实现 intent.submit / intent.resolve 两个公开 Op
    - 注意：必须注册进 `OpRegistry`，不得包成独立组件对外暴露 `submitIntent`/`resolveIntent` 方法
    - 实现解算前重跑 `require`，失败置 `void` 并在同一 Op 事务内调用第22步的 `refundCost` helper
    - _需求：29.1、29.2、29.3、29.4、16.1_
  - [ ] 25.2 实现 hidden Intent 的可见性隔离
    - 实现 `hidden:true` 的 Intent 在 `queryActions` 与 `Query(from:'intents')` 对非本人 Agent 不可见
    - _需求：29.5_
  - [ ] 25.3 实现 resolveOrder 与禁止 simultaneous
    - 实现 `ScheduleDef.resolveOrder` 表达式驱动的多 Intent 解算排序
    - 验证内核不提供任何 `order:'simultaneous'` 或真正同时结算的机制
    - 验证 Intent 可被存档、回放、AI 搜索（占位断言，完整持久化在 L12）
    - _需求：29.6、29.7、29.8_
  - [ ] 25.4 编写 Intent 重检与隐藏性的属性测试
    - **Property 9: Intent 解算前必重检 require**
    - **Validates: Requirements 29.3-29.4**
    - **Property 10: 隐藏 Intent 的不可见性**
    - **Validates: Requirements 29.5**
  - [ ] 25.5 编写代价守恒的属性测试（自第 22 步移入：Property 7 需完整的 Intent 提交→解算/退回生命周期，而该生命周期在本步才具备）
    - 依赖第 22 步的 `freezeCost`/`settleCost`/`refundCost` helper 与本步的 `intent.submit`/`intent.resolve`/`intent.void`
    - **Property 7: 代价冻结与结算守恒**
    - **Validates: Requirements 26.2-26.6, 20.12**

- [ ] 26. 实现 L7 响应相位支撑
  - [ ] 26.1 实现响应相位判断表达式的查询接口
    - 实现"是否存在以我为目标、已被反应 Intent 引用的 pending Intent"的查询表达式支持
    - 验证内核不允许在 before/其他 Hook 阶段内调用 decision.open 并等待结果（架构测试：`HookDispatcher` 内部不导出任何等待类型）
    - _需求：28.1、28.4_
  - [ ] 26.2 实现 reactionRounds 常量校验占位
    - 实现 `PhaseDef.kind:'response'` 与 `reactionRounds` 的类型接口（完整加载期 Linter 强制留给 L13，完整相位推进留给 L9）
    - _需求：28.2、28.3、28.5_

- [ ] 27. 检查点：L7 Decision/Intent 完整性
  - 运行全部 L7 属性测试，确认 Decision 不阻塞、Intent 重检与隐藏性、响应相位判断接口全部通过
  - 向用户报告完成情况，等待确认后继续

- [ ] 28. 实现 L8 Attachment：状态与光环
  - [ ] 28.1 实现 Attachment 生命周期（stack 策略/delay/expiresAt）
    - 实现 `stack:'unique'|'refresh'|'count'|'independent'` 四种策略
    - 实现 `delay`/`activeAt` 的未生效判定（规则不挂载、光环不授予、hasAttachment 返回假）
    - _需求：30.1、30.8_
  - [ ] 28.2 实现 AuraEngine 触发器与光环授予/回收的 Op 化落地
    - 注意：`AuraEngine` 本身不持有写权限，只是事件驱动的重算触发器；差集运算得出的授予/回收结果必须通过调用 `attach.add`/`attach.del` 的内部实现落地（design.md 写入通道情形b），不得让 `AuraEngine` 自己直接改写 `attachments` 集合
    - 实现拓扑变化触发的无条件重算（订阅 `entity.place`/`node.merge`/`node.split` 的 after Hook）
    - 实现 `aura.deps` 声明的属性路径变化触发的定向重算（订阅 `prop.set` 的 after Hook）
    - 实现未声明 deps 的属性变化不触发重算
    - 实现重算与触发它的 Op 共享同一事务（光环授予失败应导致触发该重算的 Op 整体回滚）
    - _需求：30.2、30.3、30.4、30.5、16.1_
  - [ ] 28.3 实现 grantedBy 级联回收
    - 复用第 3 步实现的递归移除函数，作为 `attach.del` Op 唯一的内部实现，不对外单独暴露
    - 接入光环失效场景
    - _需求：30.7、16.1_
  - [ ] 28.4 编写光环重算与级联回收的属性测试
    - **Property 11: 光环差集重算的正确性**
    - **Validates: Requirements 30.2-30.4**
    - **Property 12: grantedBy 级联回收完整性**
    - **Validates: Requirements 30.7, 20.13**

- [ ] 29. 实现 L9 Schedule：回合表与相位推进
  - [ ] 29.1 实现 schedule.advance 公开 Op
    - 注意：相位推进会修改 `turn.phaseIndex`/`turn.phaseEnteredAt`，必须注册进 `OpRegistry` 为公开 Op（design.md 3.10节修补），不得实现为独立的 `ScheduleRunner` 组件方法
    - 实现"input 齐 或 timeLimit 到期"为唯一推进条件，不满足时该 Op 返回 `ok:false`（不是静默无动作）
    - 实现 `phases` 表驱动，内核不对"回合"赋予语义
    - 接入 L7 的 Decision `onTimeout`
    - _需求：31.1、31.2、31.3、31.4、31.5、31.6、16.1_
  - [ ] 29.2 实现响应相位的完整接线
    - 接入第 26 步的响应相位判断接口，实现 `reactionRounds` 轮次耗尽后强制进入解算相位（均在 `schedule.advance` 的 Op 实现内部完成）
    - _需求：28.5_
  - [ ] 29.3 编写相位推进条件的属性测试
    - **Property**：*对于任意* 相位与任意未齐的 `input` 状态，`OpRegistry.invoke('schedule.advance', {})` 应返回 `ok:false`；*对于任意* `timeLimit` 到期状态，应按 `onTimeout` 处理后推进并返回 `ok:true`
    - **Validates: Requirements 31.4-31.5**

- [ ] 30. 实现 L9 Playpack：装载与 MOD 叠加
  - [ ] 30.1 实现 PlaypackDef 结构与 PoolDef/OutcomeDef
    - 实现玩法包不内置任何数值池，全部通过 `pools` 声明
    - 实现 `outcomes[]` 取代单一胜负布尔，`scope:'agent'`+`ends:false` 场景
    - _需求：32.1、32.2、32.3、32.4、32.5、32.6、32.7、32.8_
  - [ ] 30.2 实现 PlaypackLoader 五步装载算法
    - 实现 `requires` 拓扑排序与环检测
    - 实现 `conflicts` 交集检测
    - 实现 Def 集合按拓扑序合并与 `overrides` 应用
    - 实现 Hook 排序键追加包序
    - 实现全部包 linter 运行，失败聚合报告（不短路）
    - _需求：33.1、33.2、33.3、33.4、33.5、33.6_
  - [ ] 30.3 编写装载期冲突检测与包序确定性的属性测试
    - **Property 19: 装载期冲突优先于运行期崩溃**
    - **Validates: Requirements 33.1-33.3, 33.5**
    - **Property 23: 玩法包叠加顺序的确定性**
    - **Validates: Requirements 33.4**
    - 注：此前版本 Property 19 的验证标注误写为覆盖 33.1-33.5，但其正文只涉及循环依赖/冲突交集/linter 失败三种拒绝场景；33.4（包序确定性）由 Property 23 单独覆盖，两条属性合起来才是需求33的完整覆盖，编写测试时不要漏掉 Property 23

- [ ] 31. 实现 L9 Policy：NPC 决策策略
  - [ ] 31.1 实现 PolicyDef 三种 mode
    - 实现 `mode:'rules'` 对 `queryActions(actor,'ai')` 输出的打分选取
    - 实现 `mode:'scripted'` 的 FlowInterpreter 直跑
    - 实现 `fallback` 的转向逻辑
    - _需求：34.1、34.2、34.4、34.6_
  - [ ] 31.2 实现 mode:'search' 与 budget 约束（占位对接 checkpoint/restore）
    - 实现 `search.budget` 超支时返回当前最优着法（此任务先用占位的 checkpoint/restore 接口，L12 完成后接入真实实现）
    - _需求：34.3、34.5、34.7_
  - [ ] 31.3 编写 PolicyDef 新增 Action 自动可用性的属性测试
    - **Property**：*对于任意* 满足某条 `rules[].when` 的新增 ActionDef，`evalRulesPolicy` 在不修改 PolicyDef 本身的前提下应将其纳入评分候选
    - **Validates: Requirements 34.2, 44.2**

- [ ] 32. 检查点：L8 Attachment 与 L9 Schedule/Playpack/Policy 完整性
  - 运行全部 L8/L9 属性测试，确认光环、回合表、玩法包装载、NPC 策略全部通过
  - 向用户报告完成情况，等待确认后继续

- [ ] 33. 实现 L10 Random：确定性随机
  - [ ] 33.1 实现 random.roll/random.pick/random.shuffle/random.weightedPick 四个公开 Op
    - 注意：这四个操作会推进 `RngStream.counter`，是状态写入，必须注册进 `OpRegistry`（design.md 3.4/3.11节修补），不得实现为独立组件方法，也不得纳入 L2 Expr 的内置算子表（对应第10.1步已标注的分类修正）
    - 实现命名流参数强制
    - 实现流状态纳入 WorldState
    - _需求：35.1、35.2、35.3、35.5、16.1_
  - [ ] 33.2 实现 withShadowStream 影子流
    - 实现试探期间 `random.*` 系列 Op 读写影子流而不推进主流 counter（`withShadowStream` 本身不是 Op，见 design.md 3.11节说明）
    - _需求：35.4_
  - [ ] 33.3 编写随机确定性与影子流隔离的属性测试
    - **Property 16: 随机流的确定性回放**
    - **Validates: Requirements 35.3, 37.3**
    - **Property 17: 影子流不污染主流**
    - **Validates: Requirements 35.4**
    - **Property 30: random.* 系列 Op 不出现在 Expr 求值路径中**
    - **Validates: Requirements 12.8, 35.5**

- [ ] 34. 实现 L11 Knowledge：信息不对称
  - [ ] 34.1 实现 KnowledgeStore 纯读方法（getFacts/knows）
    - 注意：不实现 `setFact` 方法——写入 `facts` 直接复用第14.1步已实现的 `prop.set` Op（`path` 指向 `knowledge.${scopeId}.facts.${key}`），不新增第二条写入路径（design.md 3.12节修补）
    - 实现 `facts` 值域为任意 Value，不做真值校验
    - 实现 `knows`
    - _需求：36.1、36.2、36.3、36.4、16.1_
  - [ ] 34.2 实现 visibleTo 过滤接入 QueryEngine
    - 接入第 11 步的 QueryEngine 占位逻辑，实现 `visibility` 表达式求值过滤
    - 验证 AI 与人类玩家共用同一查询接口，差异仅在 `visibleTo` 参数
    - _需求：36.5、36.6、需求 44.3_
  - [ ] 34.3 编写认知查询一致性的属性测试
    - **Property**：*对于任意* 非 `omniscient` 的 Agent 发起的 Query，结果集不应包含其 `visibility` 谓词判定为不可见的对象
    - **Validates: Requirements 36.5**

- [ ] 35. 实现 L12 Persistence：快照与回放
  - [ ] 35.1 实现 snapshot 与结构共享
    - 实现不可变、结构共享的快照
    - _需求：37.1_
  - [ ] 35.2 实现 journal 与 replay
    - 实现每个 Op 及其逆操作的记录
    - 实现 `replay(seed, ops)`
    - _需求：37.2、37.3_
  - [ ] 35.3 实现 checkpoint/restore 并接入 L9 Policy 的 search 模式
    - 注意：`checkpoint`/`restore`/`rewind`/`replay` 属于写入通道情形(d)（切换整个 `WorldState` 引用，不是修改字段），不注册进 `OpRegistry`，但仍只能在事务边界之间调用（design.md 3.13节分类标注）
    - 回填第 31 步的占位接口为真实实现
    - _需求：37.5_
  - [ ] 35.4 实现 rewind 与 AI 试探三项隔离
    - 实现 `rewind(phases)`
    - 实现试探期间随机走影子流、Query 强制 visibleTo、after 阶段表现层订阅静默
    - _需求：37.4、37.6、37.7_
  - [ ] 35.5 实现有界日志与 Query(from:'log') 接入
    - 回填第 11 步的 `from:'log'` 占位逻辑
    - 实现 `PlaypackDef.logRetention` 驱动的保留窗口
    - _需求：15.1、15.2、15.3、15.4_
  - [ ] 35.6 编写快照不可变性与随机确定性回放的属性测试
    - **Property 18: 快照的结构共享与不可变性**
    - **Validates: Requirements 37.1**

- [ ] 36. 实现 L12 版本迁移
  - [ ] 36.1 实现 MigrationDef 与装载时序比对
    - 实现版本相同/较旧有迁移链/较旧无迁移链/更新四种分支
    - 实现迁移在专属事务中执行，失败按 `onFail` 处理
    - 验证不支持对局中热更换玩法包
    - _需求：38.1、38.2、38.3、38.4、38.5、38.6、38.7_
  - [ ] 36.2 编写版本迁移分支覆盖的单元测试与事务性属性测试
    - 覆盖四种版本比对分支各至少一个具体用例
    - **Property 28: 版本迁移的事务性**
    - **Validates: Requirements 38.4, 38.5**
    - 注：此前版本没有为迁移的事务性/回滚编写任何属性测试，只在 Testing Strategy 里被列为单元测试示例但未覆盖 `onFail` 两种分支的状态一致性，此处补齐

- [ ] 37. 检查点：L10 Random、L11 Knowledge、L12 Persistence 完整性
  - 运行全部相关属性测试，确认随机、认知、持久化、版本迁移全部通过
  - 向用户报告完成情况，等待确认后继续

- [ ] 38. 实现 L13 Safety：诊断体系
  - [ ] 38.1 实现 ERR_CODES 唯一真相源与 ErrCode 派生类型
    - 实现 `ERR_CODES` 常量表与派生的 `ErrCode`/`FATAL_PREFIXES`
    - _需求：39.5、39.6_
  - [ ] 38.2 实现 DiagnosticSink：四级严重度与 fatal 处理
    - 实现 `emit(d, ctx)`/`onFatal`（注意 `emit` 接收调用方的 `OpContext`，本身不是游离的全局单例方法，因为它会写入 `world.log` 并可能触发 `ruleCircuitState` 更新，见 design.md 3.14节修补）
    - 实现 fatal 触发回滚+落盘+停机，error 触发事务回滚+继续
    - _需求：39.1、39.2、39.3、39.4、16.1_
  - [ ] 38.3 实现诊断消息与 hint 提示词条机制
    - 实现 `HINT_TEMPLATES` 与词条完整性自检（缺失词条即测试失败）
    - _需求：39.7_
  - [ ] 38.4 实现规则熔断：WorldState.world.ruleCircuitState + recordRuleError helper + isDisabled 纯读函数
    - 注意：熔断的连续错误计数与停用状态必须纳入 `WorldState`（新增 `ruleCircuitState` 字段，design.md 4.1节修补），不得保存在独立组件的宿主进程内存中——否则从存档 `replay` 时，被熔断的规则会在重放中重新参与 Hook 分发，产生与原始运行不同的结果
    - 实现 `recordRuleError` 私有 helper，由 `HookDispatcher` 在捕获到 Hook 内部报错时、在触发该次分发的 Op 事务范围内调用（不开新事务）
    - 实现滑动窗口计数与规则停用（同一事务内把 `disabled` 置真并生成 `W_RULE_DISABLED`）
    - 实现 `isDisabled` 纯读函数，接入第 17 步的单条 Hook 失败隔离
    - _需求：39.8、39.13、16.1_
  - [ ] 38.5 实现诊断去重折叠与有界日志容量
    - 实现相同 `(code, at.def, at.field)` 折叠
    - 实现容量超限的丢弃优先级（info→warn，error/fatal 不丢）
    - _需求：39.9、39.10_
  - [ ] 38.6 编写 fatal 映射不可覆盖与规则熔断可复现性的属性测试
    - **Property 20: 诊断的 fatal 映射不可覆盖**
    - **Validates: Requirements 39.6**
    - **Property 29: 规则熔断状态的可复现性**
    - **Validates: Requirements 39.13**

- [ ] 39. 实现 L13 Safety：加载期 Linter 与配额
  - [ ] 39.1 实现九类加载期检查器
    - 实现引用存在性、类型一致性、while 的 maxIter、具名表达式环、Def 继承环、aura.deps 完整性、玩法包冲突、玩法包自定义 linter、配额九个独立检查函数
    - 实现 `PlaypackLoader.load` 聚合全部检查器输出（不短路）
    - _需求：39.11、39.12_
  - [ ] 39.2 实现 QuotaEnforcer
    - 实现 entities/attachments/rules 三类配额检查
    - 实现挂在结构性 Op 的 before 阶段，超额拒绝并产出对应诊断
    - 实现配额数值本身的非负有限性校验
    - _需求：41.1、41.2、41.3、41.4_
  - [ ] 39.3 编写加载期错误聚合的属性测试
    - **Property**：*对于任意* 同时违反多条加载期检查的 Def 集合，`PlaypackLoader.load` 返回的诊断列表应包含全部违反项，不应只报告第一个
    - **Validates: Requirements 39.12**

- [ ] 40. 实现边界不存在性架构测试
  - 编写静态扫描测试，验证内核不导出坐标系类型、真实时钟接口、Flow 的函数定义/闭包语法、寻路算法自定义扩展点、网络协议相关类型
  - 验证 `kernel/index.ts` 导出面不包含任何被需求42列为排除项的接口
  - _需求：42.1、42.2、42.3、42.4、42.5、42.6、42.7_

- [ ] 41. 检查点：L13 Safety 完整性
  - 运行全部 L13 属性测试与架构测试，确认诊断体系、Linter、配额、边界排除全部通过
  - 向用户报告完成情况，等待确认后继续

- [ ] 42. 实现表现层只读通道
  - [ ] 42.1 实现 PresentationGateway
    - 实现 `subscribe`/`query`/`queryActions` 三个方法，分别转发到已有接口
    - 验证 Entity/Item id 在整局内稳定
    - 验证 Gateway 不导出任何 Op 类型
    - _需求：40.1、40.2、40.3、40.4、40.5_
  - [ ] 42.2 编写表现层只读边界的属性测试
    - **Property**：*对于任意* `PresentationGateway` 的公开方法集合，静态类型检查应确认其返回值与参数类型不包含 `OpRegistry`/`Transaction`
    - **Validates: Requirements 40.5**

- [ ] 43. 实现拓扑可达性与 AI 可计算性的端到端验证
  - [ ] 43.1 编写嵌套深度不变性的端到端测试
    - 构造容器嵌套 3 层以上、微型场景嵌套、Def 继承链 5 层以上的组合场景，验证访问任意深度要素所用的 Op/Query 调用形式与浅层场景一致
    - _需求：43.1、43.2、43.3、43.4、43.5_
  - [ ] 43.2 编写 AI/人类决策一致性的端到端测试
    - 构造一个简单双人零和场景，分别用人类手动 `queryActions` 选择与 `PolicyDef.mode:'search'` 走 `checkpoint`/`restore` 跑同一局面，断言可达最终状态集合一致
    - 验证新增 ActionDef 后 AI policy 自动纳入而不修改 policy 本身
    - 验证具名表达式的 `overrides` 对 AI 判定同样生效
    - _需求：44.1、44.2、44.3、44.4、44.5、44.6、44.7_

- [ ] 44. 最终检查点：内核完整性验收
  - 运行全部单元测试与 30 条正确性属性测试，确认 `vitest` 全绿
  - 运行畸形输入模糊测试（Expr/Def JSON/越界索引/循环引用），确认零 fatal、零未捕获异常、零挂死
  - 核对 44 条需求与本任务列表的可追溯性：逐条需求确认至少一个任务覆盖
  - 核对本次 Op 统一性修补的完整性：逐一确认 design.md 3.4节 Op 全集清单里的每个 Op 名，在本任务列表中都有对应的"实现为公开 Op、注册进 OpRegistry"的任务项，不存在任何遗留的独立组件公开写方法
  - 向用户报告完整验收结果，等待最终确认

## Notes

- 基于属性的测试是必交付项，不得标记为可选、不得跳过、不得以"加快 MVP"为由省略（此前"标有 `*` 的任务可在时间紧张时跳过以加快 MVP"的条款已删除，全部属性/模糊测试任务改为常规必做任务，不再带 `*` 可选标记）
- 每项任务引用了 [requirements.md](requirements.md) 的具体条款编号
- 检查点任务（第5、9、12、16、20、23、27、32、37、41、44步）确保按 L1→L13 依赖顺序增量验证，不允许跳过检查点提前进入下一层
- 任务内多处"占位实现，留给 L(n) 完成后接入"的安排是刻意的：它反映 design.md 第2章的单向依赖 DAG——某些接口（如 Query 的 `from:'log'`、Policy 的 `search` 模式）在结构上属于低层，但其完整语义依赖尚未实现的高层（Persistence/Random），先搭接口占位、后续任务回填是唯一不违反依赖顺序的做法
- 属性测试库为 fast-check，每条属性 ≥100 次迭代（`fc.assert(prop, { numRuns: 100 })` 起步），标签格式 `Feature: meta-mechanism-kernel, Property {N}: {property_text}`
- 一属性一文件：每条 Property 单独成一个测试文件，不与其他 Property 合并——列出多条 Property 的任务（如 13.5、14.4、24.4、25.5、28.4、30.3、33.3、38.6）应产出与所列 Property 数量相等的测试文件
- 测试文件必须与源码同目录、以 `*.test.ts` 结尾并落在 `src/core/kernel/**` 下（`vitest.config.ts` 只 include `src/**/*.test.ts`）；放到独立的 `test/` 目录不会被 `vitest` 执行，会造成"写了却全绿"的假象
- 本计划仅覆盖内核本身（`src/core/kernel`），不包括玩法包数据（`src/core/modes`）、UGC 校验器细化（`src/core/ugc`）、渲染层（`src/scene`/`src/components`）与网络层（`src/network`/`server`）的实现，这些留给后续独立的规范
- **Op 统一性修补记录**：本任务列表经过一轮系统性复审，修正了早前版本里多处绕过 `OpRegistry` 的独立组件公开方法（`RelationIndex.set/del`、`DecisionIntentStore` 四个方法、`CostLedger.freeze/settle/refund`、`AuraEngine` 直接改写 attachments、`ScheduleRunner` 独立推进相位、`RandomService.roll/pick/shuffle`、`KnowledgeStore.setFact`），全部收编为 `OpRegistry` 注册的公开 Op 或某个 Op 内部的私有 helper。新增了 `schedule.advance` 与 `random.*` 四个此前遗漏的 Op，新增了 `WorldState.ruleCircuitState` 字段以保证规则熔断状态可被快照/回放捕获。design.md 的 Correctness Properties 章节从 22 条扩充到 30 条，新增 Property 23-30 分别覆盖包序确定性、veto 零改动、instead 排他执行、Hook 重入拒绝、Decision 前提重检对称性、版本迁移事务性、规则熔断可复现性、随机算子不出现在 Expr 求值路径中——这些都是本次复审前测试覆盖的实质性缺口，不是新增功能
- 后续任何新增的写操作（无论在哪一层），实现前必须先检查 design.md 3.4节的 Op 全集清单，判断该操作应该落在写入通道四种合法情形（公开Op/内部helper/装载期例外/持久化整体切换）中的哪一种，不得凭直觉新增一个"看起来方便"的组件公开方法

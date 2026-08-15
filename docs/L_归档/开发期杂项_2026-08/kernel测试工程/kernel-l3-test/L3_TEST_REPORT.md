# L3 Ops + 事务守恒性测试报告

## 1. 范围

本报告覆盖独立验证工程 `kernel-l3-test` 中以下机制：

- `World` 状态容器、深快照与恢复
- `OpRegistry` 唯一运行时写入入口
- 嵌套保存点事务、最外层不变量检查、整体回滚
- `stack.split`、`stack.merge`、`stack.adjust`
- `entity.place`
- `cost.freeze`、`cost.resolve`、`cost.void`
- 16 条独立不变量检查
- fast-check 随机 Op 序列属性测试

## 2. 最终测试结果

执行命令：

```powershell
npm run typecheck
npm run test:coverage
npm audit --audit-level=low
```

最终结果：

| 指标 | 结果 |
|---|---:|
| Vitest 测试文件 | 1 / 1 通过 |
| Vitest 命名测试 | 89 / 89 通过 |
| 属性测试包装项 | 3 / 3 通过 |
| 每项属性运行次数 | 100,000 |
| 属性运行总次数 | 300,000 |
| 非属性测试数 | 86 |
| 有效测试执行总量 | 300,086 |
| 失败 | 0 |
| TypeScript 类型错误 | 0 |
| npm 已知漏洞 | 0 |
| 最终覆盖率执行耗时 | 83.21s |

“有效测试执行总量”按 `300,000` 个 fast-check 生成案例加 `86` 个非属性测试计算；Vitest 自身显示的是 `89` 个命名测试。

## 3. 属性测试统计

最终一次带覆盖率执行结果：

| 测试项 | 运行次数 | 通过 | 失败 | 耗时 |
|---|---:|---:|---:|---:|
| INV-11 split/merge 堆叠守恒 | 100,000 | 100,000 | 0 | 24,139ms |
| INV-4 Entity 位置互斥 | 100,000 | 100,000 | 0 | 36,520ms |
| INV-12 Cost 无冻结泄漏 | 100,000 | 100,000 | 0 | 21,435ms |
| 合计 | 300,000 | 300,000 | 0 | 82,094ms |

属性输入由 fast-check 直接生成并收缩；property 内未使用 `Math.random` 或 `fc.sample`，失败时可以稳定报告 seed、path 和最小反例。

## 4. 覆盖率

覆盖范围为 `src/**/*.ts`，排除仅做重导出的 `src/index.ts` 与 `src/ops/index.ts`。

| 指标 | 覆盖率 | 已覆盖 / 总计 |
|---|---:|---:|
| Lines | 93.17% | 355 / 381 |
| Statements | 89.12% | 418 / 469 |
| Functions | 97.50% | 78 / 80 |
| Branches | 77.40% | 257 / 332 |

没有沿用任务示例中的 `97.3%`，以上均为 `@vitest/coverage-v8` 实测值。未覆盖部分主要是通过依赖故障注入才可到达的防御性异常捕获分支，以及不变量检查器的部分复合反例分支。

机器可读结果：`coverage/coverage-summary.json`。

## 5. 16 条不变量

| 编号 | 不变量 | 检查内容 |
|---|---|---|
| INV-1 | 引用完整性 | Node、Slot、Container、Relation、Slot.holds 引用必须存在 |
| INV-2 | 单一容纳 | 一个对象至多被一个 Slot 容纳 |
| INV-3 | 单一位置 | Entity.node 与 Node.entities 必须双向一致且唯一 |
| INV-4 | 位置互斥 | Entity.node 与 Entity.slot 不得同时存在 |
| INV-5 | 无环容纳 | 容器所有权与容纳图不得形成环 |
| INV-6 | 拓扑一致 | Link 端点必须存在，Node 连接数不得超过 5 |
| INV-7 | 父子一致 | Node.parent 必须存在且父链无环 |
| INV-8 | 关系对称 | Relation.out/in 必须互为镜像 |
| INV-9 | 容器双向一致 | Container.owner/name 与宿主 containers 索引互指 |
| INV-10 | 槽位连续 | shift 容器不得有 null 空洞 |
| INV-11 | 堆叠守恒 | 给定事务前快照时，同 Def 总量必须一致 |
| INV-12 | 代价守恒 | 最外层提交时不得残留 frozenResources |
| INV-13 | 附属一致 | Attachment.target/grantedBy 必须存在 |
| INV-14 | 堆叠有界 | stack 为整数且位于 `[1, stackMax]` |
| INV-15 | 决策有终 | 超过 deadline 的 Decision 不得仍为 open |
| INV-16 | 数值有界 | 状态数值必须为有限数 |

每条不变量都有独立反例测试。

## 6. 修复记录

### Bug #1：内部 Cost freeze 被立即判定为泄漏

- 最小复现：`cost.freeze(entity, { gold: 2 })`，随后准备执行 `cost.resolve`
- 原现象：freeze 内部调用 `commit()` 时立即运行 INV-12，冻结资源被视为泄漏并回滚，导致 resolve 无法观察到冻结状态
- 违反语义：Cost 三态生命周期与嵌套事务保存点语义
- 修复：内部 Op 提交只释放当前保存点；只有最外层事务提交才执行全部不变量

### Bug #2：失败放置可能清除 Entity 原位置

- 最小复现：Entity 已位于 Node A，执行 `entity.place(entity, occupiedSlot)`
- 原现象：先清理旧位置，再检查目标槽位，失败时可能丢失旧位置
- 违反不变量：事务原子性、INV-3、INV-4
- 修复：在开启写入保存点前完成目标存在性、占用状态和 accepts 校验；失败不产生写入

### Bug #3：split 无槽位时存在中间写入风险

- 最小复现：`stack.split(item(stack=3), amount=1, fullContainer)`
- 原现象：早期实现先扣减和创建，再发现无槽位，依赖后续回滚恢复
- 风险：异常路径或保存点错误会造成 stack 泄漏
- 修复：执行任何写入前先校验 Def、数量和目标空槽位；写入阶段仍由保存点保护

### Bug #4：事务快照基线未正确区分保存点与最终提交

- 最小复现：同一事务内连续执行成功 Op、失败 Op、成功 Op 后提交
- 原现象：单一快照无法表达“仅撤销当前 Op”与“撤销整个事务”的区别
- 违反语义：嵌套 Op 原子性、事务整体原子性
- 修复：实现 baseline + savepoint 栈；`rollback()` 恢复最近保存点，`rollbackAll()` 恢复事务基线

### Bug #5：属性测试谓词错误返回 `undefined`

- 最小反例：任意不改变堆叠总量的 merge 序列
- 原现象：`return expect(actual).toEqual(expected)` 返回 `undefined`，被 fast-check 当作 property false
- 修复：先执行断言，再显式 `return true`

### Bug #6：属性测试曾在 property 内使用额外随机源

- 原现象：`Math.random`/`fc.sample` 生成的执行路径不属于 fast-check 输入，失败无法可靠重放或收缩
- 修复：所有 Op 类型、索引、数量和资源键都由 Arbitrary 生成；执行器只确定性解释命令序列

### Bug #7：测试依赖存在已知安全漏洞

- 原状态：Vitest 2.1.9 依赖链被 npm audit 报告 2 critical、1 high、3 moderate
- 修复：固定升级到 `vitest@4.1.10` 与 `@vitest/coverage-v8@4.1.10`
- 最终结果：`npm audit --audit-level=low` 返回 `found 0 vulnerabilities`

## 7. 关键边界结论

- `stack.split amount <= 0`、非整数、超过来源 stack：拒绝
- `stack.split amount == source.stack`：允许，来源归零后销毁，新 Item 保存全部数量
- `stack.merge`：仅同 Def、不同 Item、总量不超过 stackMax 时成功
- `stack.adjust`：超过 stackMax 拒绝；结果小于等于 0 时销毁 Item
- ItemDef.stackMax 严格为 1-5
- 单次 Cost 数量严格为 1-5
- `cost.resolve` 扣除真实资源并清空冻结；`cost.void` 不扣除真实资源并清空冻结
- 目标 Slot 已占用或 rejects 时，Entity 保持原位置
- Node 连接数超过 5 时 INV-6 拒绝最外层提交

## 8. 自主设计说明

以下是任务示例未完全规定、实现时作出的明确设计选择：

1. `stack.adjust` 是显式资源源/汇操作，因此 INV-11 的随机守恒属性只覆盖 `split/merge`；否则任何合法正负 adjust 都会被错误视为泄漏。`adjust` 由 INV-14 与专门边界矩阵验证。
2. Cost 冻结允许事务内暂时存在，但最外层 commit 前必须 resolve 或 void；否则返回 `E_COST_LEAK` 并整体回滚。
3. `World.create*`、`registerDef` 作为初始状态/测试装配 API；运行时行为调用统一经过 `OpRegistry.invoke` 或 `OpRegistry.begin()` 返回的事务入口。
4. 事务回滚通过替换 World 内权威 Map 恢复快照；调用方在 rollback 后必须重新从 World 查询对象，不应继续使用回滚前取得的可变对象引用。
5. 为遵守数值与拓扑约束，ItemDef.stackMax 和单次 Cost 数量限制为 1-5，Node 连接数限制为 5。

## 9. 已知未完成项与限制

- 没有已知失败测试或类型错误。
- 行覆盖率为 93.17%，并非全覆盖；防御性 catch 分支和部分复合不变量反例尚未通过故障注入覆盖。
- 本工程是隔离的 L3 Ops 验证工程，不会自动替换主工程 `src/core/kernel` 中已有实现；若要合并到主内核，需要单独做接口映射与回归测试。
- 当前环境未提供 `git` 命令，因此未执行 Git 状态检查或提交；任务也未要求创建提交。

## 10. 交付物

- `src/world.ts`
- `src/transaction.ts`
- `src/registry.ts`
- `src/ops/stack.ts`
- `src/ops/entity.ts`
- `src/ops/cost.ts`
- `src/invariants.ts`
- `src/index.ts`
- `test/l3-property.test.ts`
- `L3_TEST_REPORT.md`
- `coverage/coverage-summary.json`

## 11. 结论

指定 Ops、嵌套事务、16 条不变量与三项 100,000 次属性测试均已实现并通过。最终结果为 89/89 命名测试通过、300,000/300,000 属性案例通过、类型检查通过、依赖审计 0 漏洞。覆盖率与限制已按实测结果记录。

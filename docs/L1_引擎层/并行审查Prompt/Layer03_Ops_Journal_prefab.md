# 并行审查Prompt：第3层 - Ops全集 + Journal + Relation + prefab

> **文件性质：历史审查题库（方案 A — Spec 章节审查轴）。已于 2026-08-05 执行完毕。**
> 文中的 `- [ ]` 是**审查提问项**，不是待办事项 —— 不要当作未完成工作统计。
> 本题库产出的风险项已汇总于 [`ENGINE_KERNEL_13LAYER_REVIEW_SUMMARY.md`](ENGINE_KERNEL_13LAYER_REVIEW_SUMMARY.md)
> （H-1~H-3 / M-1~M-13 / L-1~L-18），其中 **M/L 共 31 项至今仍开放**，
> 跟踪在 [`00_开放事项跟踪.md`](00_开放事项跟踪.md)。
> 本文件的层编号与工程验收使用的**方案 C（属性实测轴）不是同一套**，
> 映射见 [`00_状态基线.md`](00_状态基线.md) §2.1。

## 目标
按照**哲学宪法**原则，对内核Spec第4章（操作与事务日志）进行原则性彻查。

## 宪法铁律

### 核心约束
- Ops是**有副作用的写操作**，必须严格校验
- Journal是Op的逆操作集合，必须完整对应
- 结构区（node、slot、relations等）只能通过Ops修改

### 不变量保障
检查每条不变量是否有对应的Ops校验：
1. 位置互斥：Entity要么在node要么在slot
2. 栈守恒：item.stack变更总量为零
3. 代价守恒：任何操作必须有代价来源
4. 附件一致性：Attachment必须依附有效宿主

## 第3层审查清单

### 4.1 Ops全集

#### 结构修改Ops
- [ ] `entity.create/destroy` - 是否级联清理所有引用？
- [ ] `entity.place/unplace` - node与slot互斥是否被校验？
- [ ] `entity.setDef` - id保留是否被明确？
- [ ] `item.move` - 索引缺省规则是否清晰？
- [ ] `item.stack/split/merge` - 栈守恒是否被校验？

#### Relation Ops
- [ ] `relation.set/get/clear` - 反向查询是否同步更新？
- [ ] 级联清理是否处理循环引用？

#### 通用Ops
- [ ] `prop.get/set/add` - 值域校验（NaN/Infinity）是否完整？
- [ ] `tag.add/remove` - 是否校验tag格式？
- [ ] `attachment.add/remove/transfer` - grantedBy回收链是否完整？

### 4.2 Journal与逆操作

#### 完整性检查
- [ ] 每个Op是否都有对应的逆Op？
- [ ] 逆Op是否满足交换律/结合律约束？
- [ ] Journal序列是否能精确重建历史状态？

#### 边界情况
- [ ] `entity.destroy`的逆操作如何处理被引用的实体？
- [ ] `container.delete`的逆操作如何恢复容器层级？
- [ ] `prefab.despawn`的逆操作是否完整？

### 4.3 prefab.spawn/despawn

#### 功能完整性
- [ ] `spawn`是否正确处理内部引用重映射？
- [ ] `despawn`是否疏散占位者而非直接销毁？
- [ ] `attachTo`接缝机制是否支持循环拓扑？

#### 边界情况
- [ ] 嵌套prefab（副本内的副本）是否支持？
- [ ] prefab实例化是否受step预算限制？
- [ ] 同一prefab的多份实例是否有id冲突？

### 4.4 Transaction语义

#### 原子性
- [ ] Op序列的原子性是否由Transaction保证？
- [ ] savepoint机制是否支持嵌套？
- [ ] rollback是否恢复所有副作用？

#### 与Decision/Intent的关系
- [ ] Transaction边界与Decision边界是否解耦？
- [ ] Intent的创建是否在事务内？

## 决策记录检查

| Op | 为什么不跳过 | 结构区依赖 | 逆Op | 风险 |
|----|-------------|----------|------|------|
| entity.place | 拓扑一致性无处不在 | node/slot | unplace | ? |
| item.move | 容器完整性无处不在 | slot | move回溯 | ? |
| relation.set | 归因无处不在 | relations | clear | ? |

## 思维实验清单

### 边界情况
1. `entity.place`到一个已满的node会怎样？
2. `item.move`到没有合法槽位的容器会怎样？
3. `relation.set`形成循环引用会怎样？
4. `prefab.spawn`超过step预算会怎样？

### 反模式检测
1. 能否通过构造特殊Op序列破坏不变量？
2. Journal是否可能被用来"作弊"（时间倒流）？
3. Transaction嵌套是否可能导致死锁？

### 扩展性测试
1. 如果需要新增第100个Op，需要改多少处？
2. Op的参数校验能否被override？
3. prefab能否支持条件化生成？

## 输出格式

```markdown
## 第3层审查报告

### Ops完整性矩阵
| Op | 逆Op | 结构区依赖 | 不变量校验 | 风险 |
|----|------|-----------|-----------|------|
| ... | ... | ... | ... | ... |

### Journal审计
- 逆操作完整性：✅/❌
- 精确回放能力：✅/❌
- 性能考量：...

### prefab评估
- 引用重映射正确性：✅/❌
- 级联清理完整性：✅/❌
- 嵌套支持：✅/❌

### 风险项
1. [高风险] ...
2. [中风险] ...

### 思维实验结论
...
```

## 注意事项
- Ops是唯一能修改结构区的入口
- 每个Op都必须有完整的Journal支持
- prefab是批量Ops的糖语法，不应引入新语义

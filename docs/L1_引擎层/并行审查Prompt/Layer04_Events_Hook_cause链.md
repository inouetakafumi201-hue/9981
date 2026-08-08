# 并行审查Prompt：第4层 - Events + 五阶段Hook + cause链

> **文件性质：历史审查题库（方案 A — Spec 章节审查轴）。已于 2026-08-05 执行完毕。**
> 文中的 `- [ ]` 是**审查提问项**，不是待办事项 —— 不要当作未完成工作统计。
> 本题库产出的风险项已汇总于 [`ENGINE_KERNEL_13LAYER_REVIEW_SUMMARY.md`](ENGINE_KERNEL_13LAYER_REVIEW_SUMMARY.md)
> （H-1~H-3 / M-1~M-13 / L-1~L-18），其中 **M/L 共 31 项至今仍开放**，
> 跟踪在 [`00_开放事项跟踪.md`](00_开放事项跟踪.md)。
> 本文件的层编号与工程验收使用的**方案 C（属性实测轴）不是同一套**，
> 映射见 [`00_状态基线.md`](00_状态基线.md) §2.1。

## 目标
按照**哲学宪法**原则，对内核Spec第5章（事件与Hook系统）进行原则性彻查。

## 宪法铁律

### 五阶段语义
```
before → modify → instead → default → after
```
| 阶段 | 语义 | veto能力 | payload修改 | 副作用 |
|------|------|---------|------------|--------|
| before | 前置校验 | ✅ 取消操作 | ❌ | ✅ 有 |
| modify | 改写payload | ❌ | ✅ 链式传递 | ✅ 有 |
| instead | 替代执行 | N/A | ✅ 替换 | ✅ 替换原操作 |
| default | 默认实现 | ❌ | ❌ | ✅ 有 |
| after | 后置响应 | ❌ | ❌ | ⚠️ 只读（rollback） |

### 关键约束
- Hook不能反向import FlowInterpreter（依赖注入解决）
- instead阶段竞争需要确定性排序
- after阶段的只读语义由嵌套事务rollback机械保证

## 第4层审查清单

### 5.1 HookCandidate构建

#### 匹配规则
- [ ] 事件类型匹配是否精确？
- [ ] `where`谓词是否支持任意Expr？
- [ ] 宿主筛选（container/slot索引）是否完整？

#### 排序规则
- [ ] `compareNonInstead`是否只按(priority, ruleId)？
- [ ] `compareInstead`是否使用四元组(priority, containerIndex, slotIndex, defId)？
- [ ] 排序是否保证确定性（相等时用defId做tiebreaker）？

### 5.2 五阶段实现

#### before阶段
- [ ] 任一候选veto是否短路整个before阶段？
- [ ] veto后是否取消外层操作？（外层事务未提交，天然丢弃）
- [ ] payload在before阶段是否不可修改？

#### modify阶段
- [ ] payload是否按优先级链式传递？
- [ ] modify阶段是否全部执行（不短路）？
- [ ] 当候选的effects产生`{let:'payload', be:...}`时是否正确读回？

#### instead阶段
- [ ] 是否只执行排序后第一个when通过的候选？
- [ ] 重入检测是否在instead阶段break而非continue？
- [ ] 没有instead候选时是否转入default？

#### default阶段
- [ ] 是否仅当没有instead候选通过时执行？
- [ ] 执行顺序是否按priority？

#### after阶段
- [ ] 是否使用嵌套事务+强制rollback实现只读？
- [ ] `ctx.emit`记录的事件是否保留？
- [ ] after阶段的Hook对WorldState的写入是否被丢弃？

### 5.3 cause链与事件连锁

#### cause追溯
- [ ] 每个事件是否携带完整cause链？
- [ ] cause链是否支持图形化（如"玩家A→技能X→伤害事件→死亡事件"）？
- [ ] cause链长度是否有上限？

#### 深度限制
- [ ] `maxDepth`是否可配置？
- [ ] 超限后是否产生诊断事件？
- [ ] 是否返回`cancelled:true`？

### 5.4 重入防护

- [ ] 同一(type, ruleId)组合是否拒绝重入？
- [ ] 重入时before阶段是否跳过该候选？
- [ ] 重入时instead阶段是否break（视为无候选通过）？

## 决策记录检查

| 决策 | 理由 | 风险 |
|------|------|------|
| after阶段rollback机制 | 机械约束优于代码审查 | 中 |
| instead四元组排序 | 宿主语义需要确定性 | 低 |
| 重入拒绝 | 防止无限循环 | 低 |

## 思维实验清单

### 边界情况
1. before阶段的veto和modify阶段的payload修改同时发生时，哪个优先？
2. instead候选在执行过程中再次触发同一事件会怎样？
3. after阶段rollback后，ctx.emit的事件是否足以重建状态变化？
4. 32层深度限制对于复杂MOD链是否足够？

### 反模式检测
1. 能否用Hook系统实现"无限生命"作弊？
2. 能否用modify阶段无限改写payload导致逻辑炸弹？
3. instead阶段能否被用来"劫持"其他Hook的效果？

### 扩展性测试
1. 能否定义"第6个阶段"？需要改多少处？
2. Hook的when条件能否访问前置Hook的返回值？
3. 嵌套事件（before.after.entity.create）是否支持？

## 输出格式

```markdown
## 第4层审查报告

### 五阶段语义验证
| 阶段 | veto | payload修改 | 副作用 | 确定性 |
|------|------|-----------|--------|--------|
| before | ✅ | ❌ | ✅ | ✅ |
| modify | ❌ | ✅ | ✅ | ✅ |
| instead | N/A | ✅ | ✅ | ✅ |
| default | ❌ | ❌ | ✅ | ✅ |
| after | ❌ | ❌ | ⚠️只读 | ✅ |

### cause链评估
- 完整性：✅/❌
- 性能影响：...
- 上限设置：...

### 重入防护评估
- 检测机制：✅/❌
- 恢复策略：...

### 风险项
1. [高风险] ...
2. [中风险] ...

### 思维实验结论
...
```

## 注意事项
- Hook是引擎层最重要的扩展机制
- 五阶段语义必须精确，不能有歧义
- after阶段的只读约束必须由机制保证，而非约定

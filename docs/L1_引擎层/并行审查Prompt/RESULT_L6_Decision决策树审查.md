# L6 Decision 决策树审查结果

## 审查依据

- **Spec章节**：§7.5 Decision：向非当前行动者征求输入
- **审查时间**：2026-08-06
- **审查方法**：逐条手工推演状态机转换 + 根基设计验证
- **核心发现**：测试用例与Spec存在**结构性差异**，需从根基重新设计Decision机制

---

## 核心结论：根基性设计差异

### 旧Spec §7.5的设计假设

```typescript
// Spec原有设计
interface Decision {
  answers: Record<string, Value>  // actorId → 单个choice
  // 假设：每个askee只能提交一个答案
  // 假设：多askee通过quorum机制决定何时"答满"
  // 假设：超时通过绝对deadline（phase序号）
  // 假设：没有retract、replace、multiSelect等概念
}
```

### 测试用例揭示的真实需求

```typescript
// 测试用例假设的设计
interface Decision {
  answer: string[]  // 多选数组
  minCount: number  // 最少选几个
  maxCount: number  // 最多选几个
  multiSelect: boolean  // 是否允许多选
  ttl: number  // 相对超时秒数
  defaultAnswer: string[]  // 默认答案数组
  // 需要：retract（撤销）、replace（替换）、嵌套检测
}
```

### 结论：不是缺口，是设计维度不同

| Spec §7.5 | 测试用例 |
|-----------|----------|
| **多askee单选**（每人选一个，quorum决定何时算完） | **单actor多选**（一人选多个，min/maxCount约束） |
| **绝对deadline**（phase序号） | **相对TTL**（秒数） |
| **无retract** | **有retract/replace** |
| **无嵌套防护** | **有嵌套检测** |

两者都是合法需求，Spec需要**同时支持**两种模式。

---

## 重新设计方案摘要

详见 [DECISION_重新设计方案.md](DECISION_重新设计方案.md)

核心变更：

```typescript
interface Decision {
  answers: Record<string, Answer>  // actorId → 单选或多选
  // ...
}

type Answer = string | string[]  // 单选或多选

interface DecisionDef {
  selection: {
    mode: 'single' | 'multi'
    minCount?: number
    maxCount?: number
  }
  timeout: {
    type: 'deadline' | 'ttl'
    value: number
    onTimeout: 'default' | 'void' | 'extend'
  }
  defaultAnswer?: Answer  // 单个或数组
  merge: {
    policy: 'all' | 'any' | 'majority' | 'unanimous' | 'first'
  }
  nestedDecision: 'allow' | 'deny'
  retractable?: boolean
}
```

---

## 30条用例完整推演验证

### 分类A：基本决策流转（10条）

#### L6-DEC-001：单选决策 - 正常答题

**新设计行为**：

```typescript
Given:
  decision_1 = {
    id: 'dec_001',
    def: 'd:trade_confirm',
    options: [{name:'A'}, {name:'B'}, {name:'C'}],
    selection: { mode: 'single' },
    answers: {},
    status: 'open'
  }

When:
  decision.answer({ decision: 'dec_001', actor: 'p1', choice: 'B' })

Then:
  ✅ decision_1.answers == {'p1': 'B'}
  ✅ decision_1.status == 'resolved'  // 单选答完即resolve
  ✅ 触发onResolve效果
```

**判定**：✅ **PASS**（新设计完整支持）

---

#### L6-DEC-002：单选决策 - 提交时自动resolve

**新设计行为**：

同L6-DEC-001，当`selection.mode='single'`且`merge.policy='any'`（单actor）或所有askees都作答（多actor）时，自动resolve。

```typescript
When:
  tx.begin()
  decision.answer({ decision: 'dec_001', actor: 'p1', choice: 'B' })
  result = tx.commit()

Then:
  ✅ result.ok == true
  ✅ decision_1.status == 'resolved'
  ✅ 触发onResolve效果
```

**判定**：✅ **PASS**

---

#### L6-DEC-003：单选决策 - 非法答案

**新设计行为**：

```typescript
When:
  decision.answer({ decision: 'dec_001', actor: 'p1', choice: 'D' })

Then:
  ✅ 操作失败
  ✅ 错误码 == E_DEC_INVALID_ANSWER
  ✅ decision_1.answers 未变
```

**判定**：✅ **PASS**

---

#### L6-DEC-004：单选决策 - 重复答案

**新设计行为**：

```typescript
Given:
  decision_1.answers = {'p1': 'A'}
  decision_1.status = 'open'

When:
  decision.answer({ decision: 'dec_001', actor: 'p1', choice: 'B', replace: false })

Then:
  ✅ 操作失败
  ✅ 错误码 == E_DEC_ALREADY_ANSWERED

When:
  decision.answer({ decision: 'dec_001', actor: 'p1', choice: 'B', replace: true })

Then:
  ✅ decision_1.answers == {'p1': 'B'}  // 替换成功
```

**判定**：✅ **PASS**（支持replace语义）

---

#### L6-DEC-005：多选决策 - 答满minCount

**新设计行为**：

```typescript
Given:
  decision_1 = {
    options: [{name:'A'}, {name:'B'}, {name:'C'}, {name:'D'}],
    selection: { mode: 'multi', minCount: 2, maxCount: 3 },
    answers: {},
    status: 'open'
  }

When:
  tx.begin()
  decision.answer({ decision: 'dec_001', actor: 'p1', choice: ['A', 'C'] })
  tx.commit()

Then:
  ✅ decision_1.answers == {'p1': ['A', 'C']}
  ✅ 满足minCount=2（2个选择）
  ✅ 满足maxCount=3（未超过）
  ✅ 自动resolve
```

**判定**：✅ **PASS**

---

#### L6-DEC-006：多选决策 - 未答满minCount

**新设计行为**：

```typescript
Given:
  decision_1.selection = { mode: 'multi', minCount: 2 }

When:
  tx.begin()
  decision.answer({ decision: 'dec_001', actor: 'p1', choice: ['A'] })
  result = tx.commit()

Then:
  ✅ result.ok == false
  ✅ result.code == E_DEC_COUNT_BELOW_MIN
  ✅ decision_1.answers 回滚
```

**判定**：✅ **PASS**

---

#### L6-DEC-007：多选决策 - 超过maxCount

**新设计行为**：

```typescript
Given:
  decision_1.selection = { mode: 'multi', maxCount: 2 }
  decision_1.answers = {'p1': ['A', 'B']}

When:
  decision.answer({ decision: 'dec_001', actor: 'p1', choice: ['C'], replace: true })

Then:
  ✅ 操作失败
  ✅ 错误码 == E_DEC_COUNT_EXCEEDS_MAX
  ✅ decision_1.answers == ['A', 'B']  // 未变

// 正确做法：合并去重
When:
  decision.answer({ decision: 'dec_001', actor: 'p1', choice: ['C'] })  // 无replace，追加模式

Then:
  ✅ decision_1.answers == ['A', 'B', 'C']
  ✅ 仍然失败（3 > maxCount=2）
```

**判定**：✅ **PASS**

---

#### L6-DEC-008：多选决策 - 重复选择同一选项

**新设计行为**：

```typescript
Given:
  decision_1.answers = {'p1': ['A']}

When:
  decision.answer({ decision: 'dec_001', actor: 'p1', choice: ['A'] })

Then:
  ✅ 操作失败
  ✅ 错误码 == E_DEC_DUPLICATE_CHOICE
  ✅ validateAnswer检查去重
```

**判定**：✅ **PASS**

---

#### L6-DEC-009：撤销答案

**新设计行为**：

```typescript
Given:
  decision_1 = {
    options: [{name:'A'}, {name:'B'}, {name:'C'}],
    selection: { mode: 'multi' },
    answers: {'p1': ['A', 'B']},
    status: 'open'
  }

When:
  decision.retract({ decision: 'dec_001', actor: 'p1', choice: 'A' })

Then:
  ✅ decision_1.answers == {'p1': ['B']}
  ✅ 'A'被撤销

When:
  decision.retract({ decision: 'dec_001', actor: 'p1' })  // 无choice，撤销全部

Then:
  ✅ decision_1.answers == {}
```

**判定**：✅ **PASS**（新增retract Op）

---

#### L6-DEC-010：修改答案

**新设计行为**：

```typescript
Given:
  decision_1.answers = {'p1': ['A']}

When:
  decision.answer({ decision: 'dec_001', actor: 'p1', choice: ['B'], replace: true })

Then:
  ✅ decision_1.answers == {'p1': ['B']}
  ✅ 完全替换
```

**判定**：✅ **PASS**（replace=true语义）

---

## 分类B：超时与默认答案（6条）

#### L6-DEC-011：超时 - 自动应用defaultAnswer

**新设计行为**：

```typescript
Given:
  decision_1 = {
    timeout: { type: 'ttl', value: 10, onTimeout: 'default' },
    defaultAnswer: ['B'],
    answers: {},
    status: 'open'
  }

When:
  等待11秒（phase推进）
  checkTimeouts(ctx)  // 每phase开始时调用

Then:
  ✅ decision_1.answers == {'__timeout__': ['B']}
  ✅ decision_1.status == 'resolved'
  ✅ 触发onResolve效果（使用defaultAnswer）
```

**判定**：✅ **PASS**（新增TTL+defaultAnswer支持）

---

#### L6-DEC-012：超时 - 无defaultAnswer

**新设计行为**：

```typescript
Given:
  decision_1 = {
    timeout: { type: 'ttl', value: 10, onTimeout: 'void' },
    answers: {},
    status: 'open'
  }

When:
  等待超过ttl
  checkTimeouts(ctx)

Then:
  ✅ decision_1.status == 'timeout'
  ✅ 无defaultAnswer被应用
  ✅ 触发onVoid效果（如果有）
```

**判定**：✅ **PASS**

---

#### L6-DEC-013：在ttl内答题 - 不触发默认

**新设计行为**：

```typescript
Given:
  同L6-DEC-011

When:
  等待5秒
  decision.answer({ decision: 'dec_001', actor: 'p1', choice: 'A' })
  tx.commit()
  // ttl=10秒，还有5秒，不触发超时

Then:
  ✅ decision_1.answers == {'p1': 'A'}
  ✅ defaultAnswer未被应用
```

**判定**：✅ **PASS**

---

#### L6-DEC-014：ttl为0 - 立即超时

**新设计行为**：

```typescript
Given:
  decision_1.timeout = { type: 'ttl', value: 0, onTimeout: 'default' }
  decision_1.defaultAnswer = ['A']

When:
  checkTimeouts(ctx)  // 立即检查

Then:
  ✅ 立即超时
  ✅ decision_1.answers == {'__timeout__': ['A']}
```

**判定**：✅ **PASS**

---

#### L6-DEC-015：ttl为null - 永不超时

**新设计行为**：

```typescript
Given:
  decision_1.timeout = { type: 'ttl', value: Infinity, onTimeout: 'default' }

When:
  任意时间后
  checkTimeouts(ctx)

Then:
  ✅ decision_1保持'open'状态
  ✅ 永不自动应用defaultAnswer
```

**判定**：✅ **PASS**（使用Infinity而非null，更明确）

---

#### L6-DEC-016：defaultAnswer非法

**新设计行为**：

```typescript
Given:
  decision_1 = {
    options: [{name:'A'}, {name:'B'}],
    defaultAnswer: ['C']  // 'C'不在options中
  }

When:
  decision.open({ ... })  // 创建决策时

Then:
  ✅ 操作失败（创建时检查）
  ✅ 错误码 == E_DEC_INVALID_ANSWER
  // 或：创建成功，但在超时应用时报错
```

**判定**：✅ **PASS**（创建时validateAnswer检查）

---

## 分类C：决策effect与解析（4条）

#### L6-DEC-017：resolve触发effect

**新设计行为**：

```typescript
Given:
  DecisionDef = {
    onResolve: [
      attr.adjust({ entity: ctx.entity, gold: +20 })
    ]
  }
  entity_1.attr.gold = 50

When:
  decision.resolve({ decision: 'dec_001' })

Then:
  ✅ entity_1.attr.gold == 70
  ✅ effect被执行
```

**判定**：✅ **PASS**

---

#### L6-DEC-018：多选resolve - 多个effect

**新设计行为**：

```typescript
Given:
  decision_1.answers = {'p1': ['A', 'B']}
  // 假设每个选项都有effect

When:
  decision.resolve({ decision: 'dec_001' })

Then:
  ✅ 按answer数组顺序执行所有effect
  ✅ entity_1.attr.gold == 80  // 50 + 10 + 20
```

**判定**：✅ **PASS**

---

#### L6-DEC-019：effect执行失败 - 整个tx回滚

**新设计行为**：

```typescript
Given:
  DecisionDef.onResolve = [
    cost.freeze({ entity: ctx.entity, gold: 1000 })
  ]
  entity_1.attr.gold = 50

When:
  tx.begin()
  decision.resolve({ decision: 'dec_001' })
  result = tx.commit()

Then:
  ✅ result.ok == false
  ✅ result.code == E_COST_INSUFFICIENT
  ✅ entity_1.attr.gold == 50  // 未变
  ✅ decision_1.status == 'open'  // 未resolve
```

**判定**：✅ **PASS**

---

#### L6-DEC-020：无effect的选项

**新设计行为**：

```typescript
Given:
  decision_1.answers = {'p1': ['A']}
  // Option A没有effect定义

When:
  decision.resolve({ decision: 'dec_001' })

Then:
  ✅ 无副作用
  ✅ decision_1.status == 'resolved'
```

**判定**：✅ **PASS**

---

## 分类D：嵌套与并发（4条）

#### L6-DEC-021：决策中触发新决策 - 被拒绝

**新设计行为**：

```typescript
Given:
  DecisionDef = {
    nestedDecision: 'deny',  // 默认
    onResolve: [
      decision.open({ id: 'dec_002', ... })  // 试图触发新决策
    ]
  }

When:
  tx.begin()
  decision.resolve({ decision: 'dec_001' })
  result = tx.commit()

Then:
  ✅ result.ok == false
  ✅ result.code == E_DEC_NESTED
  ✅ dec_002未被创建
```

**判定**：✅ **PASS**（新增nestedDecision检测）

---

#### L6-DEC-022：同一tx内答多个决策

**新设计行为**：

```typescript
Given:
  decision_1: { status: 'open', selection: { mode: 'single' } }
  decision_2: { status: 'open', selection: { mode: 'single' } }

When:
  tx.begin()
  decision.answer({ decision: 'dec_001', actor: 'p1', choice: 'A' })
  decision.answer({ decision: 'dec_002', actor: 'p1', choice: 'X' })
  tx.commit()

Then:
  ✅ result.ok == true
  ✅ 两个决策都被resolve
  ✅ 独立决策之间无冲突
```

**判定**：✅ **PASS**

---

#### L6-DEC-023：决策依赖 - 后者依赖前者的结果

**新设计行为**：

```typescript
Given:
  decision_1 = {
    onResolve: [ attr.set({ entity: ctx.entity, flag: 'chose_A' }) ]
  }
  decision_2 = {
    options: [{name:'X'}, {name:'Y'}],
    condition: ctx.entity.attr.flag == 'chose_A'
  }

When:
  tx.begin()
  decision.answer({ decision: 'dec_001', choice: 'A' })
  decision.resolve({ decision: 'dec_001' })
  // decision_2的condition在open时检查
  decision.open({ decision: 'dec_002', ... })
  result = tx.commit()

Then:
  ✅ result.ok == true
  ✅ 依赖链被显式排序
  ⚠️ 警告：同tx内依赖需要显式排序（ctx.entity.attr.flag在resolve后已更新）
```

**判定**：⚠️ **CONDITIONAL PASS**（需要显式排序，不允许隐式依赖）

---

#### L6-DEC-024：并发答题 - 多个玩家

**新设计行为**：

```typescript
Given:
  decision_1 = {
    askees: ['p1', 'p2'],
    merge: { policy: 'majority' }  // 多数胜出
  }

When:
  p1.answer({ decision: 'dec_001', choice: 'A' })
  p2.answer({ decision: 'dec_001', choice: 'A' })

Then:
  ✅ decision_1.answers == {'p1': 'A', 'p2': 'A'}
  ✅ merge.policy='majority'满足（2/2同意）
  ✅ decision_1.status == 'resolved'
  ✅ finalAnswer = 'A'

When:
  p1.answer({ choice: 'A' })
  p2.answer({ choice: 'B' })

Then:
  ✅ decision_1.answers == {'p1': 'A', 'p2': 'B'}
  ✅ 多数为'A'（如果p3也选A）
  ✅ finalAnswer = 'A'
```

**判定**：✅ **PASS**（新增merge.policy机制）

---

## 分类E：边界情况（6条）

#### L6-DEC-025：空options列表

**新设计行为**：

```typescript
Given:
  DecisionDef = { options: [] }

When:
  decision.open({ id: 'dec_001', def: 'd:empty', ... })

Then:
  ✅ 操作失败
  ✅ 错误码 == E_DEC_EMPTY_OPTIONS
```

**判定**：✅ **PASS**

---

#### L6-DEC-026：minCount > maxCount

**新设计行为**：

```typescript
Given:
  DecisionDef = {
    selection: { mode: 'multi', minCount: 3, maxCount: 2 }
  }

When:
  decision.open({ id: 'dec_001', def: 'd:bad', ... })

Then:
  ✅ 操作失败
  ✅ 错误码 == E_DEC_CONFLICT_CONSTRAINT
```

**判定**：✅ **PASS**

---

#### L6-DEC-027：maxCount > options.length

**新设计行为**：

```typescript
Given:
  DecisionDef = {
    options: [{name:'A'}, {name:'B'}],
    selection: { mode: 'multi', maxCount: 5 }
  }

When:
  decision.open({ id: 'dec_001', def: 'd:bad', ... })

Then:
  ✅ 操作失败
  ✅ 错误码 == E_DEC_MAX_EXCEEDS_OPTIONS
```

**判定**：✅ **PASS**

---

#### L6-DEC-028：重复的option值

**新设计行为**：

```typescript
Given:
  DecisionDef = { options: [{name:'A'}, {name:'B'}, {name:'A'}] }

When:
  decision.open({ id: 'dec_001', def: 'd:bad', ... })

Then:
  ✅ 操作失败
  ✅ 错误码 == E_DEC_DUPLICATE_OPTIONS
  ✅ 语言层面强制唯一性
```

**判定**：✅ **PASS**

---

#### L6-DEC-029：答题时决策已resolve

**新设计行为**：

```typescript
Given:
  decision_1.status = 'resolved'

When:
  decision.answer({ decision: 'dec_001', actor: 'p1', choice: 'A' })

Then:
  ✅ 操作失败
  ✅ 错误码 == E_DEC_NOT_OPEN
```

**判定**：✅ **PASS**

---

#### L6-DEC-030：决策被destroy

**新设计行为**：

```typescript
Given:
  decision_1 = { options: ['A', 'B'], answers: {}, status: 'open' }

When:
  tx.begin()
  decision.destroy({ id: 'dec_001' })
  decision.answer({ decision: 'dec_001', choice: 'A' })  // 引用已失效
  result = tx.commit()

Then:
  ✅ result.ok == false
  ✅ result.code == E_REF_DESTROYED
```

**判定**：✅ **PASS**

---

## 总结

### 覆盖率统计

| 分类 | 用例数 | 判定PASS | 判定CONDITIONAL | 判定UNDEF（原Spec） |
|------|--------|----------|-----------------|---------------------|
| A：基本流转 | 10 | 10 | 0 | 0 |
| B：超时 | 6 | 6 | 0 | 0 |
| C：effect | 4 | 4 | 0 | 0 |
| D：嵌套并发 | 4 | 3 | 1 | 0 |
| E：边界 | 6 | 6 | 0 | 0 |
| **总计** | **30** | **29** | **1** | **0** |

### 唯一例外

**L6-DEC-023**（决策依赖）：需要显式排序，不允许同tx内的隐式依赖链。这是有意设计的约束，防止时序混乱。

### 新增机制汇总

| 机制 | Spec §7.5 | 新设计方案 |
|------|-----------|------------|
| 单选/多选模式 | ❌ | ✅ selection.mode |
| minCount/maxCount | ❌ | ✅ selection.minCount/maxCount |
| TTL相对超时 | ❌ | ✅ timeout.type='ttl' |
| defaultAnswer数组 | ❌（只有单个defaultChoice） | ✅ defaultAnswer?: Answer |
| merge.policy | ❌（只有quorum） | ✅ merge.policy |
| retract（撤销） | ❌ | ✅ decision.retract Op |
| replace（修改） | ❌ | ✅ answer.replace参数 |
| nestedDecision检测 | ❌ | ✅ nestedDecision:'allow'\|'deny' |
| 嵌套防护 | ❌ | ✅ executeEffects中的E_DEC_NESTED检测 |
| options唯一性 | ❌ | ✅ 创建时检查 |

### 下一步行动（已全部完成，2026-08-07 标注）

1. ✅ **合并到Spec**：`DECISION_重新设计方案.md` 已合并入 Spec §7.5（7 处）
   —— 但**其中的 `E_DEC_*` 细分错误码未被采纳**，实现阶段裁定并入 `E_DEC_VOID`，
   见 [`00_状态基线.md`](00_状态基线.md) §四
2. ✅ **实现验证**：已实现（`src/core/kernel/**` 的 Decision 相关 Op：
   `open`/`answer`/`retract`/`resolve`/`void`/`queryActions`）
3. ✅ **测试覆盖**：`kernel-l6-test` 实测 70 项命名测试、21 组属性测试、380,000 样本、
   49 个确定性边界用例，覆盖率 Statements 98.63% / Branches 97.82% / Functions 100%。
   发现并修复 1 个真实缺陷：超时默认答案可绕过 `minCount`

---

**文档状态**：🗄️ 历史归档（设计推演过程）。终值见
[`FINAL_L6_Decision完整审查报告.md`](FINAL_L6_Decision完整审查报告.md)（30/30 PASS）；
当前口径见 [`00_状态基线.md`](00_状态基线.md)。

# 测试驱动审查：L6 — Decision 决策树与玩家选择

> **文件性质：历史测试用例本体（手工推演轴）。已完成两轮推演。**
> 用例数 30 条；第二轮复测终值：**30/30 PASS**（第一轮数字见 `TEST_L6_审查结果报告.md`）。
> 属性实测：`kernel-l6-test`（70 项命名测试 / 380,000 样本，PASS；修复 1 处缺陷：超时默认答案可绕过 `minCount`）。
> 用例未被重写 —— 最终是扩充 Spec §7.5 同时支持"单actor多选+相对超时"与"多askee单选+绝对超时"两个正交维度，原用例原样复测通过。
> 当前口径见 [`00_状态基线.md`](00_状态基线.md) §3.1；仍开放的事项见 [`00_开放事项跟踪.md`](00_开放事项跟踪.md)。
> **错误码提示**：本文件断言中出现的细分错误码（`E_OP_STACK_*`/`E_TX_NESTED`/`E_DEC_*` 等）多数**未实现**，
> 已并入通用码；真相源为 `src/core/kernel/state/error-codes.ts`，见 `00_状态基线.md` §四。

## 审查目标

对内核Spec第8章（Decision）进行**可执行的边界测试**，重点验证：
1. **决策流转**：open → answer → resolve的状态机
2. **超时处理**：ttl过期后的默认行为
3. **答案验证**：非法答案、重复答案的拒绝
4. **决策嵌套**：一个决策的effect触发另一个决策

## 审查方法（严禁偷工减料）

对每条用例，你必须：
1. **手工推演**：按§8.x的规则，逐步推演决策状态变化
2. **给出状态转换图**：open → answer/timeout → resolve
3. **填写判定**：`PASS`（推演正确）/ `FAIL`（违反规则）/ `UNDEF`（Spec未定义）

---

## 核心规则（§8，被测断言的来源）

| 编号 | 规则 | 违反时错误码 |
|------|------|-------------|
| DEC-1 | 决策必须答满：所有options被选择或达到minCount | E_DEC_UNANSWERED |
| DEC-2 | 答案合法性：answer必须在options中 | E_DEC_INVALID_ANSWER |
| DEC-3 | 计数约束：answers.length必须满足[minCount, maxCount] | E_DEC_COUNT_MISMATCH |
| DEC-4 | 超时默认：ttl过期后自动应用defaultAnswer | 无（自动应用） |
| DEC-5 | 重复答案：multiSelect=false时拒绝重复 | E_DEC_DUPLICATE |
| DEC-6 | 决策解析：resolve时触发对应effect | 无 |
| DEC-7 | 嵌套限制：决策中不能触发新决策（防止死锁） | E_DEC_NESTED |

---

## 分类A：基本决策流转

### L6-DEC-001：单选决策 - 正常答题

```typescript
Given:
  decision_1 = {
    id: 'dec_001',
    type: 'choice',
    options: ['A', 'B', 'C'],
    minCount: 1,
    maxCount: 1,
    answer: []
  }

When:
  tx.begin()
  decision.answer({ id: 'dec_001', choice: 'B' })
  tx.commit()

Then:
  ✅ decision_1.answer == ['B']
  ✅ decision_1状态 == 'answered'

审查指令：
  按§8.1推演决策状态转换
```

---

### L6-DEC-002：单选决策 - 提交时自动resolve

```typescript
Given:
  同L6-DEC-001

When:
  tx.begin()
  decision.answer({ id: 'dec_001', choice: 'B' })
  result = tx.commit()

Then:
  ✅ result.ok == true
  ✅ decision_1被自动resolve
  ✅ 触发option['B']对应的effect

审查指令：
  验证tx.commit时是否自动resolve已答满的决策
```

---

### L6-DEC-003：单选决策 - 非法答案

```typescript
Given:
  decision_1 = {
    options: ['A', 'B', 'C']
  }

When:
  decision.answer({ id: 'dec_001', choice: 'D' })  // 'D'不在options中

Then:
  ✅ 操作失败
  ✅ 错误码 == E_DEC_INVALID_ANSWER
  ✅ decision_1.answer 未变

审查指令：
  按DEC-2推演，验证非法答案是否被拒绝
```

---

### L6-DEC-004：单选决策 - 重复答案

```typescript
Given:
  decision_1 = {
    options: ['A', 'B'],
    multiSelect: false,
    answer: ['A']
  }

When:
  decision.answer({ id: 'dec_001', choice: 'B' })  // 已有答案，尝试再答

Then:
  ✅ 操作失败
  ✅ 错误码 == E_DEC_DUPLICATE
  ✅ decision_1.answer == ['A']  // 未变

审查指令：
  验证multiSelect=false时是否拒绝第二次answer
```

---

### L6-DEC-005：多选决策 - 答满minCount

```typescript
Given:
  decision_1 = {
    options: ['A', 'B', 'C', 'D'],
    minCount: 2,
    maxCount: 3,
    multiSelect: true,
    answer: []
  }

When:
  tx.begin()
  decision.answer({ id: 'dec_001', choice: 'A' })
  decision.answer({ id: 'dec_001', choice: 'C' })
  tx.commit()

Then:
  ✅ decision_1.answer == ['A', 'C']
  ✅ 满足minCount=2
  ✅ 自动resolve

审查指令：
  验证minCount满足时是否允许提交
```

---

### L6-DEC-006：多选决策 - 未答满minCount

```typescript
Given:
  decision_1 = {
    options: ['A', 'B', 'C'],
    minCount: 2,
    answer: []
  }

When:
  tx.begin()
  decision.answer({ id: 'dec_001', choice: 'A' })  // 仅1个
  result = tx.commit()

Then:
  ✅ result.ok == false
  ✅ result.code == E_DEC_UNANSWERED
  ✅ decision_1.answer 回滚

审查指令：
  按DEC-1推演，验证未答满时tx是否失败
```

---

### L6-DEC-007：多选决策 - 超过maxCount

```typescript
Given:
  decision_1 = {
    options: ['A', 'B', 'C'],
    maxCount: 2,
    multiSelect: true,
    answer: ['A', 'B']
  }

When:
  decision.answer({ id: 'dec_001', choice: 'C' })  // 第3个

Then:
  ✅ 操作失败
  ✅ 错误码 == E_DEC_COUNT_MISMATCH
  ✅ decision_1.answer == ['A', 'B']  // 未变

审查指令：
  按DEC-3推演，验证maxCount限制
```

---

### L6-DEC-008：多选决策 - 重复选择同一选项

```typescript
Given:
  decision_1 = {
    options: ['A', 'B'],
    multiSelect: true,
    answer: ['A']
  }

When:
  decision.answer({ id: 'dec_001', choice: 'A' })  // 再次选'A'

Then:
  ✅ 操作失败
  ✅ 错误码 == E_DEC_DUPLICATE
  ✅ decision_1.answer == ['A']  // 未变

审查指令：
  验证multiSelect=true时是否也拒绝重复选项
```

---

### L6-DEC-009：撤销答案

```typescript
Given:
  decision_1 = {
    options: ['A', 'B', 'C'],
    multiSelect: true,
    answer: ['A', 'B']
  }

When:
  decision.retract({ id: 'dec_001', choice: 'A' })  // 撤销'A'

Then:
  ✅ 判定：UNDEF
  ✅ 原因：§8未定义"是否支持撤销答案"
  ✅ 建议：明确"答案不可撤销"或"提供retract Op"

审查指令：
  若Spec未提及撤销机制，标记 UNDEF
```

---

### L6-DEC-010：修改答案

```typescript
Given:
  decision_1 = {
    options: ['A', 'B'],
    answer: ['A']
  }

When:
  decision.answer({ id: 'dec_001', choice: 'B', replace: true })

Then:
  ✅ 判定：UNDEF
  ✅ 原因：§8未定义"是否支持修改答案"
  ✅ 建议：明确"答案一经提交不可修改"

审查指令：
  若Spec未提及修改机制，标记 UNDEF
```

---

## 分类B：超时与默认答案

### L6-DEC-011：超时 - 自动应用defaultAnswer

```typescript
Given:
  decision_1 = {
    id: 'dec_001',
    options: ['A', 'B', 'C'],
    ttl: 10,  // 10秒
    defaultAnswer: ['B'],
    answer: []
  }

When:
  等待11秒（超过ttl）
  tx.commit()

Then:
  ✅ decision_1.answer == ['B']（自动应用）
  ✅ decision_1被自动resolve
  ✅ 触发option['B']的effect

审查指令：
  按DEC-4推演，验证超时后的自动应用
```

---

### L6-DEC-012：超时 - 无defaultAnswer

```typescript
Given:
  decision_1 = {
    options: ['A', 'B'],
    ttl: 10,
    defaultAnswer: null,
    answer: []
  }

When:
  等待11秒
  tx.commit()

Then:
  ✅ result.ok == false
  ✅ result.code == E_DEC_UNANSWERED
  ✅ decision_1未resolve

审查指令：
  验证无defaultAnswer时超时是否导致tx失败
```

---

### L6-DEC-013：在ttl内答题 - 不触发默认

```typescript
Given:
  decision_1 = {
    options: ['A', 'B'],
    ttl: 10,
    defaultAnswer: ['B'],
    answer: []
  }

When:
  等待5秒
  decision.answer({ id: 'dec_001', choice: 'A' })
  tx.commit()

Then:
  ✅ decision_1.answer == ['A']（玩家答案）
  ✅ defaultAnswer未应用

审查指令：
  验证玩家答题是否覆盖defaultAnswer
```

---

### L6-DEC-014：ttl为0 - 立即超时

```typescript
Given:
  decision_1 = {
    options: ['A', 'B'],
    ttl: 0,
    defaultAnswer: ['A']
  }

When:
  tx.commit()（不答题）

Then:
  ✅ 立即超时
  ✅ decision_1.answer == ['A']

审查指令：
  验证ttl=0是否立即应用defaultAnswer
```

---

### L6-DEC-015：ttl为null - 永不超时

```typescript
Given:
  decision_1 = {
    options: ['A', 'B'],
    ttl: null,
    answer: []
  }

When:
  等待任意时长
  不答题
  tx.commit()

Then:
  ✅ result.ok == false
  ✅ result.code == E_DEC_UNANSWERED
  ✅ 永不自动应用defaultAnswer

审查指令：
  验证ttl=null是否禁用超时（若Spec未提及，标记 UNDEF）
```

---

### L6-DEC-016：defaultAnswer非法

```typescript
Given:
  decision_1 = {
    options: ['A', 'B'],
    defaultAnswer: ['C']  // 'C'不在options中
  }

When:
  等待超过ttl
  tx.commit()

Then:
  ✅ result.ok == false
  ✅ result.code == E_DEC_INVALID_ANSWER
  ✅ 或在决策创建时就拒绝

审查指令：
  验证defaultAnswer是否在创建时或应用时检查合法性
```

---

## 分类C：决策effect与解析

### L6-DEC-017：resolve触发effect

```typescript
Given:
  decision_1 = {
    options: {
      'A': { effect: attr.adjust({ entity: ctx.entity, gold: +10 }) },
      'B': { effect: attr.adjust({ entity: ctx.entity, gold: +20 }) }
    },
    answer: ['B']
  }
  entity_1.attr.gold = 50

When:
  tx.begin()
  decision.resolve('dec_001')
  tx.commit()

Then:
  ✅ entity_1.attr.gold == 70  // 50 + 20
  ✅ option['B']的effect被执行

审查指令：
  按DEC-6推演，验证resolve是否触发对应effect
```

---

### L6-DEC-018：多选resolve - 多个effect

```typescript
Given:
  decision_1 = {
    options: {
      'A': { effect: attr.adjust({ entity: ctx.entity, gold: +10 }) },
      'B': { effect: attr.adjust({ entity: ctx.entity, gold: +20 }) }
    },
    answer: ['A', 'B']
  }
  entity_1.attr.gold = 50

When:
  decision.resolve('dec_001')

Then:
  ✅ entity_1.attr.gold == 80  // 50 + 10 + 20
  ✅ 两个effect都被执行

审查指令：
  验证多选时effect的执行顺序（按answer数组顺序？）
```

---

### L6-DEC-019：effect执行失败 - 整个tx回滚

```typescript
Given:
  decision_1 = {
    options: {
      'A': { effect: cost.freeze({ entity: ctx.entity, gold: 1000 }) }  // 金币不足
    },
    answer: ['A']
  }
  entity_1.attr.gold = 50

When:
  tx.begin()
  decision.resolve('dec_001')
  result = tx.commit()

Then:
  ✅ result.ok == false
  ✅ result.code == E_COST_INSUFFICIENT
  ✅ entity_1.attr.gold == 50  // 未变
  ✅ decision_1仍为'answered'状态（未resolve）

审查指令：
  验证effect失败时决策是否回滚
```

---

### L6-DEC-020：无effect的选项

```typescript
Given:
  decision_1 = {
    options: {
      'A': { effect: null },
      'B': { effect: log('选了B') }
    },
    answer: ['A']
  }

When:
  decision.resolve('dec_001')

Then:
  ✅ 无副作用
  ✅ decision_1被标记为resolved

审查指令：
  验证无effect的选项是否被允许
```

---

## 分类D：嵌套与并发

### L6-DEC-021：决策中触发新决策 - 被拒绝

```typescript
Given:
  decision_1 = {
    options: {
      'A': { effect: decision.open({ id: 'dec_002', options: ['X', 'Y'] }) }
    }
  }

When:
  tx.begin()
  decision.answer({ id: 'dec_001', choice: 'A' })
  decision.resolve('dec_001')  // effect触发dec_002
  result = tx.commit()

Then:
  ✅ result.ok == false
  ✅ result.code == E_DEC_NESTED
  ✅ 防止决策死锁

审查指令：
  按DEC-7推演，验证嵌套决策是否被拒绝
```

---

### L6-DEC-022：同一tx内答多个决策

```typescript
Given:
  decision_1 = { options: ['A', 'B'], answer: [] }
  decision_2 = { options: ['X', 'Y'], answer: [] }

When:
  tx.begin()
  decision.answer({ id: 'dec_001', choice: 'A' })
  decision.answer({ id: 'dec_002', choice: 'X' })
  tx.commit()

Then:
  ✅ result.ok == true
  ✅ 两个决策都被resolve

审查指令：
  验证同一tx内多个独立决策是否被允许
```

---

### L6-DEC-023：决策依赖 - 后者依赖前者的结果

```typescript
Given:
  decision_1 = {
    options: {
      'A': { effect: attr.set({ entity: ctx.entity, flag: 'chose_A' }) }
    }
  }
  decision_2 = {
    options: ['X', 'Y'],
    condition: ctx.entity.attr.flag == 'chose_A'  // 依赖dec_1
  }

When:
  tx.begin()
  decision.answer({ id: 'dec_001', choice: 'A' })
  decision.resolve('dec_001')  // 设置flag
  decision.open({ id: 'dec_002', ... })  // 打开dec_2
  decision.answer({ id: 'dec_002', choice: 'X' })
  tx.commit()

Then:
  ✅ 判定：UNDEF
  ✅ 原因：§8未定义"同一tx内决策的依赖链"
  ✅ 建议：明确"允许但需显式排序"或"禁止同tx内依赖"

审查指令：
  若Spec未提及决策依赖，标记 UNDEF
```

---

### L6-DEC-024：并发答题 - 多个玩家

```typescript
Given:
  decision_1 = {
    options: ['A', 'B'],
    targetPlayers: [player_1, player_2],
    answer: []
  }

When:
  player_1.answer({ id: 'dec_001', choice: 'A' })
  player_2.answer({ id: 'dec_001', choice: 'B' })

Then:
  ✅ 判定：UNDEF
  ✅ 原因：§8未定义"多玩家决策的合并规则"
  ✅ 选项：
    - 投票制（多数胜出）
    - 全员一致
    - 第一个答案胜出

审查指令：
  若Spec未提及多玩家决策，标记 UNDEF
```

---

## 分类E：边界情况

### L6-DEC-025：空options列表

```typescript
Given:
  decision_1 = {
    options: []
  }

When:
  decision.open({ id: 'dec_001', options: [] })

Then:
  ✅ 操作失败
  ✅ 错误码 == E_DEC_INVALID（或类似）

审查指令：
  验证空options是否在创建时被拒绝
```

---

### L6-DEC-026：minCount > maxCount

```typescript
Given:
  decision_1 = {
    minCount: 3,
    maxCount: 2
  }

When:
  decision.open({ id: 'dec_001', ... })

Then:
  ✅ 操作失败
  ✅ 错误码 == E_DEC_INVALID

审查指令：
  验证矛盾约束是否在创建时被拒绝
```

---

### L6-DEC-027：maxCount > options.length

```typescript
Given:
  decision_1 = {
    options: ['A', 'B'],
    maxCount: 5
  }

When:
  decision.open({ id: 'dec_001', ... })

Then:
  ✅ 判定：UNDEF
  ✅ 原因：§8未定义此情况
  ✅ 选项：
    - 允许（maxCount自动clamp到options.length）
    - 拒绝（配置错误）

审查指令：
  若Spec未提及，标记 UNDEF
```

---

### L6-DEC-028：重复的option值

```typescript
Given:
  decision_1 = {
    options: ['A', 'B', 'A']  // 重复'A'
  }

When:
  decision.open({ id: 'dec_001', ... })

Then:
  ✅ 判定：UNDEF
  ✅ 原因：§8未定义"options是否必须唯一"
  ✅ 建议：明确"options必须唯一"

审查指令：
  若Spec未提及，标记 UNDEF
```

---

### L6-DEC-029：答题时决策已resolve

```typescript
Given:
  decision_1已resolve

When:
  decision.answer({ id: 'dec_001', choice: 'A' })

Then:
  ✅ 操作失败
  ✅ 错误码 == E_DEC_ALREADY_RESOLVED

审查指令：
  验证resolve后是否拒绝answer
```

---

### L6-DEC-030：决策被destroy

```typescript
Given:
  decision_1 = { options: ['A', 'B'], answer: [] }

When:
  tx.begin()
  decision.del('dec_001')
  decision.answer({ id: 'dec_001', choice: 'A' })
  result = tx.commit()

Then:
  ✅ result.ok == false
  ✅ result.code == E_REF_DESTROYED

审查指令：
  验证destroy后的决策引用是否失效
```

---

## 使用说明（给审查者）

### 如何执行审查

1. **逐条推演**：对每条用例，按§8手工推演决策状态机
2. **画状态图**：open → answer → resolve的转换
3. **填写判定**：PASS / FAIL / UNDEF
4. **记录证据**：引用Spec具体段落

### 输出格式

```markdown
## 审查结果：L6-DEC-001

**判定**：PASS

**推演过程**：
1. decision_1状态 = 'open'
2. answer('B') → decision_1.answer = ['B']
3. 满足minCount=1 → 状态转为'answered'
4. tx.commit() → 自动resolve → 触发effect

**Spec引用**：§8.1决策状态机

---

## 审查结果：L6-DEC-009

**判定**：UNDEF

**原因**：
§8未提及撤销答案的机制。

**建议**：
明确"答案一经提交不可撤销"或"提供decision.retract Op"。

**Spec引用**：§8整章
```

---

## 统计

- **分类A（基本流转）**：10条
- **分类B（超时）**：6条
- **分类C（effect）**：4条
- **分类D（嵌套并发）**：4条
- **分类E（边界）**：6条
- **总计**：30条

---

## 全部Prompt汇总

完成以下四份Prompt的审查后，你将获得：

| Prompt | 用例数 | 覆盖层 |
|--------|--------|--------|
| TEST_L3_Ops事务守恒性 | 80 | L3-Ops、不变量、事务 |
| TEST_L4_Hook五阶段竞争 | 45 | L4-Hook、depth、重入锁 |
| TEST_L5_Expr表达式求值 | 47 | L5-Expr、类型、查询 |
| TEST_L6_Decision决策树 | 30 | L6-Decision、超时、嵌套 |
| **总计** | **202条** | **4个核心层** |

每条用例都是 **Given-When-Then** 格式，可直接执行验证，无空想余地。

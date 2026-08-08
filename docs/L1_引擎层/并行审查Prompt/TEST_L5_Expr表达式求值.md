# 测试驱动审查：L5 — Expr 表达式求值与类型安全

> **文件性质：历史测试用例本体（手工推演轴）。已完成两轮推演。**
> 用例数 47 条；第二轮复测终值：**47/47 PASS**（第一轮数字见 `TEST_L5_审查结果报告.md`）。
> 属性实测：`kernel-l5-test`（6 项命名测试 / 320,047 次检查，PASS；实现阶段修复 5 处求值器缺陷）。
> ✅ 规则 `EXPR-2` 与用例 `L5-EXPR-003`/`L5-EXPR-004` 的除零断言已改为「返回 `null`」，与 Spec 的全函数承诺一致。
> 当前口径见 [`00_状态基线.md`](00_状态基线.md) §3.1；仍开放的事项见 [`00_开放事项跟踪.md`](00_开放事项跟踪.md)。
> **错误码提示**：本文件断言中出现的细分错误码（`E_OP_STACK_*`/`E_TX_NESTED`/`E_DEC_*` 等）多数**未实现**，
> 已并入通用码；真相源为 `src/core/kernel/state/error-codes.ts`，见 `00_状态基线.md` §四。

## 审查目标

对内核Spec第5章（Expr）进行**可执行的边界测试**，重点验证：
1. **求值正确性**：各类表达式（算术、逻辑、查询）的计算结果
2. **类型检查**：类型不匹配时的错误处理
3. **边界值处理**：除零、溢出、null/undefined
4. **上下文绑定**：变量作用域、闭包

## 审查方法（严禁偷工减料）

对每条用例，你必须：
1. **手工求值**：按§5.x的规则，逐步展开表达式求值过程
2. **类型推导**：写出每个子表达式的类型
3. **给出判定**：`PASS`（求值正确）/ `FAIL`（结果错误）/ `UNDEF`（Spec未定义）

---

## 核心规则（§5，被测断言的来源）

| 编号 | 规则 | 违反时错误码 |
|------|------|-------------|
| EXPR-1 | 类型匹配：算术运算要求number，逻辑运算要求bool | E_EXPR_TYPE |
| EXPR-2 | 除零检查：`x / 0` 返回 `null`（不抛异常） | `null` |
| EXPR-3 | null传播：null参与算术运算返回null | 无（null传播） |
| EXPR-4 | 短路求值：&& 和 \|\| 的短路行为 | 无 |
| EXPR-5 | 查询返回类型：query.count() → number | E_EXPR_TYPE |
| EXPR-6 | 上下文变量：ctx.entity、ctx.target等的绑定 | E_EXPR_UNBOUND_VAR |
| EXPR-7 | 非有限数拒绝：Infinity、NaN不允许写入状态 | E_EXPR_TYPE (INV-16) |

---

## 分类A：算术表达式

### L5-EXPR-001：基本四则运算

```typescript
Given:
  entity_1.attr.hp = 100
  entity_1.attr.maxHp = 150

When:
  expr = entity_1.attr.hp + 50

Then:
  ✅ 求值结果 == 150
  ✅ 类型 == number

审查指令：
  按§5.1推演算术运算，验证加法是否正确
```

---

### L5-EXPR-002：除法正常

```typescript
Given:
  entity_1.attr.gold = 100

When:
  expr = entity_1.attr.gold / 4

Then:
  ✅ 求值结果 == 25
  ✅ 类型 == number

审查指令：
  验证整数除法的结果
```

---

### L5-EXPR-003：除零错误

```typescript
Given:
  entity_1.attr.gold = 100

When:
  expr = entity_1.attr.gold / 0

Then:
  ✅ 求值结果 == null
  ✅ 不抛出异常

审查指令：
  按EXPR-2推演，验证除零返回null而非异常（保持全函数承诺）
```

---

### L5-EXPR-004：除以变量为0

```typescript
Given:
  entity_1.attr.armor = 0
  entity_1.attr.damage = 100

When:
  expr = entity_1.attr.damage / entity_1.attr.armor

Then:
  ✅ 求值结果 == null
  ✅ 不抛出异常

审查指令：
  验证运行时除零返回null（非静态检测）
```

---

### L5-EXPR-005：null传播 - null + number

```typescript
Given:
  entity_1.attr.bonus = null
  entity_1.attr.base = 100

When:
  expr = entity_1.attr.base + entity_1.attr.bonus

Then:
  ✅ 求值结果 == null  // null传播
  ✅ 类型 == number | null

审查指令：
  按EXPR-3推演null传播规则
```

---

### L5-EXPR-006：null传播 - null * number

```typescript
Given:
  entity_1.attr.multiplier = null

When:
  expr = 10 * entity_1.attr.multiplier

Then:
  ✅ 求值结果 == null

审查指令：
  验证null传播在所有算术运算中生效
```

---

### L5-EXPR-007：类型错误 - string + number

```typescript
Given:
  entity_1.attr.name = "Alice"
  entity_1.attr.level = 5

When:
  expr = entity_1.attr.name + entity_1.attr.level

Then:
  ✅ 判定：UNDEF
  ✅ 原因：§5.1未明确"string + number"的行为
  ✅ 选项：
    - 类型强制转换（JS风格："Alice5"）
    - 类型错误（严格类型）
    - 字符串拼接优先

审查指令：
  若Spec未定义混合类型算术，标记 UNDEF
```

---

### L5-EXPR-008：运算符优先级 - 乘法优先于加法

```typescript
Given:
  entity_1.attr.base = 10
  entity_1.attr.bonus = 5
  entity_1.attr.multiplier = 2

When:
  expr = entity_1.attr.base + entity_1.attr.bonus * entity_1.attr.multiplier

Then:
  ✅ 求值结果 == 10 + (5 * 2) == 20
  ✅ NOT (10 + 5) * 2 == 30

审查指令：
  验证§5.1是否明确运算符优先级
```

---

### L5-EXPR-009：括号改变优先级

```typescript
Given:
  同L5-EXPR-008

When:
  expr = (entity_1.attr.base + entity_1.attr.bonus) * entity_1.attr.multiplier

Then:
  ✅ 求值结果 == (10 + 5) * 2 == 30

审查指令：
  验证括号是否正确改变求值顺序
```

---

### L5-EXPR-010：浮点精度 - 0.1 + 0.2

```typescript
Given:
  entity_1.attr.value_a = 0.1
  entity_1.attr.value_b = 0.2

When:
  expr = entity_1.attr.value_a + entity_1.attr.value_b

Then:
  ✅ 判定：UNDEF
  ✅ 原因：§5.1未定义浮点数精度处理
  ✅ 实际结果可能是 0.30000000000000004（IEEE 754）
  ✅ 建议：明确"采用IEEE 754双精度"或"定点数"

审查指令：
  若Spec未提及数值精度，标记 UNDEF
```

---

### L5-EXPR-011：负数运算

```typescript
Given:
  entity_1.attr.hp = 100

When:
  expr = entity_1.attr.hp + (-50)

Then:
  ✅ 求值结果 == 50

审查指令：
  验证负数字面量是否被支持
```

---

### L5-EXPR-012：取模运算

```typescript
Given:
  entity_1.attr.gold = 17

When:
  expr = entity_1.attr.gold % 5

Then:
  ✅ 求值结果 == 2

审查指令：
  验证§5.1是否支持%运算符（若未提及，标记 UNDEF）
```

---

### L5-EXPR-013：幂运算

```typescript
Given:
  entity_1.attr.base = 2

When:
  expr = entity_1.attr.base ** 10

Then:
  ✅ 求值结果 == 1024

审查指令：
  验证是否支持**运算符（若未提及，标记 UNDEF）
```

---

### L5-EXPR-014：溢出 - 超过最大安全整数

```typescript
Given:
  entity_1.attr.bigValue = 9007199254740991  // Number.MAX_SAFE_INTEGER

When:
  expr = entity_1.attr.bigValue + 1

Then:
  ✅ 判定：UNDEF
  ✅ 原因：§5.1未定义整数溢出行为
  ✅ 建议：明确"超过MAX_SAFE_INTEGER返回错误"或"允许溢出"

审查指令：
  若Spec未提及溢出处理，标记 UNDEF
```

---

### L5-EXPR-015：Infinity写入被拒绝

```typescript
Given:
  entity_1.attr.hp = 100

When:
  attr.set({ entity: entity_1, hp: 1 / 0 })  // 结果为Infinity

Then:
  ✅ 操作失败
  ✅ 错误码 == E_EXPR_TYPE
  ✅ entity_1.attr.hp == 100  // 未变

审查指令：
  按INV-16推演，验证非有限数是否被拒绝
```

---

### L5-EXPR-016：NaN写入被拒绝

```typescript
Given:
  entity_1.attr.hp = 100

When:
  attr.set({ entity: entity_1, hp: 0 / 0 })  // 结果为NaN

Then:
  ✅ 操作失败
  ✅ 错误码 == E_EXPR_TYPE
  ✅ entity_1.attr.hp == 100  // 未变

审查指令：
  验证NaN是否被拒绝
```

---

### L5-EXPR-017：负零

```typescript
Given:
  entity_1.attr.value = 0

When:
  expr = entity_1.attr.value * (-1)

Then:
  ✅ 求值结果 == -0
  ✅ 判定：UNDEF（-0与0是否等价？）

审查指令：
  若Spec未定义-0的语义，标记 UNDEF
```

---

## 分类B：逻辑表达式

### L5-LOGIC-001：基本逻辑与

```typescript
Given:
  entity_1.attr.hp = 50
  entity_1.attr.maxHp = 100

When:
  expr = (entity_1.attr.hp > 0) && (entity_1.attr.hp < entity_1.attr.maxHp)

Then:
  ✅ 求值结果 == true
  ✅ 类型 == bool

审查指令：
  按§5.2推演逻辑运算
```

---

### L5-LOGIC-002：短路求值 - && 左侧为false

```typescript
Given:
  entity_1.attr.hp = 0

When:
  expr = (entity_1.attr.hp > 0) && (1 / entity_1.attr.hp > 0)  // 右侧会除零

Then:
  ✅ 求值结果 == false
  ✅ 右侧不执行（短路）
  ✅ 无除零错误

审查指令：
  按EXPR-4推演短路行为
```

---

### L5-LOGIC-003：短路求值 - || 左侧为true

```typescript
Given:
  entity_1.attr.isAlive = true

When:
  expr = entity_1.attr.isAlive || (1 / 0 > 0)  // 右侧会除零

Then:
  ✅ 求值结果 == true
  ✅ 右侧不执行（短路）
  ✅ 无除零错误

审查指令：
  验证||的短路行为
```

---

### L5-LOGIC-004：逻辑非

```typescript
Given:
  entity_1.attr.isAlive = true

When:
  expr = !entity_1.attr.isAlive

Then:
  ✅ 求值结果 == false

审查指令：
  验证!运算符
```

---

### L5-LOGIC-005：比较运算 - 等于

```typescript
Given:
  entity_1.attr.hp = 100

When:
  expr = entity_1.attr.hp == 100

Then:
  ✅ 求值结果 == true

审查指令：
  验证==运算符
```

---

### L5-LOGIC-006：比较运算 - 不等于

```typescript
Given:
  entity_1.attr.hp = 100

When:
  expr = entity_1.attr.hp != 50

Then:
  ✅ 求值结果 == true

审查指令：
  验证!=运算符
```

---

### L5-LOGIC-007：null比较 - null == null

```typescript
Given:
  entity_1.attr.bonus = null

When:
  expr = entity_1.attr.bonus == null

Then:
  ✅ 求值结果 == true

审查指令：
  验证null相等性检查
```

---

### L5-LOGIC-008：null比较 - null != 0

```typescript
Given:
  entity_1.attr.bonus = null

When:
  expr = entity_1.attr.bonus != 0

Then:
  ✅ 判定：UNDEF
  ✅ 原因：§5.2未定义"null与number的!=比较"
  ✅ 选项：
    - true（null != 任何非null值）
    - false（null强制转换为0）

审查指令：
  若Spec未定义null与其他类型的比较，标记 UNDEF
```

---

### L5-LOGIC-009：类型错误 - string && number

```typescript
Given:
  entity_1.attr.name = "Alice"
  entity_1.attr.level = 5

When:
  expr = entity_1.attr.name && entity_1.attr.level

Then:
  ✅ 判定：UNDEF
  ✅ 原因：§5.2未定义"非bool类型的逻辑运算"
  ✅ 选项：
    - 类型错误（严格）
    - Truthy/Falsy转换（JS风格）

审查指令：
  若Spec未定义非bool的逻辑运算，标记 UNDEF
```

---

### L5-LOGIC-010：链式比较

```typescript
Given:
  entity_1.attr.hp = 50
  entity_1.attr.minHp = 0
  entity_1.attr.maxHp = 100

When:
  expr = entity_1.attr.minHp < entity_1.attr.hp < entity_1.attr.maxHp

Then:
  ✅ 判定：UNDEF
  ✅ 原因：§5.2未定义链式比较
  ✅ 选项：
    - 支持（Python风格）
    - 不支持（需写成 (minHp < hp) && (hp < maxHp)）

审查指令：
  若Spec未提及链式比较，标记 UNDEF
```

---

## 分类C：查询表达式

### L5-QUERY-001：query.count - 计数

```typescript
Given:
  entity_1.containers.backpack = [
    { slot_0, holds: item_1, def: 'coin' },
    { slot_1, holds: item_2, def: 'coin' },
    { slot_2, holds: item_3, def: 'gem' }
  ]

When:
  expr = query(entity_1.containers.backpack).filter(def == 'coin').count()

Then:
  ✅ 求值结果 == 2
  ✅ 类型 == number

审查指令：
  按§5.3推演query的filter和count
```

---

### L5-QUERY-002：query.sum - 求和

```typescript
Given:
  entity_1.containers.backpack = [
    { slot_0, holds: item_1, def: 'coin', stack: 10 },
    { slot_1, holds: item_2, def: 'coin', stack: 5 }
  ]

When:
  expr = query(entity_1.containers.backpack).filter(def == 'coin').sum(stack)

Then:
  ✅ 求值结果 == 15
  ✅ 类型 == number

审查指令：
  验证query.sum是否正确聚合
```

---

### L5-QUERY-003：query.any - 存在性检查

```typescript
Given:
  entity_1.containers.backpack = [
    { slot_0, holds: item_1, def: 'sword' }
  ]

When:
  expr = query(entity_1.containers.backpack).filter(hasTag('weapon')).any()

Then:
  ✅ 求值结果 == true
  ✅ 类型 == bool

审查指令：
  验证query.any
```

---

### L5-QUERY-004：query.all - 全称量词

```typescript
Given:
  entity_1.containers.backpack = [
    { slot_0, holds: item_1, def: 'sword', tags: ['weapon'] },
    { slot_1, holds: item_2, def: 'axe', tags: ['weapon'] }
  ]

When:
  expr = query(entity_1.containers.backpack).all(hasTag('weapon'))

Then:
  ✅ 求值结果 == true

审查指令：
  验证query.all（若Spec未提及，标记 UNDEF）
```

---

### L5-QUERY-005：query空集 - count返回0

```typescript
Given:
  entity_1.containers.backpack = []

When:
  expr = query(entity_1.containers.backpack).count()

Then:
  ✅ 求值结果 == 0

审查指令：
  验证空集的count
```

---

### L5-QUERY-006：query空集 - sum返回0

```typescript
Given:
  entity_1.containers.backpack = []

When:
  expr = query(entity_1.containers.backpack).sum(stack)

Then:
  ✅ 求值结果 == 0

审查指令：
  验证空集的sum
```

---

### L5-QUERY-007：query空集 - any返回false

```typescript
Given:
  entity_1.containers.backpack = []

When:
  expr = query(entity_1.containers.backpack).any()

Then:
  ✅ 求值结果 == false

审查指令：
  验证空集的any
```

---

### L5-QUERY-008：query.first - 取第一个

```typescript
Given:
  entity_1.containers.backpack = [
    { slot_0, holds: item_1, def: 'coin' },
    { slot_1, holds: item_2, def: 'gem' }
  ]

When:
  expr = query(entity_1.containers.backpack).first().def

Then:
  ✅ 求值结果 == 'coin'

审查指令：
  验证query.first（若Spec未提及，标记 UNDEF）
```

---

### L5-QUERY-009：query.first空集 - 返回null

```typescript
Given:
  entity_1.containers.backpack = []

When:
  expr = query(entity_1.containers.backpack).first()

Then:
  ✅ 求值结果 == null

审查指令：
  验证空集的first
```

---

### L5-QUERY-010：嵌套query

```typescript
Given:
  entity_1.rel.out['ally'] = [entity_2, entity_3]
  entity_2.containers.backpack有2个coin
  entity_3.containers.backpack有3个coin

When:
  expr = query(entity_1.rel.out['ally'])
    .sum(
      query($.containers.backpack).filter(def == 'coin').count()
    )

Then:
  ✅ 求值结果 == 2 + 3 == 5

审查指令：
  验证嵌套query是否支持（若Spec未提及，标记 UNDEF）
```

---

## 分类D：上下文变量

### L5-CTX-001：ctx.entity - 当前实体

```typescript
Given:
  entity_1.attr.hp = 100
  entity_1执行表达式

When:
  expr = ctx.entity.attr.hp + 10

Then:
  ✅ 求值结果 == 110
  ✅ ctx.entity绑定到entity_1

审查指令：
  按§5.4推演上下文变量绑定
```

---

### L5-CTX-002：ctx.target - 事件目标

```typescript
Given:
  entity_1.attr.damage = 20
  entity_2.attr.hp = 100
  Hook表达式中使用ctx

When:
  emit('damage', { source: entity_1, target: entity_2 })
  Hook内求值: ctx.target.attr.hp - ctx.source.attr.damage

Then:
  ✅ ctx.source == entity_1
  ✅ ctx.target == entity_2
  ✅ 求值结果 == 100 - 20 == 80

审查指令：
  验证事件参数是否绑定到ctx
```

---

### L5-CTX-003：未绑定变量

```typescript
Given:
  entity_1执行表达式

When:
  expr = ctx.unknownVar + 10

Then:
  ✅ 求值结果 == null
  ✅ 不抛出异常

审查指令：
  按§3.1.2推演，未绑定上下文变量返回null（保持全函数承诺）
```

---

### L5-CTX-004：Lambda字面量 - 不支持

```typescript
Given:
  entity_1.attr.multiplier = 2

When:
  尝试使用lambda字面量语法：
  expr = lambda(x) => x * ctx.entity.attr.multiplier

Then:
  ❌ 该语法在Spec中不合法
  ✅ §3.1.6明确：Expr不支持lambda字面量（有意为之，保持非图灵完备）

等效合法写法（使用具名表达式）：
  ExprDef { params:['x'], body: { op:'*', left:{var:'x'}, right:{path:'entity.attr.multiplier'} } }
  调用：{ call: 'expr.myDef', args: { x: 10 } }

审查指令：
  §3.1.6已明确不支持lambda。此测试确认闭包行为正确为UNSUPPORTED，
  并提供等效的具名表达式写法供参考。
```

---

### L5-CTX-005：作用域嵌套

```typescript
Given:
  外层ctx.entity = entity_1
  内层emit事件，ctx.entity = entity_2

When:
  外层表达式中嵌套emit，emit内的Hook读取ctx.entity

Then:
  ✅ Hook内ctx.entity == entity_2（内层覆盖）
  ✅ emit返回后ctx.entity == entity_1（恢复）

审查指令：
  验证ctx是否按调用栈动态绑定
```

---

## 分类E：特殊情况

### L5-SPECIAL-001：表达式中的副作用

```typescript
Given:
  entity_1.attr.counter = 0

When:
  expr = (entity_1.attr.counter += 1) + (entity_1.attr.counter += 1)

Then:
  ✅ 判定：UNDEF
  ✅ 原因：§5未定义"表达式中的赋值和求值顺序"
  ✅ 建议：明确"表达式为纯函数，禁止副作用"

审查指令：
  若Spec允许表达式有副作用，标记 UNDEF
```

---

### L5-SPECIAL-002：表达式中调用Op

```typescript
Given:
  entity_1.containers.backpack有item_1

When:
  expr = item.destroy(item_1) && true

Then:
  ✅ 判定：UNDEF
  ✅ 原因：§5未定义"表达式中能否调用Op"
  ✅ 建议：明确"表达式为只读，Op调用必须在外层"

审查指令：
  若Spec未禁止表达式调用Op，标记 UNDEF
```

---

### L5-SPECIAL-003：递归表达式

```typescript
Given:
  定义递归函数：fib(n) = if(n <= 1) then 1 else fib(n-1) + fib(n-2)

When:
  求值fib(5)

Then:
  ✅ 判定：UNDEF
  ✅ 原因：§5未定义"是否支持递归表达式"
  ✅ 建议：明确"支持递归，但有depth限制"

审查指令：
  若Spec未提及递归，标记 UNDEF
```

---

### L5-SPECIAL-004：表达式求值超时

```typescript
Given:
  定义无限循环表达式：loop() = loop()

When:
  求值loop()

Then:
  ✅ 判定：UNDEF
  ✅ 原因：§5未定义"表达式求值超时机制"
  ✅ 建议：明确"表达式求值有step上限"

审查指令：
  若Spec未提及求值终止条件，标记 UNDEF
```

---

### L5-SPECIAL-005：大表达式 - 性能

```typescript
Given:
  expr = (a + b) * (c + d) * ... (1000层嵌套)

When:
  求值expr

Then:
  ✅ 判定：UNDEF
  ✅ 原因：§5未定义"表达式复杂度限制"
  ✅ 建议：明确"表达式最大深度"或"节点数限制"

审查指令：
  若Spec未提及复杂度限制，标记 UNDEF
```

---

## 使用说明（给审查者）

### 如何执行审查

1. **逐条推演**：对每条用例，按§5.x手工求值
2. **类型推导**：写出每个子表达式的类型
3. **填写判定**：PASS / FAIL / UNDEF
4. **记录证据**：引用Spec具体段落

### 输出格式

```markdown
## 审查结果：L5-EXPR-003

**判定**：PASS（按Spec修正后）

**推演过程**：
1. 读取entity_1.attr.gold = 100
2. 计算100 / 0
3. 按§3.1规定，除零返回null（不抛异常）
4. 返回null

**Spec引用**：§3.1 除零返回null，不抛。

---

## 审查结果：L5-EXPR-007

**判定**：UNDEF

**原因**：
§5.1未定义string与number的+运算行为。

**建议**：
明确"算术运算要求两侧类型相同，否则返回E_EXPR_TYPE"。

**Spec引用**：§5.1整段
```

---

## 统计

- **分类A（算术）**：17条
- **分类B（逻辑）**：10条
- **分类C（查询）**：10条
- **分类D（上下文）**：5条
- **分类E（特殊）**：5条
- **总计**：47条

---

## 下一步

完成L5审查后，继续执行 **TEST_L6_Decision决策树.md**（30条用例）。

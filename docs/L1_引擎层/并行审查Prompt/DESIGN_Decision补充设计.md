# Decision系统补充设计 v1.0

> **目的**：填补§7.5 Decision原语的语义缺口，保证内核完备性
> **依据**：TEST_L6审查结果（14条UNDEF）+ 宪法0.2三条完备性判据
> **版本**：v1.0 | 2026-08-06

---

## 一、问题清单与设计决策

### 1.1 问题总表

| 问题ID | 缺口描述 | 来源用例 | 优先级 |
|--------|---------|---------|--------|
| DEC-G1 | 单actor多选机制缺失 | L6-DEC-005~008 | P0 |
| DEC-G2 | 答案修改/撤销规则未定义 | L6-DEC-009~010 | P0 |
| DEC-G3 | options唯一性约束缺失 | L6-DEC-028 | P0 |
| DEC-G4 | askee失效处理未定义 | L6-DEC-024 | P1 |
| DEC-G5 | E_DEC_*错误码不完整 | 贯穿全用例 | P1 |
| DEC-G6 | quorum:'majority'语义模糊 | L6-DEC-024 | P1 |

---

## 二、核心扩展设计

### 2.1 单actor多选机制（DEC-G1）

#### 2.1.1 设计分析

**需求来源**（三处复用验证）：
1. **投票场景**：从N个候选人中选K个（K可自定义）
2. **技能选择**：从技能池中选N个装备栏
3. **物品分配**：从战利品中选X件

**设计选项对比**：

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| A：扩展answers类型 | `answers[actorId]: Value[]` | 表达力强 | 破坏现有类型 |
| B：新增select字段 | `{actorId: {selections: string[], timestamp: number}}` | 向前兼容 | 结构复杂 |
| C：count约束 | `DecisionDef.count: {min, max}` | 简洁 | 需配合方案A/B |

**选定方案**：C + 扩展answers类型

#### 2.1.2 类型扩展

```typescript
// 扩展answers语义：单个actor可选择多个选项
type DecisionAnswers = Record<string, string | string[]>
// actorId → 单选项名 或 选项名数组

interface DecisionDef extends Def {
  kind: 'decision'
  options: { name: string, label: Expr, require?: Expr }[]
  quorum: 'all' | 'any' | 'majority'
  // ★ 新增：单actor可选数量约束
  count?: {
    min: number      // 每actor最少选几个（默认1）
    max: number      // 每actor最多选几个（默认1）
  }
  onTimeout: 'default' | 'void'
  defaultChoice?: string | string[]  // ★ 支持多默认值
  onResolve: Effect[]
  onVoid?: Effect[]
}
```

#### 2.1.3 语义规则

**规则 DEC-EXT1：单actor多选计数**

```
给定：DecisionDef.count = {min: 2, max: 4}
当：actor A提交选择 ['X', 'Y', 'Z']
则：
  - 如果 3 ∈ [2, 4] ✓ 接受
  - 如果 1 < 2 → 拒绝，E_DEC_COUNT_UNDERFLOW
  - 如果 5 > 4 → 拒绝，E_DEC_COUNT_OVERFLOW
```

**规则 DEC-EXT2：多选时选项可重复**

```
给定：count.max > 1
当：actor A提交选择 ['X', 'X']
则：
  - 如果 options.X 允许重复选择 ✓ 接受
  - 如果 options.X 标记 requireUnique → 拒绝，E_DEC_DUPLICATE
```

**规则 DEC-EXT3：选项可重复标记**

```typescript
interface DecisionOption {
  name: string
  label: Expr
  require?: Expr
  // ★ 新增：是否允许同一actor重复选择
  uniquePerActor?: boolean  // 默认 true（防刷道具）
}
```

#### 2.1.4 quorum与count联动

| quorum | count约束 | 何时resolved |
|--------|-----------|--------------|
| 'all' | 每actor都需满足[min,max] | 所有askees都答满 |
| 'any' | 只要有人满足即可 | 第一个答满的actor |
| 'majority' | 过半数askees答满 | 超过半数答满 |

---

### 2.2 答案修改/撤销规则（DEC-G2）

#### 2.2.1 设计分析

**需求来源**：
1. 玩家误操作需要撤回
2. 规则允许"改变主意"（如出价场景）
3. AI重搜索需要更新答案

**核心原则**：答案的不可变性是事务安全的基础，但需要有控制的修改路径。

#### 2.2.2 语义规则

**规则 DEC-EXT4：答案状态机**

```
                    ┌──────────────┐
                    │    open      │
                    │ (等待回答)    │
                    └──────┬───────┘
                           │ answer()
                           │ (count满足后)
                           ▼
              ┌────────────────────────┐
              │      open'             │
              │ (已答满，等待更多/修改)  │
              └──────────┬─────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
    ┌─────────┐   ┌──────────┐   ┌──────────┐
    │resolve()│   │ retract()│   │ deadline │
    └────┬────┘   └────┬─────┘   └────┬─────┘
         │            │              │
         ▼            ▼              ▼
   ┌──────────┐  ┌──────────┐  ┌──────────┐
   │resolved  │  │  open    │  │ timeout  │
   │(已定稿)  │  │(退回)    │  │(默认答案)│
   └──────────┘  └──────────┘  └──────────┘
```

**规则 DEC-EXT5：答案不可直接修改，只能撤销重答**

```typescript
// 错误设计（不允许）
decision.answer({ id, actorId, choice, replace: true })

// 正确设计（通过retract）
decision.retract({ id, actorId })  // 撤销该actor全部答案
decision.answer({ id, actorId, choice })  // 重新回答
```

**规则 DEC-EXT6：retract语义**

```
条件：Decision处于'open'或'open''状态
当：askee A调用 decision.retract(id)
则：
  - answers[A] 被清除
  - 如果quorum之前已满足，status回退到'open'
  - 触发 onRetract Hook（如果有）
```

**规则 DEC-EXT7：resolved后不可撤销**

```
条件：Decision处于'resolved'/'timeout'/'void'
当：任何actor调用 retract
则：
  - 操作失败
  - 错误码：E_DEC_ALREADY_RESOLVED
```

**规则 DEC-EXT8：AI/自动应答者允许静默覆盖**

```
条件：askee是AI控制的Agent
当：AI在同一actor内多次answer()
则：
  - 后者覆盖前者（视为最终决定）
  - 不触发retract（因为没进入公开状态）
```

---

### 2.3 options唯一性约束（DEC-G3）

#### 2.3.1 语义规则

**规则 DEC-EXT9：options.name必须唯一（加载期校验）**

```typescript
// 错误示例
DecisionDef {
  options: [
    { name: 'A', label: '选项A' },
    { name: 'A', label: '重复A' }  // ← 加载期拒绝
  ]
}

// 正确示例
DecisionDef {
  options: [
    { name: 'agree', label: '同意' },
    { name: 'disagree', label: '反对' },
    { name: 'abstain', label: '弃权' }
  ]
}
```

**规则 DEC-EXT10：加载期校验清单**

```
当：加载DecisionDef时
校验：
  1. options不能为空 → E_LOAD_DECISION_EMPTY_OPTIONS
  2. options[].name必须唯一 → E_LOAD_DUPLICATE_OPTION_NAME
  3. options[].name不能为空 → E_LOAD_INVALID_OPTION_NAME
  4. 如果有defaultChoice，必须在options中 → E_LOAD_INVALID_DEFAULT_CHOICE
  5. count.min ≤ count.max → E_LOAD_INVALID_COUNT_RANGE
  6. count.max ≤ options.length → E_LOAD_COUNT_EXCEEDS_OPTIONS
  7. count约束与quorum兼容（见2.4节）
```

---

### 2.4 askee失效处理（DEC-G4）

#### 2.4.1 语义规则

**规则 DEC-EXT11：askee失效检测**

```
检测时机：
  1. phase边界推进时
  2. decision.queryActions()时
  3. actor尝试answer()时

失效条件：
  - askee引用的Agent已被销毁
  - askee引用的Entity已被销毁
  - askee不满足DecisionOption.require条件
```

**规则 DEC-EXT12：失效时的quorum降级**

```typescript
interface DecisionDef {
  // ★ 新增：askee失效时的降级策略
  onAskeeInvalid?: 'waive' | 'replace' | 'abort'
  // waive: 该askee不计入quorum（默认）
  // replace: 尝试替换为其他有效actor
  // abort: 整个Decision走onVoid
}
```

**规则 DEC-EXT13：waive语义（默认）**

```
初始：askees = [A, B, C], quorum = 'all'
场景：B被销毁
则：
  - B从askees中移除（waive）
  - askees变为 [A, C]
  - 如果A已答满，quorum满足，Decision resolved
  - 如果C已答满，quorum满足，Decision resolved
```

**规则 DEC-EXT14：abort语义**

```
初始：askees = [A, B], quorum = 'all'
场景：B被销毁，DecisionDef.onAskeeInvalid = 'abort'
则：
  - Decision.status = 'void'
  - 执行 onVoid Effects
  - 发起者收到 E_DEC_VOID
```

---

### 2.5 E_DEC_*错误码完整体系（DEC-G5）

#### 2.5.1 完整错误码清单

| 错误码 | 级别 | 触发条件 | 消息模板 |
|--------|------|---------|---------|
| `E_DEC_INVALID_ANSWER` | error | choice不在options中 | "选项 '{choice}' 不存在于决策 '{def}' 中" |
| `E_DEC_ALREADY_RESOLVED` | error | 尝试回答/撤销已resolved的Decision | "决策 '{id}' 已结束，无法操作" |
| `E_DEC_QUORUM_NOT_MET` | error | quorum未满足时尝试resolve | "决策 '{id}' 未满足法定人数（{current}/{required}）" |
| `E_DEC_TIMEOUT` | info | deadline到达且无defaultChoice | "决策 '{id}' 已超时" |
| `E_DEC_VOID` | info | 前提失效，触发onVoid | "决策 '{id}' 前提已失效，已自动取消" |
| `E_DEC_INVALID_ASKEE` | error | askee不在askees列表中 | "Actor '{actor}' 无权回答决策 '{id}'" |
| `E_DEC_ASKEE_INVALID` | warn | askee已失效 | "回答者 '{actor}' 已不满足回答条件" |
| `E_DEC_COUNT_UNDERFLOW` | error | 单actor选的数量少于count.min | "选择数量不足：需至少 {min} 个，当前 {actual} 个" |
| `E_DEC_COUNT_OVERFLOW` | error | 单actor选的数量超过count.max | "选择数量超出：最多 {max} 个，当前 {actual} 个" |
| `E_DEC_DUPLICATE` | error | 单actor重复选择不允许重复的选项 | "选项 '{choice}' 不允许重复选择" |
| `E_DEC_INVALID_DEFAULT` | error | defaultChoice非法或在options中不存在 | "默认选项 '{choice}' 不存在于决策定义中" |
| `E_DEC_ALREADY_ANSWERED` | error | askee已回答过且不允许修改 | "您已回答过决策 '{id}'，无法再次回答" |
| `E_DEC_NOT_OPEN` | error | Decision状态不是'open'或'open'' | "决策 '{id}' 当前状态为 '{status}'，无法回答" |
| `E_DEC_NESTED` | error | 嵌套打开新Decision（同tx内） | "无法在决策解算中创建新决策" |
| `E_DEC_CIRCULAR_DEP` | error | Decision间存在循环依赖 | "决策 '{id}' 存在循环依赖" |

#### 2.5.2 错误码分组

```typescript
// E_DEC_* 属于 §13.4 定义的 E_DEC_ 分组
const DECISION_ERROR_CODES = {
  // 输入验证类
  INPUT: ['E_DEC_INVALID_ANSWER', 'E_DEC_INVALID_ASKEE', 'E_DEC_INVALID_DEFAULT'],
  // 状态冲突类
  STATE: ['E_DEC_ALREADY_RESOLVED', 'E_DEC_NOT_OPEN', 'E_DEC_ALREADY_ANSWERED'],
  // 约束违反类
  CONSTRAINT: ['E_DEC_QUORUM_NOT_MET', 'E_DEC_COUNT_UNDERFLOW', 'E_DEC_COUNT_OVERFLOW', 'E_DEC_DUPLICATE'],
  // 系统事件类
  SYSTEM: ['E_DEC_TIMEOUT', 'E_DEC_VOID', 'E_DEC_ASKEE_INVALID'],
  // 安全类
  SECURITY: ['E_DEC_NESTED', 'E_DEC_CIRCULAR_DEP']
}
```

---

### 2.6 quorum:'majority'语义澄清（DEC-G6）

#### 2.6.1 语义规则

**规则 DEC-EXT15：majority定义**

```
majority = ceil(有效askees.length / 2)
即：严格超过半数

示例：
  - askees = [A, B] → majority = ceil(2/2) = 1（但需要"超过"，所以实际是2）
  - askees = [A, B, C] → majority = ceil(3/2) = 2
  - askees = [A, B, C, D] → majority = ceil(4/2) = 2（需要3）

注意：quorum:'all'时，如果有人waive，majority会重新计算
```

**规则 DEC-EXT16：majority with count约束**

```
给定：
  - askees = [A, B, C]
  - quorum = 'majority'
  - count.min = 1, count.max = 2

则majority计算：
  - 有效askees = 3
  - majority threshold = ceil(3/2) = 2个actor答满

何时resolved：
  - 当至少2个actor各自选了1~2个选项时
```

---

## 三、完整Ops签名扩展

### 3.1 decision.open扩展

```typescript
// §4.x Ops签名扩展
decision.open(def: DefId, askees: Ref[], ctx?: Record<string, Value>): DecisionId

前置条件：
  - def必须指向一个DecisionDef
  - askees不能为空
  - 所有askees必须是有效的Agent或Entity引用

返回：
  - 成功：DecisionId
  - 失败：Result<never, E_LOAD_* | E_DEC_*>
```

### 3.2 decision.answer扩展

```typescript
decision.answer(
  id: DecisionId,
  actorId: Ref,
  choice: string | string[]
): Result<void, E_DEC_*>

前置条件：
  - Decision必须处于'open'或'open''状态
  - actorId必须在askees中
  - choice必须在options中
  - 如果有count约束，choice数组长度必须在[min, max]内
  - 不允许重复选择（除非选项标记uniquePerActor=false）

副作用：
  - answers[actorId] = choice
  - 如果满足quorum，status变为'resolved'并执行onResolve
```

### 3.3 decision.retract新增

```typescript
// ★ 新增Op
decision.retract(id: DecisionId, actorId: Ref): Result<void, E_DEC_*>

前置条件：
  - Decision必须处于'open'或'open''状态
  - actorId必须在askees中
  - actorId必须有已提交的answers

副作用：
  - answers[actorId]被清除
  - 如果之前已resolved，退回'open'状态
  - 重新计算quorum是否满足
```

### 3.4 decision.queryActions扩展

```typescript
// 返回当前Agent可操作的Decision列表
decision.queryActions(actorId: Ref): Decision[]

过滤条件：
  - actorId在askees中
  - Decision.status = 'open'或'open''
  - askee满足options[].require条件
  - askee未被waive

返回：
  - 有效Decision列表，按opensAt排序
```

---

## 四、与Spec §7.5的合并

将本设计合并到Spec §7.5后：

```typescript
/**
 * §7.5 Decision：向非当前行动者征求输入
 *
 * 补充设计（2026-08-06）：
 * - 单actor多选：DecisionDef.count
 * - 答案撤销：decision.retract
 * - askee失效处理：onAskeeInvalid
 * - 完整错误码：E_DEC_*体系
 */

/**
 * 决策实例
 */
interface Decision {
  id: DecisionId
  def: DefId                     // 指向DecisionDef
  askees: Ref[]                  // 被征询者
  answers: Record<string, string | string[]>  // ★ actorId → choice或choices
  ctx: Record<string, Value>     // 上下文快照
  opensAt: number                 // 创建时的phase
  deadline?: number               // 超时phase
  status: 'open' | 'resolved' | 'timeout' | 'void'
  // ★ 扩展状态
  answeredAskees?: Ref[]         // 已答askees（用于快速判断）
}

/**
 * 决策定义
 */
interface DecisionDef extends Def {
  kind: 'decision'
  options: DecisionOption[]      // ★ 扩展为对象数组
  quorum: 'all' | 'any' | 'majority'
  // ★ 单actor多选约束
  count?: {
    min: number                   // 每actor最少选几个（默认1）
    max: number                   // 每actor最多选几个（默认1）
  }
  onTimeout: 'default' | 'void'
  defaultChoice?: string | string[]  // ★ 支持多默认值
  // ★ askee失效处理
  onAskeeInvalid?: 'waive' | 'replace' | 'abort'  // 默认'waive'
  onResolve: Effect[]             // 答满后执行
  onVoid?: Effect[]               // 失效时回滚
}

/**
 * 决策选项
 */
interface DecisionOption {
  name: string                    // 唯一标识符
  label: Expr                     // 显示名
  require?: Expr                  // 回答条件（运行时检查）
  uniquePerActor?: boolean        // ★ 是否允许同一actor重复选（默认true）
}
```

---

## 五、加载期校验扩展（§13.7）

```typescript
// DecisionDef加载期校验清单

function validateDecisionDef(def: DecisionDef): E_LOAD_*[] {
  const errors: E_LOAD_*[] = []

  // 1. options不能为空
  if (!def.options || def.options.length === 0) {
    errors.push('E_LOAD_DECISION_EMPTY_OPTIONS')
  }

  // 2. options[].name唯一性
  const names = def.options.map(o => o.name)
  const duplicates = names.filter((n, i) => names.indexOf(n) !== i)
  if (duplicates.length > 0) {
    errors.push('E_LOAD_DUPLICATE_OPTION_NAME')
  }

  // 3. options[].name不能为空
  if (def.options.some(o => !o.name || o.name.trim() === '')) {
    errors.push('E_LOAD_INVALID_OPTION_NAME')
  }

  // 4. defaultChoice合法性
  if (def.defaultChoice) {
    const choices = Array.isArray(def.defaultChoice)
      ? def.defaultChoice
      : [def.defaultChoice]
    const validNames = new Set(def.options.map(o => o.name))
    if (!choices.every(c => validNames.has(c))) {
      errors.push('E_LOAD_INVALID_DEFAULT_CHOICE')
    }
  }

  // 5. count约束合法性
  if (def.count) {
    if (def.count.min > def.count.max) {
      errors.push('E_LOAD_INVALID_COUNT_RANGE')
    }
    if (def.count.max > def.options.length) {
      errors.push('E_LOAD_COUNT_EXCEEDS_OPTIONS')
    }
  }

  // 6. onTimeout='default'时必须有defaultChoice
  if (def.onTimeout === 'default' && !def.defaultChoice) {
    errors.push('E_LOAD_DEFAULT_REQUIRED')
  }

  // 7. count约束与quorum兼容性
  if (def.count && def.count.min > 1 && def.quorum === 'any') {
    // any模式下单actor多选意义不大（第一个答满就resolve）
    // 但不报错，只是语义上可能非预期
    warnings.push('W_DEC_COUNT_WITH_ANY')
  }

  return errors
}
```

---

## 六、测试用例映射

### 6.1 原UNDEF用例的重新判定

| 原用例 | 缺口 | 解决后判定 |
|--------|------|-----------|
| L6-DEC-001 | minCount/maxCount | → 映射到quorum+count |
| L6-DEC-004 | multiSelect机制 | → count.max>1时支持多选 |
| L6-DEC-005 | 单actor多选 | → count约束 |
| L6-DEC-006 | 未答满minCount | → quorum机制 |
| L6-DEC-007 | 超过maxCount | → E_DEC_COUNT_OVERFLOW |
| L6-DEC-008 | 重复选同一选项 | → E_DEC_DUPLICATE |
| L6-DEC-009 | 撤销答案 | → decision.retract |
| L6-DEC-010 | 修改答案 | → retract+answer |
| L6-DEC-023 | 同tx内依赖 | → UNDEF（待Intent系统补充） |
| L6-DEC-024 | 多玩家决策 | → quorum机制 |
| L6-DEC-027 | maxCount>options | → E_LOAD_COUNT_EXCEEDS_OPTIONS |
| L6-DEC-028 | 重复option | → E_LOAD_DUPLICATE_OPTION_NAME |

### 6.2 新增测试用例

```typescript
// T1: 单actor多选正常流程
Given:
  DecisionDef { options: ['A','B','C','D'], count: {min:1, max:2}, quorum: 'all', askees: [p1] }
When:
  decision.answer('dec_1', 'p1', ['A', 'B'])
Then:
  answers['p1'] == ['A', 'B']
  count满足，quorum满足 → resolved

// T2: 单actor多选超出上限
Given: 同T1
When:
  decision.answer('dec_1', 'p1', ['A', 'B', 'C'])
Then:
  result.ok == false
  result.code == E_DEC_COUNT_OVERFLOW

// T3: 答案撤销
Given:
  Decision { status: 'open', answers: {'p1': ['A']}, quorum: 'all', askees: [p1] }
When:
  decision.retract('dec_1', 'p1')
Then:
  answers['p1'] == null
  status == 'open'

// T4: resolved后不可撤销
Given:
  Decision { status: 'resolved' }
When:
  decision.retract('dec_1', 'p1')
Then:
  result.ok == false
  result.code == E_DEC_ALREADY_RESOLVED

// T5: options重复加载期拒绝
Given:
  DecisionDef { options: [{name:'A'}, {name:'A'}] }
When:
  加载Definition
Then:
  拒绝加载
  错误码: E_LOAD_DUPLICATE_OPTION_NAME
```

---

## 七、决策记录

### 7.1 本设计的关键决策点

| 决策ID | 问题 | 候选方案 | 选定方案 | 理由 |
|--------|------|---------|---------|------|
| D1 | 单actor多选如何表达 | A:扩展answers类型 B:新增select字段 C:count约束 | C+A混合 | count约束简洁，扩展answers兼容单/多选 |
| D2 | 答案修改策略 | A:直接replace B:必须retract+answer | B | 保持不可变性语义，retract显式化状态变化 |
| D3 | resolved后retract | A:允许 B:拒绝 | B | resolved意味着已触发onResolve，不能回退 |
| D4 | askee失效处理 | A:waive B:replace C:abort | A默认+C可选 | 灵活应对不同场景 |
| D5 | majority定义 | A:>50% B:≥50% | A(严格超过) | 与日常"多数"语义一致 |

### 7.2 遗留问题

| 问题 | 状态 | 说明 |
|------|------|------|
| 同tx内Decision依赖链 | UNDEF | 需与Intent系统协同设计 |
| AI自动应答策略 | 待补充 | 涉及AI move generator设计 |
| 存档恢复后Decision恢复 | 待补充 | 涉及snapshot机制设计 |

---

## 八、附录：错误码与不变量映射

### 8.1 E_DEC_*与§13.4合并

将以下码合并到§13.4 ErrCode表：

| 码 | 分组 | 级别 |
|----|------|------|
| E_DEC_INVALID_ANSWER | E_DEC_ | error |
| E_DEC_ALREADY_RESOLVED | E_DEC_ | error |
| E_DEC_QUORUM_NOT_MET | E_DEC_ | error |
| E_DEC_TIMEOUT | E_DEC_ | info |
| E_DEC_VOID | E_DEC_ | info |
| E_DEC_INVALID_ASKEE | E_DEC_ | error |
| E_DEC_ASKEE_INVALID | E_DEC_ | warn |
| E_DEC_COUNT_UNDERFLOW | E_DEC_ | error |
| E_DEC_COUNT_OVERFLOW | E_DEC_ | error |
| E_DEC_DUPLICATE | E_DEC_ | error |
| E_DEC_INVALID_DEFAULT | E_DEC_ | error |
| E_DEC_ALREADY_ANSWERED | E_DEC_ | error |
| E_DEC_NOT_OPEN | E_DEC_ | error |
| E_DEC_NESTED | E_DEC_ | error |
| E_DEC_CIRCULAR_DEP | E_DEC_ | error |
| E_LOAD_DECISION_EMPTY_OPTIONS | E_LOAD_ | error |
| E_LOAD_DUPLICATE_OPTION_NAME | E_LOAD_ | error |
| E_LOAD_INVALID_OPTION_NAME | E_LOAD_ | error |
| E_LOAD_INVALID_DEFAULT_CHOICE | E_LOAD_ | error |
| E_LOAD_INVALID_COUNT_RANGE | E_LOAD_ | error |
| E_LOAD_COUNT_EXCEEDS_OPTIONS | E_LOAD_ | error |
| E_LOAD_DEFAULT_REQUIRED | E_LOAD_ | error |

### 8.2 Decision相关不变量

```markdown
### INV_DEC_1: answers完整性
∀Decision d: d.status ∈ {'resolved', 'timeout'} →
  |d.answeredAskees| >= quorum要求数

### INV_DEC_2: 选项合法性
∀Decision d: ∀choice ∈ union(d.answers.values) →
  ∃opt ∈ DecisionDef(d.def).options: opt.name == choice

### INV_DEC_3: 状态一致性
∀Decision d:
  d.status == 'resolved' | 'timeout' | 'void' → d.deadline已过或quorum已满足
```

---

**文档状态**：🗄️ 历史归档 —— **设计已于 2026-08-06 合并入 Spec §7.5（7 处）**
**合并证据**：`PHASE2_TEST_L5-L6_综合报告.md` §3.3 变更清单、
`FINAL_L6_Decision完整审查报告.md`（30/30 PASS）、Spec §7.5（Spec:1491）与 §7.5.1（Spec:1640）
**注意**：本设计中提议的 `E_DEC_*` 细分错误码**未被采纳**，实现阶段裁定并入 `E_DEC_VOID`；
字段（`selection`/`merge`/`timeout`/`onAskeeInvalid`/`retractable`）与不变量已采纳。
见 [`00_状态基线.md`](00_状态基线.md) §四。

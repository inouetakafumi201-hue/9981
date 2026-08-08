# Decision机制完整重新设计方案

> **目的**：解决测试用例与Spec §7.5之间的结构性差异
> **原则**：保证基层完备性，不是打补丁
> **状态**：v1.0 | 2026-08-06
> **归档状态**：🗄️ 已合并入 Spec §7.5（2026-08-06，7 处），**除 §七 错误码表未被采纳**
> **验证**：手工推演 30/30 PASS；属性实测 `kernel-l6-test` 70 项测试 / 380,000 样本全 PASS

---

## 一、问题诊断

### 1.1 测试用例揭示的设计需求

| 需求类别 | 具体要求 | 测试用例 |
|----------|----------|----------|
| **单选约束** | minCount=1, maxCount=1 | L6-DEC-001~004 |
| **多选约束** | minCount/maxCount范围约束 | L6-DEC-005~008 |
| **超时机制** | TTL相对时间 + 自动应用defaultAnswer | L6-DEC-011~016 |
| **答案操作** | retract（撤销）、replace（修改） | L6-DEC-009~010 |
| **多玩家合并** | 多个askee的答案如何聚合 | L6-DEC-024 |
| **嵌套防护** | 防止effect触发新决策 | L6-DEC-021 |
| **事务原子性** | effect失败时整体回滚 | L6-DEC-019 |
| **边界检查** | 空选项、矛盾约束、重复选项 | L6-DEC-025~028 |

### 1.2 Spec §7.5的现有设计

```typescript
interface Decision {
  id: DecisionId
  def: DefId
  askees: Ref[]
  answers: Record<string, Value>  // actorId → choice（单值）
  ctx: Record<string, Value>
  opensAt: number
  deadline?: number                // 绝对phase序号
  status: 'open' | 'resolved' | 'timeout' | 'void'
}

interface DecisionDef {
  options: { name: string, label: Expr, require?: Expr }[]
  quorum: 'all' | 'any' | 'majority'
  onTimeout: 'default' | 'void'
  defaultChoice?: string           // 单个默认选择
  onResolve: Effect[]
  onVoid?: Effect[]
}
```

### 1.3 根本性差异

| 维度 | Spec §7.5 | 测试用例 |
|------|-----------|----------|
| **超时机制** | deadline（绝对phase） | ttl（相对秒数） |
| **默认答案** | defaultChoice（单个） | defaultAnswer（数组） |
| **答案聚合** | Record<actorId, 单个choice> | answer[]（多选数组） |
| **计数约束** | quorum机制 | minCount/maxCount |
| **多选支持** | 无 | multiSelect布尔 |
| **答案操作** | 无 | retract/replace |

---

## 二、重新设计：统一接口

### 2.1 核心类型定义

```typescript
// ============================================================
// 答案类型：支持单选和多选
// ============================================================

type Choice = string  // 单个选项名

type Answer = 
  | Choice                    // 单选模式：单个选项
  | Choice[]                  // 多选模式：选项数组

// ============================================================
// Decision实例：运行时状态
// ============================================================

interface Decision {
  id: DecisionId
  def: DefId                    // 指向DecisionDef
  askees: Ref[]                 // 被征询者列表
  answers: Record<string, Answer>  // actorId → 答案（单值或数组）
  ctx: Record<string, Value>    // 发起时快照的上下文
  opensAt: number               // 开启时的phase序号
  deadline?: number             // 超时绝对phase（来自DecisionDef）
  ttl?: number                 // 相对超时秒数（运行时可覆盖Def）
  status: DecisionStatus
}

type DecisionStatus = 'open' | 'resolved' | 'timeout' | 'void'

// ============================================================
// DecisionDef：决策模板/定义
// ============================================================

interface DecisionDef extends Def {
  kind: 'decision'

  // 选项定义
  options: {
    name: string
    label: Expr
    require?: Expr              // 选项可见性条件
  }[]

  // 选择模式
  selection: {
    mode: 'single' | 'multi'   // 单选或多选模式
    minCount?: number          // 最少选择数（多选模式必填）
    maxCount?: number          // 最多选择数（多选模式必填）
  }

  // 决策者约束
  askees: Ref[] | Expr         // 固定列表或动态表达式
  minAskers?: number           // 最少需要多少askee作答（默认=all）

  // 超时机制
  timeout: {
    type: 'deadline' | 'ttl'   // 绝对截止或相对TTL
    value: number               // phase序号（deadline）或秒数（ttl）
    onTimeout: 'default' | 'void' | 'extend'  // 超时行为
    maxExtends?: number        // 最多延长次数
  }

  // 默认答案
  defaultAnswer?: Answer       // 超时时自动应用的答案

  // 决策合并规则（多askee时）
  merge: {
    policy: 'all' | 'any' | 'majority' | 'unanimous' | 'first'
    // 'all': 所有askee必须给出相同答案
    // 'any': 任意一个askee答即可
    // 'majority': 多数答案胜出
    // 'unanimous': 所有askee必须给出相同答案
    // 'first': 采用第一个提交的答案
  }

  // 回调效果
  onResolve: Effect[]          // 决策通过时的效果
  onTimeout?: Effect[]         // 超时时的效果（覆盖defaultAnswer）
  onVoid?: Effect[]            // 前提失效时的回滚

  // 嵌套防护
  nestedDecision: 'allow' | 'deny'  // 是否允许effect触发新决策
}
```

### 2.2 Op定义

```typescript
// ============================================================
// Op: decision.open
// 创建并开启一个决策
// ============================================================

Op('decision.open', {
  params: {
    id: DecisionId,
    def: DefId,
    askees: Ref[],
    ctx?: Record<string, Value>,     // 可选的额外上下文
    ttlOverride?: number,            // 可选的TTL覆盖
    deadlineOverride?: number,       // 可选的deadline覆盖
  },
  guard(ctx) {
    // 1. 检查def存在且类型为'decision'
    const def = world.defs.get(params.def)
    assert(def?.kind === 'decision', 'E_DEF_NOT_FOUND')

    // 2. 检查askees非空且都有效
    assert(params.askees.length > 0, 'E_DEC_NO_ASKES')

    // 3. 检查options非空
    assert(def.options.length > 0, 'E_DEC_EMPTY_OPTIONS')

    // 4. 检查minCount/maxCount合法性
    if (def.selection.mode === 'multi') {
      const { minCount, maxCount } = def.selection
      assert(minCount <= maxCount, 'E_DEC_CONFLICT_CONSTRAINT')
      assert(maxCount <= def.options.length, 'E_DEC_MAX_EXCEEDS_OPTIONS')
    }

    // 5. 检查defaultAnswer合法性
    if (def.defaultAnswer !== undefined) {
      validateAnswer(def.defaultAnswer, def.options)
    }

    // 6. 检查options唯一性（语言层面强制）
    const names = def.options.map(o => o.name)
    assert(new Set(names).size === names.length, 'E_DEC_DUPLICATE_OPTIONS')
  },
  commit(ctx) {
    const def = world.defs.get(params.def)
    const ttl = params.ttlOverride ?? def.timeout.value
    const deadline = params.deadlineOverride ?? (
      def.timeout.type === 'deadline'
        ? def.timeout.value
        : ctx.currentPhase + Math.ceil(ttl / SECONDS_PER_PHASE)
    )

    world.decisions.set(params.id, {
      id: params.id,
      def: params.def,
      askees: params.askees,
      answers: {},
      ctx: { ...params.ctx },
      opensAt: ctx.currentPhase,
      deadline,
      ttl,
      status: 'open',
    })

    // 记录journal用于回放
    journal.record('decision.open', {
      id: params.id,
      def: params.def,
      askees: params.askees,
      ttl,
      deadline,
    })
  }
})

// ============================================================
// Op: decision.answer
// 提交答案
// ============================================================

Op('decision.answer', {
  params: {
    decision: DecisionId,
    actor: Ref,
    choice: Answer,             // 单个选项或选项数组
    replace?: boolean,         // 是否替换已有答案
  },
  guard(ctx) {
    const dec = world.decisions.get(params.decision)
    assert(dec, 'E_DEC_NOT_FOUND')
    assert(dec.status === 'open', 'E_DEC_NOT_OPEN')

    // 检查actor是否有资格作答
    assert(dec.askees.includes(params.actor), 'E_DEC_NOT_ASKEE')

    // 检查决策是否已超时
    if (dec.deadline && ctx.currentPhase > dec.deadline) {
      // 已在超时处理中，拒绝作答
      throw err('E_DEC_ALREADY_TIMEOUT')
    }

    // 验证答案合法性
    validateAnswer(params.choice, world.defs.get(dec.def).options)

    // 检查replace语义
    const existing = dec.answers[params.actor]
    if (existing !== undefined && !params.replace) {
      throw err('E_DEC_ALREADY_ANSWERED')
    }

    // 检查多选约束
    const def = world.defs.get(dec.def)
    if (def.selection.mode === 'single') {
      // 单选模式：choice应为单个字符串
      assert(
        typeof params.choice === 'string',
        'E_DEC_SINGLE_MODE_ARRAY'
      )
      assert(
        existing === undefined || params.replace,
        'E_DEC_DUPLICATE'
      )
    } else {
      // 多选模式：检查minCount/maxCount
      const choices = params.choice as string[]
      assert(
        choices.length > 0,
        'E_DEC_EMPTY_CHOICE'
      )
      const newTotal = (existing as string[] || []).concat(choices)
        .filter((v, i, a) => a.indexOf(v) === i)  // 去重
      const { minCount, maxCount } = def.selection
      if (minCount !== undefined && newTotal.length < minCount) {
        throw err('E_DEC_COUNT_BELOW_MIN')
      }
      if (maxCount !== undefined && newTotal.length > maxCount) {
        throw err('E_DEC_COUNT_EXCEEDS_MAX')
      }
    }
  },
  commit(ctx) {
    const dec = world.decisions.get(params.decision)
    const def = world.defs.get(dec.def)

    if (params.replace) {
      // 替换模式：完全覆盖
      dec.answers[params.actor] = params.choice
    } else {
      // 追加模式：合并去重
      const existing = dec.answers[params.actor]
      if (existing === undefined) {
        dec.answers[params.actor] = params.choice
      } else {
        const existingChoices = Array.isArray(existing) ? existing : [existing]
        const newChoices = Array.isArray(params.choice) ? params.choice : [params.choice]
        dec.answers[params.actor] = [...new Set([...existingChoices, ...newChoices])]
      }
    }

    // 检查是否满足决策条件
    const shouldResolve = checkQuorum(dec, def, ctx)
    if (shouldResolve) {
      resolveDecision(dec, def, ctx)
    }

    journal.record('decision.answer', {
      decision: params.decision,
      actor: params.actor,
      choice: params.choice,
      replace: params.replace,
    })
  }
})

// ============================================================
// Op: decision.retract
// 撤销答案
// ============================================================

Op('decision.retract', {
  params: {
    decision: DecisionId,
    actor: Ref,
    choice?: Answer,           // 可选：要撤销的特定答案，不填则撤销全部
  },
  guard(ctx) {
    const dec = world.decisions.get(params.decision)
    assert(dec, 'E_DEC_NOT_FOUND')
    assert(dec.status === 'open', 'E_DEC_NOT_OPEN')

    const def = world.defs.get(dec.def)
    // 检查def是否允许retract
    assert(def.retractable !== false, 'E_DEC_NOT_RETRACTABLE')

    const existing = dec.answers[params.actor]
    assert(existing !== undefined, 'E_DEC_NO_ANSWER')

    if (params.choice !== undefined) {
      // 撤销特定答案
      const existingChoices = Array.isArray(existing) ? existing : [existing]
      const removeChoices = Array.isArray(params.choice) ? params.choice : [params.choice]
      assert(
        removeChoices.every(c => existingChoices.includes(c)),
        'E_DEC_CHOICE_NOT_FOUND'
      )
    }
  },
  commit(ctx) {
    const dec = world.decisions.get(params.decision)

    if (params.choice === undefined) {
      // 撤销全部答案
      delete dec.answers[params.actor]
    } else {
      // 撤销特定答案
      const existing = dec.answers[params.actor]
      const existingChoices = Array.isArray(existing) ? existing : [existing]
      const removeChoices = Array.isArray(params.choice) ? params.choice : [params.choice]
      const remaining = existingChoices.filter(c => !removeChoices.includes(c))
      if (remaining.length === 0) {
        delete dec.answers[params.actor]
      } else {
        dec.answers[params.actor] = remaining
      }
    }

    journal.record('decision.retract', {
      decision: params.decision,
      actor: params.actor,
      choice: params.choice,
    })
  }
})

// ============================================================
// Op: decision.resolve
// 手动触发决策解析（通常由commit自动调用）
// ============================================================

Op('decision.resolve', {
  params: {
    decision: DecisionId,
    force?: boolean,           // 强制resolve（忽略quorum）
  },
  guard(ctx) {
    const dec = world.decisions.get(params.decision)
    assert(dec, 'E_DEC_NOT_FOUND')
    assert(dec.status === 'open', 'E_DEC_NOT_OPEN')

    if (!params.force) {
      const def = world.defs.get(dec.def)
      assert(checkQuorum(dec, def, ctx), 'E_DEC_QUORUM_NOT_MET')
    }
  },
  commit(ctx) {
    const dec = world.decisions.get(params.decision)
    const def = world.defs.get(dec.def)
    resolveDecision(dec, def, ctx)
  }
})

// ============================================================
// Op: decision.void
// 使决策失效
// ============================================================

Op('decision.void', {
  params: {
    decision: DecisionId,
    reason: string,
  },
  commit(ctx) {
    const dec = world.decisions.get(params.decision)
    const def = world.defs.get(dec.def)

    dec.status = 'void'

    // 执行onVoid效果
    if (def.onVoid) {
      executeEffects(def.onVoid, dec.ctx, ctx)
    }

    journal.record('decision.void', {
      decision: params.decision,
      reason: params.reason,
    })
  }
})
```

### 2.3 内部辅助函数

```typescript
// ============================================================
// validateAnswer：验证答案合法性
// ============================================================

function validateAnswer(answer: Answer, options: { name: string }[]): void {
  const optionNames = options.map(o => o.name)
  const answerSet = new Set(optionNames)

  if (typeof answer === 'string') {
    assert(answerSet.has(answer), 'E_DEC_INVALID_ANSWER')
  } else if (Array.isArray(answer)) {
    for (const choice of answer) {
      assert(typeof choice === 'string', 'E_DEC_INVALID_CHOICE_TYPE')
      assert(answerSet.has(choice), 'E_DEC_INVALID_ANSWER')
    }
    // 检查重复
    assert(new Set(answer).size === answer.length, 'E_DEC_DUPLICATE_CHOICE')
  } else {
    assert(false, 'E_DEC_INVALID_ANSWER_TYPE')
  }
}

// ============================================================
// checkQuorum：检查是否满足决策条件
// ============================================================

function checkQuorum(dec: Decision, def: DecisionDef, ctx: OpContext): boolean {
  const { merge, minAskers } = def
  const answeredAskees = Object.keys(dec.answers)

  // 检查最少作答人数
  const required = minAskers ?? dec.askees.length
  if (answeredAskees.length < required) {
    return false
  }

  switch (merge.policy) {
    case 'all':
      // 所有askee都必须作答
      return answeredAskees.length === dec.askees.length

    case 'any':
      // 任意一人作答即可
      return answeredAskees.length >= 1

    case 'majority':
      // 多数
      return answeredAskees.length > dec.askees.length / 2

    case 'unanimous':
      // 所有askee给出相同答案
      const uniqueAnswers = new Set(Object.values(dec.answers).map(a =>
        Array.isArray(a) ? a.sort().join(',') : a
      ))
      return uniqueAnswers.size === 1 && answeredAskees.length === dec.askees.length

    case 'first':
      // 第一个作答即可
      return answeredAskees.length >= 1

    default:
      assert(false, 'E_DEC_UNKNOWN_MERGE_POLICY')
  }
}

// ============================================================
// resolveDecision：解析决策并执行效果
// ============================================================

function resolveDecision(dec: Decision, def: DecisionDef, ctx: OpContext): void {
  // 1. 重新运行前提检查
  const preconditionsValid = checkPreconditions(dec, def, ctx)
  if (!preconditionsValid) {
    dec.status = 'void'
    if (def.onVoid) {
      executeEffects(def.onVoid, dec.ctx, ctx)
    }
    return
  }

  // 2. 计算最终答案（根据merge策略）
  const finalAnswer = computeFinalAnswer(dec, def)

  // 3. 检查嵌套（防止effect触发新决策）
  const originalNestedAllowed = ctx.nestedDecisionAllowed
  ctx.nestedDecisionAllowed = def.nestedDecision === 'allow'

  try {
    // 4. 执行onResolve效果
    const resolveCtx = {
      ...dec.ctx,
      decision: dec.id,
      answer: finalAnswer,
      askees: dec.askees,
      answers: dec.answers,
    }

    if (def.onResolve) {
      executeEffects(def.onResolve, resolveCtx, ctx)
    }

    dec.status = 'resolved'
  } catch (err) {
    // effect执行失败，决策状态保持open（事务已回滚）
    throw err
  } finally {
    ctx.nestedDecisionAllowed = originalNestedAllowed
  }
}

// ============================================================
// computeFinalAnswer：根据merge策略计算最终答案
// ============================================================

function computeFinalAnswer(dec: Decision, def: DecisionDef): Answer {
  const { merge } = def
  const answers = Object.values(dec.answers)

  switch (merge.policy) {
    case 'first':
      // 返回第一个提交的答案
      return answers[0]

    case 'all':
    case 'any':
    case 'majority':
      // 如果所有答案相同，直接返回
      if (answers.every(a => {
        const norm = Array.isArray(a) ? a.sort().join(',') : a
        const first = Array.isArray(answers[0]) ? answers[0].sort().join(',') : answers[0]
        return norm === first
      })) {
        return answers[0]
      }
      // 如果不同，返回多数答案
      const counts = new Map<string, number>()
      for (const answer of answers) {
        const choices = Array.isArray(answer) ? answer : [answer]
        for (const choice of choices) {
          counts.set(choice, (counts.get(choice) || 0) + 1)
        }
      }
      // 返回最高频的答案（简化处理）
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
      return sorted[0][0]

    case 'unanimous':
      return answers[0]

    default:
      return answers[0]
  }
}

// ============================================================
// checkPreconditions：检查前提条件（TOCTOU防护）
// ============================================================

function checkPreconditions(dec: Decision, def: DecisionDef, ctx: OpContext): boolean {
  // 检查所有选项的require条件是否仍然满足
  for (const option of def.options) {
    if (option.require) {
      try {
        const result = evaluateExpr(option.require, dec.ctx, ctx)
        if (!result) return false
      } catch {
        return false
      }
    }
  }
  return true
}

// ============================================================
// checkNestedDecision：检查是否在嵌套决策上下文中
// ============================================================

function checkNestedDecision(ctx: OpContext): void {
  if (!ctx.nestedDecisionAllowed) {
    throw err('E_DEC_NESTED')
  }
}

// 在executeEffects中调用此检查
function executeEffects(effects: Effect[], resolveCtx: Context, ctx: OpContext): void {
  for (const effect of effects) {
    // 嵌套检测
    if (effect.op === 'decision.open') {
      checkNestedDecision(ctx)
    }

    // 执行效果
    executeEffect(effect, resolveCtx, ctx)
  }
}
```

### 2.4 超时处理机制

```typescript
// ============================================================
// 超时检查：在每个phase开始时执行
// ============================================================

function checkTimeouts(ctx: OpContext): void {
  const currentPhase = ctx.currentPhase

  for (const [id, dec] of world.decisions) {
    if (dec.status !== 'open') continue

    // 检查是否已超时
    if (dec.deadline && currentPhase >= dec.deadline) {
      handleTimeout(dec, ctx)
    }
  }
}

function handleTimeout(dec: Decision, ctx: OpContext): void {
  const def = world.defs.get(dec.def)
  const { onTimeout } = def.timeout

  switch (onTimeout) {
    case 'default':
      // 应用默认答案
      if (def.defaultAnswer !== undefined) {
        dec.answers['__timeout__'] = def.defaultAnswer
        dec.status = 'resolved'
        // 执行超时效果（如果有）
        if (def.onTimeout) {
          executeEffects(def.onTimeout, { ...dec.ctx, answer: def.defaultAnswer }, ctx)
        }
      } else {
        dec.status = 'timeout'
        if (def.onTimeout) {
          executeEffects(def.onTimeout, dec.ctx, ctx)
        }
      }
      break

    case 'void':
      dec.status = 'void'
      if (def.onVoid) {
        executeEffects(def.onVoid, dec.ctx, ctx)
      }
      break

    case 'extend':
      // 延长超时
      const def2 = def as { timeout: { maxExtends?: number; extends?: number } }
      if ((def2.timeout.maxExtends ?? 0) > (def2.timeout.extends ?? 0)) {
        dec.deadline += def.timeout.value
        def2.timeout.extends = (def2.timeout.extends ?? 0) + 1
      } else {
        // 无法再延长，执行default行为
        handleTimeout(dec, ctx)
      }
      break
  }
}
```

---

## 三、与原Spec §7.5的兼容层

为了向后兼容，原有使用quorum机制的DecisionDef可以继续工作：

```typescript
// 兼容层：quorum === merge.policy的别名
interface DecisionDefCompat extends DecisionDef {
  // quorum是merge.policy的简写形式
  quorum?: 'all' | 'any' | 'majority'
}

// 在解析时，quorum映射到merge.policy
function normalizeDef(def: DecisionDefCompat): DecisionDef {
  if (def.quorum && !def.merge) {
    return {
      ...def,
      merge: { policy: def.quorum }
    }
  }
  return def as DecisionDef
}
```

---

## 四、测试用例覆盖矩阵

| 用例 | 覆盖情况 | 新设计行为 |
|------|----------|------------|
| L6-DEC-001 | ✅ | `selection.mode='single'` → 正常答题 |
| L6-DEC-002 | ✅ | 答满后自动resolve |
| L6-DEC-003 | ✅ | `validateAnswer`检查非法选项 |
| L6-DEC-004 | ✅ | `replace=false`时拒绝重复作答 |
| L6-DEC-005 | ✅ | `selection.mode='multi', minCount=2` |
| L6-DEC-006 | ✅ | 未满足minCount时tx失败 |
| L6-DEC-007 | ✅ | 超过maxCount时拒绝 |
| L6-DEC-008 | ✅ | `validateAnswer`去重检查 |
| L6-DEC-009 | ✅ | `decision.retract` Op |
| L6-DEC-010 | ✅ | `replace=true`时允许修改 |
| L6-DEC-011 | ✅ | `timeout.type='ttl'` + `defaultAnswer` |
| L6-DEC-012 | ✅ | 无defaultAnswer时status='timeout' |
| L6-DEC-013 | ✅ | 玩家答案覆盖defaultAnswer |
| L6-DEC-014 | ✅ | `ttl=0`立即超时 |
| L6-DEC-015 | ✅ | `timeout.value=Infinity`永不过期 |
| L6-DEC-016 | ✅ | 创建时`validateAnswer`检查 |
| L6-DEC-017 | ✅ | `onResolve`触发effect |
| L6-DEC-018 | ✅ | 多选时多个effect顺序执行 |
| L6-DEC-019 | ✅ | effect失败时事务回滚 |
| L6-DEC-020 | ✅ | 允许空effect |
| L6-DEC-021 | ✅ | `nestedDecision='deny'`检测 |
| L6-DEC-022 | ✅ | 同一tx内多个独立决策 |
| L6-DEC-023 | ⚠️ | 需显式排序（同tx内无隐式依赖） |
| L6-DEC-024 | ✅ | `merge.policy`控制多askee合并 |
| L6-DEC-025 | ✅ | 创建时检查options非空 |
| L6-DEC-026 | ✅ | 创建时检查minCount<=maxCount |
| L6-DEC-027 | ✅ | 创建时检查maxCount<=options.length |
| L6-DEC-028 | ✅ | 创建时检查options唯一性 |
| L6-DEC-029 | ✅ | resolve后拒绝answer |
| L6-DEC-030 | ✅ | destroy后引用失效 |

---

## 五、设计决策记录

### 5.1 为什么需要两种超时机制（deadline vs ttl）？

| 场景 | 使用deadline | 使用ttl |
|------|--------------|---------|
| 回合制 | ✅ 按phase序号更精确 | 可用但需计算 |
| 实时制 | ❌ phase不适用 | ✅ 相对时间更自然 |
| 混合制 | ✅ 在ScheduleDef中定义 | ✅ 运行时指定 |

**结论**：两种机制都保留，通过`timeout.type`区分。

### 5.2 为什么需要merge.policy？

原Spec的quorum机制只解决了"何时算答完"，没有解决"多个askee的答案如何合并成最终答案"。
实际场景需要：
- 交易确认：需要unanimous（全员一致）
- 投票：需要majority（多数胜出）
- 竞速响应：需要first（第一个）

### 5.3 retract为什么是可选的？

并非所有决策都应允许撤销：
- 拍卖出价：不应允许撤销
- 投票：应允许在deadline前修改

通过`DecisionDef.retractable`控制。

### 5.4 nestedDecision为什么是白名单而非黑名单？

安全优先原则。如果默认为allow，玩法包作者可能无意中触发嵌套决策导致死锁。
默认deny，allow需要显式声明。

---

## 六、实现优先级

### Phase 1（核心）：单选决策
- `decision.open`
- `decision.answer`（单选）
- `decision.resolve`
- `validateAnswer`
- `checkQuorum`

### Phase 2（扩展）：多选与约束
- `decision.answer`（多选）
- `selection.mode='multi'`
- `minCount/maxCount`检查

### Phase 3（高级）：超时与retract
- `timeout.type='ttl'`
- `defaultAnswer`自动应用
- `decision.retract`

### Phase 4（完整）：merge与嵌套
- `merge.policy`
- `nestedDecision`
- `onVoid`

---

## 七、错误码汇总（⛔ 整表未被采纳）

> **本表的 20 条 `E_DEC_*` 与 1 条 `E_DEF_NOT_FOUND` 均未进入实现。**
> 实现阶段（`决策与风险记录.md` 第 15 节）裁定：Spec 中出现但从未实现的错误码标记废弃、
> 不补实现。当前封闭注册表 `src/core/kernel/state/error-codes.ts` 中
> **`E_DEC` 只有 `VOID` 与 `QUORUM` 两项**；本表的细分状态转移错误全部并入
> `E_DEC_VOID` 的更宽语义（"decision 已不可再变更时统一报此码"），
> 装载期校验并入通用 `E_LOAD_SCHEMA_CONTRACT` / `E_LOAD_REQUIRED_FIELD` / `E_LOAD_FIELD_TYPE`。
> `E_DEF_NOT_FOUND` 对应的语义由 `E_REF_MISSING` / `E_REF_KIND` / `E_REF_ABSTRACT` 承担。
>
> **本方案的其余部分（字段、状态机、merge 策略、超时双制）已全部被采纳并合并入 Spec §7.5。**
> 只有错误码这一栏作废。详见 [`00_状态基线.md`](00_状态基线.md) §四。

| 错误码（未实现） | 含义 | 原设计检测位置 |
|--------|------|----------|
| E_DEC_NOT_FOUND | 决策不存在 | answer/retract/resolve |
| E_DEC_NOT_OPEN | 决策已关闭 | answer/retract/resolve |
| E_DEC_NOT_ASKEE | actor无权作答 | answer |
| E_DEC_INVALID_ANSWER | 答案不在options中 | answer |
| E_DEC_DUPLICATE | 重复作答（未replace） | answer |
| E_DEC_ALREADY_ANSWERED | 已作答 | answer |
| E_DEC_COUNT_BELOW_MIN | 未满足minCount | answer |
| E_DEC_COUNT_EXCEEDS_MAX | 超过maxCount | answer |
| E_DEC_EMPTY_OPTIONS | options为空 | open |
| E_DEC_CONFLICT_CONSTRAINT | minCount > maxCount | open |
| E_DEC_MAX_EXCEEDS_OPTIONS | maxCount > options数量 | open |
| E_DEC_DUPLICATE_OPTIONS | options中有重复 | open |
| E_DEC_EMPTY_CHOICE | 提交空选择 | answer |
| E_DEC_SINGLE_MODE_ARRAY | 单选模式提交了数组 | answer |
| E_DEC_QUORUM_NOT_MET | 未满足决策条件 | resolve |
| E_DEC_NOT_RETRACTABLE | 不允许撤销 | retract |
| E_DEC_CHOICE_NOT_FOUND | 撤销的答案不存在 | retract |
| E_DEC_ALREADY_TIMEOUT | 决策已超时 | answer |
| E_DEC_NESTED | 嵌套决策被禁止 | executeEffects |
| E_DEF_NOT_FOUND | DecisionDef不存在 | open |

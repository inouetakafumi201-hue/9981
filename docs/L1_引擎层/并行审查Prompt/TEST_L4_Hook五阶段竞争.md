# 测试驱动审查：L4 — Hook 五阶段与竞争裁决

> **文件性质：历史测试用例本体（手工推演轴）。已完成两轮推演。**
> 用例数 45 条；第二轮复测终值：**45/45 PASS**（第一轮数字见 `TEST_L4_Hook五阶段竞争_审查结果.md`）。
> 属性实测：`kernel-l4-test`（48 项命名测试 / 120,045 次检查，PASS；修复 5 处实现缺陷）。
> 仍开放：4 项 Hook 精化点（tie-breaker、reactionRounds 与 depth 精确定义、无 hookId 的重入锁、调用栈×事务回滚）→ 跟踪项 **T-04**。
> 当前口径见 [`00_状态基线.md`](00_状态基线.md) §3.1；仍开放的事项见 [`00_开放事项跟踪.md`](00_开放事项跟踪.md)。
> **错误码提示**：本文件断言中出现的细分错误码（`E_OP_STACK_*`/`E_TX_NESTED`/`E_DEC_*` 等）多数**未实现**，
> 已并入通用码；真相源为 `src/core/kernel/state/error-codes.ts`，见 `00_状态基线.md` §四。

## 审查目标

对内核Spec第6章（Hook）进行**可执行的边界测试**，重点验证：
1. **instead竞争裁决**（§6.2）：多个instead Hook的排序确定性
2. **depth与reactionRounds上限**（§6.5）：防止无限递归和交叉反应
3. **重入锁**（§6.5）：防止同一Hook被重复触发

## 审查方法（严禁偷工减料）

对每条用例，你必须：
1. **手工推演**：按§6.x的规则，逐Hook推演触发顺序和阶段流转
2. **给出排序键**：对instead Hook，写出完整的排序键 `(priority, containerIndex, slotIndex, defId)`
3. **标记判定**：`PASS`（Spec明确且推演正确）/ `FAIL`（推演违反规则）/ `UNDEF`（Spec未定义）

若某条用例你无法从Spec推演出确定的执行顺序，标记 `UNDEF` 并引用最接近的Spec章节。

---

## 核心规则（§6，被测断言的来源）

| 编号 | 规则 | 违反时错误码 |
|------|------|-------------|
| HOOK-1 | 五阶段顺序：before → modify → instead → default → after | E_HOOK_* |
| HOOK-2 | instead竞争排序：(priority↓, containerIndex↑, slotIndex↑, defId↑) | 无（确定性保证） |
| HOOK-3 | instead胜出：返回preventAll或preventExcept时阻止default | 无 |
| HOOK-4 | depth上限：默认32层，超出则E_HOOK_DEPTH_EXCEEDED | E_HOOK_DEPTH_EXCEEDED |
| HOOK-5 | reactionRounds上限：默认8轮，超出则停止跨阶段反应 | 无（静默截断） |
| HOOK-6 | 重入锁：同(type, hookId)不能在同一调用栈重复触发 | E_HOOK_REENTRY |
| HOOK-7 | before/modify不能阻止default，只能修改参数 | 无 |
| HOOK-8 | after总是执行（除非事件被instead完全阻止） | 无 |

---

## 分类A：instead竞争排序（HOOK-2）

### L4-INSTEAD-001：单一instead - 不死图腾阻止死亡

```typescript
Given:
  entity_1.containers.hand = [
    { slot_0, holds: totem_1, rules: ['hook.prevent_death'] }
  ]
  hook.prevent_death = {
    on: 'death',
    phase: 'instead',
    priority: 100,
    effect: preventAll + consume(self)
  }

When:
  emit('death', { target: entity_1 })

Then:
  ✅ Hook触发顺序：
    1. before阶段：无Hook
    2. modify阶段：无Hook
    3. instead阶段：totem_1.hook.prevent_death触发
    4. default阶段：被阻止，entity_1未死亡
    5. after阶段：无Hook
  ✅ totem_1 被消耗（destroy）
  ✅ entity_1.attr.alive == true

审查指令：
  按§6.2推演，验证instead返回preventAll是否阻止default
```

---

### L4-INSTEAD-002：多个instead - 手优先于背包

```typescript
Given:
  entity_1.containers.hand = [
    { slot_0, holds: totem_hand, rules: ['hook.prevent_death'] }
  ]
  entity_1.containers.backpack = [
    { slot_0, holds: totem_back, rules: ['hook.prevent_death'] }
  ]
  两个totem的priority均为100

When:
  emit('death', { target: entity_1 })

Then:
  ✅ 排序键推演：
    totem_hand: (priority=100, containerIndex=0, slotIndex=0, defId='totem')
    totem_back: (priority=100, containerIndex=1, slotIndex=0, defId='totem')
  ✅ totem_hand排序键 < totem_back（containerIndex更小）
  ✅ totem_hand胜出，被消耗
  ✅ totem_back未被消耗
  ✅ entity_1.attr.alive == true

审查指令：
  按§6.2第2段推演排序键，验证containerIndex的比较规则
```

---

### L4-INSTEAD-003：priority不同 - 高优先级胜出

```typescript
Given:
  entity_1.containers.hand = [
    { slot_0, holds: totem_low, rules: ['hook.prevent_death_low'] }  // priority=50
  ]
  entity_1.containers.backpack = [
    { slot_0, holds: totem_high, rules: ['hook.prevent_death_high'] }  // priority=100
  ]

When:
  emit('death', { target: entity_1 })

Then:
  ✅ 排序键推演：
    totem_high: (priority=100, ...)
    totem_low: (priority=50, ...)
  ✅ totem_high排序键 < totem_low（priority更大，降序排序）
  ✅ totem_high胜出，被消耗
  ✅ totem_low未被消耗

审查指令：
  验证§6.2是否明确"priority降序"（数值大的优先）
```

---

### L4-INSTEAD-004：slotIndex不同 - 槽位0优先于槽位1

```typescript
Given:
  entity_1.containers.backpack = [
    { slot_0, holds: totem_0, rules: ['hook.prevent_death'] },
    { slot_1, holds: totem_1, rules: ['hook.prevent_death'] }
  ]
  两个totem的priority均为100

When:
  emit('death', { target: entity_1 })

Then:
  ✅ 排序键推演：
    totem_0: (..., slotIndex=0, ...)
    totem_1: (..., slotIndex=1, ...)
  ✅ totem_0排序键 < totem_1
  ✅ totem_0胜出，被消耗

审查指令：
  验证slotIndex升序排序
```

---

### L4-INSTEAD-005：defId不同 - 字典序排序

```typescript
Given:
  entity_1.containers.hand = [
    { slot_0, holds: item_aaa, def: 'totem_aaa', rules: ['hook.prevent_death'] },
    { slot_1, holds: item_zzz, def: 'totem_zzz', rules: ['hook.prevent_death'] }
  ]
  priority、containerIndex、slotIndex均相同（假设通过某种方式构造）

When:
  emit('death', { target: entity_1 })

Then:
  ✅ 排序键推演：
    item_aaa: (..., defId='totem_aaa')
    item_zzz: (..., defId='totem_zzz')
  ✅ 'totem_aaa' < 'totem_zzz'（字典序）
  ✅ item_aaa胜出

审查指令：
  验证defId是否作为最终tie-breaker
```

---

### L4-INSTEAD-006：preventExcept - 部分阻止

```typescript
Given:
  entity_1.containers.hand = [
    { slot_0, holds: shield, rules: ['hook.block_physical'] }
  ]
  hook.block_physical = {
    on: 'damage',
    phase: 'instead',
    priority: 100,
    effect: preventExcept(['damage.fire', 'damage.poison'])
  }

When:
  emit('damage.physical', { target: entity_1, amount: 10 })

Then:
  ✅ instead阶段：shield.hook.block_physical触发
  ✅ 返回preventExcept(['damage.fire', 'damage.poison'])
  ✅ default阶段：被阻止（事件类型不在白名单）
  ✅ entity_1.attr.hp 未减少

审查指令：
  按§6.2第3段推演preventExcept的语义
```

---

### L4-INSTEAD-007：preventExcept匹配白名单 - 不阻止

```typescript
Given:
  同L4-INSTEAD-006

When:
  emit('damage.fire', { target: entity_1, amount: 10 })

Then:
  ✅ instead阶段：shield.hook.block_physical触发
  ✅ 返回preventExcept(['damage.fire', 'damage.poison'])
  ✅ 事件类型在白名单 → 不阻止
  ✅ default阶段：正常执行
  ✅ entity_1.attr.hp 减少10

审查指令：
  验证白名单匹配时default是否正常执行
```

---

### L4-INSTEAD-008：多个instead - 第一个preventAll后续不执行

```typescript
Given:
  entity_1.containers.hand = [
    { slot_0, holds: totem_1, rules: ['hook.prevent_death'] },  // priority=100
    { slot_1, holds: totem_2, rules: ['hook.prevent_death'] }   // priority=100
  ]
  totem_1排序键 < totem_2

When:
  emit('death', { target: entity_1 })

Then:
  ✅ instead阶段：
    1. totem_1触发 → preventAll → 标记"事件已阻止"
    2. totem_2不执行（事件已被完全阻止）
  ✅ totem_1被消耗
  ✅ totem_2未被消耗
  ✅ default阶段：被阻止

审查指令：
  按§6.2第4段推演，验证preventAll是否立即终止instead阶段
```

---

### L4-INSTEAD-009：instead未阻止 - default正常执行

```typescript
Given:
  entity_1.containers.hand = [
    { slot_0, holds: observer, rules: ['hook.log_death'] }
  ]
  hook.log_death = {
    on: 'death',
    phase: 'instead',
    priority: 100,
    effect: log('death event') + return(null)  // 不返回preventAll
  }

When:
  emit('death', { target: entity_1 })

Then:
  ✅ instead阶段：observer.hook.log_death触发，仅记录日志
  ✅ 未返回preventAll → 事件未被阻止
  ✅ default阶段：正常执行，entity_1死亡

审查指令：
  验证instead Hook不返回preventAll时default是否正常执行
```

---

### L4-INSTEAD-010：竞争中途某Hook失效 - 跳过失效的Hook

```typescript
Given:
  entity_1.containers.hand = [
    { slot_0, holds: totem_1, rules: ['hook.prevent_death'] },
    { slot_1, holds: totem_2, rules: ['hook.prevent_death'] }
  ]
  totem_1排序键 < totem_2

When:
  tx.begin()
  item.destroy(totem_1)  // 在emit前销毁
  emit('death', { target: entity_1 })
  tx.commit()

Then:
  ✅ instead阶段：
    1. totem_1已销毁 → 跳过
    2. totem_2触发 → preventAll
  ✅ totem_2被消耗
  ✅ entity_1.attr.alive == true

审查指令：
  验证Hook收集时是否过滤已销毁的Item
```

---

### L4-INSTEAD-011：相同排序键 - 行为未定义

```typescript
Given:
  entity_1.containers.hand = [
    { slot_0, holds: totem_A, def: 'totem', rules: ['hook.prevent_death'] },
    { slot_0, holds: totem_B, def: 'totem', rules: ['hook.prevent_death'] }
  ]
  // 构造两个Item在同一槽位（理论上违反INV-2，但假设通过某种方式绕过）

When:
  emit('death', { target: entity_1 })

Then:
  ✅ 判定：UNDEF
  ✅ 原因：§6.2未定义完全相同排序键时的tie-breaker
  ✅ 建议：在Spec中明确"相同排序键时按创建时间戳排序"或"拒绝重复键"

审查指令：
  验证Spec是否覆盖所有排序键维度，若存在平局可能，标记 UNDEF
```

---

### L4-INSTEAD-012：跨容器竞争 - containerIndex确定性

```typescript
Given:
  entity_1.containers = {
    hand: [{ slot_0, holds: totem_hand }],      // containerIndex=0
    backpack: [{ slot_0, holds: totem_back }],  // containerIndex=1
    belt: [{ slot_0, holds: totem_belt }]       // containerIndex=2
  }
  所有totem的priority、slotIndex、defId均相同

When:
  emit('death', { target: entity_1 })

Then:
  ✅ 排序：totem_hand < totem_back < totem_belt
  ✅ totem_hand胜出

审查指令：
  验证containerIndex是否按容器定义顺序分配
```

---

### L4-INSTEAD-013：shift容器的slotIndex - 动态重排后的顺序

```typescript
Given:
  entity_1.containers.backpack = { mode: 'shift', slots: [
    { slot_0, holds: totem_0 },
    { slot_1, holds: totem_1 }
  ]}
  
When:
  tx.begin()
  item.destroy(totem_0)  // shift模式下totem_1自动移到slot_0
  emit('death', { target: entity_1 })
  tx.commit()

Then:
  ✅ totem_1当前slotIndex == 0（shift后）
  ✅ 排序键使用最新的slotIndex=0

审查指令：
  验证slotIndex是否使用Hook触发时的实时值
```

---

### L4-INSTEAD-014：Entity自身的Hook - containerIndex如何定义

```typescript
Given:
  entity_1.rules = ['hook.last_stand']  // Entity自身的Hook，不在容器
  entity_1.containers.hand = [{ slot_0, holds: totem, rules: ['hook.prevent_death'] }]
  两个Hook的priority均为100

When:
  emit('death', { target: entity_1 })

Then:
  ✅ 判定：UNDEF
  ✅ 原因：§6.2未明确"Entity自身的Hook的containerIndex"
  ✅ 建议：Spec需定义"自身Hook的排序键"或"自身Hook不参与竞争"

审查指令：
  若Spec未提及Entity自身的Hook如何排序，标记 UNDEF
```

---

### L4-INSTEAD-015：多个Hook部分preventExcept - 交集计算

```typescript
Given:
  entity_1.containers.hand = [
    { slot_0, holds: shield_1, rules: ['hook.block_A'] },  // preventExcept(['fire', 'poison'])
    { slot_1, holds: shield_2, rules: ['hook.block_B'] }   // preventExcept(['fire', 'ice'])
  ]

When:
  emit('damage.physical', { target: entity_1 })

Then:
  ✅ 判定：UNDEF
  ✅ 原因：§6.2未定义多个preventExcept如何组合（交集？并集？）
  ✅ 建议：明确"多个preventExcept时取白名单交集"或"仅第一个生效"

审查指令：
  若Spec未定义多个instead Hook返回不同preventExcept时的组合规则，标记 UNDEF
```

---

## 分类B：depth与reactionRounds上限（HOOK-4/5）

### L4-DEPTH-001：正常递归 - depth=3

```typescript
Given:
  entity_1.containers.hand = [{ slot_0, holds: item_A, rules: ['hook.chain_A'] }]
  hook.chain_A = {
    on: 'event_A',
    phase: 'after',
    effect: emit('event_B')
  }
  hook.chain_B = {
    on: 'event_B',
    phase: 'after',
    effect: emit('event_C')
  }
  hook.chain_C = {
    on: 'event_C',
    phase: 'after',
    effect: log('end')
  }

When:
  emit('event_A')

Then:
  ✅ 触发链：
    depth=1: event_A → hook.chain_A → emit('event_B')
    depth=2: event_B → hook.chain_B → emit('event_C')
    depth=3: event_C → hook.chain_C → log('end')
  ✅ 最大depth == 3 < 32
  ✅ 正常完成

审查指令：
  按§6.5推演depth计数，验证嵌套emit是否正确累加depth
```

---

### L4-DEPTH-002：达到上限 - depth=32

```typescript
Given:
  hook.recursive = {
    on: 'event_loop',
    phase: 'after',
    effect: emit('event_loop')  // 自己触发自己
  }

When:
  emit('event_loop')

Then:
  ✅ 触发32次（depth 1..32）
  ✅ 第33次emit时抛出 E_HOOK_DEPTH_EXCEEDED
  ✅ 事件传播停止

审查指令：
  验证depth=32时是否拒绝进一步emit
```

---

### L4-DEPTH-003：超过上限回滚 - 整个tx失败

```typescript
Given:
  同L4-DEPTH-002

When:
  tx.begin()
  attr.adjust({ entity: entity_1, hp: -10 })
  emit('event_loop')  // 触发depth超限
  result = tx.commit()

Then:
  ✅ result.ok == false
  ✅ result.code == E_HOOK_DEPTH_EXCEEDED
  ✅ entity_1.attr.hp 未变（整个tx回滚）

审查指令：
  验证depth超限是否导致整个tx失败
```

---

### L4-DEPTH-004：depth在不同事件间独立

```typescript
Given:
  hook.A = { on: 'event_A', phase: 'after', effect: emit('event_B') }
  hook.B = { on: 'event_B', phase: 'after', effect: log('B done') }

When:
  emit('event_A')  // depth链：A(1) → B(2)
  emit('event_A')  // 第二次独立调用

Then:
  ✅ 第一次emit：depth重置，A(1) → B(2)
  ✅ 第二次emit：depth重置，A(1) → B(2)
  ✅ 两次调用的depth计数器独立

审查指令：
  验证顶层emit是否重置depth为1
```

---

### L4-DEPTH-005：跨阶段的depth - before触发新事件

```typescript
Given:
  hook.before_trigger = {
    on: 'event_A',
    phase: 'before',
    effect: emit('event_B')
  }

When:
  emit('event_A')

Then:
  ✅ event_A depth=1：
    before阶段 → emit('event_B') depth=2
      event_B五个阶段完成
    返回event_A继续执行modify/instead/default/after

审查指令：
  验证before阶段emit的子事件是否累加depth
```

---

### L4-DEPTH-006：reactionRounds=1 - 单轮反应

```typescript
Given:
  hook.A_to_B = { on: 'event_A', phase: 'after', effect: emit('event_B') }
  hook.B_to_C = { on: 'event_B', phase: 'after', effect: emit('event_C') }

When:
  emit('event_A')

Then:
  ✅ round=1: event_A → emit('event_B')
  ✅ round=2: event_B → emit('event_C')
  ✅ round=3: event_C（无进一步反应）
  ✅ reactionRounds == 3 < 8，正常完成

审查指令：
  按§6.5推演reactionRounds计数
```

---

### L4-DEPTH-007：reactionRounds=8 - 达到上限

```typescript
Given:
  hook.loop = {
    on: 'event_ping',
    phase: 'after',
    effect: emit('event_ping')  // 自己触发自己
  }

When:
  emit('event_ping')

Then:
  ✅ 触发8轮
  ✅ 第9轮静默截断（不抛异常，仅停止传播）
  ✅ 无错误码返回

审查指令：
  验证reactionRounds超限时是否静默截断（而非抛异常）
```

---

### L4-DEPTH-008：depth与reactionRounds的区别

```typescript
Given:
  hook.A = {
    on: 'event_A',
    phase: 'after',
    effect: emit('event_B') + emit('event_C')  // 同一阶段emit两个事件
  }

When:
  emit('event_A')

Then:
  ✅ depth计数：
    event_A: depth=1
      emit('event_B'): depth=2
      emit('event_C'): depth=2（并行，不累加）
  ✅ reactionRounds计数：
    round=1: event_A
    round=2: event_B和event_C（算作一轮）

审查指令：
  验证depth是调用栈深度，reactionRounds是跨阶段反应轮数
```

---

### L4-DEPTH-009：配置自定义depth上限

```typescript
Given:
  world.config.maxHookDepth = 5  // 自定义上限

When:
  emit('event_loop')  // 自递归Hook

Then:
  ✅ 触发5次（depth 1..5）
  ✅ 第6次emit时抛出 E_HOOK_DEPTH_EXCEEDED

审查指令：
  验证§6.5是否支持自定义depth上限，若未提及，标记 UNDEF
```

---

### L4-DEPTH-010：配置自定义reactionRounds上限

```typescript
Given:
  world.config.maxReactionRounds = 3

When:
  emit('event_loop')  // 自递归Hook

Then:
  ✅ 触发3轮
  ✅ 第4轮静默截断

审查指令：
  验证是否支持自定义reactionRounds上限
```

---

## 分类C：重入锁（HOOK-6）

### L4-REENTRY-001：直接重入 - 同一Hook递归触发自己

```typescript
Given:
  hook.recursive = {
    on: 'event_A',
    phase: 'after',
    hookId: 'hook_001',
    effect: emit('event_A')  // 触发同一事件
  }

When:
  emit('event_A')

Then:
  ✅ 第1次：hook.recursive触发 → emit('event_A')
  ✅ 第2次：检测到(type='event_A', hookId='hook_001')在调用栈
  ✅ 抛出 E_HOOK_REENTRY
  ✅ 事件传播停止

审查指令：
  按§6.5推演重入锁，验证同(type, hookId)是否被拒绝
```

---

### L4-REENTRY-002：间接重入 - A→B→A

```typescript
Given:
  hook.A_to_B = {
    on: 'event_A',
    phase: 'after',
    hookId: 'hook_A',
    effect: emit('event_B')
  }
  hook.B_to_A = {
    on: 'event_B',
    phase: 'after',
    hookId: 'hook_B',
    effect: emit('event_A')
  }

When:
  emit('event_A')

Then:
  ✅ 第1次event_A：hook_A触发 → emit('event_B')
  ✅ event_B：hook_B触发 → emit('event_A')
  ✅ 第2次event_A：检测到hook_A在调用栈
  ✅ 抛出 E_HOOK_REENTRY

审查指令：
  验证重入锁是否跨事件检测
```

---

### L4-REENTRY-003：不同hookId - 允许触发

```typescript
Given:
  hook.A1 = { on: 'event_A', hookId: 'hook_A1', effect: emit('event_B') }
  hook.A2 = { on: 'event_A', hookId: 'hook_A2', effect: log('A2') }
  hook.B_to_A = { on: 'event_B', effect: emit('event_A') }

When:
  emit('event_A')

Then:
  ✅ 第1次event_A：hook_A1触发 → emit('event_B')
  ✅ event_B：hook_B_to_A触发 → emit('event_A')
  ✅ 第2次event_A：
    - hook_A1被重入锁阻止
    - hook_A2正常触发（不同hookId）

审查指令：
  验证重入锁是否按(type, hookId)组合判定
```

---

### L4-REENTRY-004：不同type - 允许同一hookId

```typescript
Given:
  hook.multi = {
    hookId: 'hook_multi',
    rules: [
      { on: 'event_A', phase: 'after', effect: emit('event_B') },
      { on: 'event_B', phase: 'after', effect: log('B done') }
    ]
  }

When:
  emit('event_A')

Then:
  ✅ event_A：hook_multi.rule[0]触发 → emit('event_B')
  ✅ event_B：hook_multi.rule[1]触发（不同type，允许）
  ✅ 无重入错误

审查指令：
  验证同一hookId但不同type是否被允许
```

---

### L4-REENTRY-005：重入锁在调用栈弹出后解除

```typescript
Given:
  hook.A = { on: 'event_A', hookId: 'hook_A', effect: emit('event_B') }
  hook.B = { on: 'event_B', hookId: 'hook_B', effect: log('B done') }

When:
  emit('event_A')  // 第1次
  emit('event_A')  // 第2次

Then:
  ✅ 第1次：event_A → event_B → 完成，调用栈清空
  ✅ 第2次：event_A（调用栈已空，hook_A不在栈中）
  ✅ hook_A正常触发
  ✅ 无重入错误

审查指令：
  验证重入锁是否仅在调用栈内生效
```

---

### L4-REENTRY-006：跨阶段重入 - before触发after

```typescript
Given:
  hook.before_A = {
    on: 'event_A',
    phase: 'before',
    hookId: 'hook_X',
    effect: emit('event_B')
  }
  hook.after_B = {
    on: 'event_B',
    phase: 'after',
    hookId: 'hook_X',  // 同一hookId
    effect: log('after B')
  }

When:
  emit('event_A')

Then:
  ✅ 判定：UNDEF
  ✅ 原因：§6.5未明确"同hookId但不同phase是否算重入"
  ✅ 建议：明确"重入锁按(type, hookId, phase)"或"phase不参与判定"

审查指令：
  若Spec未定义phase是否参与重入锁判定，标记 UNDEF
```

---

### L4-REENTRY-007：重入锁与instead阶段 - instead未阻止时允许重入

```typescript
Given:
  hook.instead_A = {
    on: 'event_A',
    phase: 'instead',
    hookId: 'hook_A',
    effect: log('instead A') + return(null)  // 不阻止default
  }
  hook.after_A = {
    on: 'event_A',
    phase: 'after',
    hookId: 'hook_A',  // 同一hookId
    effect: emit('event_B')
  }

When:
  emit('event_A')

Then:
  ✅ instead阶段：hook_A触发
  ✅ after阶段：检测到hook_A在调用栈（同type、同hookId）
  ✅ 是否抛出重入错误？

审查指令：
  验证同一事件的不同阶段、同一hookId是否算重入（若Spec未定义，标记 UNDEF）
```

---

### L4-REENTRY-008：无hookId的Hook - 如何判定重入

```typescript
Given:
  hook.anonymous = {
    on: 'event_A',
    phase: 'after',
    hookId: null,  // 或未定义
    effect: emit('event_A')
  }

When:
  emit('event_A')

Then:
  ✅ 判定：UNDEF
  ✅ 原因：§6.5未定义"无hookId的Hook如何判定重入"
  ✅ 建议：要求"所有Hook必须有hookId"或"无hookId的Hook不参与重入检测"

审查指令：
  若Spec未提及hookId缺失时的行为，标记 UNDEF
```

---

### L4-REENTRY-009：重入锁与tx回滚 - 调用栈状态

```typescript
Given:
  hook.A = {
    on: 'event_A',
    hookId: 'hook_A',
    effect: emit('event_B')
  }
  hook.B = {
    on: 'event_B',
    effect: some_op_that_fails()  // 导致tx失败
  }

When:
  tx.begin()
  emit('event_A')
  result = tx.commit()

Then:
  ✅ event_A → emit('event_B') → some_op失败 → tx回滚
  ✅ 调用栈是否回滚？
  ✅ 若再次emit('event_A')，hook_A是否仍在"重入锁"状态？

审查指令：
  验证重入锁的调用栈是否随tx回滚清除（若Spec未定义，标记 UNDEF）
```

---

### L4-REENTRY-010：重入锁与depth - 优先级

```typescript
Given:
  hook.recursive = {
    on: 'event_A',
    hookId: 'hook_A',
    effect: emit('event_A')
  }

When:
  emit('event_A')

Then:
  ✅ 第1次：hook_A触发 → emit('event_A')
  ✅ 第2次：是先检查重入锁还是先检查depth？
  ✅ 若先检查重入锁 → E_HOOK_REENTRY
  ✅ 若先检查depth → depth=2 < 32，然后检查重入锁 → E_HOOK_REENTRY

审查指令：
  验证重入锁与depth检查的顺序（若Spec未明确，标记 UNDEF）
```

---

## 分类D：五阶段流转与边界情况

### L4-PHASE-001：完整五阶段 - 无阻止

```typescript
Given:
  hook.before_log = { on: 'event_A', phase: 'before', effect: log('before') }
  hook.modify_log = { on: 'event_A', phase: 'modify', effect: log('modify') }
  hook.instead_log = { on: 'event_A', phase: 'instead', effect: log('instead') + return(null) }
  hook.after_log = { on: 'event_A', phase: 'after', effect: log('after') }

When:
  emit('event_A')

Then:
  ✅ 执行顺序：before → modify → instead → default → after
  ✅ 日志输出：'before', 'modify', 'instead', 'default', 'after'

审查指令：
  按§6.1推演五阶段顺序
```

---

### L4-PHASE-002：instead阻止 - after仍执行

```typescript
Given:
  hook.instead_block = { on: 'event_A', phase: 'instead', effect: preventAll }
  hook.after_log = { on: 'event_A', phase: 'after', effect: log('after') }

When:
  emit('event_A')

Then:
  ✅ instead阶段：preventAll
  ✅ default阶段：被阻止
  ✅ after阶段：仍执行
  ✅ 日志输出：'after'

审查指令：
  验证HOOK-8：after总是执行
```

---

### L4-PHASE-003：before修改参数 - modify可见

```typescript
Given:
  hook.before_modify = {
    on: 'damage',
    phase: 'before',
    effect: params.amount *= 2  // 修改参数
  }
  hook.modify_check = {
    on: 'damage',
    phase: 'modify',
    effect: log(params.amount)
  }

When:
  emit('damage', { amount: 10 })

Then:
  ✅ before阶段：amount = 10 * 2 = 20
  ✅ modify阶段：读到amount == 20
  ✅ default阶段：扣除hp = 20

审查指令：
  验证before的参数修改是否对后续阶段可见
```

---

### L4-PHASE-004：modify修改参数 - instead可见

```typescript
Given:
  hook.modify_double = {
    on: 'damage',
    phase: 'modify',
    effect: params.amount *= 2
  }
  hook.instead_check = {
    on: 'damage',
    phase: 'instead',
    effect: if (params.amount > 50) preventAll
  }

When:
  emit('damage', { amount: 30 })

Then:
  ✅ modify阶段：amount = 30 * 2 = 60
  ✅ instead阶段：amount == 60 > 50 → preventAll
  ✅ default阶段：被阻止

审查指令：
  验证modify的参数修改是否对instead可见
```

---

### L4-PHASE-005：before不能阻止default

```typescript
Given:
  hook.before_try_prevent = {
    on: 'event_A',
    phase: 'before',
    effect: return(preventAll)  // 尝试阻止
  }

When:
  emit('event_A')

Then:
  ✅ before阶段：preventAll被忽略
  ✅ default阶段：正常执行

审查指令：
  验证HOOK-7：before不能阻止default
```

---

### L4-PHASE-006：modify不能阻止default

```typescript
Given:
  hook.modify_try_prevent = {
    on: 'event_A',
    phase: 'modify',
    effect: return(preventAll)
  }

When:
  emit('event_A')

Then:
  ✅ modify阶段：preventAll被忽略
  ✅ default阶段：正常执行

审查指令：
  验证HOOK-7：modify不能阻止default
```

---

### L4-PHASE-007：after读取default的结果

```typescript
Given:
  hook.after_check = {
    on: 'damage',
    phase: 'after',
    effect: log(result.hpAfter)  // 读取default的返回值
  }

When:
  emit('damage', { target: entity_1, amount: 10 })

Then:
  ✅ default阶段：entity_1.attr.hp -= 10，返回result.hpAfter
  ✅ after阶段：读到result.hpAfter == 90

审查指令：
  验证after是否能访问default的返回值（若Spec未定义，标记 UNDEF）
```

---

### L4-PHASE-008：无default的事件 - instead无意义

```typescript
Given:
  event_custom无default实现
  hook.instead_custom = { on: 'event_custom', phase: 'instead', effect: preventAll }

When:
  emit('event_custom')

Then:
  ✅ instead阶段：preventAll
  ✅ default阶段：无操作（无default实现）
  ✅ after阶段：正常执行

审查指令：
  验证无default的事件中instead的preventAll是否无副作用
```

---

### L4-PHASE-009：多个before按什么顺序执行

```typescript
Given:
  hook.before_1 = { on: 'event_A', phase: 'before', priority: 100, effect: log('1') }
  hook.before_2 = { on: 'event_A', phase: 'before', priority: 50, effect: log('2') }

When:
  emit('event_A')

Then:
  ✅ 判定：UNDEF
  ✅ 原因：§6.1未定义"同一阶段多个Hook的执行顺序"
  ✅ 建议：明确"before/modify/after也按竞争排序"或"按注册顺序"

审查指令：
  若Spec仅定义instead的排序，未定义其他阶段，标记 UNDEF
```

---

### L4-PHASE-010：事件参数为空对象

```typescript
Given:
  hook.before_read = {
    on: 'event_A',
    phase: 'before',
    effect: log(params.field)
  }

When:
  emit('event_A', {})  // 空参数

Then:
  ✅ params.field == undefined
  ✅ Hook正常执行

审查指令：
  验证空参数是否被允许
```

---

## 使用说明（给审查者）

### 如何执行审查

1. **逐条推演**：对每条用例，打开Spec第6章，手工推演Hook触发顺序
2. **写出排序键**：对instead竞争，写出完整的 `(priority, containerIndex, slotIndex, defId)`
3. **填写判定**：
   - `PASS`：推演结果符合Then断言
   - `FAIL`：推演结果违反规则
   - `UNDEF`：Spec未定义此情况
4. **记录证据**：每条判定必须引用Spec具体段落

### 输出格式

```markdown
## 审查结果：L4-INSTEAD-002

**判定**：PASS

**推演过程**：
1. 收集instead Hook：totem_hand(slot_0)、totem_back(slot_0)
2. 排序键：
   - totem_hand: (100, 0, 0, 'totem')
   - totem_back: (100, 1, 0, 'totem')
3. 比较：priority相同 → 比较containerIndex → 0 < 1
4. totem_hand胜出，触发preventAll
5. totem_back被跳过

**Spec引用**：§6.2第2段"按(priority↓, containerIndex↑, ...)"

---

## 审查结果：L4-INSTEAD-011

**判定**：UNDEF

**原因**：
构造了两个完全相同的排序键，§6.2未定义此时的tie-breaker。

**建议**：
在§6.2末尾添加"若排序键完全相同，按Item创建时间戳升序"。

**Spec引用**：§6.2整段
```

---

## 统计

- **分类A（instead竞争）**：15条
- **分类B（depth/reactionRounds）**：10条
- **分类C（重入锁）**：10条
- **分类D（五阶段流转）**：10条
- **总计**：45条

---

## 审查完成标准

完成以下两份Prompt的审查后，你将获得：
1. **80条L3用例的推演结果**（守恒性、不变量、事务原子性）
2. **45条L4用例的推演结果**（Hook竞争、depth、重入锁、阶段流转）
3. **所有 UNDEF 和 FAIL 的汇总清单**（设计稿需要修复的地方）

这才是"实打实"的审查——每条断言都可执行、可验证、不留空想余地。

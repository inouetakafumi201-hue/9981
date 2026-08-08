# 测试驱动审查：L3 — Ops 与事务的守恒性

> **文件性质：历史测试用例本体（手工推演轴）。已完成两轮推演。**
> 用例数 80 条；第二轮复测终值：**80/80 PASS**（第一轮数字见 `TEST_L3_审查结果报告.md`）。
> 属性实测：`kernel-l3-test`（86 项命名测试 / 300,087 次检查，PASS，未发现需修复的实现缺陷）。
> ⚠️ `L3-STACK-006` 与 `L3-INV-007` 两条用例的 Then 断言已于 2026-08-07 按 Spec §4.7 修正（原断言假设 destroy 不可回滚，与 §4.7 相反），原文以引用块保留。
> 当前口径见 [`00_状态基线.md`](00_状态基线.md) §3.1；仍开放的事项见 [`00_开放事项跟踪.md`](00_开放事项跟踪.md)。
> **错误码提示**：本文件断言中出现的细分错误码（`E_OP_STACK_*`/`E_TX_NESTED`/`E_DEC_*` 等）多数**未实现**，
> 已并入通用码；真相源为 `src/core/kernel/state/error-codes.ts`，见 `00_状态基线.md` §四。

## 审查目标

对内核Spec第4章（Ops）、§4.6（不变量）、§7.3（代价）进行**可执行的边界测试**。
不回答"是否实现了X"，而是**给定具体输入，推演内核应产生的具体输出**，
与Spec逐条比对。任何"Spec未定义此情况"都是一个缺口。

## 审查方法（严禁偷工减料）

对每条用例，你必须：
1. **手工推演**：按Spec §4.x的规则，逐Op推演状态变化
2. **给出判定**：`PASS`（Spec明确且推演正确）/ `FAIL`（推演违反不变量）/ `UNDEF`（Spec未定义）
3. **禁止跳过**：不允许写"应该没问题"，必须写出推演后的**具体状态值**

若某条用例你无法从Spec推演出确定结果，标记 `UNDEF` 并引用最接近的Spec章节，
这**正是审查要找的东西**——设计稿的语义空洞。

---

## 核心不变量（§4.6，被测断言的来源）

| 编号 | 不变量 | 违反时错误码 |
|------|--------|-------------|
| INV-1 | 引用完整性：无指向已销毁对象的Ref | E_INV_DANGLING (fatal) |
| INV-2 | 单一容纳：一个Item最多在一个Slot | E_INV_DUAL_LOCATION (fatal) |
| INV-3 | 单一位置：一个Entity最多在一个Node | E_INV_DUAL_LOCATION (fatal) |
| INV-4 | 位置互斥：node与slot不同时非空 | E_INV_DUAL_LOCATION (fatal) |
| INV-5 | 无环容纳：容器不能装进自己 | E_INV_CYCLE (fatal) |
| INV-6 | 拓扑一致：Link两端存在，Node销毁则Link销毁 | E_INV_DANGLING (fatal) |
| INV-7 | 父子一致：微场景parent存在，父销毁则子销毁并疏散 | E_INV_DANGLING (fatal) |
| INV-8 | 关系对称：out与对端in互为镜像 | E_INV_* (fatal) |
| INV-9 | 容器双向一致：owner与containers[name]互指 | E_INV_* (fatal) |
| INV-10 | 槽位索引：shift无空洞，fixed不重排 | E_INV_* (fatal) |
| INV-11 | 堆叠守恒：split/merge不改变同DefId总量 | E_INV_STACK_LEAK (fatal) |
| INV-12 | 代价守恒：冻结的代价必被结算或全额退回 | E_COST_* |
| INV-13 | 附属一致：Attachment的target存在，aura失效时grantedBy级联回收 | E_INV_DANGLING (fatal) |
| INV-14 | 堆叠有界：1 ≤ stack ≤ stackMax，归零则销毁 | E_INV_* (fatal) |
| INV-15 | 决策有终：每个open Decision被答满或超时 | E_DEC_* |
| INV-16 | 数值有界：写入非有限数被拒绝 | E_EXPR_TYPE |

---

## 分类A：stack.split 堆叠守恒性（INV-11）

### L3-STACK-001：正常路径 - split后总量不变

```typescript
Given:
  world.containers = {
    c_1: { slots: [{ holds: i_1, def: 'coin', stack: 10 }] },
    c_2: { slots: [empty] }
  }

When:
  tx.begin()
  stack.split({ source: i_1, amount: 3, into: c_2 })
  result = tx.commit()

Then:
  ✅ result.ok == true
  ✅ c_1.slots[0].holds.stack == 7
  ✅ c_2.slots[0].holds.def == 'coin'
  ✅ c_2.slots[0].holds.stack == 3
  ✅ SUM(all items where def=='coin').stack == 10  // INV-11守恒
  
审查指令：
  1. 手工推演：按§4.3.1逐步写出 i_1.stack变化、新Item创建、槽位更新
  2. 验证：任何中间状态下，coin总量必须==10
  3. 若推演后总量≠10，标记 FAIL + 具体数值
```

---

### L3-STACK-002：异常回滚 - 目标槽位不接受该Def

```typescript
Given:
  world.containers = {
    c_1: { slots: [{ holds: i_1, def: 'coin', stack: 10 }] },
    c_2: { slots: [{ accepts: hasTag('weapon') }] }  // 不接受coin
  }

When:
  tx.begin()
  stack.split({ source: i_1, amount: 3, into: c_2 })
  result = tx.commit()

Then:
  ✅ result.ok == false
  ✅ result.code == E_OP_NO_LEGAL_SLOT
  ✅ c_1.slots[0].holds.stack == 10  // 未变
  ✅ i_1 仍存在
  ✅ 无新Item被创建
  ✅ SUM(coin).stack == 10  // 回滚后守恒

审查指令：
  1. 按§7.2.1推演：预检阶段发现无合法槽位 → 整个tx回滚
  2. 验证：回滚后所有状态必须与Given完全相同
  3. 若出现"部分回滚"或"新Item残留"，标记 FAIL
```

---

### L3-STACK-003：边界 - amount超过原stack

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 5 }
  c_2.slots[0] = empty

When:
  stack.split({ source: i_1, amount: 10, into: c_2 })

Then:
  ✅ result.ok == false
  ✅ result.code == E_OP_INVALID_AMOUNT
  ✅ c_1.slots[0].holds.stack == 5  // 未变
  
审查指令：
  按§4.3.1第2段"amount ≤ source.stack"推演，验证Spec是否明确此错误码
```

---

### L3-STACK-004：边界 - amount == 0

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 10 }

When:
  stack.split({ source: i_1, amount: 0, into: c_2 })

Then:
  ✅ result.ok == false
  ✅ result.code == E_OP_INVALID_AMOUNT

审查指令：
  Spec §4.3.1未明确写"amount>0"，若你无法从现有文字推演出此检查，标记 UNDEF
```

---

### L3-STACK-005：边界 - amount为负数

```typescript
Given:
  同L3-STACK-001

When:
  stack.split({ source: i_1, amount: -3, into: c_2 })

Then:
  ✅ result.ok == false
  ✅ result.code == E_OP_INVALID_AMOUNT

审查指令：
  验证§4.3.1是否覆盖负数情况，若Spec未提及，标记 UNDEF
```

---

### L3-STACK-006：竞态 - source在同一tx内被destroy

> **断言已于 2026-08-07 修正**（原判定为 FAIL，见 `TEST_L3_审查结果报告.md` 第一轮）。
> 修正依据：Spec **§4.7**（第十二轮定稿）明确 `item.destroy`/`entity.destroy`
> **在事务内完全可回滚**。因此 `split` 失败导致整个 tx 回滚后，`i_1` 会**恢复存在**，
> 而不是保持已销毁。原断言（`i_1 不存在`、`coin总量 == 0`）假设 destroy 不可回滚，与 §4.7 相反。

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 10 }

When:
  tx.begin()
  item.destroy(i_1)
  stack.split({ source: i_1, amount: 3, into: c_2 })
  result = tx.commit()

Then:
  ✅ result.ok == false
  ✅ result.code == E_REF_DESTROYED        // split 解析到已销毁的 Ref，本步失败
  ✅ i_1 存在，且 c_1.slots[0] == { holds: i_1, def: 'coin', stack: 10 }
                                            // 整个 tx 回滚，destroy 也被撤销（§4.7）
  ✅ 无新Item被创建
  ✅ coin总量 == 10                        // 回滚到 Given 状态，守恒成立

审查指令：
  按§7.2.3 Ref解析规则推演 destroy 后的 Ref 失效；
  再按§4.7 推演 commit 失败后的整体回滚，确认 destroy 被撤销。
```

> **原断言（保留供溯源）**：
> ```
>   ✅ i_1 不存在
>   ✅ coin总量 == 0  // i_1已destroy，守恒仍成立
> ```
> 这两条与 §4.7 冲突，是本用例被判 FAIL 的原因。

---

### L3-STACK-007：竞态 - target容器在同一tx内被destroy

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 10 }
  c_2 exists

When:
  tx.begin()
  container.del(c_2)
  stack.split({ source: i_1, amount: 3, into: c_2 })
  result = tx.commit()

Then:
  ✅ result.ok == false
  ✅ result.code == E_REF_DESTROYED
  ✅ c_1.slots[0].holds.stack == 10  // 未变
  ✅ i_1 仍存在
  ✅ coin总量 == 10

审查指令：
  验证§7.2.3是否明确"Op中任何Ref指向已destroy的对象则Op失败"
```

---

### L3-STACK-008：容量 - 目标槽位已满

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 10 }
  c_2.slots[0] = { holds: i_2, def: 'sword', stack: 1 }  // 已占用

When:
  stack.split({ source: i_1, amount: 3, into: c_2, atSlot: 0 })

Then:
  ✅ result.ok == false
  ✅ result.code == E_OP_SLOT_FULL
  ✅ coin总量 == 10

审查指令：
  按§4.3.1第3段"查找empty或compatible slot"推演，验证是否有明确的满槽检查
```

---

### L3-STACK-009：约束 - 目标Def的stackMax < amount

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 10 }
  c_2.slots[0] = empty
  defs.coin.stackMax == 5

When:
  stack.split({ source: i_1, amount: 8, into: c_2 })

Then:
  ✅ result.ok == false
  ✅ result.code == E_OP_INVALID_AMOUNT  // 或 E_OP_STACK_OVERFLOW
  ✅ coin总量 == 10

审查指令：
  验证§4.3.1是否检查"newStack ≤ stackMax"，若未提及，标记 UNDEF
```

---

### L3-STACK-010：约束 - stackMax == 1（单例物品）

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'sword', stack: 1 }
  defs.sword.stackMax == 1

When:
  stack.split({ source: i_1, amount: 1, into: c_2 })

Then:
  ✅ result.ok == false
  ✅ result.code == E_OP_NO_LEGAL_SLOT  // stackMax=1不能split

审查指令：
  按§4.3.1推演，验证是否有"stackMax=1时禁止split"的逻辑
```

---

### L3-STACK-011：并发 - 同一Item被两个split引用

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 10 }
  c_2.slots[0] = empty
  c_3.slots[0] = empty

When:
  tx.begin()
  stack.split({ source: i_1, amount: 3, into: c_2 })
  stack.split({ source: i_1, amount: 4, into: c_3 })  // i_1已被修改
  result = tx.commit()

Then:
  ✅ result.ok == true
  ✅ c_1.slots[0].holds.stack == 3  // 10-3-4
  ✅ c_2.slots[0].holds.stack == 3
  ✅ c_3.slots[0].holds.stack == 4
  ✅ coin总量 == 10

审查指令：
  按§7.2.2 Op序列化执行推演，验证第二个split是否能正确读取第一个split后的stack值
```

---

### L3-STACK-012：并发 - split后的新Item被同一tx内再次split

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 10 }
  c_2.slots[0] = empty
  c_3.slots[0] = empty

When:
  tx.begin()
  r1 = stack.split({ source: i_1, amount: 5, into: c_2 })  // 产生i_2
  newItem = r1.newItem
  stack.split({ source: newItem, amount: 2, into: c_3 })
  result = tx.commit()

Then:
  ✅ result.ok == true
  ✅ c_1.slots[0].holds.stack == 5
  ✅ c_2.slots[0].holds.stack == 3  // 5-2
  ✅ c_3.slots[0].holds.stack == 2
  ✅ coin总量 == 10

审查指令：
  验证新创建的Item的Ref是否立即可用于后续Op
```

---

### L3-STACK-013：merge正常 - 同Def物品合并

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 3 }
  c_1.slots[1] = { holds: i_2, def: 'coin', stack: 7 }

When:
  tx.begin()
  stack.merge({ source: i_2, into: i_1 })
  result = tx.commit()

Then:
  ✅ result.ok == true
  ✅ c_1.slots[0].holds.stack == 10
  ✅ i_2 被销毁
  ✅ c_1.slots[1] == empty
  ✅ coin总量 == 10

审查指令：
  按§4.3.2推演，验证merge后source被destroy且target.stack正确增加
```

---

### L3-STACK-014：merge溢出 - 超过stackMax

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 8 }
  c_1.slots[1] = { holds: i_2, def: 'coin', stack: 5 }
  defs.coin.stackMax == 10

When:
  stack.merge({ source: i_2, into: i_1 })

Then:
  ✅ result.ok == false
  ✅ result.code == E_OP_STACK_OVERFLOW
  ✅ i_1.stack == 8  // 未变
  ✅ i_2.stack == 5  // 未变
  ✅ coin总量 == 13

审查指令：
  验证§4.3.2是否检查"target.stack + source.stack ≤ stackMax"
```

---

### L3-STACK-015：merge异常 - Def不匹配

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 3 }
  c_1.slots[1] = { holds: i_2, def: 'gem', stack: 2 }

When:
  stack.merge({ source: i_2, into: i_1 })

Then:
  ✅ result.ok == false
  ✅ result.code == E_OP_DEF_MISMATCH
  ✅ 两个Item均未变

审查指令：
  验证§4.3.2是否明确要求"source.def == target.def"
```

---

### L3-STACK-016：adjust正常 - 增加堆叠数

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 5 }

When:
  stack.adjust({ item: i_1, delta: +3 })

Then:
  ✅ result.ok == true
  ✅ i_1.stack == 8
  ✅ coin总量增加3（来源由规则层提供，如拾取、生成）

审查指令：
  按§4.3.3推演，验证adjust是否检查"newStack ≤ stackMax"
```

---

### L3-STACK-017：adjust归零 - delta使stack变为0

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 5 }

When:
  stack.adjust({ item: i_1, delta: -5 })

Then:
  ✅ result.ok == true
  ✅ i_1 被销毁
  ✅ c_1.slots[0] == empty
  ✅ coin总量减少5

审查指令：
  验证§4.3.3是否明确"stack≤0时destroy Item"（INV-14）
```

---

### L3-STACK-018：adjust异常 - delta使stack变为负数

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 3 }

When:
  stack.adjust({ item: i_1, delta: -5 })

Then:
  ✅ result.ok == true
  ✅ i_1 被销毁
  ✅ coin总量减少3（不是5，因为最多只有3个）

审查指令：
  验证§4.3.3是否clamp到0还是报错，若Spec未提及，标记 UNDEF
```

---

### L3-STACK-019：adjust溢出 - 超过stackMax

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 8 }
  defs.coin.stackMax == 10

When:
  stack.adjust({ item: i_1, delta: +5 })

Then:
  ✅ result.ok == false
  ✅ result.code == E_OP_STACK_OVERFLOW
  ✅ i_1.stack == 8  // 未变

审查指令：
  验证是否有stackMax检查
```

---

### L3-STACK-020：split到compatible slot - 同Def可堆叠

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 10 }
  c_2.slots[0] = { holds: i_2, def: 'coin', stack: 3 }
  defs.coin.stackMax == 20

When:
  stack.split({ source: i_1, amount: 5, into: c_2 })

Then:
  ✅ result.ok == true
  ✅ c_1.slots[0].holds.stack == 5
  ✅ c_2.slots[0].holds.stack == 8  // 3+5
  ✅ i_1 仍存在，新Item未创建（直接merge到i_2）
  ✅ coin总量 == 13

审查指令：
  按§4.3.1第3段"优先compatible slot"推演，验证是否自动merge
```

---

### L3-STACK-021：split到compatible slot但会溢出

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 10 }
  c_2.slots[0] = { holds: i_2, def: 'coin', stack: 8 }
  defs.coin.stackMax == 10

When:
  stack.split({ source: i_1, amount: 5, into: c_2 })

Then:
  ✅ result.ok == false
  ✅ result.code == E_OP_STACK_OVERFLOW  // 8+5 > 10
  ✅ coin总量 == 18  // 未变

审查指令：
  验证compatible slot的merge是否检查stackMax
```

---

### L3-STACK-022：split到fixed容器的指定槽位

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 10 }
  c_2 = { mode: 'fixed', slots: [empty, empty, empty] }

When:
  stack.split({ source: i_1, amount: 3, into: c_2, atSlot: 1 })

Then:
  ✅ result.ok == true
  ✅ c_2.slots[1].holds.stack == 3
  ✅ c_2.slots[0] == empty
  ✅ c_2.slots[2] == empty

审查指令：
  验证atSlot参数是否正确指向fixed模式的特定槽位
```

---

### L3-STACK-023：split到shift容器 - 自动插入最前

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 10 }
  c_2 = { mode: 'shift', slots: [{ holds: i_2 }, { holds: i_3 }] }

When:
  stack.split({ source: i_1, amount: 3, into: c_2 })

Then:
  ✅ result.ok == true
  ✅ c_2.slots[0].holds.def == 'coin'
  ✅ c_2.slots[0].holds.stack == 3
  ✅ c_2.slots[1].holds == i_2  // 原有内容后移

审查指令：
  按§4.1.2 shift模式推演，验证新Item是否插入到索引0
```

---

### L3-STACK-024：merge跨容器

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 3 }
  c_2.slots[0] = { holds: i_2, def: 'coin', stack: 7 }

When:
  stack.merge({ source: i_2, into: i_1 })

Then:
  ✅ result.ok == true
  ✅ c_1.slots[0].holds.stack == 10
  ✅ i_2 被销毁
  ✅ c_2.slots[0] == empty
  ✅ coin总量 == 10

审查指令：
  验证merge是否允许跨容器操作
```

---

### L3-STACK-025：连续split耗尽原Item

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 10 }

When:
  tx.begin()
  stack.split({ source: i_1, amount: 10, into: c_2 })
  result = tx.commit()

Then:
  ✅ result.ok == true
  ✅ c_1.slots[0] == empty
  ✅ i_1 被销毁（stack归零）
  ✅ c_2.slots[0].holds.stack == 10
  ✅ coin总量 == 10

审查指令：
  按INV-14推演，验证"split全部后原Item是否destroy"
```

---

### L3-STACK-026：split amount == source.stack（边界等价）

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 5 }

When:
  stack.split({ source: i_1, amount: 5, into: c_2 })

Then:
  ✅ result.ok == true
  ✅ i_1 被销毁
  ✅ c_1.slots[0] == empty
  ✅ c_2.slots[0].holds.stack == 5
  ✅ coin总量 == 5

审查指令：
  验证等于原stack时是否等价于move操作
```

---

### L3-STACK-027：merge自己到自己（非法）

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 5 }

When:
  stack.merge({ source: i_1, into: i_1 })

Then:
  ✅ result.ok == false
  ✅ result.code == E_OP_SELF_MERGE
  ✅ i_1.stack == 5  // 未变

审查指令：
  验证§4.3.2是否检查"source != target"，若未提及，标记 UNDEF
```

---

### L3-STACK-028：adjust delta == 0（无意义操作）

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 5 }

When:
  stack.adjust({ item: i_1, delta: 0 })

Then:
  ✅ result.ok == true
  ✅ i_1.stack == 5  // 未变

审查指令：
  验证delta=0是否被允许（幂等操作）
```

---

### L3-STACK-029：split到容量已满的容器（所有槽位被占）

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 10 }
  c_2 = { mode: 'fixed', slots: [{ holds: i_2 }, { holds: i_3 }] }  // 全满

When:
  stack.split({ source: i_1, amount: 3, into: c_2 })

Then:
  ✅ result.ok == false
  ✅ result.code == E_OP_NO_LEGAL_SLOT
  ✅ coin总量 == 10

审查指令：
  验证容器满载时是否正确拒绝
```

---

### L3-STACK-030：split到accepts过滤后无合法槽位

```typescript
Given:
  c_1.slots[0] = { holds: i_1, def: 'coin', stack: 10 }
  c_2.slots[0] = { accepts: hasTag('weapon') }
  c_2.slots[1] = { accepts: hasTag('armor') }
  defs.coin.tags = []

When:
  stack.split({ source: i_1, amount: 3, into: c_2 })

Then:
  ✅ result.ok == false
  ✅ result.code == E_OP_NO_LEGAL_SLOT
  ✅ coin总量 == 10

审查指令：
  验证accepts表达式是否在槽位选择时正确求值
```

---

## 分类B：Cost代价守恒性（INV-12）

### L3-COST-001：正常 - 冻结→解算→结算

```typescript
Given:
  entity_1.attr.hp = 100
  entity_1.attr.gold = 50

When:
  tx.begin()
  cost.freeze({ entity: entity_1, gold: 10 })  // 冻结
  // ... 其他Op
  tx.commit()  // 解算阶段扣除gold

Then:
  ✅ entity_1.attr.gold == 40
  ✅ 无pending cost残留

审查指令：
  按§7.3推演冻结→解算→结算三阶段，验证gold是否正确扣除
```

---

### L3-COST-002：正常 - void回退全额

```typescript
Given:
  entity_1.attr.gold = 50

When:
  tx.begin()
  cost.freeze({ entity: entity_1, gold: 10 })
  // ... 某Op失败
  tx.rollback()  // void阶段退回gold

Then:
  ✅ entity_1.attr.gold == 50  // 全额退回
  ✅ 无pending cost残留

审查指令：
  验证rollback时所有frozen cost是否100%退回
```

---

### L3-COST-003：异常 - 冻结时资源不足

```typescript
Given:
  entity_1.attr.gold = 5

When:
  tx.begin()
  cost.freeze({ entity: entity_1, gold: 10 })
  result = tx.commit()

Then:
  ✅ result.ok == false
  ✅ result.code == E_COST_INSUFFICIENT
  ✅ entity_1.attr.gold == 5  // 未变

审查指令：
  验证freeze时是否检查"current >= required"
```

---

### L3-COST-004：并发 - 同一资源被多次freeze

```typescript
Given:
  entity_1.attr.gold = 50

When:
  tx.begin()
  cost.freeze({ entity: entity_1, gold: 10 })
  cost.freeze({ entity: entity_1, gold: 15 })
  tx.commit()

Then:
  ✅ result.ok == true
  ✅ entity_1.attr.gold == 25  // 50-10-15
  ✅ 两次freeze累加扣除

审查指令：
  验证多次freeze是否累积，且commit时一次性扣除
```

---

### L3-COST-005：并发 - freeze后再adjust同一资源

```typescript
Given:
  entity_1.attr.gold = 50

When:
  tx.begin()
  cost.freeze({ entity: entity_1, gold: 10 })
  attr.adjust({ entity: entity_1, gold: +20 })  // 增加gold
  tx.commit()

Then:
  ✅ result.ok == true
  ✅ entity_1.attr.gold == 60  // 50+20-10

审查指令：
  验证freeze与adjust的执行顺序：adjust是否影响已冻结的量
```

---

### L3-COST-006：并发 - 冻结后资源被其他Op消耗

```typescript
Given:
  entity_1.attr.gold = 50

When:
  tx.begin()
  cost.freeze({ entity: entity_1, gold: 40 })
  attr.adjust({ entity: entity_1, gold: -20 })  // 减少gold
  tx.commit()

Then:
  ✅ result.ok == false
  ✅ result.code == E_COST_INSUFFICIENT  // 50-20=30 < 40 frozen
  ✅ entity_1.attr.gold == 50  // 回滚

审查指令：
  验证commit时是否检查"解算后剩余 >= frozen总量"
```

---

### L3-COST-007：边界 - freeze amount == 0

```typescript
Given:
  entity_1.attr.gold = 50

When:
  cost.freeze({ entity: entity_1, gold: 0 })

Then:
  ✅ result.ok == true
  ✅ entity_1.attr.gold == 50  // 未变

审查指令：
  验证freeze(0)是否被允许（幂等操作）
```

---

### L3-COST-008：边界 - freeze负数（非法）

```typescript
Given:
  entity_1.attr.gold = 50

When:
  cost.freeze({ entity: entity_1, gold: -10 })

Then:
  ✅ result.ok == false
  ✅ result.code == E_COST_INVALID_AMOUNT

审查指令：
  验证§7.3是否检查"amount >= 0"，若未提及，标记 UNDEF
```

---

### L3-COST-009：多资源 - 同时冻结hp和gold

```typescript
Given:
  entity_1.attr.hp = 100
  entity_1.attr.gold = 50

When:
  tx.begin()
  cost.freeze({ entity: entity_1, hp: 10, gold: 20 })
  tx.commit()

Then:
  ✅ result.ok == true
  ✅ entity_1.attr.hp == 90
  ✅ entity_1.attr.gold == 30

审查指令：
  验证多资源freeze是否独立处理
```

---

### L3-COST-010：多资源 - 其中一项不足导致全部回滚

```typescript
Given:
  entity_1.attr.hp = 100
  entity_1.attr.gold = 5

When:
  tx.begin()
  cost.freeze({ entity: entity_1, hp: 10, gold: 20 })
  result = tx.commit()

Then:
  ✅ result.ok == false
  ✅ result.code == E_COST_INSUFFICIENT
  ✅ entity_1.attr.hp == 100  // 未扣除
  ✅ entity_1.attr.gold == 5  // 未扣除

审查指令：
  验证多资源freeze是否原子性：任一不足则全部失败
```

---

## 分类C：entity.place 位置互斥性（INV-2/3/4）

### L3-INV-001：正常 - entity从node移动到另一node

```typescript
Given:
  world.nodes = { n_1, n_2 }
  entity_1.place = { node: n_1 }

When:
  entity.place({ entity: entity_1, at: n_2 })

Then:
  ✅ result.ok == true
  ✅ entity_1.place.node == n_2
  ✅ entity_1.place.slot == null
  ✅ n_1.entities 不包含 entity_1
  ✅ n_2.entities 包含 entity_1

审查指令：
  按§4.2推演，验证旧node的反向引用是否正确清除
```

---

### L3-INV-002：正常 - entity从slot移出到node

```typescript
Given:
  entity_1.place = { slot: slot_1 }  // 在某个容器槽位
  slot_1.holds == entity_1

When:
  entity.place({ entity: entity_1, at: node_1 })

Then:
  ✅ result.ok == true
  ✅ entity_1.place.node == node_1
  ✅ entity_1.place.slot == null
  ✅ slot_1.holds == null

审查指令：
  验证INV-4：node与slot互斥，移动后旧slot是否正确清空
```

---

### L3-INV-003：正常 - entity从node移入到slot

```typescript
Given:
  entity_1.place = { node: node_1 }
  container_1.slots[0] = empty

When:
  entity.place({ entity: entity_1, at: container_1, atSlot: 0 })

Then:
  ✅ result.ok == true
  ✅ entity_1.place.node == null
  ✅ entity_1.place.slot == container_1.slots[0]
  ✅ container_1.slots[0].holds == entity_1
  ✅ node_1.entities 不包含 entity_1

审查指令：
  验证INV-4：移入slot后node必须为null
```

---

### L3-INV-004：异常 - 同一entity被place两次（同一tx内）

```typescript
Given:
  entity_1.place = { node: node_1 }

When:
  tx.begin()
  entity.place({ entity: entity_1, at: node_2 })
  entity.place({ entity: entity_1, at: node_3 })
  result = tx.commit()

Then:
  ✅ result.ok == true
  ✅ entity_1.place.node == node_3  // 后者覆盖
  ✅ node_1.entities 不包含 entity_1
  ✅ node_2.entities 不包含 entity_1
  ✅ node_3.entities 包含 entity_1

审查指令：
  验证连续place是否正确处理中间状态
```

---

### L3-INV-005：异常 - 目标slot已被占用

```typescript
Given:
  entity_1.place = { node: node_1 }
  entity_2.place = { slot: container_1.slots[0] }

When:
  entity.place({ entity: entity_1, at: container_1, atSlot: 0 })

Then:
  ✅ result.ok == false
  ✅ result.code == E_OP_SLOT_FULL
  ✅ entity_1.place.node == node_1  // 未变

审查指令：
  验证INV-2：一个slot最多容纳一个Entity/Item
```

---

### L3-INV-006：异常 - 目标node被destroy

```typescript
Given:
  entity_1.place = { node: node_1 }
  node_2 exists

When:
  tx.begin()
  node.del(node_2)
  entity.place({ entity: entity_1, at: node_2 })
  result = tx.commit()

Then:
  ✅ result.ok == false
  ✅ result.code == E_REF_DESTROYED
  ✅ entity_1.place.node == node_1  // 未变

审查指令：
  验证INV-1：不允许引用已销毁的对象
```

---

### L3-INV-007：异常 - entity在同一tx内被destroy后place

> **断言已于 2026-08-07 补全**（原判定为 FAIL，见 `TEST_L3_审查结果报告.md` 第一轮）。
> 原断言只检查了 `result.ok/code`，**没有断言回滚后的状态**，因此隐含了
> "entity_1 保持已销毁"这一与 Spec **§4.7** 相反的预期 —— §4.7 定稿为
> `entity.destroy` 在事务内**完全可回滚**，commit 失败后 entity_1 应恢复存在。

```typescript
Given:
  entity_1.place = { node: node_1 }

When:
  tx.begin()
  entity.del(entity_1)
  entity.place({ entity: entity_1, at: node_2 })
  result = tx.commit()

Then:
  ✅ result.ok == false
  ✅ result.code == E_REF_DESTROYED        // place 解析到已销毁的 Ref，本步失败
  ✅ entity_1 存在                          // 整个 tx 回滚，entity.del 被撤销（§4.7）
  ✅ entity_1.place == { node: node_1 }     // 位置回到 Given 状态，未被移到 node_2

审查指令：
  先验证 destroy 后的 entity 引用在同 tx 内立即失效（§7.2.3）；
  再按§4.7 验证 commit 失败后整体回滚，entity_1 与其 place 均恢复。
```

---

### L3-INV-008：边界 - place到自己当前所在的node（幂等）

```typescript
Given:
  entity_1.place = { node: node_1 }

When:
  entity.place({ entity: entity_1, at: node_1 })

Then:
  ✅ result.ok == true
  ✅ entity_1.place.node == node_1  // 未变

审查指令：
  验证place到当前位置是否被优化（幂等操作）
```

---

### L3-INV-009：约束 - slot的accepts过滤

```typescript
Given:
  entity_1.place = { node: node_1 }
  entity_1.tags = ['npc']
  container_1.slots[0].accepts = hasTag('item')  // 只接受item标签

When:
  entity.place({ entity: entity_1, at: container_1, atSlot: 0 })

Then:
  ✅ result.ok == false
  ✅ result.code == E_OP_SLOT_REJECT
  ✅ entity_1.place.node == node_1  // 未变

审查指令：
  验证accepts表达式是否在place时求值
```

---

### L3-INV-010：约束 - 容器的owner被destroy

```typescript
Given:
  entity_1.place = { node: node_1 }
  entity_2.containers.backpack exists
  container_1 = entity_2.containers.backpack

When:
  tx.begin()
  entity.del(entity_2)  // owner被destroy
  entity.place({ entity: entity_1, at: container_1, atSlot: 0 })
  result = tx.commit()

Then:
  ✅ result.ok == false
  ✅ result.code == E_REF_DESTROYED  // container随owner销毁

审查指令：
  验证INV-9：容器销毁时owner必须同步更新
```

---

### L3-INV-011：边界 - 从null位置place到node（新建entity）

```typescript
Given:
  entity_1 = entity.new({ def: 'npc.guard' })
  entity_1.place == null  // 新建时无位置

When:
  entity.place({ entity: entity_1, at: node_1 })

Then:
  ✅ result.ok == true
  ✅ entity_1.place.node == node_1
  ✅ node_1.entities 包含 entity_1

审查指令：
  验证新建entity的初始place是否允许为null
```

---

### L3-INV-012：环检测 - 容器A装进容器B，B装进A（直接环）

```typescript
Given:
  entity_A.containers.c_A exists
  entity_B.containers.c_B exists
  entity_A.place = { slot: entity_B.containers.c_B.slots[0] }

When:
  entity.place({ entity: entity_B, at: entity_A.containers.c_A, atSlot: 0 })

Then:
  ✅ result.ok == false
  ✅ result.code == E_INV_CYCLE

审查指令：
  按INV-5推演，验证是否检测A→B→A的直接环
```

---

### L3-INV-013：环检测 - 三层间接环（A→B→C→A）

```typescript
Given:
  entity_A.place = { slot: entity_B.c.slots[0] }
  entity_B.place = { slot: entity_C.c.slots[0] }

When:
  entity.place({ entity: entity_C, at: entity_A.c, atSlot: 0 })

Then:
  ✅ result.ok == false
  ✅ result.code == E_INV_CYCLE

审查指令：
  验证环检测算法是否递归检查传递闭包
```

---

### L3-INV-014：Link拓扑 - node被destroy时Link级联删除

```typescript
Given:
  node_1 exists
  node_2 exists
  link_1 = { from: node_1, to: node_2 }

When:
  tx.begin()
  node.del(node_1)
  tx.commit()

Then:
  ✅ result.ok == true
  ✅ link_1 被销毁
  ✅ node_2 仍存在

审查指令：
  按INV-6推演，验证Link两端任一被destroy时Link是否级联删除
```

---

### L3-INV-015：Link拓扑 - 同一tx内创建node和link

```typescript
Given:
  无

When:
  tx.begin()
  n_1 = node.new()
  n_2 = node.new()
  link.new({ from: n_1, to: n_2 })
  result = tx.commit()

Then:
  ✅ result.ok == true
  ✅ link_1.from == n_1
  ✅ link_1.to == n_2

审查指令：
  验证新建对象的Ref是否立即可用于同一tx内的后续Op
```

---

### L3-INV-016：Link拓扑 - 创建Link时端点不存在

```typescript
Given:
  node_1 exists
  node_2 不存在

When:
  link.new({ from: node_1, to: node_2 })

Then:
  ✅ result.ok == false
  ✅ result.code == E_REF_INVALID

审查指令：
  验证Link创建时是否检查端点存在性
```

---

### L3-INV-017：父子一致 - parent微场景被destroy时子场景级联

```typescript
Given:
  scene_parent exists
  scene_child = { parent: scene_parent }

When:
  tx.begin()
  scene.del(scene_parent)
  tx.commit()

Then:
  ✅ result.ok == true
  ✅ scene_child 被销毁
  ✅ scene_child内所有entity被疏散到parent.parent（若存在）

审查指令：
  按INV-7推演，验证父微场景销毁时子场景是否级联且entity是否疏散
```

---

### L3-INV-018：父子一致 - 创建子场景时parent不存在

```typescript
Given:
  scene_parent 不存在

When:
  scene.new({ parent: scene_parent })

Then:
  ✅ result.ok == false
  ✅ result.code == E_REF_INVALID

审查指令：
  验证scene创建时parent引用的有效性检查
```

---

### L3-INV-019：关系对称 - out添加时in自动镜像

```typescript
Given:
  entity_A exists
  entity_B exists

When:
  rel.add({ from: entity_A, to: entity_B, type: 'ally' })

Then:
  ✅ result.ok == true
  ✅ entity_A.rel.out['ally'] 包含 entity_B
  ✅ entity_B.rel.in['ally'] 包含 entity_A

审查指令：
  按INV-8推演，验证out与in是否自动同步
```

---

### L3-INV-020：关系对称 - 删除out时in自动清除

```typescript
Given:
  entity_A.rel.out['ally'] = [entity_B]
  entity_B.rel.in['ally'] = [entity_A]

When:
  rel.del({ from: entity_A, to: entity_B, type: 'ally' })

Then:
  ✅ result.ok == true
  ✅ entity_A.rel.out['ally'] 不包含 entity_B
  ✅ entity_B.rel.in['ally'] 不包含 entity_A

审查指令：
  验证关系删除时镜像是否同步清除
```

---

### L3-INV-021：关系对称 - 其中一方被destroy时关系级联删除

```typescript
Given:
  entity_A.rel.out['ally'] = [entity_B]
  entity_B.rel.in['ally'] = [entity_A]

When:
  entity.del(entity_A)

Then:
  ✅ result.ok == true
  ✅ entity_B.rel.in['ally'] 不包含 entity_A

审查指令：
  验证entity销毁时所有入边和出边是否级联清除
```

---

### L3-INV-022：容器双向一致 - owner被destroy时containers级联

```typescript
Given:
  entity_1.containers.backpack exists
  container_1 = entity_1.containers.backpack
  container_1.owner == entity_1

When:
  entity.del(entity_1)

Then:
  ✅ result.ok == true
  ✅ container_1 被销毁
  ✅ container_1内所有Item被销毁

审查指令：
  按INV-9推演，验证owner销毁时容器及内容物是否级联删除
```

---

### L3-INV-023：槽位索引 - shift模式插入后无空洞

```typescript
Given:
  container_1 = { mode: 'shift', slots: [{ holds: i_1 }, empty, { holds: i_2 }] }

When:
  container.compact(container_1)  // 压缩空洞

Then:
  ✅ result.ok == true
  ✅ container_1.slots == [{ holds: i_1 }, { holds: i_2 }]
  ✅ 无空洞

审查指令：
  按INV-10推演，验证shift模式是否自动消除空洞
```

---

### L3-INV-024：槽位索引 - fixed模式允许空洞

```typescript
Given:
  container_1 = { mode: 'fixed', slots: [{ holds: i_1 }, empty, { holds: i_2 }] }

When:
  item.destroy(i_1)

Then:
  ✅ result.ok == true
  ✅ container_1.slots == [empty, empty, { holds: i_2 }]
  ✅ 允许空洞

审查指令：
  验证fixed模式下槽位索引是否保持不变
```

---

### L3-INV-025：Attachment级联 - target被destroy时attachment销毁

```typescript
Given:
  entity_1 exists
  entity_2 exists
  attach_1 = { target: entity_1, type: 'buff', grantedBy: entity_2 }

When:
  entity.del(entity_1)

Then:
  ✅ result.ok == true
  ✅ attach_1 被销毁

审查指令：
  按INV-13推演，验证Attachment的target销毁时是否级联删除
```

---

### L3-INV-026：Attachment级联 - grantedBy被destroy时attachment销毁

```typescript
Given:
  entity_1 exists
  entity_2 exists
  attach_1 = { target: entity_1, type: 'aura', grantedBy: entity_2 }

When:
  entity.del(entity_2)

Then:
  ✅ result.ok == true
  ✅ attach_1 被销毁

审查指令：
  验证grantedBy销毁时aura类型的attachment是否级联回收
```

---

### L3-INV-027：数值有界 - 写入Infinity被拒绝

```typescript
Given:
  entity_1.attr.hp = 100

When:
  attr.set({ entity: entity_1, hp: Infinity })

Then:
  ✅ result.ok == false
  ✅ result.code == E_EXPR_TYPE
  ✅ entity_1.attr.hp == 100  // 未变

审查指令：
  按INV-16推演，验证是否拒绝非有限数
```

---

### L3-INV-028：数值有界 - 写入NaN被拒绝

```typescript
Given:
  entity_1.attr.hp = 100

When:
  attr.set({ entity: entity_1, hp: NaN })

Then:
  ✅ result.ok == false
  ✅ result.code == E_EXPR_TYPE
  ✅ entity_1.attr.hp == 100  // 未变

审查指令：
  验证NaN是否被拒绝
```

---

### L3-INV-029：堆叠有界 - stack归零时Item自动销毁

```typescript
Given:
  container_1.slots[0] = { holds: i_1, def: 'coin', stack: 1 }

When:
  stack.adjust({ item: i_1, delta: -1 })

Then:
  ✅ result.ok == true
  ✅ i_1 被销毁
  ✅ container_1.slots[0] == empty

审查指令：
  按INV-14推演，验证stack≤0时是否自动destroy
```

---

### L3-INV-030：堆叠有界 - 创建stack<1的Item被拒绝

```typescript
Given:
  container_1.slots[0] = empty

When:
  item.new({ def: 'coin', stack: 0, into: container_1 })

Then:
  ✅ result.ok == false
  ✅ result.code == E_OP_INVALID_AMOUNT

审查指令：
  验证Item创建时是否检查"stack >= 1"
```

---

## 分类D：事务原子性与隔离性（§7）

### L3-TX-001：原子性 - 任一Op失败则全部回滚

```typescript
Given:
  entity_1.attr.hp = 100
  entity_1.attr.gold = 50
  container_1.slots = [empty]

When:
  tx.begin()
  attr.adjust({ entity: entity_1, hp: -10 })  // 成功
  cost.freeze({ entity: entity_1, gold: 100 })  // 失败（不足）
  result = tx.commit()

Then:
  ✅ result.ok == false
  ✅ entity_1.attr.hp == 100  // hp调整被回滚
  ✅ entity_1.attr.gold == 50  // 未变

审查指令：
  按§7.2.1推演，验证原子性：任一Op失败是否导致整个tx回滚
```

---

### L3-TX-002：原子性 - Op序列中间失败

```typescript
Given:
  entity_1.attr.hp = 100
  container_1.slots[0] = { holds: i_1, def: 'coin', stack: 10 }

When:
  tx.begin()
  attr.adjust({ entity: entity_1, hp: -10 })  // Op1成功
  stack.split({ source: i_1, amount: 100, into: c_2 })  // Op2失败
  attr.adjust({ entity: entity_1, hp: -10 })  // Op3未执行
  result = tx.commit()

Then:
  ✅ result.ok == false
  ✅ entity_1.attr.hp == 100  // Op1被回滚
  ✅ i_1.stack == 10  // 未变
  ✅ Op3未执行

审查指令：
  验证Op失败后是否立即停止执行剩余Op
```

---

### L3-TX-003：隔离性 - 嵌套tx被拒绝

```typescript
Given:
  entity_1.attr.hp = 100

When:
  tx.begin()
  attr.adjust({ entity: entity_1, hp: -10 })
  tx.begin()  // 嵌套tx

Then:
  ✅ 抛出异常或返回 E_TX_NESTED
  ✅ 外层tx自动回滚

审查指令：
  按§7.2.4推演，验证是否禁止嵌套tx
```

---

### L3-TX-004：隔离性 - commit前状态对外不可见

```typescript
Given:
  entity_1.attr.hp = 100

When:
  tx.begin()
  attr.adjust({ entity: entity_1, hp: -10 })
  // 此时查询entity_1.attr.hp

Then:
  ✅ 外部查询仍返回 100
  ✅ tx内部查询返回 90

审查指令：
  按§7.2.2推演，验证tx内修改是否隔离（若Spec未定义隔离级别，标记 UNDEF）
```

---

### L3-TX-005：rollback主动 - 显式调用rollback

```typescript
Given:
  entity_1.attr.hp = 100

When:
  tx.begin()
  attr.adjust({ entity: entity_1, hp: -10 })
  tx.rollback()

Then:
  ✅ entity_1.attr.hp == 100  // 回滚

审查指令：
  验证显式rollback是否等价于commit失败的回滚行为
```

---

### L3-TX-006：commit前提检查 - 所有Decision已答满

```typescript
Given:
  entity_1.attr.hp = 100
  decision_1 = { type: 'choice', options: ['A', 'B'], answer: null }

When:
  tx.begin()
  attr.adjust({ entity: entity_1, hp: -10 })
  tx.commit()  // decision_1未答

Then:
  ✅ result.ok == false
  ✅ result.code == E_DEC_UNANSWERED
  ✅ entity_1.attr.hp == 100  // 回滚

审查指令：
  按INV-15推演，验证commit前是否检查所有Decision已答满
```

---

### L3-TX-007：cost三态 - 冻结后tx失败，void阶段退回

```typescript
Given:
  entity_1.attr.gold = 50

When:
  tx.begin()
  cost.freeze({ entity: entity_1, gold: 10 })
  attr.adjust({ entity: entity_1, hp: -1000 })  // 假设触发死亡检查失败
  result = tx.commit()

Then:
  ✅ result.ok == false
  ✅ entity_1.attr.gold == 50  // void退回

审查指令：
  验证void阶段是否100%退回所有冻结的cost
```

---

### L3-TX-008：Op依赖 - 后续Op依赖前Op的结果

```typescript
Given:
  container_1.slots[0] = { holds: i_1, def: 'coin', stack: 10 }

When:
  tx.begin()
  r = stack.split({ source: i_1, amount: 5, into: c_2 })
  newItem = r.newItem
  stack.adjust({ item: newItem, delta: +2 })  // 依赖前Op的返回值
  tx.commit()

Then:
  ✅ result.ok == true
  ✅ c_2.slots[0].holds.stack == 7  // 5+2

审查指令：
  验证Op返回值是否可立即用于后续Op
```

---

### L3-TX-009：并发冲突检测 - 同一资源被modify两次

```typescript
Given:
  entity_1.attr.hp = 100

When:
  tx.begin()
  attr.set({ entity: entity_1, hp: 50 })  // Op1
  attr.set({ entity: entity_1, hp: 80 })  // Op2
  tx.commit()

Then:
  ✅ result.ok == true
  ✅ entity_1.attr.hp == 80  // 后者覆盖

审查指令：
  验证同一字段被多次写入时是否按Op顺序执行（最后写入胜出）
```

---

### L3-TX-010：空tx - 无Op的commit

```typescript
Given:
  entity_1.attr.hp = 100

When:
  tx.begin()
  tx.commit()

Then:
  ✅ result.ok == true
  ✅ 无副作用

审查指令：
  验证空tx是否被允许（幂等操作）
```

---

## 使用说明（给审查者）

### 如何执行审查

1. **逐条推演**：对每条用例，打开 Spec 对应章节，手工推演状态变化
2. **填写判定**：
   - `PASS`：推演结果符合Then断言
   - `FAIL`：推演结果违反断言（写明违反哪条不变量）
   - `UNDEF`：Spec未定义此情况（引用最接近的章节）
3. **记录证据**：每条判定必须引用Spec具体段落（如"按§4.3.1第2段"）
4. **标记缺口**：所有 `UNDEF` 和 `FAIL` 是设计稿需要修复的地方

### 禁止行为

- ❌ 不允许跳过用例
- ❌ 不允许写"应该没问题"而不推演
- ❌ 不允许只检查"是否实现"而不验证正确性
- ❌ 不允许假设Spec未写明的行为"大概是这样"

### 输出格式

```markdown
## 审查结果：L3-STACK-001

**判定**：PASS

**推演过程**：
1. 按§4.3.1第1段，split操作创建新Item i_2，def继承自i_1
2. i_1.stack = 10 - 3 = 7（§4.3.1第2段）
3. i_2.stack = 3，插入c_2的第一个empty槽位（§4.3.1第3段）
4. SUM(coin) = 7 + 3 = 10（INV-11守恒）

**Spec引用**：§4.3.1整段

---

## 审查结果：L3-STACK-004

**判定**：UNDEF

**原因**：
§4.3.1第2段仅写"amount ≤ source.stack"，未明确写"amount > 0"。
从字面推演，amount=0时满足"≤ source.stack"，但创建stack=0的Item违反INV-14。

**建议**：
在§4.3.1第2段添加前置条件"amount必须为正整数"。

**Spec引用**：§4.3.1第2段、INV-14
```

---

## 统计

- **分类A（stack守恒）**：30条
- **分类B（cost守恒）**：10条
- **分类C（位置互斥）**：30条
- **分类D（事务原子性）**：10条
- **总计**：80条

---

## 下一步

本Prompt完成后，继续执行 **TEST_L4_Hook五阶段竞争.md**（100条用例）。

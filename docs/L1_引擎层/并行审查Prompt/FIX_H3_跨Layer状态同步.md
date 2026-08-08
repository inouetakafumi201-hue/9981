# FIX_H3_跨Layer状态同步机制修复方案

> **文档性质**：P0高风险项修复方案  
> **问题来源**：并行审查Phase发现的跨层集成漏洞  
> **最后更新**：2026-08-05

---

## 1. 问题描述

### 1.1 原始问题陈述

**风险等级**：P0 - 高风险  
**问题类型**：跨Layer状态同步机制缺失

**核心矛盾**：
- Schedule（§9）的定时事件在特定phase触发
- 触发时，世界状态可能已变化（Entity死亡、资源耗尽、条件不满足）
- Spec中**未明确状态有效性的保障机制**

**典型场景**：
```
T0: 定时器设置"3回合后爆炸"，绑定到Entity A
T3: 触发时，Entity A已被销毁 → 如何处理？
```

### 1.2 当前Spec相关段落

**§5 Flow（行810-811）** 提到延时效果：
```typescript
{ after: 3 }  // 3 phase后触发
{ at: 10 }    // 绝对phase 10触发
```

**§9.1 Schedule** 定义了定时器机制，但**未定义pending事件的存储结构**。

**§12 Snapshot** 定义了快照机制，但**未明确是否包含pending事件**。

---

## 2. 核心诊断

### 2.1 TOCTOU问题识别

Spec已对Decision和Intent做TOCTOU重检：
- Decision：`onResolve`前重检
- Intent：解算前重检`require`

但**延时Effect的状态表示未定义**，导致snapshot无法捕获pending事件。

### 2.2 缺失的结构定义

```typescript
// §5中引用，但结构未定义
interface PendingEffect {
  id: PendingEffectId
  triggerAt: number        // 绝对phase序号
  effects: Effect[]
  context: Record<string, Value>  // 闭包捕获的变量
  source?: Ref             // 创建者（用于失效检测）
}
```

---

## 3. Spec修改草案

### 3.1 §5 Flow章节补充（行825后）

```markdown
### 5.1 延时Effect与状态一致性

**pending事件的存储**：
```typescript
world.pendingEffects: PendingEffect[]

interface PendingEffect {
  id: PendingEffectId
  triggerAt: number        // 绝对phase序号（{at}或当前+{after}）
  effects: Effect[]
  context: Record<string, Value>  // 创建时的闭包变量
  source?: Ref             // 创建者（用于source失效检测）
  validityCheck?: Expr     // 可选的有效性条件
}
```

**触发时的TOCTOU重检**：
每个pending effect触发前，执行以下检查：

| 检查项 | 失败行为 |
|-------|---------|
| `source`仍存在 | 若已销毁，pending effect作废 |
| `validityCheck`通过 | 若返回false，pending effect作废 |
| `context`中引用的Ref仍有效 | 若悬空，effects中涉及该Ref的Op返回ok:false |

**示例**：
```typescript
// 设置"3回合后爆炸"
Action 'plant_bomb' {
  effects: [
    { op: 'entity.create', args: { def: 'd:bomb' }, let: 'bomb' },
    { after: 3, effects: [
      { op: 'damage', args: { 
          targets: { from: 'entities', in: { radius: { center: { $: 'bomb' }, range: 3 } } },
          amount: 5
        }
      },
      { op: 'entity.destroy', args: { target: { $: 'bomb' } } }
    ]}
  ]
}
```

若bomb在3回合内被拆除（destroy），则pending effect的`validityCheck: { op: 'exists', args: { $: 'bomb' } }`自动失败，爆炸不触发。
```

### 3.2 §12 Snapshot章节补充（行1520后）

```markdown
### 12.1 Snapshot包含pending事件

快照必须包含所有pending状态：

```typescript
interface WorldSnapshot {
  // ... 原有字段
  pendingEffects: PendingEffect[]   // 所有pending effect
  pendingDecisions: Decision[]      // 所有open Decision
  pendingIntents: Intent[]          // 所有pending Intent
}
```

**回放一致性**：
replay时，pending事件按`triggerAt`顺序重新调度，保证确定性。
```

### 3.3 §4.6不变量增加1条

```markdown
| pending事件一致性 | 所有pending effect的source若指向Entity，则该Entity必须存在；否则pending effect在下一phase清理时作废 |
```

### 3.4 §9.1 Schedule章节补充（行1334后）

```markdown
### 9.1.1 定时器与状态失效

**定时器清理规则**：
每个phase开始时，清理失效的pending effect：

| 失效条件 | 行为 |
|---------|------|
| `source`已销毁 | 从`world.pendingEffects`移除 |
| `validityCheck`返回false | 从`world.pendingEffects`移除 |
| `triggerAt ≤ 当前phase` | 触发后移除 |

**防止悬空引用**：
pending effect的`context`中捕获的Ref，若指向后续被销毁的Entity，则触发时该Ref解析为null，Op返回ok:false但不crash。
```

---

## 4. 典型场景的防御验证

### 4.1 场景1：定时炸弹被拆除

```
T0: 放置炸弹bomb，设置"3回合后爆炸"
T1: 玩家拆除炸弹（entity.destroy bomb）
T3: pending effect触发前检测source不存在 → 作废，不爆炸 ✅
```

### 4.2 场景2：延时治疗的目标死亡

```
T0: 施放"3回合后治疗目标A"
T2: 目标A死亡
T3: pending effect触发，context中的targetRef解析为null → heal Op返回ok:false ✅
```

### 4.3 场景3：条件触发器的条件失效

```
T0: 设置"当金币≥100时触发事件"，validityCheck: world.props.gold >= 100
T5: 金币被花费到50
T6: validityCheck失败 → pending effect作废 ✅
```

---

## 5. 与现有Spec的集成点

### 5.1 需修改的章节

| Spec章节 | 修改类型 | 具体位置 |
|---------|---------|---------|
| **§5 Flow** | 新增章节 | 行825后增加§5.1 |
| **§9.1 Schedule** | 新增章节 | 行1334后增加§9.1.1 |
| **§12 Snapshot** | 新增章节 | 行1520后增加§12.1 |
| **§4.6 不变量** | 扩充表格 | 增加1条pending事件一致性 |

### 5.2 不影响现有设计的验证

| 用例编号 | 用例内容 | 验证 |
|---------|---------|------|
| 所有现有用例 | 延时效果 | ✅ 现在有明确的存储结构与失效机制 |
| 84 | 存档回放 | ✅ snapshot现在包含pendingEffects |

---

## 6. 验收标准

- [x] PendingEffect结构完整定义
- [x] TOCTOU重检机制明确（source存在性、validityCheck、Ref有效性）
- [x] Snapshot包含pending状态
- [x] 清理规则明确（每phase开始清理失效项）
- [x] 3个典型场景防御验证通过

---

**修复完成标志**：✅ 结构定义+TOCTOU重检+snapshot集成+清理规则

---

## 归档状态（2026-08-07）：✅ 三项 H 中唯一完全闭环的一项

| 项 | 状态 |
|---|---|
| PendingEffect 结构定义 + TOCTOU 重检机制 | ✅ 已合并入 Spec **§5.1**（Spec:1104） |
| 光环失效与计时器清理 | ✅ 已合并入 Spec **§8.4.1**（Spec:1800） |
| Snapshot 包含 pending 事件 | ✅ 已合并入 Spec **§12.0.1**（Spec:2085） |
| §4.6 延时效果一致性不变量 | ✅ 已收录（Spec:1009 §4.6.1） |
| 错误码 | ✅ 本方案不新增错误码，使用现有码 —— 因此**不受"错误码未实现"问题影响** |
| 实测验证 | ✅ 内核模糊测试（任意 Op 序列 + 40% 概率悬空引用）+ `kernel-l12-test` checkpoint/restore 往返一致性属性测试全部 PASS |

> ⚠️ **一处历史声明有误**：`P0_FIXES_INTEGRATION_REPORT.md` §3.1 称本方案新增
> `§9.1.1 定时器与状态失效` —— Spec 中**不存在 §9.1.1**，该功能实际落在 §8.4.1。
> 同报告称的 `§12.1 Snapshot包含pending事件` 实际是 §12.0.1（§12.1 是「版本迁移」）。
> 落点以本节表格为准。

**文档状态**：🗄️ 历史修复方案（已完全闭环）

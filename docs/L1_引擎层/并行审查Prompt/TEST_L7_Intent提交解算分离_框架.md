# TEST_L7 Intent提交-解算分离 测试框架

> **设计日期**: 2026-08-06
> **Spec依据**: §7.6 Intent：已提交但未解算的动作
> **总用例规划**: 40-50条
> **设计方法**: Given-When-Then格式 + 分类组织

---

## 一、测试框架设计

### 1.1 分类与覆盖范围

| 分类 | 测试特性 | 估算用例 |
|------|---------|----------|
| A | 基本提交-解算流转 | 8-10 |
| B | Hidden隐藏与揭示 | 6-8 |
| C | Require重检与TOCTOU | 8-10 |
| D | ResolveOrder排序 | 6-8 |
| E | Conflict冲突消解 | 6-8 |
| F | 与Decision的交互 | 4-6 |
| **总计** | | **40-50** |

### 1.2 关键语义边界

#### A - 基本提交-解算流转

**L7-INT-001: 单Intent正常流转**
```
Given:
  intent_1 = {id:'int_001', agent:'g:p1', action:'d:attack', bindings:{target:'e:2'}, 
              submittedAt:5, status:'pending'}
  ActionDef 'd:attack' = {require: ctx.actor.alive && ctx.target.alive, 
                          effect: [damage.deal({amount:10})]}
When:
  intent.resolve('int_001')  // 手动触发（或自动由schedule推进）
Then:
  ✅ require重检通过 → status变'resolved'
  ✅ effect执行 → e:2扣血
```

**L7-INT-002: Intent超时/过期**
```
Given:
  intent_1 = {submittedAt:5, status:'pending'}
  current phase = 20
  ActionDef.ttl = 10（超时10个phase）
When:
  phase推进至16（超过5+10）
  checkTimeouts()
Then:
  ✅ intent_1.status = 'void'（或自动触发onConflict）
```

**L7-INT-003: Require失败转void**
```
Given:
  intent_1 = {action:'d:heal', bindings:{target:'e:2'}}
  ActionDef 'd:heal' = {require: ctx.target.alive}
  e:2.alive = true （提交时满足）
When:
  e:2被杀死（其他Intent的effect）
  intent.resolve('int_001')  // 先解算其他Intent，再解算int_1
Then:
  ✅ require重检失败 → status='void'
  ✅ 代价被退回（见L7-INT-031）
  ✅ 触发onConflict回调
```

#### B - Hidden隐藏与揭示

**L7-INT-010: 暗押Intent不可见**
```
Given:
  intent_1 = {agent:'g:p1', hidden:true, status:'pending'}
When:
  g:p2.queryActions()  // 查询p2能看到什么Intent
Then:
  ✅ intent_1 不出现在结果中（hidden == true）
  ✅ g:p1.queryActions() 可见自己的hidden Intent
```

**L7-INT-011: Reveal揭示后变可见**
```
Given:
  intent_1 = {hidden:true}
When:
  intent.reveal('int_001')
Then:
  ✅ intent_1.hidden = false
  ✅ 其他agent现在可见
```

**L7-INT-012: Hidden Intent不进Knowledge**
```
Given:
  intent_1 = {agent:'g:p1', hidden:true}
When:
  g:p2尝试知道p1的行动意图
Then:
  ✅ knowledge.g:p2 无法读取 intent_1（未揭示前）
```

#### C - Require重检与TOCTOU

**L7-INT-020: 提交时合法，解算时非法（资源消失）**
```
Given:
  intent_1 = {action:'d:buy', bindings:{item:'i:gun', cost:100}}
  ActionDef 'd:buy' = {require: ctx.actor.gold >= 100 && item.inShop,
                       effect: [cost.freeze(...), item.transfer(...)]}
  e:p1.gold = 100, item.inShop = true （提交时满足）
When:
  其他Intent的effect导致 item从商店移除（inShop = false）
  intent.resolve('int_001')
Then:
  ✅ require重检失败 → status='void'
  ✅ 代价未冻结/已退回
  ✅ item不转移给p1
```

**L7-INT-021: TOCTOU防护 - 代价在解算前被冻结**
```
Given:
  intent_1 = {action:'d:cast', cost:50}  // 法术消耗50金
  cost.freeze('int_001', 50) 已在提交时执行
When:
  其他Intent的effect消耗了actor的金币（但冻结池独立）
  intent.resolve('int_001')
Then:
  ✅ 冻结的50金不受影响 → 可正常结算
  ✅ require检查的是 frozen + unfrozen余额是否足够
```

**L7-INT-022: Actor死亡导致Intent失效**
```
Given:
  intent_1 = {agent:'g:p1', action:'d:heal'}
When:
  其他Intent杀死了p1
  intent.resolve('int_001')
Then:
  ✅ agent失效检查失败 → status='void'
  ✅ 类似L6中的askee失效处理
```

#### D - ResolveOrder排序

**L7-INT-030: 同phase多Intent按priority排序**
```
Given:
  intent_1 = {id:'int_001', action:'d:dodge', priority:50}
  intent_2 = {id:'int_002', action:'d:attack', priority:30}
  schedule.resolveOrder = expr: 'actor.attr.speed'（速度高的先手）
When:
  phase推进，同时触发多个Intent解算
Then:
  ✅ priority已通过schedule.resolveOrder求值填入
  ✅ priority:50的intent_1先解算
  ✅ intent_1的dodge成功 → 减伤 → int_2伤害降低
```

**L7-INT-031: 后发先至（速度低的后手，可反制）**
```
Given:
  intent_1 = {actor:'g:hero', action:'d:attack', speed:3}
  intent_2 = {actor:'g:enemy', action:'d:counterattack', speed:5}
  schedule.resolveOrder = Speed DESC
When:
  intent.resolve按order执行
Then:
  ✅ speed:5的int_2先解算（敌人反制）
  ✅ int_2的effect可能disable英雄 → int_1无法执行
  ✅ 体现"后发先至"的关键特性
```

#### E - Conflict冲突消解

**L7-INT-040: 两人争夺同一资源**
```
Given:
  intent_1 = {actor:'g:p1', action:'d:pickup', target:'i:treasure'}
  intent_2 = {actor:'g:p2', action:'d:pickup', target:'i:treasure'}
  schedule.onConflict = 'first'  // 先手获胜
When:
  两个intent同步提交，同步解算
Then:
  ✅ 按resolveOrder排序
  ✅ 先的拿到→成功，后的require失败→void
  ✅ 后者代价被退回
```

**L7-INT-041: 冲突消解策略多种**
```
Given:
  schedule.onConflict = 'both_fail'  // 冲突时双败
When:
  两个Intent争夺同一资源
Then:
  ✅ 两个都转void
  ✅ 双方代价都被退回
```

#### F - 与Decision交互

**L7-INT-050: Intent出手 → 触发Decision反应**
```
Given:
  intent_1 = {action:'d:attack', target:'e:enemy'}
  反应机制通过Schedule的response相位实现（见L7.5响应相位）
When:
  intent_1进入解算队列
  在解算相位前，response相位检查有无反应Intent
Then:
  ✅ 有反应资格的actor提交反应Intent
  ✅ schedule按优先级排序（响应action可能优先解算）
  ✅ 原攻击可能被反制、被躲避、被减伤
```

---

## 二、推演方法与审查标准

### 2.1 状态机模型

```
          ┌─────────────────┐
          │    pending      │
          │ (已提交，待解算)  │
          └────────┬────────┘
                   │
        ┌──────────┼──────────┐
        │          │          │
        ▼          ▼          ▼
    ┌────────┐ ┌────────┐ ┌────────┐
    │resolved│ │ failed │ │  void  │
    │(成功)  │ │(require) │ (冲突/超时)
    └────────┘ └────────┘ └────────┘
```

每个状态转换都对应：
- 前置条件检查
- 代价冻结/释放
- Effect执行/回滚
- onConflict触发（void时）

### 2.2 缺口预期与分级

**P0（关键机制）**:
- 提交vs解算的状态转换机制
- 代价冻结与解算的原子性
- Require重检与TOCTOU防护
- Hidden隐藏机制

**P1（交互规则）**:
- ResolveOrder排序与优先级
- onConflict多策略支持
- 与Decision响应相位的集成

**P2（扩展）**:
- 存档/恢复Intent状态
- AI搜索中的Intent探路
- TTL超时处理规则

---

## 三、后续TEST_L7推演计划

1. **Week 1 Day 1**: 完成A分类（基础流转）逐条推演
2. **Week 1 Day 2**: 完成B+C分类（Hidden + TOCTOU）
3. **Week 1 Day 3**: 完成D+E分类（排序+冲突）
4. **Week 1 Day 4**: 完成F分类（与其他层交互）
5. **Week 1 Day 5**: 缺口汇总+修复设计

**目标**: L7总PASS率≥60%（同L3/L4基准）

---

**状态**: 🗄️ 历史归档 —— 框架设计完成，**但从未按本框架做手工推演**

---

## 归档说明（2026-08-07）

**本框架未被执行，Intent 已由另一条路径完整覆盖，不是空档。**

| 项 | 说明 |
|---|---|
| 为什么没执行 | 阶段三改用「代码实现 + fast-check 属性测试」，不再做手工推演 |
| Intent 实际归属 | **属性实测轴的 L10**（本文件的"L7"属废弃的编号方案 D） |
| 实际交付 | `kernel-l10-test`：14 项命名测试、约 31 万次属性推演，**全部 PASS** |
| 报告 | [`TEST_L10_审查结果报告.md`](TEST_L10_审查结果报告.md) + `kernel-l10-test/L10_TEST_REPORT.md` |
| 发现并修复的缺陷 | 3 处，均可绕过 INV-12（冻结量守恒）：同 Intent 内重复 pool 的 cost 未合并计算导致冻结超额、重复 id 的 submit 静默覆盖造成资源泄漏、负数 cost 未被拒绝 |
| Spec 落点 | §7.6 Intent（Spec:1683）+ §7.5.1 反应技为什么不能在 Hook 里问（Spec:1640） |

**本框架 §一 覆盖的测试维度与实际执行情况对照**：

- **提交 vs 解算分离、代价冻结与解算的原子性** → ✅ 已覆盖（属性 #1~#4，INV-12 守恒）
- **Require 重检与 TOCTOU 防护** → ✅ 已覆盖（边界 #6「require 失败时 Intent 变为 void，资源退回」、
  #9「actor 销毁后 resolve 返回 void」）
- **Hidden 隐藏机制 / ResolveOrder / onConflict** → ⚠️ **未被 L10 属性测试单独覆盖**；
  `intent.reveal` 已实现并接入 veto 分发，Spec §7.6 也有定义，但排序与冲突策略的专项测试缺失
  —— 属"有规范无测试"，已登记为 [`00_开放事项跟踪.md`](00_开放事项跟踪.md) 的 **T-12**
- **与 Decision 响应相位的集成** → ⚠️ 跨层，属于跨层门禁范围 → 跟踪项 **T-03②**
- **存档/恢复 Intent 状态** → ✅ 由 `kernel-l12-test` 的 checkpoint/restore 往返一致性覆盖

层编号映射见 [`00_状态基线.md`](00_状态基线.md) §2.1。

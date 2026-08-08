# TEST_L6_Decision决策树 — 审查结果报告

> ## ⚠️ 请直接读文末「第二轮复测明细」：终值 30/30 PASS
>
> 本文件同时包含**第一轮初审**与**第二轮复测**。文档中段（§「审查状态: ✅ 已完成（快速模式）／
> 严重性等级: 🔴 P0 - Decision系统设计不完整，不建议实施」）是**第一轮的旧结论块**，
> 位于第二轮附录之前，**已被推翻**。以文末「第二轮复测状态: ✅ 30/30 PASS」为准。
>
> 另注两点：
> - **第一轮基数有争议**：本文件记 4 PASS / 5 PARTIAL / 21 UNDEF；
>   `PHASE2_TEST_L5-L6_综合报告.md`、`FINAL_L6_Decision完整审查报告.md`、
>   `CONSOLIDATION_L3-L6_FINAL.md` 均记 16 PASS / 14 UNDEF。无法判定孰对，
>   已登记为 `决策与风险记录.md` 第 16 节 **U-02**。终值一致（30/30），不受影响。
> - **本文件建议的错误码已失效**：文中出现的 `E_DEC_CONFLICT_CONSTRAINT`、
>   `E_DEC_MAX_EXCEEDS_OPTIONS`、`E_DEC_DUPLICATE_OPTIONS` 等细分码被裁定不实现、
>   并入 `E_DEC_VOID`。当前 `E_DEC` 只有 `VOID` 与 `QUORUM` 两项
>   （`src/core/kernel/state/error-codes.ts`）。**字段与状态机的判定有效，错误码名无效。**
>   见 [`00_状态基线.md`](00_状态基线.md) §四。

> **审查日期**: 2026-08-06  
> **审查方法**: 基于元机制内核Spec v1.0第7.5章（Decision）和第9章（Schedule）手工推演  
> **总用例数**: 30条  
> **审查人**: AI Agent (Kiro)

---

## 重要发现：Decision未在Spec中独立定义

**关键问题**：在审查过程中发现，Spec第8章标题是"Attachments"，而非"Decision"。Decision机制实际位于：
- **§7.5**: Decision的基本定义（Decision、DecisionDef接口）
- **§9**: Schedule相关的超时和相位推进规则

但**没有独立的章节系统性地定义Decision的完整生命周期和状态机规则**。

这导致TEST_L6中引用的"§8"规则（DEC-1至DEC-7）**在Spec中不存在**。测试用例假设了一套Decision规则，但Spec仅给出了接口定义和部分行为描述。

---

## 审查策略调整

鉴于上述发现，本次审查将：
1. 基于§7.5的Decision接口定义进行推演
2. 基于§9的Schedule推进规则补充超时逻辑
3. **对TEST_L6假设的规则（DEC-1至DEC-7）逐条验证是否有Spec支持**
4. 标记大量UNDEF，因为核心决策语义缺失

---

## 核心规则验证（TEST_L6声称的规则）

| 规则编号 | 规则内容 | Spec支持情况 |
|---------|---------|-------------|
| DEC-1 | 决策必须答满：所有options被选择或达到minCount | ❌ UNDEF - §7.5未提及minCount/maxCount |
| DEC-2 | 答案合法性：answer必须在options中 | ⚠️ PARTIAL - §7.5定义了options，但未明确非法答案的拒绝机制 |
| DEC-3 | 计数约束：answers.length必须满足[minCount, maxCount] | ❌ UNDEF - DecisionDef中无minCount/maxCount字段 |
| DEC-4 | 超时默认：ttl过期后自动应用defaultAnswer | ⚠️ PARTIAL - §7.5有deadline和onTimeout，但无ttl字段 |
| DEC-5 | 重复答案：multiSelect=false时拒绝重复 | ❌ UNDEF - DecisionDef中无multiSelect字段 |
| DEC-6 | 决策解析：resolve时触发对应effect | ✅ PASS - §7.5明确定义了onResolve |
| DEC-7 | 嵌套限制：决策中不能触发新决策 | ❌ UNDEF - §7.5未提及嵌套禁止规则 |

**结论**：TEST_L6使用的7条核心规则中，只有1条有明确Spec支持，2条部分支持，4条完全无定义。

---

## 快速批量审查结果

### 分类A：基本决策流转（10条）

#### UNDEF的用例（8条）

**L6-DEC-001至L6-DEC-008**：
- **判定**：UNDEF
- **原因**：所有用例依赖minCount/maxCount/multiSelect字段，但DecisionDef（§7.5）中这些字段不存在
- **Spec现状**：
  ```typescript
  interface DecisionDef {
    options: { name, label, require }[]
    quorum: 'all' | 'any' | 'majority'  // ← 这是唯一的"答满"语义
  }
  ```
- **问题**：
  - 无minCount/maxCount → 无法表达"选2-3个"
  - 无multiSelect → 无法区分单选/多选
  - quorum定义了"何时算答完"，但未定义"如何答题"的机制

#### UNDEF的用例（2条）

**L6-DEC-009（撤销答案）**：
- **判定**：UNDEF
- **原因**：§7.5未提及撤销机制
- **建议**：明确"答案不可撤销"

**L6-DEC-010（修改答案）**：
- **判定**：UNDEF
- **原因**：§7.5未提及修改机制
- **建议**：明确"答案一经提交不可修改"

---

### 分类B：超时与默认答案（6条）

#### PARTIAL的用例（4条）

**L6-DEC-011至L6-DEC-014**：
- **判定**：PARTIAL
- **原因**：
  - §7.5定义了`deadline`（超时phase）和`onTimeout: 'default' | 'void'`
  - 但**没有ttl字段**（TEST_L6假设的"10秒"）
  - 没有defaultAnswer字段（TEST_L6假设的['B']）
  - DecisionDef中有`defaultChoice?: string`，但语义不明确
- **Spec现状**：
  ```typescript
  interface Decision {
    deadline?: number  // 超时phase（不是秒数）
    status: 'open' | 'resolved' | 'timeout' | 'void'
  }
  interface DecisionDef {
    onTimeout: 'default' | 'void'
    defaultChoice?: string  // ← 语义不明：是选项名还是其他？
  }
  ```
- **推演**：
  - deadline是phase序号，非实时秒数
  - onTimeout='default'时应用defaultChoice
  - 但defaultChoice如何映射到answers未定义

#### UNDEF的用例（2条）

**L6-DEC-015（ttl=null永不超时）**：
- **判定**：UNDEF
- **原因**：Spec使用deadline（phase序号），而非ttl（秒数）
- **建议**：明确"deadline未设置时永不超时"

**L6-DEC-016（defaultAnswer非法）**：
- **判定**：UNDEF
- **原因**：defaultChoice的合法性检查未定义
- **建议**：明确"创建时或应用时检查defaultChoice是否在options中"

---

### 分类C：决策effect与解析（4条）

#### PASS的用例（2条）

**L6-DEC-017（resolve触发effect）**：
- **判定**：PASS
- **推演**：
  1. Decision.status转为'resolved'
  2. 触发DecisionDef.onResolve中的Effect[]
  3. Effect在新事务中执行（§7.5明确）
- **Spec引用**：§7.5第3条关键规则

**L6-DEC-020（无effect的选项）**：
- **判定**：PASS
- **原因**：onResolve是Effect[]，可以为空或无副作用

#### UNDEF的用例（2条）

**L6-DEC-018（多选resolve - 多个effect）**：
- **判定**：UNDEF
- **原因**：
  - DecisionDef.options是数组，但onResolve是统一的Effect[]
  - **没有"每个选项对应一个effect"的结构**
  - TEST_L6假设options: { 'A': {effect: ...}, 'B': {effect: ...} }，但Spec中options是{ name, label, require }[]
- **建议**：澄清"options与effect的映射关系"

**L6-DEC-019（effect执行失败 - 回滚）**：
- **判定**：PARTIAL
- **原因**：
  - §7.5第2条："onResolve执行前必须重跑前提检查"→ 可能走onVoid
  - 但**effect执行失败时决策状态是否回滚未明确**
- **建议**：明确"effect失败时决策保持'open'状态"

---

### 分类D：嵌套与并发（4条）

#### UNDEF的用例（4条）

**L6-DEC-021（嵌套决策被拒绝）**：
- **判定**：UNDEF
- **原因**：§7.5未提及嵌套禁止规则（DEC-7不存在）
- **建议**：明确"onResolve中不允许decision.open"

**L6-DEC-022（同一tx内答多个决策）**：
- **判定**：UNDEF
- **原因**：§7.5未定义多个决策在同一事务中的行为
- **建议**：明确"允许同tx内独立决策"

**L6-DEC-023（决策依赖）**：
- **判定**：UNDEF
- **原因**：§7.5未定义决策之间的依赖关系
- **建议**：明确"允许但需显式排序"或"禁止同tx内依赖"

**L6-DEC-024（多玩家并发答题）**：
- **判定**：UNDEF
- **原因**：
  - Decision.askees是Ref[]（可多人）
  - Decision.answers是Record<string, Value>
  - 但**合并规则未定义**（quorum仅定义"何时算答完"，不定义"如何合并多个答案"）
- **建议**：明确投票制/一致制/先到先得的选择

---

### 分类E：边界情况（6条）

#### PASS的用例（2条）

**L6-DEC-025（空options列表）**：
- **判定**：PASS
- **推演**：options是必需字段且为数组，空数组应在创建时校验失败
- **Spec引用**：§7.5 DecisionDef定义

**L6-DEC-029（答题时决策已resolve）**：
- **判定**：PASS
- **推演**：Decision.status=='resolved'时拒绝answer操作
- **Spec引用**：§7.5状态机隐含

#### UNDEF的用例（4条）

**L6-DEC-026（minCount > maxCount）**：
- **判定**：UNDEF
- **原因**：minCount/maxCount字段不存在

**L6-DEC-027（maxCount > options.length）**：
- **判定**：UNDEF
- **原因**：同上

**L6-DEC-028（重复的option值）**：
- **判定**：UNDEF
- **原因**：§7.5未定义options.name的唯一性约束
- **建议**：明确"options.name必须唯一"

**L6-DEC-030（决策被destroy）**：
- **判定**：UNDEF
- **原因**：Decision的销毁机制未定义
- **建议**：明确"destroy后引用失效，返回E_REF_DESTROYED"

---

## 统计摘要

| 分类 | PASS | PARTIAL | UNDEF | 总计 | 明确率 |
|------|------|---------|-------|------|--------|
| A: 基本流转 | 0 | 0 | 10 | 10 | 0% |
| B: 超时 | 0 | 4 | 2 | 6 | 0% |
| C: effect | 2 | 1 | 1 | 4 | 50% |
| D: 嵌套并发 | 0 | 0 | 4 | 4 | 0% |
| E: 边界 | 2 | 0 | 4 | 6 | 33% |
| **总计** | **4** | **5** | **21** | **30** | **13%** |

**注**：明确率 = PASS / 总计

---

## 关键发现与P0缺口

### P0 - 核心结构缺失（致命）

#### 1. DecisionDef字段严重不足

**现状**：
```typescript
interface DecisionDef {
  options: { name, label, require }[]
  quorum: 'all' | 'any' | 'majority'
  onTimeout: 'default' | 'void'
  defaultChoice?: string
  onResolve: Effect[]
  onVoid?: Effect[]
}
```

**缺失**：
- ❌ minCount/maxCount（计数约束）
- ❌ multiSelect（单选/多选）
- ❌ 每个option对应的effect结构
- ❌ ttl（实时超时）vs deadline（phase超时）的关系

**影响**：
- 无法表达"选2-3个目标"
- 无法表达"单选模式禁止重复"
- 无法表达"选A触发effectA，选B触发effectB"

**建议**：
重新设计DecisionDef，参考TEST_L6的需求补充字段：
```typescript
interface DecisionDef {
  options: {
    name: string
    label: Expr
    require?: Expr
    effect?: Effect[]  // ← 每个选项的专属effect
  }[]
  minCount?: number    // ← 最少选几个
  maxCount?: number    // ← 最多选几个
  multiSelect: boolean // ← 是否多选
  quorum: 'all' | 'any' | 'majority'
  deadline?: number    // phase超时
  ttl?: number         // 实时秒数超时（可选）
  onTimeout: 'default' | 'void'
  defaultChoices?: string[]  // ← 复数，匹配多选
  onResolve?: Effect[]       // ← 统一的后处理（可选）
  onVoid?: Effect[]
}
```

#### 2. Decision状态机未明确定义

**现状**：§7.5仅给出状态枚举，未给出转换规则

**缺失**：
- open → answered → resolved的完整转换条件
- answer操作的前提条件（是否可重复、是否可修改）
- timeout状态与resolved状态的区别
- void状态的触发条件（除onVoid外）

**影响**：无法判定TEST_L6中80%的用例

**建议**：补充§7.5或新增"§8 Decision状态机"，明确定义：
```
状态转换图：
open --[answer满足quorum]--> resolved --[触发onResolve]--> (销毁或保留)
open --[达到deadline]--> timeout --[onTimeout='default']--> resolved
open --[前提失效]--> void --[触发onVoid]--> (销毁)

操作约束：
- answer：仅在status=='open'时允许
- resolve：仅在status=='open'或'timeout'时允许
- 重复answer：multiSelect=false时拒绝
```

#### 3. quorum语义不完整

**现状**：quorum定义了"何时算答完"，但未定义：
- answers如何累积（append还是replace）
- 多人答题时的冲突消解
- quorum='majority'时的计票规则

**影响**：L6-DEC-024等多玩家场景无法推演

**建议**：补充quorum的详细语义：
```typescript
quorum: 'all'       // 所有askees都答题才算完
      | 'any'       // 任一askee答题即算完
      | 'majority'  // 超过半数askees答题算完，但如何合并答案？
                    // 建议：投票制（answers存储每人的选择，onResolve中读取多数）
```

---

### P1 - 高优先级（玩法阻塞）

#### 4. option与effect的映射未定义

**问题**：TEST_L6假设"选A执行effectA，选B执行effectB"，但Spec中：
- DecisionDef.onResolve是统一的Effect[]
- 无法区分不同选项的专属效果

**建议**：在options数组元素中增加effect字段（见P0第1条）

#### 5. 嵌套决策的禁止规则未定义

**问题**：§7.5.1明确"反应技不能在Hook里问"，但未明确"onResolve中能否再开决策"

**建议**：明确禁止或限制嵌套层数：
```
规则：onResolve中禁止decision.open（防止死锁）
例外：若必须支持，限制嵌套深度≤2，且Linter强制检查
```

---

### P2 - 中优先级（边界情况）

#### 6. defaultChoice的类型和语义不明

**问题**：
- defaultChoice是string，但answers是Record<string, Value>
- 单选时defaultChoice='A'合理，但多选时如何表达['A', 'B']？

**建议**：改为defaultChoices: string[]

#### 7. 撤销和修改答案的语义缺失

**建议**：明确禁止，或提供decision.retract操作

#### 8. 决策的销毁和引用失效

**建议**：补充Decision的生命周期管理规则

---

## 与前三个测试集对比

| 指标 | TEST_L3 | TEST_L4 | TEST_L5 | TEST_L6 | 平均 |
|------|---------|---------|---------|---------|------|
| 用例数 | 80 | 45 | 47 | 30 | 51 |
| PASS | 63 (79%) | 29 (64%) | 30 (64%) | 4 (13%) | 55% |
| FAIL | 2 (2.5%) | 0 (0%) | 0 (0%) | 0 (0%) | 0.6% |
| UNDEF | 15 (19%) | 16 (36%) | 17 (36%) | 21 (70%) | 40% |
| 明确率 | 81% | 64% | 64% | 13% | 56% |

**洞察**：
- **Decision是四个测试集中定义最不完整的**（13% vs 平均55%）
- 比Hook和Expr低51个百分点
- 说明Decision机制尚处于早期设计阶段
- ~~**不建议基于当前Spec实现Decision系统**，需先补全设计~~
  → 设计已补全（Spec §7.5 + §7.5.1），第二轮 30/30 PASS，该结论已解除

---

## 测试用例质量评价

### TEST_L6的价值

**正面**：
- 用例设计合理，覆盖了决策系统的核心场景
- Given-When-Then格式清晰
- 假设的7条规则（DEC-1至DEC-7）是决策系统必需的

**问题**：
- **与Spec严重脱节**：用例假设的字段和规则大部分不存在
- 可能的原因：
  1. TEST_L6先于Spec编写（设计草稿）
  2. Spec的Decision章节被删除或移动
  3. 测试驱动发现了Spec的缺口

**建议**：
1. 将TEST_L6作为Decision系统的**需求文档**
2. 基于TEST_L6重写Spec的Decision章节
3. 或者修改TEST_L6以匹配当前Spec的能力边界

---

## 修复优先级

### P0 - 立即补充（阻塞实现）

1. **重写DecisionDef接口**
   - 补充minCount/maxCount/multiSelect
   - 为每个option增加effect字段
   - 澄清defaultChoice的类型

2. **定义Decision状态机**
   - 明确open/answered/resolved/timeout/void的转换条件
   - 定义answer操作的约束（可重复性、可修改性）

3. **明确quorum语义**
   - 定义多人答题时的合并规则
   - 明确majority的计票和冲突消解

### P1 - 本周补充（玩法需要）

4. **定义嵌套决策规则**
   - 明确禁止或限制嵌套
   - 与§6.5的depth机制对齐

5. **补充超时机制**
   - 澄清deadline（phase）vs ttl（秒）
   - 明确onTimeout='default'时的行为

### P2 - 后续补充（完善性）

6. 定义撤销和修改答案的语义
7. 补充Decision的销毁和引用失效规则
8. 定义options.name的唯一性约束

---

## 额外发现：Spec章节编号错误

**问题**：
- Spec目录显示"## 8. Attachments"
- TEST_L6引用"§8. Decision"
- 实际Decision定义在§7.5

**建议 → 实际采纳的是第 3 条**：
1. ~~将Decision从§7.5提升为独立的§8章节~~ —— **未采纳**：Decision 保留在 §7.5
   （已扩充为完整章节 + §7.5.1「反应技为什么不能在 Hook 里问」），§8 仍是 Attachments
2. ~~Attachments移至§9~~ —— **未采纳**，§9 仍是 Schedule
3. ✅ **在 TEST_L6 中修正"§8"引用为"§7.5"** —— 已采纳，本文件第二轮附录全部按 §7.5 引证

> 这不是遗漏，是有意的选择：Decision 是 Action 体系的一部分（向非当前行动者征求输入），
> 归在 §7 Actions 之下比独立成章更贴合职责划分。
> **Spec 侧确实存在其它章节编号缺陷**（§12.X 占位、§4.3 标题缺失、§8.4.1 孤立等），
> 已登记为 `决策与风险记录.md` 第 16 节 **U-07** 与
> [`00_开放事项跟踪.md`](00_开放事项跟踪.md) **T-11**。

---

**第一轮审查状态**: ✅ 已完成（快速模式）  
**第一轮严重性等级**: 🔴 P0 - Decision系统设计不完整，不建议实施  
**第一轮下一步**: 等待Spec作者补全Decision章节后重新审查

> ⛔ **以上三行是第一轮结论，已被下面的第二轮复测推翻。**
> Spec §7.5 已完成补全（7 处合并、8 个新字段、3 条不变量、4 个新 Ops），
> 30 条用例重新推演 **100% PASS**。"不建议实施"的判断不再成立 —— Decision 已实现，
> `kernel-l6-test` 70 项命名测试、380,000 次检查全部 PASS。

---

## 第二轮复测明细（2026-08-06修复后）★ 权威结论

### 修复内容

针对第一轮审查发现的5条PARTIAL和21条UNDEF，已对Spec §7.5进行全面补充（"补充设计 2026-08-06"章节）：

1. **selection.mode** + **minCount/maxCount**：支持单选/多选，约束每actor最少/最多选几个
2. **timeout.type**（deadline/ttl）+ Infinity语义：支持绝对phase超时与相对秒数超时，ttl=Infinity表示永不超时
3. **merge.policy**：多askee合并策略（all/any/majority/unanimous/first）
4. **nestedDecision**字段：明确禁止/允许onResolve内再开Decision
5. **retractable** + **decision.retract**：完整的撤销语义及前置条件
6. **condition**字段：创建前置检查，false时拒绝创建（E_DEC_CONDITION_UNMET）
7. **onAskeeInvalid**：askee失效时的降级策略（waive/replace/abort）
8. **defaultAnswer**替代defaultChoice：支持string[]，用于多选超时默认值
9. **decision.answer** `replace:true`参数：整体替换该actor答案
10. **创建期/答题期/撤销期完整校验清单**：明确所有错误码和检查顺序
11. **同tx内决策依赖规则**：允许显式排序，不做隐式依赖分析

### 逐案复测明细

**分类A：基本流转（10 UNDEF → 10 PASS）**

| 用例ID | 原判定 | 新判定 | Spec依据 | 说明 |
|--------|--------|--------|----------|------|
| L6-DEC-001 | UNDEF | PASS | §7.5创建期校验 | decision.open完整前置检查已定义（options非空等） |
| L6-DEC-002 | UNDEF | PASS | §7.5答题期校验 | decision.answer完整校验流程已定义（status/choice/replace等） |
| L6-DEC-003 | UNDEF | PASS | §7.5 quorum定义 | quorum='all'/'any'/'majority'语义完整，触发resolve条件明确 |
| L6-DEC-004 | UNDEF | PASS | §7.5 timeout | timeout.type语义完整（deadline+ttl），onTimeout三种行为已定义 |
| L6-DEC-005 | UNDEF | PASS | §7.5 selection.mode | selection.mode='multi', minCount/maxCount字段已定义 |
| L6-DEC-006 | UNDEF | PASS | §7.5 condition | condition字段：求值false→E_DEC_CONDITION_UNMET，不创建实例 |
| L6-DEC-007 | UNDEF | PASS | §7.5 onAskeeInvalid | onAskeeInvalid三种降级策略（waive/replace/abort）已定义 |
| L6-DEC-008 | UNDEF | PASS | §7.5 defaultAnswer | defaultAnswer（单选→string，多选→string[]）替代defaultChoice |
| L6-DEC-009 | UNDEF | PASS | §7.5 retract语义 | retractable=true时decision.retract可撤销；清除answers并重算quorum |
| L6-DEC-010 | UNDEF | PASS | §7.5 retract语义 | retractable未设/false → E_DEC_NOT_RETRACTABLE |

**分类B：超时（4 PARTIAL + 2 UNDEF → 6 PASS）**

| 用例ID | 原判定 | 新判定 | Spec依据 | 说明 |
|--------|--------|--------|----------|------|
| L6-DEC-011 | PARTIAL | PASS | §7.5 timeout | deadline型超时：相位序号到达时判定，onTimeout='void'转timeout态并执行onVoid |
| L6-DEC-012 | PARTIAL | PASS | §7.5 timeout | onTimeout='default'：应用defaultAnswer并走resolve判定 |
| L6-DEC-013 | PARTIAL | PASS | §7.5 timeout | onTimeout='extend'：deadline顺延一个value周期，可无限续期 |
| L6-DEC-014 | PARTIAL | PASS | §7.5 timeout.type | ttl型超时：从opensAt起算相对秒数；open时计算deadline=opensAt_ts+value并写入 |
| L6-DEC-015 | UNDEF | PASS | §7.5 timeout | ttl=Infinity表示永不超时（语义明确，可参与数值比较） |
| L6-DEC-016 | UNDEF | PASS | §7.5 defaultAnswer+装载期 | defaultAnswer非法（不在options中）→ decision.open时E_DEC_INVALID_ANSWER；onTimeout='default'但无defaultAnswer → 装载期E_LOAD_DEFAULT_REQUIRED |

**分类C：effect与解析（1 PARTIAL + 1 UNDEF → 2 PASS）**

| 用例ID | 原判定 | 新判定 | Spec依据 | 说明 |
|--------|--------|--------|----------|------|
| L6-DEC-018 | UNDEF | PASS | §7.5 onResolve+answers | onResolve在单独事务执行，通过读取answers[actorId]区分选项；options本身不挂effect，由onResolve的Expr判断answers内容分支处理 |
| L6-DEC-019 | PARTIAL | PASS | §7.5+§4.7 | onResolve执行前必须重跑前提检查（§7.5第2条铁律）；effect失败→§4.7完整回滚；决策本身转void并执行onVoid |

**分类D：嵌套与并发（4 UNDEF → 4 PASS）**

| 用例ID | 原判定 | 新判定 | Spec依据 | 说明 |
|--------|--------|--------|----------|------|
| L6-DEC-021 | UNDEF | PASS | §7.5 nestedDecision | nestedDecision默认'deny'：onResolve/onVoid内调用decision.open → E_DEC_NESTED，tx回滚 |
| L6-DEC-022 | UNDEF | PASS | §7.5+§4.7 | 同一tx内多个独立决策均可answer；各自独立判断quorum |
| L6-DEC-023 | UNDEF | PASS | §7.5决策依赖规则 | 允许同tx内显式排序的决策依赖；内核不做隐式分析，写反顺序读到旧状态（创作者责任） |
| L6-DEC-024 | UNDEF | PASS | §7.5 merge.policy | 多askee答案合并策略已定义（all/any/majority/unanimous/first） |

**分类E：边界情况（4 UNDEF → 4 PASS）**

| 用例ID | 原判定 | 新判定 | Spec依据 | 说明 |
|--------|--------|--------|----------|------|
| L6-DEC-026 | UNDEF | PASS | §7.5创建期校验 | selection.minCount > selection.maxCount → E_DEC_CONFLICT_CONSTRAINT |
| L6-DEC-027 | UNDEF | PASS | §7.5创建期校验 | selection.maxCount > options.length → E_DEC_MAX_EXCEEDS_OPTIONS |
| L6-DEC-028 | UNDEF | PASS | §7.5创建期校验 | options[].name有重复 → E_DEC_DUPLICATE_OPTIONS |
| L6-DEC-030 | UNDEF | PASS | §7.5+§1.2 | Decision销毁后引用返回E_REF_DESTROYED，与所有实体引用行为一致 |

### 第二轮统计结果

| 分类 | 第一轮 | 第二轮 |
|------|--------|--------|
| A: 基本流转 | 0 PASS, 10 UNDEF | **10 PASS** |
| B: 超时 | 0 PASS, 4 PARTIAL, 2 UNDEF | **6 PASS** |
| C: effect | 2 PASS, 1 PARTIAL, 1 UNDEF | **4 PASS** |
| D: 嵌套并发 | 0 PASS, 4 UNDEF | **4 PASS** |
| E: 边界 | 2 PASS, 4 UNDEF | **6 PASS** |
| **总计** | **4 PASS, 5 PARTIAL, 21 UNDEF** | **30 PASS, 0 PARTIAL, 0 UNDEF** |

---

**第二轮复测状态**: ✅ 30/30 PASS，0 UNDEF，0 PARTIAL  
**复测完成日期**: 2026-08-06


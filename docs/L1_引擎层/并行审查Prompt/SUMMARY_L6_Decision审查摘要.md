# L6 Decision决策树审查 - 执行摘要

> ## 🗄️ 第一轮摘要，已闭环
>
> **L6 终值：30/30 PASS**，见
> [`FINAL_L6_Decision完整审查报告.md`](FINAL_L6_Decision完整审查报告.md) 与
> [`TEST_L6_审查结果报告.md`](TEST_L6_审查结果报告.md)「第二轮复测明细」。
> 文末「后续行动清单」的 5 项已全部处理并就地标注（其中"补充 E_DEC_* 错误码"一项
> 执行后又被实现阶段推翻）。当前口径见 [`00_状态基线.md`](00_状态基线.md)。

## 审查概况

- **审查时间**：2026-08-06
- **测试用例数**：30条
- **Spec依据**：§7.5 Decision：向非当前行动者征求输入
- **审查方法**：逐条手工推演 + 状态机分析

---

## 审查结果统计

| 判定 | 数量 | 占比 | 说明 |
|------|------|------|------|
| **PASS** | 16 | 53.3% | 推演正确，符合Spec定义 |
| **UNDEF** | 14 | 46.7% | Spec未定义或测试假设与Spec不符 |
| **FAIL** | 0 | 0% | 无违反Spec规则的用例 |
| **总计** | 30 | 100% | |

### 分类明细

| 分类 | PASS | UNDEF | 总计 |
|------|------|-------|------|
| A - 基本决策流转 | 2 | 8 | 10 |
| B - 超时与默认答案 | 4 | 2 | 6 |
| C - 决策effect与解析 | 3 | 1 | 4 |
| D - 嵌套与并发 | 4 | 0 | 4 |
| E - 边界情况 | 3 | 3 | 6 |

---

## 🔴 关键发现：测试用例与Spec存在结构性差异

### 核心问题

**测试用例基于一个与当前Spec（§7.5）不符的Decision设计模型。**

### 差异对比

| 维度 | 测试用例假设 | Spec v1.0 实际定义 | 兼容性 |
|------|-------------|-------------------|--------|
| **选项约束** | `minCount`, `maxCount` | `quorum: 'all'/'any'/'majority'` | ❌ 不兼容 |
| **超时机制** | `ttl: 10`（相对秒数） | `deadline: 15`（绝对phase序号） | ❌ 不兼容 |
| **默认答案** | `defaultAnswer: ['B']`（数组） | `defaultChoice: 'B'`（单值） | ❌ 不兼容 |
| **答案存储** | `answer: []`（数组） | `answers: {actorId: choice}`（Record） | ❌ 不兼容 |
| **多选支持** | `multiSelect: boolean` | 无此字段 | ❌ 缺失 |
| **状态机** | `open/answered/resolved` | `open/resolved/timeout/void` | ⚠️ 部分重叠 |

### 示例对比

**测试用例假设的结构**：
```typescript
decision_1 = {
  options: ['A', 'B', 'C'],
  minCount: 1,
  maxCount: 1,
  multiSelect: false,
  answer: [],
  ttl: 10,
  defaultAnswer: ['B']
}
```

**Spec §7.5 实际定义**：
```typescript
Decision {
  def: DefId,              // 指向DecisionDef
  askees: Ref[],           // 被询问者列表
  answers: Record<string, Value>,  // actorId → choice
  deadline?: number,       // 绝对phase序号
  status: 'open' | 'resolved' | 'timeout' | 'void'
}

DecisionDef {
  options: { name: string, label: Expr, require?: Expr }[],
  quorum: 'all' | 'any' | 'majority',
  onTimeout: 'default' | 'void',
  defaultChoice?: string,
  onResolve: Effect[],
  onVoid?: Effect[]
}
```

---

## 📋 详细发现清单

### 1. 完全通过的用例（16条）

✅ **状态机基础流转**：
- L6-DEC-002: 提交时自动resolve
- L6-DEC-003: 非法答案被拒绝

✅ **超时处理**：
- L6-DEC-012: 无defaultChoice时走void
- L6-DEC-013: 在deadline内答题
- L6-DEC-014: deadline=opensAt立即超时
- L6-DEC-015: deadline=null永不超时
- L6-DEC-016: defaultChoice非法在加载期拒绝

✅ **Effect执行**：
- L6-DEC-017: resolve触发onResolve
- L6-DEC-019: effect失败回滚
- L6-DEC-020: 空effect正常

✅ **并发与独立性**：
- L6-DEC-021: 嵌套Decision不阻塞（Spec设计避免）
- L6-DEC-022: 同tx内答多个Decision
- L6-DEC-024: 多玩家并发答题（quorum机制）

✅ **边界检查**：
- L6-DEC-025: 空options加载期拒绝
- L6-DEC-029: 已resolved拒绝再答

### 2. Spec未定义的行为（14条）

#### 2.1 结构不匹配（8条）

| 用例 | 测试假设 | Spec状态 | 建议 |
|------|---------|---------|------|
| L6-DEC-001 | `minCount/maxCount` | 无此机制 | 映射到quorum |
| L6-DEC-004 | `multiSelect=false`重复答案 | 无multiSelect | 明确修改规则 |
| L6-DEC-005 | 单actor选多个 | 不支持 | 扩展count字段 |
| L6-DEC-006 | 未答满minCount | 映射到quorum未满 | 调整测试 |
| L6-DEC-007 | 超过maxCount | 无maxCount | 扩展或标记不支持 |
| L6-DEC-008 | 重复选同一选项 | 无单actor多选 | 同DEC-005 |
| L6-DEC-009 | 撤销答案 | 未提及 | 明确不可撤销 |
| L6-DEC-010 | 修改答案 | 未提及 | 明确修改规则 |

#### 2.2 设计细节缺失（6条）

| 用例 | 问题 | 建议 |
|------|------|------|
| L6-DEC-011 | per-option effect | 明确onResolve内条件分支 |
| L6-DEC-018 | 多选effect顺序 | 同上 |
| L6-DEC-023 | 同tx内Decision依赖 | 明确"各自独立事务" |
| L6-DEC-026/027 | count约束检查 | 加载期校验（若支持） |
| L6-DEC-028 | options.name唯一性 | 加载期强制唯一 |
| L6-DEC-030 | Decision销毁 | 定义生命周期规则 |

---

## 🎯 核心建议

### 优先级1：对齐测试用例与Spec（Critical）

**行动**：重写30条测试用例以匹配§7.5定义

**需要调整的概念**：
```
minCount/maxCount → quorum机制
ttl（相对） → deadline（绝对phase）
defaultAnswer（数组） → defaultChoice（单值）
answer（数组） → answers（Record<actorId, choice>）
multiSelect → 多askees或扩展Spec
```

**工作量估算**：
- 完全重写：10条（分类A）
- 部分调整：6条（分类B、C）
- 保持不变：14条（分类D、E大部分）

### 优先级2：补充Spec未定义的行为（High）

**建议在§7.5补充**：

1. **答案修改规则**：
   ```typescript
   // 建议：答案一经提交不可修改
   // 或：resolve前同一actor可修改答案（后者覆盖前者）
   ```

2. **单actor多选支持**：
   ```typescript
   interface DecisionDef {
     options: {...}[],
     count?: { min: number, max: number }  // 每个actor可选数量
   }
   ```

3. **options唯一性约束**：
   ```typescript
   // 加载期校验：options[].name必须唯一
   ```

4. **askee失效处理**：
   ```typescript
   // askee掉线/死亡时：
   // - quorum:'all' → 降级为'any'或timeout
   // - 或保持等待直到deadline
   ```

### 优先级3：补充错误码和加载期校验（Medium）

**建议补充到§13.4**：
```typescript
E_DEC_INVALID_ANSWER      // choice不在options中
E_DEC_ALREADY_RESOLVED    // 尝试answer已resolved的Decision
E_DEC_QUORUM_NOT_MET      // quorum未达成
E_DEC_INVALID_ASKEE       // askee不在askees中
E_LOAD_INVALID_DECISION   // DecisionDef校验失败
E_LOAD_DUPLICATE_OPTION   // options.name重复
```

**建议补充到§13.7加载期校验**：
```typescript
DecisionDef校验：
- options不能为空
- options[].name必须唯一
- defaultChoice必须在options中（若定义）
- quorum必须是合法枚举值
- onTimeout='default'时defaultChoice不能为null
```

---

## ✅ Spec设计优势确认

**测试揭示的Spec优秀设计**：

1. ✅ **非阻塞设计**：`decision.open`永不阻塞，避免死锁
   - L6-DEC-021验证：嵌套Decision不造成阻塞

2. ✅ **可存档性**：Decision是状态对象，不是协程
   - L6-DEC-022验证：可在任意状态存档

3. ✅ **事务安全**：onResolve独立事务 + 前提重检
   - L6-DEC-019验证：effect失败自动回滚

4. ✅ **并发正确性**：quorum机制清晰
   - L6-DEC-024验证：多玩家答题无竞态

5. ✅ **AI友好**：待答Decision进入queryActions
   - Spec设计支持，测试未覆盖（建议补充）

---

## 📊 测试覆盖度分析

### 已覆盖的Spec特性

| Spec特性 | 覆盖用例 | 覆盖度 |
|---------|---------|--------|
| 基本answer流程 | DEC-001~003 | ✅ 充分 |
| deadline超时 | DEC-011~016 | ✅ 充分 |
| onResolve执行 | DEC-017~020 | ✅ 充分 |
| quorum机制 | DEC-024 | ⚠️ 仅1条 |
| 并发安全 | DEC-022, 024 | ⚠️ 有限 |
| 边界检查 | DEC-025~030 | ✅ 充分 |

### 未覆盖的Spec特性（建议补充）

❌ **quorum变体**：
- 'any'：任一答复即resolve
- 'majority'：多数胜出规则

❌ **onVoid流程**：
- 前提失效时的回滚

❌ **AI自动应答**：
- 待答Decision进入queryActions

❌ **存档/恢复**：
- Decision待答期间存档

❌ **与Intent交互**：
- Decision在响应相位的使用

---

## 🔧 修正示例

### 示例1：L6-DEC-001重写

**原测试**：
```typescript
Given:
  decision_1 = {
    options: ['A', 'B', 'C'],
    minCount: 1,
    maxCount: 1,
    answer: []
  }
When:
  decision.answer({ id: 'dec_001', choice: 'B' })
Then:
  decision_1.answer == ['B']
```

**符合Spec的版本**：
```typescript
Given:
  decision_1 = {
    def: 'd:choice_abc',
    askees: [{$:'g:p1'}],
    answers: {},
    status: 'open'
  }
  DecisionDef 'd:choice_abc' = {
    options: [{name:'A'}, {name:'B'}, {name:'C'}],
    quorum: 'all'
  }
When:
  decision.answer('dec_001', 'g:p1', 'B')
Then:
  decision_1.answers == {'g:p1': 'B'}
  decision_1.status == 'resolved'  // quorum满足
  触发DecisionDef.onResolve
```

### 示例2：L6-DEC-011超时重写

**原测试**：
```typescript
Given:
  ttl: 10,
  defaultAnswer: ['B']
When:
  等待11秒
Then:
  decision_1.answer == ['B']
```

**符合Spec的版本**：
```typescript
Given:
  decision_1 = {
    opensAt: 5,
    deadline: 15,  // 绝对phase
    answers: {}
  }
  DecisionDef.onTimeout = 'default'
  DecisionDef.defaultChoice = 'B'
When:
  phase推进至16（超过deadline）
Then:
  未答askees自动填入defaultChoice
  decision_1.answers == {'g:p1': 'B', ...}
  decision_1.status == 'timeout'
  触发onResolve
```

---

## 📝 后续行动清单（已全部处理，2026-08-07 结项）

### 立即行动（1周内）

- [x] **更新测试用例**：重写30条以匹配§7.5 —— **未按"重写用例"执行，改为反向修 Spec**：
  经 `DESIGN_Decision补充设计.md` + `DECISION_重新设计方案.md` 判定，测试假设的
  「单actor多选 + 相对超时」与 Spec 的「多askee单选 + 绝对超时」是**正交而非冲突**的维度，
  因此扩充 Spec 同时支持两者（`selection.mode`、`timeout.type`），30 条用例原样复测 30/30 PASS。
  这比重写用例更彻底 —— 详见 `FINAL_L6_Decision完整审查报告.md`
- [x] **补充Spec文档**：在§7.5补充4项未定义行为 —— 全部已补
  - 答案修改规则 → `decision.retract` + `answer(replace)`
  - 单actor多选（count字段）→ `selection.mode/minCount/maxCount`
  - options唯一性 → 创建期校验
  - askee失效处理 → `onAskeeInvalid: 'waive'|'replace'|'abort'`

### 短期行动（2-4周）

- [x] **扩展测试覆盖**：补充5-10条新用例 —— **已被更大范围的属性测试取代**：
  `kernel-l6-test` 实测 70 项命名测试 / 21 组属性测试 / 380,000 样本 / 49 个确定性边界用例，
  覆盖率 Statements 98.63%、Branches 97.82%、Functions 100%。
  过程中发现并修复 1 个真实缺陷：**超时默认答案可绕过 `minCount`，
  使 `resolve()` 提前放行答案不足的 Decision**
- [x] ⚠️ **补充错误码：在§13.4添加E_DEC_*系列** —— **已执行后又被推翻**：
  当时确实新增了 19 条 `E_DEC_*`，但实现阶段裁定不实现、全部并入 `E_DEC_VOID`
  的更宽语义。当前 `E_DEC` 只有 `VOID` 与 `QUORUM`
  （`src/core/kernel/state/error-codes.ts`）。见 [`00_状态基线.md`](00_状态基线.md) §四

### 中期行动（1-2月）

- [x] **集成测试**：Decision与其他系统交互 —— 已覆盖
  - 与Intent配合（响应相位）→ Spec §7.5.1 + `kernel-l10-test`（Intent，14/14 PASS）
  - 与Hook配合（before/after decision.answer）→ `decision.answer`/`decision.close`
    已补 `{structural:true}` 接入 veto 分发（见 `决策与风险记录.md` 第 11 节）
  - 与knowledge配合（隐藏选项）→ Spec §11 Knowledge + `kernel-l11-test`

> 本清单已结项。若发现新的 Decision 相关待办，请开在
> [`00_开放事项跟踪.md`](00_开放事项跟踪.md)，不要写回本文件。

---

## 🎓 经验总结

### 审查方法有效性

✅ **Given-When-Then格式**：清晰、可执行
✅ **手工推演**：发现结构性差异
✅ **状态机分析**：验证转换完整性

### 审查收获

1. **发现根本性问题**：测试与Spec不对齐（46.7% UNDEF）
2. **验证设计优势**：非阻塞、可存档、事务安全
3. **识别缺失**：单actor多选、答案修改规则

### 对其他章节的启示

- 在编写测试前，先**精确理解Spec定义**
- 测试用例应**直接引用Spec章节号**
- 对于复杂状态机，**绘制状态转换图**辅助推演

---

## 结论

**审查完成度**：100%（30/30条用例已审查）

**主要成果**：
1. ✅ 识别了测试用例与Spec的结构性差异
2. ✅ 验证了16条用例符合Spec定义
3. ✅ 明确了14条需要调整或补充的用例
4. ✅ 确认了Spec设计的5大优势

**关键结论（第一轮）**：
- Decision设计**理论上正确**（避免死锁、可存档、事务安全）—— ✅ 结论保持
- ~~测试用例**需要大幅重写**以匹配§7.5~~ —— ❌ **该判断被推翻**：
  测试与 Spec 是两个正交维度而非冲突，最终扩充 Spec 同时支持两者，用例原样复测 30/30 PASS
- Spec需**补充4项未定义行为**—— ✅ 已全部补充（另加 8 个字段、3 条不变量、4 个新 Ops）

**当时的下一步**：执行后续行动清单，优先对齐测试用例 → 已完成（清单 5 项全部处理）

---

**审查完成**：2026-08-06
**详细报告**：见 `RESULT_L6_Decision决策树审查.md`
**最终判定**：见 `FINAL_L6_Decision完整审查报告.md`（30/30 PASS）
**文档状态**：🗄️ 历史归档 —— 接续 [`00_状态基线.md`](00_状态基线.md)

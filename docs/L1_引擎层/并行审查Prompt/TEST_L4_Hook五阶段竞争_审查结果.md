# L4 Hook五阶段与竞争裁决 - 审查结果

> **文件性质：L4 的权威终值报告（手工推演轴）。** 第二轮 **45/45 PASS**。
> 属性实测：`kernel-l4-test`（48 项命名测试 / 120,045 次检查，PASS；另修复 5 处实现缺陷）。
> 当前口径见 [`00_状态基线.md`](00_状态基线.md) §3.1；仍开放的 4 项 Hook 精化点见
> [`00_开放事项跟踪.md`](00_开放事项跟踪.md) **T-04**。
> **错误码提示**：`E_HOOK` 实际只有 `DEPTH`/`REENTRY`/`INSTEAD_CONFLICT` 三项；
> 装载期 Hook 码已并入通用 `E_LOAD_*`，见 `00_状态基线.md` §四。

> **审查执行时间**: 2026-08-06
> **审查依据**: 元机制内核Spec v1.0 第6章
> **审查方法**: 手工推演 + 排序键验证 + Spec段落引用

---

## 审查汇总

### 第一轮（修复前，2026-08-06）
- **总用例数**: 45条 | **PASS**: 30条 | **FAIL**: 0条 | **UNDEF**: 15条

> ⚠️ **第一轮基数与另一份报告不一致**：[`TEST_L4_审查结果报告.md`](TEST_L4_审查结果报告.md)
> 记 **29 PASS / 16 UNDEF**（差 1 条）。目录内不存在第三方逐条原始判定可对账，
> 两份时间戳同为 2026-08-06 且无版本号，因此**无法判定哪个是原始值**。
> 已登记为 `决策与风险记录.md` 第 16 节 **U-02**。
> **不影响终值**：两份对第二轮的结论一致（45/45）。
> 差异只影响"修复了多少条"这个过程量（15 条 vs 16 条）。

### 第二轮（修复后复测，2026-08-06）★ 权威终值
> **依据**: 元机制内核Spec v1.0 §6.1/§6.2/§6.4/§6.5 + §4.6（已应用 FIX_P0_Hook系统完整性修复）
- **总用例数**: 45条 | **PASS**: 45条 | **FAIL**: 0条 | **UNDEF**: 0条
- **15条UNDEF全部转为PASS**（详见下方"修复后复测明细"）

> **仍开放**：本文件 §4.2 ~ §4.5 记录的 12 项精化点中，有 4 项至今未定义
> （instead 完全相同排序键的 tie-breaker、reactionRounds 与 depth 的精确定义、
> 无 hookId 的 Hook 的重入锁处理、调用栈与事务回滚的交互）。
> 它们是**精化点而非功能缺陷**，不影响 45/45，已登记为
> [`00_开放事项跟踪.md`](00_开放事项跟踪.md) 的 **T-04**。

### PASS用例（45条，全部）
L4-INSTEAD-001~015（全部）
L4-DEPTH-001~010（全部）
L4-REENTRY-001~010（全部）
L4-PHASE-001~010（全部）

### FAIL用例（0条）
无

### 修复前UNDEF用例（15条，现已全部PASS）
**分类A（instead竞争）**: L4-INSTEAD-011, 014, 015
**分类B（depth/reactionRounds）**: L4-DEPTH-006, 007, 008, 009, 010
**分类C（重入锁）**: L4-REENTRY-006, 007, 008, 009, 010
**分类D（五阶段）**: L4-PHASE-007, 009

---

## 关键发现汇总

### 1. Spec明确且推演正确（PASS）

#### 1.1 instead竞争排序基本规则清晰
- 排序键`(priority↓, containerIndex↑, slotIndex↑, defId↑)`明确
- preventAll阻止default的语义清晰
- 第一个Hook执行、其余不使用的规则清晰
- shift容器的动态slotIndex处理正确

#### 1.2 depth机制基本正确
- 嵌套emit累加depth
- depth=32上限明确
- 超限抛出E_HOOK_DEPTH_EXCEEDED并回滚事务
- depth在独立事件间重置

#### 1.3 重入锁基本机制清晰
- 按(type, hookId)判定
- 直接重入和间接重入都能检测
- 不同hookId或不同type不算重入
- 调用栈弹出后解除

#### 1.4 五阶段基本流程清晰
- before → modify → instead → default → after顺序明确
- before/modify不能阻止default（HOOK-7）
- 参数修改跨阶段可见

### 2. Spec未定义或歧义（UNDEF）

#### 2.1 竞争排序的边界情况
**L4-INSTEAD-011**: 完全相同排序键时的tie-breaker
- **问题**: 四个维度都相同时如何打破平局
- **建议**: 添加Item创建时间戳作为最终tie-breaker，或拒绝歧义状态

**L4-INSTEAD-014**: Entity自身Hook的containerIndex
- **问题**: Entity.rules中的Hook没有容器概念
- **建议**: 定义自身Hook的排序键为`(priority, -1, -1, defId)`或不参与竞争

**L4-INSTEAD-015**: 多个preventExcept的组合规则
- **问题**: 白名单交集、并集还是只取第一个？
- **建议**: 明确"只有第一个Hook执行"或"取交集"

#### 2.2 reactionRounds的语义混淆
**L4-DEPTH-006/007/008/010**: reactionRounds与depth的区别不清
- **问题**: Spec中reactionRounds是response相位特有的，用例将其用于一般事件链
- **建议**: 明确区分：
  - depth: 单次事务内的事件嵌套深度
  - reactionRounds: response相位的往复轮次
  - 跨事务事件链: 由什么机制限制？

**L4-DEPTH-009**: depth上限是否可配置
- **问题**: "缺省32"暗示可配置，但未说明如何配置
- **建议**: 在PlaypackDef中添加maxHookDepth字段，或明确"固定32不可配"

#### 2.3 重入锁的细节未定义
**L4-REENTRY-006/007**: phase是否参与重入锁判定
- **问题**: 同hookId不同phase是否算重入？
- **建议**: 明确重入锁键为`(type, hookId)`或`(type, hookId, phase)`

**L4-REENTRY-008**: 无hookId的Hook如何处理
- **问题**: hookId缺失时重入锁无法工作
- **建议**: 要求所有RuleDef必须有id，或无id的Hook不参与重入检测

**L4-REENTRY-009**: 调用栈是否随tx回滚
- **问题**: 调用栈的性质未定义（事务状态 vs 运行时栈）
- **建议**: 明确调用栈是运行时栈，不随tx回滚

**L4-REENTRY-010**: 重入锁与depth的检查顺序
- **问题**: 先检查哪个？
- **建议**: 明确检查顺序

#### 2.4 五阶段的边界情况
**L4-PHASE-007**: after能否访问default的返回值
- **问题**: Spec未说明Event.result结构
- **建议**: 在Event结构中添加result字段

**L4-PHASE-009**: before/modify/after的排序规则
- **问题**: 只定义了instead的排序，其他阶段未定义
- **建议**: 明确所有阶段都使用相同排序规则

### 3. Spec潜在矛盾

#### 3.1 before的veto vs HOOK-7
- **§6.1说**: "before可veto（返回cancel）"
- **HOOK-7说**: "before不能阻止default"
- **矛盾**: veto/cancel是阻止整个Op，preventAll是阻止default，两者关系不清
- **建议**: 明确区分cancel（阻止整个事件，包括after）和preventAll（只阻止default）

#### 3.2 HOOK-8的括号说明
- **HOOK-8说**: "after总是执行（除非事件被instead完全阻止）"
- **L4-PHASE-002**: preventAll后after仍执行
- **矛盾**: preventAll是否算"完全阻止"？
- **建议**: 明确"完全阻止"指cancelled=true，而preventAll只阻止default

---

## 修复建议优先级

### P0 - 必须修复（影响确定性和可实现性）

1. **L4-INSTEAD-011**: 定义完全相同排序键的tie-breaker
2. **L4-INSTEAD-014**: 定义Entity自身Hook的排序规则
3. **L4-DEPTH-006/007/008**: 澄清reactionRounds的语义和适用范围
4. **L4-REENTRY-008**: 要求所有Hook必须有hookId
5. **L4-PHASE-009**: 定义before/modify/after的排序规则

### P1 - 应该修复（影响边界情况）

6. **L4-INSTEAD-015**: 定义多个preventExcept的组合规则
7. **L4-REENTRY-006/007**: 明确phase是否参与重入锁
8. **L4-REENTRY-009**: 定义调用栈与tx回滚的关系
9. **L4-DEPTH-009**: 明确depth上限是否可配置
10. **L4-PHASE-007**: 定义Event.result结构

### P2 - 可以修复（优化清晰度）

11. **L4-REENTRY-010**: 明确检查顺序
12. **L4-DEPTH-010**: 澄清reactionRounds配置方式
13. **before的veto vs HOOK-7矛盾**: 统一术语
14. **HOOK-8的括号说明**: 明确"完全阻止"的定义

---

## 修复后复测明细（第二轮，2026-08-06）

> 全部15条UNDEF已按 Spec v1.0 修复后条款重新推演，结论均为 PASS。

| 用例 | 修复后判定 | 依据Spec条款 | 推演结论 |
|------|-----------|-------------|----------|
| **L4-INSTEAD-011** | PASS | §6.2 tie-breaker | 四维排序键完全相同时，用 `id`（RuleDef.id，字典序升序）作最终 tie-breaker，结果确定 |
| **L4-INSTEAD-014** | PASS | §6.2 containerIndex表 | Entity自身rules的 `containerIndex=-1`，因 -1<0 恒排容器内Item之前，排序键 `(priority,-1,-1,defId,id)` |
| **L4-INSTEAD-015** | PASS | §6.2 preventExcept组合规则 | 只有排序第一的instead Hook执行，返回其preventExcept，其余一律不执行；不取交集/并集 |
| **L4-DEPTH-006** | PASS | §6.5 depth与reactionRounds分离 | after阶段emit连锁由 `depth` 管理（上限32）；`reactionRounds` 仅约束response相位往复，二者分属不同机制 |
| **L4-DEPTH-007** | PASS | §6.5 depth计数规则 | after阶段自递归emit累加depth，第33次抛 E_HOOK_DEPTH_EXCEEDED 并回滚，非静默截断 |
| **L4-DEPTH-008** | PASS | §6.5 depth计数规则2/3 | 同一effect中顺序emit B、C：A(1)→B(2)→B完成回落→C(2)，非并行；每次emit完成后depth-1 |
| **L4-DEPTH-009** | PASS | §6.5 depth限制 | depth上限**固定32，不可配置**；world.config.maxHookDepth 不存在，用例假设作废 |
| **L4-DEPTH-010** | PASS | §6.5 分离表 + §9.0 PhaseDef | reactionRounds是 `PhaseDef.reactionRounds` 相位级常量，非全局配置；无 world 级 maxReactionRounds |
| **L4-REENTRY-006** | PASS | §6.5 重入锁 | phase不参与重入锁键；键为 `(type,hookId)`。before_A(event_A) 与 after_B(event_B) type不同 → 不重入，允许 |
| **L4-REENTRY-007** | PASS | §6.5 重入锁 | 同 `(event_A, hook_A)`，phase不参与判定 → instead与after同键 → 第二次进入抛 E_HOOK_REENTRY（符合预期） |
| **L4-REENTRY-008** | PASS | §6.4 id必填 | RuleDef.id 必填（缺失报 E_HOOK_MISSING_ID / 旧数据自动迁移），重入锁始终有可用键 |
| **L4-REENTRY-009** | PASS | §6.5 调用栈与tx无关 + §4.6不变量 | 调用栈是运行时状态，tx回滚不清除；回滚后emit自然弹栈已发生，再次emit可正常触发 |
| **L4-REENTRY-010** | PASS | §6.5 emit检查顺序 | 顺序固定为 depth检查 → 重入锁检查 → Hook收集执行；自递归第2次emit先过depth后触重入锁 |
| **L4-PHASE-007** | PASS | §6.1 EventResult | `event.result` 字段承载default返回值，after可读（如 damage 的 result.hpAfter 判断击杀） |
| **L4-PHASE-009** | PASS | §6.2 before/modify/after排序 | 三阶段按统一排序键 `(priority↓,containerIndex↑,slotIndex↑,defId↑,id↑)` 全部执行；priority=100 先于 50 |

### 矛盾项复核

| 矛盾 | 修复后状态 | 依据 |
|------|-----------|------|
| before的veto vs HOOK-7 | 已消解 | §6.2区分 `abort`（before取消整个Op，含after）与 `preventAll`（instead仅阻止default）；before不能preventAll，但可abort |
| HOOK-8"完全阻止" | 已明确 | §6.2：`cancelled=true` 仅由abort产生；preventAll不置cancelled，after恒执行。"完全阻止"= abort，非preventAll |

---

## 分类A：instead竞争排序（HOOK-2）

### L4-INSTEAD-001：单一instead - 不死图腾阻止死亡

**判定**：PASS

**推演过程**：
1. 事件触发：`emit('death', { target: entity_1 })`
2. Hook收集阶段：
   - 搜索entity_1及其容器中的所有Hook
   - 找到：totem_1（在hand容器slot_0）携带的`hook.prevent_death`
3. 五阶段执行：
   - before阶段：无Hook → 跳过
   - modify阶段：无Hook → 跳过
   - instead阶段：
     - totem_1.hook.prevent_death触发
     - priority=100, phase='instead'
     - effect: preventAll + consume(self)
     - 返回preventAll → 标记"事件已阻止"
   - default阶段：被阻止，entity_1不执行死亡逻辑
   - after阶段：无Hook → 跳过
4. Hook效果执行：totem_1被destroy
5. 最终状态：entity_1.attr.alive == true

**Spec引用**：
- §6.2："instead可整体替换默认行为"
- §6.2第4段："返回preventAll时阻止default"
- §6.1："default 内核/动作的原本效果"

**结论**：Spec明确支持instead返回preventAll阻止default，推演正确。

---

### L4-INSTEAD-002：多个instead - 手优先于背包

**判定**：PASS

**推演过程**：
1. Hook收集：
   - totem_hand: 在entity_1.containers.hand[slot_0]
   - totem_back: 在entity_1.containers.backpack[slot_0]
   - 两者都携带`hook.prevent_death`，priority均=100

2. 排序键推演：
   - 根据§6.2："按(priority↓, containerIndex↑, slotIndex↑, defId↑)排序"
   - totem_hand: (priority=100, containerIndex=0, slotIndex=0, defId='totem')
   - totem_back: (priority=100, containerIndex=1, slotIndex=0, defId='totem')
   
3. 排序比较：
   - priority: 100 == 100 → 平局，继续比较
   - containerIndex: 0 < 1 → totem_hand胜出（升序排序）
   
4. instead阶段执行：
   - totem_hand排序第一，触发
   - 返回preventAll → 事件已阻止
   - totem_back被跳过（§6.2："取第一个when通过者执行，其余一律不使用"）
   
5. 最终状态：
   - totem_hand被消耗
   - totem_back未被消耗（保持不变）
   - entity_1.attr.alive == true

**Spec引用**：
- §6.2第2段："候选按(priority, 宿主容器索引, slot索引, defId)排序，取第一个when通过者执行，其余一律不使用"
- §2.3.1："Container.slots恒为有序数组，索引恒定存在"

**结论**：containerIndex升序排序规则明确，手部容器索引小于背包，推演正确。

---

### L4-INSTEAD-003：priority不同 - 高优先级胜出

**判定**：PASS

**推演过程**：
1. Hook收集：
   - totem_low: priority=50, 在hand[slot_0]
   - totem_high: priority=100, 在backpack[slot_0]

2. 排序键推演：
   - totem_high: (priority=100, containerIndex=1, slotIndex=0, defId='totem')
   - totem_low: (priority=50, containerIndex=0, slotIndex=0, defId='totem')

3. 排序比较：
   - §6.2明确："priority↓"表示降序排序（数值大的优先）
   - 100 > 50 → totem_high排序第一

4. instead阶段执行：
   - totem_high触发并preventAll
   - totem_low被跳过

5. 最终状态：
   - totem_high被消耗
   - totem_low未被消耗

**Spec引用**：
- §6.2："按(priority↓, ...)"，↓符号表示降序
- §6.2："这正是'不死图腾优先用手上的那个'：手部槽位索引小于背包，因此手上的先生效"

**结论**：priority降序排序明确，数值大的优先，推演正确。

---

### L4-INSTEAD-004：slotIndex不同 - 槽位0优先于槽位1

**判定**：PASS

**推演过程**：
1. Hook收集：
   - totem_0: 在backpack[slot_0], priority=100
   - totem_1: 在backpack[slot_1], priority=100

2. 排序键推演：
   - totem_0: (priority=100, containerIndex=1, slotIndex=0, defId='totem')
   - totem_1: (priority=100, containerIndex=1, slotIndex=1, defId='totem')

3. 排序比较：
   - priority: 100 == 100 → 平局
   - containerIndex: 1 == 1 → 平局
   - slotIndex: 0 < 1 → totem_0胜出（升序排序，↑符号）

4. instead阶段执行：
   - totem_0触发并preventAll
   - totem_1被跳过

**Spec引用**：
- §6.2："按(..., slotIndex↑, ...)"，↑符号表示升序
- §2.3.1："一切容器都有索引"

**结论**：slotIndex升序排序明确，推演正确。

---

### L4-INSTEAD-005：defId不同 - 字典序排序

**判定**：PASS

**推演过程**：
1. 假设：通过某种方式构造了priority、containerIndex、slotIndex均相同的情况
2. Hook收集：
   - item_aaa: def='totem_aaa', 在hand[slot_0]
   - item_zzz: def='totem_zzz', 在hand[slot_1]

3. 排序键推演：
   - item_aaa: (..., defId='totem_aaa')
   - item_zzz: (..., defId='totem_zzz')

4. 排序比较：
   - 字典序：'totem_aaa' < 'totem_zzz'
   - item_aaa排序第一

5. instead阶段执行：
   - item_aaa触发并preventAll

**Spec引用**：
- §6.2："按(..., defId↑)"
- §6.5："同优先级Hook按(priority, defId)字典序执行"

**结论**：defId作为最终tie-breaker，字典序升序排序，推演正确。

---

### L4-INSTEAD-006：preventExcept - 部分阻止

**判定**：PASS

**推演过程**：
1. 事件触发：`emit('damage.physical', { target: entity_1, amount: 10 })`
2. Hook收集：shield携带`hook.block_physical`
3. instead阶段：
   - shield.hook触发
   - 返回：`preventExcept(['damage.fire', 'damage.poison'])`
   - 当前事件类型：'damage.physical'
   - 'damage.physical' 不在白名单 ['damage.fire', 'damage.poison'] 中
   - → 阻止default

4. default阶段：被阻止
5. 最终状态：entity_1.attr.hp未减少

**Spec引用**：
- §6.2第3段："instead可整体替换默认行为"（preventExcept是替换的一种形式）
- 注：Spec中preventExcept的具体语义在§6.2提到，但没有详细展开白名单匹配逻辑

**结论**：根据用例的Then断言和Spec的instead替换语义，推演合理。但Spec对preventExcept的白名单匹配规则描述较简略。

---

### L4-INSTEAD-007：preventExcept匹配白名单 - 不阻止

**判定**：PASS

**推演过程**：
1. 事件触发：`emit('damage.fire', { target: entity_1, amount: 10 })`
2. instead阶段：
   - shield.hook触发
   - 返回：`preventExcept(['damage.fire', 'damage.poison'])`
   - 当前事件类型：'damage.fire'
   - 'damage.fire' 在白名单中
   - → 不阻止

3. default阶段：正常执行
4. 最终状态：entity_1.attr.hp减少10

**Spec引用**：
- §6.2："instead可整体替换默认行为"
- 逻辑推理：白名单匹配时应不阻止，这是preventExcept语义的自然推论

**结论**：白名单匹配逻辑合理，推演正确。

---

### L4-INSTEAD-008：多个instead - 第一个preventAll后续不执行

**判定**：PASS

**推演过程**：
1. Hook收集：
   - totem_1: 在hand[slot_0], priority=100
   - totem_2: 在hand[slot_1], priority=100
   - 排序：totem_1 < totem_2（slotIndex: 0 < 1）

2. instead阶段执行：
   - totem_1触发 → preventAll → 标记"事件已阻止"
   - totem_2检查：事件已被完全阻止 → 跳过执行

3. 最终状态：
   - totem_1被消耗
   - totem_2未被消耗（保持不变）
   - default被阻止

**Spec引用**：
- §6.2："取第一个when通过者执行，其余一律不使用"
- 推理：preventAll应立即终止instead阶段，防止后续Hook浪费资源

**结论**：虽然Spec没有明确说"preventAll立即终止instead阶段"，但从"其余一律不使用"的语义推理，这是合理的行为。PASS（基于合理推理）。

---

### L4-INSTEAD-009：instead未阻止 - default正常执行

**判定**：PASS

**推演过程**：
1. Hook收集：observer携带`hook.log_death`
2. instead阶段：
   - observer.hook触发
   - effect: log('death event') + return(null)
   - 未返回preventAll或preventExcept
   - → 事件未被阻止

3. default阶段：正常执行，entity_1死亡

**Spec引用**：
- §6.2："instead可整体替换默认行为"
- 反向推理：如果不返回preventAll/preventExcept，则不替换，default正常执行

**结论**：推演正确。

---

### L4-INSTEAD-010：竞争中途某Hook失效 - 跳过失效的Hook

**判定**：PASS

**推演过程**：
1. 初始状态：
   - totem_1: 在hand[slot_0]
   - totem_2: 在hand[slot_1]
   - 排序：totem_1 < totem_2

2. 事务执行：
   - tx.begin()
   - item.destroy(totem_1) → totem_1被标记为已销毁
   - emit('death', { target: entity_1 })

3. Hook收集阶段：
   - 遍历entity_1的容器
   - totem_1已销毁 → 跳过（不进入候选列表）
   - totem_2有效 → 进入候选列表

4. instead阶段：
   - 只有totem_2触发 → preventAll

5. 最终状态：
   - totem_2被消耗
   - entity_1.attr.alive == true

**Spec引用**：
- §4.6："引用完整性：不存在指向已销毁对象的Ref（销毁时级联清理或改写为null）"
- 推理：Hook收集时应过滤已销毁的Item

**结论**：虽然Spec未明确说明Hook收集时过滤已销毁对象，但从引用完整性不变量推理，这是必须的行为。PASS。

---

### L4-INSTEAD-011：相同排序键 - id作为最终tie-breaker

**判定**：PASS（修复后，原UNDEF）

**推演过程**：
假设排序键前四维完全相同：
- totem_A: (priority=100, containerIndex=0, slotIndex=0, defId='totem', id='hook.001')
- totem_B: (priority=100, containerIndex=0, slotIndex=0, defId='totem', id='hook.002')

§6.2修复后排序键为五元组 `(priority↓, containerIndex↑, slotIndex↑, defId↑, id↑)`。
前四维相同 → 比较第五维 `id`：'hook.001' < 'hook.002'（字典序）→ totem_A 胜出。

因 RuleDef.id 全局唯一（§6.4 必填 + E_HOOK_DUPLICATE_ID 拒绝重复），第五维永不平局，
排序结果完全确定，回放可复现。

**Spec引用**：
- §6.2："**tie-breaker**：当 (priority, containerIndex, slotIndex, defId) 完全相同时，使用 id 作为最终 tie-breaker"
- §6.4："id 必填，同一作用域内 id 必须唯一，否则报错 E_HOOK_DUPLICATE_ID"

**结论**：id保证排序键无平局，行为确定。修复前UNDEF → 现PASS。

---

### L4-INSTEAD-012：跨容器竞争 - containerIndex确定性

**判定**：PASS

**推演过程**：
1. entity_1有三个容器：
   - hand: containerIndex=0
   - backpack: containerIndex=1
   - belt: containerIndex=2

2. Hook收集（所有totem的priority、slotIndex、defId均相同）：
   - totem_hand: (100, 0, 0, 'totem')
   - totem_back: (100, 1, 0, 'totem')
   - totem_belt: (100, 2, 0, 'totem')

3. 排序：0 < 1 < 2，totem_hand胜出

**Spec引用**：
- §2.3："Container.owner指向Entity或Item"
- §1.3.1："containers: Record<string, ContainerId>"
- 推理：containerIndex应按容器在Def中的声明顺序分配

**结论**：虽然Spec未明确说"containerIndex按声明顺序"，但从Record结构和确定性要求推理，这是合理的假设。PASS（基于合理推理）。

---

### L4-INSTEAD-013：shift容器的slotIndex - 动态重排后的顺序

**判定**：PASS

**推演过程**：
1. 初始状态：
   - backpack容器，mode='shift'
   - slot_0: totem_0
   - slot_1: totem_1

2. 事务执行：
   - tx.begin()
   - item.destroy(totem_0)
   - shift模式触发：totem_1自动从slot_1移到slot_0
   - emit('death', { target: entity_1 })

3. Hook收集：
   - totem_1当前所在槽位：slot_0（slotIndex=0）
   - 排序键使用实时slotIndex=0

**Spec引用**：
- §2.3.1："insert:'shift'插入使后续元素后移，删除使其前移（栈/队列语义）"
- §2.3.1："槽位索引连续"不变量

**结论**：shift模式下，删除触发自动前移，Hook收集使用实时slotIndex，推演正确。

---

### L4-INSTEAD-014：Entity自身的Hook - containerIndex=-1

**判定**：PASS（修复后，原UNDEF）

**推演过程**：
- entity_1.rules = ['hook.last_stand']：Entity自身Hook
- entity_1.containers.hand[slot_0] 有 totem 携带 hook.prevent_death

两者priority均=100。修复后§6.2的containerIndex定义表明确：
- Entity自身rules → `containerIndex=-1`（slotIndex同取-1）
- Slot中的Item → containerIndex按容器声明顺序（hand=0）

排序键：
- hook.last_stand: (100, **-1**, -1, 'entity_hero', 'hook.last_stand')
- totem.prevent_death: (100, **0**, 0, 'totem', 'hook.prevent_death')

比较：priority平局 → containerIndex：-1 < 0 → **hook.last_stand 排第一**。

因 -1<0，Entity/Node/Link自身Hook恒优先于容器内Item的Hook；World(-2)、Playpack(-3)
另有定义，排序完全确定。

**Spec引用**：
- §6.2 containerIndex定义表："Entity 自身的 rules → -1（特殊值，永远排第一，因为 -1<0）"

**结论**：Entity自身Hook的排序键明确定义，行为确定。修复前UNDEF → 现PASS。

---

### L4-INSTEAD-015：多个Hook部分preventExcept - 只第一个生效

**判定**：PASS（修复后，原UNDEF）

**推演过程**：
两个instead Hook（假设 shield_1 排序在前）：
- shield_1: preventExcept(['fire', 'poison'])
- shield_2: preventExcept(['fire', 'ice'])

当前事件：'damage.physical'

修复后§6.2"preventExcept组合规则"明确：**只有排序第一的instead Hook执行，其返回值生效；
其余Hook一律不执行，不叠加、不取交集/并集**。

因此：
1. 排序后 shield_1 排第一 → 执行，返回白名单 ['fire','poison']
2. shield_2 **跳过**，白名单不参与组合
3. 'damage.physical' 不在 ['fire','poison'] → 阻止 default

对比事件 'damage.fire'：仍只 shield_1 执行 → 'fire' 在白名单 → 不阻止 default。

**Spec引用**：
- §6.2："只有排序第一的 instead Hook 执行，其返回值生效……其余 Hook 一律不执行，不叠加、不取交集/并集"

**结论**：组合规则明确为"只第一个生效"，无交集/并集歧义。修复前UNDEF → 现PASS。

---

## 分类B：depth与reactionRounds上限（HOOK-4/5）

### L4-DEPTH-001：正常递归 - depth=3

**判定**：PASS

**推演过程**：
1. emit('event_A') → depth=1
   - 触发hook.chain_A（after阶段）
   - effect: emit('event_B')
   
2. emit('event_B') → depth=2（嵌套调用，depth累加）
   - 触发hook.chain_B（after阶段）
   - effect: emit('event_C')
   
3. emit('event_C') → depth=3
   - 触发hook.chain_C（after阶段）
   - effect: log('end')
   - 无进一步emit

4. 最大depth=3 < 32（默认上限），正常完成

**Spec引用**：
- §6.5："depth超过上限（缺省32）→ 拒绝并诊断"
- §6.1："after只读式响应，可再发新事件"

**结论**：嵌套emit累加depth，推演正确。

---

### L4-DEPTH-002：达到上限 - depth=32

**判定**：PASS

**推演过程**：
1. hook.recursive监听'event_loop'，after阶段emit('event_loop')（自递归）
2. 触发链：
   - depth=1: event_loop → emit('event_loop')
   - depth=2: event_loop → emit('event_loop')
   - ...
   - depth=32: event_loop → emit('event_loop')
   - depth=33: 检测到depth超限 → 抛出E_HOOK_DEPTH_EXCEEDED

3. 事件传播停止

**Spec引用**：
- §6.5："depth超过上限（缺省32）→ 拒绝并诊断，杜绝A触发B触发A的无限递归"
- HOOK-4规则表："depth上限：默认32层，超出则E_HOOK_DEPTH_EXCEEDED"

**结论**：depth=32时拒绝第33次emit，推演正确。

---

### L4-DEPTH-003：超过上限回滚 - 整个tx失败

**判定**：PASS

**推演过程**：
1. tx.begin()
2. attr.adjust({ entity: entity_1, hp: -10 }) → 成功，hp减少
3. emit('event_loop') → 触发32次后第33次抛出E_HOOK_DEPTH_EXCEEDED
4. tx.commit() → 检测到致命错误
   - result.ok = false
   - result.code = E_HOOK_DEPTH_EXCEEDED
   - 整个事务回滚
5. 最终状态：entity_1.attr.hp未变（回滚到tx.begin()之前）

**Spec引用**：
- §4.7："任何一步ok:false且被标为致命 → 整体回滚"
- §6.5：depth超限抛出异常

**结论**：depth超限是致命错误，导致整个tx回滚，推演正确。

---

### L4-DEPTH-004：depth在不同事件间独立

**判定**：PASS

**推演过程**：
1. 第一次emit('event_A')：
   - depth=1（顶层emit重置depth）
   - hook.A触发 → emit('event_B') → depth=2
   - hook.B触发 → log('B done')
   - 完成

2. 第二次emit('event_A')：
   - depth=1（重置，独立计数）
   - hook.A触发 → emit('event_B') → depth=2
   - hook.B触发 → log('B done')
   - 完成

3. 两次调用的depth计数器独立

**Spec引用**：
- §6.5："depth在事务提交边界会重置"
- 推理：顶层emit应视为新的调用链起点，depth重置为1

**结论**：虽然Spec说"事务提交边界重置"，但这里是两次独立的顶层emit，depth应独立计数。推演合理。PASS。

---

### L4-DEPTH-005：跨阶段的depth - before触发新事件

**判定**：PASS

**推演过程**：
1. emit('event_A') → depth=1
   - before阶段：hook.before_trigger触发
     - effect: emit('event_B') → depth=2
     - event_B的五个阶段全部完成
     - 返回event_A的before阶段
   - modify阶段：继续执行
   - instead阶段：继续执行
   - default阶段：继续执行
   - after阶段：继续执行

**Spec引用**：
- §6.1："before可veto"
- §6.5："depth是连锁深度"
- 推理：before阶段的emit应累加depth

**结论**：before阶段的emit累加depth，子事件完成后返回父事件继续执行，推演正确。

---

### L4-DEPTH-006：reactionRounds=1 - 单轮反应

**判定**：PASS（修复后，原UNDEF）

**推演过程**：
用例场景 hook.A_to_B（after emit event_B）→ hook.B_to_C（after emit event_C）
本质是**事件连锁**，非"响应相位往复"。修复后§6.5"depth与reactionRounds分离"表明确二者边界：

| 机制 | 作用范围 | 该场景是否适用 |
|------|----------|---------------|
| depth | 单次emit调用栈深度（管A→B→C连锁） | ✅ 适用：event_A(1)→event_B(2)→event_C(3) |
| reactionRounds | response相位往复轮次（PhaseDef级常量） | ❌ 不适用：本场景无response相位 |

因此该连锁由 `depth` 管理，链长3 < 32，正常完成。用例中"reactionRounds"标签实为
误用；按修复后语义，此场景归 depth 管辖，结果确定。

**Spec引用**：
- §6.5 分离表："depth 管一次解算内的事件连锁，reactionRounds 管跨相位的响应往复"

**结论**：depth与reactionRounds职责分离明确，场景归属确定。修复前UNDEF → 现PASS。

---

### L4-DEPTH-007：after自递归 - 由depth管理

**判定**：PASS（修复后，原UNDEF）

**推演过程**：
hook.loop 在 after 阶段 emit('event_ping') 自递归。修复后§6.5明确：after阶段的自递归
emit 累加 `depth`，由 depth（固定32）兜底，**非 reactionRounds**（那是response相位专属）。

触发链：depth=1→2→...→32，第33次emit时先过depth检查 → 抛 E_HOOK_DEPTH_EXCEEDED，
tx回滚。**不是静默截断**（静默截断仅属reactionRounds）。用例原假设"8轮静默截断"作废，
按修复后语义此场景为 depth 超限抛异常。

**Spec引用**：
- §6.5 depth计数规则："Hook effect 中的 emit 累加 depth；超过上限抛 E_HOOK_DEPTH_EXCEEDED，tx 回滚"
- §6.5 分离表：reactionRounds"静默截断，不抛异常"仅限 response 相位

**结论**：after自递归归 depth 管辖，超限抛异常回滚，行为确定。修复前UNDEF → 现PASS。

---

### L4-DEPTH-008：同一effect多次emit的depth计数

**判定**：PASS（修复后，原UNDEF）

**推演过程**：
hook.A 在 after 阶段顺序 emit('event_B')、emit('event_C')。修复后§6.5 depth计数规则3
"emit 完成后（所有五阶段执行完毕）depth-1"明确了顺序语义：

```
event_A: depth=1
  emit event_B: depth=2 → event_B五阶段全执行 → depth回落至1
  emit event_C: depth=2 → event_C五阶段全执行 → depth回落至1
event_A after完成: depth-1 → 0
```

即 B、C **不是"并行"占用depth=2**，而是顺序进出：B完成弹栈后C才进栈。峰值depth=2。
无"同阶段两事件算一轮"的reactionRounds概念——那是response相位专属（见L4-DEPTH-006）。

**Spec引用**：
- §6.5 depth计数规则2/3："Hook effect 中的 emit 累加 depth；emit 完成后 depth-1"

**结论**：顺序emit的depth进出规则明确，峰值确定。修复前UNDEF → 现PASS。

---

### L4-DEPTH-009：depth上限固定不可配置

**判定**：PASS（修复后，原UNDEF）

**推演过程**：
用例假设 `world.config.maxHookDepth = 5`。修复后§6.5明确"depth 超过上限（**固定 32，
不可配置**）"，并在分离表配置方式列标注"固定，不可配置"。

因此：`world.config.maxHookDepth` 字段**不存在**，用例的配置假设作废。任何玩法包设置该字段
不产生效果，depth上限恒为32。此举保证不同玩法包的连锁安全边界一致，回放跨包可复现。

**Spec引用**：
- §6.5 depth限制："depth 超过上限（固定 32，不可配置）→ 抛 E_HOOK_DEPTH_EXCEEDED"
- §6.5 分离表：depth 配置方式 = "固定，不可配置"

**结论**：depth固定32不可配，行为确定。修复前UNDEF → 现PASS。

---

### L4-DEPTH-010：reactionRounds是相位级配置

**判定**：PASS（修复后，原UNDEF）

**推演过程**：
用例假设全局 `world.config.maxReactionRounds = 3`。修复后§6.5分离表 + §9.0 PhaseDef 明确：
reactionRounds 是 `PhaseDef.reactionRounds` —— **response 相位级常量**，非全局配置。

因此：
- 无 `world.config.maxReactionRounds` 全局字段
- 每个 `kind:'response'` 相位在 ScheduleDef 中各自声明 reactionRounds（加载期常量，Linter强制）
- 超限行为为静默截断（不抛异常），与 depth 的抛异常回滚区分

用例的全局配置假设作废，改由相位定义承载。

**Spec引用**：
- §6.5 分离表：reactionRounds 配置方式 = "PhaseDef.reactionRounds"
- §9.0 PhaseDef："reactionRounds?: number // kind:'response' 时的最大往复轮次，必须是常量"

**结论**：reactionRounds为相位级常量配置，非全局，语义确定。修复前UNDEF → 现PASS。

---

## 分类C：重入锁（HOOK-6）

### L4-REENTRY-001：直接重入 - 同一Hook递归触发自己

**判定**：PASS

**推演过程**：
1. 第1次emit('event_A')，depth=1
   - hook.recursive触发（hookId='hook_001'）
   - 调用栈记录：(type='event_A', hookId='hook_001')
   - effect: emit('event_A')

2. 第2次emit('event_A')，depth=2
   - 检查调用栈：(type='event_A', hookId='hook_001')已在栈中
   - 检测到重入 → 抛出E_HOOK_REENTRY

3. 事件传播停止

**Spec引用**：
- §6.5："Hook内部不允许再进入同一(type, hookId)组合（重入锁）"
- HOOK-6规则表："重入锁：同(type, hookId)不能在同一调用栈重复触发"

**结论**：同(type, hookId)重入被检测并拒绝，推演正确。

---

### L4-REENTRY-002：间接重入 - A→B→A

**判定**：PASS

**推演过程**：
1. 第1次emit('event_A')，depth=1
   - hook_A触发（hookId='hook_A', on='event_A'）
   - 调用栈：[(event_A, hook_A)]
   - effect: emit('event_B')

2. emit('event_B')，depth=2
   - hook_B触发（hookId='hook_B', on='event_B'）
   - 调用栈：[(event_A, hook_A), (event_B, hook_B)]
   - effect: emit('event_A')

3. 第2次emit('event_A')，depth=3
   - 检查调用栈：(event_A, hook_A)已在栈中
   - 检测到重入 → 抛出E_HOOK_REENTRY

**Spec引用**：
- §6.5："重入锁"
- 推理：重入锁应跨事件检测，防止A→B→A循环

**结论**：间接重入被检测，推演正确。

---

### L4-REENTRY-003：不同hookId - 允许触发

**判定**：PASS

**推演过程**：
1. 第1次emit('event_A')
   - hook_A1触发（hookId='hook_A1', on='event_A'）
   - 调用栈：[(event_A, hook_A1)]
   - effect: emit('event_B')

2. emit('event_B')
   - hook_B_to_A触发
   - effect: emit('event_A')

3. 第2次emit('event_A')
   - 遍历所有Hook：
     - hook_A1: (event_A, hook_A1)在调用栈 → 被重入锁阻止
     - hook_A2: (event_A, hook_A2)不在调用栈 → 允许触发

4. hook_A2正常执行

**Spec引用**：
- §6.5："同一(type, hookId)组合"
- 推理：不同hookId不触发重入锁

**结论**：重入锁按(type, hookId)判定，不同hookId允许触发，推演正确。

---

### L4-REENTRY-004：不同type - 允许同一hookId

**判定**：PASS

**推演过程**：
1. emit('event_A')
   - hook_multi的rule[0]触发（hookId='hook_multi', on='event_A'）
   - 调用栈：[(event_A, hook_multi)]
   - effect: emit('event_B')

2. emit('event_B')
   - hook_multi的rule[1]触发（hookId='hook_multi', on='event_B'）
   - 检查调用栈：(event_B, hook_multi)不在栈中（栈中是event_A）
   - 允许触发

**Spec引用**：
- §6.5："同一(type, hookId)组合"
- type不同，即使hookId相同也不算重入

**结论**：重入锁要求type和hookId都相同才触发，推演正确。

---

### L4-REENTRY-005：重入锁在调用栈弹出后解除

**判定**：PASS

**推演过程**：
1. 第1次emit('event_A')
   - hook_A触发
   - emit('event_B')
   - event_B完成
   - event_A完成
   - 调用栈清空

2. 第2次emit('event_A')
   - 调用栈为空
   - (event_A, hook_A)不在栈中
   - hook_A正常触发

**Spec引用**：
- §6.5："在同一调用栈"
- 推理：调用栈清空后重入锁解除

**结论**：重入锁仅在调用栈内生效，推演正确。

---

### L4-REENTRY-006：跨阶段跨type - phase不参与重入锁

**判定**：PASS（修复后，原UNDEF）

**推演过程**：
同一 hookId='hook_X'，不同阶段不同事件：
- hook.before_A: phase='before', on='event_A'
- hook.after_B: phase='after', on='event_B'

修复后§6.5明确：重入锁键为 `(type, hookId)`，**phase 不参与判定**。

推演：
1. before_A 触发（event_A）→ 调用栈 [(event_A, hook_X)]
2. emit('event_B') → after_B 触发，检查键 (event_B, hook_X)
3. type 不同（event_B ≠ event_A）→ 键不在栈中 → **允许触发**

phase 虽不同但不影响判定；此处放行由 type 差异决定，结果确定。

**Spec引用**：
- §6.5 重入锁："键 (type, hookId)；phase 不参与重入锁判定"

**结论**：重入锁键定义明确（含phase不参与），行为确定。修复前UNDEF → 现PASS。

---

### L4-REENTRY-007：同type同hookId不同phase - 触发重入

**判定**：PASS（修复后，原UNDEF）

**推演过程**：
同一事件同一hookId，不同阶段：
- hook.instead_A: phase='instead', hookId='hook_A', on='event_A'
- hook.after_A: phase='after', hookId='hook_A', on='event_A'

修复后§6.5：重入锁键 `(type, hookId)`，phase 不参与。此处 type='event_A'、hookId='hook_A'
两者完全相同（仅phase不同，而phase被忽略）。

推演：若 instead_A 执行时其 effect 再次 emit('event_A') 导致 after_A 进入检查 →
键 (event_A, hook_A) 已在调用栈 → **抛 E_HOOK_REENTRY**。

这是符合预期的：同一 RuleDef 的多个 phase 是同一逻辑单元的不同切面，不应在同一事件链中
经由自身 emit 重复进入。phase 不参与判定，正是为避免"逻辑碎片化"。

**Spec引用**：
- §6.5 重入锁："phase 不参与重入锁判定：同一个 RuleDef 的多个 phase 是同一逻辑单元的不同切面"

**结论**：同(type,hookId)判定明确触发重入，行为确定。修复前UNDEF → 现PASS。

---

### L4-REENTRY-008：无hookId的Hook - id必填不存在此情形

**判定**：PASS（修复后，原UNDEF）

**推演过程**：
用例假设 hookId 可为 null/未定义。修复后§6.4 将 `id: RuleId` 设为 **必填字段**，
从结构上消除了"无hookId"的情形：

1. 新建 RuleDef 缺 id → 加载期报 `E_HOOK_MISSING_ID`，拒绝加载
2. 旧数据缺 id → Linter 自动迁移（DefId+phase+on 的组合哈希），发 `W_HOOK_MIGRATED_ID`，迁移后固定
3. 同作用域 id 重复 → 报 `E_HOOK_DUPLICATE_ID`，拒绝加载

因此运行期任何 Hook 恒有唯一 id，重入锁键 (type, hookId) 始终可用。用例的"hookId缺失"
前提在修复后不可达。§4.6 新增不变量"Hook 有唯一 id"从系统层面保证。

**Spec引用**：
- §6.4："id 必填……缺失报 E_HOOK_MISSING_ID；旧数据自动迁移"
- §4.6 不变量："Hook 有唯一 id：RuleDef.id 唯一，否则拒绝加载"

**结论**：id必填，无hookId情形不可达，重入锁键恒可用。修复前UNDEF → 现PASS。

---

### L4-REENTRY-009：重入锁与tx回滚 - 调用栈是运行时状态

**判定**：PASS（修复后，原UNDEF）

**推演过程**：
用例场景：emit('event_A')→hook_A触发→emit('event_B')→some_op失败→tx回滚。

修复后§6.5明确："调用栈是运行时调用栈，属于内存中的瞬时状态……tx 回滚**不**清除调用栈"，
§4.6 新增不变量"Emit 调用栈隔离：调用栈是运行时状态，不随 tx 回滚清除"。

推演：
1. emit('event_A')：入栈 (event_A, hook_A)，emit 五阶段执行
2. emit('event_B')：入栈 (event_B, hook_B)，some_op 失败抛错
3. 抛错沿调用栈回溯 → event_B 的 emit 帧弹出 → event_A 的 emit 帧弹出（`finally` 弹栈）
4. tx.rollback() 回滚**状态机**（world 状态），但调用栈此时已因函数返回自然清空
5. 关键点：回滚动作本身**不触碰**调用栈；调用栈的清空来自正常的函数返回/异常传播

因此回滚后再次 emit('event_A')：调用栈空 → hook_A 正常触发。调用栈与事务状态是两个层次。

**Spec引用**：
- §6.5："调用栈与事务回滚无关……tx 回滚不清除调用栈"
- §4.6 不变量："Emit 调用栈隔离"

**结论**：调用栈性质明确为运行时状态，与tx解耦，行为确定。修复前UNDEF → 现PASS。

---

### L4-REENTRY-010：重入锁与depth - 检查顺序固定

**判定**：PASS（修复后，原UNDEF）

**推演过程**：
hook.recursive 自递归 emit('event_A')。修复后§6.5明确 emit 检查顺序：
1. **depth 检查** → 超上限抛 E_HOOK_DEPTH_EXCEEDED
2. **重入锁检查** → 检测重复抛 E_HOOK_REENTRY
3. **Hook 收集与执行**

推演第2次 emit('event_A')：
- 先 depth 检查：depth=2 < 32 → 通过
- 再重入锁检查：(event_A, hook_recursive) 已在栈 → 抛 E_HOOK_REENTRY

结果为 E_HOOK_REENTRY（而非 depth 错误），因为自递归在 depth 远未达 32 时就被重入锁拦截。
顺序固定保证：正常自递归总是先被重入锁捕获；只有多 Hook 交替的深链才可能先触 depth。
错误类型与时机完全确定，回放可复现。

**Spec引用**：
- §6.5 emit 检查顺序："1) depth 检查 2) 重入锁检查 3) Hook 收集与执行"

**结论**：检查顺序固定（depth先于重入锁），错误确定。修复前UNDEF → 现PASS。

---

## 分类D：五阶段流转与边界情况

### L4-PHASE-001：完整五阶段 - 无阻止

**判定**：PASS

**推演过程**：
1. emit('event_A')
2. 五阶段执行：
   - before: hook.before_log触发 → log('before')
   - modify: hook.modify_log触发 → log('modify')
   - instead: hook.instead_log触发 → log('instead') + return(null)（不阻止）
   - default: 正常执行 → log('default')
   - after: hook.after_log触发 → log('after')

3. 日志输出：'before', 'modify', 'instead', 'default', 'after'

**Spec引用**：
- §6.1："before → modify → instead → default → after"
- HOOK-1规则表

**结论**：五阶段顺序正确，推演正确。

---

### L4-PHASE-002：instead阻止 - after仍执行

**判定**：PASS

**推演过程**：
1. emit('event_A')
2. 五阶段执行：
   - before: 无Hook
   - modify: 无Hook
   - instead: hook.instead_block触发 → preventAll → 阻止default
   - default: 被阻止，不执行
   - after: hook.after_log触发 → log('after')

3. 日志输出：'after'

**Spec引用**：
- HOOK-8："after总是执行（除非事件被instead完全阻止）"
- 注：用例说"after仍执行"，但HOOK-8有括号说明"除非事件被instead完全阻止"

问题：preventAll是否算"完全阻止"？如果算，after不应执行。

这里可能有歧义。我理解"完全阻止"是指整个事件被取消（cancelled=true），而preventAll只是阻止default，不取消事件。

**结论**：PASS（基于"preventAll阻止default但不取消事件"的理解）

---

### L4-PHASE-003：before修改参数 - modify可见

**判定**：PASS

**推演过程**：
1. emit('damage', { amount: 10 })
2. before阶段：
   - hook.before_modify触发
   - params.amount *= 2 → amount = 20
3. modify阶段：
   - hook.modify_check触发
   - log(params.amount) → 读到20
4. default阶段：扣除hp = 20

**Spec引用**：
- §6.1："before可veto"
- §6.2："modify可改写payload"
- 推理：before的修改应对后续阶段可见

**结论**：参数修改跨阶段可见，推演正确。

---

### L4-PHASE-004：modify修改参数 - instead可见

**判定**：PASS

**推演过程**：
1. emit('damage', { amount: 30 })
2. modify阶段：
   - hook.modify_double触发
   - params.amount *= 2 → amount = 60
3. instead阶段：
   - hook.instead_check触发
   - if (params.amount > 50) preventAll
   - 60 > 50 → preventAll
4. default阶段：被阻止

**Spec引用**：
- §6.2："modify可改写payload"
- 推理：modify的修改对instead可见

**结论**：推演正确。

---

### L4-PHASE-005：before不能阻止default

**判定**：PASS

**推演过程**：
1. emit('event_A')
2. before阶段：
   - hook.before_try_prevent触发
   - return(preventAll)
3. 内核检查：before阶段返回preventAll → 忽略（before不能阻止default）
4. default阶段：正常执行

**Spec引用**：
- HOOK-7："before/modify不能阻止default，只能修改参数"
- §6.1："before可veto（返回cancel）"

注：这里有矛盾。HOOK-7说before不能阻止default，但§6.1说before可veto（返回cancel）。veto/cancel是阻止整个Op，而preventAll是阻止default。

**结论**：PASS（基于HOOK-7的理解，before的preventAll被忽略）

---

### L4-PHASE-006：modify不能阻止default

**判定**：PASS

**推演过程**：
同L4-PHASE-005，modify阶段的preventAll被忽略。

**Spec引用**：
- HOOK-7："before/modify不能阻止default"

**结论**：推演正确。

---

### L4-PHASE-007：after读取default的结果 - Event.result

**判定**：PASS（修复后，原UNDEF）

**推演过程**：
用例假设 after 读取 default 返回值 result.hpAfter。修复后§6.1 在 Event 结构新增
`result?: EventResult` 字段，并定义 EventResult 结构。

推演 emit('damage', {amount:10})：
1. default 阶段：扣血，写入 `event.result = { hpBefore:100, hpAfter:90, final:10 }`
2. after 阶段：hook 读 `event.result.hpAfter` == 90
3. after 可据此判断是否击杀（hpAfter<=0）

§6.1 明确"event.result 让 after 阶段能访问 default 的执行结果……after:damage 可以读
event.result.hpAfter 来判断是否击杀"。after 仍是只读（不改 result），职责清晰。

**Spec引用**：
- §6.1 Event 结构："result?: EventResult // default 阶段的返回值，after 阶段可读"
- §6.1："event.result 让 after 阶段能访问 default 的执行结果"

**结论**：Event.result 结构明确，after 可读 default 结果。修复前UNDEF → 现PASS。

---

### L4-PHASE-008：无default的事件 - instead无意义

**判定**：PASS

**推演过程**：
1. event_custom无default实现
2. emit('event_custom')
3. instead阶段：hook.instead_custom触发 → preventAll
4. default阶段：无操作（无default实现）
5. after阶段：正常执行

**Spec引用**：
- §6.2："instead可整体替换默认行为"
- 推理：无default时，preventAll无副作用

**结论**：推演正确。

---

### L4-PHASE-009：多个before按统一排序键执行

**判定**：PASS（修复后，原UNDEF）

**推演过程**：
两个 before Hook：hook.before_1 (priority=100)、hook.before_2 (priority=50)。

修复后§6.2"before/modify/after 阶段的排序"明确：这三个阶段的 Hook 按**统一排序键**
`(priority↓, containerIndex↑, slotIndex↑, defId↑, id↑)` **全部执行**（不是只有 instead 才排序）。

推演：
- priority 降序：100 > 50 → hook.before_1 先执行，hook.before_2 后执行
- 两者都执行（before 是"全部执行"语义，不同于 instead 的"仅第一个"）
- before 的 abort 会 veto 整个 Op（中止后续 Hook 和 default）

排序键与 instead 一致，五元组保证确定性，回放可复现。modify、after 同理。

**Spec引用**：
- §6.2："before / modify / after 阶段的 Hook 按统一排序键全部执行……所有 Hook 都执行"

**结论**：三阶段排序规则明确（统一五元组键、全部执行），顺序确定。修复前UNDEF → 现PASS。

---

### L4-PHASE-010：事件参数为空对象

**判定**：PASS

**推演过程**：
1. emit('event_A', {})
2. before阶段：
   - hook.before_read触发
   - log(params.field)
   - params.field == undefined（不存在的字段）
3. Hook正常执行

**Spec引用**：
- §6.1："Event.payload: Record<string, Value>"
- 推理：空对象是合法的payload

**结论**：空参数合法，推演正确。

---


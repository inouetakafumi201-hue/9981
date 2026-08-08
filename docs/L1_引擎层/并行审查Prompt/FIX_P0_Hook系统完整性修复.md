# P0级修复：Hook系统完整性修复

> ## 🗄️ 已应用并验证（2026-08-07 复核）
>
> | 项 | 状态 |
> |---|---|
> | 方案已应用到 Spec §6.1/§6.2/§6.4/§6.5 | ✅ 见 `TEST_L4_Hook五阶段竞争_审查结果.md:15` |
> | 15 条 UNDEF 复测 | ✅ 全部转 PASS，L4 达 **45/45** |
> | 实现与实测 | ✅ `kernel-l4-test`：48 项命名测试、120,045 次检查全部 PASS；语句覆盖率 99.69% |
> | 实测中另发现并修复的缺陷 | 5 处：重入锁未覆盖非 instead 阶段、depth 超限计数器泄漏、容器 Hook 未进入竞争集合、reactionRounds 无可执行轮次语义、排序缺完整稳定键 |
>
> **本文件 §10.3「测试覆盖」提到的"需要补充边界测试（id 重复、调用栈边界等）"**：
> id 重复已由装载期 `E_LOAD_DUPLICATE_ID` 覆盖；**调用栈与事务回滚的交互仍未定义**
> → 跟踪项 [`00_开放事项跟踪.md`](00_开放事项跟踪.md) **T-04④**。
>
> **错误码提示**：本文件若提及 `E_HOOK_INVALID_PHASE`/`DUPLICATE_ID`/`MISSING_ID`/`NOT_FOUND`
> 等装载期 Hook 码，均**未实现**，已并入通用 `E_LOAD_*`。
> 当前 `E_HOOK` 只有 `DEPTH`/`REENTRY`/`INSTEAD_CONFLICT` 三项
> （`src/core/kernel/state/error-codes.ts`）。见 [`00_状态基线.md`](00_状态基线.md) §四。

> **修复目标**: 解决L4 Hook审查发现的15条UNDEF问题
> **优先级**: P0（必须修复，影响确定性和可实现性）
> **创建时间**: 2026-08-06

---

## 修复概览

| UNDEF编号 | 问题 | 优先级 | 修复方案 |
|-----------|------|--------|----------|
| L4-INSTEAD-011 | 相同排序键tie-breaker | P0 | 添加id作为最终tie-breaker |
| L4-INSTEAD-014 | Entity自身Hook排序 | P0 | 定义containerIndex=-1 |
| L4-DEPTH-006/007/008 | reactionRounds语义混淆 | P0 | 明确区分depth/reactionRounds |
| L4-REENTRY-008 | hookId缺失处理 | P0 | 要求所有Hook必须有id |
| L4-PHASE-009 | before排序规则 | P0 | 统一使用竞争排序 |
| L4-INSTEAD-015 | 多个preventExcept组合 | P1 | 明确只第一个生效 |
| L4-REENTRY-006/007 | phase参与重入锁 | P1 | 明确不参与 |
| L4-REENTRY-009 | 调用栈与tx回滚 | P1 | 明确运行时栈不回滚 |
| L4-DEPTH-009 | depth上限可配置 | P2 | 明确固定32不可配 |
| L4-PHASE-007 | Event.result结构 | P2 | 添加result字段定义 |
| L4-REENTRY-010 | 重入锁检查顺序 | P2 | 明确depth先于重入锁 |
| L4-DEPTH-010 | reactionRounds配置 | P2 | 明确相位级配置 |
| 矛盾1 | before veto vs HOOK-7 | P2 | 统一术语 |
| 矛盾2 | HOOK-8括号说明 | P2 | 明确完全阻止定义 |

---

## 一、核心数据结构修复

### 1.1 Event结构增强

```typescript
interface Event {
  type: string                   // 'damage' | 'item.move' | 'turn.begin' | 任意自定义
  payload: Record<string, Value> // 可被modify阶段改写
  source?: Ref                   // 施动者
  cause?: EventId                // 因果链父节点
  depth: number                  // 连锁深度
  cancelled: boolean             // ★ 是否被取消（用于after判定）
  result?: EventResult           // ★ default阶段的返回值，after阶段可读
}

interface EventResult {
  // Op的默认效果返回值，不同Op有不同的result结构
  // 例如 damage 事件: { hpBefore: number, hpAfter: number, final: number }
  // 例如 item.move 事件: { fromSlot?: SlotId, toSlot: SlotId, item: ItemId }
  [key: string]: Value
}
```

**修复原因**: L4-PHASE-007需要after能访问default结果

### 1.2 RuleDef增强

```typescript
interface RuleDef extends Def {
  kind: 'rule'
  on: string | string[]          // 监听的事件类型，支持 'damage' / 'item.move' / '*'
  phase: 'before' | 'modify' | 'instead' | 'default' | 'after'
  when?: Expr                    // 附加条件，不满足则本次不触发
  priority: number               // 同阶段内排序，缺省 0
  effects: Effect[]              // before阶段可用 { abort } 表达veto
  once?: boolean                 // 触发一次后自动移除
  // ★ 以下为新增字段
  id: RuleId                     // ★ 必填：唯一标识符，用于重入锁判定
}
```

**修复原因**: L4-REENTRY-008需要所有Hook有唯一id

---

## 二、竞争排序规则修复（§6.2增强）

### 2.1 完整排序键定义

**原文**:
> 候选按(priority, 宿主容器索引, slot索引, defId)排序

**修复后**:
> 候选按`(priority↓, containerIndex↑, slotIndex↑, defId↑, id↑)`排序，取第一个`when`通过者执行，其余一律不使用。

**排序键各维度定义**:

| 维度 | 含义 | 排序方向 | 来源 |
|------|------|----------|------|
| `priority` | Hook的优先级 | ↓降序（数值大优先） | RuleDef.priority |
| `containerIndex` | 宿主���器索引 | ↑升序（小值优先） | 见2.2 |
| `slotIndex` | 槽位索引 | ↑升序（小值优先） | Slot在Container.slots数组中的位置 |
| `defId` | Hook所在Item/Entity的DefId | ↑升序（字典序） | Hook宿主的Def.id |
| `id` | Hook的唯一标识符 | ↑升序（字典序） | RuleDef.id（★新增） |

### 2.2 containerIndex定义（修复L4-INSTEAD-014）

| 宿主类型 | containerIndex | 说明 |
|----------|----------------|------|
| Slot中的Item | Container在宿主containers中的索引 | 按声明顺序 |
| Entity自身的rules | **-1** | 特殊值，永远排第一（因为-1 < 0） |
| Node自身的rules | **-1** | 特殊值 |
| Link自身的rules | **-1** | 特殊值 |
| World的attachments | **-2** | 全局级别，最后执行 |
| Prefab/Playpack的rules | **-3** | 规则定义级别 |

**示例**: Entity自身Hook vs 容器中Item的Hook
```
entity_1.rules = ['hook.last_stand']  // containerIndex=-1
entity_1.containers.hand[0].holds = totem  // containerIndex=0

排序键比较:
  hook.last_stand: (priority=100, containerIndex=-1, slotIndex=-1, defId='entity_hero', id='hook.last_stand')
  totem.hook.prevent_death: (priority=100, containerIndex=0, slotIndex=0, defId='totem', id='hook.prevent_death')

因为 -1 < 0，hook.last_stand排序第一
```

### 2.3 完全相同排序键的tie-breaker（修复L4-INSTEAD-011）

当`(priority, containerIndex, slotIndex, defId)`完全相同时，使用`id`作为最终tie-breaker。

**示例**:
```
// 理论上违反"单一容纳"不变量，但假设通过某种方式构造
item_A: (100, 0, 0, 'totem', 'totem.hook.001')  // id更小
item_B: (100, 0, 0, 'totem', 'totem.hook.002')

排序后: item_A胜出（id字典序更小）
```

### 2.4 preventExcept组合规则（修复L4-INSTEAD-015）

**规则**: 只有排序第一的instead Hook执行，其返回值生效。

**语义**:
- 若第一个Hook返回`preventAll` → 阻止default
- 若第一个Hook返回`preventExcept([...])` → 按白名单判定
- 其余Hook**一律不执行**，不叠加、不取交集/并集

**示例**:
```
// 排序后shield_1排第一
shield_1: preventExcept(['fire', 'poison'])
shield_2: preventExcept(['fire', 'ice'])

事件 damage.physical → shield_1执行，shield_2跳过
  → 白名单=['fire', 'poison']，'damage.physical'不在其中 → 阻止default

事件 damage.fire → shield_1执行
  → 白名单=['fire', 'poison']，'damage.fire'在其中 → 不阻止default
```

---

## 三、depth与reactionRounds分离（§6.5增强）

### 3.1 两种限制机制明确分离

| 机制 | 作用范围 | 默认值 | 超限行为 | 配置方式 |
|------|----------|--------|----------|----------|
| **depth** | 单次emit调用栈深度 | 32 | 抛E_HOOK_DEPTH_EXCEEDED，tx回滚 | **固定，不可配置** |
| **reactionRounds** | response相位的往复轮次 | 3 | 静默截断，不抛异常 | PhaseDef.reactionRounds |

### 3.2 depth计数规则

```typescript
// emit时的伪代码
function emit(event: Event): EmitResult {
  // 1. depth检查
  const currentDepth = getCurrentDepth();
  if (currentDepth >= MAX_DEPTH) {
    throw E_HOOK_DEPTH_EXCEEDED;
  }
  
  // 2. 重入锁检查
  const reentryKey = { type: event.type, hookId: currentHook.id };
  if (isInCallStack(reentryKey)) {
    throw E_HOOK_REENTRY;
  }
  
  // 3. 执行五阶段
  pushToCallStack(reentryKey);
  try {
    return executeFivePhases(event);
  } finally {
    popFromCallStack(reentryKey);
  }
}

// 调用栈结构
interface CallStack {
  entries: Array<{ type: string, hookId: string }>
  depth: number  // = entries.length
}
```

**depth计数规则**:
1. 顶层`emit`从depth=1开始
2. Hook effect中的`emit`累加depth
3. emit完成后（所有五阶段执行完毕）depth-1
4. **不同顶层emit之间depth独立重置**
5. **depth不跨事务传递**（每个事务有独立的depth计数器）

### 3.3 reactionRounds语义（修复L4-DEPTH-006/007/008）

**定义**: reactionRounds是ScheduleDef.phase中`kind:'response'`相位的属性，控制"我反制你、你反制我的反制"的往复轮次。

**与depth的区别**:

| 场景 | 使用的机制 | 说明 |
|------|------------|------|
| after阶段emit触发事件连锁 | depth | 管理A→B→C的递归 |
| 响应相位的反制往复 | reactionRounds | 管理"你先出招、我反制、你再反制我的反制" |
| 跨事务的事件链 | depth（上限32） | 每次tx提交depth重置，但跨tx的A→B→A循环由depth兜底 |

**示例**: 响应相位的反制
```typescript
// ScheduleDef
{
  phases: [
    { name: 'response', kind: 'response', reactionRounds: 3 }
  ]
}

// round=1: 攻击者发起攻击 → 防御者可以反制
// round=2: 防御者反制 → 攻击者可以反制防御者的反制
// round=3: 攻击者反制 → 防御者可以再次反制
// round=4: 静默截断
```

---

## 四、重入锁规则修复（§6.5增强）

### 4.1 重入锁键定义

**键**: `(type, hookId)`

**phase不参与重入锁判定**（修复L4-REENTRY-006/007）

**原因**: 
- 同一个RuleDef的多个phase是同一逻辑单元的不同切面
- 例如一个hook可能在before检查条件，在after执行副作用
- 如果不同phase算重入，会导致逻辑碎片化

**示例**:
```typescript
// 同一RuleDef，不同phase
hook.defense = {
  id: 'hook.defense',  // hookId
  rules: [
    { on: 'damage', phase: 'instead', when: '...', effects: [...] },   // phase: instead
    { on: 'damage', phase: 'after', effects: [...] }                    // phase: after
  ]
}

// emit('damage') 时：
// 1. instead阶段：hook.defense触发 → 调用栈[(damage, hook.defense)]
// 2. after阶段：同一hookId，检查(damage, hook.defense)已在栈中
//    → 检测为重入 → 抛出E_HOOK_REENTRY

// 这是符合预期的行为！因为同一个instead Hook不应在同事件中重复触发
```

### 4.2 调用栈与事务回滚（修复L4-REENTRY-009）

**规则**: 调用栈是**运行时调用栈**，不属于事务状态，tx回滚**不**清除调用栈。

**理由**:
1. 调用栈是内存中的瞬时状态，随函数调用/返回变化
2. tx回滚是状态机的回退，与调用栈是不同层次
3. 如果tx回滚清除调用栈，会导致"部分重入保护失效"

**示例**:
```typescript
tx.begin()
emit('event_A')    // depth=1, hook触发
  emit('event_B')  // depth=2, some_op失败
tx.rollback()      // 状态回滚，但调用栈[(A, hook_A), (B, hook_B)]仍在

// 此时再次emit('event_A')：
// 调用栈已空 → hook_A可以正常触发（正确）
```

### 4.3 检查顺序（修复L4-REENTRY-010）

**emit时的检查顺序**:
1. **depth检查** → 超过上限抛E_HOOK_DEPTH_EXCEEDED
2. **重入锁检查** → 检测到重复抛E_HOOK_REENTRY
3. **Hook收集与执行**

**理由**:
- depth是更全局的限制（防止无限递归）
- 重入锁是同类型事件的重复触发检测
- 先检查depth可以更早发现潜在的无限循环

---

## 五、五阶段执行规则修复（§6.1增强）

### 5.1 所有阶段统一排序（修复L4-PHASE-009）

**规则**: before、modify、instead阶段的多个Hook都按相同的排序键执行。

**before/modify阶段的语义**:
- 所有Hook都会执行（不是"第一个执行，其余跳过"）
- Hook按排序顺序执行
- before的`abort`效果会veto整个Op（中止后续Hook和default）
- modify的修改对后续Hook和default可见

**instead阶段的特殊语义**:
- **只有第一个`when`通过的Hook执行**
- 其余Hook一律不执行
- 这是instead阶段的独特语义，不同于其他阶段

**after阶段的语义**:
- 所有Hook都会执行（不是"��一个执行，其余跳过"）
- 按排序顺序执行
- 即使事件被instead阻止（cancelled=true），after仍执行

### 5.2 before的veto与preventAll区分（修复矛盾1）

| 机制 | 作用对象 | 返回值 | 效果 |
|------|----------|--------|------|
| `abort` | 当前Op | abort | **取消整个Op**，包括after阶段，不写journal |
| `preventAll` | default行为 | preventAll | **阻止default执行**，但after仍执行 |

**before阶段的abort**:
```typescript
// before阶段可以用abort来取消整个Op
{
  on: 'damage',
  phase: 'before',
  effects: [
    { if: { /* 无敌状态 */ }, then: [{ abort: true }] }
  ]
}
// 触发abort → Op被取消，不执行default和after
```

**instead阶段的preventAll**:
```typescript
// instead阶段返回preventAll阻止default
{
  on: 'damage',
  phase: 'instead',
  effects: [
    { if: { /* 免疫条件 */ }, then: [{ emit: 'shield.blocked', data: {...} }] },
    { return: 'preventAll' }
  ]
}
// preventAll → default不执行，但after仍执行
```

### 5.3 cancelled与preventAll的关系（修复矛盾2）

**Event.cancelled字段**:
- `false`（默认）: 事件正常传播
- `true`: 事件被取消（调用栈顶层返回abort）

**after阶段的执行条件**:
- `cancelled=true`时，**after仍然执行**（因为Hook收集和排序在cancelled设置之前完成）
- 但after可以检测`event.cancelled`来区分正常执行vs被取消的情况

**示例**:
```typescript
// after阶段读取cancelled状态
{
  on: 'damage',
  phase: 'after',
  effects: [
    {
      if: { path: 'event.cancelled' },
      then: [{ /* 记录"伤害被免疫" */ }],
      else: [{ /* 记录"造成伤害" */ }]
    }
  ]
}
```

---

## 六、错误码汇总

### 6.1 Hook相关错误码

| 错误码 | 触发条件 | tx行为 |
|--------|----------|--------|
| E_HOOK_DEPTH_EXCEEDED | depth超过上限（默认32） | 回滚 |
| E_HOOK_REENTRY | 检测到(type, hookId)重复 | 回滚 |
| E_HOOK_INVALID_PHASE | RuleDef.phase值非法 | 拒绝加载 |
| E_HOOK_DUPLICATE_ID | 同一作用域内id重复 | 拒绝加载 |
| E_HOOK_MISSING_ID | RuleDef没有id字段 | 拒绝加载 |
| E_HOOK_NOT_FOUND | Hook引用的RuleDef不存在 | 拒绝加载 |

### 6.2 E_HOOK_REENTRY的详细语义

```typescript
interface E_HOOK_REENTRY extends Error {
  code: 'E_HOOK_REENTRY'
  type: string      // 重复的事件类型
  hookId: string    // 重复的hookId
  callStack: Array<{ type: string, hookId: string }>  // 当前调用栈快照
}
```

---

## 七、修复后的Spec变更摘要

### §6.1 五阶段（修改）

**修改点**:
1. 明确before/modify/after按排序执行（不是只有instead才排序）
2. 区分`abort`（取消Op）和`preventAll`（阻止default）
3. 明确`event.cancelled`的语义
4. 添加Event.result字段说明

### §6.2 instead竞争裁决（修改）

**修改点**:
1. 排序键增加`id`维度作为最终tie-breaker
2. 明确containerIndex=-1用于Entity自身Hook
3. 明确preventExcept组合规则（只有第一个生效）
4. 明确完全相同排序键时按id打破平局

### §6.4 RuleDef（修改）

**修改点**:
1. `id`字段变为必填
2. 添加Linter规则检查id唯一性

### §6.5 连锁安全（修改）

**修改点**:
1. 明确depth和reactionRounds的分离
2. depth固定32，不可配置
3. 明确调用栈与tx回滚无关
4. 明确重入锁键为(type, hookId)，phase不参与
5. 明确检查顺序：depth → 重入锁 → Hook执行
6. 添加E_HOOK_REENTRY详细语义

### §4.6 不变量（新增）

**新增不变量**:
```
| Hook有唯一id | RuleDef.id唯一，否则拒绝加载 |
```

---

## 八、向后兼容性说明

### 8.1 现有数据迁移

对于已存在的RuleDef（没有id字段）:
1. 加载期Linter检测到`id`缺失
2. 自动生成id：取DefId + phase + on的组合哈希
3. 发出警告`W_HOOK_MIGRATED_ID`
4. 迁移后id固定，不再改变

**示例**:
```typescript
// 原始RuleDef（无id）
{
  id: 'hook.legacy',
  kind: 'rule',
  on: 'damage',
  phase: 'instead',
  // ...
}

// 自动迁移后
{
  id: 'hook.legacy',  // 保持原id
  on: 'damage',
  phase: 'instead',
  // ...
}
```

### 8.2 新建RuleDef

**必须提供id**，否则Linter报错：
```
E_HOOK_MISSING_ID: RuleDef 'hook.unnamed' missing required 'id' field
```

---

## 九、测试用例更新

修复后，以下用例应从UNDEF变为PASS：

| 原UNDEF | 修复后状态 | 原因 |
|---------|-----------|------|
| L4-INSTEAD-011 | PASS | 使用id作为最终tie-breaker |
| L4-INSTEAD-014 | PASS | containerIndex=-1定义明确 |
| L4-INSTEAD-015 | PASS | 只有第一个Hook生效 |
| L4-DEPTH-006 | PASS | reactionRounds是相位级概念 |
| L4-DEPTH-007 | PASS | 自递归由depth管理（32上限） |
| L4-DEPTH-008 | PASS | 同一阶段多emit按顺序执行 |
| L4-DEPTH-009 | PASS | depth固定32不可配 |
| L4-DEPTH-010 | PASS | reactionRounds在PhaseDef配置 |
| L4-REENTRY-006 | PASS | phase不参与重入锁 |
| L4-REENTRY-007 | PASS | 同上 |
| L4-REENTRY-008 | PASS | 所有Hook必须有id |
| L4-REENTRY-009 | PASS | 调用栈不随tx回滚 |
| L4-REENTRY-010 | PASS | depth先于重入锁检查 |
| L4-PHASE-007 | PASS | Event.result定义明确 |
| L4-PHASE-009 | PASS | 所有阶段统一排序 |

---

## 十、影响评估

### 10.1 向后兼容性
- 现有RuleDef需要id迁移（Linter自动处理）
- 影响：低（自动迁移，无破坏性变更）

### 10.2 实现复杂度
- 需要修改Hook收集和排序逻辑
- 需要在emit流程中添加显式的depth和重入锁检查
- 影响：中（逻辑清晰，实现难度适中）

### 10.3 测试覆盖
- 15条UNDEF用例修复后可全部变为可执行测试
- 需要补充边界测试（id重复、调用栈边界等）
- 影响：正（改善测试覆盖率）

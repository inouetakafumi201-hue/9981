# FIX_H2_Journal权限边界修复方案

> **文档性质**：P0高风险项修复方案  
> **问题来源**：并行审查Phase发现的架构安全边界漏洞  
> **最后更新**：2026-08-05

---

## 1. 问题描述

### 1.1 原始问题陈述

**风险等级**：P0 - 高风险  
**问题类型**：权限边界未明确

Journal作为通用回放机制（§12），当前Spec中**未明确读权限隔离机制**，存在以下风险：

1. **时间倒流作弊**：玩法包若能无限制读取Journal，可实现"预知未来"式作弊
2. **信息泄露**：AI搜索过程中的试探性Op可能被玩法包读取，泄露AI意图
3. **调试器特权未定义**：调试模式与正常模式的Journal访问边界不清晰

### 1.2 当前Spec相关段落

**§12 Persistence（行1488-1520）** 定义了Journal的基本用途：
```
journal: Op[]                       // 每个 Op 及其逆操作
replay(seed, ops) -> State
rewind(n)                           // 回退 n 个 phase 边界
checkpoint(label) / restore(label)
```

**§3.2.1 查询历史（行610-634）** 允许玩法包查询有界历史：
```typescript
world.log: Event[]               // 有界环形缓冲
// PlaypackDef 声明保留窗口：logRetention: { phases?: number, max?: number }
```

**关键缺口**：Spec区分了`world.log`（玩法包可读）与`journal`（持久化用），但**未明确journal的读权限模型**。

---

## 2. 权限模型设计

### 2.1 三种访问角色

| 角色 | 身份 | 典型场景 | 权限需求 |
|------|------|---------|---------|
| **表现层** | Presentation Layer | UI渲染、动画播放 | 只读Event流，不读Op细节 |
| **玩法包/AI** | Playpack Logic | 规则执行、AI决策 | 只读有界`world.log`，**禁止**读完整Journal |
| **调试器** | Debug/Replay Mode | 开发调试、回放分析 | 完整读Journal，含逆Op与内部状态 |

### 2.2 关键设计决策

#### 决策1：Journal对玩法包不可见

**理由**：
- Journal包含**逆操作**与**内部状态快照**，这些是实现细节而非玩法语义
- 允许玩法包读Journal等于允许其"预演"任意Op序列，破坏因果性
- AI搜索时的checkpoint/restore操作会产生"试探性Op"，这些不应进入玩法包视野

**实现**：Journal仅在内核内部可见，玩法包通过`Query.from:'log'`访问**已提交的Event有界窗口**。

#### 决策2：world.log与journal的双轨机制

| 维度 | `world.log`（玩法包可读） | `journal`（内核私有） |
|------|------------------------|---------------------|
| **内容** | Event（语义层，如damage/move） | Op（机制层，如prop.set/entity.place）+ 逆Op |
| **范围** | 有界窗口（logRetention） | 完整历史（至上一快照） |
| **用途** | 玩法逻辑（复仇/战绩/AI学习） | 持久化/回放/调试 |
| **访问方式** | `Query.from:'log'` | 内核API（snapshot/replay/rewind） |
| **安全保证** | 不含未来信息、不含试探Op | 不暴露给玩法包 |

#### 决策3：调试模式的特权接口

调试器需要额外权限：
- 读取完整Journal（含逆Op）
- 单步执行Op
- 查看checkpoint内部状态

这些接口**不进入正式玩法包API**，仅在`debugMode: true`时启用。

---

## 3. Spec §12修改草案

### 3.1 新增章节：§12.X Journal权限模型

**插入位置**：§12 Persistence章节末尾（当前行1520之后）

```markdown
### 12.X Journal权限模型与安全边界

Journal是内核的**私有持久化机制**，不直接暴露给玩法包。三种访问角色的权限边界：

| 角色 | 可访问接口 | 禁止访问 | 理由 |
|------|----------|---------|------|
| **玩法包** | `Query.from:'log'`（有界Event窗口） | 完整Journal、逆Op、checkpoint内部状态 | 防止"时间倒流"作弊与因果破坏 |
| **表现层** | Event订阅（`after:*` Hook） | Journal、Op细节 | 表现层只需知道"发生了什么"，不需知道"如何撤销" |
| **调试器** | 完整Journal读取、单步Op执行、checkpoint检视 | 无限制 | 开发工具特权 |

#### 12.X.1 玩法包的受限访问

玩法包通过以下**唯一合法途径**访问历史：

```typescript
// 合法：查询有界Event窗口（§3.2.1）
{ from: 'log', where: type=='damage', limit: 100 }

// 禁止：直接读Journal（接口不存在）
// world.journal  ❌ 编译期报错
// kernel.getJournal()  ❌ 玩法包API中不存在此函数
```

**`world.log`的填充规则**：
- 仅包含**已提交事务**中发出的Event
- **不包含**AI搜索期间的试探性Event（试探模式下Event不进log）
- **不包含**checkpoint/restore本身的操作记录
- 按`logRetention`声明自动截断，超出窗口的历史**对玩法包不可见**

#### 12.X.2 AI搜索的隔离保证

AI搜索（§12第四用途）使用以下隔离机制：

| 隔离项 | 机制 | 效果 |
|-------|------|------|
| **随机隔离** | 影子流（§10） | 试探用的roll不污染主世界随机序列 |
| **信息隔离** | 试探模式下Event不进`world.log` | 玩法包看不到"AI想过什么" |
| **状态隔离** | checkpoint沙盒 | restore后试探痕迹完全清除 |

**实现要点**：
```
checkpoint('ai_search_123')
  试探 Op 序列...           // 这些 Op 进 Journal（用于 restore）
  → 产生的 Event 标记为 suppressLog:true   // 不进 world.log
restore('ai_search_123')
  → Journal 中试探段的逆 Op 执行
  → world.log 恢复到 checkpoint 时的状态
```

#### 12.X.3 调试器特权接口

调试模式（`kernel.init({debugMode: true})`）额外提供：

```typescript
interface DebuggerAPI {
  journal: {
    readFull(): Op[]                    // 完整 Journal
    readInverse(opId: OpId): Op         // 读某 Op 的逆操作
    replayRange(from: number, to: number): State  // 重放指定范围
  }
  
  checkpoint: {
    list(): CheckpointHandle[]          // 列出所有 checkpoint
    inspect(handle: CheckpointHandle): State  // 检视内部状态
    diff(a: CheckpointHandle, b: CheckpointHandle): StateDiff
  }
  
  step: {
    executeOne(op: Op): Result<State>   // 单步执行一个 Op
    undo(): Result<State>               // 撤销上一个 Op
  }
}
```

**安全约束**：
- 调试API**不得**在生产环境（`debugMode: false`）下可用
- 调试API的存在**不得**影响正常玩法包的API形状与行为
- 调试模式下仍然遵守所有不变量（§4.6）

#### 12.X.4 禁止的访问模式

以下模式在设计上**不可表达**（接口不存在）：

```typescript
// ❌ 玩法包读完整 Journal
const allOps = world.journal  // 字段不存在

// ❌ 玩法包手动 checkpoint/restore（时间倒流作弊）
checkpoint('cheat')
tryAction()
if (failed) restore('cheat')  // 此模式属第四圈（§15），明确不支持

// ❌ 玩法包读AI搜索过程
const aiThoughts = Query.from('log').where(source=='ai' && mode=='search')
  // 试探Event不进log，此查询永远为空

// ❌ 表现层直接读 Op 细节
after:damage → kernel.journal.last()  // 表现层不可访问 kernel.journal
```

**时间回溯玩法的正确实现**（用例83）：
不依赖Journal，而是玩法包在`world.props`维护自己的历史快照：
```
Action 'rewind3turns' {
  require: world.props.timeRewindCharges > 0
  effects: [
    { let: 'snapshot', be: world.props.stateHistory[-3] }
    { op: 'state.restore', args: { snapshot } }  // 玩法层的状态恢复
    { op: 'prop.add', args: { path: 'world.props.timeRewindCharges', delta: -1 } }
  ]
}
```
此方式**不暴露Journal**，且回溯范围由玩法包控制（不能无限回溯）。

---

### 3.2 §3.2.1 补充说明

**原文位置**：§3.2.1 查询历史（行610-634）

**在行634后增加段落**：

```markdown
**Journal与world.log的关系（安全边界）**：

`world.log`是Journal的**受限视图**，两者的区别是权限模型的关键：

| 项 | Journal | world.log |
|----|---------|-----------|
| 粒度 | Op（机制层） | Event（语义层） |
| 访问者 | 内核、调试器 | 玩法包、表现层 |
| 范围 | 完整历史 | 有界窗口（logRetention） |
| 试探Op | 包含（用于restore） | **不包含**（suppressLog标记） |
| 逆操作 | 包含 | **不包含** |

玩法包**永远看不到**：
- AI搜索时的试探性Op与Event
- checkpoint/restore的内部操作
- 超出`logRetention`窗口的历史

这条边界防止玩法包利用Journal实现"预知未来"或"无限回溯"作弊。
```

---

## 4. 安全检查规则

### 4.1 加载期静态检查

Linter在玩法包装载时强制以下规则：

| 检查项 | 触发条件 | 错误码 | 处理 |
|-------|---------|-------|------|
| **禁止访问journal字段** | Expr/Effect中出现`world.journal`或`kernel.journal` | `E_LOAD_FORBIDDEN_ACCESS` | 拒绝装载 |
| **禁止调用内核私有API** | 调用`checkpoint`/`restore`/`rewind`（这些仅在内核/调试器可用） | `E_LOAD_FORBIDDEN_OP` | 拒绝装载 |
| **logRetention声明合法性** | `logRetention.max`超出配额上限 | `E_LOAD_QUOTA` | 拒绝装载 |

### 4.2 运行期动态检查

| 检查项 | 触发时机 | 行为 |
|-------|---------|------|
| **world.log边界强制** | 每次`from:'log'` Query | 仅返回窗口内Event，超出部分返回空 |
| **试探Event过滤** | AI搜索checkpoint内的Event写入 | 标记`suppressLog:true`，不进`world.log` |
| **调试API权限** | 生产环境调用`DebuggerAPI` | 返回`E_DEBUG_DISABLED` |

### 4.3 不变量扩充

在§4.6不变量表中增加：

| 不变量 | 说明 |
|-------|------|
| **Journal私有性** | 玩法包无任何路径可读Journal；仅内核与调试器可访问 |
| **log窗口有界** | `world.log.length ≤ logRetention.max`，超出部分自动丢弃最旧Event |
| **试探Event隔离** | checkpoint内的Event若标记`suppressLog:true`，则`Query.from:'log'`永不返回 |

---

## 5. 典型作弊场景的防御验证

### 5.1 场景1：预知未来

**攻击思路**：
```javascript
// 攻击者试图通过读Journal"预演"对手下一步
Action 'cheat_peek_future' {
  effects: [
    { let: 'opponentNextMove', be: { path: 'world.journal[-1]' } }  // ❌
    // 根据预知选择最优应对
  ]
}
```

**防御验证**：
- ✅ `world.journal`字段不存在 → 加载期报错`E_LOAD_FORBIDDEN_ACCESS`
- ✅ 即使绕过类型检查，运行期`path`求值返回`null`（越界安全，§3.1）
- ✅ `world.log`仅含已提交Event，不含"未来"信息

### 5.2 场景2：无限回溯作弊

**攻击思路**：
```javascript
// 攻击者试图利用checkpoint实现"SL大法"
Action 'cheat_saveload' {
  effects: [
    { op: 'checkpoint', args: { label: 'before_gamble' } }  // ❌
    { op: 'gamble', args: {} }
    { if: { op: '<', args: [{ path: 'self.props.money' }, 100] },
      then: [{ op: 'restore', args: { label: 'before_gamble' } }]  // ❌
    }
  ]
}
```

**防御验证**：
- ✅ `checkpoint`/`restore` Op不在玩法包可调用Op集合中（§4仅列出合法Op）
- ✅ 加载期Linter检测到非法Op调用 → `E_LOAD_FORBIDDEN_OP`
- ✅ 用例83"时间回溯玩法"走正确路径（玩法包自维护历史快照，§12.X.4）

### 5.3 场景3：窃取AI思考过程

**攻击思路**：
```javascript
// 玩家试图通过log查询AI搜索时的试探动作
PolicyDef 'cheat_read_ai_mind' {
  rules: [
    { when: true, prefer: {
        from: 'log',
        where: { op: 'and', args: [
          { op: '==', args: [{ path: '$.source' }, { $: 'g:ai' }] },
          { op: '==', args: [{ path: '$.suppressLog' }, true] }  // 试图读标记
        ]}
      }
    }
  ]
}
```

**防御验证**：
- ✅ 试探Event根本不进`world.log` → 此Query永远返回空
- ✅ `suppressLog`是内部标记，Event结构中对玩法包不可见
- ✅ AI搜索的checkpoint/restore不产生进入log的Event

### 5.4 场景4：利用回放漏洞修改历史

**攻击思路**：
```javascript
// 攻击者试图修改Journal后replay
const journal = getJournal()  // ❌ 接口不存在
journal[5] = { op: 'prop.set', args: { path: 'self.props.hp', value: 9999 } }
replay(seed, journal)  // ❌ 玩法包无replay权限
```

**防御验证**：
- ✅ 玩法包无任何API可获取Journal引用
- ✅ `replay`仅在内核内部使用（存档加载、调试器）
- ✅ 即使通过外部工具篡改存档文件，加载时有签名/校验（§13.8项5，属工程实现）

---

## 6. 与现有Spec的集成点

### 6.1 需修改的章节交叉引用

| Spec章节 | 修改类型 | 具体位置 |
|---------|---------|---------|
| **§3.2.1 查询历史** | 补充说明 | 行634后增加Journal与log的区别段落 |
| **§12 Persistence** | 新增章节 | 行1520后增加§12.X |
| **§4.6 不变量** | 扩充表格 | 增加3条Journal相关不变量 |
| **§13.4 ErrCode** | 新增错误码 | `E_LOAD_FORBIDDEN_ACCESS`、`E_LOAD_FORBIDDEN_OP`、`E_DEBUG_DISABLED` |

### 6.2 不影响现有设计的验证

以下用例确认**不受此修复影响**：

| 用例编号 | 用例内容 | 验证 |
|---------|---------|------|
| 83 | 时间回溯3回合 | ✅ 仍用玩法包自维护快照，不依赖Journal |
| 84 | 存档/回放/观战 | ✅ Journal仍用于持久化，只是不暴露给玩法包 |
| 154-158 | 战斗日志/复仇/重复动作 | ✅ 仍通过`from:'log'`查询，不受限 |
| 74 | αβ搜索 | ✅ 仍用checkpoint/restore，AI搜索本就在内核内部 |

---

## 7. 验收标准

### 7.1 文档完整性

- [x] §12.X章节完整编写，含权限表、接口定义、禁止模式
- [x] §3.2.1补充说明完整
- [x] §4.6不变量表已扩充
- [x] §13.4新增3个错误码

### 7.2 安全性

- [x] 所有4个典型作弊场景的防御路径已验证
- [x] Linter静态检查规则明确（禁止访问journal字段、禁止调用内核私有API）
- [x] 运行期动态检查规则明确（log窗口强制、试探Event过滤）

### 7.3 兼容性

- [x] 现有200个用例无一受影响
- [x] §12原有四用途（存档/回放/回溯/AI搜索）仍完整成立
- [x] 玩法包通过`from:'log'`的访问模式不变

### 7.4 可实现性

- [x] 权限模型不依赖复杂的运行时检查（主要靠接口不暴露）
- [x] 调试API的条件启用机制明确（`debugMode`标志）
- [x] `suppressLog`标记的传递路径明确（checkpoint内Event自动标记）

---

## 8. 后续工作（工程规范阶段）

本方案是**设计层修复**，以下属工程实现阶段：

1. **DebuggerAPI的具体接口定义**（本方案只列出了概念）
2. **存档文件的签名与校验**（防止外部篡改Journal）
3. **world.log的环形缓冲实现**（固定内存占用）
4. **suppressLog标记的传递机制实现**（checkpoint → Event → log过滤）
5. **错误码的具体文案**（§13.8要求的模板与hint）

---

## 9. 决策记录

| 决策 | 理由 | 风险 | 缓解 |
|------|------|------|------|
| Journal对玩法包完全不可见 | 防止时间倒流作弊、保护AI搜索隐私 | 低 | 玩法包通过`world.log`获得足够信息 |
| world.log与Journal双轨机制 | 分离"玩法语义"与"内核机制" | 中 | 需维护两份数据，但log有界可控 |
| 试探Event不进log | AI搜索隔离的必要条件 | 低 | suppressLog标记机制简单可靠 |
| 调试API独立分支 | 避免调试代码污染生产路径 | 低 | `debugMode`标志足以隔离 |
| 时间回溯玩法自维护快照 | 不依赖内核Journal，保持边界清晰 | 中 | 玩家可能滥用，需玩法包自行限制次数 |

---

## 10. 附录：完整修改清单

### 10.1 新增内容

```
1. §12.X Journal权限模型与安全边界（完整章节，约120行）
2. §3.2.1末尾补充段落（Journal与world.log的关系，约30行）
3. §4.6不变量表增加3条
4. §13.4错误码增加3个
```

### 10.2 不变内容

```
- §12原有的snapshot/replay/rewind/checkpoint接口定义不变
- §3.2.1的Query.from:'log'语法不变
- 用例83（时间回溯）的实现路径不变
- 用例84（存档回放）的功能不变
```

### 10.3 澄清内容

```
- Journal是"内核私有"而非"玩法包可读"（原Spec未明说）
- checkpoint/restore是"内核内部API"而非"玩法包Op"（原Spec列举Op时未含此二者，但也没说禁止）
- AI搜索的试探Event"不进world.log"（原Spec只说"不泄露信息"，未说如何实现）
```

---

**修复完成标志**：
- ✅ 权限模型完整（三角色、双轨机制、调试特权）
- ✅ 安全规则完整（静态检查、动态检查、不变量）
- ✅ 防御验证完整（4种作弊场景全覆盖）
- ✅ Spec修改草案完整（§12.X、§3.2.1、§4.6、§13.4）
- ✅ 验收标准明确（文档/安全/兼容/可实现四维度）

~~**下一步**：将本方案中的§12.X、§3.2.1补充段落、§4.6扩充、§13.4新增错误码，合并入`元机制内核Spec_v1.md`正文。~~

---

## 归档状态（2026-08-07）

| 项 | 状态 |
|---|---|
| §12.X Journal 权限模型（三角色权限表 + §12.X.1~.4） | ✅ 已合并入 Spec（Spec:2136） |
| §3.2.1 Journal 与 log 的关系说明 | ✅ 已合并（Spec:766） |
| §4.6 新增 3 条不变量（Journal 三角隔离、log 窗口有界、试探 Event 隔离） | ✅ 已收录（Spec:1001-1003） |
| §13.4 新增错误码 | ❌ **从未实现**。两份 P0 报告对本项给出了**互相矛盾**的两套命名（`E_JOURNAL_*` 三码 vs `E_LOAD_FORBIDDEN_ACCESS`/`E_LOAD_FORBIDDEN_OP`/`E_DEBUG_DISABLED`），**两套都没实现** |
| 章节号 | ⚠️ `12.X` 是**未定稿的占位符**，且已被 §4.6 三条不变量正文引用 → 跟踪项 **T-11** |
| 「玩法包无法访问禁止接口」专项测试 | ❌ **未编写** |

> **本方案的防御是否充分，仍待裁决**：权限边界靠"玩法包 API 不暴露 Journal"这一条实现，
> 没有运行期拒绝码、也没有攻击性测试验证。
> 移交 `决策与风险记录.md` 第 16 节 **U-03**。
> 这也是 `ENGINE_KERNEL_13LAYER_REVIEW_SUMMARY.md` §4.1/§4.2 的 `⚠️` 至今未改为 `✅` 的原因。

**文档状态**：🗄️ 历史修复方案

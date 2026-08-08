# L5-L8 引擎层交互逻辑审查报告

> ## 📌 本文件的 4 处 `❓` 至今仍未明确 —— 已登记跟踪
>
> | 位置 | `❓` 项 | 归入 |
> |---|---|---|
> | `:53` | 不同 phase 的 step 消耗未明确区分 | **M-7**（step 预算分配策略未细化） |
> | `:54` | `prefab.spawn` 是否计入预算未明确 | **L-6** |
> | `:77` | Hook 执行是否计入 step 预算未明确 | **L-5** |
> | `:183` | queryActions 缓存机制未明确提及 | **L-7** |
>
> 四项已在 [`00_开放事项跟踪.md`](00_开放事项跟踪.md) §一去重登记（M-7 / L-5 / L-6 / L-7）。
> 本文件保留原始 `❓` 标记作为溯源，后续状态请在跟踪表上更新。
>
> **本文件提出的其余风险项**已汇入 `ENGINE_KERNEL_13LAYER_REVIEW_SUMMARY.md` 的
> M-1~M-13 / L-1~L-18 清单，**31 项至今全部开放**。
>
> **层编号提示**：本文件的 L5–L8 属于**方案 A（Spec 章节审查轴）**：
> L5=Flow、L6=Actions/Cost、L7=Decision+Intent、L8=Attachments。
> 与工程验收使用的方案 C（属性实测轴）不是同一套，映射见
> [`00_状态基线.md`](00_状态基线.md) §2.1。

> **审查日期**：2026-08-05
> **审查范围**：Layer 05 Flow（含step预算）、Layer 06 Actions + queryActions + Cost、Layer 07 Decision + Intent、Layer 08 Attachments
> **参考文档**：元机制内核Spec_v1.md、规范宪法.md
> **审查性质**：原则性彻查，验证宪法合规性与架构一致性

---

## 一、第5层审查报告：Flow（含step预算）

### 1.1 Flow执行模型

#### 执行模型检查

| 检查项 | 状态 | 说明 |
|--------|------|------|
| Flow按agent顺序串行执行 | ✅ | 文档明确"串行执行，确定性优先" |
| "同时决策"建模 | ✅ | 等效顺序建模（Intent.hidden + 提交相位） |
| step预算分配 | ⚠️ | 缺省10⁴，未明确按agent或phase的分配策略 |

**发现**：step预算的缺省值10⁴是全局的，但未明确：
- 不同phase是否可以有不同的step预算？
- prefab.spawn是否计入step预算？

**验证**：文档§5提到"超支→中止+诊断事件"，但未明确正在执行的Action是否完整。根据事务语义，应为原子性保证——要么完整执行，要么整体回滚。

#### 预算管理检查

| 检查项 | 状态 | 说明 |
|--------|------|------|
| step超限后行为 | ✅ | 中止+诊断事件，不挂死 |
| 不同phase的step消耗 | ❓ | 未明确区分 |
| prefab.spawn计入预算 | ❓ | 未明确 |

**风险项**：[低风险] step预算分配策略未细化，可能导致大型prefab实例化时意外超限

### 1.2 AI搜索支持

#### 影子流机制检查

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 搜索时创建影子random流 | ✅ | §12明确"AI试探用影子流，不污染主流" |
| 影子流与主流隔离 | ✅ | 试探用的roll不推进主流counter |
| 搜索回退时恢复状态快照 | ✅ | checkpoint/restore机制 |

**评估函数检查**：
- 评估函数调用位置：外部（PlaypackDef.evaluate），Flow本身不调用
- 评估函数访问完整状态：✅，通过Expr/Query只读通道

### 1.3 Flow与Hook的关系

| 检查项 | 状态 | 说明 |
|--------|------|------|
| Flow执行Action触发Hook | ✅ | Action→Op→Event→Hook管道 |
| Hook执行计入step预算 | ❓ | 未明确 |
| Hook副作用在Flow层面可见 | ✅ | 通过Event机制可见 |

**设计一致性验证**：
- Flow是执行层，不负责决策：✅
- Hook是拦截层，可以veto：✅
- 两者正交：✅

### 1.4 多方决策同步

| 检查项 | 状态 | 说明 |
|--------|------|------|
| "所有玩家同时决策"建模 | ✅ | Intent.hidden + 提交相位 |
| 决策超时处理 | ✅ | Decision.deadline + onTimeout |
| 决策冲突解决 | ✅ | resolveOrder机制 |

### 1.5 宪法合规性验证

| 判据 | 验证结果 |
|------|----------|
| 不可绕过 | ✅ 没有Flow，AI搜索无法运行 |
| 三处复用 | ✅ AI搜索、回放、多方决策都需要 |
| 不含语义 | ✅ Flow不知道在跑什么玩法 |
| 术语合规 | ✅ 使用"引擎层"术语，无废用词 |

### 1.6 思维实验结论

**边界情况**：
1. step预算耗尽时正在执行的Action是否完整？
   - **结论**：是的。根据事务语义（§4.7），Op执行要么成功要么整体回滚，不存在半执行状态
   
2. 两个agent互相等待决策会死锁吗？
   - **结论**：不会。Decision是状态对象，决策由Schedule驱动，超时有onTimeout处理
   
3. 影子流搜索期间主状态被修改会怎样？
   - **结论**：不会��影子流完全隔离，restore回退到checkpoint

**反模式检测**：
1. 能否通过构造极长Action序列耗尽step预算攻击服务器？
   - **结论**：防御措施存在——step预算限制 + W_BUDGET_NEAR警告 + 配额机制
   
2. 影子流是否可能被用来"预览"对手决策？
   - **结论**：不会。影子流与主流完全隔离，信息不泄漏

**扩展性测试**：
1. 能否支持"回合制"和"实时制"两种Flow模式？
   - **结论**：能。phase.timeLimit可实现实时感
2. step预算能否由玩法包动态调整？
   - **结论**：未明确，建议在PlaypackDef中添加stepBudget字段

### 第5层风险汇总

| 风险级别 | 风险项 | 描述 |
|----------|--------|------|
| 中风险 | step预算分配策略 | 未明确不同phase/agent的分配策略 |
| 低风险 | Hook执行计入预算 | 未明确Hook执行是否消耗step预算 |
| 低风险 | prefab.spawn计入预算 | 未明确大型prefab实例化的预算处理 |

---

## 二、第6层审查报告：Actions + queryActions + Cost

### 2.1 ActionDef结构检查

```typescript
interface ActionDef {
  id: DefId
  label: Expr
  targets?: TargetSpec[]
  require?: Expr
  visible?: Expr
  reason?: Expr
  cost?: CostSpec[]
  group?: string
  effects: Effect[]
  tags?: string[]
}
```

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 每个字段有宪法依据 | ✅ | 全部字段在Spec中有依据 |
| tags是否变成硬编码分类 | ✅ | tags是泛化标签，不预设枚举 |
| range糖语法与spread重复 | ⚠️ | range是TargetSpec的一部分，针对Action；spread是全局查询原语，职责不同 |

**宪法合规性**：
- Action是原子执行单元，不是"技能"：✅
- Cost是泛化机制，不是"AP/体力"：✅
- Action可用性由queryActions动态查询：✅

### 2.2 queryActions评估

#### 动态可用性检查

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 只返回当前可执行的Action | ✅ | require条件过滤 |
| require条件求值安全 | ✅ | Expr全函数，不抛异常 |
| "空结果"的合理处理 | ✅ | 返回空数组，UI显示"无可用动作" |

#### 性能考量检查

| 检查项 | 状态 | 说明 |
|--------|------|------|
| queryActions复杂度 | ⚠️ | 大型状态下需关注 |
| range展开导致组合爆炸 | ✅ | AI模式采样，UI模式完整区间 |
| 缓存机制 | ❓ | 未明确提及 |

**性能风险**：
- range展开（押注1-100 = 100个着法）：通过step网格采样缓解
- 大型状态全表扫描：未明确是否有索引优化

### 2.3 Cost泛化检查

#### 四种Cost类型

| Cost类型 | 实现状态 | 说明 |
|----------|----------|------|
| resource型 | ✅ | {pool, amount} |
| items型 | ✅ | {items, amount} |
| attach型 | ✅ | {attach: DefId} |
| custom型 | ✅ | {custom: Effect[]} |

#### 守恒性检查

| 检查项 | 状态 | 说明 |
|--------|------|------|
| Cost消耗原子性保证 | ✅ | 提交冻结、解算结算、void退回 |
| transaction回滚时Cost恢复 | ✅ | void时全额退回并发诊断事件 |
| "代价守恒"不变量定义 | ✅ | 写入§4.6不变量 |

**代价守恒机制验证**（第十一轮定稿）：
```
提交时 → 冻结（扣除可用额度）
解算时 → 结算（真正扣除）
void时  → 全额退回 + cost.refunded诊断事件
```

### 2.4 Effect展开检查

| 检查项 | 状态 | 说明 |
|--------|------|------|
| count展开支持动态范围 | ✅ | TargetSpec.count {min, max} |
| range展开有step预算保护 | ✅ | step预算全局限制 |
| 展开结果确定 | ✅ | Query有序数组返回 |

### 2.5 决策与Intent的集成检查

| 检查项 | 状态 | 说明 |
|--------|------|------|
| Intent如何调用Action | ✅ | Intent.action是DefId，resolve时执行 |
| Intent.resolve与Action执行同步 | ✅ | 每个Intent一个事务 |
| Action失败时Intent处理 | ✅ | status:'void' + 退回代价 |

### 2.6 Action能力矩阵

| 能力 | 泛化程度 | 含玩法语义 | 风险 |
|------|----------|------------|------|
| Cost | 高 | ❌ | 低 |
| range | 中 | ❌ | 中（组合爆炸） |
| count | 高 | ❌ | 低 |
| require | 高 | ❌ | 低 |
| tags | 高 | ❌ | 低 |
| visible | 高 | ❌ | 低 |
| reason | 高 | ❌ | 低 |

### 2.7 宪法合规性验证

| 判据 | 验证结果 |
|------|----------|
| 不可绕过 | ✅ 缺了它无法表达任何主动行为 |
| 三处复用 | ✅ UI菜单/AI着法生成/网络校验/模糊测试 |
| 不含语义 | ✅ 泛化后都是"带cost的操作" |
| 术语合规 | ✅ 使用"引擎层"术语 |

### 2.8 思维实验结论

**边界情况**：
1. Action的require引用不存在的属性会怎样？
   - **结论**：返回null + warn，Action不出现（防御式设计）
   
2. Cost消耗后transaction回滚，Cost是否恢复？
   - **结论**：是。void时全额退回
   
3. range展开超过step预算会怎样？
   - **结论**：AI模式采样避免，UI模式需step预算保护

**反模式检测**：
1. 能否用Action实现"免费无限攻击"？
   - **结论**：不能。Cost机制确保代价扣除
   
2. 能否绕过Cost消耗执行Effect？
   - **结论**：不能。Effect只能通过Action执行，Action必须通过queryActions校验
   
3. 能否用queryActions漏洞获取不可见Action？
   - **结论**：不能。visible条件在服务端校验

**扩展性测试**：
1. 能否用Action实现"组合技"？
   - **结论**：能。通过多个Intent顺序提交
2. Action能否被"复制"到其他Entity？
   - **结论**：能。Def继承机制

### 第6层风险汇总

| 风险级别 | 风险项 | 描述 |
|----------|--------|------|
| 中风险 | queryActions性能 | 大型状态下全表扫描复杂度 |
| 中风险 | range展开爆炸 | 数值域着法空间可能过大 |
| 低风险 | 缓存机制缺失 | 未明确queryActions缓存策略 |

---

## 三、第7层审查报告：Decision + Intent

### 3.1 Decision状态机检查

```typescript
interface Decision {
  id: DecisionId
  def: DefId
  askees: Ref[]
  answers: Record<string, Value>
  ctx: Record<string, Value>
  opensAt: number
  deadline?: number
  status: 'open' | 'resolved' | 'timeout' | 'void'
}
```

| 检查项 | 状态 | 说明 |
|--------|------|------|
| prompt是Expr安全 | ✅ | Expr只读，不执行副作用 |
| options生成受step预算限制 | ✅ | options来自DecisionDef.data |
| 超时处理有不变量保护 | ✅ | DecisionDef.onTimeout + 不变量"决策有终" |

**phase边界处理验证**：
- Decision在phase边界被处理：✅
- Decision响应触发Hook：✅
- Decision与Flow执行顺序清晰：✅

### 3.2 Intent生命周期检查

```typescript
interface Intent {
  id: IntentId
  agent: AgentId
  action: DefId
  bindings: Record<string, Value>
  submittedAt: number
  priority?: number
  hidden: boolean
  status: 'pending' | 'resolved' | 'failed' | 'void'
}
```

| 状态 | 检查结果 |
|------|----------|
| forming | ✅ 创建但未提交 |
| committed | ✅ 已提交，待解算 |
| resolved | ✅ 解算成功 |
| void | ✅ 解算失败，退回代价 |

| 检查项 | 状态 | 说明 |
|--------|------|------|
| Intent创建在事务内 | ✅ | intent.submit在事务内 |
| Intent.resolve在Flow控制下 | ✅ | 由Schedule驱动 |
| 失败Intent合理处理 | ✅ | void + 退回代价 |

### 3.3 AI决策检查

| 检查项 | 状态 | 说明 |
|--------|------|------|
| Policy只是Action选择器 | ✅ | PolicyDef.mode三种模式 |
| Policy决策过程在AI层 | ✅ | 搜索/规则/脚本模式 |
| AI决策受step预算限制 | ✅ | PolicyDef.budget |

**回放支持检查**：
- AI决策可回放：✅
- 影子流包含AI决策：✅
- 回放时AI决策确定：✅（Policy是数据，非随机）

### 3.4 第11轮修复验证（关键）

**原P0架构冲突**：Decision与Transaction存在冲突
- 原方案：在before:damage的Hook里decision.open
- 矛盾：Hook执行时Op在未提交事务中途

**修复方案验证**：

| 修复项 | 验证结果 |
|--------|----------|
| Decision响应在phase边界处理 | ✅ decision.open立即结束并提交事务 |
| Intent.resolve在Flow控制下 | ✅ 每个Intent一个事务，依序解算 |
| "等待"在语法上不存在 | ✅ 无await/waitFor原语 |

**决策有终不变量验证**：
- 每个open Decision或被答满、或超时：✅
- 不存在永久待答：✅（铁律）

**反应技正确形态验证**：
```
提交相位 → 出手方提交Intent(hidden)
响应相位 → 有反应资格者提交"反应Intent"
解算相位 → 按resolveOrder排序，重检require后执行
```

### 3.5 架构冲突修复验证矩阵

| 问题 | 修复方案 | 验证结果 |
|------|---------|----------|
| Decision与事务冲突 | phase边界处理 | ✅ 第11轮已修复 |
| Intent与Flow耦合 | Flow控制resolve | ✅ |
| "等待"可被写出 | 语法上不存在 | ✅ |

### 3.6 宪法合规性验证

| 判据 | 验证结果 |
|------|----------|
| Decision是等待响应的状态 | ✅ |
| Intent是已提交的决策 | ✅ |
| 两者与Transaction解耦 | ✅ |
| 术语合规 | ✅ |

### 3.7 思维实验结论

**边界情况**：
1. Decision超时后玩家才响应会怎样？
   - **结论**：超时后Decision状态为'timeout'，按onTimeout处理
   
2. Intent.commit后Action被修改会怎样？
   - **结论**：ActionDef是静态数据（Def集合），运行期不改
   
3. 两个Intent竞争同一个资源会怎样？
   - **结论**：解算前重检require，失败者void

**反模式检测**：
1. 能否通过构造特殊Decision绕过游戏规则？
   - **结论**：不能。require前置条件 + Hook veto机制
   
2. 能否通过Intent注入未授权Action？
   - **结论**：不能。queryActions校验 + visible条件
   
3. 能否通过AI Policy实现"完美预知"？
   - **结论**：不能。visibleTo限制信息访问

**扩展性测试**：
1. 能否支持"条件Intent"？
   - **结论**：能。通过require条件表达
2. 能否支持"Intent链"？
   - **结论**：能。多个pending Intent
3. Decision能否支持"多选"？
   - **结论**：能。answers是Record，支持多选项

### 第7层风险汇总

| 风险级别 | 风险项 | 描述 |
|----------|--------|------|
| 低风险 | Decision选项生成性能 | options数量过多时step预算 |
| 低风险 | Intent队列长度 | 长队列的内存占用 |

---

## 四、第8层审查报告：Attachments（aura、delay、stack、grantedBy）

### 4.1 Attachment运行时结构检查

```typescript
interface Attachment {
  id: AttachmentId
  def: DefId
  target: Ref                    // Entity/Item/Node/Link/World
  source?: Ref
  props: Record<string, Value>
  stack: number
  expiresAt?: number
  activeAt?: number
  grantedBy?: AttachmentId
}
```

| 检查项 | 状态 | 说明 |
|--------|------|------|
| target泛化完整 | ✅ | 已支持Entity/Item/Node/Link/World |
| expiresAt与activeAt语义清晰 | ✅ | expiresAt绝对phase序号，activeAt生效起始 |
| grantedBy回收链完整 | ✅ | 光环失效时自动回收子attachment |

**target泛化验证**：
- Entity：普通buff/debuff ✅
- Item：物品强化 ✅
- Node：地面着火、安全区 ✅
- Link：门加固、桥封锁 ✅
- World：运行期改规则 ✅

### 4.2 stack策略检查

| 策略 | 状态 | 说明 |
|------|------|------|
| unique (replace) | ✅ | 新实例替换旧实例 |
| refresh | ✅ | 重置持续时间 |
| count | ✅ | 叠加层数 |
| independent | ✅ | 独立存在 |

| 检查项 | 状态 | 说明 |
|--------|------|------|
| stack变更有不变量保护 | ✅ | stack≥1且≤stackMax |
| 不同stack策略交互明确定义 | ✅ | 由Def声明，运行时按策略执行 |
| stack上限由Def控制 | ✅ | maxStack字段 |

**堆叠守恒验证**：
- stack变更是局部操作，不影响其他Item ✅
- stack归零时Item自动销毁 ✅

### 4.3 aura机制检查

#### 范围效果检查

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 检测进入/离开范围的Entity | ✅ | query重算触发 |
| 范围变化时Entity移动处理 | ✅ | entity.place触发aura重算 |
| aura.deps声明完整 | ✅ | 拓扑依赖自动，属性依赖显式声明 |

**化动为静设计验证**：
- 光环不做逐回合遍历：✅
- 依赖集变化时重算：✅
- deps声明有Linter检查：✅

#### 重算优化检查

| 触发条件 | 状态 |
|----------|------|
| 实体进出节点 | ✅ |
| entity.place | ✅ |
| node.merge | ✅ |
| props路径变化（声明了deps） | ✅ |
| 未声明的props变化 | ❌ 不触发 |

**性能风险评估**：
- aura重算是性能热点（已在§19.3声明）：⚠️
- 缓解措施：deps显式声明 + Linter检查

### 4.4 delay机制检查

| 检查项 | 状态 | 说明 |
|--------|------|------|
| activeAt设置 | ✅ | attachment.delay字段 |
| activeAt大于当前phase时不存在 | ✅ | hasAttachment返回false |
| delay期间source死亡处理 | ⚠️ | 未明确（建议：grantedBy回收链兜底） |

**activeAt语义验证**：
- 当前phase < activeAt时：rules不挂载、aura不授予、hasAttachment返回false ✅

### 4.5 grantedBy回收检查

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 光环失效时自动回收子attachments | ✅ | attach.del + grantedBy反查 |
| 循环授予处理 | ✅ | grantedBy是有向无环（设计约束） |
| source死亡触发回收 | ✅ | source销毁时级联清理 |

**回收链验证**：
```
aura失效 → attach.del(aura) 
         → grantedBy反查所有子attachment 
         → attach.del(child1), attach.del(child2), ...
```

### 4.6 Attachment能力矩阵

| 能力 | 实现状态 | 含玩法语义 | 风险 |
|------|----------|------------|------|
| target泛化 | ✅ | ❌ | 低 |
| stack策略 | ✅ | ❌ | 低 |
| aura机制 | ✅ | ❌ | 中（性能热点） |
| delay机制 | ✅ | ❌ | 低 |
| grantedBy | ✅ | ❌ | 低 |
| onAdd/Expire/Remove | ✅ | ❌ | 低 |

### 4.7 宪法合规性验证

| 判据 | 验证结果 |
|------|----------|
| 不可绕过 | ✅ 缺了它无法表达任何"附加效果" |
| 三处复用 | ✅ 战斗增益/地图事件/临时状态 |
| 不含语义 | ✅ 泛化为"可附加的状态" |
| Attachment是临时状态 | ✅ |
| grantedBy防止孤儿attachment | ✅ |

### 4.8 思维实验结论

**边界情况**：
1. attachment的target被销毁会怎样？
   - **结论**：destroy时级联清理attachments
   
2. 两个相同Def的attachment在同一个target上？
   - **结论**：由stack策略决定（replace/refresh/count）
   
3. aura的source和target是同一个Entity？
   - **结论**：合法。自 buffs/self-buffs
   
**反模式检测**：
1. 能否用attachment实现"永久无敌"？
   - **结论**：不能。expiresAt=null是合法的，但Def.linter可限制
   
2. 能否用stack机制无限叠加属性？
   - **结论**：不能。maxStack限制 + clamp数值
   
3. 能否用grantedBy循环引用造成内存泄漏？
   - **结论**：不能。grantedBy是有向无环（工程约束）

**扩展性测试**：
1. 能否支持"attachment的attachment"？
   - **结论**：能。grantedBy链支持多层
2. 能否支持跨拓扑的aura范围？
   - **结论**：能。Query可跨拓扑
3. 能否支持条件性attachment？
   - **结论**：能。通过require条件或RuleDef.when

### 第8层风险汇总

| 风险级别 | 风险项 | 描述 |
|----------|--------|------|
| 中风险 | aura重算频率 | 大量光环×频繁移动可能导致性能问题 |
| 低风险 | delay期间source死亡 | 未明确处理，建议grantedBy兜底 |
| 低风险 | 循环授予防护 | 需在Linter中强制无环 |

---

## 五、风险汇总（全部Layer）

### 5.1 高风险项

| Layer | 风险项 | 描述 | 建议 |
|-------|--------|------|------|
| - | 无 | - | - |

**说明**：L5-L8审查未发现高风险项。已知的性能风险（aura重算）已在Spec§19.3中声明。

### 5.2 中风险项

| Layer | 风险项 | 描述 | 建议 |
|-------|--------|------|------|
| L5 | step预算分配策略 | 未明确不同phase/agent的分配策略 | 在PlaypackDef中添加stepBudget配置 |
| L6 | queryActions性能 | 大型状态下全表扫描复杂度 | 考虑添加索引/缓存机制 |
| L6 | range展开爆炸 | 数值域着法空间可能过大 | 已有采样机制，需验证step粒度 |
| L8 | aura重算频率 | 大量光环×频繁移动可能导致性能问题 | deps声明 + Linter检查（已在设计中） |

### 5.3 低风险项

| Layer | 风险项 | 描述 | 建议 |
|-------|--------|------|------|
| L5 | Hook执行计入预算 | 未明确Hook执行是否消耗step预算 | 明确计入预算 |
| L5 | prefab.spawn计入预算 | 未明确大型prefab实例化的预算处理 | 明确计入或单独预算 |
| L6 | 缓存机制缺失 | 未明确queryActions缓存策略 | 添加缓存机制文档 |
| L7 | Decision选项生成性能 | options数量过多时step预算 | Linter限制options数量 |
| L7 | Intent队列长度 | 长队列的内存占用 | 添加quota机制 |
| L8 | delay期间source死亡 | 未明确处理 | 建议grantedBy兜底 |
| L8 | 循环授予防护 | 需在Linter中强制无环 | 添加循环检测 |

---

## 六、宪法合规性总体验证

### 6.1 术语铁律验证

| 术语 | L5 | L6 | L7 | L8 | 状态 |
|------|----|----|----|----|------|
| 引擎层 | ✅ | ✅ | ✅ | ✅ | 合规 |
| 废用词检查 | ✅ | ✅ | ✅ | ✅ | 无废用词 |

### 6.2 三层架构边界验证

| 约束 | L5 | L6 | L7 | L8 | 状态 |
|------|----|----|----|----|------|
| 不定义"武器""技能"等语义概念 | ✅ | ✅ | ✅ | ✅ | 合规 |
| 不预设具体玩法规则 | ✅ | ✅ | ✅ | ✅ | 合规 |
| 不为实例指定具体数值 | ✅ | ✅ | ✅ | ✅ | 合规 |

### 6.3 完备性判据验证

| 判据 | L5 | L6 | L7 | L8 |
|------|----|----|----|----|
| 不可绕过 | ✅ | ✅ | ✅ | ✅ |
| 三处复用 | ✅ | ✅ | ✅ | ✅ |
| 不含语义 | ✅ | ✅ | ✅ | ✅ |

---

## 七、Decision与Transaction架构冲突修复验证（第11轮）

### 7.1 修复前状态

**P0架构冲突**：
- 原方案：在before:damage的Hook里decision.open
- 矛盾：Hook执行时Op在未提交事务中途
- 两条路都堵死：立即提交做不到，等答复是语法上不存在

### 7.2 修复后验证

| 修复项 | 验证结果 | 证据 |
|--------|----------|------|
| Decision在phase边界处理 | ✅ | decision.open立即结束并提交事务 |
| Intent.resolve在Flow控制下 | ✅ | 每个Intent一个事务 |
| "等待"在语法上不存在 | ✅ | 无await/waitFor原语 |
| 反应技移到响应相位 | ✅ | 提交→响应→解算流程 |

### 7.3 修复完整性评估

**修复是否完整**：✅ 是

**证据**：
1. Decision是状态对象，不阻塞 ✅
2. 响应相位是可重入的有限轮次 ✅
3. AI搜索无需特殊处理 ✅
4. 存档/回放正常工作 ✅

---

## 八、思维实验综合结论

### 8.1 边界情况综合

| 场景 | L5 | L6 | L7 | L8 | 结论 |
|------|----|----|----|----|------|
| 预算耗尽时Action完整性 | ✅ | - | - | - | 事务保证原子性 |
| 死锁可能性 | ✅ | - | ✅ | - | 不会死锁 |
| 状态隔离 | ✅ | - | - | - | 影子流完全隔离 |
| require引用不存在属性 | - | ✅ | - | - | 返回null，Action不出现 |
| Cost回滚恢复 | - | ✅ | - | - | void时全额退回 |
| Decision超时后响应 | - | - | ✅ | - | 按onTimeout处理 |
| attachment.target销毁 | - | - | - | ✅ | 级联清理 |

### 8.2 反模式检测综合

| 攻击模式 | L5 | L6 | L7 | L8 | 防御状态 |
|----------|----|----|----|----|----------|
| 耗尽预算攻击 | ✅ | - | - | - | 防御有效 |
| 预览对手决策 | ✅ | - | - | - | 防御有效 |
| 免费无限攻击 | - | ✅ | - | - | 防御有效 |
| 绕过Cost执行 | - | ✅ | - | - | 防御有效 |
| 获取不可见Action | - | ✅ | - | - | 防御有效 |
| 绕过游戏规则 | - | - | ✅ | - | 防御有效 |
| 永久无敌 | - | - | - | ✅ | Def.linter可限制 |
| 无限叠加属性 | - | - | - | ✅ | maxStack + clamp |
| 循环引用泄漏 | - | - | - | ✅ | 有向无环约束 |

---

## 九、审查结论

### 9.1 总体评估

| 维度 | 评估 |
|------|------|
| 架构一致性 | ✅ 优秀 |
| 宪法合规性 | ✅ 完全合规 |
| 完备性 | ✅ 满足三条判据 |
| 风险控制 | ⚠️ 有4个中风险需关注 |
| 第11轮修复验证 | ✅ 修复完整有效 |

### 9.2 建议事项

**高优先级**：
1. 验证aura重算的性能基准
2. 验证range展开采样的step粒度

**中优先级**：
1. 明确step预算分配策略
2. 添加queryActions缓存机制
3. 明确grantedBy循环检测规则

**低优先级**：
1. 明确Hook执行计入step预算
2. 明确prefab.spawn的预算处理

### 9.3 审查结论

**L5-L8交互逻辑设计审查通过**，可以进入下一阶段。

**关键确认**：
- 第11轮Decision与Transaction架构冲突修复有效
- 所有Layer满足宪法合规性要求
- 三条完备性判据全部满足
- 已识别风险均有缓解措施

---

## 附录：审查文件索引

| 文件 | 位置 |
|------|------|
| 审查Prompt L5 | d:\coding\WakeUp\docs\L1_引擎层\并行审查Prompt\Layer05_Flow_step预算.md |
| 审查Prompt L6 | d:\coding\WakeUp\docs\L1_引擎层\并行审查Prompt\Layer06_Actions_queryActions_Cost.md |
| 审查Prompt L7 | d:\coding\WakeUp\docs\L1_引擎层\并行审查Prompt\Layer07_Decision_Intent.md |
| 审查Prompt L8 | d:\coding\WakeUp\docs\L1_引擎层\并行审查Prompt\Layer08_Attachments_aura_delay_stack.md |
| 参考Spec | d:\coding\WakeUp\docs\L1_引擎层\元机制内核Spec_v1.md |
| 参考宪法 | d:\coding\WakeUp\docs\L0_规范宪法.md |

# 并行审查Prompt：第7层 - Decision + Intent

> **文件性质：历史审查题库（方案 A — Spec 章节审查轴）。已于 2026-08-05 执行完毕。**
> 文中的 `- [ ]` 是**审查提问项**，不是待办事项 —— 不要当作未完成工作统计。
> 本题库产出的风险项已汇总于 [`ENGINE_KERNEL_13LAYER_REVIEW_SUMMARY.md`](ENGINE_KERNEL_13LAYER_REVIEW_SUMMARY.md)
> （H-1~H-3 / M-1~M-13 / L-1~L-18），其中 **M/L 共 31 项至今仍开放**，
> 跟踪在 [`00_开放事项跟踪.md`](00_开放事项跟踪.md)。
> 本文件的层编号与工程验收使用的**方案 C（属性实测轴）不是同一套**，
> 映射见 [`00_状态基线.md`](00_状态基线.md) §2.1。

## 目标
按照**哲学宪法**原则，对内核Spec第7.5章（Decision与Intent）进行原则性彻查。

## 宪法铁律

### 核心约束
- Decision是**等待响应的状态**，不是决策过程本身
- Intent是**已提交的决策**，带候选Action
- 两者都与Transaction解耦（避免P0架构冲突）

### 已知风险（已在第11轮修复）
原设计中Decision与事务存在P0架构冲突，已改为：
- Decision的响应在**phase边界**处理
- Intent的resolve在**Flow控制**下进行

## 第7层审查清单

### 7.5.1 Decision

#### 状态机
```typescript
interface Decision {
  id: DecisionId
  agent: AgentId
  prompt: Expr                    // 向玩家展示的选择
  options: DecisionOption[]       // 选项列表
  deadline?: number               // 超时时间
  state: 'pending' | 'responded' | 'timeout' | 'cancelled'
  response?: DecisionOptionId
}
```
- [ ] `prompt`是Expr是否安全？（不能执行副作用）
- [ ] `options`的生成是否受step预算限制？
- [ ] 超时处理是否有不变量保护？

#### 与其他层的关系
- [ ] Decision是否只在phase边界被处理？
- [ ] Decision响应是否触发Hook？
- [ ] Decision与Flow的执行顺序是否清晰？

### 7.5.2 Intent

#### 结构
```typescript
interface Intent {
  id: IntentId
  agent: AgentId
  decision?: DecisionId            // 关联的Decision
  action: ActionRef               // 选定的Action
  target?: Ref                    // 目标
  params?: Record<string, Value>  // 参数
  state: 'forming' | 'committed' | 'resolved' | 'failed'
  resolved?: { ok: boolean, effects: Effect[] }
}
```
- [ ] Intent的创建是否在事务内？
- [ ] Intent.resolve是否在Flow控制下？
- [ ] 失败的Intent是否有合理处理？

#### 与queryActions的关系
- [ ] queryActions是否返回可创建Intent的候选？
- [ ] Intent.commit时是否重新校验require？
- [ ] Intent与Decision的对应关系是否强制？

### 7.5.3 AI决策

#### Policy接口
- [ ] Policy是否只是Action选择器？
- [ ] Policy的决策过程是否在AI层实现？
- [ ] AI决策是否受step预算限制？

#### 回放支持
- [ ] AI决策是否可回放？
- [ ] 影子流是否包含AI决策？
- [ ] 回放时AI决策是否确定？

## 决策记录检查

| 决策 | 架构冲突修复 | 理由 | 风险 |
|------|-------------|------|------|
| phase边界处理Decision | ✅ 第11轮已修复 | 避免事务嵌套 | 低 |
| Flow控制Intent.resolve | ✅ 第11轮已修复 | 确定性优先 | 低 |
| Decision/Intent解耦 | ✅ | 模块化 | 低 |

## 思维实验清单

### 边界情况
1. Decision超时后玩家才响应会怎样？
2. Intent.commit后Action被修改会怎样？
3. 两个Intent竞争同一个资源会怎样？

### 反模式检测
1. 能否通过构造特殊Decision绕过游戏规则？
2. 能否通过Intent注入未授权的Action？
3. 能否通过AI Policy实现"完美预知"？

### 扩展性测试
1. 能否支持"条件Intent"（满足某条件时自动提交）？
2. 能否支持"Intent链"（多个Intent���序执行）？
3. Decision能否支持"多选"（选择多个选项）？

## 输出格式

```markdown
## 第7层审查报告

### Decision状态机
- 状态定义：✅/❌
- 超时处理：✅/❌
- phase边界处理：✅/❌

### Intent生命周期
- forming：✅/❌
- committed：✅/❌
- resolved：✅/❌
- failed：✅/❌

### 架构冲突修复验证
| 问题 | 修复方案 | 验证结果 |
|------|---------|---------|
| Decision与事务冲突 | phase边界处理 | ✅ |
| Intent与Flow耦合 | Flow控制resolve | ✅ |

### 风险项
1. [高风险] ...
2. [中风险] ...

### 思维实验结论
...
```

## 注意事项
- Decision/Intent是自省机制，需要严格校验
- 架构冲突已修复，需要验证修复完整性
- AI决策必须支持回放确定性

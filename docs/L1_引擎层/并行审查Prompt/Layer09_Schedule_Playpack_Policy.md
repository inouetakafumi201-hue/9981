# 并行审查Prompt：第9层 - Schedule + Playpack + Policy

> **文件性质：历史审查题库（方案 A — Spec 章节审查轴）。已于 2026-08-05 执行完毕。**
> 文中的 `- [ ]` 是**审查提问项**，不是待办事项 —— 不要当作未完成工作统计。
> 本题库产出的风险项已汇总于 [`ENGINE_KERNEL_13LAYER_REVIEW_SUMMARY.md`](ENGINE_KERNEL_13LAYER_REVIEW_SUMMARY.md)
> （H-1~H-3 / M-1~M-13 / L-1~L-18），其中 **M/L 共 31 项至今仍开放**，
> 跟踪在 [`00_开放事项跟踪.md`](00_开放事项跟踪.md)。
> 本文件的层编号与工程验收使用的**方案 C（属性实测轴）不是同一套**，
> 映射见 [`00_状态基线.md`](00_状态基线.md) §2.1。

## 目标
按照**哲学宪法**原则，对内核Spec第9章（调度与玩法包）进行原则性彻查。

## 宪法铁律

### 核心约束
- Schedule是**时间驱动的规则执行**，不是"回合"概念
- Playpack是**可热插拔的规则集**，不是"地图/模式"
- Policy是**AI决策的策略定义**，不是硬编码行为

### 完备性判据
Schedule能力必须满足：
| 判据 | 含义 |
|------|------|
| 不可绕过 | 没有它，规则无法按时序执行 |
| 三处复用 | 回合制/实时制/事件驱动都需要 |
| 不含语义 | 不知道在跑什么玩法 |

## 第9层审查清单

### 9.1 Schedule/Phase机制

#### PhaseDef结构
```typescript
interface PhaseDef {
  id: PhaseId
  name: string
  order: number
  type: 'action' | 'response' | 'trigger' | 'cleanup'
  maxDuration?: number             // 可选超时
  subPhases?: PhaseId[]            // 子相位序列
}
```
- [ ] `type`是否覆盖所有相位类型？
- [ ] `order`是否保证确定性？
- [ ] `subPhases`是否支持嵌套？

#### 定时器
- [ ] `delay`定时器是否支持绝对phase？
- [ ] 定时器取消是否正确清理（第十轮回补）？
- [ ] 多个定时器同时触发是否按order排序？

#### reactionRounds（第十轮回补）
- [ ] `reactionRounds`是否正确声明？
- [ ] 反应回合与主动回合的step预算是否分开？
- [ ] 反应超时是否触发默认行为？

### 9.2 Playpack装载

#### 依赖管理
```typescript
interface PlaypackDef {
  id: PlaypackId
  requires?: PlaypackId[]          // 硬依赖
  conflicts?: PlaypackId[]         // 互斥
  overrides?: DefOverride[]        // 同名Def覆盖
  ...其他字段
}
```
- [ ] `requires`循环依赖是否被检测？
- [ ] `conflicts`检测时机是加载期还是运行期？
- [ ] `overrides`是否支持多层级？

#### 可见性（第十轮回补）
- [ ] `visibility`是否在PlaypackDef中？
- [ ] 玩法包是否支持运行时切换？
- [ ] 切换时状态迁移是否安全？

#### 日志保留（第十轮回补）
- [ ] `logRetention`是否在PlaypackDef中？
- [ ] 日志大小是否有上限？
- [ ] 超限后是否自动清理？

### 9.3 Policy与AI

#### PolicyDef结构（第十一轮回补）
```typescript
interface PolicyDef {
  id: PolicyId
  target: AgentId | AgentTag       // 适用的Agent
  budget?: { steps: number, time: number }
  fallback?: PolicyId              // 兜底策略
  rules: DecisionRule[]            // 决策规则
}
```
- [ ] `budget`控制是否与step预算联动？
- [ ] `fallback`是否防止死锁？
- [ ] `rules`是否支持优先级？

#### 守卫范式
- [ ] 守卫行为是否由Policy定义？
- [ ] NPC行为是否可预测（确定性）？
- [ ] Policy是否支持条件分支？

## 决策记录检查

| 决策 | 理由 | 风险 |
|------|------|------|
| Phase正交化 | 回合/实时都是Schedule | 低 |
| Playpack热插拔 | 支持局内强化/赛季规则 | 中 |
| Policy泛化 | AI行为不是硬编码 | 低 |
| reactionRounds回补 | 第十轮发现缺失 | 低 |
| visibility/logRetention回补 | 第十轮发现缺失 | 低 |
| PolicyDef完整引用 | 第十一轮发现缺失 | 低 |

## 思维实验清单

### 边界情况
1. 两个Playpack互相requires对方会怎样？
2. "每3回合执行一次"如何用Schedule实现？
3. Policy能否被运行时修改（roguelike局内强化）？

### 反模式检测
1. 能否通过修改Policy实现"全知AI"？
2. 能否通过冲突的Playpack覆盖产生不一��状态？
3. 能否通过无限子相位产生死循环？

### 扩展性测试
1. 能否支持"动态相位"（根据状态调整相位序列）？
2. 能否支持"并行相位"（多个相位同时执行）？
3. Policy能否访问其他Agent的Knowledge？

## 输出格式

```markdown
## 第9层审查报告

### Schedule机制
- Phase类型完整性：✅/❌
- 定时器管理：✅/❌
- reactionRounds：✅/❌

### Playpack装载
- 依赖管理：✅/❌
- 覆盖机制：✅/❌
- 可见性与日志：✅/❌

### Policy完整性（第十一轮回补验证）
- budget控制：✅/❌
- fallback机制：✅/❌
- 决策规则：✅/❌

### 风险项
1. [高风险] ...
2. [中风险] ...

### 思维实验结论
...
```

## 注意事项
- Schedule是时间维度的抽象，不知道"回合"是什么
- Playpack是可组合的规则块，不是 monolithic 的"游戏模式"
- Policy必须支持确定性回放

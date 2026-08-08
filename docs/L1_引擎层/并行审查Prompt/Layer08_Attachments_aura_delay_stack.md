# 并行审查Prompt：第8层 - Attachments（aura、delay、stack、grantedBy）

> **文件性质：历史审查题库（方案 A — Spec 章节审查轴）。已于 2026-08-05 执行完毕。**
> 文中的 `- [ ]` 是**审查提问项**，不是待办事项 —— 不要当作未完成工作统计。
> 本题库产出的风险项已汇总于 [`ENGINE_KERNEL_13LAYER_REVIEW_SUMMARY.md`](ENGINE_KERNEL_13LAYER_REVIEW_SUMMARY.md)
> （H-1~H-3 / M-1~M-13 / L-1~L-18），其中 **M/L 共 31 项至今仍开放**，
> 跟踪在 [`00_开放事项跟踪.md`](00_开放事项跟踪.md)。
> 本文件的层编号与工程验收使用的**方案 C（属性实测轴）不是同一套**，
> 映射见 [`00_状态基线.md`](00_状态基线.md) §2.1。

## 目标
按照**哲学宪法**原则，对内核Spec第8章（Attachments系统）进行原则性彻查。

## 宪法铁律

### 核心约束
- Attachment是**临时状态附加**，不是Component
- aura是**范围效果**，需要触发重算
- delay是**时间触发**，需要生效时间管理
- grantedBy是**归因链**，用于自动回收

### 完备性判据
检查Attachment是否满足：
| 判据 | 含义 | 复用场景 |
|------|------|---------|
| 不可绕过 | 缺了它无法表达任何"附加效果" | buff/debuff/地形效果/光环 |
| 三处复用 | 至少3种不同用途 | 战斗增益/地图事件/临时状态 |
| 不含语义 | 它不知道是增益还是减益 | 泛化为"可附加的状态" |

## 第8层审查清单

### 8.1 Attachment运行时结构

```typescript
interface Attachment {
  id: AttachmentId
  def: DefId
  target: Ref                      // Entity/Item/Node/Link/World
  source?: Ref                     // 施加者
  props: Record<string, Value>
  stack: number
  expiresAt?: number               // 绝对phase序号
  activeAt?: number                // 生效起始phase
  grantedBy?: AttachmentId         // 由某个aura授予
}
```
- [ ] `target`泛化是否完整？（已支持到World）
- [ ] `expiresAt`与`activeAt`的语义是否清晰？
- [ ] `grantedBy`回收链是否完整？

### 8.2 stack策略

#### 三种策略
- [ ] `stack: 'replace'` - 新实例替换旧实例
- [ ] `stack: 'stack'` - 叠加层数
- [ ] `stack: 'refresh'` - 重置持续时间

#### 守恒性
- [ ] stack变更是否有不变量保护？
- [ ] 不同stack策略的交互是否明确定义？
- [ ] stack上限是否由Def控制？

### 8.3 aura机制

#### 范围效果
- [ ] aura如何检测进入/离开范围的Entity？
- [ ] 范围变化时（Entity移动）如何处理？
- [ ] aura的`deps`声明是否完整？

#### 重算优化
- [ ] aura重算的触发条件是什么？
- [ ] 拓扑变化时是否触发aura重算？
- [ ] 重算性能是否有保障？

### 8.4 delay机制

#### 延迟生效
- [ ] `activeAt`如何设置？
- [ ] `activeAt`大于当前phase时attachment是否视为不存在？
- [ ] delay期间source死亡如何处理？

### 8.5 grantedBy回收

#### 归因链
- [ ] aura失效时是否自动回收其授予的attachments？
- [ ] 循环授予（aura授予aura）如何处理？
- [ ] source死亡时是否触发回收？

## 决策记录检查

| 决策 | 理由 | 三处复用 | 风险 |
|------|------|---------|------|
| target泛化到World | 运行期改规则 | 局内增益/场地效果/赛季规则 | 低 |
| grantedBy回收链 | 归因无处不在 | auras失效/施法者死亡/范围离开 | 低 |
| stack策略泛化 | 叠加/替换/刷新都是需求 | 强化/刷新/叠层 | 低 |

## 思维实验清单

### 边界情况
1. attachment的target被销毁会怎样？
2. 两个相同Def的attachment在同一个target上会怎样？
3. aura的source和target是同一个Entity会怎样？

### 反模式检测
1. 能否用attachment实现"永久无敌"？
2. 能否用stack机制无限叠加属性？
3. 能否用grantedBy循环引用造成内存泄漏？

### 扩展性测试
1. 能否支持"attachment的attachment"？
2. 能否支持跨拓扑的aura范围？
3. 能否支持条件性attachment（满足某条件时失效）？

## 输出格式

```markdown
## 第8层审查报告

### Attachment能力矩阵
| 能力 | 实现状态 | 含玩法语义 | 风险 |
|------|---------|-----------|------|
| target泛化 | ✅ | ❌ | 低 |
| stack策略 | ✅ | ❌ | 低 |
| aura机制 | ✅ | ❌ | 中 |
| delay机制 | ✅ | ❌ | 低 |
| grantedBy | ✅ | ❌ | 低 |

### 不变量验证
- target有效性：✅/❌
- stack守恒：✅/❌
- grantedBy回收：✅/❌

### 风险项
1. [高风险] ...
2. [中风险] ...

### 思维实验结论
...
```

## 注意事项
- Attachment是临时状态，不是永久Component
- aura是性能热点，需要重点关注
- grantedBy是防止"孤儿attachment"的关键机制

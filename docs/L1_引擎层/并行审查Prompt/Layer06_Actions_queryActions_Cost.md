# 并行审查Prompt：第6层 - Actions + queryActions + Cost

> **文件性质：历史审查题库（方案 A — Spec 章节审查轴）。已于 2026-08-05 执行完毕。**
> 文中的 `- [ ]` 是**审查提问项**，不是待办事项 —— 不要当作未完成工作统计。
> 本题库产出的风险项已汇总于 [`ENGINE_KERNEL_13LAYER_REVIEW_SUMMARY.md`](ENGINE_KERNEL_13LAYER_REVIEW_SUMMARY.md)
> （H-1~H-3 / M-1~M-13 / L-1~L-18），其中 **M/L 共 31 项至今仍开放**，
> 跟踪在 [`00_开放事项跟踪.md`](00_开放事项跟踪.md)。
> 本文件的层编号与工程验收使用的**方案 C（属性实测轴）不是同一套**，
> 映射见 [`00_状态基线.md`](00_状态基线.md) §2.1。

## 目标
按照**哲学宪法**原则，对内核Spec第7章（Actions与成本）进行原则性彻查。

## 宪法铁律

### 核心约束
- Action是**原子执行单元**，不是"技能"
- Cost是**泛化机制**，不是"AP/体力"
- Action的可用性由queryActions动态查询，不是静态配置

### 完备性判据
检查Action是否满足：
| 判据 | 含义 | 示例 |
|------|------|------|
| 不可绕过 | 缺了它无法表达任何主动行为 | 移动、攻击、交谈 |
| 三处复用 | 至少3个不同玩法都会用 | 移动=走跑跳、攻击=砍射投 |
| 不含语义 | 它不知道是攻击还是治疗 | 泛化后都是"带cost的操作" |

## 第6层审查清单

### 7.1 ActionDef结构

```typescript
interface ActionDef {
  id: DefId
  tags: string[]                    // 'move' | 'attack' | 'interact' | ...
  require?: Expr                    // 前置条件
  cost?: Cost[]                     // 代价定义
  effects: Effect[]                 // 效果定义
  range?: { type: 'radius'|'cone'|'line', value: Expr }
  target?: 'single' | 'multi' | 'self'
  ...其他字段
}
```
- [ ] 每个字段是否都有宪法依据？
- [ ] `tags`是否会变成硬编码分类？
- [ ] `range`的糖语法是否与spread重复？

### 7.2 queryActions

#### 动态可用性
- [ ] queryActions是否只返回当前可执行的Action？
- [ ] require条件的求值是否安全？
- [ ] 是否有"空结果"的合理处理？

#### 性能考量
- [ ] queryActions在大型状态下的复杂度？
- [ ] `range`展开是否会导致组合爆炸？
- [ ] 是否有缓存机制？

### 7.3 Cost泛化

#### 四种Cost类型
- [ ] resource型：任意属性消耗
- [ ] cooldown型：时间限制
- [ ] condition型：前置状态消耗
- [ ] charge型：次数限制

#### 守恒性
- [ ] Cost消耗是否有原子性保证？
- [ ] transaction回滚时Cost是否恢复？
- [ ] "代价守恒"不变量是否被明确定义？

### 7.4 Effect展开

#### 粒度控制
- [ ] `count`展开是否支持动态范围？
- [ ] `range`展开是否有step预算保护？
- [ ] 展开结果是否确定？

### 7.5 决策与Intent的集成

- [ ] Intent如何调用Action？
- [ ] Intent的resolve与Action的执行是否同步？
- [ ] Action失败时Intent如何处理？

## 决策记录检查

| 决策 | 理由 | 三处复用 | 风险 |
|------|------|---------|------|
| Cost泛化 | AP/体力/魔法都是Cost | 3+种资源系统 | 低 |
| queryActions | 静态配置无法处理动态状态 | AI搜索/UI显示/验证 | 低 |
| Action标签 | 代替硬编码分类 | 权限/可用性/分类 | 低 |

## 思维实验清单

### 边界情况
1. Action的require引用了一个不存在的属性会怎样？
2. Cost消耗后transaction回滚，Cost是否恢复？
3. range展开超过step预算会怎样？

### 反模式检测
1. 能否用Action实现"免费无限攻击"？
2. 能否绕过Cost消耗执行Effect？
3. 能否用queryActions的漏洞获取不可见Action？

### 扩展性测试
1. 能否用Action实现"组合技"（多个Action顺序执行）？
2. Action能否被"复制"到其他Entity？
3. 能否实现"条件Action"（满足某条件时自动执行）？

## 输出格式

```markdown
## 第6层审查报告

### Action能力矩阵
| 能力 | 泛化程度 | 含玩法语义 | 风险 |
|------|---------|-----------|------|
| Cost | 高 | ❌ | 低 |
| range | 中 | ❌ | 中 |
| require | 高 | ❌ | 低 |

### queryActions评估
- 完整性：✅/❌
- 性能：...
- 缓存机制：...

### Cost守恒性
- 原子性：✅/❌
- 回滚恢复：✅/❌
- 不变量定义：✅/❌

### 风险项
1. [高风险] ...
2. [中风险] ...

### 思维实验结论
...
```

## 注意事项
- Action是"动词"，不知道"名词"是什么
- Cost必须是泛化的，不能预设资源类型
- queryActions必须考虑性能，不能全表扫描

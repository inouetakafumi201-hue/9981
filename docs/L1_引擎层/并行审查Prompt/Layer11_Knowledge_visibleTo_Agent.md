# 并行审查Prompt：第11层 - Knowledge + visibleTo + Agent

> **文件性质：历史审查题库（方案 A — Spec 章节审查轴）。已于 2026-08-05 执行完毕。**
> 文中的 `- [ ]` 是**审查提问项**，不是待办事项 —— 不要当作未完成工作统计。
> 本题库产出的风险项已汇总于 [`ENGINE_KERNEL_13LAYER_REVIEW_SUMMARY.md`](ENGINE_KERNEL_13LAYER_REVIEW_SUMMARY.md)
> （H-1~H-3 / M-1~M-13 / L-1~L-18），其中 **M/L 共 31 项至今仍开放**，
> 跟踪在 [`00_开放事项跟踪.md`](00_开放事项跟踪.md)。
> 本文件的层编号与工程验收使用的**方案 C（属性实测轴）不是同一套**，
> 映射见 [`00_状态基线.md`](00_状态基线.md) §2.1。

## 目标
按照**哲学宪法**原则，对内核Spec第11章（认知系统）进行原则性彻查。

## 宪法铁律

### 核心约束
- Knowledge是**每个Agent的主观认知**，不是客观事实
- visibleTo是**信息不对称的实现机制**
- Agent是**决策者与观察者的统一**

### 已知缺失（已在第十轮回补）
原设计中缺少以下内容，现已回补：
- `knowledgeScope`实现视野共享
- `omniscient`实现GM/观战

## 第11层审查清单

### 11.1 Knowledge结构

#### 事实存储
```typescript
interface Knowledge {
  agent: AgentId                   // 属于哪个Agent
  facts: Map<FactId, Fact>         // 事实集合
  timestamp: number                // 最后更新时间
}
```
- [ ] `facts`是否是任意Value？（不仅是布尔）
- [ ] 是否支持结构化事实（对象/数组）？
- [ ] 事实是否按类型索引？（快速查询）
- [ ] `timestamp`是否用于过期检测？

#### 主观性保证
- [ ] Knowledge是否属于某个Agent？（不能跨Agent共享）
- [ ] 不同Agent的Knowledge是否独立修改？
- [ ] 事实是否携带"来源"信息？（归因）

### 11.2 visibleTo机制

#### 可见性过滤
```typescript
interface VisibleFilter {
  scope: 'full' | 'partial' | 'none'
  fields?: string[]                // partial时指定可见字段
  transform?: Expr                 // 可选的变形函数
}
```
- [ ] visibleTo是否是Query的过滤条件？
- [ ] 是否支持"部分可见"（如血条可见，装备不可见）？
- [ ] 视野是否随拓扑变化更新？

#### 传播机制
- [ ] 事实如何从世界进入Knowledge？（通过Hook？）
- [ ] Hook是否可用于视野传播？（before事件？）
- [ ] "我知道你知道"如何实现？（二级知识）

### 11.3 Agent归位（回顾1.3.1.1）

```typescript
interface Agent {
  id: AgentId
  controls: EntityId | AgentId[]   // 控制权来源
  knowledgeScope: 'private' | 'team' | 'world' | 'omniscient'
  omniscient?: boolean             // GM/观战模式（第十轮回补）
  policy?: PolicyId                // AI决策策略
}
```
- [ ] `controls`是否控制权来源？（玩家/AI/脚本）
- [ ] `knowledgeScope`是否实现视野共享？
- [ ] `omniscient`是否实现GM/观战？
- [ ] `policy`是否指定AI行为？

#### knowledgeScope语义
| 值 | 语义 |
|---|------|
| private | 只能看到自己的Entity |
| team | 队友之间视野共享 |
| world | 全局视野 |
| omniscient | 看到所有，包括不可见 |

### 11.4 与其他层的关系

#### 与Entity的关系
- [ ] Agent是否拥有Entity？（controls）
- [ ] Entity死亡时Agent是否受影响？

#### 与Attachment的关系
- [ ] "隐身"效果如何实现？（修改visibleTo）
- [ ] "真视"效果如何实现？（绕过visibleTo）

#### 与Random的关系
- [ ] AI在影子流中搜索时，Knowledge是否隔离？
- [ ] 影子Context是否包含独立的Knowledge？

## 决策记录检查

| 决策 | 理由 | 风险 |
|------|------|------|
| Knowledge正交化 | 主观认知与客观状态分离 | 低 |
| visibleTo过滤 | 实现信息不对称 | 中 |
| knowledgeScope共享 | 队伍视野需要 | 低 |
| omniscient模式 | GM/观战需要 | 低 |
| knowledgeScope回补 | 第十轮发现缺失 | 低 |

## 思维实验清单

### 边界情况
1. "我不小心看到了不该看的信息"如何实现？（视野bug）
2. "敌人看不到我在草丛里"如何实现？（地形遮蔽）
3. 队伍共享视野是否意味着完全一致的信息？（是，但可能有延迟）

### 反模式检测
1. 能否通过Hook修改其他Agent的Knowledge？（应该禁止）
2. 能否通过visibleTo漏洞获取隐藏信息？
3. 能否通过knowledgeScope=world实现全图挂？

### 扩展性测试
1. 能否支持"暂时性视野"（几回合后过期）？
2. 能否支持"条件性视野"（满足某条件时可见）？
3. 能否支持"共享Knowledge"（结盟后的知识交换）？

## 输出格式

```markdown
## 第11层审查报告

### Knowledge结构验证
- 事实存储：✅/❌
- 主观性保证：✅/❌
- 时间戳：✅/❌

### visibleTo机制
- 过滤粒度：✅/❌
- 传播机制：✅/❌
- 拓扑更新：✅/❌

### Agent归位确认（第十轮回补验证）
- controls：✅/❌
- knowledgeScope：✅/❌
- omniscient：✅/❌

### 风险项
1. [高风险] ...
2. [中风险] ...

### 思维实验结论
...
```

## 注意事项
- Knowledge是主观的，不同Agent可以有矛盾的Knowledge
- visibleTo是引擎层的过滤机制，不知道"隐身药水"是什么
- Agent归位确保决策者与观察者一致

# 并行审查Prompt：第13层 - Safety（Linter + 诊断 + 有界log）

> **文件性质：历史审查题库（方案 A — Spec 章节审查轴）。已于 2026-08-05 执行完毕。**
> 文中的 `- [ ]` 是**审查提问项**，不是待办事项 —— 不要当作未完成工作统计。
> 本题库产出的风险项已汇总于 [`ENGINE_KERNEL_13LAYER_REVIEW_SUMMARY.md`](ENGINE_KERNEL_13LAYER_REVIEW_SUMMARY.md)
> （H-1~H-3 / M-1~M-13 / L-1~L-18），其中 **M/L 共 31 项至今仍开放**，
> 跟踪在 [`00_开放事项跟踪.md`](00_开放事项跟踪.md)。
> 本文件的层编号与工程验收使用的**方案 C（属性实测轴）不是同一套**，
> 映射见 [`00_状态基线.md`](00_状态基线.md) §2.1。

## 目标
按照**哲学宪法**原则，对内核Spec第13章（安全保障）进行原则性彻查。

## 宪法铁律

### 核心约束
- Linter在**加载期**捕获错误，不是运行时
- 诊断事件是**运行期**的错误报告，不是崩溃
- 有界log防止**内存无限增长**，不是简单截断

### 完备性判据
Safety能力必须满足：
| 判据 | 含义 |
|------|------|
| 不可绕过 | 缺了它无法保证运行时安全 |
| 三处复用 | Linter/诊断/log都需要 |
| 不含语义 | 它不知道在检查什么规则 |

## 第13层审查清单

### 13.1 Linter检查

#### 静态分析
```typescript
interface LinterRule {
  id: string
  severity: 'error' | 'warning' | 'info'
  check: (defs: DefSet) => LintResult[]
}
```
- [ ] Def继承环是否被检测？（A extends B, B extends A）
- [ ] Expr调用环是否被检测？（f() calls g(), g() calls f()）
- [ ] 未定义引用是否被检测？（引用不存在的Def）
- [ ] 类型不匹配是否被检测？

#### 运行时预防
- [ ] 无测试用例的错误码是否不允许存在？（第十轮回补）
- [ ] Op参数校验是否完整？（null/undefined检查）
- [ ] 类型推断是否足够严格？（防止类型逃逸）

#### ErrCode体系（第十轮回补）
```typescript
enum ErrCode {
  // 加载期
  LintCycle = 'E001',
  LintUndefRef = 'E002',
  LintTypeMismatch = 'E003',
  // 运行期
  RuntimeOpFailed = 'E101',
  RuntimeInvariantBroken = 'E102',
  // ...
}
```
- [ ] ErrCode是否有完整定义？
- [ ] 错误码是否与操作对应？
- [ ] 诊断是否可自定义？

### 13.2 诊断事件

#### 分级
| 级别 | 含义 | 行为 |
|------|------|------|
| fatal | 不可恢复错误 | 停止执行，报告错误 |
| error | 可恢复错误 | 记录诊断，继续执行 |
| warning | 潜在问题 | 记录诊断，建议修复 |
| info | 提示信息 | 记录诊断，供调试用 |

- [ ] 错误/警告/提示是否区分？
- [ ] 不同级别是否影响执行？
- [ ] 是否支持静默模式？（不输出诊断）

#### 诊断内容
```typescript
interface Diagnostic {
  code: ErrCode
  severity: 'fatal' | 'error' | 'warning' | 'info'
  location: { file?: string, def?: DefId, entity?: EntityId }
  message: string
  context?: Record<string, Value>  // 调试信息
}
```
- [ ] `location`是否精确定位问题？
- [ ] `context`是否提供足够调试信息？
- [ ] 诊断是否可自定义？（玩法包添加自定义诊断）

### 13.3 配额控制

#### 资源配额
```typescript
interface ResourceQuota {
  logRetention: number             // 最大日志条数（第十轮回补）
  maxDepth: number                 // 事件连锁最大深度
  maxStep: number                  // 单相最大step数
  maxSnapshotSize: number          // 快照最大字节数
}
```
- [ ] `logRetention`是否限制日志大小？（第十轮回补）
- [ ] `maxDepth`（事件连锁）是否限制？
- [ ] step预算是否属于配额？
- [ ] 配额是否可配置？

#### 超限处理
| 配额 | 超限行为 |
|------|----------|
| logRetention | 自动清理最旧日志 |
| maxDepth | 产生fatal诊断，停止事件连锁 |
| maxStep | 产生warning，停止当前相执行 |
| maxSnapshotSize | 拒绝快照，报告error |

- [ ] 超配额的诊断级别是否正确？
- [ ] 超配额后的行为是否明确定义？
- [ ] 是否支持动态调整配额？

### 13.4 防御性设计

#### 不变量保证
```typescript
interface Invariant {
  id: string
  check: (world: World) => boolean
  scope: 'entity' | 'transaction' | 'phase'
}
```
- [ ] 每条不变量是否有Op级校验？
- [ ] 不变量违反是否产生fatal诊断？
- [ ] 是否防止级联破坏？（一损俱损）

#### 外部对抗
| 威胁 | 防御机制 |
|------|----------|
| 恶意Playpack | Linter检查 + 沙箱隔离 |
| 资源耗尽攻击 | 配额控制 + 超时机制 |
| 序列化攻击 | checksum校验 + 版本验证 |

- [ ] 恶意Playpack如何防御？
- [ ] 资源耗尽攻击如何防御？
- [ ] 序列化攻击如何防御？

## 决策记录检查

| 决策 | 理由 | 风险 |
|------|------|------|
| 加载期Linter | 提前发现问题 | 低 |
| 运行时诊断 | 记录问题而非崩溃 | 低 |
| 有界log | 防止内存泄漏 | 低 |
| ErrCode体系回补 | 第十轮发现缺失 | 低 |
| logRetention回补 | 第十轮发现缺失 | 低 |

## 思维实验清单

### 边界情况
1. 一个包含无限循环ExprDef的Playpack如何被Linter拒绝？
2. 连续触发1000层事件连锁会怎样？（maxDepth限制）
3. 恶意Playpack能否通过Hook获取不该有的信息？（沙箱隔离）

### 反模式检测
1. 能否通过构造特殊Payload绕过Linter？
2. 能否通过无限递归耗尽内存？（maxDepth防护）
3. 能否通过序列化漏洞执行代码？

### 扩展性测试
1. 能否支持"自定义Linter规则"？
2. 能否支持"远程诊断"（上报服务器）？
3. 能否支持"自动修复"（Linter建议修复方案）？

## 输出格式

```markdown
## 第13层审查报告

### Linter完整性
- 继承环检测：✅/❌
- 调用环检测：✅/❌
- 未定义引用检测：✅/❌
- ErrCode体系：✅/❌（第十轮回补）

### 诊断体系验证
- 分级清晰度：✅/❌
- 位置精确度：✅/❌
- 可自定义性：✅/❌

### 配额控制
- logRetention：✅/❌（第十轮回补）
- maxDepth：✅/❌
- maxStep：✅/❌

### 防御性评估
- 不变量保证：✅/❌
- 外部对抗防御：✅/❌

### 风险项
1. [高风险] ...
2. [中风险] ...

### 思维实验结论
...
```

## 注意事项
- Linter是静态检查，不能捕获所有问题
- 诊断是运行时监控，不是错误处理
- 配额是最后防线，不是业务逻辑

# Wave 1.1: spec-compiler 独有缺口审计

> **执行日期**：2026-08-11  
> **审计范围**：`src/core/kernel/spec-compiler/` vs `src/l2/`  
> **目标**：识别 spec-compiler 相对 L2 的独有能力，为 Wave 1.2 迁移做准备

---

## 审计方法

### 对比维度

1. **功能覆盖**：spec-compiler 有但 L2 没有的功能
2. **实现质量**：spec-compiler 实现优于 L2 的部分
3. **测试覆盖**：spec-compiler 有测试但 L2 缺失的场景
4. **文档完整性**：spec-compiler 有文档但 L2 未记录的契约

### 审计策略

- ✅ 只读分析，不修改任何代码
- ✅ 对比模块级功能，不深入实现细节
- ✅ 输出迁移清单，标注优先级
- ✅ 识别可删除的重复实现

---

## 模块对比矩阵

| spec-compiler 模块 | L2 对应模块 | 功能覆盖 | 状态 |
|-------------------|------------|---------|------|
| `compiler.ts` (SpecificationCompiler) | `compiler/specification-compiler.ts` | 🔴 部分重复 | 需裁决 |
| `validator.ts` (SpecificationValidator) | `validation/validator.ts` | 🟢 L2 更完整 | 可退役 |
| `resolver.ts` | `resolution/definition-resolver.ts` | 🟢 L2 更完整 | 可退役 |
| `registries.ts` | `registry/definition-registry.ts` | 🟢 L2 更完整 | 可退役 |
| `json-codec.ts` (StrictJsonCodec) | `codec/json-codec.ts` | 🟡 部分独有 | 需分析 |
| `diagnostic-factory.ts` | `model/diagnostic-factory.ts` | 🟢 L2 已覆盖 | 可退役 |
| `messages.ts` (CreatorMessageBundle) | ❌ 无对应 | 🔴 独有功能 | 需迁移 |
| `closure.ts` (诊断闭合检查) | ❌ 无对应 | 🔴 独有功能 | 需迁移 |
| `integrity.ts` (语义字段损伤检测) | ❌ 无对应 | 🔴 独有功能 | 需迁移 |
| `numeric-classification.ts` | ❌ 无对应 | 🔴 独有功能 | 需迁移 |
| `semantic-family.ts` | `model/family-contracts.ts` | 🟢 L2 已覆盖 | 可退役 |
| `type-identity.ts` | `model/definition.ts` (TypeIdentity) | 🟢 L2 已覆盖 | 可退役 |
| `output-lease.ts` | ❌ 无对应 | 🟡 基础设施 | 需保留 |
| `filesystem-artifact-store.ts` | ❌ 无对应 | 🟡 基础设施 | 需保留 |
| `package-change.ts` | `model/candidate.ts` | 🟢 L2 已覆盖 | 可退役 |
| `model-json.ts` (序列化) | `codec/json-canonicalizer.ts` | 🟡 部分重叠 | 需分析 |

**图例**：
- 🔴 **独有功能**：spec-compiler 有但 L2 完全没有
- 🟡 **部分独有**：spec-compiler 有部分 L2 没有的功能
- 🟢 **L2 已覆盖**：L2 实现更完整或等价

---

## 独有功能详细分析

### 1. 🔴 messages.ts - 创作者消息目录

**功能描述**：
- 提供多语言创作者友好消息（zh-CN bundle）
- 诊断码 → 人类可读消息的映射
- 支持消息参数插值
- 包含修正建议和指导信息

**L2 当前状态**：
- ❌ 无对应模块
- `diagnostic-factory.ts` 只生成结构化诊断，不处理友好消息

**迁移建议**：
- **优先级**：P2（中优先级）
- **目标位置**：`src/l2/model/messages.ts` 或 `src/l2/presentation/`
- **依赖**：HINT_TEMPLATES（已存在于 safety.ts）
- **工作量**：中等（需要对齐 HINT_TEMPLATES）

**关键代码**：
```typescript
interface CreatorMessageBundle {
  locale: string;
  entries: ReadonlyMap<ErrCode, CreatorMessageEntry>;
}

function interpolate(text: string, args: Record<string, DiagnosticArgument>): string;
function renderGuidance(diagnostic: Diagnostic, bundle: CreatorMessageBundle): string;
```

---

### 2. 🔴 closure.ts - 诊断闭合检查

**功能描述**：
- 检查诊断集合的完整性（diagnostic closure）
- 验证所有阻塞性诊断是否都有对应的 hint
- 确保 fatal 诊断有完整的终止路径说明
- 检测缺失的来源记录

**L2 当前状态**：
- ❌ 无对应模块
- `validation/validator.ts` 不执行闭合检查

**迁移建议**：
- **优先级**：P1（高优先级）
- **目标位置**：`src/l2/validation/diagnostic-closure.ts`
- **依赖**：HINT_TEMPLATES、DiagnosticSink
- **工作量**：小（~150 行代码）

**关键代码**：
```typescript
interface ClosureIssue {
  code: ErrCode;
  reason: string;
  missingHint?: boolean;
  missingSource?: boolean;
}

function checkDiagnosticClosure(
  diagnostics: readonly Diagnostic[],
  hints: Record<string, string>
): readonly ClosureIssue[];
```

**关键检查**：
- ✅ 每个阻塞诊断（error/fatal）都有 hint
- ✅ 每个诊断都有来源记录（sourceLocation）
- ✅ fatal 诊断有终止理由（haltClass）

---

### 3. 🔴 integrity.ts - 语义字段损伤检测

**功能描述**：
- 检测定义在序列化/反序列化后的语义字段丢失
- 对比注册表模型与规范快照的字段一致性
- 识别表现字段 vs 语义字段
- 防止管线丢失关键数据

**L2 当前状态**：
- ❌ 无对应模块
- `registry/canonical-snapshot.ts` 不执行完整性检查

**迁移建议**：
- **优先级**：P1（高优先级）
- **目标位置**：`src/l2/validation/semantic-integrity.ts`
- **依赖**：DefinitionRegistry、CanonicalSnapshot
- **工作量**：中等（~200 行代码）

**关键代码**：
```typescript
interface SemanticDamage {
  definitionId: string;
  missingFields: readonly string[];
  category: 'semantic' | 'presentation' | 'metadata';
}

function findSemanticFieldDamage(
  registryModel: CompiledModel,
  canonicalSnapshot: CanonicalSnapshot
): readonly SemanticDamage[];
```

**关键逻辑**：
```typescript
// 表现字段（允许降级）：
const PRESENTATION_FIELDS = ['iconRef', 'displayName', 'description', ...];

// 语义字段（不得丢失）：
const SEMANTIC_FIELDS = ['id', 'defKind', 'semanticFamily', 'typeIdentity', ...];
```

---

### 4. 🔴 numeric-classification.ts - 数值分类与出处要求

**功能描述**：
- 判断数值是否需要约束出处（requiresBoundProvenance）
- 识别内部度量 schema（declaresInternalMetricSchema）
- 验证数值字段的 schema 规则
- 支持玩法层/基类层的数值所有权判定

**L2 当前状态**：
- ❌ 无对应模块
- `validation/*.ts` 不执行数值分类检查

**迁移建议**：
- **优先级**：P2（中优先级）
- **目标位置**：`src/l2/validation/numeric-classification.ts`
- **依赖**：FieldRule、NumericOwnership 类型
- **工作量**：小（~100 行代码）

**关键代码**：
```typescript
function requiresBoundProvenance(ownership: NumericOwnership): boolean {
  // gameplay-specific 数值必须有出处约束
  return ownership === 'gameplay-specific';
}

function declaresInternalMetricSchema(rule: FieldRule): boolean {
  // 检查是否为内部度量（如 generation、timestamp）
  return rule.classification === 'internal-metric';
}

function ruleAcceptsNumber(rule: FieldRule): boolean {
  // 检查 schema 规则是否接受数值类型
  return rule.type === 'number' || rule.type === 'integer';
}
```

---

### 5. 🟡 json-codec.ts (StrictJsonCodec) - 部分独有功能

**功能描述**：
- JSON 严格解析与规范化
- 代码点排序（compareCodePoints）
- JSON Pointer 操作
- 规范序列化（canonicalStringify）

**L2 当前状态**：
- ✅ `codec/json-codec.ts` 已有基础功能
- ❌ 缺少 **配额前置检查**（quota pre-check）
- ❌ 缺少 **来源优先级处理**（source precedence）

**迁移建议**：
- **优先级**：P2（中优先级）
- **目标位置**：扩展 `src/l2/codec/json-codec.ts`
- **依赖**：TechnicalQuotas、SourceRecord
- **工作量**：小（~50 行增量代码）

**独有功能清单**：
```typescript
// spec-compiler 独有：
class StrictJsonCodec {
  // 1. 配额前置检查
  parseWithQuota(text: string, quotas: TechnicalQuotas): ParseResult;
  
  // 2. 来源优先级（parse 时携带 sourceId）
  parseWithSource(text: string, sourceId: string): ParseResult;
  
  // 3. 更严格的错误诊断（带 JSON Pointer）
  // L2 只返回行列号，spec-compiler 返回 JSON path
}
```

---

### 6. 🟡 model-json.ts - 模型序列化

**功能描述**：
- CompiledModel → JSON 序列化
- Definition → JSON 序列化
- Provenance → JSON 序列化
- 支持增量序列化（只序列化变更部分）

**L2 当前状态**：
- ✅ `codec/json-canonicalizer.ts` 有规范化功能
- ❌ 缺少 **增量序列化**
- ❌ 缺少 **出处记录序列化**

**迁移建议**：
- **优先级**：P3（低优先级）
- **目标位置**：`src/l2/codec/model-serializer.ts`
- **依赖**：CompiledModel、ProvenanceRecord
- **工作量**：中等（~150 行代码）

---

## 基础设施模块分析

### 7. 🟡 output-lease.ts - 输出租约管理

**功能描述**：
- 管理编译输出的原子性（atomic output）
- 提供租约机制（lease），防止并发冲突
- 哈希验证（hashBytes）
- 防止部分写入

**L2 当前状态**：
- ❌ 无对应模块
- `registry/definition-registry.ts` 不处理输出隔离

**迁移建议**：
- **优先级**：P3（低优先级，基础设施）
- **目标位置**：保留在 `src/core/kernel/persistence/` 或迁移到 `src/l2/persistence/`
- **依赖**：ArtifactStore
- **工作量**：小（可直接复用）

**保留理由**：
- 这是通用基础设施，不属于 L2 语义层
- UGC、玩法包、基类层都可能需要
- 建议：**不迁移，保留在 kernel 层**

---

### 8. 🟡 filesystem-artifact-store.ts - 文件系统制品存储

**功能描述**：
- 文件系统级制品存储
- 暂存区管理（staging）
- 原子性重命名（atomic rename）

**L2 当前状态**：
- ❌ 无对应模块

**迁移建议**：
- **优先级**：P3（低优先级，基础设施）
- **目标位置**：保留在 `src/core/kernel/persistence/`
- **保留理由**：与 output-lease.ts 同理

---

## 可退役模块清单

以下 spec-compiler 模块在 L2 中已有更完整的实现，**可以安全退役**：

| 模块 | L2 对应 | 退役理由 |
|------|---------|---------|
| `validator.ts` | `validation/validator.ts` | L2 实现更完整（15+ 规则文件） |
| `resolver.ts` | `resolution/definition-resolver.ts` | L2 实现更完整（引用图、依赖重验证） |
| `registries.ts` | `registry/definition-registry.ts` | L2 实现更完整（原子激活、快照） |
| `diagnostic-factory.ts` | `model/diagnostic-factory.ts` | L2 已覆盖 |
| `semantic-family.ts` | `model/family-contracts.ts` | L2 已覆盖 |
| `type-identity.ts` | `model/definition.ts` | L2 已覆盖 |
| `package-change.ts` | `model/candidate.ts` | L2 已覆盖 |

**退役策略**：
1. Wave 1.3：在文件顶部加冻结标记
2. Wave 3：物理删除文件
3. 期间：禁止新增功能，只修 bug

---

## 重复实现裁决

### compiler.ts (SpecificationCompiler) vs L2 compiler/

**问题**：两处都有"编译器"概念，但职责不同

**spec-compiler 职责**：
- 编排完整编译流程（intake → publish）
- 管理暂存区和输出租约
- 协调 validator、resolver、registry
- 处理 draft 模式 vs production 模式

**L2 compiler 职责**（`specification-compiler.ts`）：
- 来源陈述分类（classifyStatement）
- 冲突解析（resolveConflict）
- 未决项识别（unresolvedItems）
- 生成 NormativeContract

**裁决**：
- ✅ **不冲突**：两者职责不同
- spec-compiler/compiler.ts 是**编排层**（orchestration）
- L2 compiler 是**来源处理层**（source processing）

**建议**：
- spec-compiler/compiler.ts 改名为 `compilation-orchestrator.ts`（可选）
- 或者在 Wave 1.3 冻结，Wave 3 逐步用 L2 替代

---

## 迁移优先级与工作量估算

| 优先级 | 模块 | 目标位置 | 工作量 | 依赖 |
|--------|------|---------|--------|------|
| **P1** | `closure.ts` | `l2/validation/diagnostic-closure.ts` | 小（150 行） | HINT_TEMPLATES |
| **P1** | `integrity.ts` | `l2/validation/semantic-integrity.ts` | 中（200 行） | CanonicalSnapshot |
| **P2** | `messages.ts` | `l2/model/messages.ts` | 中（300 行） | HINT_TEMPLATES |
| **P2** | `numeric-classification.ts` | `l2/validation/numeric-classification.ts` | 小（100 行） | FieldRule |
| **P2** | `json-codec.ts` 增量 | `l2/codec/json-codec.ts` | 小（50 行） | TechnicalQuotas |
| **P3** | `model-json.ts` 增量 | `l2/codec/model-serializer.ts` | 中（150 行） | CompiledModel |
| **P3** | `output-lease.ts` | 保留 `kernel/persistence/` | 0（不迁移） | - |
| **P3** | `filesystem-artifact-store.ts` | 保留 `kernel/persistence/` | 0（不迁移） | - |

**总工作量估算**：
- P1 任务：~350 行新代码 + 测试
- P2 任务：~450 行新代码 + 测试
- P3 任务：~150 行新代码 + 测试（可选）

**Wave 1.2 建议范围**：
- ✅ 完成 P1 任务（closure + integrity）
- ⏳ P2 任务推迟到 Wave 2（与 l2-base-layer-spec 一起）
- ⏳ P3 任务推迟到 Wave 3 或更晚

---

## Wave 1.2 执行计划

### 迁移任务清单

#### 任务 1.2.1：迁移 closure.ts
```
源文件：src/core/kernel/spec-compiler/closure.ts
目标：src/l2/validation/diagnostic-closure.ts
步骤：
1. 复制核心函数（checkDiagnosticClosure、isBlocking、declaresHalt）
2. 对齐 HINT_TEMPLATES 导入路径
3. 补齐单元测试（10+ 个测试用例）
4. 在 validator.ts 中调用 checkDiagnosticClosure
验收：diagnostic-closure.test.ts 全绿
```

#### 任务 1.2.2：迁移 integrity.ts
```
源文件：src/core/kernel/spec-compiler/integrity.ts
目标：src/l2/validation/semantic-integrity.ts
步骤：
1. 复制核心函数（findSemanticFieldDamage、compareOneDefinition）
2. 定义 PRESENTATION_FIELDS / SEMANTIC_FIELDS 常量
3. 补齐单元测试（15+ 个测试用例）
4. 在 registry/canonical-snapshot.ts 中调用
验收：semantic-integrity.test.ts 全绿
```

#### 任务 1.2.3：更新 spec-compiler 导入
```
文件：src/class/catalog-loader.ts、src/ui/profile/profile-loader.ts 等
步骤：
1. 搜索所有 import from '../core/kernel/spec-compiler'
2. 改为 import from '../l2/...'（仅导入已迁移的功能）
3. 验证 npm run typecheck 通过
验收：零 spec-compiler import（除基础设施）
```

---

## 测试覆盖对比

### spec-compiler 现有测试
```bash
src/core/kernel/spec-compiler/__tests__/
├── closure.test.ts              # ❌ L2 缺失
├── diagnostic-factory.test.ts   # ✅ L2 已有
├── integrity.test.ts            # ❌ L2 缺失
├── json-codec.test.ts           # ✅ L2 已有
├── messages.test.ts             # ❌ L2 缺失
├── numeric-classification.test.ts # ❌ L2 缺失
├── output-lease.test.ts         # 🟡 保留 kernel
├── registries.test.ts           # ✅ L2 已有
├── resolver.test.ts             # ✅ L2 已有
├── semantic-family.test.ts      # ✅ L2 已有
└── validator.test.ts            # ✅ L2 已有
```

### L2 需要补齐的测试
- ❌ `diagnostic-closure.test.ts`（Wave 1.2）
- ❌ `semantic-integrity.test.ts`（Wave 1.2）
- ❌ `creator-messages.test.ts`（Wave 2）
- ❌ `numeric-classification.test.ts`（Wave 2）

---

## 风险与注意事项

### 🚨 高风险项

1. **closure.ts 依赖 HINT_TEMPLATES**
   - 风险：HINT_TEMPLATES 可能不完整
   - 缓解：任务 11.2 已验证完整性（46+ hint 全覆盖）

2. **integrity.ts 依赖 CanonicalSnapshot**
   - 风险：L2 的 canonical-snapshot.ts 可能不兼容
   - 缓解：PT-10 已验证快照功能（13/13 集成测试通过）

3. **并行修改冲突**
   - 风险：Wave 1.2 迁移期间，其他规范可能修改 L2
   - 缓解：PARALLEL_EXECUTION_LOCK 已锁定 `src/l2/validation/`

### ⚠️ 中风险项

1. **messages.ts 多语言支持**
   - 风险：L2 可能不需要多语言
   - 缓解：P2 任务，可推迟到 Wave 2

2. **numeric-classification.ts 玩法层耦合**
   - 风险：数值分类可能与玩法层规则冲突
   - 缓解：P2 任务，等 Wave 4（PT-07）解除阻塞后再做

---

## 附录：命令快速参考

```bash
# 列出 spec-compiler 所有文件
ls src/core/kernel/spec-compiler/*.ts

# 搜索 spec-compiler 的导入
grep -r "from.*spec-compiler" src/class src/ui src/play --include="*.ts"

# 运行 spec-compiler 测试
npm test -- src/core/kernel/spec-compiler

# 运行 L2 validation 测试
npm test -- src/l2/validation

# 检查类型
npm run typecheck
```

---

## 结论

**独有缺口清单（需迁移）**：
1. ✅ **P1**：`closure.ts` - 诊断闭合检查（~150 行）
2. ✅ **P1**：`integrity.ts` - 语义字段损伤检测（~200 行）
3. ⏳ **P2**：`messages.ts` - 创作者消息目录（~300 行）
4. ⏳ **P2**：`numeric-classification.ts` - 数值分类（~100 行）
5. ⏳ **P2**：`json-codec.ts` 配额前置检查（~50 行增量）

**可退役模块（L2 已覆盖）**：
- `validator.ts`、`resolver.ts`、`registries.ts`
- `diagnostic-factory.ts`、`semantic-family.ts`、`type-identity.ts`
- `package-change.ts`

**保留模块（基础设施）**：
- `output-lease.ts`、`filesystem-artifact-store.ts`
- 理由：通用基础设施，不属于 L2 语义层

**Wave 1.2 建议范围**：
- ✅ 迁移 P1 任务（closure + integrity）
- ✅ 冻结可退役模块（加标记，不删除）
- ⏳ P2/P3 任务推迟到 Wave 2/3

---

## 下一步

Wave 1.1 审计完成。等待项目所有者裁决：
1. 是否批准 Wave 1.2 迁移计划？
2. 是否现在更名 spec-compiler → json-primitives？
3. 退役时间点：Wave 1 冻结 + Wave 3 删除？

裁决后即可开始 Wave 1.2 执行。

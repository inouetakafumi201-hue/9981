# 设计文档

## 概述

本设计文档定义基类层 ECS 收敛的架构与实施细节。目标是把既有基类层交付物（`src/l2/**`、`src/class/*/index.json`）收拢到 ECS 形状：**基类层 = 可复用的语义组件类型库 + 每类组件的 System 接线契约**。收敛不新增玩法内容，只做结构收拢，并让散乱点可通过机器守卫验证。

收敛的四个结构动作：

1. **组件契约单一源**：新增 `Composition_Registry`（`src/l2/model/composition-registry.ts`），以 `component.*` 前缀集中登记组件，供语义族的类与组合模板引用并去重。
2. **家族目录以组件为核心**：既有 `family-contracts.ts` 的族契约字段形状为能力组件；`space-items-contracts.ts` 的 `ContainerDomainContract` 收敛为组件形状。
3. **原子 System 接线**：每个能力声明 `kernelOps`（System 接线），验证器闭合组件字段名与 System 参数名的 CaS 缝隙，并校验 Op 存在且被许可。
4. **vehicle 降级为组合型组件族**：取消 `vehicle.class.land` 的 `defKind:"entity"` 与抽象基类资格，改为「由标准组件拼装的组合模板」。

收敛深度与数值归属是两条正交的轴：本设计只把语义结构做深，具体数值仍由玩法层（L3）/ UGC 提供。素材管理、实例化归玩法层，不改变"组件只出声明、值由玩法层填"的边界。

## 架构

### 分层与数据流

```
┌─────────────────────────────────────────────────────────────┐
│  L1 引擎层（ECS 基底）                                        │
│  Entity = ID + 组件列表；Op/Hook 作为 System 读写组件          │
│  src/core/kernel/**                                          │
└───────────────────────────┬─────────────────────────────────┘
                            │ 无语义原语（Def/Op/Expr/Hook/…）
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  L2 基类层（本 spec 收敛对象）                                │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Composition_Registry（component.* 组件登记表）          │ │
│  │  src/l2/model/composition-registry.ts                  │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  族契约（family-contracts.ts 收敛为组件形状）            │ │
│  │  action / container / damage / movement / status /     │ │
│  │  attachment / skill / shield / vehicle                 │ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  语义目录（src/class/*/index.json）                     │ │
│  │  classes + capabilities（升格为组件）+ compositionContract│ │
│  └────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  验证器（src/l2/validation/**）                         │ │
│  │  compositionKind 校验 / kernelOps 接线 / CaS 缝隙闭合    │ │
│  └────────────────────────────────────────────────────────┘ │
└───────────────────────────┬─────────────────────────────────┘
                            │ 组合模板 + 玩法数值
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  L3 玩法层 / UGC（组合实例、填数值、素材管理）                │
└─────────────────────────────────────────────────────────────┘
```

### 关键架构原则

1. **组件契约单一源**：类与组合模板从「类 + 能力」单一源展开，`Composition_Registry` 集中登记 `component.*` 组件，避免类与能力口径分裂。
2. **收敛深度与数值归属正交**：结构做深（组件拆分、原子 System 接线），数值留在玩法层；两者不冲突。
3. **继承只用于组合拼装**：继承仅用于「组合型组件族由哪些组件拼装」，不再让具体语义族类间接获得实体子类身份。
4. **System 接线可机器校验**：`kernelOps` 引用真实存在的 Op，组件字段名与 System 参数名落到同一通路（闭合 CaS 缝隙）。
5. **只读投影不写语义状态**：任何写入只经 L1 允许的写通道（OpRegistry.invoke 等）。
6. **不越权**：不跨 Spec 改他人交付物；需要引擎层/玩法层配合的写成交接项（H-ECS-01~05）。

## 组件和接口

### 1. Composition_Registry 组件

- **输入**：语义族目录（`src/class/*/index.json`）的 `capabilities` 与 `classes`。
- **输出**：以 `component.*` 前缀集中登记的组件表，供类与组合模板引用并去重。
- **接口**：
  - `registerComponent(component)` → 登记一个 `component.*` 组件。
  - `resolveComponent(id)` → 解析组件 id，返回组件定义或 null。
  - `listComponents()` → 列出全部已登记组件。
  - `dedupeAcrossFamilies()` → 跨族去重：两个族声明相同可配置字段时提取共享组件。

### 2. 族契约收敛组件

- **输入**：`family-contracts.ts` 的 `FamilyContract` 联合、`space-items-contracts.ts` 的 `ContainerDomainContract`。
- **输出**：各族的组件形状（`action.`、`container.`、`damage.`、`movement.`、`status.`、`attachment.`、`skill.`、`shield.`、`vehicle.`）。
- **接口**：
  - `shapeFamilyContract(familyId)` → 把族契约字段形状为能力组件。
  - `shapeContainerDomainContract()` → 把 `ContainerDomainContract` 收敛为组件形状（沿用 D-059）。
  - `preserveFamilyFingerprint(familyId)` → 保留族契约既有能力指纹（被 spaces-items 容器载体引用）。

### 3. System 接线验证器

- **输入**：能力组件的 `kernelOps`、`parameters[*].key`、`compositionKind`。
- **输出**：`SYSTEM_BINDING_*` 系 Structured_Rejection 或通过。
- **接口**：
  - `validateKernelOps(capability)` → 校验 `kernelOps` 引用的 Op 存在且被许可。
  - `closeCaSGap(capability)` → 闭合组件字段名与 System 参数名的 CaS 缝隙。
  - `validateCompositionKind(capability)` → 校验 `compositionKind` 取四形之一。

### 4. vehicle 组合模板

- **输入**：`src/class/vehicles/index.json` 的 `vehicle.class.land`。
- **输出**：取消 `defKind:"entity"` 与抽象基类资格，改为「由标准组件拼装的组合模板」。
- **接口**：
  - `composeVehicleTemplate()` → 由座位/货舱/驾驶/碰撞/损毁处置等原语组件拼装载具组合模板。
  - `validateVehicleComposition()` → 校验载具组合模板引用的每个组件 id 存在且属于允许的能力族。

### 5. 只读投影与写通道

- **输入**：已验证定义与运行时状态。
- **输出**：只读语义投影（`Read_Only_Semantic_Projection`）。
- **接口**：
  - `projectStaticComponents()` → 只读投影可无障碍读取 `static` 组件承载项。
  - `enforceWriteChannel()` → 任何写入只经 L1 允许的写通道（OpRegistry.invoke 等）。

## 数据模型

### 组件契约模型

```typescript
interface ComponentContract {
  id: string;                 // "component.*" 前缀
  familyId: SemanticFamilyId; // 所属语义族
  parameters: ParameterSchema[]; // 可配置字段（值由 L3/UGC 填）
  kernelOps: OpId[];          // System 接线（读写该组件的 Op）
  compositionKind: 'static' | 'transient' | 'modified-explicit' | 'modified-capability';
  classReferences?: TypedReference[]; // 引用其他组件（如 containerClassRefs）
  writeChannelContract?: { channel: 'OpRegistry.invoke'; alternateChannels: 'none' };
}
```

### 组合模板模型

```typescript
interface CompositionTemplate {
  id: string;                 // 组合型组件族模板 id
  classIds: string[];         // 组合的类 id
  capabilityIds: string[];    // 组合的原语组件 id
  compositionKind: 'static' | 'transient' | 'modified-explicit' | 'modified-capability';
  playLayerOwnedFieldNames: string[]; // 玩法层归属字段名（值由 L3 填）
}
```

### Composition_Registry 模型

```typescript
interface CompositionRegistry {
  components: Map<string, ComponentContract>; // component.* 前缀
  templates: Map<string, CompositionTemplate>; // 组合模板
  registerComponent(component: ComponentContract): void;
  resolveComponent(id: string): ComponentContract | null;
  listComponents(): ComponentContract[];
  dedupeAcrossFamilies(): void;
}
```

### 验证结果模型

```typescript
interface ValidationResult {
  ok: boolean;
  violations: ContractViolation[]; // 含 code/path/reason/correction
  snapshot?: CanonicalSnapshot;    // 激活后的确定性快照
}
```

## 正确性属性

*属性是一种特征或行为，应该在系统的所有有效执行中都保持真实，本质上是关于系统应该做什么的正式陈述。属性充当人类可读规范和机器可验证正确性保证之间的桥梁。*

### 基于属性的测试概述

基于属性的测试（PBT）通过测试许多生成输入的通用属性来验证软件正确性。每个属性都是一个正式规范，应适用于所有有效输入。本 spec 的 PBT 使用 fast-check，均 ≥100 次生成，带 `Feature: wakeup-base-layer-ecs, Property N` 注释。

### 常见属性模式

1. **不变量**：尽管结构或顺序发生变化，但仍保持不变的属性。
2. **往返**：`decode(encode(x)) == x`、`parse(format(x)) == x`。
3. **幂等性**：`f(x) = f(f(x))`。
4. **变形**：组件之间必须保持的关系。
5. **基于模型**：优化实现与标准、简单实现的对比。
6. **融合**：应用的顺序无关紧要。
7. **错误条件**：生成错误输入，并确保它们正确地发出错误信号。

### 属性创建过程

**属性 1：组件契约单一源**
*对于任何*语义族，其契约接口与组合模板定义从「类 + 能力」单一源展开，`Composition_Registry` 集中登记 `component.*` 组件。**验证：要求 1.1、1.2**

**属性 2：Canonical_Snapshot 确定性**
*对于任何*经转换的目录，其 Canonical_Snapshot 的类 id、能力 id、组件 id 与模板 id 顺序确定性一致，且与转换前语义等价。**验证：要求 1.3、1.4**

**属性 3：转换失败原子性**
*对于任何*候选包，若转换后出现语义差异或依赖证据失效，则 WakeUp_System 归还最后有效的已激活状态并返回 Structured_Rejection。**验证：要求 1.5、1.6**

**属性 4：组件跨族去重**
*对于任何*两个声明相同可配置字段的语义族，`Composition_Registry` 提取共享的 `component.*` 组件并使其只定义一次。**验证：要求 2.2**

**属性 5：System 接线闭合**
*对于任何*能力组件，其 `kernelOps` 引用的字段名与 `parameters[*].key` 落在同一通路，且引用的 Op 存在并被许可。**验证：要求 3.2、3.3**

**属性 6：compositionKind 四形**
*对于任何*能力组件，其 `compositionKind` 取 `static`、`transient`、`modified-explicit`、`modified-capability` 四形之一，否则返回 `COMPOSITION_KIND_*` 系 Structured_Rejection。**验证：要求 5.1、5.2**

**属性 7：vehicle 组合模板**
*对于任何*载具组合模板，其引用的每个组件 id 存在且属于允许的能力族，且不声明 entity 基类身份。**验证：要求 6.2、6.5**

**属性 8：只读投影不写语义状态**
*对于任何*只读语义投影，其不能改写语义状态，任何写入只经 L1 允许的写通道。**验证：要求 4.1、4.2**

**属性 9：多轴正交**
*对于任何*既有能力组件，其在多处复用时语义保持不变，仅承载位置不同，且不依赖某特定 L3 payload 形状。**验证：要求 8.1、8.2**

**属性 10：派生目录形状与归属**
*对于任何*派生目录，其拥有与既有目录相同的 `CLASS_ENTRY_KEYS` 与 `CAPABILITY_ENTRY_KEYS`，且不覆盖既有主目录。**验证：要求 10.1、10.2**

## 错误处理

### 1. 组件契约错误

- **组件 id 冲突**：`Composition_Registry` 拒绝重复的 `component.*` id，返回 `COMPONENT_ID_CONFLICT`。
- **组件字段名与 System 参数名缝隙**：`validateKernelOps` 闭合 CaS 缝隙，返回 `SYSTEM_BINDING_*` 系 Structured_Rejection。
- **compositionKind 非法**：`validateCompositionKind` 返回 `COMPOSITION_KIND_*` 系 Structured_Rejection。

### 2. 转换错误

- **转换失败**：归还最后有效的已激活状态，返回含 CodeAndReason 的 Structured_Rejection。
- **依赖证据失效**：检测到失效证据并返回 Structured_Rejection，不得把失效证据当作有效以换取快照差异。

### 3. 目录错误

- **废用复合词**：文档纪律守卫拒绝含废用复合词的目录，明确所有权与修正路径。
- **未登记诊断名**：文档纪律守卫拒绝未登记的诊断名。

### 4. 派生目录错误

- **重叠 id 语义不一致**：`Definition_Registry` 校验既有目录与派生条目重叠 id 是同一语义，否则收回既有目录之前一个已激活状态。

## 测试策略

### 双重测试方法

**单元测试**（具体示例）：
- 验证展示正确行为的具体示例。
- 测试组件之间的集成点。
- 涵盖边缘情况和错误条件。
- 专注于具体、确定性的场景。

**基于属性的测试**（通用属性）：
- 验证适用于所有输入的通用属性。
- 通过随机化提供全面的输入覆盖。
- 通过缩减器捕捉边缘情况。
- 侧重于一般正确性保证。

### 测试实施指南

1. **测试位置**：使用适合语言的约定，将测试与源文件放在同一位置。
2. **测试命名**：使用描述性名称，说明正在测试的内容。
3. **最小解决方案**：避免过度测试；专注于核心功能。
4. **无模拟**：在可能的情况下，优先使用真实实现，而不是模拟。
5. **尝试限制**：在请求用户指示之前，最多尝试验证 2 次。
6. **真实验证**：测试必须验证真实功能，而不是虚假数据。

### 基于属性的测试配置

**库选择**：TypeScript 使用 fast-check（已安装）。

**测试配置**：
```typescript
const propertyConfig = {
  numRuns: 100,                    // Minimum iterations
  maxSize: 100,                    // Maximum input size
  seed: undefined,                 // Random seed (undefined for random)
  path: "design.md",              // Reference to design document
  propertyId: "Property 1",        // Design property identifier
  validates: "Requirements 1.1"    // Requirements being validated
};
```

**测试标记格式**：
```typescript
/**
 * Feature: wakeup-base-layer-ecs
 * Property 1: Component Contract Single Source
 * Validates: Requirements 1.1, 1.2
 */
```

### 测试执行工作流

1. **运行测试**：执行单元测试和属性测试。
2. **分析失败**：
   - 单元测试失败：调试特定的实现问题。
   - 属性测试失败：分类反例。
3. **修复问题**：
   - 代码错误：修复实现。
   - 测试问题：调整测试逻辑。
   - 规范差距：请求用户澄清。
4. **更新状态**：记录测试结果。
5. **继续**：仅在所有测试均通过时继续。

### 集成测试

**组件集成**：
- 测试 Composition_Registry 与族契约收敛的集成。
- 验证 System 接线验证器与目录的集成。
- 验证 vehicle 组合模板与目录的集成。

**端到端测试**：
- 完成从既有目录到 ECS 形状的收敛。
- 验证所有阶段是否正确协同工作。
- 测试错误恢复和用户交互流程。
# Wave 1.2 执行：9 个独有缺口迁移

> **日期**：2026-08-12  
> **依据**：D-061_spec-compiler_L2_功能差集审计.md §一.1.1  
> **目标**：将 spec-compiler 的 9 个独有能力迁移或确认迁移方案  
> **验收**：51 个 characterization 测试通过 + 137 个旧测试通过

---

## 执行模式

### 立即可做（无依赖）

以下 3 个任务可并行执行，因为它们**互不依赖**且有清晰规范：

1. **P0-1: Schema Migration Graph 迁移** → 新建 `src/l2/codec/schema-migration.ts`
2. **P0-2: UTF-8 Source Mapping 增强** → 扩展 `src/l2/model/source.ts`
3. **P0-3: Technical Quotas 补齐** → 扩展 `src/core/kernel/security/quotas.ts`

### 依赖 P0 完成后

以下 6 个任务需要等 P0 任务完成才能验证整合效果：

4. **P1-4: Diagnostic Closure Checking** → 新建 `src/l2/model/diagnostic.ts`（依赖 P0-2 源映射）
5. **P1-5: SAFE_DRAFT 模式** → 扩展 `src/l2/registry/activate`（依赖 P0-3 配额）
6. **P1-6: Activity-Set Model Integrity** → 迁移 `integrity.ts` → `src/l2/registry/model-integrity.ts`
7. **P1-7: Durable Publication** → 已在 Phase 1 完成 `src/core/kernel/persistence/artifact-store.ts` ✅
8. **P1-8: Fatal Boundary** → 已存在 `src/core/kernel/safety/fatal-boundary.ts` ✅
9. **P1-9: Source-to-UTF8 Offset** → 与 P0-2 部分重叠

---

## 并行任务 1：P0-1 Schema Migration Graph

**文件**：`src/l2/codec/schema-migration.ts`（新建）

**来源**：`src/core/kernel/spec-compiler/registries.ts::CandidateMigrationRegistry`（~70 行）

**职责**：
- 版本迁移路径查询（DFS 寻路）
- 环检测、重复路径检测
- 迁移步数预算检查

**接口**：

```typescript
export interface CandidateMigration {
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly id: string;
  // 迁移函数在宿主实现
  readonly executor: (doc: unknown) => unknown;
}

export interface MigrationPathResult {
  readonly status: 'identity' | 'ok' | 'missing' | 'ambiguous' | 'cycle';
  readonly path: readonly CandidateMigration[];
  readonly competingPaths?: readonly (readonly CandidateMigration[])[];
}

export class SchemaMigrationGraph {
  register(migration: CandidateMigration): void;
  resolve(fromVersion: string, toVersion: string, maxSteps: number): MigrationPathResult;
}
```

**迁移清单**：
- [ ] 复制 `CandidateMigrationRegistry` 类实现（DFS 寻路逻辑）
- [ ] 改名为 `SchemaMigrationGraph`
- [ ] 提取版本比较逻辑 `compareVersions` 为导出函数
- [ ] 补齐类型定义（CandidateMigration 接口）
- [ ] 补齐 2 个测试用例（路径解析、环检测）

**验收**：
- `npm run typecheck` 零 error
- 新建测试 2 项通过

---

## 并行任务 2：P0-2 UTF-8 Source Mapping 增强

**文件**：`src/l2/model/source.ts`（扩展）

**来源**：`src/core/kernel/spec-compiler/json-codec.ts::SourceRecord` 的 `sourceSliceHash` 字段

**职责**：
- 精确 UTF-8 字节偏移映射
- 源内容哈希（integrity check）
- 行列号与字节偏移转换

**新增字段**：

```typescript
export interface SourceRecord {
  readonly sourceId: string;
  readonly documentUri: string;
  readonly sourcePackage: string;
  readonly contentHash: string;
  readonly precedence: number;
  readonly owningLayer: '引擎层' | '基类层' | '玩法层';
  readonly normativeStatus: 'normative' | 'informative';
  readonly span: SourceSpan;
  
  // NEW: 源切片内容的 SHA-256 哈希
  readonly sourceSliceHash: string;
}

export interface SourceSpan {
  readonly file: string;
  readonly start: SourcePoint;
  readonly end: SourcePoint;
  readonly sourceSliceHash: string;  // UTF-8 字节内容 hash
}
```

**迁移清单**：
- [ ] 检查 `src/l2/model/source.ts` 是否已有 `sourceSliceHash` 字段（可能已有）
- [ ] 若无，从 spec-compiler 的 json-codec.ts 复制 hash 计算逻辑
- [ ] 补齐 SourceRecord 的规范化方法（用于诊断比对）
- [ ] 补齐 3 个测试用例（hash 匹配、offset 映射、切片提取）

**验收**：
- `npm run typecheck` 零 error
- 新建测试 3 项通过
- 现有 L2 测试无回归

---

## 并行任务 3：P0-3 Technical Quotas 补齐

**文件**：`src/core/kernel/security/quotas.ts`（已在 Phase 1 完成）

**现状**：Phase 1 已迁出基础 quota 结构（13 字段 + 验证）

**还需补齐**：
- [ ] 配额消耗追踪（tracking 字段）
- [ ] 每个字段的当前消耗量查询接口
- [ ] 超限时的精确错误报告（哪个字段超、当前值多少、限制多少）

**新增接口**：

```typescript
export interface QuotaConsumption {
  readonly inputBytes: number;
  readonly depth: number;
  readonly astNodes: number;
  readonly definitions: number;
  readonly edges: number;
  readonly traversalSteps: number;
  readonly diagnostics: number;
  readonly outputBytes: number;
  readonly migrationSteps: number;
  readonly identifierLength: number;
  readonly packageDependencyEdges: number;
  readonly coreDefinitions: number;
  readonly compositionMaps: number;
}

export class QuotaTracker {
  increment(field: keyof QuotaConsumption, delta: number): void;
  check(field: keyof QuotaConsumption, delta: number): boolean;  // 检查 quota + delta 是否超限
  toJSON(): QuotaConsumption;
}
```

**迁移清单**：
- [ ] 检查 Phase 1 代码是否已有 `QuotaConsumption` 和 `QuotaTracker`
- [ ] 若无，从 spec-compiler/types.ts 复制相关定义
- [ ] 补齐 tracker 的消耗增量接口
- [ ] 补齐 4 个测试用例（increment、check、overflow、reset）

**验收**：
- `npm run typecheck` 零 error
- 新建测试 4 项通过
- 现有 L2 测试无回归

---

## 后续任务（依赖 P0）

### P1-4: Diagnostic Closure Checking

**来源**：`src/core/kernel/spec-compiler/closure.ts::checkDiagnosticClosure`（~80 行）

**新文件**：`src/l2/model/diagnostic.ts`（扩展）

**职责**：诊断闭包验证（所有消息参数可被渲染、无未解析占位符）

**依赖**：P0-2（源映射）使诊断对象完整

---

### P1-5: SAFE_DRAFT 模式

**新参数**：`src/l2/registry/definition-registry.ts::activate` 增加 `mode: 'production' | 'draft'` 参数

**职责**：
- draft 模式：验证通过但不激活任何东西，只返回"安全草稿"
- production 模式：完整激活

**依赖**：P0-3（配额）使 draft 模式可安全限流

---

### P1-6: Activity-Set Model Integrity

**来源**：`src/core/kernel/spec-compiler/integrity.ts`（新 2026-08-08 文件，~150 行）

**新文件**：`src/l2/registry/model-integrity.ts`

**职责**：活动集模型字段保真自检（所有字段一致性验证）

**依赖**：P0-2（源映射）使错误位置精确

---

## 优先级与时间表

| 优先级 | 任务 | 所需时间 | 前置条件 |
|--------|------|---------|---------|
| **P0** | P0-1 Schema Migration | 1 小时 | 无 |
| **P0** | P0-2 UTF-8 Source Mapping | 1.5 小时 | 无 |
| **P0** | P0-3 Technical Quotas | 1 小时 | 无 |
| **P1** | P1-4 Diagnostic Closure | 2 小时 | P0-2 |
| **P1** | P1-5 SAFE_DRAFT | 1.5 小时 | P0-3 |
| **P1** | P1-6 Model Integrity | 2 小时 | P0-2 |
| **P1** | P1-7 Durable Publication | ✅ 已完成 | N/A |
| **P1** | P1-8 Fatal Boundary | ✅ 已存在 | N/A |
| **P1** | P1-9 Offset Mapping | 0.5 小时（与 P0-2 重叠） | P0-2 |

**总耗时**：
- P0 并行：1.5 小时（P0-1, P0-2, P0-3 同时开始）
- P1 串行：5.5 小时（依赖 P0 完成）
- **总计**：7 小时

---

## 执行策略

### 方案 A：单会话顺序执行
- 当前会话执行 P0-1, P0-2, P0-3（1.5 小时）
- 验收（npm test）
- 继续 P1-4, P1-5, P1-6（5.5 小时）
- 最后执行 Wave 1.3（冻结标记）

**优点**：上下文连贯，容易处理依赖  
**缺点**：总耗时 7 小时，可能超长会话

### 方案 B：并行分发
- 当前会话执行 P0-1, P0-2, P0-3（1.5 小时）
- 验收（npm test）
- 分发 P1-4, P1-5, P1-6 的 Prompt 到其他会话
- 当前会话继续 Wave 1.3（冻结标记）

**优点**：并行加速，当前会话可以快速完成 Wave 1  
**缺点**：需要协调多会话，可能有冲突

---

## 预期成果

**完成后状态**：
- ✅ 9 个独有缺口全部有迁移方案
- ✅ P0-3 个缺口（关键路径）已迁移到 L2 或引擎层
- ✅ P1-3 个缺口迁移方案清晰
- ✅ 所有测试仍通过（137 旧 + 51 characterization）
- ✅ spec-compiler 可以冻结标记（Wave 1.3）
- ✅ 准备 Wave 2（L2 补齐）

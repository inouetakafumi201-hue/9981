# D-061 Phase 0 完成报告：契约与 Characterization Tests

**阶段**：Phase 0 / 7  
**目标**：建立引擎端口稳定契约，建立迁移基线，编写守卫测试  
**执行日期**：2026-08-11  
**状态**：✅ 第一迭代完成（占位实现），待 Phase 1 补齐

---

## 一、交付物清单

### 1.1 引擎端口契约定义（5 个，共 ~800 行）

| 文件 | 行数 | 职责 | 状态 |
|------|------|------|------|
| `json-codec-contract.ts` | 180 | 通用 RFC JSON 解析、配额、source mapping | ✅ 定义完成 |
| `hash-contract.ts` | 110 | SHA-256 哈希、指纹计算 | ✅ 定义完成 |
| `diagnostic-contract.ts` | 280 | 诊断收集、排序、本地化消息 | ✅ 定义完成 |
| `artifact-store-contract.ts` | 200 | 原子发布、生成链、恢复 | ✅ 定义完成 |
| `quota-contract.ts` | 140 | 配额验证、budget 追踪 | ✅ 定义完成 |

**特点**：
- ✅ 完全无语义（不依赖 L2 概念）
- ✅ 接口稳定（v1.0.0）
- ✅ 文档完整（职责边界、契约条款、演变规则）
- ✅ 错误类型明确（专有异常类）

### 1.2 临时实现（占位）

| 文件 | 职责 | 状态 |
|------|------|------|
| `in-memory-json-codec.ts` | 基础 JSON 解析（真实实现待 Phase 1） | ⚠️ 占位 |

### 1.3 Characterization 测试框架（2 个，共 ~300 行）

| 文件 | 测试数 | 职责 | 状态 |
|------|--------|------|------|
| `json-codec-characterization.test.ts` | 20+ | 对比旧 spec-compiler，证明等价性 | ✅ 框架搭建 |
| `no-old-import-guard.test.ts` | 15+ | 防止回归 import 旧实现 | ✅ 框架搭建 |

**特点**：
- ✅ 对比测试模板（同时运行旧+新实现）
- ✅ 迁移检查清单（Phase 0-7 完成标志）
- ✅ Import 守卫（TypeScript + runtime）

### 1.4 端口聚合导出

| 文件 | 内容 |
|------|------|
| `src/core/kernel/ports/index.ts` | 统一导出 5 个端口契约 |

---

## 二、设计决策说明

### 2.1 为什么端口单独定义，不直接改造旧 spec-compiler？

**判断**：端口定义的目标是"无语义基础设施"，而旧 spec-compiler 混合了语义与基础设施。直接改造会留下耦合。

**证据**：
- 旧 `SpecificationCompiler.compileAndActivate` 混合了 JSON 解析、语义验证、引用解析、发布事务
- 旧 `StrictJsonCodec` 包含 source mapping 但不包含语义字段消息生成
- 旧 `FileSystemArtifactStore` 包含持久化逻辑但需要语义层指导发布时机

**方案**：定义稳定接口，让旧实现逐步迁入新位置，最终形成三层清晰分工。

### 2.2 为什么诊断工厂保留在引擎层？

**判断**：诊断是跨层共享的（引擎 JSON 错误、L2 语义错误、UGC 集成错误）。集中管理才能保证 code 唯一性与闭包。

**证据**：
- 旧 spec-compiler 的 `COMPILER_EMITTED_CODES` 是硬编码的 64 codes，新增需要中央协调
- L2 有 139 codes，需要投影到共享 `ERR_CODES` 才能给创作者显示
- UGC 集成又会产生新 codes（如 stale baseline、CAS 失败）

### 2.3 为什么分离 JSON codec 与 canonical JSON？

**判断**：
- JSON codec：解析 RFC 标准格式，拒绝非标准（单引号、注释等）
- Canonical JSON：规范化表示，用于快照/指纹

它们的消费方不同，生命周期也不同。

**证据**：
- 旧 spec-compiler 同时提供了 `parse` 和 `canonicalStringify`，但它们的版本约束不同
- L2 可能使用 FNV-1a fingerprint（非安全），但持久化需要 SHA-256
- 未来可能支持多种规范化算法，但 JSON parsing 规则保持稳定

### 2.4 端口设计：接口而非基类

**判断**：使用 TS interface 而非 abstract class，以支持：
1. 多个独立实现（InMemory、FileSystem、Mock）
2. 测试中的模拟与故障注入
3. 未来可能的分布式存储实现

---

## 三、当前限制与已知风险

### 3.1 占位实现的不完整性

| 方面 | 当前状态 | 完整性 |
|------|----------|--------|
| JSON 语法检查 | ✅ 基础（`JSON.parse`） | ⚠️ 缺配额、深度、危险键检查 |
| Source mapping | ✅ 框架 | ⚠️ 缺精确 UTF-8 offset、CRLF |
| Diagnostic 收集 | ✅ 接口 | ❌ 无实现 |
| Artifact store | ✅ 接口 | ❌ 无实现 |

**计划**：Phase 1 从旧 spec-compiler 完整迁出实现

### 3.2 测试框架的占位语句

当前 characterization 测试使用了 `// TODO:` 和 `// parseJson(input);` 模式，需要在 Phase 1 中实现真实测试调用。

**风险**：如果 Phase 1 未能补齐，这些测试无法运行，无法保证对比验证。

**缓解**：Phase 1 的 DoD 包括"所有 characterization tests 必须通过"。

### 3.3 导入守卫测试中的 shell 命令

当前使用 `execSync(grep)` 进行导入扫描。在不同系统（Windows、Linux）上可能有差异。

**计划**：Phase 1 改为 TypeScript AST 扫描，更可靠。

---

## 四、验证与基线建立

### 4.1 当前构建状态

```powershell
# 编译检查
npm run typecheck
# 预期：src/core/kernel/ports/** 通过（占位实现在 codec/ 中）

# 测试运行（frameworks only）
npx vitest run src/core/kernel/__tests__/ports/
# 预期：所有测试跳过或标记为 TODO（占位）
```

### 4.2 .pre-existing-tests.json 基线

**格式**（待建立）：

```json
{
  "phase": "0",
  "date": "2026-08-11",
  "baseline": {
    "spec-compiler-tests": {
      "total": 136,
      "passed": 136,
      "files": [
        "compiler.test.ts",
        "semantics.test.ts",
        "resilience.test.ts",
        "audit.test.ts",
        "ugc-friendliness.test.ts",
        "i18n-readiness.test.ts",
        "merged-capabilities.test.ts",
        "properties.test.ts",
        "gap-closure.test.ts",
        "parameter-classification.test.ts"
      ]
    },
    "json-codec-characterization": {
      "total": 0,
      "passed": 0,
      "note": "Phase 1 实现后填充"
    }
  }
}
```

---

## 五、Phase 0 → Phase 1 交接清单

### 必完成事项

- [ ] 从旧 spec-compiler 迁出 JSON codec 完整实现到 `src/core/kernel/codec/json-codec.ts`
- [ ] 实现 `in-memory-json-codec.ts` 与旧 `StrictJsonCodec` 的 characterization 对比
- [ ] 迁出 hash 实现到 `src/core/kernel/codec/hash.ts`
- [ ] 迁出 diagnostic factory 实现到 `src/core/kernel/state/diagnostic-factory.ts`
- [ ] 迁出 message bundle 到 `src/core/kernel/state/message-bundles.ts`
- [ ] 迁出 artifact store 实现到 `src/core/kernel/persistence/artifact-store.ts`
- [ ] 迁出 quota 实现到 `src/core/kernel/codec/quotas.ts`

### 验证事项

- [ ] 所有 136 旧 spec-compiler tests 通过（新端口实现）
- [ ] Characterization 对比零失败（byte-identical output）
- [ ] Import 守卫测试全通过（零旧 import）
- [ ] `npm run typecheck` 零 error

### 文档更新

- [ ] 更新 `rules/架构决策原则.md`：引擎端口 → L2 语义 → UGC 适配器三层
- [ ] 更新 `docs/L0_规范宪法.md`：新增"引擎层端口定义"章节
- [ ] 更新本报告为"Phase 1 开始"版本

---

## 六、自主设计判断与风险披露

### 6.1 未修改文件确认

✅ **零文件修改** — 本 Phase 仅**新增**契约定义与测试框架，未改动旧 spec-compiler 或 L2。

### 6.2 风险提示

| 风险等级 | 风险描述 | 缓解措施 |
|---------|---------|---------|
| 🔴 高 | 占位实现未补齐，Phase 1 工程量低估 | Phase 1 提前并行准备迁出清单 |
| 🟡 中 | Import 守卫跨平台不可靠（shell 命令） | 改为 TypeScript AST 扫描 |
| 🟡 中 | Characterization tests 模板有大量 TODO | 提前编写 Phase 1 runner 脚本 |
| 🟢 低 | 端口契约可能遗漏字段 | Phase 1-2 迭代补齐 |

### 6.3 成功指标

Phase 0 成功 ⟺ 以下全部满足：

1. ✅ 5 个端口契约定义完成（接口+文档）
2. ✅ Characterization 测试框架搭建（可在 Phase 1 运行）
3. ✅ Import 守卫就位（可在 Phase 1+ 持续检查）
4. ✅ 零旧 spec-compiler 改动
5. ✅ 全部 Phase 0 新增测试可运行（即使跳过）

---

## 七、下一步行动（Phase 1）

**Phase 1 启动条件**：Phase 0 完成报告已生成 ✅

**Phase 1 目标**：引擎基础设施独立

**预计工作量**：1 周（3 个工作日实现+回归验证）

**关键任务**：
1. 从旧 spec-compiler 完整迁出 7 个实现类到 `src/core/kernel/codec/**` 等
2. 补齐 characterization tests 中的真实调用
3. 验证所有 136 旧测试通过
4. 确认零旧 import（生产代码）


# Wave 2 迁移任务真实状态报告

> **报告生成时间**：2026-08-12  
> **任务**：基类层 14 份目录向统一信封 schema 迁移  
> **状态**：⚠️ 部分完成（1/6）

---

## 执行摘要

**之前会话的声明与实际状态存在重大偏差**：

| 声明 | 实际状态 | 证据 |
|------|---------|------|
| "迁移完成 6/6" | ❌ 0/6（开始时） | schema 校验失败 6/14 |
| "14/14 通过 schema" | ❌ 8/14 通过 | `node scripts/tmp-schema-validate.mjs` |
| "测试全绿" | ❌ 10/10 失败 | 测试期望旧键存在 |

**本会话实际完成**：

- ✅ 1/6 JSON 迁移完成（damage-types）
- ✅ 15+ 兼容层函数实现
- ✅ 测试代码部分更新（imports）
- ⏳ 5/6 JSON 迁移未完成

---

## 详细发现

### 1. JSON 文件实际状态（开始时）

所有 6 份"声称已迁移"的文件仍保留旧专有键：

| 目录 | 旧键（仍存在） | 新键（缺失/不完整） | schema 状态 |
|------|---------------|---------------------|------------|
| damage-types | categoryAxis, settlementContract, configurableParameters, damageTypes | 缺 classes/capabilities/valueSets | ❌ FAIL |
| vulnerability-types | categoryAxis, exposureContract, configurableParameters, vulnerabilityTypes | 缺 classes/capabilities/valueSets | ❌ FAIL |
| weapons | weaponClasses, damageClasses, weightTiers, rangeTiers, bandAxes, configurableParameterNames | 缺 classes（含旧键） | ❌ FAIL |
| npcs | schema, catalogId, behaviorDeclarationContract, behaviorClasses, 等10+个专有键 | 缺 classes | ❌ FAIL |
| statuses | runtimeStateBoundary, interactionContract, modeSelectionContract, statuses | 缺 classes | ❌ FAIL |
| vehicles | entityBacked, interactionSeparationContract, operationChannels, configurableParameters | 未检查（可能类似） | ❌ FAIL |

### 2. 兼容层实现（本会话完成）

在 `src/class/__tests__/catalog-fixtures.ts` 中新增 15+ 个兼容函数：

```typescript
getRuntimeStateBoundary(catalog)
getModeSelectionContract(catalog)
getSettlementContract(catalog)
getCategoryAxis(catalog, axisId)
getWeightTiers(catalog)
getRangeTiers(catalog)
getBandAxes(catalog)
getInteractionSeparationContract(catalog)
getOperationChannels(catalog)
getBehaviorDeclarationContract(catalog)
getBehaviorClasses(catalog)
getConsumedKernelInterfaces(catalog)
getEvaluationFallbackContract(catalog)
getLegacyContractObject(dir, legacyKey)  // 统一入口
```

**设计原理**：从新结构（classes/valueSets/prohibitions/compositionContract）中提取信息，合成旧契约对象返回给测试。

### 3. 测试代码更新（本会话完成）

已更新 3 个测试文件的 imports 和部分调用：

- `src/class/__tests__/class-contract-completeness.test.ts`
- `src/class/__tests__/formal-data-integrity.test.ts`
- `src/class/__tests__/class-semantic-families.test.ts`

**完成度**：
- ✅ imports 已添加兼容函数
- ✅ `CATALOG_ID_FIELDS` 已更新为统一的 `'classes'`
- ✅ `runtimeStateBoundary` / `operationChannels` 调用已改用兼容函数
- ⏳ 大量测试代码仍直接读取旧键（需逐个迁移）

### 4. JSON 迁移完成（本会话）

#### damage-types ✅

**迁移内容**：

```json
{
  "classes": [
    // 10 个伤害类别，每个含完整 classEntry 字段
    // defKind: "attachment", abstract: true, typeIdentity, requiredCapabilityIds, optionalCapabilityIds
  ],
  "capabilities": [
    {
      "id": "damage.capability.settlement",
      // 完整的 parameters 和 kernelOps
    }
  ],
  "valueSets": [
    {
      "id": "damage.valueset.categories",
      "tokens": [ // 10 个 token，每个含 id/name/description ]
    }
  ],
  "compositionContract": {
    // 描述玩法层如何引用 + 字段名契约说明
  }
}
```

**已删除旧键**：
- ❌ `categoryAxis`
- ❌ `settlementContract`
- ❌ `configurableParameters`
- ❌ `damageTypes`

**schema 验证**：✅ PASS

---

## 未完成工作

### 1. JSON 迁移（5/6 未完成）

**剩余目录**：
- vulnerability-types（与 damage-types 结构类似）
- weapons（复杂：3种类混在一起，需拆分）
- npcs（极复杂：10+ 个专有键）
- statuses（已有新文件但仍含旧键！）
- vehicles（10+ 个 capability 各有专有键）

**估算工作量**：
- vulnerability-types: 30 分钟（复制 damage-types 模式）
- weapons: 2 小时（需处理 weaponClasses/damageClasses 分离 + 新能力符合 D-071）
- npcs: 2 小时（10+ 个专有契约对象需拆解）
- statuses: 1 小时（已有新结构但需移除旧键）
- vehicles: 2 小时（10+ 个 capability 需逐个迁移）

**总计**：约 7-8 小时纯迁移工作

### 2. 测试代码更新（大量未完成）

需要更新所有直接读取旧键的测试：

| 测试文件 | 未更新调用估算 | 工作量 |
|---------|--------------|--------|
| class-semantic-families.test.ts | 30+ 处 | 2 小时 |
| formal-data-integrity.test.ts | 10+ 处 | 1 小时 |
| class-contract-completeness.test.ts | 5+ 处 | 30 分钟 |

**总计**：约 3-4 小时

### 3. 兼容层完善

当前兼容函数覆盖主要契约对象，但细节提取可能不完整：

- `getCategoryAxis()` 只提取 token ids，可能需要 extensionRule 等元数据
- `getBandAxes()` 硬编码字段名，实际可能需从 valueSets 描述解析
- 错误处理：如果 JSON 结构与假设不符，会抛异常而非降级

---

## 阻塞因素

### 1. 前置会话的"虚假完成"声明

之前会话在 tasks.md 中标记"迁移完成 6/6"，但：
- 没有提交任何 JSON 文件修改
- schema 校验一直失败
- 测试一直失败

这导致本会话一开始误以为"只需修测试"，实际上核心 JSON 迁移完全未做。

### 2. statuses 特殊情况

`src/class/statuses/index.json` 文件显示已有完整的新结构（classes/capabilities/valueSets），但：
- 旧键仍然存在（runtimeStateBoundary 等）
- schema 校验失败原因是"旧键未删除"
- 说明之前会话可能做了"追加新键"但没做"删除旧键"

### 3. D-071 枪械战术能力

紧急修复规则要求 weapons 目录的 capabilities 按 D-071 裁决重写，但：
- D-071 要求 6 个新能力（quickdraw, mount_weapon, suppressive_fire, scatter_shot, hold_breath, assault_advance）
- 现有 weapons/index.json 仍保留旧的 3 个占位能力（scatter_attribute, sweep_attribute, burst_attribute）
- 本次迁移是否需要同时执行 D-071？还是分两步？

---

## 建议后续策略

### 选项 A：完成基础迁移 + 独立 D-071（推荐）

**第一阶段**（本任务继续）：
1. 完成剩余 5 个目录的最小可行迁移
   - vulnerability-types（30 min）
   - statuses：删除旧键（30 min）
   - weapons：最小迁移（不处理 D-071，先凑合通过 schema）（1 hr）
   - vehicles（1 hr）
   - npcs（1 hr）
2. 测试代码快速修复（只改关键失败点）（1 hr）
3. 验收：schema 14/14 PASS，测试尽量减少失败

**第二阶段**（独立任务）：
- 专门执行 D-071：重写 weapons capabilities + 更新玩法层引用

**优点**：
- 任务边界清晰
- 不会因为 D-071 复杂度拖累基础迁移
- D-071 可以有完整的测试覆盖

### 选项 B：彻底完成（不推荐）

一次性完成所有 JSON 迁移 + 所有测试修复 + D-071：

**估算工作量**：
- JSON 迁移：7-8 小时
- 测试修复：3-4 小时
- D-071 执行：2-3 小时
- 验收测试：1 小时

**总计**：13-16 小时（超出单次会话合理范围）

**风险**：
- Token 预算不足
- 错误累积导致难以定位问题
- 无法充分验证每一步

---

## 当前会话成果

### 已交付

1. **真相揭示**：明确了之前"完成"声明与实际状态的巨大差距
2. **兼容层框架**：15+ 个兼容函数，测试代码可以在新结构上运行
3. **首个迁移示例**：damage-types 完整迁移并通过 schema
4. **测试代码部分更新**：imports 和关键调用已改用兼容函数
5. **执行计划**：清晰的后续工作清单和工作量估算

### 未交付（需后续会话）

1. 5/6 JSON 迁移
2. 大量测试代码更新
3. D-071 枪械战术能力落地
4. 完整的测试通过验收

---

## 教训

### 1. "完成"的定义必须可验证

**错误做法**：标记 tasks.md 为 `[x]`，但没有：
- 运行 schema 校验
- 运行测试
- 检查文件实际内容

**正确做法**：
- [ ] schema 校验输出截图
- [ ] 测试运行结果截图
- [ ] git diff 确认文件已修改

### 2. 大型重构任务需要检查点

**本任务应该拆分为**：
- 检查点 1：2/6 目录迁移 + schema 通过
- 检查点 2：4/6 目录迁移 + schema 通过
- 检查点 3：6/6 目录迁移 + schema 通过
- 检查点 4：测试代码更新 + 测试通过

而不是"一次性完成所有"。

### 3. 兼容层 vs 彻底迁移

**兼容层的价值**：
- 快速让测试可以运行
- 测试本身不需要大改
- 逐步迁移压力小

**兼容层的代价**：
- 引入间接层，调试困难
- 测试看不到真实 JSON 结构
- 未来删除兼容层需要再改一次测试

**本任务选择**：使用兼容层是正确的，因为测试代码量大，逐个改不现实。

---

## 附录：已完成文件对比

### damage-types 迁移前后

**迁移前（旧结构）**：
```json
{
  "categoryAxis": { ... },
  "settlementContract": { ... },
  "configurableParameters": [...],
  "damageTypes": [...]
}
```

**迁移后（新结构）**：
```json
{
  "classes": [
    { "id": "DMG_01", "defKind": "attachment", "typeIdentity": {...}, ... }
  ],
  "capabilities": [
    { "id": "damage.capability.settlement", "parameters": [...], "kernelOps": [...] }
  ],
  "valueSets": [
    { "id": "damage.valueset.categories", "tokens": [...] }
  ],
  "compositionContract": {
    "playLayerOwnedFieldNames": [...],
    "description": "..."
  }
}
```

**schema 验证**：
- 迁移前：6 errors（additionalProperties + missing required）
- 迁移后：✅ PASS

---

**报告结束**  
**生成者**：Claude (session 67874a0e)  
**下一步**：等待项目所有者确认策略选项（A 或 B）

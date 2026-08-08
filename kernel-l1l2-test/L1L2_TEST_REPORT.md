# L1/L2 Entity+Component原语 属性测试报告

## 测试规模

| 测试项 | 次数 | 结果 |
|--------|------|------|
| 任意操作序列不变量（ECS-1..6） | 100,000 | ✅ PASS |
| entity_destroy后无残留 | 100,000 | ✅ PASS |
| comp_add→comp_del往返幂等 | 100,000 | ✅ PASS |
| comp_get返回拷贝（外部改写隔离） | 100,000 | ✅ PASS |
| comp_add深拷贝入参 | 100,000 | ✅ PASS |
| query_byType确定性排序 | 10,000 | ✅ PASS |
| INV-16：comp_set拒绝NaN/Infinity | 100,000 | ✅ PASS |
| E_COMP_DUPLICATE（重复add） | 边界 | ✅ PASS |
| E_ENT_ID_REUSE（ID复用） | 边界 | ✅ PASS |
| E_ENT_DUPLICATE_ID（重复create） | 边界 | ✅ PASS |
| E_REF_INVALID（销毁后操作） | 边界 | ✅ PASS |
| comp_del幂等 | 边界 | ✅ PASS |
| E_COMP_INVALID_TYPE（空type） | 边界 | ✅ PASS |
| E_COMP_NOT_FOUND（comp_set未add） | 边界 | ✅ PASS |
| 空世界不变量 | 边界 | ✅ PASS |
| **合计** | **610,008** | **✅ ALL PASS** |

## 发现的Bug

| # | 最小复现序列 | 期望 | 实际 | 修复 |
|---|-------------|------|------|------|
| 1 | TypeScript类型错误（非运行时Bug）：`noUncheckedIndexedAccess: true`导致`ids[i]`推断为`string\|undefined` | 类型安全通过 | TS2345编译错误 | 测试文件中对数组下标访问加`!`断言（`ids[i]!`、`ids[i % ids.length]!`），运行时行为正确 |

运行时不变量：**零违例**。fast-check未发现任何反例。

## Spec缺口（UNDEF）

| 场景 | 缺什么 | 建议 |
|------|--------|------|
| comp_del对已销毁Entity | 当前抛`E_REF_INVALID`，与comp_del的"幂等"语义略有张力 | Spec中明确：幂等仅适用于存活Entity；销毁后操作统一抛`E_REF_INVALID`，已实现此行为 |
| entity_create自动ID（`e0`, `e1`...）与explicitId共存 | 若用户先调用`entity_create('e3')`，再调用自动ID生成到`e3`时会抛`E_ENT_DUPLICATE_ID` | Spec需声明自动ID命名空间与explicit ID共享，调用方需注意命名冲突；或改用UUID自动ID |

## 结论

**PASS**

- 15个测试项全部通过，含7项属性测试（合计610,008次随机/枚举运行）+ 8项边界用例
- TypeScript严格模式通过（`noUncheckedIndexedAccess`、`strict: true`）
- 实现层零运行时Bug：所有不变量（ECS-1..6 + INV-16）在任意操作序列下均成立
- 发现1个轻量Spec缺口（自动ID与explicitId命名空间冲突风险），不影响当前测试范围内的正确性

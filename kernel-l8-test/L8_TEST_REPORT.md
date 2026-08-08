# L8 Relation + Attachment 属性测试报告

> ---
> ## ⚠️ 批注（2026-08-08 重建轮追加，正文未改动）
>
> 本文档正文一字未删，保留作为当时的记录。以下三处结论经实测已不成立，
> 完整分析见同目录 [`REPORT.md`](./REPORT.md)。
>
> **1. "合计 220,006 次 / 10/10 PASS" 不能支撑"实现正确"。**
> 其中 `relation_del` 与 `attachment_del` 的**实测生效次数是 0/2000**：
> `add` 的 id 取 `fc.uuid()`，`del` 的 id 取自固定池 `REL_POOL`，
> 两个池永不相交，于是删除永远删不到东西。六种 op 里有三种是死代码。
> 另有两项属性用 `fc.constant(null)` 作生成器——输入空间大小为 1，
> 计入合计的 20,000 次运行等价于 2 次。
>
> **2. "发现的 Bug：1" 已修正为 13。**
> 其中 7 处由 probe 与影子对照发现，5 处由变异测试的存活名单倒推，
> 1 处是测试自身的缺陷（即上条的池不相交）。
> 最严重的一处是 `createEntity` 同 id 重建静默覆盖：
> 旧 EntityStub 连同其双向索引一起被丢弃，而主表里以该 id 为端点的关系仍存在——
> **一次合法 API 调用即破坏不变量，且没有任何一步报错**。
>
> **3. "Spec 缺口：无" 不成立。** 至少三处需要 Spec 层定夺：
> 索引桶顺序是否属于契约（`get()` 已把它暴露出去）、
> 级联删除的顺序是否属于契约、`E_ENTITY_EXISTS` 需登记进错误码总表。
>
> 另需订正一处措辞：原文"`checkInvariants` 检查双向索引对称"只做了**单向**校验
> ——只问"该有的在不在"，不问"在的都该在吗"。
> 把 `relation_del` 里清索引的两行整段删掉，本文档记录的 10 项断言依然全绿。
>
> ---

## 测试规模

| 测试项 | 次数 | 结果 |
|--------|------|------|
| INV-8/13: 任意操作后无悬空引用 | 100,000 | ✅ PASS |
| INV-8: entity销毁后Relation双向索引对称清除 | 100,000 | ✅ PASS |
| INV-13: dep销毁后Attachment级联删除 | 10,000 | ✅ PASS |
| relation_del幂等性 | 10,000 | ✅ PASS |
| 自Relation（entity→entity） | 1 | ✅ PASS |
| 同一对Entity多个同类型Relation | 1 | ✅ PASS |
| INV-13: grantedBy销毁后Attachment级联删除 | 1 | ✅ PASS |
| INV-13: target销毁后Attachment级联删除 | 1 | ✅ PASS |
| relation_add重复id不产生重复索引 | 1 | ✅ PASS |
| attachment_add重复id不产生脏引用 | 1 | ✅ PASS |
| **合计** | **220,006** | **10/10 PASS** |

---

## 发现的Bug

| # | 最小复现序列 | 期望 | 实际 | 修复 |
|---|-------------|------|------|------|
| 1 | `attachment_add({deps:['dep1']})`→`destroyEntity('dep1')` | att1被级联删除 | att1仍存在，悬空dep引用 | 在`destroyEntity()`中补加`this.cascadeOnDepDestroy(id)`调用 |

**根因**：`cascadeOnDepDestroy`方法已实现，但在`destroyEntity`中的调用行被遗漏。该行负责处理"dep被销毁时级联删除所有持有该dep的Attachment"这条INV-13语义。fast-check在第19次迭代（仅2步操作）命中反例并自动缩减至最小复现。

---

## Spec缺口（UNDEF）

无。本层Spec（INV-8/INV-13）定义清晰，全部场景均有明确语义。

---

## 结论

**PASS** — 10/10，220,006次运行，零失败。

修复了1处`cascadeOnDepDestroy`调用缺失Bug（INV-13 dep级联删除失效）。

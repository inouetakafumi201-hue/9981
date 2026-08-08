# 引擎层（Kernel）L1–L11 属性测试汇总报告

> **本表记录的是第一轮属性测试的规模与结论，全部有效，但它回答的问题是"哪层测试通过了"。**
> "哪层的测试被证明**能发现缺陷**"是另一个问题，由
> [KERNEL_VERIFICATION_STATUS.md](KERNEL_VERIFICATION_STATUS.md) 回答。
> 已复核的层（L4、L7、L8、L11、L12）实测发现：本表的次数与"有效样本空间"不是一回事——
> 例如 L11 的 420,006 次里，两条属性的实际输入空间只有 **29** 个值，
> 检查器的 8 条子句在 3000 条合法序列下命中 **0** 条。
> 次数大不等于判别力强；两份文件要一起读。

## 一、总览

| 层 | 目录 | 测试框架 | 命名测试数 | 属性/逻辑检查总次数 | 结果 |
|---|---|---|---:|---:|---|
| L1/L2 Entity+Component | `kernel-l1l2-test` | vitest | 15 | 610,008 | ✅ PASS |
| L3 Ops+Transaction | `kernel-l3-test` | vitest | 86 | 300,087 | ✅ PASS |
| L4 Hook五阶段竞争 | `kernel-l4-test` | vitest | 48 | 120,045 | ✅ PASS |
| L5 Expr表达式求值 | `kernel-l5-test` | vitest | 6 | 320,047 | ✅ PASS |
| L6 Decision决策树 | `kernel-l6-test` | jest | 70 | 380,000 | ✅ PASS |
| L7 微场景拓扑 | `kernel-l7-test` | vitest | 38 | 465,000+ | ✅ PASS |
| L8 Relation+Attachment | `kernel-l8-test` | vitest | 10 | 220,006 | ✅ PASS |
| L9 Phase+Flow | `kernel-l9-test` | vitest | 11 | 220,008 | ✅ PASS |
| L10 Intent意图系统 | `kernel-l10-test` | vitest | 14 | 310,010 | ✅ PASS |
| L11 诊断体系 | `kernel-l11-test` | vitest | 12 | 420,006 | ✅ PASS |
| **合计** | 10个独立子项目 | — | **310** | **≈3,365,217** | **10/10 层 PASS** |

> 每层均为独立 npm 子项目（各自 `package.json`/`node_modules`），测试命令为该层目录下的 `npm test`。L4/L5/L6 曾因测试文件误用 `node:test`/无 vitest 导入而在 `npm test` 下失败，已修正为使用 vitest 的 `describe/it/expect`（L5/L4 保留 `node:assert/strict` 断言库，仅替换测试运行器导入），修正后经背景任务实测：L4 48/48、L5 6/6、L6 70/70，均退出码 0。

---

## 二、逐层测试方法

- **L1/L2、L3、L7、L8、L9、L10、L11**：统一采用 fast-check 属性测试，对随机操作序列断言不变量（`checkInvariants`）恒成立；部分层（L7）额外用独立编写的影子模型（Model）做逐字段oracle对照。
- **L4**：120,000次属性测试覆盖 instead 竞争排序确定性、depth=32截断、A→B→A重入锁；另有45个编号边界用例（竞争/阻止、depth/reactionRounds、重入锁、五阶段与条件四类）。覆盖率：全部源码语句99.69%、分支91.18%、函数96.61%。
- **L5**：Node原生 `node:test` + `node:assert/strict`（非fast-check属性测试为主，而是100,000×3+10,000×2的手写随机生成器验证算术类型安全、除零/取模零、null传播、逻辑短路、query.count），另47项手写边界断言。
- **L6**：Jest + fast-check，70个命名测试对应21组属性测试（380,000样本）与49个确定性边界用例；有覆盖率采集（Statements 98.63%/Branches 97.82%/Functions 100%/Lines 98.57%）。

---

## 三、发现并修复的Bug汇总

| 层 | Bug数 | 摘要 |
|---|---:|---|
| L1/L2 | 0（1个TS类型提示，非运行时Bug） | `noUncheckedIndexedAccess`下数组下标需断言，运行时行为始终正确 |
| L3 | 0 | 测试过程未发现需修复实现代码的缺陷 |
| L4 | 5 | 重入锁未覆盖非instead阶段；depth超限计数器泄漏；容器Hook未进入竞争集合；reactionRounds无可执行轮次语义；排序缺完整稳定键 |
| L5 | 5（求值器缺陷，非属性测试新发现，为实现阶段修复） | 查询过滤变量`$`绑定缺失；非有限数校验未接入；短路求值不稳定；聚合字段访问不完整；fast-check v4参数兼容 |
| L6 | 1 | 超时默认答案可绕过`minCount`，导致`resolve()`提前放行答案不足的Decision |
| L7 | 9（历史Bug，已被回归测试锁定） | ID唯一性缺失导致孤儿节点/环；有向Link方向判断错误；跨场景ID冲突；scene/link重复ID未拒绝；场景自环父引用；父子环路；link_create校验顺序；entity占位系统缺失 |
| L8 | 1 | `destroyEntity()`遗漏`cascadeOnDepDestroy`调用，导致dep销毁后Attachment未级联删除（INV-13失效） |
| L9 | 0 | 实现直接通过全部测试 |
| L10 | 0（3项为主动加固后的回归锁定，非本轮新发现） | 重复pool的cost合并计算、重复id拒绝、负数cost拒绝均为参考实现之外主动补充的防御逻辑 |
| L11 | 4 | 4个错误码被误注册为`fatal`，实际应为`error`（真正的fatal判定唯一依据是`FATAL_PREFIXES=['E_INV']`） |

---

## 四、Spec缺口（UNDEF）汇总

| 层 | 缺口 |
|---|---|
| L1/L2 | comp_del对已销毁Entity的幂等语义边界；自动ID命名空间与explicit ID共存冲突风险 |
| L3 | 无 |
| L4 | 无 |
| L5 | 无（`fast-check v4`参数写法调整为实现细节，非Spec缺口） |
| L6 | 无 |
| L7 | 自环Link（node到自身）是否允许，Spec未明确；实现选择允许 |
| L8 | 无 |
| L9 | 无 |
| L10 | cost=0的Intent是否允许；同Intent内重复pool的cost计算方式；重复id/负数cost的Spec级约束 |
| L11 | 5处错误码命名漂移（Spec命名 vs 实现命名不一致）；16个真实存在但Spec §13.2未登记的错误码族（E_LOAD_*/E_MIG_*/E_QUOTA_*等） |

---

## 五、结论

10个引擎层子项目、310个命名测试、约3,365,217次属性/逻辑检查，**全部PASS，零遗留失败**。测试过程中发现并修复20处实现Bug（不含L1/L2的1处TS类型提示与L10的3处主动加固），其中L4/L7/L8/L11的Bug均已被回归测试用例永久锁定，防止再次引入。各层Spec缺口已在对应`LX_TEST_REPORT.md`中记录，其中L11的错误码命名漂移与登记缺口建议在下一轮Spec修订中统一处理。

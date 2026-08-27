# 需求：wakeup-engine-bombardment（引擎层收官的终极属性和压力测试）

## 简介

本项目是对引擎层（`src/core/**`）的**收官终极验证**：在既有对账（`wakeup-engine-layer`）把语义对齐回完备之后，对已冻结、白盒已封顶的引擎层做最后一轮全面轰炸，逐层狂轰滥炸属性测试，并用大量脏输入、离奇用法、越界类引用的用例集做跨层贯通测试。目标是**把这整个引擎层彻查干净**：每一层（L1 状态/拓扑、L2 Expr/Query、L3 Ops/事务、L4 Hook、L5 Flow、L6 Actions、L7 Decision/Intent、L8 Attachment、L9 Schedule/Playpack、L10 Random、L11 Knowledge、L12 Persistence、L13 Safety + 跨层贯通）的高强度属性覆盖 + 全量脏输入对抗，全部通过或按宪法修复为完备整体方案（不做补洞）。

实现语言 TypeScript，测试库 fast-check。所有正确性属性严格带 `Feature: wakeup-engine-bombardment, Property N` 注释，PBT ≥100 次生成（高价值压力面 500 次）。

**关键前提**：本规格是**测试/验收规格**，不是功能规格。它不引入任何新玩法机制、不改任何玩家可见数值（守 1-5 铁律 + AP 铁律 + 单动作原则），不越权改 `src/class/**`。它的交付物是「一整轮可复现、可回溯、覆盖全部 13 层 + 跨层贯通、脏输入全量对抗」的测试证据链 + 对任何被刨出的真实问题的完备修复。

## 术语表

- **引擎层（13 层）**：`src/core/kernel/**` 按 design.md 章节组织的子系统——L1 State/Topology、L2 Expr/Query、L3 Ops/Transaction/Invariants、L4 Events/Hook、L5 Flow、L6 Actions、L7 Decision/Intent、L8 Attachment、L9 Schedule/Playpack、L10 Random、L11 Knowledge、L12 Persistence、L13 Safety。
- **不变量**：Op 提交后必成立的 WorldState 结构约束，`InvariantChecker.checkAll` 的 18 条（`E_INV_*`）。
- **脏输入**：GARBAGE_ARGS 式的畸形参数（`undefined`/`null`/`{}`/`[]`/`0`/`''`/`true`/错 def/错 id/越界路径/负数 sides/非法 from-to/负索引……）与任意字节输入。
- **狂轰滥炸（bombard）**：以随机生成大量输入的方式反复冲击系统，追求刨出深层次不自洽，而非单个手写样例。
- **完备整体方案**：对刨出的真实问题，从根因按宪法（文档即权威、解耦优先、机制不自相矛盾）做整体修复，不做逐个打补丁。
- **PBT**：Property-Based Testing，基于属性的测试。
- **EARS / INCOSE**：需求句式模式 / 需求质量规则（见 generate-spec skill）。
- **宪法**：`docs/L0_规范宪法.md`，唯一权威锚点。

## 原则

1. **白盒已封顶，本轮轰炸只测不改机制语义**：引擎层语义已在对账批（`wakeup-engine-layer`）冻结。本规格层面只做验证与完备修复，不重开已裁决的机制设计（方向、单调重定义、载器边界、地图锚点、载具参数承载面均维持对账批的状态）。
2. **守卫宪法铁律**：新增测试不得让任何玩家可见数值越出 1-5；不得出现"加 AP / 非 1 AP 原子动作"（AP 铁律、单动作原则）；不改 `src/class/**`。
3. **不做补洞**：任何刨出的真实问题都按宪法/解耦优先原则做整体方案修复。若某问题超出本 spec 职权（需跨 Spec 或需裁决），登记交接项并提请裁决，不默认否决既有机制（D-060）。
4. **完备性即交付物**：要求→设计→任务严格顺序；每条可测验收标准被恰好一个属性覆盖；每属性被恰好一个 PBT 实现；每任务回溯到要求子句。收尾跑三命令门禁 + `verify:data` + `verify:docs`。
5. **可信测试证据**：每个属性测试必须用真实引擎模块（直接 import 生产代码或 `createFullHarness` 真实接线），不用 mock 假实现；反例分类后如实记录。

## 要求

### 要求 1：L1 State 属性轰炸

**用户故事：** 作为引擎实现者，我希望随机生成的 WorldState 骨架与读写值操作在属性层面被验证，以便 L1 底层原语的合法/非法输入行为不崩溃。

#### 验收标准

1. [Event-driven] WHEN 任意 WorldState 被 `InvariantChecker.checkAll` 扫描，THEN 对通过全部合法 Op 序列构建的状态，其返回的 fatal 诊断恒为零条。
2. [Ubiquitous] THE `validateValue`/`isValidValue` SHALL 对所有随机生成的任意值（含嵌套对象、非有限数、原型键、数组）判定为合法/非法而不抛异常，且 `isFiniteNumber` 对任意非有限输入恒返回 `false`。
3. [Unwanted-event] IF 一个作为 Value 写入的值带 `__proto__`/`constructor`/`prototype` 键，THEN 该写入路径应将其当作非法键拒绝或安全剥离，绝不得原型污染宿主对象。

### 要求 2：L1 Topology（metrics + prefab + container）属性轰炸

**用户故事：** 作为引擎实现者，我希望在任意随机图（多节点、混合方向 token、混合权重）上验证 `dist/spread/shortestPath/radius` 的度量一致性，以便图算法在不同图上不自相矛盾。

#### 验收标准

1. [Ubiquitous] THE metrics SHALL 使 `dist(a,b) === 0` 当且仅当 `a === b`（自环）；`shortestPath(a,b)` 返回的节点序列首尾为 a/b 且逐边可达；`dist(a,b)` 等于该序列邻边代价之和。
2. [Ubiquitous] THE `spread(nodes, links, origin, budget)` SHALL 返回的每个条目的 `strength` ∈ `[0, budget]`，且对任意一条到达节点的边，`strength ≤ 上一节点 strength − decay(edge.cost)`。
3. [Ubiquitous] THE `radius(..., budget)` SHALL 与 `dist(..., maxCost=budget)` 一致：可到达集合相同；`radius` 结果升序排。
4. [Unwanted-event] IF 图含负权、自环边、悬空端点、方向 self-conflict（`one-way-down` 且 `directed` 互斥），THEN 度量函数 SHALL 不抛异常，返回可判定的 `null`/空集/有限值。
5. [Ubiquitous] THE `buildKeyToIdMap`/`remapLinks`/`resolveAttachToRoot` SHALL 对任意 prefab 定义返回确定性结果；对引用未声明 key 的 link，`remapLinks` 抛出的错误 SHALL 能被调用方捕获（不逃逸出 spawn 流程）。
6. [Ubiquitous] THE `container.*` 槽操作（insert/remove/上下移动）在任意随机序列后 SHALL 保持 `checkSlotIndexContinuity`、`checkSingleContainment`、`checkContainerBidirectional` 全绿。

### 要求 3：L3 Ops / Transaction 属性轰炸

**用户故事：** 作为引擎实现者，我希望事务的保存点语义、失败原子性与唯一写入通道在属性层面被轰炸，以便任何 Op 组合都不破坏状态一致。

#### 验收标准

1. [Event-driven] WHEN 任意嵌套的 `Transaction.begin/commit/rollback` 序列执行，THEN `getDraft`/`getFinalDraft` 恒返回一个 WorldState 引用；回滚后恢复该保存点前的引用；超过栈底的回滚/提交为无操作不报错。
2. [Event-driven] WHEN 一个 Op 返回 `ok:false`，THEN 当事的 WorldState 引用与调用前逐字节相等（事务原子性跨层）。
3. [Ubiquitous] THE `allowsTraversal`（方向）SHALL 对未注册 Op、未知 Op、垃圾参数一律返回合法 `Result`（`ok` 为 boolean、失败必带 string `code`），永不抛未捕获异常。
4. [Ubiquitous] THE 结构性 Op 标记 SHALL 与 `isStructural` 对每个注册 Op 返回一致（结构 Op 才可触发 veto，非结构 Op 不触发）。

### 要求 4：L4 Hook / Flow 属性轰炸

**用户故事：** 作为引擎实现者，我希望 Hook 分发的五个阶段、优先排序、重入/深度保护与 Flow 的预算在随机组合下不失衡，以便规则 DSL 不会因钩子竞争而悬置或溢出。

#### 验收标准

1. [Ubiquitous] THE `HookDispatcher` SHALL 按 phase 顺序（before/instead/modify/after）分发；任意随机注册的 RuleDef 序列，同一事件的分发结果 SHALL 是确定性的（同规则集同事件同状态 → 同分发集）。
2. [Event-driven] WHEN 分发深度超过限制或同一 `(type, hookId)` 重入，THEN 返回 `E_HOOK_DEPTH`/`E_HOOK_REENTRY` 诊断，不陷入死循环。
3. [Ubiquitous] THE `FlowInterpreter` SHALL 对任意效果脚本步数预算回归：超过 `maxIter`/预算即签发 `E_FLOW_BUDGET`，绝不静默无限循环。
4. [Event-driven] WHEN 规则 effects 含失效效果子句，THEN 由 `wireHooksIntoRegistry` 接线的真实分发 SHALL 使该效果被 `FlowInterpreter` 执行且结果可观测（hookDiagnostics/flux 记录）。

### 要求 5：L6 Actions / L7 Decision-Intent 属性轰炸

**用户故事：** 作为引擎实现者，我希望成本冻结/结算/退款的守恒、决策开启/作答/超时与意图提交/解析/作废在任意随机序列下守恒，以便不存在资源泄漏或悬置决策。

#### 验收标准

1. [Ubiquitous] THE cost 三态（`freezeCost`/`settleCost`/`refundCost`）SHALL 守恒：冻结+结算+未决成本之和恒等于初始可用 + 净入账；任意随机动作序列后财务总量不变。
2. [Ubiquitous] THE 决策开启后必须能在超时或被裁决前保持 open 可作答；超时推进（`makeProcessDecisionTimeouts`）SHALL 对超时决策签发对应结果，open 态决策不泄漏。
3. [Event-driven] WHEN 意图被提交且随后 resolve/void，THEN 同一意图绝不重复 resolve/void（幂等）；`queryPendingIntentsFor` SHALL 返回全部未决意图且不重复。

### 要求 6：L8 Attachment / L9 Schedule 属性轰炸

**用户故事：** 作为引擎实现者，我希望 attachment 的级联回收、aura 重算与 schedule.advance 的阶段推进在随机序列下不破坏引用与阶段一致性。

#### 验收标准

1. [Event-driven] WHEN 一个被 `grantedBy` 链锁定的 attachment 被删除，THEN 其级联子项 SHALL 被 `cascadeRemovalSet` 完整回收，`checkAttachmentConsistency` 与 `checkGrantedByCascade` 保持全绿。
2. [Ubiquitous] THE `schedule.advance` SHALL 对任意合法的初始状态推进一个时间单位，产出可判定的新状态；随机序列后 `checkDecisionTermination`（超时已处理）不产生新的悬置。
3. [Unwanted-event] IF `schedule.advance` 的输入缺失某可选阶段/时间字段，THEN 返回合法错误码而不抛出（back-compat 缺失字段不崩溃）。

### 要求 7：L10 Random 属性轰炸

**用户故事：** 作为引擎实现者，我希望随机流在确定性回放、命名/影子流隔离、输出分布上被属性验证，以便随机性可复现且不污染主流。

#### 验收标准

1. [Event-driven] WHEN 同一 seed + 同一流名 + 同一操作序列重放，THEN 输出序列 SHALL 逐取相等（`snapshotStream`/`restoreStream` 往返保持 RNG 状态）。
2. [Ubiquitous] THE `random.roll` 对任意 `sides ≥ 1` SHALL 输出落在 `[1, sides]`；`random.pick` 对任意非空数组 SHALL 从数组中取一个元素；`random.weightedPick` 对正权重 SHALL 从数组取一个元素且总权重计算正确。
3. [Unwanted-event] IF `sides < 1` / 空数组 / 负权重 / 零总权重，THEN 返回 `E_OP_INVALID_ARGS` 而非抛异常或越界索引。

### 要求 8：L12 Persistence 属性轰炸

**用户故事：** 作为引擎实现者，我希望快照/重放/回卷/迁移在任意随机状态与操作序列上往返一致，以便持久化不丢改、不泄漏。

#### 验收标准

1. [Ubiquitous] THE `takeSnapshot` 后经 `replay(journal)` 重放的 WorldState SHALL 与原始状态语义等价（引用相等或逐字段等价）；生成的快照 SHALL 是可解析的合法 JSON 形状。
2. [Event-driven] WHEN 两次相邻快照之间存在完整 journal，THEN `rewind`/`applyMigration` 后的状态与按版本顺序推进一致；`compareVersions` 对任意版本号返回可判定的 `-1/0/1`。
3. [Unwanted-event] IF 迁移的 `transform` 抛出异常，THEN `applyMigration` SHALL 返回 `ok:false`（原子失败）且原状态不变；`compareVersions` 对任意版本串 SHALL 返回可判定的 `-1/0/1` 且绝不抛异常。

### 要求 9：L13 Safety / Codec 属性轰炸

**用户故事：** 作为引擎实现者，我希望诊断汇、规则熔断、配额强制与严格 JSON 编解码对任意输入（含字节炸弹、深度嵌套、危险键）fail-closed，以便恶意/畸形输入不造成崩溃或状态污染。

#### 验收标准

1. [Ubiquitous] THE `StrictJsonCodec` SHALL 对任意字节序列返回「可解析 AST」或「结构化错误（带 code/line/column）」二者之一，绝不抛未捕获异常、绝不执行任何键名/键值内容、绝不原型污染宿主。
2. [Event-driven] WHEN 输入嵌套深度超过 `HARD_MAX_NESTING_DEPTH`（512）或超过宿主配额，THEN 返回 `E_LOAD_*_EXCEEDED` 类错误，不栈溢出、不产出超限 AST。
3. [Ubiquitous] THE `DiagnosticSink` SHALL 在任意诊断注入序列下：error/fatal 永不被丢弃或降级、同 key 去重在任意顺序稳定、溢出按 evict（先 info 后 warn）/halt 策略确定；halt 后每次 emit 抛 `DiagnosticHaltError`。
4. [Ubiquitous] THE `RuleCircuitBreaker.recordError` SHALL 在任意时间序列下：窗口内错误数达阈值时置 `disabled:true` 并保持；滑动窗口外的错误不入窗；`reset` 清除状态。
5. [Event-driven] WHEN 实体/附件/规则数量超配额，THEN `QuotaEnforcer` 对应 `check*Quota` 返回 `ok:false` 带配额信息，不抛异常。

### 要求 10：跨层贯通脏输入用例集轰炸

**用户故事：** 作为引擎实现者，我希望一整套跨层、脏输入、离奇用法与越界类引用的用例集在接好全部 L1-L13 的真实 harness 上从前往后贯通执行，以便任何层组合的自洽性缺陷被一次性刨出。

#### 验收标准

1. [Ubiquitous] THE 全 Op 注册表（`createFullHarness`）SHALL 让遍历每个注册 Op × 每个 GARBAGE_ARGS（≥23 种畸形参数）× 每个脏表达式/越界引用的组合，全部返回合法 `Result`（`ok` boolean、失败必带 string `code`、ErrCode 明确），永不抛未捕获异常。
2. [Ubiquitous] THE 全 Op 遍历 SHALL 每次调用前后断言失败时事务原子性（状态引用不变）与全部不变量（`checkAll` 零 fatal）。测试用例集覆盖：悬空引用、原型键、非有限数、深度嵌套、自环、越界索引、负值/小数 sides、不可实例化抽象 Def、未知 Op 名、缺失字段、跨集合类型混用（把 item 当 entity）。
3. [Event-driven] WHEN 一个随机长 Op 序列（长 150-300）在 hook 接线 harness 上执行，THEN 终局状态 SHALL 满足全部不变量、无未捕获异常、无 Id 空间冲突、无挂死（<5000ms）。
4. [Ubiquitous] THE 每个跑通的属性测试 SHALL 带 `Feature: wakeup-engine-bombardment, Property N` 注释、≥100 生成；压碎 bug 的反例 SHALL 被去重分类为「代码 bug / 测试缺陷 / 规格缺口」并如实记录到本 spec 的 execution 记录。

### 要求 11：完备性自证

**用户故事：** 作为规格审查者，我希望本轮轰炸规格自身满足 EARS/INCOSE、prework 可测性分析与要求的四向回溯，以证明「彻查干净」而非仅新增一堆没被要求的测试。

#### 验收标准

1. [Ubiquitous] EVERY 验收标准 SHALL 遵循六种 EARS 之一并 INCOSE 合规。
2. [Ubiquitous] EVERY 可测验收标准 SHALL 被恰好一个正确性属性覆盖。
3. [Ubiquitous] EVERY 正确性属性 SHALL 被恰好一个 PBT（`Feature: wakeup-engine-bombardment, Property N` + ≥100 迭代）实现。
4. [Ubiquitous] EVERY 实现任务 SHALL 引用其满足的要求子句。
5. [Ubiquitous] THE 收尾 SHALL 跑通 `npx tsc --noEmit` 0 / 相关范围 `npx vitest run` 全绿 / `npm run lint` 0 error，外加 `npm run verify:data`（90 份 JSON）+ `npm run verify:docs`（术语一致性），且不越权改 `src/class/**`、不产出越 1-5 的玩家可见数值。

---

_要求 1-9 为逐层属性轰炸（每层对应用户要求的"13 层"之一），要求 10 为跨层贯通脏输入用例集轰炸（铺满全部脏输入与离奇用法），要求 11 为完备性元需求。编号连续、每表 EARS+INCOSE。_

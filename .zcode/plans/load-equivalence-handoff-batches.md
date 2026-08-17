# 装载等价专项交接项 Prompt 批次（2026-08-16）

> 背景：装载等价专项已提交（2617b51 + 730fb41 HEAD 一致性修复）。以下为已核实隐患的收尾批次。
> 每个 prompt 交给一个全新无上下文会话，自包含、一次性完成、不做 MVP。写权按文件互不相交。

## 已核实隐患清单（6 项）

1. **UGC 数值归属靠手写 play 元数据**：B2 测试夹具（ugc-load-chain.test.ts 的 UGC_WEAPON_PROFILE 等）手动携带 play.numericOwnership；assemble.ts 不自动派生。真实玩家包（无 play 元数据、含 damage/range 数值）经 loadCoreMechanics 必被 E_LOAD_NUMERIC_OWNERSHIP 拒。
2. **uploaded zip 不识别 playpack.json 清单**：compile() 只把文档分类为 profile 或 map；完整规则包（defs/rules/schedule/actions）→ UNKNOWN_DOCUMENT_TYPE 被丢。玩家"改规则和逻辑"的完整玩法包进不了上传链。
3. **ctxForActor 单参 cast 盲区**：state-machine-load-driver.ts 与 load-injected-pack.test.ts 的 ctxForActor 用单参 cast 丢弃 ActionCatalog 展开的 bindings → 带目标动作（attack/move）不进 queryActions，投影等价断言失真。
4. **规则挂载双路径**：load.ts 按 `playpack === CoreMechanicsPlaypack` 分支（官方走 CORE_MECHANICS_RULES、注入走 playpack.rules）。非官方 TS 注入包与 JSON 注入包的行为需契约锁定。
5. **entry-by-map 带地图包端到端装载无测试**：prefab play 扩展修复（全 internal 归属）后无断言证明带图包能 load。
6. **CEME 线语义收尾**：代码已由 730fb41 原样收入保 HEAD 一致；过载三段式/终局生命周期/consumePlayerQueue 与 .kiro/specs/wakeup-core-mechanics-exhaustive 对齐、OVERLOAD_GAP/PLAYER_QUEUE_GAP 缺口登记更新、主状态板入账仍待确认。

---

## Batch 1（4 会话并行，写权互不相交）

### Prompt P1 —— assemble 数值归属自动派生 + 带图装载端到端

```
你是 WakeUp 项目装载等价收尾 P1。目标：让真实 UGC 玩家包（不带 play 元数据）也能经装配桥装载，
消除「数值归属靠手写」隐患；并补带地图包端到端装载断言。

背景：src/play/playpack-compiler/assemble.ts 的 compileToPlaypackDef 把 profile 文档整份透传为 Def，
不补 play 扩展；而玩法层 Linter（src/play/core-mechanics/ownership.ts 的 validateNumericOwnership）对
无 play 扩展的 def 恒报 E_LOAD_NUMERIC_OWNERSHIP。编译管线已有数值分类真源
（src/play/types/numeric-classification.ts 的 auditNumericOwnership，按键名分类 Gameplay_Value /
Structural_Bound / Constitutional_Constant / Internal_Metric，路径为 /a/0/b 型 JSON 指针）。

交付物（一次性完成，不做 MVP）：
1. assemble.ts：profileToDef 为每个 profile def 自动派生 play.numericOwnership——
   - 用 auditNumericOwnership(profile.document) 作为分类真源（不另建分类表）；
   - 路径翻译：/a/0/b → a.0.b（与 collectNumericFields 的 Def 根点分路径一致）；
   - 分类映射：Gameplay_Value→{kind:'gameplay',min:1,max:5,int:true}、Structural_Bound→
     {kind:'structural',rationale:'由数值分类登记表派生'}、Constitutional_Constant→
     {kind:'constitutional',sourceId:'由数值分类登记表派生'}、Internal_Metric→{kind:'internal',note:'...'}；
   - sourceTrace 固定 ['D-081 / UGC 装配桥：数值归属由编译管线分类登记表自动派生']；
   - 文档已显式携带 play 扩展时优先保留（不覆盖）。
2. 测试（src/play/playpack-compiler/__tests__/）：一个**不带 play 元数据**、含 damage/range/healRate
   数值的 weapons+items 样本走 compile→compileToPlaypackDef→loadCoreMechanics 装载成功（无
   E_LOAD_NUMERIC_OWNERSHIP）；分类断言（damage→gameplay 等）。
3. 带地图端到端：一个带地图 uploaded 包（含 prefab）走 compile→assemble→loadCoreMechanics 装载成功
   （prefab 已有全 internal 归属，断言 defs 含 prefab 且装载 ok）。这闭合隐患 5。
4. 不改 compile.ts / types.ts / load.ts / codec。

独占写权：src/play/playpack-compiler/assemble.ts、src/play/playpack-compiler/__tests__/assemble.test.ts、
src/play/playpack-compiler/__tests__/ownership-derivation.test.ts（新增）。
只读参考：src/play/types/numeric-classification.ts、src/play/core-mechanics/ownership.ts、
src/play/core-mechanics/load.ts、src/play/__tests__/ugc-load-chain.test.ts。
禁止：改 compile.ts / types.ts / index.ts / load.ts / playpack-codec.ts；新增依赖；改 package.json/tsconfig。
门禁：npx tsc --noEmit + npx vitest run src/play/playpack-compiler/__tests__ + npm run lint（你改文件 0 error）。
收尾：报告交付物、测试数、门禁结果、自主判断。
```

### Prompt P2 —— compile 识别 playpack.json 完整规则清单

```
你是 WakeUp 项目装载等价收尾 P2。目标：让 uploaded/llm 玩法包 zip 能携带完整 playpack.json 清单
（含 defs/rules/schedule/actions），消除「改规则和逻辑的玩法包进不了上传链」隐患。

背景：src/play/playpack-compiler/compile.ts 只把文档分类为 profile（items/npcs/statuses/vehicles/weapons）
或 map（schemaVersion+nodes+edges）；playpack.json 会落入 UNKNOWN_DOCUMENT_TYPE 被丢弃。
引擎已有严格解码链：StrictJsonCodec（src/core/kernel/spec-compiler/json-codec.ts）→ decodePlaypack
（src/core/kernel/schedule/playpack-codec.ts）→ PlaypackDef。

交付物（一次性完成，不做 MVP）：
1. compile.ts：识别包根下的 playpack 清单（文件名匹配 playpack.json / manifest.json，或顶层含
   kind:'playpack' 的文档）：
   - 用 StrictJsonCodec + decodePlaypack 严格解码校验（失败产 PLAYPACK_JSON_PARSE_ERROR /
     E_LOAD_* 诊断，error 即拒）；
   - 允许并集：playpack 清单 defs + profiles + maps 可同包共存；
   - 与既有高级判定/两态辨形/deliveryForm 语义兼容（带 playpack 清单不影响 map 判定）；
   - 复杂度评分 customRuleCount 从 playpack 清单 defs 里的 rule/action 数取值（现硬编码 0）。
2. types.ts：CompiledPlaypack 增加向后兼容可选字段（如 readonly playpackDef?: PlaypackDef，
   由 decodePlaypack 产物填充）；不破坏既有字段与既有测试。
3. 测试（src/play/playpack-compiler/__tests__/）：合法 playpack.json 清单被识别且 decode 通过、
   artifact.playpackDef 非空；非法清单（坏引用/重复 id）产生 error 诊断且编译拒绝；
   与 profiles 共存的并集样本。
4. 只做识别+校验+产物字段；**不做** assemble 合并（合并归 Batch 2 P5，避免本批文件撞车）。

独占写权：src/play/playpack-compiler/compile.ts、types.ts、index.ts（如需导出）、
src/play/playpack-compiler/__tests__/playpack-manifest.test.ts（新增）。
只读参考：src/core/kernel/schedule/playpack-codec.ts、playpack.ts、
src/play/playpack-compiler/{compile,types}.ts 现有实现。
禁止：改 assemble.ts / load.ts / playpack-codec.ts；新增依赖；改 package.json/tsconfig。
门禁：npx tsc --noEmit + npx vitest run src/play/playpack-compiler/__tests__ + npm run lint（你改文件 0 error）。
收尾：报告交付物、测试数、门禁结果、自主判断。
```

### Prompt P3 —— 装载驱动 ctxForActor 透传 bindings

```
你是 WakeUp 项目装载等价收尾 P3。目标：修掉装载驱动的查询盲区——带目标动作（attack/move）在
queryActions 里不可见，导致投影等价断言失真。

背景：src/play/core-mechanics/__tests__/state-machine-load-driver.ts 的 ctxForActor 用单参 cast
（(actor) => harness.ctxForSelf(actor)）丢弃 ActionCatalog 展开的 target/node bindings；
src/play/core-mechanics/__tests__/load-injected-pack.test.ts 同款。B1 的
load-equivalence.e2e.test.ts 已按透传方式实现（见其交接项）。

交付物（一次性完成，不做 MVP）：
1. state-machine-load-driver.ts：ctxForActor 改为双参透传（actor, bindings）→ ctxForSelf(actor,
   bindings)；删除 cast，保持类型正确。
2. load-injected-pack.test.ts：同款修复；并在其注入包测试里补断言——带目标动作（move/attack）出现在
   queryActions 可见集（有 queryActions 时）。
3. load-equivalence.e2e.test.ts：投影等价断言升级——官方与 fixture 的**带目标动作**也逐项可见且
   cost 一致（不再只有 sleep-down）。
4. 跑通全部相关测试（含 m10-state-machine-consumption.test.ts 与 ugc-load-chain.test.ts 回归）。

独占写权：src/play/core-mechanics/__tests__/state-machine-load-driver.ts、
load-injected-pack.test.ts、load-equivalence.e2e.test.ts。
只读参考：src/core/kernel/actions/catalog.ts（ctxForActor 语义）、src/core/kernel/testing/full-harness.ts。
禁止：改 load.ts / defs/*.ts / playpack-compiler/**；新增依赖；改 package.json/tsconfig。
门禁：npx tsc --noEmit + npx vitest run src/play/core-mechanics/__tests__ src/play/__tests__/ugc-load-chain.test.ts src/core/kernel/ai/__tests__/m10-state-machine-consumption.test.ts + npm run lint。
收尾：报告交付物、测试数、门禁结果、自主判断。
```

### Prompt P4 —— 规则挂载统一走 playpack.rules

```
你是 WakeUp 项目装载等价收尾 P4。目标：消除官方包与注入包规则挂载的双路径分叉，契约锁定
「非官方 TS 注入包与 JSON 注入包行为一致」。

背景：src/play/core-mechanics/load.ts 的 Step 4 按 playpack === CoreMechanicsPlaypack 分支——
官方包规则来自 CORE_MECHANICS_RULES 常量数组（defs/playpack.ts 导出），注入包规则来自 playpack.rules
引用解析（与 PlaypackActivator.mountPermanentRules 同语义）。官方包自身不声明 rules 字段。

交付物（一次性完成，不做 MVP）：
1. defs/playpack.ts：给 CoreMechanicsPlaypack 增加显式 rules 字段（列出 CORE_MECHANICS_RULES 全部 id，
   即常驻规则集合的声明式表达；CORE_MECHANICS_RULES 保留导出供向后兼容引用）。
2. load.ts：Step 4 统一改为从 playpack.rules 解析挂载（官方与注入同一路径）；删除
   playpack === CoreMechanicsPlaypack 分支；保持默认路径（不传 playpack）行为与现有测试逐字节一致。
3. 测试（新增 src/play/core-mechanics/__tests__/rule-mount-contract.test.ts）：① 官方默认路径规则
   挂载集合与改造前一致（allRuleIds 快照）；② 一个**非官方 TS 构造**注入包（非 CoreMechanicsPlaypack，
   带显式 rules 引用）挂载其规则全集；③ 同一规则集分别用 TS 构造与 JSON 反序列化注入，挂载结果一致；
   ④ 规则引用失效 → E_LOAD_UNDEFINED_REF 原子拒绝。
4. 不改 playpack-codec / playpack-compiler / ai-runtime。

独占写权：src/play/core-mechanics/load.ts、defs/playpack.ts、
src/play/core-mechanics/__tests__/rule-mount-contract.test.ts（新增）。
只读参考：defs/ids.ts（规则 id）、src/core/kernel/schedule/playpack-runtime.ts（mountPermanentRules）。
禁止：改 playpack-codec.ts / playpack-compiler/** / ai-runtime.ts；新增依赖；改 package.json/tsconfig。
门禁：npx tsc --noEmit + npx vitest run src/play/core-mechanics/__tests__ + npm run lint（你改文件 0 error）。
收尾：报告交付物、测试数、门禁结果、自主判断。
```

---

## Batch 2（2 会话并行，依赖 Batch 1 全部提交后启动）

### Prompt P5 —— assemble 合并 playpack 清单 + 全链路 e2e

```
你是 WakeUp 项目装载等价收尾 P5（依赖 P1/P2 已提交：assemble 已有数值归属自动派生、compile 已识别
playpack.json 清单并产出 artifact.playpackDef）。目标：完整规则玩法包走真实上传链端到端装载。

交付物（一次性完成，不做 MVP）：
1. assemble.ts：compileToPlaypackDef 合并 compiled.playpackDef——其 defs（动作/规则/调度/附着/结局）
   并入装配产物 defs；清单自身已是 PlaypackDef，装配时以它为基（id/version/schedule/pools/outcomes/
   entry/rules/hookOrder 取自清单），profiles/maps 展开的 defs 追加进其 defs 数组；清单 defs 缺 play
   扩展时按 P1 同款登记表自动派生（P1 已提供可复用路径）。
2. 端到端测试（新增 src/play/__tests__/ugc-full-rule-chain.test.ts）：一个 uploaded 包，zip 含
   playpack.json（完整规则：1 个付费动作 + 1 条规则 + 1 个调度，携带/不携带 play 元数据两种样本）+
   weapons profile + 可选地图，断言：compile ok → assemble 产出 PlaypackDef（清单 defs + profile defs
   并集）→ loadCoreMechanics 装载成功 → 清单动作可经 intent.submit 提交、规则挂进 ruleProvider →
   与官方同 key 的清单动作后装覆盖官方版。
3. 不改 load.ts / codec。

独占写权：src/play/playpack-compiler/assemble.ts、src/play/__tests__/ugc-full-rule-chain.test.ts、
src/play/__tests__/fixtures/（如需）。
只读参考：P1/P2 交付物、src/play/__tests__/ugc-load-chain.test.ts。
禁止：改 compile.ts / types.ts / load.ts / playpack-codec.ts；新增依赖；改 package.json/tsconfig。
门禁：npx tsc --noEmit + npx vitest run src/play/__tests__/ugc-full-rule-chain.test.ts + npm run lint。
收尾：报告交付物、测试数、门禁结果、自主判断。
```

### Prompt P6 —— CEME 线语义收尾确认（只读代码，只写文档）

```
你是 WakeUp 项目装载等价收尾 P6（CEME 线收尾确认）。目标：确认 730fb41 原样收入的 CEME 工作树产物
与 .kiro/specs/wakeup-core-mechanics-exhaustive 对齐，并更新缺口登记与主状态板。**禁止改任何 src/** 生产代码。**

背景：commit 730fb41 为保 HEAD 一致性原样收容了 CEME 线工作树产物（match-lifecycle.ts / defs/outcomes.ts /
defs/rules.match.ts / defs 四文件过载三段式+终局+回合回绕+出生装配 / state-machine.e2e 与 m10 消费测试升级），
未做语义审查。CEME spec 在 .kiro/specs/wakeup-core-mechanics-exhaustive/{requirements,design,tasks}.md。

交付物（一次性完成，不做 MVP）：
1. 逐项核对已收容代码与 CEME spec：C-1（outcomes 非空）/ C-2（玩家资格）/ C-3（量级边界 loop）/
   C-4（出生规则）/ C-5（胜负结算）/ C-7（过载收束）在代码中的实现与 spec 要求是否一致；tasks.md
   未勾选项是否与代码现实脱节（参照主状态板"复选框不可信"纪律，以测试+代码为真相源）。
2. 更新登记：src/play/core-mechanics/defs/ids.ts 或相关文件里的 OVERLOAD_GAP / PLAYER_QUEUE_GAP 注释
   若与代码现实不符，登记到交接报告（不改代码）；docs/00_主状态板.md 补 CEME 收尾状态行。
3. 产出交接报告 docs/L_审查报告/CEME_收尾确认.md：逐项结论（✅一致 / ⚠️差异+归属）、建议交接项。
4. 全量门禁复跑确认 730fb41 后仓库绿：npx tsc --noEmit + npx vitest run + npm run lint + verify:docs + verify:data。

独占写权：docs/L_审查报告/CEME_收尾确认.md（新增）、docs/00_主状态板.md（仅补一行状态）。
只读：.kiro/specs/wakeup-core-mechanics-exhaustive/**、src/play/core-mechanics/**、src/core/kernel/ai/__tests__/**。
禁止：改任何 src/** 生产文件；改 package.json/tsconfig；新增依赖。
门禁：npx tsc --noEmit + npx vitest run + npm run lint + npm run verify:docs + npm run verify:data。
收尾：报告逐项核对结论、差异清单、门禁结果。
```

---

## 批次后主控收尾（我执行）

- 全量三命令 + verify 复跑；HEAD 一致性抽查（git show HEAD 引用未跟踪模块扫描）。
- 主状态板入账（P1–P6 完成行）；交接项清单更新；按需 commit。

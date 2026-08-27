# 需求：wakeup-base-layer-bombardment（基类层收官的终极属性与压力测试、引擎层引用一致性检测）

## 简介

本项目是对**基类层（`src/class/**` 目录数据 + `src/class/*.ts` 契约护栏 + `src/l2/model/**` 规范模型 + `src/l2/validation/**` 验证规则 + `src/l2/adapters/**` 对基类层的运行时投影/提交 + 装载桥 `catalog-activation`/`scene-catalog-activation`）**的收官终极验证。在前序对账（`wakeup-engine-layer` 把引擎层与基类层语义对齐回完备、`wakeup-engine-bombardment` 把引擎层白盒封顶轰炸）之后，对基类层做最后一轮全面轰炸：**一层一层往上测**，每层（JSON 装载 → JSON 契约护栏 → 规范模型解析 → 验证规则 → 运行时投影/提交 → 装载桥原子激活 → 跨层贯通）做高强度属性覆盖 + 全量脏输入对抗 + **对引擎层/上层引用不正确、对接失败、理解错误**的机械检测。

目标是**把这整个基类层彻查干净**：所有属性测试与脏输入用例全部通过，或对任何被刨出的真实问题按宪法（文档即权威、解耦优先、机制不自相矛盾）做**完备而整体的解决方案**，绝不做填漏洞式的逐点打补丁。

实现语言 TypeScript，测试库 fast-check（PBT 均 ≥100 次生成，高价值压力面 500 次）。所有正确性属性严格带 `Feature: wakeup-base-layer-bombardment, Property N` 注释。

**关键前提**：本规格是**测试/验收规格**，不是功能规格。它不引入任何新玩法机制、不改任何玩家可见数值（守 1-5 铁律 + AP 铁律 + 单动作原则）、不发明未裁决的机制（Q-04 载器承载面、`VEHICLE_PARAMETER_BINDING_GAP`、`registerMapAnchor` 接入）。它的交付物是「一整轮可复现、可回溯、覆盖基类层全部组成 + 引擎层引用一致性 + 跨层贯通、脏输入全量对抗」的测试证据链 + 对任何被刨出的真实问题的完备修复 + 交接项登记。

## 术语表

- **基类层（L2）**：`src/class/**`（目录数据 `index.json` + 契约护栏 `.ts`）+ `src/l2/**`（规范模型/验证/适配/装载桥）中属于基类层语义约束的部分。本规格把「基类层」定义为一次原子装载、可被玩法层/UGC 作为组合基底消费的语义类型库。
- **引擎层（L1）**：`src/core/kernel/**`，提供无语义原语（Def/Op/Expr/Hook/事务/拓扑/容器/载器/安全/编解码）。引擎层已在 `wakeup-engine-bombardment` 白盒封顶。
- **装载桥（activation bridge）**：`src/class/catalog-activation.ts`/`scene-catalog-activation.ts`——把统一形状目录经 spec-compiler `compileAndActivate` 原子激活/回滚。自述只覆盖 8 个统一形状目录。
- **目录（catalog）**：`src/class/*/index.json` 各家族的语义声明（classes/capabilities/compositionContract/structuralBounds/prohibitions/valueSets…）。
- **JSON 契约护栏（contract guards）**：`src/class/class-contract.ts`/`json-contract.ts` 的 `parseClassCatalog`/`expect*`/`assert*`/`find*`——契约解析与语义守卫。
- **脏输入（garbage）**：畸形参数（`undefined`/`null`/`{}`/`[]`/`0`/`''`/`true`/错 id/缺字段/循环引用/巨型/超深嵌套/`JSON.parse` 前的畸形字节/重复 JSON 键/非字符串 op 名…）。
- **狂轰滥炸（bombard）**：以随机生成大量输入反复冲击系统，追求刨出深层不自洽。
- **引用一致性（reference consistency）**：基类层声明引用的 Op 名（`kernelOps`）在引擎 `OpRegistry.listOpNames()` 真实存在；声明的 class/capability/component/structural-bound id 在目录内自我闭合（无悬空引用）。契约要机器可断言，不靠注释（D-073/架构决策「契约要机器可校验」）。
- **PBT**：Property-Based Testing，基于属性的测试。
- **EARS / INCOSE**：需求句式模式 / 需求质量规则。
- **P1–P13**：基类层验证管线（`src/l2/**`）既有的 14 个具名性质（`test/l2/properties`）——本规格在其之上做**独立于既有管线**的目录/对接面性质延伸（D-4），不重造既有已绿性质。
- **宪法**：`docs/L0_规范宪法.md`，唯一权威锚点。

## 原则

1. **白盒已封顶，本轮轰炸只测不改机制语义**：引擎层语义已冻结；基类层语义（统一形状 vs 族特有目录、`kernelOps` 契约、compositionContract、EC 收敛方向）维持既定状态。本轮只做验证与完备修复，不重开已裁决机制。
2. **守卫宪法铁律**：新增测试不得让任何玩家可见数值越出 1-5；不得出现"加 AP / 非 1 AP 原子动作"；**不改 `src/core/kernel/**` 的玩法语义**；不发明未决机制。
3. **引用一致性问题按整体方案修复，不做补洞**：若发现 `kernelOps` 引用了引擎层不存在的 Op、目录声明缺字段、装载桥与解析器行为不一致，按宪法/解耦优先原则做**整体**方案（如：把"Op 已注册"从注释升格为机器断言、把统一形状目录解析器与装载桥的切片边界对齐），而非在每个调用点打补丁。
4. **完备性即交付物**：要求→设计→任务严格顺序；每条可测要求被恰好一个属性覆盖；每属性被恰好一个 PBT 实现；每任务回溯到要求子句。收尾跑三命令门禁 + `verify:data` + `verify:docs`。
5. **可信测试证据**：每个属性测试必须用真实基类层/引擎层模块（直接 import 生产代码，或 `createFullHarness` 真实接线 + 真实 `OpRegistry.listOpNames()`），不用 mock 假实现；反例分类后如实记录。
6. **按层逐层往上测**：装载层 → 契约护栏 → 规范模型解析 → 验证规则 → 运行时投影/提交 → 装载桥原子激活 → 跨层贯通/引用一致性，一层一层推进，每层独立绿后再进入下一层。

## 要求

### 要求 1：JSON 装载层属性与脏输入轰炸

**用户故事：** 作为基类维护者，我希望目录 JSON 装载（`catalog-loader`/`parseClassCatalog`）在任意畸形 JSON、重复键、类型错位、缺失字段下**按契约安全解析**，以便任何违反数据契约的输入在装载阶段被有结构的错误拦下，绝不静默吞掉。

#### 验收标准

1. [Unwanted-event] IF 一份候选 JSON 在 `JSON.parse` 前是畸形字节（截断、尾随垃圾、非法转义、过大/过深文档），THEN 装载失败 SHALL 返回带实例化位置的已分类错误，且绝不使宿主进程抛未捕获异常。
2. [Unwanted-event] IF 一份 JSON 含重复对象键（如 `{"version":"1","version":"2"}`），THEN 硬装载路径 SHALL 将其作为违例拒绝（不被普通 `JSON.parse` 的后者覆盖语义吞掉）。
3. [Unwanted-event] IF 一个目录字段类型错位（应是字符串却给数字、应是数组却给对象、`kernelOps` 含非字符串），THEN 契约护栏 SHALL 报告含 JSON 路径的违例，而非 silently 转换。
4. [Ubiquitous] THE 装载对**全量真实目录**（`src/class/**/index.json` + 各 `*.json`）SHALL 通过而不改任何字节；此用例作为「目录与解析器一致」的守卫。
5. [Unwanted-event] IF 目录里的某个 not-mutate 组件或只读投影声明了写 Op 名，THEN 贯通守卫的跨目录写通道扫描 SHALL 将其作为待裁决边界暴露，SHALL NOT 静默纳入已注册写件（写只经 `OpRegistry.invoke` 唯一通道）。

### 要求 2：契约护栏的引用闭合属性轰炸

**用户故事：** 作为基类维护者，我希望 `parseClassCatalog` 对任意注入的 class/capability/component/structural-bound 悬空引用与 id 碰撞给出确定性拒绝，以便任何"声明了却解析不到"的引用永不进入运行态。

#### 验收标准

1. [Unwanted-event] IF 一个 class 声明引用了一个未声明的 capability id / component id / structural-bound id，THEN 护栏 SHALL 报 `REF_*` 系违例并做确定性拒绝。
2. [Unwanted-event] IF 两个 class 或 class↔capability 共享同一 id，THEN 护栏 SHALL 拒绝（防伪子类型/重复声明）。
3. [Ubiquitous] THE 拒绝结果 SHALL 是确定性的：同一注入目录反复解析，违例集合与顺序逐位相同。
4. [Event-driven] WHEN 注入的是**循环引用**（class↔capability 双向环、目录引用自身），THEN 护栏 SHALL 在有限步内拒绝或安全终止，不发生死循环或栈溢出。

### 要求 3：规范模型解析层的属性一致性

**用户故事：** 作为规范模型消费者，我希望 `src/l2/model/**`（family-contracts/space-items-contracts/space-items-structural-bounds/composition-registry/composition-shapes）对目录声明的解析与 `src/class` 契约护栏的解析结果一致，以便两类解析器不会出现"一个接受一个拒绝"的分裂。

#### 验收标准

1. [Ubiquitous] THE L2 规范模型解析器与 class 契约护栏，SHALL 对**同一真实目录输入**给出兼容的接受/拒绝结论（接受集的并集为空、拒绝原因同族）。
2. [Unwanted-event] IF 目录含 `compositionKind` 非法值、`kernelOps` 形状非法、structural-bound 越界数值，THEN L2 验证层 SHALL 报告 `SYSTEM_BINDING_*`/`COMPOSITION_KIND_*`/数值分类系违例。
3. [Ubiquitous] THE `composition-registry` 组件登记的 `component.*` id SHALL 在既有族契约指纹上保留等价性（`resolveComponent` 对未登记 id 返回 null，不抛异常）。

### 要求 4：`kernelOps` 引用引擎层 Op 的机械一致性（引用错误核心检测）

**用户故事：** 作为对接层校验者，我希望声明于基类层目录的每个 `kernelOps` Op 名，在解析期就与真实 `OpRegistry.listOpNames()` 机械比对，以便任何"引用了引擎层不存在的 Op"的目录在装载期被拦下，而不是靠注释承诺（D-073 / 架构决策「契约要机器可校验」要求的两处既有 TODO 见 `space-items-write-channel-rules.ts` 与 `composition-alignment-rules.ts`）。

#### 验收标准

1. [Unwanted-event] IF 目录的 `kernelOps`（或 `operationChannels`）含一个引擎层 `OpRegistry.listOpNames()` 不存在的 Op 名，THEN 该目录的装载 SHALL 以结构化拒绝或已分类诊断拒绝，绝不静默接受。
2. [Ubiquitous] THE 真实 `OpRegistry` 全量 `listOpNames()`（经 `createFullHarness` 或真实 registry）SHALL 被作为 Op 存在性权威来源，而非硬编码清单。
3. [Ubiquitous] THE 声明的 `kernelOps` 与统一形状目录数据的可闭合集合 SHALL 满足 Op 名只指向已注册 Op；真实目录的每个 `kernelOps` 项 SHALL 通过机器比对。
4. [Event-driven] WHEN 一个 Op 名只是命名规范合法但未注册，THEN 该违例诊断的严重级别 SHALL 与"引用未声明 capability"同级（都阻止装载）。

### 要求 5：装载桥（activation bridge）原子激活属性轰炸

**用户故事：** 作为基类装载者，我希望 `catalog-activation`/`scene-catalog-activation` 对任意注入的目录（含多目录合并、跨目录组合引用）经真实 `compileAndActivate` 原子激活，以便任何失败都不污染已激活的既有定义。

#### 验收标准

1. [Unwanted-event] IF 一组目录中任一项违反契约，THEN `compileAndActivate` SHALL 失败且**已激活的定义集合与激活前逐位相同（原子回滚）**。
2. [Ubiquitous] THE 真实目录经装载桥激活 SHALL 成功并产出可被 `SpecificationCompiler` 解析的候选文档。
3. [Event-driven] WHEN 跨目录一个 class 引用另一个目录的能力，THEN 单次合并激活 SHALL 完整解析该组合引用，无悬浮引用。
4. [Unwanted-event] IF 装载桥切片边界之外的字段被注入违例（structuralBounds 数值归属、值集合、玩法层参数绑定），THEN 装载桥 SHALL 按既有的显式切片边界处理或拒绝，不看做本批次 Must-fix（回归为已知边界）。

### 要求 6：运行时投影/提交（D-1/D-2 相关）的引用一致性

**用户故事：** 作为运行时消费方，我希望 `src/l2/adapters/**`（ai/ui/space-items）对目录定义到 L1 运行时语义的转换，只经 `KernelContract.invoke` 唯一写通道且只写类型合法上下文，以便转换层不越过契约边界。

#### 验收标准

1. [Ubiquitous] THE space-items adapter 的 `vehicleToRuntimeConfig`/`containerToRuntimeConfig` 转换 SHALL 输出的运行时配置的字段集与分类与 L1 运行时契约兼容，且对未接线的 `category:'carrier'` 面不做载体推导（回归为 Q-04 待裁决边界）。
2. [Ubiquitous] THE 所有适配器发出的写操作 SHALL 只经 `KernelContract.invoke`（或 L1 允许的写通道），SHALL NOT 直接 mutate 运行态。
3. [Unwanted-event] IF 一个运行态投影请求指向未激活/未解析的定义 id，THEN 适配器 SHALL 返回可判定的拒绝/空投影，不抛未捕获异常。
### 要求 7：跨层贯通与引用一致性守卫（回归锁）

**用户故事：** 作为基类维护者，我希望一条覆盖"装载 → 契约护栏 → 规范模型 → 验证 → 投影 → 激活"的贯通测试在每次 `npm run verify` 跑通，以便任何一层改动若破坏引用一致性就在门禁被拦。

#### 验收标准

1. [Event-driven] WHEN `npm run verify:data` 通过，THEN 全部真实目录 SHALL 已通过 JSON 可解析 + 契约护栏可接受 + `kernelOps` 机械一致性三关。
2. [Ubiquitous] THE 贯通测试 SHALL 输出「目录层 × Op 层 × 契约层」三方对齐报告，如实标出已知切片边界与待裁决项，不视为失败。

### 要求 8：规格完备性自证

**用户故事：** 作为规格审查者，我希望这条元规格本身具备 EARS/INCOSE 合规、可测性分析与要求双向回溯，以便证明完备性而非只交付代码。

#### 验收标准

1. [Ubiquitous] EVERY 验收标准 SHALL 遵循六种 EARS 模式之一且符合 INCOSE 质量规则（主动语态、无模糊术语、单想法、无免责条款）。
2. [Ubiquitous] EVERY 可测验收标准 SHALL 被 design.md 恰好一个正确性属性覆盖。
3. [Ubiquitous] EVERY 正确性属性 SHALL 被恰好一个 PBT 测试实现，tagged `Feature: wakeup-base-layer-bombardment, Property N`，迭代 ≥100（压力面 ≥500）。
4. [Ubiquitous] EVERY 实现任务 SHALL 引用其满足的要求子句。

_要求 1-7 为通关/守卫需求（本轮轰炸内容），要求 8 为规格自身的完备性元需求。编号连续、每表含 EARS 模式标注。_

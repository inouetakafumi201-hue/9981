# Requirements Document

## Introduction

本文档定义 WakeUp **基类层的 ECS 收敛**规范。基类层（L2）位于引擎层（L1）与玩法层（L3）之间，把 L1 的无语义原语约束成可复用的语义类型与组合规则。本规范以 **ECS（Entity-Component-System）** 为宗旨对基类层做结构收敛，属**收束专项**：不新增玩法内容，只把既有基类层交付物（`src/l2/**`、`src/class/*/index.json`）收拢到 ECS 形状，并让散乱点可通过机器守卫验证。

**为何是收束专项：** 引擎层已在 `docs/L1_引擎层/05_底层引擎架构.md` 与 `docs/L0_规范宪法.md` 自证为标准 ECS——Entity = ID + 组件列表，组件挂结构化状态，Op/Hook 读组件。基类层的 ECS 定位由此反推：**基类层 = 可复用的语义组件类型库 + 每类组件的 System 接线契约**。当前基类层的散乱，本质是与这一定位的不对称：

1. **家族契约集中在单文件**。`src/l2/model/family-contracts.ts` 单一文件承载 13 个语义族的契约接口；对比之下空间域已拆出 `space-items-contracts.ts` 等一整套领域文件。同一种职责，两种格局。
2. **有能力、有 Op、无两者之间的接线契约**。每个 `capability` 声明 `parameters` 与 `kernelOps`（`src/class/*/index.json`），但 `kernelOps` 只是 `'prop.set'` 这类字符串字面量，没有一处机器断言它引用了真实存在的 Op、也没有一处断言"该能力只由这些 System 读写"。
3. **vehicle 占用了不属于它的基类层身份**。`src/class/vehicles/index.json` 里 `vehicle.class.land` 声明 `defKind:"entity"`、`abstract:true`；但在引擎中 Entity 是 ID + 组件的容器（`src/core/kernel/state/entity.ts`），一个容器自身不可能是实体子类的基类。vehicle 实际是"组件组合的结果"，应取消其 entity 基类资格，降级为**由一组标准组件拼装的组合型组件族**。
4. **一族 = 一个 namespaced 结构，而非一组组件类型**。部分家族目录以 `semanticFamilies` 为中心组织，`capabilities`（最接近 ECS "组件"的部分）未被单独视为可复用、可跨族去重的契约。

收敛深度与数值归属是**两条正交的轴**：本规范只把语义结构做深（组件拆分、能力细化为原子 System 接线），**具体数值仍由玩法层（L3）/ UGC 提供**。素材管理、实例化归玩法层，不改变"组件只出声明、值由玩法层填"的边界。因此收敛深度可以在组件层做深，而数值天然留在玩法层，两者不冲突。

本规范的约定与既有规范一致（见 Glossary 末尾"既有规范映射"）：引擎层机制归 L1；具体数值、具名实例与玩法规则归 L3；历史示例与待定项不得自动成为 L2 默认。与 `l2-base-layer-spec` 的关系是：该规范定义基类层应实现哪些语义契约的**内容**，本规范约束这些契约在结构上如何**收敛到 ECS 形状**；本规范不重复定义具体族契约字段（如武器必须有 `range_profile`），只定义族契约的**结构规则**（一个族 = 若干以 `component.*` 开头的能力组件，每个组件携带原子 System 接线）。

## Glossary

- **WakeUp_System**：由 L1、L2 和 L3 组成的 WakeUp 整体系统。
- **引擎层（L1）**：提供 `Def`、`Entity`、`Item`、`Node`、`Link`、`Attachment`、`Op`、`Expr`、`Hook`、事务、查询、持久化和诊断等无具体玩法语义原语的层级。
- **基类层（L2）**：把 L1 原语约束为可复用语义类型、组合规则和参数 Schema 的层级。
- **玩法层（L3）**：组合 L2 实例、填写玩法数值、定义具体玩法的层级。
- **UGC**：由创作者（含自然语言解析）提交基类层可复用组合、由玩法层提供数值的外部内容。
- **ECS（Entity-Component-System）**：实体 = ID + 组件列表，一切能力由组件提供，系统（Op/Hook）读写组件的软件架构。引擎层以 ECS 为基底；本规范把基类层定义为其上的**语义组件类型库**。
- **组件（Component）**：ECS 中携带结构化状态的最小复用单元。基类层中以「能力」（capability）形式表达，ID 以 `component.*` 前缀命名。
- **原语组件**：只携带可配置字段与原子 System 接线、不含其他组件解引用的最小能力组件（例如 `vehicle.capability.seat_binding`）。
- **组合型组件族**：由若干原语组件拼装形成、位于基类层语义栈靠上位置的能力集合（例如载具族）。组合型组件族不声明自己是实体（Entity）的基类。
- **能力（Capability）**：基类层目录中声明的可组合接口；本规范将其升格为 ECS 组件契约载体。
- **System**：读写组件数据的执行单元；引擎层落点为 Op 与 Hook 链。本规范的「System 接线」指一个能力声明它由哪些 `kernelOps`（System）读写。
- **System 接线审查（compositionKind）**：能力上对「只读 / 读后写 / 创建自属注册」三种情况的显式声明；不携计数器的原语能力要求声明 `read-only-scan | read-write`，容器族要求声明 `container-owned-registration`。
- **CaS 缝隙（component-slot gap）**：组件的可配置字段名与对应 System 参数名同指一个取值、却无机器校验落到同一通路的现象。闭合该缝隙是 `compositionKind` 存在的动机之一。
- **继承（Inheritance）**：通过 `extends` 表达类型身份与契约细化的关系；在 ECS 收敛中仅用于「组合型组件族由哪些组件拼装」这一职责，不再让具体语义族类间接获得实体子类身份。
- **嵌套（Composition）**：通过引用、附件、能力、容器、槽位或参数对象表达配置的关系。
- **类型身份（Type_Identity）**：决定定义可执行契约、合法关系、必需能力或替换兼容性的本质语义。
- **语义族**：一组共享契约形状、可有限列举、可组合、与具体玩法无关的能力集合。
- **玩法数值（Gameplay_Value）**：伤害、成本、阈值、持续时间、容量等具体取值；归 L3 / UGC。
- **结构边界（Structural_Bound）**：用于保证类型结构、认知上限或引擎不变量的规范限制。
- **Constitutional_Constant**：由 L0 固定并带来源编号、归属和适用字段的约束。
- **Diagnostic**：含稳定代码、严重级别、定义标识符、JSON 路径、来源定位、原因和修正建议的验证结果。
- **Error_Diagnostic**：阻止候选定义生效的诊断。
- **Warning_Diagnostic**：不改变语义且不阻止装载的提示诊断。
- **Structured_Rejection**：含 Error_Diagnostic、明确表示候选变更未生效的拒绝结果。
- **Semantic_Field**：影响类型、规则、参数、引用或运行结果的字段。
- **Presentation_Field**：只影响名称、图标、纹理、动画或辅助文本且不改变规则结果的字段。
- **Composition_Registry**：以 `component.*` 前缀声明、供类与组合模板去重复用的组件集中登记表（`src/l2/model/composition-registry.ts`）。
- **Composition_Shape**：语义族对原语组件形状的既定声明（`compositionShape.*` 族级字段），由族契约持有者维护，供验证器核对。
- **Type_Identity_Basis**：类型身份的判定依据，含 required-capability、legal-relationship、invariant、substitution-compatibility。

**既有规范映射**：本规范引用的既有权威文件与术语包括 `docs/L0_规范宪法.md`（宪法、L1/L2/L3 三种层名、含 `Structural_Bound`/`Constitutional_Constant` 的数值分类且 1-5 覆盖玩家可见数值、`Type_Identity`）、`docs/访谈决策记录.md`（记录 D-0xx 交互分离等裁决）、`docs/_术语表与废案清单.md`、`docs/L1_引擎层/05_底层引擎架构.md`（ECS 基底与 Node/Item 为置于 ECS 之上的两类结构化数据）、`docs/L1_引擎层/引擎层职责边界.md`（引擎层只提供无语义原语）、`docs/L2_基类层/基类层定义.md`（继承决定类型、嵌套决定配置）、`src/l2/**` 与 `src/class/**`（被收拢的既有交付物）、`l2-base-layer-spec` 与 `wakeup-space-items` 规范（被引用与被对照的既有规范）。

## Requirements

### Requirement 1: 单一权威的组件契约状态

**User Story:** 作为基类维护者，我希望家族与领域契约由同一套组件契约状态驱动，以便各方从同一份定义取用、避免类与能力口径分裂。

#### 验收标准

1. WHEN 一个新语义族被登记，THEN Base_Layer_Spec SHALL 要求该族的契约接口（`action`、容器、`container`、`damage`、`movement`、`vehicle`、`status`、`attachment`、`skill` 等）与组合模板定义从「类 + 能力」单一源展开，并与既有 `family-contracts.ts` 保留单一权威的状态一致。
2. THE Composition_Registry SHALL 以 `component.*` 前缀集中登记组件，供语义族的类与组合模板以 id 引用并去重。
3. IF 经转换的目录被持久化或快照，THEN WakeUp_System SHALL 产出与经过转换前的语义等价的 Canonical_Snapshot，其中类 id、能力 id、组件 id 与模板 id 的顺序确定性一致。
4. IF Canonical_Snapshot 出现可忽略次序的偏移，THEN WakeUp_System SHALL 保持引用语义不变，并依据指定 `ordering.ts` 的规则获得不变快照。
5. IF 候选包在转换后因转换规则调整而出现语义差异，THEN WakeUp_System SHALL 归还最后有效的已激活状态，并返回含 CodeAndReason 的 Structured_Rejection。
6. IF 转换依赖某些 Op 注册域的既有证据，THEN WakeUp_System SHALL 检测到该证据的失效并返回 Structured_Rejection，不得把失效证据当作有效以换取快照差异。
7. WHEN 创建或修订组件 id 与字段名，Base_Layer_Spec SHALL 满足既有继承解析中"继承决定类型"的那条规则，即依赖同 key 后装不拒、类型身份陈述不重复的那条规则。

### Requirement 2: 以组件为核心的家族目录

**User Story:** 作为内容工具开发者，我希望家族目录以组件为中心组织、而非以族为中心，以便每个能力都可跨族复用与去重。

#### 验收标准

1. THE Base_Layer_Spec SHALL 让每个语义族的目录以 `capabilities`（升格为组件）作为组织核心。
2. WHEN 两个不同族声明相同能力的可配置字段，THE Base_Layer_Spec SHALL 提取共享的 `component.*` 组件并使其只定义一次，供两族复用。
3. THE Base_Layer_Spec SHALL 允许语义族声明未落为顶层实体类型的逻辑构成（表达为组合模板，不声明 entity 身份）。
4. IF 一个语义族在语义上不可能拥有模板（如特化的 `damage`、`movement` 单组件族），THE Base_Layer_Spec SHALL 不要求它声明组合模板。
5. THE Base_Layer_Spec SHALL 允许被弃用的语义族把留下的能力（尤其是 `damage` 与 `movement`）收敛成组件供其他族引用。
6. IF 一个目录省略了能构成组合模板所需的能力，THE Definition_Registry SHALL 在激活时返回包含 `missing-capability-for-compose` 代码的 Structured_Rejection。

### Requirement 3: 原子 System 接线

**User Story:** 作为架构师，我希望每个能力声明它由哪些 Op/Hook 读写，并让该声明可通过机器守卫对齐，以便能力与真实 System 不脱节。

#### 验收标准

1. THE Base_Layer_Spec SHALL 让每个原子能力声明一组 `kernelOps`，作为其 System 接线。
2. THE Definition_Validator SHALL 校验 `kernelOps` 引用的字段名与 `parameters[*].key` 落在同一通路，闭合组件字段名与 System 参数名的 CaS 缝隙。
3. THE Definition_Validator SHALL 校验每个 `kernelOps` 引用的 Op 是已定义且被许可的（许可集合由 `src/core/kernel` 提供的目录决定）。
4. IF 一个能力声明了超出许可集合的 Op 或未声明 `kernelOps`，THE Definition_Validator SHALL 返回 `SYSTEM_BINDING_*` 系 Structured_Rejection。
5. IF 一个能力携带引用其他组件的 `classReferences`/`containerClassRefs`，THE Reference_Resolver SHALL 校验其目标存在且属于允许的族（在允许的族引用的约束内）。
6. THE Base_Layer_Spec SHALL 在跨 Spec 边界除文档外提供编译期/运行期可断言的契约件（本 spec 引入 `compositionKind`）。
7. IF 一个组件契约对只读与可写未做出区分声明，THE Definition_Validator SHALL 返回 Structured_Rejection，要求显式声明 `compositionKind`。

### Requirement 4: 只读投影与写通道

**User Story:** 作为一个要求通过统一行为与素材在引擎与 UGC 之间安全的开发者，我希望语义状态的写只能走允许的通道，以便只读投影不被改写成语义状态。

#### 验收标准

1. THE Base_Layer_Spec SHALL 禁止从只读语义投影改写语义状态，任何写入只经 L1 允许的写通道（OpRegistry.invoke 等）执行。
2. IF 组件只作计数或查询用途，THEN Base_Layer_Spec SHALL 让只读端（AI/UI 适配器）不需命令确认即可读取，而写入仍只经允许的写通道。
3. THE Base_Layer_Spec SHALL 把静态、无哨兵、只描述形状的原子能力声明为 `static`（形态 1），且只读投影可无障碍读取。
4. THE Base_Layer_Spec SHALL 要求动态或可被 Hook 改写的原子能力声明其写通道（形态 1 转 2 或形态 2 空槽），并接受组件承载项会被改写的语义后果。
5. IF 一个能力在系统写入路径上凭空读取组件承载项、且无本 spec 的 `compositionKind` 允许，THEN Definition_Registry SHALL 在候选变更中允许该能力携带只读声明，且不给该能力添加命令或覆盖语义。

### Requirement 5: Static 四形声明

**User Story:** 作为基类设计者，我希望能力的"承载物在系统运行中是否变化"被显式声明，以便只读端可依赖稳定的槽位、动态端不掩盖承载物的变化。

#### 验收标准

1. THE Base_Layer_Spec SHALL 用 `compositionKind` 声明能力承载物在其生命周期的变化模式，取四形之一：`static`、`transient`、`modified-explicit`、`modified-capability`。
2. THE Definition_Validator SHALL 校验 `compositionKind` 只取上述四形之一，否则返回 `COMPOSITION_KIND_*` 系 Structured_Rejection。
3. IF `compositionKind` 声明为 `static`，THEN WakeUp_System SHALL 让该能力的承载物在激活后不因绑定以外的写入而变化。
4. IF `compositionKind` 声明为 `transient`，THEN WakeUp_System SHALL 允许承载物随系统写入刷新，且该承载物不因单次查询而成为只读投影的稳定语义。
5. IF `compositionKind` 声明为 `modified-explicit`，THEN WakeUp_System SHALL 要求该能力明确列出被改写与未被改写的承载字段。
6. IF `compositionKind` 声明为 `modified-capability`，THEN WakeUp_System SHALL 要求该能力把承载物改写交由另一个声明了对该形态负责的组件。
7. THE Base_Layer_Spec SHALL 要求每个原子能力至少有一个承载支撑模块里的组成内容。

### Requirement 6: 载具为组合型组件族

**User Story:** 作为架构师，我希望载具不再占用基类层实体基类的位置，而是由一组标准组件拼装的组合型组件族，以便基类层不出现"组件封装结果自充基类"的自指。

#### 验收标准

1. THE Base_Layer_Spec SHALL 让载具族（Vehicle_Family）作为由原语组件拼装形成的组合型组件族存在，而不是作为 entity 的基类。
2. THE Base_Layer_Spec SHALL 取消对 `src/class/vehicles/index.json::vehicle.class.land` 的 `defKind:"entity"` 与抽象基类资格，改为表达「由哪些标准组件拼装」的组合模板含义。
3. THE Definition_Validator SHALL 拒绝把 `entityBacked` 当作实体子类身份的依据作基类层顶层类型。
4. THE Base_Layer_Spec SHALL 让载具组件（座位 `seat_binding`、货舱 cargo、驾驶 drive、碰撞 collision、损毁处置 destruction_sequence 等）各自作为原语能力组件组合进载具组合模板。
5. THE Reference_Resolver SHALL 校验载具组合模板引用的每个组件 id 存在且属于允许的能力族。
6. THE Base_Layer_Spec SHALL 保留已确认的交互分离契约（vehicle adjacency 与 door-target 两个独立组合输入）不因本次降级而合并。

### Requirement 7: 家族定稿为组件形状

**User Story:** 作为基类维护者，我希望把既有已确认家族（action、container、damage、movement、status、attachment、skill、shield）定稿为"族契约 + 原语组件形状"的统一形状，以便这些家族既有的契约指纹不因收敛而丢失。

#### 验收标准

1. THE Base_Layer_Spec SHALL 让 action 家族把它的契约字段形状为能力组件（`action.` 族级）。
2. THE Base_Layer_Spec SHALL 让 container 家族把它在 `space-items-contracts.ts` 的 `ContainerDomainContract` 收敛为组件形状，并沿用 D-059 等已确认裁决。
3. THE Base_Layer_Spec SHALL 让 damage 家族把其契约字段形状为能力组件，并把它可能的 `health` 组件承载项标明`modified-explicit`。
4. THE Base_Layer_Spec SHALL 让 movement 家族把其契约字段形状为能力组件，并把可能由动作改写的承载项标明 `modified-explicit`。
5. THE Base_Layer_Spec SHALL 让 status 家族把其契约字段形状为能力组件，并把它对宿主状态的改写在组件声明中显式化。
6. THE Base_Layer_Spec SHALL 让 attachment 家族把其契约字段形状为能力组件，并把它自身的集合组件标记为非语义壳，避免系统读写时混淆。
7. IF 一个家族接受元素子类（damage 或 status 子类），THE Base_Layer_Spec SHALL 让其子类与父类在语义族/能力上给出区别证据或在 `valueSets` 中有 token 级差异化，若仍无区别证据则返回 `PSEUDO_SUBTYPE`（如 `INHERIT_GAMEPLAY_VALUE_ONLY_DIFFERENCE`）拒绝。

### Requirement 8: 多轴正交与映射

**User Story:** 作为玩法设计者，我希望基类层的"语义"与"承载"两轴不被耦合，以便移植一个已有能力组件到新的玩法层结构时，不改变组件的系统语义。

#### 验收标准

1. THE Base_Layer_Spec SHALL 区分「语义轴」（继承与类型身份）与「配直/承载轴」（组件字段与 System 参数位置），并保证组件不依赖某特定 L3 payload 形状。
2. THE Base_Layer_Spec SHALL 允许一个既有能力组件在多处复用时语义保持不变，仅承载位置不同。
3. IF 一个组件为某玩法特化所绑定，THEN Definition_Validator SHALL 返回 `VALUE_L3_OWNERSHIP`（或兼容的既有代码）请求其下沉到玩法层。
4. 对 CaS 缝隙的闭合，THE Base_Layer_Spec 只在字段名引用到同一取值时成立。
5. THE Base_Layer_Spec SHALL 让类与能力卡完整支持 `kernelOps` 引用与 `compositionShape` 族级备选，供非原子形态树用。
6. THE Base_Layer_Spec SHALL 在 `compositionKind` 声明之外，仅用既有 `Type_Identity` 的五种来源作继承关系判据，不另增一套。

### Requirement 9: 目录与诊断门禁

**User Story:** 作为内容工具维护者，我希望目录与诊断遵守既有分级与守卫，以便转换产物真实、可回归且无废用词。

#### 验收标准

1. THE Base_Layer_Spec SHALL 遵守既有 1-5 数值铁律（玩家可见数值局限于 1-5），把内部度量与结构边界除外。
2. IF 转换产生的目录包含废用复合词或未登记的诊断名，THEN 文档纪律守卫 SHALL 拒绝该目录，并明确其所有权与修正路径。
3. THE Base_Layer_Spec SHALL 把转换自身的状态与已裁决的 Q-01 / Q-04 / Q-05 关联，不解决不裁决。
4. THE Definition_Validator SHALL 遵守现有文档纪律守卫所要求的来源追踪采纳状态——对本 spec 必须登记明确状态并与自动发现要求标题一致。
5. IF 一个转换使未标记为 fully-adopted 的既有规范（如 `l2-base-layer-spec`）产生来源 footer 漂移，THEN 该 spec SHALL 保持 `not-adopted` 的既有状态，除非单独裁决采用。
6. THE Base_Layer_Spec SHALL 保留对既有 `family-contracts.ts` 的能力指纹（被 spaces-items 容器载体引用）作为多族可复用的一组初始原子能力的来源。

### Requirement 10: 派生目录的形状与归属

**User Story:** 作为内容工具开发者，我希望派生（转换后）目录拥有明确的组件形状与玩法层归属，以便我可以从既有目录可靠地再生出可复用组件，而不越层。

#### 验收标准

1. THE Base_Layer_Spec SHALL 让派生目录（由 `family-contracts.ts` 的 `FamilyContract` 推断并生成的目录）拥有与既有目录相同的 `CLASS_ENTRY_KEYS` 与 `CAPABILITY_ENTRY_KEYS`，并把组合模板表达为 `compositionContract.classIds` / `compositionContract.capabilityIds`。
2. IF 派生目录是可更新文件，THEN Reference_Resolver SHALL 以既有目录为准核对新生成的字段差异，禁止以派生目录覆盖既有主目录。
3. THE Base_Layer_Spec SHALL 依据玩法层归属的字段名把玩法数值下沉到玩法层结构（玩法层结构归 L3）。
4. THE Base_Layer_Spec SHALL 让既有目录的组件在派生目录中保持既有引用不变；派生目录为既有目录工作流的投喂/回填，仅为既定既有目录之外增加视图，不改变既有既有目录的既有引用。
5. THE Definition_Registry SHALL 在派生目录激活时校验既有目录与派生条目重叠 id 是同一语义，否则收回既有目录之前一个已激活状态。

---

## 交接项（Handoff Items）

> 本规范是收束专项，交付物以收敛现有 `src/l2/**`、`src/class/**` 与文档为主。收敛落点按不跨 Spec 改他人交付物的原则登记；需要其它 Spec/域配合的以交接项登记。Q-01、Q-04、Q-05 为待裁决未决项，相关字段保持引用与接口、不推导默认机制（与既有约定一致）。

| 编号 | 目标 Spec/文档 | 待办内容 | 依据 |
|------|--------------|---------|------|
| H-ECS-01 | `l2-base-layer-spec` | 本 spec 定义的 ECS 收敛结构规则（组件形状、compositionKind、组合模板）完成后，`l2-base-layer-spec/requirements.md` 应复核并引用本 spec 作为"结构收敛"来源，不重复定义。 | 本 spec §Introduction 关系说明 |
| H-ECS-02 | `wakeup-space-items` | `space-items-contracts.ts::ContainerDomainContract` 收敛为组件形状后，`wakeup-space-items` 需确认 D-059 等已确认裁决不因形状迁移而改变。 | Requirement 7.2 |
| H-ECS-03 | `wakeup-engine-layer` | 若收紧 `kernelOps` 许可集合需要引擎层补充某个语义无关的 Op 注册证据面，属引擎层改动，本 spec 只登记此交接项、不直接改引擎层目录。 | Requirement 3.3 |
| H-ECS-04 | 表现系统 / 玩法层 | 组合模板实例化与玩法数值下沉（`compositionContract.playLayerOwnedFieldNames`）落在玩法层结构；只读投影对 static 组件承载项的展示为表现层/玩法层消费。 | Requirement 4、Requirement 7.1 |
| H-ECS-05 | `docs/L0_规范宪法.md` | vehicle 从 `defKind:"entity"` 基类降级为组合型组件族，若宪法已有 vehicle 属于基类类别之描述，需复核是否需随此裁决同步措辞（本 spec 不直接改宪法，只登记是否需同步）。 | Requirement 6.2 |
| H-ECS-06 | `src/class` / 型号契约线 | `class-contract.ts` 需支持 `compositionKind`（四形）与 `familyId` 解析与校验，使 `ComponentContract` 与 `class-contract.ts` 两条能力契约链合并为单一源。当前 `CAPABILITY_ENTRY_KEYS` 无这两字段，`src/class` 目录仍是与 ECS 分离的旧能力形状（详见 `src/l2/决策与风险记录.md` §7）。 | Requirement 1.2、7.x |
| H-ECS-07 | `src/play` / 玩法层线 | `src/play` 尚无任何对 ECS 组件契约（`composition-registry` / `family-component-shapes`）的消费；对齐需建立 play 侧对接线并加 PBT 守卫，否则要求 8.3 / 10.3 的"玩法层数值下沉与组件复用"无可观察执行链。 | Requirement 8.1、8.3、10.3 |

**未决关联**：本 spec 不裁决 Q-01（武器谱型"特殊"档机制）、Q-04（载具内部微型场景边界）、Q-05（盾牌 MVP 覆盖）。转换期间相关字段只保留引用与接口，不推导默认机制。

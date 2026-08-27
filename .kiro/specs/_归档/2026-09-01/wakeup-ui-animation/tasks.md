# Implementation Plan

> **⚠️ 架构收敛依赖**（2026-08-12）
> UI/动画实现依赖 Wave 3 完成（文档术语一致性迁移）。
> 设计文档中的层级标签需先统一后，再据此编写组件。
> 详见 `docs/L_归档/steering_历史/PARALLEL_EXECUTION_LOCK.md`


## 执行约定

**工具链事实（已核实，不需要改动任何配置）**

以下�?2026-08-08 对仓库实际配置的核对结果（注意：与任务分派时给出的口径不同，配置已被改动过，此处以实测为准）�?

- 测试运行器：`npm test` �?`vitest run`。`vitest.config.ts` �?`include` 现为 `['src/**/*.test.ts', 'test/l2/**/*.test.ts', 'test/properties/**/*.test.ts']`�?
- 类型检查：`npm run typecheck` �?`tsc --noEmit`。`tsconfig.json` �?`include` 现为 `["src", "test/properties"]`�?
- 静态检查：`npm run lint` �?`eslint src --ext .ts`�?*只覆�?`src`**）�?

三工具覆盖矩阵：

| 位置 | vitest | tsc | eslint |
|---|---|---|---|
| `src/**` | 收集 | 检�?| 检�?|
| `test/properties/**` | 收集 | 检�?| 不检�?|
| `test/l2/**` | 收集 | 不检�?| 不检�?|
| `test/` 下其他路�?| 不收�?| 不检�?| 不检�?|

- **本计划全部测试位�?`src/ui/**/__tests__/*.test.ts`**：这是唯一被三个工具同时覆盖的位置�?*因此测试收集、类型检查与静态检查都不需要任何配置改�?*�?
- **唯一的配置改动是任务 0**：把 `src/ui/**` 加入 `.eslintrc.cjs` 既有渲染层边界规则的 `files` 列表。它与测试收集无关，目的是让"表现层不�?import 写入接口"�?lint 强制，与项目�?`src/scene`/`src/components` 的既有做法一致。该改动�?additive，不放宽任何现有规则�?
- **不存�?`@kernel/*` 别名**：一律使用相对路径导入（`../../core/kernel/...`、`../../l2/model/...`）�?
- **不得�?`src/core/kernel/state/error-codes.ts` �?`ERR_CODES` 新增任何�?*。内核码�?`Result<T>.code` 原样透传；UI 侧诊断码复用 `src/l2/model/diagnostic-codes.ts` �?design.md「Error Handling」的 UI 用法表�?

**硬性纪�?*

- 不做 MVP、不留占位、不�?`TODO`、不省略实现。每个任务交付可编译、可运行的完整代码�?
- **属性测试是必交付项**：design.md「Correctness Properties」的 24 条属性各对应**恰好一�?*测试文件，缺一条即视为对应需求未实现。任�?10.x **不得**标记为可选、不得跳过�?
- 每个属性测�?`numRuns` **至少 100**�?
- 属性测试标注注释格式固定：`// Feature: wakeup-ui-animation, Property {N}: {property_text}`，其�?`{property_text}` �?design.md 中该属性的标题原文�?
- 每个任务完成后运�?`npm run typecheck`、`npm run lint`、`npm test`，三者全绿才算完成�?

**状态标�?*：本文件只使用两种标记，`- [ ]` 未完成、`- [x]` 已完成。不使用 `[-]`、`[~]`、`[Pending]` 等混合标记�?*在有真实验证产物（测试实际执行并通过）之前，不得标记为完成�?*

---

## 任务

- [x] **0. �?`src/ui/**` 纳入渲染�?lint 边界（唯一必要的配置改动）**
  - **目标�?* �?表现层不�?import 写入接口"这条边界�?lint 强制，而不是只由自建架构测试保障�?
  - **实现范围�?* �?`.eslintrc.cjs` 中，�?`src/ui/**/*.ts` 加入既有渲染�?override �?`files` 列表（该 override 现覆�?`src/scene/**`、`src/components/**`，禁�?import `**/kernel/ops/**`、`**/kernel/state/**`）�?*只加路径，不放宽任何现有规则�?*
  - **验收标准�?* �?`src/ui/` 下临时写一�?import `kernel/ops` 的文件，`npm run lint` 报错；删除后恢复通过。既�?`src/scene`/`src/components` 规则语义不变�?
  - **依赖�?* 无�?
  - **需求与设计引用�?* Requirements 4.1�?.4�?3.7；design.md §1.3、J-25；meta-mechanism-kernel design §3.15、要�?40.5�?
  - **说明�?* 这是本计�?*唯一**的配置改动，且是 additive。测试收集不需要任何配置改动（见「执行约定」）�?
  - **完成证据�?* `.eslintrc.cjs` �?8-75已添�?`src/ui/**/*.ts` �?`src/ui/**/*.tsx` 到渲染层边界规则；临时测试文件导�?`kernel/ops` 触发 lint error；`npm run lint` 通过�? errors, 16 warnings）�?026-08-11验证�?

- [x] **1. 建立 `src/ui/model/` 的零逻辑数据形状**

  - [x] **1.1 实现 `State_Revision` 复合令牌与全序比�?*
    - **目标�?* 提供既能判等又能判序的修订令牌，解决内核无修订版本概念（design.md §2.2）与指纹只能判等（C-4）的问题�?
    - **实现范围�?* �?`src/ui/model/revision.ts` 定义 `StateRevision {sequence: number; fingerprint: string}`；实�?`compareRevision(a, b)` 返回 `'newer' | 'same' | 'older' | 'uncomparable'`；`sequence` 相同�?`fingerprint` 不同�?*必须**返回 `'uncomparable'`，不得返�?`'same'`；提�?`isSuperseded(cached, incoming)` 判定�?
    - **验收标准�?* 比较函数�?`sequence` 维度上满足全序（自反、反对称、传递）；`uncomparable` 分支可被构造并被显式返回；类型检查通过；单元测试覆盖四个返回分支各至少一例�?
    - **依赖�?* 无�?
    - **需求与设计引用�?* Requirements 2.8�?.3�?.1；design.md §4.1、J-1�?
    - **完成证据�?* `src/ui/model/revision.ts` 已实�?`StateRevision`、`compareRevision`、`isSuperseded`；`src/ui/model/__tests__/revision.test.ts` 7个测试全部通过；覆盖四个返回分支�?026-08-11验证�?

  - [x] **1.2 实现 `Rule_Event_Projection` 安全字段形状与白名单投影**
    - **目标�?* 让增量演出只能看到显式登记过的字段�?
    - **实现范围�?* �?`src/ui/model/event-projection.ts` 定义 `RuleEventProjection {sequence, semanticType, observedAtRevision, safePayload}`；实�?`projectSafePayload(rawPayload, whitelist)`�?*未登记的键一律丢�?*并为每个被丢弃的键产出一�?`warn` 诊断；不得实现任何黑名单分支�?
    - **验收标准�?* 给定含未登记键的载荷，输出不含该键且诊断条数等于被丢弃键数；白名单为空时输出为空映射；类型检查通过�?
    - **依赖�?* 1.1�?
    - **需求与设计引用�?* Requirements 3.2�?5.2；design.md §4.2、J-10、J-11�?
    - **完成证据�?* `src/ui/model/event-projection.ts` 已实�?`RuleEventProjection`、`projectSafePayload`；`src/ui/model/__tests__/event-projection.test.ts` 6个测试全部通过�?026-08-11验证�?

  - [x] **1.3 实现 `Interaction_Intent` 形状**
    - **目标�?* 让意图从类型上无法表达无意义状态�?
    - **实现范围�?* �?`src/ui/model/intent.ts` 定义 `InteractionIntent {intentId, agentId, target, bindings, observedRevision, inputSource}`；`target` 必须�?*判别联合** `ActionIntentTarget | DecisionIntentTarget`（不得用两个可选字段）；`bindings` 取值类型限定为投影中出现过的标识或值；定义 `InputSource` 闭合枚举（`keyboard` / `pointer` / `touch` / `gamepad` / `assistive`）�?
    - **验收标准�?* 无法构�?两个 target 都填"�?都不�?的值（类型层拒绝）；`observedRevision` 为必填；`inputSource` 在类型注释中明确标注"不参与合法性判�?；类型检查通过�?
    - **依赖�?* 1.1�?
    - **需求与设计引用�?* Requirements 4.1�?.2�?.9；design.md §4.3�?
    - **完成证据�?* `src/ui/model/intent.ts` 已实�?`InteractionIntent` 判别联合、`InputSource` 枚举；`src/ui/model/__tests__/intent.test.ts` 7个测试全部通过�?026-08-11验证�?

  - [x] **1.4 实现玩家可见数值与内部度量的类型隔�?*
    - **目标�?* 让越界玩法数值在类型层不可构造，并使内部度量无法被当作玩法数值渲染�?
    - **实现范围�?* �?`src/ui/presentation/gameplay-value.ts` 定义�?brand �?`GameplayValue`（取值类型为 `1|2|3|4|5` 字面量联合）�?`InternalMetric<T>{value, unit}`；实�?`makeGameplayValue(raw, ownership)`：非整数、非有限、越界、缺归属分类一律返回结构化拒绝并携�?`GAMEPLAY_VALUE_OUT_OF_RANGE`；范围常量从 `src/l2/model/constitution.ts` �?`GAMEPLAY_VALUE_RANGE` 读取�?*不重新裁�?*；实�?`makeInternalMetric(value, unit)`�?
    - **验收标准�?* `0`、`6`、`2.5`、`NaN`、`Infinity`、缺归属分类六类输入全部被拒绝；`1` �?`5` 被接受；`InternalMetric` 无法传入接受 `GameplayValue` 的位置（类型层拒绝）；不存在�?1�? 转百分比或小数的导出函数�?
    - **依赖�?* 无�?
    - **需求与设计引用�?* Requirements 10.1�?0.4�?0.6�?0.7；design.md §11.1、J-17�?
    - **完成证据�?* `src/ui/presentation/gameplay-value.ts` 已实�?`GameplayValue`、`InternalMetric`、`makeGameplayValue`；`src/ui/presentation/__tests__/gameplay-value.test.ts` 9个测试全部通过�?026-08-11验证�?

  - [x] **1.5 实现 `SelectableOptionSet` �?�? 分级导航**
    - **目标�?* 在不改变合法动作集的前提下，保证任一时刻同时可选项不超�?5�?
    - **实现范围�?* �?`src/ui/model/option-set.ts` 定义 `SelectableOptionSet {visible, navigation, totalLegalOptions}`；实�?`buildOptionSet(actions, cursor)`：按 `costCategory`�? 值）�?`interactionIntent`�? 值）�?稳定标识分页三级展开�?*导航控件计入 `visible` 预算**；`totalLegalOptions` �?`InternalMetric<number>` 且恒等于输入动作数�?
    - **验收标准�?* 对任意规模输入（�?0�?�?�?�?7�?00），`visible.length <= 5` 恒成立；`totalLegalOptions` 恒等于输入长度；不存在丢弃或截断选项的分支（全部选项可通过导航到达）；排序确定性（同输入同输出）�?
    - **依赖�?* 1.4�?
    - **需求与设计引用�?* Requirements 10.10�?.4；design.md §4.4、J-13、J-14�?
    - **完成证据�?* `src/ui/model/option-set.ts` 已实�?`SelectableOptionSet`、`buildOptionSet`；`src/ui/model/__tests__/option-set.test.ts` 8个测试全部通过；属性测�?p17 验证 �? 不变式�?026-08-11验证�?

  - [x] **1.6 实现 `Presentation_Profile` schema �?UI 诊断形状**
    - **目标�?* �?profile 装载�?UI 诊断提供类型契约�?
    - **实现范围�?* �?`src/ui/model/profile.ts` 定义 `PresentationProfile`，含 `visualDirection`、`colorSemantics`（D-066 闭合语义角色 + 金银高光通道）、`pacingPresentations`（`standard-combat` / `solo-cadence` / `minimal-ui`）、`ceremonialActionSemantics[]`（每项必须有 `actionSemanticId` + `authoritativeSource`）、`salienceTiers[]`（`tier` �?`'public-persistent'|'public-on-inspect'|'hidden'` 闭合枚举）、`turnOrderBar`、`endTurnCountdown`、`safeFieldWhitelist`、`safeUnavailabilityReasons`、`eventBufferTimeout`（`InternalMetric`）；�?`src/ui/model/diagnostic.ts` 定义 `UiDiagnostic`，结构复�?`src/l2/model/diagnostic.ts` �?`Diagnostic`，码集为 design.md「UI 侧诊断码」表�?
    - **验收标准�?* 所有集合为只读类型；`tier` �?`authoritativeSource` 为必填；颜色主语义角色闭合且金银不进入主色互斥集合；三种节奏呈现为闭合判别联合；profile 类型中不含任何玩家可见数值字段与规则语义字段；类型检查通过�?
    - **依赖�?* 1.4�?
    - **需求与设计引用�?* Requirements 6.1�?.7�?.9�?.15�?3.3；design.md §9.2、�?.4、Error Handling�?
    - **完成证据�?* `src/ui/model/profile.ts` 已实�?`PresentationProfile`；`src/ui/model/diagnostic.ts` 已实�?`UiDiagnostic`；`src/ui/model/__tests__/profile.test.ts` 10个测试全部通过�?026-08-11验证�?

- [x] **2. 建立 `src/ui/ports/` 上游端口**

  - [x] **2.1 定义投影端口、事件端口、着法查询端口与修订端口**
    - **目标�?* �?UI 只通过端口消费上游，不 import 任何上游具体实现；并�?C-5 的过滤缺口收在端口内�?
    - **实现范围�?* �?design.md §3.0 的绑定关系定义四个端口：
      - `projection-port.ts`：`fetchProjection`（绑�?`createProjection`）与 `fetchDescriptor`（绑�?`uiDescriptor`），结果携带只读视图、`StateRevision` 与诊断数组�?
      - `event-port.ts`：订阅接口，绑定 `PresentationGateway.subscribe`�?*只对外提供已�?`AuthorizationScope` 收窄的事�?*�?
      - `action-query-port.ts`：`scopedQuery(spec)` �?`queryActions(actor)`，绑�?`PresentationGateway.query` / `queryActions(actor,'ui')`�?*不得暴露接受�?`Query` 的方�?*——`visibleTo` 由端口内部强制注入，�?忘记�?visibleTo"在类型层不可构造（J-23）�?
      - `revision-port.ts`：`sequence` 段来源接口（上游暂缺，见 §14.4 �?1 项）�?
      四个文件�?*不得** import `src/l2/**` �?`src/core/**` 的实现模块，只允�?import `src/ui/model/**`�?
    - **验收标准�?* 端口全部�?`interface`，无实现；结果类型不含任何可变字段；四个文件�?import 列表中不出现 `src/l2` �?`src/core`；`action-query-port.ts` 无任何形参类型为�?`Query` 的方法；类型检查通过�?
    - **依赖�?* 1.1�?.2�?
    - **需求与设计引用�?* Requirements 2.1�?.1�?.2�?4.9；design.md §3.0、�?.1、�?.3、�?.1、C-5、C-6、J-23�?
    - **完成证据�?* `src/ui/ports/` 下四个端口文件已实现；`src/ui/ports/__tests__/port-boundaries.test.ts` 17个测试全部通过；架构测试验证无上游实现依赖�?026-08-11验证�?

  - [x] **2.2 定义权威动作端口，并区分 `stale` �?`rejected`**
    - **目标�?* �?UI 只有一条提交路径，且陈旧与普通拒绝可被分别处理�?
    - **实现范围�?* �?`src/ui/ports/action-port.ts` 定义 `ActionPort.submit(intent): SubmissionOutcome`，绑定上�?`submitUiAction({active, kernel, request, scope, callerId})`（它内部构�?`CallerContext{kind:'ui'}` 并转发统一 `submit`）；`SubmissionOutcome` 为三分支判别联合 `accepted`（携�?`committedRevision`�? `rejected` / `stale`，由端口把上�?`Result<OpResult>` 与其诊断码归一到这三支；在接口文档注释中写明实现方的义务：在任�?Op 被调用之前重新校�?Agent 权限、动作可见性、当前合法性、目标、成本、Decision 状态与当前修订�?*端口不得暴露 `invoke` 或任何直接写入方法�?*
    - **验收标准�?* `accepted` �?`stale`/`rejected` 无法混淆（判别联合）；文件中不出�?`OpRegistry`、`invoke`、`prop.set`；类型检查通过�?
    - **依赖�?* 1.1�?.3�?
    - **需求与设计引用�?* Requirements 4.3�?.5�?.7�?.6；design.md §3.2、�?.1�?
    - **完成证据�?* `src/ui/ports/action-port.ts` 已实�?`ActionPort`、`SubmissionOutcome` 判别联合；架构测试验证无写入标识符�?026-08-11验证�?

  - [x] **2.3 定义待汇合契约端口与显式失败结果**
    - **目标�?* 让尚未汇合的领域字段表现为显式失败，而不是猜测值�?
    - **实现范围�?* �?`src/ui/ports/convergence.ts` 定义 `ConvergenceResult<T> = {ok:true,value:T} | {ok:false,code:'PENDING_CONVERGENCE_CONTRACT',missing:readonly string[]}`；在 `pending-contracts.ts` �?`core` / `space-items` / `AI` 各定义一个能力端口，**只声明所需能力，不定名具体字段**，返回类型统一�?`ConvergenceResult<T>`�?
    - **验收标准�?* 三个端口都不含具体字段名常量；不存在返回空映射或默认值的分支；类型检查通过�?
    - **依赖�?* 2.1�?
    - **需求与设计引用�?* Requirements 14.1�?4.5�?4.6�?4.9；design.md §14.1�?4.4�?
    - **完成证据�?* `src/ui/ports/convergence.ts`、`src/ui/ports/pending-contracts.ts` 已实现；属性测�?p23 验证显式失败�?026-08-11验证�?

- [x] **3. 实现投影消费与陈旧检�?*

  - [x] **3.1 实现深冻结断言与只读视图构�?*
    - **目标�?* �?UI 边界上机械拒绝任何未冻结或可变的上游投影�?
    - **实现范围�?* �?`src/ui/projection/projection-cache.ts` 实现 `acceptProjection(raw)`：对投影�?*深度**冻结断言，任一层未冻结即返回结构化拒绝并携�?`PROJECTION_NOT_FROZEN`�?*不得就地冻结**（会掩盖上游违约）；实现�?`agentId + scopeId` 为键的缓存，不同 Agent 不共享缓存条目�?
    - **验收标准�?* 传入含未冻结嵌套层的投影被拒绝；传入深冻结投影被接受；两个不�?`agentId` 的缓存互不可见；缓存不暴露任�?setter�?
    - **依赖�?* 2.1�?
    - **需求与设计引用�?* Requirements 2.6�?.8；design.md §5.1、Property 1、Property 22�?
    - **完成证据�?* `src/ui/projection/projection-cache.ts` 已实现；`src/ui/projection/__tests__/projection-cache.test.ts` 10个测试通过；属性测�?p01、p22 验证�?026-08-11验证�?

  - [x] **3.2 实现陈旧检测与重同�?*
    - **目标�?* 让过期投影与过期绑定必被检出�?
    - **实现范围�?* �?`src/ui/projection/staleness.ts` 实现基于 `compareRevision` �?`isStale(cached, current)`；`uncomparable` 一律按需要全量重拉处理。在 `reconcile.ts` 实现：收�?`stale` 结果时先取新鲜投影再启用交互；收到修订间隙或乱序增量时请求全量投影，**不猜�?*缺失的语义迁移；迟到事件丢弃并记 `EVENT_ARRIVED_STALE`（`info`）；超前事件缓冲超时后丢弃缓冲并触发全量重拉，记 `EVENT_BUFFER_TIMEOUT`（`warn`）�?
    - **验收标准�?* 四条路径（陈旧、间隙、迟到、超前超时）各有确定性单元测试；`uncomparable` 触发全量重拉；不存在从增量事件推断缺失状态的分支�?
    - **依赖�?* 3.1�?.1�?.2�?
    - **需求与设计引用�?* Requirements 2.8�?.3�?.6�?.9�?5.4�?5.6；design.md §4.1、�?5.3、�?7�?
    - **完成证据�?* `src/ui/projection/staleness.ts`、`src/ui/projection/reconcile.ts` 已实现；`src/ui/projection/__tests__/staleness.test.ts` 4个测试、`reconcile.test.ts` 19个测试全部通过；属性测�?p12 验证�?026-08-11验证�?

  - [x] **3.3 实现全量与增量共用的视图归约**
    - **目标�?* 保证"全量渲染"�?全量 + 增量重放"收敛到同一视图�?
    - **实现范围�?* �?`src/ui/model/view.ts` 定义 `UiView`；在 `src/ui/projection/reconcile.ts` 实现**唯一一�?*归约函数 `reduceView(base, events)`，全量路径以空事件数组调用它�?*禁止**为两条路径写两份归约实现。稳定标识跨修订可复用视图表示，但不得复用陈旧语义字段；最新投影中不存在的稳定标识一律移除活动视图，除非当前 Knowledge 显式授权记忆表示�?
    - **验收标准�?* 两条路径在同一修订下产出逐字段相等的 `UiView`；丢弃任意事件子集不改变最终视图；全量投影与本地动画状态矛盾时以全量投影为准；代码�?`reduceView` 只有一处定义�?
    - **依赖�?* 3.1�?.2�?
    - **需求与设计引用�?* Requirements 15.1�?5.3�?5.5�?5.6�?5.7�?.1；design.md §15、J-15、J-6�?
    - **完成证据�?* `src/ui/model/view.ts`、`src/ui/projection/reconcile.ts` 已实现唯一归约函数；属性测�?p21 验证收敛性�?026-08-11验证�?

  - [x] **3.4 实现单一 Agent 过滤点（�?C-5 的上游缺口）**
    - **目标�?* �?`PresentationGateway` 不按 Agent 过滤，UI 端口边界必须成为唯一且可靠的过滤点�?
    - **实现范围�?* �?`src/ui/projection/scope-filter.ts` 实现：对 `Gateway.query` �?`scopedQuery(spec)`，由本模块按 `AuthorizationScope` 构造并**强制注入** `visibleTo` 谓词（不提供接受�?`Query` 的路径）；对 `Gateway.subscribe` 投递的 `(type, payload)`，按 `visibleEntityIds` / `visibleNodeIds` / `authorizedBeliefAgentIds` 收窄，出现范围外标识�?*丢弃该事�?*并产�?`PROJECTION_SCOPE_VIOLATION`；随后交�?§4.2 的白名单投影。禁止在 UI 其他任何模块再做第二次可见性判断�?
    - **验收标准�?* 构造不�?`visibleTo` 的查询在类型层不可表达；含范围外实体标识的事件被丢弃且产出诊断；`'*'` 通配订阅经本模块后不会泄漏范围外标识；架构测试确认除本文件外无其他模块引�?Gateway 的原始订�?查询�?
    - **依赖�?* 2.1�?.2�?
    - **需求与设计引用�?* Requirements 3.1�?.2�?.3；design.md §6.1、�?.2、C-5、J-23�?
    - **完成证据�?* `src/ui/projection/scope-filter.ts` 已实现；`src/ui/projection/__tests__/scope-filter.test.ts` 9个测试通过；属性测�?p05、p06、p07、p22 验证防泄漏�?026-08-11验证�?

- [x] **4. 实现描述符校验、降级与无障�?*

  - [x] **4.1 实现描述符语义字段校�?*
    - **目标�?* 语义字段缺失或损坏必然导致拒绝，且绝不发明语义�?
    - **实现范围�?* �?`src/ui/presentation/descriptor-validator.ts` 校验 `ActionDescriptor` / `ResourceDescriptor` / `TargetDescriptor`：`actionId`、目标绑定、`role`、`interactionIntent`、`costCategory`、`available` 缺失或取值越界时拒绝该描述符�?*撤除由它派生的全部交互入�?*，产出对�?`error` 诊断（`DESCRIPTOR_SEMANTIC_FIELD_MISSING` / `UI_UNKNOWN_RESOURCE_ROLE` / `UI_DESCRIPTOR_TARGET_UNRESOLVED`）；闭合取值域�?`src/l2/model/family-contracts.ts` �?`RESOURCE_SEMANTIC_ROLES`、`INTERACTION_INTENTS`、`ACTION_COST_CATEGORIES` 读取；描述符版本超出支持范围时拒绝受影响描述符但**保留**其余兼容投影�?*禁止任何字段名、颜色、文件名、标签启发式�?*[2026-08-08 权威变更（本次会话裁决，已获项目所有者授权）：已删除 `attackShape` 字段�?`ATTACK_SHAPES` 闭合取值域，攻击形状判定为冗余设计，已被武器属性（散射/扫射/连发）完全覆盖。详�?docs/L0_规范宪法.md、docs/L2_基类�?基类层定�?md §4.3 最新权威内容。]
    - **验收标准�?* 不存�?部分渲染"中间态（拒绝即撤除全部派生交互）；`posture` 按开放字符串透传�?*不做**枚举校验；不存在从标�?图标/素材名推导语义的分支；版本不受支持时其余描述符仍渲染�?
    - **依赖�?* 3.1�?.6�?
    - **需求与设计引用�?* Requirements 2.4�?.5�?.1�?.2�?4.8；design.md §5.2、�?0.1、J-15�?

  - [x] **4.2 实现表现字段降级**
    - **目标�?* 纯资源失败降级并告警，且降级不得掩盖语义错误�?
    - **实现范围�?* �?`src/ui/presentation/fallback.ts` 实现类型兼容回退：图标、纹理、音效、触觉、动画片段、字体、无对应资源�?`posture` 缺失时选择**已显式声�?*的回退并产�?`PRESENTATION_FALLBACK_APPLIED`（`warn`）；回退**只能**从已验证语义字段派生；回退不得增加、移除或启用任何动作；原描述符语义类型本身隐藏时使用 `Visibility_Safe` 通用呈现而非类型特定回退；无类型兼容且可见性安全的回退时省略该非必要资源并保留语义文本或形状输出�?*禁止把语义拒绝转为警告�?*
    - **验收标准�?* 降级后动作可用性不变；隐藏类型不通过回退类型泄漏；不存在语义错误 �?`warn` 的转换路径；不存在资源缺�?�?禁用合法动作的路径�?
    - **依赖�?* 4.1�?
    - **需求与设计引用�?* Requirements 9.3�?.7�?.10；design.md §10.2、Property 20�?

  - [x] **4.3 实现无障碍标签判定与感知等价**
    - **目标�?* 标签缺失时使用已验证回退或拒绝；MVP 保留现有图标、文字和材质线索，但不实现完整色盲纹理矩阵�?
    - **实现范围�?* �?`src/ui/presentation/accessibility.ts` 实现：`accessibleLabel` �?*空串或纯空白视为缺失**；缺失时优先走类型兼容回退（上�?`ui-adapter.ts` 已实现“回退�?`actionId` + `PRESENTATION_FALLBACK_APPLIED`”，UI 侧沿用并接受该回退，见 design.md C-7）；**仅当连稳定标识都不可�?*、而该呈现是交互控件或规则显著状态时，才拒绝该呈现并产出 `ACCESSIBLE_LABEL_MISSING`（`error`），底层规则状态不变；保留现有图标/文字/材质线索与减少动态替代�?*不得**�?MVP 新建逐色纹理矩阵、专用色盲调色或无色完全等价门禁（D-066）；读屏与字幕消费与视觉渲染**同一�?*已过滤投影�?
    - **验收标准�?* 空串与纯空白两种输入都被判为缺失并走回退 + 警告；连稳定标识都取不到时才拒绝；现有替代文本、ARIA 元数据、字幕、振动模式、减少动态替代物中不编码隐藏状态；当前交付不含色盲纹理矩阵�?
    - **依赖�?* 4.1�?.2�?
    - **需求与设计引用�?* Requirements 9.9�?1.1�?1.5�?1.10�?1.11；design.md §11.2、�?1.3、J-2、J-3�?

  - [x] **4.4 实现不可用原因安全化**
    - **目标�?* 不把可能越权的自由文本直接渲染给玩家�?
    - **实现范围�?* �?`src/ui/presentation/accessibility.ts` 旁新�?`unavailability-reason.ts`：`unavailabilityReason` 原文**不直接渲�?*；按 profile �?`safeUnavailabilityReasons` 映射键取通用原因；无映射时回落到通用不可用文案；原文仅进入需显式上游授权的开发诊断面。映射键字段尚未汇合，因此本任务通过 `ConvergenceResult` 表达其缺失�?
    - **验收标准�?* 玩家可见输出中不出现原文；无映射时输出通用文案而非留空或原文；缺映射键字段时返�?`PENDING_CONVERGENCE_CONTRACT`�?
    - **依赖�?* 4.1�?.3�?
    - **需求与设计引用�?* Requirements 3.6�?4.5；design.md §6.3、J-16、�?4.4 �?3 项�?

  - [x] **4.5 实现显著性分层解析与冲突拒绝**
    - **目标�?* 分层只来自显式字段，且不得凌驾于规则层可见性之上�?
    - **实现范围�?* �?`src/ui/presentation/salience.ts` 实现三档解析（`public-persistent` / `public-on-inspect` / `hidden`）；分层**只从显式描述符字段读�?*，不从规则效果推断；profile 声明的分层与规则层可见性分类矛盾时拒绝该条目并产出 `SALIENCE_TIER_CONFLICT`（`error`）；`hidden` 档对非所有者观察者不产生任何呈现输出（含顺序、计数、动画选择与时序）；`public-on-inspect` 的检视为纯本地操作，不产生交互意图、不消耗资源、不改变语义状态�?
    - **验收标准�?* 三档各有解析用例；矛盾组合被拒绝；`hidden` 档在非所有者视角下的呈现输出与该状态不存在时逐项相等；检视操作不产生任何 `InteractionIntent`�?
    - **依赖�?* 4.1�?.6�?
    - **需求与设计引用�?* Requirements 3.10�?.14�?.14�?.15；design.md §6.4、J-4�?

- [x] **5. 实现交互意图生命周期**

  - [x] **5.1 实现输入归一�?*
    - **目标�?* 所有输入来源解析到同一组稳定交互标识与同一个意图形状�?
    - **实现范围�?* �?`src/ui/interaction/input-normalizer.ts` 把键盘、指针、触摸、手柄、开关控制、辅助自动化事件归一化为 `{controlId, interactionId, inputSource}`；实现输入绑定配置：改绑只改物理输入到稳定交互标识的映射�?*不改动作定义**、不引入来源特定合法性；两个绑定冲突时产出确定性冲突报�?`INPUT_BINDING_CONFLICT`（`error`）并要求显式解决�?*不静默丢�?*�?
    - **验收标准�?* 六类来源对同一动作产出相同 `interactionId`；改绑前后动作标识与合法性不变；冲突被报告而非静默丢弃；冲突报告确定性（同输入同输出顺序）�?
    - **依赖�?* 1.3�?
    - **需求与设计引用�?* Requirements 4.9�?1.6�?1.7�?1.8；design.md §7.2、�?1.3�?

  - [x] **5.2 实现意图构建**
    - **目标�?* 意图只能引用当前权威投影中存在的动作或开�?Decision�?
    - **实现范围�?* �?`src/ui/interaction/intent-factory.ts` 实现 `buildIntent(view, controlId, selection)`：动作或 Decision 必须存在于当前投影且 Decision 状态为开放；绑定取值必须来自投影；写入当前观察到的 `StateRevision`；不存在从用户输入直接构造目标标识的路径�?
    - **验收标准�?* 引用不存在的动作、已关闭�?Decision、投影外的目标三类输入均被拒绝；`observedRevision` 必被填入；同一动作经不同来源构建出的意图除 `inputSource` 外逐字段相等�?
    - **依赖�?* 5.1�?.3�?
    - **需求与设计引用�?* Requirements 4.1�?.2�?.4�?.5；design.md §4.3、�?.1�?

  - [x] **5.3 实现待决登记�?*
    - **目标�?* 同一待决控件的额外激活不产生第二个意图�?
    - **实现范围�?* �?`src/ui/interaction/pending-registry.ts` 实现 `tryRegister(controlId, intent)` / `settle(intentId, outcome)` / `invalidateByRevision(current)`�?*�?`controlId` 为键**，不以动作标识为键；已有待决时返�?`already-pending` 且不产生新意图；修订变化时批量失效受影响绑定并返回被失效的控件列表�?
    - **验收标准�?* 同一 `controlId` 连续 N 次激活只产出 1 个意图；不同 `controlId` 承载同一动作时各自可独立产出意图；修订变化后原绑定不可再提交�?
    - **依赖�?* 5.2�?.1�?
    - **需求与设计引用�?* Requirements 5.1�?.3；design.md §8.1、J-12�?

  - [x] **5.4 实现提交与完成确�?*
    - **目标�?* 成功只由已提交投影确认，且陈旧触发重同步�?
    - **实现范围�?* �?`src/ui/interaction/submit.ts` 实现提交流程：经 `ActionPort.submit` 提交；`accepted` �?*等待观察到含 `committedRevision` 的投�?*才视为完成；`stale` 触发重同步后才重新启用交互；`rejected` 展示可见性安全的结构化拒绝并刷新受影响投影，**不合成补偿写�?*；绝不从按钮禁用、动画开始、音效播放或请求已发出推断成功�?
    - **验收标准�?* `accepted` 但尚未观察到目标修订时状态为"未完�?；`stale` �?`rejected` 走不同路径；不存在任何补偿性写入分支；`src/ui/interaction/**` 不出现写入标识符�?
    - **依赖�?* 5.3�?.2�?.2�?
    - **需求与设计引用�?* Requirements 4.6�?.7�?.6�?.7；design.md §7.1、�?.3、Property 13�?

  - [x] **5.5 实现双菜单面、回合末倒计时与一人模式节奏计�?*
    - **目标�?* 菜单分面复用已有成本分类；所有表现计时器只提交权威意图，绝不直接推进规则�?
    - **实现范围�?* �?`src/ui/interaction/menu-faces.ts` �?`costCategory` 分出付费面与零费面（交集为空、并集等于全部可用动作）；零费面**在任何时候可�?*，不得实现“预算耗尽才可用”分支；预算耗尽时付费面为空而零费面与结束回合按键保留。在 `src/ui/interaction/end-turn-countdown.ts` 实现回合末倒计时：秒数取自 profile 且为 `InternalMetric`，结束时�?`ActionPort.submit` 提交结束回合意图。在 `src/ui/interaction/solo-cadence.ts` 实现一人模式空闲计时：每次被接受的玩家操作重置计时；到期只构造“空回合推进”意图；一人条件失效、修订变化或提交被拒绝时取消。两个计时器都不得把到期当作规则已推进�?
    - **验收标准�?* 两面交集为空且并集完整；零费动作在预算充足时也可执行；两种计时器任意取消/重置后规则语义不变；自然到期都走与其他意图相同的提交通道；一�?标准战斗/�?UI 三态切换不清空对局投影�?
    - **依赖�?* 5.4�?.5�?.6�?
    - **需求与设计引用�?* Requirements 5.9�?.14�?.22�?.24�?.10；design.md §8.4、�?.4、J-5�?

- [x] **6. 实现演出编排（不触碰规则�?*

  - [x] **6.1 实现演出队列与因果顺�?*
    - **目标�?* 演出按权威因果顺序播放，且演出侧无法回调规则侧�?
    - **实现范围�?* �?`src/ui/animation/scheduler.ts` 实现演出队列：排序键�?`RuleEventProjection.sequence` 与修订令牌，**不使用本地时钟或到达顺序**；支持显式合并动效但不改变或隐藏最终语义结果；支持取消/重定�?快进/替换过时动画；跳过时立即呈现等价最终语义状态与必需播报。所有回调签名返�?`void` �?*不接收任何可提交端口**。`src/ui/animation/**` **禁止** import `ActionPort`、`intent-factory`、`submit`、`KernelContract`�?
    - **验收标准�?* 乱序输入�?`sequence` 播放；合并后最终态仍从投影渲染；跳过后立即呈现最终态；回调类型无法接收提交能力（类型层拒绝）；import 约束�?8.2 的架构测试覆盖�?
    - **依赖�?* 3.3�?.2�?
    - **需求与设计引用�?* Requirements 7.1�?.7；design.md §16.1、�?6.2�?

  - [x] **6.2 实现仪式动画编排与减少动�?*
    - **目标�?* 仪式集合闭合，且仪式状态不携带规则语义�?
    - **实现范围�?* �?`src/ui/animation/ceremonial.ts` �?profile �?`ceremonialActionSemantics` 决定是否播放全屏分离式仪式动画；集合**闭合**——不在集合内的动作语义一律不得获得全屏呈现；三个允许跳过的例外（用户显式跳过、减少动态模式、资源失败回退）只影响呈现；`招架触发` 仅在**被近战攻�?*结算分支播放，`Parry_Ready` 因远程或不可招架伤害失效�?*不产生任�?*动画、提示或可观察呈现。本文件**不得** import 任何合法性或成本模块。在 `reduced-motion.ts` 实现非必要动效的替换或移除，保留信息、交互可用性与权威时序�?
    - **验收标准�?* 集合外动作语义无全屏呈现；四项集合内动作有全屏呈现；静默失效分支产出零呈现；装饰性变化由稳定标识确定性派生且不消耗权威随机流；减少动态后动作可用性与必需播报不变�?
    - **依赖�?* 6.1�?.6�?.5�?
    - **需求与设计引用�?* Requirements 6.4�?.5�?.7�?.8�?.14�?.15�?.8�?.9；design.md §9.2、�?.3、�?6.3、J-18、J-21�?

- [x] **7. 实现诊断汇与 profile 装载**

  - [x] **7.1 实现按受众分级的诊断�?*
    - **目标�?* 诊断可定位但不成为越权读取通道�?
    - **实现范围�?* �?`src/ui/diagnostics/sink.ts` 实现：记录描述符拒绝、陈旧交互、投影间隙、资源失败、回退选择五类结构化诊断；用户可见诊断渲染前按 `Authorized_Agent` 过滤；开发诊断需显式上游授权�?*不得**由仅客户端开关启用；已授权开发面只增加可�?*字段**不增加可�?*实体**；重复失败折叠时保留首次安全上下文、最近一次发生与计数；资源加载器遥测在描述性名会泄漏时使用不透明标识；回放或回退期间诊断标注其关�?`StateRevision`；诊断渲染器自身失败时保留底层规则投影且**不得**重试规则动作�?
    - **验收标准�?* 用户面诊断不含隐藏标识、隐藏语义派生素材名、秘密条件与未过滤事件载荷；仅客户端开关无法开启开发诊断；折叠保留三项；不存在把重试规则动作当恢复的分支�?
    - **依赖�?* 1.6�?.2�?
    - **需求与设计引用�?* Requirements 12.1�?2.10�?.9；design.md §12「日志、诊断与调试面板安全」、Error Handling、Property 5、Property 24�?

  - [x] **7.2 实现 profile 装载与来源校�?*
    - **目标�?* profile 只能承载可替换表现配置，且仪式集合的任何改动必须携带决策编号�?
    - **实现范围�?* �?`src/ui/profile/profile-loader.ts` 走严�?JSON 解析链（复用 `src/core/kernel/spec-compiler/json-codec.ts` �?`StrictJsonCodec`，做法与 `src/class/catalog-loader.ts` 一致）；强制校验：`ceremonialActionSemantics` 每项必须�?`authoritativeSource` 且编号存在于已确认决策目录，否则 `CEREMONIAL_SOURCE_MISSING`（`error`）；profile 出现规则语义字段或玩家可见数值字面量时拒�?*整个** profile 并产�?`PROFILE_RULE_SEMANTIC_FIELD`（`error`）；`salienceTiers` 与规则层可见性矛盾时 `SALIENCE_TIER_CONFLICT`。产�?`src/ui/profile/wakeup-default.profile.json`，内容按 design.md §9.2/§9.4（颜色语义闭合集、金银高光、三种节奏呈现、四项仪式动画、三档显著性、轮次栏�? 秒倒计时）�?
    - **验收标准�?* 三条拒绝路径各有用例；默�?profile 装载成功，颜色主语义角色与三种节奏呈现闭合，金银只存在于高光通道，仪式集合恰为四项（翻窗、跳窗、令其长眠、招架触发）；默�?profile 中不含任何玩家可见数值字面量；解析拒绝重复键与危险键�?
    - **依赖�?* 1.6�?.1�?.5�?
    - **需求与设计引用�?* Requirements 6.1�?.7�?.9�?.13�?3.3�?3.5；design.md §9.2、�?3、J-21�?

  - [x] **7.3 实现组合根与内存端口替身**
    - **目标�?* 让全部端口可注入，使属性测试无需真实渲染器与真实内核�?
    - **实现范围�?* �?`src/ui/index.ts` 实现组合�?`createUiSystem(ports, profile)`，返回只读的查询与提交入口。在 `src/ui/__tests__/support/in-memory-ports.ts` 提供内存端口替身：`InMemoryProjectionPort`、`InMemoryActionPort`（可配置返回 `accepted`/`rejected`/`stale`）、`InMemoryEventPort`、`InMemoryRevisionPort`、`RecordingDiagnosticSink`；并提供**回放模式**�?`ActionPort` 替身：拒绝一切提交�?
    - **验收标准�?* 组合根不 import 任何具体上游实现；替身可独立驱动全部 UI 行为；回放模式替身拒绝所有提交；`src/ui/index.ts` 不出现写入标识符�?
    - **依赖�?* 2.1�?.2�?.3�?.4�?.2�?.2�?
    - **需求与设计引用�?* Requirements 8.3�?4.9；design.md §3、�?7、J-19�?

- [x] **8. 建立生成器与架构测试**

  - [x] **8.1 实现 fast-check 生成器，并防止属性测试空�?*
    - **目标�?* 生成器必须能造出真正的差异，否则属性测试会退化为重言式�?
    - **实现范围�?* �?`src/ui/__tests__/support/arbitraries.ts` 实现：`arbAgent()`；`arbReachableProjection()`�?*必须**�?合法初始状�?+ 一串合法动�?生成，不得凭空构造）；`arbHiddenVariantPair()`（先造共享可见基底，再对隐藏部分施加**保证非空**的变异；变异后隐藏部分相等的用例�?`fc.pre` 过滤掉）；`arbDescriptor()` �?`arbDamagedDescriptor(field)`；`arbLegalActionSet(size)`（覆�?0�?�?�? 及大规模）；`arbInputSource()`；`arbRevisionPair()`（含 `uncomparable` 情形）。实体标识从**固定小池�? 个）**取，使跨 Agent、跨窗口的标识碰撞成为常态�?
    - **验收标准�?* `arbHiddenVariantPair` 生成的两个世界的可见投影恒相等且隐藏部分恒不等；标识池大小为 8 且被复用；`arbReachableProjection` 产出的每个投影都可由动作序列复现；生成器自身有单元测试证明上述性质�?
    - **依赖�?* 7.3�?
    - **需求与设计引用�?* design.md「Testing Strategy / 生成器设计：避免测试空转」四条硬性要求�?

  - [x] **8.2 实现架构约束测试**
    - **目标�?* 用机械检查替代代码评审，保证只读性、解耦与术语纪律�?
    - **实现范围�?* �?`src/ui/__tests__/architecture.test.ts` 实现三组扫描（读�?`src/ui/**/*.ts` 源文本）�?
      1. `src/ui/**` 不出�?`OpRegistry`、`registerOp`、`defineQuery`、`invokeInline`、`prop.set`、`prop.add`，且�?import `src/l2/**` �?`src/core/**` 的具体实现模块（允许 import 类型与常量表）；
      2. `src/ui/animation/**` �?import `ActionPort`、`intent-factory`、`submit`、`KernelContract`�?
      3. `src/ui/**` 不出现废用术语——复�?`src/l2/model/constitution.ts` �?`REJECTED_LAYER_TERMS` �?`DEPRECATED_TERM_REPLACEMENTS`，做法与 `src/class/__tests__/architecture-terminology.test.ts` 一致�?
    - **验收标准�?* 三组扫描各自在人为注入违规样例时失败、在当前代码上通过；扫描覆�?`src/ui` 下全�?`.ts` 文件（含测试支撑文件，但排除本测试自身的模式常量）�?
    - **依赖�?* 7.3�?
    - **需求与设计引用�?* Requirements 4.1�?.4�?3.7�?4.9；design.md §5.1、�?6.1、Property 10�?

- [x] **9. 实现 24 个属性测试（必交付，一属性一文件，各 `numRuns` �?100�?*

  说明：文件路径统一�?`src/ui/__tests__/properties/pNN-<slug>.test.ts`；每个文件顶部注释为 `// Feature: wakeup-ui-animation, Property {N}: {property_text}`，`{property_text}` �?design.md 中该属性标题原文。每条属性的断言语句�?design.md「Correctness Properties」对应条目，此处不重复正文�?

  - [x] **9.1 Property 1 �?投影层不暴露可变引用**（`p01-projection-immutable.test.ts`）｜Requirements 2.6, 2.1｜依�?8.1
  - [x] **9.2 Property 2 �?描述符缺字段必然导致交互省略**（`p02-descriptor-missing-field.test.ts`）｜Requirements 2.5, 9.9｜依�?8.1
  - [x] **9.3 Property 3 �?玩家可见数值恒�?1�? 的整数域**（`p03-gameplay-value-domain.test.ts`）｜Requirements 10.1�?0.4｜依�?8.1
  - [x] **9.4 Property 4 �?内部度量不被当作玩法数值渲�?*（`p04-internal-metric-isolation.test.ts`）｜Requirements 10.7, 10.8｜依�?8.1
  - [x] **9.5 Property 5 �?任意呈现通道都不泄漏隐藏信息**（`p05-no-hidden-leak.test.ts`）｜Requirements 3.3, 3.4, 3.5, 12.3｜依�?8.1
  - [x] **9.6 Property 6 �?显著性分层由描述符决定且与规则可见性一�?*（`p06-salience-tier-consistency.test.ts`）｜Requirements 3.10, 3.14｜依�?8.1
  - [x] **9.7 Property 7 �?隐藏状态不产生任何可观察呈�?*（`p07-hidden-state-unobservable.test.ts`）｜Requirements 3.13, 6.14, 6.15｜依�?8.1
  - [x] **9.8 Property 8 �?仪式动画集合闭合且每项有来源**（`p08-ceremonial-set-closed.test.ts`）｜Requirements 6.4, 6.5, 6.7｜依�?8.1
  - [x] **9.9 Property 9 �?动画不影响语义状�?*（`p09-animation-does-not-affect-rules.test.ts`）｜Requirements 6.8, 7.1, 7.2, 9.10｜依�?8.1
  - [x] **9.10 Property 10 �?UI 目录不含写入标识�?*（`p10-no-write-identifiers.test.ts`）｜Requirements 4.1, 13.7, 14.9｜依�?8.2
  - [x] **9.11 Property 11 �?待决控件不产生第二个意图**（`p11-pending-single-intent.test.ts`）｜Requirements 5.1, 5.2｜依�?8.1
  - [x] **9.12 Property 12 �?过期状态必被检�?*（`p12-stale-detected.test.ts`）｜Requirements 5.3, 5.6, 2.8｜依�?8.1
  - [x] **9.13 Property 13 �?成功只由已提交投影确�?*（`p13-success-only-from-committed.test.ts`）｜Requirements 5.7, 4.7｜依�?8.1
  - [x] **9.14 Property 14 �?两个菜单面互斥且零费动作不受回合末限�?*（`p14-menu-faces-partition.test.ts`）｜Requirements 5.9, 5.10, 5.11｜依�?8.1
  - [x] **9.15 Property 15 �?表现计时器不改变规则语义**（`p15-countdown-rule-neutral.test.ts`）｜Requirements 5.12�?.14�?.24�?.10｜依�?8.1
  - [x] **9.16 Property 16 �?轮次栏保持全员在�?*（`p16-turn-order-bar-complete.test.ts`）｜Requirements 6.11, 6.12｜依�?8.1
  - [x] **9.17 Property 17 �?可选项集合不超�?5**（`p17-at-most-five-options.test.ts`）｜Requirements 11.7, 2.4｜依�?8.1
  - [x] **9.18 Property 18 �?无障碍等价物在呈现失败时仍存�?*（`p18-accessible-equivalent-on-failure.test.ts`）｜Requirements 11.10, 11.11｜依�?8.1
  - [x] **9.19 Property 19 �?无障碍标签缺失导致拒绝而非静默放行**（`p19-missing-label-rejects.test.ts`）｜Requirements 11.1, 9.9｜依�?8.1
  - [x] **9.20 Property 20 �?语义拒绝不被降级掩盖**（`p20-semantic-rejection-not-masked.test.ts`）｜Requirements 9.1, 9.10｜依�?8.1
  - [x] **9.21 Property 21 �?全量与增量收敛到同一视图**（`p21-full-and-incremental-converge.test.ts`）｜Requirements 15.1, 15.4, 8.1｜依�?8.1
  - [x] **9.22 Property 22 �?多窗口独立过�?*（`p22-multi-window-isolation.test.ts`）｜Requirements 3.8, 5.8, 8.4｜依�?8.1
  - [x] **9.23 Property 23 �?待汇合契约缺失是显式失败**（`p23-pending-contract-explicit-failure.test.ts`）｜Requirements 14.5, 1.4｜依�?8.1
  - [x] **9.24 Property 24 �?全知视角不由本地开关获�?*（`p24-omniscience-requires-authority.test.ts`）｜Requirements 3.9, 12.2｜依�?8.1

- [x] **10. 实现反向边界用例（确定性单元测试）**

  - [x] **10.1 直接改写语义状态的尝试被拒�?*
    - **实现范围�?* `src/ui/__tests__/reverse/mutation-attempt.test.ts`。对已验证投影与描述符的任意深度字段执行写入尝试，断言返回结构化拒绝且上游语义状态指纹不变�?
    - **验收标准�?* 尝试后指纹逐字符相等；返回码为 `PROJECTION_WRITE_REJECTED` �?`PROJECTION_NOT_FROZEN`�?
    - **依赖�?* 3.1。｜**引用�?* Requirements 16.1�?.6�?

  - [x] **10.2 绕过 UI 禁用直接提交仍被完整复校**
    - **实现范围�?* `src/ui/__tests__/reverse/bypass-disabled.test.ts`。跳�?`pending-registry` 直接调用 `ActionPort.submit` 提交待决意图与陈旧意图，断言权威侧仍执行完整当前状态复校�?
    - **验收标准�?* 陈旧意图返回 `stale`；非法意图返�?`rejected`；UI 禁用状态不影响复校结果�?
    - **依赖�?* 5.4�?.3。｜**引用�?* Requirements 5.2�?6.7�?

  - [x] **10.3 十条通路的隐藏信息提取尝�?*
    - **实现范围�?* `src/ui/__tests__/reverse/leak-channels.test.ts`。对 HUD、预览、不可用原因、动画选择、日志、调试面板、无障碍文本、音频、触觉、资源命名十条通路逐一尝试提取隐藏信息�?
    - **验收标准�?* 十条通路各有独立断言，全部无未授权披露�?
    - **依赖�?* 7.1�?.4�?.2。｜**引用�?* Requirements 16.3�?.3�?.5�?

  - [x] **10.4 表现参数不能改变语义与权威结�?*
    - **实现范围�?* `src/ui/__tests__/reverse/presentation-params-inert.test.ts`。改变布局值、动画时长、素材路径、帧率、性能目标，断言描述符语义与权威结果不变�?
    - **验收标准�?* 五类参数各有用例；动作标识、合法性、随机结果、已提交状态全部不变�?
    - **依赖�?* 7.2。｜**引用�?* Requirements 16.11�?.6�?

  - [x] **10.5 玩法专属编排与具体资源可替换**
    - **实现范围�?* `src/ui/__tests__/reverse/profile-replaceable.test.ts`。替换玩法专�?HUD 编排与具体资源，断言可复用描述符契约不变�?
    - **验收标准�?* 替换 profile 后描述符 schema 与动作标识不变；`rendererId` 不进入任何判定分支�?
    - **依赖�?* 7.2。｜**引用�?* Requirements 16.12�?3.4�?3.6�?.7�?

  - [ ] **10.6 �?Agent 可见性用�?*
    - **实现范围�?* `src/ui/__tests__/reverse/multi-agent-visibility.test.ts`。至少两个认知范围不同的非全�?Agent，加一个显式授权的全知 Agent�?
    - **验收标准�?* 两个非全�?Agent 的可见集合互不包含对方独有项；全�?Agent 需上游显式授权；本地开关无法获得全知�?
    - **依赖�?* 3.1�?.1。｜**引用�?* Requirements 16.9�?.9�?

- [x] **11. 变异自检：证明属性测试不空转**
  - **目标�?* 确认每条属性测试真的能抓到缺陷�?
  - **实现范围�?* `src/ui/__tests__/mutation/README.md` 记录变异清单与执行结果；对以下已知缺陷逐个注入并确�?*对应属性测试确实失�?*：删掉一次可见性过滤（应使 P5 失败）；去掉 `Object.freeze` 深冻结断言（P1）；�?`stale` �?`rejected` 合并（P12）；把仪式集合改成开放（P8）；�?`uncomparable` 当作 `same`（P12/P21）；把导航控件从预算中排除（P17）；�?`accessibleLabel` 空串当作有效（P19）；把语义拒绝转�?`warn`（P20、P2）；让零费面仅在预算耗尽后可用（P14）；把倒计时结束直接当作回合结束或把一人计时到期直接改写回合（P15）�?
  - **验收标准�?* 十项注入各自记录"注入位置 �?预期失败的属�?�?实际失败的属�?�?*任何注入后仍全绿的属性测试视为空转，必须重写该属性测�?*并重新验证。变异代码不得留在主分支�?
  - **依赖�?* 9.1�?.24�?
  - **引用�?* design.md「Testing Strategy / 生成器设计」第 4 条�?

- [ ] **12. 全量验证与交付确�?*
  - **目标�?* 以真实执行产物确认整套实现达标�?
  - **实现范围�?* 依次运行 `npm run typecheck`、`npm run lint`、`npm test`；用 `npx vitest list --run` 核对 `src/ui/__tests__/properties/` 下被收集的测试文�?*恰好 24 �?*（该路径前缀必须显式限定——仓库中另有 `test/properties/**` 属于 l2-base-layer-spec，两者不得混计）；确认每个属性测试的 `numRuns` �?100；用另一�?profile（改布局、改资源、改动画时长）重跑整套属性测试�?
  - **验收标准�?* 三条命令全绿；`src/ui/__tests__/properties/` 收集数恰�?24 且无"文件存在但未被收�?的条目；�?profile 后整套属性测试仍全绿—�?*若任何属性因�?profile 而失败，说明该属性依赖了可替换表现配置，必须改设计而不是改测试**�?
  - **前置阻塞（非�?Spec 引入）：** 截至 2026-08-08，`npm run typecheck` �?`test/properties/P12-unified-submission-single-write-channel.property.test.ts:149` 的语法错误（TS1005）而失败，`npm run lint` �?23 �?error（位�?`src/l2/**`、`src/play/**`）。这两项属于 l2-base-layer-spec �?meta-mechanism-kernel 的范围，**必须先由对应 Spec 修复**，否则本任务�?三条命令全绿"无法达成。本 Spec 不得为绕过它们而修改其�?Spec 的产物�?
  - **依赖�?* 8.1�?1�?
  - **引用�?* Requirements 16.1�?6.13；design.md「Testing Strategy」�?

---

## 覆盖核对�?

| Requirement | 实现任务 | 验证任务 |
|---|---|---|
| 1 来源优先级与层级归属 | 1.6, 7.2 | 8.2, 10.5 |
| 2 只读投影与描述符完整�?| 1.1, 3.1, 4.1 | 9.1, 9.2, 9.12, 10.1 |
| 3 Agent 可见性与防泄�?| 3.1, 3.4, 4.4, 4.5, 7.1 | 9.5, 9.6, 9.7, 9.22, 9.24, 10.3, 10.6 |
| 4 交互意图与唯一写入通道 | 0, 2.2, 5.1, 5.2, 5.4 | 9.10, 9.13, 8.2 |
| 5 输入禁用、重复提交与过期交互 | 3.2, 5.3, 5.4, 5.5 | 9.11, 9.12, 9.13, 9.14, 9.15, 10.2 |
| 6 视觉配置、颜色与节奏呈现 | 1.6, 5.5, 6.2, 7.2 | 9.8, 9.9, 9.15, 9.16, 10.4 |
| 7 动画与规则结果解�?| 6.1, 6.2 | 9.9, 9.10, 8.2 |
| 8 异步、回放、回退与多窗口 | 3.2, 3.3, 6.1, 7.3 | 9.21, 9.22 |
| 9 语义拒绝与非语义降级 | 4.1, 4.2, 4.3 | 9.2, 9.19, 9.20 |
| 10 玩家可见数值与内部指标隔离 | 1.4, 1.5 | 9.3, 9.4 |
| 11 可访问性与输入等价 | 4.3, 5.1, 1.5 | 9.17, 9.18, 9.19 |
| 12 日志、诊断与调试面板安全 | 7.1 | 9.5, 9.24, 10.3, 10.6 |
| 13 描述符与 profile 边界 | 0, 7.2, 1.6 | 9.10, 10.5 |
| 14 �?Spec 只读依赖与汇合失�?| 2.3, 4.4 | 9.23, 8.2 |
| 15 首帧、全量重绘与增量一致�?| 3.2, 3.3 | 9.21 |
| 16 可验证性与反向边界测试 | �?| 8.1, 8.2, 9.1�?.24, 10.1�?0.6, 11, 12 |

---

## 本计划的自主判断（待人工复核�?

以下是编写本计划时所作的判断，需要人工确认。design.md §「自主设计判断与人工复核清单」中�?J-1—J-22 同样适用，此处只�?*计划层面**新增的判断�?

| 编号 | 判断 | 理由 | 若判断不成立的影�?|
|---|---|---|---|
| T-1 | 测试放在 `src/ui/**/__tests__/`，不建独�?`test/` 目录 | `src/**` 是当前唯一�?vitest、tsc、eslint 三者同时覆盖的位置（见「执行约定」覆盖矩阵）。`test/l2/**` 会丢失类型检查与静态检查，`test/properties/**` 会丢失静态检�?| 若坚持独立目录，必须同时�?`vitest.config.ts`、`tsconfig.json` �?lint 脚本三处，本计划需新增前置任务；否则会出现"写了却不被检�?的失效形�?|
| T-2 | 任务粒度�?模块 + 单一职责"切分，共 12 �?| 每组可独�?typecheck/lint/test，便于逐步验证 | 若需更细的验收节奏，可再�?9.x �?10.x |
| T-3 | 属性测试统一�?`src/ui/__tests__/properties/`，与模块测试分开 | 24 条属性是跨模块的端到端断言，按模块分散会导致重复搭建替�?| 若要求属性测试贴各自模块，需重排 9.x 路径 |
| T-4 | 变异自检（任�?11）作为独立交付任务而非附带检�?| 属性测试空转是本类规范最常见的失效形态，不单独立项容易被跳过 | 若认为过重，可合并进 12，但会削弱空转防�?|
| T-5 | 任务 12 要求"换一�?profile 重跑整套属性测�? | 这是 Requirement 16.12 唯一可机械执行的兑现方式 | 需额外维护一份测试用 profile |
| T-6 | 内存端口替身�?`src/ui/__tests__/support/` 而非 `src/ui/testing/` | 替身只服务测试，放进产品目录会让它进�?lint 与类型检查的产品范围 | 若希望对外提供测试工具（如内�?`testing/` 的做法），应移入 `src/ui/testing/` |
| T-7 | 架构扫描以源文本匹配实现，而非 AST 分析 | 与现�?`src/class/__tests__/architecture-terminology.test.ts` 做法一致，无需新增依赖 | 文本匹配可能误报注释中的标识符，需在扫描时排除注释或显式加白名�?|
| T-8 | 「执行约定」采用实测配置，而非任务分派时给出的口径 | 分派时的口径�?`vitest.config.ts` �?include `src/**/*.test.ts`、tsconfig �?include `src`"�?026-08-08 实测已变为三�?include �?`["src","test/properties"]`。规范若沿用过期口径会给出错误的位置论证 | 结论（测试放 `src/ui/**`）不变，�?*论证依据变了**：从"别处不会被执�?改为"别处会丢失类型检查或静态检�?。若配置后续再变，需重核该矩�?|
| T-9 | 新增任务 0：把 `src/ui/**` 加入 eslint 渲染层边界规�?| 项目已用 lint 强制 `src/scene`/`src/components` �?import `kernel/ops`/`kernel/state`；本 Spec 的同类边界若只靠自建架构测试，强度与既有做法不一�?| 这是本计划唯一的配置改动。若被判定不必要，Property 10 的保障退回到仅由任务 8.2 的架构测试提�?|
| T-10 | 端口�?design.md §3.0 绑定�?*已实�?*的上游，而非停留在抽�?| `uiDescriptor` / `submitUiAction` / `submit` / `createProjection` / `PresentationGateway` 均已落地，继续把它们�?待汇�?会造成规范与代码脱�?| 若上游签名变动，需同步 §2.1 �?§3.0 的绑定表 |
| T-11 | 新增任务 3.4：在 UI 端口边界实现单一 Agent 过滤�?| `PresentationGateway` 实测不按 Agent 过滤（C-5），�?Requirement 3.1/3.2 要求所有读取受 `visibleTo` 约束。不补则整个防泄漏体系失去基础 | 这是**防御性补�?*，不是对引擎层缺口的修复；引擎层修复后本模块应退化为薄封装并复核是否仍需�?|

## 阻塞依赖（不属本计划范围，需上游先行�?

以下任务在对应上游能力汇合前只能实现�?端口 + 显式失败"的程度，**不得**用本地实现替代（Requirement 14.5）：

1. `State_Revision` �?`sequence` 段绑�?—�?依赖引擎层把 `world.logSeq` 暴露到投影（任务 1.1 已按端口抽象，可先落地）
2. `Rule_Event_Projection` 安全字段白名单键�?—�?依赖 `core` 汇合（任�?1.2 的白名单机制可先落地�?
3. 不可用原因映射键 —�?依赖基类层补充字段（任务 4.4 已按 `ConvergenceResult` 表达缺失�?
4. `PresentationDescriptor` 与投影修订的绑定字段 —�?当前描述符只�?`scopeId`，无法自证对应哪个修订（任务 3.1 �?UI 侧配对封装）
5. **`PresentationGateway` 未按 Agent 过滤（design.md C-5，安全相关，优先级最高）** —�?`src/core/kernel/gateway.ts` �?`query` 不强制注�?`visibleTo`，`subscribe`/`dispatch` 原样投�?payload 且支�?`'*'` 通配订阅，与 meta-mechanism-kernel design §3.15、要�?40.1/40.5 不符。本 Spec 已在端口边界防御性收窄（任务 2.1�?.4），**但这不构成对该缺口的修复**；建议作为引擎层缺陷单独立项
6. **`ActionDescriptor.targets` 恒为 `[]`（design.md C-6�?* —�?`src/l2/adapters/ui-adapter.ts` 硬编码空数组。本 Spec 改用 `PresentationGateway.queryActions` 返回�?`LegalAction.bindings` 作为目标绑定来源；`targets` 将来填充后需裁决二者主从关�?
7. `core` / `space-items` / `AI` 三方的字段级只读描述�?—�?仍待�?Spec 汇合

**已解除的原阻塞项**（并行工作于 2026-08-08 前落地）：`UI_Adapter`（`uiDescriptor`）、统一提交（`submit` / `submitUiAction`）、只读投影（`createProjection`）、注册表（`definition-registry`）、`PresentationGateway` 本体、`accessibleLabel` 回退（已实现 `actionId` 回退，见 C-7）。任�?7.3 的内存替身仍保留——属性测试需要可控替身，不依赖真实上游�?

你是 WakeUp 项目「专项 B — 整合层本体（integration-layer / loading-runtime）」的立项认领者。工作目录 D:\coding\WakeUp。本任务补全宪法依赖链终点「已装载对局」的**生产装配面**：把引擎/玩法/AI/UI/地图按既有稳定端口组合成一台可被玩家、玩家、AI、运营共同驱动的对局运行时。它属于玩法层（`src/play/loading-runtime/`），不是第四层、不新写规则语义。

【开工前必读（自上下文读，不可靠记忆）】
- 总规划与面貌/技术/边界：`docs/L_归档/工程治理_历史/04_整合层_装载运行期_规划设计.md`（§一~§三全部、§四专项 B 阶段路径 1-6、§五 已裁决策；04 规划文档已完成使命归档，专项 B 交付 + spec 落账见 `.kiro/specs/wakeup-loading-runtime/`）。
- 玩法层补全契约（专项 A/CEME，**已冻结**，你消费它的结局/终局/胜负/参与者/出生/round 语义）：`src/play/core-mechanics/defs/*`、`.kiro/specs/wakeup-core-mechanics-exhaustive/{requirements,design,tasks}.md`（尤其 outcomes 守恒集、matchEnded 终局判定字段、只读终局/胜负查询、参与者装载期自动注册、round 计数、出生起点装配）。
- 基类层注册表桥（专项 D，**已落地**）：`src/l2/kernel/registry-bridge.ts`（`createRegistryBridge`，真实 OpRegistry→KernelContract + 只读 Def 视图），契约测试 `test/l2/integration/registry-bridge.contract.test.ts` 8 绿。你把它 `as unknown`/只读消费进 loading-runtime 的 kernel 端口。
- 宪法/架构域/裁决：`docs/L0_规范宪法.md`、`docs/00_架构域与文档分类.md`（严格三层、已装载对局终点非第四层、正交域 not import 表现/创作）、`docs/访谈决策记录.md` D-063/D-067~D-070。
- 组装用既有能力（只读复用，不重写）：`src/core/kernel/testing/full-harness.ts:80` `createFullHarness`（引擎组合根能力子集）、`src/play/core-mechanics/load.ts`（`loadCoreMechanics`:458 8 步、`CoreMechanicsRuntime`:152、`CoreMechanicsFacade`:532）、`src/play/ai-runtime.ts:174` `createPlayAiRuntime`、`src/ui/index.ts:63` `createUiSystem` + `UiSystemPorts`:32、`src/core/kernel/gateway.ts` `PresentationGateway.subscribe('*')`（86-95）、`src/core/kernel/index.ts:60` `createEmptyWorldState`、`src/play/map/compile.ts:89` `compileMap`、`state-machine-load-driver.ts`（走向生产化装载驱动的样板）。

【唯一产出与交付物（整块新建，落 `src/play/loading-runtime/` + `test/play/loading-runtime/`）】
1. **生产组合根 `createLoadedMatch(loadRequest): LoadedMatch`**
   - 引擎面：真实 OpRegistry/DefRegistry/WorldStateHolder/ExprEngine/QueryEngine（复用 createFullHarness 能力子集，装配与测试组合根字节级一致——见 Q-4，不重写两套）。
   - 门禁面：用生产 `defaultCoreMechanicsConfig`（玩法层/专项 A 提供，非 official-test config）调 loadCoreMechanics 8 步 → `{ok,diagnostics,projection,blocked}`，失败不返回半可用对象。
   - 外壳面：挂对局外壳 `MatchShell`（见 2）。
   - 演员面：玩家 participant 装载期注册（消费专项 A 的参与者自动注册）+ createPlayAiRuntime 接入同 holder/registry；AI 经 CoreMechanicsFacade 提交通一判罚路径。
   - 地图面：compileMap → PrefabDef → prefab.spawn 入 world（消费现有 MapData 契约，floor→layers 契约扩展是独立专项不代做）。
   - UI 面：绑定 UiSystemPorts 七端口到真实 holder/actionCatalog/facade + 注册表桥产 KernelContract 包裹的 action-submitter（承接专项 D 宿注入点）。
   - 返回：单一 LoadedMatch（只读门面 + 授权提交通道 + 事件订阅 + 外壳控制）。装载完成后唯一写通道仍是 OpRegistry.invoke，宿主不得持 holder 直接改。
2. **对局外壳 `MatchShell`（整款新建）**：回合号（round + phase）、终局判定（消费专项 A 的终局查询 `matchEnded` + 终结详情）、胜负结算（消费专项 A 的胜负查询）、终局事件；经 PresentationGateway.subscribe('*') 发声；终局=ended 后对外态切 ended、拒绝提交。参照 BattleRoyaleMode 的 spawn/victoryCondition/circle 概念草稿，只借鉴胜负声明式不照搬。
3. **UI 宿主侧实现**：`createUiSystem` 的 7 端口真实实现与接线（含读语义投影、事件订阅、actionQuery、revision、actions→CoreMechanicsFacade.submit、pendingContract、diagnostics）。
4. **契约测试**（落 `test/play/loading-runtime/`）：组合根装载成功/门禁体面/失败原子；与 createFullHarness 装配字节级一致；UI/AI/玩家同一判罚路径；外壳终局/ended/拒绝提交；registration bridge 只读消费无负作用。配 `*contract*` 断言 + PBT。

【必须遵守的边界（对你无贡献，宁少勿缺）】
- **绝不改 `src/play/core-mechanics/defs/*`、`src/play/ai-runtime.ts`、`src/ui/**`、`src/l2/**`、`src/core/**`**——这些是已冻结/已交付的上游。loading-runtime 只 import 它们的稳定导出。
- 不 import `src/ui`、`src/devboard`（UI 由表现系统经端口被注入，不是 loading-runtime 拉起）；不新造 L1↔L2 桥（专项 D 已交付，你消费）；不做 MapData floor→layers 契约扩展（独立专项）。
- 唯一写通道 `OpRegistry.invoke`；终局 1-5 数值、round 内部值例外。
- 不建 `src/integration`（第四层误读风险）、不建 `src/runtime/`——模块名落 `src/play/loading-runtime/`（owner 已裁 Q-1）。

【门禁与收尾】
- `npx tsc --noEmit`（全域 0 err）+ `npx vitest run`（相关范围，含你的契约测试 + 不破坏既有 3254/全量）+ `npm run lint` + `npm run verify:docs`。
- 阶段路径按 §四专项 B 1-6 推进；跨批次依赖：对局外壳（3）先于 UI/地图（4/5）。
- 收尾综述如实列：组合根从无到有、外壳/UI 宿主落地、桥/参与者/AI 接线点分别被哪里消费、哪些保持为消费方后续接线项；不得谎报完成。整合层是"串起来"，不是再写一套规则。

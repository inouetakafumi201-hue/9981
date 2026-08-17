你是 WakeUp 项目「专项 D — 基类层注册表桥」的立项认领者。工作目录 D:\coding\WakeUp。本任务只做一件事：为 L2 的 UI/AI 适配器（它们消费 `KernelContract`/`ActionCatalog`/`ActiveRegistry`）**补上从真实 L1 `OpRegistry`/`DefRegistry` 到 L2 稳定端口的「生产装配点 + 契约测试」**，让这座桥从"类型已冻结、生产调用为 0"落地为"可用真实引擎实例产出并验证"的稳定端口。它属于基类层去向，**不补玩法语义**。

【开工前必读（自上下文读，不可靠记忆）】
- 缺漏定义与现状核验：`docs/工程治理/05_玩法层彻查CEME_立项轮廓.md` §四·补（含今天实测的"生产调用点=0"证据）。
- 桥归属与承接链：`docs/L_归档/工程治理_历史/04_整合层_装载运行期_规划设计.md` §2.2、§2.3 承接链、§五 Q-5（04 规划文档已完成使命归档）。
- 宪法/架构域：`docs/L0_规范宪法.md`、`docs/00_架构域与文档分类.md`（严格三层、L2 不反向依赖引擎实现、唯一写入通道 OpRegistry.invoke）。
- L2 既有稳定端口与冻结事实：`src/l2/决策与风险记录.md`（154-155 行的 `KernelContract`/`createKernelContractFromOpRegistry` 冻结行）、`src/l2/kernel/kernel-contract.ts`、`src/l2/kernel/op-registry-adapter.ts`、`src/l2/registry/action-submitter.ts`（`submit` 消费 KernelContract）、`src/l2/adapters/ui-adapter.ts`、`src/l2/adapters/ai-adapter.ts`（现仅 type import KernelContract）。
- 参考已有的"桥式装配 + 契约断言"样板：`src/core/ugc/integration/l2-adapter.ts` + `l2-port-contract.ts`（消费方运行期契约检查，本桥是同一精神的 L2 向）。

【唯一产出与交付物】
1. 一个**生产装配点**文件（落基类层，如 `src/l2/kernel/registry-bridge.ts` 或你认为更贴切的基类层文件），用**真实** `OpRegistry`（含 `invoke`/`has`）、`DefRegistry`（解析 `def`）与 `runtimeState`/`hookIntegrationAvailable`/`recordCause` 等真实依赖，调用 `createKernelContractFromOpRegistry` 产出工程内置 `KernelContract`，并暴露给 UI/AI 适配器与 action-submitter 使用。实现细节按你读到的既有契约来，不发明新写通道。
2. 一致的 DefRegistry 桥：把已解析 `ResolvedDefinition` 以 L2 契约形状（`ActiveRegistry`/解析定义）暴露给适配方，保持只读、不重复维护第二套解析逻辑（复用 `definition-registry.ts` 的解析产物，不在桥里重写）。
3. **契约测试**（落 `test/l2/integration/`，如 `registry-bridge.contract.test.ts`），断言至少：
   - `invoke` 只在**真实** `OpRegistry.invoke` 走一次（单通道，无本地旁路）；
   - `hasOp` 反映真实 `registry.has`；`DefRegistry` 解析反映真实解析器；
   - 错误 map 后的 `code/detail` 原样透传（不重写、不吞）；`classifyKernelErrorCode` 归类正确；
   - `hookIntegrationAvailable` 不伪造；为 false 时依赖 Hook 的动作被拒（`action-submitter` 门禁）；
   - 与既有 `P12-unified-submission-single-write-channel`、`end-to-end.integration.test.ts` 的精神一致：真实动作链只走 OpRegistry.invoke 一次。

【必须遵守的边界（对你无贡献，宁少勿误）】
- 桥是**基类层稳定端口**，不是玩法层、不是整合层本体；你不得 import `src/play/**`、`src/ui/**`、`src/core/ugc/**` 的实现。
- **不得碰 `src/l2/ugc/ports/registry-gateway.ts`**（wakeup-ugc 消费 l2 注册表的 CAS 外壳，是另一条已开发区，非本任务；只读参考其"消费 l2 激活"方式即可，不重造）。
- 不改 `src/core/**`、`src/play/**`；不改 `KernelContract`/`createKernelContractFromOpRegistry` 的既有冻结签名（它们已冻结，159 行决策记录不可回头）。
- 唯一语义写入通道仍 `OpRegistry.invoke`（经 KernelContract）；桥不新增第二写分支。
- 不跨线修 `ui-adapter-standalone/悬空`：适配器未接好是消费方接线，你可以 export 你的装配点、登记衔接，但不在本专项直接改 `src/ui/**`。

【门禁与收尾】
- `npx tsc --noEmit`（全域 0 err）+ `npx vitest run`（相关范围，至少你的新契约测试绿）+ `npm run lint` + `npm run verify:docs`。
- 每个改动附可测试验收；PBT/集成测试对齐既有 `test/l2/integration/` 风格。
- 收尾综述如实列明：桥从"0 生产调用"变"被哪里引用/装配"、哪些无法在基类层内自证、哪些是消费方后续接线项；不得谎报完成。修为基类层动作，整合层/玩法层只消费、不代做。

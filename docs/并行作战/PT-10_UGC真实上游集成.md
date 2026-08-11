# PT-10：WakeUp UGC 真实上游集成

> **前置依赖**：PT-02（l2 端口已交付）、wakeup-ugc 任务 10 完成（16 个性质测试全绿）
> **就绪确认**：PT-02 已完成（`src/l2/ugc/ports/` 已交付），wakeup-ugc 本地性质全部通过
> **并行边界**：与 PT-08b 可并行（目录不冲突）
> **生成时间**：2026-08-11

---

## 一、背景与权威依据

### 1.1 跨 Spec 契约（已交付，PT-02，2026-08-10）

- **契约文档**：`docs/L_审查报告/跨Spec契约_wakeup-ugc消费l2端口.md`（方案 A 已落地）
- **交付物**：`src/l2/ugc/ports/`，入口 `createL2PortBundle()`（`port-bundle.ts`）
- **验收状态**：`tsc --noEmit` 0 错、`vitest run` 2158 全绿、`eslint` 0 错

### 1.2 四个冻结端口（l2 侧已实现）

| 端口 | 文件 | 状态 |
|------|------|------|
| `DefinitionValidationGateway` | `validation-gateway.ts` | ✅ 复用 `validateFullPackage` |
| `ReferenceResolutionGateway` | `resolution-gateway.ts` | ✅ 重建工作图 + 入边闭包重验 |
| `DefinitionRegistryGateway`（含 CAS） | `registry-gateway.ts` | ✅ 按层各一份，CAS 比对 `definitionRegistryVersion` |
| JSON_Codec | 不需 l2 实现 | ✅ UGC 自持 `canonicalJson`/`decodedValue` |

### 1.3 已完成的 wakeup-ugc 任务（本线前置）

- [x] 任务 1–9：UGC 公共模型、端口、配额、解码、迁移、规范化、契约、验证流水线、Facade、Test Interface
- [x] 任务 10：16 个性质测试（P1–P16）全部通过
- [x] 任务 11.1：`src/core/ugc/integration/l2-adapter.ts` 已完成（仅消费冻结端口，薄装配器）
- [ ] 任务 11.3：真实基类层端口 full-pipeline 测试（本线核心交付，当前部分阻塞见 §1.4）

### 1.4 当前阻塞（已部分解除，仍有残余）

- **已解除**：l2 端口已冻结（PT-02 完成），UGC 本地性质全通过（任务 10 完成）
- **残余阻塞**：**l2 尚未冻结规范玩法包验证契约**，当前 `DefinitionValidationGateway` 复用基类定义包校验，不能把基类包写入 play registry 冒充 valid play candidate
- **缓解**：任务 11.3 可先完成 valid base candidate 场景；valid play candidate + 跨层组合场景待 l2 玩法包契约冻结后补齐

---

## 二、就绪确认（开工前必须全部满足）

### 2.1 上游依赖已交付

- [x] PT-02 已完成（`src/l2/ugc/ports/createL2PortBundle` 已交付并通过 `inspectL2PortBundle`）
- [x] wakeup-ugc 任务 1–10 已完成（本地性质全绿，Facade 与 Test Interface 已就位）
- [x] 任务 11.1 已完成（`l2-adapter.ts` 薄装配器已完成）
- [x] 共享诊断形状已扩展（任务 1.3，`Diagnostic` 的 `at`/`path` 可空契约已冻结）

### 2.2 契约文档已冻结

- [x] `docs/L_审查报告/跨Spec契约_wakeup-ugc消费l2端口.md`（§二、§三、§四 已全部确认）
- [x] 端口签名以 `src/core/ugc/ports/*.ts` 为准（l2 侧 `import type` 复用）
- [x] `decodedValue → DefinitionPackage` 映射约定已明确（§三）
- [x] 诊断投影约定已明确（§四，l2 Diagnostic → 内核 Diagnostic）

### 2.3 并行冲突已排除

- [x] PT-08b（space-items）只写 `src/l2/**` 和 `test/l2/space-items/**`，不动 `src/core/ugc/**`
- [x] PT-09（UI/Animation）不动 `src/core/ugc/**`
- [x] `src/core/ugc/integration/` 当前无活跃编辑会话

---

## 三、白名单（本线允许修改的路径）

### 3.1 UGC 集成代码（核心交付）

```
src/core/ugc/integration/l2-adapter.ts  # 已完成（任务 11.1），可能需微调
src/core/ugc/integration/l2-port-contract.ts  # 端口契约接口（已存在），不修改
src/core/ugc/integration/__tests__/l2-port-contract.test.ts  # 零耦合守卫（已存在，6 个测试）
```

### 3.2 集成测试（核心交付）

```
src/core/ugc/__tests__/integration/full-pipeline.integration.test.ts  # 真实基类层端口场景（任务 11.3 核心）
src/core/ugc/__tests__/integration/adversarial-input.integration.test.ts  # 恶意输入（任务 11.4）
src/core/ugc/__tests__/integration/failure-injection.integration.test.ts  # 故障注入（任务 11.5）
src/core/ugc/__tests__/integration/*.integration.test.ts  # 其他集成场景（如 runtime 边界，任务 11.6）
```

### 3.3 共享诊断同步（若需）

```
src/core/kernel/state/diagnostic.ts  # 若任务 11.2 发现需补共享 hint，修改此文件（需跨 Spec 协调）
src/core/kernel/state/error-codes.ts  # 若需补 `E_QUOTA_MIGRATION_STEPS`（任务 1.3 的唯一缺口），修改此文件
src/l2/model/diagnostic-codes.ts  # 诊断码映射（l2 侧，若需同步）
```

### 3.4 文档记录

```
.kiro/specs/wakeup-ugc/tasks.md  # 更新任务 11.1/11.3 复选框为 [x]
src/core/ugc/决策与风险记录.md  # 若有，记录集成期自主判断
docs/L_审查报告/跨Spec契约_wakeup-ugc消费l2端口.md  # 若需，更新 §七 当前状态
```

---

## 四、黑名单（本线禁止修改的路径）

### 4.1 l2 提供方（修改需写交接项）

```
src/l2/ugc/ports/**  # 端口实现（PT-02 交付物），本线只消费不修改
src/l2/**  # l2 其他模块（PT-08b 等其他线专属）
```

### 4.2 UGC 核心管线（已冻结）

```
src/core/ugc/model/**  # 候选/请求/结果模型（任务 2.1）
src/core/ugc/ports/**  # 端口接口定义（任务 2.2）
src/core/ugc/quota/**  # 配额（任务 3.1）
src/core/ugc/codec/**  # 解码器（任务 3.2–3.3）
src/core/ugc/migration/**  # 迁移（任务 4.1–4.2）
src/core/ugc/canonical/**  # 规范化（任务 4.3）
src/core/ugc/contracts/**  # 契约目录（任务 5.1）
src/core/ugc/baseline/**  # 验证基线（任务 5.2）
src/core/ugc/validation/**  # 验证协调器（任务 6.2–6.5）
src/core/ugc/presentation/**  # 表现回退（任务 7.1–7.2）
src/core/ugc/activation/**  # 原子激活（任务 8.1–8.3）
src/core/ugc/facade/**  # 公共 Facade（任务 9.1）
src/core/ugc/testing/**  # Test Interface（任务 9.2）
src/core/ugc/__tests__/properties/**  # 16 个性质测试（任务 10，已全绿）
```

### 4.3 共享工具链配置

```
tsconfig.json  # 不得修改
vitest.config.ts  # 不得修改
package.json  # 不得新增依赖
.eslintrc.cjs  # 不得修改规则
```

### 4.4 其他 Spec 代码

```
src/play/**  # 玩法层
src/ui/**  # 表现系统
src/class/**  # 目录数据（PT-08b 等修改）
```

---

## 五、行为契约（执行纪律）

### 5.1 端口契约遵守（铁律）

- **只消费冻结端口**：`src/l2/ugc/ports/index.ts`，不 import l2 内部实现文件
- **薄装配器**：`l2-adapter.ts` 只做 `createL2PortBundle()` → `inspectL2PortBundle()` → 装配 `ValidationCoordinator`/`AtomicActivationCoordinator`/`UGCIngressFacade`
- **不做语义转换**：端口形状已由契约固定，适配器不额外转换领域字段
- **零耦合守卫**：`l2-port-contract.test.ts` 的「零 l2 耦合」用例必须保持全绿

### 5.2 不做 MVP、不用替身伪装完成

- 任务 11.3 必须使用**真实 l2 端口**（`createL2PortBundle` 的真实实现），不得用测试替身（mock/stub）
- **不得**用"端口替身测试通过"宣称集成完成
- valid play candidate 场景若因 l2 玩法包契约未冻结而阻塞，明确标记"待 l2 玩法包契约冻结"，不强行伪造

### 5.3 故障注入纪律（任务 11.4–11.6）

- 故障注入**仅替换端口返回/异常**，不得 mint artifact、跳过 quota 或直接改 registry
- 每个注入点必须有"scope-correct diagnostics、skipped checks、零后续非法调用、旧快照保持"四项断言
- 恶意输入测试必须测量**可观察 work counters**（不得只依赖超时作为安全断言）

### 5.4 诊断同步纪律（任务 11.2）

- 若需补共享 hint，先在 `src/core/kernel/state/error-codes.ts` 的 `HINT_TEMPLATES` 补齐，再更新消费者
- 若需补 `E_QUOTA_MIGRATION_STEPS`，需跨 Spec 协调（引擎层错误码归属内核）
- **不得**用 UGC 私有诊断类型绕过共享 `Diagnostic` 形状

### 5.5 工具链纪律

- 每完成一个任务后运行 `npm run typecheck` && `npm test` && `npm run lint`
- 任一命令失败则修复后才能继续
- **不得**通过 skip、过滤、改断言或降级 severity 掩盖失败

### 5.6 并行守卫

- 开始修改前运行 `git status --porcelain`，确认白名单路径无未提交变更
- 发现 l2 端口文件有未提交变更时停止本线，报告冲突

---

## 六、Definition of Done（DoD）

### 6.1 核心交付（任务 11.1/11.3）

- [x] 任务 11.1 已完成：`src/core/ugc/integration/l2-adapter.ts` 已实现薄装配器
- [ ] 任务 11.3 已完成：`full-pipeline.integration.test.ts` 覆盖以下场景（**真实 l2 端口**）：
  - [ ] valid base candidate（add/replace/remove）
  - [ ] valid play candidate（待 l2 玩法包契约冻结，当前标记阻塞）
  - [ ] unknown field（Schema 严格性）
  - [ ] duplicate ID（身份唯一性）
  - [ ] typed cross-domain reference（跨领域引用）
  - [ ] override/remove（覆盖与删除）
  - [ ] old Schema migration（版本迁移）
  - [ ] presentation fallback（表现回退 + warning）
  - [ ] warning-only activation（只含 warning 的成功激活）
  - [ ] canonical snapshot（快照一致性）
  - [ ] 每个 rejected case 断言 registry/graph/snapshot 指纹不变
  - [ ] 每个 success 断言完整变化一次可见

### 6.2 恶意输入与故障注入（任务 11.4–11.6）

- [ ] 任务 11.4 已完成：`adversarial-input.integration.test.ts` 覆盖：
  - [ ] 深层/宽对象
  - [ ] 重复成员
  - [ ] 超大字符串
  - [ ] reference fan-out
  - [ ] migration bomb
  - [ ] diagnostic flood
  - [ ] canonical output bomb
  - [ ] 每类攻击断言可观察 work counters 不超过 quota 上界
  - [ ] 无未捕获异常/stack overflow
  - [ ] 无部分状态

- [ ] 任务 11.5 已完成：`failure-injection.integration.test.ts` 在以下阶段注入失败：
  - [ ] decode
  - [ ] migration
  - [ ] canonicalize
  - [ ] baseline
  - [ ] validator
  - [ ] resolver
  - [ ] fallback
  - [ ] commit precheck
  - [ ] registry commit
  - [ ] 每个注入点断言 scope-correct diagnostics、skipped checks、单次 root linkage、零非法调用、旧快照保持

- [ ] 任务 11.6 已完成：运行时边界与兼容转交测试
  - [ ] UGC public API 无 WorldState、OpRegistry、Hook、transaction、journal、checkpoint、persistence writer（静态扫描 + spy）
  - [ ] runtime compatibility 声明只触发已有 gateway
  - [ ] newer-save/active-match replacement 拒绝原样保留
  - [ ] 候选不能声明 executable migration transform

### 6.3 共享诊断同步（任务 11.2）

- [ ] 所有已批准错误码的共享 hint 已补齐
- [ ] `checkHintCompleteness` 对所有启用代码为空
- [ ] DiagnosticSink 去重不折叠不同 definition/path/source 的 UGC 错误
- [ ] fatal `E_INV_*` 不可被候选或玩法包覆盖

### 6.4 工具链门禁

- [ ] `npm run typecheck` 退出码 0
- [ ] `npm test -- src/core/ugc/__tests__/integration` 退出码 0（集成测试全绿）
- [ ] `npm test` 退出码 0（全量测试全绿，包括 16 个性质）
- [ ] `npm run lint` 退出码 0（0 error，warning 不增加）
- [ ] `l2-port-contract.test.ts` 的 6 个测试全绿（零耦合守卫保持）

### 6.5 覆盖审计（任务 12.1–12.3，全量验收）

- [ ] requirements 1–16 每组至少一个真实端口场景
- [ ] 每个报告包含 candidate/baseline/snapshot identity
- [ ] 安全与架构反向审查清单逐项有代码/测试证据
- [ ] 不存在未记录的高风险或阻断项
- [ ] trace audit 零缺口（requirements/design/tasks 三向追踪）
- [ ] 所有未决边界有 owner、阻断能力、失败代码、下一步证据

---

## 七、回流检查（完成后必做）

### 7.1 冲突检测

```bash
git status --porcelain | grep -E '^(UU|AA|DD)' && echo "CONFLICT DETECTED" || echo "No conflicts"
```

### 7.2 类型检查

```bash
npm run typecheck
```

### 7.3 集成测试专项

```bash
npm test -- src/core/ugc/__tests__/integration --reporter=verbose
```

### 7.4 全量测试门禁

```bash
npm test  # 必须包括 16 个性质 + 集成测试全部通过
```

### 7.5 零耦合守卫

```bash
npm test -- src/core/ugc/integration/__tests__/l2-port-contract.test.ts
# 断言「has zero coupling to src/l2 while the base layer is unfrozen」仍通过
```

### 7.6 Lint 门禁

```bash
npm run lint
```

### 7.7 生成差异报告

```bash
git diff --stat origin/master -- src/core/ugc/integration src/core/ugc/__tests__/integration | tee ugc-integration-diff-summary.txt
```

### 7.8 更新任务清单

- 将 `.kiro/specs/wakeup-ugc/tasks.md` 任务 11.1 的复选框改为 `[x]`（已完成）
- 将任务 11.3 的复选框改为 `[x]`（或标记"valid play candidate 场景待 l2 玩法包契约冻结"）
- 更新任务 11.2/11.4/11.5/11.6 复选框为 `[x]`

### 7.9 更新主状态板

- 将 PT-10 状态从"进行中"改为"已完成"（或"部分完成，待 l2 玩法包契约"）
- 在 `docs/00_主状态板.md` 追加完成时间、集成场景数量、DoD 检查结果

---

## 八、风险与缓解

### 8.1 已知风险

| 风险 | 缓解措施 | 责任 |
|------|---------|------|
| l2 端口在集成期变更 | 开工前 `git status` 检查 `src/l2/ugc/ports/**`；发现变更停止本线 | 执行者 |
| l2 玩法包契约未冻结 | 任务 11.3 先完成 valid base candidate 场景；play candidate 场景标记"待 l2 契约"，不伪造 | 执行者 |
| 共享诊断 hint 缺失 | 任务 11.2 补齐；若需新增错误码，写交接项跨 Spec 协调 | 执行者 |
| 恶意输入测试超时 | 使用可观察 work counters 断言（不只依赖超时），quota 设为合理上界 | 执行者 |
| PT-08b 同时修改 `src/core/kernel/state/error-codes.ts` | 开工前检查，发现冲突先合并 | 协调者 |

### 8.2 退出条件（不可抗力）

- PT-02 交付的 l2 端口被回退或大幅修改
- UGC 核心管线（任务 1–10）被其他线修改导致集成不兼容
- 跨 Spec 契约（`docs/L_审查报告/跨Spec契约_wakeup-ugc消费l2端口.md`）被项目所有者推翻

---

## 九、权威执行清单（任务 11.1–11.6 + 12，约 8 个任务）

完整任务列表见 `.kiro/specs/wakeup-ugc/tasks.md`（任务 11–12 部分）。

### 9.1 任务 11.1（已完成）

- [x] 在 `src/core/ugc/integration/` 实现基类层真实端口适配器
- [x] 仅消费冻结的 `src/l2/ugc/ports/index.ts`
- [x] `l2-adapter.ts` 只做 `createL2PortBundle()` → `assertL2PortBundle()` → 装配
- [x] 不做语义转换

### 9.2 任务 11.2

- [ ] 完成 shared diagnostics/hints 与真实安全基础设施集成
- [ ] 补齐已批准错误码的共享 hint
- [ ] 验证 DiagnosticSink 去重不折叠不同来源的 UGC 错误
- [ ] 验证 fatal `E_INV_*` 不可被覆盖

### 9.3 任务 11.3（核心交付）

- [ ] 添加 `src/core/ugc/__tests__/integration/full-pipeline.integration.test.ts`
- [ ] 覆盖 §6.1 列出的全部场景（真实 l2 端口）
- [ ] 每个 rejected case 断言指纹不变
- [ ] 每个 success 断言完整变化一次可见
- [ ] valid play candidate 场景若阻塞，明确标记待 l2 玩法包契约

### 9.4 任务 11.4

- [ ] 添加 `src/core/ugc/__tests__/integration/adversarial-input.integration.test.ts`
- [ ] 使用实际 decoder/pipeline 运行 §6.2 列出的攻击
- [ ] 测量可观察 work counters，断言不超过 quota 上界
- [ ] 断言无未捕获异常、无部分状态

### 9.5 任务 11.5

- [ ] 添加 `src/core/ugc/__tests__/integration/failure-injection.integration.test.ts`
- [ ] 在 §6.2 列出的每个阶段注入失败
- [ ] 断言 scope-correct diagnostics、skipped checks、旧快照保持

### 9.6 任务 11.6

- [ ] 添加运行时边界和兼容转交集成测试
- [ ] 验证 UGC public API 无运行时写入（静态扫描 + spy）
- [ ] 验证 runtime compatibility 声明只触发已有 gateway
- [ ] 验证 newer-save/active-match replacement 拒绝原样保留

### 9.7 任务 12（全量验收，必须等任务 11 全部通过）

- [ ] 12.1：运行 targeted 与全量验证并修复所有新增失败
- [ ] 12.2：执行安全和架构反向审查
- [ ] 12.3：核对 requirements/design/tasks 三向追踪和待汇合边界

---

## 十、参考资料

- `.kiro/specs/wakeup-ugc/requirements.md`（16 组要求，权威）
- `.kiro/specs/wakeup-ugc/design.md`（UGC 声明式接入设计，权威）
- `.kiro/specs/wakeup-ugc/tasks.md`（实施任务清单，任务 11–12，权威）
- `docs/L_审查报告/跨Spec契约_wakeup-ugc消费l2端口.md`（端口契约，权威）
- `src/core/ugc/ports/*.ts`（端口接口定义，权威）
- `src/l2/ugc/ports/port-bundle.ts`（提供方实现，PT-02 交付物）
- `src/core/ugc/integration/l2-port-contract.ts`（端口契约接口，UGC 侧）
- `docs/L0_规范宪法.md`：三层架构、引擎层铁律
- `.kiro/steering/架构决策原则.md`：解耦优先、基层长远
- `.kiro/steering/work-principles.md`：不省 token、不做 MVP

---

**生成说明**：本 Prompt 可直接复制到新会话执行。执行者应先阅读 §二（就绪确认）确认全部前置满足，再按 §九 权威执行清单逐任务推进，严格遵守 §五 行为契约，最后按 §七 回流检查验收。任务 11.3 的 valid play candidate 场景若因 l2 玩法包契约未冻结而阻塞，应明确标记待冻结，不得伪造完成。

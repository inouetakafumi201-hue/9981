# PT-11：基类层 ECS 收敛（收束专项）

> **前置依赖**：spec 三件套已交付（`.kiro/specs/wakeup-base-layer-ecs/requirements.md` + `design.md` + `tasks.md`）；来源追踪已登记 `SOURCE_TRACING_ADOPTION`（not-adopted）且文档纪律守卫通过。
> **就绪确认**：D-061 已确认（l2 语义管线归属 `src/l2`）；`family-contracts.ts`、`space-items-contracts.ts` 的既有消费者已被枚举；`compositionKind` 为全新字段、尚无 TSC 面。
> **并行边界**：与 Wave 4（PT-07 玩法层）、PT-08b（space-items 实施）在 `src/l2/**` 上的写权限需要协调——**本线独占 `src/l2/model/**` 与 `src/l2/validation/**`**，不碰 `src/class/**` 目录内容、不碰 `src/l2/adapters/**`、`src/l2/registry/**`、`src/l2/compiler/**`、`src/l2/ugc/**`。详见 §四白名单/黑名单。
> **生成时间**：2026-08-14
> **方法依据**：`docs/00_并行作战手册.md` §六 派发 Prompt 模板；`docs/L_归档/steering_历史/PARALLEL_EXECUTION_LOCK.md` 锁纪律。

---

## 一、背景与意图

基类层是**可复用的语义组件类型库 + 每类组件的 System 接线契约**。当前散乱的实质是与 ECS 定位的不对称：家族契约堆在单文件 `family-contracts.ts`、有能力和 Op 却无两者之间的接线契约（`kernelOps` 只是字符串字面量）、vehicle 占用实体基类的身份。本线把这些收拢到 ECS 形状：组件契约单一源、家族目录以组件为核心、原子 System 接线、vehicle 降级为组合型组件族。收敛只做结构、不做新玩法、不改任何玩家可见数值。

**本线判断（需主控确认）**：`wakeup-base-layer-ecs` 新 spec 是一个新规范化入口。它只改 `src/l2/model/**` 与 `src/l2/validation/**`（新增 `composition-registry.ts`、新增 `composition-shape.ts`、扩展语义族契约、新增 composition 校验），白名单与 Wave 4（`src/play/**`）、PT-08b（`src/l2/adapters/**`、`src/l2/registry/**`、`src/class/**` 目录）不重叠，可独立并行。

## 二、权威依据（先读）

- `.kiro/specs/wakeup-base-layer-ecs/requirements.md`（10 条要求，58 条 EARS 验收标准）——**本线最高权威**
- `.kiro/specs/wakeup-base-layer-ecs/design.md`（5 个组件/接口 + 10 条正确性属性 + 错误处理 + 测试策略）
- `.kiro/specs/wakeup-base-layer-ecs/tasks.md`（执行清单）
- `docs/L0_规范宪法.md`（宪法：引擎层 = 唯原语的实体组件系统，Entity = ID + 组件；基类层实例库，玩法层组合实例填数值）
- `docs/访谈决策记录.md`（D-038：载具不是微型场景；D-059：死亡容器；D-061：l2 语义管线归属 `src/l2`）
- `docs/L1_引擎层/05_底层引擎架构.md`（发电机组件系统 ECS 架构、Node/Item 为置于 ECS 之上的两类结构化数据）
- `src/l2/model/family-contracts.ts`（被收敛的既有族契约）
- `src/l2/model/space-items-contracts.ts`（`ContainerDomainContract` 既有容器契约）
- `src/l2/validation/validation.ts`（需挂进执行序的验证入口）——**实际文件名以 `ls src/l2/validation` 为准**
- `src/core/kernel/ops/`（System：Op 定义与许可集合来源）

## 三、就绪确认（开工前必须全部满足）

- [x] spec 三件套已交付（见 §一 文件清单）
- [x] 来源追踪已登记 `SOURCE_TRACING_ADOPTION`，`test/toolchain/spec-document-discipline.test.ts` 全绿（8/8）
- [x] D-061 已确认（l2 语义管线归属 `src/l2`）
- [x] `family-contracts.ts` 消费者已枚举（`src/l2/model/*` 的 definition/projection/reference、`codec/family-decoder`、`registry/action-submitter`、`adapters/ai-adapter`、`adapters/space-items-adapter`、`testing/builders`、`resolution/reference-collector`、`validation/*`——**这些只读引用不得破坏，改动族契约只能向后兼容扩展字段，不得改名/删字段/改签名**）
- [x] `compositionKind` 尚无 TSC 面（全新字段，可安全引入）
- [x] 工具链状态已核验（`npm run typecheck` / `typecheck:l2` / `test` / `lint`）

## 四、白名单（本线允许修改的路径）

### 4.1 生产代码

```
src/l2/model/composition-registry.ts                      # 新增，component.* 组件登记表
src/l2/model/composition-shape.ts                         # 新增，semanticFamily → compositionKind/组件形状
src/l2/model/family-contracts.ts                          # 扩展（只向后兼容追加字段/常量，不改既有成员改名删除）
src/l2/model/space-items-contracts.ts                     # 收敛 ContainerDomainContract 为组件形状（沿用 D-059）
src/l2/model/index.ts                                     # 导出新增模型
src/l2/validation/composition-alignment-rules.ts          # 新增，compositionKind/kernelOps/CaS 闭合校验
src/l2/validation/validator.ts                            # 挂进规则执行序（只追加，不改既有规则顺序与诊断码）
src/l2/index.ts                                           # 导出公共接口
src/l2/决策与风险记录.md                                   # 自主判断 H-0N 记录 + 覆盖证据表 + 交接项
```

### 4.2 测试代码

```
test/l2/ecs/**/*.test.ts                                   # 新增，ECS 收敛测试（单元 + 集成 + 10 个属性测试）
```

### 4.3 文档记录

```
src/l2/决策与风险记录.md                                   # 实施基线、覆盖证据表、自主判断、交接项
```

## 五、黑名单（本线禁止修改的路径）

### 5.1 跨 Spec / 他线边界（修改需写交接项）

```
src/core/kernel/**        # 引擎层，不得新增 Op / 错误码 / Hook；kernelOps 校验只读引用既有许可集合
src/core/ugc/**           # UGC 系统，PT-10 专属
src/play/**               # 玩法层，Wave 4（PT-07）专属
src/ui/**                 # 表现系统，PT-09 专属
src/class/                # 基类层目录内容。vehicle 降级的目录改写是 H-ECS-05 交接项，不由本线越权改（本线只建组合模板模型与校验，不改 vehicles/index.json）
src/l2/adapters/**        # 既有适配器，PT-08b 消费；本线不改
src/l2/registry/**        # 既有注册表，本线只消费不改
src/l2/compiler/**        # 既有管线，本线不动
src/l2/ugc/**             # UGC 端口，PT-10 专属
src/l2/codec/**           # 既有 JSON codec（family-decoder 引用族契约，本线改族契约后必须跑其测试确认兼容）
```

### 5.2 共享工具链配置（不得改动）

```
tsconfig.json / tsconfig.l2.json / vitest.config.ts / package.json / .eslintrc.cjs
```

### 5.3 他线既有文件

```
src/l2/validation/{spatial-rules,item-vehicle-rules,classification-rules,parameter-rules,effect-ai-rules,action-gateway-rules}.ts
  # 既有通用验证规则，只在任务 N 确认需要同步并写明与 ECS 收敛的相关性时编辑；不得删除其已有检查/改其诊断码
src/l2/model/{def-kind,diagnostic-codes,definition,json,schema,reference,projection,source,ids,immutable,ordering}.ts  # 既有模型文件，只读
src/class/**/index.json    # 目录内容（本线不改；vehicle 目录改写走交接）
```

## 六、行为契约（执行纪律）

### 6.1 不做 MVP、不特殊化、不走捷径

- 不得交付占位实现、`TODO`、伪代码或 `@ts-ignore`/`@ts-expect-error` 绕过
- 不得为了让测试通过而做只针对特定输入的特殊化补丁
- **10 个属性测试是必交付项**（对应 design.md 属性 1–10），一属性一文件，`numRuns ≥ 100`，不得 `skip`/`todo`，带 `Feature: wakeup-base-layer-ecs, Property N` 注释

### 6.2 串行门禁（任务依赖图严格执行）

```
0（基线核验：读 spec + 枚举消费者 + git status 确认白名单无未提交变更）
  └─ 1（composition-registry + component.* 登记模型）
       └─ 2（semanticFamily → composition-shape 映射：static/transient/modified-explicit/modified-capability）
            ├─ 3（family-contracts 向后兼容扩展）
            │    └─ 4（validation 校验：compositionKind/kernelOps/CaS 闭合）
            └─ 5（space-items ContainerDomainContract 收敛为组件形状）
                 └─ 6（测试：单元 + 集成 + 10 属性）
                      └─ 7（全量门禁 + 文档纪律守卫）
```

- 任务 3 与 5 在任务 2 后可并行（不同文件：`family-contracts.ts` vs `space-items-contracts.ts`）
- 任务 4 依赖任务 3 的扩展契约承载，故在任务 3 后
- **任务 7 必须等任务 6 全部通过**，不得用"大部分通过"宣称完成

### 6.3 工具链纪律

- 每完成一个任务运行 `npm run typecheck && npm run typecheck:l2 && npm test && npm run lint`
- 任一命令失败则修复后才继续下一任务（**注意 `bombardment-l1-*.property.test.ts` 的 4 个 TSC 错与全量 1 个失败为既存红灯，属引擎线，非本线引入**——用 `git diff --name-only` 核实本线未碰即视为已隔离验证）
- 不得通过过滤、skip、改断言、缩小范围或降低 severity 掩盖失败
- 不得新增 `ERR_CODES` 成员；新的 composition 校验映射到已登记码或既有结构的家族（如 `LAYER_L1_RUNTIME_STATE`、`VALUE_L3_OWNERSHIP`）；确无既存码则标记 unavailable 并写交接项

### 6.4 诊断码纪律

- `compositionKind` 校验用既有结构化家族码；若 `COMPOSITION_KIND_*` / `SYSTEM_BINDING_*` 不能映射到既有 `diagnostic-codes.ts` 成员，则在 `src/l2/model/diagnostic-codes.ts` **白名单内**登记并写交接项，不得用 `E_LOAD_UNRESOLVED_CONTRACT` 兜底
- `src/l2/model/diagnostic-codes.ts` 在白名单内（§4.1 未列——**此处明确为：允许新增本线专属诊断码，但必须登记到 `src/l2/决策与风险记录.md` 并回流裁决入口**）

### 6.5 不跨 Spec 改他人交付物

- vehicle 目录改写走 H-ECS-05 交接项，本线只建组合模板模型与校验
- 发现职责重复先判结构 vs 接口，结构问题登记并提请裁决，不用适配器绕过
- 只读投影不得改写语义状态（Requirement 4）

### 6.6 DoD 可机器校验

- `git status --porcelain` 显示白名单外无改动
- `npx tsc --noEmit` 0 错（排除既存 bombardment 红灯后的本线范围）
- `npx vitest run test/l2/ecs` 全绿 + 10 属性测试存在且通过
- `npm run lint` 0 error（warning 数不高于基线）
- `npx vitest run test/toolchain/spec-document-discipline.test.ts` 8/8 绿

## 七、回流方式

- **事实** → `src/l2/决策与风险记录.md` 的「ECS 收敛覆盖证据表」追加（每个要求/属性带 文件:函数/断言 证据，不许模糊）
- **自主设计** → 追加 `src/l2/决策与风险记录.md` 的「ECS 收敛自主判断 H-0N」小节（格式：判断编号、内容、理由、需人工确认点），不得静默采纳
- **裁决诉求** → `docs/L_审查报告/00_并行产出裁决与整理.md` 汇总（如 compositionKind 四形是否贴切、vehicle 降级的目录侧归属）
- **进度** → 主状态板交接项；**不直接改主状态板**

---

## 八、DoD（Definition of Done，完成时逐条勾选）

- [ ] `src/l2/model/composition-registry.ts` 落地，`component.*` 前缀集中登记组件，类与组合模板以 id 引用并去重
- [ ] `semanticFamily → compositionShape` 映射落地，一个族给一个 compositionKind（无主族不强制）
- [ ] `family-contracts.ts` 向后兼容扩展（不改既有成员签名/改名/删除），既有消费者全部编译通过
- [ ] `composition-alignment-rules.ts` 校验 `compositionKind` 四形 + `kernelOps` 存在且被许可 + CaS 缝隙闭合
- [ ] `space-items-contracts.ts::ContainerDomainContract` 收敛为组件形状（沿用 D-059）
- [ ] vehicle 组合模板模型表达「由组件拼装」、不声明 entity 基类身份（目录改写留 H-ECS-05 交接）
- [ ] 10 个属性测试（`test/l2/ecs/properties/P{01..10}-*.property.test.ts`）全部存在且 `numRuns ≥ 100` 通过，带规范标签
- [ ] 无 `TODO`、`FIXME`、占位实现、`@ts-ignore`、`@ts-expect-error`
- [ ] 覆盖证据表完成，无"应该/可能/大概"模糊表述
- [ ] 所有自主判断 H-0N 已记录；所有需上游改动的路径已写 T-0N 交接项
- [ ] `src/class/**` 目录未被本线改动（git diff 核实）

## 九、参考资料

- `.kiro/specs/wakeup-base-layer-ecs/{requirements,design,tasks}.md`（权威）
- `src/l2/model/family-contracts.ts`、`src/l2/model/space-items-contracts.ts`、`src/l2/model/diagnostic-codes.ts`
- `test/l2/space-items/properties/`（既有属性测试范例，含 14 个 PBT 先例）
- `docs/访谈决策记录.md`：D-061、D-038、D-059
- `docs/L0_规范宪法.md`：宪法第三条（三层）、ECS 定性
- `docs/L_归档/steering_历史/work-principles.md`：不省 token、不做 MVP、阶段结果如实汇报
- `docs/L_归档/steering_历史/架构决策原则.md`：解耦优先、基层长远

---

**生成说明**：本 Prompt 可直接复制到新会话执行。执行者应先读 §三 就绪确认确认全部前置满足，再按 §二 权威依据、§八 DoD、§六 行为契约推进（tasks.md 为执行清单）。本线是收束专项——交付物是「把既有基类层收敛到 ECS 形状并使散乱点可机器校验」，不是新增玩法。

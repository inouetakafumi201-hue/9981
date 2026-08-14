# 并行执行锁（Parallel Execution Lock）

> **用途**：防止多个并行任务同时修改同一文件/目录造成冲突。  
> **更新时间**：2026-08-14  
> **状态**：🟢 Wave 0-4 完成/现役，Wave 5（基类层 ECS 收敛）新增

---

## 当前执行波次：Wave 4（玩法层双实现收敛，现役）· Wave 5（基类层 ECS 收敛，新增可并行）

**Wave 0（完成）tasks.md 全线对账** → **Wave 1（完成）spec-compiler 冻结与审计（D-061）** → **Wave 2（完成）基类层目录统一信封迁移** → **Wave 3（完成）文档术语一致性** → **Wave 4（现役）玩法层双实现收敛** → **Wave 5（新增）基类层 ECS 收敛**

> **Wave 4 解锁说明**：U-002（单人投点 AP）已于 2026-08-13 由项目所有者裁决——**维持 D-037（单人投点 2 AP）**，abort 语态废弃。两套实现对此结论不再相反，Wave 4 由 🔒 阻塞转为解锁可执行。详见 `docs/访谈决策记录.md` D-037/D-062 与 `docs/L_审查报告/玩法层数值归属审计.md` B3。
>
> **Wave 5 新增说明（2026-08-14）**：基类层 ECS 收敛专项。新 spec `.kiro/specs/wakeup-base-layer-ecs` 已交付，来源追踪已登记。Wave 5 独占 `src/l2/model/**` 与 `src/l2/validation/**`，与 Wave 4（`src/play/**`）等既有波次不相交。同一 `src/l2/**` 内与 PT-08b 的共享文件（`src/l2/model/index.ts`、`src/l2/validation/index.ts`、`validator.ts`、`diagnostic-codes.ts`）遵循「只追加导出、开工前 git 检查」的共享纪律。

### 🔴 禁止修改（Wave 4 独占）

| 路径 | 原因 | 解锁条件 |
|------|------|---------|
| `src/play/action-turn/**` | 双实现收敛以单一权威收口 | Wave 4 完成 |
| `src/play/core-mechanics/**` | 同上，转为装载期治理层 | Wave 4 完成 |
| `src/play/playpack-compiler/**` | 收敛过程涉及的装载/治理链路 | Wave 4 完成 |

### 🔴 禁止修改（Wave 5 独占）

| 路径 | 原因 | 解锁条件 |
|------|------|---------|
| `src/l2/model/{composition-registry,composition-shape}.ts` | ECS 收敛新增组件契约单一源与形状映射 | Wave 5 完成 |
| `src/l2/model/family-contracts.ts` | 家族目录以组件为核心的收敛主文件 | Wave 5 完成 |
| `src/l2/model/space-items-contracts.ts` | `ContainerDomainContract` 收敛为组件形状 | Wave 5 完成 |
| `src/l2/validation/composition-alignment-rules.ts` | 新增 compositionKind/kernelOps/CaS 校验 | Wave 5 完成 |

> **共享禁改例外**：`src/l2/model/index.ts`、`src/l2/validation/index.ts`、`validator.ts`、`diagnostic-codes.ts` 为本波与 PT-08b 的共享文件——允许「只追加导出/只追加规则与码」，不得覆盖或改写既有成员。

### 🟡 限制修改（其他已归档波次的约束仍生效项）

| 路径 | 限制内容 | 原因 | 解锁条件 |
|------|---------|------|---------|
| `src/class/**/index.json` | 不可新增专有顶层键；vehicle 目录改写是 H-ECS-05 交接项，不由 Wave 5 越权改 | Wave 2 统一信封迁移已收口 | 移交验收确认 |
| `docs/**/*.md` | 不可引入废用术语 | Wave 3 术语一致性已收口 | `verify:docs` 持续全绿 |

### ✅ 可自由修改

| 路径 | 说明 |
|------|------|
| `src/play/profiles/**` | 玩法层 profile 与审计（Wave 4 主线外的独立面） |
| `src/ui/**` | UI 与动画投影 |
| `test/properties/**` | 属性测试（独立验证） |
| `test/l2/**` | 基类层测试 |
| `src/l2/adapters/**`、`src/l2/registry/**`、`src/l2/compiler/**`、`src/l2/ugc/**` | 基类层其余子面（PT-01/08b/10 管辖，Wave 5 只消费不改） |
| `.kiro/specs/**/requirements.md` | 需求文档（只读参考，本波新建的 `wakeup-base-layer-ecs` 除外，其写入归主控） |
| `.kiro/specs/**/design.md` | 设计文档（只读参考，同上） |

---

## Wave 依赖图

```
Wave 0 (✅ 完成) ━━━┳━━━━━━━━━━━━━━━━━━━━┓
                    ┃                      ┃
                    ┃                      ┃
             Wave 1 (✅ 完成)         Wave 3 (✅ 完成)
        spec-compiler 冻结           术语一致性
                    ┃                      ┃
                    ┃                      ┃
             Wave 2 (✅ 完成)              ┃
          基类层目录迁移                  ┃
                    ┃                      ┃
                    ┗━━━━━━┳━━━━━━━━━━━━━━┛
                           ┃
                           ┃
                       Wave 4 (🟢 现役)
                      玩法层双实现收敛
               (U-002 已裁决，D-037 维持，已解锁)
                    ┃
                    ┃  （与 Wave 5 目录不相交，可并行）
                    ┃
                  Wave 5 (🟢 新增)
                 基类层 ECS 收敛
          (spec wakeup-base-layer-ecs 已交付)
```

---

## 各 Wave 详情

### Wave 0：tasks.md 全线对账与冻结标记 ✅

**状态**：✅ 已完成（2026-08-12）

**成果**：
- 所有 spec 的 tasks.md 增加 Wave 依赖说明
- D-061/D-062 执行状态更新
- 决策记录同步至实现现状

**交付物**：
- `.kiro/steering/结构收敛执行计划.md`
- `.kiro/steering/并行冲突解决报告_2026-08-12.md`
- 本文件（PARALLEL_EXECUTION_LOCK.md）

---

### Wave 1：spec-compiler 冻结与审计 ✅

**状态**：✅ 已完成（2026-08-12/13）

**目标**：
1. 在 `src/core/kernel/spec-compiler/` 增加 `FROZEN.md` 冻结标记 ✅
2. 审计 spec-compiler 相对 `src/l2/` 的独有能力 ✅
3. 迁移必要的缺口补全进 `src/l2/` ✅
4. 更新所有 import 路径指向 `src/l2/` ✅

**阻塞任务**（解除后才能执行）：
- l2-base-layer-spec: D-1, D-2, D-5
- wakeup-ugc: 端口消费落地

**验收标准**：
- [x] `src/core/kernel/spec-compiler/FROZEN.md` 存在
- [x] 独有缺口审计报告完成
- [x] `src/l2/` 补全全部必要缺口
- [x] `src/class/` 与 `src/play/` 的 import 全部指向 `src/l2/`
- [x] 全量测试通过

**实际完成**：
- 冻结标记 `FROZEN.md` 于 2026-08-12 建立、2026-08-13 提炼为独立引用件
- import 迁移（Wave 3）完成：`src/class`+`src/play` 生产 import 已割到 `ports/codec/security`
- 剩余交接项（catalog-activation/scene-catalog-activation 运行时桥、schedule/playpack-codec 的 `ParsedCandidateDocument` 扩展）见 `FROZEN.md` 第三节，属 Wave 3 物理删除前置，不阻塞本 Wave 收口

**预计完成**：Wave 0 + 3–5 工作日

---

### Wave 2：基类层 14 份目录统一信封迁移 ✅

**状态**：✅ 已完成（2026-08-13）

**目标**：
1. 迁移 6 份未达标目录到 `class-catalog.schema.json` 统一形状
2. 保持 `additionalProperties: false` 约束
3. 不丢失任何字段或元数据

**阻塞任务**：
- wakeup-space-items: 任务 9（扩展目录字段）

**验收标准**：
- [x] 14/14 份目录通过 `class-catalog.schema.json` 校验
- [x] schema 的顶层约束未被放宽
- [x] `src/class/__tests__/` 全部通过

**预计完成**：Wave 1 + 2–3 工作日

---

### Wave 3：文档术语一致性迁移 ✅

**状态**：✅ 已完成（2026-08-13）

**目标**：
1. 消除 `docs/**` 中的废用词（模板、内容层、裸用 Layer 1/2/3）
2. 统一层级标签（引擎层/基类层/玩法层）
3. `npm run verify:docs` 全绿

**阻塞任务**：
- wakeup-ui-animation: 全部任务（设计文档依赖）

**验收标准**：
- [x] `docs/**` 无废用词
- [x] `npm run verify:docs` 通过
- [x] `src/**` 侧违规清单交接给其他 Wave

**实际完成**：
- 术语已统一，`verify:docs` 持续全绿（本收束批次复核）

**预计完成**：Wave 0 + 2 工作日

---

### Wave 4：玩法层双实现收敛 🟢

**状态**：🟢 现役（2026-08-13 U-002 裁决后解锁）

**目标**：
1. 合并 `playpack.json` 与 `core-mechanics/defs/*` 为单一权威
2. `core-mechanics` 转为装载期治理层
3. 补齐 tasks 9–10 的属性测试

**阻塞原因（已解除）**：
- 原 U-002（单人投点：D-037 的 2 AP vs abort）需项目所有者裁决
- **已于 2026-08-13 裁决：维持 D-037（单人投点 2 AP），abort 语态废弃**
- 两套实现对此结论已不再相反，可安全收敛

**解锁条件**：
- U-002 裁决完成 ✅（2026-08-13，D-037 维持）
- Wave 1 完成 ✅

**验收标准**（U-002 裁决后：
- [ ] 单一权威数据源
- [ ] U-002 按裁决结论实现（D-037：单人投点 2 AP）
- [ ] 属性测试补齐
- [ ] 全量测试通过

**预计完成**：U-002 裁决 + Wave 1 + 5–7 工作日

---

### Wave 5：基类层 ECS 收敛 🟢

**状态**：🟢 新增可并行（2026-08-14）

**目标**：
1. 组件契约单一源（`composition-registry.ts`，`component.*` 前缀集中登记）
2. 家族目录以组件为核心（`family-contracts.ts` 向后兼容扩展 + `composition-shape.ts` 形状映射）
3. 原子 System 接线（`composition-alignment-rules.ts` 校验 `compositionKind` 四形 + `kernelOps` 存在且被许可 + CaS 缝隙闭合）
4. vehicle 降级为组合型组件族（组合模板模型本波建，`src/class/vehicles/index.json` 目录改写走 H-ECS-05 交接）
5. `space-items-contracts.ts::ContainerDomainContract` 收敛为组件形状（沿用 D-059）

**依赖**：spec `.kiro/specs/wakeup-base-layer-ecs` 已交付（requirements/design/tasks）；来源追踪已登记

**并行边界**：独占 `src/l2/model/**` 与 `src/l2/validation/**`；与 Wave 4（`src/play/**`）、PT-08b（`src/l2/adapters/**`、`src/l2/registry/**`、`src/class/**`）、PT-10（`src/core/ugc/**`）不相交

**白名单**：
```
src/l2/model/{composition-registry,composition-shape}.ts  # 新增
src/l2/model/{family-contracts,space-items-contracts,index}.ts  # 扩展/导出（只向后兼容）
src/l2/validation/{composition-alignment-rules,validator}.ts  # 新增/挂入（只追加）
src/l2/index.ts  # 导出
src/l2/决策与风险记录.md  # 覆盖证据表/自主判断
test/l2/ecs/**  # 单元+集成+10 属性测试
```

**验收标准（DoD）**：组件登记 / 形状映射 / 接线校验 / 容器收敛落地；10 个属性测试 `numRuns ≥ 100` 通过；`npm run typecheck` = `npm run typecheck:l2` = `test` = `lint` 全绿（既存 bombardment 红灯除外，隔离验证）；`src/class/**` 未被改动；覆盖证据表完整。

**交付物**：收敛后的 `src/l2/model/**`、`src/l2/validation/**`、`test/l2/ecs/**`；覆盖证据表；H-ECS-05 vehicle 目录改写交接项；`compositionKind` 四形定义回读至 owners。

**预计完成**：Wave 4 起 5–7 工作日（独立并行，不依赖 Wave 4 完成）

---

## 冲突解决规则

### 规则 1：Wave 内独占 > Wave 间协调

同一 Wave 内的任务对其负责目录有**独占写权限**。其他 Wave 不得同时修改。

### 规则 2：发现冲突立即上报

任何 Wave 执行者发现其需要修改被其他 Wave 锁定的文件时：
1. **停止**修改该文件
2. 在对应 Wave 的 steering 文档中**记录冲突**
3. 将冲突提交项目协调者
4. **不得**用"先提交，回头再改"的方式绕过锁

### 规则 3：只读访问不受限

所有目录/文件都可以**只读访问**（Read、Grep、Glob），锁只限制**写入**（Write、Edit）。

### 规则 4：测试文件归属其测试目标

`src/*/tests__/*.test.ts` 的归属跟随其测试的目标：
- `src/class/__tests__/*` 归 Wave 2
- `src/l2/__tests__/*` 归 Wave 1
- `src/play/action-turn/__tests__/*` 归 Wave 4

### 规则 5：锁的更新权

只有当前执行 Wave 的负责人可以更新本文件的锁状态。其他人发现锁过期/错误时，通过 issue 上报而非直接修改。

---

## 常见问题

### Q: 我的任务跨越多个 Wave 的目录怎么办？

A: 拆解任务。把不同目录的部分拆成独立子任务，分别等待对应 Wave 解锁。如果必须原子提交，等待所有依赖 Wave 完成。

### Q: Wave 1 和 Wave 3 可以并行吗？

A: 可以。它们修改的目录没有交集（Wave 1 在 `src/`，Wave 3 在 `docs/`）。但 Wave 3 产出的 `src/` 侧违规清单需要等 Wave 1 完成后再修。

### Q: Wave 4 为什么现在能开工？

A: U-002（单人投点 AP）已由项目所有者 2026-08-13 裁决，**维持 D-037（单人投点 2 AP）**，abort 语态作废。`playpack.json` 与 `core-mechanics` 的结论不再相反，收敛无论归到哪一套都不会被另一方打脸。

### Q: 我发现某个文件应该被锁但没锁，可以直接改吗？

A: 不可以。先上报冲突，等锁更新后再改。"看起来没人在改"不等于"可以改"——可能只是另一个 Wave 还在准备阶段。

---

## 更新日志

| 日期 | 更新内容 | 更新人 |
|------|---------|--------|
| 2026-08-12 | 初始版本，Wave 0 完成标记 | Claude (session 67874a0e) |
| 2026-08-13 | 收束批次：Wave 1-3 标记完成、Wave 4 随 U-002 裁决解锁为现役、锁边界刷新为 Wave 4 | 主控收束会话 |
| 2026-08-14 | 新增 Wave 5（基类层 ECS 收敛）：独占 `src/l2/model/**` 与 `src/l2/validation/**`，写清与 Wave 4/PT-08b 的共享文件「只追加」纪律 | 主控会话（PT-11） |

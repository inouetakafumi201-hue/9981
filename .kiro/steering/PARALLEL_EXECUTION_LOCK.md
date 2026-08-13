# 并行执行锁（Parallel Execution Lock）

> **用途**：防止多个并行任务同时修改同一文件/目录造成冲突。  
> **更新时间**：2026-08-12  
> **状态**：🟢 Wave 0 完成，Wave 1-4 准备中

---

## 当前执行波次：Wave 1

**Wave 1 主题**：spec-compiler 冻结与审计（D-061 执行）

### 🔴 禁止修改（Wave 1 独占）

| 路径 | 原因 | 解锁条件 |
|------|------|---------|
| `src/core/kernel/spec-compiler/**` | 正在冻结并审计独有缺口 | Wave 1 完成 |
| `src/l2/compiler/**` | 正在接收 spec-compiler 的缺口迁移 | Wave 1 完成 |
| `src/l2/validation/**` | 正在接收校验规则迁移 | Wave 1 完成 |

### 🟡 限制修改（其他波次准备中）

| 路径 | 限制内容 | 原因 | 解锁条件 |
|------|---------|------|---------|
| `src/class/**/index.json` | 不可新增专有顶层键 | Wave 2 统一信封迁移进行中 | Wave 2 完成 |
| `docs/**/*.md` | 不可引入废用术语 | Wave 3 术语迁移准备中 | Wave 3 完成 |
| `src/play/action-turn/**` | 不可改动机制逻辑 | Wave 4 双实现收敛等待 U-002 | U-002 裁决 |
| `src/play/core-mechanics/**` | 不可改动机制逻辑 | Wave 4 双实现收敛等待 U-002 | U-002 裁决 |

### ✅ 可自由修改

| 路径 | 说明 |
|------|------|
| `src/play/profiles/**` | 玩法层 profile 与审计 |
| `src/ui/**` | UI 与动画（受 Wave 3 文档依赖，但代码可先行） |
| `test/properties/**` | 属性测试（独立验证，不影响其他波次） |
| `.kiro/specs/**/requirements.md` | 需求文档（只读参考） |
| `.kiro/specs/**/design.md` | 设计文档（只读参考） |

---

## Wave 依赖图

```
Wave 0 (已完成) ━━━┳━━━━━━━━━━━━━━━━━━━━┓
                   ┃                      ┃
                   ┃                      ┃
             Wave 1 (进行中)          Wave 3 (准备中)
        spec-compiler 冻结            术语一致性
                   ┃                      ┃
                   ┃                      ┃
             Wave 2 (准备中)              ┃
          基类层目录迁移                  ┃
                   ┃                      ┃
                   ┗━━━━━━┳━━━━━━━━━━━━━━┛
                          ┃
                          ┃
                     Wave 4 (🔒阻塞)
                    玩法层双实现收敛
                 (等待 U-002 裁决解锁)
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

### Wave 1：spec-compiler 冻结与审计 🔄

**状态**：🔄 准备中

**目标**：
1. 在 `src/core/kernel/spec-compiler/` 增加 `FROZEN.md` 冻结标记
2. 审计 spec-compiler 相对 `src/l2/` 的独有能力
3. 迁移必要的缺口补全进 `src/l2/`
4. 更新所有 import 路径指向 `src/l2/`

**阻塞任务**（解除后才能执行）：
- l2-base-layer-spec: D-1, D-2, D-5
- wakeup-ugc: 端口消费落地

**验收标准**：
- [ ] `src/core/kernel/spec-compiler/FROZEN.md` 存在
- [ ] 独有缺口审计报告完成
- [ ] `src/l2/` 补全全部必要缺口
- [ ] `src/class/` 与 `src/play/` 的 import 全部指向 `src/l2/`
- [ ] 全量测试通过

**预计完成**：Wave 0 + 3–5 工作日

---

### Wave 2：基类层 14 份目录统一信封迁移 🔄

**状态**：🔄 准备中（等待 Wave 1）

**目标**：
1. 迁移 6 份未达标目录到 `class-catalog.schema.json` 统一形状
2. 保持 `additionalProperties: false` 约束
3. 不丢失任何字段或元数据

**阻塞任务**：
- wakeup-space-items: 任务 9（扩展目录字段）

**验收标准**：
- [ ] 14/14 份目录通过 `class-catalog.schema.json` 校验
- [ ] schema 的顶层约束未被放宽
- [ ] `src/class/__tests__/` 全部通过

**预计完成**：Wave 1 + 2–3 工作日

---

### Wave 3：文档术语一致性迁移 🔄

**状态**：🔄 准备中（与 Wave 1 并行，独立分支）

**目标**：
1. 消除 `docs/**` 中的废用词（模板、内容层、裸用 Layer 1/2/3）
2. 统一层级标签（引擎层/基类层/玩法层）
3. `npm run verify:docs` 全绿

**阻塞任务**：
- wakeup-ui-animation: 全部任务（设计文档依赖）

**验收标准**：
- [ ] `docs/**` 无废用词
- [ ] `npm run verify:docs` 通过
- [ ] `src/**` 侧违规清单交接给其他 Wave

**预计完成**：Wave 0 + 2 工作日

---

### Wave 4：玩法层双实现收敛 🔒

**状态**：🔒 阻塞（等待 U-002 裁决）

**目标**：
1. 合并 `playpack.json` 与 `core-mechanics/defs/*` 为单一权威
2. `core-mechanics` 转为装载期治理层
3. 补齐 tasks 9–10 的属性测试

**阻塞原因**：
- U-002（单人投点：D-037 的 2 AP vs abort）需项目所有者裁决
- 两套实现对此结论相反，无法在裁决前收敛

**解锁条件**：
- U-002 裁决完成
- Wave 1 完成（避免多线程改同一区域）

**验收标准**（待 U-002 裁决后补充）：
- [ ] 单一权威数据源
- [ ] U-002 按裁决结论实现
- [ ] 属性测试补齐
- [ ] 全量测试通过

**预计完成**：U-002 裁决 + Wave 1 + 5–7 工作日

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

### Q: 为什么 Wave 4 要等 U-002？

A: 因为 `playpack.json` 和 `core-mechanics` 对单人投点的结论相反。不裁决的话，收敛后的实现无论选哪个都会被另一方的测试/文档打脸。

### Q: 我发现某个文件应该被锁但没锁，可以直接改吗？

A: 不可以。先上报冲突，等锁更新后再改。"看起来没人在改"不等于"可以改"——可能只是另一个 Wave 还在准备阶段。

---

## 更新日志

| 日期 | 更新内容 | 更新人 |
|------|---------|--------|
| 2026-08-12 | 初始版本，Wave 0 完成标记 | Claude (session 67874a0e) |

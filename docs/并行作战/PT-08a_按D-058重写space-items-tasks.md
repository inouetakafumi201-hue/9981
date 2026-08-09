## 任务：PT-08a — 按 D-058 重写 wakeup-space-items 的 tasks.md

> ✅ **已完成（2026-08-09）**。产出：`.kiro/specs/wakeup-space-items/tasks.md` 全量重写。
> DoD 全部达成：新 tasks.md 无任何指向被否决目录的落点（路径字面量已清除）；requirements 1–14 逐条映射为覆盖矩阵（✅/◐/⬜/⚠）；顶部有 D-058 落点说明与"取代旧版"注记。
> 回流已完成：主状态板 PT-08a 标 ✅、PT-08b 解锁为 🟢；design.md 过时描述登记为交接项 T-01（建议 PT-08c）。
> 重写期关键发现：①`src/l2/model/space-items-*.ts` 五文件已产出但为死代码；②`tsconfig.l2.json` 隔离门禁为旧计划未提的硬约束；③`spectrum-class.*`/`DMG_*`/`WKN_*` 三套标识不存在。

### 1. 背景与意图
`wakeup-space-items/tasks.md` 的全部任务都针对 `src/class/space-items/{model,contracts,ports,validation,resolution,runtime,adapters}` ——但 **D-058 已裁决否决新建 `src/class/space-items/`**：目录数据落 `src/class/<族>/index.json`、领域验证落既有 `src/l2/validation/*.ts`、跨层适配落 `src/l2/adapters/`。所以这份 tasks.md 是针对被否决架构写的，**当前不可执行**。本任务把它重写为"校验既有 + 补缺口"的可执行任务。对应主状态板 PT-08a、全局报告 §三 空间物品断点。

### 2. 权威依据（先读）
- `docs/访谈决策记录.md` **D-056 / D-058 / D-059**（三层落点裁决）
- `docs/L_审查报告/00_并行产出裁决与整理.md` §六（三层落点与顺序）
- `.kiro/specs/wakeup-space-items/requirements.md`（要求 1–14，不变）与 `design.md`（组件表已承认扩展 src/l2）
- 现状：`src/class/`（scenes/containers/vehicles/weapons/damage-types/movement/... 已存在）、`src/l2/validation/{spatial,item-vehicle,action-gateway}-rules.ts`（已实现大量校验）

### 3. 就绪确认
- 依赖已闭合：D-058 已是**已确认裁决**（非草案）；落点目录均已存在。
- 冻结：requirements.md 的要求 1–14 不变；只重写 tasks 的**实现路径与落点**。

### 4. 允许改动的目录（白名单）
- `.kiro/specs/wakeup-space-items/tasks.md`（整体重写）
- 可同步在 tasks 顶部加"D-058 落点说明"段。

### 5. 禁止触碰（黑名单）
- **不改任何 `src/**`、`test/**` 代码**（本任务只重写任务清单，不做实现——实现是 PT-08b）。
- **不改 requirements.md**（要求不变）。design.md 若仍有"新建目录"残留描述，写成交接项，不在本任务改。
- 不新建 `src/class/space-items/`。

### 6. 行为契约
遵循 `docs/00_并行作战手册.md` §四。重写时逐条把旧任务映射为：①"校验既有 `src/l2/validation` 规则是否覆盖要求 X"或 ②"在 `src/l2/validation/<file>` 补要求 X 未覆盖的校验面"或 ③"在 `src/class/<族>/index.json` 补字段"。每条要有可机器校验 DoD。

### 7. DoD（可核对）
- [ ] 新 tasks.md 无任何 `src/class/space-items/` 引用；落点全部指向既有 `src/l2/validation` / `src/class/<族>` / `src/l2/adapters`。
- [ ] requirements 1–14 每条都能在新 tasks 中找到对应任务（覆盖或补齐），并标注"已覆盖(证据)"或"待补(落点)"。
- [ ] 顶部有 D-058 落点说明与"本 tasks 取代旧版"的注记。

### 8. 回流方式
- 完成后主状态板 PT-08a 标 ✅，并把"实现剩余校验面"登记为 **PT-08b**（就绪，依赖 PT-08a）。
- design.md 的过时描述 → 交接项。

# PT-08b：WakeUp 空间与物品基类层实施

> **前置依赖**：PT-02（l2 端口已交付）、PT-08a（任务清单按 D-058 重写完成）
> **就绪确认**：D-061 已确认（l2 语义管线归属）、D-058 落点已裁决、PT-08a 任务清单已重写
> **并行边界**：与 PT-10 可并行（目录不冲突）
> **生成时间**：2026-08-11

---

## 一、背景与权威依据

### 1.1 架构裁决（D-058，2026-08-09）

- **不建 `src/class/space-items/`**；目录数据扩展既有 `src/class/<族>/index.json`
- 验证落 `src/l2/validation/space-items-*.ts`，适配落 `src/l2/adapters/space-items-*.ts`
- 领域模型落 `src/l2/model/space-items-*.ts`（**已存在但为死代码，需接线与测试**）
- 测试落 `test/l2/space-items/**`（`vitest.config.ts` 已 include `test/l2/**`）

### 1.2 权威 Spec 文档

- `.kiro/specs/wakeup-space-items/requirements.md`（14 组要求，146 条细则）
- `.kiro/specs/wakeup-space-items/design.md`（1246 行，已按 D-058 重写）
- `.kiro/specs/wakeup-space-items/tasks.md`（414 行，PT-08a 于 2026-08-09 按 D-058 重写）

### 1.3 任务清单已完成的事实核验（PT-08a 产物，2026-08-09）

- **五个领域模型文件已存在**：`src/l2/model/space-items-{domain-ids,structural-bounds,numeric-ownership,diagnostic-categories,unresolved}.ts`
- **但它们是死代码**：未从 `src/l2/model/index.ts` 导出、除彼此外无消费者、零测试
- **既有通用规则部分覆盖**：`spatial-rules.ts`、`item-vehicle-rules.ts` 等已覆盖 requirements 部分语义，但那不是本任务清单要求的 space-items 专属交付物
- **目录数据部分已更新**：`scenes/index.json` 三档 `admitsMicroScene: true` 已按 D-056/D-057 更新；`vehicles/index.json` 的 Q-04 残留与 D-038 冲突待修正（任务 3.2）

---

## 二、就绪确认（开工前必须全部满足）

### 2.1 裁决与设计冻结

- [x] D-058 已裁决（不建 `src/class/space-items/`，三类落点已明确）
- [x] D-061 已确认（l2 语义管线归属 `src/l2`）
- [x] PT-08a 已完成（任务清单按 D-058 重写，414 行）
- [x] requirements.md / design.md 已冻结（requirements 14 组 146 条，design 1246 行）

### 2.2 前置依赖已交付

- [x] PT-02 已完成（`src/l2/ugc/ports/` 已交付，UGC 契约已实现）
- [x] `tsconfig.l2.json` 的窄 include 边界已就位（只能 import `src/l2/**` + `ops/registry.ts` + `ops/result.ts`）
- [x] `vitest.config.ts` 已 include `test/l2/**`（非 src 内测试会被执行）
- [x] 工具链状态已核验（`npm run typecheck` / `typecheck:l2` / `test` / `lint` 四条命令可用）

### 2.3 并行冲突已排除

- [x] PT-09（UI/Animation）不修改 `src/l2/**` 或 `test/l2/**`，无路径冲突
- [x] PT-10（UGC 真实上游集成）只写 `src/core/ugc/integration/**`，无路径冲突
- [x] 五个死代码模型文件当前无活跃编辑会话

---

## 三、白名单（本线允许修改的路径）

### 3.1 生产代码

```
src/l2/model/space-items-{domain-ids,structural-bounds,numeric-ownership,diagnostic-categories,unresolved}.ts  # 接线与测试
src/l2/model/space-items-contracts.ts  # 新增，补 Container/Shield/Profile 契约
src/l2/model/index.ts  # 导出领域模型
src/l2/validation/space-items-*.ts  # 新增，领域验证规则（8 个文件）
src/l2/validation/validator.ts  # 挂进规则执行序
src/l2/resolution/space-items-capability-shape.ts  # 新增，引用能力形状判定
src/l2/adapters/space-items-transfer.ts  # 新增，转移意图 → item.move
src/l2/adapters/space-items-micro-scene.ts  # 新增，微型场景进入与父移除
src/l2/adapters/space-items-integration-contract.ts  # 新增，提供方侧集成契约
src/l2/adapters/space-items-projection.ts  # 新增，FieldProvenanceView 三态投影
src/l2/index.ts  # 导出公共接口
src/l2/决策与风险记录.md  # 追加实施基线、覆盖证据表、交接项
src/class/{scenes,vehicles,containers,items,weapons,movement,statuses}/index.json  # 目录数据修正与补齐
src/class/__tests__/*.test.ts  # 同步断言（若目录字段变化）
```

### 3.2 测试代码

```
test/l2/space-items/**/*.test.ts  # 新增，领域测试（单元/集成/属性，约 50+ 文件）
```

### 3.3 文档记录

```
src/l2/决策与风险记录.md  # 实施基线、证据表、交接项、自主判断记录
```

---

## 四、黑名单（本线禁止修改的路径）

### 4.1 跨 Spec 边界（修改需写交接项）

```
src/core/kernel/**  # 引擎层，不得新增 Op / 错误码 / Hook
src/core/ugc/**  # UGC 系统，PT-10 专属
src/play/**  # 玩法层，PT-07 等其他线专属
src/ui/**  # 表现系统，PT-09 专属
src/class/__tests__/catalog-activation.property.test.ts  # 属于 PT-03，不得改
```

### 4.2 共享工具链配置

```
tsconfig.json  # 不得修改 include
tsconfig.l2.json  # 不得修改 include（窄边界是机器守卫）
vitest.config.ts  # 不得修改 include
package.json  # 不得新增 scripts 或依赖
.eslintrc.cjs  # 不得修改规则
```

### 4.3 其他模块的既有文件

```
src/l2/validation/{spatial-rules,item-vehicle-rules,classification-rules,parameter-rules,effect-ai-rules,action-gateway-rules}.ts
  # 既有通用规则，只能在任务 4 补差集时编辑；不得删除已有检查或改变其诊断码
src/l2/compiler/**  # D-061 收敛后的既有管线，本线不动
src/l2/codec/**  # 既有 JSON codec，本线不动
src/l2/registry/**  # 既有注册表，本线不动（任务 6/7 只消费其接口）
src/l2/testing/**  # 既有测试设施，任务 8 可扩展但不得改基础接口
```

---

## 五、行为契约（执行纪律）

### 5.1 不做 MVP、不特殊化、不走捷径

- 不得交付占位实现、`TODO` 或伪代码
- 不得为了让测试通过而做特殊化（硬编码、只对特定输入打补丁）
- 14 个属性测试是**必交付项**，一属性一文件，`numRuns ≥ 100`，不得 `skip`/`todo`

### 5.2 串行门禁（任务依赖图严格执行）

```
0（基线核验）
  └─ 1（领域模型接线与测试）
       ├─ 2（领域契约扩展）
       └─ 3（目录数据修正）
            └─ 4（领域验证规则）
                 ├─ 5（引用能力形状）
                 └─ 6（运行时适配）
                      └─ 7（集成契约与投影）
                           └─ 8（测试）
                                └─ 9（全量门禁）
```

- 任务 2 与 3 在任务 1 后可并行
- 任务 4.3–4.7 在任务 4.1 后可并行
- 任务 5 与 6 在任务 4 后可并行
- 任务 8.2 的 14 个属性测试在任务 8.1 后按各自前置并行
- **任务 9 必须等任务 8 全部通过**，不得用"大部分通过"宣称完成

### 5.3 工具链纪律

- 每完成一个任务后运行 `npm run typecheck` && `npm run typecheck:l2` && `npm test` && `npm run lint`
- 任一命令失败则修复后才能继续下一任务
- **不得**通过过滤、skip、改断言、缩小范围或降低 severity 来掩盖失败
- **不得**用 `@ts-ignore` / `@ts-expect-error` 绕过真实类型错误（反向断言除外）

### 5.4 诊断码纪律

- **不得新增 `ERR_CODES` 成员**；领域诊断必须映射到已登记码
- requirements 措辞的类别名（如 `VALUE_L3_OWNERSHIP`、`MICRO_SCENE_CREATOR_MISUSE`）按任务 0.3 建立的等价映射表使用既有码
- 若某路径确认无既有码可用，标记为 unavailable 并写交接项，不得用 `E_LOAD_UNRESOLVED_CONTRACT` 兜底

### 5.5 并行守卫

- 开始修改前运行 `git status --porcelain`，确认白名单路径无未提交变更
- 发现冲突时停止本线，报告冲突文件并等待合并
- 不得覆盖其他会话的活跃产物

### 5.6 自主判断记录

- 任何实施期产生的设计补充（如 §0.1 注的"领域运行时入口归 adapters"）必须逐条追加到 `src/l2/决策与风险记录.md` 的「space-items 自主判断」小节
- 格式：`H-0N`（判断编号）、判断内容、理由、需人工确认的点
- 不得静默采纳自主判断

---

## 六、Definition of Done（DoD）

### 6.1 代码完整性

- [ ] 五个死代码模型文件已从 `src/l2/model/index.ts` 和 `src/l2/index.ts` 导出
- [ ] 无 `TODO`、`FIXME` 或占位实现
- [ ] 所有 `export` 至少被一个消费者引用（无死代码守卫测试通过）

### 6.2 测试覆盖

- [ ] 14 个属性测试（`test/l2/space-items/properties/P{01..14}-*.property.test.ts`）全部存在且通过
- [ ] 单元测试覆盖五个模型文件、领域契约、领域验证规则、引用能力形状、运行时适配（约 30+ 文件）
- [ ] 集成测试覆盖端到端验证、转移规划、微型场景规划、契约导出、投影（约 10+ 文件）
- [ ] 架构测试覆盖无死代码、规则执行序稳定、Op 名机械比对（约 5+ 文件）

### 6.3 工具链门禁

- [ ] `npm run typecheck` 退出码 0，零错误
- [ ] `npm run typecheck:l2` 退出码 0（领域代码只依赖 `src/l2/**` + 两个 kernel 文件）
- [ ] `npm test` 退出码 0，所有测试通过（不得有 skip/todo）
- [ ] `npm run lint` 退出码 0（0 error，warning 数量不增加）

### 6.4 覆盖矩阵完整

- [ ] `src/l2/决策与风险记录.md` 的「space-items 要求覆盖证据表」已产出
- [ ] requirements 1–14 每组每条均有（文件:函数、诊断码或字段名）证据
- [ ] 证据表中不得出现"应该""可能""大概"等模糊表述

### 6.5 交接项清单

- [ ] 所有自主判断已记录（格式 H-0N）
- [ ] 所有需上游改动的路径已写交接项（格式 T-0N），不得跨 Spec 强改实现
- [ ] 已明确待汇合边界（如 §3 矩阵中标 ◐ 的缺面）及其 owner

### 6.6 文档同步

- [ ] `src/class/<族>/index.json` 的修正与补齐已完成（任务 3）
- [ ] 修正不与既有 `src/class/__tests__/formal-data-integrity.test.ts` 冲突
- [ ] D-016 已移除状态清单与目录一致（任务 0.5 差集已处置）

---

## 七、回流检查（完成后必做）

### 7.1 冲突检测

```bash
git status --porcelain | grep -E '^(UU|AA|DD)' && echo "CONFLICT DETECTED" || echo "No conflicts"
```

### 7.2 类型检查

```bash
npm run typecheck && npm run typecheck:l2
```

### 7.3 测试门禁

```bash
npm test -- test/l2/space-items  # 先跑领域测试
npm test  # 再跑全量
```

### 7.4 Lint 门禁

```bash
npm run lint
```

### 7.5 覆盖审计

- 核对 `test/l2/space-items/properties/` 下是否恰有 14 个文件（P01–P14）
- 运行 `npm test -- --reporter=verbose | grep 'Property'` 确认 14 个性质标签全部出现

### 7.6 生成差异报告

```bash
git diff --stat origin/master -- src/l2 test/l2/space-items src/class | tee space-items-diff-summary.txt
```

### 7.7 更新主状态板

- 将 PT-08b 状态从"进行中"改为"已完成"
- 在 `docs/00_主状态板.md` 追加完成时间、测试数量、DoD 检查结果

---

## 八、风险与缓解

### 8.1 已知风险

| 风险 | 缓解措施 | 责任 |
|------|---------|------|
| 五个死代码模型文件的既有内容与 requirements 不一致 | 任务 1.1–1.5 逐文件核对，发现不一致改实现（不改断言迁就） | 执行者 |
| 既有通用规则与领域规则重复产出诊断 | 任务 4 明确"只补差集"，并用"同一 (定义, 路径, 代码) 只能出现一次"断言守卫 | 执行者 |
| `vehicles/index.json` 的 Q-04 与 D-038 冲突 | 任务 3.2 按 D-038 改为定值 `false`，与任务 4.7 同步 | 执行者 |
| PT-09 可能同时修改 `src/class/__tests__/` | 开工前 `git status` 检查，发现冲突先合并 | 执行者 |
| 并行会话正在写 `src/l2/**` | 开工前检查活跃分支，发现冲突停止本线 | 协调者 |

### 8.2 退出条件（不可抗力）

- l2 侧端口冻结时间窗内频繁变更（如 PT-02 回退）
- 引擎层 `ERR_CODES` / `OpRegistry` 被其他线大幅修改
- D-058 裁决被项目所有者推翻

---

## 九、权威执行清单（串行，73 个任务）

**完整任务列表**见 `.kiro/specs/wakeup-space-items/tasks.md`（414 行）。

核心路径（简化）：
1. 任务 0：基线核验（5 个子任务）
2. 任务 1：领域模型接线与测试（6 个子任务，含无死代码守卫）
3. 任务 2：领域契约扩展（1 个任务，单文件）
4. 任务 3：目录数据修正（4 个子任务）
5. 任务 4：领域验证规则（8 个子任务，8 个新文件）
6. 任务 5：引用能力形状（1 个任务）
7. 任务 6：运行时适配（2 个子任务）
8. 任务 7：集成契约与投影（2 个子任务）
9. 任务 8：测试（3 个子任务，约 50+ 测试文件）
10. 任务 9：全量门禁（1 个任务）

**每个子任务的 DoD 与 Requirements/Properties 映射**见 tasks.md §3 覆盖矩阵与各任务 DoD 小节。

---

## 十、参考资料

- `.kiro/specs/wakeup-space-items/requirements.md`（14 组要求，权威）
- `.kiro/specs/wakeup-space-items/design.md`（1246 行，权威）
- `.kiro/specs/wakeup-space-items/tasks.md`（414 行，执行清单，权威）
- `docs/访谈决策记录.md`：D-056、D-057、D-058、D-038、D-040、D-030 等空间物品相关裁决
- `docs/L0_规范宪法.md`：三层架构定义、引擎层铁律、基类层判定标准
- `.kiro/steering/架构决策原则.md`：解耦优先、基层长远
- `.kiro/steering/work-principles.md`：不省 token、不做 MVP、阶段结果汇报实事求是

---

**生成说明**：本 Prompt 可直接复制到新会话执行。执行者应先阅读 §二（就绪确认）确认全部前置满足，再按 §九 权威执行清单逐任务推进，严格遵守 §五 行为契约，最后按 §七 回流检查验收。

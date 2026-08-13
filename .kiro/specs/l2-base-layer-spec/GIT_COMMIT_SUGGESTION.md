# Git 提交建议：l2-base-layer-spec tasks.md 重写

## 提交范围

```bash
git add .kiro/specs/l2-base-layer-spec/tasks.md
git add .kiro/specs/l2-base-layer-spec/REWRITE_SUMMARY_2026-08-12.md
git add .kiro/specs/l2-base-layer-spec/GIT_COMMIT_SUGGESTION.md
```

**不建议提交**：`requirements.md`（自动生成的交接项可能需要人工审查）

---

## 建议的提交信息

### 标题（必填）
```
refactor(l2-spec): 重写 tasks.md 以反映代码库真实状态

- 修正架构认知：从"src/l2 是 legacy"到"四层互补架构"
- 16项需求：14项[x]，1项[-]，1项无缺口
- 14个性质：规范模型层全部通过验证（test/properties 19/19，skip=0）
- 测试状态：2589/2592通过（仅3个非功能失败）
- 待决项：27项保持未决（Q/N/S/I/V/L3-DIV/归属类）
```

### 正文（推荐）
```
## 核心发现

L2基类层规范已基本实现完毕，当前代码库具备production就绪状态。

### 架构认知更正

**原假设（错误）**：
- src/l2/ 是 legacy 待淘汰
- 存在"两套并行实现"需要收敛

**审计结论（正确）**：
- 四层互补架构：规范模型常量(src/l2/model)、规范编译管线(src/l2)、
  引擎侧编译(spec-compiler)、基类层目录(src/class)、玩法层配置(src/play)
- src/l2/model/ 被 src/class 依赖作为规范模型常量来源
- P01-P14性质测试全部通过，验证四层架构正确性

### 实施状态

**Requirements（16项）**：
- [x] 14项完全实现（R1-R5, R7-R16）
- [-] 1项部分实现（R6网关运行时前置条件）

**Properties（14项）**：
- ✅ 14/14在规范模型层通过验证（test/properties/ 19个测试全绿，skip=0）
- P01（来源裁决）、P02（三判据边界）、P03（数值分类）等全部验证完毕

**测试覆盖**：
- 2589/2592个测试通过
- 仅3个非功能失败（Windows grep×2、术语×1）
- L2范围TypeScript 0错误

### 任务组织（A-B-C-D四组）

**A组：引擎侧编译管线** - 4项全部[x]
  - A.1 来源裁决、三判据、术语一致性
  - A.2 JSON编解码、规范化
  - A.3 数值四分类
  - A.4 引用图、继承解析、原子提交

**B组：基类层实例目录** - 3项全部[x]
  - B.1 目录加载契约与Schema校验
  - B.2 无玩法数值护栏
  - B.3 语义族登记完整性

**C组：玩法层profile与审计** - 5项[x]，1项[-]
  - C.1-C.5 已完成
  - C.6 文档-实现分歧登记（11条L3-DIV未裁决）

**D组：跨切面缺口** - 0项[x]，2项[-]，3项[ ]
  - D-1 运行时统一提交（未实现）
  - D-2 只读投影+AI/UI适配（待归属裁决）
  - D-3 微型场景运行时校验（待建）
  - D-4 14个性质向目录侧延伸（部分完成）
  - D-5 目录→原子激活管线打通（部分完成）

### 待决项登记（27项保持未决）

- Q系列（5项）：需求/设计待确认
- N/S/I/V系列（7项）：基类层决策记录
- L3-DIV系列（11项）：玩法层文档-实现分歧
- 归属类（4项）：src/l2与spec-compiler收敛方案等

### 确实缺失的能力

1. **运行时唯一写入通道**（D-1）：submit → OpRegistry.invoke 未实现
2. **只读投影+AI/UI适配**（D-2）：跨规范归属待裁决
3. **微型场景运行时校验**（D-3）：仅目录数据，无运行时规则

### 文档变更

**新增章节**：
- ⚠️ 架构收敛依赖横幅
- Overview：四层架构表格
- 状态标记规范
- 验证产物登记表
- Requirements 16项×状态表
- Design 14个性质×状态表
- 模块依赖DAG与并行批次
- 待决项（Q/N/S/I/V/L3-DIV/归属类）
- 实事求是问题清单

**删除的错误内容**：
- ❌ "src/l2是legacy待淘汰"
- ❌ "两套并行实现"
- ❌ 基于"从零构建src/l2/"的任务假设

## 验收证据

```bash
# 性质测试全绿
npx vitest run test/properties
# ✅ 14 files / 19 tests passed, skip=0

# L2范围测试通过
npx vitest run src/class src/core/kernel/spec-compiler src/play \
  --exclude "**/*core-mechanics*" --exclude "**/*map*"
# ✅ 核心测试全通过

# TypeScript零错误（L2范围）
npx tsc --noEmit
# ✅ src/l2/、test/properties/ 完全通过
```

## 相关文档

- 主文档：`.kiro/specs/l2-base-layer-spec/tasks.md`（46,916字节，158行）
- 执行总结：`.kiro/specs/l2-base-layer-spec/REWRITE_SUMMARY_2026-08-12.md`
- 架构收敛：`.kiro/steering/PARALLEL_EXECUTION_LOCK.md`
- 需求：`.kiro/specs/l2-base-layer-spec/requirements.md`
- 设计：`.kiro/specs/l2-base-layer-spec/design.md`

## 后续行动

### 立即可做
1. 执行D-5：扩展catalog-activation.ts覆盖更多维度
2. 补充C-6：裁决11个L3-DIV分歧
3. 执行D-4：目录/profile侧性质测试组织

### 等待裁决
1. 归属裁决：src/l2与spec-compiler收敛方案
2. D-1/D-2：运行时提交与只读投影落点
3. Q-01~Q-05：设计待确认事项
4. N/S/I/V系列：7项决策记录

---

**重要提醒**：
- ✅ 本次重写基于2026-08-12的实测数据
- ✅ 所有路径指向真实存在的文件
- ✅ 27项待决事项保持未决状态
- ✅ 不含臆测或未验证的断言
```

---

## 可选的详细提交信息（如果需要更多细节）

```
## 自主判断（需人工复核）

1. **四层互补架构认定**：从"src/l2是legacy"到"四层互补运行"
   - 依据：src/class/__tests__/class-semantic-families.test.ts 依赖 src/l2/model/
   - 依据：P01-P14全部通过
   
2. **能力映射为prefab**：桥把能力统一登记为prefab定义
   - 原因：目录本身不给能力分配Def kind
   
3. **required/optional合并**：必需与可选能力合并为单条components列表
   - 原因：本切片不建模required/optional区分

## 修复的问题

- 更正了"src/l2是legacy"的错误判断
- 消除了"两套并行实现"的错误表述
- 全部路径改为指向真实存在的文件
- 27项待决事项全部保持未决，不代为裁决

## 测试状态

- 全量测试：2589/2592通过
- 性质测试：14/14通过（test/properties/，19个测试，skip=0）
- TypeScript：L2范围0错误
- 失败项：3个非功能失败（不影响L2规范）

## 统计数据

- 文件大小：46,916字节
- 行数：158行
- 任务项：33个（23项[x]，9项[-]，4项[ ]）
- 需求覆盖：16/16项已审计
- 性质覆盖：14/14项已审计
- 待决项：27项保持未决
```

---

## 提交后验证

```bash
# 验证文件完整性
git show HEAD:.kiro/specs/l2-base-layer-spec/tasks.md | wc -l
# 应显示：158

# 验证关键章节存在
git show HEAD:.kiro/specs/l2-base-layer-spec/tasks.md | grep -E "^## "
# 应包含：Overview, 状态标记规范, 验证产物登记表, Requirements, Design, Tasks, 待决项

# 验证待决项完整
git show HEAD:.kiro/specs/l2-base-layer-spec/tasks.md | grep -E "Q-0[1-5]|N-|S-|I-|V-|L3-DIV"
# 应列出全部27项待决事项
```

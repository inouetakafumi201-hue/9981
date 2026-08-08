# 跨 Spec 冲突审查：UGC 声明式接入职责重叠

> 触发来源：wakeup-ugc 任务 11.1/11.3（真实上游集成）执行时发现。
> 记录时间：2026-08-08。状态：**待人工裁决**。
> 关联文档：`.kiro/specs/wakeup-ugc/实施基线与决策记录.md`（架构冲突章节）。

---

## 一、结论先行：这是结构性问题，不是接口问题

**判定：结构性问题（职责所有权重复）。接口差异只是它的下游症状。**

判据：`src/core/ugc/**`（wakeup-ugc）与 `src/l2/ugc/**`（l2-base-layer-spec）
**各自独立实现了"UGC 声明式接入"这同一个职责**，且两个 Spec 都为它写了规范要求：

- wakeup-ugc：Requirements R1–R16，核心 R3「单一候选与统一验证入口」、R13「不可伪造产物 + 原子激活」。
- l2-base-layer-spec：`src/l2/ugc/ugc-adapter.ts` 的 `fromUgc` 明确声称满足其 Requirements 11.8–11.12。

**两处都自称"唯一统一入口",这在同一代码库里不可能同时为真。** 这不是"同一架构、两种函数签名"
（那才是接口问题），而是"两套架构、各占一份职责"。用适配器桥接不但不能消除重复，反而会新增
第三条跨界绑定，把重复固化得更深。

---

## 二、接口层 vs 结构层，逐项拆开

### 2.1 可用适配器桥接的部分（纯接口差异）

| 差异 | 是否可桥接 | 代价 |
|---|---|---|
| l2 `activate(registry, package)` 返回不可变新注册表 | ✅ 可被 wakeup-ugc 的 `DefinitionRegistryGateway` 包裹，并在外层补 baseline-CAS | 中等 |
| l2 `validateFullPackage` 融合了验证+解析 | ⚠️ 可包成单一 `DefinitionValidationGateway`，但会架空 wakeup-ugc 的独立 resolve 阶段 | 中高 |
| `ValidatedChangeSet` ↔ `DefinitionPackage` 形状转换 | ⚠️ 可写，但非平凡 | 中 |

### 2.2 无法用适配器解决的部分（结构性）

| 冲突 | 为什么适配器解决不了 |
|---|---|
| **UGC 接入被实现了两遍**（`src/core/ugc/` 与 `src/l2/ugc/`） | R3「单一入口、无旁路」是**代码库级**约束。现在有两个入口。加适配器 = 新增第三条连接，使"单一"更假 |
| **两个 Spec 都对 UGC 接入拥有规范条款** | 规范所有权重叠。要么合并要么一方降级，这是 Spec 编辑决定，不是工程细节 |
| **一致性模型不兼容** | wakeup-ugc R13/R3.8 把 branded 产物 + baseline-CAS + stale-baseline 拒绝作为**安全属性**；l2 的 `activate` 根本没有 baseline 概念。若 l2 权威，则 R13 的安全保证消失；若 wakeup-ugc 权威，则 l2 的 `fromUgc` 必须降级 |

---

## 三、立刻停掉的行为（因为是结构性问题）

在裁决给出**之前**，以下行为必须停止，否则重复会越挖越深、后续合并成本越来越高：

1. **停止在两个位置并行发展 UGC 接入。** 具体：
   - **停止扩张 `src/l2/ugc/**` 作为独立接入编排器**（`fromUgc → parsePackage` 这条"自成一套的入口"）。
     l2 继续把 codec / validator / resolver / registry 作为**可被消费的部件**导出是可以的；但它不应
     **同时**再占据 wakeup-ugc 所拥有的"来源适配 + 统一接入编排"角色。
   - wakeup-ugc 侧**已停止** 11.1/11.3，不对 l2 做任何耦合（见实施基线记录 §1.2.5）。
2. **停止把任何一方宣称为"唯一 UGC 入口/已交付完成"**。当前两个 Spec 都声称 R「单一统一入口」，
   在裁决前这个说法对任意一方都不成立。
3. **不要写 wakeup-ugc 任务 11.1 的适配器**。在结构未定前写桥接，等于跨一条未裁决的边界新增绑定，
   会把重复固化，且 l2 仍在活跃改动（`definition-registry.ts` 距发现时约 2.5 分钟前才改）。
4. **停止让 l2 与 wakeup-ugc 各自独立演进 UGC 相关的 requirements/design**，避免规范层面继续分叉。

---

## 四、需要专门处理的事（裁决选项）

建议单独起一个跨 Spec 裁决会话，从以下三选一，并同步修订**两个** Spec 的 requirements/design：

- **方案 A：wakeup-ugc 消费 l2 端口。** l2 额外导出符合 wakeup-ugc `design.md` 的四端口冻结形状
  （离散 `validate`/`resolve` 网关 + 带 baseline-CAS 的 `activateAtomically`），并**移除/降级** `src/l2/ugc`
  的独立接入角色。wakeup-ugc 再写 11.1 适配器。保留 R13 安全属性。
- **方案 B：l2 吸收 UGC 接入。** 承认 l2 已实现 UGC 接入，则 wakeup-ugc 的 R1–R16 与 `src/core/ugc/**`
  应被**归档或重定义**，并把 R13 的 branded/CAS 安全属性**移植进 l2** 或显式放弃。此路要评估安全属性损失。
- **方案 C：明确分工并存。** 一份裁决文档界定边界：例如 wakeup-ugc 只负责"来源无关的候选规范化 +
  技术配额 + 禁止执行构造前置",把 Schema/验证/解析/激活整体委托 l2；`src/l2/ugc` 降级为 l2 内部测试便利。
  需要同时改两个 Spec 的 requirements 以消除"双入口"表述。

### 裁决所需输入

1. R13（不可伪造产物 + baseline-CAS + stale-baseline 拒绝）是否为**不可放弃**的安全属性？
   - 是 → 倾向方案 A 或 C（保留 wakeup-ugc 的提交守卫）。
   - 可放弃 → 方案 B 可行。
2. l2 的 `activate(registry, package)` 是否愿意接受"由 wakeup-ugc 在其外层补 baseline-CAS"？
3. `src/l2/ugc/` 是 l2 的正式交付职责，还是仅测试便利？（决定它该降级还是保留）

---

## 五、当前不受此冲突影响、保持有效的产出

wakeup-ugc 的本地实现（任务 1–10、11.2/11.4/11.5/11.6、12）完整、自洽、全绿，且**未对 l2 做任何
假设性耦合**：它通过失败关闭端口 + 合规替身证明了自身编排逻辑正确。无论裁决走哪个方案，这部分
的模型、配额、解码、规范化、迁移、诊断、性质测试都可复用或平移，不会因裁决而作废。

---

## 六、裁决结果（2026-08-08，已确认）

**采纳方案 A：wakeup-ugc 消费 l2 端口。**

裁决理由（用户确认）：方案 A 更解耦；优先采取**更长远的全局决策，尤其在基层**。

### 确立的原则（长期适用，需记住）

> 面对跨层/跨 Spec 的取舍，优先选择**解耦更彻底、对基层更长远稳定**的方案，即使短期工程量更大。
> 基层（引擎层 / 基类层）的决策要以"上层可长期复用、可独立演进"为准绳,不为短期便利牺牲边界清晰度。

### 方案 A 下的职责划分

| 侧 | 义务 | 归属会话 |
|---|---|---|
| wakeup-ugc | 在 `src/core/ugc/integration/` 写真实适配器，把 l2 的实际导出适配到 wakeup-ugc 的冻结端口接口背后；补 baseline-CAS（已在 `AtomicActivationCoordinator` 实现）；写 `full-pipeline.integration.test.ts`（任务 11.1/11.3） | 本会话 |
| l2-base-layer-spec | 逐步导出符合 wakeup-ugc `design.md` 的四端口冻结形状；**降级 `src/l2/ugc`** 的独立接入编排角色，只保留 codec/validator/resolver/registry 作为可消费部件 | l2 会话（交接项，非本会话执行） |

### 本会话的边界（避免破坏性跨 Spec 动作）

- **不删除、不改写 `src/l2/ugc/**` 或任何 l2 文件**：那是 l2 Spec 的交付物，且有并行会话在处理文档问题。
  `src/l2/ugc` 的降级作为**交接项**记录，由 l2 会话执行。
- 本会话只在 `src/core/ugc/integration/` 内写适配器,**单向依赖** l2 的公共导出。
- 适配器对**外**暴露的是 wakeup-ugc 的冻结端口接口;对 l2 的绑定藏在适配器**内部**。这样等 l2 将来
  导出正式冻结端口时,只需改适配器内部,wakeup-ugc 的其余部分零改动——这正是"解耦更彻底"的落地。

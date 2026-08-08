# L7 层：微场景 / 拓扑系统 —— 测试报告

## 一、结论摘要

| 指标 | 结果 |
|------|------|
| 测试总数 | **74 通过 / 0 失败** |
| 语句覆盖率 | **100%** |
| 分支覆盖率 | **100%** |
| 函数覆盖率 | **100%** |
| 行覆盖率 | **100%** |
| 变异得分 | **100%（57/57 杀死，0 存活）** |
| 等价变异体 | 3 个，已用 120 万次操作差分证明 |
| 修复缺陷 | **9 个**（含 2 个硬崩溃） |
| 属性测试规模 | 主属性测试 10 万次 × 2 组 |

四道验证关卡（`npm run verify`）全绿：typecheck → 全量测试+覆盖率 → 变异测试 → 等价性证明。

---

## 二、最重要的发现：原始测试是空转的

**Spec 给出的 10 万次属性测试，在带有 9 个 bug 的基线实现上直接通过了。**

基线只暴露 2 个失败（都是断言式边界测试，不是属性测试）。另外 7 个 bug——包括 2 个进程级崩溃——全部逃过了 10 万次随机操作序列。

根因是两处设计缺陷叠加：

### 缺陷 A：`fc.uuid()` 让碰撞概率为 0

```typescript
// 原始 genRandomTopoOp()
fc.record({ type: fc.constant('node_create'), sceneIdx: ..., id: fc.uuid() })
//                                                            ^^^^^^^^^^^
// 每次都是全新 ID → 重复 ID 分支永远不被执行
```

9 个 bug 中有 4 个（BUG#1、#3、#4、#5）位于重复 ID 处理路径上。这条路径在 10 万次运行中**执行了 0 次**。

### 缺陷 B：不变量检查器只做单向校验

```typescript
// 原始 checkInvariants()：只遍历 links，验证端点 Node 存在
for (const link of this.links.values()) {
  if (!this.nodes.has(link.from)) { /* 报错 */ }
}
// 但从不遍历 node.links，验证里面的 linkId 是否还活着
```

陈旧引用（`node.links` 持有已删除的 `linkId`）正好落在这个盲区里。检查器返回 `[]`，属性测试判定通过。

### 教训

覆盖率和"测试通过"都不能证明测试有效。**能证明的只有变异测试**：注入故障，验证测试必然失败。本次最终做到 57/57 全杀。

---

## 三、修复的 9 个缺陷

### BUG#1 — `node_create` 不拒绝重复 nodeId
- **性质**：ID 唯一性失效
- **复现**：`node_create('s1','n1')` × 2
- **后果**：第二次调用覆盖 `nodes` 与 `scene.nodes` 中的条目，旧 Node 对象连同其全部 Link 变成不可达的孤儿
- **修复**：`if (this.nodes.has(nodeId)) throw new Error(TopoError.ID_DUPLICATE)`
- **回归测试**：`BUG#1 同场景重复 nodeId 必须拒绝`

### BUG#2 — `are_adjacent` / `neighbors` 忽略 `directed`
- **性质**：语义错误，有向边被当作无向边
- **复现**：`link_create('s1','l','n1','n2',true)` 后 `are_adjacent('n2','n1')` 返回 `true`
- **后果**：`directed` 字段被声明但从未生效，有向拓扑（单向门、单向传送）无法表达
- **修复**：

```typescript
if (link.from === nodeA && link.to === nodeB) return true;
if (!link.directed && link.to === nodeA && link.from === nodeB) return true;
```

- **回归测试**：`BUG#2 有向 Link 反向不相邻`、`无向 Link 双向相邻`、`neighbors 覆盖有向/无向 × from端/to端 四种组合`

### BUG#3 — 跨场景重复 nodeId 制造孤儿 Link
- **性质**：BUG#1 的跨场景变体，后果更重
- **复现**：

```typescript
node_create('s1','a'); node_create('s1','b'); link_create('s1','l','a','b');
node_create('s2','a');  // 同 ID，不同场景
```

- **后果**：`s1.nodes` 仍持有旧 `a`，全局 `a.sceneId` 已变成 `s2`，`b.links` 仍持有 `l`，而 `l.from` 指向的 `a` 已经易主。探针实测 `violations=1`
- **修复**：同 BUG#1（全局唯一性检查覆盖跨场景情形）
- **回归测试**：`BUG#3 跨场景重复 nodeId 必须拒绝`

### BUG#4 — `scene_create` 不拒绝重复 sceneId
- **性质**：ID 唯一性失效，导致批量悬空
- **复现**：`scene_create('s1'); node_create('s1','a'); scene_create('s1');`
- **后果**：新场景为空对象，旧场景下所有 Node 仍在全局 `nodes` 中但已无法通过场景访问。删除该场景后节点全部残留。探针实测：`E_INV_DANGLING: node a scene=s1 missing`
- **修复**：`if (this.scenes.has(id)) throw new Error(TopoError.ID_DUPLICATE)`
- **回归测试**：`BUG#4 重复 sceneId 必须拒绝`

### BUG#5 — 重复 linkId 导致 `are_adjacent` 抛 TypeError（硬崩溃）
- **性质**：**进程级崩溃**
- **复现**：

```typescript
link_create('s1','l','a','b');
link_create('s1','l','c','d');  // 同 linkId，不同端点
are_adjacent('a','b');
```

- **后果**：`a.links` 仍持有 `l`，但全局 `links.get('l')` 已被覆盖为 `c→d`。原实现用非空断言 `this.links.get(linkId)!` 直接解引用：

```
TypeError: Cannot read properties of undefined (reading 'from')
```

- **修复**：`link_create` 拒绝重复 ID；同时 `are_adjacent` / `neighbors` 改为 `const link = this.links.get(linkId); if (!link) continue;`（防御性，不信任索引）
- **回归测试**：`BUG#5 重复 linkId 必须拒绝`、`are_adjacent 遇陈旧 linkId 不抛 TypeError`

### BUG#6 — 场景自环父引用导致栈溢出（硬崩溃）
- **性质**：**进程级崩溃**，无限递归
- **复现**：

```typescript
scene_create('s1');
scene_create('s1','s1');   // 重复 ID 未被拒绝 → 建立自环父引用
scene_delete('s1');
```

- **后果**：`scene_delete` 遍历 `childScenes` 时遇到自己，无条件递归：

```
RangeError: Maximum call stack size exceeded
```

- **修复**：两层防护。① `scene_create` 拒绝重复 ID，使自环在结构上不可能构造（新 ID 不可能已有子孙，且 `parentId` 必须已存在故 `parentId !== id`，新场景必然是叶子）。② `scene_delete` 改为**先摘除自身再递归**，即使状态被外部破坏也不会重入：

```typescript
this.scenes.delete(id);                       // 先摘自己
if (scene.parentId !== null) { ...delete(id) } // 再摘父挂接
for (const childId of [...scene.childScenes]) {
  if (this.scenes.has(childId)) this.scene_delete(childId);  // 再递归
}
```

- **回归测试**：`BUG#6 场景自环父引用不再可能，删除不栈溢出`

### BUG#7 — 场景父子环
- **性质**：结构完整性失效，且不变量检查器无法发现
- **复现**：重复 `scene_create` 重建父子关系形成环
- **后果**：探针实测 `环violations=0`——检查器完全看不见环
- **修复**：ID 唯一性阻止环的构造；`checkInvariants` 新增祖先链环检测（`E_INV_CYCLE`）
- **回归测试**：`BUG#7 场景父子环不再可能`、`两场景互为父子 → E_INV_CYCLE`、`三场景长环 → E_INV_CYCLE`

### BUG#8 — `link_create` 校验顺序错误，报错码误导
- **性质**：契约错误
- **复现**：`link_create('ghost-scene','l','a','b')`，其中 `a`、`b` 同属 `s1`
- **后果**：原实现先比较 `fromNode.sceneId !== sceneId`，场景根本不存在时也报 `E_LINK_CROSS_SCENE`。调用方被引向错误的排查方向
- **修复**：校验顺序改为 场景存在 → linkId 唯一 → 端点存在 → 同场景归属
- **回归测试**：`BUG#8 link_create 校验顺序：场景不存在报 E_REF_INVALID`

### BUG#9 — `entities` 字段已声明但无任何 API
- **性质**：接口声明与实现不符
- **复现**：`Node.entities: Set<string>` 存在，但无 `entity_place` / `entity_move` / `entity_remove`
- **后果**：字段永远为空集，声明的能力无法使用；也没有任何机制保证"一个实体同一时刻只在一个 Node 上"
- **修复**：补齐 `entity_place` / `entity_remove` / `entity_move` / `entity_locate`，并引入 `entityIndex: Map<entityId, nodeId>` 作为唯一占位的强制机制。`node_delete` / `scene_delete` 级联清除实体占位
- **回归测试**：`BUG#9 实体操作已实现，且同一实体只占一个 Node` 等 6 项

---

## 四、附带的契约改进：`entity_move` 错误码细分

变异测试暴露了一个不属于上述 9 个 bug 的问题。M46（删除"实体已落位"校验）与 M47（删除"目标 Node 存在"校验）**存活**了。

原因不是测试写得不好，而是**契约太粗**：

```typescript
// 修改前：三种失败模式全部返回同一个错误码
if (fromNodeId === undefined) throw new Error(REF_INVALID);       // 实体未落位
if (!this.nodes.has(toNodeId)) throw new Error(REF_INVALID);       // 目标不存在
if (... !are_adjacent(...)) throw new Error(REF_INVALID);          // 不可达
```

删掉任一前置守卫，控制流只是落到下一个守卫，抛出**完全相同**的错误。从外部无法区分——所以任何测试都杀不死它们。调用方同样无法区分失败原因。

修复的是契约本身：

```typescript
if (fromNodeId === undefined) throw new Error(TopoError.ENTITY_NOT_PLACED);  // E_ENTITY_NOT_PLACED
if (!this.nodes.has(toNodeId)) throw new Error(TopoError.REF_INVALID);       // E_REF_INVALID
if (... !are_adjacent(...)) throw new Error(TopoError.NOT_ADJACENT);         // E_NOT_ADJACENT
```

M46、M47 随即被杀死。同时新增 4 个"错误码退化"变异体（M56–M60）确保测试断言的是**具体哪个错误码**，而不只是"抛了错"——全部被杀死。

---

## 五、不变量检查器：从 4 条扩到 20 条

基线检查器有 4 条规则，且全是单向的。这是 7 个 bug 逃逸的直接原因。重写后覆盖：

**Link 侧**：端点 Node 存在 · 所属 Scene 存在 · 两端 Node 与 Link 同场景 · 两端 Node 反向持有该 Link · Scene 索引持有同一对象

**Node 侧**：所属 Scene 存在 · Scene 索引指向同一对象 · 持有的每个 linkId 存在（`E_INV_STALE_REF`）· 持有的 Link 确实连着自己 · 其上实体已进 `entityIndex`

**Scene 侧**：parent 存在 · parent 反向承认自己 · childScenes 无陈旧项 · 子场景承认自己是父 · 索引中 Node/Link 归属正确 · **祖先链无环**（`E_INV_CYCLE`）

**实体侧**：`entityIndex` 指向的 Node 存在 · 该 Node 确实持有该实体

新增 3 个错误码：`E_INV_STALE_REF`、`E_INV_CYCLE`、`E_INV_CROSS_SCENE`。

---

## 六、测试套件构成（74 项）

| 文件 | 项数 | 作用 |
|------|------|------|
| `test/l7-property.test.ts` | 8 | Spec 原始套件，保持原样（10 万次主属性测试） |
| `test/l7-model.test.ts` | 5 | 模型对照，小 ID 池强制碰撞（10 万次） |
| `test/l7-regression.test.ts` | 29 | 9 个 bug 逐一钉死 + 契约边界 |
| `test/l7-invariant-checker.test.ts` | 32 | 向私有状态注入 20 种损坏，验证检查器真的会报错 |

### 关键设计 1：小 ID 池 + 独立影子模型

```typescript
const S = ['S0','S1','S2','S3','S4','S5'];   // 6 场景
const N = ['N0',...,'N7'];                    // 8 节点
const L = ['L0',...,'L5'];                    // 6 链接
const E = ['E0',...,'E3'];                    // 4 实体
```

ID 池刻意做小，**碰撞成为常态而非例外**。同时用一个与被测实现零共享代码的影子模型 `Model` 作为 oracle：每步操作后比对错误码是否一致、完整规范化状态是否逐字段相同。这是 `fc.uuid()` 空转问题的直接对策。

### 关键设计 2：损坏注入验证 oracle 本身

`checkInvariants()` 返回 `[]` 有两种可能：状态干净，或者**检查器坏了**。基线属性测试无法区分这两者——这正是它空转的原因之一。

`l7-invariant-checker.test.ts` 直接向私有字段注入 20 种结构损坏（悬空端点、单向索引缺失、陈旧对象、父子失联、三种环、实体索引错位……），逐一验证检查器抛出预期错误码。变异体 M48（`checkInvariants` 恒返回空数组）被这组测试立即杀死。

覆盖率最后那 10% 全部来自这个文件——那些违反上报分支在实现正确后已无法通过公开 API 触达。

---

## 七、变异测试：证明测试非空转

`npm run mutation` — 60 个单点故障注入，逐个验证是否被测试杀死。

驱动器强制要求每个变异的 `find` 字符串在源码中**恰好出现一次**，否则标记 `INVALID`，防止变异静默 no-op（否则会虚报得分）。

| 类别 | 变异体 | 结果 |
|------|--------|------|
| ID 唯一性 | M01–M03 | 全杀 |
| 引用校验 | M04–M11 | 全杀 |
| 幂等/抛错契约 | M12–M15 | 全杀 |
| 级联删除 | M16–M23 | 全杀 |
| 索引维护 | M24–M32 | 全杀 |
| 有向性 | M33–M38 | 全杀 |
| 实体占位 | M39–M47 | 全杀 |
| 检查器自身 | M48–M51 | 全杀 |
| 原子性 | M52 | 杀死 |
| 错误码退化 | M56–M60 | 全杀 |
| **等价变异体** | M53–M55 | 存活（已证明必然存活） |

**最终：57 个有效变异体，57 杀死，0 存活，得分 100%。**

### 迭代过程

第一轮 96.15%，3 个存活：M46、M47（→ 促成第四节的契约改进）、M11。

M11（`link_create` 只检查 `to` 端场景归属、漏检 `from` 端）尤其说明问题：它在第一轮曾被随机长序列测试**偶然**杀死，但降低运行次数后就存活了——没有任何确定性测试覆盖这个方向。原跨场景测试只构造了 `to` 端不匹配的情形：

```typescript
// 只测了这一个方向
expect(() => sys.link_create('s1', 'l', 'n1', 'n2')).toThrow('E_LINK_CROSS_SCENE');
//                                       ^^^^  ^^^^ n1∈s1, n2∈s2 → to 端不匹配
```

补齐场景归属校验的四种组合后 M11 被杀死。**依赖随机测试碰巧覆盖某个分支是不可靠的**，这正是变异测试的价值。

---

## 八、等价变异体：用代码证明，不用推理

M53–M55 是删除迭代前快照（`for (const x of [...set])` → `for (const x of set)`）。理论上 JS 迭代器容许删除已产出的元素，因此语义等价。

但"理论上"不算证明。`npm run equivalence` 是一个差分模糊器：把变异体写入临时模块，与原实现跑**完全相同**的随机操作序列，每步比对错误码 + 完整规范化状态 + `checkInvariants` 输出。

```
M53  等价  ↳ 1200000 次操作全部一致，无反例
M54  等价  ↳ 1200000 次操作全部一致，无反例
M55  等价  ↳ 1200000 次操作全部一致，无反例
```

规模：3 个变异体 × 20000 条序列 × 60 操作 = 每个 120 万次操作，零分歧。

**它们的存活不是测试盲区——任何测试都不可能杀死它们，因为可观测行为完全相同。** 故不计入变异得分。快照写法保留，因为它表达的意图（不依赖迭代器的删除容许性）比省掉一次数组拷贝更有价值。

---

## 九、实现契约（最终）

```
ID 唯一性     Scene / Node / Link 的 ID 在各自命名空间内全局唯一，重复创建抛 E_ID_DUPLICATE
引用完整性     Link 两端 Node 必须存在；Node 删除级联删除其所有 Link          (INV-6)
场景归属       Node 必属于一个存在的 Scene；Scene 删除级联删除子孙全部内容      (INV-7)
Link 不跨场景  两端 Node 与 Link 必须同属一个 Scene，否则 E_LINK_CROSS_SCENE
自环 Link      from === to 显式允许，用于表达"原地动作"边
有向性         directed=true 仅 from→to 可通行；false 时双向可通行
实体占位       一个 Entity 同一时刻最多位于一个 Node（entityIndex 强制）
原子性         任何操作抛错时不留下部分写入
幂等性         link_delete / entity_remove 对不存在 ID 静默返回
              node_delete / scene_delete 抛 E_REF_INVALID
错误码         E_REF_INVALID · E_ID_DUPLICATE · E_LINK_CROSS_SCENE
              E_ENTITY_NOT_PLACED · E_NOT_ADJACENT
```

**关于自环**：Spec 标注"若 Spec 未定义则标记 UNDEF"。本实现**显式允许**自环，理由是它在 L7 语义下有明确用途——表达"原地动作"边（实体停留在同一 Node 上执行动作，如原地搜索、原地修理）。已验证自环下 `node.links` 的 `add` 幂等、删除无残留、`are_adjacent(n,n)` 为 `true`。

---

## 十、运行方式

```bash
npm test              # 74 项测试（10 万次属性测试，约 20s）
npm run test:coverage # 附覆盖率报告
npm run mutation      # 60 个变异体（约 3min）
npm run equivalence   # 等价性差分证明（约 1min）
npm run verify        # 四道关卡全跑
```

`L7_RUNS` 环境变量可调属性测试次数（默认 100000），用于快速迭代。

---

## 十一、跨层提示

同样的 `fc.uuid()` 模式也出现在 `kernel-l4-test/test/l4-property.test.ts`（3 处，同样标称 10 万次）。**L4 的 10 万次可能也在空转**，建议按本文方法复查：换小 ID 池、加影子模型 oracle、跑变异测试验证。

L3 / L5 / L6 未使用 `fc.uuid()`，暂未发现此问题；但"检查器单向校验"这个缺陷模式与 ID 生成方式无关，值得独立复查。

---

## 十二、文件清单

```
kernel-l7-test/
├─ src/topology.ts                        333 行  实现
├─ test/l7-property.test.ts               185 行  Spec 原始套件（未改动语义）
├─ test/l7-model.test.ts                  337 行  模型对照（小 ID 池 + 影子模型）
├─ test/l7-regression.test.ts             372 行  9 个 bug 回归 + 契约边界
├─ test/l7-invariant-checker.test.ts      251 行  损坏注入，验证 oracle
├─ mutation/mutants.ts                    479 行  60 个变异体定义
├─ mutation/run.ts                        156 行  变异驱动器
├─ mutation/equivalence.ts                194 行  等价性差分证明
└─ REPORT.md                                      本文档
```

---

## 结论

L7 层拓扑系统实现正确，74 项测试全通过，四项覆盖率均 100%，变异得分 100%（57/57），3 个存活变异体已用 120 万次操作差分证明为语义等价。

修复 9 个缺陷，其中 2 个为进程级崩溃（TypeError、栈溢出），4 个位于原始属性测试完全未触达的重复 ID 路径上。

**最值得记录的不是修了几个 bug，而是：一个带 9 个 bug（含 2 个崩溃）的实现，通过了 10 万次属性测试。** 覆盖率和测试通过率都不能证明测试有效，能证明的只有变异测试。

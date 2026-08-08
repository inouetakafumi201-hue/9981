# Design Document

## Overview

元机制内核（MetaKernel）实现为一个零渲染依赖的纯 TypeScript（strict）状态机库，位于 `src/core/kernel`。它是《起床》项目里唯一被服务端与客户端同时复用的逻辑层：服务端把它当作权威状态机运行，客户端把它当作本地预测/UI 数据源运行，两端跑的是同一份代码，不是两套协议的手工对齐（对应 [10_技术栈.md](../../../docs/L2_基类层/10_技术栈.md) 的"前后端同构"约束）。

内核本身不表达任何具体玩法（没有生命值、没有 AP、没有护甲），它只提供一套封闭的原语：状态寻址、拓扑与容纳、表达式与查询、Op 写入通道、事件与钩子、Action 与决策、Attachment、回合表、随机、认知、持久化、安全诊断。大逃杀等具体玩法作为"玩法包"（Playpack）以数据形式加载在内核之上——这是 [元机制内核Spec_v1.md](../../../docs/L1_引擎层/元机制内核Spec_v1.md) 第 17 章明确的重新定位：05/02/03/04 号文档的内容全部降级为内核之上的数据，本设计文档只覆盖内核本身。

设计贯穿两条主线（对应需求 43、44，而不是附加项）：

1. **拓扑可达性**：无论容器嵌套多深、Def 继承链多长、玩法包叠加多少个 MOD，触达任意要素所用的 Op/Query 调用形式必须保持不变。这决定了本设计不会为"嵌套的东西"设计专门的访问路径。
2. **AI 可计算性**：NPC 决策与人类玩家共用同一套 `queryActions`/`Query`/事务机制。这决定了 Action、Decision、Intent、Policy 的设计必须在数据结构层面就是"AI 能读"的形态，不是事后加适配层。

## Architecture

### 分层依赖图

内核内部严格分为 13 层，依赖关系是单向 DAG（上层可调用下层，下层不知道上层存在）。这与源设计稿第 18 章的实现顺序一致，也是测试推进的顺序——每层完成即用属性测试锁死不变量，再进下一层。

```
L13 Safety           诊断 / ErrCode / Linter / 配额 / 熔断
L12 Persistence       snapshot / journal / rewind / checkpoint / migrations
L11 Knowledge          knowledge scope / visibleTo / Agent 认知半
L10 Random             命名流 / 影子流
L9  Schedule/Playpack  ScheduleDef / PhaseDef / PlaypackDef 装载 / PolicyDef
L8  Attachment         AttachmentDef / aura / grantedBy 回收
L7  Decision/Intent     Decision / Intent / 响应相位
L6  Actions             ActionDef / queryActions / CostSpec / TargetSpec
L5  Flow                Effect 解释器 / step 预算
L4  Events/Hooks        Event / 五阶段 Hook / RuleDef / depth 上限
L3  Ops/Transactions    Op 注册表 / Result / tx / journal 记录 / 不变量校验
L2  Expr/Query          Expr 求值器 / 具名表达式 / Query 引擎
L1  State               Value / Ref / Entity / Item / Node / Link / Def / Agent / Relation / Attachment 结构 + 拓扑/容器
```

依赖规则：`L(n)` 的实现只能 import `L(1..n-1)` 与自身层内模块，不得 import 更高层或跨层直接访问私有状态。这条边界与源代码目录里 `src/core` 禁止 import React/DOM 的 ESLint 规则同构，同样应通过 `no-restricted-imports`／依赖方向 lint 规则机械强制，不依赖代码审查记忆。

### 模块目录（对现有目录结构的修订）

[10_技术栈.md](../../../docs/L2_基类层/10_技术栈.md) 原定的 `src/core/{entities,rules,modes,ugc}` 结构对应的是尚未被元机制 Spec 取代的旧三层架构（内核层/规则范式层/玩法包层）。本设计将其收敛为：

```
src/core/
  kernel/                  # 本设计文档的全部内容，13 层
    state/                 # L1：Value、Ref、Entity、Item、Node、Link、Def、Agent、Relation、Attachment 数据结构
    topology/              # L1：Container/Slot、prefab、微型场景、dist/spread
    expr/                  # L2：Expr 求值器、具名表达式、Query 引擎
    ops/                   # L3：Op 注册表、Result、tx、journal、不变量校验器
    events/                # L4：Event、五阶段 Hook 调度、RuleDef
    flow/                  # L5：Effect 解释器
    actions/               # L6：ActionDef、queryActions、CostSpec
    decision/              # L7：Decision、Intent、响应相位
    attachment/            # L8：AttachmentDef、aura 重算引擎
    schedule/              # L9：ScheduleDef、PlaypackDef 装载器、PolicyDef
    random/                # L10：RngStream、影子流
    knowledge/             # L11：knowledge scope、visibleTo
    persistence/           # L12：snapshot、replay、rewind、checkpoint、迁移
    safety/                # L13：Diagnostic、ErrCode、Linter、配额、熔断
    index.ts               # 内核对外的唯一入口，导出 Op 集合与只读通道
  ugc/                     # Def JSON 的 schema 校验器（消费 kernel/safety 的 Linter 输出，不重新定义校验规则）
  modes/                   # 玩法包数据（大逃杀等），作为普通内容消费 kernel/index.ts 导出的接口
```

`entities/` 与 `rules/` 两个旧目录不再存在：前者被 `kernel/state` + `kernel/topology` 取代，后者的内容（伤害/移动/背包等"规则范式"）现在全部是 `modes/` 下的玩法包数据（RuleDef、ActionDef 等 Def 实例），不是内核代码。`ugc/` 保留，但其校验逻辑改为复用 `kernel/safety` 的 Linter 基础设施，而不是独立实现一套数值上限检查。

### 内核与玩法包的边界

```
┌─────────────────────────────────────────────┐
│  Playpack（数据）  02大逃杀 / 未来的格斗、卡牌…    │  ← src/core/modes，本设计不覆盖
├─────────────────────────────────────────────┤
│  Kernel（本设计文档）13 层原语                    │  ← src/core/kernel
├─────────────────────────────────────────────┤
│  运行时宿主：服务端权威循环 / 客户端本地预测          │  ← server/index.ts、src/network，本设计不覆盖
└─────────────────────────────────────────────┘
```

内核对上层（玩法包）暴露的唯一契约是：一份 `PlaypackDef` 加载后，内核提供 Op 集合、`queryActions`、`Query`、五阶段 Hook 挂载点与持久化原语；内核对玩法包的内容（武器谱型、AP 池、胜负条件）一无所知。内核对下层（运行时宿主）暴露的唯一契约是：`snapshot`/`replay`/`journal`，宿主决定这些原语如何映射到网络帧或 UI 渲染，内核不关心。

### 两条主线在架构上的落点

**拓扑可达性（需求43）**不是靠某个模块单独实现，而是靠一条贯穿全部 13 层的约束：任何"访问"都必须落在三个统一入口之一——`path`（状态寻址）、`Op`（写入）、`Query`（批量读取）。无论要素被嵌套多深（容器里的容器、微型场景里的微型场景、继承链第 N 层的 Def），寻址路径的语法都不变，只是路径变长或 Query 的 `in`/`where` 多一层过滤。第 3.10 节给出该约束的机械校验方式。

**AI 可计算性（需求44）**同样不是单独模块，而是要求 L6（Actions）、L7（Decision/Intent）、L9（Policy）、L12（Persistence 的 checkpoint/restore）四层在设计时共享同一套读接口。具体落点在 3.6 节（`queryActions` 对人类与 AI 无分支）、3.9 节（PolicyDef 的 `rules` 模式直接消费 `queryActions` 输出）、3.12 节（AI 试探复用 tx/Op，不另开写入通道）。

### 写入通道唯一性（需求16.1 的贯穿校验规则）

需求16.1 的字面表述是"内核不得提供任何绕过 Op 的直接状态赋值接口"。这条约束不是 L3（Ops）单独负责的局部规则，而是对全部 13 层的横切约束：**任何一层，只要它的组件持有的方法会改变 `WorldState` 的内容**（不只是 L1 State 定义的结构区字段，也包括 L8 的 Attachment 授予/回收关系、L9 的已装载 Def 集合、L13 的规则熔断状态等运行期可变状态），该方法就必须落在以下四类合法情形之一：

| 情形 | 判据 | 例子 |
|---|---|---|
| **(a) 公开 Op** | 通过 `OpRegistry.register` 注册，外部只能经 `OpRegistry.invoke(name, args)` 调用，自动获得 Result/事务/Hook/journal | `relation.set`、`agent.bind`、`attach.add`、`decision.open`、`intent.submit` |
| **(b) Op 内部的纯函数 helper** | 不持有独立于 `WorldState` 的状态，不被 `kernel/index.ts` 之外的模块直接调用，只是某个公开 Op 实现内部拆出的私有步骤 | `stack.split` 内部的 `decrementStack`/`createItem` 私有函数 |
| **(c) 装载期例外** | 发生在 `PlaypackLoader.load` 完成之前，此时不存在正在进行的对局、没有 journal 需要记录、没有 Hook 需要拦截（因为 Hook 本身也是这次装载的产物） | `DefRegistry.register` 的继承展开；`PlaypackLoader.load` 合并 Def 集合 |
| **(d) 持久化的整体状态切换** | 替换的是整个 `WorldState` 引用（结构共享的指针切换），不是修改某个字段；这类操作在语义上是"跳到另一个已经通过 Op 达成的历史状态"，不是新的写入 | `checkpoint`/`restore`、`replay` |

任何设计不落在这四类之一的独立"管理器方法"（如"AuraEngine 自己决定要不要新增一个 Attachment"）都是需求16.1 的违反，必须重构为公开 Op 或其内部 helper。第 3 章后续小节里，凡是之前设计成独立组件方法的写操作，均已按此规则收编——具体收编方式在各小节标注。这条规则本身也是需求43"拓扑可达性"的必要条件：如果某层可以绕开 Op 直接改状态，那么该层的状态变化就不会被 journal 记录、不会触发 Hook，`queryActions`/AI 试探读到的状态就可能与实际发生的写入历史脱节——这与"任何访问都必须落在 path/Op/Query 三个统一入口"的主张互相矛盾。

## Components and Interfaces

以下按 13 层组织，每层给出核心接口签名与对应需求编号。签名是设计意图的表达，不是最终工程接口（前后置条件、序列化格式留给实现阶段）。

### 3.1 State（L1）— 需求 1、2、3、4

```typescript
type Value = null | boolean | number | string | Value[] | { [key: string]: Value } | Ref;
type Ref = { $: Id };
type Id = string; // 前缀受 IdPrefix 封闭集合约束，见 3.1.1

const ID_PREFIXES = ['e', 'i', 'n', 'l', 'c', 's', 'a', 'g', 'd', 'w'] as const;
type IdPrefix = typeof ID_PREFIXES[number];

const WORLD_REF: Ref = { $: 'w:0' };

interface Entity {
  id: Id; def: Id; tags: string[]; props: Record<string, Value>;
  node?: Id; slot?: Id; // 互斥，见 3.3 不变量校验器
  containers: Record<string, Id>; attachments: Id[];
  relations: Record<string, { out: Ref[]; in: Ref[] }>;
}

interface Item {
  id: Id; def: Id; tags: string[]; props: Record<string, Value>;
  slot?: Id; stack?: number; stackMax?: number;
  containers: Record<string, Id>; attachments: Id[];
}

interface Def {
  id: Id; kind: DefKind; extends?: Id[]; abstract?: boolean;
  tags?: string[]; props?: Record<string, Value>;
  containers?: ContainerSpec[]; slots?: SlotSpec[];
  actions?: Id[]; rules?: Id[];
  clamp?: Record<string, { min?: number; max?: number; int?: boolean }>;
  schema?: Record<string, PropSchema>;
}
type DefKind = 'entity'|'item'|'node'|'link'|'attachment'|'action'|'rule'
  |'playpack'|'decision'|'prefab'|'expr'|'schedule'|'policy';

interface DefRegistry {
  register(def: Def): Result<void>;                 // 装载期例外（写入通道情形c）：拒绝环继承（需求3.4）
  resolve(id: Id): Def | null;                        // 已展开继承的最终 Def（需求3.3），纯读
  isA(ref: Ref, defId: Id): boolean;                  // 沿继承链判断（需求12.7），纯读
}

// 需求6：Relation 独立于 props，支持反向查询与级联清理
interface Relation { kind: string; from: Ref; to: Ref; props?: Record<string, Value>; }
// RelationIndex 是纯读索引 + 两个 Op 的内部 helper（写入通道情形b），不对外暴露写方法
interface RelationIndex {
  relOut(ref: Ref, kind: string): Ref[]; // 需求6.5，纯读
  relIn(ref: Ref, kind: string): Ref[];  // 需求6.4，纯读
}
```

`RelationIndex.set`/`del` 在早前草案中曾作为公开方法出现——这违反需求16.1（唯一写入通道）：关系的建立与移除必须经过公开 Op `relation.set(from, to, kind, props?)` 与 `relation.del(from, to, kind)`（需求条款未列出但 Op 全集要求，见 3.4 节 Op 注册表），`RelationIndex` 收编为这两个 Op 内部调用的私有索引更新函数，只保留 `relOut`/`relIn` 两个纯读方法对外可见。`DefRegistry.register` 属于情形(c)装载期例外：它只在 `PlaypackLoader.load` 完成前被调用，此时没有正在进行的对局、没有 journal、没有 Hook（Hook 本身也是这次装载的产物），因此不需要经过 `OpRegistry`。

`RelationIndex` 与 `Entity.relations` 字段是同一份数据的两个访问面：`Entity.relations[kind]` 存的是该实体自身参与的关系的正向/反向切片，`RelationIndex` 是全局索引，`relation.set`/`relation.del` 两个 Op 同时更新二者，保证需求6.2（对称镜像，也是需求20.8 的不变量来源）不需要调用方手动维护双向一致性。销毁 Ref 指向的对象时（需求6.6），`RelationIndex` 在 `entity.destroy`/`item.destroy` 的 `after` 阶段自动扫描并移除以该 Ref 为 `from` 或 `to` 的全部 Relation，不要求玩法包在 Hook 里手写清理逻辑。

**设计决策**：Value/Ref 的判别在运行时用一个 `isRef(v)` 谓词（检查 `typeof v === 'object' && '$' in v`）完成，不引入额外的 tagged union 包装，因为 Value 需要与 JSON 直接互转（UGC 数据是 JSON）。`ID_PREFIXES` 作为 `as const` 数组是唯一真相源，`IdPrefix` 类型与运行时前缀校验都从它派生，避免类型声明与运行时检查出现两份来源（这类双份声明正是源设计稿 18.1 节反复揪出的"引用悬空"模式）。

继承展开（需求3.1-3.3）在 `DefRegistry.register` 时完成：对每个新注册的 Def，沿 `extends` 数组顺序深拷贝父 Def 字段，后者覆盖前者，结果缓存在 `resolve()` 返回值里，运行期 `resolve` 是 O(1) 查表，不重新展开。

### 3.2 Topology（L1 续）— 需求 7、8、9、10、11

```typescript
interface Node {
  id: Id; def: Id; tags: string[]; props: Record<string, Value>;
  weight: number; parent?: Id; attachments: Id[];
}
interface Link {
  id: Id; a: Id; b: Id; directed: boolean; weight: number;
  tags: string[]; props: Record<string, Value>; attachments: Id[];
}

interface Container {
  id: Id; owner: Id; name: string; slots: Slot[];
  insert: 'fixed' | 'shift'; props: Record<string, Value>;
}
interface Slot {
  id: Id; tags: string[]; accepts?: Expr; holds?: Ref; props: Record<string, Value>;
}

interface TopologyIndex {
  dist(a: Id, b: Id, opts?: { via?: Expr; maxCost?: number; metric?: 'sum'|'hops' }): number | null;
  spread(origin: Id, budget: number, opts?: { decay?: Expr; via?: Expr; metric?: 'sum'|'hops' })
    : { node: Id; strength: number; from: Id }[]; // 需求11.6-11.7：有序，非 Map
}

interface PrefabDef extends Def {
  kind: 'prefab';
  nodes: { key: string; def: Id; props?: Record<string, Expr> }[];
  links: { a: string; b: string; def: Id; directed?: boolean }[];
  entities?: { at: string; def: Id; overrides?: Record<string, Expr> }[];
  attachTo?: string;
}
interface PrefabHandle { nodes: Id[]; links: Id[]; entities: Id[]; root: Id; }
```

**微型场景的实现**（需求9，对应上一轮审查纠正的语义）不是独立结构，而是 `node.create`/`node.destroy` 两个既有 Op 的内部 helper（写入通道情形b），工作在 Node 之上，不对外暴露独立的写方法：

```typescript
// 均为私有函数，只被 entity.place / prefab.despawn 等 Op 的实现内部调用，不注册进 OpRegistry、不对外导出
function ensureMicroScene(trigger: Ref, hostNode: Id, spec: MicroSceneSpec, ctx: OpContext): Id {
  // 已存在则返回既有 Id；否则调用同一份 node.create 的内部实现创建（不是新开一条写路径）
}
function onMicroSceneOccupantsChanged(microSceneId: Id, ctx: OpContext): void {
  // 现查占位者数量（Query，非维护字段），归零则调用 node.destroy 的内部实现
}
interface MicroSceneSpec { capacity?: number; }
```

`ensureMicroScene` 由 `entity.place` 的 Op 实现在"目标位置是空旷地/门口/车内等需要按需创建微场景的情形"时内部调用，返回的 Id 供 `entity.place` 继续把 Entity 放进去——**微型场景的创建是 `entity.place` 这一次 Op 调用的副作用之一，不是独立的写入事件**。`onMicroSceneOccupantsChanged` 由 `entity.place`（把某占位者移出微场景）与 `prefab.despawn`（回收子图时疏散占位者）在各自的 Op 实现内部触发，只在占位者数量归零时调用 `node.destroy` 的内部实现完成卸载。二者都不注册为独立 Op，也不被 `kernel/topology` 之外的模块直接调用。`ensureMicroScene` 只在 `props.creator` 写入一次触发来源用于溯源（需求9.2），不读取该字段判断是否卸载（需求9.3-9.4）。结构性共享微场景（需求9.8，如小场景固有共享地）与普通微场景走同一套 helper，只是触发时机可能在地图加载的 `prefab.spawn` 内，而非首个实体 `entity.place` 进入时——这不构成第二套生命周期规则，只是调用点不同。

Container/Slot 的索引连续性（需求10.3-10.5）由 `Container.slots` 恒为数组保证；`insert:'fixed'` 的删除留 `undefined` 空洞，`insert:'shift'` 的删除用 `Array.splice` 语义。`item.move` 缺省槎位选取（需求10.9-10.10）实现为线性扫描 `slots`，取第一个 `accepts` 通过且 `holds` 为空的索引，找不到则整个 Op 返回 `ok:false`，不产生任何写入。

### 3.3 Expr / Query（L2）— 需求 12、13、14、15

```typescript
type Expr =
  | Value
  | { path: string }
  | { var: string }
  | { op: string; args: Expr[] }
  | { q: Query }
  | { call: Id; args?: Record<string, Expr> };

interface ExprEngine {
  eval(expr: Expr, ctx: EvalContext): Value | null; // 全函数，永不抛异常（需求12.1）
}
interface EvalContext {
  self?: Ref; vars: Record<string, Value>;
  budget: { depth: number; maxDepth: number }; // 具名表达式深度计入（需求13.4）
}

interface ExprDef extends Def { kind: 'expr'; params?: string[]; body: Expr; pure: true; }

interface Query {
  from: 'entities'|'items'|'nodes'|'links'|'attachments'|'defs'|'agents'|'decisions'|'intents'|'log';
  where?: Expr; in?: Expr; visibleTo?: Expr; orderBy?: Expr; desc?: boolean; limit?: number;
}
interface QueryEngine { run(q: Query, ctx: EvalContext): Ref[]; }
```

内置算子表（需求12.5）是一个不可变的 `Record<string, ExprOpImpl>`，`ExprEngine` 构造时冻结该表；不存在任何"注册新算子"的公开 API，玩法包若需要新判定必须通过具名表达式（`kind:'expr'`）组合已有算子，不能扩展算子集合本身——这条边界与源设计稿"内置算子固定集合，不可扩展"一致，是安全边界而非能力缺口。

**分类修正**：源设计稿把 `roll`/`pick`/`shuffle`/`weightedPick` 列入了同一张"内置算子"表，本设计early草案照搬了这个分类，这是错的。这四个操作会推进 `RngStream.counter`（需求35.2-35.3：随机流状态是整体状态的一部分），属于状态写入，而 Expr 被需求12.1、13.2 要求是全函数、纯读、绝不产生副作用（具名表达式甚至不能调用 Op）。因此 `roll`/`pick`/`shuffle`/`weightedPick` 不属于 `ExprEngine` 的算子表，而是 L10（3.11节 Random）注册进 `OpRegistry` 的公开 Op（`random.roll`/`random.pick`/`random.shuffle`/`random.weightedPick`）。`Expr` 的 `{op:...}` 形态里不得出现这四个算子名；玩法包若需要在 `require`/`when` 等纯读表达式里用到随机判定结果，必须先通过 Effect 调用对应 Op 把结果写入 `props`，再在 Expr 里读该 `props` 路径——这与"伤害不是内核原语，是玩法包 emit + Hook"的设计手法一致：随机的**产生**是写入，随机的**读取**才是查询。

具名表达式的环检测（需求13.3）在 `DefRegistry.register` 时对 `kind:'expr'` 的 Def 做一次调用图 DFS，检测到环立即拒绝注册并产出 `E_LOAD_CYCLE_DEP` 诊断，不推迟到运行期求值时才发现。

`Query.from:'log'`（需求15）读取 L12 持久化层维护的有界环形缓冲，`QueryEngine` 对 `from:'log'` 的处理路径与其余 `from` 值共享同一个 `where`/`orderBy` 过滤器实现，只是数据源换成 `PersistenceStore.log` 而非活跃集合——这保证了"查历史"与"查当前"用同一套过滤语法，符合需求43的可达性约束。

### 3.4 Ops / Transactions（L3）— 需求 16、17、18、19、20、21

```typescript
type Result<T> = { ok: true; value: T } | { ok: false; code: ErrCode; detail: string };

interface OpContext { tx: Transaction; emit(type: string, payload: Record<string, Value>): void; }
type OpImpl<Args, T> = (args: Args, ctx: OpContext) => Result<T>;

interface OpRegistry {
  // 每个 Op 在此注册，键名即公开调用名（'prop.set'、'item.move' 等）
  register<A, T>(name: string, impl: OpImpl<A, T>): void;
  invoke<A, T>(name: string, args: A): Result<T>; // 自动包一层 tx，见下
}

interface Transaction {
  begin(): void;
  commit(): Result<void>;   // 执行前调用 InvariantChecker.checkAll()
  rollback(): void;
  logOp(op: string, args: unknown, inverse: () => void): void; // 供 journal 使用（需求37.2）
}

interface InvariantChecker {
  checkAll(state: WorldState): Diagnostic[];  // 需求20 的 16 条不变量逐条检查
}
```

**唯一写入通道**（需求16.1）靠架构约束而非运行时检查实现：`WorldState` 的全部结构区字段在 TypeScript 层标记为 `readonly`，`kernel/state` 模块不导出任何可变引用；唯一能修改状态的方式是调用 `OpRegistry.invoke`，其内部才持有对可写视图的访问权。这使得"绕过 Op 直接赋值"在类型系统层面就不可编译，不依赖代码审查记录。

**Op 全集清单**（本节新增，修复早前草案里散落在各层、绕过 `OpRegistry` 的独立方法）。以下是全部注册进 `OpRegistry` 的公开 Op 名，按结构分组；后续 3.5-3.14 节的任何"写操作"设计，必须落在这张表里而不是发明新的独立组件方法：

```
属性类   prop.set / prop.del / prop.add / list.insert / list.remove / tag.add / tag.del
结构类   entity.create / entity.destroy / entity.setDef / entity.place
         item.create / item.destroy / item.move / item.promote / entity.demote
         stack.split / stack.merge
         node.create / node.destroy / node.merge / node.split
         link.create / link.destroy
         slot.add / slot.del
         prefab.spawn / prefab.despawn
关系类   relation.set / relation.del
认知类   agent.bind / agent.unbind
附着类   attach.add / attach.del
决策类   decision.open / decision.answer / decision.close
意图类   intent.submit / intent.reveal / intent.resolve / intent.void
结局类   outcome.reach
相位类   schedule.advance                      // ★ 本次修补新增，见下方说明
随机类   random.roll / random.pick / random.shuffle / random.weightedPick   // ★ 本次修补新增，见下方说明
```

这张表是需求16.5-16.7 与源设计稿 4.1-4.3 节 Op 清单的合并结果，是 `OpRegistry.register` 调用点的唯一真相源。3.9 节（Attachment/光环）、3.8 节（Decision/Intent）、3.10 节（Schedule/Playpack）中任何"某个内部组件方法改变了状态"的设计，都必须重新表述为"调用了这张表里的某个 Op"，不允许该组件自己另开一条写入路径。

**`schedule.advance` 是本次修补新增的 Op**，源设计稿 4.1-4.3 节的 Op 清单没有列出它，因为源设计稿把"相位推进"描述成一个抽象的运行时行为，没有明确它是不是状态写入。但相位推进会修改 `turn.phaseIndex`/`turn.phaseEnteredAt`（4.1节 `TurnState`），这就是状态写入，必须是 Op，不能是 `ScheduleRunner` 的独立方法。

**`random.*` 四个 Op 是本次修补新增**，对应 3.3 节已经做出的分类修正：源设计稿把 `roll`/`pick`/`shuffle`/`weightedPick` 错放进了 Expr 内置算子表，本设计的早前草案照搬了这个错误，直到本节修补时才发现它们会推进 `RngStream.counter`（状态写入），必须移出 Expr、注册为 Op。

`item.move` 承担全部转移语义（需求16.7）：拾取/丢弃/装备/买卖/交易的差异完全由调用方传入的 `require` 谓词与挂载的 `before`/`after` Hook 决定，`OpRegistry` 里只有一份 `item.move` 实现。

`stack.split` 的原子性（需求17）用 `Transaction` 的 begin/commit/rollback 直接表达：

```typescript
function stackSplit(args: StackSplitArgs, ctx: OpContext): Result<Id> {
  ctx.tx.begin();
  const dec = decrementStack(args.id, args.n);
  if (!dec.ok) { ctx.tx.rollback(); return dec; }
  const created = createItem(args.into ?? sameDefAs(args.id), args.atSlot);
  if (!created.ok) { ctx.tx.rollback(); return created; } // 无合法槎位 → 整体回滚，不落地不吞掉
  ctx.tx.commit();
  return created;
}
```

`entity.setDef`/`node.merge`/`node.split`（需求18）的 `carry` 参数是一个字段选择器数组，Op 实现内部按选择器逐一迁移旧对象的关系/容器/Attachment 指针到新对象/`keep` 节点，再销毁旧对象——迁移顺序是"先接管引用，再销毁来源"，保证事务中途失败时旧对象仍完整存在，回滚等价于什么都没发生。

结构性 Op 的否决点（需求19）统一实现为一个包装器：

```typescript
function withVeto<A, T>(opName: string, inner: OpImpl<A, T>): OpImpl<A, T> {
  return (args, ctx) => {
    const before = HookDispatcher.dispatch(`before:${opName}`, args, ctx);
    if (before.cancelled) return { ok: false, code: 'E_OP_VETOED', detail: before.reason ?? '' };
    const result = inner(args, ctx);
    if (result.ok) HookDispatcher.dispatch(`after:${opName}`, args, ctx);
    return result;
  };
}
```

`OpRegistry.register` 对声明为"结构性"的 Op（`entity.place`、`item.move` 等）自动套上 `withVeto`，玩法包无需感知这层包装，只需要挂 `before:` Hook。

`InvariantChecker.checkAll` 在每次 `Transaction.commit()` 之前运行，16 条不变量（需求20.1-20.16）各对应一个独立的检查函数，注册在一个数组里顺序执行；任一检查失败，`commit()` 直接调用内部 `rollback()` 并返回对应 `Result<false>`，绝不提交一个违反不变量的状态（需求20.17、需求21.4）。

### 3.5 Events / Hooks（L4）— 需求 23、24

```typescript
interface Event {
  type: string; payload: Record<string, Value>;
  source?: Ref; cause?: Id; depth: number; cancelled: boolean;
}
interface RuleDef extends Def {
  kind: 'rule'; on: string | string[];
  phase: 'before'|'modify'|'instead'|'default'|'after';
  when?: Expr; priority: number; effects: Effect[]; once?: boolean;
}

interface HookDispatcher {
  dispatch(eventType: string, payload: Record<string, Value>, ctx: OpContext): DispatchResult;
}
interface DispatchResult { cancelled: boolean; reason?: string; finalPayload: Record<string, Value>; }
```

五阶段调度顺序（需求23.3-23.7）在 `dispatch` 内部固定为 `before → modify → instead(取第一个通过者，其余不参与) → default → after`。`instead` 阶段的候选排序键是 `(priority, 宿主容器索引, 槎位索引, defId)` 四元组（需求23.6），这四个字段在候选收集阶段直接从触发 Hook 的 Attachment/Item 的宿主结构里读出，不需要额外维护"顺序表"。

事件连锁深度（需求24.1-24.3）通过 `Event.depth` 在 `HookDispatcher.dispatch` 递归触发新事件时自增，超过 32（可配置）立即拒绝并产出诊断；`depth` 的重置点是 `Transaction.commit()`成功之后，与跨相位的 `reactionRounds`（需求24.4，由 L9 的 `PhaseDef` 持有）是两个独立计数器，互不影响——这是源设计稿第十一轮修正的直接体现，本设计不重复那次错误。

单条 Hook 失败隔离（需求23.10）：`dispatch` 对每个候选 Hook 的执行包一层 `try/catch`（内部实现层面的异常捕获，不是 Effect 语言的 `try`），捕获到内部异常只跳过该 Hook 并记录 `warn` 级诊断，不中断整个 `dispatch` 调用；这与需求24.6 的重入锁配合，共同保证 L4 层不会因为单个玩法包的坏规则而使整局崩溃。

### 3.6 Flow（L5）— 需求 22

```typescript
type Effect =
  | { op: string; args: Record<string, Expr> }
  | { let: string; be: Expr }
  | { if: Expr; then: Effect[]; else?: Effect[] }
  | { forEach: Expr; as: string; do: Effect[] }
  | { while: Expr; do: Effect[]; maxIter: number }
  | { emit: string; data?: Expr }
  | { after: Expr; do: Effect[] }
  | { at: Expr; do: Effect[] }
  | { try: Effect[]; catch?: Effect[] }
  | { abort: Expr };

interface FlowInterpreter {
  run(effects: Effect[], ctx: OpContext, budget?: number): Result<void>; // 默认 budget = 1e4
}
```

`FlowInterpreter.run` 维护一个 step 计数器，每执行一条 Effect（包括 `forEach`/`while` 的每次迭代）计数器加一；超过 `budget` 立即中止并返回 `{ok:false, code:'E_FLOW_BUDGET', ...}`，同时产出诊断事件（需求22.4-22.5）。`while` 缺失 `maxIter` 在加载期由 L13 的 Linter 拒绝（需求22.6），`FlowInterpreter` 本身仍在运行期做一次防御性检查（`maxIter` 未定义直接判定为脚本非法），双重保险但不重复实现校验逻辑本身。

### 3.7 Actions（L6）— 需求 25、26

```typescript
interface ActionDef extends Def {
  kind: 'action'; label: Expr; targets?: TargetSpec[];
  require?: Expr; visible?: Expr; reason?: Expr;
  cost?: CostSpec[]; group?: string; effects: Effect[];
}
interface TargetSpec {
  name: string; query?: Query;
  range?: { min: Expr; max: Expr; step?: Expr };
  count?: { min: Expr; max: Expr };
  optional?: boolean;
}
type CostSpec =
  | { pool: string; amount: Expr } | { items: Expr }
  | { attach: Id } | { custom: Effect[] };

interface ActionCatalog {
  queryActions(actor: Ref, mode: 'ui' | 'ai'): LegalAction[];
}
interface LegalAction { action: Id; bindings: Record<string, Value>; cost: CostSpec[]; reason?: string; }
```

`queryActions` 的 `mode` 参数（需求25.7）只影响 `TargetSpec.range`/`count` 的展开粒度：`mode:'ui'` 返回完整区间供滑条渲染，`mode:'ai'` 只采样边界值、当前可承担的最大值与 `step` 网格上的有限点——**这是唯一的分支**，UI 与 AI 调用的是同一个函数、同一段 `require`/`visible` 过滤逻辑，不存在两套着法生成代码（呼应需求44.1）。

代价三态（需求26）是 `intent.submit`/`intent.resolve`/`intent.void` 三个既有 Op（见 3.4 节 Op 全集清单）内部共享的一组私有 helper（写入通道情形b），不是独立组件：

```typescript
// 均为私有函数，只被 intent.submit/intent.resolve/intent.void 的 Op 实现内部调用
function freezeCost(agent: Ref, costs: CostSpec[], ctx: OpContext): Result<Reservation>;   // intent.submit 内部调用
function settleCost(reservation: Reservation, ctx: OpContext): Result<void>;               // intent.resolve 解算成功分支内部调用
function refundCost(reservation: Reservation, reason: string, ctx: OpContext): void;        // intent.void 内部调用，发 cost.refunded 诊断
```

`freezeCost` 立即扣减池的"可用额度"字段（区别于"真实额度"），`settleCost` 才真正扣减真实额度并清空可用额度差值，`refundCost` 把可用额度差值加回。三者都在调用方 Op 已经开启的事务内执行，本身不单独开启事务、不绕过 `OpContext`；早前草案把它们包装成一个独立的 `CostLedger` 组件对外暴露 `freeze`/`settle`/`refund` 三个公开方法，这违反需求16.1——代价状态的变化必须经由 `intent.submit`/`resolve`/`void` 这三个已注册的 Op 触发，不能有第四条独立于 Intent 生命周期的写入路径。这个三态设计直接对应需求26.2-26.6，不额外引入状态机，只是同一个数值字段拆成"真实/冻结"两个视图。

### 3.8 Decision / Intent（L7）— 需求 27、28、29

```typescript
interface Decision {
  id: Id; def: Id; askees: Ref[]; answers: Record<string, Value>;
  ctx: Record<string, Value>; opensAt: number; deadline?: number;
  status: 'open'|'resolved'|'timeout'|'void';
}
interface DecisionDef extends Def {
  kind: 'decision';
  options: { name: string; label: Expr; require?: Expr }[];
  quorum: 'all'|'any'|'majority'; onTimeout: 'default'|'void';
  defaultChoice?: string; onResolve: Effect[]; onVoid?: Effect[];
}

interface Intent {
  id: Id; agent: Id; action: Id; bindings: Record<string, Value>;
  submittedAt: number; priority?: number; hidden: boolean;
  status: 'pending'|'resolved'|'failed'|'void';
}

// 需求27/29 的四个动作全部是 OpRegistry 注册的公开 Op（写入通道情形a），
// 签名形如 OpImpl<Args, T>，通过 OpRegistry.invoke('decision.open', args) 等方式调用；
// 下面用函数签名表达每个 Op 的参数与返回值，不再包成一个独立的 "Store" 组件对外暴露方法
type DecisionOpenArgs = { def: Id; askees: Ref[]; ctx: Record<string, Value> };
type DecisionAnswerArgs = { id: Id; actor: Ref; choice: string };
type IntentSubmitArgs = { agent: Ref; action: Id; bindings: Record<string, Value>; hidden: boolean };
type IntentResolveArgs = { id: Id };
// 'decision.open': OpImpl<DecisionOpenArgs, Id>
// 'decision.answer': OpImpl<DecisionAnswerArgs, void>
// 'intent.submit': OpImpl<IntentSubmitArgs, Id>
// 'intent.resolve': OpImpl<IntentResolveArgs, void>
```

早前草案把这四个动作包成一个独立的 `DecisionIntentStore` 组件、对外暴露 `openDecision`/`answer`/`submitIntent`/`resolveIntent` 四个公开方法——这违反需求16.1：决策与意图的状态变化必须经过 `OpRegistry.invoke`，才能获得 Result 返回、事务包裹、journal 记录与 Hook 拦截；一个独立组件的公开方法即使内部逻辑正确，也会绕开这一整套机械保证，且回放/AI搜索读到的 journal 里不会出现这次调用。收编后：

`decision.open` 的 Op 实现内部只是 `entity.create`-风格的一次结构写入加上把 Decision 放进 `world.decisions` 集合，函数立即返回；**没有任何 `await` 或阻塞原语**（需求27.2-27.3）。答复到达时（`decision.answer` 或相位推进的超时处理）在新的事务里调用 `DecisionDef.onResolve`，`onResolve` 执行前先重新对 `ctx` 快照的对象跑一次前提校验（`require` 意义上的存在性检查），失败则转 `onVoid`（需求27.4）。

`intent.resolve` 在解算前重新执行该 Intent 绑定的 ActionDef 的 `require`（需求29.3），失败则 `status = 'void'` 并在同一个 Op 实现内部调用 3.7 节的 `refundCost` helper（需求29.4）——`refundCost` 不是被外部直接调用，而是 `intent.resolve`/`intent.void` 这两个 Op 实现内部的一步。`hidden` 为真的 Intent 在 `ActionCatalog.queryActions` 与 `QueryEngine`（`from:'intents'`）里对非本人 Agent 一律过滤掉（需求29.5）——这个过滤逻辑复用需求36的 `visibleTo` 机制，不是 Intent 专属的第二套隐藏协议。

响应相位（需求28）不是 Decision/Intent 之外的第三个结构，而是 L9 `PhaseDef.kind:'response'` 时，`schedule.advance`（3.10节，见后续修补）这个 Op 把该相位的 `actors` Query 结果里每个 Agent 提交的"反应 Intent"收集起来，推进条件是等到 `reactionRounds` 轮或提前收齐后转入解算相位。反制表达为 `instead`/`before` 规则，触发条件读取"是否存在一个以我为目标、且已被某反应 Intent 引用的 pending Intent"，这条判断是一个 `Expr`（查 `from:'intents'`），不需要内核为"反制"单独开接口。

### 3.9 Attachment（L8）— 需求 30

```typescript
interface Attachment {
  id: Id; def: Id; target: Ref; source?: Ref; props: Record<string, Value>;
  stack: number; expiresAt?: number; activeAt?: number; grantedBy?: Id;
}
interface AttachmentDef extends Def {
  kind: 'attachment'; duration?: Expr; delay?: Expr;
  stack: 'unique'|'refresh'|'count'|'independent'; maxStack?: number;
  aura?: { query: Query; grant: Id; deps?: string[] };
  rules?: Id[]; onAdd?: Effect[]; onExpire?: Effect[]; onRemove?: Effect[];
}

// AuraEngine 是事件驱动的重算触发器（订阅 Hook 的 after 阶段），本身不持有写权限（写入通道情形b）：
// 它触发重算，但差集运算得出的"要授予/要回收"结果，必须通过下方 attach.add/attach.del 落地
interface AuraEngine {
  // 拓扑变化时无条件触发；属性变化仅在该属性路径出现在某 aura 的 deps 里时触发
  onTopologyChanged(affected: Ref[]): void;   // 由 entity.place/node.merge/node.split 的 after Hook 调用
  onPropChanged(path: string, affected: Ref): void;  // 由 prop.set 的 after Hook 调用
  recompute(auraAttachmentId: Id, ctx: OpContext): void; // 差集运算：新增命中 → 内部调用 attach.add 的实现；退出命中 → 内部调用 attach.del 的实现
}
```

`AuraEngine` 不做逐回合遍历（需求30.3-30.4）：`recompute` 只在两类事件触发时被调用——(a) 任意 `entity.place`/`node.merge`/`node.split` 完成后，遍历当前生效的全部 aura Attachment 重新求一次 `query` 命中集合（因为默认依赖拓扑）；(b) 某个 `prop.set` 写入的路径恰好出现在某个 aura 的 `aura.deps` 列表中，只重算那一个 aura。这两类触发都发生在对应 Op（`entity.place`/`prop.set` 等）的 `after` 阶段 Hook 内，`recompute` 本身接收调用方传入的 `OpContext`——它不开启新事务，而是在触发它的那个 Op 的事务范围内，调用 `attach.add`/`attach.del` 的内部实现完成授予或回收。这意味着一次拓扑移动引发的光环重算，与移动本身共享同一个事务：若光环授予因配额超限失败，整个 `entity.place` 应一并回滚，不应出现"移动成功但光环没授予"的半改状态。L13 的 Linter 在加载期扫描每个 `aura.query` 里的 `path` 表达式引用了哪些属性路径，与该 aura 声明的 `deps` 做差集，未声明则产出 `W_AURA_DEPS_MISS`（需求30.5-30.6）。

光环回收（需求30.7）是 `attach.del` 这一个 Op 内部的递归级联，不是独立于它的第二套清理函数：`attach.del` 的实现内部先反查 `attachments.filter(a => a.grantedBy === id)`，对每个子 Attachment 递归调用自身的内部实现，再移除自身——早前草案把这段逻辑写成一个可被外部直接调用的 `removeAttachment(id)`，这本身不算违反需求16.1（它没有独立于 Op 之外被调用），但措辞上容易被误读为"存在另一个删除入口"，这里明确它是 `attach.del` Op 唯一的内部实现，不对外单独导出。这段递归级联适用于任意 Attachment 的移除，不是"光环特有的清理逻辑"。

### 3.10 Schedule / Playpack / Policy（L9）— 需求 31、32、33、34

```typescript
interface ScheduleDef {
  phases: PhaseDef[]; order: 'fixed'|'initiative';
  initiativeExpr?: Expr; resolveOrder?: Expr; onConflict?: Effect[]; roundEnd?: Effect[];
}
interface PhaseDef {
  name: string; actors?: Query; onEnter?: Effect[]; onExit?: Effect[];
  input: 'none'|'actor'|'all'; kind?: 'normal'|'submit'|'resolve'|'response';
  reactionRounds?: number; timeLimit?: Expr;
}

interface PlaypackDef extends Def {
  kind: 'playpack'; schedule: Id; pools: PoolDef[]; factions?: string[];
  visibility?: Id; logRetention?: { phases?: number; max?: number };
  outcomes?: OutcomeDef[]; evaluate?: Expr; policies?: Id[];
  linter?: LintRule[]; quota?: { entities?: number; attachments?: number; rules?: number };
  entry: Effect[]; version: string; migrations?: Id[];
  requires?: Id[]; conflicts?: Id[]; overrides?: Record<Id, Id>;
}
interface PoolDef { name: string; per: 'world'|'actor'|'faction'; max?: Expr; reset: 'never'|'turn'|'phase'|Expr; }
interface OutcomeDef { name: string; when: Expr; scope: 'game'|'agent'|'faction'; rank?: Expr; onReach?: Effect[]; ends: boolean; }

interface PlaypackLoader {
  load(defs: Def[], mainPlaypack: Id): Result<LoadedPlaypack>; // 装载期例外（写入通道情形c），见下方装载算法
}
interface PolicyDef extends Def {
  kind: 'policy'; mode: 'rules'|'search'|'scripted';
  rules?: { when: Expr; prefer: Query | Id; weight?: Expr }[];
  search?: { depth: Expr; evaluate: Id; budget: Expr };
  script?: Effect[]; fallback?: Id;
}
// 'schedule.advance': OpImpl<{}, void> —— 相位推进本身修改 turn.phaseIndex/phaseEnteredAt，
// 必须是 OpRegistry 注册的公开 Op（写入通道情形a），不是 ScheduleRunner 的独立方法
```

**相位推进是 `schedule.advance` 这一个 Op，不是一个独立的 `ScheduleRunner` 组件方法**——早前草案把它写成组件方法,这违反需求16.1:推进相位会修改 `turn.phaseIndex`/`turn.phaseEnteredAt`，凡是状态写入都必须经过 `OpRegistry.invoke`，才能被 journal 记录、被 Hook 的 `before:schedule.advance`/`after:schedule.advance` 拦截（这正是 `PhaseDef.onEnter`/`onExit` 的挂载点）。`schedule.advance` 的 Op 实现内部持有一个指向 `phases` 数组的游标（存在 `WorldState.world.turn` 里，不是组件私有状态）加上对当前相位已收集的 Decision/Intent 的一次 Query；推进条件是"`input` 要求的决策/意图已齐 或 `timeLimit` 到期"（需求31.4-31.5），不满足则该 Op 返回 `ok:false`（不是"什么都不做地返回"，而是显式的、可被 journal 记录的"本次推进未成立"结果），不存在满足这两者之外的第三种推进路径，也不存在阻塞等待（需求31.6）。

`PlaypackLoader.load` 的装载算法严格对应需求33.1-33.5 五步：

```
1. 对全部待装载 PlaypackDef 的 requires 做拓扑排序 → 检测到环则 Result.ok=false（E_LOAD_CYCLE_DEP）
2. 检测 conflicts 两两交集 → 有交集则 Result.ok=false（E_LOAD_CONFLICT，指名双方）
3. 按拓扑序合并 Def 集合；每个包的 overrides 在合并到该包时应用（后包覆盖先包同名 Def）
4. 为 HookDispatcher 的候选排序键追加"包序"字段（在 priority 之后、defId 之前）
5. 对合并后的完整 Def 集合运行全部包的 linter（LintRule[]）→ 任一失败则整体 Result.ok=false
```

第 5 步失败时返回的 `Result` 携带全部失败的 `LintRule`，不是遇到第一个就短路（对应需求39.12"给出全部问题清单"这一诊断体系约束在装载期的具体应用）。

PolicyDef 的 `mode:'rules'` 实现（需求34.2）是：

```typescript
function evalRulesPolicy(policy: PolicyDef, actor: Ref): LegalAction {
  const legal = ActionCatalog.queryActions(actor, 'ai'); // 与人类玩家同一份实现
  const scored = policy.rules!
    .filter(r => ExprEngine.eval(r.when, ctxFor(actor)))
    .flatMap(r => matchQueryOrDef(r.prefer, legal).map(a => ({ a, w: evalWeight(r.weight, a) })));
  return scored.length ? argmax(scored).a : (policy.fallback ? runFallback(policy.fallback, actor) : NO_OP);
}
```

`queryActions(actor, 'ai')` 是 PolicyDef 唯一读取着法空间的方式（需求34.2、44.2）：创作者新增一个 ActionDef 后，只要新着法满足某条 `rules[].when`，`evalRulesPolicy` 自动会给它打分，不需要修改 `PolicyDef` 本身或 `evalRulesPolicy` 的代码。`mode:'search'` 复用 L12 的 `checkpoint`/`restore`（3.12节），`mode:'scripted'` 直接跑 `FlowInterpreter.run(policy.script)`。

### 3.11 Random（L10）— 需求 35

```typescript
interface RngStream { name: string; seed: number; counter: number; }
// random.roll/pick/shuffle/weightedPick 是 3.4 节 Op 全集清单里的公开 Op（写入通道情形a），
// 不是一个独立 RandomService 组件对外暴露的方法——它们会推进 RngStream.counter，是状态写入
type RandomRollArgs = { stream: string; spec: string };
type RandomPickArgs<T> = { stream: string; table: { value: T; weight: number }[] };
type RandomShuffleArgs = { stream: string; containerId: Id };
// 'random.roll': OpImpl<RandomRollArgs, number>
// 'random.pick': OpImpl<RandomPickArgs<unknown>, unknown>
// 'random.shuffle': OpImpl<RandomShuffleArgs, void>

// withShadowStream 不是 Op，是 L12（3.13节）AI 试探基础设施提供的一个纯粹的调用范围包装器：
// 它本身不修改主流状态，只是在其回调范围内让 random.* 系列 Op 临时读写一个克隆的影子 RngStream，
// 因此它不出现在 Op 全集清单里，也不违反需求16.1（它不修改 WorldState，只切换 Op 内部读到的流引用）
function withShadowStream<T>(fn: () => T): T; // AI 试探用，不推进主流 counter（需求35.4）
```

早前草案把 `roll`/`pick`/`shuffle` 写成一个独立 `RandomService` 组件对外暴露的公开方法，这违反需求16.1：随机结果的产生会推进 `RngStream.counter`（状态写入），必须经过 `OpRegistry.invoke('random.roll', args)` 这样的统一入口，才能被 journal 记录（否则回放时无法还原"当时到底调用了几次随机"）、被 Hook 拦截（`modify:random.roll` 正是"强力骰"这类修正随机结果机制的挂载点，源设计稿10章"投前用 prop.add 扣 pool 并把修正写进 modify:roll 的 payload"这句话本身就要求 roll 必须是能被 modify 阶段拦截的 Op，不能是普通方法调用）。收编后，每个命名流仍然维护一个确定性 PRNG（如 xorshift128），`seed`+`counter` 完全决定下一次输出，二者都是 `WorldState` 的一部分，因此被 snapshot/journal 完整捕获（需求35.3）。`withShadowStream` 通过克隆当前活跃流的 `{seed, counter}` 到一个临时副本、把该副本作为当前上下文里 `random.*` Op 读到的流引用、函数返回后丢弃副本来实现，主流状态在整个过程中不被读取或修改。

### 3.12 Knowledge（L11）— 需求 36

```typescript
// 只保留两个纯读方法；写入不经过 KnowledgeStore，直接调用已在 Op 全集清单里的 prop.set
interface KnowledgeStore {
  getFacts(scopeId: Id): Record<string, Value>;  // 纯读
  knows(scopeId: Id, key: string): Value | null;  // 纯读
}
// 写 fact：OpRegistry.invoke('prop.set', { path: `knowledge.${scopeId}.facts.${key}`, value })
interface Agent {
  id: Id; kind: 'human'|'ai'|'observer'; policy?: Id;
  controls: Ref[]; knowledgeScope: Id; omniscient?: boolean;
  authority?: string[]; props: Record<string, Value>;
}
```

`facts` 的值域是 `Value`（需求36.2），存储上与其余 `props` 自由区字段没有区别——早前草案给 `KnowledgeStore` 加了一个 `setFact` 公开方法，这是不必要的第二条写入路径：既然 `facts` 就是 `props` 自由区的一部分，写入直接复用已经在 Op 全集清单里的 `prop.set`（`path` 指向 `knowledge.${scopeId}.facts.${key}`）即可，不需要为它专门包一层方法名。`KnowledgeStore` 收窄为只保留 `getFacts`/`knows` 两个纯读访问器。`visibleTo` 过滤（需求36.5）在 `QueryEngine.run` 内实现为对结果集逐一用 `visibility` 表达式（来自 `PlaypackDef.visibility`）求值并过滤，AI 与人类玩家调用 `QueryEngine.run` 时唯一的差异是传入的 `visibleTo` 参数取值不同（`omniscient` Agent 传 `null` 跳过过滤，其余 Agent 传向自己的 `knowledgeScope`）——这是需求44.3 的直接实现。

### 3.13 Persistence（L12）— 需求 37、38

```typescript
// snapshot/journal/log 是纯读；rewind/checkpoint/restore/replay 是写入通道情形(d)——
// 它们切换的是整个 WorldState 引用（结构共享指针替换），不是修改某个字段，
// 语义上是"跳到另一个已经通过 Op 达成的历史状态"，因此不注册进 OpRegistry，
// 但仍然只能在事务边界之间调用（不能在一个未提交的事务中途切换整个状态引用）
interface PersistenceStore {
  snapshot(): StateSnapshot;                          // 纯读，结构共享，不可变
  journal: JournalEntry[];                             // 纯读，{ op, args, inverse }
  replay(seed: number, ops: JournalEntry[]): WorldState;  // 写入通道情形(d)
  rewind(phases: number): void;                        // 写入通道情形(d)
  checkpoint(label: string): void;                     // 写入通道情形(d)
  restore(label: string): void;                        // 写入通道情形(d)
  log: Event[];                                        // 纯读，有界环形缓冲，供 Query(from:'log')
}
interface MigrationDef { from: string; to: string; effects: Effect[]; onFail: 'reject'|'bestEffort'; }
```

`checkpoint`/`restore` 是 AI 搜索（`PolicyDef.mode:'search'`）与属性测试共用的同一对原语（需求37.5、44.6）：`checkpoint(label)` 内部调用一次 `snapshot()` 并存入以 `label` 为键的映射，`restore(label)` 用存的快照替换当前 `WorldState` 引用（结构共享意味着这是 O(1) 指针替换，不是深拷贝回放）。AI 试探期间的三项隔离（需求37.6）：随机走影子流（3.11节）、`Query` 强制带该 Agent 的 `visibleTo`（复用3.12节机制，不是搜索专属分支）、`after` 阶段的表现层订阅在试探模式下被 `HookDispatcher` 静默（通过一个 `ctx.silent` 标志跳过对外部订阅者的通知，Hook 本身仍执行以保证状态正确性）。

版本迁移（需求38）的装载时序：`PlaypackLoader.load` 在应用 3.10 节五步装载算法之前，先比对存档快照的 `version` 与待装载 `PlaypackDef.version`；相同直接跳到装载；存档更旧则查找 `migrations` 链，在专属事务中按 `from`/`to` 顺序执行各 `MigrationDef.effects`，任一失败按 `onFail` 处理（`reject`回滚整体拒绝，`bestEffort`保留已成功部分但仍产出诊断）；存档更新则直接拒绝。

### 3.14 Safety（L13）— 需求 39、41、42

```typescript
interface Diagnostic {
  code: ErrCode; severity: 'fatal'|'error'|'warn'|'info'; message: string;
  at?: { def?: Id; field?: string; playpack?: Id };
  subject?: Ref; path?: string; expected?: Value; actual?: Value;
  cause?: Id; hint?: string; phase: number;
}
type ErrCode = `E_${'REF'|'INV'|'OP'|'EXPR'|'FLOW'|'HOOK'|'COST'|'DEC'|'LOAD'|'MIG'|'QUOTA'}_${string}`;

// emit 会写入 world.log（诊断本身作为一种 Event 记录，见 3.13 节 log 字段）并可能触发
// ruleCircuitState 更新，因此不是独立于 Op 之外的全局单例方法，只能被 ctx.emit（3.4 节 OpContext）
// 或 Hook 分发内部调用，二者都已经在某个 Op 的事务范围内（写入通道情形b）
interface DiagnosticSink {
  emit(d: Diagnostic, ctx: OpContext): void;         // 内部做去重折叠 + 熔断检查
  onFatal(handler: (d: Diagnostic) => void): void; // 注册处理器，本身不写状态
}
// recordError 更新的"规则连续报错计数"必须落在 WorldState 里（见下方说明），
// 因此这里只保留纯读判断函数，写入收编为触发它的 Hook 调度所在 Op 事务内的 helper（写入通道情形b）
interface RuleCircuitBreaker {
  isDisabled(ruleId: Id, state: WorldState): boolean; // 纯读：查 WorldState.world.ruleCircuitState
}
function recordRuleError(ruleId: Id, code: ErrCode, ctx: OpContext): void; // 私有 helper，见下方说明
interface QuotaEnforcer {
  check(playpackId: Id, kind: 'entities'|'attachments'|'rules', currentCount: number): Result<void>;
}
```

`fatal`/`error` 分界（需求39.2-39.4）在 `DiagnosticSink.emit` 内部只是一个 `switch`：`fatal` 触发 `onFatal` 注册的处理器（落盘当前快照、抛出一个内部的"停机信号"使宿主循环退出）；`error` 只是把当前事务标记为需回滚，`Transaction.rollback()` 照常执行，宿主循环继续下一次输入。`E_INV_*` 到 `fatal` 的映射（需求39.6）是 `ErrCode` 字符串前缀到 `severity` 的一个只读查找表，玩法包的 Def 里没有任何字段可以覆盖这张表。

**熔断状态必须是 `WorldState` 的一部分，不能是宿主进程的本地内存**（本次修补新增的判定，早前草案把 `RuleCircuitBreaker` 设计成一个独立组件持有自己的滑动窗口计数，这是一处隐蔽的确定性漏洞）：一条规则在滑动窗口内连续报错被停用，是"这局游戏发生过的事实"，如果这个事实不进 journal/snapshot，那么从存档 `replay` 时，被熔断的规则会在重放中重新参与 Hook 分发，产生与原始运行不同的结果——这直接违反需求37.3（随机流状态是整体状态一部分因而可复现）背后同一条确定性原则，只是这次载体不是随机数而是规则熔断状态。修复方式：在 `WorldState.world` 下新增 `ruleCircuitState: Record<Id, { windowErrors: number[]; disabled: boolean }>` 字段（4.1节 Data Models 同步更新），`recordRuleError` 是一个私有 helper，由 `HookDispatcher` 在捕获到某 Hook 内部报错时，在**触发该 Hook 分发的那个 Op 的事务范围内**调用——它不开新事务，是那次 Op 事务的一部分。超过阈值则在同一事务内把 `disabled` 置真并生成 `W_RULE_DISABLED` 诊断；`RuleCircuitBreaker.isDisabled` 是纯读函数，`HookDispatcher` 在候选收集阶段用它查询 `WorldState.world.ruleCircuitState`，跳过已停用的 `RuleDef`。

`QuotaEnforcer`（需求41）挂在结构性 Op（`entity.create`、`attach.add`）的 `before` 阶段：Op 执行前先查询当前 `playpack` 已存在的对应类型对象数，超过 `PlaypackDef.quota` 声明的上限则整个 Op 返回 `ok:false` 并产出 `E_QUOTA_ENTITIES`/`E_QUOTA_ATTACHMENTS`，不占用额外的运行时计数器（复用 `QueryEngine` 现查数量，与微型场景占用者判断是同一种"不额外维护派生状态"的设计手法）。

明确排除的边界（需求42）不是某个接口的行为，而是"以下接口在本设计中不存在"的清单：内核不导出坐标系类型、不提供 `setInterval`级真实时钟接口、`FlowInterpreter` 不提供函数定义/闭包语法、`OpRegistry` 不导出寻路算法自定义扩展点、`kernel/index.ts` 不导出任何网络协议相关类型。这条边界本身应体现为一份架构测试（3.19节测试策略里的"边界不存在性测试"），而不只是文档声明。

### 3.15 表现层只读通道（L1-L13 横切）— 需求 40

```typescript
// kernel/index.ts 导出的表现层专用只读视图，内部转发到各层已有接口，不新增状态
interface PresentationGateway {
  subscribe(eventType: string, handler: (e: Event) => void): Unsubscribe; // 转发 HookDispatcher 的 after 阶段
  query(q: Query): Ref[];                                                  // 转发 QueryEngine.run，visibleTo 固定传该客户端 Agent
  queryActions(actor: Ref): LegalAction[];                                 // 转发 ActionCatalog.queryActions(actor,'ui')
}
```

`PresentationGateway` 是需求40的唯一落点：它不持有任何独立状态，三个方法分别转发到 3.5、3.3、3.7 节已定义的接口。表现层通过这一个 Gateway 对象获得全部三条通道，且这个 Gateway 不导出任何 Op——`src/scene`、`src/components` 引入的类型里不应出现 `OpRegistry` 或 `Transaction`，ESLint 的 `no-restricted-imports` 规则应把这条边界与"`src/core` 禁止 import React"对称地反向声明（"渲染层禁止 import kernel/ops"）。

## Data Models

本节给出各层数据结构如何组合成一个完整的 `WorldState`，以及跨层复用的基础类型。逐层字段定义已在第 3 章给出，此处不重复，只给出组合关系与序列化约束。

### 4.1 WorldState 顶层组合

```typescript
interface WorldState {
  world: {
    props: Record<string, Value>;
    agents: Record<Id, Agent>;
    knowledge: Record<Id, { facts: Record<string, Value>; seen: Record<string, Value> }>;
    decisions: Record<Id, Decision>;
    intents: Record<Id, Intent>;
    attachments: Record<Id, Attachment>; // target 可为 w:0 本身
    turn: TurnState;
    rng: Record<string, RngStream>;
    ruleCircuitState: Record<Id, { windowErrors: number[]; disabled: boolean }>; // ★ 本次修补新增，见 3.14 节
  };
  defs: Record<Id, Def>;               // 已展开继承的最终形态
  nodes: Record<Id, Node>;
  links: Record<Id, Link>;
  entities: Record<Id, Entity>;
  items: Record<Id, Item>;
  containers: Record<Id, Container>;   // 独立集合，供 O(1) 按 id 查找；Entity/Item 只存 containers[name] -> Id 索引
}
interface TurnState { scheduleId: Id; phaseIndex: number; phaseEnteredAt: number; }
```

顶层集合数恒为 6（`world`、`defs`、`nodes`、`links`、`entities`、`items`，需求1.8），`containers` 不是第 7 个顶层集合而是 `entities`/`items` 内部索引指向的辅助存储，这与"微型场景不是第 7 个顶层集合"（需求1.9）是同一条设计纪律的两次应用：新概念优先表达为已有集合的字段或索引，而不是新开集合。

### 4.2 Value 与 JSON 的往返关系

Value 的七种形态（需求1.1）与 `JSON.parse`/`JSON.stringify` 的输出范围完全重合，除了 `Ref`：

```typescript
// Ref 在 JSON 里没有原生表示，序列化时保持 { "$": "e:12" } 的字面形式，
// 反序列化时不做特殊类类型转换（不引入 class Ref），保持普通对象形态。
type SerializedValue = null | boolean | number | string | SerializedValue[]
  | { [key: string]: SerializedValue }; // Ref 序列化后落在这个分支的 { "$": string } 子情形
```

这保证 UGC 编写的 Def JSON 文件可以直接 `JSON.parse` 得到合法的 `Value` 结构，不需要额外的反序列化步骤识别哪些字段是 Ref——`isRef(v)` 谓词（3.1节）在读取时按需判别，写入 JSON 文件的人不需要区分"这是普通字符串"还是"这是一个引用"，只需要遵守 `{ "$": "..." }` 的字面约定。这条往返关系是需求1.4（NaN/Infinity 拒绝）能够在装载期靠 `JSON.parse` 后的一次遍历完成校验的前提。

### 4.3 ErrCode taxonomy

```typescript
const ERR_CODES = {
  E_REF: ['MISSING', 'KIND', 'DESTROYED'],
  E_INV: ['DANGLING', 'CYCLE', 'DUAL_LOCATION', 'STACK_LEAK'],
  E_OP: ['SLOT_FULL', 'NOT_ACCEPTED', 'VETOED', 'NO_LEGAL_SLOT'],
  E_EXPR: ['TYPE', 'UNKNOWN_OP', 'DEPTH', 'CALL_CYCLE'],
  E_FLOW: ['BUDGET', 'NO_MAXITER', 'ABORT'],
  E_HOOK: ['DEPTH', 'REENTRY', 'INSTEAD_CONFLICT'],
  E_COST: ['INSUFFICIENT', 'FROZEN_GONE'],
  E_DEC: ['VOID', 'QUORUM'],
  E_LOAD: ['CONFLICT', 'CYCLE_DEP', 'LINT', 'UNDEFINED_REF'],
  E_MIG: ['NO_PATH', 'NEWER_SAVE', 'FAILED'],
  E_QUOTA: ['ENTITIES', 'ATTACHMENTS'],
} as const satisfies Record<string, readonly string[]>;
// ErrCode 类型与 fatal 前缀集合都从这一份表派生，不手写第二份枚举
type ErrCode = { [K in keyof typeof ERR_CODES]: `${K}_${typeof ERR_CODES[K][number]}` }[keyof typeof ERR_CODES];
const FATAL_PREFIXES = ['E_INV'] as const; // 需求39.6：仅 E_INV_* 固定为 fatal，此表是唯一真相源
```

`ERR_CODES` 是需求39.5-39.6 的唯一真相源：`ErrCode` 类型由它派生，`FATAL_PREFIXES` 与 `DiagnosticSink` 的 severity 判定逻辑都读这个常量，不存在第二份手写的错误码列表。新增一个错误码只需要在 `ERR_CODES` 里加一项，类型与运行时校验自动同步——这是对源设计稿"12 处引用悬空全因字段被引用但结构里没有"教训的直接回应：让类型系统而不是人工检查保证 `ErrCode` 的使用处与声明处一致。

## Correctness Properties

*正确性属性描述系统在所有合法执行路径上必须保持真实的行为特征。它们是需求条款与可执行测试之间的桥梁：每条属性用"对于任意…"的全称语句表达，可直接转成 fast-check 的属性测试。*

### Property 1: 状态只能经 Op 改变
*对于任意* 由 `OpRegistry` 之外的路径尝试修改 `WorldState` 结构区字段的行为，都应在编译期被 TypeScript 的 `readonly` 约束拒绝，不存在能通过编译的绕过路径。
**Validates: Requirements 16.1**

### Property 2: Op 永不抛异常
*对于任意* 已注册 Op 与任意结构合法的入参（包括指向不存在对象的 Ref、越界索引），调用 `OpRegistry.invoke` 都应返回 `Result`，不应抛出未捕获异常。
**Validates: Requirements 16.2, 16.3**

### Property 3: 事务的原子性
*对于任意* Op 序列包裹在一个事务中，若序列中任一步骤返回 `ok:false` 且标记为致命，则事务回滚后的 `WorldState` 应与事务开始前逐字段相等（deep-equal）。
**Validates: Requirements 21.3, 21.4**

### Property 4: 不变量在提交后恒成立
*对于任意* 从合法初始状态出发、经任意长度的合法 Op 序列（每步的 `Result.ok` 均为真）到达的 `WorldState`，需求20列出的16条不变量应全部成立。
**Validates: Requirements 20.1-20.17**

### Property 5: 堆叠总量守恒
*对于任意* 同一 `DefId` 的 Item 集合，经任意包含 `stack.split`/`stack.merge` 的 Op 序列后，该 DefId 的物品总数量应仅因中间出现的 `item.create`/`item.destroy` 次数而改变，不应因 split/merge 本身改变。
**Validates: Requirements 17.4**

### Property 6: 拆分失败即整体回滚
*对于任意* 目标容器已满的 `stack.split` 调用，调用后原栈的数量应与调用前相等，且不应存在任何新创建的 Item。
**Validates: Requirements 17.1-17.3**

### Property 7: 代价冻结与结算守恒
*对于任意* 提交后经历"解算成功"或"void 退回"两条路径之一的 Intent，其冻结代价对应的资源池，在路径终点时的可用额度应等于提交前的可用额度减去（若结算）或加零（若退回）该代价，不存在中间态遗留。
**Validates: Requirements 26.2-26.6, 20.12**

### Property 8: Decision 永不阻塞
*对于任意* `decision.open` 调用，函数应在有限时间内返回且不等待任何后续输入；发起该调用的事务应在同一 tick 内提交完毕。
**Validates: Requirements 27.2-27.3**

### Property 9: Intent 解算前必重检 require
*对于任意* 已提交的 Intent，若其绑定的目标在解算前变为不满足原 `require` 表达式的状态，则该 Intent 解算后的 `status` 应为 `'void'`，且不应产生该 Action 声明的 `effects`。
**Validates: Requirements 29.3-29.4**

### Property 10: 隐藏 Intent 的不可见性
*对于任意* `hidden:true` 的 Intent 与任意非其所属 Agent 的查询者，该查询者调用 `queryActions` 或 `Query(from:'intents')` 的结果都不应包含该 Intent 的存在信息。
**Validates: Requirements 29.5**

### Property 11: 光环差集重算的正确性
*对于任意* 声明了 `aura` 的 Attachment 与任意拓扑变化序列，`AuraEngine.recompute` 之后，被授予子 Attachment 的对象集合应恰好等于该次求值 `aura.query` 的命中集合，不多不少。
**Validates: Requirements 30.2-30.4**

### Property 12: grantedBy 级联回收完整性
*对于任意* 通过某个光环 Attachment 授予的子 Attachment 集合，当该光环 Attachment 被移除时，其全部子 Attachment（及递归的孙代）都应从 `WorldState` 中消失。
**Validates: Requirements 30.7, 20.13**

### Property 13: queryActions 对 UI/AI 模式的一致性
*对于任意* Actor 与其当前状态，`queryActions(actor, 'ui')` 与 `queryActions(actor, 'ai')` 返回的着法集合（忽略 `range`/`count` 的展开粒度差异后）应完全相同，不应存在仅对某一 `mode` 可见的着法。
**Validates: Requirements 25.3, 44.1**

### Property 14: 连锁深度上限的可终止性
*对于任意* 会触发事件连锁的 RuleDef 组合（包括故意构造的 A 触发 B 触发 A 循环），事件处理都应在有限步数内终止（被 `depth` 上限拒绝或自然终止），不应导致调用栈溢出或无限循环。
**Validates: Requirements 24.1-24.2**

### Property 15: Flow 的 step 预算终止性
*对于任意* 包含 `while` 循环的 Effect 序列（`maxIter` 已声明），`FlowInterpreter.run` 都应在 `budget` 步以内返回，不应挂起。
**Validates: Requirements 22.4-22.5**

### Property 16: 随机流的确定性回放
*对于任意* 命名流的 `(seed, counter)` 状态与后续 N 次调用序列，两次从相同 `(seed, counter)` 出发执行相同调用序列，应得到逐次相同的输出。
**Validates: Requirements 35.3, 37.3**

### Property 17: 影子流不污染主流
*对于任意* 在 `withShadowStream` 内执行的随机调用序列，执行前后主流的 `counter` 应保持不变。
**Validates: Requirements 35.4**

### Property 18: 快照的结构共享与不可变性
*对于任意* 两次 `snapshot()` 调用之间只发生只读操作，两次快照应指向相同的底层结构（引用相等），且对早先快照的读取不应受后续状态变化影响。
**Validates: Requirements 37.1**

### Property 19: 装载期冲突优先于运行期崩溃
*对于任意* 声明了循环 `requires`、相交的 `conflicts`、或违反自身 `linter` 的玩法包组合，`PlaypackLoader.load` 都应在返回值中以 `ok:false` 报告，不应装载成功后在运行期才暴露该问题。
**Validates: Requirements 33.1-33.3, 33.5**

*（本次修补更正：早前版本此处标注为"Requirements 33.1-33.5"，但属性正文只覆盖循环依赖/冲突交集/linter 失败三种拒绝场景，未涉及 33.4 的包序确定性，标注与内容不符。33.4 由下方新增的 Property 23 单独覆盖。）*

### Property 20: 诊断的 fatal 映射不可覆盖
*对于任意* 玩法包尝试通过 Def 字段覆盖某个 `E_INV_*` 错误码的 severity，装载或运行都不应改变该错误码最终触发的 `severity` 值。
**Validates: Requirements 39.6**

### Property 21: 微型场景生命周期的占用者驱动
*对于任意* 微型场景，当其占位者集合（现查而非维护字段）归零时，该微型场景对应的 Node 应被自动销毁；且此前记录的 `props.creator` 取值不应影响这一销毁判定。
**Validates: Requirements 9.3-9.5**

### Property 22: 容器索引的插入语义
*对于任意* `insert:'fixed'` 容器，插入操作不应改变其余已占用槎位的索引；*对于任意* `insert:'shift'` 容器，删除操作后不应存在索引空洞。
**Validates: Requirements 10.4-10.5**

### Property 23: 玩法包叠加顺序的确定性
*对于任意* 两次以相同 `requires`/`conflicts`/`overrides` 声明但不同调用顺序装载的玩法包集合，只要最终拓扑序相同，`PlaypackLoader.load` 产生的 Hook 排序键（含包序字段）与最终 Def 合并结果都应逐次相同；对于任意 Hook 集合，同优先级候选的执行顺序应仅由 `(priority, 包序, defId)` 决定，不应随装载调用的实际时序抖动。
**Validates: Requirements 33.4**

### Property 24: before Hook 否决后状态零改动
*对于任意* 挂载了 `before` Hook 且该 Hook 返回取消（veto）结果的结构性 Op 调用，调用后的 `WorldState` 应与调用前逐字段相等，且该 Op 应返回 `{ok:false, code:'E_OP_VETOED'}`；不存在"部分执行后才被否决"的中间态。
**Validates: Requirements 19.2, 19.4**

### Property 25: instead 阶段的排他执行
*对于任意* `instead` 阶段存在两个或更多候选 Hook 的事件，恰好一个候选（排序键 `(priority, 宿主容器索引, 槎位索引, defId)` 最小者）的 `effects` 被执行，其余候选各自声明的 `effects` 都不应对 `WorldState` 产生任何可观察的改动，也不应有诊断报告"被否决"或"被跳过"（因为这不是否决，是排他选择）。
**Validates: Requirements 23.6**

### Property 26: Hook 重入拒绝
*对于任意* 构造出的场景，使某个 `RuleDef` 在同一次事件分发中被同一 `(type, hookId)` 组合再次触发（例如该 Hook 的 `effects` 直接或间接重新 emit 了同一事件类型且命中同一实例），第二次触发应被拒绝并产出诊断，不应导致该 Hook 的 `effects` 执行两次。
**Validates: Requirements 24.6**

### Property 27: Decision 的 onResolve 前提重检对称于 Intent
*对于任意* 已打开的 Decision，若其 `ctx` 快照引用的对象在 `onResolve` 执行前变为不满足前提（已被销毁或状态已不符原始条件），则该 Decision 应转入 `onVoid` 处理，且不应执行 `onResolve` 声明的 `effects`。（本次修补新增：Property 9 只覆盖 Intent 侧的前提重检，Decision 侧的对称机制此前没有对应属性，容易让人误以为两者已经等量覆盖。）
**Validates: Requirements 27.4**

### Property 28: 版本迁移的事务性
*对于任意* 声明了迁移链、但链中某一步 `MigrationDef.effects` 执行失败的存档装载，若 `onFail:'reject'`，则装载后的存档状态应与装载前逐字段相等（不产生部分迁移的中间态）；若 `onFail:'bestEffort'`，则已成功执行的迁移步骤应保留，且应产出对应诊断说明哪一步失败。
**Validates: Requirements 38.4, 38.5**

### Property 29: 规则熔断状态的可复现性
*对于任意* 触发了规则熔断（某 `RuleDef` 连续报错超过阈值被停用）的 Op 序列，将该序列完整 `replay` 一次后，重放得到的 `WorldState.world.ruleCircuitState` 应与原始运行逐字段相等，且被熔断的规则在重放中应在相同的相位点被停用，不应在重放中重新参与 Hook 分发。
**Validates: Requirements 39.13**

### Property 30: random.* 系列 Op 不出现在 Expr 求值路径中
*对于任意* 合法的 `ExprDef`/`ActionDef.require`/`RuleDef.when` 等纯读表达式声明，其语法树中不应出现 `roll`/`pick`/`shuffle`/`weightedPick` 算子名；加载期 Linter 检测到这类算子名出现在 Expr 上下文中应拒绝装载并产出诊断。
**Validates: Requirements 12.8, 35.5**

## Error Handling

### 5.1 四级严重度与对局连续性

内核的错误处理不是"捕获异常并记录日志"这类通用兜底，而是需求39定义的四级严重度契约，每一级对"这局游戏是否还能继续"给出确定答案：

| 严重度 | 触发场景 | 对局结果 | 实现位置 |
|---|---|---|---|
| `fatal` | `InvariantChecker` 在 `commit` 前发现不变量被破坏 | 回滚 + 落盘现场 + 停机，不接受新输入 | `DiagnosticSink.onFatal` |
| `error` | Op 前置条件不满足、`require` 未通过、Flow 超预算 | 当前事务回滚，宿主循环继续下一次输入 | 各 Op 实现内部返回 `Result.ok=false` |
| `warn` | 光环 deps 漏声明、代价退回、规则熔断 | 不回滚，继续 | `DiagnosticSink.emit` 记录但不中断 |
| `info` | 常规追踪 | 仅诊断模式记录 | 同上，受日志容量限制 |

这张表本身就是需求39.2-39.4 的实现契约：`fatal`/`error` 的分界不是"哪个更严重"的主观判断，而是"内核自身状态是否仍自洽"的客观判断——`error` 发生时内核逻辑正常工作（是玩法包的谓词写错了），`fatal` 发生时内核的不变量假设已经不成立，继续运行只会污染后续状态。

### 5.2 诊断信息的构造纪律

每个 Op 的每条前置条件失败必须映射到一个具体 `ErrCode`（需求39.5、需求4.3 taxonomy），不允许任何 Op 返回笼统的"操作失败"。这条纪律在实现上通过一条 lint 规则强制：`OpImpl` 的类型签名要求 `Result<T>` 的 `code` 字段类型为 `ErrCode`（4.3节的封闭联合类型），若某处返回值用了字符串字面量之外的动态拼接字符串，TypeScript 编译会直接报错——错误码的封闭性不依赖代码审查，靠类型系统。

诊断的 `hint` 字段（需求39.7）通过统一的消息构造函数按预置提示词条生成，而不是每个 Op 手写字符串：

```typescript
function diagnosticFor(code: ErrCode, ctx: { def?: Id; field?: string; expected?: Value; actual?: Value }): Diagnostic {
  const template = HINT_TEMPLATES[code]; // 每个 ErrCode 对应一条 message 词条 + 一条 hint 词条，装载期校验词条存在
  return { code, severity: severityOf(code), message: template.message(ctx), hint: template.hint(ctx), ...ctx, phase: currentPhase() };
}
```

`HINT_TEMPLATES` 缺失某个 `ErrCode` 的提示词条，在内核自身的启动自检（不是玩法包装载，是内核包本身的测试套件）里应该报错——这是需求39.5"无测试用例的错误码不允许存在"的一个更严格的姊妹约束：无 hint 词条的错误码也不允许存在。

### 5.3 熔断与去重的交互顺序

`RuleCircuitBreaker.recordError` 与 `DiagnosticSink` 的去重折叠（需求39.9）是两个独立机制，顺序上去重折叠先做（决定是否要产出一条新的诊断记录），熔断计数在折叠之前基于原始触发次数计数（决定要不要停用规则）——否则去重会导致熔断永远数不到阈值。两者共享的日志容量上限（需求39.10）是唯一的耦合点：容量超限时先丢弃最旧的 `info`，其次 `warn`，`error`/`fatal` 永不因容量被丢弃。

### 5.4 装载期错误的聚合报告

加载期检查（需求39.11、33.5）的九类校验（引用存在性、类型一致性、`while` 的 `maxIter`、具名表达式环、Def 继承环、`aura.deps` 完整性、玩法包冲突、自定义 linter、配额)全部注册为独立的检查器，`PlaypackLoader.load` 收集全部检查器的输出后一次性返回（需求39.12），不是遇到第一个失败就抛出——这要求每个检查器函数签名为 `(state) => Diagnostic[]` 而非 `(state) => void | throw`，从函数签名层面排除"提前退出"的实现路径。

## Testing Strategy

### 6.1 双重测试方法

沿用 [10_技术栈.md](../../../docs/L2_基类层/10_技术栈.md) 第一阶段"Spec→断言"的纪律：内核的正确性判定完全发生在 Terminal 里的 Vitest，不依赖浏览器。

**单元测试**（Vitest，具体示例）：
- 覆盖每条验收标准里的具体场景（如"背包已满时 item.move 返回 ok:false"）
- 覆盖需求列出的具体错误码触发路径
- 覆盖第 3 章列出的具体交互序列（如 stack.split 在无合法槎位时的回滚）

**基于属性的测试**（fast-check，通用属性）：
- 实现 Correctness Properties 章节的全部 30 条属性
- 每条属性至少 100 次迭代（需求8.2 对应的测试基础设施要求延续到本设计）
- 标签格式：`Feature: meta-mechanism-kernel, Property {N}: {property_text}`

### 6.2 按层推进的测试顺序

测试推进顺序与第 2 章的依赖 DAG 一致：`kernel/state` 的属性测试全部通过后才开始写 `kernel/expr` 的测试，以此类推到 `kernel/safety`。这不是任意选择的顺序，而是因为高层的属性测试（如属性13"queryActions 对 UI/AI 模式的一致性"）依赖低层不变量已经成立——若 L3 的事务原子性（属性3）没有先锁死，L6 的 Action 测试里出现的失败无法判断是 Action 逻辑错了还是底层事务泄漏了状态。

### 6.3 关键测试基础设施

**任意合法 WorldState 生成器**：fast-check 的 arbitrary 需要能生成任意深度嵌套的容器/微型场景/Def 继承链组合，这个生成器本身要在 L1 测试阶段建好，后续所有层的属性测试复用它，不是每层各写一个简化版生成器——这也是需求43"拓扑可达性"在测试基础设施层面的体现：如果生成器只能生成浅层结构，测试就无法暴露"深层嵌套下访问路径变化"这类回归。

**畸形输入模糊测试**（对应需求39.11 与源设计稿 13.8）：独立于属性测试之外，对 `Expr`、`Def` JSON、越界索引、循环引用跑模糊测试，断言零 `fatal`、零未捕获异常、零挂死。这类测试不验证"正确的输出"，只验证"内核没有失控"，是属性测试的补充而非替代。

**AI 搜索的一致性测试**（需求44 的验证载体）：构造一个简单的双人零和场景，分别用"人类手动 queryActions 选择"与"PolicyDef.mode:'search' 走 checkpoint/restore"跑同一局面，断言两者能达到的最终状态集合一致——这是需求44.1、44.6 的端到端验证，不能只停留在接口签名层面的静态检查。

### 6.4 集成测试边界

按 [10_技术栈.md](../../../docs/L2_基类层/10_技术栈.md) 第三章的四阶段循环，内核本身的验收止步于"阶段1：Spec→断言"，即 `vitest` 全绿。内核不需要打开浏览器验证——白盒拼装、素材接入、联动回归三个阶段属于具体玩法包（如大逃杀）的验收范畴，不在本设计文档覆盖范围内。内核与运行时宿主的集成测试（server 权威循环调用 `OpRegistry`、客户端 `PresentationGateway` 订阅）留给玩法包实现阶段验证，本设计只保证内核导出的接口具备被集成的形状（`kernel/index.ts` 的导出面即 3.4-3.15 节列出的公开接口的并集）。


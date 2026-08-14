# 元机制内核 设计稿 v1.0（MetaKernel）

> ⚠️ **文档性质：设计稿，不是可直接实施的工程 Spec。**
> 本文的任务是把内核的**设计空间**推演完整、确认无歧义、确认无遗漏。
> 类型签名是**设计意图的表达**，不是最终接口定义（错误码、序列化格式、
> 并发模型、性能约束、逐条前后置条件均未展开）。
> 正式工程规范将在本设计稿定稿后，以严格工程化流程另行生成 —— 因为这是底层，容不得半点虚假。
>
> **本文档独立于 WakeUp 游戏原型。** 它描述的是一台通用的离散策略博弈状态机，
> 大逃杀（02 文档）只是跑在它上面的第一个玩法包。
>
> 判定本设计稿是否合格的唯一问题：
> **把 02 及其以后的所有文档全部删掉，只留这一份，创作者能否不写一行代码做出侦探、格斗、卡牌、解谜、大逃杀？**

---

## 0. 目的与验收标准

### 0.1 推演前提

设计时必须假装：

- 我不知道会有大逃杀
- 我不知道会有 AP、体力、僵尸、微型场景这些具体概念
- 我只知道"离散状态 + 回合 + 多方决策"

任何在内核里写死 `hp`、`ap`、`armor`、`shop` 的行为，都是失败。

### 0.2 三条完备性判据

一个能力要进内核，必须同时满足：

| 判据 | 含义 |
|---|---|
| **不可绕过** | 缺了它，创作者只能改引擎代码 |
| **三处复用** | 至少 3 个互不相关的表层机制会用到它 |
| **不含语义** | 它不知道自己在服务什么玩法 |

反例：`ShopSystem` 违反全部三条。正例：`条件 + 资源检定 + 容器转移`，商店只是它的一种拼法。

### 0.3 圈层契约

```
第 0 圈  内核（本文档）           需要写代码 —— 只有引擎作者
─────────────────────────────────────────────────────────
第 1 圈  实例（放一把枪、一个 NPC）        零代码
第 2 圈  定义（自定义属性、关系、新武器机制）  零代码
第 3 圈  玩法（回合表、胜负、NPC 策略、容器） 零代码
─────────────────────────────────────────────────────────
第 4 圈  自定义算法、原生解谜             需要写代码（暂不开放）
```

**铁律**：第 1–3 圈内出现"必须写代码"，即视为内核不完备，是内核的 bug，不是创作者的问题。

### 0.4 非目标

明确不做：连续空间、物理模拟、实时帧循环、图灵完备脚本、渲染。
表现层不在本文档内 —— 它按「加法工具箱」策略独立演进（见 09 文档）。

---

## 1. 状态模型：一切皆可寻址

### 1.1 值域

```typescript
type Value =
  | null | boolean | number | string
  | Value[]                      // 有序表
  | { [key: string]: Value }     // 映射
  | Ref                          // 引用

type Ref = { $: Id }             // Id 形如 "e:12" "i:7" "n:3" "d:gun.pistol"
```

Id 的前缀是**封闭集合**（这样 Ref 的合法性可在加载期与运行期机械校验）：

| 前缀 | 指向 | 例 |
|---|---|---|
| `e:` | Entity | `e:12` |
| `i:` | Item | `i:7` |
| `n:` | Node | `n:3` |
| `l:` | Link | `l:8` |
| `c:` / `s:` | Container / Slot | `c:4` `s:19` |
| `a:` | Attachment | `a:22` |
| `g:` | Agent | `g:p1` |
| `d:` | Def | `d:gun.pistol` |
| **`w:`** | **world 单例，恒为 `w:0`** | `attach.add({$:'w:0'}, 'mod.elite')` |

`w:0` 是第十一轮补的：`Attachment.target` 泛化到 World（1.3.1）是
"运行期改规则"（用例 96–99）的落地方式，但原稿从未给 world 一个可写进 `Ref` 的 Id，
导致 `attach.add(world, mod)` 无从表达。

数值域强约束：有限双精度，`NaN`/`Infinity` 在写入时被拒绝并降级为诊断事件。
整数语义由 Def 的 `clamp` 声明，不由内核假设。

**自动 Id 生成规则（UNDEF 澄清，2026-08-07）**：内核对每个前缀维护一个单调递增计数器，
`entity.create` / `item.create` / `node.create` / `link.create` 每次调用时取当前计数值后递增，
生成的 Id 形如 `e:1`、`e:2`……计数器在当前会话内永不重置，因此同前缀的 Id 在会话生命周期内唯一。
目前 Op 层不提供"指定显式 Id"的参数——`entity.create` 的 `overrides` 仅覆盖 `props` 值，
不允许覆盖 `id` 字段——因此不存在显式 Id 与自动 Id 的命名空间冲突；
若未来扩展支持显式 Id，显式值必须通过同一前缀的 `taken-id` 注册接口提前占位，
以防止后续自动 Id 与之碰撞（此为未来决策，目前不属于内核公开 API）。

### 1.2 地址

一切状态都有唯一路径，读写都走路径：

```
world.props.turn
world.props.factionRelations.zombie.player
entities.e12.props.hp
entities.e12.tags
entities.e12.containers.backpack.slots.s3.holds
entities.e12.relations.control.out          // 它操控着谁
nodes.n3.props.onFire
links.l8.props.locked
defs.gun.pistol.props.profile
knowledge.p1.facts.clue.footprint
world.decisions                              // 见 7.5
```

`props` 是**自由区**：任何键、任何 Value，内核不解释。
`props` 之外是**结构区**：内核维护不变量，只能通过 Ops（第 4 章）修改。

> **这是全文档最重要的一条分界。** HP 不是内核概念，它是 `props.hp`。
> 一个格斗玩法可以完全不用 `hp`，改用 `props.guardMeter`，内核毫无察觉。

### 1.2.1 前缀新增的审批机制

**新前缀的添加是架构决策，不是运行时操作。**

当出现以下情况时，必须通过四阶段审批流程才能新增 Ref 前缀：

#### 阶段 1：需求论证
- **提案者**需证明现有 8 种前缀无法表达新的"拓扑/所有权/生命周期"语义
- **反例库检查**：历史上曾有 12 次提案被拒（如 `r:` room、`f:` faction、`t:` tile），原因是可用 Node/Attachment/props 表达

#### 阶段 2：三处复用验证
- 新前缀必须在至少 **3 个独立用例** 中被引用
- 用例不能是"为了凑数而设计的变体"
- 例：`g:` (Agent) 通过验证的 3 用例：knowledge 索引、decision 来源、journal 归因

#### 阶段 3：不变量审计
- 每个新前缀必须在 §4.6 补充对应的 **结构不变量**
- 必须在 §13.4 预留对应的 **错误码区段**（如 `E_AGENT_*`）
- 例：`w:` (World) 在第十一轮补充时，添加了 `INV_WORLD_SINGLETON` 不变量

#### 阶段 4：向后兼容性检查
- 新前缀不能破坏现有 Ops 的语义
- 所有现有测试用例必须通过
- 必须提供"旧代码如何平滑迁移"的方案

#### 拒绝案例记录

| 提案前缀 | 拒绝原因 | 替代方案 |
|---------|---------|---------|
| `r:` (Room) | 与 Node 语义重叠 | 用 `microScene` 类型的 Node |
| `f:` (Faction) | 属于玩法层概念 | 用 `world.props.factions` + Agent |
| `t:` (Tile) | 与 Node 语义重叠 | 用细粒度 Node + Link |
| `p:` (Player) | 与 Agent 语义重叠 | 用 Agent (`g:`) |
| `skill:` | 不符合单字符约定 | 用 Attachment (`a:`) |

#### 历史决策记录

- **第 11 轮**：`w:` (World) 通过审批，因 Attachment.target 泛化需要全局单例引用
- **第 8 轮**：`g:` (Agent) 通过审批，因 knowledge/decision/journal 需要玩家身份语义
- **第 6 轮**：`s:` (Slot) 通过审批，因 Container 需要区分"槽位引用"与"容器引用"

### 1.3 集合

内核只有 6 个顶层集合：

| 集合 | 元素 | 说明 |
|---|---|---|
| `world` | 单例 | 全局 props、回合表、随机流、`knowledge`、`decisions`、`attachments` 池 |
| `defs` | Def | 蓝图（模板） |
| `nodes` | Node | 拓扑顶点 |
| `links` | Link | 拓扑边 |
| `entities` | Entity | 占位者（活体、载具、容器、门户、附属物宿主…） |
| `items` | Item | 被容纳者 |

`microScenes` 不是第 7 个集合 —— 见 2.2，它是 Node 的一种。

**Entity 与 Item 的唯一区别**：Entity 在拓扑里有位置，Item 在容器里有槽位。
一个东西可以来回转换（`item.promote` / `entity.demote`），这就是折叠自行车 ↔ 自行车。

### 1.3.1 Entity / Item / Attachment 运行时结构

```typescript
interface Entity {
  id: EntityId
  def: DefId
  tags: string[]
  props: Record<string, Value>
  node?: NodeId                  // 所在拓扑位置（结构区，只能由 entity.place 改）
  slot?: SlotId                  // ★ 若被装在槽位里（座位/被抓住），则 node 为空
  containers: Record<string, ContainerId>   // 按 name 索引，见 2.3
  attachments: AttachmentId[]
  relations: Record<string, { out: Ref[], in: Ref[] }>  // 见 1.3.2
}

interface Item {
  id: ItemId
  def: DefId
  tags: string[]
  props: Record<string, Value>
  slot?: SlotId                  // 所在槽位（结构区，只能由 item.move 改）
  stack?: number                 // 缺省 null = 不可堆叠；数值 = 当前层数
  stackMax?: number              // 由 Def 给出，null = 无限
  containers: Record<string, ContainerId>   // Item 也能有容器（枪的配件位）
  attachments: AttachmentId[]
}

interface Attachment {
  id: AttachmentId
  def: DefId
  target: Ref                    // ★ 宿主可以是 Entity / Item / Node / Link / World
  source?: Ref                   // 施加者（用于归因与"施加者死亡时移除"）
  props: Record<string, Value>
  stack: number
  expiresAt?: number             // 绝对 phase 序号，null = 永久
  activeAt?: number              // 生效起始 phase（delay 用）；当前 phase < 它则整个
                                 // attachment 视为未生效：rules 不挂载、aura 不授予、
                                 // hasAttachment 返回 false
  grantedBy?: AttachmentId       // ★ 由某个 aura 授予 → aura 失效时自动回收
}
```

`node` 与 `slot` 互斥（Entity 要么在拓扑上，要么在槽位里）是一条内核不变量，见 4.6。

`Attachment.target` 泛化到 **Node / Link / World**，一次解决三类看似无关的需求：

| target | 表达了什么 |
|---|---|
| Node | 地面着火、房间被毒气填满、这块地是安全区 |
| Link | 这扇门被加固、这条路被封锁、桥在燃烧 |
| **World** | ★ **运行期改规则** —— 见下 |

**`target: World` 是第五轮的关键发现。** 原设计隐含"玩法包装载后规则集不变"，
而 roguelike 的局内增益（"本局所有敌人 +1 血"）、卡牌的场地效果（"本回合法术费用 -1"）、
赛季规则、随机模式、难度调整，全都要求运行期改变规则集。

因为 `AttachmentDef.rules` 是一组 Hook，给 World 挂一个 attachment 就等于**临时插入一批规则**，
移除它就等于撤销。于是：

```
「本局所有敌人 +1 血」= attach.add(world, 'mod.eliteEnemies')
                        该 def 的 rules 含一条 after:entity.create → prop.add(hp,1)
「本回合法术费 -1」    = attach.add(world, 'field.discount')，duration:1
```

**Def 集合本身仍然是静态的**（加载期全部声明、可被 Linter 校验），
动态的只是"哪些 Def 此刻生效"。这条边界保住了静态可分析性 —— 
如果允许运行期造 Def，Linter 与 AI 静态分析同时失效，得不偿失。

### 1.3.1.1 Agent：决策者与观察者是同一个东西

第六轮发现的**归位项**。原设计里"观察者"只以 `knowledge[observerId]` 的一个字符串键
隐式存在，而"谁在操控这个 Entity"又靠 `relation('control')`。
两者其实是同一个概念的两半，不把它拼起来，下面每一条都要写代码：

| 需求 | 为什么现有结构不够 |
|---|---|
| 中途加入 / 掉线接管 | 没有"席位"概念，人接管 NPC 无处落笔 |
| 挂机转 AI / AI 转人 | 控制权来源是硬编码的 |
| 观战转参战 | 观察者与行动者是两套东西 |
| **GM / 导演模式** | 没有"有全知视野且能越权干预的决策者" |
| AI 难度分级 | 视野宽窄挂在哪儿不明确 |
| 队伍共享视野 | 多个 Entity 共享一份认知，无处表达 |

```typescript
interface Agent {
  id: AgentId
  kind: 'human' | 'ai' | 'observer'
  policy?: DefId                 // kind:'ai' 时的决策策略
  controls: Ref[]                // ★ 它此刻操控的 Entity（可多个，可为空）
  knowledgeScope: AgentId        // ★ 读谁的认知（队伍共享视野 = 指向同一个）
  omniscient?: boolean           // 观战 / GM / 调试器
  authority?: string[]           // ★ GM 越权：允许调用的特权 Action tag
  props: Record<string, Value>
}
```

三条推论，每条都消灭一类专用代码：

1. **控制权是数据**：`prop.set('agents.a1.controls', [...])` 就是接管。
   掉线 = 把 `kind` 改成 `'ai'` 并给个 policy；回归 = 改回 `'human'`。
   无人机操控 = 往 `controls` 里多加一个 Ref（**与 `relation('control')` 不冲突：
   relation 表达世界内的因果，Agent 表达谁在做决定**）。
2. **`knowledgeScope` 是间接层**：队伍共享视野 = 三个 Agent 指向同一个 scope。
   AI 难度 = 低难度指自己、高难度指一个 omniscient scope。**不需要"作弊开关"。**
3. **GM 是普通 Agent**：`omniscient:true` + `authority:['gm']`，
   而特权动作就是带 `tag:'gm'` 的普通 Action。内核不需要"GM 模式"这个概念，
   导演式干预、剧本编排、测试用的上帝之手全部是同一条路。

`world.agents` 与 `world.knowledge` 并列，都在 world 单例下，因此顶层仍是 6 个集合。

### 1.3.2 Relations：二元有向关系

```
relation.set(from, to, kind, props?)
```

关系**不是** props 里的一个 Ref 字段，因为需要三件 props 做不到的事：
反向查询（"谁在操控我"）、级联清理（宿主销毁时自动断开）、多重同类（一个主人多个随从）。

```typescript
interface Relation {
  kind: string                   // 'owner' | 'control' | 'ally' | 'target' | 任意自定义
  from: Ref
  to: Ref
  props: Record<string, Value>   // 关系自身可带数据（信任度、剩余操控回合）
}
```

内核对 `kind` 一无所知。召唤物、随从、无人机操控、仇恨表、租赁关系、
契约、家族树、"我记得是谁抢了我的枪" —— 同一个结构。

### 1.4 Def 与继承

```typescript
interface Def {
  id: DefId
  kind: 'entity' | 'item' | 'node' | 'link' | 'attachment' | 'action' | 'rule'
      | 'playpack' | 'decision' | 'prefab' | 'expr' | 'schedule' | 'policy'
  extends?: DefId[]              // 多重混入，后者覆盖前者
  abstract?: boolean             // 只能被继承，不能实例化
  tags?: string[]
  props?: Record<string, Value>  // 实例初值
  containers?: ContainerSpec[]   // 实例化时创建的容器，见 2.3
  slots?: SlotSpec[]             // 容器内的初始槽位，见 2.3
  actions?: DefId[]              // 提供的动作
  rules?: DefId[]                // 携带的规则
  clamp?: Record<string, { min?: number, max?: number, int?: boolean }>
  schema?: Record<string, PropSchema>  // 供 Linter 与编辑器用
}

interface PropSchema {           // 只描述 props 自由区的期望形状，不强制
  type: 'number' | 'string' | 'boolean' | 'ref' | 'list' | 'map'
  of?: PropSchema                // list/map 的元素类型
  required?: boolean
  label?: string                 // 编辑器里显示的字段名
  hint?: string
}
```

继承是**加载期展开**的（无运行时查链），因此深继承不影响性能，且能被静态校验。

「所有手枪共享弹道谱」= `defs.gun.pistol.extends = ['gun.base']`。零代码。

### 1.5 Tag 取代硬编码分类

内核没有 `EntityCategory` 枚举。`living` / `vehicle` / `container` 全是 tag。

```
where: hasTag($, 'living')
```

新增一类东西 = 新增一个 tag 字符串。内核不需要知道它存在。

---

## 2. 拓扑与容纳

### 2.1 Node 与 Link

```typescript
interface Node {
  id: NodeId
  def: DefId
  tags: string[]
  props: Record<string, Value>
  weight: number                 // 穿越代价，默认 1
  parent?: NodeId                // 附属关系（微型场景 → 天然场景）
  attachments: AttachmentId[]
}

interface Link {
  id: LinkId
  def: DefId
  a: NodeId
  b: NodeId
  direction: 'bidirectional' | 'unidirectional' | 'one-way-down' | 'one-way-up'
  weight: number
  tags: string[]
  props: Record<string, Value>   // 承载视觉遮挡/物理遮挡/过渡窗口/语义锚点等地图数据面增量
  attachments: AttachmentId[]
}
```

> **方向 token（2026-08-13 裁决 D-074，覆盖旧 `directed: boolean`）**：`Link` 用完整方向枚举 `direction` 表达方向，不再压成布尔 `directed`（旧 `directed: boolean` 语义由 `unidirectional` 承载）。单向陷阱显式标注为 `one-way-down`/`one-way-up`。编译链接规格与 `createLinkShape` 须携带此完整 token；方向（`direction`）与通行代价（`weight`）与遮挡（`props`）彼此独立，不互相绑定。

节点与边都能动态增删（`node.create` / `link.destroy`），所以随机地图生成、炸墙开洞、断桥
都不是特殊机制，是同一个 Op。

**自环 Link 允许（UNDEF 澄清，2026-08-07）**：`link.create` 中 `a === b`（从一个节点连向自身）是合法操作，内核不拒绝。
自环表达的语义由玩法包赋予——例如"这个房间里有一条暗道，可以在不离开房间的情况下躲避检索"——内核只保证拓扑不变量成立（自环 Link 的 `a`/`b` 引用的节点存在）。

### 2.1.1 多份拓扑与实例化

拓扑是**图**，不是"一张地图"。图可以有多个不连通分量，因此下列全部天然成立，
无需任何新概念：平行世界、梦境层、副本实例、载具内部空间、口袋维度。

- 「传送到梦境」= `entity.place` 到另一个分量的 Node
- 「梦里死亡在现实中受伤」= 跨分量的普通 Hook
- `dist` 在不连通时返回 `null`，玩法包据此判断"过不去"

但**批量复制一份子图**（刷一个新副本、生成一栈随机房间）如果只能靠
`forEach + node.create + link.create` 手写，会撞上 step 预算且极易漏连边。
因此需要一个原语：

```
prefab.spawn(defId, params?) -> { nodes: NodeId[], links: LinkId[], entities: EntityId[], root: NodeId }
```

```typescript
interface PrefabDef extends Def {
  kind: 'prefab'
  nodes: { key: string, def: DefId, props?: Record<string, Expr> }[]
  links: { a: string, b: string, def: DefId, direction?: 'bidirectional' | 'unidirectional' | 'one-way-down' | 'one-way-up', weight?: number, props?: Record<string, Value> }[]  // 用 key 互指
  entities?: { at: string, def: DefId, overrides?: Record<string, Expr> }[]
  items?: { into: string, container: string, def: DefId }[]
  attachTo?: string              // 与外部拓扑的接缝：把 root 连到调用方给的节点
}
```

`prefab.spawn` 做一件事：**按模板批量创建并重映射内部引用**（key → 新生成的 Id）。
`prefab.spawn` 须把模板声明的 `parent`（情景嵌套）与 `weight`（门户代价）透传到生成的 Node/Link，否则运行期情景是平的、所有连接代价恒为 1，距离模型无依据（对应 `src/play/map` 编译缺口，见 `docs/创作系统/02_地图生产管线.md` 数据契约）。
这是纯机械操作，不含任何玩法语义 —— 内核不知道生成的是地牢还是房车。

一次实现，覆盖：副本实例化、程序化地图、载具内部（车是 Entity，车内是它 spawn 出的子图）、
建筑内部房间、可摆放的营地、卡牌召唤出的战场区域。
对称地提供 `prefab.despawn(handle)`，级联清理并疏散占位者。

### 2.2 微型场景 = 带 owner 的 Node

微型场景**不是新结构**，它是 `parent` 指向天然场景、`owner` 指向创造者的 Node：

```
nodes.ms_e12 = { parent: 'n:3', props: { owner: {$:'e:12'} }, tags: ['micro'] }
```

`owner` 可以是 Entity（活体周身、车内）、Link（门口、窗边）、Node（小场景固有共享地）。
**owner 是泛化的 Ref，这一条让"过渡场景也能创造微型场景"不需要任何新概念。**

容量：`props.capacity`，缺省 `null` = 无限。内核只在 `place` 时读它，不预设任何数字。

### 2.3 Container 与 Slot

```typescript
interface Container {
  id: ContainerId
  owner: Id                      // Entity 或 Item（俄罗斯套娃合法）
  name: string                   // 'backpack' | 'trunk' | 'deck' | 'seats'
  slots: Slot[]                  // ★ 有序数组：**一切容器都有索引**
  insert: 'fixed' | 'shift'      // ★ 见 2.3.1
  props: Record<string, Value>   // readOnly（死亡背包）、capacityWeight…
}

interface Slot {
  id: SlotId
  tags: string[]                 // ['hand','left'] ['equip','head'] ['seat','driver']
  accepts?: Expr                 // 谓词，null = 接受一切
  holds?: Ref                    // Item **或** Entity
  props: Record<string, Value>
}
```

Def 里声明的是它们的**模板**（实例化与 `container.add` / `slot.add` 都读它）：

```typescript
interface ContainerSpec {
  name: string
  ordered?: boolean
  slots: SlotSpec[]
  props?: Record<string, Value>
}

interface SlotSpec {
  tags: string[]
  accepts?: Expr
  count?: number                 // 一次声明多个同类槽位（背包 4 格）
  initial?: DefId                // 初始内容（开局自带一把刀）
  props?: Record<string, Value>
}
```

五个关键泛化，每一个都是为了消灭一整类"需要改代码"：

| 泛化 | 消灭了什么 |
|---|---|
| **一个宿主可有多个具名 Container** | 车厢 vs 后备箱、身上 vs 快捷栏 |
| **Slot 可容纳 Entity** | 载具座位、抓住敌人、宠物携带笼、载器（容器承载活体）内部槽 |
| **Slot 数量可运行时增删** | 拓展背包、解锁装备位、临时仓位 |
| **`accepts` 是谓词** | 钱袋子只收货币、头盔位只收头盔 |
| **一切容器都有索引** | 牌堆、弹匣、队列、背包格、装备位、优先级顺序 |

> **载器是容器家族的特化（2026-08-14 项目所有者调和）**：**容器是引擎层唯一通用承载基元**——所有「带物品槽/承载槽」的东西（角色背包、装备位、双手槽、柜子、死亡背包、载具座位/货舱）都通过 `Container`/`Slot` 实现。`Slot.holds: Ref` 本就可指 Item **或** Entity（见上表「Slot 可容纳 Entity」）。**载器不是与容器同级的新基元**，而是对容器「内部承载活体、且内部无场景」这一家族形态的明确命名与约束特化，不改 `Container`/`Slot` 形式。载器承载面的活体进出用容器写通道（`container.enter/exit`）表达。类型签名见 `docs/L1_引擎层/05_底层引擎架构.md`「载器」节与 `.kiro/specs/wakeup-engine-layer/`。

### 2.3.1 索引是无条件的（第十一轮修正）

原稿把 `ordered` 写成一个可选布尔，**这是错的**：背包第 3 格、弹匣第 2 发、
装备栏的第一个手部槽位 —— 无索引的容器根本无法被稳定引用，
「不死图腾优先用手上的」这类规则也无从表达。

**修正：`Container.slots` 恒为有序数组，索引恒定存在。**
`ordered` 布尔被替换为 `insert`，它只区分**插入时其余元素是否移位**：

| `insert` | 语义 | 例子 |
|---|---|---|
| `'fixed'` | 槽位是固定编址，插入不移位，删除留空洞 | 背包格、装备位、座位 |
| `'shift'` | 插入使后续元素后移，删除使其前移（栈/队列语义） | 牌堆、弹匣、待处理队列 |

于是所有转移 Op 都带可选索引：

```
item.move(id, toContainer, toSlot?)          // toSlot 可为 SlotId 或索引号
```

**缺省索引的规则（统一适用于 `item.move` / `stack.split` / 自动拾取 / 自动丢弃）**：
不填索引时，**按索引顺序取第一个合法槽位**（`accepts` 通过且为空）；
无合法槽位则该 Op 返回 `ok:false`，**不静默丢弃、不吞掉物品**。

「我要在头顶加一个倒计时」= `entities.e12.props.hudTimer = 5` + 一条 phase 规则递减。
内核不需要知道"倒计时"是什么。

### 2.4 度量：加权最短路

内核提供**唯一一种**距离：以 `Link.weight` 与 `Node.weight` 为代价的最短路。

```
dist(a, b, opts?) : number | null
```

`opts` 可传 `via`（只走满足谓词的边）、`maxCost`（提前截断）、`metric: 'sum'|'hops'`。

大场景 ×2 = 给大场景 Node 一个 `weight: 2`。窗边强力位 = 给那条 Link 一个 `weight: 0`。
**距离范式不是内核规则，是玩法包填的权重。** 换个玩法可以全填 1，退化成跳数。

### 2.5 扩散查询 `spread`

```
spread(origin, budget, opts?) : { node: NodeId, strength: number, from: NodeId }[]
opts: { decay?: Expr, via?: Expr, metric?: 'sum'|'hops' }
```

从 origin 出发做预算受限的加权 BFS。每个可达节点返回**剩余强度**与**上游节点**
（`from` 使得"声音从哪个方向来"可被表达 —— NPC 能朝声源方向移动，而不只是知道有声音）。

返回**有序数组而非 Map**：迭代序必须确定（按 strength 降序、NodeId 升序），
否则回放不可复现（第 13 章）。

一次实现，五处使用：声音传播、爆炸威力衰减、气体蔓延、AI 影响力图、
`Query.in` 的范围限定（`radius` 是 `spread` 在 `metric:'hops'` 下的特例）。

---

## 3. 表达式与查询（纯读，无副作用）

### 3.1 Expr

表达式是内核的"名词与判断"。它**必须是全函数**：任何输入都返回值或诊断，绝不抛异常。

```typescript
type Expr =
  | Value                                  // 字面量
  | { path: string }                        // 读状态，越界 → null
  | { var: string }                         // 读局部变量
  | { op: string, args: Expr[] }            // 运算/内置函数
  | { q: Query }                            // 查询，返回 Ref[]
  | { call: DefId, args?: Record<string, Expr> }   // ★ 调用具名表达式，见 3.1.1
```

内置算子（固定集合，不可扩展 —— 这是安全边界）：

| 类 | 算子 |
|---|---|
| 算术 | `+ - * / % min max abs floor ceil round clamp` |
| 比较 | `== != < <= > >=` |
| 逻辑 | `and or not if` |
| 空值 | `coalesce isNull` |
| 字符串 | `concat format` |
| 表 | `len get slice contains indexOf sort reverse sum any all map filter` |
| 拓扑 | `dist path spread radius nodeOf parentOf containerOf slotOf occupantsOf` |
| 状态 | `hasTag hasAttachment attachCount propOf defOf isA` |
| 关系 | `relOut relIn hasRel relProp` |
| 认知 | `knows visibleTo`（见第 11 章） |
| 随机 | `roll pick shuffle weightedPick`（走命名流，见第 10 章） |

`radius(node, n)` = `spread(node, n, {metric:'hops'})` 的节点集，作为高频写法的糖。
`isA(ref, defId)` 沿 Def 继承链判断，因此「所有手枪」可写成 `isA($,'gun.base')`。
`relOut(ref,kind)` / `relIn(ref,kind)` 是 1.3.2 反向查询的读侧入口。

`/` 除零返回 `null`，不抛。`get` 越界返回 `null`。**没有 `eval`，没有字符串拼接执行。**

### 3.1.1 具名表达式：`kind: 'expr'`

第九轮补的一项，它同时解决两个看似无关的问题。

```typescript
interface ExprDef extends Def {
  kind: 'expr'
  params?: string[]              // 形参名，在体内用 { var: name } 读
  body: Expr
  pure: true                     // 恒为真：具名表达式不能有副作用
}
```

```
defs.expr.isHostile = { params:['a','b'],
  body: <a 与 b 阵营敌对 且 都活着 且 未被魅惑> }

任意 Action 的 require: { call:'expr.isHostile', args:{ a:self, b:target } }
```

**问题一：可读性与可维护性。** 一门没有抽象手段的语法，会逼创作者把同一个 8 层嵌套谓词复制到 20 个 Action 里，改一次要改 20 处。具名表达式解决了这个问题。

**问题二：派生属性。** 「攻击力 = 力量 + 武器伤害 + buff」无需 Hook 重算，具名表达式让派生属性成为**读时求值的一次声明**：`{ call:'expr.attack', args:{ e:self } }`。

**问题三（意外红利）：MOD 可替换判定。** 配合 §9.2 的 `overrides`，"双倍掉落 MOD" 只需 override `expr.lootAmount` 一个 Def。**具名表达式成了玩法包之间的扩展点。**

安全边界：
- `pure` 恒真，具名表达式**不能调 Op**，只能读
- 调用图必须**无环**，由 Linter 在加载期检测 —— 仍非图灵完备
- 求值深度计入 §3.1.5 的总预算，不会因深层调用挂死

### 3.1.2 上下文变量

表达式求值时可以访问以下上下文变量：

| 变量 | 说明 |
|------|------|
| `self` | 当前求值实体的引用（Ref），等价于 `ctx.entity` |
| `ctx.entity` | 当前求值实体的引用 |
| `ctx.target` | 当前事件的目标实体（若有） |
| `ctx.source` | 当前事件的来源实体（若有） |
| `ctx.phase` | 当前相位序号 |

上下文变量通过 `{ var: 'self' }` 或 `{ var: 'ctx.entity' }` 语法访问。
未绑定的上下文变量返回 `null`，不抛异常。

**设计原则**：
- 上下文变量是只读的
- 作用域按调用栈动态绑定
- 未绑定变量访问返回 `null`（保持全函数承诺）

### 3.1.3 类型规则

Expr 对参与运算的操作数有以下类型约束：

**算术运算**（`+ - * / % min max abs floor ceil round clamp`）：
- 两操作数类型必须相同（number + number → number）
- 类型不匹配时返回 `null`（不报错，保持全函数）
- `null` 参与算术运算返回 `null`

**比较运算**（`== != < <= > >=`）：
- 两操作数类型必须相同
- `null == null` → `true`
- `null ==` 任何非 null 值 → `false`
- 类型不匹配时返回 `false`

**逻辑运算**（`and or not`）：
- `and` / `or`：两侧必须为 boolean 类型，否则返回 `null`
- `not`：操作数必须为 boolean 类型，否则返回 `null`
- **短路求值**：`and` 左侧为 `false` 时不求值右侧；`or` 左侧为 `true` 时不求值右侧

**字符串运算**（`concat format`）：
- 使用专门的字符串算子，不与 `+` 混用
- `+` 在两侧同为 string 时执行字符串拼接
- 不同类型混合 `+` 返回 `null`

**类型化查询算子**：
- `sum` / `avg` / `min` / `max`：返回 number
- `count`：返回 number
- `any` / `all`：返回 boolean
- `len`：返回 number

### 3.1.4 运算符优先级

标准数学优先级（从高到低）：

| 优先级 | 运算符 | 结合性 |
|--------|--------|--------|
| 1 | `( )` | — |
| 2 | 一元：`not - abs floor ceil round` | 右结合 |
| 3 | 幂运算：`**` | 右结合 |
| 4 | 乘除取模：`* / %` | 左结合 |
| 5 | 加减：`+ -` | 左结合 |
| 6 | 比较：`== != < <= > >=` | 左结合 |
| 7 | 逻辑与：`and` | 左结合 |
| 8 | 逻辑或：`or` | 左结合 |

**链式比较**：不支持 `a < b < c` 语法，必须写成 `(a < b) and (b < c)`。
理由：避免歧义，保持表达式树的确定性，显式形式更易于 AI 静态分析。

### 3.1.5 求值终止条件

为保证"不挂死"承诺，表达式求值有以下限制：

| 限制项 | 缺省值 | 说明 |
|--------|--------|------|
| **最大求值步数** | 10,000 | 每步包括一个操作符求值或一次属性读取 |
| **最大栈深度** | 1,000 | 嵌套调用深度 |
| **最大结果大小** | 1 MB | 返回的 Value（表/映射）序列化大小 |

超出限制时：
- 返回 `null` + `warn` 诊断事件
- 不抛异常
- 事务不回滚

**数值溢出规则**：
- 超出 IEEE 754 表示范围的运算返回 `Infinity`
- 写入时拒绝 `Infinity` / `NaN`（§1.1 已定义）
- 求值表达式允许 `Infinity` / `NaN` 作为中间值

**负零语义**：
- `-0` 与 `0` 在比较运算中相等
- `-0` 在条件判断中视为 truthy
- 提供 `isNegativeZero(n)` 算子检测负零

### 3.1.6 Lambda 与闭包

Expr 本身不支持 lambda 字面量语法（有意为之——保持非图灵完备）。

**具名表达式（§3.1.1）的参数传递**：
- 通过 `{ call: DefId, args: { paramName: Expr } }` 传入实参
- 参数在体内通过 `{ var: 'paramName' }` 访问
- 参数作用域仅为被调用表达式的函数体

**闭包语义**：
- 不支持闭包捕获（有意省略）
- 具名表达式体内只能访问：局部参数、上下文变量（§3.1.2）、通过 `{ path: string }` 读取的状态
- 不能访问调用处的局部变量

**为什么不支持 lambda**：
- 闭包会引入可变作用域，难以静态分析
- 具名表达式已足够表达派生属性与复用判定
- 配合 `overrides` 机制，MOD 可替换任意表达式，无需继承或闭包

### 3.2 Query

```typescript
interface Query {
  from: 'entities' | 'items' | 'nodes' | 'links' | 'attachments' | 'defs'
       | 'agents' | 'decisions' | 'intents' | 'log'    // ★ log 见 3.2.1
  where?: Expr                   // 谓词，$ 绑定当前元素
  in?: Expr                      // 空间限定：节点 / 半径 / spread 结果
  visibleTo?: Expr               // 认知过滤（信息不对称的关键）
  orderBy?: Expr
  desc?: boolean
  limit?: number
}
```

一个 Query 语言替代了所有"找东西"的专用函数：

```
「附近 3 格内中毒的敌方活体，血最少的优先」
{ from: 'entities',
  in: { op:'radius', args:[{path:'self.node'}, 3] },
  where: { op:'and', args:[
    { op:'hasTag', args:[{var:'$'},'living'] },
    { op:'hasAttachment', args:[{var:'$'},'poison'] },
    { op:'!=', args:[{path:'$.props.faction'},{path:'self.props.faction'}] } ]},
  orderBy: { path:'$.props.hp' } }
```

AI 选目标、范围技能、任务判定（"房内僵尸清零"）、UI 高亮、光环生效范围 —— 同一个东西。

### 3.2.1 查询历史：`from: 'log'`

第八轮泛化。内核本来就为回放持有 journal（第 12 章），但玩法包读不到它，
于是每一个涉及"过去"的机制都要靠 Hook 手动往 props 镜像一份数据。

```typescript
world.log: Event[]               // 有界环形缓冲
// PlaypackDef 声明保留窗口：logRetention: { phases?: number, max?: number }
```

一次开放，多处使用：

| 需求 | 写法 |
|---|---|
| 战斗日志 / 击杀提示 | 表现层查 `from:'log', where: type=='death'` |
| 「重复你上一个动作」 | 查最近一条 `intent.resolved` |
| 复仇（针对最后打我的人） | 查最近 `damage` 的 `source` |
| 本局战绩 / 成就核验 | `from:'log'` 计数，不必预先埋计数器 |
| AI 识别对手套路 | 查对手历史 Intent 分布 |

**必须有界**（`logRetention`），否则长局的内存与快照体积无上限 —— 这是
"不挂死"承诺的一部分。超出窗口的历史只存在于外部存档的 journal 里，玩法包查不到。
**这条边界要明说**：玩法包若需要全局统计，仍应用 Hook 累加计数器；
`log` 是给"最近发生了什么"用的，不是给"整局统计"用的。

---

## 4. Ops：唯一的写入通道

### 4.1 原则

- 状态**只能**被 Op 修改。没有任何"直接赋值"的后门。
- 每个 Op 都是**可日志、可求逆**的（第 12 章）。
- 每个 Op 都发出事件，因此都能被 Hook 拦截（第 6 章）。
- Op 返回 `Result`，不抛异常。

```typescript
type Result<T> = { ok: true, value: T } | { ok: false, code: ErrCode, detail: string }
```

### 4.2 属性类

```
prop.set(path, value)
prop.del(path)
prop.add(path, delta)              // 数值增减，缺省视 0，尊重 clamp
list.insert(path, index|'end', value)
list.remove(path, index|match)
tag.add(id, tag) / tag.del(id, tag)
```

**对已销毁对象调用属性类 Op（UNDEF 澄清，2026-08-07）**：`prop.del`/`prop.set`/`prop.add`/`tag.del`/`tag.add` 的第一个路径或 id 参数最终指向的宿主对象（Entity / Item / Node / Link）**不存在**时——无论是从未创建还是已被销毁——Op 返回 `ok:false, code:'E_REF_MISSING'`，**不幂等**，不静默成功。调用方需自行决定是否先做存在性检查，或在业务层容忍该错误码。与所有其他需要宿主对象存在的 Op 行为一致，无特例。

```
entity.create(def, at, overrides?)  -> EntityId
entity.destroy(id, disposition)     // disposition 决定内容物去向
entity.setDef(id, def, carry)       // ★ 变身：保留 id / 关系 / 位置
entity.place(id, node)              // 移动（受容量与 Hook 约束）
item.create(def, into, slot?)       -> ItemId
item.destroy(id)
item.move(id, toContainer, toSlot?) // ★ 唯一的转移原语
item.promote(id, at)                // Item → Entity（展开自行车）
entity.demote(id, into, slot?)      // Entity → Item（折叠自行车）
stack.split(id, n, into?, atSlot?) -> ItemId   // ★ 失败则整体回滚，见 4.3.1
stack.merge(a, b)
container.add(owner, containerDef) / container.del(id)
slot.add(container, slotDef) / slot.del(id)
node.create / node.destroy / link.create / link.destroy
node.merge(keep, absorb, carry)     // ★ 两个房间被打通成一个，见 4.4.1
node.split(id, spec) -> NodeId[]    // ★ 一个空间被隔断
prefab.spawn(def, params?) / prefab.despawn(handle)   // ★ 子图实例化，见 2.1.1
agent.bind(agentId, entityRef) / agent.unbind(...)    // ★ 接管/掉线，见 1.3.1.1
relation.set(from, to, kind, props?) / relation.del(from, to, kind)
attach.add(target, def, params?) -> AttachmentId
attach.del(id)
decision.open(def, askees, ctx?) -> DecisionId    // ★ 向非当前行动者征求决策，见 7.5；def.condition对ctx求值为false则报E_DEC_CONDITION_UNMET
decision.answer(id, actor, choice: string | string[], replace?: boolean)  // ★ choice支持数组（多选），replace控制追加/整体替换
decision.retract(id, actor, choice?: string)  // ★ 撤销答案；不带choice时撤销该actor全部答案，仅当retractable:true时可用
decision.resolve(id)                        // ★ 强制判定并触发onResolve（自动resolve走内部逻辑，此Op供显式/超时路径调用）
decision.void(id, reason)                   // ★ 前提失效或超时无defaultAnswer时的显式作废，触发onVoid
decision.queryActions(actorId): Decision[]  // ★ 返回actor可操作的Decision列表
intent.submit(agent, action, bindings, hidden?) -> IntentId  // ★ 冻结代价，见 7.6
intent.reveal(id)                                  // 揭示 hidden Intent
intent.resolve(id)                                 // 重检 require → 执行或 void
intent.void(id, reason)                            // 退回代价并发诊断事件
outcome.reach(defId, subject)                      // ★ 结局达成，见 9.1
```

**为什么只有一个 `item.move`**：拾取、丢弃、装备、卸下、买、卖、交易、抽牌、发牌、
死亡背包灌注 —— 全部是容器间转移，区别只在 `require` 谓词与前后 Hook。
这就是"商店是网关，不是模块"的落地形态。

### 4.3.1 `stack.split` 的原子性（刷物品的重灾区）

拆分会**生成一份新的物品数据**，因此它是复制类 bug 的高危点。三种可能的实现里只有一种安全：

| 实现 | 结果 |
|---|---|
| 无处可放就丢在地上 | 拆分成为一种"凭空产出地面物品"的手段，且绕过容量限制 |
| 无处可放就吞掉 | 直接销毁玩家资产 |
| ★ **无处可放就整体回滚到拆分之前** | 世界回到未拆状态，总量守恒 |

**定稿取第三种**：`stack.split` 在一个事务内完成"原栈减 n + 新建 n + 放入槽位"，
任何一步失败则整体回滚 —— 原栈数量不变，不产生新 Item，不落地。

不填 `atSlot` 时按 2.3.1 的缺省规则取第一个合法槽位。
**图形界面的拖拽必须视为不可信输入**：UI 通常已给出明确索引，
但内核不假设它合法，仍走同一条校验路径。

由此得到一条可断言的性质，直接进 §13 与模糊测试：
**任意 Op 序列后，同一 DefId 的物品总量只能因 `create` / `destroy` 改变，
`split` 与 `merge` 恒守恒。**

### 4.3.2 stack操作边界规则（第十二轮定稿）

**`stack.split` 前置条件**（按检查顺序）：

| 违反条件 | 错误码 | tx行为 |
|---------|--------|--------|
| `amount ≤ 0`（必须为正整数） | `E_OP_STACK_AMOUNT` | 非致命，零改动 |
| `amount > source.stack` | `E_OP_STACK_AMOUNT` | 非致命，零改动 |
| `source.stackMax == 1` | `E_OP_STACK_SPLIT_FORBIDDEN` | 非致命，零改动 |
| 无合法目标槽位 | `E_OP_NO_LEGAL_SLOT` | 非致命，回滚split（§4.3.1守恒） |

**`stack.merge` 前置条件**（按检查顺序）：

| 违反条件 | 错误码 | tx行为 |
|---------|--------|--------|
| `a == b`（同一物品自merge） | `E_OP_SELF_MERGE` | 非致命，零改动 |
| `a.def != b.def`（Def不匹配） | `E_OP_MERGE_DEF_MISMATCH` | 非致命，零改动 |
| `b.stack + a.stack > b.stackMax` | `E_OP_STACK_OVERFLOW` | 非致命，零改动 |

**merge 成功语义**：`b.stack += a.stack`，然后 `a` 被 destroy（在事务内原子完成）。

**`stack.adjust`（调整堆叠数量）**：
- `delta` 允许正负；结果必须满足 `0 < result <= stackMax`
- `result ≤ 0`：物品自动 destroy（stack归零触发销毁）
- `result > stackMax`：报 `E_OP_STACK_OVERFLOW`

**slot 的 compatible auto-merge**：
容器槽位有 `autoMerge?: boolean`（缺省 `false`）。
当 `autoMerge = true` 时，`item.move` 将物品放入目标容器时，
若目标槽位已有相同 Def 的物品且可合并（`stack + incoming ≤ stackMax`），
则自动调用 `stack.merge` 而非占用新槽位。
若全满则回落到普通空槽位分配；无法放入则 `E_OP_NO_LEGAL_SLOT`。

**shift 模式的插入位置**：
- `'shift'` 模式容器：`item.move` 不带 `toSlot` 时，物品插入**末尾**（追加语义）
- 带 `toSlot = index` 时，插入到指定位置，后续元素后移
- 任何删除（`item.destroy` / `item.move` 移出）触发后续元素前移，保持无空洞
- `container.compact`：`'fixed'` 模式下，将全部物品向低索引压缩（消除空洞）

**cost.freeze 参数约束**：
- `amount ≤ 0` 时报 `E_COST_INVALID_AMOUNT`，拒绝冻结
- 合法的 freeze 必须为正整数（与堆叠 amount 同等约束）

**新增 E_OP_* 错误码**（补入 §13.4）：

| 错误码 | 触发条件 | tx行为 |
|--------|----------|--------|
| `E_OP_STACK_AMOUNT` | split amount ≤ 0 或 amount > source.stack | 非致命 |
| `E_OP_STACK_SPLIT_FORBIDDEN` | 对 stackMax=1 的物品执行 split | 非致命 |
| `E_OP_STACK_OVERFLOW` | merge/adjust 后超过 stackMax | 非致命 |
| `E_OP_SELF_MERGE` | a == b 的 stack.merge | 非致命 |
| `E_OP_MERGE_DEF_MISMATCH` | merge 两个 Def 不同的物品 | 非致命 |
| `E_TX_NESTED` | 在活跃事务内调 tx.begin() | 非致命（外层事务继续） |
| `E_COST_INVALID_AMOUNT` | cost.freeze amount ≤ 0 | 非致命 |

### 4.4 `entity.setDef` 与 `carry`

变身（人 → 狼人 → 巨狼）不能用"销毁+新建"实现，因为会丢掉：
指向它的关系、别人对它的记忆、它持有的容器、它在别人槽位里的引用。

```
entity.setDef('e:12', 'werewolf', { carry: ['props.hp','relations','containers','attachments'] })
```

保留 id 是关键。多段变身、破甲变形、载具形态切换、幽灵化 —— 同一个 Op。

### 4.4.1 `node.merge` / `node.split`：同一个论证的对称形式

`entity.setDef` 存在的理由是"销毁+新建会丢引用"。**这个论证对 Node 同样成立**，
所以第六轮补上对称的一对。

「炸掉两个房间之间的墙，它们变成一个空间」如果写成
`node.destroy ×2 + node.create + forEach place`，会丢掉：
指向旧节点的 Link、别人记忆里的"我在 3 号房见过他"、节点上的 attachment（着火）、
以它为 parent 的微型场景。

```
node.merge('n:3', 'n:4', { carry: ['attachments','links','occupants','children'] })
```

语义：`absorb` 的边改指 `keep`、占位者迁入 `keep`、子节点改挂 `keep`、
attachment 按 `carry` 策略合并，然后 `absorb` 销毁。**引用完整性由内核保证，不由创作者手写。**

`node.split` 是逆向：一个空间被隔断成两个，按 spec 分配占位者与边。
这一对同时服务：炸墙、拆隔断、微型场景指针合并（03 文档的小场景共享地）、
房间被水淹没后合并成"水域"、副本区域动态重划。

### 4.5 结构性 Op 必须可被否决

```
entity.place → 依次发出 before:place → (Hook 可 veto) → 执行 → after:place
```

这一条让**负重上限、禁止进入、门被堵、载具满座、场景容量**全部无需内核内建：
玩法包挂一条 `before:item.move` 的 Hook，检查 `sum(weight) > capacity` 就 veto。

内核不知道"负重"是什么，但它保证负重可以被实现。

### 4.6 不变量（内核自己维护，不可被玩法包破坏）

| 不变量 | 说明 |
|---|---|
| 引用完整性 | 不存在指向已销毁对象的 Ref（销毁时级联清理或改写为 null） |
| 单一容纳 | 一个 Item 同时最多在一个 Slot 里 |
| 单一位置 | 一个 Entity 同时最多在一个 Node 里 |
| **位置互斥** | Entity 的 `node` 与 `slot` 不可同时非空（在座位上就不在拓扑上） |
| 无环容纳 | 容器不能直接或间接装进自己（Entity 装进自己背包亦禁止） |
| 拓扑一致 | Link 的两端必须存在；Node 销毁时其 Link 一并销毁 |
| **父子一致** | 微场景 Node 的 `parent` 必须存在；父销毁则子一并销毁并疏散占位者 |
| **关系对称** | `relations[k].out` 与对端 `.in` 必须互为镜像，由内核维护 |
| **容器双向一致** | `Container.owner` 与宿主的 `containers[name]` 必须互指；宿主销毁则容器销毁 |
| **槽位索引连续** | `insert:'shift'` 的容器无空洞；`'fixed'` 的容器索引恒定不重排 |
| **堆叠守恒** | `stack.split`/`merge` 不改变同 DefId 的物品总量（见 4.3.1） |
| **代价守恒** | 冻结的代价必被结算或全额退回，不存在"冻结后遗忘"（见 7.3） |
| **附属一致** | Attachment 的 target 存在；aura 失效时 `grantedBy` 指向它的全部一并回收 |
| **堆叠有界** | `stack` ≥ 1 且 ≤ `stackMax`；归零则 Item 自动销毁 |
| **决策有终** | 每个 open Decision 或被答满、或超时，不存在永久待答 |
| **决策答案合法** | `answers` 中任何 choice 必属于 `DecisionDef.options[].name`；`selection.mode='multi'`时数量满足 `[minCount, maxCount]` 约束 |
| **决策完成充分** | Decision 进入 `resolved`/`timeout` 时，已答 askees 数满足 `quorum` 要求（`onAskeeInvalid` waive 后按剩余有效 askees 重算） |
| 数值有界 | 写入非有限数被拒绝 |
| **前缀集合封闭** | Ref 前缀集合在运行期不可扩展（§1.2.1） |
| **Id 命名空间隔离** | 不同前缀的 Id 空间独立 |
| **Journal 三角隔离** | 玩法包不可访问完整 Journal；表现层不可访问 Op 细节；调试器仅在 debugMode 下可用（§12.X） |
| **log 窗口有界** | `world.log` 按 `logRetention` 截断，超出窗口的历史对玩法包不可见（§12.X.1） |
| **试探 Event 隔离** | AI 搜索期间的 Event 不进 `world.log`（§12.X.2） |
| **Hook 有唯一 id** | RuleDef.id 唯一，否则拒绝加载（Linter 检查） |
| **Emit 调用栈隔离** | 调用栈是运行时状态，不随 tx 回滚清除 |

违反不变量的 Op 返回 `ok:false`，**不会**留下半改状态（见 4.7）。

### 4.6.1 延时效果一致性不变量

**待决状态有界**：
- 所有 `pendingEffects` 的 `triggerAt` 必须 ≥ 当前 phase
- 若 `source` 字段存在，则 `source` 引用的实体必须存在（若 source 被销毁，pending effect 在触发前自动作废）
- pending 队列总长度受 `maxPendingEffects` 约束（缺省 10⁴），超出则最早的 pending effect 被强制触发或作废

### 4.7 事务（第十二轮完整定稿）

```
tx.begin() / tx.commit() / tx.rollback()
```

一次动作解算、一条规则执行、一次 AI 试探，都在事务里。**所有 Op 共享事务，任何一步
致命失败 → 整体回滚。这是"暴力边界测试不产生半损坏状态"的机械保证。**

**隔离级别（Read Your Own Writes）**：

| 场景 | 可见性 |
|------|--------|
| 同一事务内，后续 Op 读取自身修改 | ✅ 立即可见 |
| 事务外 / 并发读取，在 `tx.commit()` 完成前 | ❌ 不可见（隔离） |
| `tx.commit()` 成功后 | ✅ 对全局可见 |

**禁止嵌套事务（不可绕过）**：
- `tx.begin()` 在已有活跃事务时 → 立即报 `E_TX_NESTED`，外层事务继续，新 begin 无效
- 理由：嵌套事务的"部分回滚"语义极难与不变量检查和 Hook 管道协作，内核选择拒绝而非降级

**Op 失败的执行策略（致命 vs 非致命）**：

| 情形 | 行为 |
|------|------|
| Op 返回 `{ ok: false }` 且**非致命** | 该 Op 零改动；后续 Op **继续执行** |
| Op 返回 `{ ok: false }` 且**致命**（见下） | 整个事务立即回滚，后续 Op 不执行 |
| `{ abort: expr }` effect 触发 | 等同致命，整个事务回滚 |
| Flow step 预算超支 | 等同致命，整个事务回滚 |
| Hook depth 超限 | 等同致命，整个事务回滚 |

**致命 vs 非致命的判定**：

| 条件 | 是否致命 |
|------|---------|
| `E_INV_*` 不变量被破坏 | ✅ 致命（一律 fatal，见 §13.2） |
| `E_OP_*` Op 前置条件不满足 | ❌ 非致命（error 级，状态零改动） |
| `E_EXPR_*` 表达式错误 | ❌ 非致命（返回 null，见 §13.5） |
| `E_HOOK_DEPTH_EXCEEDED` | ✅ 致命（回滚整个事务） |
| `E_HOOK_REENTRY` | ✅ 致命（回滚整个事务） |
| `E_FLOW_BUDGET` | ✅ 致命（回滚整个事务） |
| `E_FLOW_ABORT` | ✅ 致命（回滚整个事务） |

**回滚的完整性（第十二轮定稿）**：
事务回滚是**全量回滚**——事务内**所有** Op 的效果都撤销，包括：
- `entity.destroy`（实体恢复存在）
- `item.destroy`（物品恢复存在）
- `stack.split`（新物品不存在，原栈恢复）
- `stack.merge`（合并撤销，两物品恢复）
- 任何 `prop.set / prop.del / prop.add`
- 任何 `tag.add / tag.del`

**没有"不可回滚的 Op"**。这是强不变量，确保模糊测试和 AI 探索不留残余状态。

**事务内 Op 依赖**：
同一事务内，前序 Op 的返回值（如新建实体的 EntityId、split 产生的 ItemId）可立即用于
后续 Op：内核在事务提交前已创建这些对象（仅对当前事务可见），
提交成功后才对全局可见，回滚则整体消失。

---

## 5. Flow：效果脚本

效果是内核的"动词序列"。它不是通用编程语言，是**有界的**指令表。

```typescript
type Effect =
  | { op: string, args: Record<string, Expr> }        // 调 Op
  | { let: string, be: Expr }                          // 局部变量
  | { if: Expr, then: Effect[], else?: Effect[] }
  | { forEach: Expr, as: string, do: Effect[] }        // 受 maxIter 约束
  | { while: Expr, do: Effect[], maxIter: number }     // maxIter 必填
  | { emit: string, data?: Expr }
  | { after: Expr, do: Effect[] }                      // 延迟 N 个时间单位
  | { at: Expr, do: Effect[] }                         // 定时到某相位
  | { try: Effect[], catch?: Effect[] }                // 捕获 ok:false
  | { abort: Expr }                                    // 主动失败，回滚事务
```

约束：

- 每次 Flow 执行有 **step 预算**（缺省 10⁴），超支 → 中止 + 诊断事件，不挂死
- `while` 必须写 `maxIter`，Linter 强制
- 无函数定义、无递归调用、无闭包 —— **故意不图灵完备**

复杂度由"很多条小规则组合"承载,不由"一段大脚本"承载。这既是安全边界,也让
AI 可以静态分析规则集。

### 5.1 延时 Effect 与状态一致性

**pending 事件的存储**：

```typescript
world.pendingEffects: PendingEffect[]

interface PendingEffect {
  id: PendingEffectId
  triggerAt: number        // 绝对 phase 序号（{at} 或当前 + {after}）
  effects: Effect[]
  context: Record<string, Value>  // 创建时的闭包变量
  source?: Ref             // 创建者（用于 source 失效检测）
  validityCheck?: Expr     // 可选的有效性条件
}
```

**触发时的 TOCTOU 重检**：

每个 pending effect 触发前，执行以下检查：

| 检查项 | 失败行为 |
|-------|---------|
| `source` 仍存在 | 若已销毁，pending effect 作废 |
| `validityCheck` 通过 | 若返回 false，pending effect 作废 |
| `context` 中引用的 Ref 仍有效 | 若悬空，effects 中涉及该 Ref 的 Op 返回 ok:false |

**示例**：

```typescript
// 设置"3 回合后爆炸"
Action 'plant_bomb' {
  effects: [
    { op: 'entity.create', args: { def: 'd:bomb' }, let: 'bomb' },
    { after: 3, effects: [
      { op: 'damage', args: { 
          targets: { from: 'entities', in: { radius: { center: { $: 'bomb' }, range: 3 } } },
          amount: 5
        }
      },
      { op: 'entity.destroy', args: { target: { $: 'bomb' } } }
    ]}
  ]
}
```

若 bomb 在 3 回合内被拆除（destroy），则 pending effect 的 `validityCheck: { op: 'exists', args: { $: 'bomb' } }` 自动失败，爆炸不触发。

---

## 6. Events & Hooks：一条管道吃掉半个 RPG

### 6.1 事件

每个 Op 与每个玩法自定义 `emit` 都产生事件：

```typescript
interface Event {
  type: string                   // 'damage' | 'item.move' | 'turn.begin' | 任意自定义
  payload: Record<string, Value> // ★ 可被 modify 阶段改写
  source?: Ref                   // 施动者
  cause?: EventId                // ★ 因果链父节点
  depth: number                  // 连锁深度
  cancelled: boolean             // ★ 是否被取消（用于 after 判定）
  result?: EventResult           // ★ default 阶段的返回值，after 阶段可读
}

interface EventResult {
  // Op 的默认效果返回值，不同 Op 有不同的 result 结构
  // 例如 damage 事件: { hpBefore: number, hpAfter: number, final: number }
  // 例如 item.move 事件: { fromSlot?: SlotId, toSlot: SlotId, item: ItemId }
  [key: string]: Value
}
```

`cause` 链让**归因**成为内核能力：陷阱炸死人算放陷阱者的击杀、中毒致死算下毒者的、
推下悬崖算推的人的。没有它，每种间接伤害都要单独写代码。

`event.result` 让 after 阶段能访问 default 的执行结果。例如 after:damage 可以读
`event.result.hpAfter` 来判断是否击杀。

### 6.2 五个阶段

```
before   可 veto（返回 abort）
modify   可改写 payload，按排序顺序全部执行
instead  可整体替换默认行为（★ 只有一个生效，其余不使用，见下）
default  内核/动作的原本效果
after    只读式响应，可再发新事件
```

**before / modify / after 阶段的排序（第十二轮定稿）**：
这三个阶段的 Hook 按**统一排序键**全部执行（不是只有 instead 才排序）。
- 所有 Hook 都执行（不是"第一个执行，其余跳过"）
- Hook 按排序顺序执行
- before 的 `abort` 效果会 veto 整个 Op（中止后续 Hook 和 default）
- modify 的修改对后续 Hook 和 default 可见
- after 即使事件被 instead 阻止（cancelled=true）仍执行

**`instead` 的竞争裁决（第十一轮定稿，补充第十二轮）**：
候选按 `(priority↓, containerIndex↑, slotIndex↑, defId↑, id↑)` 排序，
**取第一个 `when` 通过者执行，其余一律不使用 —— 不报错、不视为 veto、不叠加**。

**排序键各维度定义**：

| 维度 | 含义 | 排序方向 | 来源 |
|------|------|----------|------|
| `priority` | Hook 的优先级 | ↓降序（数值大优先） | RuleDef.priority |
| `containerIndex` | 宿主容器索引 | ↑升序（小值优先） | 见下 |
| `slotIndex` | 槽位索引 | ↑升序（小值优先） | Slot 在 Container.slots 数组中的位置 |
| `defId` | Hook 所在 Item/Entity 的 DefId | ↑升序（字典序） | Hook 宿主的 Def.id |
| `id` | Hook 的唯一标识符 | ↑升序（字典序） | RuleDef.id（★ 必填） |

**containerIndex 定义**：

| 宿主类型 | containerIndex | 说明 |
|----------|----------------|------|
| Slot 中的 Item | Container 在宿主 containers 中的索引 | 按声明顺序 |
| Entity 自身的 rules | **-1** | 特殊值，永远排第一（因为 -1 < 0） |
| Node 自身的 rules | **-1** | 特殊值 |
| Link 自身的 rules | **-1** | 特殊值 |
| World 的 attachments | **-2** | 全局级别，最后执行 |
| Prefab/Playpack 的 rules | **-3** | 规则定义级别 |

**preventExcept 组合规则**：
只有排序第一的 instead Hook 执行，其返回值生效。
- 若第一个 Hook 返回 `preventAll` → 阻止 default
- 若第一个 Hook 返回 `preventExcept([...])` → 按白名单判定
- 其余 Hook **一律不执行**，不叠加、不取交集/并集

**tie-breaker**：当 `(priority, containerIndex, slotIndex, defId)` 完全相同时，
使用 `id` 作为最终 tie-breaker。

这正是"不死图腾优先用手上的那个"：手部槽位索引小于背包，因此手上的先生效，
背包里的那个**保持不变**（没被消耗）。玩法包若想让背包权重更低，
调 `priority` 或给背包槽位更大的索引即可 —— **顺序是数据，不是内核规则。**

排序键里含容器与槽位索引，这是 2.3.1「一切容器都有索引」的直接受益：
若索引可缺省，这条裁决就无法确定，回放也不可复现。

**before veto 与 instead preventAll 的区分**：

| 机制 | 作用对象 | 返回值 | 效果 |
|------|----------|--------|------|
| `abort`（before 阶段） | 当前 Op | abort | **取消整个 Op**，包括 after 阶段，不写 journal |
| `preventAll`（instead 阶段） | default 行为 | preventAll | **阻止 default 执行**，但 after 仍执行 |

`Event.cancelled` 字段：`false`（默认）= 事件正常传播；`true` = 事件被取消。
`cancelled=true` 时，**after 仍然执行**（因为 Hook 收集和排序在 cancelled 设置之前完成），
但 after 可以检测 `event.cancelled` 来区分正常执行 vs 被取消的情况。

### 6.3 这一条管道等价于什么

| 表层机制 | 实现方式 |
|---|---|
| 护甲减伤 | `modify:damage`，`payload.amount -= 1` |
| 重甲 1 伤免疫 | `modify:damage`，`if amount==1 then 0` |
| 格挡 | `instead:damage` |
| 无敌 / 免疫 | `before:damage` → cancel |
| 荆棘反伤 | `after:damage` → 对 source 施伤 |
| 吸血 | `after:damage` → 治疗 source |
| 暴击 | `modify:roll` |
| 击杀回体力 | `after:death`，读 `cause` 找归属者 |
| 负重上限 | `before:item.move` → veto |
| 门被堵 | `before:entity.place` → veto |
| 精密交互被打断 | `after:damage` → 移除 attachment |
| 任务进度 | `after:death` → 计数 |
| 成就 | `after:*` → 计数 |
| 声音惊动 NPC | `after:*` → `spread` → 写 NPC 记忆 |

**伤害不是内核原语。** 它是玩法包 `emit('damage')` + 一条 `default` Hook 写 `props.hp`。
一个不用血量的格斗玩法可以完全重定义它。

### 6.4 RuleDef：Hook 的载体

`Def.rules`、`AttachmentDef.rules`、`PlaypackDef` 全都引用"规则"，
但前十轮只描述了 Hook 的行为，**没有给出它的结构** —— 与 `PolicyDef` 同类的引用悬空，
由 18.1 的核查发现。

```typescript
interface RuleDef extends Def {
  kind: 'rule'
  id: RuleId                      // ★ 必填：唯一标识符，用于重入锁判定和排序 tie-breaker
  on: string | string[]           // 监听的事件类型，支持 'damage' / 'item.move' / '*'
  phase: 'before' | 'modify' | 'instead' | 'default' | 'after'
  when?: Expr                    // 附加条件，不满足则本次不触发
  priority: number               // 同阶段内排序，缺省 0
  effects: Effect[]              // before 阶段可用 { abort } 表达 veto
  once?: boolean                 // 触发一次后自动移除
}
```

**id 字段的必要性**：
1. **重入锁键**：重入锁的键为 `(type, hookId)`，因此每个 Hook 必须有唯一 id
2. **排序 tie-breaker**：当 `(priority, containerIndex, slotIndex, defId)` 完全相同时，
   用 `id` 作为最终 tie-breaker
3. **可追溯性**：日志和调试时能精确定位是哪个 Hook

**向后兼容性**：对于已存在没有 `id` 的 RuleDef：
1. 加载期 Linter 检测到 `id` 缺失
2. 自动生成 id：取 DefId + phase + on 的组合哈希
3. 发出警告 `W_HOOK_MIGRATED_ID`
4. 迁移后 id 固定，不再改变

**Linter 规则**：
- 新建 RuleDef 必须提供 `id`，否则报错 `E_HOOK_MISSING_ID`
- 同一作用域内 `id` 必须唯一，否则报错 `E_HOOK_DUPLICATE_ID`

三点与前文的衔接：

- **挂载方式决定生效范围**：挂在 `PlaypackDef` 上 = 全局常驻；
  挂在 `AttachmentDef.rules` 上 = 该状态存续期间生效（第 8 章）；
  挂在 `attach.add(world, mod)` 的 attachment 上 = 运行期开关的规则组（1.3.1）。
  **同一个 RuleDef 结构，三种生命周期，无需三套概念。**
- **`on: '*'`** 服务成就、日志、调试（用例 79、84、154）。
- **确定性排序**由 `(priority, containerIndex, slotIndex, defId, id)` 五元组保证（6.2）。

### 6.5 连锁安全

**depth 限制（第十二轮定稿；错误码已按真实内核实现更名，见决策与风险记录.md）**：
- `depth` 超过上限（**固定 32，不可配置**）→ 抛 `E_HOOK_DEPTH`，tx 回滚
- depth 计数规则：
  1. 顶层 `emit` 从 depth=1 开始
  2. Hook effect 中的 `emit` 累加 depth
  3. emit 完成后（所有五阶段执行完毕）depth-1
  4. **不同顶层 emit 之间 depth 独立重置**
  5. **depth 不跨事务传递**（每个事务有独立的 depth 计数器）

**depth 与 reactionRounds 的分离（第十二轮定稿）**：

| 机制 | 作用范围 | 默认值 | 超限行为 | 配置方式 |
|------|----------|--------|----------|----------|
| **depth** | 单次 emit 调用栈深度 | 32 | 抛 E_HOOK_DEPTH，tx 回滚 | **固定，不可配置** |
| **reactionRounds** | response 相位的往复轮次 | 3 | 静默截断，不抛异常 | PhaseDef.reactionRounds |

两个上限管两件事：`depth` 管一次解算内的事件连锁，`reactionRounds` 管跨相位的响应往复。
`depth` 在事务提交边界会重置，因此它**管不住跨相位的事件连锁**，
而 `reactionRounds` 专门处理"我反制你、你反制我的反制"这类场景。

**重入锁（第十二轮定稿）**：
- **键**：`(type, hookId)`
- **phase 不参与重入锁判定**：同一个 RuleDef 的多个 phase 是同一逻辑单元的不同切面，
  如果不同 phase 算重入会导致逻辑碎片化
- **调用栈与事务回滚无关**：调用栈是运行时调用栈，属于内存中的瞬时状态，
  tx 回滚是状态机的回退。tx 回滚**不**清除调用栈

**emit 时的检查顺序（第十二轮定稿）**：
1. **depth 检查** → 超过上限抛 E_HOOK_DEPTH
2. **重入锁检查** → 检测到重复抛 E_HOOK_REENTRY
3. **Hook 收集与执行**

先检查 depth 可以更早发现潜在的无限循环。

**Hook 相关错误码**（与 `src/core/kernel/state/error-codes.ts` 的 `E_HOOK` 一致）：

| 错误码 | 触发条件 | tx 行为 |
|--------|----------|---------|
| E_HOOK_DEPTH | depth 超过上限（固定32） | 回滚 |
| E_HOOK_REENTRY | 检测到 (type, hookId) 重复 | 回滚 |
| E_HOOK_INSTEAD_CONFLICT | 多个 instead 阶段候选同时通过 when 条件（只允许一个） | 回滚 |

**以下装载期错误码已废弃，未实现，见决策与风险记录.md**：`E_HOOK_INVALID_PHASE`、`E_HOOK_DUPLICATE_ID`、`E_HOOK_MISSING_ID`、`E_HOOK_NOT_FOUND` —— 这四类 RuleDef 装载期校验语义已并入通用装载错误码（`E_LOAD_SCHEMA_CONTRACT` / `E_LOAD_DUPLICATE_ID` / `E_LOAD_REQUIRED_FIELD` / `E_LOAD_UNDEFINED_REF`），不再单独区分 Hook 场景。

```typescript
interface E_HOOK_REENTRY extends Error {
  code: 'E_HOOK_REENTRY'
  type: string      // 重复的事件类型
  hookId: string    // 重复的 hookId
  callStack: Array<{ type: string, hookId: string }>  // 当前调用栈快照
}
```

**确定性排序**：同优先级 Hook 按 `(priority, containerIndex, slotIndex, defId, id)` 五元组字典序执行 —— 确保回放可复现。

---

## 7. Actions：可发现的合法着法

### 7.1 为什么 Action 必须独立于 Effect

Effect 能改状态，但玩家/AI 需要知道**此刻我能做什么**。这份清单必须由数据生成，
否则每加一个交互就要改 UI 代码，也无法喂给 αβ 搜索。

```typescript
interface ActionDef {
  id: DefId
  label: Expr                    // 可含插值，供 UI 与本地化
  targets?: TargetSpec[]         // 多目标（对谁 / 用什么 / 去哪）
  require?: Expr                 // 不满足 → 不出现在菜单
  visible?: Expr                 // 满足 visible 但 require 不满足 → 灰显
  reason?: Expr                  // ★ 灰显时给玩家看的原因（可插值、可本地化）
  cost?: CostSpec[]              // ★ 泛化的代价，见 7.3
  group?: string                 // UI 分组（'paid' / 'free'）
  effects: Effect[]
  tags?: string[]
}

interface TargetSpec {
  name: string
  query?: Query                  // 候选集由查询生成（选一个对象）
  range?: { min: Expr, max: Expr, step?: Expr }  // ★ 数值选择（给多少钱、押多少注）
  count?: { min: Expr, max: Expr }               // ★ 多选（弃两张牌、选三个目标）
  optional?: boolean
}
```

`range` 与 `count` 是第五轮补的。原设计隐含"目标总是一个对象引用"，于是
「给他 37 块钱」「押 5 点筹码」「弃任意两张牌」「分配 3 点属性」全部无法表达，
只能给每个数值写一个 Action 或写代码。

对 `queryActions` 的影响必须明说：**数值域会让着法空间爆炸**（押注 1–100 = 100 个着法）。
因此 `range` 必须给出 `step`，且内核在 AI 搜索模式下只采样
`{min, max, 当前可承担的最大值, 以及 step 网格上的有限个点}`，
而 UI 模式下返回完整区间供滑条使用。**同一个 `queryActions`，两种展开粒度。**

多行动者协作动作（两人合力抬门、双人处决）不需要新结构：
`targets` 里包含另一个活体 + 一个 `decision`（7.5）征得其同意即可。

### 7.2 合法着法枚举

```
queryActions(actor) -> { action, bindings, cost, reason? }[]
```

这**一个函数**同时是：

- UI 的动作菜单
- AI 的 move generator
- 网络协议的合法性校验
- 模糊测试的动作空间采样器

四者用同一实现，因此永不会出现"UI 能点但服务器拒绝"这类不一致。

### 7.3 代价泛化

```typescript
type CostSpec =
  | { pool: string, amount: Expr }        // 扣 world/actor 上的某个数值池
  | { items: Expr }                        // 消耗物品（含堆叠数量）
  | { attach: DefId }                       // 附加一个状态作为代价
  | { custom: Effect[] }
```

**支付时点（第十一轮定稿）：提交时冻结，解算时结算，void 时全额退回并发诊断事件。**

`Intent`（7.6）把提交与解算分开后，这个时点必须写死，否则两种实现都会出错：

| 若"提交时扣除且不退" | 若"仅解算时扣除" |
|---|---|
| 技能被反制 → AP 白扣。而"让对手使不出 AP"应当是**失能属性**该做的事，不该是反制的副作用 | 同一点 AP 可提交五个动作（快速连点 / 并发），铁律形同虚设 |

**冻结（reserve）** 兼得两者：提交即扣减可用额度，因此无法超额提交；
但直到解算成功才真正结算。若解算前重检 `require` 失败（目标已死、物品被抢）→
`status:'void'` → **全额退回**。

理由是防御式编程：一次动作若最终被判定为非法，那么这次扣费本身就是一个错误，
错误必须被撤销。而**能否合法在提交时往往无法预知** —— 目标是否还活着取决于
更早解算的其他 Intent。让创作者去预判是不可能的，所以由内核兜住。

退回必须发出 `cost.refunded` 诊断事件（含 intentId、原因、退回明细）。
理由：静默退回会让"刷 AP"类 bug 无法被发现；有了事件，
玩法包可以挂 Hook 做风控，测试可以断言"退回次数为 0"。

同一规则适用于 `{items}`（物品在冻结期不可被他人转移）与 `{attach}`（void 时移除）。

内核**没有 AP**。AP 是玩法包声明的一个 pool：

```
defs.playpack.br.pools = [{ name:'ap', per:'actor', reset:'turn' },
                          { name:'stamina', per:'actor', reset:'never' }]
```

于是「1 AP 铁律」是 02 玩法包的一条 Linter 规则（所有 action 的 ap cost ∈ {0,1}），
而不是内核限制。格斗玩法可以给 3 AP，卡牌玩法可以用 `mana`。

### 7.4 动态选项（对话树 / 商店货架）

`targets[].query` 是查询，所以选项可以来自数据：

```
「买什么」→ query: { from:'items', in: shopContainer }
「说什么」→ query: { from:'defs', where: 该对话节点的 choices 且 require 通过 }
```

对话树 = 一棵放在 `props.dialogue` 里的数据 + 一个读它生成选项的 Action。
零新概念。侦探游戏的"出示证据"= 选项的 `require` 检查 `knows(player,'clue.footprint')`。

### 7.5 Decision：向非当前行动者征求输入

**这是首轮推演漏掉的一个真原语。** Action 模型隐含"当前行动者决策 → 立即解算完毕"，
但下列机制全都要求**在解算中途暂停，问另一个人**：

| 机制 | 谁被问 |
|---|---|
| 玩家间交易（双向确认） | 交易对象 |
| 反应技 / 打断 / 反制 | 被攻击方或第三方 |
| 「是否接受投降 / 复活」 | 胜方 |
| 战利品分配 | 队伍全体 |
| 「有人推门，你要不要顶住」 | 门另一侧的人 |
| 卡牌的响应窗口 | 对手 |

若无此原语，交易必须写"协议模块"、反应技必须写"响应栈模块" —— 正是要杜绝的形态。

内核**不用挂起协程实现**（会与事务、网络、AI 搜索全部冲突）。
决策是**一等状态对象**，放在 `world.decisions`：

> **铁律（第十一轮定稿）：`decision.open` 永不阻塞，且内核不提供任何"等待答复"的原语。**
>
> 这不是一条纪律，是一条**表达能力上的缺失** —— 因为没有 `await`、没有 `waitFor`、
> 没有任何读取"尚未给出的答复"的方式，所以「发起方停在原地等」这件事**根本无法被写出来**。
> 永久挂起因此不是被防住的，而是不可表达的。这正是 0.2「不可绕过」判据的反向应用：
> **危险的东西要让它连语法都没有。**
>
> 答复只有一条到达路径：`DecisionDef.onResolve`，它在**另一个事务**里执行。

```typescript
interface Decision {
  id: DecisionId
  def: DefId                     // DecisionDef，声明选项与超时行为
  askees: Ref[]                  // 被征询者（可多人）
  answers: Record<string, string | string[]> // actorId → choice 或 choices
  ctx: Record<string, Value>     // 发起时快照的上下文（谁、对什么、多少钱）
  opensAt: number                // phase 序号
  deadline?: number              // ★ 超时的绝对判定点：timeout.type='deadline'时直接取值；'ttl'时=opensAt对应的时间戳+value（open时算好写入，之后只需比较，不重算相对时长）
  status: 'open' | 'resolved' | 'timeout' | 'void'
  answeredAskees?: Ref[]         // 已答askees（用于快速判断quorum）
}

interface DecisionDef extends Def {
  kind: 'decision'
  options: DecisionOption[]      // 扩展为对象数组
  selection: {
    mode: 'single' | 'multi'      // ★ 单选/多选模式
    minCount?: number             // 多选时每actor最少选几个（默认1）
    maxCount?: number             // 多选时每actor最多选几个（默认1）
  }
  quorum: 'all' | 'any' | 'majority'      // 何时算"答满"（多askee维度，何时触发resolve判定）
  merge: {                        // ★ 多askee答案如何合并为最终结果
    policy: 'all' | 'any' | 'majority' | 'unanimous' | 'first'
  }
  timeout: {
    type: 'deadline' | 'ttl'      // ★ deadline=绝对phase序号，ttl=相对秒数（Infinity=永不超时）
    value: number
    onTimeout: 'default' | 'void' | 'extend'
  }
  defaultAnswer?: string | string[]  // ★ 超时默认答案，取代 defaultChoice
  onAskeeInvalid?: 'waive' | 'replace' | 'abort'  // askee失效时的降级策略，默认'waive'
  nestedDecision: 'allow' | 'deny'   // ★ 是否允许在onResolve中触发新决策，默认'deny'
  retractable?: boolean              // ★ 是否允许actor撤销已提交的答案
  condition?: Expr                   // ★ 创建前置：decision.open时对ctx求值，false则拒绝创建（不产生Decision实例）
  onResolve: Effect[]            // 后续解算写在这里，不在发起方
  onVoid?: Effect[]              // 前提失效或超时未设默认值时的回滚
}

interface DecisionOption {
  name: string                    // 唯一标识符（同一Def内不可重复）
  label: Expr                     // 显示名
  require?: Expr                  // 回答条件（运行时检查）
  uniquePerActor?: boolean        // 是否允许同一actor重复选（默认true）
}
```

**补充设计（2026-08-06，30条用例驱动的重新设计）**：

旧设计只覆盖了「多askee各投一票，quorum决定何时算完」这一种形态；
30条测试用例揭示的是另一种正交形态——「单actor选多个，min/maxCount约束」。
两者都是合法需求，本次修订让 Decision **同时支持**两种形态，而非二选一。

| 字段 | 语义 |
|------|------|
| `selection.mode` | `'single'`：每actor选1个；`'multi'`：每actor选多个，受min/maxCount约束 |
| `quorum` | 多askee维度：`'all'`=全员已答才判定，`'any'`=任一人已答就判定，`'majority'`=`ceil(有效askees.length/2)`人已答就判定（严格超过半数） |
| `merge.policy` | 已判定后，多个askee的答案如何合并成最终结果：`'all'`=全部答案都生效、`'any'`=任一答案生效、`'majority'`=票数最多的答案生效、`'unanimous'`=要求所有答案完全一致才生效（否则void）、`'first'`=第一个提交的答案生效，其余被忽略 |
| `timeout.type` | `'deadline'`=绝对phase序号（原设计）；`'ttl'`=相对秒数，从`decision.open`调用起算 |
| `timeout.value` | 配 `'ttl'` 时可为 `Infinity` 表示永不超时（替代旧的 `null`，语义更明确、可参与数值比较） |
| `timeout.onTimeout` | 到期后的处理：`'default'`=应用`defaultAnswer`并按当前`answers`+默认值走一次`resolve`判定（缺`defaultAnswer`时装载期报`E_LOAD_DEFAULT_REQUIRED`）；`'void'`=不应用默认值，直接转`'timeout'`态并执行`onVoid`；`'extend'`=不结束，把`deadline`顺延一个`timeout.value`周期（`type='ttl'`时即再等一轮ttl），重新等待，可无限续期直到玩法层用其他机制（如次数上限）打断 |
| `defaultAnswer` | 取代 `defaultChoice`；`selection.mode='single'`时为`string`，`'multi'`时为`string[]`；必须是`options`的合法子集，否则`decision.open`时报`E_DEC_INVALID_ANSWER` |
| `nestedDecision` | 默认`'deny'`：`onResolve`/`onVoid`内的effect若调用`decision.open`，报`E_DEC_NESTED`，整个tx回滚。设为`'allow'`时放行——由玩法包自行承担死锁风险 |
| `retractable` | 是否允许`decision.retract`撤销已提交答案；未设置时默认`false` |
| `onAskeeInvalid` | askee在待答期间失效（其引用的Entity/Agent被销毁、或不再满足`options[].require`）时的降级策略：`'waive'`（默认）=把该askee移出askees并按剩余有效askees重算quorum；`'replace'`=尝试用同`ctx`下另一有效actor顶替（无候选则退化为`'waive'`）；`'abort'`=整个Decision转`void`并执行`onVoid` |

**`decision.retract` 语义**（对应原L6-DEC-009/010撤销与修改）：

| 前置/行为 | 说明 |
|---------|------|
| `retractable != true` | 拒绝，报 `E_DEC_NOT_RETRACTABLE` |
| `decision.status != 'open'` | 已resolved/timeout/void不可撤销，报 `E_DEC_NOT_OPEN` |
| actor未提交过答案 | 无操作（幂等），不报错 |
| 撤销生效 | 清除`answers[actor]`与`answeredAskees`中的该项；若此前已因quorum满足而处于待resolve，则重算quorum、必要时回退判定 |
| 修改答案 | = `retract` 后重新 `answer`；或直接用 `answer(..., replace:true)` 一步替换（见下） |

**创建期（`decision.open`）强制校验**（全部在创建时检查，失败即拒绝创建，不产生Decision实例）：

| 违反条件 | 错误码 |
|---------|--------|
| `options` 为空 | `E_DEC_EMPTY_OPTIONS` |
| `options[].name` 有重复 | `E_DEC_DUPLICATE_OPTIONS` |
| `selection.minCount > selection.maxCount` | `E_DEC_CONFLICT_CONSTRAINT` |
| `selection.maxCount > options.length` | `E_DEC_MAX_EXCEEDS_OPTIONS` |
| `defaultAnswer` 不是 `options` 的合法子集 | `E_DEC_INVALID_ANSWER` |
| `condition` 对 `ctx` 求值为 `false` | `E_DEC_CONDITION_UNMET` |

`timeout.onTimeout='default'` 但未设 `defaultAnswer`：这是 `DecisionDef` 的静态形状错误，在**装载期**（Def 注册/lint 阶段）就报 `E_LOAD_DEFAULT_REQUIRED` 并拒绝装载，不会等到某次 `decision.open` 才发现。

**答题期（`decision.answer`）校验**（按检查顺序）：

| 违反条件 | 错误码 |
|---------|--------|
| `decision.status != 'open'` | `E_DEC_NOT_OPEN` |
| 引用已被 `destroy` 的 Decision | `E_REF_DESTROYED` |
| `choice` 不在 `options` 中 | `E_DEC_INVALID_ANSWER` |
| 该actor已答过且调用未带 `replace:true` | `E_DEC_ALREADY_ANSWERED` |
| 选择了该actor本次答案中已存在的选项（去重） | `E_DEC_DUPLICATE_CHOICE` |
| 生效后 `answers[actor].length < selection.minCount`（仅在判定resolve时检查，允许过程中途未答满） | `E_DEC_COUNT_BELOW_MIN` |
| 生效后 `answers[actor].length > selection.maxCount` | `E_DEC_COUNT_EXCEEDS_MAX` |

`decision.answer` 新增 `replace?: boolean` 参数：`false`（默认）为追加模式（多选时合并进已有答案数组，单选时若已答则报错）；`true`为整体替换该actor的答案。

**撤销期（`decision.retract`）校验**：`retractable != true` → `E_DEC_NOT_RETRACTABLE`；`decision.status != 'open'` → `E_DEC_NOT_OPEN`；不带`choice`参数时撤销该actor全部答案，带`choice`时仅移除该项（不在已有答案中则视为无操作，不报错）。

**同一事务内的决策依赖（原L6-DEC-023的UNDEF项）**：允许一个决策的`onResolve`结果被同tx内后续`decision.open`的`condition`读取，但要求**显式排序**——依赖方必须写在被依赖方`decision.resolve`执行之后。内核不做隐式依赖分析/自动重排，写反顺序则读到的是决策前的旧状态，这是创作者的责任而非内核报错项。

三条关键规则，缺一不可：

1. **发起 Action 在 `decision.open` 后立即结束并提交事务。**
   不存在跨事务挂起，因此存档/回放/AI 搜索都能在决策待答状态下正常工作。
2. **`onResolve` 执行前必须重跑前提检查。** 上下文是快照，世界可能已变
   （要买的枪被别人拿走了、交易对象死了）→ 走 `onVoid`。
   这条把"TOCTOU 竞态"从玩法包 bug 降级为内核强制的必经检查。
3. **待答决策进入 `queryActions`。** 被征询者会看到"回应交易请求"这个 Action，
   AI 的 move generator 也会看到它 —— 所以 AI 无需特殊代码就会应答交易与反应技。

于是**交易 = 组合**，不是原语：
一个 `decision`（quorum:'all'，双方各自确认）+ `onResolve` 里两次 `item.move` 装在一个事务里。
「一手交钱一手交货的原子性」由事务保证，「双方同意」由 quorum 保证。

### 7.5.1 反应技为什么不能在 Hook 里问（P0 的解法）

前一版写过「反应窗口 = 在 `before:damage` 的 Hook 里 `decision.open`」。**这是错的，已废弃。**

矛盾在于：`before:damage` 执行时，damage 这个 Op 正处在一个未提交的事务中途。
此时"立即提交并结束"做不到（事务没完），"等答复"又是上面铁律禁止的。
两条路都堵死 —— 说明**问错了地方**，不是原语不够。

**正确形态：响应相位。** 反应技需要的是**时序**，不是中途等待。
第七轮的 `Intent`（提交 ≠ 解算）已经把时间轴劈开了，只要在中间插一个相位：

```
提交相位   出手方提交 Intent（hidden）
响应相位   ★ 有反应资格者提交"反应 Intent"，此时原 Intent 尚未解算
解算相位   按 resolveOrder 排序，逐个重检 require 后执行
```

反制 = 一个 `instead` 或 `before` 规则，它的触发条件是"存在一个针对我的、
且已被反应 Intent 指定的 pending Intent"。**信息在解算前已经齐全，没有任何东西需要等。**

连续反制（用例 89）= 响应相位可声明为可重入 N 轮，N 由 `ScheduleDef` 写死为有限值。

```typescript
// ScheduleDef.phases 里的一个普通相位，无新概念
{ name:'response', actors: <有反应资格者的 Query>, input:'all',
  reactionRounds: 3 }        // ★ 有限轮次，Linter 强制为常量
```

**这个改法的收益不止是修 bug**：

| 原方案（Hook 里问） | 新方案（响应相位） |
|---|---|
| 与事务冲突，无解 | 每个相位一个事务，天然自洽 |
| 反应链深度靠 `depth` 兜底，而 `depth` 在提交边界会重置 | 轮次是相位表里的常量，**静态可数** |
| AI 搜索遇到待答决策要特殊处理 | 响应相位就是普通着法节点，αβ 直接搜 |
| "谁能反应"藏在 Hook 条件里 | `actors` 是一个 Query，可被 UI 与 AI 直接读 |

**至于交易、投降、投票、推门对抗**：它们从来不需要中途等待。
我出价是我回合内的动作 → 报价成为持久状态 → 你接受是你回合内的动作。
这与「一回合一步、不能在回合外行动」完全一致 —— 原设计把它们和反应技混为一类，是分类错误。

---

### 7.6 Intent：已提交但未解算的动作

第七轮发现的新结构。原设计隐含"提交动作 = 立即解算"，于是下列机制无法表达：

| 机制 | 为什么需要"提交 ≠ 解算" |
|---|---|
| 格斗对拼（双方同时出招） | 两个动作必须先都提交，再按速度解算 |
| 猜拳 / 明牌前的暗押 | 提交后不可改，揭示前不可见 |
| 指令排队（预设本回合三步） | 动作要能排在队列里等 |
| 网络锁步同步 | 收齐所有人的提交才能推进 |
| 「后发先至」（速度决定顺序） | 解算序由数据决定，不是提交序 |

```typescript
interface Intent {
  id: IntentId
  agent: AgentId
  action: DefId
  bindings: Record<string, Value>   // 已选定的目标/数值
  submittedAt: number               // phase 序号
  priority?: number                 // 由 ScheduleDef.resolveOrder 求值填入
  hidden: boolean                   // ★ 揭示前对其他 Agent 不可见
  status: 'pending' | 'resolved' | 'failed' | 'void'
}
```

`ScheduleDef` 相应补两个字段（定义见 9.1 的完整 interface）：
`resolveOrder`（对 Intent 求值决定解算序）与 `onConflict`（争抢消解规则）。

**每个 Intent 各自一个事务**，依序解算。因此 A 的解算可以让 B 的 `require` 失败
→ B 走 `void` 并退回代价（7.3）。这与 9.0「不存在同时结算」是同一条原则的两面。

**三条规则与 Decision（7.5）刻意保持同构**，因为它们是同一个问题的两面
（Decision 是"还没决定"，Intent 是"决定了还没生效"）：

1. 解算前**必须重跑 `require`** —— 我出招时你已经死了、我要拿的物品已被别人拿走
   → `status:'void'`，走 `onConflict`。**TOCTOU 由内核强制检查，不由创作者记得检查。**
2. `hidden` 的 Intent 不进入其他 Agent 的 `queryActions` 视野，也不进入其 knowledge。
   暗押、暗牌、同时出招的"未揭示"状态由此成立，**不需要单独的隐藏信息协议**。
3. Intent 是状态而非调用栈，因此**待解算时可存档、可回放、可被 AI 搜索**
   —— 与 Decision 完全相同的理由。

于是 `order:'simultaneous'` 有了确切语义：
提交相位收集 Intent（`hidden:true`）→ 解算相位揭示、按 `resolveOrder` 排序、
逐个重检 `require` 后执行。**格斗、卡牌、猜拳、RTS 指令队列共用这一条流程。**

**Intent cost 约束澄清（UNDEF 澄清，2026-08-07）**：

| 场景 | 内核行为 |
|---|---|
| `amount` 求值为 0 的 `pool` 代价 | **允许**，属于"免费动作仍走冻结/退回循环"的合法状态；对 pool 当前余额无影响 |
| 同一 Intent 内出现重复 `pool` 名称 | 按同一 pool **求和合并**——两条 `{ pool:'ap', amount:1 }` 等价于一条 `{ pool:'ap', amount:2 }`；重复是合法写法，不报错 |
| 同一 Intent 内出现重复 `id` 字段 | **拒绝**，返回 `E_OP_INVALID_ARGS`——`id` 在 Intent 生命周期内必须唯一，重复提交视为客户端错误 |
| `amount` 求值为负数 | **拒绝**，返回 `E_OP_INVALID_ARGS`——代价是扣除，不是奖励；负数代价会逆向增加 pool 余额，违反"代价守恒"不变量 |

以上四条均为实现层主动加固行为（L10 测试属性测试验证）；Spec 原文未明确，此处补录。

---

## 8. Attachments：状态、Buff、光环、装备效果的统一体

```typescript
interface AttachmentDef extends Def {
  kind: 'attachment'
  duration?: Expr                 // 缺省永久
  delay?: Expr                    // ★ 延时生效
  stack: 'unique' | 'refresh' | 'count' | 'independent'
  maxStack?: number
  aura?: { query: Query, grant: DefId }   // ★ 光环：向查询命中者授予另一个 attachment
  rules?: DefId[]                 // 生效期间挂载的 Hook
  props?: Record<string, Value>
  onAdd?: Effect[]
  onExpire?: Effect[]
  onRemove?: Effect[]
}
```

一个结构覆盖：中毒、燃烧、眩晕、倒地、睡眠、精密交互中、装备加成、队长光环、
诅咒、饥饿、护盾层数、连击计数、蓄力状态。

`aura` 是关键泛化：光环不是"每回合遍历"，是"attachment 声明一个 query 并授予子 attachment"。
这让"附近友军 +1 伤害"零代码可写。

### 8.1 光环的失效与重算（第十一轮定稿）

**化动为静**：光环本身不做逐回合遍历，它是一条**条件**，
内核只在这条条件的**依赖集发生变化时**重写一次授予关系。

先分清两种"失效"，它们完全不同：

| 失效对象 | 处理 |
|---|---|
| **光环本体失效**（施加者死亡、buff 到期） | 与任何 attachment 移除**无区别**：`attach.del` → 由 `grantedBy` 反查并回收全部子 attachment |
| **光环对某个对象的影响失效**（那人走开了） | 重算 query 命中集，差集进/出 → 授予或回收该对象的子 attachment |

重算的触发条件必须**显式声明**，不能靠内核猜：

```typescript
aura?: {
  query: Query
  grant: DefId
  deps?: string[]          // ★ 除拓扑外，还依赖哪些 props 路径
}
```

- **缺省只依赖拓扑**：实体进出节点、`entity.place`、`node.merge` → 重算。
  这覆盖绝大多数光环（"周身一格的友军"），代价 O(命中集)，与站桩固定效果同构。
- **`deps` 显式列出属性依赖**：若 query 里写了「血量低于 3 的友军」，
  则必须声明 `deps: ['props.hp']`，内核才会在该属性变动时重算。
  **未声明即不重算** —— 这是有意的：让依赖集有界且可静态分析，
  否则任何 `prop.set` 都要试探全部光环，性能与可预测性同时崩掉。
  Linter 会检查 query 里引用的 props 路径是否都在 `deps` 里，漏写会在**加载期**报警。

地图上的固定效果（安全区、火场）走完全相同的路径 —— 它就是一个 `owner` 为 Node
的光环，只是 query 是"本节点内的活体"。**固定与移动不是两种机制。**

`delay` 让延时 Buff（3 回合后狂暴）不需要额外调度概念。

### 8.4.1 光环失效与计时器清理

**当光环的 owner 被销毁时**：
- 所有 `grantedBy` 指向该光环的 Attachment 被回收（见 §4.6 附属一致不变量）
- 该光环创建的所有 `pendingEffects` 中，`source` 字段指向 owner 的，自动作废
- 若 query 依赖的 `deps` 路径失效（如 owner 被销毁），光环停止重算

**与 §5.1 pending 事件的协同**：
- 光环的 `delay` 字段创建的延时效果，其 `source` 自动设为光环的 `owner`
- 当 owner 实体被销毁，这些延时效果在触发前通过 TOCTOU 重检自动作废
- 例：`e:12` 携带"3 回合后爆炸"光环，若 `e:12` 在 2 回合时被销毁，爆炸 pending effect 作废

**计时器与状态失效的边界**：
- 延时效果的失效检查在 **触发时** 执行（TOCTOU 模式），不在每个 phase 预检
- 若要提前清理已确定失效的 pending effects，由 `phase.onExit` 中的清理规则负责
- pending 队列的遍历复杂度为 O(触发的 pending 数量)，不是 O(全部 pending 数量)

---

## 9. Schedule：回合表是数据

```typescript
interface ScheduleDef {
  phases: PhaseDef[]
  order: 'fixed' | 'initiative'   // ★ 没有 'simultaneous'，见 9.0
  initiativeExpr?: Expr
  resolveOrder?: Expr             // 对 Intent 求值，决定解算序（7.6）
  onConflict?: Effect[]
  roundEnd?: Effect[]
}

interface PhaseDef {
  name: string                    // 'roll' | 'submit' | 'response' | 'resolve' | 'cleanup'
  actors?: Query                  // 谁在这个相位行动
  onEnter?: Effect[]
  onExit?: Effect[]
  input: 'none' | 'actor' | 'all' // 是否等待决策
  kind?: 'normal' | 'submit' | 'resolve' | 'response'  // ★ 与 Intent 的关系
  reactionRounds?: number         // ★ kind:'response' 时的最大往复轮次，必须是常量
  timeLimit?: Expr                // 实时限时（可选）
}
```

### 9.0 不存在"同时结算"

原稿给 `order` 留了一个 `'simultaneous'` 值，**这是一个伪概念，已删除**。

回合制的基本时序原则是：**任何两个动作都有确定的先后。**
所谓"同时出招"，真实结构是「**同时提交、依序解算**」——
而这正是 `Intent`（7.6）已经表达的东西，不需要 Schedule 再开一个模式：

```
提交相位  双方各提交一个 hidden Intent（谁先点击不影响结果）
解算相位  按 resolveOrder（速度/先手/随机）排序，逐个解算
```

后果是明确且正确的：先解算者若一击致命，后解算者的 Intent 在重检 `require` 时
`status:'void'` —— **不会出现"双方互相击杀"这种时序上说不通的结果**，
除非玩法包自己用 `onConflict` 显式写出互殴规则。

猜拳同理：两个 hidden Intent 都揭示后，胜负由 `onConflict` 或一条规则比较得出，
执行仍是依序的。**"同时"是玩家的体验，不是内核的时序。**

- 大逃杀：`roll → resolve → player → npc → cleanup`
- 格斗：`submit → response → resolve`（`resolveOrder` 读速度属性）
- 卡牌：`draw → main → response → discard`
- 实时感：把 phase 当帧，`timeLimit` 很短

**内核不知道"回合"意味着什么**，它只按表推进并在每个边界发事件。
`after`/`at` 延迟效果与 attachment 的 duration 都以 phase 边界为时间单位。

推进规则：`phase.input` 要求的决策未齐、或存在 `deadline` 未到的 open Decision 时，
相位不推进；`timeLimit` 到点则按 `DecisionDef.timeout.onTimeout` 处理后推进（`Decision.deadline`统一为绝对判定点，`timeout.type='ttl'`时也已在`open`时折算好，推进规则无需区分两种type）。**不存在无限等待。**

### 9.1 PlaypackDef：玩法包的顶层声明

玩法包本身是一个 Def（`kind:'playpack'`），它是内核唯一需要被"启动"的入口。
`evaluate`、`pools`、`outcomes` 都住在这里 —— 它们是**数据字段**，不是内核概念：

```typescript
interface PlaypackDef extends Def {
  kind: 'playpack'
  schedule: DefId
  pools: PoolDef[]               // ★ AP / 体力 / 法力都在这里声明，见 7.3
  factions?: string[]
  visibility?: DefId             // ★ 谁能看见谁的谓词（expr Def），见第 11 章
  logRetention?: { phases?: number, max?: number }   // ★ 有界历史，见 3.2.1
  outcomes?: OutcomeDef[]        // ★ 结局判定（可多条、可分阵营、可排名）
  evaluate?: Expr                // ★ 局面估值，供 AI 搜索骨架使用（第 12 章）
  policies?: DefId[]             // NPC 决策策略集
  linter?: LintRule[]            // ★ 玩法包自定的静态约束
  quota?: { entities?: number, attachments?: number, rules?: number }
  entry: Effect[]                // 开局布置：生成地图、发牌、放 NPC
  version: string                // ★ 语义化版本，写入快照
  migrations?: MigrationDef[]    // ★ 老存档 → 新玩法包，见 12.1
  requires?: DefId[]             // ★ 依赖的其他玩法包（MOD 叠加）
  conflicts?: DefId[]            // ★ 声明互斥
  overrides?: Record<DefId, DefId>  // ★ 用本包的 Def 替换基包的某个 Def
}

interface PoolDef {
  name: string                   // 'ap' | 'stamina' | 'mana'
  per: 'world' | 'actor' | 'faction'
  max?: Expr
  reset: 'never' | 'turn' | 'phase' | Expr
}

interface LintRule { target: 'action'|'def'|'rule', assert: Expr, message: string }

interface OutcomeDef {           // ★ 第八轮泛化：胜负不是一个布尔
  name: string                   // 'victory' | 'eliminated' | 'escaped' | 'draw'
  when: Expr                     // 触发条件
  scope: 'game' | 'agent' | 'faction'   // 谁结束了（单人淘汰 ≠ 全局结束）
  rank?: Expr                    // 排名/积分，非布尔胜负
  onReach?: Effect[]             // 结算：发奖、写战绩、转观战
  ends: boolean                  // 是否终止整局
}
```

`outcomes` 取代原先单个 `winCondition`。理由：单条布尔无法表达
「被淘汰但游戏继续」（大逃杀第 7 名）、「各阵营各自的胜利条件」（狼人杀）、
「按分数排名而非胜负」（竞速、积分赛）、「多结局」（侦探游戏抓对/抓错/放跑）。

`scope:'agent'` + `ends:false` 就是"我死了但比赛继续，我转观战"——
配合 `Agent`（1.3.1.1）的 `kind:'observer'`，淘汰转观战零代码。

`evaluate` 有了确定的归属，`74 号用例（αβ 搜索）`才真正成立：
内核提供 `checkpoint/restore + queryActions + 搜索骨架`，玩法包提供 `evaluate`。
**换玩法只换这一个 Expr，不换一行 AI 代码。**

「1 AP 铁律」的落地形态就是一条 `linter`：
`{ target:'action', assert: cost.ap ∈ {0,1}, message:'违反 1 AP 铁律' }`。
内核不知道这条铁律，但它保证这条铁律可以被声明并在加载期强制。

### 9.2 玩法包的组合（MOD 叠加）

第七轮补的三个字段（`requires` / `conflicts` / `overrides`）解决一个必然出现的问题：
二创社群会做"基础大逃杀 + 僵尸模式 + 双倍掉落"这种叠加。

装载算法（加载期，全部可静态校验）：

```
1  拓扑排序 requires，检测循环依赖 → 拒绝装载
2  检测 conflicts 交集 → 拒绝装载并指名冲突方
3  按序合并 Def 集合，后装载者的 overrides 生效
4  Hook 按 (priority, 包序, defId) 排序 —— 包序参与排序，因此叠加顺序可控且确定
5  跑全部包的 linter，任一失败 → 拒绝装载
```

**单调重定义（2026-08-13 项目所有者裁决，覆盖此节合并语义）**：玩法包装载收敛为**无名重装载模型**（D-073），核心是「JSON 重新定义即替换或新增，最终声明即最终版」：

1. **玩法包无名**，不引入 namespace / 来源归属维度。装载后状态固定即为新版本；不存在「拔出玩法包」——只有回滚到未装载某包之前的状态（剔除=从列表移除该包 + 整体重装载一次）。
2. **顺序即优先级，后装覆盖先装**。后装载的包同 key 定义覆盖先装载的；同 key 即替换或新增。
3. **剩 ID 即退役**（不设 DELETE 声明）：某 def 用 replace 出新版、下方引用留空 → 只剩其 ID，不可再被引用（逻辑删除），不伤及老数据、只使引用失效。
4. **跨作用域冲突一律拒绝**，不设「确认放行」。
5. **唯一写入通道 + 原子验证不可绕过**：重定义只发生在装载事务的原子 swap 之前；运行期不得直接改写已生效注册表。运行期的规则变动仍走 `attach.add(world, mod)`（见 1.3.1），两者分工明确——**装载期组合 Def 集合（后装覆盖先装），运行期开关生效范围**。

该裁决替代 §9.2 原先「`overrides` 表显式声明才能替换」的声明型冲突解决模型：`overrides` 表降为可选的重定义辅助，同 key 后装覆盖不再要求显式声明。

---

### 9.3 PolicyDef：NPC 决策策略

第十轮补的一个**真实空洞**：`PlaypackDef.policies`、`Agent.policy` 以及用例
65/66/71/117/158 全都引用"AI policy"，但前九轮**从未定义它的结构**。

关键设计约束：policy 必须是数据，且必须复用 `queryActions` ——
否则 NPC 行为逻辑就是第一处"必须写代码"的地方，圈层契约（0.3）立刻破产。

```typescript
interface PolicyDef extends Def {
  kind: 'policy'
  mode: 'rules' | 'search' | 'scripted'
  // mode:'rules' —— 优先级规则表（守卫、僵尸、宠物）
  rules?: { when: Expr, prefer: Query | DefId, weight?: Expr }[]
  // mode:'search' —— 复用第 12 章的搜索骨架
  search?: { depth: Expr, evaluate: DefId, budget: Expr }
  // mode:'scripted' —— 剧本编排（Boss 阶段、教学关）
  script?: Effect[]
  fallback?: DefId               // 无合法着法或超预算时的退路
}
```

三种 mode 覆盖 RPG 里 NPC 的全部形态，且都不引入新概念：

| mode | 怎么工作 | 用例 |
|---|---|---|
| `rules` | 对 `queryActions` 的结果按 `when`/`weight` 打分取最优 | 僵尸扑向最近活体、守卫巡逻、宠物跟随 |
| `search` | `checkpoint → 试探 → restore` + `evaluate`（第 12 章） | 格斗 AI、卡牌 AI、棋类 |
| `scripted` | 直接给 Effect 序列，忽略着法枚举 | Boss 分阶段、教学关、剧本 NPC |

**`budget` 是"不挂死"承诺的一部分**：搜索型 policy 必须给出预算（节点数或时间），
超支即返回当前最优着法；若连一个合法着法都没算出来，走 `fallback`。
因此**AI 再复杂也不可能卡死回合推进** —— 与 Flow 的 step 预算同一条原则。

`rules` 模式的评分对象是 `queryActions` 的输出，这意味着
**创作者新增一个 Action，所有 NPC 自动会用它**（只要 `when` 匹配），
不需要同步修改任何 AI 逻辑。这是 7.2"一个函数四处复用"的第五处复用。

---

## 10. Random：确定性随机

```typescript
interface RngStream { name: string, seed: number, counter: number }
```

- 所有随机都必须走命名流：`roll('combat', '2d6')`、`pick('loot', table)`、`shuffle('deck', container)`
- 流状态是 state 的一部分 → 快照/回放/回溯完全可复现
- AI 试探（第 12 章）用**影子流**，不污染主流

掉落表 = `pick` + 权重表数据。洗牌 = `shuffle` 一个 `ordered` 容器。强力骰 = 投前
用 `prop.add` 扣 pool 并把修正写进 `modify:roll` 的 payload。

---

## 11. Knowledge：信息不对称

```
knowledge[scopeId] = { facts: {...}, seen: {...} }
```

`scopeId` 是 `Agent.knowledgeScope`（1.3.1.1），不是 Entity —— 因此队伍共享视野
只是多个 Agent 指向同一个 scope，无需复制事实。

**`facts` 的值是任意 Value，不是布尔。** 这一条是第七轮的修正，理由是
「知道 / 不知道」二值无法表达 RPG 里极常见的三类东西：

```
facts['killer'] = { $:'e:7' }                  // 认为凶手是 e7（可能是错的）
facts['gunLocation'] = { node:{$:'n:3'}, at: 12 }  // 12 相位时见过，可能已过时
facts['playerHp'] = 3                          // 记得的数值，非当前真值
```

| 需求 | 表达 |
|---|---|
| **错误信息 / 误导** | 写入与世界真值不符的 Value（伪造线索、假情报、变装） |
| **过时记忆** | Value 里带 `at` 相位戳，读时与当前相位比较 |
| **记忆衰减** | phase 边界 Hook 按 `at` 距离删除或模糊化 |
| **推理型玩法** | 侦探的"当前怀疑对象"就是一个 fact，可被证据推翻 |

`knows(scope, key)` 返回该 Value（不存在则 `null`），因此
「他以为凶手是我」`== knows(npc,'killer')` 与真值比较即可。
**内核不校验 fact 是否为真** —— 这正是误导玩法成立的前提。

- 写入靠普通 Op：`prop.set('knowledge.p1.facts.clue.footprint', true)`
- 谁能看见谁，由玩法包提供一个 `visibility` 谓词，内核只负责在查询时套用

覆盖：迷雾、侦探线索、NPC 最后见到玩家的位置、队伍共享视野、观战全知、
AI 难度（低难度 AI 只查 `visibleTo` 自己的信息，高难度 AI 允许作弊）。

**AI 与玩家用同一个 Query 接口，只是 `visibleTo` 参数不同。** 这消灭了一整类作弊 bug。

---

## 12. Persistence：快照、日志、回放、回溯

```
snapshot() -> State                 // 结构共享的不可变快照
journal: Op[]                       // 每个 Op 及其逆操作
replay(seed, ops) -> State
rewind(n)                           // 回退 n 个 phase 边界
checkpoint(label) / restore(label)
```

同一套机制服务四件事：

| 用途 | 机制 |
|---|---|
| 存档 | snapshot 序列化 |
| 回放/观战 | seed + journal 重放 |
| 时间回溯玩法 | rewind 到 checkpoint |
| **AI 搜索** | checkpoint → 试探 → restore（αβ 剪枝的 make/unmake move） |

**AI 搜索能力是持久化的副产品，不是 AI 模块的私有实现。** 这是引擎层面
最大的一次复用 —— 也解释了为什么"估值函数归底层"是对的：
`PlaypackDef.evaluate`（9.1 定义）是玩法包提供的一个 Expr，内核负责 make/unmake 与搜索骨架。

搜索期间的三条隔离要求：

| 要求 | 手段 |
|---|---|
| 不污染随机 | 影子流（第 10 章），试探用的 roll 不推进主流 counter |
| 不泄漏信息 | 搜索时的 Query 强制带上该 AI 的 `visibleTo`（第 11 章） |
| 不发表现事件 | 试探模式下 `after` 阶段的表现层订阅被静默 |

第三条是容易漏的：若不静默，AI 想一步就会在屏幕上放一次爆炸特效。

### 12.0.1 Snapshot 包含 pending 事件

快照必须包含所有 pending 状态：

```typescript
interface WorldSnapshot {
  // ... 原有字段
  pendingEffects: PendingEffect[]   // 所有 pending effect（§5.1）
  pendingDecisions: Decision[]      // 所有 open Decision
  pendingIntents: Intent[]          // 所有 pending Intent
}
```

**回放一致性**：
- replay 时，pending 事件按 `triggerAt` 顺序重新调度，保证确定性
- checkpoint/restore 必须同时保存和恢复 `pendingEffects` 队列
- AI 搜索的 restore 操作会清空搜索期间创建的 pending effects，只保留 checkpoint 时的状态

### 12.1 版本迁移：老存档遇上新玩法包

第十轮补的一项。一旦玩法包可被 UGC 作者迭代（06 文档的前提），
「玩家的存档是 v1.0，现在装的是 v1.1」就是必然发生的事。
若内核不管，每个作者都要写迁移代码 —— 又一处"必须写代码"。

```typescript
interface MigrationDef {
  from: string                   // 版本区间，如 '>=1.0 <1.1'
  to: string
  effects: Effect[]              // 用普通 Op 改写存档状态
  onFail: 'reject' | 'bestEffort'
}
```

快照里写入 `playpackId + version`，装载时比对：

```
版本相同        → 直接恢复
存档旧、有迁移链 → 按序执行 effects（在事务里，失败整体回滚）
存档旧、无迁移链 → 按 onFail 处理，缺省 reject 并给出明确诊断
存档新于玩法包   → 一律 reject（不做向后兼容，避免无解的猜测）
```

迁移用的是**普通 Effect + 普通 Op**，没有第二套 API。
「新版给每个角色加一个 `props.stamina`」= 一条 `forEach + prop.set`。
「删掉的武器换成替代品」= `forEach + entity.setDef`。

**边界（明说）**：迁移只在**装载时**发生，不支持对局进行中热更换玩法包。
运行期改规则走 `attach.add(world, mod)`（1.3.1），那是开关已声明规则的生效范围，
与"引入新 Def"是两件事。允许后者会让静态可分析性（Linter、AI 分析、
`overrides` 冲突检测）全部失效，代价远大于收益。

### 12.X Journal 权限模型与安全边界

Journal 是内核的**私有持久化机制**，不直接暴露给玩法包。三种访问角色的权限边界：

| 角色 | 可访问接口 | 禁止访问 | 理由 |
|------|----------|---------|------|
| **玩法包** | `Query.from:'log'`（有界 Event 窗口） | 完整 Journal、逆 Op、checkpoint 内部状态 | 防止"时间倒流"作弊与因果破坏 |
| **表现层** | Event 订阅（`after:*` Hook） | Journal、Op 细节 | 表现层只需知道"发生了什么"，不需知道"如何撤销" |
| **调试器** | 完整 Journal 读取、单步 Op 执行、checkpoint 检视 | 无限制 | 开发工具特权 |

#### 12.X.1 玩法包的受限访问

玩法包通过以下**唯一合法途径**访问历史：

```typescript
// 合法：查询有界 Event 窗口（§3.2.1）
{ from: 'log', where: type=='damage', limit: 100 }

// 禁止：直接读 Journal（接口不存在）
// world.journal  ❌ 编译期报错
// kernel.getJournal()  ❌ 玩法包 API 中不存在此函数
```

**`world.log` 的填充规则**：
- 仅包含**已提交事务**中发出的 Event
- **不包含** AI 搜索期间的试探性 Event（试探模式下 Event 不进 log）
- **不包含** checkpoint/restore 本身的操作记录
- 按 `logRetention` 声明自动截断，超出窗口的历史**对玩法包不可见**

#### 12.X.2 AI 搜索的隔离保证

AI 搜索（§12 第四用途）使用以下隔离机制：

| 隔离项 | 机制 | 效果 |
|-------|------|------|
| **随机隔离** | 影子流（§10） | 试探用的 roll 不污染主世界随机序列 |
| **信息隔离** | 试探模式下 Event 不进 `world.log` | 玩法包看不到"AI 想过什么" |
| **状态隔离** | checkpoint 沙盒 | restore 后试探痕迹完全清除 |

**实现要点**：
```
checkpoint('ai_search_123')
  试探 Op 序列...           // 这些 Op 进 Journal（用于 restore）
  → 产生的 Event 标记为 suppressLog:true   // 不进 world.log
restore('ai_search_123')
  → Journal 中试探段的逆 Op 执行
  → world.log 恢复到 checkpoint 时的状态
```

#### 12.X.3 调试器特权接口

调试模式（`kernel.init({debugMode: true})`）额外提供：

```typescript
interface DebuggerAPI {
  journal: {
    readFull(): Op[]                    // 完整 Journal
    readInverse(opId: OpId): Op         // 读某 Op 的逆操作
    replayRange(from: number, to: number): State  // 重放指定范围
  }
  
  checkpoint: {
    list(): CheckpointHandle[]          // 列出所有 checkpoint
    inspect(handle: CheckpointHandle): State  // 检视内部状态
    diff(a: CheckpointHandle, b: CheckpointHandle): StateDiff
  }
  
  step: {
    executeOne(op: Op): Result<State>   // 单步执行一个 Op
    undo(): Result<State>               // 撤销上一个 Op
  }
}
```

**安全约束**：
- 调试 API **不得**在生产环境（`debugMode: false`）下可用
- 调试 API 的存在**不得**影响正常玩法包的 API 形状与行为
- 调试模式下仍然遵守所有不变量（§4.6）

#### 12.X.4 禁止的访问模式

以下模式在设计上**不可表达**（接口不存在）：

```typescript
// ❌ 玩法包读完整 Journal
const allOps = world.journal  // 字段不存在

// ❌ 玩法包手动 checkpoint/restore（时间倒流作弊）
checkpoint('cheat')
tryAction()
if (failed) restore('cheat')  // 此模式属第四圈（§15），明确不支持

// ❌ 玩法包读 AI 搜索过程
const aiThoughts = Query.from('log').where(source=='ai' && mode=='search')
  // 试探 Event 不进 log，此查询永远为空

// ❌ 表现层直接读 Op 细节
after:damage → kernel.journal.last()  // 表现层不可访问 kernel.journal
```

**时间回溯玩法的正确实现**（用例 83）：
不依赖 Journal，而是玩法包在 `world.props` 维护自己的历史快照：
```
Action 'rewind3turns' {
  require: world.props.timeRewindCharges > 0
  effects: [
    { let: 'snapshot', be: world.props.stateHistory[-3] }
    { op: 'state.restore', args: { snapshot } }  // 玩法层的状态恢复
    { op: 'prop.add', args: { path: 'world.props.timeRewindCharges', delta: -1 } }
  ]
}
```
此方式**不暴露 Journal**，且回溯范围由玩法包控制（不能无限回溯）。

---

## 13. Safety：暴力边界的机械保证

| 保证 | 手段 |
|---|---|
| 不抛异常 | 全部 API 返回 `Result`，Expr 全函数 |
| 不挂死 | step 预算、`while` 强制 maxIter、事件 depth 上限、重入锁 |
| 不半损坏 | 事务 + 回滚 |
| 不悬空引用 | 销毁级联 + 引用完整性不变量 |
| 不数值爆炸 | 有限数校验 + Def 级 clamp |
| 不确定性漂移 | 命名随机流 + Hook 确定性排序 + 稳定迭代序 |
| 加载期拦截 | Def schema 校验、引用存在性、循环继承检测、无 maxIter 的 while |
| 资源配额 | 每玩法包限定实体数、attachment 数、规则数上限 |

**验收方式**：对 Op 空间做属性测试（任意合法 Op 序列后不变量恒成立），
对 Expr 做模糊测试（任意畸形 Expr 不抛异常），详见 11 文档。

### 13.1 为什么诊断体系必须进内核

前十一轮把"不崩溃"当成了实现细节，这是错的。理由：

**零代码承诺把报错的读者从工程师换成了创作者。** 一个 UGC 作者写错了 `require`
表达式，他既不能读引擎源码，也不能打断点。如果内核只回一个
`{ok:false, code:'E_FAIL'}`，他唯一的选择是把参数瞎改一遍试出来 ——
**这等于把"不写代码"换成了"猜"**，圈层契约（0.3）在体验上就破产了。

因此诊断信息的质量是**内核的功能需求**，不是工程质量项。三条硬要求：

| 要求 | 反面 |
|---|---|
| **可定位**：指出是哪个 Def 的哪个字段出错 | "表达式求值失败" |
| **可理解**：用创作者的词汇，不用内核内部术语 | "E_EXPR_TYPE at node 0x3f" |
| **可行动**：说清下一步该改什么 | 只说错了，不说怎么办 |

### 13.2 严重级别与处理契约

四级，每级的处理方式是**契约**，不是建议：

| 级别 | 含义 | 内核动作 | 对局 |
|---|---|---|---|
| `fatal` | 内核不变量被破坏 | 回滚 + **停机** + 落盘完整现场 | 终止，保留最后一个合法快照 |
| `error` | Op 被拒绝 | 事务回滚，`Result.ok:false` | **继续**，状态如同该 Op 未发生 |
| `warn` | 成功但可疑 | 记录并继续 | 继续 |
| `info` | 追踪 | 仅在诊断模式记录 | 继续 |

**`fatal` 与 `error` 的分界是全章最关键的一条**：
`error` 是**玩法包的错**（写错谓词、目标非法、资源不足），内核工作正常，对局必须继续；
`fatal` 是**内核自己的错**（不变量被破坏、Op 执行后状态自相矛盾），
此时继续运行只会污染存档 —— 停机并保留最后合法快照是唯一负责的做法。

**内核只有两个终态：不变量成立地运行，或停机。绝不带着损坏状态运行。**

`warn` 承载"没崩但你大概不想这样"，这一级最容易被省掉，而它恰好是
刷物品/刷 AP 类 bug 的唯一早期信号：

```
W_COST_REFUNDED     代价已退回（void）—— 频繁出现意味着玩法包时序有问题
W_STACK_ROLLBACK    拆分失败已回滚
W_BUDGET_NEAR       Flow step / 搜索预算用掉 80%
W_AURA_DEPS_MISS    光环 query 引用了未声明在 deps 里的属性（运行期兜底重算）
W_RULE_DISABLED     某规则连续报错被熔断（13.6）
W_DECISION_TIMEOUT  决策超时按默认处理
W_INTENT_VOID       Intent 解算前 require 失败
```

### 13.3 Diagnostic 结构

```typescript
interface Diagnostic {
  code: ErrCode                  // 封闭枚举，见 13.4
  severity: 'fatal' | 'error' | 'warn' | 'info'
  message: string                // 面向创作者的人话，含具体值
  at?: {                         // ★ 归因：错在谁写的哪一行
    def?: DefId                  // 哪个 Def
    field?: string               // 'require' | 'effects[2].args.amount'
    playpack?: DefId             // ★ MOD 叠加时，是哪个包带来的
  }
  subject?: Ref                  // 涉及的对象
  path?: string                  // 涉及的状态地址
  expected?: Value               // 期望
  actual?: Value                 // 实际
  cause?: DiagnosticId           // 诊断链（连锁失败时回溯首因）
  hint?: string                  // ★ 该怎么改
  phase: number                  // 何时
}
```

`at.playpack` 是 MOD 生态的必需项：叠了三个包之后，
"谁写的这条规则炸了"必须一眼可见，否则创作者互相甩锅。

`hint` 是硬要求而非可选装饰。示例对比：

```
差：E_EXPR_TYPE: type mismatch
好：E_EXPR_TYPE — 规则 defs.action.shoot 的 require 里，
    props.ammo 求值为 null（该实体没有 ammo 属性），而 >= 需要数字。
    改法：在 Def 里给 props.ammo 一个初值，或用 coalesce(props.ammo, 0)。
    位置：defs.action.shoot.require，来自玩法包 br.zombie
```

### 13.4 ErrCode：封闭集合

`ErrCode` 在 §4.1 被 `Result` 引用却从未定义（第 12 处引用悬空）。
它必须是**封闭枚举并按层分组** —— 封闭是为了能穷举测试，分组是为了创作者能定位层次：

**本节与 `src/core/kernel/state/error-codes.ts` 的 `ERR_CODES` 逐字段对齐（该文件自称"唯一真相源"）。**
2026-08-07 规范整合时核对发现历史版本存在命名漂移与遗漏，已按下表更新；变更依据见
`.kiro/specs/meta-mechanism-kernel/决策与风险记录.md` 新增决策条目。

**有效码表**（穷举；这些码在真实内核中均有实现或有明确 severity 归属）：

| 前缀 | 层 | 码 |
|---|---|---|
| `E_REF_` | 寻址与引用 | `E_REF_MISSING` `E_REF_KIND` `E_REF_DESTROYED` `E_REF_ABSTRACT` `E_REF_AMBIGUOUS` `E_REF_PROVIDER_CONTRACT` `E_REF_CYCLE` |
| `E_INV_` | 不变量（**一律 fatal**） | `E_INV_DANGLING` `E_INV_CYCLE` `E_INV_DUAL_LOCATION` `E_INV_STACK_LEAK` `E_INV_SINGLE_CONTAINMENT` `E_INV_SINGLE_LOCATION` `E_INV_LOCATION_EXCLUSIVE` `E_INV_CONTAINMENT_CYCLE` `E_INV_TOPOLOGY_CONSISTENCY` `E_INV_PARENT_CHILD` `E_INV_RELATION_SYMMETRY` `E_INV_CONTAINER_BIDIRECTIONAL` `E_INV_SLOT_INDEX_CONTINUITY` `E_INV_ATTACHMENT_CONSISTENCY` `E_INV_STACK_BOUNDED` `E_INV_DECISION_TERMINATION` `E_INV_NAN_OR_INFINITY` `E_INV_UNSUPPORTED_TYPE` |
| `E_OP_` | Op 前置条件 | `E_OP_SLOT_FULL` `E_OP_NOT_ACCEPTED` `E_OP_VETOED` `E_OP_NO_LEGAL_SLOT` `E_OP_NOT_FOUND` `E_OP_INVALID_ARGS` |
| `E_EXPR_` | 表达式 | `E_EXPR_TYPE` `E_EXPR_UNKNOWN_OP` `E_EXPR_DEPTH` `E_EXPR_CALL_CYCLE` |
| `E_FLOW_` | 效果脚本 | `E_FLOW_BUDGET` `E_FLOW_NO_MAXITER` `E_FLOW_ABORT` `E_FLOW_INTERNAL` `E_FLOW_UNKNOWN_EFFECT` |
| `E_HOOK_` | 事件管道 | `E_HOOK_DEPTH` `E_HOOK_REENTRY` `E_HOOK_INSTEAD_CONFLICT` |
| `E_COST_` | 代价 | `E_COST_INSUFFICIENT` `E_COST_FROZEN_GONE` |
| `E_DEC_` | 决策与 Intent | `E_DEC_VOID` `E_DEC_QUORUM` |
| `E_LOAD_` | 装载期（装载/编译/Schema/组合/规范化六组，与实现注释分组一致） | `E_LOAD_CONFLICT` `E_LOAD_CYCLE_DEP` `E_LOAD_LINT` `E_LOAD_UNDEFINED_REF` `E_LOAD_SOURCE_INVALID` `E_LOAD_SOURCE_SPAN` `E_LOAD_JSON_SYNTAX` `E_LOAD_DUPLICATE_MEMBER` `E_LOAD_PROHIBITED_CONSTRUCT` `E_LOAD_SCHEMA_CONTRACT` `E_LOAD_IDENTITY_CONFLICT` `E_LOAD_UNRESOLVED_CONTRACT` `E_LOAD_DECISION_ID_REUSED` `E_LOAD_BASELINE_STALE` `E_LOAD_ACTIVATION_FAILED` `E_LOAD_MODE_FORBIDDEN` `E_LOAD_DIAGNOSTIC_FACTORY` `E_LOAD_COMPILER_TERMINATED` `E_LOAD_WORKER_PROTOCOL` `E_LOAD_PERSISTENCE_CAPABILITY` `E_LOAD_STAGE_IO` `E_LOAD_ATOMIC_RENAME` `E_LOAD_RECOVERY_CORRUPT` `E_LOAD_SOURCE_RECORD_MISSING` `E_LOAD_SOURCE_SPAN_CORRUPT` `E_LOAD_SOURCE_MAP_LOST` `E_LOAD_DIAGNOSTIC_FAILURE` `E_LOAD_INPUT_TRUNCATED` `E_LOAD_SCHEMA_VERSION` `E_LOAD_UNKNOWN_FIELD` `E_LOAD_REQUIRED_FIELD` `E_LOAD_FIELD_TYPE` `E_LOAD_DEF_KIND` `E_LOAD_IDENTIFIER_INVALID` `E_LOAD_DUPLICATE_ID` `E_LOAD_OVERRIDE_INVALID` `E_LOAD_LAYER_OWNERSHIP` `E_LOAD_TERM_NONCANONICAL` `E_LOAD_NUMERIC_OWNERSHIP` `E_LOAD_GAMEPLAY_VALUE_RANGE` `E_LOAD_CROSS_FIELD_CONSTRAINT` `E_LOAD_DEPRECATED_MECHANIC` `E_LOAD_SEMANTIC_FIELD_DAMAGED` `E_LOAD_INHERITANCE_CYCLE` `E_LOAD_COMPOSITION_CONFLICT` `E_LOAD_ORDER_UNDECLARED` `E_LOAD_SOURCE_DISPLACED` `E_LOAD_EQUAL_PRECEDENCE_CONFLICT` `E_LOAD_UNRESOLVED_NORMATIVE` `E_LOAD_SOURCE_STATUS_PROMOTION` `E_LOAD_NORMATIVE_WITHOUT_PROVENANCE` `E_LOAD_CANONICAL_AMBIGUOUS` `E_LOAD_CANONICAL_NONDETERMINISTIC` `E_LOAD_ROUNDTRIP_MISMATCH` `E_LOAD_COMMIT_RECHECK_FAILED` `E_LOAD_PARTIAL_ACTIVATION` `E_LOAD_OUTPUT_WRITE_FAILED` `E_LOAD_CACHE_ROLLBACK_FAILED` `E_LOAD_PRESENTATION_FALLBACK` |
| `E_MIG_` | 版本迁移 | `E_MIG_NO_PATH` `E_MIG_NEWER_SAVE` `E_MIG_FAILED` `E_MIG_AMBIGUOUS_PATH` `E_MIG_CYCLE` |
| `E_QUOTA_` | 配额 | `E_QUOTA_ENTITIES` `E_QUOTA_ATTACHMENTS` `E_QUOTA_RULES` `E_QUOTA_INPUT_BYTES` `E_QUOTA_NESTING_DEPTH` `E_QUOTA_OBJECT_MEMBERS` `E_QUOTA_ARRAY_ELEMENTS` `E_QUOTA_SOURCE_RECORDS` `E_QUOTA_AST_NODES` `E_QUOTA_DEFINITIONS` `E_QUOTA_REFERENCE_EDGES` `E_QUOTA_TRAVERSAL_WORK` `E_QUOTA_DIAGNOSTICS` `E_QUOTA_OUTPUT_BYTES` |

**severity 规则**：`E_INV_*` 一律 fatal，其余一律非 fatal——**除一个显式例外**：
`INFRASTRUCTURE_FATAL_CODES`（`error-codes.ts` 中的闭合集合，含 15 个 `E_LOAD_*` 编译器基础设施故障码
与 `E_QUOTA_DIAGNOSTICS`）即使前缀不是 `E_INV_`，也被视为进程级 fatal——
它们代表规范编译器自身故障（源记录丢失、诊断工厂失败、原子重命名失败等），
而非创作者输入错误，一旦出现编译会话必须撤销输出租约并停止，不允许降级为警告。
`E_INV_*` 的 fatal 映射对玩法包是死的，不允许覆盖 —— 否则玩法包可以把内核损坏降级成警告，继续污染存档。

**已废弃码**（历史版本曾定义，真实内核从未实现，不再新增，仅保留记录避免旧文档引用悬空）：

| 废弃码 | 原语义 | 现状 |
|---|---|---|
| `E_REF_UNKNOWN_PREFIX` `E_REF_FORBIDDEN_EXTEND` | 引用前缀/继承边界校验 | 未实现，无替代 |
| `E_OP_STACK_AMOUNT` `E_OP_STACK_SPLIT_FORBIDDEN` `E_OP_STACK_OVERFLOW` `E_OP_SELF_MERGE` `E_OP_MERGE_DEF_MISMATCH` | stack.split/merge 系列细分校验 | 已被更粗粒度的 `E_OP_INVALID_ARGS` 取代 |
| `E_TX_NESTED` | 在活跃事务内再次 `tx.begin()` | 未实现该前缀，无替代 |
| `E_COST_INVALID_AMOUNT` | `cost.freeze` amount ≤ 0 | 未实现，无替代 |
| `E_HOOK_INVALID_PHASE` `E_HOOK_DUPLICATE_ID` `E_HOOK_MISSING_ID` `E_HOOK_NOT_FOUND` | RuleDef 装载期校验 | 已被通用 `E_LOAD_SCHEMA_CONTRACT` / `E_LOAD_DUPLICATE_ID` / `E_LOAD_REQUIRED_FIELD` / `E_LOAD_UNDEFINED_REF` 取代 |
| `E_DEC_INVALID_ANSWER` `E_DEC_TIMEOUT` `E_DEC_INVALID_ASKEE` `E_DEC_ASKEE_INVALID` `E_DEC_COUNT_BELOW_MIN` `E_DEC_COUNT_EXCEEDS_MAX` `E_DEC_DUPLICATE_CHOICE` `E_DEC_CONFLICT_CONSTRAINT` `E_DEC_MAX_EXCEEDS_OPTIONS` `E_DEC_CIRCULAR_DEP` `E_DEC_NOT_RETRACTABLE` `E_DEC_CONDITION_UNMET` | Decision 运行期状态机细分错误 | 已并入 `E_DEC_VOID` 的更宽语义（decision 已不可再变更时统一报此码） |
| `E_DEC_ALREADY_RESOLVED` `E_DEC_ALREADY_ANSWERED` `E_DEC_NOT_OPEN` `E_DEC_NESTED` | Decision 状态转移细分错误 | 同上，并入 `E_DEC_VOID` |
| `E_DEC_EMPTY_OPTIONS` `E_DEC_DUPLICATE_OPTIONS` | DecisionDef 装载期选项校验 | 已被通用 `E_LOAD_SCHEMA_CONTRACT` / `E_LOAD_LINT` 取代 |
| `E_LOAD_DECISION_EMPTY_OPTIONS` `E_LOAD_DUPLICATE_OPTION_NAME` `E_LOAD_INVALID_OPTION_NAME` `E_LOAD_INVALID_DEFAULT_ANSWER` `E_LOAD_INVALID_COUNT_RANGE` `E_LOAD_COUNT_EXCEEDS_OPTIONS` `E_LOAD_DEFAULT_REQUIRED` | Decision 专用装载期校验（原 §13.4 `E_DEC_` 行末尾混入的 `E_LOAD_DEFAULT_REQUIRED` 属重复/误植，已一并移除） | 已被通用 `E_LOAD_SCHEMA_CONTRACT` / `E_LOAD_REQUIRED_FIELD` / `E_LOAD_FIELD_TYPE` 取代 |
| `E_JOURNAL_FORBIDDEN_ACCESS` `E_JOURNAL_DEBUGMODE_REQUIRED` `E_JOURNAL_PLAYPACK_VIOLATION` | Journal 权限 | 未实现该前缀，无替代 |

### 13.5 兜底阶梯：每一层都有确定的降级路径

"尽量无破坏性崩溃"要落成**逐层的明文降级**，而不是一句愿望：

| 层 | 失败时 | 降级到 | 对局 |
|---|---|---|---|
| Expr 求值 | 类型错、越界、除零 | 返回 `null` + `warn` | 继续 |
| 具名表达式 | 调用图有环 | **加载期**拒绝装载 | 未开局 |
| Op 前置条件 | 不满足 | `ok:false`，**状态零改动** | 继续 |
| Flow | step 预算超支 | `abort` + 事务回滚 | 继续 |
| Hook（单条） | 内部报错 | **跳过该条 + warn**，管道继续 | 继续 |
| Hook（连锁） | depth 超限 | 拒绝最深那层 + warn | 继续 |
| 响应相位 | 轮次超 `reactionRounds` | 强制进解算相位 | 继续 |
| Decision | 超时 / 前提失效 | `onTimeout` / `onVoid` | 继续 |
| Intent | 解算前 require 失败 | `void` + 退回代价 + warn | 继续 |
| Policy | 超预算 / 无合法着法 | `fallback` → 仍无则**跳过该 NPC** | 继续 |
| 相位推进 | 有 Agent 不响应 | `timeLimit` 到点按默认处理 | 继续 |
| 迁移 | 无迁移链 | 拒绝装载，**老存档不动** | 未开局 |
| 不变量 | 被破坏 | 回滚 + 停机 + 落盘现场 | 终止 |

**关键一条是"Hook 单条失败只跳过它自己"**：一条写坏的第三方 MOD 规则
不应该让整个伤害管道死掉。配合 13.6 的熔断，坏规则会被自动摘掉而对局继续。

### 13.6 熔断与去重

两个机械保护，防止诊断本身变成故障源：

- **规则熔断**：同一 `(ruleDefId, code)` 在一个滑动窗口内连续 `error` 超过阈值
  → 自动停用该规则至本局结束，发 `W_RULE_DISABLED`（含归因）。
  理由：一条每次伤害都报错的规则会瞬间刷满日志并拖垮帧率。
- **诊断去重**：相同 `(code, at.def, at.field)` 折叠计数，只保留首次的完整现场 +
  末次时间 + 出现次数。日志容量有上限（与 `logRetention` 同源，3.2.1），满则丢弃最旧的 `info`。

**诊断日志必须有界**，否则它自己就违反"不挂死"。

### 13.7 加载期优先：把运行期错误尽量前移

最好的报错是**开局前就报**。Linter 在装载期强制的检查：

```
引用存在性        所有 DefId / 路径引用指向真实存在的东西
类型一致性        Expr 的算子参数类型与 schema 相符
while 有 maxIter  缺失即拒绝
调用图无环        具名表达式（3.1.1）
继承无环          Def.extends
aura.deps 完整    query 里引用的 props 都已声明（漏则加载期警告）
玩法包冲突        requires 拓扑序、conflicts 交集
玩法包自定 linter 如 1 AP 铁律
配额              实体/attachment/规则数上限
DecisionDef校验   ★ 新增（字段名同7.5修订后的DecisionDef）
  - options不能为空 → E_LOAD_DECISION_EMPTY_OPTIONS
  - options[].name必须唯一 → E_LOAD_DUPLICATE_OPTION_NAME
  - options[].name不能为空 → E_LOAD_INVALID_OPTION_NAME
  - defaultAnswer必须是options的合法子集 → E_LOAD_INVALID_DEFAULT_ANSWER
  - selection.minCount ≤ selection.maxCount → E_LOAD_INVALID_COUNT_RANGE
  - selection.maxCount ≤ options.length → E_LOAD_COUNT_EXCEEDS_OPTIONS
  - timeout.onTimeout='default'时必须有defaultAnswer → E_LOAD_DEFAULT_REQUIRED
  - nestedDecision缺省视为'deny' → 无错误，装载期补默认值
```

> **加载期 vs 运行期的分层（避免看似重复的校验）**：DecisionDef 是蓝图，其结构合法性
> （options非空/唯一、count区间、defaultAnswer子集）在**加载期**由 Linter 一次性静态校验，
> 报 `E_LOAD_*`。§7.5 正文中 `decision.open` 的同名检查是**运行期防御性兜底**（针对
> 由 `prefab.spawn`/迁移动态生成、未过 Linter 的 DecisionDef），报 `E_DEC_*`。
> 两层命名域不同、互补而非矛盾：合法玩法包在加载期即被拦截，永不触发运行期兜底。

**装载失败必须给出全部问题的清单，而不是第一个** —— 创作者应当一轮修完。

### 13.8 对工程规范阶段的要求（本节是需求，不是实现）

诊断体系的实现是机械的、有现成解法的，因此这里只**严格规定需求**，实现细节留给工程阶段：

1. `ErrCode` 是**穷举封闭枚举**，每个码必须有：稳定标识、级别、消息模板、`hint` 模板、至少一个触发它的测试用例。**无测试用例的错误码不允许存在。**
2. 每个 Op 的每条前置条件都必须映射到一个具体错误码，**不允许出现"通用失败"码**。
3. `E_INV_*` → fatal 的映射由内核硬编码，玩法包不可覆盖。
4. 消息与 `hint` 走模板 + 参数，**可本地化**（与 `ActionDef.label`/`reason` 同一套机制）。
5. 属性测试须断言：任意 Op 序列后（a）不变量成立或已停机，（b）无异常抛出，
   （c）每个 `ok:false` 都携带非空 `at` 归因。
6. 模糊测试须覆盖畸形 Expr、畸形 Def、越界索引、循环引用、超预算，
   并断言**零 fatal**（fatal 只应由内核 bug 触发，不应由畸形输入触发）。
7. 诊断输出须有两种视图：**创作者视图**（人话 + 归因 + hint）与
   **机器视图**（结构化 JSON，供编辑器高亮与 CI 断言）。

---

## 14. 完备性验证矩阵

### 验证方法

对每个用例，只回答一个问题：**用第 2–13 章的原语，不写任何代码，能否表达？**

- ✅ = 可表达，列出用到的原语组合
- ★ = 该轮首次不可表达，**已回补原语**（回补项见 14.8），现可表达
- ⛔ = 明确不支持（见第 15 章边界）

关键纪律：遇到 ★ 时**不允许**新增"模块"，只允许新增或泛化**原语**，并重跑全表。

本表经过**十轮迭代**，200 个用例，27 项回补，其中仅 3 项是新结构。
第四轮起改用"否定隐含假设"的方法（14.9），
第八至十轮**连续零新结构**，判定设计空间已收敛。

---

### 14.1 战斗与伤害（1–20）

| # | 用例 | 表达方式 |
|---|---|---|
| 1 | 近战攻击 | Action + require(同微场景) + emit damage |
| 2 | 远程攻击 + 距离 DC | Action + `dist` + `roll` + modify:roll |
| 3 | 护甲减伤 | modify:damage |
| 4 | 重甲 1 伤免疫 / 3 伤破损 | modify:damage + after:damage → attach.del |
| 5 | 格挡（替换默认行为） | instead:damage |
| 6 | 无敌 / 免疫某类型 | before:damage → cancel |
| 7 | 荆棘反伤 | after:damage → emit damage(source) |
| 8 | 吸血 | after:damage → prop.add(hp) |
| 9 | 暴击 | modify:roll + modify:damage |
| 10 | 击杀回体力（令其长眠） | after:death 读 `cause` → prop.add(pool) |
| 11 | 中毒 / 燃烧（每回合掉血） | attachment + duration + phase 边界 Hook |
| 12 | 延时 Buff（3 回合后狂暴） | attachment.delay |
| 13 | 层数护盾 | attachment stack:'count' + modify:damage |
| 14 | 受击打断精密交互 | after:damage → attach.del |
| 15 | 范围伤害 | Query(radius) + forEach |
| 16 | 锥形 / 直线 | Query(`spread` 带方向权重) |
| 17 | 击退 | entity.place |
| 18 | 眩晕 / 控制 | attachment + Action.require 检查 hasAttachment |
| 19 | 复合状态（冰+火→蒸汽） | attach onAdd 检查共存 → attach.del ×2 + attach.add |
| 20 | 伤害归因（陷阱/毒/推落） | Event.cause 链 |

### 14.2 生死与形态（21–30）

| # | 用例 | 表达方式 |
|---|---|---|
| 21 | 零血倒地（可被处决） | attachment 'downed' + Action.require |
| 22 | 普通击倒（可站起） | 另一个 attachment + 站起 Action |
| 23 | 爬行（限微场景内） | Action + require(同天然场景) |
| 24 | 死亡背包 | entity.create(container) + forEach item.move + slot 只出不进(require) |
| 25 | 复活 / 扶起 | attach.del + prop.set(hp) |
| 26 | 多段变身（人→狼人→巨狼） | ★ `entity.setDef` + carry |
| 27 | 幽灵化（可穿墙） | setDef + before:place Hook 放宽 |
| 28 | 尸体消失（毒气致死） | after:death 读 cause → 跳过背包生成 |
| 29 | 观战 | knowledge 全知 + viewpoint |
| 30 | 退出游戏（原地不动） | attachment 'afk' + Action 清空 |

### 14.3 物品、容器、经济（31–50）

| # | 用例 | 表达方式 |
|---|---|---|
| 31 | 拾取 / 丢弃 | item.move |
| 32 | 装备 / 卸下 | item.move（目标 slot 带 filter） |
| 33 | 双手武器占 1 格 | slot.filter + require(另一手空) |
| 34 | 背包拓展（4→6 格） | ★ `slot.add` |
| 35 | 钱袋子（只收货币） | container + slot.filter(hasTag 'currency') |
| 36 | 货币堆叠 | Item.stack + `stack.split/merge` |
| 37 | **商店** | Action + require(pool≥price) + cost + item.move ×2 |
| 38 | 自动贩卖机 / 赌博机 | 同 37，effects 里加 `pick` |
| 39 | 动态定价（按声望打折） | cost.amount 写成 Expr |
| 40 | 合成台 | Action + require(有材料) + item.destroy + item.create |
| 41 | 玩家间交易（双向确认+原子性） | ★ `decision`(quorum:'all') + onResolve 内两次 item.move 同事务 |
| 42 | 负重上限 | ★ `before:item.move` veto |
| 43 | 耐久 | after:hit → prop.add(durability) → 0 时 destroy |
| 44 | 掉落表 | `pick` + 权重表数据 |
| 45 | 消耗品 | Action.effects + item.destroy |
| 46 | 弹药与换弹 | pool 或 stack + Action |
| 47 | 配件装到枪上 | 枪自带 container + slot.filter |
| 48 | 折叠自行车 ↔ 自行车 | `item.promote` / `entity.demote` |
| 49 | 后备箱（独立于主背包） | ★ 一个 Entity 拥有**多个命名容器** |
| 50 | 牌堆 / 抽牌 / 洗牌 | ★ `ordered` 容器 + `shuffle` + item.move |

### 14.4 空间与拓扑（51–65）

| # | 用例 | 表达方式 |
|---|---|---|
| 51 | 移动 | Action + entity.place |
| 52 | 门锁 / 开门 | link.props.locked + require |
| 53 | 炸开墙壁（新增通路） | link.create |
| 54 | 桥梁断裂 | link.destroy |
| 55 | 传送门 | Action + entity.place(远处) |
| 56 | 过渡场景创造微场景 | microscene.owner = Link（owner 泛化为 Ref） |
| 57 | 门被占据无法通行 | before:place veto + Query 计数 |
| 58 | 小场景共享微场景 | Node.props 声明 shared，place 时归一 |
| 59 | 空旷地 | microscene.create(owner=自己) |
| 60 | 距离范式（大场景 ×2） | ★ Node/Link 的 `weight` + 加权最短路 `dist` |
| 61 | 窗边射击（跨楼层） | Link weight 特例 + microscene |
| 62 | 缩圈 | phase Hook + Query(nodes) + node attachment |
| 63 | 地面着火 / 油 / 水 / 电 | node attachment |
| 64 | 迷雾 / 已探索 | knowledge.seen |
| 65 | 巡逻线 | props.route = NodeId[] + AI policy |

### 14.5 NPC、AI、感知（66–75）

| # | 用例 | 表达方式 |
|---|---|---|
| 66 | 守卫状态机 | props.state + Hook 转移 + AI policy |
| 67 | 声音传播与衰减 + 判断来向 | ★ `spread(origin, budget, {decay})`，读返回的 `from` |
| 68 | 感知阈值触发 | after:noise → 比较阈值 → prop.set(state) |
| 69 | 追逐锁定 | props.state='chase' 时忽略 noise Hook |
| 70 | 召唤物 / 随从 | entity.create + relation('owner') |
| 71 | 宠物 AI 跟随主人 | AI policy 读 relation |
| 72 | 远程操控无人机 | relation('control') + props.viewpoint |
| 73 | 操控被打断 | after:damage → relation.del |
| 74 | αβ 搜索 | checkpoint/restore + queryActions + `PlaypackDef.evaluate` |
| 75 | AI 难度分级 | policy.props + `visibleTo` 是否放宽 |

### 14.6 玩法、叙事、元系统（76–85）

| # | 用例 | 表达方式 |
|---|---|---|
| 76 | 对话树 | props.dialogue 数据 + Action 动态 targets |
| 77 | 侦探出示证据 | 选项 require(`knows`) |
| 78 | 任务接取/追踪/完成 | knowledge + after:* 计数 + emit |
| 79 | 成就 | 同 78，另一组 Hook |
| 80 | 胜负判定 | `PlaypackDef.outcomes`（见 9.1，第八轮泛化） |
| 81 | 经验 / 等级 / 技能树 | pool + prop + Action.require(等级) |
| 82 | 阵营与声望 | props.faction + world 关系矩阵 |
| 83 | 时间回溯 3 回合 | rewind |
| 84 | 存档 / 回放 / 观战 | snapshot / journal replay |
| 85 | 新玩法包（格斗/卡牌/解谜） | 全部为 Def + Rule + Schedule 数据 |

### 14.7 多方决策与响应（86–95）★ 本轮新增，暴露了 Decision 原语

这一组是第四轮推演补的。前 85 例全部隐含"当前行动者决策 → 立即解算完毕"，
因此漏掉了整整一类机制。它们**共用同一个原语**（7.5），这正是"做整合"的证据。

| # | 用例 | 表达方式 |
|---|---|---|
| 86 | 玩家间交易的双向确认 | `decision` quorum:'all' + onResolve 同事务两次 move |
| 87 | 交易期间对象死了 / 物品被抢 | `onResolve` 前的强制前提重检 → 走 `onVoid` |
| 88 | 反应技 / 反制 / 打断 | ★ **响应相位**（7.5.1）+ 反应 Intent，非 Hook 内提问 |
| 89 | 卡牌响应窗口（连续反制） | ★ `reactionRounds` 有限轮次，静态可数 |
| 90 | 是否接受投降 / 是否救人 | quorum:'any' + onTimeout:'default' |
| 91 | 战利品分配投票 | quorum:'majority' |
| 92 | 有人推门，另一侧决定顶不顶 | 顶住是他自己回合的动作或预置规则，**无需中途提问** |
| 93 | 决策超时（防止挂机拖死） | `deadline` + `onTimeout`，相位强制推进 |
| 94 | AI 自动应答交易/反应 | 待答 decision 进入 `queryActions`，AI 无需特殊代码 |
| 95 | 决策待答期间存档退出 | Decision 是状态而非协程挂起，随快照一并存 |

**94、95 是这个设计的验收点。** 若用挂起协程实现响应窗口，这两条都做不到；
把决策做成一等状态对象，两条都自动成立。

### 14.7.1 运行期规则、多拓扑、数值选择（96–110）★ 第五轮新增

第五轮用同一方法（否定隐含假设）挖出三处缺口。它们互不相关，
但每一处都是"若不补，创作者必须改代码"。

| # | 用例 | 表达方式 | 缺口 |
|---|---|---|---|
| 96 | roguelike 局内增益（本局敌人变强） | ★ `attach.add(world, mod)` + rules | 运行期规则 |
| 97 | 卡牌场地效果（本回合费用 -1） | 同上 + duration | 运行期规则 |
| 98 | 赛季 / 难度 / 随机模式 | 同上，装载时挂 | 运行期规则 |
| 99 | 撤销一条临时规则 | `attach.del` | 运行期规则 |
| 100 | 平行世界 / 梦境层 | 拓扑的不连通分量（2.1.1） | 已成立 |
| 101 | 梦中受伤影响现实 | 跨分量普通 Hook | 已成立 |
| 102 | 刷一个新副本实例 | ★ `prefab.spawn` | 子图实例化 |
| 103 | 程序化生成建筑内部 | ★ `prefab.spawn` + `attachTo` 接缝 | 子图实例化 |
| 104 | 载具内部空间（车内是子图） | ★ `prefab.spawn`，车是 Entity | 子图实例化 |
| 105 | 副本结束回收 | ★ `prefab.despawn`，级联疏散 | 子图实例化 |
| 106 | 「给他 37 块钱」 | ★ `TargetSpec.range` | 数值选择 |
| 107 | 赌局押注 | ★ `range` + `step` | 数值选择 |
| 108 | 弃任意两张牌 | ★ `TargetSpec.count` | 数值选择 |
| 109 | 分配 3 点属性升级 | ★ `range` + `count` 组合 | 数值选择 |
| 110 | 两人合力抬门（协作动作） | targets 含活体 + `decision` 同意 | 已成立（复用 7.5） |

**110 号是复用的最好证据**：协作动作看起来该有个"CoopActionSystem"，
实际上是第四轮的 `decision` 加第五轮的 `targets` 直接拼出来的，零新增。

### 14.7.2 席位、权限、拓扑重构（111–125）★ 第六轮新增

第六轮否定了五条假设，其中**两条真的破了**（玩家数固定、拓扑只增删边），
**两条已被覆盖**（持续性事件、行动者平权），**一条确认不是完备性问题**（批量 Op）。

| # | 用例 | 表达方式 | 来源 |
|---|---|---|---|
| 111 | 中途加入 | ★ `agent.bind` 到一个既有 Entity | Agent |
| 112 | 掉线转 AI 接管 | ★ `agents.a1.kind='ai'` + policy | Agent |
| 113 | 回归夺回控制权 | ★ 改回 `kind='human'` | Agent |
| 114 | 观战转参战 | ★ Agent 的 `controls` 从空变非空 | Agent |
| 115 | 一人操控多单位（RTS 式 / 无人机） | ★ `controls` 是数组 | Agent |
| 116 | 队伍共享视野 | ★ 多 Agent 共享 `knowledgeScope` | Agent |
| 117 | AI 难度（是否允许"作弊"视野） | ★ `knowledgeScope` 指向 omniscient scope | Agent |
| 118 | GM / 导演干预 | ★ `authority:['gm']` + 带 gm tag 的普通 Action | Agent |
| 119 | 剧本编排（脚本化事件） | 118 的特例：GM Agent 由 policy 驱动 | Agent |
| 120 | 上帝视角调试器 | ★ `omniscient:true` 的 observer Agent | Agent |
| 121 | 炸墙：两房间合为一个空间 | ★ `node.merge` + carry | 拓扑重构 |
| 122 | 拆隔断 / 空间被分割 | ★ `node.split` | 拓扑重构 |
| 123 | 微型场景指针合并（小场景共享地） | ★ `node.merge`（03 文档的规则落地） | 拓扑重构 |
| 124 | 水位上涨，多房间并为水域 | ★ `node.merge` + node attachment | 拓扑重构 |
| 125 | 「正在被电流通过」持续状态 | attachment + phase 边界 Hook（无需新增） | 已覆盖 |

**121–124 用同一个 Op**，而它的存在理由与 `entity.setDef` 完全同构（见 4.4.1）——
这是"泛化而非加法"最干净的一次：一条已被接受的论证，对称地应用到另一个结构上。

### 14.7.3 同时结算、错误认知、MOD 叠加（126–145）★ 第七轮新增

| # | 用例 | 表达方式 | 来源 |
|---|---|---|---|
| 126 | 格斗对拼（双方同时出招） | ★ `Intent` + `resolveOrder` | Intent |
| 127 | 后发先至（速度决定解算序） | ★ `resolveOrder` 读速度属性 | Intent |
| 128 | 猜拳 / 暗押（揭示前不可见） | ★ `Intent.hidden` | Intent |
| 129 | 两人同抢最后一件物品 | ★ 解算前重检 require → void + `onConflict` | Intent |
| 130 | 指令排队（预设三步） | ★ 多个 pending Intent | Intent |
| 131 | 网络锁步（收齐才推进） | ★ 相位等待 Intent 齐 | Intent |
| 132 | 出招后目标已死 | ★ 强制重检 → `status:'void'` | Intent |
| 133 | 待解算时存档退出 | ★ Intent 是状态，随快照存 | Intent |
| 134 | NPC 误认凶手（错误信息） | ★ `facts` 存任意 Value，可与真值不符 | Knowledge |
| 135 | 伪造线索 / 假情报 / 变装 | ★ 写入不符真值的 fact | Knowledge |
| 136 | 过时记忆（"他刚才在 3 号房"） | ★ fact 带 `at` 相位戳 | Knowledge |
| 137 | 记忆随时间衰减 | ★ phase Hook 按 `at` 删除/模糊 | Knowledge |
| 138 | 侦探推理（怀疑对象可被推翻） | ★ 怀疑对象即一个 fact | Knowledge |
| 139 | NPC 记得的血量与真实不符 | ★ fact 存数值 | Knowledge |
| 140 | 基础包 + 僵尸模式 + 双倍掉落 | ★ `requires` + 装载期合并 | MOD |
| 141 | 两个 MOD 互斥 | ★ `conflicts`，加载期拒绝并指名 | MOD |
| 142 | MOD 替换基包的某个武器 | ★ `overrides` | MOD |
| 143 | MOD 叠加顺序可控 | ★ Hook 排序键含包序 | MOD |
| 144 | 循环依赖 | ★ 拓扑排序检测，加载期拒绝 | MOD |
| 145 | MOD 违反基包铁律 | ★ 装载期跑全部 linter | MOD |

**126–133 与 86–95 共享同一套论证**（重检 require、状态非挂起、可存档、AI 可搜索）。
`Decision` 与 `Intent` 是"决策时间线"的两半，刻意同构 —— 若只补一个，另一半必然要写代码。

### 14.7.4 持续动作、历史、结局（146–165）★ 第八轮新增，零新结构

第八轮是**第一个不产生新结构的轮次**。五条假设里三条确认已覆盖、两条只需泛化。

| # | 用例 | 表达方式 | 判定 |
|---|---|---|---|
| 146 | 施法 3 回合后生效 | attachment + duration + onExpire | 已覆盖 |
| 147 | 施法中被打断 | `attach.del` → onRemove 不放效果 | 已覆盖 |
| 148 | 长时间搬运 / 撬锁进度 | attachment 存进度，phase Hook 递增 | 已覆盖 |
| 149 | 持续动作期间被锁定其他行动 | Action.require 检查 hasAttachment | 已覆盖 |
| 150 | 一手牌作为"资源" | `ordered` 容器 + `CostSpec.items`，非 pool | 已覆盖 |
| 151 | 一组棋子 / 有序资源 | 同上 | 已覆盖 |
| 152 | 可见但不可达（隔院狙击） | ★ `link.tags=['sight']` + `dist(via: hasTag)` | 已覆盖 |
| 153 | 可达但不可见（黑暗通道） | 反向：走 `visibility` 谓词而拓扑连通 | 已覆盖 |
| 154 | 战斗日志 / 击杀提示 | ★ `from:'log'` | log |
| 155 | 「重复上一个动作」 | ★ 查最近 resolved Intent | log |
| 156 | 复仇：针对最后打我的人 | ★ 查最近 damage 的 source | log |
| 157 | 本局战绩核验 | ★ `from:'log'` 计数（窗口内） | log |
| 158 | AI 识别对手出招套路 | ★ 查对手历史 Intent | log |
| 159 | 大逃杀第 7 名（淘汰但游戏继续） | ★ `scope:'agent'` + `ends:false` | outcomes |
| 160 | 淘汰后转观战 | ★ 159 + `Agent.kind='observer'` | outcomes |
| 161 | 狼人杀：各阵营各自胜利条件 | ★ 多条 `OutcomeDef` + `scope:'faction'` | outcomes |
| 162 | 竞速 / 积分排名（非胜负） | ★ `OutcomeDef.rank` | outcomes |
| 163 | 侦探多结局（抓对/抓错/放跑） | ★ 多条 outcome，`ends:true` | outcomes |
| 164 | 平局 | ★ 一条 `name:'draw'` 的 outcome | outcomes |
| 165 | 结算发奖 / 写战绩 | ★ `OutcomeDef.onReach` | outcomes |

### 14.7.5 抽象、约束、表现层读路径（166–180）★ 第九轮新增，零新结构

| # | 用例 | 表达方式 | 判定 |
|---|---|---|---|
| 166 | 同一复杂判定复用于 20 个 Action | ★ `kind:'expr'` 具名表达式 | expr |
| 167 | 派生属性（攻击=力量+武器+buff） | ★ 具名表达式读时求值，不用回写 | expr |
| 168 | MOD 只改掉落公式 | ★ `overrides` 一个 `expr` Def | expr |
| 169 | 改一处判定，20 处同步生效 | ★ 同 166 | expr |
| 170 | 血量永不超上限 | `Def.clamp`（已有） | 已覆盖 |
| 171 | 不能同时拿两把双手武器 | `Slot.accepts` + before Hook | 已覆盖 |
| 172 | 分配点数总和不超 10 | before:prop.set → veto | 已覆盖 |
| 173 | 又是物品又是容器又能变实体 | Item 可有 containers + `promote` | 已覆盖 |
| 174 | 开局第一帧渲染界面 | ★ 表现层用 `Query` 全量拉取 | 表现层读路径 |
| 175 | 读档 / 断线重连后重建画面 | ★ 同 174，之后转增量订阅 | 表现层读路径 |
| 176 | 渲染背包 / 血条 / 地图 | ★ `Query`（纯读） | 表现层读路径 |
| 177 | 画动作菜单与高亮 | ★ `queryActions` | 表现层读路径 |
| 178 | 视图 diff 与对象复用 | ★ id 整局稳定的约定 | 表现层读路径 |
| 179 | 「为什么这个选项是灰的」 | ★ `ActionDef.reason` Expr | 表现层读路径 |
| 180 | 表现层不可能弄坏状态 | ★ 表现层只能调 Action，不能碰 Op | 表现层读路径 |

**174 是原稿的一个真实漏洞**：第 16 章只写了"表现层订阅事件"，
但开局第一帧、读档、断线重连时**没有任何事件发生过**，仅靠订阅画不出界面。
补上"查询状态"与"枚举着法"两条只读通道后，表现层的三种需求（增量演出、
全量渲染、交互菜单）才各有出口。

**166–169 是一次高杠杆整合**：具名表达式最初只为解决可读性（避免复制粘贴 20 份谓词），
但它顺手解决了派生属性（否则要十几条回写 Hook，且必然漏一条）
与 MOD 扩展点（`overrides` 一个 expr 即可改公式）。**三个问题一个字段。**

### 14.7.6 NPC 策略、版本迁移、联机边界（181–200）★ 第十轮新增，零新结构

| # | 用例 | 表达方式 | 判定 |
|---|---|---|---|
| 181 | 僵尸扑向最近活体 | ★ `PolicyDef` mode:'rules' 对 queryActions 打分 | policy |
| 182 | 守卫巡逻 + 状态机 | ★ rules + props.state | policy |
| 183 | 宠物跟随主人 | ★ rules + `relIn('owner')` | policy |
| 184 | 格斗 / 卡牌 AI | ★ mode:'search' + evaluate + budget | policy |
| 185 | Boss 分阶段剧本 | ★ mode:'scripted' | policy |
| 186 | 教学关引导 NPC | ★ mode:'scripted' | policy |
| 187 | AI 超时不许卡死回合 | ★ `search.budget` + `fallback` | policy |
| 188 | 新增一个 Action，NPC 自动会用 | ★ rules 评分对象是 queryActions 输出 | policy |
| 189 | 老存档（v1.0）装新包（v1.1） | ★ `migrations` 链，事务内执行 | 迁移 |
| 190 | 新版给所有角色加一个属性 | ★ `forEach + prop.set` | 迁移 |
| 191 | 被删除的武器换成替代品 | ★ `forEach + entity.setDef` | 迁移 |
| 192 | 迁移失败不留半损坏存档 | ★ 事务回滚 + `onFail:'reject'` | 迁移 |
| 193 | 存档比玩法包还新 | ★ 一律 reject 并诊断 | 迁移 |
| 194 | 服务端否决非法着法 | ★ 服务端跑 `queryActions` | 联机 |
| 195 | 锁步同步不漂移 | ★ 命名流 + Hook 确定性排序 | 联机 |
| 196 | 防透视外挂 | ★ 按 `knowledgeScope` 下发状态 | 联机 |
| 197 | 暗牌不下发给对手 | ★ `Intent.hidden` | 联机 |
| 198 | 断线重连 | ★ snapshot + 表现层全量查询 | 联机 |
| 199 | 掉线托管 | ★ `Agent.kind='ai'` | 联机 |
| 200 | 增量同步 | ★ `journal` | 联机 |

**181–188 补的是一个真实空洞**：前九轮里 `Agent.policy`、`PlaypackDef.policies`
和六个用例都引用"AI policy"，却从未定义它的结构 —— 这是一处**引用悬空**，
比"缺功能"更危险，因为它看起来是完备的。

**188 是这一轮最好的复用证据**：`rules` 模式的评分对象是 `queryActions` 的输出，
因此创作者新增 Action 后，所有 NPC 自动会用，无需修改任何 AI。
`queryActions` 至此有五处复用：UI 菜单、AI 着法生成、网络校验、模糊测试、NPC 评分。

**194–200 全部落在"内核不做联机、但内核提供联机所需的全部保证"这条线上**（15.1）。
判断一项该不该进内核的标准始终是 0.2 的三条判据，
而"网络部署拓扑"违反第三条（不含语义）。

### 14.7.7 第十一轮：一处架构矛盾与八处语义定稿

这一轮不是靠"否定假设"扫出来的，而是靠**一致性核查**（18.1）——
方法转变本身就是收敛的证据：已经找不到缺失的机制，只找得到自相矛盾之处。

**P0（架构矛盾，已修）**：原稿同时主张
「`decision.open` 后立即提交事务」与「反应技在 `before:damage` 的 Hook 里 `decision.open`」。
两者不兼容 —— Hook 执行时 Op 正在未提交的事务中途。

修法不是让挂起更安全，而是**让"等待"在语法上不存在**（7.5 铁律）
+ **把反应技移到响应相位**（7.5.1）。后者反而更强：反应轮次从"靠 depth 兜底"
变成"相位表里的加载期常量"，静态可数，且 AI 搜索无需特殊处理。

**P2 八处语义定稿**：

| # | 争议 | 定稿 | 理由 |
|---|---|---|---|
| 1 | 代价何时扣 | 提交冻结、解算结算、**void 全额退回 + 诊断事件** | 非法即错误，错误必须撤销；能否合法在提交时无法预知 |
| 2 | 反应链上界 | `reactionRounds` 独立于 `depth` | `depth` 在提交边界重置，管不住跨相位往复 |
| 3 | 光环重算 | 拓扑变化必重算；属性依赖须 `deps` 显式声明 | 化动为静；未声明即不重算，保依赖集有界可分析 |
| 4 | 容器索引 | **一切容器恒有索引**，`ordered` 改为 `insert:'fixed'\|'shift'` | 无索引则无法稳定引用，也无法裁决 `instead` 竞争 |
| 5 | `stack.split` 失败 | **整体回滚到拆分之前** | 落地会凭空产出、吞掉会销毁资产；只有回滚守恒 |
| 6 | `instead` 竞争 | 按 `(priority, 容器索引, 槽位索引, defId)` 取第一个，**其余不使用** | 不死图腾优先用手上的；顺序是数据不是规则 |
| 7 | 同时结算 | **删除 `'simultaneous'`**，改为"同时提交、依序解算" | 回合制不存在真同时；伪概念会诱发时序悖论 |
| 8 | 双向一致性 | 容器/槽位/堆叠/代价四条写入 4.6 强不变量 | 与 relation 镜像同类，原稿漏了 |

**4 与 6 的联动值得单独看**：把索引变成无条件的，顺带让 `instead` 的竞争裁决
有了确定的排序键。若索引仍是可选的，"优先用手上的"就只能靠内核内建规则 ——
而那正是元机制要消灭的东西。**一个泛化解决两处硬编码。**

**P1（引用悬空，已补）**：`visibility`、`logRetention` 只在正文提过却不是
`PlaypackDef` 字段；`w:0`（world 的 Id）缺失导致 `attach.add(world, mod)` 无从表达；
`intent.*` 与 `outcome.reach` 四个 Op 缺失；`reactionRounds` 不在 `PhaseDef` 里。
连同前两轮的 `PolicyDef`、`RuleDef`、`ContainerSpec`/`SlotSpec`/`PropSchema`，
**引用悬空累计 11 处** —— 这类缺陷的危险在于文档读起来是完备的。

### 关于 152

「可见但不可达」看起来需要第二套拓扑，实际上
`Link.tags` + `dist(via:)` 早已支持 —— 同一批节点上可以叠任意多种关系边
（视线、可达、声音、气味），每种用 tag 区分，用 `via` 筛选。
**这是第 2 章的 `via` 参数在设计时未预见到的复用**，属于"泛化的红利"。

**关于批量 Op（缩圈同时给 100 个节点挂 attachment）**：
经核算这**不是完备性缺口**。`forEach + attach.add` 在事务内完全可表达，
原子性由 tx 保证，step 预算（10⁴）远大于实际规模，journal 逐条记录反而是回放所必需的。
若将来出现性能问题，那是**实现层的批处理优化**，不是内核需要新原语。
诚实结论比多加一个 `bulk` 原语更有价值 —— 后者会诱导创作者以为有两种写法。

---

### 14.8 回补原语清单（首轮不可表达 → 已并入设计）

| 回补 | 触发用例 | 若无此项的后果 | 性质 |
|---|---|---|---|
| 1. `entity.setDef` + carry | 26, 27 | 变身只能销毁重建，丢失关系/记忆/容器引用 | 泛化 |
| 2. 结构 Op 可被 Hook 否决 | 42, 57, 92 | 负重、堵门、容量必须内核内建，每种都是硬编码 | 泛化 |
| 3. Entity 多命名容器 | 47, 49 | 后备箱、枪配件位要么塞进主背包，要么新建模块 | 泛化 |
| 4. `ordered` 容器 + `shuffle` | 50 | 卡牌类玩法完全无法表达 | 泛化 |
| 5. 加权拓扑 `weight` + `dist` | 60, 61 | 距离范式（大场景×2）必须硬编码进内核 | 泛化 |
| 6. `spread` 返回 `from`（来向） | 67, 68 | 声音/气味/爆炸各写一套；NPC 只知有声不知方向 | 泛化 |
| 7. `PlaypackDef.evaluate` | 74 | AI 估值必须写代码，换玩法就换 AI | 归位 |
| 8. **`Decision` 一等状态对象** | 86–95 | 交易要协议模块、反应技要响应栈模块，且都无法存档 | **新原语** |
| 9. `slot.add` 动态槽位 | 34, 35 | 背包格数被内核写死，拓展/钱袋/装备槽都要改代码 | 泛化 |
| 10. `Relation` 独立于 props | 70–73, 82 | 反向查询（谁在操控我）与级联清理只能逐机制手写 | 归位 |
| 11. `Attachment.target` 泛化到 Node/Link | 62, 63 | 地面着火、门被加固需要另一套"环境状态"结构 | 泛化 |
| 12. `Attachment.grantedBy` | 光环 | 光环失效时的清理只能全表扫描，且易漏 | 泛化 |
| 13. `Attachment.target = World` | 96–99 | 运行期改规则不可能，roguelike/卡牌场地效果要改代码 | 泛化 |
| 14. **`prefab.spawn/despawn`** | 102–105 | 副本、程序化地图、载具内部要么手写连边要么写生成器代码 | **新原语** |
| 15. `TargetSpec.range` / `count` | 106–109 | 数值型选择只能穷举 Action，或改 UI 代码 | 泛化 |
| 16. **`Agent`（决策者=观察者）** | 111–120 | 接管/掉线/GM/共享视野/AI难度各写一套，且"作弊"要开关 | **归位** |
| 17. `node.merge` / `node.split` | 121–124 | 炸墙合并房间会丢边、丢记忆、丢子微场景 | 泛化 |
| 18. **`Intent`（提交≠解算）** | 126–133 | 同时结算、暗押、指令队列各需专用模块，且都无法存档 | **新原语** |
| 19. `facts` 值域从布尔泛化到 Value | 134–139 | 错误信息、过时记忆、记忆衰减全部无法表达 | 泛化 |
| 20. `requires`/`conflicts`/`overrides` | 140–145 | MOD 叠加冲突只能运行期崩溃，二创社群无法协作 | 泛化 |
| 21. `Query.from:'log'`（有界历史） | 154–158 | 每个涉及"过去"的机制都要手动往 props 镜像 | 泛化 |
| 22. `outcomes[]` 取代 `winCondition` | 159–165 | 淘汰≠结束、分阵营胜利、排名、多结局全无法表达 | 泛化 |
| 23. `kind:'expr'` 具名表达式 | 166–169 | 谓词复制 20 份、派生属性要十几条回写 Hook、MOD 无扩展点 | 泛化 |
| 24. 表现层的查询与枚举通道 | 174–180 | **开局第一帧画不出界面**（只订阅事件，而此时无事件） | 泛化 |
| 25. `ActionDef.reason` | 179 | 灰显选项无法告诉玩家原因，只能写死在 UI 代码里 | 泛化 |
| 26. **`PolicyDef`（补引用悬空）** | 181–188 | 六个用例引用它却无定义；NPC 逻辑将成为第一处必须写代码之处 | **补洞** |
| 27. `version` + `migrations` | 189–193 | UGC 作者每次迭代都要为老存档写迁移代码 | 泛化 |
| 28. **响应相位取代 Hook 内提问** | 88, 89, 92 | **原方案与事务架构直接冲突，无解** | **修矛盾** |
| 29. `RuleDef`（补引用悬空） | 全部 Hook 用例 | `Def.rules` 引用它却无定义 | 补洞 |
| 30. 容器索引无条件化 + `insert` | 4, 6 | 无索引则无法稳定引用，`instead` 竞争无法裁决 | 泛化 |
| 31. 代价冻结/结算/退回三态 | 1 | 要么白扣 AP，要么一点 AP 提交五个动作 | 泛化 |
| 32. `w:0` 与 Id 前缀封闭集 | 96–99 | `attach.add(world, mod)` 无从表达 | 补洞 |
| 33. **诊断体系（§13.1–13.8）** | 全部 | 创作者只能靠瞎改参数试错 → 零代码承诺在体验上破产 | **归位** |

**关键观察**：27 项里 24 项是**泛化、归位或补洞**，只有 `Decision` / `prefab` / `Intent`
三个新结构，且都不含玩法语义（内核不知道"交易"是什么，不知道生成的是地牢还是房车，
不知道"出招"是什么）。三者吃掉的用例数：10 + 4 + 8 = 22。

最值得记住的一项是 16（`Agent`）：它**没有新增任何能力**，
只是把两个已经存在的半概念（`knowledge` 的 observerId、`relation('control')`）
拼成一个完整概念，就顺手吃掉 10 个用例，其中包括看起来最该单独建模的 GM 模式。
**归位比新增更强。**

泛化的统一形态，值得单独看一眼：

```
owner        Entity          → 任意 Ref        （微场景的三种创造者）
attachment   Entity          → Entity/Item/Node/Link/World（环境状态 + 运行期规则）
container    无序            → 可有序          （牌堆）
拓扑          无权            → 加权            （距离范式）
Hook         属性事件         → 结构事件        （负重/堵门/容量）
slot         固定            → 运行期增删       （拓展背包）
target       单个 Ref        → Ref/数值区间/多选（押注、弃牌）
```

七条泛化都是**同一种动作**：把一个被写死的维度打开成数据。
这正是"做整合，不做加法"的形态 —— 也说明"元机制"的可操作定义是：
**找出内核里每一处被固定的假设，把它变成玩法包可填的字段。**

反例对照 —— 如果按第一版思路做，同样这 200 个用例会产出：
ShopSystem、QuestSystem、AchievementSystem、DialogueSystem、CraftSystem、TradeSystem、
CardSystem、StealthSystem、SummonSystem、TransformSystem、ReactionSystem、DungeonSystem、
ModifierSystem、CoopSystem、SpectatorSystem、GMSystem、LobbySystem、CombatLogSystem、
ScoreSystem、MigrationSystem、NetSystem… 二十余个互不复用的模块，
且第 201 个用例仍然要加第 22 个模块。**这就是"完备"与"够用"的区别。**

### 14.9 本轮推演的方法论记录

第四轮之所以还能挖出一个新原语，用的不是"再想想还缺什么功能"，而是
**质疑用例表本身的隐含前提**。前 85 例共享一条未被说出的假设："决策是单人的、即时的。"
一旦把这条假设写出来并否定它，10 个用例同时涌现，且指向同一个缺口。

这条方法论要留给后续审查：**下一轮不要去找缺失的机制，去找没被说出的假设。**

第五轮沿用同一方法，把上一轮列出的三条待验假设逐条否定，结果：

| 隐含假设 | 否定它挖出什么 | 结论 |
|---|---|---|
| 一个 Entity 只有一个控制者 | 共同操控、夺取控制权 | `relation('control')` 本就可多重，已覆盖 |
| 时间只前进，rewind 是调试功能 | 时间悖论玩法 | 属第四圈，明确不做（第 15 章） |
| **玩法包运行期不变** | roguelike 增益、场地效果、赛季 | ★ 补 `attach.add(world)`（96–99） |
| **一个世界只有一份拓扑** | 平行世界、副本、载具内部 | 不连通分量已覆盖；但缺 ★ `prefab`（100–105） |
| **目标总是一个对象引用** | 给多少钱、押多少注、弃几张牌 | ★ 补 `range`/`count`（106–109） |
| 观察者是玩家或 AI | 事后视角、上帝视角调试器 | knowledge 泛化已覆盖 |
| 决策是单人的、即时的 | 交易、反应技、投票（第四轮） | ★ 已补 `Decision`（86–95） |

第六轮结果（五条全部走完）：

| 隐含假设 | 否定它挖出什么 | 结论 |
|---|---|---|
| 一个 Op 只改一个对象 | 缩圈同时改 100 节点 | **不是缺口**，forEach+tx 已足够，见 14.7.2 末 |
| 事件是瞬时的 | "正在被电流通过" | 已覆盖：那是 attachment，不是事件 |
| **玩家数固定** | 加入/接管/观战转参战 | ★ 补 `Agent`（111–117） |
| **所有行动者平权** | GM、导演、调试器 | ★ 同上，`Agent` 一并覆盖（118–120） |
| **拓扑只增删边** | 炸墙合并房间 | ★ 补 `node.merge/split`（121–124） |

第七轮结果（五条全部走完）：

| 隐含假设 | 否定它挖出什么 | 结论 |
|---|---|---|
| Def 继承是单向静态树 | 混入热插拔 | **不是缺口**：`attach.add` 的 rules 已等价，且保住静态可分析 |
| Op 只由行动者或规则触发 | 生态/经济自运行 | 已覆盖：phase 的 `onEnter` 无需 actor 输入 |
| **一次只解算一个动作** | 格斗对拼、暗押、指令队列 | ★ 补 `Intent`（126–133） |
| **认知只有知道/不知道** | 错误信息、过时记忆、衰减 | ★ `facts` 值域泛化到 Value（134–139） |
| **玩法包是单一整体** | MOD 叠加、依赖、冲突 | ★ 补 `requires/conflicts/overrides`（140–145） |

**收敛趋势**（新增**结构**数，不是用例数）：

```
第四轮  1 个新结构（Decision）    + 6 项泛化   用例 +10
第五轮  1 个新结构（prefab）      + 2 项泛化   用例 +15
第六轮  0 个新结构（Agent 归位）  + 1 项泛化   用例 +15
第七轮  1 个新结构（Intent）      + 2 项泛化   用例 +20
```

第七轮又出一个新结构，说明当时**尚未收敛**。但 `Intent` 与 `Decision` 高度同构，
提示了一个更强的判据：**凡"状态与时间错位"的机制（还没决定 / 决定了还没生效 /
生效了还没结束），都应做成一等状态对象而非控制流。**

第八轮沿这条线主动验证，结论是**这条线已封闭**：三种错位分别由
`Decision`（还没决定）、`Intent`（决定了还没生效）、`Attachment`（生效了还没结束）承担，
而持续动作（146–149，施法 3 回合、搬运被打断）确认属于第三种，无需第四个结构。

第八轮结果（五条全部走完）：

| 隐含假设 | 否定它挖出什么 | 结论 |
|---|---|---|
| Action 效果在一个事务内完成 | 施法 3 回合、搬运被打断 | 已覆盖：attachment（第三种时间错位） |
| 资源池是数值 | 一手牌、一组棋子 | 已覆盖：那是 `ordered` 容器 + `CostSpec.items`，不是 pool |
| 拓扑关系只有邻接与包含 | 可见但不可达 | 已覆盖：`Link.tags` + `dist(via:)`，同节点叠多种关系边 |
| **Query 只查当前状态** | 战斗日志、复仇、重复上一动作 | ★ 补 `from:'log'`（154–158） |
| **一个玩法包一个胜负条件** | 淘汰≠结束、分阵营胜利、排名 | ★ `outcomes[]` 取代 `winCondition`（159–165） |

**收敛曲线**（新增**结构**数）：

```
第四轮  1 个新结构（Decision）    + 6 项泛化   用例 +10
第五轮  1 个新结构（prefab）      + 2 项泛化   用例 +15
第六轮  0 个新结构（Agent 归位）  + 1 项泛化   用例 +15
第七轮  1 个新结构（Intent）      + 2 项泛化   用例 +20
第八轮  0 个新结构                + 2 项泛化   用例 +20
```

第八轮**五条假设里三条确认无需改动**，且两处泛化都只是给已有字段加维度
（Query 多一个 from、winCondition 变数组）。这是**收敛的第一个明确信号**：
新增用例仍在增长，但内核的结构数不再增长。

第九轮结果（五条全部走完）：

| 隐含假设 | 否定它挖出什么 | 结论 |
|---|---|---|
| 一个 Def 只属于一个 kind | 又是物品又是容器又能变实体 | 已覆盖：Item 可有 containers + `promote` |
| Hook 只响应事件 | 血量不超上限、点数总和约束 | 已覆盖：`clamp` + `accepts` + before veto |
| **Expr 无抽象手段** | 20 份复制粘贴、派生属性、MOD 扩展点 | ★ 补 `kind:'expr'`（166–169） |
| **表现层只订阅事件** | **开局第一帧画不出界面** | ★ 补查询与枚举两条只读通道（174–180） |
| 内核错误只给创作者看 | 灰显原因给玩家看 | ★ 补 `ActionDef.reason`（179） |

**第九轮挖出了本轮最严重的一个漏洞**：第 16 章原本只写"表现层订阅事件"，
而开局、读档、重连时没有任何历史事件，仅凭订阅**根本画不出界面**。
这个漏洞不是靠"想还缺什么功能"发现的，是靠否定"表现层只需要增量"这条假设发现的。

**收敛曲线**（新增**结构**数）：

```
第四轮  1 个新结构（Decision）    + 6 项泛化   用例 +10
第五轮  1 个新结构（prefab）      + 2 项泛化   用例 +15
第六轮  0 个新结构（Agent 归位）  + 1 项泛化   用例 +15
第七轮  1 个新结构（Intent）      + 2 项泛化   用例 +20
第八轮  0 个新结构                + 2 项泛化   用例 +20
第九轮  0 个新结构                + 3 项泛化   用例 +15
```

**连续两轮零新结构**，且第九轮的三项泛化全部是"给已有结构加字段"
（Expr 加一种形式、第 16 章加两条通道、ActionDef 加一个字段），
无一需要改动第 1–4 章的状态模型。**这是收敛的第二个信号，也是更强的那个** ——
状态模型（第 1、2、4 章）自第五轮起未再变动。

第十轮结果（五条全部走完）：

| 隐含假设 | 否定它挖出什么 | 结论 |
|---|---|---|
| 所有随机都在解算时发生 | 地图种子 vs 战斗随机 | 已覆盖：命名流天然分离 |
| **玩法包由一个作者一次写成** | 老存档遇上新版本 | ★ 补 `version` + `migrations`（189–193） |
| **Agent 决策是即时的** | AI 思考预算、不许卡死回合 | ★ 补 `PolicyDef`（含 budget/fallback，181–188） |
| 内核只跑在一台机器上 | 权威服务器、反外挂 | **不是缺口**：见 15.1，内核已提供全部必要保证 |
| 玩法包定稿后不变 | 对局中热换规则 | 已覆盖 + 明确划界：`attach.add(world)` 可以，换 Def 不行 |

第十轮最有价值的产出不是新能力，而是发现了一处**引用悬空**：
`PolicyDef` 被 `Agent.policy`、`PlaypackDef.policies` 和六个用例引用，却从未定义。
这类缺陷比"缺功能"更危险 —— 文档读起来是完备的，实现时才发现无从下手。
**定稿前必须对所有类型名做一次引用闭合检查**（见 18.1）。

**收敛曲线**（新增**结构**数）：

```
第四轮  1 个新结构（Decision）    + 6 项泛化   用例 +10
第五轮  1 个新结构（prefab）      + 2 项泛化   用例 +15
第六轮  0 个新结构（Agent 归位）  + 1 项泛化   用例 +15
第七轮  1 个新结构（Intent）      + 2 项泛化   用例 +20
第八轮  0 个新结构                + 2 项泛化   用例 +20
第九轮  0 个新结构                + 3 项泛化   用例 +15
第十轮  0 个新结构（PolicyDef 是补洞）+ 1 项泛化  用例 +20
```

**连续三轮零新结构**，第 1–4 章的状态模型自第五轮起未再变动，
第十轮的五条假设里两条确认无需改动、一条是补已有引用的洞。

判定：**设计空间已收敛**。剩余风险不再是"想漏了某类机制"，
而是"文档内部的引用一致性"与"实现时的性能"——前者由 18.1 的检查清单兜住，
后者属于工程规范阶段。

第十一轮起不再按"否定假设"扫描（收益已趋零），改为**定稿前的一致性核查**（18.1）。

---

## 15. 明确不支持的边界

诚实划界比假装完备更重要。以下**不在**内核职责内：

| 不支持 | 原因 | 替代 |
|---|---|---|
| 连续空间 / 物理引擎 | 拓扑是图，不是坐标系 | 图 + 加权距离 |
| 真实时（毫秒级） | 相位驱动 | phase.timeLimit 逼近 |
| 图灵完备脚本 | 故意放弃，换取"不挂死"的机械保证 | 多条小规则组合 |
| 自定义算法（寻路/搜索的实现） | 属于第四圈，需改代码 | 内核提供 BFS/加权最短路/αβ 骨架 |
| 前端表现的完备性 | 表现层是对象化的，与过程式逻辑天然割裂 | 见第 16 章 |
| 任意 SQL 式联表查询 | 性能与可分析性 | Query 的固定维度 |
| **网络部署拓扑** | 属运行环境，非状态机职责 | 见 15.1，内核提供全部必要保证 |
| **对局中热换玩法包** | 会摧毁静态可分析性 | 装载期迁移（12.1）+ 运行期 `attach.add(world)` |

### 15.1 关于联机：内核给什么，不给什么

这条值得单独写，因为很容易误判为缺口。

**内核不提供**：服务器、客户端预测、回滚网络码、匹配、反外挂系统。

**内核提供的，恰好是实现它们所必需的全部保证**：

| 联机需求 | 内核已有的保证 |
|---|---|
| 权威校验 | `queryActions` 在服务端跑一遍即可否决非法着法（7.2 的第三处复用） |
| 锁步同步 | 确定性：命名随机流 + Hook 确定性排序 + 稳定迭代序（第 13 章） |
| 状态同步 | `journal` 传增量，`snapshot` 传全量 |
| 防止透视外挂 | `Agent.knowledgeScope`：服务端只下发该 scope 可见的状态 |
| 暗牌 / 同时出招 | `Intent.hidden`（7.6）—— 服务端持有，客户端看不到 |
| 断线重连 | `snapshot` + 表现层全量查询（第 16 章） |
| 掉线托管 | `Agent.kind` 改 `'ai'`（1.3.1.1） |

**结论**：联机不是内核的缺口，而是内核之上的一层部署选择。
把它写进内核会引入网络语义，违反 0.2 的"不含语义"判据。

第四圈（自定义算法、原生解谜引擎）**明确需要写代码**。在二创社群达到足够规模前不做。

---

## 16. 与表现层的边界（为什么这里必须做加法）

逻辑层是过程式的：`item.move` 就是一次状态跃迁。
表现层是对象式的：需要一个持续存在、可被补间的 sprite 对象。

内核不试图弥合这个鸿沟，它给表现层**三条只读通道**（第九轮补全 —— 原稿只写了第一条，
而只有订阅是画不出界面的：进游戏第一帧没有任何事件发生过）：

| 通道 | 用途 | 接口 |
|---|---|---|
| **订阅事件** | 演出增量：谁动了、谁受伤了 | `after:*` Hook |
| **查询状态** | 渲染当前画面：背包里有什么、血条多少 | `Query` / `Expr`（纯读，无副作用） |
| **枚举着法** | 画菜单、画高亮、画灰显原因 | `queryActions(agent)` |

```
after:item.move  → 表现层调 AnimTools.playPickup(entity, item)
after:damage     → 表现层调 UITools.showDamageNumber + EffectTools.shake
after:entity.place → 表现层调 AnimTools.playMove（程序化跳跃位移，D-025 命名）
开局/读档/重连   → 表现层用 Query 全量拉一次，之后转增量订阅
```

两条配套约定：

- **id 稳定**：Entity/Item 的 id 在整局内不变（这也是 `entity.setDef` 保留 id 的另一个理由），
  表现层可据此做视图 diff 与对象复用
- **表现层永不写状态**：它只能调 Action（走 `queryActions` 校验），不能碰 Op。
  于是"UI 能点但服务器拒绝"与"表现层偷偷改状态导致回放不一致"两类 bug 被结构性消灭

因此表现层的设计原则与内核**相反**：

| | 内核 | 表现层 |
|---|---|---|
| 目标 | 完备、封闭、一次做对 | 够用、开放、逐步扩充 |
| 度量 | 无代码可表达任意玩法 | 工具是否打通 |
| 新增 | 只泛化，不加模块 | 允许持续加工具 |

表现层工具箱详见 [09_动画与表现设计.md](docs/09_动画与表现设计.md)。

---

## 17. 与既有文档的关系

```
本 Spec（内核 / 元机制）
    ├── 05_底层引擎架构_v2   → 收敛为本 Spec 的具体数据结构落地
    ├── 02_游戏机制系统_v2   → 降级为"大逃杀玩法包"，是内核的一份数据
    ├── 03/04（空间/物品）   → 降级为玩法包内容 + 内核能力的用例说明
    ├── 07_AI 系统           → 保留 policy 与守卫范式，搜索骨架归内核
    ├── 06_UGC 系统          → 本 Spec 就是 UGC 的语法参考手册
    └── 11_测试与质量保证    → 验收本 Spec 第 13 章的每条保证
```

**关键重定位**：02 里所有内容（AP、1 AP 铁律、倒地双态、防具三档、投点、缩圈）
**全部是玩法包数据**，开发者可以整套换掉。内核对它们一无所知。

这也意味着 12/13 两份早期审查文档已被本 Spec 取代。

---

## 18. 实现顺序

内核必须一次做完（第 1 章的推演前提要求它封闭），但内部有依赖序：

```
1  State + Ref + Def 继承 + 不变量 + 事务
2  Expr + Query（全函数、有界）
3  Ops 全集 + Journal + 逆操作 + Relation + prefab.spawn/despawn
4  Events + 五阶段 Hook + cause 链 + 连锁上限
5  Flow（含 step 预算）
6  Actions + queryActions + Cost 泛化 + range/count 两种展开粒度
7  Decision + Intent（依赖 6：两者都要能进 queryActions）
8  Attachments（含 aura、delay、stack 策略、grantedBy 回收）
9  Schedule + 定时器 + Playpack 装载（含 requires/conflicts/overrides）+ Policy
10 Random 命名流 + 影子流
11 Knowledge（facts 为任意 Value）+ visibleTo + Agent
12 Persistence（snapshot/replay/rewind/checkpoint/migrations）
13 Safety（Linter + 配额 + 诊断 + 有界 log）
```

注：Expr 的具名表达式（3.1.1）属第 2 层；`outcomes` 属第 8 层；
表现层的三条只读通道（第 16 章）不占实现层级 —— 它们是既有能力的对外暴露。

每层完成即用属性测试锁死不变量，再进下一层。第 12 层完成时 AI 搜索能力自动获得。

### 18.1 定稿前的一致性核查清单

第十轮暴露了 `PolicyDef` 的引用悬空，说明**设计稿的主要剩余风险已从"想漏机制"
转为"文档内部不自洽"**。转入正式工程规范前，必须机械地走完以下检查：

| 检查 | 方法 | 状态 |
|---|---|---|
| **类型引用闭合** | 每个被引用的类型名都有定义 | ✅ 已修 11 处（见下） |
| **原语命名一致** | 同一能力在各章用同一个名字 | ✅ `spread`、`outcomes` 已统一 |
| **回补项有定义** | 14.8 每一项都能在第 1–13 章找到落点 | ✅ 32 项已逐条核对 |
| **Op 全集闭合** | 结构区每个字段都有写入 Op | ✅ 已补 `intent.*` ×4、`outcome.reach` |
| **不变量覆盖** | 每个结构在 4.6 有对应不变量 | ✅ 全结构覆盖（含 Decision 三条：有终/答案合法/完成充分） |
| **无孤立字段** | 每个字段至少被一条用例用到 | ✅ 已扫；`activeAt` 语义已澄清 |
| **架构自洽** | 各章主张之间无冲突 | ✅ P0（Decision×事务）已解决 |
| 逐条前后置条件 | 每个 Op 的 pre/post/错误码 | ⏳ **属工程规范阶段** |
| 序列化格式与并发模型 | 快照编码、多线程边界 | ⏳ **属工程规范阶段** |

**已修的 11 处引用悬空**（按发现顺序）：
`Entity` / `Item` / `relations` 无定义 → `PolicyDef` → `RuleDef` →
`ContainerDef`+`SlotDef`+`TypeHint`（改为 `ContainerSpec`/`SlotSpec`/`PropSchema`）→
`visibility` / `logRetention` 不在 `PlaypackDef` → `w:0` 缺失 →
`intent.*` / `outcome.reach` 缺失 → `reactionRounds` 不在 `PhaseDef`。

**教训写在这里给工程阶段**：这类缺陷全部由"字段被正文引用但结构里没有"构成，
而正文读起来完全通顺。**光靠通读发现不了，必须机械对照。**
工程规范阶段应把这项检查自动化（从类型定义提取符号表，与正文引用做差集）。

**验收标准**：用内核 + 一份纯数据玩法包跑通第 14 章全部 200 个用例，
且模糊测试在 10⁷ 次随机 Op 序列后不变量零违反、零异常抛出、零挂死、
零永久待答决策、零永久未解算 Intent。

---

## 19. 缺陷与遗留声明

**本节是定稿的一部分，不是免责声明。** 一份声称"完备"的根基文档若不列出自己的已知边界，
工程阶段会把沉默当作"已解决"。以下逐项声明。

### 19.1 设计过程中修掉的缺陷（留档，防止回归）

| 类别 | 数量 | 性质 |
|---|---|---|
| 架构矛盾 | 1 | `Decision` 与事务冲突（P0）→ 改为响应相位（7.5.1） |
| 引用悬空 | **12** | 见 18.1 清单，最后一处是 `ErrCode`（本轮补 13.4） |
| 语义欠定 | 8 | 见 14.7.7 表 |
| 伪概念删除 | 1 | `order:'simultaneous'`（9.0） |
| 设计错误 | 2 | `ordered` 应为无条件索引（2.3.1）；反应技不应在 Hook 里提问 |

**引用悬空 12 处是本次设计最值得警惕的数字。** 它们的共同特征是
"字段被正文引用但结构里没有，而正文读起来完全通顺"。
三次机械对照各挖出一批，说明**通读无法发现这类缺陷**。

### 19.2 明确不在本稿范围（属工程规范阶段）

| 项 | 为什么不在设计稿里 |
|---|---|
| 逐条前后置条件 | 需先冻结类型，属规范文体 |
| 序列化格式 | 涉及版本兼容与体积权衡，独立议题 |
| 并发模型与线程边界 | 内核是单线程状态机；多线程只出现在 AI 搜索与表现层 |
| 性能量级与复杂度上界 | 需实测；已知热点：`aura` 重算、`spread`、`queryActions` 展开 |
| 内存与快照体积上界 | 与 `logRetention`、配额联动，需实测定值 |
| 错误码的具体文案 | 13.8 已规定需求与模板机制，文案属实现 |

### 19.3 已知风险（设计上接受，但工程阶段必须验证）

| 风险 | 位置 | 缓解 | 残余 |
|---|---|---|---|
| `queryActions` 在含 `range` 时着法空间爆炸 | 7.1 | AI 模式只采样 step 网格 | 采样粒度会影响 AI 强度，需调参 |
| `aura` 重算频率 | 8.1 | `deps` 显式声明 + 拓扑触发 | 大量光环 × 频繁移动仍可能是热点 |
| `spread` 在高连通图上的代价 | 2.5 | `budget` 截断 | 需实测确认 budget 缺省值合理 |
| 事件连锁 depth 32 是否够用 | 6.5 | 可配置 | 复杂 MOD 叠加可能触顶 |
| `prefab.spawn` 的 id 重映射规模 | 2.1.1 | 单事务内完成 | 大型副本可能超 step 预算 |
| 100+ NPC 的 policy 求值 | 9.3 | `budget` + `fallback` | 需实测每相位总预算 |

### 19.4 明确的能力边界（第 15 章的汇总，非缺陷）

连续空间、物理模拟、真实时、图灵完备脚本、自定义算法（第四圈）、
网络部署拓扑、对局中热换玩法包、任意联表查询。**这些是设计选择，不是遗漏。**

### 19.5 未做的验证

诚实列出**尚未做**的事，避免工程阶段误以为已完成：

- 200 条用例**没有一条被写成可执行测试** —— 目前全部是文档级论证
- 没有写过任何一份真实玩法包数据来端到端验证"零代码"承诺
- 没有做过性能建模或原型实测
- 03/04 等既有文档尚未按本稿重新校订（§17 只声明了关系，未逐条对齐）
- 表现层工具箱（第 16 章只定了边界与三条只读通道）未展开

**其中第一、二项是最大的未验证项。** 文档级论证能证明"设计上可表达"，
但只有真正写出一份玩法包数据、跑通用例，才能证明"创作者写得出来且写得不痛苦"。
建议工程阶段的第一个里程碑就是**用纯数据实现 02 大逃杀的最小可玩子集**，
而不是先把内核 13 层全实现完。

---

**文档状态**：**设计稿已定稿**，可进入工程规范阶段。
十二轮推演，200 用例，33 项回补，其中仅 3 项新结构（Decision / prefab / Intent）。
第八至十轮连续零新结构；第十一轮转为一致性核查（修 1 处架构矛盾、8 处语义欠定）；
第十二轮补全诊断体系（§13.1–13.8）并声明全部已知缺陷与遗留（§19）。

**18.1 的设计层检查已全部通过，缺陷已在 §19 逐项声明。**

**给工程阶段的四条要求**：
1. 把"引用闭合检查"自动化（符号表 vs 正文引用做差集）—— 12 处悬空全靠人工机械对照才发现，通读发现不了
2. §13.8 的七条诊断需求逐条落实，其中"无测试用例的错误码不允许存在"是硬门槛
3. §13 的每条保证都要有对应属性测试；"堆叠守恒"与"代价守恒"是刷物品/刷 AP 的直接防线
4. **第一个里程碑不是实现完 13 层，而是用纯数据写出 02 的最小可玩子集** —— 这是"零代码"承诺唯一的真实检验（§19.5）

**取代**：12_根基完备性审查.md、12_根基完备性审查_v2.md、13_底层API完备性设计.md
**最后更新**：2026-08-02


# 底层 API 完备性设计 Spec

> **设计目标**：定义一套完备的底层 API，使得任何 RPG 逻辑（去除画面）都能用配置实现，无需代码。
> 
> **验证标准**：所有能想到的 RPG 用例，都能用这些 API 组合实现。
> 
> **设计原则**：
> - 模块化思维（网关而非商店，容器而非背包）
> - 正交性（每个 API 做一件事）
> - 组合性（复杂逻辑由简单 API 组合）
> - 完备性（覆盖所有数据操作）

---

## 设计方法论

### 能力域分解

将游戏引擎的能力分解为 8 个正交的域：

1. **数据存储与访问**：读写任意属性
2. **容器与转移**：物品/实体的容纳与移动
3. **关系与图**：实体间的连接与查询
4. **规则与逻辑**：条件判断与控制流
5. **计算与表达式**：数值计算与逻辑运算
6. **查询与过滤**：查找满足条件的数据
7. **实体生命周期**：创建/销毁/克隆/转换
8. **时序与调度**：延迟/定时/优先级

每个域提供完备的 CRUD+ 操作（Create, Read, Update, Delete, Query, Transform）。

---

## 第一部分：核心 API 设计

### 域 1：数据存储与访问

#### API 1.1：读取属性

```typescript
get_property(target: Reference, path: string): any

// 示例
get_property("player", "properties.gold")           → 100
get_property("entity:123", "components.LivingStats.hp") → 5
get_property("node:room_a", "properties.temperature")   → 25
```

**路径语法**：
- `properties.x` - 自定义属性
- `components.ComponentName.field` - 组件字段
- `inventory.items` - 容器内容
- `relations.ally` - 关系列表

**Reference 语法**：
- `"player"` - 当前玩家
- `"this"` - 当前实体
- `"entity:123"` - 实体 ID
- `"{{variable}}"` - 变量引用

---

#### API 1.2：设置属性

```typescript
set_property(target: Reference, path: string, value: any): void

// 示例
set_property("player", "properties.gold", 100)
set_property("entity:123", "properties.custom_data", { key: "value" })
set_property("node:room_a", "properties.locked", true)
```

**特性**：
- 如果路径不存在，自动创建
- 支持嵌套对象
- 支持数组

---

#### API 1.3：修改属性（运算）

```typescript
modify_property(target: Reference, path: string, op: string, value: any): void

// 示例
modify_property("player", "properties.gold", "+", 50)   // += 50
modify_property("player", "properties.gold", "*", 1.5)  // *= 1.5
modify_property("player", "properties.hp", "-", 2)      // -= 2
```

**支持的运算符**：
- 数值：`+`, `-`, `*`, `/`, `%`, `min`, `max`
- 数组：`push`, `pop`, `remove`, `concat`
- 集合：`add`, `delete`

---

#### API 1.4：删除属性

```typescript
delete_property(target: Reference, path: string): void

// 示例
delete_property("player", "properties.temp_buff")
```

---

#### API 1.5：检查属性存在

```typescript
has_property(target: Reference, path: string): boolean

// 示例
has_property("player", "properties.gold") → true
has_property("player", "properties.nonexistent") → false
```

---

### 域 2：容器与转移

#### API 2.1：添加到容器

```typescript
container_add(container: Reference, item: Reference, slot?: string): boolean

// 示例
container_add("player.inventory", "item:sword")           // 添加到任意空槽
container_add("player.inventory", "item:helmet", "head")  // 添加到指定槽位
```

**返回值**：成功 true，失败（无空间/不接受）false

---

#### API 2.2：从容器移除

```typescript
container_remove(container: Reference, item: Reference): boolean

// 示例
container_remove("player.inventory", "item:sword")
```

---

#### API 2.3：容器间转移

```typescript
container_transfer(from: Reference, to: Reference, item: Reference, slot?: string): boolean

// 示例
container_transfer("shop.inventory", "player.inventory", "item:sword")
container_transfer("player.inventory", "chest.inventory", "item:gold", "storage")
```

---

#### API 2.4：查询容器内容

```typescript
container_query(container: Reference, filter?: ItemFilter): ItemReference[]

// 示例
container_query("player.inventory")                        // 所有物品
container_query("player.inventory", { tags: ["weapon"] })  // 只查武器
container_query("player.inventory", { type: "gold" })      // 只查金币
```

---

#### API 2.5：统计物品数量

```typescript
container_count(container: Reference, filter?: ItemFilter): number

// 示例
container_count("player.inventory", { type: "gold" })  → 100
```

---

#### API 2.6：检查容器空间

```typescript
container_has_space(container: Reference, item: Reference): boolean

// 示例
container_has_space("player.inventory", "item:sword")  → true/false
```

---

#### API 2.7：堆叠物品操作

```typescript
stack_split(item: Reference, count: number): ItemReference
stack_merge(itemA: Reference, itemB: Reference): boolean

// 示例
stack_split("item:gold_stack", 50)  → "item:gold_stack_new" (50 个)
stack_merge("item:gold_a", "item:gold_b")  // 合并两堆金币
```

---

### 域 3：关系与图

#### API 3.1：建立关系

```typescript
set_relation(from: Reference, to: Reference, relation_type: string, metadata?: any): void

// 示例
set_relation("player", "npc_a", "ally")
set_relation("player", "npc_b", "quest_giver", { quest_id: "q1" })
set_relation("player", "npc_c", "merchant", { discount: 0.1 })
```

---

#### API 3.2：查询关系

```typescript
get_relation(from: Reference, to: Reference): string | null

// 示例
get_relation("player", "npc_a")  → "ally"
get_relation("player", "enemy")  → "hostile"
```

---

#### API 3.3：查找相关实体

```typescript
find_related(from: Reference, relation_type: string): Reference[]

// 示例
find_related("player", "ally")         → ["npc_a", "npc_b"]
find_related("player", "quest_giver")  → ["npc_c"]
```

---

#### API 3.4：删除关系

```typescript
remove_relation(from: Reference, to: Reference): void

// 示例
remove_relation("player", "npc_a")
```

---

#### API 3.5：获取关系元数据

```typescript
get_relation_metadata(from: Reference, to: Reference): any

// 示例
get_relation_metadata("player", "npc_merchant")  → { discount: 0.1 }
```

---

### 域 4：查询与过滤

#### API 4.1：查找实体

```typescript
find_entities(filter: EntityFilter): Reference[]

interface EntityFilter {
  category?: string;              // 'living', 'container', 'vehicle'
  tags?: string[];                // ['weapon', 'melee']
  location?: LocationFilter;      // 空间过滤
  property?: PropertyFilter;      // 属性过滤
  relation?: RelationFilter;      // 关系过滤
  status?: StatusFilter;          // 状态过滤
}

// 示例
find_entities({ category: "living", tags: ["enemy"] })
find_entities({ location: { node: "room_a" } })
find_entities({ property: { path: "properties.hp", op: "<", value: 2 } })
find_entities({ relation: { from: "player", type: "ally" } })
```

---

#### API 4.2：查找最近实体

```typescript
find_nearest(from: Reference, filter: EntityFilter): Reference | null

// 示例
find_nearest("player", { category: "living", tags: ["enemy"] })
```

---

#### API 4.3：统计实体数量

```typescript
count_entities(filter: EntityFilter): number

// 示例
count_entities({ location: { node: "room_a" }, tags: ["enemy"] })  → 5
```

---

#### API 4.4：查找节点

```typescript
find_nodes(filter: NodeFilter): Reference[]

interface NodeFilter {
  type?: string;                  // 'large', 'medium', 'small'
  tags?: string[];                // ['indoor', 'safe']
  property?: PropertyFilter;
  connection?: { from?: Reference, distance?: number };
}

// 示例
find_nodes({ type: "large" })
find_nodes({ connection: { from: "room_a", distance: 2 } })
```

---

#### API 4.5：查找路径

```typescript
find_path(from: Reference, to: Reference, constraints?: PathConstraints): Reference[]

interface PathConstraints {
  max_distance?: number;
  avoid_nodes?: Reference[];
  only_connections?: string[];  // 只走特定类型的连接
}

// 示例
find_path("node:room_a", "node:room_b")  → ["node:room_a", "node:hallway", "node:room_b"]
find_path("node:a", "node:b", { max_distance: 5 })  → [] (无路径)
```

---

#### API 4.6：计算距离

```typescript
get_distance(from: Reference, to: Reference): number

// 示例
get_distance("node:room_a", "node:room_b")  → 3
get_distance("entity:player", "entity:enemy")  → 2 (根据所在节点计算)
```

---

### 域 5：计算与表达式

#### API 5.1：求值表达式

```typescript
evaluate(expression: string, context?: Record<string, any>): any

// 示例
evaluate("player.properties.gold - 50")  → 50
evaluate("entity.hp / entity.max_hp")  → 0.6
evaluate("a + b", { a: 10, b: 20 })  → 30
```

**支持的运算符**：
- 算术：`+`, `-`, `*`, `/`, `%`, `**`
- 比较：`>`, `<`, `>=`, `<=`, `==`, `!=`
- 逻辑：`&&`, `||`, `!`
- 三元：`? :`
- 函数：`min()`, `max()`, `abs()`, `floor()`, `ceil()`, `round()`

---

#### API 5.2：检查条件

```typescript
check_condition(condition: Condition, context?: Record<string, any>): boolean

type Condition = 
  | { type: "expression", expression: string }
  | { type: "has_property", target: Reference, path: string }
  | { type: "has_item", container: Reference, item: string, count?: number }
  | { type: "has_status", target: Reference, status: string }
  | { type: "relation", from: Reference, to: Reference, relation: string }
  | { type: "and", conditions: Condition[] }
  | { type: "or", conditions: Condition[] }
  | { type: "not", condition: Condition };

// 示例
check_condition({ type: "expression", expression: "player.properties.gold >= 50" })
check_condition({ type: "has_item", container: "player.inventory", item: "key_red" })
check_condition({ type: "and", conditions: [
  { type: "has_property", target: "player", path: "properties.level" },
  { type: "expression", expression: "player.properties.level >= 5" }
]})
```

---

#### API 5.3：随机数生成

```typescript
random_int(min: number, max: number): number
random_float(min: number, max: number): number
random_choice<T>(list: T[]): T
random_weighted<T>(items: T[], weights: number[]): T

// 示例
random_int(1, 6)  → 4
random_choice(["sword", "shield", "potion"])  → "shield"
random_weighted(["common", "rare", "epic"], [0.7, 0.25, 0.05])  → "common"
```

---

#### API 5.4：数学函数

```typescript
math_clamp(value: number, min: number, max: number): number
math_lerp(a: number, b: number, t: number): number
math_round(value: number, decimals?: number): number

// 示例
math_clamp(15, 0, 10)  → 10
math_lerp(0, 100, 0.5)  → 50
math_round(3.14159, 2)  → 3.14
```

---

### 域 6：实体生命周期

#### API 6.1：创建实体

```typescript
spawn_entity(config: EntityConfig): Reference

interface EntityConfig {
  type: string;                   // 实体类型（预设配置的基础）
  location: Reference;            // 位置
  properties?: Record<string, any>;  // 自定义属性（覆盖预设）
  components?: ComponentConfig[];    // 组件配置
  relations?: { to: Reference, type: string }[];
  tags?: string[];
}

// 示例
spawn_entity({
  type: "zombie",
  location: "node:spawn_point",
  properties: { hp_modifier: 1.5 },
  tags: ["elite"]
})
```

---

#### API 6.2：销毁实体

```typescript
destroy_entity(entity: Reference): void

// 示例
destroy_entity("entity:zombie_123")
```

---

#### API 6.3：克隆实体

```typescript
clone_entity(source: Reference, modifications?: Partial<EntityConfig>): Reference

// 示例
clone_entity("entity:zombie_1", { location: "node:spawn_2" })
```

---

#### API 6.4：转换实体

```typescript
transform_entity(entity: Reference, new_type: string, keep_properties?: boolean): void

// 示例
transform_entity("entity:player", "werewolf", true)  // 变身，保留属性
```

---

#### API 6.5：移动实体

```typescript
move_entity(entity: Reference, to: Reference): boolean

// 示例
move_entity("entity:player", "node:room_b")
```

---

#### API 6.6：传送实体

```typescript
teleport_entity(entity: Reference, to: Reference): void

// 示例
teleport_entity("entity:player", "node:boss_room")  // 无视路径直接传送
```

---

### 域 7：状态系统

#### API 7.1：应用状态

```typescript
apply_status(target: Reference, status: StatusEffect): void

interface StatusEffect {
  type: string;
  duration: number;               // 回合数，-1 = 永久
  intensity?: number;             // 强度
  on_apply?: Action[];            // 应用时执行
  on_tick?: Action[];             // 每回合执行
  on_remove?: Action[];           // 移除时执行
  metadata?: Record<string, any>;
}

// 示例
apply_status("entity:player", {
  type: "burning",
  duration: 3,
  intensity: 2,
  on_tick: [
    { api: "damage", params: { entity: "{{target}}", value: 2 }}
  ]
})
```

---

#### API 7.2：移除状态

```typescript
remove_status(target: Reference, status_type: string): void

// 示例
remove_status("entity:player", "burning")
```

---

#### API 7.3：查询状态

```typescript
has_status(target: Reference, status_type: string): boolean
get_status(target: Reference, status_type: string): StatusEffect | null
get_all_statuses(target: Reference): StatusEffect[]

// 示例
has_status("entity:player", "stunned")  → true
get_status("entity:player", "burning")  → { type: "burning", duration: 2, ... }
```

---

#### API 7.4：修改状态

```typescript
modify_status(target: Reference, status_type: string, field: string, value: any): void

// 示例
modify_status("entity:player", "burning", "duration", 5)  // 延长燃烧时间
modify_status("entity:player", "shield", "intensity", 10)  // 增加护盾值
```

---

#### API 7.5：清除所有状态

```typescript
clear_statuses(target: Reference, filter?: StatusFilter): void

interface StatusFilter {
  types?: string[];               // 特定类型
  tags?: string[];                // 状态标签（如 "debuff", "control"）
}

// 示例
clear_statuses("entity:player")  // 清除所有
clear_statuses("entity:player", { tags: ["debuff"] })  // 只清除负面状态
```

---

### 域 8：事件系统

#### API 8.1：发射事件

```typescript
emit_event(event_type: string, data?: Record<string, any>): void

// 示例
emit_event("entity_killed", { target: "entity:zombie", killer: "player" })
emit_event("quest_completed", { quest_id: "q1", reward: 100 })
```

---

#### API 8.2：订阅事件

```typescript
subscribe_event(event_type: string, rule: Rule): string

interface Rule {
  id?: string;
  conditions?: Condition[];
  actions: Action[];
  priority?: number;              // 执行优先级
  one_shot?: boolean;             // 是否只触发一次
}

// 示例（在配置文件中）
subscribe_event("entity_killed", {
  id: "quest_tracker",
  conditions: [
    { type: "expression", expression: "event.target.tags.includes('zombie')" }
  ],
  actions: [
    { api: "modify_property", params: { target: "player", path: "properties.quest_progress", op: "+", value: 1 }}
  ]
})
```

---

#### API 8.3：取消订阅

```typescript
unsubscribe_event(subscription_id: string): void

// 示例
unsubscribe_event("quest_tracker")
```

---

#### API 8.4：延迟事件

```typescript
schedule_event(event_type: string, data: Record<string, any>, delay: number): string

// 示例
schedule_event("bomb_explode", { location: "node:room_a" }, 3)  // 3 回合后爆炸
```

---

#### API 8.5：取消延迟事件

```typescript
cancel_scheduled_event(event_id: string): void

// 示例
cancel_scheduled_event("bomb_123")
```

---

### 域 9：控制流

#### API 9.1：条件分支

```typescript
if_then_else(condition: Condition, then_actions: Action[], else_actions?: Action[]): void

// 示例（配置语法）
{
  "api": "if",
  "condition": { "type": "expression", "expression": "player.properties.gold >= 50" },
  "then": [
    { "api": "modify_property", "params": { "target": "player", "path": "properties.gold", "op": "-", "value": 50 }},
    { "api": "container_transfer", "params": { "from": "shop", "to": "player", "item": "sword" }}
  ],
  "else": [
    { "api": "show_message", "params": { "text": "金币不足！" }}
  ]
}
```

---

#### API 9.2：循环遍历

```typescript
for_each(list: Reference | any[], actions: Action[], item_var?: string): void

// 示例
{
  "api": "for_each",
  "list": "{{targets}}",
  "item_var": "target",
  "actions": [
    { "api": "damage", "params": { "entity": "{{target}}", "value": 2 }}
  ]
}
```

---

#### API 9.3：条件循环

```typescript
while_loop(condition: Condition, actions: Action[], max_iterations?: number): void

// 示例
{
  "api": "while",
  "condition": { "type": "expression", "expression": "counter < 5" },
  "max_iterations": 10,
  "actions": [
    { "api": "spawn_entity", "params": { "type": "zombie", "location": "spawn_point" }},
    { "api": "modify_property", "params": { "target": "this", "path": "counter", "op": "+", "value": 1 }}
  ]
}
```

---

#### API 9.4：提前退出

```typescript
break_loop(): void
continue_loop(): void

// 示例
{
  "api": "for_each",
  "list": "{{entities}}",
  "actions": [
    { "api": "if", "condition": { "type": "expression", "expression": "item.hp <= 0" }, "then": [
      { "api": "continue" }  // 跳过死亡单位
    ]},
    { "api": "damage", "params": { "entity": "{{item}}", "value": 1 }}
  ]
}
```

---

#### API 9.5：延迟执行

```typescript
delay(actions: Action[], turns: number): void

// 示例
{
  "api": "delay",
  "turns": 3,
  "actions": [
    { "api": "damage", "params": { "entity": "target", "value": 5 }}
  ]
}
```

---

#### API 9.6：批量执行

```typescript
batch(actions: Action[], mode: "sequential" | "parallel"): void

// 示例
{
  "api": "batch",
  "mode": "parallel",
  "actions": [
    { "api": "spawn_entity", "params": { "type": "zombie", "location": "spawn_1" }},
    { "api": "spawn_entity", "params": { "type": "zombie", "location": "spawn_2" }},
    { "api": "spawn_entity", "params": { "type": "zombie", "location": "spawn_3" }}
  ]
}
```

---

### 域 10：节点操作

#### API 10.1：设置节点属性

```typescript
set_node_property(node: Reference, path: string, value: any): void

// 示例
set_node_property("node:room_a", "properties.temperature", 100)
set_node_property("node:room_a", "properties.locked", true)
```

---

#### API 10.2：应用节点状态

```typescript
apply_node_status(node: Reference, status: EnvironmentStatus): void

interface EnvironmentStatus {
  type: string;
  duration: number;
  intensity?: number;
  on_enter?: Action[];            // 进入节点时
  on_stay?: Action[];             // 停留时（每回合）
  on_exit?: Action[];             // 离开节点时
  spreads?: SpreadConfig;         // 扩散配置
}

// 示例
apply_node_status("node:room_a", {
  type: "fire",
  duration: 5,
  intensity: 3,
  on_stay: [
    { api: "damage", params: { entity: "{{current_entity}}", value: 2 }}
  ],
  spreads: {
    rate: 1,  // 每回合扩散到 1 个相邻节点
    condition: { type: "expression", expression: "target_node.properties.flammable == true" }
  }
})
```

---

#### API 10.3：修改连接

```typescript
modify_connection(from: Reference, to: Reference, changes: ConnectionChanges): void

interface ConnectionChanges {
  locked?: boolean;
  cost?: { ap?: number, [key: string]: any };
  conditions?: Condition[];
  disabled?: boolean;
}

// 示例
modify_connection("node:room_a", "node:room_b", { locked: true })
modify_connection("node:room_a", "node:room_b", { cost: { ap: 2 } })
```

---

#### API 10.4：创建连接

```typescript
create_connection(from: Reference, to: Reference, config: ConnectionConfig): void

interface ConnectionConfig {
  type: string;                   // "door", "window", "ladder"
  bidirectional?: boolean;
  cost?: { ap?: number, [key: string]: any };
  conditions?: Condition[];
  on_traverse?: Action[];
}

// 示例
create_connection("node:room_a", "node:room_b", {
  type: "door",
  bidirectional: true,
  cost: { ap: 1 }
})
```

---

#### API 10.5：删除连接

```typescript
remove_connection(from: Reference, to: Reference): void

// 示例
remove_connection("node:room_a", "node:room_b")  // 断桥、炸墙
```

---

### 域 11：变量与存储

#### API 11.1：设置变量

```typescript
set_var(name: string, value: any, scope?: "global" | "player" | "local"): void

// 示例
set_var("targets", ["entity:1", "entity:2"], "local")
set_var("game_state", "boss_phase_2", "global")
set_var("quest_progress", 5, "player")
```

**作用域**：
- `global` - 全局变量（所有玩家共享）
- `player` - 玩家变量（每个玩家独立）
- `local` - 局部变量（当前规则/函数内）

---

#### API 11.2：获取变量

```typescript
get_var(name: string, scope?: "global" | "player" | "local"): any

// 示例
get_var("targets", "local")  → ["entity:1", "entity:2"]
```

---

#### API 11.3：删除变量

```typescript
delete_var(name: string, scope?: "global" | "player" | "local"): void

// 示例
delete_var("temp_data", "local")
```

---

### 域 12：UI 与交互

#### API 12.1：显示消息

```typescript
show_message(text: string, duration?: number, style?: string): void

// 示例
show_message("购买成功！", 2.0, "success")
show_message("金币不足", 1.5, "error")
```

---

#### API 12.2：显示对话

```typescript
show_dialogue(text: string, choices?: DialogueChoice[]): Promise<string>

interface DialogueChoice {
  id: string;
  text: string;
  condition?: Condition;
}

// 示例（配置语法）
{
  "api": "show_dialogue",
  "params": {
    "text": "你想购买什么？",
    "choices": [
      { "id": "sword", "text": "铁剑（50 金币）", "condition": { "type": "expression", "expression": "player.properties.gold >= 50" }},
      { "id": "potion", "text": "药水（10 金币）" },
      { "id": "cancel", "text": "取消" }
    ]
  },
  "store": "selected_choice"
}
```

---

#### API 12.3：显示 UI 面板

```typescript
show_ui(type: string, data: Record<string, any>): Promise<any>

// 示例
{
  "api": "show_ui",
  "params": {
    "type": "shop",
    "data": {
      "items": "{{shop.inventory.items}}",
      "prices": "{{shop.properties.price_table}}"
    }
  },
  "store": "ui_result"
}
```

---

#### API 12.4：等待玩家输入

```typescript
wait_for_input(prompt?: string): Promise<any>

// 示例
{
  "api": "wait_for_input",
  "params": { "prompt": "选择一个目标" },
  "store": "selected_target"
}
```

---

#### API 12.5：高亮显示

```typescript
highlight_entity(entity: Reference, color: string, duration?: number): void
highlight_node(node: Reference, color: string, duration?: number): void

// 示例
highlight_entity("entity:enemy", "red", 2.0)
highlight_node("node:exit", "green", 5.0)
```

---

### 域 13：战斗与伤害

#### API 13.1：造成伤害

```typescript
damage(target: Reference, value: number, source?: Reference, damage_type?: string): void

// 示例
damage("entity:enemy", 3, "player", "physical")
damage("entity:player", 2, "entity:trap", "fire")
```

**伤害类型**：`physical`, `fire`, `poison`, `magic`, `true` (无视护甲)

---

#### API 13.2：治疗

```typescript
heal(target: Reference, value: number, source?: Reference): void

// 示例
heal("entity:player", 2, "item:potion")
```

---

#### API 13.3：投骰检定

```typescript
roll_dice(sides: number, modifiers?: number): number
roll_check(dc: number, modifiers?: number): boolean

// 示例
roll_dice(6)  → 4
roll_dice(6, 2)  → 6 (骰子 4 + 修正 2)
roll_check(5, 2)  → true (骰子 4 + 修正 2 = 6 >= 5)
```

---

#### API 13.4：攻击检定

```typescript
attack_check(attacker: Reference, target: Reference, weapon?: Reference): AttackResult

interface AttackResult {
  hit: boolean;
  crit: boolean;
  damage: number;
  effects?: string[];
}

// 示例
attack_check("player", "entity:enemy", "item:sword")
→ { hit: true, crit: false, damage: 3, effects: [] }
```

---

### 域 14：音效与特效

#### API 14.1：播放音效

```typescript
play_sound(sound: string, location?: Reference, volume?: number): void

// 示例
play_sound("sword_slash", "entity:player", 1.0)
play_sound("explosion", "node:room_a", 1.5)
```

---

#### API 14.2：播放特效

```typescript
play_effect(effect: string, location: Reference, params?: Record<string, any>): void

// 示例
play_effect("fire_explosion", "node:room_a", { radius: 2 })
play_effect("healing_sparkle", "entity:player")
```

---

#### API 14.3：震动屏幕

```typescript
shake_camera(intensity: number, duration: number): void

// 示例
shake_camera(0.5, 0.3)
```

---

#### API 14.4：闪光效果

```typescript
flash_screen(color: string, duration: number): void

// 示例
flash_screen("red", 0.2)  // 受伤红色闪光
flash_screen("white", 0.1)  // 暴击白色闪光
```

---

## 第二部分：完备性验证

### 验证方法：用例覆盖测试

对每个常见 RPG 机制，用底层 API 实现，验证完备性。

---

## 用例 1：商店系统

**需求**：
- NPC 出售物品
- 检查玩家金币
- 扣除金币并转移物品
- 显示反馈

**实现**：

```json
{
  "entity_id": "shop_keeper",
  "type": "npc",
  "properties": {
    "shop_inventory": ["sword", "potion", "shield"],
    "prices": {
      "sword": 50,
      "potion": 10,
      "shield": 30
    }
  },
  "on_interact": {
    "actions": [
      {
        "api": "show_ui",
        "params": {
          "type": "shop",
          "items": "{{this.properties.shop_inventory}}",
          "prices": "{{this.properties.prices}}"
        },
        "store": "purchase_result"
      },
      {
        "api": "if",
        "condition": {
          "type": "expression",
          "expression": "purchase_result != null"
        },
        "then": [
          {
            "api": "get_property",
            "params": {
              "target": "this",
              "path": "properties.prices.{{purchase_result.item}}"
            },
            "store": "price"
          },
          {
            "api": "get_property",
            "params": {
              "target": "player",
              "path": "properties.gold"
            },
            "store": "player_gold"
          },
          {
            "api": "if",
            "condition": {
              "type": "expression",
              "expression": "player_gold >= price"
            },
            "then": [
              {
                "api": "modify_property",
                "params": {
                  "target": "player",
                  "path": "properties.gold",
                  "op": "-",
                  "value": "{{price}}"
                }
              },
              {
                "api": "spawn_entity",
                "params": {
                  "type": "{{purchase_result.item}}",
                  "location": "player"
                },
                "store": "new_item"
              },
              {
                "api": "container_add",
                "params": {
                  "container": "player.inventory",
                  "item": "{{new_item}}"
                }
              },
              {
                "api": "show_message",
                "params": {
                  "text": "购买成功！",
                  "style": "success"
                }
              }
            ],
            "else": [
              {
                "api": "show_message",
                "params": {
                  "text": "金币不足！",
                  "style": "error"
                }
              }
            ]
          }
        ]
      }
    ]
  }
}
```

**验证通过** ✅：使用了 API：
- `show_ui`（UI 交互）
- `get_property`（读取价格和金币）
- `if`（条件分支）
- `modify_property`（扣除金币）
- `spawn_entity` + `container_add`（转移物品）
- `show_message`（反馈）

---

## 用例 2：任务系统（击杀 5 只僵尸）

**需求**：
- 追踪击杀数量
- 完成后给予奖励
- 显示进度

**实现**：

```json
{
  "quest_id": "kill_zombies",
  "init_actions": [
    {
      "api": "set_property",
      "params": {
        "target": "player",
        "path": "properties.quest_kill_zombies",
        "value": 0
      }
    }
  ],
  "rules": [
    {
      "trigger": {
        "type": "on_event",
        "event": "entity_killed"
      },
      "conditions": [
        {
          "type": "expression",
          "expression": "event.target.tags.includes('zombie')"
        }
      ],
      "actions": [
        {
          "api": "modify_property",
          "params": {
            "target": "player",
            "path": "properties.quest_kill_zombies",
            "op": "+",
            "value": 1
          }
        },
        {
          "api": "get_property",
          "params": {
            "target": "player",
            "path": "properties.quest_kill_zombies"
          },
          "store": "progress"
        },
        {
          "api": "show_message",
          "params": {
            "text": "僵尸击杀进度：{{progress}}/5"
          }
        },
        {
          "api": "if",
          "condition": {
            "type": "expression",
            "expression": "progress >= 5"
          },
          "then": [
            {
              "api": "emit_event",
              "params": {
                "event": "quest_completed",
                "data": {
                  "quest_id": "kill_zombies"
                }
              }
            }
          ]
        }
      ]
    },
    {
      "trigger": {
        "type": "on_event",
        "event": "quest_completed"
      },
      "conditions": [
        {
          "type": "expression",
          "expression": "event.data.quest_id == 'kill_zombies'"
        }
      ],
      "actions": [
        {
          "api": "modify_property",
          "params": {
            "target": "player",
            "path": "properties.exp",
            "op": "+",
            "value": 100
          }
        },
        {
          "api": "show_message",
          "params": {
            "text": "任务完成！获得 100 经验！",
            "style": "success"
          }
        }
      ],
      "one_shot": true
    }
  ]
}
```

**验证通过** ✅：使用了 API：
- `set_property`（初始化进度）
- `subscribe_event`（订阅击杀事件）
- `modify_property`（更新进度）
- `emit_event`（触发完成事件）
- `show_message`（显示进度和奖励）

---

## 用例 3：对话树系统

**需求**：
- 多分支对话
- 条件选项（需要线索才显示）
- 影响关系和状态

**实现**：

```json
{
  "npc_id": "detective_npc",
  "properties": {
    "dialogue_state": "initial",
    "revealed_clues": []
  },
  "dialogues": {
    "initial": {
      "text": "你好，侦探。有什么需要我帮助的吗？",
      "choices": [
        {
          "id": "ask_victim",
          "text": "你认识受害者吗？",
          "next": "about_victim"
        },
        {
          "id": "ask_alibi",
          "text": "你昨晚在哪里？",
          "next": "ask_alibi",
          "condition": {
            "type": "has_property",
            "target": "player",
            "path": "properties.clues.footprint"
          }
        },
        {
          "id": "leave",
          "text": "再见",
          "next": null
        }
      ]
    },
    "about_victim": {
      "text": "是的，他是我的邻居...一个好人。",
      "on_show": [
        {
          "api": "modify_property",
          "params": {
            "target": "this",
            "path": "properties.revealed_clues",
            "op": "push",
            "value": "neighbor_relationship"
          }
        }
      ],
      "choices": [
        {
          "id": "back",
          "text": "返回",
          "next": "initial"
        }
      ]
    },
    "ask_alibi": {
      "text": "我...我在家里睡觉。",
      "on_show": [
        {
          "api": "if",
          "condition": {
            "type": "has_property",
            "target": "player",
            "path": "properties.clues.footprint"
          },
          "then": [
            {
              "api": "show_message",
              "params": {
                "text": "（他在撒谎！脚印证据显示他在现场）",
                "style": "important"
              }
            }
          ]
        }
      ],
      "choices": [
        {
          "id": "confront",
          "text": "（出示脚印证据）",
          "next": "caught_lying",
          "condition": {
            "type": "has_property",
            "target": "player",
            "path": "properties.clues.footprint"
          }
        },
        {
          "id": "back",
          "text": "好的，谢谢",
          "next": "initial"
        }
      ]
    },
    "caught_lying": {
      "text": "好吧...我承认我去了现场，但我没有杀人！",
      "on_show": [
        {
          "api": "set_property",
          "params": {
            "target": "this",
            "path": "properties.confession",
            "value": true
          }
        },
        {
          "api": "set_relation",
          "params": {
            "from": "this",
            "to": "player",
            "relation": "hostile"
          }
        }
      ],
      "choices": [
        {
          "id": "investigate_more",
          "text": "继续调查",
          "next": "initial"
        }
      ]
    }
  },
  "on_interact": {
    "actions": [
      {
        "api": "get_property",
        "params": {
          "target": "this",
          "path": "properties.dialogue_state"
        },
        "store": "current_state"
      },
      {
        "api": "get_property",
        "params": {
          "target": "this",
          "path": "dialogues.{{current_state}}"
        },
        "store": "dialogue"
      },
      {
        "api": "for_each",
        "list": "{{dialogue.on_show}}",
        "actions": [
          {
            "api": "execute_action",
            "params": {
              "action": "{{item}}"
            }
          }
        ]
      },
      {
        "api": "show_dialogue",
        "params": {
          "text": "{{dialogue.text}}",
          "choices": "{{dialogue.choices}}"
        },
        "store": "choice"
      },
      {
        "api": "if",
        "condition": {
          "type": "expression",
          "expression": "choice.next != null"
        },
        "then": [
          {
            "api": "set_property",
            "params": {
              "target": "this",
              "path": "properties.dialogue_state",
              "value": "{{choice.next}}"
            }
          }
        ]
      }
    ]
  }
}
```

**验证通过** ✅：使用了 API：
- `get_property`（读取对话状态）
- `show_dialogue`（显示对话和选项）
- `set_property`（更新状态）
- `modify_property`（记录线索）
- `set_relation`（改变关系）
- `for_each`（执行 on_show 动作）

---

## 用例 4：合成系统

**需求**：
- 检查材料
- 消耗材料
- 生成成品

**实现**：

```json
{
  "entity_id": "crafting_table",
  "type": "interactive",
  "properties": {
    "recipes": [
      {
        "id": "iron_sword",
        "name": "铁剑",
        "inputs": [
          { "item": "iron", "count": 3 },
          { "item": "wood", "count": 2 }
        ],
        "output": { "item": "iron_sword", "count": 1 }
      },
      {
        "id": "healing_potion",
        "name": "治疗药水",
        "inputs": [
          { "item": "herb", "count": 5 },
          { "item": "water", "count": 1 }
        ],
        "output": { "item": "healing_potion", "count": 1 }
      }
    ]
  },
  "on_interact": {
    "actions": [
      {
        "api": "show_ui",
        "params": {
          "type": "crafting",
          "recipes": "{{this.properties.recipes}}"
        },
        "store": "selected_recipe"
      },
      {
        "api": "if",
        "condition": {
          "type": "expression",
          "expression": "selected_recipe != null"
        },
        "then": [
          {
            "api": "set_var",
            "params": {
              "name": "can_craft",
              "value": true
            }
          },
          {
            "api": "for_each",
            "list": "{{selected_recipe.inputs}}",
            "actions": [
              {
                "api": "container_count",
                "params": {
                  "container": "player.inventory",
                  "filter": { "type": "{{item.item}}" }
                },
                "store": "item_count"
              },
              {
                "api": "if",
                "condition": {
                  "type": "expression",
                  "expression": "item_count < item.count"
                },
                "then": [
                  {
                    "api": "set_var",
                    "params": {
                      "name": "can_craft",
                      "value": false
                    }
                  },
                  {
                    "api": "show_message",
                    "params": {
                      "text": "材料不足：{{item.item}} (需要 {{item.count}}，拥有 {{item_count}})",
                      "style": "error"
                    }
                  }
                ]
              }
            ]
          },
          {
            "api": "if",
            "condition": {
              "type": "expression",
              "expression": "can_craft"
            },
            "then": [
              {
                "api": "for_each",
                "list": "{{selected_recipe.inputs}}",
                "actions": [
                  {
                    "api": "container_query",
                    "params": {
                      "container": "player.inventory",
                      "filter": { "type": "{{item.item}}" }
                    },
                    "store": "items_to_remove"
                  },
                  {
                    "api": "set_var",
                    "params": {
                      "name": "removed_count",
                      "value": 0
                    }
                  },
                  {
                    "api": "for_each",
                    "list": "{{items_to_remove}}",
                    "actions": [
                      {
                        "api": "if",
                        "condition": {
                          "type": "expression",
                          "expression": "removed_count < item.count"
                        },
                        "then": [
                          {
                            "api": "container_remove",
                            "params": {
                              "container": "player.inventory",
                              "item": "{{item}}"
                            }
                          },
                          {
                            "api": "destroy_entity",
                            "params": {
                              "entity": "{{item}}"
                            }
                          },
                          {
                            "api": "modify_property",
                            "params": {
                              "target": "local",
                              "path": "removed_count",
                              "op": "+",
                              "value": 1
                            }
                          }
                        ]
                      }
                    ]
                  }
                ]
              },
              {
                "api": "spawn_entity",
                "params": {
                  "type": "{{selected_recipe.output.item}}",
                  "location": "player"
                },
                "store": "crafted_item"
              },
              {
                "api": "container_add",
                "params": {
                  "container": "player.inventory",
                  "item": "{{crafted_item}}"
                }
              },
              {
                "api": "show_message",
                "params": {
                  "text": "合成成功：{{selected_recipe.name}}",
                  "style": "success"
                }
              }
            ]
          }
        ]
      }
    ]
  }
}
```

**验证通过** ✅：使用了 API：
- `show_ui`（显示合成界面）
- `container_count`（检查材料数量）
- `for_each`（遍历材料）
- `container_query` + `container_remove`（消耗材料）
- `destroy_entity`（销毁物品）
- `spawn_entity` + `container_add`（生成成品）

---

## 用例 5：Boss 战（多阶段）

**需求**：
- 血量阈值触发阶段变化
- 不同阶段不同技能
- 召唤小怪
- 无敌阶段

**实现**：

```json
{
  "entity_id": "boss",
  "type": "living",
  "properties": {
    "max_hp": 100,
    "hp": 100,
    "phase": 1,
    "invulnerable": false
  },
  "rules": [
    {
      "id": "phase_transition",
      "trigger": {
        "type": "on_event",
        "event": "entity_damaged"
      },
      "conditions": [
        {
          "type": "expression",
          "expression": "event.target == this.id"
        }
      ],
      "actions": [
        {
          "api": "get_property",
          "params": {
            "target": "this",
            "path": "properties.hp"
          },
          "store": "current_hp"
        },
        {
          "api": "get_property",
          "params": {
            "target": "this",
            "path": "properties.phase"
          },
          "store": "current_phase"
        },
        {
          "api": "if",
          "condition": {
            "type": "and",
            "conditions": [
              {
                "type": "expression",
                "expression": "current_hp <= 50"
              },
              {
                "type": "expression",
                "expression": "current_phase == 1"
              }
            ]
          },
          "then": [
            {
              "api": "set_property",
              "params": {
                "target": "this",
                "path": "properties.phase",
                "value": 2
              }
            },
            {
              "api": "set_property",
              "params": {
                "target": "this",
                "path": "properties.invulnerable",
                "value": true
              }
            },
            {
              "api": "show_message",
              "params": {
                "text": "Boss 进入第二阶段！",
                "style": "warning"
              }
            },
            {
              "api": "play_effect",
              "params": {
                "effect": "phase_transition",
                "location": "this"
              }
            },
            {
              "api": "for_each",
              "list": [
                "spawn_1",
                "spawn_2",
                "spawn_3",
                "spawn_4"
              ],
              "actions": [
                {
                  "api": "spawn_entity",
                  "params": {
                    "type": "minion",
                    "location": "{{item}}",
                    "relations": [
                      {
                        "to": "this",
                        "type": "summoned_by"
                      }
                    ]
                  }
                }
              ]
            },
            {
              "api": "delay",
              "params": {
                "turns": 2,
                "actions": [
                  {
                    "api": "set_property",
                    "params": {
                      "target": "this",
                      "path": "properties.invulnerable",
                      "value": false
                    }
                  },
                  {
                    "api": "show_message",
                    "params": {
                      "text": "Boss 的无敌状态结束了！"
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    },
    {
      "id": "damage_reduction",
      "trigger": {
        "type": "on_event",
        "event": "before_damage"
      },
      "conditions": [
        {
          "type": "expression",
          "expression": "event.target == this.id"
        },
        {
          "type": "has_property",
          "target": "this",
          "path": "properties.invulnerable"
        }
      ],
      "actions": [
        {
          "api": "get_property",
          "params": {
            "target": "this",
            "path": "properties.invulnerable"
          },
          "store": "is_invulnerable"
        },
        {
          "api": "if",
          "condition": {
            "type": "expression",
            "expression": "is_invulnerable"
          },
          "then": [
            {
              "api": "set_var",
              "params": {
                "name": "event.damage",
                "value": 0
              }
            },
            {
              "api": "show_message",
              "params": {
                "text": "Boss 处于无敌状态！",
                "style": "warning"
              }
            }
          ]
        }
      ]
    }
  ]
}
```

**验证通过** ✅：使用了 API：
- `subscribe_event`（订阅伤害事件）
- `get_property`（检查血量和阶段）
- `set_property`（切换阶段和无敌状态）
- `for_each` + `spawn_entity`（召唤小怪）
- `delay`（延迟解除无敌）
- `play_effect`（阶段转换特效）

---

## 用例 6：装备词缀系统（荆棘反伤）

**需求**：
- 装备有被动效果
- 受击时触发
- 反伤给攻击者

**实现**：

```json
{
  "item_id": "thorns_armor",
  "type": "armor",
  "properties": {
    "defense": 5,
    "thorns_damage": 2
  },
  "passive_effects": [
    {
      "id": "thorns_反伤",
      "trigger": {
        "type": "on_event",
        "event": "entity_damaged"
      },
      "conditions": [
        {
          "type": "expression",
          "expression": "event.target == wearer"
        },
        {
          "type": "expression",
          "expression": "event.source != null"
        }
      ],
      "actions": [
        {
          "api": "get_property",
          "params": {
            "target": "this",
            "path": "properties.thorns_damage"
          },
          "store": "反伤值"
        },
        {
          "api": "damage",
          "params": {
            "target": "{{event.source}}",
            "value": "{{反伤值}}",
            "source": "{{event.target}}",
            "damage_type": "true"
          }
        },
        {
          "api": "play_effect",
          "params": {
            "effect": "thorns_sparkle",
            "location": "{{event.target}}"
          }
        },
        {
          "api": "show_message",
          "params": {
            "text": "荆棘反伤！"
          }
        }
      ]
    }
  ]
}
```

**验证通过** ✅：使用了 API：
- `subscribe_event`（订阅伤害事件）
- `get_property`（读取反伤数值）
- `damage`（造成反伤）
- `play_effect`（特效）

---

## 用例 7：连招系统（格斗游戏）

**需求**：
- 追踪上一个动作
- 时间窗口内可触发连招
- 不同输入序列产生不同连招

**实现**：

```json
{
  "combo_system": {
    "player_state": {
      "last_action": null,
      "last_action_time": 0,
      "combo_window": 1.0
    },
    "combos": [
      {
        "id": "light_punch_combo",
        "sequence": ["light_punch", "light_punch", "heavy_punch"],
        "damage": 5,
        "effects": [
          {
            "api": "apply_status",
            "params": {
              "target": "{{target}}",
              "status": {
                "type": "stunned",
                "duration": 1
              }
            }
          }
        ]
      },
      {
        "id": "uppercut_combo",
        "sequence": ["crouch", "heavy_punch"],
        "damage": 8,
        "effects": [
          {
            "api": "apply_status",
            "params": {
              "target": "{{target}}",
              "status": {
                "type": "airborne",
                "duration": 1
              }
            }
          }
        ]
      }
    ],
    "rules": [
      {
        "trigger": {
          "type": "on_event",
          "event": "action_performed"
        },
        "conditions": [
          {
            "type": "expression",
            "expression": "event.actor == player"
          }
        ],
        "actions": [
          {
            "api": "get_property",
            "params": {
              "target": "player",
              "path": "properties.combo_sequence"
            },
            "store": "current_sequence"
          },
          {
            "api": "if",
            "condition": {
              "type": "expression",
              "expression": "current_sequence == null"
            },
            "then": [
              {
                "api": "set_property",
                "params": {
                  "target": "player",
                  "path": "properties.combo_sequence",
                  "value": []
                }
              }
            ]
          },
          {
            "api": "modify_property",
            "params": {
              "target": "player",
              "path": "properties.combo_sequence",
              "op": "push",
              "value": "{{event.action_type}}"
            }
          },
          {
            "api": "for_each",
            "list": "{{combos}}",
            "actions": [
              {
                "api": "evaluate",
                "params": {
                  "expression": "JSON.stringify(player.properties.combo_sequence) == JSON.stringify(item.sequence)"
                },
                "store": "matches"
              },
              {
                "api": "if",
                "condition": {
                  "type": "expression",
                  "expression": "matches"
                },
                "then": [
                  {
                    "api": "damage",
                    "params": {
                      "target": "{{event.target}}",
                      "value": "{{item.damage}}"
                    }
                  },
                  {
                    "api": "for_each",
                    "list": "{{item.effects}}",
                    "actions": [
                      {
                        "api": "execute_action",
                        "params": {
                          "action": "{{item}}"
                        }
                      }
                    ]
                  },
                  {
                    "api": "show_message",
                    "params": {
                      "text": "连招：{{item.id}}",
                      "style": "combo"
                    }
                  },
                  {
                    "api": "set_property",
                    "params": {
                      "target": "player",
                      "path": "properties.combo_sequence",
                      "value": []
                    }
                  }
                ]
              }
            ]
          },
          {
            "api": "schedule_event",
            "params": {
              "event": "combo_reset",
              "data": {
                "player": "player"
              },
              "delay": 1.0
            }
          }
        ]
      },
      {
        "trigger": {
          "type": "on_event",
          "event": "combo_reset"
        },
        "actions": [
          {
            "api": "set_property",
            "params": {
              "target": "{{event.data.player}}",
              "path": "properties.combo_sequence",
              "value": []
            }
          }
        ]
      }
    ]
  }
}
```
3
**验证通过** ✅：使用了 API：
- `subscribe_event`（订阅动作事件）
- `get_property` + `set_property`（追踪序列）
- `modify_property`（push 到数组）
- `for_each`（检查所有连招）
- `evaluate`（比较序列）
- `schedule_event`（延迟重置）

---

## 用例 8：动态地图生成（Roguelike）

**需求**：
- 运行时生成房间
- 随机连接
- 随机放置物品和敌人

**实现**：

```json
{
  "map_generator": {
    "config": {
      "room_count": 10,
      "room_types": [
        { "type": "small", "weight": 0.5 },
        { "type": "medium", "weight": 0.3 },
        { "type": "large", "weight": 0.2 }
      ],
      "connection_density": 0.3
    },
    "generate": {
      "actions": [
        {
          "api": "set_var",
          "params": {
            "name": "generated_rooms",
            "value": []
          }
        },
        {
          "api": "while",
          "condition": {
            "type": "expression",
            "expression": "generated_rooms.length < config.room_count"
          },
          "max_iterations": 100,
          "actions": [
            {
              "api": "random_weighted",
              "params": {
                "items": ["small", "medium", "large"],
                "weights": [0.5, 0.3, 0.2]
              },
              "store": "room_type"
            },
            {
              "api": "spawn_entity",
              "params": {
                "type": "node",
                "properties": {
                  "node_type": "{{room_type}}",
                  "id": "room_{{generated_rooms.length}}"
                }
              },
              "store": "new_room"
            },
            {
              "api": "modify_property",
              "params": {
                "target": "local",
                "path": "generated_rooms",
                "op": "push",
                "value": "{{new_room}}"
              }
            },
            {
              "api": "if",
              "condition": {
                "type": "expression",
                "expression": "generated_rooms.length > 1"
              },
              "then": [
                {
                  "api": "random_choice",
                  "params": {
                    "list": "{{generated_rooms}}"
                  },
                  "store": "connect_to"
                },
                {
                  "api": "create_connection",
                  "params": {
                    "from": "{{new_room}}",
                    "to": "{{connect_to}}",
                    "config": {
                      "type": "door",
                      "bidirectional": true
                    }
                  }
                }
              ]
            }
          ]
        },
        {
          "api": "for_each",
          "list": "{{generated_rooms}}",
          "actions": [
            {
              "api": "random_int",
              "params": {
                "min": 0,
                "max": 3
              },
              "store": "item_count"
            },
            {
              "api": "while",
              "condition": {
                "type": "expression",
                "expression": "item_count > 0"
              },
              "actions": [
                {
                  "api": "random_choice",
                  "params": {
                    "list": ["sword", "potion", "gold", "key"]
                  },
                  "store": "item_type"
                },
                {
                  "api": "spawn_entity",
                  "params": {
                    "type": "{{item_type}}",
                    "location": "{{item}}"
                  }
                },
                {
                  "api": "modify_property",
                  "params": {
                    "target": "local",
                    "path": "item_count",
                    "op": "-",
                    "value": 1
                  }
                }
              ]
            }
          ]
        }
      ]
    }
  }
}
```

**验证通过** ✅：使用了 API：
- `while`（循环生成房间）
- `random_weighted`（随机房间类型）
- `spawn_entity`（创建节点）
- `create_connection`（连接房间）
- `random_choice`（随机物品）
- `for_each`（遍历房间放置物品）

---

## 用例 9：技能冷却系统

**需求**：
- 技能有冷却时间
- 冷却中无法使用
- 回合结束减少冷却

**实现**：

```json
{
  "skill_system": {
    "skills": {
      "fireball": {
        "id": "fireball",
        "name": "火球术",
        "cooldown": 3,
        "effects": [
          {
            "api": "damage",
            "params": {
              "target": "{{target}}",
              "value": 5,
              "damage_type": "fire"
            }
          }
        ]
      },
      "heal": {
        "id": "heal",
        "name": "治疗术",
        "cooldown": 2,
        "effects": [
          {
            "api": "heal",
            "params": {
              "target": "{{target}}",
              "value": 3
            }
          }
        ]
      }
    },
    "use_skill": {
      "params": ["skill_id", "target"],
      "actions": [
        {
          "api": "get_property",
          "params": {
            "target": "player",
            "path": "properties.skill_cooldowns.{{skill_id}}"
          },
          "store": "current_cooldown"
        },
        {
          "api": "if",
          "condition": {
            "type": "or",
            "conditions": [
              {
                "type": "expression",
                "expression": "current_cooldown == null"
              },
              {
                "type": "expression",
                "expression": "current_cooldown <= 0"
              }
            ]
          },
          "then": [
            {
              "api": "get_property",
              "params": {
                "target": "skills",
                "path": "{{skill_id}}"
              },
              "store": "skill"
            },
            {
              "api": "for_each",
              "list": "{{skill.effects}}",
              "actions": [
                {
                  "api": "execute_action",
                  "params": {
                    "action": "{{item}}",
                    "context": {
                      "target": "{{target}}"
                    }
                  }
                }
              ]
            },
            {
              "api": "set_property",
              "params": {
                "target": "player",
                "path": "properties.skill_cooldowns.{{skill_id}}",
                "value": "{{skill.cooldown}}"
              }
            },
            {
              "api": "show_message",
              "params": {
                "text": "使用技能：{{skill.name}}",
                "style": "skill"
              }
            }
          ],
          "else": [
            {
              "api": "show_message",
              "params": {
                "text": "技能冷却中（剩余 {{current_cooldown}} 回合）",
                "style": "error"
              }
            }
          ]
        }
      ]
    },
    "rules": [
      {
        "trigger": {
          "type": "on_event",
          "event": "turn_end"
        },
        "conditions": [
          {
            "type": "expression",
            "expression": "event.actor == player"
          }
        ],
        "actions": [
          {
            "api": "get_property",
            "params": {
              "target": "player",
              "path": "properties.skill_cooldowns"
            },
            "store": "cooldowns"
          },
          {
            "api": "for_each",
            "list": "{{Object.keys(cooldowns)}}",
            "actions": [
              {
                "api": "get_property",
                "params": {
                  "target": "player",
                  "path": "properties.skill_cooldowns.{{item}}"
                },
                "store": "cd"
              },
              {
                "api": "if",
                "condition": {
                  "type": "expression",
                  "expression": "cd > 0"
                },
                "then": [
                  {
                    "api": "modify_property",
                    "params": {
                      "target": "player",
                      "path": "properties.skill_cooldowns.{{item}}",
                      "op": "-",
                      "value": 1
                    }
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}
```

**验证通过** ✅：使用了 API：
- `get_property`（检查冷却）
- `set_property`（设置冷却）
- `modify_property`（减少冷却）
- `subscribe_event`（回合结束事件）
- `for_each`（遍历所有冷却）

---

## 用例 10：天赋树系统

**需求**：
- 天赋有前置条件
- 解锁天赋获得被动效果
- 重置天赋

**实现**：

```json
{
  "talent_tree": {
    "talents": {
      "strength_1": {
        "id": "strength_1",
        "name": "力量强化 I",
        "description": "攻击力 +1",
        "cost": 1,
        "requires": [],
        "effects": [
          {
            "type": "stat_bonus",
            "stat": "attack",
            "value": 1
          }
        ]
      },
      "strength_2": {
        "id": "strength_2",
        "name": "力量强化 II",
        "description": "攻击力 +2",
        "cost": 1,
        "requires": ["strength_1"],
        "effects": [
          {
            "type": "stat_bonus",
            "stat": "attack",
            "value": 2
          }
        ]
      },
      "critical_hit": {
        "id": "critical_hit",
        "name": "致命打击",
        "description": "暴击率 +10%",
        "cost": 2,
        "requires": ["strength_2"],
        "effects": [
          {
            "type": "stat_bonus",
            "stat": "crit_chance",
            "value": 0.1
          }
        ]
      }
    },
    "unlock_talent": {
      "params": ["talent_id"],
      "actions": [
        {
          "api": "get_property",
          "params": {
            "target": "talents",
            "path": "{{talent_id}}"
          },
          "store": "talent"
        },
        {
          "api": "get_property",
          "params": {
            "target": "player",
            "path": "properties.talent_points"
          },
          "store": "points"
        },
        {
          "api": "if",
          "condition": {
            "type": "expression",
            "expression": "points < talent.cost"
          },
          "then": [
            {
              "api": "show_message",
              "params": {
                "text": "天赋点不足",
                "style": "error"
              }
            },
            {
              "api": "break"
            }
          ]
        },
        {
          "api": "set_var",
          "params": {
            "name": "can_unlock",
            "value": true
          }
        },
        {
          "api": "for_each",
          "list": "{{talent.requires}}",
          "actions": [
            {
              "api": "has_property",
              "params": {
                "target": "player",
                "path": "properties.unlocked_talents.{{item}}"
              },
              "store": "has_prerequisite"
            },
            {
              "api": "if",
              "condition": {
                "type": "expression",
                "expression": "!has_prerequisite"
              },
              "then": [
                {
                  "api": "set_var",
                  "params": {
                    "name": "can_unlock",
                    "value": false
                  }
                },
                {
                  "api": "show_message",
                  "params": {
                    "text": "需要先解锁：{{item}}",
                    "style": "error"
                  }
                }
              ]
            }
          ]
        },
        {
          "api": "if",
          "condition": {
            "type": "expression",
            "expression": "can_unlock"
          },
          "then": [
            {
              "api": "modify_property",
              "params": {
                "target": "player",
                "path": "properties.talent_points",
                "op": "-",
                "value": "{{talent.cost}}"
              }
            },
            {
              "api": "set_property",
              "params": {
                "target": "player",
                "path": "properties.unlocked_talents.{{talent_id}}",
                "value": true
              }
            },
            {
              "api": "for_each",
              "list": "{{talent.effects}}",
              "actions": [
                {
                  "api": "if",
                  "condition": {
                    "type": "expression",
                    "expression": "item.type == 'stat_bonus'"
                  },
                  "then": [
                    {
                      "api": "modify_property",
                      "params": {
                        "target": "player",
                        "path": "properties.stats.{{item.stat}}",
                        "op": "+",
                        "value": "{{item.value}}"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "api": "show_message",
              "params": {
                "text": "解锁天赋：{{talent.name}}",
                "style": "success"
              }
            }
          ]
        }
      ]
    },
    "reset_talents": {
      "actions": [
        {
          "api": "get_property",
          "params": {
            "target": "player",
            "path": "properties.unlocked_talents"
          },
          "store": "unlocked"
        },
        {
          "api": "for_each",
          "list": "{{Object.keys(unlocked)}}",
          "actions": [
            {
              "api": "get_property",
              "params": {
                "target": "talents",
                "path": "{{item}}"
              },
              "store": "talent"
            },
            {
              "api": "modify_property",
              "params": {
                "target": "player",
                "path": "properties.talent_points",
                "op": "+",
                "value": "{{talent.cost}}"
              }
            },
            {
              "api": "for_each",
              "list": "{{talent.effects}}",
              "actions": [
                {
                  "api": "if",
                  "condition": {
                    "type": "expression",
                    "expression": "item.type == 'stat_bonus'"
                  },
                  "then": [
                    {
                      "api": "modify_property",
                      "params": {
                        "target": "player",
                        "path": "properties.stats.{{item.stat}}",
                        "op": "-",
                        "value": "{{item.value}}"
                      }
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "api": "set_property",
          "params": {
            "target": "player",
            "path": "properties.unlocked_talents",
            "value": {}
          }
        },
        {
          "api": "show_message",
          "params": {
            "text": "天赋已重置",
            "style": "success"
          }
        }
      ]
    }
  }
}
```

**验证通过** ✅：使用了 API：
- `get_property`（读取天赋和前置）
- `has_property`（检查前置条件）
- `set_property`（记录解锁）
- `modify_property`（消耗/退还天赋点，应用属性加成）
- `for_each`（遍历前置和效果）

---

## 第三部分：API 分类索引

### 按功能分类

#### 数据操作（6 个）
- `get_property` - 读取属性
- `set_property` - 设置属性
- `modify_property` - 修改属性（运算）
- `delete_property` - 删除属性
- `has_property` - 检查属性存在
- `evaluate` - 求值表达式

#### 容器操作（7 个）
- `container_add` - 添加到容器
- `container_remove` - 从容器移除
- `container_transfer` - 容器间转移
- `container_query` - 查询容器内容
- `container_count` - 统计物品数量
- `container_has_space` - 检查容器空间
- `stack_split` / `stack_merge` - 堆叠操作

#### 关系操作（5 个）
- `set_relation` - 建立关系
- `get_relation` - 查询关系
- `find_related` - 查找相关实体
- `remove_relation` - 删除关系
- `get_relation_metadata` - 获取关系元数据

#### 查询操作（6 个）
- `find_entities` - 查找实体
- `find_nearest` - 查找最近实体
- `count_entities` - 统计实体数量
- `find_nodes` - 查找节点
- `find_path` - 查找路径
- `get_distance` - 计算距离

#### 实体生命周期（6 个）
- `spawn_entity` - 创建实体
- `destroy_entity` - 销毁实体
- `clone_entity` - 克隆实体
- `transform_entity` - 转换实体
- `move_entity` - 移动实体
- `teleport_entity` - 传送实体

#### 状态操作（5 个）
- `apply_status` - 应用状态
- `remove_status` - 移除状态
- `has_status` / `get_status` / `get_all_statuses` - 查询状态
- `modify_status` - 修改状态
- `clear_statuses` - 清除所有状态

#### 事件系统（5 个）
- `emit_event` - 发射事件
- `subscribe_event` - 订阅事件
- `unsubscribe_event` - 取消订阅
- `schedule_event` - 延迟事件
- `cancel_scheduled_event` - 取消延迟事件

#### 控制流（6 个）
- `if` - 条件分支
- `for_each` - 循环遍历
- `while` - 条件循环
- `break` / `continue` - 循环控制
- `delay` - 延迟执行
- `batch` - 批量执行

#### 节点操作（5 个）
- `set_node_property` - 设置节点属性
- `apply_node_status` - 应用节点状态
- `modify_connection` - 修改连接
- `create_connection` - 创建连接
- `remove_connection` - 删除连接

#### 变量操作（3 个）
- `set_var` - 设置变量
- `get_var` - 获取变量
- `delete_var` - 删除变量

#### UI 交互（5 个）
- `show_message` - 显示消息
- `show_dialogue` - 显示对话
- `show_ui` - 显示 UI 面板
- `wait_for_input` - 等待玩家输入
- `highlight_entity` / `highlight_node` - 高亮显示

#### 战斗系统（4 个）
- `damage` - 造成伤害
- `heal` - 治疗
- `roll_dice` / `roll_check` - 投骰检定
- `attack_check` - 攻击检定

#### 音效特效（4 个）
- `play_sound` - 播放音效
- `play_effect` - 播放特效
- `shake_camera` - 震动屏幕
- `flash_screen` - 闪光效果

#### 数学随机（6 个）
- `random_int` / `random_float` - 随机数
- `random_choice` - 随机选择
- `random_weighted` - 加权随机
- `math_clamp` / `math_lerp` / `math_round` - 数学函数

#### 条件系统（1 个）
- `check_condition` - 检查条件（支持复杂嵌套）

---

### 完备性总结

**总 API 数量**：约 **70+ 个**

**覆盖的能力域**：
1. ✅ 数据存储与访问
2. ✅ 容器与转移
3. ✅ 关系与图
4. ✅ 查询与过滤
5. ✅ 计算与表达式
6. ✅ 实体生命周期
7. ✅ 状态系统
8. ✅ 事件系统
9. ✅ 控制流
10. ✅ 节点操作
11. ✅ 变量与存储
12. ✅ UI 与交互
13. ✅ 战斗与伤害
14. ✅ 音效与特效

**经过验证的复杂用例**：
1. ✅ 商店系统
2. ✅ 任务系统
3. ✅ 对话树
4. ✅ 合成系统
5. ✅ Boss 战（多阶段）
6. ✅ 装备词缀（荆棘反伤）
7. ✅ 连招系统
8. ✅ 动态地图生成
9. ✅ 技能冷却
10. ✅ 天赋树

---

## 第四部分：配置文件格式设计

### 实体配置格式

```typescript
interface EntityDefinition {
  id: string;
  type: string;
  category: "living" | "vehicle" | "container" | "portal" | "bed" | "environmental";
  
  // 基础属性
  properties?: Record<string, any>;
  
  // 组件配置
  components?: ComponentConfig[];
  
  // 标签
  tags?: string[];
  
  // 被动效果
  passive_effects?: PassiveEffect[];
  
  // 动作定义
  actions?: ActionDefinition[];
  
  // 事件规则
  rules?: Rule[];
  
  // 初始关系
  relations?: { to: string, type: string, metadata?: any }[];
  
  // 初始化动作
  on_spawn?: Action[];
  
  // 销毁时动作
  on_destroy?: Action[];
}
```

**示例：僵尸配置**

```json
{
  "id": "zombie",
  "type": "zombie",
  "category": "living",
  "properties": {
    "hp": 3,
    "max_hp": 3,
    "attack": 1,
    "perception_threshold": 5
  },
  "tags": ["enemy", "undead", "zombie"],
  "components": [
    {
      "type": "LivingStats",
      "config": {
        "hp": 3,
        "max_hp": 3
      }
    },
    {
      "type": "NPCStateMachine",
      "config": {
        "initial_state": "patrolling",
        "patrol_route": "route_1"
      }
    }
  ],
  "actions": [
    {
      "id": "zombie_attack",
      "name": "僵尸攻击",
      "cost": { "ap": 1 },
      "conditions": [
        {
          "type": "expression",
          "expression": "distance(this, target) == 0"
        }
      ],
      "effects": [
        {
          "api": "damage",
          "params": {
            "target": "{{target}}",
            "value": 1,
            "source": "this"
          }
        }
      ]
    }
  ],
  "rules": [
    {
      "id": "zombie_chase",
      "trigger": {
        "type": "on_event",
        "event": "sound_heard"
      },
      "conditions": [
        {
          "type": "expression",
          "expression": "event.volume >= this.properties.perception_threshold"
        }
      ],
      "actions": [
        {
          "api": "set_property",
          "params": {
            "target": "this",
            "path": "state_machine.current",
            "value": "chasing"
          }
        }
      ]
    }
  ]
}
```

---

### 物品配置格式

```typescript
interface ItemDefinition {
  id: string;
  type: string;
  name: string;
  description?: string;
  
  // 占位
  slots: 1 | 2;
  
  // 标签
  tags?: string[];
  
  // 属性
  properties?: Record<string, any>;
  
  // 授予的动作
  granted_actions?: ActionDefinition[];
  
  // 被动效果
  passive_effects?: PassiveEffect[];
  
  // 装备条件
  equip_conditions?: Condition[];
  
  // 使用效果
  on_use?: Action[];
  
  // 装备时
  on_equip?: Action[];
  
  // 卸下时
  on_unequip?: Action[];
}
```

**示例：治疗药水配置**

```json
{
  "id": "healing_potion",
  "type": "consumable",
  "name": "治疗药水",
  "description": "恢复 2 点生命值",
  "slots": 1,
  "tags": ["consumable", "healing"],
  "properties": {
    "heal_amount": 2,
    "stack_limit": 5
  },
  "on_use": [
    {
      "api": "heal",
      "params": {
        "target": "player",
        "value": "{{this.properties.heal_amount}}"
      }
    },
    {
      "api": "show_message",
      "params": {
        "text": "恢复了 {{this.properties.heal_amount}} 点生命！",
        "style": "healing"
      }
    },
    {
      "api": "play_effect",
      "params": {
        "effect": "healing_sparkle",
        "location": "player"
      }
    },
    {
      "api": "destroy_entity",
      "params": {
        "entity": "this"
      }
    }
  ]
}
```

**示例：荆棘护甲配置**

```json
{
  "id": "thorns_armor",
  "type": "armor",
  "name": "荆棘护甲",
  "description": "受击时反伤 2 点",
  "slots": 1,
  "tags": ["armor", "heavy"],
  "properties": {
    "defense": 5,
    "thorns_damage": 2
  },
  "passive_effects": [
    {
      "id": "thorns_反伤",
      "trigger": {
        "type": "on_event",
        "event": "entity_damaged"
      },
      "conditions": [
        {
          "type": "expression",
          "expression": "event.target == wearer && event.source != null"
        }
      ],
      "actions": [
        {
          "api": "damage",
          "params": {
            "target": "{{event.source}}",
            "value": "{{this.properties.thorns_damage}}",
            "damage_type": "true"
          }
        },
        {
          "api": "show_message",
          "params": {
            "text": "荆棘反伤！"
          }
        }
      ]
    }
  ]
}
```

---

### 节点配置格式

```typescript
interface NodeDefinition {
  id: string;
  type: "large" | "medium" | "small" | "transition";
  name: string;
  
  // 属性
  properties?: Record<string, any>;
  
  // 标签
  tags?: string[];
  
  // 连接
  connections?: ConnectionConfig[];
  
  // 初始实体
  initial_entities?: {
    type: string;
    properties?: Record<string, any>;
    count?: number;
  }[];
  
  // 环境状态
  environment_status?: EnvironmentStatus[];
  
  // 事件规则
  rules?: Rule[];
}
```

**示例：陷阱房间配置**

```json
{
  "id": "trap_room",
  "type": "medium",
  "name": "陷阱房间",
  "tags": ["dangerous", "indoor"],
  "properties": {
    "trap_armed": true,
    "trap_damage": 3
  },
  "connections": [
    {
      "to": "hallway",
      "type": "door",
      "bidirectional": true
    }
  ],
  "initial_entities": [
    {
      "type": "chest",
      "properties": {
        "locked": true,
        "loot_table": "rare"
      }
    }
  ],
  "rules": [
    {
      "id": "trigger_trap",
      "trigger": {
        "type": "on_event",
        "event": "entity_enter"
      },
      "conditions": [
        {
          "type": "expression",
          "expression": "this.properties.trap_armed"
        },
        {
          "type": "expression",
          "expression": "event.entity.category == 'living'"
        }
      ],
      "actions": [
        {
          "api": "damage",
          "params": {
            "target": "{{event.entity}}",
            "value": "{{this.properties.trap_damage}}",
            "damage_type": "physical"
          }
        },
        {
          "api": "play_effect",
          "params": {
            "effect": "spike_trap",
            "location": "this"
          }
        },
        {
          "api": "set_property",
          "params": {
            "target": "this",
            "path": "properties.trap_armed",
            "value": false
          }
        }
      ],
      "one_shot": true
    }
  ]
}
```

---

### 规则配置格式

```typescript
interface Rule {
  id?: string;
  
  // 触发器
  trigger: {
    type: "on_event" | "on_turn_start" | "on_turn_end" | "continuous";
    event?: string;
  };
  
  // 条件
  conditions?: Condition[];
  
  // 动作
  actions: Action[];
  
  // 优先级
  priority?: number;
  
  // 是否只触发一次
  one_shot?: boolean;
}
```

---

### 动作配置格式

```typescript
interface Action {
  api: string;
  params?: Record<string, any>;
  store?: string;  // 存储返回值到变量
  context?: Record<string, any>;  // 上下文变量
}
```

---

### 条件配置格式

```typescript
type Condition = 
  | { type: "expression", expression: string }
  | { type: "has_property", target: Reference, path: string }
  | { type: "has_item", container: Reference, item: string, count?: number }
  | { type: "has_status", target: Reference, status: string }
  | { type: "relation", from: Reference, to: Reference, relation: string }
  | { type: "and", conditions: Condition[] }
  | { type: "or", conditions: Condition[] }
  | { type: "not", condition: Condition };
```

---

## 第五部分：缺失分析与补充

### 当前缺失的 API

#### 1. 动作执行相关

```typescript
// 执行一个动作配置
execute_action(action: Action, context?: Record<string, any>): any

// 示例
{
  "api": "execute_action",
  "params": {
    "action": {
      "api": "damage",
      "params": { "target": "enemy", "value": 3 }
    },
    "context": { "enemy": "entity:123" }
  }
}
```

---

#### 2. 组件操作

```typescript
// 添加组件
add_component(entity: Reference, component: ComponentConfig): void

// 移除组件
remove_component(entity: Reference, component_type: string): void

// 获取组件
get_component(entity: Reference, component_type: string): any

// 示例
{
  "api": "add_component",
  "params": {
    "entity": "player",
    "component": {
      "type": "Burning",
      "config": { "damage_per_turn": 2, "duration": 3 }
    }
  }
}
```

---

#### 3. 标签操作

```typescript
// 添加标签
add_tag(target: Reference, tag: string): void

// 移除标签
remove_tag(target: Reference, tag: string): void

// 检查标签
has_tag(target: Reference, tag: string): boolean

// 示例
{
  "api": "add_tag",
  "params": {
    "target": "entity:zombie",
    "tag": "elite"
  }
}
```

---

#### 4. 临时修改器系统

```typescript
// 应用临时修改器
apply_modifier(target: Reference, modifier: Modifier): void

interface Modifier {
  id: string;
  type: "multiply" | "add" | "set";
  stat: string;
  value: number;
  duration?: number;  // 回合数，-1 = 永久
  source?: Reference;
}

// 示例：临时攻击力提升
{
  "api": "apply_modifier",
  "params": {
    "target": "player",
    "modifier": {
      "id": "strength_buff",
      "type": "add",
      "stat": "attack",
      "value": 5,
      "duration": 3
    }
  }
}

// 移除修改器
remove_modifier(target: Reference, modifier_id: string): void
```

---

#### 5. 序列化与保存

```typescript
// 保存游戏状态
save_game(slot: string, metadata?: Record<string, any>): void

// 加载游戏状态
load_game(slot: string): GameState

// 导出实体数据
export_entity(entity: Reference): EntityData

// 导入实体数据
import_entity(data: EntityData, location?: Reference): Reference
```

---

#### 6. 调试工具

```typescript
// 日志输出
log(message: string, level?: "info" | "warning" | "error"): void

// 断点（开发模式）
breakpoint(condition?: Condition): void

// 性能监控
profile_start(label: string): void
profile_end(label: string): void
```

---

### 扩展建议

#### 1. 宏系统

```typescript
// 定义宏（可重用的动作序列）
define_macro(name: string, params: string[], actions: Action[]): void

// 调用宏
call_macro(name: string, args: Record<string, any>): any

// 示例
{
  "api": "define_macro",
  "params": {
    "name": "damage_and_heal",
    "params": ["target", "damage_value", "heal_value"],
    "actions": [
      {
        "api": "damage",
        "params": { "target": "{{target}}", "value": "{{damage_value}}" }
      },
      {
        "api": "heal",
        "params": { "target": "player", "value": "{{heal_value}}" }
      }
    ]
  }
}

{
  "api": "call_macro",
  "params": {
    "name": "damage_and_heal",
    "args": {
      "target": "enemy",
      "damage_value": 5,
      "heal_value": 2
    }
  }
}
```

---

#### 2. 表达式函数库

```typescript
// 内置函数（在表达式中可用）
distance(a: Reference, b: Reference): number
in_same_node(a: Reference, b: Reference): boolean
in_same_micro_scene(a: Reference, b: Reference): boolean
count_nearby(center: Reference, radius: number, filter: EntityFilter): number
has_line_of_sight(from: Reference, to: Reference): boolean

// 示例（在表达式中使用）
{
  "type": "expression",
  "expression": "distance(player, enemy) <= 2 && has_line_of_sight(player, enemy)"
}
```

---

#### 3. 动画控制

```typescript
// 播放动画
play_animation(entity: Reference, animation: string, params?: Record<string, any>): void

// 等待动画完成
await_animation(entity: Reference): Promise<void>

// 示例
{
  "api": "play_animation",
  "params": {
    "entity": "player",
    "animation": "attack_slash",
    "params": { "speed": 1.5 }
  }
}
```

---

## 第六部分：实现优先级建议

### 第一阶段：核心 CRUD（必需）

**优先级：P0**

1. 数据操作：`get_property`, `set_property`, `modify_property`
2. 容器操作：`container_add`, `container_remove`, `container_transfer`
3. 实体生命周期：`spawn_entity`, `destroy_entity`, `move_entity`
4. 控制流：`if`, `for_each`
5. 事件系统：`emit_event`, `subscribe_event`

**完成后可实现**：基础商店、简单任务、物品拾取

---

### 第二阶段：战斗与交互（高优先级）

**优先级：P1**

1. 战斗系统：`damage`, `heal`, `roll_dice`, `attack_check`
2. 状态系统：`apply_status`, `remove_status`, `has_status`
3. UI 交互：`show_message`, `show_dialogue`, `show_ui`
4. 查询系统：`find_entities`, `find_nearest`, `get_distance`

**完成后可实现**：战斗系统、对话系统、状态效果

---

### 第三阶段：高级功能（中优先级）

**优先级：P2**

1. 关系系统：`set_relation`, `get_relation`, `find_related`
2. 节点操作：`set_node_property`, `apply_node_status`, `create_connection`
3. 变量系统：`set_var`, `get_var`
4. 随机系统：`random_int`, `random_choice`, `random_weighted`
5. 高级控制流：`while`, `delay`, `batch`

**完成后可实现**：复杂 AI、动态地图、随机事件

---

### 第四阶段：辅助工具（低优先级）

**优先级：P3**

1. 音效特效：`play_sound`, `play_effect`, `shake_camera`
2. 标签操作：`add_tag`, `remove_tag`, `has_tag`
3. 组件操作：`add_component`, `remove_component`
4. 修改器系统：`apply_modifier`, `remove_modifier`
5. 调试工具：`log`, `breakpoint`, `profile_start`

**完成后可实现**：完整的视听反馈、调试支持

---

## 第七部分：与现有设计的对齐

### 对齐检查清单

#### 1. AP 系统对齐 ✅

**现有设计**（02_游戏机制）：
- 1 AP 铁律：一个动作永远消耗 1 AP
- 零费动作依附于付费动作

**API 支持**：
```typescript
interface ActionDefinition {
  cost: {
    ap: 0 | 1;  // 只允许 0 或 1
    stamina?: number;
    items?: ItemId[];
  };
}
```

✅ **完全对齐**

---

#### 2. 容器系统对齐 ✅

**现有设计**（04_物品与装备）：
- 槽位：2 手 + 2/4 格背包
- 死亡背包：只出不进的容器

**API 支持**：
```typescript
// 添加/移除/转移
container_add(container, item, slot?)
container_remove(container, item)
container_transfer(from, to, item, slot?)

// 死亡背包配置
{
  "type": "death_backpack",
  "properties": {
    "read_only": true,  // 只出不进
    "capacity": 4
  }
}
```

✅ **完全对齐**

---

#### 3. 距离范式对齐 ✅

**现有设计**（术语表）：
```
同微型场景         = 0
同天然场景不同微型 = 1
跨天然场景         +1（大场景 ×2）
```

**API 支持**：
```typescript
get_distance(from: Reference, to: Reference): number

// 内部实现遵循距离范式
function getDistance(from, to) {
  if (sameMicroScene(from, to)) return 0;
  if (sameNaturalScene(from, to)) return 1;
  
  const path = findPath(from.naturalScene, to.naturalScene);
  let distance = path.length - 1;
  
  // 大场景 ×2
  for (const node of path) {
    if (node.type === 'large') distance += 1;
  }
  
  return distance;
}
```

✅ **完全对齐**

---

#### 4. 状态系统对齐 ✅

**现有设计**（02_游戏机制）：
- 倒地双态：零血倒地（濒死）vs 普通倒地（击倒）
- 状态有持续时间、打断条件

**API 支持**：
```typescript
apply_status(target, status: StatusEffect)

interface StatusEffect {
  type: string;
  duration: number;
  on_apply?: Action[];
  on_tick?: Action[];
  on_remove?: Action[];
  metadata?: Record<string, any>;
}

// 零血倒地
{
  "type": "downed_zero_hp",
  "duration": -1,  // 永久（直到被处决）
  "metadata": {
    "can_be_executed": true,
    "still_roll_dice": true
  }
}

// 普通倒地
{
  "type": "downed_knockdown",
  "duration": -1,  // 直到站起
  "metadata": {
    "can_crawl": true,
    "can_stand_up": true
  }
}
```

✅ **完全对齐**

---

#### 5. 枪械系统对齐 ✅

**现有设计**（04_物品与装备）：
- 谱型 + 距离 DC 表
- 投骰 ≥ DC 命中

**API 支持**：
```typescript
attack_check(attacker, target, weapon): AttackResult

// 武器配置
{
  "id": "pistol",
  "type": "gun",
  "properties": {
    "profile": "Pistol",
    "base_damage": 2,
    "dc_table": {
      "0": 2, "1": 3, "2": 4, "3": 5, "4": 6, "5+": 6
    }
  }
}

// 内部实现
function attackCheck(attacker, target, weapon) {
  const distance = getDistance(attacker, target);
  const dc = weapon.properties.dc_table[distance] || weapon.properties.dc_table["5+"];
  const roll = rollDice(6);
  
  const hit = roll >= dc;
  const crit = roll >= dc + 2;
  
  return {
    hit,
    crit,
    damage: hit ? (crit ? weapon.properties.base_damage + 1 : weapon.properties.base_damage) : 0
  };
}
```

✅ **完全对齐**

---

#### 6. NPC AI 对齐 ✅

**现有设计**（07_AI 系统）：
- 守卫范式：状态机（patrolling → listening → chasing → attacking）
- 感知系统：声音传播

**API 支持**：
```typescript
// NPC 配置
{
  "type": "zombie",
  "components": [
    {
      "type": "NPCStateMachine",
      "config": {
        "states": {
          "patrolling": { /* ... */ },
          "listening": { /* ... */ },
          "chasing": { /* ... */ },
          "attacking": { /* ... */ }
        },
        "initial_state": "patrolling"
      }
    }
  ],
  "properties": {
    "perception_threshold": 5
  },
  "rules": [
    {
      "trigger": { "type": "on_event", "event": "sound_heard" },
      "conditions": [
        { "type": "expression", "expression": "event.volume >= this.properties.perception_threshold" }
      ],
      "actions": [
        { "api": "set_property", "params": { "target": "this", "path": "state_machine.current", "value": "listening" }}
      ]
    }
  ]
}
```

✅ **完全对齐**

---

#### 7. 节点系统对齐 ✅

**现有设计**（03_空间系统）：
- 天然场景：large/medium/small
- 微型场景：实体创建的空间
- 连接数上限：5/4/3

**API 支持**：
```typescript
// 节点配置
{
  "id": "room_a",
  "type": "medium",  // 连接上限 4
  "properties": {
    "max_connections": 4
  },
  "connections": [
    { "to": "hallway", "type": "door" },
    { "to": "room_b", "type": "window" }
  ]
}

// 创建微型场景（由实体创建）
{
  "entity_id": "car",
  "type": "vehicle",
  "properties": {
    "creates_micro_scene": true,
    "micro_scene_capacity": 4
  }
}

// API
create_connection(from, to, config)
remove_connection(from, to)
```

✅ **完全对齐**

---

### 需要补充的特定 API

#### 1. 令其长眠（Execute）

```typescript
execute_downed(executor: Reference, target: Reference): void

// 实现
function executeDowned(executor, target) {
  // 检查前置条件
  if (!hasStatus(target, "downed_zero_hp")) {
    throw new Error("目标未处于零血倒地状态");
  }
  
  if (getDistance(executor, target) !== 0) {
    throw new Error("必须在同一微型场景");
  }
  
  // 执行效果
  destroyEntity(target);
  
  // 体力回满
  setProperty(executor, "properties.stamina", 5);
  
  // 生成死亡背包
  const deathBackpack = spawnEntity({
    type: "death_backpack",
    location: target.location,
    properties: {
      read_only: true,
      capacity: target.inventory.capacity,
      items: [...target.inventory.items]
    }
  });
  
  // 视觉效果
  playEffect("execute_effect", target.location);
  showMessage("体力回满！");
  
  emitEvent("entity_executed", {
    executor: executor.id,
    target: target.id
  });
}
```

---

#### 2. 强力骰（Stamina Boost）

```typescript
set_stamina_boost(player: Reference, boost: number): void

// 配置
{
  "rules": [
    {
      "trigger": { "type": "on_event", "event": "before_dice_roll" },
      "actions": [
        {
          "api": "get_property",
          "params": { "target": "player", "path": "properties.stamina_boost" },
          "store": "boost"
        },
        {
          "api": "if",
          "condition": { "type": "expression", "expression": "boost > 0" },
          "then": [
            {
              "api": "modify_property",
              "params": { "target": "player", "path": "properties.stamina", "op": "-", "value": "{{boost}}" }
            },
            {
              "api": "set_var",
              "params": { "name": "event.roll_modifier", "value": "{{boost}}" }
            }
          ]
        }
      ]
    },
    {
      "trigger": { "type": "on_event", "event": "after_ap_resolution" },
      "conditions": [
        { "type": "expression", "expression": "event.player.ap == 0" }
      ],
      "actions": [
        {
          "api": "get_property",
          "params": { "target": "player", "path": "properties.stamina_boost" },
          "store": "boost"
        },
        {
          "api": "modify_property",
          "params": { "target": "player", "path": "properties.stamina", "op": "+", "value": "{{boost}}" }
        },
        {
          "api": "show_message",
          "params": { "text": "零挫败退还 {{boost}} 点体力" }
        }
      ]
    }
  ]
}
```

---

#### 3. 格挡系统

```typescript
// 盾牌配置
{
  "id": "human_shield",
  "type": "shield",
  "properties": {
    "durability": 2,
    "blocks": ["melee", "ranged"],
    "cannot_block": ["heavy"]
  },
  "passive_effects": [
    {
      "trigger": { "type": "on_event", "event": "before_damage" },
      "conditions": [
        { "type": "has_status", "target": "wearer", "status": "blocking" },
        { "type": "expression", "expression": "!event.tags.includes('heavy')" }
      ],
      "actions": [
        {
          "api": "set_var",
          "params": { "name": "event.damage", "value": 0 }
        },
        {
          "api": "modify_property",
          "params": { "target": "this", "path": "properties.durability", "op": "-", "value": 1 }
        },
        {
          "api": "remove_status",
          "params": { "target": "wearer", "status": "blocking" }
        },
        {
          "api": "if",
          "condition": { "type": "expression", "expression": "this.properties.durability <= 0" },
          "then": [
            { "api": "destroy_entity", "params": { "entity": "this" }},
            { "api": "show_message", "params": { "text": "盾牌破损！" }}
          ]
        }
      ]
    }
  ]
}
```

---

## 第八部分：最终总结与建议

### 完备性评估

**已覆盖的能力**：

✅ 数据 CRUD（读写删改）  
✅ 容器系统（物品转移）  
✅ 关系图谱（实体关系）  
✅ 查询过滤（查找实体/节点）  
✅ 表达式计算（条件判断）  
✅ 实体生命周期（创建/销毁/移动）  
✅ 状态系统（应用/移除/查询）  
✅ 事件系统（发射/订阅/延迟）  
✅ 控制流（if/for/while/delay）  
✅ 节点操作（连接/属性/状态）  
✅ 变量系统（局部/玩家/全局）  
✅ UI 交互（消息/对话/面板）  
✅ 战斗系统（伤害/治疗/检定）  
✅ 音效特效（声音/视觉反馈）  

**验证通过的复杂用例**：

1. ✅ 商店系统（价格检查、金币扣除、物品转移）
2. ✅ 任务系统（进度追踪、事件订阅、奖励发放）
3. ✅ 对话树（多分支、条件选项、状态切换）
4. ✅ 合成系统（材料检查、消耗、成品生成）
5. ✅ Boss 战（多阶段、无敌状态、召唤小怪）
6. ✅ 装备词缀（荆棘反伤、被动触发）
7. ✅ 连招系统（序列追踪、时间窗口、连招识别）
8. ✅ 动态地图（运行时生成、随机连接、物品放置）
9. ✅ 技能冷却（冷却追踪、回合递减、使用限制）
10. ✅ 天赋树（前置检查、点数消耗、属性加成）

---

### 与现有设计的契合度

| 系统 | 对齐状态 | 备注 |
|---|---|---|
| AP 系统 | ✅ 完全对齐 | 1 AP 铁律、零费动作 |
| 容器系统 | ✅ 完全对齐 | 槽位、死亡背包 |
| 距离范式 | ✅ 完全对齐 | 0/1/+1 规则 |
| 状态系统 | ✅ 完全对齐 | 倒地双态、持续时间 |
| 枪械系统 | ✅ 完全对齐 | 谱型 + 距离 DC 表 |
| NPC AI | ✅ 完全对齐 | 守卫范式、状态机 |
| 节点系统 | ✅ 完全对齐 | 天然/微型场景、连接上限 |
| 令其长眠 | ✅ 已补充 | 专用 API |
| 强力骰 | ✅ 已补充 | 事件规则实现 |
| 格挡系统 | ✅ 已补充 | 被动效果实现 |

---

### API 总数统计

**核心 API**：约 **75 个**

按优先级分布：
- P0（必需）：15 个
- P1（高优）：12 个
- P2（中优）：25 个
- P3（低优）：23 个

---

### 实现建议

#### 第一步：核心引擎（P0）

**目标**：能跑通简单的 RPG 逻辑

1. 数据存储：`get_property`, `set_property`, `modify_property`
2. 容器系统：`container_add`, `container_remove`, `container_transfer`
3. 实体生命周期：`spawn_entity`, `destroy_entity`, `move_entity`
4. 控制流：`if`, `for_each`
5. 事件系统：`emit_event`, `subscribe_event`

**验证里程碑**：能实现"商店购买物品"

---

#### 第二步：战斗与交互（P1）

**目标**：能实现完整的战斗和对话

1. 战斗系统：`damage`, `heal`, `roll_dice`
2. 状态系统：`apply_status`, `remove_status`
3. UI 交互：`show_message`, `show_dialogue`
4. 查询系统：`find_entities`, `get_distance`

**验证里程碑**：能实现"击杀 5 只僵尸任务 + 对话树"

---

#### 第三步：高级功能（P2）

**目标**：能实现复杂的游戏系统

1. 关系系统：`set_relation`, `find_related`
2. 节点操作：`apply_node_status`, `create_connection`
3. 随机系统：`random_int`, `random_choice`
4. 高级控制流：`while`, `delay`

**验证里程碑**：能实现"Boss 战 + 动态地图生成"

---

#### 第四步：辅助工具（P3）

**目标**：完善体验和开发工具

1. 音效特效：`play_sound`, `play_effect`
2. 标签操作：`add_tag`, `has_tag`
3. 修改器系统：`apply_modifier`
4. 调试工具：`log`, `breakpoint`

**验证里程碑**：完整的游戏体验 + 调试支持

---

### 扩展性保证

#### 1. 正交性

每个 API 只做一件事，不与其他 API 耦合。

**示例**：
- `damage` 只造成伤害，不检查距离
- `get_distance` 只计算距离，不判断射程
- 射程检查由规则层组合实现

---

#### 2. 组合性

复杂逻辑由简单 API 组合而成。

**示例**：吸血剑
```json
{
  "passive_effects": [
    {
      "trigger": { "type": "on_event", "event": "entity_damaged" },
      "conditions": [
        { "type": "expression", "expression": "event.source == wearer" }
      ],
      "actions": [
        {
          "api": "heal",
          "params": {
            "target": "wearer",
            "value": "{{event.damage * 0.3}}"
          }
        }
      ]
    }
  ]
}
```

---

#### 3. 数据驱动

所有游戏逻辑都在配置文件中，不需要代码。

**示例**：新增一个 Boss
- 不需要写代码
- 只需要配置 JSON
- 复用现有 API

---

#### 4. 模块化

每个系统独立实现，可单独测试。

**示例**：
- 容器系统不依赖战斗系统
- 状态系统不依赖节点系统
- 事件系统是所有系统的基础

---

### 最终结论

**这套 API 设计已达到完备性要求**：

✅ **覆盖所有常见 RPG 机制**  
✅ **与现有设计完全对齐**  
✅ **通过 10+ 复杂用例验证**  
✅ **具有良好的扩展性**  
✅ **数据驱动，零代码创作**  

**后续工作**：
1. 实现 P0 核心 API（15 个）
2. 编写单元测试
3. 实现 P1 战斗交互（12 个）
4. 用实际地图验证
5. 逐步完善 P2/P3 功能

---

**本文档状态**：完备性设计完成，待实现验证  
**最后更新**：2026-08-02  
**依赖**：所有 v2 设计文档

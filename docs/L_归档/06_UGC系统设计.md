# UGC系统设计

## 核心理念

### "较低的创作自由，创造了大多数人绝对的创造自由"

传统UGC平台的问题：
- **Roblox/Minecraft Mod**：自由度极高，但需要编程能力
- **结果**：99%的玩家只能消费，无法创作

本引擎的解决方案：
- **限制创作维度**：只能操作节点、实体、规则组合
- **降低创作门槛**：用自然语言描述，LLM自动转换
- **保证系统稳定**：无论怎么创作都不会崩溃

### UGC友好的报错与鲁棒性系统

系统稳定不只是"不崩溃"，还包括**出问题时如何对待创作者**。这是一个处处为 UGC 玩家设身处地思考的系统——无论是报错文案还是缺省行为，出发点都是"站在不懂代码的创作者角度，他现在需要知道什么、需要我怎么帮他"。

**报错分级**：
- **系统级错误**：意味着底层基底出了问题，直接终止
- **玩法包级错误**：计入警告日志，尽量让游戏继续；但如果触发了循环检测等监测器、或确实无法继续运行，则优先级升维为终止级

**载入时审查**：
- 玩法包尝试载入时，逐项审查是否违反设计原则、是否与已加载内容冲突（未来可能还有其他拒绝理由）
- 一旦命中，拒绝载入，并**明确指出玩法包中具体是哪一部分出了问题**
- 载入监测模块与核心运行时**解耦**，后续可以持续追加更多辅助性、建议性的警告规则，不需要改动内核

**报错文案原则**：
- 无论系统级还是玩法包级，都要给出**详尽、设身处地**的错误原因解释和可行的解决建议
- 禁止只抛一个冷冰冰的错误码——创作者大多不是程序员，看不懂就等于没有反馈

**素材与字段缺失的鲁棒性兜底**（数据层面，非表现层）：
- 玩法包可以只改数值（被引用到的地方视为覆盖）、只换素材，也可以连地图和组件一起替换——鲁棒性策略要覆盖所有粒度
- 加载时遇到空引用或损坏数据：
  - 修改已有字段但新值缺失/损坏（如图片引用打不开）→ **换回原有值**
  - 新增字段缺失（如新增了一个物品但没给素材）→ **用同类型的默认值填充**（例如用默认物品顶上）
- 原则：任何"半成品"都不应该让加载失败，而是尽可能优雅退化成已知可用的状态

## 数值约束：禁止5以上的数字

### 硬性规则
**所有玩家可见的数值严格限制在1-5范围内，无例外**

包括：
- 生命值：1-5
- 伤害：1-5
- AP成本：1-5
- 持续回合：1-5
- 物品槽位：1-5（左右手+左右口袋+背包2=6槽是硬编码）
- 连接节点数：1-5

### 为什么这个约束是天才的

#### 1. 防止数值膨胀
```
错误示例（传统UGC）：
玩家A：我做一把10000HP的无敌神装
玩家B：我做一把999999伤害的枪

结果：游戏平衡崩溃
```

```
正确示例（本引擎）：
玩家想做"核弹"：
- 不能写"造成999伤害"
- 被迫拆解为：
  * 对当前+相邻节点造成3点伤害（空间扩散）
  * 施加[辐射]状态，每回合1点伤害，持续5回合（时间扩散）
  * 使这些节点在5个回合里带有危险标记

结果：创意实现，但数值可控
```

#### 2. 逼迫维度拆解

创作者不能靠堆数字，必须思考如何用机制组合：
- ❌ "造成100点伤害"
- ✅ "造成3点伤害 + 眩晕2回合 + 武器掉落"

#### 3. 保持视觉清爽
- 玩家一眼就能数清任何数值
- 不需要计算器
- 符合"五并列"认知原则

### 内部数值例外

以下内部数值可以超过5（玩家不可见或不可修改）：
- 回合编号
- 实体数量
- 距离计算（节点间）
- 结算预算
- 性能统计

## 三层创作自由度

### 第一层：换皮（5秒完成）
选择已有实例，修改名字和数值

```json
基于实例：standard_pistol
修改：
- name: "黄金手枪"
- damage: 2 → 3
- appearance: "golden"
```

### 第二层：组装（1分钟完成）
从效果词条库选择组合

```
效果库：
- [攻击]
- [范围2]
- [附带冰冻状态]
- [持续2回合]

组合：
创建"冰雾枪" = [攻击] + [范围2] + [附带冰冻状态] + [持续2回合]
```

### 第三层：定义新词条（5分钟完成，LLM辅助）
描述新效果，LLM映射到基础原语

```
玩家："被击中后，下回合只能向后移动"

LLM拆解：
1. 触发条件：OnDamageTaken
2. 效果：AddStatus("restricted_movement", {
     duration: 1,
     allowed_actions: ["move_backward"]
   })
3. 需要定义：什么是"向后移动"？
   → 基于上一回合的位置，只能移动到远离的节点
```

## LLM作为规则编译器

### 工作流程

```
用户输入（自然语言）
    ↓
LLM理解意图
    ↓
边界追问补全
    ↓
生成结构化规则JSON
    ↓
静态验证
    ↓
沙箱测试
    ↓
通过 → 注入游戏
```

### 对话示例

```
玩家：我想做一个"香蕉皮"道具

LLM：收到。"香蕉皮"在我们的规则里是一个物品。玩家使用它会发生什么？

玩家：把它扔在地上，别人踩到会摔倒

LLM（追问边界）：
1. "扔在地上"是丢弃动作，它不需要花AP。踩到摔倒意味着，
   当其他玩家"移动进入该节点"时触发事件，对吗？
2. "摔倒"在我们的状态库里，是让目标获得[倒地]状态吗？
   持续几个回合？（提醒：不能超过5回合）
3. 香蕉皮是一次性的吗？踩完是否销毁？

玩家：对，踩完就没了，摔倒持续1个回合就行

LLM（生成配置）：
已为您生成。底层逻辑：
- 绑定OnPlayerEnterNode事件
- 检测Banana_Peel实体
- 施加Fallen状态(Duration: 1)
- 销毁Banana_Peel

是否确认创建？
```

### Agent 式创作流程（完整版）

上面的对话示例是简化版，完整流程还包含**初始化认知**与**创作后确认**两端：

**创作前：初始化认知**（LLM 在拆解需求前先做三件事）
1. 判断这个需求最好的实现方式是什么，以及哪些地方存在实现上的模糊空间
2. 猜测玩家可能想表达的几种意思（不能列太多），并给出自己的倾向
3. 判断玩家的需求里可能存在什么设计问题，或者有什么值得提醒、建议的地方

即便玩家给出的需求非常简单，LLM 也应该像一个 Agent 一样，引导他一步步拆解、给出文本反馈、再反复确认，而不是一次性猜测生成。如果某个实现需要素材，调用工具让玩家提交或绘制（前端职责）；玩家不提交则先用默认素材顶上，装载后可以随时在客户端替换。

**创作后：确认与固化**
- 创作完成后，LLM 完整复述一遍最终机制，玩家确认不再修改
- 确认后，保存本次创作的完整聊天记录，并可直接装载玩法包
- 玩家也可以选择导出玩法包（涉及网络与技术实现，非 MVP 范围）
- 哪怕玩家只是想改一个数值、不需要任何素材，也算一次完整的玩法包创作
- 玩法包不应该是冷冰冰的产物，应当有清晰的简介，方便他人在开房间/多人游戏时一眼判断这是什么、能不能上手

### LLM的职责边界

#### LLM可以做的
- ✅ 理解自然语言意图
- ✅ 追问补全边界条件
- ✅ 映射到已有规则原语
- ✅ 生成结构化JSON配置
- ✅ 给出易懂的解释

#### LLM不能做的
- ❌ 直接执行游戏逻辑（不是裁判）
- ❌ 运行任意代码
- ❌ 绕过静态验证
- ❌ 修改核心引擎不变量
- ❌ 生成超过5的数值

### 提示词设计原则

```
系统提示词（System Prompt）：【事实上这个工作会留到mvp后，极其完善且要测试】

你是《起床》游戏的规则编译助手。你的任务是帮助玩家将创意转化为
符合引擎规范的JSON配置。

核心约束：
1. 所有数值必须在1-5范围内
2. 只能使用已定义的效果原语
3. 必须追问不明确的边界条件
4. 生成的规则必须是确定性的（无二义性）
5. 禁止创建可能导致无限循环的规则

可用效果原语：
- MoveEntity
- TransferEntity
- DealDamage
- ApplyStatus
- RemoveStatus
- ...

对话模式：
1. 理解用户意图
2. 如果有歧义，追问具体细节
3. 确认所有边界条件后，生成JSON
4. 解释生成的规则，等待用户确认
```

## 规则描述语言（DSL）

### 标准格式

所有规则都用JSON描述，遵循统一schema：

```json
{
  "rule_id": "banana_peel_trap",
  "trigger": {
    "event": "OnPlayerEnterNode",
    "filter": {
      "node_contains": "item:banana_peel"
    }
  },
  "conditions": [
    {
      "type": "entity_exists",
      "entity": "item:banana_peel"
    }
  ],
  "effects": [
    {
      "type": "apply_status",
      "target": "$event.player",
      "status": "fallen",
      "duration": 1
    },
    {
      "type": "remove_entity",
      "entity": "item:banana_peel"
    }
  ]
}
```

### 变量系统

```json
变量引用：
$event.player        // 触发事件的玩家
$event.target        // 事件目标
$source.owner        // 来源的所有者
$target.location     // 目标的位置

条件表达式：
{
  "type": "resource_check",
  "entity": "$event.player",
  "resource": "health",
  "operator": "<=",
  "value": 2
}
```

### 复用规则系统

常见规则可以定义为复用单元：

```json
{
  "template": "apply_status_on_damage",
  "parameters": {
    "status_name": "string",
    "duration": "number (1-5)",
    "chance": "number (0-100)"
  },
  "implementation": {
    "trigger": "OnDamageTaken",
    "effects": [
      {
        "type": "apply_status",
        "status": "$params.status_name",
        "duration": "$params.duration",
        "chance": "$params.chance"
      }
    ]
  }
}
```

使用复用单元：
```json
{
  "use_template": "apply_status_on_damage",
  "params": {
    "status_name": "burning",
    "duration": 3,
    "chance": 50
  }
}
```

## 静态验证系统

### 验证检查清单

#### 1. 数值范围检查

游戏设计遵循**全对称信息原则**：规则中不存在"内核私有、玩家不可见"的数值，是否在 UI 上展示只是前端呈现取舍，不是验证器需要关心的维度。因此数值范围检查对遍历到的**所有数值字段一视同仁**，不做"是否玩家可见"这层过滤。若未来确有需要豁免范围检查的数值类型（如时间戳、随机种子等非 [1-5] 量纲字段），应通过 schema 中显式的字段类型标注（如 `unit: 'timestamp'`）豁免，而不是靠可见性判断。

```typescript
function validateNumbers(rule: Rule): ValidationError[] {
  const errors: ValidationError[] = [];
  
  // 递归检查所有数值字段，不做"玩家可见性"过滤
  traverse(rule, (key, value, fieldSchema) => {
    if (typeof value !== 'number') return;
    
    // 仅当 schema 显式标注了豁免量纲（如 unit: 'timestamp'）时才跳过
    if (fieldSchema?.unit && EXEMPT_UNITS.includes(fieldSchema.unit)) {
      return;
    }
    
    if (value < 1 || value > 5) {
      errors.push({
        field: key,
        value: value,
        message: `数值 ${value} 超出允许范围 [1-5]`
      });
    }
  });
  
  return errors;
}
```

#### 2. 循环检查
```typescript
function detectInfiniteLoop(rule: Rule): ValidationError[] {
  // 检查零费动作循环
  if (rule.ap_cost === 0) {
    // 必须有触发次数限制
    if (!rule.max_triggers_per_turn) {
      return [{
        message: "零费动作必须有每回合触发次数限制"
      }];
    }
  }
  
  // 检查状态相互触发
  const triggerGraph = buildTriggerGraph(allRules);
  const cycles = detectCycles(triggerGraph);
  
  if (cycles.length > 0) {
    return cycles.map(cycle => ({
      message: `检测到触发循环: ${cycle.join(' → ')}`
    }));
  }
  
  return [];
}
```

#### 3. 引用检查
```typescript
function validateReferences(rule: Rule): ValidationError[] {
  const errors: ValidationError[] = [];
  
  // 检查状态是否存在
  if (rule.type === 'apply_status') {
    if (!statusLibrary.has(rule.status)) {
      errors.push({
        message: `未定义的状态: ${rule.status}`
      });
    }
  }
  
  // 检查事件类型
  if (!validEvents.includes(rule.trigger.event)) {
    errors.push({
      message: `未知的事件类型: ${rule.trigger.event}`
    });
  }
  
  return errors;
}
```

#### 4. 权限检查
```typescript
function validatePermissions(rule: Rule, creator: User): boolean {
  // UGC创作者不能修改核心规则
  if (rule.modifies_core_mechanic) {
    return false;
  }
  
  // 不能绕过AP系统
  if (rule.grants_free_ap) {
    return false;
  }
  
  // 不能直接修改其他玩家的资源（必须通过动作）
  if (rule.direct_resource_modification) {
    return false;
  }
  
  return true;
}
```

### 沙箱测试

```typescript
function sandboxTest(rule: Rule): TestResult {
  // 创建隔离环境
  const sandbox = createSandbox();
  
  // 注入规则
  sandbox.loadRule(rule);
  
  // 运行测试场景
  const scenarios = generateTestScenarios(rule);
  const results = scenarios.map(scenario => {
    try {
      return sandbox.run(scenario);
    } catch (error) {
      return { error, scenario };
    }
  });
  
  // 检查结果
  const passed = results.every(r => !r.error);
  const performance = measurePerformance(results);
  
  return {
    passed,
    results,
    performance,
    warnings: checkForWarnings(results)
  };
}
```

## 内置创作模式

### 游戏内编辑器

#### 地图编辑器
```
功能：
1. 导入背景图片（2D）
2. 点击钉节点（拖拽放置）
3. 设置节点属性（大/中/微）
4. 连接节点（拖拽连线）
5. 放置门户（窗户、楼梯）
6. 放置实体（武器、道具、NPC）
7. 实时预览
8. 一键测试

输出：map.json
```

#### 物品编辑器
```
界面：
[名称] 电击枪
[体积] ○小型 ●中型 ○大型
[标签] ☑武器 ☐重型 ☑远程【图片是像素风，后期可以加入绘制器并缩放】

[提供动作]
  动作1: 射击
    消耗: [1] AP
    范围: [2] 节点
    伤害: [1]
    效果: [添加状态▼]
      状态: 眩晕
      持续: [1] 回合

[+添加动作] [+添加被动效果]

[保存] [测试] [分享]
```

### 局内即时UGC【全部实现为ugc打地基，但大部分落地都是mvp外】

#### 热更新模式（仅限房主）

```
场景：几个朋友在自定义房间玩，发现电瓶车太强

房主：
1. 打开LLM助手
2. 说："把电瓶车的撞击准备时间增加1回合"
3. LLM生成修改
4. 玩家投票确认
5. 下一回合直接生效

实现：
- 热更新只修改规则权重和数值
- 不能修改核心引擎逻辑
- 所有玩家看到修改内容并投票
- 修改记录到房间历史
```

### 民主议会模式

> **此功能属于 MVP 之后阶段，不在当前开发范围**。局内即时UGC的"民主议会模式"（社区投票修改规则）整节移出MVP。以下两套历史描述互相矛盾（本节为"50%+1票免费提案立即生效"，另一套见文末悬空代码块"1AP+LLM崩溃评估+投票"），保留作为未来重新设计时的参考素材，不作为当前实现依据。

```
提案机制：
1. 任何玩家可以提出规则修改
2. 显示修改前后对比
3. 所有玩家投票（50%+1通过）
4. 通过后立即生效

示例：
  玩家A提案："让僵尸血量从3降到2"
  [对比表]
    当前：僵尸HP=3
    修改后：僵尸HP=2
  
  [投票] 赞成: 3/5  反对: 2/5
  [通过] 下回合生效
```

---

## UGC 扩展能力层级

### 第一层：地图与物品（MVP 目标）

**能力范围**：
- 创建新地图：节点拓扑 + 场景类型 + 连接关系
- 创建新物品：武器/防具/消耗品，复用现有机制
- 放置实体：NPC 巡逻路线 + 物品分布

**不需要编程**：
- 使用游戏内编辑器拖拽
- 或用 LLM 自然语言描述 → 自动生成 JSON

**技术实现**：
- 静态 JSON 配置
- Linter 验证合法性
- 运行时沙盒保护

**UGC 友好性**：⭐⭐⭐⭐⭐（零门槛）

---

### 第二层：规则与玩法包（后续扩展）

**能力范围**：
- 修改玩法规则：胜利条件、缩圈规则、资源刷新
- 创建新状态：自定义 buff/debuff
- 设计事件触发：时间/条件 → 效果

**示例**：
```json
{
  "name": "感染模式",
  "rules": [
    {
      "event": "on_player_death",
      "condition": { "killed_by": "zombie" },
      "effect": {
        "spawn_entity": {
          "type": "zombie",
          "at": "death_location",
          "inherit_inventory": false
        }
      }
    },
    {
      "event": "on_turn_start",
      "condition": { "turn": 10 },
      "effect": {
        "spawn_item": {
          "type": "antidote",
          "at": "random_node",
          "count": 1
        }
      }
    }
  ],
  "win_condition": {
    "type": "survival",
    "duration": 30
  }
}
```

**需要的能力**：
- 理解基础逻辑（if/then）
- 使用规则编辑器 UI
- 或用 LLM 辅助生成

**技术实现**：
- 事件驱动系统（05 文档）
- 规则 DSL（纯声明式 JSON，条件/效果组合，非图灵完备，不存在"执行任意代码"这一概念，由引擎内置的固定解释器执行）
- JSON schema 校验 + 固定解释器执行，无需运行时沙箱（见"安全性考虑"）

**UGC 友好性**：⭐⭐⭐⭐（有学习曲线，但 LLM 可辅助）

---

### 第三层：整合包级别（专业创作者）

**能力范围**：
- 完整游戏模式：如《起床战争》风格的团队对抗
- 复杂机制组合：多阶段 Boss 战、动态剧情分支
- 自定义 UI 元素：计分板、任务追踪

**示例：整合包结构**
```
integration-pack/
├── maps/
│   ├── battlefield_01.json
│   ├── boss_arena.json
├── items/
│   ├── explosive_bow.json
│   ├── shield_generator.json
├── entities/
│   ├── boss_zombie.json
│   ├── trader_npc.json
├── rules/
│   ├── team_respawn.json
│   ├── boss_phase_transition.json
├── ui/
│   ├── scoreboard.json
│   └── quest_log.json
└── manifest.json
```

**需要的能力**：
- 系统性设计能力
- 深入理解引擎机制
- 可能需要脚本编程（Lua/JS，沙盒化）

**技术实现**：
- 模块化打包系统
- 依赖管理
- 版本兼容性检查
- **脚本沙盒**（如果允许脚本）：
  - 白名单 API
  - 指令计数限制
  - 禁止网络访问、文件系统访问

**UGC 友好性**：⭐⭐⭐（需要较高技术能力，但 0 追加设计保证可行性）

---

### 扩展能力的边界

**允许的扩展**：
- ✅ 新武器（复用谱型或定义新伤害类型）
- ✅ 新状态（定义触发条件和效果）
- ✅ 新 NPC 类型（调整守卫范式参数，或用内核行为原语拼装出新范式——内核只提供零件，范式本身是玩法包层的拼装产物）
- ✅ 新地图拓扑
- ✅ 新玩法规则（胜利条件、事件触发）
- ✅ 新环境效果（火/水/电微型场景状态）

**不允许的扩展**（需要修改引擎）：
- ❌ 修改 1 AP 铁律
- ❌ 新增基础数据结构（节点/物品/实体之外）
- ❌ 修改距离范式计算逻辑
- ❌ 修改投点分配机制
- ❌ 新增小数或 6 以上的数字
- ❌ 修改微型场景创建规则

**灰色地带（需要引擎支持，但可预留接口）**：
- ⚠️ 新的移动方式（如传送门、飞行）
- ⚠️ 时间倒流机制
- ⚠️ 多层嵌套微型场景
- ⚠️ 动态生成节点

**处理策略**：
- 核心引擎预留扩展点（Plugin API）
- 灰色地带通过 Feature Flag 控制
- 社区投票决定是否纳入官方引擎

---

## MVP 后的 UGC 路线图

### 阶段 1：基础 UGC（MVP）

**时间**：第一版发布
**能力**：
- 地图编辑器
- 物品编辑器
- 静态 JSON 配置
- Linter 验证
- 社区地图分享

**目标用户**：
- 所有玩家（零门槛创作）
- 内容：地图、武器、道具

---

### 阶段 2：规则编辑器

**时间**：MVP 后 3-6 个月
**能力**：
- 玩法包编辑器
- 事件触发系统
- 自定义状态
- LLM 辅助生成规则
- 局内即时UGC / 民主议会模式（社区投票修改规则）——具体方案待此阶段排期时重新设计，见前文"局内即时UGC"章节的历史素材

**目标用户**：
- 进阶玩家（理解基础逻辑）
- 内容：自定义模式（感染模式、团队赛）

---

### 阶段 3：整合包支持

**时间**：MVP 后 6-12 个月
**能力**：
- 模块化打包
- 脚本沙盒（可选）
- 自定义 UI
- 版本管理

**目标用户**：
- 专业创作者（有编程经验）
- 内容：完整游戏模式（类整合包）

---

### 阶段 4：AI 生成增强

**时间**：长期演进
**能力**：
- LLM 生成完整玩法包
- AI Agent 自动测试平衡性
- 社区投票 + AI 评分混合推荐

**目标**：
- 让 AI 成为创作助手
- 降低整合包创作门槛
- 自动化内容质量检测

---

## 当前 MVP 目标总结

**现在只需要实现**：
- ✅ 新增武器（复用 2×4 范式 + 谱型系统）
- ✅ 新增实体（复用守卫范式）
- ✅ 自己创建地图（节点拓扑 + 门户配置）

**这已经足够支撑丰富的 UGC 生态**：
- 玩家可以重现经典地图（童年校园、CS 地图）
- 可以设计新武器平衡（改变谱型参数）
- 可以布置 NPC 巡逻路线

**更复杂的整合包玩法**：
- 是未来的扩展方向
- 但不是 MVP 的必需
- 0 追加设计保证未来可以加入

**设计哲学**：
> 先把"地图 + 武器 + NPC"这个级别的 UGC 做到极致，再考虑整合包。
> 不要一开始就追求 Roblox 的自由度，那会牺牲稳定性和一致性。

---

## 底层完备后的三份文档

在完成完整的底层实现（不仅是代码与运行时，还包括玩法包加载、审查、报错交互的全套闭环）之后，需要准备三份持续迭代的文档，服务三种不同的读者：

1. **给开发者 / Agent 看的文档**：最直白的逻辑说明，帮助开发者在设计底层框架和玩法时敏锐察觉不合理与矛盾之处并优化；同时是最详细、最标准的 API 接口文档。Agent 在响应开发者需求时严格依照这一份**唯一事实源**，这是玩法迭代时的必备提示词，能让非底层的开发变得非常迅捷。
2. **给 AI 看的 prompt**：详尽到能让 AI 学会根据玩家的任何需求进行处理（见上文"Agent 式创作流程"）。这份 prompt 本身就是最需要迭代的部分——既要照顾玩家心理，又要对 AI 足够友好，还要把当下玩法的模板整理成可插拔的范本喂给 AI，让它知道该改哪里。
3. **给玩家看的协议**：与第 2 份相对，第 2 份是最严酷的 API，第 3 份则尽量提升可读性，尽可能"教会"玩家——会结合大逃杀等经典规则的例子，让读者看完就知道怎么写模组。面向使用图形化编辑器的玩家，以及真正有技术基础、愿意深入的热心开发者。

这三份文档是项目较后期的工作，但标准现在就定下来记录在案。在保证地基完备之后，第一份文档的初稿应当优先产出。

**已知的悬而未决的技术难题**：源标准玩法包的信息量过于庞大，如果要做到对每一个要素都能定位、可修改，可能需要让这个 prompt 本身具有完整的 Agent 能力（实时查询定位，而非把全部信息都塞进 prompt 里存着）。目前还没有想到具体的技术实现方式。

---

> **此功能属于 MVP 之后阶段，不在当前开发范围**。以下是"民主议会模式"的第二套历史描述（1AP+LLM崩溃评估+投票），与前文"局内即时UGC"章节下的第一套描述（50%+1票免费提案立即生效）互相矛盾。两套描述保留作为未来重新设计时的参考素材，不作为当前实现依据。

```
1. 任何玩家花费1 AP发起提案
2. 提案内容：修改某条规则
3. LLM实时评估（是否会崩溃）
4. 所有玩家投票（支持/反对）
5. 多数通过：规则即时生效
6. 画面显示："世界法则发生突变"

示例：
玩家A提案："教导主任移动速度翻倍"
玩家B投票：反对（他在教导主任附近）
玩家C投票：支持（他想看热闹）
玩家D投票：支持

结果：2:1通过，教导主任现在每回合移动2步
```

## UGC分享与分发

### 轻量数据传输

```
一张完整的UGC内容包：
- map_background.png (500KB)
- map_data.json (50KB)
- rules.json (20KB)
- assets.json (10KB)

总计：<1MB

对比传统Mod：
- 3D模型、贴图、音频等：数百MB到数GB
```

### 即时加载

```
流程：
1. 玩家点击加入房间
2. 客户端检查本地缓存
3. 如未缓存，下载JSON+图片（<1MB）
4. 解析并验证规则
5. 渲染地图
6. 0.1秒内完成，直接进入游戏

无需：
- 退出游戏
- 去工坊下载
- 重启游戏
- 处理版本冲突
```

### 版本管理

```json
{
  "content_id": "zombie_school_v1.2",
  "version": "1.2.0",
  "author": "player_12345",
  "created_at": "2026-08-01T10:00:00Z",
  "content_hash": "sha256:abcdef...",
  "dependencies": {
    "engine_version": ">=1.0.0",
    "required_features": ["portals", "status_effects"]
  },
  "changelog": {
    "1.2.0": "平衡调整：僵尸移动速度-1",
    "1.1.0": "新增：解药道具",
    "1.0.0": "初始版本"
  }
}
```

## UGC生态设计

### 双轨制内容生态

#### 官方天梯（The League）
```
特点：
- 严格平衡测试的标准规则
- 数值控制在1-5
- 用于排位/锦标赛
- 智力较量的竞技场

内容：
- 经典校园地图
- 标准大逃杀模式
- 夺旗模式
- 追逐模式
```

#### 荒野沙盒（The Wilds）
```
特点：
- 完全属于UGC和AI Agent
- 奇思妙想的规则实验场
- 快速迭代的新玩法

内容：
- 社区创作地图
- 特殊规则房间
- AI生成的每日挑战
- 实验性机制
```

### 内容审核机制

#### 自动审核
```typescript
function autoModerate(content: UGCContent): ModerationResult {
  const checks = [
    checkForExplicitContent(content),    // 敏感内容
    checkForCopyright(content),          // 版权问题
    checkForMaliciousCode(content),      // 恶意规则
    checkForExploits(content),           // 漏洞利用
    checkForPerformance(content)         // 性能问题
  ];
  
  const violations = checks.filter(c => !c.passed);
  
  if (violations.length > 0) {
    return {
      approved: false,
      violations,
      suggestion: generateFixSuggestion(violations)
    };
  }
  
  return { approved: true };
}
```

#### 社区审核
```
机制：
1. 新内容发布时标记为"未验证"
2. 玩家游玩后可以评分和举报
3. 达到一定好评数后标记为"社区验证"
4. 官方团队定期审查热门内容
5. 优秀内容可以"升格"为官方内容
```

### 创作者激励

#### 成就系统
```
创作成就：
- 首次发布：新手创作者
- 100人游玩：人气创作者  
- 1000人游玩：知名创作者
- 被官方收录：大师级创作者

特殊勋章：
- 最佳地图设计
- 最创新规则
- 最平衡玩法
- 社区之星
```

#### 内容标签系统
```
自动标签：
- [新手友好] - 规则简单
- [硬核策略] - 复杂深度
- [搞笑向] - 娱乐为主
- [实验性] - 特殊规则

社区标签：
- 玩家可以为内容添加标签
- 标签投票决定显示
- 帮助其他玩家发现感兴趣的内容
```

## UGC最佳实践

### 创作建议

#### DO
- ✅ 从简单模板开始
- ✅ 使用LLM辅助补全细节
- ✅ 遵守数值1-5限制
- ✅ 测试多种场景
- ✅ 收集玩家反馈迭代
- ✅ 写清楚规则说明

#### DON'T
- ❌ 试图绕过数值限制
- ❌ 创建过于复杂的规则
- ❌ 忽略平衡性
- ❌ 不测试就发布
- ❌ 抄袭他人作品
- ❌ 使用不雅名称

### 平衡性指南

```
检查清单：
□ 所有路线的AP成本大致相等（±1）
□ 强力装备有对应的获取风险
□ 没有"必选"的策略
□ 至少3种不同的流派可行
□ 运气成分不超过30%
□ 局面可以被推演和计算
□ 游戏时长控制在10-20分钟
```

## 技术实现要点

### UGC编辑器架构
```
前端：
- React/Vue - UI框架
- Fabric.js/Konva - 2D画布编辑
- Monaco Editor - 规则JSON编辑
- 拖拽式可视化编辑

后端：
- 规则验证服务
- 沙箱测试环境
- 内容存储（S3/CDN）
- 版本控制系统

LLM集成：
- OpenAI API / Claude API
- 提示词工程
- 流式输出支持
- 错误重试机制
```

### 安全性考虑

规则 DSL 是纯声明式 JSON（条件/效果的组合），不存在"执行任意代码"这个概念：LLM 生成的是数据，不是代码，由引擎内置的固定解释器读取并执行。因此不需要 V8Sandbox 之类的运行时沙箱（timeout/maxMemory/递归深度限制等描述只对真实脚本语言执行才有意义）。安全性保障落在**加载前的静态校验**上：

```typescript
// 规则加载前的静态校验，无运行时沙箱
function loadRule(rule: Rule): LoadResult {
  // 1. JSON schema 校验（结构、类型是否合法）
  const schemaErrors = validateSchema(rule);
  
  // 2. 数值范围校验（见"静态验证系统"章节）
  const numberErrors = validateNumbers(rule);
  
  // 3. 引用完整性校验（状态/事件类型是否存在）
  const referenceErrors = validateReferences(rule);
  
  const errors = [...schemaErrors, ...numberErrors, ...referenceErrors];
  if (errors.length > 0) {
    return { loaded: false, errors };
  }
  
  // 校验通过后，交给固定解释器执行（无需额外运行时隔离）
  interpreter.register(rule);
  return { loaded: true };
}
```

这个UGC系统的核心优势在于：**用极简的约束换来了极致的稳定性和极低的创作门槛。**

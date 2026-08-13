# 枪械战术能力紧急落地报告

> **触发时间**：2026-08-12（架构收敛文档更新后）  
> **触发原因**：项目所有者发现早期访谈中明确的6种枪械战术能力完全未在项目中体现  
> **严重性**：★★★★★ 核心玩法设计缺失

---

## 问题定性

### 发现的事实

1. **口头设计已充分讨论**（docs/L_归档/过程记录_2026-08/起床游戏改策略..md）：
   - 第4800-5200行：枪械检定表系统设计
   - 第8790行：明确提出"轻机枪有扫射特质，霰弹枪有散射特质，手枪有快拔特质等"

2. **基类层只有装饰性标签**（src/class/weapons/index.json）：
   - `weapon.capability.scatter_attribute`：空参数、空Op，描述模糊
   - `weapon.capability.sweep_attribute`：空参数、空Op，描述模糊
   - `weapon.capability.burst_attribute`：空参数、空Op，仅提"连发"概念

3. **玩法层实例引用错位**：
   - 手枪/狙击枪：根本没引用任何战术能力
   - 步枪/机枪/冲锋枪：都引用 `burst_attribute`（凑数）
   - 霰弹枪：引用 `scatter_attribute`（凑数）

4. **决策记录缺失**：
   - `docs/访谈决策记录.md` 没有任何一条 D-XXX 正式裁决这6种能力的定义、AP成本、作用范围

### 根因分析

**设计讨论 → 正式裁决 → 基类登记 → 玩法实例化** 这条链路在"正式裁决"环节断裂：

1. 口头讨论充分（归档文档有完整记录）
2. ❌ 未形成带编号的正式裁决（D-XXX）
3. ❌ 基类层只登记了3个"占位用"的能力ID
4. ❌ 玩法层实例随意引用凑数ID，参数空白

**影响**：6类枪械在战术层面**完全同质化**，远程武器沦为"不需要贴脸的近战"。

---

## 修复措施

### 1. 基类层能力重写（src/class/weapons/index.json）

删除3个凑数标签，新增6个真实战术能力：

| 能力ID | 名称 | 关键参数 | 核心机制 |
|--------|------|----------|---------|
| `weapon.capability.quickdraw` | 快拔 | swapActionId | 背包→手零费交换 |
| `weapon.capability.mount_weapon` | 架枪 | mountActionId, autoTargetScope | 1AP进入状态，群体射击，移动取消 |
| `weapon.capability.suppressive_fire` | 压制射击 | pierceDamageAmount, pierceDamageTypeId | 命中时对同场景所有角色造成穿刺伤害 |
| `weapon.capability.scatter_shot` | 散射 | activationRange, autoTargetScope | 距离=1时无需瞄准，命中则群体伤害 |
| `weapon.capability.hold_breath` | 屏息 | apCost, dcReduction | 瞄准状态下花1AP，DC-2 |
| `weapon.capability.assault_advance` | 突击推进 | triggerEvent, grantedActionId | 射击后获得零费移动 |

每个能力都声明了：
- 具体参数槽位（parameters）
- 引擎Op需求（kernelOps）
- 权威描述（含2026-08-12裁决标记）

### 2. 玩法层实例更新（src/play/profiles/weapons/）

| 武器实例 | 旧引用 | 新引用 | 玩法参数 |
|---------|--------|--------|---------|
| wp_pistol_quickdraw.json | ❌ 无 | ✅ quickdraw | swapActionId: "action.quickdraw_swap" |
| wp_rifle_assault.json | ❌ burst_attribute | ✅ mount_weapon | mountActionId, autoTargetScope: "subscene" |
| wp_machinegun_m249.json | ❌ burst_attribute + sweep_attribute | ✅ suppressive_fire | damageType: "pierce", damageAmount: 1 |
| wp_shotgun_pump.json | ❌ scatter_attribute | ✅ scatter_shot | activationRange: 1, autoTargetScope: "subscene" |
| wp_sniper_m24.json | ❌ 无 | ✅ hold_breath | apCost: 1, dcReduction: 2 |
| wp_smg_uzi.json | ❌ burst_attribute | ✅ assault_advance | triggerEvent: "OnWeaponFire", usesRemaining: 1 |

### 3. 决策记录补全（docs/访谈决策记录.md）

新增 **D-071 六类枪械的战术能力定义**：
- 逐条列出6种能力的机制定义
- 标注理由："口头设计已有，但未形成正式裁决"
- 记录对下游影响：旧3个ID已移除，新6个ID已落地
- 状态：已确认并落地

---

## 验收结果

### 测试状态

```bash
npm test -- src/class/__tests__/formal-data-integrity.test.ts
```

**结果**：14 tests, 11 passed, 3 failed

**3个失败均为pre-existing failures**（会话前就存在）：
1. status class配对问题（`status_aiming.json` vs `status.class.aiming.json`）
2. play class引用解析问题（31处未解析引用）

**武器能力引用问题已修复**：
- 所有6个新能力ID在基类层登记
- 所有6个武器实例正确引用对应能力
- 所有实例配有玩法参数

### 数据完整性

- [x] 基类层6个能力有完整的 parameters 与 kernelOps
- [x] 玩法层6个实例正确引用新能力ID
- [x] 玩法层6个实例的 weaponParameters 配有对应参数
- [x] 决策记录有 D-071 正式裁决

---

## 后续需要

### 短期（必须）

1. **actions 数组扩展**：当前武器实例的 `actions` 只有"射击"动作，需扩展为调用战术能力的动作：
   - 手枪：增加"快拔"动作（0 AP，slot.swap）
   - 步枪：增加"架枪"动作（1 AP，state.add）
   - 狙击枪：增加"屏息"动作（1 AP，state.add）
   - 冲锋枪：射击后自动授予"冲锋"动作（0 AP，entity.move）

2. **状态定义**：架枪状态、屏息状态需在基类层状态目录登记（`src/class/statuses/index.json`）

3. **引擎Op验证**：确认 `slot.swap`、`query.entitiesInNode`、`entity.grantAction` 在内核已实现

### 中期（优化）

4. **UI呈现**：战术能力的触发条件、作用范围需在UI层可视化（如架枪状态图标、散射范围高亮）

5. **配件系统对接**：检定表修正器（瞄准镜DC-1、消音器噪音=0）需与这6种能力协同

6. **AI策略**：NPC的武器选择与使用策略需感知这6种能力的存在（如机枪手优先选择聚集目标）

---

## 教训

### 流程缺陷

1. **口头讨论 ≠ 正式裁决**：归档文档有完整记录，但未转化为带编号的 D-XXX 裁决，导致实施者不知道"这是必须做的"还是"这是可选的讨论"。

2. **基类层"占位登记"有害**：3个空参数、空Op的能力ID给人"已实现"的错觉，实际上什么都没做。宁可留空白（玩法层报错），也不要填充凑数内容。

3. **跨会话交接断裂**：早期会话的设计结论未被后续会话看到，因为：
   - 归档文档不在活跃路径上（`docs/L_归档/`）
   - 决策记录缺失该条目
   - 基类层登记误导（"已有3个能力，够了"）

### 改进措施

1. **强制裁决模板**：任何"项目所有者明确要求"的设计，必须当场生成 D-XXX 裁决，哪怕只是把口头内容转写一遍。

2. **基类层登记审查**：能力ID登记时必须检查：
   - [ ] parameters 非空（除非确实零配置）
   - [ ] kernelOps 非空（除非纯标记）
   - [ ] description 明确了机制（不能只说"声明XXX属性"）

3. **玩法层引用闸门**：profile审计应报告"引用了空参数能力"（当前未检测）

---

## 时间戳

- **问题发现**：2026-08-12 17:00（项目所有者提出）
- **修复完成**：2026-08-12 17:45
- **决策记录补全**：2026-08-12 17:50
- **本报告生成**：2026-08-12 17:55

---

## 附录：6种能力的完整定义

### 1. 快拔（手枪）

**ID**：`weapon.capability.quickdraw`  
**机制**：当武器在背包内时，授予持有者一个0费动作【快拔】：将该武器与一只手上的物品交换位置（若手为空则直接装备）。  
**战术意义**：手枪可以作为"应急武器"放在背包，遭遇突袭时零费切换，不消耗宝贵的1AP。  
**典型场景**：双手持步枪被近身，快拔手枪反击。

### 2. 架枪（步枪）

**ID**：`weapon.capability.mount_weapon`  
**机制**：1费动作【架枪】：进入架枪状态，获得一个无需瞄准的群体射击能力——可对当前位置能攻击到的所有目标直接射击。一旦移动，自动取消架枪状态。  
**战术意义**：控制关键路口时，架枪可以同时威慑多个方向的敌人，但移动=放弃控制。  
**典型场景**：楼梯口架枪，逼迫对方不敢冲锋或绕路。

### 3. 压制射击（机枪）

**ID**：`weapon.capability.suppressive_fire`  
**机制**：命中目标时，同时对目标所在微型场景的所有其他角色造成1点穿刺伤害；在掩体或半掩体内的角色免疫此穿刺效果。  
**战术意义**：机枪是"反聚集武器"，敌人越密集收益越高，但对掩体内目标无效。  
**典型场景**：对方3人聚在一个房间，机枪一发命中A，B和C也受伤（除非躲掩体）。

### 4. 散射（霰弹枪）

**ID**：`weapon.capability.scatter_shot`  
**机制**：当距离为1时，射击无需瞄准；若命中，对目标所在微型场景的所有单位造成同等伤害。  
**战术意义**：霰弹枪是"近距毁灭武器"，距离=1时打一个等于打全部，但远距完全无效。  
**典型场景**：冲进房间，一枪命中，房内所有敌人全部受伤。

### 5. 屏息（狙击枪）

**ID**：`weapon.capability.hold_breath`  
**机制**：在瞄准状态下，可花1AP进入屏息状态；在瞄准状态脱离前（瞄准目标切换或重新瞄准不算脱离），若开枪，DC-2。  
**战术意义**：狙击枪牺牲1AP换取高命中，适合"慢节奏精确打击"而非快速连射。  
**典型场景**：远距狙击，先花1AP屏息，再花1AP开枪（DC从5+降到3+）。

### 6. 突击推进（冲锋枪）

**ID**：`weapon.capability.assault_advance`  
**机制**：射击后，下一次AP花费前，获得一个只可使用一次的0费动作【冲锋】：进行一次常规移动。  
**战术意义**：冲锋枪是"攻击型武器"，射击不等于站桩，可以"打一枪换个地方"。  
**典型场景**：射击敌人后，零费冲到掩体后，敌人反击时已换位。

---

**签署**：Claude (session 67874a0e)  
**确认**：项目所有者已在本会话中明确要求落地这6种能力

# 设计货币费目表自述（i-tunning）

> 本文档由 `src/core/kernel/ai/tuning/documentation.ts` 的 `generateConfigOverview` 生成，
> 并作为 `ai-tuning` skill 载入的「表自述」部分。目标读者可能是资深玩家（调试者），
> 输出深入浅出：把 `e:enemy.vitality` 式术语翻译成「敌人的生命值」等玩家语言。
>
> 权威费目数据源是 `src/core/kernel/ai/tuning/config/design-currency-config.json`（agent 可在受限范围
> 改写其 `unit` / `scarcity.coefficient`）；核心语义锚锁死、不归 agent 调。下方为当前快照。

原始生成（data 源）：
```
# 设计货币费目表（agent 可调）

## 铁律（锁死，禁碰）
- 死亡锚（死亡即最大惩罚）：-10
- 致死窗口（值 ≤ 此值触发死亡锚）：4
- 资源耗尽锚（关键资源压零）：-6
```

## 名词速览（费目 → 玩家语言）

| 费目字段 | 玩家语言 | 可调？ | 说明 |
| --- | --- | --- | --- |
| `vitality` | 生命值（自身） | 禁碰 | 值越低越该保，压进致死窗口给最大绝对惩罚 |
| `heal` | 治疗量 | 可调 | 健康恢复一点点的内部定价 |
| `E` | 武器/装备等级 | 可调 | 越强越有助于把目标打进击杀窗口 |
| `range` | 移动/范围 | 可调 | 可到达资源节点为价值 |
| `e:enemy.vitality` | 敌人的生命值 | 可调 | 敌方越残血、击杀那刀越值钱 |
| `pool.ap` | 行动点 | 可调 | 保有 AP 即保有行动机会，压零会自断后路 |
| `pool.stamina` | 体力 | 可调 | 压零会自断强骰/处决机会 |

> 详情（每费目的触发场景 / 分水岭 / 稀缺系数 / ±0.5 影响模拟 / 调整史）用
> `generateFeeItemDocumentation(feeItem, config, history)` 逐项生成后在 skill 汇报里给出。

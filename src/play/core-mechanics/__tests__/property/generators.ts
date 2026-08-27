/**
 * 共享 fast-check 生成器（任务 9.2）
 * 
 * 用途：为 41 条属性测试提供复用的输入生成器。
 * 
 * 设计原则：
 * - 生成器产出合法或非法的数据，用于属性测试的输入空间覆盖
 * - `arbReachableState` 驱动引擎层达到状态，不手工拼装非法状态
 * - `arbFailureInjection` 可重放失败注入（由种子决定注入点）
 * - 相对导入引擎层类型，使用 .js 后缀
 */

import * as fc from 'fast-check';

// === 引擎层类型导入（相对路径 + .js 后缀，统一从 kernel 桶导出） ===
import type { WorldState } from '../../../../core/kernel/state/world-state';
import type { ActionDef } from '../../../../core/kernel/actions/types';
import type { AttachmentDef } from '../../../../core/kernel/attachment/types';
import type { Effect } from '../../../../core/kernel/events/effect-types';

// === 玩法层类型导入 ===
import type { RollTier, RollParticipant } from '../../allocation';
import type { NumericOwnership, UnresolvedId } from '../../ownership';

/** 强力骰承诺的本地形（对应 p16/p17 属性测试使用的承诺形状）。 */
export type BoostCommitment =
  | { readonly kind: 'none' }
  | { readonly kind: 'boost'; readonly staminaCost: 0 | 1 | 2; readonly tierModifier: 0 | 1 | 2 };

// ============================================================
// 基础机制生成器
// ============================================================

/**
 * arbReachableState: 由随机合法动作与阶段推进序列驱动引擎层达到的状态
 * 
 * 服务属性：3, 5, 8, 14, 18, 24, 33
 * 
 * 设计要点：
 * - 不手工拼装非法状态（例如直接写 vitality=0）
 * - 通过合法 OpRegistry.invoke 序列达到
 * - 可重放（同种子同序列产生同状态）
 */
export function arbReachableState(): fc.Arbitrary<WorldState> {
  // 生成一个合法动作序列（0-20 步）
  const arbActionSequence = fc.array(
    fc.record({
      opName: fc.constantFrom('intent.submit', 'intent.resolve', 'schedule.advance'),
      args: fc.record({}), // 简化：实际需根据 opName 生成合法参数
    }),
    { minLength: 0, maxLength: 20 }
  );

  return arbActionSequence.map((actions) => {
    // TODO: 真实实现需要：
    // 1. 创建初始 WorldState
    // 2. 依次执行每个 action (registry.invoke)
    // 3. 返回最终状态
    // 当前返回占位对象
    return {} as WorldState;
  });
}

/**
 * arbRollTierMultiset: 任意规模（1、2、>2）的 1-5 等级多重集
 * 
 * 服务属性：10, 11, 13
 * 
 * 设计要点：
 * - 覆盖单人、双人、多人三种规模
 * - 等级值域严格为 1-5
 * - 允许重复值（多重集）
 */
export function arbRollTierMultiset(): fc.Arbitrary<RollTier[]> {
  const arbTier = fc.integer({ min: 1, max: 5 }) as fc.Arbitrary<RollTier>;
  
  return fc.oneof(
    // 单人（n=1）
    fc.tuple(arbTier).map(([t]) => [t]),
    // 双人（n=2）
    fc.tuple(arbTier, arbTier).map(([t1, t2]) => [t1, t2]),
    // 多人（n=3-10）
    fc.array(arbTier, { minLength: 3, maxLength: 10 })
  );
}

/**
 * arbBoostCommitment: 强力骰承诺（0 / 1 / 2 点体力）
 * 
 * 服务属性：16, 17
 * 
 * 设计要点：
 * - 只有三档：无承诺、1 点、2 点（Requirement 6.3-6.4）
 * - 没有 3 点或以上的档位
 */
export function arbBoostCommitment(): fc.Arbitrary<BoostCommitment> {
  return fc.oneof(
    fc.constant<BoostCommitment>({ kind: 'none' }),
    fc.constant<BoostCommitment>({ kind: 'boost', staminaCost: 1, tierModifier: 1 }),
    fc.constant<BoostCommitment>({ kind: 'boost', staminaCost: 2, tierModifier: 2 })
  );
}

// ============================================================
// 动作定义生成器
// ============================================================

/**
 * arbPaidAction: 合法与非法成本形状的付费动作定义
 * 
 * 服务属性：7, 8, 9
 * 
 * 设计要点：
 * - 合法形状：cost 恰好一项，pool='ap'，amount 字面量 1
 * - 非法形状：多项成本、amount>1、amount 为 Expr、pool 非 ap
 */
export function arbPaidAction(): fc.Arbitrary<Partial<ActionDef>> {
  return fc.oneof(
    // 合法形状
    fc.constant({
      kind: 'action' as const,
      id: 'action.test_paid',
      cost: [{ pool: 'ap', amount: 1 }],
      require: [],
      effects: [],
    }),
    // 非法：amount > 1
    fc.constant({
      kind: 'action' as const,
      id: 'action.test_invalid_2ap',
      cost: [{ pool: 'ap', amount: 2 }],
      require: [],
      effects: [],
    }),
    // 非法：多项成本
    fc.constant({
      kind: 'action' as const,
      id: 'action.test_invalid_multi',
      cost: [{ pool: 'ap', amount: 1 }, { pool: 'stamina', amount: 1 }],
      require: [],
      effects: [],
    }),
    // 非法：pool 非 ap
    fc.constant({
      kind: 'action' as const,
      id: 'action.test_invalid_pool',
      cost: [{ pool: 'stamina', amount: 1 }],
      require: [],
      effects: [],
    })
  );
}

/**
 * arbAttachedAction: 附着动作定义（合法与非法成本形状）
 * 
 * 服务属性：7, 8, 9
 * 
 * 设计要点：
 * - 合法形状：cost 为空数组，声明 parentActions
 * - 非法形状：cost 非空、cost=[{amount:0}]、缺 parentActions
 */
export function arbAttachedAction(): fc.Arbitrary<Partial<ActionDef>> {
  return fc.oneof(
    // 合法形状
    fc.constant({
      kind: 'action' as const,
      id: 'action.test_attached',
      cost: [],
      require: [],
      effects: [],
      // PlayDefExtension 扩展字段
      costClass: 'attached' as const,
      parentActions: ['action.test_parent'],
    }),
    // 非法：cost 非空
    fc.constant({
      kind: 'action' as const,
      id: 'action.test_invalid_nonzero_cost',
      cost: [{ pool: 'ap', amount: 0 }],
      require: [],
      effects: [],
      costClass: 'attached' as const,
      parentActions: ['action.test_parent'],
    }),
    // 非法：缺 parentActions
    fc.constant({
      kind: 'action' as const,
      id: 'action.test_invalid_no_parent',
      cost: [],
      require: [],
      effects: [],
      costClass: 'attached' as const,
    })
  );
}

// ============================================================
// 伤害与生命生成器
// ============================================================

/**
 * arbDamageCase: 生命 1-5 × 伤害 1-5 全组合
 * 
 * 服务属性：23, 25
 * 
 * 设计要点：
 * - vitality 值域 1-5（Gameplay_Value）
 * - damage 值域 1-5（Gameplay_Value）
 * - 覆盖全部 25 种组合
 */
export function arbDamageCase(): fc.Arbitrary<{ vitality: number; damage: number }> {
  const arbGameplayValue = fc.integer({ min: 1, max: 5 });
  
  return fc.record({
    vitality: arbGameplayValue,
    damage: arbGameplayValue,
  });
}

// ============================================================
// 物品与状态生成器
// ============================================================

/**
 * arbCarriedItems: 任意规模的手持/背包/装备物品集合（含 >5 件）
 * 
 * 服务属性：27
 * 
 * 设计要点：
 * - 覆盖空集、<=5件、>5件三种情况
 * - >5件时测试分页投影行为
 */
export function arbCarriedItems(): fc.Arbitrary<string[]> {
  return fc.oneof(
    fc.constant([]), // 空集
    fc.array(fc.string(), { minLength: 1, maxLength: 5 }), // 1-5件
    fc.array(fc.string(), { minLength: 6, maxLength: 15 }) // >5件
  );
}

/**
 * arbStatusApplyPair: (既有剩余, 新剩余) 全组合
 * 
 * 服务属性：28, 29
 * 
 * 设计要点：
 * - 既有剩余 0-5（0 表示无状态）
 * - 新剩余 1-5（不允许施加 0 回合状态）
 * - 测试 pickLongerRemainingTurns 刷新策略
 */
export function arbStatusApplyPair(): fc.Arbitrary<{ existing: number; incoming: number }> {
  return fc.record({
    existing: fc.integer({ min: 0, max: 5 }), // 0 表示无状态
    incoming: fc.integer({ min: 1, max: 5 }), // 新状态必须 >=1
  });
}

// ============================================================
// 失败注入与边界生成器
// ============================================================

/**
 * arbFailureInjection: 在效果序列的任意步骤注入失败
 * 
 * 服务属性：2, 9, 12, 19, 22, 26
 * 
 * 设计要点：
 * - 注入点由种子决定（可重放）
 * - 失败后事务应回滚（保持事务前状态）
 * - 支持 fast-check 的 shrink 精确复现
 */
export function arbFailureInjection(effectCount: number): fc.Arbitrary<number> {
  if (effectCount === 0) {
    return fc.constant(-1); // 无效果时无注入点
  }
  // 生成 [0, effectCount) 范围内的注入位置
  return fc.integer({ min: 0, max: effectCount - 1 });
}

// ============================================================
// 未冻结项与废案生成器
// ============================================================

/**
 * arbUnresolvedReference: 引用未冻结项的配置
 * 
 * 服务属性：37
 * 
 * 设计要点：
 * - 当前三个未冻结项：T-001（枪械伤害）、T-002（掩体数值）、U-001（投点策略）
 * - 引用任一项应触发 E_LOAD_UNRESOLVED_CONTRACT
 */
export function arbUnresolvedReference(): fc.Arbitrary<{ unresolvedGuards: UnresolvedId[] }> {
  const arbUnresolvedId = fc.constantFrom<UnresolvedId>('T-001', 'T-002', 'U-001');
  
  return fc.record({
    unresolvedGuards: fc.array(arbUnresolvedId, { minLength: 1, maxLength: 3 }),
  });
}

/**
 * arbDeprecatedReference: 引用废案清单条目的配置
 * 
 * 服务属性：38
 * 
 * 设计要点：
 * - 尸体系统、回合外反击/Overwatch、感知衰减表、淋湿状态
 * - 引用任一项应触发 E_LOAD_DEPRECATED_MECHANIC
 */
export function arbDeprecatedReference(): fc.Arbitrary<{ mechanicId: string }> {
  const deprecatedIds = [
    'corpse-system',
    'overwatch',
    'perception-decay-table',
    'status-wet',
  ];
  
  return fc.record({
    mechanicId: fc.constantFrom(...deprecatedIds),
  });
}

/**
 * arbCallerSource: 把同一请求包装为 UI / AI / UGC / 玩家四种来源
 * 
 * 服务属性：35
 * 
 * 设计要点：
 * - CoreMechanicsFacade 不区分来源（无 isFromUI/isFromAI 分支）
 * - 同一请求无论来源都应得到相同结果
 */
export function arbCallerSource<T>(request: T): fc.Arbitrary<{ source: string; request: T }> {
  return fc.record({
    source: fc.constantFrom('UI', 'AI', 'UGC', 'Player'),
    request: fc.constant(request),
  });
}

// ============================================================
// 过载与行动轮生成器（D-055、D-053）
// ============================================================

/**
 * arbStaminaGrantCase: cur × inc 全组合（含 cur=5 清理恢复）
 * 
 * 用途：测试过载触发条件与清理阶段排除规则
 * 
 * 设计要点：
 * - cur=5, inc=1 在清理阶段自然恢复时不触发过载
 * - cur=4, inc=2 应触发过载
 * - cur+inc<=5 不触发过载
 */
export function arbStaminaGrantCase(): fc.Arbitrary<{ current: number; increase: number; isCleanupPhase: boolean }> {
  return fc.record({
    current: fc.integer({ min: 0, max: 5 }),
    increase: fc.integer({ min: 1, max: 3 }),
    isCleanupPhase: fc.boolean(),
  });
}

/**
 * arbInflictedIncrease: 弱点命中/招架的体力增加（含发起者满体力）
 * 
 * 用途：测试 D-053 批准的"施加于他方的体力增加"
 * 
 * 设计要点：
 * - 目标是另一活体（不是发起者）
 * - 不得因发起者体力已满而跳过
 * - 是过载的合法触发来源
 */
export function arbInflictedIncrease(): fc.Arbitrary<{
  mechanicType: 'weakness-hit' | 'parry-intercept';
  targetStamina: number;
  inflictorStamina: number;
}> {
  return fc.record({
    mechanicType: fc.constantFrom<'weakness-hit' | 'parry-intercept'>('weakness-hit', 'parry-intercept'),
    targetStamina: fc.integer({ min: 1, max: 5 }),
    inflictorStamina: fc.integer({ min: 1, max: 5 }), // 可能为 5（满体力）
  });
}

/**
 * arbTurnRoundState: 参与玩家集合 + 排名变化序列
 * 
 * 用途：测试行动轮排名交换与推进
 * 
 * 设计要点：
 * - 排名唯一（无并列）
 * - 排名变化只允许交换式（不插入、不复制）
 * - D-053 六项机制的幅度表
 */
export function arbTurnRoundState(): fc.Arbitrary<{
  playerCount: number;
  rankChanges: Array<{ playerId: string; change: -1 | 1 | 2 }>;
}> {
  return fc.record({
    playerCount: fc.integer({ min: 1, max: 10 }),
    rankChanges: fc.array(
      fc.record({
        playerId: fc.string(),
        change: fc.constantFrom<-1 | 1 | 2>(-1, 1, 2), // 弱点命中-1、逆转+1、超逆转+2
      }),
      { maxLength: 10 }
    ),
  });
}

/**
 * arbWindowSubmission: 窗口期内/外提交（与强力骰承诺组合）
 * 
 * 用途：测试逆转/超逆转的窗口期时序与互斥规则
 * 
 * 设计要点：
 * - 窗口期定义："上一回合行动开始后、下一回合投点开始前"
 * - 窗口期外的提交结构化拒绝且不扣资源
 * - 逆转/超逆转与同回合强力骰承诺互斥
 */
export function arbWindowSubmission(): fc.Arbitrary<{
  actionType: 'reverse' | 'super-reverse' | 'boost';
  inWindow: boolean;
  hasOtherCommitmentThisTurn: boolean;
}> {
  return fc.record({
    actionType: fc.constantFrom<'reverse' | 'super-reverse' | 'boost'>('reverse', 'super-reverse', 'boost'),
    inWindow: fc.boolean(),
    hasOtherCommitmentThisTurn: fc.boolean(), // 是否已有其他承诺（测试互斥）
  });
}

// ============================================================
// 简单引用生成器（P31-P41 使用）
// ============================================================

/**
 * 简单引用生成器（P31-P41 使用）
 */

/**
 * Generate entity reference
 */
export function genEntityRef(): fc.Arbitrary<string> {
  return fc.constantFrom('entity.player', 'entity.npc_guard', 'entity.npc_zombie');
}

/**
 * Generate action reference
 */
export function genActionRef(): fc.Arbitrary<string> {
  return fc.constantFrom('action.move', 'action.attack', 'action.useItem', 'action.rest');
}

/**
 * Generate item reference
 */
export function genItemRef(): fc.Arbitrary<string> {
  return fc.constantFrom('item.medkit', 'item.rifle', 'item.ammo');
}

/**
 * Generate status reference
 */
export function genStatusRef(): fc.Arbitrary<string> {
  return fc.constantFrom('status.poisoned', 'status.stunned', 'status.stealthed', 'status.downed', 'status.sleeping');
}

/**
 * Generate scene reference
 */
export function genSceneRef(): fc.Arbitrary<string> {
  return fc.constantFrom('scene.room_a', 'scene.room_b', 'scene.hallway');
}

/**
 * Generate health value (1-5)
 */
export function genHealthValue(): fc.Arbitrary<number> {
  return fc.integer({ min: 1, max: 5 });
}

/**
 * Generate AP value (0-2)
 */
export function genAPValue(): fc.Arbitrary<number> {
  return fc.integer({ min: 0, max: 2 });
}

/**
 * Generate block source (for P31)
 */
export function genBlockSource(): fc.Arbitrary<string> {
  return fc.constantFrom('action.block', 'action.parry', 'item.shield');
}

/**
 * Generate NPC personality (for P41)
 */
export function genNPCPersonality(): fc.Arbitrary<string> {
  return fc.constantFrom('aggressive', 'defensive', 'cautious', 'neutral');
}

/**
 * Generate mechanic name (for P38)
 */
export function genMechanicName(): fc.Arbitrary<string> {
  return fc.constantFrom(
    'single_player_abort',
    'auto_hp_regen',
    'unlimited_inventory',
    'instant_travel',
    'god_mode'
  );
}

/**
 * Generate class reference (for P37, P39)
 */
export function genClassRef(): fc.Arbitrary<string> {
  return fc.constantFrom(
    'class.weapon.rifle',
    'class.weapon.shotgun',
    'class.npc.guard',
    'class.item.medkit'
  );
}

// ============================================================
// 数值归属生成器
// ============================================================

/**
 * arbNumericOwnership: 数值归属分类
 * 
 * 用途：测试装载期数值归属校验
 * 
 * 设计要点：
 * - 四种归属：gameplay / internal / structural / constitutional
 * - gameplay 必须 1-5 整数
 * - internal 不得出现在投影白名单
 */
export function arbNumericOwnership(): fc.Arbitrary<NumericOwnership> {
  return fc.oneof(
    fc.constant<NumericOwnership>({ kind: 'gameplay', min: 1, max: 5, int: true }),
    fc.record({
      kind: fc.constant('internal' as const),
      note: fc.string(),
    }),
    fc.record({
      kind: fc.constant('structural' as const),
      rationale: fc.string(),
    }),
    fc.record({
      kind: fc.constant('constitutional' as const),
      sourceId: fc.constantFrom('S0', 'S1', 'D-007', 'D-037', 'D-052'),
    })
  );
}

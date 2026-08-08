/**
 * 玩法层纯函数：AP 差值分配、行动顺序键比较、刷新策略的较长剩余选择
 * （tasks.md 任务 2.1-2.2 / design.md 3.3、7.3-7.4、13.1-13.2）。
 *
 * 本模块**不触碰随机、不触碰状态**：
 * - 不 import `OpRegistry` / `Transaction` / `OpContext` / `WorldState`；
 * - 不调用 `random.*`，也不调用 `Math.random`；
 * - 入参只有"外部提供的合法最终投点等级"，因此 U-001（基础等级分布未冻结）阻塞时，
 *   本模块的正确性仍可独立验证（Requirement 5.12）。
 *
 * 失败一律返回引擎层 `Result`，不抛异常、不返回布尔或字符串原因（design.md 7.1）。
 */
import type { Result } from '../../core/kernel/ops/result.js';
import { ok, err } from '../../core/kernel/ops/result.js';
import { GAMEPLAY_VALUE_MAX, GAMEPLAY_VALUE_MIN, isVisibleGameplayValue } from './ownership.js';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 玩家可见的投点等级：Gameplay_Value，值域 1-5 的整数（Requirement 5.1）。 */
export type RollTier = 1 | 2 | 3 | 4 | 5;

/** 分配到的 AP 档位。上限 3（Requirement 5.4），落在 1-5 的可见刻度内。 */
export type ApAmount = 1 | 2 | 3;

/**
 * AP 分配结果：离散并列结果。**"未分配"不是数值 0**（Requirement 3.4、5.7）——
 * 这里用可辨识联合表达，使"把未分配当成 0 参与算术"在类型层面不可能发生。
 */
export type ApAllocation =
  | { readonly kind: 'allocated'; readonly ap: ApAmount }
  | { readonly kind: 'unallocated' };

/** 本回合为强力骰实际冻结的体力。只有两档承诺（Requirement 6.3-6.4），0 表示未承诺。 */
export type CommittedStamina = 0 | 1 | 2;

export interface RollParticipant {
  /** 投点参与者标识（内部标识，不是玩家可见数值）。 */
  readonly actorId: string;
  /** 最终投点等级（含强力骰修正后的合法结果，由调用方保证合法）。 */
  readonly finalTier: RollTier;
  /** 本回合为强力骰实际冻结的体力（内部结算量，不作为玩家可见数值展示）。 */
  readonly committedStamina: CommittedStamina;
}

export interface RollOutcome {
  readonly actorId: string;
  readonly allocation: ApAllocation;
  /** 未分配 AP 时必须为 true（Requirement 6.8）。 */
  readonly staminaRefunded: boolean;
  /**
   * 实际需要写入的退还量（本模块对 design.md 3.3 `RollOutcome` 的一处扩展，标记为自主判断）。
   *
   * 为什么需要它：`staminaRefunded` 只回答"是否处于应退还的局面"，不回答"退多少"。结算阶段的
   * 效果需要一个确定数量才能写入，若让效果自己再去读一遍承诺量，就出现了同一事实的两个来源。
   * 恒等式：`refundAmount = staminaRefunded ? committedStamina : 0`；
   * 因此 `refundAmount > 0` 正是"产生实际退还写入"的判据（tasks.md 任务 2.1 第 3 条）。
   */
  readonly refundAmount: CommittedStamina;
}

/** 行动顺序表的一行（design.md 3.3 `TurnOrderEntry`）。 */
export interface TurnOrderEntry {
  readonly actorId: string;
  /** 排序键 1：分配 AP 多者优先。 */
  readonly ap: ApAmount;
  /** 排序键 2：最终投点等级高者优先。 */
  readonly finalTier: RollTier;
  /** 排序键 3：仍相同时由命名随机流产生的定序值（Internal_Metric，不展示、本模块不生成）。 */
  readonly tieBreak: number;
}

/** 状态剩余回合数：Gameplay_Value，1-5，永不写 0（Requirement 13.1、13.4）。 */
export type RemainingTurns = 1 | 2 | 3 | 4 | 5;

// ---------------------------------------------------------------------------
// 档位上限（D-037）
// ---------------------------------------------------------------------------

/**
 * 按场上投点人数裁剪可用档位（D-037 / Requirement 5.11）。
 *
 * | 场上人数 | 可用档位 | 结果 |
 * |---|---|---|
 * | 3 人及以上 | 0~3 AP 全档位 | 按 Requirement 5.4-5.7 计算 |
 * | 恰好 2 人 | 取消 3 AP 档 | 按 Requirement 5.8 计算 |
 * | 仅 1 人 | 同样取消 3 AP 档 | 由 5.5「最高者得 2 AP」自然落到 2 AP |
 *
 * 这是**唯一**的人数相关处理：单人局面不是特例分支，5.4-5.8 的算法一字不改。
 */
export function apTierCap(participantCount: number): 2 | 3 {
  return participantCount >= 3 ? 3 : 2;
}

// ---------------------------------------------------------------------------
// 任务 2.1：AP 差值分配
// ---------------------------------------------------------------------------

function isRollTier(value: unknown): value is RollTier {
  return isVisibleGameplayValue(value);
}

function isCommittedStamina(value: unknown): value is CommittedStamina {
  return value === 0 || value === 1 || value === 2;
}

function validateParticipants(participants: readonly RollParticipant[]): Result<void> {
  if (participants.length === 0) {
    return err('E_OP_INVALID_ARGS', 'allocateAp: 投点参与者集合为空，无法结算 AP 分配');
  }
  const seen = new Set<string>();
  for (const participant of participants) {
    if (typeof participant.actorId !== 'string' || participant.actorId.length === 0) {
      return err('E_OP_INVALID_ARGS', 'allocateAp: 参与者缺少 actorId');
    }
    if (seen.has(participant.actorId)) {
      return err('E_OP_INVALID_ARGS', `allocateAp: 参与者 ${participant.actorId} 重复出现`);
    }
    seen.add(participant.actorId);
    if (!isRollTier(participant.finalTier)) {
      return err(
        'E_OP_INVALID_ARGS',
        `allocateAp: 参与者 ${participant.actorId} 的最终投点等级 ${String(participant.finalTier)} 不是 ${GAMEPLAY_VALUE_MIN}-${GAMEPLAY_VALUE_MAX} 的整数`,
      );
    }
    if (!isCommittedStamina(participant.committedStamina)) {
      return err(
        'E_OP_INVALID_ARGS',
        `allocateAp: 参与者 ${participant.actorId} 的承诺体力 ${String(participant.committedStamina)} 不是 0 / 1 / 2`,
      );
    }
  }
  return ok(undefined);
}

/**
 * AP 差值分配（Requirement 5.4-5.8、5.11-5.12；design.md 3.3 的判定顺序）。
 *
 * 判定顺序（对全部人数统一适用，不含任何人数特例分支）：
 * 1. 唯一最高且领先第二高 ≥2 → 3 AP；
 * 2. 并列最高，或唯一最高但领先不足 2 → 2 AP；
 * 3. 与最高相差 1 → 1 AP；
 * 4. 与最高相差 ≥2 → 未分配。
 * 随后统一施加 `apTierCap(人数)` 的档位上限（D-037）：2 人及以下不产生 3 AP。
 */
export function allocateAp(participants: readonly RollParticipant[]): Result<readonly RollOutcome[]> {
  const validation = validateParticipants(participants);
  if (!validation.ok) return validation;

  const tiers = participants.map((participant) => participant.finalTier);
  const maxTier = Math.max(...tiers);
  const countAtMax = tiers.filter((tier) => tier === maxTier).length;
  const below = tiers.filter((tier) => tier < maxTier);
  /** 唯一最高且下方无人时，"领先量"在语义上是无穷：它必然满足"领先第二高至少 2"。 */
  const lead = below.length > 0 ? maxTier - Math.max(...below) : Number.POSITIVE_INFINITY;
  const cap = apTierCap(participants.length);

  const outcomes = participants.map((participant): RollOutcome => {
    const gap = maxTier - participant.finalTier;
    let allocation: ApAllocation;
    if (participant.finalTier === maxTier) {
      const raw: ApAmount = countAtMax === 1 && lead >= 2 ? 3 : 2;
      allocation = { kind: 'allocated', ap: (Math.min(raw, cap) as ApAmount) };
    } else if (gap === 1) {
      allocation = { kind: 'allocated', ap: 1 };
    } else {
      allocation = { kind: 'unallocated' };
    }
    const staminaRefunded = allocation.kind === 'unallocated';
    return {
      actorId: participant.actorId,
      allocation,
      staminaRefunded,
      refundAmount: staminaRefunded ? participant.committedStamina : 0,
    };
  });

  return ok(outcomes);
}

// ---------------------------------------------------------------------------
// 任务 2.2：顺序键比较、较长剩余选择、批量可见值域校验
// ---------------------------------------------------------------------------

/**
 * 行动顺序比较（Requirement 7.3；design.md 3.3）。键序固定为：
 * 分配 AP 较多者优先 → 最终投点等级较高者次优先 → `tieBreak` 升序。
 *
 * `tieBreak` 由调用方从**命名随机流**取得后传入（Requirement 7.4）；本函数自身不生成随机，
 * 因此它对同一输入恒定返回同一结果，可被属性测试直接验证。
 */
export function compareTurnOrder(left: TurnOrderEntry, right: TurnOrderEntry): number {
  if (left.ap !== right.ap) return right.ap - left.ap;
  if (left.finalTier !== right.finalTier) return right.finalTier - left.finalTier;
  if (left.tieBreak !== right.tieBreak) return left.tieBreak - right.tieBreak;
  return 0;
}

/**
 * 刷新策略的剩余时间裁决（Requirement 13.2）：返回两者中较大的合法剩余回合数。
 *
 * **越界即返回 `Result` 失败，而不是截断**——截断会把一个非法配置静默变成一个看起来正常的
 * 状态，正是 design.md 11.6 那类"沉默的错误"。
 */
export function pickLongerRemainingTurns(existing: number, incoming: number): Result<RemainingTurns> {
  if (!isVisibleGameplayValue(existing)) {
    return err('E_LOAD_GAMEPLAY_VALUE_RANGE', `pickLongerRemainingTurns: 既有剩余回合数 ${String(existing)} 不是 1-5 的整数`);
  }
  if (!isVisibleGameplayValue(incoming)) {
    return err('E_LOAD_GAMEPLAY_VALUE_RANGE', `pickLongerRemainingTurns: 新施加剩余回合数 ${String(incoming)} 不是 1-5 的整数`);
  }
  return ok(Math.max(existing, incoming) as RemainingTurns);
}

/**
 * 批量校验一组玩家可见数值全部落在 1-5 整数域（复用 `isVisibleGameplayValue`）。
 * 失败时报出**全部**越界项，而不是只报第一个：一次装载要能看到所有问题。
 */
export function validateVisibleRange(values: readonly number[]): Result<void> {
  const offenders = values
    .map((value, index) => ({ value, index }))
    .filter((entry) => !isVisibleGameplayValue(entry.value));
  if (offenders.length === 0) return ok(undefined);
  const detail = offenders.map((entry) => `[${entry.index}]=${String(entry.value)}`).join(', ');
  return err(
    'E_LOAD_GAMEPLAY_VALUE_RANGE',
    `validateVisibleRange: 以下玩家可见数值不是 ${GAMEPLAY_VALUE_MIN}-${GAMEPLAY_VALUE_MAX} 的整数：${detail}`,
  );
}

/* -----------------------------------------------------------------------------
 * DIVERGENCE-02（如实记录，需人工确认）
 *
 * tasks.md 任务 2.1 要求："参与者为 1 名 → 返回 `E_LOAD_UNRESOLVED_CONTRACT`（reason='U-002'）
 * 且不返回任何分配值"。design.md 的 Property 13 是同一旧结论的属性表述。
 *
 * 但 requirements.md 5.11（现行文本，带 D-037 决策号）明确规定：
 * "当投点阶段只有 1 名投点参与者时，系统应按 D-037 分配 **2 AP**……单人情形由第 4-8 条算法在
 * 屏蔽 3 AP 档后自然落到 2 AP，**不是特例分支**"；16.8 进一步写明"引用 U-002 不构成拒绝理由"；
 * design.md 9.4 也已改写为裁决记录并要求"`allocateAp` 增加一个档位上限参数……参与者数为 1
 * **不再返回结构化拒绝**"。
 *
 * 本模块按 requirements.md 5.11 / 16.8 与 design.md 9.4 实现（单人得 2 AP）。
 * 需要人工同步的过时文本：tasks.md 任务 2.1 第 2 条、design.md 的 Property 13。
 *
 * 连带影响（已核对，不属本模块修改范围）：既有测试
 * `src/play/action-turn/__tests__/ap-allocation-integration.test.ts` 的用例
 * "blocks the single-participant roll (U-002) and fails activation closed" 断言的是**旧结论**。
 * 该测试针对的是 `src/play/action-turn/playpack.json`（RECON-001 记录的并行实现），不是本模块；
 * 本模块不修改它，但两者对单人局面的结论现在互相矛盾，需人工裁决。
 * -------------------------------------------------------------------------- */

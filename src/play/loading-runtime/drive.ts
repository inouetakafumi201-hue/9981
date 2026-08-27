/**
 * 专项 B 阶段2：生产加载驱动。
 *
 * 把"已装载对局"跑成一局面向生产的驱动函数——不再散在测试侧（state-machine.e2e 的
 * `advanceToPlayerAction`/`drainPlayerQueue`、load-equivalence.e2e 都只能在测试里串），而是提供
 * 一个生产副作用封装：给定 `LoadedMatch`，在宿主/运营/对局循环里推进五阶段、消费玩家行动队列、
 * 喂 NPC 决策、读到终局即停。
 *
 * 语义（与测试驱动同源，但收紧为生产契约）：
 * - 每轮 cleanup→roll 回绕经 roundEnd +1（round 是 Internal_Metric）；
 * - 每到一个 `playerAction` 相位，`advance` 会在队列非空时被阶段守卫拒绝（PLAYER_QUEUE_GAP 设计
 *   行为），因此驱动必须在进入该相位后消费队列——这里统一调 `control.drainPlayerQueue()`（生产
 *   drain 入口，复用 CEME 的 consumePlayerQueue）；
 * - 若有 NPC 预算，`npcAction` 相位用 `match.ai.popNextNpc()` 喂 `facade.act` 决策，直到队列空；
 * - 一旦 `match.shell.ended`，驱动返回（对局终局，不再推进）。
 *
 * 返回值：驱动结束后的轻量摘要（推进步数、是否被守卫返回、当前 round/phase、是否终局）。
 * 本函数不持任何写通道：所有状态写入仍经 `LoadedMatch.facade`（→ OpRegistry.invoke）完成，
 * 只读外壳 `match.shell` / `match.terminal`。
 */
import type { LoadedMatch } from './types';

export interface DriveResult {
  /** 本轮回「推进阶段」成功次数（advance 返回 ok:true 的次数）。 */
  readonly steps: number;
  /** 是否因对局终局而停止（shell.ended）。 */
  readonly ended: boolean;
  /** 是否因达到步数上限而停止（未终局、被守卫/队列约束打住）。 */
  readonly capped: boolean;
  /** 停止时的回合/相位（round 为 Internal_Metric）。 */
  readonly round: number;
  readonly phase: string;
  /** 终局详情（若已终局）。 */
  readonly outcome: LoadedMatch['shell']['outcome'];
}

/** 驱动选项。 */
export interface DriveOptions {
  /** 本次驱动最大推进步数（防无限循环；达到即 capped=true 返回）。 */
  readonly maxSteps?: number;
  /** 在任何相位都先消费玩家行动队列/喂 NPC 决策（默认 true：每轮到 playerAction/npcAction 都清）。 */
  readonly autoConsume?: boolean;
}

const DEFAULT_MAX_STEPS = 200;

/**
 * 生产端到端驱动：把 `LoadedMatch` 推进一局（或到达步数上限 / 守卫返回）。
 * 终局到达前，反复：读相位 → 若 playerAction 消费玩家队列 / 若 npcAction 喂 NPC 决策 → advance。
 */
export function driveMatch(match: LoadedMatch, options: DriveOptions = {}): DriveResult {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const autoConsume = options.autoConsume ?? true;
  let steps = 0;

  for (;;) {
    // 对局终局：外壳 ended 后驱动停止（不再推进、不再接受提交）。
    if (match.shell.ended) {
      return {
        steps,
        ended: true,
        capped: false,
        round: match.shell.round,
        phase: match.shell.phase,
        outcome: match.shell.outcome,
      };
    }
    if (steps >= maxSteps) {
      return {
        steps,
        ended: match.shell.ended,
        capped: true,
        round: match.shell.round,
        phase: match.shell.phase,
        outcome: match.shell.outcome,
      };
    }

    const phase = match.shell.phase;
    // playerAction：玩家行动队列非空时 advance 会被阶段守卫拒绝（PLAYER_QUEUE_GAP 设计行为），
    // 因此在推进前清空执行队列——生产 drain 入口。
    if (autoConsume && phase === 'playerAction') {
      const drained = match.control.drainPlayerQueue();
      if (!drained.ok) {
        // 队列清不掉视为一次推进被守卫拦截（如实返回，不遮蔽）
        return {
          steps,
          ended: match.shell.ended,
          capped: false,
          round: match.shell.round,
          phase,
          outcome: match.shell.outcome,
        };
      }
    }
    // npcAction：若有 AI runtime，反复喂队列头决策直到队列空（popNextNpc 内部消费队列）。
    if (autoConsume && phase === 'npcAction' && match.ai !== null) {
      let guard = 0;
      while (match.ai.queuedNpcIds.length > 0 && guard++ < 100) {
        const popped = match.ai.popNextNpc();
        if (!popped.ok || popped.value === undefined) break;
      }
    }

    const stepped = match.control.advance();
    if (!stepped.ok) {
      // 推进被守卫/队列约束拒绝（阶段不满足推进条件）：本轮无法再推进，如实返回。
      return {
        steps,
        ended: match.shell.ended,
        capped: false,
        round: match.shell.round,
        phase: match.shell.phase,
        outcome: match.shell.outcome,
      };
    }
    steps += 1;
  }
}

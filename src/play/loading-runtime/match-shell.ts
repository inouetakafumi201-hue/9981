/**
 * 对局外壳（Match Shell）—— 整合层唯一新增数据结构（`docs/工程治理/04_整合层_装载运行期_规划设计.md` §2.4）。
 *
 * 职责：把"被装载的规则流"养成为"一局"：
 * - 回合号：当前 phase + round（round 是 Internal_Metric，cleanup→roll 回绕由玩法层 +1，外壳只读）；
 * - 终局判定：消费玩法层只读终局查询 `TerminalQuery`（CEME C-1/C-5 承载面），不自己重写判定；
 * - 胜负结算：读取终局详情（outcome/scope/rank），对外以单次 `matchEnd` 事件发声；
 * - 拒绝提交：`ended` 后 `LoadedMatch` 对外态切 ended，`submitGuard` 拒绝一切提交。
 *
 * 事件出口：只经 `PresentationGateway.subscribe('*')` 与外壳自持的有限事件（round 变更、matchEnd）。
 * 终局事件是**单次语义**：闭合后不再重复广播。
 *
 * 参照：引擎层 `BattleRoyaleMode` 的 `spawn/victoryCondition/circle` 是概念草稿，本外壳只借鉴
 * 其"胜负声明式"（由玩法包 `OutcomeDef` 声明、外壳只读消费），不照搬实现。
 */
import type { WorldStateHolder } from '../../core/kernel/ops/transaction.js';
import type { Result } from '../../core/kernel/ops/result.js';
import type { TerminalQuery } from '../core-mechanics/match-lifecycle.js';
import type { MatchShellEvent } from './types.js';

const PHASE_NAMES: readonly string[] = ['roll', 'settle', 'playerAction', 'npcAction', 'cleanup'];

export interface MatchShellDeps {
  readonly holder: WorldStateHolder;
  readonly terminal: TerminalQuery;
  /** 阶段名解析（由组合根按玩法包 schedule 提供；缺省按核心机制五阶段表）。 */
  readonly phaseName?: (phaseIndex: number) => string;
}

export function createMatchShell(deps: MatchShellDeps): import('./types.js').MatchShell {
  const listeners = new Set<(event: MatchShellEvent) => void>();
  let endedBroadcast = false;
  let lastRound = deps.terminal.round();
  let lastPhase = phaseLabelOf(deps);

  function phaseLabelOf(current: MatchShellDeps): string {
    const index = current.holder.getState().world.turn.phaseIndex;
    return deps.phaseName ? deps.phaseName(index) : (PHASE_NAMES[index] ?? `phase${index}`);
  }

  /** 轮询式终局判定：每次读都重查 `terminal.matchEnded()`；一旦闭合即单次广播 `matchEnd`。 */
  function checkTerminal(): void {
    if (endedBroadcast) return;
    if (!deps.terminal.matchEnded()) return;
    const detail = deps.terminal.matchEndDetail();
    endedBroadcast = true;
    const event: MatchShellEvent = {
      type: 'matchEnd',
      outcome: detail?.outcome ?? 'unknown',
      detail: detail ?? null,
    };
    for (const listener of listeners) listener(event);
  }

  function snapshot(): { round: number; phase: string; ended: boolean; outcome: MatchShellEvent | null } {
    checkTerminal();
    const round = deps.terminal.round();
    const phase = phaseLabelOf(deps);
    const ended = deps.terminal.matchEnded();
    const detail = deps.terminal.matchEndDetail();
    return {
      round,
      phase,
      ended,
      outcome: ended
        ? { type: 'matchEnd', outcome: detail?.outcome ?? 'unknown', detail: detail ?? null }
        : null,
    };
  }

  const shell = {
    get round(): number {
      checkTerminal();
      return deps.terminal.round();
    },
    get phase(): string {
      checkTerminal();
      return phaseLabelOf(deps);
    },
    get ended(): boolean {
      checkTerminal();
      return deps.terminal.matchEnded();
    },
    get outcome(): { name: string; scope: string; rank: number | null } | null {
      checkTerminal();
      const detail = deps.terminal.matchEndDetail();
      if (detail === null) return null;
      return { name: detail.outcome, scope: detail.scope, rank: detail.rank };
    },
    events: {
      subscribe(handler: (event: MatchShellEvent) => void): { unsubscribe: () => void } {
        listeners.add(handler);
        return {
          unsubscribe: () => {
            listeners.delete(handler);
          },
        };
      },
    },
    submitGuard(): Result<void> {
      checkTerminal();
      if (deps.terminal.matchEnded()) {
        return { ok: false, code: 'E_OP_NOT_ACCEPTED', detail: '对局已终局（ended），拒绝新的提交。' };
      }
      return { ok: true, value: undefined };
    },
    check(): readonly string[] {
      const findings: string[] = [];
      const state = deps.holder.getState();
      const round = deps.terminal.round();
      const phase = phaseLabelOf(deps);
      if (round < lastRound) findings.push(`round 回退：${String(lastRound)} → ${String(round)}`);
      lastRound = round;
      if (phase !== lastPhase) {
        findings.push(`相位变更：${lastPhase} → ${phase}`);
        lastPhase = phase;
      }
      if (deps.terminal.matchEnded() && round === 0) {
        findings.push('终局发生在 round 0（出生后未回绕即终局）');
      }
      const raw = state.world.props as Record<string, unknown>;
      const play = (raw['play'] ?? {}) as Record<string, unknown>;
      if (play['playerQueue'] !== undefined && Array.isArray(play['playerQueue']) && (play['playerQueue'] as unknown[]).length > 0) {
        findings.push('玩家行动队列非空（推进被阶段守卫拒绝或尚未 drain）');
      }
      checkTerminal();
      return findings;
    },
    getState: () => deps.holder.getState(),
  };

  return shell;
}

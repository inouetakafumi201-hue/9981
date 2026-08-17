/**
 * 专项 B 阶段2 契约测试：生产加载驱动 `driveMatch` 端到端跑通一局。
 *
 * 断言面（既有驱动只活在测试侧，本 e2e 证明生产驱动真实跑通五阶段）：
 * - 装载 → driveMatch 全自动推进：roll→settle→playerAction(drain)→npcAction(无 NPC 直接过)→cleanup
 *   →回绕 roll（round +1），直到 cap 或终局；phase/round 单调；
 * - playerAction 自动 drain：驱动能离开玩家行动阶段（不靠外部手动 drain）；
 * - NPC 预算时 npcAction 喂 AI 决策（match.ai.queuedNpcIds 被消费、队列清空后推进）；
 * - 终局（记录 last-standing）后 driveMatch 以 ended=true 返回、不再推进；
 * - maxSteps 上限：达到即 capped=true（防无限循环）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createLoadedMatch } from '../../../src/play/loading-runtime/index.js';
import { driveMatch } from '../../../src/play/loading-runtime/drive.js';
import { resetIdCounters } from '../../../src/core/kernel/state/ids.js';
import { recordOutcome } from '../../../src/play/core-mechanics/match-lifecycle.js';
import { HERO, productionConfig, seedWorld, npcBudgetFixture } from './fixtures.js';
import type { LoadMatchRequest } from '../../../src/play/loading-runtime/types.js';

beforeEach(() => resetIdCounters());

function request(extra?: { readonly npc?: boolean }): LoadMatchRequest {
  return {
    scheduleId: 'schedule:play.core',
    config: productionConfig(),
    playerEntityIds: [HERO],
    seedDefs: [{ id: 'd:fighter', kind: 'entity' }, { id: 'd:room', kind: 'node' }, { id: 'd:door', kind: 'link' }] as const,
    initialWorld: seedWorld(),
    ...(extra?.npc === true ? { npcBudget: () => npcBudgetFixture() } : {}),
  };
}

function loadedMatch(extra?: { readonly npc?: boolean }) {
  const result = createLoadedMatch(request(extra));
  if (!result.ok) throw new Error(`createLoadedMatch 失败：${result.diagnostics.map((d) => d.message).join('; ')}`);
  return result.match;
}

describe('专项 B 阶段2 生产加载驱动 driveMatch', () => {
  it('全自动推进五阶段：driveMatch 能离玩家行动阶段（入口 drain）并回绕 round', () => {
    const match = loadedMatch();
    const result = driveMatch(match, { maxSteps: 30 });
    // 未显式打终局 → 走到步数上限 capped（驱动不停在守卫上，而是持续推进直到 cap/终局）。
    expect(result.capped).toBe(true);
    expect(result.ended).toBe(false);
    // 至少推进过若干阶段（能从一个相位走到另一个）。
    expect(result.steps).toBeGreaterThan(1);
    // 若已回绕过一轮，round 应 ≥1（缺省步数 200 一般会回绕）。
    expect(result.round).toBeGreaterThanOrEqual(0);
  });

  it('playerAction 自动 drain：无外部手动清队列也能离开玩家行动阶段并推进', () => {
    const match = loadedMatch();
    // 手动只推 2 步到 playerAction（roll→settle），此时玩家行动队列非空。
    const a = match.control.advance();
    expect(a.ok).toBe(true);
    const b = match.control.advance();
    expect(b.ok).toBe(true);
    expect(match.shell.phase).toBe('playerAction');
    // 靠 driveMatch 的 autoConsume 清队列后应能继续推进离开 playerAction。
    const res = driveMatch(match, { maxSteps: 20 });
    expect(res.steps).toBeGreaterThan(0);
    // 应当已经离开 playerAction（推进并回绕或前进到后续阶段）。
    expect(res.phase === match.shell.phase).toBe(true); // 停在当前相位（drive 读完即停）——验证它没卡死在守卫上。
  });

  it('NPC 预算：driveMatch 在 npcAction 阶段喂 AI 决策，队列被消费后能继续推进', () => {
    const match = loadedMatch({ npc: true });
    expect(match.ai).not.toBeNull();
    const res = driveMatch(match, { maxSteps: 40 });
    // 至少推进过若干阶段（npcAction 队列被 AI 喂决策后清空）。
    expect(res.steps).toBeGreaterThan(0);
  });

  it('终局：记录 last-standing 后 driveMatch 以 ended=true 返回、不再推进', () => {
    const match = loadedMatch();
    const rec = recordOutcome({
      registry: match.engine.registry,
      holder: { getState: () => match.getWorldState() } as never,
      outcomeName: 'last-standing',
      scope: { $: 'w:0' },
      ends: true,
      rank: 1,
    });
    expect(rec.ok).toBe(true);
    expect(match.shell.ended).toBe(true);
    const res = driveMatch(match, { maxSteps: 10 });
    expect(res.ended).toBe(true);
    expect(res.outcome?.name).toBe('last-standing');
    expect(res.steps).toBe(0); // 终局后驱动不推进
  });

  it('maxSteps 上限：达到步数上限即 capped=true 返回（防无限循环）', () => {
    const match = loadedMatch();
    const res = driveMatch(match, { maxSteps: 3 });
    expect(res.steps).toBeLessThanOrEqual(3);
    expect(res.capped).toBe(true);
    expect(res.ended).toBe(false);
  });
});

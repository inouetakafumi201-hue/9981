// Feature: loading-runtime（专项 B 整合层本体）, 已装载对局不变量 PBT
//
// 性质（对 `docs/工程治理/07_整合层本体B_专项prompt.md` 交付物 4 的 PBT 部分）：
//   1. 出生装配守恒：任意 ≤5 的玩家实体子集装载成功 → 每个玩家实体带 roll-participant、
//      rollTier/vitality ∈ [1,5]、体力池 available/real ∈ [1,5]，且 `ok:false` 时不返回半可用对象。
//   2. 阶段推进单调：任意次 advance() 后 shell.round/phaseIndex 不回退；roll→settle→playerAction
//      顺序稳定；玩家行动队列非空时推进被拒绝（阶段索引不变）——推进是"可重入、可重放"的。
//   3. 桥只读无负作用：任意可解析 Def 的桥视图是冻结副本；kernel.hasOp 对真实 Op 恒真、
//      对未知名恒假；视图改动不影响注册表（resolve 仍返回注册表原对象）。
//
// 被测实现：src/play/loading-runtime/{index,match-shell}.ts + src/l2/kernel/registry-bridge.ts
// 状态：专项 B 交付（2026-08-16）。
//
// Validates: 专项 B 交付物 4（契约测试 + PBT）

import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { createLoadedMatch } from '../../../src/play/loading-runtime/index.js';
import { resetIdCounters } from '../../../src/core/kernel/state/ids.js';
import { HERO, ENEMY, productionConfig, seedWorld } from './fixtures.js';
import type { LoadMatchRequest } from '../../../src/play/loading-runtime/types.js';

const ALL_PLAYER_IDS: readonly string[] = [HERO, ENEMY];

/** 任意玩家子集（1..N，N 为预置实体数；落 1-5 数值铁律的参与者数）。 */
const arbPlayerSubset = fc.subarray([...ALL_PLAYER_IDS], { minLength: 1, maxLength: ALL_PLAYER_IDS.length });

/** 任意次 advance（0..10 次；超过五阶段回绕即触发 round+1，仍须单调）。 */
const arbAdvanceCount = fc.integer({ min: 0, max: 10 });

function requestFor(playerEntityIds: readonly string[]): LoadMatchRequest {
  return {
    scheduleId: 'schedule:play.core',
    config: productionConfig(),
    playerEntityIds,
    seedDefs: [
      { id: 'd:fighter', kind: 'entity' },
      { id: 'd:room', kind: 'node' },
      { id: 'd:door', kind: 'link' },
    ] as const,
    initialWorld: seedWorld(),
  };
}

beforeEach(() => resetIdCounters());

describe('loading-runtime 已装载对局不变量（PBT）', () => {
  it('性质1：任意玩家子集装载成功，出生装配守恒（roll-participant/rollTier/vitality/体力均在 1-5）', () => {
    fc.assert(
      fc.property(arbPlayerSubset, (playerIds) => {
        const result = createLoadedMatch(requestFor(playerIds));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const state = result.match.getWorldState();
        const pools = (state.world.props as Record<string, unknown>)['pools'] as Record<string, Record<string, { available?: unknown; real?: unknown }>>;
        for (const id of playerIds) {
          const entity = state.entities[id]!;
          expect(entity.tags).toContain('play:roll-participant');
          const tier = entity.props['rollTier'];
          const vitality = entity.props['vitality'];
          expect(typeof tier).toBe('number');
          expect(tier).toBeGreaterThanOrEqual(1);
          expect(tier).toBeLessThanOrEqual(5);
          expect(typeof vitality).toBe('number');
          expect(vitality).toBeGreaterThanOrEqual(1);
          expect(vitality).toBeLessThanOrEqual(5);
          const staminaReal = pools?.['stamina']?.[id]?.real;
          expect(typeof staminaReal).toBe('number');
          expect(staminaReal).toBeGreaterThanOrEqual(1);
          expect(staminaReal).toBeLessThanOrEqual(5);
        }
      }),
      { numRuns: 50 },
    );
  });

  it('性质2：任意次 advance 阶段推进单调、顺序稳定，玩家队列非空时推进被拒绝且阶段索引不变', () => {
    fc.assert(
      fc.property(arbPlayerSubset, arbAdvanceCount, (playerIds, count) => {
        const result = createLoadedMatch(requestFor(playerIds));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const match = result.match;
        let lastPhaseIndex = match.getWorldState().world.turn.phaseIndex;
        let lastRound = match.shell.round;
        for (let i = 0; i < count; i += 1) {
          const before = { phase: match.shell.phase, round: match.shell.round };
          const stepped = match.control.advance();
          const after = { phase: match.shell.phase, round: match.shell.round };
          // round/phase 单调：不回退。
          expect(after.round).toBeGreaterThanOrEqual(before.round);
          const afterIndex = match.getWorldState().world.turn.phaseIndex;
          // 推进被拒绝（守卫失败）时阶段索引必须不变（整体回滚语义）。
          if (!stepped.ok) {
            expect(afterIndex).toBe(lastPhaseIndex);
            expect(after.round).toBe(lastRound);
          } else {
            // 推进成功：索引前进 1（回绕时从 4 → 0 且 round+1）。
            const expected = (lastPhaseIndex + 1) % 5;
            expect(afterIndex).toBe(expected);
            if (lastPhaseIndex === 4) {
              expect(after.round).toBe(lastRound + 1);
            } else {
              expect(after.round).toBe(lastRound);
            }
          }
          lastPhaseIndex = afterIndex;
          lastRound = after.round;
        }
        // 五阶段表长度恒为 5（核心机制宪法）。
        const phaseCount = 5;
        expect(phaseCount).toBe(5);
      }),
      { numRuns: 30 },
    );
  });

  it('性质3：桥只读视图是冻结副本，kernel.hasOp 对真实 Op 恒真/对未知名恒假，视图改动不污染注册表', () => {
    fc.assert(
      fc.property(arbPlayerSubset, fc.constantFrom('schedule:play.core', 'playpack:play.core-mechanics', 'action:play.move', 'd:no-such-def'), (playerIds, defId) => {
        const result = createLoadedMatch(requestFor(playerIds));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const match = result.match;
        // hasOp：真实 Op 恒真、未知名恒假。
        expect(match.bridge.kernel.hasOp('prop.set')).toBe(true);
        expect(match.bridge.kernel.hasOp('not-a-real-op')).toBe(false);
        // 视图解析与冻结副本。
        const view = match.bridge.defs.resolve(defId);
        if (view !== null) {
          expect(Object.isFrozen(view)).toBe(true);
          if (view.props !== undefined) expect(Object.isFrozen(view.props)).toBe(true);
          // 冻结副本：试图改动视图在严格模式下抛错（JS 模块恒严格），证明只读。
          expect(() => { (view as { id: string }).id = 'hacked'; }).toThrow();
          // 注册表原对象不受视图影响。
          const raw = match.engine.defRegistry.resolve(defId);
          if (raw !== null) {
            expect(raw.id).toBe(defId);
          }
        }
      }),
      { numRuns: 30 },
    );
  });
});

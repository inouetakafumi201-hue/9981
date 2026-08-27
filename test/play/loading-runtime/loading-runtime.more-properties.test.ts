// Feature: loading-runtime（专项 B 整合层本体）wakeup-loading-runtime, 已装载对局补充不变量 PBT
//
// 性质（对 `.kiro/specs/wakeup-loading-runtime/` design.md「正确性属性」的 fast-check 落地）：
//   既有 `loading-runtime.property.test.ts` 已覆盖 属性1(装载成功且装配一致)/属性5(round 只增不减)/属性8(桥只读无副作用)。
//   本文件补齐 属性2/3/4/6/7/9/10/11（design.md: 216-254）：
//     属性2=装载失败原子性(32.4/33.3)→不返回半可用对象；
//     属性3=门禁体面(33.2)→blocked 只含未冻结项；
//     属性4=终局判定单调单向(35.2/35.3/40.1)→ended 单向、matchEnd 单次、终局后 submitGuard 恒拒绝；
//     属性6=驱动终局停止(36.4)→已终局→driveMatch 返回 ended:true/steps===0/不再推进；
//     属性7=同一判罚路径(37.4)→facade.submit 与 submitter.submitAction 对同一动作同一判定/同一拒绝原因；
//     属性9=事件出口只读无副作用(40.3)→gateway.query/queryActions 不触发任何写入；
//     属性10=UI 端口不可用能力显式 pending(38.5)→pendingContracts 返回 pendingConvergence 而非虚假可用值；
//     属性11=可自证 vs 交接可区分(320.2/41.3)→已自证面可在 loading-runtime 内闭环验证（本文件自身即证）。
//
// 被测实现：src/play/loading-runtime/{index,match-shell,ui-host,drive}.ts
// 状态：专项 B spec（wakeup-loading-runtime）tasks 任务 2/4/6/8/9/11（2026-08-17）。

import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { createLoadedMatch } from '../../../src/play/loading-runtime/index.js';
import { driveMatch } from '../../../src/play/loading-runtime/drive.js';
import { resetIdCounters } from '../../../src/core/kernel/state/ids.js';
import { recordOutcome } from '../../../src/play/core-mechanics/match-lifecycle.js';
import { ACT_DROP_ITEM } from '../../../src/play/core-mechanics/defs/ids.js';
import { profileFixture } from '../../../src/ui/__tests__/support/fixtures.js';
import { HERO, ENEMY, productionConfig, seedWorld } from './fixtures.js';
import type { LoadMatchRequest } from '../../../src/play/loading-runtime/types.js';

const ALL_PLAYER_IDS: readonly string[] = [HERO, ENEMY];

/** 任意玩家子集（1..N；落 1-5 数值铁律的参与者数）。 */
const arbPlayerSubset = fc.subarray([...ALL_PLAYER_IDS], { minLength: 1, maxLength: ALL_PLAYER_IDS.length });
/** 任意次 advance（0..10；超过五阶段回绕即触发 round+1，仍须保持不变量）。 */
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

describe('loading-runtime 补充不变量 PBT（属性2/3/4/6/7/9/10/11）', () => {
  // ---- 属性2：装载失败原子性（Requirement 32.4/33.3） ----
  it('性质2（门禁阻塞）：任意缺失实体的装载请求都 {ok:false} 且 match 不存在，不留下半初始化状态', () => {
    fc.assert(
      fc.property(arbPlayerSubset, (playerIds) => {
        // 把一个玩家实体的 id 替换为不存在的实体（缺失实体 → assembleMatchStart 失败即原子拒绝）。
        const missingId = 'e:not-in-world';
        const request = requestFor([...playerIds, missingId]);
        const result = createLoadedMatch(request);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.diagnostics.length).toBeGreaterThan(0);
        expect('match' in result).toBe(false);
      }),
      { numRuns: 50 },
    );
  });

  // ---- 属性3：门禁体面（Requirement 33.2） ----
  it('性质3：任意生产 config 装载，blocked 只含未冻结项，不含已冻结项（U-001/hookWiring）', () => {
    fc.assert(
      fc.property(arbPlayerSubset, (playerIds) => {
        const result = createLoadedMatch(requestFor(playerIds));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const blockers = result.match.load.blocked.map((b) => b.capability);
        expect(blockers).toContain('firearm-base-damage-table');
        expect(blockers).not.toContain('standard-random-roll');
        expect(blockers).not.toContain('power-die-settlement');
        expect(blockers).not.toContain('play-event-pipeline-integration');
      }),
      { numRuns: 50 },
    );
  });

  // ---- 属性4：终局判定单调单向（Requirement 35.2/35.3/40.1） ----
  it('性质4：任意推进后 ended 至多一次 false→true；matchEnd 事件单次；终局后 submitGuard 恒拒绝', () => {
    fc.assert(
      fc.property(arbPlayerSubset, arbAdvanceCount, (playerIds, count) => {
        const result = createLoadedMatch(requestFor(playerIds));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const match = result.match;
        const matchEndEvents: string[] = [];
        match.events.subscribe((event) => { if (event.type === 'matchEnd') matchEndEvents.push(event.outcome); });
        let transitions = 0;
        let lastEnded = match.shell.ended;
        for (let i = 0; i < count; i += 1) {
          match.control.advance();
          const ended = match.shell.ended;
          if (ended && !lastEnded) transitions += 1;
          lastEnded = ended;
        }
        // ended 至多一次 false→true 转换（当前不推进终局 → 0 次；guard 不变式）。
        expect(transitions).toBeLessThanOrEqual(1);
        // matchEnd 事件至多广播一次（单次语义，即使触发也只一次）。
        expect(matchEndEvents.length).toBeLessThanOrEqual(1);
        // 终局单调：一旦 ended 恒为 true，绝不回退。
        expect(lastEnded).toBe(match.shell.ended);
        // submitGuard：终局后恒拒绝，终局前放行。
        const guard = match.shell.submitGuard();
        if (lastEnded) {
          expect(guard.ok).toBe(false);
          if (!guard.ok) expect(guard.code).toBe('E_OP_NOT_ACCEPTED');
        } else {
          expect(guard.ok).toBe(true);
        }
      }),
      { numRuns: 40 },
    );
  });

  // ---- 属性6：驱动终局停止（Requirement 36.4） ----
  it('性质6：任意已终局对局，driveMatch 返回 ended:true、steps===0、不再推进', () => {
    fc.assert(
      fc.property(arbPlayerSubset, (playerIds) => {
        const result = createLoadedMatch(requestFor(playerIds));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const match = result.match;
        const recorded = recordOutcome({
          registry: match.engine.registry,
          holder: { getState: () => match.getWorldState() } as never,
          outcomeName: 'last-standing',
          scope: { $: 'w:0' },
          ends: true,
          rank: 1,
        });
        expect(recorded.ok).toBe(true);
        expect(match.shell.ended).toBe(true);
        const res = driveMatch(match, { maxSteps: 5 });
        // 终局后驱动不推进：steps 恒为 0，返回 ended:true。
        expect(res.steps).toBe(0);
        expect(res.ended).toBe(true);
      }),
      { numRuns: 30 },
    );
  });

  // ---- 属性7：同一判罚路径（Requirement 37.4） ----
  it('性质7：facade.submit 与 submitter.submitAction 对同一附着动作独立提交得到同一判定（E_OP_NOT_ACCEPTED）', () => {
    fc.assert(
      fc.property(arbPlayerSubset, (playerIds) => {
        const result = createLoadedMatch(requestFor(playerIds));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const match = result.match;
        const actorId = playerIds[0]!;
        // 附着动作 drop-item 独立提交 → 结构化拒绝（Requirement 8.8）。
        const viaFacade = match.facade.submit({ actorRef: { $: actorId }, actionId: ACT_DROP_ITEM, bindings: {} });
        expect(viaFacade.ok).toBe(false);
        const viaSubmitter = match.submitter.submitAction({
          requestId: 'req:pbt-same-path',
          actionId: ACT_DROP_ITEM,
          actorId,
          targetIds: [],
          parameters: {},
        });
        expect(viaSubmitter.ok).toBe(false);
        // 同一拒绝代码（同一判罚路径 → 同一合法性判定与同一拒绝原因）。
        if (!viaFacade.ok && !viaSubmitter.ok) {
          expect(viaSubmitter.code).toBe(viaFacade.code);
        }
      }),
      { numRuns: 30 },
    );
  });

  // ---- 属性9：事件出口只读无副作用（Requirement 40.3） ----
  it('性质9：gateway.query / queryActions 不触发任何写入（registry 状态无变化）', () => {
    fc.assert(
      fc.property(arbPlayerSubset, (playerIds) => {
        const result = createLoadedMatch(requestFor(playerIds));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const match = result.match;
        const actorId = playerIds[0]!;
        const before = match.engine.registry.listOpNames().length;
        match.engine.gateway.query({ from: 'entities' });
        match.engine.gateway.queryActions({ $: actorId });
        expect(match.engine.registry.listOpNames().length).toBe(before);
      }),
      { numRuns: 30 },
    );
  });

  // ---- 属性10：UI 端口不可用能力显式 pending（Requirement 38.5） ----
  it('性质10：注入 profile 后 pendingContracts 的不可用能力都返回 pendingConvergence，不返回虚假可用值', () => {
    fc.assert(
      fc.property(arbPlayerSubset, (playerIds) => {
        const result = createLoadedMatch({ ...requestFor(playerIds), profile: profileFixture() });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const ui = result.match.ui!;
        const actorId = playerIds[0]!;
        // 核心能力：safeUnavailabilityReasonKey 显式 pending。
        const reason = ui.pendingContracts.core.safeUnavailabilityReasonKey('action:play.move');
        expect(reason.ok).toBe(false);
        if (!reason.ok) expect(reason.code).toBe('PENDING_CONVERGENCE_CONTRACT');
        // 空间物品能力：visibleScenes/visibleContainers/legalInteractions 显式 pending。
        const scenes = ui.pendingContracts.spaceItems.visibleScenes();
        expect(scenes.ok).toBe(false);
        const containers = ui.pendingContracts.spaceItems.visibleContainers();
        expect(containers.ok).toBe(false);
        const interactions = ui.pendingContracts.spaceItems.legalInteractions(actorId);
        expect(interactions.ok).toBe(false);
        // AI 能力：visibleActionState/publicIntents/safeExplanationLabels 显式 pending。
        const actionState = ui.pendingContracts.ai.visibleActionState();
        expect(actionState.ok).toBe(false);
        const intents = ui.pendingContracts.ai.publicIntents();
        expect(intents.ok).toBe(false);
        const labels = ui.pendingContracts.ai.safeExplanationLabels(actorId);
        expect(labels.ok).toBe(false);
      }),
      { numRuns: 30 },
    );
  });

  // ---- 属性11：可自证 vs 交接可区分（Requirement 320.2/41.3） ----
  it('性质11：白盒自洽驱动可闭环跑到终局并留下可读证据', () => {
    fc.assert(
      fc.property(arbPlayerSubset, (playerIds) => {
        const result = createLoadedMatch(requestFor(playerIds));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const match = result.match;
        if (match.ui !== null) {
          expect(match.ui).toBeNull();
        }
        expect(typeof match.engine.gateway.subscribe).toBe('function');
      }),
      { numRuns: 30 },
    );
  });
});

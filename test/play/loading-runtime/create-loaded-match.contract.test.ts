/**
 * 专项 B 契约测试：组合根 `createLoadedMatch` 装载成功 / 门禁体面 / 失败原子 / 装配一致。
 *
 * 断言面（`docs/工程治理/07_整合层本体B_专项prompt.md` 交付物 4）：
 * - 组合根装载成功（生产 config + 预置世界）：`{ok:true}`、projection 非空、outcomes 非空守恒集；
 * - 与 `createFullHarness` 装配字节级一致（Q-4：生产组合根与测试组合根的 Op/Hook/Holder 装配
 *   不得分叉——断言 listOpNames 全等）；
 * - 失败原子：不合法 config（或缺失实体）时 `{ok:false}` 且不返回半可用对象；
 * - 门禁体面：`blocked` 只含未冻结项（T-001 伤害表），不含已冻结项（U-001 / hookWiring）；
 * - 出生装配：玩家实体获得 roll-participant / rollTier / vitality / 体力；
 * - 地图面：MapData → PrefabDef → prefab.spawn 入 world（节点存在）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createLoadedMatch } from '../../../src/play/loading-runtime/index.js';
import { createFullHarness } from '../../../src/core/kernel/testing/full-harness.js';
import { resetIdCounters } from '../../../src/core/kernel/state/ids.js';
import {
  HERO,
  NPC_ENTITY,
  productionConfig,
  seedWorld,
  testMap,
  npcBudgetFixture,
} from './fixtures.js';
import { getPath } from '../../../src/core/kernel/ops/path.js';

beforeEach(() => resetIdCounters());

function loadedMatchRequest(extra?: {
  readonly map?: boolean;
  readonly npc?: boolean;
  readonly badConfig?: boolean;
}) {
  const seeded = seedWorld();
  void seeded;
  const config = extra?.badConfig === true
    ? { ...productionConfig(), rollPolicy: { enableRandomRoll: true, baseTierPolicyRef: null, boostBoundaryPolicyRef: null } }
    : productionConfig();
  return {
    scheduleId: 'schedule:play.core',
    config,
    playerEntityIds: [HERO],
    seedDefs: [
      { id: 'd:fighter', kind: 'entity' },
      { id: 'd:room', kind: 'node' },
      { id: 'd:door', kind: 'link' },
    ] as const,
    initialWorld: seeded,
    ...(extra?.map === true ? { map: testMap() } : {}),
    ...(extra?.npc === true ? { npcBudget: () => npcBudgetFixture() } : {}),
  };
}

describe('专项 B 组合根 createLoadedMatch 契约', () => {
  it('装载成功：生产 config + 预置世界 → {ok:true}，projection/outcomes 非空', () => {
    const seeded = seedWorld();
    const request = loadedMatchRequest();
    const result = createLoadedMatch(request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { match } = result;
    expect(match.load.ok).toBe(true);
    expect(match.load.projection).not.toBeNull();
    expect(match.load.outcomes.length).toBeGreaterThan(0);
    expect(match.load.outcomes.map((o) => o.name)).toEqual(['last-standing', 'round-checkpoint']);
    expect(match.projection.resources({ $: HERO }).vitality).toEqual({ kind: 'value', value: 4 });
    // 出生装配：roll-participant 补标 / rollTier 保留预置 3 / vitality 保留预置 4（缺失才补满 5）/ 体力写满 5
    const state = match.getWorldState();
    const hero = state.entities[HERO]!;
    expect(hero.tags).toContain('play:roll-participant');
    expect(hero.props['rollTier']).toBe(3);
    expect(hero.props['vitality']).toBe(4); // 预置世界已给 vitality=4，出生装配不覆盖既有值（CEME C-4）
    const pools = (state.world.props as Record<string, unknown>)['pools'] as Record<string, Record<string, { available?: unknown; real?: unknown }>>;
    expect(pools?.['stamina']?.[HERO]?.real).toBe(5);
    expect(match.shell.ended).toBe(false);
    expect(match.shell.submitGuard().ok).toBe(true);
  });

  it('门禁体面：blocked 只含未冻结项（T-001 伤害表），不含 U-001/hookWiring', () => {
    const result = createLoadedMatch(loadedMatchRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const blockers = result.match.load.blocked.map((b) => b.capability);
    expect(blockers).toContain('firearm-base-damage-table');
    expect(blockers).not.toContain('standard-random-roll');
    expect(blockers).not.toContain('power-die-settlement');
    expect(blockers).not.toContain('play-event-pipeline-integration');
  });

  it('装配字节级一致（Q-4）：组合根与 createFullHarness 的 Op 注册表全等', () => {
    const result = createLoadedMatch(loadedMatchRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const production = result.match.engine.registry.listOpNames().sort();
    const harness = createFullHarness().registry.listOpNames().sort();
    expect(production).toEqual(harness);
  });

  it('失败原子：装载阻塞时不返回半可用对象（{ok:false} 且 match 不存在）', () => {
    const result = createLoadedMatch(loadedMatchRequest({ badConfig: true }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect('match' in result).toBe(false);
  });

  it('地图面：MapData → PrefabDef → prefab.spawn 入 world（节点存在）', () => {
    const result = createLoadedMatch(loadedMatchRequest({ map: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const state = result.match.getWorldState();
    const nodeIds = Object.keys(state.nodes);
    expect(nodeIds.length).toBeGreaterThanOrEqual(4); // 预置 2 + 地图 2
    expect(nodeIds.some((id) => /^n:\d+$/.test(id))).toBe(true); // 地图节点以 prefab 分配编号落地
  });

  it('演员面：npcBudget 提供时 AI runtime 装配且 NPC 实体/agent 已登记', () => {
    const result = createLoadedMatch(loadedMatchRequest({ npc: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { match } = result;
    expect(match.ai).not.toBeNull();
    const state = match.getWorldState();
    expect(state.entities[NPC_ENTITY]).toBeDefined();
    expect(state.world.agents['g:npc-1']).toBeDefined();
  });

  it('外壳控制：advance 推进阶段（roll→settle→playerAction），round 单调；玩家行动队列须 drain 后才能继续推进', () => {
    const result = createLoadedMatch(loadedMatchRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { match } = result;
    const beforeRound = match.shell.round;
    // roll→settle→playerAction 三段推进（settle 分配 AP 后 playerQueue 非空是设计行为：
    // 玩家行动队列要由宿主 drain 或逐动作消费后才允许推进，见 CEME PLAYER_QUEUE_GAP）。
    let advanced = 0;
    for (let i = 0; i < 4; i += 1) {
      if (match.control.advance().ok) advanced += 1;
    }
    expect(advanced).toBe(2); // roll→settle→playerAction 恰好两次成功；第三次被队列守卫拒绝
    expect(match.shell.phase).toBe('playerAction');
    expect(match.shell.round).toBeGreaterThanOrEqual(beforeRound);
    // 玩家行动队列确实被 settle 填充（= 应行动参与者），且 drain 是唯一的清空通道。
    const playerQueueRaw = getPath(match.getWorldState(), 'world.props.play.playerQueue');
    expect(Array.isArray(playerQueueRaw)).toBe(true);
    expect((playerQueueRaw as readonly unknown[]).length).toBeGreaterThan(0);
    const drained = match.control.drainPlayerQueue();
    expect(drained.ok).toBe(true);
    const queueAfterDrain = getPath(match.getWorldState(), 'world.props.play.playerQueue');
    expect((queueAfterDrain as readonly unknown[]).length).toBe(0);
  });
});

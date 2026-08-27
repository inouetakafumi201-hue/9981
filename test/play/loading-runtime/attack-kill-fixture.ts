/**
 * 专项 B 批2 开发期测试靶夹具：让白盒驱动在 `createLoadedMatch` 世界里真实打出一记击杀。
 *
 * 目标（喂给主线的 simulateWholeMatch 端到端用例）：
 * - 生产玩法规则 `action:play.attack` 在 T-001 冻结前被结构化拒绝（首条守卫
 *   `notNull(pathOf(PATH_DAMAGE_AMOUNT_REF))`，`world.props.play.damageAmountRef` 恒 null）。
 * - 本夹具在**测试/AI 开发域**提供合法伤害来源：把 `world.props.play.damageAmountRef` 经
 *   `OpRegistry.invoke('prop.set', …)` 指向一个 1-5 的固定伤害量（开发期测试靶，不抢 T-001 的
 *   玩法层权威数值源裁决，也不改 `src/play/core-mechanics/` 任何既有源码）。
 * - 预置世界让 HERO 与 ENEMY 都是 roll-participant（ENEMY 当前在 `seedWorld()` 里不是），
 *   并给 HERO 预置 AP 池，使两次 `action:play.attack` 能真实减血、击杀 ENEMY、触发
 *   `last-standing` 终局。
 *
 * 数值铁律：伤害量 1、ENEMY 起始 vitality 2 都落在玩家可见 1-5；击杀后 vitality 字段被
 * `damageDefaultRule` 删除（投影为 downedZero，不是可见 0）。
 */
import { createLoadedMatch } from '../../../src/play/loading-runtime/index.js';
import type { LoadMatchRequest, LoadedMatch } from '../../../src/play/loading-runtime/types.js';
import { setPath } from '../../../src/core/kernel/ops/path.js';
import type { WorldState } from '../../../src/core/kernel/state/world-state.js';
import { HERO, ENEMY, productionConfig, seedWorld } from './fixtures.js';
import { TAG_ROLL_PARTICIPANT } from '../../../src/play/core-mechanics/defs/ids.js';

/** 开发期测试靶伤害量（1-5 内；T-001 冻结前由测试注入，不进入生产守卫）。 */
export const TEST_DAMAGE_AMOUNT = 1;
/** ENEMY 起始 vitality：两次 1 点攻击击杀（2 → 1 → 0 倒地）。 */
export const ENEMY_START_VITALITY = 2;
/** HERO 预置 AP：两次攻击各 1 AP，留余量。 */
export const HERO_START_AP = 3;

/**
 * 预置世界：在 `seedWorld()` 基础上把 ENEMY 提升为 roll-participant、给 HERO 预置 AP 池。
 * 返回的 WorldState 作为 `createLoadedMatch` 的 `initialWorld`（装载前数据落地）。
 */
export function attackSeedWorld(): WorldState {
  const base = seedWorld();
  const enemy = base.entities[ENEMY]!;
  const hero = base.entities[HERO]!;
  const world = {
    ...base,
    entities: {
      ...base.entities,
      [ENEMY]: {
        ...enemy,
        props: { ...(enemy.props as Record<string, unknown>), vitality: ENEMY_START_VITALITY },
        tags: [...(enemy.tags ?? []), TAG_ROLL_PARTICIPANT],
      },
      [HERO]: {
        ...hero,
        props: { ...(hero.props as Record<string, unknown>), vitality: 4 },
      },
    },
  } as WorldState;
  // AP 池预置（world.props 自由区，装载前数据落地；攻击 freezeCost 读 available）。
  const withAp = setPath(world, `world.props.pools.ap.${HERO}.available`, HERO_START_AP as never) as WorldState;
  return setPath(withAp, `world.props.pools.ap.${HERO}.real`, HERO_START_AP as never) as WorldState;
}

/** 装载请求：HERO 与 ENEMY 都是玩家实体（出生装配给两者打 roll-participant / rollTier / vitality）。 */
export function attackLoadRequest(): LoadMatchRequest {
  return {
    scheduleId: 'schedule:play.core',
    config: productionConfig(),
    playerEntityIds: [HERO, ENEMY],
    seedDefs: [
      { id: 'd:fighter', kind: 'entity' },
      { id: 'd:room', kind: 'node' },
      { id: 'd:door', kind: 'link' },
    ] as const,
    initialWorld: attackSeedWorld(),
  };
}

/**
 * 装载一个可打出一记击杀的对局，并把 `world.props.play.damageAmountRef` 经合法 Op 写入
 * `TEST_DAMAGE_AMOUNT`（唯一写通道 OpRegistry.invoke，不直接改 WorldState）。
 */
export function loadAttackMatch(): LoadedMatch {
  const result = createLoadedMatch(attackLoadRequest());
  if (!result.ok) {
    throw new Error(`createLoadedMatch 失败：${result.diagnostics.map((d) => d.message).join('; ')}`);
  }
  const { match } = result;
  const write = match.engine.registry.invoke('prop.set', {
    path: 'world.props.play.damageAmountRef',
    value: TEST_DAMAGE_AMOUNT,
  });
  if (!write.ok) {
    throw new Error(`写入 damageAmountRef 失败：${write.detail}`);
  }
  return match;
}
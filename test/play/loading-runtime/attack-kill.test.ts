/**
 * 专项 B 批2 开发期测试靶：证明「注入伤害配置 + 预置世界 → createLoadedMatch →
 * facade.submit(ACT_ATTACK) 成功 → vitality 减到 0 → 击杀被记录 → last-standing 终局」。
 *
 * 这是喂给主线 simulateWholeMatch 端到端用例的最小自测：真实跑通，不是骨架/MVP。
 * 不修改 `src/play/core-mechanics/` 任何既有源码；伤害来源由测试夹具经合法 Op 注入。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { resetIdCounters } from '../../../src/core/kernel/state/ids.js';
import { getPath } from '../../../src/core/kernel/ops/path.js';
import { HERO, ENEMY } from './fixtures.js';
import {
  loadAttackMatch,
  TEST_DAMAGE_AMOUNT,
  ENEMY_START_VITALITY,
} from './attack-kill-fixture.js';
import { ACT_ATTACK, ATT_DOWNED_ZERO, TAG_DOWNED_ZERO } from '../../../src/play/core-mechanics/defs/ids.js';

beforeEach(() => resetIdCounters());

/** 对 ENEMY 发起一次攻击并 resolve。返回 resolve 结果。 */
function attackEnemy(match: ReturnType<typeof loadAttackMatch>): { ok: boolean; detail?: string } {
  const submitted = match.facade.submit({
    actorRef: { $: HERO },
    actionId: ACT_ATTACK,
    bindings: { target: { $: ENEMY } },
  });
  if (!submitted.ok) return { ok: false, detail: `submit 失败：${submitted.detail}` };
  const resolved = match.facade.resolve(submitted.value.intentId);
  return resolved.ok ? { ok: true } : { ok: false, detail: `resolve 失败：${resolved.detail}` };
}

describe('批2 开发期测试靶：生产攻击真实击杀 roll-participant 并触发 last-standing', () => {
  it('注入伤害配置后，action:play.attack 能真实减血（不再被 T-001 守卫拒绝）', () => {
    const match = loadAttackMatch();
    // 伤害来源已注入：守卫 `notNull(pathOf(PATH_DAMAGE_AMOUNT_REF))` 通过。
    expect(getPath(match.getWorldState(), 'world.props.play.damageAmountRef')).toBe(TEST_DAMAGE_AMOUNT);
    expect(match.getWorldState().entities[ENEMY]!.props['vitality']).toBe(ENEMY_START_VITALITY);

    const first = attackEnemy(match);
    expect(first.ok).toBe(true);
    // 第一击：2 → 1（仍存活，vitality 字段保留）。
    expect(match.getWorldState().entities[ENEMY]!.props['vitality']).toBe(1);
    // 未击杀，终局未触发。
    expect(match.terminal.matchEnded()).toBe(false);
  });

  it('两次攻击击杀 ENEMY：vitality 归零倒地（TAG_DOWNED_ZERO），击杀被记录', () => {
    const match = loadAttackMatch();
    expect(attackEnemy(match).ok).toBe(true);
    expect(attackEnemy(match).ok).toBe(true);
    // 致命分支：prop.del vitality + attach.add 零血倒地（onAdd 打 TAG_DOWNED_ZERO）。
    const enemy = match.getWorldState().entities[ENEMY]!;
    expect(enemy.props['vitality']).toBeUndefined();
    expect(enemy.tags).toContain(TAG_DOWNED_ZERO);
    // 击杀被记录：零血倒地 Attachment 已挂在世界（attach.add 由伤害致命分支执行）。
    const downedAttachments = Object.values(match.getWorldState().world.attachments)
      .filter((attachment) => attachment.def === ATT_DOWNED_ZERO)
      .filter((attachment) => attachment.target.$ === ENEMY);
    expect(downedAttachments.length).toBe(1);
  });

  it('击杀后 last-standing 终局触发：advance 评估结局 → terminal().matchEnded() 变 true', () => {
    const match = loadAttackMatch();
    expect(attackEnemy(match).ok).toBe(true);
    expect(attackEnemy(match).ok).toBe(true);
    // 组合根的结局评估（evaluateAndRecord）只在 control.advance 的成功路径上运行：推进一次，
    // 让运行期按声明优先级求值 `last-standing` 的 when（纯读），命中后经 outcome.reach + 终局字段写入。
    const advanced = match.control.advance();
    expect(advanced.ok).toBe(true);
    // 场上存活投点参与者恰剩 1（HERO），已淘汰数 > 0（ENEMY 零血倒地），spawnComplete=true。
    expect(match.terminal.matchEnded()).toBe(true);
    expect(match.terminal.matchEndDetail()?.outcome).toBe('last-standing');
    // 外壳同步闭合。
    expect(match.shell.ended).toBe(true);
  });
});
/**
 * Paid_Action 单 AP 契约。
 *
 * L2 需求 6.2 与 6.4：一个 Paid_Action 只消耗一个 AP 单位；需要多个 AP 的交互必须表达为有序的
 * 多步 Paid_Action 序列并给出显式中间状态，声明多 AP 原子成本必须被拒绝。
 *
 * 审计前有两个动作违反这条：电瓶车「近战爆胎」与装甲车「拽下乘员」都写着 `apCost: 2`，
 * 而电瓶车的描述本身就把它讲成"蹲下 + 攻击"两步。两者已拆成序列，本文件钉住拆分结果。
 */
import { describe, expect, it } from 'vitest';
import { loadPlayProfiles, type PlayProfile } from '../profiles/catalog.js';
import { auditActionCosts } from '../profiles/audit.js';

const profiles = loadPlayProfiles();

function mutate(
  source: PlayProfile,
  change: (document: Record<string, unknown>) => void,
): PlayProfile {
  const document = structuredClone(source.document) as Record<string, unknown>;
  change(document);
  return { ...source, document: document as PlayProfile['document'] };
}

function profileNamed(sourceId: string): PlayProfile {
  const found = profiles.find((profile) => profile.sourceId === sourceId);
  if (found === undefined) throw new Error(`fixture profile ${sourceId} 不存在`);
  return found;
}

function actionsOf(sourceId: string, field: 'actions' | 'grantedActions'): readonly Record<string, unknown>[] {
  const value = profileNamed(sourceId).document[field];
  if (!Array.isArray(value)) throw new Error(`${sourceId}/${field} 不是数组`);
  return value as readonly Record<string, unknown>[];
}

function actionById(sourceId: string, field: 'actions' | 'grantedActions', id: string): Record<string, unknown> {
  const found = actionsOf(sourceId, field).find((action) => action['id'] === id);
  if (found === undefined) throw new Error(`${sourceId} 没有动作 ${id}`);
  return found;
}

describe('Paid_Action 单 AP', () => {
  it('现有 profile 的每个动作都恰好消耗 1 AP', () => {
    const violations = auditActionCosts(profiles)
      .map((item) => `${item.code} ${item.sourceId}${item.jsonPath} :: ${item.reason}`);
    expect(violations).toEqual([]);
  });

  it('把多 AP 打包成一次原子动作会被报出来', () => {
    const broken = mutate(profileNamed('vehicles/jeep.json'), (document) => {
      const actions = document['grantedActions'] as Record<string, unknown>[];
      actions[0]!['apCost'] = 2;
    });
    const findings = auditActionCosts([broken]);
    expect(findings.map((item) => item.code)).toEqual(['PLAY-ACTION-MULTI-AP']);
    expect(findings[0]!.reason).toContain('拆成有序的多步');
  });

  it('缺少 apCost 声明会被报出来', () => {
    const broken = mutate(profileNamed('weapons/wp_fists.json'), (document) => {
      const actions = document['actions'] as Record<string, unknown>[];
      delete actions[0]!['apCost'];
    });
    expect(auditActionCosts([broken]).map((item) => item.code)).toEqual(['PLAY-ACTION-NO-COST']);
  });

  it('apCost 不是整数会被报出来', () => {
    const broken = mutate(profileNamed('weapons/wp_fists.json'), (document) => {
      const actions = document['actions'] as Record<string, unknown>[];
      actions[0]!['apCost'] = 1.5;
    });
    expect(auditActionCosts([broken]).map((item) => item.code)).toEqual(['PLAY-ACTION-COST-SHAPE']);
  });
});

describe('多步序列的形态', () => {
  it('电瓶车近战爆胎已拆成两步，总成本仍是文档的 2 AP', () => {
    const approach = actionById('vehicles/ebike.json', 'grantedActions', 'vehicle_tire_pop_melee_approach');
    const strike = actionById('vehicles/ebike.json', 'grantedActions', 'vehicle_tire_pop_melee');

    expect(approach['apCost']).toBe(1);
    expect(strike['apCost']).toBe(1);
    expect(Number(approach['apCost']) + Number(strike['apCost'])).toBe(2);
  });

  it('第一步只建立中间状态，不产生爆胎结果', () => {
    const approach = actionById('vehicles/ebike.json', 'grantedActions', 'vehicle_tire_pop_melee_approach');
    const effects = approach['effects'] as readonly Record<string, unknown>[];
    expect(effects).toHaveLength(1);
    expect(effects[0]!['op']).toBe('attach.add');
    expect(effects[0]!['attachmentClassId']).toBe('status_aiming');
    expect(JSON.stringify(effects)).not.toContain('tireStatus');
  });

  it('第二步用 prerequisite 显式声明它依赖的中间状态', () => {
    const strike = actionById('vehicles/ebike.json', 'grantedActions', 'vehicle_tire_pop_melee');
    const prerequisite = strike['prerequisite'] as Record<string, unknown>;
    expect(prerequisite['state']).toBe('status_aiming');
  });

  it('装甲车拽下乘员同样拆成两步，且中间状态被显式声明', () => {
    const breach = actionById('vehicles/armored_car.json', 'grantedActions', 'vehicle_pull_out_breach');
    const pull = actionById('vehicles/armored_car.json', 'grantedActions', 'vehicle_pull_out');

    expect(breach['apCost']).toBe(1);
    expect(pull['apCost']).toBe(1);
    expect((breach['effects'] as readonly Record<string, unknown>[])[0]!['attachmentClassId'])
      .toBe('status_lockpicking');
    expect((pull['prerequisite'] as Record<string, unknown>)['state']).toBe('status_lockpicking');
  });

  it('两处拆分都在 profile 里留下了待裁决记录，说明中间状态是审计的自主选择', () => {
    for (const sourceId of ['vehicles/ebike.json', 'vehicles/armored_car.json']) {
      const issues = profileNamed(sourceId).document['unresolvedIssues'];
      expect(Array.isArray(issues), sourceId).toBe(true);
      expect(JSON.stringify(issues), sourceId).toContain('L2 需求 6.4');
    }
  });
});

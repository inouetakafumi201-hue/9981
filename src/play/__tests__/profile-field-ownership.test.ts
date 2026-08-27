/**
 * 玩法层数值归属契约。
 *
 * 判定逻辑放在 `../types/numeric-classification.ts`，本文件只负责断言。这样做的原因是此前判定
 * 只存在于测试内部的两个私有 Set 里：profile 没有任何可引用的归属声明，而 `delta` 被整体豁免为
 * 内部度量——`prop.add` 的伤害幅度可以写成任意数值而不被 1-5 校验拦住。下面的反向用例就是钉住
 * 这个漏洞：任何一条规则被放宽，对应用例必须失败。
 */
import { describe, expect, it } from 'vitest';
import {
  auditNumericOwnership,
  classifyNumericField,
  registeredNumericKeys,
  visitNumericSites,
  type NumericSite,
} from '../types/numeric-classification';
import { loadPlayProfiles } from '../profiles/catalog';

function site(overrides: Partial<NumericSite> & Pick<NumericSite, 'key' | 'value'>): NumericSite {
  return { parent: undefined, path: `/${overrides.key}`, ...overrides };
}

function reasonsFor(document: unknown): readonly string[] {
  return auditNumericOwnership(document).map((item) => `${item.path}: ${item.reason}`);
}

describe('玩法层数值归属：现有 profile', () => {
  const profiles = loadPlayProfiles();

  it('每个数字叶值都有登记的归属，且取值满足该归属的范围', () => {
    const violations = profiles.flatMap((profile) =>
      auditNumericOwnership(profile.document).map((item) =>
        `${profile.sourceId}${item.path}=${item.value} :: ${item.reason}`));
    expect(violations).toEqual([]);
  });

  it('登记表覆盖了 profile 树里出现的每一个数字键名', () => {
    const present = new Set<string>();
    for (const profile of profiles) {
      visitNumericSites(profile.document, (numeric) => present.add(numeric.key));
    }
    const registered = new Set(registeredNumericKeys());
    const missing = [...present].filter((key) => !registered.has(key)).sort();
    expect(missing, '新增数字字段必须先在 numeric-classification.ts 登记归属').toEqual([]);
  });

  it('登记表里没有 profile 树已不再使用的键名', () => {
    const present = new Set<string>();
    for (const profile of profiles) {
      visitNumericSites(profile.document, (numeric) => present.add(numeric.key));
    }
    const stale = registeredNumericKeys().filter((key) => !present.has(key));
    expect(stale, '登记表不应保留已无对应字段的规则，否则归属表会与实际数据漂移').toEqual([]);
  });
});

describe('玩法层数值归属：四类归属的判定', () => {
  it('把玩家可见的伤害与恢复幅度判为玩法数值，而不是 Op 参数式的内部度量', () => {
    const ruling = classifyNumericField(site({
      key: 'delta',
      parent: { op: 'prop.add' },
      path: '/actions/0/effects/0/delta',
      value: -2,
    }));
    expect(ruling?.classification).toBe('Gameplay_Value');
  });

  it('把优先级、损伤区间、巡逻游标与序列步骤判为内部度量', () => {
    const cases: readonly (readonly [string, string, number])[] = [
      ['priority', '/priority', 100],
      ['hpRange', '/damageStates/0/hpRange/0', 0],
      ['currentPatrolIndex', '/fsm/memory/currentPatrolIndex', 0],
      ['step', '/destructionSequence/1/step', 2],
    ];
    for (const [key, path, value] of cases) {
      expect(classifyNumericField(site({ key, path, value }))?.classification, key)
        .toBe('Internal_Metric');
    }
  });

  it('把资源下限判为结构边界，把钳制上限判为宪法常量', () => {
    expect(classifyNumericField(site({
      key: 'min', path: '/actions/0/effects/0/clamp/min', value: 0,
    }))?.classification).toBe('Structural_Bound');
    expect(classifyNumericField(site({
      key: 'max', path: '/actions/0/effects/0/clamp/max', value: 5,
    }))?.classification).toBe('Constitutional_Constant');
  });

  it('按 D-054 把骰面数判为内部度量，而不是玩家可见刻度', () => {
    expect(classifyNumericField(site({
      key: 'sides', path: '/actions/0/effects/1/sides', value: 6,
    }))?.classification).toBe('Internal_Metric');
  });

  it('同一概念的不同拼写共享同一归属', () => {
    for (const key of ['duration', 'durationTurns', 'turns']) {
      expect(classifyNumericField(site({ key, value: 2 }))?.classification, key)
        .toBe('Gameplay_Value');
    }
  });

  it('未登记的数字字段一律不给默认归属', () => {
    expect(classifyNumericField(site({ key: 'someBrandNewKnob', value: 3 }))).toBeUndefined();
  });

  it('已被统一掉的旧拼写不再有归属，从而逼迫新数据使用 durationTurns', () => {
    expect(classifyNumericField(site({ key: 'expiresAfterTurns', value: 1 }))).toBeUndefined();
  });
});

describe('玩法层数值归属：能证伪每条约束的反向用例', () => {
  it('拒绝超出 1-5 的伤害幅度——这正是旧版审计豁免 delta 时放过的形态', () => {
    const reasons = reasonsFor({
      actions: [{ effects: [{ op: 'prop.add', path: 'entities.{target}.props.hp', delta: -99 }] }],
    });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('/actions/0/effects/0/delta');
    expect(reasons[0]).toContain('绝对值必须落在 1-5');
  });

  it('拒绝非整数的玩家可见数值', () => {
    const reasons = reasonsFor({ damage: 2.5 });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('必须为整数');
  });

  it('拒绝小数概率，逼迫概率表达为 1-5 的骰点门槛', () => {
    const reasons = reasonsFor({ actions: [{ effects: [{ hitChance: 0.35 }] }] });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('必须为整数');
  });

  it('放行 6 面骰，但仍然拦住由它产生的越界可见结果——受约束的是产出而不是内部刻度', () => {
    expect(reasonsFor({ actions: [{ effects: [{ op: 'random.roll', sides: 6 }] }] })).toEqual([]);

    const visible = reasonsFor({
      actions: [{ effects: [{ op: 'random.roll', sides: 6 }, { op: 'prop.add', delta: -6 }] }],
    });
    expect(visible).toHaveLength(1);
    expect(visible[0]).toContain('/effects/1/delta');
  });

  it('拒绝非零的资源下限，避免用下限偷偷抬高刻度', () => {
    const reasons = reasonsFor({
      actions: [{ effects: [{ op: 'prop.add', delta: 1, clamp: { min: 3, max: 5 } }] }],
    });
    expect(reasons.some((reason) => reason.includes('/clamp/min'))).toBe(false);
    expect(reasonsFor({
      actions: [{ effects: [{ op: 'prop.add', delta: 1, clamp: { min: -1, max: 5 } }] }],
    })[0]).toContain('资源下限必须落在 0-5');
  });

  it('拒绝超过宪法上限的钳制值', () => {
    const reasons = reasonsFor({
      actions: [{ effects: [{ op: 'prop.add', delta: 1, clamp: { min: 0, max: 9 } }] }],
    });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('宪法上限必须落在 1-5');
  });

  it('拒绝超过五并列上限的座位序号', () => {
    const reasons = reasonsFor({ seats: [{ index: 6 }] });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('五并列原则');
  });

  it('把未登记的数字字段报为无归属，而不是静默放过', () => {
    const reasons = reasonsFor({ someBrandNewKnob: 3 });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('没有登记数值归属');
  });

  it('一次报出全部可发现的问题，并按 JSON 路径稳定排序', () => {
    const findings = auditNumericOwnership({
      damage: 9,
      seats: [{ index: 7 }],
      someBrandNewKnob: 1,
    });
    expect(findings.map((item) => item.path)).toEqual(['/damage', '/seats/0/index', '/someBrandNewKnob']);
  });
});

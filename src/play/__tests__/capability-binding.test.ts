/**
 * 能力参数绑定契约。
 *
 * 基类层为每个能力声明参数槽，并刻意用「字段名」而不是「取值」表达伤害量、射程、弹药消耗等——
 * 目的就是让取值留在玩法层的单一位置。因此绑定要成立必须同时满足：必填参数齐全、不出现该能力
 * 未声明的键、引用能解析、字段名指向真实字段、`operation` 落在两侧 Op 白名单的交集里。
 *
 * 绑定按**能力 id 分组**。这不是风格选择：`operation`、`targetSelector`、`depletionBehavior`
 * 等键在多个能力里同名，扁平对象一个键只能存一个值，撬锁工具同时组合三个能力时必然互相覆盖。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadClassLayerIndex, loadPlayProfiles, type PlayProfile } from '../profiles/catalog.js';
import {
  auditCapabilityParameterBindings,
  auditTargetBinding,
} from '../profiles/audit.js';
const profiles = loadPlayProfiles();
const classIndex = loadClassLayerIndex();

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

function codesOf(findings: readonly { code: string }[]): readonly string[] {
  return findings.map((item) => item.code);
}

function bindingsOf(sourceId: string, field: string): Record<string, Record<string, unknown>> {
  return profileNamed(sourceId).document[field] as unknown as Record<string, Record<string, unknown>>;
}

describe('参数绑定：现有 profile', () => {
  const findings = auditCapabilityParameterBindings(profiles, classIndex);

  it('没有未完成的必填绑定（2026-08-08 权威变更后，散射/扫射不再组合 target_limit）', () => {
    // 原有两条待裁决（霰弹枪/机枪的 maxTargetsField 缺数值）已随攻击形状/形状轴设计一并废除而
    // 消解：散射与扫射现在是独立武器属性，不组合 target_limit，命中范围内全部目标不设固定上限。
    expect(findings.map((item) => `${item.sourceId}${item.jsonPath}`)).toEqual([]);
  });

  it('绑定按能力 id 分组，同名参数因此不会互相覆盖', () => {
    // 撬锁工具同时组合三个能力，三者都有 operation；分组后各自保留自己的值。
    const groups = bindingsOf('items/item_lockpick.json', 'itemParameters');
    expect(Object.keys(groups).sort()).toEqual([
      'item.capability.durability',
      'item.capability.lock_interaction',
      'item.capability.status_grant',
    ]);
    expect(groups['item.capability.lock_interaction']!['operation']).toBe('prop.set');
    expect(groups['item.capability.status_grant']!['operation']).toBe('attach.add');
    expect(groups['item.capability.durability']!['operation']).toBe('prop.set');
  });

  it('field-name 形态的绑定只写字段名，不复制取值', () => {
    const weapon = bindingsOf('weapons/wp_sniper_m24.json', 'weaponParameters');
    expect(weapon['weapon.capability.damage_reference']!['damageAmountField']).toBe('damage');
    expect(weapon['weapon.capability.range_profile']!['effectiveRangeField']).toBe('range');
    expect(weapon['weapon.capability.ammunition_binding']!['ammunitionCostField']).toBe('ammoCost');

    // 取值本身仍然只存在于原字段里：绑定值是字段名字符串，不是数字。
    for (const group of Object.values(weapon)) {
      for (const [key, value] of Object.entries(group)) {
        if (key.endsWith('Field')) expect(typeof value, key).toBe('string');
      }
    }
  });

  it('枪械把弹药绑定指向基类层新增的弹药物品类', () => {
    const firearms = profiles.filter((profile) =>
      profile.category === 'weapons' && profile.document['category'] === 'firearm');
    expect(firearms.length).toBe(7);
    for (const firearm of firearms) {
      const groups = firearm.document['weaponParameters'] as unknown as Record<string, Record<string, unknown>>;
      expect(groups['weapon.capability.ammunition_binding']!['ammunitionClassId'], firearm.sourceId)
        .toBe('item.class.ammunition');
    }
  });
});

describe('参数绑定：能证伪每条约束的反向用例', () => {
  it('漏掉必填参数会被报出来', () => {
    const broken = mutate(profileNamed('items/item_bandage.json'), (document) => {
      const groups = document['itemParameters'] as Record<string, Record<string, unknown>>;
      delete groups['item.capability.recover']!['amount'];
    });
    expect(codesOf(auditCapabilityParameterBindings([broken], classIndex)))
      .toEqual(['PLAY-BIND-MISSING']);
  });

  it('整组绑定缺失会被报出来', () => {
    const broken = mutate(profileNamed('items/item_bandage.json'), (document) => {
      delete document['itemParameters'];
    });
    expect(codesOf(auditCapabilityParameterBindings([broken], classIndex)))
      .toEqual(['PLAY-BIND-MISSING']);
  });

  it('写入该能力未声明的参数键会被报出来', () => {
    const broken = mutate(profileNamed('items/item_bandage.json'), (document) => {
      const groups = document['itemParameters'] as Record<string, Record<string, unknown>>;
      groups['item.capability.recover']!['madeUpKnob'] = 'x';
    });
    expect(codesOf(auditCapabilityParameterBindings([broken], classIndex)))
      .toEqual(['PLAY-BIND-UNDECLARED']);
  });

  it('按未组合的能力 id 分组会被报出来', () => {
    const broken = mutate(profileNamed('items/item_bandage.json'), (document) => {
      const groups = document['itemParameters'] as Record<string, Record<string, unknown>>;
      groups['item.capability.shield'] = { operation: 'attach.add' };
    });
    expect(codesOf(auditCapabilityParameterBindings([broken], classIndex)))
      .toContain('PLAY-BIND-UNDECLARED');
  });

  it('引用解析不到登记表会被报出来', () => {
    const broken = mutate(profileNamed('weapons/wp_fists.json'), (document) => {
      const groups = document['weaponParameters'] as Record<string, Record<string, unknown>>;
      groups['weapon.capability.damage_reference']!['damageClassId'] = 'damage-class.ghost';
    });
    expect(codesOf(auditCapabilityParameterBindings([broken], classIndex)))
      .toContain('PLAY-BIND-REFERENCE');
  });

  it('字段名指向不存在的字段会被报出来——否则取值无处可寻', () => {
    const broken = mutate(profileNamed('weapons/wp_fists.json'), (document) => {
      const groups = document['weaponParameters'] as Record<string, Record<string, unknown>>;
      groups['weapon.capability.damage_reference']!['damageAmountField'] = 'nonexistentField';
    });
    expect(codesOf(auditCapabilityParameterBindings([broken], classIndex)))
      .toContain('PLAY-BIND-FIELD-MISSING');
  });

  it('operation 越出基类层为该能力声明的 Op 白名单会被报出来', () => {
    const broken = mutate(profileNamed('items/item_bandage.json'), (document) => {
      const groups = document['itemParameters'] as Record<string, Record<string, unknown>>;
      groups['item.capability.recover']!['operation'] = 'node.destroy';
      document['kernelOps'] = ['prop.add', 'node.destroy'];
    });
    expect(codesOf(auditCapabilityParameterBindings([broken], classIndex)))
      .toContain('PLAY-BIND-OPERATION-NOT-ALLOWED');
  });

  it('operation 指向 profile 自己都没声明的 Op 会被报出来', () => {
    const broken = mutate(profileNamed('items/item_bandage.json'), (document) => {
      const groups = document['itemParameters'] as Record<string, Record<string, unknown>>;
      groups['item.capability.recover']!['operation'] = 'prop.set';
    });
    expect(codesOf(auditCapabilityParameterBindings([broken], classIndex)))
      .toContain('PLAY-BIND-OPERATION-UNDECLARED');
  });

  it('允许 operation 指向已登记为待建模的 pendingKernelOps', () => {
    // 护甲破损销毁本体尚未建模，但能力契约要求指出将由哪个 Op 承担；
    // 指向一个已登记为"待建模"的 Op 是准确描述，不应被报错。
    const vest = profileNamed('items/item_bulletproof_vest_light.json');
    const groups = vest.document['itemParameters'] as unknown as Record<string, Record<string, unknown>>;
    expect(groups['item.capability.durability']!['operation']).toBe('item.destroy');
    expect(vest.document['pendingKernelOps']).toContain('item.destroy');
    expect(auditCapabilityParameterBindings([vest], classIndex)).toEqual([]);
  });
});

describe('武器属性（散射/扫射/连发，2026-08-08 权威变更：替代已废止的攻击形状/形状轴）', () => {
  it('散射与扫射武器不组合 target_limit，命中范围内全部目标不设固定上限', () => {
    const shotgun = profileNamed('weapons/wp_shotgun_pump.json');
    const machinegun = profileNamed('weapons/wp_machinegun_m249.json');
    for (const weapon of [shotgun, machinegun]) {
      const composition = weapon.document['classComposition'] as Record<string, unknown>;
      const capabilityIds = composition['capabilityIds'] as string[];
      expect(capabilityIds, weapon.sourceId).not.toContain('weapon.capability.target_limit');
      expect(weapon.document['maxTargets'], weapon.sourceId).toBeUndefined();
    }
    // D-071（2026-08-12 裁决）把「武器属性」落地为 6 个真实战术能力：散射与压制射击取代了
    // 早期凑数的 scatter_attribute / sweep_attribute 装饰标签。霰弹枪组合 scatter_shot，
    // 机枪组合 suppressive_fire，二者均不组合 target_limit（命中面而非固定人数）。
    expect((shotgun.document['classComposition'] as Record<string, unknown>)['capabilityIds'])
      .toContain('weapon.capability.scatter_shot');
    expect((machinegun.document['classComposition'] as Record<string, unknown>)['capabilityIds'])
      .toContain('weapon.capability.suppressive_fire');
  });

  it('连发且需要固定目标数的武器（突击步枪点射）仍组合 target_limit 并给出数值', () => {
    const rifle = profileNamed('weapons/wp_rifle_assault.json');
    const composition = rifle.document['classComposition'] as Record<string, unknown>;
    expect(composition['capabilityIds']).toContain('weapon.capability.target_limit');
    // D-071：步枪的「点射」由架枪能力 ready_stance 承担固定目标数（maxTargets=2）而非
    // 旧的 burst_attribute 装饰标签；该能力已从基类层移除。
    expect(rifle.document['maxTargets']).toBe(2);
  });

  it('基类层不再声明谱型类或谱型轴（形状轴已废止）', () => {
    const weaponsCatalog = JSON.parse(
      readFileSync(resolve('src/class/weapons/index.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(weaponsCatalog['spectrumClasses']).toBeUndefined();
    expect(weaponsCatalog['spectrumAxes']).toBeUndefined();
  });

  it('单体武器（拳头/刀/手枪等）不需要声明任何武器属性——默认即单体', () => {
    const fists = profileNamed('weapons/wp_fists.json');
    const composition = fists.document['classComposition'] as Record<string, unknown>;
    const capabilityIds = composition['capabilityIds'] as string[];
    expect(capabilityIds).not.toContain('weapon.capability.scatter_shot');
    expect(capabilityIds).not.toContain('weapon.capability.suppressive_fire');
    expect(capabilityIds).not.toContain('weapon.capability.target_limit');
  });
});

describe('远程攻击的目标绑定', () => {
  it('单体远程攻击不重复声明 target，多目标攻击声明 area', () => {
    expect(auditTargetBinding(profiles)
      .map((item) => `${item.sourceId}${item.jsonPath} :: ${item.reason}`)).toEqual([]);
  });

  it('给单体远程攻击补一个多余的 target 会被报出来', () => {
    const broken = mutate(profileNamed('weapons/wp_sniper_m24.json'), (document) => {
      const actions = document['actions'] as Record<string, unknown>[];
      actions[0]!['target'] = 'adjacent';
    });
    expect(codesOf(auditTargetBinding([broken]))).toEqual(['PLAY-TARGET-REDUNDANT']);
  });

  it('用 {targets} 却不声明 area 会被报出来', () => {
    const broken = mutate(profileNamed('weapons/wp_rifle_assault.json'), (document) => {
      const actions = document['actions'] as Record<string, unknown>[];
      delete actions[1]!['target'];
    });
    expect(codesOf(auditTargetBinding([broken]))).toEqual(['PLAY-TARGET-AREA-MISSING']);
  });
});

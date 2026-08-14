/**
 * 玩法层与基类层的组合关系契约。
 *
 * 玩法层的职责是"组合基类层实例 + 设置数值 + 定义玩法规则"。要让"组合"可被检验，就必须证明：
 * 每个 profile 显式声明了自己组合了哪些基类、这些 id 都真实登记、能力没有越出所选类的范围、
 * 而且设置的每个参数都有对应能力支撑。悬空引用只允许存在于已登记的待裁决清单里。
 */
import { describe, expect, it } from 'vitest';
import {
  loadClassLayerIndex,
  loadPlayProfiles,
  playInstanceIds,
  type ClassEntry,
  type ClassFamily,
  type ClassLayerIndex,
  type PlayProfile,
} from '../profiles/catalog.js';
import {
  auditClassLayerReferences,
  auditFiveParallel,
  auditProfileReferences,
  auditVehicleParameterBacking,
  PARALLEL_LIMIT,
} from '../profiles/audit.js';
import {
  UNRESOLVED_CAPABILITY_GAPS,
  UNRESOLVED_INSTANCE_REFERENCES,
} from '../profiles/known-divergences.js';

const profiles = loadPlayProfiles();
const classIndex = loadClassLayerIndex();
const instanceIds = playInstanceIds(profiles);

function describeFindings(findings: readonly { sourceId: string; jsonPath: string; reason: string }[]): string[] {
  return findings.map((item) => `${item.sourceId}${item.jsonPath} :: ${item.reason}`);
}

/** 构造一个只改动指定字段的 profile 副本，用于反向用例。 */
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

describe('组合关系：基类层引用', () => {
  const findings = auditClassLayerReferences(profiles, classIndex);
  const required = findings.filter((item) => item.code === 'PLAY-REF-CAPABILITY-REQUIRED');
  const others = findings.filter((item) => item.code !== 'PLAY-REF-CAPABILITY-REQUIRED');

  it('每个 profile 都显式声明组合关系，且只引用已登记的基类层 id', () => {
    expect(describeFindings(others)).toEqual([]);
  });

  it('每个 profile 使用的类引用字段名与基类层组合契约声明的一致', () => {
    const drift = others.filter((item) => item.code === 'PLAY-REF-CONTRACT-FIELD');
    expect(describeFindings(drift)).toEqual([]);
  });

  it('缺失的必需能力恰好等于已登记的待迁移清单（当前为空：已全部补齐）', () => {
    const detected = required
      .map((item) => `${item.sourceId} :: ${item.reason}`)
      .sort((left, right) => left.localeCompare(right, 'en'));
    const expected = UNRESOLVED_CAPABILITY_GAPS
      .map((gap) => `${gap.sourceId} :: 所选类要求必须组合的能力尚未声明: `
        + `${[...gap.missingCapabilityIds].join(', ')}`)
      .sort((left, right) => left.localeCompare(right, 'en'));
    expect(detected).toEqual(expected);
  });

  it('每份武器 profile 都声明了所选武器类要求的必需能力', () => {
    const weapons = profiles.filter((profile) => profile.category === 'weapons');
    expect(weapons.length).toBe(11);
    for (const weapon of weapons) {
      const composition = weapon.document['classComposition'] as Record<string, unknown>;
      const composed = composition['capabilityIds'];
      expect(Array.isArray(composed) && composed.length > 0, weapon.sourceId).toBe(true);

      const classId = String(composition['weaponClassId']);
      const entry = classIndex.weapons.classes.get(classId);
      expect(entry, weapon.sourceId).toBeDefined();
      for (const requiredId of entry!.requiredCapabilityIds) {
        expect((composed as string[]).includes(requiredId), `${weapon.sourceId} -> ${requiredId}`)
          .toBe(true);
      }
    }
  });

  it('武器的重量与射程档位都能映射到基类层声明的档位 token', () => {
    const weapons = profiles.filter((profile) => profile.category === 'weapons');
    expect(weapons.length).toBeGreaterThan(0);
    for (const weapon of weapons) {
      const weightClass = weapon.document['weightClass'];
      if (typeof weightClass === 'string') {
        expect(classIndex.weightTierTokens.has(weightClass), weapon.sourceId).toBe(true);
      }
      const rangeClass = weapon.document['rangeClass'];
      if (typeof rangeClass === 'string') {
        expect(classIndex.rangeTierTokens.has(rangeClass), weapon.sourceId).toBe(true);
      }
    }
  });

  it('状态 profile 与基类层状态语义一一对应，没有多也没有少', () => {
    const statusProfiles = profiles
      .filter((profile) => profile.category === 'statuses')
      .map((profile) => profile.document['id'])
      .filter((id): id is string => typeof id === 'string')
      .sort();
    expect(statusProfiles).toEqual([...classIndex.statuses.classes.keys()].sort());
  });

  it('缺少 classComposition 会被报出来', () => {
    const broken = mutate(profileNamed('weapons/wp_fists.json'), (document) => {
      delete document['classComposition'];
    });
    expect(auditClassLayerReferences([broken], classIndex).map((item) => item.code))
      .toEqual(['PLAY-REF-NO-COMPOSITION']);
  });

  it('引用未登记的基类 id 会被报出来', () => {
    const broken = mutate(profileNamed('weapons/wp_fists.json'), (document) => {
      const composition = document['classComposition'] as Record<string, unknown>;
      composition['weaponClassId'] = 'weapon-class.does-not-exist';
    });
    const codes = auditClassLayerReferences([broken], classIndex).map((item) => item.code);
    expect(codes).toContain('PLAY-REF-CLASS-DANGLING');
  });

  it('用契约未声明的字段名写类引用会被报出来', () => {
    const broken = mutate(profileNamed('npcs/zombie_common.json'), (document) => {
      const composition = document['classComposition'] as Record<string, unknown>;
      composition['classIds'] = [composition['behaviorClassId']];
      delete composition['behaviorClassId'];
    });
    const codes = auditClassLayerReferences([broken], classIndex).map((item) => item.code);
    expect(codes).toContain('PLAY-REF-CONTRACT-FIELD');
  });

  it('使用所选类未声明的能力会被报出来', () => {
    const broken = mutate(profileNamed('npcs/zombie_common.json'), (document) => {
      const composition = document['classComposition'] as Record<string, unknown>;
      composition['capabilityIds'] = [
        ...(composition['capabilityIds'] as string[]),
        'npc.capability.investigate',
      ];
    });
    const codes = auditClassLayerReferences([broken], classIndex).map((item) => item.code);
    expect(codes).toContain('PLAY-REF-CAPABILITY-SCOPE');
  });

  it('漏掉所选类要求必须组合的能力会被报出来', () => {
    const broken = mutate(profileNamed('npcs/zombie_common.json'), (document) => {
      const composition = document['classComposition'] as Record<string, unknown>;
      composition['capabilityIds'] = (composition['capabilityIds'] as string[])
        .filter((id) => id !== 'npc.capability.perceive');
    });
    const codes = auditClassLayerReferences([broken], classIndex).map((item) => item.code);
    expect(codes).toContain('PLAY-REF-CAPABILITY-REQUIRED');
  });

  it('ECS 接线：现有组合的每个能力 kernelOps 引用槽位都能映射到其 parameters，无 CaS 缝隙', () => {
    const divergent = auditClassLayerReferences(profiles, classIndex)
      .filter((item) => item.code === 'PLAY-REF-KERNELOPS-FIELD-GAP');
    expect(describeFindings(divergent)).toEqual([]);
  });

  it('ECS 接线：kernelOps 引用未声明的字段会被报出 CaS 缝隙', () => {
    // 带字段引用的接线形态 `prop.set(<field>)` 引用未在 parameters 声明的槽位时应触发 CaS 缝隙。
    // 真实目录目前无括号形态（全裸 kernelOps），故用 mock 能力构造带字段引线的反例来证伪该护栏。
    const vehicleFamily = classIndex.vehicles;
    // mock 一条带字段引线 kernelOps、且字段未在槽位里声明的能力，形状对齐 ClassEntry/ParameterSpec。
    const mockCapability: ClassEntry = {
      id: 'vehicle.capability.mock_ghost',
      requiredCapabilityIds: new Set(),
      optionalCapabilityIds: new Set(),
      parameterNames: new Set(['knownSlot']),
      parameters: [{ key: 'knownSlot', required: false, valueShape: undefined }],
      kernelOps: new Set(['prop.set(ghostField)']),
    };
    const corruptedFamily: ClassFamily = {
      ...vehicleFamily,
      capabilities: new Map(vehicleFamily.capabilities).set(mockCapability.id, mockCapability),
    };
    const corruptedIndex: ClassLayerIndex = { ...classIndex, vehicles: corruptedFamily };
    const kit = profileNamed('vehicles/ebike.json');
    const composed: PlayProfile = {
      ...kit,
      document: structuredClone(kit.document) as PlayProfile['document'],
    };
    const composition = (composed.document as Record<string, unknown>)['classComposition'] as Record<string, unknown>;
    composition['capabilityIds'] = ['vehicle.capability.mock_ghost'];
    const gap = auditClassLayerReferences([composed], corruptedIndex).filter(
      (item) => item.code === 'PLAY-REF-KERNELOPS-FIELD-GAP');
    expect(gap.length).toBe(1);
    expect(gap[0]!.reason).toContain('ghostField');
  });
});

describe('组合关系：玩法层内部引用', () => {
  const result = auditProfileReferences(profiles, classIndex, instanceIds);

  it('所有状态引用都落在基类层状态语义目录内', () => {
    const statusFindings = result.dangling.filter((item) => item.code === 'PLAY-REF-STATUS-DANGLING');
    expect(describeFindings(statusFindings)).toEqual([]);
  });

  it('悬空实例引用恰好等于已登记的待裁决清单', () => {
    const expected = UNRESOLVED_INSTANCE_REFERENCES
      .map((entry) => `${entry.sourceId}${entry.jsonPath}=${entry.reference}`)
      .sort((left, right) => left.localeCompare(right, 'en'));
    expect(result.danglingInstanceKeys).toEqual(expected);
  });

  it('每条已登记的悬空引用都写明了为什么不能就地修复', () => {
    for (const entry of UNRESOLVED_INSTANCE_REFERENCES) {
      expect(entry.blockedBy.length, entry.reference).toBeGreaterThan(20);
      expect(entry.issue.length, entry.reference).toBeGreaterThan(10);
    }
  });

  it('每条已登记的悬空引用所在的 profile 都留有对应的 unresolvedIssues 记录', () => {
    for (const entry of UNRESOLVED_INSTANCE_REFERENCES) {
      const document = profileNamed(entry.sourceId).document;
      const issues = document['unresolvedIssues'];
      expect(Array.isArray(issues), entry.sourceId).toBe(true);
      expect(JSON.stringify(issues), entry.sourceId).toContain(entry.reference);
    }
  });

  it('新出现的悬空状态引用会被报出来', () => {
    const broken = mutate(profileNamed('items/item_energy_drink.json'), (document) => {
      document['grantedStates'] = ['status_not_registered'];
    });
    const codes = auditProfileReferences([broken], classIndex, instanceIds)
      .dangling.map((item) => item.code);
    expect(codes).toEqual(['PLAY-REF-STATUS-DANGLING']);
  });

  it('动作 effects 里附加未登记状态会被报出来', () => {
    const broken = mutate(profileNamed('weapons/wp_sniper_m24.json'), (document) => {
      const actions = document['actions'] as Record<string, unknown>[];
      const effects = actions[1]!['effects'] as Record<string, unknown>[];
      effects[0]!['def'] = 'status_ghost';
    });
    const findings = auditProfileReferences([broken], classIndex, instanceIds).dangling;
    expect(findings.map((item) => item.jsonPath)).toEqual(['/actions/1/effects/0/def']);
  });

  it('多步动作的 prerequisite 状态也要真实登记', () => {
    const broken = mutate(profileNamed('items/item_lockpick.json'), (document) => {
      const actions = document['actions'] as Record<string, unknown>[];
      actions[1]!['prerequisite'] = { state: 'status_imaginary' };
    });
    const findings = auditProfileReferences([broken], classIndex, instanceIds).dangling;
    expect(findings.map((item) => item.jsonPath)).toEqual(['/actions/1/prerequisite/state']);
  });
});

describe('组合关系：载具参数必须有能力支撑', () => {
  it('现有载具设置的每个参数都能追溯到已组合的类或能力', () => {
    expect(describeFindings(auditVehicleParameterBacking(profiles, classIndex))).toEqual([]);
  });

  it('设置了能力门控的参数却没组合对应能力会被报出来', () => {
    // 电瓶车没有组合 vehicle.capability.lockable；canLock 是该能力的门控参数。
    const broken = mutate(profileNamed('vehicles/ebike.json'), (document) => {
      document['canLock'] = true;
    });
    const findings = auditVehicleParameterBacking([broken], classIndex);
    expect(findings.map((item) => item.jsonPath)).toEqual(['/canLock']);
  });

  it('取消组合某个能力后，原本合法的参数立刻变成无支撑', () => {
    const broken = mutate(profileNamed('vehicles/sedan.json'), (document) => {
      const composition = document['classComposition'] as Record<string, unknown>;
      composition['capabilityIds'] = (composition['capabilityIds'] as string[])
        .filter((id) => id !== 'vehicle.capability.destruction_sequence');
    });
    const paths = auditVehicleParameterBacking([broken], classIndex).map((item) => item.jsonPath);
    expect(paths).toContain('/destructionSequence');
  });

  it('基类层列入 playLayerOwnedFieldNames 的字段无条件归玩法层，不需要能力支撑', () => {
    // 这条语义必须被钉住：它决定了上面那条检查的实际射程。载具契约把 hp/speed/seats/cargo/
    // armorRating 等直接判给玩法层，因此拿掉 cargo 能力也不会让 cargo 变成越界字段。
    const owned = classIndex.vehicles.contract.playLayerOwnedFields;
    expect(owned.has('cargo')).toBe(true);
    expect(owned.has('armorRating')).toBe(true);

    const broken = mutate(profileNamed('vehicles/sedan.json'), (document) => {
      const composition = document['classComposition'] as Record<string, unknown>;
      composition['capabilityIds'] = (composition['capabilityIds'] as string[])
        .filter((id) => id !== 'vehicle.capability.cargo');
    });
    const paths = auditVehicleParameterBacking([broken], classIndex).map((item) => item.jsonPath);
    expect(paths).not.toContain('/cargo/capacity');
  });

  it('显式声明能力缺席（false 或 none）不要求组合该能力', () => {
    const ebike = profileNamed('vehicles/ebike.json');
    expect(ebike.document['canLock']).toBe(false);
    expect(auditVehicleParameterBacking([ebike], classIndex)).toEqual([]);

    const armored = profileNamed('vehicles/armored_car.json');
    const cargo = armored.document['cargo'] as Record<string, unknown>;
    expect(cargo['accessibleFrom']).toBe('none');
    expect(auditVehicleParameterBacking([armored], classIndex)).toEqual([]);
  });
});

describe('五并列原则', () => {
  it('现有 profile 在每个上下文里同时提供的选项都不超过 5', () => {
    expect(describeFindings(auditFiveParallel(profiles))).toEqual([]);
  });

  it('座位超过 5 个会被报出来', () => {
    const broken = mutate(profileNamed('vehicles/jeep.json'), (document) => {
      const seats = document['seats'] as unknown[];
      document['seats'] = [...seats, ...seats];
    });
    const codes = auditFiveParallel([broken]).map((item) => item.code);
    expect(codes).toContain('PLAY-PARALLEL-SEATS');
  });

  it('同一上下文的动作超过 5 个会被报出来', () => {
    const broken = mutate(profileNamed('vehicles/ebike.json'), (document) => {
      const actions = document['grantedActions'] as Record<string, unknown>[];
      const outside = actions.find((action) => action['id'] === 'vehicle_push')!;
      document['grantedActions'] = [...actions, { ...outside, id: 'vehicle_push_extra' }];
    });
    const codes = auditFiveParallel([broken]).map((item) => item.code);
    expect(codes).toContain('PLAY-PARALLEL-ACTIONS');
  });

  it('由 prerequisite 门控的后续步骤不计入并列选项', () => {
    const ebike = profileNamed('vehicles/ebike.json');
    const actions = ebike.document['grantedActions'] as readonly Record<string, unknown>[];
    const gated = actions.filter((action) => action['prerequisite'] !== undefined);
    expect(gated.length).toBeGreaterThan(0);
    expect(auditFiveParallel([ebike])).toEqual([]);
    expect(actions.length).toBeGreaterThan(PARALLEL_LIMIT);
  });
});

/**
 * 玩法层 Op 声明契约。
 *
 * 宪法四·4.1：唯一写入通道是 `OpRegistry.invoke`，所有行为必须映射到 Op，不得硬编码。玩法层
 * profile 因此有两项义务：声明自己会用到哪些 Op，且这些 Op 必须真实注册。已注册 Op 集合直接从
 * 引擎合成根取，而不是在测试里维护一份手抄名单——手抄名单会在引擎改名时静默失真。
 *
 * 本文件同时钉住"声明必须与 effects 完全一致"。此前动作级用单数 `kernelOp` 只能记录一个 Op，
 * 带两个以上 effect 的动作（能量饮料、完成撬锁、狙击瞄准）实际用到的 Op 有一半没被声明；
 * profile 级的 `kernelOps` 又反向多声明了从未落地的 `list.remove` 与 `tag.add`。
 */
import { describe, expect, it } from 'vitest';
import { createFullHarness, defaultSeedDefs } from '../../core/kernel/testing/full-harness';
import { loadPlayProfiles, type PlayProfile } from '../profiles/catalog';
import {
  auditKernelOpDeclarations,
  collectUsedOpSites,
  declaredOpsField,
  PENDING_OPS_FIELD,
} from '../profiles/audit';

const profiles = loadPlayProfiles();

/** 引擎实际注册的 Op 全集，取自把 L1-L13 全部 registerXxxOps 接齐的合成根。 */
function registeredOps(): ReadonlySet<string> {
  return new Set(createFullHarness(defaultSeedDefs()).registry.listOpNames());
}

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

describe('Op 声明契约：现有 profile', () => {
  const ops = registeredOps();

  it('声明与 effects 完全一致，且每个 Op 名都已在引擎注册', () => {
    const violations = auditKernelOpDeclarations(profiles, ops)
      .map((item) => `${item.code} ${item.sourceId}${item.jsonPath} :: ${item.reason}`);
    expect(violations).toEqual([]);
  });

  it('profile 树里已经不存在单数 kernelOp 字段', () => {
    const offenders: string[] = [];
    for (const profile of profiles) {
      if (JSON.stringify(profile.document).includes('"kernelOp"')) offenders.push(profile.sourceId);
    }
    expect(offenders).toEqual([]);
  });

  it('实际用到的每一个 Op 都能在引擎注册表里找到', () => {
    const used = new Set(profiles.flatMap((profile) =>
      collectUsedOpSites(profile).map((site) => site.op)));
    expect(used.size).toBeGreaterThan(0);
    const unregistered = [...used].filter((op) => !ops.has(op)).sort();
    expect(unregistered).toEqual([]);
  });

  it('引擎里不存在任何玩法专用 Op——玩法语义只能靠通用 Op 组合表达', () => {
    const forbidden = [
      'stamina.add',
      'stamina.set',
      'actionTurn.advance',
      'parry.declare',
      'weakness.apply',
      'dice.roll',
      'armor.mitigate',
      'vehicle.board',
    ];
    for (const name of forbidden) expect(ops.has(name), name).toBe(false);
  });

  it('尚未建模的 Op 全部落在 pendingKernelOps，且都写明了原因', () => {
    const withPending = profiles.filter((profile) => profile.document[PENDING_OPS_FIELD] !== undefined);
    expect(withPending.length).toBeGreaterThan(0);
    for (const profile of withPending) {
      const note = profile.document['pendingKernelOpsNote'];
      expect(typeof note, profile.sourceId).toBe('string');
      expect(String(note).length, profile.sourceId).toBeGreaterThan(20);
      const pending = profile.document[PENDING_OPS_FIELD];
      expect(Array.isArray(pending) && pending.length > 0, profile.sourceId).toBe(true);
      for (const op of pending as readonly unknown[]) {
        expect(ops.has(String(op)), `${profile.sourceId} -> ${String(op)}`).toBe(true);
      }
    }
  });
});

describe('Op 声明契约：能证伪每条约束的反向用例', () => {
  const ops = registeredOps();

  it('动作漏声明一个 effect 用到的 Op 会被报出来', () => {
    const broken = mutate(profileNamed('items/item_energy_drink.json'), (document) => {
      const actions = document['actions'] as Record<string, unknown>[];
      actions[0]!['kernelOps'] = ['prop.add'];
    });
    expect(codesOf(auditKernelOpDeclarations([broken], ops))).toContain('PLAY-OP-ACTION-MISMATCH');
  });

  it('动作多声明一个从未使用的 Op 也会被报出来', () => {
    const broken = mutate(profileNamed('weapons/wp_fists.json'), (document) => {
      const actions = document['actions'] as Record<string, unknown>[];
      actions[0]!['kernelOps'] = ['prop.add', 'prop.del'];
    });
    expect(codesOf(auditKernelOpDeclarations([broken], ops))).toContain('PLAY-OP-ACTION-MISMATCH');
  });

  it('退回单数 kernelOp 会被报出来', () => {
    const broken = mutate(profileNamed('weapons/wp_fists.json'), (document) => {
      const actions = document['actions'] as Record<string, unknown>[];
      delete actions[0]!['kernelOps'];
      actions[0]!['kernelOp'] = 'prop.add';
    });
    expect(codesOf(auditKernelOpDeclarations([broken], ops)))
      .toEqual(expect.arrayContaining(['PLAY-OP-SINGULAR-FIELD', 'PLAY-OP-ACTION-UNDECLARED']));
  });

  it('profile 级声明与 effects 汇总不一致会被报出来', () => {
    const broken = mutate(profileNamed('vehicles/sedan.json'), (document) => {
      document[declaredOpsField('vehicles')] = ['prop.set'];
    });
    expect(codesOf(auditKernelOpDeclarations([broken], ops))).toContain('PLAY-OP-PROFILE-MISMATCH');
  });

  it('把已经落地的 Op 混进 pendingKernelOps 会被报出来', () => {
    const broken = mutate(profileNamed('items/item_bandage.json'), (document) => {
      document[PENDING_OPS_FIELD] = ['prop.add'];
    });
    expect(codesOf(auditKernelOpDeclarations([broken], ops))).toContain('PLAY-OP-PENDING-OVERLAP');
  });

  it('引用未注册的 Op 会被报出来', () => {
    const broken = mutate(profileNamed('weapons/wp_fists.json'), (document) => {
      const actions = document['actions'] as Record<string, unknown>[];
      const effects = actions[0]!['effects'] as Record<string, unknown>[];
      effects[0]!['op'] = 'damage.apply';
      actions[0]!['kernelOps'] = ['damage.apply'];
      document['kernelOps'] = ['damage.apply'];
    });
    expect(codesOf(auditKernelOpDeclarations([broken], ops))).toContain('PLAY-OP-UNREGISTERED');
  });

  it('状态 profile 用了 Op 却不声明会被报出来', () => {
    const broken = mutate(profileNamed('statuses/status_poisoned.json'), (document) => {
      delete document['kernelOps'];
    });
    expect(codesOf(auditKernelOpDeclarations([broken], ops))).toContain('PLAY-OP-PROFILE-UNDECLARED');
  });
});

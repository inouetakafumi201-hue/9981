import { describe, expect, it } from 'vitest';

import { profileFixture } from '../../__tests__/support/fixtures';
import {
  conflictsWithRuleVisibility,
  inspect,
  resolveSalienceTier,
  resolveSalientStates,
  type SalientStateDeclaration,
} from '../salience';

const PROFILE = profileFixture();

function declaration(overrides: Partial<SalientStateDeclaration> = {}): SalientStateDeclaration {
  return {
    stateSemanticId: 'weakness',
    ownerEntityId: 'e1',
    accessibleLabel: '弱点：钝击',
    ruleVisibility: 'public',
    ...overrides,
  };
}

describe('三档分层解析（tasks.md 任务 4.5）', () => {
  it('三档各有解析用例', () => {
    expect(
      resolveSalienceTier({
        stateSemanticId: 'weakness',
        profile: PROFILE,
        ruleVisibility: 'public',
        presentationLocation: 'p/1',
      }),
    ).toMatchObject({ ok: true, value: 'public-persistent' });
    expect(
      resolveSalienceTier({
        stateSemanticId: 'aiming',
        profile: PROFILE,
        ruleVisibility: 'public',
        presentationLocation: 'p/1',
      }),
    ).toMatchObject({ ok: true, value: 'public-on-inspect' });
    expect(
      resolveSalienceTier({
        stateSemanticId: 'parry-ready',
        profile: PROFILE,
        ruleVisibility: 'hidden',
        presentationLocation: 'p/1',
      }),
    ).toMatchObject({ ok: true, value: 'hidden' });
  });

  it('未显式声明分层的状态被拒绝，不落到默认档位', () => {
    const result = resolveSalienceTier({
      stateSemanticId: 'undeclared-state',
      profile: PROFILE,
      ruleVisibility: 'public',
      presentationLocation: 'p/1',
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('DESCRIPTOR_SEMANTIC_FIELD_MISSING');
  });
});

describe('分层与规则层可见性矛盾即拒绝（Requirement 3.14）', () => {
  it('两个方向的矛盾都被判为冲突', () => {
    expect(conflictsWithRuleVisibility('public-persistent', 'hidden')).toBe(true);
    expect(conflictsWithRuleVisibility('public-on-inspect', 'hidden')).toBe(true);
    expect(conflictsWithRuleVisibility('hidden', 'public')).toBe(true);
    expect(conflictsWithRuleVisibility('hidden', 'hidden')).toBe(false);
    expect(conflictsWithRuleVisibility('public-persistent', 'public')).toBe(false);
  });

  it('把规则层隐藏的状态标为公开档时产出 SALIENCE_TIER_CONFLICT', () => {
    const result = resolveSalienceTier({
      stateSemanticId: 'weakness',
      profile: PROFILE,
      ruleVisibility: 'hidden',
      presentationLocation: 'p/1',
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('SALIENCE_TIER_CONFLICT');
    expect(result.diagnostics[0]?.severity).toBe('error');
  });

  it('把规则层公开的状态标为 hidden 时同样冲突', () => {
    const result = resolveSalienceTier({
      stateSemanticId: 'parry-ready',
      profile: PROFILE,
      ruleVisibility: 'public',
      presentationLocation: 'p/1',
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('SALIENCE_TIER_CONFLICT');
  });

  it('hidden 档声明了渲染器时被拒绝', () => {
    const badProfile = profileFixture({
      salienceTiers: [
        { stateSemanticId: 'parry-ready', tier: 'hidden', renderer: 'glow', authoritativeSource: 'D-032' },
      ],
    });
    const result = resolveSalienceTier({
      stateSemanticId: 'parry-ready',
      profile: badProfile,
      ruleVisibility: 'hidden',
      presentationLocation: 'p/1',
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('SALIENCE_TIER_CONFLICT');
  });
});

describe('hidden 档对非所有者逐项等同于不存在（Requirement 3.13、6.15）', () => {
  const declarations: readonly SalientStateDeclaration[] = Object.freeze([
    declaration(),
    declaration({
      stateSemanticId: 'parry-ready',
      accessibleLabel: '招架准备',
      ruleVisibility: 'hidden',
    }),
  ]);

  it('非所有者视角的呈现输出与该状态不存在时逐项相等', () => {
    const observed = resolveSalientStates({
      declarations,
      profile: PROFILE,
      observerOwnedEntityIds: ['e2'],
    });
    const withoutHidden = resolveSalientStates({
      declarations: [declaration()],
      profile: PROFILE,
      observerOwnedEntityIds: ['e2'],
    });
    expect(observed.views).toStrictEqual(withoutHidden.views);
    expect(observed.views).toHaveLength(1);
    expect(JSON.stringify(observed)).not.toContain('parry-ready');
  });

  it('所有者本人仍能看到自己的 hidden 档状态', () => {
    const owner = resolveSalientStates({
      declarations,
      profile: PROFILE,
      observerOwnedEntityIds: ['e1'],
    });
    expect(owner.views.map((state) => state.stateSemanticId)).toEqual(['parry-ready', 'weakness']);
    expect(owner.views.find((state) => state.tier === 'hidden')?.renderer).toBeNull();
  });

  it('顺序与计数不泄漏 hidden 档的存在', () => {
    const observed = resolveSalientStates({
      declarations,
      profile: PROFILE,
      observerOwnedEntityIds: [],
    });
    expect(observed.views).toHaveLength(1);
    expect(observed.views[0]?.stateSemanticId).toBe('weakness');
  });
});

describe('public-on-inspect 的检视是纯本地操作（Requirement 3.12）', () => {
  it('检视不产生交互意图、不消耗资源、不改变语义状态', () => {
    const resolution = resolveSalientStates({
      declarations: [declaration({ stateSemanticId: 'aiming', accessibleLabel: '瞄准中' })],
      profile: PROFILE,
      observerOwnedEntityIds: ['e2'],
    });
    const state = resolution.views[0];
    expect(state).toBeDefined();
    if (state === undefined) throw new Error('unreachable');
    const outcome = inspect(state);
    expect(outcome.presented).toBe(true);
    expect(outcome.producedIntent).toBe(false);
    expect(outcome.consumedResources).toBe(false);
    expect(outcome.changedSemanticState).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { profileFixture } from '../../__tests__/support/fixtures.js';
import {
  DEFAULT_CEREMONIAL_ACTION_SEMANTICS,
  deriveDecorationVariant,
  planCeremonialPresentation,
  stableHash,
  visibleStableIdFromProjection,
  type CeremonialPresentationMode,
} from '../ceremonial.js';

const VISIBLE_ID = visibleStableIdFromProjection('visible:e1:event:42');

function plan(
  actionSemanticId: string,
  resolutionBranch: 'resolved' | 'received-melee-attack' | 'received-ranged-attack' | 'received-unparryable-damage' = 'resolved',
  mode: CeremonialPresentationMode = 'standard',
) {
  return planCeremonialPresentation({
    actionSemanticId,
    resolutionBranch,
    profile: profileFixture(),
    mode,
    visibleStableId: VISIBLE_ID,
    decorationVariantCount: 5,
    accessibleLabel: `演出 ${actionSemanticId}`,
  });
}

describe('仪式集合由 profile 闭合决定', () => {
  it('默认四项均可获得全屏呈现，招架只使用近战结算分支', () => {
    expect(DEFAULT_CEREMONIAL_ACTION_SEMANTICS).toEqual([
      'vault-window',
      'jump-window',
      'lay-to-rest',
      'parry-trigger',
    ]);
    for (const semantic of DEFAULT_CEREMONIAL_ACTION_SEMANTICS) {
      const branch = semantic === 'parry-trigger' ? 'received-melee-attack' : 'resolved';
      expect(plan(semantic, branch)).toEqual([
        expect.objectContaining({
          kind: 'fullscreen',
          actionSemanticId: semantic,
          fullscreen: true,
          changedSemanticState: false,
          changedLegality: false,
          changedCost: false,
        }),
      ]);
    }
  });

  it('集合外语义一律没有全屏或其他仪式呈现', () => {
    expect(plan('ordinary-attack')).toEqual([]);
    expect(plan('new-unconfirmed-action')).toEqual([]);
  });

  it('招架因远程或不可招架伤害失效时完全静默', () => {
    expect(plan('parry-trigger', 'resolved')).toEqual([]);
    expect(plan('parry-trigger', 'received-ranged-attack')).toEqual([]);
    expect(plan('parry-trigger', 'received-unparryable-damage')).toEqual([]);
  });
});

describe('跳过例外只替换表现', () => {
  it.each([
    ['user-skipped', 'accessible-announcement'],
    ['reduced-motion', 'static-equivalent'],
    ['resource-fallback', 'resource-fallback'],
  ] as const)('%s 不使用全屏且保留规则中立等价呈现', (mode, expectedKind) => {
    const result = plan('vault-window', 'resolved', mode);
    expect(result).toEqual([
      expect.objectContaining({
        kind: expectedKind,
        fullscreen: false,
        changedSemanticState: false,
        changedLegality: false,
        changedCost: false,
      }),
    ]);
  });
});

describe('装饰变化只从可见稳定标识确定性派生', () => {
  it('同一标识跨调用得到相同散列与变体', () => {
    expect(stableHash(VISIBLE_ID)).toBe(stableHash(VISIBLE_ID));
    expect(deriveDecorationVariant(VISIBLE_ID, 5)).toBe(
      deriveDecorationVariant(VISIBLE_ID, 5),
    );
    expect(plan('vault-window')[0]?.decorationVariant).toBe(
      plan('vault-window')[0]?.decorationVariant,
    );
  });

  it('变体恒在声明范围内，非法范围显式拒绝', () => {
    expect(deriveDecorationVariant(VISIBLE_ID, 5)).toBeGreaterThanOrEqual(0);
    expect(deriveDecorationVariant(VISIBLE_ID, 5)).toBeLessThan(5);
    expect(() => deriveDecorationVariant(VISIBLE_ID, 0)).toThrow(/positive safe integer/u);
  });
});

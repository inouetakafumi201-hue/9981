import { describe, expect, it } from 'vitest';

import { profileFixture } from '../../__tests__/support/fixtures.js';
import {
  GENERIC_UNAVAILABILITY_TEXT,
  playerVisibleUnavailabilityText,
  presentUnavailability,
} from '../unavailability-reason.js';

const RAW = '目标在 3 号房间，超出射程';

describe('不可用原因安全化（tasks.md 任务 4.4）', () => {
  it('原文永不出现在玩家可见输出中', () => {
    const outcomes = [
      presentUnavailability({
        reasonKey: undefined,
        rawReason: RAW,
        profile: profileFixture(),
        developerAuthority: 'none',
        presentationLocation: 'p/1',
      }),
      presentUnavailability({
        reasonKey: 'out-of-range',
        rawReason: RAW,
        profile: profileFixture(),
        developerAuthority: 'none',
        presentationLocation: 'p/1',
      }),
      presentUnavailability({
        reasonKey: 'out-of-range',
        rawReason: RAW,
        profile: profileFixture({ safeUnavailabilityReasons: { 'out-of-range': '超出可及范围' } }),
        developerAuthority: 'none',
        presentationLocation: 'p/1',
      }),
    ];
    for (const outcome of outcomes) {
      expect(playerVisibleUnavailabilityText(outcome)).not.toContain('3 号房间');
      expect(playerVisibleUnavailabilityText(outcome).length).toBeGreaterThan(0);
    }
  });

  it('已登记的原因键取映射后的安全文案', () => {
    const outcome = presentUnavailability({
      reasonKey: 'out-of-range',
      profile: profileFixture({ safeUnavailabilityReasons: { 'out-of-range': '超出可及范围' } }),
      developerAuthority: 'none',
      presentationLocation: 'p/1',
    });
    expect(outcome.ok).toBe(true);
    expect(playerVisibleUnavailabilityText(outcome)).toBe('超出可及范围');
    expect(outcome.diagnostics).toEqual([]);
  });

  it('无映射时输出通用文案而非留空或原文，并产出 warn', () => {
    const outcome = presentUnavailability({
      reasonKey: 'unmapped-key',
      rawReason: RAW,
      profile: profileFixture(),
      developerAuthority: 'none',
      presentationLocation: 'p/1',
    });
    expect(outcome.ok).toBe(true);
    expect(playerVisibleUnavailabilityText(outcome)).toBe(GENERIC_UNAVAILABILITY_TEXT);
    expect(outcome.diagnostics[0]?.severity).toBe('warn');
  });

  it('缺映射键字段时返回 PENDING_CONVERGENCE_CONTRACT，同时给出可安全呈现的文案', () => {
    const outcome = presentUnavailability({
      reasonKey: undefined,
      rawReason: RAW,
      profile: profileFixture(),
      developerAuthority: 'none',
      presentationLocation: 'p/1',
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.code).toBe('PENDING_CONVERGENCE_CONTRACT');
    expect(outcome.missing).toEqual(['unavailability-reason-mapping-key']);
    expect(outcome.visibilitySafeFallbackText).toBe(GENERIC_UNAVAILABILITY_TEXT);
    expect(outcome.diagnostics[0]?.code).toBe('PENDING_CONVERGENCE_CONTRACT');
    expect(outcome.diagnostics[0]?.severity).toBe('error');
  });

  it('原文只在显式上游授权时进入开发诊断文本', () => {
    const unauthorized = presentUnavailability({
      reasonKey: 'unmapped-key',
      rawReason: RAW,
      profile: profileFixture(),
      developerAuthority: 'none',
      presentationLocation: 'p/1',
    });
    if (!unauthorized.ok) throw new Error('unreachable');
    expect(unauthorized.value.developerText).toBeUndefined();
    expect(JSON.stringify(unauthorized)).not.toContain('3 号房间');

    const authorized = presentUnavailability({
      reasonKey: 'unmapped-key',
      rawReason: RAW,
      profile: profileFixture(),
      developerAuthority: 'upstream-authorized',
      presentationLocation: 'p/1',
    });
    if (!authorized.ok) throw new Error('unreachable');
    expect(authorized.value.developerText).toBe(RAW);
    expect(authorized.value.playerText).toBe(GENERIC_UNAVAILABILITY_TEXT);
  });

  it('没有原文时授权开发面也不凭空生成文本', () => {
    const outcome = presentUnavailability({
      reasonKey: 'unmapped-key',
      profile: profileFixture(),
      developerAuthority: 'upstream-authorized',
      presentationLocation: 'p/1',
    });
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.value.developerText).toBeUndefined();
  });
});

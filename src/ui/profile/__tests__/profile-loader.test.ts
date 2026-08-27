import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { UI_DIAGNOSTIC_CODES } from '../../model/diagnostic';
import { loadPresentationProfile } from '../profile-loader';

const DEFAULT_PROFILE_TEXT = readFileSync(
  new URL('../wakeup-default.profile.json', import.meta.url),
  'utf8',
);

function expectRejectedWith(source: string, code: string): void {
  const result = loadPresentationProfile(source);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.diagnostics.map((item) => item.code)).toContain(code);
}

describe('默认 Presentation_Profile', () => {
  it('通过严格装载且仪式集合恰为四项', () => {
    const result = loadPresentationProfile(DEFAULT_PROFILE_TEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ceremonialActionSemantics.map((item) => item.actionSemanticId)).toEqual([
      'vault-window',
      'jump-window',
      'lay-to-rest',
      'parry-trigger',
    ]);
    expect(result.value.salienceTiers.map((item) => item.stateSemanticId)).toEqual([
      'weakness',
      'aiming',
      'parry-ready',
    ]);
    expect(result.value.endTurnCountdown.seconds).toMatchObject({
      __brand: 'InternalMetric',
      value: 3,
      unit: 's',
    });
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.ceremonialActionSemantics)).toBe(true);
  });

  it('数值字面量只出现在两个明确的内部度量路径', () => {
    const parsed = JSON.parse(DEFAULT_PROFILE_TEXT) as unknown;
    const numericPaths: string[] = [];
    const visit = (value: unknown, path: string): void => {
      if (typeof value === 'number') numericPaths.push(path);
      else if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${path}/${index}`));
      else if (value !== null && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) visit(child, `${path}/${key}`);
      }
    };
    visit(parsed, '');
    expect(numericPaths.sort()).toEqual(['/endTurnCountdown/seconds', '/eventBufferTimeout']);
  });
});

describe('来源与规则边界拒绝', () => {
  it('仪式项缺来源时 CEREMONIAL_SOURCE_MISSING', () => {
    const source = DEFAULT_PROFILE_TEXT.replace(', "authoritativeSource": "D-026"', '');
    expectRejectedWith(source, UI_DIAGNOSTIC_CODES.CEREMONIAL_SOURCE_MISSING);
  });

  it('仪式项引用未确认编号时 CEREMONIAL_SOURCE_MISSING', () => {
    const source = DEFAULT_PROFILE_TEXT.replace('"D-026"', '"D-999"');
    expectRejectedWith(source, UI_DIAGNOSTIC_CODES.CEREMONIAL_SOURCE_MISSING);
  });

  it('规则语义字段导致整个 profile 被拒绝', () => {
    const source = DEFAULT_PROFILE_TEXT.replace(
      '"mapBackground": "sketch",',
      '"mapBackground": "sketch", "damage": 3,',
    );
    expectRejectedWith(source, UI_DIAGNOSTIC_CODES.PROFILE_RULE_SEMANTIC_FIELD);
  });

  it('未分类数值字面量导致整个 profile 被拒绝', () => {
    const source = DEFAULT_PROFILE_TEXT.replace(
      '"mapBackground": "sketch",',
      '"mapBackground": "sketch", "animationFrames": 12,',
    );
    expectRejectedWith(source, UI_DIAGNOSTIC_CODES.PROFILE_RULE_SEMANTIC_FIELD);
  });

  it('显著性档位与规则可见性冲突时 SALIENCE_TIER_CONFLICT', () => {
    const source = DEFAULT_PROFILE_TEXT.replace('"tier": "public-persistent"', '"tier": "hidden"');
    expectRejectedWith(source, UI_DIAGNOSTIC_CODES.SALIENCE_TIER_CONFLICT);
  });
});

describe('严格 JSON 链', () => {
  it('拒绝重复键', () => {
    expectRejectedWith(
      '{"version":"1", "version":"2"}',
      UI_DIAGNOSTIC_CODES.JSON_SEMANTIC_FIELD_DAMAGED,
    );
    const result = loadPresentationProfile('{"version":"1", "version":"2"}');
    if (!result.ok) expect(result.diagnostics[0]?.internalFields?.parserCode).toBe('E_LOAD_DUPLICATE_MEMBER');
  });

  it('拒绝危险可执行键', () => {
    const source = DEFAULT_PROFILE_TEXT.replace(
      '"version": "1.1.0",',
      '"version": "1.1.0", "$exec": "do-not-run",',
    );
    expectRejectedWith(source, UI_DIAGNOSTIC_CODES.JSON_SEMANTIC_FIELD_DAMAGED);
    const result = loadPresentationProfile(source);
    if (!result.ok) expect(result.diagnostics[0]?.internalFields?.parserCode).toBe('E_LOAD_PROHIBITED_CONSTRUCT');
  });
});

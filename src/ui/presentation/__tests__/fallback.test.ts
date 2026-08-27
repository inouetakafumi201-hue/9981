import { describe, expect, it } from 'vitest';

import {
  animationFallbackPresentsFinalState,
  resolveFallback,
  retainedChannelsAfterFailure,
  type DeclaredFallback,
} from '../fallback';

const GENERIC_ICON: DeclaredFallback = Object.freeze({
  kind: 'icon',
  assetRef: 'a-generic-icon',
  scope: 'generic',
  derivedFrom: 'stableIdentifier',
});
const TYPED_ICON: DeclaredFallback = Object.freeze({
  kind: 'icon',
  assetRef: 'b-hostile-icon',
  scope: 'type-specific',
  derivedFrom: 'interactionIntent',
});

describe('表现字段降级（tasks.md 任务 4.2）', () => {
  it('存在类型兼容回退时应用它，并产出 warn 级 PRESENTATION_FALLBACK_APPLIED', () => {
    const outcome = resolveFallback(
      { kind: 'icon', presentationLocation: 'p/1', semanticTypeHidden: false, essential: true },
      [TYPED_ICON, GENERIC_ICON],
    );
    expect(outcome.kind).toBe('applied');
    expect(outcome.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'PRESENTATION_FALLBACK_APPLIED',
    ]);
    expect(outcome.diagnostics[0]?.severity).toBe('warn');
  });

  it('回退选择确定性：候选按码点序取第一个', () => {
    const first = resolveFallback(
      { kind: 'icon', presentationLocation: 'p/1', semanticTypeHidden: false, essential: true },
      [TYPED_ICON, GENERIC_ICON],
    );
    const second = resolveFallback(
      { kind: 'icon', presentationLocation: 'p/1', semanticTypeHidden: false, essential: true },
      [GENERIC_ICON, TYPED_ICON],
    );
    expect(first).toStrictEqual(second);
    if (first.kind !== 'applied') throw new Error('unreachable');
    expect(first.asset.assetRef).toBe('a-generic-icon');
  });

  it('语义类型隐藏时只允许 generic 回退，类型特定回退不得被选中', () => {
    const outcome = resolveFallback(
      { kind: 'icon', presentationLocation: 'p/1', semanticTypeHidden: true, essential: true },
      [TYPED_ICON],
    );
    expect(outcome.kind).toBe('rejected');

    const safe = resolveFallback(
      { kind: 'icon', presentationLocation: 'p/1', semanticTypeHidden: true, essential: true },
      [TYPED_ICON, GENERIC_ICON],
    );
    if (safe.kind !== 'applied') throw new Error('unreachable');
    expect(safe.asset.scope).toBe('generic');
  });
});

describe('必要与非必要资源的分界（Requirement 9.9）', () => {
  it('非必要资源无回退时省略并告警，不拒绝', () => {
    const outcome = resolveFallback(
      { kind: 'sound', presentationLocation: 'p/1', semanticTypeHidden: false, essential: false },
      [],
    );
    expect(outcome.kind).toBe('omitted');
    expect(outcome.diagnostics[0]?.severity).toBe('warn');
  });

  it('可访问性必需的资源无回退时拒绝该呈现，产出 error', () => {
    const outcome = resolveFallback(
      { kind: 'icon', presentationLocation: 'p/1', semanticTypeHidden: false, essential: true },
      [],
    );
    expect(outcome.kind).toBe('rejected');
    expect(outcome.diagnostics[0]?.severity).toBe('error');
    expect(outcome.diagnostics[0]?.code).toBe('ACCESSIBLE_LABEL_MISSING');
  });

  it('降级不改变动作可用性：返回结果里没有任何可用性字段', () => {
    const outcome = resolveFallback(
      { kind: 'texture', presentationLocation: 'p/1', semanticTypeHidden: false, essential: false },
      [],
    );
    expect(JSON.stringify(outcome)).not.toContain('available');
    expect(JSON.stringify(outcome)).not.toContain('enabled');
  });

  it('不存在把语义错误转成 warn 的路径：拒绝分支的诊断恒为 error', () => {
    const outcome = resolveFallback(
      { kind: 'font', presentationLocation: 'p/1', semanticTypeHidden: false, essential: true },
      [],
    );
    expect(outcome.diagnostics.every((diagnostic) => diagnostic.severity === 'error')).toBe(true);
  });
});

describe('动画与感官通道回退', () => {
  it('动画回退时仍呈现已提交的最终语义状态', () => {
    const omitted = resolveFallback(
      { kind: 'animation-clip', presentationLocation: 'p/1', semanticTypeHidden: false, essential: false },
      [],
    );
    expect(animationFallbackPresentsFinalState(omitted)).toBe(true);
  });

  it('音频或触觉失效时保留视觉与无障碍文本通道', () => {
    expect(retainedChannelsAfterFailure('sound')).toEqual(['visual', 'accessible-text']);
    expect(retainedChannelsAfterFailure('haptic')).toEqual(['visual', 'accessible-text']);
    expect(retainedChannelsAfterFailure('icon')).toEqual(['accessible-text']);
  });
});

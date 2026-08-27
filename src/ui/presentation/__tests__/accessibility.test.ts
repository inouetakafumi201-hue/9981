import { describe, expect, it } from 'vitest';

import { actionView, revision } from '../../__tests__/support/fixtures';
import { makeInternalMetric } from '../gameplay-value';
import type { UiView } from '../../model/view';
import {
  buildAccessibleOutputs,
  checkNonColorEquivalent,
  isLabelMissing,
  resolveAccessibleLabel,
  ruleSignificantItems,
} from '../accessibility';

function view(): UiView {
  return Object.freeze({
    revision: revision(1, 'fp-1'),
    agentId: 'agent.a',
    scopeId: 'scope.a',
    turn: makeInternalMetric(1, 'turn-index'),
    entities: Object.freeze([
      Object.freeze({
        entityId: 'e1',
        viewToken: 'view:e1',
        statusIds: Object.freeze([]),
        resources: Object.freeze([]),
        salientStates: Object.freeze([
          Object.freeze({
            stateSemanticId: 'weakness',
            ownerEntityId: 'e1',
            tier: 'public-persistent' as const,
            renderer: 'above-head-icon',
            accessibleLabel: '弱点：钝击',
          }),
          Object.freeze({
            stateSemanticId: 'parry-ready',
            ownerEntityId: 'e1',
            tier: 'hidden' as const,
            renderer: null,
            accessibleLabel: '招架准备',
          }),
        ]),
        remembered: false,
      }),
    ]),
    actions: Object.freeze([actionView()]),
    decisions: Object.freeze([]),
    turnOrder: Object.freeze([]),
    diagnostics: Object.freeze([]),
  });
}

describe('无障碍标签缺失判定（J-2、C-7）', () => {
  it('空串与纯空白都判为缺失', () => {
    expect(isLabelMissing('')).toBe(true);
    expect(isLabelMissing('   ')).toBe(true);
    expect(isLabelMissing('\t\n')).toBe(true);
    expect(isLabelMissing('移动')).toBe(false);
    expect(isLabelMissing(undefined)).toBe(true);
    expect(isLabelMissing(42)).toBe(true);
  });

  it('空串与纯空白两种输入都走稳定标识回退并产出警告', () => {
    for (const label of ['', '   ']) {
      const resolution = resolveAccessibleLabel({
        label,
        stableIdentifier: 'act.move',
        essential: true,
        presentationLocation: 'p/1',
      });
      expect(resolution.kind, JSON.stringify(label)).toBe('fallback');
      expect(resolution.text).toBe('act.move');
      expect(resolution.diagnostics[0]?.code).toBe('PRESENTATION_FALLBACK_APPLIED');
      expect(resolution.diagnostics[0]?.severity).toBe('warn');
    }
  });

  it('连稳定标识都取不到、且该呈现是必要的，才拒绝并产出 error', () => {
    const resolution = resolveAccessibleLabel({
      label: '',
      stableIdentifier: undefined,
      essential: true,
      presentationLocation: 'p/1',
    });
    expect(resolution.kind).toBe('rejected');
    expect(resolution.diagnostics[0]?.code).toBe('ACCESSIBLE_LABEL_MISSING');
    expect(resolution.diagnostics[0]?.severity).toBe('error');
  });

  it('非必要呈现缺标签且无回退时省略，而不是拒绝', () => {
    const resolution = resolveAccessibleLabel({
      label: '',
      stableIdentifier: undefined,
      essential: false,
      presentationLocation: 'p/1',
    });
    expect(resolution.kind).toBe('omitted');
    expect(resolution.diagnostics[0]?.severity).toBe('warn');
  });

  it('有效标签被去除首尾空白后直接使用，不产出诊断', () => {
    const resolution = resolveAccessibleLabel({
      label: '  移动  ',
      stableIdentifier: 'act.move',
      essential: true,
      presentationLocation: 'p/1',
    });
    expect(resolution.kind).toBe('label');
    expect(resolution.text).toBe('移动');
    expect(resolution.diagnostics).toEqual([]);
  });
});

describe('颜色不得单独承载规则信息（Requirement 11.2、11.3）', () => {
  it('仅以颜色区分语义角色时产出 error', () => {
    const diagnostics = checkNonColorEquivalent({
      semanticRoleId: 'hp',
      usesColor: true,
      nonColorCues: [],
      presentationLocation: 'p/1',
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe('error');
  });

  it('存在任一非颜色线索即通过', () => {
    for (const cue of ['shape', 'texture', 'icon-structure', 'text'] as const) {
      expect(
        checkNonColorEquivalent({
          semanticRoleId: 'hp',
          usesColor: true,
          nonColorCues: [cue],
          presentationLocation: 'p/1',
        }),
      ).toEqual([]);
    }
  });

  it('不使用颜色的呈现不受该约束', () => {
    expect(
      checkNonColorEquivalent({
        semanticRoleId: 'hp',
        usesColor: false,
        nonColorCues: [],
        presentationLocation: 'p/1',
      }),
    ).toEqual([]);
  });
});

describe('各通道消费同一份已过滤投影（Requirement 11.4、11.10、11.11）', () => {
  it('hidden 档状态不进入任何通道', () => {
    const items = ruleSignificantItems(view());
    expect(items.map((item) => item.itemId)).not.toContain('salient:e1:parry-ready');
    expect(items.map((item) => item.itemId)).toContain('salient:e1:weakness');
    expect(JSON.stringify(items)).not.toContain('招架准备');
  });

  it('读屏与字幕的信息集合与视觉项逐项一致', () => {
    const outputs = buildAccessibleOutputs(view(), { failedChannels: [], reducedMotion: false });
    const labels = outputs.visual.map((item) => item.accessibleLabel);
    expect(outputs.screenReader).toEqual(labels);
    expect(outputs.captions).toEqual(labels);
    expect(outputs.ariaMetadata.map((entry) => entry.label)).toEqual(labels);
  });

  it('动画、音频、触觉失效时每个规则显著结果仍有无障碍等价物', () => {
    const failed = buildAccessibleOutputs(view(), {
      failedChannels: ['animation', 'audio', 'haptics'],
      reducedMotion: false,
    });
    const healthy = buildAccessibleOutputs(view(), { failedChannels: [], reducedMotion: false });
    expect(failed.screenReader).toEqual(healthy.screenReader);
    expect(failed.captions).toEqual(healthy.captions);
    expect(failed.ariaMetadata).toEqual(healthy.ariaMetadata);
    expect(failed.hapticPatterns).toEqual([]);
  });

  it('减少动态替代物不编码隐藏状态', () => {
    const outputs = buildAccessibleOutputs(view(), { failedChannels: [], reducedMotion: true });
    expect(outputs.reducedMotionAlternatives).toHaveLength(outputs.visual.length);
    expect(JSON.stringify(outputs.reducedMotionAlternatives)).not.toContain('parry-ready');
  });

  it('规则显著项按标识排序，因此输出确定性', () => {
    const first = ruleSignificantItems(view());
    const second = ruleSignificantItems(view());
    expect(first).toEqual(second);
    expect(first.map((item) => item.itemId)).toEqual([...first.map((item) => item.itemId)].sort());
  });
});

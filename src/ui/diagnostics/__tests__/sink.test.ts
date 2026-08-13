import { describe, expect, it, vi } from 'vitest';

import { authority, revision, scope } from '../../__tests__/support/fixtures.js';
import {
  UI_DIAGNOSTIC_CODES,
  uiDiagnostic,
  type UiDiagnosticCode,
} from '../../model/diagnostic.js';
import { createAuthorizedAgent } from '../../model/view.js';
import {
  DIAGNOSTIC_CATEGORIES,
  createDiagnosticSink,
  opaqueResourceId,
  renderDiagnosticsSafely,
  type DiagnosticCategory,
} from '../sink.js';

function diagnostic(code: UiDiagnosticCode = UI_DIAGNOSTIC_CODES.PRESENTATION_RESOURCE_FAILED) {
  return uiDiagnostic({
    code,
    presentationLocation: 'hud/visible-control',
    reason: '已安全化的开发原因',
    correctionSuggestion: '检查表现资源',
    revision: revision(2, 'fp-2'),
    internalFields: { latencyMs: 12, hiddenRawName: '不得进入用户面' },
  });
}

function recordCategory(category: DiagnosticCategory, developmentSurface = false) {
  const agent = createAuthorizedAgent(
    'agent.a',
    scope({ visibleEntityIds: ['e1'] }),
    authority(false, developmentSurface),
    {
      showInternalMetrics: true,
      verbosePresentationLog: true,
      overlayGrid: true,
    },
  );
  const sink = createDiagnosticSink(agent);
  sink.record({
    category,
    diagnostic: diagnostic(),
    affectedEntityIds: ['e1', 'hidden-e2'],
    safeContext: { control: 'visible-control' },
    occurrence: 1,
  });
  return sink;
}

describe('诊断汇记录五类结构化诊断', () => {
  it('五个类别均可独立记录与读取', () => {
    expect(DIAGNOSTIC_CATEGORIES).toEqual([
      'descriptor-rejection',
      'stale-interaction',
      'projection-gap',
      'resource-failure',
      'fallback-selection',
    ]);
    for (const category of DIAGNOSTIC_CATEGORIES) {
      expect(recordCategory(category).read('user')[0]?.category).toBe(category);
    }
  });

  it('用户面只保留可见实体与通用安全文案，不暴露内部字段', () => {
    const entry = recordCategory('resource-failure').read('user')[0];
    expect(entry?.affectedEntityIds).toEqual(['e1']);
    expect(entry?.displayText).toBe('部分表现资源未能加载');
    expect(entry).not.toHaveProperty('code');
    expect(entry).not.toHaveProperty('firstSafeContext');
    expect(entry).not.toHaveProperty('technicalFields');
    expect(JSON.stringify(entry)).not.toContain('hidden-e2');
    expect(JSON.stringify(entry)).not.toContain('hiddenRawName');
    expect(entry?.revision).toEqual(revision(2, 'fp-2'));
  });

  it('全部关联实体均不可见时整条诊断不可观察', () => {
    const agent = createAuthorizedAgent('agent.a', scope({ visibleEntityIds: ['e1'] }), authority());
    const sink = createDiagnosticSink(agent);
    sink.record({
      category: 'projection-gap',
      diagnostic: diagnostic(UI_DIAGNOSTIC_CODES.PROJECTION_REVISION_GAP),
      affectedEntityIds: ['hidden-e2'],
      safeContext: {},
      occurrence: 1,
    });
    expect(sink.size()).toBe(0);
    expect(sink.read('user')).toEqual([]);
  });
});

describe('开发面授权不能由本地开关取得', () => {
  it('本地调试设置全开但上游未授权时开发面仍为空', () => {
    expect(recordCategory('descriptor-rejection', false).read('authorized-dev')).toEqual([]);
  });

  it('上游明确授权后只增加字段，不增加实体', () => {
    const sink = recordCategory('descriptor-rejection', true);
    const user = sink.read('user')[0];
    const development = sink.read('authorized-dev')[0];
    expect(development?.affectedEntityIds).toEqual(user?.affectedEntityIds);
    expect(development?.code).toBe(UI_DIAGNOSTIC_CODES.PRESENTATION_RESOURCE_FAILED);
    expect(development?.technicalLabel).toBe('诊断/技术信息');
    expect(development?.technicalFields).toMatchObject({ latencyMs: 12 });
  });
});

describe('折叠、资源遥测与渲染失败', () => {
  it('重复失败保留首次安全上下文、最近发生序号与计数', () => {
    const sink = recordCategory('fallback-selection', true);
    sink.record({
      category: 'fallback-selection',
      diagnostic: diagnostic(),
      affectedEntityIds: ['e1'],
      safeContext: { control: 'later-context' },
      occurrence: 8,
    });
    const entry = sink.read('authorized-dev')[0];
    expect(entry?.firstSafeContext).toEqual({ control: 'visible-control' });
    expect(entry?.latestOccurrence).toBe(8);
    expect(entry?.count).toBe(2);
  });

  it('描述性资源名称只以不透明标识记录', () => {
    const raw = 'secret-boss-phase-texture.png';
    const opaque = opaqueResourceId(raw);
    const sink = recordCategory('resource-failure');
    sink.clear();
    sink.record({
      category: 'resource-failure',
      diagnostic: diagnostic(),
      affectedEntityIds: ['e1'],
      safeContext: {},
      occurrence: 1,
      opaqueResourceId: opaque,
    });
    expect(opaque).toMatch(/^resource:[0-9a-f]{8}$/u);
    expect(opaque).not.toContain(raw);
    expect(JSON.stringify(sink.read('user'))).not.toContain(raw);
  });

  it('诊断渲染器失败保留原投影且绝不请求重试规则动作', () => {
    const projection = Object.freeze({ fingerprint: 'unchanged' });
    const renderer = vi.fn(() => {
      throw new Error('renderer failed');
    });
    const result = renderDiagnosticsSafely(projection, recordCategory('projection-gap').read('user'), renderer);
    expect(result.projection).toBe(projection);
    expect(result.rendererFailed).toBe(true);
    expect(result.retryRuleAction).toBe(false);
    expect(renderer).toHaveBeenCalledOnce();
  });
});

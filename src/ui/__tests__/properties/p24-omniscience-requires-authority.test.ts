// Feature: wakeup-ui-animation, Property 24: 全知视角不由本地开关获得
import fc from 'fast-check';
import { expect, it } from 'vitest';

import { createDiagnosticSink } from '../../diagnostics/sink.js';
import { UI_DIAGNOSTIC_CODES, uiDiagnostic } from '../../model/diagnostic.js';
import { createAuthorizedAgent } from '../../model/view.js';
import { arbAgent } from '../support/arbitraries.js';
import { authority } from '../support/fixtures.js';

it('任意本地调试设置都不能打开开发或全知面，只有上游令牌可授权附加字段', () => {
  fc.assert(fc.property(arbAgent(), (generated) => {
    const localOnly = createAuthorizedAgent(generated.agentId, generated.scope, authority(false, false), { showInternalMetrics: true, verbosePresentationLog: true, overlayGrid: true });
    const sink = createDiagnosticSink(localOnly);
    sink.record({ category: 'projection-gap', diagnostic: uiDiagnostic({ code: UI_DIAGNOSTIC_CODES.PROJECTION_REVISION_GAP, presentationLocation: 'visible/location', reason: 'safe', correctionSuggestion: 'sync', internalFields: { metric: 1 } }), affectedEntityIds: [], safeContext: {}, occurrence: 1 });
    expect(sink.read('authorized-dev')).toEqual([]);
    const authorized = createDiagnosticSink(createAuthorizedAgent(generated.agentId, generated.scope, authority(false, true), generated.localDebug));
    authorized.record({ category: 'projection-gap', diagnostic: uiDiagnostic({ code: UI_DIAGNOSTIC_CODES.PROJECTION_REVISION_GAP, presentationLocation: 'visible/location', reason: 'safe', correctionSuggestion: 'sync', internalFields: { metric: 1 } }), affectedEntityIds: [], safeContext: {}, occurrence: 1 });
    expect(authorized.read('authorized-dev')[0]?.technicalLabel).toBe('诊断/技术信息');
    expect(authorized.read('authorized-dev')[0]?.affectedEntityIds).toEqual(authorized.read('user')[0]?.affectedEntityIds);
  }), { numRuns: 100 });
});

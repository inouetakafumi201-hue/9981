// Feature: wakeup-ui-animation, Property 21: 全量与增量收敛到同一视图
import fc from 'fast-check';
import { expect, it } from 'vitest';

import { reduceView } from '../../projection/reconcile.js';
import { arbLegalActionSet } from '../support/arbitraries.js';
import { revision, viewBase } from '../support/fixtures.js';

it('任意全量基底加任意事件增量都与纯全量路径得到逐字段相同视图', () => {
  fc.assert(fc.property(arbLegalActionSet(8), fc.array(fc.nat({ max: 1000 }), { maxLength: 30 }), (actions, sequences) => {
    const current = revision(10, 'fp:current');
    const base = viewBase({ revision: current, actions });
    const events = sequences.map((sequence) => Object.freeze({ sequence, semanticType: `after:${sequence}`, observedAtRevision: current, safePayload: Object.freeze({}) }));
    const full = reduceView(base, []);
    const incremental = reduceView(base, events);
    expect(incremental.view).toStrictEqual(full.view);
    expect(incremental.presentation.map((event) => event.sequence)).toEqual([...sequences].sort((a, b) => a - b));
  }), { numRuns: 100 });
});

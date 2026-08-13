// Feature: wakeup-ui-animation, Property 16: 轮次栏保持全员在列
import fc from 'fast-check';
import { expect, it } from 'vitest';

import { reduceView } from '../../projection/reconcile.js';
import { ENTITY_ID_POOL } from '../support/arbitraries.js';
import { turnOrderEntry, viewBase } from '../support/fixtures.js';

it('任意已投影参与者无论是否已行动都完整保留在轮次栏', () => {
  const entries = fc.uniqueArray(fc.constantFrom(...ENTITY_ID_POOL), { minLength: 0, maxLength: ENTITY_ID_POOL.length }).chain((ids) => fc.tuple(fc.constant(ids), fc.array(fc.boolean(), { minLength: ids.length, maxLength: ids.length })));
  fc.assert(fc.property(entries, ([ids, spent]) => {
    const turnOrder = ids.map((id, index) => turnOrderEntry(id, spent[index] ?? false));
    const base = Object.freeze({ ...viewBase(), turnOrder: Object.freeze(turnOrder) });
    const view = reduceView(base, []).view;
    expect(view.turnOrder.map((entry) => entry.participantId)).toEqual(ids);
    expect(view.turnOrder).toHaveLength(ids.length);
  }), { numRuns: 100 });
});

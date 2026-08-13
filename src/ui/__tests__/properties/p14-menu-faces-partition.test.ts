// Feature: wakeup-ui-animation, Property 14: 两个菜单面互斥且零费动作不受回合末限制
import fc from 'fast-check';
import { expect, it } from 'vitest';

import { buildMenuFaces } from '../../interaction/menu-faces.js';
import { arbLegalActionSet } from '../support/arbitraries.js';

it('任意合法动作集的两个菜单面互斥、并集完整且零费面恒可用', () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 60 }).chain(arbLegalActionSet), (actions) => {
    const faces = buildMenuFaces(actions);
    const availableIds = actions.filter((action) => action.available).map((action) => action.actionId).sort();
    const paid = new Set(faces.paid.map((action) => action.actionId));
    const zero = new Set(faces.zeroCost.map((action) => action.actionId));
    expect([...paid].filter((id) => zero.has(id))).toEqual([]);
    expect([...paid, ...zero].sort()).toEqual(availableIds);
    expect(faces.zeroCostAlwaysAvailable).toBe(true);
    expect(faces.endTurnAvailable).toBe(true);
  }), { numRuns: 100 });
});

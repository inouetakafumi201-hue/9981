// Feature: wakeup-ui-animation, Property 5: 任意呈现通道都不泄漏隐藏信息
import fc from 'fast-check';
import { expect, it } from 'vitest';

import { buildAccessibleOutputs } from '../../presentation/accessibility';
import { reduceView } from '../../projection/reconcile';
import { arbHiddenVariantPair } from '../support/arbitraries';
import { entityView, revision, viewBase } from '../support/fixtures';

function renderVisible(world: { readonly visibleProjection: { readonly entities: readonly { readonly entityId: string }[]; readonly semanticStateFingerprint: string } }) {
  const base = viewBase({ revision: revision(1, world.visibleProjection.semanticStateFingerprint), entityIds: [] });
  const reduced = reduceView(Object.freeze({ ...base, entities: Object.freeze(world.visibleProjection.entities.map((item) => entityView(item.entityId))) }), []);
  return buildAccessibleOutputs(reduced.view, { failedChannels: [], reducedMotion: false });
}

it('可见投影相等而隐藏部分非空不同时全部呈现输出逐项相等', () => {
  fc.assert(fc.property(arbHiddenVariantPair(), ([left, right]) => {
    fc.pre(JSON.stringify(left.hidden) !== JSON.stringify(right.hidden));
    expect(renderVisible(left)).toStrictEqual(renderVisible(right));
  }), { numRuns: 100 });
});

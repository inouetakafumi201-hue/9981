// Feature: wakeup-ui-animation, Property 11: 待决控件不产生第二个意图
import fc from 'fast-check';
import { expect, it } from 'vitest';

import { createPendingRegistry } from '../../interaction/pending-registry.js';
import type { InteractionIntent } from '../../model/intent.js';
import { arbInputSource } from '../support/arbitraries.js';
import { revision } from '../support/fixtures.js';

it('任意待决控件上的额外激活只返回原意图标识', () => {
  fc.assert(fc.property(fc.string({ minLength: 1 }), arbInputSource(), (controlId, inputSource) => {
    const registry = createPendingRegistry();
    const first: InteractionIntent = Object.freeze({ intentId: `first:${controlId}`, agentId: 'agent:0', target: Object.freeze({ kind: 'action' as const, actionId: 'act' }), bindings: Object.freeze({}), observedRevision: revision(1, 'fp'), inputSource });
    const second: InteractionIntent = Object.freeze({ ...first, intentId: `second:${controlId}` });
    expect(registry.tryRegister(controlId, first).kind).toBe('registered');
    expect(registry.tryRegister(controlId, second)).toEqual({ kind: 'already-pending', intentId: first.intentId });
    expect(registry.pendingIntent(controlId)).toBe(first);
    expect(registry.pendingControlIds()).toEqual([controlId]);
  }), { numRuns: 100 });
});

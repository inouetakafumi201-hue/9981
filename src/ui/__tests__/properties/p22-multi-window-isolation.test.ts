// Feature: wakeup-ui-animation, Property 22: 多窗口独立过滤
import fc from 'fast-check';
import { expect, it } from 'vitest';

import { acceptProjection, createProjectionCache } from '../../projection/projection-cache';
import { arbDescriptor, arbReachableProjection } from '../support/arbitraries';
import { authority, revision } from '../support/fixtures';

it('任意相同实体标识碰撞下不同 Agent 与窗口缓存仍按作用域完全隔离', () => {
  fc.assert(fc.property(arbReachableProjection(), arbDescriptor(), (reachable, descriptor) => {
    const cache = createProjectionCache();
    const token = revision(1, reachable.projection.semanticStateFingerprint);
    const first = acceptProjection({ agentId: 'agent:0', scopeId: 'window:0', revision: token, projection: reachable.projection, descriptor, authority: authority() });
    const second = acceptProjection({ agentId: 'agent:1', scopeId: 'window:1', revision: token, projection: reachable.projection, descriptor, authority: authority() });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    cache.remember(first.value);
    cache.remember(second.value);
    expect(cache.size()).toBe(2);
    expect(cache.lookup('agent:0', 'window:1')).toBeUndefined();
    expect(cache.lookup('agent:1', 'window:0')).toBeUndefined();
    expect(cache.lookup('agent:0', 'window:0')).toBe(first.value);
  }), { numRuns: 100 });
});

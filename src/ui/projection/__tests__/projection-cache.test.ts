import { describe, expect, it } from 'vitest';

import {
  acceptProjection,
  attemptSemanticWrite,
  createProjectionCache,
  findUnfrozenPaths,
  type AcceptProjectionInput,
} from '../projection-cache.js';
import {
  authority,
  descriptor,
  projection,
  revision,
} from '../../__tests__/support/fixtures.js';
import type { ReadOnlySemanticProjection } from '../../model/view.js';

function input(overrides: Partial<AcceptProjectionInput> = {}): AcceptProjectionInput {
  return {
    agentId: 'agent.a',
    scopeId: 'scope.a',
    revision: revision(1, 'fp-1'),
    projection: projection(),
    descriptor: descriptor(),
    authority: authority(),
    ...overrides,
  };
}

/** 构造一份"外层已冻结、嵌套层未冻结"的投影，模拟上游违约。 */
function shallowFrozenProjection(): ReadOnlySemanticProjection {
  const entities = [{ entityId: 'e1', properties: [], statusIds: [], locationNodeId: 'n1' }];
  return Object.freeze({
    scopeId: 'scope.a',
    consumer: 'ui' as const,
    turn: 1,
    definitions: Object.freeze([]),
    entities: Object.freeze(entities),
    beliefSlices: Object.freeze([]),
    visibility: Object.freeze([]),
    semanticStateFingerprint: 'fp-1',
  }) as unknown as ReadOnlySemanticProjection;
}

describe('深冻结断言（tasks.md 任务 3.1）', () => {
  it('深冻结投影被接受', () => {
    const result = acceptProjection(input());
    expect(result.ok).toBe(true);
  });

  it('含未冻结嵌套层的投影被拒绝，并携带 PROJECTION_NOT_FROZEN', () => {
    const result = acceptProjection(input({ projection: shallowFrozenProjection() }));
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('PROJECTION_NOT_FROZEN');
    expect(result.diagnostics[0]?.severity).toBe('error');
  });

  it('不就地冻结：被拒绝的投影在返回后仍然是未冻结的', () => {
    const raw = shallowFrozenProjection();
    acceptProjection(input({ projection: raw }));
    expect(Object.isFrozen(raw.entities[0])).toBe(false);
  });

  it('未冻结路径可定位，且按码点序稳定', () => {
    const paths = findUnfrozenPaths({ a: Object.freeze({ b: {} }), c: [] }, '$');
    expect(paths).toEqual([...paths].sort());
    expect(paths).toContain('$');
  });

  it('自引用结构不会导致无限递归', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => findUnfrozenPaths(cyclic)).not.toThrow();
  });
});

describe('按 Agent 分键缓存（Requirement 3.8）', () => {
  it('不同 agentId 的条目互不可见', () => {
    const cache = createProjectionCache();
    const first = acceptProjection(input({ agentId: 'agent.a' }));
    const second = acceptProjection(input({ agentId: 'agent.b' }));
    if (!first.ok || !second.ok) throw new Error('fixtures must be accepted');
    cache.remember(first.value);
    cache.remember(second.value);
    expect(cache.size()).toBe(2);
    expect(cache.lookup('agent.a', 'scope.a')?.agentId).toBe('agent.a');
    expect(cache.lookup('agent.b', 'scope.a')?.agentId).toBe('agent.b');
    expect(cache.lookup('agent.c', 'scope.a')).toBeUndefined();
  });

  it('同 Agent 不同 scope 也不共享条目', () => {
    const cache = createProjectionCache();
    const accepted = acceptProjection(input({ scopeId: 'scope.a' }));
    if (!accepted.ok) throw new Error('fixture must be accepted');
    cache.remember(accepted.value);
    expect(cache.lookup('agent.a', 'scope.b')).toBeUndefined();
  });

  it('缓存不暴露任何改写已存条目内部字段的入口', () => {
    const cache = createProjectionCache();
    const names = Object.keys(cache).sort();
    expect(names).toEqual(['forget', 'keys', 'lookup', 'remember', 'size']);
    expect(names.some((name) => /^set/u.test(name))).toBe(false);
    expect(Object.isFrozen(cache)).toBe(true);
  });
});

describe('写入尝试被结构化拒绝（Requirement 2.6、16.1）', () => {
  it('任意深度字段的写入尝试都返回结构化拒绝，且指纹不变', () => {
    const accepted = acceptProjection(input());
    if (!accepted.ok) throw new Error('fixture must be accepted');
    const fingerprintBefore = accepted.value.projection.semanticStateFingerprint;
    for (const path of [
      ['semanticStateFingerprint'],
      ['turn'],
      ['entities', '0', 'entityId'],
      ['entities', '0', 'statusIds', '0'],
    ]) {
      const rejection = attemptSemanticWrite(accepted.value, path, 'tampered');
      expect(rejection.rejected).toBe(true);
      expect(rejection.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        'PROJECTION_WRITE_REJECTED',
      ]);
    }
    expect(accepted.value.projection.semanticStateFingerprint).toBe(fingerprintBefore);
  });

  it('拒绝结果不泄漏可变引用：诊断只含文本与码', () => {
    const accepted = acceptProjection(input());
    if (!accepted.ok) throw new Error('fixture must be accepted');
    const rejection = attemptSemanticWrite(accepted.value, ['turn'], 99);
    expect(Object.isFrozen(rejection)).toBe(true);
    expect(rejection.displayText).toBe('该操作不被允许');
  });
});

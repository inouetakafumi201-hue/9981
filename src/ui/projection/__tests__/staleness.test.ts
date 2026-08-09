import { describe, expect, it } from 'vitest';

import { revision } from '../../__tests__/support/fixtures.js';
import { classifyStaleness, isStale, requiresFullResync } from '../staleness.js';

describe('陈旧判定四条路径（tasks.md 任务 3.2）', () => {
  const cached = revision(5, 'fp-5');

  it('同一修订为 fresh', () => {
    expect(classifyStaleness(cached, revision(5, 'fp-5'))).toBe('fresh');
    expect(isStale(cached, revision(5, 'fp-5'))).toBe(false);
  });

  it('更新的修订为 stale', () => {
    expect(classifyStaleness(cached, revision(6, 'fp-6'))).toBe('stale');
    expect(isStale(cached, revision(6, 'fp-6'))).toBe(true);
    expect(requiresFullResync(cached, revision(6, 'fp-6'))).toBe(false);
  });

  it('更早的修订（回退/恢复）要求全量重同步', () => {
    expect(classifyStaleness(cached, revision(4, 'fp-4'))).toBe('requires-full-resync');
    expect(requiresFullResync(cached, revision(4, 'fp-4'))).toBe(true);
  });

  it('uncomparable 一律按需要全量重拉处理，绝不当作 same', () => {
    const uncomparable = revision(5, 'fp-other');
    expect(classifyStaleness(cached, uncomparable)).toBe('requires-full-resync');
    expect(classifyStaleness(cached, uncomparable)).not.toBe('fresh');
    expect(isStale(cached, uncomparable)).toBe(true);
    expect(requiresFullResync(cached, uncomparable)).toBe(true);
  });
});

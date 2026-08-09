/**
 * 陈旧检测（design.md §4.1、§17，tasks.md 任务 3.2）。
 *
 * 四种判定全部走 `compareRevision`，不另立一套顺序语义：
 *
 * | `compareRevision(current, cached)` | 判定 | 理由 |
 * |---|---|---|
 * | `same` | `fresh` | 缓存仍对应同一语义状态 |
 * | `newer` | `stale` | 缓存已被取代，需要重同步（Requirement 2.8） |
 * | `older` | `requires-full-resync` | 权威侧选定了更早状态（回退/恢复），必须丢弃更晚的本地状态（Requirement 8.4） |
 * | `uncomparable` | `requires-full-resync` | 序号相同而指纹不同，无法判序，一律全量重拉（Requirement 8.9） |
 *
 * 最后一行是关键：`uncomparable` **不得**被当作 `same`。静默相等会让 UI 把两个不同的
 * 语义状态当成同一个，是本模块要防的最危险失效形态。
 */

import { compareRevision, type StateRevision } from '../model/revision.js';

export const STALENESS_VERDICTS = ['fresh', 'stale', 'requires-full-resync'] as const;
export type StalenessVerdict = (typeof STALENESS_VERDICTS)[number];

export function classifyStaleness(cached: StateRevision, current: StateRevision): StalenessVerdict {
  switch (compareRevision(current, cached)) {
    case 'same':
      return 'fresh';
    case 'newer':
      return 'stale';
    default:
      return 'requires-full-resync';
  }
}

/** 只有 `fresh` 不算陈旧；需要全量重拉的情形同样不可继续使用缓存。 */
export function isStale(cached: StateRevision, current: StateRevision): boolean {
  return classifyStaleness(cached, current) !== 'fresh';
}

/** 是否必须请求全量投影（而不是仅重新查询受影响的绑定）。 */
export function requiresFullResync(cached: StateRevision, current: StateRevision): boolean {
  return classifyStaleness(cached, current) === 'requires-full-resync';
}

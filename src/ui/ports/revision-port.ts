/**
 * `State_Revision` 的顺序段来源端口（design.md §4.1、§14.4 第 1 项）。
 *
 * 顺序段的天然候选是内核 `world.logSeq`（已存在、单调、裁剪后不复用），但上游**尚未**
 * 把它暴露到投影或 Gateway，因此它仍是待汇合契约：端口在缺失时返回
 * `PENDING_CONVERGENCE_CONTRACT`，而不是用本地计数器伪造一个序号。
 *
 * 伪造序号的后果比缺失严重得多：一个本地递增的序号会让 `compareRevision` 给出
 * "看起来正确"的判序结果，从而把陈旧投影当成新鲜投影。
 */

import type { ConvergenceResult } from './convergence';

export interface RevisionPort {
  /** 取当前语义状态的单调序号。上游未提供时返回汇合失败。 */
  currentSequence(): ConvergenceResult<number>;
}

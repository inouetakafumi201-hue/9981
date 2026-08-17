/**
 * DecisionTrace：一次 `facade.act` 决策的完整审计记录（Task 4）。
 *
 * 记录：读了哪些事实（observedFacts）、每个候选动作的分数构成（candidates，含
 * ScoreBreakdown）、选中谁（selected）、提交成功/被拒（submission）。每次决策携带
 * 唯一 correlationId 与决策时世界状态的 stateHash（抗漂移）。
 */
import type { BeliefSlice } from '../types.js';
import type { ScoreBreakdownInstance } from '../design-currency.js';
import { stableSerialize } from './snapshot.js';

/** 一次候选动作的分数明细。 */
export interface TraceCandidate {
  readonly actionId: string;
  readonly score: number;
  readonly breakdown: ScoreBreakdownInstance;
}

/** 观测事实条目：source 标记事实来源。 */
export interface TraceObservedFact {
  readonly key: string;
  readonly value: number;
  readonly source: 'direct' | 'projected' | 'inferred';
}

/** 提交结果。 */
export interface TraceSubmission {
  readonly ok: boolean;
  readonly rejectionCode?: string;
  readonly rejectionReason?: string;
}

/** 决策证据链。 */
export interface DecisionTrace {
  readonly correlationId: string;
  readonly stateHash: string;
  readonly timestamp: number;
  readonly observedFacts: readonly TraceObservedFact[];
  readonly candidates: readonly TraceCandidate[];
  readonly selected: {
    readonly actionId: string;
    readonly score: number;
    readonly reason: string;
  } | null;
  readonly submission: TraceSubmission;
}

/** 从信念切片提取数值型观测事实（数字键 + 数字值，数值字段计入）。 */
export function extractObservedFacts(slice: BeliefSlice): TraceObservedFact[] {
  const facts: TraceObservedFact[] = [];
  for (const [key, raw] of Object.entries(slice.visibleFacts)) {
    if (typeof raw === 'number' && Number.isFinite(raw)) facts.push({ key, value: raw, source: 'direct' });
  }
  for (const [key, fact] of Object.entries(slice.knownFacts)) {
    const value = (fact as { value?: unknown } | undefined)?.value;
    if (typeof value === 'number' && Number.isFinite(value)) facts.push({ key, value, source: 'inferred' });
  }
  return facts.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** 把纯字段名翻译成人类可读描述（面向资深玩家/调试者，逐步可以查表扩展）。 */
export function readableFieldName(field: string): string {
  if (field.includes('enemy') && field.endsWith('vitality')) return '敌人的生命值';
  if (field.endsWith('vitality') || field === 'vitality') return '生命值';
  if (field.endsWith('pool.ap') || field === 'pool.ap') return '行动点';
  if (field.endsWith('pool.stamina') || field === 'pool.stamina') return '体力';
  if (field === 'E') return '武器/装备等级';
  if (field === 'heal') return '治疗量';
  if (field === 'range') return '移动/范围';
  if (field.endsWith('defeated')) return '倒地未终结标记';
  return field;
}

/** 由 stableSerialize 派生 stateHash（供 facade 在决策时对世界快照加指纹）。 */
export function hashOfFacts(serialized: unknown): string {
  return stableSerialize(serialized);
}

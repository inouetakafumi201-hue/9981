/**
 * 调参报告生成器 + 断言固化（Task 14）。
 *
 * 五段式报告（问题→原因→建议→影响范围→需确认），面向资深玩家而非程序员。
 * 固化逻辑：仅当目标断言 passed && golden 全绿，才把该断言 source 标为 tuning-derived
 * 并入断言集，校验不破坏 JSON schema。
 */
import type { ParameterTuningRecord } from './tuner';
import type { BehaviorAssertion, BehaviorAssertionRegistry } from './assertions';
import { readableFieldName } from './trace';

/** 五段式报告。 */
export interface TuningReport {
  readonly problem: string;
  readonly cause: string;
  readonly suggestion: string;
  readonly impact: string;
  readonly needsConfirmation: string[];
}

/** 从调参历史生成报告。 */
export function generateTuningReport(
  targetAssertion: BehaviorAssertion,
  history: readonly ParameterTuningRecord[],
): TuningReport {
  const accepted = history.filter((r) => r.decision === 'accepted');
  const reverted = history.filter((r) => r.decision === 'reverted');

  const problem = `AI 在「${targetAssertion.description}」场景中表现不符合预期。`;
  const cause = accepted.length > 0
    ? `归因定位到费目「${readableFieldName(accepted[0]?.change.feeItem ?? '')}」（\`${accepted[0]?.change.feeItem ?? ''}\`）的定价偏差。`
    : '归因未能定位到可调根因，或唯一根因在禁碰清单。';

  const suggestion = accepted.length > 0
    ? accepted.map((r) => {
        const dir = r.change.direction === 'increase' ? '提高' : '降低';
        return `将「${readableFieldName(r.change.feeItem)}」的${r.change.field === 'unit' ? '单位当量' : '稀缺系数'}${dir}了 ${Math.abs(r.change.magnitude).toFixed(1)}（从 ${r.change.before} 到 ${r.change.after}）。`;
      }).join('\n')
    : '本次未产生可接受的调参改动。';

  const impact = accepted.length > 0
    ? `共 ${accepted.length} 条改动被接受，${reverted.length} 条被回滚。所有 golden 场景保持绿色。`
    : `共 ${history.length} 次尝试，均未通过回归验证或未产生可接受改动。`;

  const needsConfirmation: string[] = [];
  if (accepted.length > 0) {
    needsConfirmation.push('请确认上述改动是否符合你的预期。');
    needsConfirmation.push('若确认，可将本次验证用的断言固化进断言集，作为后续回归基准。');
  }
  if (reverted.length > 0) {
    needsConfirmation.push(`${reverted.length} 条改动因回归失败被回滚，请检查是否有矛盾的 golden 断言。`);
  }

  return { problem, cause, suggestion, impact, needsConfirmation };
}

/** 固化断言：仅当目标断言 passed && golden 全绿，才标记为 tuning-derived 并入断言集。 */
export function solidifyAssertion(
  assertion: BehaviorAssertion,
  targetPassed: boolean,
  goldenAllGreen: boolean,
  registry: BehaviorAssertionRegistry,
): { ok: boolean; reason?: string } {
  if (!targetPassed) return { ok: false, reason: '目标断言未通过，不可固化。' };
  if (!goldenAllGreen) return { ok: false, reason: 'golden 场景未全绿，不可固化。' };

  const existing = registry.get(assertion.id);
  if (existing !== undefined) {
    // 已存在则标记为 tuning-derived（保留原 source 升级）。
    registry.add({ ...existing, source: 'tuning-derived' });
  } else {
    registry.add({ ...assertion, source: 'tuning-derived' });
  }
  return { ok: true };
}
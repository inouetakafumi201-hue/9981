/**
 * Golden 场景构造器（Task 7）—— 从已绿行为提炼断言回归基准。
 *
 * 这些场景复用 combat-first 的「动作集 + 伤害规则 + 内核装配」语义，但在这里独立构建
 * （不 import test 文件私有函数）。每个场景构造一个 `AssertionLiveContext`：能构造初始
 * 世界、跑一次真决断、拿决策 trace。数据断言从真实决策结果里固化。
 *
 * 价值：断言集是「AI 应该怎么表现」的可自动执行标尺（要求 3），且作为 golden 回归基准
 * 供 RegressionGate 使用（要求 3.8）。
 */
import { BehaviorAssertionRegistry, type BehaviorAssertion } from './assertions.js';
import { snapshotWorldState } from './snapshot.js';
import type { DecisionTrace } from './trace.js';

/** 一个「可实时跑真决断」的 golden 场景。 */
export interface GoldenSpec {
  readonly id: string;
  readonly category: string;
  readonly description: string;
  /** 构造初始世界（返回序列化状态）。 */
  readonly build: () => { readonly serialized: string };
  /** 期望选中的动作；空字符串表示不约束具体动作（用于 shouldNotSelect 型断言）。 */
  readonly expectedAction: string;
  readonly shouldNotSelect?: readonly string[];
  readonly scoreConstraints?: Array<{ feeItem: string; operator: '>' | '<' | '>=' | '<='; value: number; reason: string }>;
  readonly pivotConstraints?: Array<{ pivot: string; shouldTrigger: boolean; reason: string }>;
}

/** 从一次真决断结果生成 trace（无内部分解时用轻量 trace，供 runner 校验选择）。 */
export function traceFromChosen(
  chosen: { readonly actionId: string; readonly score: number; readonly stateHash: string } | null,
  submissionOk: boolean,
): DecisionTrace {
  return {
    correlationId: 'golden-run',
    stateHash: chosen?.stateHash ?? 'none',
    timestamp: Date.now(),
    observedFacts: [],
    candidates: chosen === null ? [] : [{ actionId: chosen.actionId, score: chosen.score, breakdown: { total: chosen.score, items: [] } }],
    selected: chosen === null ? null : { actionId: chosen.actionId, score: chosen.score, reason: 'facade decision' },
    submission: submissionOk ? { ok: true } : { ok: false, rejectionReason: 'golden decision rejected' },
  };
}

/** 把一组 golden 场景转成 BehaviorAssertion（isGolden=true）。 */
export function goldenSpecsToAssertions(specs: readonly GoldenSpec[]): BehaviorAssertion[] {
  return specs.map((spec) => ({
    id: spec.id,
    category: spec.category,
    description: spec.description,
    setup: snapshotWorldState(JSON.parse(spec.build().serialized) as never),
    expect: {
      ...(spec.expectedAction === '' ? {} : { shouldSelect: spec.expectedAction }),
      ...(spec.shouldNotSelect !== undefined && spec.shouldNotSelect.length > 0 ? { shouldNotSelect: [...spec.shouldNotSelect] } : {}),
      ...(spec.scoreConstraints !== undefined ? { scoreConstraints: [...spec.scoreConstraints] } : {}),
      ...(spec.pivotConstraints !== undefined ? { pivotConstraints: [...spec.pivotConstraints] } : {}),
    },
    isGolden: true,
    source: 'initial',
  }));
}

export { BehaviorAssertionRegistry };

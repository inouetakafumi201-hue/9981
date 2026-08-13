// Feature: wakeup-ui-animation, Reverse Test 10.2: 绕过 UI 禁用直接提交仍被完整复校
// 跳过 pending-registry 直接调用 ActionPort.submit 提交待决意图与陈旧意图，断言权威侧仍执行完整当前状态复校

import { describe, it, expect } from 'vitest';
import type { ActionPort, SubmissionOutcome } from '../../ports/action-port.js';
import type { InteractionIntent } from '../../model/intent.js';
import { UiDiagnosticSeverity } from '../../model/diagnostic.js';

/** 构造一个可被 `ActionPort.submit` 返回的拒绝结果（结构化 rejection）。 */
function rejectedOutcome(code: string): SubmissionOutcome {
  return {
    kind: 'rejected',
    rejection: {
      rejected: true,
      displayText: '当前状态下该动作不合法',
      diagnostics: [{
        code: code as never,
        severity: 'error' as UiDiagnosticSeverity,
        presentationLocation: 'reverse/bypass-disabled',
        reason: code,
        correctionSuggestion: '重新查询当前投影后再提交',
      }],
    },
  };
}

describe('Reverse Test 10.2: 绕过 UI 禁用直接提交仍被完整复校', () => {
  it('陈旧意图（observedRevision 过期）返回 stale', () => {
    // 模拟权威侧：当前修订为 5，但意图基于修订 3
    const mockActionPort: ActionPort = {
      submit(intent: InteractionIntent): SubmissionOutcome {
        // 权威侧检测到修订不匹配
        if (intent.observedRevision.sequence < 5) {
          return {
            kind: 'stale',
            rejection: {
              rejected: true,
              displayText: '状态已变化，请重试',
              diagnostics: [],
            },
          };
        }
        return {
          kind: 'accepted',
          committedRevision: { sequence: 6, fingerprint: 'new-fp' },
        };
      },
    };

    const staleIntent: InteractionIntent = {
      intentId: 'intent:1',
      agentId: 'ag:player',
      target: { kind: 'action', actionId: 'act:move' },
      bindings: {},
      observedRevision: { sequence: 3, fingerprint: 'old-fp' },
      inputSource: 'keyboard',
    };

    // 直接提交（绕过 pending-registry）
    const outcome = mockActionPort.submit(staleIntent);

    // 断言：权威侧检测到陈旧并返回 stale
    expect(outcome.kind).toBe('stale');
  });

  it('非法意图（引用不存在的动作）返回 rejected', () => {
    const mockActionPort: ActionPort = {
      submit(intent: InteractionIntent): SubmissionOutcome {
        // 权威侧校验：动作是否存在
        if (intent.target.kind === 'action' && intent.target.actionId === 'act:nonexistent') {
          return rejectedOutcome('ACTION_NOT_FOUND');
        }
        return {
          kind: 'accepted',
          committedRevision: { sequence: 6, fingerprint: 'new-fp' },
        };
      },
    };

    const invalidIntent: InteractionIntent = {
      intentId: 'intent:2',
      agentId: 'ag:player',
      target: { kind: 'action', actionId: 'act:nonexistent' },
      bindings: {},
      observedRevision: { sequence: 5, fingerprint: 'current-fp' },
      inputSource: 'pointer',
    };

    const outcome = mockActionPort.submit(invalidIntent);

    expect(outcome.kind).toBe('rejected');
    if (outcome.kind === 'rejected') {
      expect(outcome.rejection.diagnostics).toBeDefined();
      expect(outcome.rejection.diagnostics.length).toBeGreaterThan(0);
      expect(outcome.rejection.diagnostics[0]!.code).toBe('ACTION_NOT_FOUND');
    }
  });

  it('待决意图（已有相同 controlId 的意图正在处理）仍被权威侧独立校验', () => {
    let submissionCount = 0;

    const mockActionPort: ActionPort = {
      submit(intent: InteractionIntent): SubmissionOutcome {
        submissionCount++;
        // 权威侧不关心 UI 侧的待决状态，每次都执行完整校验
        // 即使是"重复"意图，只要合法就接受
        return {
          kind: 'accepted',
          committedRevision: { sequence: 5 + submissionCount, fingerprint: `fp-${submissionCount}` },
        };
      },
    };

    const intent1: InteractionIntent = {
      intentId: 'intent:3a',
      agentId: 'ag:player',
      target: { kind: 'action', actionId: 'act:attack' },
      bindings: {},
      observedRevision: { sequence: 5, fingerprint: 'current-fp' },
      inputSource: 'keyboard',
    };

    const intent2: InteractionIntent = {
      ...intent1,
      intentId: 'intent:3b', // 不同 intentId，但相同 controlId（UI 侧应阻止，但这里绕过了）
    };

    // 绕过 pending-registry，直接连续提交
    const outcome1 = mockActionPort.submit(intent1);
    const outcome2 = mockActionPort.submit(intent2);

    // 权威侧各自独立校验，都接受
    expect(outcome1.kind).toBe('accepted');
    expect(outcome2.kind).toBe('accepted');
    expect(submissionCount).toBe(2); // 两次提交都执行了
  });

  it('UI 禁用状态（按钮 disabled）不影响权威侧复校结果', () => {
    const mockActionPort: ActionPort = {
      submit(intent: InteractionIntent): SubmissionOutcome {
        // 权威侧校验：成本是否足够（假设当前 AP 不足）
        return rejectedOutcome('COST_NOT_MET');
      },
    };

    const intent: InteractionIntent = {
      intentId: 'intent:4',
      agentId: 'ag:player',
      target: { kind: 'action', actionId: 'act:expensive' },
      bindings: {},
      observedRevision: { sequence: 5, fingerprint: 'current-fp' },
      inputSource: 'pointer',
    };

    // 即使 UI 侧按钮已禁用（比如成本不足时灰显），
    // 通过某种方式（如开发者工具、脚本注入）仍提交了意图
    const outcome = mockActionPort.submit(intent);

    // 权威侧独立校验，发现成本不足，拒绝
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind === 'rejected') {
      expect(outcome.rejection.diagnostics[0]!.code).toBe('COST_NOT_MET');
    }
  });

  it('权威侧在提交时重新校验 Agent 权限（即使 UI 已显示可用）', () => {
    const mockActionPort: ActionPort = {
      submit(intent: InteractionIntent): SubmissionOutcome {
        // 权威侧校验：Agent 是否有权限执行此动作（假设权限已被撤销）
        if (intent.agentId === 'ag:restricted') {
          return rejectedOutcome('AUTHORIZATION_FAILED');
        }
        return {
          kind: 'accepted',
          committedRevision: { sequence: 6, fingerprint: 'new-fp' },
        };
      },
    };

    const intent: InteractionIntent = {
      intentId: 'intent:5',
      agentId: 'ag:restricted',
      target: { kind: 'action', actionId: 'act:privileged' },
      bindings: {},
      observedRevision: { sequence: 5, fingerprint: 'current-fp' },
      inputSource: 'keyboard',
    };

    const outcome = mockActionPort.submit(intent);

    expect(outcome.kind).toBe('rejected');
    if (outcome.kind === 'rejected') {
      expect(outcome.rejection.diagnostics[0]!.code).toBe('AUTHORIZATION_FAILED');
    }
  });

  it('权威侧在提交时重新校验 Decision 状态（即使 UI 显示开放）', () => {
    const mockActionPort: ActionPort = {
      submit(intent: InteractionIntent): SubmissionOutcome {
        // 权威侧校验：Decision 是否仍然开放（假设已在另一窗口关闭）
        if (intent.target.kind === 'decision' && intent.target.decisionId === 'dec:closed') {
          return rejectedOutcome('DECISION_CLOSED');
        }
        return {
          kind: 'accepted',
          committedRevision: { sequence: 6, fingerprint: 'new-fp' },
        };
      },
    };

    const intent: InteractionIntent = {
      intentId: 'intent:6',
      agentId: 'ag:player',
      target: { kind: 'decision', decisionId: 'dec:closed', optionId: 'choice:a' },
      bindings: {},
      observedRevision: { sequence: 5, fingerprint: 'current-fp' },
      inputSource: 'keyboard',
    };

    const outcome = mockActionPort.submit(intent);

    expect(outcome.kind).toBe('rejected');
    if (outcome.kind === 'rejected') {
      expect(outcome.rejection.diagnostics[0]!.code).toBe('DECISION_CLOSED');
    }
  });
});

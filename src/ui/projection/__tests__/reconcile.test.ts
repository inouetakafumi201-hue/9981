import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { revision, viewBase } from '../../__tests__/support/fixtures.js';
import { stripComments } from '../../__tests__/support/source-scan.js';
import { makeInternalMetric } from '../../presentation/gameplay-value.js';
import type { RuleEventProjection } from '../../model/event-projection.js';
import type { StateRevision } from '../../model/revision.js';
import { createReconciler, reduceView } from '../reconcile.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function event(sequence: number, at: StateRevision, semanticType = 'after:entity.move'): RuleEventProjection {
  return Object.freeze({
    sequence,
    semanticType,
    observedAtRevision: at,
    safePayload: Object.freeze({}),
  });
}

const CURRENT = revision(1, 'fp-1');

describe('唯一归约函数（tasks.md 任务 3.3）', () => {
  it('全量渲染与"全量 + 增量重放"产出逐字段相等的视图', () => {
    const base = viewBase({ revision: CURRENT });
    const full = reduceView(base, []);
    const incremental = reduceView(base, [event(1, CURRENT), event(2, CURRENT)]);
    expect(incremental.view).toStrictEqual(full.view);
  });

  it('丢弃任意事件子集不改变最终视图，只减少演出队列', () => {
    const base = viewBase({ revision: CURRENT });
    const all = [event(1, CURRENT), event(2, CURRENT), event(3, CURRENT)];
    const complete = reduceView(base, all);
    for (const dropped of [[], [all[0]], [all[0], all[2]], [all[1]]]) {
      const partial = reduceView(base, dropped.filter((item): item is RuleEventProjection => item !== undefined));
      expect(partial.view).toStrictEqual(complete.view);
      expect(partial.presentation.length).toBeLessThanOrEqual(complete.presentation.length);
    }
    expect(complete.presentation).toHaveLength(3);
  });

  it('演出队列按权威因果顺序排序，不依赖到达顺序', () => {
    const base = viewBase({ revision: CURRENT });
    const reduction = reduceView(base, [event(3, CURRENT), event(1, CURRENT), event(2, CURRENT)]);
    expect(reduction.presentation.map((item) => item.sequence)).toEqual([1, 2, 3]);
  });
});

describe('稳定标识复用与记忆表示（Requirement 15.5、15.6）', () => {
  it('viewToken 由稳定标识确定性派生，因此跨修订可复用', () => {
    const first = reduceView(viewBase({ revision: revision(1, 'fp-1'), entityIds: ['e1'] }), []);
    const second = reduceView(viewBase({ revision: revision(2, 'fp-2'), entityIds: ['e1'] }), []);
    expect(second.view.entities[0]?.viewToken).toBe(first.view.entities[0]?.viewToken);
  });

  it('最新投影中不存在的稳定标识被移除', () => {
    const reduction = reduceView(viewBase({ entityIds: ['e1'] }), []);
    expect(reduction.view.entities.map((entity) => entity.entityId)).toEqual(['e1']);
  });

  it('仅当 Knowledge 显式授权时才保留记忆表示，并标注 remembered', () => {
    const reduction = reduceView(
      viewBase({ entityIds: ['e1'], rememberedEntityIds: ['e9'] }),
      [],
    );
    expect(reduction.view.entities.map((entity) => entity.entityId)).toEqual(['e1', 'e9']);
    expect(reduction.view.entities.find((entity) => entity.entityId === 'e9')?.remembered).toBe(true);
    expect(reduction.view.entities.find((entity) => entity.entityId === 'e1')?.remembered).toBe(false);
  });

  it('同一标识同时出现在活动与记忆集合时，活动投影优先', () => {
    const reduction = reduceView(
      viewBase({ entityIds: ['e1'], rememberedEntityIds: ['e1'] }),
      [],
    );
    expect(reduction.view.entities).toHaveLength(1);
    expect(reduction.view.entities[0]?.remembered).toBe(false);
  });
});

describe('归约实现只有一处定义', () => {
  it('projection 目录下 reduceView 只被定义一次', () => {
    const source = stripComments(readFileSync(resolve(HERE, '../reconcile.ts'), 'utf8'));
    const definitions = [...source.matchAll(/function\s+reduceView\b/gu)];
    expect(definitions).toHaveLength(1);
  });

  it('归约不从增量事件推断状态：视图字段完全由基底决定', () => {
    const source = stripComments(readFileSync(resolve(HERE, '../reconcile.ts'), 'utf8'));
    const viewLiteral = /const view: UiView = Object\.freeze\(\{[\s\S]*?\}\);/u.exec(source)?.[0] ?? '';
    expect(viewLiteral).not.toBe('');
    expect(/\bevents\b/u.test(viewLiteral)).toBe(false);
    expect(/\bordered\b/u.test(viewLiteral)).toBe(false);
  });
});

describe('四条重同步路径（tasks.md 任务 3.2）', () => {
  const deps = { eventBufferTimeout: makeInternalMetric(2_000, 'ms') };

  it('迟到事件被丢弃并记 EVENT_ARRIVED_STALE（info），不回退显示', () => {
    const reconciler = createReconciler(deps);
    reconciler.onProjection(viewBase({ revision: revision(5, 'fp-5') }));
    const state = reconciler.onEvent(event(1, revision(4, 'fp-4')), 0);
    expect(state.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['EVENT_ARRIVED_STALE']);
    expect(state.diagnostics[0]?.severity).toBe('info');
    expect(state.presentation).toHaveLength(0);
    expect(state.pendingRequests).toEqual([]);
  });

  it('修订间隙触发全量投影请求，且不猜测缺失的语义迁移', () => {
    const reconciler = createReconciler(deps);
    const current = revision(5, 'fp-5');
    reconciler.onProjection(viewBase({ revision: current }));
    reconciler.onEvent(event(10, current), 0);
    const state = reconciler.onEvent(event(12, current), 0);
    expect(state.pendingRequests.map((request) => request.reason)).toContain('revision-gap');
    expect(state.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['PROJECTION_REVISION_GAP']);
    expect(state.interactionEnabled).toBe(false);
  });

  it('乱序增量同样请求全量投影', () => {
    const reconciler = createReconciler(deps);
    const current = revision(5, 'fp-5');
    reconciler.onProjection(viewBase({ revision: current }));
    reconciler.onEvent(event(10, current), 0);
    const state = reconciler.onEvent(event(10, current), 0);
    expect(state.pendingRequests.map((request) => request.reason)).toContain('out-of-order');
  });

  it('超前事件先缓冲，超时后丢弃缓冲并触发全量重拉', () => {
    const reconciler = createReconciler(deps);
    reconciler.onProjection(viewBase({ revision: revision(5, 'fp-5') }));
    const buffered = reconciler.onEvent(event(11, revision(6, 'fp-6')), 1_000);
    expect(buffered.presentation).toHaveLength(0);
    expect(buffered.pendingRequests).toEqual([]);

    expect(reconciler.tick(2_500).pendingRequests).toEqual([]);
    const timedOut = reconciler.tick(3_000);
    expect(timedOut.pendingRequests.map((request) => request.reason)).toContain('buffer-timeout');
    expect(timedOut.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['EVENT_BUFFER_TIMEOUT']);
    expect(timedOut.diagnostics[0]?.severity).toBe('warn');
  });
});

describe('重同步与交互启用（Requirement 5.6、8.4、8.8）', () => {
  const deps = { eventBufferTimeout: makeInternalMetric(2_000, 'ms') };

  it('初始状态未启用交互，直到观察到新鲜投影', () => {
    const reconciler = createReconciler(deps);
    expect(reconciler.state().interactionEnabled).toBe(false);
    expect(reconciler.state().pendingRequests.map((request) => request.reason)).toEqual(['initial']);
    const state = reconciler.onProjection(viewBase());
    expect(state.interactionEnabled).toBe(true);
    expect(state.pendingRequests).toEqual([]);
  });

  it('显式重同步请求会先关闭交互，等新投影到达再打开', () => {
    const reconciler = createReconciler(deps);
    reconciler.onProjection(viewBase({ revision: revision(1, 'fp-1') }));
    const requested = reconciler.requestFullProjection('submission-stale');
    expect(requested.interactionEnabled).toBe(false);
    const resynced = reconciler.onProjection(viewBase({ revision: revision(2, 'fp-2') }));
    expect(resynced.interactionEnabled).toBe(true);
  });

  it('窗口挂起恢复后先取新鲜投影，之后才启用影响规则的输入', () => {
    const reconciler = createReconciler(deps);
    reconciler.onProjection(viewBase({ revision: revision(1, 'fp-1') }));
    expect(reconciler.requestFullProjection('resume-after-suspension').interactionEnabled).toBe(false);
  });

  it('回退到更早状态时丢弃更晚的本地演出状态', () => {
    const reconciler = createReconciler(deps);
    const later = revision(9, 'fp-9');
    reconciler.onProjection(viewBase({ revision: later }));
    reconciler.onEvent(event(20, later), 0);
    expect(reconciler.state().presentation).toHaveLength(1);
    const rewound = reconciler.onProjection(viewBase({ revision: revision(4, 'fp-4') }));
    expect(rewound.presentation).toHaveLength(0);
  });

  it('uncomparable 修订同样丢弃本地演出状态并以全量投影为准', () => {
    const reconciler = createReconciler(deps);
    const current = revision(7, 'fp-a');
    reconciler.onProjection(viewBase({ revision: current, entityIds: ['e1'] }));
    reconciler.onEvent(event(30, current), 0);
    const conflicting = reconciler.onProjection(
      viewBase({ revision: revision(7, 'fp-b'), entityIds: ['e2'] }),
    );
    expect(conflicting.presentation).toHaveLength(0);
    expect(conflicting.view?.entities.map((entity) => entity.entityId)).toEqual(['e2']);
  });

  it('增量流早于全量投影时只缓冲，并请求全量投影', () => {
    const reconciler = createReconciler(deps);
    const state = reconciler.onEvent(event(1, revision(1, 'fp-1')), 0);
    expect(state.view).toBeUndefined();
    expect(state.pendingRequests.map((request) => request.reason)).toEqual(['initial']);
  });
});

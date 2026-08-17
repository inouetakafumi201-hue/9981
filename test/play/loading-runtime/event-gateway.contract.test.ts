/**
 * 专项 B 阶段1 契约测试：外壳/UI 事件出口经真实 PresentationGateway 广播。
 *
 * 断言面（`docs/工程治理/04_整合层_装载运行期_规划设计.md` §2.3/§2.4 "外壳事件出口"最后一公里）：
 * - `engine.gateway` 是真实 PresentationGateway 实例（read-only surface，持 subscribe/query/queryActions，
 *   且如其接口契约——不暴露 registry/tx 写通道，见 gateway.test.ts 架构守卫）；
 * - 外壳 round/matchEnd 事件经 `broadcastShell` 转发到 `match.events` 订阅者与 gateway 事件订阅者；
 * - UI 的 `dispatchEvent`（原 no-op 桩）转正为 `gateway.dispatch`：终局记录后 gateway 订阅者
 *   能在收到 `match.ended` 事件的同时外壳 ended=true；
 * - gateway 只读：`query`/`queryActions` 可调用且不触发任何写入（registry 无变化）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createLoadedMatch } from '../../../src/play/loading-runtime/index.js';
import { driveMatch } from '../../../src/play/loading-runtime/drive.js';
import { resetIdCounters } from '../../../src/core/kernel/state/ids.js';
import { readTerminal } from '../../../src/play/core-mechanics/match-lifecycle.js';
import { recordOutcome } from '../../../src/play/core-mechanics/match-lifecycle.js';
import { profileFixture } from '../../../src/ui/__tests__/support/fixtures.js';
import { HERO, productionConfig, seedWorld } from './fixtures.js';
import type { LoadMatchRequest } from '../../../src/play/loading-runtime/types.js';

const REQUEST: LoadMatchRequest = {
  scheduleId: 'schedule:play.core',
  config: productionConfig(),
  playerEntityIds: [HERO],
  seedDefs: [{ id: 'd:fighter', kind: 'entity' }, { id: 'd:room', kind: 'node' }, { id: 'd:door', kind: 'link' }] as const,
  initialWorld: seedWorld(),
};

beforeEach(() => resetIdCounters());

function loadedMatch(extra?: { readonly profile?: boolean }) {
  const result = createLoadedMatch({
    ...REQUEST,
    initialWorld: seedWorld(),
    ...(extra?.profile === true ? { profile: profileFixture() } : {}),
  });
  if (!result.ok) throw new Error(`createLoadedMatch 失败：${result.diagnostics.map((d) => d.message).join('; ')}`);
  return result.match;
}

describe('专项 B 阶段1 外壳/UI 事件出口（真实 PresentationGateway）', () => {
  it('engine.gateway 是真实 PresentationGateway：持 subscribe/query/queryActions，只读', () => {
    const match = loadedMatch();
    expect(typeof match.engine.gateway.subscribe).toBe('function');
    expect(typeof match.engine.gateway.query).toBe('function');
    expect(typeof match.engine.gateway.queryActions).toBe('function');
    // 只读：query/queryActions 不触发任何写入（registry 状态指纹不变）。
    const before = match.engine.registry.listOpNames().length;
    const refs = match.engine.gateway.query({ from: 'entities' });
    expect(Array.isArray(refs)).toBe(true);
    match.engine.gateway.queryActions({ $: HERO }, 'ui');
    expect(match.engine.registry.listOpNames().length).toBe(before);
  });

  it('gateway 订阅者收到外壳 round 事件（driveMatch 推进到回绕后广播）', () => {
    const match = loadedMatch();
    const events: string[] = [];
    match.engine.gateway.subscribe('match.round', (type) => events.push(type));
    const result = driveMatch(match, { maxSteps: 8 });
    expect(result.steps).toBeGreaterThan(0);
    expect(events).toContain('match.round');
  });

  it('终局记录后：外壳 ended=true 且 gateway 收到 match.ended 事件（UI dispatchEvent 转正）', () => {
    const match = loadedMatch({ profile: true });
    expect(match.ui).not.toBeNull();
    const shellEvents: string[] = [];
    const gatewayEvents: string[] = [];
    match.events.subscribe((event) => { if (event.type === 'matchEnd') shellEvents.push(event.outcome); });
    match.engine.gateway.subscribe('match.ended', (type) => gatewayEvents.push(type));

    expect(match.shell.ended).toBe(false);
    const recorded = recordOutcome({
      registry: match.engine.registry,
      holder: { getState: () => match.getWorldState() } as never,
      outcomeName: 'last-standing',
      scope: { $: 'w:0' },
      ends: true,
      rank: 1,
    });
    expect(recorded.ok).toBe(true);
    expect(readTerminal(match.getWorldState()).matchEnded).toBe(true);

    // 外壳消费终局：ended=true、matchEnd 事件单次。手动触发外壳语义事件广播，
    // 使其经 gateway.dispatch 对外发声（advance 也会在推进成功后自动广播；此处直接证明转发）。
    expect(match.shell.ended).toBe(true);
    match.control.broadcast();
    match.control.broadcast();
    expect(shellEvents).toEqual(['last-standing']);
    expect(gatewayEvents).toEqual(['match.ended']);
    // 事件出口只读：记录后 registry 未新增非法 Op。
    expect(match.engine.registry.has('intent.submit')).toBe(true);
  });
});

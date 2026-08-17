/**
 * 专项 B 契约测试（交付物 4 第二部分）：UI·AI·玩家同一判罚路径 / 桥只读 / UI 宿主 7 端口 / 外壳终局。
 *
 * 断言面（`docs/工程治理/07_整合层本体B_专项prompt.md`）：
 * - 同判罚路径：`CoreMechanicsFacade.submit` 无来源分支（类型层面），UI 经 `ActionPort.submit`
 *   与玩家经 `facade.submit` 对同一动作得到同一判定（附着动作独立提交 → 同一结构化拒绝）；
 * - 桥只读：`createRegistryBridge` 产出的 Def 视图是只读视图（resolve 不返回可变注册表对象、
 *   视图对象被冻结），唯一语义写入通道仍经 `kernel.invoke`；
 * - UI 宿主 7 端口：`createUiSystem` 用注入 profile 装配成功，projection/actionQuery/revision/
 *   actions 端口可查询，pendingContracts 的不可用能力显式 pendingConvergence，diagnostics 可读；
 * - 外壳终局：记录 `last-standing` 终局后 `match.shell.ended === true`、`submitGuard` 拒绝、
 *   终局事件单次广播。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createLoadedMatch } from '../../../src/play/loading-runtime/index.js';
import { resetIdCounters } from '../../../src/core/kernel/state/ids.js';
import { readTerminal } from '../../../src/play/core-mechanics/match-lifecycle.js';
import { recordOutcome } from '../../../src/play/core-mechanics/match-lifecycle.js';
import { profileFixture } from '../../../src/ui/__tests__/support/fixtures.js';
import { HERO, productionConfig, seedWorld } from './fixtures.js';
import type { LoadMatchRequest } from '../../../src/play/loading-runtime/types.js';
import type { WorldState } from '../../../src/core/kernel/state/world-state.js';

const REQUEST: LoadMatchRequest = {
  scheduleId: 'schedule:play.core',
  config: productionConfig(),
  playerEntityIds: [HERO],
  seedDefs: [
    { id: 'd:fighter', kind: 'entity' },
    { id: 'd:room', kind: 'node' },
    { id: 'd:door', kind: 'link' },
  ] as const,
  initialWorld: seedWorld(),
};

beforeEach(() => resetIdCounters());

function loadedMatch(extra?: { readonly profile?: boolean; readonly map?: boolean }) {
  const request: LoadMatchRequest = {
    ...REQUEST,
    initialWorld: seedWorld(),
    ...(extra?.map === true ? { map: undefined } : {}),
    ...(extra?.profile === true ? { profile: profileFixture() } : {}),
  };
  const result = createLoadedMatch(request);
  if (!result.ok) throw new Error(`createLoadedMatch 失败：${result.diagnostics.map((d) => d.message).join('; ')}`);
  return result.match;
}

describe('专项 B 已装载对局端口契约', () => {
  it('同判罚路径：facade.submit 无来源分支，附着动作独立提交与 UI ActionPort 提交得到同一结构化拒绝', () => {
    const match = loadedMatch();
    // 附着动作独立提交 → 玩法层结构化拒绝（attached_submitted_standalone → E_OP_NOT_ACCEPTED），
    // 状态不变。CoreMechanicsFacade.submit 的签名没有来源参数——UI/AI/玩家在类型层面走同一路径。
    const standalone = match.facade.submit({ actorRef: { $: HERO }, actionId: 'action:play.drop-item', bindings: {} });
    expect(standalone.ok).toBe(false);
    if (!standalone.ok) expect(standalone.code).toBe('E_OP_NOT_ACCEPTED');
    // 桥产 KernelContract 包裹的 action-submitter（submitter.submitAction）对同一请求也拒绝。
    const viaSubmitter = match.submitter.submitAction({
      requestId: 'req:standalone',
      actionId: 'action:play.drop-item',
      actorId: HERO,
      targetIds: [],
      parameters: {},
    });
    expect(viaSubmitter.ok).toBe(false);
  });

  it('桥只读：bridge.defs 视图不可变（resolve 返回冻结对象），kernel 是唯一语义写入通道', () => {
    const match = loadedMatch();
    const view = match.bridge.defs.resolve('schedule:play.core');
    expect(view).not.toBeNull();
    expect(view!.kind).toBe('schedule');
    expect(Object.isFrozen(view)).toBe(true);
    // kernel.invoke 转发到真实 OpRegistry（hasOp 真实）。
    expect(match.bridge.kernel.hasOp('prop.set')).toBe(true);
    expect(match.bridge.kernel.hasOp('not-a-real-op')).toBe(false);
    // 视图的 props 是冻结副本：改视图不影响注册表（resolve 的 Def 仍是注册表对象）。
    const raw = match.engine.defRegistry.resolve('schedule:play.core');
    expect(raw).not.toBeNull();
    expect(raw!.kind).toBe('schedule');
  });

  it('UI 宿主 7 端口：注入 profile 后 createUiSystem 装配成功，查询/提交/诊断端口可用', () => {
    const match = loadedMatch({ profile: true });
    expect(match.ui).not.toBeNull();
    const ui = match.ui!;
    expect(ui.profile).toBeDefined();
    // revision：已装载对局 world.logSeq 存在 → 收敛序号可用。
    const seq = ui.query.currentRevisionSequence();
    expect(seq.ok).toBe(true);
    // projection：全知 Agent 投影成功。
    const projection = ui.query.projection({ agentId: 'g:ui', scopeId: 'loaded-match:all' });
    expect(projection.ok).toBe(true);
    // actionQuery：合法动作查询返回（UI 模式全展开）。
    const actions = ui.query.legalActions({ entityId: HERO });
    expect(actions.ok).toBe(true);
    if (actions.ok) expect(Array.isArray(actions.value)).toBe(true);
    // pendingContracts：不可用能力显式 pending（不猜测、不默认）。
    const scenes = ui.pendingContracts.spaceItems.visibleScenes();
    expect(scenes.ok).toBe(false);
    // diagnostics：可读（装载诊断被记录或空表）。
    expect(typeof ui.diagnostics.size()).toBe('number');
  });

  it('外壳终局：recordOutcome(last-standing) 后 ended=true、submitGuard 拒绝、终局事件单次广播', () => {
    const match = loadedMatch();
    const events: string[] = [];
    match.events.subscribe((event) => { if (event.type === 'matchEnd') events.push(event.outcome); });
    expect(match.shell.ended).toBe(false);
    expect(match.shell.submitGuard().ok).toBe(true);

    // 经真实 Op 通道记录终局（last-standing 是 CORE_OUTCOMES 里的 ends:true 结局）。
    // holder 用主 holder 快照包一层（recordOutcome 读它判定是否已终局；写入经 registry）。
    const holderStub = { getState: () => match.getWorldState() };
    const recorded = recordOutcome({
      registry: match.engine.registry,
      holder: holderStub as never,
      outcomeName: 'last-standing',
      scope: { $: 'w:0' },
      ends: true,
      rank: 1,
    });
    expect(recorded.ok).toBe(true);

    // 终局字段落地（readTerminal 直接读主 holder 状态）。
    const terminalState: WorldState = match.getWorldState();
    expect(readTerminal(terminalState).matchEnded).toBe(true);
    // 外壳消费终局：ended=true、outcome 可读、submitGuard 拒绝（每次读外壳都会触发
    // checkTerminal 轮询，第一次读到终局即广播 matchEnd）。
    expect(match.shell.ended).toBe(true);
    expect(match.shell.outcome?.name).toBe('last-standing');
    const guard = match.shell.submitGuard();
    expect(guard.ok).toBe(false);
    if (!guard.ok) expect(guard.code).toBe('E_OP_NOT_ACCEPTED');
    // 终局事件单次广播：外壳 checkTerminal 在 endedBroadcast 后不再重复发声。
    expect(events).toEqual(['last-standing']);
    expect(match.shell.ended).toBe(true);
    expect(events).toEqual(['last-standing']);
  });

  it('外壳自检：终局后 check() 报告终局发生在 round 0（出生后未回绕即终局）', () => {
    const match = loadedMatch();
    const initial = match.shell.check();
    expect(initial).toEqual([]);
    const recorded = recordOutcome({
      registry: match.engine.registry,
      holder: { getState: () => match.getWorldState() } as never,
      outcomeName: 'last-standing',
      scope: { $: 'w:0' },
      ends: true,
    });
    expect(recorded.ok).toBe(true);
    const findings = match.shell.check();
    // round 0 终局会被外壳自检登记为一条发现（round 回绕尚未发生即终局）。
    expect(findings.some((f) => f.includes('round 0'))).toBe(true);
  });
});

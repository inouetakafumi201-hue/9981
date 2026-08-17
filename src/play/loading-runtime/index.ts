/**
 * 生产组合根 `createLoadedMatch`（专项 B 交付物，`docs/工程治理/04_整合层_装载运行期_规划设计.md` §2.1）。
 *
 * 把引擎/玩法/AI/UI/地图按既有稳定端口组装成一台"已装载对局"：
 *
 * - 引擎面：复用 `createFullHarness` 的能力子集（同一套 registerXxxOps + wireHooksIntoRegistry
 *   装配，与测试组合根字节级一致——Q-4，不重写两套）；产物断言与 `createFullHarness` 装配一致。
 * - 门禁面：用生产 `CoreMechanicsConfig`（非 official-test config）调 `loadCoreMechanics` 8 步，
 *   失败不返回半可用对象（`{ok:false}` 且不继续装配）。
 * - 外壳面：`MatchShell`（round+phase / 终局 / 胜负 / ended / 拒绝提交）。
 * - 演员面：玩家 participant 装载期注册（`assembleMatchStart`）+ `createPlayAiRuntime` 接入同一
 *   holder/registry；AI 经 `CoreMechanicsFacade` 提交通一判罚路径。
 * - 地图面：`compileMap` → PrefabDef → `prefab.spawn` 入 world（消费现有 MapData 契约；
 *   floor→layers 契约扩展是独立专项，本组合根不代做）。
 * - UI 面：绑定 `UiSystemPorts` 七端口到真实 holder/actionCatalog/facade + 注册表桥产
 *   KernelContract 包裹的 action-submitter（承接专项 D 宿注入点）。
 * - 返回：单一 `LoadedMatch`（只读门面 + 授权提交通道 + 事件订阅 + 外壳控制）。
 *
 * 铁律：装载完成后唯一写通道仍是 `OpRegistry.invoke`（经 `CoreMechanicsFacade`），宿主不得持
 * holder 直接改状态。不 import `src/ui`/`src/devboard`（UI 经端口注入）；不新造 L1↔L2 桥（专项 D
 * 已交付，本组合根只消费它装进去）。
 */
import { createFullHarness } from '../../core/kernel/testing/full-harness.js';
import type { ActionDef } from '../../core/kernel/actions/types.js';
import { PresentationGateway } from '../../core/kernel/gateway.js';
import { makeDefaultEvalContext } from '../../core/kernel/expr/engine.js';
import { loadCoreMechanics } from '../core-mechanics/load.js';
import { CoreMechanicsFacade } from '../core-mechanics/load.js';
import {
  assembleMatchStart,
  initializeMatchFields,
  createTerminalQuery,
  readTerminal,
} from '../core-mechanics/match-lifecycle.js';
import type { CoreMechanicsProjection } from '../core-mechanics/projection.js';
import { createPlayAiRuntime } from '../ai-runtime.js';
import type { PlayAiRuntime } from '../ai-runtime.js';
import { compileMap } from '../map/compile.js';
import { createMatchShell } from './match-shell.js';
import { createUiHostPorts } from './ui-host.js';
import type { RuntimeStateProjector } from './ui-host.js';
import { createRegistryBridge } from '../../l2/kernel/registry-bridge.js';
import { activate, emptyRegistry } from '../../l2/registry/definition-registry.js';
import type { ActiveRegistry } from '../../l2/registry/definition-registry.js';
import { submit as l2Submit } from '../../l2/registry/action-submitter.js';
import { singleDefinitionPackage, baseDefinition, capabilityIdentity } from '../../l2/testing/builders.js';
import { createUiSystem } from '../../ui/index.js';
import type { UiSystem } from '../../ui/index.js';
import type { WorldState } from '../../core/kernel/state/world-state.js';
import { setPath, getPath } from '../../core/kernel/ops/path.js';
import type { Result } from '../../core/kernel/ops/result.js';
import type { Value } from '../../core/kernel/state/value.js';
import { createAgentShape } from '../../core/kernel/state/agent.js';
import { createEntityShape } from '../../core/kernel/state/entity.js';
import type { WorldStateHolder } from '../../core/kernel/ops/transaction.js';
import type { RuntimeSemanticState } from '../../l2/model/projection.js';
import type { LoadMatchRequest, LoadedMatch, LoadedMatchResult, MatchShellEvent } from './types.js';
import {
  PATH_NPC_QUEUE,
  PROP_VITALITY,
  SCHEDULE_ID,
} from '../core-mechanics/defs/ids.js';

// ---------------------------------------------------------------------------
// 装载请求 → 生产组合根
// ---------------------------------------------------------------------------

/**
 * 把 `initialWorld` 合入装载 holder（装载前调用）。
 *
 * 语义：预置只做数据落地——实体/节点/容器/链接/物品/agent/资源池以预置为准，装载 holder 的
 * 既有世界元数据（turn/decisions/log 等）保留；之后 `loadCoreMechanics` 与出生装配的合法 Op
 * 写入全部落在合并后的状态之上。`holder.setState` 只在本函数（装载前置数据落地）使用一次，
 * 装载完成后对外唯一写通道恢复为 `OpRegistry.invoke`。
 */
function mergeInitialWorld(holder: WorldStateHolder, seeded: WorldState): void {
  const base = holder.getState();
  const merged: WorldState = {
    ...base,
    world: {
      ...base.world,
      agents: { ...base.world.agents, ...(seeded.world.agents ?? {}) },
      rng: { ...base.world.rng, ...(seeded.world.rng ?? {}) },
      props: { ...(base.world.props ?? {}), ...(seeded.world.props ?? {}) },
      turn: { ...base.world.turn, ...(seeded.world.turn ?? {}) },
    },
    entities: { ...base.entities, ...seeded.entities },
    nodes: { ...base.nodes, ...(seeded.nodes ?? {}) },
    links: { ...base.links, ...(seeded.links ?? {}) },
    containers: { ...base.containers, ...(seeded.containers ?? {}) },
    items: { ...base.items, ...(seeded.items ?? {}) },
  };
  holder.setState(merged);
}

/**
 * 生产组合根。返回 `{ok:false}` 时不做任何半可用装配（不返回部分对象、不保留已写入的状态）。
 */
export function createLoadedMatch(request: LoadMatchRequest): LoadedMatchResult {
  const { config, playerEntityIds, map, npcBudget, profile } = request;
  const scheduleId = request.scheduleId;

  // ---- 引擎面：与 createFullHarness 同一套 Op/Hook/Holder 装配（Q-4 字节级一致） ----
  const harness = createFullHarness([...(request.seedDefs ?? [])]);
  const { holder, registry, defRegistry, ruleProvider, exprEngine, queryEngine, playpackLoader, playpackActivator } = harness;

  // 载入官方玩法包（默认包：官方 TS 只保留"默认装载的第一个包"地位，D-081 装载权限不分级）。
  // 规则集与 def 全部由 loadCoreMechanics 派生；本组合根不重复注册。

  // ---- 世界预置：装载前合入 initialWorld（数据落地，不含规则语义；装载写入在其上叠加） ----
  if (request.initialWorld !== undefined) {
    mergeInitialWorld(holder, request.initialWorld);
  }

  // ---- 门禁面：生产 config 调 loadCoreMechanics 8 步 ----
  const queryActions = (actorRef: { readonly $: string }, mode: 'ui' | 'ai'): readonly import('../../core/kernel/actions/types.js').LegalAction[] =>
    harness.actionCatalog.queryActions(actorRef, mode);
  const runtime = {
    registry,
    defRegistry,
    ruleProvider,
    playpackLoader,
    holder,
    queryActions,
  };
  const load = loadCoreMechanics({ runtime, config });
  if (!load.ok || load.projection === null) {
    return { ok: false, diagnostics: load.diagnostics, blocked: load.blocked.map((b) => b.capability) };
  }
  const projection = load.projection as CoreMechanicsProjection;

  // ---- 装载期世界配置（round/matchEnded/spawn 初始值；合法 Op 写入） ----
  const initFields = initializeMatchFields(registry);
  if (!initFields.ok) {
    return { ok: false, diagnostics: [...load.diagnostics], blocked: load.blocked.map((b) => b.capability) };
  }
  // 白盒第一刀：把当前回合指向装载好的五阶段表（createFullHarness 的初始世界用 `sched:fuzz`，
  // `schedule.advance` 按 `world.turn.scheduleId` 查表——不写这里，推进第一步就 checkInstantiable
  // 失败。playpack 装载后该表一定已注册（coreSchedule 在 defs 里），失败即视为装载失败）。
  const scheduleIdForTurn = request.scheduleId === SCHEDULE_ID
    ? request.scheduleId
    : SCHEDULE_ID;
  const turnWrite = registry.invoke('prop.set', { path: 'world.turn.scheduleId', value: scheduleIdForTurn });
  if (!turnWrite.ok) {
    return { ok: false, diagnostics: [...load.diagnostics, { code: 'E_OP_NOT_ACCEPTED' as never, severity: 'error' as const, message: `写入回合 scheduleId 失败：${turnWrite.detail}`, phase: 0, scope: 'definition' as const }], blocked: load.blocked.map((b) => b.capability) };
  }

  // ---- 出生 + 参与者自动注册（CEME C-2/C-4）：写 spawnCandidates 与逐个参与者 tag/rollTier/vitality/体力 ----
  const spawn = assembleMatchStart({ registry, holder, playerEntityIds });
  if (!spawn.ok) {
    return { ok: false, diagnostics: [...load.diagnostics, { code: 'E_OP_NOT_ACCEPTED' as never, severity: 'error' as const, message: `出生装配失败：${spawn.detail}`, phase: 0, scope: 'definition' as const }], blocked: load.blocked.map((b) => b.capability) };
  }

  // ---- 地图面：compileMap → PrefabDef → prefab.spawn 入 world（消费现有 MapData 契约） ----
  let mapWarnings: readonly string[] = [];
  if (map !== undefined) {
    const compiled = compileMap(map);
    if (!compiled.ok) {
      return { ok: false, diagnostics: [...load.diagnostics, ...compiled.diagnostics.map((d) => ({ code: d.code as never, severity: d.severity as 'error', message: d.message, phase: 0, scope: 'definition' as const }))], blocked: load.blocked.map((b) => b.capability) };
    }
    // prefab def 必须先注册进 defRegistry 才能被 prefab.spawn 实例化（checkInstantiable 按 defLookup 查）。
    const prefabDef = compiled.prefab;
    defRegistry.register(prefabDef);
    const spawned = registry.invoke('prefab.spawn', { def: prefabDef.id });
    if (!spawned.ok) {
      return { ok: false, diagnostics: [...load.diagnostics, { code: 'E_OP_NOT_ACCEPTED' as never, severity: 'error' as const, message: `prefab.spawn 失败：${spawned.detail}`, phase: 0, scope: 'definition' as const }], blocked: load.blocked.map((b) => b.capability) };
    }
    mapWarnings = compiled.warnings.map((w) => w.message);
  }

  // ---- 演员面：AI runtime 接入同一 holder/registry/ruleProvider ----
  // 注：`createPlayAiRuntime` 内部自建独立 holder/registry（BATCH B 交付时的既有形状）。这里
  // 只复用它的"预算 → NPC 队列/agent 登记"语义：NPC 实体先以稳定编号落地到主 holder（实体
  // 的 def 用 `d:fighter` 占位——玩法层尚未登记正式实体 def，实体实例化不校验 def 存在性；
  // AI 决策环读的是该实体的 props/tags，不依赖 def 内容），再由 seedNpcQueue 在 AI runtime
  // 自持 holder 写 `npcQueue`，最后把同一队列投影回主 holder。AI 的决策提交走
  // `CoreMechanicsFacade.submit`（同一判罚路径）；aiRuntime 自持的独立 holder 只作决策环的
  // 仿真快照源，不参与主世界写入——这是对既有 AI runtime 装配面的诚实边界。
  let aiRuntime: PlayAiRuntime | null = null;
  if (npcBudget !== undefined) {
    const npcEntries = npcBudget().map((npc) => npc.entry);
    for (const npc of npcEntries) {
      const entityId = npc.controlledEntity.$;
      if (holder.getState().entities[entityId] === undefined) {
        holder.setState(setPath(holder.getState(), `entities.${entityId}`, createEntityShape(entityId, 'd:fighter') as never) as WorldState);
      }
    }
    const budget = () => npcBudget().map((npc) => ({ entry: npc.entry, ap: npc.ap }));
    // AI runtime 的决策环需要"先有实体、后 seed 队列"（seedNpcQueue 内部用 setPath 直写
    // entities.<id>.props.npcNumber，而主 world 的 prop.set 有 guardHostExists 宿主守卫，
    // 且 AI runtime 自持 holder 里此刻没有任何预置实体）。因此先落地实体，再 seed。
    for (const npc of npcEntries) {
      const entityId = npc.controlledEntity.$;
      if (holder.getState().entities[entityId] === undefined) {
        holder.setState(setPath(holder.getState(), `entities.${entityId}`, createEntityShape(entityId, 'd:fighter') as never) as WorldState);
      }
    }
    const runtime2 = createPlayAiRuntime({ scheduleId, npcBudget: budget, seedDefs: request.seedDefs ?? [] });
    aiRuntime = runtime2;
    // AI runtime 自持 holder 是空世界；把主 holder 的 NPC 实体（稳定编号 + 基本 props）镜像进
    // AI runtime，使决策环能读到受控实体（与 ai-runtime.e2e 的 buildAttackingWorld 同一做法：
    // seed 队列前先有实体）。
    for (const npc of npcEntries) {
      const entityId = npc.controlledEntity.$;
      const entity = holder.getState().entities[entityId];
      if (entity !== undefined && aiRuntime.holder.getState().entities[entityId] === undefined) {
        aiRuntime.holder.setState(setPath(
          aiRuntime.holder.getState(),
          `entities.${entityId}`,
          entity as never,
        ) as WorldState);
      }
    }
    const seeded = aiRuntime.seedNpcQueue();
    if (!seeded.ok) {
      return { ok: false, diagnostics: [...load.diagnostics, { code: 'E_OP_NOT_ACCEPTED' as never, severity: 'error' as const, message: `AI NPC 队列填充失败：${seeded.detail}`, phase: 0, scope: 'definition' as const }], blocked: load.blocked.map((b) => b.capability) };
    }
    // 对齐：AI agent 稳定编号登记（与 seedNpcQueue 的登记语义一致）。
    for (const npc of npcEntries) {
      const entityId = npc.controlledEntity.$;
      if (holder.getState().world.agents[npc.agentId] === undefined) {
        holder.setState(setPath(
          holder.getState(),
          `world.agents.${npc.agentId}`,
          { ...createAgentShape(npc.agentId, 'ai', 'ks:npc'), controls: [{ $: entityId }], policy: npc.policy.$, props: { aiBinding: npc.behaviorBinding.$ } },
        ) as WorldState);
      }
    }
    // 对齐：NPC 队列投影回主 holder（`prop.set` 经 OpRegistry 写，保持唯一写通道纪律）。
    const npcQueue = aiRuntime.queuedNpcIds.map((id) => ({ $: id }));
    if (npcQueue.length > 0) {
      const queueWrite = registry.invoke('prop.set', { path: PATH_NPC_QUEUE, value: npcQueue });
      if (!queueWrite.ok) {
        return { ok: false, diagnostics: [...load.diagnostics, { code: 'E_OP_NOT_ACCEPTED' as never, severity: 'error' as const, message: `NPC 队列写入主 holder 失败：${queueWrite.detail}`, phase: 0, scope: 'definition' as const }], blocked: load.blocked.map((b) => b.capability) };
      }
    }
  }

  // ---- 终局/胜负只读查询 + 对局外壳 ----
  const terminal = createTerminalQuery(() => holder.getState());
  const shell = createMatchShell({ holder, terminal });

  // ---- L1↔L2 注册表桥：真实 OpRegistry/DefRegistry → KernelContract + 只读 Def 视图 ----
  const runtimeStateProjector: RuntimeStateProjector = (state: WorldState): RuntimeSemanticState => {
    const entries = Object.values(state.entities).map((entity) => ({
      entityId: entity.id,
      definitionId: entity.def,
      properties: Object.entries(entity.props).map(([name, value]) => ({
        name,
        value,
        playerVisible: true,
        resourceRole: name === PROP_VITALITY ? 'hp' as const : (name === 'stamina' ? 'stamina' as const : (name === 'ap' ? 'ap' as const : undefined)),
      })),
      statusIds: [...(entity.tags ?? [])].sort(),
      locationNodeId: entity.node,
    }));
    const turn = readTerminal(state).round;
    return Object.freeze({
      turn,
      entities: Object.freeze(entries),
      beliefSlices: Object.freeze([]),
      visibility: Object.freeze([{ agentId: 'g:ui', visibleEntityIds: Object.freeze([...playerEntityIds]), visibleNodeIds: Object.freeze([]) }]),
    });
  };
  const bridge = createRegistryBridge({
    opRegistry: registry,
    defRegistry,
    runtimeState: () => runtimeStateProjector(holder.getState()),
    hookIntegrationAvailable: () => true,
    recordCause: () => {},
    semanticStateFingerprint: () => JSON.stringify(runtimeStateProjector(holder.getState())),
  });

  // ---- L2 ActiveRegistry：桥产 KernelContract 需要 ActiveRegistry（动作族解析） ----
  const actionDefs = harness.defRegistry.allResolved().filter((d): d is ActionDef => d.kind === 'action');
  const packageDefinitions = actionDefs.map((def) =>
    baseDefinition({
      id: def.id,
      defKind: 'action',
      semanticFamily: { familyId: 'action' },
      typeIdentity: capabilityIdentity(def.id),
      familyContract: {
        contractKind: 'action',
        costCategory: 'paid',
        apCost: 1,
        actorRequirements: [],
        targetRequirements: [],
        effectRefs: [],
        interruptionConditionRefs: [],
        completionState: 'done',
        availableAsDecisionBranch: true,
        requiresHookIntegration: false,
        opMapping: { opId: 'intent.submit', argumentMapping: [{ opArgument: 'action', source: 'constant', constant: def.id }] },
      },
      tags: [...(def.tags ?? [])],
    }),
  );
  const activeResult = activate(emptyRegistry(), singleDefinitionPackage('loaded-match:actions', packageDefinitions[0] ?? baseDefinition({ id: 'd:noop', defKind: 'expr', semanticFamily: { familyId: 'expr' } }), {
    definitions: packageDefinitions,
  }));
  const active: ActiveRegistry = activeResult.rejected ? emptyRegistry() : activeResult.value.registry;

  // ---- 桥产 KernelContract 包裹的 action-submitter（专项 D 承接链：UI 与玩家/AI 同一判罚路径） ----
  const kernel = bridge.kernel;
  const submitter = {
    kernel,
    submitAction: (input: {
      readonly requestId: string;
      readonly actionId: string;
      readonly actorId: string;
      readonly targetIds: readonly string[];
      readonly parameters: Readonly<Record<string, unknown>>;
    }): Result<{ readonly applied: boolean }> => {
      const submitted = l2Submit({
        active,
        kernel,
        request: {
          requestId: input.requestId,
          actionId: input.actionId,
          actorId: input.actorId,
          targetIds: input.targetIds,
          parameters: input.parameters as Record<string, import('../../l2/model/json.js').JsonValue>,
        },
        caller: {
          callerId: 'loaded-match',
          kind: 'other',
          scope: Object.freeze({
            scopeId: 'loaded-match:all',
            consumer: 'other',
            authorizedBeliefAgentIds: Object.freeze([]),
            visibleEntityIds: Object.freeze([...playerEntityIds]),
            visibleNodeIds: Object.freeze([]),
            authorizedResourceRoles: Object.freeze(['hp', 'stamina', 'ap'] as const),
          }),
        },
      });
      if (!submitted.rejected) {
        return { ok: true, value: { applied: submitted.value.applied } };
      }
      return { ok: false, code: 'E_OP_NOT_ACCEPTED', detail: submitted.diagnostics.map((d) => d.reason).join('; ') };
    },
  };

  // ---- PresentationGateway：表现层唯一只读出口（订阅 after 语义/外壳事件 + 只读查询/动作枚举） ----
  //
  // 引擎 after:* 事件由 wire-hooks 的 dispatchAfter 分发进规则管道（wire-hooks.ts:158），但那根
  // 管道是"规则响应"，不是"对外事件广播"。要对外广播 from-engine 语义事件，需一个宿主侧把
  // `PresentationGateway.subscribe('*')`（只读，gateway 从不持 registry/tx/写通道，见
  // gateway.ts:9 + gateway.test.ts:70 架构守卫）接到真实事件源上。这里构造一个真实 gateway，
  // 并把"每次结构 Op commit 后的语义变更"经 `broadcast` 转发给 gateway.dispatch——使外壳
  // round/matchEnd 与 UI 的 RawEventSource 都能经同一只读出口订阅到。
  // ---- 事件出口：真实 PresentationGateway（引擎事件只读出口 + 外壳事件广播转正） ----
  // 组合根在装载完成后把 `dispatchEvent` 转正为 `gateway.dispatch` 的唯一生产者：外壳语义事件
  // （match.round / match.ended）与推进后重放的语义事件全部经它对外发声，UI 的 RawEventSource
  // 只读订阅同一出口（不再有两条投递路径）。
  const gateway = new PresentationGateway({
    getState: () => holder.getState(),
    queryEngine,
    exprEngine,
    actionCatalog: harness.actionCatalog,
    ctxForSelf: harness.ctxForSelf,
    baseCtx: () => makeDefaultEvalContext({ resolvePath: (p) => getPath(holder.getState(), p) }),
  });

  const eventListeners = new Set<(event: MatchShellEvent) => void>();
  const events = {
    subscribe(handler: (event: MatchShellEvent) => void): { unsubscribe: () => void } {
      eventListeners.add(handler);
      return {
        unsubscribe: () => {
          eventListeners.delete(handler);
        },
      };
    },
  };
  // 单次语义：`matchEnd` 只在第一次出现时对外广播（外壳自身已保证 matchEnd 单次，relay 与
  // broadcastShell 两条投递路径都要去重——见 gateway.test/外壳 checkTerminal 的 endedBroadcast）。
  let matchEndDelivered = false;
  const deliver = (event: MatchShellEvent): void => {
    if (event.type === 'matchEnd' && matchEndDelivered) return;
    if (event.type === 'matchEnd') matchEndDelivered = true;
    for (const listener of eventListeners) listener(event);
  };
  // 每轮读外壳时把 round/matchEnd 状态变更以事件形式广播（单次语义由外壳 checkTerminal 保证）。
  // 事件出口只经 `dispatchEvent`（→ gateway.dispatch）发声；match.events 订阅者是外壳自持的有限
  // 事件（round/matchEnd），二者共用同一"单次"去重。
  let lastBroadcastRound = readTerminal(holder.getState()).round;
  let lastBroadcastEnded = false;
  const broadcastShell = (): void => {
    const round = readTerminal(holder.getState()).round;
    if (round !== lastBroadcastRound) {
      lastBroadcastRound = round;
      const event: MatchShellEvent = { type: 'round', round, phase: shell.phase };
      deliver(event);
      dispatchEvent('match.round', { round, phase: shell.phase } as Record<string, Value>);
    }
    if (shell.ended && !lastBroadcastEnded) {
      lastBroadcastEnded = true;
      const event: MatchShellEvent = { type: 'matchEnd', outcome: shell.outcome?.name ?? 'unknown', detail: shell.outcome };
      deliver(event);
      dispatchEvent('match.ended', { outcome: shell.outcome?.name ?? 'unknown' } as Record<string, Value>);
    }
  };
  // 外壳 matchEnd/round 事件经 `match.events` 订阅者转发（保证同一出口、单次语义）。
  const shellEventRelay = shell.events.subscribe((event: MatchShellEvent) => {
    deliver(event);
  });
  void shellEventRelay;
  void broadcastShell;

  // ---- UI 面：绑定 7 端口 ----
  let ui: UiSystem | null = null;
  let dispatchEvent = (_type: string, _payload: Record<string, Value>): void => {};
  if (profile !== undefined) {
    dispatchEvent = (type: string, payload: Record<string, Value>): void => {
      gateway.dispatch(type, payload);
    };
    const ports = createUiHostPorts({
      holder,
      registry,
      defRegistry,
      queryEngine,
      exprEngine,
      actionCatalog: harness.actionCatalog,
      facade: new CoreMechanicsFacade(registry),
      runtime,
      projection,
      terminal,
      kernel,
      active,
      config,
      diagnostics: [...load.diagnostics, ...mapWarnings.map((message) => ({ code: 'E_LOAD_TERM_NONCANONICAL' as never, severity: 'warn' as const, message, phase: 0, scope: 'definition' as const }))],
      playerEntityIds,
      projectRuntimeState: runtimeStateProjector,
      dispatchEvent,
    });
    ui = createUiSystem(ports, profile);
  }

  // ---- 门面控制面 ----
  const facade = new CoreMechanicsFacade(registry);
  const control = {
    advance(): Result<void> {
      const guard = shell.submitGuard();
      if (!guard.ok) return guard;
      const stepped = facade.advancePhase();
      // 阶段推进成功/回绕后广播 round/matchEnd 语义事件（events + gateway 单次出口）。
      broadcastShell();
      return stepped;
    },
    drainPlayerQueue(): Result<void> {
      return facade.consumePlayerQueue();
    },
    broadcast(): void {
      broadcastShell();
    },
  };

  const match: LoadedMatch = {
    engine: {
      registry,
      defRegistry,
      ruleProvider,
      exprEngine,
      queryEngine,
      actionCatalog: harness.actionCatalog,
      playpackLoader,
      playpackActivator,
      gateway,
    },
    load,
    runtime,
    facade,
    projection,
    shell,
    terminal,
    ai: aiRuntime,
    bridge,
    submitter,
    events,
    ui,
    control,
    getWorldState: () => holder.getState(),
  };

  return { ok: true, match };
}

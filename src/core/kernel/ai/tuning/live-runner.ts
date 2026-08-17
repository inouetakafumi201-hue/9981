/**
 * 真实断言宿主（makeLiveAssertionRunner）—— Task 6 的生产版 AssertionRunContext。
 *
 * 把 `AssertionRunner` 的 `runRequest(serialized)` 接到**真实生产决策链路**上：
 *  恢复世界快照 → 用真实 `facade.act` 决策 → 返回 `DecisionTrace`。
 *
 * 这让 golden/行为断言从「占位快照自评」升级为「可真跑回归基准」：断言跑的就是
 * play 生产组合根正在用的 facade + DesignCurrencyGateway（同一费目配置）。若
 * `ParameterTuner` 改完 JSON 后把新配置注入 `createPlayAiRuntime`，断言 host 立即
 * 用它真实决策，成为「调参是否真的改对 AI 行为」的可执行验证。
 *
 * 世界写入仍走 holder.setState（组合根的单一状态持有者），不new写路径、不绕过
 * facade 的只读边界——快照恢复只在决策前把 holder 状态重置到断言 setup，随后
 * 交给 facade.act（Action→Intent→Op 统一链路，唯一语义写入通道 OpRegistry.invoke）。
 */
import type { PlayAiRuntime } from '../../../../play/ai-runtime.js';
import { restoreFromSnapshot } from './snapshot.js';
import type { WorldStateSnapshot } from './snapshot.js';
import type { AssertionRunContext } from './assertions.js';
import type { DecisionTrace } from './trace.js';
import type { WorldState } from '../../state/world-state.js';
import { createEntityShape, createItemShape } from '../../state/entity.js';
import { createContainerShape, createNodeShape, createLinkShape } from '../../topology/types.js';

/**
 * 构造生产断言宿主：把断言世界快照真跑进一个 `play` 生产侧 AI runtime。
 *
 * `runRequest` 会话按调用方意图恢复世界（不自动 seed NPC 队列，由上层在需要时
 * 在 `prepare` 里填充），然后调用 runtime.facade.act 走真实决策环，把结果 trace
 * 返回给 `AssertionRunner`。若是提交型 act 改变了 holder 状态（作为副作用，这是
 * 真实决策的自然结果），不影响断言判定——断言只读 trace.selected。
 *
 * 快照来自 golden 场景（最小世界记形状，源自 AI 测试靶），缺真实内核要求的一等字段
 * （entity.attachments/relations/containers、node/container 全字段等）。真实 `facade.act`
 * 的 canonical 仿真（checkpoint → attempt → restore）会遍历这些字段，缺失即崩。这里在
 * 决策前把恢复出的世界规整到内核形状（`createShape` 结构兜底），不改任何语义数值——
 * 这是把「占位快照」垫到能被生产组合根真跑的最低形状。
 */
export function makeLiveAssertionRunner(
  aiRuntime: PlayAiRuntime,
  options: {
    /** 为每次 `runRequest` 构造一条 act 请求。缺省用 runtime 内部 NPC 决策输入。 */
    requestFor?: (worldHash: string) => ReturnType<typeof defaultRequestFor>;
    /** 每轮恢复快照前的准备回调（如 seed NPC 队列）。 */
    prepare?: () => void;
  } = {},
): AssertionRunContext {
  const { requestFor = defaultRequestFor, prepare } = options;
  return {
    runRequest(serialized: string): { trace: DecisionTrace | null; error?: string } {
      // 1) 恢复世界快照到 runtime 的单一 holder，并规整到内核可消费形状。
      const snapshot: WorldStateSnapshot = { stateHash: 'live', serialized };
      let world: WorldState;
      try {
        world = restoreFromSnapshot(snapshot);
        aiRuntime.holder.setState(normalizeWorld(world) as never);
      } catch (error) {
        return { trace: null, error: `world snapshot restore failed: ${error instanceof Error ? error.message : String(error)}` };
      }
      // 2) 补全生产 agent 记录到可被真实 facade.act 消费的最低形状。golden 场景世界快照里
      //    的 `g:ai` 仅带 kind/knowledgeVersion（源自 AI 测试靶），缺 `id`/`controls`/`omniscient`
      //    ——read-adapter 的 readAuthority 会因 `record.id` undefined 与 `record.controls.map`
      //    崩（cannot read map of undefined），且 `omniscient` 缺省 false 会让非全知查询缺
      //    visibleTo 被拒。这里不决策，只把快照里的 AI agent 补全到 `createAgentShape` 的
      //    标准形状（id=agent.$、controls=[受控实体]、omniscient=true 以匹配 golden 全可见语义）。
      try {
        const request = requestFor(serialized);
        const state = aiRuntime.holder.getState();
        const agentRecord = state.world.agents[request.agent.$];
        const normalized = {
          ...(agentRecord as object),
          id: request.agent.$,
          controls: [{ $: request.controlledEntity.$ }],
          omniscient: true,
          policy: request.policy.$,
        } as WorldState['world']['agents'][string];
        aiRuntime.holder.setState({
          ...state,
          world: { ...state.world, agents: { ...state.world.agents, [request.agent.$]: normalized } },
        } as WorldState);
      } catch {
        // 补全失败不阻断——由后续真实决策报出。
      }
      if (prepare !== undefined) {
        try {
          prepare();
        } catch (error) {
          return { trace: null, error: `assertion prepare failed: ${error instanceof Error ? error.message : String(error)}` };
        }
      }
      // 3) 真实决策。
      const request = requestFor(serialized);
      const result = aiRuntime.facade.act(request);
      if (result.status === 'rejected' || result.status === 'no-action') {
        return { trace: result.trace ?? null, error: result.diagnostics[0]?.reason ?? `facade returned ${result.status}` };
      }
      if (result.trace === undefined) {
        return { trace: null, error: 'facade.act returned an executable result without a DecisionTrace' };
      }
      // 提交型 act 已真实落地到 holder：把世界回滚到断言快照，下一次 runRequest 仍从同一
      // setup 出发（决策重放的确定性纪律）。trace 在回滚前已捕获，判定只读 trace.selected。
      try {
        aiRuntime.holder.setState(normalizeWorld(world) as never);
      } catch {
        // 回滚失败不阻断判定——下一次 runRequest 会以当前状态重新恢复快照。
      }
      return { trace: result.trace };
    },
  };
}

/**
 * 从 runtime 构造 facade.act 的请求。断言的世界快照来自 golden 场景，其归因 agent
 * 是 `g:ai`（play 组合根的 AI agent 稳定编号；policy/binding 与测试靶一致）。
 * 若需在 live-runner 上 seedNpcQueue，调用方应传入自定的 requestFor/prepare。
 */
function defaultRequestFor(_serialized: string) {
  return {
    category: 'npc-behavior' as const,
    mode: 'act' as const,
    agent: { $: 'g:ai' },
    controlledEntity: { $: 'e:hero' },
    policy: { $: 'd:ai-policy' },
    behaviorBinding: { $: 'd:ai-binding' },
    tier: 'exact' as const,
    budget: { decisionPoints: 40, simulations: 60, evaluationCalls: 120 },
    correlationId: `assertion-${Date.now()}`,
  };
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type LooseEntity = Mutable<{ def?: string; kind?: string; node?: string; props?: Record<string, unknown>; tags?: unknown[]; attachments?: unknown[]; relations?: unknown; containers?: unknown }>;

/** 把快照恢复出的世界规整到内核可消费的一等形状（补齐 entity/node/link/container 缺省字段）。 */
function normalizeWorld(world: WorldState): WorldState {
  const state = world as unknown as {
    entities: Record<string, LooseEntity>;
    items: Record<string, Mutable<{ def?: string; props?: Record<string, unknown>; tags?: unknown[]; attachments?: unknown[] }>>;
    nodes: Record<string, Mutable<{ def?: string; props?: Record<string, unknown>; tags?: unknown[]; attachments?: unknown[]; weight?: number }>>;
    links: Record<string, Mutable<{ def?: string; a?: string; b?: string; weight?: number; tags?: unknown[]; props?: Record<string, unknown>; attachments?: unknown[] }>>;
    containers: Record<string, Mutable<{ owner?: string; name?: string; slots?: unknown[]; insert?: unknown; props?: Record<string, unknown> }>>;
  };
  const entities: WorldState['entities'] = {};
  for (const [id, e] of Object.entries(state.entities ?? {})) {
    const base = createEntityShape(id, e.def ?? 'd:entity');
    const props: Record<string, import('../../state/value.js').Value> = {};
    for (const [k, v] of Object.entries(e.props ?? {})) props[k] = v as import('../../state/value.js').Value;
    entities[id] = {
      ...base,
      def: e.def ?? base.def,
      node: e.node ?? base.node,
      props,
      tags: (e.tags ?? []).map((t) => String(t)),
      attachments: (e.attachments ?? []).map((a) => String(a)),
      ...(e.relations !== undefined ? { relations: e.relations as never } : {}),
      ...(e.containers !== undefined ? { containers: e.containers as never } : {}),
    };
  }
  const items: WorldState['items'] = {};
  for (const [id, i] of Object.entries(state.items ?? {})) {
    const base = createItemShape(id, i.def ?? 'd:item');
    const props: Record<string, import('../../state/value.js').Value> = {};
    for (const [k, v] of Object.entries(i.props ?? {})) props[k] = v as import('../../state/value.js').Value;
    items[id] = { ...base, def: i.def ?? base.def, props, tags: (i.tags ?? []).map((t) => String(t)), attachments: (i.attachments ?? []).map((a) => String(a)) };
  }
  const nodes: WorldState['nodes'] = {};
  for (const [id, n] of Object.entries(state.nodes ?? {})) {
    const base = createNodeShape(id, n.def ?? 'd:node');
    const props: Record<string, import('../../state/value.js').Value> = {};
    for (const [k, v] of Object.entries(n.props ?? {})) props[k] = v as import('../../state/value.js').Value;
    nodes[id] = { ...base, def: n.def ?? base.def, weight: n.weight ?? base.weight, props, tags: (n.tags ?? []).map((t) => String(t)), attachments: (n.attachments ?? []).map((a) => String(a)) };
  }
  const links: WorldState['links'] = {};
  for (const [id, l] of Object.entries(state.links ?? {})) {
    const base = createLinkShape(id, l.a ?? id, l.b ?? id);
    const props: Record<string, import('../../state/value.js').Value> = {};
    for (const [k, v] of Object.entries(l.props ?? {})) props[k] = v as import('../../state/value.js').Value;
    links[id] = { ...base, def: l.def ?? base.def, weight: l.weight ?? base.weight, props, tags: (l.tags ?? []).map((t) => String(t)), attachments: (l.attachments ?? []).map((a) => String(a)) };
  }
  const containers: WorldState['containers'] = {};
  for (const [id, c] of Object.entries(state.containers ?? {})) {
    const base = createContainerShape(id, c.owner ?? id, c.name ?? 'default', c.insert === 'shift' ? 'shift' : 'fixed');
    const props: Record<string, import('../../state/value.js').Value> = {};
    for (const [k, v] of Object.entries(c.props ?? {})) props[k] = v as import('../../state/value.js').Value;
    containers[id] = { ...base, owner: c.owner ?? base.owner, name: c.name ?? base.name, slots: [...(c.slots ?? [])] as never, props };
  }
  return { ...world, entities, items, nodes, links, containers };
}


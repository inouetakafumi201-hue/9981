/**
 * L3 Ops: agent.bind / agent.unbind（design.md 3.1/3.4/3.12节 / 需求5.1-5.7, 16.6）。
 *
 * 缺失 Op 补齐（记录于 决策与风险记录.md）：design.md 3.4节 Op 全集清单把 agent.bind/unbind
 * 列在"认知类"分组，需求5.2 明确要求 agent.bind 把 Entity Ref 加入 Agent.controls 数组——
 * 但此前实现只有 state/agent.ts 的 Agent 数据结构与 createAgentShape 工厂函数，从未注册
 * 这两个 Op，导致 Agent.controls 字段在整套实现里从未被真正的写入路径改写过。
 */
import type { OpImpl, OpRegistry } from './registry.js';
import { ok, err } from './result.js';
import type { Id, Ref } from '../state/ids.js';
import { nextId } from '../state/ids.js';
import type { Agent, AgentKind } from '../state/agent.js';
import { createAgentShape } from '../state/agent.js';

export interface AgentCreateArgs {
  kind: AgentKind;
  knowledgeScope: Id;
}

/** agent.create：Op 全集清单未单列，但 agent.bind 需要一个已存在的 Agent 才能绑定——
 * 这里补一个最小的创建入口（design.md 未给出 Agent 专属创建 Op 名，命名沿用 create/destroy
 * 的既有惯例，与 entity.create/item.create/node.create 对称）。 */
export const agentCreate: OpImpl<AgentCreateArgs, Ref> = (args, ctx) => {
  const draft = ctx.tx.getDraft();
  // Agent 与 Attachment 共用 `a:` 前缀。此前这里按 agents 数量自增，而 Attachment 走
  // nextId('a') 的独立计数器，两者会生成同一个 Id（例如都产出 a:1），使 Ref 解析在
  // Attachment 与 Agent 之间产生歧义。改为共用同一个计数器后，前缀内唯一性由计数器保证。
  const id = nextId('a');
  const agent = createAgentShape(id, args.kind, args.knowledgeScope);
  ctx.tx.setDraft({ ...draft, world: { ...draft.world, agents: { ...draft.world.agents, [id]: agent } } });
  ctx.tx.logOp('agent.create', args, () => {});
  return ok({ $: id });
};

export interface AgentBindArgs {
  agentId: Id;
  entityRef: Ref;
}

/** agent.bind：把 Entity 的 Ref 加入 Agent.controls 数组（需求5.2）。 */
export const agentBind: OpImpl<AgentBindArgs, void> = (args, ctx) => {
  const draft = ctx.tx.getDraft();
  const agent = draft.world.agents[args.agentId];
  if (!agent) return err('E_REF_MISSING', `Agent ${args.agentId} 不存在`);
  if (agent.controls.some((r) => r.$ === args.entityRef.$)) return ok(undefined); // 幂等：已绑定则无操作
  const updated: Agent = { ...agent, controls: [...agent.controls, args.entityRef] };
  ctx.tx.setDraft({ ...draft, world: { ...draft.world, agents: { ...draft.world.agents, [args.agentId]: updated } } });
  ctx.tx.logOp('agent.bind', args, () => {});
  return ok(undefined);
};

export interface AgentUnbindArgs {
  agentId: Id;
  entityRef: Ref;
}

/** agent.unbind：从 Agent.controls 数组移除指定 Entity 的 Ref。 */
export const agentUnbind: OpImpl<AgentUnbindArgs, void> = (args, ctx) => {
  const draft = ctx.tx.getDraft();
  const agent = draft.world.agents[args.agentId];
  if (!agent) return err('E_REF_MISSING', `Agent ${args.agentId} 不存在`);
  const updated: Agent = { ...agent, controls: agent.controls.filter((r) => r.$ !== args.entityRef.$) };
  ctx.tx.setDraft({ ...draft, world: { ...draft.world, agents: { ...draft.world.agents, [args.agentId]: updated } } });
  ctx.tx.logOp('agent.unbind', args, () => {});
  return ok(undefined);
};

export function registerAgentOps(registry: OpRegistry): void {
  registry.register('agent.create', agentCreate);
  registry.register('agent.bind', agentBind);
  registry.register('agent.unbind', agentUnbind);
}

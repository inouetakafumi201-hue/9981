/**
 * L1 State: Agent 结构（design.md 3.1/3.12节 / 需求5.1-5.7）。
 */
import type { Id, Ref } from './ids';
import type { Value } from './value';

export type AgentKind = 'human' | 'ai' | 'observer';

export interface Agent {
  readonly id: Id;
  readonly kind: AgentKind;
  readonly controls: Ref[];
  readonly knowledgeScope: Id;
  readonly omniscient?: boolean;
  readonly authority?: string[];
  readonly policy?: Id; // kind 为 'ai' 时决策来源
  readonly props: Record<string, Value>;
}

export function createAgentShape(id: Id, kind: AgentKind, knowledgeScope: Id): Agent {
  return { id, kind, controls: [], knowledgeScope, props: {} };
}

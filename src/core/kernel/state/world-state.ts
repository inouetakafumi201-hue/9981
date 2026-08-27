/**
 * L1 State: WorldState 顶层组合（design.md 4.1节 / 需求1.5-1.9）。
 * 顶层集合数恒为 6：world/defs/nodes/links/entities/items（需求1.8）。
 * containers 不是第7个顶层集合，而是 entities/items 内部索引指向的辅助存储（需求1.9 的姊妹条款，
 * 对应 design.md 4.1 节说明）——这里仍单独存一份 Record<Id,Container> 供 O(1) 按 id 查找，
 * 但它不计入"顶层集合数恒为6"的计数，因为它不是需求1.8 列举的六个集合之一，
 * 只是 Entity/Item.containers[name] -> Id 索引所指向的辅助表。
 */
import type { Id } from './ids';
import type { Value } from './value';
import type { Def } from './def';
import type { Entity, Item } from './entity';
import type { Agent } from './agent';
import type { Attachment } from './attachment';
import type { Node, Link, Container } from '../topology/types';

export interface TurnState {
  readonly scheduleId: Id;
  readonly phaseIndex: number;
  readonly phaseEnteredAt: number;
}

export interface RngStreamState {
  readonly name: string;
  readonly seed: number;
  readonly counter: number;
}

export interface DecisionState {
  readonly id: Id;
  readonly def: Id;
  readonly askees: { $: Id }[];
  readonly answers: Record<string, Value>;
  readonly ctx: Record<string, Value>;
  readonly opensAt: number;
  readonly deadline?: number;
  readonly status: 'open' | 'resolved' | 'timeout' | 'void';
}

export interface IntentState {
  readonly id: Id;
  readonly agent: Id;
  readonly action: Id;
  readonly bindings: Record<string, Value>;
  readonly submittedAt: number;
  readonly priority?: number;
  readonly hidden: boolean;
  readonly status: 'pending' | 'resolved' | 'failed' | 'void';
  /** serialized FrozenCostEntry[] stored as Value so L1 does not import L6 */
  readonly reservation?: Value;
}

export interface RuleCircuitEntry {
  readonly windowErrors: number[];
  readonly disabled: boolean;
}

/**
 * 延迟/定时执行队列条目（Flow 的 after/at 效果，需求22.1）。
 *
 * `effects` 存为 `Value` 而非 `Effect[]`：Effect 类型定义在 L4（events），而 WorldState 是 L1，
 * L1 不得反向依赖 L4——这与 `IntentState.reservation` 存序列化 Value 同一手法。Effect 结构本身
 * 就是 JSON 形状（op/args/if/...），所以作为 Value 存储无损，schedule.advance 消费时再断言回 Effect[]。
 * 队列纳入 WorldState 而非进程内存，保证 after/at 的挂起效果被 snapshot/replay 捕获——否则回放时
 * 已排期未触发的效果会丢失，重放结果与原局不一致。
 */
export interface DeferredEffect {
  readonly seq: number;
  readonly kind: 'after' | 'at';
  /** 触发相位阈值：当 world.turn.phaseEnteredAt >= dueAt 时，schedule.advance 兑现该条目。 */
  readonly dueAt: number;
  readonly effects: Value;
  /** 排期时刻捕获的局部变量快照，兑现时作为初始 vars 传入 Flow。 */
  readonly vars: Record<string, Value>;
}

/**
 * 已发生 Event 在有界环形缓冲 `world.log` 中的记录（需求15.1）。
 *
 * 刻意没有 `id` 字段、也不参与 Ref 寻址：需求1.2 把 Ref 的前缀限定为封闭集合
 * `e i n l c s a g d w`，里面没有留给日志条目的前缀，因此日志条目不是可寻址对象。
 * 它在缓冲里的身份就是 `seq`（单调递增序号），保留窗口的裁剪按 seq 与 phase 两个维度进行。
 */
export interface LogEntry {
  readonly seq: number;
  readonly type: string;
  readonly payload: Record<string, Value>;
  /** 写入该条目时的相位时间戳，供 logRetention.phases 形式的窗口裁剪使用。 */
  readonly phase: number;
}

export interface WorldTop {
  readonly props: Record<string, Value>;
  readonly agents: Record<Id, Agent>;
  readonly knowledge: Record<Id, { facts: Record<string, Value>; seen: Record<string, Value> }>;
  readonly decisions: Record<Id, DecisionState>;
  readonly intents: Record<Id, IntentState>;
  readonly attachments: Record<Id, Attachment>;
  readonly turn: TurnState;
  readonly rng: Record<string, RngStreamState>;
  readonly ruleCircuitState: Record<Id, RuleCircuitEntry>;
  readonly log: readonly LogEntry[];
  /** 已写入日志的条目总数（含已被窗口裁掉的），保证 seq 在裁剪后仍单调递增不复用。 */
  readonly logSeq: number;
  /**
   * 当前生效的日志保留窗口（需求15.2：由 PlaypackDef.logRetention 驱动）。
   * 放进 WorldState 而非进程内存，保证它被快照/回放捕获——否则 replay 时窗口大小可能与原局不同，
   * 导致重放出的 world.log 与原始运行不一致。未设置（装载前）时按 DEFAULT_LOG_RETENTION 兜底。
   */
  readonly logRetention?: { readonly phases?: number; readonly max?: number };
  /** Flow 的 after/at 效果排入的延迟执行队列，由 schedule.advance 在相位到达时兑现（需求22.1）。 */
  readonly deferredEffects: readonly DeferredEffect[];
  /** 延迟效果的单调序号，保证兑现顺序在同一 dueAt 内确定、且不因出队复用。 */
  readonly deferredSeq: number;
}

export interface WorldState {
  readonly world: WorldTop;
  readonly defs: Record<Id, Def>;
  readonly nodes: Record<Id, Node>;
  readonly links: Record<Id, Link>;
  readonly entities: Record<Id, Entity>;
  readonly items: Record<Id, Item>;
  readonly containers: Record<Id, Container>;
}

export const TOP_LEVEL_COLLECTION_KEYS = ['world', 'defs', 'nodes', 'links', 'entities', 'items'] as const;

export function createEmptyWorldState(scheduleId: Id): WorldState {
  return {
    world: {
      props: {},
      agents: {},
      knowledge: {},
      decisions: {},
      intents: {},
      attachments: {},
      turn: { scheduleId, phaseIndex: 0, phaseEnteredAt: 0 },
      rng: {},
      ruleCircuitState: {},
      log: [],
      logSeq: 0,
      deferredEffects: [],
      deferredSeq: 0,
    },
    defs: {},
    nodes: {},
    links: {},
    entities: {},
    items: {},
    containers: {},
  };
}
/**
 * L2 Expr: 表达式算子的只读状态访问面（design.md 3.3节算子表的拓扑/状态/关系/认知四类）。
 *
 * 为什么需要这一层：ExprEngine 被刻意设计为不持有 WorldState（见 engine.ts 的 EvalContext
 * 注释），路径读取靠调用方注入的 `resolvePath`。但拓扑度量（dist/spread/path/radius）、
 * 附着查询（hasAttachment/attachCount）、关系查询（relOut/relIn/hasRel）与认知查询（knows）
 * 都不是"读一个路径"能表达的——它们需要遍历 nodes/links/attachments/entities 集合。
 *
 * 把这些能力表达为一个窄接口注入，而不是让 ExprEngine 直接 import WorldState，保持了两件事：
 * 1. ExprEngine 仍然是全函数且无状态：accessor 缺失时相关算子一律返回 null，不抛异常（需求12.1）。
 * 2. 分层方向不被破坏：L2 不反向依赖 L3 的写入能力，只消费一个由调用方构造的只读视图。
 */
import type { Id, Ref } from '../state/ids';
import { isRef } from '../state/ids';
import type { Value } from '../state/value';
import type { WorldState } from '../state/world-state';
import type { DefRegistry } from '../state/def';
import type { Attachment } from '../state/attachment';
import { dist, radius, shortestPath, spread } from '../topology/metrics';
import type { DistOpts } from '../topology/metrics';

/** 拓扑算子的可选修饰：via 只支持"边必须带某个 tag"这一种闭包无关的过滤形式，见下方说明。 */
export interface TopologyOpOpts {
  readonly viaTag?: string;
  readonly maxCost?: number;
  readonly metric?: 'sum' | 'hops';
}

export interface ExprStateAccess {
  // ---- 拓扑类 ----
  dist(a: Id, b: Id, opts?: TopologyOpOpts): number | null;
  path(a: Id, b: Id, opts?: TopologyOpOpts): Id[] | null;
  spread(origin: Id, budget: number, opts?: TopologyOpOpts): { node: Id; strength: number }[];
  radius(origin: Id, budget: number, opts?: TopologyOpOpts): Id[];
  nodeOf(ref: Ref): Id | null;
  parentOf(nodeId: Id): Id | null;
  containerOf(ref: Ref): Id | null;
  slotOf(ref: Ref): Id | null;
  occupantsOf(nodeId: Id): Ref[];

  // ---- 状态类 ----
  tagsOf(ref: Ref): string[];
  /** 只统计已生效的 Attachment：activeAt 未到的视为不存在（需求30.8）。 */
  activeAttachmentsOf(ref: Ref): Attachment[];
  propOf(ref: Ref, path: string): Value | null;
  defOf(ref: Ref): Id | null;
  isA(ref: Ref, defId: Id): boolean;

  // ---- 关系类 ----
  relOut(ref: Ref, kind: string): Ref[];
  relIn(ref: Ref, kind: string): Ref[];

  // ---- 认知类 ----
  knows(scopeId: Id, key: string): Value | null;
}

/**
 * 从一个"取当前 WorldState"的回调构造只读访问面。
 *
 * 传回调而不是传 WorldState 实例：Op 执行期间 draft 会不断被替换，若在这里捕获一份状态快照，
 * 同一个 EvalContext 在 Op 前后就会读到过期数据。回调保证每个算子调用都读到调用时刻的状态。
 *
 * `phaseOf` 用于判断 Attachment 是否已生效（activeAt 与当前相位比较，需求30.8）。默认取
 * `world.turn.phaseEnteredAt`——它是内核里唯一单调推进且被快照捕获的相位时间戳。
 */
export function makeExprStateAccess(
  getState: () => WorldState,
  defRegistry?: DefRegistry,
  phaseOf?: (state: WorldState) => number,
): ExprStateAccess {
  const currentPhase = (state: WorldState): number =>
    phaseOf ? phaseOf(state) : state.world.turn.phaseEnteredAt;

  const toDistOpts = (opts?: TopologyOpOpts): DistOpts => ({
    // via 只暴露"边必须带某个 tag"这一种形式：Expr 没有 lambda（需求12.2 的六种形态里没有函数
    // 字面量，需求22.3 明确禁止闭包），所以无法把一个任意谓词传进图遍历。tag 过滤覆盖了源设计稿
    // 举的主要用例（`dist(via: hasTag 'sight')` 式的视线/通行分层），又不引入闭包。
    ...(opts?.viaTag !== undefined ? { via: (link) => link.tags.includes(opts.viaTag as string) } : {}),
    ...(opts?.maxCost !== undefined ? { maxCost: opts.maxCost } : {}),
    ...(opts?.metric !== undefined ? { metric: opts.metric } : {}),
  });

  return {
    dist: (a, b, opts) => {
      const state = getState();
      return dist(state.nodes, state.links, a, b, toDistOpts(opts));
    },
    path: (a, b, opts) => {
      const state = getState();
      return shortestPath(state.nodes, state.links, a, b, toDistOpts(opts));
    },
    spread: (origin, budget, opts) => {
      const state = getState();
      if (!Number.isFinite(budget)) return [];
      return spread(state.nodes, state.links, origin, budget, {
        ...(opts?.viaTag !== undefined ? { via: (link) => link.tags.includes(opts.viaTag as string) } : {}),
        ...(opts?.metric !== undefined ? { metric: opts.metric } : {}),
      }).map((entry) => ({ node: entry.node, strength: entry.strength }));
    },
    radius: (origin, budget, opts) => {
      const state = getState();
      return radius(state.nodes, state.links, origin, budget, toDistOpts(opts));
    },

    nodeOf: (ref) => {
      const state = getState();
      const entity = state.entities[ref.$];
      if (entity?.node !== undefined) return entity.node;
      // Item 不直接站在节点上（需求2.1 的 node/slot 互斥），但它所在的槎位属于某个容器，
      // 容器的 owner 最终落到某个站在节点上的 Entity——沿这条链回溯，使 nodeOf 对 Item 也有答案。
      let cursor: Id | undefined = state.items[ref.$]?.slot;
      const seen = new Set<Id>();
      while (cursor !== undefined && !seen.has(cursor)) {
        seen.add(cursor);
        const container = Object.values(state.containers).find((c) => c.slots.some((s) => s?.id === cursor));
        if (!container) return null;
        const ownerEntity = state.entities[container.owner];
        if (ownerEntity?.node !== undefined) return ownerEntity.node;
        cursor = state.items[container.owner]?.slot;
      }
      return null;
    },
    parentOf: (nodeId) => getState().nodes[nodeId]?.parent ?? null,
    containerOf: (ref) => {
      const state = getState();
      const slotId = state.entities[ref.$]?.slot ?? state.items[ref.$]?.slot;
      if (slotId === undefined) return null;
      return Object.values(state.containers).find((c) => c.slots.some((s) => s?.id === slotId))?.id ?? null;
    },
    slotOf: (ref) => {
      const state = getState();
      return state.entities[ref.$]?.slot ?? state.items[ref.$]?.slot ?? null;
    },
    occupantsOf: (nodeId) => {
      const state = getState();
      // 现查而非维护派生计数（与微型场景占用者判断同一手法，design.md 3.2节）。
      return Object.values(state.entities)
        .filter((entity) => entity.node === nodeId)
        .map((entity) => ({ $: entity.id }))
        .sort((left, right) => left.$.localeCompare(right.$));
    },

    tagsOf: (ref) => {
      const state = getState();
      const holder = state.entities[ref.$] ?? state.items[ref.$] ?? state.nodes[ref.$] ?? state.links[ref.$];
      return holder ? [...holder.tags] : [];
    },
    activeAttachmentsOf: (ref) => {
      const state = getState();
      const phase = currentPhase(state);
      return (Object.values(state.world.attachments) as Attachment[])
        .filter((attachment) => attachment.target.$ === ref.$)
        .filter((attachment) => attachment.activeAt === undefined || attachment.activeAt <= phase)
        .sort((left, right) => left.id.localeCompare(right.id));
    },

    propOf: (ref, path) => {
      const state = getState();
      const holder = state.entities[ref.$]
        ?? state.items[ref.$]
        ?? state.nodes[ref.$]
        ?? state.links[ref.$]
        ?? state.world.attachments[ref.$]
        ?? state.containers[ref.$];
      if (!holder) return null;
      const root = (holder as { readonly props: Record<string, Value> }).props;
      return path.split('.').reduce<unknown>((current, segment) => {
        if (current === null || typeof current !== 'object') return null;
        return (current as Record<string, unknown>)[segment] ?? null;
      }, root) as Value | null;
    },
    defOf: (ref) => {
      const state = getState();
      return state.entities[ref.$]?.def
        ?? state.items[ref.$]?.def
        ?? state.nodes[ref.$]?.def
        ?? state.links[ref.$]?.def
        ?? state.world.attachments[ref.$]?.def
        ?? null;
    },
    isA: (ref, defId) => {
      if (!defRegistry) return false;
      const state = getState();
      const actual = state.entities[ref.$]?.def
        ?? state.items[ref.$]?.def
        ?? state.nodes[ref.$]?.def
        ?? state.links[ref.$]?.def
        ?? state.world.attachments[ref.$]?.def;
      return actual === undefined ? false : defRegistry.defIsA(actual, defId);
    },

    relOut: (ref, kind) => [...(getState().entities[ref.$]?.relations[kind]?.out ?? [])],
    relIn: (ref, kind) => [...(getState().entities[ref.$]?.relations[kind]?.in ?? [])],

    knows: (scopeId, key) => {
      const entry = getState().world.knowledge[scopeId];
      if (!entry) return null;
      return entry.facts[key] ?? null;
    },
  };
}

/** 把任意 Expr 求值结果收敛成一个 Ref，非 Ref 一律 null（算子入参的统一守卫）。 */
export function asRef(value: Value | null | undefined): Ref | null {
  return value !== null && value !== undefined && isRef(value) ? value : null;
}

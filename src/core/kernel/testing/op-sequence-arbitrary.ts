/**
 * fast-check 随机 Op 序列生成器（供本轮全面对抗性属性测试使用）。
 *
 * 设计判断（记录于 决策与风险记录.md 的模糊测试专项记录）：不用 fc.oneof 对全部 Op 名等权重
 * 随机采样，因为大多数 Op 需要"先有一个可引用的 Id"才有意义（例如 item.move 需要先
 * item.create 才有 itemId）。这里用一个"跟踪已创建 Id 池"的生成策略：generateOpCall 每次
 * 从当前已知 Id 池中按类型采样（entities/items/nodes/links/containers/attachments/agents/
 * decisions/intents），并混入一定比例的"故意悬空"引用（从池中不存在的 Id 空间采样）——
 * 这正是题目要求的"任何底层不自洽现象都要暴力探底"的具体落点：悬空引用必须始终触发
 * E_REF_MISSING 而不是内部异常或状态污染。
 */
import fc from 'fast-check';
import type { Id } from '../state/ids';

export interface OpCall {
  op: string;
  args: unknown;
}

export interface IdPool {
  entities: Id[];
  items: Id[];
  nodes: Id[];
  links: Id[];
  containers: Id[];
  attachments: Id[];
  agents: Id[];
  decisions: Id[];
  intents: Id[];
}

export function emptyIdPool(): IdPool {
  return { entities: [], items: [], nodes: [], links: [], containers: [], attachments: [], agents: [], decisions: [], intents: [] };
}

/** 从池中随机取一个 Id；池为空或命中"故意悬空"概率时返回一个必然不存在的伪造 Id。 */
function pickIdOrDangling(pool: Id[], prefix: string, danglingProb: number, rng: () => number): Id {
  if (pool.length === 0 || rng() < danglingProb) {
    return `${prefix}:dangling-${Math.floor(rng() * 1000000)}`;
  }
  return pool[Math.floor(rng() * pool.length)] as Id;
}

/**
 * 生成一个长度为 [minLen,maxLen] 的随机 Op 调用序列 arbitrary。
 * 每次调用都携带一个"操作类型"标签，驱动器（fuzz 执行器）据此更新 IdPool 并记录调用结果。
 * 这里只生成"调用意图"（哪个 Op、用什么策略选参数），真正的参数值在执行时才从当前 IdPool
 * 现取——因为 fast-check 的 shrinking 需要在 arbitrary 值本身里编码"意图"而不是"具体 Id"
 * （具体 Id 在生成时还不存在，必须在执行时动态解析）。
 */
export type OpIntent =
  | { kind: 'entityCreate'; def: string }
  | { kind: 'entityDestroy'; which: 'existing' | 'dangling' }
  | { kind: 'entityPlace'; which: 'existing' | 'dangling'; nodeWhich: 'existing' | 'dangling' }
  | { kind: 'itemCreate'; def: string; stack?: number; stackMax?: number }
  | { kind: 'itemDestroy'; which: 'existing' | 'dangling' }
  | { kind: 'itemMove'; itemWhich: 'existing' | 'dangling'; containerWhich: 'existing' | 'dangling'; atSlot?: number }
  | { kind: 'itemPromote'; itemWhich: 'existing' | 'dangling'; nodeWhich: 'existing' | 'dangling' }
  | { kind: 'entityDemote'; entityWhich: 'existing' | 'dangling'; containerWhich: 'existing' | 'dangling' }
  | { kind: 'nodeCreate'; def: string; weight?: number }
  | { kind: 'nodeDestroy'; which: 'existing' | 'dangling' }
  | { kind: 'nodeSplit'; which: 'existing' | 'dangling'; specDefs: string[] }
  | { kind: 'linkCreate'; def: string; aWhich: 'existing' | 'dangling'; bWhich: 'existing' | 'dangling' }
  | { kind: 'linkDestroy'; which: 'existing' | 'dangling' }
  | { kind: 'slotAdd'; containerWhich: 'existing' | 'dangling' }
  | { kind: 'slotDel'; containerWhich: 'existing' | 'dangling'; index: number }
  | { kind: 'stackSplit'; itemWhich: 'existing' | 'dangling'; n: number; containerWhich: 'existing' | 'dangling' }
  | { kind: 'stackMerge'; fromWhich: 'existing' | 'dangling'; intoWhich: 'existing' | 'dangling' }
  | { kind: 'relationSet'; fromWhich: 'existing' | 'dangling'; toWhich: 'existing' | 'dangling'; relKind: string }
  | { kind: 'relationDel'; fromWhich: 'existing' | 'dangling'; toWhich: 'existing' | 'dangling'; relKind: string }
  | { kind: 'entitySetDef'; which: 'existing' | 'dangling'; def: string; carry: string[] }
  | { kind: 'nodeMerge'; keepWhich: 'existing' | 'dangling'; absorbWhich: 'existing' | 'dangling'; carry: string[] }
  | { kind: 'propSet'; targetWhich: 'existing' | 'dangling'; collection: 'entities' | 'items' | 'nodes' | 'links'; field: string; value: number | string | boolean | null }
  | { kind: 'propAdd'; targetWhich: 'existing' | 'dangling'; collection: 'entities' | 'items'; field: string; delta: number }
  | { kind: 'tagAdd'; targetWhich: 'existing' | 'dangling'; collection: 'entities' | 'items' | 'nodes' | 'links'; tag: string }
  | { kind: 'agentCreate'; agentKind: 'human' | 'ai' | 'observer' }
  | { kind: 'agentBind'; agentWhich: 'existing' | 'dangling'; entityWhich: 'existing' | 'dangling' }
  | { kind: 'agentUnbind'; agentWhich: 'existing' | 'dangling'; entityWhich: 'existing' | 'dangling' }
  | { kind: 'attachAdd'; def: string; targetWhich: 'existing' | 'dangling' | 'world'; grantedByWhich: 'existing' | 'none' }
  | { kind: 'attachDel'; which: 'existing' | 'dangling' }
  | { kind: 'decisionOpen'; def: string; askeeCount: number }
  | { kind: 'decisionAnswer'; which: 'existing' | 'dangling'; choice: string }
  | { kind: 'intentSubmit'; def: string; agentWhich: 'existing' | 'dangling'; hidden: boolean }
  | { kind: 'intentResolve'; which: 'existing' | 'dangling' }
  | { kind: 'intentVoid'; which: 'existing' | 'dangling' }
  | { kind: 'prefabSpawn'; def: string; attachToWhich: 'existing' | 'dangling' | 'none' }
  | { kind: 'prefabDespawn' } // 从最近一次成功 spawn 的 handle 池取值，执行时解析
  | { kind: 'outcomeReach'; outcomeName: string; scope: 'existing' | 'dangling'; ends: boolean }
  | { kind: 'scheduleAdvance' }
  | { kind: 'randomRoll'; sides: number; stream: string }
  | { kind: 'randomPickFromPool'; stream: string };

const whichArb = fc.constantFrom<'existing' | 'dangling'>('existing', 'dangling');
const collectionArb = fc.constantFrom<'entities' | 'items' | 'nodes' | 'links'>('entities', 'items', 'nodes', 'links');
const carryArb = fc.subarray(['props', 'relations', 'containers', 'attachments', 'tags']);
const scalarValueArb = fc.oneof(
  fc.integer({ min: -1000, max: 1000 }),
  fc.constantFrom('a', 'b', 'c', ''),
  fc.boolean(),
  fc.constant(null),
);

/** 单个 OpIntent 的 arbitrary：覆盖全部 Op 意图形态，含刻意畸形数值边界（负数索引、0 拆分数等）。 */
export const opIntentArb: fc.Arbitrary<OpIntent> = fc.oneof(
  fc.record({ kind: fc.constant('entityCreate' as const), def: fc.constantFrom('d:human', 'd:unknown-def', 'd:abstract_entity', 'd:concrete_entity', 'd:sword') }),
  fc.record({ kind: fc.constant('entityDestroy' as const), which: whichArb }),
  fc.record({ kind: fc.constant('entityPlace' as const), which: whichArb, nodeWhich: whichArb }),
  fc.record({ kind: fc.constant('itemCreate' as const), def: fc.constantFrom('d:sword', 'd:unknown-def', 'd:abstract_item', 'd:concrete_item', 'd:bag', 'd:human'), stack: fc.option(fc.integer({ min: -5, max: 20 }), { nil: undefined }), stackMax: fc.option(fc.integer({ min: -5, max: 20 }), { nil: undefined }) }),
  fc.record({ kind: fc.constant('itemDestroy' as const), which: whichArb }),
  fc.record({ kind: fc.constant('itemMove' as const), itemWhich: whichArb, containerWhich: whichArb, atSlot: fc.option(fc.integer({ min: -3, max: 10 }), { nil: undefined }) }),
  fc.record({ kind: fc.constant('itemPromote' as const), itemWhich: whichArb, nodeWhich: whichArb }),
  fc.record({ kind: fc.constant('entityDemote' as const), entityWhich: whichArb, containerWhich: whichArb }),
  fc.record({ kind: fc.constant('nodeCreate' as const), def: fc.constantFrom('d:room', 'd:unknown-def', 'd:abstract_node', 'd:concrete_node', 'd:human'), weight: fc.option(fc.integer({ min: -10, max: 10 }), { nil: undefined }) }),
  fc.record({ kind: fc.constant('nodeDestroy' as const), which: whichArb }),
  fc.record({ kind: fc.constant('nodeSplit' as const), which: whichArb, specDefs: fc.array(fc.constantFrom('d:room', 'd:abstract_node', 'd:concrete_node', 'd:unknown-def'), { minLength: 0, maxLength: 3 }) }),
  fc.record({ kind: fc.constant('linkCreate' as const), def: fc.constantFrom('d:door', 'd:unknown-def', 'd:abstract_link', 'd:concrete_link', 'd:room'), aWhich: whichArb, bWhich: whichArb }),
  fc.record({ kind: fc.constant('linkDestroy' as const), which: whichArb }),
  fc.record({ kind: fc.constant('slotAdd' as const), containerWhich: whichArb }),
  fc.record({ kind: fc.constant('slotDel' as const), containerWhich: whichArb, index: fc.integer({ min: -3, max: 10 }) }),
  fc.record({ kind: fc.constant('stackSplit' as const), itemWhich: whichArb, n: fc.integer({ min: -5, max: 20 }), containerWhich: whichArb }),
  fc.record({ kind: fc.constant('stackMerge' as const), fromWhich: whichArb, intoWhich: whichArb }),
  fc.record({ kind: fc.constant('relationSet' as const), fromWhich: whichArb, toWhich: whichArb, relKind: fc.constantFrom('knows', 'owns', 'allies') }),
  fc.record({ kind: fc.constant('relationDel' as const), fromWhich: whichArb, toWhich: whichArb, relKind: fc.constantFrom('knows', 'owns', 'allies') }),
  fc.record({ kind: fc.constant('entitySetDef' as const), which: whichArb, def: fc.constantFrom('d:human', 'd:unknown-def', 'd:abstract_entity', 'd:concrete_entity', 'd:sword'), carry: carryArb }),
  fc.record({ kind: fc.constant('nodeMerge' as const), keepWhich: whichArb, absorbWhich: whichArb, carry: carryArb }),
  fc.record({ kind: fc.constant('propSet' as const), targetWhich: whichArb, collection: collectionArb, field: fc.constantFrom('hp', 'x', 'y', 'name'), value: scalarValueArb }),
  fc.record({ kind: fc.constant('propAdd' as const), targetWhich: whichArb, collection: fc.constantFrom('entities' as const, 'items' as const), field: fc.constantFrom('hp', 'x'), delta: fc.integer({ min: -2000, max: 2000 }) }),
  fc.record({ kind: fc.constant('tagAdd' as const), targetWhich: whichArb, collection: collectionArb, tag: fc.constantFrom('flammable', 'metal', 'wounded') }),
  fc.record({ kind: fc.constant('agentCreate' as const), agentKind: fc.constantFrom('human' as const, 'ai' as const, 'observer' as const) }),
  fc.record({ kind: fc.constant('agentBind' as const), agentWhich: whichArb, entityWhich: whichArb }),
  fc.record({ kind: fc.constant('agentUnbind' as const), agentWhich: whichArb, entityWhich: whichArb }),
  fc.record({
    kind: fc.constant('attachAdd' as const),
    def: fc.constantFrom('d:buff', 'd:unknown-def', 'd:abstractBuff'),
    targetWhich: fc.constantFrom('existing' as const, 'dangling' as const, 'world' as const),
    // grantedBy 从已有 attachment 池取值：这是 grantedBy 级联（需求20.13/Property 12）在随机
    // 长序列中被真正触达的唯一途径——此前的生成器从不设置 grantedBy，级联链只有专项测试覆盖。
    grantedByWhich: fc.constantFrom('existing' as const, 'none' as const),
  }),
  fc.record({ kind: fc.constant('attachDel' as const), which: whichArb }),
  fc.record({ kind: fc.constant('decisionOpen' as const), def: fc.constantFrom('d:vote', 'd:unknown-def'), askeeCount: fc.integer({ min: 0, max: 5 }) }),
  fc.record({ kind: fc.constant('decisionAnswer' as const), which: whichArb, choice: fc.constantFrom('yes', 'no', 'invalid-choice') }),
  fc.record({ kind: fc.constant('intentSubmit' as const), def: fc.constantFrom('d:move', 'd:unknown-def'), agentWhich: whichArb, hidden: fc.boolean() }),
  fc.record({ kind: fc.constant('intentResolve' as const), which: whichArb }),
  fc.record({ kind: fc.constant('intentVoid' as const), which: whichArb }),
  fc.record({ kind: fc.constant('prefabSpawn' as const), def: fc.constantFrom('p:room', 'p:unknown-prefab'), attachToWhich: fc.constantFrom('existing' as const, 'dangling' as const, 'none' as const) }),
  fc.record({ kind: fc.constant('prefabDespawn' as const) }),
  fc.record({ kind: fc.constant('outcomeReach' as const), outcomeName: fc.constantFrom('victory', 'defeat'), scope: whichArb, ends: fc.boolean() }),
  fc.record({ kind: fc.constant('scheduleAdvance' as const) }),
  fc.record({ kind: fc.constant('randomRoll' as const), sides: fc.integer({ min: -5, max: 20 }), stream: fc.constantFrom('main', 'combat') }),
  fc.record({ kind: fc.constant('randomPickFromPool' as const), stream: fc.constantFrom('main', 'combat') }),
);

/** 一条完整的随机操作序列 arbitrary，长度范围可配置。 */
export function opSequenceArb(minLength: number, maxLength: number): fc.Arbitrary<OpIntent[]> {
  return fc.array(opIntentArb, { minLength, maxLength });
}

export { pickIdOrDangling };

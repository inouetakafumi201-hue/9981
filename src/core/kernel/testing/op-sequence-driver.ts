/**
 * OpIntent[] 执行驱动器：把 op-sequence-arbitrary.ts 生成的"调用意图"序列，按当前 IdPool
 * 现状解析成真实参数并逐条调用 registry.invoke，同步更新 IdPool（供后续 intent 引用本次
 * 调用新创建的 Id）。
 *
 * 这是模糊测试的执行核心：每一步都记录 Op 名、参数、Result，供事后断言复核。
 */
import type { FullHarness } from './full-harness.js';
import type { OpIntent } from './op-sequence-arbitrary.js';
import type { Result } from '../ops/result.js';
import type { Id } from '../state/ids.js';
import type { PrefabHandle } from '../topology/prefab.js';

export interface StepLog {
  intent: OpIntent;
  op: string | null; // null 表示该 intent 因池为空等原因被跳过，未产生调用
  args: unknown;
  result: Result<unknown> | null;
}

interface MutablePool {
  entities: Id[];
  items: Id[];
  nodes: Id[];
  links: Id[];
  containers: Id[];
  attachments: Id[];
  agents: Id[];
  decisions: Id[];
  intents: Id[];
  prefabHandles: PrefabHandle[];
}

function emptyPool(): MutablePool {
  return { entities: [], items: [], nodes: [], links: [], containers: [], attachments: [], agents: [], decisions: [], intents: [], prefabHandles: [] };
}

let danglingCounter = 0;
function danglingId(prefix: string): Id {
  danglingCounter++;
  return `${prefix}:dangling-${danglingCounter}`;
}

function resolve(which: 'existing' | 'dangling', pool: Id[], prefix: string): Id | null {
  if (which === 'dangling' || pool.length === 0) return danglingId(prefix);
  return pool[Math.floor(Math.random() * pool.length)] as Id;
}

function pushUnique(pool: Id[], id: Id): void {
  if (!pool.includes(id)) pool.push(id);
}

function removeFromAll(pool: MutablePool, id: Id): void {
  for (const key of ['entities', 'items', 'nodes', 'links', 'containers', 'attachments', 'agents', 'decisions', 'intents'] as const) {
    const idx = pool[key].indexOf(id);
    if (idx !== -1) pool[key].splice(idx, 1);
  }
}

/**
 * 执行一整条 OpIntent 序列，返回每一步的日志。执行过程中任何异常都会被捕获并记录为一条
 * 特殊的失败步骤（本身就是一次断言失败——Op 永不应该抛出未捕获异常，需求16.2-16.3）。
 */
export function runOpSequence(harness: FullHarness, intents: OpIntent[]): StepLog[] {
  const pool = emptyPool();
  const logs: StepLog[] = [];

  for (const intent of intents) {
    let op: string | null = null;
    let args: unknown = null;

    switch (intent.kind) {
      case 'entityCreate':
        op = 'entity.create';
        args = { def: intent.def };
        break;
      case 'entityDestroy': {
        const id = resolve(intent.which, pool.entities, 'e');
        op = 'entity.destroy';
        args = { id };
        break;
      }
      case 'entityPlace': {
        const entityId = resolve(intent.which, pool.entities, 'e');
        const nodeId = resolve(intent.nodeWhich, pool.nodes, 'n');
        op = 'entity.place';
        args = { entityId, nodeId };
        break;
      }
      case 'itemCreate':
        op = 'item.create';
        args = { def: intent.def, stack: intent.stack, stackMax: intent.stackMax };
        break;
      case 'itemDestroy': {
        const id = resolve(intent.which, pool.items, 'i');
        op = 'item.destroy';
        args = { id };
        break;
      }
      case 'itemMove': {
        const itemId = resolve(intent.itemWhich, pool.items, 'i');
        const toContainerId = resolve(intent.containerWhich, pool.containers, 'c');
        op = 'item.move';
        args = { itemId, toContainerId, atSlot: intent.atSlot };
        break;
      }
      case 'itemPromote': {
        const itemId = resolve(intent.itemWhich, pool.items, 'i');
        const nodeId = resolve(intent.nodeWhich, pool.nodes, 'n');
        op = 'item.promote';
        args = { itemId, nodeId };
        break;
      }
      case 'entityDemote': {
        const entityId = resolve(intent.entityWhich, pool.entities, 'e');
        const toContainerId = resolve(intent.containerWhich, pool.containers, 'c');
        op = 'entity.demote';
        args = { entityId, toContainerId };
        break;
      }
      case 'nodeCreate':
        op = 'node.create';
        args = { def: intent.def, weight: intent.weight };
        break;
      case 'nodeDestroy': {
        const id = resolve(intent.which, pool.nodes, 'n');
        op = 'node.destroy';
        args = { id };
        break;
      }
      case 'linkCreate': {
        const a = resolve(intent.aWhich, pool.nodes, 'n');
        const b = resolve(intent.bWhich, pool.nodes, 'n');
        op = 'link.create';
        args = { a, b, def: intent.def };
        break;
      }
      case 'linkDestroy': {
        const id = resolve(intent.which, pool.links, 'l');
        op = 'link.destroy';
        args = { id };
        break;
      }
      case 'slotAdd': {
        const containerId = resolve(intent.containerWhich, pool.containers, 'c');
        op = 'slot.add';
        args = { containerId };
        break;
      }
      case 'slotDel': {
        const containerId = resolve(intent.containerWhich, pool.containers, 'c');
        op = 'slot.del';
        args = { containerId, index: intent.index };
        break;
      }
      case 'stackSplit': {
        const id = resolve(intent.itemWhich, pool.items, 'i');
        const toContainerId = resolve(intent.containerWhich, pool.containers, 'c');
        op = 'stack.split';
        args = { id, n: intent.n, toContainerId };
        break;
      }
      case 'stackMerge': {
        const fromId = resolve(intent.fromWhich, pool.items, 'i');
        const intoId = resolve(intent.intoWhich, pool.items, 'i');
        op = 'stack.merge';
        args = { fromId, intoId };
        break;
      }
      case 'relationSet': {
        const from = resolve(intent.fromWhich, pool.entities, 'e');
        const to = resolve(intent.toWhich, pool.entities, 'e');
        op = 'relation.set';
        args = { from, to, kind: intent.relKind };
        break;
      }
      case 'relationDel': {
        const from = resolve(intent.fromWhich, pool.entities, 'e');
        const to = resolve(intent.toWhich, pool.entities, 'e');
        op = 'relation.del';
        args = { from, to, kind: intent.relKind };
        break;
      }
      case 'entitySetDef': {
        const id = resolve(intent.which, pool.entities, 'e');
        op = 'entity.setDef';
        args = { id, def: intent.def, carry: intent.carry };
        break;
      }
      case 'nodeMerge': {
        const keep = resolve(intent.keepWhich, pool.nodes, 'n');
        const absorb = resolve(intent.absorbWhich, pool.nodes, 'n');
        op = 'node.merge';
        args = { keep, absorb, carry: intent.carry };
        break;
      }
      case 'propSet': {
        const collectionPool = pool[intent.collection];
        const id = resolve(intent.targetWhich, collectionPool, intent.collection[0] as string);
        op = 'prop.set';
        args = { path: `${intent.collection}.${id}.props.${intent.field}`, value: intent.value };
        break;
      }
      case 'propAdd': {
        const collectionPool = pool[intent.collection];
        const id = resolve(intent.targetWhich, collectionPool, intent.collection[0] as string);
        op = 'prop.add';
        args = { path: `${intent.collection}.${id}.props.${intent.field}`, delta: intent.delta };
        break;
      }
      case 'tagAdd': {
        const collectionPool = pool[intent.collection];
        const id = resolve(intent.targetWhich, collectionPool, intent.collection[0] as string);
        op = 'tag.add';
        args = { ref: { collection: intent.collection, id }, tag: intent.tag };
        break;
      }
      case 'agentCreate':
        op = 'agent.create';
        args = { kind: intent.agentKind, knowledgeScope: 'k:default' };
        break;
      case 'agentBind': {
        const agentId = resolve(intent.agentWhich, pool.agents, 'a');
        const entityId = resolve(intent.entityWhich, pool.entities, 'e');
        op = 'agent.bind';
        args = { agentId, entityRef: { $: entityId } };
        break;
      }
      case 'agentUnbind': {
        const agentId = resolve(intent.agentWhich, pool.agents, 'a');
        const entityId = resolve(intent.entityWhich, pool.entities, 'e');
        op = 'agent.unbind';
        args = { agentId, entityRef: { $: entityId } };
        break;
      }
      case 'attachAdd': {
        const target =
          intent.targetWhich === 'world' ? 'w:0' : resolve(intent.targetWhich, pool.entities, 'e');
        op = 'attach.add';
        args = { def: intent.def, target: { $: target } };
        break;
      }
      case 'attachDel': {
        const id = resolve(intent.which, pool.attachments, 'a');
        op = 'attach.del';
        args = { id };
        break;
      }
      case 'decisionOpen': {
        const askees = Array.from({ length: intent.askeeCount }, (_, i) => ({ $: `agent-fuzz-${i}` }));
        op = 'decision.open';
        args = { def: intent.def, askees, ctx: {} };
        break;
      }
      case 'decisionAnswer': {
        const id = resolve(intent.which, pool.decisions, 'g');
        op = 'decision.answer';
        args = { id, actor: { $: 'agent-fuzz-0' }, choice: intent.choice };
        break;
      }
      case 'intentSubmit': {
        const agentId = resolve(intent.agentWhich, pool.entities, 'e');
        op = 'intent.submit';
        args = { action: intent.def, agent: agentId, bindings: {}, hidden: intent.hidden };
        break;
      }
      case 'intentResolve': {
        const id = resolve(intent.which, pool.intents, 'g');
        op = 'intent.resolve';
        args = { id };
        break;
      }
      case 'intentVoid': {
        const id = resolve(intent.which, pool.intents, 'g');
        op = 'intent.void';
        args = { id, reason: 'fuzz' };
        break;
      }
      case 'prefabSpawn': {
        const attachTo =
          intent.attachToWhich === 'none' ? undefined : resolve(intent.attachToWhich, pool.nodes, 'n');
        op = 'prefab.spawn';
        args = { def: intent.def, attachTo };
        break;
      }
      case 'prefabDespawn': {
        if (pool.prefabHandles.length === 0) {
          logs.push({ intent, op: null, args: null, result: null });
          continue;
        }
        const handle = pool.prefabHandles[Math.floor(Math.random() * pool.prefabHandles.length)] as PrefabHandle;
        op = 'prefab.despawn';
        args = { handle };
        break;
      }
      case 'outcomeReach': {
        const scope = resolve(intent.scope, pool.entities, 'e');
        op = 'outcome.reach';
        args = { outcomeName: intent.outcomeName, scope: { $: scope }, ends: intent.ends };
        break;
      }
      case 'scheduleAdvance':
        op = 'schedule.advance';
        args = {};
        break;
      case 'randomRoll':
        op = 'random.roll';
        args = { sides: intent.sides, stream: intent.stream };
        break;
      case 'randomPickFromPool': {
        const items = [...pool.entities, ...pool.items].slice(0, 10);
        op = 'random.pick';
        args = { items: items.map((id) => ({ $: id })), stream: intent.stream };
        break;
      }
    }

    if (op === null) {
      logs.push({ intent, op: null, args, result: null });
      continue;
    }

    let result: Result<unknown>;
    try {
      result = harness.registry.invoke(op, args);
    } catch (e) {
      // Op 永不应该抛出未捕获异常（需求16.2-16.3）——若走到这里，本身就是一条应该失败的断言。
      logs.push({ intent, op, args, result: { ok: false, code: 'E_OP_INVALID_ARGS', detail: `UNCAUGHT EXCEPTION: ${e instanceof Error ? e.message : String(e)}` } });
      continue;
    }

    logs.push({ intent, op, args, result });

    if (result.ok) {
      const value = result.value as { $?: string } | string[] | PrefabHandle | undefined;
      switch (intent.kind) {
        case 'entityCreate':
          if (value && typeof value === 'object' && '$' in value && value.$) pushUnique(pool.entities, value.$);
          break;
        case 'itemCreate':
          if (value && typeof value === 'object' && '$' in value && value.$) pushUnique(pool.items, value.$);
          break;
        case 'nodeCreate':
          if (value && typeof value === 'object' && '$' in value && value.$) pushUnique(pool.nodes, value.$);
          break;
        case 'linkCreate':
          if (value && typeof value === 'object' && '$' in value && value.$) pushUnique(pool.links, value.$);
          break;
        case 'slotAdd':
          // 槎位本身不是顶层 Ref 类型，不追加进任何池
          break;
        case 'itemPromote':
          if (value && typeof value === 'object' && '$' in value && value.$) pushUnique(pool.entities, value.$);
          if (args && typeof args === 'object' && 'itemId' in args) removeFromAll(pool, (args as { itemId: Id }).itemId);
          break;
        case 'entityDemote':
          if (value && typeof value === 'object' && '$' in value && value.$) pushUnique(pool.items, value.$);
          if (args && typeof args === 'object' && 'entityId' in args) removeFromAll(pool, (args as { entityId: Id }).entityId);
          break;
        case 'stackSplit':
          if (value && typeof value === 'object' && '$' in value && value.$) pushUnique(pool.items, value.$);
          break;
        case 'stackMerge':
          if (args && typeof args === 'object' && 'fromId' in args) removeFromAll(pool, (args as { fromId: Id }).fromId);
          break;
        case 'entityDestroy':
        case 'itemDestroy':
        case 'nodeDestroy':
        case 'linkDestroy':
        case 'attachDel':
          if (args && typeof args === 'object' && 'id' in args) removeFromAll(pool, (args as { id: Id }).id);
          break;
        case 'agentCreate':
          if (value && typeof value === 'object' && '$' in value && value.$) pushUnique(pool.agents, value.$);
          break;
        case 'attachAdd':
          if (value && typeof value === 'object' && '$' in value && value.$) pushUnique(pool.attachments, value.$);
          break;
        case 'decisionOpen':
          if (value && typeof value === 'object' && '$' in value && value.$) pushUnique(pool.decisions, value.$);
          break;
        case 'intentSubmit':
          if (value && typeof value === 'object' && '$' in value && value.$) pushUnique(pool.intents, value.$);
          break;
        case 'intentResolve':
        case 'intentVoid':
          if (args && typeof args === 'object' && 'id' in args) removeFromAll(pool, (args as { id: Id }).id);
          break;
        case 'prefabSpawn':
          if (value && typeof value === 'object' && 'nodes' in value) {
            const handle = value as PrefabHandle;
            for (const n of handle.nodes) pushUnique(pool.nodes, n);
            for (const l of handle.links) pushUnique(pool.links, l);
            for (const e of handle.entities) pushUnique(pool.entities, e);
            pool.prefabHandles.push(handle);
          }
          break;
        case 'prefabDespawn':
          if (args && typeof args === 'object' && 'handle' in args) {
            const handle = (args as { handle: PrefabHandle }).handle;
            for (const n of handle.nodes) removeFromAll(pool, n);
            for (const l of handle.links) removeFromAll(pool, l);
            for (const e of handle.entities) removeFromAll(pool, e);
            const idx = pool.prefabHandles.indexOf(handle);
            if (idx !== -1) pool.prefabHandles.splice(idx, 1);
          }
          break;
      }
    }
  }

  return logs;
}

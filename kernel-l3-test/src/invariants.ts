/** Sixteen independent L3 invariant checks. */
import type { Id, World, WorldSnapshot } from './world.js';
import type { Violation } from './transaction.js';

export interface InvariantContext {
  baseline?: WorldSnapshot;
  now?: number;
}

export type CheckFn = (world: World, context?: InvariantContext) => Violation[];

const violation = (code: string, detail: string): Violation => ({ code, detail });

function allSlots(world: World) {
  return [...world.containers.values()].flatMap((container) =>
    container.slots.filter((slot): slot is NonNullable<typeof slot> => slot !== null),
  );
}

function targetExists(world: World, id: Id): boolean {
  return world.entities.has(id) || world.items.has(id) || world.nodes.has(id) || world.links.has(id);
}

/** INV-1: every stored reference resolves. */
export const checkINV_1_ReferenceIntegrity: CheckFn = (world) => {
  const result: Violation[] = [];
  const slots = new Set(allSlots(world).map((slot) => slot.id));
  for (const entity of world.entities.values()) {
    if (entity.node && !world.nodes.has(entity.node)) result.push(violation('E_INV_DANGLING', `Entity ${entity.id} -> node ${entity.node}`));
    if (entity.slot && !slots.has(entity.slot)) result.push(violation('E_INV_DANGLING', `Entity ${entity.id} -> slot ${entity.slot}`));
    for (const containerId of entity.containers.values()) {
      if (!world.containers.has(containerId)) result.push(violation('E_INV_DANGLING', `Entity ${entity.id} -> container ${containerId}`));
    }
    for (const [kind, relation] of entity.relations) {
      for (const id of [...relation.out, ...relation.in]) {
        if (!world.entities.has(id)) result.push(violation('E_INV_DANGLING', `Entity ${entity.id} relation ${kind} -> ${id}`));
      }
    }
  }
  for (const item of world.items.values()) {
    if (item.slot && !slots.has(item.slot)) result.push(violation('E_INV_DANGLING', `Item ${item.id} -> slot ${item.slot}`));
    for (const containerId of item.containers.values()) {
      if (!world.containers.has(containerId)) result.push(violation('E_INV_DANGLING', `Item ${item.id} -> container ${containerId}`));
    }
  }
  for (const slot of allSlots(world)) {
    if (slot.holds && !targetExists(world, slot.holds.id)) result.push(violation('E_INV_DANGLING', `Slot ${slot.id} -> ${slot.holds.id}`));
  }
  return result;
};

/** INV-2: an object is held by at most one slot. */
export const checkINV_2_SingleContainment: CheckFn = (world) => {
  const counts = new Map<Id, number>();
  for (const slot of allSlots(world)) if (slot.holds) counts.set(slot.holds.id, (counts.get(slot.holds.id) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([id, count]) => violation('E_INV_SINGLE_CONTAINMENT', `${id} held by ${count} slots`));
};

/** INV-3: node membership is bidirectionally unique. */
export const checkINV_3_SingleLocation: CheckFn = (world) => {
  const result: Violation[] = [];
  const counts = new Map<Id, number>();
  for (const node of world.nodes.values()) {
    for (const entityId of node.entities) {
      counts.set(entityId, (counts.get(entityId) ?? 0) + 1);
      const entity = world.entities.get(entityId);
      if (!entity || entity.node !== node.id) result.push(violation('E_INV_SINGLE_LOCATION', `Node ${node.id} membership ${entityId} is not mirrored`));
    }
  }
  for (const entity of world.entities.values()) {
    if (entity.node && !world.nodes.get(entity.node)?.entities.has(entity.id)) result.push(violation('E_INV_SINGLE_LOCATION', `Entity ${entity.id} node ${entity.node} is not mirrored`));
  }
  for (const [id, count] of counts) if (count > 1) result.push(violation('E_INV_SINGLE_LOCATION', `Entity ${id} belongs to ${count} nodes`));
  return result;
};

/** INV-4: entity.node and entity.slot are mutually exclusive. */
export const checkINV_4_LocationMutex: CheckFn = (world) =>
  [...world.entities.values()]
    .filter((entity) => entity.node !== undefined && entity.slot !== undefined)
    .map((entity) => violation('E_INV_LOCATION_EXCLUSIVE', `Entity ${entity.id} has node and slot`));

/** INV-5: owned-container containment graph is acyclic. */
export const checkINV_5_NoContainmentCycle: CheckFn = (world) => {
  const children = new Map<Id, Id[]>();
  for (const container of world.containers.values()) {
    if (!container.owner) continue;
    const held = container.slots.flatMap((slot) => (slot?.holds ? [slot.holds.id] : []));
    children.set(container.owner, [...(children.get(container.owner) ?? []), ...held]);
  }
  const result: Violation[] = [];
  const visiting = new Set<Id>();
  const visited = new Set<Id>();
  const visit = (id: Id): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const child of children.get(id) ?? []) if (visit(child)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of children.keys()) {
    if (visit(id)) {
      result.push(violation('E_INV_CONTAINMENT_CYCLE', `Containment cycle reaches ${id}`));
      break;
    }
  }
  return result;
};

/** INV-6: every link endpoint exists and node degree never exceeds five. */
export const checkINV_6_TopologyConsistency: CheckFn = (world) => {
  const result: Violation[] = [];
  const degrees = new Map<Id, number>();
  for (const link of world.links.values()) {
    if (!world.nodes.has(link.a)) result.push(violation('E_INV_TOPOLOGY_CONSISTENCY', `Link ${link.id}.a=${link.a}`));
    if (!world.nodes.has(link.b)) result.push(violation('E_INV_TOPOLOGY_CONSISTENCY', `Link ${link.id}.b=${link.b}`));
    if (world.nodes.has(link.a)) degrees.set(link.a, (degrees.get(link.a) ?? 0) + 1);
    if (world.nodes.has(link.b)) degrees.set(link.b, (degrees.get(link.b) ?? 0) + 1);
  }
  for (const [nodeId, degree] of degrees) {
    if (degree > 5) result.push(violation('E_INV_TOPOLOGY_CONSISTENCY', `Node ${nodeId} degree=${degree} exceeds 5`));
  }
  return result;
};

/** INV-7: node parents exist and parent chains are acyclic. */
export const checkINV_7_ParentChild: CheckFn = (world) => {
  const result: Violation[] = [];
  for (const node of world.nodes.values()) {
    if (node.parent && !world.nodes.has(node.parent)) result.push(violation('E_INV_PARENT_CHILD', `Node ${node.id}.parent=${node.parent}`));
    const seen = new Set<Id>([node.id]);
    let cursor = node.parent;
    while (cursor) {
      if (seen.has(cursor)) {
        result.push(violation('E_INV_PARENT_CHILD', `Parent cycle reaches ${cursor}`));
        break;
      }
      seen.add(cursor);
      cursor = world.nodes.get(cursor)?.parent;
    }
  }
  return result;
};

/** INV-8: relation out/in entries mirror one another. */
export const checkINV_8_RelationSymmetry: CheckFn = (world) => {
  const result: Violation[] = [];
  for (const entity of world.entities.values()) {
    for (const [kind, relation] of entity.relations) {
      for (const targetId of relation.out) {
        if (!world.entities.get(targetId)?.relations.get(kind)?.in.has(entity.id)) result.push(violation('E_INV_RELATION_SYMMETRY', `${entity.id} -${kind}-> ${targetId}`));
      }
      for (const sourceId of relation.in) {
        if (!world.entities.get(sourceId)?.relations.get(kind)?.out.has(entity.id)) result.push(violation('E_INV_RELATION_SYMMETRY', `${sourceId} -${kind}-> ${entity.id}`));
      }
    }
  }
  return result;
};

/** INV-9: container owner and owner index point to each other. */
export const checkINV_9_ContainerBidirectional: CheckFn = (world) => {
  const result: Violation[] = [];
  for (const container of world.containers.values()) {
    if (!container.owner || !container.name) continue;
    const owner = world.entities.get(container.owner) ?? world.items.get(container.owner);
    if (!owner || owner.containers.get(container.name) !== container.id) result.push(violation('E_INV_CONTAINER_BIDIRECTIONAL', `Container ${container.id} owner/index mismatch`));
  }
  return result;
};

/** INV-10: shift containers have no null holes. */
export const checkINV_10_SlotIndexContinuity: CheckFn = (world) =>
  [...world.containers.values()].flatMap((container) =>
    container.insert === 'shift' && container.slots.some((slot) => slot === null)
      ? [violation('E_INV_SLOT_INDEX_CONTINUITY', `Container ${container.id} has a hole`)]
      : [],
  );

function itemCounts(items: Map<Id, { def: Id; stack: number }>): Map<Id, number> {
  const counts = new Map<Id, number>();
  for (const item of items.values()) counts.set(item.def, (counts.get(item.def) ?? 0) + item.stack);
  return counts;
}

/** INV-11: when a baseline is supplied, total stack per Def is conserved. */
export const checkINV_11_StackConservation: CheckFn = (world, context) => {
  if (!context?.baseline) return [];
  const before = itemCounts(context.baseline.items);
  const after = itemCounts(world.items);
  const defs = new Set([...before.keys(), ...after.keys()]);
  return [...defs].flatMap((def) =>
    (before.get(def) ?? 0) !== (after.get(def) ?? 0)
      ? [violation('E_INV_STACK_LEAK', `${def}: before=${before.get(def) ?? 0}, after=${after.get(def) ?? 0}`)]
      : [],
  );
};

/** INV-12: no unresolved reservation survives outer commit. */
export const checkINV_12_CostConservation: CheckFn = (world) =>
  [...world.entities.values()].flatMap((entity) =>
    entity.frozenResources.size > 0
      ? [violation('E_COST_LEAK', `Entity ${entity.id} has ${entity.frozenResources.size} frozen resource(s)`)]
      : [],
  );

/** INV-13: attachment targets and grant parents exist. */
export const checkINV_13_AttachmentConsistency: CheckFn = (world) =>
  [...world.attachments.values()].flatMap((attachment) => [
    ...(!targetExists(world, attachment.target) ? [violation('E_INV_ATTACHMENT_CONSISTENCY', `Attachment ${attachment.id}.target=${attachment.target}`)] : []),
    ...(attachment.grantedBy && !world.attachments.has(attachment.grantedBy) ? [violation('E_INV_ATTACHMENT_CONSISTENCY', `Attachment ${attachment.id}.grantedBy=${attachment.grantedBy}`)] : []),
  ]);

/** INV-14: every item stack is an integer in [1, stackMax]. */
export const checkINV_14_StackBounded: CheckFn = (world) =>
  [...world.items.values()].flatMap((item) => {
    const max = world.getDef(item.def)?.stackMax;
    return !Number.isInteger(item.stack) || item.stack < 1 || max === undefined || item.stack > max
      ? [violation('E_INV_STACK_BOUNDED', `Item ${item.id}: stack=${item.stack}, max=${String(max)}`)]
      : [];
  });

/** INV-15: expired open decisions must be resolved by commit time. */
export const checkINV_15_DecisionTermination: CheckFn = (world, context) => {
  const now = context?.now ?? Date.now();
  return [...world.decisions.values()].flatMap((decision) =>
    decision.status === 'open' && decision.deadline !== undefined && decision.deadline <= now
      ? [violation('E_INV_DECISION_TERMINATION', `Decision ${decision.id} expired at ${decision.deadline}`)]
      : [],
  );
};

/** INV-16: all runtime numbers are finite. */
export const checkINV_16_NumericBounded: CheckFn = (world) => {
  const result: Violation[] = [];
  for (const item of world.items.values()) if (!Number.isFinite(item.stack)) result.push(violation('E_INV_NAN_OR_INFINITY', `Item ${item.id}.stack`));
  for (const entity of world.entities.values()) {
    for (const [key, value] of Object.entries(entity.attr)) if (!Number.isFinite(value)) result.push(violation('E_INV_NAN_OR_INFINITY', `Entity ${entity.id}.attr.${key}`));
    for (const [key, value] of entity.frozenResources) if (!Number.isFinite(value)) result.push(violation('E_INV_NAN_OR_INFINITY', `Entity ${entity.id}.frozen.${key}`));
  }
  return result;
};

export const ALL_INVARIANT_CHECKS: readonly CheckFn[] = [
  checkINV_1_ReferenceIntegrity,
  checkINV_2_SingleContainment,
  checkINV_3_SingleLocation,
  checkINV_4_LocationMutex,
  checkINV_5_NoContainmentCycle,
  checkINV_6_TopologyConsistency,
  checkINV_7_ParentChild,
  checkINV_8_RelationSymmetry,
  checkINV_9_ContainerBidirectional,
  checkINV_10_SlotIndexContinuity,
  checkINV_11_StackConservation,
  checkINV_12_CostConservation,
  checkINV_13_AttachmentConsistency,
  checkINV_14_StackBounded,
  checkINV_15_DecisionTermination,
  checkINV_16_NumericBounded,
];

export function checkAllInvariants(world: World, context?: InvariantContext): Violation[] {
  return ALL_INVARIANT_CHECKS.flatMap((check) => check(world, context));
}

export class InvariantChecker {
  checkAll(world: World, context?: InvariantContext): Violation[] {
    return checkAllInvariants(world, context);
  }
}

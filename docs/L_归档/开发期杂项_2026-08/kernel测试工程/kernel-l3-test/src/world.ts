/** L3 runtime state and lossless transaction snapshots. */
export type Id = string;
export type Ref = { $: Id };

export interface ItemDef {
  id: Id;
  stackMax: number;
}

export interface RelationSlice {
  out: Set<Id>;
  in: Set<Id>;
}

export interface Entity {
  id: Id;
  def: Id;
  attr: Record<string, number>;
  node?: Id;
  slot?: Id;
  containers: Map<string, Id>;
  relations: Map<string, RelationSlice>;
  frozenResources: Map<string, number>;
}

export interface Item {
  id: Id;
  def: Id;
  stack: number;
  slot?: Id;
  containers: Map<string, Id>;
}

export interface Slot {
  id: Id;
  holds: Item | Entity | null;
  /** Empty means accept all; otherwise accepted Def ids. */
  accepts?: Set<Id>;
}

export interface Container {
  id: Id;
  owner?: Id;
  name?: string;
  insert: 'fixed' | 'shift';
  slots: Array<Slot | null>;
}

export interface Node {
  id: Id;
  parent?: Id;
  entities: Set<Id>;
}

export interface Link {
  id: Id;
  a: Id;
  b: Id;
}

export interface Attachment {
  id: Id;
  target: Id;
  grantedBy?: Id;
}

export interface Decision {
  id: Id;
  status: 'open' | 'resolved' | 'timeout' | 'void';
  deadline?: number;
}

export interface WorldSnapshot {
  items: Map<Id, Item>;
  entities: Map<Id, Entity>;
  containers: Map<Id, Container>;
  nodes: Map<Id, Node>;
  links: Map<Id, Link>;
  defs: Map<Id, ItemDef>;
  attachments: Map<Id, Attachment>;
  decisions: Map<Id, Decision>;
  nextId: number;
}

export class World {
  items = new Map<Id, Item>();
  entities = new Map<Id, Entity>();
  containers = new Map<Id, Container>();
  nodes = new Map<Id, Node>();
  links = new Map<Id, Link>();
  defs = new Map<Id, ItemDef>();
  attachments = new Map<Id, Attachment>();
  decisions = new Map<Id, Decision>();
  private nextIdValue = 0;

  nextId(prefix = 'id'): Id {
    return `${prefix}-${this.nextIdValue++}`;
  }

  registerDef(def: ItemDef): void {
    if (!Number.isInteger(def.stackMax) || def.stackMax < 1 || def.stackMax > 5) {
      throw new Error(`Invalid stackMax for ${def.id}: ${def.stackMax}; expected an integer in [1, 5]`);
    }
    this.defs.set(def.id, { ...def });
  }

  getDef(id: Id): ItemDef | null {
    return this.defs.get(id) ?? null;
  }

  createItem(input: { def: Id; stack: number } | Id, stackArg?: number): Item {
    const def = typeof input === 'string' ? input : input.def;
    const stack = typeof input === 'string' ? stackArg : input.stack;
    if (stack === undefined) throw new Error('Item stack is required');
    const item: Item = { id: this.nextId('item'), def, stack, containers: new Map() };
    this.items.set(item.id, item);
    return item;
  }

  destroyItem(itemOrId: Item | Id): void {
    const id = typeof itemOrId === 'string' ? itemOrId : itemOrId.id;
    this.items.delete(id);
    for (const container of this.containers.values()) {
      for (const slot of container.slots) {
        if (slot?.holds?.id === id) slot.holds = null;
      }
    }
  }

  createEntity(input: { def?: Id; attr?: Record<string, number> } | Id = 'entity', attrArg: Record<string, number> = {}): Entity {
    const def = typeof input === 'string' ? input : input.def ?? 'entity';
    const attr = typeof input === 'string' ? attrArg : input.attr ?? {};
    const entity: Entity = {
      id: this.nextId('entity'),
      def,
      attr: { ...attr },
      containers: new Map(),
      relations: new Map(),
      frozenResources: new Map(),
    };
    this.entities.set(entity.id, entity);
    return entity;
  }

  createContainer(options: { owner?: Id; name?: string; insert?: 'fixed' | 'shift'; slots?: number } | number = 1): Container {
    const normalized = typeof options === 'number' ? { slots: options } : options;
    const id = this.nextId('container');
    const slots: Slot[] = Array.from({ length: normalized.slots ?? 1 }, (_, index) => ({
      id: `${id}:slot-${index}`,
      holds: null,
    }));
    const container: Container = {
      id,
      owner: normalized.owner,
      name: normalized.name,
      insert: normalized.insert ?? 'fixed',
      slots,
    };
    this.containers.set(id, container);
    if (normalized.owner && normalized.name) {
      const owner = this.entities.get(normalized.owner) ?? this.items.get(normalized.owner);
      owner?.containers.set(normalized.name, id);
    }
    return container;
  }

  createNode(parent?: Id): Node {
    const node: Node = { id: this.nextId('node'), parent, entities: new Set() };
    this.nodes.set(node.id, node);
    return node;
  }

  createLink(a: Id, b: Id): Link {
    const link: Link = { id: this.nextId('link'), a, b };
    this.links.set(link.id, link);
    return link;
  }

  findSlot(slotId: Id): Slot | null {
    for (const container of this.containers.values()) {
      const slot = container.slots.find((candidate) => candidate?.id === slotId);
      if (slot) return slot;
    }
    return null;
  }

  findEmptySlot(container: Container): Slot | null {
    return container.slots.find((slot): slot is Slot => slot !== null && slot.holds === null) ?? null;
  }

  snapshot(): WorldSnapshot {
    return structuredClone({
      items: this.items,
      entities: this.entities,
      containers: this.containers,
      nodes: this.nodes,
      links: this.links,
      defs: this.defs,
      attachments: this.attachments,
      decisions: this.decisions,
      nextId: this.nextIdValue,
    });
  }

  restore(snapshot: WorldSnapshot): void {
    const copy = structuredClone(snapshot);
    this.items = copy.items;
    this.entities = copy.entities;
    this.containers = copy.containers;
    this.nodes = copy.nodes;
    this.links = copy.links;
    this.defs = copy.defs;
    this.attachments = copy.attachments;
    this.decisions = copy.decisions;
    this.nextIdValue = copy.nextId;

    // structuredClone preserves values but not canonical identity across Map entries.
    for (const container of this.containers.values()) {
      for (const slot of container.slots) {
        if (slot?.holds) {
          slot.holds = this.items.get(slot.holds.id) ?? this.entities.get(slot.holds.id) ?? null;
        }
      }
    }
  }
}

export type Result<T> = { ok: true; value: T } | { ok: false; code: string; detail: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T>(code: string, detail: string): Result<T> {
  return { ok: false, code, detail };
}

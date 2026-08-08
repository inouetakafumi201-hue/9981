export type EntityId = string;
export type CompType = string;

export interface Component {
  type: CompType;
  data: Record<string, number | string | boolean | null>;
}

export class EcsWorld {
  private entities: Set<EntityId> = new Set();
  private destroyed: Set<EntityId> = new Set();       // 已销毁ID墓碑，防止复用
  private comps: Map<EntityId, Map<CompType, Component>> = new Map();
  private byType: Map<CompType, Set<EntityId>> = new Map();  // 反向索引
  private nextId = 0;

  // —— Entity 原语 ——
  entity_create(explicitId?: EntityId): EntityId {
    const id = explicitId ?? `e${this.nextId++}`;
    if (this.entities.has(id)) throw new Error('E_ENT_DUPLICATE_ID');
    if (this.destroyed.has(id)) throw new Error('E_ENT_ID_REUSE');
    this.entities.add(id);
    this.comps.set(id, new Map());
    return id;
  }

  entity_destroy(id: EntityId): void {
    if (!this.entities.has(id)) throw new Error('E_REF_INVALID');

    // 清理所有Component + 反向索引（不能有孤儿）
    const bag = this.comps.get(id);
    if (bag) {
      for (const type of [...bag.keys()]) {
        this.byType.get(type)?.delete(id);
        if (this.byType.get(type)?.size === 0) this.byType.delete(type);
      }
    }
    this.comps.delete(id);
    this.entities.delete(id);
    this.destroyed.add(id);
  }

  entity_exists(id: EntityId): boolean { return this.entities.has(id); }

  // —— Component 原语 ——
  comp_add(id: EntityId, type: CompType, data: Component['data'] = {}): void {
    if (!this.entities.has(id)) throw new Error('E_REF_INVALID');
    if (!type || type.length === 0) throw new Error('E_COMP_INVALID_TYPE');

    const bag = this.comps.get(id)!;
    if (bag.has(type)) throw new Error('E_COMP_DUPLICATE');

    // 深拷贝：Component是纯数据，外部引用不得影响世界状态
    bag.set(type, { type, data: { ...data } });

    let set = this.byType.get(type);
    if (!set) { set = new Set(); this.byType.set(type, set); }
    set.add(id);
  }

  comp_del(id: EntityId, type: CompType): void {
    if (!this.entities.has(id)) throw new Error('E_REF_INVALID');
    const bag = this.comps.get(id)!;
    if (!bag.has(type)) return;  // 幂等：删不存在的Component不报错

    bag.delete(type);
    const set = this.byType.get(type);
    set?.delete(id);
    if (set && set.size === 0) this.byType.delete(type);
  }

  comp_get(id: EntityId, type: CompType): Component | undefined {
    if (!this.entities.has(id)) throw new Error('E_REF_INVALID');
    const c = this.comps.get(id)!.get(type);
    if (!c) return undefined;
    return { type: c.type, data: { ...c.data } };  // 返回拷贝，防止外部改写
  }

  comp_set(id: EntityId, type: CompType, key: string, value: number | string | boolean | null): void {
    if (!this.entities.has(id)) throw new Error('E_REF_INVALID');
    const c = this.comps.get(id)!.get(type);
    if (!c) throw new Error('E_COMP_NOT_FOUND');
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('E_COMP_NON_FINITE');   // INV-16
    }
    c.data[key] = value;
  }

  comp_has(id: EntityId, type: CompType): boolean {
    if (!this.entities.has(id)) return false;
    return this.comps.get(id)!.has(type);
  }

  query_byType(type: CompType): EntityId[] {
    return [...(this.byType.get(type) ?? [])].sort();  // 确定性顺序
  }

  // —— 不变量检查 ——
  checkInvariants(): string[] {
    const v: string[] = [];

    // ECS-1: comps的每个key都必须是存活Entity
    for (const id of this.comps.keys()) {
      if (!this.entities.has(id)) v.push(`ORPHAN_COMP_BAG:${id}`);
    }

    // ECS-2: 每个存活Entity都必须有一个comp bag（哪怕是空的）
    for (const id of this.entities) {
      if (!this.comps.has(id)) v.push(`MISSING_COMP_BAG:${id}`);
    }

    // ECS-3: 反向索引与正向存储双向一致
    for (const [type, ids] of this.byType) {
      if (ids.size === 0) v.push(`EMPTY_TYPE_INDEX:${type}`);
      for (const id of ids) {
        if (!this.entities.has(id)) { v.push(`INDEX_DANGLING:${type}->${id}`); continue; }
        if (!this.comps.get(id)!.has(type)) v.push(`INDEX_ORPHAN:${type}->${id}`);
      }
    }
    for (const [id, bag] of this.comps) {
      for (const type of bag.keys()) {
        if (!this.byType.get(type)?.has(id)) v.push(`MISSING_INDEX:${id}->${type}`);
      }
    }

    // ECS-4: Component的type字段与其存储key一致
    for (const [id, bag] of this.comps) {
      for (const [key, comp] of bag) {
        if (comp.type !== key) v.push(`TYPE_MISMATCH:${id} key=${key} type=${comp.type}`);
      }
    }

    // ECS-5: 存活Entity与墓碑不相交
    for (const id of this.entities) {
      if (this.destroyed.has(id)) v.push(`ALIVE_AND_DESTROYED:${id}`);
    }

    // ECS-6 (INV-16): 所有数值必须有限
    for (const [id, bag] of this.comps) {
      for (const comp of bag.values()) {
        for (const [k, val] of Object.entries(comp.data)) {
          if (typeof val === 'number' && !Number.isFinite(val)) {
            v.push(`NON_FINITE:${id}.${comp.type}.${k}=${val}`);
          }
        }
      }
    }

    return v;
  }

  get entityCount() { return this.entities.size; }
}

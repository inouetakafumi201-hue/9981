/**
 * L8 影子模型：Relation / Attachment 的独立重写。
 *
 * 与产品的**算法不同**，这是判据有效性的前提：
 * 产品**增量维护**双向索引（每次 add/del 就地改索引数组）；
 * 模型只维护主表，索引在对照时**从主表重新推导**。
 * 于是"增量维护出错"这件事成为可观测事件——若模型也增量维护，
 * 两边会以同样的方式出错，对照恒真。
 *
 * 模型不引用 src 下任何代码。
 */

/** 与产品 DumpShape 同形，但由模型独立算出。 */
export interface ModelDump {
  entities: string[];
  relations: Record<string, { type: string; from: string; to: string; attrs: Record<string, unknown> }>;
  attachments: Record<string, {
    type: string; target: string; grantedBy: string; deps: string[]; effectCount: number;
  }>;
  index: Record<string, {
    out: Record<string, string[]>;
    in: Record<string, string[]>;
    attachments: string[];
  }>;
}

export interface RelRec { type: string; from: string; to: string; attrs: Record<string, unknown> }
export interface AttRec {
  type: string; target: string; grantedBy: string; deps: string[]; effectCount: number;
}

/**
 * 模型状态。
 *
 * relations/attachments 用 Map 而非普通对象：Map 的迭代顺序是插入顺序，
 * 且 `delete` 后重新 `set` 会把该键移到末尾——这恰好与产品
 * "同 id 重复 add 时先 del 再 push" 的顺序语义一致。
 * 用普通对象会丢掉这层顺序信息，而顺序经由 `get()` 对外可见。
 */
export class RelationModel {
  readonly entities = new Set<string>();
  readonly relations = new Map<string, RelRec>();
  readonly attachments = new Map<string, AttRec>();

  createEntity(id: string): void {
    if (this.entities.has(id)) throw new Error('E_ENTITY_EXISTS');
    this.entities.add(id);
  }

  destroyEntity(id: string): void {
    if (!this.entities.has(id)) throw new Error('E_REF_INVALID');

    // 端点落在该实体上的 relation 全删
    for (const [rid, r] of [...this.relations]) {
      if (r.from === id || r.to === id) this.relations.delete(rid);
    }

    // attachment 三条级联：target / grantedBy / deps 任一命中即删
    for (const [aid, a] of [...this.attachments]) {
      if (a.target === id || a.grantedBy === id || a.deps.includes(id)) {
        this.attachments.delete(aid);
      }
    }

    this.entities.delete(id);
  }

  relationAdd(id: string, type: string, from: string, to: string, attrs: Record<string, unknown>): void {
    if (!this.entities.has(from)) throw new Error('E_REF_INVALID');
    if (!this.entities.has(to)) throw new Error('E_REF_INVALID');
    // 同 id 覆盖：先删再插，使该 id 移到插入序末尾
    this.relations.delete(id);
    this.relations.set(id, { type, from, to, attrs: { ...attrs } });
  }

  relationDel(id: string): void {
    this.relations.delete(id); // 幂等
  }

  attachmentAdd(a: {
    id: string; type: string; target: string; grantedBy: string; deps: string[]; effectCount: number;
  }): void {
    if (!this.entities.has(a.target)) throw new Error('E_REF_INVALID');
    if (!this.entities.has(a.grantedBy)) throw new Error('E_REF_INVALID');
    for (const d of a.deps) if (!this.entities.has(d)) throw new Error('E_REF_INVALID');
    this.attachments.delete(a.id);
    this.attachments.set(a.id, {
      type: a.type, target: a.target, grantedBy: a.grantedBy,
      deps: [...a.deps], effectCount: a.effectCount,
    });
  }

  attachmentDel(id: string): void {
    this.attachments.delete(id);
  }

  /**
   * 从主表**重新推导**索引。
   *
   * 这是模型的全部价值所在：产品的索引是一路增量改出来的，
   * 模型的索引是当场从 relations/attachments 扫出来的。
   * 两者相等，才说明增量维护没有漏改、错改、重复改。
   */
  dump(): ModelDump {
    const entities = [...this.entities].sort();

    const relations: ModelDump['relations'] = {};
    for (const [id, r] of this.relations) {
      relations[id] = { type: r.type, from: r.from, to: r.to, attrs: { ...r.attrs } };
    }

    const attachments: ModelDump['attachments'] = {};
    for (const [id, a] of this.attachments) {
      attachments[id] = {
        type: a.type, target: a.target, grantedBy: a.grantedBy,
        deps: [...a.deps], effectCount: a.effectCount,
      };
    }

    const index: ModelDump['index'] = {};
    for (const e of entities) {
      const out: Record<string, string[]> = {};
      const inn: Record<string, string[]> = {};
      // 按 relations 的插入序扫，桶内顺序即得
      for (const [rid, r] of this.relations) {
        if (r.from === e) (out[r.type] ??= []).push(rid);
        if (r.to === e) (inn[r.type] ??= []).push(rid);
      }
      const atts: string[] = [];
      for (const [aid, a] of this.attachments) if (a.target === e) atts.push(aid);
      index[e] = { out, in: inn, attachments: atts };
    }

    return { entities, relations, attachments, index };
  }
}

/**
 * 递归排序对象键、**保留数组顺序**。
 *
 * 键顺序不可断言：产品索引里 type 键的位置取决于该 type 首次出现的时刻，
 * 空桶被剔除后又重新出现时仍留在原位，这是 Map.set 的行为而非语义。
 * 数组顺序必须断言：它经 `get()` 对外可见，`push`→`unshift` 之类的改动
 * 只有靠它才能被发现。把两者一起排序或一起不排序都是错的。
 */
export function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) out[k] = canonical(o[k]);
    return out;
  }
  return v;
}

export function show(v: unknown): string {
  return JSON.stringify(canonical(v));
}

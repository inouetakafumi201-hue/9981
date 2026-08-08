export interface RelationDef {
  id: string;
  type: string;
  from: string;   // entity ID
  to: string;     // entity ID
  attrs: Record<string, any>;
}

export interface AttachmentDef {
  id: string;
  type: string;
  target: string;         // entity ID
  grantedBy: string;      // item/entity ID that created this attachment
  effects: EffectDef[];
  deps: string[];         // dependency entity IDs — if any dep is destroyed, attachment removed
}

export interface EffectDef {
  op: string;
  args: Record<string, any>;
}

export class RelationSystem {
  private entities: Map<string, EntityStub> = new Map();
  private relations: Map<string, RelationDef> = new Map();
  private attachments: Map<string, AttachmentDef> = new Map();

  // — Entity stubs —
  /**
   * 创建 Entity。
   *
   * 同 id 重建必须拒绝，不能覆盖。覆盖会换掉 EntityStub 实例，
   * 于是旧 stub 上的 rel.out / rel.in 索引连同它一起消失，
   * 而 this.relations 里那些以该 id 为端点的 Relation 仍然存在——
   * 索引与主表就此不一致，且**没有任何一步操作报错**。
   * 这类静默数据破坏对上层是不可恢复的：调用方拿不到"创建失败"的信号，
   * 只会在很久以后发现某些关系查不出来了。
   */
  createEntity(id: string): EntityStub {
    if (this.entities.has(id)) throw new Error('E_ENTITY_EXISTS');
    const e: EntityStub = { id, rel: { out: new Map(), in: new Map() }, attachments: new Set() };
    this.entities.set(id, e);
    // 与 get() 同理：返回内部 stub 等于把索引的写权限交给调用方。
    // 这里尤其隐蔽——创建者天然持有句柄，很容易顺手拿它当"自己的对象"改。
    return cloneEntityStub(e);
  }

  destroyEntity(id: string): void {
    const entity = this.entities.get(id);
    if (!entity) throw new Error('E_REF_INVALID');

    // INV-6: 删除所有以该Entity为端点的Relation
    const relIds = [
      ...Array.from(entity.rel.out.values()).flat(),
      ...Array.from(entity.rel.in.values()).flat()
    ];
    for (const relId of relIds) {
      this.relation_del(relId);
    }

    // INV-13: 删除target为该Entity的Attachment
    for (const attId of [...entity.attachments]) {
      this.attachment_del(attId);
    }

    // INV-13: 若作为grantedBy，也需要级联删除
    for (const att of [...this.attachments.values()]) {
      if (att.grantedBy === id) {
        this.attachment_del(att.id);
      }
    }

    // INV-13: 若作为dep，也需要级联删除持有该dep的Attachment
    this.cascadeOnDepDestroy(id);

    this.entities.delete(id);
  }

  // — Relation —
  relation_add(id: string, type: string, from: string, to: string, attrs: Record<string, any> = {}): RelationDef {
    if (!this.entities.has(from)) throw new Error('E_REF_INVALID');
    if (!this.entities.has(to)) throw new Error('E_REF_INVALID');

    // 避免重复id导致索引与Map不一致：先清理同id旧关系（若存在）
    if (this.relations.has(id)) {
      this.relation_del(id);
    }

    // attrs 必须拷一份：直接存调用方的对象等于把内部状态的一部分
    // 交给调用方继续持有，之后它在外面改 attrs，内部关系就跟着变，
    // 而这条修改不经过任何一次 relation_add，也不触发任何校验。
    const rel: RelationDef = { id, type, from, to, attrs: { ...attrs } };
    this.relations.set(id, rel);

    // INV-8: 双向索引
    const fromEnt = this.entities.get(from)!;
    const toEnt = this.entities.get(to)!;

    const outList = fromEnt.rel.out.get(type) ?? [];
    outList.push(id);
    fromEnt.rel.out.set(type, outList);

    const inList = toEnt.rel.in.get(type) ?? [];
    inList.push(id);
    toEnt.rel.in.set(type, inList);

    // 返回副本：交出内部对象等于把 from/to/type 的写权限一起交出去，
    // 而改 from 会让双向索引与关系体本身失去对应关系。
    return cloneRelation(rel);
  }

  relation_del(id: string): void {
    const rel = this.relations.get(id);
    if (!rel) return; // 幂等

    // 从双向索引中移除
    const fromEnt = this.entities.get(rel.from);
    const toEnt = this.entities.get(rel.to);

    if (fromEnt) {
      const outList = fromEnt.rel.out.get(rel.type) ?? [];
      fromEnt.rel.out.set(rel.type, outList.filter(x => x !== id));
    }
    if (toEnt) {
      const inList = toEnt.rel.in.get(rel.type) ?? [];
      toEnt.rel.in.set(rel.type, inList.filter(x => x !== id));
    }

    this.relations.delete(id);
  }

  // — Attachment —
  attachment_add(def: AttachmentDef): AttachmentDef {
    if (!this.entities.has(def.target)) throw new Error('E_REF_INVALID');
    if (!this.entities.has(def.grantedBy)) throw new Error('E_REF_INVALID');
    for (const dep of def.deps) {
      if (!this.entities.has(dep)) throw new Error('E_REF_INVALID');
    }

    // 避免重复id导致索引与Map不一致：先清理同id旧附属（若存在）
    if (this.attachments.has(def.id)) {
      this.attachment_del(def.id);
    }

    // 深拷贝后入库。原实现直接 set(def.id, def)，内部与调用方共享同一对象：
    // 调用方事后 `def.deps.push('不存在的实体')` 或 `def.target = 别处`
    // 就能绕过全部前置校验把索引改坏——校验过的是入参当时的样子，
    // 不是库里那份。deps/effects 是数组，必须逐层拷，浅拷仍共享。
    const stored = cloneAttachment(def);
    this.attachments.set(stored.id, stored);
    this.entities.get(stored.target)!.attachments.add(stored.id);
    return cloneAttachment(stored);
  }

  attachment_del(id: string): void {
    const att = this.attachments.get(id);
    if (!att) return;

    this.entities.get(att.target)?.attachments.delete(id);
    this.attachments.delete(id);
  }

  // INV-13: dep被销毁时级联删除Attachment
  private cascadeOnDepDestroy(depId: string): void {
    for (const att of [...this.attachments.values()]) {
      if (att.deps.includes(depId)) {
        this.attachment_del(att.id);
      }
    }
  }

  // — 不变量检查 —
  checkInvariants(): Violation[] {
    const violations: Violation[] = [];

    // INV-8: Relation双向索引对称
    for (const rel of this.relations.values()) {
      const fromEnt = this.entities.get(rel.from);
      const toEnt = this.entities.get(rel.to);

      if (!fromEnt) {
        violations.push({ code: 'E_INV_DANGLING', detail: `rel ${rel.id} from=${rel.from} missing` });
        continue;
      }
      if (!toEnt) {
        violations.push({ code: 'E_INV_DANGLING', detail: `rel ${rel.id} to=${rel.to} missing` });
        continue;
      }

      const hasOut = (fromEnt.rel.out.get(rel.type) ?? []).includes(rel.id);
      const hasIn = (toEnt.rel.in.get(rel.type) ?? []).includes(rel.id);

      if (!hasOut) violations.push({ code: 'E_INV_ASYMMETRIC', detail: `rel ${rel.id} missing in out-index` });
      if (!hasIn)  violations.push({ code: 'E_INV_ASYMMETRIC', detail: `rel ${rel.id} missing in in-index` });
    }

    // INV-13: Attachment的target和grantedBy必须存在
    for (const att of this.attachments.values()) {
      if (!this.entities.has(att.target)) {
        violations.push({ code: 'E_INV_DANGLING', detail: `att ${att.id} target=${att.target} missing` });
      }
      if (!this.entities.has(att.grantedBy)) {
        violations.push({ code: 'E_INV_DANGLING', detail: `att ${att.id} grantedBy=${att.grantedBy} missing` });
      }
      for (const dep of att.deps) {
        if (!this.entities.has(dep)) {
          violations.push({ code: 'E_INV_DANGLING', detail: `att ${att.id} dep=${dep} missing` });
        }
      }
    }

    // Entity的attachments集合与attachments Map一致
    for (const ent of this.entities.values()) {
      for (const attId of ent.attachments) {
        if (!this.attachments.has(attId)) {
          violations.push({ code: 'E_INV_INCONSISTENT', detail: `entity ${ent.id} refs att ${attId} not in map` });
        }
      }
    }

    // ---------------------------------------------------------------------
    // 以下为**反向**校验。
    //
    // 上面三段全是"从 relations/attachments 出发，查索引里有没有它"。
    // 单向检查查不出**索引里多出来的东西**：删掉 relation_del 里清索引那两行，
    // 上面每一条断言依然全绿——因为它们只问"该有的在不在"，
    // 从不问"在的都该在吗"。索引与主表必须**双向**对齐才叫一致。
    // ---------------------------------------------------------------------

    // 反向 1：out/in 索引里的每个 relId 必须存在于 relations，且端点与类型对得上
    for (const ent of this.entities.values()) {
      for (const [type, list] of ent.rel.out) {
        for (const relId of list) {
          const rel = this.relations.get(relId);
          if (!rel) {
            violations.push({ code: 'E_INV_STALE_INDEX', detail: `entity ${ent.id} out[${type}] 残留 rel ${relId}（主表已无）` });
            continue;
          }
          if (rel.from !== ent.id) {
            violations.push({ code: 'E_INV_STALE_INDEX', detail: `entity ${ent.id} out[${type}] 含 rel ${relId}，但其 from=${rel.from}` });
          }
          if (rel.type !== type) {
            violations.push({ code: 'E_INV_STALE_INDEX', detail: `entity ${ent.id} out[${type}] 含 rel ${relId}，但其 type=${rel.type}` });
          }
        }
        // 同一 relId 在同一索引桶里出现两次：删一次剩一次，成为幽灵索引项
        if (new Set(list).size !== list.length) {
          violations.push({ code: 'E_INV_DUPLICATE_INDEX', detail: `entity ${ent.id} out[${type}] 存在重复 relId: ${JSON.stringify(list)}` });
        }
      }
      for (const [type, list] of ent.rel.in) {
        for (const relId of list) {
          const rel = this.relations.get(relId);
          if (!rel) {
            violations.push({ code: 'E_INV_STALE_INDEX', detail: `entity ${ent.id} in[${type}] 残留 rel ${relId}（主表已无）` });
            continue;
          }
          if (rel.to !== ent.id) {
            violations.push({ code: 'E_INV_STALE_INDEX', detail: `entity ${ent.id} in[${type}] 含 rel ${relId}，但其 to=${rel.to}` });
          }
          if (rel.type !== type) {
            violations.push({ code: 'E_INV_STALE_INDEX', detail: `entity ${ent.id} in[${type}] 含 rel ${relId}，但其 type=${rel.type}` });
          }
        }
        if (new Set(list).size !== list.length) {
          violations.push({ code: 'E_INV_DUPLICATE_INDEX', detail: `entity ${ent.id} in[${type}] 存在重复 relId: ${JSON.stringify(list)}` });
        }
      }
    }

    // 反向 2：每个 attachment 必须登记在其 target 的 attachments 集合里
    for (const att of this.attachments.values()) {
      const target = this.entities.get(att.target);
      if (target && !target.attachments.has(att.id)) {
        violations.push({ code: 'E_INV_INCONSISTENT', detail: `att ${att.id} 的 target ${att.target} 未登记该 att` });
      }
    }

    return violations;
  }

  /**
   * 读取接口。一律交出**副本**。
   *
   * 原实现直接交出内部对象，于是任何拿到句柄的调用方都能绕过全部 Op
   * 直接改坏索引：`(get('entity','e1') as any).rel.out.get('ally').push('不存在的')`
   * 就地伪造一条索引项，或 `rel.from = '别处'` 让关系与索引脱钩。
   * 引擎层不能把可写的内部状态当作读取结果交出去——那等于没有 Op 边界。
   */
  get(type: 'entity' | 'relation' | 'attachment', id: string) {
    if (type === 'entity') {
      const e = this.entities.get(id);
      return e === undefined ? undefined : cloneEntityStub(e);
    }
    if (type === 'relation') {
      const r = this.relations.get(id);
      return r === undefined ? undefined : cloneRelation(r);
    }
    if (type === 'attachment') {
      const a = this.attachments.get(id);
      return a === undefined ? undefined : cloneAttachment(a);
    }
    return undefined;
  }

  /**
   * 全量结构快照，供影子模型逐字段对照。
   *
   * 纯观测：不改变任何内部状态。返回规范化（键有序）的普通对象，
   * 使"索引内容"成为可断言的值而非只能靠 checkInvariants 间接推断。
   */
  dump(): DumpShape {
    const entities = [...this.entities.keys()].sort();
    const rel: DumpShape['relations'] = {};
    for (const r of this.relations.values()) {
      rel[r.id] = { type: r.type, from: r.from, to: r.to, attrs: { ...r.attrs } };
    }
    const att: DumpShape['attachments'] = {};
    for (const a of this.attachments.values()) {
      att[a.id] = {
        type: a.type, target: a.target, grantedBy: a.grantedBy,
        deps: [...a.deps], effectCount: a.effects.length,
      };
    }
    const idx: DumpShape['index'] = {};
    for (const id of entities) {
      const e = this.entities.get(id)!;
      // 桶内**不排序**：`get()` 会把这些数组交出去，故顺序是可观测的。
      // 排序会让 push→unshift 这类改动在对照中消失——那不是等价，是判据被削平。
      // 空桶剔除：`relation_del` 留下的空数组与"从未有过该 type"在语义上
      // 不可区分，若保留空桶，两者会伪装成状态差异。
      const out: Record<string, string[]> = {};
      for (const [t, list] of e.rel.out) if (list.length > 0) out[t] = [...list];
      const inn: Record<string, string[]> = {};
      for (const [t, list] of e.rel.in) if (list.length > 0) inn[t] = [...list];
      idx[id] = { out, in: inn, attachments: [...e.attachments] };
    }
    return { entities, relations: rel, attachments: att, index: idx };
  }
}

interface EntityStub {
  id: string;
  rel: { out: Map<string, string[]>; in: Map<string, string[]> };
  attachments: Set<string>;
}

interface Violation { code: string; detail: string; }

/** dump() 的返回形状：键全部排序，供逐字段对照与差分比对。 */
export interface DumpShape {
  entities: string[];
  relations: Record<string, { type: string; from: string; to: string; attrs: Record<string, unknown> }>;
  attachments: Record<string, {
    type: string; target: string; grantedBy: string; deps: string[]; effectCount: number;
  }>;
  index: Record<string, { out: Record<string, string[]>; in: Record<string, string[]>; attachments: string[] }>;
}

/**
 * 以下三个拷贝函数是"存入即脱钩、取出即脱钩"的实现基础。
 *
 * 必须逐层拷：attrs / deps / effects 都是可变容器，浅拷之后调用方手里
 * 仍握着同一个数组或对象，于是**全部前置校验都可以在事后被绕过**——
 * 校验过的是入参当时的样子，不是库里那份。
 */
function cloneRelation(r: RelationDef): RelationDef {
  return { id: r.id, type: r.type, from: r.from, to: r.to, attrs: { ...r.attrs } };
}

function cloneAttachment(a: AttachmentDef): AttachmentDef {
  return {
    id: a.id,
    type: a.type,
    target: a.target,
    grantedBy: a.grantedBy,
    // effects 内每个 EffectDef 的 args 也要拷，否则调用方仍能改到库里的参数
    effects: a.effects.map((e) => ({ op: e.op, args: { ...e.args } })),
    deps: [...a.deps],
  };
}

function cloneEntityStub(e: EntityStub): EntityStub {
  const out = new Map<string, string[]>();
  for (const [t, list] of e.rel.out) out.set(t, [...list]);
  const inn = new Map<string, string[]>();
  for (const [t, list] of e.rel.in) inn.set(t, [...list]);
  return { id: e.id, rel: { out, in: inn }, attachments: new Set(e.attachments) };
}

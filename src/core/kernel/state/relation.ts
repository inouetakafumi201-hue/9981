/**
 * L1 State: Relation 二元关系与 RelationIndex 纯读索引（design.md 3.1节 / 需求6.1-6.7）。
 *
 * RelationIndex 只保留 relOut/relIn 两个纯读方法；relation.set/relation.del 作为公开 Op 在 L3 注册，
 * 这里提供的 update* 函数是那两个 Op 内部调用的私有 helper（写入通道情形b），不对外暴露。
 */
import type { Ref } from './ids.js';
import type { Value } from './value.js';

export interface Relation {
  readonly kind: string;
  readonly from: Ref;
  readonly to: Ref;
  readonly props?: Record<string, Value>;
}

function refKey(ref: Ref): string {
  return ref.$;
}

/**
 * RelationIndex：全局索引，与 Entity.relations 字段是同一份数据的两个访问面。
 * 内部用 Map 存储以获得 O(1) 增删查；relOut/relIn 返回的数组顺序为插入顺序。
 */
export class RelationIndex {
  // key: `${refKey(from)}::${kind}` -> Ref[]（to 集合）
  private readonly outMap = new Map<string, Ref[]>();
  private readonly inMap = new Map<string, Ref[]>();

  /** 纯读：查询指定 ref 发出的 kind 类型出向关系（需求6.5）。 */
  relOut(ref: Ref, kind: string): Ref[] {
    return this.outMap.get(`${refKey(ref)}::${kind}`) ?? [];
  }

  /** 纯读：查询指向 ref 的 kind 类型入向关系（需求6.4）。 */
  relIn(ref: Ref, kind: string): Ref[] {
    return this.inMap.get(`${refKey(ref)}::${kind}`) ?? [];
  }

  /** 私有 helper：由 relation.set 这个 Op 内部调用。 */
  _add(from: Ref, to: Ref, kind: string): void {
    const outKey = `${refKey(from)}::${kind}`;
    const inKey = `${refKey(to)}::${kind}`;
    const outList = this.outMap.get(outKey) ?? [];
    if (!outList.some((r) => refKey(r) === refKey(to))) {
      outList.push(to);
      this.outMap.set(outKey, outList);
    }
    const inList = this.inMap.get(inKey) ?? [];
    if (!inList.some((r) => refKey(r) === refKey(from))) {
      inList.push(from);
      this.inMap.set(inKey, inList);
    }
  }

  /** 私有 helper：由 relation.del 这个 Op 内部调用。 */
  _remove(from: Ref, to: Ref, kind: string): void {
    const outKey = `${refKey(from)}::${kind}`;
    const inKey = `${refKey(to)}::${kind}`;
    const outList = this.outMap.get(outKey);
    if (outList) {
      this.outMap.set(outKey, outList.filter((r) => refKey(r) !== refKey(to)));
    }
    const inList = this.inMap.get(inKey);
    if (inList) {
      this.inMap.set(inKey, inList.filter((r) => refKey(r) !== refKey(from)));
    }
  }

  /** 私有 helper：销毁对象时级联移除以其为端点的全部 Relation（需求6.6），由 entity.destroy/item.destroy 的 after 阶段调用。 */
  _removeAllInvolving(ref: Ref): void {
    const key = refKey(ref);
    for (const [mapKey, list] of Array.from(this.outMap.entries())) {
      if (mapKey.startsWith(`${key}::`)) {
        this.outMap.delete(mapKey);
        continue;
      }
      const filtered = list.filter((r) => refKey(r) !== key);
      if (filtered.length !== list.length) this.outMap.set(mapKey, filtered);
    }
    for (const [mapKey, list] of Array.from(this.inMap.entries())) {
      if (mapKey.startsWith(`${key}::`)) {
        this.inMap.delete(mapKey);
        continue;
      }
      const filtered = list.filter((r) => refKey(r) !== key);
      if (filtered.length !== list.length) this.inMap.set(mapKey, filtered);
    }
  }

  /** 用于快照/深拷贝：导出当前全部关系的扁平列表。 */
  toRelationList(): Relation[] {
    const result: Relation[] = [];
    for (const [mapKey, list] of this.outMap.entries()) {
      const sep = mapKey.lastIndexOf('::');
      const fromKey = mapKey.slice(0, sep);
      const kind = mapKey.slice(sep + 2);
      for (const to of list) {
        result.push({ kind, from: { $: fromKey }, to });
      }
    }
    return result;
  }

  clone(): RelationIndex {
    const copy = new RelationIndex();
    for (const [k, v] of this.outMap.entries()) copy.outMap.set(k, [...v]);
    for (const [k, v] of this.inMap.entries()) copy.inMap.set(k, [...v]);
    return copy;
  }
}

/**
 * L1 State: Attachment 结构（design.md 3.1/3.9节 / 需求2.5-2.7）。
 * 本文件只定义数据结构与级联移除的纯函数版本；attach.add/attach.del 作为 Op 在 L3 实现。
 */
import type { Id, Ref } from './ids';
import type { Value } from './value';

export interface Attachment {
  readonly id: Id;
  readonly def: Id;
  readonly target: Ref; // 可指向 Entity/Item/Node/Link/World
  readonly source?: Ref;
  readonly props: Record<string, Value>;
  readonly stack: number;
  readonly expiresAt?: number;
  readonly activeAt?: number;
  readonly grantedBy?: Id; // 授予来源，来源被移除时级联移除
}

export function createAttachmentShape(id: Id, def: Id, target: Ref): Attachment {
  return { id, def, target, props: {}, stack: 1 };
}

/**
 * 计算某个 Attachment 被移除时应级联移除的全部子代 Id（含孙代），纯函数、只读。
 * 真正的移除写入由 attach.del 这个 Op 的内部实现调用（design.md 3.9节：写入通道情形b），
 * 这里只做"给定全部 Attachment 与要移除的根 Id，算出完整级联集合"的纯计算，不接触 WorldState 写权限。
 */
export function cascadeRemovalSet(allAttachments: readonly Attachment[], rootId: Id): Set<Id> {
  const byGrantedBy = new Map<Id, Id[]>();
  for (const a of allAttachments) {
    if (a.grantedBy !== undefined) {
      const list = byGrantedBy.get(a.grantedBy) ?? [];
      list.push(a.id);
      byGrantedBy.set(a.grantedBy, list);
    }
  }
  const result = new Set<Id>();
  const stack: Id[] = [rootId];
  while (stack.length > 0) {
    const current = stack.pop() as Id;
    if (result.has(current)) continue;
    result.add(current);
    const children = byGrantedBy.get(current) ?? [];
    for (const childId of children) stack.push(childId);
  }
  return result;
}

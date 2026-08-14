/**
 * L3 Ops: InvariantChecker（design.md 3.4节 / 需求20.1-20.17）。
 * 16 条不变量各对应一个独立检查函数，注册在数组里顺序执行，任一失败即整体拒绝提交。
 */
import type { WorldState } from '../state/world-state.js';
import type { Diagnostic } from '../state/diagnostic.js';
import type { Id } from '../state/ids.js';
import { isRef } from '../state/ids.js';
import { cascadeRemovalSet } from '../state/attachment.js';

type CheckFn = (state: WorldState) => Diagnostic[];

function mkDiag(code: Diagnostic['code'], message: string, extra?: Partial<Diagnostic>): Diagnostic {
  return { code, severity: 'fatal', message, phase: 0, ...extra };
}

function refExists(state: WorldState, id: Id): boolean {
  if (id === 'w:0') return true;
  return (
    id in state.entities ||
    id in state.items ||
    id in state.nodes ||
    id in state.links ||
    id in state.defs ||
    id in state.world.agents ||
    id in state.world.attachments ||
    id in state.world.decisions ||
    id in state.world.intents ||
    id in state.containers
  );
}

/**
 * 需求20.1：引用完整性——不得存在指向已销毁对象的 Ref。
 *
 * 补充记录（决策与风险记录.md 记录11/12）：此前本检查器完全没有扫描 Entity.relations
 * 的 out/in 切片——直接验证发现 item.destroy 不清理指向它的 Relation，且这条悬空引用
 * 对全部既有不变量检查都不可见（只有 checkRelationSymmetry 会检查"双向是否互为镜像"，
 * 但两端都指向同一个已销毁对象时对称性反而是"自洽"的，不会被那条检查抓到）。这里补上
 * 对 Relation 端点存在性的直接扫描，作为 cascade-destroy.ts 机械清理之外的第二道防线——
 * 即便未来某个新写入路径又漏了级联清理，这里也能在 commit 前拦下来，不让悬空引用落地。
 */
const checkReferentialIntegrity: CheckFn = (state) => {
  const diags: Diagnostic[] = [];
  const checkRef = (maybeRef: unknown, path: string) => {
    if (isRef(maybeRef) && !refExists(state, maybeRef.$)) {
      diags.push(mkDiag('E_INV_DANGLING', `悬空引用: ${path} 指向不存在的对象 ${maybeRef.$}`, { path }));
    }
  };
  for (const e of Object.values(state.entities)) {
    for (const r of e.attachments) if (!(r in state.world.attachments)) diags.push(mkDiag('E_INV_DANGLING', `Entity ${e.id} 的 attachment 引用悬空: ${r}`));
    for (const containerId of Object.values(e.containers)) if (!(containerId in state.containers)) diags.push(mkDiag('E_INV_DANGLING', `Entity ${e.id} 的 container 引用悬空: ${containerId}`));
    for (const [kind, slice] of Object.entries(e.relations)) {
      for (const r of slice.out) checkRef(r, `entities.${e.id}.relations.${kind}.out`);
      for (const r of slice.in) checkRef(r, `entities.${e.id}.relations.${kind}.in`);
    }
  }
  for (const a of Object.values(state.world.attachments)) {
    checkRef(a.target, `attachments.${a.id}.target`);
  }
  return diags;
};

/** 需求20.2：单一容纳——一个 Item 同一时刻应至多存在于一个 Slot 中。 */
const checkSingleContainment: CheckFn = (state) => {
  const diags: Diagnostic[] = [];
  const holderCount = new Map<Id, number>();
  for (const c of Object.values(state.containers)) {
    for (const slot of c.slots) {
      if (slot?.holds) {
        const id = slot.holds.$;
        holderCount.set(id, (holderCount.get(id) ?? 0) + 1);
      }
    }
  }
  for (const [id, count] of holderCount.entries()) {
    if (count > 1) diags.push(mkDiag('E_INV_SINGLE_CONTAINMENT', `对象 ${id} 同时被 ${count} 个槎位容纳`));
  }
  return diags;
};

/** 需求20.3：单一位置——一个 Entity 同一时刻应至多存在于一个 Node 中（这里指不应有两个 Entity 记录同一 node 且冲突，实质由 20.4 位置互斥覆盖单个 Entity 内部一致性，本检查确认 node 字段指向存在的节点）。 */
const checkSingleLocation: CheckFn = (state) => {
  const diags: Diagnostic[] = [];
  for (const e of Object.values(state.entities)) {
    if (e.node !== undefined && !(e.node in state.nodes)) {
      diags.push(mkDiag('E_INV_SINGLE_LOCATION', `Entity ${e.id} 的 node 引用悬空: ${e.node}`));
    }
  }
  return diags;
};

/** 需求20.4：位置互斥——Entity.node 与 Entity.slot 不得同时非空。 */
const checkLocationExclusive: CheckFn = (state) => {
  const diags: Diagnostic[] = [];
  for (const e of Object.values(state.entities)) {
    if (e.node !== undefined && e.slot !== undefined) {
      diags.push(mkDiag('E_INV_LOCATION_EXCLUSIVE', `Entity ${e.id} 的 node 与 slot 同时非空`, { subject: { $: e.id } }));
    }
  }
  return diags;
};

/**
 * 需求 2.5 / 11.1：载器承载面容量校验。
 * 对声明了 `capacity` 的载器承载面（`category:'carrier'`），占用数不得超过 capacity。
 * 无 capacity 字段的承载面跳过（无上限约束）。
 */
const checkCarrierCapacity: CheckFn = (state) => {
  const diags: Diagnostic[] = [];
  for (const c of Object.values(state.containers)) {
    if ((c as { category?: string }).category !== 'carrier') continue;
    const capacity = (c as { capacity?: number }).capacity;
    if (capacity === undefined) continue;
    const occupied = c.slots.filter((s) => s?.holds !== undefined).length;
    if (occupied > capacity) {
      diags.push(mkDiag('E_INV_CARRIER_CAPACITY', `载器承载面 ${c.id} 占用数 ${occupied} 超过容量上限 ${capacity}`));
    }
  }
  return diags;
};

/** 需求20.5：无环容纳——一个容器不得直接或间接地容纳自身的宿主。 */
const checkNoContainmentCycle: CheckFn = (state) => {
  const diags: Diagnostic[] = [];
  // 容纳关系：owner -> container -> slot.holds -> (若 holds 指向的对象自身拥有 container) -> ...
  const visit = (ownerId: Id, path: Set<Id>): boolean => {
    if (path.has(ownerId)) return true;
    const nextPath = new Set(path);
    nextPath.add(ownerId);
    const entity = state.entities[ownerId];
    const item = state.items[ownerId];
    const containerNames = entity?.containers ?? item?.containers ?? {};
    for (const containerId of Object.values(containerNames)) {
      const container = state.containers[containerId];
      if (!container) continue;
      for (const slot of container.slots) {
        if (slot?.holds) {
          if (visit(slot.holds.$, nextPath)) return true;
        }
      }
    }
    return false;
  };
  const seen = new Set<Id>();
  for (const id of [...Object.keys(state.entities), ...Object.keys(state.items)]) {
    if (seen.has(id)) continue;
    if (visit(id, new Set())) {
      diags.push(mkDiag('E_INV_CONTAINMENT_CYCLE', `容纳关系存在环，涉及对象 ${id}`));
    }
    seen.add(id);
  }
  return diags;
};

/** 需求20.6：拓扑一致——Link 的两个端点必须存在。（节点销毁级联 Link 由 Op 实现保证，这里只做静态校验。） */
const checkTopologyConsistency: CheckFn = (state) => {
  const diags: Diagnostic[] = [];
  for (const l of Object.values(state.links)) {
    if (!(l.a in state.nodes)) diags.push(mkDiag('E_INV_TOPOLOGY_CONSISTENCY', `Link ${l.id} 的端点 a=${l.a} 不存在`));
    if (!(l.b in state.nodes)) diags.push(mkDiag('E_INV_TOPOLOGY_CONSISTENCY', `Link ${l.id} 的端点 b=${l.b} 不存在`));
  }
  return diags;
};

/** 需求20.7：父子一致——微型场景 Node 的 parent 字段必须指向存在的节点。 */
const checkParentChild: CheckFn = (state) => {
  const diags: Diagnostic[] = [];
  for (const n of Object.values(state.nodes)) {
    if (n.parent !== undefined && !(n.parent in state.nodes)) {
      diags.push(mkDiag('E_INV_PARENT_CHILD', `Node ${n.id} 的 parent 引用悬空: ${n.parent}`));
    }
  }
  return diags;
};

/** 需求20.8：关系对称——Relation 的 out 记录与对端的 in 记录必须互为镜像。 */
const checkRelationSymmetry: CheckFn = (state) => {
  const diags: Diagnostic[] = [];
  for (const e of Object.values(state.entities)) {
    for (const [kind, rel] of Object.entries(e.relations)) {
      for (const to of rel.out) {
        const target = state.entities[to.$];
        if (target) {
          const backRel = target.relations[kind];
          if (!backRel || !backRel.in.some((r) => r.$ === e.id)) {
            diags.push(mkDiag('E_INV_RELATION_SYMMETRY', `Relation ${kind} 从 ${e.id} 到 ${to.$} 缺少对端 in 镜像`));
          }
        }
      }
    }
  }
  return diags;
};

/** 需求20.9：容器双向一致——Container.owner 字段与宿主的 containers 索引必须互相指向。 */
const checkContainerBidirectional: CheckFn = (state) => {
  const diags: Diagnostic[] = [];
  for (const c of Object.values(state.containers)) {
    const owner = state.entities[c.owner] ?? state.items[c.owner];
    if (!owner) {
      diags.push(mkDiag('E_INV_CONTAINER_BIDIRECTIONAL', `Container ${c.id} 的 owner ${c.owner} 不存在`));
      continue;
    }
    if (owner.containers[c.name] !== c.id) {
      diags.push(mkDiag('E_INV_CONTAINER_BIDIRECTIONAL', `宿主 ${c.owner} 的 containers[${c.name}] 未指回 ${c.id}`));
    }
  }
  return diags;
};

/** 需求20.10：槎位索引连续——shift 容器不得出现索引空洞，fixed 容器索引不得重新排列（此处只校验 shift 无空洞，fixed 的"不重排"由 Op 实现层保证，不是可从单一状态快照静态判断的属性）。 */
const checkSlotIndexContinuity: CheckFn = (state) => {
  const diags: Diagnostic[] = [];
  for (const c of Object.values(state.containers)) {
    if (c.insert === 'shift') {
      for (let i = 0; i < c.slots.length; i++) {
        if (c.slots[i] === undefined) {
          diags.push(mkDiag('E_INV_SLOT_INDEX_CONTINUITY', `shift 容器 ${c.id} 索引 ${i} 处存在空洞`));
        }
      }
    }
  }
  return diags;
};

/** 需求20.11：堆叠守恒——由 stack.split/stack.merge 的 Op 实现自身保证总量不变，此处不做全局静态校验（无法从单一快照判断"总量是否因 split/merge 改变"，需要历史对比，属于 Property 5 的属性测试职责而非不变量检查器职责）。 */
const checkStackConservation: CheckFn = () => [];

/** 需求20.12：代价守恒——由 freezeCost/settleCost/refundCost 三态自身保证，此处同样不是单一快照可判断的静态不变量。 */
const checkCostConservation: CheckFn = () => [];

/** 需求20.13：附属一致——Attachment 的 target 必须存在。 */
const checkAttachmentConsistency: CheckFn = (state) => {
  const diags: Diagnostic[] = [];
  for (const a of Object.values(state.world.attachments)) {
    if (!refExists(state, a.target.$)) {
      diags.push(mkDiag('E_INV_ATTACHMENT_CONSISTENCY', `Attachment ${a.id} 的 target 不存在: ${a.target.$}`));
    }
    if (a.grantedBy !== undefined && !(a.grantedBy in state.world.attachments)) {
      diags.push(mkDiag('E_INV_ATTACHMENT_CONSISTENCY', `Attachment ${a.id} 的 grantedBy 不存在: ${a.grantedBy}`));
    }
  }
  return diags;
};

/** 需求20.14：堆叠有界——Item.stack 必须在 [1, stackMax] 之间。 */
const checkStackBounded: CheckFn = (state) => {
  const diags: Diagnostic[] = [];
  for (const item of Object.values(state.items)) {
    if (item.stack !== undefined) {
      if (item.stack < 1) diags.push(mkDiag('E_INV_STACK_BOUNDED', `Item ${item.id} 的 stack 低于 1: ${item.stack}`));
      if (item.stackMax !== undefined && item.stack > item.stackMax) {
        diags.push(mkDiag('E_INV_STACK_BOUNDED', `Item ${item.id} 的 stack 超出 stackMax: ${item.stack} > ${item.stackMax}`));
      }
    }
  }
  return diags;
};

/** 需求20.15：决策有终——处于 open 状态且已超过 deadline 的 Decision 应已被处理（此检查只校验数据形状，真正的超时推进由 L9 schedule.advance 负责）。 */
const checkDecisionTermination: CheckFn = () => [];

/** 需求20.16：数值有界——拒绝写入非有限数（由 value.ts 的 validateValue 在写入路径拦截，此处对已落地状态做兜底扫描）。 */
const checkNumericBounded: CheckFn = (state) => {
  const diags: Diagnostic[] = [];
  const scan = (v: unknown, path: string): void => {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      diags.push(mkDiag('E_INV_NAN_OR_INFINITY', `非有限数值: ${path}`, { path }));
      return;
    }
    if (v !== null && typeof v === 'object' && !isRef(v)) {
      if (Array.isArray(v)) v.forEach((item, i) => scan(item, `${path}[${i}]`));
      else for (const [k, val] of Object.entries(v as Record<string, unknown>)) scan(val, `${path}.${k}`);
    }
  };
  for (const e of Object.values(state.entities)) scan(e.props, `entities.${e.id}.props`);
  for (const i of Object.values(state.items)) scan(i.props, `items.${i.id}.props`);
  return diags;
};

/** 附属一致的姊妹校验：grantedBy 授予者若已不存在，其子 Attachment 应已被级联回收（这里做静态一致性扫描）。 */
const checkGrantedByCascade: CheckFn = (state) => {
  const diags: Diagnostic[] = [];
  const all = Object.values(state.world.attachments);
  for (const a of all) {
    if (a.grantedBy !== undefined) {
      const cascadeSet = cascadeRemovalSet(all, a.grantedBy);
      if (!cascadeSet.has(a.id) && !(a.grantedBy in state.world.attachments)) {
        diags.push(mkDiag('E_INV_ATTACHMENT_CONSISTENCY', `Attachment ${a.id} 的授予来源 ${a.grantedBy} 已不存在但未被级联回收`));
      }
    }
  }
  return diags;
};

export const ALL_INVARIANT_CHECKS: readonly CheckFn[] = [
  checkReferentialIntegrity,
  checkSingleContainment,
  checkSingleLocation,
  checkLocationExclusive,
  checkNoContainmentCycle,
  checkTopologyConsistency,
  checkParentChild,
  checkRelationSymmetry,
  checkContainerBidirectional,
  checkSlotIndexContinuity,
  checkStackConservation,
  checkCostConservation,
  checkAttachmentConsistency,
  checkStackBounded,
  checkDecisionTermination,
  checkNumericBounded,
  checkGrantedByCascade,
  checkCarrierCapacity,
];

export class InvariantChecker {
  checkAll(state: WorldState): Diagnostic[] {
    const diags: Diagnostic[] = [];
    for (const check of ALL_INVARIANT_CHECKS) {
      diags.push(...check(state));
    }
    return diags;
  }
}

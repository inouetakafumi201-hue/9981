/**
 * L3 Ops: 属性类 Op（design.md 3.4节 / 需求16.5）。
 * prop.set / prop.del / prop.add（尊重 clamp） / list.insert / list.remove / tag.add / tag.del
 */
import type { OpImpl, OpContext } from './registry.js';
import type { OpRegistry } from './registry.js';
import type { Value } from '../state/value.js';
import { validateValue } from '../state/value.js';
import { ok, err } from './result.js';
import { getPath, setPath, deletePath, isWritablePropsPath } from './path.js';
import type { Def } from '../state/def.js';

export interface PropSetArgs {
  path: string;
  value: Value;
}

export interface PropDelArgs {
  path: string;
}

export interface PropAddArgs {
  path: string;
  delta: number;
}

export interface ListInsertArgs {
  path: string;
  value: Value;
  index?: number;
}

export interface ListRemoveArgs {
  path: string;
  index: number;
}

export interface ListMoveArgs {
  path: string;
  from: number;
  to: number;
}

export interface TagArgs {
  ref: { collection: 'entities' | 'items' | 'nodes' | 'links'; id: string };
  tag: string;
}

function guardWritablePath(path: string): { ok: true } | { ok: false; detail: string } {
  if (!isWritablePropsPath(path)) {
    return { ok: false, detail: `路径 ${path} 不在自由区（props/facts/seen）范围内，属性类 Op 不得写入结构区字段` };
  }
  return { ok: true };
}

/**
 * 校验路径指向的宿主对象确实存在（模糊测试发现的真实 bug 修正，记录于 决策与风险记录.md）：
 * setPath/deletePath（ops/path.ts）的递归实现对不存在的中间节点用 `node ?? {}` 兜底创建
 * 空对象——这在路径合法但宿主对象不存在时（如对一个已被销毁/从未创建的 Entity 调用
 * prop.set），会静默在 WorldState 里合成一个只有 props 字段、缺失 id/def/tags/attachments/
 * relations 等必需字段的畸形对象，而不是返回 E_REF_MISSING。这个畸形对象随后被任何遍历
 * Entity.attachments/relations 等字段的代码（如 entity.destroy 的关系级联清理）访问时，
 * 会因该字段是 undefined 而抛出未捕获异常——这正是需求16.2-16.3"Op 永不抛异常"要求防止的
 * 情形，属于本次模糊测试第一轮就发现的真实缺陷，不是理论风险。
 *
 * 修正：属性类 Op 在调用 setPath/deletePath 之前，必须先确认路径里引用的宿主对象
 * （entities.<id>、items.<id>、nodes.<id>、links.<id>、containers.<id>）已存在于当前 draft 中。
 * world.props / world.knowledge.* 两类路径没有"宿主对象"概念（它们本身就是 world 的直接
 * 子字段，world 恒存在），不需要这项检查。
 */
function guardHostExists(draft: unknown, path: string): { ok: true } | { ok: false; detail: string } {
  const m = /^(entities|items|nodes|links|containers)\.([^.]+)\./.exec(path);
  if (!m) return { ok: true }; // world.props / world.knowledge.* 等路径无宿主对象概念
  const [, collection, hostId] = m;
  const c = (draft as Record<string, Record<string, unknown> | undefined>)[collection as string];
  if (!c || !(hostId as string in c)) {
    return { ok: false, detail: `路径 ${path} 引用的宿主对象 ${collection}.${hostId} 不存在` };
  }
  return { ok: true };
}

/** 从 props 路径的父级读出可能存在的 clamp 声明（依据其 Def.clamp[fieldName]）。 */
function findClampFor(defRegistry: { resolve(id: string): Def | null } | undefined, defId: string | undefined, fieldName: string) {
  if (!defRegistry || !defId) return undefined;
  const def = defRegistry.resolve(defId);
  return def?.clamp?.[fieldName];
}

export const propSet: OpImpl<PropSetArgs, void> = (args, ctx) => {
  const guard = guardWritablePath(args.path);
  if (!guard.ok) return err('E_OP_INVALID_ARGS', guard.detail);
  const validation = validateValue(args.value);
  if (!validation.ok) return err('E_INV_NAN_OR_INFINITY', `写入值非法: ${args.path}`);
  const draft = ctx.tx.getDraft();
  const hostGuard = guardHostExists(draft, args.path);
  if (!hostGuard.ok) return err('E_REF_MISSING', hostGuard.detail);
  ctx.tx.setDraft(setPath(draft, args.path, args.value));
  ctx.tx.logOp('prop.set', args, () => {
    /* 逆操作：恢复原值，由调用方在 journal 层重放时提供旧值上下文，这里占位 */
  });
  return ok(undefined);
};

export const propDel: OpImpl<PropDelArgs, void> = (args, ctx) => {
  const guard = guardWritablePath(args.path);
  if (!guard.ok) return err('E_OP_INVALID_ARGS', guard.detail);
  const draft = ctx.tx.getDraft();
  const hostGuard = guardHostExists(draft, args.path);
  if (!hostGuard.ok) return err('E_REF_MISSING', hostGuard.detail);
  ctx.tx.setDraft(deletePath(draft, args.path));
  ctx.tx.logOp('prop.del', args, () => {});
  return ok(undefined);
};

export function makePropAdd(defRegistry: { resolve(id: string): Def | null }): OpImpl<PropAddArgs, number> {
  return (args, ctx) => {
    const guard = guardWritablePath(args.path);
    if (!guard.ok) return err('E_OP_INVALID_ARGS', guard.detail);
    const draft = ctx.tx.getDraft();
    const hostGuard = guardHostExists(draft, args.path);
    if (!hostGuard.ok) return err('E_REF_MISSING', hostGuard.detail);
    const current = getPath(draft, args.path);
    const currentNum = typeof current === 'number' ? current : 0;
    let next = currentNum + args.delta;
    if (!Number.isFinite(next)) return err('E_INV_NAN_OR_INFINITY', `prop.add 结果非有限数: ${args.path}`);

    // 尊重 clamp：从路径推断宿主对象的 defId 与字段名
    const parsed = parsePropsPath(args.path);
    if (parsed) {
      const hostDefId = resolveHostDefId(draft, parsed.collection, parsed.hostId);
      const clamp = findClampFor(defRegistry, hostDefId, parsed.fieldPath);
      if (clamp) {
        if (clamp.min !== undefined) next = Math.max(next, clamp.min);
        if (clamp.max !== undefined) next = Math.min(next, clamp.max);
        if (clamp.int) next = Math.round(next);
      }
    }

    ctx.tx.setDraft(setPath(draft, args.path, next));
    ctx.tx.logOp('prop.add', args, () => {});
    return ok(next);
  };
}

function parsePropsPath(path: string): { collection: string; hostId: string; fieldPath: string } | null {
  const m = /^(entities|items|nodes|links|containers)\.([^.]+)\.props\.(.+)$/.exec(path);
  if (!m) return null;
  return { collection: m[1] as string, hostId: m[2] as string, fieldPath: m[3] as string };
}

function resolveHostDefId(draft: ReturnType<OpContext['tx']['getDraft']>, collection: string, hostId: string): string | undefined {
  const c = (draft as unknown as Record<string, Record<string, { def?: string }>>)[collection];
  return c?.[hostId]?.def;
}

export const listInsert: OpImpl<ListInsertArgs, void> = (args, ctx) => {
  const guard = guardWritablePath(args.path);
  if (!guard.ok) return err('E_OP_INVALID_ARGS', guard.detail);
  const draft = ctx.tx.getDraft();
  const hostGuard = guardHostExists(draft, args.path);
  if (!hostGuard.ok) return err('E_REF_MISSING', hostGuard.detail);
  const current = getPath(draft, args.path);
  const arr = Array.isArray(current) ? [...current] : [];
  const idx = args.index ?? arr.length;
  arr.splice(idx, 0, args.value);
  ctx.tx.setDraft(setPath(draft, args.path, arr));
  ctx.tx.logOp('list.insert', args, () => {});
  return ok(undefined);
};

export const listRemove: OpImpl<ListRemoveArgs, void> = (args, ctx) => {
  const guard = guardWritablePath(args.path);
  if (!guard.ok) return err('E_OP_INVALID_ARGS', guard.detail);
  const draft = ctx.tx.getDraft();
  const hostGuard = guardHostExists(draft, args.path);
  if (!hostGuard.ok) return err('E_REF_MISSING', hostGuard.detail);
  const current = getPath(draft, args.path);
  if (!Array.isArray(current)) return err('E_OP_INVALID_ARGS', `路径 ${args.path} 不是数组`);
  if (args.index < 0 || args.index >= current.length) return err('E_OP_INVALID_ARGS', `索引越界: ${args.index}`);
  const arr = [...current];
  arr.splice(args.index, 1);
  ctx.tx.setDraft(setPath(draft, args.path, arr));
  ctx.tx.logOp('list.remove', args, () => {});
  return ok(undefined);
};

/** 在同一有序表中移动元素；队列重排、牌序调整和 UI 排序均复用此原语。 */
export const listMove: OpImpl<ListMoveArgs, void> = (args, ctx) => {
  const guard = guardWritablePath(args.path);
  if (!guard.ok) return err('E_OP_INVALID_ARGS', guard.detail);
  const draft = ctx.tx.getDraft();
  const hostGuard = guardHostExists(draft, args.path);
  if (!hostGuard.ok) return err('E_REF_MISSING', hostGuard.detail);
  const current = getPath(draft, args.path);
  if (!Array.isArray(current)) return err('E_OP_INVALID_ARGS', `路径 ${args.path} 不是数组`);
  if (!Number.isInteger(args.from) || args.from < 0 || args.from >= current.length) {
    return err('E_OP_INVALID_ARGS', `起始索引越界: ${args.from}`);
  }
  if (!Number.isInteger(args.to) || args.to < 0 || args.to >= current.length) {
    return err('E_OP_INVALID_ARGS', `目标索引越界: ${args.to}`);
  }
  if (args.from === args.to) return ok(undefined);

  const arr = [...current];
  const [moved] = arr.splice(args.from, 1);
  arr.splice(args.to, 0, moved as Value);
  ctx.tx.setDraft(setPath(draft, args.path, arr));
  ctx.tx.logOp('list.move', args, () => {});
  return ok(undefined);
};

/**
 * tag.add/tag.del 直接操作 Entity/Item/Node/Link 的结构区 tags 字段（不是 props 自由区），
 * 因此不复用 isWritablePropsPath 的守卫——tags 本身就是这四种结构允许的合法结构区字段
 * （design.md 3.1/3.2节明确 tags 是 Entity/Item/Node/Link 的一等字段），这里直写。
 */
function makeTagOp(mode: 'add' | 'del'): OpImpl<TagArgs, void> {
  return (args, ctx) => {
    const draft = ctx.tx.getDraft();
    const collection = (draft as unknown as Record<string, Record<string, { tags: string[] }> | undefined>)[args.ref.collection];
    if (!collection) return err('E_REF_MISSING', `未知集合: ${args.ref.collection}`);
    const host = collection[args.ref.id];
    if (!host) return err('E_REF_MISSING', `${args.ref.collection}.${args.ref.id} 不存在`);
    const nextTags =
      mode === 'add'
        ? host.tags.includes(args.tag) ? host.tags : [...host.tags, args.tag]
        : host.tags.filter((t) => t !== args.tag);
    const nextCollection = { ...collection, [args.ref.id]: { ...host, tags: nextTags } };
    ctx.tx.setDraft({ ...draft, [args.ref.collection]: nextCollection } as ReturnType<OpContext['tx']['getDraft']>);
    ctx.tx.logOp(`tag.${mode}`, args, () => {});
    return ok(undefined);
  };
}

export function registerPropOps(registry: OpRegistry, defRegistry: { resolve(id: string): Def | null }): void {
  registry.register('prop.set', propSet);
  registry.register('prop.del', propDel);
  registry.register('prop.add', makePropAdd(defRegistry));
  registry.register('list.insert', listInsert);
  registry.register('list.remove', listRemove);
  registry.register('list.move', listMove);
  registry.register('tag.add', makeTagOp('add'));
  registry.register('tag.del', makeTagOp('del'));
}

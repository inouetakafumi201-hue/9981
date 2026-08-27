/**
 * L8 Attachment Ops: attach.add / attach.del / attach.expire.
 * Four stack strategies and lifecycle effects execute inside the caller's transaction.
 */
import type { OpContext, OpImpl, OpRegistry } from '../ops/registry';
import type { Result } from '../ops/result';
import { ok, err } from '../ops/result';
import type { Id, Ref } from '../state/ids';
import { nextId } from '../state/ids';
import type { Value } from '../state/value';
import type { Attachment } from '../state/attachment';
import { cascadeRemovalSet } from '../state/attachment';
import type { Def } from '../state/def';
import type { Effect } from '../events/effect-types';
import type { AttachmentDef } from './types';
import { checkInstantiable } from '../ops/def-guard';

export interface AttachAddArgs {
  def: Id;
  target: Ref;
  source?: Ref;
  props?: Record<string, Value>;
  grantedBy?: Id;
  expiresAt?: number;
  /** 延时生效起始相位（需求30.8）：当前相位小于它时整个 Attachment 视为未生效。 */
  activeAt?: number;
}

export interface AttachDelArgs {
  id: Id;
}

export interface AttachExpireArgs {
  at: number;
}

export interface AttachOpsDeps {
  defLookup: (id: Id) => Def | null;
  runEffects?: (effects: Effect[], ctx: OpContext, vars: Record<string, Value>) => Result<void>;
}

function lifecycleVars(attachment: Attachment): Record<string, Value> {
  return {
    attachment: { $: attachment.id },
    target: attachment.target,
    source: attachment.source ?? null,
  };
}

function runLifecycle(
  effects: Effect[] | undefined,
  attachment: Attachment,
  ctx: OpContext,
  deps: AttachOpsDeps,
): Result<void> {
  if (!effects || effects.length === 0 || !deps.runEffects) return ok(undefined);
  return deps.runEffects(effects, ctx, lifecycleVars(attachment));
}

function makeAttachAdd(deps: AttachOpsDeps): OpImpl<AttachAddArgs, Ref> {
  return (args, ctx) => {
    const guard = checkInstantiable(deps.defLookup, args.def, 'attachment');
    if (!guard.ok) return guard;
    const attachmentDef = guard.value as AttachmentDef;
    const strategy = attachmentDef.stackStrategy;
    const draft = ctx.tx.getDraft();
    const allAttachments = Object.values(draft.world.attachments) as Attachment[];
    const existing = allAttachments.find(
      (attachment) => attachment.def === args.def && attachment.target.$ === args.target.$,
    );

    let newId: Id;
    if (strategy === 'unique') {
      if (existing) {
        const updated: Attachment = {
          ...existing,
          stack: 1,
          props: { ...existing.props, ...(args.props ?? {}) },
          expiresAt: args.expiresAt,
        };
        ctx.tx.setDraft({
          ...draft,
          world: { ...draft.world, attachments: { ...draft.world.attachments, [existing.id]: updated } },
        });
        ctx.tx.logOp('attach.add', args, () => {});
        return ok({ $: existing.id });
      }
      newId = nextId('a');
    } else if (strategy === 'refresh') {
      if (existing) {
        const updated: Attachment = {
          ...existing,
          stack: (existing.stack ?? 1) + 1,
          props: { ...existing.props, ...(args.props ?? {}) },
          expiresAt: args.expiresAt,
        };
        ctx.tx.setDraft({
          ...draft,
          world: { ...draft.world, attachments: { ...draft.world.attachments, [existing.id]: updated } },
        });
        ctx.tx.logOp('attach.add', args, () => {});
        return ok({ $: existing.id });
      }
      newId = nextId('a');
    } else if (strategy === 'count') {
      if (existing) {
        const maxStack = attachmentDef.maxStack ?? Infinity;
        if (existing.stack >= maxStack) {
          return err('E_OP_SLOT_FULL', `Attachment ${args.def} 已达到 maxStack ${maxStack}`);
        }
        const updated: Attachment = {
          ...existing,
          stack: existing.stack + 1,
          props: { ...existing.props, ...(args.props ?? {}) },
        };
        ctx.tx.setDraft({
          ...draft,
          world: { ...draft.world, attachments: { ...draft.world.attachments, [existing.id]: updated } },
        });
        ctx.tx.logOp('attach.add', args, () => {});
        return ok({ $: existing.id });
      }
      newId = nextId('a');
    } else {
      newId = nextId('a');
    }

    const attachment: Attachment = {
      id: newId,
      def: args.def,
      target: args.target,
      source: args.source,
      props: args.props ?? {},
      stack: 1,
      expiresAt: args.expiresAt,
      activeAt: args.activeAt,
      grantedBy: args.grantedBy,
    };
    ctx.tx.setDraft({
      ...draft,
      world: { ...draft.world, attachments: { ...draft.world.attachments, [newId]: attachment } },
    });

    const lifecycle = runLifecycle(attachmentDef.onAdd, attachment, ctx, deps);
    if (!lifecycle.ok) {
      // onAdd 效果失败会整体回滚（事务回退 draft 与 journal）。Id 计数器的推进由
      // OpRegistry.invoke 顶层事务作用域统一对齐（state/ids.ts 的 begin/commit/rollbackIdCounters），
      // 失败 Op 不残留编号（Agent 与 Attachment 共用 `a:` 前缀计数器），无需在此手工回滚
      // （bombardment-l12 属性 8 实测暴露点）。
      return lifecycle;
    }

    ctx.tx.logOp('attach.add', args, () => {});
    return ok({ $: newId });
  };
}

function removalOrder(allAttachments: readonly Attachment[], roots: readonly Id[]): Id[] {
  const ids = new Set<Id>();
  for (const root of [...roots].sort()) {
    for (const id of cascadeRemovalSet(allAttachments, root)) ids.add(id);
  }
  // cascadeRemovalSet inserts ancestors before descendants. Reversing makes dependent effects run first.
  return [...ids].reverse();
}

function removeAttachments(
  roots: readonly Id[],
  expiring: ReadonlySet<Id>,
  ctx: OpContext,
  deps: AttachOpsDeps,
): Result<void> {
  const before = ctx.tx.getDraft();
  const allAttachments = Object.values(before.world.attachments) as Attachment[];
  const byId = new Map(allAttachments.map((attachment) => [attachment.id, attachment]));
  const orderedIds = removalOrder(allAttachments, roots);

  for (const id of orderedIds) {
    const attachment = byId.get(id);
    if (!attachment) continue;
    const definition = deps.defLookup(attachment.def);
    if (!definition || definition.kind !== 'attachment') continue;
    const attachmentDef = definition as AttachmentDef;
    if (expiring.has(id)) {
      const expireResult = runLifecycle(attachmentDef.onExpire, attachment, ctx, deps);
      if (!expireResult.ok) return expireResult;
    }
    const removeResult = runLifecycle(attachmentDef.onRemove, attachment, ctx, deps);
    if (!removeResult.ok) return removeResult;
  }

  let nextAttachments = { ...ctx.tx.getDraft().world.attachments };
  for (const id of orderedIds) {
    const { [id]: _removed, ...rest } = nextAttachments;
    nextAttachments = rest;
  }
  const draft = ctx.tx.getDraft();
  ctx.tx.setDraft({ ...draft, world: { ...draft.world, attachments: nextAttachments } });
  return ok(undefined);
}

function makeAttachDel(deps: AttachOpsDeps): OpImpl<AttachDelArgs, void> {
  return (args, ctx) => {
    if (!ctx.tx.getDraft().world.attachments[args.id]) {
      return err('E_REF_MISSING', `Attachment ${args.id} 不存在`);
    }
    const result = removeAttachments([args.id], new Set(), ctx, deps);
    if (!result.ok) return result;
    ctx.tx.logOp('attach.del', args, () => {});
    return ok(undefined);
  };
}

function makeAttachExpire(deps: AttachOpsDeps): OpImpl<AttachExpireArgs, Id[]> {
  return (args, ctx) => {
    if (!Number.isFinite(args.at)) return err('E_OP_INVALID_ARGS', 'attach.expire.at 必须是有限数');
    const due = Object.values(ctx.tx.getDraft().world.attachments)
      .filter((attachment) => attachment.expiresAt !== undefined && attachment.expiresAt <= args.at)
      .map((attachment) => attachment.id)
      .sort();
    if (due.length === 0) return ok([]);
    const result = removeAttachments(due, new Set(due), ctx, deps);
    if (!result.ok) return result;
    ctx.tx.logOp('attach.expire', args, () => {});
    return ok(due);
  };
}

export function registerAttachOps(registry: OpRegistry, deps: AttachOpsDeps): void {
  registry.register('attach.add', makeAttachAdd(deps), { structural: true });
  registry.register('attach.del', makeAttachDel(deps), { structural: true });
  registry.register('attach.expire', makeAttachExpire(deps), { structural: true });
}

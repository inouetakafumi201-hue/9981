/**
 * L10 withShadowStream: scope wrapper for shadow RNG streams (NOT an Op itself).
 * (design.md 3.11节 / 需求36.4-36.5, Property 17: shadow stream isolation).
 *
 * withShadowStream wraps a block of Op calls in a named shadow stream scope.
 * All random Ops within the block that use the shadow stream name will draw
 * from the shadow stream rather than the main stream, keeping them isolated.
 */
import type { OpContext } from '../ops/registry.js';
import type { RngStreamState } from '../state/world-state.js';

export interface ShadowStreamOpts {
  name: string;
  seed: number;
}

/**
 * Create a snapshot of the named stream from the current draft.
 * Used to restore stream state after the shadow block (isolation).
 */
export function snapshotStream(ctx: OpContext, streamName: string): RngStreamState | undefined {
  return ctx.tx.getDraft().world.rng[streamName];
}

/**
 * Restore a previously snapshotted stream state (or delete it if undefined).
 */
export function restoreStream(ctx: OpContext, streamName: string, snapshot: RngStreamState | undefined): void {
  const draft = ctx.tx.getDraft();
  if (snapshot === undefined) {
    const { [streamName]: _removed, ...rest } = draft.world.rng;
    ctx.tx.setDraft({ ...draft, world: { ...draft.world, rng: rest } });
  } else {
    ctx.tx.setDraft({ ...draft, world: { ...draft.world, rng: { ...draft.world.rng, [streamName]: snapshot } } });
  }
}

/**
 * withShadowStream: runs `block` with a fresh shadow stream, then restores the original stream state.
 * Property 17: shadow stream changes do not leak outside the scope.
 *
 * @param ctx - The OpContext (transaction) to operate in
 * @param opts - shadow stream name and seed
 * @param block - a synchronous block of Op invocations to run within the shadow scope
 * @returns the return value of block
 */
export function withShadowStream<T>(
  ctx: OpContext,
  opts: ShadowStreamOpts,
  block: (ctx: OpContext) => T,
): T {
  // Snapshot the current stream state (for isolation)
  const snapshot = snapshotStream(ctx, opts.name);

  // Initialize the shadow stream with the given seed
  const shadowStream: RngStreamState = { name: opts.name, seed: opts.seed, counter: opts.seed };
  const draft = ctx.tx.getDraft();
  ctx.tx.setDraft({ ...draft, world: { ...draft.world, rng: { ...draft.world.rng, [opts.name]: shadowStream } } });

  // Run the block
  const result = block(ctx);

  // Restore the original stream state (isolation guarantee)
  restoreStream(ctx, opts.name, snapshot);

  return result;
}

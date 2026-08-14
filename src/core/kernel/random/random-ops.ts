/**
 * L10 Random Ops: random.roll / random.pick / random.shuffle / random.weightedPick
 * as public Ops (NOT ExprEngine builtins). (design.md 3.11节 / 需求35.1-35.5)
 * Property 16 (deterministic replay), Property 17 (shadow stream isolation),
 * Property 30 (random ops not in Expr path).
 */
import type { OpImpl, OpRegistry, OpContext } from '../ops/registry.js';
import { ok, err } from '../ops/result.js';
import type { Value } from '../state/value.js';
import type { RngStreamState } from '../state/world-state.js';

// ---------------------------------------------------------------------------
// Simple deterministic LCG (linear congruential generator) for reproducibility
// ---------------------------------------------------------------------------
function lcgNext(state: RngStreamState): { value: number; next: RngStreamState } {
  // LCG parameters (Knuth): a=1664525, c=1013904223, m=2^32
  const a = 1664525;
  const c = 1013904223;
  const m = 0x100000000; // 2^32
  const nextCounter = ((a * state.counter + c) % m + m) % m;
  const value = nextCounter / m; // [0, 1)
  return { value, next: { ...state, counter: nextCounter } };
}

function getOrCreateStream(ctx: OpContext, streamName: string, seed: number): RngStreamState {
  const draft = ctx.tx.getDraft();
  const existing = draft.world.rng[streamName];
  if (existing) return existing;
  return { name: streamName, seed, counter: seed };
}

function updateStream(ctx: OpContext, stream: RngStreamState): void {
  const draft = ctx.tx.getDraft();
  ctx.tx.setDraft({ ...draft, world: { ...draft.world, rng: { ...draft.world.rng, [stream.name]: stream } } });
}

// ---------------------------------------------------------------------------
// random.roll: roll a die with `sides` faces [1..sides]
// ---------------------------------------------------------------------------
export type RandomRollArgs = { sides: number; stream?: string; seed?: number };

const randomRoll: OpImpl<RandomRollArgs, number> = (args, ctx) => {
  if (!Number.isInteger(args.sides) || args.sides < 1) {
    return err('E_OP_INVALID_ARGS', `random.roll: sides must be a positive integer, got ${args.sides}`);
  }
  const streamName = args.stream ?? 'default';
  const stream = { ...getOrCreateStream(ctx, streamName, args.seed ?? 0) };
  const { value, next } = lcgNext(stream);
  updateStream(ctx, next);
  const result = Math.floor(value * args.sides) + 1;
  ctx.tx.logOp('random.roll', args, () => {});
  return ok(result);
};

// ---------------------------------------------------------------------------
// random.pick: pick one element from an array
// ---------------------------------------------------------------------------
export type RandomPickArgs = { items: Value[]; stream?: string; seed?: number };

const randomPick: OpImpl<RandomPickArgs, Value> = (args, ctx) => {
  if (args.items.length === 0) return err('E_OP_INVALID_ARGS', 'random.pick: items list is empty');
  const streamName = args.stream ?? 'default';
  const stream = { ...getOrCreateStream(ctx, streamName, args.seed ?? 0) };
  const { value, next } = lcgNext(stream);
  updateStream(ctx, next);
  const idx = Math.floor(value * args.items.length);
  ctx.tx.logOp('random.pick', args, () => {});
  return ok(args.items[idx] as Value);
};

// ---------------------------------------------------------------------------
// random.shuffle: Fisher-Yates shuffle of an array
// ---------------------------------------------------------------------------
export type RandomShuffleArgs = { items: Value[]; stream?: string; seed?: number };

const randomShuffle: OpImpl<RandomShuffleArgs, Value[]> = (args, ctx) => {
  const streamName = args.stream ?? 'default';
  let stream = { ...getOrCreateStream(ctx, streamName, args.seed ?? 0) };
  const arr = [...args.items];
  for (let i = arr.length - 1; i > 0; i--) {
    const { value, next } = lcgNext(stream);
    stream = next;
    const j = Math.floor(value * (i + 1));
    const temp = arr[i] as Value;
    arr[i] = arr[j] as Value;
    arr[j] = temp;
  }
  updateStream(ctx, stream);
  ctx.tx.logOp('random.shuffle', args, () => {});
  return ok(arr);
};

// ---------------------------------------------------------------------------
// random.weightedPick: pick from items with relative weights
// ---------------------------------------------------------------------------
export type RandomWeightedPickArgs = { items: { value: Value; weight: number }[]; stream?: string; seed?: number };

const randomWeightedPick: OpImpl<RandomWeightedPickArgs, Value> = (args, ctx) => {
  if (args.items.length === 0) return err('E_OP_INVALID_ARGS', 'random.weightedPick: items list is empty');
  const totalWeight = args.items.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return err('E_OP_INVALID_ARGS', 'random.weightedPick: total weight must be > 0');
  const streamName = args.stream ?? 'default';
  const stream = { ...getOrCreateStream(ctx, streamName, args.seed ?? 0) };
  const { value, next } = lcgNext(stream);
  updateStream(ctx, next);
  let threshold = value * totalWeight;
  for (const item of args.items) {
    threshold -= item.weight;
    if (threshold <= 0) {
      ctx.tx.logOp('random.weightedPick', args, () => {});
      return ok(item.value);
    }
  }
  ctx.tx.logOp('random.weightedPick', args, () => {});
  return ok(args.items[args.items.length - 1]!.value);
};

export function registerRandomOps(registry: OpRegistry): void {
  registry.register('random.roll', randomRoll);
  registry.register('random.pick', randomPick);
  registry.register('random.shuffle', randomShuffle);
  registry.register('random.weightedPick', randomWeightedPick);
}

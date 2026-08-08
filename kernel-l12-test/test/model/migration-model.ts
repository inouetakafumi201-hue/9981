/**
 * L12 迁移影子模型。
 *
 * 两个独立判据：
 *  1. 唯一链图上的**算术判据**——完整算出 ok / version / props / 诊断码序列。
 *  2. 任意图上的**结构判据**——链必须首尾相接、跳数必须最小、
 *     无路径时必须报 NO_PATH。最小性由穷举全部简单路径独立求得，
 *     不复制产品的 BFS（复制一份就不是判据，只是回声）。
 *
 * 链的选择结果通过 effect 里的记录器观测：findMigrationChain 是私有函数，
 * 若只看最终状态，"走了哪条链"在多条链等效时不可观测——
 * 那正是 L4 的 M13 漏检成因（末级排序键永远得不到表决机会）。
 */
import fc from 'fast-check';
import type { WorldState } from '../../src/persistence.js';
import type { MigrationDef } from '../../src/migration.js';
import { MIG_CODES } from '../../src/migration.js';
import { KEYS, VERSIONS } from './persistence-model.js';

export type EffectSpec =
  | { kind: 'addProp'; key: string; delta: number }
  | { kind: 'throw' };

export interface MigSpec {
  id: string;
  from: string;
  to: string;
  effects: EffectSpec[];
  onFail: 'reject' | 'bestEffort';
}

/**
 * 把 spec 编译成产品侧 MigrationDef，并在每个 effect 入口写入记录器。
 * sink 因此就是"实际执行过的 effect 序列"，链选择与跳过行为都成为可观测事件。
 */
export function buildMigrations(specs: readonly MigSpec[], sink: string[]): MigrationDef[] {
  return specs.map((spec) => ({
    id: spec.id,
    from: spec.from,
    to: spec.to,
    onFail: spec.onFail,
    effects: spec.effects.map((eff, i) => ({
      apply: (s: WorldState): WorldState => {
        sink.push(`${spec.id}#${i}`);
        if (eff.kind === 'throw') throw new Error(`boom:${spec.id}#${i}`);
        return { ...s, props: { ...s.props, [eff.key]: (s.props[eff.key] ?? 0) + eff.delta } };
      },
    })),
  }));
}

export interface ShadowOutcome {
  ok: boolean;
  /** 期望的最终状态；ok=false 且不带 state 时为 null。 */
  state: WorldState | null;
  codes: string[];
  /** 期望执行到的 effect 序列，与 buildMigrations 的 sink 对照。 */
  sink: string[];
}

const WF = /^\d+\.\d+\.\d+$/;

/** 独立的版本比较：按段解析，遇到非法段直接判为不可比（由前置校验拦下）。 */
function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * 穷举 from→to 的全部简单路径（版本不重复）。
 *
 * 刻意用 DFS 穷举而非 BFS 最短路：判据必须与被测实现算法不同，
 * 否则两边同时错就同时看不见。
 */
export function allSimplePaths(
  from: string,
  to: string,
  specs: readonly MigSpec[],
): MigSpec[][] {
  const out: MigSpec[][] = [];
  const walk = (at: string, seen: Set<string>, path: MigSpec[]): void => {
    if (at === to) {
      out.push([...path]);
      return;
    }
    for (const m of specs) {
      if (m.from !== at || seen.has(m.to)) continue;
      seen.add(m.to);
      path.push(m);
      walk(m.to, seen, path);
      path.pop();
      seen.delete(m.to);
    }
  };
  walk(from, new Set([from]), []);
  return out;
}

/**
 * 算术判据：给定**唯一**迁移链的图，独立算出 loadSnapshot 应有的全部输出。
 * chain 为 null 表示无路径。
 */
export function shadowLoad(
  saved: WorldState,
  current: string,
  chain: readonly MigSpec[] | null,
): ShadowOutcome {
  if (!WF.test(saved.version)) return { ok: false, state: null, codes: [MIG_CODES.BAD_VERSION], sink: [] };
  if (!WF.test(current)) return { ok: false, state: null, codes: [MIG_CODES.BAD_VERSION], sink: [] };

  const cmp = cmpVersion(saved.version, current);
  if (cmp === 0) return { ok: true, state: { ...saved, props: { ...saved.props } }, codes: [], sink: [] };
  if (cmp > 0) return { ok: false, state: null, codes: [MIG_CODES.NEWER_SAVE], sink: [] };
  if (chain === null) return { ok: false, state: null, codes: [MIG_CODES.NO_PATH], sink: [] };

  const codes: string[] = [];
  const sink: string[] = [];
  let version = saved.version;
  let props: Record<string, number> = { ...saved.props };

  for (const m of chain) {
    // 事务语义：整跳的 effects 全成功才落盘，中途抛错则整跳丢弃。
    const attempt = { ...props };
    let threw = false;
    for (let i = 0; i < m.effects.length; i++) {
      sink.push(`${m.id}#${i}`);
      const eff = m.effects[i]!;
      if (eff.kind === 'throw') {
        threw = true;
        break;
      }
      attempt[eff.key] = (attempt[eff.key] ?? 0) + eff.delta;
    }
    if (!threw) {
      props = attempt;
      version = m.to;
      continue;
    }
    if (m.onFail === 'bestEffort') {
      codes.push(MIG_CODES.SKIPPED);
      continue;
    }
    return { ok: false, state: null, codes: [...codes, MIG_CODES.FAILED], sink };
  }

  const state: WorldState = {
    version,
    playpackId: saved.playpackId,
    phaseIndex: saved.phaseIndex,
    randomCounter: saved.randomCounter,
    props,
  };
  if (cmpVersion(version, current) !== 0) {
    return { ok: false, state, codes: [...codes, MIG_CODES.INCOMPLETE], sink };
  }
  return { ok: true, state, codes, sink };
}

export function genEffectSpec(): fc.Arbitrary<EffectSpec> {
  return fc.oneof(
    { weight: 3, arbitrary: fc.record({
      kind: fc.constant('addProp' as const),
      key: fc.constantFrom(...KEYS),
      delta: fc.integer({ min: -20, max: 20 }),
    }) },
    { weight: 1, arbitrary: fc.constant({ kind: 'throw' as const }) },
  );
}

/**
 * 线性图：在版本池的升序链上取相邻跳的子集，保证 from→to 至多一条路径。
 * 供算术判据使用。
 */
export function genLinearGraph(): fc.Arbitrary<MigSpec[]> {
  const hops = VERSIONS.slice(0, -1).map((from, i) => ({ from, to: VERSIONS[i + 1]! }));
  return fc
    .tuple(
      ...hops.map(() =>
        fc.record({
          present: fc.boolean(),
          effects: fc.array(genEffectSpec(), { minLength: 0, maxLength: 3 }),
          onFail: fc.constantFrom('reject' as const, 'bestEffort' as const),
        }),
      ),
    )
    .map((cfgs) =>
      cfgs
        .map((cfg, i) => ({ cfg, hop: hops[i]! }))
        .filter(({ cfg }) => cfg.present)
        .map(({ cfg, hop }) => ({
          id: `m:${hop.from}->${hop.to}`,
          from: hop.from,
          to: hop.to,
          effects: cfg.effects,
          onFail: cfg.onFail,
        })),
    );
}

/**
 * 任意图：from/to 都从同一个极小版本池取，于是菱形、平行边、自环、
 * 多条等长路径都能被构造出来——供结构判据使用。
 */
export function genArbitraryGraph(): fc.Arbitrary<MigSpec[]> {
  return fc.array(
    fc.record({
      from: fc.constantFrom(...VERSIONS),
      to: fc.constantFrom(...VERSIONS),
      effects: fc.array(genEffectSpec(), { minLength: 0, maxLength: 2 }),
      onFail: fc.constantFrom('reject' as const, 'bestEffort' as const),
    }),
    { minLength: 0, maxLength: 5 },
  ).map((rows) => rows.map((r, i) => ({ ...r, id: `g${i}:${r.from}->${r.to}` })));
}

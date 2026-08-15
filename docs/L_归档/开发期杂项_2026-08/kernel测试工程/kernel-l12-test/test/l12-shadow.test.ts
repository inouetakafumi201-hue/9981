/**
 * L12 影子模型差分测试。
 *
 * 与原 l12-property.test.ts 的关键区别：期望值由独立算法算出，
 * 不再是"同一函数跑两遍互比"（那对任意确定性纯函数恒真）。
 *
 * 运行规模受 L12_RUNS 控制：变异测试跑几十遍套件，需要收缩后的规模。
 */
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import {
  Journal,
  replay,
  cloneState,
  checkWorldState,
  takeSnapshot,
  SnapshotStore,
  CheckpointStore,
  PhaseBoundaryLog,
} from '../src/persistence';
import { loadSnapshot, compareVersions, MIG_CODES } from '../src/migration';
import {
  buildOp,
  shadowReplay,
  sameState,
  showState,
  genOpSpec,
  genSeedState,
  KEYS,
  VERSIONS,
} from './model/persistence-model';
import {
  buildMigrations,
  shadowLoad,
  allSimplePaths,
  genLinearGraph,
  genArbitraryGraph,
  genEffectSpec,
} from './model/migration-model';

const RUNS = Number(process.env.L12_RUNS ?? 20_000);
const SMALL = Math.max(200, Math.floor(RUNS / 4));

describe('L12 影子模型：replay', () => {
  it('replay 结果与独立算术模型逐字段一致', () => {
    fc.assert(
      fc.property(genSeedState(), fc.array(genOpSpec(), { maxLength: 12 }), (seed, specs) => {
        const actual = replay(seed, specs.map(buildOp));
        const expected = shadowReplay(seed, specs);
        expect(showState(actual)).toBe(showState(expected));
        expect(sameState(actual, expected)).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  it('replay 不修改 seed，即使 Op 原地写（不纯 Op 才让该性质非恒真）', () => {
    fc.assert(
      fc.property(genSeedState(), fc.array(genOpSpec(), { maxLength: 12 }), (seed, specs) => {
        const before = showState(seed);
        const out = replay(seed, specs.map(buildOp));
        expect(showState(seed)).toBe(before);
        // 返回值不得与 seed 共享引用，否则调用方改结果会回写 seed
        expect(out).not.toBe(seed);
        expect(out.props).not.toBe(seed.props);
      }),
      { numRuns: RUNS },
    );
  });

  it('replay 幂等于重复调用：连调两次结果相同且 seed 仍未变', () => {
    fc.assert(
      fc.property(genSeedState(), fc.array(genOpSpec(), { maxLength: 12 }), (seed, specs) => {
        const ops = specs.map(buildOp);
        const before = showState(seed);
        const r1 = showState(replay(seed, ops));
        const r2 = showState(replay(seed, ops));
        // 这条断言只有在 Op 可能不纯时才有内容：纯 Op 下它恒真
        expect(r2).toBe(r1);
        expect(showState(seed)).toBe(before);
      }),
      { numRuns: RUNS },
    );
  });

  it('日志切片重放：从检查点续放等于整段重放', () => {
    fc.assert(
      fc.property(
        genSeedState(),
        fc.array(genOpSpec(), { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 0, max: 10 }),
        (seed, specs, rawCut) => {
          const journal = new Journal();
          for (const spec of specs) journal.append(buildOp(spec));
          const cut = Math.min(rawCut, specs.length);

          const mid = replay(seed, journal.getAll().slice(0, cut).map((e) => e.op));
          const tail = journal.since(cut).map((e) => e.op);
          const resumed = replay(mid, tail);
          const whole = replay(seed, journal.getAll().map((e) => e.op));

          expect(showState(resumed)).toBe(showState(whole));
          expect(tail.length).toBe(specs.length - cut);
        },
      ),
      { numRuns: SMALL },
    );
  });
});

describe('L12 影子模型：快照与检查点隔离', () => {
  it('快照与活状态双向隔离，且任意 Op 序列都不能污染快照', () => {
    fc.assert(
      fc.property(genSeedState(), fc.array(genOpSpec(), { maxLength: 12 }), (seed, specs) => {
        const live = cloneState(seed);
        const snap = takeSnapshot(live);
        const frozen = showState(snap.state);

        replay(live, specs.map(buildOp));
        for (const spec of specs) buildOp(spec).apply(live); // 直接施加，含不纯 Op
        expect(showState(snap.state)).toBe(frozen);

        // 反向：改快照不得影响活状态
        const liveNow = showState(live);
        snap.state.props[KEYS[0]] = 12345;
        snap.state.phaseIndex += 99;
        expect(showState(live)).toBe(liveNow);
      }),
      { numRuns: SMALL },
    );
  });

  it('checkpoint 存取双向隔离，且 restore 每次返回独立副本', () => {
    fc.assert(
      fc.property(genSeedState(), fc.string({ minLength: 1, maxLength: 4 }), (seed, label) => {
        const store = new CheckpointStore();
        const live = cloneState(seed);
        store.checkpoint(label, live);
        const frozen = showState(store.restore(label));

        live.props[KEYS[1]] = 999;
        live.phaseIndex += 1;
        expect(showState(store.restore(label))).toBe(frozen);

        const a = store.restore(label);
        const b = store.restore(label);
        expect(a).not.toBe(b);
        a.props[KEYS[2]] = -777;
        expect(showState(store.restore(label))).toBe(frozen);
        expect(store.checkInvariants()).toEqual([]);
      }),
      { numRuns: SMALL },
    );
  });

  it('rewind(n) 命中倒数第 n+1 个边界，返回副本且可重复', () => {
    fc.assert(
      fc.property(
        fc.array(genSeedState(), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: -2, max: 10 }),
        (states, n) => {
          const log = new PhaseBoundaryLog();
          for (const s of states) log.markBoundary(s);
          const idx = states.length - 1 - n;

          if (n <= 0 || idx < 0) {
            expect(() => log.rewind(n)).toThrow(
              n <= 0 ? 'E_PERSIST_REWIND_INVALID' : 'E_PERSIST_REWIND_OUT_OF_RANGE',
            );
            return;
          }
          const got = log.rewind(n);
          expect(showState(got)).toBe(showState(states[idx]!));
          got.props[KEYS[0]] = 4242;
          expect(showState(log.rewind(n))).toBe(showState(states[idx]!));
          expect(log.count()).toBe(states.length);
          expect(log.checkInvariants()).toEqual([]);
        },
      ),
      { numRuns: SMALL },
    );
  });

  it('SnapshotStore 编号在实例内单调、实例间互不干扰', () => {
    fc.assert(
      fc.property(
        genSeedState(),
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 6 }),
        (seed, na, nb) => {
          const a = new SnapshotStore();
          const b = new SnapshotStore();
          const idsA: string[] = [];
          for (let i = 0; i < na; i++) idsA.push(a.take(seed).id);
          const idsB: string[] = [];
          for (let i = 0; i < nb; i++) idsB.push(b.take(seed).id);

          expect(idsA).toEqual(Array.from({ length: na }, (_, i) => `snap:${i + 1}`));
          expect(idsB).toEqual(Array.from({ length: nb }, (_, i) => `snap:${i + 1}`));
          expect(a.count()).toBe(na);
          expect(b.count()).toBe(nb);
          expect(a.checkInvariants()).toEqual([]);
        },
      ),
      { numRuns: SMALL },
    );
  });
});

describe('L12 影子模型：迁移装载（算术判据）', () => {
  it('线性图上 ok/version/props/诊断码/effect 执行序列全部与模型一致', () => {
    fc.assert(
      fc.property(genSeedState(), fc.constantFrom(...VERSIONS), genLinearGraph(), (seed, current, specs) => {
        const sink: string[] = [];
        const migrations = buildMigrations(specs, sink);
        const actual = loadSnapshot(seed, current, migrations);

        const paths = allSimplePaths(seed.version, current, specs);
        expect(paths.length).toBeLessThanOrEqual(1); // 线性图前提
        const expected = shadowLoad(seed, current, paths[0] ?? null);

        expect(actual.ok).toBe(expected.ok);
        expect(actual.diagnostics.map((d) => d.code)).toEqual(expected.codes);
        if (expected.state === null) {
          expect(actual.state === undefined || actual.state === null).toBe(true);
        } else {
          expect(actual.state).toBeDefined();
          expect(showState(actual.state!)).toBe(showState(expected.state));
        }
        expect(sink).toEqual(expected.sink);
      }),
      { numRuns: RUNS },
    );
  });

  it('装载结果与入参存档不共享引用，改结果不回写存档', () => {
    fc.assert(
      fc.property(genSeedState(), fc.constantFrom(...VERSIONS), genLinearGraph(), (seed, current, specs) => {
        const saved = cloneState(seed);
        const before = showState(saved);
        const result = loadSnapshot(saved, current, buildMigrations(specs, []));
        if (result.state) {
          expect(result.state).not.toBe(saved);
          expect(result.state.props).not.toBe(saved.props);
          result.state.props[KEYS[0]] = 31337;
          result.state.phaseIndex += 5;
        }
        expect(showState(saved)).toBe(before);
      }),
      { numRuns: SMALL },
    );
  });

  it('ok=true 蕴含最终版本等于目标版本（禁止虚假成功）', () => {
    fc.assert(
      fc.property(genSeedState(), fc.constantFrom(...VERSIONS), genArbitraryGraph(), (seed, current, specs) => {
        const result = loadSnapshot(seed, current, buildMigrations(specs, []));
        if (result.ok) {
          expect(result.state).toBeDefined();
          expect(compareVersions(result.state!.version, current)).toBe(0);
          expect(checkWorldState(result.state!)).toEqual([]);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('每条诊断码都在 MIG_CODES 内，且 ok=false 必带至少一条', () => {
    const known = new Set(Object.values(MIG_CODES));
    fc.assert(
      fc.property(genSeedState(), fc.constantFrom(...VERSIONS), genArbitraryGraph(), (seed, current, specs) => {
        const result = loadSnapshot(seed, current, buildMigrations(specs, []));
        for (const d of result.diagnostics) {
          expect(known.has(d.code as never)).toBe(true);
          expect(d.detail.length).toBeGreaterThan(0);
        }
        if (!result.ok) expect(result.diagnostics.length).toBeGreaterThan(0);
      }),
      { numRuns: RUNS },
    );
  });
});

describe('L12 影子模型：迁移链选择（结构判据）', () => {
  it('实际执行的链首尾相接、跳数最小；无路径时报 NO_PATH', () => {
    fc.assert(
      fc.property(genSeedState(), fc.constantFrom(...VERSIONS), genArbitraryGraph(), (seed, current, specs) => {
        // 全部 effect 换成纯累加，避免抛错跳过干扰"链结构"这一被测面。
        // 同时保证每跳**至少一个** effect：effects 为空的跳不写 sink，
        // 于是它在链中的存在不可观测，"链是否最小"就只能靠猜。
        const pure = specs.map((m) => ({
          ...m,
          effects: [
            { kind: 'addProp' as const, key: KEYS[0], delta: 1 },
            ...m.effects.map((e) =>
              e.kind === 'throw' ? { kind: 'addProp' as const, key: KEYS[1], delta: 1 } : e,
            ),
          ],
        }));
        const sink: string[] = [];
        const result = loadSnapshot(seed, current, buildMigrations(pure, sink));
        const paths = allSimplePaths(seed.version, current, pure);
        const cmp = compareVersions(seed.version, current);

        if (cmp >= 0) return; // 同版本/更新存档不进入链查找
        if (paths.length === 0) {
          expect(result.ok).toBe(false);
          expect(result.diagnostics.map((d) => d.code)).toEqual([MIG_CODES.NO_PATH]);
          expect(sink).toEqual([]);
          return;
        }

        // 从 sink 还原实际执行的跳序列
        const executed: string[] = [];
        for (const entry of sink) {
          const id = entry.slice(0, entry.lastIndexOf('#'));
          if (executed[executed.length - 1] !== id) executed.push(id);
        }
        // 每跳都有 effect，故 executed 就是实际执行的完整链。
        const byId = new Map(pure.map((m) => [m.id, m]));
        let at = seed.version;
        for (const id of executed) {
          const m = byId.get(id)!;
          expect(m.from).toBe(at); // 首尾相接
          at = m.to;
        }
        expect(at).toBe(current); // 链确实抵达目标版本
        expect(result.ok).toBe(true);
        expect(compareVersions(result.state!.version, current)).toBe(0);

        // 跳数最小性：由独立的 DFS 穷举求下界，与产品的 BFS 无关。
        const minHops = Math.min(...paths.map((p) => p.length));
        expect(executed.length).toBe(minHops);
      }),
      { numRuns: SMALL },
    );
  });

  it('reject 模式下任一跳抛错则整体回滚，不留部分应用状态', () => {
    fc.assert(
      fc.property(
        genSeedState(),
        fc.array(genEffectSpec(), { minLength: 1, maxLength: 4 }),
        (seed, effects) => {
          const oldest = VERSIONS[0];
          const newest = VERSIONS[VERSIONS.length - 1]!;
          const saved = cloneState({ ...seed, version: oldest });
          const before = showState(saved);
          const specs = [{
            id: 'm', from: oldest, to: newest,
            effects: [...effects, { kind: 'throw' as const }], onFail: 'reject' as const,
          }];
          const result = loadSnapshot(saved, newest, buildMigrations(specs, []));
          expect(result.ok).toBe(false);
          expect(result.diagnostics.map((d) => d.code)).toEqual([MIG_CODES.FAILED]);
          expect(result.state === undefined || result.state === null).toBe(true);
          expect(showState(saved)).toBe(before);
        },
      ),
      { numRuns: SMALL },
    );
  });
});

describe('L12 影子模型：版本比较全序', () => {
  const genV = () =>
    fc.tuple(
      fc.integer({ min: 0, max: 3 }),
      fc.integer({ min: 0, max: 3 }),
      fc.integer({ min: 0, max: 3 }),
    ).map(([a, b, c]) => `${a}.${b}.${c}`);

  it('自反性', () => {
    fc.assert(fc.property(genV(), (v) => compareVersions(v, v) === 0), { numRuns: SMALL });
  });

  it('反对称性', () => {
    fc.assert(
      fc.property(genV(), genV(), (a, b) =>
        Math.sign(compareVersions(a, b)) === -Math.sign(compareVersions(b, a)),
      ),
      { numRuns: SMALL },
    );
  });

  /**
   * 传递性：原套件缺这条。段值池取 0..3 而非 0..9，
   * 是为了让三元组中"两段相等、第三段决胜"的情形高频出现——
   * 池子一大，随机三元组几乎总在首段就分出胜负，
   * 次段与末段的比较分支便永远得不到表决机会。
   */
  it('传递性：a<=b 且 b<=c 蕴含 a<=c', () => {
    fc.assert(
      fc.property(genV(), genV(), genV(), (a, b, c) => {
        if (compareVersions(a, b) <= 0 && compareVersions(b, c) <= 0) {
          expect(compareVersions(a, c)).toBeLessThanOrEqual(0);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('与逐段字典序一致（独立判据，不复用 compareVersions）', () => {
    fc.assert(
      fc.property(genV(), genV(), (a, b) => {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        let expected = 0;
        for (let i = 0; i < 3; i++) {
          if (pa[i]! !== pb[i]!) {
            expected = pa[i]! < pb[i]! ? -1 : 1;
            break;
          }
        }
        expect(Math.sign(compareVersions(a, b))).toBe(expected);
      }),
      { numRuns: RUNS },
    );
  });
});

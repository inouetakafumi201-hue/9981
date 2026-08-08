/**
 * L12 持久化影子模型。
 *
 * 为什么需要它：原套件的"replay 确定性"属性是 `replay(seed,ops)` 与
 * `replay(seed,ops)` 互比——对任意确定性无副作用函数恒真，10 万次也测不出东西。
 * 影子模型必须用**另一套算法**独立算出期望值，才构成真正的判据。
 *
 * 做法：Op 不再是黑箱闭包，而是声明式 spec。
 *  - 产品侧：spec 编译成 Op，交给 replay 执行。
 *  - 影子侧：spec 由本模型直接做算术，不碰 replay、不碰 Op.apply。
 * 两侧算法不同，结果必须相同。
 */
import fc from 'fast-check';
import type { Op, WorldState } from '../../src/persistence.js';

/**
 * 键池刻意极小：只有池子小到会反复撞键，
 * "同一键被多次累加"和"删后再加"这类交互才可能被构造出来。
 * 池子一大，每次生成的键几乎互不相同，累加路径永远只走一步。
 */
export const KEYS = ['a', 'b', 'c'] as const;

/** 版本池同样极小且与迁移图共用，保证版本相等/相邻的情形可构造。 */
export const VERSIONS = ['1.0.0', '1.1.0', '2.0.0'] as const;

export type OpSpec =
  | { kind: 'addProp'; key: string; delta: number }
  | { kind: 'setProp'; key: string; value: number }
  | { kind: 'delProp'; key: string }
  | { kind: 'advancePhase' }
  | { kind: 'roll' }
  /**
   * 原地修改 seed 的不纯 Op。
   *
   * 必须存在：原套件的"快照隔离"属性生成的 Op 全是 {...s} 纯拷贝，
   * 于是"replay 会不会改坏 seed"这件事根本无法发生——断言恒真。
   * 只有引入真正会原地写的 Op，别名缺陷才成为可观测事件。
   */
  | { kind: 'impureAddProp'; key: string; delta: number };

/** 把 spec 编译成产品侧 Op。id 携带全部参数，便于失败时定位。 */
export function buildOp(spec: OpSpec): Op {
  switch (spec.kind) {
    case 'addProp':
      return {
        id: `add:${spec.key}:${spec.delta}`,
        apply: (s) => ({ ...s, props: { ...s.props, [spec.key]: (s.props[spec.key] ?? 0) + spec.delta } }),
      };
    case 'setProp':
      return {
        id: `set:${spec.key}:${spec.value}`,
        apply: (s) => ({ ...s, props: { ...s.props, [spec.key]: spec.value } }),
      };
    case 'delProp':
      return {
        id: `del:${spec.key}`,
        apply: (s) => {
          const props = { ...s.props };
          delete props[spec.key];
          return { ...s, props };
        },
      };
    case 'advancePhase':
      return { id: 'advancePhase', apply: (s) => ({ ...s, phaseIndex: s.phaseIndex + 1 }) };
    case 'roll':
      return { id: 'roll', apply: (s) => ({ ...s, randomCounter: s.randomCounter + 1 }) };
    case 'impureAddProp':
      return {
        id: `impure:${spec.key}:${spec.delta}`,
        apply: (s) => {
          // 刻意原地写并返回同一引用：这正是要让 replay 防住的输入。
          s.props[spec.key] = (s.props[spec.key] ?? 0) + spec.delta;
          return s;
        },
      };
  }
}

/**
 * 影子重放：不调用 replay，也不调用 Op.apply。
 *
 * 直接在一份普通对象上按 spec 语义做算术。impureAddProp 的语义与 addProp
 * 在"最终状态"上一致（差别只在是否污染入参），故影子侧同样处理——
 * 两者的差异由 seed 未被修改这条独立断言负责。
 */
export function shadowReplay(seed: WorldState, specs: readonly OpSpec[]): WorldState {
  const props: Record<string, number> = { ...seed.props };
  let phaseIndex = seed.phaseIndex;
  let randomCounter = seed.randomCounter;

  for (const spec of specs) {
    switch (spec.kind) {
      case 'addProp':
      case 'impureAddProp':
        props[spec.key] = (props[spec.key] ?? 0) + spec.delta;
        break;
      case 'setProp':
        props[spec.key] = spec.value;
        break;
      case 'delProp':
        delete props[spec.key];
        break;
      case 'advancePhase':
        phaseIndex += 1;
        break;
      case 'roll':
        randomCounter += 1;
        break;
    }
  }

  return { version: seed.version, playpackId: seed.playpackId, phaseIndex, randomCounter, props };
}

/** 键序无关的状态比较：props 的插入顺序不属于契约。 */
export function sameState(a: WorldState, b: WorldState): boolean {
  if (a.version !== b.version || a.playpackId !== b.playpackId) return false;
  if (a.phaseIndex !== b.phaseIndex || a.randomCounter !== b.randomCounter) return false;
  const ka = Object.keys(a.props).sort();
  const kb = Object.keys(b.props).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => a.props[k] === b.props[k]);
}

/** 稳定序列化，用于断言失败时的可读输出。 */
export function showState(s: WorldState): string {
  const props = Object.keys(s.props).sort().map((k) => `${k}=${s.props[k]}`).join(',');
  return `v${s.version}/${s.playpackId}/p${s.phaseIndex}/r${s.randomCounter}/{${props}}`;
}

export function genOpSpec(): fc.Arbitrary<OpSpec> {
  return fc.oneof(
    fc.record({
      kind: fc.constant('addProp' as const),
      key: fc.constantFrom(...KEYS),
      delta: fc.integer({ min: -100, max: 100 }),
    }),
    fc.record({
      kind: fc.constant('setProp' as const),
      key: fc.constantFrom(...KEYS),
      value: fc.integer({ min: -100, max: 100 }),
    }),
    fc.record({ kind: fc.constant('delProp' as const), key: fc.constantFrom(...KEYS) }),
    fc.constant({ kind: 'advancePhase' as const }),
    fc.constant({ kind: 'roll' as const }),
    fc.record({
      kind: fc.constant('impureAddProp' as const),
      key: fc.constantFrom(...KEYS),
      delta: fc.integer({ min: -100, max: 100 }),
    }),
  );
}

/**
 * 种子状态生成器。
 *
 * 原套件的 makeState() 返回固定状态且 props 为空——props 相关的
 * 一切保持性质都在"空对象 vs 空对象"上验证，等于没验证。
 * 这里让每个字段都有多种取值，且 props 可预置非空。
 */
export function genSeedState(): fc.Arbitrary<WorldState> {
  return fc.record({
    version: fc.constantFrom(...VERSIONS),
    playpackId: fc.constantFrom('pp:1', 'pp:2'),
    phaseIndex: fc.integer({ min: 0, max: 3 }),
    randomCounter: fc.integer({ min: 0, max: 3 }),
    props: fc.dictionary(fc.constantFrom(...KEYS), fc.integer({ min: -50, max: 50 }), {
      maxKeys: 3,
    }),
  });
}

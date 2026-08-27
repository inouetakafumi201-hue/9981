/**
 * 任意深度嵌套 WorldState 的 fast-check arbitrary 生成器（design.md 6.3节 / 需求43.4）。
 *
 * 本文件在 Task 1 只搭生成器接口占位，具体字段生成器随每层任务补充：
 * - L1 完成后补充 nodeArb/entityArb/containerArb 等具体结构生成器
 * - L1 Topology 完成后补充含多层微型场景/容器嵌套的合成器
 * 这里先给出 Value 的生成器（跨层复用）与一个可扩展的 WorldState 骨架生成器。
 */
import fc from 'fast-check';
import type { Value } from '../state/value';
import type { WorldState } from '../state/world-state';
import { createEmptyWorldState } from '../state/world-state';
import { WORLD_REF } from '../state/ids';

/** 任意合法 Value 的生成器，跨层测试复用（需求1.1、4.2 的属性测试基础设施）。 */
export const valueArb: fc.Arbitrary<Value> = fc.letrec<{ value: Value }>((tie) => ({
  value: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.constant(null),
    fc.boolean(),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
    fc.string({ maxLength: 12 }),
    fc.constant(WORLD_REF),
    fc.array(tie('value'), { maxLength: 4 }),
    fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), tie('value'), { maxKeys: 4 }),
  ) as fc.Arbitrary<Value>,
})).value;

/**
 * 空 WorldState 的生成器占位：当前只生成一个合法的空状态（含固定 scheduleId）。
 * 后续各层任务（L1 Topology 起）应在此基础上组合出含嵌套容器/微型场景/Def 继承链的生成器，
 * 而不是新写一套简化版生成器——这是需求43"拓扑可达性"在测试基础设施层面的强制要求。
 */
export function emptyWorldStateArb(): fc.Arbitrary<WorldState> {
  return fc.constant(createEmptyWorldState('sched:default'));
}

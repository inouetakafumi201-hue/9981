/**
 * L4 调度模型对照测试
 *
 * 用小事件池（2~3 个事件名）强制产生重入、深度嵌套、反应轮饱和，
 * 并把真实系统的执行轨迹与独立模型逐条比对。
 * 轨迹比对比"结果比对"强得多：阶段顺序、prevent 中断位置、
 * 嵌套深度、被跳过的 Hook，任何一处偏差都会立刻暴露。
 */
import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { HookPhase, HookSystem } from '../src/index.js';
import { runModel } from './model/dispatch-model.js';
import type { Action, HookSpec, Scenario } from './model/dispatch-model.js';

const RUNS = Number(process.env.L4_RUNS ?? 100_000);

const TYPES = ['A', 'B'];
const IDS = ['h1', 'h2'];
const PHASES: HookPhase[] = [HookPhase.Before, HookPhase.Modify, HookPhase.Instead, HookPhase.After];
const PRIORITIES = [0, 1];

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  fc.constant<Action>({ kind: 'noop' }),
  fc.record({ kind: fc.constant<'emit'>('emit'), target: fc.constantFrom(...TYPES) }),
  fc.record({ kind: fc.constant<'react'>('react'), target: fc.constantFrom(...TYPES) }),
  fc.constant<Action>({ kind: 'preventAll' }),
  fc.record({
    kind: fc.constant<'preventExcept'>('preventExcept'),
    types: fc.array(fc.constantFrom(...TYPES), { minLength: 0, maxLength: 2 }),
  }),
  fc.constant<Action>({ kind: 'throw' }),
);

const hookArb: fc.Arbitrary<HookSpec> = fc.record({
  id: fc.constantFrom(...IDS),
  on: fc.constantFrom(...TYPES),
  phase: fc.constantFrom(...PHASES),
  priority: fc.constantFrom(...PRIORITIES),
  when: fc.boolean(),
  action: actionArb,
});

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  hooks: fc.array(hookArb, { minLength: 0, maxLength: 6 }),
  defaults: fc.uniqueArray(fc.constantFrom(...TYPES), { minLength: 0, maxLength: 2 }),
  rootType: fc.constantFrom(...TYPES),
});

/** 把场景装进真实系统，并返回规范化轨迹 + 错误码。 */
function runReal(scenario: Scenario): { trace: string[]; error: string } {
  const system = new HookSystem();

  for (const spec of scenario.hooks) {
    system.registerHook({
      id: spec.id,
      on: spec.on,
      phase: spec.phase,
      priority: spec.priority,
      when: () => spec.when,
      effect: (ctx) => {
        switch (spec.action.kind) {
          case 'noop':
            return undefined;
          case 'emit':
            ctx.emit(spec.action.target);
            return undefined;
          case 'react':
            ctx.react(spec.action.target);
            return undefined;
          case 'preventAll':
            return { preventAll: true };
          case 'preventExcept':
            return { preventExcept: spec.action.types };
          case 'throw':
            throw new Error('boom');
          default: {
            const exhaustive: never = spec.action;
            void exhaustive;
            return undefined;
          }
        }
      },
    });
  }

  for (const type of scenario.defaults) {
    system.registerDefaultHandler(type, () => undefined);
  }

  system.startRecording();
  let error = '';
  try {
    system.emit(scenario.rootType);
  } catch (caught) {
    error = (caught as Error).message;
  }
  const trace = system
    .takeTrace()
    .map((entry) => `${entry.kind}:${entry.type}:${entry.phase}:${entry.hookId}:${entry.depth}`);
  system.stopRecording();

  return { trace, error };
}

describe('L4 调度模型对照', () => {
  test(`执行轨迹与独立模型逐条一致（${RUNS.toLocaleString('en-US')}次）`, () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const real = runReal(scenario);
        const model = runModel(scenario);
        const context = `场景=${JSON.stringify(scenario)}`;
        assert.equal(real.error, model.error, `错误码分歧\n${context}`);
        assert.deepEqual(
          real.trace,
          model.trace,
          `轨迹分歧\n${context}\n实际=${JSON.stringify(real.trace, null, 1)}\n模型=${JSON.stringify(model.trace, null, 1)}`,
        );
        return true;
      }),
      { numRuns: RUNS },
    );
  });

  test('任何场景执行后系统回到干净空闲态（30,000次）', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const system = new HookSystem();
        for (const spec of scenario.hooks) {
          system.registerHook({
            id: spec.id,
            on: spec.on,
            phase: spec.phase,
            priority: spec.priority,
            when: () => spec.when,
            effect: (ctx) => {
              switch (spec.action.kind) {
                case 'emit':
                  ctx.emit(spec.action.target);
                  return undefined;
                case 'react':
                  ctx.react(spec.action.target);
                  return undefined;
                case 'preventAll':
                  return { preventAll: true };
                case 'preventExcept':
                  return { preventExcept: spec.action.types };
                case 'throw':
                  throw new Error('boom');
                default:
                  return undefined;
              }
            },
          });
        }
        for (const type of scenario.defaults) {
          system.registerDefaultHandler(type, () => undefined);
        }

        try {
          system.emit(scenario.rootType);
        } catch {
          // 抛错路径同样必须回到干净态
        }

        const violations = system.checkInvariants();
        assert.deepEqual(
          violations,
          [],
          `执行后存在不变量违规\n场景=${JSON.stringify(scenario)}\n违规=${violations.join(' | ')}`,
        );
        return true;
      }),
      { numRuns: 30_000 },
    );
  });

  test('连续两次 emit 相互不污染：第二次轨迹与单独执行一致（20,000次）', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const first = runReal(scenario);
        const twice = (() => {
          const system = new HookSystem();
          for (const spec of scenario.hooks) {
            system.registerHook({
              id: spec.id,
              on: spec.on,
              phase: spec.phase,
              priority: spec.priority,
              when: () => spec.when,
              effect: (ctx) => {
                switch (spec.action.kind) {
                  case 'emit':
                    ctx.emit(spec.action.target);
                    return undefined;
                  case 'react':
                    ctx.react(spec.action.target);
                    return undefined;
                  case 'preventAll':
                    return { preventAll: true };
                  case 'preventExcept':
                    return { preventExcept: spec.action.types };
                  case 'throw':
                    throw new Error('boom');
                  default:
                    return undefined;
                }
              },
            });
          }
          for (const type of scenario.defaults) {
            system.registerDefaultHandler(type, () => undefined);
          }
          try {
            system.emit(scenario.rootType);
          } catch {
            /* 第一次可能抛错 */
          }
          system.startRecording();
          let error = '';
          try {
            system.emit(scenario.rootType);
          } catch (caught) {
            error = (caught as Error).message;
          }
          const trace = system
            .takeTrace()
            .map((e) => `${e.kind}:${e.type}:${e.phase}:${e.hookId}:${e.depth}`);
          return { trace, error };
        })();

        assert.equal(twice.error, first.error, `第二次 emit 错误码与首次不同\n场景=${JSON.stringify(scenario)}`);
        assert.deepEqual(
          twice.trace,
          first.trace,
          `第二次 emit 轨迹与首次不同（状态泄漏）\n场景=${JSON.stringify(scenario)}`,
        );
        return true;
      }),
      { numRuns: 20_000 },
    );
  });
});

/**
 * L4 回归与契约边界
 *
 * 与 l4-property.test.ts 的分工：那里覆盖"典型行为"，
 * 这里逐条钉死**边界与已修缺陷**，每条用例只锁一件事，
 * 便于变异测试定位盲区。
 */
import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { HookPhase, HookSystem, createEntity } from '../src/index.js';
import type { Context, Item } from '../src/index.js';

const noop = (): void => undefined;

const errorOf = (fn: () => void): string => {
  try {
    fn();
    return '';
  } catch (error) {
    return (error as Error).message;
  }
};

const item = (id: string, def: string, rules: Item['rules'], destroyed = false): Item => ({
  id,
  def,
  rules,
  destroyed,
});

describe('BUG L4#1：根 emit 的反应态归零必须异常安全', () => {
  test('Hook 抛错穿透根 emit 后，反应队列不残留', () => {
    const system = new HookSystem();
    system.registerHook({
      id: 'queuer',
      on: 'A',
      phase: HookPhase.Before,
      effect: (ctx) => ctx.react('A'),
    });
    system.registerHook({
      id: 'boom',
      on: 'A',
      phase: HookPhase.Modify,
      effect: () => {
        throw new Error('boom');
      },
    });

    assert.equal(errorOf(() => system.emit('A')), 'boom');
    assert.deepEqual(
      system.checkInvariants(),
      [],
      '抛错后空闲态不干净（反应队列或计数器残留）',
    );
    assert.equal(system.snapshot().queueLength, 0);
    assert.equal(system.snapshot().reactionRounds, 0);
  });

  test('重入错误穿透根 emit 后，反应队列不残留', () => {
    const system = new HookSystem();
    system.registerHook({
      id: 'h',
      on: 'A',
      phase: HookPhase.Before,
      effect: (ctx) => {
        ctx.react('A');
        ctx.emit('A');
      },
    });
    assert.equal(errorOf(() => system.emit('A')), 'E_HOOK_REENTRY');
    assert.deepEqual(system.checkInvariants(), []);
  });

  test('depth 超限穿透根 emit 后，反应队列不残留', () => {
    const system = new HookSystem();
    for (let index = 0; index < 33; index++) {
      system.registerHook({
        id: `h${index}`,
        on: `e${index}`,
        phase: HookPhase.After,
        effect: (ctx) => {
          ctx.react('side');
          if (index < 32) ctx.emit(`e${index + 1}`);
        },
      });
    }
    assert.equal(errorOf(() => system.emit('e0')), 'E_HOOK_DEPTH_EXCEEDED');
    assert.deepEqual(system.checkInvariants(), []);
  });

  test('抛错后下一次 emit 的反应轮预算是完整的 8 轮', () => {
    const system = new HookSystem();
    let count = 0;
    system.registerHook({
      id: 'loop',
      on: 'ping',
      phase: HookPhase.After,
      effect: (ctx) => {
        count++;
        ctx.react('ping');
      },
    });
    system.registerHook({
      id: 'boom',
      on: 'bad',
      phase: HookPhase.After,
      effect: (ctx) => {
        ctx.react('ping');
        throw new Error('boom');
      },
    });

    assert.equal(errorOf(() => system.emit('bad')), 'boom');
    count = 0;
    system.emit('ping');
    assert.equal(count, 8, '上一次抛错污染了本次反应轮预算');
  });
});

describe('L4 反应轮边界', () => {
  test('反应轮恰好 8 轮后静默截断，不抛错', () => {
    const system = new HookSystem();
    let count = 0;
    system.registerHook({
      id: 'loop',
      on: 'ping',
      phase: HookPhase.After,
      effect: (ctx) => {
        count++;
        ctx.react('ping');
      },
    });
    assert.doesNotThrow(() => system.emit('ping'));
    assert.equal(count, 8);
    assert.deepEqual(system.checkInvariants(), []);
  });

  test('同一轮内的多个 react 全部执行，且在下一轮之前', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerHook({
      id: 'root',
      on: 'A',
      phase: HookPhase.After,
      effect: (ctx) => {
        ctx.react('B');
        ctx.react('C');
      },
    });
    system.registerHook({
      id: 'b',
      on: 'B',
      phase: HookPhase.After,
      effect: (ctx) => {
        log.push('B');
        ctx.react('D');
      },
    });
    system.registerHook({
      id: 'c',
      on: 'C',
      phase: HookPhase.After,
      effect: () => {
        log.push('C');
      },
    });
    system.registerHook({
      id: 'd',
      on: 'D',
      phase: HookPhase.After,
      effect: () => {
        log.push('D');
      },
    });
    system.emit('A');
    // B 与 C 同属第 2 轮，D 属第 3 轮：D 必须在 C 之后
    assert.deepEqual(log, ['B', 'C', 'D'], '轮次语义退化为逐事件处理');
  });

  test('嵌套 emit 内部的 react 归入外层根事件的反应队列', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerHook({
      id: 'outer',
      on: 'A',
      phase: HookPhase.After,
      effect: (ctx) => {
        log.push('A');
        ctx.emit('B');
        log.push('A-end');
      },
    });
    system.registerHook({
      id: 'inner',
      on: 'B',
      phase: HookPhase.After,
      effect: (ctx) => {
        log.push('B');
        ctx.react('C');
      },
    });
    system.registerHook({
      id: 'reacted',
      on: 'C',
      phase: HookPhase.After,
      effect: () => {
        log.push('C');
      },
    });
    system.emit('A');
    // C 必须在根 dispatch 完全结束后才执行，而不是在 B 内部立即执行
    assert.deepEqual(log, ['A', 'B', 'A-end', 'C']);
  });

  test('react 的事件即使无任何 Hook 也不报错', () => {
    const system = new HookSystem();
    system.registerHook({
      id: 'r',
      on: 'A',
      phase: HookPhase.After,
      effect: (ctx) => ctx.react('nobody-listens'),
    });
    assert.doesNotThrow(() => system.emit('A'));
    assert.deepEqual(system.checkInvariants(), []);
  });
});

describe('L4 depth 边界', () => {
  test('第 32 层允许，第 33 层抛错', () => {
    const build = (chainLength: number): HookSystem => {
      const system = new HookSystem();
      for (let index = 0; index < chainLength; index++) {
        system.registerHook({
          id: `h${index}`,
          on: `e${index}`,
          phase: HookPhase.After,
          effect: (ctx) => {
            if (index + 1 < chainLength) ctx.emit(`e${index + 1}`);
          },
        });
      }
      return system;
    };
    assert.doesNotThrow(() => build(32).emit('e0'));
    assert.equal(errorOf(() => build(33).emit('e0')), 'E_HOOK_DEPTH_EXCEEDED');
  });

  test('depth 上限常量就是 32', () => {
    assert.equal(new HookSystem().MAX_DEPTH, 32);
  });

  test('反应轮上限常量就是 8', () => {
    assert.equal(new HookSystem().MAX_REACTION_ROUNDS, 8);
  });

  test('depth 超限后系统可继续正常工作', () => {
    const system = new HookSystem();
    for (let index = 0; index < 33; index++) {
      system.registerHook({
        id: `h${index}`,
        on: `e${index}`,
        phase: HookPhase.After,
        effect: (ctx) => {
          if (index < 32) ctx.emit(`e${index + 1}`);
        },
      });
    }
    assert.throws(() => system.emit('e0'));
    assert.deepEqual(system.checkInvariants(), []);
    assert.doesNotThrow(() => system.emit('e31'));
  });
});

describe('L4 重入锁边界', () => {
  test('同 type 同 hookId 判定为重入', () => {
    const system = new HookSystem();
    system.registerHook({
      id: 'self',
      on: 'A',
      phase: HookPhase.After,
      effect: (ctx) => ctx.emit('A'),
    });
    assert.equal(errorOf(() => system.emit('A')), 'E_HOOK_REENTRY');
  });

  test('同 type 不同 hookId 不是重入', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerHook({
      id: 'one',
      on: 'A',
      phase: HookPhase.Before,
      effect: () => {
        log.push('one');
      },
    });
    system.registerHook({
      id: 'two',
      on: 'A',
      phase: HookPhase.Before,
      effect: () => {
        log.push('two');
      },
    });
    assert.doesNotThrow(() => system.emit('A'));
    assert.deepEqual(log, ['one', 'two']);
  });

  test('不同 type 同 hookId 不是重入', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerHook({
      id: 'shared',
      on: 'A',
      phase: HookPhase.After,
      effect: (ctx) => {
        log.push('A');
        ctx.emit('B');
      },
    });
    system.registerHook({
      id: 'shared',
      on: 'B',
      phase: HookPhase.After,
      effect: () => {
        log.push('B');
      },
    });
    assert.doesNotThrow(() => system.emit('A'));
    assert.deepEqual(log, ['A', 'B']);
  });

  test('重入判定的两个维度都必要：单看 type 或单看 hookId 都会误判', () => {
    const system = new HookSystem();
    const log: string[] = [];
    // 同 type 不同 id（单看 type 会误报）+ 不同 type 同 id（单看 id 会误报）
    system.registerHook({
      id: 'a',
      on: 'X',
      phase: HookPhase.After,
      effect: (ctx) => {
        log.push('a');
        ctx.emit('Y');
      },
    });
    system.registerHook({
      id: 'b',
      on: 'X',
      phase: HookPhase.After,
      effect: () => {
        log.push('b');
      },
    });
    system.registerHook({
      id: 'a',
      on: 'Y',
      phase: HookPhase.After,
      effect: () => {
        log.push('a-on-Y');
      },
    });
    assert.doesNotThrow(() => system.emit('X'));
    assert.deepEqual(log, ['a', 'a-on-Y', 'b']);
  });

  test('重入锁在 Hook 抛错后释放', () => {
    const system = new HookSystem();
    let shouldThrow = true;
    system.registerHook({
      id: 'unstable',
      on: 'A',
      phase: HookPhase.After,
      effect: () => {
        if (shouldThrow) {
          shouldThrow = false;
          throw new Error('boom');
        }
      },
    });
    assert.equal(errorOf(() => system.emit('A')), 'boom');
    assert.deepEqual(system.checkInvariants(), []);
    assert.doesNotThrow(() => system.emit('A'));
  });

  test('重入错误早于 depth 上限触发', () => {
    const system = new HookSystem();
    let count = 0;
    system.registerHook({
      id: 'self',
      on: 'A',
      phase: HookPhase.After,
      effect: (ctx) => {
        count++;
        ctx.emit('A');
      },
    });
    assert.equal(errorOf(() => system.emit('A')), 'E_HOOK_REENTRY');
    assert.equal(count, 1, 'depth 上限先于重入触发了');
  });
});

describe('L4 prevent 语义边界', () => {
  test('preventAll 阻止 default 并中断 instead 链', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerHook({
      id: 'first',
      on: 'A',
      phase: HookPhase.Instead,
      priority: 2,
      effect: () => {
        log.push('first');
        return { preventAll: true };
      },
    });
    system.registerHook({
      id: 'second',
      on: 'A',
      phase: HookPhase.Instead,
      priority: 1,
      effect: () => {
        log.push('second');
      },
    });
    system.registerDefaultHandler('A', () => log.push('default'));
    system.emit('A');
    assert.deepEqual(log, ['first']);
  });

  test('preventExcept 含当前事件时放行 default 且不中断链', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerHook({
      id: 'allow',
      on: 'fire',
      phase: HookPhase.Instead,
      priority: 2,
      effect: () => {
        log.push('allow');
        return { preventExcept: ['fire'] };
      },
    });
    system.registerHook({
      id: 'next',
      on: 'fire',
      phase: HookPhase.Instead,
      priority: 1,
      effect: () => {
        log.push('next');
      },
    });
    system.registerDefaultHandler('fire', () => log.push('default'));
    system.emit('fire');
    assert.deepEqual(log, ['allow', 'next', 'default']);
  });

  test('preventExcept 不含当前事件时阻止 default 并中断链', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerHook({
      id: 'block',
      on: 'fire',
      phase: HookPhase.Instead,
      priority: 2,
      effect: () => {
        log.push('block');
        return { preventExcept: ['ice'] };
      },
    });
    system.registerHook({
      id: 'next',
      on: 'fire',
      phase: HookPhase.Instead,
      priority: 1,
      effect: () => {
        log.push('next');
      },
    });
    system.registerDefaultHandler('fire', () => log.push('default'));
    system.emit('fire');
    assert.deepEqual(log, ['block']);
  });

  test('preventExcept 为空数组等价于全阻止', () => {
    const system = new HookSystem();
    let defaulted = false;
    system.registerHook({
      id: 'block',
      on: 'A',
      phase: HookPhase.Instead,
      effect: () => ({ preventExcept: [] }),
    });
    system.registerDefaultHandler('A', () => {
      defaulted = true;
    });
    system.emit('A');
    assert.equal(defaulted, false);
  });

  test('before / modify / after 阶段返回 prevent 一律无效', () => {
    for (const phase of [HookPhase.Before, HookPhase.Modify, HookPhase.After]) {
      const system = new HookSystem();
      const log: string[] = [];
      system.registerHook({
        id: 'blocker',
        on: 'A',
        phase,
        effect: () => {
          log.push('blocker');
          return { preventAll: true };
        },
      });
      system.registerHook({
        id: 'follower',
        on: 'A',
        phase,
        effect: () => {
          log.push('follower');
        },
      });
      system.registerDefaultHandler('A', () => log.push('default'));
      system.emit('A');
      assert.ok(log.includes('default'), `${phase} 阶段的 preventAll 错误地阻止了 default`);
      assert.ok(log.includes('follower'), `${phase} 阶段的 preventAll 错误地中断了同阶段后续 Hook`);
    }
  });

  test('instead 阶段不阻止时 default 执行', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerHook({
      id: 'observer',
      on: 'A',
      phase: HookPhase.Instead,
      effect: () => {
        log.push('instead');
      },
    });
    system.registerDefaultHandler('A', () => log.push('default'));
    system.emit('A');
    assert.deepEqual(log, ['instead', 'default']);
  });
});

describe('L4 五阶段顺序', () => {
  test('完整顺序 before → modify → instead → default → after', () => {
    const system = new HookSystem();
    const log: string[] = [];
    for (const phase of [HookPhase.Before, HookPhase.Modify, HookPhase.Instead, HookPhase.After]) {
      system.registerHook({
        id: phase,
        on: 'A',
        phase,
        effect: () => {
          log.push(phase);
        },
      });
    }
    system.registerDefaultHandler('A', () => log.push('default'));
    system.emit('A');
    assert.deepEqual(log, ['before', 'modify', 'instead', 'default', 'after']);
  });

  test('每个阶段单独缺失时其余阶段顺序不变', () => {
    const phases = [HookPhase.Before, HookPhase.Modify, HookPhase.Instead, HookPhase.After];
    for (const omitted of phases) {
      const system = new HookSystem();
      const log: string[] = [];
      for (const phase of phases) {
        if (phase === omitted) continue;
        system.registerHook({
          id: phase,
          on: 'A',
          phase,
          effect: () => {
            log.push(phase);
          },
        });
      }
      system.emit('A');
      assert.deepEqual(
        log,
        phases.filter((p) => p !== omitted),
        `缺失 ${omitted} 时其余阶段顺序错乱`,
      );
    }
  });

  test('阶段内按注册顺序执行，priority 不影响非 instead 阶段', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerHook({
      id: 'low-first',
      on: 'A',
      phase: HookPhase.Before,
      priority: 1,
      effect: () => {
        log.push('low-first');
      },
    });
    system.registerHook({
      id: 'high-second',
      on: 'A',
      phase: HookPhase.Before,
      priority: 100,
      effect: () => {
        log.push('high-second');
      },
    });
    system.emit('A');
    assert.deepEqual(log, ['low-first', 'high-second']);
  });

  test('data 在阶段之间可传递修改', () => {
    const system = new HookSystem();
    const seen: number[] = [];
    system.registerHook({
      id: 'b',
      on: 'dmg',
      phase: HookPhase.Before,
      effect: (ctx) => {
        ctx.data.amount += 1;
      },
    });
    system.registerHook({
      id: 'm',
      on: 'dmg',
      phase: HookPhase.Modify,
      effect: (ctx) => {
        seen.push(ctx.data.amount);
        ctx.data.amount *= 2;
      },
    });
    system.registerHook({
      id: 'i',
      on: 'dmg',
      phase: HookPhase.Instead,
      effect: (ctx) => {
        seen.push(ctx.data.amount);
      },
    });
    system.registerHook({
      id: 'a',
      on: 'dmg',
      phase: HookPhase.After,
      effect: (ctx) => {
        seen.push(ctx.data.amount);
      },
    });
    system.emit('dmg', { amount: 10 });
    assert.deepEqual(seen, [11, 22, 22]);
  });

  test('default handler 的返回值写入 ctx.result 并对 after 可见', () => {
    const system = new HookSystem();
    let observed: unknown = 'unset';
    system.registerDefaultHandler('A', () => 'from-default');
    system.registerHook({
      id: 'after',
      on: 'A',
      phase: HookPhase.After,
      effect: (ctx) => {
        observed = ctx.result;
      },
    });
    system.emit('A');
    assert.equal(observed, 'from-default');
  });

  test('default handler 返回 undefined 时不写 ctx.result', () => {
    const system = new HookSystem();
    let hasResult = true;
    system.registerDefaultHandler('A', () => undefined);
    system.registerHook({
      id: 'after',
      on: 'A',
      phase: HookPhase.After,
      effect: (ctx) => {
        hasResult = 'result' in ctx;
      },
    });
    system.emit('A');
    assert.equal(hasResult, false);
  });

  test('后注册的 default handler 覆盖先注册的', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerDefaultHandler('A', () => log.push('first'));
    system.registerDefaultHandler('A', () => log.push('second'));
    system.emit('A');
    assert.deepEqual(log, ['second']);
  });
});

describe('L4 数据与实体解析', () => {
  test('emit 不传 data 时 ctx.data 为空对象', () => {
    const system = new HookSystem();
    let observed: unknown = null;
    system.registerHook({
      id: 'h',
      on: 'A',
      phase: HookPhase.After,
      effect: (ctx) => {
        observed = ctx.data;
      },
    });
    system.emit('A');
    assert.deepEqual(observed, {});
  });

  test('emit 传 null 时规范化为空对象而非崩溃', () => {
    const system = new HookSystem();
    let observed: unknown = 'unset';
    system.registerHook({
      id: 'h',
      on: 'A',
      phase: HookPhase.After,
      effect: (ctx: Context) => {
        observed = ctx.data.anything;
      },
    });
    assert.doesNotThrow(() => system.emit('A', null));
    assert.equal(observed, undefined);
  });

  test('target 优先于 entity 解析实体', () => {
    const system = new HookSystem();
    const fromTarget = createEntity('target-entity');
    const fromEntity = createEntity('entity-entity');
    let observed = '';
    system.registerHook({
      id: 'h',
      on: 'A',
      phase: HookPhase.After,
      effect: (ctx) => {
        observed = ctx.entity?.id ?? '';
      },
    });
    system.emit('A', { target: fromTarget, entity: fromEntity });
    assert.equal(observed, 'target-entity', 'target 应优先于 entity');
  });

  test('只给 entity 时也能解析', () => {
    const system = new HookSystem();
    let observed = '';
    system.registerHook({
      id: 'h',
      on: 'A',
      phase: HookPhase.After,
      effect: (ctx) => {
        observed = ctx.entity?.id ?? '';
      },
    });
    system.emit('A', { entity: createEntity('only-entity') });
    assert.equal(observed, 'only-entity');
  });

  test('无实体时物品 Hook 一律不参与', () => {
    const system = new HookSystem();
    const entity = createEntity();
    entity.containers.hand.addItem(
      item('i', 'def', [
        { id: 'item-hook', on: 'A', phase: HookPhase.Instead, effect: noop },
      ]),
    );
    assert.equal(system.collectAndSortInstead('A').length, 0);
    assert.equal(system.collectAndSortInstead('A', { target: entity }).length, 1);
  });

  test('容器名不在 containerOrder 中的容器被忽略', () => {
    const system = new HookSystem();
    const entity = createEntity('e', ['hand']);
    entity.containers.ghost = entity.containers.hand;
    entity.containers.ghost.addItem(
      item('i', 'def', [{ id: 'h', on: 'A', phase: HookPhase.Instead, effect: noop }]),
    );
    // ghost 与 hand 是同一个容器对象，containerOrder 只含 hand，故只被收集一次
    assert.equal(system.collectAndSortInstead('A', { target: entity }).length, 1);
  });

  test('containerOrder 含不存在的容器名时安全跳过', () => {
    const system = new HookSystem();
    const entity = createEntity('e', ['hand']);
    entity.containerOrder.push('missing');
    assert.doesNotThrow(() => system.collectAndSortInstead('A', { target: entity }));
  });
});

describe('L4 排序不污染注册表', () => {
  test('多次 collectAndSortInstead 不改变注册顺序', () => {
    const system = new HookSystem();
    system.registerHook({
      id: 'z',
      on: 'A',
      phase: HookPhase.Instead,
      priority: 0,
      effect: noop,
    });
    system.registerHook({
      id: 'a',
      on: 'A',
      phase: HookPhase.Instead,
      priority: 0,
      effect: noop,
    });
    const before = JSON.stringify(system.snapshot().hooks);
    system.collectAndSortInstead('A');
    system.collectAndSortInstead('A');
    assert.equal(JSON.stringify(system.snapshot().hooks), before, '排序污染了注册表');
  });

  test('非 instead 阶段的执行顺序不受 instead 排序影响', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerHook({
      id: 'z',
      on: 'A',
      phase: HookPhase.Before,
      priority: 0,
      effect: () => {
        log.push('z');
      },
    });
    system.registerHook({
      id: 'a',
      on: 'A',
      phase: HookPhase.Before,
      priority: 100,
      effect: () => {
        log.push('a');
      },
    });
    system.collectAndSortInstead('A');
    system.emit('A');
    assert.deepEqual(log, ['z', 'a'], 'before 阶段被 instead 的排序规则污染');
  });

  test('注册序号严格自增：每个 Hook 拿到唯一 order', () => {
    const system = new HookSystem();
    for (let index = 0; index < 5; index++) {
      system.registerHook({ id: `h${index}`, on: index % 2 === 0 ? 'A' : 'B', phase: HookPhase.After, effect: noop });
    }
    const orders = system
      .snapshot()
      .hooks.flatMap((bucket) => bucket.entries.map((e) => e.order))
      .sort((a, b) => a - b);
    assert.deepEqual(orders, [0, 1, 2, 3, 4]);
    assert.deepEqual(system.checkInvariants(), []);
  });
});

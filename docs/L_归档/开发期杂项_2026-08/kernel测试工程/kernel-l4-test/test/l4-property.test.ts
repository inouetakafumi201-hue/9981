import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  HookDepthExceededError,
  HookPhase,
  HookReentryError,
  HookSystem,
  createEntity,
} from '../src/index.js';
import type { Context, HookDef, Item } from '../src/index.js';

const instead = (
  id: string,
  on: string,
  effect: HookDef['effect'],
  priority = 0,
): HookDef => ({ id, on, phase: HookPhase.Instead, priority, effect });

const item = (id: string, def: string, rules: HookDef[]): Item => ({ id, def, rules });

const errorMessage = (fn: () => void): string => {
  try {
    fn();
    return '';
  } catch (error) {
    return (error as Error).message;
  }
};

describe('L4 属性测试：120,000次', () => {
  test('HOOK-2: instead竞争排序确定性（100,000次）', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            priority: fc.integer({ min: -100, max: 100 }),
          }),
          { minLength: 2, maxLength: 10 },
        ),
        (defs) => {
          const system = new HookSystem();
          for (const def of defs) {
            system.registerHook(instead(def.id, 'damage', () => undefined, def.priority));
          }
          const first = system.collectAndSortInstead('damage').map((hook) => hook.id);
          const second = system.collectAndSortInstead('damage').map((hook) => hook.id);
          return first.join('\0') === second.join('\0');
        },
      ),
      { numRuns: 100_000 },
    );
  });

  test('HOOK-4: depth=32时截断（10,000次）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), (targetDepth) => {
        const system = new HookSystem();
        let visited = 0;
        for (let index = 0; index < 50; index++) {
          system.registerHook({
            id: `depth_${index}`,
            on: `event_${index}`,
            phase: HookPhase.After,
            effect: (ctx) => {
              visited++;
              if (index + 1 < targetDepth) ctx.emit(`event_${index + 1}`);
            },
          });
        }

        const message = errorMessage(() => system.emit('event_0'));
        return targetDepth <= 32
          ? message === '' && visited === targetDepth
          : message === 'E_HOOK_DEPTH_EXCEEDED' && visited === 32;
      }),
      { numRuns: 10_000 },
    );
  });

  test('HOOK-6: A→B→A被阻止（10,000次）', () => {
    fc.assert(
      fc.property(fc.tuple(fc.uuid(), fc.uuid()), ([idA, idB]) => {
        const system = new HookSystem();
        const log: string[] = [];
        system.registerHook({
          id: idA,
          on: 'A',
          phase: HookPhase.After,
          effect: (ctx) => { log.push('A'); ctx.emit('B'); },
        });
        system.registerHook({
          id: idB,
          on: 'B',
          phase: HookPhase.After,
          effect: (ctx) => { log.push('B'); ctx.emit('A'); },
        });

        return errorMessage(() => system.emit('A')) === 'E_HOOK_REENTRY'
          && log.join('') === 'AB';
      }),
      { numRuns: 10_000 },
    );
  });
});

describe('A. instead竞争与阻止：15条', () => {
  test('01 单一instead阻止default', () => {
    const system = new HookSystem();
    let defaulted = false;
    system.registerHook(instead('totem', 'death', () => ({ preventAll: true }), 100));
    system.registerDefaultHandler('death', () => { defaulted = true; });
    system.emit('death');
    assert.equal(defaulted, false);
  });

  test('02 手部图腾优先于背包图腾', () => {
    const system = new HookSystem();
    const entity = createEntity();
    const consumed: string[] = [];
    entity.containers.hand.addItem(item('hand', 'totem', [
      instead('prevent_hand', 'death', () => { consumed.push('hand'); return { preventAll: true }; }, 100),
    ]));
    entity.containers.backpack.addItem(item('back', 'totem', [
      instead('prevent_back', 'death', () => { consumed.push('back'); return { preventAll: true }; }, 100),
    ]));
    system.emit('death', { target: entity });
    assert.deepEqual(consumed, ['hand']);
  });

  test('03 高priority优先', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerHook(instead('low', 'damage', () => { log.push('low'); return { preventAll: true }; }, 50));
    system.registerHook(instead('high', 'damage', () => { log.push('high'); return { preventAll: true }; }, 100));
    system.emit('damage');
    assert.deepEqual(log, ['high']);
  });

  test('04 同容器slotIndex=0优先', () => {
    const system = new HookSystem();
    const entity = createEntity();
    const log: string[] = [];
    entity.containers.backpack.addItem(item('zero', 'totem', [
      instead('slot_zero', 'death', () => { log.push('zero'); return { preventAll: true }; }, 100),
    ]));
    entity.containers.backpack.addItem(item('one', 'totem', [
      instead('slot_one', 'death', () => { log.push('one'); return { preventAll: true }; }, 100),
    ]));
    system.emit('death', { target: entity });
    assert.deepEqual(log, ['zero']);
  });

  test('05 最终字符串键按升序', () => {
    const system = new HookSystem();
    system.registerHook(instead('zzz', 'event', () => undefined, 1));
    system.registerHook(instead('aaa', 'event', () => undefined, 1));
    assert.deepEqual(system.collectAndSortInstead('event').map((hook) => hook.id), ['aaa', 'zzz']);
  });

  test('06 preventExcept不匹配时阻止', () => {
    const system = new HookSystem();
    let defaulted = false;
    system.registerHook(instead('shield', 'physical', () => ({ preventExcept: ['fire'] })));
    system.registerDefaultHandler('physical', () => { defaulted = true; });
    system.emit('physical');
    assert.equal(defaulted, false);
  });

  test('07 preventExcept匹配时放行', () => {
    const system = new HookSystem();
    let defaulted = false;
    system.registerHook(instead('shield', 'fire', () => ({ preventExcept: ['fire'] })));
    system.registerDefaultHandler('fire', () => { defaulted = true; });
    system.emit('fire');
    assert.equal(defaulted, true);
  });

  test('08 preventAll后续候选不执行', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerHook(instead('first', 'event', () => { log.push('first'); return { preventAll: true }; }, 2));
    system.registerHook(instead('second', 'event', () => { log.push('second'); }, 1));
    system.emit('event');
    assert.deepEqual(log, ['first']);
  });

  test('09 instead不阻止则执行default', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerHook(instead('observer', 'event', () => { log.push('instead'); }));
    system.registerDefaultHandler('event', () => { log.push('default'); });
    system.emit('event');
    assert.deepEqual(log, ['instead', 'default']);
  });

  test('10 已销毁物品的Hook被跳过', () => {
    const system = new HookSystem();
    const entity = createEntity();
    const log: string[] = [];
    entity.containers.hand.addItem({
      ...item('dead', 'totem', [instead('dead_hook', 'death', () => { log.push('dead'); return { preventAll: true }; }, 100)]),
      destroyed: true,
    });
    entity.containers.backpack.addItem(item('live', 'totem', [
      instead('live_hook', 'death', () => { log.push('live'); return { preventAll: true }; }, 100),
    ]));
    system.emit('death', { target: entity });
    assert.deepEqual(log, ['live']);
  });

  test('11 完全相同键仍保持确定注册顺序', () => {
    const system = new HookSystem();
    system.registerHook(instead('same', 'event', () => undefined));
    system.registerHook(instead('same', 'event', () => undefined));
    const first = system.collectAndSortInstead('event');
    const second = system.collectAndSortInstead('event');
    assert.equal(first.length, 2);
    assert.deepEqual(first, second);
  });

  test('12 三容器按定义顺序竞争', () => {
    const system = new HookSystem();
    const entity = createEntity();
    const log: string[] = [];
    for (const name of ['belt', 'backpack', 'hand']) {
      entity.containers[name].addItem(item(name, 'totem', [
        instead(`hook_${name}`, 'death', () => { log.push(name); return { preventAll: true }; }, 100),
      ]));
    }
    system.emit('death', { target: entity });
    assert.deepEqual(log, ['hand']);
  });

  test('13 shift删除后使用实时slotIndex', () => {
    const system = new HookSystem();
    const entity = createEntity();
    const log: string[] = [];
    entity.containers.backpack.addItem(item('removed', 'totem', []));
    entity.containers.backpack.addItem(item('shifted', 'totem', [
      instead('shifted_hook', 'death', () => { log.push('shifted'); return { preventAll: true }; }, 100),
    ]));
    entity.containers.backpack.removeItem('removed');
    system.emit('death', { target: entity });
    assert.deepEqual(log, ['shifted']);
  });

  test('14 全局高优先级Hook可胜过物品Hook', () => {
    const system = new HookSystem();
    const entity = createEntity();
    const log: string[] = [];
    system.registerHook(instead('global', 'death', () => { log.push('global'); return { preventAll: true }; }, 101));
    entity.containers.hand.addItem(item('totem', 'totem', [
      instead('item_hook', 'death', () => { log.push('item'); return { preventAll: true }; }, 100),
    ]));
    system.emit('death', { target: entity });
    assert.deepEqual(log, ['global']);
  });

  test('15 多个preventExcept依次求值', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerHook(instead('allow', 'fire', () => { log.push('allow'); return { preventExcept: ['fire'] }; }, 2));
    system.registerHook(instead('block', 'fire', () => { log.push('block'); return { preventExcept: ['ice'] }; }, 1));
    system.registerDefaultHandler('fire', () => { log.push('default'); });
    system.emit('fire');
    assert.deepEqual(log, ['allow', 'block']);
  });
});

describe('B. depth与reactionRounds：10条', () => {
  test('16 三层嵌套正常完成', () => {
    const system = new HookSystem();
    const log: string[] = [];
    for (const [from, to] of [['A', 'B'], ['B', 'C']] as const) {
      system.registerHook({ id: from, on: from, phase: HookPhase.After, effect: (ctx) => { log.push(from); ctx.emit(to); } });
    }
    system.registerHook({ id: 'C', on: 'C', phase: HookPhase.After, effect: () => { log.push('C'); } });
    system.emit('A');
    assert.deepEqual(log, ['A', 'B', 'C']);
  });

  test('17 depth=32允许完成', () => {
    const system = new HookSystem();
    let count = 0;
    for (let index = 0; index < 32; index++) {
      system.registerHook({ id: `h${index}`, on: `e${index}`, phase: HookPhase.After, effect: (ctx) => { count++; if (index < 31) ctx.emit(`e${index + 1}`); } });
    }
    system.emit('e0');
    assert.equal(count, 32);
  });

  test('18 第33层抛出depth错误', () => {
    const system = new HookSystem();
    for (let index = 0; index < 33; index++) {
      system.registerHook({ id: `h${index}`, on: `e${index}`, phase: HookPhase.After, effect: (ctx) => { if (index < 32) ctx.emit(`e${index + 1}`); } });
    }
    assert.equal(errorMessage(() => system.emit('e0')), 'E_HOOK_DEPTH_EXCEEDED');
  });

  test('19 depth异常后计数器恢复', () => {
    const system = new HookSystem();
    for (let index = 0; index < 33; index++) {
      system.registerHook({ id: `h${index}`, on: `e${index}`, phase: HookPhase.After, effect: (ctx) => { if (index < 32) ctx.emit(`e${index + 1}`); } });
    }
    assert.throws(() => system.emit('e0'), HookDepthExceededError);
    assert.doesNotThrow(() => system.emit('safe'));
  });

  test('20 两次顶层emit的depth独立', () => {
    const system = new HookSystem();
    let count = 0;
    system.registerHook({ id: 'A', on: 'A', phase: HookPhase.After, effect: (ctx) => { count++; ctx.emit('B'); } });
    system.registerHook({ id: 'B', on: 'B', phase: HookPhase.After, effect: () => { count++; } });
    system.emit('A');
    system.emit('A');
    assert.equal(count, 4);
  });

  test('21 before触发子事件会完整返回父事件', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerHook({ id: 'before', on: 'A', phase: HookPhase.Before, effect: (ctx) => { log.push('A.before'); ctx.emit('B'); } });
    system.registerDefaultHandler('B', () => { log.push('B.default'); });
    system.registerDefaultHandler('A', () => { log.push('A.default'); });
    system.emit('A');
    assert.deepEqual(log, ['A.before', 'B.default', 'A.default']);
  });

  test('22 单轮reaction执行', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerHook({ id: 'A', on: 'A', phase: HookPhase.After, effect: (ctx) => { log.push('A'); ctx.react('B'); } });
    system.registerHook({ id: 'B', on: 'B', phase: HookPhase.After, effect: () => { log.push('B'); } });
    system.emit('A');
    assert.deepEqual(log, ['A', 'B']);
  });

  test('23 reactionRounds第9轮静默截断', () => {
    const system = new HookSystem();
    let count = 0;
    system.registerHook({ id: 'loop', on: 'ping', phase: HookPhase.After, effect: (ctx) => { count++; ctx.react('ping'); } });
    assert.doesNotThrow(() => system.emit('ping'));
    assert.equal(count, 8);
  });

  test('24 同一反应轮可包含多个事件', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerHook({ id: 'A', on: 'A', phase: HookPhase.After, effect: (ctx) => { log.push('A'); ctx.react('B'); ctx.react('C'); } });
    system.registerHook({ id: 'B', on: 'B', phase: HookPhase.After, effect: () => { log.push('B'); } });
    system.registerHook({ id: 'C', on: 'C', phase: HookPhase.After, effect: () => { log.push('C'); } });
    system.emit('A');
    assert.deepEqual(log, ['A', 'B', 'C']);
  });

  test('25 reactionRounds在顶层emit间重置', () => {
    const system = new HookSystem();
    let count = 0;
    system.registerHook({ id: 'loop', on: 'ping', phase: HookPhase.After, effect: (ctx) => { count++; ctx.react('ping'); } });
    system.emit('ping');
    system.emit('ping');
    assert.equal(count, 16);
  });
});

describe('C. 重入锁：10条', () => {
  test('26 直接重入被阻止', () => {
    const system = new HookSystem();
    system.registerHook({ id: 'self', on: 'A', phase: HookPhase.After, effect: (ctx) => ctx.emit('A') });
    assert.throws(() => system.emit('A'), HookReentryError);
  });

  test('27 A到B到A被阻止', () => {
    const system = new HookSystem();
    system.registerHook({ id: 'ha', on: 'A', phase: HookPhase.After, effect: (ctx) => ctx.emit('B') });
    system.registerHook({ id: 'hb', on: 'B', phase: HookPhase.After, effect: (ctx) => ctx.emit('A') });
    assert.equal(errorMessage(() => system.emit('A')), 'E_HOOK_REENTRY');
  });

  test('28 同type不同hookId顺序执行', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerHook({ id: 'one', on: 'A', phase: HookPhase.After, effect: () => { log.push('one'); } });
    system.registerHook({ id: 'two', on: 'A', phase: HookPhase.After, effect: () => { log.push('two'); } });
    system.emit('A');
    assert.deepEqual(log, ['one', 'two']);
  });

  test('29 同hookId不同type允许嵌套', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerHook({ id: 'shared', on: 'A', phase: HookPhase.After, effect: (ctx) => { log.push('A'); ctx.emit('B'); } });
    system.registerHook({ id: 'shared', on: 'B', phase: HookPhase.After, effect: () => { log.push('B'); } });
    system.emit('A');
    assert.deepEqual(log, ['A', 'B']);
  });

  test('30 调用结束后锁解除', () => {
    const system = new HookSystem();
    let count = 0;
    system.registerHook({ id: 'hook', on: 'A', phase: HookPhase.After, effect: () => { count++; } });
    system.emit('A');
    system.emit('A');
    assert.equal(count, 2);
  });

  test('31 跨阶段嵌套按type和hookId判定', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerHook({ id: 'shared', on: 'A', phase: HookPhase.Before, effect: (ctx) => { log.push('A'); ctx.emit('B'); } });
    system.registerHook({ id: 'shared', on: 'B', phase: HookPhase.After, effect: () => { log.push('B'); } });
    system.emit('A');
    assert.deepEqual(log, ['A', 'B']);
  });

  test('32 instead阶段也受重入锁保护', () => {
    const system = new HookSystem();
    system.registerHook(instead('self', 'A', (ctx) => { ctx.emit('A'); }));
    assert.throws(() => system.emit('A'), HookReentryError);
  });

  test('33 Hook抛错后锁被清理', () => {
    const system = new HookSystem();
    let shouldThrow = true;
    system.registerHook({ id: 'unstable', on: 'A', phase: HookPhase.After, effect: () => { if (shouldThrow) { shouldThrow = false; throw new Error('boom'); } } });
    assert.throws(() => system.emit('A'), /boom/);
    assert.doesNotThrow(() => system.emit('A'));
  });

  test('34 重入错误码精确', () => {
    const system = new HookSystem();
    system.registerHook({ id: 'self', on: 'A', phase: HookPhase.After, effect: (ctx) => ctx.emit('A') });
    assert.equal(errorMessage(() => system.emit('A')), 'E_HOOK_REENTRY');
  });

  test('35 重入错误先于depth上限', () => {
    const system = new HookSystem();
    let count = 0;
    system.registerHook({ id: 'self', on: 'A', phase: HookPhase.After, effect: (ctx) => { count++; ctx.emit('A'); } });
    assert.equal(errorMessage(() => system.emit('A')), 'E_HOOK_REENTRY');
    assert.equal(count, 1);
  });
});

describe('D. 五阶段与条件：10条', () => {
  test('36 完整顺序before-modify-instead-default-after', () => {
    const system = new HookSystem();
    const log: string[] = [];
    for (const phase of [HookPhase.Before, HookPhase.Modify, HookPhase.Instead, HookPhase.After]) {
      system.registerHook({ id: phase, on: 'A', phase, effect: () => { log.push(phase); } });
    }
    system.registerDefaultHandler('A', () => { log.push('default'); });
    system.emit('A');
    assert.deepEqual(log, ['before', 'modify', 'instead', 'default', 'after']);
  });

  test('37 instead阻止default后after仍执行', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerHook(instead('block', 'A', () => { log.push('instead'); return { preventAll: true }; }));
    system.registerDefaultHandler('A', () => { log.push('default'); });
    system.registerHook({ id: 'after', on: 'A', phase: HookPhase.After, effect: () => { log.push('after'); } });
    system.emit('A');
    assert.deepEqual(log, ['instead', 'after']);
  });

  test('38 before修改参数对modify可见', () => {
    const system = new HookSystem();
    let value = 0;
    system.registerHook({ id: 'before', on: 'damage', phase: HookPhase.Before, effect: (ctx) => { ctx.data.amount *= 2; } });
    system.registerHook({ id: 'modify', on: 'damage', phase: HookPhase.Modify, effect: (ctx) => { value = ctx.data.amount; } });
    system.emit('damage', { amount: 10 });
    assert.equal(value, 20);
  });

  test('39 modify修改参数对instead可见', () => {
    const system = new HookSystem();
    let value = 0;
    system.registerHook({ id: 'modify', on: 'damage', phase: HookPhase.Modify, effect: (ctx) => { ctx.data.amount *= 2; } });
    system.registerHook(instead('instead', 'damage', (ctx) => { value = ctx.data.amount; }));
    system.emit('damage', { amount: 10 });
    assert.equal(value, 20);
  });

  test('40 before返回preventAll被忽略', () => {
    const system = new HookSystem();
    let defaulted = false;
    system.registerHook({ id: 'before', on: 'A', phase: HookPhase.Before, effect: () => ({ preventAll: true }) });
    system.registerDefaultHandler('A', () => { defaulted = true; });
    system.emit('A');
    assert.equal(defaulted, true);
  });

  test('41 modify返回preventAll被忽略', () => {
    const system = new HookSystem();
    let defaulted = false;
    system.registerHook({ id: 'modify', on: 'A', phase: HookPhase.Modify, effect: () => ({ preventAll: true }) });
    system.registerDefaultHandler('A', () => { defaulted = true; });
    system.emit('A');
    assert.equal(defaulted, true);
  });

  test('42 after读取default写入的数据', () => {
    const system = new HookSystem();
    let hp = 0;
    system.registerDefaultHandler('damage', (ctx) => { ctx.data.hp -= ctx.data.amount; });
    system.registerHook({ id: 'after', on: 'damage', phase: HookPhase.After, effect: (ctx) => { hp = ctx.data.hp; } });
    system.emit('damage', { hp: 100, amount: 10 });
    assert.equal(hp, 90);
  });

  test('43 无default处理器仍执行after', () => {
    const system = new HookSystem();
    let after = false;
    system.registerHook({ id: 'after', on: 'custom', phase: HookPhase.After, effect: () => { after = true; } });
    system.emit('custom');
    assert.equal(after, true);
  });

  test('44 非instead阶段按注册顺序执行', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerHook({ id: 'one', on: 'A', phase: HookPhase.Before, priority: 1, effect: () => { log.push('one'); } });
    system.registerHook({ id: 'two', on: 'A', phase: HookPhase.Before, priority: 100, effect: () => { log.push('two'); } });
    system.emit('A');
    assert.deepEqual(log, ['one', 'two']);
  });

  test('45 空数据允许且when=false跳过Hook', () => {
    const system = new HookSystem();
    const log: string[] = [];
    system.registerHook({ id: 'conditional', on: 'A', phase: HookPhase.Before, when: () => false, effect: () => { log.push('hook'); } });
    system.registerDefaultHandler('A', (ctx: Context) => { log.push(String(ctx.data.missing)); });
    system.emit('A', {});
    assert.deepEqual(log, ['undefined']);
  });
});

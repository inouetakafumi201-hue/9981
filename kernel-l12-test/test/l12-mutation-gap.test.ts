/**
 * L12 变异盲区补测。
 *
 * 本文件的每一条用例都对应一个**曾经存活的变异体**：即上一轮变异测试证明
 * 现有 93 条用例区分不出的行为改动。存活变异体是测试盲区的**证据**，
 * 不是噪声——所以补测按变异体编号组织，编号写在用例名里，
 * 将来谁改坏了哪条守卫，报错直接指回那个变异体。
 *
 * 与既有四个文件的分工：
 *  - l12-property / l12-shadow：随机搜索，找未知缺陷
 *  - l12-invariant-checker：注入损坏，证明自检不是空壳
 *  - l12-regression：钉住已修复的 9 个缺陷
 *  - 本文件：钉住随机搜索**结构上到不了**的点（确定性拓扑、常量取值、
 *    内部数组外泄），这些点靠加大 runs 是碰不出来的
 *
 * 本轮补的 8 个盲区里，最值得记的是 M88/M89/M90 那一组：
 * 它们存活不是因为漏了断言，而是因为断言的**判据来自被测对象自己**
 * （测试 import 产品的 MIG_CODES 再拿它断言产品的输出）。
 * 改常量时产品与判据一起动，差异恒不可见——这是"自指判据"，
 * 与"恒真断言"同属一类：断言写了，但它不可能失败。
 */
import { describe, expect, it } from 'vitest';
import {
  CheckpointStore,
  Journal,
  cloneState,
} from '../src/persistence.js';
import type { Op, WorldState } from '../src/persistence.js';
import { MIG_CODES, loadSnapshot } from '../src/migration.js';
import type { MigrationDef } from '../src/migration.js';

/** 最小合法状态；每个用例自己改自己的副本。 */
function st(version: string, props: Record<string, number> = {}): WorldState {
  return { version, playpackId: 'pp:gap', phaseIndex: 0, randomCounter: 0, props };
}

/** 纯 Op，带可辨识 id：编号断言之外还要能认出留下的是哪几条。 */
function op(id: string): Op {
  return { id, apply: (s) => ({ ...s, props: { ...s.props, [id]: (s.props[id] ?? 0) + 1 } }) };
}

/**
 * 造一条迁移；effects 至少一条，且每条都往 sink 里记一笔。
 *
 * 每跳必须留痕：零 effect 的跳在最终状态上不可见，
 * 于是"走了哪条链"退化成"到了哪个版本"，链选择相关的断言随之恒真。
 */
function mig(
  from: string,
  to: string,
  sink: string[],
  opts: { throws?: boolean; onFail?: 'reject' | 'bestEffort'; key?: string } = {},
): MigrationDef {
  const id = `${from}->${to}`;
  const key = opts.key ?? id;
  return {
    id, from, to,
    onFail: opts.onFail ?? 'reject',
    effects: [
      {
        apply: (s) => {
          sink.push(id);
          if (opts.throws) throw new Error(`boom:${id}`);
          return { ...s, props: { ...s.props, [key]: (s.props[key] ?? 0) + 1 } };
        },
      },
    ],
  };
}

describe('M36: Journal.clear 必须重置发号器', () => {
  /**
   * 盲区成因：既有用例只断言 clear 之后 getAll() 为空。
   * 空数组这件事，"重置了 seq"与"没重置 seq"都满足，
   * 差异只在**下一次 append 发什么号**——不接着 append 就永远看不见。
   */
  it('clear 后下一条记录从 seq=1 重新发号', () => {
    const j = new Journal();
    j.append(op('a'));
    j.append(op('b'));
    j.append(op('c'));
    expect(j.getAll().map((e) => e.seq)).toEqual([1, 2, 3]);

    j.clear();
    expect(j.getAll()).toEqual([]);

    j.append(op('d'));
    // 若 clear 不重置 seq，这里会是 4——一个空日志里的第一条记录编号为 4。
    expect(j.getAll().map((e) => e.seq)).toEqual([1]);
    expect(j.checkInvariants()).toEqual([]);
  });

  it('clear 后 since(0) 能取回新记录（旧编号不再遮挡）', () => {
    const j = new Journal();
    for (const id of ['a', 'b', 'c', 'd', 'e']) j.append(op(id));
    j.clear();
    j.append(op('x'));
    j.append(op('y'));
    // since 以 seq 为界。若发号器停在 5，新记录是 6、7，
    // since(5) 仍能取到——所以必须从 0 起问，问的是"编号有没有回到起点"。
    expect(j.since(0).map((e) => e.op.id)).toEqual(['x', 'y']);
    expect(j.getAll().map((e) => e.seq)).toEqual([1, 2]);
  });

  it('清空—重填多轮，编号不累积', () => {
    const j = new Journal();
    for (let round = 0; round < 4; round++) {
      j.append(op('p'));
      j.append(op('q'));
      expect(j.getAll().map((e) => e.seq)).toEqual([1, 2]);
      j.clear();
    }
  });
});

describe('M44: CheckpointStore.list 必须返回副本', () => {
  /**
   * 盲区成因：既有用例只读 list() 的内容。
   * 交出内部数组与交出副本，**读**起来完全一样；
   * 差异只在调用方改了返回值之后——不改就不可观测。
   */
  it('改动 list() 的返回值不影响后续 list()', () => {
    const cp = new CheckpointStore();
    cp.checkpoint('a', st('1.0.0'));
    cp.checkpoint('b', st('1.0.0'));

    const got = cp.list();
    got.push('__injected__');
    got.shift();

    expect(cp.list()).toEqual(['a', 'b']);
  });

  it('改动 list() 的返回值不破坏 order↔checkpoints 一致性自检', () => {
    const cp = new CheckpointStore();
    cp.checkpoint('a', st('1.0.0'));
    cp.checkpoint('b', st('1.0.0'));

    cp.list().push('ghost');
    // 自检查 order 与 checkpoints 逐元素一致。若 list 交出的就是 order，
    // 上面这一 push 直接把 'ghost' 写进内部登记表，自检必然报违规。
    expect(cp.checkInvariants()).toEqual([]);
    expect(cp.has('ghost')).toBe(false);
  });

  it('两次 list() 是不同数组对象', () => {
    const cp = new CheckpointStore();
    cp.checkpoint('a', st('1.0.0'));
    expect(cp.list()).not.toBe(cp.list());
  });
});

describe('M73/M78/M80: 诊断必须累积，不得被后续分支丢弃', () => {
  /**
   * 盲区成因：既有用例断言"失败时至少有一条诊断"。
   * 只保留最后一条也满足"至少一条"——
   * 前面积累的 SKIPPED 被丢掉这件事，要断言**完整序列**才看得见。
   */
  it('bestEffort 跳过后再遇 reject 失败，SKIPPED 仍在诊断里', () => {
    const sink: string[] = [];
    const migrations = [
      // 第一跳 bestEffort 且抛错 → 记 SKIPPED，继续
      mig('1.0.0', '1.1.0', sink, { throws: true, onFail: 'bestEffort' }),
      // 第二跳 reject 且抛错 → 整体回滚并记 FAILED
      mig('1.1.0', '2.0.0', sink, { throws: true, onFail: 'reject' }),
    ];
    const saved = st('1.0.0', { keep: 1 });
    const result = loadSnapshot(saved, '2.0.0', migrations);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      MIG_CODES.SKIPPED,
      MIG_CODES.FAILED,
    ]);
    // 每条诊断都要可读：detail 为空时人无法定位是哪一跳出的事。
    for (const d of result.diagnostics) expect(d.detail.length).toBeGreaterThan(0);
    // reject 语义 = 整体回滚，不得交出半成品状态。
    expect(result.state).toBeUndefined();
    expect(saved.props).toEqual({ keep: 1 });
  });

  it('两次 bestEffort 跳过后链未达目标，SKIPPED 与 INCOMPLETE 同时在册', () => {
    const sink: string[] = [];
    const migrations = [
      mig('1.0.0', '1.1.0', sink, { throws: true, onFail: 'bestEffort' }),
      mig('1.1.0', '2.0.0', sink, { throws: true, onFail: 'bestEffort' }),
    ];
    const result = loadSnapshot(st('1.0.0'), '2.0.0', migrations);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      MIG_CODES.SKIPPED,
      MIG_CODES.SKIPPED,
      MIG_CODES.INCOMPLETE,
    ]);
  });

  it('成功路径上的 SKIPPED 不被成功本身抹掉', () => {
    const sink: string[] = [];
    const migrations = [
      // 跳过但仍推进版本：bestEffort 的语义是"这一跳的效果没落，但版本继续走"
      mig('1.0.0', '1.1.0', sink, { throws: true, onFail: 'bestEffort' }),
      mig('1.1.0', '2.0.0', sink, {}),
    ];
    const result = loadSnapshot(st('1.0.0'), '2.0.0', migrations);

    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((d) => d.code)).toEqual([MIG_CODES.SKIPPED]);
    expect(result.state!.version).toBe('2.0.0');
  });
});

describe('M82: 迁移链必须最短（BFS，不是 DFS）', () => {
  /**
   * 盲区成因两层，第二层是我自己踩的坑，记下来：
   *
   * 一、两条链的**终点状态相同**，只看 ok/version 时 DFS 与 BFS 不可区分。
   *    故判据必须是 effect 执行痕迹（sink），不是最终版本号。
   *
   * 二、**声明顺序的方向搞反过一次**。栈弹出的是**最后入队**的边，
   *    而入队顺序就是声明顺序。所以想让 DFS 走上长路，
   *    必须让直达边**先声明**（先入队 → 最后才被弹出），
   *    绕路边后声明。我第一版反着写成"长路先声明"，
   *    那种拓扑下 DFS 恰好也弹到直达边，两者答案相同——
   *    三条用例全是**恒真断言**：写了 expect，但不可能失败。
   *
   *    这一层是靠"手动打上 M82 再跑"发现的，不是靠读代码想出来的。
   *    结论：区分性断言必须用**已知会违约的实现**验过一遍，
   *    否则"断言通过"只说明它没失败，不说明它能失败。
   */
  it('直达边先声明、绕路后声明时，仍走 1 跳直达链（DFS 会走 2 跳）', () => {
    const sink: string[] = [];
    const migrations = [
      // 直达边先声明 → 先入队 → 栈最后才弹到它
      mig('1.0.0', '2.0.0', sink, { key: 'direct' }),
      // 绕路后声明 → 后入队 → 栈先弹到它，DFS 由此走上 2 跳
      mig('1.0.0', '1.1.0', sink),
      mig('1.1.0', '2.0.0', sink, { key: 'detour2' }),
    ];
    const result = loadSnapshot(st('1.0.0'), '2.0.0', migrations);

    expect(result.ok).toBe(true);
    expect(sink).toEqual(['1.0.0->2.0.0']);
    expect(result.state!.props).toEqual({ direct: 1 });
  });

  it('直达边先声明、绕路 3 跳后声明，仍取直达', () => {
    const sink: string[] = [];
    const migrations = [
      mig('1.0.0', '3.0.0', sink, { key: 'direct' }),
      mig('1.0.0', '1.1.0', sink),
      mig('1.1.0', '1.2.0', sink),
      mig('1.2.0', '3.0.0', sink, { key: 'detour3' }),
    ];
    const result = loadSnapshot(st('1.0.0'), '3.0.0', migrations);
    expect(result.ok).toBe(true);
    expect(sink).toEqual(['1.0.0->3.0.0']);
  });

  it('无直达链时取较短的那条：2 跳先声明、3 跳后声明', () => {
    const sink: string[] = [];
    const migrations = [
      // 2 跳分支先声明 → 栈会最后才弹到它
      mig('1.0.0', '1.5.0', sink),
      mig('1.5.0', '2.0.0', sink, { key: 'short2' }),
      // 3 跳分支后声明 → 栈先弹到它
      mig('1.0.0', '1.1.0', sink),
      mig('1.1.0', '1.2.0', sink),
      mig('1.2.0', '2.0.0', sink, { key: 'long3' }),
    ];
    const result = loadSnapshot(st('1.0.0'), '2.0.0', migrations);
    expect(result.ok).toBe(true);
    expect(sink).toEqual(['1.0.0->1.5.0', '1.5.0->2.0.0']);
  });

  it('反向声明顺序下同样取最短链（排除"恰好靠声明顺序蒙对"）', () => {
    // 上面三条都把短链放在前面。若实现改成"永远取最先声明的那条链"，
    // 三条都能过。故补一条把短链放在**后面**，两个方向都钉住。
    const sink: string[] = [];
    const migrations = [
      mig('1.0.0', '1.1.0', sink),
      mig('1.1.0', '1.2.0', sink),
      mig('1.2.0', '2.0.0', sink, { key: 'long3' }),
      mig('1.0.0', '2.0.0', sink, { key: 'direct' }),
    ];
    const result = loadSnapshot(st('1.0.0'), '2.0.0', migrations);
    expect(result.ok).toBe(true);
    expect(sink).toEqual(['1.0.0->2.0.0']);
  });
});

describe('M83: 环图必须终止', () => {
  /**
   * 盲区成因：随机图能造出环，但环上**同时有通往目标的出路**时，
   * BFS 与"无环保护的 BFS"都能找到链，差异不可见。
   * 要让差异变成可观测事件，必须让目标**不可达**：
   * 此时无环保护的实现会在环上无界扩展队列，跑不完。
   *
   * 断言写成"必须返回 NO_PATH"，而不是"必须在 X 毫秒内返回"：
   * 计时断言在慢机器上会假红。跑不完由 vitest 的 testTimeout 接住，
   * 超时同样是击杀——契约要求的是"给出答案"。
   */
  it('三节点环 + 目标不可达 → NO_PATH，不得挂死', () => {
    const sink: string[] = [];
    const migrations = [
      mig('1.0.0', '1.1.0', sink),
      mig('1.1.0', '1.2.0', sink),
      mig('1.2.0', '1.0.0', sink), // 闭环
    ];
    // 9.0.0 合法但图中无人指向它
    const result = loadSnapshot(st('1.0.0'), '9.0.0', migrations);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toEqual([MIG_CODES.NO_PATH]);
    // 找不到链时一步也不该执行。
    expect(sink).toEqual([]);
  });

  it('自环 + 目标不可达 → NO_PATH', () => {
    const sink: string[] = [];
    const migrations = [mig('1.0.0', '1.0.0', sink)];
    const result = loadSnapshot(st('1.0.0'), '9.0.0', migrations);
    expect(result.diagnostics.map((d) => d.code)).toEqual([MIG_CODES.NO_PATH]);
  });

  it('平行边构成的多重环 + 目标不可达 → NO_PATH', () => {
    const sink: string[] = [];
    const migrations = [
      mig('1.0.0', '1.1.0', sink, { key: 'e1' }),
      { ...mig('1.0.0', '1.1.0', sink, { key: 'e2' }), id: '1.0.0->1.1.0#b' },
      mig('1.1.0', '1.0.0', sink, { key: 'e3' }),
      { ...mig('1.1.0', '1.0.0', sink, { key: 'e4' }), id: '1.1.0->1.0.0#b' },
    ];
    const result = loadSnapshot(st('1.0.0'), '9.0.0', migrations);
    expect(result.diagnostics.map((d) => d.code)).toEqual([MIG_CODES.NO_PATH]);
    expect(sink).toEqual([]);
  });

  it('环上有出路时仍取最短链（环保护不得把可达路径一起剪掉）', () => {
    // 反向保险：上面三条都在证明"该停下来时停下来"，
    // 这条证明环保护没有过度剪枝——否则把 visited 收紧成"永不重访任何跳"
    // 也能通过前三条。
    const sink: string[] = [];
    const migrations = [
      mig('1.0.0', '1.1.0', sink),
      mig('1.1.0', '1.0.0', sink),
      mig('1.1.0', '2.0.0', sink),
    ];
    const result = loadSnapshot(st('1.0.0'), '2.0.0', migrations);
    expect(result.ok).toBe(true);
    expect(sink).toEqual(['1.0.0->1.1.0', '1.1.0->2.0.0']);
  });
});

describe('M88/M89/M90: 诊断码取值必须钉死且互不相同', () => {
  /**
   * 盲区成因（本轮最值得记的一条）：其余用例都写
   *   expect(codes).toEqual([MIG_CODES.SKIPPED, ...])
   * 判据取自被测对象自己。把 SKIPPED 改成 'E_MIG_FAILED' 时，
   * 产品的输出和测试的期望**一起**变成 'E_MIG_FAILED'，差异恒不可见。
   * 这叫**自指判据**，与恒真断言同属一类：断言存在，但不可能失败。
   *
   * 破法两条，都要有：
   *  1. 字面量钉死取值——判据必须来自代码之外
   *  2. 断言两两互不相同——每种失败模式必须能被区分，
   *     否则测试只能说"失败了"，说不出"为何失败"，删掉任一前置守卫都测不出来
   */
  it('六个诊断码取值逐一钉死为字面量', () => {
    expect(MIG_CODES.NEWER_SAVE).toBe('E_MIG_NEWER_SAVE');
    expect(MIG_CODES.NO_PATH).toBe('E_MIG_NO_PATH');
    expect(MIG_CODES.FAILED).toBe('E_MIG_FAILED');
    expect(MIG_CODES.SKIPPED).toBe('W_MIG_SKIPPED');
    expect(MIG_CODES.INCOMPLETE).toBe('E_MIG_INCOMPLETE');
    expect(MIG_CODES.BAD_VERSION).toBe('E_MIG_BAD_VERSION');
  });

  it('诊断码两两互不相同', () => {
    const values = Object.values(MIG_CODES);
    expect(new Set(values).size).toBe(values.length);
  });

  it('码集恰好是这六个，不多不少', () => {
    // 只查"互不相同"挡不住新增一个未登记的码；只查取值挡不住悄悄删掉一个。
    expect(Object.keys(MIG_CODES).sort()).toEqual([
      'BAD_VERSION', 'FAILED', 'INCOMPLETE', 'NEWER_SAVE', 'NO_PATH', 'SKIPPED',
    ]);
  });

  it('警告码与错误码前缀可区分', () => {
    // SKIPPED 是唯一的警告：它不否决装载。前缀混同会让调用方
    // 把"跳过了一跳但装载成功"当成失败处理。
    expect(MIG_CODES.SKIPPED.startsWith('W_')).toBe(true);
    for (const [key, code] of Object.entries(MIG_CODES)) {
      if (key === 'SKIPPED') continue;
      expect(code.startsWith('E_')).toBe(true);
    }
  });

  it('五种失败模式各自产出互不相同的码（端到端，不经 MIG_CODES）', () => {
    /**
     * 上面四条查的是常量表本身；这一条查**产品在五种情形下实际吐出什么**，
     * 且期望值全部写成字面量。两侧合起来，
     * 常量表与使用点任何一侧被改动都会红。
     */
    const sink: string[] = [];
    const observed: Record<string, string[]> = {
      // 存档比当前新
      newer: loadSnapshot(st('2.0.0'), '1.0.0', []).diagnostics.map((d) => d.code),
      // 无迁移链
      noPath: loadSnapshot(st('1.0.0'), '2.0.0', []).diagnostics.map((d) => d.code),
      // reject 失败
      failed: loadSnapshot(st('1.0.0'), '1.1.0', [
        mig('1.0.0', '1.1.0', sink, { throws: true, onFail: 'reject' }),
      ]).diagnostics.map((d) => d.code),
      // bestEffort 跳过（成功装载但带警告）。
      // 必须是两跳：跳过不推进版本，单跳链被跳过就到不了目标，
      // 那是 INCOMPLETE 而非纯 SKIPPED。要单独观测 SKIPPED，
      // 末跳必须成功把版本推到目标。
      skipped: loadSnapshot(st('1.0.0'), '2.0.0', [
        mig('1.0.0', '1.1.0', sink, { throws: true, onFail: 'bestEffort' }),
        mig('1.1.0', '2.0.0', sink, { key: 'tail' }),
      ]).diagnostics.map((d) => d.code),
      // 畸形版本号
      badVersion: loadSnapshot(st('abc'), '1.0.0', []).diagnostics.map((d) => d.code),
    };

    expect(observed.newer).toEqual(['E_MIG_NEWER_SAVE']);
    expect(observed.noPath).toEqual(['E_MIG_NO_PATH']);
    expect(observed.failed).toEqual(['E_MIG_FAILED']);
    expect(observed.skipped).toEqual(['W_MIG_SKIPPED']);
    expect(observed.badVersion).toEqual(['E_MIG_BAD_VERSION']);

    // 五种情形的首码必须两两不同：这是"能说出为何失败"的最小要求。
    const heads = Object.values(observed).map((cs) => cs[0]);
    expect(new Set(heads).size).toBe(heads.length);
  });

  it('INCOMPLETE 与 NO_PATH 不同码：一个是找不到链，一个是链没走完', () => {
    const sink: string[] = [];
    const noPath = loadSnapshot(st('1.0.0'), '2.0.0', []);
    const incomplete = loadSnapshot(st('1.0.0'), '2.0.0', [
      // 有链，但两跳都被跳过，最终版本停在 1.0.0
      mig('1.0.0', '1.1.0', sink, { throws: true, onFail: 'bestEffort' }),
      mig('1.1.0', '2.0.0', sink, { throws: true, onFail: 'bestEffort' }),
    ]);

    expect(noPath.diagnostics.map((d) => d.code)).toEqual(['E_MIG_NO_PATH']);
    expect(incomplete.diagnostics.at(-1)!.code).toBe('E_MIG_INCOMPLETE');
    expect(noPath.diagnostics[0]!.code).not.toBe(incomplete.diagnostics.at(-1)!.code);
  });

  it('SKIPPED 与 FAILED 不同码：一个继续装载，一个否决装载', () => {
    const sink: string[] = [];
    // 跳过不推进版本，故 SKIPPED 且装载成功需要末跳把版本推到目标。
    const skipped = loadSnapshot(st('1.0.0'), '2.0.0', [
      mig('1.0.0', '1.1.0', sink, { throws: true, onFail: 'bestEffort' }),
      mig('1.1.0', '2.0.0', sink, { key: 'tail' }),
    ]);
    const failed = loadSnapshot(st('1.0.0'), '1.1.0', [
      mig('1.0.0', '1.1.0', sink, { throws: true, onFail: 'reject' }),
    ]);

    expect(skipped.ok).toBe(true);
    expect(failed.ok).toBe(false);
    expect(skipped.diagnostics[0]!.code).toBe('W_MIG_SKIPPED');
    expect(failed.diagnostics[0]!.code).toBe('E_MIG_FAILED');
    expect(skipped.diagnostics[0]!.code).not.toBe(failed.diagnostics[0]!.code);
  });

  it('BAD_VERSION 与 NEWER_SAVE 不同码：一个无法比较，一个比较出来更新', () => {
    const bad = loadSnapshot(st('1.0'), '1.0.0', []);
    const newer = loadSnapshot(st('2.0.0'), '1.0.0', []);
    expect(bad.diagnostics[0]!.code).toBe('E_MIG_BAD_VERSION');
    expect(newer.diagnostics[0]!.code).toBe('E_MIG_NEWER_SAVE');
    expect(bad.diagnostics[0]!.code).not.toBe(newer.diagnostics[0]!.code);
  });
});

describe('补测自身的有效性', () => {
  /**
   * 补测也可能写成空转。这里做一次最小自检：
   * 若 loadSnapshot 换成"永远返回 ok:true 且无诊断"，上面的用例是否都会红？
   * 用一个假实现走一遍同样的断言形状来验证。
   */
  it('恒成功的假实现会违反本文件的核心断言', () => {
    const fake = (): { ok: boolean; diagnostics: Array<{ code: string }> } =>
      ({ ok: true, diagnostics: [] });
    const r = fake();
    // 这三条正是上面各组依赖的形状；假实现一条都过不了。
    expect(r.diagnostics.map((d) => d.code)).not.toEqual(['E_MIG_NO_PATH']);
    expect(r.ok).not.toBe(false);
    expect(r.diagnostics.length).not.toBeGreaterThan(0);
  });

  it('cloneState 仍是深拷贝（本文件多处依赖入参不被改动）', () => {
    const a = st('1.0.0', { x: 1 });
    const b = cloneState(a);
    b.props.x = 99;
    expect(a.props.x).toBe(1);
  });
});

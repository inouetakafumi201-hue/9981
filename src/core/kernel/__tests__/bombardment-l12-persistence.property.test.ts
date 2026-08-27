/**
 * Feature: wakeup-engine-bombardment
 * Property 8: L12 Persistence 快照重放往返
 * Validates: Requirements 8.1, 8.2, 8.3
 *
 * 用真实 harness（createFullHarness）+ 随机 Op 意图序列（opSequenceArb）驱动，把每一步
 * 成功 Op 的 journal 记录下来，然后做三件事：
 * - 8.1 快照往返：从空态重放同一 journal，终局状态与原始跑逐字节等价（world/六顶层集合/containers），
 *   证明 persistence 捕获了全部确定性写入（含 L10 rng 计数器与 L9 deferredEffects——因此随机
 *   与延迟时序在快照重放后仍逐位复现）。
 * - 8.2 分叉往返：中途 checkpoint，恢复后从该点继续放与从空态一路跑到底等价。
 * - 8.3 重放不变量：重放终局 InvariantChecker 零 fatal。
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import prand from 'pure-rand';
import { createFullHarness, defaultSeedDefs } from '../testing/full-harness';
import { runOpSequence, resetDriverRng } from '../testing/op-sequence-driver';
import { opSequenceArb, type OpIntent } from '../testing/op-sequence-arbitrary';
import { InvariantChecker } from '../ops/invariants';
import { resetIdCounters } from '../state/ids';
import { replay, InMemoryCheckpointStore, type CheckpointStore } from '../persistence/persistence';

const invariantChecker = new InvariantChecker();

// ---- 确定性 PRNG ----
// driver 用模块内自持种子的 LCG 解析挂起的 `existing`/prefab 挂起 Id（见 op-sequence-driver.ts），
// 采集 run 与重放 run 各自从同一默认种子独立起步，从而在同位置解析出完全一致的挂起 Id——
// 不再需要替换全局 Math.random。这里在每次 run 前刻意 reset 到初始种子，保证跨 run 可复现。
// （bdb3f5b「checkpoint: design-currency sub-batch …」已记录此改动；op-sequence-driver.ts 的
//   seedDriverRng/resetDriverRng 见同 commit。）
function seedDeterministicRandom(): void {
  // driver 默认种子即 0x9e3779b9；这里显式复原一次，锁定跨重复 run 的一致性。
  resetDriverRng();
}

/** 收集一次完整 run 里所有成功 Op 的 journal（{op,args}）。只用成功 Op 重放，失败被跳过。 */
function collectJournal(h: ReturnType<typeof createFullHarness>, intents: OpIntent[]): { op: string; args: unknown }[] {
  const journal: { op: string; args: unknown }[] = [];
  const logs = runOpSequence(h, intents);
  for (const log of logs) {
    if (log.op && log.result?.ok) journal.push({ op: log.op, args: log.args });
  }
  return journal;
}

/** 从空态重放 journal（只应用 OpRegistry.invoke 成功者，失败跳过）。 */
function replayJournal(h: ReturnType<typeof createFullHarness>, journal: { op: string; args: unknown }[]): void {
  void replay(
    journal.map((r, i) => ({ ...r, seq: i + 1, timestamp: 0 })),
    { invoke: (op, args) => h.registry.invoke(op, args) as unknown as { ok: boolean } },
  );
}

/** 快照比对全表层：world（含 rng/deferredEffects）+ 六顶层集合 + containers 逐字节相等。 */
function expectStateEquivalent(a: ReturnType<typeof createFullHarness>, b: ReturnType<typeof createFullHarness>): void {
  expect(b.holder.getState().world).toEqual(a.holder.getState().world);
  expect(b.holder.getState().defs).toEqual(a.holder.getState().defs);
  expect(b.holder.getState().nodes).toEqual(a.holder.getState().nodes);
  expect(b.holder.getState().links).toEqual(a.holder.getState().links);
  expect(b.holder.getState().entities).toEqual(a.holder.getState().entities);
  expect(b.holder.getState().items).toEqual(a.holder.getState().items);
  expect(b.holder.getState().containers).toEqual(a.holder.getState().containers);
}

/** 生成确定性意图 chunk（长度给定）。用 opSequenceArb 固定种子生成后再取前 len 条。 */
function chunkIntents(len: number): OpIntent[] {
  const intended = opSequenceArb(len, len);
  // 用 pure-rand 的确定性随机源构造 fast-check Random，每次调用都从同一种子独立克隆，
  // 保证 chunk 内容可复现且互不污染。
  const pr = prand.xorshift128plus(0xCAFEBABE);
  const arr = new fc.Random(pr.clone());
  return intended.generate(arr, undefined).value as OpIntent[];
}

describe('Feature: wakeup-engine-bombardment, Property 8: L12 Persistence 快照重放往返', () => {
  it('8.1 快照往返：长序列（80-160）终局与从空态重放 journal 逐字节等价', () => {
    fc.assert(
      fc.property(opSequenceArb(80, 160), (intents) => {
        resetIdCounters();
        seedDeterministicRandom();
        const h1 = createFullHarness(defaultSeedDefs());
        const journal = collectJournal(h1, intents);

        resetIdCounters();
        const h2 = createFullHarness(defaultSeedDefs());
        replayJournal(h2, journal);

        // 顶层事务的 Id 计数器推进与事务提交/回滚已对齐（OpRegistry.invoke begin/commit/rollback
        // Id 计数器作用域，见 state/ids.ts + ops/registry.ts）：失败或回滚的 Op 不再残留任何编号，
        // 因此同一成功 Op 序列在采集 run 与重放 run 里得到完全一致的 Id 序列。此处断言逐字节等价
        // ——任何状态字段背离（含 Id 编号）都意味着持久化契约被破坏。driver 的 existing 挂起 Id
        // 解析也已改为确定性 LCG，两次 run 在同位置选到完全一致的挂起 Id。
        expectStateEquivalent(h1, h2);
      }),
      { numRuns: 40, seed: 7777 },
    );
  });

  it('8.2 分叉往返：中途 checkpoint，恢复后从该点继续与从空态一路跑等价', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 4, max: 10 }), { minLength: 2, maxLength: 4 }),
        (chunkLens) => {
          resetIdCounters();
          seedDeterministicRandom();
          const h1 = createFullHarness(defaultSeedDefs());
          const store: CheckpointStore = new InMemoryCheckpointStore();
          const journal: { op: string; args: unknown }[] = [];
          const checkpoints: { name: string; atJournalLen: number }[] = [];

          for (const len of chunkLens) {
            const chunk = chunkIntents(len);
            // 打一个 checkpoint（当前累计进度再 +1 chunk 前的状态）
            checkpoints.push({ name: `cp-${journal.length}`, atJournalLen: journal.length });
            const chunkLog = runOpSequence(h1, chunk);
            for (const log of chunkLog) {
              if (log.op && log.result?.ok) journal.push({ op: log.op, args: log.args });
            }
          }

          // 基线：从空态重放全 journal
          resetIdCounters();
          const hBase = createFullHarness(defaultSeedDefs());
          replayJournal(hBase, journal);

          // 分叉：对每个 checkpoint，恢复其记录点（累计到该点为止的 journal 前缀），
          // 再从该前缀继续重放剩余全部 journal，结果应与基线一致。
          for (const cp of checkpoints) {
            resetIdCounters();
            const hBranch = createFullHarness(defaultSeedDefs());
            const prefix = journal.slice(0, cp.atJournalLen);
            replayJournal(hBranch, prefix);
            store.checkpoint(cp.name, hBranch.holder.getState());
            const resumed = store.restore(cp.name);
            expect(resumed).not.toBeNull();
            // 直接从 checkpoint 状态继续重放剩余部分
            const hResume = createFullHarness(defaultSeedDefs());
            hResume.holder.setState(resumed as never);
            const rest = journal.slice(cp.atJournalLen);
            // 重放剩余需要先让 registry 的 defs 就绪——用新 harness 的 registry 执行
            for (const entry of rest) {
              hResume.registry.invoke(entry.op, entry.args as never);
            }
            expectStateEquivalent(hBase, hResume);
          }
        },
      ),
      { numRuns: 10 },
    );
  });

  it('8.3 重放不变量：快照重放终局 InvariantChecker 零 fatal', () => {
    fc.assert(
      fc.property(opSequenceArb(100, 180), (intents) => {
        resetIdCounters();
        seedDeterministicRandom();
        const h = createFullHarness(defaultSeedDefs());
        const journal = collectJournal(h, intents);
        resetIdCounters();
        const h2 = createFullHarness(defaultSeedDefs());
        replayJournal(h2, journal);
        const fatal = invariantChecker.checkAll(h2.holder.getState()).filter((d) => d.severity === 'fatal');
        expect(fatal, `重放后不变量违反: ${fatal.map((d) => `${d.code}: ${d.message}`).join('; ')}`).toEqual([]);
      }),
      { numRuns: 30 },
    );
  });

  // 归因说明（占位 footer，避免文件以 describe 块截断）：
  void invariantChecker;
});

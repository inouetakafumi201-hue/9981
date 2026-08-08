/**
 * L3 Ops: Transaction（design.md 3.4节 / 需求21.1-21.4）。
 *
 * 工程决策（记录于 决策与风险记录.md）：设计文档把 Transaction 描述为
 * begin/commit/rollback 三个方法，但示例代码（stackSplit）显示同一个 ctx.tx 会在
 * OpRegistry.invoke 已经开启的外层事务之内再次调用 begin/commit/rollback 做内部子步骤的
 * 原子性——这意味着 Transaction 必须支持"保存点"（savepoint）语义的嵌套，而不是一个只能用一次
 * 的一次性事务对象。本实现用一个 draft 快照栈表达：begin() 推入一层保存点，commit() 弹出保存点
 * 并把改动合并到上一层，rollback() 弹出保存点并丢弃改动（恢复到该 begin() 调用前的 draft）。
 * journalMark 与 draft 快照同层保存，保证 rollback 时 journal 也同步截断，不残留已回滚的记录。
 */
import type { WorldState } from '../state/world-state.js';
import type { Value } from '../state/value.js';
import { DEFAULT_LOG_RETENTION, appendLogEntry } from '../state/event-log.js';

export interface JournalEntry {
  readonly op: string;
  readonly args: unknown;
  readonly inverse: () => void;
}

interface Frame {
  draft: WorldState;
  journalMark: number;
}

export class Transaction {
  private readonly frames: Frame[];
  private readonly journalEntries: JournalEntry[] = [];
  private readonly emittedEvents: { type: string; payload: Record<string, Value> }[] = [];

  constructor(initial: WorldState) {
    this.frames = [{ draft: initial, journalMark: 0 }];
  }

  /** 开启一层事务/保存点（需求21.1）。 */
  begin(): void {
    this.frames.push({ draft: this.getDraft(), journalMark: this.journalEntries.length });
  }

  /** 当前工作状态（draft），供 Op 实现读取。 */
  getDraft(): WorldState {
    return this.frames[this.frames.length - 1]!.draft;
  }

  /** 写入新的工作状态（不可变更新的结果），供 Op 实现调用。 */
  setDraft(next: WorldState): void {
    this.frames[this.frames.length - 1]!.draft = next;
  }

  /** 记录一个 Op 及其逆操作，供 journal/replay 使用（需求37.2）。 */
  logOp(op: string, args: unknown, inverse: () => void): void {
    this.journalEntries.push({ op, args, inverse });
  }

  recordEmit(type: string, payload: Record<string, Value>): void {
    this.emittedEvents.push({ type, payload });
    // 需求15.1-15.2：已发生的 Event 进入有界环形缓冲 world.log，窗口由 draft 里的 logRetention
    // 驱动（PlaypackDef.logRetention 装载时写入 world.logRetention）。写在 draft 上而不是进程内
    // 数组，这样它随事务一起提交/回滚，并被 snapshot/replay 捕获——被回滚的 Op 不该在日志里留痕。
    const draft = this.getDraft();
    this.setDraft(appendLogEntry(draft, type, payload, draft.world.logRetention ?? DEFAULT_LOG_RETENTION));
  }

  getEmittedEvents(): readonly { type: string; payload: Record<string, Value> }[] {
    return this.emittedEvents;
  }

  /** 提交当前保存点：把 draft 合并到上一层，不做不变量检查（检查由 OpRegistry.invoke 在最外层负责）。 */
  commit(): void {
    if (this.frames.length <= 1) return; // 没有匹配的 begin()，视为无操作（防御性容错）
    const top = this.frames.pop() as Frame;
    this.frames[this.frames.length - 1]!.draft = top.draft;
  }

  /** 回滚当前保存点：丢弃自对应 begin() 以来的全部 draft 改动与 journal 记录（需求21.3-21.4）。 */
  rollback(): void {
    if (this.frames.length <= 1) return;
    const top = this.frames.pop() as Frame;
    this.journalEntries.length = top.journalMark;
  }

  /** 最终提交后的工作状态（栈底），供 OpRegistry.invoke 写回 WorldStateHolder。 */
  getFinalDraft(): WorldState {
    return this.frames[0]!.draft;
  }

  getJournalEntries(): readonly JournalEntry[] {
    return this.journalEntries;
  }

  /** 当前嵌套深度，>1 表示 Op 实现内部正在使用子事务（如 stack.split 的三步原子性）。 */
  depth(): number {
    return this.frames.length;
  }
}

/** 持有内核当前的权威 WorldState 引用，OpRegistry.invoke 在事务提交成功后调用 setState 完成切换。 */
export class WorldStateHolder {
  private state: WorldState;

  constructor(initial: WorldState) {
    this.state = initial;
  }

  getState(): WorldState {
    return this.state;
  }

  setState(next: WorldState): void {
    this.state = next;
  }
}

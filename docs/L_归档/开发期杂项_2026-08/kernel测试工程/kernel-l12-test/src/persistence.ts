export interface WorldState {
  version: string;
  playpackId: string;
  phaseIndex: number;
  props: Record<string, number>;
  randomCounter: number;
}

export interface Op {
  id: string;
  apply: (s: WorldState) => WorldState;
}

export interface JournalEntry {
  seq: number;
  op: Op;
}

export interface Snapshot {
  id: string;
  state: WorldState;
  createdAt: number;
}

export function cloneState(s: WorldState): WorldState {
  return { ...s, props: { ...s.props } };
}

/** 版本号形状：三段十进制非负整数。 */
export const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * 版本号合法性校验。
 *
 * 定义在本层而非 migration 层，是为了让 checkWorldState 与 loadSnapshot
 * 共用同一个判据。若两处各写一份正则，二者可以静默漂移，
 * 于是"状态自检认为合法"与"装载认为合法"会给出矛盾的答案。
 */
export function isWellFormedVersion(v: string): boolean {
  return VERSION_PATTERN.test(v);
}

/**
 * WorldState 良构性自检，返回违规描述列表（空列表 = 无违规）。
 *
 * 返回列表而不抛错：调用方需要一次看到全部违规。
 * 抛错只能报告第一条，注入多重损坏时无法区分"检查器查到一条就跑了"
 * 与"检查器只认得一条"。
 */
export function checkWorldState(s: WorldState, where = 'state'): string[] {
  const v: string[] = [];
  if (typeof s.version !== 'string' || !isWellFormedVersion(s.version)) {
    v.push(`${where}.version 非法: ${JSON.stringify(s.version)}`);
  }
  if (typeof s.playpackId !== 'string' || s.playpackId.length === 0) {
    v.push(`${where}.playpackId 非法: ${JSON.stringify(s.playpackId)}`);
  }
  if (!Number.isInteger(s.phaseIndex) || s.phaseIndex < 0) {
    v.push(`${where}.phaseIndex 必须为非负整数，实为 ${s.phaseIndex}`);
  }
  if (!Number.isInteger(s.randomCounter) || s.randomCounter < 0) {
    v.push(`${where}.randomCounter 必须为非负整数，实为 ${s.randomCounter}`);
  }
  if (s.props === null || typeof s.props !== 'object') {
    v.push(`${where}.props 必须为对象，实为 ${JSON.stringify(s.props)}`);
  } else {
    for (const [k, n] of Object.entries(s.props)) {
      if (typeof n !== 'number' || !Number.isFinite(n)) {
        v.push(`${where}.props[${JSON.stringify(k)}] 必须为有限数，实为 ${JSON.stringify(n)}`);
      }
    }
  }
  return v;
}

/**
 * 快照发号器。
 *
 * 计数器必须是实例态而非模块态：模块级 `let snapshotCounter` 会让两个互不相干的
 * 世界共享编号，且使测试结果依赖执行顺序（先跑的用例吃掉小号）。
 */
export class SnapshotStore {
  private counter = 0;

  /**
   * 拍摄快照。
   *
   * 必须深拷贝：快照的全部意义是与活状态隔离。若按引用持有，
   * 之后任何原地修改都会同步改掉"历史"，replay/checkpoint 失去意义。
   */
  take(state: WorldState): Snapshot {
    const seq = ++this.counter;
    return { id: `snap:${seq}`, state: cloneState(state), createdAt: seq };
  }

  count(): number {
    return this.counter;
  }

  /** 发号器自检：计数必须是非负整数，单调性由 ++ 保证。 */
  checkInvariants(): string[] {
    return Number.isInteger(this.counter) && this.counter >= 0
      ? []
      : [`SnapshotStore.counter 必须为非负整数，实为 ${this.counter}`];
  }
}

/** 默认发号器。保留自由函数形态以兼容既有调用点。 */
const defaultSnapshotStore = new SnapshotStore();

export function takeSnapshot(state: WorldState): Snapshot {
  return defaultSnapshotStore.take(state);
}

/** 供测试隔离使用：重置默认发号器。 */
export function resetSnapshotCounter(): void {
  (defaultSnapshotStore as unknown as { counter: number }).counter = 0;
}

export class Journal {
  private records: JournalEntry[] = [];
  private seq = 0;

  append(op: Op): void {
    this.records.push({ seq: ++this.seq, op });
  }

  getAll(): readonly JournalEntry[] {
    return this.records;
  }

  since(seq: number): readonly JournalEntry[] {
    return this.records.filter((r) => r.seq > seq);
  }

  trim(maxRecords: number): void {
    if (maxRecords <= 0) {
      this.records = [];
      return;
    }
    if (this.records.length > maxRecords) {
      this.records = this.records.slice(this.records.length - maxRecords);
    }
  }

  clear(): void {
    this.records = [];
    this.seq = 0;
  }

  /**
   * 日志自检。
   *
   * seq 必须严格递增：重放依赖顺序，两条同号或逆序的记录会让
   * "从第 n 条之后重放"变成不确定操作。
   * 同时 this.seq 必须 >= 最大记录号，否则 append 会发出重复号。
   */
  checkInvariants(): string[] {
    const v: string[] = [];
    let prev = -Infinity;
    for (const r of this.records) {
      if (!Number.isInteger(r.seq)) v.push(`记录 seq 非整数: ${r.seq}`);
      if (r.seq <= prev) v.push(`记录 seq 非严格递增: ${prev} 之后出现 ${r.seq}`);
      prev = r.seq;
      if (r.op === null || typeof r.op !== 'object' || typeof r.op.apply !== 'function') {
        v.push(`记录 seq=${r.seq} 的 op 非法`);
      }
    }
    const max = this.records.length === 0 ? 0 : this.records[this.records.length - 1]!.seq;
    if (this.seq < max) {
      v.push(`发号器 seq=${this.seq} 小于最大记录号 ${max}，后续 append 会发重号`);
    }
    return v;
  }
}

/**
 * replay: 从seed状态开始按顺序重放Op序列，重建状态。
 *
 * 必须先克隆 seed 再重放：Op.apply 的纯度由 Op 的作者负责，本层无法强制。
 * 若直接以 seed 起步，一个原地修改的 Op 会改掉调用方的 seed，于是
 * `replay(seed, ops)` 两次调用结果不同——重放的全部意义（同一 seed + 同一
 * 日志 ⇒ 同一状态）就此失效，而且失效方式是静默的。
 *
 * 克隆对纯 Op 无任何行为影响，故这是只补强不改语义的修复。
 */
export function replay(seed: WorldState, ops: readonly Op[]): WorldState {
  let state = cloneState(seed);
  for (const op of ops) {
    state = op.apply(state);
  }
  return state;
}

export class CheckpointStore {
  private checkpoints: Map<string, WorldState> = new Map();
  private order: string[] = [];

  /** 存入时拷贝：否则检查点会跟着活状态一起变。 */
  checkpoint(label: string, state: WorldState): void {
    if (!this.checkpoints.has(label)) this.order.push(label);
    this.checkpoints.set(label, cloneState(state));
  }

  /** 取出时也拷贝：否则调用方改动返回值会污染检查点，且同一标签可被反复恢复。 */
  restore(label: string): WorldState {
    const s = this.checkpoints.get(label);
    if (!s) throw new Error('E_PERSIST_CHECKPOINT_NOT_FOUND');
    return cloneState(s);
  }

  has(label: string): boolean {
    return this.checkpoints.has(label);
  }

  list(): string[] {
    return [...this.order];
  }

  remove(label: string): void {
    this.checkpoints.delete(label);
    const idx = this.order.indexOf(label);
    if (idx !== -1) this.order.splice(idx, 1);
  }

  /**
   * 检查点库自检。
   *
   * order 与 checkpoints 是同一集合的两种表示，必须逐元素一致：
   * order 里多一个 → list() 报告一个 restore 会抛错的标签；
   * 少一个 → 该检查点存在却不出现在 list() 里，等于泄漏。
   * order 内重复 → remove 一次后 list() 仍显示它。
   */
  checkInvariants(): string[] {
    const v: string[] = [];
    const seen = new Set<string>();
    for (const label of this.order) {
      if (seen.has(label)) v.push(`order 内标签重复: ${JSON.stringify(label)}`);
      seen.add(label);
      if (!this.checkpoints.has(label)) {
        v.push(`order 含无对应状态的标签: ${JSON.stringify(label)}`);
      }
    }
    for (const label of this.checkpoints.keys()) {
      if (!seen.has(label)) v.push(`检查点未登记进 order: ${JSON.stringify(label)}`);
    }
    if (this.order.length !== this.checkpoints.size) {
      v.push(`order 长度 ${this.order.length} 与检查点数 ${this.checkpoints.size} 不符`);
    }
    for (const [label, s] of this.checkpoints) {
      v.push(...checkWorldState(s, `检查点[${JSON.stringify(label)}]`));
    }
    return v;
  }
}

/** PhaseBoundaryLog：每次相位边界记录一次全量快照，供rewind(n)使用 */
export class PhaseBoundaryLog {
  private snapshots: WorldState[] = [];

  /** 存入时拷贝：边界日志记的是"当时的状态"，不能是活引用。 */
  markBoundary(state: WorldState): void {
    this.snapshots.push(cloneState(state));
  }

  /**
   * rewind(n): 回退n个相位边界，返回该边界处的状态。
   * 返回拷贝：rewind 是只读回看，多次 rewind 同一 n 必须得到同一结果。
   */
  rewind(n: number): WorldState {
    if (n <= 0) throw new Error('E_PERSIST_REWIND_INVALID');
    const idx = this.snapshots.length - 1 - n;
    if (idx < 0) throw new Error('E_PERSIST_REWIND_OUT_OF_RANGE');
    return cloneState(this.snapshots[idx]!);
  }

  count(): number {
    return this.snapshots.length;
  }

  /** 边界日志自检：每条历史快照都必须是良构状态。 */
  checkInvariants(): string[] {
    const v: string[] = [];
    this.snapshots.forEach((s, i) => v.push(...checkWorldState(s, `边界[${i}]`)));
    return v;
  }
}

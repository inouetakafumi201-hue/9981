/**
 * 栈式撤销 / 重做历史（`01` §九「必要 vs 延后」：撤销 / 重做在必要列且不可延后）。
 *
 * 每个破坏性修改入栈一个「命令」，撤销走 `before` 快照、重做走 `after` 快照。
 * 往返恒等：`undo^n(redo^n(after)) == after`。栈空时 no-op（不抖动、不报错）。
 */
import type { MapData } from '../ports/map-contracts.js';

export interface HistoryEntry {
  readonly label: string; // 撤销菜单/日志显示名
  readonly before: MapData;
  readonly after: MapData;
}

export interface EditorHistory {
  readonly undoStack: readonly HistoryEntry[];
  readonly redoStack: readonly HistoryEntry[];
}

export function emptyHistory(): EditorHistory {
  return { undoStack: [], redoStack: [] };
}

/** 把一次修改入栈：清空 redo（新分支），`before` 压入 undo。 */
export function commitHistory(
  history: EditorHistory,
  label: string,
  before: MapData,
  after: MapData,
): EditorHistory {
  const entry: HistoryEntry = { label, before, after };
  return {
    undoStack: [...history.undoStack, entry],
    redoStack: [],
  };
}

/** 撤销到 `before`：`after` 移入 redo 栈。栈空 → 原样返回（no-op）。 */
export function undoHistory(history: EditorHistory, current: MapData): { history: EditorHistory; map: MapData } {
  const entry = history.undoStack[history.undoStack.length - 1];
  if (!entry) return { history, map: current };
  return {
    history: { undoStack: history.undoStack.slice(0, -1), redoStack: [...history.redoStack, entry] },
    map: entry.before,
  };
}

/** 重做到 `after`：`before` 移回 undo 栈。redo 空 → 原样返回（no-op）。 */
export function redoHistory(history: EditorHistory, current: MapData): { history: EditorHistory; map: MapData } {
  const entry = history.redoStack[history.redoStack.length - 1];
  if (!entry) return { history, map: current };
  return {
    history: { undoStack: [...history.undoStack, entry], redoStack: history.redoStack.slice(0, -1) },
    map: entry.after,
  };
}

/** 撤销栈深度（供 UI 显示"可撤销 N 步"）。 */
export function undoDepth(history: EditorHistory): number {
  return history.undoStack.length;
}

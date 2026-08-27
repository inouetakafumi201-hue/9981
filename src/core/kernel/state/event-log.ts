/**
 * L1 State: `world.log` 有界环形缓冲的纯函数写入与窗口裁剪（需求15.1-15.4）。
 *
 * 这里全部是纯函数：给定一个 WorldState 返回一个新的 WorldState。真正的调用点是 Op 执行路径
 * （`OpContext.emit` 经由 Transaction 落到 draft 上），属于写入通道情形(b)"Op 内部私有 helper"，
 * 不对外注册成独立 Op——日志写入不是创作者可以直接发起的动作，它是"事件已经发生"的副产物。
 *
 * 为什么把裁剪与写入放在一起：需求15.1 要求缓冲"有界"，若写入与裁剪分离成两步，任何忘记调用
 * 裁剪的路径都会让缓冲无界增长，而这正是需求15.4 与"不挂死"承诺要排除的情形。
 */
import type { Value } from './value';
import type { LogEntry, WorldState } from './world-state';

/**
 * 保留窗口声明（对应 `PlaypackDef.logRetention`，需求15.2）。
 * 两个维度可同时声明，取交集：既不超过 `max` 条，也不早于 `phases` 个相位之前。
 */
export interface LogRetention {
  readonly phases?: number;
  readonly max?: number;
}

/** 未声明 logRetention 时的兜底窗口：必须有界，不能退化成无限缓冲（需求15.1）。 */
export const DEFAULT_LOG_RETENTION: LogRetention = Object.freeze({ max: 512 });

/**
 * 按保留窗口裁剪日志。`nowPhase` 为当前相位时间戳，用于 `phases` 维度的裁剪。
 * 裁掉的是最旧的条目（环形缓冲语义），保留的条目相对顺序不变。
 */
export function applyLogRetention(
  log: readonly LogEntry[],
  retention: LogRetention,
  nowPhase: number,
): readonly LogEntry[] {
  let kept = log;
  if (retention.phases !== undefined && Number.isFinite(retention.phases) && retention.phases >= 0) {
    const oldestAllowedPhase = nowPhase - retention.phases;
    kept = kept.filter((entry) => entry.phase >= oldestAllowedPhase);
  }
  if (retention.max !== undefined && Number.isFinite(retention.max) && retention.max >= 0) {
    if (kept.length > retention.max) kept = kept.slice(kept.length - retention.max);
  }
  return kept === log ? log : kept;
}

/**
 * 追加一条 Event 到 `world.log` 并就地施加保留窗口。
 *
 * `seq` 取自 `world.logSeq`（已写入总数）而不是 `log.length`：窗口裁剪会移除旧条目，若用长度做
 * 序号，裁剪后新条目的 seq 会与已被裁掉的条目重复，"查最近一条 intent.resolved"这类按 seq 排序
 * 的查询就会给出错误答案。
 */
export function appendLogEntry(
  state: WorldState,
  type: string,
  payload: Record<string, Value>,
  retention: LogRetention = DEFAULT_LOG_RETENTION,
): WorldState {
  const seq = state.world.logSeq + 1;
  const phase = state.world.turn.phaseEnteredAt;
  const entry: LogEntry = { seq, type, payload, phase };
  const appended = [...state.world.log, entry];
  return {
    ...state,
    world: {
      ...state.world,
      log: applyLogRetention(appended, retention, phase),
      logSeq: seq,
    },
  };
}

/**
 * 把一条日志条目投影成 Expr/Query 可消费的 Value 映射。
 *
 * 日志条目不是 Ref 可寻址对象（见 world-state.ts 的 LogEntry 注释），所以 `from:'log'` 的查询
 * 结果只能是这种自描述映射，而不是 Ref。字段名与 Spec 里给出的查询写法一致
 * （`where: type=='death'`、读 `payload.source`），使玩法包表达式可以直接写 `$.type`/`$.payload.x`。
 */
export function logEntryToValue(entry: LogEntry): Value {
  return { seq: entry.seq, type: entry.type, phase: entry.phase, payload: entry.payload };
}

/**
 * 电脑 UI 端口（MetaStatePort）
 *
 * 电脑界面是一种"元状态"显示层，它消费游戏状态的只读快照，
 * 并通过指令面提交计算/管理操作。
 *
 * 设计纪律：
 * - ComputerStatePort 只读投影：消费 space-items/ai 通电的状态
 * - ComputerActionPort 提交显式 intent，不直接修改规则事实
 * - 状态同步通过 PresentationGateway 的 after:* 事件触发
 * - UI 只读快照，变化通过事件驱动
 */

import type { UiResult, UiDiagnostic } from '../../model/diagnostic';

/** 计算机运行的进程信息 */
export interface ProcessInfo {
  readonly id: string;
  readonly name: string;
  readonly status: 'running' | 'pending' | 'completed' | 'error';
  readonly cpuUsage: number;
  readonly memoryUsage: number;
}

/** 电脑状态快照 */
export interface ComputerState {
  readonly cpuLevel: number; // 0-5 评估等级
  readonly memoryUsed: number;
  readonly memoryTotal: number;
  readonly storageUsed: number;
  readonly storageTotal: number;
  readonly processes: readonly ProcessInfo[];
  readonly logs: readonly string[];
  readonly isActive: boolean;
}

/** 计算机操作指令 */
export interface ComputerOperation {
  readonly type: 'compute' | 'scan' | 'analyze' | 'decrypt' | 'hack';
  readonly target: string;
  readonly parameters?: Record<string, unknown>;
}

/** 元状态投影端口：电脑 UI 的只读数据源 */
export interface ComputerStatePort {
  /** 获取当前电脑状态快照 */
  fetchState(): UiResult<ComputerState>;

  /** 获取指定时间范围的日志 */
  fetchLogs(
    request: { readonly from: number; readonly to: number }
  ): UiResult<readonly string[]>;
}

/** 计算机动作端口：电脑 UI 提交的指令 */
export interface ComputerActionPort {
  /** 执行计算操作 */
  compute(operation: ComputerOperation): UiResult<void>;

  /** 启动扫描 */
  scan(target: string): UiResult<void>;

  /** 中止操作 */
  abort(processId: string): UiResult<void>;

  /** 重置电脑 */
  reset(): UiResult<void>;
}
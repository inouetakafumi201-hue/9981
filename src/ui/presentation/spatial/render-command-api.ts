/**
 * 渲染命令 API（R014、design.md §3.2）。
 *
 * 所有渲染命令只改变 UI surface 或播放演示，UI 不直接修改规则事实。
 * 命令可重放 / 可跳过 / 可降级（如无实体则 spawn 无操作）。
 *
 * 接口设计遵循"命令面仅提交意图，不维护状态"原则：
 * - 返回 `CommandOutcome` 表示提交是否被接受/拒绝/陈旧
 * - 实际状态变化通过 `after:*` 语义事件触发，UI 通过投影端口感知
 */

import type { Vec2 } from '../../../play/map/types';
import type { UiResult } from '../../model/diagnostic';

/** 命令提交结果 */
export type CommandOutcome = UiResult<void>;

/** 渲染命令 API */
export interface RenderCommandApi {
  /** 生成实体（spawn）。目标是地图节点或全局位置。 */
  spawn(spec: { readonly def: string; readonly position: Vec2; readonly nodeId?: string }): CommandOutcome;

  /** 实体移动 */
  move(spec: { readonly entityId: string; readonly target: Vec2 }): CommandOutcome;

  /** 实体攻击 */
  attack(spec: { readonly attacker: string; readonly target: string }): CommandOutcome;

  /** 播放效果 */
  effect(spec: {
    readonly type: 'hit-feedback' | 'damage' | 'heal' | 'teleport';
    readonly target: string;
    readonly intensity?: number;
  }): CommandOutcome;

  /** 触发显著状态 */
  standoff(spec: { readonly entityId: string; readonly triggerStates: readonly string[] }): CommandOutcome;

  /** 聚焦层级 */
  layerFocus(spec: { readonly layerId: string; readonly duration?: number }): CommandOutcome;

  /** 全屏动画 */
  fullscreen(spec: {
    readonly type: 'fade' | 'portal' | 'scanlines';
    readonly duration?: number;
    readonly theme?: 'cyan' | 'warm' | 'blue' | 'red';
    readonly label?: string;
  }): CommandOutcome;

  /** 震馅反馈（屏幕抖动） */
  hitFeedback(spec: { readonly intensity?: number; readonly direction?: Vec2 }): CommandOutcome;

  /** 弹出通知 */
  toast(spec: { readonly message: string; readonly duration?: number }): CommandOutcome;

  /** 播放音效 */
  audio(spec: { readonly id: string; readonly volume?: number; readonly loop?: boolean }): CommandOutcome;

  /** 结果反馈 */
  outcome(spec: { readonly success: boolean; readonly message: string }): CommandOutcome;

  /** 轮次栏更新 */
  turnOrder(spec: { readonly participants: readonly string[] }): CommandOutcome;
}

export type RenderCommandTrigger = 'after-event' | 'projection' | 'local-input'

export type RenderCommandOutcome =
  | 'accepted'
  | 'completed'
  | 'skipped'
  | 'degraded'
  | 'failed'
  | 'timeout'
  | 'cancelled'
  | 'stale'

export interface RenderCommand {
  readonly commandId: string
  readonly semanticId: string
  readonly sourceRevision: number
  readonly targetPageId?: string
  readonly trigger: RenderCommandTrigger
  readonly advancesJourney: false
  readonly payload: Readonly<Record<string, unknown>>
}
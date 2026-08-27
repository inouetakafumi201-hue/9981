/**
 * R11: 渲染策略。
 *
 * 下游消费者（RenderCommandExecutor 的 caller / GroundGlowStore）根据此对象调整表现：
 * - reducedMotion=true → move 命令以 'degraded' 提交（直接 final state，不插帧）
 * - lowPerformance=true → GroundGlowFootprint 半径固定为 base（32/16）
 *
 * 设计选择：用对象而非媒体查询；壳层负责探测系统偏好，构造策略对象，
 * 注入到 PresentationRuntime.deps.accessibility。
 */

export interface AccessibilityConfig {
  readonly reducedMotion: boolean
  readonly lowPerformance: boolean
}

export const DEFAULT_ACCESSIBILITY: AccessibilityConfig = Object.freeze({
  reducedMotion: false,
  lowPerformance: false,
})

/**
 * 派生效用：reducedMotion 下的 move 命令 'degraded' 化。
 */
export function isMoveDegraded(config: AccessibilityConfig): boolean {
  return config.reducedMotion
}

/**
 * 派生效用：lowPerformance 下 footprint 半径固定 base，不随 entity 增长。
 */
export function isFootprintBaseOnly(config: AccessibilityConfig): boolean {
  return config.lowPerformance
}

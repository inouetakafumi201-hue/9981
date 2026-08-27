/**
 * wiring-mode.ts —— 表现层接线专项 D 阶段交付。
 *
 * 职责：导出 WiringMode 枚举 + get/set 状态 + 路由判断函数，供 V0 壳 side 接线使用。
 *
 * 写锁：本文件在 `.kiro/specs/wakeup-presentation-wiring/design.md` §组件和接口 4
 * `realTransportAdapter` 写锁区 `src/devboard/wiring/presentation-wiring/v0-bridge/**` 内。
 */

export type WiringMode = 'mock' | 'real' | 'iter-V0'

let _currentMode: WiringMode = 'mock'

export function getWiringMode(): WiringMode {
  return _currentMode
}

export function setWiringMode(mode: WiringMode): void {
  _currentMode = mode
}

export function isRealMode(mode: WiringMode): boolean {
  return mode === 'real' || mode === 'iter-V0'
}

export function wiringModeLabel(mode: WiringMode): string {
  switch (mode) {
    case 'mock':     return 'MOCK'
    case 'real':     return 'REAL'
    case 'iter-V0':  return 'ITER-V0'
  }
}

export function wiringModeColor(mode: WiringMode): string {
  switch (mode) {
    case 'mock':    return '#888888'
    case 'real':    return '#22c55e'
    case 'iter-V0': return '#3b82f6'
  }
}

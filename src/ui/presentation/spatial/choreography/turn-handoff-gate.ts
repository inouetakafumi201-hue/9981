export const TURN_HANDOFF_HARD_LIMIT_MS = 3000

export class TurnHandoffGate {
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null
  private timeoutFired = false

  arm(forceRelease: () => void): void {
    this.clear()
    this.timeoutFired = false
    this.timeoutHandle = setTimeout(() => {
      this.timeoutFired = true
      this.timeoutHandle = null
      forceRelease()
    }, TURN_HANDOFF_HARD_LIMIT_MS)
  }

  release(): boolean {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle)
      this.timeoutHandle = null
      return false
    }
    return this.timeoutFired
  }

  clear(): void {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle)
      this.timeoutHandle = null
    }
  }

  get isArmed(): boolean {
    return this.timeoutHandle !== null
  }
}

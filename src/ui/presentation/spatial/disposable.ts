/**
 * Disposable — R9 公共释放协议。
 *
 * 凡是持有 timer/raf/subscription/active-state 的资源都实现它。
 * PresentationRuntime.dispose() 链式调用，确保：
 *   - 多次 dispose() 幂等
 *   - dispose() 后所有 read 操作是 no-op（不报错）
 *   - dispose() 后所有 write 操作是 no-op（不抛错）
 */
export interface Disposable {
  /** 释放本组件持有的所有资源。多次调用等价于一次。 */
  dispose(): void
  /** 调试用：组件名，方便排错。 */
  readonly debugName: string
}

/**
 * 组合多个 Disposable，链式 dispose，最后一个调用完成后停止。
 * 任意一个 dispose 抛错不影响其它 disposable 的释放。
 */
export class DisposableStack implements Disposable {
  private disposed = false
  private items: Disposable[]

  constructor(items: readonly Disposable[]) {
    this.items = items.slice()
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  get debugName(): string {
    return `Stack(${this.items.map((i) => i.debugName).join(', ')})`
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const item of this.items) {
      try {
        item.dispose()
      } catch {
        // 单个组件 dispose 失败不影响其它组件
      }
    }
    this.items = []
  }
}

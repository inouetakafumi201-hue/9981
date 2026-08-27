// B7-05 §5 BitmapCachePool —— 解码产物（chroma-key 后的透明 PNG data URL）的 LRU 缓存池。
//
// 为什么单独成文件：chroma-key.ts（解码热路径）与 b7-coherence.ts（编排/诊断）都要用它。
// 把它放进任意一边都会造成 chroma-key ↔ coherence 的循环依赖；抽成独立模块后两边都只
// 单向依赖这里，没有环。
//
// 为什么要 LRU 而不是改造前那个无界 Map：改造前 chroma-key 把每一张解码结果永久留在一个
// 无上限的 Map 里。会话里进出过的每一帧 sprite（角色 16 帧 + 立绘 + 驻地 + HUD…）解码
// 后的 data URL 都不回收，等价像素内存单调增长——正是 B7-05 §15「连续 5 分钟内存无单调
// 增长」要卡的那条。这里按等价像素字节记账，超过 256MB 上限就回收最旧条目（真 LRU：命中
// 即刷新最近使用位），把解码内存钉在一个有界水位上。回收后的帧若再次需要，DecodePipeline
// 会重新解码——用一次重解码换掉不回收的内存泄漏，这是既定取舍。

export interface BitmapCacheEntry {
  /** chroma-key 之后的透明 PNG data URL（可直接作为 <img> src） */
  readonly url: string
  /** 等价像素内存：width * height * 4（RGBA），用于 LRU 记账 */
  readonly bytes: number
}

type Listener = () => void

export class BitmapCachePool {
  /** Map 的插入顺序即 LRU 顺序：队首=最久未用，队尾=最近用。 */
  private readonly map = new Map<string, BitmapCacheEntry>()
  private bytes = 0

  readonly limitBytes: number
  evictions = 0
  hits = 0
  misses = 0
  /** 供 React 侧 useSyncExternalStore 订阅的版本号，任何可观测变化即自增。 */
  version = 0

  private readonly listeners = new Set<Listener>()

  constructor(limitBytes: number) {
    this.limitBytes = limitBytes
  }

  /** 命中则刷新最近使用位并返回 url；未命中返回 undefined。 */
  get(key: string): string | undefined {
    const entry = this.map.get(key)
    if (!entry) {
      this.misses++
      return undefined
    }
    this.hits++
    // 刷新 LRU 位：删除后重新插入 → 移到队尾（最近使用）
    this.map.delete(key)
    this.map.set(key, entry)
    return entry.url
  }

  /** 只读探测，不影响 LRU 顺序、不计入命中率——给同步「是否已就绪」判断用。 */
  peek(key: string): string | undefined {
    return this.map.get(key)?.url
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  set(key: string, url: string, bytes: number): void {
    const prev = this.map.get(key)
    if (prev) {
      this.bytes -= prev.bytes
      this.map.delete(key)
    }
    this.map.set(key, { url, bytes })
    this.bytes += bytes
    this.evictToLimit()
    this.emit()
  }

  /** 超上限则从队首（最旧）逐条回收，直到回到上限内（至少保留 1 条，避免刚写就被自己挤掉）。 */
  private evictToLimit(): void {
    while (this.bytes > this.limitBytes && this.map.size > 1) {
      const oldestKey = this.map.keys().next().value as string | undefined
      if (oldestKey === undefined) break
      const oldest = this.map.get(oldestKey)
      if (oldest) this.bytes -= oldest.bytes
      this.map.delete(oldestKey)
      this.evictions++
    }
  }

  get bytesInUse(): number {
    return this.bytes
  }

  get entryCount(): number {
    return this.map.size
  }

  /** 缓存占用占上限的比例，0–1。 */
  get fill(): number {
    return this.limitBytes > 0 ? this.bytes / this.limitBytes : 0
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(): void {
    this.version++
    for (const l of this.listeners) l()
  }
}

// 会话级单例：256MB 等价像素内存上限（B7-05 §9 bitmapCacheLimit）。
export const bitmapCache = new BitmapCachePool(256 * 1024 * 1024)

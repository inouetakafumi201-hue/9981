'use client'

// B7-05 React 绑定层：把框架无关的引擎单例（scheduler / uploadQueue / longTaskMonitor /
// preloadScheduler / bitmapCache）以 useSyncExternalStore 暴露给验收台。
//
// 每个单例维护一个 `version` 计数器，任何可观测变化即自增。这里的 snapshot 就是那个数字，
// React 靠它决定是否重渲染，组件再直接读单例上的实时字段。用数字做 snapshot 避免了每帧
// 构造新对象（否则 useSyncExternalStore 会因引用不稳定无限重渲染）。

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import {
  bitmapCache,
  type BitmapCachePool,
} from '@/lib/bitmap-cache'
import {
  longTaskMonitor,
  preloadScheduler,
  scheduler,
  uploadQueue,
  sceneReadinessGate,
  type AssetLoadPhase,
} from '@/lib/b7-coherence'

interface VersionedStore {
  version: number
  subscribe(cb: () => void): () => void
}

function useStoreVersion(store: VersionedStore): number {
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), [store])
  const getSnapshot = useCallback(() => store.version, [store])
  // SSR：返回稳定的 0，避免 hydration 抖动
  return useSyncExternalStore(subscribe, getSnapshot, () => 0)
}

export function useSchedulerStats() {
  useStoreVersion(scheduler)
  return {
    depth: scheduler.depth,
    ranLastFrame: scheduler.ranLastFrame,
    yieldedLastFrame: scheduler.yieldedLastFrame,
    peakDepth: scheduler.peakDepth,
    totalRun: scheduler.totalRun,
    totalYieldFrames: scheduler.totalYieldFrames,
    lastSliceMs: scheduler.lastSliceMs,
  }
}

export function useUploadQueueStats() {
  useStoreVersion(uploadQueue)
  return {
    depth: uploadQueue.depth,
    peakDepth: uploadQueue.peakDepth,
    lastBatch: uploadQueue.lastBatch,
    totalUploaded: uploadQueue.totalUploaded,
  }
}

export function useLongTaskMonitor(autoStart = true) {
  useEffect(() => {
    if (autoStart) longTaskMonitor.start()
  }, [autoStart])
  useStoreVersion(longTaskMonitor)
  return {
    fps: longTaskMonitor.fps,
    longTaskCount: longTaskMonitor.longTaskCount,
    worstMs: longTaskMonitor.worstMs,
    records: longTaskMonitor.records,
    reset: () => longTaskMonitor.reset(),
  }
}

export function useBitmapCacheStats(): {
  bytesInUse: number
  limitBytes: number
  entryCount: number
  fill: number
  evictions: number
  hits: number
  misses: number
} {
  useStoreVersion(bitmapCache as unknown as BitmapCachePool & VersionedStore)
  return {
    bytesInUse: bitmapCache.bytesInUse,
    limitBytes: bitmapCache.limitBytes,
    entryCount: bitmapCache.entryCount,
    fill: bitmapCache.fill,
    evictions: bitmapCache.evictions,
    hits: bitmapCache.hits,
    misses: bitmapCache.misses,
  }
}

/** 订阅一组素材的加载阶段（预取编排/门槛演示用）。 */
export function useAssetPhases(refs: readonly string[]): {
  phases: Record<string, AssetLoadPhase>
  progress: { ready: number; total: number; failed: number }
} {
  useStoreVersion(preloadScheduler)
  const phases: Record<string, AssetLoadPhase> = {}
  for (const r of refs) phases[r] = preloadScheduler.getPhase(r)
  return { phases, progress: preloadScheduler.progress(refs) }
}

export { preloadScheduler, sceneReadinessGate, scheduler, longTaskMonitor, uploadQueue, bitmapCache }

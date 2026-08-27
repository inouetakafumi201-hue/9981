'use client'

/**
 * V0-11 — the shell's ONE adapter boundary for every side effect.
 *
 * Round 3 finding: the shell had exactly one network-shaped call
 * (`fetch` inside `lib/chroma-key.ts`) and it had no requestId, no timeout,
 * no cancel and no declared fallback. Everything else was either a bare
 * `<img>` / `new Image()` or the mock intent port. That is a half-wired
 * boundary, which is worse than an honest mock one.
 *
 * So this module defines three adapters and nothing else in the shell is
 * allowed to talk to the outside world:
 *
 *   ShellAssetAdapter      bytes / pixels (images, sprite sheets)
 *   ShellTransportAdapter  request-response with a host (today: mock intents)
 *   ShellStorageAdapter    shell-local demo state (today: in-memory only)
 *
 * Hard rules encoded here:
 *  - every request has a requestId, a timeout and a cancel path;
 *  - every failure resolves to a declared fallback, never to a hang;
 *  - none of these adapters interpret gameplay. They move bytes and echo
 *    structured results. Rules stay with the (absent) host.
 *
 * Extraction contract: replace the three `mock*` implementations. The
 * interfaces, the result unions and the `requestId` discipline stay.
 */

/* ------------------------------------------------------------------ */
/* shared                                                              */
/* ------------------------------------------------------------------ */

let requestCounter = 0

export function nextRequestId(prefix: string): string {
  requestCounter += 1
  return `${prefix}-${requestCounter.toString().padStart(4, '0')}-${Date.now().toString(36)}`
}

/** Every adapter result carries the same provenance envelope. */
export interface ShellAdapterEnvelope {
  requestId: string
  /** Always true while the shell has no host. Never faked to false. */
  mock: boolean
  /** Which adapter produced this, for the extraction report. */
  adapter: 'asset' | 'transport' | 'storage'
}

/* ------------------------------------------------------------------ */
/* 1. asset adapter                                                    */
/* ------------------------------------------------------------------ */

export type ShellAssetOutcome =
  /** Bytes decoded and usable. */
  | 'loaded'
  /** The manifest has no entry / the id is unknown. Not an error. */
  | 'missing'
  /** Request reached the source and failed (404, decode error). */
  | 'failed'
  /** Nothing came back inside the budget. */
  | 'timeout'
  /** The caller withdrew the request (unmount, page change). */
  | 'cancelled'

/**
 * What the consumer must show for a non-`loaded` outcome. There is no
 * "keep waiting" option: a resolved asset request always has a final
 * presentation state.
 */
export type ShellAssetFallback = 'static-fallback' | 'semantic-slot' | 'skip-to-final'

export interface ShellAssetResult extends ShellAdapterEnvelope {
  adapter: 'asset'
  assetId: string
  outcome: ShellAssetOutcome
  /** Only set when `outcome === 'loaded'`. */
  url?: string
  width?: number
  height?: number
  /** Declared before the request is made, so failure is never undefined. */
  fallback: ShellAssetFallback
  elapsedMs: number
  reasonCode?: string
}

export interface ShellAssetRequestOptions {
  timeoutMs?: number
  fallback?: ShellAssetFallback
  /** Caller-owned id so an unmounting component can cancel deterministically. */
  requestId?: string
}

export interface ShellAssetAdapter {
  resolve(assetId: string, options?: ShellAssetRequestOptions): Promise<ShellAssetResult>
  preload(assetIds: readonly string[], options?: ShellAssetRequestOptions): Promise<readonly ShellAssetResult[]>
  cancel(requestId: string): void
  /**
   * Raw byte access for pixel work (the chroma-key pass needs a decodable
   * source, not a URL). Same envelope discipline: id, timeout, cancel.
   */
  openBytes(assetId: string, options?: ShellAssetRequestOptions): Promise<ShellAssetBytes>
}

export interface ShellAssetBytes extends ShellAdapterEnvelope {
  adapter: 'asset'
  assetId: string
  outcome: ShellAssetOutcome
  blob?: Blob
  fallback: ShellAssetFallback
  elapsedMs: number
  reasonCode?: string
}

const DEFAULT_ASSET_TIMEOUT_MS = 6000

/** Global override so the control panel can force the failure branches. */
let forcedAssetOutcome: 'auto' | 'missing' | 'failed' | 'timeout' = 'auto'
export function setForcedAssetOutcome(next: typeof forcedAssetOutcome) {
  forcedAssetOutcome = next
}
export function getForcedAssetOutcome() {
  return forcedAssetOutcome
}

interface AssetCancelHandle {
  abort: AbortController | null
  settle: (result: ShellAssetOutcome) => void
}

const assetInflight = new Map<string, AssetCancelHandle>()

/** Number of asset requests currently open. Surfaced in the report panel. */
export function assetInflightCount() {
  return assetInflight.size
}

function assetEnvelope(
  requestId: string,
  assetId: string,
  outcome: ShellAssetOutcome,
  fallback: ShellAssetFallback,
  elapsedMs: number,
  extra: Partial<ShellAssetResult> = {},
): ShellAssetResult {
  return {
    adapter: 'asset',
    mock: true,
    requestId,
    assetId,
    outcome,
    fallback,
    elapsedMs,
    ...extra,
  }
}

/**
 * Browser-`Image`-lifecycle asset adapter. No `fetch` for the URL path:
 * an `<img>` decode is the cheapest correct way to know a raster asset is
 * usable, and it works under the same-origin `public/` layout the shell ships.
 * `openBytes` is the only place a `fetch` survives, and it is wrapped.
 */
export const mockAssetAdapter: ShellAssetAdapter = {
  async resolve(assetId, options = {}) {
    const requestId = options.requestId ?? nextRequestId('asset')
    const fallback = options.fallback ?? 'static-fallback'
    const timeoutMs = options.timeoutMs ?? DEFAULT_ASSET_TIMEOUT_MS
    const startedAt = Date.now()

    if (forcedAssetOutcome !== 'auto') {
      return assetEnvelope(requestId, assetId, forcedAssetOutcome, fallback, 0, {
        reasonCode: `MOCK_FORCED_${forcedAssetOutcome.toUpperCase()}`,
      })
    }
    if (typeof window === 'undefined') {
      return assetEnvelope(requestId, assetId, 'missing', fallback, 0, { reasonCode: 'MOCK_NO_DOM' })
    }

    return new Promise<ShellAssetResult>((resolve) => {
      let settled = false
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.decoding = 'async'

      const finish = (outcome: ShellAssetOutcome, reasonCode?: string) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        assetInflight.delete(requestId)
        image.onload = null
        image.onerror = null
        resolve(
          assetEnvelope(requestId, assetId, outcome, fallback, Date.now() - startedAt, {
            url: outcome === 'loaded' ? assetId : undefined,
            width: outcome === 'loaded' ? image.naturalWidth : undefined,
            height: outcome === 'loaded' ? image.naturalHeight : undefined,
            reasonCode,
          }),
        )
      }

      const timer = window.setTimeout(() => {
        image.src = ''
        finish('timeout', 'MOCK_ASSET_TIMEOUT')
      }, timeoutMs)

      assetInflight.set(requestId, { abort: null, settle: (outcome) => finish(outcome, 'MOCK_ASSET_CANCELLED') })

      image.onload = () => finish('loaded')
      image.onerror = () => finish('failed', 'MOCK_ASSET_DECODE_FAILED')
      image.src = assetId
    })
  },

  async preload(assetIds, options = {}) {
    // A batch is a group, not one cancellable request. Reusing an explicit
    // requestId here made later entries overwrite the first inflight handle.
    // Derive stable child ids so every decode can be cancelled and settled.
    const batchId = options.requestId ?? nextRequestId('preload')
    return Promise.all(
      assetIds.map((assetId, index) =>
        mockAssetAdapter.resolve(assetId, {
          ...options,
          requestId: `${batchId}-${String(index + 1).padStart(2, '0')}`,
        }),
      ),
    )
  },

  cancel(requestId) {
    const handle = assetInflight.get(requestId)
    if (!handle) return
    handle.abort?.abort()
    handle.settle('cancelled')
    assetInflight.delete(requestId)
  },

  async openBytes(assetId, options = {}) {
    const requestId = options.requestId ?? nextRequestId('bytes')
    const fallback = options.fallback ?? 'static-fallback'
    const timeoutMs = options.timeoutMs ?? DEFAULT_ASSET_TIMEOUT_MS
    const startedAt = Date.now()
    const base = { adapter: 'asset' as const, mock: true, requestId, assetId, fallback }

    if (forcedAssetOutcome !== 'auto') {
      return { ...base, outcome: forcedAssetOutcome, elapsedMs: 0, reasonCode: `MOCK_FORCED_${forcedAssetOutcome.toUpperCase()}` }
    }
    if (typeof window === 'undefined' || typeof fetch !== 'function') {
      return { ...base, outcome: 'missing', elapsedMs: 0, reasonCode: 'MOCK_NO_FETCH' }
    }

    const controller = new AbortController()
    let abortKind: 'timeout' | 'cancelled' | null = null
    assetInflight.set(requestId, {
      abort: controller,
      settle: () => {
        abortKind = 'cancelled'
        controller.abort('cancelled')
      },
    })
    const timer = window.setTimeout(() => {
      abortKind = 'timeout'
      controller.abort('timeout')
    }, timeoutMs)

    try {
      const response = await fetch(assetId, { cache: 'force-cache', signal: controller.signal })
      if (!response.ok) {
        return { ...base, outcome: 'failed', elapsedMs: Date.now() - startedAt, reasonCode: `MOCK_ASSET_HTTP_${response.status}` }
      }
      const blob = await response.blob()
      return { ...base, outcome: 'loaded', blob, elapsedMs: Date.now() - startedAt }
    } catch {
      const outcome: ShellAssetOutcome = abortKind ?? 'failed'
      return { ...base, outcome, elapsedMs: Date.now() - startedAt, reasonCode: `MOCK_ASSET_${outcome.toUpperCase()}` }
    } finally {
      window.clearTimeout(timer)
      assetInflight.delete(requestId)
    }
  },
}

/* ------------------------------------------------------------------ */
/* 2. transport adapter                                                */
/* ------------------------------------------------------------------ */

/**
 * The full result vocabulary a host reply can land on. `disconnected` and
 * `reconnecting` are link states, not gameplay verdicts — the UI shows the
 * blocking connection layer for those and never guesses the outcome.
 */
export type ShellTransportState =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'stale'
  | 'timeout'
  | 'cancelled'
  | 'disconnected'
  | 'reconnecting'
  /** Real 模式专用：已接受但 800ms 内表现层未更新 projection revision */
  | 'degraded'

export interface ShellRequest {
  requestId: string
  /** Namespaced verb; identical key space as `ShellIntentRequest.intentId`. */
  intentId: string
  source: string
  target: string
  parameters: Record<string, unknown>
  timeoutMs: number
  safeReturnTarget: string
  revision: number
}

export interface ShellTransportResult extends ShellAdapterEnvelope {
  adapter: 'transport'
  request: ShellRequest
  state: ShellTransportState
  reasonCode?: string
  message: string
  /**
   * Opaque host payload. The shell never reads gameplay meaning out of it;
   * pages consume declared projection fixtures instead.
   */
  payload?: Record<string, unknown>
  elapsedMs: number
}

export interface ShellTransportAdapter {
  request(request: ShellRequest): Promise<ShellTransportResult>
  cancel(requestId: string): void
}

const DEFAULT_TRANSPORT_TIMEOUT_MS = 8000

const transportInflight = new Map<string, () => void>()

export function transportInflightCount() {
  return transportInflight.size
}

const TRANSPORT_MESSAGES: Record<ShellTransportState, string> = {
  pending: '已提交，等待宿主确认。',
  accepted: '宿主已确认该请求。',
  rejected: '宿主拒绝了该请求，界面保持原状态。',
  stale: '本地版本已过期，请重试以取得新的投影版本。',
  timeout: '请求超时，没有收到投影确认。',
  cancelled: '请求已取消，没有产生任何变更。',
  disconnected: '连接已断开，请检查网络后重试。',
  reconnecting: '正在重连，请求已挂起。',
  degraded: '请求已被宿主接受，但表现层未在 800ms 内更新投影，界面已降级展示。',
}

let forcedTransportState: 'auto' | Exclude<ShellTransportState, 'pending' | 'reconnecting' | 'degraded'> = 'auto'
export function setForcedTransportState(next: typeof forcedTransportState) {
  forcedTransportState = next
}
export function getForcedTransportState() {
  return forcedTransportState
}

export function createShellRequest(
  intentId: string,
  options: {
    source: string
    target: string
    parameters?: Record<string, unknown>
    safeReturnTarget?: string
    timeoutMs?: number
    revision?: number
  },
): ShellRequest {
  return {
    requestId: nextRequestId('req'),
    intentId,
    source: options.source,
    target: options.target,
    parameters: options.parameters ?? {},
    timeoutMs: options.timeoutMs ?? DEFAULT_TRANSPORT_TIMEOUT_MS,
    safeReturnTarget: options.safeReturnTarget ?? options.source,
    revision: options.revision ?? 0,
  }
}

/**
 * Mock transport. Deliberately in-process: a half-real HTTP call with no host
 * on the other end would be a worse artefact than an honest mock that can
 * reproduce every terminal state on demand.
 */
export const mockTransportAdapter: ShellTransportAdapter = {
  async request(request) {
    const startedAt = Date.now()
    const perRequest = request.parameters.demoOutcome as Exclude<ShellTransportState, 'pending'> | undefined
    const state: ShellTransportState =
      perRequest ?? (forcedTransportState === 'auto' ? 'accepted' : forcedTransportState)

    let cancelled = false
    transportInflight.set(request.requestId, () => {
      cancelled = true
    })

    // A `timeout` demo must actually spend the wall-clock time, otherwise the
    // pending affordance and the cancel button are never exercised.
    const delay = state === 'timeout' ? Math.min(1200, request.timeoutMs) : 220
    await new Promise((resolve) => setTimeout(resolve, delay))
    transportInflight.delete(request.requestId)

    const finalState: ShellTransportState = cancelled ? 'cancelled' : state
    return {
      adapter: 'transport',
      mock: true,
      requestId: request.requestId,
      request,
      state: finalState,
      reasonCode: finalState === 'accepted' ? undefined : `MOCK_${finalState.toUpperCase()}`,
      message: TRANSPORT_MESSAGES[finalState],
      elapsedMs: Date.now() - startedAt,
    }
  },

  cancel(requestId) {
    transportInflight.get(requestId)?.()
    transportInflight.delete(requestId)
  },
}

/* ------------------------------------------------------------------ */
/* 3. storage adapter                                                  */
/* ------------------------------------------------------------------ */

/**
 * Storage classes, kept explicit so nothing drifts into being authoritative.
 * `real-persistence` is declared but intentionally unimplemented: the shell
 * has no right to own durable gameplay facts.
 */
export type ShellStorageClass = 'session-fixture' | 'temporary-draft' | 'mock-save' | 'real-persistence'

export const STORAGE_CLASS_LABELS: Record<ShellStorageClass, string> = {
  'session-fixture': '会话固定装置',
  'temporary-draft': '临时草稿',
  'mock-save': 'MOCK 存档',
  'real-persistence': '真实持久化（壳层不实现）',
}

export interface ShellStorageRecord<T = unknown> {
  key: string
  storageClass: Exclude<ShellStorageClass, 'real-persistence'>
  schemaVersion: number
  value: T
  updatedAt: number
}

export interface ShellStorageAdapter {
  read<T>(key: string): ShellStorageRecord<T> | null
  write<T>(key: string, value: T, storageClass: Exclude<ShellStorageClass, 'real-persistence'>): ShellStorageRecord<T> | null
  remove(key: string): void
  /** Wipes everything. The control panel exposes this as "reset demo". */
  clear(): void
  keys(): readonly string[]
  /** Turning storage off must never break a page; reads simply return null. */
  setEnabled(enabled: boolean): void
  isEnabled(): boolean
}

export const SHELL_STORAGE_SCHEMA_VERSION = 3

/**
 * Keys the shell must never persist, because persisting them would make the
 * presentation layer a source of gameplay truth across sessions. Writes to a
 * forbidden key are dropped and logged rather than silently accepted.
 */
const FORBIDDEN_KEY_FRAGMENTS = [
  'reward', 'quest.complete', 'battle.result', 'combat', 'damage', 'hp', 'sp', 'ap',
  'achievement', 'experience', 'entity.position', 'map.topology', 'victory', 'defeat',
]

function isForbiddenKey(key: string) {
  const lower = key.toLowerCase()
  return FORBIDDEN_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment))
}

/**
 * In-memory only. This is a deliberate choice, not an unfinished one:
 * `localStorage` would survive a reload and quietly become the most
 * authoritative thing in the build. When a host arrives it replaces this
 * object, and the forbidden-key guard moves to the host contract.
 */
function createMemoryStorageAdapter(): ShellStorageAdapter {
  const store = new Map<string, ShellStorageRecord>()
  let enabled = true

  return {
    read<T>(key: string) {
      if (!enabled) return null
      const record = store.get(key) as ShellStorageRecord<T> | undefined
      if (!record) return null
      // Version mismatch is a discard, never a migration guess.
      if (record.schemaVersion !== SHELL_STORAGE_SCHEMA_VERSION) {
        store.delete(key)
        return null
      }
      return record
    },
    write<T>(key: string, value: T, storageClass: Exclude<ShellStorageClass, 'real-persistence'>) {
      if (!enabled) return null
      if (isForbiddenKey(key)) {
        console.log('[v0] storage write refused — gameplay fact key:', key)
        return null
      }
      const record: ShellStorageRecord<T> = {
        key,
        storageClass,
        schemaVersion: SHELL_STORAGE_SCHEMA_VERSION,
        value,
        updatedAt: Date.now(),
      }
      store.set(key, record)
      return record
    },
    remove(key) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
    keys() {
      return [...store.keys()]
    },
    setEnabled(next) {
      enabled = next
      if (!next) store.clear()
    },
    isEnabled() {
      return enabled
    },
  }
}

export const mockStorageAdapter: ShellStorageAdapter = createMemoryStorageAdapter()

/* ------------------------------------------------------------------ */
/* adapter registry — the report reads this, not a grep               */
/* ------------------------------------------------------------------ */

export interface AdapterCallSite {
  /** File + symbol that performs the effect. */
  site: string
  adapter: 'asset' | 'transport' | 'storage'
  kind: 'image-decode' | 'byte-fetch' | 'request' | 'memory-store'
  hasTimeout: boolean
  hasCancel: boolean
  fallback: string
  replaceable: boolean
  /** True only if a real host would have to add a field/endpoint for this. */
  requiresNewHostContract: false
}

/**
 * Every side-effecting call site in the shell, enumerated. If a new `fetch`,
 * `new Image()` or storage call appears without a row here, the round-3
 * audit is stale — that is the point of keeping this as data.
 */
export const ADAPTER_CALL_SITES: readonly AdapterCallSite[] = [
  {
    site: 'lib/shell-adapters.ts · mockAssetAdapter.resolve (new Image)',
    adapter: 'asset', kind: 'image-decode', hasTimeout: true, hasCancel: true,
    fallback: 'static-fallback / semantic-slot（由调用方声明）', replaceable: true, requiresNewHostContract: false,
  },
  {
    site: 'lib/shell-adapters.ts · mockAssetAdapter.openBytes (fetch)',
    adapter: 'asset', kind: 'byte-fetch', hasTimeout: true, hasCancel: true,
    fallback: '返回 outcome=failed/timeout，调用方回落到原始 src', replaceable: true, requiresNewHostContract: false,
  },
  {
    site: 'lib/chroma-key.ts · decodeSource',
    adapter: 'asset', kind: 'byte-fetch', hasTimeout: true, hasCancel: true,
    fallback: 'openBytes 失败 → Image 生命周期 → 最终回落原始 src（不透明背板可见但不断链）',
    replaceable: true, requiresNewHostContract: false,
  },
  {
    site: 'lib/shell-intent.ts · submitShellIntent',
    adapter: 'transport', kind: 'request', hasTimeout: true, hasCancel: true,
    fallback: 'rejected/stale/timeout/cancelled 均为终态并保留 safeReturnTarget', replaceable: true, requiresNewHostContract: false,
  },
  {
    site: 'lib/shell-route.ts · useShellRouter (transition runner)',
    adapter: 'transport', kind: 'request', hasTimeout: true, hasCancel: true,
    fallback: '非 accepted 保持来源页面，并记录 fallbackPageId', replaceable: true, requiresNewHostContract: false,
  },
  {
    site: 'lib/shell-adapters.ts · mockStorageAdapter (in-memory Map)',
    adapter: 'storage', kind: 'memory-store', hasTimeout: false, hasCancel: false,
    fallback: '禁用或版本不符时 read 返回 null，页面走空投影而不是报错',
    replaceable: true, requiresNewHostContract: false,
  },
]

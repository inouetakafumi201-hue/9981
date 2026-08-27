/**
 * V0-06 — shell-local asset manifest.
 *
 * Every visual asset the shell references is registered here with an honest
 * status. A generic `placeholder.svg` is NOT a substitute: when an asset is
 * missing or fails, `AssetSlot` keeps the semantic position, labels it, and
 * shows a category-correct fallback plus a readable diagnostic.
 *
 * The shell never invents a substitute with different semantics (no "any
 * portrait will do"), and never reports a missing asset as available.
 */

export type AssetKind = 'portrait' | 'background' | 'sprite-sheet' | 'ui-frame' | 'text-prompt' | 'reference'

export type AssetStatus =
  /** File exists in this shell and is the intended art. */
  | 'available'
  /** Registered, intended, but not delivered yet. Renders a labelled fallback. */
  | 'pending'
  /** Delivered but only as provenance. Must not be used as product art. */
  | 'legacy-reference'
  /** Registered and expected, file absent. Renders a missing diagnostic. */
  | 'missing'

export interface AssetRecord {
  assetId: string
  label: string
  kind: AssetKind
  /** Catalog pageIds that mount this asset. */
  pageIds: string[]
  batchIds: string[]
  status: AssetStatus
  /** Was this handed straight to the AI pipeline rather than authored in-shell. */
  directToAi: boolean
  provenance: string
  /** Stable content marker. `null` while an asset is pending or missing. */
  checksum: string | null
  src: string | null
  /** What renders when this asset cannot be shown. Category-correct only. */
  fallback: { kind: AssetKind; label: string; note: string }
}

export const ASSET_MANIFEST: AssetRecord[] = [
  {
    assetId: 'A-201', label: 'HUD refined2 · 精修对局界面', kind: 'ui-frame',
    pageIds: ['hud-main'], batchIds: ['B2'], status: 'pending', directToAi: true,
    provenance: 'A-201 由外部精修流程产出，尚未交付壳层。',
    checksum: null, src: null,
    fallback: { kind: 'ui-frame', label: 'HUD 框架 · 语义槽位', note: 'A-201 未交付。当前显示的是结构化 UI 框架，不是成品精修图。' },
  },
  {
    assetId: 'A-202', label: 'HUD refined · 对局界面初修', kind: 'ui-frame',
    pageIds: ['hud-main'], batchIds: ['B2'], status: 'pending', directToAi: true,
    provenance: 'A-202 为 A-201 的前一轮精修，同样尚未交付壳层。',
    checksum: null, src: null,
    fallback: { kind: 'ui-frame', label: 'HUD 框架 · 初修槽位', note: 'A-202 未交付。槽位保留，不用其他素材冒充。' },
  },
  {
    assetId: 'A-203', label: 'HUD legacy 参考图', kind: 'reference',
    pageIds: ['hud-main'], batchIds: ['B2'], status: 'legacy-reference', directToAi: false,
    provenance: '早期 HUD 参考图，仅用于对照布局，禁止作为产品素材。',
    checksum: 'legacy-hud-ref-0001', src: '/games/hud/battlefield.png',
    fallback: { kind: 'reference', label: 'Legacy 参考不可用', note: '参考图不可用不影响产品页面；它从不参与正式渲染。' },
  },
  {
    assetId: 'A-301', label: '标题文字 · 图形化 prompt 产出', kind: 'text-prompt',
    pageIds: ['menu-title', 'location-title'], batchIds: ['B1', 'B5'], status: 'pending', directToAi: true,
    provenance: 'A-301 标题字形仍在 prompt 阶段，未产出可用图形。',
    checksum: null, src: null,
    fallback: { kind: 'text-prompt', label: '标题字形 · 文本回退', note: 'A-301 未产出。标题使用可读文本排版渲染，不宣称已完成字形素材。' },
  },
  {
    assetId: 'A-110', label: '驻地房间背景', kind: 'background',
    pageIds: ['residence-main'], batchIds: ['B1'], status: 'available', directToAi: false,
    provenance: '场景图经 hashi-dither-purifier 杂色纯化后处理（详见 docs/表现系统/06_场景图去AI化加固规范.md）。',
    checksum: 'residence-room-0001', src: '/games/residence/residence-room.png',
    fallback: { kind: 'background', label: '驻地背景缺失', note: '背景缺失时保留房间比例与交互热区，仅降级为纯色语义底。' },
  },
  {
    assetId: 'A-120', label: '侦探立绘序列帧', kind: 'sprite-sheet',
    pageIds: ['menu-title', 'dialog-line'], batchIds: ['B1', 'B5'], status: 'available', directToAi: false,
    provenance: '壳层内 16 帧序列，用于标题与对话立绘。',
    checksum: 'detective-f01-f16', src: '/games/menu/detective/f01.png',
    fallback: { kind: 'sprite-sheet', label: '立绘序列缺失', note: '序列缺失时退到单帧静态立绘，再退到具名语义槽位。' },
  },
  {
    assetId: 'A-130', label: '对话立绘 · 侦探', kind: 'portrait',
    pageIds: ['dialog-line', 'dialog-options'], batchIds: ['B5'], status: 'available', directToAi: false,
    provenance: '壳层内对话立绘。',
    checksum: 'portrait-detective-0001', src: '/games/menu/detective/portrait-detective.png',
    fallback: { kind: 'portrait', label: '立绘缺失', note: '立绘缺失时显示具名字形槽位，对话继续全宽显示，不用其他角色顶替。' },
  },
  {
    assetId: 'A-210', label: 'HUD 单位立绘组', kind: 'portrait',
    pageIds: ['hud-main'], batchIds: ['B2'], status: 'available', directToAi: false,
    provenance: '壳层内 HUD 单位立绘（玩家、教徒、野兽、地精）。',
    checksum: 'hud-portraits-0004', src: '/games/hud/portrait-player.png',
    fallback: { kind: 'portrait', label: '单位立绘缺失', note: '缺失时保留单位槽位、名称与数值，仅立绘降级，不隐藏单位。' },
  },
]

export function getAsset(assetId: string): AssetRecord | undefined {
  return ASSET_MANIFEST.find((asset) => asset.assetId === assetId)
}

export function assetsForPage(pageId: string): AssetRecord[] {
  return ASSET_MANIFEST.filter((asset) => asset.pageIds.includes(pageId))
}

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  available: '可用',
  pending: '待交付',
  'legacy-reference': '历史参考',
  missing: '缺失',
}

export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  portrait: '立绘', background: '背景', 'sprite-sheet': '序列帧',
  'ui-frame': 'UI 框架', 'text-prompt': '文字素材', reference: '参考图',
}

/** True only when the asset may be rendered as product art. */
export function isRenderable(asset: AssetRecord | undefined): boolean {
  return Boolean(asset && asset.status === 'available' && asset.src)
}

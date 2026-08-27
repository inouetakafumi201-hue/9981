export type DisplayCategory =
  | '装置' | '照明' | '陈设' | '交互' | '线索' | '遮挡'
  | '物品' | '武器' | '载具' | '生物' | '角色' | '机制' | '氛围' | '蓝本'

export type RuntimeEntityKind = 'item' | 'weapon' | 'vehicle' | 'npc' | 'character' | 'interactive' | 'environment'
export type ActorKind = 'player' | 'ai-player' | 'npc' | 'unbound'
export type TokenCategory = '属性' | '技能' | '状态' | '防御' | '机动'
export type MaterialSource = 'standard' | 'synthesized'

export interface AssetRef {
  readonly manifestId: string
  readonly entryId?: string
  readonly checksum?: { readonly algorithm: 'sha256'; readonly value: string }
  readonly view: 'world-top-down' | 'item-front' | 'icon' | 'portrait' | 'sprite-sheet'
}

export interface ActorBinding {
  readonly kind: ActorKind
  readonly controllerRef?: string
}

export interface RuntimeEntityRef {
  readonly kind: RuntimeEntityKind
  readonly id: string
}

export interface MaterialIdentity {
  readonly id: string
  readonly name: string
  readonly introduction: string
  readonly description?: string
  readonly iconAssetRef?: AssetRef
  readonly textureAssetRef: AssetRef
  readonly quality: 1 | 2 | 3 | 4 | 5
  readonly displayCategory: DisplayCategory
  readonly runtimeEntityRef?: RuntimeEntityRef
  readonly actorBinding?: ActorBinding
}

export interface MaterialMeta {
  readonly owned: boolean
  readonly source: MaterialSource
  readonly quality: 1 | 2 | 3 | 4 | 5
  readonly starred: boolean
  readonly modified: boolean
  readonly isUgcNew: boolean
  readonly equippedTokens: readonly (string | null)[]
  readonly weakness: string | null
  readonly limitedFree: boolean
}

export interface MaterialRecord extends MaterialIdentity {
  readonly meta: MaterialMeta
}

export interface TokenMeta {
  readonly id: string
  readonly name: string
  readonly category: TokenCategory
  readonly owned: boolean
  readonly quality: 1 | 2 | 3 | 4 | 5
  readonly starred: boolean
  readonly collectedAt: number | null
}

export interface BlueprintMeta {
  readonly id: string
  readonly mapBundleId: string
  readonly familiarity: number
  readonly unlocked: boolean
  readonly derivedFrom?: string
}

export interface QuickBar {
  readonly materialSlots: readonly (string | null)[]
}

export interface MoldingBar {
  readonly unlocked: readonly boolean[]
  readonly contents: readonly (string | null)[]
}

export interface SynthesisJob {
  readonly id: string
  readonly base: string
  readonly tokens: readonly string[]
  readonly status: 'queue' | 'running' | 'done' | 'failed' | 'claimed'
  readonly resultMaterialId?: string
  readonly failureReason?: string
}

export interface MetaState {
  readonly identities: Readonly<Record<string, MaterialIdentity>>
  readonly materials: Readonly<Record<string, MaterialMeta>>
  readonly tokens: Readonly<Record<string, TokenMeta>>
  readonly blueprints: Readonly<Record<string, BlueprintMeta>>
  readonly quickBar: QuickBar
  readonly moldingBar: MoldingBar
  readonly synthesisQueue: readonly SynthesisJob[]
}

export interface MetaStateProjection extends MetaState {
  readonly revision: number
  readonly authority: 'meta-state' | 'demo-fixture' | 'pending-convergence'
}

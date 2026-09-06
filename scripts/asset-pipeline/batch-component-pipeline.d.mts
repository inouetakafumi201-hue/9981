export type ComponentCategory = 'ai-unit' | 'npc' | 'vehicle' | 'container' | 'item' | 'device' | 'decoration' | 'transition-scene'

export interface BatchEntry {
  readonly name: string
  readonly type: ComponentCategory
  readonly desc: string
  readonly states?: readonly string[]
  readonly context?: 'map' | 'ui'
  readonly cell?: number
  readonly colors?: number
}

export interface BatchRegistry {
  readonly kind: 'wakeup-batch-manifest'
  readonly version: 3
  readonly defaults: { readonly context: string; readonly cell: number; readonly colors: number }
  readonly entries: readonly BatchEntry[]
}

export interface ComponentManifest {
  readonly name: string
  readonly type: ComponentCategory
  readonly runtimeBinding: { readonly selectableInEditor: boolean }
}

export const COMPONENT_CATEGORIES: readonly ComponentCategory[]
export const CATEGORY_SPECS: Readonly<Record<ComponentCategory, { readonly context: string; readonly perspective: 'axonometric' | 'front'; readonly defaultStates: readonly string[] }>>
export function validateBatchRegistry(data: unknown): { readonly ok: boolean; readonly errors: readonly string[] }
export function generateSampleRegistry(): BatchRegistry
export function buildComponentsManifest(registryPath?: string, outDir?: string): { readonly kind: 'wakeup-component-catalog'; readonly version: 3; readonly count: number; readonly components: readonly ComponentManifest[] }

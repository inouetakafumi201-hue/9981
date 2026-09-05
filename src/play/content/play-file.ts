import type { ContentKind } from './content-manifest'

export interface ContentReference {
  readonly contentId: string
  readonly versionRange: string
  readonly kind: ContentKind
}

export interface MapBinding {
  readonly mapBundleId: string
  readonly entryNodeId: string
  readonly returnNodeId?: string
}

export interface PlayPhaseBinding {
  readonly phaseId: string
  readonly triggerIds: readonly string[]
}

export interface PlayTrigger {
  readonly triggerId: string
  readonly event: string
  readonly nodeId?: string
  readonly edgeId?: string
  readonly conditionRef?: string
  readonly actionRefs: readonly string[]
  readonly presentationIds?: readonly string[]
}

export interface PlayFile {
  readonly schemaVersion: '1.0'
  readonly playFileId: string
  readonly requires: readonly ContentReference[]
  readonly mapBinding?: MapBinding
  readonly scheduleId: string
  readonly phaseBindings: readonly PlayPhaseBinding[]
  readonly triggers: readonly PlayTrigger[]
  readonly presentations: readonly { readonly presentationId: string; readonly semanticId: string }[]
  readonly outcomes: readonly { readonly outcomeId: string; readonly ruleRef: string }[]
  readonly lifecycle: readonly { readonly event: string; readonly actionRef: string }[]
}

export interface MapBundle {
  readonly manifestEntryId: string
  readonly mapDataEntryId: string
  readonly visualAssetEntryIds: readonly string[]
  readonly mapPlayEntryId: string
  readonly entryNodeId?: string
}

export interface MapBoundPlaypack {
  readonly manifestEntryId: string
  readonly playFileEntryIds: readonly string[]
  readonly mapBundleEntryIds: readonly string[]
  readonly visualOverrideEntryIds: readonly string[]
}

export type PlayFileDiagnosticCode = 'INVALID_PLAY_FILE' | 'DUPLICATE_TRIGGER' | 'UNRESOLVED_REFERENCE' | 'DIRECT_RULE_WRITE'
export interface PlayFileDiagnostic { readonly code: PlayFileDiagnosticCode; readonly message: string; readonly reference?: string }

export function validatePlayFile(playFile: PlayFile): readonly PlayFileDiagnostic[] {
  const diagnostics: PlayFileDiagnostic[] = []
  if (playFile.schemaVersion !== '1.0' || !playFile.playFileId || !playFile.scheduleId) {
    diagnostics.push({ code: 'INVALID_PLAY_FILE', message: '玩法文件缺少 schemaVersion、playFileId 或 scheduleId。' })
  }
  const triggerIds = new Set<string>()
  for (const trigger of playFile.triggers) {
    if (triggerIds.has(trigger.triggerId)) diagnostics.push({ code: 'DUPLICATE_TRIGGER', reference: trigger.triggerId, message: `重复触发器：${trigger.triggerId}` })
    triggerIds.add(trigger.triggerId)
    if (trigger.actionRefs.some((ref) => ref.startsWith('world.') || ref.startsWith('state.'))) {
      diagnostics.push({ code: 'DIRECT_RULE_WRITE', reference: trigger.triggerId, message: '玩法文件只能引用动作端口，不能直接写 WorldState。' })
    }
  }
  const phaseIds = new Set(playFile.phaseBindings.map((phase) => phase.phaseId))
  for (const trigger of playFile.triggers) {
    if (trigger.conditionRef && !phaseIds.has(trigger.conditionRef) && !playFile.requires.some((ref) => ref.contentId === trigger.conditionRef)) {
      diagnostics.push({ code: 'UNRESOLVED_REFERENCE', reference: trigger.conditionRef, message: `未解析的条件引用：${trigger.conditionRef}` })
    }
  }
  return Object.freeze(diagnostics)
}

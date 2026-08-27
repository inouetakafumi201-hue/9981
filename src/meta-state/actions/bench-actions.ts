import type { MetaStateStore } from '../store'
import { rejected, type MetaActionResult } from './result'

function check(store: MetaStateStore, revision: number): MetaActionResult | null {
  const projection = store.getState()
  return projection.revision === revision ? null : { kind: 'stale', code: 'STALE_PROJECTION', message: '研究台投影已更新，请重试。', projection }
}

export function extractToken(store: MetaStateStore, materialId: string, focusAttr: string, revision: number): MetaActionResult {
  const stale = check(store, revision)
  if (stale) return stale
  const projection = store.getState()
  if (!projection.materials[materialId]) return rejected(projection, 'MATERIAL_NOT_FOUND', `未知素材：${materialId}`)
  if (!focusAttr.trim()) return rejected(projection, 'EXTRACT_FOCUS_REQUIRED', '提取词条必须提供焦点分类。')
  return { kind: 'pending', code: 'PENDING_CONVERGENCE', message: '提取白名单尚未汇合。', projection }
}

export function forgeModify(store: MetaStateStore, materialId: string, tokenIds: readonly string[], mode: 'save' | 'derive', revision: number): MetaActionResult {
  const stale = check(store, revision)
  if (stale) return stale
  const projection = store.getState()
  const material = projection.materials[materialId]
  if (!material) return rejected(projection, 'MATERIAL_NOT_FOUND', `未知素材：${materialId}`)
  if (!material.owned || material.limitedFree) return rejected(projection, 'MATERIAL_NOT_AVAILABLE', '当前素材不能进入研究台。')
  if (tokenIds.length > 5 || tokenIds.some((id) => !projection.tokens[id]?.owned)) return rejected(projection, 'TOKEN_NOT_AVAILABLE', '存在未拥有或超过槽位上限的词条。')
  if (mode === 'derive') return { kind: 'pending', code: 'PENDING_CONVERGENCE', message: '派生结果由玩法 owner 提供。', projection }
  const materials = { ...projection.materials, [materialId]: { ...material, modified: true, equippedTokens: [...tokenIds] } }
  const next = store.commit({ ...projection, materials }, projection.authority)
  return { kind: 'accepted', committedRevision: next.revision, projection: next }
}

export function synthesizeSubmit(store: MetaStateStore, base: string, tokens: readonly string[], jobId: string, revision: number): MetaActionResult {
  const stale = check(store, revision)
  if (stale) return stale
  const projection = store.getState()
  if (!projection.materials[base]) return rejected(projection, 'MATERIAL_NOT_FOUND', `未知基体：${base}`)
  if (tokens.length === 0 || tokens.some((id) => !projection.tokens[id]?.owned)) return rejected(projection, 'TOKEN_NOT_AVAILABLE', '合成词条不可用。')
  const synthesisQueue = [...projection.synthesisQueue, { id: jobId, base, tokens: [...tokens], status: 'queue' as const }]
  const next = store.commit({ ...projection, synthesisQueue }, projection.authority)
  return { kind: 'accepted', committedRevision: next.revision, projection: next }
}

export function synthesizeClaim(store: MetaStateStore, jobId: string, resultMaterialId: string, revision: number): MetaActionResult {
  const stale = check(store, revision)
  if (stale) return stale
  const projection = store.getState()
  const job = projection.synthesisQueue.find((item) => item.id === jobId)
  if (!job) return rejected(projection, 'JOB_NOT_FOUND', `未知合成任务：${jobId}`)
  if (job.status !== 'done') return rejected(projection, 'JOB_NOT_DONE', '合成任务尚未完成。')
  if (!resultMaterialId.trim()) return rejected(projection, 'RESULT_ID_REQUIRED', '成品必须提供独立 resultMaterialId。')
  const synthesisQueue = projection.synthesisQueue.map((item) => item.id === jobId ? { ...item, status: 'claimed' as const, resultMaterialId } : item)
  const next = store.commit({ ...projection, synthesisQueue }, projection.authority)
  return { kind: 'accepted', committedRevision: next.revision, projection: next }
}

export function moldingSet(store: MetaStateStore, slot: number, materialId: string, revision: number): MetaActionResult {
  const stale = check(store, revision)
  if (stale) return stale
  const projection = store.getState()
  if (!projection.materials[materialId]?.owned) return rejected(projection, 'MATERIAL_NOT_AVAILABLE', '塑形栏只能使用已拥有素材。')
  if (!projection.moldingBar.unlocked[slot]) return rejected(projection, 'MOLDING_SLOT_LOCKED', '塑形槽位尚未解锁。')
  if (slot < 0 || slot >= projection.moldingBar.contents.length) return rejected(projection, 'MOLDING_SLOT_INVALID', '塑形槽位无效。')
  const contents = [...projection.moldingBar.contents]
  contents[slot] = materialId
  const next = store.commit({ ...projection, moldingBar: { ...projection.moldingBar, contents } }, projection.authority)
  return { kind: 'accepted', committedRevision: next.revision, projection: next }
}

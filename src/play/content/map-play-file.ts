import type { JsonValue } from '../../core/kernel/spec-compiler/types'
import type { MapDataDocument } from '../map/types'

export const MAP_PLAY_SCHEMA_VERSION = '2.0' as const
export const MAP_PLAY_KIND = 'map-play' as const

export type MapPlayStateKind = 'flag' | 'counter' | 'timer' | 'objective'
export type MapPlayStateLifecycle = 'map' | 'visit' | 'phase'
export type MapPlayTargetKind = 'node' | 'edge' | 'placement' | 'layer' | 'portal'
export type MapPlayEventDomain =
  | 'map.load' | 'map.enter' | 'map.ready' | 'map.pause' | 'map.resume' | 'map.exit' | 'map.unload'
  | 'node.enter' | 'node.leave' | 'edge.traverse' | 'mechanic.event' | 'outcome'

export interface MapPlayCapabilities {
  readonly rules: readonly string[]
  readonly conditions: readonly string[]
  readonly actions: readonly string[]
  readonly states: readonly string[]
  readonly outcomes: readonly string[]
  readonly presentations: readonly string[]
}

export interface MapPlayLocalState {
  readonly id: string
  readonly kind: MapPlayStateKind
  readonly initial: JsonValue
  readonly lifecycle: MapPlayStateLifecycle
  readonly stateRef: string
  readonly numericOwnerRef?: string
}

export interface MapPlayTarget { readonly kind: MapPlayTargetKind; readonly id: string }
export interface MapPlayConditionCall { readonly conditionRef: string; readonly args: Readonly<Record<string, JsonValue>> }
export interface MapPlayActionCall { readonly actionRef: string; readonly args: Readonly<Record<string, JsonValue>> }

export interface MapPlayRule {
  readonly id: string
  readonly ruleRef: string
  readonly event: MapPlayEventDomain
  readonly eventName?: string
  readonly targets: readonly MapPlayTarget[]
  readonly conditions: readonly MapPlayConditionCall[]
  readonly actions: readonly MapPlayActionCall[]
  readonly timelineIds: readonly string[]
}

export interface MapPlayCue {
  readonly id: string
  readonly presentationRef: string
  readonly afterCueId?: string
  readonly delayMs: number
  readonly blocking: boolean
  readonly critical: boolean
  readonly fallbackPresentationRef?: string
}

export interface MapPlayTimeline {
  readonly id: string
  readonly skippable: boolean
  readonly cancelEvents: readonly MapPlayEventDomain[]
  readonly fallbackPresentationRef?: string
  readonly staticFinalState: string
  readonly cues: readonly MapPlayCue[]
}

export interface MapPlayOutcome {
  readonly id: string
  readonly outcomeRef: string
  readonly actionRef: string
  readonly behavior: 'terminate' | 'transition' | 'return'
  readonly timelineId?: string
}

export interface MapPlayFileV2 {
  readonly schemaVersion: '2.0'
  readonly kind: 'map-play'
  readonly mapPlayId: string
  readonly mapId: string
  readonly mapDataEntryId: string
  readonly entryNodeId: string
  readonly capabilities: MapPlayCapabilities
  readonly localState: readonly MapPlayLocalState[]
  readonly rules: readonly MapPlayRule[]
  readonly timelines: readonly MapPlayTimeline[]
  readonly outcomes: readonly MapPlayOutcome[]
}

export interface MapPlayProgram extends MapPlayFileV2 { readonly compiled: true }

export type MapPlayDiagnosticCode =
  | 'MAP_PLAY_INVALID_SHAPE' | 'MAP_PLAY_UNKNOWN_FIELD' | 'MAP_PLAY_DUPLICATE_ID'
  | 'MAP_PLAY_MAP_MISMATCH' | 'MAP_PLAY_UNRESOLVED_CAPABILITY' | 'MAP_PLAY_UNRESOLVED_MAP_ELEMENT'
  | 'MAP_PLAY_FORBIDDEN_SPATIAL_OVERRIDE' | 'MAP_PLAY_DIRECT_STATE_WRITE' | 'MAP_PLAY_INVALID_EVENT'
  | 'MAP_PLAY_DANGLING_TIMELINE' | 'MAP_PLAY_TIMELINE_CYCLE' | 'MAP_PLAY_MISSING_FINAL_STATE'
  | 'MAP_PLAY_CRITICAL_PRESENTATION_NO_FALLBACK' | 'MAP_PLAY_NUMERIC_OWNER_REQUIRED'

export interface MapPlayDiagnostic {
  readonly code: MapPlayDiagnosticCode
  readonly path: string
  readonly message: string
  readonly correction: string
}

export interface MapPlayValidationContext {
  readonly map: MapDataDocument
  readonly mapDataEntryId: string
  readonly registered?: Partial<{ [K in keyof MapPlayCapabilities]: ReadonlySet<string> }>
}

export type MapPlayParseResult =
  | { readonly ok: true; readonly value: MapPlayFileV2 }
  | { readonly ok: false; readonly diagnostics: readonly MapPlayDiagnostic[] }
export type MapPlayCompileResult =
  | { readonly ok: true; readonly program: MapPlayProgram }
  | { readonly ok: false; readonly diagnostics: readonly MapPlayDiagnostic[] }

const ROOT_FIELDS = ['schemaVersion', 'kind', 'mapPlayId', 'mapId', 'mapDataEntryId', 'entryNodeId', 'capabilities', 'localState', 'rules', 'timelines', 'outcomes'] as const
const CAPABILITY_FIELDS = ['rules', 'conditions', 'actions', 'states', 'outcomes', 'presentations'] as const
const STATE_FIELDS = ['id', 'kind', 'initial', 'lifecycle', 'stateRef', 'numericOwnerRef'] as const
const RULE_FIELDS = ['id', 'ruleRef', 'event', 'eventName', 'targets', 'conditions', 'actions', 'timelineIds'] as const
const TARGET_FIELDS = ['kind', 'id'] as const
const CONDITION_FIELDS = ['conditionRef', 'args'] as const
const ACTION_FIELDS = ['actionRef', 'args'] as const
const TIMELINE_FIELDS = ['id', 'skippable', 'cancelEvents', 'fallbackPresentationRef', 'staticFinalState', 'cues'] as const
const CUE_FIELDS = ['id', 'presentationRef', 'afterCueId', 'delayMs', 'blocking', 'critical', 'fallbackPresentationRef'] as const
const OUTCOME_FIELDS = ['id', 'outcomeRef', 'actionRef', 'behavior', 'timelineId'] as const
const EVENT_DOMAINS = new Set<MapPlayEventDomain>(['map.load', 'map.enter', 'map.ready', 'map.pause', 'map.resume', 'map.exit', 'map.unload', 'node.enter', 'node.leave', 'edge.traverse', 'mechanic.event', 'outcome'])
const SPATIAL_FIELDS = new Set(['at', 'x', 'y', 'path', 'points', 'svg', 'topology', 'overrides', 'layerId'])

export function parseMapPlayFile(input: unknown): MapPlayParseResult {
  const diagnostics: MapPlayDiagnostic[] = []
  if (!isRecord(input)) return failed(diagnostics, 'MAP_PLAY_INVALID_SHAPE', '/', '地图玩法文件必须是 JSON 对象。', '提供一个完整的 MapPlay 2.0 JSON 对象。')
  rejectUnknown(input, ROOT_FIELDS, '/', diagnostics)
  if (input.schemaVersion !== MAP_PLAY_SCHEMA_VERSION || input.kind !== MAP_PLAY_KIND) invalid(diagnostics, '/', '必须声明 schemaVersion="2.0" 与 kind="map-play"。')
  for (const key of ['mapPlayId', 'mapId', 'mapDataEntryId', 'entryNodeId'] as const) requireId(input[key], `/${key}`, diagnostics)
  const capabilities = parseCapabilities(input.capabilities, diagnostics)
  const localState = parseArray(input.localState, '/localState', diagnostics, parseState)
  const rules = parseArray(input.rules, '/rules', diagnostics, parseRule)
  const timelines = parseArray(input.timelines, '/timelines', diagnostics, parseTimeline)
  const outcomes = parseArray(input.outcomes, '/outcomes', diagnostics, parseOutcome)
  if (diagnostics.length > 0 || capabilities === null) return { ok: false, diagnostics: freeze(diagnostics) }
  const value: MapPlayFileV2 = {
    schemaVersion: '2.0', kind: 'map-play', mapPlayId: input.mapPlayId as string, mapId: input.mapId as string,
    mapDataEntryId: input.mapDataEntryId as string, entryNodeId: input.entryNodeId as string,
    capabilities, localState, rules, timelines, outcomes,
  }
  return { ok: true, value: freeze(value) }
}

export function validateMapPlayFile(file: MapPlayFileV2, context?: MapPlayValidationContext): readonly MapPlayDiagnostic[] {
  const diagnostics: MapPlayDiagnostic[] = []
  unique(file.localState, '/localState', diagnostics)
  unique(file.rules, '/rules', diagnostics)
  unique(file.timelines, '/timelines', diagnostics)
  unique(file.outcomes, '/outcomes', diagnostics)
  for (const [key, refs] of Object.entries(file.capabilities) as [keyof MapPlayCapabilities, readonly string[]][]) {
    duplicateStrings(refs, `/capabilities/${key}`, diagnostics)
    const registry = context?.registered?.[key]
    if (registry) for (const ref of refs) if (!registry.has(ref)) unresolved(diagnostics, `/capabilities/${key}`, ref)
  }
  const declared = Object.fromEntries(CAPABILITY_FIELDS.map((key) => [key, new Set(file.capabilities[key])])) as { [K in keyof MapPlayCapabilities]: Set<string> }
  const timelineIds = new Set(file.timelines.map((item) => item.id))
  const mapIds = context ? collectMapIds(context.map) : undefined
  if (context && (file.mapId !== context.map.id || file.mapDataEntryId !== context.mapDataEntryId)) diagnostics.push(diag('MAP_PLAY_MAP_MISMATCH', '/', 'MapPlay 与 MapData 身份不一致。', '使 mapId 和 mapDataEntryId 精确指向当前地图。'))
  if (mapIds && !mapIds.node.has(file.entryNodeId)) mapElement(diagnostics, '/entryNodeId', file.entryNodeId)
  for (const [index, state] of file.localState.entries()) {
    if (!declared.states.has(state.stateRef)) unresolved(diagnostics, `/localState/${index}/stateRef`, state.stateRef)
    if ((state.kind === 'counter' || state.kind === 'timer') && !state.numericOwnerRef) diagnostics.push(diag('MAP_PLAY_NUMERIC_OWNER_REQUIRED', `/localState/${index}`, '计数器和计时器必须声明数值归属。', '填写 numericOwnerRef，接入设计货币审计。'))
  }
  for (const [index, rule] of file.rules.entries()) {
    if (!EVENT_DOMAINS.has(rule.event)) diagnostics.push(diag('MAP_PLAY_INVALID_EVENT', `/rules/${index}/event`, '事件不属于 MapPlay 生命周期域。', '使用规范列出的生命周期事件。'))
    if (!declared.rules.has(rule.ruleRef)) unresolved(diagnostics, `/rules/${index}/ruleRef`, rule.ruleRef)
    for (const call of rule.conditions) if (!declared.conditions.has(call.conditionRef)) unresolved(diagnostics, `/rules/${index}/conditions`, call.conditionRef)
    for (const call of rule.actions) {
      if (call.actionRef.startsWith('world.') || call.actionRef.startsWith('state.')) diagnostics.push(diag('MAP_PLAY_DIRECT_STATE_WRITE', `/rules/${index}/actions`, '禁止直接写 WorldState。', '改为调用已登记动作端口。'))
      if (!declared.actions.has(call.actionRef)) unresolved(diagnostics, `/rules/${index}/actions`, call.actionRef)
    }
    for (const id of rule.timelineIds) if (!timelineIds.has(id)) dangling(diagnostics, `/rules/${index}/timelineIds`, id)
    if (mapIds) for (const target of rule.targets) if (!mapIds[target.kind].has(target.id)) mapElement(diagnostics, `/rules/${index}/targets`, target.id)
  }
  for (const [index, timeline] of file.timelines.entries()) validateTimeline(timeline, index, declared.presentations, diagnostics)
  for (const [index, outcome] of file.outcomes.entries()) {
    if (!declared.outcomes.has(outcome.outcomeRef)) unresolved(diagnostics, `/outcomes/${index}/outcomeRef`, outcome.outcomeRef)
    if (!declared.actions.has(outcome.actionRef)) unresolved(diagnostics, `/outcomes/${index}/actionRef`, outcome.actionRef)
    if (outcome.timelineId && !timelineIds.has(outcome.timelineId)) dangling(diagnostics, `/outcomes/${index}/timelineId`, outcome.timelineId)
  }
  scanForbidden(file, '/', diagnostics)
  return freeze(diagnostics)
}

export function compileMapPlayProgram(file: MapPlayFileV2, context: MapPlayValidationContext): MapPlayCompileResult {
  const diagnostics = validateMapPlayFile(file, context)
  if (diagnostics.length > 0) return { ok: false, diagnostics }
  return { ok: true, program: freeze({ ...file, compiled: true as const }) }
}

function parseCapabilities(value: unknown, diagnostics: MapPlayDiagnostic[]): MapPlayCapabilities | null {
  if (!isRecord(value)) { invalid(diagnostics, '/capabilities', 'capabilities 必须是对象。'); return null }
  rejectUnknown(value, CAPABILITY_FIELDS, '/capabilities', diagnostics)
  return Object.fromEntries(CAPABILITY_FIELDS.map((key) => [key, stringArray(value[key], `/capabilities/${key}`, diagnostics)])) as unknown as MapPlayCapabilities
}
function parseState(value: unknown, path: string, d: MapPlayDiagnostic[]): MapPlayLocalState | null {
  if (!isRecord(value)) return invalidNull(d, path, '局部状态必须是对象。')
  rejectUnknown(value, STATE_FIELDS, path, d); requireId(value.id, `${path}/id`, d); requireId(value.stateRef, `${path}/stateRef`, d)
  if (!['flag', 'counter', 'timer', 'objective'].includes(String(value.kind)) || !['map', 'visit', 'phase'].includes(String(value.lifecycle)) || !isJson(value.initial)) return invalidNull(d, path, '局部状态字段无效。')
  if (value.kind === 'flag' && typeof value.initial !== 'boolean') return invalidNull(d, `${path}/initial`, 'flag 初值必须是 boolean。')
  if ((value.kind === 'counter' || value.kind === 'timer') && (typeof value.initial !== 'number' || value.initial < 0)) return invalidNull(d, `${path}/initial`, 'counter/timer 初值必须是非负有限数。')
  return value as unknown as MapPlayLocalState
}
function parseRule(value: unknown, path: string, d: MapPlayDiagnostic[]): MapPlayRule | null {
  if (!isRecord(value)) return invalidNull(d, path, '规则必须是对象。')
  rejectUnknown(value, RULE_FIELDS, path, d); requireId(value.id, `${path}/id`, d); requireId(value.ruleRef, `${path}/ruleRef`, d)
  const targets = parseArray(value.targets, `${path}/targets`, d, parseTarget); const conditions = parseArray(value.conditions, `${path}/conditions`, d, parseCondition); const actions = parseArray(value.actions, `${path}/actions`, d, parseAction); const timelineIds = stringArray(value.timelineIds, `${path}/timelineIds`, d)
  if (!EVENT_DOMAINS.has(value.event as MapPlayEventDomain)) invalid(d, `${path}/event`, '事件域无效。')
  if (value.event === 'mechanic.event' && (typeof value.eventName !== 'string' || !value.eventName.trim())) invalid(d, `${path}/eventName`, 'mechanic.event 必须声明非空 eventName。')
  if (value.event !== 'mechanic.event' && value.eventName !== undefined) invalid(d, `${path}/eventName`, 'eventName 只允许用于 mechanic.event。')
  return { id: value.id as string, ruleRef: value.ruleRef as string, event: value.event as MapPlayEventDomain, ...(typeof value.eventName === 'string' ? { eventName: value.eventName } : {}), targets, conditions, actions, timelineIds }
}
function parseTarget(v: unknown, p: string, d: MapPlayDiagnostic[]): MapPlayTarget | null { if (!isRecord(v)) return invalidNull(d,p,'目标必须是对象。'); rejectUnknown(v,TARGET_FIELDS,p,d); requireId(v.id,`${p}/id`,d); if (!['node','edge','placement','layer','portal'].includes(String(v.kind))) invalid(d,`${p}/kind`,'目标类型无效。'); return v as unknown as MapPlayTarget }
function parseCondition(v: unknown,p:string,d:MapPlayDiagnostic[]):MapPlayConditionCall|null { if(!isRecord(v))return invalidNull(d,p,'条件调用必须是对象。');rejectUnknown(v,CONDITION_FIELDS,p,d);requireId(v.conditionRef,`${p}/conditionRef`,d);if(!isRecord(v.args)||!isJson(v.args))invalid(d,`${p}/args`,'args 必须是 JSON 对象。');return v as unknown as MapPlayConditionCall }
function parseAction(v: unknown,p:string,d:MapPlayDiagnostic[]):MapPlayActionCall|null { if(!isRecord(v))return invalidNull(d,p,'动作调用必须是对象。');rejectUnknown(v,ACTION_FIELDS,p,d);requireId(v.actionRef,`${p}/actionRef`,d);if(!isRecord(v.args)||!isJson(v.args))invalid(d,`${p}/args`,'args 必须是 JSON 对象。');return v as unknown as MapPlayActionCall }
function parseTimeline(v: unknown,p:string,d:MapPlayDiagnostic[]):MapPlayTimeline|null { if(!isRecord(v))return invalidNull(d,p,'时间线必须是对象。');rejectUnknown(v,TIMELINE_FIELDS,p,d);requireId(v.id,`${p}/id`,d);if(typeof v.skippable!=='boolean'||typeof v.staticFinalState!=='string')invalid(d,p,'时间线字段无效。');return { id:v.id as string,skippable:v.skippable as boolean,cancelEvents:stringArray(v.cancelEvents,`${p}/cancelEvents`,d) as MapPlayEventDomain[],...(typeof v.fallbackPresentationRef==='string'?{fallbackPresentationRef:v.fallbackPresentationRef}:{}),staticFinalState:v.staticFinalState as string,cues:parseArray(v.cues,`${p}/cues`,d,parseCue) } }
function parseCue(v:unknown,p:string,d:MapPlayDiagnostic[]):MapPlayCue|null { if(!isRecord(v))return invalidNull(d,p,'cue 必须是对象。');rejectUnknown(v,CUE_FIELDS,p,d);requireId(v.id,`${p}/id`,d);requireId(v.presentationRef,`${p}/presentationRef`,d);if(typeof v.delayMs!=='number'||v.delayMs<0||typeof v.blocking!=='boolean'||typeof v.critical!=='boolean')invalid(d,p,'cue 字段无效。');return v as unknown as MapPlayCue }
function parseOutcome(v:unknown,p:string,d:MapPlayDiagnostic[]):MapPlayOutcome|null { if(!isRecord(v))return invalidNull(d,p,'outcome 必须是对象。');rejectUnknown(v,OUTCOME_FIELDS,p,d);for(const k of ['id','outcomeRef','actionRef'] as const)requireId(v[k],`${p}/${k}`,d);if(!['terminate','transition','return'].includes(String(v.behavior)))invalid(d,`${p}/behavior`,'behavior 无效。');return v as unknown as MapPlayOutcome }

function validateTimeline(t:MapPlayTimeline,index:number,presentations:Set<string>,d:MapPlayDiagnostic[]):void { const p=`/timelines/${index}`;unique(t.cues,`${p}/cues`,d);if(!t.staticFinalState.trim())d.push(diag('MAP_PLAY_MISSING_FINAL_STATE',`${p}/staticFinalState`,'时间线必须声明静态终态。','填写跳过、取消和降级后都可应用的静态终态。'));if(t.fallbackPresentationRef&&!presentations.has(t.fallbackPresentationRef))unresolved(d,`${p}/fallbackPresentationRef`,t.fallbackPresentationRef);for(const [i,event]of t.cancelEvents.entries())if(!EVENT_DOMAINS.has(event))d.push(diag('MAP_PLAY_INVALID_EVENT',`${p}/cancelEvents/${i}`,'取消事件不属于 MapPlay 生命周期域。','使用规范列出的生命周期事件。'));const ids=new Set(t.cues.map(c=>c.id));const links=new Map<string,string>();for(const [i,c]of t.cues.entries()){if(!presentations.has(c.presentationRef))unresolved(d,`${p}/cues/${i}/presentationRef`,c.presentationRef);if(c.fallbackPresentationRef&&!presentations.has(c.fallbackPresentationRef))unresolved(d,`${p}/cues/${i}/fallbackPresentationRef`,c.fallbackPresentationRef);if(c.critical&&!c.fallbackPresentationRef&&!t.fallbackPresentationRef)d.push(diag('MAP_PLAY_CRITICAL_PRESENTATION_NO_FALLBACK',`${p}/cues/${i}`,'关键表现缺少降级。','为 cue 或 timeline 声明 fallbackPresentationRef。'));if(c.afterCueId){if(!ids.has(c.afterCueId))dangling(d,`${p}/cues/${i}/afterCueId`,c.afterCueId);links.set(c.id,c.afterCueId)}}for(const id of ids){const seen=new Set<string>();let next:string|undefined=id;while(next){if(seen.has(next)){d.push(diag('MAP_PLAY_TIMELINE_CYCLE',p,'时间线 cue 依赖形成循环。','移除 afterCueId 环。'));break}seen.add(next);next=links.get(next)}}}
function collectMapIds(map:MapDataDocument):Record<MapPlayTargetKind,Set<string>> { const portal=new Set<string>();for(const group of ('buildingGroups'in map?map.buildingGroups??[]:[]))for(const item of group.portals)portal.add(item.id);return {node:new Set(map.nodes.map(x=>x.id)),edge:new Set(map.edges.map(x=>x.id)),placement:new Set(map.placements.map(x=>x.id)),layer:new Set('layers'in map?map.layers.map(x=>x.id):map.floors.map(x=>`layer:floor:${x}`)),portal} }
function scanForbidden(v:unknown,p:string,d:MapPlayDiagnostic[]):void { if(Array.isArray(v)){v.forEach((x,i)=>scanForbidden(x,`${p}/${i}`,d));return}if(!isRecord(v))return;for(const [k,x]of Object.entries(v)){if(SPATIAL_FIELDS.has(k))d.push(diag('MAP_PLAY_FORBIDDEN_SPATIAL_OVERRIDE',`${p}/${k}`,'MapPlay 禁止覆盖坐标、拓扑或 SVG。','把空间事实保留在 MapData。'));scanForbidden(x,`${p}/${k}`,d)} }
function parseArray<T>(v:unknown,p:string,d:MapPlayDiagnostic[],fn:(x:unknown,p:string,d:MapPlayDiagnostic[])=>T|null):readonly T[]{if(!Array.isArray(v)){invalid(d,p,'必须是数组。');return []}return v.map((x,i)=>fn(x,`${p}/${i}`,d)).filter((x):x is T=>x!==null)}
function stringArray(v:unknown,p:string,d:MapPlayDiagnostic[]):readonly string[]{if(!Array.isArray(v)||v.some(x=>typeof x!=='string'||!x.trim())){invalid(d,p,'必须是非空字符串数组。');return []}return v as string[]}
function rejectUnknown(v:Record<string,unknown>,allowed:readonly string[],p:string,d:MapPlayDiagnostic[]):void{for(const k of Object.keys(v))if(!allowed.includes(k))d.push(diag('MAP_PLAY_UNKNOWN_FIELD',`${p}/${k}`,'存在未声明字段。','删除该字段或升级 Schema。'))}
function unique(items:readonly{id:string}[],p:string,d:MapPlayDiagnostic[]):void{duplicateStrings(items.map(x=>x.id),p,d)}
function duplicateStrings(items:readonly string[],p:string,d:MapPlayDiagnostic[]):void{const seen=new Set<string>();for(const id of items){if(seen.has(id))d.push(diag('MAP_PLAY_DUPLICATE_ID',p,`重复 ID：${id}`,'为每个声明使用唯一 ID。'));seen.add(id)}}
function unresolved(d:MapPlayDiagnostic[],p:string,ref:string):void{d.push(diag('MAP_PLAY_UNRESOLVED_CAPABILITY',p,`未解析能力：${ref}`,'先在对应层登记能力并写入 capabilities。'))}
function mapElement(d:MapPlayDiagnostic[],p:string,id:string):void{d.push(diag('MAP_PLAY_UNRESOLVED_MAP_ELEMENT',p,`未解析地图元素：${id}`,'引用当前 MapData 中存在的稳定 ID。'))}
function dangling(d:MapPlayDiagnostic[],p:string,id:string):void{d.push(diag('MAP_PLAY_DANGLING_TIMELINE',p,`未解析时间线/cue：${id}`,'引用文件内已声明的 ID。'))}
function requireId(v:unknown,p:string,d:MapPlayDiagnostic[]):void{if(typeof v!=='string'||!v.trim())invalid(d,p,'必须是非空稳定 ID。')}
function invalid(d:MapPlayDiagnostic[],p:string,message:string):void{d.push(diag('MAP_PLAY_INVALID_SHAPE',p,message,'按 MapPlay 2.0 Schema 修正字段。'))}
function invalidNull(d:MapPlayDiagnostic[],p:string,m:string):null{invalid(d,p,m);return null}
function failed(d:MapPlayDiagnostic[],code:MapPlayDiagnosticCode,p:string,m:string,c:string):MapPlayParseResult{d.push(diag(code,p,m,c));return{ok:false,diagnostics:freeze(d)}}
function diag(code:MapPlayDiagnosticCode,path:string,message:string,correction:string):MapPlayDiagnostic{return{code,path,message,correction}}
function isRecord(v:unknown):v is Record<string,unknown>{return v!==null&&typeof v==='object'&&!Array.isArray(v)}
function isJson(v:unknown):v is JsonValue{if(v===null||['string','boolean'].includes(typeof v))return true;if(typeof v==='number')return Number.isFinite(v);if(Array.isArray(v))return v.every(isJson);return isRecord(v)&&Object.values(v).every(isJson)}
function freeze<T>(v:T):T{if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);for(const x of Object.values(v as object))freeze(x)}return v}

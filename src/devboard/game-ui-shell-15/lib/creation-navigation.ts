export type CreationTool = 'map-editor' | 'asset-library' | 'research-bench'

export interface CreationVisitContext {
  entryTool: CreationTool
  currentTool: CreationTool
  entryId?: string
  returnTo: string
}

const TOOL_PATH: Record<CreationTool, string> = {
  'map-editor': '/map-editor',
  'asset-library': '/asset-library',
  'research-bench': '/research-bench',
}

function safeInternalPath(value: string | null | undefined, fallback = '/'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback
  return value
}

export function creationHref(
  tool: CreationTool,
  options: { entryTool?: CreationTool; entryId?: string; returnTo?: string } = {},
): string {
  const params = new URLSearchParams()
  params.set('entryTool', options.entryTool ?? tool)
  params.set('returnTo', safeInternalPath(options.returnTo))
  if (options.entryId) params.set('entryId', options.entryId)
  return `${TOOL_PATH[tool]}?${params.toString()}`
}

export function readCreationVisit(
  currentTool: CreationTool,
  params: URLSearchParams,
): CreationVisitContext {
  const candidate = params.get('entryTool')
  const entryTool: CreationTool = candidate && candidate in TOOL_PATH
    ? candidate as CreationTool
    : currentTool
  return {
    entryTool,
    currentTool,
    entryId: params.get('entryId') ?? undefined,
    returnTo: safeInternalPath(params.get('returnTo')),
  }
}

export function switchCreationHref(tool: CreationTool, visit: CreationVisitContext): string {
  return creationHref(tool, visit)
}

export function completeCreationVisit(visit: CreationVisitContext): string {
  const params = new URLSearchParams()
  params.set('creationTool', visit.entryTool)
  params.set('creationOutcome', 'completed')
  if (visit.entryId) params.set('creationEntry', visit.entryId)
  const separator = visit.returnTo.includes('?') ? '&' : '?'
  return `${visit.returnTo}${separator}${params.toString()}`
}

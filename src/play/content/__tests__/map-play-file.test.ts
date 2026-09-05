import { describe, expect, it } from 'vitest'
import {
  compileMapPlayProgram,
  parseMapPlayFile,
  validateMapPlayFile,
  type MapPlayFileV2,
} from '../map-play-file'
import type { CanonicalMapData } from '../../map/types'

const map: CanonicalMapData = {
  schemaVersion: '2.0', id: 'map:clock', name: '倒计时地图',
  backdrop: { image: 'map.svg', pixelWidth: 1000, pixelHeight: 700, tileRows: 1, tileCols: 1 },
  layers: [{ id: 'layer:main' }],
  nodes: [{ id: 'node:start', def: 'scene.class.room', scale: 'small', at: { x: 0.5, y: 0.5 }, layerId: 'layer:main' }],
  edges: [], placements: [],
}

const source = {
  schemaVersion: '2.0', kind: 'map-play', mapPlayId: 'map-play:clock', mapId: 'map:clock',
  mapDataEntryId: 'maps/clock.json', entryNodeId: 'node:start',
  capabilities: {
    rules: ['rule:map.timer'], conditions: ['condition:timer.zero'],
    actions: ['action:timer.start', 'action:task-list.sync', 'action:game-over'],
    states: ['state:timer'], outcomes: ['outcome:game-over'],
    presentations: ['ui:countdown', 'ui:countdown-static'],
  },
  localState: [{ id: 'clock', kind: 'timer', initial: 30, lifecycle: 'visit', stateRef: 'state:timer', numericOwnerRef: 'currency:seconds' }],
  rules: [{
    id: 'rule:clock', ruleRef: 'rule:map.timer', event: 'map.ready', targets: [{ kind: 'node', id: 'node:start' }],
    conditions: [], actions: [{ actionRef: 'action:timer.start', args: { stateId: 'clock' } }], timelineIds: ['timeline:clock'],
  }],
  timelines: [{
    id: 'timeline:clock', skippable: true, cancelEvents: ['map.exit'], fallbackPresentationRef: 'ui:countdown-static',
    staticFinalState: 'countdown-visible', cues: [{ id: 'cue:show', presentationRef: 'ui:countdown', delayMs: 0, blocking: false, critical: true, fallbackPresentationRef: 'ui:countdown-static' }],
  }],
  outcomes: [{ id: 'game-over', outcomeRef: 'outcome:game-over', actionRef: 'action:game-over', behavior: 'terminate', timelineId: 'timeline:clock' }],
} as const

function parsed(): MapPlayFileV2 {
  const result = parseMapPlayFile(source)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('fixture should parse')
  return result.value
}

describe('MapPlay 2.0', () => {
  it('strictly parses and compiles one frozen map-bound program', () => {
    const file = parsed()
    const result = compileMapPlayProgram(file, { map, mapDataEntryId: 'maps/clock.json' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.program.compiled).toBe(true)
      expect(Object.isFrozen(result.program)).toBe(true)
      expect(Object.isFrozen(result.program.rules)).toBe(true)
    }
  })

  it('rejects unknown and spatial override fields', () => {
    const unknown = parseMapPlayFile({ ...source, includes: ['fragment.json'] })
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.diagnostics.map((item) => item.code)).toContain('MAP_PLAY_UNKNOWN_FIELD')
    const file = parsed()
    const changed = { ...file, rules: [{ ...file.rules[0]!, actions: [{ actionRef: 'action:timer.start', args: { x: 0.2 } }] }] }
    expect(validateMapPlayFile(changed).map((item) => item.code)).toContain('MAP_PLAY_FORBIDDEN_SPATIAL_OVERRIDE')
  })

  it('rejects direct state writes, unresolved map elements, and numeric state without ownership', () => {
    const file = parsed()
    const changed: MapPlayFileV2 = {
      ...file,
      localState: [{ ...file.localState[0]!, numericOwnerRef: undefined }],
      rules: [{ ...file.rules[0]!, targets: [{ kind: 'node', id: 'node:missing' }], actions: [{ actionRef: 'world.timer', args: {} }] }],
    }
    const codes = validateMapPlayFile(changed, { map, mapDataEntryId: 'maps/clock.json' }).map((item) => item.code)
    expect(codes).toEqual(expect.arrayContaining(['MAP_PLAY_NUMERIC_OWNER_REQUIRED', 'MAP_PLAY_DIRECT_STATE_WRITE', 'MAP_PLAY_UNRESOLVED_MAP_ELEMENT']))
  })

  it('rejects timeline cycles, missing final state, and critical cues without fallback', () => {
    const file = parsed()
    const changed: MapPlayFileV2 = {
      ...file,
      timelines: [{ id: 'timeline:clock', skippable: true, cancelEvents: [], staticFinalState: '', cues: [
        { id: 'a', presentationRef: 'ui:countdown', afterCueId: 'b', delayMs: 0, blocking: true, critical: true },
        { id: 'b', presentationRef: 'ui:countdown', afterCueId: 'a', delayMs: 0, blocking: true, critical: false },
      ] }],
    }
    const codes = validateMapPlayFile(changed).map((item) => item.code)
    expect(codes).toEqual(expect.arrayContaining(['MAP_PLAY_TIMELINE_CYCLE', 'MAP_PLAY_MISSING_FINAL_STATE', 'MAP_PLAY_CRITICAL_PRESENTATION_NO_FALLBACK']))
  })

  it('checks declared capabilities against supplied registries', () => {
    const diagnostics = validateMapPlayFile(parsed(), { map, mapDataEntryId: 'maps/clock.json', registered: { actions: new Set(['action:timer.start']) } })
    expect(diagnostics.some((item) => item.code === 'MAP_PLAY_UNRESOLVED_CAPABILITY' && item.message.includes('action:game-over'))).toBe(true)
  })
})

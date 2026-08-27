import { describe, expect, it } from 'vitest'
import { validatePlayFile, type PlayFile } from '../content/play-file'

const base: PlayFile = {
  schemaVersion: '1.0', playFileId: 'play:test', requires: [], scheduleId: 'schedule:test',
  phaseBindings: [{ phaseId: 'phase:roll', triggerIds: ['trigger:start'] }],
  triggers: [{ triggerId: 'trigger:start', event: 'after:match.start', actionRefs: ['action:start'], presentationIds: ['presentation:intro'] }],
  presentations: [{ presentationId: 'presentation:intro', semanticId: 'transition.intro' }],
  outcomes: [{ outcomeId: 'outcome:win', ruleRef: 'outcome:win' }],
  lifecycle: [{ event: 'match.start', actionRef: 'action:start' }],
}

describe('PlayFile boundary', () => {
  it('accepts declarative action and presentation references', () => {
    expect(validatePlayFile(base)).toEqual([])
  })

  it('rejects direct world writes', () => {
    const diagnostics = validatePlayFile({ ...base, triggers: [{ ...base.triggers[0]!, actionRefs: ['world.entities.player'] }] })
    expect(diagnostics.map((item) => item.code)).toContain('DIRECT_RULE_WRITE')
  })
})

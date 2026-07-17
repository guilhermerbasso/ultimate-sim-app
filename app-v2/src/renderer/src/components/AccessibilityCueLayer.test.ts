import { describe, expect, it } from 'vitest'
import { shouldReplaceActiveCue } from './AccessibilityCueLayer'
import type { CueRoute } from '../../../shared/accessibility-cues'

function route(severity: CueRoute['severity']): CueRoute {
  return {
    status: 'routed',
    eventId: `alert.${severity}`,
    source: 'live',
    severity,
    message: severity,
    outputs: [],
    issues: [],
    conflicts: [],
    presentation: {
      profileId: 'standard',
      profileKind: 'standard',
      textScale: 1,
      highContrast: false,
      persistentCaptions: false,
      captionDurationMs: 5000,
      reducedMotion: false
    }
  }
}

describe('AccessibilityCueLayer critical preservation', () => {
  it('does not let a lower-priority cue replace an active critical cue', () => {
    expect(shouldReplaceActiveCue(route('critical'), route('warning'))).toBe(false)
    expect(shouldReplaceActiveCue(route('critical'), route('info'))).toBe(false)
  })

  it('allows equal or more urgent cues to replace the active cue', () => {
    expect(shouldReplaceActiveCue(route('warning'), route('critical'))).toBe(true)
    expect(shouldReplaceActiveCue(route('warning'), route('warning'))).toBe(true)
    expect(shouldReplaceActiveCue(null, route('info'))).toBe(true)
  })
})

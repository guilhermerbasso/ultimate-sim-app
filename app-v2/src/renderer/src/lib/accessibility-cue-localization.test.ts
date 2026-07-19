import { describe, expect, it } from 'vitest'
import type { CueRoute } from '../../../shared/accessibility-cues'
import {
  localizeCueMessage,
  localizeCuePattern,
  localizeCueSymbolLabel
} from './accessibility-cue-localization'

function route(): CueRoute {
  return {
    status: 'routed',
    instanceId: 'pressure-1',
    eventId: 'alert.tyrePressure',
    source: 'live',
    severity: 'warning',
    timestamp: 1,
    messageKey: 'accessibilityCues.live.alert.tyrePressure.low',
    context: {
      corner: 'lf',
      direction: 'low',
      value: 149.6,
      threshold: 150,
      unit: 'kPa'
    },
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

describe('accessibility cue localization', () => {
  it('localizes semantic context before caption or speech', () => {
    expect(localizeCueMessage(route(), 'en', 'imperial')).toBe(
      'Low tyre pressure at front left: 21.7 psi.'
    )
    expect(localizeCueMessage(route(), 'pt-BR', 'metric')).toBe(
      'Pressão baixa no pneu dianteiro esquerdo: 150 kPa.'
    )
  })

  it('localizes symbol and actual hardware pattern semantics separately', () => {
    expect(
      localizeCueSymbolLabel(
        {
          modality: 'symbol',
          sensoryChannel: 'visual',
          semanticId: 'alert.flag',
          messageKey: 'accessibilityCues.live.alert.flag.yellow',
          delivery: 'renderer',
          symbol: 'FLAG',
          symbolLabelKey: 'accessibilityCues.symbol.alert.flag'
        },
        'en'
      )
    ).toBe('Race flag symbol')
    expect(
      localizeCuePattern(
        {
          modality: 'led',
          sensoryChannel: 'visual',
          semanticId: 'alert.flag',
          messageKey: 'accessibilityCues.live.alert.flag.yellow',
          delivery: 'simulated',
          pattern: 'steady',
          patternLabelKey: 'accessibilityCues.pattern.led.steadyActual'
        },
        'en'
      )
    ).toContain('actual supported hardware output')
  })
})

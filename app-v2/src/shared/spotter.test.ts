import { describe, expect, it } from 'vitest'
import { carLeftRightStateFromEnum } from './telemetry'
import {
  buildPhrase,
  buildSpotterVoiceTestPhrase,
  decideProximity,
  fallbackVoiceProsody,
  pickDistinctOsVoice,
  pickVoice,
  piperVoiceLang,
  proximitySideFromState,
  type CalloutId,
  type PhraseParams,
  type VoiceLike
} from './spotter'

// The Voice Spotter used to fabricate each nearby car's side by INDEX PARITY over
// the iRacing CarLeftRight flag (provider) and then decide left/right from the
// SIGN of that fabricated relativeX (runtime). With multiple cars — or two cars
// on the SAME side — that split them across both sides and announced the wrong
// one. These tests pin the fix: the side is now AUTHORITATIVE from CarLeftRight.

describe('carLeftRightStateFromEnum (iRacing CarLeftRight → decided side)', () => {
  it('maps the official enum to clear/left/right/both', () => {
    expect(carLeftRightStateFromEnum(0)).toBe('clear') // Off
    expect(carLeftRightStateFromEnum(1)).toBe('clear') // Clear (no cars)
    expect(carLeftRightStateFromEnum(2)).toBe('left') // CarLeft
    expect(carLeftRightStateFromEnum(3)).toBe('right') // CarRight
    expect(carLeftRightStateFromEnum(4)).toBe('both') // CarLeftRight (three-wide)
    expect(carLeftRightStateFromEnum(5)).toBe('left') // 2CarsLeft → still left
    expect(carLeftRightStateFromEnum(6)).toBe('right') // 2CarsRight → still right
  })

  it('treats unknown/out-of-range values as clear and truncates floats', () => {
    expect(carLeftRightStateFromEnum(7)).toBe('clear')
    expect(carLeftRightStateFromEnum(-1)).toBe('clear')
    expect(carLeftRightStateFromEnum(2.9)).toBe('left') // truncates to 2
  })
})

describe('proximitySideFromState (state → spoken side)', () => {
  it('maps the decided state to the spoken proximity side', () => {
    expect(proximitySideFromState('left')).toBe('left')
    expect(proximitySideFromState('right')).toBe('right')
    expect(proximitySideFromState('both')).toBe('three-wide')
    expect(proximitySideFromState('clear')).toBeNull()
    expect(proximitySideFromState(undefined)).toBeNull()
  })
})

describe('decideProximity (authoritative side + edge detection)', () => {
  const none = { left: false, right: false }

  it('TWO cars on the same side announce that SINGLE side (the old parity bug split them)', () => {
    // CarLeftRight=5 (2 cars left) → state 'left'. The fix must announce a single
    // 'left' — never 'three-wide'. The old index-parity path would have placed one
    // car at relativeX<0 and the other at relativeX>0, producing a bogus three-wide.
    const state = carLeftRightStateFromEnum(5)
    const decision = decideProximity(state, true, none)
    expect(decision.announce).toBe('left')
    expect(decision.leftNow).toBe(true)
    expect(decision.rightNow).toBe(false)
  })

  it('announces left / right from the authoritative state', () => {
    expect(decideProximity('left', true, none).announce).toBe('left')
    expect(decideProximity('right', true, none).announce).toBe('right')
  })

  it("announces three-wide only for 'both'", () => {
    const decision = decideProximity('both', true, none)
    expect(decision.announce).toBe('three-wide')
    expect(decision.leftNow).toBe(true)
    expect(decision.rightNow).toBe(true)
  })

  it('fires once on transition, then stays silent while the side persists', () => {
    const first = decideProximity('left', true, none)
    expect(first.announce).toBe('left')
    // Next frame, car still on the left → no repeat callout, but state is held.
    const second = decideProximity('left', true, { left: first.leftNow, right: first.rightNow })
    expect(second.announce).toBeNull()
    expect(second.leftNow).toBe(true)
  })

  it('clear state announces nothing', () => {
    expect(decideProximity('clear', true, none).announce).toBeNull()
    expect(decideProximity(undefined, true, none).announce).toBeNull()
  })

  it('a closed proximity gate disables the announce but never changes the side', () => {
    const decision = decideProximity('left', false, none)
    expect(decision.announce).toBeNull()
    expect(decision.leftNow).toBe(false)
    expect(decision.rightNow).toBe(false)
  })
})

describe('buildPhrase Portuguese default', () => {
  const cases: Array<[CalloutId, PhraseParams, string]> = [
    ['flag.green', {}, 'Verde, verde, verde'],
    ['flag.yellow', {}, 'Amarela, amarela, cuidado'],
    ['flag.blue', {}, 'Bandeira azul, deixe passar'],
    ['flag.white', {}, 'Bandeira branca, última volta'],
    ['flag.checkered', {}, 'Bandeirada, corrida encerrada'],
    ['flag.meatball', {}, 'Bandeira preta e laranja, carro danificado, vá aos boxes'],
    ['flag.black', {}, 'Bandeira preta, penalidade'],
    ['fuel.low', {}, 'Combustível baixo'],
    ['fuel.lapsLeft', { laps: 1 }, 'Uma volta de combustível restante'],
    ['fuel.lapsLeft', { laps: 3 }, '3 voltas de combustível restantes'],
    ['fuel.box', {}, 'Entre nos boxes nesta volta por combustível'],
    ['pit.windowOpen', {}, 'Janela de parada aberta'],
    ['pit.onPitRoad', {}, 'Você entrou na via dos boxes'],
    ['pit.speeding', {}, 'Excesso de velocidade nos boxes, reduza'],
    ['proximity.spotter', { side: 'left' }, 'Carro à esquerda'],
    ['proximity.spotter', { side: 'right' }, 'Carro à direita'],
    ['proximity.spotter', { side: 'three-wide' }, 'Três lado a lado, cuidado'],
    ['gap.ahead', { gapSec: 1.2, trend: 'closing' }, '1,2 segundos para o carro à frente, se aproximando'],
    ['gap.behind', { gapSec: 2.3, trend: 'pulling-away' }, '2,3 segundos para o carro atrás, abrindo'],
    ['position.change', { positionNumber: 4 }, 'Posição 4'],
    ['incident.points', { points: 3 }, 'Incidente, 3 pontos'],
    ['incident.limit', {}, 'Cuidado, limite de incidentes próximo'],
    ['shift.point', {}, 'Troque a marcha'],
    ['lap.delta', { deltaSec: 0 }, 'Última volta, mesmo tempo'],
    ['lap.delta', { deltaSec: 0.4 }, 'Última volta, 0,4 segundos mais lenta'],
    ['lap.delta', { deltaSec: -0.4 }, 'Última volta, 0,4 segundos mais rápida'],
    ['lap.personalBest', {}, 'Melhor volta pessoal'],
    ['session.start', {}, 'Sessão iniciada, boa sorte']
  ]

  it.each(cases)('speaks %s in Brazilian Portuguese', (id, params, expected) => {
    expect(buildPhrase(id, undefined, params)).toBe(expected)
  })

  it('still produces English when explicitly requested', () => {
    expect(buildPhrase('proximity.spotter', 'en-US', { side: 'left' })).toBe('Car left')
    expect(buildPhrase('proximity.spotter', 'en-US', { side: 'three-wide' })).toBe('Three wide, three wide')
  })
})

describe('buildSpotterVoiceTestPhrase', () => {
  it('matches the selected speech language', () => {
    expect(buildSpotterVoiceTestPhrase('pt-BR')).toBe('Engenheiro de áudio online. Boa corrida.')
    expect(buildSpotterVoiceTestPhrase('en-US')).toBe('Audio engineer online. Have a good race.')
  })
})

// The Voice Spotter bug "the chosen voice never changes" came from resolveVoice:
// when an EXPLICIT voiceURI wasn't found (empty/stale getVoices() list), it
// silently degraded to "the first voice for the language" — the SAME voice for
// every selection. pickVoice pins the fix: an explicit voiceURI is matched
// EXACTLY and NEVER falls back to a language default; the language default is
// used ONLY when no explicit voice is set.
describe('pickVoice (exact match for explicit voiceURI, language default only when empty)', () => {
  const VOICES: VoiceLike[] = [
    { voiceURI: 'sapi:Maria', lang: 'pt-BR' },
    { voiceURI: 'sapi:Daniel', lang: 'pt-BR' },
    { voiceURI: 'sapi:Zira', lang: 'en-US' },
    { voiceURI: 'sapi:David', lang: 'en-US' }
  ]

  it('returns the EXACT voice for an explicit voiceURI — not the first one for the language', () => {
    // Daniel is the 2nd pt-BR voice; the old fallback would have spoken Maria.
    expect(pickVoice(VOICES, 'sapi:Daniel', 'pt-BR')).toEqual({ voiceURI: 'sapi:Daniel', lang: 'pt-BR' })
    expect(pickVoice(VOICES, 'sapi:David', 'en-US')).toEqual({ voiceURI: 'sapi:David', lang: 'en-US' })
  })

  it('returns null when an explicit voiceURI is not (yet) in the list — never degrades to first-language voice', () => {
    // THE regression: an unmatched explicit selection must NOT resolve to Maria.
    expect(pickVoice(VOICES, 'sapi:NotLoadedYet', 'pt-BR')).toBeNull()
    // Same when the list is momentarily empty (getVoices() race before voiceschanged).
    expect(pickVoice([], 'sapi:Daniel', 'pt-BR')).toBeNull()
  })

  it('falls back to the FIRST exact-language voice only when voiceURI is empty', () => {
    expect(pickVoice(VOICES, '', 'pt-BR')).toEqual({ voiceURI: 'sapi:Maria', lang: 'pt-BR' })
    expect(pickVoice(VOICES, '', 'en-US')).toEqual({ voiceURI: 'sapi:Zira', lang: 'en-US' })
  })

  it('falls back by language PREFIX when no exact-language voice exists (empty voiceURI)', () => {
    const ptPt: VoiceLike[] = [{ voiceURI: 'sapi:Joana', lang: 'pt-PT' }]
    expect(pickVoice(ptPt, '', 'pt-BR')).toEqual({ voiceURI: 'sapi:Joana', lang: 'pt-PT' })
    // Underscore locales (e.g. piper-style 'en_US') still match the 'en' prefix.
    const enUnderscore: VoiceLike[] = [{ voiceURI: 'x', lang: 'en_GB' }]
    expect(pickVoice(enUnderscore, '', 'en-US')).toEqual({ voiceURI: 'x', lang: 'en_GB' })
  })

  it('returns null for empty voiceURI when no voice matches the language at all', () => {
    expect(pickVoice([{ voiceURI: 'fr', lang: 'fr-FR' }], '', 'en-US')).toBeNull()
    expect(pickVoice([], '', 'pt-BR')).toBeNull()
  })
})

describe('piperVoiceLang (Piper model id → language for same-language OS fallback)', () => {
  it('maps known catalog ids to their language', () => {
    expect(piperVoiceLang('pt_BR-faber-medium')).toBe('pt-BR')
    expect(piperVoiceLang('pt_BR-edresson-low')).toBe('pt-BR')
    expect(piperVoiceLang('en_US-amy-low')).toBe('en-US')
    expect(piperVoiceLang('en_US-ryan-medium')).toBe('en-US')
  })

  it('returns null for unknown ids so the caller falls back to the configured language', () => {
    expect(piperVoiceLang('nope')).toBeNull()
    expect(piperVoiceLang('')).toBeNull()
  })
})

// pickDistinctOsVoice fixes "all neural voices sound identical" when the neural
// engine is unavailable (tts:synth → null). The old OS fallback spoke with an
// EMPTY voiceURI, so the OS always chose the single language default and every
// neural voice collapsed onto ONE OS voice. This deterministically maps each
// requested neural id to a DISTINCT same-language OS voice (stable per run).
describe('pickDistinctOsVoice (distinct OS voice per neural id; exact match wins)', () => {
  const PT_BR: VoiceLike[] = [
    { voiceURI: 'OS Maria - Portuguese (Brazil)', lang: 'pt-BR' },
    { voiceURI: 'OS Daniel - Portuguese (Brazil)', lang: 'pt-BR' }
  ]

  it('maps two DIFFERENT neural ids to two DIFFERENT OS voices when ≥2 same-lang exist', () => {
    // faber and cadu hash to different indices over the 2 pt-BR voices.
    const a = pickDistinctOsVoice('pt_BR-faber-medium', PT_BR, 'pt-BR')
    const b = pickDistinctOsVoice('pt_BR-cadu-medium', PT_BR, 'pt-BR')
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a!.voiceURI).not.toBe(b!.voiceURI)
  })

  it('is STABLE: the same neural id always maps to the same OS voice', () => {
    const first = pickDistinctOsVoice('pt_BR-faber-medium', PT_BR, 'pt-BR')
    const second = pickDistinctOsVoice('pt_BR-faber-medium', PT_BR, 'pt-BR')
    expect(first!.voiceURI).toBe(second!.voiceURI)
  })

  it('is independent of getVoices() ordering (sorts candidates by voiceURI)', () => {
    const reversed = [...PT_BR].reverse()
    expect(pickDistinctOsVoice('pt_BR-faber-medium', PT_BR, 'pt-BR')!.voiceURI).toBe(
      pickDistinctOsVoice('pt_BR-faber-medium', reversed, 'pt-BR')!.voiceURI
    )
  })

  it('an EXPLICIT exact voiceURI match always wins over hashing', () => {
    const voices: VoiceLike[] = [
      ...PT_BR,
      { voiceURI: 'OS Zira - English (United States)', lang: 'en-US' }
    ]
    expect(
      pickDistinctOsVoice('OS Daniel - Portuguese (Brazil)', voices, 'pt-BR')!.voiceURI
    ).toBe('OS Daniel - Portuguese (Brazil)')
  })

  it('falls back by language PREFIX when no exact-locale voice exists', () => {
    const ptPt: VoiceLike[] = [{ voiceURI: 'OS Joana - Portuguese (Portugal)', lang: 'pt-PT' }]
    expect(pickDistinctOsVoice('pt_BR-faber-medium', ptPt, 'pt-BR')!.voiceURI).toBe(
      'OS Joana - Portuguese (Portugal)'
    )
  })

  it('returns null when no same-language OS voice exists yet', () => {
    expect(pickDistinctOsVoice('pt_BR-faber-medium', [{ voiceURI: 'fr', lang: 'fr-FR' }], 'pt-BR')).toBeNull()
    expect(pickDistinctOsVoice('pt_BR-faber-medium', [], 'pt-BR')).toBeNull()
  })
})

// fallbackVoiceProsody keeps voices audibly DISTINCT even when the OS has a single
// voice for the language (where pickDistinctOsVoice returns the same voice for all
// ids) — by shifting pitch/rate deterministically per neural voice id.
describe('fallbackVoiceProsody (per-voice pitch/rate so single-OS-voice systems stay distinct)', () => {
  it('is deterministic for a given voice id', () => {
    expect(fallbackVoiceProsody('pt_BR-faber-medium')).toEqual(fallbackVoiceProsody('pt_BR-faber-medium'))
  })

  it('differs across distinct voice ids', () => {
    const a = fallbackVoiceProsody('pt_BR-faber-medium')
    const b = fallbackVoiceProsody('pt_BR-cadu-medium')
    const c = fallbackVoiceProsody('pt_BR-jeff-medium')
    // At least the pitch axis separates them (rate may coincide for some pairs).
    expect(new Set([a.pitch, b.pitch, c.pitch]).size).toBeGreaterThan(1)
  })

  it('stays within natural, speakable bands', () => {
    for (const id of ['pt_BR-faber-medium', 'en_US-amy-low', 'pt_BR-edresson-low', 'en_US-ryan-medium']) {
      const { pitch, rate } = fallbackVoiceProsody(id)
      expect(pitch).toBeGreaterThanOrEqual(0.82)
      expect(pitch).toBeLessThanOrEqual(1.18)
      expect(rate).toBeGreaterThanOrEqual(0.94)
      expect(rate).toBeLessThanOrEqual(1.06)
    }
  })
})

import { describe, expect, it } from 'vitest'
import {
  ALL_VARIANTS,
  filterVariants,
  variantRequiredField,
  variantSupportedSims
} from './widget-catalog-data'
import { PLAYABLE_SIMS } from '../../../../shared/sim-coverage'

// PLAYABLE_SIMS preserves display order: iRacing, ACC, AC, AMS2, LMU. widgetSupportedSims
// returns supported sims in that same order, so the expectations below assert exact order.
const ALL_SIMS = ['iracing', 'acc', 'ac', 'ams2', 'lmu'] as const

describe('variantRequiredField — binding → TelemetrySnapshot field', () => {
  it('resolves ir:<id> to the iRacing variable telemetry field (ir:Speed → speedKmh)', () => {
    expect(variantRequiredField({ binding: 'ir:Speed' })).toBe('speedKmh')
  })

  it('reduces a dotted telemetryField to its ROOT snapshot key', () => {
    // tyre temp var → 'tyres.lf.tempC'         → root 'tyres'
    expect(variantRequiredField({ binding: 'ir:LFtempCL' })).toBe('tyres')
    // cold-pressure var → 'tireColdPressuresKpa.lf' → root 'tireColdPressuresKpa'
    expect(variantRequiredField({ binding: 'ir:LFcoldPressure' })).toBe('tireColdPressuresKpa')
  })

  it('treats var:/expr:/derived-preview/empty bindings as field-less', () => {
    expect(variantRequiredField({ binding: 'var:myVar' })).toBeNull()
    expect(variantRequiredField({ binding: 'expr:a+b' })).toBeNull()
    expect(variantRequiredField({ binding: 'rpmPct' })).toBeNull() // derived, not a snapshot key
    expect(variantRequiredField({ binding: undefined })).toBeNull()
  })

  it('maps a bare real snapshot field name to itself', () => {
    expect(variantRequiredField({ binding: 'waterTempC' })).toBe('waterTempC')
  })

  it('ignores unknown ir:<id> ids (no telemetry requirement)', () => {
    expect(variantRequiredField({ binding: 'ir:NotARealChannel' })).toBeNull()
  })
})

describe('variantSupportedSims — per-yes coverage from binding', () => {
  it('a Speed variant (ir:Speed → speedKmh) is supported by every playable yes', () => {
    expect(variantSupportedSims({ binding: 'ir:Speed' })).toEqual([...ALL_SIMS])
  })

  it('field-less variants are supported by every playable yes', () => {
    expect(variantSupportedSims({ binding: undefined })).toEqual([...ALL_SIMS])
    expect(variantSupportedSims({ binding: 'var:anything' })).toEqual([...ALL_SIMS])
  })

  it('tyres restrict to iRacing / ACC / LMU', () => {
    expect(variantSupportedSims({ binding: 'ir:LFtempCL' })).toEqual(['iracing', 'acc', 'lmu'])
  })

  it('tyre cold pressure restricts to iRacing only', () => {
    expect(variantSupportedSims({ binding: 'ir:LFcoldPressure' })).toEqual(['iracing'])
  })

  it('standings (strength of field) restricts to iRacing only', () => {
    expect(variantSupportedSims({ binding: 'ir:StrengthOfField' })).toEqual(['iracing'])
  })

  it('semantic element types without a binding map to their gating field (tyregrid→tyres, standings→drivers)', () => {
    expect(variantSupportedSims({ type: 'tyregrid' })).toEqual(['iracing', 'acc', 'lmu'])
    expect(variantSupportedSims({ type: 'standings' })).toEqual(['iracing'])
    expect(variantSupportedSims({ type: 'deltatile' })).toEqual(['iracing'])
    expect(variantSupportedSims({ type: 'gearcluster' })).toEqual([...ALL_SIMS])
  })

  it('an ir: channel with no unified telemetryField is iRacing-exclusive (not all sims)', () => {
    expect(variantSupportedSims({ binding: 'ir:__no_such_unified_field__' })).toEqual(['iracing'])
  })

  it('the shiftPct preview alias resolves to shiftIndicatorPct (iRacing-only live)', () => {
    expect(variantSupportedSims({ binding: 'shiftPct' })).toEqual(['iracing'])
  })

  it('universal preview aliases (rpmPct/gearLabel/fuelPct) stay available on every yes', () => {
    expect(variantSupportedSims({ binding: 'rpmPct' })).toEqual([...ALL_SIMS])
    expect(variantSupportedSims({ binding: 'gearLabel' })).toEqual([...ALL_SIMS])
    expect(variantSupportedSims({ binding: 'fuelPct' })).toEqual([...ALL_SIMS])
  })
})

describe('catalog variants carry computed supportedSims', () => {
  const byId = new Map(ALL_VARIANTS.map((v) => [v.id, v]))

  it('every catalog variant exposes a supportedSims array of playable sims', () => {
    for (const v of ALL_VARIANTS) {
      expect(Array.isArray(v.supportedSims)).toBe(true)
      for (const s of v.supportedSims) expect(PLAYABLE_SIMS).toContain(s)
    }
  })

  it('classifies representative iRacing channel variants', () => {
    expect(byId.get('ir-Speed')?.supportedSims).toEqual([...ALL_SIMS])
    expect(byId.get('ir-LFtempCL')?.supportedSims).toEqual(['iracing', 'acc', 'lmu'])
    expect(byId.get('ir-LFcoldPressure')?.supportedSims).toEqual(['iracing'])
    expect(byId.get('ir-StrengthOfField')?.supportedSims).toEqual(['iracing'])
  })
})

describe('filterVariants — per-yes facet (additive to search/category/style)', () => {
  it('leaves the catalog unfiltered when yes is null/absent', () => {
    expect(filterVariants(ALL_VARIANTS, { yes: null })).toHaveLength(ALL_VARIANTS.length)
    expect(filterVariants(ALL_VARIANTS, {})).toHaveLength(ALL_VARIANTS.length)
  })

  it("yes='ams2' excludes iRacing-only variants but keeps universal ones", () => {
    const ams2 = filterVariants(ALL_VARIANTS, { yes: 'ams2' })
    const ids = new Set(ams2.map((v) => v.id))
    expect(ids.has('ir-Speed')).toBe(true) // speedKmh → every yes
    expect(ids.has('ir-StrengthOfField')).toBe(false) // standings → iRacing only
    expect(ids.has('ir-LFcoldPressure')).toBe(false) // cold pressure → iRacing only
    for (const v of ams2) expect(v.supportedSims).toContain('ams2')
  })

  it("yes='iracing' keeps the iRacing-only variants", () => {
    const ids = new Set(filterVariants(ALL_VARIANTS, { yes: 'iracing' }).map((v) => v.id))
    expect(ids.has('ir-StrengthOfField')).toBe(true)
    expect(ids.has('ir-LFcoldPressure')).toBe(true)
  })

  it('intersects the yes facet with the category facet', () => {
    const accTyres = filterVariants(ALL_VARIANTS, { yes: 'acc', category: 'Tyres/Brakes' })
    expect(accTyres.some((v) => v.id === 'ir-LFtempCL')).toBe(true)
    const ams2Tyres = filterVariants(ALL_VARIANTS, { yes: 'ams2', category: 'Tyres/Brakes' })
    expect(ams2Tyres.some((v) => v.id === 'ir-LFtempCL')).toBe(false)
  })
})

// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOverlayStyle, type OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { OVERLAY_DASHBOARD_PRESETS } from '../../../../shared/dashboards'
import { WIDGET_COMPONENTS } from './index'
import { RaceconRc10DashWidget } from './RaceconRc10DashWidget'
import {
  Rc01LiveTelemetryBuffer,
  advanceRc01Alerts,
  createRc01AlertState,
  createRc01ChannelReceipts
} from './raceconRc01Core'
import {
  RC10_ALERT_WORDS,
  RC10_APP_STATUS_CARRIAGE,
  RC10_APP_ZONES,
  RC10_CHANNEL_STALE_MS,
  RC10_CQW_PX,
  RC10_DASH,
  RC10_FUEL_FULL_SCALE_LAPS,
  RC10_FUEL_LAPS_PER_SEGMENT,
  RC10_FUEL_LOW_HYSTERESIS_LAPS,
  RC10_FUEL_RESERVE_LAPS,
  RC10_FUEL_SEGMENT_COUNT,
  RC10_GEAR_CAP_HEIGHT_RATIO,
  RC10_MIN_GRAPHIC_CONTRAST,
  RC10_MIN_TEXT_CONTRAST,
  RC10_NATIVE_ZONES,
  RC10_OVERHEAT_CLEAR_MARGIN_C,
  RC10_OVERHEAT_CLEAR_MS,
  RC10_OVERHEAT_ENGAGE_MS,
  RC10_OVERHEAT_LIMIT_C,
  RC10_PACKET_OMISSIONS,
  RC10_REFERENCE_PRIMARY_CONTRAST,
  RC10_SHIFT_BAR_HEIGHT_PX,
  RC10_SHIFT_INFO_SEGMENTS,
  RC10_SHIFT_OVER_REV_THRESHOLD,
  RC10_SHIFT_RAMP_COUNT,
  RC10_SHIFT_RAMP_THRESHOLDS,
  RC10_SHIFT_SEGMENT_COUNT,
  RC10_SPEED_DASH_MS,
  RC10_STATUS_LADDER,
  RC10_SURFACE_TOKENS,
  RC10_TEXT_TOKENS,
  RC10_TOKENS,
  RC10_TYPE_SCALE_PX,
  type Rc10AlertInput,
  Rc10AuxBuffer,
  type Rc10Rect,
  type Rc10ZoneMap,
  advanceRc10Alerts,
  buildRc10FuelSegments,
  buildRc10ShiftSegments,
  clearInvalidRc10Alerts,
  createRc10AlertState,
  createRc10AuxReceipts,
  createRc10DashboardModel,
  rc10AlertInputForModel,
  rc10AlertLines,
  rc10AuxChannelValue,
  rc10ColourBlindFingerprint,
  rc10CompactModeForContentBox,
  rc10ContrastRatio,
  rc10DeltaCue,
  rc10DisplayGear,
  rc10EmphasisTarget,
  rc10EmphasisZoneForLayout,
  rc10FitFontCqw,
  rc10FormatDelta,
  rc10FormatFuelLaps,
  rc10FuelLapsRemaining,
  rc10FuelLitSegments,
  rc10GearCapHeightPx,
  rc10LayoutForContentBox,
  rc10Percent,
  rc10PhoneGeometryForContentBox,
  rc10PlainLanguage,
  rc10RelativeLuminance,
  rc10RungCqw,
  rc10ShiftLitRampCount,
  rc10StatusRung,
  rc10TypeScaleCqw,
  rc10TyreTemperatureC,
  rc10ZoneStyle,
  rc10ZonesForLayout
} from './raceconRc10Core'

const config: OverlayWidgetConfig = {
  id: 'raceconRc10Dash',
  enabled: true,
  locked: true,
  favorite: false,
  position: { x: 0, y: 0, width: 1024, height: 600 },
  opacity: 100,
  stylePreset: 'minimal',
  style: createDefaultOverlayStyle(),
  display: null
}

const nativeConfig: OverlayWidgetConfig = {
  ...config,
  position: { x: 0, y: 0, width: 800, height: 480 }
}

/**
 * The stylesheet is read as TEXT, not as a loaded module, because two of RC-10's accessibility
 * guarantees are properties of the source itself: every `color:` declaration must resolve to a
 * >= 10:1 token, and there must be no `opacity` anywhere. Vitest's root is `app-v2`.
 */
const CSS_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/overlay/widgets/raceconRc10.css'),
  'utf8'
)

/**
 * The stylesheet with its comments stripped. The comments deliberately NAME the forbidden values —
 * the render's `#070707`, the reasons `opacity` is banned — so every rule below is asserted
 * against the declarations alone, never against the prose that explains them.
 */
const CSS_DECLARATIONS = CSS_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * The approved RC-10 reference state (attempt-005 governed 800x480,
 * `input/telemetry-frame-lap22-timing-dropout.json`): mid-stint corner exit on lap 22 in fourth
 * gear at 187 km/h, 5320 of 7600 rpm (70.0 %), 0.412 s inside the stored best, 8.4 laps of fuel,
 * 86 degC coolant, TC step 4, and the timing/scoring feed dropped 8 s ago so Position dashes.
 * All three packet section 15 alerts are ARMED and SILENT.
 *
 * The fuel projection is deliberately NOT handed over as `fuelLapsRemaining`: 25.2 litres against
 * a measured 3.0 l/lap burn is the packet's "computed fuel model", and without that measured burn
 * rate there would be no projection at all.
 */
function snapshot(overrides: Partial<TelemetrySnapshot> = {}, timestamp = 1_322_000): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp,
    sessionUniqueId: 22,
    gear: 4,
    rpm: 5_320,
    maxRpm: 7_600,
    speedKmh: 187,
    deltaToBestSec: -0.412,
    bestLapTimeSec: 92.4,
    fuelLiters: 25.2,
    fuelPerLapLiters: 3,
    waterTempC: 86,
    tcLevel: 4,
    throttle: 0.72,
    brake: 0,
    clutch: 0,
    sessionType: 'Race',
    sessionState: 'racing',
    playerCarIdx: 2,
    ...overrides
  } as TelemetrySnapshot
}

function markup(value: TelemetrySnapshot | null, cfg = config): string {
  return renderToStaticMarkup(createElement(RaceconRc10DashWidget, { snapshot: value, config: cfg }))
}

function assertClean(value: string): void {
  expect(value).not.toContain('\uFFFD')
  expect(value).not.toContain('NaN')
  expect(value).not.toContain('undefined')
  expect(value).not.toContain('[object Object]')
}

function modelFor(
  value: TelemetrySnapshot | null,
  nowMs = 0,
  options: Parameters<typeof createRc10DashboardModel>[4] = {},
  receiptsAtMs = nowMs
): ReturnType<typeof createRc10DashboardModel> {
  const receipts = value ? createRc01ChannelReceipts(value, receiptsAtMs) : new Map()
  const aux = value ? createRc10AuxReceipts(value, receiptsAtMs) : new Map()
  return createRc10DashboardModel(value, receipts, aux, nowMs, options)
}

function alertInput(overrides: Partial<Rc10AlertInput> = {}): Rc10AlertInput {
  return { nowMs: 0, fuelLapsRemaining: null, waterTempC: null, ...overrides }
}

function right(rect: Rc10Rect): number {
  return rect.left + rect.width
}

function bottom(rect: Rc10Rect): number {
  return rect.top + rect.height
}

function overlaps(a: Rc10Rect, b: Rc10Rect): boolean {
  return a.left < right(b) && right(a) > b.left && a.top < bottom(b) && bottom(a) > b.top
}

function allZones(zones: Rc10ZoneMap): Rc10Rect[] {
  return Object.values(zones).filter((rect): rect is Rc10Rect => Boolean(rect))
}

const BREAKPOINTS: readonly { width: number; height: number }[] = [
  { width: 800, height: 480 },
  { width: 1024, height: 600 },
  { width: 1920, height: 1080 },
  { width: 400, height: 800 },
  { width: 900, height: 400 },
  { width: 640, height: 520 }
]

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('RC-10 registration and preset wiring', () => {
  it('registers the widget component under its canonical id', () => {
    expect(WIDGET_COMPONENTS.raceconRc10Dash).toBe(RaceconRc10DashWidget)
  })

  it('declares exactly one RC-10 full-frame preset directly after RC-09', () => {
    const ids = OVERLAY_DASHBOARD_PRESETS.map((entry) => entry.id)
    expect(ids.filter((id) => id === 'racecon_rc10_dash')).toHaveLength(1)
    expect(ids.indexOf('racecon_rc10_dash')).toBe(ids.indexOf('racecon_rc09_dash') + 1)
    const preset = OVERLAY_DASHBOARD_PRESETS.find((entry) => entry.id === 'racecon_rc10_dash')
    expect(preset?.widgetId).toBe('raceconRc10Dash')
    expect(preset?.name).toBe('RaceCon RC-10 Clear Sight')
    expect(preset?.scaleMode).toBe('stretch')
    expect(preset?.tags).toContain('accessibility')
    expect(preset?.tags).toContain('high-contrast')
  })
})

describe('RC-10 packet zone geometry', () => {
  it('reproduces packet 11.1 verbatim rather than tracing the render', () => {
    expect(RC10_NATIVE_ZONES.gear).toEqual({ left: 2.0, top: 3.3, width: 47.5, height: 45.8 })
    expect(RC10_NATIVE_ZONES.speed).toEqual({ left: 51.5, top: 3.3, width: 46.5, height: 45.8 })
    expect(RC10_NATIVE_ZONES.delta).toEqual({ left: 2.0, top: 52.5, width: 63.8, height: 25.0 })
    expect(RC10_NATIVE_ZONES.fuel).toEqual({ left: 67.5, top: 52.5, width: 30.5, height: 25.0 })
    expect(RC10_NATIVE_ZONES.status).toEqual({ left: 2.0, top: 80.8, width: 96.0, height: 15.8 })
    // The plain-language line is app-only: packet 12.1 introduces it and 11.1 has no zone for it.
    expect(RC10_NATIVE_ZONES.plain).toBeUndefined()
  })

  it('reproduces packet 12.1 verbatim and swaps the status row for the plain-language line', () => {
    expect(RC10_APP_ZONES.gear).toEqual({ left: 2.3, top: 4.0, width: 46.9, height: 43.3 })
    expect(RC10_APP_ZONES.speed).toEqual({ left: 51.6, top: 4.0, width: 46.1, height: 43.3 })
    expect(RC10_APP_ZONES.delta).toEqual({ left: 2.3, top: 50.0, width: 58.6, height: 25.0 })
    expect(RC10_APP_ZONES.fuel).toEqual({ left: 63.3, top: 50.0, width: 34.4, height: 25.0 })
    expect(RC10_APP_ZONES.plain).toEqual({ left: 2.3, top: 77.7, width: 95.3, height: 18.3 })
    expect(RC10_APP_ZONES.status).toBeUndefined()
  })

  it('refuses the render"s drifted rectangles: N3 records +4.9 / -4.7 / -7.9 / +7.6 pp', () => {
    // The reference renders the gear tile 4.9 pp wide, the speed tile 4.7 pp narrow, the delta
    // tile 7.9 pp narrow and the fuel tile 7.6 pp wide, and puts the row-two boundary at 59.5 %.
    expect(RC10_NATIVE_ZONES.gear!.width).not.toBeCloseTo(47.5 + 4.9, 3)
    expect(RC10_NATIVE_ZONES.delta!.width).not.toBeCloseTo(63.8 - 7.9, 3)
    expect(RC10_NATIVE_ZONES.fuel!.left).toBe(67.5)
    expect(RC10_NATIVE_ZONES.fuel!.left).not.toBe(59.5)
  })

  it('keeps the row-two asymmetry the packet demands: delta is 2.1x the fuel tile', () => {
    expect(RC10_NATIVE_ZONES.delta!.width / RC10_NATIVE_ZONES.fuel!.width).toBeCloseTo(2.09, 2)
    // Row one is near-equal, and row three is the shortest row on the canvas.
    expect(RC10_NATIVE_ZONES.gear!.width / RC10_NATIVE_ZONES.speed!.width).toBeCloseTo(1.02, 2)
    expect(RC10_NATIVE_ZONES.status!.height).toBeLessThan(RC10_NATIVE_ZONES.delta!.height)
    expect(RC10_NATIVE_ZONES.gear!.height).toBeGreaterThan(RC10_NATIVE_ZONES.delta!.height)
  })

  it('contains every zone inside the canvas at every breakpoint', () => {
    for (const size of BREAKPOINTS) {
      const layout = rc10LayoutForContentBox(size.width, size.height)
      const mode = rc10CompactModeForContentBox(size.width, size.height)
      for (const rect of allZones(rc10ZonesForLayout(layout, mode))) {
        expect(rect.left).toBeGreaterThanOrEqual(0)
        expect(rect.top).toBeGreaterThanOrEqual(0)
        expect(right(rect)).toBeLessThanOrEqual(100)
        expect(bottom(rect)).toBeLessThanOrEqual(100)
        expect(rect.width).toBeGreaterThan(0)
        expect(rect.height).toBeGreaterThan(0)
      }
    }
  })

  it('keeps every zone disjoint at every breakpoint', () => {
    for (const size of BREAKPOINTS) {
      const layout = rc10LayoutForContentBox(size.width, size.height)
      const mode = rc10CompactModeForContentBox(size.width, size.height)
      const rects = allZones(rc10ZonesForLayout(layout, mode))
      for (let a = 0; a < rects.length; a += 1) {
        for (let b = a + 1; b < rects.length; b += 1) {
          expect(overlaps(rects[a], rects[b]), `${size.width}x${size.height} zones ${a}/${b} overlap`).toBe(false)
        }
      }
    }
  })

  it('carries the three-row hierarchy and the delta-over-fuel primacy at every breakpoint', () => {
    for (const size of BREAKPOINTS) {
      const layout = rc10LayoutForContentBox(size.width, size.height)
      const mode = rc10CompactModeForContentBox(size.width, size.height)
      const zones = rc10ZonesForLayout(layout, mode)
      const third = zones.status ?? zones.plain
      expect(bottom(zones.gear!)).toBeLessThanOrEqual(zones.delta!.top)
      expect(bottom(zones.delta!)).toBeLessThanOrEqual(third!.top)
      expect(bottom(zones.speed!)).toBeLessThanOrEqual(zones.fuel!.top)
      // Packet 10: delta to best is primary, fuel laps is secondary, in every grammar.
      expect(zones.delta!.width * zones.delta!.height).toBeGreaterThan(zones.fuel!.width * zones.fuel!.height)
      // The gear digit is the hero of the whole display.
      expect(zones.gear!.width * zones.gear!.height).toBeGreaterThan(zones.delta!.width * zones.delta!.height)
    }
  })

  it('emits inline percentages without binary-float noise', () => {
    expect(rc10Percent(45.8)).toBe('45.8%')
    expect(rc10Percent(1 / 3)).toBe('0.333%')
    expect(rc10Percent(Number.NaN)).toBe('0%')
    expect(rc10ZoneStyle(RC10_NATIVE_ZONES.fuel)).toEqual({
      left: '67.5%',
      top: '52.5%',
      width: '30.5%',
      height: '25%'
    })
    expect(rc10ZoneStyle(undefined)).toBeNull()
  })
})

describe('RC-10 typographic ladder is computed from packet 11.2, not from the render', () => {
  it('keeps the packet 11.2 px ladder verbatim, including the 24 px label minimum', () => {
    expect(RC10_TYPE_SCALE_PX.gear).toBe(210)
    expect(RC10_TYPE_SCALE_PX.speed).toBe(150)
    expect(RC10_TYPE_SCALE_PX.delta).toBe(86)
    expect(RC10_TYPE_SCALE_PX.fuel).toBe(72)
    expect(RC10_TYPE_SCALE_PX.status).toBe(44)
    expect(RC10_TYPE_SCALE_PX.label).toBe(24)
    expect(RC10_CQW_PX).toBe(8)
    expect(rc10TypeScaleCqw(RC10_TYPE_SCALE_PX.gear)).toBe(26.25)
    expect(rc10TypeScaleCqw(RC10_TYPE_SCALE_PX.label)).toBe(3)
  })

  it('refuses the render"s compressed steps: gear/speed stays 1.40 and fuel/status 1.64', () => {
    // Normative override N2: the approved frame compresses gear/speed to 1.250 and fuel/status to
    // 1.158. The packet's own ratios are kept instead and the rendered cap heights are not traced.
    expect(RC10_TYPE_SCALE_PX.gear / RC10_TYPE_SCALE_PX.speed).toBeCloseTo(1.4, 6)
    expect(RC10_TYPE_SCALE_PX.fuel / RC10_TYPE_SCALE_PX.status).toBeCloseTo(1.64, 2)
    expect(RC10_TYPE_SCALE_PX.speed / RC10_TYPE_SCALE_PX.delta).toBeCloseTo(1.74, 2)
  })

  it('preserves the packet ranked order: gear > speed > delta > fuel > status > labels', () => {
    const ladder = [
      RC10_TYPE_SCALE_PX.gear,
      RC10_TYPE_SCALE_PX.speed,
      RC10_TYPE_SCALE_PX.delta,
      RC10_TYPE_SCALE_PX.fuel,
      RC10_TYPE_SCALE_PX.status,
      RC10_TYPE_SCALE_PX.label
    ]
    for (let index = 0; index < ladder.length - 1; index += 1) {
      expect(ladder[index]).toBeGreaterThan(ladder[index + 1])
    }
  })

  it('resolves packet gap G5: 210 px is the nominal type size, not the cap height', () => {
    // A 210 px CAP HEIGHT cannot fit a 220 px tile that also carries a 24 px shift bar and a
    // 24 px label. Read as the nominal size it gives a ~149 px cap height, which does fit.
    expect(RC10_GEAR_CAP_HEIGHT_RATIO).toBeLessThan(1)
    const cap = rc10GearCapHeightPx()
    expect(cap).toBeCloseTo(149.1, 3)
    const tileHeightPx = (RC10_NATIVE_ZONES.gear!.height / 100) * 480
    expect(tileHeightPx).toBeCloseTo(219.84, 2)
    expect(cap + RC10_SHIFT_BAR_HEIGHT_PX + RC10_TYPE_SCALE_PX.label).toBeLessThan(tileHeightPx)
    // The packet's own 210 px, read as a cap height, would not have fitted.
    expect(RC10_TYPE_SCALE_PX.gear + RC10_SHIFT_BAR_HEIGHT_PX).toBeGreaterThan(tileHeightPx)
  })

  it('honours every packet rung verbatim, because each one fits its own zone', () => {
    expect(rc10RungCqw(RC10_TYPE_SCALE_PX.gear, RC10_NATIVE_ZONES.gear!.width, 1)).toBe(
      rc10TypeScaleCqw(RC10_TYPE_SCALE_PX.gear)
    )
    expect(rc10RungCqw(RC10_TYPE_SCALE_PX.speed, RC10_NATIVE_ZONES.speed!.width, 3)).toBe(
      rc10TypeScaleCqw(RC10_TYPE_SCALE_PX.speed)
    )
    expect(rc10RungCqw(RC10_TYPE_SCALE_PX.delta, RC10_NATIVE_ZONES.delta!.width * 0.62, 6)).toBe(
      rc10TypeScaleCqw(RC10_TYPE_SCALE_PX.delta)
    )
    expect(rc10RungCqw(RC10_TYPE_SCALE_PX.fuel, RC10_NATIVE_ZONES.fuel!.width, 3)).toBe(
      rc10TypeScaleCqw(RC10_TYPE_SCALE_PX.fuel)
    )
    expect(rc10RungCqw(RC10_TYPE_SCALE_PX.status, RC10_NATIVE_ZONES.status!.width / 3, 6)).toBe(
      rc10TypeScaleCqw(RC10_TYPE_SCALE_PX.status)
    )
  })

  it('caps a rung by its zone when the nowrap trap would let a numeral escape', () => {
    // The documented RC-01/RC-02 trap: `white-space: nowrap` lets a flex item's min-content width
    // exceed its column, so `overflow: hidden` never clips and every scrollWidth check passes.
    const wide = rc10RungCqw(RC10_TYPE_SCALE_PX.delta, RC10_NATIVE_ZONES.delta!.width * 0.62, 12)
    expect(wide).toBeLessThan(rc10TypeScaleCqw(RC10_TYPE_SCALE_PX.delta))
    expect(wide * 12 * 0.56).toBeLessThanOrEqual(RC10_NATIVE_ZONES.delta!.width * 0.62)
    expect(rc10FitFontCqw(0, 6)).toBe(0)
    expect(rc10FitFontCqw(30, 0)).toBe(0)
    expect(rc10FitFontCqw(Number.NaN, 6)).toBe(0)
  })
})

describe('RC-10 colour tokens and the packet section 19 contrast floor', () => {
  it('uses the packet 11.3 tokens exactly, refusing normative override N4"s rendered values', () => {
    expect(RC10_TOKENS).toEqual({
      bg: '#000000',
      panel: '#0B0B0B',
      primary: '#FFFFFF',
      secondary: '#DDDDDD',
      info: '#56B4E9',
      normal: '#009E73',
      caution: '#E69F00',
      danger: '#D55E00',
      signature: '#F0E442'
    })
    // The render produced these instead; none of them may appear in the product.
    for (const rendered of ['#070707', '#4EA5EE', '#129675', '#F5DA31']) {
      expect(Object.values(RC10_TOKENS)).not.toContain(rendered)
      expect(CSS_DECLARATIONS.toLowerCase()).not.toContain(rendered.toLowerCase())
    }
    // And every packet 11.3 token is declared verbatim as a custom property.
    for (const hex of Object.values(RC10_TOKENS)) {
      expect(CSS_DECLARATIONS.toLowerCase()).toContain(hex.toLowerCase())
    }
  })

  it('computes WCAG relative luminance and contrast arithmetically', () => {
    expect(rc10RelativeLuminance('#FFFFFF')).toBeCloseTo(1, 10)
    expect(rc10RelativeLuminance('#000000')).toBeCloseTo(0, 10)
    expect(rc10RelativeLuminance('not-a-colour')).toBeNull()
    expect(rc10ContrastRatio('#FFFFFF', '#000000')).toBe(21)
    expect(rc10ContrastRatio('#FFFFFF', 'nope')).toBeNull()
  })

  it('clears >= 10:1 for EVERY text token against EVERY surface it can sit on', () => {
    // Packet section 19: ">= 10:1 primaries" on a pure-black field. This is the assertion the
    // whole artifact exists for, so it is measured rather than asserted about.
    for (const token of RC10_TEXT_TOKENS) {
      for (const surface of RC10_SURFACE_TOKENS) {
        const ratio = rc10ContrastRatio(RC10_TOKENS[token], RC10_TOKENS[surface])
        expect(ratio, `${token} on ${surface}`).not.toBeNull()
        expect(ratio!, `${token} on ${surface}`).toBeGreaterThanOrEqual(RC10_MIN_TEXT_CONTRAST)
      }
    }
    // The reference measured 18.53:1 for #F6F6F6 on #080808; the exact tokens do better.
    expect(rc10ContrastRatio(RC10_TOKENS.primary, RC10_TOKENS.panel)!).toBeGreaterThan(
      RC10_REFERENCE_PRIMARY_CONTRAST
    )
    expect(rc10ContrastRatio(RC10_TOKENS.secondary, RC10_TOKENS.panel)!).toBeGreaterThan(14)
  })

  it('explains why caution and danger are NOT text tokens, with the numbers', () => {
    // Tinting an alert WORD amber or vermilion would put it under the packet's own floor for
    // exactly the driver this display exists for, so the word is `primary` and the hue is a glyph.
    expect(rc10ContrastRatio(RC10_TOKENS.caution, RC10_TOKENS.panel)!).toBeLessThan(RC10_MIN_TEXT_CONTRAST)
    expect(rc10ContrastRatio(RC10_TOKENS.danger, RC10_TOKENS.panel)!).toBeLessThan(RC10_MIN_TEXT_CONTRAST)
    expect(RC10_TEXT_TOKENS).not.toContain('caution')
    expect(RC10_TEXT_TOKENS).not.toContain('danger')
    expect(RC10_TEXT_TOKENS).not.toContain('info')
    expect(RC10_TEXT_TOKENS).not.toContain('normal')
  })

  it('clears the 3:1 non-text floor for every accent token that carries a graphic', () => {
    for (const token of ['info', 'normal', 'caution', 'danger', 'signature'] as const) {
      const ratio = rc10ContrastRatio(RC10_TOKENS[token], RC10_TOKENS.panel)
      expect(ratio!, `${token} graphic contrast`).toBeGreaterThanOrEqual(RC10_MIN_GRAPHIC_CONTRAST)
    }
  })

  it('binds no non-text token to any `color` declaration in the stylesheet', () => {
    // `border-color` / `background-color` are excluded by the leading boundary: only a true
    // `color:` declaration is collected.
    const declarations = [...CSS_DECLARATIONS.matchAll(/(?:^|[\s;{])color:\s*([^;}]+)/g)].map((match) =>
      match[1].trim()
    )
    expect(declarations.length).toBeGreaterThan(5)
    const allowed = new Set(RC10_TEXT_TOKENS.map((token) => `var(--rc10-${token})`))
    for (const declaration of declarations) {
      expect(allowed.has(declaration), `text colour ${declaration} is not a >= 10:1 token`).toBe(true)
    }
  })

  it('degrades by token rank and glyph, never by dimming: the stylesheet has no opacity', () => {
    // Normative override N5. An opacity reduction would drop an unavailable value below the
    // >= 10:1 floor and break the accessibility thesis for the exact users this artifact serves.
    expect(CSS_DECLARATIONS).not.toMatch(/(?:^|[\s;{])opacity\s*:/)
  })

  it('references caution and danger only from alert-bound rules', () => {
    const rules = [...CSS_DECLARATIONS.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    const alertRules = rules.filter(([, , body]) => /var\(--rc10-(?:caution|danger)\)/.test(body))
    expect(alertRules.length).toBeGreaterThan(0)
    for (const [, selector] of alertRules) {
      expect(selector, `${selector.trim()} may not carry an alert token`).toMatch(
        /triangle|octagon|solid/
      )
    }
  })
})

describe('RC-10 no state is distinguished by hue alone', () => {
  it('gives every rung of the severity ladder a distinct SHAPE, token and word', () => {
    expect(RC10_STATUS_LADDER.map((rung) => rung.rank)).toEqual(['none', 'normal', 'caution', 'critical'])
    // The ladder is a shape sequence FIRST and a colour sequence second: hollow ring, solid
    // circle, triangle, octagon. Strip every hue and all four ranks remain separable.
    expect(RC10_STATUS_LADDER.map((rung) => rung.shape)).toEqual(['ring', 'circle', 'triangle', 'octagon'])
    const shapes = new Set(RC10_STATUS_LADDER.map((rung) => rung.shape))
    const tokens = new Set(RC10_STATUS_LADDER.map((rung) => rung.token))
    const words = new Set(RC10_STATUS_LADDER.map((rung) => rung.word))
    expect(shapes.size).toBe(RC10_STATUS_LADDER.length)
    expect(tokens.size).toBe(RC10_STATUS_LADDER.length)
    expect(words.size).toBe(RC10_STATUS_LADDER.length)
    // The no-data rank is the only hollow one, so availability reads from fill alone too.
    expect(RC10_STATUS_LADDER.filter((rung) => !rung.filled).map((rung) => rung.rank)).toEqual(['none'])
    expect(rc10StatusRung('critical').shape).toBe('octagon')
  })

  it('gives the lap delta three non-hue cues: sign character, chevron and pattern', () => {
    const faster = rc10DeltaCue(-0.412, true)
    const slower = rc10DeltaCue(0.412, true)
    const level = rc10DeltaCue(0, true)
    const none = rc10DeltaCue(null, false)
    expect(faster).toEqual({ direction: 'faster', sign: '-', chevron: 'down', pattern: 'hatch' })
    expect(slower).toEqual({ direction: 'slower', sign: '+', chevron: 'up', pattern: 'dotted' })
    expect(level.chevron).toBe('level')
    expect(none).toEqual({ direction: 'none', sign: '', chevron: 'none', pattern: 'none' })
    // Faster and slower differ in all three non-hue channels, not merely in hue.
    expect(faster.sign).not.toBe(slower.sign)
    expect(faster.chevron).not.toBe(slower.chevron)
    expect(faster.pattern).not.toBe(slower.pattern)
    // A delta that does not exist can never imply a direction.
    expect(rc10DeltaCue(-1, false).chevron).toBe('none')
  })

  it('separates the shift ramp from the over-rev cap by fill pattern, not only by hue', () => {
    const ramping = buildRc10ShiftSegments(0.7, true, false)
    const capped = buildRc10ShiftSegments(1, true, true)
    expect(ramping.filter((segment) => segment.active).every((segment) => segment.pattern === 'striped')).toBe(
      true
    )
    expect(capped[RC10_SHIFT_RAMP_COUNT].pattern).toBe('solid')
    expect(capped[RC10_SHIFT_RAMP_COUNT].kind).toBe('cap')
    // No ramp segment is ever solid, and the cap is never striped: fill alone separates them.
    expect(capped.filter((segment) => segment.kind === 'ramp').every((segment) => segment.pattern !== 'solid')).toBe(
      true
    )
  })

  it('proves every semantically distinct display state has a distinct hue-free fingerprint', () => {
    // The fingerprint is built ONLY from shapes, counts, words, patterns, dash strings and sign
    // characters. If two states that mean different things collided here, something on this
    // display would be readable by colour alone — the one failure this artifact forbids.
    const overheatAlerts = advanceRc10Alerts(
      advanceRc10Alerts(createRc10AlertState(), alertInput({ nowMs: 0, waterTempC: 118 })),
      alertInput({ nowMs: RC10_OVERHEAT_ENGAGE_MS, waterTempC: 118 })
    )
    const fuelLowAlerts = advanceRc10Alerts(createRc10AlertState(), alertInput({ nowMs: 0, fuelLapsRemaining: 2.4 }))
    const overRev = advanceRc01Alerts(
      advanceRc01Alerts(createRc01AlertState(), { nowMs: 0, rpmRatio: 0.995, rpmFresh: true, delta: null, deltaTwoSecondsAgo: null, pitLimiter: null }),
      { nowMs: 100, rpmRatio: 0.995, rpmFresh: true, delta: null, deltaTwoSecondsAgo: null, pitLimiter: null }
    )

    const states = [
      ['silent reference', modelFor(snapshot())],
      ['faster delta', modelFor(snapshot({ deltaToBestSec: -1.2 }))],
      ['slower delta', modelFor(snapshot({ deltaToBestSec: 1.2 }))],
      ['no delta reference', modelFor(snapshot({ bestLapTimeSec: undefined }))],
      ['timing feed present', modelFor(snapshot({ position: 4 }))],
      ['fuel unknown', modelFor(snapshot({ fuelPerLapLiters: undefined }))],
      ['fuel low', modelFor(snapshot({ fuelLiters: 7.2 }), 0, { alerts: fuelLowAlerts })],
      ['overheating', modelFor(snapshot({ waterTempC: 118 }), 0, { alerts: overheatAlerts })],
      ['over-revving', modelFor(snapshot({ rpm: 7_562 }), 0, { sharedAlerts: overRev })],
      ['half shift bar', modelFor(snapshot({ rpm: 4_560 }))],
      ['blind frame', modelFor(null)]
    ] as const

    const fingerprints = new Map<string, string>()
    for (const [name, model] of states) {
      const print = rc10ColourBlindFingerprint(model)
      const clash = fingerprints.get(print)
      expect(clash, `${name} is indistinguishable from ${clash} without colour`).toBeUndefined()
      fingerprints.set(print, name)
      // A fingerprint may never contain a hex colour, a token name or a tone.
      expect(print).not.toMatch(/#[0-9a-f]{3,6}/i)
      for (const token of ['info', 'normal', 'caution', 'danger', 'signature']) {
        expect(print.includes(token), `${name} leaks the ${token} token into its hue-free view`).toBe(false)
      }
    }
    expect(fingerprints.size).toBe(states.length)
  })

  it('names every state in words for a screen reader, never in colour', () => {
    const view = render(createElement(RaceconRc10DashWidget, { snapshot: snapshot(), config: nativeConfig }))
    const labels = [...view.container.querySelectorAll('[aria-label]')].map(
      (element) => element.getAttribute('aria-label') ?? ''
    )
    expect(labels.length).toBeGreaterThan(6)
    for (const label of labels) {
      for (const hue of ['green', 'amber', 'red', 'blue', 'yellow', 'orange', 'vermilion']) {
        expect(label.toLowerCase().includes(hue), `${label} names a hue`).toBe(false)
      }
    }
    // The status cells state the rank word and the icon shape, which is the ladder in words.
    expect(labels.some((label) => label.includes('hollow') || label.includes('ring'))).toBe(true)
    expect(labels.some((label) => label.includes('circle'))).toBe(true)
  })

  it('renders every text surface with a >= 10:1 tone, in a silent frame and in an alert frame', () => {
    const silent = render(createElement(RaceconRc10DashWidget, { snapshot: snapshot(), config: nativeConfig }))
    const alerting = render(
      createElement(RaceconRc10DashWidget, {
        snapshot: snapshot({ waterTempC: 130, fuelLiters: 3, rpm: 7_580 }),
        config: config
      })
    )
    for (const view of [silent, alerting]) {
      const tones = [...view.container.querySelectorAll('[data-tone]')].map(
        (element) => element.getAttribute('data-tone') ?? ''
      )
      expect(tones.length).toBeGreaterThan(4)
      // `primary` maps to #FFFFFF and `muted` to #DDDDDD; nothing else ever carries a value.
      for (const tone of tones) expect(['primary', 'muted']).toContain(tone)
    }
  })
})

describe('RC-10 telemetry truth table', () => {
  it('renders the approved reference frame exactly as the governance chain records it', () => {
    const model = modelFor(snapshot())
    expect(model.gear.value).toBe('4')
    expect(model.speed.value).toBe('187')
    expect(model.delta.value).toBe('-0.412')
    expect(model.deltaCue.direction).toBe('faster')
    expect(model.fuel.value).toBe('8.4')
    expect(model.water.value).toBe('86')
    expect(model.tc.value).toBe('4')
    // The timing/scoring feed dropped 8 s before the frame, so Position is the packet dash.
    expect(model.position.value).toBe('--')
    expect(model.position.unavailable).toBe(true)
    // 70.0 % of maxRpm lights exactly five of the eight ramp segments; the cap stays unlit.
    expect(model.rpmRatio).toBeCloseTo(0.7, 10)
    expect(model.shiftLitRamp).toBe(5)
    expect(model.shiftSegments[RC10_SHIFT_RAMP_COUNT].active).toBe(false)
    // 8.4 laps against 2.0 laps per segment is four lit of six.
    expect(model.fuelLitSegments).toBe(4)
    // The whole alert layer is armed and silent in the reference frame.
    expect(rc10AlertLines(model)).toEqual([])
    expect(rc10EmphasisTarget(model)).toBeNull()
  })

  it('renders every packet dash state when no channel is available at all', () => {
    const model = modelFor(
      snapshot({
        gear: undefined,
        speedKmh: undefined,
        deltaToBestSec: undefined,
        bestLapTimeSec: undefined,
        fuelLiters: undefined,
        fuelPerLapLiters: undefined,
        waterTempC: undefined,
        tcLevel: undefined,
        rpm: undefined,
        maxRpm: undefined
      })
    )
    expect(model.gear.value).toBe(RC10_DASH.gear)
    expect(model.speed.value).toBe(RC10_DASH.speed)
    expect(model.delta.value).toBe(RC10_DASH.delta)
    expect(model.fuel.value).toBe(RC10_DASH.fuel)
    expect(model.position.value).toBe(RC10_DASH.position)
    expect(model.water.value).toBe(RC10_DASH.water)
    expect(model.tc.value).toBe(RC10_DASH.tc)
    for (const field of [model.gear, model.speed, model.delta, model.fuel, model.position, model.water, model.tc]) {
      expect(field.unavailable).toBe(true)
      // Normative override N5: the dash is `secondary`, never a dimmed `primary`.
      expect(field.tone).toBe('muted')
    }
    // Packet 15/16: the shift bar is blank whenever RPM is invalid, and the fuel bar is dark.
    expect(model.shiftSegments.every((segment) => !segment.active && segment.tone === 'dark')).toBe(true)
    expect(model.fuelLitSegments).toBe(0)
    // Every no-data channel takes the hollow ring, so unavailability is a shape as well as a token.
    expect(model.statusCells.map((cell) => cell.rung.shape)).toEqual(['ring', 'ring', 'ring'])
  })

  it('never derives the gear from RPM or speed and never blanks it silently', () => {
    expect(rc10DisplayGear(4)).toBe('4')
    expect(rc10DisplayGear(0)).toBe('N')
    expect(rc10DisplayGear(-1)).toBe('R')
    expect(rc10DisplayGear(null)).toBe(RC10_DASH.gear)
    const noGear = modelFor(snapshot({ gear: undefined }))
    expect(noGear.gear.value).toBe(RC10_DASH.gear)
    expect(noGear.gear.unavailable).toBe(true)
    // The other channels are untouched: a missing gear is never reconstructed from them.
    expect(noGear.speed.value).toBe('187')
    expect(noGear.shiftLitRamp).toBe(5)
    expect(rc10AuxChannelValue(snapshot({ gear: 3.5 }), 'gear')).toBeNull()
  })

  it('greys the gear past its own 50 ms budget rather than freezing it', () => {
    expect(RC10_CHANNEL_STALE_MS.gear).toBe(50)
    const value = snapshot()
    const receipts = createRc01ChannelReceipts(value, 0)
    const aux = createRc10AuxReceipts(value, 0)
    const stale = createRc10DashboardModel(value, receipts, aux, RC10_CHANNEL_STALE_MS.gear + 1)
    expect(stale.gear.value).toBe(RC10_DASH.gear)
    expect(stale.gear.stale).toBe(true)
    expect(stale.gear.tone).toBe('muted')
  })

  it('greys the speed past its 100 ms cadence and dashes it past the 500 ms budget', () => {
    expect(RC10_CHANNEL_STALE_MS.speed).toBe(100)
    expect(RC10_SPEED_DASH_MS).toBe(500)
    const value = snapshot()
    const receipts = createRc01ChannelReceipts(value, 0)
    const aux = createRc10AuxReceipts(value, 0)
    const greyed = createRc10DashboardModel(value, receipts, aux, RC10_CHANNEL_STALE_MS.speed + 1)
    expect(greyed.speed.value).toBe('187')
    expect(greyed.speed.stale).toBe(true)
    expect(greyed.speed.tone).toBe('muted')
    const dashed = createRc10DashboardModel(value, receipts, aux, RC10_SPEED_DASH_MS + 1)
    expect(dashed.speed.value).toBe(RC10_DASH.speed)
    expect(dashed.speed.unavailable).toBe(true)
    // Packet 16: never estimated from RPM x ratio, even though both are right there.
    expect(rc10AuxChannelValue(snapshot({ speedKmh: undefined }), 'speed')).toBeNull()
  })

  it('refuses a delta without a real stored reference lap and never extrapolates', () => {
    expect(rc10FormatDelta(-0.412)).toBe('-0.412')
    expect(rc10FormatDelta(0.412)).toBe('+0.412')
    expect(rc10FormatDelta(0)).toBe('+0.000')
    expect(rc10FormatDelta(null)).toBe(RC10_DASH.delta)
    expect(rc10FormatDelta(Number.NaN)).toBe(RC10_DASH.delta)
    const noReference = modelFor(snapshot({ bestLapTimeSec: undefined }))
    expect(noReference.delta.value).toBe(RC10_DASH.delta)
    expect(noReference.delta.unavailable).toBe(true)
    expect(noReference.deltaCue.direction).toBe('none')
    const noFeed = modelFor(snapshot({ deltaToBestSec: undefined }))
    expect(noFeed.delta.value).toBe(RC10_DASH.delta)
    expect(noFeed.delta.unavailable).toBe(true)
  })

  it('projects fuel laps only from a MEASURED burn rate, never before one exists', () => {
    // Packet 16: "never project laps before a measured burn rate exists".
    expect(rc10FuelLapsRemaining(snapshot())).toBeCloseTo(8.4, 6)
    expect(rc10FuelLapsRemaining(snapshot({ fuelPerLapLiters: undefined }))).toBeNull()
    expect(rc10FuelLapsRemaining(snapshot({ fuelPerLapLiters: 0 }))).toBeNull()
    expect(rc10FuelLapsRemaining(snapshot({ fuelLiters: undefined }))).toBeNull()
    // A kilogram channel is a UNIT CONVERSION, not a measured litre burn, and is refused.
    expect(
      rc10FuelLapsRemaining(
        snapshot({ fuelPerLapLiters: undefined, fuelPerLapKg: 2.2, fuelMassKg: 18 } as Partial<TelemetrySnapshot>)
      )
    ).toBeNull()
    // The provider's own projection is accepted only once a burn rate has been measured.
    expect(
      rc10FuelLapsRemaining(snapshot({ fuelLapsRemaining: 9.1 } as Partial<TelemetrySnapshot>))
    ).toBe(9.1)
    const blind = modelFor(snapshot({ fuelPerLapLiters: undefined }))
    expect(blind.fuel.value).toBe(RC10_DASH.fuel)
    expect(blind.fuel.unavailable).toBe(true)
    expect(blind.fuelLitSegments).toBe(0)
    expect(blind.fuelSegments.every((segment) => !segment.active)).toBe(true)
  })

  it('renders position as the packet integer and never infers it from gaps', () => {
    expect(modelFor(snapshot({ position: 4 })).position.value).toBe('4')
    // A timing feed that never reported cannot be reconstructed from a gap-to-ahead channel.
    const gapOnly = modelFor(
      snapshot({ relatives: { ahead: { gapSec: 1.4 } } } as unknown as Partial<TelemetrySnapshot>)
    )
    expect(gapOnly.position.value).toBe(RC10_DASH.position)
    expect(gapOnly.position.unavailable).toBe(true)
    // Packet 16: the feed's own 1 s budget, taken from the shared RC-01 channel.
    const value = snapshot({ position: 4 })
    const stale = createRc10DashboardModel(
      value,
      createRc01ChannelReceipts(value, 0),
      createRc10AuxReceipts(value, 0),
      1_001
    )
    expect(stale.position.value).toBe(RC10_DASH.position)
  })

  it('greys the water reading when its own sensor is invalid, never estimating it', () => {
    const invalid = modelFor(snapshot({ waterTempC: undefined, oilTempC: 104 }))
    expect(invalid.water.value).toBe(RC10_DASH.water)
    expect(invalid.water.unavailable).toBe(true)
    expect(invalid.water.tone).toBe('muted')
    expect(invalid.statusCells[1].rung.shape).toBe('ring')
  })

  it('holds the TC step LAST-KNOWN and greyed on a quiet bus, never dashing it', () => {
    // The one channel in packet 16 whose stale rendering is explicitly NOT a dash.
    const value = snapshot()
    const quiet = createRc10DashboardModel(
      value,
      createRc01ChannelReceipts(value, 0),
      createRc10AuxReceipts(value, 0),
      1_001
    )
    expect(quiet.tc.value).toBe('4')
    expect(quiet.tc.stale).toBe(true)
    expect(quiet.tc.unavailable).toBe(false)
    expect(quiet.tc.tone).toBe('muted')
    // It only dashes when the step was never seen at all: never assume a default TC step.
    expect(modelFor(snapshot({ tcLevel: undefined })).tc.value).toBe(RC10_DASH.tc)
  })

  it('freezes and greys the engine speed past 200 ms and blanks the bar with it', () => {
    const value = snapshot()
    const receipts = createRc01ChannelReceipts(value, 0)
    const aux = createRc10AuxReceipts(value, 0)
    const stale = createRc10DashboardModel(value, receipts, aux, 201)
    expect(stale.rpm.stale).toBe(true)
    expect(stale.rpmFresh).toBe(false)
    expect(stale.shiftSegments.every((segment) => !segment.active)).toBe(true)
    expect(stale.shiftLitRamp).toBe(0)
  })

  it('ages a channel out of the aux buffer instead of freezing on its last value', () => {
    const buffer = new Rc10AuxBuffer()
    buffer.ingest(snapshot(), 0)
    expect(buffer.receipts().get('water')?.value).toBe(86)
    // A snapshot without the channel writes no receipt, so the old one simply ages out.
    buffer.ingest(snapshot({ waterTempC: undefined }, 1_322_100), 100)
    expect(buffer.receipts().get('water')?.receivedAt).toBe(0)
    buffer.reset()
    expect(buffer.receipts().size).toBe(0)
  })
})

describe('RC-10 packet contradictions are resolved by omission, not invention', () => {
  it('documents every contradiction it deliberately does not render', () => {
    expect(Object.keys(RC10_PACKET_OMISSIONS).sort()).toEqual([
      'alertGlyphsWhileNormal',
      'appStatusRowZone',
      'gearAwareShiftScaling',
      'rpmNumeral',
      'singleColumnStack',
      'tyreTemperature'
    ])
    for (const reason of Object.values(RC10_PACKET_OMISSIONS)) {
      expect(typeof reason).toBe('string')
      expect(reason.length).toBeGreaterThan(20)
    }
  })

  it('gap G3: tyre temperature has a channel but no zone, so it is never drawn', () => {
    expect(Object.keys(RC10_CHANNEL_STALE_MS)).not.toContain('tyres')
    expect(RC10_PACKET_OMISSIONS.tyreTemperature).toContain('11.1')
    for (const corner of ['lf', 'rf', 'lr', 'rr'] as const) {
      expect(rc10TyreTemperatureC(snapshot(), corner)).toBeNull()
    }
    const withTyres = snapshot({
      tyres: { lf: { tempC: 88 }, rf: { tempC: 91 }, lr: { tempC: 84 }, rr: { tempC: 86 } }
    } as unknown as Partial<TelemetrySnapshot>)
    expect(modelFor(withTyres)).not.toHaveProperty('tyres')
    for (const cfg of [nativeConfig, config]) {
      const html = markup(withTyres, cfg)
      expect(html).not.toContain('rc10-tyre')
      expect(html).not.toContain('TYRE')
      expect(html).not.toContain('>91<')
    }
  })

  it('gap: engine RPM has a channel but no numeric zone, so no numeral is printed', () => {
    expect(RC10_PACKET_OMISSIONS.rpmNumeral).toContain('11.1')
    for (const cfg of [nativeConfig, config]) {
      const view = render(createElement(RaceconRc10DashWidget, { snapshot: snapshot(), config: cfg }))
      const text = view.container.textContent ?? ''
      expect(text).not.toContain('5320')
      expect(text).not.toContain('5,320')
      expect(text).not.toContain('7600')
      expect(text).not.toContain('RPM')
      cleanup()
    }
  })

  it('gap G4: the alert glyphs never appear while the alert layer is silent', () => {
    expect(RC10_PACKET_OMISSIONS.alertGlyphsWhileNormal).toContain('14')
    for (const cfg of [nativeConfig, config]) {
      const html = markup(snapshot(), cfg)
      expect(html).toContain('data-rc10-alerts="silent"')
      expect(html).not.toContain('data-rc10-shape="triangle"')
      expect(html).not.toContain('data-rc10-shape="octagon"')
      expect(html).not.toContain(RC10_ALERT_WORDS.fuelLow)
      expect(html).not.toContain(RC10_ALERT_WORDS.overheat)
      expect(html).not.toContain(RC10_ALERT_WORDS.overRev)
      // The neutral rank the packet never documented is what a silent frame actually draws.
      expect(html).toContain('data-rc10-shape="ring"')
      expect(html).toContain('data-rc10-shape="circle"')
    }
  })

  it('gap G2: the layout is the packet 11.1 three-row grid, not the prose single column', () => {
    expect(RC10_PACKET_OMISSIONS.singleColumnStack).toContain('11.1')
    // Two tiles share row one and two share row two: a single column could not do that.
    expect(RC10_NATIVE_ZONES.gear!.top).toBe(RC10_NATIVE_ZONES.speed!.top)
    expect(RC10_NATIVE_ZONES.delta!.top).toBe(RC10_NATIVE_ZONES.fuel!.top)
    expect(RC10_NATIVE_ZONES.speed!.left).toBeGreaterThan(right(RC10_NATIVE_ZONES.gear!))
  })

  it('gap G1: the app view carries position, water and TC rather than dropping them', () => {
    expect(RC10_PACKET_OMISSIONS.appStatusRowZone).toContain('12.1')
    expect([...RC10_APP_STATUS_CARRIAGE]).toEqual(['position', 'water', 'tc'])
    const app = markup(snapshot({ position: 4 }), config)
    expect(app).toContain('data-rc10-zone="plain"')
    expect(app).toContain(`data-rc10-carried="${RC10_APP_STATUS_CARRIAGE.join(',')}"`)
    // All three channels the section 12.1 table forgets are still on screen, with their icons.
    for (const cell of RC10_APP_STATUS_CARRIAGE) {
      expect(app).toContain(`data-rc10-cell="${cell}"`)
    }
    expect(app).toContain('POS')
    expect(app).toContain('WATER')
    expect(app).toContain('TC')
    // And the app view has no status ROW of its own, because 12.1 gives it no zone.
    expect(app).not.toContain('data-rc10-zone="status"')
  })

  it('gap: the shift ladder is gear-invariant, because the packet pins absolute thresholds', () => {
    expect(RC10_PACKET_OMISSIONS.gearAwareShiftScaling).toContain('absolute')
    const reference = buildRc10ShiftSegments(0.7, true, false).map((segment) => segment.active)
    for (const gear of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const model = modelFor(snapshot({ gear }))
      expect(model.shiftSegments.map((segment) => segment.active), `gear ${gear}`).toEqual(reference)
      expect(model.shiftLitRamp).toBe(5)
    }
  })

  it('renders no lap counter, no tyre grid, no radar and no timing tower anywhere', () => {
    const html = markup(snapshot({ currentLap: 22, position: 4 }), nativeConfig)
    for (const banned of ['LAP ', 'RADAR', 'TOWER', 'BRAKE', 'ABS', 'P04']) {
      expect(html).not.toContain(banned)
    }
  })
})

describe('RC-10 shift bar is nine segments, computed and never traced', () => {
  it('renders NINE segments — eight ramp plus one over-rev cap — per normative override N1', () => {
    expect(RC10_SHIFT_RAMP_THRESHOLDS).toEqual([0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85])
    expect(RC10_SHIFT_RAMP_COUNT).toBe(8)
    expect(RC10_SHIFT_SEGMENT_COUNT).toBe(9)
    expect(RC10_SHIFT_OVER_REV_THRESHOLD).toBe(0.99)
    const segments = buildRc10ShiftSegments(0.7, true, false)
    expect(segments).toHaveLength(9)
    // The approved reference renders EIGHT. The census across six generations was 10, 8, 9, 9, 8,
    // 10 and never stabilised, which is exactly why the count is data-driven here.
    expect(segments).not.toHaveLength(8)
    expect(segments.filter((segment) => segment.kind === 'ramp')).toHaveLength(8)
    expect(segments.filter((segment) => segment.kind === 'cap')).toHaveLength(1)
    expect(segments.map((segment) => segment.threshold)).toEqual([...RC10_SHIFT_RAMP_THRESHOLDS, null])
  })

  it('computes the lit count as count(threshold <= rpm / maxRpm) at every point on the ramp', () => {
    expect(rc10ShiftLitRampCount(0.7)).toBe(5)
    expect(rc10ShiftLitRampCount(0.49)).toBe(0)
    expect(rc10ShiftLitRampCount(0.5)).toBe(1)
    expect(rc10ShiftLitRampCount(0.849)).toBe(7)
    expect(rc10ShiftLitRampCount(0.85)).toBe(8)
    expect(rc10ShiftLitRampCount(1)).toBe(8)
    for (const [index, threshold] of RC10_SHIFT_RAMP_THRESHOLDS.entries()) {
      expect(rc10ShiftLitRampCount(threshold)).toBe(index + 1)
      expect(rc10ShiftLitRampCount(threshold - 0.001)).toBe(index)
    }
    // Packet 16: never light the bar from a guessed or stale RPM.
    expect(rc10ShiftLitRampCount(0.95, false)).toBe(0)
    expect(rc10ShiftLitRampCount(null)).toBe(0)
    expect(rc10ShiftLitRampCount(Number.NaN)).toBe(0)
    expect(rc10ShiftLitRampCount(-1)).toBe(0)
  })

  it('splits the ramp into packet 11.3"s three info steps and five normal steps', () => {
    expect(RC10_SHIFT_INFO_SEGMENTS).toBe(3)
    const full = buildRc10ShiftSegments(0.9, true, false)
    expect(full.slice(0, 3).every((segment) => segment.tone === 'info')).toBe(true)
    expect(full.slice(3, 8).every((segment) => segment.tone === 'normal')).toBe(true)
    // The reference frame lights 3 info + 2 normal at 70 %, which is what the arithmetic gives.
    const reference = buildRc10ShiftSegments(0.7, true, false).filter((segment) => segment.active)
    expect(reference.filter((segment) => segment.tone === 'info')).toHaveLength(3)
    expect(reference.filter((segment) => segment.tone === 'normal')).toHaveLength(2)
  })

  it('lights the cap ONLY while the debounced over-rev alert is latched, never as decoration', () => {
    // Packet 15's over-rev visual is a solid cap segment. It is bound to the alert, not to the
    // raw ratio, so a 60 ms spike above 99 % cannot flash it.
    expect(buildRc10ShiftSegments(1, true, false)[8].active).toBe(false)
    expect(buildRc10ShiftSegments(1, true, true)[8].active).toBe(true)
    // And a stale RPM channel can never light it, however the alert layer is latched.
    expect(buildRc10ShiftSegments(1, false, true)[8].active).toBe(false)
    expect(buildRc10ShiftSegments(1, false, true).every((segment) => !segment.active)).toBe(true)
  })

  it('goes entirely dark when the RPM channel is invalid, per packet 15 and 16', () => {
    for (const segments of [
      buildRc10ShiftSegments(null, true, false),
      buildRc10ShiftSegments(0.7, false, false),
      buildRc10ShiftSegments(Number.NaN, true, false)
    ]) {
      expect(segments).toHaveLength(9)
      expect(segments.every((segment) => !segment.active)).toBe(true)
      expect(segments.every((segment) => segment.tone === 'dark')).toBe(true)
      expect(segments.every((segment) => segment.pattern === 'none')).toBe(true)
    }
  })
})

describe('RC-10 fuel bar can never disagree with its own numeral', () => {
  it('uses the packet 16 derived geometry: six segments, 12.0 laps, 2.0 laps per segment', () => {
    expect(RC10_FUEL_SEGMENT_COUNT).toBe(6)
    expect(RC10_FUEL_FULL_SCALE_LAPS).toBe(12)
    expect(RC10_FUEL_LAPS_PER_SEGMENT).toBe(2)
    expect(buildRc10FuelSegments(8.4)).toHaveLength(6)
    expect(buildRc10FuelSegments(8.4).map((segment) => segment.fromLaps)).toEqual([0, 2, 4, 6, 8, 10])
  })

  it('reproduces the reference: 8.4 laps is four lit of six', () => {
    expect(rc10FuelLitSegments(8.4)).toBe(4)
    // Attempt-004 was rejected for showing THREE lit beside a printed 8.4. That cannot happen.
    expect(rc10FuelLitSegments(8.4)).not.toBe(3)
    const model = modelFor(snapshot())
    expect(model.fuel.value).toBe('8.4')
    expect(model.fuelLitSegments).toBe(4)
  })

  it('keeps the bar and the numeral in exact arithmetic agreement at every level', () => {
    for (let tenths = 0; tenths <= 140; tenths += 1) {
      const laps = tenths / 10
      const lit = rc10FuelLitSegments(laps)
      const printed = Number.parseFloat(rc10FormatFuelLaps(laps))
      // The printed numeral always falls inside the band the lit segment count claims.
      expect(printed, `${laps} laps`).toBeGreaterThanOrEqual(lit * RC10_FUEL_LAPS_PER_SEGMENT)
      if (lit < RC10_FUEL_SEGMENT_COUNT) {
        expect(printed, `${laps} laps`).toBeLessThan((lit + 1) * RC10_FUEL_LAPS_PER_SEGMENT)
      }
      expect(buildRc10FuelSegments(laps).filter((segment) => segment.active)).toHaveLength(lit)
    }
  })

  it('never over-states the fuel that is left, and never prints a fake projection', () => {
    expect(rc10FormatFuelLaps(8.39)).toBe('8.3')
    expect(rc10FormatFuelLaps(0)).toBe('0.0')
    expect(rc10FormatFuelLaps(null)).toBe(RC10_DASH.fuel)
    expect(rc10FormatFuelLaps(Number.NaN)).toBe(RC10_DASH.fuel)
    expect(rc10FormatFuelLaps(-1)).toBe(RC10_DASH.fuel)
    // Binary-float residue from `litres / burn` must not print 8.3 for a measured 8.4.
    expect(rc10FormatFuelLaps(25.2 / 3)).toBe('8.4')
    expect(rc10FuelLitSegments(null)).toBe(0)
    expect(rc10FuelLitSegments(20)).toBe(RC10_FUEL_SEGMENT_COUNT)
  })
})

describe('RC-10 trigger-only alerts', () => {
  it('starts silent, with no alert latched by construction', () => {
    const state = createRc10AlertState()
    expect(state.fuelLow.active).toBe(false)
    expect(state.overheat.active).toBe(false)
    expect(rc10AlertLines(modelFor(snapshot()))).toEqual([])
  })

  it('latches fuel low at or below the reserve and clears only on a full lap of hysteresis', () => {
    expect(RC10_FUEL_RESERVE_LAPS).toBe(3)
    expect(RC10_FUEL_LOW_HYSTERESIS_LAPS).toBe(1)
    let state = createRc10AlertState()
    state = advanceRc10Alerts(state, alertInput({ nowMs: 0, fuelLapsRemaining: 3.1 }))
    expect(state.fuelLow.active).toBe(false)
    state = advanceRc10Alerts(state, alertInput({ nowMs: 100, fuelLapsRemaining: RC10_FUEL_RESERVE_LAPS }))
    expect(state.fuelLow.active).toBe(true)
    // Latched: creeping back above the trigger is NOT enough to clear it.
    state = advanceRc10Alerts(state, alertInput({ nowMs: 200, fuelLapsRemaining: 3.4 }))
    expect(state.fuelLow.active).toBe(true)
    // A refuel that buys a whole lap of margin clears it.
    state = advanceRc10Alerts(state, alertInput({ nowMs: 300, fuelLapsRemaining: 4.2 }))
    expect(state.fuelLow.active).toBe(false)
  })

  it('unlatches fuel low the moment the fuel model stops publishing a projection', () => {
    let state = advanceRc10Alerts(createRc10AlertState(), alertInput({ nowMs: 0, fuelLapsRemaining: 1.2 }))
    expect(state.fuelLow.active).toBe(true)
    state = advanceRc10Alerts(state, alertInput({ nowMs: 100, fuelLapsRemaining: null }))
    expect(state.fuelLow.active).toBe(false)
  })

  it('engages overheat only above the limit for 3 s and clears at limit-2 after 5 s', () => {
    expect(RC10_OVERHEAT_LIMIT_C).toBe(105)
    expect(RC10_OVERHEAT_ENGAGE_MS).toBe(3_000)
    expect(RC10_OVERHEAT_CLEAR_MS).toBe(5_000)
    expect(RC10_OVERHEAT_CLEAR_MARGIN_C).toBe(2)
    let state = createRc10AlertState()
    state = advanceRc10Alerts(state, alertInput({ nowMs: 0, waterTempC: RC10_OVERHEAT_LIMIT_C }))
    expect(state.overheat.active).toBe(false)
    state = advanceRc10Alerts(state, alertInput({ nowMs: 0, waterTempC: 108 }))
    expect(state.overheat.active).toBe(false)
    state = advanceRc10Alerts(state, alertInput({ nowMs: RC10_OVERHEAT_ENGAGE_MS - 1, waterTempC: 108 }))
    expect(state.overheat.active).toBe(false)
    state = advanceRc10Alerts(state, alertInput({ nowMs: RC10_OVERHEAT_ENGAGE_MS, waterTempC: 108 }))
    expect(state.overheat.active).toBe(true)

    // Merely dipping under the limit does not clear it: the packet requires limit-2.
    const base = RC10_OVERHEAT_ENGAGE_MS
    state = advanceRc10Alerts(state, alertInput({ nowMs: base + 10, waterTempC: 104 }))
    state = advanceRc10Alerts(state, alertInput({ nowMs: base + RC10_OVERHEAT_CLEAR_MS + 20, waterTempC: 104 }))
    expect(state.overheat.active).toBe(true)
    // Below limit-2, but not yet for 5 s.
    state = advanceRc10Alerts(state, alertInput({ nowMs: base + 100, waterTempC: 102 }))
    expect(state.overheat.active).toBe(true)
    state = advanceRc10Alerts(state, alertInput({ nowMs: base + 100 + RC10_OVERHEAT_CLEAR_MS - 1, waterTempC: 102 }))
    expect(state.overheat.active).toBe(true)
    state = advanceRc10Alerts(state, alertInput({ nowMs: base + 100 + RC10_OVERHEAT_CLEAR_MS, waterTempC: 102 }))
    expect(state.overheat.active).toBe(false)
  })

  it('restarts the overheat debounce when the reading drops back below the limit', () => {
    let state = createRc10AlertState()
    state = advanceRc10Alerts(state, alertInput({ nowMs: 0, waterTempC: 110 }))
    state = advanceRc10Alerts(state, alertInput({ nowMs: 2_000, waterTempC: 100 }))
    state = advanceRc10Alerts(state, alertInput({ nowMs: 2_100, waterTempC: 110 }))
    state = advanceRc10Alerts(state, alertInput({ nowMs: 2_100 + RC10_OVERHEAT_ENGAGE_MS - 1, waterTempC: 110 }))
    expect(state.overheat.active).toBe(false)
    state = advanceRc10Alerts(state, alertInput({ nowMs: 2_100 + RC10_OVERHEAT_ENGAGE_MS, waterTempC: 110 }))
    expect(state.overheat.active).toBe(true)
  })

  it('unlatches overheat the moment the coolant sensor goes away', () => {
    let state = advanceRc10Alerts(
      advanceRc10Alerts(createRc10AlertState(), alertInput({ nowMs: 0, waterTempC: 120 })),
      alertInput({ nowMs: RC10_OVERHEAT_ENGAGE_MS, waterTempC: 120 })
    )
    expect(state.overheat.active).toBe(true)
    state = advanceRc10Alerts(state, alertInput({ nowMs: RC10_OVERHEAT_ENGAGE_MS + 10, waterTempC: null }))
    expect(state.overheat.active).toBe(false)
  })

  it('reuses the SHARED RC-01 over-rev, whose thresholds already are packet 15"s', () => {
    // 99 % trigger, 60 ms debounce, 95 % clear, 250 ms hysteresis — identical in both packets, so
    // duplicating the state machine would be the fork the SOP forbids.
    const step = (state: ReturnType<typeof createRc01AlertState>, nowMs: number, rpmRatio: number) =>
      advanceRc01Alerts(state, { nowMs, rpmRatio, rpmFresh: true, delta: null, deltaTwoSecondsAgo: null, pitLimiter: null })
    let shared = createRc01AlertState()
    shared = step(shared, 0, 0.995)
    expect(shared.overRev.active).toBe(false)
    shared = step(shared, 59, 0.995)
    expect(shared.overRev.active).toBe(false)
    shared = step(shared, 60, 0.995)
    expect(shared.overRev.active).toBe(true)
    shared = step(shared, 100, 0.96)
    expect(shared.overRev.active).toBe(true)
    shared = step(shared, 200, 0.94)
    expect(shared.overRev.active).toBe(true)
    shared = step(shared, 450, 0.94)
    expect(shared.overRev.active).toBe(false)
    // Only the RPM inputs are supplied by this widget, so no other RC-01 alert can engage.
    expect(shared.deltaCliff.active).toBe(false)
    expect(shared.deltaZeroCross.active).toBe(false)
    expect(shared.pitLimiter.active).toBe(false)
  })

  it('clears every alert whose input is missing, stale or refused', () => {
    const state = advanceRc10Alerts(
      advanceRc10Alerts(createRc10AlertState(), alertInput({ nowMs: 0, fuelLapsRemaining: 1.1, waterTempC: 120 })),
      alertInput({ nowMs: RC10_OVERHEAT_ENGAGE_MS, fuelLapsRemaining: 1.1, waterTempC: 120 })
    )
    expect(state.fuelLow.active).toBe(true)
    expect(state.overheat.active).toBe(true)
    const blind = modelFor(snapshot({ fuelPerLapLiters: undefined, waterTempC: undefined }))
    const cleared = clearInvalidRc10Alerts(state, blind)
    expect(cleared.fuelLow.active).toBe(false)
    expect(cleared.overheat.active).toBe(false)
  })

  it('derives every alert input from the model, gated on freshness', () => {
    const input = rc10AlertInputForModel(modelFor(snapshot()), 1_000)
    expect(input.fuelLapsRemaining).toBeCloseTo(8.4, 6)
    expect(input.waterTempC).toBe(86)
    // A stale channel cannot engage anything: the packet forbids judging a value it cannot read.
    const value = snapshot({ waterTempC: 130 })
    const stale = createRc10DashboardModel(
      value,
      createRc01ChannelReceipts(value, 0),
      createRc10AuxReceipts(value, 0),
      5_000
    )
    expect(rc10AlertInputForModel(stale, 5_000).waterTempC).toBeNull()
    expect(rc10AlertInputForModel(stale, 5_000).fuelLapsRemaining).toBeNull()
  })

  it('never prints the configured trigger thresholds: only the value and the word', () => {
    const view = render(createElement(RaceconRc10DashWidget, { snapshot: snapshot(), config: nativeConfig }))
    const text = view.container.textContent ?? ''
    expect(text).not.toContain(String(RC10_OVERHEAT_LIMIT_C))
    expect(text).not.toContain(String(RC10_FUEL_RESERVE_LAPS))
    expect(text).toContain('86')
    expect(text).toContain('8.4')
  })

  it('emphasises at most ONE tile at a time, per packet 11.5', () => {
    const fuelLow = advanceRc10Alerts(createRc10AlertState(), alertInput({ nowMs: 0, fuelLapsRemaining: 1.4 }))
    const both = advanceRc10Alerts(
      advanceRc10Alerts(fuelLow, alertInput({ nowMs: 0, fuelLapsRemaining: 1.4, waterTempC: 130 })),
      alertInput({ nowMs: RC10_OVERHEAT_ENGAGE_MS, fuelLapsRemaining: 1.4, waterTempC: 130 })
    )
    expect(rc10EmphasisTarget(modelFor(snapshot()))).toBeNull()
    expect(rc10EmphasisTarget(modelFor(snapshot({ fuelLiters: 4.2 }), 0, { alerts: fuelLow }))).toBe('fuel')
    // Two alerts at once still emphasise exactly one tile: the more severe of the two.
    const severe = modelFor(snapshot({ fuelLiters: 4.2, waterTempC: 130 }), 0, { alerts: both })
    expect(severe.alerts.fuelLow).toBe(true)
    expect(severe.alerts.overheat).toBe(true)
    expect(rc10EmphasisTarget(severe)).toBe('status')
    // The status channels move into the plain-language line at app size, and the emphasis with them.
    expect(rc10EmphasisZoneForLayout('status', 'app')).toBe('plain')
    expect(rc10EmphasisZoneForLayout('status', 'native')).toBe('status')
    expect(rc10EmphasisZoneForLayout(null, 'app')).toBeNull()
  })
})

describe('RC-10 responsive contract', () => {
  it('resolves the native, app and compact layouts from the content box', () => {
    expect(rc10LayoutForContentBox(800, 480)).toBe('native')
    expect(rc10LayoutForContentBox(801, 479)).toBe('native')
    expect(rc10LayoutForContentBox(1024, 600)).toBe('app')
    expect(rc10LayoutForContentBox(1920, 1080)).toBe('app')
    expect(rc10LayoutForContentBox(640, 520)).toBe('compact')
    expect(rc10LayoutForContentBox(0, 0)).toBe('app')
  })

  it('classifies phone and landscape compact modes', () => {
    expect(rc10CompactModeForContentBox(400, 800)).toBe('phone')
    expect(rc10CompactModeForContentBox(900, 400)).toBe('landscape')
    expect(rc10CompactModeForContentBox(640, 520)).toBe('standard')
    expect(rc10CompactModeForContentBox(1024, 600)).toBe('standard')
  })

  it('emits portrait geometry only at the phone breakpoint', () => {
    expect(rc10PhoneGeometryForContentBox(1024, 600)).toBeNull()
    expect(rc10PhoneGeometryForContentBox(900, 400)).toBeNull()
    const geometry = rc10PhoneGeometryForContentBox(400, 800)
    expect(geometry).not.toBeNull()
    expect(geometry!.inset).toBe(12)
    expect(geometry!.gearHeight).toBeGreaterThan(geometry!.statusHeight)
  })

  it('grows the tiles rather than uniformly scaling them: `legibility-grow-reveal`', () => {
    const areaPx = (rect: Rc10Rect, width: number, height: number): number =>
      ((rect.width / 100) * width) * ((rect.height / 100) * height)
    for (const zone of ['gear', 'speed', 'delta', 'fuel'] as const) {
      const native = areaPx(RC10_NATIVE_ZONES[zone]!, 800, 480)
      const app = areaPx(RC10_APP_ZONES[zone]!, 1024, 600)
      expect(app, `${zone} must be physically larger at 1024x600`).toBeGreaterThan(native)
    }
    // A uniform scale would keep every proportion; the row-two split genuinely moves instead.
    expect(RC10_APP_ZONES.fuel!.left).not.toBeCloseTo(RC10_NATIVE_ZONES.fuel!.left, 1)
    expect(RC10_APP_ZONES.delta!.width / RC10_APP_ZONES.fuel!.width).toBeLessThan(
      RC10_NATIVE_ZONES.delta!.width / RC10_NATIVE_ZONES.fuel!.width
    )
  })

  it('adds a plain-language line but never an element: five zones at both resolutions', () => {
    expect(Object.keys(RC10_NATIVE_ZONES).sort()).toEqual(['delta', 'fuel', 'gear', 'speed', 'status'])
    expect(Object.keys(RC10_APP_ZONES).sort()).toEqual(['delta', 'fuel', 'gear', 'plain', 'speed'])
    expect(allZones(RC10_APP_ZONES)).toHaveLength(allZones(RC10_NATIVE_ZONES).length)
    // The app-only line is taller than the row it replaces, because it carries a sentence too.
    expect(RC10_APP_ZONES.plain!.height).toBeGreaterThan(RC10_NATIVE_ZONES.status!.height)
    for (const mode of ['standard', 'landscape', 'phone'] as const) {
      expect(rc10ZonesForLayout('compact', mode).plain).toBeUndefined()
      expect(rc10ZonesForLayout('compact', mode).status).toBeTruthy()
    }
  })

  it('keeps all three alert surfaces present at every breakpoint', () => {
    for (const size of BREAKPOINTS) {
      const layout = rc10LayoutForContentBox(size.width, size.height)
      const mode = rc10CompactModeForContentBox(size.width, size.height)
      const zones = rc10ZonesForLayout(layout, mode)
      // over-rev lives in the gear tile, fuel low in the fuel tile, overheat in the status
      // surface — which is the strip at 800x480 and the plain-language line at 1024x600.
      expect(zones.gear).toBeTruthy()
      expect(zones.fuel).toBeTruthy()
      expect(zones.status ?? zones.plain).toBeTruthy()
    }
  })
})

describe('RC-10 rendering', () => {
  it('renders the canonical DOM contract as a three-row high-contrast display', () => {
    const html = markup(snapshot(), nativeConfig)
    assertClean(html)
    expect(html).toContain('data-widget="raceconRc10Dash"')
    expect(html).toContain('data-rc10-layout="native"')
    expect(html).toContain('data-rc10-native-size="800x480"')
    for (const zone of ['gear', 'speed', 'delta', 'fuel', 'status']) {
      expect(html).toContain(`data-rc10-zone="${zone}"`)
    }
    for (const text of ['GEAR', 'SPEED', 'KM/H', 'DELTA', 'FUEL', 'LAPS', 'POS', 'WATER', 'TC']) {
      expect(html).toContain(text)
    }
    // Packet 11.1: the shift bar lives INSIDE the gear tile, above the digit.
    const gearTile = html.slice(html.indexOf('data-rc10-zone="gear"'), html.indexOf('data-rc10-zone="speed"'))
    expect(gearTile).toContain('data-testid="rc10-shift"')
    expect(gearTile.indexOf('data-testid="rc10-shift"')).toBeLessThan(
      gearTile.indexOf('data-testid="rc10-gear-value"')
    )
  })

  it('renders the packet 11.1 zone geometry inline, never the render"s drifted rectangles', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('left:2%;top:3.3%;width:47.5%;height:45.8%')
    expect(html).toContain('left:51.5%;top:3.3%;width:46.5%;height:45.8%')
    expect(html).toContain('left:2%;top:52.5%;width:63.8%;height:25%')
    expect(html).toContain('left:67.5%;top:52.5%;width:30.5%;height:25%')
    expect(html).toContain('left:2%;top:80.8%;width:96%;height:15.8%')
    // Normative override N3: the render puts the row-two boundary at 59.5 %.
    expect(html).not.toContain('left:59.5%')
  })

  it('renders the packet 12.1 zone geometry inline at 1024x600', () => {
    const html = markup(snapshot(), config)
    expect(html).toContain('left:2.3%;top:4%;width:46.9%;height:43.3%')
    expect(html).toContain('left:51.6%;top:4%;width:46.1%;height:43.3%')
    expect(html).toContain('left:2.3%;top:50%;width:58.6%;height:25%')
    expect(html).toContain('left:63.3%;top:50%;width:34.4%;height:25%')
    expect(html).toContain('left:2.3%;top:77.7%;width:95.3%;height:18.3%')
  })

  it('renders the reference frame"s exact values and bar censuses', () => {
    const view = render(createElement(RaceconRc10DashWidget, { snapshot: snapshot(), config: nativeConfig }))
    const q = (id: string): string => view.container.querySelector(`[data-testid="${id}"]`)?.textContent ?? ''
    expect(q('rc10-gear-value')).toBe('4')
    expect(q('rc10-speed-value')).toBe('187')
    expect(q('rc10-delta-value')).toBe('-0.412')
    expect(q('rc10-fuel-value')).toBe('8.4')
    expect(q('rc10-position')).toBe('--')
    expect(q('rc10-water')).toBe('86')
    expect(q('rc10-tc')).toBe('4')

    const shift = view.container.querySelector('[data-testid="rc10-shift"]')
    expect(shift?.getAttribute('data-rc10-segments')).toBe('9')
    expect(shift?.getAttribute('data-rc10-lit')).toBe('5')
    expect(view.container.querySelectorAll('[data-testid="rc10-shift-seg"]')).toHaveLength(9)

    const fuelBar = view.container.querySelector('[data-testid="rc10-fuel-bar"]')
    expect(fuelBar?.getAttribute('data-rc10-segments')).toBe('6')
    expect(fuelBar?.getAttribute('data-rc10-lit')).toBe('4')
    expect(view.container.querySelectorAll('[data-testid="rc10-fuel-seg"]')).toHaveLength(6)

    // The reference's status row: one hollow ring for the absent timing feed, two solid circles.
    const shapes = [...view.container.querySelectorAll('[data-testid="rc10-status-cell"]')].map((cell) =>
      cell.getAttribute('data-rc10-shape')
    )
    expect(shapes).toEqual(['ring', 'circle', 'circle'])
    expect(view.container.querySelector('[data-rc10-cell="position"]')?.getAttribute('data-rc10-rank')).toBe('none')
  })

  it('carries the delta"s sign, chevron and pattern together, never the hue alone', () => {
    const faster = render(createElement(RaceconRc10DashWidget, { snapshot: snapshot(), config: nativeConfig }))
    expect(faster.container.querySelector('[data-testid="rc10-delta-value"]')?.textContent).toBe('-0.412')
    expect(faster.container.querySelector('[data-testid="rc10-delta-chevron"]')?.getAttribute('data-rc10-chevron')).toBe(
      'down'
    )
    expect(faster.container.querySelector('[data-testid="rc10-delta-pattern"]')?.getAttribute('data-rc10-pattern')).toBe(
      'hatch'
    )
    cleanup()

    const slower = render(
      createElement(RaceconRc10DashWidget, { snapshot: snapshot({ deltaToBestSec: 0.318 }), config: nativeConfig })
    )
    expect(slower.container.querySelector('[data-testid="rc10-delta-value"]')?.textContent).toBe('+0.318')
    expect(slower.container.querySelector('[data-testid="rc10-delta-chevron"]')?.getAttribute('data-rc10-chevron')).toBe(
      'up'
    )
    expect(slower.container.querySelector('[data-testid="rc10-delta-pattern"]')?.getAttribute('data-rc10-pattern')).toBe(
      'dotted'
    )
  })

  it('keeps every alert surface absent in the silent reference frame', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('data-rc10-alerts="silent"')
    expect(html).toContain('data-rc10-emphasis="none"')
    expect(html).not.toContain('is-emphasised')
    expect(html).not.toContain('data-testid="rc10-fuel-low"')
    expect(html).not.toContain('data-testid="rc10-overheat"')
    expect(html).not.toContain('data-testid="rc10-over-rev"')
    expect(html).not.toContain('data-rc10-seg-pattern="solid"')
    expect(html).not.toContain('data-rc10-rank="caution"')
    expect(html).not.toContain('data-rc10-rank="critical"')
  })

  it('reveals the plain-language line only at 1024x600, with no new channel', () => {
    const app = markup(snapshot(), config)
    expect(app).toContain('data-rc10-layout="app"')
    expect(app).toContain('data-testid="rc10-plain"')
    expect(app).toContain('FUEL OK - PUSH')
    expect(app).not.toContain('data-rc10-zone="status"')

    const native = markup(snapshot(), nativeConfig)
    expect(native).not.toContain('data-testid="rc10-plain"')
    expect(native).not.toContain('FUEL OK - PUSH')
    expect(native).toContain('data-rc10-zone="status"')
  })

  it('states the highest-severity truth in plain words', () => {
    expect(rc10PlainLanguage(modelFor(snapshot())).headline).toBe('FUEL OK - PUSH')
    expect(rc10PlainLanguage(modelFor(snapshot({ fuelPerLapLiters: undefined }))).headline).toBe(
      'FUEL UNKNOWN - NO MEASURED BURN LAP'
    )
    const fuelLow = advanceRc10Alerts(createRc10AlertState(), alertInput({ nowMs: 0, fuelLapsRemaining: 1.4 }))
    expect(rc10PlainLanguage(modelFor(snapshot({ fuelLiters: 4.2 }), 0, { alerts: fuelLow })).headline).toBe(
      'FUEL LOW - SAVE FUEL'
    )
    const hot = advanceRc10Alerts(
      advanceRc10Alerts(createRc10AlertState(), alertInput({ nowMs: 0, waterTempC: 130 })),
      alertInput({ nowMs: RC10_OVERHEAT_ENGAGE_MS, waterTempC: 130 })
    )
    expect(rc10PlainLanguage(modelFor(snapshot({ waterTempC: 130 }), 0, { alerts: hot })).headline).toBe(
      'HOT - ENGINE OVER TEMPERATURE'
    )
  })

  it('renders a clean, dash-only frame with no telemetry at all', () => {
    for (const cfg of [nativeConfig, config]) {
      const html = markup(null, cfg)
      assertClean(html)
      expect(html).toContain('data-widget="raceconRc10Dash"')
      expect(html).toContain('data-rc10-alerts="silent"')
      expect(html).toContain('data-rc10-emphasis="none"')
      expect(html).toContain('data-rc10-delta-direction="none"')
      expect(html).toContain(RC10_DASH.delta)
      expect(html).toContain('data-rc10-lit="0"')
      // Every channel takes the hollow ring, which is the ladder's own no-data rank.
      expect(html).not.toContain('data-rc10-shape="circle"')
      expect(html).toContain('data-rc10-shape="ring"')
    }
  })

  it('refuses mock and replay telemetry and raises no alert from it', () => {
    const mock = markup(snapshot({ sim: 'mock' } as Partial<TelemetrySnapshot>), nativeConfig)
    expect(mock).toContain('data-rc10-buffer-state="mock-telemetry"')
    expect(mock).toContain(RC10_DASH.delta)
    expect(mock).toContain('data-rc10-alerts="silent"')

    const replay = markup(
      snapshot({ replayContext: { state: 'replay' } } as Partial<TelemetrySnapshot>),
      nativeConfig
    )
    expect(replay).toContain('data-rc10-buffer-state="replay-telemetry"')
    expect(replay).toContain(RC10_DASH.delta)
    expect(replay).toContain('data-rc10-alerts="silent"')
  })

  it('exposes the compact mode attribute only in the compact layout', () => {
    const compact = markup(snapshot(), { ...config, position: { x: 0, y: 0, width: 640, height: 520 } })
    expect(compact).toContain('data-rc10-layout="compact"')
    expect(compact).toContain('data-rc10-compact-mode="standard"')
    expect(markup(snapshot(), nativeConfig)).not.toContain('data-rc10-compact-mode')
  })
})

describe('RC-10 shares the RC-01 fail-closed ingest buffer', () => {
  it('accepts a live identified snapshot and rejects an unidentified one', () => {
    const buffer = new Rc01LiveTelemetryBuffer()
    expect(buffer.ingest(snapshot(), 0).accepted).toBe(true)
    const orphan = new Rc01LiveTelemetryBuffer()
    const result = orphan.ingest(snapshot({ sessionUniqueId: undefined } as Partial<TelemetrySnapshot>), 0)
    expect(result.accepted).toBe(false)
  })
})

describe('RC-10 live surfaces', () => {
  /**
   * Frames are pushed at 25 Hz so the packet's tightest budget (the 50 ms gear channel) is never
   * missed between steps: a test that jumped straight to a deadline would correctly find every
   * alert disarmed by staleness rather than by its own trigger.
   */
  function mount(initial: Partial<TelemetrySnapshot> = {}, cfg = nativeConfig): {
    push: (atMs: number, overrides?: Partial<TelemetrySnapshot>) => void
    frame: (value: TelemetrySnapshot | null) => void
    root: () => HTMLElement
    view: ReturnType<typeof render>
  } {
    vi.useFakeTimers()
    let monotonicMs = 0
    let current = initial
    const monotonicClock = (): number => monotonicMs
    const view = render(
      createElement(RaceconRc10DashWidget, {
        snapshot: snapshot(initial, 1_000),
        config: cfg,
        monotonicClock
      })
    )
    const frame = (value: TelemetrySnapshot | null): void => {
      view.rerender(createElement(RaceconRc10DashWidget, { snapshot: value, config: cfg, monotonicClock }))
    }
    const push = (atMs: number, overrides?: Partial<TelemetrySnapshot>): void => {
      if (overrides) current = { ...current, ...overrides }
      if (atMs <= monotonicMs) {
        frame(snapshot(current, 1_000 + monotonicMs))
        return
      }
      while (monotonicMs < atMs) {
        const step = Math.min(40, atMs - monotonicMs)
        monotonicMs += step
        act(() => {
          vi.advanceTimersByTime(step)
        })
        frame(snapshot(current, 1_000 + monotonicMs))
      }
    }
    return { push, frame, root: () => view.container.querySelector<HTMLElement>('.rc10-widget')!, view }
  }

  it('reproduces the approved reference frame with every alert armed and silent', () => {
    const { root, view } = mount()
    const q = (id: string): string => view.container.querySelector(`[data-testid="${id}"]`)?.textContent ?? ''
    expect(q('rc10-gear-value')).toBe('4')
    expect(q('rc10-speed-value')).toBe('187')
    expect(q('rc10-delta-value')).toBe('-0.412')
    expect(q('rc10-fuel-value')).toBe('8.4')
    expect(q('rc10-position')).toBe('--')
    expect(q('rc10-water')).toBe('86')
    expect(q('rc10-tc')).toBe('4')
    expect(root().dataset.rc10Alerts).toBe('silent')
    expect(root().dataset.rc10Emphasis).toBe('none')
    expect(root().dataset.rc10DeltaDirection).toBe('faster')
  })

  it('latches the fuel-low triangle and word, and clears it only after a real refuel', () => {
    const { push, root, view } = mount({ fuelLiters: 7.2 })
    // Fuel low is latched, not debounced: 2.4 laps against a 3.0-lap reserve is immediate.
    expect(root().dataset.rc10Alerts).toBe('active')
    expect(root().dataset.rc10AlertKeys).toContain(RC10_ALERT_WORDS.fuelLow)
    expect(view.container.querySelector('[data-testid="rc10-fuel-low"]')?.textContent).toBe(
      RC10_ALERT_WORDS.fuelLow
    )
    expect(view.container.querySelector('[data-testid="rc10-fuel"]')?.getAttribute('data-rc10-emphasised')).toBe(
      'true'
    )
    // The triangle rank appears in the fuel tile and nowhere else.
    const fuelTile = view.container.querySelector('[data-testid="rc10-fuel"]')!
    expect(fuelTile.querySelector('[data-rc10-shape="triangle"]')).not.toBeNull()
    // The numeral and the bar still agree: 2.4 laps is one lit segment of six.
    expect(view.container.querySelector('[data-testid="rc10-fuel-value"]')?.textContent).toBe('2.4')
    expect(view.container.querySelector('[data-testid="rc10-fuel-bar"]')?.getAttribute('data-rc10-lit')).toBe('1')
    // Creeping back over the trigger is not enough; a whole lap of margin is.
    push(200, { fuelLiters: 10.2 })
    expect(root().dataset.rc10Alerts).toBe('active')
    push(400, { fuelLiters: 15 })
    expect(root().dataset.rc10Alerts).toBe('silent')
    expect(view.container.querySelector('[data-testid="rc10-fuel-low"]')).toBeNull()
  })

  it('engages the overheat octagon and word only after 3 s, and de-escalates on recovery', () => {
    const { push, root, view } = mount({ waterTempC: 112 })
    push(RC10_OVERHEAT_ENGAGE_MS - 200)
    expect(root().dataset.rc10Alerts).toBe('silent')
    expect(view.container.querySelector('[data-testid="rc10-overheat"]')).toBeNull()
    push(RC10_OVERHEAT_ENGAGE_MS + 200)
    expect(root().dataset.rc10Alerts).toBe('active')
    expect(view.container.querySelector('[data-testid="rc10-overheat"]')?.textContent).toBe(
      RC10_ALERT_WORDS.overheat
    )
    // The critical rank is an OCTAGON on the water cell, and only on the water cell.
    expect(view.container.querySelector('[data-rc10-cell="water"]')?.getAttribute('data-rc10-shape')).toBe('octagon')
    expect(view.container.querySelector('[data-rc10-cell="tc"]')?.getAttribute('data-rc10-shape')).toBe('circle')
    expect(root().dataset.rc10Emphasis).toBe('status')
    // Below limit-2 for a full 5 s clears it.
    push(RC10_OVERHEAT_ENGAGE_MS + 400, { waterTempC: 96 })
    expect(root().dataset.rc10Alerts).toBe('active')
    push(RC10_OVERHEAT_ENGAGE_MS + RC10_OVERHEAT_CLEAR_MS + 800)
    expect(root().dataset.rc10Alerts).toBe('silent')
    expect(view.container.querySelector('[data-rc10-cell="water"]')?.getAttribute('data-rc10-shape')).toBe('circle')
  })

  it('lights the solid over-rev cap only after the shared 60 ms debounce', () => {
    const { push, root, view } = mount({ rpm: 7_580 })
    const cap = (): Element | null =>
      view.container.querySelector('[data-rc10-seg-kind="cap"][data-rc10-seg-pattern="solid"]')
    expect(root().dataset.rc10Alerts).toBe('silent')
    expect(cap()).toBeNull()
    push(200)
    expect(root().dataset.rc10Alerts).toBe('active')
    expect(root().dataset.rc10AlertKeys).toContain(RC10_ALERT_WORDS.overRev)
    expect(cap()).not.toBeNull()
    expect(view.container.querySelector('[data-testid="rc10-over-rev"]')?.textContent).toBe(
      RC10_ALERT_WORDS.overRev
    )
    expect(root().dataset.rc10Emphasis).toBe('gear')
    // The ramp is fully lit, so the bar reads by count as well as by the solid cap.
    expect(view.container.querySelector('[data-testid="rc10-shift"]')?.getAttribute('data-rc10-lit')).toBe('8')
    // Below 95 % for 250 ms clears it.
    push(700, { rpm: 7_100 })
    expect(root().dataset.rc10Alerts).toBe('silent')
    expect(cap()).toBeNull()
  })

  it('blanks the shift bar rather than freezing it when the RPM channel falls silent', () => {
    const { push, frame, view } = mount()
    push(120)
    expect(view.container.querySelector('[data-testid="rc10-shift"]')?.getAttribute('data-rc10-lit')).toBe('5')
    // The provider keeps publishing, but without the engine-speed channel.
    frame(snapshot({ rpm: undefined, maxRpm: undefined }, 2_000))
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(view.container.querySelector('[data-testid="rc10-shift"]')?.getAttribute('data-rc10-lit')).toBe('0')
    expect(view.container.querySelectorAll('[data-rc10-seg-tone="dark"]')).toHaveLength(9)
  })

  it('degrades the speed to its dash instead of freezing when the source goes quiet', () => {
    const { push, frame, view } = mount()
    push(80)
    expect(view.container.querySelector('[data-testid="rc10-speed-value"]')?.textContent).toBe('187')
    frame(snapshot({ speedKmh: undefined }, 2_000))
    act(() => {
      vi.advanceTimersByTime(RC10_SPEED_DASH_MS + 200)
    })
    expect(view.container.querySelector('[data-testid="rc10-speed-value"]')?.textContent).toBe(RC10_DASH.speed)
  })

  it('drops every latched alert when the source is refused mid-stint', () => {
    const { frame, root, view } = mount({ waterTempC: 130, fuelLiters: 4.2 })
    expect(root().dataset.rc10Alerts).toBe('active')
    frame(snapshot({ sim: 'mock' } as Partial<TelemetrySnapshot>, 2_000))
    expect(root().dataset.rc10BufferState).toBe('mock-telemetry')
    expect(root().dataset.rc10Alerts).toBe('silent')
    expect(root().dataset.rc10Emphasis).toBe('none')
    expect(view.container.querySelector('[data-testid="rc10-fuel-low"]')).toBeNull()
    // Every channel falls back to its dash and its hollow ring, not to a stale number.
    expect(view.container.querySelector('[data-testid="rc10-fuel-value"]')?.textContent).toBe(RC10_DASH.fuel)
    expect([...view.container.querySelectorAll('[data-testid="rc10-status-cell"]')].map((cell) =>
      cell.getAttribute('data-rc10-shape')
    )).toEqual(['ring', 'ring', 'ring'])
  })

  it('carries position, water and TC into the app view when the timing feed returns', () => {
    const { view } = mount({ position: 4 }, config)
    expect(view.container.querySelector('[data-testid="rc10-plain-headline"]')?.textContent).toBe('FUEL OK - PUSH')
    expect(view.container.querySelector('[data-testid="rc10-position"]')?.textContent).toBe('4')
    expect(view.container.querySelector('[data-rc10-cell="position"]')?.getAttribute('data-rc10-shape')).toBe(
      'circle'
    )
    expect(view.container.querySelector('[data-testid="rc10-water"]')?.textContent).toBe('86')
    expect(view.container.querySelector('[data-testid="rc10-tc"]')?.textContent).toBe('4')
  })
})





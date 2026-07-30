// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOverlayStyle, type OverlayWidgetConfig } from '../../../../shared/overlays'
import type { EngineWarnings, TelemetrySnapshot } from '../../../../shared/telemetry'
import { OVERLAY_DASHBOARD_PRESETS } from '../../../../shared/dashboards'
import { WIDGET_COMPONENTS } from './index'
import type { WidgetProps } from './types'
import { RACECON_DISPLAY_CLOCK_INTERVAL_MS, raceconDisplayClockFrozen } from './raceconDisplayClock'
import { RaceconRc14DashWidget } from './RaceconRc14DashWidget'
import {
  Rc01LiveTelemetryBuffer,
  type Rc01ChannelReceipt,
  type Rc01MonotonicClock
} from './raceconRc01Core'
import {
  RC14_ALERT_ENGAGE_MS,
  RC14_ALERT_LATCHED_UNTIL_ACK,
  RC14_ALERT_TOKENS,
  RC14_APP_FAULT_ROWS,
  RC14_APP_HEIGHT_PX,
  RC14_APP_ONLY_MODULES,
  RC14_APP_TYPE_SCALE,
  RC14_APP_WIDTH_PX,
  RC14_APP_ZONES_PX,
  RC14_CHANNEL_STALE_MS,
  RC14_COMPACT_TYPE_MAX_HEIGHT_PX,
  RC14_CORNERS,
  RC14_CQW_PX,
  RC14_DASH,
  RC14_FAULT_SOURCES,
  RC14_INFO_RETUNE,
  RC14_NATIVE_FAULT_ROWS,
  RC14_NATIVE_HEIGHT_PX,
  RC14_NATIVE_WIDTH_PX,
  RC14_NATIVE_ZONES_PX,
  RC14_NO_FAULT_SOURCE_NOTICE,
  RC14_NO_ZONE_NOTICE,
  RC14_PACKET_OMISSIONS,
  RC14_REGISTRATION,
  RC14_SEVERITY_CHIP,
  RC14_SEVERITY_PATTERN,
  RC14_SEVERITY_TOKEN,
  RC14_SILHOUETTE_ZONES,
  RC14_SYSTEMS,
  RC14_TOKENS,
  RC14_TYPE_SCALE_PX,
  RC14_UNMONITORED_NOTICE,
  RC14_UNMONITORED_PATTERN,
  RC14_UNMONITORED_TOKEN,
  RC14_VITAL_IDS,
  RC14_VITAL_RANGE,
  RC14_VITAL_SCALE,
  type Rc14AlertState,
  Rc14AuxBuffer,
  type Rc14Channel,
  type Rc14DashboardModel,
  type Rc14Layout,
  type Rc14Rect,
  type Rc14ZoneMap,
  acknowledgeRc14Fault,
  advanceRc14Alerts,
  clearInvalidRc14Alerts,
  createRc14AlertState,
  createRc14AuxReceipts,
  createRc14DashboardModel,
  rc14AlertActive,
  rc14AlertInputForSnapshot,
  rc14ChannelValue,
  rc14CompactModeForContentBox,
  rc14DeltaToBestSec,
  rc14FaultRowPitchPx,
  rc14FaultSourceAvailable,
  rc14FaultSourceRaw,
  rc14HeroFitsZone,
  rc14LayoutForContentBox,
  rc14RectPercent,
  rc14RectsOverlap,
  rc14SpeedKmh,
  rc14TypeScaleCqw,
  rc14TypeScalePxForWidth,
  rc14VitalFill,
  rc14VitalOutOfRange,
  rc14ZoneDamagePct,
  rc14ZoneStyle,
  rc14ZonesForLayout
} from './raceconRc14Core'

/**
 * `raceconRc14Dash` is not yet a member of the `OverlayWidgetId` union: that union lives in
 * `src/shared/overlays.ts`, a shared registration file this delivery deliberately does not touch.
 * The separate catalog wiring PR adds it. The cast records the dependency rather than hiding it.
 */
const config: OverlayWidgetConfig = {
  id: RC14_REGISTRATION.widgetId as OverlayWidgetConfig['id'],
  enabled: true,
  locked: true,
  favorite: false,
  position: { x: 0, y: 0, width: RC14_APP_WIDTH_PX, height: RC14_APP_HEIGHT_PX },
  opacity: 100,
  stylePreset: 'minimal',
  style: createDefaultOverlayStyle(),
  display: null
}

const nativeConfig: OverlayWidgetConfig = {
  ...config,
  position: { x: 0, y: 0, width: RC14_NATIVE_WIDTH_PX, height: RC14_NATIVE_HEIGHT_PX }
}

/**
 * The stylesheet is read as TEXT, not as a loaded module, because four of RC-14's guarantees are
 * properties of the source itself: the alert tokens may only be referenced inside a severity-scoped
 * rule, `normal` may never colour an unmonitored zone, `info` is bound to the gauge fill alone, and
 * every rule that sets `white-space: nowrap` alongside a `font-size` must bound that size with a
 * `clamp()` carrying a px maximum. Vitest's root is `app-v2`.
 */
const CSS_PATH = 'src/renderer/src/overlay/widgets/raceconRc14.css'
const WIDGET_PATH = 'src/renderer/src/overlay/widgets/RaceconRc14DashWidget.tsx'
const CORE_PATH = 'src/renderer/src/overlay/widgets/raceconRc14Core.ts'

const CSS_SOURCE = readFileSync(resolve(process.cwd(), CSS_PATH), 'utf8')
const WIDGET_SOURCE = readFileSync(resolve(process.cwd(), WIDGET_PATH), 'utf8')
const CORE_SOURCE = readFileSync(resolve(process.cwd(), CORE_PATH), 'utf8')

/**
 * The TypeScript sources with their comments stripped. The comments deliberately NAME the shared
 * registration symbols this delivery must not touch, the `preview` prop the shared display-clock fix
 * will add, and the `scrollWidth` trap this build avoids — so every source rule below is asserted
 * against the declarations alone, never against the prose.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const WIDGET_CODE = stripComments(WIDGET_SOURCE)
const CORE_CODE = stripComments(CORE_SOURCE)

/**
 * The stylesheet with its comments stripped. The comments deliberately NAME the forbidden bindings,
 * so every rule below is asserted against the declarations alone, never against the prose.
 */
const CSS_DECLARATIONS = CSS_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')

function cssRules(): { selector: string; body: string }[] {
  const rules: { selector: string; body: string }[] = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match = pattern.exec(CSS_DECLARATIONS)
  while (match) {
    rules.push({ selector: match[1].trim(), body: match[2] })
    match = pattern.exec(CSS_DECLARATIONS)
  }
  return rules
}

function rulesReferencing(token: string): { selector: string; body: string }[] {
  return cssRules().filter((rule) => rule.body.includes(`var(--rc14-${token})`))
}

const ALL_CLEAR: EngineWarnings = {
  waterTemp: false,
  fuelPressure: false,
  oilPressure: false,
  oilTemp: false,
  stalled: false,
  pitLimiter: false,
  revLimiter: false,
  mandRepair: false,
  optRepair: false
}

/**
 * The approved RC-14 reference state, attempt-003 governed 800x480. Oil pressure 4.4 bar, water
 * 78 degC, battery 14.2 V, oil temperature DASHED because its sensor is invalid, brake temperatures
 * LF 478 / RF 461 / LR 392 with NO sensor at RR, and tyre pressures LF 1.92 / RF 1.95 / RR 1.86 bar
 * with NO TPMS at LR. Every engine tell-tale is clear and no repair is outstanding, so the frame is
 * the packet's NORMAL display state: all three alerts armed and silent, decision CONTINUE.
 *
 * The frame's GEARBOX CRITICAL, FRONT AERO MAJOR and CORNER LF MINOR are NOT reproducible: the app
 * carries no per-zone damage channel at all. Those zones render unmonitored — see
 * `RC14_PACKET_OMISSIONS.perZoneDamageChannel`.
 */
function snapshot(overrides: Partial<TelemetrySnapshot> = {}, timestamp = 1_411_000): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp,
    sessionUniqueId: 41,
    speedKmh: 0,
    rpm: 900,
    gear: 0,
    oilPressureKpa: 440,
    waterTempC: 78,
    voltage: 14.2,
    engineWarnings: { ...ALL_CLEAR },
    pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: true, inPitStall: false },
    brakeTempC: { lf: 478, rf: 461, lr: 392, rr: Number.NaN },
    tyres: {
      lf: { pressureKpa: 192 },
      rf: { pressureKpa: 195 },
      lr: {},
      rr: { pressureKpa: 186 }
    },
    sessionType: 'Race',
    ...overrides
  } as TelemetrySnapshot
}

function withWarnings(overrides: Partial<EngineWarnings>, rest: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return snapshot({ engineWarnings: { ...ALL_CLEAR, ...overrides }, ...rest })
}

/** A frame with no fault channel and no vital of any kind: the honest zero-source state. */
function sourcelessSnapshot(): TelemetrySnapshot {
  return snapshot({
    engineWarnings: undefined,
    pit: undefined,
    flags: undefined,
    repairTimeSec: undefined,
    optionalRepairTimeSec: undefined,
    oilPressureKpa: undefined,
    waterTempC: undefined,
    voltage: undefined,
    oilTempC: undefined
  })
}

const EMPTY_RECEIPTS: ReadonlyMap<Rc14Channel, Rc01ChannelReceipt> = new Map()

function receiptsFor(value: TelemetrySnapshot | null, atMs: number): ReadonlyMap<Rc14Channel, Rc01ChannelReceipt> {
  return value ? createRc14AuxReceipts(value, atMs) : EMPTY_RECEIPTS
}

function modelFor(
  value: TelemetrySnapshot | null,
  nowMs = 0,
  options: Parameters<typeof createRc14DashboardModel>[3] = {},
  receiptsAtMs = nowMs
): Rc14DashboardModel {
  return createRc14DashboardModel(value, receiptsFor(value, receiptsAtMs), nowMs, options)
}

/**
 * Advance the alert layer across a run of frames, writing each frame's receipts at the same instant
 * it is evaluated. That is what a live stream genuinely does, and it keeps the freshness budget out
 * of the way of the debounce being measured.
 */
function alertsOver(
  value: TelemetrySnapshot | null,
  times: readonly number[],
  initial: Rc14AlertState = createRc14AlertState()
): Rc14AlertState {
  let state = initial
  for (const atMs of times) {
    state = advanceRc14Alerts(state, rc14AlertInputForSnapshot(value, receiptsFor(value, atMs), atMs))
  }
  return state
}

function markup(value: TelemetrySnapshot | null, cfg = config): string {
  return renderToStaticMarkup(createElement(RaceconRc14DashWidget, { snapshot: value, config: cfg }))
}

function assertClean(value: string): void {
  expect(value).not.toContain('\uFFFD')
  expect(value).not.toContain('NaN')
  expect(value).not.toContain('undefined')
  expect(value).not.toContain('[object Object]')
}

function right(rect: Rc14Rect): number {
  return rect.left + rect.width
}

function bottom(rect: Rc14Rect): number {
  return rect.top + rect.height
}

function allZones(zones: Rc14ZoneMap): Rc14Rect[] {
  return Object.values(zones).filter((rect): rect is Rc14Rect => Boolean(rect))
}

const BREAKPOINTS: readonly { width: number; height: number }[] = [
  { width: 800, height: 480 },
  { width: 1024, height: 600 },
  { width: 1920, height: 1080 },
  { width: 400, height: 800 },
  { width: 900, height: 400 },
  { width: 640, height: 520 }
]

/** The rendered px size of a ladder rung on a canvas, honouring the stylesheet's clamp maximum. */
function renderedTypePx(rung: number, canvasWidthPx: number, clampMaxPx: number): number {
  return Math.min(rc14TypeScalePxForWidth(rung, canvasWidthPx), clampMaxPx)
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('RC-14 registration was applied by the separate catalog wiring PR', () => {
  it('publishes the exact registration facts the wiring PR must apply', () => {
    expect(RC14_REGISTRATION.widgetId).toBe('raceconRc14Dash')
    expect(RC14_REGISTRATION.presetId).toBe('racecon_rc14_dash')
    expect(RC14_REGISTRATION.catalogVariantId).toBe('dash-racecon_rc14_dash')
    expect(RC14_REGISTRATION.name).toBe('RaceCon RC-14 Triage')
    expect(RC14_REGISTRATION.scaleMode).toBe('stretch')
    expect(RC14_REGISTRATION.embedFamily).toBe('racecon')
    expect(RC14_REGISTRATION.tags).toContain('racecon')
    expect(RC14_REGISTRATION.tags).toContain('health')
    expect(RC14_REGISTRATION.tags).toContain('triage')
    // Full-frame dashboards are excluded from the floating-overlay picker on purpose.
    expect(RC14_REGISTRATION.pickableOverlay).toBe(false)
    // RC-14 reflows rather than being transform-resampled, and it refuses mock/replay telemetry.
    expect(RC14_REGISTRATION.responsiveFullFrame).toBe(true)
    expect(RC14_REGISTRATION.identityScoped).toBe(true)
  })

  it('binds the component to its canonical id in the DOM, matching the registry', () => {
    expect(markup(snapshot())).toContain(`data-widget="${RC14_REGISTRATION.widgetId}"`)
  })

  it('agrees with the shared registry and preset table now that the wiring PR has landed', () => {
    // Was permissive (`if (registered)` / `if (preset)`) so it could pass on the core-only branch.
    // The wiring PR has landed, so the entries must exist and match — asserted unconditionally.
    expect(WIDGET_COMPONENTS[RC14_REGISTRATION.widgetId]).toBe(RaceconRc14DashWidget)

    const preset = OVERLAY_DASHBOARD_PRESETS.find((entry) => entry.id === RC14_REGISTRATION.presetId)
    expect(preset).toBeDefined()
    expect(preset!.widgetId).toBe(RC14_REGISTRATION.widgetId)
    expect(preset!.name).toBe(RC14_REGISTRATION.name)
    expect(preset!.scaleMode).toBe(RC14_REGISTRATION.scaleMode)
    expect(preset!.description).toBe(RC14_REGISTRATION.description)
    expect(OVERLAY_DASHBOARD_PRESETS.filter((entry) => entry.id === RC14_REGISTRATION.presetId)).toHaveLength(1)
  })

  it('touches no shared registration file from inside this artifact', () => {
    for (const source of [WIDGET_CODE, CORE_CODE]) {
      expect(source).not.toContain('OVERLAY_WIDGETS')
      expect(source).not.toContain('WIDGET_COMPONENTS')
      expect(source).not.toContain('RESPONSIVE_FULL_FRAME_WIDGET_IDS')
      expect(source).not.toContain('IDENTITY_SCOPED_WIDGET_IDS')
      expect(source).not.toContain('OVERLAY_DASHBOARD_PRESETS')
    }
  })
})

describe('RC-14 packet omissions are contractual, not accidental', () => {
  it('records every contradiction resolved by omission or by a declared override', () => {
    expect(Object.keys(RC14_PACKET_OMISSIONS).sort()).toEqual([
      'acknowledgeControlZone',
      'cornerStatusTypeSize',
      'decisionWithoutAnyFaultSource',
      'headerFooterBands',
      'infoSignatureSeparability',
      'oilTempBarScale',
      'operatingLampsAreNotFaults',
      'perZoneDamageChannel',
      'severityHueRamp',
      'speedAndDeltaZones',
      'staleAcceptanceBoilerplate',
      'systemsDetailPanel',
      'unmonitoredVersusOk',
      'vitalRangeThresholds'
    ])
    for (const reason of Object.values(RC14_PACKET_OMISSIONS)) {
      expect(typeof reason).toBe('string')
      expect(reason.length).toBeGreaterThan(60)
    }
  })

  it('measures the missing speed and delta zones rather than asserting a comment', () => {
    const rich = snapshot({ speedKmh: 214, deltaToBestSec: -0.184, bestLapTimeSec: 91.6 })
    expect(rc14SpeedKmh(rich)).toBeNull()
    expect(rc14DeltaToBestSec(rich)).toBeNull()
    const html = markup(rich)
    expect(html).not.toMatch(/\bSPEED\b/u)
    expect(html).not.toMatch(/\bDELTA\b/u)
    expect(html).not.toContain('214')
    expect(html).not.toContain('0.184')
    expect(html).not.toContain('-.---')
  })

  it('measures the missing per-zone damage channel, so no zone can be tinted from a location', () => {
    const damaged = snapshot({ damagePct: 0.42, flags: { meatball: true } as TelemetrySnapshot['flags'] })
    for (const zone of RC14_SILHOUETTE_ZONES) {
      expect(rc14ZoneDamagePct(damaged, zone.id)).toBeNull()
    }
    // The whole-car repair state is still published — as a CHASSIS row with NO silhouette zone.
    const chassis = RC14_SYSTEMS.find((system) => system.id === 'chassis')
    expect(chassis?.zone).toBeNull()
  })

  it('never treats an operating lamp as a fault', () => {
    const limiter = withWarnings({ pitLimiter: true, revLimiter: true })
    const model = modelFor(limiter)
    expect(model.systems.every((row) => row.severity === 'ok')).toBe(true)
    expect(model.decision.word).toBe('CONTINUE')
    expect(RC14_FAULT_SOURCES.map((source) => source.id)).not.toContain('enginePitLimiterLamp')
    expect(CORE_SOURCE).not.toMatch(/warnings\?\.(?:revLimiter|pitLimiter)\s*===\s*true/u)
  })

  it('builds no systems-detail panel and no macro acknowledge rectangle', () => {
    const html = markup(snapshot())
    expect(html).not.toContain('data-rc14-zone="systemsDetail"')
    expect(html).not.toContain('data-rc14-zone="acknowledge"')
    expect(Object.keys(RC14_APP_ZONES_PX).sort()).toEqual([
      'carSilhouette',
      'decisionCorners',
      'faultList',
      'faultTimeline',
      'vitalsColumn'
    ])
  })
})

describe('RC-14 packet zone geometry', () => {
  it('reproduces packet 11.1 verbatim rather than tracing the render', () => {
    expect(RC14_NATIVE_ZONES_PX).toEqual({
      faultList: { x: 16, y: 50, width: 208, height: 380 },
      carSilhouette: { x: 240, y: 50, width: 320, height: 300 },
      vitalsColumn: { x: 576, y: 50, width: 208, height: 300 },
      decisionBanner: { x: 240, y: 360, width: 320, height: 70 },
      cornerStatus: { x: 576, y: 360, width: 208, height: 70 }
    })
  })

  it('publishes the packet 11.1 origin and size percentages the brief tabulates', () => {
    const zones = rc14ZonesForLayout('native')
    expect(zones.faultList).toEqual({ left: 2, top: 10.416667, width: 26, height: 79.166667 })
    expect(zones.carSilhouette).toEqual({ left: 30, top: 10.416667, width: 40, height: 62.5 })
    expect(zones.vitalsColumn).toEqual({ left: 72, top: 10.416667, width: 26, height: 62.5 })
    expect(zones.decisionBanner).toEqual({ left: 30, top: 75, width: 40, height: 14.583333 })
    expect(zones.cornerStatus).toEqual({ left: 72, top: 75, width: 26, height: 14.583333 })
  })

  it('reproduces packet 12.1 verbatim and expands rather than scaling', () => {
    expect(RC14_APP_ZONES_PX).toEqual({
      faultList: { x: 24, y: 60, width: 300, height: 480 },
      carSilhouette: { x: 352, y: 60, width: 320, height: 340 },
      vitalsColumn: { x: 700, y: 60, width: 300, height: 300 },
      faultTimeline: { x: 352, y: 420, width: 320, height: 120 },
      decisionCorners: { x: 700, y: 372, width: 300, height: 168 }
    })
    // The silhouette keeps its 320 px width and gains 40 px of HEIGHT only, the fault timeline is
    // new, and the decision banner MOVES out of the centre. None of that is a uniform scale.
    expect(RC14_APP_ZONES_PX.carSilhouette?.width).toBe(RC14_NATIVE_ZONES_PX.carSilhouette?.width)
    expect(RC14_APP_ZONES_PX.carSilhouette?.height).toBe(
      (RC14_NATIVE_ZONES_PX.carSilhouette?.height ?? 0) + 40
    )
    expect(RC14_NATIVE_ZONES_PX.faultTimeline).toBeUndefined()
    expect(RC14_NATIVE_ZONES_PX.decisionCorners).toBeUndefined()
    expect(RC14_APP_ZONES_PX.decisionBanner).toBeUndefined()
    expect(RC14_APP_ZONES_PX.cornerStatus).toBeUndefined()
    const uniform = RC14_APP_WIDTH_PX / RC14_NATIVE_WIDTH_PX
    expect((RC14_APP_ZONES_PX.faultList?.width ?? 0) / (RC14_NATIVE_ZONES_PX.faultList?.width ?? 1)).not.toBeCloseTo(
      uniform,
      3
    )
  })

  it('publishes the packet 12.1 percentages the brief tabulates', () => {
    const zones = rc14ZonesForLayout('app')
    expect(zones.faultList).toEqual({ left: 2.34375, top: 10, width: 29.296875, height: 80 })
    expect(zones.carSilhouette).toEqual({ left: 34.375, top: 10, width: 31.25, height: 56.666667 })
    expect(zones.vitalsColumn).toEqual({ left: 68.359375, top: 10, width: 29.296875, height: 50 })
    expect(zones.faultTimeline).toEqual({ left: 34.375, top: 70, width: 31.25, height: 20 })
    expect(zones.decisionCorners).toEqual({ left: 68.359375, top: 62, width: 29.296875, height: 28 })
  })

  it('keeps every zone inside the canvas and never overlaps two zones, at every breakpoint', () => {
    for (const box of BREAKPOINTS) {
      const layout = rc14LayoutForContentBox(box.width, box.height)
      const mode = rc14CompactModeForContentBox(box.width, box.height)
      const rects = allZones(rc14ZonesForLayout(layout, mode, box))
      expect(rects.length).toBeGreaterThanOrEqual(5)
      for (const rect of rects) {
        expect(rect.left).toBeGreaterThanOrEqual(0)
        expect(rect.top).toBeGreaterThanOrEqual(0)
        expect(right(rect)).toBeLessThanOrEqual(100.0001)
        expect(bottom(rect)).toBeLessThanOrEqual(100.0001)
      }
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          expect(rc14RectsOverlap(rects[i], rects[j])).toBe(false)
        }
      }
    }
  })

  it('emits zone geometry as inline percentages without binary-float noise', () => {
    const zones = rc14ZonesForLayout('native')
    expect(rc14ZoneStyle(zones.faultList)).toEqual({
      left: '2%',
      top: '10.417%',
      width: '26%',
      height: '79.167%'
    })
    expect(rc14ZoneStyle(undefined)).toBeNull()
    expect(markup(snapshot(), nativeConfig)).toContain('left:2%')
  })

  it('computes the fault-list row pitch and never traces it', () => {
    // Normative override N3: 380 / 6 = 63.333 px exactly, every row identical.
    expect(rc14FaultRowPitchPx(RC14_NATIVE_ZONES_PX.faultList?.height ?? 0, RC14_NATIVE_FAULT_ROWS)).toBe(63.333)
    expect(rc14FaultRowPitchPx(RC14_APP_ZONES_PX.faultList?.height ?? 0, RC14_APP_FAULT_ROWS)).toBe(60)
    expect(rc14FaultRowPitchPx(380, 0)).toBe(0)
    // The stylesheet lays the list out as uniform 1fr tracks, so the pitch cannot drift row to row.
    expect(CSS_DECLARATIONS).toMatch(/\.rc14-fault-list\s*\{[^}]*grid-auto-rows:\s*minmax\(0,\s*1fr\)/u)
    // RC-14/1 fixed grid: detail/no-zone occupy full-width rows and cannot size the system line.
    expect(CSS_DECLARATIONS).toContain("'chip chip'")
    expect(CSS_DECLARATIONS).toContain("'nozone nozone'")
    expect(CSS_DECLARATIONS).toContain("'detail detail'")
    expect(CSS_DECLARATIONS).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 30%)')
  })

  it('reproduces the reference rectangle percentages from raw pixels', () => {
    expect(rc14RectPercent({ x: 16, y: 50, width: 208, height: 380 }, 800, 480)).toEqual({
      left: 2,
      top: 10.416667,
      width: 26,
      height: 79.166667
    })
  })
})

describe('RC-14 type ladder is arithmetic', () => {
  it('sets the packet 11.2 ladder and never measures it off the render', () => {
    expect(RC14_TYPE_SCALE_PX).toEqual({
      vitalValue: 40,
      decisionWord: 40,
      faultSystem: 24,
      severityChip: 19,
      zoneLabel: 14,
      vitalLabel: 14,
      vitalUnit: 14,
      cornerValue: 14,
      cornerHeader: 12
    })
    // The brief's ranked chain, largest first, with the chip strictly between the list and labels.
    expect(RC14_TYPE_SCALE_PX.vitalValue).toBe(RC14_TYPE_SCALE_PX.decisionWord)
    expect(RC14_TYPE_SCALE_PX.decisionWord).toBeGreaterThan(RC14_TYPE_SCALE_PX.faultSystem)
    expect(RC14_TYPE_SCALE_PX.faultSystem).toBeGreaterThan(RC14_TYPE_SCALE_PX.severityChip)
    expect(RC14_TYPE_SCALE_PX.severityChip).toBeGreaterThan(RC14_TYPE_SCALE_PX.zoneLabel)
    expect(RC14_TYPE_SCALE_PX.zoneLabel).toBeGreaterThan(RC14_TYPE_SCALE_PX.cornerHeader)
    // Gap G5 made explicit: the PRIMARY element carries the SMALLEST text, deliberately.
    expect(RC14_TYPE_SCALE_PX.zoneLabel).toBeLessThan(RC14_TYPE_SCALE_PX.vitalValue)
  })

  it('expresses the ladder in container units so 1024x600 is the packet 1.28 step', () => {
    expect(RC14_CQW_PX).toBe(8)
    expect(rc14TypeScaleCqw(RC14_TYPE_SCALE_PX.vitalValue)).toBe(5)
    expect(rc14TypeScaleCqw(RC14_TYPE_SCALE_PX.faultSystem)).toBe(3)
    expect(rc14TypeScaleCqw(RC14_TYPE_SCALE_PX.severityChip)).toBe(2.375)
    expect(rc14TypeScaleCqw(RC14_TYPE_SCALE_PX.zoneLabel)).toBe(1.75)
    expect(rc14TypeScaleCqw(RC14_TYPE_SCALE_PX.cornerHeader)).toBe(1.5)
    expect(RC14_APP_TYPE_SCALE).toBe(1.28)
    for (const rung of Object.values(RC14_TYPE_SCALE_PX)) {
      expect(rc14TypeScalePxForWidth(rung, RC14_NATIVE_WIDTH_PX)).toBe(rung)
      expect(rc14TypeScalePxForWidth(rung, RC14_APP_WIDTH_PX)).toBeCloseTo(rung * RC14_APP_TYPE_SCALE, 3)
    }
  })

  it('emits the ladder as custom properties rather than as hard-coded pixels', () => {
    const html = markup(snapshot())
    expect(html).toContain('--rc14-type-vital:5cqw')
    expect(html).toContain('--rc14-type-decision:5cqw')
    expect(html).toContain('--rc14-type-system:3cqw')
    expect(html).toContain('--rc14-type-chip:2.375cqw')
    expect(html).toContain('--rc14-type-zone:1.75cqw')
    expect(html).toContain('--rc14-type-corner-head:1.5cqw')
  })

  it('keeps both heroes inside their zone at every breakpoint, by getBoundingClientRect arithmetic', () => {
    // THE SIZING TRAP. `white-space: nowrap` lifts a flex item's min-content width above its column,
    // so `overflow: hidden` never clips and `scrollWidth === clientWidth` while the glyphs sit
    // outside. Containment is therefore checked against the ZONE box, never against scrollWidth.
    const padding = 12
    for (const box of BREAKPOINTS) {
      const layout = rc14LayoutForContentBox(box.width, box.height)
      const mode = rc14CompactModeForContentBox(box.width, box.height)
      const zones = rc14ZonesForLayout(layout, mode, box)
      const decisionZone = layout === 'app' ? zones.decisionCorners : zones.decisionBanner
      const decisionWidthPx = ((decisionZone?.width ?? 0) / 100) * box.width
      const vitalsWidthPx = ((zones.vitalsColumn?.width ?? 0) / 100) * box.width

      const decisionPx = renderedTypePx(RC14_TYPE_SCALE_PX.decisionWord, box.width, 52)
      const vitalPx = renderedTypePx(RC14_TYPE_SCALE_PX.vitalValue, box.width, 52)

      expect(rc14HeroFitsZone('CONTINUE', decisionPx, decisionWidthPx, padding, 0.06)).toBe(true)
      // Four glyphs is the widest vitals numeral any scale in RC14_VITAL_SCALE can produce.
      expect(rc14HeroFitsZone('14.2', vitalPx, vitalsWidthPx, padding, 0.02)).toBe(true)
    }
  })

  it('bounds every nowrap text with a clamp and lets it shrink below its min-content width', () => {
    for (const rule of cssRules()) {
      if (!rule.body.includes('white-space: nowrap')) continue
      if (!rule.body.includes('font-size:')) continue
      expect(rule.body).toContain('clamp(')
      expect(rule.body).toMatch(/clamp\([^;]*?[\d.]+px\s*\)/u)
      expect(rule.body).toContain('min-width: 0')
      expect(rule.body).toContain('overflow: hidden')
    }
    expect(WIDGET_CODE).toContain('getBoundingClientRect()')
    expect(WIDGET_CODE).not.toContain('scrollWidth')
    expect(CSS_DECLARATIONS).toContain('container-type: size')
  })

  it('keeps the compact-landscape hero rungs equal with the shared 0.62 factor', () => {
    expect(RC14_COMPACT_TYPE_MAX_HEIGHT_PX).toBeLessThan(RC14_NATIVE_HEIGHT_PX)
    expect(RC14_COMPACT_TYPE_MAX_HEIGHT_PX).toBeLessThan(RC14_APP_HEIGHT_PX)
    expect(CSS_DECLARATIONS).toContain(`@container (max-height: ${RC14_COMPACT_TYPE_MAX_HEIGHT_PX}px)`)
    expect(CSS_DECLARATIONS).toContain('calc(var(--rc14-type-vital, 5cqw) * 0.62), 34px')
    expect(CSS_DECLARATIONS).toContain('calc(var(--rc14-type-decision, 5cqw) * 0.62), 34px')

    const compactHeightTypePx = (rung: number, width: number): number => Math.min(rc14TypeScalePxForWidth(rung, width) * 0.62, 34)
    for (const { width, expected } of [
      { width: 759, expected: 23.529 },
      { width: 867, expected: 26.877 }
    ]) {
      const vitalPx = compactHeightTypePx(RC14_TYPE_SCALE_PX.vitalValue, width)
      const decisionPx = compactHeightTypePx(RC14_TYPE_SCALE_PX.decisionWord, width)
      expect(vitalPx).toBeCloseTo(expected, 3)
      expect(decisionPx).toBeCloseTo(expected, 3)
      expect(vitalPx).toBeCloseTo(decisionPx, 3)
    }
  })
})

describe('RC-14 colour contract', () => {
  it('binds the packet 11.3 tokens verbatim except for one declared retune', () => {
    expect(RC14_TOKENS).toEqual({
      bg: '#0D0F12',
      panel: '#171B20',
      primary: '#EAEDF0',
      secondary: '#8C97A2',
      info: '#40B8D0',
      normal: '#46C86E',
      caution: '#FFA82E',
      danger: '#FF3E30',
      signature: '#6EE7FF'
    })
    for (const [name, hex] of Object.entries(RC14_TOKENS)) {
      if (name === 'info') continue
      expect(CSS_DECLARATIONS).toContain(`--rc14-${name}: ${hex.toLowerCase()};`)
    }
  })

  it('retunes info away from signature and records the packet value it replaced', () => {
    expect(RC14_INFO_RETUNE.packet).toBe(RC14_TOKENS.info)
    expect(RC14_INFO_RETUNE.applied).toBe('#3F93CF')
    expect(Math.abs(RC14_INFO_RETUNE.packetHueDeg - RC14_INFO_RETUNE.signatureHueDeg)).toBeLessThan(1)
    expect(Math.abs(RC14_INFO_RETUNE.appliedHueDeg - RC14_INFO_RETUNE.signatureHueDeg)).toBeGreaterThan(10)
    expect(CSS_DECLARATIONS).toContain(`--rc14-info: ${RC14_INFO_RETUNE.applied.toLowerCase()};`)
    expect(CSS_DECLARATIONS).not.toContain(RC14_INFO_RETUNE.packet.toLowerCase())
    // `info` is the gauge FILL and nothing else; `signature` is the silhouette OUTLINE and never a gauge.
    const infoRules = rulesReferencing('info')
    expect(infoRules.map((rule) => rule.selector)).toEqual(['.rc14-vital-fill'])
    for (const rule of rulesReferencing('signature')) {
      expect(rule.selector).not.toContain('vital')
    }
  })

  it('references every alert token only inside a severity-scoped rule', () => {
    const scoped = /data-rc14-(?:severity|zone-severity|vital-alerting|decision-token|timeline-severity)=/u
    for (const token of RC14_ALERT_TOKENS) {
      const rules = rulesReferencing(token)
      expect(rules.length).toBeGreaterThan(0)
      for (const rule of rules) expect(rule.selector).toMatch(scoped)
    }
  })

  it('never paints an unmonitored zone the OK green', () => {
    expect(RC14_UNMONITORED_TOKEN).toBe('secondary')
    expect(RC14_UNMONITORED_PATTERN).toBe('outline')
    for (const rule of rulesReferencing('normal')) {
      expect(rule.selector).toMatch(/data-rc14-(?:severity|zone-severity|decision-token)='?(?:ok|normal)'?\]/u)
    }
    expect(CSS_DECLARATIONS).toMatch(
      /\.rc14-zone\[data-rc14-zone-pattern='outline'\] \.rc14-zone-rect\s*\{[^}]*fill:\s*none/u
    )
  })

  it('separates every severity by word and pattern, not by hue alone', () => {
    expect(RC14_SEVERITY_CHIP).toEqual({ ok: 'OK', minor: 'MINOR', major: 'MAJOR', critical: 'CRITICAL' })
    // Gap G2: three status hues for four levels, so MINOR and MAJOR SHARE caution ...
    expect(RC14_SEVERITY_TOKEN.minor).toBe(RC14_SEVERITY_TOKEN.major)
    // ... and the pattern is what actually separates them.
    const patterns = Object.values(RC14_SEVERITY_PATTERN)
    expect(new Set(patterns).size).toBe(patterns.length)
    expect(patterns).not.toContain(RC14_UNMONITORED_PATTERN)
  })

  it('renders no raster asset and no replacement character anywhere', () => {
    const combined = `${WIDGET_SOURCE}\n${CORE_SOURCE}\n${CSS_SOURCE}`
    expect(combined).not.toContain('\uFFFD')
    expect(combined).not.toMatch(/\.(?:png|jpe?g|gif|webp|avif)(?:['")\s])/iu)
    expect(WIDGET_SOURCE).not.toMatch(/window\.inner|matchMedia|racecon-mock|telemetry-scenarios/iu)
  })
})

describe('RC-14 telemetry truth table', () => {
  it('reads every channel from its own declared source', () => {
    const value = snapshot({ oilTempC: 104 })
    expect(rc14ChannelValue(value, 'oilPressure')).toBe(4.4)
    expect(rc14ChannelValue(value, 'waterTemp')).toBe(78)
    expect(rc14ChannelValue(value, 'battery')).toBe(14.2)
    expect(rc14ChannelValue(value, 'oilTemp')).toBe(104)
    expect(rc14ChannelValue(value, 'brakeTempLf')).toBe(478)
    expect(rc14ChannelValue(value, 'brakeTempRr')).toBeNull()
    expect(rc14ChannelValue(value, 'tyrePressureLf')).toBe(1.92)
    expect(rc14ChannelValue(value, 'tyrePressureLr')).toBeNull()
  })

  it('carries the packet section 16 freshness budgets verbatim', () => {
    expect(RC14_CHANNEL_STALE_MS.oilPressure).toBe(200)
    expect(RC14_CHANNEL_STALE_MS.waterTemp).toBe(500)
    expect(RC14_CHANNEL_STALE_MS.battery).toBe(500)
    expect(RC14_CHANNEL_STALE_MS.oilTemp).toBe(500)
    expect(RC14_CHANNEL_STALE_MS.brakeTempLf).toBe(200)
    expect(RC14_CHANNEL_STALE_MS.tyrePressureLf).toBe(1_000)
  })

  it('reproduces the approved reference frame deterministically', () => {
    const model = modelFor(snapshot())
    expect(model.vitals.map((vital) => vital.field.value)).toEqual(['4.4', '78', '14.2', RC14_DASH.vital])
    expect(model.vitals.map((vital) => vital.fill)).toEqual([0.55, 0.3, 0.7, 0])
    expect(model.corners.map((corner) => corner.brakeTemp.value)).toEqual(['478', '461', '392', RC14_DASH.brakeTemp])
    expect(model.corners.map((corner) => corner.tyrePressure.value)).toEqual([
      '1.92',
      '1.95',
      RC14_DASH.tyrePressure,
      '1.86'
    ])
    expect(model.decision.word).toBe('CONTINUE')
    expect(model.alertsActive).toBe(false)
    expect(model.systems.map((row) => row.id)).toEqual(['engine', 'electrical', 'chassis'])
    expect(model.systems.every((row) => row.severity === 'ok')).toBe(true)
  })

  it('dashes a vital whose sensor is invalid and never estimates it', () => {
    const model = modelFor(snapshot({ oilPressureKpa: undefined, waterTempC: Number.NaN }))
    const oil = model.vitals.find((vital) => vital.id === 'oilPressure')
    const water = model.vitals.find((vital) => vital.id === 'waterTemp')
    expect(oil?.field.value).toBe(RC14_DASH.vital)
    expect(oil?.field.unavailable).toBe(true)
    expect(oil?.fill).toBe(0)
    expect(water?.field.value).toBe(RC14_DASH.vital)
    expect(water?.fill).toBe(0)
    // Never modelled from RPM, never substituted from the neighbouring gauge.
    expect(CORE_SOURCE).not.toMatch(/oilPressure[^\n]*snapshot\.rpm/u)
    expect(CORE_SOURCE).not.toMatch(/case 'oilTemp':[\s\S]{0,120}waterTempC/u)
  })

  it('treats a quiet electrical bus as unavailable rather than a nominal voltage', () => {
    const model = modelFor(snapshot({ voltage: 0 }))
    const battery = model.vitals.find((vital) => vital.id === 'battery')
    expect(battery?.field.value).toBe(RC14_DASH.vital)
    expect(battery?.field.unavailable).toBe(true)
    expect(rc14FaultSourceAvailable(snapshot({ voltage: 0 }), 'vitalBattery')).toBe(false)
  })

  it('degrades a channel that falls silent rather than freezing it', () => {
    const value = snapshot()
    // Receipts written at 0, read 400 ms later: oil pressure's 200 ms budget has expired, water's
    // 500 ms budget has not.
    const model = modelFor(value, 400, {}, 0)
    const oil = model.vitals.find((vital) => vital.id === 'oilPressure')
    const water = model.vitals.find((vital) => vital.id === 'waterTemp')
    expect(oil?.field.stale).toBe(true)
    expect(oil?.field.value).toBe(RC14_DASH.vital)
    expect(oil?.fill).toBe(0)
    expect(water?.field.stale).toBe(false)
    expect(water?.field.value).toBe('78')
  })

  it('never estimates a corner from its neighbour and never uses the cold setup pressure', () => {
    const model = modelFor(
      snapshot({
        tireColdPressuresKpa: { lf: 165, rf: 165, lr: 165, rr: 165 },
        tyres: { lf: { pressureKpa: 192 }, rf: {}, lr: {}, rr: {} }
      } as Partial<TelemetrySnapshot>)
    )
    const values = model.corners.map((corner) => corner.tyrePressure.value)
    expect(values).toEqual(['1.92', RC14_DASH.tyrePressure, RC14_DASH.tyrePressure, RC14_DASH.tyrePressure])
    expect(values.filter((value) => value === '1.65')).toHaveLength(0)
    expect(CORE_SOURCE).not.toMatch(/tireColdPressuresKpa\s*\?\./u)
    // Brake temperature is never inferred from usage, brake pressure or tyre temperature.
    expect(CORE_SOURCE).not.toMatch(/brakeTemp[^\n]*brakeLinePressBar/u)
  })

  it('computes every bar fill arithmetically and never traces one', () => {
    expect(rc14VitalFill('oilPressure', 4.4)).toBe(0.55)
    expect(rc14VitalFill('waterTemp', 78)).toBe(0.3)
    expect(rc14VitalFill('battery', 14.2)).toBe(0.7)
    expect(rc14VitalFill('oilTemp', null)).toBe(0)
    expect(rc14VitalFill('waterTemp', 20)).toBe(0)
    expect(rc14VitalFill('waterTemp', 400)).toBe(1)
    expect(RC14_VITAL_SCALE.oilTemp).toEqual({ min: 60, max: 150 })
  })

  it('gives the vital alert explicit ranges and never one for oil temperature', () => {
    expect(Object.keys(RC14_VITAL_RANGE).sort()).toEqual(['battery', 'oilPressure', 'waterTemp'])
    expect(rc14VitalOutOfRange('oilPressure', 1.4)).toBe(true)
    expect(rc14VitalOutOfRange('oilPressure', 4.4)).toBe(false)
    expect(rc14VitalOutOfRange('waterTemp', 118)).toBe(true)
    expect(rc14VitalOutOfRange('battery', 11.1)).toBe(true)
    expect(rc14VitalOutOfRange('battery', null)).toBe(false)
    // Packet 15 lists oil / water / battery only: oil temperature gets a gauge but never an alert.
    expect(rc14VitalOutOfRange('oilTemp', 260)).toBe(false)
  })

  it('publishes every vitals gauge even when no vital reports at all', () => {
    const model = modelFor(sourcelessSnapshot())
    expect(model.vitals).toHaveLength(RC14_VITAL_IDS.length)
    expect(model.vitals.every((vital) => vital.field.value === RC14_DASH.vital)).toBe(true)
    expect(model.corners).toHaveLength(RC14_CORNERS.length)
  })
})

describe('RC-14 fault map never invents a fault', () => {
  it('hides the row and leaves the zone untinted when a fault channel is absent', () => {
    const model = modelFor(sourcelessSnapshot())
    expect(model.systems).toHaveLength(0)
    expect(model.monitoredSourceIds).toHaveLength(0)
    expect(model.zones).toHaveLength(RC14_SILHOUETTE_ZONES.length)
    expect(model.zones.every((zone) => !zone.monitored)).toBe(true)
    expect(model.zones.every((zone) => zone.severity === null)).toBe(true)
    expect(model.zones.every((zone) => zone.chip === RC14_DASH.chip)).toBe(true)
    expect(model.zones.every((zone) => zone.token === RC14_UNMONITORED_TOKEN)).toBe(true)
    expect(model.zones.every((zone) => zone.description.endsWith(RC14_UNMONITORED_NOTICE))).toBe(true)
  })

  it('separates an UNMONITORED zone from an OK zone, which is the whole of gap G7', () => {
    const model = modelFor(snapshot())
    const engine = model.zones.find((zone) => zone.id === 'engine')
    const gearbox = model.zones.find((zone) => zone.id === 'gearbox')
    expect(engine?.monitored).toBe(true)
    expect(engine?.severity).toBe('ok')
    expect(engine?.token).toBe('normal')
    expect(engine?.pattern).toBe('solid')
    expect(gearbox?.monitored).toBe(false)
    expect(gearbox?.severity).toBeNull()
    expect(gearbox?.token).toBe('secondary')
    expect(gearbox?.pattern).toBe('outline')
  })

  it('draws all eight silhouette zones whatever the telemetry says', () => {
    for (const value of [snapshot(), sourcelessSnapshot(), null]) {
      expect(modelFor(value).zones.map((zone) => zone.id)).toEqual([
        'aero',
        'engine',
        'electrical',
        'gearbox',
        'cornerLf',
        'cornerRf',
        'cornerLr',
        'cornerRr'
      ])
    }
  })

  it('reads each fault source from a real channel and refuses one that is absent', () => {
    const faulted = withWarnings({ oilPressure: true })
    expect(rc14FaultSourceRaw(faulted, 'engineOilPressureLamp')).toBe(true)
    expect(rc14FaultSourceRaw(faulted, 'engineStalled')).toBe(false)
    expect(rc14FaultSourceRaw(sourcelessSnapshot(), 'engineOilPressureLamp')).toBeNull()
    expect(rc14FaultSourceRaw(null, 'engineOilPressureLamp')).toBeNull()
    expect(rc14FaultSourceAvailable(sourcelessSnapshot(), 'chassisMandatoryRepair')).toBe(false)
  })

  it('publishes the whole-car repair state without inventing a location for it', () => {
    const model = modelFor(snapshot({ repairTimeSec: 26 }), 3_000)
    const chassis = model.systems.find((row) => row.id === 'chassis')
    expect(chassis).toBeDefined()
    expect(chassis?.zone).toBeNull()
    const zonedSeverities = model.zones.filter((zone) => zone.monitored).map((zone) => zone.id)
    expect(zonedSeverities).toEqual(['engine', 'electrical'])
  })

  it('ranks the list by severity and then by a stable key so it cannot flicker', () => {
    const alerts = alertsOver(withWarnings({ fuelPressure: true }), [0, 1_000, 2_000])
    const model = modelFor(withWarnings({ fuelPressure: true }), 2_000, { alerts })
    expect(model.systems.map((row) => row.id)).toEqual(['engine', 'electrical', 'chassis'])
    expect(model.systems[0].severity).toBe('major')
    expect(model.systems.slice(1).every((row) => row.severity === 'ok')).toBe(true)
    // A second run with the same input must produce the same order, byte for byte.
    expect(modelFor(withWarnings({ fuelPressure: true }), 2_000, { alerts }).systems.map((row) => row.id)).toEqual(
      model.systems.map((row) => row.id)
    )
  })
})

describe('RC-14 trigger-only alerts', () => {
  it('starts silent on every source', () => {
    const state = createRc14AlertState()
    for (const source of RC14_FAULT_SOURCES) {
      expect(rc14AlertActive(state, source.id)).toBe(false)
      expect(state.sources[source.id].engagedAtMs).toBeNull()
      expect(state.sources[source.id].acknowledged).toBe(false)
    }
    expect(modelFor(snapshot()).alertsActive).toBe(false)
  })

  it('carries the packet 15 debounce and latch semantics verbatim', () => {
    expect(RC14_ALERT_ENGAGE_MS).toEqual({ criticalFault: 1_000, minorFault: 1_000, vitalRange: 3_000 })
    expect(RC14_ALERT_LATCHED_UNTIL_ACK).toEqual({ criticalFault: true, minorFault: false, vitalRange: false })
  })

  it('engages a critical fault only after its one-second debounce', () => {
    const faulted = withWarnings({ oilPressure: true })
    expect(rc14AlertActive(alertsOver(faulted, [0]), 'engineOilPressureLamp')).toBe(false)
    expect(rc14AlertActive(alertsOver(faulted, [0, 999]), 'engineOilPressureLamp')).toBe(false)
    expect(rc14AlertActive(alertsOver(faulted, [0, 1_000]), 'engineOilPressureLamp')).toBe(true)
  })

  it('latches a critical fault until it is BOTH acknowledged and cleared', () => {
    const faulted = withWarnings({ oilPressure: true })
    const cleared = snapshot()
    let state = alertsOver(faulted, [0, 1_000])
    expect(rc14AlertActive(state, 'engineOilPressureLamp')).toBe(true)

    // The channel clears, but nobody has acknowledged: the alert HOLDS.
    state = alertsOver(cleared, [1_100], state)
    expect(rc14AlertActive(state, 'engineOilPressureLamp')).toBe(true)

    state = acknowledgeRc14Fault(state, 'engineOilPressureLamp')
    state = alertsOver(cleared, [1_200], state)
    expect(rc14AlertActive(state, 'engineOilPressureLamp')).toBe(false)
  })

  it('never lets an acknowledgement pre-clear a fault that recurs later', () => {
    const faulted = withWarnings({ oilPressure: true })
    const cleared = snapshot()
    let state = alertsOver(faulted, [0, 1_000])
    state = acknowledgeRc14Fault(state, 'engineOilPressureLamp')
    state = alertsOver(cleared, [1_100], state)
    expect(rc14AlertActive(state, 'engineOilPressureLamp')).toBe(false)
    expect(state.sources.engineOilPressureLamp.acknowledged).toBe(false)

    state = alertsOver(faulted, [2_000, 3_000], state)
    expect(rc14AlertActive(state, 'engineOilPressureLamp')).toBe(true)
    expect(state.sources.engineOilPressureLamp.acknowledged).toBe(false)
  })

  it('clears a minor fault the moment its channel clears, with no acknowledgement', () => {
    const faulted = withWarnings({ fuelPressure: true })
    let state = alertsOver(faulted, [0, 1_000])
    expect(rc14AlertActive(state, 'engineFuelPressureLamp')).toBe(true)
    state = alertsOver(snapshot(), [1_100], state)
    expect(rc14AlertActive(state, 'engineFuelPressureLamp')).toBe(false)
  })

  it('engages the vital alert only after three seconds and releases it back in range', () => {
    const low = snapshot({ oilPressureKpa: 140 })
    expect(rc14AlertActive(alertsOver(low, [0, 2_999]), 'vitalOilPressure')).toBe(false)
    let state = alertsOver(low, [0, 3_000])
    expect(rc14AlertActive(state, 'vitalOilPressure')).toBe(true)
    state = alertsOver(snapshot(), [3_100], state)
    expect(rc14AlertActive(state, 'vitalOilPressure')).toBe(false)
  })

  it('unlatches every alert whose channel goes stale or disappears', () => {
    const faulted = withWarnings({ oilPressure: true })
    const engaged = alertsOver(faulted, [0, 1_000])
    expect(rc14AlertActive(engaged, 'engineOilPressureLamp')).toBe(true)

    // Same frame, read far past the fault-map freshness budget: the latch releases.
    const stale = advanceRc14Alerts(engaged, rc14AlertInputForSnapshot(faulted, receiptsFor(faulted, 1_000), 9_000))
    expect(rc14AlertActive(stale, 'engineOilPressureLamp')).toBe(false)

    // Channel gone entirely: the latch releases the same way.
    const gone = alertsOver(sourcelessSnapshot(), [1_100], engaged)
    expect(rc14AlertActive(gone, 'engineOilPressureLamp')).toBe(false)
  })

  it('clears any latch the model has published as unmonitored', () => {
    const faulted = withWarnings({ oilPressure: true })
    const engaged = alertsOver(faulted, [0, 1_000])
    const sourceless = modelFor(sourcelessSnapshot())
    const cleared = clearInvalidRc14Alerts(engaged, sourceless)
    for (const source of RC14_FAULT_SOURCES) expect(rc14AlertActive(cleared, source.id)).toBe(false)
    // A model that DOES monitor the source keeps the latch.
    const kept = clearInvalidRc14Alerts(engaged, modelFor(faulted, 1_000, { alerts: engaged }))
    expect(rc14AlertActive(kept, 'engineOilPressureLamp')).toBe(true)
  })

  it('never engages any alert from a clear frame, however long it runs', () => {
    const state = alertsOver(snapshot(), [0, 1_000, 5_000, 30_000])
    for (const source of RC14_FAULT_SOURCES) expect(rc14AlertActive(state, source.id)).toBe(false)
    expect(modelFor(snapshot(), 30_000, { alerts: state }).decision.word).toBe('CONTINUE')
  })

  it('gives every alert a visible surface at every breakpoint', () => {
    const faulted = withWarnings({ oilPressure: true })
    const alerts = alertsOver(faulted, [0, 1_000])
    for (const box of BREAKPOINTS) {
      const cfg: OverlayWidgetConfig = { ...config, position: { x: 0, y: 0, ...box } }
      const html = markup(faulted, cfg)
      assertClean(html)
      // The fault list and the decision banner exist in EVERY grammar, so a latched critical fault
      // always has somewhere to be seen.
      expect(html).toContain('data-rc14-zone="faultList"')
      expect(html).toContain('data-testid="rc14-decision"')
      expect(html).toContain('data-rc14-zone="carSilhouette"')
    }
    expect(modelFor(faulted, 1_000, { alerts }).decision.word).toBe('PIT')
  })
})

describe('RC-14 decision banner', () => {
  it('reads PIT for any critical fault and LIMP for a major one', () => {
    const critical = withWarnings({ oilPressure: true })
    expect(modelFor(critical, 1_000, { alerts: alertsOver(critical, [0, 1_000]) }).decision).toMatchObject({
      word: 'PIT',
      token: 'danger',
      available: true
    })
    const major = withWarnings({ fuelPressure: true })
    expect(modelFor(major, 1_000, { alerts: alertsOver(major, [0, 1_000]) }).decision).toMatchObject({
      word: 'LIMP',
      token: 'caution',
      available: true
    })
  })

  it('reads CONTINUE only when a real fault channel reported clear', () => {
    const decision = modelFor(snapshot()).decision
    expect(decision.word).toBe('CONTINUE')
    expect(decision.token).toBe('normal')
    expect(decision.available).toBe(true)
  })

  it('dashes rather than claiming CONTINUE when nothing is monitored', () => {
    const decision = modelFor(sourcelessSnapshot()).decision
    expect(decision.word).toBeNull()
    expect(decision.value).toBe(RC14_DASH.decision)
    expect(decision.token).toBe('secondary')
    expect(decision.available).toBe(false)
    expect(decision.reason).toBe(RC14_NO_FAULT_SOURCE_NOTICE)
  })

  it('never leaves the banner blank', () => {
    for (const value of [snapshot(), sourcelessSnapshot(), null]) {
      expect(modelFor(value).decision.value.length).toBeGreaterThan(0)
    }
  })
})

describe('RC-14 layout resolution', () => {
  it('resolves the packet breakpoints', () => {
    expect(rc14LayoutForContentBox(800, 480)).toBe('native')
    expect(rc14LayoutForContentBox(800.9, 479.4)).toBe('native')
    expect(rc14LayoutForContentBox(1024, 600)).toBe('app')
    expect(rc14LayoutForContentBox(1023.9977, 599.9853)).toBe('app')
    expect(rc14LayoutForContentBox(900, 600)).toBe('compact')
    expect(rc14LayoutForContentBox(Number.NaN, 0)).toBe('app')
  })

  it('resolves the compact modes', () => {
    expect(rc14CompactModeForContentBox(400, 800)).toBe('phone')
    expect(rc14CompactModeForContentBox(900, 400)).toBe('landscape')
    expect(rc14CompactModeForContentBox(640, 520)).toBe('standard')
    expect(rc14CompactModeForContentBox(1024, 600)).toBe('standard')
  })

  it('expands rather than scales at 1024x600', () => {
    const native = rc14ZonesForLayout('native')
    const app = rc14ZonesForLayout('app')
    expect(Object.keys(native).sort()).toEqual([
      'carSilhouette',
      'cornerStatus',
      'decisionBanner',
      'faultList',
      'vitalsColumn'
    ])
    expect(Object.keys(app).sort()).toEqual([
      'carSilhouette',
      'decisionCorners',
      'faultList',
      'faultTimeline',
      'vitalsColumn'
    ])
    expect(RC14_APP_ONLY_MODULES).toEqual(['faultTimeline', 'faultTimestamps'])
  })

  it('selects the layout from the transformed root box and remeasures when its shell changes', () => {
    let displayedBox = { width: 800, height: 480 }
    const rect = (width: number, height: number): DOMRect =>
      ({ x: 0, y: 0, top: 0, right: width, bottom: height, left: 0, width, height, toJSON: () => ({}) }) as DOMRect
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('rc14-widget') ? rect(displayedBox.width, displayedBox.height) : rect(0, 0)
      })

    class ResizeObserverStub {
      static instances: ResizeObserverStub[] = []
      readonly observed: Element[] = []

      constructor(private readonly callback: ResizeObserverCallback) {
        ResizeObserverStub.instances.push(this)
      }

      observe(target: Element): void {
        this.observed.push(target)
      }
      unobserve(): void {}
      disconnect(): void {}
      trigger(): void {
        this.callback([], this as unknown as ResizeObserver)
      }
    }

    const originalResizeObserver = globalThis.ResizeObserver
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
    try {
      const view = render(
        createElement(
          'div',
          { className: 'dashboard-shell' },
          createElement(RaceconRc14DashWidget, { snapshot: snapshot(), config })
        )
      )
      const root = view.container.querySelector<HTMLDivElement>('.rc14-widget')!
      const shell = view.container.querySelector<HTMLDivElement>('.dashboard-shell')!
      const observer = ResizeObserverStub.instances[0]

      // The authored config is 1024x600, but the canvas has transformed the element to 800x480.
      expect(root.dataset.rc14Layout).toBe('native')
      expect(root.dataset.rc14ContentWidth).toBe('800')
      expect(observer.observed).toEqual([root, shell])
      expect(root.querySelector('[data-rc14-zone="decisionBanner"]')).not.toBeNull()
      expect(root.querySelector('[data-rc14-zone="faultTimeline"]')).toBeNull()

      displayedBox = { width: 1024, height: 600 }
      act(() => observer.trigger())
      expect(root.dataset.rc14Layout).toBe('app')
      expect(root.querySelector('[data-rc14-zone="faultTimeline"]')).not.toBeNull()
      expect(root.querySelector('[data-rc14-zone="decisionCorners"]')).not.toBeNull()
      expect(root.querySelector('[data-rc14-zone="decisionBanner"]')).toBeNull()
      view.unmount()
    } finally {
      rectSpy.mockRestore()
      if (originalResizeObserver) globalThis.ResizeObserver = originalResizeObserver
      else delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
    }
  })
})

describe('RC-14 rendered DOM contract', () => {
  it('renders the widget marker, the layout attributes and every packet zone', () => {
    const html = markup(snapshot())
    assertClean(html)
    expect(html).toContain(`data-widget="${RC14_REGISTRATION.widgetId}"`)
    expect(html).toContain('data-rc14-layout="app"')
    expect(html).toContain('data-rc14-buffer-state="accepted"')
    expect(html).toContain('data-rc14-alerts="silent"')
    expect(html).toContain('data-rc14-decision="CONTINUE"')
    for (const zone of ['faultList', 'carSilhouette', 'vitalsColumn', 'decisionCorners', 'faultTimeline']) {
      expect(html).toContain(`data-rc14-zone="${zone}"`)
    }
    expect(html).toContain('data-rc14-unmonitored-zones="6"')
  })

  it('keeps the app-only reveals out of the 800x480 grammar', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('data-rc14-native-size="800x480"')
    expect(html).toContain('data-rc14-zone="decisionBanner"')
    expect(html).toContain('data-rc14-zone="cornerStatus"')
    expect(html).not.toContain('data-rc14-zone="faultTimeline"')
    expect(html).not.toContain('data-rc14-zone="decisionCorners"')
    expect(html).not.toContain('data-testid="rc14-fault-stamp"')
  })

  it('renders no shift LED arc, no gear hero and no pace numeral anywhere', () => {
    for (const cfg of [config, nativeConfig]) {
      const html = markup(snapshot({ speedKmh: 214, gear: 6, rpm: 7_150, maxRpm: 8_600 }), cfg)
      expect(html).not.toMatch(/\bGEAR\b/u)
      expect(html).not.toMatch(/\bRPM\b/u)
      expect(html).not.toMatch(/\bSHIFT\b/u)
      expect(html).not.toMatch(/\bLAP\b/u)
      expect(html).not.toContain('data-rc14-led')
      expect(html).not.toContain('7150')
    }
  })

  it('renders all eight zones with a chip word and a pattern, never hue alone', () => {
    const html = markup(snapshot())
    expect(html.match(/data-testid="rc14-zone"/g)).toHaveLength(8)
    expect(html).toContain('data-rc14-zone-pattern="outline"')
    expect(html).toContain('data-rc14-zone-severity="unmonitored"')
    expect(html).toContain('data-rc14-zone-severity="ok"')
    expect(html).toContain(`>6 ZONES ${RC14_UNMONITORED_NOTICE}<`)
  })

  it('renders the chassis row with an explicit no-zone marker', () => {
    const html = markup(snapshot())
    expect(html).toContain('data-testid="rc14-fault-nozone"')
    expect(html).toContain(`>${RC14_NO_ZONE_NOTICE}<`)
  })

  it('renders a dash-only frame with no telemetry at all', () => {
    const html = markup(null)
    assertClean(html)
    expect(html).toContain('data-rc14-buffer-state="disconnected"')
    expect(html).toContain('data-rc14-decision="unavailable"')
    expect(html).toContain('data-rc14-monitored-systems="0"')
    expect(html).toContain(`>${RC14_NO_FAULT_SOURCE_NOTICE}<`)
    expect(html).toContain('data-rc14-unmonitored-zones="8"')
    expect(html.match(/data-testid="rc14-fault-row"/g)).toBeNull()
  })

  it('refuses mock and replay telemetry and raises no alert from it', () => {
    for (const value of [
      snapshot({ sim: 'mock' } as Partial<TelemetrySnapshot>),
      snapshot({ replayContext: { state: 'replay' } } as unknown as Partial<TelemetrySnapshot>)
    ]) {
      const html = markup(value)
      assertClean(html)
      expect(html).not.toContain('data-rc14-buffer-state="accepted"')
      expect(html).toContain('data-rc14-alerts="silent"')
      expect(html).toContain('data-rc14-decision="unavailable"')
      // The refused frame must not leak its telemetry into the readouts.
      expect(html).not.toContain('>4.4<')
      expect(html).not.toContain('>78<')
      expect(html).not.toContain('>14.2<')
      expect(html).not.toContain('>478<')
    }
    // `replayPlaying` is a raw provider field, NOT a refusal trigger.
    expect(markup(snapshot({ replayPlaying: true } as unknown as Partial<TelemetrySnapshot>))).toContain(
      'data-rc14-buffer-state="accepted"'
    )
  })

  it('exposes the compact mode attribute only in the compact layout', () => {
    expect(markup(snapshot(), { ...config, position: { x: 0, y: 0, width: 400, height: 800 } })).toContain(
      'data-rc14-compact-mode="phone"'
    )
    expect(markup(snapshot())).not.toContain('data-rc14-compact-mode')
  })

  it('renders cleanly at every breakpoint', () => {
    for (const box of BREAKPOINTS) {
      const html = markup(snapshot(), { ...config, position: { x: 0, y: 0, ...box } })
      assertClean(html)
      expect(html).toContain('class="rc14-widget"')
    }
  })

  it('describes every surface in words, never by hue', () => {
    const html = markup(snapshot())
    expect(html).toContain('aria-label="ENG OK"')
    expect(html).toContain('aria-label="GBX NO SOURCE"')
    expect(html).toContain('Decision CONTINUE, NO FAULT ON A MONITORED SYSTEM')
    expect(html).toContain('OIL PRESS bar 4.4')
    expect(html).toContain('OIL TEMP °C unavailable')
    expect(html).toContain('RR brake temperature °C unavailable')
  })

  it('carries the acknowledge affordance inside the fault row and selects a zone on tap', () => {
    vi.useFakeTimers()
    const faulted = withWarnings({ oilPressure: true })
    let now = 0
    const clock = (): number => now
    const view = render(
      createElement(RaceconRc14DashWidget, { snapshot: faulted, config, monotonicClock: clock })
    )
    const root = view.container.querySelector<HTMLDivElement>('.rc14-widget')!

    // Debounce not yet elapsed: no latch, so no acknowledge control exists.
    expect(root.querySelector('[data-testid="rc14-fault-ack"]')).toBeNull()
    expect(root.dataset.rc14Decision).toBe('CONTINUE')

    // A fresh frame keeps the fault channel inside its freshness budget, and the display clock then
    // ticks past the packet's 1 s engage debounce.
    now = 1_200
    act(() => {
      view.rerender(
        createElement(RaceconRc14DashWidget, {
          snapshot: { ...faulted, timestamp: faulted.timestamp + 20 },
          config,
          monotonicClock: clock
        })
      )
    })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(root.querySelector('[data-testid="rc14-fault-ack"]')).not.toBeNull()
    expect(root.dataset.rc14Decision).toBe('PIT')
    expect(root.dataset.rc14Alerts).toBe('active')

    const select = root.querySelector<HTMLButtonElement>('[data-testid="rc14-fault-select"]')!
    act(() => {
      fireEvent.click(select)
    })
    expect(root.dataset.rc14SelectedZone).toBe('engine')

    // Acknowledging retires the control but NOT the alert: packet 15 clears a critical fault only
    // when it has been acknowledged AND the channel has cleared.
    act(() => {
      fireEvent.click(root.querySelector<HTMLButtonElement>('[data-testid="rc14-fault-ack"]')!)
    })
    expect(root.querySelector('[data-testid="rc14-fault-ack"]')).toBeNull()
    expect(root.dataset.rc14Decision).toBe('PIT')
    view.unmount()
  })
})

describe('RC-14 shares the RC-01 fail-closed ingest buffer', () => {
  it('accepts a live identified snapshot and rejects an unidentified one', () => {
    const buffer = new Rc01LiveTelemetryBuffer()
    expect(buffer.ingest(snapshot(), 0)).toMatchObject({ accepted: true, reason: 'accepted' })
    expect(new Rc01LiveTelemetryBuffer().ingest(snapshot({ sessionUniqueId: undefined }), 0)).toMatchObject({
      accepted: false,
      reason: 'missing-source-identity'
    })
  })

  it('does not fork the buffer, the receipts or the identity binding', () => {
    expect(CORE_CODE).toContain("from './raceconRc01Core'")
    expect(CORE_CODE).not.toContain('class Rc14LiveTelemetryBuffer')
    expect(CORE_CODE).not.toContain('rc14SourceIdentity')
    expect(CORE_CODE).not.toContain('isLiveTelemetrySnapshot')
    expect(WIDGET_CODE).toContain('Rc01LiveTelemetryBuffer')
    expect(WIDGET_CODE).toContain('rc01MonotonicNow')
  })

  it('writes a receipt only when a channel actually reports', () => {
    const buffer = new Rc14AuxBuffer()
    buffer.ingest(snapshot({ voltage: undefined }), 0)
    const receipts = buffer.receipts()
    expect(receipts.get('oilPressure')?.value).toBe(4.4)
    expect(receipts.has('battery')).toBe(false)
    expect(receipts.has('tyrePressureLr')).toBe(false)

    const cloned = buffer.clone()
    cloned.reset()
    expect(cloned.receipts().size).toBe(0)
    expect(buffer.receipts().size).toBeGreaterThan(0)
  })

  it('keeps the display clock in the shared family hook rather than a local interval', () => {
    expect(WIDGET_CODE).toContain("from './raceconDisplayClock'")
    expect(WIDGET_CODE).toContain('useRaceconDisplayClock(monotonicClock, raceconDisplayClockFrozen(preview))')
    // The old family-wide defect: an unconditional 100 ms interval that ticks inside a static
    // preview and walks one snapshot past its own thresholds. RC-14 must never reintroduce it.
    expect(WIDGET_CODE).not.toContain('window.setInterval')
    expect(WIDGET_CODE).not.toContain('setNowMs')
    expect(WIDGET_CODE).not.toContain('useEffect(')
    expect(CORE_CODE).not.toContain('setInterval')
  })
})

/**
 * The freeze contract, measured on RC-14 itself. `raceconDisplayClock.test.ts` on `main` enumerates
 * the family in a `RACECON_WIDGETS` table typed as `OverlayWidgetId`; RC-14 cannot join it until the
 * union member exists, which is the wiring PR's edit, not this one's — see
 * `RC14_REGISTRATION.displayClockFamilyGuard`. These two cases assert the same contract locally so
 * the guarantee is not merely promised.
 */
describe('RC-14 honours the shared display-clock freeze policy', () => {
  const PAST_EVERY_THRESHOLD_MS = 30_000

  function mountWithPreview(previewMode: WidgetProps['preview']): {
    text: () => string
    root: () => HTMLDivElement
    advance: (ms: number) => void
    unmount: () => void
  } {
    vi.useFakeTimers()
    let monotonicMs = 0
    const monotonicClock: Rc01MonotonicClock = () => monotonicMs
    const view = render(
      createElement(RaceconRc14DashWidget, {
        snapshot: snapshot(),
        config,
        preview: previewMode,
        monotonicClock
      })
    )
    const step = RACECON_DISPLAY_CLOCK_INTERVAL_MS * 5
    return {
      text: () => view.container.textContent ?? '',
      root: () => view.container.querySelector<HTMLDivElement>('.rc14-widget')!,
      advance: (ms: number): void => {
        for (let elapsed = 0; elapsed < ms; elapsed += step) {
          act(() => {
            monotonicMs += step
            vi.advanceTimersByTime(step)
          })
        }
      },
      unmount: () => view.unmount()
    }
  }

  it('agrees with the shared freeze predicate', () => {
    expect(raceconDisplayClockFrozen(undefined)).toBe(false)
    expect(raceconDisplayClockFrozen('inert')).toBe(true)
    expect(RACECON_DISPLAY_CLOCK_INTERVAL_MS).toBe(100)
  })

  it('holds an inert preview byte-identical past every RC-14 time gate', () => {
    // 30 s clears the 200 ms / 500 ms / 1 s channel budgets and both fault debounces many times
    // over, so a ticking clock would visibly dash every vital and empty the fault list.
    expect(PAST_EVERY_THRESHOLD_MS).toBeGreaterThan(Math.max(...Object.values(RC14_CHANNEL_STALE_MS)))
    expect(PAST_EVERY_THRESHOLD_MS).toBeGreaterThan(Math.max(...Object.values(RC14_ALERT_ENGAGE_MS)))

    const view = mountWithPreview('inert')
    const mounted = view.text()
    expect(view.root().dataset.rc14Decision).toBe('CONTINUE')
    view.advance(PAST_EVERY_THRESHOLD_MS)
    expect(view.text(), 'RC-14 inert preview text must be byte-identical after 30s').toBe(mounted)
    expect(view.root().dataset.rc14Decision).toBe('CONTINUE')
    view.unmount()
  }, 30_000)

  it('keeps ageing a live frame so a silent channel still degrades visibly', () => {
    const view = mountWithPreview(undefined)
    const mounted = view.text()
    expect(view.root().dataset.rc14Decision).toBe('CONTINUE')
    view.advance(PAST_EVERY_THRESHOLD_MS)
    expect(view.text(), 'RC-14 live render must still age its frame').not.toBe(mounted)
    // Every channel has fallen silent well past its budget: nothing may still assert health.
    expect(view.root().dataset.rc14Decision).toBe('unavailable')
    expect(view.root().dataset.rc14MonitoredSources).toBe('0')
    expect(
      view.root().querySelector('[data-rc14-zone="carSilhouette"]')?.getAttribute('data-rc14-unmonitored-zones')
    ).toBe('8')
    view.unmount()
  }, 30_000)
})

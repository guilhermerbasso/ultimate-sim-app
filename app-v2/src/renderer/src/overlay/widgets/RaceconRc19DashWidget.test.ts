// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOverlayStyle, type OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { RaceconRc19DashWidget } from './RaceconRc19DashWidget'
import { RACECON_DISPLAY_CLOCK_INTERVAL_MS, raceconDisplayClockFrozen } from './raceconDisplayClock'
import { createRc01ChannelReceipts } from './raceconRc01Core'
import {
  RC19_APP_HEIGHT_PX,
  RC19_APP_WIDTH_PX,
  RC19_APP_ZONES,
  RC19_CARRIED_FAULT_MIN_VISIBLE_MS,
  RC19_CHANNEL_STALE_MS,
  RC19_CHECKLIST_ITEMS,
  RC19_CHECKLIST_ITEM_IDS,
  RC19_COMPACT_ALERT_FLOOR_PCT,
  RC19_CONFIRM_EVENT,
  RC19_CORNERS,
  RC19_CORNER_CHANNELS,
  RC19_CRITICAL_ITEM_IDS,
  RC19_DASH,
  RC19_FAULTS_NONE,
  RC19_FAULTS_NO_SOURCE,
  RC19_FAULT_WARNINGS,
  RC19_KPA_PER_BAR,
  RC19_NATIVE_ALERT_FLOOR_PX,
  RC19_NATIVE_HEIGHT_PX,
  RC19_NATIVE_WIDTH_PX,
  RC19_NATIVE_ZONES,
  RC19_PACKET_OMISSIONS,
  RC19_PRESET_ID,
  RC19_REGISTRATION,
  RC19_TIMELINE_NO_SOURCE,
  RC19_TOKENS,
  RC19_TYPE_SCALE_PX,
  RC19_WIDGET_ID,
  type Rc19AlertInput,
  Rc19ChannelBuffer,
  Rc19ChecklistBoard,
  type Rc19Rect,
  Rc19StintTracker,
  type Rc19ZoneMap,
  advanceRc19Alerts,
  clearInvalidRc19Alerts,
  createRc19AlertState,
  createRc19DashboardModel,
  createRc19Receipts,
  rc19ActiveFaults,
  rc19AlertLines,
  rc19ChannelValue,
  rc19ChecklistDescription,
  rc19CompactModeForContentBox,
  rc19CrewCommandFromEvent,
  rc19InBox,
  rc19LayoutForContentBox,
  rc19NestedRect,
  rc19Percent,
  rc19PhoneGeometryForContentBox,
  rc19ReadinessFor,
  rc19RectContains,
  rc19RectsOverlap,
  rc19TypeScaleCqw,
  rc19ZoneStyle,
  rc19ZonesForLayout
} from './raceconRc19Core'

const config: OverlayWidgetConfig = {
  id: 'raceconRc01Dash',
  enabled: true,
  locked: true,
  favorite: false,
  position: { x: 0, y: 0, width: RC19_APP_WIDTH_PX, height: RC19_APP_HEIGHT_PX },
  opacity: 100,
  stylePreset: 'minimal',
  style: createDefaultOverlayStyle(),
  display: null
}

const nativeConfig: OverlayWidgetConfig = {
  ...config,
  position: { x: 0, y: 0, width: RC19_NATIVE_WIDTH_PX, height: RC19_NATIVE_HEIGHT_PX }
}

/**
 * The approved RC-19 reference state (attempt-003 governed 800x480,
 * `input/telemetry-frame-driver-swap-2-outstanding.json`): an endurance driver change with the
 * car stationary in its box. Fuel laps 12.6 on a measured 2.94 L/lap burn model, three TPMS
 * corners reporting and the right rear invalid, TC step 4, a present fault channel reporting
 * zero active faults, and all three packet section 15 alerts ARMED.
 *
 * `tyres.rr` deliberately carries no `pressureKpa`: that IS the reference frame's condition and
 * it is why the RR cell dashes instead of borrowing its neighbour's number.
 */
function snapshot(overrides: Partial<TelemetrySnapshot> = {}, timestamp = 6_120_000): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp,
    sessionUniqueId: 91,
    speedKmh: 0,
    gear: 0,
    throttle: 0,
    brake: 0,
    clutch: 1,
    sessionType: 'Race',
    sessionState: 'racing',
    currentLap: 29,
    completedLaps: 28,
    position: 4,
    playerCarIdx: 7,
    tcLevel: 4,
    fuelLiters: 37.04,
    fuelPerLapLiters: 2.94,
    fuelLapsRemaining: 12.6,
    waterTempC: 88,
    voltage: 13.4,
    damagePct: 0,
    engineWarnings: {
      waterTemp: false,
      fuelPressure: false,
      oilPressure: false,
      oilTemp: false,
      stalled: false,
      pitLimiter: true,
      revLimiter: false,
      mandRepair: false,
      optRepair: false
    },
    onPitRoad: true,
    pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: true, inPitStall: true },
    tyres: {
      lf: { pressureKpa: 194 },
      rf: { pressureKpa: 197 },
      lr: { pressureKpa: 191 },
      rr: {}
    },
    ...overrides
  } as TelemetrySnapshot
}

function markup(value: TelemetrySnapshot | null, cfg = config): string {
  return renderToStaticMarkup(createElement(RaceconRc19DashWidget, { snapshot: value, config: cfg }))
}

/** Rendered text only. Geometry percentages in the markup must never satisfy a value assertion. */
function text(html: string): string {
  return html.replace(/<[^>]*>/g, ' ')
}

function assertClean(value: string): void {
  expect(value).not.toContain('\uFFFD')
  expect(value).not.toContain('NaN')
  expect(value).not.toContain('undefined')
  expect(value).not.toContain('[object Object]')
}

/** A board with an explicit crew confirmation for each named item; nothing else is touched. */
function boardWith(...confirmed: readonly (typeof RC19_CHECKLIST_ITEM_IDS)[number][]): Rc19ChecklistBoard {
  let board = new Rc19ChecklistBoard()
  for (const item of confirmed) board = board.apply({ kind: 'set', item, state: 'CONFIRMED' })
  return board
}

function modelFor(
  value: TelemetrySnapshot | null,
  nowMs = 0,
  options: Parameters<typeof createRc19DashboardModel>[3] = {},
  receiptsAtMs = nowMs
): ReturnType<typeof createRc19DashboardModel> {
  const receipts = value ? createRc19Receipts(value, receiptsAtMs) : new Map()
  return createRc19DashboardModel(value, receipts, nowMs, options)
}

function alertInput(overrides: Partial<Rc19AlertInput> = {}): Rc19AlertInput {
  return {
    nowMs: 0,
    handoverActive: true,
    criticalPending: [],
    activeFaults: [],
    burnModelValid: true,
    telemetryPresent: true,
    ...overrides
  }
}

function right(rect: Rc19Rect): number {
  return rect.left + rect.width
}

function bottom(rect: Rc19Rect): number {
  return rect.top + rect.height
}

function requireRect(zones: Rc19ZoneMap, id: keyof Rc19ZoneMap): Rc19Rect {
  const rect = zones[id]
  if (!rect) throw new Error(`Missing RC-19 zone ${String(id)}`)
  return rect
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// ─────────────────────────────────────────────────────────── packet contract

describe('RC-19 packet omissions are a declared contract', () => {
  it('names every packet requirement this build does not render, with a reason', () => {
    expect(Object.keys(RC19_PACKET_OMISSIONS).sort()).toEqual([
      'absStep',
      'brakeBiasStep',
      'checklistChannel',
      'deltaToBest',
      'driverIdentity',
      'engineMapStep',
      'fuelPlan',
      'stintPlanTimeline',
      'targetLaps',
      'tertiaryOnNative',
      'tyrePlan',
      'tyreSetIdentity',
      'weatherNote'
    ])
    for (const reason of Object.values(RC19_PACKET_OMISSIONS)) {
      expect(reason.length).toBeGreaterThan(24)
    }
  })

  it('records GAP-1: the artifact primary channel has no section 16 row and never auto-confirms', () => {
    expect(RC19_PACKET_OMISSIONS.checklistChannel).toContain('GAP-1')
    expect(RC19_PACKET_OMISSIONS.checklistChannel).toContain('never auto-confirmed')
  })

  it('records GAP-3 for the three settings the packet names and section 16 never defines', () => {
    expect(RC19_PACKET_OMISSIONS.absStep).toContain('GAP-3')
    expect(RC19_PACKET_OMISSIONS.engineMapStep).toContain('GAP-3')
    expect(RC19_PACKET_OMISSIONS.brakeBiasStep).toContain('GAP-3')
  })

  it('records GAP-4 for the whole next-stint plan and refuses to derive it', () => {
    expect(RC19_PACKET_OMISSIONS.targetLaps).toContain('never derived from fuel laps')
    expect(RC19_PACKET_OMISSIONS.fuelPlan).toContain('never burn rate x an absent target')
    expect(RC19_PACKET_OMISSIONS.tyrePlan).toContain('GAP-4')
    expect(RC19_PACKET_OMISSIONS.weatherNote).toContain('GAP-4')
  })

  it('refuses to synthesise the driver identity a handover page invites', () => {
    expect(RC19_PACKET_OMISSIONS.driverIdentity).toContain('no driver name, stint number or handover countdown')
  })

  it('publishes the registration facts the catalog wiring PR consumes', () => {
    expect(RC19_WIDGET_ID).toBe('raceconRc19Dash')
    expect(RC19_PRESET_ID).toBe('racecon_rc19_dash')
    expect(RC19_REGISTRATION.overlayWidgetIdUnionMember).toBe(RC19_WIDGET_ID)
    expect(RC19_REGISTRATION.widgetComponentsKey).toBe(RC19_WIDGET_ID)
    expect(RC19_REGISTRATION.widgetComponentsExport).toBe('RaceconRc19DashWidget')
    expect(RC19_REGISTRATION.preset.id).toBe(RC19_PRESET_ID)
    expect(RC19_REGISTRATION.preset.widgetId).toBe(RC19_WIDGET_ID)
    expect(RC19_REGISTRATION.preset.scaleMode).toBe('stretch')
    expect(RC19_REGISTRATION.preset.tags).toContain('racecon')
    expect(RC19_REGISTRATION.embedRow).toEqual({
      id: RC19_PRESET_ID,
      widgetId: RC19_WIDGET_ID,
      name: RC19_REGISTRATION.preset.name,
      family: 'racecon'
    })
    // A full-frame responsive instrument that refuses mock and replay telemetry.
    expect(RC19_REGISTRATION.responsiveFullFrame).toBe(true)
    expect(RC19_REGISTRATION.identityScoped).toBe(true)
  })

  it('carries packet 11.3 colour tokens verbatim', () => {
    expect(RC19_TOKENS).toEqual({
      bg: '#0A0D11',
      panel: '#151B22',
      primary: '#EAEFF3',
      secondary: '#8B99A6',
      info: '#40BEDC',
      normal: '#46C86E',
      caution: '#FFB52E',
      danger: '#FF3F30',
      signature: '#34E0C0'
    })
  })

  it('builds the packet 11.2 type ladder from its own nominals, strictly decreasing', () => {
    expect(RC19_TYPE_SCALE_PX).toEqual({ readiness: 40, value: 30, item: 24, label: 15 })
    const ladder = [RC19_TYPE_SCALE_PX.readiness, RC19_TYPE_SCALE_PX.value, RC19_TYPE_SCALE_PX.item, RC19_TYPE_SCALE_PX.label]
    for (let index = 1; index < ladder.length; index += 1) {
      // Blocking criterion B12 on the approved frame: no adjacent tie, every ratio >= 1.12.
      expect(ladder[index - 1] / ladder[index]).toBeGreaterThanOrEqual(1.12)
    }
    expect(rc19TypeScaleCqw(RC19_TYPE_SCALE_PX.readiness)).toBe(5)
    expect(rc19TypeScaleCqw(RC19_TYPE_SCALE_PX.value)).toBe(3.75)
    expect(rc19TypeScaleCqw(RC19_TYPE_SCALE_PX.item)).toBe(3)
    expect(rc19TypeScaleCqw(RC19_TYPE_SCALE_PX.label)).toBe(1.875)
  })
})

// ─────────────────────────────────────────────────────────── zone geometry

describe('RC-19 zone geometry is packet 11.1 and 12.1 arithmetic', () => {
  it('converts every packet 11.1 native rectangle exactly, over the reserved alert floor', () => {
    expect(RC19_NATIVE_ZONES.header).toEqual({ left: 2, top: 2.5, width: 96, height: 9.167 })
    // OV-15: the columns stop 30px above the frame floor so the 24.50px alert strip has a band of
    // its own. Packet 11.1 ran them to y=460 and the strip overlapped the confirm control by
    // 3.47px whenever an alert was up.
    expect(RC19_NATIVE_ALERT_FLOOR_PX).toBe(30)
    expect(RC19_NATIVE_ZONES.carState).toEqual({ left: 2, top: 13.75, width: 31.25, height: 80 })
    expect(RC19_NATIVE_ZONES.checklist).toEqual({ left: 35.25, top: 13.75, width: 29.5, height: 80 })
    expect(RC19_NATIVE_ZONES.nextStint).toEqual({ left: 66.75, top: 13.75, width: 31.25, height: 80 })
    expect(RC19_NATIVE_ZONES.confirm).toEqual({ left: 35.25, top: 83.333, width: 29.5, height: 10.417 })
    // OV-2: the checklist list area is the governed sub-zone above the nested control.
    expect(RC19_NATIVE_ZONES.checklistList).toEqual({ left: 35.25, top: 13.75, width: 29.5, height: 69.583 })
    // Every column floor lands on the reserved band, never inside it.
    for (const id of ['carState', 'checklist', 'nextStint', 'confirm'] as const) {
      const rect = requireRect(RC19_NATIVE_ZONES, id)
      expect(bottom(rect)).toBeCloseTo(100 - (RC19_NATIVE_ALERT_FLOOR_PX / 480) * 100, 3)
    }
  })

  it('converts every packet 12.1 app rectangle exactly, plus the two governed additions', () => {
    expect(RC19_APP_ZONES.header).toEqual({ left: 0, top: 0, width: 100, height: 8.667 })
    expect(RC19_APP_ZONES.carState).toEqual({ left: 2.344, top: 10.667, width: 31.25, height: 83.333 })
    expect(RC19_APP_ZONES.checklist).toEqual({ left: 35.156, top: 10.667, width: 29.297, height: 83.333 })
    expect(RC19_APP_ZONES.nextStint).toEqual({ left: 66.016, top: 10.667, width: 31.64, height: 56.666 })
    expect(RC19_APP_ZONES.timeline).toEqual({ left: 66.016, top: 70, width: 31.64, height: 24 })
    // OV-1: packet 12.1 gives the confirm control no app zone at all.
    expect(RC19_APP_ZONES.confirm).toEqual({ left: 35.156, top: 83.667, width: 29.297, height: 9 })
    // OV-6: the tertiary strip packet 10 names and neither 11.1 nor 12.1 places.
    expect(RC19_APP_ZONES.tertiary).toEqual({ left: 2.344, top: 80, width: 31.25, height: 14 })
    expect(RC19_APP_ZONES.checklistList).toEqual({ left: 35.156, top: 10.667, width: 29.297, height: 71.666 })
    expect(RC19_APP_ZONES.carStateBody).toEqual({ left: 2.344, top: 10.667, width: 31.25, height: 69.333 })
  })

  it('keeps the three procedural columns disjoint with the packet gutters intact', () => {
    for (const layout of ['native', 'app'] as const) {
      const zones = rc19ZonesForLayout(layout)
      const car = requireRect(zones, 'carState')
      const check = requireRect(zones, 'checklist')
      const next = requireRect(zones, 'nextStint')
      expect(rc19RectsOverlap(car, check)).toBe(false)
      expect(rc19RectsOverlap(check, next)).toBe(false)
      expect(check.left).toBeGreaterThan(right(car))
      expect(next.left).toBeGreaterThan(right(check))
      // Blocking criterion B11 on the approved frame: the three columns share one axis.
      expect(car.top).toBeCloseTo(check.top, 3)
      expect(check.top).toBeCloseTo(next.top, 3)
    }
  })

  it('nests the confirm control inside the checklist column on both canvases (OV-1, OV-2)', () => {
    for (const layout of ['native', 'app', 'compact'] as const) {
      const zones = rc19ZonesForLayout(layout)
      const check = requireRect(zones, 'checklist')
      const confirm = requireRect(zones, 'confirm')
      const list = requireRect(zones, 'checklistList')
      expect(rc19RectContains(check, confirm)).toBe(true)
      expect(rc19RectContains(check, list)).toBe(true)
      // The six rows never collide with the control they sit above.
      expect(rc19RectsOverlap(list, confirm)).toBe(false)
      expect(bottom(list)).toBeLessThanOrEqual(confirm.top + 1e-6)
    }
  })

  it('nests the app tertiary strip inside the car-state column below its body (OV-6)', () => {
    const car = requireRect(RC19_APP_ZONES, 'carState')
    const body = requireRect(RC19_APP_ZONES, 'carStateBody')
    const tertiary = requireRect(RC19_APP_ZONES, 'tertiary')
    expect(rc19RectContains(car, tertiary)).toBe(true)
    expect(rc19RectContains(car, body)).toBe(true)
    expect(rc19RectsOverlap(body, tertiary)).toBe(false)
    expect(rc19NestedRect(tertiary, car).top).toBeCloseTo(83.2, 1)
  })

  it('reflows rather than scaling from 800x480 to 1024x600', () => {
    // The header goes edge to edge on the app canvas and is inset on the native one; the app
    // additionally reveals a timeline and a tertiary strip the native canvas does not carry.
    expect(RC19_NATIVE_ZONES.header?.left).toBe(2)
    expect(RC19_APP_ZONES.header?.left).toBe(0)
    expect(RC19_APP_ZONES.header?.width).toBe(100)
    expect(RC19_NATIVE_ZONES.timeline).toBeUndefined()
    expect(RC19_NATIVE_ZONES.tertiary).toBeUndefined()
    expect(RC19_APP_ZONES.timeline).toBeDefined()
    expect(RC19_APP_ZONES.tertiary).toBeDefined()
    // A uniform scale would leave the column heights proportionally identical; they do not.
    expect(RC19_NATIVE_ZONES.nextStint?.height).not.toBeCloseTo(RC19_APP_ZONES.nextStint?.height ?? 0, 1)
  })

  it('keeps every zone inside its canvas at every breakpoint', () => {
    const canvas: Rc19Rect = { left: 0, top: 0, width: 100, height: 100 }
    const maps: Rc19ZoneMap[] = [
      rc19ZonesForLayout('native'),
      rc19ZonesForLayout('app'),
      rc19ZonesForLayout('compact', 'standard'),
      rc19ZonesForLayout('compact', 'landscape'),
      rc19ZonesForLayout('compact', 'phone')
    ]
    for (const zones of maps) {
      for (const rect of Object.values(zones)) {
        expect(rc19RectContains(canvas, rect)).toBe(true)
      }
    }
  })

  it('stacks the phone canvas without a single module overlapping another', () => {
    const zones = rc19ZonesForLayout('compact', 'phone')
    const order: Array<keyof Rc19ZoneMap> = ['header', 'carState', 'checklist', 'nextStint']
    for (let index = 1; index < order.length; index += 1) {
      const previous = requireRect(zones, order[index - 1])
      const current = requireRect(zones, order[index])
      expect(rc19RectsOverlap(previous, current)).toBe(false)
      expect(current.top).toBeGreaterThanOrEqual(bottom(previous))
    }
    expect(zones.timeline).toBeUndefined()
  })

  it('reserves an alert floor band on every canvas, not only the compact ones', () => {
    // A real-browser audit measured the engaged alert strip covering the FAULTS row and the
    // CONFIRM READY label at 812x375 and 640x520, and later overlapping the CONFIRM READY control
    // by 3.47 px at 800x480: the packet's own canvases leave 20 px and 36 px of bare bg below the
    // columns, the 24.50 px native strip did not fit in 20 px, and a compact canvas has no band at
    // all. Every canvas now reserves one.
    expect(RC19_COMPACT_ALERT_FLOOR_PCT).toBeGreaterThanOrEqual(5)
    for (const mode of ['standard', 'landscape'] as const) {
      const zones = rc19ZonesForLayout('compact', mode)
      for (const id of ['carState', 'checklist', 'nextStint', 'confirm'] as const) {
        expect(bottom(requireRect(zones, id))).toBeLessThanOrEqual(100 - RC19_COMPACT_ALERT_FLOOR_PCT + 1e-6)
      }
    }
    const phone = rc19ZonesForLayout('compact', 'phone')
    expect(bottom(requireRect(phone, 'nextStint'))).toBeLessThanOrEqual(96)
    // OV-15: the native band is reserved in pixels and must clear the measured strip height.
    expect(RC19_NATIVE_ALERT_FLOOR_PX).toBeGreaterThan(24.5)
    expect(bottom(requireRect(RC19_NATIVE_ZONES, 'carState'))).toBeCloseTo(93.75, 3)
    // The app canvas already leaves 36 px below its columns for a 27.48 px strip.
    expect(bottom(requireRect(RC19_APP_ZONES, 'carState'))).toBeCloseTo(94, 3)
  })

  it('emits geometry as clean CSS percentages', () => {
    expect(rc19Percent(35.25)).toBe('35.25%')
    expect(rc19Percent(Number.NaN)).toBe('0%')
    expect(rc19ZoneStyle(undefined)).toBeNull()
    expect(rc19ZoneStyle({ left: 2, top: 2.5, width: 96, height: 9.167 })).toEqual({
      left: '2%',
      top: '2.5%',
      width: '96%',
      height: '9.167%'
    })
  })
})

// ─────────────────────────────────────────────────────────── layout resolution

describe('RC-19 layout resolution', () => {
  it('resolves the packet canvases and everything between them', () => {
    expect(rc19LayoutForContentBox(800, 480)).toBe('native')
    expect(rc19LayoutForContentBox(801, 479)).toBe('native')
    expect(rc19LayoutForContentBox(802, 480)).toBe('compact')
    expect(rc19LayoutForContentBox(1024, 600)).toBe('app')
    expect(rc19LayoutForContentBox(1440, 900)).toBe('app')
    expect(rc19LayoutForContentBox(640, 400)).toBe('compact')
    expect(rc19LayoutForContentBox(0, 0)).toBe('app')
    expect(rc19LayoutForContentBox(Number.NaN, 600)).toBe('app')
  })

  it('resolves the compact sub-modes from the measured box only', () => {
    expect(rc19CompactModeForContentBox(390, 844)).toBe('phone')
    expect(rc19CompactModeForContentBox(812, 375)).toBe('landscape')
    expect(rc19CompactModeForContentBox(640, 520)).toBe('standard')
    expect(rc19CompactModeForContentBox(1024, 600)).toBe('standard')
    expect(rc19PhoneGeometryForContentBox(390, 844)).not.toBeNull()
    expect(rc19PhoneGeometryForContentBox(812, 375)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────── crew checklist (GAP-1)

describe('RC-19 swap checklist is crew input, never telemetry', () => {
  it('carries the packet 11.1 items with belts and seat as the critical pair', () => {
    expect(RC19_CHECKLIST_ITEM_IDS).toEqual(['SEAT', 'BELTS', 'WHEEL', 'RADIO', 'DRINKS', 'MIRRORS'])
    expect(RC19_CHECKLIST_ITEMS).toHaveLength(6)
    expect(RC19_CRITICAL_ITEM_IDS).toEqual(['SEAT', 'BELTS'])
  })

  it('starts every item PENDING and never auto-confirms one', () => {
    const board = new Rc19ChecklistBoard()
    for (const id of RC19_CHECKLIST_ITEM_IDS) expect(board.stateOf(id)).toBe('PENDING')
    expect(board.outstanding()).toHaveLength(6)
    expect(board.readyLatched()).toBe(false)
    // A model built from a full, fresh, healthy telemetry frame still confirms nothing.
    expect(modelFor(snapshot()).checklist.every((row) => row.state === 'PENDING')).toBe(true)
  })

  it('accepts only recognised crew macros', () => {
    expect(rc19CrewCommandFromEvent('SEAT')).toEqual({ kind: 'set', item: 'SEAT', state: 'CONFIRMED' })
    expect(rc19CrewCommandFromEvent(' belts ')).toEqual({ kind: 'set', item: 'BELTS', state: 'CONFIRMED' })
    expect(rc19CrewCommandFromEvent({ item: 'WHEEL', state: 'PENDING' })).toEqual({
      kind: 'set',
      item: 'WHEEL',
      state: 'PENDING'
    })
    expect(rc19CrewCommandFromEvent('RESET')).toEqual({ kind: 'reset' })
    expect(rc19CrewCommandFromEvent({ command: 'CONFIRM READY' })).toEqual({ kind: 'latch' })
    expect(rc19CrewCommandFromEvent('CONFIRM-READY')).toEqual({ kind: 'latch' })
    // Anything else can never confirm a safety item on the incoming driver's behalf.
    expect(rc19CrewCommandFromEvent('HELMET')).toBeNull()
    expect(rc19CrewCommandFromEvent({ item: 'SEAT', state: 'MAYBE' })).toBeNull()
    expect(rc19CrewCommandFromEvent({ item: 42 })).toBeNull()
    expect(rc19CrewCommandFromEvent(null)).toBeNull()
    expect(rc19CrewCommandFromEvent(undefined)).toBeNull()
    expect(rc19CrewCommandFromEvent(7)).toBeNull()
  })

  it('derives readiness arithmetically from the item states (OV-12)', () => {
    expect(rc19ReadinessFor(new Rc19ChecklistBoard())).toMatchObject({
      ready: false,
      word: 'NOT READY',
      outstandingCount: 6
    })
    const partial = rc19ReadinessFor(boardWith('SEAT', 'BELTS', 'WHEEL', 'RADIO'))
    expect(partial).toMatchObject({ ready: false, word: 'NOT READY', outstandingCount: 2 })
    expect(partial.criticalOutstanding).toEqual([])
    const all = boardWith(...RC19_CHECKLIST_ITEM_IDS)
    expect(rc19ReadinessFor(all).outstandingCount).toBe(0)
    // Every item confirmed is still NOT READY until the crew latches the control.
    expect(rc19ReadinessFor(all).ready).toBe(false)
    expect(rc19ReadinessFor(all.apply({ kind: 'latch' }))).toMatchObject({ ready: true, word: 'READY' })
  })

  it('refuses to latch READY while anything is outstanding, and drops a latch on retraction', () => {
    const gated = boardWith('SEAT', 'BELTS').apply({ kind: 'latch' })
    expect(gated.readyLatched()).toBe(false)
    const latched = boardWith(...RC19_CHECKLIST_ITEM_IDS).apply({ kind: 'latch' })
    expect(latched.readyLatched()).toBe(true)
    const retracted = latched.apply({ kind: 'set', item: 'BELTS', state: 'PENDING' })
    expect(retracted.readyLatched()).toBe(false)
    expect(rc19ReadinessFor(retracted).word).toBe('NOT READY')
    expect(retracted.criticalOutstanding()).toEqual(['BELTS'])
  })

  it('empties the board on reset so a new crew never inherits a confirmation', () => {
    const board = boardWith(...RC19_CHECKLIST_ITEM_IDS).apply({ kind: 'latch' })
    const cleared = board.apply({ kind: 'reset' })
    expect(cleared.outstanding()).toHaveLength(6)
    expect(cleared.readyLatched()).toBe(false)
    // The original is untouched: the board is cloned, never mutated in place.
    expect(board.readyLatched()).toBe(true)
  })

  it('states each row in words for a screen reader, never in colour alone', () => {
    const model = modelFor(snapshot(), 0, { board: boardWith('SEAT') })
    expect(rc19ChecklistDescription(model.checklist[0])).toBe('SEAT: CONFIRMED, critical')
    expect(rc19ChecklistDescription(model.checklist[1])).toBe('BELTS: PENDING, critical')
    expect(rc19ChecklistDescription(model.checklist[4])).toBe('DRINKS: PENDING')
  })
})

// ─────────────────────────────────────────────────────────── telemetry truth

describe('RC-19 telemetry truth table', () => {
  it('reads every channel from its own declared source', () => {
    const frame = snapshot()
    expect(rc19ChannelValue(frame, 'fuelLaps')).toBeCloseTo(12.6, 3)
    expect(rc19ChannelValue(frame, 'fuelPerLap')).toBeCloseTo(2.94, 3)
    expect(rc19ChannelValue(frame, 'tc')).toBe(4)
    expect(rc19ChannelValue(frame, 'lapCounter')).toBe(28)
    expect(rc19ChannelValue(frame, 'faults')).toBe(0)
    expect(rc19ChannelValue(frame, 'waterTemp')).toBe(88)
    expect(rc19ChannelValue(frame, 'voltage')).toBe(13.4)
    expect(rc19ChannelValue(frame, 'pitContext')).toBe(1)
  })

  it('converts TPMS kPa into the packet unit of bar, per corner, never mirrored', () => {
    const frame = snapshot()
    expect(RC19_KPA_PER_BAR).toBe(100)
    expect(rc19ChannelValue(frame, RC19_CORNER_CHANNELS.LF)).toBeCloseTo(1.94, 4)
    expect(rc19ChannelValue(frame, RC19_CORNER_CHANNELS.RF)).toBeCloseTo(1.97, 4)
    expect(rc19ChannelValue(frame, RC19_CORNER_CHANNELS.LR)).toBeCloseTo(1.91, 4)
    // The right rear has no sensor reading: it is null, and it is never LR's number.
    expect(rc19ChannelValue(frame, RC19_CORNER_CHANNELS.RR)).toBeNull()
    const model = modelFor(frame)
    expect(model.tyres.map((corner) => corner.field.value)).toEqual(['1.94', '1.97', '1.91', RC19_DASH])
    expect(model.tyres[3].field.unavailable).toBe(true)
    expect(RC19_CORNERS).toEqual(['LF', 'RF', 'LR', 'RR'])
  })

  it('refuses to project fuel laps before a measured burn rate exists', () => {
    const noModel = snapshot({ fuelPerLapLiters: undefined, fuelPerLap: undefined, fuelPerLapKg: undefined })
    expect(rc19ChannelValue(noModel, 'fuelLaps')).toBeNull()
    expect(rc19ChannelValue(noModel, 'fuelPerLap')).toBeNull()
    const model = modelFor(noModel)
    expect(model.fuelLaps.value).toBe(RC19_DASH)
    expect(model.fuelLaps.unavailable).toBe(true)
    expect(model.burnModelValid).toBe(false)
    // The tank level alone is never enough: 37 litres is present and still yields no laps.
    expect(noModel.fuelLiters).toBeCloseTo(37.04, 2)
  })

  it('holds the last-known TC step greyed when the bus goes quiet, and never assumes a default', () => {
    const frame = snapshot()
    const receipts = createRc19Receipts(frame, 0)
    const fresh = createRc19DashboardModel(frame, receipts, 0)
    expect(fresh.tc.value).toBe('4')
    expect(fresh.tc.stale).toBe(false)

    const quiet = createRc19DashboardModel(frame, receipts, RC19_CHANNEL_STALE_MS.tc + 1)
    expect(quiet.tc.value).toBe('4')
    expect(quiet.tc.stale).toBe(true)
    expect(quiet.tc.tone).toBe('muted')

    const never = modelFor(snapshot({ tcLevel: undefined }))
    expect(never.tc.value).toBe(RC19_DASH)
    expect(never.tc.unavailable).toBe(true)
  })

  it('reads the fault map from real fault channels only, and never from an operating state', () => {
    // The reference frame has the pit limiter engaged; that is a state, not a carried fault.
    expect(RC19_FAULT_WARNINGS).not.toContain('pitLimiter')
    expect(RC19_FAULT_WARNINGS).not.toContain('revLimiter')
    expect(rc19ActiveFaults(snapshot())).toEqual([])
    expect(modelFor(snapshot()).faults.label).toBe(RC19_FAULTS_NONE)

    const faulted = snapshot({
      engineWarnings: {
        waterTemp: true,
        fuelPressure: false,
        oilPressure: false,
        oilTemp: false,
        stalled: false,
        pitLimiter: true,
        revLimiter: true,
        mandRepair: false,
        optRepair: false
      },
      damagePct: 12
    })
    expect(rc19ActiveFaults(faulted)).toEqual(['WATER TEMP', 'DAMAGE'])
  })

  it('hides the fault briefing entirely when no fault channel exists, and never invents one', () => {
    const blind = snapshot({ engineWarnings: undefined, damagePct: undefined })
    expect(rc19ActiveFaults(blind)).toBeNull()
    const model = modelFor(blind)
    expect(model.faults.available).toBe(false)
    expect(model.faults.active).toEqual([])
    expect(model.faults.label).toBe(RC19_FAULTS_NO_SOURCE)
  })

  it('dashes every field packet 11.1 demands and section 16 never gave a channel', () => {
    const model = modelFor(snapshot())
    for (const unbacked of [model.abs, model.engineMap, model.brakeBias, model.targetLaps, model.fuelPlan, model.tyrePlan, model.weatherNote]) {
      expect(unbacked.value).toBe(RC19_DASH)
      expect(unbacked.unavailable).toBe(true)
      expect(unbacked.raw).toBeNull()
    }
    // The measured burn rate is the ONLY real number in the next-stint column.
    expect(model.fuelPerLap.value).toBe('2.94')
    expect(model.fuelPerLap.unavailable).toBe(false)
  })

  it('renders the app-only tertiary channels and hides delta to best on every canvas', () => {
    const model = modelFor(snapshot())
    expect(model.waterTemp.value).toBe('88')
    expect(model.voltage.value).toBe('13.4')
    expect(Object.keys(model)).not.toContain('delta')
    expect(markup(snapshot(), nativeConfig)).not.toContain('rc19-water-temp')
    expect(markup(snapshot())).toContain('rc19-water-temp')
  })

  it('degrades a channel that falls silent instead of freezing on its value', () => {
    const frame = snapshot()
    const receipts = createRc19Receipts(frame, 0)
    const stale = createRc19DashboardModel(frame, receipts, RC19_CHANNEL_STALE_MS.tyreLf + 1)
    expect(stale.tyres[0].field.value).toBe(RC19_DASH)
    expect(stale.tyres[0].field.stale).toBe(true)
    const water = createRc19DashboardModel(frame, receipts, RC19_CHANNEL_STALE_MS.waterTemp + 1)
    expect(water.waterTemp.value).toBe(RC19_DASH)
    expect(water.waterTemp.stale).toBe(true)
  })

  it('writes a receipt only for a channel that actually reported', () => {
    const buffer = new Rc19ChannelBuffer()
    buffer.ingest(snapshot({ tcLevel: undefined, waterTempC: undefined }), 0)
    const receipts = buffer.receipts()
    expect(receipts.has('tc')).toBe(false)
    expect(receipts.has('waterTemp')).toBe(false)
    expect(receipts.has('fuelPerLap')).toBe(true)
    // A disconnected frame writes nothing at all.
    const blank = new Rc19ChannelBuffer()
    blank.ingest(snapshot({ connected: false }), 0)
    expect(blank.receipts().size).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────── measured stint boundary

describe('RC-19 stint lap count is measured, never carried across an unmarked boundary', () => {
  it('dashes on a mid-stint mount because no pit exit was ever observed', () => {
    const tracker = new Rc19StintTracker()
    tracker.observe(snapshot())
    expect(tracker.marked()).toBe(false)
    expect(tracker.lapsSinceStart(snapshot())).toBeNull()
    const model = modelFor(snapshot(), 0, { stint: tracker })
    expect(model.stintLaps.value).toBe(RC19_DASH)
    expect(model.stintLaps.unavailable).toBe(true)
  })

  it('marks the stint at the observed pit exit and counts laps from there', () => {
    const tracker = new Rc19StintTracker()
    tracker.observe(snapshot({ completedLaps: 4, onPitRoad: true, pit: undefined }))
    tracker.observe(snapshot({ completedLaps: 4, onPitRoad: false, pit: undefined }))
    expect(tracker.marked()).toBe(true)
    const later = snapshot({ completedLaps: 32, onPitRoad: false, pit: undefined })
    expect(tracker.lapsSinceStart(later)).toBe(28)
    const model = modelFor(later, 0, { stint: tracker })
    expect(model.stintLaps.value).toBe('28')
  })

  it('drops the boundary when the provider changes laptrigger field mid-stint', () => {
    const tracker = new Rc19StintTracker()
    tracker.observe(snapshot({ completedLaps: 4, onPitRoad: true, pit: undefined }))
    tracker.observe(snapshot({ completedLaps: 4, onPitRoad: false, pit: undefined }))
    const switched = snapshot({ completedLaps: undefined, currentLap: 33, onPitRoad: false, pit: undefined })
    expect(tracker.lapsSinceStart(switched)).toBeNull()
  })

  it('forgets the boundary on reset so a new source never inherits a stint', () => {
    const tracker = new Rc19StintTracker()
    tracker.observe(snapshot({ completedLaps: 4, onPitRoad: true, pit: undefined }))
    tracker.observe(snapshot({ completedLaps: 4, onPitRoad: false, pit: undefined }))
    tracker.reset()
    expect(tracker.marked()).toBe(false)
    expect(tracker.lapsSinceStart(snapshot({ completedLaps: 40 }))).toBeNull()
  })

  it('greys the count when the lap counter itself goes quiet', () => {
    const tracker = new Rc19StintTracker()
    tracker.observe(snapshot({ completedLaps: 4, onPitRoad: true, pit: undefined }))
    tracker.observe(snapshot({ completedLaps: 4, onPitRoad: false, pit: undefined }))
    const later = snapshot({ completedLaps: 32, onPitRoad: false, pit: undefined })
    const receipts = createRc19Receipts(later, 0)
    const model = createRc19DashboardModel(later, receipts, RC19_CHANNEL_STALE_MS.lapCounter + 1, { stint: tracker })
    expect(model.stintLaps.value).toBe('28')
    expect(model.stintLaps.stale).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────── alerts

describe('RC-19 packet 15 alerts are trigger-only', () => {
  it('is silent in the approved reference state', () => {
    const board = boardWith('SEAT', 'BELTS', 'WHEEL', 'RADIO')
    const model = modelFor(snapshot(), 0, { board })
    const advanced = advanceRc19Alerts(createRc19AlertState(), {
      nowMs: 0,
      handoverActive: model.handover.inBox,
      criticalPending: board.criticalOutstanding(),
      activeFaults: model.faults.active,
      burnModelValid: model.burnModelValid,
      telemetryPresent: model.telemetryPresent
    })
    expect(advanced.safetyItem.active).toBe(false)
    expect(advanced.carriedFault.active).toBe(false)
    expect(advanced.fuelPlanInvalid.active).toBe(false)
    expect(rc19AlertLines(modelFor(snapshot(), 0, { board, alerts: advanced }))).toEqual([])
  })

  it('engages the safety alert only while a critical item is pending during a measured handover', () => {
    const engaged = advanceRc19Alerts(createRc19AlertState(), alertInput({ criticalPending: ['BELTS'] }))
    expect(engaged.safetyItem.active).toBe(true)
    expect(engaged.safetyItem.items).toEqual(['BELTS'])

    // A non-critical item outstanding is packet 11.5 gating, not the alert layer.
    const nonCritical = advanceRc19Alerts(createRc19AlertState(), alertInput({ criticalPending: [] }))
    expect(nonCritical.safetyItem.active).toBe(false)

    // On track, or with no pit channel at all, the page is not a driver swap and stays silent.
    expect(advanceRc19Alerts(createRc19AlertState(), alertInput({ handoverActive: false, criticalPending: ['SEAT'] })).safetyItem.active).toBe(false)
    expect(advanceRc19Alerts(createRc19AlertState(), alertInput({ handoverActive: null, criticalPending: ['SEAT'] })).safetyItem.active).toBe(false)
  })

  it('clears the safety alert the moment the crew confirms, and unlatches on a lost pit channel', () => {
    const engaged = advanceRc19Alerts(createRc19AlertState(), alertInput({ criticalPending: ['SEAT', 'BELTS'] }))
    expect(engaged.safetyItem.active).toBe(true)
    const confirmed = advanceRc19Alerts(engaged, alertInput({ nowMs: 500, criticalPending: [] }))
    expect(confirmed.safetyItem.active).toBe(false)
    expect(confirmed.safetyItem.pendingSinceMs).toBeNull()

    const model = modelFor(snapshot({ onPitRoad: undefined, pit: undefined }))
    expect(model.handover.inBox).toBeNull()
    expect(clearInvalidRc19Alerts(engaged, model).safetyItem.active).toBe(false)
  })

  it('latches the carried fault, holds it briefly and clears it only when serviced', () => {
    const engaged = advanceRc19Alerts(createRc19AlertState(), alertInput({ activeFaults: ['WATER TEMP'] }))
    expect(engaged.carriedFault.active).toBe(true)
    expect(engaged.carriedFault.faults).toEqual(['WATER TEMP'])

    // A single frame reporting zero faults inside the minimum-visible window cannot blink it out.
    const blink = advanceRc19Alerts(engaged, alertInput({ nowMs: RC19_CARRIED_FAULT_MIN_VISIBLE_MS - 1, activeFaults: [] }))
    expect(blink.carriedFault.active).toBe(true)

    const serviced = advanceRc19Alerts(blink, alertInput({ nowMs: RC19_CARRIED_FAULT_MIN_VISIBLE_MS + 1, activeFaults: [] }))
    expect(serviced.carriedFault.active).toBe(false)
    expect(serviced.carriedFault.faults).toEqual([])
  })

  it('unlatches the carried fault when the fault channel disappears, and never invents one', () => {
    const engaged = advanceRc19Alerts(createRc19AlertState(), alertInput({ activeFaults: ['OIL PRESS'] }))
    const blind = advanceRc19Alerts(engaged, alertInput({ nowMs: 10_000, activeFaults: null }))
    expect(blind.carriedFault.active).toBe(false)
    const model = modelFor(snapshot({ engineWarnings: undefined, damagePct: undefined }))
    expect(clearInvalidRc19Alerts(engaged, model).carriedFault.active).toBe(false)
  })

  it('engages the fuel-plan alert on load without a measured burn model and clears with one', () => {
    const engaged = advanceRc19Alerts(createRc19AlertState(), alertInput({ burnModelValid: false }))
    expect(engaged.fuelPlanInvalid.active).toBe(true)
    const cleared = advanceRc19Alerts(engaged, alertInput({ nowMs: 1, burnModelValid: true }))
    expect(cleared.fuelPlanInvalid.active).toBe(false)
  })

  it('keeps the fuel-plan alert silent on a display with no telemetry to judge', () => {
    const blank = advanceRc19Alerts(
      createRc19AlertState(),
      alertInput({ burnModelValid: false, telemetryPresent: false })
    )
    expect(blank.fuelPlanInvalid.active).toBe(false)
    const engaged = advanceRc19Alerts(createRc19AlertState(), alertInput({ burnModelValid: false }))
    expect(clearInvalidRc19Alerts(engaged, modelFor(null)).fuelPlanInvalid.active).toBe(false)
  })

  it('names every engaged alert in words', () => {
    const alerts = advanceRc19Alerts(
      createRc19AlertState(),
      alertInput({ criticalPending: ['SEAT'], activeFaults: ['DAMAGE'], burnModelValid: false })
    )
    const model = modelFor(snapshot(), 0, { alerts })
    expect(rc19AlertLines(model)).toEqual(['SAFETY ITEM UNCONFIRMED', 'CARRIED FAULT', 'FUEL PLAN INVALID'])
  })
})

// ─────────────────────────────────────────────────────────── rendered DOM

describe('RC-19 rendered DOM contract', () => {
  it('renders the readiness header, three columns and the nested confirm control', () => {
    const html = markup(snapshot(), nativeConfig)
    assertClean(html)
    expect(html).toContain(`data-widget="${RC19_WIDGET_ID}"`)
    expect(html).toContain('data-rc19-layout="native"')
    expect(html).toContain('data-rc19-native-size="800x480"')
    expect(html).toContain('data-testid="rc19-header"')
    expect(html).toContain('data-testid="rc19-car-state"')
    expect(html).toContain('data-testid="rc19-checklist"')
    expect(html).toContain('data-testid="rc19-next-stint"')
    expect(html).toContain('data-testid="rc19-confirm"')
    expect(html).toContain('NOT READY')
    expect(html).toContain('6 OUTSTANDING')
    expect(html).toContain('CONFIRM READY')
    expect(html).toContain('CAR STATE')
    expect(html).toContain('SWAP CHECKLIST')
    expect(html).toContain('NEXT STINT')
  })

  it('renders exactly six checklist rows, each with a glyph and a word', () => {
    const html = markup(snapshot(), nativeConfig)
    expect((html.match(/data-testid="rc19-check-row"/g) ?? []).length).toBe(6)
    for (const id of RC19_CHECKLIST_ITEM_IDS) {
      expect(html).toContain(`data-rc19-item="${id}"`)
      expect(html).toContain(`data-testid="rc19-glyph-${id}"`)
      expect(html).toContain(`data-testid="rc19-state-${id}"`)
    }
    expect((html.match(/PENDING/g) ?? []).length).toBeGreaterThanOrEqual(6)
  })

  it('carries the packet 11.1 dash placeholders and never a plausible fake number', () => {
    const html = markup(snapshot(), nativeConfig)
    // A cold mount observed no pit exit, so STINT LAPS honestly dashes too: nine, not eight.
    expect((html.match(/>--</g) ?? []).length).toBe(9)
    expect(html).toContain('1.94')
    expect(html).toContain('1.97')
    expect(html).toContain('1.91')
    expect(html).toContain('12.6')
    expect(html).toContain('2.94')
    expect(html).toContain(RC19_FAULTS_NONE)
    expect(html).not.toContain('N/A')
  })

  it('reaches the approved reference frame of eight dashes once the stint boundary is observed', () => {
    // The approved 800x480 frame reads STINT LAPS 28, which is only legitimate after the
    // widget has SEEN the pit exit that started the stint. Drive that sequence and the ninth
    // dash resolves into a measured count; nothing else changes.
    const view = render(
      createElement(RaceconRc19DashWidget, {
        snapshot: snapshot({ completedLaps: 0, onPitRoad: true }, 6_100_000),
        config: nativeConfig
      })
    )
    view.rerender(
      createElement(RaceconRc19DashWidget, {
        snapshot: snapshot({ completedLaps: 0, onPitRoad: false, pit: undefined }, 6_100_100),
        config: nativeConfig
      })
    )
    view.rerender(
      createElement(RaceconRc19DashWidget, {
        snapshot: snapshot({ completedLaps: 28, onPitRoad: true }, 6_120_000),
        config: nativeConfig
      })
    )
    const html = view.container.innerHTML
    expect((html.match(/>--</g) ?? []).length).toBe(8)
    expect(view.container.querySelector('[data-testid="rc19-stint-laps"]')?.textContent).toBe('28')
  })

  it('renders no shift, rev, gear, speed or pace element anywhere (packet 10 and 11.4)', () => {
    const html = markup(snapshot())
    for (const forbidden of ['led', 'rev', 'shift', 'gear', 'rpm', 'delta']) {
      expect(html.toLowerCase()).not.toContain(`rc19-${forbidden}`)
    }
  })

  it('reveals the app-only timeline and tertiary strip, both honestly empty of a plan', () => {
    const app = markup(snapshot())
    expect(app).toContain('data-testid="rc19-timeline"')
    expect(app).toContain('data-rc19-timeline-segments="0"')
    expect(app).toContain(RC19_TIMELINE_NO_SOURCE)
    expect(app).toContain('data-testid="rc19-tertiary"')
    const native = markup(snapshot(), nativeConfig)
    expect(native).not.toContain('data-testid="rc19-timeline"')
    expect(native).not.toContain('data-testid="rc19-tertiary"')
  })

  it('renders no alert surface at all in a silent frame', () => {
    const board = boardWith('SEAT', 'BELTS')
    const html = renderToStaticMarkup(
      createElement(RaceconRc19DashWidget, { snapshot: snapshot(), config: nativeConfig })
    )
    // Fresh mount: both critical items are pending inside the box, so the alert IS engaged.
    expect(html).toContain('data-rc19-alerts="active"')
    expect(html).toContain('SAFETY ITEM UNCONFIRMED')
    // On track, the same frame is not a driver swap and the alert layer is empty.
    const onTrack = markup(snapshot({ onPitRoad: false, pit: undefined }), nativeConfig)
    expect(onTrack).toContain('data-rc19-alerts="silent"')
    expect(onTrack).not.toContain('data-testid="rc19-alerts"')
    expect(board.criticalOutstanding()).toEqual([])
  })

  it('renders a dash-only frame with no telemetry at all', () => {
    const html = markup(null, nativeConfig)
    assertClean(html)
    expect(html).toContain('NOT READY')
    expect(html).toContain('6 OUTSTANDING')
    expect(html).toContain(RC19_FAULTS_NO_SOURCE)
    expect(html).toContain('data-rc19-handover="unavailable"')
    // Fail closed: a display with no telemetry asserts nothing, not even a fuel-plan verdict.
    expect(html).toContain('data-rc19-alerts="silent"')
    // Every value is the dash; nothing unmonitored renders as healthy.
    expect((html.match(/>--</g) ?? []).length).toBeGreaterThanOrEqual(15)
    expect(text(html)).not.toContain('1.94')
  })

  it('describes every value for a screen reader', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('aria-label="Fuel laps remaining 12.6"')
    expect(html).toContain('aria-label="ABS level unavailable"')
    expect(html).toContain('aria-label="RR tyre pressure unavailable"')
    expect(html).toContain('aria-label="Handover NOT READY, 6 outstanding"')
  })
})

// ─────────────────────────────────────────────────────────── live-only refusal

describe('RC-19 refuses anything that is not live telemetry', () => {
  it('refuses mock telemetry and renders the dash state', () => {
    const html = markup(snapshot({ sim: 'mock' }), nativeConfig)
    expect(html).toContain('data-rc19-buffer-state="mock-telemetry"')
    expect(text(html)).not.toContain('1.94')
    expect(html).toContain(RC19_FAULTS_NO_SOURCE)
  })

  it('refuses replay telemetry from either signal', () => {
    expect(markup(snapshot({ sim: 'replay' }), nativeConfig)).toContain('data-rc19-buffer-state="replay-telemetry"')
    const context = markup(
      snapshot({ replayContext: { state: 'replay' } as TelemetrySnapshot['replayContext'] }),
      nativeConfig
    )
    expect(context).toContain('data-rc19-buffer-state="replay-telemetry"')
    expect(text(context)).not.toContain('12.6')
  })

  it('renders a live frame whose provider merely reports replayPlaying', () => {
    // `replayPlaying` is a raw provider field, not a refusal trigger.
    const html = markup(snapshot({ replayPlaying: true }), nativeConfig)
    expect(html).toContain('data-rc19-buffer-state="accepted"')
    expect(text(html)).toContain('12.6')
  })

  it('refuses a disconnected frame', () => {
    const html = markup(snapshot({ connected: false }), nativeConfig)
    expect(html).toContain('data-rc19-buffer-state="disconnected"')
    expect(text(html)).not.toContain('12.6')
  })
})

// ─────────────────────────────────────────────────────────── crew macro wiring

describe('RC-19 crew macro bus', () => {
  it('confirms an item only when a recognised macro fires, and never on telemetry alone', () => {
    const view = render(createElement(RaceconRc19DashWidget, { snapshot: snapshot(), config: nativeConfig }))
    const stateOf = (id: string): string | null =>
      view.container.querySelector(`[data-rc19-item="${id}"]`)?.getAttribute('data-rc19-state') ?? null

    expect(stateOf('SEAT')).toBe('PENDING')
    act(() => {
      window.dispatchEvent(new CustomEvent(RC19_CONFIRM_EVENT, { detail: 'HELMET' }))
    })
    expect(stateOf('SEAT')).toBe('PENDING')

    act(() => {
      window.dispatchEvent(new CustomEvent(RC19_CONFIRM_EVENT, { detail: 'SEAT' }))
      window.dispatchEvent(new CustomEvent(RC19_CONFIRM_EVENT, { detail: { item: 'BELTS' } }))
    })
    expect(stateOf('SEAT')).toBe('CONFIRMED')
    expect(stateOf('BELTS')).toBe('CONFIRMED')
    expect(view.container.querySelector('[data-rc19-outstanding]')?.getAttribute('data-rc19-outstanding')).toBe('4')
    // Both critical items confirmed: the packet 15 safety alert clears.
    expect(view.container.querySelector('.rc19-widget')?.getAttribute('data-rc19-alerts')).toBe('silent')
  })

  it('gates the confirm control until nothing is outstanding, then latches READY', () => {
    const view = render(createElement(RaceconRc19DashWidget, { snapshot: snapshot(), config: nativeConfig }))
    const confirmState = (): string | null =>
      view.container.querySelector('[data-testid="rc19-confirm"]')?.getAttribute('data-rc19-confirm-state') ?? null

    expect(confirmState()).toBe('gated')
    act(() => {
      window.dispatchEvent(new CustomEvent(RC19_CONFIRM_EVENT, { detail: 'CONFIRM READY' }))
    })
    expect(confirmState()).toBe('gated')
    expect(view.container.textContent).toContain('NOT READY')

    act(() => {
      for (const id of RC19_CHECKLIST_ITEM_IDS) {
        window.dispatchEvent(new CustomEvent(RC19_CONFIRM_EVENT, { detail: id }))
      }
    })
    expect(confirmState()).toBe('armed')
    expect(view.container.textContent).toContain('NOT READY')

    act(() => {
      window.dispatchEvent(new CustomEvent(RC19_CONFIRM_EVENT, { detail: 'CONFIRM READY' }))
    })
    expect(confirmState()).toBe('latched')
    expect(view.container.querySelector('.rc19-widget')?.getAttribute('data-rc19-ready')).toBe('true')
    expect(view.container.textContent).toContain('READY')
  })

  it('empties the board when the telemetry source changes', () => {
    const view = render(createElement(RaceconRc19DashWidget, { snapshot: snapshot(), config: nativeConfig }))
    act(() => {
      window.dispatchEvent(new CustomEvent(RC19_CONFIRM_EVENT, { detail: 'SEAT' }))
    })
    expect(view.container.querySelector('[data-rc19-item="SEAT"]')?.getAttribute('data-rc19-state')).toBe('CONFIRMED')

    view.rerender(
      createElement(RaceconRc19DashWidget, {
        snapshot: snapshot({ sessionUniqueId: 92 }, 6_121_000),
        config: nativeConfig
      })
    )
    expect(view.container.querySelector('[data-rc19-item="SEAT"]')?.getAttribute('data-rc19-state')).toBe('PENDING')
  })
})

// ─────────────────────────────────────────────────────────── display clock

describe('RC-19 uses the shared RaceCon display clock', () => {
  it('freezes for any non-live render mode', () => {
    expect(raceconDisplayClockFrozen(undefined)).toBe(false)
    expect(raceconDisplayClockFrozen('inert')).toBe(true)
  })

  it('holds an inert preview byte-identical past every staleness gate', () => {
    vi.useFakeTimers()
    let clock = 0
    const view = render(
      createElement(RaceconRc19DashWidget, {
        snapshot: snapshot(),
        config: nativeConfig,
        preview: 'inert',
        monotonicClock: () => clock
      })
    )
    const mounted = view.container.innerHTML
    act(() => {
      clock = 30_000
      vi.advanceTimersByTime(30_000)
    })
    expect(view.container.innerHTML).toBe(mounted)
    expect(view.container.textContent).toContain('12.6')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ticks a live render, so a silent provider ages into its dash state', () => {
    vi.useFakeTimers()
    let clock = 0
    const view = render(
      createElement(RaceconRc19DashWidget, {
        snapshot: snapshot(),
        config: nativeConfig,
        monotonicClock: () => clock
      })
    )
    expect(view.container.textContent).toContain('1.94')
    act(() => {
      clock = RC19_CHANNEL_STALE_MS.tyreLf + RACECON_DISPLAY_CLOCK_INTERVAL_MS + 1
      vi.advanceTimersByTime(clock)
    })
    expect(view.container.textContent).not.toContain('1.94')
  })
})

// ─────────────────────────────────────────────────────────── model plumbing

describe('RC-19 model plumbing', () => {
  it('binds an RC-01 receipt map without disturbing the shared channel semantics', () => {
    // The shared RC-01 receipts remain available for the ingest buffer's own guards.
    const shared = createRc01ChannelReceipts(snapshot(), 0)
    expect(shared.size).toBeGreaterThan(0)
    expect(createRc19Receipts(snapshot(), 0).has('pitContext')).toBe(true)
  })

  it('reports the measured handover context in words', () => {
    expect(rc19InBox(snapshot())).toBe(true)
    expect(rc19InBox(snapshot({ pit: undefined, onPitRoad: false }))).toBe(false)
    expect(rc19InBox(snapshot({ pit: undefined, onPitRoad: undefined }))).toBeNull()
    expect(modelFor(snapshot()).handover.label).toBe('IN BOX')
    expect(modelFor(snapshot({ pit: undefined, onPitRoad: false })).handover.label).toBe('ON TRACK')
    expect(modelFor(snapshot({ pit: undefined, onPitRoad: undefined })).handover.label).toBe('NO PIT SOURCE')
  })

  it('keeps the timeline empty because GAP-4 leaves the plan no channel', () => {
    expect(modelFor(snapshot()).timelineSegments).toEqual([])
    expect(modelFor(snapshot()).timelineLabel).toBe(RC19_TIMELINE_NO_SOURCE)
  })
})

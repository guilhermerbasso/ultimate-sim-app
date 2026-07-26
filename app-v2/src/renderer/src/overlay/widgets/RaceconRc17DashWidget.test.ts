// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOverlayStyle, type OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { RACECON_DISPLAY_CLOCK_INTERVAL_MS, raceconDisplayClockFrozen } from './raceconDisplayClock'
import { RaceconRc17DashWidget } from './RaceconRc17DashWidget'
import { Rc01LiveTelemetryBuffer, createRc01ChannelReceipts } from './raceconRc01Core'
import {
  RC17_ALONGSIDE_RELEASE_MS,
  RC17_APP_ZONES,
  RC17_CHANNEL_STALE_MS,
  RC17_CLOSING_RATE_HOLD_MS,
  RC17_CLOSING_SAMPLE_MAX_GAP_MS,
  RC17_CLOSING_SAMPLE_MIN_DT_MS,
  RC17_FAST_CLOSING_ENGAGE_MS,
  RC17_FAST_CLOSING_MPS,
  RC17_NATIVE_ZONES,
  RC17_NO_DATA,
  RC17_NO_LANE_SOURCE,
  RC17_NO_RADAR_SOURCE,
  RC17_PACKET_OMISSIONS,
  RC17_PACKET_PROXIMITY_FRESH_MS,
  RC17_QUADRANTS,
  RC17_QUADRANT_ARCS,
  RC17_RADAR_RANGE_M,
  RC17_RING,
  RC17_SECTORS,
  RC17_SECTOR_CLOCK,
  RC17_SECTOR_WORD_LENGTH,
  RC17_SIDES,
  RC17_SPOTTER_ZONES,
  RC17_THREE_WIDE_ENGAGE_MS,
  RC17_TYPE_SCALE_PX,
  type Rc17AlertInput,
  Rc17ClosingTracker,
  type Rc17Rect,
  type Rc17Sector,
  type Rc17ZoneMap,
  advanceRc17Alerts,
  clearInvalidRc17Alerts,
  createRc17AlertState,
  createRc17AuxReceipts,
  createRc17DashboardModel,
  rc17AlertLines,
  rc17AuxChannelValue,
  rc17CompactModeForContentBox,
  rc17ContactPoint,
  rc17DisplayGear,
  rc17FlagTextForSides,
  rc17LayoutForContentBox,
  rc17Percent,
  rc17PhoneGeometryForContentBox,
  rc17QuadrantForAngle,
  rc17QuadrantPath,
  rc17RadarContacts,
  rc17RingPoint,
  rc17SectorWordPoint,
  rc17SidesForZone,
  rc17TypeScaleCqw,
  rc17ZoneStyle,
  rc17ZonesForLayout
} from './raceconRc17Core'

const config: OverlayWidgetConfig = {
  id: 'raceconRc01Dash',
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
 * The approved RC-17 reference state (attempt-005 governed 800x480,
 * `input/telemetry-frame-oval-pack-inside-alongside.json`): oval pack racing at sustained speed
 * with a car alongside on the driver's LEFT and the timing/scoring feed just dropped.
 *
 * `relatives` and `position` are deliberately absent: that IS the reference frame's condition,
 * and it is why gap ahead and position dash TOGETHER while speed keeps a real number from a
 * different source. Nothing here is mirrored across sources.
 */
function snapshot(overrides: Partial<TelemetrySnapshot> = {}, timestamp = 6_120_000): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp,
    sessionUniqueId: 44,
    speedKmh: 291,
    rpm: 6_400,
    maxRpm: 8_000,
    gear: 4,
    throttle: 0.98,
    brake: 0,
    clutch: 0,
    sessionType: 'Race',
    sessionState: 'racing',
    currentLap: 61,
    playerCarIdx: 7,
    waterTempC: 92,
    carLeftRight: 'left',
    carLeftRightCount: 1,
    radarCars: [{ carIdx: 12, relativeX: -3.1, relativeY: 0.2 }],
    ...overrides
  } as TelemetrySnapshot
}

/** The same frame with no proximity feed of any kind: packet 16's NO DATA condition. */
function blindSnapshot(overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return snapshot({ carLeftRight: undefined, radarCars: undefined, ...overrides } as Partial<TelemetrySnapshot>)
}

function markup(value: TelemetrySnapshot | null, cfg = config): string {
  return renderToStaticMarkup(createElement(RaceconRc17DashWidget, { snapshot: value, config: cfg }))
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
  options: Parameters<typeof createRc17DashboardModel>[4] = {},
  receiptsAtMs = nowMs
): ReturnType<typeof createRc17DashboardModel> {
  const receipts = value ? createRc01ChannelReceipts(value, receiptsAtMs) : new Map()
  const aux = value ? createRc17AuxReceipts(value, receiptsAtMs) : new Map()
  return createRc17DashboardModel(value, receipts, aux, nowMs, options)
}

function alertInput(overrides: Partial<Rc17AlertInput> = {}): Rc17AlertInput {
  return {
    nowMs: 0,
    occupiedSides: null,
    closingMps: {},
    radarAvailable: false,
    ...overrides
  }
}

function right(rect: Rc17Rect): number {
  return rect.left + rect.width
}

function bottom(rect: Rc17Rect): number {
  return rect.top + rect.height
}

function overlaps(a: Rc17Rect, b: Rc17Rect): boolean {
  return a.left < right(b) && right(a) > b.left && a.top < bottom(b) && bottom(a) > b.top
}

function allZones(zones: Rc17ZoneMap): [string, Rc17Rect][] {
  return Object.entries(zones).filter((entry): entry is [string, Rc17Rect] => Boolean(entry[1]))
}

const BREAKPOINTS: readonly { width: number; height: number }[] = [
  { width: 800, height: 480 },
  { width: 1024, height: 600 },
  { width: 1920, height: 1080 },
  { width: 400, height: 800 },
  { width: 900, height: 400 },
  { width: 640, height: 520 }
]

/** Every layout must keep all three packet 15 alert surfaces reachable. */
const ALERT_SURFACE_ZONES = ['flags', 'clock', 'closing'] as const

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('RC-17 packet gaps are declared as overrides, never invented away', () => {
  it('names every truth-table and zone gap the packet leaves open', () => {
    expect(Object.keys(RC17_PACKET_OMISSIONS).sort()).toEqual(
      [
        'behindSectorSource',
        'closingRateChannel',
        'closingThreshold',
        'insideOutsideWording',
        'laneUsageHistory',
        'lineChoice',
        'proximityCadence',
        'radarEnvelope',
        'revScaleEnd',
        'sideFlagAppZone',
        'softKeyToggle',
        'tertiaryZone',
        'threeWideEnum'
      ].sort()
    )
    for (const [key, rationale] of Object.entries(RC17_PACKET_OMISSIONS)) {
      expect(rationale, `${key} needs a rationale`).toMatch(/packet|GAP|OV-/)
      expect(rationale.length, `${key} rationale is too thin`).toBeGreaterThan(40)
    }
  })

  it('floors the packet 50 ms proximity cadence at the app stream floor instead of reporting a healthy feed as stale', () => {
    expect(RC17_PACKET_PROXIMITY_FRESH_MS).toBe(50)
    expect(RC17_CHANNEL_STALE_MS.spotter).toBeGreaterThan(RC17_PACKET_PROXIMITY_FRESH_MS)
    expect(RC17_CHANNEL_STALE_MS.radar).toBe(RC17_CHANNEL_STALE_MS.spotter)
    // Packet 16 gives water temperature 500 ms, which this app can meet unchanged.
    expect(RC17_CHANNEL_STALE_MS.water).toBe(500)
  })
})

describe('RC-17 spotter side comes from the decided-side channel and nothing else', () => {
  it('reads every enum member and refuses anything the channel does not publish', () => {
    for (const [index, zone] of RC17_SPOTTER_ZONES.entries()) {
      expect(rc17AuxChannelValue(snapshot({ carLeftRight: zone }), 'spotter')).toBe(index)
    }
    expect(rc17AuxChannelValue(blindSnapshot(), 'spotter')).toBeNull()
    expect(
      rc17AuxChannelValue(snapshot({ carLeftRight: 'inside' } as unknown as Partial<TelemetrySnapshot>), 'spotter')
    ).toBeNull()
  })

  it("treats a live 'clear' as a real reading, distinct from having no channel at all", () => {
    const clear = modelFor(snapshot({ carLeftRight: 'clear' }))
    expect(clear.spotter.zone).toBe('clear')
    expect(clear.spotter.unavailable).toBe(false)
    expect(clear.spotter.sides).toEqual([])
    expect(clear.flag.kind).toBe('none')

    const blind = modelFor(blindSnapshot())
    expect(blind.spotter.zone).toBeNull()
    expect(blind.spotter.unavailable).toBe(true)
    // Packet 16: never show 'clear' when the source is absent.
    expect(blind.flag.kind).toBe('unavailable')
    expect(blind.flag.text).toBe(RC17_NO_DATA)
  })

  it('maps each enum member to the sides the channel can assert, and to nothing else', () => {
    expect(rc17SidesForZone('clear')).toEqual([])
    expect(rc17SidesForZone('left')).toEqual(['LEFT'])
    expect(rc17SidesForZone('right')).toEqual(['RIGHT'])
    expect(rc17SidesForZone('both')).toEqual(['LEFT', 'RIGHT'])
    expect(rc17SidesForZone(null)).toEqual([])
  })

  it("spells the side the channel can assert, never an oval 'inside' the app cannot know", () => {
    expect(rc17FlagTextForSides(['LEFT'])).toBe('CAR LEFT')
    expect(rc17FlagTextForSides(['RIGHT'])).toBe('CAR RIGHT')
    expect(rc17FlagTextForSides(['LEFT', 'RIGHT'])).toBe('CARS BOTH SIDES')
    expect(rc17FlagTextForSides([])).toBe('')
    expect(RC17_PACKET_OMISSIONS.insideOutsideWording).toContain('turn direction')
  })

  it('keeps the packet 11.1 clock positions even though the words changed', () => {
    expect(RC17_SECTOR_CLOCK).toEqual({ LEFT: 9, RIGHT: 3, BEHIND: 6 })
    expect(RC17_SIDES).toEqual(['LEFT', 'RIGHT'])
    expect(RC17_SECTORS).toEqual(['LEFT', 'RIGHT', 'BEHIND'])
  })
})

describe('RC-17 proximity radar plots measured geometry, never a phantom', () => {
  it('splits the ring on packet 11.1 hairlines at 45, 135, 225 and 315 degrees', () => {
    expect(rc17QuadrantForAngle(0)).toBe('RIGHT')
    expect(rc17QuadrantForAngle(44.9)).toBe('RIGHT')
    expect(rc17QuadrantForAngle(45)).toBe('BEHIND')
    expect(rc17QuadrantForAngle(90)).toBe('BEHIND')
    expect(rc17QuadrantForAngle(135)).toBe('LEFT')
    expect(rc17QuadrantForAngle(180)).toBe('LEFT')
    expect(rc17QuadrantForAngle(225)).toBe('HEADING')
    expect(rc17QuadrantForAngle(270)).toBe('HEADING')
    expect(rc17QuadrantForAngle(315)).toBe('RIGHT')
    expect(rc17QuadrantForAngle(-90)).toBe('HEADING')
  })

  it('places each cardinal neighbour on the clock position a spotter would call', () => {
    const contacts = rc17RadarContacts(
      snapshot({
        radarCars: [
          { carIdx: 1, relativeX: -4, relativeY: 0 },
          { carIdx: 2, relativeX: 4, relativeY: 0 },
          { carIdx: 3, relativeX: 0, relativeY: -6 },
          { carIdx: 4, relativeX: 0, relativeY: 6 }
        ]
      } as Partial<TelemetrySnapshot>)
    )
    const byCar = new Map(contacts.map((contact) => [contact.carIdx, contact]))
    expect(byCar.get(1)?.quadrant).toBe('LEFT')
    expect(byCar.get(2)?.quadrant).toBe('RIGHT')
    expect(byCar.get(3)?.quadrant).toBe('BEHIND')
    expect(byCar.get(4)?.quadrant).toBe('HEADING')
  })

  it('drops malformed and out-of-envelope contacts instead of pinning them to the rim', () => {
    const contacts = rc17RadarContacts(
      snapshot({
        radarCars: [
          { carIdx: 1, relativeX: -3, relativeY: 0 },
          { carIdx: 2, relativeX: Number.NaN, relativeY: 0 },
          { carIdx: 3, relativeX: 0, relativeY: RC17_RADAR_RANGE_M + 5 },
          { carIdx: 4, relativeX: -12, relativeY: -9 }
        ]
      } as Partial<TelemetrySnapshot>)
    )
    expect(contacts.map((contact) => contact.carIdx)).toEqual([1, 4])
    // Sorted by measured range, nearest first.
    expect(contacts[0].rangeM).toBeLessThan(contacts[1].rangeM)
  })

  it('never draws a neighbour on top of the own-car marker', () => {
    for (const rangeM of [0, 0.5, 3, 12, RC17_RADAR_RANGE_M]) {
      const point = rc17ContactPoint({
        carIdx: 1,
        relativeXM: -rangeM,
        relativeYM: 0,
        rangeM,
        angleDeg: 180,
        quadrant: 'LEFT'
      })
      const distance = Math.hypot(point.x - RC17_RING.centre, point.y - RC17_RING.centre)
      expect(distance).toBeGreaterThanOrEqual(RC17_RING.ownCarRadius + RC17_RING.contactRadius)
      expect(distance).toBeLessThanOrEqual(RC17_RING.innerRadius - RC17_RING.contactRadius)
    }
  })

  it('treats an empty radar array as a live radar reporting nobody, not as a missing radar', () => {
    const empty = modelFor(snapshot({ radarCars: [] } as Partial<TelemetrySnapshot>))
    expect(empty.radar.available).toBe(true)
    expect(empty.radar.contacts).toEqual([])
    expect(empty.packMap.available).toBe(true)

    const missing = modelFor(blindSnapshot())
    expect(missing.radar.available).toBe(false)
    expect(missing.radar.label).toBe(RC17_NO_RADAR_SOURCE)
    expect(missing.packMap.contacts).toEqual([])
  })
})

describe('RC-17 closing rate is measured from the radar, never estimated', () => {
  const behind = (rangeM: number): ReturnType<typeof rc17RadarContacts>[number] => ({
    carIdx: 5,
    relativeXM: 0,
    relativeYM: -rangeM,
    rangeM,
    angleDeg: 90,
    quadrant: 'BEHIND'
  })

  it('reports nothing at all from a first sighting', () => {
    const tracker = new Rc17ClosingTracker()
    tracker.observe(0, [behind(12)])
    expect(tracker.rates(0)).toEqual({})
  })

  it('measures the first difference of one car own range once two samples exist', () => {
    const tracker = new Rc17ClosingTracker()
    tracker.observe(0, [behind(12)])
    tracker.observe(200, [behind(11)])
    expect(tracker.rates(200).BEHIND?.mps).toBeCloseTo(5, 5)
    expect(tracker.rates(200).BEHIND?.carIdx).toBe(5)
  })

  it('measures across a window, because adjacent frames on this stream are too close together', () => {
    // The app's slowest stream cadence is coarser than RC17_CLOSING_SAMPLE_MIN_DT_MS, so a rate
    // measured only between adjacent frames could never be measured at all in a real session.
    const tracker = new Rc17ClosingTracker()
    let rangeM = 14
    for (let atMs = 0; atMs <= 200; atMs += 50) {
      tracker.observe(atMs, [behind(rangeM)])
      rangeM -= 0.6
    }
    const rates = tracker.rates(200)
    expect(rates.BEHIND).toBeDefined()
    expect(rates.BEHIND!.mps).toBeGreaterThan(RC17_FAST_CLOSING_MPS)
  })

  it('refuses a sample pair that is too close together or too far apart to be a rate', () => {
    const tight = new Rc17ClosingTracker()
    tight.observe(0, [behind(12)])
    tight.observe(RC17_CLOSING_SAMPLE_MIN_DT_MS - 1, [behind(11)])
    expect(tight.rates(RC17_CLOSING_SAMPLE_MIN_DT_MS - 1)).toEqual({})

    const stretched = new Rc17ClosingTracker()
    stretched.observe(0, [behind(12)])
    stretched.observe(RC17_CLOSING_SAMPLE_MAX_GAP_MS + 1, [behind(11)])
    expect(stretched.rates(RC17_CLOSING_SAMPLE_MAX_GAP_MS + 1)).toEqual({})
  })

  it('never carries a rate across a car that disappeared and came back', () => {
    const tracker = new Rc17ClosingTracker()
    tracker.observe(0, [behind(12)])
    tracker.observe(200, [])
    tracker.observe(400, [behind(4)])
    expect(tracker.rates(400)).toEqual({})
  })

  it('expires a measured rate rather than letting it describe a stale present', () => {
    const tracker = new Rc17ClosingTracker()
    tracker.observe(0, [behind(12)])
    tracker.observe(200, [behind(11)])
    expect(tracker.rates(200 + RC17_CLOSING_RATE_HOLD_MS).BEHIND).toBeDefined()
    expect(tracker.rates(200 + RC17_CLOSING_RATE_HOLD_MS + 1)).toEqual({})
  })

  it('keeps the fastest closer on a side and never a car in the heading quadrant', () => {
    const tracker = new Rc17ClosingTracker()
    const ahead = (carIdx: number, rangeM: number): ReturnType<typeof rc17RadarContacts>[number] => ({
      carIdx,
      relativeXM: 0,
      relativeYM: rangeM,
      rangeM,
      angleDeg: 270,
      quadrant: 'HEADING'
    })
    const left = (carIdx: number, rangeM: number): ReturnType<typeof rc17RadarContacts>[number] => ({
      carIdx,
      relativeXM: -rangeM,
      relativeYM: 0,
      rangeM,
      angleDeg: 180,
      quadrant: 'LEFT'
    })
    tracker.observe(0, [left(1, 10), left(2, 14), ahead(3, 20)])
    tracker.observe(200, [left(1, 9.5), left(2, 12), ahead(3, 10)])
    const rates = tracker.rates(200)
    expect(rates.LEFT?.carIdx).toBe(2)
    expect(rates.LEFT?.mps).toBeCloseTo(10, 5)
    expect(Object.keys(rates)).toEqual(['LEFT'])
  })
})

describe('RC-17 packet zone geometry', () => {
  it('reproduces packet 11.1 pixel rectangles exactly on the 800x480 canvas', () => {
    const asPixels = (rect: Rc17Rect): [number, number, number, number] => [
      Math.round((rect.left / 100) * 800),
      Math.round((rect.top / 100) * 480),
      Math.round((rect.width / 100) * 800),
      Math.round((rect.height / 100) * 480)
    ]
    expect(asPixels(RC17_NATIVE_ZONES.flags!)).toEqual([40, 50, 200, 30])
    expect(asPixels(RC17_NATIVE_ZONES.line!)).toEqual([40, 90, 200, 180])
    expect(asPixels(RC17_NATIVE_ZONES.clock!)).toEqual([270, 50, 260, 260])
    expect(asPixels(RC17_NATIVE_ZONES.closing!)).toEqual([560, 90, 200, 180])
    expect(asPixels(RC17_NATIVE_ZONES.pace!)).toEqual([40, 320, 720, 80])
    // The one governed addition: gear, RPM and water have no packet zone anywhere (GAP-5).
    expect(asPixels(RC17_NATIVE_ZONES.tertiary!)).toEqual([40, 410, 720, 50])
    expect(RC17_NATIVE_ZONES.packMap).toBeUndefined()
    expect(RC17_NATIVE_ZONES.lane).toBeUndefined()
  })

  it('reproduces packet 12.1 pixel rectangles exactly on the 1024x600 canvas', () => {
    const asPixels = (rect: Rc17Rect): [number, number, number, number] => [
      Math.round((rect.left / 100) * 1024),
      Math.round((rect.top / 100) * 600),
      Math.round((rect.width / 100) * 1024),
      Math.round((rect.height / 100) * 600)
    ]
    expect(asPixels(RC17_APP_ZONES.packMap!)).toEqual([48, 60, 300, 300])
    expect(asPixels(RC17_APP_ZONES.clock!)).toEqual([372, 60, 300, 300])
    expect(asPixels(RC17_APP_ZONES.lane!)).toEqual([372, 380, 300, 180])
    expect(asPixels(RC17_APP_ZONES.pace!)).toEqual([48, 400, 300, 160])
    // Packet 12.1's single "Line + closing" rectangle, split into its two named halves so the
    // fast-closing alert keeps a surface of its own.
    const line = asPixels(RC17_APP_ZONES.line!)
    const closing = asPixels(RC17_APP_ZONES.closing!)
    expect(line[0]).toBe(716)
    expect(line[1]).toBe(60)
    expect(closing[0]).toBe(716)
    expect(closing[1] + closing[3]).toBe(360)
    expect(line[2]).toBe(260)
    expect(closing[2]).toBe(260)
  })

  it('contains every zone inside the canvas at every breakpoint', () => {
    for (const size of BREAKPOINTS) {
      const layout = rc17LayoutForContentBox(size.width, size.height)
      const mode = rc17CompactModeForContentBox(size.width, size.height)
      for (const [id, rect] of allZones(rc17ZonesForLayout(layout, mode))) {
        const where = `${size.width}x${size.height} ${id}`
        expect(rect.left, where).toBeGreaterThanOrEqual(0)
        expect(rect.top, where).toBeGreaterThanOrEqual(0)
        expect(right(rect), where).toBeLessThanOrEqual(100)
        expect(bottom(rect), where).toBeLessThanOrEqual(100)
        expect(rect.width, where).toBeGreaterThan(0)
        expect(rect.height, where).toBeGreaterThan(0)
      }
    }
  })

  it('keeps every zone disjoint at every breakpoint', () => {
    for (const size of BREAKPOINTS) {
      const layout = rc17LayoutForContentBox(size.width, size.height)
      const mode = rc17CompactModeForContentBox(size.width, size.height)
      const rects = allZones(rc17ZonesForLayout(layout, mode))
      for (let a = 0; a < rects.length; a += 1) {
        for (let b = a + 1; b < rects.length; b += 1) {
          expect(
            overlaps(rects[a][1], rects[b][1]),
            `${size.width}x${size.height} ${rects[a][0]} and ${rects[b][0]} overlap`
          ).toBe(false)
        }
      }
    }
  })

  it('reveals the two packet 12.1 modules only on the app canvas', () => {
    for (const size of BREAKPOINTS) {
      const layout = rc17LayoutForContentBox(size.width, size.height)
      const zones = rc17ZonesForLayout(layout, rc17CompactModeForContentBox(size.width, size.height))
      if (layout === 'app') {
        expect(zones.packMap, `${size.width}x${size.height}`).toBeDefined()
        expect(zones.lane, `${size.width}x${size.height}`).toBeDefined()
      } else {
        expect(zones.packMap, `${size.width}x${size.height}`).toBeUndefined()
        expect(zones.lane, `${size.width}x${size.height}`).toBeUndefined()
      }
    }
  })

  it('keeps all three packet 15 alert surfaces at every breakpoint', () => {
    for (const size of BREAKPOINTS) {
      const layout = rc17LayoutForContentBox(size.width, size.height)
      const zones = rc17ZonesForLayout(layout, rc17CompactModeForContentBox(size.width, size.height))
      for (const id of ALERT_SURFACE_ZONES) {
        expect(zones[id], `${size.width}x${size.height} lost the ${id} alert surface`).toBeDefined()
      }
    }
  })

  it('emits zone geometry as inline percentages without binary-float noise', () => {
    expect(rc17Percent(33.75)).toBe('33.75%')
    expect(rc17Percent(Number.NaN)).toBe('0%')
    expect(rc17ZoneStyle(undefined)).toBeNull()
    expect(rc17ZoneStyle(RC17_NATIVE_ZONES.clock)).toEqual({
      left: '33.75%',
      top: '10.42%',
      width: '32.5%',
      height: '54.17%'
    })
  })
})

describe('RC-17 ring geometry is built from the packet, not traced from the render', () => {
  it('fits the whole assembly inside packet 11.1 260x260 zone', () => {
    expect(RC17_RING.viewBox).toBe(260)
    expect(RC17_RING.outerRadius - RC17_RING.innerRadius).toBe(RC17_RING.bandWidth)
    // OV-3: the reference render's 149.5 px outer circle overhangs the zone. This one cannot.
    expect(RC17_RING.centre + RC17_RING.outerRadius).toBeLessThanOrEqual(RC17_RING.viewBox)
    expect(RC17_RING.centre + RC17_RING.headingTickOuter).toBeLessThanOrEqual(RC17_RING.viewBox)
    expect(RC17_RING.headingTickInner).toBeGreaterThan(RC17_RING.outerRadius)
  })

  it('puts the own car on the exact ring centre', () => {
    // OV-2: the reference renders it 13.5 px right and 8.5 px above the centre.
    expect(rc17RingPoint(0, 0)).toEqual({ x: RC17_RING.centre, y: RC17_RING.centre })
  })

  it('cuts four 90 degree quadrants on the packet hairlines', () => {
    expect(RC17_QUADRANTS).toEqual(['HEADING', 'RIGHT', 'BEHIND', 'LEFT'])
    for (const quadrant of RC17_QUADRANTS) {
      const [from, to] = RC17_QUADRANT_ARCS[quadrant]
      expect(to - from, `${quadrant} is not a quadrant`).toBe(90)
      expect(Math.abs(from) % 45, `${quadrant} does not start on a hairline`).toBe(0)
      const path = rc17QuadrantPath(quadrant)
      expect(path.startsWith('M ')).toBe(true)
      expect(path.endsWith('Z')).toBe(true)
      expect(path).toContain(`A ${RC17_RING.outerRadius} ${RC17_RING.outerRadius}`)
      expect(path).toContain(`A ${RC17_RING.innerRadius} ${RC17_RING.innerRadius}`)
      expect(path).not.toContain('NaN')
    }
  })

  it('rides each sector word on the band centre, drawn to a width the zone can always hold', () => {
    // OV-11: a 260 px zone cannot hold a ring plus two 20 px words side by side, so the words
    // ride the band and are drawn to a FIXED advance width — no host font can widen them out.
    for (const sector of RC17_SECTORS) {
      const point = rc17SectorWordPoint(sector)
      const half = RC17_SECTOR_WORD_LENGTH[sector] / 2
      const distance = Math.hypot(point.x - RC17_RING.centre, point.y - RC17_RING.centre)
      expect(distance, `${sector} word is off the band centre`).toBeCloseTo(RC17_RING.wordRadius, 5)
      expect(distance).toBeGreaterThan(RC17_RING.innerRadius)
      expect(distance).toBeLessThan(RC17_RING.outerRadius)
      expect(point.x - half, `${sector} word overflows left`).toBeGreaterThanOrEqual(0)
      expect(point.x + half, `${sector} word overflows right`).toBeLessThanOrEqual(RC17_RING.viewBox)
    }
  })
})

describe('RC-17 typographic ladder is computed from packet 11.2', () => {
  it('carries the packet sizes and the three the packet omits', () => {
    expect(RC17_TYPE_SCALE_PX.closing).toBe(44)
    expect(RC17_TYPE_SCALE_PX.line).toBe(40)
    expect(RC17_TYPE_SCALE_PX.pace).toBe(34)
    expect(RC17_TYPE_SCALE_PX.sector).toBe(20)
  })

  it('never inverts the ladder: every rung the packet omits stays below every rung it declares', () => {
    expect(RC17_TYPE_SCALE_PX.closing).toBeGreaterThan(RC17_TYPE_SCALE_PX.line)
    expect(RC17_TYPE_SCALE_PX.line).toBeGreaterThan(RC17_TYPE_SCALE_PX.pace)
    expect(RC17_TYPE_SCALE_PX.pace).toBeGreaterThan(RC17_TYPE_SCALE_PX.sector)
    expect(RC17_TYPE_SCALE_PX.sector).toBeGreaterThan(RC17_TYPE_SCALE_PX.flag)
    expect(RC17_TYPE_SCALE_PX.flag).toBeGreaterThan(RC17_TYPE_SCALE_PX.tertiary)
    expect(RC17_TYPE_SCALE_PX.tertiary).toBeGreaterThan(RC17_TYPE_SCALE_PX.label)
  })

  it('expresses the ladder in the container units the stylesheet uses', () => {
    expect(rc17TypeScaleCqw(44)).toBe(5.5)
    expect(rc17TypeScaleCqw(34)).toBe(4.25)
    expect(rc17TypeScaleCqw(20)).toBe(2.5)
  })
})

describe('RC-17 telemetry truth table', () => {
  it('renders the approved reference frame exactly as its channels allow', () => {
    const model = modelFor(snapshot())
    expect(model.speed.value).toBe('291')
    expect(model.gear.value).toBe('4')
    expect(model.rpm.value).toBe('6400')
    expect(model.water.value).toBe('92')
    expect(model.revFill).toBe(0.8)
    // The timing feed is absent, so these two dash TOGETHER while speed survives.
    expect(model.gapAhead.value).toBe('--.-')
    expect(model.gapAhead.unavailable).toBe(true)
    expect(model.position.value).toBe('--')
    expect(model.position.unavailable).toBe(true)
    expect(model.speed.unavailable).toBe(false)
  })

  it('dashes gap and position together while speed keeps its own source', () => {
    const timed = modelFor(snapshot({ position: 3, relatives: { ahead: { carIdx: 2, name: 'x', carNumber: '2', gapSec: 0.84 } } } as Partial<TelemetrySnapshot>))
    expect(timed.gapAhead.value).toBe('0.8')
    expect(timed.position.value).toBe('3')
    expect(timed.speed.value).toBe('291')
  })

  it('greys the speed to its packet dash once the source has been quiet past 500 ms', () => {
    const fresh = modelFor(snapshot(), 400, {}, 0)
    expect(fresh.speed.value).toBe('291')
    const stale = modelFor(snapshot(), 900, {}, 0)
    expect(stale.speed.value).toBe('---')
    expect(stale.speed.stale).toBe(true)
    expect(stale.speed.tone).toBe('muted')
  })

  it('freezes engine RPM and greys it instead of dashing, exactly as packet 16 demands', () => {
    const stale = modelFor(snapshot(), 400, {}, 0)
    expect(stale.rpm.value).toBe('6400')
    expect(stale.rpm.stale).toBe(true)
    expect(stale.rpm.unavailable).toBe(false)
    expect(stale.rpm.tone).toBe('muted')
  })

  it('never derives the gear from RPM or speed and never blanks it silently', () => {
    expect(rc17DisplayGear(null)).toBe('-')
    expect(rc17DisplayGear(0)).toBe('N')
    expect(rc17DisplayGear(-1)).toBe('R')
    expect(rc17DisplayGear(4)).toBe('4')
    const missing = modelFor(snapshot({ gear: undefined } as Partial<TelemetrySnapshot>))
    expect(missing.gear.value).toBe('-')
    expect(missing.gear.unavailable).toBe(true)
    expect(missing.speed.value).toBe('291')
  })

  it('hides the rev cue outright when the scale end has no channel', () => {
    const noScale = modelFor(snapshot({ maxRpm: undefined } as Partial<TelemetrySnapshot>))
    expect(noScale.revFill).toBeNull()
    expect(noScale.rpm.value).toBe('6400')
    expect(RC17_PACKET_OMISSIONS.revScaleEnd).toContain('maxRpm')
  })

  it('greys the water temperature to its dash when the sensor is invalid or quiet', () => {
    const invalid = modelFor(snapshot({ waterTempC: undefined } as Partial<TelemetrySnapshot>))
    expect(invalid.water.value).toBe('--')
    expect(invalid.water.unavailable).toBe(true)
    const quiet = modelFor(snapshot(), RC17_CHANNEL_STALE_MS.water + 1, {}, 0)
    expect(quiet.water.value).toBe('--')
    expect(quiet.water.stale).toBe(true)
  })

  it('renders a complete dash frame with no telemetry at all and invents nothing', () => {
    const model = modelFor(null)
    expect(model.speed.value).toBe('---')
    expect(model.gapAhead.value).toBe('--.-')
    expect(model.position.value).toBe('--')
    expect(model.gear.value).toBe('-')
    expect(model.rpm.value).toBe('----')
    expect(model.water.value).toBe('--')
    expect(model.revFill).toBeNull()
    expect(model.spotter.unavailable).toBe(true)
    expect(model.radar.available).toBe(false)
    expect(model.flag.text).toBe(RC17_NO_DATA)
    expect(rc17AlertLines(model)).toEqual([])
  })

  it('degrades the proximity pair to NO DATA once they miss their floored cadence', () => {
    const stale = modelFor(snapshot(), RC17_CHANNEL_STALE_MS.spotter + 1, {}, 0)
    expect(stale.spotter.stale).toBe(true)
    expect(stale.flag.text).toBe(RC17_NO_DATA)
    expect(stale.radar.available).toBe(false)
    for (const sector of stale.sectors) {
      expect(sector.unavailable, `${sector.sector} should be unavailable`).toBe(true)
      expect(sector.label).toBe('--')
      expect(sector.occupied).toBe(false)
    }
  })
})

describe('RC-17 packet contradictions are resolved by omission, not invention', () => {
  it('dashes the line cue for ever and marks neither option as chosen', () => {
    const model = modelFor(snapshot())
    expect(model.line.recommendation.value).toBe('--')
    expect(model.line.recommendation.unavailable).toBe(true)
    expect(model.line.options.map((option) => option.key)).toEqual(['HIGH', 'LOW'])
    expect(model.line.options.every((option) => option.selected === false)).toBe(true)
  })

  it('renders the lane-usage module with zero rows rather than a fabricated history', () => {
    const model = modelFor(snapshot())
    expect(model.lane.available).toBe(false)
    expect(model.lane.rows).toEqual([])
    expect(model.lane.label).toBe(RC17_NO_LANE_SOURCE)
  })

  it('drives the behind sector from the radar because the declared enum cannot address it', () => {
    const behind = modelFor(
      snapshot({ radarCars: [{ carIdx: 9, relativeX: 0.4, relativeY: -7 }] } as Partial<TelemetrySnapshot>)
    )
    const sector = behind.sectors.find((entry) => entry.sector === 'BEHIND')!
    expect(sector.occupied).toBe(true)
    expect(sector.unavailable).toBe(false)
    expect(sector.label).toBe('BEHIND')
    // And the spotter enum alone can never light it.
    const enumOnly = modelFor(snapshot({ carLeftRight: 'both', radarCars: undefined } as Partial<TelemetrySnapshot>))
    const blindBehind = enumOnly.sectors.find((entry) => entry.sector === 'BEHIND')!
    expect(blindBehind.unavailable).toBe(true)
    expect(blindBehind.label).toBe('--')
  })

  it('leaves the closing slots dashed until a rate has actually been measured', () => {
    const model = modelFor(snapshot())
    expect(model.closing.rate.value).toBe('--.-')
    expect(model.closing.side.value).toBe('--')
    expect(model.closing.highlighted).toBe(false)
    expect(model.closing.arrow).toBe('')
  })

  it('publishes a measured closing rate once the radar has supplied two samples', () => {
    const tracker = new Rc17ClosingTracker()
    tracker.observe(0, rc17RadarContacts(snapshot({ radarCars: [{ carIdx: 12, relativeX: -3.1, relativeY: -6 }] } as Partial<TelemetrySnapshot>)))
    tracker.observe(200, rc17RadarContacts(snapshot({ radarCars: [{ carIdx: 12, relativeX: -3.1, relativeY: -4 }] } as Partial<TelemetrySnapshot>)))
    const rates = tracker.rates(200)
    const model = modelFor(snapshot(), 0, { closingRates: rates })
    expect(model.closing.rate.unavailable).toBe(false)
    expect(Number(model.closing.rate.value)).toBeGreaterThan(0)
    expect(model.closing.side.value).toBe(rates.LEFT ? 'LEFT' : 'BEHIND')
  })
})

describe('RC-17 trigger-only alerts', () => {
  it('is silent in a frame with nothing to report', () => {
    const state = advanceRc17Alerts(createRc17AlertState(), alertInput({ occupiedSides: [], radarAvailable: true }))
    expect(state.carAlongside.active).toBe(false)
    expect(state.fastClosing.active).toBe(false)
    expect(state.threeWide.active).toBe(false)
  })

  it('engages car alongside as soon as the sector is occupied — it is persistent, not debounced', () => {
    const state = advanceRc17Alerts(createRc17AlertState(), alertInput({ nowMs: 0, occupiedSides: ['LEFT'] }))
    expect(state.carAlongside.active).toBe(true)
    expect(state.carAlongside.sides).toEqual(['LEFT'])
  })

  it('holds car alongside through the full 300 ms release hysteresis and then clears', () => {
    let state = advanceRc17Alerts(createRc17AlertState(), alertInput({ nowMs: 0, occupiedSides: ['LEFT'] }))
    state = advanceRc17Alerts(state, alertInput({ nowMs: 2_400, occupiedSides: ['LEFT'] }))
    expect(state.carAlongside.active).toBe(true)
    state = advanceRc17Alerts(state, alertInput({ nowMs: 2_500, occupiedSides: [] }))
    expect(state.carAlongside.active).toBe(true)
    state = advanceRc17Alerts(state, alertInput({ nowMs: 2_500 + RC17_ALONGSIDE_RELEASE_MS - 1, occupiedSides: [] }))
    expect(state.carAlongside.active).toBe(true)
    state = advanceRc17Alerts(state, alertInput({ nowMs: 2_500 + RC17_ALONGSIDE_RELEASE_MS, occupiedSides: [] }))
    expect(state.carAlongside.active).toBe(false)
    expect(state.carAlongside.sides).toEqual([])
  })

  it('restarts the release hysteresis when the car comes back alongside mid-release', () => {
    let state = advanceRc17Alerts(createRc17AlertState(), alertInput({ nowMs: 0, occupiedSides: ['RIGHT'] }))
    state = advanceRc17Alerts(state, alertInput({ nowMs: 100, occupiedSides: [] }))
    state = advanceRc17Alerts(state, alertInput({ nowMs: 200, occupiedSides: ['RIGHT'] }))
    expect(state.carAlongside.releaseSinceMs).toBeNull()
    state = advanceRc17Alerts(state, alertInput({ nowMs: 300 + RC17_ALONGSIDE_RELEASE_MS, occupiedSides: [] }))
    expect(state.carAlongside.active).toBe(true)
  })

  it('unlatches car alongside the instant the spotter channel goes away — never a false clear', () => {
    let state = advanceRc17Alerts(createRc17AlertState(), alertInput({ nowMs: 0, occupiedSides: ['LEFT'] }))
    state = advanceRc17Alerts(state, alertInput({ nowMs: 100, occupiedSides: null }))
    expect(state.carAlongside.active).toBe(false)
    expect(state.carAlongside.sides).toEqual([])
  })

  it('engages fast closing only after 200 ms above the declared threshold', () => {
    const above = { BEHIND: RC17_FAST_CLOSING_MPS + 1 } as Partial<Record<Rc17Sector, number>>
    let state = advanceRc17Alerts(
      createRc17AlertState(),
      alertInput({ nowMs: 0, occupiedSides: [], closingMps: above, radarAvailable: true })
    )
    expect(state.fastClosing.active).toBe(false)
    state = advanceRc17Alerts(
      state,
      alertInput({ nowMs: RC17_FAST_CLOSING_ENGAGE_MS - 1, occupiedSides: [], closingMps: above, radarAvailable: true })
    )
    expect(state.fastClosing.active).toBe(false)
    state = advanceRc17Alerts(
      state,
      alertInput({ nowMs: RC17_FAST_CLOSING_ENGAGE_MS, occupiedSides: [], closingMps: above, radarAvailable: true })
    )
    expect(state.fastClosing.active).toBe(true)
    expect(state.fastClosing.sector).toBe('BEHIND')
  })

  it('clears fast closing the moment the measured rate drops back', () => {
    const above = { LEFT: RC17_FAST_CLOSING_MPS + 4 } as Partial<Record<Rc17Sector, number>>
    let state = advanceRc17Alerts(
      createRc17AlertState(),
      alertInput({ nowMs: 0, occupiedSides: [], closingMps: above, radarAvailable: true })
    )
    state = advanceRc17Alerts(
      state,
      alertInput({ nowMs: 400, occupiedSides: [], closingMps: above, radarAvailable: true })
    )
    expect(state.fastClosing.active).toBe(true)
    state = advanceRc17Alerts(
      state,
      alertInput({ nowMs: 500, occupiedSides: [], closingMps: { LEFT: 0.2 }, radarAvailable: true })
    )
    expect(state.fastClosing.active).toBe(false)
  })

  it('restarts the fast-closing debounce when the closing side changes', () => {
    let state = advanceRc17Alerts(
      createRc17AlertState(),
      alertInput({ nowMs: 0, occupiedSides: [], closingMps: { LEFT: 9 }, radarAvailable: true })
    )
    state = advanceRc17Alerts(
      state,
      alertInput({ nowMs: RC17_FAST_CLOSING_ENGAGE_MS - 20, occupiedSides: [], closingMps: { RIGHT: 9 }, radarAvailable: true })
    )
    expect(state.fastClosing.active).toBe(false)
    expect(state.fastClosing.pendingSector).toBe('RIGHT')
  })

  it('hides fast closing entirely when the radar is unavailable', () => {
    let state = advanceRc17Alerts(
      createRc17AlertState(),
      alertInput({ nowMs: 0, occupiedSides: [], closingMps: { LEFT: 20 }, radarAvailable: true })
    )
    state = advanceRc17Alerts(
      state,
      alertInput({ nowMs: 400, occupiedSides: [], closingMps: { LEFT: 20 }, radarAvailable: true })
    )
    expect(state.fastClosing.active).toBe(true)
    state = advanceRc17Alerts(
      state,
      alertInput({ nowMs: 500, occupiedSides: [], closingMps: {}, radarAvailable: false })
    )
    expect(state.fastClosing.active).toBe(false)
  })

  it('engages three-wide only after 150 ms with BOTH sides occupied', () => {
    let state = advanceRc17Alerts(
      createRc17AlertState(),
      alertInput({ nowMs: 0, occupiedSides: ['LEFT', 'RIGHT'] })
    )
    expect(state.threeWide.active).toBe(false)
    state = advanceRc17Alerts(
      state,
      alertInput({ nowMs: RC17_THREE_WIDE_ENGAGE_MS - 1, occupiedSides: ['LEFT', 'RIGHT'] })
    )
    expect(state.threeWide.active).toBe(false)
    state = advanceRc17Alerts(state, alertInput({ nowMs: RC17_THREE_WIDE_ENGAGE_MS, occupiedSides: ['LEFT', 'RIGHT'] }))
    expect(state.threeWide.active).toBe(true)
  })

  it('clears three-wide the moment one side empties, and never engages from one side alone', () => {
    let state = advanceRc17Alerts(createRc17AlertState(), alertInput({ nowMs: 0, occupiedSides: ['LEFT', 'RIGHT'] }))
    state = advanceRc17Alerts(state, alertInput({ nowMs: 500, occupiedSides: ['LEFT', 'RIGHT'] }))
    expect(state.threeWide.active).toBe(true)
    state = advanceRc17Alerts(state, alertInput({ nowMs: 520, occupiedSides: ['LEFT'] }))
    expect(state.threeWide.active).toBe(false)
    state = advanceRc17Alerts(state, alertInput({ nowMs: 5_000, occupiedSides: ['LEFT'] }))
    expect(state.threeWide.active).toBe(false)
  })

  it('unlatches every condition alert when its own input goes stale or missing', () => {
    let state = createRc17AlertState()
    state = advanceRc17Alerts(state, alertInput({ nowMs: 0, occupiedSides: ['LEFT', 'RIGHT'], closingMps: { LEFT: 9 }, radarAvailable: true }))
    state = advanceRc17Alerts(state, alertInput({ nowMs: 400, occupiedSides: ['LEFT', 'RIGHT'], closingMps: { LEFT: 9 }, radarAvailable: true }))
    expect(state.carAlongside.active).toBe(true)
    expect(state.threeWide.active).toBe(true)
    expect(state.fastClosing.active).toBe(true)

    const blind = modelFor(blindSnapshot())
    const cleared = clearInvalidRc17Alerts(state, blind)
    expect(cleared.carAlongside.active).toBe(false)
    expect(cleared.threeWide.active).toBe(false)
    expect(cleared.fastClosing.active).toBe(false)
  })

  it('lights the sectors and the flag from the alert, so both move on the same hysteresis', () => {
    const alerts = advanceRc17Alerts(createRc17AlertState(), alertInput({ nowMs: 0, occupiedSides: ['LEFT'] }))
    const model = modelFor(snapshot(), 0, { alerts })
    const left = model.sectors.find((sector) => sector.sector === 'LEFT')!
    const rightSector = model.sectors.find((sector) => sector.sector === 'RIGHT')!
    expect(left.occupied).toBe(true)
    expect(left.tone).toBe('signature')
    expect(left.label).toBe('LEFT')
    // OV-8 and OV-11: a clear sector is the ABSENCE of fill and carries no word at all.
    expect(rightSector.occupied).toBe(false)
    expect(rightSector.tone).toBe('clear')
    expect(rightSector.label).toBe('')
    expect(model.flag).toEqual({ text: 'CAR LEFT', kind: 'occupied' })
    expect(rc17AlertLines(model)).toEqual(['CAR ALONGSIDE'])
  })

  it('escalates both side sectors and the flag word when three-wide latches', () => {
    let alerts = advanceRc17Alerts(createRc17AlertState(), alertInput({ nowMs: 0, occupiedSides: ['LEFT', 'RIGHT'] }))
    alerts = advanceRc17Alerts(alerts, alertInput({ nowMs: 400, occupiedSides: ['LEFT', 'RIGHT'] }))
    const model = modelFor(snapshot({ carLeftRight: 'both' }), 0, { alerts })
    expect(model.flag).toEqual({ text: 'THREE WIDE', kind: 'three-wide' })
    for (const side of RC17_SIDES) {
      const sector = model.sectors.find((entry) => entry.sector === side)!
      expect(sector.tone).toBe('danger')
      // Packet 19: the side is still carried by a WORD, never by the colour alone.
      expect(sector.label).toBe(side)
    }
    expect(rc17AlertLines(model)).toEqual(['CAR ALONGSIDE', 'THREE WIDE'])
  })
})

describe('RC-17 responsive contract', () => {
  it('resolves the packet breakpoints and their compact modes', () => {
    expect(rc17LayoutForContentBox(800, 480)).toBe('native')
    expect(rc17LayoutForContentBox(801, 481)).toBe('native')
    expect(rc17LayoutForContentBox(1024, 600)).toBe('app')
    expect(rc17LayoutForContentBox(1920, 1080)).toBe('app')
    expect(rc17LayoutForContentBox(640, 520)).toBe('compact')
    expect(rc17LayoutForContentBox(0, 0)).toBe('app')
    expect(rc17CompactModeForContentBox(400, 800)).toBe('phone')
    expect(rc17CompactModeForContentBox(900, 400)).toBe('landscape')
    expect(rc17CompactModeForContentBox(640, 520)).toBe('standard')
    expect(rc17CompactModeForContentBox(800, 480)).toBe('standard')
  })

  it('sizes the portrait bands from the measured box, and only in portrait', () => {
    expect(rc17PhoneGeometryForContentBox(640, 520)).toBeNull()
    const phone = rc17PhoneGeometryForContentBox(400, 800)!
    expect(phone.flagHeight).toBeGreaterThanOrEqual(22)
    expect(phone.rowHeight).toBeGreaterThanOrEqual(34)
    expect(phone.tertiaryHeight).toBeGreaterThanOrEqual(30)
  })
})

describe('RC-17 rendering', () => {
  it('publishes the layout, buffer and alert contract on the root element', () => {
    const html = markup(snapshot(), nativeConfig)
    assertClean(html)
    expect(html).toContain('data-widget="raceconRc17Dash"')
    expect(html).toContain('data-rc17-layout="native"')
    expect(html).toContain('data-rc17-buffer-state="accepted"')
    expect(html).toContain('data-rc17-spotter="left"')
    expect(html).toContain('data-rc17-radar="live"')
    expect(html).toContain('data-rc17-content-width="800"')
    expect(html).toContain('data-rc17-content-height="480"')
    expect(html).not.toContain('data-rc17-compact-mode')
  })

  it('reproduces the approved reference frame in the DOM', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('data-rc17-flag-kind="occupied"')
    expect(html).toContain('CAR LEFT')
    expect(html).toContain('>291<')
    expect(html).toContain('>6400<')
    expect(html).toContain('>92<')
    expect(html).toContain('>--.-<')
    expect(html).toContain('data-rc17-alert-keys="CAR ALONGSIDE"')
    // Packet 15: the other two alerts are armed and silent, so no surface escalates.
    expect(html).toContain('data-rc17-closing-alert="false"')
    expect(html).not.toContain('THREE WIDE')
  })

  it('renders every packet 11.1 zone at 800x480 and neither packet 12.1 module', () => {
    const html = markup(snapshot(), nativeConfig)
    for (const zone of ['flags', 'line', 'clock', 'closing', 'pace', 'tertiary']) {
      expect(html, `missing zone ${zone}`).toContain(`data-rc17-zone="${zone}"`)
    }
    expect(html).not.toContain('data-rc17-zone="packMap"')
    expect(html).not.toContain('data-rc17-zone="lane"')
  })

  it('reveals the pack map and the lane-usage module only on the app canvas', () => {
    const html = markup(snapshot(), config)
    expect(html).toContain('data-rc17-layout="app"')
    expect(html).toContain('data-rc17-zone="packMap"')
    expect(html).toContain('data-rc17-zone="lane"')
    expect(html).toContain('data-rc17-pack-available="true"')
    expect(html).toContain('data-rc17-pack-contacts="1"')
    // The lane history has no channel, so it renders structure with zero rows.
    expect(html).toContain('data-rc17-lane-rows="0"')
    expect(html).toContain(RC17_NO_LANE_SOURCE)
  })

  it('renders zero pack markers and says so rather than fabricating a pack', () => {
    const html = markup(blindSnapshot(), config)
    expect(html).toContain('data-rc17-pack-available="false"')
    expect(html).toContain('data-rc17-pack-contacts="0"')
    expect(html).toContain(RC17_NO_RADAR_SOURCE)
    expect(html).not.toContain('data-testid="rc17-pack-car"')
  })

  it('keeps the structural 12 o clock quadrant and the heading tick out of the data layer', () => {
    const html = markup(snapshot(), nativeConfig)
    expect(html).toContain('data-testid="rc17-heading-quadrant"')
    expect(html).toContain('data-testid="rc17-heading-tick"')
    expect(html).toContain('data-testid="rc17-own-car"')
    // Exactly three data sectors; 12 o'clock is never one of them.
    expect(html.match(/data-testid="rc17-sector"/g)).toHaveLength(3)
    expect(html).not.toContain('data-rc17-sector="HEADING"')
  })

  it('renders a clean dash-only frame with no telemetry at all', () => {
    const html = markup(null, nativeConfig)
    assertClean(html)
    expect(html).toContain('data-rc17-spotter="unavailable"')
    expect(html).toContain('data-rc17-radar="unavailable"')
    expect(html).toContain('data-rc17-alerts="silent"')
    expect(html).toContain(RC17_NO_DATA)
    expect(html).toContain('>---<')
    expect(html).toContain('>----<')
  })

  it('exposes the compact mode attribute only in the compact layout', () => {
    const compact = markup(snapshot(), { ...config, position: { x: 0, y: 0, width: 640, height: 520 } })
    expect(compact).toContain('data-rc17-layout="compact"')
    expect(compact).toContain('data-rc17-compact-mode="standard"')
    const phone = markup(snapshot(), { ...config, position: { x: 0, y: 0, width: 400, height: 800 } })
    expect(phone).toContain('data-rc17-compact-mode="phone"')
  })

  it('renders cleanly at every breakpoint and keeps all three alert surfaces in the DOM', () => {
    for (const size of BREAKPOINTS) {
      const html = markup(snapshot(), { ...config, position: { x: 0, y: 0, ...size } })
      assertClean(html)
      for (const zone of ALERT_SURFACE_ZONES) {
        expect(html, `${size.width}x${size.height} lost ${zone}`).toContain(`data-rc17-zone="${zone}"`)
      }
    }
  })

  it('never marks a line option as selected in any rendered frame', () => {
    for (const size of BREAKPOINTS) {
      const html = markup(snapshot(), { ...config, position: { x: 0, y: 0, ...size } })
      expect(html, `${size.width}x${size.height}`).not.toContain('data-rc17-selected="true"')
    }
  })
})

describe('RC-17 shares the RC-01 fail-closed ingest buffer', () => {
  it('refuses mock and replay telemetry and raises no alert from it', () => {
    const mock = markup(snapshot({ sim: 'mock' } as Partial<TelemetrySnapshot>), nativeConfig)
    expect(mock).toContain('data-rc17-buffer-state="mock-telemetry"')
    expect(mock).toContain('data-rc17-spotter="unavailable"')
    expect(mock).toContain('data-rc17-alerts="silent"')

    const replay = markup(
      snapshot({ replayContext: { state: 'replay' } } as Partial<TelemetrySnapshot>),
      nativeConfig
    )
    expect(replay).toContain('data-rc17-buffer-state="replay-telemetry"')
    expect(replay).toContain('data-rc17-spotter="unavailable"')
    expect(replay).toContain('data-rc17-alerts="silent"')
  })

  it('accepts a live identified snapshot and rejects an unidentified one', () => {
    const buffer = new Rc01LiveTelemetryBuffer()
    expect(buffer.ingest(snapshot(), 0).accepted).toBe(true)
    const orphan = new Rc01LiveTelemetryBuffer()
    expect(orphan.ingest(snapshot({ sessionUniqueId: undefined } as Partial<TelemetrySnapshot>), 0).accepted).toBe(false)
  })
})

describe('RC-17 live surfaces', () => {
  /**
   * Frames are pushed at 20 Hz so the tightest budget this display owns — the floored proximity
   * cadence — is never missed between steps: a test that jumped straight to a deadline would
   * correctly find every alert disarmed by staleness rather than by its own trigger.
   */
  function mount(initial: Partial<TelemetrySnapshot> = {}, cfg = nativeConfig): {
    push: (atMs: number, overrides?: Partial<TelemetrySnapshot>) => void
    root: () => HTMLElement
    view: ReturnType<typeof render>
  } {
    vi.useFakeTimers()
    let monotonicMs = 0
    let current = initial
    const monotonicClock = (): number => monotonicMs
    const view = render(
      createElement(RaceconRc17DashWidget, {
        snapshot: snapshot(initial, 1_000),
        config: cfg,
        monotonicClock
      })
    )
    const frame = (value: TelemetrySnapshot | null): void => {
      view.rerender(createElement(RaceconRc17DashWidget, { snapshot: value, config: cfg, monotonicClock }))
    }
    const push = (atMs: number, overrides?: Partial<TelemetrySnapshot>): void => {
      if (overrides) current = { ...current, ...overrides }
      if (atMs <= monotonicMs) {
        frame(snapshot(current, 1_000 + monotonicMs))
        return
      }
      while (monotonicMs < atMs) {
        const step = Math.min(50, atMs - monotonicMs)
        monotonicMs += step
        act(() => {
          vi.advanceTimersByTime(step)
        })
        frame(snapshot(current, 1_000 + monotonicMs))
      }
    }
    return { push, root: () => view.container.querySelector<HTMLElement>('.rc17-widget')!, view }
  }

  it('holds the flag alongside for 2.4 s and releases it 300 ms after the sector empties', () => {
    const { push, root } = mount()
    push(2_400)
    expect(root().dataset.rc17FlagKind).toBe('occupied')
    expect(root().dataset.rc17AlertKeys).toBe('CAR ALONGSIDE')
    push(2_600, { carLeftRight: 'clear' })
    expect(root().dataset.rc17FlagKind).toBe('occupied')
    push(2_800)
    expect(root().dataset.rc17FlagKind).toBe('none')
    expect(root().dataset.rc17Alerts).toBe('silent')
  })

  it('escalates to THREE WIDE once both sides are occupied past the 150 ms debounce', () => {
    const { push, root, view } = mount()
    push(400, { carLeftRight: 'both' })
    expect(root().dataset.rc17FlagKind).toBe('three-wide')
    expect(view.container.querySelector('[data-testid="rc17-three-wide"]')?.textContent).toBe('THREE WIDE')
    push(600, { carLeftRight: 'left' })
    expect(root().dataset.rc17FlagKind).toBe('occupied')
    expect(view.container.querySelector('[data-testid="rc17-three-wide"]')).toBeNull()
  })

  it('says NO DATA rather than clear when the spotter feed drops mid-stint', () => {
    const { push, root, view } = mount()
    push(400)
    expect(root().dataset.rc17FlagKind).toBe('occupied')
    push(1_200, { carLeftRight: undefined, radarCars: undefined } as Partial<TelemetrySnapshot>)
    expect(root().dataset.rc17FlagKind).toBe('unavailable')
    expect(view.container.querySelector('[data-testid="rc17-flag"]')?.textContent).toBe(RC17_NO_DATA)
    expect(root().dataset.rc17Alerts).toBe('silent')
  })

  it('raises the fast-closing surface only from a measured rate, then drops it', () => {
    const { push, view } = mount({ carLeftRight: 'clear', radarCars: [{ carIdx: 12, relativeX: 0, relativeY: -14 }] } as Partial<TelemetrySnapshot>)
    const closing = (): HTMLElement => view.container.querySelector<HTMLElement>('[data-testid="rc17-closing"]')!
    push(100)
    expect(closing().dataset.rc17ClosingAlert).toBe('false')
    // Two 50 ms steps closing 0.6 m each is 12 m/s, comfortably past the declared threshold.
    push(150, { radarCars: [{ carIdx: 12, relativeX: 0, relativeY: -13.4 }] } as Partial<TelemetrySnapshot>)
    push(400, { radarCars: [{ carIdx: 12, relativeX: 0, relativeY: -12.8 }] } as Partial<TelemetrySnapshot>)
    expect(closing().dataset.rc17ClosingAlert).toBe('true')
    expect(closing().dataset.rc17ClosingArrow).toBe('BEHIND')
  })
})

/**
 * A dashboard preview receives one snapshot at mount and is never fed again. A running display
 * clock would age that single frame past its own thresholds and mutate the rendered text with no
 * new data behind it — the exact non-determinism `inert-previews.browser.test.ts` observes. RC-17
 * therefore uses the shared `useRaceconDisplayClock` hook and never its own interval.
 */
describe('RC-17 honours the shared display-clock freeze policy', () => {
  function mountClock(preview: 'inert' | undefined): { text: () => string; advance: (ms: number) => void } {
    vi.useFakeTimers()
    let monotonicMs = 0
    const view = render(
      createElement(RaceconRc17DashWidget, {
        snapshot: snapshot(),
        config: config,
        preview,
        monotonicClock: () => monotonicMs
      })
    )
    const step = RACECON_DISPLAY_CLOCK_INTERVAL_MS * 5
    return {
      text: () => view.container.textContent ?? '',
      advance: (ms: number) => {
        for (let elapsed = 0; elapsed < ms; elapsed += step) {
          act(() => {
            monotonicMs += step
            vi.advanceTimersByTime(step)
          })
        }
      }
    }
  }

  it('agrees with the family policy that any non-live render freezes', () => {
    expect(raceconDisplayClockFrozen(undefined)).toBe(false)
    expect(raceconDisplayClockFrozen('inert')).toBe(true)
  })

  it('holds an inert preview byte-identical for 30 s', () => {
    const { text, advance } = mountClock('inert')
    const mounted = text()
    advance(30_000)
    expect(text()).toBe(mounted)
  }, 30_000)

  it('still ages a live frame, so a real dashboard degrades its stale channels', () => {
    const { text, advance } = mountClock(undefined)
    const mounted = text()
    advance(30_000)
    expect(text()).not.toBe(mounted)
    expect(text()).toContain(RC17_NO_DATA)
  }, 30_000)
})

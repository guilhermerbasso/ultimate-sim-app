// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOverlayStyle, type OverlayWidgetConfig } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { RACECON_DISPLAY_CLOCK_INTERVAL_MS, raceconDisplayClockFrozen } from './raceconDisplayClock'
import { RaceconRc20DashWidget } from './RaceconRc20DashWidget'
import {
  RC01_MIN_STREAM_FRESH_MS,
  Rc01LiveTelemetryBuffer,
  createRc01ChannelReceipts,
  type Rc01MonotonicClock
} from './raceconRc01Core'
import {
  RC20_APP_HEIGHT_PX,
  RC20_APP_WIDTH_PX,
  RC20_APP_ZONES,
  RC20_BRAKE_AXLES,
  RC20_BRAKE_AXLE_CORNERS,
  RC20_BRAKE_CHANNELS,
  RC20_CHANNEL_STALE_MS,
  RC20_COLD_WARMUP_ENGAGE_MS,
  RC20_CORNERS,
  RC20_CQW_PX,
  RC20_DASHBOARD_PRESET_ID,
  RC20_GRID_STRIP_CELLS,
  RC20_GRID_STRIP_CELL_COUNT,
  RC20_IRACING_START_BITS,
  RC20_JUMP_START_ENGAGE_MS,
  RC20_JUMP_START_SPEED_KMH,
  RC20_LADDER_BAR_COUNT,
  RC20_LADDER_DISCLAIMER,
  RC20_LAUNCH_CONTROL_EVENT,
  RC20_LAUNCH_REVIEW_MAX_REACTION_MS,
  RC20_MODES,
  RC20_MODE_UNAVAILABLE,
  RC20_NATIVE_HEIGHT_PX,
  RC20_NATIVE_WIDTH_PX,
  RC20_NATIVE_ZONES,
  RC20_OVER_REV_ENGAGE_MS,
  RC20_OVER_REV_HYSTERESIS_MS,
  RC20_PACKET_OMISSIONS,
  RC20_PANEL_LUMINANCE_STEP,
  RC20_PANEL_LUMINANCE_STEP_MIN,
  RC20_REGISTRATION,
  RC20_STAGE_UNAVAILABLE,
  RC20_START_FEED_UNAVAILABLE,
  RC20_START_STAGES,
  RC20_TOKENS,
  RC20_TRANSPORT_FLOOR_MS,
  RC20_TYPE_SCALE_MIN_SEPARATION_PCT,
  RC20_TYPE_SCALE_PX,
  RC20_TYRE_CHANNELS,
  RC20_WARMUP_LOCATIONS,
  RC20_WARMUP_TARGET_C,
  RC20_WIDGET_ID,
  type Rc20AlertInput,
  type Rc20LaunchControl,
  Rc20LaunchReviewBuffer,
  type Rc20Rect,
  type Rc20StartStage,
  type Rc20ZoneMap,
  advanceRc20Alerts,
  clearInvalidRc20Alerts,
  createRc20AlertState,
  createRc20AuxReceipts,
  createRc20DashboardModel,
  createRc20LaunchControl,
  rc20AlertInputForModel,
  rc20AlertLines,
  rc20AuxChannelValue,
  rc20AxleTempC,
  rc20CompactModeForContentBox,
  rc20LadderBars,
  rc20LaunchBand,
  rc20LaunchControlFromEvent,
  rc20LaunchCuesArmed,
  rc20LayoutForContentBox,
  rc20LitBarsForStage,
  rc20ModeForInputs,
  rc20Percent,
  rc20RectCentreX,
  rc20RectsOverlap,
  rc20ScaleFraction,
  rc20StageIsReleased,
  rc20StageLabel,
  rc20StartStageFromSnapshot,
  rc20TypeScaleCqw,
  rc20TypeScaleSeparationsPct,
  rc20ZoneStyle,
  rc20ZonesForLayout
} from './raceconRc20Core'

const config: OverlayWidgetConfig = {
  id: 'raceconRc08Dash',
  enabled: true,
  locked: true,
  favorite: false,
  position: { x: 0, y: 0, width: RC20_APP_WIDTH_PX, height: RC20_APP_HEIGHT_PX },
  opacity: 100,
  stylePreset: 'minimal',
  style: createDefaultOverlayStyle(),
  display: null
}

const nativeConfig: OverlayWidgetConfig = {
  ...config,
  position: { x: 0, y: 0, width: RC20_NATIVE_WIDTH_PX, height: RC20_NATIVE_HEIGHT_PX }
}

const phoneConfig: OverlayWidgetConfig = {
  ...config,
  position: { x: 0, y: 0, width: 400, height: 740 }
}

const landscapeConfig: OverlayWidgetConfig = {
  ...config,
  position: { x: 0, y: 0, width: 800, height: 420 }
}

/**
 * The approved RC-20 reference state (attempt-003 governed 800x480, re-adjudicated in
 * `image-qa-v2.md`): GRID mode, launch armed, stationary in the grid slot, the generic training
 * ladder fully built and the lights NOT released. All three packet section 15 alerts are ARMED
 * and SILENT — which is exactly what the governance chain measures in the frame: zero amber and
 * zero green connected components, and every true-red pixel confined to the ladder card.
 *
 * The right-rear tyre deliberately has no sensor: that `--` is the packet 16 UNAVAILABLE
 * rendering, not the cold-warm-up alert firing. `sessionFlagsRaw` carries iRacing's `StartSet`
 * bit, which is the one genuine start-system light state feed the app has.
 */
function snapshot(overrides: Partial<TelemetrySnapshot> = {}, timestamp = 6_120_000): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp,
    sessionUniqueId: 91,
    speedKmh: 0,
    rpm: 4_820,
    maxRpm: 7_600,
    gear: 1,
    throttle: 0.55,
    brake: 0,
    clutch: 0.42,
    sessionType: 'Race',
    sessionState: 'getInCar',
    sessionFlagsRaw: RC20_IRACING_START_BITS.startSet,
    position: 7,
    currentLap: 0,
    playerCarIdx: 3,
    waterTempC: 84,
    fuelLiters: 96.4,
    tyres: {
      lf: { tempC: 88 },
      rf: { tempC: 86 },
      lr: { tempC: 84 },
      rr: {}
    },
    brakeTempC: { lf: 470, rf: 460, lr: 415, rr: 405 },
    ...overrides
  } as TelemetrySnapshot
}

/** A formation-lap frame: pacing, moving, no start lights yet. */
function formationSnapshot(overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return snapshot({
    sessionState: 'paradeLaps',
    paceMode: 'doubleFileStart',
    sessionFlagsRaw: 0,
    speedKmh: 62,
    ...overrides
  })
}

function markup(value: TelemetrySnapshot | null, cfg = config): string {
  return renderToStaticMarkup(createElement(RaceconRc20DashWidget, { snapshot: value, config: cfg }))
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
  options: Parameters<typeof createRc20DashboardModel>[4] = {},
  receiptsAtMs = nowMs
): ReturnType<typeof createRc20DashboardModel> {
  const receipts = value ? createRc01ChannelReceipts(value, receiptsAtMs) : new Map()
  const aux = value ? createRc20AuxReceipts(value, receiptsAtMs) : new Map()
  return createRc20DashboardModel(value, receipts, aux, nowMs, options)
}

function alertInput(overrides: Partial<Rc20AlertInput> = {}): Rc20AlertInput {
  return {
    nowMs: 0,
    armed: true,
    overBandCeiling: false,
    overRevMeasurable: true,
    movingBeforeRelease: false,
    released: false,
    startFeedPresent: true,
    formation: false,
    coldLocations: [],
    ...overrides
  }
}

function control(overrides: Partial<Rc20LaunchControl> = {}): Rc20LaunchControl {
  return { ...createRc20LaunchControl(), ...overrides }
}

function right(rect: Rc20Rect): number {
  return rect.left + rect.width
}

function bottom(rect: Rc20Rect): number {
  return rect.top + rect.height
}

function zoneList(zones: Rc20ZoneMap): ReadonlyArray<readonly [string, Rc20Rect]> {
  return Object.entries(zones).filter((entry): entry is [string, Rc20Rect] => Boolean(entry[1]))
}

function view(value: TelemetrySnapshot | null, cfg = config): HTMLElement {
  return render(createElement(RaceconRc20DashWidget, { snapshot: value, config: cfg })).container
}

function root(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>('.rc20-widget')
  expect(element).not.toBeNull()
  return element!
}

function text(container: HTMLElement, testid: string): string {
  return container.querySelector(`[data-testid="${testid}"]`)?.textContent ?? ''
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// ─────────────────────────────────────────────────────────── registration facts

describe('RC-20 registration facts for the catalog wiring PR', () => {
  /**
   * This PR ships the four new files ONLY. Registration lands in the separate catalog wiring
   * PR, so the widget is intentionally not yet reachable from the catalog and nothing here
   * asserts its presence or absence in `WIDGET_COMPONENTS`, `OVERLAY_DASHBOARD_PRESETS` or any
   * other shared table — an assertion either way would break one of the two PRs.
   */
  it('exports the exact literals the wiring PR must register', () => {
    expect(RC20_WIDGET_ID).toBe('raceconRc20Dash')
    // Corrected by the catalog wiring PR from `racecon-rc20-lights-out`: RC-01 … RC-19 all use
    // `racecon_rcNN_dash`, and that value was the only hyphenated preset id in the catalogue.
    expect(RC20_DASHBOARD_PRESET_ID).toBe('racecon_rc20_dash')
    expect(RC20_REGISTRATION.overlayWidgetId).toBe(RC20_WIDGET_ID)
    expect(RC20_REGISTRATION.presetId).toBe(RC20_DASHBOARD_PRESET_ID)
    expect(RC20_REGISTRATION.widgetComponent).toBe('RaceconRc20DashWidget')
    expect(RC20_REGISTRATION.presetFamily).toBe('racecon')
    expect(RC20_REGISTRATION.embeddedFamily).toBe('racecon')
    expect(RC20_REGISTRATION.presetScaleMode).toBe('stretch')
    expect(RC20_REGISTRATION.presetWidth).toBe(RC20_APP_WIDTH_PX)
    expect(RC20_REGISTRATION.presetHeight).toBe(RC20_APP_HEIGHT_PX)
  })

  it('is a full-frame, responsive, identity-scoped dashboard and never a floating overlay', () => {
    // Full-frame dashboards are deliberately excluded from the floating-overlay picker.
    expect(RC20_REGISTRATION.inOverlayWidgetsPicker).toBe(false)
    // Without this the dashboard is transform-resampled instead of laid out responsively.
    expect(RC20_REGISTRATION.responsiveFullFrame).toBe(true)
    // The widget refuses mock and replay telemetry, so it must not claim support on every sim.
    expect(RC20_REGISTRATION.identityScoped).toBe(true)
    expect(RC20_REGISTRATION.regenerateIdentityCatalog).toBe(true)
  })

  it('stamps the widget id on the rendered root so the catalog can find it', () => {
    const container = view(snapshot())
    expect(root(container).dataset.widget).toBe(RC20_WIDGET_ID)
  })
})

// ─────────────────────────────────────────────────────────── packet omissions

describe('RC-20 packet omissions are a contract, not an oversight', () => {
  it('documents every gap and normative override this build applies', () => {
    for (const key of [
      'startLightLadderStages',
      'startLightFeedOffIracing',
      'abortStage',
      'launchRpmTarget',
      'gridSlot',
      'waterTempGearFuel',
      'shiftLedReturn',
      'wheelspinReview',
      'brakeAxleAggregation',
      'ladderGutterNo6',
      'gridStripEightCells',
      'twoRedTokens',
      'appCanvasModeAndSlot',
      'ladderDominanceIsPositional',
      'expansionIsHeightDriven',
      'resettableLine',
      'launchArmControlIsExternal',
      'warmUpTargetsDeclared'
    ] as const) {
      expect(RC20_PACKET_OMISSIONS[key], key).toBeTruthy()
    }
  })

  it('carries no channel for the three zoneless section 16 rows (gap G-2)', () => {
    const channels = Object.keys(RC20_CHANNEL_STALE_MS)
    expect(channels).not.toContain('waterTemp')
    expect(channels).not.toContain('gear')
    expect(channels).not.toContain('fuel')
    // RPM is projected by the shared RC-01 model, whose 200 ms budget IS section 16's rule.
    expect(channels).not.toContain('rpm')
  })

  it('never renders water temperature, gear or fuel even when the provider supplies them', () => {
    const html = markup(snapshot({ waterTempC: 84, gear: 2, fuelLiters: 96.4 }), nativeConfig)
    expect(html).not.toContain('WATER')
    expect(html).not.toContain('COOLANT')
    expect(html).not.toContain('FUEL')
    expect(html).not.toMatch(/>GEAR</)
    expect(html).not.toContain('96.4')
  })

  it('has no shift, LED, rev or arc element anywhere (RC20_PACKET_OMISSIONS.shiftLedReturn)', () => {
    for (const cfg of [nativeConfig, config, phoneConfig]) {
      const html = markup(snapshot(), cfg).toLowerCase()
      expect(html).not.toContain('rc20-led')
      expect(html).not.toContain('shift')
      expect(html).not.toContain('rev-light')
      expect(html).not.toContain('rc20-arc')
    }
  })

  it('never publishes a wheelspin figure in the launch review', () => {
    const html = markup(snapshot(), config).toLowerCase()
    expect(html).not.toContain('wheelspin')
    expect(html).not.toContain('slip')
  })
})

// ─────────────────────────────────────────────────────────── palette

describe('RC-20 palette ships packet 11.3 verbatim', () => {
  it('keeps the packet tokens and the >= 9 panel luminance step', () => {
    expect(RC20_TOKENS.bg).toBe('#08090C')
    expect(RC20_TOKENS.panel).toBe('#12141C')
    expect(RC20_TOKENS.signature).toBe('#FF2A2A')
    expect(RC20_TOKENS.danger).toBe('#FF3A2E')
    expect(RC20_PANEL_LUMINANCE_STEP).toBeGreaterThanOrEqual(RC20_PANEL_LUMINANCE_STEP_MIN)
  })

  it('separates the two reds semantically because no pixel test separates them (NO-8)', () => {
    const rgb = (hex: string): readonly number[] => [
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16)
    ]
    const [dr, dg, db] = rgb(RC20_TOKENS.danger)
    const [sr, sg, sb] = rgb(RC20_TOKENS.signature)
    const distance = Math.sqrt((dr - sr) ** 2 + (dg - sg) ** 2 + (db - sb) ** 2)
    expect(distance).toBeLessThan(20)
    expect(RC20_PACKET_OMISSIONS.twoRedTokens).toContain('semantically')
  })
})

// ─────────────────────────────────────────────────────────── start-light stage

describe('RC-20 start-light stage decode', () => {
  it('reads iRacing start bits in release-first priority order', () => {
    expect(rc20StartStageFromSnapshot(snapshot({ sessionFlagsRaw: RC20_IRACING_START_BITS.startHidden }))).toBe('DARK')
    expect(rc20StartStageFromSnapshot(snapshot({ sessionFlagsRaw: RC20_IRACING_START_BITS.startReady }))).toBe('ARMED')
    expect(rc20StartStageFromSnapshot(snapshot({ sessionFlagsRaw: RC20_IRACING_START_BITS.startSet }))).toBe('S5')
    expect(rc20StartStageFromSnapshot(snapshot({ sessionFlagsRaw: RC20_IRACING_START_BITS.startGo }))).toBe('RELEASED')
    // Several bits can be live at once; the release always wins.
    const all =
      RC20_IRACING_START_BITS.startHidden |
      RC20_IRACING_START_BITS.startReady |
      RC20_IRACING_START_BITS.startSet
    expect(rc20StartStageFromSnapshot(snapshot({ sessionFlagsRaw: (all | RC20_IRACING_START_BITS.startGo) >>> 0 }))).toBe(
      'RELEASED'
    )
  })

  it('handles StartGo arriving as a signed 32-bit integer', () => {
    // 0x80000000 is negative when the bitfield is read as a signed int, exactly as the
    // provider's own diagnostics normalise with `>>> 0`.
    expect(rc20StartStageFromSnapshot(snapshot({ sessionFlagsRaw: -2_147_483_648 }))).toBe('RELEASED')
  })

  it('refuses to decode start bits on any sim other than iRacing', () => {
    // The LMU provider puts `mGamePhase` in `sessionFlagsRaw`; decoding it would be nonsense.
    for (const sim of ['lmu', 'acc', 'ac', 'ams2', 'none'] as const) {
      expect(rc20StartStageFromSnapshot(snapshot({ sim, sessionFlagsRaw: RC20_IRACING_START_BITS.startSet }))).toBeNull()
    }
    expect(RC20_PACKET_OMISSIONS.startLightFeedOffIracing).toContain('mGamePhase')
  })

  it('dashes when the bitfield is missing, non-finite or carries no start bit', () => {
    expect(rc20StartStageFromSnapshot(null)).toBeNull()
    expect(rc20StartStageFromSnapshot(snapshot({ sessionFlagsRaw: undefined }))).toBeNull()
    expect(rc20StartStageFromSnapshot(snapshot({ sessionFlagsRaw: Number.NaN }))).toBeNull()
    expect(rc20StartStageFromSnapshot(snapshot({ sessionFlagsRaw: 0x0000_0004 }))).toBeNull()
  })

  it('never invents the intermediate stages the feed cannot resolve', () => {
    const produced = new Set<Rc20StartStage | null>()
    for (let bit = 0; bit < 32; bit += 1) {
      produced.add(rc20StartStageFromSnapshot(snapshot({ sessionFlagsRaw: (1 << bit) >>> 0 })))
    }
    expect(produced.has('S1')).toBe(false)
    expect(produced.has('S2')).toBe(false)
    expect(produced.has('S3')).toBe(false)
    expect(produced.has('S4')).toBe(false)
    expect(produced.has('ABORT')).toBe(false)
    expect(RC20_PACKET_OMISSIONS.startLightLadderStages).toContain('four states')
  })

  it('maps every enumerated stage to a lit-bar count within the five-bar structure', () => {
    const expected: Record<Rc20StartStage, number> = {
      DARK: 0,
      ARMED: 0,
      S1: 1,
      S2: 2,
      S3: 3,
      S4: 4,
      S5: 5,
      RELEASED: 0,
      ABORT: 0
    }
    for (const stage of RC20_START_STAGES) {
      const lit = rc20LitBarsForStage(stage)
      expect(lit, stage).toBe(expected[stage])
      expect(lit).toBeLessThanOrEqual(RC20_LADDER_BAR_COUNT)
    }
    expect(rc20LitBarsForStage(null)).toBe(0)
  })

  it('extinguishes the ladder at the release, which is what lights out means', () => {
    expect(rc20StageIsReleased('RELEASED')).toBe(true)
    expect(rc20StageIsReleased('S5')).toBe(false)
    expect(rc20StageIsReleased(null)).toBe(false)
    expect(rc20LitBarsForStage('RELEASED')).toBe(0)
  })

  it('always builds exactly five bars, whatever it is asked for', () => {
    for (const lit of [-4, 0, 1, 3, 5, 9, Number.NaN, Number.POSITIVE_INFINITY]) {
      const bars = rc20LadderBars(lit)
      expect(bars).toHaveLength(RC20_LADDER_BAR_COUNT)
      expect(bars.filter((bar) => bar.lit).length).toBeLessThanOrEqual(RC20_LADDER_BAR_COUNT)
      expect(bars.map((bar) => bar.index)).toEqual([0, 1, 2, 3, 4])
    }
    expect(rc20LadderBars(3).map((bar) => bar.lit)).toEqual([true, true, true, false, false])
  })

  it('spells every stage out so the ladder is never colour-only (packet 19)', () => {
    expect(rc20StageLabel(null, 0)).toBe(RC20_STAGE_UNAVAILABLE)
    expect(rc20StageLabel('DARK', 0)).toBe('DARK')
    expect(rc20StageLabel('ARMED', 0)).toBe('ARMED')
    expect(rc20StageLabel('S3', 3)).toBe(`STAGE 3 OF ${RC20_LADDER_BAR_COUNT}`)
    expect(rc20StageLabel('RELEASED', 0)).toBe('RELEASED')
    expect(rc20StageLabel('ABORT', 0)).toBe('ABORT')
  })
})

// ─────────────────────────────────────────────────────────── display mode

describe('RC-20 FORMATION -> GRID -> LAUNCH mode machine', () => {
  const inputs = (over: Partial<Parameters<typeof rc20ModeForInputs>[0]> = {}): Parameters<typeof rc20ModeForInputs>[0] => ({
    stage: null,
    sessionPhase: null,
    pacing: false,
    arm: 'auto',
    ...over
  })

  it('launches on the release stage or on the session going racing', () => {
    expect(rc20ModeForInputs(inputs({ stage: 'RELEASED' }))).toBe('LAUNCH')
    expect(rc20ModeForInputs(inputs({ sessionPhase: 'racing' }))).toBe('LAUNCH')
  })

  it('grids on an active start sequence but never on the default hidden state', () => {
    for (const stage of ['ARMED', 'S1', 'S2', 'S3', 'S4', 'S5'] as const) {
      expect(rc20ModeForInputs(inputs({ stage })), stage).toBe('GRID')
    }
    // iRacing keeps StartHidden set through green-flag racing, so DARK alone grids nothing.
    expect(rc20ModeForInputs(inputs({ stage: 'DARK' }))).toBeNull()
    expect(rc20ModeForInputs(inputs({ stage: 'ABORT' }))).toBe('GRID')
  })

  it('formations on a parade lap, a warm-up phase or a reported pacing formation', () => {
    expect(rc20ModeForInputs(inputs({ sessionPhase: 'paradeLaps' }))).toBe('FORMATION')
    expect(rc20ModeForInputs(inputs({ sessionPhase: 'warmup' }))).toBe('FORMATION')
    expect(rc20ModeForInputs(inputs({ pacing: true }))).toBe('FORMATION')
  })

  it('lets the packet 11.5 macro arm the grid, and only when a real feed exists', () => {
    expect(rc20ModeForInputs(inputs({ arm: 'armed', sessionPhase: 'paradeLaps' }))).toBe('GRID')
    expect(rc20ModeForInputs(inputs({ arm: 'armed', pacing: true }))).toBe('GRID')
    expect(rc20ModeForInputs(inputs({ arm: 'armed', stage: 'DARK' }))).toBe('GRID')
    // Nothing to arm against: the macro cannot conjure a start procedure out of no feed.
    expect(rc20ModeForInputs(inputs({ arm: 'armed' }))).toBeNull()
    expect(rc20ModeForInputs(inputs({ arm: 'armed', sessionPhase: 'invalid' }))).toBeNull()
  })

  it('has no mode at all without a start feed, a session phase or a pacing report', () => {
    expect(rc20ModeForInputs(inputs())).toBeNull()
    expect(rc20ModeForInputs(inputs({ sessionPhase: 'checkered' }))).toBeNull()
  })

  it('arms the launch cues only in GRID and LAUNCH (packet 11.5 / 20)', () => {
    expect(rc20LaunchCuesArmed('FORMATION')).toBe(false)
    expect(rc20LaunchCuesArmed('GRID')).toBe(true)
    expect(rc20LaunchCuesArmed('LAUNCH')).toBe(true)
    expect(rc20LaunchCuesArmed(null)).toBe(false)
  })

  it('resolves the approved reference frame to an armed GRID', () => {
    const model = modelFor(snapshot())
    expect(model.mode).toBe('GRID')
    expect(model.armed).toBe(true)
    expect(model.stage).toBe('S5')
    expect(model.ladder.litBars).toBe(RC20_LADDER_BAR_COUNT)
    expect(model.ladder.stageLabel).toBe(`STAGE 5 OF ${RC20_LADDER_BAR_COUNT}`)
  })

  it('resolves the formation frame to FORMATION with every launch cue disarmed', () => {
    const model = modelFor(formationSnapshot())
    expect(model.mode).toBe('FORMATION')
    expect(model.armed).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────── launch-arm control

describe('RC-20 launch-arm macro and the operator-declared band', () => {
  it('accepts a band only when both bounds are finite, positive and ordered', () => {
    expect(rc20LaunchBand(4_650, 4_950)).toEqual({ minRpm: 4_650, maxRpm: 4_950 })
    expect(rc20LaunchBand(4_950, 4_650)).toBeNull()
    expect(rc20LaunchBand(0, 4_950)).toBeNull()
    expect(rc20LaunchBand(-10, 4_950)).toBeNull()
    expect(rc20LaunchBand(4_650, 4_650)).toBeNull()
    expect(rc20LaunchBand(Number.NaN, 4_950)).toBeNull()
    expect(rc20LaunchBand('4650', 4_950)).toBeNull()
  })

  it('arms, disarms and returns to auto from a string command', () => {
    const base = control()
    expect(rc20LaunchControlFromEvent('arm', base)).toEqual({ arm: 'armed', band: null })
    expect(rc20LaunchControlFromEvent('DISARM', { arm: 'armed', band: null })).toEqual({ arm: 'auto', band: null })
    expect(rc20LaunchControlFromEvent('auto', { arm: 'armed', band: { minRpm: 1, maxRpm: 2 } })).toEqual({
      arm: 'auto',
      band: null
    })
    expect(rc20LaunchControlFromEvent(null, { arm: 'armed', band: { minRpm: 1, maxRpm: 2 } })).toEqual({
      arm: 'auto',
      band: null
    })
  })

  it('declares a band and keeps the arm state, or clears it explicitly', () => {
    const armed = control({ arm: 'armed' })
    expect(rc20LaunchControlFromEvent({ bandMinRpm: 4_650, bandMaxRpm: 4_950 }, armed)).toEqual({
      arm: 'armed',
      band: { minRpm: 4_650, maxRpm: 4_950 }
    })
    expect(
      rc20LaunchControlFromEvent({ command: 'arm', bandMinRpm: 4_650, bandMaxRpm: 4_950 }, control())
    ).toEqual({ arm: 'armed', band: { minRpm: 4_650, maxRpm: 4_950 } })
    expect(
      rc20LaunchControlFromEvent({ bandMinRpm: null, bandMaxRpm: null }, { arm: 'armed', band: { minRpm: 1, maxRpm: 2 } })
    ).toEqual({ arm: 'armed', band: null })
  })

  it('ignores every unrecognised payload outright rather than half-applying it', () => {
    const base = control()
    for (const detail of [
      'launch',
      42,
      true,
      {},
      { command: 'go' },
      { bandMinRpm: 4_950, bandMaxRpm: 4_650 },
      { bandMinRpm: 'low', bandMaxRpm: 'high' }
    ]) {
      expect(rc20LaunchControlFromEvent(detail, base), String(JSON.stringify(detail))).toBeNull()
    }
  })
})

// ─────────────────────────────────────────────────────────── telemetry truth table

describe('RC-20 section 16 truth table', () => {
  it('raises the clutch budget to the transport floor and keeps every other budget verbatim', () => {
    expect(RC20_TRANSPORT_FLOOR_MS).toBe(RC01_MIN_STREAM_FRESH_MS)
    // Packet 16 asks for 20 ms, which is below the slowest provider cadence plus its jitter.
    expect(RC20_CHANNEL_STALE_MS.clutch).toBe(RC20_TRANSPORT_FLOOR_MS)
    for (const corner of RC20_CORNERS) {
      expect(RC20_CHANNEL_STALE_MS[RC20_TYRE_CHANNELS[corner]], corner).toBe(200)
      expect(RC20_CHANNEL_STALE_MS[RC20_BRAKE_CHANNELS[corner]], corner).toBe(200)
    }
  })

  it('reads every channel from its own declared source and nothing else', () => {
    const value = snapshot()
    expect(rc20AuxChannelValue(value, 'clutch')).toBeCloseTo(42, 6)
    expect(rc20AuxChannelValue(value, 'startStage')).toBe('S5')
    expect(rc20AuxChannelValue(value, 'tyreLf')).toBe(88)
    expect(rc20AuxChannelValue(value, 'tyreRr')).toBeNull()
    expect(rc20AuxChannelValue(value, 'brakeLf')).toBe(470)
    expect(rc20AuxChannelValue(value, 'brakeRr')).toBe(405)
  })

  it('refuses a clutch reading outside the provider 0..1 contract', () => {
    expect(rc20AuxChannelValue(snapshot({ clutch: 1.4 }), 'clutch')).toBeNull()
    expect(rc20AuxChannelValue(snapshot({ clutch: -0.2 }), 'clutch')).toBeNull()
    expect(rc20AuxChannelValue(snapshot({ clutch: Number.NaN }), 'clutch')).toBeNull()
  })

  it('dashes the clutch when the sensor is absent and never estimates it', () => {
    const model = modelFor(snapshot({ clutch: undefined }))
    expect(model.clutch.value).toBe('--')
    expect(model.clutch.unavailable).toBe(true)
    expect(model.clutchPct).toBeNull()
    expect(model.clutchFraction).toBeNull()
    // The pedal map, the throttle and the brake are never substituted for it.
    expect(modelFor(snapshot({ clutch: undefined, throttle: 0.9, brake: 0.5 })).clutch.value).toBe('--')
  })

  it('greys the clutch on its last known reading once the sensor falls silent', () => {
    const value = snapshot()
    const stale = modelFor(value, RC20_CHANNEL_STALE_MS.clutch + 50, {}, 0)
    expect(stale.clutch.stale).toBe(true)
    expect(stale.clutch.value).toBe('42')
    expect(stale.clutchPct).toBeNull()
    expect(stale.clutchFraction).toBeNull()
  })

  it('freezes RPM on its last value and greys it past the packet 200 ms budget', () => {
    const fresh = modelFor(snapshot())
    expect(fresh.rpm.value).toBe('4,820')
    expect(fresh.rpm.stale).toBe(false)
    const stale = modelFor(snapshot(), 260, {}, 0)
    expect(stale.rpm.stale).toBe(true)
    expect(stale.rpm.value).toBe('4,820')
    expect(stale.rpm.tone).toBe('muted')
  })

  it('never mirrors one tyre corner onto another', () => {
    const model = modelFor(snapshot())
    const byCorner = Object.fromEntries(model.tyres.map((cell) => [cell.location, cell.field.value]))
    expect(byCorner.LF).toBe('88')
    expect(byCorner.RF).toBe('86')
    expect(byCorner.LR).toBe('84')
    expect(byCorner.RR).toBe('--')
    expect(model.tyres.find((cell) => cell.location === 'RR')!.field.unavailable).toBe(true)
  })

  it('publishes a brake axle only when BOTH of its corners are present and fresh', () => {
    expect(rc20AxleTempC(470, 460)).toBe(465)
    expect(rc20AxleTempC(470, null)).toBeNull()
    expect(rc20AxleTempC(null, 460)).toBeNull()

    const both = modelFor(snapshot())
    const axles = Object.fromEntries(both.brakeAxles.map((cell) => [cell.location, cell.field.value]))
    expect(axles.FRT).toBe('465')
    expect(axles.REAR).toBe('410')

    // One front corner drops out: the axle dashes rather than mirroring the surviving corner.
    const halfFront = modelFor(snapshot({ brakeTempC: { lf: 470, rf: Number.NaN, lr: 415, rr: 405 } }))
    expect(halfFront.brakeAxles.find((cell) => cell.location === 'FRT')!.field.value).toBe('--')
    expect(halfFront.brakeAxles.find((cell) => cell.location === 'REAR')!.field.value).toBe('410')

    // The whole brake bus falls silent: both axles dash, neither freezes on a stale mean.
    const stale = modelFor(snapshot(), 400, {}, 0)
    for (const cell of stale.brakeAxles) expect(cell.field.value, cell.location).toBe('--')
    expect(RC20_BRAKE_AXLE_CORNERS.FRT).toEqual(['LF', 'RF'])
    expect(RC20_BRAKE_AXLE_CORNERS.REAR).toEqual(['LR', 'RR'])
  })

  it('never assumes a grid slot from the race position (gap G-8)', () => {
    for (const position of [1, 7, 24, undefined]) {
      const model = modelFor(snapshot({ position }))
      expect(model.gridSlot.value).toBe('--')
      expect(model.gridSlot.unavailable).toBe(true)
    }
    expect(markup(snapshot({ position: 7 }), nativeConfig)).not.toContain('SLOT 7')
  })

  it('publishes the start status half of the split channel from the real feed', () => {
    expect(modelFor(snapshot()).startStatus.value).toBe(`STAGE 5 OF ${RC20_LADDER_BAR_COUNT}`)
    expect(modelFor(snapshot({ sessionFlagsRaw: 0 })).startStatus.value).toBe('--')
  })

  it('hides the launch target band until an operator declares one, and never fabricates it', () => {
    const hidden = modelFor(snapshot())
    expect(hidden.band).toBeNull()
    expect(hidden.bandModel.source).toBe('none')
    expect(hidden.bandModel.label).toBe('BAND --')
    expect(hidden.bandModel.lowFraction).toBeNull()
    expect(hidden.bandModel.highFraction).toBeNull()

    const declared = modelFor(snapshot(), 0, { control: control({ band: { minRpm: 4_650, maxRpm: 4_950 } }) })
    expect(declared.bandModel.source).toBe('declared')
    expect(declared.bandModel.label).toBe('BAND 4650-4950')
    // Override NO-4: the edges are computed from the scale, never traced.
    expect(declared.bandModel.lowFraction).toBeCloseTo(4_650 / 7_600, 6)
    expect(declared.bandModel.highFraction).toBeCloseTo(4_950 / 7_600, 6)
  })

  it('declares the launch track scale on screen and drops the needle without a real full scale', () => {
    const scaled = modelFor(snapshot())
    expect(scaled.scaleMaxRpm).toBe(7_600)
    expect(scaled.scaleLabel).toBe('SCALE 0-7600')
    expect(scaled.rpmFraction).toBeCloseTo(4_820 / 7_600, 6)

    const unscaled = modelFor(snapshot({ maxRpm: undefined }))
    expect(unscaled.scaleMaxRpm).toBeNull()
    expect(unscaled.scaleLabel).toBe('SCALE --')
    expect(unscaled.rpmFraction).toBeNull()
    // The numeral survives: only the geometry the scale would have supported is withheld.
    expect(unscaled.rpm.value).toBe('4,820')
  })

  it('computes every fill arithmetically and clamps it to its own track (override NO-4)', () => {
    expect(rc20ScaleFraction(4_820, 0, 7_600)).toBeCloseTo(0.634_21, 5)
    expect(rc20ScaleFraction(42, 0, 100)).toBeCloseTo(0.42, 6)
    expect(rc20ScaleFraction(-5, 0, 100)).toBe(0)
    expect(rc20ScaleFraction(140, 0, 100)).toBe(1)
    expect(rc20ScaleFraction(null, 0, 100)).toBeNull()
    expect(rc20ScaleFraction(50, 100, 100)).toBeNull()

    const model = modelFor(snapshot())
    // The bar level agrees with the numeral beside it, which six reference attempts never did.
    expect(model.clutchFraction! * 100).toBeCloseTo(Number(model.clutch.value), 6)
    expect(model.clutchScaleLabel).toBe('SCALE 0-100')
  })

  it('renders a dash-only frame with no telemetry at all', () => {
    const model = modelFor(null)
    expect(model.mode).toBeNull()
    expect(model.modeLabel).toBe(RC20_MODE_UNAVAILABLE)
    expect(model.armed).toBe(false)
    expect(model.stage).toBeNull()
    expect(model.ladder.litBars).toBe(0)
    expect(model.ladder.feedLabel).toBe(RC20_START_FEED_UNAVAILABLE)
    expect(model.clutch.value).toBe('--')
    expect(model.gridSlot.value).toBe('--')
    expect(model.band).toBeNull()
    for (const cell of [...model.tyres, ...model.brakeAxles]) expect(cell.field.value, cell.location).toBe('--')
    expect(rc20AlertLines(model)).toEqual([])
    assertClean(markup(null))
    assertClean(markup(null, nativeConfig))
  })
})

// ─────────────────────────────────────────────────────────── alerts

describe('RC-20 packet 15 alerts are trigger-only', () => {
  it('starts silent, with every alert armed and none latched', () => {
    const state = createRc20AlertState()
    expect(state.launchOverRev.active).toBe(false)
    expect(state.jumpStart.active).toBe(false)
    expect(state.coldWarmup.active).toBe(false)
    expect(rc20AlertLines(modelFor(snapshot()))).toEqual([])
  })

  it('over-rev: engages only after the packet 60 ms debounce', () => {
    let state = createRc20AlertState()
    state = advanceRc20Alerts(state, alertInput({ nowMs: 0, overBandCeiling: true }))
    expect(state.launchOverRev.active).toBe(false)
    state = advanceRc20Alerts(state, alertInput({ nowMs: RC20_OVER_REV_ENGAGE_MS - 1, overBandCeiling: true }))
    expect(state.launchOverRev.active).toBe(false)
    state = advanceRc20Alerts(state, alertInput({ nowMs: RC20_OVER_REV_ENGAGE_MS, overBandCeiling: true }))
    expect(state.launchOverRev.active).toBe(true)
  })

  it('over-rev: holds through the packet 250 ms hysteresis before it clears', () => {
    let state = createRc20AlertState()
    state = advanceRc20Alerts(state, alertInput({ nowMs: 0, overBandCeiling: true }))
    state = advanceRc20Alerts(state, alertInput({ nowMs: RC20_OVER_REV_ENGAGE_MS, overBandCeiling: true }))
    expect(state.launchOverRev.active).toBe(true)

    const backInBand = RC20_OVER_REV_ENGAGE_MS + 10
    state = advanceRc20Alerts(state, alertInput({ nowMs: backInBand }))
    expect(state.launchOverRev.active).toBe(true)
    state = advanceRc20Alerts(state, alertInput({ nowMs: backInBand + RC20_OVER_REV_HYSTERESIS_MS - 1 }))
    expect(state.launchOverRev.active).toBe(true)
    state = advanceRc20Alerts(state, alertInput({ nowMs: backInBand + RC20_OVER_REV_HYSTERESIS_MS }))
    expect(state.launchOverRev.active).toBe(false)
  })

  it('over-rev: unlatches the instant it stops being measurable or the cues disarm', () => {
    let engaged = createRc20AlertState()
    engaged = advanceRc20Alerts(engaged, alertInput({ nowMs: 0, overBandCeiling: true }))
    engaged = advanceRc20Alerts(engaged, alertInput({ nowMs: RC20_OVER_REV_ENGAGE_MS, overBandCeiling: true }))
    expect(engaged.launchOverRev.active).toBe(true)

    // No declared band or no fresh RPM: the ceiling no longer exists, so nothing may hold on it.
    expect(
      advanceRc20Alerts(engaged, alertInput({ nowMs: 1_000, overBandCeiling: true, overRevMeasurable: false }))
        .launchOverRev.active
    ).toBe(false)
    // FORMATION never arms a launch cue.
    expect(
      advanceRc20Alerts(engaged, alertInput({ nowMs: 1_000, overBandCeiling: true, armed: false })).launchOverRev.active
    ).toBe(false)
  })

  it('over-rev: fires from a real declared ceiling and a real RPM, end to end', () => {
    const band = { minRpm: 4_650, maxRpm: 4_950 }
    const over = modelFor(snapshot({ rpm: 5_240 }), 0, { control: control({ band }) })
    const input = rc20AlertInputForModel(over, 0)
    expect(input.overBandCeiling).toBe(true)
    expect(input.overRevMeasurable).toBe(true)
    expect(input.armed).toBe(true)

    // The approved reference frame sits INSIDE the band, so it cannot fire.
    const inside = modelFor(snapshot(), 0, { control: control({ band }) })
    expect(rc20AlertInputForModel(inside, 0).overBandCeiling).toBe(false)
  })

  it('jump-start: engages only after 80 ms of movement before the release stage', () => {
    let state = createRc20AlertState()
    state = advanceRc20Alerts(state, alertInput({ nowMs: 0, movingBeforeRelease: true }))
    expect(state.jumpStart.active).toBe(false)
    state = advanceRc20Alerts(state, alertInput({ nowMs: RC20_JUMP_START_ENGAGE_MS - 1, movingBeforeRelease: true }))
    expect(state.jumpStart.active).toBe(false)
    state = advanceRc20Alerts(state, alertInput({ nowMs: RC20_JUMP_START_ENGAGE_MS, movingBeforeRelease: true }))
    expect(state.jumpStart.active).toBe(true)
  })

  it('jump-start: clears the moment the release stage is reached', () => {
    let state = createRc20AlertState()
    state = advanceRc20Alerts(state, alertInput({ nowMs: 0, movingBeforeRelease: true }))
    state = advanceRc20Alerts(state, alertInput({ nowMs: RC20_JUMP_START_ENGAGE_MS, movingBeforeRelease: true }))
    expect(state.jumpStart.active).toBe(true)
    state = advanceRc20Alerts(state, alertInput({ nowMs: 500, released: true, movingBeforeRelease: false }))
    expect(state.jumpStart.active).toBe(false)
  })

  it('jump-start: hides entirely when there is no start-light feed', () => {
    let state = createRc20AlertState()
    state = advanceRc20Alerts(state, alertInput({ nowMs: 0, movingBeforeRelease: true }))
    state = advanceRc20Alerts(state, alertInput({ nowMs: RC20_JUMP_START_ENGAGE_MS, movingBeforeRelease: true }))
    expect(state.jumpStart.active).toBe(true)
    // Packet 15: hidden if the start-light feed is absent; never simulate a start signal.
    state = advanceRc20Alerts(state, alertInput({ nowMs: 400, movingBeforeRelease: true, startFeedPresent: false }))
    expect(state.jumpStart.active).toBe(false)
  })

  it('jump-start: measures movement from a real speed against a real stage', () => {
    const rolling = modelFor(snapshot({ speedKmh: 4 }))
    const input = rc20AlertInputForModel(rolling, 0)
    expect(input.movingBeforeRelease).toBe(true)
    expect(input.startFeedPresent).toBe(true)
    expect(input.released).toBe(false)

    // The approved frame is stationary in the grid slot, so the trigger is false.
    expect(rc20AlertInputForModel(modelFor(snapshot()), 0).movingBeforeRelease).toBe(false)
    // Below the declared movement threshold nothing engages.
    expect(
      rc20AlertInputForModel(modelFor(snapshot({ speedKmh: RC20_JUMP_START_SPEED_KMH / 2 })), 0).movingBeforeRelease
    ).toBe(false)
    // After the release the trigger is structurally impossible.
    const released = modelFor(snapshot({ speedKmh: 40, sessionFlagsRaw: RC20_IRACING_START_BITS.startGo }))
    expect(rc20AlertInputForModel(released, 0).movingBeforeRelease).toBe(false)
    expect(rc20AlertInputForModel(released, 0).released).toBe(true)
  })

  it('cold warm-up: runs a 3 s debounce per location and never marks a neighbour', () => {
    let state = createRc20AlertState()
    state = advanceRc20Alerts(state, alertInput({ nowMs: 0, formation: true, coldLocations: ['LF'] }))
    expect(state.coldWarmup.active).toBe(false)
    state = advanceRc20Alerts(
      state,
      alertInput({ nowMs: RC20_COLD_WARMUP_ENGAGE_MS - 1, formation: true, coldLocations: ['LF'] })
    )
    expect(state.coldWarmup.active).toBe(false)
    state = advanceRc20Alerts(
      state,
      alertInput({ nowMs: RC20_COLD_WARMUP_ENGAGE_MS, formation: true, coldLocations: ['LF', 'RF'] })
    )
    // RF only just started its own debounce, so it is not latched with LF.
    expect(state.coldWarmup.active).toBe(true)
    expect(state.coldWarmup.locations).toEqual(['LF'])
  })

  it('cold warm-up: clears when the location reaches its declared target', () => {
    let state = createRc20AlertState()
    state = advanceRc20Alerts(state, alertInput({ nowMs: 0, formation: true, coldLocations: ['FRT'] }))
    state = advanceRc20Alerts(
      state,
      alertInput({ nowMs: RC20_COLD_WARMUP_ENGAGE_MS, formation: true, coldLocations: ['FRT'] })
    )
    expect(state.coldWarmup.active).toBe(true)
    state = advanceRc20Alerts(state, alertInput({ nowMs: RC20_COLD_WARMUP_ENGAGE_MS + 10, formation: true }))
    expect(state.coldWarmup.active).toBe(false)
    expect(state.coldWarmup.locations).toEqual([])
  })

  it('cold warm-up: is gated on FORMATION, which is why the approved GRID frame is silent', () => {
    let state = createRc20AlertState()
    state = advanceRc20Alerts(state, alertInput({ nowMs: 0, formation: true, coldLocations: ['LR'] }))
    state = advanceRc20Alerts(
      state,
      alertInput({ nowMs: RC20_COLD_WARMUP_ENGAGE_MS, formation: true, coldLocations: ['LR'] })
    )
    expect(state.coldWarmup.active).toBe(true)
    state = advanceRc20Alerts(
      state,
      alertInput({ nowMs: RC20_COLD_WARMUP_ENGAGE_MS + 10, formation: false, coldLocations: ['LR'] })
    )
    expect(state.coldWarmup.active).toBe(false)
  })

  it('cold warm-up: measures cold locations against the declared targets only', () => {
    const warm = modelFor(formationSnapshot())
    // 88/86/84 are above the declared 80; RR has no sensor and can never be cold.
    expect(warm.coldLocations).not.toContain('LF')
    expect(warm.coldLocations).not.toContain('RR')
    // 465/410 are above the declared 350.
    expect(warm.coldLocations).not.toContain('FRT')

    const cold = modelFor(
      formationSnapshot({
        tyres: { lf: { tempC: 41 }, rf: { tempC: 86 }, lr: { tempC: 84 }, rr: {} },
        brakeTempC: { lf: 120, rf: 130, lr: 415, rr: 405 }
      })
    )
    expect(cold.coldLocations).toContain('LF')
    expect(cold.coldLocations).toContain('FRT')
    expect(cold.coldLocations).not.toContain('RF')
    expect(cold.coldLocations).not.toContain('RR')
    expect(cold.coldLocations).not.toContain('REAR')
    expect(RC20_WARMUP_TARGET_C.tyreC).toBe(80)
    expect(RC20_WARMUP_TARGET_C.brakeC).toBe(350)
    expect(RC20_WARMUP_LOCATIONS).toEqual([...RC20_CORNERS, ...RC20_BRAKE_AXLES])
  })

  it('unlatches every alert whose model input has gone missing, stale or out of sequence', () => {
    let state = createRc20AlertState()
    state = advanceRc20Alerts(state, alertInput({ nowMs: 0, overBandCeiling: true, movingBeforeRelease: true }))
    state = advanceRc20Alerts(
      state,
      alertInput({ nowMs: RC20_OVER_REV_ENGAGE_MS + RC20_JUMP_START_ENGAGE_MS, overBandCeiling: true, movingBeforeRelease: true })
    )
    expect(state.launchOverRev.active).toBe(true)
    expect(state.jumpStart.active).toBe(true)

    // No declared band, and a stale start feed, in a frame with no mode at all.
    const invalid = modelFor(snapshot({ sessionFlagsRaw: 0, sessionState: undefined }))
    const cleared = clearInvalidRc20Alerts(state, invalid)
    expect(cleared.launchOverRev.active).toBe(false)
    expect(cleared.jumpStart.active).toBe(false)
    expect(cleared.coldWarmup.active).toBe(false)
  })

  it('names every latched alert on a single line list', () => {
    const model = modelFor(snapshot())
    expect(rc20AlertLines({ ...model, alerts: { launchOverRev: true, jumpStart: true, coldWarmup: true } })).toEqual([
      'LAUNCH OVER-REV',
      'JUMP START',
      'COLD WARM-UP'
    ])
  })
})

// ─────────────────────────────────────────────────────────── measured launch review

describe('RC-20 measured launch review', () => {
  it('records a reaction only when the mount saw the frame before the release', () => {
    const buffer = new Rc20LaunchReviewBuffer()
    buffer.observe({ nowMs: 0, released: false, speedKmh: 0, rpm: 4_820, clutchPct: 42 })
    buffer.observe({ nowMs: 100, released: true, speedKmh: 0, rpm: 4_760, clutchPct: 38 })
    expect(buffer.review().releaseObserved).toBe(true)
    expect(buffer.review().releaseRpm).toBe(4_760)
    expect(buffer.review().releaseClutchPct).toBe(38)
    expect(buffer.review().reactionMs).toBeNull()

    buffer.observe({ nowMs: 340, released: true, speedKmh: 6, rpm: 5_100, clutchPct: 12 })
    expect(buffer.review().reactionMs).toBe(240)
  })

  it('records nothing at all when the display mounts after the release', () => {
    const buffer = new Rc20LaunchReviewBuffer()
    buffer.observe({ nowMs: 0, released: true, speedKmh: 40, rpm: 6_100, clutchPct: 0 })
    buffer.observe({ nowMs: 200, released: true, speedKmh: 80, rpm: 6_800, clutchPct: 0 })
    const review = buffer.review()
    expect(review.releaseObserved).toBe(false)
    expect(review.reactionMs).toBeNull()
    expect(review.releaseRpm).toBeNull()
  })

  it('holds the first movement and never re-writes the reaction', () => {
    const buffer = new Rc20LaunchReviewBuffer()
    buffer.observe({ nowMs: 0, released: false, speedKmh: 0, rpm: 4_800, clutchPct: 44 })
    buffer.observe({ nowMs: 50, released: true, speedKmh: 0, rpm: 4_800, clutchPct: 44 })
    buffer.observe({ nowMs: 300, released: true, speedKmh: 12, rpm: 5_000, clutchPct: 8 })
    buffer.observe({ nowMs: 900, released: true, speedKmh: 60, rpm: 6_200, clutchPct: 0 })
    expect(buffer.review().reactionMs).toBe(250)
  })

  it('refuses a movement below the threshold, a negative elapsed time and an absurd delay', () => {
    const late = new Rc20LaunchReviewBuffer()
    late.observe({ nowMs: 0, released: false, speedKmh: 0, rpm: 4_800, clutchPct: 44 })
    late.observe({ nowMs: 10, released: true, speedKmh: 0, rpm: 4_800, clutchPct: 44 })
    late.observe({ nowMs: 20, released: true, speedKmh: RC20_JUMP_START_SPEED_KMH / 2, rpm: 4_800, clutchPct: 44 })
    expect(late.review().reactionMs).toBeNull()
    late.observe({
      nowMs: 20 + RC20_LAUNCH_REVIEW_MAX_REACTION_MS + 1_000,
      released: true,
      speedKmh: 40,
      rpm: 6_000,
      clutchPct: 0
    })
    expect(late.review().reactionMs).toBeNull()
  })

  it('clones without sharing state and resets to a clean sheet', () => {
    const buffer = new Rc20LaunchReviewBuffer()
    buffer.observe({ nowMs: 0, released: false, speedKmh: 0, rpm: 4_800, clutchPct: 44 })
    buffer.observe({ nowMs: 10, released: true, speedKmh: 0, rpm: 4_800, clutchPct: 44 })
    const clone = buffer.clone()
    clone.observe({ nowMs: 300, released: true, speedKmh: 20, rpm: 5_200, clutchPct: 0 })
    expect(clone.review().reactionMs).toBe(290)
    expect(buffer.review().reactionMs).toBeNull()
    clone.reset()
    expect(clone.review()).toEqual({
      reactionMs: null,
      releaseRpm: null,
      releaseClutchPct: null,
      releaseObserved: false
    })
  })

  it('dashes every review field until a release has genuinely been observed', () => {
    const model = modelFor(snapshot())
    expect(model.reviewFields.reaction.value).toBe('--.---')
    expect(model.reviewFields.rpm.value).toBe('---')
    expect(model.reviewFields.clutch.value).toBe('--')

    const observed = modelFor(snapshot(), 0, {
      review: { reactionMs: 312, releaseRpm: 4_780, releaseClutchPct: 36, releaseObserved: true }
    })
    expect(observed.reviewFields.reaction.value).toBe('0.312')
    expect(observed.reviewFields.rpm.value).toBe('4,780')
    expect(observed.reviewFields.clutch.value).toBe('36')
  })
})

// ─────────────────────────────────────────────────────────── zones

describe('RC-20 packet zone geometry', () => {
  it('reproduces packet 11.1 exactly, with override NO-6 as the only deviation', () => {
    expect(RC20_NATIVE_ZONES.header).toEqual({ left: 2, top: 2.5, width: 96, height: 5 })
    expect(RC20_NATIVE_ZONES.launch).toEqual({ left: 5, top: 16.667, width: 27.5, height: 41.667 })
    expect(RC20_NATIVE_ZONES.clutch).toEqual({ left: 67.5, top: 16.667, width: 27.5, height: 41.667 })
    expect(RC20_NATIVE_ZONES.strip).toEqual({ left: 2, top: 73.333, width: 96, height: 12.5 })
    // Override NO-6: y 48 rather than the packet's y 40; the foot stays on the packet's y 340.
    expect(RC20_NATIVE_ZONES.ladder!.left).toBe(37.5)
    expect(RC20_NATIVE_ZONES.ladder!.width).toBe(25)
    expect(RC20_NATIVE_ZONES.ladder!.top * RC20_NATIVE_HEIGHT_PX / 100).toBeCloseTo(48, 2)
    expect(bottom(RC20_NATIVE_ZONES.ladder!) * RC20_NATIVE_HEIGHT_PX / 100).toBeCloseTo(340, 2)
  })

  it('leaves at least a 12 px gutter around the ladder at 800x480 (override NO-6)', () => {
    const px = (value: number): number => (value * RC20_NATIVE_HEIGHT_PX) / 100
    const headerGutter = px(RC20_NATIVE_ZONES.ladder!.top) - px(bottom(RC20_NATIVE_ZONES.header!))
    const stripGutter = px(RC20_NATIVE_ZONES.strip!.top) - px(bottom(RC20_NATIVE_ZONES.ladder!))
    expect(headerGutter).toBeGreaterThanOrEqual(12)
    expect(stripGutter).toBeGreaterThanOrEqual(12)
  })

  it('reproduces packet 12.1 exactly and adds the gap G-3 mode ribbon', () => {
    expect(RC20_APP_ZONES.ladder).toEqual({ left: 40.234, top: 8, width: 19.531, height: 60 })
    expect(RC20_APP_ZONES.launch).toEqual({ left: 4.688, top: 13.333, width: 29.297, height: 50 })
    expect(RC20_APP_ZONES.clutch).toEqual({ left: 66.016, top: 13.333, width: 29.297, height: 50 })
    expect(RC20_APP_ZONES.warmup).toEqual({ left: 4.688, top: 70, width: 58.594, height: 25 })
    expect(RC20_APP_ZONES.review).toEqual({ left: 66.016, top: 70, width: 29.297, height: 25 })
    // Gap G-3: packet 12.1 has no mode indicator and no slot/status field at all.
    expect(RC20_APP_ZONES.header).toBeDefined()
    const gutter =
      ((RC20_APP_ZONES.ladder!.top - bottom(RC20_APP_ZONES.header!)) * RC20_APP_HEIGHT_PX) / 100
    expect(gutter).toBeGreaterThanOrEqual(12)
  })

  it('never overlaps a zone with a neighbour on any canvas (override NO-3)', () => {
    for (const [layout, zones] of [
      ['native', RC20_NATIVE_ZONES],
      ['app', RC20_APP_ZONES],
      ['compact-standard', rc20ZonesForLayout('compact', 'standard')],
      ['compact-landscape', rc20ZonesForLayout('compact', 'landscape')],
      ['compact-phone', rc20ZonesForLayout('compact', 'phone')]
    ] as const) {
      const list = zoneList(zones)
      for (let a = 0; a < list.length; a += 1) {
        for (let b = a + 1; b < list.length; b += 1) {
          expect(
            rc20RectsOverlap(list[a][1], list[b][1]),
            `${layout}: ${list[a][0]} overlaps ${list[b][0]}`
          ).toBe(false)
        }
      }
    }
  })

  it('keeps every zone inside the canvas on every layout', () => {
    for (const [layout, zones] of [
      ['native', RC20_NATIVE_ZONES],
      ['app', RC20_APP_ZONES],
      ['compact-standard', rc20ZonesForLayout('compact', 'standard')],
      ['compact-landscape', rc20ZonesForLayout('compact', 'landscape')],
      ['compact-phone', rc20ZonesForLayout('compact', 'phone')]
    ] as const) {
      for (const [name, rect] of zoneList(zones)) {
        expect(rect.left, `${layout} ${name}`).toBeGreaterThanOrEqual(0)
        expect(rect.top, `${layout} ${name}`).toBeGreaterThanOrEqual(0)
        expect(right(rect), `${layout} ${name}`).toBeLessThanOrEqual(100)
        expect(bottom(rect), `${layout} ${name}`).toBeLessThanOrEqual(100)
      }
    }
  })

  it('keeps the ladder centred and tallest, which is how gap G-9 restates dominance', () => {
    for (const [layout, zones] of [
      ['native', RC20_NATIVE_ZONES],
      ['app', RC20_APP_ZONES],
      ['compact-standard', rc20ZonesForLayout('compact', 'standard')],
      ['compact-landscape', rc20ZonesForLayout('compact', 'landscape')]
    ] as const) {
      expect(rc20RectCentreX(zones.ladder!), `${layout} ladder centre`).toBeCloseTo(50, 1)
      expect(zones.ladder!.height, `${layout} ladder height`).toBeGreaterThan(zones.launch!.height)
      expect(zones.ladder!.height, `${layout} ladder height`).toBeGreaterThan(zones.clutch!.height)
    }
  })

  it('mirrors the launch and clutch cards exactly about x 50 %', () => {
    for (const zones of [RC20_NATIVE_ZONES, RC20_APP_ZONES, rc20ZonesForLayout('compact', 'standard')]) {
      expect(zones.launch!.width).toBeCloseTo(zones.clutch!.width, 3)
      expect(zones.launch!.top).toBeCloseTo(zones.clutch!.top, 3)
      expect(zones.launch!.height).toBeCloseTo(zones.clutch!.height, 3)
      expect(100 - right(zones.clutch!)).toBeCloseTo(zones.launch!.left, 2)
    }
  })

  it('keeps the two app-only modules off every other canvas', () => {
    expect(RC20_NATIVE_ZONES.warmup).toBeUndefined()
    expect(RC20_NATIVE_ZONES.review).toBeUndefined()
    for (const mode of ['standard', 'landscape', 'phone'] as const) {
      expect(rc20ZonesForLayout('compact', mode).warmup, mode).toBeUndefined()
      expect(rc20ZonesForLayout('compact', mode).review, mode).toBeUndefined()
    }
    // The grid strip is the app canvas's only omission; the ribbon carries its slot and status.
    expect(RC20_APP_ZONES.strip).toBeUndefined()
  })

  it('emits inline percentages the DOM can carry without float noise', () => {
    expect(rc20ZoneStyle(undefined)).toBeNull()
    expect(rc20ZoneStyle(RC20_NATIVE_ZONES.launch)).toEqual({
      left: '5%',
      top: '16.667%',
      width: '27.5%',
      height: '41.667%'
    })
    expect(rc20Percent(1 / 3)).toBe('0.333%')
    expect(rc20Percent(Number.NaN)).toBe('0%')
  })

  it('resolves the layout and compact mode from the measured content box', () => {
    expect(rc20LayoutForContentBox(RC20_NATIVE_WIDTH_PX, RC20_NATIVE_HEIGHT_PX)).toBe('native')
    expect(rc20LayoutForContentBox(RC20_NATIVE_WIDTH_PX + 1, RC20_NATIVE_HEIGHT_PX - 1)).toBe('native')
    expect(rc20LayoutForContentBox(RC20_APP_WIDTH_PX, RC20_APP_HEIGHT_PX)).toBe('app')
    expect(rc20LayoutForContentBox(1_600, 900)).toBe('app')
    expect(rc20LayoutForContentBox(640, 400)).toBe('compact')
    expect(rc20LayoutForContentBox(0, 0)).toBe('app')

    expect(rc20CompactModeForContentBox(400, 740)).toBe('phone')
    expect(rc20CompactModeForContentBox(800, 420)).toBe('landscape')
    expect(rc20CompactModeForContentBox(640, 520)).toBe('standard')
    expect(rc20CompactModeForContentBox(RC20_APP_WIDTH_PX, RC20_APP_HEIGHT_PX)).toBe('standard')
  })
})

// ─────────────────────────────────────────────────────────── type scale

describe('RC-20 packet 11.2 type ladder', () => {
  it('is four steps, strictly descending, with no tie', () => {
    const steps = [RC20_TYPE_SCALE_PX.rpm, RC20_TYPE_SCALE_PX.clutch, RC20_TYPE_SCALE_PX.strip, RC20_TYPE_SCALE_PX.label]
    expect(steps).toEqual([64, 44, 30, 17])
    for (let index = 1; index < steps.length; index += 1) {
      expect(steps[index], `step ${index}`).toBeLessThan(steps[index - 1])
    }
  })

  it('holds at least the 8 % separation the re-adjudication set between adjacent steps', () => {
    const separations = rc20TypeScaleSeparationsPct()
    expect(separations).toHaveLength(3)
    for (const separation of separations) {
      expect(separation).toBeGreaterThanOrEqual(RC20_TYPE_SCALE_MIN_SEPARATION_PCT)
    }
  })

  it('converts the packet pixels into the container units the stylesheet uses', () => {
    expect(RC20_CQW_PX).toBe(8)
    expect(rc20TypeScaleCqw(RC20_TYPE_SCALE_PX.rpm)).toBe(8)
    expect(rc20TypeScaleCqw(RC20_TYPE_SCALE_PX.clutch)).toBe(5.5)
    expect(rc20TypeScaleCqw(RC20_TYPE_SCALE_PX.strip)).toBe(3.75)
    expect(rc20TypeScaleCqw(RC20_TYPE_SCALE_PX.label)).toBe(2.125)
  })

  it('publishes the ladder to the DOM as custom properties, never as hard-coded CSS', () => {
    const container = view(snapshot(), nativeConfig)
    const style = root(container).getAttribute('style') ?? ''
    expect(style).toContain('--rc20-type-rpm: 8cqw')
    expect(style).toContain('--rc20-type-clutch: 5.5cqw')
    expect(style).toContain('--rc20-type-strip: 3.75cqw')
    expect(style).toContain('--rc20-type-label: 2.125cqw')
  })
})

// ─────────────────────────────────────────────────────────── rendered DOM contract

describe('RC-20 rendered DOM contract', () => {
  it('renders exactly five ladder bars in every layout — a counting structure', () => {
    for (const [name, cfg] of [
      ['native', nativeConfig],
      ['app', config],
      ['phone', phoneConfig],
      ['landscape', landscapeConfig]
    ] as const) {
      const container = view(snapshot(), cfg)
      const bars = container.querySelectorAll('[data-testid="rc20-ladder-bar"]')
      expect(bars.length, `${name} bar count`).toBe(RC20_LADDER_BAR_COUNT)
      expect(
        container.querySelector('[data-testid="rc20-ladder-bars"]')?.getAttribute('data-rc20-bar-count'),
        `${name} declared bar count`
      ).toBe(String(RC20_LADDER_BAR_COUNT))
      cleanup()
    }
  })

  it('lights exactly as many bars as the stage reports, and never one more', () => {
    for (const [flags, expected] of [
      [RC20_IRACING_START_BITS.startSet, RC20_LADDER_BAR_COUNT],
      [RC20_IRACING_START_BITS.startReady, 0],
      [RC20_IRACING_START_BITS.startHidden, 0],
      [RC20_IRACING_START_BITS.startGo, 0],
      [0, 0]
    ] as const) {
      const container = view(snapshot({ sessionFlagsRaw: flags }), nativeConfig)
      const lit = container.querySelectorAll('[data-testid="rc20-ladder-bar"][data-rc20-lit="true"]')
      expect(lit.length, `flags ${flags}`).toBe(expected)
      expect(root(container).dataset.rc20LitBars, `flags ${flags}`).toBe(String(expected))
      cleanup()
    }
  })

  it('keeps the ladder dark and says so when no start-system feed exists', () => {
    // Every non-iRacing sim, and iRacing with no start bits, is the packet's "feed absent".
    for (const value of [snapshot({ sim: 'acc' }), snapshot({ sessionFlagsRaw: 0 }), null]) {
      const container = view(value, nativeConfig)
      expect(container.querySelectorAll('[data-testid="rc20-ladder-bar"][data-rc20-lit="true"]').length).toBe(0)
      expect(text(container, 'rc20-start-feed')).toBe(RC20_START_FEED_UNAVAILABLE)
      expect(text(container, 'rc20-stage')).toBe(RC20_STAGE_UNAVAILABLE)
      cleanup()
    }
  })

  it('labels the ladder a generic training aid on every frame and every canvas', () => {
    for (const cfg of [nativeConfig, config, phoneConfig, landscapeConfig]) {
      const container = view(snapshot(), cfg)
      expect(text(container, 'rc20-ladder-caption')).toBe(RC20_LADDER_DISCLAIMER)
      cleanup()
    }
    // Packet 8/18: it must never claim to be an official start signal.
    const html = markup(snapshot(), nativeConfig).toLowerCase()
    expect(html).not.toContain('official')
    expect(html).not.toContain('race director')
  })

  it('renders exactly eight grid-strip cells (override NO-7)', () => {
    for (const cfg of [nativeConfig, phoneConfig, landscapeConfig]) {
      const container = view(snapshot(), cfg)
      const cells = container.querySelectorAll('[data-rc20-zone="strip"] [data-testid="rc20-strip-cell"]')
      expect(cells.length).toBe(RC20_GRID_STRIP_CELL_COUNT)
      expect(RC20_GRID_STRIP_CELLS).toHaveLength(8)
      cleanup()
    }
  })

  it('carries the packet 19 mode words, always three, with the live one bracketed', () => {
    const container = view(snapshot(), nativeConfig)
    const words = container.querySelectorAll('[data-testid="rc20-mode-word"]')
    expect(words.length).toBe(RC20_MODES.length)
    expect(Array.from(words).map((word) => word.getAttribute('data-rc20-mode-word'))).toEqual([...RC20_MODES])
    expect(text(container, 'rc20-mode')).toBe('GRID')
    expect(container.querySelector('[data-rc20-mode-word="GRID"]')?.textContent).toBe('[ GRID ]')
    expect(container.querySelector('[data-rc20-mode-word="LAUNCH"]')?.textContent).toBe('LAUNCH')
  })

  it('reflows the 1024x600 canvas into new modules rather than scaling the 800x480 one', () => {
    const app = view(snapshot(), config)
    expect(app.querySelector('[data-rc20-zone="warmup"]')).not.toBeNull()
    expect(app.querySelector('[data-rc20-zone="review"]')).not.toBeNull()
    expect(app.querySelector('[data-rc20-zone="strip"]')).toBeNull()
    // Gap G-3: the ribbon carries the slot and start status the strip carries at 800x480.
    expect(app.querySelector('[data-testid="rc20-ribbon-status"]')).not.toBeNull()
    // Every brake corner is surfaced individually where there is finally room for it.
    expect(app.querySelectorAll('[data-testid="rc20-warmup-tile"]').length).toBe(RC20_CORNERS.length * 2)
    cleanup()

    const native = view(snapshot(), nativeConfig)
    expect(native.querySelector('[data-rc20-zone="warmup"]')).toBeNull()
    expect(native.querySelector('[data-rc20-zone="review"]')).toBeNull()
    expect(native.querySelector('[data-rc20-zone="strip"]')).not.toBeNull()
    expect(native.querySelector('[data-testid="rc20-ribbon-status"]')).toBeNull()
  })

  it('captions the declared warm-up targets with their provenance, never as telemetry', () => {
    const container = view(formationSnapshot(), config)
    const provenance = text(container, 'rc20-warmup-provenance')
    expect(provenance).toContain('DECLARED')
    expect(provenance).toContain(String(RC20_WARMUP_TARGET_C.tyreC))
    expect(provenance).toContain(String(RC20_WARMUP_TARGET_C.brakeC))
  })

  it('stamps the layout, mode, stage and buffer state onto the root for the harness', () => {
    const container = view(snapshot(), nativeConfig)
    const element = root(container)
    expect(element.dataset.rc20Layout).toBe('native')
    expect(element.dataset.rc20Mode).toBe('GRID')
    expect(element.dataset.rc20Armed).toBe('true')
    expect(element.dataset.rc20Stage).toBe('S5')
    expect(element.dataset.rc20StartFeed).toBe('live')
    expect(element.dataset.rc20BandSource).toBe('none')
    expect(element.dataset.rc20BufferState).toBe('accepted')
    expect(element.dataset.rc20ContentWidth).toBe(String(RC20_NATIVE_WIDTH_PX))
    expect(element.dataset.rc20ContentHeight).toBe(String(RC20_NATIVE_HEIGHT_PX))
    cleanup()

    const phone = root(view(snapshot(), phoneConfig))
    expect(phone.dataset.rc20Layout).toBe('compact')
    expect(phone.dataset.rc20CompactMode).toBe('phone')
  })

  it('keeps every alert-layer element out of the DOM while the alert is silent', () => {
    for (const cfg of [nativeConfig, config, phoneConfig, landscapeConfig]) {
      const container = view(snapshot(), cfg)
      expect(root(container).dataset.rc20Alerts).toBe('silent')
      expect(root(container).dataset.rc20AlertKeys).toBe('')
      expect(container.querySelector('[data-testid="rc20-jump-start"]')).toBeNull()
      expect(container.querySelector('[data-testid="rc20-over-rev"]')).toBeNull()
      expect(container.querySelector('[data-testid="rc20-over-rev-cap"]')).toBeNull()
      expect(container.querySelectorAll('[role="alert"]').length).toBe(0)
      expect(container.querySelectorAll('[data-rc20-cold="true"]').length).toBe(0)
      cleanup()
    }
  })

  it('hides the launch band until a band is declared, then draws it from the arithmetic', () => {
    const hidden = view(snapshot(), nativeConfig)
    expect(hidden.querySelector('[data-testid="rc20-launch-band"]')).toBeNull()
    expect(text(hidden, 'rc20-band-label')).toBe('BAND --')
    expect(hidden.querySelector('[data-testid="rc20-launch-needle"]')).not.toBeNull()
    cleanup()

    const declared = render(
      createElement(RaceconRc20DashWidget, { snapshot: snapshot(), config: nativeConfig })
    ).container
    act(() => {
      window.dispatchEvent(
        new CustomEvent(RC20_LAUNCH_CONTROL_EVENT, { detail: { command: 'arm', bandMinRpm: 4_650, bandMaxRpm: 4_950 } })
      )
    })
    const band = declared.querySelector<HTMLElement>('[data-testid="rc20-launch-band"]')
    expect(band).not.toBeNull()
    expect(text(declared, 'rc20-band-label')).toBe('BAND 4650-4950')
    expect(root(declared).dataset.rc20BandSource).toBe('declared')
    // 4650/7600 = 61.184 %, and (4950 - 4650)/7600 = 3.947 % wide.
    expect(band!.style.left).toBe('61.184%')
    expect(band!.style.width).toBe('3.947%')
  })

  it('surfaces the jump-start alert over the ladder once its trigger genuinely fires', () => {
    const alerts = createRc20AlertState()
    alerts.jumpStart = { active: true, pendingSinceMs: null }
    const model = createRc20DashboardModel(
      snapshot({ speedKmh: 5 }),
      createRc01ChannelReceipts(snapshot({ speedKmh: 5 }), 0),
      createRc20AuxReceipts(snapshot({ speedKmh: 5 }), 0),
      0,
      { alerts }
    )
    expect(model.alerts.jumpStart).toBe(true)
    expect(rc20AlertLines(model)).toEqual(['JUMP START'])
  })

  it('renders clean, complete markup at every breakpoint', () => {
    for (const cfg of [nativeConfig, config, phoneConfig, landscapeConfig]) {
      const html = markup(snapshot(), cfg)
      assertClean(html)
      expect(html).toContain('LAUNCH RPM')
      expect(html).toContain('CLUTCH')
      expect(html).toContain(RC20_LADDER_DISCLAIMER)
    }
  })
})

// ─────────────────────────────────────────────────────────── live-only ingest

describe('RC-20 refuses anything that is not live telemetry', () => {
  it('refuses mock telemetry outright', () => {
    const container = view(snapshot({ sim: 'mock' }), nativeConfig)
    expect(root(container).dataset.rc20BufferState).toBe('mock-telemetry')
    expect(text(container, 'rc20-stage')).toBe(RC20_STAGE_UNAVAILABLE)
    expect(text(container, 'rc20-clutch-value')).toBe('--')
  })

  it('refuses replay telemetry, by sim id and by an explicit replay context', () => {
    const bySim = view(snapshot({ sim: 'replay' }), nativeConfig)
    expect(root(bySim).dataset.rc20BufferState).toBe('replay-telemetry')
    cleanup()

    const byContext = view(
      snapshot({
        replayContext: {
          state: 'replay',
          sessionIdentity: 'session-1',
          connectionEpoch: 1,
          token: 'token-1',
          revision: 1
        }
      } as Partial<TelemetrySnapshot>),
      nativeConfig
    )
    expect(root(byContext).dataset.rc20BufferState).toBe('replay-telemetry')
  })

  it('does NOT treat replayPlaying as a refusal trigger — it is a raw provider field', () => {
    const container = view(snapshot({ replayPlaying: true }), nativeConfig)
    expect(root(container).dataset.rc20BufferState).toBe('accepted')
    expect(text(container, 'rc20-stage')).toBe(`STAGE 5 OF ${RC20_LADDER_BAR_COUNT}`)
  })

  it('refuses a snapshot with no live source identity', () => {
    const container = view(snapshot({ sessionUniqueId: undefined, connectionEpoch: undefined }), nativeConfig)
    expect(root(container).dataset.rc20BufferState).toBe('missing-source-identity')
  })

  it('quarantines a source discontinuity and clears the measured review with it', () => {
    const buffer = new Rc01LiveTelemetryBuffer()
    expect(buffer.ingest(snapshot(), 0).accepted).toBe(true)
    const other = buffer.ingest(snapshot({ sessionUniqueId: 404 }, 6_120_100), 100)
    expect(other.accepted).toBe(false)
    expect(other.renderable).toBe(false)
    expect(other.reason).toBe('source-discontinuity')
  })

  it('renders the dash frame when the provider is disconnected', () => {
    const container = view(snapshot({ connected: false }), nativeConfig)
    expect(root(container).dataset.rc20BufferState).toBe('disconnected')
    expect(root(container).dataset.rc20Mode).toBe('unavailable')
    expect(root(container).dataset.rc20Armed).toBe('false')
  })
})

// ─────────────────────────────────────────────────────────── preview clock freeze

/**
 * A dashboard preview is one static snapshot with zero IPC behind it. The shared display clock
 * is what ages a RaceCon frame, and RC-20 is the most clock-sensitive artifact of the family:
 * its start feed goes stale at 1 s, its brake axles at 200 ms and its cold-warm-up debounce runs
 * for 3 s. A ticking clock in an inert preview would walk that one frame across all three
 * thresholds and mutate the rendered text with no new data behind it.
 */
describe('RC-20 inert preview holds a static, coherent frame', () => {
  const PAST_EVERY_THRESHOLD_MS = 30_000

  function mount(preview: 'inert' | undefined): { read: () => string; advance: (ms: number) => void } {
    vi.useFakeTimers()
    let monotonicMs = 0
    const monotonicClock: Rc01MonotonicClock = () => monotonicMs
    const rendered = render(
      createElement(RaceconRc20DashWidget, { snapshot: snapshot(), config, preview, monotonicClock })
    )
    const step = RACECON_DISPLAY_CLOCK_INTERVAL_MS * 5
    const advance = (ms: number): void => {
      for (let elapsed = 0; elapsed < ms; elapsed += step) {
        act(() => {
          monotonicMs += step
          vi.advanceTimersByTime(step)
        })
      }
    }
    return { read: () => rendered.container.textContent ?? '', advance }
  }

  it('uses the shared freeze policy rather than a hand-rolled interval', () => {
    expect(raceconDisplayClockFrozen(undefined)).toBe(false)
    expect(raceconDisplayClockFrozen('inert')).toBe(true)
  })

  it('never advances an inert preview past a single time gate', () => {
    const { read, advance } = mount('inert')
    const mounted = read()
    advance(PAST_EVERY_THRESHOLD_MS)
    expect(read()).toBe(mounted)
  }, 30_000)

  it('renders a coherent, honest frozen frame rather than a half-initialised one', () => {
    const container = render(
      createElement(RaceconRc20DashWidget, { snapshot: snapshot(), config, preview: 'inert' })
    ).container
    // The frozen frame is the approved reference state, complete: an armed GRID with the ladder
    // fully built, the target band honestly hidden and all three alerts silent.
    expect(root(container).dataset.rc20Mode).toBe('GRID')
    expect(root(container).dataset.rc20Stage).toBe('S5')
    expect(root(container).dataset.rc20Alerts).toBe('silent')
    expect(container.querySelectorAll('[data-testid="rc20-ladder-bar"]').length).toBe(RC20_LADDER_BAR_COUNT)
    expect(container.querySelectorAll('[data-testid="rc20-ladder-bar"][data-rc20-lit="true"]').length).toBe(
      RC20_LADDER_BAR_COUNT
    )
    expect(text(container, 'rc20-clutch-value')).toBe('42')
    expect(text(container, 'rc20-rpm')).toBe('4,820')
    assertClean(container.innerHTML)
  })

  it('keeps the live display clock ticking so a real dashboard still ages its frame', () => {
    const { read, advance } = mount(undefined)
    const mounted = read()
    advance(PAST_EVERY_THRESHOLD_MS)
    expect(read()).not.toBe(mounted)
  }, 30_000)
})

import "./harness-stubs"

import { StrictMode, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { BUILTIN_PRESETS, type Dashboard } from "@shared/dashboards"
import type { TelemetrySnapshot } from "@shared/telemetry"
import { DashboardCanvas } from "@renderer/dashboard/DashboardRoot"

const PRESET_ID = "racecon_rc03_dash"
const WIDGET_ID = "raceconRc03Dash"
const FIXTURE_FRAME_MS = 40
const FIXTURE_TIMESTAMP = 20_000
const FIXTURE_SESSION_ID = 88
const FIXTURE_CONNECTION_EPOCH = 4
const FIXTURE_SOURCE_ID = "iracing:session:88:connection:4"

/**
 * The approved RC-03 state, in the exact units the provider reports. image-qa-v2 re-adjudicated
 * attempt-003 against the packet and made the reference telemetry normative, so the harness
 * asserts these values rather than pixels sampled from the reference image.
 */
const REFERENCE_SPEED_KMH = 218
const REFERENCE_RPM = 6_048
const REFERENCE_MAX_RPM = 8_400
const REFERENCE_GEAR = 4
const REFERENCE_DELTA_SEC = -0.112
const REFERENCE_BEST_LAP_SEC = 118.4
const REFERENCE_WATER_C = 92
const REFERENCE_OIL_TEMP_C = 108
const REFERENCE_OIL_PRESSURE_KPA = 460
const REFERENCE_VOLTAGE = 13.4
const REFERENCE_FUEL_L = 41.8
const REFERENCE_FUEL_CAPACITY_L = 110
const REFERENCE_BURN_PER_LAP_L = 3.37

/** The low-pressure scenario: 1.0 bar with the engine well above the 3000 rpm arming gate. */
const ALARM_OIL_PRESSURE_KPA = 100

const PIT_FRAMES = 3
const LAP_FRAMES = 24
const LAP_SAMPLE_STEPS = 25
const SCRIPT_LAPS = 4
const DRIVEN_FRAMES = SCRIPT_LAPS * LAP_FRAMES
const SCRIPT_FRAMES = PIT_FRAMES + DRIVEN_FRAMES
/** Lap distance at the end of the last scripted lap: 24 of 25 samples. */
const PLATEAU_LAP_DIST = LAP_FRAMES / LAP_SAMPLE_STEPS
const PLATEAU_DISTANCE_LAPS = SCRIPT_LAPS - 1 + PLATEAU_LAP_DIST
const FUEL_START_L = REFERENCE_FUEL_L + REFERENCE_BURN_PER_LAP_L * PLATEAU_DISTANCE_LAPS
/**
 * After the scripted laps the fixture crawls the last lap instead of freezing it. A frozen lap
 * distance would let the stint tracker's 1 s feed-quiet window expire and blank the stint clock,
 * and a wrap back to the start of the lap would record a phantom zero-litre burn. Crawling keeps
 * the timing feed alive, keeps the litre readout on its reference value and never crosses
 * start-finish, so the measured plateau is stable for roughly fifteen seconds.
 */
const TAIL_STEP = 0.0001
const TAIL_LIMIT = 0.999
const READY_SEQUENCE = SCRIPT_FRAMES + 12

type CaptureState = "silent" | "oil-alarm"

type CaptureSize =
  | { width: 800; height: 480 }
  | { width: 1024; height: 600 }
  | { width: 393; height: 759 }
  | { width: 412; height: 867 }
  | { width: 759; height: 393 }
  | { width: 867; height: 412 }

function readCaptureSize(): CaptureSize {
  const params = new URLSearchParams(window.location.search)
  const width = Number(params.get("width") ?? "1024")
  const height = Number(params.get("height") ?? "600")
  if (width === 800 && height === 480) return { width, height }
  if (width === 1024 && height === 600) return { width, height }
  if (width === 393 && height === 759) return { width, height }
  if (width === 412 && height === 867) return { width, height }
  if (width === 759 && height === 393) return { width, height }
  if (width === 867 && height === 412) return { width, height }
  throw new Error("racecon RC-03 capture requires 800x480, 1024x600, 393x759, 412x867, 759x393, or 867x412")
}

function readCaptureState(): CaptureState {
  const state = new URLSearchParams(window.location.search).get("state") ?? "silent"
  if (state === "silent" || state === "oil-alarm") return state
  throw new Error("racecon RC-03 capture requires state=silent or state=oil-alarm")
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

interface LapPoint {
  distanceLaps: number
  lapDistPct: number
  currentLapTimeSec: number
  onPitRoad: boolean
}

/**
 * A pit-box release followed by scripted laps at the provider cadence. The stint marker only
 * exists because the fixture actually leaves the pit road, and the burn model only calibrates
 * because whole laps are observed start-finish to start-finish; nothing here is injected past
 * the widget's own measurement path.
 */
function lapPoint(sequence: number): LapPoint {
  if (sequence < PIT_FRAMES) {
    return { distanceLaps: 0, lapDistPct: 0.01, currentLapTimeSec: 0, onPitRoad: true }
  }
  const driven = sequence - PIT_FRAMES
  if (driven < DRIVEN_FRAMES) {
    const lap = Math.floor(driven / LAP_FRAMES)
    const step = (driven % LAP_FRAMES) + 1
    const lapDistPct = step / LAP_SAMPLE_STEPS
    return {
      distanceLaps: lap + lapDistPct,
      lapDistPct,
      currentLapTimeSec: round3(REFERENCE_BEST_LAP_SEC * lapDistPct),
      onPitRoad: false
    }
  }
  const tail = driven - DRIVEN_FRAMES
  const lapDistPct = Math.min(TAIL_LIMIT, PLATEAU_LAP_DIST + tail * TAIL_STEP)
  return {
    distanceLaps: PLATEAU_DISTANCE_LAPS,
    lapDistPct,
    currentLapTimeSec: round3(REFERENCE_BEST_LAP_SEC * lapDistPct),
    onPitRoad: false
  }
}

function fuelLiters(point: LapPoint): number {
  return round3(FUEL_START_L - REFERENCE_BURN_PER_LAP_L * point.distanceLaps)
}

/**
 * A connected, provider-neutral live frame. It carries no mock scenario import and no replay
 * marker, and supplies the source identity fields the shared RC-01 ingest buffer requires
 * (`sessionUniqueId`, `connectionEpoch`, `connected`, a monotonic `timestamp`), so the buffer
 * accepts it as live telemetry.
 */
function liveFixture(sequence: number, state: CaptureState): TelemetrySnapshot {
  const point = lapPoint(sequence)
  const alarmArmed = state === "oil-alarm" && sequence >= SCRIPT_FRAMES
  return {
    sim: "iracing",
    connected: true,
    timestamp: FIXTURE_TIMESTAMP + sequence * FIXTURE_FRAME_MS,
    sessionUniqueId: FIXTURE_SESSION_ID,
    connectionEpoch: FIXTURE_CONNECTION_EPOCH,
    sessionType: "race",
    speedKmh: REFERENCE_SPEED_KMH,
    rpm: REFERENCE_RPM,
    maxRpm: REFERENCE_MAX_RPM,
    gear: REFERENCE_GEAR,
    throttle: 0.72,
    brake: 0,
    clutch: 0,
    position: 3,
    currentLapTimeSec: point.currentLapTimeSec,
    bestLapTimeSec: REFERENCE_BEST_LAP_SEC,
    deltaToBestSec: REFERENCE_DELTA_SEC,
    lapDistPct: point.lapDistPct,
    waterTempC: REFERENCE_WATER_C,
    oilTempC: REFERENCE_OIL_TEMP_C,
    oilPressureKpa: alarmArmed ? ALARM_OIL_PRESSURE_KPA : REFERENCE_OIL_PRESSURE_KPA,
    voltage: REFERENCE_VOLTAGE,
    fuelLiters: fuelLiters(point),
    fuelCapacityLiters: REFERENCE_FUEL_CAPACITY_L,
    onPitRoad: point.onPitRoad,
    pitLimiter: point.onPitRoad
  }
}

function builtRaceconDashboard(): Dashboard {
  const presets = BUILTIN_PRESETS.filter((candidate) => candidate.id === PRESET_ID)
  if (presets.length !== 1) throw new Error("racecon RC-03 preset must resolve exactly once")

  // The capture must exercise the production dashboard object unchanged. DashboardCanvas
  // derives its responsive render model without mutating this stored 1024x600 preset.
  const dashboard = presets[0].build()
  const fullFrame = dashboard.elements.filter(
    (element) => element.type === "overlaywidget" && element.widgetId === WIDGET_ID
  )
  if (dashboard.width !== 1024 || dashboard.height !== 600 || fullFrame.length !== 1) {
    throw new Error("racecon RC-03 preset must be the unmodified 1024x600 full-frame dashboard")
  }
  return dashboard
}

function RaceconCapture({ size, state }: { size: CaptureSize; state: CaptureState }): ReactElement {
  const [sequence, setSequence] = useState(0)
  const snapshot = useMemo(() => liveFixture(sequence, state), [sequence, state])
  const dashboard = useMemo(builtRaceconDashboard, [])
  const rootStyle: CSSProperties = {
    width: size.width,
    height: size.height,
    overflow: "hidden",
    background: dashboard.bg,
    color: "#ffffff"
  }

  // One scripted frame per committed render. A repeating interval lets React coalesce two ticks
  // into a single render, which would silently drop a scripted lap-distance sample and change
  // the burn laps the widget measures; re-arming after each commit cannot.
  useEffect(() => {
    const timer = window.setTimeout(() => setSequence((value) => value + 1), FIXTURE_FRAME_MS)
    return () => window.clearTimeout(timer)
  }, [sequence])

  return (
    <div
      id="racecon-rc03-capture-root"
      style={rootStyle}
      aria-label="RaceCon RC-03 deterministic visual capture"
      data-capture-ready={sequence >= READY_SEQUENCE ? "true" : "false"}
      data-capture-sequence={sequence}
      data-capture-state={state}
      data-capture-preset-id={PRESET_ID}
      data-capture-widget-id={WIDGET_ID}
      data-capture-source-kind="live-telemetry"
      data-capture-source-identity={FIXTURE_SOURCE_ID}
      data-capture-dashboard-width={dashboard.width}
      data-capture-dashboard-height={dashboard.height}
    >
      <DashboardCanvas dashboard={dashboard} snapshot={snapshot} showConnectionStatus={false} />
    </div>
  )
}

function CaptureApp(): ReactElement {
  return <RaceconCapture size={readCaptureSize()} state={readCaptureState()} />
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <CaptureApp />
  </StrictMode>
)

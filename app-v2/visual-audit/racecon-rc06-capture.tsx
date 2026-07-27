import "./harness-stubs"

import { StrictMode, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { BUILTIN_PRESETS, type Dashboard } from "@shared/dashboards"
import type { TelemetrySnapshot } from "@shared/telemetry"
import { DashboardCanvas } from "@renderer/dashboard/DashboardRoot"

const PRESET_ID = "racecon_rc06_dash"
const WIDGET_ID = "raceconRc06Dash"
const FIXTURE_FRAME_MS = 40
const FIXTURE_TIMESTAMP = 4_270_000
const FIXTURE_SESSION_ID = 76
const FIXTURE_CONNECTION_EPOCH = 1
const FIXTURE_SOURCE_ID = "iracing:session:76:connection:1"

/**
 * Approved reference state — attempt-001, lap 27 of plan 41.
 * These values are normative; the harness asserts them rather than pixels from the reference image.
 */
const REFERENCE_TARGET_BURN = 2.75
const REFERENCE_PIT_LAP = 41
const REFERENCE_SPEED_KMH = 214
const REFERENCE_GEAR = 4
const REFERENCE_DELTA_SEC = 0.42
const REFERENCE_BEST_LAP_SEC = 112.418 // 01:52.418
const REFERENCE_WATER_C = 88
const REFERENCE_POSITION = 4
const REFERENCE_FUEL_PER_LAP_L = 2.65
const REFERENCE_FUEL_L = 38.4
const REFERENCE_STARTING_LAP = 27

/** High burn rate that drives balance negative, triggering the SAVE MORE alert. */
const ALERT_FUEL_PER_LAP_L = 3.1

/**
 * Scripted lap progression. The fixture drives START_LAP → PLATEAU_LAP across SCRIPT_LAPS
 * boundaries so the per-lap accounting ledger settles and — in the save-more state — the
 * behind-plan alert latches at the first boundary.
 *
 * Mount guard note: the very first observed lap number is recorded without emitting a ledger
 * sample. Only the second (different) lap boundary emits the first entry. Two boundaries are
 * therefore needed for both ledger="measured" and alert latch.
 */
const START_LAP = REFERENCE_STARTING_LAP - 2 // = 25
const PLATEAU_LAP = REFERENCE_STARTING_LAP    // = 27
const SCRIPT_LAPS = 2                          // lap 25→26, 26→27
const PIT_FRAMES = 3                           // frames before first boundary
const LAP_FRAMES = 20                          // frames per scripted lap
const DRIVEN_FRAMES = SCRIPT_LAPS * LAP_FRAMES // = 40
const SCRIPT_FRAMES = PIT_FRAMES + DRIVEN_FRAMES // = 43

/**
 * After the scripted laps the fixture MUST NOT freeze the stream — a frozen `currentLap`
 * that stays constant never lets the feed-quiet window expire (currentLap is not a timing
 * feed), but the live channels (gear, speed) have staleness budgets as short as 50 ms.
 * The fixture continues sending frames every FIXTURE_FRAME_MS at the plateau, with a
 * constant timestamp increment that keeps all channels fresh. No lap boundary is crossed
 * after PLATEAU_LAP, so the alert latch state stays stable.
 */
const READY_SEQUENCE = SCRIPT_FRAMES + 12 // = 55

/**
 * Starting fuel level, computed so the plateau (lap 27, burn 2.65) lands exactly on the
 * reference 38.4 L.
 */
const FUEL_START_L = REFERENCE_FUEL_L + REFERENCE_FUEL_PER_LAP_L * (REFERENCE_STARTING_LAP - START_LAP)
// = 38.4 + 2.65 * 2 = 43.7 L

type CaptureState = "silent" | "save-more"

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
  throw new Error("racecon RC-06 capture requires 800x480, 1024x600, 393x759, 412x867, 759x393, or 867x412")
}

function readCaptureState(): CaptureState {
  const state = new URLSearchParams(window.location.search).get("state") ?? "silent"
  if (state === "silent" || state === "save-more") return state
  throw new Error('racecon RC-06 capture requires state=silent or state=save-more')
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Returns the scripted currentLap for a given sequence:
 * - Frames 0..PIT_FRAMES-1:   START_LAP (first lap seen by widget — mount guard)
 * - Frames PIT_FRAMES..43:    START_LAP + floor((driven / LAP_FRAMES)) + 1
 * - Frames 43+:               PLATEAU_LAP (held constant, no new boundaries)
 */
function currentLapForSequence(sequence: number): number {
  if (sequence < PIT_FRAMES) return START_LAP
  const driven = sequence - PIT_FRAMES
  if (driven < DRIVEN_FRAMES) {
    return START_LAP + Math.floor(driven / LAP_FRAMES) + 1
  }
  return PLATEAU_LAP
}

/**
 * Computes the scripted fuel level at a given lap, burning at `burnPerLap` from FUEL_START_L.
 * At the plateau (lap 27, burn 2.65): 43.7 - 2.65*2 = 38.4 L (reference value).
 * At the plateau (lap 27, burn 3.1):  43.7 - 3.1*2  = 37.5 L (save-more state).
 */
function fuelLitersForLap(lap: number, burnPerLap: number): number {
  return round2(FUEL_START_L - burnPerLap * (lap - START_LAP))
}

/**
 * A connected, provider-neutral live frame. It carries no mock scenario import and no replay
 * marker, and supplies the source identity fields the shared RC-01 ingest buffer requires
 * (`sessionUniqueId`, `connectionEpoch`, `connected`, a monotonic `timestamp`), so the buffer
 * accepts it as live telemetry.
 *
 * The `fuelLapsRemaining` field is always provided directly, using the deliberate channel
 * that RC-06 accepts (`snapshot.fuelLapsRemaining`). The rejected channels `fuelPerLap` and
 * `fuelPerLapKg` are never included.
 */
function liveFixture(sequence: number, state: CaptureState): TelemetrySnapshot {
  const lap = currentLapForSequence(sequence)
  const burnPerLap = state === "save-more" ? ALERT_FUEL_PER_LAP_L : REFERENCE_FUEL_PER_LAP_L
  const fuel = fuelLitersForLap(lap, burnPerLap)
  const lapsRemaining = round2(fuel / burnPerLap)

  return {
    sim: "iracing",
    connected: true,
    timestamp: FIXTURE_TIMESTAMP + sequence * FIXTURE_FRAME_MS,
    sessionUniqueId: FIXTURE_SESSION_ID,
    connectionEpoch: FIXTURE_CONNECTION_EPOCH,
    sessionType: "race",
    sessionState: "racing",
    speedKmh: REFERENCE_SPEED_KMH,
    // A live provider always reports engine speed. RC-06 binds no rpm channel and draws no rev
    // or shift surface, so this feeds nothing and renders nothing.
    rpm: 6_400,
    gear: REFERENCE_GEAR,
    throttle: 0.64,
    brake: 0,
    clutch: 0,
    position: REFERENCE_POSITION,
    deltaToBestSec: REFERENCE_DELTA_SEC,
    bestLapTimeSec: REFERENCE_BEST_LAP_SEC,
    currentLap: lap,
    waterTempC: REFERENCE_WATER_C,
    fuelLiters: fuel,
    fuelPerLapLiters: burnPerLap,
    fuelLapsRemaining: lapsRemaining
  }
}

function builtRaceconDashboard(): Dashboard {
  const presets = BUILTIN_PRESETS.filter((candidate) => candidate.id === PRESET_ID)
  if (presets.length !== 1) throw new Error("racecon RC-06 preset must resolve exactly once")

  const dashboard = presets[0].build()
  const fullFrame = dashboard.elements.filter(
    (element) => element.type === "overlaywidget" && element.widgetId === WIDGET_ID
  )
  if (dashboard.width !== 1024 || dashboard.height !== 600 || fullFrame.length !== 1) {
    throw new Error("racecon RC-06 preset must be the unmodified 1024x600 full-frame dashboard")
  }
  return dashboard
}

/**
 * Engineer plan for the RC-06 save-mode widget.
 *
 * The plan is dispatched as a CustomEvent on window (gotcha 8). The widget listens for
 * `racecon:save-mode-plan` and updates its plan state. We dispatch it on the first several
 * frames to ensure the widget's event listener is registered before we need the plan values.
 */
const ENGINEER_PLAN = Object.freeze({ targetBurnLPerLap: REFERENCE_TARGET_BURN, pitLap: REFERENCE_PIT_LAP })

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

  // One scripted frame per committed render. A repeating interval lets React coalesce two
  // ticks into a single render, which would silently skip a lap-boundary frame and prevent
  // the ledger from settling; re-arming after each commit cannot.
  useEffect(() => {
    const timer = window.setTimeout(() => setSequence((value) => value + 1), FIXTURE_FRAME_MS)
    return () => window.clearTimeout(timer)
  }, [sequence])

  // Dispatch the engineer plan on the first few frames. React's useEffect runs deepest-to-
  // shallowest, so the widget's own mount effects run before this dispatch, ensuring the
  // plan event listener is already registered when we fire.
  useEffect(() => {
    if (sequence <= 5) {
      window.dispatchEvent(new CustomEvent("racecon:save-mode-plan", { detail: ENGINEER_PLAN }))
    }
  }, [sequence])

  return (
    <div
      id="racecon-rc06-capture-root"
      style={rootStyle}
      aria-label="RaceCon RC-06 deterministic visual capture"
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

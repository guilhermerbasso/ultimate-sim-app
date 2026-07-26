import "./harness-stubs"

import { StrictMode, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { BUILTIN_PRESETS, type Dashboard } from "@shared/dashboards"
import type { TelemetrySnapshot } from "@shared/telemetry"
import { DashboardCanvas } from "@renderer/dashboard/DashboardRoot"

const PRESET_ID = "racecon_rc04_dash"
const WIDGET_ID = "raceconRc04Dash"
const FIXTURE_FRAME_MS = 40
/**
 * Start timestamp large enough to represent a session well underway. The RC-01 ingest buffer
 * requires strictly monotonic timestamps; every frame increments by FIXTURE_FRAME_MS.
 */
const FIXTURE_START_TS = 2_000_000
const FIXTURE_SESSION_ID = 74
const FIXTURE_CONNECTION_EPOCH = 2
const FIXTURE_SOURCE_ID = "iracing:session:74:connection:2"

/**
 * Reference telemetry from the governance evidence (rc04-governance-chain-v1.json):
 *   speedKmh: 52 → below the 60 km/h limit and below the caution band (≥ 57), so the bar
 *   renders its normal green tone. bar-fill = 52 / (60/0.75) = 52/80 = 65%.
 */
const REFERENCE_SPEED_KMH = 52
/**
 * Overspeed scenario: 72 km/h > 60 km/h limit. After 100 ms (three 40 ms frames) the widget
 * latches data-rc04-overspeed="true" and recolours the bar fill, speed border, action text and
 * alarm line to #ff3b30. bar-fill = 72/80 = 90%.
 */
const OVERSPEED_KMH = 72
const REFERENCE_GEAR = 2
const REFERENCE_FUEL_L = 68
const REFERENCE_FUEL_CAPACITY_L = 110

/**
 * Phase-sequence frame counts.
 *
 * TRACK_FRAMES:    onPitRoad false — establishes the on-track baseline and lets the buffer
 *                  absorb the first accepted frame before the pit sequence begins.
 * APPROACH_FRAMES: onPitRoad true, pitLimiter false → the phase machine advances to APPROACH.
 * LIMITER_FRAMES:  onPitRoad true, pitLimiter true → phase machine advances to LIMITER.
 *                  Overspeed state fires at frame TRACK_FRAMES + APPROACH_FRAMES when speed
 *                  exceeds the limit; the 100 ms debounce elapses after three further frames.
 * PLATEAU_FRAMES:  Additional frames after the phase is established, giving all display-clock
 *                  freshness windows time to settle before the ready gate opens.
 *
 * The fixture does NOT freeze after READY_SEQUENCE: the useEffect timeout chain re-arms after
 * every committed render, so fresh telemetry keeps arriving at 40 ms cadence. The staleness
 * budget for pitSpeed is only 100 ms, so a frozen feed would blank the speed readout within
 * three frames of the ready gate — exactly the lesson learned from RC-03's lap-distance tail.
 */
const TRACK_FRAMES = 4
const APPROACH_FRAMES = 8
const LIMITER_FRAMES = 25
const PLATEAU_FRAMES = 14

const READY_SEQUENCE = TRACK_FRAMES + APPROACH_FRAMES + LIMITER_FRAMES + PLATEAU_FRAMES

type CaptureState = "silent" | "overspeed"

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
  throw new Error("racecon RC-04 capture requires 800x480, 1024x600, 393x759, 412x867, 759x393, or 867x412")
}

function readCaptureState(): CaptureState {
  const state = new URLSearchParams(window.location.search).get("state") ?? "silent"
  if (state === "silent" || state === "overspeed") return state
  throw new Error("racecon RC-04 capture requires state=silent or state=overspeed")
}

/**
 * A connected, provider-neutral live frame that satisfies the shared RC-01 ingest buffer:
 * - `sim !== 'mock'` and `sim !== 'replay'`: accepted as live
 * - `sessionUniqueId` present: source identity can be derived
 * - Monotonically increasing `timestamp` (FIXTURE_START_TS + sequence × 40 ms)
 * - Stable source identity across all frames (same sessionUniqueId + connectionEpoch)
 *
 * The phase machine advances only through observed signals:
 *   frame < TRACK_FRAMES         → onPitRoad: false (on-track baseline)
 *   TRACK_FRAMES ≤ seq < TRACK+APPROACH → onPitRoad: true, pitLimiter: false → APPROACH
 *   seq ≥ TRACK+APPROACH         → onPitRoad: true, pitLimiter: true → LIMITER
 *
 * For the overspeed state, speedKmh is raised to 72 km/h as soon as the limiter is engaged.
 * The 100 ms debounce elapses after three 40 ms frames, latching data-rc04-overspeed="true".
 *
 * Documented packet omissions sent as honest empty channels:
 *   pitServiceFlags: undefined → crew corners show "--" (no tyre service flags received)
 *   repairTimeSec: undefined   → STINT shows "--:--" if no pit-exit yet observed (no marker)
 *   pitFuelToAddL: undefined   → FUEL TGT shows "--"
 *   carLeftRight: undefined    → proximity absent (LANE only renders in release phase)
 *   sessionState: 'racing'     → GRID shows "--" (no start-sequence state)
 */
function liveFixture(sequence: number, state: CaptureState): TelemetrySnapshot {
  const inPit = sequence >= TRACK_FRAMES
  const hasLimiter = sequence >= TRACK_FRAMES + APPROACH_FRAMES
  const speedKmh = state === "overspeed" && hasLimiter ? OVERSPEED_KMH : REFERENCE_SPEED_KMH

  return {
    sim: "iracing",
    connected: true,
    timestamp: FIXTURE_START_TS + sequence * FIXTURE_FRAME_MS,
    sessionUniqueId: FIXTURE_SESSION_ID,
    connectionEpoch: FIXTURE_CONNECTION_EPOCH,
    sessionType: "Race",
    sessionState: "racing",
    speedKmh: inPit ? speedKmh : REFERENCE_SPEED_KMH,
    gear: REFERENCE_GEAR,
    rpm: 3_500,
    maxRpm: 8_000,
    throttle: 0,
    brake: 0,
    clutch: 0,
    position: 5,
    fuelLiters: REFERENCE_FUEL_L,
    fuelCapacityLiters: REFERENCE_FUEL_CAPACITY_L,
    onPitRoad: inPit,
    pitLimiter: hasLimiter,
  } as TelemetrySnapshot
}

function builtRaceconDashboard(): Dashboard {
  const presets = BUILTIN_PRESETS.filter((candidate) => candidate.id === PRESET_ID)
  if (presets.length !== 1) throw new Error("racecon RC-04 preset must resolve exactly once")

  const dashboard = presets[0].build()
  const fullFrame = dashboard.elements.filter(
    (element) => element.type === "overlaywidget" && element.widgetId === WIDGET_ID
  )
  if (dashboard.width !== 1024 || dashboard.height !== 600 || fullFrame.length !== 1) {
    throw new Error("racecon RC-04 preset must be the unmodified 1024x600 full-frame dashboard")
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
  // into a single render and silently drop a scripted frame; re-arming after each commit cannot.
  useEffect(() => {
    const timer = window.setTimeout(() => setSequence((value) => value + 1), FIXTURE_FRAME_MS)
    return () => window.clearTimeout(timer)
  }, [sequence])

  return (
    <div
      id="racecon-rc04-capture-root"
      style={rootStyle}
      aria-label="RaceCon RC-04 deterministic visual capture"
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

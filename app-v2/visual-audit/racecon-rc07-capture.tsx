import "./harness-stubs"

import { StrictMode, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { BUILTIN_PRESETS, type Dashboard } from "@shared/dashboards"
import type { TelemetrySnapshot } from "@shared/telemetry"
import { DashboardCanvas } from "@renderer/dashboard/DashboardRoot"

const PRESET_ID = "racecon_rc07_dash"
const WIDGET_ID = "raceconRc07Dash"
const FIXTURE_FRAME_MS = 40
/**
 * Start timestamp matches the approved reference frame (§9). The buffer requires
 * monotonically increasing timestamps; we advance by FIXTURE_FRAME_MS each frame.
 */
const FIXTURE_TIMESTAMP = 5_070_000
const FIXTURE_SESSION_ID = 77
const FIXTURE_CONNECTION_EPOCH = 1
const FIXTURE_SOURCE_ID = "iracing:session:77:connection:1"

/**
 * Reference telemetry values from §9 of the RC-07 contract report. The approved reference
 * frame is from `input/telemetry-frame-multiclass-rejoin.json`.
 */
const REFERENCE_SPEED_KMH = 178
const REFERENCE_GEAR = 4
const REFERENCE_POSITION = 14
const REFERENCE_THROTTLE = 0.58

/**
 * Green-flag state: only green is true. This is what the silent fixture publishes.
 */
const GREEN_FLAGS = Object.freeze({
  green: true,
  yellow: false,
  blue: false,
  white: false,
  checkered: false,
  red: false,
  black: false,
  meatball: false,
  repair: false,
  disqualify: false,
  greenWhiteCheckered: false
})

/**
 * Four drivers: player (carIdx 7), and three others that populate the gap panels, the class
 * badges and the tower (app layout only). Class assignment by ascending classId sort:
 * 10→A(cyan), 20→B(green), 30→C(orange).
 */
const REFERENCE_DRIVERS = Object.freeze([
  Object.freeze({ carIdx: 7, name: "Player", carNumber: "77", position: 14, classPosition: 5, classId: 20, isPlayer: true }),
  Object.freeze({ carIdx: 11, name: "Class A car", carNumber: "2", position: 3, classPosition: 3, classId: 10, isPlayer: false, gapToPlayerSec: -0.8 }),
  Object.freeze({ carIdx: 12, name: "Class B car", carNumber: "18", position: 16, classPosition: 6, classId: 20, isPlayer: false, gapToPlayerSec: -2.6 }),
  Object.freeze({ carIdx: 13, name: "Class C car", carNumber: "54", position: 13, classPosition: 2, classId: 30, isPlayer: false, gapToPlayerSec: 1.4 }),
  Object.freeze({ carIdx: 14, name: "Class B chase", carNumber: "9", position: 12, classPosition: 4, classId: 20, isPlayer: false, gapToPlayerSec: 2.9 })
])

/**
 * Silent-state relatives: car 11 (class A) is 0.8 s behind, car 13 (class C) is 1.4 s ahead.
 * gapBehind uses Math.abs() so -0.8 renders as "0.8".
 */
const SILENT_RELATIVES = Object.freeze({
  behind: Object.freeze({ carIdx: 11, name: "Behind", carNumber: "2", gapSec: -0.8 }),
  ahead: Object.freeze({ carIdx: 13, name: "Ahead", carNumber: "54", gapSec: 1.4 })
})

/**
 * Silent-state radar contacts (four blips, none inside the 32-m critical zone at 80 m range).
 * Sorted by ascending distance for the blip rank ordering the widget expects.
 * Distances: ≈40.9 m, ≈54.4 m, ≈67.5 m, ≈69.5 m → radii ≈ 25.55, 34.00, 42.19, 45.19 units.
 */
const SILENT_RADAR_CARS = Object.freeze([
  Object.freeze({ carIdx: 11, relativeX: -20.8, relativeY: -35.2, gapSec: -0.8 }),  // A, behind-left
  Object.freeze({ carIdx: 13, relativeX: 25.6, relativeY: 48.0, gapSec: 1.4 }),     // C, ahead-right
  Object.freeze({ carIdx: 14, relativeX: -35.2, relativeY: 57.6, gapSec: 2.9 }),    // B, ahead-left
  Object.freeze({ carIdx: 12, relativeX: 33.6, relativeY: -60.8, gapSec: -2.6 })    // B, behind-right
])

/**
 * Proximity-alert relatives: the critical car (11) is now only 0.2 s behind.
 */
const PROXIMITY_RELATIVES = Object.freeze({
  behind: Object.freeze({ carIdx: 11, name: "Behind", carNumber: "2", gapSec: -0.2 }),
  ahead: Object.freeze({ carIdx: 13, name: "Ahead", carNumber: "54", gapSec: 1.4 })
})

/**
 * Proximity-alert radar: one car 3.5 m behind-left. At 80 m range the critical zone
 * radius = 80 × 0.4 = 32 m; distance ≈ 3.5 m → well inside → critical blip fires.
 * After RC07_IMMINENT_ENGAGE_MS (100 ms = ~3 frames at 40 ms), the radar edge appears.
 */
const PROXIMITY_RADAR_CARS = Object.freeze([
  Object.freeze({ carIdx: 11, relativeX: -3.2, relativeY: -1.5, gapSec: -0.2 })
])

/**
 * Enough frames for all alerts to settle and all channels to be demonstrably fresh.
 * 30 frames × 40 ms = 1 200 ms — well past the 100 ms proximity debounce.
 * The fixture keeps feeding after this so channels never go stale.
 */
const READY_SEQUENCE = 30

type CaptureState = "silent" | "proximity"

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
  throw new Error(
    "racecon RC-07 capture requires 800x480, 1024x600, 393x759, 412x867, 759x393, or 867x412"
  )
}

function readCaptureState(): CaptureState {
  const state = new URLSearchParams(window.location.search).get("state") ?? "silent"
  if (state === "silent" || state === "proximity") return state
  throw new Error("racecon RC-07 capture requires state=silent or state=proximity")
}

/**
 * A connected, provider-neutral live frame. No mock scenario import, no replay marker.
 * Supplies the source identity fields the shared RC-01 ingest buffer requires:
 * `sessionUniqueId`, `connectionEpoch`, `connected: true`, and a monotonic `timestamp`.
 *
 * Fixture lesson from RC-03: the stream must NEVER freeze after the ready sequence. The
 * RC-07 display clock ages channel receipts every 100 ms; a frozen stream walks past its
 * own staleness gates and silently changes the rendered frame. We keep advancing `sequence`
 * forever so every channel stays within RC07_CHANNEL_STALE_MS.
 */
function liveFixture(sequence: number, state: CaptureState): TelemetrySnapshot {
  const isProximity = state === "proximity"
  return {
    sim: "iracing",
    connected: true,
    timestamp: FIXTURE_TIMESTAMP + sequence * FIXTURE_FRAME_MS,
    sessionUniqueId: FIXTURE_SESSION_ID,
    connectionEpoch: FIXTURE_CONNECTION_EPOCH,
    sessionType: "race",
    sessionState: "racing",
    currentLap: 31,
    position: REFERENCE_POSITION,
    playerCarIdx: 7,
    speedKmh: REFERENCE_SPEED_KMH,
    // A live provider always reports engine speed. RC07_PACKET_OMISSIONS.shiftCue records that
    // packet section 16 defines no engine-speed channel for RC-07, so the widget binds none and
    // draws no shift or over-rev surface: this feeds nothing and renders nothing.
    rpm: 6_400,
    gear: REFERENCE_GEAR,
    throttle: REFERENCE_THROTTLE,
    brake: 0,
    clutch: 0,
    // No bestLapTimeSec → delta renders "--.---"
    // No fuelLiters / fuelPerLapLiters → fuel cell renders "--" (app layout only)
    flags: GREEN_FLAGS,
    raceControlState: "known",
    // carLeftRight follows the radar contact side for the spotter zone label
    carLeftRight: isProximity ? "left" : "clear",
    drivers: [...REFERENCE_DRIVERS],
    relatives: { ...(isProximity ? PROXIMITY_RELATIVES : SILENT_RELATIVES) },
    radarCars: [...(isProximity ? PROXIMITY_RADAR_CARS : SILENT_RADAR_CARS)]
  }
}

function builtRaceconDashboard(): Dashboard {
  const presets = BUILTIN_PRESETS.filter((candidate) => candidate.id === PRESET_ID)
  if (presets.length !== 1) throw new Error("racecon RC-07 preset must resolve exactly once")

  const dashboard = presets[0].build()
  const fullFrame = dashboard.elements.filter(
    (element) => element.type === "overlaywidget" && element.widgetId === WIDGET_ID
  )
  if (dashboard.width !== 1024 || dashboard.height !== 600 || fullFrame.length !== 1) {
    throw new Error("racecon RC-07 preset must be the unmodified 1024x600 full-frame dashboard")
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

  // One scripted frame per committed render, re-armed after each commit so React cannot
  // coalesce ticks and silently miss a channel freshness update.
  useEffect(() => {
    const timer = window.setTimeout(() => setSequence((value) => value + 1), FIXTURE_FRAME_MS)
    return () => window.clearTimeout(timer)
  }, [sequence])

  return (
    <div
      id="racecon-rc07-capture-root"
      style={rootStyle}
      aria-label="RaceCon RC-07 deterministic visual capture"
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

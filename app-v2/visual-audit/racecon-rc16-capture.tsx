import "./harness-stubs"

import { StrictMode, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { BUILTIN_PRESETS, type Dashboard } from "@shared/dashboards"
import type { TelemetrySnapshot } from "@shared/telemetry"
import { DashboardCanvas } from "@renderer/dashboard/DashboardRoot"

const PRESET_ID = "racecon_rc16_dash"
const WIDGET_ID = "raceconRc16Dash"
const FIXTURE_FRAME_MS = 40
const FIXTURE_TIMESTAMP = 1_606_000
const FIXTURE_SESSION_ID = 61
const FIXTURE_CONNECTION_EPOCH = 6
const FIXTURE_SOURCE_ID = "iracing:session:61:connection:6"

/**
 * The approved RC-16 reference state — attempt-002, adjudicated APPROVED by
 * `rc16-governance-chain-v1.json` ("attempt": 2, "verdict": "APPROVED",
 * re-adjudication rule "SOP failure mode 11: approve the earlier attempt when later attempts fail
 * to beat it"). Attempts 001–006 exist; 002 is the approved frame.
 *
 * Reference fixture: sim=iracing, sessionUniqueId=61, connectionEpoch=6, currentLap=6,
 * completedLaps=5, gear=3, rpm=6800, maxRpm=7400, speedKmh=138, throttle=0.5, brake=0,
 * clutch=0, deltaToBestSec=-0.28, bestLapTimeSec=102.04, lastLapTimeSec=102.318,
 * sessionType='Practice', sessionState='racing', playerCarIdx=6.
 * Three observed laps closed into the buffer: lap3→102.1, lap4→102.52, lap5→102.318,
 * each driven with THROTTLE_STEP=0.0144 to produce smoothnessIndex=82.
 * Resulting reference values: consistency=0.42s, smoothness=82, delta=-0.28, lastLap=1:42.318.
 */

const THROTTLE_STEP = 0.0144

/**
 * Frame budget:
 *   MOUNT_FRAMES   — frames 0-4: currentLap=3, mounted mid-lap, coaching buffer accepting
 *   LAP_CLOSE_1    — frame 5: currentLap→4, lastLapTimeSec=102.1 closes lap 3
 *   LAP_FRAMES     — frames per driving phase: 20 frames → 19 throttle deltas for smoothness=82
 *   LAP_CLOSE_2    — frame 26: currentLap→5, lastLapTimeSec=102.52 closes lap 4
 *   LAP_CLOSE_3    — frame 47: currentLap→6, lastLapTimeSec=102.318 closes lap 5
 *   OVER_REV_START — frame 75: rpm→7363 in the over-rev state (3 frames before READY)
 *                    80 ms ≥ RC16_OVER_REV_ATTACK_MS=60 ms → alert fires by frame 77
 *   PLATEAU_FRAMES — 30 frames of stability after the last lap close
 *   READY_SEQUENCE — frame 78: data-capture-ready="true"
 */
const LAP_CLOSE_1 = 5
const LAP_CLOSE_2 = 26
const LAP_CLOSE_3 = 47
const OVER_REV_START = 75
const READY_SEQUENCE = 78

const NORMAL_RPM = 6_800
const OVER_REV_RPM = 7_363   // rpmRatio = 7363/7400 ≈ 0.9950 > RC16_OVER_REV_ENTER_RATIO (0.99)
const MAX_RPM = 7_400

type CaptureState = "silent" | "over-rev"

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
  throw new Error("racecon RC-16 capture requires 800x480, 1024x600, 393x759, 412x867, 759x393, or 867x412")
}

function readCaptureState(): CaptureState {
  const state = new URLSearchParams(window.location.search).get("state") ?? "silent"
  if (state === "silent" || state === "over-rev") return state
  throw new Error("racecon RC-16 capture requires state=silent or state=over-rev")
}

/**
 * Deterministic frame fixture driving the coaching buffer through three observed laps.
 *
 * Lap construction:
 *  - Frames 0-4:  currentLap=3, mount phase, no lastLapTimeSec (observedWhole=false)
 *  - Frame 5:     currentLap→4, lastLapTimeSec=102.1 (closes lap 3, unobserved)
 *  - Frames 5-25: lap 4 driving, throttle oscillates by ±THROTTLE_STEP each frame
 *                 → 19 intervals × |dThrottle|=0.0144 → rate=36 %/s → smoothness=82
 *  - Frame 26:    currentLap→5, lastLapTimeSec=102.52 (closes lap 4, smoothness=82)
 *  - Frames 26-46: lap 5 driving (same oscillation pattern)
 *  - Frame 47:    currentLap→6, lastLapTimeSec=102.318 (closes lap 5, smoothness=82)
 *  - Frames 47+:  plateau with lastLapTimeSec=102.318 kept fresh; buffer settles
 *
 * Over-rev trigger: in the over-rev state, rpm flips to 7363 at OVER_REV_START=75.
 * RC16_OVER_REV_ATTACK_MS=60 ms; at 40 ms/frame the alert fires after 2 frames (80 ms ≥ 60 ms).
 * By READY_SEQUENCE=78 the alert is already active.
 *
 * The RC16_CHANNEL_STALE_MS.lastLap budget is 2 000 ms. PLATEAU_FRAMES=30 × 40 ms = 1 200 ms,
 * so the last-lap receipt is always fresh at the capture point.
 */
function liveFixture(sequence: number, state: CaptureState): TelemetrySnapshot {
  let currentLap = 3
  let lastLapTimeSec: number | undefined
  let throttle = 0.5
  const rpm = state === "over-rev" && sequence >= OVER_REV_START ? OVER_REV_RPM : NORMAL_RPM

  if (sequence >= LAP_CLOSE_3) {
    // Lap 5 closed; driving lap 6 and beyond
    currentLap = 6
    lastLapTimeSec = 102.318
  } else if (sequence >= LAP_CLOSE_2) {
    // Lap 4 closed; driving lap 5
    currentLap = 5
    lastLapTimeSec = 102.52
    const frameInLap = sequence - LAP_CLOSE_2
    // Alternate throttle ±THROTTLE_STEP so |dThrottle|=0.0144 every frame.
    // meanAbsRate = 0.0144 × 100 / 0.04 s = 36 %/s → smoothness = round(100×(1-36/200)) = 82
    throttle = 0.5 + (frameInLap % 2 === 0 ? 0 : THROTTLE_STEP)
  } else if (sequence >= LAP_CLOSE_1) {
    // Lap 3 closed; driving lap 4
    currentLap = 4
    lastLapTimeSec = 102.1
    const frameInLap = sequence - LAP_CLOSE_1
    throttle = 0.5 + (frameInLap % 2 === 0 ? 0 : THROTTLE_STEP)
  }
  // frames 0-4: currentLap=3, no lastLapTimeSec (mount mid-lap)

  const base: TelemetrySnapshot = {
    sim: "iracing",
    connected: true,
    timestamp: FIXTURE_TIMESTAMP + sequence * FIXTURE_FRAME_MS,
    sessionUniqueId: FIXTURE_SESSION_ID,
    connectionEpoch: FIXTURE_CONNECTION_EPOCH,
    sessionType: "Practice",
    sessionState: "racing",
    currentLap,
    completedLaps: currentLap - 1,
    playerCarIdx: 6,
    gear: 3,
    rpm,
    maxRpm: MAX_RPM,
    speedKmh: 138,
    throttle,
    brake: 0,
    clutch: 0,
    deltaToBestSec: -0.28,
    bestLapTimeSec: 102.04,
  } as TelemetrySnapshot

  if (lastLapTimeSec !== undefined) {
    return { ...base, lastLapTimeSec } as TelemetrySnapshot
  }
  return base
}

function builtRaceconDashboard(): Dashboard {
  const presets = BUILTIN_PRESETS.filter((candidate) => candidate.id === PRESET_ID)
  if (presets.length !== 1) throw new Error("racecon RC-16 preset must resolve exactly once")
  const dashboard = presets[0].build()
  const fullFrame = dashboard.elements.filter(
    (element) => element.type === "overlaywidget" && element.widgetId === WIDGET_ID
  )
  if (dashboard.width !== 1024 || dashboard.height !== 600 || fullFrame.length !== 1) {
    throw new Error("racecon RC-16 preset must be the unmodified 1024x600 full-frame dashboard")
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

  // One scripted frame per committed render; re-arm after each commit to prevent coalesced ticks.
  useEffect(() => {
    const timer = window.setTimeout(() => setSequence((value) => value + 1), FIXTURE_FRAME_MS)
    return () => window.clearTimeout(timer)
  }, [sequence])

  return (
    <div
      id="racecon-rc16-capture-root"
      style={rootStyle}
      aria-label="RaceCon RC-16 deterministic visual capture"
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

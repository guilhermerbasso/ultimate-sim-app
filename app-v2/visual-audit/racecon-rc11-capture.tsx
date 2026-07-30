import "./harness-stubs"

import { StrictMode, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { BUILTIN_PRESETS, type Dashboard } from "@shared/dashboards"
import type { TelemetrySnapshot } from "@shared/telemetry"
import { DashboardCanvas } from "@renderer/dashboard/DashboardRoot"

const PRESET_ID = "racecon_rc11_dash"
const WIDGET_ID = "raceconRc11Dash"
const FIXTURE_FRAME_MS = 16
const FIXTURE_TIMESTAMP = 5_110_000
const FIXTURE_SESSION_ID = 113
const FIXTURE_CONNECTION_EPOCH = 5
const FIXTURE_SOURCE_ID = "iracing:session:113:connection:5"

/**
 * RC-11 "Trace Room" is an accumulating artifact: the four distance-domain panels plot a
 * rolling buffer of accepted live samples, so a single frame draws nothing useful. The fixture
 * scripts a synthetic lap — a repeating speed/throttle/brake/steering shape — at the 16 ms
 * frame period the fastest RC11 channel budget (throttle/brake/steering/G, 20 ms) demands.
 *
 * The shape is a pure function of the sequence number, so the buffer contents at
 * READY_SEQUENCE are identical on every run and at every viewport.
 */
const TRACE_PERIOD_FRAMES = 90
const REFERENCE_MAX_RPM = 7_800
const REFERENCE_BEST_LAP_SEC = 92.418
const REFERENCE_LAST_LAP_SEC = 92.905
const REFERENCE_DELTA_TO_BEST_SEC = 0.487
const REFERENCE_TYRE_FL_C = 84
const REFERENCE_TYRE_FR_C = 87
const REFERENCE_BRAKE_TEMP_F_C = 412

/**
 * The data-gap scenario: RC-11 draws a DATA GAP band over any run of samples whose channels
 * report null. Holding speed, throttle and brake absent for GAP_FRAMES creates exactly one
 * band, which is what the engaged frame must show.
 */
const WARM_FRAMES = 180
const GAP_FRAMES = 24
const PLATEAU_FRAMES = 90
const READY_SEQUENCE = WARM_FRAMES + GAP_FRAMES + PLATEAU_FRAMES

type CaptureState = "silent" | "data-gap"

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
  throw new Error("racecon RC-11 capture requires 800x480, 1024x600, 393x759, 412x867, 759x393, or 867x412")
}

function readCaptureState(): CaptureState {
  const state = new URLSearchParams(window.location.search).get("state") ?? "silent"
  if (state === "silent" || state === "data-gap") return state
  throw new Error("racecon RC-11 capture requires state=silent or state=data-gap")
}

/** A deterministic lap shape: one braking event and one corner per TRACE_PERIOD_FRAMES. */
function lapShape(sequence: number): {
  speedKmh: number
  throttle: number
  brake: number
  steerAngleDeg: number
  latAccelG: number
  longAccelG: number
  gear: number
} {
  const phase = (sequence % TRACE_PERIOD_FRAMES) / TRACE_PERIOD_FRAMES
  // 0.00–0.45 straight, 0.45–0.60 braking, 0.60–0.80 corner, 0.80–1.00 exit.
  if (phase < 0.45) {
    const t = phase / 0.45
    return {
      speedKmh: 150 + Math.round(90 * t),
      throttle: 1,
      brake: 0,
      steerAngleDeg: 0,
      latAccelG: 0,
      longAccelG: 0.9 - 0.5 * t,
      gear: t < 0.5 ? 4 : 5
    }
  }
  if (phase < 0.6) {
    const t = (phase - 0.45) / 0.15
    return {
      speedKmh: 240 - Math.round(150 * t),
      throttle: 0,
      brake: 1 - 0.4 * t,
      steerAngleDeg: Math.round(14 * t),
      latAccelG: 0.4 * t,
      longAccelG: -1.6 + 0.4 * t,
      gear: t < 0.5 ? 4 : 3
    }
  }
  if (phase < 0.8) {
    const t = (phase - 0.6) / 0.2
    return {
      speedKmh: 90 + Math.round(20 * t),
      throttle: 0.25 + 0.4 * t,
      brake: 0,
      steerAngleDeg: 42 - Math.round(18 * t),
      latAccelG: 1.4 - 0.5 * t,
      longAccelG: 0.2 + 0.4 * t,
      gear: 3
    }
  }
  const t = (phase - 0.8) / 0.2
  return {
    speedKmh: 110 + Math.round(40 * t),
    throttle: 0.75 + 0.25 * t,
    brake: 0,
    steerAngleDeg: Math.round(20 * (1 - t)),
    latAccelG: 0.8 * (1 - t),
    longAccelG: 0.9,
    gear: t < 0.6 ? 3 : 4
  }
}

function liveFixture(sequence: number, state: CaptureState): TelemetrySnapshot {
  const inGap = state === "data-gap" && sequence >= WARM_FRAMES && sequence < WARM_FRAMES + GAP_FRAMES
  const shape = lapShape(sequence)
  const base = {
    sim: "iracing",
    connected: true,
    timestamp: FIXTURE_TIMESTAMP + sequence * FIXTURE_FRAME_MS,
    sessionUniqueId: FIXTURE_SESSION_ID,
    connectionEpoch: FIXTURE_CONNECTION_EPOCH,
    sessionType: "Race",
    sessionState: "racing",
    currentLap: 11,
    playerCarIdx: 3,
    position: 4,
    maxRpm: REFERENCE_MAX_RPM,
    rpm: 3_000 + shape.speedKmh * 12,
    bestLapTimeSec: REFERENCE_BEST_LAP_SEC,
    lastLapTimeSec: REFERENCE_LAST_LAP_SEC,
    deltaToBestSec: REFERENCE_DELTA_TO_BEST_SEC,
    tyres: {
      lf: { tempC: REFERENCE_TYRE_FL_C },
      rf: { tempC: REFERENCE_TYRE_FR_C },
      lr: { tempC: 79 },
      rr: { tempC: 81 }
    },
    brakeTempC: { lf: REFERENCE_BRAKE_TEMP_F_C, rf: 405, lr: 318, rr: 322 }
  }
  if (inGap) {
    // A genuine channel gap: the sample arrives, but speed, throttle and brake carry no value.
    return { ...base, gear: shape.gear, steerAngleDeg: shape.steerAngleDeg, latAccelG: 0, longAccelG: 0 } as TelemetrySnapshot
  }
  return { ...base, ...shape } as TelemetrySnapshot
}

function builtRaceconDashboard(): Dashboard {
  const presets = BUILTIN_PRESETS.filter((candidate) => candidate.id === PRESET_ID)
  if (presets.length !== 1) throw new Error("racecon RC-11 preset must resolve exactly once")
  const dashboard = presets[0].build()
  const fullFrame = dashboard.elements.filter(
    (element) => element.type === "overlaywidget" && element.widgetId === WIDGET_ID
  )
  if (dashboard.width !== 1024 || dashboard.height !== 600 || fullFrame.length !== 1) {
    throw new Error("racecon RC-11 preset must be the unmodified 1024x600 full-frame dashboard")
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

  useEffect(() => {
    const timer = window.setTimeout(() => setSequence((value) => value + 1), FIXTURE_FRAME_MS)
    return () => window.clearTimeout(timer)
  }, [sequence])

  return (
    <div
      id="racecon-rc11-capture-root"
      style={rootStyle}
      aria-label="RaceCon RC-11 deterministic visual capture"
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

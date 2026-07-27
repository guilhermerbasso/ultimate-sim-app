import "./harness-stubs"

import { StrictMode, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { BUILTIN_PRESETS, type Dashboard } from "@shared/dashboards"
import type { TelemetrySnapshot } from "@shared/telemetry"
import { DashboardCanvas } from "@renderer/dashboard/DashboardRoot"

const PRESET_ID = "racecon_rc08_dash"
const WIDGET_ID = "raceconRc08Dash"
const FIXTURE_FRAME_MS = 40
const FIXTURE_TIMESTAMP = 5_080_000
const FIXTURE_SESSION_ID = 88
const FIXTURE_CONNECTION_EPOCH = 4
const FIXTURE_SOURCE_ID = "iracing:session:88:connection:4"

/**
 * The approved RC-08 silent reference state — exact values from the governance evidence
 * (section 9, concrete fixture sets). The harness asserts these values rather than pixels
 * sampled from the reference image.
 */
const REFERENCE_TRACK_WETNESS_PCT = 0.52   // → WET (0.35 ≤ 0.52 < 0.75)
const REFERENCE_TC_LEVEL = 6
const REFERENCE_ABS_LEVEL = 4
const REFERENCE_BRAKE_BIAS_PCT = 54.5
const REFERENCE_DELTA_TO_BEST_SEC = 2.418  // positive → behind best → data-tone="bad"
const REFERENCE_BEST_LAP_SEC = 105.204     // required for delta to render
const REFERENCE_GEAR = 3
const REFERENCE_SPEED_KMH = 128

/** All four corners in the 50–80 °C wet window: no COLD alert fires on the silent frame. */
const REFERENCE_TYRE_FL_C = 63
const REFERENCE_TYRE_FR_C = 61
const REFERENCE_TYRE_RL_C = 58
const REFERENCE_TYRE_RR_C = 62

/**
 * The cold-tyre alert scenario: FL below 50 °C (RC08_WET_WINDOW_C.minC) while the grip
 * regime is WET. After RC08_COLD_TYRE_ENGAGE_MS (3 000 ms) of continuous cold temperature
 * the alert latches on FL.
 */
const COLD_FL_C = 41

/**
 * Frame budget:
 *   WARM_FRAMES  — establish WET grip baseline; no alert in either state
 *   COLD_FRAMES  — cold-tyre state only: FL=41 °C for 3 600 ms > RC08_COLD_TYRE_ENGAGE_MS=3 000 ms
 *   PLATEAU      — stable measurement window after the alert latches
 *   READY_SEQUENCE — the sequence at which data-capture-ready becomes "true";
 *                    large enough that cold-tyre is already latched in the cold-tyre state
 */
const WARM_FRAMES = 80
const COLD_FRAMES = 92    // 92 × 40 ms = 3 680 ms > RC08_COLD_TYRE_ENGAGE_MS = 3 000 ms
const PLATEAU_FRAMES = 25
const READY_SEQUENCE = WARM_FRAMES + COLD_FRAMES + PLATEAU_FRAMES   // = 197

type CaptureState = "silent" | "cold-tyre"

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
  throw new Error("racecon RC-08 capture requires 800x480, 1024x600, 393x759, 412x867, 759x393, or 867x412")
}

function readCaptureState(): CaptureState {
  const state = new URLSearchParams(window.location.search).get("state") ?? "silent"
  if (state === "silent" || state === "cold-tyre") return state
  throw new Error("racecon RC-08 capture requires state=silent or state=cold-tyre")
}

/**
 * A connected, provider-neutral live frame. It carries no mock scenario import and no replay
 * marker, and supplies the source identity fields the shared RC-01 ingest buffer requires
 * (`sessionUniqueId`, `connectionEpoch`, `connected`, a monotonic `timestamp`), so the buffer
 * accepts it as live telemetry.
 *
 * After WARM_FRAMES, the cold-tyre state lowers the FL corner to 41 °C. Held for COLD_FRAMES
 * (3 680 ms) it exceeds RC08_COLD_TYRE_ENGAGE_MS (3 000 ms) and latches the cold-tyre alert
 * before READY_SEQUENCE is reached.
 *
 * The fixture continues feeding after READY_SEQUENCE to keep every channel within its
 * RC08_CHANNEL_STALE_MS budget (fastest = gear at 50 ms). Incrementing the timestamp per
 * frame advances `arrivalMs` so the 100 ms display clock never ages a channel to stale.
 */
function liveFixture(sequence: number, state: CaptureState): TelemetrySnapshot {
  const coldActive = state === "cold-tyre" && sequence >= WARM_FRAMES
  return {
    sim: "iracing",
    connected: true,
    timestamp: FIXTURE_TIMESTAMP + sequence * FIXTURE_FRAME_MS,
    sessionUniqueId: FIXTURE_SESSION_ID,
    connectionEpoch: FIXTURE_CONNECTION_EPOCH,
    sessionType: "Race",
    sessionState: "racing",
    currentLap: 14,
    position: 9,
    playerCarIdx: 4,
    trackWetnessPct: REFERENCE_TRACK_WETNESS_PCT,
    tcLevel: REFERENCE_TC_LEVEL,
    tcEnabled: true,
    absLevel: REFERENCE_ABS_LEVEL,
    absEnabled: true,
    brakeBiasPct: REFERENCE_BRAKE_BIAS_PCT,
    deltaToBestSec: REFERENCE_DELTA_TO_BEST_SEC,
    bestLapTimeSec: REFERENCE_BEST_LAP_SEC,
    gear: REFERENCE_GEAR,
    speedKmh: REFERENCE_SPEED_KMH,
    tyres: {
      lf: { tempC: coldActive ? COLD_FL_C : REFERENCE_TYRE_FL_C },
      rf: { tempC: REFERENCE_TYRE_FR_C },
      lr: { tempC: REFERENCE_TYRE_RL_C },
      rr: { tempC: REFERENCE_TYRE_RR_C }
    }
  } as TelemetrySnapshot
}

function builtRaceconDashboard(): Dashboard {
  const presets = BUILTIN_PRESETS.filter((candidate) => candidate.id === PRESET_ID)
  if (presets.length !== 1) throw new Error("racecon RC-08 preset must resolve exactly once")
  const dashboard = presets[0].build()
  const fullFrame = dashboard.elements.filter(
    (element) => element.type === "overlaywidget" && element.widgetId === WIDGET_ID
  )
  if (dashboard.width !== 1024 || dashboard.height !== 600 || fullFrame.length !== 1) {
    throw new Error("racecon RC-08 preset must be the unmodified 1024x600 full-frame dashboard")
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
  // into a single render; re-arming after each commit cannot.
  useEffect(() => {
    const timer = window.setTimeout(() => setSequence((value) => value + 1), FIXTURE_FRAME_MS)
    return () => window.clearTimeout(timer)
  }, [sequence])

  return (
    <div
      id="racecon-rc08-capture-root"
      style={rootStyle}
      aria-label="RaceCon RC-08 deterministic visual capture"
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

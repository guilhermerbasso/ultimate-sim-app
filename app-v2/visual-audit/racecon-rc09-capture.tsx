import "./harness-stubs"

import { StrictMode, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { BUILTIN_PRESETS, type Dashboard } from "@shared/dashboards"
import type { TelemetrySnapshot } from "@shared/telemetry"
import { DashboardCanvas } from "@renderer/dashboard/DashboardRoot"

const PRESET_ID = "racecon_rc09_dash"
const WIDGET_ID = "raceconRc09Dash"
const FIXTURE_FRAME_MS = 40
const FIXTURE_TIMESTAMP = 5_090_000
const FIXTURE_SESSION_ID = 91
const FIXTURE_CONNECTION_EPOCH = 2
const FIXTURE_SOURCE_ID = "iracing:session:91:connection:2"

/**
 * The approved RC-09 "Stage Time" silent reference state. Values are chosen so every channel
 * RC-09 reads is fresh and inside its resting band, which is what makes the silent frame
 * genuinely silent rather than merely un-triggered:
 *   waterTempC inside RC09_WATER_RANGE_C (60..110)      → no WATER WARNING
 *   oilPressureKpa inside RC09_OIL_PRESSURE_RANGE (150..800) at rpm >= 1200 → no OIL WARNING
 *   |deltaToBestSec| <= RC09_SPLIT_LOSS_THRESHOLD_SEC (2.0) → no SPLIT LOSS
 * No roadbook event is dispatched, so the note tile stays on its documented empty state and
 * the caution-waypoint alert cannot fire.
 */
const REFERENCE_CURRENT_LAP_TIME_SEC = 154.82
const REFERENCE_SPEED_KMH = 112
const REFERENCE_GEAR = 4
const REFERENCE_WATER_TEMP_C = 88
const REFERENCE_OIL_PRESSURE_KPA = 420
const REFERENCE_RPM = 5_400
const REFERENCE_MAX_RPM = 7_800
const REFERENCE_BEST_LAP_SEC = 168.44
const REFERENCE_DELTA_SILENT_SEC = 0.412

/**
 * The split-loss scenario: delta above RC09_SPLIT_LOSS_THRESHOLD_SEC (2.0 s) held for longer
 * than RC09_SPLIT_LOSS_ENGAGE_MS (1 000 ms) latches the SPLIT LOSS alert on the split chip.
 */
const SPLIT_LOSS_DELTA_SEC = 3.284

/**
 * RC-09's note cue has no telemetry channel at all: the only lawful source is an explicit
 * roadbook load by the crew, and until one arrives the cue is literally blank. A harness that
 * never loads a roadbook would therefore capture a permanently empty note tile, an empty
 * profile strip and a note glyph that never renders — three surfaces unmeasured.
 *
 * The fixture dispatches one well-formed, NON-hazard call, so the note tile carries a real
 * reading while the caution-waypoint alert (which needs `hazard: true`) stays silent. The
 * distance-to-note readout still dashes, because that is a missing CHANNEL rather than a
 * missing roadbook — which is exactly the omission the harness has to prove.
 */
const ROADBOOK_EVENT = "racecon:stage-time-roadbook"
const ROADBOOK_NOTE = Object.freeze({ note: "LEFT 4 LONG", hazard: false, sequence: 12 })
const ROADBOOK_FRAME = 8

/**
 * Frame budget. LOSS_FRAMES × 40 ms = 1 600 ms comfortably exceeds the 1 000 ms engage window,
 * and the fixture keeps feeding afterwards so the fastest channel (gear, 50 ms) never ages out.
 */
const WARM_FRAMES = 60
const LOSS_FRAMES = 40
const PLATEAU_FRAMES = 25
const READY_SEQUENCE = WARM_FRAMES + LOSS_FRAMES + PLATEAU_FRAMES

type CaptureState = "silent" | "split-loss"

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
  throw new Error("racecon RC-09 capture requires 800x480, 1024x600, 393x759, 412x867, 759x393, or 867x412")
}

function readCaptureState(): CaptureState {
  const state = new URLSearchParams(window.location.search).get("state") ?? "silent"
  if (state === "silent" || state === "split-loss") return state
  throw new Error("racecon RC-09 capture requires state=silent or state=split-loss")
}

function liveFixture(sequence: number, state: CaptureState): TelemetrySnapshot {
  const lossActive = state === "split-loss" && sequence >= WARM_FRAMES
  return {
    sim: "iracing",
    connected: true,
    timestamp: FIXTURE_TIMESTAMP + sequence * FIXTURE_FRAME_MS,
    sessionUniqueId: FIXTURE_SESSION_ID,
    connectionEpoch: FIXTURE_CONNECTION_EPOCH,
    sessionType: "Race",
    sessionState: "racing",
    currentLap: 3,
    position: 6,
    playerCarIdx: 7,
    currentLapTimeSec: REFERENCE_CURRENT_LAP_TIME_SEC,
    speedKmh: REFERENCE_SPEED_KMH,
    gear: REFERENCE_GEAR,
    waterTempC: REFERENCE_WATER_TEMP_C,
    oilPressureKpa: REFERENCE_OIL_PRESSURE_KPA,
    rpm: REFERENCE_RPM,
    maxRpm: REFERENCE_MAX_RPM,
    bestLapTimeSec: REFERENCE_BEST_LAP_SEC,
    deltaToBestSec: lossActive ? SPLIT_LOSS_DELTA_SEC : REFERENCE_DELTA_SILENT_SEC
  } as TelemetrySnapshot
}

function builtRaceconDashboard(): Dashboard {
  const presets = BUILTIN_PRESETS.filter((candidate) => candidate.id === PRESET_ID)
  if (presets.length !== 1) throw new Error("racecon RC-09 preset must resolve exactly once")
  const dashboard = presets[0].build()
  const fullFrame = dashboard.elements.filter(
    (element) => element.type === "overlaywidget" && element.widgetId === WIDGET_ID
  )
  if (dashboard.width !== 1024 || dashboard.height !== 600 || fullFrame.length !== 1) {
    throw new Error("racecon RC-09 preset must be the unmodified 1024x600 full-frame dashboard")
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

  // Dispatched once, after the widget has mounted and accepted its first live frames, so the
  // note cue is loaded long before READY_SEQUENCE and the capture never races the listener.
  useEffect(() => {
    if (sequence !== ROADBOOK_FRAME) return
    window.dispatchEvent(new CustomEvent(ROADBOOK_EVENT, { detail: { ...ROADBOOK_NOTE } }))
  }, [sequence])

  return (
    <div
      id="racecon-rc09-capture-root"
      style={rootStyle}
      aria-label="RaceCon RC-09 deterministic visual capture"
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

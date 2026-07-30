import "./harness-stubs"

import { StrictMode, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { BUILTIN_PRESETS, type Dashboard } from "@shared/dashboards"
import type { TelemetrySnapshot } from "@shared/telemetry"
import { DashboardCanvas } from "@renderer/dashboard/DashboardRoot"

const PRESET_ID = "racecon_rc13_dash"
const WIDGET_ID = "raceconRc13Dash"
const FIXTURE_FRAME_MS = 40
const FIXTURE_TIMESTAMP = 5_130_000
const FIXTURE_SESSION_ID = 135
const FIXTURE_CONNECTION_EPOCH = 7
const FIXTURE_SOURCE_ID = "iracing:session:135:connection:7"

/**
 * The approved RC-13 "Hold Order" silent reference state: a neutralised race under a
 * full-course yellow, holding station behind the safety car.
 *
 * `paceMode: 'singleFileStart'` keeps the restart state at SC DEPLOYED rather than
 * RESTART IMMINENT, and a constant gap ahead of 2.4 s keeps the overtake-reminder predicate
 * (|gap| <= 0.4 AND closing >= 0.05 AND speed >= 40) false in every frame, so the silent
 * frame carries no alert chip at all.
 */
const REFERENCE_SPEED_KMH = 96
const REFERENCE_RPM = 3_100
const REFERENCE_MAX_RPM = 7_800
const REFERENCE_POSITION = 6
const REFERENCE_GAP_AHEAD_SEC = 2.4
const REFERENCE_DELTA_TO_BEST_SEC = 1.884
const REFERENCE_BEST_LAP_SEC = 104.617

const NEUTRALISED_FLAGS = Object.freeze({
  green: false,
  yellow: true,
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
 * The restart-imminent scenario: `paceMode` moves to `singleFileRestart`, which raises the
 * RESTART IMMINENT chip in the status header. It holds for at least
 * RC13_RESTART_MIN_VISIBLE_MS (2 000 ms), so the fixture keeps it set from RESTART_FRAMES on.
 */
const WARM_FRAMES = 60
const RESTART_FRAMES = 60 // 60 x 40 ms = 2 400 ms > RC13_RESTART_MIN_VISIBLE_MS
const PLATEAU_FRAMES = 25
const READY_SEQUENCE = WARM_FRAMES + RESTART_FRAMES + PLATEAU_FRAMES

type CaptureState = "silent" | "restart-imminent"

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
  throw new Error("racecon RC-13 capture requires 800x480, 1024x600, 393x759, 412x867, 759x393, or 867x412")
}

function readCaptureState(): CaptureState {
  const state = new URLSearchParams(window.location.search).get("state") ?? "silent"
  if (state === "silent" || state === "restart-imminent") return state
  throw new Error("racecon RC-13 capture requires state=silent or state=restart-imminent")
}

function liveFixture(sequence: number, state: CaptureState): TelemetrySnapshot {
  const restartActive = state === "restart-imminent" && sequence >= WARM_FRAMES
  return {
    sim: "iracing",
    connected: true,
    timestamp: FIXTURE_TIMESTAMP + sequence * FIXTURE_FRAME_MS,
    sessionUniqueId: FIXTURE_SESSION_ID,
    connectionEpoch: FIXTURE_CONNECTION_EPOCH,
    sessionType: "Race",
    sessionState: "racing",
    currentLap: 27,
    playerCarIdx: 9,
    position: REFERENCE_POSITION,
    paceMode: restartActive ? "singleFileRestart" : "singleFileStart",
    raceControlState: "known",
    flags: NEUTRALISED_FLAGS,
    speedKmh: REFERENCE_SPEED_KMH,
    rpm: REFERENCE_RPM,
    maxRpm: REFERENCE_MAX_RPM,
    gear: 3,
    deltaToBestSec: REFERENCE_DELTA_TO_BEST_SEC,
    bestLapTimeSec: REFERENCE_BEST_LAP_SEC,
    relatives: {
      ahead: {
        carIdx: 12,
        name: "ENTRANT 5",
        carNumber: "5",
        position: REFERENCE_POSITION - 1,
        gapSec: REFERENCE_GAP_AHEAD_SEC
      }
    }
  } as TelemetrySnapshot
}

function builtRaceconDashboard(): Dashboard {
  const presets = BUILTIN_PRESETS.filter((candidate) => candidate.id === PRESET_ID)
  if (presets.length !== 1) throw new Error("racecon RC-13 preset must resolve exactly once")
  const dashboard = presets[0].build()
  const fullFrame = dashboard.elements.filter(
    (element) => element.type === "overlaywidget" && element.widgetId === WIDGET_ID
  )
  if (dashboard.width !== 1024 || dashboard.height !== 600 || fullFrame.length !== 1) {
    throw new Error("racecon RC-13 preset must be the unmodified 1024x600 full-frame dashboard")
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
      id="racecon-rc13-capture-root"
      style={rootStyle}
      aria-label="RaceCon RC-13 deterministic visual capture"
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

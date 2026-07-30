import "./harness-stubs"

import { StrictMode, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { BUILTIN_PRESETS, type Dashboard } from "@shared/dashboards"
import type { TelemetrySnapshot } from "@shared/telemetry"
import { DashboardCanvas } from "@renderer/dashboard/DashboardRoot"

const PRESET_ID = "racecon_rc17_dash"
const WIDGET_ID = "raceconRc17Dash"
const FIXTURE_FRAME_MS = 40
const FIXTURE_TIMESTAMP = 6_120_000
const FIXTURE_SESSION_ID = 44
const FIXTURE_CONNECTION_EPOCH = 2
const FIXTURE_SOURCE_ID = "iracing:session:44:connection:2"

/**
 * The approved RC-17 reference state — attempt-005, `rc17-governance-chain-v1.json`
 * (`"externalAttempt": 5, "verdict": "APPROVED"`, `"blockingFailureCount": 0`). Oval pack
 * racing at sustained speed with a car alongside on the driver's LEFT, timing/scoring feed
 * absent (`relatives` and `position` deliberately absent so gap and position dash together
 * while speed keeps a real value from a separate channel).
 *
 * `carLeftRight: 'left'` activates the carAlongside alert with no engage debounce;
 * `radarCars: [one contact]` makes the proximity radar available and gives the clock one
 * contact to plot. Neither the fast-closing nor the three-wide alert fires on this fixture.
 */
const FIXTURE_SPEED_KMH = 291
const FIXTURE_RPM = 6_400
const FIXTURE_MAX_RPM = 8_000
const FIXTURE_GEAR = 4
const FIXTURE_WATER_C = 92
const FIXTURE_SESSION_UNIQUE_ID = 44
const FIXTURE_LAP = 61
const FIXTURE_CAR_IDX = 7

/**
 * Frame budget:
 *   WARM_FRAMES  — establish connection; the carAlongside alert fires from the first accepted
 *                  'left' frame, so no explicit engage period is needed
 *   PLATEAU_FRAMES — stable measurement window after the alert is known to have latched
 *   READY_SEQUENCE — sequence at which data-capture-ready flips to "true"
 */
const WARM_FRAMES = 15
const PLATEAU_FRAMES = 8
const READY_SEQUENCE = WARM_FRAMES + PLATEAU_FRAMES   // = 23

type CaptureState = "silent" | "car-alongside"

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
  throw new Error("racecon RC-17 capture requires 800x480, 1024x600, 393x759, 412x867, 759x393, or 867x412")
}

function readCaptureState(): CaptureState {
  const state = new URLSearchParams(window.location.search).get("state") ?? "silent"
  if (state === "silent" || state === "car-alongside") return state
  throw new Error("racecon RC-17 capture requires state=silent or state=car-alongside")
}

/**
 * A connected, provider-neutral live frame carrying the source identity fields RC-01's ingest
 * buffer requires (`sessionUniqueId`, `connectionEpoch`, `connected`, a monotonic `timestamp`).
 *
 * `relatives` and `position` are deliberately absent — that IS the reference frame's condition,
 * which is why gap ahead and position dash TOGETHER while speed keeps its real value from wheel
 * speed or GPS. Nothing is mirrored or estimated across sources.
 *
 * Silent state: no car alongside (`carLeftRight: 'clear'` is a REAL reporting of nobody there;
 * it is distinguishable from an absent channel). Radar available but empty.
 *
 * Car-alongside state: car on the LEFT, one radar contact at (-3.1, 0.2) metres. The contact
 * falls in the LEFT quadrant (angle ≈ 183.7°) and confirms the spotter channel.
 */
function liveFixture(sequence: number, state: CaptureState): TelemetrySnapshot {
  const alongside = state === "car-alongside"
  return {
    sim: "iracing",
    connected: true,
    timestamp: FIXTURE_TIMESTAMP + sequence * FIXTURE_FRAME_MS,
    sessionUniqueId: FIXTURE_SESSION_UNIQUE_ID,
    connectionEpoch: FIXTURE_CONNECTION_EPOCH,
    sessionType: "Race",
    sessionState: "racing",
    currentLap: FIXTURE_LAP,
    playerCarIdx: FIXTURE_CAR_IDX,
    speedKmh: FIXTURE_SPEED_KMH,
    rpm: FIXTURE_RPM,
    maxRpm: FIXTURE_MAX_RPM,
    gear: FIXTURE_GEAR,
    throttle: 0.98,
    brake: 0,
    clutch: 0,
    waterTempC: FIXTURE_WATER_C,
    carLeftRight: alongside ? "left" : "clear",
    carLeftRightCount: alongside ? 1 : 0,
    radarCars: alongside ? [{ carIdx: 12, relativeX: -3.1, relativeY: 0.2 }] : []
    // `relatives` and `position` are deliberately absent — see note above.
  } as TelemetrySnapshot
}

function builtRaceconDashboard(): Dashboard {
  const presets = BUILTIN_PRESETS.filter((candidate) => candidate.id === PRESET_ID)
  if (presets.length !== 1) throw new Error("racecon RC-17 preset must resolve exactly once")
  const dashboard = presets[0].build()
  const fullFrame = dashboard.elements.filter(
    (element) => element.type === "overlaywidget" && element.widgetId === WIDGET_ID
  )
  if (dashboard.width !== 1024 || dashboard.height !== 600 || fullFrame.length !== 1) {
    throw new Error("racecon RC-17 preset must be the unmodified 1024×600 full-frame dashboard")
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
      id="racecon-rc17-capture-root"
      style={rootStyle}
      aria-label="RaceCon RC-17 deterministic visual capture"
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

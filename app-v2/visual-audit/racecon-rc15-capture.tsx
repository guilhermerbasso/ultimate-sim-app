import "./harness-stubs"

import { StrictMode, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { BUILTIN_PRESETS, type Dashboard } from "@shared/dashboards"
import type { TelemetrySnapshot } from "@shared/telemetry"
import { DashboardCanvas } from "@renderer/dashboard/DashboardRoot"

const PRESET_ID = "racecon_rc15_dash"
const WIDGET_ID = "raceconRc15Dash"
/**
 * 16 ms, not the 40 ms most RaceCon capture fixtures use.
 *
 * RC-15's tightest staleness budget is 20 ms — `RC15_CHANNEL_STALE_MS` gives steering, lateral G
 * and yaw rate the IMU's 20 ms window, because packet 16 names yaw as a source of the computed
 * balance index and the widget binds it to the tightest declared IMU budget
 * (`RC15_PACKET_OMISSIONS.yawChannelRow`). A 40 ms cadence cannot keep a 20 ms channel fresh: the
 * readouts sit permanently on the edge of stale and dash to `--` the moment the machine is under
 * load, taking the balance index and the beam with them. Feeding faster than the tightest budget
 * is what makes the frame deterministic.
 */
const FIXTURE_FRAME_MS = 16
const FIXTURE_TIMESTAMP = 1_411_000
const FIXTURE_SESSION_ID = 41
const FIXTURE_CONNECTION_EPOCH = 3
const FIXTURE_SOURCE_ID = "iracing:session:41:connection:3"

/**
 * The approved RC-15 reference state — attempt-001, re-adjudicated from REJECTED to APPROVED by
 * `rc15-governance-chain-v1.json` ("attempt-001 is therefore re-adjudicated ... and image-qa-v2.md
 * supersedes image-qa-v1.md"). These are the widget's own reference-frame channel values: the front
 * axle reads 428 °C, the rear 391 °C, bias 56.4 % front and the beam tends UNDER, with all three
 * packet section 15 alerts ARMED and SILENT.
 */
const REFERENCE_STEER_DEG = 38
const REFERENCE_LAT_G = 1.32
const REFERENCE_YAW_RAD_S = 0.18
const REFERENCE_LONG_G = -0.4
const REFERENCE_BRAKE_BIAS_PCT = 56.4

/** brakeTempC per corner; RC-15 publishes an axle as the MEAN of its two measured corners. */
const REFERENCE_BRAKE_LF_C = 430
const REFERENCE_BRAKE_RF_C = 426   // (430 + 426) / 2 = 428 °C front
const REFERENCE_BRAKE_LR_C = 393
const REFERENCE_BRAKE_RR_C = 389   // (393 + 389) / 2 = 391 °C rear

/**
 * The brake-overheat scenario. RC15_BRAKE_HOT_LIMIT_C is 500 °C and RC15_BRAKE_HOT_ENGAGE_MS is
 * 2 000 ms, so the FRONT axle alone is driven to 538 °C ((542 + 534) / 2) and held. The rear axle
 * stays at its reference 391 °C, which keeps the alert scope to a single pan and makes the
 * "danger is scoped to the element that owns it" pixel proof meaningful.
 *
 * 538 °C also pegs the ten-cell heat bar: min(10, floor(538 / 50)) = 10, so bar and numeral agree
 * exactly as normative override 8 requires.
 */
const HOT_BRAKE_LF_C = 542
const HOT_BRAKE_RF_C = 534

/**
 * Frame budget, at the 16 ms cadence RC-15's 20 ms IMU budget requires:
 *   WARM_FRAMES  — establish the reference baseline; no alert in either state
 *   HOT_FRAMES   — brake-hot state only: 140 × 16 ms = 2 240 ms > RC15_BRAKE_HOT_ENGAGE_MS (2 000 ms)
 *   PLATEAU      — stable measurement window after the alert latches
 *   READY_SEQUENCE — the sequence at which data-capture-ready flips to "true"
 */
const WARM_FRAMES = 60
const HOT_FRAMES = 140
const PLATEAU_FRAMES = 40
const READY_SEQUENCE = WARM_FRAMES + HOT_FRAMES + PLATEAU_FRAMES   // = 240

type CaptureState = "silent" | "brake-hot"

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
  throw new Error("racecon RC-15 capture requires 800x480, 1024x600, 393x759, 412x867, 759x393, or 867x412")
}

function readCaptureState(): CaptureState {
  const state = new URLSearchParams(window.location.search).get("state") ?? "silent"
  if (state === "silent" || state === "brake-hot") return state
  throw new Error("racecon RC-15 capture requires state=silent or state=brake-hot")
}

/**
 * A connected, provider-neutral live frame carrying the source identity fields the shared RC-01
 * ingest buffer requires (`sessionUniqueId`, `connectionEpoch`, `connected`, a monotonic
 * `timestamp`), so the buffer accepts it as live telemetry rather than mock or replay.
 *
 * The fixture keeps feeding after READY_SEQUENCE so no channel ages past its RC15_CHANNEL_STALE_MS
 * budget — the tightest is 20 ms for steering, lateral G and yaw rate.
 */
function liveFixture(sequence: number, state: CaptureState): TelemetrySnapshot {
  const hot = state === "brake-hot" && sequence >= WARM_FRAMES
  return {
    sim: "iracing",
    connected: true,
    timestamp: FIXTURE_TIMESTAMP + sequence * FIXTURE_FRAME_MS,
    sessionUniqueId: FIXTURE_SESSION_ID,
    connectionEpoch: FIXTURE_CONNECTION_EPOCH,
    sessionType: "Practice",
    sessionState: "racing",
    currentLap: 12,
    playerCarIdx: 4,
    gear: 4,
    rpm: 7_150,
    maxRpm: 8_600,
    speedKmh: 168,
    throttle: 0.2,
    brake: 0.4,
    clutch: 0,
    steerAngleDeg: REFERENCE_STEER_DEG,
    latAccelG: REFERENCE_LAT_G,
    longAccelG: REFERENCE_LONG_G,
    yawRateRadSec: REFERENCE_YAW_RAD_S,
    brakeBiasPct: REFERENCE_BRAKE_BIAS_PCT,
    brakeTempC: {
      lf: hot ? HOT_BRAKE_LF_C : REFERENCE_BRAKE_LF_C,
      rf: hot ? HOT_BRAKE_RF_C : REFERENCE_BRAKE_RF_C,
      lr: REFERENCE_BRAKE_LR_C,
      rr: REFERENCE_BRAKE_RR_C
    }
  } as TelemetrySnapshot
}

function builtRaceconDashboard(): Dashboard {
  const presets = BUILTIN_PRESETS.filter((candidate) => candidate.id === PRESET_ID)
  if (presets.length !== 1) throw new Error("racecon RC-15 preset must resolve exactly once")
  const dashboard = presets[0].build()
  const fullFrame = dashboard.elements.filter(
    (element) => element.type === "overlaywidget" && element.widgetId === WIDGET_ID
  )
  if (dashboard.width !== 1024 || dashboard.height !== 600 || fullFrame.length !== 1) {
    throw new Error("racecon RC-15 preset must be the unmodified 1024x600 full-frame dashboard")
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
      id="racecon-rc15-capture-root"
      style={rootStyle}
      aria-label="RaceCon RC-15 deterministic visual capture"
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

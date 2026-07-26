import "./harness-stubs"

import { StrictMode, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { BUILTIN_PRESETS, type Dashboard } from "@shared/dashboards"
import type { TelemetrySnapshot } from "@shared/telemetry"
import { DashboardCanvas } from "@renderer/dashboard/DashboardRoot"

const PRESET_ID = "racecon_rc05_dash"
const WIDGET_ID = "raceconRc05Dash"
const FIXTURE_FRAME_MS = 40
const FIXTURE_TIMESTAMP = 3_112_000
const FIXTURE_SESSION_ID = 75
const FIXTURE_CONNECTION_EPOCH = 1
const FIXTURE_SOURCE_ID = "iracing:session:75:connection:1"

/**
 * The approved RC-05 reference state, in the exact units the provider reports.
 * Governance attempt-006 adjudicated these values; the harness asserts them rather
 * than sampling pixels from the reference image.
 */
const REFERENCE_SPEED_KMH = 178
const REFERENCE_GEAR = 4
const REFERENCE_DELTA_SEC = 0.137       // positive → data-tone="bad"
const REFERENCE_BEST_LAP_SEC = 104.53
const REFERENCE_TC_LEVEL = 5
const REFERENCE_FUEL_L = 46
const REFERENCE_FUEL_PER_LAP_L = 3.1
const REFERENCE_FUEL_LAPS = 14.8

const REFERENCE_BRAKE_LF_C = 412
const REFERENCE_BRAKE_RF_C = 405
const REFERENCE_BRAKE_LR_C = 388
const REFERENCE_BRAKE_RR_C = 380

const REFERENCE_LF_TEMP_C = 88        // in window: 80–100°C
const REFERENCE_RF_TEMP_C = 94
const REFERENCE_LR_TEMP_C = 85
const REFERENCE_RR_TEMP_C = 86

const REFERENCE_LF_PRESSURE_KPA = 193  // 1.93 bar, in 1.85–2.00 window
const REFERENCE_RF_PRESSURE_KPA = 197  // 1.97 bar
const REFERENCE_LR_PRESSURE_KPA = 190  // 1.90 bar
// RR has no TPMS sensor — pressureKpa is deliberately omitted (Omission 6).

const REFERENCE_LF_WEAR = 0.18
const REFERENCE_RF_WEAR = 0.16
const REFERENCE_LR_WEAR = 0.12
const REFERENCE_RR_WEAR = 0.14

/** LF temp used in the overheat scenario. Must be > 100°C to cross the hot band boundary. */
const ALERT_LF_TEMP_C = 107

/**
 * Frame at which lap 14 advances to lap 15. Two frames with different `currentLap` values
 * are required for `data-rc05-trend` to move from 'pending' to 'measured' (the recorder
 * refuses to write a sample for the first lap it sees, preventing mid-lap truncation).
 */
const LAP_CROSS_FRAME = 5

/**
 * Frame at which the LF temperature rises to ALERT_LF_TEMP_C in the overheat scenario.
 * The overheat latch engages after RC05_OVERHEAT_ENGAGE_MS = 2 000 ms from the first hot
 * frame. At 40 ms per frame that is 50 frames. Starting at frame 20 with a READY_SEQUENCE
 * of 100 gives 80 hot frames = 3 200 ms — well past the threshold.
 */
const OVERHEAT_START_FRAME = 20

/**
 * The fixture publishes `data-capture-ready="true"` only once `sequence >= READY_SEQUENCE`.
 * By that point:
 *   • The ingest buffer has accepted many live frames (`data-rc05-buffer-state="accepted"`).
 *   • The lap boundary has been crossed so `data-rc05-trend="measured"`.
 *   • In the overheat scenario, LF has been at 107°C for 80 × 40 ms = 3 200 ms (> 2 000 ms),
 *     so the overheat latch has engaged and `data-rc05-alerts="active"` is published.
 * After READY_SEQUENCE, the fixture continues advancing the timestamp at FIXTURE_FRAME_MS
 * per committed render, keeping every channel well inside its freshness budget (tyre-temp
 * budget is 200 ms; the fixture delivers a fresh frame every 40 ms).
 */
const READY_SEQUENCE = 100

type CaptureState = "silent" | "corner-overheat"

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
  throw new Error("racecon RC-05 capture requires 800x480, 1024x600, 393x759, 412x867, 759x393, or 867x412")
}

function readCaptureState(): CaptureState {
  const state = new URLSearchParams(window.location.search).get("state") ?? "silent"
  if (state === "silent" || state === "corner-overheat") return state
  throw new Error("racecon RC-05 capture requires state=silent or state=corner-overheat")
}

/**
 * A connected, provider-neutral live frame. It carries no mock scenario import and no replay
 * marker, and supplies the source-identity fields the shared RC-01 ingest buffer requires
 * (`sessionUniqueId`, `connectionEpoch`, `connected`, a monotonic `timestamp`), so the buffer
 * accepts it as live telemetry and `data-rc05-buffer-state` reaches `'accepted'`.
 *
 * The lap number crosses from 14 to 15 at LAP_CROSS_FRAME, giving the trend recorder the two
 * different `currentLap` values it needs to move from 'pending' to 'measured'.
 *
 * In the overheat scenario, LF temp rises to ALERT_LF_TEMP_C at OVERHEAT_START_FRAME and
 * stays there, so the 2 000 ms engage timer fires well before READY_SEQUENCE.
 *
 * After READY_SEQUENCE, the fixture keeps advancing `timestamp` with every committed render
 * rather than freezing. A frozen timestamp would let the tyre-temp channel stale out (budget
 * 200 ms) and blank the temperature numerals; a crawling timestamp keeps all channels fresh.
 */
function liveFixture(sequence: number, state: CaptureState): TelemetrySnapshot {
  const currentLap = sequence >= LAP_CROSS_FRAME ? 15 : 14
  const lfOverheat = state === "corner-overheat" && sequence >= OVERHEAT_START_FRAME
  return {
    sim: "iracing",
    connected: true,
    timestamp: FIXTURE_TIMESTAMP + sequence * FIXTURE_FRAME_MS,
    sessionUniqueId: FIXTURE_SESSION_ID,
    connectionEpoch: FIXTURE_CONNECTION_EPOCH,
    sessionType: "race",
    speedKmh: REFERENCE_SPEED_KMH,
    // A live provider always reports engine speed. RC-05 binds no rpm channel — the packet's
    // optional shift edge cue has no data source — so this feeds nothing and renders nothing.
    rpm: 6_400,
    gear: REFERENCE_GEAR,
    throttle: 0.55,
    brake: 0,
    clutch: 0,
    deltaToBestSec: REFERENCE_DELTA_SEC,
    bestLapTimeSec: REFERENCE_BEST_LAP_SEC,
    tcLevel: REFERENCE_TC_LEVEL,
    tcActive: false,
    fuelLiters: REFERENCE_FUEL_L,
    fuelPerLapLiters: REFERENCE_FUEL_PER_LAP_L,
    fuelLapsRemaining: REFERENCE_FUEL_LAPS,
    currentLap,
    brakeTempC: {
      lf: REFERENCE_BRAKE_LF_C,
      rf: REFERENCE_BRAKE_RF_C,
      lr: REFERENCE_BRAKE_LR_C,
      rr: REFERENCE_BRAKE_RR_C
    },
    tyres: {
      lf: {
        tempC: lfOverheat ? ALERT_LF_TEMP_C : REFERENCE_LF_TEMP_C,
        pressureKpa: REFERENCE_LF_PRESSURE_KPA,
        wearPct: REFERENCE_LF_WEAR
      },
      rf: {
        tempC: REFERENCE_RF_TEMP_C,
        pressureKpa: REFERENCE_RF_PRESSURE_KPA,
        wearPct: REFERENCE_RF_WEAR
      },
      lr: {
        tempC: REFERENCE_LR_TEMP_C,
        pressureKpa: REFERENCE_LR_PRESSURE_KPA,
        wearPct: REFERENCE_LR_WEAR
      },
      rr: {
        // Omission 6: RR has no TPMS sensor. pressureKpa is deliberately absent so the widget
        // shows '--' and omits the pressure-band and pressure-mark SVG elements.
        tempC: REFERENCE_RR_TEMP_C,
        wearPct: REFERENCE_RR_WEAR
      }
    }
  }
}

function builtRaceconDashboard(): Dashboard {
  const presets = BUILTIN_PRESETS.filter((candidate) => candidate.id === PRESET_ID)
  if (presets.length !== 1) throw new Error("racecon RC-05 preset must resolve exactly once")

  const dashboard = presets[0].build()
  const fullFrame = dashboard.elements.filter(
    (element) => element.type === "overlaywidget" && element.widgetId === WIDGET_ID
  )
  if (dashboard.width !== 1024 || dashboard.height !== 600 || fullFrame.length !== 1) {
    throw new Error("racecon RC-05 preset must be the unmodified 1024x600 full-frame dashboard")
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

  // One scripted frame per committed render. Re-arming after each commit prevents React from
  // coalescing two timer ticks into a single render, which would skip a scripted frame and
  // potentially cause a channel to stale out before the next snapshot arrives.
  useEffect(() => {
    const timer = window.setTimeout(() => setSequence((value) => value + 1), FIXTURE_FRAME_MS)
    return () => window.clearTimeout(timer)
  }, [sequence])

  return (
    <div
      id="racecon-rc05-capture-root"
      style={rootStyle}
      aria-label="RaceCon RC-05 deterministic visual capture"
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

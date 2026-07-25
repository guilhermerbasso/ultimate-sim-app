import "./harness-stubs"

import { StrictMode, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { BUILTIN_PRESETS, type Dashboard } from "@shared/dashboards"
import type { TelemetrySnapshot } from "@shared/telemetry"
import { DashboardCanvas } from "@renderer/dashboard/DashboardRoot"

const PRESET_ID = "racecon_rc02_dash"
const WIDGET_ID = "raceconRc02Dash"
const FIXTURE_TIMESTAMP = 20_000
const FIXTURE_FRAME_MS = 40
const FIXTURE_SESSION_ID = 74_002
const FIXTURE_CONNECTION_EPOCH = 9
const FIXTURE_SOURCE_ID = "acc:session:74002:connection:9"

/** The approved RC-02 reference state, in the exact units the provider reports. */
const REFERENCE_BEST_LAP_SEC = 99.548
const REFERENCE_CURRENT_LAP_SEC = 74.372
const REFERENCE_LAP_DIST_PCT = 0.7473
const REFERENCE_DELTA_SEC = -0.284

/**
 * Three scripted laps at the provider cadence. The first is joined mid-track, so the widget
 * refuses to measure a sector whose start it never observed; the second runs start-finish to
 * start-finish and is the first lap that can enter the history ladder; the third is the
 * flying lap, which parks on the approved reference state with sector three still honestly
 * un-crossed. Lap distance stays inside the provider's real [0, 1) range and the lap clock
 * restarts at start-finish, so nothing here feeds a value a live source could not produce.
 */
const LAP_SAMPLE_STEPS = 25
const LAP_SCRIPT = [
  { frames: 24, paceSec: REFERENCE_BEST_LAP_SEC },
  { frames: 24, paceSec: 98.4 },
  { frames: 18, paceSec: 97.6 }
] as const
/** Frames driven before the capture is declared ready; also clears the 400 ms PB-pace debounce. */
const READY_SEQUENCE = 70
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
  throw new Error("racecon RC-02 capture requires 800x480, 1024x600, 393x759, 412x867, 759x393, or 867x412")
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function lapPoint(sequence: number): { lapDistPct: number; currentLapTimeSec: number } {
  let offset = 0
  for (const lap of LAP_SCRIPT) {
    if (sequence < offset + lap.frames) {
      const step = sequence - offset + 1
      return {
        lapDistPct: step / LAP_SAMPLE_STEPS,
        currentLapTimeSec: round3((lap.paceSec * step) / LAP_SAMPLE_STEPS)
      }
    }
    offset += lap.frames
  }
  return { lapDistPct: REFERENCE_LAP_DIST_PCT, currentLapTimeSec: REFERENCE_CURRENT_LAP_SEC }
}

/**
 * A connected, provider-neutral live frame. It deliberately has no mock scenario import and
 * carries the source identity fields the RC-01 ingest buffer requires (`sessionUniqueId`,
 * `connectionEpoch`, `connected` and a monotonic `timestamp`) with no replay marker, so the
 * shared fail-closed buffer accepts it as live telemetry.
 */
function liveFixture(sequence: number): TelemetrySnapshot {
  const lap = lapPoint(sequence)
  return {
    sim: "acc",
    connected: true,
    timestamp: FIXTURE_TIMESTAMP + sequence * FIXTURE_FRAME_MS,
    sessionUniqueId: FIXTURE_SESSION_ID,
    connectionEpoch: FIXTURE_CONNECTION_EPOCH,
    sessionType: "qualifying",
    speedKmh: 214,
    rpm: 8_140,
    maxRpm: 8_600,
    gear: 5,
    throttle: 0.87,
    brake: 0,
    clutch: 0,
    tcLevel: 3,
    position: 1,
    fuelLiters: 24.5,
    bestLapTimeSec: REFERENCE_BEST_LAP_SEC,
    deltaToBestSec: REFERENCE_DELTA_SEC,
    currentLapTimeSec: lap.currentLapTimeSec,
    lapDistPct: lap.lapDistPct,
    pitLimiter: false,
    relatives: { ahead: { carIdx: 9, name: "Ahead", carNumber: "9", gapSec: 0.412 } },
    tyres: {
      lf: { tempC: 78 },
      rf: { tempC: 81 },
      lr: { tempC: 74 },
      rr: { tempC: 76 }
    }
  }
}

function builtRaceconDashboard(): Dashboard {
  const presets = BUILTIN_PRESETS.filter((candidate) => candidate.id === PRESET_ID)
  if (presets.length !== 1) throw new Error("racecon RC-02 preset must resolve exactly once")

  // The capture must exercise the production dashboard object unchanged.
  // DashboardCanvas derives its responsive render model without mutating this
  // stored 1024x600 preset.
  const dashboard = presets[0].build()
  const fullFrame = dashboard.elements.filter((element) => element.type === "overlaywidget" && element.widgetId === WIDGET_ID)
  if (dashboard.width !== 1024 || dashboard.height !== 600 || fullFrame.length !== 1) {
    throw new Error("racecon RC-02 preset must be the unmodified 1024x600 full-frame dashboard")
  }
  return dashboard
}

function RaceconCapture({ size }: { size: CaptureSize }): ReactElement {
  const [sequence, setSequence] = useState(0)
  const snapshot = useMemo(() => liveFixture(sequence), [sequence])
  const dashboard = useMemo(builtRaceconDashboard, [])
  const rootStyle: CSSProperties = {
    width: size.width,
    height: size.height,
    overflow: "hidden",
    background: dashboard.bg,
    color: "#ffffff"
  }

  // One scripted frame per committed render. A repeating interval lets React coalesce two
  // ticks into a single render, which would silently drop a scripted lap-distance sample and
  // change the sector splits the widget measures; re-arming after each commit cannot.
  useEffect(() => {
    const timer = window.setTimeout(() => setSequence((value) => value + 1), FIXTURE_FRAME_MS)
    return () => window.clearTimeout(timer)
  }, [sequence])

  return (
    <div
      id="racecon-rc02-capture-root"
      style={rootStyle}
      aria-label="RaceCon RC-02 deterministic visual capture"
      data-capture-ready={sequence >= READY_SEQUENCE ? "true" : "false"}
      data-capture-sequence={sequence}
      data-capture-preset-id={PRESET_ID}
      data-capture-widget-id={WIDGET_ID}
      data-capture-source-kind="live-telemetry"
      data-capture-source-identity={FIXTURE_SOURCE_ID}
      data-capture-dashboard-width={dashboard.width}
      data-capture-dashboard-height={dashboard.height}
    >
      <DashboardCanvas
        dashboard={dashboard}
        snapshot={snapshot}
        showConnectionStatus={false}
      />
    </div>
  )
}

function CaptureApp(): ReactElement {
  return <RaceconCapture size={readCaptureSize()} />
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <CaptureApp />
  </StrictMode>
)

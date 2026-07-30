import "./harness-stubs"

import { StrictMode, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { BUILTIN_PRESETS, type Dashboard } from "@shared/dashboards"
import type { TelemetrySnapshot } from "@shared/telemetry"
import { DashboardCanvas } from "@renderer/dashboard/DashboardRoot"

const PRESET_ID = "racecon_rc10_dash"
const WIDGET_ID = "raceconRc10Dash"
const FIXTURE_FRAME_MS = 40
const FIXTURE_TIMESTAMP = 5_100_000
const FIXTURE_SESSION_ID = 102
const FIXTURE_CONNECTION_EPOCH = 3
const FIXTURE_SOURCE_ID = "iracing:session:102:connection:3"

/**
 * The approved RC-10 "Clear Sight" silent reference state. Every channel is fresh and inside
 * its resting band so no alert can latch:
 *   fuelLapsRemaining 8.4 > RC10_FUEL_RESERVE_LAPS (3.0)     → no FUEL LOW
 *   waterTempC 92 < RC10 overheat threshold (105)            → no HOT
 *   rpm/maxRpm = 0.72 < the RC-01 over-rev ratio (0.99)      → no OVER REV
 */
const REFERENCE_GEAR = 4
const REFERENCE_SPEED_KMH = 187
const REFERENCE_RPM = 5_616
const REFERENCE_MAX_RPM = 7_800
const REFERENCE_WATER_TEMP_C = 92
const REFERENCE_POSITION = 7
const REFERENCE_TC_LEVEL = 3
const REFERENCE_DELTA_TO_BEST_SEC = -0.284
const REFERENCE_BEST_LAP_SEC = 96.812
const REFERENCE_FUEL_PER_LAP_L = 3.2
const REFERENCE_FUEL_LITERS = 26.88 // → 8.4 laps
const REFERENCE_FUEL_LAPS = 8.4

/**
 * The fuel-low scenario: fuelLapsRemaining at or below RC10_FUEL_RESERVE_LAPS (3.0) raises the
 * alert, which then holds until the value climbs back above 4.0 (the declared +1.0 hysteresis).
 * 2.1 laps is unambiguously inside the reserve.
 */
const FUEL_LOW_LAPS = 2.1
const FUEL_LOW_LITERS = 6.72

const WARM_FRAMES = 60
const LOW_FRAMES = 40
const PLATEAU_FRAMES = 25
const READY_SEQUENCE = WARM_FRAMES + LOW_FRAMES + PLATEAU_FRAMES

type CaptureState = "silent" | "fuel-low"

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
  throw new Error("racecon RC-10 capture requires 800x480, 1024x600, 393x759, 412x867, 759x393, or 867x412")
}

function readCaptureState(): CaptureState {
  const state = new URLSearchParams(window.location.search).get("state") ?? "silent"
  if (state === "silent" || state === "fuel-low") return state
  throw new Error("racecon RC-10 capture requires state=silent or state=fuel-low")
}

function liveFixture(sequence: number, state: CaptureState): TelemetrySnapshot {
  const lowActive = state === "fuel-low" && sequence >= WARM_FRAMES
  return {
    sim: "iracing",
    connected: true,
    timestamp: FIXTURE_TIMESTAMP + sequence * FIXTURE_FRAME_MS,
    sessionUniqueId: FIXTURE_SESSION_ID,
    connectionEpoch: FIXTURE_CONNECTION_EPOCH,
    sessionType: "Race",
    sessionState: "racing",
    currentLap: 18,
    playerCarIdx: 2,
    position: REFERENCE_POSITION,
    gear: REFERENCE_GEAR,
    speedKmh: REFERENCE_SPEED_KMH,
    rpm: REFERENCE_RPM,
    maxRpm: REFERENCE_MAX_RPM,
    waterTempC: REFERENCE_WATER_TEMP_C,
    tcLevel: REFERENCE_TC_LEVEL,
    tcEnabled: true,
    deltaToBestSec: REFERENCE_DELTA_TO_BEST_SEC,
    bestLapTimeSec: REFERENCE_BEST_LAP_SEC,
    fuelPerLapLiters: REFERENCE_FUEL_PER_LAP_L,
    fuelLiters: lowActive ? FUEL_LOW_LITERS : REFERENCE_FUEL_LITERS,
    fuelLapsRemaining: lowActive ? FUEL_LOW_LAPS : REFERENCE_FUEL_LAPS
  } as TelemetrySnapshot
}

function builtRaceconDashboard(): Dashboard {
  const presets = BUILTIN_PRESETS.filter((candidate) => candidate.id === PRESET_ID)
  if (presets.length !== 1) throw new Error("racecon RC-10 preset must resolve exactly once")
  const dashboard = presets[0].build()
  const fullFrame = dashboard.elements.filter(
    (element) => element.type === "overlaywidget" && element.widgetId === WIDGET_ID
  )
  if (dashboard.width !== 1024 || dashboard.height !== 600 || fullFrame.length !== 1) {
    throw new Error("racecon RC-10 preset must be the unmodified 1024x600 full-frame dashboard")
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
      id="racecon-rc10-capture-root"
      style={rootStyle}
      aria-label="RaceCon RC-10 deterministic visual capture"
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

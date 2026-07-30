import "./harness-stubs"

import { StrictMode, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { BUILTIN_PRESETS, type Dashboard } from "@shared/dashboards"
import type { EngineWarnings, TelemetrySnapshot } from "@shared/telemetry"
import { DashboardCanvas } from "@renderer/dashboard/DashboardRoot"

const PRESET_ID = "racecon_rc14_dash"
const WIDGET_ID = "raceconRc14Dash"
const FIXTURE_FRAME_MS = 40
const FIXTURE_TIMESTAMP = 5_140_000
const FIXTURE_SESSION_ID = 146
const FIXTURE_CONNECTION_EPOCH = 8
const FIXTURE_SOURCE_ID = "iracing:session:146:connection:8"

/**
 * The approved RC-14 "Triage" silent reference state: a healthy car with every vital inside
 * RC14_VITAL_RANGE, no engine warning lamp lit and no repair outstanding.
 *
 * Supplying `engineWarnings` and `pit` is what makes the ENGINE, ELECTRICAL and CHASSIS
 * systems MONITORED. The remaining six silhouette zones — AERO, GBX and all four corners —
 * stay permanently unmonitored because the app has no per-zone damage channel
 * (RC14_PACKET_OMISSIONS.perZoneDamageChannel). That is the artifact's contract, not a gap
 * in the fixture, and no amount of telemetry can light them.
 */
const HEALTHY_ENGINE_WARNINGS: EngineWarnings = Object.freeze({
  waterTemp: false,
  fuelPressure: false,
  oilPressure: false,
  oilTemp: false,
  stalled: false,
  // Operating lamps, not faults: RC-14 excludes both from the fault model entirely.
  pitLimiter: false,
  revLimiter: false,
  mandRepair: false,
  optRepair: false
})

const HEALTHY_FLAGS = Object.freeze({
  green: true,
  yellow: false,
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

/** Vitals inside RC14_VITAL_RANGE: oil 2..8 bar, water 60..110 degC, battery 11.5..15.5 V. */
const REFERENCE_OIL_PRESSURE_KPA = 480 // 4.8 bar
const REFERENCE_WATER_TEMP_C = 89
const REFERENCE_VOLTAGE = 13.8
const REFERENCE_OIL_TEMP_C = 108

const REFERENCE_BRAKE_TEMP = Object.freeze({ lf: 486, rf: 471, lr: 362, rr: 358 })
const REFERENCE_TYRE_PRESSURE_KPA = Object.freeze({ lf: 172, rf: 174, lr: 166, rr: 168 })

/**
 * The critical-fault scenario: the oil-pressure warning lamp lit continuously for longer than
 * RC14_ALERT_ENGAGE_MS.criticalFault (1 000 ms) latches CRITICAL on the ENGINE row, tints the
 * ENG silhouette zone and drives the decision banner to PIT.
 */
const CRITICAL_ENGINE_WARNINGS: EngineWarnings = Object.freeze({
  ...HEALTHY_ENGINE_WARNINGS,
  oilPressure: true
})
const CRITICAL_OIL_PRESSURE_KPA = 90 // 0.9 bar — also outside the vital range

const WARM_FRAMES = 60
const CRITICAL_FRAMES = 40 // 40 x 40 ms = 1 600 ms > RC14_ALERT_ENGAGE_MS.criticalFault
const PLATEAU_FRAMES = 25
const READY_SEQUENCE = WARM_FRAMES + CRITICAL_FRAMES + PLATEAU_FRAMES

type CaptureState = "silent" | "critical-fault"

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
  throw new Error("racecon RC-14 capture requires 800x480, 1024x600, 393x759, 412x867, 759x393, or 867x412")
}

function readCaptureState(): CaptureState {
  const state = new URLSearchParams(window.location.search).get("state") ?? "silent"
  if (state === "silent" || state === "critical-fault") return state
  throw new Error("racecon RC-14 capture requires state=silent or state=critical-fault")
}

function liveFixture(sequence: number, state: CaptureState): TelemetrySnapshot {
  const criticalActive = state === "critical-fault" && sequence >= WARM_FRAMES
  return {
    sim: "iracing",
    connected: true,
    timestamp: FIXTURE_TIMESTAMP + sequence * FIXTURE_FRAME_MS,
    sessionUniqueId: FIXTURE_SESSION_ID,
    connectionEpoch: FIXTURE_CONNECTION_EPOCH,
    sessionType: "Race",
    sessionState: "racing",
    currentLap: 31,
    playerCarIdx: 5,
    position: 8,
    engineWarnings: criticalActive ? CRITICAL_ENGINE_WARNINGS : HEALTHY_ENGINE_WARNINGS,
    flags: HEALTHY_FLAGS,
    pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: true, inPitStall: false },
    repairTimeSec: 0,
    optionalRepairTimeSec: 0,
    oilPressureKpa: criticalActive ? CRITICAL_OIL_PRESSURE_KPA : REFERENCE_OIL_PRESSURE_KPA,
    waterTempC: REFERENCE_WATER_TEMP_C,
    voltage: REFERENCE_VOLTAGE,
    oilTempC: REFERENCE_OIL_TEMP_C,
    brakeTempC: { ...REFERENCE_BRAKE_TEMP },
    tyres: {
      lf: { pressureKpa: REFERENCE_TYRE_PRESSURE_KPA.lf },
      rf: { pressureKpa: REFERENCE_TYRE_PRESSURE_KPA.rf },
      lr: { pressureKpa: REFERENCE_TYRE_PRESSURE_KPA.lr },
      rr: { pressureKpa: REFERENCE_TYRE_PRESSURE_KPA.rr }
    }
  } as TelemetrySnapshot
}

function builtRaceconDashboard(): Dashboard {
  const presets = BUILTIN_PRESETS.filter((candidate) => candidate.id === PRESET_ID)
  if (presets.length !== 1) throw new Error("racecon RC-14 preset must resolve exactly once")
  const dashboard = presets[0].build()
  const fullFrame = dashboard.elements.filter(
    (element) => element.type === "overlaywidget" && element.widgetId === WIDGET_ID
  )
  if (dashboard.width !== 1024 || dashboard.height !== 600 || fullFrame.length !== 1) {
    throw new Error("racecon RC-14 preset must be the unmodified 1024x600 full-frame dashboard")
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
      id="racecon-rc14-capture-root"
      style={rootStyle}
      aria-label="RaceCon RC-14 deterministic visual capture"
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

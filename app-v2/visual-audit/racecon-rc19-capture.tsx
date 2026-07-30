import "./harness-stubs"

import { StrictMode, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { BUILTIN_PRESETS, type Dashboard } from "@shared/dashboards"
import type { TelemetrySnapshot } from "@shared/telemetry"
import { DashboardCanvas } from "@renderer/dashboard/DashboardRoot"
import { RC19_CONFIRM_EVENT } from "@renderer/overlay/widgets/raceconRc19Core"

const PRESET_ID = "racecon_rc19_dash"
const WIDGET_ID = "raceconRc19Dash"
const FIXTURE_FRAME_MS = 40
const FIXTURE_TIMESTAMP = 6_120_000
const FIXTURE_SESSION_ID = 91
const FIXTURE_CONNECTION_EPOCH = 7
const FIXTURE_SOURCE_ID = "iracing:session:91:connection:7"

/**
 * The three governed capture states.
 *
 *  cold-mount — a mid-stint mount where the stint tracker has never observed a pit exit, so
 *    `STINT LAPS` honestly dashes. The safety alert is active because all six checklist items
 *    are PENDING and the car is stationary in its box.
 *
 *  handover — same initial DOM state as cold-mount, captured to exercise the alert-strip
 *    geometry contract (RC19_COMPACT_ALERT_FLOOR_PCT reservation). The same reference telemetry
 *    is used so the alert strip carries the single SAFETY ITEM UNCONFIRMED key.
 *
 *  ready — the approved silent frame: SEAT, BELTS, WHEEL and RADIO confirmed by crew macro
 *    events, leaving DRINKS and MIRRORS as 2 OUTSTANDING. The stint boundary is marked by an
 *    observed pit exit so STINT LAPS reads 28. The safety alert clears the moment both critical
 *    items are confirmed, so `alerts="silent"`.
 */
type CaptureState = "cold-mount" | "handover" | "ready"

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
  throw new Error("racecon RC-19 capture requires 800x480, 1024x600, 393x759, 412x867, 759x393, or 867x412")
}

function readCaptureState(): CaptureState {
  const state = new URLSearchParams(window.location.search).get("state") ?? "cold-mount"
  if (state === "cold-mount" || state === "handover" || state === "ready") return state
  throw new Error("racecon RC-19 capture requires state=cold-mount, state=handover, or state=ready")
}

/**
 * Frame budgets for the three governed states:
 *   PIT_IN_FRAMES   — frames feeding completedLaps=0 while inPitStall=true (ready only),
 *                     establishing lastInBox=true so the pit-exit transition can fire.
 *   PIT_EXIT_FRAME  — the single frame where inPitStall flips to false; the tracker marks
 *                     startCounter=0 here, so later completedLaps=28 gives stintLaps=28.
 *   CONFIRM_FRAME   — frame on which the four crew macro events are dispatched (ready only).
 *   READY_SEQUENCE  — frame at which data-capture-ready flips to "true".
 */
const PIT_IN_FRAMES = 4
const PIT_EXIT_FRAME = 4
const CONFIRM_FRAME = 8
const READY_SEQUENCE = 25

/** The four items confirmed in the approved ready frame; DRINKS and MIRRORS stay PENDING. */
const CONFIRM_ITEMS = ["SEAT", "BELTS", "WHEEL", "RADIO"] as const

/**
 * The reference telemetry — the approved RC-19 attempt-003 800x480 frame. A connected, live
 * iRacing frame with the car stationary in its pit stall, three TPMS corners reporting (RR has
 * no pressureKpa by design so that corner dashes). All three packet section 15 alerts are armed
 * and the fixture drives them to the target state for each governed scenario.
 */
function liveFixture(sequence: number, state: CaptureState): TelemetrySnapshot {
  const base = {
    sim: "iracing",
    connected: true,
    timestamp: FIXTURE_TIMESTAMP + sequence * FIXTURE_FRAME_MS,
    sessionUniqueId: FIXTURE_SESSION_ID,
    connectionEpoch: FIXTURE_CONNECTION_EPOCH,
    sessionType: "Race",
    sessionState: "racing",
    currentLap: 29,
    completedLaps: 28,
    position: 4,
    playerCarIdx: 7,
    tcLevel: 4,
    fuelLiters: 37.04,
    fuelPerLapLiters: 2.94,
    fuelLapsRemaining: 12.6,
    waterTempC: 88,
    voltage: 13.4,
    damagePct: 0,
    engineWarnings: {
      waterTemp: false,
      fuelPressure: false,
      oilPressure: false,
      oilTemp: false,
      stalled: false,
      pitLimiter: true,
      revLimiter: false,
      mandRepair: false,
      optRepair: false
    },
    onPitRoad: true,
    pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: true, inPitStall: true },
    tyres: {
      lf: { pressureKpa: 194 },
      rf: { pressureKpa: 197 },
      lr: { pressureKpa: 191 },
      rr: {}  // no pressureKpa: RR is the one that dashes
    }
  } as TelemetrySnapshot

  if (state !== "ready") {
    // cold-mount and handover: drive the reference snapshot without a pit exit sequence,
    // so the stint tracker remains unmarked and STINT LAPS stays "--" throughout.
    return base
  }

  // ready sequence: drive completedLaps=0 + inPitStall=true until the exit frame, then
  // flip inPitStall=false so the tracker marks startCounter=0. Subsequent frames carry
  // completedLaps=28, giving stintLaps = 28 − 0 = 28.
  if (sequence < PIT_IN_FRAMES) {
    return { ...base, completedLaps: 0, pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: true, inPitStall: true } }
  }
  if (sequence === PIT_EXIT_FRAME) {
    return {
      ...base,
      completedLaps: 0,
      onPitRoad: false,
      pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: true, inPitStall: false }
    }
  }
  // Frames after the pit exit: reference snapshot with completedLaps=28 and inPitStall=true.
  return base
}

function builtRaceconDashboard(): Dashboard {
  const presets = BUILTIN_PRESETS.filter((candidate) => candidate.id === PRESET_ID)
  if (presets.length !== 1) throw new Error("racecon RC-19 preset must resolve exactly once")
  const dashboard = presets[0].build()
  const fullFrame = dashboard.elements.filter(
    (element) => element.type === "overlaywidget" && element.widgetId === WIDGET_ID
  )
  if (dashboard.width !== 1024 || dashboard.height !== 600 || fullFrame.length !== 1) {
    throw new Error("racecon RC-19 preset must be the unmodified 1024x600 full-frame dashboard")
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

  // Dispatch the four crew confirmations on the exact frame the ready sequence targets.
  // The widget listens on window for RC19_CONFIRM_EVENT (RC-01 GAP-1 contract); the board
  // state update that follows will clear the safety alert on the next render cycle so that
  // data-rc19-alerts="silent" and data-rc19-outstanding="2" appear before READY_SEQUENCE.
  useEffect(() => {
    if (state !== "ready" || sequence !== CONFIRM_FRAME) return
    for (const item of CONFIRM_ITEMS) {
      window.dispatchEvent(new CustomEvent(RC19_CONFIRM_EVENT, { detail: item }))
    }
  }, [sequence, state])

  return (
    <div
      id="racecon-rc19-capture-root"
      style={rootStyle}
      aria-label="RaceCon RC-19 deterministic visual capture"
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

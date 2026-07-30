import "./harness-stubs"

import { StrictMode, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { BUILTIN_PRESETS, type Dashboard } from "@shared/dashboards"
import type { TelemetrySnapshot } from "@shared/telemetry"
import { DashboardCanvas } from "@renderer/dashboard/DashboardRoot"

const PRESET_ID = "racecon_rc20_dash"
const WIDGET_ID = "raceconRc20Dash"
const FIXTURE_FRAME_MS = 40
const FIXTURE_TIMESTAMP = 6_120_000
const FIXTURE_SESSION_ID = 91
const FIXTURE_CONNECTION_EPOCH = 3
const FIXTURE_SOURCE_ID = "iracing:session:91:connection:3"

/**
 * The approved RC-20 reference state — attempt-003, approved by `rc20-governance-chain-v1.json`
 * (`"verdict": "APPROVED"`, `"decision": "attempt-003 - the only frame in the run with zero
 * blocking failures"`). Title: "Lights Out - Formation, Grid & Start Procedure".
 * Channel values from the widget's own reference snapshot: mode=GRID, stage=S5, lit-bars=5,
 * alerts=silent, rpm=4,820, maxRpm=7,600, clutch=42 %, gear=1, throttle=55 %, position=7.
 * Attempts 001–006 exist; 003 is approved, not 006.
 */

/**
 * RC20_IRACING_START_BITS.startSet = 0x4000_0000. `startSet` maps to stage S5 because "set"
 * IS the fully built ladder per the decoder contract; `S1`–`S4` are never decoded.
 */
const FIXTURE_START_SET_FLAGS = 0x4000_0000

/**
 * Frame budget:
 *   WARM_FRAMES      — establish the reference baseline: stage=S5, mode=GRID, alerts=silent
 *   JUMP_FRAMES      — speed raised to 5 km/h (≥ RC20_JUMP_START_SPEED_KMH = 1);
 *                      5 frames × 40 ms = 200 ms >> RC20_JUMP_START_ENGAGE_MS = 80 ms,
 *                      so the jump-start debounce fires well within the budget
 *   PLATEAU_FRAMES   — stable measurement window after the grid state settles
 *   READY_GRID       — data-capture-ready threshold for the grid state (85 frames)
 *   READY_JUMP_START — data-capture-ready threshold for the jump-start state (75 frames)
 *   READY_NO_FEED    — data-capture-ready threshold for the no-feed state (30 frames);
 *                      start-feed=unavailable resolves immediately from sessionFlagsRaw=0
 */
const WARM_FRAMES = 60
const JUMP_FRAMES = 5
const PLATEAU_FRAMES = 25
const READY_GRID = WARM_FRAMES + PLATEAU_FRAMES          // 85
const READY_JUMP_START = WARM_FRAMES + JUMP_FRAMES + 10  // 75
const READY_NO_FEED = 30

type CaptureState = "grid" | "jump-start" | "no-feed"

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
  throw new Error("racecon RC-20 capture requires 800x480, 1024x600, 393x759, 412x867, 759x393, or 867x412")
}

function readCaptureState(): CaptureState {
  const state = new URLSearchParams(window.location.search).get("state") ?? "grid"
  if (state === "grid" || state === "jump-start" || state === "no-feed") return state
  throw new Error("racecon RC-20 capture requires state=grid, state=jump-start, or state=no-feed")
}

function readyCaptureSequence(state: CaptureState): number {
  if (state === "grid") return READY_GRID
  if (state === "jump-start") return READY_JUMP_START
  return READY_NO_FEED
}

/**
 * A connected, provider-neutral live frame carrying the source identity fields the shared RC-01
 * ingest buffer requires. The fixture keeps feeding after the ready sequence so no channel ages
 * past its freshness budget (the clutch budget is RC20_TRANSPORT_FLOOR_MS = 100 ms, the
 * tightest in the artifact).
 *
 * Three governed states:
 *   grid       — approved reference: sessionFlagsRaw=startSet → stage=S5, mode=GRID, alerts=silent
 *   jump-start — same, but speedKmh=5 (≥ RC20_JUMP_START_SPEED_KMH=1) after WARM_FRAMES;
 *                held 200 ms >> RC20_JUMP_START_ENGAGE_MS=80 ms → alerts=active, alert-keys="JUMP START"
 *   no-feed    — sessionFlagsRaw=0 → stage=unavailable, start-feed=unavailable, lit-bars=0;
 *                the "never simulate start lights" rule: all five bars must be dark
 */
function liveFixture(sequence: number, state: CaptureState): TelemetrySnapshot {
  const inJump = state === "jump-start" && sequence >= WARM_FRAMES
  const hasFeed = state !== "no-feed"
  return {
    sim: "iracing",
    connected: true,
    timestamp: FIXTURE_TIMESTAMP + sequence * FIXTURE_FRAME_MS,
    sessionUniqueId: FIXTURE_SESSION_ID,
    connectionEpoch: FIXTURE_CONNECTION_EPOCH,
    sessionType: "Race",
    sessionState: "getInCar",
    currentLap: 0,
    playerCarIdx: 3,
    position: 7,
    rpm: 4_820,
    maxRpm: 7_600,
    gear: 1,
    throttle: 0.55,
    brake: 0,
    clutch: 0.42,
    speedKmh: inJump ? 5 : 0,
    sessionFlagsRaw: hasFeed ? FIXTURE_START_SET_FLAGS : 0,
    waterTempC: 84,
    fuelLiters: 96.4,
    tyres: {
      lf: { tempC: 88 },
      rf: { tempC: 86 },
      lr: { tempC: 84 },
      rr: {}
    },
    brakeTempC: { lf: 470, rf: 460, lr: 415, rr: 405 }
  } as TelemetrySnapshot
}

function builtRaceconDashboard(): Dashboard {
  const presets = BUILTIN_PRESETS.filter((candidate) => candidate.id === PRESET_ID)
  if (presets.length !== 1) throw new Error("racecon RC-20 preset must resolve exactly once")
  const dashboard = presets[0].build()
  const fullFrame = dashboard.elements.filter(
    (element) => element.type === "overlaywidget" && element.widgetId === WIDGET_ID
  )
  if (dashboard.width !== 1024 || dashboard.height !== 600 || fullFrame.length !== 1) {
    throw new Error("racecon RC-20 preset must be the unmodified 1024x600 full-frame dashboard")
  }
  return dashboard
}

function RaceconCapture({ size, state }: { size: CaptureSize; state: CaptureState }): ReactElement {
  const [sequence, setSequence] = useState(0)
  const snapshot = useMemo(() => liveFixture(sequence, state), [sequence, state])
  const dashboard = useMemo(builtRaceconDashboard, [])
  const readyAt = useMemo(() => readyCaptureSequence(state), [state])
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
      id="racecon-rc20-capture-root"
      style={rootStyle}
      aria-label="RaceCon RC-20 deterministic visual capture"
      data-capture-ready={sequence >= readyAt ? "true" : "false"}
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

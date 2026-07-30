import "./harness-stubs"

import { StrictMode, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { BUILTIN_PRESETS, type Dashboard } from "@shared/dashboards"
import type { DriverEntry, TelemetrySnapshot } from "@shared/telemetry"
import { DashboardCanvas } from "@renderer/dashboard/DashboardRoot"

const PRESET_ID = "racecon_rc12_dash"
const WIDGET_ID = "raceconRc12Dash"
const FIXTURE_FRAME_MS = 40
const FIXTURE_TIMESTAMP = 5_120_000
const FIXTURE_SESSION_ID = 124
const FIXTURE_CONNECTION_EPOCH = 6
const FIXTURE_SOURCE_ID = "iracing:session:124:connection:6"

/**
 * RC-12 "On Air" is driven ENTIRELY by the standings feed. With no `drivers` the widget sits
 * honestly on NO TIMING SOURCE, so a fixture that omitted the feed would capture the empty
 * state at every viewport and prove nothing about the board.
 *
 * The fixture therefore supplies a full eight-car field. The player sits at P5 — the position
 * the approved reference highlights — and `relatives` names the cars immediately ahead (P4)
 * and behind (P6), which is the only pair RC-12 can measure a real gap across. Everything else
 * dashes, which is the documented `fieldWideIntervalChannel` omission rather than a defect.
 */
const FIELD_SIZE = 8
const PLAYER_POSITION = 5
const PLAYER_CAR_IDX = 14

/** Deterministic per-position last-lap times. P5 is the player; P2 holds the session best. */
const LAST_LAP_SEC = Object.freeze([98.412, 97.884, 98.201, 98.664, 98.109, 99.02, 99.518, 100.244])
const BEST_LAP_SEC = Object.freeze([98.02, 97.61, 97.994, 98.31, 97.905, 98.74, 99.18, 99.86])

/** The fastest-lap scenario: P7 posts a lap below the running session best (97.884). */
const FASTEST_LAP_POSITION = 7
const FASTEST_LAP_SEC = 97.106

const GAP_AHEAD_SEC = 0.842
const GAP_BEHIND_SEC = 1.317

const WARM_FRAMES = 60
const FASTEST_FRAMES = 20
const PLATEAU_FRAMES = 20
const READY_SEQUENCE = WARM_FRAMES + FASTEST_FRAMES + PLATEAU_FRAMES

type CaptureState = "silent" | "fastest-lap"

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
  throw new Error("racecon RC-12 capture requires 800x480, 1024x600, 393x759, 412x867, 759x393, or 867x412")
}

function readCaptureState(): CaptureState {
  const state = new URLSearchParams(window.location.search).get("state") ?? "silent"
  if (state === "silent" || state === "fastest-lap") return state
  throw new Error("racecon RC-12 capture requires state=silent or state=fastest-lap")
}

function carIdxForPosition(position: number): number {
  return position === PLAYER_POSITION ? PLAYER_CAR_IDX : 20 + position
}

function timingField(sequence: number, state: CaptureState): DriverEntry[] {
  const fastestActive = state === "fastest-lap" && sequence >= WARM_FRAMES
  const drivers: DriverEntry[] = []
  for (let position = 1; position <= FIELD_SIZE; position += 1) {
    const index = position - 1
    const isFastestCar = fastestActive && position === FASTEST_LAP_POSITION
    drivers.push({
      carIdx: carIdxForPosition(position),
      // Section 20 forbids real entrants and RC-12 never prints identity, so the fixture uses
      // neutral placeholders. The widget renders its own CAR -- badge regardless.
      name: `ENTRANT ${position}`,
      carNumber: String(position),
      position,
      classPosition: position,
      classId: 1,
      isPlayer: position === PLAYER_POSITION,
      isPaceCar: false,
      lastLapTimeSec: isFastestCar ? FASTEST_LAP_SEC : LAST_LAP_SEC[index],
      bestLapTimeSec: isFastestCar ? FASTEST_LAP_SEC : BEST_LAP_SEC[index]
    })
  }
  return drivers
}

function liveFixture(sequence: number, state: CaptureState): TelemetrySnapshot {
  return {
    sim: "iracing",
    connected: true,
    timestamp: FIXTURE_TIMESTAMP + sequence * FIXTURE_FRAME_MS,
    sessionUniqueId: FIXTURE_SESSION_ID,
    connectionEpoch: FIXTURE_CONNECTION_EPOCH,
    sessionType: "Race",
    sessionState: "racing",
    currentLap: 22,
    position: PLAYER_POSITION,
    playerCarIdx: PLAYER_CAR_IDX,
    drivers: timingField(sequence, state),
    relatives: {
      ahead: {
        carIdx: carIdxForPosition(PLAYER_POSITION - 1),
        name: `ENTRANT ${PLAYER_POSITION - 1}`,
        carNumber: String(PLAYER_POSITION - 1),
        position: PLAYER_POSITION - 1,
        gapSec: GAP_AHEAD_SEC,
        lastLapTimeSec: LAST_LAP_SEC[PLAYER_POSITION - 2]
      },
      behind: {
        carIdx: carIdxForPosition(PLAYER_POSITION + 1),
        name: `ENTRANT ${PLAYER_POSITION + 1}`,
        carNumber: String(PLAYER_POSITION + 1),
        position: PLAYER_POSITION + 1,
        gapSec: GAP_BEHIND_SEC,
        lastLapTimeSec: LAST_LAP_SEC[PLAYER_POSITION]
      }
    }
  } as TelemetrySnapshot
}

function builtRaceconDashboard(): Dashboard {
  const presets = BUILTIN_PRESETS.filter((candidate) => candidate.id === PRESET_ID)
  if (presets.length !== 1) throw new Error("racecon RC-12 preset must resolve exactly once")
  const dashboard = presets[0].build()
  const fullFrame = dashboard.elements.filter(
    (element) => element.type === "overlaywidget" && element.widgetId === WIDGET_ID
  )
  if (dashboard.width !== 1024 || dashboard.height !== 600 || fullFrame.length !== 1) {
    throw new Error("racecon RC-12 preset must be the unmodified 1024x600 full-frame dashboard")
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
      id="racecon-rc12-capture-root"
      style={rootStyle}
      aria-label="RaceCon RC-12 deterministic visual capture"
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

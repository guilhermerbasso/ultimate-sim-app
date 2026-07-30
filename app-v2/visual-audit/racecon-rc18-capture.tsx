import "./harness-stubs"

import { StrictMode, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { BUILTIN_PRESETS, type Dashboard } from "@shared/dashboards"
import type { Corners, TelemetrySnapshot } from "@shared/telemetry"
import { DashboardCanvas } from "@renderer/dashboard/DashboardRoot"

const PRESET_ID = "racecon_rc18_dash"
const WIDGET_ID = "raceconRc18Dash"
const FIXTURE_FRAME_MS = 40
const FIXTURE_TIMESTAMP = 2_200_000
const FIXTURE_SESSION_ID = 18
const FIXTURE_CONNECTION_EPOCH = 1
const FIXTURE_SOURCE_ID = "iracing:session:18:connection:1"

/**
 * The approved RC-18 reference state — attempt-004, re-adjudicated as the governing frame by
 * `rc18-governance-chain-v1.json` after attempts 005 and 006 both regressed.
 *
 * Setup A is the older archived lap (locked baseline), Setup B is the newer. The reference frame
 * has two sector-gap alerts (S2 and S3 exceed 0.050 s), one incomparable row (brakeRear: Setup B
 * carries no rear-right brake sensor), and both S1 and stability SILENT.
 *
 * The matched state provides two laps whose all three sector deltas are below the 0.050 s noise
 * floor, every compared row present on both sides, and balance within the 0.15 band.
 */

// ---------------------------------------------------------------- sector boundaries (RC-02 values)
const S1_BOUNDARY = 1 / 3   // 0.33333…
const S2_BOUNDARY = 2 / 3   // 0.66666…

// ----------------------------------------------------------------- balance sample parameters
const BALANCE_STEER_DEG = 10
const BALANCE_STEER_RAD = (BALANCE_STEER_DEG * Math.PI) / 180
const BALANCE_EXTRAS_COUNT = 33  // 32 gain samples + 1 min-speed marker

// ----------------------------------------------------------------- reference state channels
const REF_SECTORS_A = [31.441, 44.907, 28.615] as const
const REF_SECTORS_B = [31.482, 44.639, 28.456] as const
const REF_TYRES_A = { lf: { tempC: 84 }, rf: { tempC: 86 }, lr: { tempC: 79 }, rr: { tempC: 81 } }
const REF_TYRES_B = { lf: { tempC: 88 }, rf: { tempC: 90 }, lr: { tempC: 83 }, rr: { tempC: 85 } }
// Setup B deliberately omits brakeTempC.rr, which drives rc18AxlePeakC(brakePeakC,'rear')→null
// and makes brakeRear INCOMPARABLE. Absence-is-the-contract: rc18AxlePeakC requires BOTH corners.
const REF_BRAKES_A = { lf: 412, rf: 408, lr: 388, rr: 384 }
const REF_BRAKES_B_PARTIAL = { lf: 405, rf: 401, lr: 388 }   // rr absent → incomparable brakeRear
const REF_DELTA_A = 0.121
const REF_DELTA_B = -0.265
const REF_BEST_LAP = 104.842
const REF_MIN_SPEED_A = 97
const REF_MIN_SPEED_B = 103
// Balance gains: Setup A index ≈ (1−0.58)/1 = 0.42, Setup B ≈ (1−0.69)/1 = 0.31
const REF_SLOW_GAIN_A = 1
const REF_FAST_GAIN_A = 0.58
const REF_SLOW_GAIN_B = 1
const REF_FAST_GAIN_B = 0.69

// --------------------------------------------------------------- matched state channels
// All three sector deltas < RC18_SECTOR_NOISE_SEC (0.050 s); every brake corner present; balance Δ < 0.15
const MATCH_SECTORS_A = [31.010, 44.010, 28.010] as const
const MATCH_SECTORS_B = [31.020, 44.020, 28.020] as const
const MATCH_TYRES_A = { lf: { tempC: 84 }, rf: { tempC: 86 }, lr: { tempC: 79 }, rr: { tempC: 81 } }
const MATCH_TYRES_B = { lf: { tempC: 85 }, rf: { tempC: 87 }, lr: { tempC: 80 }, rr: { tempC: 82 } }
const MATCH_BRAKES_A = { lf: 410, rf: 406, lr: 387, rr: 382 }
const MATCH_BRAKES_B = { lf: 408, rf: 404, lr: 386, rr: 380 }
const MATCH_DELTA_A = 0.100
const MATCH_DELTA_B = 0.110
const MATCH_BEST_LAP = 103.040
const MATCH_MIN_SPEED_A = 95
const MATCH_MIN_SPEED_B = 96
// Balance gains: Lap A index ≈ (1−0.60)/1 = 0.40, Lap B ≈ (1−0.65)/1 = 0.35, Δ = 0.05 < 0.15
const MATCH_SLOW_GAIN_A = 1
const MATCH_FAST_GAIN_A = 0.60
const MATCH_SLOW_GAIN_B = 1
const MATCH_FAST_GAIN_B = 0.65

/**
 * Frame budget. The fixture drives four lap plans through the Rc18RunRecorder:
 *
 *   out-lap  (4 frames)  — unarchivable: the tracker never archives a lap whose first sample
 *                          arrived without a prior start-finish context (joined-mid-track rule).
 *   lap A    (37 frames) — archived when lap B starts (frame 41 triggers the archive).
 *   lap B    (37 frames) — archived when the closing lap starts (frame 78 triggers the archive).
 *   closing  (5 frames)  — provides the start-finish crossing that archives lap B.
 *   plateau  (30 frames) — stable window so alerts have time to latch and publish.
 *
 * READY_SEQUENCE is set past the end of the plan so the plateau guarantees both laps are archived
 * and the widget has committed at least one full render with the advanced alert state before the
 * shared driver collects metrics.
 */
const OUT_FRAMES = 4
const LAP_FRAMES = 37   // 1 start + 33 extras (32 balance + 1 minSpeed) + 3 crossings
const CLOSE_FRAMES = 5
const PLATEAU_FRAMES = 30
const PLAN_TOTAL = OUT_FRAMES + 2 * LAP_FRAMES + CLOSE_FRAMES   // = 83
const READY_SEQUENCE = PLAN_TOTAL + PLATEAU_FRAMES               // = 113

type CaptureState = "reference" | "matched"

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
  if (width === 800  && height === 480) return { width, height }
  if (width === 1024 && height === 600) return { width, height }
  if (width === 393  && height === 759) return { width, height }
  if (width === 412  && height === 867) return { width, height }
  if (width === 759  && height === 393) return { width, height }
  if (width === 867  && height === 412) return { width, height }
  throw new Error("racecon RC-18 capture requires 800x480, 1024x600, 393x759, 412x867, 759x393, or 867x412")
}

function readCaptureState(): CaptureState {
  const state = new URLSearchParams(window.location.search).get("state") ?? "reference"
  if (state === "reference" || state === "matched") return state
  throw new Error("racecon RC-18 capture requires state=reference or state=matched")
}

/**
 * Generates the balance gain samples that cause the recorder to compute the target balance index.
 * The formula is: index = (gainSlow - gainFast) / gainSlow, clamped to [-1, 1].
 *
 * Half the samples are at slow speed (60–67 km/h) with slowGain; the other half are at fast speed
 * (120–127 km/h) with fastGain. The yawRateRadSec is back-computed from the gain formula so the
 * accumulator's measured index converges to the approved reference frame's value.
 *
 * The extras array follows the same interpolation formula as the widget test's `driveLaps` helper,
 * which is the ground-truth driver for every approved reference value.
 */
function buildExtras(
  slowGain: number,
  fastGain: number,
  s1: number,
  minSpeed: number
): Array<{ speedKmh: number; steerAngleDeg: number; yawRateRadSec: number; lapDistFrac: number; lapTimeFrac: number }> {
  const extras: ReturnType<typeof buildExtras> = []
  for (let i = 0; i < BALANCE_EXTRAS_COUNT; i++) {
    const isBalance = i < 32
    const fraction = (i + 1) / (BALANCE_EXTRAS_COUNT + 1)
    const lapDistFrac = 0.005 + fraction * 0.3
    const lapTimeFrac = 0.01 + fraction * s1 * 0.9  // seconds
    if (!isBalance) {
      // minSpeed marker: no steering, just the measured minimum cornering speed
      extras.push({ speedKmh: minSpeed, steerAngleDeg: 0, yawRateRadSec: 0, lapDistFrac, lapTimeFrac })
    } else {
      const slow = i < 16
      const idx = i % 8
      const speedKmh = slow ? 60 + idx : 120 + idx
      const gain = slow ? slowGain : fastGain
      const yawRateRadSec = gain * BALANCE_STEER_RAD * (speedKmh / 3.6)
      extras.push({ speedKmh, steerAngleDeg: BALANCE_STEER_DEG, yawRateRadSec, lapDistFrac, lapTimeFrac })
    }
  }
  return extras
}

/**
 * Returns the `TelemetrySnapshot` for a given frame sequence number. The sequence drives the
 * widget through four lap plans; frames past `PLAN_TOTAL` hold the last plan state so no channel
 * ages past its stale budget during the plateau.
 *
 * The plan is:
 *   [0..3]    out-lap — provides the start-finish context the tracker needs; itself unarchivable
 *   [4..40]   lap A — archived when lap B's start (frame 41) triggers the archive
 *   [41..77]  lap B — archived when the closing lap's start (frame 78) triggers the archive
 *   [78..82]  closing lap start — provides the wrap that archives lap B
 *   [83+]     plateau — hold closing lap state
 */
function liveFixture(sequence: number, state: CaptureState): TelemetrySnapshot {
  const ref = state === "reference"

  const sectorsA  = ref ? REF_SECTORS_A  : MATCH_SECTORS_A
  const sectorsB  = ref ? REF_SECTORS_B  : MATCH_SECTORS_B
  const tyresA    = ref ? REF_TYRES_A    : MATCH_TYRES_A
  const tyresB    = ref ? REF_TYRES_B    : MATCH_TYRES_B
  const brakesA   = ref ? REF_BRAKES_A   : MATCH_BRAKES_A
  const brakesB   = (ref ? REF_BRAKES_B_PARTIAL : MATCH_BRAKES_B) as unknown as Corners<number>
  const deltaA    = ref ? REF_DELTA_A    : MATCH_DELTA_A
  const deltaB    = ref ? REF_DELTA_B    : MATCH_DELTA_B
  const bestLap   = ref ? REF_BEST_LAP   : MATCH_BEST_LAP
  const minSpeedA = ref ? REF_MIN_SPEED_A : MATCH_MIN_SPEED_A
  const minSpeedB = ref ? REF_MIN_SPEED_B : MATCH_MIN_SPEED_B
  const slowGainA = ref ? REF_SLOW_GAIN_A : MATCH_SLOW_GAIN_A
  const fastGainA = ref ? REF_FAST_GAIN_A : MATCH_FAST_GAIN_A
  const slowGainB = ref ? REF_SLOW_GAIN_B : MATCH_SLOW_GAIN_B
  const fastGainB = ref ? REF_FAST_GAIN_B : MATCH_FAST_GAIN_B

  const extrasA = buildExtras(slowGainA, fastGainA, sectorsA[0], minSpeedA)
  const extrasB = buildExtras(slowGainB, fastGainB, sectorsB[0], minSpeedB)

  // Base snapshot fields; channelled fields are overridden per-frame
  const base = {
    sim: "iracing" as const,
    connected: true,
    sessionUniqueId: FIXTURE_SESSION_ID,
    connectionEpoch: FIXTURE_CONNECTION_EPOCH,
    sessionType: "Practice" as const,
    sessionState: "racing" as const,
    currentLap: 7,
    position: 1,
    playerCarIdx: 2,
    gear: 4,
    throttle: 0.5,
    brake: 0,
    clutch: 0,
    rpm: 0   // RC-18 omits RPM rendering (rpmComparisonRow); 0 satisfies the TelemetrySnapshot type
  }

  // Out-lap: frames 0..3
  const defaultTyres = { lf: { tempC: 84 }, rf: { tempC: 86 }, lr: { tempC: 79 }, rr: { tempC: 81 } }
  const defaultBrakes = { lf: 410, rf: 406, lr: 386, rr: 380 }
  if (sequence <= 3) {
    const [lapDistPct, currentLapTimeSec] =
      sequence === 0 ? [0,         0]  :
      sequence === 1 ? [S1_BOUNDARY, 30] :
      sequence === 2 ? [S2_BOUNDARY, 74] :
                       [0.99,       102]
    return {
      ...base,
      timestamp: FIXTURE_TIMESTAMP + sequence * FIXTURE_FRAME_MS,
      speedKmh: 178,
      steerAngleDeg: 0,
      yawRateRadSec: 0,
      lapDistPct,
      currentLapTimeSec,
      deltaToBestSec: 0.5,
      bestLapTimeSec: 104.5,
      tyres: defaultTyres,
      brakeTempC: defaultBrakes
    } as TelemetrySnapshot
  }

  // Helper: build one sector crossing/end frame
  function sectorFrame(
    seq: number,
    lapDistPct: number,
    currentLapTimeSec: number,
    speedKmh: number,
    tyres: typeof tyresA,
    brakeTempC: Corners<number>,
    deltaToBestSec: number
  ): TelemetrySnapshot {
    return {
      ...base,
      timestamp: FIXTURE_TIMESTAMP + seq * FIXTURE_FRAME_MS,
      speedKmh,
      steerAngleDeg: 0,
      yawRateRadSec: 0,
      lapDistPct,
      currentLapTimeSec,
      deltaToBestSec,
      bestLapTimeSec: bestLap,
      tyres,
      brakeTempC
    } as TelemetrySnapshot
  }

  // Lap A: frames 4..40 (37 frames total)
  // Frame 4:  start of lap
  // Frames 5..37: balance + minSpeed extras (33 total)
  // Frame 38: sector 1 crossing
  // Frame 39: sector 2 crossing
  // Frame 40: end of lap
  const LAP_A_START = 4
  const LAP_A_END   = LAP_A_START + LAP_FRAMES - 1  // = 40

  if (sequence >= LAP_A_START && sequence <= LAP_A_END) {
    const off = sequence - LAP_A_START
    if (off === 0) {
      return {
        ...base,
        timestamp: FIXTURE_TIMESTAMP + sequence * FIXTURE_FRAME_MS,
        speedKmh: 182,
        steerAngleDeg: 0,
        yawRateRadSec: 0,
        lapDistPct: 0,
        currentLapTimeSec: 0,
        deltaToBestSec: deltaA,
        bestLapTimeSec: bestLap,
        tyres: tyresA,
        brakeTempC: brakesA
      } as TelemetrySnapshot
    }
    if (off >= 1 && off <= BALANCE_EXTRAS_COUNT) {
      const extra = extrasA[off - 1]
      return {
        ...base,
        timestamp: FIXTURE_TIMESTAMP + sequence * FIXTURE_FRAME_MS,
        speedKmh: extra.speedKmh,
        steerAngleDeg: extra.steerAngleDeg,
        yawRateRadSec: extra.yawRateRadSec,
        lapDistPct: extra.lapDistFrac,
        currentLapTimeSec: extra.lapTimeFrac,
        deltaToBestSec: deltaA,
        bestLapTimeSec: bestLap,
        tyres: tyresA,
        brakeTempC: brakesA
      } as TelemetrySnapshot
    }
    // off === 34: S1 crossing, off === 35: S2 crossing, off === 36: lap end
    if (off === 34) return sectorFrame(sequence, S1_BOUNDARY, sectorsA[0], 182, tyresA, brakesA, deltaA)
    if (off === 35) return sectorFrame(sequence, S2_BOUNDARY, sectorsA[0] + sectorsA[1], 178, tyresA, brakesA, deltaA)
    if (off === 36) return sectorFrame(sequence, 0.99, sectorsA[0] + sectorsA[1] + sectorsA[2], 175, tyresA, brakesA, deltaA)
  }

  // Lap B: frames 41..77 (37 frames total)
  const LAP_B_START = LAP_A_START + LAP_FRAMES   // = 41
  const LAP_B_END   = LAP_B_START + LAP_FRAMES - 1  // = 77

  if (sequence >= LAP_B_START && sequence <= LAP_B_END) {
    const off = sequence - LAP_B_START
    if (off === 0) {
      return {
        ...base,
        timestamp: FIXTURE_TIMESTAMP + sequence * FIXTURE_FRAME_MS,
        speedKmh: 186,
        steerAngleDeg: 0,
        yawRateRadSec: 0,
        lapDistPct: 0,
        currentLapTimeSec: 0,
        deltaToBestSec: deltaB,
        bestLapTimeSec: bestLap,
        tyres: tyresB,
        brakeTempC: brakesB
      } as TelemetrySnapshot
    }
    if (off >= 1 && off <= BALANCE_EXTRAS_COUNT) {
      const extra = extrasB[off - 1]
      return {
        ...base,
        timestamp: FIXTURE_TIMESTAMP + sequence * FIXTURE_FRAME_MS,
        speedKmh: extra.speedKmh,
        steerAngleDeg: extra.steerAngleDeg,
        yawRateRadSec: extra.yawRateRadSec,
        lapDistPct: extra.lapDistFrac,
        currentLapTimeSec: extra.lapTimeFrac,
        deltaToBestSec: deltaB,
        bestLapTimeSec: bestLap,
        tyres: tyresB,
        brakeTempC: brakesB
      } as TelemetrySnapshot
    }
    if (off === 34) return sectorFrame(sequence, S1_BOUNDARY, sectorsB[0], 186, tyresB, brakesB, deltaB)
    if (off === 35) return sectorFrame(sequence, S2_BOUNDARY, sectorsB[0] + sectorsB[1], 181, tyresB, brakesB, deltaB)
    if (off === 36) return sectorFrame(sequence, 0.99, sectorsB[0] + sectorsB[1] + sectorsB[2], 178, tyresB, brakesB, deltaB)
  }

  // Closing lap and plateau: frames 78+ — hold Setup B tyres/brakes but use lap A's delta
  const closingSeq = Math.min(sequence, PLAN_TOTAL + PLATEAU_FRAMES - 1)
  const offClose = closingSeq - (LAP_B_START + LAP_FRAMES)
  const closeLapDistPct = offClose === 0 ? 0 : Math.min(0.33, offClose * 0.07)
  const closeLapTimeSec = offClose * 2.0
  return {
    ...base,
    timestamp: FIXTURE_TIMESTAMP + sequence * FIXTURE_FRAME_MS,
    speedKmh: 182,
    steerAngleDeg: 0,
    yawRateRadSec: 0,
    lapDistPct: closeLapDistPct,
    currentLapTimeSec: closeLapTimeSec,
    deltaToBestSec: deltaA,
    bestLapTimeSec: bestLap,
    tyres: tyresA,
    brakeTempC: brakesA
  } as TelemetrySnapshot
}

function builtRaceconDashboard(): Dashboard {
  const presets = BUILTIN_PRESETS.filter((candidate) => candidate.id === PRESET_ID)
  if (presets.length !== 1) throw new Error("racecon RC-18 preset must resolve exactly once")
  const dashboard = presets[0].build()
  const fullFrame = dashboard.elements.filter(
    (element) => element.type === "overlaywidget" && element.widgetId === WIDGET_ID
  )
  if (dashboard.width !== 1024 || dashboard.height !== 600 || fullFrame.length !== 1) {
    throw new Error("racecon RC-18 preset must be the unmodified 1024x600 full-frame dashboard")
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
    const timer = window.setTimeout(() => setSequence((v) => v + 1), FIXTURE_FRAME_MS)
    return () => window.clearTimeout(timer)
  }, [sequence])

  return (
    <div
      id="racecon-rc18-capture-root"
      style={rootStyle}
      aria-label="RaceCon RC-18 deterministic visual capture"
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

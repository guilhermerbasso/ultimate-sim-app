import "./harness-stubs"

import { StrictMode, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react"
import { createRoot } from "react-dom/client"
import { BUILTIN_PRESETS, type Dashboard } from "@shared/dashboards"
import type { TelemetrySnapshot } from "@shared/telemetry"
import { DashboardCanvas } from "@renderer/dashboard/DashboardRoot"

const PRESET_ID = "racecon_rc01_dash"
const WIDGET_ID = "raceconRc01Dash"
const FIXTURE_TIMESTAMP = 10_000
const FIXTURE_SESSION_ID = 74_001
const FIXTURE_CONNECTION_EPOCH = 12
const FIXTURE_SOURCE_ID = "acc:session:74001:connection:12"

type CaptureSize = { width: 800; height: 480 } | { width: 1024; height: 600 }

function readCaptureSize(): CaptureSize {
  const params = new URLSearchParams(window.location.search)
  const width = Number(params.get("width") ?? "1024")
  const height = Number(params.get("height") ?? "600")
  if (width === 800 && height === 480) return { width, height }
  if (width === 1024 && height === 600) return { width, height }
  throw new Error("racecon RC-01 capture requires exactly 800x480 or 1024x600")
}

/** A connected, provider-neutral live frame. It deliberately has no mock scenario import. */
function liveFixture(sequence: number): TelemetrySnapshot {
  return {
    sim: "acc",
    connected: true,
    timestamp: FIXTURE_TIMESTAMP + sequence * 40,
    sessionUniqueId: FIXTURE_SESSION_ID,
    connectionEpoch: FIXTURE_CONNECTION_EPOCH,
    speedKmh: 278,
    rpm: 9_600,
    maxRpm: 10_000,
    gear: 6,
    throttle: 0.92,
    brake: 0.04,
    clutch: 0,
    tcLevel: 4,
    position: 2,
    fuelLiters: 42.5,
    bestLapTimeSec: 90.2,
    deltaToBestSec: -0.216,
    pitLimiter: false,
    relatives: { ahead: { carIdx: 17, name: "Ahead", carNumber: "17", gapSec: 0.734 } },
    tyres: {
      lf: { tempC: 85 },
      rf: { tempC: 87 },
      lr: { tempC: 89 },
      rr: { tempC: 91 }
    }
  }
}

function builtRaceconDashboard(): Dashboard {
  const presets = BUILTIN_PRESETS.filter((candidate) => candidate.id === PRESET_ID)
  if (presets.length !== 1) throw new Error("racecon RC-01 preset must resolve exactly once")

  // The capture must exercise the production dashboard object unchanged.
  // DashboardCanvas derives its responsive render model without mutating this
  // stored 1024x600 preset.
  const dashboard = presets[0].build()
  const fullFrame = dashboard.elements.filter((element) => element.type === "overlaywidget" && element.widgetId === WIDGET_ID)
  if (dashboard.width !== 1024 || dashboard.height !== 600 || fullFrame.length !== 1) {
    throw new Error("racecon RC-01 preset must be the unmodified 1024x600 full-frame dashboard")
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

  useEffect(() => {
    const timer = window.setInterval(() => setSequence((value) => value + 1), 40)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div
      id="racecon-rc01-capture-root"
      style={rootStyle}
      aria-label="RaceCon RC-01 deterministic visual capture"
      data-capture-ready={sequence >= 3 ? "true" : "false"}
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

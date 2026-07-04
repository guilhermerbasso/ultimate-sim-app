// IPC/api stubs for standalone rendering of overlay + dashboard widgets in the
// browser (no Electron preload). This module MUST be imported FIRST by every
// gallery entry — before the real widget/dashboard modules — so that any effect
// that touches `window.ipc` / `window.api` finds a safe bridge.
//
// `invoke` is channel-aware: a handful of well-known channels (team-fuel,
// tyre-strategy) return realistic mock payloads so those widgets render with
// content instead of "offline"; every other channel resolves to `undefined`
// (widgets treat missing IPC data as "no live extra data" and fall back to the
// snapshot). `subscribe` returns a no-op unsubscribe. ES module import order
// guarantees this runs before sibling imports in the entry file evaluate.
import { TEAM_FUEL_CHANNELS, type TeamFuelPeer } from '@shared/team-fuel'
import { TIRE_CHANNELS, type TireStrategyState } from '@shared/tire-strategy'

type AnyFn = (...args: unknown[]) => unknown

const now = Date.now()

const TEAM_FUEL_PEERS: TeamFuelPeer[] = [
  { peerId: 'me', driverName: 'G. Basso', fuelLiters: 38.4, fuelPerLap: 2.86, lapsRemaining: 13.4, stintTargetLaps: 28, ts: now - 1200, local: true },
  { peerId: 'p2', driverName: 'M. Rossi', fuelLiters: 21.7, fuelPerLap: 2.9, lapsRemaining: 7.5, stintTargetLaps: 28, ts: now - 3400 },
  { peerId: 'p3', driverName: 'K. Tanaka', fuelLiters: 6.1, fuelPerLap: 2.81, lapsRemaining: 1.8, stintTargetLaps: 28, ts: now - 800 }
]

const TIRE_STRATEGY: TireStrategyState = {
  connected: true,
  currentLap: 12,
  corners: {
    lf: { wearPct: 0.91, wearPerLap: 0.011, lapsToThreshold: 18, estimated: false },
    rf: { wearPct: 0.88, wearPerLap: 0.014, lapsToThreshold: 14, estimated: false },
    lr: { wearPct: 0.93, wearPerLap: 0.009, lapsToThreshold: 22, estimated: false },
    rr: { wearPct: 0.9, wearPerLap: 0.012, lapsToThreshold: 16, estimated: false }
  },
  worstCorner: 'rf',
  avgWearPerLap: 0.0115,
  recommendedPitLap: 26,
  lapsRemainingOnTyres: 14,
  raceLapsRemaining: 18,
  estimated: false,
  notes: ['RF wearing fastest', 'Pit window opens lap 24'],
  settings: { wearThresholdPct: 0.3, targetLaps: 28 },
  updatedAt: now
}

const INVOKE_RESPONSES: Record<string, unknown> = {
  [TEAM_FUEL_CHANNELS.state]: TEAM_FUEL_PEERS,
  [TIRE_CHANNELS.get]: TIRE_STRATEGY
}

const ipc = {
  invoke: async (channel: string): Promise<unknown> => {
    if (channel in INVOKE_RESPONSES) return INVOKE_RESPONSES[channel]
    return undefined
  },
  subscribe: () => () => {}
}

// `window.api` (ButtonBoxApi) is never used by the overlay/dashboard renderers,
// but stub it defensively so any incidental access can't throw.
const api = new Proxy(
  {},
  {
    get: (): AnyFn => {
      return async () => undefined
    }
  }
)

const w = window as unknown as { ipc: unknown; api: unknown }
if (!w.ipc) w.ipc = ipc
if (!w.api) w.api = api

export {}

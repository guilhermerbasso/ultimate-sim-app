export type TeamFuelMode = 'host' | 'join'
export type TeamFuelConnectionState = 'stopped' | 'hosting' | 'joining' | 'connected' | 'error'

export interface TeamFuelPitWindow {
  latestLap?: number
  lapsUntilPit?: number
  status?: 'unknown' | 'safe' | 'save' | 'pit-required' | 'critical'
}

export interface TeamFuelPeer {
  peerId: string
  driverName: string
  custId?: number
  sessionUniqueId?: number
  fuelLiters?: number
  fuelPerLap?: number
  lapsRemaining?: number
  stintTargetLaps?: number
  pitWindow?: TeamFuelPitWindow
  ts: number
  local?: boolean
}

export interface TeamFuelStartArgs {
  mode: TeamFuelMode
  roomKey: string
  driverName?: string
}

export interface TeamFuelStatus {
  state: TeamFuelConnectionState
  mode?: TeamFuelMode
  roomHash?: string
  port?: number
  peers: TeamFuelPeer[]
  error?: string
}

export const TEAM_FUEL_CHANNELS = {
  start: 'teamfuel:start',
  stop: 'teamfuel:stop',
  state: 'teamfuel:state',
  updated: 'teamfuel:updated'
} as const

export type TradingPaintsDriverStatus = 'missing' | 'downloaded' | 'stale'

export interface TradingPaintsDriverInput {
  custId?: number
  carPath?: string
  name?: string
  carNumber?: string
}

export interface TradingPaintsDriverPaintStatus {
  custId: number
  carPath: string
  name: string
  carNumber?: string
  status: TradingPaintsDriverStatus
  fileName?: string
  mtimeMs?: number
  checkedAt: number
}

export interface TradingPaintsStatusRequest {
  drivers: TradingPaintsDriverInput[]
}

export interface TradingPaintsStatusResult {
  supported: boolean
  paintRoot?: string
  statuses: TradingPaintsDriverPaintStatus[]
}

export interface TradingPaintsClientInfo {
  installed: boolean
  platform: string
  path?: string
  executablePath?: string
}

export interface TradingPaintsOpenClientResult {
  ok: boolean
  message?: string
}

export const TRADING_PAINTS_CHANNELS = {
  status: 'paints:status',
  clientInfo: 'paints:clientInfo',
  openClient: 'paints:openClient'
} as const

export type TradingPaintsChannel = (typeof TRADING_PAINTS_CHANNELS)[keyof typeof TRADING_PAINTS_CHANNELS]

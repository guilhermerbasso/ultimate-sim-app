import type { CanonicalRaceOpsEvent } from './phase02-contracts'

export interface Phase02TapBudgets {
  maxItems: number
  maxBytes: number
  maxAgeMs: number
  maxDrainBatch: number
}
export interface Phase02TapStatus {
  budgets: Phase02TapBudgets
  enabled: boolean
  killSwitch: boolean
  queuedItems: number
  queuedBytes: number
  accepted: number
  delivered: number
  dropped: number
  overflowCount: number
  consumerErrors: number
  lastError?: string
  lastOverflowAt?: number
  lastDeliveredSequence?: string
}

export interface Phase02TapDelivery {
  event: CanonicalRaceOpsEvent
  enqueuedAt: number
  byteLength: number
}

export interface Phase02TapSubscription {
  readonly id: string
  status(): Phase02TapStatus
  setKillSwitch(enabled: boolean): void
  dispose(): void
}

export interface Phase02Tap {
  subscribe(
    id: string,
    budgets: Phase02TapBudgets,
    consumer: (delivery: Phase02TapDelivery) => Promise<void> | void
  ): Phase02TapSubscription
  status(id: string): Phase02TapStatus | null
  dispose(): void
}

export const DEFAULT_PASSPORT_TAP_BUDGETS: Phase02TapBudgets = {
  maxItems: 8,
  maxBytes: 256 * 1024,
  maxAgeMs: 2_000,
  maxDrainBatch: 4
}

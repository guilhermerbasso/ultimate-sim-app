import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { CanonicalRaceOpsEvent } from '../../shared/phase02-contracts'
import { canonicalFactValue } from '../../shared/phase02-contracts'
import type {
  Phase02Tap,
  Phase02TapBudgets,
  Phase02TapDelivery,
  Phase02TapStatus,
  Phase02TapSubscription
} from '../../shared/phase02-tap'
import type { TelemetryHub } from '../telemetry/hub'
import { telemetrySnapshotToRaceOpsEvent } from './telemetry-contract-adapter'

const SOURCE_QUEUE_LIMIT = 4

interface SourceEntry {
  snapshot: TelemetrySnapshot | null
  sequence: bigint
  enqueuedAt: number
}
function schedule(task: () => void): void {
  setImmediate(task)
}

function estimateBytes(delivery: Phase02TapDelivery): number {
  return Buffer.byteLength(JSON.stringify(delivery.event, (_key, value) =>
    value instanceof Uint8Array ? Buffer.from(value).toString('base64') : value
  ))
}

function isLifecycleBoundary(delivery: Phase02TapDelivery): boolean {
  const connected = canonicalFactValue(
    delivery.event.facts.find((fact) => fact.name === 'telemetry.connected')
  )
  return delivery.event.telemetryContext !== 'live' || connected === false
}

function cloneEvent(event: CanonicalRaceOpsEvent): CanonicalRaceOpsEvent {
  return {
    ...event,
    observedInterval: { ...event.observedInterval },
    confidence: { ...event.confidence },
    facts: event.facts.map((fact) => ({
      ...fact,
      value: fact.value?.kind === 'bytes'
        ? { kind: 'bytes', value: Uint8Array.from(fact.value.value) }
        : fact.value
          ? { ...fact.value }
          : undefined,
      provenance: fact.provenance ? { ...fact.provenance } : undefined
    })),
    evidenceRefs: [...event.evidenceRefs],
    integrityFlags: [...event.integrityFlags]
  }
}

class BoundedTapSubscription implements Phase02TapSubscription {
  readonly id: string
  private readonly queue: Phase02TapDelivery[] = []
  private queuedBytes = 0
  private draining = false
  private disposed = false
  private state: Phase02TapStatus

  constructor(
    id: string,
    private readonly budgets: Phase02TapBudgets,
    private readonly consumer: (delivery: Phase02TapDelivery) => Promise<void> | void,
    private readonly now: () => number
  ) {
    this.id = id
    this.state = {
      budgets: { ...budgets },
      enabled: true,
      killSwitch: false,
      queuedItems: 0,
      queuedBytes: 0,
      accepted: 0,
      delivered: 0,
      dropped: 0,
      overflowCount: 0,
      consumerErrors: 0
      ,
      gapPending: false
    }
  }

  enqueue(delivery: Phase02TapDelivery): void {
    const boundary = isLifecycleBoundary(delivery)
    if (this.disposed || ((!this.state.enabled || this.state.killSwitch) && !boundary)) return
    const byteLength = estimateBytes(delivery)
    const next: Phase02TapDelivery = { ...delivery, byteLength }
    if (byteLength > this.budgets.maxBytes) {
      this.markOverflow(1)
      return
    }
    this.queue.push(next)
    this.queuedBytes += byteLength
    this.state.accepted += 1
    let dropped = 0
    while (
      this.queue.length > this.budgets.maxItems ||
      this.queuedBytes > this.budgets.maxBytes
    ) {
      const removed = this.queue.shift()
      if (!removed) break
      this.queuedBytes -= removed.byteLength
      dropped += 1
    }
    if (dropped > 0) {
      this.markOverflow(dropped)
    }
    this.syncQueueState()
    this.requestDrain()
  }

  status(): Phase02TapStatus {
    return { ...this.state, budgets: { ...this.state.budgets } }
  }

  setKillSwitch(enabled: boolean): void {
    this.state.killSwitch = enabled
    this.state.enabled = !enabled
    if (enabled) {
      this.queue.length = 0
      this.queuedBytes = 0
      this.syncQueueState()
    }
  }

  dispose(): void {
    this.disposed = true
    this.state.enabled = false
    this.queue.length = 0
    this.queuedBytes = 0
    this.syncQueueState()
  }

  private requestDrain(): void {
    if (
      this.draining ||
      this.disposed ||
      (this.state.killSwitch && !this.queue.some(isLifecycleBoundary))
    ) return
    this.draining = true
    schedule(() => void this.drain())
  }

  private async drain(): Promise<void> {
    try {
      let processed = 0
      while (
        processed < this.budgets.maxDrainBatch &&
        this.queue.length > 0 &&
        !this.disposed
      ) {
        if (this.state.killSwitch && !isLifecycleBoundary(this.queue[0])) break
        const delivery = this.queue.shift()
        if (!delivery) break
        this.queuedBytes -= delivery.byteLength
        const age = this.now() - delivery.enqueuedAt
        if (age > this.budgets.maxAgeMs && !isLifecycleBoundary(delivery)) {
          this.markOverflow(1)
          this.syncQueueState()
          processed += 1
          continue
        }
        if (this.state.gapPending && !delivery.event.integrityFlags.includes('gap')) {
          delivery.event = {
            ...delivery.event,
            integrityFlags: [...delivery.event.integrityFlags, 'gap']
          }
          this.state.gapPending = false
        }
        try {
          await this.consumer(delivery)
          this.state.delivered += 1
          this.state.lastDeliveredSequence = delivery.event.sequence
        } catch (error) {
          this.state.consumerErrors += 1
          this.state.lastError = error instanceof Error ? error.message : String(error)
          this.state.gapPending = true
        }
        this.syncQueueState()
        processed += 1
      }
    } finally {
      this.draining = false
      if (
        this.queue.length > 0 &&
        !this.disposed &&
        (!this.state.killSwitch || this.queue.some(isLifecycleBoundary))
      ) {
        this.requestDrain()
      }
    }
  }

  private markOverflow(dropped: number): void {
    this.state.dropped += dropped
    this.state.overflowCount += 1
    this.state.lastOverflowAt = this.now()
    this.state.gapPending = true
  }

  private syncQueueState(): void {
    this.state.queuedItems = this.queue.length
    this.state.queuedBytes = Math.max(0, this.queuedBytes)
  }
}

export class Phase02TapKernel implements Phase02Tap {
  private readonly subscriptions = new Map<string, BoundedTapSubscription>()
  private readonly sourceQueue: SourceEntry[] = []
  private sourceSequence = 0n
  private sourceGap = false
  private sourceDraining = false
  private disposed = false
  private readonly onSnapshot = (snapshot: TelemetrySnapshot | null): void => {
    if (this.disposed) return
    this.sourceSequence += 1n
    this.sourceQueue.push({
      snapshot,
      sequence: this.sourceSequence,
      enqueuedAt: this.now()
    })
    if (this.sourceQueue.length > SOURCE_QUEUE_LIMIT) {
      this.sourceQueue.shift()
      this.sourceGap = true
    }
    this.requestSourceDrain()
  }

  constructor(
    private readonly telemetryHub: TelemetryHub,
    private readonly now: () => number = Date.now,
    private readonly monotonicNs: () => bigint = process.hrtime.bigint
  ) {
    telemetryHub.on('snapshot', this.onSnapshot)
  }

  subscribe(
    id: string,
    budgets: Phase02TapBudgets,
    consumer: (delivery: Phase02TapDelivery) => Promise<void> | void
  ): Phase02TapSubscription {
    if (this.disposed) throw new Error('Phase 02 tap is disposed.')
    if (this.subscriptions.has(id)) throw new Error(`Phase 02 tap subscription already exists: ${id}`)
    validateBudgets(budgets)
    const subscription = new BoundedTapSubscription(id, budgets, consumer, this.now)
    this.subscriptions.set(id, subscription)
    return {
      id,
      status: () => subscription.status(),
      setKillSwitch: (enabled) => subscription.setKillSwitch(enabled),
      dispose: () => {
        subscription.dispose()
        this.subscriptions.delete(id)
      }
    }
  }

  status(id: string): Phase02TapStatus | null {
    return this.subscriptions.get(id)?.status() ?? null
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.telemetryHub.off('snapshot', this.onSnapshot)
    this.sourceQueue.length = 0
    for (const subscription of this.subscriptions.values()) subscription.dispose()
    this.subscriptions.clear()
  }

  private requestSourceDrain(): void {
    if (this.sourceDraining || this.disposed) return
    this.sourceDraining = true
    schedule(() => this.drainSource())
  }

  private drainSource(): void {
    try {
      let processed = 0
      while (processed < SOURCE_QUEUE_LIMIT && this.sourceQueue.length > 0 && !this.disposed) {
        const source = this.sourceQueue.shift()
        if (!source) break
        const event = telemetrySnapshotToRaceOpsEvent({
          snapshot: source.snapshot,
          sequence: source.sequence,
          gap: this.sourceGap,
          processedAtMs: this.now(),
          observedMonotonicNs: this.monotonicNs()
        })
        this.sourceGap = false
        const delivery: Phase02TapDelivery = {
          event,
          enqueuedAt: source.enqueuedAt,
          byteLength: 0
        }
        for (const subscription of this.subscriptions.values()) {
          subscription.enqueue({
            ...delivery,
            event: cloneEvent(event)
          })
        }
        processed += 1
      }
    } finally {
      this.sourceDraining = false
      if (this.sourceQueue.length > 0 && !this.disposed) this.requestSourceDrain()
    }
  }
}

function validateBudgets(budgets: Phase02TapBudgets): void {
  if (!Number.isSafeInteger(budgets.maxItems) || budgets.maxItems < 1 || budgets.maxItems > 128) {
    throw new Error('Phase 02 tap maxItems must be between 1 and 128.')
  }
  if (!Number.isSafeInteger(budgets.maxBytes) || budgets.maxBytes < 1024 || budgets.maxBytes > 16 * 1024 * 1024) {
    throw new Error('Phase 02 tap maxBytes is outside the safe range.')
  }
  if (!Number.isSafeInteger(budgets.maxAgeMs) || budgets.maxAgeMs < 100 || budgets.maxAgeMs > 60_000) {
    throw new Error('Phase 02 tap maxAgeMs is outside the safe range.')
  }
  if (!Number.isSafeInteger(budgets.maxDrainBatch) || budgets.maxDrainBatch < 1 || budgets.maxDrainBatch > budgets.maxItems) {
    throw new Error('Phase 02 tap maxDrainBatch is invalid.')
  }
}

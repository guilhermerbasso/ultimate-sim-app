export interface CueDeliveryMetadata {
  key?: string
  priority?: number
}

export interface CueDeliveryQueueOptions<T> {
  maxPending?: number
  onPreempt?: (active: T) => void
}

interface QueuedDelivery<T> {
  item: T
  key: string
  priority: number
  sequence: number
}

interface ActiveDelivery<T> extends QueuedDelivery<T> {
  controller: AbortController
}

export class CueModalityDeliveryQueue<T> {
  private pending: Array<QueuedDelivery<T>> = []
  private active: ActiveDelivery<T> | null = null
  private running = false
  private sequence = 0
  private idleResolvers: Array<() => void> = []
  private readonly maxPending: number

  constructor(
    private readonly deliver: (
      item: T,
      signal: AbortSignal
    ) => Promise<void> | void,
    private readonly options: CueDeliveryQueueOptions<T> = {}
  ) {
    this.maxPending = Math.max(1, options.maxPending ?? 8)
  }

  enqueue(item: T, metadata: CueDeliveryMetadata = {}): void {
    const sequence = ++this.sequence
    const key = metadata.key ?? `cue-${sequence}`
    const priority = Math.max(0, metadata.priority ?? 0)
    if (
      this.active?.key === key &&
      priority <= this.active.priority
    ) {
      return
    }

    this.pending = this.pending.filter((queued) => queued.key !== key)
    if (priority >= 2) {
      this.pending = this.pending.filter((queued) => queued.priority >= 2)
    }
    if (this.active && priority > this.active.priority) {
      this.options.onPreempt?.(this.active.item)
      this.active.controller.abort()
    }

    this.pending.push({ item, key, priority, sequence })
    this.pending.sort(
      (left, right) =>
        right.priority - left.priority || left.sequence - right.sequence
    )
    if (this.pending.length > this.maxPending) {
      const retained = [...this.pending]
        .sort(
          (left, right) =>
            right.priority - left.priority || right.sequence - left.sequence
        )
        .slice(0, this.maxPending)
      const retainedSequences = new Set(
        retained.map((queued) => queued.sequence)
      )
      this.pending = this.pending
        .filter((queued) => retainedSequences.has(queued.sequence))
        .sort(
          (left, right) =>
            right.priority - left.priority || left.sequence - right.sequence
        )
    }
    void this.drain()
  }

  clear(): void {
    this.pending = []
    if (this.active) {
      this.options.onPreempt?.(this.active.item)
      this.active.controller.abort()
    }
    this.resolveIdleIfReady()
  }

  whenIdle(): Promise<void> {
    if (!this.running && this.pending.length === 0 && !this.active) {
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve)
    })
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.pending.length > 0) {
        const queued = this.pending.shift()
        if (!queued) continue
        const controller = new AbortController()
        this.active = { ...queued, controller }
        try {
          await this.deliver(queued.item, controller.signal)
        } catch {
          // One failed device delivery must not drop later modality cues.
        } finally {
          if (this.active?.sequence === queued.sequence) this.active = null
        }
      }
    } finally {
      this.running = false
      this.resolveIdleIfReady()
      if (this.pending.length > 0) void this.drain()
    }
  }

  private resolveIdleIfReady(): void {
    if (this.running || this.pending.length > 0 || this.active) return
    for (const resolve of this.idleResolvers.splice(0)) resolve()
  }
}

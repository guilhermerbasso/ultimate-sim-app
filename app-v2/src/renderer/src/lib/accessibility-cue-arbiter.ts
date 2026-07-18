export class CueModalityDeliveryQueue<T> {
  private readonly pending: T[] = []
  private running = false
  private idleResolvers: Array<() => void> = []

  constructor(
    private readonly deliver: (item: T) => Promise<void> | void
  ) {}

  enqueue(item: T): void {
    this.pending.push(item)
    void this.drain()
  }

  clear(): void {
    this.pending.length = 0
  }

  whenIdle(): Promise<void> {
    if (!this.running && this.pending.length === 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve)
    })
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.pending.length > 0) {
        const item = this.pending.shift()
        if (item === undefined) continue
        try {
          await this.deliver(item)
        } catch {
          // One failed device delivery must not drop later modality cues.
        }
      }
    } finally {
      this.running = false
      for (const resolve of this.idleResolvers.splice(0)) resolve()
    }
  }
}

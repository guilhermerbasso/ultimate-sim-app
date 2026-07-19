const MAX_TIMER_MS = 2_147_483_647

export interface RigExpirySchedulerOptions {
  now?: () => number
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
  onExpire: () => void | Promise<void>
}

export class RigPreflightExpiryScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private target: number | null = null
  private readonly now: () => number
  private readonly setTimer: NonNullable<RigExpirySchedulerOptions['setTimer']>
  private readonly clearTimer: NonNullable<RigExpirySchedulerOptions['clearTimer']>

  constructor(private readonly options: RigExpirySchedulerOptions) {
    this.now = options.now ?? Date.now
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.clearTimer = options.clearTimer ?? clearTimeout
  }

  schedule(expiresAt: number | null): void {
    if (this.timer) this.clearTimer(this.timer)
    this.timer = null
    this.target = Number.isFinite(expiresAt) && (expiresAt ?? 0) > 0 ? expiresAt : null
    if (this.target === null) return
    this.arm()
  }

  dispose(): void {
    if (this.timer) this.clearTimer(this.timer)
    this.timer = null
    this.target = null
  }

  private arm(): void {
    if (this.target === null) return
    const delay = Math.max(0, this.target - this.now())
    this.timer = this.setTimer(() => {
      this.timer = null
      if (this.target !== null && this.target > this.now()) {
        this.arm()
        return
      }
      this.target = null
      void this.options.onExpire()
    }, Math.min(delay, MAX_TIMER_MS))
  }
}

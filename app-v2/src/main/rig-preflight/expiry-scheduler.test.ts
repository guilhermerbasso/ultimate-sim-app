import { describe, expect, it, vi } from 'vitest'
import { RigPreflightExpiryScheduler } from './expiry-scheduler'

describe('RigPreflightExpiryScheduler', () => {
  it('fires at the scheduled certificate expiry and can be rescheduled', async () => {
    vi.useFakeTimers()
    try {
      let now = 1_000
      const expired = vi.fn()
      const scheduler = new RigPreflightExpiryScheduler({
        now: () => now,
        onExpire: expired
      })
      scheduler.schedule(2_000)
      scheduler.schedule(3_000)

      now = 2_999
      await vi.advanceTimersByTimeAsync(1_999)
      expect(expired).not.toHaveBeenCalled()

      now = 3_000
      await vi.advanceTimersByTimeAsync(1)
      expect(expired).toHaveBeenCalledTimes(1)
      scheduler.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})

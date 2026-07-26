import { useEffect, useState } from 'react'
import type { Rc01MonotonicClock } from './raceconRc01Core'
import type { WidgetProps } from './types'

export const RACECON_DISPLAY_CLOCK_INTERVAL_MS = 100

/**
 * Every RaceCon dashboard ages its model against a display clock: channel receipts stale,
 * fuel models engage, rolling windows advance. That is correct for a live render and wrong
 * for a preview, which is a single static frame given one snapshot at mount and never fed
 * again. A ticking clock would walk that frame past its own thresholds and mutate the
 * rendered text with no new data behind it.
 *
 * Any non-live render mode therefore freezes; only a live render (`preview` undefined) ticks.
 */
export function raceconDisplayClockFrozen(preview: WidgetProps['preview']): boolean {
  return preview !== undefined
}

/**
 * Seeds from `monotonicClock()` once and re-reads it every 100 ms while live. A frozen clock
 * holds its mount value for the lifetime of the render, making previews deterministic.
 */
export function useRaceconDisplayClock(monotonicClock: Rc01MonotonicClock, frozen: boolean): number {
  const [nowMs, setNowMs] = useState(() => monotonicClock())

  useEffect(() => {
    if (frozen) return
    const timer = window.setInterval(() => setNowMs(monotonicClock()), RACECON_DISPLAY_CLOCK_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [frozen, monotonicClock])

  return nowMs
}

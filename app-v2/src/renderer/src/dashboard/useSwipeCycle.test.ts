import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SWIPE_THRESHOLDS,
  isLongPress,
  resolveSwipeDirection,
  resolveTapZone
} from './useSwipeCycle'

describe('resolveSwipeDirection', () => {
  it('maps a left flick to next and a right flick to prev', () => {
    expect(resolveSwipeDirection({ dx: -120, dy: 10, dt: 200 })).toBe('next')
    expect(resolveSwipeDirection({ dx: 120, dy: 10, dt: 200 })).toBe('prev')
  })

  it('ignores swipes shorter than the distance threshold', () => {
    expect(resolveSwipeDirection({ dx: -40, dy: 0, dt: 200 })).toBeNull()
    expect(resolveSwipeDirection({ dx: 40, dy: 0, dt: 200 })).toBeNull()
  })

  it('ignores gestures that are too vertical', () => {
    expect(resolveSwipeDirection({ dx: -120, dy: 120, dt: 200 })).toBeNull()
  })

  it('ignores gestures slower than maxTime', () => {
    expect(resolveSwipeDirection({ dx: -120, dy: 0, dt: 2000 })).toBeNull()
  })

  it('respects custom thresholds', () => {
    expect(resolveSwipeDirection({ dx: -30, dy: 0, dt: 100 }, { distance: 20, restraint: 40, maxTime: 500 })).toBe('next')
  })

  it('uses sensible defaults', () => {
    expect(DEFAULT_SWIPE_THRESHOLDS.distance).toBeGreaterThan(0)
    expect(resolveSwipeDirection({ dx: -DEFAULT_SWIPE_THRESHOLDS.distance, dy: 0, dt: 100 })).toBe('next')
  })
})

describe('resolveTapZone', () => {
  it('maps left-edge taps to prev and right-edge taps to next', () => {
    expect(resolveTapZone(20, 1024)).toBe('prev')
    expect(resolveTapZone(1004, 1024)).toBe('next')
  })

  it('returns null for taps in the middle', () => {
    expect(resolveTapZone(512, 1024)).toBeNull()
  })

  it('honors a custom edge fraction', () => {
    expect(resolveTapZone(300, 1000, 0.4)).toBe('prev')
    expect(resolveTapZone(700, 1000, 0.4)).toBe('next')
    expect(resolveTapZone(500, 1000, 0.4)).toBeNull()
  })

  it('guards against zero width', () => {
    expect(resolveTapZone(0, 0)).toBeNull()
  })
})

describe('isLongPress', () => {
  it('detects presses at or beyond the threshold', () => {
    expect(isLongPress(700)).toBe(true)
    expect(isLongPress(699)).toBe(false)
    expect(isLongPress(300, 250)).toBe(true)
  })
})

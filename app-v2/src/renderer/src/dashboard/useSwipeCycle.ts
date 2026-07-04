import { useEffect, useRef } from 'react'

// ── Pure gesture logic (unit-tested, no DOM/React) ───────────────────────────

export type CycleDirection = 'next' | 'prev'

export interface SwipeSample {
  /** Horizontal travel end-start, px (negative = moved left). */
  dx: number
  /** Vertical travel end-start, px. */
  dy: number
  /** Gesture duration, ms. */
  dt: number
}

export interface SwipeThresholds {
  /** Minimum |dx| to count as a horizontal swipe. */
  distance: number
  /** Maximum |dy| tolerated before the swipe is treated as vertical noise. */
  restraint: number
  /** Maximum duration for a flick to register. */
  maxTime: number
}

export const DEFAULT_SWIPE_THRESHOLDS: SwipeThresholds = {
  distance: 60,
  restraint: 80,
  maxTime: 800
}

// Carousel convention: swipe LEFT (finger travels left, dx<0) advances to the
// NEXT preset; swipe RIGHT (dx>0) goes to the PREVIOUS one. Returns null when
// the sample is too short, too slow, or too vertical to be a deliberate swipe.
export function resolveSwipeDirection(
  sample: SwipeSample,
  thresholds: SwipeThresholds = DEFAULT_SWIPE_THRESHOLDS
): CycleDirection | null {
  const { dx, dy, dt } = sample
  if (dt > thresholds.maxTime) return null
  if (Math.abs(dx) < thresholds.distance) return null
  if (Math.abs(dy) > thresholds.restraint) return null
  return dx < 0 ? 'next' : 'prev'
}

// Edge tap zones: a tap within the left `edgeFraction` of the width is PREV, a
// tap within the right `edgeFraction` is NEXT, taps in the middle do nothing.
export function resolveTapZone(x: number, width: number, edgeFraction = 0.2): CycleDirection | null {
  if (width <= 0) return null
  const frac = Math.min(0.5, Math.max(0, edgeFraction))
  if (x <= width * frac) return 'prev'
  if (x >= width * (1 - frac)) return 'next'
  return null
}

export function isLongPress(durationMs: number, threshold = 700): boolean {
  return durationMs >= threshold
}

// ── React hook ───────────────────────────────────────────────────────────────

export interface SwipeCycleOptions {
  /** Invoked with the resolved cycle direction (swipe or edge tap). */
  onCycle: (direction: CycleDirection) => void
  /** Invoked when a long-press is detected (kiosk exit). */
  onLongPress?: () => void
  thresholds?: SwipeThresholds
  edgeFraction?: number
  longPressMs?: number
  /** Movement (px) beyond which a press is no longer considered a long-press. */
  longPressMoveTolerance?: number
}

interface PointerStart {
  x: number
  y: number
  t: number
  moved: boolean
}

// Attaches pointer/touch handlers to `ref` that translate swipes, edge taps and
// long-presses into the supplied callbacks. All numeric decisions are delegated
// to the pure helpers above so they can be tested without a renderer.
export function useSwipeCycle<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  options: SwipeCycleOptions
): void {
  const optsRef = useRef(options)
  optsRef.current = options

  useEffect(() => {
    const node = ref.current
    if (!node) return

    let start: PointerStart | null = null
    let longPressTimer: ReturnType<typeof setTimeout> | null = null
    const moveTolerance = optsRef.current.longPressMoveTolerance ?? 16

    const clearLongPress = (): void => {
      if (longPressTimer !== null) {
        clearTimeout(longPressTimer)
        longPressTimer = null
      }
    }

    const onDown = (event: PointerEvent): void => {
      start = { x: event.clientX, y: event.clientY, t: performance.now(), moved: false }
      clearLongPress()
      const longPressMs = optsRef.current.longPressMs ?? 700
      longPressTimer = setTimeout(() => {
        if (start && !start.moved) optsRef.current.onLongPress?.()
        start = null
      }, longPressMs)
    }

    const onMove = (event: PointerEvent): void => {
      if (!start) return
      if (Math.abs(event.clientX - start.x) > moveTolerance || Math.abs(event.clientY - start.y) > moveTolerance) {
        start.moved = true
        clearLongPress()
      }
    }

    const onUp = (event: PointerEvent): void => {
      clearLongPress()
      if (!start) return
      const sample: SwipeSample = {
        dx: event.clientX - start.x,
        dy: event.clientY - start.y,
        dt: performance.now() - start.t
      }
      const swipe = resolveSwipeDirection(sample, optsRef.current.thresholds)
      if (swipe) {
        optsRef.current.onCycle(swipe)
      } else if (!start.moved) {
        const rect = node.getBoundingClientRect()
        const tap = resolveTapZone(event.clientX - rect.left, rect.width, optsRef.current.edgeFraction)
        if (tap) optsRef.current.onCycle(tap)
      }
      start = null
    }

    const onCancel = (): void => {
      clearLongPress()
      start = null
    }

    node.addEventListener('pointerdown', onDown)
    node.addEventListener('pointermove', onMove)
    node.addEventListener('pointerup', onUp)
    node.addEventListener('pointercancel', onCancel)
    node.addEventListener('pointerleave', onCancel)

    return () => {
      clearLongPress()
      node.removeEventListener('pointerdown', onDown)
      node.removeEventListener('pointermove', onMove)
      node.removeEventListener('pointerup', onUp)
      node.removeEventListener('pointercancel', onCancel)
      node.removeEventListener('pointerleave', onCancel)
    }
  }, [ref])
}

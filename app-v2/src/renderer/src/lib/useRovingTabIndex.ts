import { useCallback, useEffect, useRef, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'

/**
 * Roving tabindex for a large repeated region.
 *
 * WCAG 2.2 A — 2.4.3 Focus Order. When a region repeats the same control
 * hundreds of times, every repetition is a tab stop a keyboard user has to walk
 * past to reach anything after it. The widget gallery measured 3,732 of them.
 *
 * The fix is not to remove the controls from the keyboard — that trades a
 * 2.4.3 problem for a 2.1.1 one. It is to make the region ONE tab stop and
 * navigate inside it with the arrow keys, which is the pattern the ARIA
 * Authoring Practices use for toolbars, grids and listboxes.
 *
 * Every participating control renders with `tabIndex={-1}` and carries
 * `data-roving-item`. Exactly one of them is promoted to `tabIndex=0` at a
 * time, imperatively — React never writes anything but `-1`, so it does not
 * clobber the promotion, and a MutationObserver re-establishes it when the set
 * of items changes (filtering, expanding a section, hiding a widget).
 *
 * Nothing here removes a control from the accessibility tree or from the mouse:
 * only SEQUENTIAL navigation changes.
 */

export const ROVING_ITEM_ATTRIBUTE = 'data-roving-item'

const ITEM_SELECTOR = `[${ROVING_ITEM_ATTRIBUTE}]`

/**
 * How far either side of the current item to look when moving by row. Rows are
 * contiguous in DOM order, so the neighbouring row is always close by; bounding
 * the search keeps an arrow press cheap in a region with thousands of items.
 */
const ROW_SEARCH_WINDOW = 400

/** Two items are on the same visual row when their tops agree within this. */
const ROW_TOLERANCE = 4

export interface RovingTabIndex<T extends HTMLElement> {
  /** Attach to the element that contains the roving items. */
  containerRef: RefObject<T | null>
  /** Attach to the same element as `onKeyDown`. */
  onKeyDown(event: ReactKeyboardEvent): void
  /** Attach to the same element as `onFocus`; React's focus event bubbles. */
  onFocus(event: ReactFocusEvent): void
}

function isUsable(element: HTMLElement): boolean {
  if (element.hasAttribute('disabled')) return false
  if (element.getAttribute('aria-hidden') === 'true') return false
  // `offsetParent` is null for `display:none`, which is how collapsed sections hide.
  return element.offsetParent !== null || element === document.activeElement
}

function itemsWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter(isUsable)
}

/**
 * The item on the adjacent visual row nearest the current horizontal position.
 *
 * Geometry rather than an assumed column count, because the grid is
 * `auto-fill` and the number of columns depends on the width the panel got.
 */
function neighbourByRow(items: readonly HTMLElement[], index: number, direction: 1 | -1): HTMLElement | null {
  const current = items[index]
  if (!current) return null
  const from = current.getBoundingClientRect()
  const start = Math.max(0, index - ROW_SEARCH_WINDOW)
  const end = Math.min(items.length, index + ROW_SEARCH_WINDOW + 1)

  let bestRowTop: number | null = null
  let best: HTMLElement | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (let cursor = start; cursor < end; cursor += 1) {
    if (cursor === index) continue
    const candidate = items[cursor]
    const rect = candidate.getBoundingClientRect()
    const delta = rect.top - from.top
    if (direction === 1 ? delta <= ROW_TOLERANCE : delta >= -ROW_TOLERANCE) continue
    // Only consider the FIRST row past the current one in the chosen direction.
    if (bestRowTop !== null && (direction === 1 ? rect.top > bestRowTop + ROW_TOLERANCE : rect.top < bestRowTop - ROW_TOLERANCE)) {
      continue
    }
    if (bestRowTop === null || (direction === 1 ? rect.top < bestRowTop - ROW_TOLERANCE : rect.top > bestRowTop + ROW_TOLERANCE)) {
      bestRowTop = rect.top
      best = null
      bestDistance = Number.POSITIVE_INFINITY
    }
    const distance = Math.abs(rect.left - from.left)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return best
}

export function useRovingTabIndex<T extends HTMLElement = HTMLDivElement>(): RovingTabIndex<T> {
  const containerRef = useRef<T | null>(null)
  const activeRef = useRef<HTMLElement | null>(null)

  const promote = useCallback((next: HTMLElement | null): void => {
    const previous = activeRef.current
    if (previous && previous !== next) previous.tabIndex = -1
    activeRef.current = next
    if (next) next.tabIndex = 0
  }, [])

  /**
   * Keep exactly one entry point alive. Without this, filtering the gallery
   * down to nothing and back — or collapsing the section holding the active
   * item — would leave the whole region with no tab stop at all, which is a
   * worse failure than the one being fixed.
   */
  const resync = useCallback((): void => {
    const container = containerRef.current
    if (!container) return
    const active = activeRef.current
    if (active && active.isConnected && container.contains(active) && isUsable(active)) {
      // React re-mounts render `tabIndex={-1}`; restore the promotion.
      if (active.tabIndex !== 0) active.tabIndex = 0
      return
    }
    promote(itemsWithin(container)[0] ?? null)
  }, [promote])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined
    resync()
    // One observer for the whole region — the cost must not be per item.
    const observer = new MutationObserver(() => resync())
    observer.observe(container, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [resync])

  const onFocus = useCallback(
    (event: ReactFocusEvent): void => {
      const target = event.target as HTMLElement | null
      if (!target) return
      const item = target.closest<HTMLElement>(ITEM_SELECTOR)
      if (!item || item !== target) return
      promote(item)
    },
    [promote]
  )

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent): void => {
      const container = containerRef.current
      if (!container) return
      const current = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(ITEM_SELECTOR)
      if (!current || !container.contains(current)) return

      const horizontal = event.key === 'ArrowRight' || event.key === 'ArrowLeft'
      const vertical = event.key === 'ArrowDown' || event.key === 'ArrowUp'
      const jump = event.key === 'Home' || event.key === 'End'
      if (!horizontal && !vertical && !jump) return
      // Let the browser's own text caret movement win inside a text field.
      const tag = current.tagName
      if (horizontal && (tag === 'INPUT' || tag === 'TEXTAREA') && (current as HTMLInputElement).type === 'text') return

      const items = itemsWithin(container)
      const index = items.indexOf(current)
      if (index === -1) return

      let next: HTMLElement | null = null
      if (event.key === 'ArrowRight') next = items[index + 1] ?? null
      else if (event.key === 'ArrowLeft') next = items[index - 1] ?? null
      else if (event.key === 'ArrowDown') next = neighbourByRow(items, index, 1) ?? items[items.length - 1] ?? null
      else if (event.key === 'ArrowUp') next = neighbourByRow(items, index, -1) ?? items[0] ?? null
      else if (event.key === 'Home') next = items[0] ?? null
      else if (event.key === 'End') next = items[items.length - 1] ?? null

      if (!next || next === current) {
        // Still swallow the key: an arrow that silently scrolls the page out
        // from under the user is worse than one that does nothing.
        if (horizontal || vertical || jump) event.preventDefault()
        return
      }
      event.preventDefault()
      promote(next)
      next.focus()
    },
    [promote]
  )

  return { containerRef, onKeyDown, onFocus }
}

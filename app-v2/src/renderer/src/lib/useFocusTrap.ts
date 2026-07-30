import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react'

/**
 * Modal focus management: initial focus, a Tab trap, and focus restore.
 *
 * A modal that does not trap Tab lets keyboard focus walk out into the page
 * behind it, where the user is interacting with controls they cannot see. A
 * modal that does not restore focus on close drops the user back at the top of
 * the document, losing their place entirely — that is the half most often
 * forgotten and the most disorienting when missing.
 *
 * Extracted from the Command Palette, which was the only dialog in the app that
 * trapped Tab correctly, and generalised so every dialog shares one behaviour.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[tabindex]:not([tabindex="-1"])'
].join(', ')

/** Tab order inside the container: visible, enabled, not hidden from assistive tech. */
export function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.hasAttribute('disabled')) return false
    if (element.getAttribute('aria-hidden') === 'true') return false
    if (element.closest('[aria-hidden="true"]')) return false
    if (element.tabIndex < 0) return false
    // `offsetParent` is null for `display:none`; dialogs are never `position:fixed` children here.
    return element.offsetParent !== null || element === document.activeElement
  })
}

export interface FocusTrapOptions {
  /** When false the trap does nothing — for dialogs that stay mounted while closed. */
  active?: boolean
  /** Called on Escape. Omit for a dialog that must not be dismissed by keyboard. */
  onEscape?: () => void
  /**
   * Element to focus on open. Defaults to the first focusable descendant, which
   * is what a sighted user's eye lands on too.
   */
  initialFocusRef?: RefObject<HTMLElement | null>
}

export interface FocusTrap<T extends HTMLElement> {
  /** Attach to the element that owns the dialog's focusable content. */
  containerRef: RefObject<T | null>
  /** Attach to the same element (or an ancestor) as `onKeyDown`. */
  onKeyDown(event: ReactKeyboardEvent): void
}

export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(
  options: FocusTrapOptions = {}
): FocusTrap<T> {
  const { active = true, onEscape, initialFocusRef } = options
  const containerRef = useRef<T | null>(null)
  const restoreToRef = useRef<HTMLElement | null>(null)
  const escapeRef = useRef(onEscape)
  escapeRef.current = onEscape

  useEffect(() => {
    if (!active) return undefined

    // Remember where focus came from BEFORE moving it into the dialog.
    const previous = document.activeElement
    restoreToRef.current = previous instanceof HTMLElement ? previous : null

    const frame = window.setTimeout(() => {
      const container = containerRef.current
      if (!container) return
      const explicit = initialFocusRef?.current
      if (explicit) {
        explicit.focus()
        return
      }
      const [first] = focusableWithin(container)
      if (first) {
        first.focus()
        return
      }
      // An empty dialog still has to receive focus, or Tab starts outside it.
      container.tabIndex = -1
      container.focus()
    }, 0)

    return () => {
      window.clearTimeout(frame)
      const restoreTo = restoreToRef.current
      restoreToRef.current = null
      if (!restoreTo || !restoreTo.isConnected) return
      // Restore asynchronously so React has finished unmounting the dialog and
      // cannot steal focus back during the same commit.
      window.setTimeout(() => restoreTo.focus(), 0)
    }
  }, [active, initialFocusRef])

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent): void => {
      if (!active) return

      if (event.key === 'Escape') {
        const escape = escapeRef.current
        if (!escape) return
        event.preventDefault()
        event.stopPropagation()
        escape()
        return
      }

      if (event.key !== 'Tab') return
      const container = containerRef.current
      if (!container) return

      const focusable = focusableWithin(container)
      if (focusable.length === 0) {
        // Nothing to move to: keep focus in the dialog rather than letting it out.
        event.preventDefault()
        return
      }

      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement)
      const nextIndex = event.shiftKey
        ? currentIndex <= 0
          ? focusable.length - 1
          : currentIndex - 1
        : currentIndex === focusable.length - 1 || currentIndex === -1
          ? 0
          : currentIndex + 1

      event.preventDefault()
      focusable[nextIndex]?.focus()
    },
    [active]
  )

  return { containerRef, onKeyDown }
}

// Shared lazy-mount hook for gallery thumbnails.
//
// The audit measured the galleries mounting every production widget host at once —
// 423 catalog variants and ~360 preset cards — which is what produced the >1,269
// listener and 423 Coach-request figures. The inert render contract removed the IPC,
// but the DOM cost is a separate claim: a thumbnail still builds its whole SVG/React
// tree even when it is nowhere near the viewport.
//
// This hook keeps the card container mounted (so counts, layout and automation hooks
// are stable) while deferring the expensive thumbnail until the card is actually
// scrolled into view. It is deliberately a one-way latch: a thumbnail that has been
// seen stays mounted, so scrolling back never re-renders it.

import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/** How far outside the viewport a card starts building its thumbnail. */
export const PREVIEW_VISIBILITY_ROOT_MARGIN = '240px'

export function usePreviewVisible(): [RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null)
  // Environments without IntersectionObserver (SSR, jsdom, the Electron capture
  // harness) render everything, so nothing that relies on a full gallery breaks.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (visible || typeof IntersectionObserver === 'undefined') return
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: PREVIEW_VISIBILITY_ROOT_MARGIN })
    observer.observe(node)
    return () => observer.disconnect()
  }, [visible])
  return [ref, visible]
}

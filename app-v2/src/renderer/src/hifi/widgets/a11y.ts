import { createContext, useContext } from 'react'

/**
 * Accessible name for the widget currently being rendered.
 *
 * Widget roots are `<svg role="img">`. That role makes the SVG a LEAF in the
 * accessibility tree — every `<text>` inside carrying the widget's numbers is
 * pruned — so an unnamed root is not "partly readable", it is completely silent
 * to a screen reader.
 *
 * Each hi-fi module already declares a human `title`, and the registry publishes
 * it here, so a root only has to ask for it rather than every one of the ~840
 * modules threading a label by hand.
 */
const WidgetLabelContext = createContext<string | undefined>(undefined)

export const WidgetLabelProvider = WidgetLabelContext.Provider

export interface SurfaceRoleProps {
  role?: 'img'
  'aria-label'?: string
}

/**
 * Props for a widget's root `<svg>`.
 *
 * With a name it claims `role="img"` and carries that name. Without one it
 * deliberately claims NO image role, so the SVG stays a graphics document and
 * its text content remains readable instead of being pruned behind a nameless
 * image.
 */
export function useSurfaceRole(explicitLabel?: string): SurfaceRoleProps {
  const inherited = useContext(WidgetLabelContext)
  const label = (explicitLabel ?? inherited)?.trim()
  return label ? { role: 'img', 'aria-label': label } : {}
}

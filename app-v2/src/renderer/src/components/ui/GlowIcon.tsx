import type { HTMLAttributes, ReactElement, ReactNode } from 'react'
import './ui.css'

export type GlowIconTone = 'accent' | 'good' | 'danger'
export type GlowIconSize = 'sm' | 'md' | 'lg'

export interface GlowIconProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode
  tone?: GlowIconTone
  size?: GlowIconSize
  /** Adds a hover lift + stronger glow. */
  interactive?: boolean
}

/**
 * Square icon chip with a neon glow halo — wrap any glyph, emoji or SVG icon.
 */
export function GlowIcon({
  children,
  tone = 'accent',
  size = 'md',
  interactive = false,
  className,
  ...rest
}: GlowIconProps): ReactElement {
  return (
    <span
      className={['ui-glow-icon', className].filter(Boolean).join(' ')}
      data-tone={tone === 'accent' ? undefined : tone}
      data-size={size === 'md' ? undefined : size}
      data-interactive={interactive || undefined}
      {...rest}
    >
      {children}
    </span>
  )
}

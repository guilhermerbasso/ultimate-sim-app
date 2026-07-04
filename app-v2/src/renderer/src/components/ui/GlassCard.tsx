import type { HTMLAttributes, ReactElement, ReactNode } from 'react'
import './ui.css'

export interface GlassCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Optional heading shown in the card header row. */
  title?: ReactNode
  /** Optional element rendered on the right side of the header. */
  action?: ReactNode
  /** Use the higher (overlay) surface + stronger shadow. */
  elevated?: boolean
  /** Highlight the card with the accent border + soft glow. */
  accent?: boolean
  /** Lift + glow on hover. */
  interactive?: boolean
}

/**
 * Rounded, elevated glass panel — the workhorse container for the modern
 * dashboard look. Reskins automatically with the active theme tokens and
 * degrades to a clean flat panel on non-glass themes.
 */
export function GlassCard({
  title,
  action,
  elevated = false,
  accent = false,
  interactive = false,
  className,
  children,
  ...rest
}: GlassCardProps): ReactElement {
  return (
    <div
      className={['ui-glass-card', className].filter(Boolean).join(' ')}
      data-elevated={elevated || undefined}
      data-accent={accent || undefined}
      data-interactive={interactive || undefined}
      {...rest}
    >
      {(title || action) && (
        <div className="ui-glass-card__header">
          {title ? <h3 className="ui-glass-card__title">{title}</h3> : <span />}
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

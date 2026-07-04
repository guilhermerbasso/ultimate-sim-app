import type { HTMLAttributes, ReactElement, ReactNode } from 'react'
import './ui.css'

export type StatTone = 'default' | 'accent' | 'good' | 'danger'

export interface NeonStatTileProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode
  value: ReactNode
  /** Optional leading icon (e.g. a GlowIcon). */
  icon?: ReactNode
  /** Colour of the value text — accent gets a neon text glow. */
  tone?: StatTone
  /** Optional delta string (e.g. "+2.4"). */
  delta?: ReactNode
  /** Direction of the delta — drives good/bad colour. */
  deltaDir?: 'up' | 'down'
  /** Lift + glow on hover. */
  interactive?: boolean
}

/**
 * Compact stat tile with a glowing value and optional icon + delta — the clean
 * stat rows from the reference dashboard.
 */
export function NeonStatTile({
  label,
  value,
  icon,
  tone = 'default',
  delta,
  deltaDir,
  interactive = false,
  className,
  ...rest
}: NeonStatTileProps): ReactElement {
  return (
    <div
      className={['ui-stat-tile', className].filter(Boolean).join(' ')}
      data-interactive={interactive || undefined}
      {...rest}
    >
      {icon && <div className="ui-stat-tile__icon">{icon}</div>}
      <div className="ui-stat-tile__body">
        <span className="ui-stat-tile__label">{label}</span>
        <span className="ui-stat-tile__value" data-tone={tone === 'default' ? undefined : tone}>
          {value}
        </span>
      </div>
      {delta != null && (
        <span className="ui-stat-tile__delta" data-dir={deltaDir}>
          {delta}
        </span>
      )}
    </div>
  )
}

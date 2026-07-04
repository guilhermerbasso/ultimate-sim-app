import type { HTMLAttributes, ReactElement, ReactNode } from 'react'
import './ui.css'

export type GradientBarTone = 'accent' | 'good' | 'danger'

export interface GradientBarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Progress value 0–1 (clamped). */
  value: number
  /** Optional label shown above the bar. */
  label?: ReactNode
  /** Optional formatted value shown above the bar (defaults to a percentage). */
  valueLabel?: ReactNode
  /** Colour of the fill — accent uses the themed gradient + glow. */
  tone?: GradientBarTone
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * Slim progress / meter bar with a glowing gradient fill. Use for fuel, tyre,
 * adoption or any 0–1 metric.
 */
export function GradientBar({
  value,
  label,
  valueLabel,
  tone = 'accent',
  className,
  ...rest
}: GradientBarProps): ReactElement {
  const pct = clamp01(value)
  const showHead = label != null || valueLabel != null
  return (
    <div className={['ui-gradient-bar', className].filter(Boolean).join(' ')} {...rest}>
      {showHead && (
        <div className="ui-gradient-bar__head">
          <span>{label}</span>
          <span className="ui-gradient-bar__value">
            {valueLabel ?? `${Math.round(pct * 100)}%`}
          </span>
        </div>
      )}
      <div
        className="ui-gradient-bar__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct * 100)}
      >
        <div
          className="ui-gradient-bar__fill"
          data-tone={tone === 'accent' ? undefined : tone}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  )
}

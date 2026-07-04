import type { ReactElement, ReactNode } from 'react'
import './ui.css'

export interface PillToggleProps {
  checked: boolean
  onChange(next: boolean): void
  label?: ReactNode
  disabled?: boolean
  className?: string
  /** Accessible label when no visible label is provided. */
  ariaLabel?: string
}

/**
 * Rounded pill toggle with a glowing active track — the pill toggles from the
 * reference kit. Fully keyboard accessible.
 */
export function PillToggle({
  checked,
  onChange,
  label,
  disabled = false,
  className,
  ariaLabel
}: PillToggleProps): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={['ui-pill-toggle', className].filter(Boolean).join(' ')}
      data-on={checked || undefined}
      data-disabled={disabled || undefined}
      style={{ appearance: 'none', font: 'inherit' }}
    >
      <span className="ui-pill-toggle__track" aria-hidden="true">
        <span className="ui-pill-toggle__knob" />
      </span>
      {label != null && <span className="ui-pill-toggle__label">{label}</span>}
    </button>
  )
}

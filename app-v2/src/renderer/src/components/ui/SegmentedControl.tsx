import type { ReactElement, ReactNode } from 'react'
import './ui.css'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>
  value: T
  onChange(value: T): void
  className?: string
  ariaLabel?: string
}

/**
 * Pill segmented control — the active segment fills with the themed gradient
 * and a soft glow. Good for view/mode switching in dashboards and overlays.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  ariaLabel
}: SegmentedControlProps<T>): ReactElement {
  return (
    <div
      className={['ui-segmented', className].filter(Boolean).join(' ')}
      role="tablist"
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          disabled={option.disabled}
          className="ui-segmented__item"
          data-active={option.value === value || undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

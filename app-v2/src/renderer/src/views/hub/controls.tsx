// Small, strictly-typed form controls + hardware previews for the Hardware Hub.
// Kept presentational and dependency-light so the editors stay declarative.

import type { ReactElement, ReactNode } from 'react'
import { ACCENT, badge, clampNumber, helper, input, inputInvalid, label } from './styles'

interface FieldProps {
  caption: string
  hint?: string
  children: ReactNode
}

export function Field({ caption, hint, children }: FieldProps): ReactElement {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={label}>{caption}</span>
      {children}
      {hint ? <span style={{ ...helper, margin: 0 }}>{hint}</span> : null}
    </label>
  )
}

interface TextFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  invalid?: boolean
  list?: string
}

export function TextField({ value, onChange, placeholder, invalid, list }: TextFieldProps): ReactElement {
  return (
    <input
      type="text"
      value={value}
      list={list}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      style={invalid ? { ...input, ...inputInvalid } : input}
    />
  )
}

interface NumberFieldProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
}

export function NumberField({ value, onChange, min, max, step }: NumberFieldProps): ReactElement {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      step={step}
      onChange={(event) => {
        const next = Number(event.target.value)
        const lo = min ?? Number.NEGATIVE_INFINITY
        const hi = max ?? Number.POSITIVE_INFINITY
        onChange(clampNumber(next, lo, hi))
      }}
      style={input}
    />
  )
}

export interface SelectOption<T extends string> {
  value: T
  label: string
}

interface SelectFieldProps<T extends string> {
  value: T
  options: ReadonlyArray<SelectOption<T>>
  onChange: (value: T) => void
}

export function SelectField<T extends string>({ value, options, onChange }: SelectFieldProps<T>): ReactElement {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as T)} style={input}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  caption: string
}

export function Toggle({ checked, onChange, caption }: ToggleProps): ReactElement {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontSize: 13 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        style={{ accentColor: ACCENT, width: 16, height: 16 }}
      />
      <span>{caption}</span>
    </label>
  )
}

interface SliderProps {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  format?: (value: number) => string
}

export function Slider({ value, min, max, step, onChange, format }: SliderProps): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={(event) => onChange(clampNumber(Number(event.target.value), min, max))}
        style={{ flex: 1, accentColor: ACCENT }}
      />
      <strong style={{ minWidth: 52, textAlign: 'right', fontSize: 13 }}>
        {format ? format(value) : value}
      </strong>
    </div>
  )
}

export function Badge({ children }: { children: ReactNode }): ReactElement {
  return <span style={badge}>{children}</span>
}

// ─── Hardware previews ───────────────────────────────────────────────────────

// Green→amber→red gradient row, opacity scaled by brightness (SimHub-like).
export function StripPreview({ count, brightness }: { count: number; brightness: number }): ReactElement {
  const shown = Math.max(0, Math.min(count, 32))
  const opacity = clampNumber(brightness / 255, 0.15, 1)
  const leds = Array.from({ length: shown }, (_, index) => {
    const t = shown <= 1 ? 0 : index / (shown - 1)
    const hue = 120 - t * 120
    return `hsl(${hue}, 85%, 52%)`
  })
  return (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center', padding: '6px 0', flexWrap: 'wrap' }}>
      {leds.map((color, index) => (
        <span
          key={index}
          aria-hidden="true"
          style={{
            background: color,
            opacity,
            borderRadius: '50%',
            width: 16,
            height: 16,
            
          }}
        />
      ))}
      {count > shown ? <span style={{ ...helper, margin: 0 }}>+{count - shown}</span> : null}
      {shown === 0 ? <span style={{ ...helper, margin: 0 }}>0 LEDs</span> : null}
    </div>
  )
}

// width×height grid with a checkered "flag" hint, opacity scaled by brightness.
export function MatrixPreview({
  width,
  height,
  brightness
}: {
  width: number
  height: number
  brightness: number
}): ReactElement {
  const cols = Math.max(1, Math.min(width, 32))
  const rows = Math.max(1, Math.min(height, 32))
  const opacity = clampNumber(brightness / 255, 0.15, 1)
  const cells: ReactElement[] = []
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const on = (x + y) % 2 === 0
      cells.push(
        <span
          key={`${x}-${y}`}
          aria-hidden="true"
          style={{
            background: on ? ACCENT : 'rgba(255,255,255,0.08)',
            opacity: on ? opacity : 1,
            borderRadius: 'var(--radius-sm)',
            width: 14,
            height: 14
          }}
        />
      )
    }
  }
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 14px)`,
        gap: 3,
        padding: '6px 0',
        width: 'fit-content'
      }}
    >
      {cells}
    </div>
  )
}

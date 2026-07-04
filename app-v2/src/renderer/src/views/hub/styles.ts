// Shared inline-style tokens + small helpers for the Hardware Hub view.
//
// The hub keeps the dark-card aesthetic of the other ButtonBox views
// (see RevlightsView/ArduinosView) but adopts the SimHub-style blue accent
// requested for this screen. Everything is self-contained inline styles so the
// new view doesn't depend on extra CSS classes.

import type { CSSProperties } from 'react'
import type { BoardInfo, PinRole } from '../../../../shared/devices'

export const ACCENT = 'var(--accent-primary)'
export const ACCENT_SOFT = 'rgba(232,105,32,0.14)'
export const ACCENT_BORDER = 'rgba(232,105,32,0.55)'
export const DANGER = 'var(--accent-danger)'
export const DANGER_SOFT = 'rgba(209,52,56,0.14)'
export const MUTED = 'rgba(255,255,255,0.6)'

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

export function clampInt(value: number, min: number, max: number): number {
  return Math.round(clampNumber(value, min, max))
}

// ─── Layout ────────────────────────────────────────────────────────────────

export const shell: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(260px, 0.78fr) minmax(440px, 1.22fr)',
  gap: 18,
  alignItems: 'start'
}

export const panel: CSSProperties = {
  background: 'var(--surface-raised)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 'var(--radius-sm)',
  padding: 18
}

export const card: CSSProperties = {
  background: 'rgba(255,255,255,0.035)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 'var(--radius-sm)',
  padding: 14
}

export const label: CSSProperties = {
  color: 'rgba(255,255,255,0.56)',
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: 1.5,
  textTransform: 'uppercase'
}

export const helper: CSSProperties = {
  color: MUTED,
  fontSize: 12.5,
  lineHeight: 1.5,
  margin: '6px 0 0'
}

// ─── Form controls ───────────────────────────────────────────────────────────

export const input: CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 'var(--radius-sm)',
  color: 'inherit',
  fontSize: 13,
  padding: '8px 10px',
  width: '100%',
  boxSizing: 'border-box',
  accentColor: ACCENT
}

export const inputInvalid: CSSProperties = {
  borderColor: DANGER,
  background: DANGER_SOFT
}

export const badge: CSSProperties = {
  alignItems: 'center',
  background: ACCENT_SOFT,
  border: `1px solid ${ACCENT_BORDER}`,
  borderRadius: 'var(--radius-sm)',
  color: 'var(--accent-primary)',
  display: 'inline-flex',
  fontSize: 11,
  fontWeight: 700,
  gap: 6,
  letterSpacing: 0.4,
  padding: '2px 9px'
}

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'soft'

export function buttonStyle(variant: ButtonVariant = 'ghost', active = false): CSSProperties {
  const base: CSSProperties = {
    border: '1px solid transparent',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    fontSize: 12.5,
    fontWeight: 700,
    padding: '8px 13px',
    transition: 'background 120ms ease, border-color 120ms ease'
  }
  switch (variant) {
    case 'primary':
      return { ...base, background: ACCENT, borderColor: ACCENT, color: '#06121f' }
    case 'danger':
      return { ...base, background: 'transparent', borderColor: 'rgba(209,52,56,0.5)', color: '#ff8a8d' }
    case 'soft':
      return {
        ...base,
        background: active ? ACCENT_SOFT : 'rgba(255,255,255,0.04)',
        borderColor: active ? ACCENT_BORDER : 'rgba(255,255,255,0.14)',
        color: active ? 'var(--accent-primary)' : 'rgba(255,255,255,0.82)'
      }
    case 'ghost':
    default:
      return {
        ...base,
        background: 'transparent',
        borderColor: active ? ACCENT_BORDER : 'rgba(255,255,255,0.18)',
        color: active ? 'var(--accent-primary)' : 'rgba(255,255,255,0.82)'
      }
  }
}

// ─── Pin suggestions (datalist hints from the selected board) ────────────────

function detectPrefix(board: BoardInfo): string {
  return board.pwmPins.some((pin) => pin.startsWith('GPIO')) ? 'GPIO' : 'D'
}

function generatedDigital(board: BoardInfo): string[] {
  const prefix = detectPrefix(board)
  const count = clampInt(board.digitalPins, 0, 24)
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`)
}

function generatedAnalog(board: BoardInfo): string[] {
  const count = clampInt(board.analogPins, 0, 16)
  return Array.from({ length: count }, (_, index) => `A${index}`)
}

// Suggest physically-sensible pin labels for a given role on the selected board.
export function pinSuggestions(board: BoardInfo, role: PinRole): string[] {
  let pins: string[]
  switch (role.kind) {
    case 'pwm':
      pins = board.pwmPins.length > 0 ? board.pwmPins : generatedDigital(board)
      break
    case 'i2c':
      if (role.role === 'sda') pins = board.i2cPins ? [board.i2cPins.sda] : []
      else if (role.role === 'scl') pins = board.i2cPins ? [board.i2cPins.scl] : []
      else pins = board.i2cPins ? [board.i2cPins.sda, board.i2cPins.scl] : []
      break
    case 'analog':
      pins = generatedAnalog(board)
      break
    case 'digital':
      pins = generatedDigital(board)
      break
    case 'any':
    default:
      pins = [...generatedDigital(board), ...generatedAnalog(board)]
      break
  }
  return Array.from(new Set(pins.filter(Boolean)))
}

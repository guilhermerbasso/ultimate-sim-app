export function formatGear(gear?: number): string {
  if (gear === undefined) return '—'
  if (gear < 0) return 'R'
  if (gear === 0) return 'N'
  return String(gear)
}

export function formatTime(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—:--.---'
  const sign = seconds < 0 ? '-' : ''
  const abs = Math.abs(seconds)
  const minutes = Math.floor(abs / 60)
  const rest = abs - minutes * 60
  return `${sign}${minutes}:${rest.toFixed(3).padStart(6, '0')}`
}

export function formatDelta(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—'
  const sign = seconds > 0 ? '+' : seconds < 0 ? '-' : '±'
  return `${sign}${Math.abs(seconds).toFixed(3)}`
}

export function pct(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

export function pctOrUndefined(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(1, value))
}

export function numberOrDash(value?: number, digits = 0): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

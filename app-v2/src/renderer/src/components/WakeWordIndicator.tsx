// Tiny, unobtrusive status pill for the "Oi, Engenheiro" wake word. Drop it into the
// app shell (a corner) to show whether the mic is listening / heard the wake word /
// is processing. Self-contained inline styles — no CSS file edits required.
//
// Colour intent (per design): WARM tones for chrome/neutral states; a COOL/GREEN accent
// is used ONLY for the positive "listening OK" state.

import type { CSSProperties, ReactElement } from 'react'
import { useEffect, useState } from 'react'
import { getWakeWordState, subscribeWakeWordState, type WakeWordState, type WakeWordStatus } from '../lib/wake-word'

interface StatusVisual {
  label: string
  /** Dot + text colour. */
  color: string
  /** Pill background. */
  bg: string
  /** Pill border. */
  border: string
  pulse: boolean
}

function visualFor(status: WakeWordStatus): StatusVisual {
  switch (status) {
    case 'listening':
      // The ONLY cool/green positive state.
      return { label: 'Listening', color: '#34d399', bg: 'rgba(16, 64, 52, 0.55)', border: 'rgba(52, 211, 153, 0.45)', pulse: true }
    case 'heard':
      return { label: 'Hi, Engineer', color: '#fbbf24', bg: 'rgba(74, 54, 16, 0.6)', border: 'rgba(251, 191, 36, 0.5)', pulse: true }
    case 'processing':
      return { label: 'Processing…', color: '#fb923c', bg: 'rgba(74, 40, 16, 0.6)', border: 'rgba(251, 146, 60, 0.5)', pulse: true }
    case 'denied':
      return { label: 'Mic permission denied', color: '#f87171', bg: 'rgba(74, 22, 22, 0.6)', border: 'rgba(248, 113, 113, 0.5)', pulse: false }
    case 'inactive':
    default:
      return { label: 'Voice disabled', color: '#a8a29e', bg: 'rgba(41, 37, 36, 0.55)', border: 'rgba(168, 162, 158, 0.35)', pulse: false }
  }
}

export interface WakeWordIndicatorProps {
  /** Hide entirely while inactive (default false — show a muted "off" pill). */
  hideWhenInactive?: boolean
  /** Extra style overrides (e.g. positioning) merged onto the pill. */
  style?: CSSProperties
}

export function WakeWordIndicator({ hideWhenInactive = false, style }: WakeWordIndicatorProps): ReactElement | null {
  const [wake, setWake] = useState<WakeWordState>(getWakeWordState())

  useEffect(() => subscribeWakeWordState(setWake), [])

  if (hideWhenInactive && wake.status === 'inactive') return null

  const v = visualFor(wake.status)
  const pill: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1,
    letterSpacing: 0.2,
    color: v.color,
    background: v.bg,
    border: `1px solid ${v.border}`,
    backdropFilter: 'blur(6px)',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    ...style
  }
  const dot: CSSProperties = {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: v.color,
    boxShadow: v.pulse ? `0 0 6px ${v.color}` : 'none',
    animation: v.pulse ? 'wakeword-pulse 1.3s ease-in-out infinite' : 'none'
  }

  return (
    <div style={pill} role="status" aria-live="polite" title="Wake word — say “Hi, Engineer”">
      <style>{'@keyframes wakeword-pulse{0%,100%{opacity:1}50%{opacity:0.35}}'}</style>
      <span style={dot} />
      <span>{v.label}</span>
    </div>
  )
}

export default WakeWordIndicator

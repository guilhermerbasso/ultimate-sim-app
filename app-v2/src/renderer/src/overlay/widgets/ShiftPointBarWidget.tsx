// SHIFT POINT overlay — a transparent, title-less LED ladder. The placed width and
// height are independent, and the shared rev-light rule owns the blue strobe state.
//
// The ladder is driven by shiftIndicatorPct (0..1 along the car's shift band — the
// correct signal, never rpm/maxRpm), then revLights.pct and the shared top-slice
// redline fallback. This is purely the
// on-screen VISUAL ladder; the RGB-matrix / firmware rev-light engine is untouched.
// Every input is optional and degrades to "—" so a null snapshot never renders NaN.

import type { ReactElement } from 'react'
import { resolveSkin } from '../../skins'
import { resolveRevLightPct, resolveRevLightState } from '../../lib/rev-lights'
import { LedShiftBar } from './LedShiftBar'
import type { WidgetProps } from './types'

export const SHIFT_POINT_BAR_STREAM_SAFE = true

function positiveDimension(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

export function ShiftPointBarWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const W = positiveDimension(config.position?.width, 360)
  const H = positiveDimension(config.position?.height, 90)
  const state = resolveRevLightState(resolveRevLightPct(snapshot), snapshot?.revLights?.blink)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      role="img"
      aria-label="Shift point ladder"
      data-widget="shiftPointBar"
      style={{ display: 'block', background: 'transparent' }}
    >
      <LedShiftBar
        pct={state.pct}
        blink={state.atShiftPoint}
        segments={skin.led.count}
        height={H}
      />
    </svg>
  )
}

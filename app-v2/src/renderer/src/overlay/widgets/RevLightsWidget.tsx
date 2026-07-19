// REV LIGHTS overlay — transparent, title-less and driven by the shared rev-light
// state/strobe rule. Width and height are independent: the LED rig receives the
// placed box directly and stretches across its full width.
//
// The ladder is driven by shiftIndicatorPct (0..1 along the car's shift band — the
// correct signal, never rpm/maxRpm), then revLights.pct and the shared top-slice
// redline fallback. This is purely the
// VISUAL overlay; the RGB-matrix / firmware rev-light engine is untouched. Every input is
// optional and degrades to 0 % so a null snapshot never renders NaN.

import type { ReactElement } from 'react'
import { resolveSkin } from '../../skins'
import { RevLedBar } from '../../instruments'
import { resolveRevLightPct, resolveRevLightState } from '../../lib/rev-lights'
import { overlayDesignFamily } from '../../../../shared/overlays'
import type { WidgetProps } from './types'

function positiveDimension(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

export function RevLightsWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const family = overlayDesignFamily(config.stylePreset)
  const W = positiveDimension(config.position?.width, 360)
  const H = positiveDimension(config.position?.height, 120)
  const state = resolveRevLightState(resolveRevLightPct(snapshot), snapshot?.revLights?.blink)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      role="img"
      aria-label="Rev lights"
      data-widget="revlights"
      data-family={family}
      className={`rc-fam-${family}`}
      style={{ display: 'block', background: 'transparent' }}
    >
      <RevLedBar
        pct={state.pct}
        profile={skin.led}
        x={0}
        y={0}
        width={W}
        height={H}
        redlineFlash
        shiftActive={state.atShiftPoint}
        idPrefix="revlights"
      />
    </svg>
  )
}

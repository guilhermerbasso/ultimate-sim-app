// ENGINE TELL-TALES overlay — a FIA/GT3-style bank of warning lamps driven by the
// decoded iRacing EngineWarnings bitfield (snapshot.engineWarnings). Rebuilt on the
// v2.39 KIT contract: ONE root <svg viewBox=W×H preserveAspectRatio="xMidYMid meet">
// so nothing can overflow, lamps snap to fixed makeGrid cells (icons drawn in a fixed
// inner box, never sized to content) and every label auto-fits via <FitText> (no more
// clamp() micro-type). Each lamp lights warm — amber (advisory) or red (hard fault) —
// and stays dimmed when clear; cool/green is never used (an engine warning is never a
// "good" state). When the field is absent every lamp degrades to a dimmed "—" sheet so
// it never renders NaN / undefined / a false alarm.

import type { ReactElement } from 'react'
import { resolveSkin, FitText, makeGrid } from '../../skins'
import { TelltaleIcon } from '../../instruments'
import { DASH, FONT_COND } from './dashboard-tiles'
import type { MotorsportIconId } from '../../icons/motorsport'
import type { EngineWarnings } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'

export const ENGINE_TELL_TALES_STREAM_SAFE = true

const DIM = 'rgba(150,162,178,0.42)'

type Sev = 'amber' | 'red'

interface Lamp {
  key: keyof EngineWarnings
  icon: MotorsportIconId
  label: string
  sev: Sev
}

// Lamp order mirrors a real GT3 tell-tale strip: hard engine faults (pressure / temp /
// stall / mandatory damage) burn RED; advisory states (rev + pit limiter, optional
// repair) burn AMBER. Icon ids come from the shared motorsport registry.
const LAMPS: Lamp[] = [
  { key: 'oilPressure', icon: 'oil-pressure', label: 'OIL P', sev: 'red' },
  { key: 'waterTemp', icon: 'water-temp', label: 'H2O', sev: 'red' },
  { key: 'oilTemp', icon: 'oil-temp', label: 'OIL T', sev: 'red' },
  { key: 'fuelPressure', icon: 'fuel', label: 'FUEL P', sev: 'red' },
  { key: 'stalled', icon: 'ignition', label: 'STALL', sev: 'red' },
  { key: 'revLimiter', icon: 'engine', label: 'REV', sev: 'amber' },
  { key: 'pitLimiter', icon: 'pit-limiter', label: 'PIT', sev: 'amber' },
  { key: 'mandRepair', icon: 'damage', label: 'REPAIR', sev: 'red' },
  { key: 'optRepair', icon: 'damage', label: 'OPT REP', sev: 'amber' }
]

function sevColor(sev: Sev): string {
  return sev === 'red' ? DASH.red : DASH.amber
}

export function EngineTellTalesWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const W = Math.max(160, config.position?.width || 360)
  const H = Math.max(120, config.position?.height || 200)

  const warnings = snapshot?.engineWarnings
  const present = !!warnings

  const pad = Math.max(6, Math.round(W * 0.03))

  // Lamp region: a 3×3 transparent grid. Each cell reserves separate symbol and
  // label bands so glyph artwork and text never collide.
  const gx = pad
  const gy = pad
  const gw = W - pad * 2
  const gh = H - gy - pad
  const grid = makeGrid(3, 3, gw, gh, Math.max(6, Math.round(W * 0.02)))

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      role="img"
      aria-label="Engine warning lamps"
      data-widget="engineTellTales"
    >
      {/* Lamp grid — fixed cells with separate icon and label bands. */}
      <g transform={`translate(${gx},${gy})`}>
        {LAMPS.map((lamp, i) => {
          const col = i % 3
          const row = Math.floor(i / 3)
          const cell = grid.cell(col, row)
          const lit = present && !!warnings?.[lamp.key]
          const color = sevColor(lamp.sev)
          const labelH = Math.max(10, Math.min(15, cell.h * 0.22))
          const iconBandH = Math.max(12, cell.h - labelH - 4)
          const iconSize = Math.max(12, Math.min(cell.w * 0.72, iconBandH * 0.86))
          const ix = cell.x + (cell.w - iconSize) / 2
          const iy = cell.y + (iconBandH - iconSize) / 2
          return (
            <g key={lamp.key}>
              <g transform={`translate(${ix},${iy})`}>
                {lamp.key === 'pitLimiter' ? (
                  // The registry pit-limiter glyph embeds a 7px "PIT" caption whose CSS
                  // font-size stays 7px regardless of SVG scaling (viewBox scaling is a
                  // paint transform, not a font-size change), so it always trips the
                  // tiny-text linter. Draw a text-free speed-limiter mark instead — a
                  // ring crossed by a bar — which reads the same and never emits <text>.
                  <svg
                    width={iconSize}
                    height={iconSize}
                    viewBox="0 0 24 24"
                    role="img"
                    aria-label={lamp.label}
                    aria-pressed={lit}
                    style={{ display: 'block', overflow: 'visible' }}
                  >
                    <g color={lit ? color : DIM} opacity={lit ? 1 : 0.5}>
                      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
                      <rect x="5.5" y="10.5" width="13" height="3" rx="1.5" fill="currentColor" />
                    </g>
                  </svg>
                ) : (
                  <TelltaleIcon
                    icon={lamp.icon}
                    active={lit}
                    activeColor={color}
                    inactiveColor={DIM}
                    size={iconSize}
                    glow={lit}
                    label={lamp.label}
                    idPrefix={`engine-tt-${lamp.key}`}
                  />
                )}
              </g>
              <FitText
                x={cell.x + cell.w / 2}
                y={cell.y + iconBandH + labelH / 2}
                boxW={cell.w - 4}
                boxH={labelH}
                text={lamp.label}
                anchor="middle"
                baseline="middle"
                fontFamily={FONT_COND}
                fill={lit ? color : DIM}
                weight={800}
                minFontPx={8}
                maxFontPx={labelH}
                letterSpacing={0.5}
              />
            </g>
          )
        })}
      </g>
    </svg>
  )
}

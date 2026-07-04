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
  const hud = skin.id === 'hud'
  const W = Math.max(160, config.position?.width || 360)
  const H = Math.max(120, config.position?.height || 200)

  const warnings = snapshot?.engineWarnings
  const present = !!warnings
  const activeCount = warnings ? LAMPS.filter((l) => warnings[l.key]).length : 0
  const worst: Sev | null = warnings
    ? LAMPS.some((l) => warnings[l.key] && l.sev === 'red')
      ? 'red'
      : activeCount > 0
        ? 'amber'
        : null
    : null

  // No warnings is the normal state — neutral chrome, not decorative green (this panel
  // only signals trouble; green is reserved for genuine "good" telemetry states).
  const statusText = !present ? '—' : activeCount === 0 ? 'CLEAR' : `${activeCount}`
  const statusColor = worst ? sevColor(worst) : DASH.textDim

  const pad = Math.max(6, Math.round(W * 0.03))
  const headerH = Math.max(22, Math.round(H * 0.17))
  const statusW = Math.max(78, Math.round(W * 0.26))
  const headerY = pad
  const titleW = W - pad * 2 - statusW - pad

  // Lamp region: a 3×3 grid below the header, snapped to fixed cells.
  const gx = pad
  const gy = headerY + headerH + Math.max(4, Math.round(H * 0.03))
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
      <rect
        x={0.75}
        y={0.75}
        width={W - 1.5}
        height={H - 1.5}
        rx={skin.material.radius}
        fill={hud ? skin.palette.surface : skin.palette.bg}
        stroke={skin.material.border}
        strokeWidth={skin.material.borderWidth}
        fillOpacity={hud ? 0.72 : 1}
      />

      {/* Title */}
      <FitText
        x={pad + 2}
        y={headerY + headerH / 2}
        boxW={titleW}
        boxH={headerH}
        text="Engine Warnings"
        anchor="start"
        baseline="middle"
        fontFamily={FONT_COND}
        fill={worst ? statusColor : skin.palette.textDim}
        weight={800}
        minFontPx={11}
        maxFontPx={Math.min(20, headerH)}
        letterSpacing={0.8}
      />

      {/* WARN status — a labelled panel with an accessible "WARN <n>" name. */}
      <g role="img" aria-label={`WARN ${statusText}`}>
        <rect
          x={W - pad - statusW}
          y={headerY}
          width={statusW}
          height={headerH}
          rx={Math.min(8, skin.material.radius)}
          fill={skin.palette.surface}
          stroke={worst ? statusColor : skin.material.border}
          strokeWidth={worst ? 1.5 : skin.material.borderWidth}
        />
        <FitText
          x={W - pad - statusW + 8}
          y={headerY + headerH / 2}
          boxW={statusW * 0.42}
          boxH={headerH * 0.7}
          text="WARN"
          anchor="start"
          baseline="middle"
          fontFamily={FONT_COND}
          fill={skin.palette.textDim}
          weight={700}
          minFontPx={11}
          maxFontPx={Math.min(15, headerH * 0.7)}
          letterSpacing={0.6}
        />
        <FitText
          x={W - pad - 10}
          y={headerY + headerH / 2}
          boxW={statusW * 0.4}
          boxH={headerH * 0.82}
          text={statusText}
          anchor="end"
          baseline="middle"
          fontFamily={FONT_COND}
          fill={statusColor}
          weight={800}
          minFontPx={12}
          maxFontPx={Math.min(24, headerH * 0.82)}
        />
      </g>

      {/* Lamp grid — fixed cells; icons drawn in a fixed inner box (never sized to
          content), so a symbol can never overflow. */}
      <g transform={`translate(${gx},${gy})`}>
        {LAMPS.map((lamp, i) => {
          const col = i % 3
          const row = Math.floor(i / 3)
          const cell = grid.cell(col, row)
          const lit = present && !!warnings?.[lamp.key]
          const color = sevColor(lamp.sev)
          const iconSize = Math.max(12, Math.min(cell.w, cell.h) * 0.7)
          const ix = cell.x + (cell.w - iconSize) / 2
          const iy = cell.y + (cell.h - iconSize) / 2
          return (
            <g key={lamp.key}>
              <rect
                x={cell.x}
                y={cell.y}
                width={cell.w}
                height={cell.h}
                rx={8}
                fill={lit ? color : skin.palette.surface}
                fillOpacity={lit ? 0.16 : 1}
                stroke={lit ? color : skin.material.border}
                strokeWidth={lit ? 1.5 : 1}
              />
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
            </g>
          )
        })}
      </g>
    </svg>
  )
}

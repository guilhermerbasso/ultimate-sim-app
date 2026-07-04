// PACE / RESTART overlay — a compact GT3 race-control tile for iRacing's formation
// state: the pace MODE decoded from irsdk_PaceMode (snapshot.paceMode) plus the
// active pace FLAGS decoded from the irsdk_PaceFlags bitfield (snapshot.paceFlags —
// END OF LINE / FREE PASS / WAVED AROUND).
//
// v2.39 rebuild: one root <svg> (fixed viewBox + preserveAspectRatio="meet") so it
// can't overflow, all text auto-fitted by <FitText>, all colour from skin tokens
// (resolveSkin). Colour discipline (warm-only): an active pacing formation reads
// amber chrome; FREE PASS (a positive grant) is the one green chip; NOT PACING / no
// flags fall back to neutral dim. Mode degrades to "—" and flags to "NONE" when
// absent so it never renders undefined.

import type { ReactElement } from 'react'
import { resolveSkin, FitText } from '../../skins'
import type { SkinToken } from '../../skins'
import type { PaceMode } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'

export const PACE_RESTART_STREAM_SAFE = true

const DEFAULT_W = 360
const DEFAULT_H = 150

interface ModeModel {
  label: string
  pacing: boolean
}

const MODES: Record<PaceMode, ModeModel> = {
  singleFileStart: { label: 'SINGLE FILE · START', pacing: true },
  doubleFileStart: { label: 'DOUBLE FILE · START', pacing: true },
  singleFileRestart: { label: 'SINGLE FILE · RESTART', pacing: true },
  doubleFileRestart: { label: 'DOUBLE FILE · RESTART', pacing: true },
  notPacing: { label: 'NOT PACING', pacing: false }
}

const MISSING_MODE: ModeModel = { label: '—', pacing: false }

// Human labels for each pace-flag name. FREE PASS is a positive grant → the one
// green chip; the rest are warm amber chrome.
const FLAG_LABELS: Record<string, { label: string; green: boolean }> = {
  endOfLine: { label: 'END OF LINE', green: false },
  freePass: { label: 'FREE PASS', green: true },
  wavedAround: { label: 'WAVED AROUND', green: false }
}

function modeColor(model: ModeModel, skin: SkinToken): string {
  return model.pacing ? skin.palette.warn : skin.palette.textDim
}

export function PaceRestartWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const glass = skin.id === 'hud'
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))

  const mode = snapshot?.paceMode
  const model = mode ? MODES[mode] : MISSING_MODE
  const color = modeColor(model, skin)

  const flags = snapshot?.paceFlags ?? []
  const chips = flags
    .map((name) => FLAG_LABELS[name] ?? { label: String(name).toUpperCase(), green: false })
    .filter((c) => c.label.length > 0)

  const pad = 12
  const titleH = 16
  const titleY = pad + titleH / 2

  const plateX = pad
  const plateY = pad + titleH + 6
  const plateW = W - pad * 2
  const plateH = Math.min(56, Math.max(30, (H - plateY - pad) * 0.52))

  const flagsY = plateY + plateH + 8
  const flagsH = Math.max(18, H - flagsY - pad)

  // Lay the flag chips (or a single NONE chip) across the bottom row.
  const chipModels = chips.length === 0 ? [{ label: 'NONE', green: false, muted: true }] : chips.map((c) => ({ ...c, muted: false }))
  const gap = 6
  const chipW = (plateW - gap * (chipModels.length - 1)) / chipModels.length

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      data-widget="paceRestart"
      role="img"
      style={{ display: 'block' }}
    >
      <rect
        x={1}
        y={1}
        width={W - 2}
        height={H - 2}
        rx={skin.material.radius}
        fill={skin.material.base}
        stroke={skin.material.border}
        strokeWidth={skin.material.borderWidth}
        opacity={glass ? skin.material.panelAlpha ?? 1 : 1}
      />

      <FitText
        x={pad}
        y={titleY}
        boxW={W - pad * 2}
        boxH={titleH}
        text="Pace / Restart"
        anchor="start"
        fontFamily={skin.typography.label}
        fill={skin.palette.textDim}
        weight={700}
        letterSpacing={1}
        minFontPx={11}
        maxFontPx={14}
      />

      <rect x={plateX} y={plateY} width={plateW} height={plateH} rx={Math.min(10, skin.material.radius)} fill={color} opacity={0.14} />
      <rect
        x={plateX + 0.5}
        y={plateY + 0.5}
        width={plateW - 1}
        height={plateH - 1}
        rx={Math.min(10, skin.material.radius)}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        opacity={model.pacing ? 0.9 : 0.5}
      />
      <FitText
        x={plateX + 14}
        y={plateY + plateH / 2}
        boxW={plateW - 28}
        boxH={Math.min(plateH - 10, 34)}
        text={model.label}
        anchor="start"
        fontFamily={skin.typography.label}
        fill={color}
        weight={800}
        letterSpacing={0.5}
        minFontPx={12}
        maxFontPx={30}
        overflowStrategy="squeeze"
      />

      {chipModels.map((chip, i) => {
        const cx = plateX + i * (chipW + gap)
        const chipColor = chip.muted ? skin.palette.textDim : chip.green ? skin.palette.ok : skin.palette.warn
        return (
          <g key={`${chip.label}-${i}`}>
            <rect x={cx} y={flagsY} width={chipW} height={flagsH} rx={6} fill={chipColor} opacity={chip.muted ? 0.1 : 0.18} />
            <rect x={cx + 0.5} y={flagsY + 0.5} width={chipW - 1} height={flagsH - 1} rx={6} fill="none" stroke={chipColor} strokeWidth={1} opacity={chip.muted ? 0.45 : 0.85} />
            <FitText
              x={cx + chipW / 2}
              y={flagsY + flagsH / 2}
              boxW={chipW - 10}
              boxH={Math.min(flagsH - 6, 22)}
              text={chip.label}
              anchor="middle"
              fontFamily={skin.typography.label}
              fill={chipColor}
              weight={700}
              letterSpacing={0.5}
              minFontPx={11}
              maxFontPx={18}
              overflowStrategy="squeeze"
            />
          </g>
        )
      })}
    </svg>
  )
}

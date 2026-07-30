// STANDINGS overlay — a broadcast-style timing tower rendered as ONE root <svg>
// (fixed viewBox + preserveAspectRatio="meet") so rows can never clip or overflow.
// Every cell is a <FitText>: positions/gaps in the DSEG segment face, names in the
// condensed label face with an ellipsis strategy so long driver names truncate with
// "…" instead of spilling. Deltas are coloured green (ahead) / red (behind); the
// player row is highlighted with the skin accent. All colour comes from skin tokens
// so a brand/skin swap "just works". Reuses the existing class-ordered sort.

import type { ReactElement } from 'react'
import type { DriverEntry } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'
import { formatDelta } from './format'
import { resolveSkin, FitText } from '../../skins'
import type { SkinToken } from '../../skins'

const DEFAULT_W = 500
const DEFAULT_H = 620
const CLASS_FALLBACK = '#8aa4c8'

function classKey(driver: DriverEntry): string {
  if (driver.classId !== undefined) return `id:${driver.classId}`
  if (driver.className) return `name:${driver.className}`
  if (driver.classColor) return `color:${driver.classColor}`
  return 'overall'
}

function sortedDrivers(drivers: DriverEntry[]): DriverEntry[] {
  const classOrder = new Map<string, number>()
  for (const driver of drivers) {
    const key = classKey(driver)
    classOrder.set(key, Math.min(classOrder.get(key) ?? Number.POSITIVE_INFINITY, driver.position))
  }

  return [...drivers]
    .sort((a, b) => {
      const classDelta = (classOrder.get(classKey(a)) ?? a.position) - (classOrder.get(classKey(b)) ?? b.position)
      if (classDelta !== 0) return classDelta
      const classPositionDelta = (a.classPosition ?? a.position) - (b.classPosition ?? b.position)
      if (classPositionDelta !== 0) return classPositionDelta
      return a.position - b.position
    })
    .slice(0, 16)
}

interface Row {
  key: number
  pos: number
  color: string
  num: string
  name: string
  gapLabel: string
  gapSec: number | undefined
  gapNumeric: boolean
  inPits: boolean
  isPlayer: boolean
}

function gapColor(row: Row, skin: SkinToken): string {
  if (row.isPlayer) return skin.palette.accent
  if (row.inPits) return skin.palette.warn
  const g = row.gapSec
  if (typeof g === 'number' && Number.isFinite(g)) {
    if (g < 0) return skin.palette.deltaFaster
    if (g > 0) return skin.palette.deltaSlower
  }
  return skin.palette.textDim
}

export function StandingsWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const glass = skin.id === 'hud'
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))

  const drivers = sortedDrivers(snapshot?.drivers ?? [])
  const rows: Row[] = drivers.map((d) => {
    const gapLabel = d.inPits ? 'PIT' : d.isPlayer ? 'YOU' : formatDelta(d.gapToPlayerSec)
    return {
      key: d.carIdx,
      pos: d.position,
      color: d.classColor ?? CLASS_FALLBACK,
      num: d.carNumber,
      name: d.name,
      gapLabel,
      gapSec: d.gapToPlayerSec,
      gapNumeric: /^[+\-−±]?\d/.test(gapLabel),
      inPits: !!d.inPits,
      isPlayer: !!d.isPlayer
    }
  })

  const carCount = snapshot?.totalCars ?? (drivers.length || undefined)
  const summary = `${carCount ?? '—'} carros · SOF ${snapshot?.strengthOfField ?? '—'}`
  const session = snapshot?.sessionType ?? 'Session'

  const panel = (
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
  )

  const rootProps = {
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: 'xMidYMid meet' as const,
    width: '100%',
    height: '100%',
    'data-widget': 'standings',
    role: 'img', 'aria-label': 'Race standings',
    style: { display: 'block' as const }
  }

  const pad = 12
  const tw = W - pad * 2

  if (rows.length === 0) {
    return (
      <svg {...rootProps}>
        {panel}
        <FitText x={W / 2} y={H / 2} boxW={tw} boxH={40} text="—" fontFamily={skin.typography.value} fill={skin.palette.textDim} minFontPx={16} maxFontPx={40} />
      </svg>
    )
  }

  const headH = 24
  const tableTop = pad + headH + 6
  const availH = H - tableTop - pad
  const rowH = Math.min(44, availH / rows.length)

  const posW = 38
  const barX = pad + posW
  const barW = 5
  const numX = barX + barW + 8
  const numW = 40
  const nameX = numX + numW + 8
  const gapW = 96
  const gapRight = pad + tw
  const gapX0 = gapRight - gapW
  const nameW = Math.max(24, gapX0 - nameX - 8)
  const cellH = Math.min(rowH - 8, 22)

  return (
    <svg {...rootProps}>
      {panel}
      <FitText
        x={pad}
        y={pad + headH / 2}
        boxW={tw * 0.5}
        boxH={headH}
        text={session}
        anchor="start"
        fontFamily={skin.typography.label}
        fill={skin.palette.text}
        weight={800}
        letterSpacing={0.5}
        minFontPx={12}
        maxFontPx={18}
        overflowStrategy="ellipsis"
      />
      <FitText
        x={pad + tw}
        y={pad + headH / 2}
        boxW={tw * 0.48}
        boxH={headH}
        text={summary}
        anchor="end"
        fontFamily={skin.typography.label}
        fill={skin.palette.textDim}
        weight={600}
        minFontPx={11}
        maxFontPx={14}
        overflowStrategy="ellipsis"
      />

      {rows.map((r, i) => {
        const ry = tableTop + i * rowH
        const rcy = ry + rowH / 2
        const gc = gapColor(r, skin)
        return (
          <g key={r.key}>
            {r.isPlayer && (
              <>
                <rect x={pad} y={ry + 1} width={tw} height={rowH - 2} rx={5} fill={skin.palette.accent} opacity={0.16} />
                <rect x={pad} y={ry + 1} width={3} height={rowH - 2} rx={1.5} fill={skin.palette.accent} />
              </>
            )}
            <FitText
              x={pad + posW / 2}
              y={rcy}
              boxW={posW - 8}
              boxH={cellH}
              text={String(r.pos)}
              anchor="middle"
              fontFamily={skin.segment.numeric}
              fill={r.isPlayer ? skin.palette.accent : skin.palette.text}
              minFontPx={11}
              maxFontPx={18}
            />
            <rect x={barX} y={ry + 5} width={barW} height={rowH - 10} rx={1.5} fill={r.color} />
            <FitText
              x={numX}
              y={rcy}
              boxW={numW}
              boxH={cellH}
              text={`#${r.num}`}
              anchor="start"
              fontFamily={skin.typography.label}
              fill={skin.palette.textDim}
              weight={700}
              minFontPx={11}
              maxFontPx={16}
              overflowStrategy="squeeze"
            />
            <FitText
              x={nameX}
              y={rcy}
              boxW={nameW}
              boxH={cellH}
              text={r.name || '—'}
              anchor="start"
              fontFamily={skin.typography.label}
              fill={r.isPlayer ? skin.palette.text : skin.palette.text}
              weight={r.isPlayer ? 800 : 600}
              minFontPx={11}
              maxFontPx={16}
              overflowStrategy="ellipsis"
            />
            <FitText
              x={gapRight - 6}
              y={rcy}
              boxW={gapW - 10}
              boxH={cellH}
              text={r.gapLabel}
              anchor="end"
              fontFamily={r.gapNumeric ? skin.segment.numeric : skin.typography.label}
              fill={gc}
              weight={700}
              minFontPx={11}
              maxFontPx={16}
              overflowStrategy="squeeze"
            />
          </g>
        )
      })}
    </svg>
  )
}

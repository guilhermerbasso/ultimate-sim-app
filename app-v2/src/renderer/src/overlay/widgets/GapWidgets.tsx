// GAP AHEAD / GAP BEHIND overlays — the single number a driver glances at most:
// the time gap to the car directly ahead / behind. Rendered as ONE root <svg>
// (fixed viewBox + preserveAspectRatio="meet") so the big DSEG number, the rival
// tag and the trend chevron never clip. Data is REUSED, never recomputed: both
// read `snapshot.relatives.ahead/behind` (RelativeCarEntry). `gapSec` is positive
// ahead / negative behind, so the headline always shows the absolute gap.
//
// COLOUR RULE (skin tokens only; cool green ONLY for a good state):
//   • AHEAD  → green when CLOSING on the car in front (gap shrinking).
//   • BEHIND → green when PULLING AWAY from the car behind (gap growing).
//   The opposite trend is a warm "threat" tone; a flat gap stays neutral chrome.

import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { RelativeCarEntry } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'
import { resolveSkin, FitText } from '../../skins'

type GapKind = 'ahead' | 'behind'
type GapTrend = 'shrinking' | 'growing' | 'flat'
type GapState = 'good' | 'bad' | 'flat'

const TREND_DEADBAND_SEC = 0.05
const TREND_WINDOW_MS = 1500
const DEFAULT_W = 240
const DEFAULT_H = 150

function absGapSec(entry: RelativeCarEntry | undefined): number | null {
  const gap = entry?.gapSec
  if (typeof gap !== 'number' || !Number.isFinite(gap)) return null
  return Math.abs(gap)
}

function formatGap(abs: number | null): string {
  if (abs === null) return '—'
  if (abs >= 100) return '99+'
  if (abs >= 10) return abs.toFixed(1)
  return abs.toFixed(2)
}

function shortName(name: string | undefined): string {
  if (!name) return ''
  const surname = name.trim().split(/\s+/).pop() ?? ''
  return surname.toUpperCase().slice(0, 10)
}

// SSR-safe: effect is skipped in static rendering so the trend stays 'flat'
// (neutral) until live telemetry drives it in the overlay window.
function useGapTrend(abs: number | null): GapTrend {
  const samplesRef = useRef<Array<{ t: number; v: number }>>([])
  const [trend, setTrend] = useState<GapTrend>('flat')

  useEffect(() => {
    if (abs === null) {
      samplesRef.current = []
      setTrend('flat')
      return
    }
    const now = Date.now()
    const buf = samplesRef.current
    buf.push({ t: now, v: abs })
    while (buf.length > 1 && now - buf[0].t > TREND_WINDOW_MS) buf.shift()
    const oldest = buf[0]
    const delta = abs - oldest.v
    setTrend(delta < -TREND_DEADBAND_SEC ? 'shrinking' : delta > TREND_DEADBAND_SEC ? 'growing' : 'flat')
  }, [abs])

  return trend
}

function gapState(kind: GapKind, trend: GapTrend): GapState {
  if (trend === 'flat') return 'flat'
  const closingIsGood = kind === 'ahead'
  const isShrinking = trend === 'shrinking'
  const good = closingIsGood ? isShrinking : !isShrinking
  return good ? 'good' : 'bad'
}

function GapOverlay({ kind, entry, config }: { kind: GapKind; entry: RelativeCarEntry | undefined; config: WidgetProps['config'] }): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const glass = skin.id === 'hud'
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))

  const abs = absGapSec(entry)
  const trend = useGapTrend(abs)
  const hasRival = Boolean(entry) && abs !== null
  const state = hasRival ? gapState(kind, trend) : 'flat'

  const label = kind === 'ahead' ? 'AHEAD' : 'BEHIND'
  const dirGlyph = kind === 'ahead' ? '▲' : '▼'
  const trendGlyph = trend === 'shrinking' ? '↓' : trend === 'growing' ? '↑' : ''
  const numTxt = formatGap(abs)
  const carNumber = entry?.carNumber?.trim() || undefined
  const name = shortName(entry?.name)

  const numColor = state === 'good' ? skin.palette.ok : state === 'bad' ? skin.palette.warn : skin.palette.text
  const rivalText = hasRival ? `${carNumber ? `#${carNumber} ` : ''}${name}`.trim() || 'no car' : 'no car'

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      data-widget={`gap-${kind}`}
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
        x={W / 2}
        y={24}
        boxW={W - 24}
        boxH={18}
        text={`${dirGlyph} ${label}${trendGlyph ? ` ${trendGlyph}` : ''}`}
        anchor="middle"
        fontFamily={skin.typography.label}
        fill={hasRival && state !== 'flat' ? numColor : skin.palette.textDim}
        minFontPx={11}
        maxFontPx={20}
        letterSpacing={2}
      />

      <FitText
        x={W / 2}
        y={H * 0.56}
        boxW={W - 28}
        boxH={H * 0.42}
        text={numTxt}
        anchor="middle"
        fontFamily={skin.segment.numeric}
        fill={numColor}
        weight={700}
        minFontPx={16}
        maxFontPx={Math.round(H * 0.42)}
      />

      <FitText
        x={W / 2}
        y={H - 18}
        boxW={W - 24}
        boxH={18}
        text={rivalText}
        anchor="middle"
        fontFamily={skin.typography.label}
        fill={skin.palette.textDim}
        minFontPx={11}
        maxFontPx={18}
        overflowStrategy="ellipsis"
      />
    </svg>
  )
}

export function GapAheadWidget({ snapshot, config }: WidgetProps): ReactElement {
  return <GapOverlay kind="ahead" entry={snapshot?.relatives?.ahead} config={config} />
}

export function GapBehindWidget({ snapshot, config }: WidgetProps): ReactElement {
  return <GapOverlay kind="behind" entry={snapshot?.relatives?.behind} config={config} />
}

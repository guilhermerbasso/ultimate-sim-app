// WS-M — shared track-map coaching HEATMAP component.
//
// Draws the track outline (from the existing `TrackMapData` geometry, learned OR
// iRacing-SVG) and colours each numbered corner (Curva 1..N) by the driver's
// performance there vs the reference, using the signed per-corner delta from the
// Coach report. Warm = bad, cool = good:
//   • RED   loss   — you're slow there (estTimeDeltaSec < 0)
//   • GREEN on-par — at the standard (~0)
//   • BLUE  gain   — much better; replicate it (estTimeDeltaSec > 0)
//
// Two modes:
//   • `interactive` (Coach IA) — corners are CLICKABLE; selecting one expands a
//     detail panel: RED → o que MELHORAR, BLUE → o que VOCÊ FEZ DE CERTO,
//     GREEN → no padrão. Full legend.
//   • `readonly` (overlay / dashboard widget) — same coloured mini-map, no click
//     or expand, glanceable, with a compact legend strip.
//
// Purely presentational: callers own the data subscription (`useTrackMapData()`
// for geometry, `useCoachReport()` for the report) and pass `trackData` + `report`
// (+ optional live `playerPct`). This keeps it reusable across all three surfaces.

import { useCallback, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement, WheelEvent as ReactWheelEvent } from 'react'
import type { CoachFinding } from '../../../shared/coach'
import type { TrackMapData } from '../../../shared/track-map'
import {
  buildTrackMap,
  getStartFinishMarker,
  trackMapDotRadius,
  trackMapStrokeWidth,
  type TrackMapRenderable
} from '../lib/track-map'
import {
  HEAT_COLORS,
  buildCornerHeat,
  detailKindForBucket,
  heatLegend,
  type CornerHeat,
  type HeatPalette
} from '../lib/track-heatmap'

export type TrackCoachingHeatmapMode = 'interactive' | 'readonly'

export interface TrackCoachingHeatmapProps {
  mode: TrackCoachingHeatmapMode
  data: TrackMapData | null | undefined
  report: import('../../../shared/coach').CoachReport | null | undefined
  /** Live player lap progress 0..1 — draws the moving marker when provided. */
  playerPct?: number
  /** On-par band (seconds) and colour palette overrides. */
  band?: number
  palette?: HeatPalette
  /** Player marker / chrome accent. */
  accent?: string
  /** Base (uncoloured) track outline. */
  outlineColor?: string
  /** Show the legend (defaults: on for interactive, compact strip for readonly). */
  showLegend?: boolean
  className?: string
  style?: CSSProperties
}

const DEFAULT_ACCENT = 'var(--accent-primary)'
const DEFAULT_OUTLINE = '#3a4d63'

// Interactive view zoom/pan bounds (presentational only — never touches data).
// MIN_ZOOM < 1 lets the map shrink below the fit size (zoom 1 = fit-to-view).
const MIN_ZOOM = 0.5
const MAX_ZOOM = 6
const ZOOM_STEP = 1.35
const MAP_BASE_HEIGHT = 360
const MAP_MIN_HEIGHT = 220
const MAP_MAX_HEIGHT = 760

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

function fmtDelta(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—'
  return `${seconds >= 0 ? '+' : ''}${seconds.toFixed(2)}s`
}

// Build a polyline `d` for a corner's window by sampling the path between its
// start and end (handles a window that wraps across the start/finish seam).
function cornerSegmentPathD(
  renderable: TrackMapRenderable,
  startPct: number,
  endPct: number,
  steps = 22
): string | null {
  let a = startPct
  let b = endPct
  if (b < a) b += 1
  const coords: string[] = []
  for (let i = 0; i <= steps; i += 1) {
    const point = renderable.sample(a + (b - a) * (i / steps))
    if (point) coords.push(`${point.x.toFixed(4)} ${point.y.toFixed(4)}`)
  }
  if (coords.length < 2) return null
  return `M ${coords.join(' L ')}`
}

export function TrackCoachingHeatmap({
  mode,
  data,
  report,
  playerPct,
  band,
  palette = HEAT_COLORS,
  accent = DEFAULT_ACCENT,
  outlineColor = DEFAULT_OUTLINE,
  showLegend,
  className,
  style
}: TrackCoachingHeatmapProps): ReactElement {
  const interactive = mode === 'interactive'
  const renderable = useMemo(() => buildTrackMap(data), [data])
  const corners = useMemo(() => buildCornerHeat(report, { band, palette }), [report, band, palette])
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  // ── Interactive view zoom + pan (presentational; gated to interactive mode). ─
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)

  const clientToUser = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current
    if (!svg || typeof svg.getScreenCTM !== 'function') return null
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
    return { x: pt.x, y: pt.y }
  }, [])

  const resetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const selected = useMemo(
    () => (selectedIndex == null ? null : corners.find((c) => c.index === selectedIndex) ?? null),
    [corners, selectedIndex]
  )

  const hasPath = Boolean(renderable && renderable.outlinePathD && renderable.totalLength > 0)
  const legendOn = showLegend ?? true

  const rootStyle: CSSProperties = { position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, ...style }

  // ── No usable geometry yet — keep the surface informative, never empty. ─────
  if (!renderable || !hasPath) {
    return (
      <div className={className} style={rootStyle}>
        <div style={emptyStyles.box}>
          <span style={emptyStyles.text}>
            {data?.recording?.active
              ? `Aprendendo o mapa da pista… ${Math.round((data.recording.progress ?? 0) * 100)}%`
              : 'Mapa da pista ainda não disponível — dirija uma volta limpa ou conecte o iRacing.'}
          </span>
        </div>
        {legendOn && <Legend palette={palette} compact={!interactive} />}
      </div>
    )
  }

  const vb = renderable.viewBox
  const outlineStroke = trackMapStrokeWidth(vb)
  const segmentStroke = trackMapStrokeWidth(vb, 2.6)
  const selectedStroke = trackMapStrokeWidth(vb, 3.8)
  const sfStroke = trackMapStrokeWidth(vb, 1.3)
  const hitStroke = trackMapStrokeWidth(vb, 7)
  const playerR = trackMapDotRadius(vb, 1.1)
  const apexR = trackMapDotRadius(vb, 0.5)
  const labelSize = Math.max(vb[2], vb[3]) * 0.03

  const sfMarker = getStartFinishMarker(renderable)
  const playerPoint = playerPct != null ? renderable.sample(playerPct) : null

  // ── Derived view box: zoom toward centre + clamped pan (interactive only). ───
  const zoomable = interactive
  const effZoom = zoomable ? zoom : 1
  const baseCx = vb[0] + vb[2] / 2
  const baseCy = vb[1] + vb[3] / 2
  const viewW = vb[2] / effZoom
  const viewH = vb[3] / effZoom
  // Below fit (effZoom < 1) viewW/H exceed the viewBox, so cap pan at 0 to keep
  // the shrunk map centred (avoids an inverted clamp range / off-centre jump).
  const maxPanX = Math.max(0, (vb[2] - viewW) / 2)
  const maxPanY = Math.max(0, (vb[3] - viewH) / 2)
  const panX = clamp(pan.x, -maxPanX, maxPanX)
  const panY = clamp(pan.y, -maxPanY, maxPanY)
  const viewX = baseCx - viewW / 2 + panX
  const viewY = baseCy - viewH / 2 + panY
  const zoomedIn = zoomable && effZoom > 1

  const zoomAtCenter = (factor: number): void => {
    setZoom((cur) => clamp(cur * factor, MIN_ZOOM, MAX_ZOOM))
  }

  const handleWheel = (event: ReactWheelEvent<SVGSVGElement>): void => {
    if (!zoomable) return
    event.preventDefault()
    const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
    const nextZoom = clamp(effZoom * factor, MIN_ZOOM, MAX_ZOOM)
    if (nextZoom === effZoom) return
    const focus = clientToUser(event.clientX, event.clientY)
    if (!focus) {
      setZoom(nextZoom)
      return
    }
    const nextW = vb[2] / nextZoom
    const nextH = vb[3] / nextZoom
    const fx = (focus.x - viewX) / viewW
    const fy = (focus.y - viewY) / viewH
    const nextViewX = focus.x - fx * nextW
    const nextViewY = focus.y - fy * nextH
    setPan({ x: nextViewX + nextW / 2 - baseCx, y: nextViewY + nextH / 2 - baseCy })
    setZoom(nextZoom)
  }

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (!zoomedIn || event.button !== 0) return
    dragRef.current = { clientX: event.clientX, clientY: event.clientY, panX, panY }
    setDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    // Uniform user-units-per-pixel (xMidYMid meet scales both axes equally).
    const upp = Math.max(viewW / rect.width, viewH / rect.height)
    setPan({
      x: drag.panX - (event.clientX - drag.clientX) * upp,
      y: drag.panY - (event.clientY - drag.clientY) * upp
    })
  }

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(false)
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  const svgCursor = zoomedIn ? (dragging ? 'grabbing' : 'grab') : undefined
  const dynamicSvgStyle: CSSProperties = {
    ...svgStyle,
    overflow: zoomedIn ? 'hidden' : 'visible',
    cursor: svgCursor,
    touchAction: zoomable ? 'none' : undefined
  }
  const mapFrameStyle: CSSProperties = {
    ...mapFrameBaseStyle,
    height: zoomable ? clamp(MAP_BASE_HEIGHT * effZoom, MAP_MIN_HEIGHT, MAP_MAX_HEIGHT) : '100%',
    minHeight: zoomable ? MAP_MIN_HEIGHT : undefined
  }

  return (
    <div className={className} style={rootStyle}>
      <div style={mapFrameStyle}>
        {zoomable && (
          <ZoomControls
            accent={accent}
            canZoomIn={effZoom < MAX_ZOOM}
            canZoomOut={effZoom > MIN_ZOOM}
            canReset={effZoom !== 1 || panX !== 0 || panY !== 0}
            onZoomIn={() => zoomAtCenter(ZOOM_STEP)}
            onZoomOut={() => zoomAtCenter(1 / ZOOM_STEP)}
            onReset={resetView}
          />
        )}
        <svg
          ref={svgRef}
          viewBox={`${viewX} ${viewY} ${viewW} ${viewH}`}
          preserveAspectRatio="xMidYMid meet"
          style={dynamicSvgStyle}
          role={interactive ? 'group' : 'img'}
          aria-label="Mapa de coaching colorido por curva"
          onWheel={zoomable ? handleWheel : undefined}
          onPointerDown={zoomable ? handlePointerDown : undefined}
          onPointerMove={zoomable ? handlePointerMove : undefined}
          onPointerUp={zoomable ? endDrag : undefined}
          onPointerLeave={zoomable ? endDrag : undefined}
        >
        {/* Base outline (uncoloured track). */}
        <path
          d={renderable.outlinePathD ?? undefined}
          fill="none"
          stroke={outlineColor}
          strokeWidth={outlineStroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.85}
        />

        {/* Coloured corner segments. */}
        {corners.map((corner) => {
          const d = cornerSegmentPathD(renderable, corner.startPct, corner.endPct)
          if (!d) return null
          const isSelected = interactive && corner.index === selectedIndex
          const apex = renderable.sample(corner.apexPct)
          return (
            <g
              key={corner.index}
              onClick={interactive ? () => setSelectedIndex((cur) => (cur === corner.index ? null : corner.index)) : undefined}
              style={{ cursor: interactive ? 'pointer' : 'default' }}
            >
              {/* Visible coloured stroke. */}
              <path
                d={d}
                fill="none"
                stroke={corner.color}
                strokeWidth={isSelected ? selectedStroke : segmentStroke}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={isSelected ? 1 : 0.92}
              >
                {!interactive && <title>{`Curva ${corner.index} · ${fmtDelta(corner.deltaSec)}`}</title>}
              </path>
              {/* Wide transparent hit target (interactive only). */}
              {interactive && (
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={hitStroke}
                  strokeLinecap="round"
                  style={{ pointerEvents: 'stroke' }}
                >
                  <title>{`Curva ${corner.index} · ${fmtDelta(corner.deltaSec)} — clique para detalhes`}</title>
                </path>
              )}
              {/* Apex marker + number (interactive map only, to stay glanceable). */}
              {interactive && apex && (
                <>
                  <circle cx={apex.x} cy={apex.y} r={apexR} fill={corner.color} stroke="#05121f" strokeWidth={outlineStroke * 0.35} />
                  <text
                    x={apex.x}
                    y={apex.y - apexR * 1.6}
                    textAnchor="middle"
                    fontSize={labelSize}
                    fontWeight={700}
                    fill={isSelected ? '#ffffff' : '#cfe0f2'}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {corner.index}
                  </text>
                </>
              )}
            </g>
          )
        })}

        {sfMarker && (
          <line
            x1={sfMarker.x1}
            y1={sfMarker.y1}
            x2={sfMarker.x2}
            y2={sfMarker.y2}
            stroke="#f6fbff"
            strokeWidth={sfStroke}
            strokeLinecap="round"
            opacity={0.9}
          />
        )}

        {playerPoint && (
          <circle cx={playerPoint.x} cy={playerPoint.y} r={playerR} fill={accent} stroke="#ffffff" strokeWidth={outlineStroke * 0.55}>
            <animate attributeName="opacity" values="1;0.7;1" dur="1.4s" repeatCount="indefinite" />
          </circle>
        )}
        </svg>
      </div>

      {legendOn && <Legend palette={palette} compact={!interactive} />}

      {interactive && <CornerDetail corner={selected} />}
    </div>
  )
}

const svgStyle: CSSProperties = { width: '100%', height: '100%', display: 'block', overflow: 'visible' }
const mapFrameBaseStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  minHeight: MAP_MIN_HEIGHT,
  transition: 'height 140ms ease',
  overflow: 'hidden'
}

interface ZoomControlsProps {
  accent: string
  canZoomIn: boolean
  canZoomOut: boolean
  canReset: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
}

// Subtle overlay controls anchored top-right of the map (warm-accent palette).
function ZoomControls({
  accent,
  canZoomIn,
  canZoomOut,
  canReset,
  onZoomIn,
  onZoomOut,
  onReset
}: ZoomControlsProps): ReactElement {
  const button = (
    label: string,
    title: string,
    enabled: boolean,
    onClick: () => void
  ): ReactElement => (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={!enabled}
      onClick={onClick}
      style={{
        ...zoomStyles.button,
        color: accent,
        cursor: enabled ? 'pointer' : 'default',
        opacity: enabled ? 1 : 0.35
      }}
    >
      {label}
    </button>
  )
  return (
    <div style={zoomStyles.bar}>
      {button('+', 'Aproximar', canZoomIn, onZoomIn)}
      {button('−', 'Afastar', canZoomOut, onZoomOut)}
      {button('⤢', 'Ajustar à pista', canReset, onReset)}
    </div>
  )
}

const zoomStyles: Record<string, CSSProperties> = {
  bar: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 2,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: 4,
    borderRadius: 8,
    background: 'rgba(8, 16, 24, 0.62)',
    border: '1px solid rgba(255, 138, 76, 0.28)',
    backdropFilter: 'blur(2px)'
  },
  button: {
    width: 26,
    height: 26,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 15,
    fontWeight: 700,
    lineHeight: 1,
    background: 'transparent',
    border: '1px solid rgba(255, 138, 76, 0.32)',
    borderRadius: 6
  }
}

function Legend({ palette, compact }: { palette: HeatPalette; compact: boolean }): ReactElement {
  const items = heatLegend(palette)
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: compact ? 8 : 12, alignItems: 'center' }}>
      {items.map((item) => (
        <span key={item.bucket} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: compact ? 8 : 11, height: compact ? 8 : 11, borderRadius: 2, background: item.color, flex: '0 0 auto' }} />
          <span style={{ fontSize: compact ? 10 : 12, color: 'var(--text-muted, #8A8A8A)', whiteSpace: 'nowrap' }}>{item.label}</span>
        </span>
      ))}
    </div>
  )
}

function CornerDetail({ corner }: { corner: CornerHeat | null }): ReactElement {
  if (!corner) {
    return (
      <div style={detailStyles.panel}>
        <span style={detailStyles.hint}>Clique numa curva no mapa para ver o detalhe (o que melhorar, o que você fez de certo, ou no padrão).</span>
      </div>
    )
  }

  const kind = detailKindForBucket(corner.bucket)
  const heading =
    kind === 'improve'
      ? 'O que MELHORAR'
      : kind === 'replicate'
        ? 'O que você fez de CERTO'
        : kind === 'unknown'
          ? 'Sem referência'
          : 'No padrão'

  return (
    <div style={{ ...detailStyles.panel, borderColor: corner.color }}>
      <div style={detailStyles.header}>
        <span style={{ ...detailStyles.badge, background: corner.color }}>Curva {corner.index}</span>
        <span style={{ ...detailStyles.heading, color: corner.color }}>{heading}</span>
        {corner.dominant && <span style={detailStyles.delta}>{fmtDelta(corner.deltaSec)}</span>}
      </div>

      {kind === 'onpar' && (
        <p style={detailStyles.body}>Curva limpa — você está no padrão da referência aqui. Mantenha a execução.</p>
      )}

      {kind === 'unknown' && (
        <p style={detailStyles.body}>Sem volta de referência ainda — esta curva não foi avaliada. Complete uma volta limpa para gerar a referência.</p>
      )}

      {corner.dominant && kind !== 'onpar' && <FindingBlock finding={corner.dominant} primary />}

      {corner.findings
        .filter((finding) => finding !== corner.dominant)
        .slice(0, 3)
        .map((finding) => (
          <FindingBlock key={finding.id} finding={finding} />
        ))}
    </div>
  )
}

function FindingBlock({ finding, primary = false }: { finding: CoachFinding; primary?: boolean }): ReactElement {
  return (
    <div style={{ ...detailStyles.finding, ...(primary ? detailStyles.findingPrimary : {}) }}>
      <span style={detailStyles.findingTitle}>{finding.title}</span>
      <span style={detailStyles.findingText}>{finding.explanation ?? finding.detail}</span>
      {finding.evidence && <span style={detailStyles.evidence}>{finding.evidence}</span>}
    </div>
  )
}

const emptyStyles: Record<string, CSSProperties> = {
  box: {
    minHeight: 120,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    border: '1px dashed var(--border-default, #2a3a4d)',
    borderRadius: 'var(--radius-sm, 8px)',
    background: 'var(--surface-sunken, rgba(6, 14, 22, 0.4))',
    textAlign: 'center'
  },
  text: { color: 'var(--text-muted, #8A8A8A)', fontSize: 13, lineHeight: 1.5 }
}

const detailStyles: Record<string, CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 'var(--space-4, 12px)',
    border: '1px solid var(--border-default, #2a3a4d)',
    borderRadius: 'var(--radius-sm, 8px)',
    background: 'var(--surface-sunken, rgba(6, 14, 22, 0.4))'
  },
  hint: { color: 'var(--text-muted, #8A8A8A)', fontSize: 12, lineHeight: 1.5 },
  header: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  badge: {
    color: '#05121f',
    fontWeight: 800,
    fontSize: 12,
    letterSpacing: '0.04em',
    padding: '2px 8px',
    borderRadius: 4
  },
  heading: { fontWeight: 700, fontSize: 13, letterSpacing: '0.04em', textTransform: 'uppercase' },
  delta: { marginLeft: 'auto', color: 'var(--text-secondary, #b9c6d6)', fontSize: 13, fontWeight: 700 },
  body: { color: 'var(--text-secondary, #b9c6d6)', fontSize: 13, lineHeight: 1.5, margin: 0 },
  finding: { display: 'flex', flexDirection: 'column', gap: 3 },
  findingPrimary: {
    paddingLeft: 10,
    borderLeft: '2px solid var(--border-strong, #3a4d63)'
  },
  findingTitle: { color: 'var(--text-primary, #F4F4F4)', fontSize: 13, fontWeight: 700 },
  findingText: { color: 'var(--text-secondary, #b9c6d6)', fontSize: 12.5, lineHeight: 1.5 },
  evidence: { color: 'var(--text-muted, #8A8A8A)', fontSize: 11.5, lineHeight: 1.4 }
}

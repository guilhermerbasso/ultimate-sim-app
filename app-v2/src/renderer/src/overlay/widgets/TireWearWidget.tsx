// TYRE LIFE overlay — remaining tyre condition per corner, fed by the tyre-strategy
// IPC channel (falling back to the raw telemetry wearPct) and normalised so a 0..1
// fraction and a 0..100 percent both read as a clean percentage (never "8200%").
//
// v2.39 rebuild: one root <svg> (fixed viewBox) laid out with makeGrid — an eyebrow,
// four corner meters, and a worst-corner / laps-left / threshold footer. Every glyph
// is a FitText so values can never overflow, clip or render sub-legible. Life ramps
// warm→cool (worn = red, fresh = green); a missing corner reads dim chrome + '—'.
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { TireCornerId, TireStrategyState } from '../../../../shared/tire-strategy'
import { TIRE_CHANNELS } from '../../../../shared/tire-strategy'
import type { TyreInfo } from '../../../../shared/telemetry'
import { resolveSkin, FitText, makeGrid } from '../../skins'
import type { SkinId, BrandId, SkinToken, Rect } from '../../skins'
import type { WidgetProps } from './types'
import { numberOrDash, pct } from './format'

const CORNERS: Array<[TireCornerId, string]> = [['lf', 'DE'], ['rf', 'DD'], ['lr', 'TE'], ['rr', 'TD']]

const DEFAULT_W = 300
const DEFAULT_H = 220

const DIM_CHROME = 'rgba(180,196,220,0.5)'

function cornerName(corner?: TireCornerId): string {
  return CORNERS.find(([id]) => id === corner)?.[1] ?? '—'
}

/** Tyre life: high = good (green), low = worn (warn/hot). */
function lifeColor(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return DIM_CHROME
  if (value <= 25) return '#ff4d3d'
  if (value <= 40) return '#ffb000'
  return '#2ee06a'
}

/** Normalize tyre condition (0..1 fraction OR already 0..100) to a clamped 0–100 %. */
function lifePct(v: number | undefined): number | undefined {
  if (v === undefined || !Number.isFinite(v)) return undefined
  const scaled = v <= 1 ? v * 100 : v
  return Math.max(0, Math.min(100, scaled))
}

interface CornerLife {
  corner: TireCornerId
  label: string
  life?: number
  level: number
  color: string
}

function widgetSkin(config: WidgetProps['config']): SkinToken {
  const style = (config?.style ?? {}) as { skin?: SkinId; brand?: BrandId }
  return resolveSkin(style.skin ?? 'gt3', style.brand ?? 'generic')
}

function CornerRow({ rect, card, skin }: { rect: Rect; card: CornerLife; skin: SkinToken }): ReactElement {
  const { palette, segment, typography, material } = skin
  const labelW = rect.w * 0.14
  const valueW = rect.w * 0.2
  const barX = rect.x + labelW + 6
  const barW = rect.w - labelW - valueW - 12
  const barH = Math.max(6, rect.h * 0.42)
  const barY = rect.y + rect.h / 2 - barH / 2
  const valueText = card.life !== undefined ? `${numberOrDash(card.life, 0)}%` : '—'
  return (
    <g>
      <FitText x={rect.x} y={rect.y + rect.h / 2} boxW={labelW} boxH={rect.h * 0.8} text={card.label} anchor="start" fontFamily={typography.label} fill={palette.text} weight={800} letterSpacing={0.6} minFontPx={11} maxFontPx={16} />
      <rect x={barX} y={barY} width={barW} height={barH} rx={barH / 2} fill={palette.bg} stroke={material.border} strokeWidth={1} />
      {card.level > 0 && <rect x={barX} y={barY} width={Math.max(0, barW * pct(card.level))} height={barH} rx={barH / 2} fill={card.color} />}
      <FitText x={rect.x + rect.w} y={rect.y + rect.h / 2} boxW={valueW} boxH={rect.h * 0.86} text={valueText} anchor="end" fontFamily={segment.numeric} fill={card.color} minFontPx={12} maxFontPx={20} />
    </g>
  )
}

export function TireWearWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = widgetSkin(config)
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))
  const { palette, material, typography } = skin

  const [strategy, setStrategy] = useState<TireStrategyState | null>(null)

  useEffect(() => {
    const unsubscribe = window.ipc.subscribe<TireStrategyState>(TIRE_CHANNELS.update, setStrategy)
    void window.ipc.invoke<TireStrategyState>(TIRE_CHANNELS.get).then(setStrategy).catch(() => undefined)
    return unsubscribe
  }, [])

  const tyres = snapshot?.tyres
  const worstCorner = strategy?.worstCorner
  const lapsLeft = strategy?.lapsRemainingOnTyres
  const threshold = (strategy?.settings.wearThresholdPct ?? 0.3) * 100

  const cards: CornerLife[] = useMemo(() => {
    return CORNERS.map(([corner, label]) => {
      const tyre = tyres?.[corner] as TyreInfo | undefined
      const rawLife = lifePct(tyre?.wearPct)
      const life = strategy?.corners[corner].wearPct ?? rawLife
      return { corner, label, life, level: pct((life ?? 0) / 100), color: lifeColor(life) }
    })
  }, [strategy, tyres])

  const worst = useMemo(() => {
    if (worstCorner) return cards.find((c) => c.corner === worstCorner) ?? cards[0]
    return cards.reduce((a, b) => ((a.life ?? 101) <= (b.life ?? 101) ? a : b), cards[0])
  }, [cards, worstCorner])

  const source = strategy?.estimated ? 'estimada' : 'real'

  const pad = 10
  const grid = makeGrid(1, 6, W - pad * 2, H - pad * 2, 6)
  const off = (r: Rect): Rect => ({ x: r.x + pad, y: r.y + pad, w: r.w, h: r.h })
  const headerRect = off(grid.cell(0, 0))
  const rowRects = [off(grid.cell(0, 1)), off(grid.cell(0, 2)), off(grid.cell(0, 3)), off(grid.cell(0, 4))]
  const footerRect = off(grid.cell(0, 5))
  const footThird = footerRect.w / 3

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      style={{ display: 'block' }}
      data-widget="tireWear"
    >
      <rect x={1} y={1} width={W - 2} height={H - 2} rx={material.radius} fill={material.base} stroke={material.border} strokeWidth={material.borderWidth} />

      <FitText x={headerRect.x} y={headerRect.y + headerRect.h / 2} boxW={headerRect.w * 0.62} boxH={headerRect.h * 0.9} text="VIDA DOS PNEUS" anchor="start" fontFamily={typography.label} fill={palette.textDim} weight={800} letterSpacing={1.4} minFontPx={11} maxFontPx={18} />
      <FitText x={headerRect.x + headerRect.w} y={headerRect.y + headerRect.h / 2} boxW={headerRect.w * 0.34} boxH={headerRect.h * 0.82} text={`PIOR ${cornerName(worst?.corner)}`} anchor="end" fontFamily={typography.label} fill={worst?.color ?? palette.text} weight={700} minFontPx={11} maxFontPx={15} />

      {cards.map((c, i) => (
        <CornerRow key={c.corner} rect={rowRects[i]} card={c} skin={skin} />
      ))}

      <line x1={footerRect.x} y1={footerRect.y} x2={footerRect.x + footerRect.w} y2={footerRect.y} stroke={material.border} strokeWidth={1} />
      <FitText x={footerRect.x} y={footerRect.y + footerRect.h / 2 + 3} boxW={footThird - 4} boxH={footerRect.h * 0.7} text={`${numberOrDash(lapsLeft, 1)} voltas`} anchor="start" fontFamily={typography.label} fill={palette.text} weight={700} minFontPx={11} maxFontPx={15} />
      <FitText x={footerRect.x + footThird + footThird / 2} y={footerRect.y + footerRect.h / 2 + 3} boxW={footThird - 4} boxH={footerRect.h * 0.7} text={`limite ${numberOrDash(threshold, 0)}%`} anchor="middle" fontFamily={typography.label} fill={palette.textDim} weight={600} minFontPx={11} maxFontPx={14} />
      <FitText x={footerRect.x + footerRect.w} y={footerRect.y + footerRect.h / 2 + 3} boxW={footThird - 4} boxH={footerRect.h * 0.7} text={source} anchor="end" fontFamily={typography.label} fill={palette.accent} weight={700} minFontPx={11} maxFontPx={14} />
    </svg>
  )
}

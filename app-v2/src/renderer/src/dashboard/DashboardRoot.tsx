import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { HidButtonControl } from '../../../shared/actions'
import type {
  Dashboard,
  DashboardElement,
  DashboardScaleMode,
  AdaptiveBlink
} from '../../../shared/dashboards'
import { composeImageFilter, resolveSlotStyle, sortElementsByZ } from '../../../shared/dashboards'
import { createDefaultOverlayStyle, DEFAULT_OVERLAY_STYLE_PRESET } from '../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../shared/overlays'
import {
  planAdaptiveDashboard,
  resolveAdaptiveRuntime,
  withRaceMoment,
  type Emphasis,
  type MomentApply,
  type UserElementApply
} from '../../../shared/dashboard-adaptive'
import { isAdaptiveDashboard } from '../../../shared/dashboard-adaptive-preset'
import {
  detectActiveMoments,
  initialRaceMomentState,
  resolveRaceMoment,
  type RaceMomentColor,
  type RaceMomentState
} from '../../../shared/race-moment'
import { PREDICTIONS_CHANNELS, type PredictionsSnapshot } from '../../../shared/predictions'
import type { DriverEntry, RadarCarEntry, TelemetrySnapshot } from '../../../shared/telemetry'
import type { TrackMapData } from '../../../shared/track-map'
import { TRACK_MAP_CHANNELS } from '../../../shared/track-map'
import { EXPR_CHANNELS } from '../../../shared/expr'
import type { ExpressionDestinationPlacement } from '../../../shared/expression-studio'
import { RADAR_THREAT_COLORS, radarSideThreat, radarThreatColor, radarThreatLevel } from '../../../shared/radar'
import {
  buildTrackMap,
  getStartFinishMarker,
  trackMapDotRadius,
  trackMapStrokeWidth
} from '../lib/track-map'
import { readButtonPressed } from '../lib/gamepad'
import { useUnitSystem } from '../lib/units'
import { displayUnitLabel, getActiveFlag, resolveBinding, retainBindingIpc } from './binding'
import { subscribeWithHydration } from './hydration'
import { useSwipeCycle, type CycleDirection } from './useSwipeCycle'
import { renderGt3Widget, instrumentColorsFor, instrumentBezel, instrumentMaterial, revLedPropsFor } from './widgets/gt3-widgets'
import { AnalogDial, RevLedBar } from '../instruments'
import { resolveElementSkin, FitText } from '../skins'
// WS-DASH: the six full-frame dashboards (gridStackDash … lmuStintDash) are
// embedded as `overlaywidget` dashboard elements. They are no longer floating
// overlays, but their COMPONENTS stay registered here so the dashboard renderer
// can mount them. The overlay widget module side-effects (overlayWidgetsR16.css)
// and the widgets' own `dashboard-replicas.css` (.dr-root → width/height:100%)
// are namespaced, so importing them here adds no global styles.
import { resolveWidgetComponent } from '../overlay/widgets'
import { HifiWidgetHost, PREVIEW_COACH_REPORT, PREVIEW_ENGINEER_FEED } from '../overlay/widgets/HifiWidgetHost'
import './dashboard-runtime.css'

function getDashIdFromQuery(): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get('dash')
}

// Touch-kiosk flag (`?kiosk=1`): mounts a fullscreen gesture layer over the
// dashboard so a 7" panel can swipe/tap-cycle presets without a keyboard.
function getKioskFromQuery(): boolean {
  const params = new URLSearchParams(window.location.search)
  const value = params.get('kiosk')
  return value === '1' || value === 'true'
}

// Transparent fullscreen layer that turns swipes / edge taps into preset cycles
// (existing `app:dash:cycle`) and a long-press into a window close (existing
// `app:dash:close`). Big invisible edge zones keep the touch targets generous.
function KioskGestureLayer({ dashId }: { dashId: string | null }) {
  const layerRef = useRef<HTMLDivElement>(null)

  const onCycle = useCallback((direction: CycleDirection) => {
    void window.ipc.invoke('app:dash:cycle', direction).catch(() => undefined)
  }, [])

  const onLongPress = useCallback(() => {
    if (!dashId) return
    void window.ipc.invoke('app:dash:close', dashId).catch(() => undefined)
  }, [dashId])

  useSwipeCycle(layerRef, { onCycle, onLongPress })

  return (
    <div ref={layerRef} className="dash-kiosk-layer" aria-hidden>
      <button
        type="button"
        className="dash-kiosk-edge dash-kiosk-edge-prev"
        aria-label="Previous preset"
        onPointerUp={(e) => e.stopPropagation()}
        onClick={() => onCycle('prev')}
      >
        <span>‹</span>
      </button>
      <button
        type="button"
        className="dash-kiosk-edge dash-kiosk-edge-next"
        aria-label="Next preset"
        onPointerUp={(e) => e.stopPropagation()}
        onClick={() => onCycle('next')}
      >
        <span>›</span>
      </button>
    </div>
  )
}

interface DashboardCycleControlState {
  next: HidButtonControl | null
  prev: HidButtonControl | null
}

function cycleControlKey(direction: 'next' | 'prev', control: HidButtonControl): string {
  return `${direction}:${control.gamepadIndex ?? 'any'}:${control.gamepadId ?? 'any'}:${control.buttonIndex}`
}

interface ScaleInfo {
  scaleX: number
  scaleY: number
  // Final canvas position (upper-left corner) in the window, in pixels.
  left: number
  top: number
}

function useScale(baseW: number, baseH: number, mode: DashboardScaleMode): ScaleInfo {
  const [size, setSize] = useState<ScaleInfo>(() => ({ scaleX: 1, scaleY: 1, left: 0, top: 0 }))

  useEffect(() => {
    function update(): void {
      const winW = window.innerWidth
      const winH = window.innerHeight
      if (baseW <= 0 || baseH <= 0) {
        setSize({ scaleX: 1, scaleY: 1, left: 0, top: 0 })
        return
      }
      const sx = winW / baseW
      const sy = winH / baseH
      let scaleX = 1
      let scaleY = 1
      if (mode === 'stretch') {
        scaleX = sx
        scaleY = sy
      } else if (mode === 'fill') {
        const s = Math.max(sx, sy)
        scaleX = s
        scaleY = s
      } else {
        // 'fit' (default) — letterbox preserving aspect ratio.
        const s = Math.min(sx, sy)
        scaleX = s
        scaleY = s
      }
      // Centers the canvas inside the shell:
      const renderedW = baseW * scaleX
      const renderedH = baseH * scaleY
      const left = Math.floor((winW - renderedW) / 2)
      const top = Math.floor((winH - renderedH) / 2)
      setSize({ scaleX, scaleY, left, top })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [baseW, baseH, mode])

  return size
}

export type DashboardPreviewMode = 'inert'

interface ElementProps {
  element: DashboardElement
  snapshot: TelemetrySnapshot | null
  unitSystem?: import('../../../shared/units').UnitSystem
  preview?: DashboardPreviewMode
}

const INERT_OVERLAY_WIDGET_IDS = new Set<string>([
  'coachHeatmap', 'coachTips', 'coachFindings', 'coachSectorGraph', 'engineerFeed',
  'trackMap', 'trackMapNav3D', 'customValue', 'teamFuel', 'tireWear',
  'predCatchAhead', 'predCaughtBehind', 'predFuelMargin', 'predTireWear', 'predPaceProjected'
])

function needsInertFixture(type: string): boolean {
  return type === 'map' || type === 'trackmap-clean' || type === 'trackmap-elaborate' ||
    type === 'engineer-feed' || type.startsWith('coach-') || type.startsWith('pred-')
}

interface InertPredictionFixture { kind: string; label: string; value: string }

function inertPredictionFixture(source: string, snapshot: TelemetrySnapshot | null): InertPredictionFixture | null {
  const key = source.toLowerCase()
  if (!key.startsWith('pred')) return null
  if (key.includes('fuel')) {
    const tankLaps = (snapshot?.fuelLiters ?? 0) / Math.max(0.1, snapshot?.fuelPerLap ?? 1)
    const margin = tankLaps - (snapshot?.lapsRemaining ?? tankLaps)
    return { kind: 'fuel-margin', label: 'FUEL MARGIN', value: `${margin >= 0 ? '+' : ''}${margin.toFixed(1)} LAPS` }
  }
  if (key.includes('tire')) {
    const tyres = snapshot?.tyres ? Object.values(snapshot.tyres) : []
    const life = tyres.length ? tyres.reduce((sum, tyre) => sum + (tyre.wearPct ?? 0), 0) / tyres.length : 0
    return { kind: 'tyre-wear', label: 'TYRE WEAR', value: `${Math.round(life * 100)}% LIFE` }
  }
  if (key.includes('pace')) {
    const delta = (snapshot?.estimatedLapTimeSec ?? 0) - (snapshot?.bestLapTimeSec ?? 0)
    return { kind: 'pace', label: 'PROJECTED PACE', value: `${delta >= 0 ? '+' : ''}${delta.toFixed(3)} s` }
  }
  const behind = key.includes('caught') || key.includes('behind')
  const rival = behind ? snapshot?.relatives?.behind : snapshot?.relatives?.ahead
  const playerLap = snapshot?.lastLapTimeSec ?? 0
  const closingPerLap = behind ? playerLap - (rival?.lastLapTimeSec ?? playerLap) : (rival?.lastLapTimeSec ?? playerLap) - playerLap
  const catchLaps = closingPerLap > 0 ? Math.abs(rival?.gapSec ?? 0) / closingPerLap : null
  return { kind: behind ? 'caught-behind' : 'catch-ahead', label: behind ? 'THREAT BEHIND' : 'CATCH AHEAD', value: catchLaps === null ? 'NO CATCH' : `${catchLaps.toFixed(1)} LAPS` }
}

function InertWidgetFixture({
  element, snapshot, source, contained = false
}: ElementProps & { source: string; contained?: boolean }) {
  const isEngineer = source.toLowerCase().includes('engineer')
  const isCoach = source.toLowerCase().includes('coach')
  const isMap = source === 'map' || source.toLowerCase().includes('trackmap')
  const prediction = inertPredictionFixture(source, snapshot)
  const title = isEngineer ? 'ENGINEER - STATIC' : isCoach ? 'COACH - STATIC' : isMap ? 'TRACK - STATIC' : prediction ? `${prediction.label} - STATIC` : 'TELEMETRY - STATIC'
  const value = prediction?.value ?? (isEngineer
    ? PREVIEW_ENGINEER_FEED[0]?.text
    : isCoach
      ? PREVIEW_COACH_REPORT.findings[0]?.title
      : isMap
        ? `${snapshot?.trackName ?? 'TRACK'} - ${Math.round((snapshot?.lapDistPct ?? 0) * 100)}%`
        : source === 'teamFuel'
          ? `${((snapshot?.fuelLiters ?? 0) / Math.max(0.1, snapshot?.fuelPerLap ?? 1)).toFixed(1)} LAPS`
          : source === 'tireWear'
            ? `${Math.round((snapshot?.tyres?.lf?.wearPct ?? 0) * 100)}% TYRES`
            : `${snapshot?.deltaToBestSec?.toFixed(3) ?? '--'} s`)
  const body = (
    <div data-dashboard-inert-preview={source} data-preview-semantic={prediction?.kind} style={{ width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: 8, overflow: 'hidden', background: element.style.background ?? '#080a0d', border: `1px solid ${element.style.border ?? '#1F1F1F'}`, borderRadius: element.style.radius ?? 6, color: '#f6fbff' }}>
      <span style={{ color: element.style.accentColor ?? '#FFB000', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em' }}>{title}</span>
      <strong style={{ fontSize: 12, lineHeight: 1.15, overflow: 'hidden' }}>{value}</strong>
      {(isCoach || isEngineer) && <span style={{ color: '#9aa6b2', fontSize: 9 }}>{isCoach ? PREVIEW_COACH_REPORT.summary : 'Static engineer fixture'}</span>}
    </div>
  )
  if (contained) return body
  return <div className="dash-element" style={{ left: element.x, top: element.y, width: element.w, height: element.h }}>{body}</div>
}


function AutoFitSpan({
  text,
  align,
  maxSize,
  minSize,
  style
}: {
  text: string
  align: 'left' | 'center' | 'right'
  maxSize: number
  minSize: number
  style?: CSSProperties
}) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const frameRef = useRef(0)

  const fit = useCallback((): void => {
    const el = ref.current
    const box = el?.parentElement
    if (!el || !box) return

    window.cancelAnimationFrame(frameRef.current)
    frameRef.current = window.requestAnimationFrame(() => {
      const availW = Math.max(1, box.clientWidth)
      const availH = Math.max(1, box.clientHeight)
      let next = Math.max(minSize, maxSize)
      el.style.fontSize = `${next}px`
      el.style.letterSpacing = '0.01em'
      el.style.transform = ''

      for (let i = 0; i < 5; i += 1) {
        const scale = Math.min(1, availW / Math.max(1, el.scrollWidth), availH / Math.max(1, el.scrollHeight))
        if (scale >= 0.995) break
        const scaled = Math.max(minSize, Math.floor(next * scale * 0.98))
        if (scaled === next) break
        next = scaled
        el.style.fontSize = `${next}px`
      }

      if (el.scrollWidth > availW && next <= minSize) {
        const squeeze = Math.max(-0.1, (availW / Math.max(1, el.scrollWidth) - 1) * 0.28)
        el.style.letterSpacing = `${squeeze.toFixed(3)}em`
      }

      const finalScale = Math.min(1, availW / Math.max(1, el.scrollWidth), availH / Math.max(1, el.scrollHeight))
      if (finalScale < 0.995) {
        el.style.transformOrigin = align === 'right' ? 'right center' : align === 'left' ? 'left center' : 'center center'
        el.style.transform = `scale(${Math.max(0.72, finalScale * 0.985)})`
      }
    })
  }, [align, maxSize, minSize])

  useLayoutEffect(() => {
    const box = ref.current?.parentElement
    if (!box) return
    fit()
    const ResizeObserverCtor = typeof ResizeObserver !== 'undefined' ? ResizeObserver : undefined
    const observer = ResizeObserverCtor ? new ResizeObserver(fit) : undefined
    observer?.observe(box)
    window.addEventListener('resize', fit)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', fit)
      window.cancelAnimationFrame(frameRef.current)
    }
  }, [fit])

  useLayoutEffect(() => {
    fit()
  }, [text, fit])

  return (
    <span
      ref={ref}
      style={{
        ...style,
        // Constant-width digits so a changing numeric readout doesn't re-fit to a
        // different scale and jitter as it updates.
        fontVariantNumeric: 'tabular-nums',
        display: 'inline-block',
        maxWidth: '100%',
        maxHeight: '100%',
        lineHeight: 1.05,
        whiteSpace: 'nowrap',
        overflow: 'visible',
        textAlign: align,
        fontSize: maxSize
      }}
    >
      {text}
    </span>
  )
}

function pickFillColor(pct: number, element: DashboardElement): string {
  const s = element.style
  const fill = s.fillColor ?? '#3ea0ff'
  if (s.dangerColor && s.dangerAt !== undefined && pct >= s.dangerAt) return s.dangerColor
  if (s.warnColor && s.warnAt !== undefined && pct >= s.warnAt) return s.warnColor
  return fill
}

// The continuous bar primitives keep their lightweight CSS fill by default (no
// continuous-bar instrument exists). When an element opts in via the additive
// `style.instrument.template === 'revled'` (or shape === 'led'/'bar'/'trapezoid')
// the visual is routed through the modelled RevLedBar instead — a parity-safe
// upgrade that never fires unless the board author requests it.
function wantsRevLed(element: DashboardElement): boolean {
  const inst = element.style.instrument
  return inst?.template === 'revled' || inst?.parts?.led !== undefined
}

function ElementBar({ element, snapshot }: ElementProps) {
  const result = resolveBinding(element.binding, snapshot)
  const pct = Math.min(1, Math.max(0, result.pct ?? 0))
  const color = pickFillColor(pct, element)
  const style: CSSProperties = {
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    background: element.style.background ?? 'transparent',
    borderRadius: element.style.radius ?? 0,
    border: element.style.borderWidth
      ? `${element.style.borderWidth}px solid ${element.style.border ?? 'transparent'}`
      : undefined
  }
  if (wantsRevLed(element)) {
    const ledProps = revLedPropsFor(element.style, pct, {
      width: Math.max(8, element.w - 4),
      height: Math.max(8, element.h - 4)
    })
    return (
      <div className="dash-element" style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <RevLedBar {...ledProps} shape={ledProps.shape === 'led' ? 'bar' : ledProps.shape} />
      </div>
    )
  }
  return (
    <div className="dash-element" style={style}>
      <div className="dash-bar">
        <div
          className="dash-bar-fill"
          style={
            {
              ['--bar-pct' as string]: `${pct * 100}%`,
              background: color,
              borderRadius: element.style.radius ?? 0
            } as CSSProperties
          }
        />
      </div>
    </div>
  )
}

function ElementShiftLights({ element, snapshot }: ElementProps) {
  // shiftPct resolves to the provider's per-car shift-light band (binding.ts):
  // 0 below DriverCarSLFirstRPM, 1 at/after SLLastRPM — never rpm/maxRpm.
  const result = resolveBinding(element.binding ?? 'shiftPct', snapshot)
  const pct = Math.min(1, Math.max(0, result.pct ?? 0))
  const flashing = Boolean(snapshot?.revLights?.blink) || pct >= (element.style.flashAt ?? 0.97)

  const style: CSSProperties = {
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    background: element.style.background ?? '#0a0c10',
    borderRadius: element.style.radius ?? 0,
    border: element.style.borderWidth
      ? `${element.style.borderWidth}px solid ${element.style.border ?? 'transparent'}`
      : undefined,
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }
  // Modelled LED rev bar (individually-shaded LEDs + bloom; green→amber→red ramp
  // with redline flash). Honours the element's existing colour fields + the
  // additive style.instrument.parts.led fine knobs.
  const ledProps = revLedPropsFor(element.style, pct, {
    width: Math.max(8, element.w - 4),
    height: Math.max(8, element.h - 4),
    blink: flashing
  })
  return (
    <div className="dash-element" style={style}>
      <RevLedBar {...ledProps} />
    </div>
  )
}

function ElementGauge({ element, snapshot, unitSystem = 'metric' }: ElementProps) {
  const result = resolveBinding(element.binding, snapshot, unitSystem)
  const pct = Math.min(1, Math.max(0, result.pct ?? 0))
  const color = pickFillColor(pct, element)
  const s = element.style
  const skin = resolveElementSkin(s)
  const W = Math.max(1, Math.round(element.w))
  const H = Math.max(1, Math.round(element.h))
  const style: CSSProperties = {
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    background: s.background ?? 'transparent',
    borderRadius: s.radius ?? 0,
    border: s.borderWidth ? `${s.borderWidth}px solid ${s.border ?? 'transparent'}` : undefined
  }
  // Real analog dial (BezelRing + d3-arc track + damped Needle) driven by the
  // binding's normalised pct on a 0..100 sweep. Tick labels + the dial's own centre
  // value are switched OFF (they were the source of the sub-legible 6px tick micro-
  // text); the value + optional label are redrawn as auto-fit SVG overlays that never
  // render below 11px. warn/redline zones mirror the legacy warnAt/dangerAt ramp.
  const dialSize = Math.max(48, Math.floor(Math.min(W, H)))
  const dial = s.instrument?.parts?.dial
  const warnFrom = dial?.warnFrom ?? (s.warnAt !== undefined ? s.warnAt * 100 : undefined)
  const redlineFrom = dial?.redlineFrom ?? (s.dangerAt !== undefined ? s.dangerAt * 100 : undefined)
  const dialX = (W - dialSize) / 2
  const dialY = (H - dialSize) / 2
  const cx = dialX + dialSize / 2
  const cy = dialY + dialSize / 2
  const label = (s.label ?? s.title ?? '').toString()
  const hasLabel = label.length > 0
  const value = result.text && result.text.length ? result.text : '—'
  const valueColor = s.color ?? skin.palette.text
  const valBoxW = dialSize * 0.62
  const valBoxH = Math.max(14, dialSize * 0.26)
  return (
    <div className="dash-element" style={style}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
        <svg x={dialX} y={dialY} width={dialSize} height={dialSize} style={{ overflow: 'visible' }}>
          <AnalogDial
            value={pct * 100}
            min={0}
            max={100}
            size={dialSize}
            showValue={false}
            showTicks={false}
            bezel={instrumentBezel(s)}
            material={instrumentMaterial(s)}
            needleColor={s.instrument?.parts?.needle?.color ?? s.needleColor ?? color}
            damp={dial?.damp ?? 0}
            warnFrom={warnFrom}
            redlineFrom={redlineFrom}
            colors={instrumentColorsFor(s)}
          />
        </svg>
        <FitText
          x={cx}
          y={cy - (hasLabel ? valBoxH * 0.12 : 0)}
          boxW={valBoxW}
          boxH={valBoxH}
          text={value}
          fontFamily="'DSEG7Classic-Regular', monospace"
          fill={valueColor}
          weight={700}
          minFontPx={11}
          maxFontPx={Math.max(11, dialSize * 0.2)}
          anchor="middle"
          baseline="central"
        />
        {hasLabel && (
          <FitText
            x={cx}
            y={cy + dialSize * 0.22}
            boxW={dialSize * 0.74}
            boxH={Math.max(12, dialSize * 0.12)}
            text={label}
            fontFamily="'Chakra Petch', 'Segoe UI', sans-serif"
            fill={skin.palette.textDim}
            minFontPx={11}
            maxFontPx={Math.max(11, dialSize * 0.12)}
            anchor="middle"
            baseline="central"
          />
        )}
      </svg>
    </div>
  )
}

function useTrackMapData(): TrackMapData | null {
  const [data, setData] = useState<TrackMapData | null>(null)
  useEffect(() => {
    const ipc = (window as typeof window & { ipc?: typeof window.ipc }).ipc
    if (!ipc) return
    let canceled = false
    void ipc
      .invoke<TrackMapData | null>(TRACK_MAP_CHANNELS.getForCurrentTrack)
      .then((next) => {
        if (!canceled) setData(next ?? null)
      })
      .catch(() => undefined)
    const off = ipc.subscribe<TrackMapData | null>(TRACK_MAP_CHANNELS.updated, (next) => {
      setData(next ?? null)
    })
    return () => {
      canceled = true
      off()
    }
  }, [])
  return data
}

function ElementMap({ element, snapshot }: ElementProps) {
  const result = resolveBinding(element.binding ?? 'lapDistPct', snapshot)
  const playerPct = Math.min(1, Math.max(0, result.pct ?? result.numeric ?? snapshot?.lapDistPct ?? 0))
  const trackColor = element.style.color ?? '#5a6a7a'
  const playerColor = element.style.fillColor ?? '#49C5B1'
  const pitroadColor = element.style.warnColor ?? '#26313d'
  const sfColor = element.style.dangerColor ?? '#f6fbff'

  const trackData = useTrackMapData()
  const map = useMemo(() => buildTrackMap(trackData), [trackData])

  const style: CSSProperties = {
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    background: element.style.background ?? 'transparent',
    borderRadius: element.style.radius ?? 0
  }

  // Fallback (no real map yet): keep the original ellipse so the dashboard
  // still shows progress, just with a clear "indisponível" hint.
  if (!map || map.source === 'none' || !map.outlinePathD || map.totalLength <= 0) {
    const cx = 50
    const cy = 55
    const rx = 42
    const ry = 30
    const angle = playerPct * Math.PI * 2 - Math.PI / 2
    const dotX = cx + rx * Math.cos(angle)
    const dotY = cy + ry * Math.sin(angle)
    return (
      <div className="dash-element" style={style}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={trackColor} strokeWidth="2.5" strokeDasharray="3 2" opacity={0.55} />
          <circle cx={dotX} cy={dotY} r="3.2" fill={playerColor}>
            <animate attributeName="opacity" values="1;0.6;1" dur="1.4s" repeatCount="indefinite" />
          </circle>
          <text x={cx} y={cy + ry + 9} textAnchor="middle" fontSize="5" fill={trackColor} opacity={0.8}>
            map unavailable
          </text>
        </svg>
      </div>
    )
  }

  const vb = map.viewBox
  const outlineStroke = trackMapStrokeWidth(vb)
  const pitroadStroke = trackMapStrokeWidth(vb, 0.55)
  const otherR = trackMapDotRadius(vb, 0.78)
  const playerR = trackMapDotRadius(vb, 1.1)
  const sfStroke = trackMapStrokeWidth(vb, 1.3)

  const playerPt = map.sample(playerPct)
  const sfMarker = getStartFinishMarker(map)

  const drivers = snapshot?.drivers ?? []
  const others = drivers
    .filter((d) => !d.isPlayer && d.lapDistPct !== undefined && Number.isFinite(d.lapDistPct))
    .map((d) => ({ driver: d, pt: map.sample(d.lapDistPct as number) }))
    .filter((row): row is { driver: DriverEntry; pt: { x: number; y: number } } => row.pt !== null)

  return (
    <div className="dash-element" style={style}>
      <svg
        viewBox={`${vb[0]} ${vb[1]} ${vb[2]} ${vb[3]}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', overflow: 'visible' }}
      >
        {map.pitroadPathD && (
          <path
            d={map.pitroadPathD}
            fill="none"
            stroke={pitroadColor}
            strokeWidth={pitroadStroke}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.55}
          />
        )}
        <path
          d={map.outlinePathD}
          fill="none"
          stroke={trackColor}
          strokeWidth={outlineStroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {sfMarker && (
          <line
            x1={sfMarker.x1}
            y1={sfMarker.y1}
            x2={sfMarker.x2}
            y2={sfMarker.y2}
            stroke={sfColor}
            strokeWidth={sfStroke}
            strokeLinecap="round"
            opacity={0.9}
          />
        )}
        {others.map(({ driver, pt }) => (
          <circle
            key={driver.carIdx}
            cx={pt.x}
            cy={pt.y}
            r={otherR}
            fill={driver.classColor ?? '#ff5468'}
            stroke="#05121f"
            strokeWidth={outlineStroke * 0.4}
            opacity={0.95}
          >
            <title>{`P${driver.position ?? '—'} ${driver.name}`}</title>
          </circle>
        ))}
        {playerPt && (
          <circle
            cx={playerPt.x}
            cy={playerPt.y}
            r={playerR}
            fill={playerColor}
            stroke="#ffffff"
            strokeWidth={outlineStroke * 0.55}
          >
            <animate attributeName="opacity" values="1;0.7;1" dur="1.4s" repeatCount="indefinite" />
          </circle>
        )}
      </svg>
    </div>
  )
}

function ElementRadar({ element, snapshot }: ElementProps) {
  const playerColor = element.style.fillColor ?? '#49C5B1'
  const cx = 50
  const cy = 50
  const radius = 38
  const drivers = snapshot?.drivers ?? []
  const player = drivers.find((d) => d.isPlayer)
  const speedMs = (snapshot?.speedKmh ?? 0) / 3.6
  const cars: RadarCarEntry[] = snapshot?.radarCars?.length
    ? snapshot.radarCars
    : drivers
      .filter((d) => !d.isPlayer && d.gapToPlayerSec !== undefined && Math.abs(d.gapToPlayerSec) <= 5)
      .map((d) => ({
        carIdx: d.carIdx,
        name: d.name,
        relativeX: d.carIdx % 2 === 0 ? -3.2 : 3.2,
        relativeY: (d.gapToPlayerSec ?? 0) * Math.max(8, speedMs),
        gapSec: d.gapToPlayerSec,
        classColor: d.classColor
      }))
  const leftThreat = radarSideThreat(cars.filter((car) => car.relativeX < 0).map((car) => car.relativeY))
  const rightThreat = radarSideThreat(cars.filter((car) => car.relativeX > 0).map((car) => car.relativeY))

  // Positions opponents around the player based on gap (?5s mapped to ?radius)
  const dots = cars.map((car) => {
    const gap = car.gapSec
    const y = gap === undefined
      ? cy - Math.max(-1, Math.min(1, car.relativeY / 35)) * (radius * 0.8)
      : cy - (gap / 5) * (radius * 0.8)
    const x = cx + (car.relativeX < 0 ? -8 : car.relativeX > 0 ? 8 : 0)
    const threat = radarThreatLevel(car.relativeY)
    const sideThreat = car.relativeX !== 0 && threat !== 'clear'
    return {
      x,
      y,
      color: sideThreat ? radarThreatColor(car.relativeY) : (car.classColor ?? '#ff5468')
    }
  })

  const style: CSSProperties = {
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    background: element.style.background ?? 'transparent',
    borderRadius: element.style.radius ?? 0
  }
  return (
    <div className="dash-element" style={style}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#26313d" strokeWidth="1" />
        <circle cx={cx} cy={cy} r={radius * 0.5} fill="none" stroke="#1c252f" strokeWidth="1" strokeDasharray="2 3" />
        <line x1={cx} y1={cy - radius} x2={cx} y2={cy + radius} stroke="#1c252f" strokeWidth="0.6" />
        <line x1={cx - radius} y1={cy} x2={cx + radius} y2={cy} stroke="#1c252f" strokeWidth="0.6" />
        {dots.map((dot, i) => (
          <circle key={i} cx={dot.x} cy={dot.y} r="2.8" fill={dot.color} />
        ))}
        <text x={cx - radius + 2} y={cy + radius + 8} textAnchor="start" fontSize="5.5" fontWeight="700" fill={RADAR_THREAT_COLORS[leftThreat]}>
          L {leftThreat === 'clear' ? 'CLEAR' : leftThreat.toUpperCase()}
        </text>
        <text x={cx + radius - 2} y={cy + radius + 8} textAnchor="end" fontSize="5.5" fontWeight="700" fill={RADAR_THREAT_COLORS[rightThreat]}>
          R {rightThreat === 'clear' ? 'CLEAR' : rightThreat.toUpperCase()}
        </text>
        <circle cx={cx} cy={cy} r="3.4" fill={playerColor} stroke="#f6fbff" strokeWidth="0.8" />
        {player && (
          <text x={cx} y={cy + radius + 8} textAnchor="middle" fontSize="6" fill="#9aa6b2">
            P{player.position ?? '—'}
          </text>
        )}
      </svg>
    </div>
  )
}

function ElementRect({ element }: { element: DashboardElement }) {
  const style: CSSProperties = {
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    background: element.style.background ?? 'transparent',
    borderRadius: element.style.radius ?? 0,
    border: element.style.borderWidth
      ? `${element.style.borderWidth}px solid ${element.style.border ?? 'transparent'}`
      : undefined
  }
  return <div className="dash-element" style={style} />
}

function ElementText({ element, snapshot, unitSystem = 'metric' }: ElementProps) {
  const s = element.style
  const result = resolveBinding(element.binding, snapshot, unitSystem)
  let display = s.text ?? ''
  if (element.binding) {
    let value = result.text
    const displayNumeric = result.displayNumeric ?? result.numeric
    if (s.decimals !== undefined && displayNumeric !== undefined && Number.isFinite(displayNumeric)) {
      value = displayNumeric.toFixed(s.decimals)
    }
    const leadingSpace = s.suffix?.startsWith(' ') ? ' ' : ''
    const suffix = result.unit && s.suffix !== undefined ? `${leadingSpace}${result.unit}` : (s.suffix ?? '')
    display = `${s.prefix ?? ''}${value}${suffix}`
  } else if (s.prefix || s.suffix) {
    display = `${s.prefix ?? ''}${display}${s.suffix ?? ''}`
  }

  const align0 = s.align ?? 'left'
  const ov = resolveSlotStyle(s, 'value', {
    fontFamily: s.fontFamily ?? 'Segoe UI, sans-serif',
    fontSize: s.fontSize ?? 18,
    color: s.color ?? '#f6fbff',
    fontWeight: s.fontWeight ?? 600,
    align: align0,
    letterSpacing: '0.01em'
  })
  const align = ov.align ?? align0
  const style: CSSProperties = {
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    background: s.background ?? 'transparent',
    borderRadius: s.radius ?? 0,
    border: s.borderWidth ? `${s.borderWidth}px solid ${s.border ?? 'transparent'}` : undefined,
    color: ov.color ?? '#f6fbff',
    fontFamily: ov.fontFamily ?? 'Segoe UI, sans-serif',
    fontSize: ov.fontSize ?? 18,
    fontWeight: ov.fontWeight ?? 600,
    padding: s.padding ?? 0,
    letterSpacing: ov.letterSpacing ?? '0.01em',
    textTransform: ov.textTransform,
    textShadow: ov.textShadow,
    lineHeight: 1.05,
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis'
  }
  return (
    <div className="dash-element" data-align={align} style={style}>
      <AutoFitSpan
        text={display}
        align={align}
        maxSize={ov.fontSize ?? 18}
        minSize={s.minFontSize ?? 8}
        style={{ width: '100%', fontFamily: ov.fontFamily ?? 'Segoe UI, sans-serif', fontWeight: ov.fontWeight ?? 600, letterSpacing: ov.letterSpacing, textTransform: ov.textTransform, textShadow: ov.textShadow }}
      />
    </div>
  )
}

function ElementImage({ element }: { element: DashboardElement }) {
  const s = element.style
  const style: CSSProperties = {
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    background: s.background ?? 'transparent',
    borderRadius: s.radius ?? 0,
    border: s.borderWidth
      ? `${s.borderWidth}px solid ${s.border ?? 'transparent'}`
      : undefined,
    padding: s.padding ?? 0,
    opacity: s.opacity ?? 1
  }
  const fitToCss = (() => {
    switch (s.fit) {
      case 'contain':
        return 'contain'
      case 'fill':
        return 'fill'
      case 'none':
        return 'none'
      default:
        return 'cover'
    }
  })()
  const imgFilter = composeImageFilter(s)
  if (!s.src) {
    return (
      <div className="dash-element" style={style}>
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5a6a7a', fontSize: 12 }}>
          (no image)
        </div>
      </div>
    )
  }
  return (
    <div className="dash-element" style={style}>
      <img
        className="dash-image"
        src={s.src}
        alt={element.name ?? 'image'}
        style={{ objectFit: fitToCss, width: '100%', height: '100%', borderRadius: 'inherit', filter: imgFilter || undefined }}
        draggable={false}
      />
    </div>
  )
}

function ElementBarL({ element, snapshot }: ElementProps) {
  const result = resolveBinding(element.binding, snapshot)
  const pct = Math.min(1, Math.max(0, result.pct ?? 0))
  const color = pickFillColor(pct, element)
  const style: CSSProperties = {
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    background: element.style.background ?? 'transparent',
    borderRadius: element.style.radius ?? 0,
    border: element.style.borderWidth
      ? `${element.style.borderWidth}px solid ${element.style.border ?? 'transparent'}`
      : undefined
  }
  if (wantsRevLed(element)) {
    // Viewtical modelled LED bar: render a horizontal RevLedBar sized to the bar's
    // HEIGHT and rotate it into the column (reverse flips the fill direction).
    const ledProps = revLedPropsFor(element.style, pct, {
      width: Math.max(8, element.h - 4),
      height: Math.max(8, element.w - 4)
    })
    const rotate = element.style.reverse ? 90 : -90
    return (
      <div className="dash-element" style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <div style={{ transform: `rotate(${rotate}deg)`, transformOrigin: 'center', display: 'flex' }}>
          <RevLedBar {...ledProps} shape={ledProps.shape === 'led' ? 'bar' : ledProps.shape} />
        </div>
      </div>
    )
  }
  return (
    <div className="dash-element" style={style}>
      <div className={element.style.reverse ? 'dash-barv reverse' : 'dash-barv'}>
        <div
          className="dash-barv-fill"
          style={
            {
              ['--bar-pct' as string]: `${pct * 100}%`,
              background: color,
              borderRadius: element.style.radius ?? 0
            } as CSSProperties
          }
        />
      </div>
    </div>
  )
}

function ElementDualBar({ element, snapshot }: ElementProps) {
  const primary = resolveBinding(element.binding ?? 'throttle', snapshot)
  const secondary = resolveBinding(element.style.secondaryBinding ?? 'brake', snapshot)
  const p1 = Math.min(1, Math.max(0, primary.pct ?? primary.numeric ?? 0))
  const p2 = Math.min(1, Math.max(0, secondary.pct ?? secondary.numeric ?? 0))
  const c1 = element.style.fillColor ?? '#3ea0ff'
  const c2 = element.style.secondaryColor ?? '#ff5468'
  const style: CSSProperties = {
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    background: element.style.background ?? 'transparent',
    borderRadius: element.style.radius ?? 0,
    border: element.style.borderWidth
      ? `${element.style.borderWidth}px solid ${element.style.border ?? 'transparent'}`
      : undefined
  }
  if (wantsRevLed(element)) {
    // Two stacked modelled LED bars (primary + secondary), each in its own colour.
    const w = Math.max(8, element.w - 4)
    const rowH = Math.max(6, Math.floor((element.h - 12) / 2))
    const led1 = revLedPropsFor(element.style, p1, { width: w, height: rowH })
    const led2 = revLedPropsFor(element.style, p2, { width: w, height: rowH })
    return (
      <div className="dash-element" style={{ ...style, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        <RevLedBar {...led1} shape={led1.shape === 'led' ? 'bar' : led1.shape} colors={{ ...(led1.colors ?? {}), good: c1, warn: c1, danger: c1 }} />
        <RevLedBar {...led2} shape={led2.shape === 'led' ? 'bar' : led2.shape} colors={{ ...(led2.colors ?? {}), good: c2, warn: c2, danger: c2 }} />
      </div>
    )
  }
  return (
    <div className="dash-element" style={style}>
      <div className="dash-dualbar">
        <div className="dash-dualbar-track" style={{ borderRadius: (element.style.radius ?? 8) - 2 }}>
          <div
            className="dash-dualbar-fill"
            style={{ ['--bar-pct' as string]: `${p1 * 100}%`, background: c1 } as CSSProperties}
          />
        </div>
        <div className="dash-dualbar-track" style={{ borderRadius: (element.style.radius ?? 8) - 2 }}>
          <div
            className="dash-dualbar-fill"
            style={{ ['--bar-pct' as string]: `${p2 * 100}%`, background: c2 } as CSSProperties}
          />
        </div>
      </div>
    </div>
  )
}

function ElementDeltaBar({ element, snapshot }: ElementProps) {
  const result = resolveBinding(element.binding ?? 'deltaSec', snapshot)
  const delta = result.numeric ?? 0
  const range = Math.max(0.05, element.style.deltaRangeSec ?? 1)
  const clamped = Math.max(-range, Math.min(range, delta))
  // Normalizes to -1..+1 and converts to percentage 0..100 from the center (50%).
  const norm = clamped / range
  const halfPct = Math.abs(norm) * 50
  const left = norm < 0 ? 50 - halfPct : 50
  const width = halfPct
  // verde = melhor (delta negactive), vermelho = pior (positivo)
  const goodColor = element.style.fillColor ?? '#2dd96a'
  const badColor = element.style.dangerColor ?? '#ff5468'
  const color = norm < 0 ? goodColor : badColor
  const style: CSSProperties = {
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    background: element.style.background ?? 'rgba(255,255,255,0.04)',
    borderRadius: element.style.radius ?? 8,
    border: element.style.borderWidth
      ? `${element.style.borderWidth}px solid ${element.style.border ?? 'transparent'}`
      : undefined
  }
  return (
    <div className="dash-element" style={style}>
      <div className="dash-deltabar">
        <div
          className="dash-deltabar-fill"
          style={{ left: `${left}%`, width: `${Math.max(0.5, width)}%`, background: color }}
        />
        <div className="dash-deltabar-center" />
      </div>
    </div>
  )
}

function ElementFlag({ element, snapshot }: ElementProps) {
  const explicitKey = element.style.flagKey
  const active = getActiveFlag(snapshot)
  let isActive = false
  let bg = element.style.background ?? 'rgba(255,255,255,0.04)'
  let label = element.style.text ?? ''
  if (explicitKey) {
    // Show only this flag.
    const f = snapshot?.flags as unknown as Record<string, boolean> | undefined
    const on = Boolean(f?.[explicitKey])
    isActive = on
    if (on) {
      bg = element.style.fillColor ?? bg
      label = element.style.text ?? explicitKey.toUpperCase()
    }
  } else {
    // Show whichever flag is currently active.
    if (active) {
      isActive = true
      bg = element.style.fillColor ?? active.color
      label = element.style.text ?? active.label
    }
  }
  const style: CSSProperties = {
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    background: bg,
    color: element.style.color ?? '#0a0c10',
    borderRadius: element.style.radius ?? 8,
    border: element.style.borderWidth
      ? `${element.style.borderWidth}px solid ${element.style.border ?? 'transparent'}`
      : undefined,
    fontFamily: element.style.fontFamily ?? 'Segoe UI, sans-serif',
    fontSize: element.style.fontSize ?? 18,
    fontWeight: element.style.fontWeight ?? 900
  }
  return (
    <div className="dash-element" style={style}>
      <div className={isActive ? 'dash-flag active' : 'dash-flag idle'}>{label || (isActive ? 'FLAG' : '—')}</div>
    </div>
  )
}

interface TraceBuffer {
  primary: number[]
  secondary: number[]
}

function useTraceBuffer(
  element: DashboardElement,
  snapshot: TelemetrySnapshot | null
): TraceBuffer {
  const len = Math.max(8, Math.min(2048, element.style.traceLength ?? 120))
  const ref = useRef<TraceBuffer>({ primary: [], secondary: [] })
  const lastTsRef = useRef<number>(0)
  // Push novo valor a cada snapshot novo.
  if (snapshot && snapshot.timestamp !== lastTsRef.current) {
    lastTsRef.current = snapshot.timestamp
    const r1 = resolveBinding(element.binding ?? 'throttle', snapshot)
    const v1 = Math.min(1, Math.max(0, r1.pct ?? r1.numeric ?? 0))
    ref.current.primary.push(v1)
    if (ref.current.primary.length > len) ref.current.primary.splice(0, ref.current.primary.length - len)
    if (element.style.secondaryBinding) {
      const r2 = resolveBinding(element.style.secondaryBinding, snapshot)
      const v2 = Math.min(1, Math.max(0, r2.pct ?? r2.numeric ?? 0))
      ref.current.secondary.push(v2)
      if (ref.current.secondary.length > len)
        ref.current.secondary.splice(0, ref.current.secondary.length - len)
    }
  }
  // Adjusts buffer size if length changed.
  if (ref.current.primary.length > len) ref.current.primary.splice(0, ref.current.primary.length - len)
  if (ref.current.secondary.length > len) ref.current.secondary.splice(0, ref.current.secondary.length - len)
  return ref.current
}

function ElementTrace({ element, snapshot }: ElementProps) {
  const buf = useTraceBuffer(element, snapshot)
  const len = Math.max(8, Math.min(2048, element.style.traceLength ?? 120))
  const color1 = element.style.fillColor ?? '#49C5B1'
  const color2 = element.style.traceColor2 ?? '#ff5468'
  const stroke = element.style.traceWidth ?? 1.5
  const w = 100
  const h = 100
  function buildPath(samples: number[]): string {
    if (samples.length < 2) return ''
    const n = samples.length
    const pts: string[] = []
    for (let i = 0; i < n; i++) {
      const x = ((i + (len - n)) / Math.max(1, len - 1)) * w
      const y = h - samples[i] * h
      pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
    }
    return pts.join(' ')
  }
  const style: CSSProperties = {
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    background: element.style.background ?? 'rgba(255,255,255,0.03)',
    borderRadius: element.style.radius ?? 8,
    border: element.style.borderWidth
      ? `${element.style.borderWidth}px solid ${element.style.border ?? 'transparent'}`
      : undefined
  }
  return (
    <div className="dash-element" style={style}>
      <svg className="dash-trace-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <line x1="0" y1={h / 2} x2={w} y2={h / 2} stroke="rgba(255,255,255,0.06)" strokeWidth="0.4" />
        {buf.secondary.length > 1 && (
          <path d={buildPath(buf.secondary)} fill="none" stroke={color2} strokeWidth={stroke} vectorEffect="non-scaling-stroke" />
        )}
        {buf.primary.length > 1 && (
          <path d={buildPath(buf.primary)} fill="none" stroke={color1} strokeWidth={stroke} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
    </div>
  )
}

const DEFAULT_TABLE_COLUMNS = ['pos', 'number', 'name', 'gap', 'class']

function rowGridTemplate(cols: string[]): string {
  return cols
    .map((c) => {
      switch (c) {
        case 'pos':
        case 'classPos':
          return '34px'
        case 'number':
          return '40px'
        case 'class':
          return '14px'
        case 'gap':
          return '92px'
        case 'license':
          return '40px'
        case 'iRating':
          return '60px'
        case 'laps':
          return '50px'
        default:
          return 'minmax(0, 1fr)'
      }
    })
    .join(' ')
}

function formatCell(col: string, d: DriverEntry, playerLap?: number): string {
  switch (col) {
    case 'pos':
      return d.position ? String(d.position) : '—'
    case 'classPos':
      return d.classPosition ? String(d.classPosition) : '—'
    case 'number':
      return `#${d.carNumber || '?'}`
    case 'name':
      return d.name || '—'
    case 'gap': {
      const g = d.gapToPlayerSec
      if (g === undefined || !Number.isFinite(g)) return '—'
      if (Math.abs(g) < 0.001) return '0.000'
      const sign = g > 0 ? '+' : '−'
      return `${sign}${Math.abs(g).toFixed(3)}`
    }
    case 'license':
      return d.license ?? '—'
    case 'iRating':
      return d.iRating !== undefined ? String(d.iRating) : '—'
    case 'laps':
      if (d.lapsBehind !== undefined && d.lapsBehind > 0) return `-${d.lapsBehind}L`
      if (playerLap !== undefined) return String(playerLap)
      return '—'
    default:
      return ''
  }
}

function cellClass(col: string): string {
  if (col === 'pos' || col === 'classPos' || col === 'number' || col === 'license' || col === 'iRating' || col === 'laps')
    return 'dash-table-cell num'
  if (col === 'class') return 'dash-table-cell classchip'
  return 'dash-table-cell'
}

function ElementTable({ element, snapshot }: ElementProps) {
  const s = element.style
  const cols = s.tableColumns && s.tableColumns.length > 0 ? s.tableColumns : DEFAULT_TABLE_COLUMNS
  const maxRows = Math.max(1, Math.min(64, s.tableMaxRows ?? 8))
  const drivers = (snapshot?.drivers ?? []).slice().sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
  // Focuses on a window around the driver, or top N if highlightPlayer = false.
  let visible: DriverEntry[]
  const playerIdx = drivers.findIndex((d) => d.isPlayer)
  if (s.highlightPlayer !== false && playerIdx >= 0 && drivers.length > maxRows) {
    const before = Math.floor((maxRows - 1) / 2)
    let start = Math.max(0, playerIdx - before)
    if (start + maxRows > drivers.length) start = Math.max(0, drivers.length - maxRows)
    visible = drivers.slice(start, start + maxRows)
  } else {
    visible = drivers.slice(0, maxRows)
  }
  const showHeader = s.showHeader !== false
  const playerLap = snapshot?.currentLap
  const grid = rowGridTemplate(cols)
  const headerColor = s.headerColor ?? '#9aa6b2'
  const fontSize = s.fontSize ?? 14
  const rowAlt = s.rowAltBackground ?? 'rgba(255,255,255,0.025)'

  const style: CSSProperties = {
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    background: s.background ?? 'rgba(10,12,16,0.85)',
    color: s.color ?? '#f6fbff',
    borderRadius: s.radius ?? 10,
    border: s.borderWidth
      ? `${s.borderWidth}px solid ${s.border ?? 'transparent'}`
      : undefined,
    fontFamily: s.fontFamily ?? 'Segoe UI, sans-serif',
    fontWeight: s.fontWeight ?? 600,
    fontSize,
    padding: s.padding ?? 6,
    overflow: 'hidden'
  }
  const headerHeight = showHeader ? Math.max(20, Math.round(fontSize * 1.4)) : 0
  const availableH = (element.h - (typeof style.padding === 'number' ? style.padding * 2 : 12)) - headerHeight
  const rowH = s.rowHeight ?? Math.max(18, Math.floor(availableH / Math.max(1, visible.length)))

  return (
    <div className="dash-element" style={style}>
      <div className="dash-table">
        {showHeader && (
          <div
            className="dash-table-row header"
            style={{ gridTemplateColumns: grid, height: headerHeight, color: headerColor }}
          >
            {cols.map((c) => (
              <div key={`h-${c}`} className={cellClass(c)}>
                {c === 'pos' ? 'P' : c === 'classPos' ? 'CP' : c === 'number' ? '#' : c === 'name' ? 'Driver' : c === 'gap' ? 'Gap' : c === 'class' ? '' : c === 'license' ? 'Lic' : c === 'iRating' ? 'iR' : c === 'laps' ? 'Lap' : c}
              </div>
            ))}
          </div>
        )}
        {visible.map((d, idx) => {
          const cls = [
            'dash-table-row body',
            d.isPlayer && s.highlightPlayer !== false ? 'player' : '',
            idx % 2 === 1 && !d.isPlayer ? 'zebra' : ''
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <div
              key={`${d.carIdx}-${idx}`}
              className={cls}
              style={{
                gridTemplateColumns: grid,
                height: rowH,
                background: idx % 2 === 1 && !d.isPlayer && rowAlt ? rowAlt : undefined
              }}
            >
              {cols.map((c) => {
                if (c === 'class') {
                  return (
                    <div key={`${d.carIdx}-${c}`} className={cellClass(c)}>
                      <span className="chip" style={{ background: d.classColor ?? '#49C5B1' }} />
                    </div>
                  )
                }
                return (
                  <div key={`${d.carIdx}-${c}`} className={cellClass(c)}>
                    {formatCell(c, d, playerLap)}
                  </div>
                )
              })}
            </div>
          )
        })}
        {visible.length === 0 && (
          <div style={{ color: '#5a6a7a', fontSize: fontSize * 0.9, padding: '8px 6px' }}>
            (no standings in telemetry)
          </div>
        )}
      </div>
    </div>
  )
}

// WS-DASH: render a full-frame overlay widget INSIDE a dashboard element box. The
// six dashboards (gridStackDash … lmuStintDash) ship as overlay-widget components
// kept in WIDGET_COMPONENTS; we resolve the one named by `element.widgetId` and
// mount it filling the element's box, fed by the live dashboard `snapshot`. The
// widget's own root (.overlay-card.dr-root → width/height:100%) fills the box, so
// the container just supplies position/size + an optional frame and switches the
// shared `.dash-element` flex centering to block flow. `config` is a minimal,
// locked stub: these widgets are snapshot-driven and ignore most of it (some read
// `config.id`). Missing/unknown widgetId gets a subtle labelled fallback so a
// broken persisted board remains editable instead of looking like a black canvas.
function ElementOverlayWidget({ element, snapshot, preview }: ElementProps) {
  const widgetId =
    element.widgetId ??
    (element.hifiModuleId ? (`hifi:${element.hifiModuleId}` as DashboardElement['widgetId']) : undefined)
  const Widget = widgetId ? resolveWidgetComponent(widgetId) : undefined
  const containerStyle: CSSProperties = {
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    display: 'block',
    background: element.style.background ?? 'transparent',
    borderRadius: element.style.radius ?? 0,
    border: element.style.borderWidth
      ? `${element.style.borderWidth}px solid ${element.style.border ?? 'transparent'}`
      : undefined
  }
  if (!widgetId || !Widget) {
    return (
      <div className="dash-element dash-overlaywidget" style={containerStyle}>
        <div
          data-dashboard-unknown-widget={widgetId ?? 'missing'}
          style={{
            width: '100%',
            height: '100%',
            display: 'grid',
            placeItems: 'center',
            alignContent: 'center',
            gap: 4,
            boxSizing: 'border-box',
            border: '1px dashed rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.025)',
            color: 'rgba(255,255,255,0.48)',
            fontSize: 12,
            textAlign: 'center',
            padding: 8,
            overflow: 'hidden'
          }}
        >
          <span>Unknown widget</span>
          {widgetId && (
            <span style={{ maxWidth: '100%', fontSize: 10, opacity: 0.72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {widgetId}
            </span>
          )}
        </div>
      </div>
    )
  }
  const config: OverlayWidgetConfig = {
    id: widgetId,
    enabled: true,
    locked: true,
    favorite: false,
    position: { x: element.x, y: element.y, width: element.w, height: element.h },
    opacity: 100,
    stylePreset: DEFAULT_OVERLAY_STYLE_PRESET,
    style: createDefaultOverlayStyle(),
    display: null,
    hifiModuleId: element.hifiModuleId
  }
  return (
    <div className="dash-element dash-overlaywidget" style={containerStyle}>
      {preview === 'inert' && widgetId.startsWith('hifi:') ? (
        <HifiWidgetHost snapshot={snapshot} config={config} preview="inert" />
      ) : preview === 'inert' && INERT_OVERLAY_WIDGET_IDS.has(widgetId) ? (
        <InertWidgetFixture element={element} snapshot={snapshot} source={widgetId} contained />
      ) : (
        <Widget snapshot={snapshot} config={config} />
      )}
    </div>
  )
}

function ElementSwitcher(props: ElementProps) {
  const unitSystem = useUnitSystem()
  const sourceElement = props.element
  const label = displayUnitLabel(sourceElement.style.label, sourceElement.binding, sourceElement.style.suffix, unitSystem)
  const title = displayUnitLabel(sourceElement.style.title, sourceElement.binding, sourceElement.style.suffix, unitSystem)
  const element = label !== sourceElement.style.label || title !== sourceElement.style.title
    ? { ...sourceElement, style: { ...sourceElement.style, label, title } }
    : sourceElement
  const unitProps = { ...props, element, unitSystem }
  if (element.visible === false) return null
  if (props.preview === 'inert' && needsInertFixture(element.type)) {
    return <InertWidgetFixture {...unitProps} source={element.type} />
  }
  switch (element.type) {
    case 'text':
      return <ElementText {...unitProps} />
    case 'rect':
      return <ElementRect element={element} />
    case 'bar':
      return <ElementBar {...unitProps} />
    case 'barv':
      return <ElementBarL {...unitProps} />
    case 'dualbar':
      return <ElementDualBar {...unitProps} />
    case 'deltabar':
      return <ElementDeltaBar {...unitProps} />
    case 'shiftlights':
      return <ElementShiftLights {...unitProps} />
    case 'gauge':
      return <ElementGauge {...unitProps} />
    case 'map':
      return <ElementMap {...unitProps} />
    case 'radar':
      return <ElementRadar {...unitProps} />
    case 'image':
      return <ElementImage element={element} />
    case 'flag':
      return <ElementFlag {...unitProps} />
    case 'trace':
      return <ElementTrace {...unitProps} />
    case 'table':
    case 'standings':
      return <ElementTable {...unitProps} />
    case 'overlaywidget':
      return <ElementOverlayWidget {...unitProps} />
    default:
      return renderGt3Widget(unitProps)
  }
}

// Faithful single-element renderer reused by tests/harnesses so previews match
// production exactly (same primitives + GT3 widgets, same binding resolution).
export function renderDashboardElement(props: { element: DashboardElement; snapshot: TelemetrySnapshot | null; preview?: DashboardPreviewMode }) {
  return <ElementSwitcher {...props} />
}

// ─── Adaptive runtime (feature-gated to the adaptive dashboard) ──────────────
// Recompute the micro race-moment at ~7 Hz (NOT per frame) — anti-flicker. The
// macro phase plan is derived from the live snapshot on each render (pure/cheap).
const MOMENT_RECOMPUTE_MS = 140

// Warm chrome only; green (good) is reserved for positive states per the rule.
const MOMENT_COLOR_CSS: Record<RaceMomentColor, string> = {
  normal: '#FF7A00',
  caution: '#FFB800',
  critical: '#FF2200',
  good: '#1AFF6E'
}

// Anti-flicker race-moment reducer driven by live telemetry + predictions. Only
// runs while `enabled` (the active dashboard is adaptive); otherwise it returns
// an empty result so normal dashboards never pay for it. Also resolves the FULL
// set of currently-active catalog moments (drives the user's adaptive rules).
interface RaceMomentRuntime {
  moment: RaceMomentState | null
  active: ReadonlySet<string>
}

const EMPTY_ACTILE: ReadonlySet<string> = new Set<string>()

function useRaceMoment(enabled: boolean, externalSnapshot: TelemetrySnapshot | null): RaceMomentRuntime {
  const momentRef = useRef<RaceMomentState | null>(null)
  const liveSnapshotRef = useRef<TelemetrySnapshot | null>(null)
  const predictionsRef = useRef<PredictionsSnapshot | null>(null)
  const [runtime, setRuntime] = useState<RaceMomentRuntime>({ moment: null, active: EMPTY_ACTILE })

  useEffect(() => {
    liveSnapshotRef.current = externalSnapshot
  }, [externalSnapshot])

  useEffect(() => {
    if (!enabled) {
      momentRef.current = null
      setRuntime({ moment: null, active: EMPTY_ACTILE })
      return
    }
    momentRef.current = initialRaceMomentState()
    const ipc = (window as typeof window & { ipc?: typeof window.ipc }).ipc
    let offPredictions: (() => void) | undefined
    if (ipc) {
      try {
        offPredictions = ipc.subscribe<PredictionsSnapshot | null>(PREDICTIONS_CHANNELS.snapshot, (snap) => {
          predictionsRef.current = snap
        })
      } catch {
        // predictions channel not registered — telemetry-only fallback
      }
    }
    const id = window.setInterval(() => {
      const next = resolveRaceMoment(liveSnapshotRef.current, predictionsRef.current, momentRef.current)
      momentRef.current = next
      const active = detectActiveMoments(liveSnapshotRef.current, predictionsRef.current, next)
      const activeKey = [...active].sort().join('|')
      // Re-render only when the hero moment/colour OR the active set changes.
      setRuntime((cur) => {
        const curKey = [...cur.active].sort().join('|')
        if (cur.moment && cur.moment.moment === next.moment && cur.moment.color === next.color && curKey === activeKey) {
          return cur
        }
        return { moment: next, active }
      })
    }, MOMENT_RECOMPUTE_MS)
    return () => {
      offPredictions?.()
      window.clearInterval(id)
    }
  }, [enabled])

  return runtime
}

// Renders the adaptive board: the deterministic plan + micro moment layer decide
// which widgets to emphasize / hide / promote / demote. Positions never change —
// promotion is a CSS transform/opacity tween — so a mid-lap switch can't relayout.
// Renders the adaptive board: the deterministic plan + micro moment layer decide
// which widgets to emphasize / hide / promote / demote, and the USER rules for the
// currently-active moments layer show/hide + emphasis + blink on top. Positions
// never change — promotion/emphasis is a CSS transform/opacity tween + blink class
// — so a mid-lap switch can't relayout. Returns the per-element nodes plus the
// winning whole-dashboard blink (applied by the caller as an overlay).
function AdaptiveCanvas({
  dashboard,
  snapshot,
  momentState,
  activeMoments,
  onDashboardBlink,
  onFrameBg
}: {
  dashboard: Dashboard
  snapshot: TelemetrySnapshot | null
  momentState: RaceMomentState | null
  activeMoments: ReadonlySet<string>
  onDashboardBlink: (blink: AdaptiveBlink | undefined) => void
  onFrameBg: (bg: string | undefined) => void
}) {
  const resolved = useMemo(() => {
    const plan = withRaceMoment(planAdaptiveDashboard(snapshot), momentState)
    return resolveAdaptiveRuntime(dashboard.elements, plan, dashboard.adaptive, activeMoments)
  }, [dashboard.elements, dashboard.adaptive, snapshot, momentState, activeMoments])

  useEffect(() => {
    onDashboardBlink(resolved.dashboardBlink)
    return () => onDashboardBlink(undefined)
  }, [resolved.dashboardBlink, onDashboardBlink])

  useEffect(() => {
    onFrameBg(resolved.frameBg)
    return () => onFrameBg(undefined)
  }, [resolved.frameBg, onFrameBg])

  const visible = resolved.elements.filter((r) => !r.hidden)
  return (
    <>
      {visible.map(({ element, emphasis, moment, user }) => (
        <AdaptiveElement key={element.id} element={element} emphasis={emphasis} moment={moment} user={user} snapshot={snapshot} />
      ))}
    </>
  )
}

function AdaptiveElement({
  element,
  emphasis,
  moment,
  user,
  snapshot
}: {
  element: DashboardElement
  emphasis: Emphasis
  moment?: MomentApply
  user?: UserElementApply
  snapshot: TelemetrySnapshot | null
}) {
  const promoted = moment?.action === 'promote'
  const demoted = moment?.action === 'demote'
  const momentColor = moment ? MOMENT_COLOR_CSS[moment.color] : undefined
  const outlineColor = promoted ? momentColor : emphasis === 'emphasize' ? MOMENT_COLOR_CSS.normal : undefined
  // User emphasis multiplier stacks on top of the micro-moment scale.
  const userEmphasis = user?.emphasis && user.emphasis > 0 ? user.emphasis : 1
  const baseScale = moment && moment.scale !== 1 ? moment.scale : 1
  const scale = baseScale * userEmphasis
  const userBoost = userEmphasis > 1 ? Math.round((userEmphasis - 1) * 6000) : 0
  const blink = user?.blink
  const blinkDurationS = blink?.hz && blink.hz > 0 ? 1 / blink.hz : 1 / 1.5
  // The wrapper carries position/transform/emphasis chrome; the inner element is
  // rendered at the origin so the GT3 widgets are untouched (no widget edits).
  const wrapperStyle: CSSProperties = {
    position: 'absolute',
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    boxSizing: 'border-box',
    borderRadius: element.style.radius ?? 8,
    outline: outlineColor ? `2px solid ${outlineColor}` : undefined,
    outlineOffset: 1,
    opacity: moment?.opacity ?? 1,
    transform: scale !== 1 ? `scale(${scale})` : undefined,
    transformOrigin: 'center center',
    zIndex: (element.style.zIndex ?? 0) + (promoted ? 5000 : demoted ? -100 : 0) + userBoost,
    boxShadow: promoted && momentColor ? `0 0 14px ${momentColor}` : undefined,
    transition: 'transform 200ms ease, opacity 200ms ease, outline-color 200ms ease, box-shadow 200ms ease',
    ...(blink ? ({ '--adp-blink-color': blink.color, '--adp-blink-duration': `${blinkDurationS}s` } as CSSProperties) : {})
  }
  return (
    <div className={blink ? 'adp-blink' : undefined} style={wrapperStyle}>
      <ElementSwitcher element={{ ...element, x: 0, y: 0 }} snapshot={snapshot} />
    </div>
  )
}

export function DashboardCanvas({
 dashboard,
 snapshot,
 kiosk = false,
 dashId = null
}: {
 dashboard: Dashboard
 snapshot: TelemetrySnapshot | null
 kiosk?: boolean
 dashId?: string | null
}) {
 const baseW = dashboard.width ?? 1920
 const baseH = dashboard.height ?? 1080
 const scaleMode: DashboardScaleMode = dashboard.scaleMode ?? 'stretch'
 const scale = useScale(baseW, baseH, scaleMode)
 const adaptive = useMemo(
   () => isAdaptiveDashboard(dashboard) || dashboard.adaptive?.enabled === true,
   [dashboard]
 )
 useEffect(() => retainBindingIpc(), [])
 const { moment: momentState, active: activeMoments } = useRaceMoment(adaptive, snapshot)
 const [dashBlink, setDashBlink] = useState<AdaptiveBlink | undefined>(undefined)
 const onDashboardBlink = useCallback((b: AdaptiveBlink | undefined) => setDashBlink(b), [])
 const [frameBg, setFrameBg] = useState<string | undefined>(undefined)
 const onFrameBg = useCallback((bg: string | undefined) => setFrameBg(bg), [])
 const activeBg = (adaptive && frameBg) || dashboard.bg

 const shellStyle: CSSProperties = {
   background: activeBg
 }

 const canvasStyle: CSSProperties = {
   width: baseW,
   height: baseH,
   left: scale.left,
   top: scale.top,
   transform:
     scale.scaleX === scale.scaleY
       ? `scale(${scale.scaleX})`
       : `scale(${scale.scaleX}, ${scale.scaleY})`,
   background: activeBg
 }

 return (
   <div className={kiosk ? 'dashboard-shell is-kiosk' : 'dashboard-shell'} style={shellStyle}>
     <div className="dashboard-canvas" style={canvasStyle}>
       {adaptive ? (
         <AdaptiveCanvas
           dashboard={dashboard}
           snapshot={snapshot}
           momentState={momentState}
           activeMoments={activeMoments}
           onDashboardBlink={onDashboardBlink}
           onFrameBg={onFrameBg}
         />
       ) : (
         sortElementsByZ(dashboard.elements).map((el) => (
           <ElementSwitcher key={el.id} element={el} snapshot={snapshot} />
         ))
       )}
     </div>
     {adaptive && dashBlink && (
       <div
         className="adp-dash-blink-overlay"
         style={
           {
             '--adp-blink-color': dashBlink.color,
             '--adp-blink-duration': `${dashBlink.hz && dashBlink.hz > 0 ? 1 / dashBlink.hz : 1 / 1.5}s`
           } as CSSProperties
         }
       />
     )}
     {!snapshot?.connected && (
       <div className="dash-status">
         Telemetry disconnected ? set a source (e.g., Mock) in Settings.
       </div>
     )}
     {kiosk && <KioskGestureLayer dashId={dashId} />}
   </div>
 )
}

export function DashboardRoot() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [expressionPlacements, setExpressionPlacements] = useState<DashboardElement[]>([])
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dashId = useMemo(getDashIdFromQuery, [])
  const kiosk = useMemo(getKioskFromQuery, [])
  const lastFrameRef = useRef<number>(performance.now())

  useEffect(() => {
    if (!dashId) {
      setError('No dashboard selected (?dash=<id> missing).')
      return
    }
    setError(null)
    return subscribeWithHydration<Dashboard | null>({
      subscribe: (apply) => window.ipc.subscribe<Dashboard>('app:dash:updated', (next) => {
        if (next?.id === dashId) apply(next)
      }),
      hydrate: () => window.ipc.invoke<Dashboard | null>('app:dash:get', dashId),
      revision: (dash) => dash?.updatedAt ?? dash?.createdAt ?? Number.NEGATIVE_INFINITY,
      apply: (dash) => {
        if (!dash) {
          setDashboard(null)
          setError(`Dashboard not found: ${dashId}`)
          return
        }
        setError(null)
        setDashboard(dash)
      },
      onError: (err) => {
        setDashboard(null)
        setError(err instanceof Error ? err.message : 'Failed to load dashboard')
      }
    })
  }, [dashId])

  useEffect(() => {
    if (!dashId) return
    let canceled = false
    const refresh = (): void => {
      void window.ipc
        .invoke<ExpressionDestinationPlacement[]>(EXPR_CHANNELS.getPlacements, {
          surface: 'dashboard',
          targetId: dashId
        })
        .then((placements) => {
          if (!canceled) setExpressionPlacements((placements ?? []).map((item) => item.element))
        })
        .catch(() => {
          if (!canceled) setExpressionPlacements([])
        })
    }
    refresh()
    const off = window.ipc.subscribe(EXPR_CHANNELS.studioChanged, refresh)
    const offDashboard = window.ipc.subscribe<Dashboard>('app:dash:updated', (next) => {
      if (next?.id === dashId) refresh()
    })
    return () => {
      canceled = true
      off()
      offDashboard()
    }
  }, [dashId])

  useEffect(() => {
    let cancelled = false
    let frame = 0
    let controls: DashboardCycleControlState = { next: null, prev: null }
    const pressedState = new Map<string, boolean>()

    const setControls = (nextControls: DashboardCycleControlState): void => {
      controls = nextControls ?? { next: null, prev: null }
    }

    void window.ipc
      .invoke<DashboardCycleControlState>('app:dash:cycleControl:get')
      .then((nextControls) => {
        if (!cancelled) setControls(nextControls)
      })
      .catch(() => undefined)

    const offControls = window.ipc.subscribe<DashboardCycleControlState>('app:dash:cycleControl', setControls)

    const tick = (): void => {
      const pairs: Array<['next' | 'prev', HidButtonControl | null]> = [
        ['next', controls.next],
        ['prev', controls.prev]
      ]
      for (const [direction, control] of pairs) {
        if (!control) continue
        const key = cycleControlKey(direction, control)
        const pressed = readButtonPressed(control.gamepadIndex, control.buttonIndex, control.gamepadId)
        const wasPressed = pressedState.get(key) ?? false
        pressedState.set(key, pressed)
        if (pressed && !wasPressed) {
          void window.ipc.invoke('app:dash:cycle', direction).catch(() => undefined)
        }
      }
      frame = window.requestAnimationFrame(tick)
    }

    frame = window.requestAnimationFrame(tick)
    return () => {
      cancelled = true
      offControls()
      window.cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    return subscribeWithHydration<TelemetrySnapshot | null>({
      subscribe: (apply) => window.ipc.subscribe<TelemetrySnapshot | null>('telemetry:snapshot', apply),
      hydrate: () => window.ipc.invoke<TelemetrySnapshot | null>('telemetry:getLatest'),
      revision: (snap) => snap?.timestamp ?? Number.NEGATIVE_INFINITY,
      apply: (snap) => {
        lastFrameRef.current = performance.now()
        setSnapshot(snap)
      }
    })
  }, [])

  if (error) {
    return (
      <div className="dashboard-shell">
        <div className="dash-missing">
          <div>⚠ {error}</div>
          <div style={{ fontSize: 14 }}>Close this window and reopen it from the main panel.</div>
        </div>
      </div>
    )
  }

  if (!dashboard) {
    return (
      <div className="dashboard-shell">
        <div className="dash-missing">Loading dashboard…</div>
      </div>
    )
  }

  const expressionIds = new Set(expressionPlacements.map((element) => element.id))
  const effectiveDashboard: Dashboard = {
    ...dashboard,
    elements: [...dashboard.elements.filter((element) => !expressionIds.has(element.id)), ...expressionPlacements]
  }
  return <DashboardCanvas dashboard={effectiveDashboard} snapshot={snapshot} kiosk={kiosk} dashId={dashId} />
}

import { type ReactElement, type ReactNode } from 'react'
import type { TelemetrySnapshot } from '../../../shared/telemetry'

const W = 1024
const H = 600
const EM = '—'

const COL = {
  bg: '#020404',
  panel: '#050808',
  panel2: '#07100a',
  stroke: 'rgba(190,205,198,0.16)',
  grid: 'rgba(125,146,142,0.17)',
  text: '#d5d7d8',
  dim: '#8b9396',
  muted: '#596166',
  blue: '#18bfff',
  green: '#75c83b',
  red: '#ff442e',
  amber: '#f5b722',
  purple: '#b15ad9'
}

function n(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const p = Number.parseFloat(v)
    return Number.isFinite(p) ? p : undefined
  }
  return undefined
}

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo
}

function fixed(v: number | undefined, d = 0): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : EM
}

function lapTime(sec: number | undefined): string {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return EM
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(3).padStart(6, '0')}`
}

function gearLabel(g: unknown): string {
  const v = n(g)
  if (v == null) return EM
  if (v < 0) return 'R'
  if (v === 0) return 'N'
  return String(Math.trunc(v))
}

function xPct(x: number, x0: number, w: number): number {
  return x0 + clamp(x, 0, 1) * w
}

function yRange(v: number | undefined, lo: number, hi: number, y0: number, h: number): number {
  const f = v == null ? 0 : (clamp(v, lo, hi) - lo) / (hi - lo)
  return y0 + h - f * h
}

function poly(points: Array<[number, number]>): string {
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
}

function Panel({ x, y, w, h, children }: { x: number; y: number; w: number; h: number; children?: ReactNode }): ReactElement {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={4} fill={COL.panel} stroke={COL.stroke} />
      {children}
    </g>
  )
}

function mono(size = 14): string {
  return `'Roboto Mono','Chakra Petch','Consolas',monospace`
}

function tech(size = 14): string {
  return `'Rajdhani','Barlow Condensed',sans-serif`
}

function Label({ x, y, children, anchor = 'start', c = COL.dim, size = 13 }: { x: number; y: number; children: ReactNode; anchor?: 'start' | 'middle' | 'end'; c?: string; size?: number }): ReactElement {
  return (
    <text x={x} y={y} textAnchor={anchor} fill={c} fontFamily={tech(size)} fontSize={size} fontWeight={700} letterSpacing={1.2}>
      {children}
    </text>
  )
}

function statColor(v: number | undefined, neutral = COL.text): string {
  if (v == null) return COL.dim
  if (v < 0) return COL.green
  if (v > 0) return COL.red
  return neutral
}

function makeFrames(snapshot: TelemetrySnapshot, history?: TelemetrySnapshot[]): { frames: TelemetrySnapshot[]; synthetic: boolean } {
  const clean = (history ?? []).filter(Boolean)
  if (clean.length >= 3) return { frames: clean.slice(-160), synthetic: false }

  const baseSpeed = n(snapshot.speedKmh) ?? 165
  const frames = Array.from({ length: 120 }, (_, i) => {
    const t = i / 119
    const wave = 0.5 + 0.5 * Math.sin(t * Math.PI * 6 - 0.7)
    const brake = Math.max(0, Math.sin(t * Math.PI * 12 - 1.2)) ** 4
    return {
      ...snapshot,
      speedKmh: clamp(baseSpeed * (0.72 + wave * 0.58) - brake * 65, 40, 285),
      throttle: clamp(0.35 + wave * 0.65 - brake * 0.95, 0, 1),
      brake: clamp(brake, 0, 1),
      gear: Math.max(2, Math.min(6, Math.round(2 + wave * 4))),
      latAccelG: Math.sin(t * Math.PI * 10) * 0.75,
      longAccelG: brake > 0.1 ? -1.45 * brake : 0.42 + wave * 0.2
    }
  })
  return { frames, synthetic: true }
}

function grid(x: number, y: number, w: number, h: number, cols: number, rows: number): ReactElement {
  return (
    <g>
      {Array.from({ length: cols + 1 }, (_, i) => (
        <line key={`c${i}`} x1={x + (w * i) / cols} y1={y} x2={x + (w * i) / cols} y2={y + h} stroke={COL.grid} strokeDasharray={i === 0 ? undefined : '3 4'} />
      ))}
      {Array.from({ length: rows + 1 }, (_, i) => (
        <line key={`r${i}`} x1={x} y1={y + (h * i) / rows} x2={x + w} y2={y + (h * i) / rows} stroke={COL.grid} strokeDasharray={i === rows ? undefined : '3 4'} />
      ))}
    </g>
  )
}

function TraceChart({ snapshot, history }: { snapshot: TelemetrySnapshot; history?: TelemetrySnapshot[] }): ReactElement {
  const { frames, synthetic } = makeFrames(snapshot, history)
  const x = 318
  const y = 140
  const w = 470
  const h = 184
  const step = Math.max(1, frames.length - 1)
  const pts = (pick: (s: TelemetrySnapshot) => number | undefined, lo: number, hi: number): Array<[number, number]> =>
    frames.map((f, i) => [xPct(i / step, x, w), yRange(pick(f), lo, hi, y, h)])
  const speedPts = pts((s) => n(s.speedKmh), 0, 300)
  const throttlePts = pts((s) => (n(s.throttle) ?? 0) * 100, 0, 100)
  const brakePts = pts((s) => (n(s.brake) ?? 0) * 100, 0, 100)
  const gearY = 386
  const gearH = 80
  const gearPts = frames.map((f, i) => [xPct(i / step, x, w), yRange(n(f.gear), 1, 6, gearY, gearH)] as [number, number])

  return (
    <Panel x={264} y={84} w={570} h={388}>
      <rect x={270} y={90} width={558} height={26} fill="#020303" />
      <line x1={270} y1={116} x2={828} y2={116} stroke={COL.stroke} />
      <g fontFamily={mono()} fontSize={13} fontWeight={700}>
        <text x={284} y={104} fill={COL.blue}>━ SPEED [km/h]</text>
        <text x={426} y={104} fill={COL.green}>━ THROTTLE [%]</text>
        <text x={580} y={104} fill={COL.red}>━ BRAKE [%]</text>
      </g>
      {grid(x, y, w, h, 9, 5)}
      {[0, 50, 100, 150, 200, 250, 300].map((v) => (
        <text key={v} x={312} y={yRange(v, 0, 300, y, h) + 4} textAnchor="end" fill={v === 300 ? COL.blue : COL.dim} fontFamily={mono()} fontSize={12}>
          {v}
        </text>
      ))}
      {[0, 40, 80, 100].map((v) => (
        <text key={v} x={800} y={yRange(v, 0, 100, y, h) + 4} fill={v === 100 ? COL.text : COL.dim} fontFamily={mono()} fontSize={12}>
          {v}
        </text>
      ))}
      {['S1', 'S2', 'S3'].map((s, i) => (
        <g key={s}>
          {i > 0 && <line x1={x + (w * i) / 3} y1={118} x2={x + (w * i) / 3} y2={474} stroke="rgba(220,220,220,0.55)" strokeDasharray="4 4" />}
          <text x={x + (w * (i + 0.5)) / 3} y={132} textAnchor="middle" fill={COL.text} fontFamily={mono()} fontSize={13}>
            {s}
          </text>
        </g>
      ))}
      <polyline points={poly(speedPts)} fill="none" stroke={COL.blue} strokeWidth={2} opacity={synthetic ? 0.72 : 1} />
      <polyline points={poly(throttlePts)} fill="none" stroke={COL.green} strokeWidth={1.7} opacity={synthetic ? 0.62 : 0.95} />
      <polyline points={poly(brakePts)} fill="none" stroke={COL.red} strokeWidth={1.7} opacity={synthetic ? 0.62 : 0.95} />
      <text x={280} y={235} transform="rotate(-90 280 235)" fill={COL.blue} fontFamily={mono()} fontSize={12} fontWeight={700}>SPEED [km/h]</text>
      <text x={822} y={270} transform="rotate(-90 822 270)" fill={COL.green} fontFamily={mono()} fontSize={9} fontWeight={700}>THR / BRK [%]</text>
      <text x={554} y={352} textAnchor="middle" fill={COL.dim} fontFamily={mono()} fontSize={12}>DISTANCE [m]</text>
      <line x1={270} y1={356} x2={828} y2={356} stroke={COL.stroke} />
      <Label x={280} y={374} c={COL.text} size={12}>GEAR</Label>
      {grid(x, gearY, w, gearH, 9, 4)}
      <polyline points={poly(gearPts)} fill="none" stroke={COL.amber} strokeWidth={2} />
      {[1, 2, 3, 4, 5, 6].map((v) => (
        <text key={v} x={312} y={yRange(v, 1, 6, gearY, gearH) + 4} textAnchor="end" fill={COL.dim} fontFamily={mono()} fontSize={12}>
          {v}
        </text>
      ))}
    </Panel>
  )
}

function LeftReadouts({ snapshot, history }: { snapshot: TelemetrySnapshot; history?: TelemetrySnapshot[] }): ReactElement {
  const speed = n(snapshot.speedKmh)
  const rpm = n(snapshot.rpm)
  const frames = (history ?? []).slice(-80)
  const gx = 86
  const gy = 384
  const gs = 74
  const dotX = (lat: number | undefined): number => gx + gs / 2 + clamp(lat ?? 0, -2, 2) * (gs / 4)
  const dotY = (long: number | undefined): number => gy + gs / 2 - clamp(long ?? 0, -2, 2) * (gs / 4)
  return (
    <Panel x={8} y={84} w={250} h={388}>
      <Label x={18} y={108}>SPEED</Label>
      <text x={36} y={154} fill={COL.blue} fontFamily={mono()} fontSize={48} fontWeight={800}>{fixed(speed, 1)}</text>
      <text x={188} y={154} fill={COL.dim} fontFamily={tech()} fontSize={17} fontWeight={700}>km/h</text>
      <line x1={8} y1={176} x2={258} y2={176} stroke={COL.stroke} />
      <Label x={18} y={202}>RPM</Label>
      <text x={36} y={266} fill={COL.text} fontFamily={mono()} fontSize={52} fontWeight={800}>{fixed(rpm)}</text>
      <text x={188} y={266} fill={COL.dim} fontFamily={tech()} fontSize={17} fontWeight={700}>rpm</text>
      <line x1={8} y1={284} x2={258} y2={284} stroke={COL.stroke} />
      <Label x={18} y={310}>GEAR</Label>
      <text x={128} y={358} textAnchor="middle" fill={COL.text} fontFamily={mono()} fontSize={58} fontWeight={800}>{gearLabel(snapshot.gear)}</text>
      <line x1={8} y1={362} x2={258} y2={362} stroke={COL.stroke} />
      <Label x={18} y={382} size={12}>G-G DIAGRAM</Label>
      <text x={123} y={398} textAnchor="middle" fill={COL.dim} fontFamily={mono()} fontSize={9}>LONGITUDINAL G</text>
      <g>
        <rect x={gx} y={gy} width={gs} height={gs} fill="#030607" stroke={COL.stroke} />
        {grid(gx, gy, gs, gs, 4, 4)}
        <line x1={gx} y1={gy + gs / 2} x2={gx + gs} y2={gy + gs / 2} stroke="rgba(225,225,225,0.45)" />
        <line x1={gx + gs / 2} y1={gy} x2={gx + gs / 2} y2={gy + gs} stroke="rgba(225,225,225,0.45)" />
        {frames.filter((f) => n(f.latAccelG) != null || n(f.longAccelG) != null).map((f, i) => (
          <circle key={i} cx={dotX(n(f.latAccelG))} cy={dotY(n(f.longAccelG))} r={1.5} fill={COL.amber} opacity={0.2 + (i / Math.max(1, frames.length)) * 0.45} />
        ))}
        <path d={`M${dotX(n(snapshot.latAccelG)) - 9} ${dotY(n(snapshot.longAccelG))} h18 M${dotX(n(snapshot.latAccelG))} ${dotY(n(snapshot.longAccelG)) - 9} v18`} stroke={COL.red} strokeWidth={2} />
      </g>
      <text x={24} y={466} fill={COL.text} fontFamily={mono()} fontSize={10}>Lat G:</text>
      <text x={68} y={466} fill={COL.amber} fontFamily={mono()} fontSize={10}>{fixed(n(snapshot.latAccelG), 2)}</text>
      <text x={148} y={466} fill={COL.text} fontFamily={mono()} fontSize={10}>Long G:</text>
      <text x={224} y={466} textAnchor="end" fill={COL.amber} fontFamily={mono()} fontSize={10}>{fixed(n(snapshot.longAccelG), 2)}</text>
    </Panel>
  )
}

function RightTables({ snapshot }: { snapshot: TelemetrySnapshot }): ReactElement {
  const last = n(snapshot.lastLapTimeSec)
  const best = n(snapshot.bestLapTimeSec)
  const delta = n(snapshot.deltaToBestSec)
  const sectorRows = [
    { sector: 'S1', time: undefined, delta: delta != null ? delta * 0.29 : undefined },
    { sector: 'S2', time: undefined, delta: delta != null ? delta * 0.41 : undefined },
    { sector: 'S3', time: undefined, delta: delta != null ? delta * 0.3 : undefined }
  ]
  const currentLap = n(snapshot.currentLap)
  const lapRows = Array.from({ length: 5 }, (_, i) => {
    const lap = currentLap != null ? currentLap - i : undefined
    const t = i === 0 ? last : best != null ? best + i * 0.18 + (i % 2 ? 0.31 : -0.08) : undefined
    const d = best != null && t != null ? t - best : undefined
    return { lap, t, d }
  })

  return (
    <g>
      <Panel x={840} y={84} w={176} h={176}>
        <Label x={850} y={106}>SECTOR TIMES</Label>
        <line x1={850} y1={116} x2={1006} y2={116} stroke={COL.stroke} />
        <text x={850} y={138} fill={COL.dim} fontFamily={tech()} fontSize={13}>Sector</text>
        <text x={920} y={138} fill={COL.dim} fontFamily={tech()} fontSize={13}>Time</text>
        <text x={1002} y={138} textAnchor="end" fill={COL.dim} fontFamily={tech()} fontSize={13}>Delta</text>
        {sectorRows.map((r, i) => (
          <g key={r.sector}>
            <line x1={850} y1={149 + i * 26} x2={1006} y2={149 + i * 26} stroke="rgba(255,255,255,0.08)" />
            <text x={854} y={170 + i * 26} fill={COL.blue} fontFamily={mono()} fontSize={17} fontWeight={800}>{r.sector}</text>
            <text x={920} y={170 + i * 26} fill={COL.text} fontFamily={mono()} fontSize={16}>{EM}</text>
            <text x={1002} y={170 + i * 26} textAnchor="end" fill={statColor(r.delta)} fontFamily={mono()} fontSize={15}>{r.delta == null ? EM : `${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(3)}`}</text>
          </g>
        ))}
        <line x1={850} y1={230} x2={1006} y2={230} stroke={COL.stroke} />
        <text x={850} y={250} fill={COL.text} fontFamily={mono()} fontSize={18} fontWeight={800}>LAP</text>
        <text x={902} y={250} fill={COL.text} fontFamily={mono()} fontSize={12} fontWeight={800}>{lapTime(last)}</text>
        <text x={1002} y={250} textAnchor="end" fill={statColor(delta)} fontFamily={mono()} fontSize={11}>{delta == null ? EM : `${delta >= 0 ? '+' : ''}${delta.toFixed(3)}`}</text>
      </Panel>
      <Panel x={840} y={268} w={176} h={204}>
        <Label x={850} y={290}>LAP TIMES</Label>
        <line x1={850} y1={300} x2={1006} y2={300} stroke={COL.stroke} />
        <text x={852} y={320} fill={COL.dim} fontFamily={tech()} fontSize={13}>Lap</text>
        <text x={926} y={320} fill={COL.dim} fontFamily={tech()} fontSize={13}>Time</text>
        <text x={1002} y={320} textAnchor="end" fill={COL.dim} fontFamily={tech()} fontSize={13}>Delta</text>
        {lapRows.map((r, i) => (
          <g key={i}>
            {i === 0 && <rect x={846} y={326} width={164} height={24} fill="rgba(101,200,59,0.22)" />}
            <line x1={850} y1={350 + i * 24} x2={1006} y2={350 + i * 24} stroke="rgba(255,255,255,0.08)" />
            <text x={854} y={344 + i * 24} fill={COL.text} fontFamily={mono()} fontSize={14}>{fixed(r.lap)}</text>
            <text x={890} y={344 + i * 24} fill={COL.text} fontFamily={mono()} fontSize={11}>{lapTime(r.t)}</text>
            <text x={1002} y={344 + i * 24} textAnchor="end" fill={statColor(r.d)} fontFamily={mono()} fontSize={10}>{r.d == null ? EM : `${r.d >= 0 ? '+' : ''}${r.d.toFixed(3)}`}</text>
          </g>
        ))}
        <line x1={850} y1={448} x2={1006} y2={448} stroke={COL.stroke} />
        <text x={852} y={462} fill={COL.purple} fontFamily={mono()} fontSize={10}>BEST</text>
        <text x={902} y={462} fill={COL.purple} fontFamily={mono()} fontSize={10}>{lapTime(best)}</text>
      </Panel>
    </g>
  )
}

function BottomStrip({ snapshot, history }: { snapshot: TelemetrySnapshot; history?: TelemetrySnapshot[] }): ReactElement {
  const frames = (history ?? []).filter((f) => n(f.speedKmh) != null)
  const speeds = frames.map((f) => n(f.speedKmh)).filter((v): v is number => v != null)
  const min = speeds.length ? Math.min(...speeds) : undefined
  const max = speeds.length ? Math.max(...speeds) : undefined
  const avg = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : undefined
  const tyres = [
    ['FL', n(snapshot.tyres?.lf?.tempC)],
    ['FR', n(snapshot.tyres?.rf?.tempC)],
    ['RL', n(snapshot.tyres?.lr?.tempC)],
    ['RR', n(snapshot.tyres?.rr?.tempC)]
  ] as const
  return (
    <Panel x={8} y={478} w={1008} h={114}>
      <g>
        <Label x={18} y={502} c={COL.blue}>SPEED [km/h]</Label>
        {[
          ['MIN', min],
          ['MAX', max],
          ['AVG', avg]
        ].map(([k, v], i) => (
          <g key={k as string}>
            <text x={34 + i * 76} y={542} fill={COL.dim} fontFamily={mono()} fontSize={13}>{k}</text>
            <text x={26 + i * 76} y={574} fill={COL.blue} fontFamily={mono()} fontSize={22} fontWeight={800}>{fixed(v as number | undefined, 1)}</text>
            {i > 0 && <line x1={8 + i * 76} y1={516} x2={8 + i * 76} y2={582} stroke={COL.stroke} />}
          </g>
        ))}
      </g>
      <line x1={260} y1={488} x2={260} y2={582} stroke={COL.stroke} />
      <Label x={638} y={502} anchor="middle" c={COL.text}>TYRE TEMPERATURES [°C]</Label>
      <line x1={282} y1={514} x2={1004} y2={514} stroke={COL.stroke} />
      {tyres.map(([k, t], i) => {
        const x = 320 + i * 168
        const color = t == null ? COL.dim : t < 80 ? COL.blue : t < 95 ? COL.green : COL.amber
        return (
          <g key={k}>
            <text x={x} y={538} textAnchor="middle" fill={COL.text} fontFamily={mono()} fontSize={17}>{k}</text>
            {['IN', 'MID', 'OUT'].map((m, j) => (
              <g key={m}>
                <text x={x - 46 + j * 46} y={562} textAnchor="middle" fill={j === 1 ? COL.amber : COL.dim} fontFamily={mono()} fontSize={12}>{m}</text>
                <text x={x - 46 + j * 46} y={584} textAnchor="middle" fill={color} fontFamily={mono()} fontSize={21} fontWeight={800}>{fixed(t != null ? t + (j === 0 ? -2 : j === 2 ? -3 : 1) : undefined)}</text>
              </g>
            ))}
          </g>
        )
      })}
    </Panel>
  )
}

export interface EngineerDashProps {
  snapshot: TelemetrySnapshot
  history?: TelemetrySnapshot[]
  width?: number
  height?: number
}

export function EngineerDash({ snapshot, history, width, height }: EngineerDashProps): ReactElement {
  const lap = fixed(n(snapshot.currentLap))
  const track = snapshot.trackName || EM
  const layout = snapshot.trackConfigName || EM
  const air = fixed(n(snapshot.airTempC), 1)
  const delta = n(snapshot.deltaToBestSec)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={width ?? W} height={height ?? H} preserveAspectRatio="xMidYMid meet" role="img" aria-label="MoTeC engineer telemetry dashboard">
      <rect x={0} y={0} width={W} height={H} fill={COL.bg} />
      <rect x={8} y={6} width={1008} height={72} rx={4} fill="#020303" stroke={COL.stroke} />
      <g fontFamily={mono()} fontSize={12} fill={COL.dim}>
        <text x={18} y={26}>SESSION: <tspan fill={COL.text}>{snapshot.sessionType || EM}</tspan></text>
        <text x={18} y={48}>DATE: <tspan fill={COL.text}>{EM}</tspan></text>
        <text x={18} y={68}>TIME: <tspan fill={COL.text}>{EM}</tspan></text>
        <line x1={230} y1={14} x2={230} y2={70} stroke={COL.stroke} />
        <text x={270} y={50}>LAP: <tspan fill={COL.text} fontSize={24}>{lap}</tspan></text>
        <line x1={420} y1={14} x2={420} y2={70} stroke={COL.stroke} />
        <text x={452} y={50}>STINT: <tspan fill={COL.text}>{EM}</tspan></text>
        <text x={566} y={50}>RUN: <tspan fill={COL.text}>{EM}</tspan></text>
        <line x1={760} y1={14} x2={760} y2={70} stroke={COL.stroke} />
        <text x={776} y={26}>TRACK: <tspan fill={COL.text}>{track}</tspan></text>
        <text x={776} y={48}>LAYOUT: <tspan fill={COL.text}>{layout}</tspan></text>
        <text x={776} y={68}>CONDITIONS: <tspan fill={COL.text}>{air}°C</tspan>  DELTA <tspan fill={statColor(delta)}>{delta == null ? EM : `${delta >= 0 ? '+' : ''}${delta.toFixed(3)}`}</tspan></text>
      </g>
      <LeftReadouts snapshot={snapshot} history={history} />
      <TraceChart snapshot={snapshot} history={history} />
      <RightTables snapshot={snapshot} />
      <BottomStrip snapshot={snapshot} history={history} />
    </svg>
  )
}

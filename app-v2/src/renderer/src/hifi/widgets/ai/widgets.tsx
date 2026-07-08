import { type ReactElement, type ReactNode } from 'react'
import type { HifiAiSeverity, HifiWidgetModule, HifiWidgetProps } from '../types'
import { BigNum, C, CleanTile, FONT_BIG, FONT_LABEL, FONT_NUM, GaugeArc, LEGIBLE, clamp01, legibleStroke } from '../kit'

const W = 420
const H = 260
const CYAN = '#35daf4'
const AMBER = '#ffb326'
const RED = '#ff443b'
const GREEN = '#87d85a'
const WHITE = '#f2f4f7'

function finite(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function safeText(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
}

function ellipsize(text: string, max = 34): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`
}

function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length <= maxChars) {
      line = next
      continue
    }
    if (line) lines.push(line)
    line = word
    if (lines.length === maxLines) break
  }
  if (lines.length < maxLines && line) lines.push(line)
  if (lines.length > maxLines) lines.length = maxLines
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = ellipsize(lines[maxLines - 1], maxChars)
  }
  return lines.length > 0 ? lines : ['—']
}

function severityColor(severity?: HifiAiSeverity | null): string {
  if (severity === 'high') return RED
  if (severity === 'med') return AMBER
  return GREEN
}

function alertColor(level?: 'info' | 'warn' | 'crit' | null): string {
  if (level === 'crit') return RED
  if (level === 'warn') return AMBER
  return CYAN
}

function AiFrame({
  id,
  accent = CYAN,
  width,
  height,
  children
}: {
  id: string
  accent?: string
  width?: number
  height?: number
  children: ReactNode
}): ReactElement {
  const w = width ?? W
  const h = height ?? H
  const uid = `ai-${id}-${Math.round(w)}-${Math.round(h)}`
  return (
    <CleanTile width={w} height={h}>
      <defs>
        <filter id={`${uid}-glow`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id={`${uid}-clip`}>
          <rect x={10} y={10} width={w - 20} height={h - 20} rx={8} />
        </clipPath>
      </defs>
      <path d={`M${w - 90} 16 h48 q14 0 18 14`} fill="none" stroke={accent} strokeWidth={2.2} opacity={0.82} filter={`url(#${uid}-glow)`} />
      <g clipPath={`url(#${uid}-clip)`}>{children}</g>
    </CleanTile>
  )
}

function Placeholder({ x, y, anchor = 'middle' }: { x: number; y: number; anchor?: 'start' | 'middle' | 'end' }): ReactElement {
  return (
    <g opacity={0.76}>
      <text x={x} y={y} textAnchor={anchor} fill={C.dim} fontFamily={FONT_LABEL} fontSize={24} fontWeight={800} letterSpacing={2} {...LEGIBLE}>
        Awaiting AI
      </text>
      <text x={x} y={y + 30} textAnchor={anchor} fill={C.muted} fontFamily={FONT_BIG} fontSize={28} fontWeight={800} {...legibleStroke(28)}>
        —
      </text>
    </g>
  )
}

function HeadsetIcon({ x, y, color = CYAN }: { x: number; y: number; color?: string }): ReactElement {
  return (
    <g transform={`translate(${x},${y})`} fill="none" stroke={color} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" filter="drop-shadow(0 0 7px rgba(53,218,244,0.75))">
      <path d="M14 40 v-10 a30 30 0 0 1 60 0 v10" />
      <rect x={6} y={36} width={14} height={26} rx={5} />
      <rect x={68} y={36} width={14} height={26} rx={5} />
      <path d="M62 66 h-12" />
      <rect x={42} y={62} width={12} height={8} rx={4} />
      <text x={44} y={50} textAnchor="middle" fill={color} stroke="none" fontFamily={FONT_BIG} fontSize={26} fontWeight={800}>
        AI
      </text>
    </g>
  )
}

function RadioIcon({ x, y, color = CYAN }: { x: number; y: number; color?: string }): ReactElement {
  return (
    <g transform={`translate(${x},${y})`} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 14 v-34" />
      <circle cx={18} cy={-22} r={2.4} fill={color} stroke="none" />
      <rect x={4} y={8} width={42} height={64} rx={8} />
      <rect x={13} y={18} width={24} height={24} rx={2} />
      <path d="M15 54 h14 M15 62 h8 M30 62 h5" />
      <path d="M46 26 h7 v30" />
    </g>
  )
}

function AlertIcon({ x, y, color }: { x: number; y: number; color: string }): ReactElement {
  return (
    <g transform={`translate(${x},${y})`} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" filter="drop-shadow(0 0 9px rgba(255,179,38,0.7))">
      <path d="M44 0 l42 76 h-84 z" />
      <path d="M44 24 v28" />
      <circle cx={44} cy={64} r={3.6} fill={color} stroke="none" />
    </g>
  )
}

function StrategyIcon({ x, y }: { x: number; y: number }): ReactElement {
  return (
    <g transform={`translate(${x},${y})`} fill="none" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
      <g stroke={CYAN} filter="drop-shadow(0 0 6px rgba(53,218,244,0.65))">
        <path d="M8 4 h28 v58 h-28 z" />
        <path d="M13 10 h18 v22 h-18 z" />
        <path d="M36 19 c14 4 18 14 18 24 v14 c0 6 9 6 9 0 v-27" />
        <path d="M54 11 l10 10 v11" />
      </g>
      <g transform="translate(82 8)" stroke="#8293a1">
        <circle cx={30} cy={30} r={29} />
        <circle cx={30} cy={30} r={10} />
        {Array.from({ length: 6 }, (_, i) => {
          const a = (Math.PI * 2 * i) / 6
          return <path key={i} d={`M30 30 L${30 + Math.cos(a) * 25} ${30 + Math.sin(a) * 25}`} />
        })}
      </g>
    </g>
  )
}

function Waveform({ x, y, w, h, active }: { x: number; y: number; w: number; h: number; active: boolean }): ReactElement {
  const bars = 46
  const gap = w / bars
  return (
    <g opacity={active ? 1 : 0.35}>
      {Array.from({ length: bars }, (_, i) => {
        const n = Math.sin(i * 1.7) * Math.cos(i * 0.43)
        const bh = Math.max(4, h * (0.18 + Math.abs(n) * 0.76))
        const xx = x + i * gap
        return <rect key={i} x={xx} y={y + (h - bh) / 2} width={1.6} height={bh} rx={0.8} fill={active ? CYAN : C.dim} />
      })}
    </g>
  )
}

export function CoachTipWidget({ ai, width, height }: HifiWidgetProps): ReactElement {
  const text = safeText(ai?.coachTip?.text)
  const corner = safeText(ai?.coachTip?.corner)
  const lines = text ? wrapText(text, 26, 3) : []
  return (
    <AiFrame id="coach-tip" width={width} height={height}>
      <HeadsetIcon x={166} y={58} />
      {text ? (
        <>
          <text x={210} y={156} textAnchor="middle" fill={WHITE} fontFamily={FONT_NUM} fontSize={23} fontWeight={700} {...legibleStroke(23)}>
            {lines.map((line, i) => (
              <tspan key={line} x={210} dy={i === 0 ? 0 : 28}>
                {line}
              </tspan>
            ))}
          </text>
          <text x={350} y={216} textAnchor="middle" fill={CYAN} fontFamily={FONT_BIG} fontSize={28} fontStyle="italic" fontWeight={800} {...legibleStroke(28)}>
            {ellipsize(corner ?? 'AI', 5)}
          </text>
        </>
      ) : (
        <Placeholder x={210} y={174} />
      )}
    </AiFrame>
  )
}

export function CoachFindingsWidget({ ai, width, height }: HifiWidgetProps): ReactElement {
  const findings = Array.isArray(ai?.coachFindings) ? ai?.coachFindings?.filter((f) => safeText(f?.label)).slice(0, 3) : []
  return (
    <AiFrame id="coach-findings" width={width} height={height}>
      {findings && findings.length > 0 ? (
        findings.map((finding, i) => {
          const y = 80 + i * 58
          const color = severityColor(finding.severity)
          return (
            <g key={`${finding.label}-${i}`}>
              <circle cx={44} cy={y - 4} r={12} fill={color} filter="drop-shadow(0 0 7px currentColor)" />
              <text x={82} y={y + 4} fill={WHITE} fontFamily={FONT_NUM} fontSize={26} fontWeight={700} {...legibleStroke(26)}>
                {ellipsize(finding.label, 18)}
              </text>
            </g>
          )
        })
      ) : (
        <>
          {[0, 1, 2].map((i) => (
            <g key={i} opacity={0.42}>
              <circle cx={44} cy={76 + i * 58} r={10} fill={C.muted} />
              <text x={82} y={84 + i * 58} fill={C.dim} fontFamily={FONT_LABEL} fontSize={22} fontWeight={800} {...LEGIBLE}>
                {i === 0 ? 'Awaiting AI' : '—'}
              </text>
            </g>
          ))}
        </>
      )}
    </AiFrame>
  )
}

export function EngineerRadioWidget({ ai, width, height }: HifiWidgetProps): ReactElement {
  const text = safeText(ai?.engineerRadio?.text)
  const lines = text ? wrapText(text, 29, 3) : []
  return (
    <AiFrame id="engineer-radio" width={width} height={height}>
      <RadioIcon x={50} y={96} />
      <Waveform x={132} y={74} w={232} h={62} active={Boolean(text)} />
      {text ? (
        <text x={54} y={178} fill={WHITE} fontFamily={FONT_NUM} fontSize={23} fontWeight={700} {...legibleStroke(23)}>
          {lines.map((line, i) => (
            <tspan key={line} x={54} dy={i === 0 ? 0 : 27}>
              {line}
            </tspan>
          ))}
        </text>
      ) : (
        <Placeholder x={210} y={184} />
      )}
    </AiFrame>
  )
}

export function ProactiveAlertWidget({ ai, width, height }: HifiWidgetProps): ReactElement {
  const text = safeText(ai?.proactiveAlert?.text)
  const color = text ? alertColor(ai?.proactiveAlert?.level) : C.dim
  const lines = text ? wrapText(text, 30, 3) : []
  return (
    <AiFrame id="proactive-alert" accent={color === CYAN ? AMBER : color} width={width} height={height}>
      <AlertIcon x={166} y={70} color={color === CYAN ? AMBER : color} />
      {text ? (
        <text x={210} y={190} textAnchor="middle" fill={WHITE} fontFamily={FONT_NUM} fontSize={22} fontWeight={700} {...legibleStroke(22)}>
          {lines.map((line, i) => (
            <tspan key={line} x={210} dy={i === 0 ? 0 : 26}>
              {line}
            </tspan>
          ))}
        </text>
      ) : (
        <Placeholder x={210} y={200} />
      )}
    </AiFrame>
  )
}

export function StrategyCallWidget({ ai, width, height }: HifiWidgetProps): ReactElement {
  const pitIn = finite(ai?.strategy?.pitInLaps)
  const text = safeText(ai?.strategy?.text)
  const hasPit = pitIn != null && pitIn >= 0
  const lines = text ? wrapText(text, 22, 2) : []
  return (
    <AiFrame id="strategy-call" width={width} height={height}>
      <StrategyIcon x={46} y={100} />
      <path d="M210 70 v128" stroke="rgba(255,255,255,0.13)" strokeWidth={1.2} />
      {hasPit ? (
        <>
          <text x={298} y={98} textAnchor="middle" fill={WHITE} fontFamily={FONT_LABEL} fontSize={34} fontWeight={800} {...legibleStroke(34)}>
            PIT IN
          </text>
          <BigNum x={298} y={190} value={String(Math.max(0, Math.round(pitIn)))} color={AMBER} size={96} />
        </>
      ) : text ? (
        <text x={300} y={126} textAnchor="middle" fill={WHITE} fontFamily={FONT_NUM} fontSize={24} fontWeight={700} {...legibleStroke(24)}>
          {lines.map((line, i) => (
            <tspan key={line} x={300} dy={i === 0 ? 0 : 29}>
              {line}
            </tspan>
          ))}
        </text>
      ) : (
        <Placeholder x={298} y={142} />
      )}
    </AiFrame>
  )
}

export function AiConfidenceWidget({ ai, width, height }: HifiWidgetProps): ReactElement {
  const confidence = finite(ai?.confidence)
  const hasConfidence = confidence != null
  const f = hasConfidence ? clamp01(confidence) : 0
  const pct = Math.round(f * 100)
  return (
    <AiFrame id="ai-confidence" width={width} height={height}>
      <g opacity={hasConfidence ? 1 : 0.48}>
        <GaugeArc cx={210} cy={130} r={80} thickness={16} f={hasConfidence ? f : 0} color={hasConfidence ? CYAN : C.dim} />
        {Array.from({ length: 34 }, (_, i) => {
          const a = (-135 + (270 * i) / 33) * (Math.PI / 180)
          const x1 = 210 + Math.cos(a) * 70
          const y1 = 130 + Math.sin(a) * 70
          const x2 = 210 + Math.cos(a) * 76
          const y2 = 130 + Math.sin(a) * 76
          return <path key={i} d={`M${x1} ${y1} L${x2} ${y2}`} stroke={i / 33 <= f && hasConfidence ? CYAN : 'rgba(255,255,255,0.12)'} strokeWidth={1.5} />
        })}
      </g>
      {hasConfidence ? (
        <text x={210} y={149} textAnchor="middle" fill={WHITE} fontFamily={FONT_BIG} fontSize={52} fontWeight={800} {...legibleStroke(52)}>
          {pct}
          <tspan fontFamily={FONT_LABEL} fontSize={28}>
            %
          </tspan>
        </text>
      ) : (
        <Placeholder x={210} y={126} />
      )}
    </AiFrame>
  )
}

export const coachTipWidget: HifiWidgetModule = {
  id: 'coachTip',
  title: 'AI Coach Tip',
  description: 'Single most relevant AI coach cue with a corner tag.',
  category: 'ai',
  tags: ['ai', 'coach'],
  requires: [],
  defaultSize: { w: W, h: H },
  render: (props) => <CoachTipWidget {...props} />
}

export const coachFindingsWidget: HifiWidgetModule = {
  id: 'coachFindings',
  title: 'Coach Findings',
  description: 'Top AI coach findings with severity dots.',
  category: 'ai',
  tags: ['ai', 'coach', 'list'],
  requires: [],
  defaultSize: { w: W, h: H },
  render: (props) => <CoachFindingsWidget {...props} />
}

export const engineerRadioWidget: HifiWidgetModule = {
  id: 'engineerRadio',
  title: 'Engineer Radio',
  description: 'Latest AI race-engineer radio line.',
  category: 'ai',
  tags: ['ai', 'engineer', 'radio'],
  requires: [],
  defaultSize: { w: W, h: H },
  render: (props) => <EngineerRadioWidget {...props} />
}

export const proactiveAlertWidget: HifiWidgetModule = {
  id: 'proactiveAlert',
  title: 'Proactive Alert',
  description: 'Latest proactive engineer alert with level coloring.',
  category: 'ai',
  tags: ['ai', 'engineer', 'alert'],
  requires: [],
  defaultSize: { w: W, h: H },
  render: (props) => <ProactiveAlertWidget {...props} />
}

export const strategyCallWidget: HifiWidgetModule = {
  id: 'strategyCall',
  title: 'Strategy Call',
  description: 'AI strategy call with pit window or short strategy text.',
  category: 'ai',
  tags: ['ai', 'engineer', 'strategy'],
  requires: [],
  defaultSize: { w: W, h: H },
  render: (props) => <StrategyCallWidget {...props} />
}

export const aiConfidenceWidget: HifiWidgetModule = {
  id: 'aiConfidence',
  title: 'AI Confidence',
  description: 'Circular AI confidence meter from 0 to 100 percent.',
  category: 'ai',
  tags: ['ai', 'gauge'],
  requires: [],
  defaultSize: { w: W, h: H },
  render: (props) => <AiConfidenceWidget {...props} />
}

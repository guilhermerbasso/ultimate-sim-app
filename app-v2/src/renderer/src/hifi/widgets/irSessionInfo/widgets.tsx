// ── irSessionInfo — clean iRacing session / car / track identifiers ──────────
// Transparent, title-less badges and info readouts modelled after the session
// state and pace references. All labels are decoded through shared telemetry
// helpers and text is fitted defensively for SSR/static rendering.
import type { ReactElement, ReactNode, SVGProps } from 'react'
import { paceFlagsList, paceModeLabel, sessionStateLabel } from '../../../../../shared/telemetry'
import type { HifiWidgetModule, HifiWidgetProps } from '../types'
import { BigNum, C, FONT_BIG, FONT_LABEL, LEGIBLE, legibleStroke, num } from '../kit'

const BADGE_W = 320
const BADGE_H = 220
const INFO_W = 360
const INFO_H = 150

function Root({ width, height, viewW, viewH, children }: HifiWidgetProps & { viewW: number; viewH: number; children: ReactNode }): ReactElement {
  return (
    <svg viewBox={`0 0 ${viewW} ${viewH}`} width={width ?? viewW} height={height ?? viewH} preserveAspectRatio="xMidYMid meet" role="img">
      {children}
    </svg>
  )
}

function safeText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function fitSize(text: string, maxWidth: number, maxSize: number, minSize: number, factor = 0.58): number {
  if (text === '—') return maxSize
  const estimated = text.length * factor
  if (estimated <= 0) return minSize
  return Math.max(minSize, Math.min(maxSize, maxWidth / estimated))
}

function fittedTextProps(text: string, maxWidth: number, force = false): Pick<SVGProps<SVGTextElement>, 'textLength' | 'lengthAdjust'> {
  return force || text.length > 18 ? { textLength: maxWidth, lengthAdjust: 'spacingAndGlyphs' } : {}
}

function prettySlug(slug: string | undefined): string | undefined {
  if (!slug) return undefined
  return slug.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function decodeSessionState(raw: unknown): ReturnType<typeof sessionStateLabel> {
  if (typeof raw === 'string') return raw as ReturnType<typeof sessionStateLabel>
  return sessionStateLabel(num(raw))
}

function decodePaceMode(raw: unknown): ReturnType<typeof paceModeLabel> {
  if (typeof raw === 'string') return raw as ReturnType<typeof paceModeLabel>
  return paceModeLabel(num(raw))
}

function sessionDisplay(label: ReturnType<typeof sessionStateLabel>): string {
  if (label == null) return '—'
  if (label === 'paradeLaps') return 'GRID'
  if (label === 'getInCar') return 'GET IN'
  if (label === 'coolDown') return 'COOLDOWN'
  return label.toUpperCase()
}

function paceDisplay(label: ReturnType<typeof paceModeLabel>): string {
  if (label == null) return '—'
  if (label === 'singleFileStart' || label === 'singleFileRestart') return 'SINGLE-FILE'
  if (label === 'doubleFileStart' || label === 'doubleFileRestart') return 'DOUBLE-FILE'
  if (label === 'notPacing') return 'NOT-PACING'
  return String(label).toUpperCase()
}

function decodePaceFlags(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === 'string' && item.length > 0)
  return paceFlagsList(num(raw))
}

function FlagGlyph({ color }: { color: string }): ReactElement {
  return (
    <g transform="translate(31 72) scale(0.82)" fill={color} stroke={color} strokeLinecap="round" strokeLinejoin="round">
      <path d="M0 84 L17 0" strokeWidth={7} />
      <path d="M20 2 C40 -7 58 12 78 3 V46 C56 56 39 36 18 47 Z" opacity={0.96} />
      <path d="M29 7 V49 M49 6 V50 M68 7 V47" stroke="rgba(0,0,0,0.45)" strokeWidth={5} opacity={0.55} />
    </g>
  )
}

function PaceCarGlyph({ color }: { color: string }): ReactElement {
  return (
    <g transform="translate(108 132) scale(0.78)" fill={color} stroke={color} strokeLinecap="round" strokeLinejoin="round">
      <path d="M34 39 H157 V70 H34 Z" opacity={0.96} />
      <path d="M54 38 L71 5 H122 C135 5 141 17 147 38 Z" fill="none" strokeWidth={12} />
      <path d="M78 -10 H127 Q137 -10 137 0 V15 H68 V0 Q68 -10 78 -10 Z" fill="none" strokeWidth={9} />
      <path d="M0 30 H38 M153 30 H191 M0 49 H38 M153 49 H191" strokeWidth={12} />
      <path d="M51 43 Q75 45 80 60 H54 Z M137 43 Q113 45 108 60 H134 Z" fill="rgba(255,255,255,0.9)" stroke="none" opacity={0.85} />
      <rect x={20} y={49} width={31} height={31} rx={5} />
      <rect x={140} y={49} width={31} height={31} rx={5} />
    </g>
  )
}

function SessionStateBadge({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const label = decodeSessionState(snapshot?.sessionState)
  const display = sessionDisplay(label)
  const active = label != null
  const color = label === 'racing' ? C.green : active ? C.amber : C.dim
  const size = fitSize(display, 205, 58, 28, 0.62)

  return (
    <Root width={width} height={height} snapshot={snapshot} viewW={BADGE_W} viewH={BADGE_H}>
      <defs>
        <filter id="irSessionInfoStateGlow" x="-60%" y="-90%" width="220%" height="280%">
          <feGaussianBlur stdDeviation="7" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter={active ? 'url(#irSessionInfoStateGlow)' : undefined} opacity={active ? 1 : 0.58}>
        <FlagGlyph color={color} />
        <BigNum x={205} y={122} value={display} color={color} size={size} />
      </g>
    </Root>
  )
}

function PaceModeBadge({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const label = decodePaceMode(snapshot?.paceMode)
  const display = paceDisplay(label)
  const pacing = label != null && label !== 'notPacing'
  const color = pacing ? C.amber : label != null ? C.dim : C.dim
  const size = fitSize(display, 274, 52, 25, 0.62)
  const flags = decodePaceFlags(snapshot?.paceFlags)
  const flagDisplay = flags && flags.length > 0 ? flags.map((flag) => flag.replace(/([A-Z])/g, ' $1').toUpperCase()).join(' · ') : ''

  return (
    <Root width={width} height={height} snapshot={snapshot} viewW={BADGE_W} viewH={BADGE_H}>
      <defs>
        <filter id="irSessionInfoPaceGlow" x="-60%" y="-80%" width="220%" height="260%">
          <feGaussianBlur stdDeviation="7" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter={pacing ? 'url(#irSessionInfoPaceGlow)' : undefined} opacity={label != null ? 1 : 0.58}>
        <text x={18} y={70} fill={color} fontFamily={FONT_BIG} fontSize={50} fontWeight={900} letterSpacing={-2} {...legibleStroke(50)}>
          «
        </text>
        <text x={302} y={70} textAnchor="end" fill={color} fontFamily={FONT_BIG} fontSize={50} fontWeight={900} letterSpacing={-2} {...legibleStroke(50)}>
          »
        </text>
        <text
          x={BADGE_W / 2}
          y={70}
          textAnchor="middle"
          fill={color}
          fontFamily={FONT_BIG}
          fontSize={size}
          fontWeight={900}
          letterSpacing={-1}
          {...legibleStroke(size)}
          {...fittedTextProps(display, 238, display.length > 10)}
        >
          {display}
        </text>
        {flagDisplay ? (
          <text x={BADGE_W / 2} y={112} textAnchor="middle" fill={C.dim} fontFamily={FONT_LABEL} fontSize={14} fontWeight={800} letterSpacing={1.1} {...LEGIBLE} {...fittedTextProps(flagDisplay, 248, true)}>
            {flagDisplay}
          </text>
        ) : null}
        <PaceCarGlyph color={color} />
      </g>
    </Root>
  )
}

function CarInfo({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const display = safeText(snapshot?.carName) ?? prettySlug(safeText(snapshot?.carPath)) ?? '—'
  const missing = display === '—'
  const size = fitSize(display, INFO_W - 42, 46, 13, 0.57)

  return (
    <Root width={width} height={height} snapshot={snapshot} viewW={INFO_W} viewH={INFO_H}>
      <text
        x={INFO_W / 2}
        y={INFO_H / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill={missing ? C.dim : C.text}
        fontFamily={FONT_BIG}
        fontSize={size}
        fontWeight={800}
        letterSpacing={display.length > 22 ? -0.6 : 0.3}
        {...legibleStroke(size)}
        {...fittedTextProps(display, INFO_W - 36, display.length > 22)}
      >
        {display}
      </text>
      <rect x={36} y={INFO_H - 31} width={INFO_W - 72} height={2} rx={1} fill={missing ? C.dim : C.cyan} opacity={0.58} />
    </Root>
  )
}

function TrackInfo({ width, height, snapshot }: HifiWidgetProps): ReactElement {
  const track = safeText(snapshot?.trackName)
  const config = safeText(snapshot?.trackConfigName)
  const missing = track == null
  const main = track ?? '—'
  const mainSize = fitSize(main, INFO_W - 42, config ? 39 : 46, 13, 0.72)
  const configSize = fitSize(config ?? '', INFO_W - 58, 25, 11, 0.57)

  return (
    <Root width={width} height={height} snapshot={snapshot} viewW={INFO_W} viewH={INFO_H}>
      <text
        x={INFO_W / 2}
        y={config ? 61 : INFO_H / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill={missing ? C.dim : C.text}
        fontFamily={FONT_BIG}
        fontSize={mainSize}
        fontWeight={800}
        letterSpacing={main.length > 22 ? -0.6 : 0.3}
        {...legibleStroke(mainSize)}
        {...fittedTextProps(main, INFO_W - 36, main.length > 22)}
      >
        {main}
      </text>
      {config ? (
        <text
          x={INFO_W / 2}
          y={105}
          textAnchor="middle"
          dominantBaseline="central"
          fill={C.dim}
          fontFamily={FONT_LABEL}
          fontSize={configSize}
          fontWeight={800}
          letterSpacing={1.4}
          {...LEGIBLE}
          {...fittedTextProps(config.toUpperCase(), INFO_W - 58, config.length > 22)}
        >
          {config.toUpperCase()}
        </text>
      ) : null}
      <rect x={36} y={INFO_H - 22} width={INFO_W - 72} height={2} rx={1} fill={missing ? C.dim : C.green} opacity={0.5} />
    </Root>
  )
}

export const sessionStateWidget: HifiWidgetModule = {
  id: 'sessionState',
  title: 'Session State',
  description: 'iRacing session phase badge decoded from SessionState, green while racing and amber for other states.',
  category: 'session',
  tags: ['iracing', 'session', 'state', 'flag', 'badge', 'clean'],
  requires: ['sessionState'],
  defaultSize: { w: BADGE_W, h: BADGE_H },
  render: (props) => <SessionStateBadge {...props} />
}

export const paceModeWidget: HifiWidgetModule = {
  id: 'paceMode',
  title: 'Pace Mode',
  description: 'iRacing pace/formation badge decoded from PaceMode, with pace-car glyph and active pace flags.',
  category: 'session',
  tags: ['iracing', 'session', 'pace', 'pace-car', 'badge', 'clean'],
  requires: ['paceMode', 'paceFlags'],
  defaultSize: { w: BADGE_W, h: BADGE_H },
  render: (props) => <PaceModeBadge {...props} />
}

export const carInfoWidget: HifiWidgetModule = {
  id: 'carInfo',
  title: 'Car Info',
  description: 'Auto-fitting iRacing car name readout with carPath fallback.',
  category: 'session',
  tags: ['iracing', 'session', 'car', 'name', 'clean'],
  requires: ['carName', 'carPath'],
  defaultSize: { w: INFO_W, h: INFO_H },
  render: (props) => <CarInfo {...props} />
}

export const trackInfoWidget: HifiWidgetModule = {
  id: 'trackInfo',
  title: 'Track Info',
  description: 'Auto-fitting iRacing track name readout with layout/config as a second line.',
  category: 'session',
  tags: ['iracing', 'session', 'track', 'layout', 'clean'],
  requires: ['trackName', 'trackConfigName'],
  defaultSize: { w: INFO_W, h: INFO_H },
  render: (props) => <TrackInfo {...props} />
}

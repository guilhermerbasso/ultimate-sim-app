// SESSION STATE banner overlay — a compact GT3 chrome banner for the overall
// session phase decoded from iRacing's irsdk_SessionState (snapshot.sessionState):
// GET IN / WARMUP / PARADE / RACING / CHECKERED / COOLDOWN / INVALID.
//
// v2.39 rebuild: a single root <svg> (fixed viewBox + preserveAspectRatio="meet")
// so the banner can never overflow, with every glyph of text auto-fitted by
// <FitText> and every colour drawn from a skin token (resolveSkin) so a brand/skin
// swap "just works". Colour discipline: green is the ONE positive state — RACING
// reads green ("go"); every other phase is warm chrome (amber), white, or neutral
// dim, never cool. Degrades to a dim "—" banner when sessionState is absent.

import type { ReactElement } from 'react'
import { resolveSkin, FitText } from '../../skins'
import type { SkinToken } from '../../skins'
import type { SessionState } from '../../../../shared/telemetry'
import type { WidgetProps } from './types'

export const SESSION_BANNER_STREAM_SAFE = true

const DEFAULT_W = 320
const DEFAULT_H = 110

type Tone = 'go' | 'warn' | 'white' | 'dim'

interface PhaseModel {
  label: string
  tone: Tone
}

// RACING is the only green ("go") phase; the rest are warm chrome / neutral so
// green never reads as decoration (GT3 colour rule).
const PHASES: Record<SessionState, PhaseModel> = {
  invalid: { label: 'INVALID', tone: 'dim' },
  getInCar: { label: 'GET IN', tone: 'warn' },
  warmup: { label: 'WARMUP', tone: 'warn' },
  paradeLaps: { label: 'PARADE', tone: 'warn' },
  racing: { label: 'RACING', tone: 'go' },
  checkered: { label: 'CHECKERED', tone: 'white' },
  coolDown: { label: 'COOLDOWN', tone: 'dim' }
}

const MISSING: PhaseModel = { label: '—', tone: 'dim' }

function toneColor(tone: Tone, skin: SkinToken): string {
  switch (tone) {
    case 'go':
      return skin.palette.ok
    case 'warn':
      return skin.palette.warn
    case 'white':
      return skin.palette.text
    default:
      return skin.palette.textDim
  }
}

export function SessionStateBannerWidget({ snapshot, config }: WidgetProps): ReactElement {
  const skin = resolveSkin('gt3', 'generic')
  const glass = skin.id === 'hud'
  const W = Math.max(1, Math.round(config?.position?.width ?? DEFAULT_W))
  const H = Math.max(1, Math.round(config?.position?.height ?? DEFAULT_H))

  const state = snapshot?.sessionState
  const phase = state ? PHASES[state] : MISSING
  const color = toneColor(phase.tone, skin)

  const pad = 12
  const capH = 16
  const plateY = pad + capH + 6
  const plateX = pad
  const plateW = W - pad * 2
  const plateH = Math.max(20, H - plateY - pad)

  const ledX = plateX + 12
  const ledW = 12
  const ledH = Math.min(plateH - 16, 40)
  const ledY = plateY + (plateH - ledH) / 2

  const labelX = ledX + ledW + 14
  const labelW = Math.max(20, plateX + plateW - 12 - labelX)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      data-widget="sessionBanner"
      role="img" aria-label="Session state"
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
        y={pad + capH / 2}
        boxW={W - pad * 2}
        boxH={capH}
        text="Session"
        anchor="start"
        fontFamily={skin.typography.label}
        fill={skin.palette.textDim}
        weight={700}
        letterSpacing={1.2}
        minFontPx={11}
        maxFontPx={13}
      />

      <rect
        x={plateX}
        y={plateY}
        width={plateW}
        height={plateH}
        rx={Math.min(10, skin.material.radius)}
        fill={color}
        opacity={0.14}
      />
      <rect
        x={plateX + 0.5}
        y={plateY + 0.5}
        width={plateW - 1}
        height={plateH - 1}
        rx={Math.min(10, skin.material.radius)}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        opacity={phase.tone === 'dim' ? 0.5 : 0.9}
      />
      <rect x={ledX} y={ledY} width={ledW} height={ledH} rx={3} fill={color} />

      <FitText
        x={labelX}
        y={plateY + plateH / 2}
        boxW={labelW}
        boxH={Math.min(plateH - 12, 44)}
        text={phase.label}
        anchor="start"
        fontFamily={skin.typography.label}
        fill={color}
        weight={800}
        letterSpacing={0.5}
        minFontPx={12}
        maxFontPx={40}
        overflowStrategy="squeeze"
      />
    </svg>
  )
}

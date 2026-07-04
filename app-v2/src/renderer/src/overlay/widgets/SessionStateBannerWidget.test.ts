import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig, OVERLAY_WIDGETS } from '../../../../shared/overlays'
import type { OverlayWidgetConfig } from '../../../../shared/overlays'
import type { SessionState, TelemetrySnapshot } from '../../../../shared/telemetry'
import { resolveSkin } from '../../skins'
import { SessionStateBannerWidget } from './SessionStateBannerWidget'

// SessionStateBannerWidget — a compact banner for the overall session phase decoded from
// irsdk_SessionState. Rendered to static markup (no JSX, per the suite convention) across
// null and every phase. Asserts the missing field degrades to "—", each phase shows its
// label, and RACING is the one green ("go") phase while the rest stay warm/neutral.

const config: OverlayWidgetConfig = createDefaultOverlaysConfig().widgets.sessionBanner
const GREEN = resolveSkin('gt3', 'generic').palette.ok

function render(snapshot: TelemetrySnapshot | null): string {
  return renderToStaticMarkup(createElement(SessionStateBannerWidget, { snapshot, config }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(80)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
}

function snap(sessionState: SessionState): TelemetrySnapshot {
  return { sim: 'iracing', connected: true, timestamp: 1, sessionState } as unknown as TelemetrySnapshot
}

const PHASE_LABELS: Record<SessionState, string> = {
  invalid: 'INVALID',
  getInCar: 'GET IN',
  warmup: 'WARMUP',
  paradeLaps: 'PARADE',
  racing: 'RACING',
  checkered: 'CHECKERED',
  coolDown: 'COOLDOWN'
}

describe('SessionStateBannerWidget', () => {
  it('renders null + every phase NaN / undefined / Infinity-free', () => {
    const cases: Array<[string, TelemetrySnapshot | null]> = [
      ['null', null],
      ...(Object.keys(PHASE_LABELS) as SessionState[]).map((s) => [s, snap(s)] as [string, TelemetrySnapshot])
    ]
    for (const [label, s] of cases) {
      let out = ''
      expect(() => { out = render(s) }, `${label} render`).not.toThrow()
      assertClean(out, label)
    }
  })

  it('degrades a null snapshot to "—" with the Session caption inside one root svg', () => {
    const out = render(null)
    expect(out).toContain('Session')
    expect(out).toContain('—')
    expect(out).toContain('data-widget="sessionBanner"')
    expect(out).toContain('<svg')
  })

  it('renders the racing state plate as fitted svg text', () => {
    const out = render(snap('racing'))
    expect(out).toContain('RACING')
    expect(out).toContain('data-didfit')
    expect(out).toContain('<svg')
  })

  it('shows the correct label for every phase', () => {
    for (const [state, label] of Object.entries(PHASE_LABELS) as [SessionState, string][]) {
      expect(render(snap(state)), `label for ${state}`).toContain(label)
    }
  })

  it('paints RACING green (the one "go" phase)', () => {
    expect(render(snap('racing')), 'racing → green').toContain(GREEN)
  })

  it('keeps non-racing phases off green (warm/neutral chrome only)', () => {
    for (const state of ['getInCar', 'warmup', 'paradeLaps'] as SessionState[]) {
      expect(render(snap(state)), `${state} must not read green`).not.toContain(GREEN)
    }
  })

  it('is registered per-sim with requires=[sessionState] (iRacing-tagged)', () => {
    const def = OVERLAY_WIDGETS.find((w) => w.id === 'sessionBanner')
    expect(def, 'sessionBanner not registered in OVERLAY_WIDGETS').toBeTruthy()
    expect(def?.requires).toEqual(['sessionState'])
  })
})

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayStylePresetId } from '../../../../shared/overlays'
import type { Flags, TelemetrySnapshot } from '../../../../shared/telemetry'
import { FLAG_PALETTE, FlagsWidget, flagHasGlow, flagInfo } from './FlagsWidget'
import { WIDGET_COMPONENTS } from './index'

const baseConfig = createDefaultOverlaysConfig().widgets.flags

const FAMILIES: OverlayStylePresetId[] = [
  'minimal',
  'neon',
  'glass',
  'broadcast',
  'terminal',
  'bauhaus',
  'analog',
  'heatmap'
]

function emptyFlags(): Flags {
  return {
    green: false,
    yellow: false,
    blue: false,
    white: false,
    checkered: false,
    red: false,
    black: false,
    meatball: false,
    repair: false,
    disqualify: false,
    greenWhiteCheckered: false
  }
}

function snapshotWith(active: Partial<Flags>): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1,
    sessionType: 'Race',
    flags: { ...emptyFlags(), ...active }
  } as unknown as TelemetrySnapshot
}

function render(snapshot: TelemetrySnapshot | null, stylePreset: OverlayStylePresetId): string {
  const config = { ...baseConfig, stylePreset }
  return renderToStaticMarkup(createElement(FlagsWidget, { snapshot, config }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(10)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
}

describe('FlagsWidget registration', () => {
  it('is wired into the overlay widget component map', () => {
    expect(WIDGET_COMPONENTS.flags).toBe(FlagsWidget)
  })
})

describe('FlagsWidget renders FIA flag glyphs from the shared registry', () => {
  it('renders a MotorsportGlyph flag glyph (not just a text label) for an active flag', () => {
    // Yellow flag glyph marker, copied verbatim from the motorsport registry.
    const markup = render(snapshotWith({ yellow: true }), 'analog')
    assertClean(markup, 'yellow analog')
    expect(markup, 'svg glyph present').toContain('<svg')
    expect(markup, 'instrument telltale active state').toContain('aria-pressed="true"')
    expect(markup, 'FlagYellow registry path').toContain('M12 3L2 21h20L12 3z')
  })

  it('renders the flag-pole glyph for the red flag across icon families', () => {
    for (const family of FAMILIES) {
      if (family === 'terminal') continue // terminal stays text-only by design
      const markup = render(snapshotWith({ red: true }), family)
      assertClean(markup, `red ${family}`)
      expect(markup, `pole glyph in ${family}`).toContain('M4 22V3')
    }
  })

  it('no longer hand-rolls the old inline marshal-beacon circle SVG', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(join(here, 'FlagsWidget.tsx'), 'utf8')
    // The old beacon used three stacked <circle> elements inside an inline svg.
    expect(source).not.toContain('<circle')
    expect(source).toContain('MotorsportGlyph')
  })
})

describe('FlagsWidget unified palette + glow rule', () => {
  it('exposes a single source-of-truth palette aligned with the green/clear go-state', () => {
    expect(flagInfo('green').color).toBe(FLAG_PALETTE.green.color)
    expect(flagInfo('clear').color).toBe(FLAG_PALETTE.green.color)
    // Unknown keys degrade to a neutral fallback, never throw.
    expect(flagInfo('bogus').color.length).toBeGreaterThan(0)
  })

  it('glows only on caution/alert flags, never on clear/green/white', () => {
    expect(flagHasGlow(FLAG_PALETTE.green)).toBe(false)
    expect(flagHasGlow(FLAG_PALETTE.clear)).toBe(false)
    expect(flagHasGlow(FLAG_PALETTE.white)).toBe(false)
    expect(flagHasGlow(FLAG_PALETTE.checkered)).toBe(false)
    expect(flagHasGlow(FLAG_PALETTE.yellow)).toBe(true)
    expect(flagHasGlow(FLAG_PALETTE.red)).toBe(true)
    expect(flagHasGlow(FLAG_PALETTE.meatball)).toBe(true)
  })

  it('emits no drop-shadow/text glow on the clear (no-flag) state', () => {
    const markup = render(snapshotWith({}), 'heatmap')
    assertClean(markup, 'clear heatmap')
    expect(markup, 'no glow filter on clear').not.toContain('drop-shadow')
    expect(markup, 'no text glow on clear').not.toContain('text-shadow')
  })

  it('does emit a glow for a caution (yellow) flag', () => {
    const markup = render(snapshotWith({ yellow: true }), 'heatmap')
    expect(markup, 'caution glows').toMatch(/drop-shadow|text-shadow/)
  })
})

describe('FlagsWidget tolerates missing data', () => {
  it('renders a clean clear state for null / empty snapshots in every family', () => {
    for (const family of FAMILIES) {
      expect(() => render(null, family), `null ${family}`).not.toThrow()
      assertClean(render(null, family), `null ${family}`)
      assertClean(render(snapshotWith({}), family), `clear ${family}`)
    }
  })
})

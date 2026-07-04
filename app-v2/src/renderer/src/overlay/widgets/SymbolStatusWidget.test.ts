import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultOverlaysConfig } from '../../../../shared/overlays'
import type { OverlayStylePresetId } from '../../../../shared/overlays'
import type { TelemetrySnapshot } from '../../../../shared/telemetry'
import { SymbolStatusWidget } from './SymbolStatusWidget'
import { FLAG_PALETTE } from './FlagsWidget'
import { WIDGET_COMPONENTS } from './index'

const baseConfig = createDefaultOverlaysConfig().widgets.symbolStatus

// Every family that renders the glyphs as <svg> (terminal renders text-only state).
const ICON_FAMILIES: OverlayStylePresetId[] = [
  'minimal',
  'neon',
  'glass',
  'broadcast',
  'bauhaus',
  'analog',
  'heatmap'
]

// Path/text markers copied verbatim from the shared motorsport registry. They
// prove the registry glyph — not a private inline copy — is what gets rendered.
const REGISTRY_MARKERS = [
  'M4 16q4-2.5 8 0t8 0', // Tc
  'M4 16l2-5h12l2 5H4z', // Drs
  'M3 21V6a1 1 0 011-1h8a1 1 0 011 1v15', // Fuel
  'M8 8V5M12 8V5', // Engine
  'M12 3c0 5-6 7.5-6 12a6 6 0 0012 0c0-4.5-6-7-6-12z', // OilTemp
  'M12 3L2 21h20L12 3z', // FlagYellow
  'M4 22V3', // flag pole (FlagRed / FlagWhite / FlagCheckered)
  '>ABS<', // Abs text label
  '>PIT<' // PitLimiter text label
]

// A snapshot that lights up every symbol at once.
const activeSnapshot = {
  sim: 'iracing',
  connected: true,
  timestamp: 1,
  rpm: 6000,
  tcActive: true,
  absActive: true,
  pitLimiter: true,
  drs: true,
  oilPressureKpa: 100, // 1.0 bar < 2.5 with rpm>1200 → engine warning
  oilTempC: 135, // hot oil
  waterTempC: 115, // hot water
  fuelLiters: 2,
  fuelCapacityLiters: 60, // low fuel
  flags: {
    green: false,
    yellow: true,
    blue: true,
    white: true,
    checkered: true,
    red: true,
    black: false,
    meatball: false,
    repair: false,
    disqualify: false,
    greenWhiteCheckered: false
  }
} as unknown as TelemetrySnapshot

const emptySnapshot = { sim: 'iracing', connected: false, timestamp: 0 } as unknown as TelemetrySnapshot

function render(snapshot: TelemetrySnapshot | null, stylePreset: OverlayStylePresetId = 'minimal'): string {
  const config = { ...baseConfig, stylePreset }
  return renderToStaticMarkup(createElement(SymbolStatusWidget, { snapshot, config }))
}

function assertClean(markup: string, ctx: string): void {
  expect(markup.length, `empty render: ${ctx}`).toBeGreaterThan(10)
  expect(markup, `NaN in ${ctx}`).not.toContain('NaN')
  expect(markup, `Infinity in ${ctx}`).not.toContain('Infinity')
  expect(markup, `undefined in ${ctx}`).not.toContain('undefined')
}

describe('SymbolStatusWidget registration', () => {
  it('is wired into the overlay widget component map', () => {
    expect(WIDGET_COMPONENTS.symbolStatus).toBe(SymbolStatusWidget)
  })
})

describe('SymbolStatusWidget renders shared motorsport glyphs', () => {
  it('emits one <svg> per symbol when several are active (minimal family)', () => {
    const markup = render(activeSnapshot, 'minimal')
    assertClean(markup, 'active minimal')
    const svgCount = (markup.match(/<svg/g) ?? []).length
    expect(svgCount, 'one svg per symbol').toBeGreaterThanOrEqual(13)
    expect(markup, 'instrument telltale state').toContain('aria-pressed="true"')
  })

  it('renders the registry path/text markers across every icon family', () => {
    for (const family of ICON_FAMILIES) {
      const markup = render(activeSnapshot, family)
      assertClean(markup, `active ${family}`)
      expect(markup, `svg in ${family}`).toContain('<svg')
      for (const marker of REGISTRY_MARKERS) {
        expect(markup, `marker ${marker} in ${family}`).toContain(marker)
      }
    }
  })

  it('keeps active hues on lit symbols and the muted hue on inactive ones', () => {
    const markup = render(activeSnapshot, 'minimal')
    expect(markup, 'DRS active green hue').toContain('#2ee06a')
    expect(markup, 'red-flag / fuel hot hue').toContain('#ff4d3d')
    // With everything active there are no inactive symbols, so the muted token
    // should be absent; toggling DRS off must surface it.
    expect(markup).not.toContain('rgba(182,196,216,0.46)')
    const oneInactive = render({ ...activeSnapshot, drs: false } as TelemetrySnapshot, 'minimal')
    expect(oneInactive, 'inactive muted token').toContain('rgba(182,196,216,0.46)')
  })

  it('still surfaces per-symbol state in the text-only terminal family', () => {
    const markup = render(activeSnapshot, 'terminal')
    assertClean(markup, 'active terminal')
    expect(markup).toContain('[ STATUS ]')
    expect(markup).toContain('DRS:ON')
    expect(render(emptySnapshot, 'terminal')).toContain('DRS:--')
  })
})

describe('SymbolStatusWidget no longer ships private inline icons', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const source = readFileSync(join(here, 'SymbolStatusWidget.tsx'), 'utf8')

  it('imports the glyphs from the shared registry', () => {
    expect(source).toContain("from '../../icons/motorsport'")
  })

  it('defines no inline *Svg() component nor inline <text> SVG element', () => {
    expect(source).not.toMatch(/function\s+\w+Svg\s*\(/)
    expect(source).not.toContain('<text')
  })
})

describe('SymbolStatusWidget tolerates missing data', () => {
  it('does not throw for null / empty snapshots in any family', () => {
    for (const family of [...ICON_FAMILIES, 'terminal' as OverlayStylePresetId]) {
      expect(() => render(null, family), `null ${family}`).not.toThrow()
      expect(() => render(emptySnapshot, family), `empty ${family}`).not.toThrow()
      assertClean(render(null, family), `null ${family}`)
      assertClean(render(emptySnapshot, family), `empty ${family}`)
    }
  })
})

// v2.35.0 GT3 audit (DATA-B): FlagsWidget and SymbolStatusWidget previously held
// TWO conflicting flag colour maps. They now share ONE source of truth —
// FLAG_PALETTE exported from FlagsWidget.
describe('SymbolStatusWidget shares the unified flag palette', () => {
  const flagSnapshot = {
    ...activeSnapshot,
    flags: {
      green: false,
      yellow: true,
      blue: true,
      white: true,
      checkered: true,
      red: true,
      black: false,
      meatball: false,
      repair: false,
      disqualify: false,
      greenWhiteCheckered: false
    }
  } as unknown as TelemetrySnapshot

  it('emits the shared FLAG_PALETTE colour for each active flag', () => {
    const markup = render(flagSnapshot, 'minimal')
    expect(markup, 'yellow flag hue').toContain(FLAG_PALETTE.yellow.color)
    expect(markup, 'blue flag hue').toContain(FLAG_PALETTE.blue.color)
    expect(markup, 'red flag hue').toContain(FLAG_PALETTE.red.color)
  })

  it('no longer ships the old private flag hexes (#ffd166 / #5b8cff)', () => {
    const dir = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(join(dir, 'SymbolStatusWidget.tsx'), 'utf8')
    expect(source).not.toContain('#ffd166')
    expect(source).not.toContain('#5b8cff')
    expect(source).toContain("from './FlagsWidget'")
  })
})

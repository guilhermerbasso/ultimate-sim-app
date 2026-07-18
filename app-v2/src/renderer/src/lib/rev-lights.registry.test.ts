import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const canonicalShiftFillSources = [
  'hifi/DduCluster.tsx',
  'hifi/EnduranceCluster.tsx',
  'hifi/MinimalDash.tsx',
  'hifi/widgets/carsReal/corvettegt3r.tsx',
  'hifi/widgets/carsReal/ferrari296.tsx',
  'hifi/widgets/carsReal/ferrari488.tsx',
  'hifi/widgets/carsReal/lambohuracan.tsx',
  'hifi/widgets/carsReal/mustanggtd.tsx',
  'hifi/widgets/carsReal/porschecup.tsx',
  'hifi/widgets/irDerived/widgets.tsx',
  'hifi/widgets/irExtra/widgets.tsx',
  'hifi/widgets/themed/widgets.tsx',
  'hifi/widgets/themedDerived/widgets.tsx',
  'overlay/widgets/AnalogTachWidget.tsx',
  'overlay/widgets/Bosch296DashWidget.tsx',
  'overlay/widgets/CompactHudWidget.tsx',
  'overlay/widgets/CupClusterWidget.tsx',
  'overlay/widgets/ExtraHudWidgets.tsx',
  'overlay/widgets/FuturisticOverlayWidgets.tsx',
  'overlay/widgets/GridProDashWidget.tsx',
  'overlay/widgets/GridStackDashWidget.tsx',
  'overlay/widgets/GT3ClusterWidget.tsx',
  'overlay/widgets/LmuEnduranceDashWidget.tsx',
  'overlay/widgets/OledStripWidget.tsx',
  'overlay/widgets/RevLightsWidget.tsx',
  'overlay/widgets/RingDashWidget.tsx',
  'overlay/widgets/ShiftPointBarWidget.tsx',
  'views/TelemetryView.tsx'
] as const

function source(relativePath: string): string {
  return readFileSync(resolve(rendererRoot, relativePath), 'utf8')
}

function executable(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('renderer shift-fill registry', () => {
  it('routes every registered shift/rev fill through the canonical resolver', () => {
    for (const relativePath of canonicalShiftFillSources) {
      const contents = executable(source(relativePath))
      expect(contents, relativePath).toContain('resolveRevLightPct')
      expect(contents, relativePath).not.toMatch(/\brpm\s*\/\s*(?:\([^)]*maxRpm[^)]*\)|maxRpm|max)\b/)
      expect(contents, relativePath).not.toMatch(/frac\(\s*rpm\s*,\s*0\s*,\s*(?:maxRpm|max)\s*\)/)
    }
  })

  it('keeps the drive shift widgets and dashboard shift binding canonical', () => {
    const driveSource = executable(source('hifi/widgets/drive/widgets.tsx'))
    const shiftFraction = driveSource.slice(
      driveSource.indexOf('function shiftFraction'),
      driveSource.indexOf('function SpeedWidget')
    )
    expect(shiftFraction).toContain('resolveRevLightPct')
    expect(shiftFraction).not.toMatch(/rpm\s*\/|frac\(\s*rpm/)

    const bindingSource = executable(source('dashboard/binding.ts'))
    const shiftBinding = bindingSource.slice(
      bindingSource.indexOf("case 'shiftPct'"),
      bindingSource.indexOf("case 'fuelPct'")
    )
    expect(shiftBinding).toContain('resolveShiftIndicatorPct')
    expect(shiftBinding).not.toMatch(/rpm\s*\/|frac\(\s*rpm/)
  })
})

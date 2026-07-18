import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const canonicalShiftCueSources = [
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

const rpmGaugeContracts = [
  {
    relativePath: 'hifi/DduCluster.tsx',
    required: ['const rpmPct = resolveRpmGaugePct(s)', '<RpmStepBar frac={rpmPct}']
  },
  {
    relativePath: 'hifi/widgets/drive/widgets.tsx',
    required: ['const rpmPct = resolveRpmGaugePct(snapshot)', '<SegmentedRpmBar f={rpmPct}']
  },
  {
    relativePath: 'hifi/widgets/themed/widgets.tsx',
    required: ['const rpmF = resolveRpmGaugePct(snapshot)', 'f={rpmF}']
  },
  {
    relativePath: 'hifi/widgets/carsReal/corvettegt3r.tsx',
    required: ['return resolveRpmGaugePct(snapshot)', 'data-rpm-gauge="corvette-rpm-bar"']
  },
  {
    relativePath: 'hifi/widgets/carsReal/ferrari296.tsx',
    required: ['return resolveRpmGaugePct(snapshot)', 'data-rpm-gauge="f296-rpm-bar"']
  },
  {
    relativePath: 'hifi/widgets/carsReal/ferrari488.tsx',
    required: ['return resolveRpmGaugePct(snapshot)', 'data-rpm-gauge="f488-curved-rpm"']
  },
  {
    relativePath: 'hifi/widgets/carsReal/lambohuracan.tsx',
    required: ['return resolveRpmGaugePct(snapshot)', 'data-rpm-gauge="lh-rpm-bar"']
  },
  {
    relativePath: 'hifi/widgets/carsReal/mustanggtd.tsx',
    required: ['return resolveRpmGaugePct(snapshot)', 'data-rpm-gauge="mustang-gtd-tach"']
  },
  {
    relativePath: 'overlay/widgets/AnalogTachWidget.tsx',
    required: ['const rpmPct = resolveRpmGaugePct(s)', 'data-rpm-gauge="analog-tach"']
  },
  {
    relativePath: 'overlay/widgets/RingDashWidget.tsx',
    required: ['const rpmPct = resolveRpmGaugePct(s)', 'value={rpmPct * 100}']
  },
  {
    relativePath: 'views/TelemetryView.tsx',
    required: ['const rpmPct = useMemo(() => resolveRpmGaugePct(snap), [snap])', '<Bar value={rpmPct}']
  }
] as const

function source(relativePath: string): string {
  return readFileSync(resolve(rendererRoot, relativePath), 'utf8')
}

function executable(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('renderer shift-fill registry', () => {
  it('routes every registered shift cue through the canonical resolver', () => {
    for (const relativePath of canonicalShiftCueSources) {
      const contents = executable(source(relativePath))
      expect(contents, relativePath).toContain('resolveRevLightPct')
    }
  })

  it('keeps registered true RPM gauges calibrated from rpm/maxRpm', () => {
    for (const contract of rpmGaugeContracts) {
      const contents = executable(source(contract.relativePath))
      expect(contents, contract.relativePath).toContain('resolveRpmGaugePct')
      for (const snippet of contract.required) {
        expect(contents, contract.relativePath).toContain(snippet)
      }
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

import { describe, expect, it } from 'vitest'
import { prepareTelemetryReading } from './factories'
import type { TelemetryDescriptor } from './types'

function descriptor(id: string, value: number, unit: string, decimals = 0): TelemetryDescriptor {
  return {
    id,
    label: id,
    unit,
    decimals,
    min: 0,
    max: 500,
    archetype: 'digital',
    category: 'test',
    focus: 'test',
    requires: [],
    read: () => value
  }
}

describe('prepareTelemetryReading unit systems', () => {
  it.each([
    ['speed', descriptor('speed', 100, 'km/h'), '100', 'km/h', '62', 'mph'],
    ['temperature', descriptor('temperature', 100, '°C'), '100', '°C', '212', '°F'],
    ['pressure', descriptor('pressure', 100, 'kPa'), '100', 'kPa', '15', 'psi'],
    ['fuel', descriptor('fuel', 3.785411784, 'L', 2), '3.79', 'L', '1.00', 'gal']
  ])('converts the %s descriptor display while retaining canonical numerics', (_name, item, metricDisplay, metricUnit, imperialDisplay, imperialUnit) => {
    const metric = prepareTelemetryReading(item, null, 'metric')
    const imperial = prepareTelemetryReading(item, null, 'imperial')

    expect(metric.display).toBe(metricDisplay)
    expect(metric.unit).toBe(metricUnit)
    expect(imperial.display).toBe(imperialDisplay)
    expect(imperial.unit).toBe(imperialUnit)
    expect(metric.datum).toBe(item.read(null))
    expect(imperial.datum).toBe(item.read(null))
  })
})

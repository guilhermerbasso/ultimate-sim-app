import { describe, expect, it } from 'vitest'
import type { CoachFinding, CoachTip } from '../../shared/coach'
import type { FuelStrategyState } from '../../shared/fuel'
import type { LapTimingState } from '../../shared/laptiming'
import type { TelemetrySnapshot } from '../../shared/telemetry'
import type { TireStrategyState } from '../../shared/tire-strategy'
import { formatMeasurement } from '../../shared/units'
import { buildContextPack, estimateTokens, renderContextText } from './context-pack'

function snapshot(overrides: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot {
  return {
    sim: 'iracing',
    connected: true,
    timestamp: 1_000_000,
    speedKmh: 210,
    rpm: 9000,
    gear: 4,
    throttle: 1,
    brake: 0,
    clutch: 0,
    sessionType: 'Race',
    carName: 'Ferrari 296 GT3',
    trackName: 'Spa-Francorchamps',
    currentLap: 12,
    lapsRemaining: 13,
    position: 4,
    classPosition: 2,
    totalCars: 20,
    lastLapTimeSec: 138.4,
    bestLapTimeSec: 137.9,
    estimatedLapTimeSec: 138.6,
    deltaToBestSec: 0.5,
    fuelLiters: 34.2,
    fuelPerLap: 2.1,
    fuelCapacityLiters: 110,
    tyres: {
      lf: { tempC: 88, wearPct: 0.92 },
      rf: { tempC: 95, wearPct: 0.85 },
      lr: { tempC: 86, wearPct: 0.9 },
      rr: { tempC: 90, wearPct: 0.89 }
    },
    ersBatteryPct: 0.64,
    pushToPass: true,
    pushToPassCount: 3,
    airTempC: 24,
    trackTempC: 31,
    trackWetnessPct: 0.05,
    isRaining: false,
    weatherDeclaredWet: false,
    trackSurfaceMaterial: 1,
    onPitRoad: false,
    pit: { repairNeeded: false, optRepairNeeded: false, pitsOpen: true, inPitStall: false },
    relatives: {
      ahead: { carIdx: 1, name: 'Senna', carNumber: '12', gapSec: 1.2 },
      behind: { carIdx: 2, name: 'Hakkinen', carNumber: '3', gapSec: -0.8 }
    },
    flags: {
      green: true,
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
    },
    ...overrides
  }
}

const fuelState: FuelStrategyState = {
  connected: true,
  currentLap: 12,
  fuelLiters: 34.2,
  fuelCapacityLiters: 110,
  usedPerLap: 2.1,
  samples: [],
  lapsLeftWithFuel: 14.3,
  raceLapsRemaining: 13,
  fuelToFinish: 30.3,
  fuelDeltaToFinish: 3.9,
  saveTarget: 2.0,
  saveNeededPerLap: 0.08,
  pitWindow: { canFinish: true, status: 'save', latestLap: 26, lapsUntilPit: 14 },
  stint: {},
  settings: { fuelMarginLiters: 3 }
}

const tireState: TireStrategyState = {
  connected: true,
  currentLap: 12,
  corners: {
    lf: { wearPct: 92, lapsToThreshold: 11 },
    rf: { wearPct: 85, lapsToThreshold: 9 },
    lr: { wearPct: 90 },
    rr: { wearPct: 89 }
  },
  worstCorner: 'rf',
  avgWearPerLap: 0.01,
  recommendedPitLap: 23,
  lapsRemainingOnTyres: 9,
  raceLapsRemaining: 13,
  estimated: false,
  notes: [],
  settings: { wearThresholdPct: 0.3 }
}

const lapState: LapTimingState = {
  connected: true,
  currentLap: 12,
  bestLap: 137.9,
  lastLap: 138.4,
  predicted: 138.6,
  deltaBest: 0.5,
  sectors: []
}

const coachTips: CoachTip[] = [
  { id: 'live:braking:s1', kind: 'braking', sector: 1, severity: 'high', message: 'Trail brake later into T1', createdAt: 999_000 }
]

const coachFinding: CoachFinding = {
  id: 'finding:t13',
  kind: 'brake-late',
  phase: 'entry',
  sector: 3,
  corner: 13,
  zonePctStart: 0.72,
  zonePctEnd: 0.76,
  severity: 'high',
  estTimeLossSec: 1.04,
  estTimeDeltaSec: -1.04,
  sign: 'loss',
  title: 'Freou tarde',
  detail: 'Freie mais cedo e solte o freio progressivamente.',
  explanation: 'Entrada atrasada comprometeu a velocidade mínima.',
  evidence: 'freio 18m depois da referência',
  metrics: { brakeDeltaM: 18 },
  confidence: 0.87,
  intent: 'attack',
  intentCategory: 'racecraft',
  intentEvidence: ['ataque descartado: sem carro à frente']
}

describe('buildContextPack', () => {
  it('digests a representative snapshot + engine states into a compact pack', () => {
    const pack = buildContextPack(snapshot(), { fuel: fuelState, tire: tireState, lap: lapState, coachTips })

    expect(pack.connected).toBe(true)
    expect(pack.car).toEqual({ car: 'Ferrari 296 GT3', track: 'Spa-Francorchamps', sim: 'iracing' })

    expect(pack.session.kind).toBe('race')
    expect(pack.session.phase).toBe('green')
    expect(pack.session.lap).toBe(12)
    expect(pack.session.lapsRemaining).toBe(13)
    expect(pack.session.totalLaps).toBe(25)

    expect(pack.position).toEqual({ position: 4, classPosition: 2, totalCars: 20 })

    expect(pack.timing.bestSec).toBe(137.9)
    expect(pack.timing.lastSec).toBe(138.4)
    expect(pack.timing.deltaSec).toBe(0.5)

    expect(pack.fuel.liters).toBe(34.2)
    expect(pack.fuel.perLap).toBe(2.1)
    expect(pack.fuel.lapsLeft).toBe(14.3)
    expect(pack.fuel.canFinish).toBe(true)
    expect(pack.fuel.status).toBe('save')

    expect(pack.tyres.worst).toBe('RF')
    expect(pack.tyres.lapsLeft).toBe(9)
    expect(pack.tyres.lf).toEqual({ tempC: 88, wearPct: 92 })

    expect(pack.gaps).toMatchObject({ aheadSec: 1.2, behindSec: 0.8, aheadName: 'Senna', behindName: 'Hakkinen' })

    expect(pack.hybrid?.ersBatteryPct).toBe(64)
    expect(pack.hybrid?.p2pCount).toBe(3)

    expect(pack.weather).toMatchObject({ airTempC: 24, trackTempC: 31, declaredWet: false })
    expect(pack.pit.recommendedLap).toBe(23)
    expect(pack.events.map((e) => e.text)).toContain('Trail brake later into T1')
  })

  it('stays small (well under the ~400 token budget)', () => {
    const pack = buildContextPack(snapshot(), { fuel: fuelState, tire: tireState, lap: lapState, coachTips })
    expect(pack.estimatedTokens).toBeGreaterThan(0)
    expect(pack.estimatedTokens).toBeLessThan(400)

    const text = renderContextText(pack)
    expect(text).toContain('CAR/TRACK:')
    expect(text).toContain('FUEL:')
    expect(text).toContain('GAPS:')
    expect(estimateTokens(text)).toBeLessThan(400)
  })

  it('marks telemetry offline when disconnected', () => {
    const pack = buildContextPack(snapshot({ connected: false }))
    expect(pack.connected).toBe(false)
    expect(pack.session.phase).toBe('unknown')
    expect(renderContextText(pack)).toContain('telemetry offline')
  })

  it('derives fuel + laps-left straight from the snapshot when no fuel engine state is supplied', () => {
    const pack = buildContextPack(snapshot())
    expect(pack.fuel.liters).toBe(34.2)
    expect(pack.fuel.perLap).toBe(2.1)
    // 34.2 / 2.1 ≈ 16.3 laps; canFinish vs 13 laps remaining → true
    expect(pack.fuel.lapsLeft).toBeGreaterThan(15)
    expect(pack.fuel.canFinish).toBe(true)
  })

  it('preserves and formats all four tyre pressures without dropping temperatures', () => {
    const pressures = { lf: 180, rf: 181.2, lr: 178.4, rr: 179.6 }
    const pack = buildContextPack(
      snapshot({
        tyres: {
          lf: { pressureKpa: pressures.lf, tempC: 88 },
          rf: { pressureKpa: pressures.rf, tempC: 95 },
          lr: { pressureKpa: pressures.lr, tempC: 86 },
          rr: { pressureKpa: pressures.rr, tempC: 90 }
        }
      })
    )

    expect(pack.tyres).toMatchObject({
      lf: { pressureKpa: 180, tempC: 88 },
      rf: { pressureKpa: 181.2, tempC: 95 },
      lr: { pressureKpa: 178.4, tempC: 86 },
      rr: { pressureKpa: 179.6, tempC: 90 }
    })
    const metric = renderContextText(pack, { unitSystem: 'metric' })
    for (const [id, pressure] of Object.entries(pressures)) {
      expect(metric).toContain(
        `${id.toUpperCase()} ${formatMeasurement(pressure, 'pressure-kpa', 'metric', {
          decimals: 1,
          trimTrailingZeros: true,
          includeUnit: true
        }).display}`
      )
    }
    expect(metric).toContain('88 °C')

    const imperial = renderContextText(pack, { unitSystem: 'imperial' })
    for (const pressure of Object.values(pressures)) {
      expect(imperial).toContain(
        formatMeasurement(pressure, 'pressure-kpa', 'imperial', {
          decimals: 1,
          trimTrailingZeros: true,
          includeUnit: true
        }).display
      )
    }
  })

  it('keeps partial tyre pressure/temperature data and omits missing or non-finite values', () => {
    const pack = buildContextPack(
      snapshot({
        tyres: {
          lf: { pressureKpa: 180 },
          rf: { tempC: 91 },
          lr: { pressureKpa: Number.NaN },
          rr: {}
        }
      })
    )

    expect(pack.tyres.lf).toEqual({ pressureKpa: 180 })
    expect(pack.tyres.rf).toEqual({ tempC: 91 })
    expect(pack.tyres.lr).toBeUndefined()
    expect(pack.tyres.rr).toBeUndefined()
    const text = renderContextText(pack)
    expect(text).toContain('LF 180 kPa')
    expect(text).toContain('RF 91 °C')
    expect(text).not.toContain('NaN')
  })

  it('omits the tyre line when pressure, temperature, and wear are all missing', () => {
    const pack = buildContextPack(snapshot({ tyres: undefined }))
    expect(pack.tyres.lf).toBeUndefined()
    expect(renderContextText(pack)).not.toContain('TYRES:')
  })

  it('keeps surface wetness unknown when rain is false but no explicit surface evidence exists', () => {
    const pack = buildContextPack(
      snapshot({ isRaining: false, trackWetnessPct: undefined })
    )
    expect(pack.weather.condition).toBe('unknown')
    const text = renderContextText(pack)
    expect(text).toContain('WEATHER:')
    expect(text).toContain('surface unknown')
    expect(text).not.toContain('WEATHER: dry')
  })

  it('reports dry only from an explicit zero wetness measurement', () => {
    const pack = buildContextPack(
      snapshot({ isRaining: false, trackWetnessPct: 0 })
    )
    expect(pack.weather.condition).toBe('dry')
    expect(renderContextText(pack)).toContain('dry')
  })

  it('honours the render token budget by dropping events first', () => {
    const events = Array.from({ length: 10 }, (_, i) => ({ at: i, kind: 'note', text: `event number ${i} with some words` }))
    const pack = buildContextPack(snapshot(), { events, maxEvents: 10 })
    const trimmed = renderContextText(pack, { maxTokens: 30 })
    expect(trimmed).not.toContain('EVENTS')
    expect(trimmed).toContain('CAR/TRACK:')
  })

  it('renders deterministic grounded coach finding lines with confidence and intent context', () => {
    const pack = buildContextPack(snapshot(), {
      coachFindings: [
        coachFinding,
        {
          ...coachFinding,
          id: 'context:defend',
          context: true,
          intent: 'defend',
          intentEvidence: ['defesa reconhecida']
        }
      ]
    })

    const text = renderContextText(pack)
    expect(text).toContain('COACHING: Turn 13 (Setor 3): Freou tarde — perdeu 1.0s (freio 18m depois da referência)')
    expect(text).toContain('(descartado: ataque descartado: sem carro à frente). [severity high, confidence 87%, intent attack/racecraft]')
    expect(text).not.toContain('defesa reconhecida')
  })
})

import type { DriverEntry, TelemetrySnapshot } from '../../shared/telemetry'
import type { TelemetryProvider } from './provider'

// Provider sintético: gera uma lap plausível para desenvolver/visualizar
// dashboards, overlays e OLED SEM estar numa sessão real (essencial no Mac).
export class MockProvider implements TelemetryProvider {
  readonly id = 'mock' as const
  private running = false
  private startedAt = 0

  start(): void {
    this.running = true
    this.startedAt = Date.now()
  }

  stop(): void {
    this.running = false
  }

  isConnected(): boolean {
    return this.running
  }

  poll(): TelemetrySnapshot | null {
    if (!this.running) return null
    const t = (Date.now() - this.startedAt) / 1000

    const lapSeconds = 92
    const lapPct = (t % lapSeconds) / lapSeconds
    const lap = 1 + Math.floor(t / lapSeconds)

    const cornerFactor = 0.55 + 0.45 * Math.sin(lapPct * Math.PI * 6)
    const speedKmh = 70 + 220 * Math.max(0.1, cornerFactor)
    const maxRpm = 8200
    const rpm = 3500 + (maxRpm - 3500) * Math.max(0.1, cornerFactor)
    const gear = Math.max(1, Math.min(6, Math.round(1 + (speedKmh / 290) * 5)))
    const throttle = Math.max(0, cornerFactor)
    const brake = Math.max(0, -Math.sin(lapPct * Math.PI * 6)) * 0.9
    const shiftIndicatorPct = Math.min(1, Math.max(0, (rpm - (maxRpm - 900)) / 900))

    const waterTempC = 92 + Math.sin(t * 0.05) * 3
    const oilTempC = 108 + Math.sin(t * 0.07) * 4

    const fuelPerLapLiters = 2.6
    const fuelCapacity = 90
    const fuelLiters = Math.max(0, fuelCapacity - fuelPerLapLiters * (t / lapSeconds))

    // Caminho fechado e suave parametrizado por lapPct, para o track-map learner
    // poder reconstruir um traçado plausível 100% no Mac. Periódico em 2π → fecha
    // sozinho. As harmônicas extras evitam uma elipse perfeita (mais "trackish").
    const theta = lapPct * Math.PI * 2
    const xMeters = 1000 * Math.cos(theta) + 80 * Math.sin(3 * theta)
    const yMeters = 600 * Math.sin(theta) + 50 * Math.sin(5 * theta)
    // Derivadas analíticas → speed no mundo (eixo x=leste, y=norte).
    const dxDtheta = -1000 * Math.sin(theta) + 240 * Math.cos(3 * theta)
    const dyDtheta = 600 * Math.cos(theta) + 250 * Math.cos(5 * theta)
    const dThetaDt = (Math.PI * 2) / lapSeconds
    const vEast = dxDtheta * dThetaDt
    const vNorth = dyDtheta * dThetaDt
    const speedMs = Math.hypot(vEast, vNorth)
    // Aproximação flat-earth em torno de uma origem fixa (Curitiba-ish).
    const ORIGIN_LAT = -25.43
    const ORIGIN_LON = -49.27
    const METERS_PER_DEG_LAT = 111_320
    const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((ORIGIN_LAT * Math.PI) / 180)
    const lat = ORIGIN_LAT + yMeters / METERS_PER_DEG_LAT
    const lon = ORIGIN_LON + xMeters / metersPerDegLon
    // yawNorth: rumo (rad) medido a partir do Norte no sentido horário (iRacing convention).
    const yawNorth = Math.atan2(vEast, vNorth)
    // No frame do carro, velocityX é longitudinal (frente) e velocityY é lateral.
    // Para uma trajetória "limpa" o lateral é ~0; mantemos isso simples para o mock.
    const velocityX = speedMs
    const velocityY = 0

    const bestLap = 90.2
    const lastLap = 90.2 + (Math.sin(lap) * 0.6 + 0.3)
    const currentLapTime = lapPct * lapSeconds
    const deltaToBest = Math.sin(t * 0.7) * 0.4
    const absEnabled = true
    const tcEnabled = true
    const brakeBiasPct = 54.2 + Math.sin(t * 0.09) * 1.8
    const engineMap = 3 + (Math.floor(t / 14) % 3)

    const drivers: DriverEntry[] = [
      { carIdx: 1, name: 'A. Senna', carNumber: '12', position: 1, classPosition: 1, classId: 0, className: 'GT3', classColor: '#49C5B1', gapToPlayerSec: 1.8 + Math.sin(t) * 0.35, lapDistPct: (lapPct + 0.025) % 1, lastLapTimeSec: 89.8, isPlayer: false },
      { carIdx: 0, name: 'Guilherme Basso', carNumber: '7', position: 2, classPosition: 2, classId: 0, className: 'GT3', classColor: '#49C5B1', gapToPlayerSec: 0, lapDistPct: lapPct, lastLapTimeSec: lastLap, isPlayer: true },
      { carIdx: 2, name: 'M. Hakkinen', carNumber: '3', position: 3, classPosition: 3, classId: 0, className: 'GT3', classColor: '#49C5B1', gapToPlayerSec: -0.9 + Math.cos(t * 0.7) * 0.22, lapDistPct: (lapPct + 0.985) % 1, lastLapTimeSec: 90.5, isPlayer: false },
      { carIdx: 3, name: 'J. Verstappen', carNumber: '33', position: 4, classPosition: 1, classId: 1, className: 'LMP2', classColor: '#FFB900', gapToPlayerSec: -4.2, lapDistPct: (lapPct + 0.92) % 1, lastLapTimeSec: 88.9, isPlayer: false }
    ]
    const relatives = {
      ahead: { carIdx: 1, name: 'A. Senna', carNumber: '12', position: 1, classPosition: 1, gapSec: drivers[0].gapToPlayerSec, lastLapTimeSec: 89.8, classColor: '#49C5B1' },
      behind: { carIdx: 2, name: 'M. Hakkinen', carNumber: '3', position: 3, classPosition: 3, gapSec: drivers[2].gapToPlayerSec, lastLapTimeSec: 90.5, classColor: '#49C5B1' }
    }
    const radarCars = [
      { carIdx: 1, name: 'A. Senna', relativeX: -2.5 + Math.sin(t * 1.7), relativeY: 16 + Math.sin(t) * 3, gapSec: drivers[0].gapToPlayerSec, classColor: '#49C5B1' },
      { carIdx: 2, name: 'M. Hakkinen', relativeX: 3 + Math.cos(t * 1.4), relativeY: -9 + Math.cos(t * 0.7) * 2, gapSec: drivers[2].gapToPlayerSec, classColor: '#49C5B1' }
    ]

    return {
      sim: 'mock',
      connected: true,
      timestamp: Date.now(),
      speedKmh,
      rpm,
      gear,
      maxRpm,
      shiftIndicatorPct,
      throttle,
      brake,
      clutch: 0,
      steerAngleDeg: Math.sin(lapPct * Math.PI * 6) * 90,
      drs: lapPct > 0.55 && lapPct < 0.72,
      absActive: brake > 0.7,
      absEnabled,
      absLevel: 4,
      absCutPct: brake > 0.7 ? 18 : 0,
      tcActive: throttle > 0.85 && speedKmh < 120,
      tcEnabled,
      tcLevel: 6,
      engineMap,
      engineWarnings: {
        waterTemp: waterTempC > 105,
        fuelPressure: false,
        oilPressure: false,
        oilTemp: oilTempC > 125,
        stalled: false,
        pitLimiter: false,
        revLimiter: rpm > maxRpm - 150,
        mandRepair: false,
        optRepair: false
      },
      brakeBiasPct,
      handbrake: 0,
      waterTempC,
      oilTempC,
      oilPressureKpa: 420 + throttle * 80,
      sessionType: 'Race',
      sessionState: 'racing',
      paceMode: 'notPacing',
      paceFlags: [],
      carName: 'Mock GT3',
      carPath: 'mock-gt3',
      trackName: 'Okayama International Circuit - Full Course',
      trackConfigName: 'Full Course',
      sessionUniqueId: 1,
      sessionTimeRemainingSec: Math.max(0, 3600 - t),
      lapsRemaining: Math.max(0, 24 - lap),
      currentLap: lap,
      lapDistPct: lapPct,
      lastLapTimeSec: lastLap,
      bestLapTimeSec: bestLap,
      currentLapTimeSec: currentLapTime,
      estimatedLapTimeSec: bestLap + deltaToBest,
      deltaToBestSec: deltaToBest,
      deltaToSessionBestSec: deltaToBest + 0.2,
      position: 2,
      classPosition: 2,
      totalCars: drivers.length,
      strengthOfField: 3200,
      fuelLiters,
      fuelMassKg: fuelLiters * 0.75,
      fuelPerLap: fuelPerLapLiters,
      fuelPerLapLiters,
      fuelLapsRemaining: fuelLiters / fuelPerLapLiters,
      fuelCapacityLiters: fuelCapacity,
      tyres: {
        lf: { tempC: 82 + brake * 20, pressureKpa: 165, wearPct: 1 - (t / lapSeconds) * 0.012 },
        rf: { tempC: 84 + brake * 20, pressureKpa: 166, wearPct: 1 - (t / lapSeconds) * 0.013 },
        lr: { tempC: 78 + throttle * 18, pressureKpa: 162, wearPct: 1 - (t / lapSeconds) * 0.010 },
        rr: { tempC: 80 + throttle * 18, pressureKpa: 163, wearPct: 1 - (t / lapSeconds) * 0.011 }
      },
      brakeTempC: { lf: 320 + brake * 250, rf: 330 + brake * 250, lr: 240 + brake * 180, rr: 250 + brake * 180 },
      flags: {
        green: true, yellow: false, blue: false, white: false, checkered: false, red: false,
        black: false, meatball: false, repair: false, disqualify: false, greenWhiteCheckered: false
      },
      pitLimiter: false,
      onPitRoad: false,
      pitStopActive: false,
      pit: { inPitStall: false, repairNeeded: false, optRepairNeeded: false, pitsOpen: true },
      refuelServiceActive: false,
      pitServiceFlags: [],
      pitFuelToAddL: 0,
      incidentCount: 4,
      incidentCountMy: 4,
      incidentLimit: 17,
      fastRepairsUsed: 0,
      fastRepairsAvailable: 1,
      trackTempC: 31,
      airTempC: 24,
      trackWetnessPct: 0,
      isRaining: false,
      gripPct: 0.96,
      tyreStatePct: 1 - (t / lapSeconds) * 0.0115,
      trafficDensity: radarCars.length / 10,
      flagStateIndex: 0,
      damagePct: 0,
      lapValidity: 'valid',
      towReset: false,
      playerCarIdx: 0,
      // Brief spotter window: two cars stacking up on the left through one phase of the
      // lap so the count (2 = LR2CarsLeft) and side decode exercise downstream consumers.
      carLeftRight: lapPct > 0.3 && lapPct < 0.36 ? 'left' : 'clear',
      carLeftRightRaw: lapPct > 0.3 && lapPct < 0.36 ? 5 : 1,
      carLeftRightCount: lapPct > 0.3 && lapPct < 0.36 ? 2 : undefined,
      drivers,
      relatives,
      radarCars,
      lat,
      lon,
      velocityX,
      velocityY,
      yawNorth
    }
  }
}

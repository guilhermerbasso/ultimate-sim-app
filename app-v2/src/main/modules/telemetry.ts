import type { TelemetrySnapshot, TelemetrySource } from '../../shared/telemetry'
import type { ModuleContext } from '../module-context'
import { MockProvider } from '../telemetry/mock-provider'

const FAST_RATE_HZ = 60
const RACE_RATE_HZ = 15
const DRIVERS_RATE_HZ = 3

// Módulo base de telemetria: registra o MockProvider (dev/preview) e expõe o
// stream + controle da fonte via IPC. Providers reais (iRacing/ACC/AC/AMS2) são
// registrados pelos seus próprios módulos no mesmo ctx.telemetryHub.
export function register(ctx: ModuleContext): void {
  ctx.telemetryHub.register(new MockProvider())

  ctx.telemetryHub.on('snapshot', (snapshot) => {
    ctx.broadcast('telemetry:snapshot', snapshot)
  })

  const tierSubscribers = new Map<number, () => void>()
  const removeTierSubscriber = (senderId: number): void => {
    tierSubscribers.delete(senderId)
  }

  let lastFastAt = 0
  let lastRaceAt = 0
  let lastDriversAt = 0
  let lastSessionKey = ''
  let tiersWereNull = true

  ctx.telemetryHub.on('sample', (snapshot: TelemetrySnapshot | null) => {
    if (tierSubscribers.size === 0) return

    if (!snapshot) {
      if (!tiersWereNull) {
        ctx.broadcast('telemetry:fast', null)
        ctx.broadcast('telemetry:race', null)
        ctx.broadcast('telemetry:drivers', null)
        ctx.broadcast('telemetry:session', null)
      }
      tiersWereNull = true
      lastSessionKey = ''
      return
    }

    tiersWereNull = false
    const now = snapshot.timestamp || Date.now()
    if (isDue(now, lastFastAt, FAST_RATE_HZ)) {
      lastFastAt = now
      ctx.broadcast('telemetry:fast', fastTier(snapshot))
    }
    if (isDue(now, lastRaceAt, RACE_RATE_HZ)) {
      lastRaceAt = now
      ctx.broadcast('telemetry:race', raceTier(snapshot))
    }
    if (isDue(now, lastDriversAt, DRIVERS_RATE_HZ)) {
      lastDriversAt = now
      ctx.broadcast('telemetry:drivers', driversTier(snapshot))
    }

    const key = sessionTierKey(snapshot)
    if (key !== lastSessionKey) {
      lastSessionKey = key
      ctx.broadcast('telemetry:session', sessionTier(snapshot))
    }
  })

  ctx.ipcMain.handle('telemetry:status', () => ctx.telemetryHub.status())
  ctx.ipcMain.handle('telemetry:getLatest', () => ctx.telemetryHub.getLatest())
  ctx.ipcMain.handle('telemetry:setSource', (_event, source: TelemetrySource) =>
    ctx.telemetryHub.setSource(source)
  )
  ctx.ipcMain.handle('telemetry:tiersSubscribe', (event) => {
    const { sender } = event
    if (!tierSubscribers.has(sender.id)) {
      const cleanup = (): void => removeTierSubscriber(sender.id)
      tierSubscribers.set(sender.id, cleanup)
      sender.once('destroyed', cleanup)
    }
    return tierSubscribers.size
  })
  ctx.ipcMain.handle('telemetry:tiersUnsubscribe', (event) => {
    const cleanup = tierSubscribers.get(event.sender.id)
    if (cleanup) {
      event.sender.off('destroyed', cleanup)
      removeTierSubscriber(event.sender.id)
    }
    return tierSubscribers.size
  })
}

function isDue(now: number, lastAt: number, rateHz: number): boolean {
  return lastAt === 0 || now - lastAt >= 1000 / rateHz
}

function fastTier(snapshot: TelemetrySnapshot): Partial<TelemetrySnapshot> {
  return {
    sim: snapshot.sim,
    connected: snapshot.connected,
    timestamp: snapshot.timestamp,
    speedKmh: snapshot.speedKmh,
    rpm: snapshot.rpm,
    gear: snapshot.gear,
    maxRpm: snapshot.maxRpm,
    shiftIndicatorPct: snapshot.shiftIndicatorPct,
    shiftRpm: snapshot.shiftRpm,
    throttle: snapshot.throttle,
    brake: snapshot.brake,
    clutch: snapshot.clutch,
    steerAngleDeg: snapshot.steerAngleDeg,
    latAccelG: snapshot.latAccelG,
    longAccelG: snapshot.longAccelG,
    vertAccelG: snapshot.vertAccelG,
    yawRateRadSec: snapshot.yawRateRadSec,
    drs: snapshot.drs,
    absActive: snapshot.absActive,
    absEnabled: snapshot.absEnabled,
    absLevel: snapshot.absLevel,
    tcActive: snapshot.tcActive,
    tcEnabled: snapshot.tcEnabled,
    tcLevel: snapshot.tcLevel,
    engineMap: snapshot.engineMap,
    brakeBiasPct: snapshot.brakeBiasPct,
    handbrake: snapshot.handbrake,
    steeringTorquePct: snapshot.steeringTorquePct,
    pitchRad: snapshot.pitchRad,
    rollRad: snapshot.rollRad,
    yawRad: snapshot.yawRad,
    pitchRateRadSec: snapshot.pitchRateRadSec,
    rollRateRadSec: snapshot.rollRateRadSec
  }
}

function raceTier(snapshot: TelemetrySnapshot): Partial<TelemetrySnapshot> {
  return {
    sim: snapshot.sim,
    connected: snapshot.connected,
    timestamp: snapshot.timestamp,
    sessionTimeRemainingSec: snapshot.sessionTimeRemainingSec,
    lapsRemaining: snapshot.lapsRemaining,
    currentLap: snapshot.currentLap,
    lapDistPct: snapshot.lapDistPct,
    lastLapTimeSec: snapshot.lastLapTimeSec,
    bestLapTimeSec: snapshot.bestLapTimeSec,
    currentLapTimeSec: snapshot.currentLapTimeSec,
    estimatedLapTimeSec: snapshot.estimatedLapTimeSec,
    deltaToBestSec: snapshot.deltaToBestSec,
    deltaToSessionBestSec: snapshot.deltaToSessionBestSec,
    position: snapshot.position,
    classPosition: snapshot.classPosition,
    totalCars: snapshot.totalCars,
    strengthOfField: snapshot.strengthOfField,
    fuelLiters: snapshot.fuelLiters,
    fuelPerLap: snapshot.fuelPerLap,
    fuelPerLapLiters: snapshot.fuelPerLapLiters,
    fuelLapsRemaining: snapshot.fuelLapsRemaining,
    fuelPerLapKg: snapshot.fuelPerLapKg,
    fuelCapacityLiters: snapshot.fuelCapacityLiters,
    tyres: snapshot.tyres,
    brakeTempC: snapshot.brakeTempC,
    flags: snapshot.flags,
    pitLimiter: snapshot.pitLimiter,
    onPitRoad: snapshot.onPitRoad,
    pitServiceFlags: snapshot.pitServiceFlags,
    incidentCount: snapshot.incidentCount,
    incidentLimit: snapshot.incidentLimit,
    fastRepairsUsed: snapshot.fastRepairsUsed,
    fastRepairsAvailable: snapshot.fastRepairsAvailable,
    playerCarIdx: snapshot.playerCarIdx,
    relatives: snapshot.relatives,
    radarCars: snapshot.radarCars,
    lat: snapshot.lat,
    lon: snapshot.lon,
    velocityX: snapshot.velocityX,
    velocityY: snapshot.velocityY,
    yawNorth: snapshot.yawNorth,
    manifoldPressBar: snapshot.manifoldPressBar,
    fuelPressBar: snapshot.fuelPressBar,
    voltage: snapshot.voltage,
    waterLevelL: snapshot.waterLevelL,
    oilLevelL: snapshot.oilLevelL,
    fuelLevelPct: snapshot.fuelLevelPct,
    brakeLinePressBar: snapshot.brakeLinePressBar,
    deltaToOptimalSec: snapshot.deltaToOptimalSec,
    deltaToSessionOptimalSec: snapshot.deltaToSessionOptimalSec,
    deltaToDriverBestSec: snapshot.deltaToDriverBestSec,
    altitudeM: snapshot.altitudeM
  }
}

function driversTier(snapshot: TelemetrySnapshot): Partial<TelemetrySnapshot> {
  return {
    sim: snapshot.sim,
    connected: snapshot.connected,
    timestamp: snapshot.timestamp,
    playerCarIdx: snapshot.playerCarIdx,
    totalCars: snapshot.totalCars,
    strengthOfField: snapshot.strengthOfField,
    drivers: snapshot.drivers
  }
}

function sessionTier(snapshot: TelemetrySnapshot): Partial<TelemetrySnapshot> {
  return {
    sim: snapshot.sim,
    connected: snapshot.connected,
    timestamp: snapshot.timestamp,
    sessionType: snapshot.sessionType,
    carName: snapshot.carName,
    trackName: snapshot.trackName,
    sessionUniqueId: snapshot.sessionUniqueId,
    driverName: snapshot.driverName,
    trackTempC: snapshot.trackTempC,
    airTempC: snapshot.airTempC,
    trackWetnessPct: snapshot.trackWetnessPct,
    isRaining: snapshot.isRaining,
    gripPct: snapshot.gripPct,
    steeringAngleMaxDeg: snapshot.steeringAngleMaxDeg,
    fogPct: snapshot.fogPct,
    humidityPct: snapshot.humidityPct,
    windSpeedMs: snapshot.windSpeedMs,
    windDirRad: snapshot.windDirRad,
    solarAltitudeRad: snapshot.solarAltitudeRad,
    solarAzimuthRad: snapshot.solarAzimuthRad,
    skies: snapshot.skies
  }
}

function sessionTierKey(snapshot: TelemetrySnapshot): string {
  return JSON.stringify([
    snapshot.sim,
    snapshot.connected,
    snapshot.sessionType,
    snapshot.carName,
    snapshot.trackName,
    snapshot.sessionUniqueId,
    snapshot.driverName,
    snapshot.trackTempC,
    snapshot.airTempC,
    snapshot.trackWetnessPct,
    snapshot.isRaining,
    snapshot.gripPct
  ])
}

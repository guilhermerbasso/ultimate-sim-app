import { describe, expect, it } from 'vitest'
import {
  RACECON_MOCK_DASHBOARD_IDS,
  RACECON_MOCK_SCENARIOS,
  createRaceConMockFrame
} from './racecon-mock-telemetry'

describe('RaceCon mock telemetry', () => {
  it('provides exactly one deterministic scenario for each RC dashboard packet', () => {
    expect(RACECON_MOCK_DASHBOARD_IDS).toHaveLength(20)
    expect(Object.keys(RACECON_MOCK_SCENARIOS)).toEqual([...RACECON_MOCK_DASHBOARD_IDS])

    for (const id of RACECON_MOCK_DASHBOARD_IDS) {
      const a = createRaceConMockFrame(id, 12.5)
      const b = createRaceConMockFrame(id, 12.5)
      expect(JSON.stringify(a), id).toBe(JSON.stringify(b))
      expect(a.snapshot.sim, id).toBe('mock')
      expect(a.snapshot.connected, id).toBe(true)
      expect(a.channels['engine.rpm'].synthetic, id).toBe(true)
    }
  })

  it('keeps the normalized car channels finite and within physical bounds', () => {
    for (const id of RACECON_MOCK_DASHBOARD_IDS) {
      for (const elapsedSec of [0, 12.5, 48, 125]) {
        const { snapshot } = createRaceConMockFrame(id, elapsedSec)
        expect(Number.isFinite(snapshot.speedKmh), `${id}:speed`).toBe(true)
        expect(Number.isFinite(snapshot.rpm), `${id}:rpm`).toBe(true)
        expect(snapshot.speedKmh, `${id}:speed`).toBeGreaterThanOrEqual(0)
        expect(snapshot.rpm, `${id}:rpm`).toBeGreaterThanOrEqual(0)
        expect(snapshot.throttle, `${id}:throttle`).toBeGreaterThanOrEqual(0)
        expect(snapshot.throttle, `${id}:throttle`).toBeLessThanOrEqual(1)
        expect(snapshot.brake, `${id}:brake`).toBeGreaterThanOrEqual(0)
        expect(snapshot.brake, `${id}:brake`).toBeLessThanOrEqual(1)
        expect(snapshot.clutch, `${id}:clutch`).toBeGreaterThanOrEqual(0)
        expect(snapshot.clutch, `${id}:clutch`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('keeps relational telemetry invariants across all sampled scenarios', () => {
    for (const id of RACECON_MOCK_DASHBOARD_IDS) {
      const scenario = RACECON_MOCK_SCENARIOS[id]
      for (const elapsedSec of [0, scenario.durationSec * 0.2, scenario.durationSec * 0.5, scenario.durationSec * 0.8]) {
        const snapshot = scenario.frame(elapsedSec).snapshot
        const drivers = snapshot.drivers ?? []
        const player = drivers.find((driver) => driver.isPlayer)
        const positions = drivers.map((driver) => driver.position)

        expect(drivers.length, `${id}:roster`).toBe(snapshot.totalCars)
        expect(new Set(positions).size, `${id}:positions`).toBe(positions.length)
        expect(Math.max(...positions), `${id}:field-size`).toBeLessThanOrEqual(snapshot.totalCars ?? 0)
        expect(player?.position, `${id}:player-position`).toBe(snapshot.position)
        expect(player?.classPosition, `${id}:player-class-position`).toBe(snapshot.classPosition)
        expect(player?.lap, `${id}:player-lap`).toBe(snapshot.currentLap)
        expect(player?.lapDistPct, `${id}:player-distance`).toBeCloseTo(snapshot.lapDistPct ?? 0, 10)

        const classes = new Map<number, number[]>()
        for (const driver of drivers) {
          const classPositions = classes.get(driver.classId) ?? []
          classPositions.push(driver.classPosition)
          classes.set(driver.classId, classPositions)
          expect(driver.lapDistPct, `${id}:driver-distance`).toBeGreaterThanOrEqual(0)
          expect(driver.lapDistPct, `${id}:driver-distance`).toBeLessThan(1)
        }
        for (const classPositions of classes.values()) {
          expect(new Set(classPositions).size, `${id}:class-positions`).toBe(classPositions.length)
        }

        for (const radar of snapshot.radarCars ?? []) {
          const driver = drivers.find((entry) => entry.carIdx === radar.carIdx)
          expect(driver?.name, `${id}:radar-name`).toBe(radar.name)
          expect(driver?.gapToPlayerSec, `${id}:radar-gap`).toBe(radar.gapSec)
          expect(driver?.classColor, `${id}:radar-class`).toBe(radar.classColor)
          if (radar.relativeY >= 0) expect(radar.gapSec, `${id}:radar-ahead`).toBeGreaterThanOrEqual(0)
          else expect(radar.gapSec, `${id}:radar-behind`).toBeLessThanOrEqual(0)
        }

        expect(snapshot.velocityX, `${id}:velocity`).toBeCloseTo(snapshot.speedKmh / 3.6, 8)
        if (snapshot.speedKmh <= 0.5) {
          expect(snapshot.latAccelG, `${id}:stationary-lat-g`).toBe(0)
          expect(snapshot.longAccelG, `${id}:stationary-long-g`).toBe(0)
          expect(snapshot.yawRateRadSec, `${id}:stationary-yaw`).toBe(0)
          expect(snapshot.absActive, `${id}:stationary-abs`).toBe(false)
          expect(snapshot.tcActive, `${id}:stationary-tc`).toBe(false)
        }
      }
    }
  })

  it('models the pit sequence as gated phases', () => {
    const scenario = RACECON_MOCK_SCENARIOS['RC-04']
    const approach = scenario.frame(2)
    const limiter = scenario.frame(10)
    const service = scenario.frame(20)
    const release = scenario.frame(30)

    expect(approach.phase).toBe('pit-approach')
    expect(limiter.phase).toBe('pit-limiter')
    expect(limiter.snapshot.pitLimiter).toBe(true)
    expect(service.phase).toBe('pit-service')
    expect(service.snapshot.pitStopActive).toBe(true)
    expect(service.snapshot.refuelServiceActive).toBe(true)
    expect(release.phase).toBe('pit-release')
  })

  it('provides wet, fault and launch states for trigger QA', () => {
    const wet = RACECON_MOCK_SCENARIOS['RC-08'].frame(75)
    expect(wet.snapshot.isRaining).toBe(true)
    expect(wet.snapshot.trackWetnessPct).toBeGreaterThan(0.5)

    const fault = RACECON_MOCK_SCENARIOS['RC-14'].frame(45)
    expect(fault.snapshot.engineWarnings?.mandRepair).toBe(true)
    expect(fault.channels['vehicle.faultSummary'].value).toBe('CRITICAL')

    const start = RACECON_MOCK_SCENARIOS['RC-20']
    expect(start.frame(5).phase).toBe('formation')
    expect(start.frame(20).phase).toBe('grid')
    expect(start.frame(27).phase).toBe('lights')
    expect(start.frame(35).phase).toBe('launch')
  })

  it('keeps standings and dependent fuel fields internally consistent', () => {
    const attack = RACECON_MOCK_SCENARIOS['RC-01'].frame(0).snapshot
    const player = attack.drivers?.find((driver) => driver.isPlayer)
    expect(player?.position).toBe(attack.position)
    expect(player?.lap).toBe(attack.currentLap)
    expect(player?.lapDistPct).toBe(attack.lapDistPct)
    expect(attack.drivers?.length).toBe(attack.totalCars)
    expect(attack.bestNLapLap).toBeUndefined()
    expect(attack.bestNLapTimeSec).toBeUndefined()

    const rally = RACECON_MOCK_SCENARIOS['RC-09'].frame(30).snapshot
    expect(rally.drivers?.length).toBe(rally.totalCars)
    expect(Math.max(...(rally.drivers?.map((driver) => driver.position) ?? []))).toBeLessThanOrEqual(
      rally.totalCars ?? 0
    )
    const gt3ClassPositions = rally.drivers
      ?.filter((driver) => driver.className === 'GT3')
      .map((driver) => driver.classPosition)
    expect(new Set(gt3ClassPositions).size).toBe(gt3ClassPositions?.length)

    for (const radar of attack.radarCars ?? []) {
      const driver = attack.drivers?.find((entry) => entry.carIdx === radar.carIdx)
      expect(driver?.name).toBe(radar.name)
      expect(driver?.gapToPlayerSec).toBe(radar.gapSec)
    }

    const traffic = RACECON_MOCK_SCENARIOS['RC-07'].frame(0).snapshot
    const prototypeRadar = traffic.radarCars?.find((radar) => radar.name === 'Mock Prototype')
    const prototypeDriver = traffic.drivers?.find((driver) => driver.carIdx === prototypeRadar?.carIdx)
    expect(prototypeRadar?.relativeY).toBeLessThan(0)
    expect(prototypeRadar?.gapSec).toBeLessThan(0)
    expect(prototypeDriver?.className).toBe('Prototype')

    const startLine = RACECON_MOCK_SCENARIOS['RC-01'].frame(0).snapshot
    const chaser = startLine.drivers?.find((driver) => driver.position === 3)
    expect(startLine.currentLap).toBe(12)
    expect(chaser?.lapDistPct).toBeGreaterThan(0.9)
    expect(chaser?.lap).toBe(11)

    const boundary = RACECON_MOCK_SCENARIOS['RC-01'].frame(91.08).snapshot
    const leader = boundary.drivers?.find((driver) => driver.position === 1)
    expect(boundary.lapDistPct).toBeCloseTo(0.99, 8)
    expect(leader?.lapDistPct).toBeCloseTo(0, 8)
    expect(leader?.lap).toBe((boundary.currentLap ?? 0) + 1)

    for (const id of ['RC-03', 'RC-06', 'RC-19'] as const) {
      const fuel = RACECON_MOCK_SCENARIOS[id].frame(45).snapshot
      expect(fuel.fuelMassKg, id).toBeCloseTo((fuel.fuelLiters ?? 0) * 0.75, 8)
      expect(fuel.fuelLevelPct, id).toBeCloseTo(
        (fuel.fuelLiters ?? 0) / (fuel.fuelCapacityLiters ?? 1),
        8
      )
      expect(fuel.fuelLapsRemaining, id).toBeCloseTo(
        (fuel.fuelLiters ?? 0) / (fuel.fuelPerLapLiters ?? 1),
        8
      )
    }
  })

  it('synchronizes limiter, spotter count and shift-light dependent fields', () => {
    const limitedRelease = RACECON_MOCK_SCENARIOS['RC-04'].frame(29.5).snapshot
    expect(limitedRelease.pitLimiter).toBe(true)
    expect(limitedRelease.speedKmh).toBeLessThanOrEqual(60)
    expect(limitedRelease.engineWarnings?.pitLimiter).toBe(true)

    const unrestrictedRelease = RACECON_MOCK_SCENARIOS['RC-04'].frame(32.4).snapshot
    expect(unrestrictedRelease.pitLimiter).toBe(false)
    expect(unrestrictedRelease.speedKmh).toBeGreaterThan(60)
    expect(unrestrictedRelease.engineWarnings?.pitLimiter).toBe(false)

    const threeWide = RACECON_MOCK_SCENARIOS['RC-17'].frame(15).snapshot
    expect(threeWide.carLeftRight).toBe('both')
    expect(threeWide.carLeftRightCount).toBe(1)

    const formation = RACECON_MOCK_SCENARIOS['RC-20'].frame(5.8).snapshot
    expect(formation.rpm).toBeLessThan(6800)
    expect(formation.shiftIndicatorPct).toBe(0)
    expect(formation.revLights?.pct).toBe(0)
  })

  it('clears racing kinematics during stationary service and grid phases', () => {
    for (const snapshot of [
      RACECON_MOCK_SCENARIOS['RC-04'].frame(20).snapshot,
      RACECON_MOCK_SCENARIOS['RC-20'].frame(20).snapshot
    ]) {
      expect(snapshot.speedKmh).toBe(0)
      expect(snapshot.velocityX).toBe(0)
      expect(snapshot.velocityY).toBe(0)
      expect(snapshot.latAccelG).toBe(0)
      expect(snapshot.longAccelG).toBe(0)
      expect(snapshot.yawRateRadSec).toBe(0)
      expect(snapshot.absActive).toBe(false)
      expect(snapshot.tcActive).toBe(false)
    }

    const service = RACECON_MOCK_SCENARIOS['RC-04'].frame(20).snapshot
    expect(service.refuelServiceActive).toBe(true)
    expect(service.pitFuelToAddL).toBeGreaterThan(0)

    const gridA = RACECON_MOCK_SCENARIOS['RC-20'].frame(18).snapshot
    const gridB = RACECON_MOCK_SCENARIOS['RC-20'].frame(20).snapshot
    expect(gridB.lapDistanceM).toBe(gridA.lapDistanceM)
    expect(gridB.lat).toBe(gridA.lat)
    expect(gridB.lon).toBe(gridA.lon)

    const serviceA = RACECON_MOCK_SCENARIOS['RC-04'].frame(18).snapshot
    const serviceB = RACECON_MOCK_SCENARIOS['RC-04'].frame(22).snapshot
    expect(serviceB.lapDistanceM).toBe(serviceA.lapDistanceM)
    expect(serviceB.lat).toBe(serviceA.lat)
    expect(serviceB.lon).toBe(serviceA.lon)
  })

  it('normalizes invalid elapsed time without introducing NaN values', () => {
    const negative = createRaceConMockFrame('RC-01', -10)
    const invalid = createRaceConMockFrame('RC-01', Number.NaN)
    expect(negative.elapsedSec).toBe(0)
    expect(invalid.elapsedSec).toBe(0)
    expect(Number.isFinite(invalid.snapshot.lat)).toBe(true)
    expect(Number.isFinite(invalid.snapshot.lon)).toBe(true)
  })
})

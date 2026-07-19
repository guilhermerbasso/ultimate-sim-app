import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import {
  ACC_GRAPHICS_PAGE_SIZE,
  ACC_PHYSICS_PAGE_SIZE,
  ACC_STATIC_PAGE_SIZE,
  accFlags,
  accSnapshotFromPages,
  decodeACCGraphicsPage,
  decodeACCPhysicsPage,
  decodeACCStaticPage
} from './acc'
import {
  AMS2_SHARED_MEMORY_PREFIX_SIZE,
  ams2SnapshotFromPage,
  coherentAMS2PagePair,
  decodeAMS2SharedMemoryPage
} from './ams2'

function fixture(name: string): Buffer {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url))
}

describe('ACC v1.8.12 binary layout', () => {
  it('decodes the pinned full-size pages and normalizes units from their authoritative offsets', () => {
    const physicsBuffer = fixture('acc-physics-v1.8.bin')
    const graphicsBuffer = fixture('acc-graphics-v1.8.bin')
    const staticBuffer = fixture('acc-static-v1.8.bin')
    expect(physicsBuffer).toHaveLength(ACC_PHYSICS_PAGE_SIZE)
    expect(graphicsBuffer).toHaveLength(ACC_GRAPHICS_PAGE_SIZE)
    expect(staticBuffer).toHaveLength(ACC_STATIC_PAGE_SIZE)

    const physics = decodeACCPhysicsPage(physicsBuffer)
    const graphics = decodeACCGraphicsPage(graphicsBuffer)
    const staticInfo = decodeACCStaticPage(staticBuffer)
    expect(physics).toMatchObject({
      packetId: 42,
      fuel: 35.5,
      rpms: 7200,
      tcInAction: 1,
      absInAction: 0
    })
    expect(graphics).toMatchObject({
      packetId: 42,
      session: 1,
      normalizedCarPosition: 0.5,
      rainIntensity: 2
    })
    expect(staticInfo).toMatchObject({
      smVersion: '1.8',
      acVersion: '2.0.0',
      carModel: 'Ferrari 296 GT3',
      track: 'Spa-Francorchamps',
      maxRpm: 8500,
      maxFuel: 120
    })

    const snapshot = accSnapshotFromPages(physics!, graphics!, staticInfo!, 1234)
    expect(snapshot).toMatchObject({
      timestamp: 1234,
      sessionKind: 'qualify',
      currentLap: 5,
      lapDistPct: 0.5,
      sessionTimeRemainingSec: 600,
      currentLapTimeSec: 90,
      lastLapTimeSec: 91,
      bestLapTimeSec: 90.5,
      precipitationPct: 0.4,
      isRaining: true,
      trackWetnessPct: undefined,
      airTempC: 24,
      trackTempC: 36
    })
    expect(snapshot?.tyres?.lf.pressureKpa).toBeCloseTo(172.369, 3)
    expect(accFlags({ ...graphics!, penalty: 11 }).disqualify).toBe(true)
    expect(accFlags({ ...graphics!, penalty: 12 }).disqualify).toBe(false)
  })

  it('fails closed for truncated pages and an unsupported shared-memory version', () => {
    expect(
      decodeACCPhysicsPage(fixture('acc-physics-v1.8.bin').subarray(0, ACC_PHYSICS_PAGE_SIZE - 1))
    ).toBeNull()
    expect(
      decodeACCGraphicsPage(fixture('acc-graphics-v1.8.bin').subarray(0, ACC_GRAPHICS_PAGE_SIZE - 1))
    ).toBeNull()
    expect(
      decodeACCStaticPage(fixture('acc-static-v1.8.bin').subarray(0, ACC_STATIC_PAGE_SIZE - 1))
    ).toBeNull()

    const unsupported = Buffer.from(fixture('acc-static-v1.8.bin'))
    Buffer.from('1.9\0', 'utf16le').copy(unsupported, 0)
    expect(decodeACCStaticPage(unsupported)).toBeNull()
  })
})

describe('AMS2 Project CARS 2 v13/v14 binary layout', () => {
  it('decodes the v14 prefix, participant stride, normalized fuel, and millisecond session clock', () => {
    const buffer = fixture('ams2-v14-prefix.bin')
    expect(buffer).toHaveLength(AMS2_SHARED_MEMORY_PREFIX_SIZE)
    const page = decodeAMS2SharedMemoryPage(buffer)
    expect(page).toMatchObject({
      version: 14,
      buildVersion: 12345,
      sessionState: 5,
      carName: 'Porsche 911 GT3 R',
      trackLocation: 'Spa-Francorchamps',
      trackVariation: '2022 GP',
      sequenceNumber: 10,
      participant: {
        currentLapDistance: 3500,
        racePosition: 2,
        lapsCompleted: 5,
        currentLap: 6
      }
    })

    const snapshot = ams2SnapshotFromPage(page!, 5678)
    expect(snapshot).toMatchObject({
      timestamp: 5678,
      sessionKind: 'race',
      speedKmh: 180,
      currentLap: 6,
      lapDistPct: 0.5,
      position: 2,
      fuelLiters: 50,
      fuelCapacityLiters: 100,
      sessionTimeRemainingSec: 900,
      lastLapTimeSec: 91,
      bestLapTimeSec: 90.5,
      currentLapTimeSec: 45,
      trackWetnessPct: undefined
    })
    expect(snapshot?.precipitationPct).toBeCloseTo(0.6, 6)
  })

  it('accepts the verified v13 prefix and rejects unknown versions, truncation, and torn sequence pairs', () => {
    const version14 = fixture('ams2-v14-prefix.bin')
    const version13 = Buffer.from(version14)
    version13.writeUInt32LE(13, 0)
    expect(decodeAMS2SharedMemoryPage(version13)?.version).toBe(13)

    const unsupported = Buffer.from(version14)
    unsupported.writeUInt32LE(12, 0)
    expect(decodeAMS2SharedMemoryPage(unsupported)).toBeNull()
    expect(
      decodeAMS2SharedMemoryPage(version14.subarray(0, AMS2_SHARED_MEMORY_PREFIX_SIZE - 1))
    ).toBeNull()

    const page = decodeAMS2SharedMemoryPage(version14)!
    expect(coherentAMS2PagePair(page, { ...page })).not.toBeNull()
    expect(coherentAMS2PagePair(page, { ...page, sequenceNumber: 11 })).toBeNull()
    expect(
      coherentAMS2PagePair(
        { ...page, sequenceNumber: 11 },
        { ...page, sequenceNumber: 11 }
      )
    ).toBeNull()
  })
})

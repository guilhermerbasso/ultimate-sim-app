import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { createACStructs } from './ac'
import { ACC_LAYOUT } from './acc'

// ---------------------------------------------------------------------------
// SYNTHETIC EVIDENCE, NOT A GAME CAPTURE.
//
// The buffers below are built from the CORRECTED layout with a distinct sentinel in
// every field, so a misaligned struct reads a neighbour's sentinel instead of its own.
// That proves the struct is self-consistent; it does NOT prove that a running Assetto
// Corsa writes this layout. The independent check for that is ACC_LAYOUT in ./acc.ts,
// which is pinned to the published Kunos SDK header (v1.8.12, see fixtures/README.md):
// ACC's SPageFile* structs ARE Assetto Corsa's, extended, so every field the two share
// must sit at the same byte offset. Five such fields are asserted below.
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url)
const koffi = require('koffi')

// koffi.struct() registers type names globally per process and throws on a duplicate,
// so build the production structs exactly once for the whole file.
const AC = createACStructs(koffi)

function offsets(struct: unknown, fields: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const field of fields) out[field] = koffi.offsetof(struct, field)
  return out
}

describe('AC graphics struct alignment vs the SDK-verified ACC layout', () => {
  // Every field ACSPageFileGraphic declares that ACC_LAYOUT.graphics also pins.
  const SHARED = [
    'packetId',
    'status',
    'session',
    'completedLaps',
    'position',
    'iCurrentTime',
    'iLastTime',
    'iBestTime',
    'sessionTimeLeft',
    'isInPit',
    'numberOfLaps',
    'normalizedCarPosition'
  ] as const

  it('places every shared field at the SAME offset ACC uses', () => {
    const actual = offsets(AC.graphics, SHARED)
    const expected = Object.fromEntries(SHARED.map((field) => [field, ACC_LAYOUT.graphics[field]]))
    expect(actual).toEqual(expected)
  })

  it('places normalizedCarPosition at 248 — the offset that proves replayTimeMultiplier exists', () => {
    // tyreCompound is wchar[33] = 66 bytes ending at 242, padded to 244. If nothing sat
    // at 244, normalizedCarPosition would be there instead of at ACC's 248.
    expect(koffi.offsetof(AC.graphics, 'tyreCompound')).toBe(176)
    expect(koffi.offsetof(AC.graphics, 'replayTimeMultiplier')).toBe(244)
    expect(koffi.offsetof(AC.graphics, 'normalizedCarPosition')).toBe(248)
    expect(ACC_LAYOUT.graphics.normalizedCarPosition).toBe(248)
  })

  it('keeps every field AFTER the correction aligned too', () => {
    expect(offsets(AC.graphics, ['activeCars', 'carCoordinates', 'carID', 'playerCarID'])).toEqual({
      activeCars: 252,
      carCoordinates: 256,
      carID: 976,
      playerCarID: 1216
    })
  })
})

describe('AC physics struct alignment vs the SDK-verified ACC layout', () => {
  const SHARED = [
    'packetId',
    'gas',
    'brake',
    'fuel',
    'gear',
    'rpms',
    'steerAngle',
    'speedKmh',
    'wheelsPressure',
    'tyreCoreTemperature',
    'airTemp',
    'roadTemp',
    'clutch'
  ] as const

  it('places every shared field at the SAME offset ACC uses', () => {
    const actual = offsets(AC.physics, SHARED)
    const expected = Object.fromEntries(SHARED.map((field) => [field, ACC_LAYOUT.physics[field]]))
    expect(actual).toEqual(expected)
  })

  it('reaches clutch at 364, which only holds if every array size in between is right', () => {
    // clutch is the LAST field: its offset is the running total of all 48 fields before
    // it, so a single wrong array length anywhere would move it.
    expect(koffi.offsetof(AC.physics, 'clutch')).toBe(364)
  })
})

describe('AC static struct alignment vs the SDK-verified ACC layout', () => {
  const SHARED = ['smVersion', 'acVersion', 'numCars', 'carModel', 'track', 'maxRpm', 'maxFuel'] as const

  it('places every shared field at the SAME offset ACC uses', () => {
    const actual = offsets(AC.staticInfo, SHARED)
    const expected = Object.fromEntries(SHARED.map((field) => [field, ACC_LAYOUT.staticInfo[field]]))
    expect(actual).toEqual(expected)
  })

  it('pads sectorCount to a 4-byte boundary after the three wchar[33] name fields', () => {
    // playerNick ends at 398, which is not 4-aligned; maxRpm at 412 only works if
    // sectorCount starts at 400.
    expect(koffi.offsetof(AC.staticInfo, 'playerNick')).toBe(332)
    expect(koffi.offsetof(AC.staticInfo, 'sectorCount')).toBe(400)
    expect(koffi.offsetof(AC.staticInfo, 'maxRpm')).toBe(412)
  })
})

describe('decoding a sentinel page through the production struct', () => {
  /**
   * Byte offsets of the CORRECTED Assetto Corsa `SPageFileGraphic`, written out
   * explicitly so the fixture does not depend on the struct it is testing. Derived from
   * `#pragma pack(4)` arithmetic and cross-checked against ACC_LAYOUT.graphics above.
   */
  const AC_GRAPHICS_OFFSETS = {
    packetId: 0,
    status: 4,
    session: 8,
    currentTime: 12,
    lastTime: 42,
    bestTime: 72,
    split: 102,
    completedLaps: 132,
    position: 136,
    iCurrentTime: 140,
    iLastTime: 144,
    iBestTime: 148,
    sessionTimeLeft: 152,
    distanceTraveled: 156,
    isInPit: 160,
    currentSectorIndex: 164,
    lastSectorTime: 168,
    numberOfLaps: 172,
    tyreCompound: 176,
    replayTimeMultiplier: 244,
    normalizedCarPosition: 248,
    activeCars: 252,
    carCoordinates: 256,
    carID: 976,
    playerCarID: 1216
  } as const

  // One distinct value per field. A misaligned struct reads a neighbour's sentinel, and
  // the mismatch names exactly which field slipped.
  const SENTINELS = {
    packetId: 1001,
    status: 2,
    session: 3,
    completedLaps: 17,
    position: 5,
    iCurrentTime: 91_234,
    iLastTime: 92_345,
    iBestTime: 90_123,
    sessionTimeLeft: 1234.5,
    distanceTraveled: 4321.5,
    isInPit: 1,
    currentSectorIndex: 2,
    lastSectorTime: 31_500,
    numberOfLaps: 25,
    // 1.0 is what Assetto Corsa actually publishes here while the sim is running at
    // normal speed — which is precisely why the misalignment was invisible.
    replayTimeMultiplier: 1,
    normalizedCarPosition: 0.375,
    activeCars: 19,
    playerCarID: 7
  } as const

  function buildGraphicsPage(): Buffer {
    const page = Buffer.alloc(4096)
    const at = AC_GRAPHICS_OFFSETS
    page.writeInt32LE(SENTINELS.packetId, at.packetId)
    page.writeInt32LE(SENTINELS.status, at.status)
    page.writeInt32LE(SENTINELS.session, at.session)
    page.write('01:23.456', at.currentTime, 'utf16le')
    page.write('01:22.111', at.lastTime, 'utf16le')
    page.write('01:21.999', at.bestTime, 'utf16le')
    page.write('+0.321', at.split, 'utf16le')
    page.writeInt32LE(SENTINELS.completedLaps, at.completedLaps)
    page.writeInt32LE(SENTINELS.position, at.position)
    page.writeInt32LE(SENTINELS.iCurrentTime, at.iCurrentTime)
    page.writeInt32LE(SENTINELS.iLastTime, at.iLastTime)
    page.writeInt32LE(SENTINELS.iBestTime, at.iBestTime)
    page.writeFloatLE(SENTINELS.sessionTimeLeft, at.sessionTimeLeft)
    page.writeFloatLE(SENTINELS.distanceTraveled, at.distanceTraveled)
    page.writeInt32LE(SENTINELS.isInPit, at.isInPit)
    page.writeInt32LE(SENTINELS.currentSectorIndex, at.currentSectorIndex)
    page.writeInt32LE(SENTINELS.lastSectorTime, at.lastSectorTime)
    page.writeInt32LE(SENTINELS.numberOfLaps, at.numberOfLaps)
    page.write('street_semislick', at.tyreCompound, 'utf16le')
    page.writeFloatLE(SENTINELS.replayTimeMultiplier, at.replayTimeMultiplier)
    page.writeFloatLE(SENTINELS.normalizedCarPosition, at.normalizedCarPosition)
    page.writeInt32LE(SENTINELS.activeCars, at.activeCars)
    page.writeInt32LE(SENTINELS.playerCarID, at.playerCarID)
    return page
  }

  it('agrees with the production struct on every offset', () => {
    for (const [field, offset] of Object.entries(AC_GRAPHICS_OFFSETS)) {
      expect(koffi.offsetof(AC.graphics, field), `${field} offset`).toBe(offset)
    }
  })

  it('reads every scalar field back as its own sentinel', () => {
    const decoded = koffi.decode(buildGraphicsPage(), AC.graphics)

    expect(decoded.packetId).toBe(SENTINELS.packetId)
    expect(decoded.completedLaps).toBe(SENTINELS.completedLaps)
    expect(decoded.position).toBe(SENTINELS.position)
    expect(decoded.iCurrentTime).toBe(SENTINELS.iCurrentTime)
    expect(decoded.iLastTime).toBe(SENTINELS.iLastTime)
    expect(decoded.iBestTime).toBe(SENTINELS.iBestTime)
    expect(decoded.sessionTimeLeft).toBeCloseTo(SENTINELS.sessionTimeLeft, 3)
    expect(decoded.isInPit).toBe(SENTINELS.isInPit)
    expect(decoded.numberOfLaps).toBe(SENTINELS.numberOfLaps)
    expect(decoded.tyreCompound).toBe('street_semislick')
    expect(decoded.activeCars).toBe(SENTINELS.activeCars)
    expect(decoded.playerCarID).toBe(SENTINELS.playerCarID)
  })

  it('reads lapDistPct from normalizedCarPosition, NOT from the replay multiplier next door', () => {
    const decoded = koffi.decode(buildGraphicsPage(), AC.graphics)

    // The whole defect in one assertion: with the field missing, normalizedCarPosition
    // landed on replayTimeMultiplier, which is 1.0 the entire time the sim is running —
    // so lapDistPct was pinned to 1.0 and every AC car sat on the start/finish line.
    expect(decoded.normalizedCarPosition).toBeCloseTo(SENTINELS.normalizedCarPosition, 5)
    expect(decoded.normalizedCarPosition).not.toBeCloseTo(SENTINELS.replayTimeMultiplier, 5)
  })

  it('surfaces the corrected lap distance through the provider snapshot', async () => {
    const { ACProvider } = await import('./ac')
    const provider = new ACProvider()
    const graphics = koffi.decode(buildGraphicsPage(), AC.graphics)
    // Stand in for the Windows mappings so poll() runs its real mapping code.
    Object.assign(provider as unknown as Record<string, unknown>, {
      physics: { view: {}, close: () => undefined },
      graphics: { view: graphics, close: () => undefined },
      staticInfo: { view: { smVersion: '1.7' }, close: () => undefined }
    })

    const snapshot = provider.poll()
    expect(snapshot?.lapDistPct).toBeCloseTo(SENTINELS.normalizedCarPosition, 5)
    expect(snapshot?.lapDistPct).not.toBe(1)
    expect(snapshot?.completedLaps).toBe(SENTINELS.completedLaps)
    expect(snapshot?.position).toBe(SENTINELS.position)
  })
})

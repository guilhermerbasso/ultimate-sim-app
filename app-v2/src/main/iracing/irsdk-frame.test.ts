import { describe, expect, it } from 'vitest'
import {
  IRSDK_HEADER_SIZE,
  IRSDK_VAR_TYPES,
  decodeVarValue,
  isRangeWithin,
  pickLatestVarBuffer,
  plausibleMapSize,
  readConsistentVarFrame,
  validateHeaderBounds,
  varValueByteLength,
  type IrsdkFrameSource,
  type IrsdkHeaderLike,
  type IrsdkNamedVarHeader
} from './irsdk-frame'
import { IRacingMemoryMap } from './irsdk-mmf'

// ---------------------------------------------------------------------------
// Synthetic irsdk memory map.
//
// SYNTHETIC EVIDENCE, NOT A REAL CAPTURE: the layout follows irsdk_defines.h
// (header 112 B, varHeader 144 B, numBuf telemetry buffers of bufLen bytes) but the
// values are fabricated so a torn read can be forced deterministically. It cannot
// prove iRacing's real offsets; it proves the READER's frame-consistency contract.
// ---------------------------------------------------------------------------

const BUF_LEN = 32
const NUM_BUF = 4
const VAR_HEADER_OFFSET = IRSDK_HEADER_SIZE
const NUM_VARS = 2
const FIRST_BUF_OFFSET = VAR_HEADER_OFFSET + NUM_VARS * 144
const MAP_SIZE = FIRST_BUF_OFFSET + NUM_BUF * BUF_LEN

const VAR_HEADERS: IrsdkNamedVarHeader[] = [
  { name: 'Speed', type: IRSDK_VAR_TYPES.float, offset: 0, count: 1 },
  { name: 'Gear', type: IRSDK_VAR_TYPES.int, offset: 4, count: 1 }
]

function bufOffsetFor(index: number): number {
  return FIRST_BUF_OFFSET + index * BUF_LEN
}

function header(overrides: Partial<IrsdkHeaderLike> & { status?: number } = {}): IrsdkHeaderLike & { status: number } {
  return {
    status: 1,
    sessionInfoLen: 0,
    sessionInfoOffset: 0,
    numVars: NUM_VARS,
    varHeaderOffset: VAR_HEADER_OFFSET,
    numBuf: NUM_BUF,
    bufLen: BUF_LEN,
    curBuf: 0,
    varBuf: [
      { tickCount: 1, bufOffset: bufOffsetFor(0) },
      { tickCount: 2, bufOffset: bufOffsetFor(1) },
      { tickCount: 3, bufOffset: bufOffsetFor(2) },
      { tickCount: 4, bufOffset: bufOffsetFor(3) }
    ],
    ...overrides
  }
}

function frameBuffer(speed: number, gear: number): Buffer {
  const buffer = Buffer.alloc(BUF_LEN)
  buffer.writeFloatLE(speed, 0)
  buffer.writeInt32LE(gear, 4)
  return buffer
}

/**
 * A frame source whose sim keeps writing. `tearOnAttempts` lists the 1-based copy
 * attempts during which the sim bumps the selected buffer's tick count *after* we
 * copied it — exactly the race that produces a half-old/half-new sample.
 */
function tearingSource(options: {
  buffers: Buffer[]
  ticks: number[]
  curBuf?: number
  tearOnAttempts?: number[]
  mapSize?: number | null
}): IrsdkFrameSource & { copies: Array<{ bufOffset: number; bufLen: number }> } {
  const ticks = [...options.ticks]
  const tearOn = new Set(options.tearOnAttempts ?? [])
  let attempt = 0
  const copies: Array<{ bufOffset: number; bufLen: number }> = []
  return {
    copies,
    readHeader(): IrsdkHeaderLike {
      return header({
        curBuf: options.curBuf ?? 0,
        varBuf: ticks.map((tickCount, index) => ({ tickCount, bufOffset: bufOffsetFor(index) }))
      })
    },
    copyVarBuffer(bufOffset: number, bufLen: number): Buffer | null {
      attempt += 1
      copies.push({ bufOffset, bufLen })
      const index = (bufOffset - FIRST_BUF_OFFSET) / BUF_LEN
      const buffer = options.buffers[index]
      if (!buffer) return null
      const copy = Buffer.from(buffer)
      // The sim finishes writing the NEXT sample into the same slot while we copy it:
      // the tick count we re-read afterwards no longer matches the one we started from.
      if (tearOn.has(attempt)) ticks[index] += 1
      return copy
    },
    mapSize: () => (options.mapSize === undefined ? MAP_SIZE : options.mapSize)
  }
}

function memoryMapWith(source: IrsdkFrameSource): IRacingMemoryMap {
  return new IRacingMemoryMap({
    frameSource: source,
    readVarHeaders: () => VAR_HEADERS,
    readSessionInfoYaml: () => ''
  })
}

describe('irsdk frame integrity — torn frames are never published', () => {
  it('rejects the sample when the sim rewrites the buffer during every copy attempt', () => {
    const source = tearingSource({
      buffers: [frameBuffer(10, 1), frameBuffer(20, 2), frameBuffer(30, 3), frameBuffer(40, 4)],
      ticks: [1, 2, 3, 4],
      tearOnAttempts: [1, 2, 3, 4]
    })
    const mmf = memoryMapWith(source)

    expect(mmf.read()).toBeNull()
    expect(mmf.frameHealth().lastFailure).toBe('torn')
    expect(mmf.frameHealth().tornFrames).toBe(1)
  })

  it('retries and publishes the first copy whose tick count held still', () => {
    const source = tearingSource({
      buffers: [frameBuffer(10, 1), frameBuffer(20, 2), frameBuffer(30, 3), frameBuffer(40, 4)],
      ticks: [1, 2, 3, 4],
      tearOnAttempts: [1]
    })
    const mmf = memoryMapWith(source)

    const read = mmf.read()
    expect(read).not.toBeNull()
    expect(read?.frame.attempts).toBe(2)
    expect(mmf.frameHealth().tornFrames).toBe(0)
    expect(read?.values.Gear).toBe(4)
  })

  it('copies the HIGHEST tick buffer, never the curBuf the sim is writing into', () => {
    // curBuf = 1 is mid-write and holds a stale sample; varBuf[3] has the newest tick.
    const source = tearingSource({
      buffers: [frameBuffer(10, 1), frameBuffer(999, 99), frameBuffer(30, 3), frameBuffer(40, 4)],
      ticks: [1, 2, 3, 4],
      curBuf: 1
    })
    const mmf = memoryMapWith(source)

    const read = mmf.read()
    expect(read?.frame.bufferIndex).toBe(3)
    expect(read?.values.Gear).toBe(4)
    expect(read?.values.Speed).toBeCloseTo(40, 5)
    expect(source.copies).toEqual([{ bufOffset: bufOffsetFor(3), bufLen: BUF_LEN }])
  })
})

describe('irsdk frame integrity — reads stay inside the mapped view', () => {
  it('refuses a header whose telemetry buffer runs past the end of the mapping', () => {
    const source: IrsdkFrameSource = {
      readHeader: () =>
        header({
          varBuf: [
            { tickCount: 7, bufOffset: MAP_SIZE - 4 },
            { tickCount: 0, bufOffset: 0 },
            { tickCount: 0, bufOffset: 0 },
            { tickCount: 0, bufOffset: 0 }
          ]
        }),
      copyVarBuffer: () => {
        throw new Error('copyVarBuffer must not be called for an out-of-bounds header')
      },
      mapSize: () => MAP_SIZE
    }
    const mmf = memoryMapWith(source)

    expect(mmf.read()).toBeNull()
    expect(mmf.frameHealth().lastFailure).toBe('invalid-bounds')
  })

  it('refuses a header whose var headers run past the end of the mapping', () => {
    const source: IrsdkFrameSource = {
      readHeader: () => header({ numVars: 4000 }),
      copyVarBuffer: () => {
        throw new Error('copyVarBuffer must not be called for an out-of-bounds header')
      },
      mapSize: () => MAP_SIZE
    }
    expect(memoryMapWith(source).read()).toBeNull()
  })

  it('reports a var whose declared range overflows the buffer as unavailable, never as 0', () => {
    const overflowing: IrsdkNamedVarHeader = { name: 'Overflow', type: IRSDK_VAR_TYPES.float, offset: BUF_LEN - 2, count: 1 }
    expect(decodeVarValue(Buffer.alloc(BUF_LEN), overflowing)).toBeUndefined()

    const source = tearingSource({
      buffers: [frameBuffer(10, 1), frameBuffer(20, 2), frameBuffer(30, 3), frameBuffer(40, 4)],
      ticks: [1, 2, 3, 4]
    })
    const mmf = new IRacingMemoryMap({
      frameSource: source,
      readVarHeaders: () => [...VAR_HEADERS, overflowing],
      readSessionInfoYaml: () => ''
    })
    const read = mmf.read()
    expect(read).not.toBeNull()
    expect(Object.keys(read?.values ?? {})).toEqual(['Speed', 'Gear'])
    expect(read?.values).not.toHaveProperty('Overflow')
  })
})

describe('pickLatestVarBuffer', () => {
  it('returns the entry with the highest tick count', () => {
    expect(pickLatestVarBuffer(header({ curBuf: 0 }))).toEqual({ index: 3, bufOffset: bufOffsetFor(3), tickCount: 4 })
  })

  it('ignores slots past numBuf', () => {
    expect(pickLatestVarBuffer(header({ numBuf: 2 }))?.index).toBe(1)
  })

  it('ignores an uninitialised slot whose offset sits inside the header', () => {
    const picked = pickLatestVarBuffer(
      header({
        varBuf: [
          { tickCount: 99, bufOffset: 0 },
          { tickCount: 5, bufOffset: bufOffsetFor(1) },
          { tickCount: 0, bufOffset: 0 },
          { tickCount: 0, bufOffset: 0 }
        ]
      })
    )
    expect(picked).toEqual({ index: 1, bufOffset: bufOffsetFor(1), tickCount: 5 })
  })

  it('returns null when nothing is initialised', () => {
    expect(pickLatestVarBuffer(header({ varBuf: [{ tickCount: 0, bufOffset: 0 }] }))).toBeNull()
  })
})

describe('validateHeaderBounds', () => {
  it('accepts a well-formed header against a known map size', () => {
    expect(validateHeaderBounds(header(), MAP_SIZE)).toEqual({ ok: true })
  })

  it('accepts a well-formed header when the map size is unknown', () => {
    expect(validateHeaderBounds(header(), null)).toEqual({ ok: true })
  })

  it.each([
    ['numVars', { numVars: 10_000 }],
    ['varHeaderOffset', { varHeaderOffset: 8 }],
    ['numBuf', { numBuf: 9 }],
    ['bufLen', { bufLen: 0 }],
    ['sessionInfoLen', { sessionInfoLen: 64 * 1024 * 1024 }]
  ])('rejects a corrupt %s', (_field, overrides) => {
    expect(validateHeaderBounds(header(overrides), MAP_SIZE).ok).toBe(false)
  })

  it('rejects session info that runs past the mapping', () => {
    expect(validateHeaderBounds(header({ sessionInfoOffset: MAP_SIZE - 4, sessionInfoLen: 1024 }), MAP_SIZE).ok).toBe(false)
  })
})

describe('bounds helpers', () => {
  it('varValueByteLength multiplies item size by count and reports 0 for unknown types', () => {
    expect(varValueByteLength(IRSDK_VAR_TYPES.float, 64)).toBe(256)
    expect(varValueByteLength(IRSDK_VAR_TYPES.double, 2)).toBe(16)
    expect(varValueByteLength(IRSDK_VAR_TYPES.bool, 64)).toBe(64)
    expect(varValueByteLength(99, 4)).toBe(0)
    expect(varValueByteLength(IRSDK_VAR_TYPES.int, -1)).toBe(0)
  })

  it('isRangeWithin rejects negatives and overflow but allows an unknown limit', () => {
    expect(isRangeWithin(0, 10, 10)).toBe(true)
    expect(isRangeWithin(1, 10, 10)).toBe(false)
    expect(isRangeWithin(-1, 4, 100)).toBe(false)
    expect(isRangeWithin(10, 10, null)).toBe(true)
  })

  it('plausibleMapSize discards implausible VirtualQuery results', () => {
    expect(plausibleMapSize(2 * 1024 * 1024)).toBe(2 * 1024 * 1024)
    expect(plausibleMapSize(4096)).toBeNull()
    expect(plausibleMapSize(Number.NaN)).toBeNull()
    expect(plausibleMapSize(undefined)).toBeNull()
  })
})

describe('decodeVarValue', () => {
  it('decodes scalars and arrays little-endian', () => {
    const buffer = Buffer.alloc(16)
    buffer.writeFloatLE(1.5, 0)
    buffer.writeFloatLE(2.5, 4)
    expect(decodeVarValue(buffer, { type: IRSDK_VAR_TYPES.float, offset: 0, count: 2 })).toEqual([1.5, 2.5])
    expect(decodeVarValue(buffer, { type: IRSDK_VAR_TYPES.float, offset: 4, count: 1 })).toBeCloseTo(2.5, 5)
  })

  it('decodes a -1 int without clamping — reverse gear and idx sentinels must survive', () => {
    const buffer = Buffer.alloc(8)
    buffer.writeInt32LE(-1, 0)
    expect(decodeVarValue(buffer, { type: IRSDK_VAR_TYPES.int, offset: 0, count: 1 })).toBe(-1)
  })

  it('decodes bitfields as signed int32 and bools per byte', () => {
    const buffer = Buffer.alloc(8)
    buffer.writeInt32LE(0x0100, 0)
    buffer[4] = 1
    expect(decodeVarValue(buffer, { type: IRSDK_VAR_TYPES.bitfield, offset: 0, count: 1 })).toBe(0x0100)
    expect(decodeVarValue(buffer, { type: IRSDK_VAR_TYPES.bool, offset: 4, count: 1 })).toBe(true)
  })
})

describe('readConsistentVarFrame failure reporting', () => {
  it('reports no-header when the header cannot be decoded', () => {
    const outcome = readConsistentVarFrame({ readHeader: () => null, copyVarBuffer: () => null, mapSize: () => null })
    expect(outcome).toEqual({ ok: false, reason: 'no-header', attempts: 1 })
  })

  it('reports copy-failed when the copy comes back short', () => {
    const outcome = readConsistentVarFrame({
      readHeader: () => header(),
      copyVarBuffer: () => Buffer.alloc(BUF_LEN - 1),
      mapSize: () => MAP_SIZE
    })
    expect(outcome).toEqual({ ok: false, reason: 'copy-failed', attempts: 1 })
  })
})

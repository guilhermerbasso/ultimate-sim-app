import { describe, expect, it } from 'vitest'
import type { PortInfo } from './ipc'
import {
  buildSimXEnrollment,
  isEnrollablePort,
  portMatchesEnrollment,
  resolveSimXAutoConnect,
  type SimXEnrollment
} from './simx-enrollment'

const port = (over: Partial<PortInfo> & { path: string }): PortInfo => ({
  isSimX: false,
  ...over
})

const enrolled = (over: Partial<SimXEnrollment> = {}): SimXEnrollment => ({
  version: 1,
  vendorId: '2341',
  productId: '8036',
  enrolledAt: '2026-01-01T00:00:00.000Z',
  ...over
})

describe('buildSimXEnrollment', () => {
  it('refuses to enrol a port with no stable USB identity', () => {
    expect(buildSimXEnrollment(port({ path: 'COM5' }))).toBeNull()
    expect(buildSimXEnrollment(port({ path: 'COM5', vendorId: '2341' }))).toBeNull()
    expect(buildSimXEnrollment(port({ path: 'COM5', productId: '8036' }))).toBeNull()
  })

  it('normalizes USB ids and keeps the COM path as diagnostic data only', () => {
    const record = buildSimXEnrollment(
      port({
        path: 'COM18',
        vendorId: '0x2341',
        productId: '8036',
        serialNumber: 'HIDPC',
        friendlyName: 'SIM-X Button Box (COM18)'
      }),
      '2026-02-02T00:00:00.000Z'
    )
    expect(record).toEqual({
      version: 1,
      vendorId: '2341',
      productId: '8036',
      serialNumber: 'HIDPC',
      label: 'SIM-X Button Box (COM18)',
      lastKnownPath: 'COM18',
      enrolledAt: '2026-02-02T00:00:00.000Z'
    })
  })
})

describe('isEnrollablePort', () => {
  it('requires both USB ids', () => {
    expect(isEnrollablePort(port({ path: 'COM3', vendorId: '2341', productId: '8036' }))).toBe(true)
    expect(isEnrollablePort(port({ path: 'COM3', vendorId: '2341' }))).toBe(false)
    expect(isEnrollablePort(null)).toBe(false)
  })
})

describe('portMatchesEnrollment', () => {
  it('matches on vendor + product when no serial was recorded', () => {
    expect(portMatchesEnrollment(enrolled(), port({ path: 'COM7', vendorId: '2341', productId: '8036' }))).toBe(true)
  })

  it('rejects a different product id from the same vendor', () => {
    expect(portMatchesEnrollment(enrolled(), port({ path: 'COM7', vendorId: '2341', productId: '0043' }))).toBe(false)
  })

  it('enforces a recorded serial number strictly', () => {
    const record = enrolled({ serialNumber: 'BOX-A' })
    expect(
      portMatchesEnrollment(record, port({ path: 'COM7', vendorId: '2341', productId: '8036', serialNumber: 'BOX-A' }))
    ).toBe(true)
    expect(
      portMatchesEnrollment(record, port({ path: 'COM7', vendorId: '2341', productId: '8036', serialNumber: 'BOX-B' }))
    ).toBe(false)
    // A board that reports no serial can NEVER satisfy an enrolment that has one.
    expect(portMatchesEnrollment(record, port({ path: 'COM7', vendorId: '2341', productId: '8036' }))).toBe(false)
  })
})

describe('resolveSimXAutoConnect — fail-closed identity gate', () => {
  it('never auto-connects when nothing is enrolled, even for a flagged SIM-X port', () => {
    const decision = resolveSimXAutoConnect(
      [port({ path: 'COM5', isSimX: true, vendorId: '2341', productId: '8036' })],
      null
    )
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.reason).toBe('not-enrolled')
    expect(decision.candidatePaths).toEqual(['COM5'])
    expect(decision.message).toMatch(/quarantine/i)
  })

  it('never auto-connects an unrelated Arduino/Adafruit/SparkFun board on vendor id alone', () => {
    // 2341 = Arduino, 239a = Adafruit, 1b4f = SparkFun. All previously matched
    // the vendor-wide "isSimX" heuristic and could be opened, reset and written to.
    for (const vendorId of ['2341', '239a', '1b4f', '2a03']) {
      const decision = resolveSimXAutoConnect(
        [port({ path: 'COM9', isSimX: true, vendorId, productId: 'ffff' })],
        null
      )
      expect(decision.allowed).toBe(false)
    }
  })

  it('never falls back to the last COM path', () => {
    // The enrolled board is gone; another device now sits on the remembered path.
    const decision = resolveSimXAutoConnect(
      [port({ path: 'COM18', isSimX: true, vendorId: '239a', productId: '800c' })],
      enrolled({ lastKnownPath: 'COM18' })
    )
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.reason).toBe('enrolled-board-absent')
  })

  it('refuses an enrolment that lacks USB ids instead of falling back to its path', () => {
    const decision = resolveSimXAutoConnect(
      [port({ path: 'COM4', isSimX: true })],
      { version: 1, vendorId: '', productId: '', lastKnownPath: 'COM4', enrolledAt: 'x' } as SimXEnrollment
    )
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.reason).toBe('enrollment-identity-incomplete')
  })

  it('refuses when two boards share the enrolled identity and no serial disambiguates them', () => {
    const decision = resolveSimXAutoConnect(
      [
        port({ path: 'COM3', vendorId: '2341', productId: '8036' }),
        port({ path: 'COM7', vendorId: '2341', productId: '8036' })
      ],
      enrolled()
    )
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.reason).toBe('ambiguous-identity')
    expect(decision.candidatePaths).toEqual(['COM3', 'COM7'])
  })

  it('allows exactly the enrolled board, wherever Windows re-enumerated it', () => {
    const decision = resolveSimXAutoConnect(
      [
        port({ path: 'COM1', vendorId: '239a', productId: '800c' }),
        port({ path: 'COM21', vendorId: '2341', productId: '8036', serialNumber: 'BOX-A' })
      ],
      enrolled({ serialNumber: 'BOX-A', lastKnownPath: 'COM18' })
    )
    expect(decision).toEqual({ allowed: true, path: 'COM21' })
  })

  it('disambiguates two identical boards by serial number', () => {
    const decision = resolveSimXAutoConnect(
      [
        port({ path: 'COM3', vendorId: '2341', productId: '8036', serialNumber: 'BOX-A' }),
        port({ path: 'COM7', vendorId: '2341', productId: '8036', serialNumber: 'BOX-B' })
      ],
      enrolled({ serialNumber: 'BOX-B' })
    )
    expect(decision).toEqual({ allowed: true, path: 'COM7' })
  })

  it('blocks on an empty port list', () => {
    const decision = resolveSimXAutoConnect([], enrolled())
    expect(decision.allowed).toBe(false)
    if (decision.allowed) return
    expect(decision.reason).toBe('enrolled-board-absent')
    expect(decision.candidatePaths).toEqual([])
  })
})

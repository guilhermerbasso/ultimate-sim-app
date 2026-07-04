import { describe, expect, it } from 'vitest'
import {
  resolveGenericDevicePort,
  serialIdentityMatches,
  sharesUsbVendorProduct,
  type GenericDeviceIdentity
} from './generic-autostart'
import type { PortInfo } from './ipc'

// Build a PortInfo with the USB identity fields we care about.
const port = (
  path: string,
  ids: { vendorId?: string; productId?: string; serialNumber?: string } = {}
): PortInfo => ({ path, ...ids })

const cfg = (over: Partial<GenericDeviceIdentity> & { path: string }): GenericDeviceIdentity => ({
  ...over
})

describe('resolveGenericDevicePort', () => {
  it('returns null when there are no ports', () => {
    expect(resolveGenericDevicePort(cfg({ path: 'COM15' }), [])).toBeNull()
  })

  it('returns the stored path for an identity-less device only when that port is present', () => {
    expect(resolveGenericDevicePort(cfg({ path: 'COM15' }), [port('COM15')])).toBe('COM15')
    // Absent → null so the controller logs "no candidate yet" and retries instead
    // of firing a guaranteed "File not found" connect.
    expect(resolveGenericDevicePort(cfg({ path: 'COM15' }), [port('COM3')])).toBeNull()
  })

  it('follows a serial-bearing device to a new COM via its USB identity', () => {
    const config = cfg({
      path: 'COM15',
      vendorId: '2e8a',
      productId: '000a',
      serialNumber: 'IFLAG-001'
    })
    // The iFlag re-enumerated on COM22 after a Windows COM reassignment.
    const ports = [port('COM3'), port('COM22', { vendorId: '2e8a', productId: '000a', serialNumber: 'IFLAG-001' })]
    expect(resolveGenericDevicePort(config, ports)).toBe('COM22')
  })

  it('does not match a different serial of the same model, and returns null when the stored path is gone', () => {
    const config = cfg({ path: 'COM15', vendorId: '2e8a', productId: '000a', serialNumber: 'IFLAG-001' })
    const ports = [port('COM22', { vendorId: '2e8a', productId: '000a', serialNumber: 'OTHER-999' })]
    expect(resolveGenericDevicePort(config, ports)).toBeNull()
  })

  it('follows a serial-less device to a new COM only when exactly one same-model port is present', () => {
    const config = cfg({ path: 'COM15', vendorId: '1a86', productId: '7523' })
    const one = [port('COM9', { vendorId: '1a86', productId: '7523' })]
    expect(resolveGenericDevicePort(config, one)).toBe('COM9')
  })

  it('does NOT guess a serial-less device when two identical boards are present', () => {
    const config = cfg({ path: 'COM15', vendorId: '1a86', productId: '7523' })
    const twins = [
      port('COM9', { vendorId: '1a86', productId: '7523' }),
      port('COM10', { vendorId: '1a86', productId: '7523' })
    ]
    // Ambiguous + stored path COM15 absent → null (don't bind the wrong board).
    expect(resolveGenericDevicePort(config, twins)).toBeNull()
  })

  it('keeps a serial-less device on its exact stored path even among identical twins', () => {
    const config = cfg({ path: 'COM9', vendorId: '1a86', productId: '7523' })
    const twins = [
      port('COM9', { vendorId: '1a86', productId: '7523' }),
      port('COM10', { vendorId: '1a86', productId: '7523' })
    ]
    expect(resolveGenericDevicePort(config, twins)).toBe('COM9')
  })
})

describe('serialIdentityMatches', () => {
  it('matches serial-bearing devices by serial across COM ports', () => {
    expect(
      serialIdentityMatches(
        { vendorId: '2e8a', productId: '000a', serialNumber: 'A', path: 'COM15' },
        { vendorId: '2e8a', productId: '000a', serialNumber: 'A', path: 'COM22' }
      )
    ).toBe(true)
  })

  it('requires path equality for serial-less identical models', () => {
    const a = { vendorId: '1a86', productId: '7523', path: 'COM9' }
    expect(serialIdentityMatches(a, { ...a, path: 'COM9' })).toBe(true)
    expect(serialIdentityMatches(a, { vendorId: '1a86', productId: '7523', path: 'COM10' })).toBe(false)
  })

  it('never matches identity-less records', () => {
    expect(serialIdentityMatches({ path: 'COM9' }, { path: 'COM9' })).toBe(false)
  })
})

describe('sharesUsbVendorProduct', () => {
  it('is true for same VID+PID regardless of serial/path', () => {
    expect(
      sharesUsbVendorProduct({ vendorId: '1a86', productId: '7523' }, { vendorId: '1a86', productId: '7523' })
    ).toBe(true)
  })
  it('is false when ids are missing or differ', () => {
    expect(sharesUsbVendorProduct({ vendorId: '1a86' }, { vendorId: '1a86' })).toBe(false)
    expect(
      sharesUsbVendorProduct({ vendorId: '1a86', productId: '7523' }, { vendorId: '2e8a', productId: '000a' })
    ).toBe(false)
  })
})

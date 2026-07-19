import { describe, expect, it } from 'vitest'
import { resolveConnectedSerialIdentityMigration } from './identity-migration'

const saved = {
  id: 'iflag',
  path: 'COM7',
  vendorId: '2341',
  productId: '0043',
  serialNumber: 'IFLAG-001'
}

describe('connected serial identity migration', () => {
  it('setup persists identity from the actual connected port, not the requested path', () => {
    const result = resolveConnectedSerialIdentityMigration({
      deviceId: 'setup-device',
      live: [{ id: 'setup-device', path: 'COM11', connected: true }],
      ports: [{
        path: 'COM11',
        vendorId: '0x2341',
        productId: '0043',
        serialNumber: 'IFLAG-001'
      }],
      allowUnboundMigration: true
    })

    expect(result.state).toBe('verified')
    expect(result.record).toEqual({
      id: 'setup-device',
      path: 'COM11',
      vendorId: '2341',
      productId: '0043',
      serialNumber: 'IFLAG-001'
    })
  })

  it('manual reconnect migrates a stable device across ports after re-enumeration', () => {
    const result = resolveConnectedSerialIdentityMigration({
      deviceId: 'iflag',
      saved,
      live: [{ id: 'iflag', path: 'COM15', connected: true }],
      ports: [{
        path: 'COM15',
        vendorId: '2341',
        productId: '0043',
        serialNumber: 'IFLAG-001'
      }],
      allowUnboundMigration: true
    })

    expect(result.state).toBe('verified')
    expect(result.record?.path).toBe('COM15')
  })

  it('rejects a device swap instead of overwriting saved identity or path', () => {
    const result = resolveConnectedSerialIdentityMigration({
      deviceId: 'iflag',
      saved,
      live: [{ id: 'iflag', path: 'COM7', connected: true }],
      ports: [{
        path: 'COM7',
        vendorId: '9999',
        productId: '9999',
        serialNumber: 'IMPOSTOR'
      }],
      allowUnboundMigration: true
    })

    expect(result.state).toBe('mismatch')
    expect(result.record).toBeNull()
  })

  it('keeps missing identity explicitly unverified while recording only the actual live path', () => {
    const setup = resolveConnectedSerialIdentityMigration({
      deviceId: 'serial-less',
      live: [{ id: 'serial-less', path: 'COM9', connected: true }],
      ports: [{ path: 'COM9', vendorId: '1a86', productId: '7523' }],
      allowUnboundMigration: true
    })
    const reconnect = resolveConnectedSerialIdentityMigration({
      deviceId: 'iflag',
      saved,
      live: [{ id: 'iflag', path: 'COM9', connected: true }],
      ports: [{ path: 'COM9', vendorId: '2341', productId: '0043' }],
      allowUnboundMigration: true
    })

    expect(setup.state).toBe('unverified')
    expect(setup.record?.path).toBe('COM9')
    expect(setup.record?.serialNumber).toBeUndefined()
    expect(reconnect.state).toBe('unverified')
    expect(reconnect.record).toBeNull()
    expect(reconnect.message).toContain('not overwritten')
  })

  it('does not silently migrate a legacy identity during automatic reconnect', () => {
    const result = resolveConnectedSerialIdentityMigration({
      deviceId: 'legacy',
      saved: { id: 'legacy', path: 'COM7' },
      live: [{ id: 'legacy', path: 'COM7', connected: true }],
      ports: [{
        path: 'COM7',
        vendorId: '2341',
        productId: '0043',
        serialNumber: 'OBSERVED-ONLY'
      }],
      allowUnboundMigration: false
    })

    expect(result.state).toBe('unverified')
    expect(result.record).toBeNull()
    expect(result.message).toContain('explicit setup or manual reconnect')
  })
})

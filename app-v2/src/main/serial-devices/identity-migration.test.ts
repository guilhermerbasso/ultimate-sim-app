import { describe, expect, it } from 'vitest'
import {
  findSavedSerialBinding,
  profileCanMigrateWithSerialIdentity,
  resolveConnectedSerialIdentityMigration
} from './identity-migration'

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

  it('rejects a VID/PID-only saved device when an impostor occupies the path', () => {
    const result = resolveConnectedSerialIdentityMigration({
      deviceId: 'partial',
      saved: {
        id: 'partial',
        path: 'COM7',
        vendorId: '2341',
        productId: '0043'
      },
      live: [{ id: 'partial', path: 'COM7', connected: true }],
      ports: [{
        path: 'COM7',
        vendorId: '2341',
        productId: '9999',
        serialNumber: 'IMPOSTOR'
      }],
      allowUnboundMigration: true
    })

    expect(result.state).toBe('mismatch')
    expect(result.record).toBeNull()
    expect(result.message).toContain('PID')
  })

  it('rejects a serial-only saved identity when the observed serial differs', () => {
    const result = resolveConnectedSerialIdentityMigration({
      deviceId: 'serial-only',
      saved: {
        id: 'serial-only',
        path: 'COM8',
        serialNumber: 'KNOWN-001'
      },
      live: [{ id: 'serial-only', path: 'COM8', connected: true }],
      ports: [{
        path: 'COM8',
        vendorId: '1209',
        productId: '0001',
        serialNumber: 'OTHER-001'
      }],
      allowUnboundMigration: true
    })

    expect(result.state).toBe('mismatch')
    expect(result.record).toBeNull()
    expect(result.message).toContain('serial')
  })

  it('fills only missing descriptors when every known normalized field agrees', () => {
    const result = resolveConnectedSerialIdentityMigration({
      deviceId: 'partial',
      saved: {
        id: 'partial',
        path: 'COM7',
        vendorId: '0X2341',
        productId: '0043'
      },
      live: [{ id: 'partial', path: 'COM12', connected: true }],
      ports: [{
        path: 'COM12',
        vendorId: '2341',
        productId: '0x0043',
        serialNumber: 'NEW-SERIAL'
      }],
      allowUnboundMigration: true
    })

    expect(result.state).toBe('verified')
    expect(result.record).toEqual({
      id: 'partial',
      path: 'COM12',
      vendorId: '2341',
      productId: '0043',
      serialNumber: 'NEW-SERIAL'
    })
  })

  it('normalizes USB ids and compares serial case without replacing known values', () => {
    const result = resolveConnectedSerialIdentityMigration({
      deviceId: 'normalized',
      saved: {
        id: 'normalized',
        path: 'COM5',
        vendorId: '0X2341',
        productId: '0x0043',
        serialNumber: 'known-serial'
      },
      live: [{ id: 'normalized', path: 'COM6', connected: true }],
      ports: [{
        path: 'COM6',
        vendorId: '2341',
        productId: '0043',
        serialNumber: 'KNOWN-SERIAL'
      }],
      allowUnboundMigration: true
    })

    expect(result.state).toBe('verified')
    expect(result.record).toMatchObject({
      path: 'COM6',
      vendorId: '2341',
      productId: '0043',
      serialNumber: 'known-serial'
    })
  })

  it('migrates only profile selectors that agree and leaves swapped profiles quarantined', () => {
    expect(profileCanMigrateWithSerialIdentity(
      { deviceId: 'iflag', port: 'COM7' },
      saved
    )).toBe(true)
    expect(profileCanMigrateWithSerialIdentity(
      { deviceId: 'iflag' },
      saved
    )).toBe(true)
    expect(profileCanMigrateWithSerialIdentity(
      { port: 'COM7' },
      saved
    )).toBe(true)
    expect(profileCanMigrateWithSerialIdentity(
      { deviceId: 'iflag', port: 'COM12' },
      saved
    )).toBe(false)
  })

  it('captures a pre-flash saved binding across restart ID reuse and path reuse', () => {
    const reusedPath = findSavedSerialBinding(
      [saved],
      {
        path: 'COM7',
        vendorId: '9999',
        productId: '9999',
        serialNumber: 'SWAPPED-BOARD'
      }
    )
    expect(reusedPath).toBe(saved)
    const normalSetup = resolveConnectedSerialIdentityMigration({
      deviceId: 'reused-runtime-id',
      saved: reusedPath,
      live: [{ id: 'reused-runtime-id', path: 'COM7', connected: true }],
      ports: [{
        path: 'COM7',
        vendorId: '9999',
        productId: '9999',
        serialNumber: 'SWAPPED-BOARD'
      }],
      allowUnboundMigration: true
    })
    expect(normalSetup.state).toBe('mismatch')
    expect(normalSetup.record).toBeNull()
  })

  it('supports only an explicit replacement for a mismatched saved binding', () => {
    const result = resolveConnectedSerialIdentityMigration({
      deviceId: 'replacement',
      saved,
      live: [{ id: 'replacement', path: 'COM7', connected: true }],
      ports: [{
        path: 'COM7',
        vendorId: '9999',
        productId: '9999',
        serialNumber: 'NEW-BOARD'
      }],
      allowUnboundMigration: true,
      allowReplacement: true
    })

    expect(result.state).toBe('replaced')
    expect(result.record).toMatchObject({
      id: 'replacement',
      vendorId: '9999',
      productId: '9999',
      serialNumber: 'NEW-BOARD'
    })
  })

  it('returns no saved binding when Setup sees a genuinely new device', () => {
    expect(findSavedSerialBinding(
      [saved],
      {
        path: 'COM20',
        vendorId: '1209',
        productId: '0001',
        serialNumber: 'NEW-DEVICE'
      }
    )).toBeUndefined()
  })
})

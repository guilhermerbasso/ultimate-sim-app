import { describe, expect, it } from 'vitest'
import {
  buildConfiguredSerialInventory,
  desiredSerialIdentity,
  resolveConfiguredSerialEvidence
} from './serial-evidence'

describe('rig preflight configured serial identity evidence', () => {
  const config = {
    id: 'iflag',
    path: 'COM7',
    vendorId: '0x2341',
    productId: '0043',
    serialNumber: 'IFLAG-001'
  }
  const live = [{ id: 'iflag', path: 'COM7', connected: true }]

  it('fails closed when a configured VID/PID/serial field is not observed', () => {
    const missingSerial = resolveConfiguredSerialEvidence(
      config,
      live,
      [{ path: 'COM7', vendorId: '2341', productId: '0043' }]
    )
    const wrongPid = resolveConfiguredSerialEvidence(
      config,
      live,
      [{
        path: 'COM7',
        vendorId: '2341',
        productId: '9999',
        serialNumber: 'IFLAG-001'
      }]
    )

    expect(missingSerial.state).toBe('unknown')
    expect(missingSerial.observedIdentity).toContain('serial=?')
    expect(missingSerial.reason).toContain('did not report')
    expect(wrongPid.state).toBe('fail')
    expect(wrongPid.observedIdentity).toContain('pid=9999')
  })

  it('accepts only the matching observed device and records its full identity', () => {
    const evidence = resolveConfiguredSerialEvidence(
      config,
      live,
      [{
        path: 'COM7',
        vendorId: '2341',
        productId: '0043',
        serialNumber: 'IFLAG-001'
      }]
    )

    expect(evidence.state).toBe('verified')
    expect(desiredSerialIdentity(config)).toContain('serial=iflag-001')
    expect(evidence.observedIdentity).toBe(
      'vid=2341;pid=0043;serial=iflag-001'
    )
  })

  it('allows a serial-bearing device to move ports only when observed identity still matches', () => {
    const movedLive = [{ id: 'new-hub-id', path: 'COM11', connected: true }]
    const matching = resolveConfiguredSerialEvidence(
      config,
      movedLive,
      [{
        path: 'COM11',
        vendorId: '2341',
        productId: '0043',
        serialNumber: 'IFLAG-001'
      }]
    )
    const impostor = resolveConfiguredSerialEvidence(
      config,
      movedLive,
      [{
        path: 'COM11',
        vendorId: '2341',
        productId: '0043',
        serialNumber: 'IFLAG-002'
      }]
    )

    expect(matching.state).toBe('verified')
    expect(matching.observedIdentity).toBe(
      'vid=2341;pid=0043;serial=iflag-001'
    )
    expect(desiredSerialIdentity(config)).toBe(
      desiredSerialIdentity({ ...config, id: 'new-hub-id', path: 'COM11' })
    )
    expect(impostor.state).toBe('fail')
  })

  it('never certifies an identity-less device from hub id or COM path alone', () => {
    const evidence = resolveConfiguredSerialEvidence(
      { id: 'mutable-hub-id', path: 'COM7' },
      [{ id: 'mutable-hub-id', path: 'COM7', connected: true }],
      [{ path: 'COM7', vendorId: '1a86', productId: '7523' }]
    )

    expect(evidence.state).toBe('unknown')
    expect(evidence.reason).toContain('lacks VID/PID binding')
    expect(desiredSerialIdentity({ id: 'mutable-hub-id', path: 'COM7' })).toBe(
      'unbound:key=mutable-hub-id'
    )
  })

  it('requires the stable device when a saved path or hub id is reused by an impostor', () => {
    const liveWithSwap = [
      { id: 'iflag', path: 'COM7', connected: true },
      { id: 'new-hub-id', path: 'COM11', connected: true }
    ]
    const portsWithSwap = [
      {
        path: 'COM7',
        vendorId: '9999',
        productId: '9999',
        serialNumber: 'IMPOSTOR'
      },
      {
        path: 'COM11',
        vendorId: '2341',
        productId: '0043',
        serialNumber: 'IFLAG-001'
      }
    ]
    const stable = resolveConfiguredSerialEvidence(config, liveWithSwap, portsWithSwap)
    const impostorOnly = resolveConfiguredSerialEvidence(
      config,
      [liveWithSwap[0]],
      [portsWithSwap[0]]
    )

    expect(stable.state).toBe('verified')
    expect(stable.observedIdentity).toBe(
      'vid=2341;pid=0043;serial=iflag-001'
    )
    expect(impostorOnly.state).toBe('fail')
    expect(impostorOnly.reason).toContain('VID/PID')
  })

  it('requires a governed waiver for hardware that genuinely exposes no serial', () => {
    const evidence = resolveConfiguredSerialEvidence(
      {
        id: 'serial-less',
        path: 'COM9',
        vendorId: '1a86',
        productId: '7523'
      },
      [{ id: 'serial-less', path: 'COM9', connected: true }],
      [{ path: 'COM9', vendorId: '1a86', productId: '7523' }]
    )

    expect(evidence.state).toBe('unknown')
    expect(evidence.reason).toContain('governed preflight waiver')
  })

  it('unions and deduplicates serial-store and profile-backed inventories', () => {
    const configured = [
      config,
      {
        id: 'wheel-display',
        path: 'COM12',
        vendorId: '1209',
        productId: '0001',
        serialNumber: 'DISPLAY-001'
      }
    ]
    const profiles = [
      { id: 'iflag-profile', deviceId: 'iflag', port: 'COM7' },
      { id: 'missing-profile', deviceId: 'missing', port: 'COM99' },
      { id: 'empty-profile' },
      { id: 'id-only-profile', deviceId: 'iflag' }
    ]
    const inventory = buildConfiguredSerialInventory(
      configured,
      profiles,
      [
        { id: 'iflag', path: 'COM7', connected: true },
        { id: 'wheel-display', path: 'COM12', connected: true }
      ],
      [
        { path: 'COM7', vendorId: '2341', productId: '0043', serialNumber: 'IFLAG-001' },
        { path: 'COM12', vendorId: '1209', productId: '0001', serialNumber: 'DISPLAY-001' }
      ]
    )

    expect(inventory).toHaveLength(5)
    const iflag = inventory.find((entry) => entry.profileIds.includes('iflag-profile'))
    expect(iflag?.state).toBe('verified')
    expect(iflag?.sources).toEqual(['profile:iflag-profile', 'serial-store:iflag'])
    expect(inventory.find((entry) => entry.desiredIdentity === 'profile:missing-profile')).toMatchObject({
      state: 'unknown',
      profileIds: ['missing-profile']
    })
    expect(inventory.find((entry) => entry.desiredIdentity === 'profile:empty-profile')).toMatchObject({
      state: 'unknown',
      profileIds: ['empty-profile']
    })
    expect(inventory.find((entry) => entry.desiredIdentity === 'profile:id-only-profile')).toMatchObject({
      state: 'unknown',
      profileIds: ['id-only-profile']
    })
  })

  it('fails closed when a profile deviceId and path point at different configured hardware', () => {
    const configured = [
      config,
      {
        id: 'other-device',
        path: 'COM12',
        vendorId: '1209',
        productId: '0001',
        serialNumber: 'OTHER-001'
      }
    ]
    const inventory = buildConfiguredSerialInventory(
      configured,
      [{ id: 'swapped-profile', deviceId: 'iflag', port: 'COM12' }],
      live,
      [{ path: 'COM7', vendorId: '2341', productId: '0043', serialNumber: 'IFLAG-001' }]
    )
    const swapped = inventory.find((entry) => entry.desiredIdentity === 'profile:swapped-profile')

    expect(swapped?.state).toBe('unknown')
    expect(swapped?.reason).toContain('different stable serial-store devices')
  })

  it('deduplicates duplicate stable configs while retaining every inventory source', () => {
    const duplicate = {
      ...config,
      id: 'iflag-duplicate',
      path: 'COM11'
    }
    const inventory = buildConfiguredSerialInventory(
      [config, duplicate],
      [
        { id: 'profile-a', deviceId: 'iflag', port: 'COM7' },
        { id: 'profile-b', deviceId: 'iflag', port: 'COM11' }
      ],
      [{ id: 'runtime-iflag', path: 'COM15', connected: true }],
      [{ path: 'COM15', vendorId: '2341', productId: '0043', serialNumber: 'IFLAG-001' }]
    )

    expect(inventory).toHaveLength(1)
    expect(inventory[0].state).toBe('verified')
    expect(inventory[0].profileIds).toEqual(['profile-a', 'profile-b'])
    expect(inventory[0].sources).toEqual([
      'profile:profile-a',
      'profile:profile-b',
      'serial-store:iflag',
      'serial-store:iflag-duplicate'
    ])
  })

  it('does not let an ESP32 profile pass through mutable path or hub-id evidence', () => {
    const inventory = buildConfiguredSerialInventory(
      [config],
      [{ id: 'esp32-profile', deviceId: 'iflag', port: 'COM7' }],
      [{ id: 'iflag', path: 'COM7', connected: true }],
      [{ path: 'COM7', vendorId: '9999', productId: '9999', serialNumber: 'IMPOSTOR' }]
    )
    const profileEntry = inventory.find((entry) => entry.profileIds.includes('esp32-profile'))

    expect(profileEntry?.state).toBe('fail')
    expect(profileEntry?.reason).toContain('VID/PID')
    expect(
      inventory
        .filter((entry) => entry.state === 'verified')
        .flatMap((entry) => entry.profileIds)
    ).not.toContain('esp32-profile')
  })
})

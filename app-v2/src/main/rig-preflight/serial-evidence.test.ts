import { describe, expect, it } from 'vitest'
import {
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

    expect(missingSerial.connected).toBe(false)
    expect(missingSerial.observedIdentity).toContain('serial=?')
    expect(wrongPid.connected).toBe(false)
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

    expect(evidence.connected).toBe(true)
    expect(desiredSerialIdentity(config)).toContain('serial=iflag-001')
    expect(evidence.observedIdentity).toBe(
      'path=com7;vid=2341;pid=0043;serial=iflag-001'
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

    expect(matching.connected).toBe(true)
    expect(matching.observedIdentity).toContain('path=com11')
    expect(impostor.connected).toBe(false)
  })
})

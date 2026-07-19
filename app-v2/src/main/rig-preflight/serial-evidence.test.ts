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
})

import { describe, expect, it } from 'vitest'
import {
  parseNetstatPortOwners,
  parsePowerShellPortOwners,
  probePortOwnership
} from './port-owner'

describe('Windows streaming port ownership evidence', () => {
  it('parses PowerShell owner rows with process provenance', () => {
    const rows = parsePowerShellPortOwners(JSON.stringify([
      {
        LocalAddress: '127.0.0.1',
        LocalPort: 47655,
        OwningProcess: 123,
        ProcessName: 'ultimate-sim-app'
      }
    ]))
    expect(rows).toEqual([
      {
        localAddress: '127.0.0.1',
        localPort: 47655,
        ownerPid: 123,
        ownerName: 'ultimate-sim-app'
      }
    ])
  })

  it('parses IPv4 and IPv6 netstat listeners for the requested port', () => {
    const rows = parseNetstatPortOwners(
      [
        '  TCP    0.0.0.0:47655          0.0.0.0:0              LISTENING       101',
        '  TCP    [::]:47655             [::]:0                 LISTENING       101',
        '  TCP    0.0.0.0:9999           0.0.0.0:0              LISTENING       202'
      ].join('\r\n'),
      47655
    )
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.ownerPid === 101)).toBe(true)
  })

  it('prefers the current app PID and reports foreign owners otherwise', async () => {
    const appPid = 101
    const appOwned = await probePortOwnership(
      47655,
      appPid,
      async () => ({
        stdout: JSON.stringify([
          { LocalAddress: '0.0.0.0', LocalPort: 47655, OwningProcess: 202, ProcessName: 'other' },
          { LocalAddress: '127.0.0.1', LocalPort: 47655, OwningProcess: appPid, ProcessName: 'app' }
        ]),
        stderr: ''
      }),
      'win32'
    )
    expect(appOwned.state).toBe('app')
    expect(appOwned.ownerPid).toBe(appPid)

    const foreign = await probePortOwnership(
      47655,
      appPid,
      async () => ({
        stdout: JSON.stringify({
          LocalAddress: '0.0.0.0',
          LocalPort: 47655,
          OwningProcess: 202,
          ProcessName: 'other'
        }),
        stderr: ''
      }),
      'win32'
    )
    expect(foreign.state).toBe('foreign')
    expect(foreign.ownerName).toBe('other')
  })
})

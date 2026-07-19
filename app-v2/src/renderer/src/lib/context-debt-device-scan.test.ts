import { describe, expect, it, vi } from 'vitest'
import {
  contextDebtSerialDeviceIds,
  scanContextDebtDevices
} from './context-debt-device-scan'

describe('SP-07 hardware scan truth', () => {
  it('records success independently for every hardware category', async () => {
    const result = await scanContextDebtDevices({
      refreshAudioOutputs: vi.fn().mockResolvedValue(true),
      refreshSerialDevices: vi.fn().mockResolvedValue(undefined),
      refreshDisplays: vi.fn().mockResolvedValue([]),
      listGamepads: vi.fn().mockReturnValue(['wheel-a'])
    })

    expect(result.scanStatus).toEqual({
      audio: 'success',
      serial: 'success',
      display: 'success',
      gamepad: 'success'
    })
    expect(result.gamepadIds).toEqual(['wheel-a'])
  })

  it('keeps each failed category failed instead of promoting an aggregate refresh to success', async () => {
    const result = await scanContextDebtDevices({
      refreshAudioOutputs: vi.fn().mockResolvedValue(false),
      refreshSerialDevices: vi.fn().mockRejectedValue(new Error('serial unavailable')),
      refreshDisplays: vi.fn().mockRejectedValue(new Error('display unavailable')),
      listGamepads: vi.fn().mockImplementation(() => {
        throw new Error('gamepad unavailable')
      })
    })

    expect(result.scanStatus).toEqual({
      audio: 'failed',
      serial: 'failed',
      display: 'failed',
      gamepad: 'failed'
    })
    expect(result.gamepadIds).toEqual([])
  })

  it('reports passive audio enumeration without stable ids as incomplete', async () => {
    const result = await scanContextDebtDevices({
      refreshAudioOutputs: vi.fn().mockResolvedValue(false),
      refreshSerialDevices: vi.fn().mockResolvedValue(undefined),
      refreshDisplays: vi.fn().mockResolvedValue([]),
      listGamepads: vi.fn().mockReturnValue([])
    })

    expect(result.scanStatus.audio).toBe('failed')
  })

  it('counts only connected serial devices and the connected primary target', () => {
    const ids = contextDebtSerialDeviceIds([
      {
        id: 'simx',
        path: 'COM1',
        label: 'SIM-X',
        kind: 'sim-x',
        baud: 115_200,
        connected: true
      },
      {
        id: 'shaker-live',
        path: 'COM2',
        label: 'Shaker live',
        kind: 'generic',
        baud: 115_200,
        connected: true
      },
      {
        id: 'shaker-stale',
        path: 'COM3',
        label: 'Shaker stale',
        kind: 'generic',
        baud: 115_200,
        connected: false
      }
    ], null)

    expect(ids).toEqual(['primary', 'shaker-live'])
  })

  it('does not inventory a disconnected primary device', () => {
    expect(contextDebtSerialDeviceIds([{
      id: 'simx',
      path: 'COM1',
      label: 'SIM-X',
      kind: 'sim-x',
      baud: 115_200,
      connected: false
    }], null)).toEqual([])
  })
})

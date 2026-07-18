import { describe, expect, it, vi } from 'vitest'
import { scanContextDebtDevices } from './context-debt-device-scan'

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
})

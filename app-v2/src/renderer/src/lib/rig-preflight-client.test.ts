import { describe, expect, it } from 'vitest'
import { collectAudioProbe } from './rig-preflight-client'

function device(kind: MediaDeviceKind, deviceId: string, label: string): MediaDeviceInfo {
  return {
    kind,
    deviceId,
    label,
    groupId: 'group',
    toJSON: () => ({})
  } as MediaDeviceInfo
}

describe('rig preflight audio probe', () => {
  it('does not treat a running context as an enumerated output when enumeration fails', async () => {
    const result = await collectAudioProbe({
      enumerateDevices: async () => {
        throw new Error('permission denied')
      },
      createAudioContext: () => ({
        state: 'running',
        resume: async () => undefined,
        close: async () => undefined
      })
    })
    expect(result.evidence.enumerationSucceeded).toBe(false)
    expect(result.evidence.outputIdentities).toEqual([])
    expect(result.evidence.audioEngineError).toContain('permission denied')
  })

  it('requires the AudioContext to actually reach running state', async () => {
    const result = await collectAudioProbe({
      enumerateDevices: async () => [
        device('audiooutput', 'default', 'System default')
      ],
      createAudioContext: () => ({
        state: 'suspended',
        resume: async () => undefined,
        close: async () => undefined
      })
    })
    expect(result.evidence.enumerationSucceeded).toBe(true)
    expect(result.evidence.audioContextState).toBe('suspended')
    expect(result.evidence.audioEngineOk).toBe(false)
    expect(result.evidence.outputIdentities).toEqual(['audio-output:default'])
  })
})

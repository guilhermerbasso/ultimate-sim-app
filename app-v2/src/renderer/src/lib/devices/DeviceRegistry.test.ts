import { describe, expect, it } from 'vitest'
import { isAudioOutputScanComplete } from './DeviceRegistry'

describe('context-debt audio scan completeness', () => {
  it('requires a stable id for passive scans', () => {
    expect(isAudioOutputScanComplete([], false)).toBe(false)
    expect(isAudioOutputScanComplete([{ deviceId: '', label: 'Hidden output' }], false)).toBe(false)
    expect(isAudioOutputScanComplete([{ deviceId: 'default', label: 'System default' }], false)).toBe(true)
  })

  it('allows an explicit label scan to establish an empty inventory', () => {
    expect(isAudioOutputScanComplete([], true)).toBe(true)
  })
})

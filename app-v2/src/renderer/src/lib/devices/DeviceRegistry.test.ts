import { describe, expect, it } from 'vitest'
import { isAudioOutputScanComplete } from './DeviceRegistry'

describe('context-debt audio scan completeness', () => {
  it('rejects empty or default-only passive inventories without original device ids', () => {
    const passive = { requestLabels: false, labelsUnlocked: false }
    expect(isAudioOutputScanComplete([], passive)).toBe(false)
    expect(isAudioOutputScanComplete([{ deviceId: '', label: 'Hidden output' }], passive)).toBe(false)
    expect(isAudioOutputScanComplete([{ deviceId: 'default', label: 'System default' }], passive)).toBe(false)
    expect(isAudioOutputScanComplete([
      { deviceId: 'default', label: 'System default' },
      { deviceId: 'speaker-original-id', label: 'Speakers' }
    ], passive)).toBe(true)
  })

  it('keeps explicit scans incomplete when permission or label unlocking fails', () => {
    expect(isAudioOutputScanComplete([], {
      requestLabels: true,
      labelsUnlocked: false
    })).toBe(false)
    expect(isAudioOutputScanComplete([], {
      requestLabels: true,
      labelsUnlocked: true
    })).toBe(true)
  })
})

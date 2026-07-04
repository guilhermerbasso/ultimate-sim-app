import { describe, expect, it } from 'vitest'
import { DEFAULT_RECORDING_CONFIG, mergeRecordingConfig, RECORDING_CHANNELS } from './recording'

describe('DEFAULT_RECORDING_CONFIG', () => {
  it('enables auto-record by default', () => {
    expect(DEFAULT_RECORDING_CONFIG.autoRecord).toBe(true)
  })
})

describe('mergeRecordingConfig', () => {
  it('returns the base defaults when patch is empty/undefined/null', () => {
    expect(mergeRecordingConfig(DEFAULT_RECORDING_CONFIG)).toEqual({ autoRecord: true })
    expect(mergeRecordingConfig(DEFAULT_RECORDING_CONFIG, undefined)).toEqual({ autoRecord: true })
    expect(mergeRecordingConfig(DEFAULT_RECORDING_CONFIG, null)).toEqual({ autoRecord: true })
    expect(mergeRecordingConfig(DEFAULT_RECORDING_CONFIG, {})).toEqual({ autoRecord: true })
  })

  it('applies an explicit autoRecord override', () => {
    expect(mergeRecordingConfig(DEFAULT_RECORDING_CONFIG, { autoRecord: false })).toEqual({ autoRecord: false })
    expect(mergeRecordingConfig({ autoRecord: false }, { autoRecord: true })).toEqual({ autoRecord: true })
  })

  it('keeps the base value when autoRecord is not a boolean', () => {
    // Malformed persisted JSON or a renderer bug should never flip the toggle to
    // a truthy/falsy non-boolean — it must fall back to the base config.
    expect(mergeRecordingConfig(DEFAULT_RECORDING_CONFIG, { autoRecord: 'yes' as unknown as boolean })).toEqual({ autoRecord: true })
    expect(mergeRecordingConfig({ autoRecord: false }, { autoRecord: 1 as unknown as boolean })).toEqual({ autoRecord: false })
  })
})

describe('RECORDING_CHANNELS', () => {
  it('exposes stable channel names', () => {
    expect(RECORDING_CHANNELS.getConfig).toBe('recording:getConfig')
    expect(RECORDING_CHANNELS.setConfig).toBe('recording:setConfig')
    expect(RECORDING_CHANNELS.configEvent).toBe('recording:config')
    expect(RECORDING_CHANNELS.openFolder).toBe('recording:openFolder')
  })
})

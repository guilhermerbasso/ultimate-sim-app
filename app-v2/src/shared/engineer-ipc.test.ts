import { describe, expect, it } from 'vitest'
import { DEFAULT_ENGINEER_CONFIG, mergeEngineerConfig, type EngineerConfig } from './engineer-ipc'

describe('DEFAULT_ENGINEER_CONFIG', () => {
  it('defaults coach intent sensitivity to 0.6', () => {
    expect(DEFAULT_ENGINEER_CONFIG.intentSensitivity).toBe(0.6)
  })
})

describe('mergeEngineerConfig', () => {
  const base: EngineerConfig = { ...DEFAULT_ENGINEER_CONFIG, intentSensitivity: 0.4 }

  it('clamps intentSensitivity to the supported 0..1 range', () => {
    expect(mergeEngineerConfig(base, { intentSensitivity: -0.5 }).intentSensitivity).toBe(0)
    expect(mergeEngineerConfig(base, { intentSensitivity: 1.5 }).intentSensitivity).toBe(1)
    expect(mergeEngineerConfig(base, { intentSensitivity: 0.75 }).intentSensitivity).toBe(0.75)
  })

  it('falls back to the base intentSensitivity for non-finite patch values', () => {
    expect(mergeEngineerConfig(base, { intentSensitivity: Number.NaN }).intentSensitivity).toBe(0.4)
    expect(mergeEngineerConfig(base, { intentSensitivity: Number.POSITIVE_INFINITY }).intentSensitivity).toBe(0.4)
    expect(mergeEngineerConfig(base, { intentSensitivity: '0.8' as unknown as number }).intentSensitivity).toBe(0.4)
  })
})

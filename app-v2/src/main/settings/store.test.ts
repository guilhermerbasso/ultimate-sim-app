import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { APP_LANGUAGES, APP_TELEMETRY_SOURCES, DEFAULT_APP_SETTINGS, TC_SENSITIVITIES } from '../../shared/settings'
import { UNIT_SYSTEMS } from '../../shared/units'
import { SettingsStore } from './store'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(process.cwd(), 'settings-store-test-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

describe('SettingsStore.defaultTelemetrySource', () => {
  it('persists every source across a reload (simulated restart)', () => {
    for (const source of APP_TELEMETRY_SOURCES) {
      const dir = tempDir()
      new SettingsStore(dir).setSettings({ defaultTelemetrySource: source })
      expect(new SettingsStore(dir).load().defaultTelemetrySource).toBe(source)
    }
  })

  it('falls back to default for an unknown source', () => {
    const dir = tempDir()
    new SettingsStore(dir).setSettings({
      defaultTelemetrySource: 'bogus' as never
    })
    expect(new SettingsStore(dir).load().defaultTelemetrySource).toBe('off')
  })

  it('merges saved settings over defaults when loading', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ defaultTelemetrySource: 'iracing' }), 'utf8')

    expect(new SettingsStore(dir).load()).toEqual({
      ...DEFAULT_APP_SETTINGS,
      defaultTelemetrySource: 'iracing'
    })
  })
})

describe('SettingsStore.tcSensitivity', () => {
  it('persists every TC sensitivity level across a reload (simulated restart)', () => {
    for (const level of TC_SENSITIVITIES) {
      const dir = tempDir()
      new SettingsStore(dir).setSettings({ tcSensitivity: level })
      expect(new SettingsStore(dir).load().tcSensitivity).toBe(level)
    }
  })

  it('defaults to medium and falls back to it for an unknown level', () => {
    const dir = tempDir()
    expect(new SettingsStore(dir).load().tcSensitivity).toBe('medium')
    new SettingsStore(dir).setSettings({ tcSensitivity: 'bogus' as never })
    expect(new SettingsStore(dir).load().tcSensitivity).toBe('medium')
  })
})

describe('SettingsStore.language', () => {
  it('persists every supported language across a reload (simulated restart)', () => {
    for (const language of APP_LANGUAGES) {
      const dir = tempDir()
      new SettingsStore(dir).setSettings({ language })
      expect(new SettingsStore(dir).load().language).toBe(language)
    }
  })

  describe('SettingsStore.unitSystem', () => {
    it('defaults to metric and persists each supported system across restarts', () => {
      expect(new SettingsStore(tempDir()).load().unitSystem).toBe('metric')

      for (const unitSystem of UNIT_SYSTEMS) {
        const dir = tempDir()
        new SettingsStore(dir).setSettings({ unitSystem })
        expect(new SettingsStore(dir).load().unitSystem).toBe(unitSystem)
      }
    })

    it('falls back to metric for an unknown system', () => {
      const dir = tempDir()
      new SettingsStore(dir).setSettings({ unitSystem: 'bogus' as never })
      expect(new SettingsStore(dir).load().unitSystem).toBe('metric')
    })
  })

  it('defaults to en and falls back to it for an unknown language', () => {
    const dir = tempDir()
    expect(new SettingsStore(dir).load().language).toBe('en')
    new SettingsStore(dir).setSettings({ language: 'it' as never })
    expect(new SettingsStore(dir).load().language).toBe('en')
  })
})

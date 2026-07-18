import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ALERTS_CONFIG } from '../../../shared/alerts'
import {
  isSemanticTriggerWithEdges,
  isSemanticTriggerWithHold
} from '../../../shared/overlays'
import { PREVIEW_SNAPSHOT } from '../dashboard/widgets/gt3-theme'
import {
  ALL_OVERLAY_WIDGETS,
  resolveOverlayTrigger
} from './hifi-overlays'
import {
  EDITOR_TRIGGER_PREVIEW_STORAGE_KEY,
  createEditorTriggerPreviewFrame,
  persistEditorTriggerPreviewPreference,
  readEditorTriggerPreviewPreference
} from './editor-trigger-preview'

describe('editor trigger preview frames', () => {
  const triggerOnly = ALL_OVERLAY_WIDGETS
    .map((definition) => ({
      definition,
      trigger: resolveOverlayTrigger(definition, undefined)
    }))
    .filter(({ definition, trigger }) =>
      definition.role === 'alert' && trigger?.kind !== 'always'
    )

  it('finds a visible simulated-active-sequence frame for every trigger-only overlay', () => {
    expect(triggerOnly.length).toBeGreaterThan(20)
    for (const { definition, trigger } of triggerOnly) {
      const frame = createEditorTriggerPreviewFrame(
        PREVIEW_SNAPSHOT,
        trigger,
        true,
        DEFAULT_ALERTS_CONFIG,
        definition.id
      )
      expect(frame.visibility.visible, definition.id).toBe(true)
      expect(frame.forced, definition.id).toBe(true)
    }
  })

  it('covers temporal, pulse/edge, flag, proximity, low-fuel, shift, and alert2 families', () => {
    const cases = [
      triggerOnly.find(({ trigger }) => trigger?.semantic === 'pitServiceStatus'),
      triggerOnly.find(({ trigger }) => trigger?.semantic === 'pitsOpen'),
      triggerOnly.find(({ definition }) => definition.id === 'hifi:alertFlag'),
      triggerOnly.find(({ definition }) => definition.id === 'hifi:alertProximityRadar'),
      triggerOnly.find(({ definition }) => definition.id === 'hifi:alertLowFuel'),
      triggerOnly.find(({ definition }) => definition.id === 'hifi:alertShiftFlash'),
      triggerOnly.find(({ trigger }) => trigger?.semantic === 'alert2WaterTempCritical')
    ]
    expect(cases.every(Boolean)).toBe(true)
    for (const entry of cases) {
      const frame = createEditorTriggerPreviewFrame(
        PREVIEW_SNAPSHOT,
        entry!.trigger,
        true,
        DEFAULT_ALERTS_CONFIG,
        entry!.definition.id
      )
      expect(frame.visibility.visible, entry!.definition.id).toBe(true)
    }
    expect(
      triggerOnly.some(({ trigger }) => isSemanticTriggerWithEdges(trigger))
    ).toBe(true)
    expect(
      triggerOnly.some(({ trigger }) => isSemanticTriggerWithHold(trigger))
    ).toBe(true)
  })

  it('leaves inactive previews inactive when the option is off', () => {
    const entry = triggerOnly.find(
      ({ trigger }) => trigger?.semantic === 'alert2WaterTempCritical'
    )
    expect(entry).toBeDefined()
    const inactive = createEditorTriggerPreviewFrame(
      PREVIEW_SNAPSHOT,
      entry!.trigger,
      false,
      DEFAULT_ALERTS_CONFIG,
      entry!.definition.id
    )
    expect(inactive.forced).toBe(false)
    expect(inactive.visibility.visible).toBe(false)
    expect(inactive.snapshot).toBe(PREVIEW_SNAPSHOT)
  })

  it('does not mutate telemetry, alert policy, or saved trigger objects', () => {
    const entry = triggerOnly.find(
      ({ definition }) => definition.id === 'hifi:alertLowFuel'
    )
    expect(entry).toBeDefined()
    const snapshotBefore = structuredClone(PREVIEW_SNAPSHOT)
    const configBefore = structuredClone(DEFAULT_ALERTS_CONFIG)
    const triggerBefore = structuredClone(entry!.trigger)

    createEditorTriggerPreviewFrame(
      PREVIEW_SNAPSHOT,
      entry!.trigger,
      true,
      DEFAULT_ALERTS_CONFIG,
      entry!.definition.id
    )

    expect(PREVIEW_SNAPSHOT).toEqual(snapshotBefore)
    expect(DEFAULT_ALERTS_CONFIG).toEqual(configBefore)
    expect(entry!.trigger).toEqual(triggerBefore)
  })
})

describe('editor-only preference boundary', () => {
  it('persists only the renderer editor preference', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    }
    expect(readEditorTriggerPreviewPreference(storage)).toBe(true)
    persistEditorTriggerPreviewPreference(false, storage)
    expect(values).toEqual(
      new Map([[EDITOR_TRIGGER_PREVIEW_STORAGE_KEY, 'false']])
    )
    expect(readEditorTriggerPreviewPreference(storage)).toBe(false)
  })

  it('keeps live overlay, compositor, streaming, and main-process entry points isolated', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const runtimeFiles = [
      'OverlayRoot.tsx',
      'CompositorRoot.tsx',
      join('..', 'stream', 'StreamOverlayRoot.tsx'),
      join('..', '..', '..', 'main', 'overlays', 'manager.ts')
    ]
    for (const relative of runtimeFiles) {
      const source = readFileSync(join(here, relative), 'utf8')
      expect(source, relative).not.toContain('EDITOR_TRIGGER_PREVIEW_STORAGE_KEY')
      expect(source, relative).not.toContain('TriggerPreviewToggle')
      expect(source, relative).not.toContain('usa.editor.triggerOnlyActive')
    }
  })
})

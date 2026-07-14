import { describe, expect, it } from 'vitest'
import {
  TOUCH_ACTION_IPC_CHANNEL,
  TOUCH_CONTROL_KINDS,
  TOUCH_PANEL_SCHEMA_VERSION,
  buttonActionEventToIpc,
  buttonControlActions,
  createButtonBoxPanel,
  createTouchControl,
  isValidButtonAction,
  normalizeAction,
  normalizeTouchSemanticActionRequest,
  parseButtonBoxPanel,
  parseButtonBoxPanelDetailed,
  primaryButtonAction,
  safeColor,
  safeImage,
  serializeButtonBoxPanel,
  touchControlStateDestinationId,
  validateTouchControl,
  validateTouchStateBindings,
  type ButtonAction,
  type ButtonBoxButtonInput,
  type TouchControl
} from './touch-panel'

const key = (keyName: string, mode: 'press' | 'hold' | 'repeat' = 'press'): ButtonAction => ({
  kind: 'keyboard',
  command: { mode, keys: [keyName], repeatMs: mode === 'repeat' ? 90 : undefined }
})

function semanticButtons(): ButtonBoxButtonInput[] {
  const controls: TouchControl[] = [
    { kind: 'momentary', action: key('P') },
    { kind: 'latching-toggle', onAction: key('L', 'press'), offAction: key('L', 'press') },
    {
      kind: 'two-position-rocker',
      negativeAction: key('PageDown'),
      positiveAction: key('PageUp'),
      negativeLabel: 'TC down',
      positiveLabel: 'TC up',
      repeat: { delayMs: 400, intervalMs: 100 }
    },
    { kind: 'guarded-two-step', action: key('I'), armTimeoutMs: 4000 },
    {
      kind: 'rotary',
      decrementAction: key('['),
      incrementAction: key(']'),
      decrementLabel: 'BB down',
      incrementLabel: 'BB up',
      repeat: { delayMs: 420, intervalMs: 120 }
    },
    {
      kind: 'selector',
      initialChoiceId: 'map-1',
      choices: [
        { id: 'map-1', label: 'MAP 1', value: '1', action: key('1') },
        { id: 'map-2', label: 'MAP 2', value: '2', action: key('2') }
      ]
    },
    { kind: 'status-led', value: 'READY' },
    { kind: 'value-tile', value: '52.1', unit: 'L' }
  ]
  return controls.map((control, index) => ({ id: `control-${index + 1}`, label: control.kind, control }))
}

describe('touch panel schema v2 and migration', () => {
  it('serializes all eight explicit kinds independently from material', () => {
    const panel = createButtonBoxPanel({ columns: 4, rows: 2, buttons: semanticButtons() })
    const parsed = parseButtonBoxPanel(serializeButtonBoxPanel(panel))
    expect(parsed?.schemaVersion).toBe(TOUCH_PANEL_SCHEMA_VERSION)
    expect(parsed?.buttons.map((button) => button.control.kind)).toEqual(TOUCH_CONTROL_KINDS)
    expect(parsed?.buttons.every((button) => button.material === 'backlit')).toBe(true)
  })

  it('migrates an unversioned cosmetic toggle without changing its old one-click action', () => {
    const result = parseButtonBoxPanelDetailed({
      id: 'legacy-panel',
      name: 'Legacy',
      columns: 1,
      rows: 1,
      buttons: [
        {
          id: 'legacy-toggle',
          label: 'LIGHTS',
          material: 'toggle',
          action: key('H')
        }
      ]
    })
    expect(result.errors).toEqual([])
    expect(result.migratedFrom).toBe(1)
    expect(result.panel?.schemaVersion).toBe(2)
    expect(result.panel?.buttons[0].material).toBe('toggle')
    expect(result.panel?.buttons[0].control).toEqual({ kind: 'momentary', action: key('H') })
  })

  it('pads a short legacy grid but rejects a malformed v2 layout', () => {
    const legacy = parseButtonBoxPanelDetailed({ id: 'legacy-grid', columns: 2, rows: 2, buttons: [] })
    expect(legacy.panel?.buttons).toHaveLength(4)
    expect(legacy.warnings.join(' ')).toContain('padded')

    const v2 = createButtonBoxPanel({ id: 'v2-grid', columns: 2, rows: 2 })
    const invalid = { ...v2, buttons: v2.buttons.slice(0, 3) }
    const result = parseButtonBoxPanelDetailed(invalid)
    expect(result.panel).toBeNull()
    expect(result.errors.join(' ')).toContain('exactly 4 controls')
  })

  it('preserves legacy keyboard sequences longer than the old twelve-key limit', () => {
    const keys = Array.from({ length: 20 }, (_, index) => `K${index + 1}`)
    const result = parseButtonBoxPanelDetailed({
      id: 'legacy-sequence',
      columns: 1,
      rows: 1,
      buttons: [{
        id: 'sequence',
        action: { kind: 'keyboard', command: { mode: 'sequence', keys } }
      }]
    })
    expect(result.errors).toEqual([])
    const action = result.panel ? primaryButtonAction(result.panel.buttons[0].control) : null
    expect(action?.kind).toBe('keyboard')
    if (action?.kind === 'keyboard') expect(action.command.keys).toEqual(keys)
  })

  it('fails oversized legacy sequences without silently truncating them', () => {
    const keys = Array.from({ length: 65 }, (_, index) => `K${index + 1}`)
    const result = parseButtonBoxPanelDetailed({
      id: 'legacy-sequence-too-long',
      columns: 1,
      rows: 1,
      buttons: [{
        id: 'sequence',
        action: { kind: 'keyboard', command: { mode: 'sequence', keys } }
      }]
    })
    expect(result.panel).toBeNull()
    expect(result.errors.join(' ')).toContain('65 keys')
    expect(result.errors.join(' ')).toContain('without truncation')
  })
  it('rejects unknown future schema versions', () => {
    const result = parseButtonBoxPanelDetailed({ schemaVersion: 99, id: 'future' })
    expect(result.panel).toBeNull()
    expect(result.errors[0]).toContain('Unsupported')
  })
})

describe('exact control and action validation', () => {
  it('requires the exact two rotary action slots and rejects arbitrary zones', () => {
    expect(
      validateTouchControl({
        kind: 'rotary',
        decrementAction: key('['),
        incrementAction: key(']'),
        decrementLabel: 'Down',
        incrementLabel: 'Up',
        repeat: { delayMs: 420, intervalMs: 120 }
      })
    ).toEqual([])
    const errors = validateTouchControl({
      kind: 'rotary',
      decrementAction: key('['),
      decrementLabel: 'Down',
      incrementLabel: 'Up',
      repeat: { delayMs: 420, intervalMs: 120 },
      zones: [{ action: key('X') }]
    })
    expect(errors.join(' ')).toContain('unexpected field "zones"')
    expect(errors.join(' ')).toContain('incrementAction')
  })

  it('requires 2-12 unique selector choices and a referenced initial choice', () => {
    const errors = validateTouchControl({
      kind: 'selector',
      initialChoiceId: 'missing',
      choices: [
        { id: 'same', label: '1', value: '1', action: key('1') },
        { id: 'same', label: '2', value: '2', action: key('2') }
      ]
    })
    expect(errors.join(' ')).toContain('duplicated')
    expect(errors.join(' ')).toContain('initialChoiceId')
  })

  it('normalizes command groups and rejects gamepad or URL-like app destinations', () => {
    expect(
      normalizeAction({ kind: 'iracing', command: { group: 'camera', name: 'pit:clearAll' } })
    ).toEqual({ kind: 'iracing', command: { group: 'pit', name: 'pit:clearAll' } })
    expect(normalizeAction({ kind: 'gamepad', command: { button: 1 } })).toEqual({ kind: 'none' })
    expect(
      normalizeAction({ kind: 'app', command: { name: 'overlays:toggle', overlayId: 'https://evil.example' } })
    ).toEqual({ kind: 'app', command: { name: 'overlays:toggle', overlayId: 'relative' } })
    expect(isValidButtonAction({ kind: 'gamepad', command: { button: 1 } })).toBe(false)
  })

  it('exposes only the fixed action count for each control kind', () => {
    expect(buttonControlActions(createTouchControl('momentary', key('A')))).toHaveLength(1)
    expect(buttonControlActions(createTouchControl('latching-toggle', key('A')))).toHaveLength(2)
    expect(buttonControlActions(createTouchControl('rotary', key('A')))).toHaveLength(2)
    expect(buttonControlActions(createTouchControl('status-led'))).toEqual([])
    expect(buttonControlActions(createTouchControl('value-tile'))).toEqual([])
  })
})

describe('safe visual and expression destinations', () => {
  it('accepts hex colors and raster data only', () => {
    expect(safeColor('#12abEF', '#000000')).toBe('#12abEF')
    expect(safeColor('url(https://evil.example/x)', '#000000')).toBe('#000000')
    expect(safeImage('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    expect(safeImage('data:image/svg+xml;base64,AAAA')).toBeUndefined()
    expect(safeImage('https://evil.example/x.png')).toBeUndefined()
  })

  it('rejects unknown state destinations, formulas, and extra binding fields', () => {
    const errors = validateTouchStateBindings({
      active: { source: 'expression', expressionId: 'engine-on', formula: 'rpm > 0' },
      color: { source: 'expression', expressionId: 'color' },
      warning: { source: 'javascript', expressionId: 'bad' }
    })
    expect(errors.join(' ')).toContain('unexpected field "formula"')
    expect(errors.join(' ')).toContain('unknown destination "color"')
    expect(errors.join(' ')).toContain('must use the expression source')
  })
  it('round-trips exact expression state hooks without formulas', () => {
    const panel = createButtonBoxPanel({
      id: 'state-panel',
      columns: 1,
      rows: 1,
      buttons: [
        {
          id: 'fuel-state',
          label: 'FUEL',
          stateBindings: {
            active: { source: 'expression', expressionId: 'fuel-active' },
            disabled: { source: 'expression', expressionId: 'pit-disabled' },
            warning: { source: 'expression', expressionId: 'fuel-warning' },
            value: { source: 'expression', expressionId: 'fuel-liters' }
          }
        }
      ]
    })
    const parsed = parseButtonBoxPanel(serializeButtonBoxPanel(panel))
    expect(parsed?.buttons[0].stateBindings).toEqual(panel.buttons[0].stateBindings)
    expect(touchControlStateDestinationId(panel.id, 'fuel-state', 'warning')).toBe(
      'touch-control:state-panel:fuel-state:warning'
    )
  })
})

describe('semantic Touch IPC mapping', () => {
  it('maps hold begin/cancel through one dedicated channel with the full validated request', () => {
    const action = key('V', 'hold')
    const begin = buttonActionEventToIpc(action, 'begin', 'radio:main', 'main')
    expect(begin).toEqual({
      channel: TOUCH_ACTION_IPC_CHANNEL,
      args: [{ action, phase: 'begin', token: 'radio:main', zone: 'main' }]
    })
    expect(buttonActionEventToIpc(action, 'cancel', 'radio:main', 'main')).toEqual({
      channel: TOUCH_ACTION_IPC_CHANNEL,
      args: [{ action, phase: 'cancel', token: 'radio:main', zone: 'main' }]
    })
  })

  it('never returns raw iRacing or emulation channels', () => {
    const actions: ButtonAction[] = [
      key('PageUp', 'repeat'),
      { kind: 'iracing', command: { group: 'pit', name: 'pit:addFuel', fuelLiters: 10 } }
    ]
    for (const action of actions) {
      const ipc = buttonActionEventToIpc(action, 'trigger', 'control:main', 'main')
      expect(ipc?.channel).toBe(TOUCH_ACTION_IPC_CHANNEL)
      expect(ipc?.channel).not.toBe('iracing:command')
      expect(ipc?.channel).not.toBe('actions:testEmulation')
    }
  })

  it('rejects malformed, coerced, and phase-incompatible requests at runtime', () => {
    expect(normalizeTouchSemanticActionRequest({
      action: { kind: 'iracing', command: { group: 'camera', name: 'pit:clearAll' } },
      phase: 'trigger',
      token: 'pit:main',
      zone: 'main'
    })).toBeNull()
    expect(normalizeTouchSemanticActionRequest({
      action: { kind: 'gamepad', command: { button: 1 } },
      phase: 'trigger',
      token: 'bad:main',
      zone: 'main'
    })).toBeNull()
    expect(normalizeTouchSemanticActionRequest({
      action: key('A'),
      phase: 'cancel',
      token: 'a:main',
      zone: 'main'
    })).toBeNull()
  })
})
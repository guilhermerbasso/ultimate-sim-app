// @vitest-environment jsdom
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createButtonBoxPanel,
  type ButtonAction,
  type ButtonBoxButtonInput,
  type TouchControl
} from '../../../shared/touch-panel'
import { ButtonBoxRenderer, type TouchControlActionEvent } from './ButtonBoxRenderer'

const key = (name: string, mode: 'press' | 'hold' | 'repeat' | 'toggle' = 'press'): ButtonAction => ({
  kind: 'keyboard',
  command: { mode, keys: [name], repeatMs: mode === 'repeat' ? 80 : undefined }
})

function panelWith(control: TouchControl, extras: ButtonBoxButtonInput = {}) {
  return createButtonBoxPanel({
    id: 'interaction-panel',
    columns: 1,
    rows: 1,
    buttons: [{ id: 'control-1', label: 'TEST CONTROL', control, ...extras }]
  })
}

function pointerDown(element: Element, pointerId = 1): void {
  fireEvent.pointerDown(element, { button: 0, pointerId })
}

function pointerUp(element: Element, pointerId = 1): void {
  fireEvent.pointerUp(element, { button: 0, pointerId })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ButtonBoxRenderer pointer lifecycle', () => {
  it('fires a momentary action on pointer down and not again on pointer up', () => {
    const events: TouchControlActionEvent[] = []
    render(createElement(ButtonBoxRenderer, {
      panel: panelWith({ kind: 'momentary', action: key('P') }),
      onAction: (event) => { events.push(event) }
    }))
    const hit = screen.getByRole('button', { name: /momentary/i })
    pointerDown(hit)
    expect(events.map((event) => event.phase)).toEqual(['trigger'])
    expect(hit.closest('[data-control-id]')?.getAttribute('data-state-pressed')).toBe('true')
    pointerUp(hit)
    expect(events.map((event) => event.phase)).toEqual(['trigger'])
    expect(hit.closest('[data-control-id]')?.getAttribute('data-state-pressed')).toBe('false')
  })

  it('keeps a keyboard hold active until pointer cancel and emits the release', () => {
    const events: TouchControlActionEvent[] = []
    render(createElement(ButtonBoxRenderer, {
      panel: panelWith({ kind: 'momentary', action: key('V', 'hold') }),
      onAction: (event) => { events.push(event) }
    }))
    const hit = screen.getByRole('button', { name: /momentary/i })
    pointerDown(hit)
    fireEvent.pointerCancel(hit, { pointerId: 1 })
    expect(events.map((event) => event.phase)).toEqual(['begin', 'cancel'])
    expect(events[0].token).toBe(events[1].token)
  })

  it('keeps hold ownership with the first pointer and ignores extra fingers', () => {
    const events: TouchControlActionEvent[] = []
    render(createElement(ButtonBoxRenderer, {
      panel: panelWith({ kind: 'momentary', action: key('V', 'hold') }),
      onAction: (event) => { events.push(event) }
    }))
    const hit = screen.getByRole('button', { name: /momentary/i })
    pointerDown(hit, 1)
    pointerDown(hit, 2)
    pointerUp(hit, 2)
    expect(events.map((event) => event.phase)).toEqual(['begin'])
    pointerUp(hit, 1)
    expect(events.map((event) => event.phase)).toEqual(['begin', 'end'])
  })

  it('does not let a second rocker pointer replace the active zone', () => {
    const events: TouchControlActionEvent[] = []
    render(createElement(ButtonBoxRenderer, {
      panel: panelWith({
        kind: 'two-position-rocker',
        negativeAction: key('PageDown'),
        positiveAction: key('PageUp'),
        negativeLabel: 'TC decrease',
        positiveLabel: 'TC increase'
      }),
      onAction: (event) => { events.push(event) }
    }))
    const negative = screen.getByRole('button', { name: /tc decrease/i })
    const positive = screen.getByRole('button', { name: /tc increase/i })
    pointerDown(negative, 11)
    pointerDown(positive, 22)
    pointerUp(positive, 22)
    pointerUp(negative, 11)
    pointerDown(positive, 22)
    pointerUp(positive, 22)
    expect(events.map((event) => event.zone)).toEqual(['negative', 'positive'])
  })

  it('keeps rotary repeat bound to its first pointer until that pointer releases', () => {
    vi.useFakeTimers()
    const events: TouchControlActionEvent[] = []
    render(createElement(ButtonBoxRenderer, {
      panel: panelWith({
        kind: 'rotary',
        decrementAction: key('['),
        incrementAction: key(']'),
        decrementLabel: 'ABS decrease',
        incrementLabel: 'ABS increase',
        repeat: { delayMs: 100, intervalMs: 50 }
      }),
      onAction: (event) => { events.push(event) }
    }))
    const decrement = screen.getByRole('button', { name: /abs decrease/i })
    const increment = screen.getByRole('button', { name: /abs increase/i })
    pointerDown(increment, 31)
    pointerDown(decrement, 32)
    act(() => vi.advanceTimersByTime(160))
    pointerUp(decrement, 32)
    const beforeOwnerRelease = events.length
    act(() => vi.advanceTimersByTime(100))
    expect(events.length).toBeGreaterThan(beforeOwnerRelease)
    pointerUp(increment, 31)
    expect(events.every((event) => event.zone === 'increment')).toBe(true)
  })
  it('emits a cancellation release when a held control unmounts', () => {
    const events: TouchControlActionEvent[] = []
    const view = render(createElement(ButtonBoxRenderer, {
      panel: panelWith({ kind: 'momentary', action: key('V', 'hold') }),
      onAction: (event) => { events.push(event) }
    }))
    pointerDown(screen.getByRole('button', { name: /momentary/i }))
    view.unmount()
    expect(events.map((event) => event.phase)).toEqual(['begin', 'cancel'])
  })
  it('releases the old latching action when live edits replace the control', () => {
    const events: TouchControlActionEvent[] = []
    const toggle = key('H', 'toggle')
    const view = render(createElement(ButtonBoxRenderer, {
      panel: panelWith({ kind: 'latching-toggle', onAction: toggle, offAction: { kind: 'none' } }),
      onAction: (event) => { events.push(event) }
    }))
    const hit = screen.getByRole('button', { name: /latching toggle/i })
    pointerDown(hit)
    pointerUp(hit)

    view.rerender(createElement(ButtonBoxRenderer, {
      panel: panelWith({ kind: 'momentary', action: key('L') }),
      onAction: (event) => { events.push(event) }
    }))

    expect(events.map((event) => event.phase)).toEqual(['trigger', 'cancel'])
    expect(events[1]).toMatchObject({
      action: { kind: 'keyboard', command: { mode: 'toggle', keys: ['H'] } },
      zone: 'teardown',
      token: 'control-1:latching'
    })
  })
  it('releases an active latching keyboard toggle when the control unmounts', () => {
    const events: TouchControlActionEvent[] = []
    const toggle = key('H', 'toggle')
    const view = render(createElement(ButtonBoxRenderer, {
      panel: panelWith({ kind: 'latching-toggle', onAction: toggle, offAction: { kind: 'none' } }),
      onAction: (event) => { events.push(event) }
    }))
    const hit = screen.getByRole('button', { name: /latching toggle/i })
    pointerDown(hit)
    pointerUp(hit)
    view.unmount()

    expect(events.map((event) => event.phase)).toEqual(['trigger', 'cancel'])
    expect(events.map((event) => event.zone)).toEqual(['on', 'teardown'])
    expect(events[0].token).toBe('control-1:latching')
    expect(events[1].token).toBe(events[0].token)
  })

  it('uses the same stable token when a latching keyboard toggle turns off', () => {
    const events: TouchControlActionEvent[] = []
    const toggle = key('H', 'toggle')
    const view = render(createElement(ButtonBoxRenderer, {
      panel: panelWith({ kind: 'latching-toggle', onAction: toggle, offAction: toggle }),
      onAction: (event) => { events.push(event) }
    }))
    const hit = screen.getByRole('button', { name: /latching toggle/i })
    pointerDown(hit)
    pointerUp(hit)
    pointerDown(hit)
    pointerUp(hit)
    view.unmount()

    expect(events.map((event) => event.zone)).toEqual(['on', 'off'])
    expect(events.every((event) => event.token === 'control-1:latching')).toBe(true)
  })
  it('does not execute through a closed guard on the first tap', () => {
    const events: TouchControlActionEvent[] = []
    render(createElement(ButtonBoxRenderer, {
      panel: panelWith({ kind: 'guarded-two-step', action: key('I'), armTimeoutMs: 4000 }),
      onAction: (event) => { events.push(event) }
    }))
    let hit = screen.getByRole('button', { name: /guard closed/i })
    pointerDown(hit)
    pointerUp(hit)
    expect(events).toEqual([])
    hit = screen.getByRole('button', { name: /guard open/i })
    pointerDown(hit)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ phase: 'trigger', zone: 'guarded' })
    pointerUp(hit)
  })

  it('runs exact ON and OFF slots for a latching toggle', () => {
    const events: TouchControlActionEvent[] = []
    const panel = panelWith({ kind: 'latching-toggle', onAction: key('1'), offAction: key('0') })
    render(createElement(ButtonBoxRenderer, { panel, onAction: (event) => { events.push(event) } }))
    const hit = screen.getByRole('button', { name: /latching toggle/i })
    pointerDown(hit)
    pointerUp(hit)
    expect(hit.getAttribute('aria-pressed')).toBe('true')
    pointerDown(hit)
    pointerUp(hit)
    expect(events.map((event) => event.zone)).toEqual(['on', 'off'])
    expect(events.map((event) => event.action.kind === 'keyboard' ? event.action.command.keys[0] : '')).toEqual(['1', '0'])
  })

  it('auto-repeats a rotary detent only until pointer up', () => {
    vi.useFakeTimers()
    const events: TouchControlActionEvent[] = []
    render(createElement(ButtonBoxRenderer, {
      panel: panelWith({
        kind: 'rotary',
        decrementAction: key('['),
        incrementAction: key(']'),
        decrementLabel: 'Brake bias down',
        incrementLabel: 'Brake bias up',
        repeat: { delayMs: 100, intervalMs: 50 }
      }),
      onAction: (event) => { events.push(event) }
    }))
    const increment = screen.getByRole('button', { name: /brake bias up/i })
    pointerDown(increment)
    expect(events).toHaveLength(1)
    act(() => vi.advanceTimersByTime(210))
    expect(events.length).toBeGreaterThanOrEqual(4)
    pointerUp(increment)
    const stoppedAt = events.length
    act(() => vi.advanceTimersByTime(500))
    expect(events).toHaveLength(stoppedAt)
    expect(events.every((event) => event.zone === 'increment')).toBe(true)
  })

  it('provides two independently named rocker zones', () => {
    const events: TouchControlActionEvent[] = []
    render(createElement(ButtonBoxRenderer, {
      panel: panelWith({
        kind: 'two-position-rocker',
        negativeAction: key('PageDown'),
        positiveAction: key('PageUp'),
        negativeLabel: 'TC decrease',
        positiveLabel: 'TC increase'
      }),
      onAction: (event) => { events.push(event) }
    }))
    const negative = screen.getByRole('button', { name: /tc decrease/i })
    const positive = screen.getByRole('button', { name: /tc increase/i })
    pointerDown(negative)
    pointerUp(negative)
    pointerDown(positive)
    pointerUp(positive)
    expect(events.map((event) => event.zone)).toEqual(['negative', 'positive'])
  })

  it('cycles selector choices and executes only the newly selected choice', () => {
    const events: TouchControlActionEvent[] = []
    render(createElement(ButtonBoxRenderer, {
      panel: panelWith({
        kind: 'selector',
        initialChoiceId: 'map-1',
        choices: [
          { id: 'map-1', label: 'MAP 1', value: '1', action: key('1') },
          { id: 'map-2', label: 'MAP 2', value: '2', action: key('2') }
        ]
      }),
      onAction: (event) => { events.push(event) }
    }))
    expect(screen.getByText('1')).toBeTruthy()
    const next = screen.getByRole('button', { name: /next choice/i })
    pointerDown(next)
    pointerUp(next)
    expect(screen.getByText('2')).toBeTruthy()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ zone: 'choice:map-2' })
  })
})

describe('ButtonBoxRenderer keyboard and accessibility states', () => {
  it('reports rejected runtime actions through visible error state and feedback', async () => {
    const feedback = vi.fn()
    const panel = panelWith({ kind: 'momentary', action: key('P') })
    const { container } = render(createElement(ButtonBoxRenderer, {
      panel,
      onAction: async () => ({ ok: false, message: 'Simulator unavailable.' }),
      onFeedback: feedback
    }))
    pointerDown(screen.getByRole('button', { name: /momentary/i }))
    await waitFor(() => expect(container.querySelector('[data-feedback="error"]')).toBeTruthy())
    expect(feedback).toHaveBeenCalledWith(expect.objectContaining({ ok: false, message: 'Simulator unavailable.' }))
  })
  it('uses Enter key down/up for true hold semantics', () => {
    const events: TouchControlActionEvent[] = []
    render(createElement(ButtonBoxRenderer, {
      panel: panelWith({ kind: 'momentary', action: key('T', 'hold') }),
      onAction: (event) => { events.push(event) }
    }))
    const hit = screen.getByRole('button', { name: /momentary/i })
    hit.focus()
    fireEvent.keyDown(hit, { key: 'Enter' })
    fireEvent.keyUp(hit, { key: 'Enter' })
    expect(events.map((event) => event.phase)).toEqual(['begin', 'end'])
  })

  it('renders status and value controls as non-action displays with screen-reader values', () => {
    const status = panelWith({ kind: 'status-led', value: 'READY' }, { state: { active: true } })
    const { rerender } = render(createElement(ButtonBoxRenderer, { panel: status }))
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('status', { name: /active/i })).toBeTruthy()
    expect(screen.getByText('READY')).toBeTruthy()

    const value = panelWith({ kind: 'value-tile', value: '52.1', unit: 'L' })
    rerender(createElement(ButtonBoxRenderer, { panel: value }))
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText(/52\.1/)).toBeTruthy()
  })

  it('binds disabled and warning states with non-color cues', () => {
    const panel = panelWith(
      { kind: 'momentary', action: key('P') },
      {
        stateBindings: {
          disabled: { source: 'expression', expressionId: 'disabled-expr' },
          warning: { source: 'expression', expressionId: 'warning-expr' }
        }
      }
    )
    render(createElement(ButtonBoxRenderer, {
      panel,
      expressionValues: { 'disabled-expr': true, 'warning-expr': true },
      onAction: vi.fn()
    }))
    const hit = screen.getByRole('button', { name: /disabled/i }) as HTMLButtonElement
    expect(hit.disabled).toBe(true)
    expect(screen.getByText(/disabled/i)).toBeTruthy()
    expect(hit.closest('[data-control-id]')?.className).toContain('is-warning')
  })

  it('applies activeTextColor to the rendered SVG label, not only the outer CSS color', () => {
    const panel = panelWith(
      { kind: 'latching-toggle', onAction: key('L'), offAction: key('L') },
      {
        activeTextColor: '#ff00aa',
        textColor: '#ffffff',
        stateBindings: { active: { source: 'expression', expressionId: 'active-expr' } }
      }
    )
    const { container } = render(createElement(ButtonBoxRenderer, {
      panel,
      expressionValues: { 'active-expr': true }
    }))
    expect(container.innerHTML).toContain('fill="#ff00aa"')
    expect(container.querySelector('[data-state-active="true"]')).toBeTruthy()
  })

  it('gives every multi-zone hit target a descriptive accessible name', () => {
    const panel = panelWith({
      kind: 'rotary',
      decrementAction: key('['),
      incrementAction: key(']'),
      decrementLabel: 'Decrease brake bias',
      incrementLabel: 'Increase brake bias',
      repeat: { delayMs: 420, intervalMs: 120 }
    })
    render(createElement(ButtonBoxRenderer, { panel }))
    expect(screen.getByRole('button', { name: /decrease brake bias/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /increase brake bias/i })).toBeTruthy()
  })
})